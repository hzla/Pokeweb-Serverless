import { NARC } from '../nds/narc';
import { readU32, writeU32 } from '../nds/binary';
import { getRomFileBytes, replaceRomFile } from './fileSystemModel';
import { nativeCameraPose, readNativeCameraTrack, writeNativeCameraPose } from './nativeCameraTrack';
import { openNativeCutscene, readNativeSceneDefinition, type NativeCutsceneDocument, type NativeCutsceneLibrary, type NativeSceneCue } from './nativeCutsceneModel';
import { CUTSCENE_MAX_OVERLAY_SIZE, CUTSCENE_ORIGINAL_SIZE, CUTSCENE_OVERLAY_BASE, readNativeCutsceneLayout } from './nativeCutsceneRegistry';
import { readCutsceneScene, sampleCutsceneCamera, type CutsceneScene, type SceneEvent, type SceneVector } from './cutsceneScene';
import type { ProjectState } from './projectStore';
import { DIALOGUE_CUE_MARKER, CHOICE_CUE_MARKER, JUMP_CUE_MARKER, type DialogueCueBinding } from './cutsceneDialogue';
import { stageSceneSkeletal } from './cutsceneSkeletal';
import type { SceneSkeletalBaseline } from './cutsceneScene';

export function nativeTimelineFingerprint(doc: NativeCutsceneDocument) {
  let hash = 2166136261;
  for (const n of doc.camera.bytes) hash = Math.imul(hash ^ n, 16777619);
  for (const n of new TextEncoder().encode(JSON.stringify([doc.definition.cues,doc.definition.startFade,doc.definition.endFade,doc.definition.fov]))) hash = Math.imul(hash ^ n, 16777619);
  return (hash >>> 0).toString(16);
}
export function importNativeTimeline(doc: NativeCutsceneDocument, name: string): CutsceneScene {
  const def = doc.definition, events: SceneEvent[] = def.cues.map((c,i) => ({ id: `native-event-${i+1}`, type: 'native.cue', ...structuredClone(c) }));
  if (def.startFade.duration) events.push({ id: 'opening-fade', type: 'screen.fade', frame: 0, durationFrames: def.startFade.duration, screens: 'both', from: def.startFade.white ? 'white' : 'black', to: 'clear' });
  if (def.endFade.duration) events.push({ id: 'closing-fade', type: 'screen.fade', frame: doc.camera.frameCount-def.endFade.duration, durationFrames: def.endFade.duration, screens: 'both', from: 'clear', to: def.endFade.white ? 'white' : 'black' });
  return readCutsceneScene({ format: 'pokeweb.cutscene', version: 2, target: 'W2-US', id: `native-${def.id}`, name, fps: 30, frameCount: doc.camera.frameCount,
    stage: { kind: 'native-template', sequenceId: def.id },
    camera: Array.from({ length: doc.camera.frameCount }, (_,frame) => { const pose = nativeCameraPose(doc.camera,frame); return { id: `camera-${frame}`, frame, position: pose.position as SceneVector, rotationDegrees: pose.rotation as SceneVector, easing: 'linear', fov: def.fov }; }),
    events, exit: { restoreCamera: true, restoreMusic: true, restorePlayerControl: true } });
}
export function lowerSceneEvents(scene: CutsceneScene,dialogue:Record<string,DialogueCueBinding>={}): NativeSceneCue[] {
  const level = { black: -16, clear: 0, white: 16 };
  return [...scene.events].sort((a,b) => a.frame-b.frame).flatMap(e => {
    let opcode: number, args: number[];
    switch (e.type) {
      // Opcode zero has a null native callback. Treat the authoring no-op as no command.
      case 'native.cue': return e.opcode === 0 ? [] : [{ opcode: e.opcode, frame: e.frame, args: [...e.args] }];
      case 'music.play': opcode = 6; args = [e.assetId]; break;
      case 'music.stop': return e.fadeFrames ? [
        { opcode: 8, frame: e.frame, args: [1,e.fadeFrames,0,0,0,0,0,0] },
        { opcode: 7, frame: Math.min(scene.frameCount-1,e.frame+e.fadeFrames), args: Array(8).fill(0) },
      ] : [{ opcode: 7, frame: e.frame, args: Array(8).fill(0) }];
      case 'sound.play': opcode = 1; args = [e.assetId,e.volume,0,0,0]; break;
      case 'screen.fade': opcode = 10; args = [e.screens === 'both' ? 3 : e.screens === 'top' ? 1 : 2,e.durationFrames,level[e.from],level[e.to]]; break;
      case 'dialogue': {const binding=dialogue[e.id];if(!binding)throw new Error('Apply this map timeline to allocate its dialogue text bank.');opcode=14;args=[binding.bankId,binding.messageId,DIALOGUE_CUE_MARKER+Number(e.waitForInput),e.durationFrames,2,15,28,8];break;}
      case 'dialogue.choice': {const binding=dialogue[e.id];if(!binding)throw new Error('Apply this map timeline to allocate its dialogue text bank.');opcode=14;args=[binding.bankId,binding.messageId,CHOICE_CUE_MARKER,e.choices.length,...e.choices.map(c=>c.targetFrame)];break;}
      case 'timeline.jump': opcode=14;args=[0,e.targetFrame,JUMP_CUE_MARKER];break;
    }
    return [{ opcode, frame: e.frame, args: Array.from({ length: 8 }, (_,i) => args[i] ?? 0) }];
  });
}
/** Bake the JSON camera and events for the existing native renderer and exporter. */
export function compileCutsceneTimeline(source: CutsceneScene,dialogue:Record<string,DialogueCueBinding>={}) {
  const scene = readCutsceneScene(source), bytes = new Uint8Array(8+scene.frameCount*24);
  if (scene.camera.some(k=>Math.abs(k.fov-scene.camera[0].fov)>1/4096)) throw new Error('Animated field of view cannot yet be compiled into the native projection format. Keep native FOV fixed; map preview can still animate it.');
  writeU32(bytes,0,scene.frameCount); bytes.set([0,1,1,0],4);
  const camera = readNativeCameraTrack(bytes), cues = lowerSceneEvents(scene,dialogue);
  for (let frame = 0; frame < scene.frameCount; frame++) {
    const pose = sampleCutsceneCamera(scene,frame);
    writeNativeCameraPose(camera,frame,{ position: pose.position, rotation: pose.rotationDegrees });
  }
  if (cues.length > 1023) throw new Error('The compiled timeline exceeds 1023 native commands. Reduce events or field-of-view animation.');
  const commands = new Uint8Array((cues.length+1)*40), v = new DataView(commands.buffer);
  [...cues.sort((a,b) => a.frame-b.frame),{ opcode: 19, frame: 0, args: Array(8).fill(0) }].forEach((c,i) => [c.opcode,c.frame,...c.args].forEach((n,j) => v.setInt32(i*40+j*4,n,true)));
  return { camera, cues, commands, fov: sampleCutsceneCamera(scene,0).fov };
}
export function assertNativeTimelineProjection(doc: NativeCutsceneDocument, source: CutsceneScene) {
  if (source.camera.some(k=>Math.abs(k.fov-doc.definition.fov)>1/4096)) throw new Error('Native FOV keyframes must retain the template value until projection authoring is calibrated. Existing raw projection cues are preserved.');
}
export function previewNativeTimeline(doc: NativeCutsceneDocument, source: CutsceneScene, skeletalBaseline?: SceneSkeletalBaseline) {
  assertNativeTimelineProjection(doc,source);
  const compiled = compileCutsceneTimeline(source);
  stageSceneSkeletal(doc,source,skeletalBaseline);
  doc.camera = compiled.camera; doc.definition = { ...doc.definition, cues: compiled.cues, fov: compiled.fov, startFade: { white: false, duration: 0 }, endFade: { white: false, duration: 0 } };
  return doc;
}
/** Variable command lists are owned by custom 27. Original descriptors and end commands stay intact. */
export function applyNativeTimeline(project: ProjectState, library: NativeCutsceneLibrary, source: CutsceneScene, expectedFingerprint: string) {
  if (source.stage.kind !== 'native-template' || source.stage.sequenceId !== 27) throw new Error('This compiler edits private native-template sequence 27. Use applyMapCutscene to package a map-stage source.');
  const doc = openNativeCutscene(project,library,27);
  if (nativeTimelineFingerprint(doc) !== expectedFingerprint) throw new Error('The native sequence changed after this timeline was imported. Reopen its native details before importing a fresh timeline.');
  const current = project.overlays[293] ?? library.overlayBytes, layout = readNativeCutsceneLayout(current);
  if (layout.kind !== 'expanded') throw new Error('Create private sequence 27 before applying its timeline.');
  if (Array.from({length:26},(_,i)=>readNativeSceneDefinition(current,CUTSCENE_OVERLAY_BASE,i+1).cameraId).includes(doc.definition.cameraId)) throw new Error('Sequence 27 no longer owns a private camera. Its timeline cannot overwrite a shared camera.');
  assertNativeTimelineProjection(doc,source);
  const compiled = compileCutsceneTimeline(source), descriptor = layout.tableOffset+27*20;
  const record=project.cutsceneAuthoring?.scenes[source.id];
  const skeletalBaseline=stageSceneSkeletal(doc,source,record?.skeletalBaseline);
  const originalAssets=new Set(Array.from({length:26},(_,i)=>readNativeSceneDefinition(current,CUTSCENE_OVERLAY_BASE,i+1)).flatMap(d=>d.resources.flatMap(r=>r.bundles.flatMap(b=>b.flat()))));
  for(const id of doc.assets?.keys()??[])if(originalAssets.has(id))throw new Error('This joint clip is shared with an original sequence. Create a private clone before exporting skeletal tracks.');
  const oldAt = readU32(current,descriptor+4)-CUTSCENE_OVERLAY_BASE, capacity = (doc.definition.cues.length+1)*40;
  if (oldAt < CUTSCENE_ORIGINAL_SIZE) throw new Error('Sequence 27 no longer owns a private event program.');
  const at = compiled.commands.length <= capacity ? oldAt : (current.length+3)&~3;
  const length = Math.max(current.length,at+compiled.commands.length);
  if (length > CUTSCENE_MAX_OVERLAY_SIZE) throw new Error('The event program exceeds the supported native overlay budget.');
  const overlay = new Uint8Array(length); overlay.set(current); overlay.set(compiled.commands,at);
  writeU32(overlay,descriptor+4,CUTSCENE_OVERLAY_BASE+at); writeU32(overlay,CUTSCENE_ORIGINAL_SIZE+8,length);
  const params = doc.definition.paramsOffset;
  overlay.fill(0,params+78,params+82); overlay[params+79]=1; new DataView(overlay.buffer).setInt32(params+12,Math.round(compiled.fov*4096),true);
  readNativeCutsceneLayout(overlay);
  const archive = new NARC(getRomFileBytes(project,library.rom,library.fileId)); archive.files[doc.definition.cameraId] = compiled.camera.bytes;
  for(const [id,edit] of doc.assets??[])archive.files[id]=edit.bytes;
  const archiveBytes = archive.save();
  replaceRomFile(project,library.rom,library.fileId,archiveBytes); project.overlays[293] = overlay;
  project.patches ??= { dirtyOverlayIds: [] }; if (!project.patches.dirtyOverlayIds.includes(293)) project.patches.dirtyOverlayIds.push(293);
  library.overlayBytes = overlay;
  if(record)record.skeletalBaseline=skeletalBaseline;
  return nativeTimelineFingerprint(openNativeCutscene(project,library,27));
}
