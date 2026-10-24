import { describe,expect,it } from 'vitest';
import { Matrix4,Quaternion,Vector3 } from 'three';
import { createMapCutscene,readCutsceneScene,nextSceneItemId,sceneTimelineItems,storeCutsceneScene,type SceneJointTrack } from '../pokeweb/cutsceneScene';
import { sampleSceneJoint,stageSceneSkeletal,nativeSkeletalCatalog,captureSceneJoint } from '../pokeweb/cutsceneSkeletal';
import { nativeJointRotation,readNativeObject,nativeJointEuler } from '../pokeweb/nativeObjectMovement';
import { compileCutsceneNpc } from '../pokeweb/cutsceneActorCompiler';
import { compileNitroAnimatedModel } from '../pokeweb/nitroAnimatedModel';
import { nitroMul,nitroScale } from '../pokeweb/nitroAnimation';
import { importNativeTimeline,applyNativeTimeline,nativeTimelineFingerprint } from '../pokeweb/cutsceneNativeCompiler';
import { openNativeCutscene,type NativeCutsceneDocument,type NativeCutsceneLibrary } from '../pokeweb/nativeCutsceneModel';
import { buildAspertiaCutsceneClone } from '../pokeweb/nativeCutsceneClone';
import { nativeCutsceneFixture } from './fixtures/nativeCutscene';
import { writeU16,writeU32 } from '../nds/binary';
import { NARC } from '../nds/narc';
import { makeEditProject } from './fixtures/editProject';
import { createProjectDocument } from '../pokeweb/projectDocument';
import { openProjectSession } from '../pokeweb/projectSession';
import type { Map3dNpcSpriteFrames } from '../pokeweb/map3dModel';

const track=():SceneJointTrack=>({id:'joint-track-1',name:'Root pose',modelId:1,animationId:2,jointIndex:0,channels:['rotation','scale'],keys:[
  {id:'joint-key-1',frame:2,translation:[0,0,0],rotationDegrees:[0,0,170],scale:[1,1,1],easing:'linear'},
  {id:'joint-key-2',frame:8,translation:[8,4,2],rotationDegrees:[0,0,-170],scale:[2,.5,1.5],easing:'linear'}]});
function scene(){const s=createMapCutscene(370,'Pose test',{position:[0,10,20],rotationDegrees:[0,0,0]},'pose-test');s.stage={kind:'native-template',sequenceId:27};s.frameCount=12;s.camera[1].frame=11;s.events=[];s.skeletal=[track()];return s;}
function fixture(){
  const image={name:'test',width:8,height:8,rgba:new Uint8Array(256).fill(255)},frames={width:8,height:8,framesByDirection:Object.fromEntries(['up','down','left','right'].map(d=>[d,[image,image,image]]))} as Map3dNpcSpriteFrames;
  const npc=compileCutsceneNpc({id:'actor',name:'Actor',overworldId:1,frameStep:2,keys:[{id:'a',frame:0,position:[0,0,0],facing:'up',action:'idle',easing:'linear'},{id:'b',frame:11,position:[16,8,0],facing:'up',action:'idle',easing:'linear'}]},frames,12,{origin:[0,0,0],unitsPerWorldUnit:1/16});
  const doc={files:[new Uint8Array(),npc.model,npc.group[1]],definition:{resources:[{selection:0,bundles:[[[1,2]]]}]},assets:new Map()} as unknown as NativeCutsceneDocument;
  return {doc};
}
const matrixClose=(a:number[],b:number[])=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],3));
describe('skeletal timeline tracks',()=>{
  it('samples unordered keys with shortest-arc quaternion rotation, hold/smooth easing and bounded replacement spans',()=>{
    const t=track();t.keys.reverse();const original=JSON.stringify(t),mid=sampleSceneJoint(t,5)!;
    expect(mid.translation).toEqual([4,2,1]);expect(mid.scale).toEqual([1.5,.75,1.25]);expect(Math.abs(nativeJointEuler(mid.rotation!)[2])).toBeCloseTo(180);
    expect(sampleSceneJoint(t,1)).toBeUndefined();expect(sampleSceneJoint(t,9)).toBeUndefined();expect(JSON.stringify(t)).toBe(original);
    t.keys[1].easing='hold';expect(sampleSceneJoint(t,7)?.scale).toEqual([1,1,1]);expect(sampleSceneJoint(t,8)?.scale).toEqual([2,.5,1.5]);
    t.keys[1].easing='smoothstep';expect(sampleSceneJoint(t,3.5)?.translation?.[0]).toBe(1.25);
  });
  it('strictly validates bindings, channels, global IDs, occupied frames and singular scale interpolation',()=>{
    const s=scene();expect(readCutsceneScene(s)).toEqual(s);expect(nextSceneItemId(s,'joint-key')).toBe('joint-key-3');expect(sceneTimelineItems(s)).toHaveLength(4);
    expect(()=>readCutsceneScene({...s,stage:{kind:'map',zoneId:370,season:'spring'}})).toThrow('native template');
    for(const edit of [(t:SceneJointTrack)=>t.keys[1].frame=2,(t:SceneJointTrack)=>t.keys[1].id=s.camera[0].id,(t:SceneJointTrack)=>t.channels=[],(t:SceneJointTrack)=>t.keys[1].scale[1]=0,(t:SceneJointTrack)=>t.keys[1].scale[1]=-1]){
      const bad=structuredClone(s);edit(bad.skeletal![0]);expect(()=>readCutsceneScene(bad)).toThrow();
    }
    const bad=structuredClone(s);bad.skeletal!.push({...track(),id:'joint-track-2'});expect(()=>readCutsceneScene(bad)).toThrow('own a joint');
    bad.skeletal=[];expect(readCutsceneScene(bad).skeletal).toEqual([]);
  });
  it('bakes selected channels into native clips and preserves other frames, native motion and source buffers',()=>{
    const {doc}=fixture(),source=scene(),before=doc.files[2].slice(),object=readNativeObject(doc.files[1],before);
    expect(nativeSkeletalCatalog(doc)[0]).toMatchObject({modelId:1,animationId:2,frameCount:12});
    const state=stageSceneSkeletal(doc,source),after=readNativeObject(doc.files[1],doc.files[2]);
    expect(state['2'].baseline).toEqual(Array.from(before));expect(before).toEqual(doc.assets!.get(2)!.baseline);
    for(let f=0;f<12;f++){
      const pose=after.animation.sample(f)[0],old=object.animation.sample(f)[0],authored=sampleSceneJoint(track(),f);
      expect(pose.translation).toEqual(old.translation);
      matrixClose(pose.rotation,authored?.rotation??old.rotation);pose.scale.forEach((n,i)=>expect(n).toBeCloseTo((authored?.scale??old.scale)[i],3));
    }
    const result=doc.files[2].slice();stageSceneSkeletal(doc,source,state);expect(doc.files[2]).toEqual(result);
    stageSceneSkeletal(doc,{...source,skeletal:[]},state);expect(doc.files[2]).toEqual(before);
  });
  it('rejects stale/missing resources and keys outside the native clip atomically',()=>{
    for(const change of [(s:ReturnType<typeof scene>)=>s.skeletal![0].modelId=99,(s:ReturnType<typeof scene>)=>s.skeletal![0].jointIndex=1,(s:ReturnType<typeof scene>)=>s.skeletal![0].keys[1].frame=20]){
      const {doc}=fixture(),s=scene(),copy=doc.files.map(b=>b.slice());change(s);expect(()=>stageSceneSkeletal(doc,s)).toThrow();expect(doc.files).toEqual(copy);expect(doc.assets!.size).toBe(0);
    }
    const {doc}=fixture(),state=stageSceneSkeletal(doc,scene());doc.files[2][8]^=1;const before=doc.files[2].slice();expect(()=>stageSceneSkeletal(doc,scene(),state)).toThrow('outside this timeline');expect(doc.files[2]).toEqual(before);
  });
  it('uses the same native parent matrix and local pose for gizmo previews and exported geometry',()=>{
    const {doc}=fixture(),model=compileNitroAnimatedModel(doc.files[1],doc.files[2]),rotation=nativeJointRotation([23,-35,61]);model.jointOverrides.set(0,{rotation,scale:[1.3,.8,1.7]});model.sample(5);
    const pose=model.jointPoses[0],world=nitroMul(model.jointPoseBases[0],nitroMul(pose.rotation,nitroScale(pose.scale)));
    const parent=new Matrix4().fromArray(model.jointPoseBases[0]).transpose(),local=new Matrix4().compose(new Vector3(),new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(rotation).transpose()),new Vector3(...pose.scale));
    matrixClose(parent.multiply(local).transpose().toArray(),world);expect(model.jointIndices).toEqual([0]);expect(model.nodeNames).toHaveLength(1);
    const key=captureSceneJoint(pose,'pose-key',5),source=scene();source.skeletal![0].keys=[key];stageSceneSkeletal(doc,source);
    const exported=compileNitroAnimatedModel(doc.files[1],doc.files[2]);exported.sample(5);
    exported.primitives.forEach((p,i)=>matrixClose(Array.from(p.positions),Array.from(model.primitives[i].positions)));
  });
  it('exports private sequence 27, keeps original clips intact, persists baselines and reverses removed tracks',()=>{
    const {doc}=fixture(),f=nativeCutsceneFixture();f.files=[f.files[0],new Uint8Array(doc.files[1]),new Uint8Array(doc.files[2])];writeU32(f.overlay,0x6144,2);writeU16(f.overlay,0x6162,2);
    const clone=buildAspertiaCutsceneClone(f.overlay,f.files),archive=new NARC();archive.files=clone.files;
    const project=makeEditProject();project.overlays[293]=clone.overlay;project.fileSystem={replacements:{17:archive.save()}} as typeof project.fileSystem;
    const library={rom:{files:f.files},fileId:17,overlayBytes:clone.overlay} as unknown as NativeCutsceneLibrary;
    const native=openNativeCutscene(project,library,27),source=importNativeTimeline(native,'Pose test');source.frameCount=12;source.camera[1].frame=11;
    const ids=native.definition.resources[0].bundles[0][0];source.skeletal=[{...track(),modelId:ids[0],animationId:ids[1]}];
    const record=storeCutsceneScene(project,source);record.nativeFingerprint=nativeTimelineFingerprint(native);
    record.nativeFingerprint=applyNativeTimeline(project,library,source,record.nativeFingerprint);
    const saved=new NARC(project.fileSystem!.replacements[17]);expect(saved.files[2]).toEqual(f.files[2]);expect(saved.files[ids[1]]).not.toEqual(f.files[2]);
    const reopened=openProjectSession(structuredClone(createProjectDocument(project,true)));expect(reopened.cutsceneAuthoring!.scenes[source.id].skeletalBaseline).toEqual(record.skeletalBaseline);
    source.skeletal=[];record.nativeFingerprint=applyNativeTimeline(project,library,source,record.nativeFingerprint);
    expect(new NARC(project.fileSystem!.replacements[17]).files[ids[1]]).toEqual(f.files[2]);expect(record.skeletalBaseline).toEqual({});
  });
});
