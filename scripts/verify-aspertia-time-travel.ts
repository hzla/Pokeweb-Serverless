import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {loadProjectFromRomBytes} from '../src/pokeweb/loader';
import {loadMap3dZone} from '../src/pokeweb/map3dModel';
import {loadNativeCutsceneLibrary,openNativeCutscene,nativeSceneGroups,compileNativeCutscene} from '../src/pokeweb/nativeCutsceneModel';
import {readCutsceneScene} from '../src/pokeweb/cutsceneScene';
import {scopeCutsceneMap,sampleSceneEnvironment,pairEnvironmentPrimitives,blendSeasonalImage} from '../src/pokeweb/cutsceneEnvironment';
import {visibleCutsceneMap} from '../src/pokeweb/cutsceneStageVisibility';
import {readNitroTextureAnimation,type NitroTextureSrt} from '../src/pokeweb/nitroAnimation';
import {readNitroMaterialAnimation} from '../src/pokeweb/nitroSceneAnimation';

const [romPath,scenePath,manifestPath,captures]=process.argv.slice(2);
if(!captures)throw new Error('Usage: vite-node scripts/verify-aspertia-time-travel.ts TEST.nds SCENE.json MANIFEST.json NATIVE_CAPTURE_DIR');
globalThis.fetch=(async r=>new Response(new Uint8Array(await fs.readFile(new URL(String(r)))))) as typeof fetch;
const bytes=new Uint8Array(await fs.readFile(romPath)),scene=readCutsceneScene(JSON.parse(await fs.readFile(scenePath,'utf8'))),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
assert.equal(scene.id,'aspertia.lookout-time-travel');assert.equal(scene.stage.kind,'map');if(scene.stage.kind!=='map'||!scene.environment)throw new Error('Expected the Aspertia map environment fixture.');
assert.equal(scene.stage.zoneId,427);assert.equal(scene.stage.season,'summer');assert.equal(scene.environment.targetSeason,'autumn');assert.equal(scene.environment.ambientSpeed,4);
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.romSha256);
const project=await loadProjectFromRomBytes(bytes,'aspertia-test.nds',{selectedNarcs:['headers']}),library=await loadNativeCutsceneLibrary(project),doc=openNativeCutscene(project,library,manifest.binding.sequenceId),groups=nativeSceneGroups(doc);
const source=visibleCutsceneMap(scopeCutsceneMap(await loadMap3dZone(project,427,{season:'summer',includeNeighbors:true,cache:false}),scene.stage.bounds,true),scene);
assert.ok(source.buildings.some(b=>b.uid===442),'Cloud prop missing');assert.ok(source.buildings.some(b=>b.uid===443),'Sky panorama missing');
const parts=[...source.chunks,...source.buildings].flatMap(o=>o.primitives),animated=parts.filter(p=>p.textureAnimation),srtClips=groups.flatMap(ids=>ids.map(id=>doc.files[id]).filter(b=>String.fromCharCode(...b.slice(0,4))==='BTA0').map(readNitroTextureAnimation));
const close=(a:NitroTextureSrt,b:NitroTextureSrt)=>Object.keys(a).every(k=>Math.abs(a[k as keyof NitroTextureSrt]-b[k as keyof NitroTextureSrt])<=1/4096);
const frames=[0,59,60,61,62,90,300,659,660,661,700];let checkedSrt=0;
for(const f of frames){
  // Independent integration of 1× before/after, 4× within the transition.
  const nativeClock=Math.min(f,60)+4*Math.max(0,Math.min(f,660)-60)+Math.max(0,f-660);
  const exported=srtClips.flatMap(c=>[...c.sample(f).values()]);
  for(const p of animated){const expected=p.textureAnimation!.sample(nativeClock).srt;if(expected){assert.ok(exported.some(actual=>close(actual,expected)),`Missing retimed ${p.material.name} at scene frame ${f}`);checkedSrt++;}}
}
assert.ok(checkedSrt>=44);
let materialTracks=0;
for(const ids of groups){const b=ids.map(id=>doc.files[id]).find(b=>String.fromCharCode(...b.slice(0,4))==='BMA0');assert.ok(b);const clip=readNitroMaterialAnimation(b);for(const f of frames)for(const actual of clip.sample(f).values()){const tint=sampleSceneEnvironment(scene.environment,f).tint;actual.diffuse.forEach((v,i)=>assert.ok(Math.abs(v-tint[i])<=1/31));}materialTracks+=clip.sample(0).size;}
const compiled=compileNativeCutscene(doc);compiled.sample(60);const summer=compiled.models.flatMap(m=>m.primitives.map(p=>p.material.texture?.rgba.slice()));compiled.sample(660);
const target=visibleCutsceneMap(scopeCutsceneMap(await loadMap3dZone(project,427,{season:'autumn',includeNeighbors:true,cache:false}),scene.stage.bounds,true),scene),pairs=pairEnvironmentPrimitives(source,target);
const signature=(rgba:Uint8Array)=>Array.from({length:rgba.length/4},(_,i)=>{const k=i*4;return rgba[k+3]?[...rgba.slice(k,k+3)].map(v=>Math.round(v*31/255)).join(',')+','+Math.round(rgba[k+3]*7/255):'0';}).join(';');
let checkedFlowerPatterns=0;
for(const f of [61,62,75,90,300,659,661]){
  const clock=Math.min(f,60)+4*Math.max(0,Math.min(f,660)-60)+Math.max(0,f-660);compiled.sample(f);const exported=new Set(compiled.models.flatMap(m=>m.primitives.flatMap(p=>p.material.texture?[signature(p.material.texture.rgba)]:[])));
  for(const p of animated.filter(p=>p.material.name==='hana01_1')){const q=pairs.get(p)!,a=p.textureAnimation!.sample(clock).texture??p.material.texture!,b=q.textureAnimation?.sample(clock).texture??q.material.texture!,expected=blendSeasonalImage(a,b,sampleSceneEnvironment(scene.environment,f).level);assert.ok(exported.has(signature(expected.rgba)),`Missing flower pattern at scene frame ${f}`);checkedFlowerPatterns++;}
}
assert.ok(checkedFlowerPatterns>0);compiled.sample(660);
let changedTexels=0;compiled.models.flatMap(m=>m.primitives).forEach((p,i)=>{const a=summer[i],b=p.material.texture?.rgba;if(a&&b)for(let k=0;k<a.length;k+=4)if((a[k+3]||b[k+3])&&[0,1,2,3].some(c=>a[k+c]!==b[k+c]))changedTexels++;});assert.ok(changedTexels>100);
const trace=JSON.parse(await fs.readFile(`${captures}/trace.json`,'utf8')),last=trace.at(-1);assert.ok(last.starts.length===2&&last.completions.length===2&&last.fatal.length===0);
const average=(png:PNG,box:number[])=>{let n=0;const rgb=[0,0,0];for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++){const k=(y*png.width+x)*4;for(let c=0;c<3;c++)rgb[c]+=png.data[k+c];n++;}return rgb.map(v=>v/n);};
const images=await Promise.all([1200,1500,1800,2100].map(async f=>({frame:f,png:PNG.sync.read(await fs.readFile(`${captures}/frame-${f}.png`))})));
const seasons=images.map(({frame,png})=>({frame,rgb:average(png,[24,65,232,125])})),seasonalDelta=Math.max(...seasons[0].rgb.map((v,i)=>Math.abs(v-seasons.at(-1)!.rgb[i])));assert.ok(seasonalDelta>5,'Same-phase native captures must show autumn artwork.');
const luminance:number[]=[];for(let f=1200;f<=2280;f+=60){const png=PNG.sync.read(await fs.readFile(`${captures}/frame-${f}.png`));luminance.push(average(png,[24,24,232,168]).reduce((a,b)=>a+b)/3);}assert.ok(Math.min(...luminance)<Math.max(...luminance)*.7);
const result={passed:true,romSha256:manifest.romSha256,sequenceId:doc.definition.id,models:groups.length,materialTracks,retimedSrtSamples:checkedSrt,retimedFlowerPatternSamples:checkedFlowerPatterns,ambientMaterials:animated.map(p=>p.material.name),changedEndpointTexels:changedTexels,seasonalDelta,sameLightPhaseSamples:seasons,dayNightLuminance:{min:Math.min(...luminance),max:Math.max(...luminance)},starts:last.starts,completions:last.completions,scope:'Aspertia lookout summer/autumn fixture; static field NPCs excluded. Visual clock only.'};
await fs.writeFile(`${captures}/environment-validation.json`,JSON.stringify(result,null,2)+'\n');console.log(result);
