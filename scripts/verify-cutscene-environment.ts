import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {loadProjectFromRomBytes} from '../src/pokeweb/loader';
import {loadNativeCutsceneLibrary,openNativeCutscene,nativeSceneGroups,compileNativeCutscene} from '../src/pokeweb/nativeCutsceneModel';
import {readCutsceneScene} from '../src/pokeweb/cutsceneScene';
import {sampleSceneEnvironment} from '../src/pokeweb/cutsceneEnvironment';
import {readNitroMaterialAnimation} from '../src/pokeweb/nitroSceneAnimation';
import {readNitroTexturePatterns} from '../src/pokeweb/mapTextureAnimation';

const [romPath,scenePath,manifestPath,captures]=process.argv.slice(2);
if(!captures)throw new Error('Usage: vite-node scripts/verify-cutscene-environment.ts TEST.nds SCENE.json MANIFEST.json NATIVE_CAPTURE_DIR');
const bytes=new Uint8Array(await fs.readFile(romPath)),scene=readCutsceneScene(JSON.parse(await fs.readFile(scenePath,'utf8'))),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
assert.ok(scene.environment);assert.equal(scene.id,'route13.time-travel','This capture audit is calibrated to the supplied Route 13 prototype.');
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.romSha256,'Audit the ROM matching its manifest.');
const project=await loadProjectFromRomBytes(bytes,'environment-test.nds',{selectedNarcs:['headers']}),library=await loadNativeCutsceneLibrary(project),doc=openNativeCutscene(project,library,manifest.binding.sequenceId),groups=nativeSceneGroups(doc);
let colorTracks=0,paletteFadeTracks=0;
const frames=[0,60,98,180,360,660,720];
for(const ids of groups){
  const resource=(stamp:string)=>ids.map(id=>doc.files[id]).find(b=>String.fromCharCode(...b.subarray(0,4))===stamp),material=resource('BMA0');
  assert.ok(material,'Every prototype model needs a native day/night material track.');const clip=readNitroMaterialAnimation(material);assert.equal(clip.frameCount,scene.frameCount);
  for(const frame of frames)for(const sample of clip.sample(frame).values()){const expected=sampleSceneEnvironment(scene.environment,frame).tint;sample.diffuse.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1/31/2));}
  colorTracks+=clip.sample(0).size;
  const pattern=resource('BTP0');if(pattern)for(const track of readNitroTexturePatterns(pattern)[0].tracks)if(new Set(track.keys.map(k=>k.paletteName)).size>1&&track.keys.some((k,i)=>i&&k.textureName===track.keys[i-1].textureName&&k.paletteName!==track.keys[i-1].paletteName))paletteFadeTracks++;
}
assert.ok(colorTracks>0&&paletteFadeTracks>0);
const compiled=compileNativeCutscene(doc);compiled.sample(scene.environment.startFrame);
const spring=compiled.models.flatMap(m=>m.primitives.map(p=>p.material.texture?.rgba.slice()));compiled.sample(scene.environment.endFrame);
let changedTexels=0;compiled.models.flatMap(m=>m.primitives).forEach((p,i)=>{const a=spring[i],b=p.material.texture?.rgba;if(a&&b)for(let k=0;k<a.length;k+=4)if(a[k+3]&&b[k+3]&&[0,1,2].some(c=>a[k+c]!==b[k+c]))changedTexels++;});assert.ok(changedTexels>100,'Seasonal endpoints did not change visible texels.');
const trace=JSON.parse(await fs.readFile(`${captures}/trace.json`,'utf8')),last=trace.at(-1);assert.ok(last.starts.length>=2&&last.completions.length>=2&&last.fatal.length===0,'Two complete native playbacks are required.');
const averages=(png:PNG,box:number[])=>{let n=0;const rgb=[0,0,0];for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++){const k=(y*png.width+x)*4;if(png.data[k]+png.data[k+1]+png.data[k+2]<12)continue;n++;for(let c=0;c<3;c++)rgb[c]+=png.data[k+c];}return rgb.map(v=>v/n);};
const luminance:number[]=[],samePhase:Array<{frame:number;rgb:number[]}>=[];
for(let f=1200;f<=2280;f+=60){const png=PNG.sync.read(await fs.readFile(`${captures}/frame-${f}.png`)),rgb=averages(png,[32,24,224,168]);luminance.push(rgb.reduce((n,v)=>n+v,0)/3);if([1200,1500,1800,2100].includes(f))samePhase.push({frame:f,rgb:averages(png,[70,35,160,82])});}
assert.ok(Math.min(...luminance)<Math.max(...luminance)*.7,'Native captures lack visible day/night changes.');
const seasonalRgbDelta=Math.max(...samePhase[0].rgb.map((v,i)=>Math.abs(v-samePhase.at(-1)!.rgb[i])));assert.ok(seasonalRgbDelta>5,'Same-light-phase captures lack a visible seasonal change.');
const result={passed:true,romSha256:manifest.romSha256,sequenceId:manifest.binding.sequenceId,models:groups.length,colorTracks,paletteFadeTracks,changedEndpointTexels:changedTexels,dayNightLuminance:{min:Math.min(...luminance),max:Math.max(...luminance)},sameLightPhaseSeasonalSamples:samePhase,seasonalRgbDelta,starts:last.starts,completions:last.completions,scope:'Bounded Route 13 prototype; visual tint and seasonal artwork only, no game-clock or field-season change.'};
await fs.writeFile(`${captures}/environment-validation.json`,JSON.stringify(result,null,2)+'\n');console.log(result);
