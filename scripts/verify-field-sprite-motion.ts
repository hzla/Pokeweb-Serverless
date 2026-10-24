import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { NintendoDSRom } from '../src/nds/rom';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { readFieldScene, fieldStepFrames } from '../src/pokeweb/fieldScene';
import { loadFieldSpriteClips, compileFieldPlayerMotion } from '../src/pokeweb/fieldSpriteMotion';
import { toDesmumeDsv } from '../src/pokeweb/testBattle';

const [romPath,savePath,scenePath,out]=process.argv.slice(2);
if(!romPath||!savePath||!scenePath||!out)throw new Error('Usage: vite-node scripts/verify-field-sprite-motion.ts TEST.nds TEST.sav SCENE.json OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const bytes=new Uint8Array(await fs.readFile(romPath)),save=toDesmumeDsv(new Uint8Array(await fs.readFile(savePath))),scene=readFieldScene(JSON.parse(await fs.readFile(scenePath,'utf8')));
const project=await loadProjectFromRomBytes(bytes,'sprite-motion.nds',{selectedNarcs:['headers']}),clips=loadFieldSpriteClips(project,new NintendoDSRom(bytes,{fileData:'view'})),motion=compileFieldPlayerMotion(scene,clips,()=>0);
const sourceActions=scene.steps.map((step,i)=>({step,start:scene.steps.slice(0,i).reduce((n,s)=>n+fieldStepFrames(s),0)}));
const sourceSteps=sourceActions.filter(s=>s.step.type==='player.walk');
const coreUrl=new URL('../public/desmond/desmond.js',import.meta.url),source=await fs.readFile(coreUrl,'utf8');
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...a:unknown[])=>{const s=a.join(' ');if(/Undefined instruction|Assertion failed|Aborted\(/u.test(s))fatal.push(s);};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL('../public/desmond',import.meta.url)),__filename:fileURLToPath(coreUrl),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')),context);await initialized;
const core=context.Module;core._main(0,0);const size=Math.max(bytes.length,128*1024*2**bytes[0x14]),pointer=core._prepareRomBuffer(size);
core.HEAPU8.set(bytes,pointer);core.HEAPU8.fill(255,pointer+bytes.length,pointer+size);core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();assert.equal(core._loadROM(size),1);
const mismatches:any[]=[];const rows:any[]=[],blocks:Array<{start:number;sourceStart:number;direction:string;tiles:number}>=[];let actor=-1,previousMode=0,checked=0;
for(let frame=0;frame<2100;frame++){
  core._runFrame(1,frame>=900&&frame<918?4:0,0,0,0);
  const m=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
  const valid=(a:number,size=4)=>a>=0x02000000&&a+size<=0x02400000,u=(a:number)=>{assert.ok(valid(a));return m.readUInt32LE(a-0x02000000);},h=(a:number)=>{assert.ok(valid(a,2));return m.readUInt16LE(a-0x02000000);};
  if(actor<0&&frame>1000&&frame%2===0){const needle=Buffer.alloc(4);needle.writeInt32LE((scene.entry.tileX*16+8)*4096);let at=-1;while((at=m.indexOf(needle,at+1))>=0){const a=at-0x44;if(a>=0&&m.readUInt16LE(a+8)===255&&m.readInt32LE(at+8)===(scene.entry.tileZ*16+8)*4096&&valid(m.readUInt32LE(a+0x88))&&m.readUInt32LE(a+0x8c)>=0x02150000&&m.readUInt32LE(a+0x8c)<0x02200000){actor=a+0x02000000;break;}}}
  if(actor>=0){
    const system=u(actor+0x88),fieldBillboard=u(system+0x28);if(!valid(fieldBillboard))continue;
    const renderer=u(fieldBillboard+4);if(!valid(renderer))continue;
    const slot=h(actor+0xc4);if(slot===0xffff)continue;
    const billboard=u(u(renderer+4)+8)+u(u(renderer+0x18)+slot*40)*28;
    const mode=m[actor-0x02000000+0xc9],position=[u(actor+0x44)|0,u(actor+0x48)|0,u(actor+0x4c)|0].map(n=>n/4096),sprite=h(billboard+16),animation=Array.from({length:8},(_,i)=>h(u(renderer+0x18)+slot*40+0xc+i*2)),draw=m.subarray(actor-0x02000000+0xc4,actor-0x02000000+0xcc).toString('hex'),direction=['up','down','left','right'][h(actor+24)],row={frame,actor,model:h(actor+12),mode,direction,position,sprite,animation,draw};
    rows.push(row);
    if(mode===3&&previousMode!==3){const authored=sourceSteps[blocks.length];assert.ok(authored,'Unexpected extra walking block.');const step=authored.step;assert.equal(step.type,'player.walk');if(step.type==='player.walk'){assert.equal(direction,step.direction);blocks.push({start:frame,sourceStart:authored.start,direction,tiles:step.tiles});console.log('walk',blocks.at(-1));}}
    if(mode===3){const block=blocks.at(-1)!;assert.ok(frame-block.start<block.tiles*16,'Native walk exceeded its duration.');const expected=motion.sample(block.sourceStart+(frame-block.start)/2);if(sprite!==expected.textureIndex)mismatches.push({frame,local:(frame-block.start)/2,block:blocks.length,sprite,expected:expected.textureIndex,animation,draw});for(const axis of [0,2])assert.ok(Math.abs(position[axis]-expected.position[axis])<=1/4096,`Position axis ${axis} at ${frame}`);checked++;}
    previousMode=mode;
  }
  if(frame%300===0)console.log(frame);
}
assert.deepEqual(fatal,[]);assert.equal(blocks.length,sourceSteps.length);assert.equal(checked,sourceSteps.reduce((n,s)=>n+fieldStepFrames(s.step)*2,0));
let stoppedPosesChecked=0,facingChangesChecked=0;
for(const block of blocks){
  const stopped=rows.find(r=>r.frame>=block.start+block.tiles*16&&r.mode===0);
  assert.ok(stopped,'Missing stopped player pose.');
  assert.equal(stopped.sprite,motion.sample(block.sourceStart+block.tiles*8).textureIndex);
  stoppedPosesChecked++;
}
for(const action of sourceActions.filter(a=>a.step.type==='player.face')){
  const previousWalk=blocks.filter(b=>b.sourceStart<action.start).at(-1);
  assert.ok(previousWalk,'This audit requires facing actions after walking.');
  const index=rows.findIndex((r,i)=>i>0&&r.frame>=previousWalk.start+previousWalk.tiles*16&&r.direction!==rows[i-1].direction&&r.direction===(action.step as {direction:string}).direction);
  assert.ok(index>=0,'Missing facing change.');
  assert.equal(rows[index].sprite,motion.sample(action.start).textureIndex);
  assert.deepEqual([rows[index].position[0],rows[index].position[2]],[motion.sample(action.start).position[0],motion.sample(action.start).position[2]]);
  facingChangesChecked++;
}
const result={passed:mismatches.length===0,mismatches,walkingDisplayFramesChecked:checked,stoppedPosesChecked,facingChangesChecked,blocks,allFourDirections:new Set(blocks.map(b=>b.direction)).size===4,clips,actor:'0x'+actor.toString(16),scope:'Sprite textures and X/Z motion aligned to each native action start; VM scheduling and terrain height are not compared.'};
await fs.writeFile(`${out}/motion.json`,JSON.stringify(rows));await fs.writeFile(`${out}/validation.json`,JSON.stringify(result,null,2));console.log(result);
assert.deepEqual(mismatches,[],'Native sprite playback differs from the preview.');
