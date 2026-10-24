import fs from "node:fs";
import { createHash } from "node:crypto";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { compileNativeCutscene, loadNativeCutsceneLibrary, nativeSceneGroups, openNativeCutscene, saveNativeCutsceneCamera } from "../src/pokeweb/nativeCutsceneModel";
import { nativeCameraPose, writeNativeCameraPose } from "../src/pokeweb/nativeCameraTrack";
import { readNativeObject, stageNativeObjectPositions } from "../src/pokeweb/nativeObjectMovement";
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: npx vite-node scripts/verify-native-cutscene.ts SOURCE.nds [OUTPUT.nds]");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const project = await loadProjectFromRomBytes(fs.readFileSync(sourcePath), "cutscene-verification.nds", { selectedNarcs: ["headers"] });
const library = await loadNativeCutsceneLibrary(project), expected = new Map<number, Uint8Array>();
let totalVariants = 0;
for (const definition of library.definitions) {
  const doc = openNativeCutscene(project, library, definition.id), camera = doc.camera, baseline = camera.bytes.slice();
  for (let f = 0; f < camera.frameCount; f++) writeNativeCameraPose(camera, f, nativeCameraPose(camera, f));
  if (hash(camera.bytes) !== hash(baseline)) throw new Error(`Sequence ${definition.id}: no-op camera round trip changed bytes.`);
  const seasons = definition.resources.some(r => r.selection === 3) ? 4 : 1, genders = definition.resources.some(r => r.selection === 1) ? 2 : 1;
  const parameters = Math.max(1, ...definition.resources.filter(r => r.selection === 2).map(r => r.bundles.length));
  const days = Math.max(...definition.resources.flatMap(r => r.bundles.map(b => b.length))), seen = new Set<string>();
  for (let s = 0; s < seasons; s++) for (let g = 0; g < genders; g++) for (let p = 0; p < parameters; p++) for (let d = 0; d < days; d++) {
    const signature = JSON.stringify(nativeSceneGroups(doc, s, d, g, p)); if (seen.has(signature)) continue; seen.add(signature);
    const scene = compileNativeCutscene(doc, s, d, g, p);
    const frames = new Set([0, Math.min(60, camera.frameCount - 1), Math.floor(camera.frameCount / 2), camera.frameCount - 1, ...definition.cues.filter(c => c.opcode === 18).map(c => c.frame)]);
    for (const frame of frames) {
      scene.sample(frame);
      for (const model of scene.models) for (const primitive of model.primitives) for (const buffer of [primitive.positions, primitive.colors!, primitive.uvs!]) if (buffer.some(n => !Number.isFinite(n))) throw new Error(`Nonfinite scene buffer: sequence ${definition.id}, variant ${signature}, frame ${frame}.`);
    }
  }
  totalVariants += seen.size;
  const frame = Math.min(60, camera.frameCount - 1), pose = nativeCameraPose(camera, frame); pose.position[0] += .25;
  writeNativeCameraPose(camera, frame, pose); saveNativeCutsceneCamera(project, doc); expected.set(definition.cameraId, camera.bytes.slice());
  const reloaded = openNativeCutscene(project, library, definition.id);
  if (hash(reloaded.camera.bytes) !== hash(camera.bytes)) throw new Error("Project reload lost camera edits.");
  console.log(`Sequence ${definition.id}: ${camera.frameCount} frames; ${seen.size} unique resource variants; camera save/reload passed.`);
}
const doc = openNativeCutscene(project, library, 5);
for (const objectIndex of [2, 5]) {
  const group = nativeSceneGroups(doc)[objectIndex], member = (stamp: string) => group.find(id => String.fromCharCode(...doc.files[id].subarray(0, 4)) === stamp)!;
  const modelId = member("BMD0"), animationId = member("BCA0"), original = readNativeObject(doc.files[modelId], doc.files[animationId]);
  const node = [...original.animatedNodes].find(n => n > 0) ?? 0, frame = 60, pose = original.animation.sample(frame)[node].translation;
  stageNativeObjectPositions(doc, modelId, animationId, node, new Map([[frame, [pose[0] + .5, pose[1], pose[2]]]]));
  const edited = readNativeObject(doc.files[modelId], doc.files[animationId]);
  for (const f of [0, frame, 500, 999]) {
    const before = original.animation.sample(f), after = edited.animation.sample(f);
    for (let n = 0; n < before.length; n++) {
      if (JSON.stringify(before[n].rotation) !== JSON.stringify(after[n].rotation) || JSON.stringify(before[n].scale) !== JSON.stringify(after[n].scale)) throw new Error("Movement edit changed rotation or scale.");
      if (n !== node && JSON.stringify(before[n].translation) !== JSON.stringify(after[n].translation)) throw new Error("Movement edit changed another joint.");
    }
  }
  expected.set(animationId, doc.files[animationId].slice());
}
doc.definition.cues.find(c => c.opcode === 6)!.args[0] += 1;
doc.definition.cues.find(c => c.opcode === 10)!.args[1] = 40;
doc.definition.startFade.duration = 31;
saveNativeCutsceneCamera(project, doc);
const exported = await exportModifiedRom(project, { forDsi: false }), result = new NintendoDSRom(exported, { fileData: "view" }), source = library.rom;
if (hash(result.arm9) !== hash(source.arm9)) throw new Error("Cutscene edits changed ARM9.");
const oldOverlay = source.loadArm9Overlays([293]).get(293)!, newOverlay = result.loadArm9Overlays([293]).get(293)!;
if (newOverlay.data.length !== oldOverlay.data.length || newOverlay.ramAddress !== oldOverlay.ramAddress) throw new Error(`Cue edits changed the overlay memory layout: ${oldOverlay.data.length}/${oldOverlay.ramAddress} -> ${newOverlay.data.length}/${newOverlay.ramAddress}.`);
for (let i = 0; i < oldOverlay.data.length; i++) if (oldOverlay.data[i] !== newOverlay.data[i] && !(i >= doc.definition.commandsOffset && i < doc.definition.commandsOffset + doc.cueBaseline!.length) && !(i >= doc.definition.paramsOffset + 78 && i < doc.definition.paramsOffset + 82)) throw new Error(`Unrelated overlay byte ${i} changed.`);
const allowed = new Set([library.fileId, oldOverlay.fileId]);
for (let id = 0; id < source.files.length; id++) if (hash(source.files[id]) !== hash(result.files[id]) && !allowed.has(id)) throw new Error(`Unrelated ROM file ${id} changed.`);
const before = new NARC(source.getFileByName("a/1/5/8")), after = new NARC(result.getFileByName("a/1/5/8"));
if (before.files.length !== after.files.length) throw new Error("Scene archive member count changed.");
for (let id = 0; id < before.files.length; id++) if (hash(after.files[id]) !== hash(expected.get(id) ?? before.files[id])) throw new Error(`Scene resource ${id} changed unexpectedly.`);
const reopened = await loadProjectFromRomBytes(exported, "cutscene-export-reloaded.nds", { selectedNarcs: ["headers"] }), reopenedLibrary = await loadNativeCutsceneLibrary(reopened);
for (const definition of reopenedLibrary.definitions) {
  const scene = openNativeCutscene(reopened, reopenedLibrary, definition.id);
  if (hash(scene.camera.bytes) !== hash(expected.get(definition.cameraId)!)) throw new Error(`Exported camera ${definition.cameraId} lost edits.`);
  if (definition.id === 5 && (definition.startFade.duration !== 31 || definition.cues.find(c => c.opcode === 10)!.args[1] !== 40 || definition.cues.find(c => c.opcode === 6)!.args[0] !== doc.definition.cues.find(c => c.opcode === 6)!.args[0])) throw new Error("Exported cue/fade edits were lost.");
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], exported);
console.log(`PASS: all 26 sequences; ${totalVariants} unique resource combinations; all cameras, a character, petals, music and fades exported/reopened. ${before.files.length - expected.size} unrelated scene members preserved; only the scene archive and overlay 293 changed.`);
