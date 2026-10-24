import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { loadNativeCutsceneLibrary, openNativeCutscene, compileNativeCutscene } from '../src/pokeweb/nativeCutsceneModel';
import { applyMapCutscene } from '../src/pokeweb/cutsceneMapCompiler';
import { readCutsceneScene, storeCutsceneScene } from '../src/pokeweb/cutsceneScene';
import { buildNativeCutsceneTestDownloads } from '../src/pokeweb/nativeCutsceneTest';
import { createProjectDocument } from '../src/pokeweb/projectDocument';
import { openProjectSession } from '../src/pokeweb/projectSession';
import { NARC } from '../src/nds/narc';
import { getRomFileBytes } from '../src/pokeweb/fileSystemModel';
import { decodeGen5TextBank } from '../src/pokeweb/text';
import { formatSceneDialogue, formatSceneChoice, type SceneMessage } from '../src/pokeweb/cutsceneDialogue';
import { cutsceneDialogueRuntimeOffset } from '../src/pokeweb/cutsceneDialogueRuntime';
const [input, output, scenePath = 'examples/cutscenes/route13.timeline.scene.json'] = process.argv.slice(2);
if (!input || !output)
  throw new Error('Usage: vite-node scripts/build-map-cutscene-test.ts INPUT.nds NEW_OUTPUT.nds [SCENE.json]');
globalThis.fetch = (async (request) => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== 'file:')
    throw new Error('Expected local runtime asset.');
  return new Response(new Uint8Array(await fs.readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), 'map-stage-test.nds', { selectedNarcs: ['headers'] });
const library = await loadNativeCutsceneLibrary(project), originals = library.definitions.map(d => structuredClone(d)), originalFiles = openNativeCutscene(project, library, 5).files.map(b => createHash('sha256').update(b).digest('hex')), source = readCutsceneScene(JSON.parse(await fs.readFile(scenePath, 'utf8')));
const messageFileId=library.rom.fileId('a/0/0/2'),originalBanks=new NARC(getRomFileBytes(project,library.rom,messageFileId)).files.map(b=>createHash('sha256').update(b).digest('hex'));
storeCutsceneScene(project, source);
const result = await applyMapCutscene(project, library, source), compiled = compileNativeCutscene(result.document);
compiled.sample(150);
assert.equal(compiled.models.length, result.binding.manifest.models);
const first = project.overlays[293]!.slice(), members = result.document.files.map(b => createHash('sha256').update(b).digest('hex'));
await applyMapCutscene(project, library, source);
assert.deepEqual(project.overlays[293], first, 'Idempotent registry');
assert.deepEqual(openNativeCutscene(project, library, result.binding.sequenceId).files.map(b => createHash('sha256').update(b).digest('hex')), members, 'Idempotent assets');
for (const original of originals)
  assert.deepEqual(openNativeCutscene(project, library, original.id).definition, original);
const saved = openProjectSession(structuredClone(createProjectDocument(project, true)));
assert.deepEqual(saved.cutsceneAuthoring, project.cutsceneAuthoring);
const download = await buildNativeCutsceneTestDownloads(project, result.binding.sequenceId), base = output.replace(/\.nds$/, '');
const reopened = await loadProjectFromRomBytes(download.romBytes, 'exported.nds', { selectedNarcs: ['headers'] }), again = await loadNativeCutsceneLibrary(reopened), doc = openNativeCutscene(reopened, again, result.binding.sequenceId);
assert.equal(doc.definition.zoneId, source.stage.kind==='map'?source.stage.zoneId:370);
assert.equal(doc.camera.frameCount, source.frameCount);
assert.equal(compileNativeCutscene(doc).models.length, result.binding.manifest.models);
const dialogueEvents=source.events.filter((e):e is SceneMessage=>e.type==='dialogue'||e.type==='dialogue.choice');
if(dialogueEvents.length){
  const bankId=result.binding.dialogue!.bankId,banks=new NARC(again.rom.files[messageFileId]);
  assert.deepEqual(banks.files.slice(0,originalBanks.length).map(b=>createHash('sha256').update(b).digest('hex')),originalBanks,'Original message banks unchanged');
  assert.deepEqual(decodeGen5TextBank(banks.files[bankId]).map(e=>e[1]),dialogueEvents.flatMap(e=>e.type==='dialogue'?[formatSceneDialogue(source,e).nativeText]:e.choices.map((_,i)=>formatSceneChoice(source,e,i).nativeText)),'Dialogue message round trip');
  assert.notEqual(cutsceneDialogueRuntimeOffset(again.overlayBytes),undefined,'Dialogue adapter exported');
  assert.equal(doc.definition.cues.filter(c=>c.opcode===14).length,dialogueEvents.length+source.events.filter(e=>e.type==='timeline.jump').length);
}
for (const original of originals)
  assert.deepEqual(openNativeCutscene(reopened, again, original.id).definition, original);
assert.deepEqual(doc.files.slice(0, originalFiles.length).map(b => createHash('sha256').update(b).digest('hex')), originalFiles, 'Original native archive members unchanged');
const binding = project.cutsceneAuthoring!.scenes[source.id].mapBinding!, goodOverlay = project.overlays[293]!;
project.overlays[293] = goodOverlay.slice();
project.overlays[293]![binding.overlayStart + 80] ^= 1;
await assert.rejects(() => applyMapCutscene(project, library, source), /changed outside/);
project.overlays[293] = goodOverlay;
const second = structuredClone(source);
second.id += '-allocation-audit';
storeCutsceneScene(reopened, second);
const secondResult = await applyMapCutscene(reopened, again, second);
assert.equal(secondResult.binding.sequenceId, binding.sequenceId + 1);
assert.deepEqual(openNativeCutscene(reopened, again, binding.sequenceId).definition, doc.definition, 'A second scene preserves the first binding');
const updated = structuredClone(source);
updated.camera[1].position[0] += 16;
const updatedDialogue=updated.events.find((e):e is SceneMessage=>e.type==='dialogue'||e.type==='dialogue.choice');if(updatedDialogue)updatedDialogue.text='Welcome to Route 13.';
storeCutsceneScene(project, updated);
const edited = await applyMapCutscene(project, library, updated);
assert.equal(edited.binding.sequenceId, binding.sequenceId);
assert.deepEqual(edited.binding.memberIds.slice(0,binding.memberIds.length), binding.memberIds, 'Camera edits retain existing member IDs and may append newly visible surfaces.');
assert.notDeepEqual(edited.document.camera.bytes, result.document.camera.bytes);
if(dialogueEvents.length){assert.equal(edited.binding.dialogue!.bankId,result.binding.dialogue!.bankId);assert.notEqual(edited.binding.dialogue!.hash,result.binding.dialogue!.hash);}
storeCutsceneScene(project, source);
await applyMapCutscene(project, library, source);
assert.deepEqual(project.overlays[293], first, 'Restored source reuses its allocation');
await fs.writeFile(output, download.romBytes, { flag: 'wx' });
await fs.writeFile(`${base}.sav`, download.saveBytes, { flag: 'wx' });
await fs.writeFile(`${base}.scene.json`, JSON.stringify(source, null, 2) + '\n', { flag: 'wx' });
await fs.writeFile(`${base}.manifest.json`, JSON.stringify({ binding: result.binding, trigger: download.trigger, checks: { idempotent: true, projectPersistence: true, exportReopened: true, originalSequencesUnchanged: true, originalAssetsUnchanged: true, staleWriteRejected: true, independentAdditionalId: true, cameraRecompile: true,...(dialogueEvents.length?{originalMessageBanksUnchanged:true,dialogueTextRoundTrip:true,dialogueBankReused:true,dialogueAdapterExported:true}:{}) }, romSha256: createHash('sha256').update(download.romBytes).digest('hex') }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, output, binding: result.binding, trigger: download.trigger }));
