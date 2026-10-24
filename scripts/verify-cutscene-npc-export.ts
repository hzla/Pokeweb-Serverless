import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NARC } from '../src/nds/narc';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { loadNativeCutsceneLibrary, openNativeCutscene, compileNativeCutscene } from '../src/pokeweb/nativeCutsceneModel';
import { readCutsceneScene } from '../src/pokeweb/cutsceneScene';
import { cutsceneOverworldLibrary, sampleSceneNpc, sceneNpcTexture } from '../src/pokeweb/cutsceneActors';
import { stagePoint } from '../src/pokeweb/cutsceneMapAssets';
import { writeCutsceneNpcMovement } from '../src/pokeweb/cutsceneActorCompiler';
import { replaceRomFile } from '../src/pokeweb/fileSystemModel';
import { exportModifiedRom } from '../src/pokeweb/exportRom';

const [romPath, scenePath, controlPath] = process.argv.slice(2);
if (!romPath || !scenePath) throw new Error('Usage: vite-node scripts/verify-cutscene-npc-export.ts ROM.nds SCENE.json [NEW_STATIONARY_CONTROL.nds]');
globalThis.fetch = (async request => { const url=request instanceof URL?request:new URL(String(request));if(url.protocol!=='file:')throw new Error('Expected local runtime asset.');return new Response(new Uint8Array(await fs.readFile(url))); }) as typeof fetch;
const bytes=new Uint8Array(await fs.readFile(romPath)),source=readCutsceneScene(JSON.parse(await fs.readFile(scenePath,'utf8')));
const installed=JSON.parse(await fs.readFile(romPath.replace(/\.nds$/,'.manifest.json'),'utf8')).binding,manifest=installed.manifest;
const project=await loadProjectFromRomBytes(bytes,'npc-export-audit.nds',{selectedNarcs:['headers']}),library=await loadNativeCutsceneLibrary(project),doc=openNativeCutscene(project,library,installed.sequenceId),native=compileNativeCutscene(doc),sprites=cutsceneOverworldLibrary(project,library.rom);
assert.equal(source.stage.kind,'map');assert.ok(source.actors?.length);assert.equal(doc.camera.frameCount,source.frameCount);
assert.equal(native.models.length,manifest.models);
const archive=new NARC();archive.files=doc.files.map(b=>new Uint8Array(b));
const results=[];
for(const actor of source.actors!) {
  const binding=manifest.actors.find((a:{id:string})=>a.id===actor.id);assert.ok(binding);
  const model=native.models[binding.modelIndex],frames=sprites.load(actor.overworldId),patterns=new Set<string>();
  for(let f=0;f<source.frameCount;f++) {
    native.sample(f);const expected=stagePoint(sampleSceneNpc(actor,f).position,manifest).map(n=>Math.round(n*4096)/4096);
    Array.from(model.jointPositions).forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<.00001,`${actor.id} movement frame ${f} axis ${i}`));
    const image=sceneNpcTexture(actor,f,frames),actual=model.primitives[0].material.texture!;assert.equal(actual.width,image.width);assert.equal(actual.height,image.height);
    for(let i=0;i<image.rgba.length;i++)if(i%4===3||image.rgba[i-i%4+3])assert.equal(actual.rgba[i],image.rgba[i],`${actor.id} sprite frame ${f} byte ${i}`);
    patterns.add(image.name);
  }
  assert.ok(patterns.size>1,'Fixture must exercise facing/walking frame changes.');
  const group=doc.definition.resources[binding.modelIndex].bundles[0][0];assert.equal(String.fromCharCode(...archive.files[group[1]].subarray(0,4)),'BCA0');
  // Keep camera, events, sprite patterns, water and all other resources identical.
  const initial=stagePoint(sampleSceneNpc(actor,0).position,manifest);
  archive.files[group[1]]=writeCutsceneNpcMovement(Array.from({length:source.frameCount},()=>[...initial]));
  results.push({id:actor.id,overworldId:actor.overworldId,framesChecked:source.frameCount,spriteImages:patterns.size,privateResources:group});
}
if(controlPath){replaceRomFile(project,library.rom,library.fileId,archive.save());await fs.writeFile(controlPath,await exportModifiedRom(project,{forDsi:false}),{flag:'wx'});}
console.log(JSON.stringify({passed:true,romSha256:createHash('sha256').update(bytes).digest('hex'),actors:results,controlPath}));
