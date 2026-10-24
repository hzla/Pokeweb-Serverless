import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { loadNativeCutsceneLibrary, openNativeCutscene, nativeSceneGroups, saveNativeCutsceneCamera } from '../src/pokeweb/nativeCutsceneModel';
import { createAspertiaCutsceneClone } from '../src/pokeweb/nativeCutsceneClone';
import { buildNativeCutsceneTestDownloads } from '../src/pokeweb/nativeCutsceneTest';
import { readNativeObject, stageNativeObjectTransforms, nativeJointRotation, type NativeJointChange } from '../src/pokeweb/nativeObjectMovement';
import { nitroMul, type NitroVec3 } from '../src/pokeweb/nitroAnimation';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';
import { writeNativeJointTracks } from '../src/pokeweb/nativeJointAnimation';

const [input, output] = process.argv.slice(2);
if (!input || !output?.endsWith('.nds')) throw new Error('Usage: vite-node scripts/verify-native-skeletal.ts CLEAN.nds NEW_TEST.nds');
globalThis.fetch = (async request => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== 'file:') throw new Error('Only bundled local test assets are expected.');
  return new Response(new Uint8Array(await fs.readFile(url)));
}) as typeof fetch;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), 'skeletal-audit.nds', { selectedNarcs: ['headers'] });
const library = await loadNativeCutsceneLibrary(project), verifiedBindings = new Set<string>();
for (const definition of library.definitions) {
  const document = openNativeCutscene(project, library, definition.id);
  for (const root of definition.resources) for (const variant of root.bundles) for (const ids of variant) {
    const member = (stamp: string) => ids.find(id => String.fromCharCode(...document.files[id].subarray(0, 4)) === stamp), model = member('BMD0'), clip = member('BCA0');
    if (model === undefined || clip === undefined || verifiedBindings.has(`${model}:${clip}`)) continue;
    const object = readNativeObject(document.files[model], document.files[clip]), node = object.nodes.length - 1, originalHash = hash(document.files[clip]);
    const poses = Array.from({ length: object.animation.frameCount }, (_, f) => object.animation.sample(f)[node]), rotation = poses.map(p => p.rotation), scale = poses.map(p => p.scale);
    rotation[0] = nativeJointRotation([8, 13, -21]); scale[0] = [1.2, .8, 1.5];
    const rewritten = writeNativeJointTracks(document.files[clip], object.bases, new Map([[node, { rotation, scale }]]));
    readNativeObject(document.files[model], rewritten);
    if (hash(document.files[clip]) !== originalHash) throw new Error('A skeletal writer mutated its source buffer.');
    verifiedBindings.add(`${model}:${clip}`);
  }
}
createAspertiaCutsceneClone(project, library);
const control = await buildNativeCutsceneTestDownloads(project), doc = openNativeCutscene(project, library, 27), changed = new Map<number, Uint8Array>(), audits: unknown[] = [];
for (const index of [2, 5]) {
  const group = nativeSceneGroups(doc)[index], find = (s: string) => group.find(id => String.fromCharCode(...doc.files[id].subarray(0, 4)) === s)!;
  const modelId = find('BMD0'), animationId = find('BCA0'), before = readNativeObject(doc.files[modelId], doc.files[animationId]);
  const node = index === 2 ? 3 : 1, changes = new Map<number, NativeJointChange>();
  for (let f = 30; f <= 240; f++) {
    const pose = before.animation.sample(f)[node], t = Math.sin(Math.PI * (f - 30) / 210);
    changes.set(f, { translation: [pose.translation[0], pose.translation[1] + 2 * t, pose.translation[2]], rotation: nitroMul(pose.rotation, nativeJointRotation([12 * t, -18 * t, 25 * t])), scale: pose.scale.map((s, i) => s * (1 + [.2, .45, -.15][i] * t)) as NitroVec3 });
  }
  stageNativeObjectTransforms(doc, modelId, animationId, node, changes);
  const after = readNativeObject(doc.files[modelId], doc.files[animationId]); let maxRotationError = 0, maxScaleError = 0;
  for (let f = 0; f < before.animation.frameCount; f++) {
    const a = before.animation.sample(f), b = after.animation.sample(f), edit = changes.get(f);
    for (let j = 0; j < a.length; j++) if (j !== node && JSON.stringify(a[j]) !== JSON.stringify(b[j])) throw new Error('An unrelated skeletal joint changed.');
    const expected = edit ?? a[node];
    for (let k = 0; k < 16; k++) maxRotationError = Math.max(maxRotationError, Math.abs(b[node].rotation[k] - expected.rotation![k]));
    for (let k = 0; k < 3; k++) {
      maxScaleError = Math.max(maxScaleError, Math.abs(b[node].scale[k] - expected.scale![k]));
      if (Math.abs(b[node].translation[k] - expected.translation![k]) > 1 / 4096) throw new Error('Translation sample mismatch.');
      if (Math.abs(b[node].scale[k] * b[node].inverseScale[k] - 1) > .001) throw new Error('Scale/inverse-scale sample mismatch.');
    }
  }
  if (maxRotationError > .002 || maxScaleError > 1 / 4096) throw new Error('Native transform quantization exceeded its error budget.');
  changed.set(animationId, doc.files[animationId].slice()); audits.push({ model: before.name, joint: before.nodes[node], frames: before.animation.frameCount, maxRotationError, maxScaleError, bytes: doc.files[animationId].length });
}
saveNativeCutsceneCamera(project, doc);
const result = await buildNativeCutsceneTestDownloads(project), exported = new NintendoDSRom(result.romBytes, { fileData: 'view' }), originalControl = new NintendoDSRom(control.romBytes, { fileData: 'view' });
if (hash(exported.arm9) !== hash(originalControl.arm9)) throw new Error('Skeletal edits changed ARM9.');
for (let id = 0; id < exported.files.length; id++) if (id !== library.fileId && hash(exported.files[id]) !== hash(originalControl.files[id])) throw new Error(`Skeletal edits changed unrelated ROM file ${id}.`);
const sourceArchive = new NARC(library.rom.files[library.fileId]), controlArchive = new NARC(originalControl.files[library.fileId]), editedArchive = new NARC(exported.files[library.fileId]);
if (controlArchive.files.length !== editedArchive.files.length) throw new Error('A skeletal edit changed the scene archive member count.');
for (let id = 0; id < editedArchive.files.length; id++) {
  if (!changed.has(id) && hash(editedArchive.files[id]) !== hash(controlArchive.files[id])) throw new Error('An unrelated scene asset changed.');
  if (id < sourceArchive.files.length && hash(editedArchive.files[id]) !== hash(sourceArchive.files[id])) throw new Error('An original sequence asset changed.');
}
const reloaded = await loadProjectFromRomBytes(result.romBytes, 'skeletal-reloaded.nds', { selectedNarcs: ['headers'] }), next = await loadNativeCutsceneLibrary(reloaded), reopened = openNativeCutscene(reloaded, next, 27);
for (const [id, bytes] of changed) if (hash(reopened.files[id]) !== hash(bytes)) throw new Error('ROM export lost a skeletal edit.');
const prefix = output.slice(0, -4);
await fs.writeFile(output, result.romBytes, { flag: 'wx' }); await fs.writeFile(`${prefix}.sav`, result.saveBytes, { flag: 'wx' });
await fs.writeFile(`${prefix}.control.nds`, control.romBytes, { flag: 'wx' }); await fs.writeFile(`${prefix}.control.sav`, control.saveBytes, { flag: 'wx' });
const manifest = { passed: true, nativeBindingsVerified: verifiedBindings.size, animations: audits, nativeAnimationOnly: true, originalSequencesUnchanged: true, romSha256: hash(result.romBytes), saveSha256: hash(result.saveBytes), trigger: result.trigger, instructions: 'Continue with the matching save and walk one tile down to play sequence 27. Existing original sequences remain unchanged.' };
await fs.writeFile(`${prefix}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(manifest, null, 2));
