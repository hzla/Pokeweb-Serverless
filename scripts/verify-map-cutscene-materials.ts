import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { loadNativeCutsceneLibrary, openNativeCutscene, compileNativeCutscene } from '../src/pokeweb/nativeCutsceneModel';
import { applyMapCutscene } from '../src/pokeweb/cutsceneMapCompiler';
import { readCutsceneScene, storeCutsceneScene } from '../src/pokeweb/cutsceneScene';
import { readNativeCutsceneLayout } from '../src/pokeweb/nativeCutsceneRegistry';
import { readNitroTexturePatterns } from '../src/pokeweb/mapTextureAnimation';
import { readNitroTextureAnimation } from '../src/pokeweb/nitroAnimation';
const [input, previousRom] = process.argv.slice(2);
if (!input)
  throw new Error('Usage: vite-node scripts/verify-map-cutscene-materials.ts CLEAN_W2.nds [PREVIOUS_STATIC_TEST.nds]');
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const source = readCutsceneScene(JSON.parse(await fs.readFile('examples/cutscenes/route13.timeline.scene.json', 'utf8')));
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), 'material-audit.nds', { selectedNarcs: ['headers'] });
const library = await loadNativeCutsceneLibrary(project);
storeCutsceneScene(project, source);
const result = await applyMapCutscene(project, library, source), compiled = compileNativeCutscene(result.document);
assert.equal(result.binding.manifest.srtTracks, 33);
assert.equal(result.binding.manifest.patternTracks, 16);
let scrollingMaterials = 0, swappingMaterials = 0;
result.document.definition.resources.forEach((root, modelIndex) => {
  const group = root.bundles[0][0], assets = group.map(id => result.document.files[id]);
  const srt = assets.find(b => String.fromCharCode(...b.subarray(0, 4)) === 'BTA0')!, pat = assets.find(b => String.fromCharCode(...b.subarray(0, 4)) === 'BTP0')!;
  assert.equal(readNitroTextureAnimation(srt).frameCount, source.frameCount);
  const patterns = readNitroTexturePatterns(pat)[0];
  assert.equal(patterns.frameCount, source.frameCount);
  const model = compiled.models[modelIndex];
  model.sample(0);
  const positions = model.primitives.map(p => p.positions.slice()), before = model.primitives.map(p => p.uvs!.slice());
  model.sample(31);
  model.primitives.forEach((p, i) => {
    assert.deepEqual(p.positions, positions[i], 'Material animation does not move geometry');
    if (!p.uvs!.every((v, j) => Math.abs(v - before[i][j]) < 1e-5))
      scrollingMaterials++;
  });
  for (const track of patterns.tracks) {
    const primitive = model.primitives.find(p => p.material.name === track.name)!;
    assert.ok(primitive);
    const images = new Set<string>();
    for (const frame of track.keys.map(k => k.frame)) {
      model.sample(frame);
      images.add(hash(primitive.material.texture!.rgba));
    }
    assert.ok(images.size > 1, `Texture track ${track.name} must visibly change its pixels`);
    swappingMaterials++;
  }
});
assert.ok(scrollingMaterials >= 33);
assert.equal(swappingMaterials, 16);
let staticUpgrade = false;
if (previousRom) {
  const old = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(previousRom)), 'previous-static.nds', { selectedNarcs: ['headers'] });
  const oldLibrary = await loadNativeCutsceneLibrary(old), oldSource = readCutsceneScene(JSON.parse(await fs.readFile(previousRom.replace(/\.nds$/, '.scene.json'), 'utf8')));
  const binding = JSON.parse(await fs.readFile(previousRom.replace(/\.nds$/, '.manifest.json'), 'utf8')).binding;
  const record = storeCutsceneScene(old, oldSource);
  record.mapBinding = binding;
  const originals = oldLibrary.definitions.filter(d => d.id !== binding.sequenceId).map(d => structuredClone(d)), archive = openNativeCutscene(old, oldLibrary, binding.sequenceId).files;
  const kept = archive.slice(0, Math.min(...binding.memberIds)).map(hash), oldCount = readNativeCutsceneLayout(oldLibrary.overlayBytes).count;
  const upgraded = await applyMapCutscene(old, oldLibrary, oldSource);
  assert.equal(upgraded.binding.sequenceId, binding.sequenceId);
  assert.equal(readNativeCutsceneLayout(oldLibrary.overlayBytes).count, oldCount);
  assert.deepEqual(upgraded.document.files.slice(0, kept.length).map(hash), kept);
  for (const original of originals)
    assert.deepEqual(openNativeCutscene(old, oldLibrary, original.id).definition, original);
  const overlay = old.overlays[293]!.slice(), members = upgraded.document.files.map(hash);
  await applyMapCutscene(old, oldLibrary, oldSource);
  assert.deepEqual(old.overlays[293], overlay);
  assert.deepEqual(openNativeCutscene(old, oldLibrary, binding.sequenceId).files.map(hash), members);
  staticUpgrade = true;
}
console.log(JSON.stringify({ passed: true, scrollingMaterials, swappingMaterials, nativeFrameCounts: source.frameCount, staticUpgrade, manifest: result.binding.manifest }));
