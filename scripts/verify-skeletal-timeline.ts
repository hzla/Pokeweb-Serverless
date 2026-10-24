import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { createAspertiaCutsceneClone } from '../src/pokeweb/nativeCutsceneClone';
import { loadNativeCutsceneLibrary,openNativeCutscene } from '../src/pokeweb/nativeCutsceneModel';
import { importNativeTimeline,applyNativeTimeline,nativeTimelineFingerprint,previewNativeTimeline } from '../src/pokeweb/cutsceneNativeCompiler';
import { nativeSkeletalCatalog,captureSceneJoint,sampleSceneJoint } from '../src/pokeweb/cutsceneSkeletal';
import { readNativeObject,nativeJointRotation } from '../src/pokeweb/nativeObjectMovement';
import { nitroMul } from '../src/pokeweb/nitroAnimation';
import { storeCutsceneScene,type SceneJointTrack } from '../src/pokeweb/cutsceneScene';
import { buildNativeCutsceneTestDownloads } from '../src/pokeweb/nativeCutsceneTest';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';

const [input,output]=process.argv.slice(2);
if(!input||!output?.endsWith('.nds'))throw new Error('Usage: vite-node scripts/verify-skeletal-timeline.ts CLEAN.nds NEW.nds');
globalThis.fetch=(async request=>{
  const url=request instanceof URL?request:new URL(request instanceof Request?request.url:String(request));
  if(url.protocol!=='file:')throw new Error('Only bundled local assets are expected.');
  return new Response(new Uint8Array(await fs.readFile(url)));
}) as typeof fetch;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const project=await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)),'timeline-audit.nds',{selectedNarcs:['headers']});
const library=await loadNativeCutsceneLibrary(project);createAspertiaCutsceneClone(project,library);
const original=openNativeCutscene(project,library,27),source=importNativeTimeline(original,'Aspertia skeletal timeline test');
const record=storeCutsceneScene(project,source);record.nativeFingerprint=nativeTimelineFingerprint(original);
// Normalize camera/events identically before comparing skeletal-only changes.
record.nativeFingerprint=applyNativeTimeline(project,library,source,record.nativeFingerprint);
const control=await buildNativeCutsceneTestDownloads(project),catalog=nativeSkeletalCatalog(original);
for(const [name,node] of [['intro_town_hito',3],['intro_hira_sp',1]] as const){
  const binding=catalog.find(b=>b.name===name);if(!binding)throw new Error(`Missing native fixture rig ${name}.`);
  const object=readNativeObject(original.files[binding.modelId],original.files[binding.animationId]);
  const track:SceneJointTrack={id:`${name}.track`,name:`${name} / ${object.nodes[node]}`,modelId:binding.modelId,animationId:binding.animationId,jointIndex:node,channels:['rotation','scale'],keys:[30,135,240].map((f,i)=>{
    const pose=structuredClone(object.animation.sample(f)[node]);
    if(i===1){pose.rotation=nitroMul(pose.rotation,nativeJointRotation([12,-18,25]));pose.scale=pose.scale.map((n,j)=>n*[1.2,1.45,.85][j]) as [number,number,number];}
    const key=captureSceneJoint(pose,`${name}.key-${i}`,f);key.easing=i===0?'smoothstep':'linear';return key;
  })};
  source.skeletal??=[];source.skeletal.push(track);
}
storeCutsceneScene(project,source,record.revision);
const savedRecord=project.cutsceneAuthoring!.scenes[source.id];
savedRecord.nativeFingerprint=applyNativeTimeline(project,library,source,savedRecord.nativeFingerprint!);
const first=new NARC(project.fileSystem!.replacements[library.fileId]);
savedRecord.nativeFingerprint=applyNativeTimeline(project,library,source,savedRecord.nativeFingerprint);
if(hash(first.save())!==hash(project.fileSystem!.replacements[library.fileId]))throw new Error('Reapplication was not deterministic.');
const result=await buildNativeCutsceneTestDownloads(project),exported=new NintendoDSRom(result.romBytes,{fileData:'view'}),before=new NintendoDSRom(control.romBytes,{fileData:'view'});
if(hash(exported.arm9)!==hash(before.arm9))throw new Error('Timeline skeletal edits changed ARM9.');
for(let id=0;id<exported.files.length;id++)if(id!==library.fileId&&hash(exported.files[id])!==hash(before.files[id]))throw new Error(`Unrelated ROM file ${id} changed.`);
const reloaded=await loadProjectFromRomBytes(result.romBytes,'timeline-roundtrip.nds',{selectedNarcs:['headers']}),next=await loadNativeCutsceneLibrary(reloaded),reopened=openNativeCutscene(reloaded,next,27);
const preview=previewNativeTimeline(openNativeCutscene(project,library,27),source,savedRecord.skeletalBaseline);
let maxRotationError=0,maxScaleError=0;
for(const t of source.skeletal!){
  const old=readNativeObject(original.files[t.modelId],original.files[t.animationId]),after=readNativeObject(reopened.files[t.modelId],reopened.files[t.animationId]);
  if(hash(preview.files[t.animationId])!==hash(reopened.files[t.animationId]))throw new Error('Preview and exported native clips differ.');
  for(let f=0;f<old.animation.frameCount;f++){
    const a=old.animation.sample(f),b=after.animation.sample(f),pose=sampleSceneJoint(t,f);
    for(let j=0;j<a.length;j++)if(j!==t.jointIndex&&JSON.stringify(a[j])!==JSON.stringify(b[j]))throw new Error('An unrelated joint changed.');
    const edited=b[t.jointIndex],expected=pose??a[t.jointIndex];
    if(JSON.stringify(edited.translation)!==JSON.stringify(a[t.jointIndex].translation))throw new Error('An unselected translation channel changed.');
    expected.rotation!.forEach((n,i)=>maxRotationError=Math.max(maxRotationError,Math.abs(n-edited.rotation[i])));
    expected.scale!.forEach((n,i)=>maxScaleError=Math.max(maxScaleError,Math.abs(n-edited.scale[i])));
  }
}
if(maxRotationError>.002||maxScaleError>1/4096)throw new Error('Native quantization exceeded its error budget.');
const originalArchive=new NARC(library.rom.files[library.fileId]),editedArchive=new NARC(exported.files[library.fileId]);
for(let id=0;id<originalArchive.files.length;id++)if(hash(originalArchive.files[id])!==hash(editedArchive.files[id]))throw new Error('An original sequence asset changed.');
const removed=structuredClone(source);removed.skeletal=[];storeCutsceneScene(project,removed,savedRecord.revision);
const removedRecord=project.cutsceneAuthoring!.scenes[source.id];removedRecord.nativeFingerprint=applyNativeTimeline(project,library,removed,removedRecord.nativeFingerprint!);
for(const t of source.skeletal!)if(hash(openNativeCutscene(project,library,27).files[t.animationId])!==hash(original.files[t.animationId]))throw new Error('Removing a track did not restore its original clip.');
const prefix=output.slice(0,-4),manifest={passed:true,tracks:source.skeletal!.map(t=>({name:t.name,modelId:t.modelId,animationId:t.animationId,jointIndex:t.jointIndex,keyFrames:t.keys.map(k=>k.frame)})),maxRotationError,maxScaleError,nativeAnimationOnly:true,deterministicReapply:true,trackRemovalRestoresOriginal:true,originalSequencesUnchanged:true,previewMatchesExport:true,romSha256:hash(result.romBytes),saveSha256:hash(result.saveBytes),trigger:result.trigger};
for(const [path,bytes] of [[output,result.romBytes],[`${prefix}.sav`,result.saveBytes],[`${prefix}.control.nds`,control.romBytes],[`${prefix}.control.sav`,control.saveBytes]] as const)await fs.writeFile(path,bytes,{flag:'wx'});
await fs.writeFile(`${prefix}.scene.json`,JSON.stringify(source,null,2)+'\n',{flag:'wx'});
await fs.writeFile(`${prefix}.manifest.json`,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(manifest,null,2));
