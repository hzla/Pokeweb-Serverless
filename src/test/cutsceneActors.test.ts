import { describe, expect, it } from 'vitest';
import { createMapCutscene, readCutsceneScene, sceneTimelineItems, nextSceneItemId, storeCutsceneScene, type SceneNpcTrack } from '../pokeweb/cutsceneScene';
import { sampleSceneNpc, sceneNpcTexture } from '../pokeweb/cutsceneActors';
import { compileCutsceneNpc, writeCutsceneNpcMovement } from '../pokeweb/cutsceneActorCompiler';
import { compileNitroAnimatedModel } from '../pokeweb/nitroAnimatedModel';
import { nitroIdentity, nitroIdentityPose, readNitroJointAnimation } from '../pokeweb/nitroAnimation';
import { makeEditProject } from './fixtures/editProject';
import { createProjectDocument } from '../pokeweb/projectDocument';
import { openProjectSession } from '../pokeweb/projectSession';
import type { Map3dNpcSpriteFrames } from '../pokeweb/map3dModel';

const actor = (): SceneNpcTrack => ({id:'npc-1',name:'Coastal walker',overworldId:1,frameStep:2,keys:[
  {id:'npc-key-1',frame:0,position:[11040,16,4112],facing:'right',action:'walk',easing:'linear'},
  {id:'npc-key-2',frame:8,position:[11072,32,4112],facing:'down',action:'idle',easing:'hold'}
]});
function sprites(): Map3dNpcSpriteFrames {
  return {width:32,height:32,framesByDirection:Object.fromEntries(['up','down','left','right'].map((dir,d)=>[dir,Array.from({length:3},(_,f)=>({name:`${dir}${f}`,width:8,height:8,rgba:new Uint8Array(256).map((_,i)=>[d*64,f*96,0,i<4?0:255][i%4])}))]))};
}
const scene=()=>({...createMapCutscene(370,'NPC route',{position:[11040,128,4224],rotationDegrees:[-48,0,0]},'npc-test'),actors:[actor()]});
describe('cutscene NPC tracks',()=>{
  it('holds endpoints, interpolates position and samples facing/walking deterministically when seeking',()=>{
    const a=actor();expect(sampleSceneNpc(a,-1).position).toEqual(a.keys[0].position);
    expect(sampleSceneNpc(a,4)).toMatchObject({position:[11056,24,4112],facing:'right',action:'walk'});
    expect(sampleSceneNpc(a,8)).toMatchObject({position:[11072,32,4112],facing:'down',action:'idle'});
    const frames=sprites();expect([0,2,4,6,8].map(f=>sceneNpcTexture(a,f,frames).name)).toEqual(['right0','right1','right0','right2','down0']);
    sampleSceneNpc(a,299);expect(sceneNpcTexture(a,2,frames).name).toBe('right1');
    const smooth=actor();smooth.keys[0].easing='smoothstep';expect(sampleSceneNpc(smooth,2).position[0]).toBe(11045);
  });
  it('rejects conflicting times/IDs, invalid resources/actions and native-template actors without altering a saved source',()=>{
    const p=makeEditProject(),s=scene();storeCutsceneScene(p,s);
    const bad=structuredClone(s);bad.actors[0].keys[1].frame=0;expect(()=>storeCutsceneScene(p,bad,1)).toThrow('Only one key per NPC');expect(p.cutsceneAuthoring!.scenes[s.id].revision).toBe(1);
    bad.actors[0].keys[1].frame=300;expect(()=>readCutsceneScene(bad)).toThrow('outside the timeline');
    expect(()=>readCutsceneScene({...s,stage:{kind:'native-template',sequenceId:27}})).toThrow('map stage');
    expect(()=>readCutsceneScene({...s,actors:[{...actor(),frameStep:0}]})).toThrow('1–120');
    expect(()=>readCutsceneScene({...s,actors:[{...actor(),keys:[]}]})).toThrow('at least one');
    expect(()=>readCutsceneScene({...s,actors:[{...actor(),keys:[{...actor().keys[0],action:'wave'}]}]})).toThrow('idle or walk');
    expect(()=>readCutsceneScene({...s,actors:[{...actor(),id:s.camera[0].id}]})).toThrow('unique');
    expect(nextSceneItemId(s,'npc-key')).toBe('npc-key-3');expect(sceneTimelineItems(s).some(k=>k.id==='npc-key-1')).toBe(true);
  });
  it('preserves NPC sources in project round trips and still reads older scenes without actors',()=>{
    const p=makeEditProject(),s=scene();storeCutsceneScene(p,s);const reopened=openProjectSession(structuredClone(createProjectDocument(p,true)));
    expect(reopened.cutsceneAuthoring!.scenes[s.id].source.actors).toEqual(s.actors);
    const {actors,...legacy}=s;expect(readCutsceneScene(legacy)).toEqual(legacy);
  });
  it('exports independently moving, camera-facing geometry and texture/palette frames on the native clock',()=>{
    const a=actor(),frames=sprites(),manifest={origin:[11008,0,4096] as [number,number,number],unitsPerWorldUnit:1/16};
    const output=compileCutsceneNpc(a,frames,12,manifest),native=compileNitroAnimatedModel(output.model,output.group[1],undefined,{patternBytes:output.group[2],sceneFrames:12});
    for(const frame of [0,2,4,6,8,11,2]){
      native.sample(frame,nitroIdentity());const expected=sampleSceneNpc(a,frame).position.map((n,i)=>(n-manifest.origin[i])/16);
      expect(Array.from(native.jointPositions)).toEqual(expected);
      const actual=native.primitives[0].material.texture!.rgba,expectedImage=sceneNpcTexture(a,frame,frames).rgba;
      for(let i=0;i<actual.length;i++) { if(i%4===3)expect(actual[i]).toBe(expectedImage[i]);else if(expectedImage[i-i%4+3])expect(Math.abs(actual[i]-expectedImage[i])).toBeLessThanOrEqual(5); }
      const x=native.primitives[0].positions[0],y=native.primitives[0].positions[1];expect(x).toBe(expected[0]-1);expect(y).toBe(expected[1]);
    }
    const camera=nitroIdentity();camera[5]=0;camera[6]=-1;camera[9]=1;camera[10]=0;native.sample(0,camera);
    expect(Array.from(native.jointPositions)).toEqual([2,1,1]);
    expect(output.group.map(b=>String.fromCharCode(...b.subarray(0,4)))).toEqual(['BMD0','BCA0','BTP0']);
    expect(compileCutsceneNpc(a,frames,12,manifest).group).toEqual(output.group);
  });
  it('writes valid one-sample movement and rejects nonfinite or overflowing coordinates',()=>{
    const bytes=writeCutsceneNpcMovement([[1,-2,3]]);expect(readNitroJointAnimation(bytes,[nitroIdentityPose()]).sample(0)[0].translation).toEqual([1,-2,3]);
    expect(()=>writeCutsceneNpcMovement([[NaN,0,0]])).toThrow('fixed-point');expect(()=>writeCutsceneNpcMovement([[524288,0,0]])).toThrow('fixed-point');
  });
});
