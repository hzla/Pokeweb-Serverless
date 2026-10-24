import type { CutsceneScene, SceneJointKey, SceneJointTrack, SceneSkeletalBaseline } from './cutsceneScene';
import type { NativeCutsceneDocument } from './nativeCutsceneModel';
import { nativeJointEuler, nativeJointRotation, interpolateNativeJoint, readNativeObject } from './nativeObjectMovement';
import { writeNativeJointTracks, type NativeJointChannels } from './nativeJointAnimation';
import type { NitroJointPose } from './nitroAnimation';

const stamp = (bytes?: Uint8Array) => bytes && String.fromCharCode(...bytes.subarray(0,4));
const equal = (a: Uint8Array, b: number[]) => a.length===b.length && a.every((n,i)=>n===b[i]);

/** Resource IDs are archive members, never transient preview model indices. */
export function nativeSkeletalCatalog(doc: NativeCutsceneDocument) {
  const seen = new Set<string>();
  return doc.definition.resources.flatMap(root=>root.bundles.flatMap(variant=>variant.flatMap(ids=>{
    const modelId=ids.find(id=>stamp(doc.files[id])==='BMD0'), animationId=ids.find(id=>stamp(doc.files[id])==='BCA0');
    if(modelId===undefined||animationId===undefined||seen.has(`${modelId}:${animationId}`))return [];
    seen.add(`${modelId}:${animationId}`);
    const object=readNativeObject(doc.files[modelId],doc.files[animationId]);
    return [{modelId,animationId,name:object.name,nodes:object.nodes,frameCount:object.animation.frameCount}];
  })));
}

export function jointKeyPose(key: SceneJointKey): NitroJointPose {
  return {translation:[...key.translation],rotation:nativeJointRotation(key.rotationDegrees),scale:[...key.scale],inverseScale:key.scale.map(n=>n?1/n:0) as [number,number,number]};
}

/** A track replaces its selected channels only within its first/last keys.
 * Outside that span the original native motion is retained. */
export function sampleSceneJoint(track: SceneJointTrack, frame: number, keys=[...track.keys].sort((a,b)=>a.frame-b.frame)) {
  if(!keys.length||frame<keys[0].frame||frame>keys[keys.length-1].frame)return undefined;
  let low=0,high=keys.length;while(low<high){const mid=(low+high)>>>1;if(keys[mid].frame<=frame)low=mid+1;else high=mid;}
  const i=Math.max(0,low-1);
  const a=keys[i],b=keys[Math.min(i+1,keys.length-1)];
  let t=a===b||a.easing==='hold'?0:(frame-a.frame)/(b.frame-a.frame);
  if(a.easing==='smoothstep')t=t*t*(3-2*t);
  return interpolateNativeJoint(jointKeyPose(a),jointKeyPose(b),t,'all');
}

export function captureSceneJoint(pose: NitroJointPose, id: string, frame: number): SceneJointKey {
  return {id,frame,translation:[...pose.translation],rotationDegrees:nativeJointEuler(pose.rotation),scale:[...pose.scale],easing:'linear'};
}

/** Bake on owned buffers first. Prior applied samples are restored to their
 * original clip before recompilation, making removal and reapplication exact. */
export function stageSceneSkeletal(doc: NativeCutsceneDocument, source: CutsceneScene, prior: SceneSkeletalBaseline = {}): SceneSkeletalBaseline {
  const tracks=source.skeletal??[], files=doc.files.slice(), touched=new Set<number>(), state:SceneSkeletalBaseline={};
  if(tracks.length&&source.stage.kind!=='native-template')throw new Error('Skeletal tracks require a native template.');
  for(const [key,entry] of Object.entries(prior)){
    const id=Number(key);
    if(!Number.isInteger(id)||!files[id]||!Array.isArray(entry.baseline)||!Array.isArray(entry.applied)||entry.baseline.some(n=>!Number.isInteger(n)||n<0||n>255)||!equal(files[id],entry.applied))throw new Error('A skeletal resource changed outside this timeline. Reimport its native timeline before applying poses.');
    files[id]=new Uint8Array(entry.baseline);touched.add(id);
  }
  if(tracks.length){
    const catalog=nativeSkeletalCatalog({...doc,files}), grouped=new Map<number,SceneJointTrack[]>();
    for(const track of tracks){
      const binding=catalog.find(b=>b.modelId===track.modelId&&b.animationId===track.animationId);
      if(!binding||!binding.nodes[track.jointIndex])throw new Error(`Joint track ${track.name} does not bind to a model/clip in this sequence.`);
      if(track.keys.some(k=>k.frame>=binding.frameCount))throw new Error(`Joint track ${track.name} exceeds its ${binding.frameCount}-frame native clip. Short clips repeat at their native length.`);
      const list=grouped.get(track.animationId)??[];list.push(track);grouped.set(track.animationId,list);
    }
    for(const [id,list] of grouped){
      const original=files[id], object=readNativeObject(files[list[0].modelId],original), edits=new Map<number,NativeJointChannels>();
      for(const track of list){
        if(edits.has(track.jointIndex))throw new Error('Two tracks cannot own the same native joint.');
        const channels:NativeJointChannels={},keys=[...track.keys].sort((a,b)=>a.frame-b.frame);
        for(const channel of track.channels)channels[channel]=Array.from({length:object.animation.frameCount},(_,f)=>{
          const value=sampleSceneJoint(track,f,keys)?.[channel];return (value??object.animation.sample(f)[track.jointIndex][channel]).slice();
        }) as never;
        edits.set(track.jointIndex,channels);
      }
      files[id]=writeNativeJointTracks(original,object.bases,edits);touched.add(id);
      state[id]={baseline:Array.from(original),applied:Array.from(files[id])};
    }
  }
  // No source or document mutations before every clip has validated/encoded.
  for(const id of touched){
    const original=doc.files[id];doc.assets??=new Map();
    doc.assets.set(id,{baseline:new Uint8Array(original),bytes:files[id]});doc.files[id]=files[id];
  }
  return state;
}
