import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { readFieldScene, storeFieldScene } from '../src/pokeweb/fieldScene';
import { buildFieldSceneTestDownloads } from '../src/pokeweb/fieldSceneTest';
import { NintendoDSRom } from '../src/nds/rom';
import { createProjectDocument } from '../src/pokeweb/projectDocument';
import { openProjectSession } from '../src/pokeweb/projectSession';
import {addRomFile} from '../src/pokeweb/fileSystemModel';
import { NARC } from '../src/nds/narc';
import { decodeGen5TextBank } from '../src/pokeweb/text';
import { formatFieldDialogue } from '../src/pokeweb/fieldSceneDialogue';
import {extractGameFreakContainer} from '../src/pokeweb/map3dModel';

const [input, output, scenePath = 'examples/cutscenes/route13.field-scene.json',audioPath] = process.argv.slice(2);
if (!input || !output || !output.endsWith('.nds')) throw new Error('Usage: vite-node scripts/build-field-scene-test.ts INPUT.nds NEW_OUTPUT.nds [SCENE.json]');
globalThis.fetch = (async request => new Response(new Uint8Array(await fs.readFile(new URL(String(request)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), 'field-tour.nds', { selectedNarcs: ['headers'] });
const scene = readFieldScene(JSON.parse(await fs.readFile(scenePath, 'utf8')));
if(audioPath&&scene.music)addRomFile(project,scene.music.path,new Uint8Array(await fs.readFile(audioPath)));
storeFieldScene(project, scene);
assert.deepEqual(openProjectSession(structuredClone(createProjectDocument(project, true))).fieldScenes, project.fieldScenes);
const dl = await buildFieldSceneTestDownloads(project, scene), rom = new NintendoDSRom(dl.romBytes, { fileData: 'view' });
const original = new NintendoDSRom(project.originalRomBytes!, { fileData: 'view' });
for(const path of ['a/0/0/9','a/1/2/5','a/0/4/8'])assert.deepEqual(rom.getFileByName(path),original.getFileByName(path),'Field collision/matrix/actor resources unchanged: '+path);
if(scene.trees?.length){const before=new NARC(original.getFileByName('a/0/0/8')),after=new NARC(rom.getFileByName('a/0/0/8'));for(let i=0;i<before.files.length;i++)if(i!==281)assert.deepEqual(after.files[i],before.files[i]);assert.deepEqual(extractGameFreakContainer(after.files[281]).files.slice(1),extractGameFreakContainer(before.files[281]).files.slice(1));}else assert.deepEqual(rom.getFileByName('a/0/0/8'),original.getFileByName('a/0/0/8'));
// Quick launch has separate startup patches. Ordinary tours are archive data; seasonal tours also install the guarded field environment adapter.
if(!scene.environment)assert.deepEqual(rom.loadArm9Overlays([36]).get(36)!.data, original.loadArm9Overlays([36]).get(36)!.data);
else assert.notDeepEqual(rom.loadArm9Overlays([112]).get(112)!.data,original.loadArm9Overlays([112]).get(112)!.data);
assert.deepEqual(rom.loadArm9Overlays([293]).get(293)!.data, original.loadArm9Overlays([293]).get(293)!.data);
const storyBefore=new NARC(original.getFileByName('a/0/0/3')).files,storyAfter=new NARC(rom.getFileByName('a/0/0/3')).files;
const appendedStoryBanks=new Set(scene.steps.filter(s=>s.type==='dialogue'&&s.window==='narration').map(s=>dl.dialogue.bindings[s.id].bankId));
for(let i=0;i<storyBefore.length;i++)if(appendedStoryBanks.has(i)){assert.deepEqual(decodeGen5TextBank(storyAfter[i]).slice(0,decodeGen5TextBank(storyBefore[i]).length),decodeGen5TextBank(storyBefore[i]));}else assert.deepEqual(storyAfter[i],storyBefore[i]);
assert.deepEqual(rom.getFileByName('a/0/0/2'),original.getFileByName('a/0/0/2'));
for(const step of scene.steps)if(step.type==='dialogue'){const binding=dl.dialogue.bindings[step.id],actual=decodeGen5TextBank(storyAfter[binding.bankId]);assert.deepEqual(binding.messageIds.map(id=>actual[id][1]),formatFieldDialogue(scene,step).pages.map(page=>page.join('\\n')));}

const base = output.slice(0, -4), hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
await fs.writeFile(output, dl.romBytes, { flag: 'wx' });
await fs.writeFile(`${base}.sav`, dl.saveBytes, { flag: 'wx' });
await fs.writeFile(`${base}.scene.json`, JSON.stringify(scene, null, 2) + '\n', { flag: 'wx' });
await fs.writeFile(`${base}.script.rb`, dl.source, { flag: 'wx' });
await fs.writeFile(`${base}.manifest.json`, JSON.stringify({ sceneId: scene.id, environment:dl.environment, trigger: dl.trigger, entry: scene.entry, actorIds:dl.actorIds, dialogue:{...dl.dialogue,archive:'a/0/0/3'}, checks: { projectPersistence: true, fieldOverlayUnchanged: !scene.environment, nativeRendererUnchanged: true,originalFieldGeometryUnchanged:!scene.trees?.length,originalCollisionsUnchanged:true, existingTextBanksUnchanged: !appendedStoryBanks.size, existingMessagesUnchanged: true, exportedDialogueRoundTrip: true, knownGroundPath: true }, romSha256: hash(dl.romBytes), saveSha256: hash(dl.saveBytes) }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, trigger: dl.trigger, entry: scene.entry }));
