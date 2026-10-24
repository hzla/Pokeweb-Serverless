import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {NintendoDSRom} from '../src/nds/rom';
import {loadProjectFromRomBytes} from '../src/pokeweb/loader';
import {readFieldScene,fieldPhaseFrames,fieldSceneNpcPath,fieldScenePlayerPath} from '../src/pokeweb/fieldScene';
import {loadFieldSpriteClips,compileFieldNpcMotion,compileFieldPlayerMotion} from '../src/pokeweb/fieldSpriteMotion';
import {fieldNpcLibrary} from '../src/pokeweb/fieldSceneNpcs';
import {toDesmumeDsv} from '../src/pokeweb/testBattle';

const [romPath,savePath,scenePath,manifestPath,out]=process.argv.slice(2);
if(!out)throw new Error('Usage: vite-node scripts/verify-field-npc-tracks.ts TEST.nds TEST.sav SCENE.json MANIFEST.json OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const bytes=new Uint8Array(await fs.readFile(romPath)),save=toDesmumeDsv(new Uint8Array(await fs.readFile(savePath))),scene=readFieldScene(JSON.parse(await fs.readFile(scenePath,'utf8'))),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const project=await loadProjectFromRomBytes(bytes,'npc-tour.nds',{selectedNarcs:['headers']}),rom=new NintendoDSRom(bytes,{fileData:'view'}),clips=loadFieldSpriteClips(project,rom),library=fieldNpcLibrary(project,rom);
const profiles=new Map((scene.actors??[]).map(a=>[a.id,loadFieldSpriteClips(project,rom,library.controller(a.overworldId))]));profiles.set('player',clips);
let start=0;const phases=scene.steps.map(step=>{const result={step,start};start+=fieldPhaseFrames(scene,step);return result;});
const tracks=[{id:'player',nativeId:255,model:240,entry:scene.entry,motion:compileFieldPlayerMotion(scene,clips,()=>0),walks:phases.flatMap(p=>p.step.type==='player.walk'?[{start:p.start,direction:p.step.direction,tiles:p.step.tiles}]:[])},...(scene.actors??[]).map(actor=>({id:actor.id,nativeId:manifest.actorIds[actor.id],model:actor.overworldId,entry:actor.entry,motion:compileFieldNpcMotion(scene,actor,profiles.get(actor.id)!,()=>0),walks:phases.flatMap(p=>{const k=actor.actions.find(a=>a.stepId===p.step.id);return k?.type==='walk'?[{start:p.start,direction:k.direction,tiles:k.tiles}]:[];})}))];
const coreUrl=new URL('../public/desmond/desmond.js',import.meta.url),source=await fs.readFile(coreUrl,'utf8');
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...a:unknown[])=>{const s=a.join(' ');if(/Undefined instruction|Assertion failed|Aborted\(/u.test(s))fatal.push(s);};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL('../public/desmond',import.meta.url)),__filename:fileURLToPath(coreUrl),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')),context);await initialized;
const core=context.Module;core._main(0,0);const size=Math.max(bytes.length,128*1024*2**bytes[0x14]),pointer=core._prepareRomBuffer(size);
core.HEAPU8.set(bytes,pointer);core.HEAPU8.fill(255,pointer+bytes.length,pointer+size);core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();assert.equal(core._loadROM(size),1);
const rows:any[]=[],blocks:Record<string,Array<{nativeStart:number;sourceStart:number;direction:string;tiles:number}>>=Object.fromEntries(tracks.map(t=>[t.id,[]])),previous=new Map<string,number>(),mismatches:any[]=[],seen=new Set<string>();
let system=0,checked=0,simultaneous=0,lastPoses:any,camera=-1,finish=-1;const captureFrames=new Set<number>();
for(let frame=0;frame<2600;frame++){
  const input=frame>=900&&frame<918?4:finish>=0&&frame>=finish+90&&frame<finish+106?2:0;
  core._runFrame(1,input,0,0,0);
  const m=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000),valid=(a:number,n=4)=>a>=0x02000000&&a+n<=0x02400000;
  const u=(a:number)=>{assert.ok(valid(a));return m.readUInt32LE(a-0x02000000);},h=(a:number)=>{assert.ok(valid(a,2));return m.readUInt16LE(a-0x02000000);};
  if(!system&&frame>1000&&frame%2===0){const needle=Buffer.alloc(4);needle.writeInt32LE((scene.entry.tileX*16+8)*4096);let at=-1;while((at=m.indexOf(needle,at+1))>=0){const a=at-0x44;if(a>=0&&m.readUInt16LE(a+8)===255&&m.readInt32LE(at+8)===(scene.entry.tileZ*16+8)*4096&&valid(m.readUInt32LE(a+0x88))&&m.readUInt32LE(a+0x8c)>=0x02150000&&m.readUInt32LE(a+0x8c)<0x02200000){system=m.readUInt32LE(a+0x88);console.log('actor system',system.toString(16),'capacity',h(system+4));break;}}}
  if(system){
    const actorBase=u(system+0x1c),capacity=h(system+4),poses:any={};
    assert.ok(capacity>0&&capacity<=256&&valid(actorBase,capacity*256));
    for(const track of tracks){let actor=0;for(let i=0;i<capacity;i++){const at=actorBase+i*256;if((u(at)&1)&&h(at+8)===track.nativeId&&h(at+12)===track.model){actor=at;break;}}
      if(!actor)continue;seen.add(track.id);
      const fieldBillboard=u(system+0x28),renderer=u(fieldBillboard+4),slot=h(actor+0xc4);if(slot===0xffff)continue;
      const billboard=u(u(renderer+4)+8)+u(u(renderer+0x18)+slot*40)*28;
      const mode=m[actor-0x02000000+0xc9],position=[u(actor+0x44)|0,u(actor+0x48)|0,u(actor+0x4c)|0].map(n=>n/4096),sprite=h(billboard+16),direction=['up','down','left','right'][h(actor+24)];
      const pose={actor,mode,position,sprite,direction,flags:u(actor),draw:m.subarray(actor-0x02000000+0xc4,actor-0x02000000+0xcc).toString('hex')};poses[track.id]=pose;
      if(mode===3&&previous.get(track.id)!==3&&finish<0){const authored=track.walks[blocks[track.id].length];assert.ok(authored,`Extra walking block for ${track.id}`);assert.equal(direction,authored.direction);const block={nativeStart:frame,sourceStart:authored.start,direction,tiles:authored.tiles};blocks[track.id].push(block);console.log(track.id,block);captureFrames.add(frame+8);}
      if(mode===3&&finish<0){const block=blocks[track.id].at(-1)!;assert.ok(frame-block.nativeStart<block.tiles*16+1);checked++;}
      previous.set(track.id,mode);
    }
    if(poses.player?.mode===3&&Object.entries(poses).some(([id,p]:any)=>id!=='player'&&p.mode===3))simultaneous++;
    if(camera<0&&poses.player&&frame>1100&&frame%2===0){const needle=Buffer.alloc(4);needle.writeUInt32LE(poses.player.actor+0x44);let at=-1; // Camera uses a copied follow vector; locate through known default parameters instead.
      const pattern=Buffer.from('d825000000d00e00','hex');while((at=m.indexOf(pattern,at+1))>=0){const base=at-0x78,p=base>=0?m.readUInt32LE(base+0x18):0;if(base>=0&&valid(p,12)&&Math.abs(m.readInt32LE(p-0x02000000)/4096-scene.entry.tileX*16-8)<1){camera=base;break;}}
    }
    if(camera>=0&&finish<0&&frame>1600&&m.readUInt32LE(camera+0x1c)!==0){finish=frame;console.log('handoff',frame);captureFrames.add(frame+30);}
    if(frame>1100){rows.push({frame,poses});lastPoses=poses;}
  }
  if(captureFrames.has(frame)){const image=new PNG({width:256,height:192}),fb=core._getSymbol(4)>>>0;image.data=Buffer.from(core.HEAPU8.slice(fb,fb+256*192*4));await fs.writeFile(`${out}/${frame}.png`,PNG.sync.write(image));}
  if(frame%300===0)console.log(frame);
}
assert.deepEqual(fatal,[]);assert.ok(finish>=0,'No native camera handoff.');
for(const track of tracks){assert.ok(seen.has(track.id),`Actor ${track.id} never appeared.`);assert.equal(blocks[track.id].length,track.walks.length);}
assert.ok(simultaneous>0,'NPC and player never walked together.');
for(const actor of scene.actors??[]){const pose=lastPoses[actor.id];if(actor.endBehavior==='remove')assert.ok(!pose,'Temporary NPC was not removed.');else{assert.ok(pose,'Retained NPC disappeared.');const expected=fieldSceneNpcPath(scene,actor).at(-1)!;assert.equal(pose.position[0],expected.tileX*16+8);assert.equal(pose.position[2],expected.tileZ*16+8);assert.equal(pose.direction,expected.facing);}}
// Actor tasks can begin between global field ticks. Infer that half-frame clock
// phase from X/Z updates, then inspect the exact program texture. Graphics queue
// commits can lag/lead one display frame; report those separately, never as exact.
const textureLatency:any[]=[],clockPhases:any[]=[];let exactTextures=0,idlePosesChecked=0;
for(const track of tracks){
  for(const [i,block]of blocks[track.id].entries()){
    const end=blocks[track.id][i+1]?.nativeStart??finish;
    const samples=rows.filter(r=>r.frame>=block.nativeStart&&r.frame<end&&r.poses[track.id]?.mode===3);
    const matches=(offset:number)=>samples.every(r=>{const p=track.motion.sample(block.sourceStart+(r.frame-block.nativeStart+offset)/2);return [0,2].every(axis=>Math.abs(r.poses[track.id].position[axis]-p.position[axis])<=1/4096);});
    const offset=[0,1].find(matches);assert.notEqual(offset,undefined,`Native position cadence differs for ${track.id} at ${block.nativeStart}`);
    clockPhases.push({id:track.id,nativeStart:block.nativeStart,displayFramePhase:offset});
    for(const row of samples){const at=block.sourceStart+(row.frame-block.nativeStart+offset!)/2,p=track.motion.sample(at),sprite=row.poses[track.id].sprite;
      if(sprite===p.textureIndex)exactTextures++;
      else if([Math.max(block.sourceStart,at-.5),at+.5].some(f=>track.motion.sample(f).textureIndex===sprite))textureLatency.push({id:track.id,frame:row.frame,sprite,nominalTexture:p.textureIndex});
      else mismatches.push({id:track.id,frame:row.frame,sprite,expected:p.textureIndex});
    }
  }
  for(let i=2;i<rows.length;i++){
    const poses=[rows[i-2],rows[i-1],rows[i]].map(r=>r.poses[track.id]);
    if(poses.some(p=>!p||p.mode!==0)||poses.some(p=>p.direction!==poses[2].direction))continue;
    const expected=profiles.get(track.id)!.idle[poses[2].direction as 'up'].keys[0].textureIndex;
    if(poses[2].sprite!==expected)mismatches.push({id:track.id,frame:rows[i].frame,idle:true,sprite:poses[2].sprite,expected});
    idlePosesChecked++;
  }
}
const final=fieldScenePlayerPath(scene).at(-1)!,controlRestored=lastPoses.player.position[2]>final.tileZ*16+8||lastPoses.player.position[0]<final.tileX*16+8;
assert.ok(controlRestored,'Player input was not restored after handoff.');
const result={passed:mismatches.length===0,walkingDisplayFramesChecked:checked,simultaneousWalkingDisplayFrames:simultaneous,seen:[...seen],blocks,clockPhases,exactTextures,idlePosesChecked,textureLatency,handoffFrame:finish,controlRestored,mismatches,scope:'X/Z motion checked on the actor task clock; native walking/standing textures checked with separately reported one-display-frame graphics commit latency. Global VM scheduling and terrain height remain estimated.'};
await fs.writeFile(`${out}/trace.json`,JSON.stringify(rows));await fs.writeFile(`${out}/validation.json`,JSON.stringify(result,null,2));console.log({...result,mismatches:mismatches.slice(0,12)});
assert.deepEqual(mismatches,[],'Native NPC movement differs from the preview.');
