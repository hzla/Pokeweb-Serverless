import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {readFieldScene,compileFieldScene,fieldScenePlayerPath} from '../src/pokeweb/fieldScene';
import {toDesmumeDsv} from '../src/pokeweb/testBattle';

const [romPath,savePath,scenePath,manifestPath,out]=process.argv.slice(2);
if(!out)throw new Error('Usage: vite-node scripts/verify-field-dialogue.ts TEST.nds TEST.sav SCENE.json MANIFEST.json OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const bytes=new Uint8Array(await fs.readFile(romPath)),save=toDesmumeDsv(new Uint8Array(await fs.readFile(savePath))),scene=readFieldScene(JSON.parse(await fs.readFile(scenePath,'utf8'))),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const compiled=compileFieldScene(scene,true,manifest.actorIds,manifest.dialogue.bindings).compiled,entry=compiled.entries[0].offset,body=Buffer.from(compiled.bytes.subarray(entry));
type Site={kind:'printing'|'input'|'timed';stepId:string;page:number;hold?:number};
const messages=new Map<number,Site>(),sites=new Map<number,Site>();
for(const step of scene.steps)if(step.type==='dialogue')for(const [page,id]of manifest.dialogue.bindings[step.id].messageIds.entries())messages.set(id,{kind:step.waitForInput?'input':'timed',stepId:step.id,page,...(!step.waitForInput?{hold:step.durationFrames}: {})});
let current:Site|undefined;
compiled.instructions.forEach((i,n)=>{
  const end=(compiled.instructions[n+1]?.offset??compiled.bytes.length)-entry;
  if(i.opcode===0x3c){current=messages.get(i.operands[1]);assert.ok(current);sites.set(end,{...current,kind:'printing'});}
  if(i.opcode===0x31&&current)sites.set(end,{...current,kind:'input'});
  if(i.opcode===3&&current?.kind==='timed')sites.set(end,{...current,kind:'timed'});
});
const coreUrl=new URL('../public/desmond/desmond.js',import.meta.url),source=await fs.readFile(coreUrl,'utf8');
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...a:unknown[])=>{const s=a.join(' ');if(/Undefined instruction|Assertion failed|Aborted\(/u.test(s))fatal.push(s);};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL('../public/desmond',import.meta.url)),__filename:fileURLToPath(coreUrl),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')),context);await initialized;
const core=context.Module;core._main(0,0);const size=Math.max(bytes.length,128*1024*2**bytes[0x14]),pointer=core._prepareRomBuffer(size);
core.HEAPU8.set(bytes,pointer);core.HEAPU8.fill(255,pointer+bytes.length,pointer+size);core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();assert.equal(core._loadROM(size),1);
let program=-1,script=-1,system=0,camera=-1,handoff=-1,firstHoldArmed=false,firstHoldReleased=false,lastSite:Site|undefined,activeWait:any,activeTimed:any,lastPoses:any;
const waits:any[]=[],timed:any[]=[],rows:any[]=[],printings=new Set<string>(),visiblePages=new Map<string,number>();let frozenFrames=0;
const tracks=[{id:'player',nativeId:255,model:240},...(scene.actors??[]).map(a=>({id:a.id,nativeId:manifest.actorIds[a.id],model:a.overworldId}))];
for(let frame=0;frame<4200;frame++){
  let input=frame>=900&&frame<918?4:0;
  if(firstHoldArmed&&!firstHoldReleased)input|=0x80;
  if(activeWait){const age=frame-activeWait.start;if(waits.length===1&&age>=90){firstHoldReleased=true;input&=~0x80;}if(age>=60&&age<76)input|=2;if(age>=180&&age<184)input|=waits.length%2?0x80:0x40;}
  if(handoff>=0&&frame>=handoff+90&&frame<handoff+106)input|=2;
  core._runFrame(1,input,0,0,0);
  const m=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000),valid=(a:number,n=4)=>a>=0x02000000&&a+n<=0x02400000;
  const u=(a:number)=>{assert.ok(valid(a));return m.readUInt32LE(a-0x02000000);},h=(a:number)=>{assert.ok(valid(a,2));return m.readUInt16LE(a-0x02000000);};
  if(program<0&&frame>600&&frame%30===0){program=m.indexOf(body);if(program>=0)console.log('program',frame,program.toString(16),body.length);}
  if(program>=0&&script<0&&frame%30===0){for(let at=0x20;at<m.length-4;at+=4){const pc=m.readUInt32LE(at),candidate=at-0x20;if(pc>=program+0x02000000&&pc<program+0x02000000+body.length&&[1,2].includes(m[candidate+0x19])&&m.readUInt32LE(candidate+4)===0x0216b578){script=candidate;console.log('VM',frame,script.toString(16));break;}}}
  if(!system&&frame>1000&&frame%30===0){const needle=Buffer.alloc(4);needle.writeInt32LE((scene.entry.tileX*16+8)*4096);let at=-1;while((at=m.indexOf(needle,at+1))>=0){const a=at-0x44;if(a>=0&&m.readUInt16LE(a+8)===255&&m.readInt32LE(at+8)===(scene.entry.tileZ*16+8)*4096&&valid(m.readUInt32LE(a+0x88))&&m.readUInt32LE(a+0x8c)>=0x02150000&&m.readUInt32LE(a+0x8c)<0x02200000){system=m.readUInt32LE(a+0x88);break;}}}
  const poses:any={};
  if(system){const base=u(system+0x1c),capacity=h(system+4);assert.ok(capacity<=256&&valid(base,capacity*256));for(const track of tracks)for(let i=0;i<capacity;i++){const a=base+i*256;if((u(a)&1)&&h(a+8)===track.nativeId&&h(a+12)===track.model){poses[track.id]=[u(a+0x44)|0,u(a+0x48)|0,u(a+0x4c)|0,h(a+24)];break;}}lastPoses=poses;
    if(camera<0&&frame>1100&&frame%30===0){const pattern=Buffer.from('d825000000d00e00','hex');let at=-1;while((at=m.indexOf(pattern,at+1))>=0){const base=at-0x78,p=base>=0?m.readUInt32LE(base+0x18):0;if(base>=0&&valid(p,12)&&Math.abs((u(p)|0)/4096-scene.entry.tileX*16-8)<1){camera=base;break;}}}
  }
  const mode=script>=0?m[script+0x19]:0,pc=script>=0?m.readUInt32LE(script+0x20):0,callback=script>=0?m.readUInt32LE(script+0x1c):0;
  let site=mode===2?sites.get(pc-0x02000000-program):undefined;
  if(site?.kind==='input'&&callback!==0x021548e1)site=undefined;
  if(site?.kind==='printing'){printings.add(`${site.stepId}:${site.page}`);if(site.stepId==='guide-talk'&&site.page===0&&!waits.length)firstHoldArmed=true;}
  const same=(a:Site|undefined,b:Site|undefined)=>a?.kind===b?.kind&&a?.stepId===b?.stepId&&a?.page===b?.page;
  if(!same(site,lastSite)){
    if(activeWait){activeWait.end=frame;assert.ok(activeWait.end-activeWait.start>=180,'Dialogue advanced without a fresh confirmation.');activeWait=undefined;}
    if(activeTimed){activeTimed.end=frame;assert.ok(frame-activeTimed.start>=activeTimed.hold*2-2,'Timed text closed too early.');activeTimed=undefined;}
    if(site?.kind==='input'){activeWait={...site,start:frame,poses:structuredClone(poses),camera:camera<0?undefined:Array.from(m.subarray(camera+0x24,camera+0x58))};waits.push(activeWait);console.log('wait',frame,site);}
    if(site?.kind==='timed'){activeTimed={...site,start:frame};timed.push(activeTimed);console.log('timed',frame,site);}
  }
  if(activeWait){assert.deepEqual(poses,activeWait.poses,'An actor moved while dialogue held the tour.');if(activeWait.camera)assert.deepEqual(Array.from(m.subarray(camera+0x24,camera+0x58)),activeWait.camera,'Camera moved during a dialogue hold.');frozenFrames++;}
  if(camera>=0&&handoff<0&&waits.length===3&&waits.every(w=>w.end!==undefined)&&m.readUInt32LE(camera+0x1c)!==0){handoff=frame;console.log('handoff',frame);}
  if(frame>1100)rows.push({frame,input,mode,pc,callback,site,poses});
  const capture=activeWait&&[60,150].includes(frame-activeWait.start)||activeTimed&&frame-activeTimed.start===30||handoff>=0&&frame===handoff+30;
  if(capture){const image=new PNG({width:256,height:192}),fb=core._getSymbol(4)>>>0;image.data=Buffer.from(core.HEAPU8.slice(fb,fb+256*192*4));await fs.writeFile(`${out}/${frame}.png`,PNG.sync.write(image));
    if(activeWait||activeTimed){
      // Fixture balloons use the lower screen position. Inspect only their white
      // interior, excluding border/tail: a VM wait alone also passes for blank text.
      let ink=0;for(let y=154;y<181;y++)for(let x=14;x<241;x++){const at=(y*256+x)*4;if(Math.max(...image.data.subarray(at,at+3))<180)ink++;}
      assert.ok(ink>100,'Native dialogue balloon contains no visible text.');
      const page=activeWait??activeTimed;visiblePages.set(`${page.stepId}:${page.page}`,ink);
    }
  }
  lastSite=site;if(frame%300===0)console.log(frame,program,script,site);
}
await fs.writeFile(`${out}/trace.json`,JSON.stringify(rows));
assert.deepEqual(fatal,[]);assert.ok(script>=0,'No field script VM was identified.');assert.equal(printings.size,4,'Not every authored dialogue page printed.');assert.equal(visiblePages.size,4,'Not every authored dialogue page has visible native text.');assert.equal(waits.length,3);assert.equal(timed.length,1);assert.ok(handoff>=0,'No camera handoff after dialogue.');
const final=fieldScenePlayerPath(scene).at(-1)!;assert.ok(lastPoses.player[0]/4096<final.tileX*16+8,'Player movement did not resume.');
assert.ok(lastPoses.guide&&!lastPoses.visitor,'NPC stay/remove cleanup failed.');
const result={passed:true,waits,timed,printingPages:[...printings],visibleTextPixels:Object.fromEntries(visiblePages),heldInputIgnored:true,frozenActorCameraFrames:frozenFrames,handoffFrame:handoff,inputRestored:true,nativeVm:'0x'+(script+0x02000000).toString(16)};
await fs.writeFile(`${out}/validation.json`,JSON.stringify(result,null,2));console.log(result);
