// Isolated emulator smoke test. Only the bundled fixture save is used in RAM.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, patchTestBattleSaveBadges } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerFirstMove, patchTestBattleSavePlayerParty, decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { installCGearQuickActions, CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG } from "../../src/pokeweb/cgearQuickActionsModel";
import { ensureCGearButtons } from "../../src/pokeweb/cgearButtonsModel";
import { actionFor, newButton, type ActionId } from "../../src/cgearButtons/document";
import { untile } from "../../src/cgearButtons/compiler";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { createNarcStore } from "../../src/pokeweb/projectStore";
import { updateHeaderField } from "../../src/pokeweb/headerModel";
import { installMenuEvolution } from "../../src/pokeweb/menuEvolutionModel";
import { installLearnsetViewer } from "../../src/pokeweb/learnsetViewerModel";
import { installSummaryStatViewer } from "../../src/pokeweb/summaryStatViewerModel";
import { installPortaPc } from "../../src/pokeweb/portaPcModel";
const actionArg=process.argv.indexOf("--action");
const actionId=actionArg<0?undefined:process.argv[actionArg+1] as ActionId;
const selectedAction=actionId? actionFor(actionId):undefined;
if(actionId&&!selectedAction)throw new Error("Unknown action");
const input=process.argv[2];if(!input) throw new Error("Pass clean B2/W2 ROM.");
const scenarioArg=process.argv.indexOf('--scenario');
const scenario=scenarioArg<0?'default':process.argv[scenarioArg+1];
const radarSuffix=['--radar-zone','--radar-x','--radar-z'].map(name=>{const i=process.argv.indexOf(name);return i<0?'':`-${name.slice(8)}${Number(process.argv[i+1])}`;}).join('');
const out=new URL(`./build/emulator-${input.toLowerCase().includes("black")?"B2":"W2"}-${scenario}${actionId?`-${actionId}`:""}${process.argv.includes("--power-on")?"-on":"-off"}${process.argv.includes("--eight")?"-eight":""}${radarSuffix}/`,import.meta.url);await mkdir(out,{recursive:true});
globalThis.fetch=(async(v:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(v instanceof URL?v:new URL(v instanceof Request?v.url:String(v)))))) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),"quick-actions.nds",{selectedNarcs:[]});
const design=ensureCGearButtons(project).document;
const pcPoint=[design.buttons[1].x,design.buttons[1].y] as [number,number];
if(selectedAction)Object.assign(design.buttons[0],{label:selectedAction.label,action:selectedAction.id,flag:undefined});
if(process.argv.includes('--eight')){let added=0;while(design.buttons.length<8)design.buttons.push(newButton(design,["dowsing","rod","medals","recorder"][added++%4] as ActionId));}
if(process.argv.includes('--enhanced'))await installMenuEvolution(project);
if(process.argv.includes('--companions')) {
  await installLearnsetViewer(project);await installSummaryStatViewer(project);await installPortaPc(project);
}
if(process.argv.includes('--pokenav-fixture')) {
  const r=new NintendoDSRom(project.originalRomBytes!,{fileData:"view"}),id=r.fileId('a/1/2/7'),arc=new NARC(r.files[id]);
  const data=new Uint8Array(928);
  for(let season=0;season<4;season++) {
    const at=season*232;data.set([10,10,10,10,10,10,10,0],at);
    for(let method=0;method<7;method++)for(let i=0;i<(method<3?12:5);i++) {
      const offset=at+(method<3?8+method*48:152+(method-3)*20)+i*4;
      let species=method===0?[1,25,133,172][season]+i:method===1?(i<3?25:1+i):method===2?133:method===3?[550,550,129,118,194][i]:method===4?550:method===5?118+i:i===4?131:129;
      const form=method===3&&i===1||method===4?1:0;species|=form<<11;
      data[offset]=species&255;data[offset+1]=species>>8;data[offset+2]=5;data[offset+3]=9;
    }
  }
  const option=process.argv.indexOf('--radar-zone'),zone=option<0?427:Number(process.argv[option+1]);
  const headers=new NARC(r.files[r.fileId('a/0/1/2')]).files[0],encounter=(headers[zone*48+20]|headers[zone*48+21]<<8)&8191;
  arc.files[encounter]=data;project.narcs.encounters=createNarcStore('encounters','a/1/2/7',id,arc);project.narcs.encounters.dirty.add(encounter);
}
if(process.argv.includes('--pokenav-empty-map')){
  updateHeaderField(project,428,'enc_data_id','65535');
}
await installCGearQuickActions(project);
const downloads=await buildQuickLaunchDownloads(project),romBytes=downloads.romBytes;
const compiledRom=new NintendoDSRom(romBytes,{fileData:"view"}),compiledArchive=new NARC(compiledRom.files[compiledRom.fileId("quick-actions/ui.narc")]);
if(process.env.QUICK_ACTIONS_DEBUG){const r=new NintendoDSRom(romBytes,{fileData:"view"}),a=new NARC(r.files[r.fileId("quick-actions/ui.narc")]);console.log('ROM button header',Buffer.from(a.files[0]).toString('hex'));}
const fixtureArg=process.argv.indexOf('--fixture-copy');
const baseFixture=patchTestBattleSaveBadges(downloads.saveBytes,getTestBattleConfigForProject(project));
const hmNoFly=selectedAction?.id==='mapFlyHm'&&process.argv.includes('--no-fly');
const saveBytes=fixtureArg<0?(hmNoFly?patchTestBattleSavePlayerParty(baseFixture,project,'Oshawott\nLevel: 20\n- Tackle\n\nPikachu\nLevel: 15\n- Tackle'):patchTestBattleSavePlayerFirstMove(baseFixture,project,process.argv.includes('--no-fly')?0:19)):new Uint8Array(await readFile(process.argv[fixtureArg+1]));
if(hmNoFly){
  const moves=Array.from({length:saveBytes[0x18e04]},(_,i)=>{const at=0x18e08+i*220,b=decryptPk5Party(saveBytes.subarray(at,at+220));return Array.from({length:4},(_,n)=>b[0x28+n*2]|b[0x29+n*2]<<8);});
  if(moves.flat().includes(19))throw new Error('HM Fly fixture still contains a Fly user');console.log('Verified HM Fly fixture party has no Fly:',JSON.stringify(moves));
}
function crc(b:Uint8Array) {let c=0xffff;for(const v of b) {c^=v<<8;for(let n=0;n<8;n++) c=c&0x8000?(c<<1)^0x1021:c<<1;c&=0xffff;}return c;}
const fixture=Buffer.from(saveBytes.buffer,saveBytes.byteOffset,saveBytes.length);
const radarZoneArg=process.argv.indexOf('--radar-zone');
const radarZone=radarZoneArg<0?undefined:Number(process.argv[radarZoneArg+1]);
const radarHeaders=radarZone===undefined?undefined:new NARC(compiledRom.files[compiledRom.fileId('a/0/1/2')]).files[0];
const numericOption=(name:string,fallback:number)=>{const i=process.argv.indexOf(name);return i<0?fallback:Number(process.argv[i+1]);};
// Enable obtained status only in the isolated fixture. The original bundled
// fixture and every user's save stay untouched. Fix native block checksums.
for(const half of [0,0x26000]) {
  if(radarZone!==undefined){
    if(!Number.isInteger(radarZone)||radarZone<0||!radarHeaders||radarZone*48+48>radarHeaders.length)throw new Error('Invalid radar fixture zone');
    const header=Buffer.from(radarHeaders),row=radarZone*48;
    const x=numericOption('--radar-x',header.readInt32LE(row+36)),y=header.readInt32LE(row+40),z=numericOption('--radar-z',header.readInt32LE(row+44));
    fixture.writeUInt32LE(radarZone,half+0x19580);fixture.fill(0,half+0x19584,half+0x19590);
    fixture.writeUInt16LE(x,half+0x19586);fixture.writeUInt16LE(y,half+0x1958a);fixture.writeUInt16LE(z,half+0x1958e);
    // Continue uses the start LOCATION to load its matrix, then PLAYERWORK_SAVE
    // for the avatar. Keep both records in the same zone and tile.
    const start=half+0x19500;fixture.fill(0,start,start+28);fixture.writeUInt32LE(1,start);
    fixture.writeUInt16LE(radarZone,start+4);fixture.writeInt16LE(-1,start+6);fixture.writeInt16LE(2,start+8);
    for(const [at,value]of [[start+16,(x+.5)*65536],[start+20,y*65536],[start+24,(z+.5)*65536],[half+0x19584,(x+.5)*65536],[half+0x19588,y*65536],[half+0x1958c,(z+.5)*65536]])fixture.writeUInt32LE(value,at);
    const positionCrc=crc(fixture.subarray(half+0x19500,half+0x195a8));fixture.writeUInt16LE(positionCrc,half+0x195aa);fixture.writeUInt16LE(positionCrc,half+0x25f38);
  }
  for(const id of [442,...process.argv.includes('--bicycle')?[450]:[],...process.argv.includes('--eight')?[471,447,627,465]:[],...selectedAction?.item&&selectedAction.item!==421?[selectedAction.item]:[]]) {
    let slot=-1;
    for(let n=0;n<83;n++) {const at=half+0x18400+310*4+n*4,current=fixture.readUInt16LE(at);if(current===id){slot=at;break;}if(current===0 && slot<0)slot=at;}
    if(slot<0)throw new Error('No empty key-item fixture slot');const remove=id===442&&process.argv.includes('--no-map');
    fixture.writeUInt16LE(remove?0:id,slot);fixture.writeUInt16LE(remove?0:1,slot+2);
  }
  if(selectedAction?.id==='mapFlyHm') {
    // HM02 belongs to the native TM/HM pocket, not the key-item pocket.
    let slot=-1;
    for(let n=0;n<109;n++){const at=half+0x18400+0x624+n*4,current=fixture.readUInt16LE(at);if(current===421){slot=at;break;}if(!current&&slot<0)slot=at;}
    if(slot<0)throw new Error('No empty TM/HM fixture slot');
    const owned=!process.argv.includes('--no-hm');fixture.writeUInt16LE(owned?421:0,slot);fixture.writeUInt16LE(owned?1:0,slot+2);
  }
  const bagCrc=crc(fixture.subarray(half+0x18400,half+0x18dec));fixture.writeUInt16LE(bagCrc,half+0x18dee);fixture.writeUInt16LE(bagCrc,half+0x25f32);
  const flag=CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG,at=half+0x1ff00+0x35e+(flag>>3);
  if(process.argv.includes('--hide-pc'))fixture[at]|=1<<(flag&7);else if(fixtureArg<0)fixture[at]&=~(1<<(flag&7));
  const eventCrc=crc(fixture.subarray(half+0x1ff00,half+0x203e0));fixture.writeUInt16LE(eventCrc,half+0x203e2);fixture.writeUInt16LE(eventCrc,half+0x25f5a);
  if(process.argv.includes('--bundled-cgear')){
    if(fixture[half+0x1c02e]!==1||fixture[half+0x1c02f]!==1)throw new Error('Bundled fixture does not enable C-Gear');
  }else{fixture[half+0x1c02f]=1;fixture[half+0x1c02e]=process.argv.includes("--power-on")?1:0;}
  const c=crc(fixture.subarray(half+0x1c000,half+0x1c094));fixture.writeUInt16LE(c,half+0x1c096);fixture.writeUInt16LE(c,half+0x25f40);
  fixture.writeUInt16LE(crc(fixture.subarray(half+0x25f00,half+0x25f94)),half+0x25fa2);
}
const corePath=new URL("../../public/desmond/desmond.js",import.meta.url), source=await readFile(corePath,"utf8");
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r);const fatal:string[]=[];
const log=(...a:unknown[])=>{if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(a.join(" ")))fatal.push(a.join(" "));};
const ctx=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:fileURLToPath(corePath),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')),ctx);await initialized;const core=ctx.Module;
core._main(0,0);const size=Math.max(romBytes.length,128*1024*2**romBytes[0x14]),ptr=core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes,ptr);core.HEAPU8.fill(255,ptr+romBytes.length,ptr+size);core.HEAPU8.set(saveBytes,core._savGetPointer(saveBytes.length));core._savUpdateChangeFlag();
if(core._loadROM(size)!==1)throw new Error("Emulator rejected ROM");
const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
function locateSession(m:Buffer):number {
  let p=m.length;
  while((p=m.lastIndexOf(Buffer.from([0x43,0x51,0x41,0x53]),p-1))>=0){
    if(p+868>m.length)continue;
    const sub=m.readUInt32LE(p+4)-0x02000000;
    if(sub>=0&&sub<m.length-36&&m[p+733]<=8&&m.readUInt32LE(sub+32)>=0x02000000&&m.readUInt32LE(sub+32)<0x02400000)return p;
  }
  return -1;
}
const trace:unknown[]=[];
type Input={frame:number;touch?:[number,number];buttons?:number;duration?:number};
const rimPoint=(degrees:number):[number,number]=>[128+Math.round(125*Math.cos(degrees*Math.PI/180)),96+Math.round(125*Math.sin(degrees*Math.PI/180))];
const turnDial=(frame:number,from=0,to=15,samples=12):Input[]=>Array.from({length:samples},(_,i)=>({frame:frame+i*2,touch:rimPoint(from+(to-from)*i/(samples-1)),duration:2}));
const extras:Record<string,Input[]>={
  idle:[],
  default:[{frame:790,touch:[128,10]},{frame:930,touch:[128,10]},{frame:1480,touch:[128,10]},{frame:1600,touch:[128,10]},{frame:2700,touch:[88,152]},{frame:2820,touch:[88,152]}],
  pc:[{frame:1000,touch:pcPoint},{frame:1120,buttons:128},{frame:1240,buttons:128},{frame:1360,buttons:128},{frame:1480,buttons:128},{frame:1600,buttons:128},{frame:1780,buttons:64},{frame:1900,buttons:64},{frame:2020,buttons:64},{frame:2140,buttons:64},{frame:2260,buttons:64},{frame:2420,buttons:4},{frame:2460,buttons:4},{frame:2500,buttons:4},{frame:2540,buttons:4},{frame:2600,buttons:128},{frame:2760,buttons:128}],
  pcDirect:[{frame:1000,touch:pcPoint},{frame:1280,buttons:64},{frame:1600,touch:pcPoint},{frame:1780,buttons:4},{frame:1840,buttons:4},{frame:1900,buttons:128},...Array.from({length:9},(_,i)=>({frame:2450+i*150,buttons:64}))],
  travel:[{frame:1000,touch:[172,152]},{frame:1200,buttons:128},{frame:1280,buttons:128},{frame:1400,buttons:128},{frame:1700,buttons:128},{frame:1820,buttons:128}],
  map:[{frame:1000,touch:[172,152]},{frame:1400,buttons:64}],
  bike:[{frame:1000,touch:[88,152]},{frame:1250,touch:[88,152]}],
  mute:[{frame:1000,touch:[215,163],duration:35},{frame:1350,touch:[172,152]},{frame:1700,buttons:64},{frame:1900,buttons:64},{frame:2200,touch:[215,163]}],
  save:[{frame:850,touch:[60,116]},{frame:1000,buttons:512},{frame:1250,touch:[64,140]},{frame:1370,buttons:128},{frame:1490,buttons:128},{frame:1610,buttons:128},{frame:1800,buttons:128},{frame:1900,buttons:128}],
  action:[{frame:1000,touch:[60,116]},...Array.from({length:7},(_,i)=>({frame:1250+i*150,buttons:64}))],
  radar:[{frame:1000,touch:[60,116],duration:30},{frame:1150,touch:[60,116]}],
  skins:Array.from({length:18},(_,i)=>turnDial(1000+i*80)).flat(),
  skinFeedback:[...turnDial(1000),{frame:1024,touch:rimPoint(15),duration:11},...turnDial(1100),{frame:1200,touch:[60,116]}],
  dial:[{frame:950,touch:[208,18]},...turnDial(1000,0,27,30),{frame:1060,touch:rimPoint(27),duration:30},...turnDial(1200,0,-15,20),...turnDial(1300,-12.6,.6,20),{frame:1600,touch:[188,60]},{frame:1900,buttons:64},{frame:2200,touch:pcPoint},{frame:2500,buttons:64},{frame:2800,touch:[172,152]},{frame:3150,buttons:64}],
  layout:[{frame:1000,touch:[228,144]},{frame:1040,touch:[160,88]},{frame:1044,touch:[224,112],duration:28},{frame:1150,buttons:3072,duration:60},{frame:1300,touch:[60,116]},{frame:1304,touch:[80,128],duration:24},{frame:1450,touch:[228,144]}],
  saveIcon:[{frame:850,touch:[60,116]}, {frame:1000,touch:[200,180]}, {frame:1280,buttons:64}, {frame:1620,touch:[200,180]}, {frame:1900,buttons:128}, {frame:2020,buttons:128}, {frame:2220,buttons:128}, {frame:2440,buttons:128}, {frame:2640,buttons:128}, {frame:2840,buttons:128}, {frame:3040,buttons:128}],
  pokenavEmpty:[{frame:1000,touch:[60,116]},{frame:1250,buttons:64},{frame:1500,touch:[60,116]},{frame:1740,touch:[220,184]}],
  pokenavPartial:[{frame:1000,touch:[60,116]},{frame:1200,touch:[100,104]},{frame:1350,touch:[40,64]},{frame:1500,buttons:64}],
  pokenav:[{frame:1000,touch:[60,116]},{frame:1200,touch:[100,104]},{frame:1240,buttons:1},{frame:1280,buttons:2},{frame:1320,buttons:1},{frame:1360,buttons:1},{frame:1400,buttons:1},{frame:1440,touch:[100,24]},{frame:1480,buttons:1},{frame:1520,buttons:1},{frame:1560,buttons:1},{frame:1600,buttons:1},{frame:1640,touch:[80,64]},{frame:1680,buttons:128},{frame:1720,touch:[100,104]},{frame:1760,buttons:2},{frame:1800,buttons:2},{frame:1840,touch:[224,160]},{frame:1880,buttons:8},{frame:1920,buttons:4},{frame:1960,buttons:64},{frame:2140,touch:[60,116]},{frame:2320,touch:[220,184]},{frame:2480,touch:[60,116]},{frame:2580,buttons:64}],
  party:[{frame:1000,touch:[188,60]}, {frame:1450,buttons:64}, {frame:1800,touch:[188,60]}, {frame:2250,buttons:64}],
  reload:[],gates:[]
};
if(scenario==='skins')extras.skins.push(...extras.pc.map(v=>({...v,frame:v.frame+1600})),...extras.map.map(v=>({...v,frame:v.frame+3500})));
if(selectedAction?.id==='mapFlyHm'&&scenario==='travel')extras.travel[0].touch=[60,116];
if(scenario==='layout')extras.layout.push(...extras.save.filter(v=>v.frame>=1000).map(v=>({...v,frame:v.frame+600})));
if(actionId==='dowsing')extras.action.push({frame:1650,touch:[244,180]});
if(actionId==='recorder')extras.action.push({frame:1200,touch:[128,130]},{frame:1650,touch:[128,150]});
if(process.argv.includes('--repeat')) {
  const first=extras[scenario];extras[scenario]=[...first,...first.map(v=>({...v,frame:v.frame+2800}))];
}
if(!(scenario in extras))throw new Error('Unknown emulator scenario');
const inputOffset=process.argv.includes("--power-on")?0:300;
const frameCount=Number(process.env.QUICK_ACTIONS_FRAMES ?? 2600)+inputOffset;
let lastSession=-1;let bikeMounted=false,bikeDismounted=false;
let radarSpawn:unknown;
function phenomenon(m:Buffer){
  const s=locateSession(m);if(s<0)throw new Error('Radar lost the C-Gear session');
  const sub=m.readUInt32LE(s+4)-0x2000000,field=m.readUInt32LE(sub+20)-0x2000000,game=m.readUInt32LE(field+8)-0x2000000;
  const state=m.readUInt32LE(game+0x220)-0x2000000,enc=m.readUInt32LE(field+0x98)-0x2000000,effect=m.readUInt32LE(enc+16)-0x2000000;
  return {valid:!!(m[state+0x25]&15),zone:m.readUInt16LE(state+0x18),x:m.readInt16LE(state+0x1a),y:m.readInt16LE(state+0x1c),z:m.readInt16LE(state+0x1e),type:m[state+0x24],task:m.readUInt32LE(effect+0x5b4)};
}
const pokenavFrames=[1150,1244,1284,1324,1364,1404,1444,1484,1524,1564,1604,1644,1764,1804,1844,1884,1924,2300,2550];
// Generated by pokenav:verify from each ROM's actual icon/palette routines.
const iconReference=process.argv.includes('--pokenav-fixture')?JSON.parse(await readFile(new URL(`../pokenav/build/icon-reference-${project.session.baseVersion}.json`,import.meta.url),'utf8')) as {palettes:number[];icons:Record<string,{bank:number;pixels:string}>}:undefined;
let partyBefore:Buffer|undefined,partyOffset=-1;
function navRequest(m:Buffer){
 let at=-1,request=-1;
 while((at=m.indexOf(Buffer.from([0x4c,0x53,0x56,0x31,3,0,4,1]),at+1))>=0){const p=at-28;if(p>=0&&m.readUInt32LE(p+16)===0x2000000+p+168){request=p;break;}}
 if(request<0)throw new Error('Pokenav request is not active');
 let cursor=-1,work=-1;const ptr=Buffer.alloc(4);ptr.writeUInt32LE(request+0x2000000);
 while((cursor=m.indexOf(ptr,cursor+1))>=0)if(cursor+0x228<m.length){const w=m.readUInt32LE(cursor+0x38)-0x2000000,font=m.readUInt32LE(cursor+0x60)-0x2000000;if(w>=0&&w<m.length-16&&font>=0&&font<m.length-16){work=cursor;break;}}
 if(work<0)throw new Error('Pokenav native window owner is missing');
 return {request,work};
}
function navState(m:Buffer){
 const {request,work}=navRequest(m);const ptr=Buffer.alloc(4);let cursor=-1;
 const species=m.readUInt16LE(request+244),form=m.readUInt16LE(request+246);ptr.writeUInt32LE(work+0x2000000);cursor=-1;
 while((cursor=m.indexOf(ptr,cursor+1))>=0)if(cursor+360<m.length&&m.readUInt16LE(cursor+4)===species&&m.readUInt16LE(cursor+6)===form&&m[cursor+10]===1){
   let cue='';for(let i=0;i<12;i++){const c=m.readUInt16LE(cursor+332+i*2);if(c===65535||!c)break;cue+=String.fromCharCode(c);}
   if(cue===`${m[cursor+8]}%`)return {species,form,chance:m[cursor+8],cue};
 }
 throw new Error('Pokenav species info/percentage is missing');
}
for(let frame=0;frame<frameCount;frame++) {
  const activeFrame=frame-inputOffset;
  if(scenario==='pokenav'&&activeFrame===999){
    const m=ram(),session=locateSession(m);if(session<0)throw new Error('Missing field fixture');const sub=m.readUInt32LE(session+4)-0x2000000,field=m.readUInt32LE(sub+20)-0x2000000,game=m.readUInt32LE(field+8)-0x2000000;
    partyOffset=m.readUInt32LE(game+0x194)-0x2000000;
    if(process.argv.includes('--empty-party'))m.writeUInt32LE(0,partyOffset+4);
    partyBefore=Buffer.from(m.subarray(partyOffset,partyOffset+1328));
  }

  // Quick-launch boots native wireless on. Use its original power event solely
  // to prepare the off fixture, then restore the Save replacement before tests.
  const powerInputs:Input[]=process.argv.includes("--power-on")?[]:[{frame:650,touch:[200,180]},{frame:900,touch:[220,60]}];
  if(!process.argv.includes("--power-on")&&(frame===650||frame===1100)){const m=ram(),s=locateSession(m);if(s<0)throw new Error("No C-Gear fixture at power setup");m[s+1401]=frame===650?0:1;}
  const extra=[...powerInputs,...extras[scenario].map(v=>({...v,frame:v.frame+inputOffset}))].find(v=>frame>=v.frame&&frame<v.frame+(v.duration??4));
  const touch=extra?.touch ?? (scenario!=='default'?null:frame>=850&&frame<854 ? [60,116] : frame>=910&&frame<914 ? [60,116] : frame>=970&&frame<974 ? [228,144] : frame>=1020&&frame<1024 ? [60,116] : frame>=1024&&frame<1040 ? [70,120] : frame>=1080&&frame<1084 ? [228,144] : frame>=1120&&frame<1124 ? [196,176] : frame>=1400&&frame<1404 ? [205,62] : frame>=1500&&frame<1504 ? [228,144] : frame>=1560&&frame<1564 ? [228,144] : frame>=1650&&frame<1654 ? [196,116] : frame>=2250&&frame<2254 ? [172,152] : null);
  const buttons=extra?.buttons ?? (scenario!=='default'?0:frame>=1220&&frame<1224||frame>=1400&&frame<1404?128:frame>=2020&&frame<2024||frame>=2080&&frame<2084||frame>=2140&&frame<2144||frame>=2450&&frame<2454?64:0);
  core._runFrame(1,buttons,touch?1:0,touch?.[0]??0,touch?.[1]??0);
  if(process.env.QUICK_ACTIONS_DEBUG&&[1150,1599].includes(activeFrame)){await writeFile(new URL(`ram-${activeFrame}.bin`,out),ram());const length=core._saveState(0);await writeFile(new URL(`debug-${activeFrame}.dst`,out),Buffer.from(core.HEAPU8.buffer,core._stateGetPointer(0),length));}
  if(scenario==='mute'&&[999,1040,1100,1300,2100,2240].includes(activeFrame)){
    const m=ram(),s=locateSession(m);if(s<0||!m[s+160])throw new Error('Mute lost C-Gear');
    const expected=activeFrame>=1000&&activeFrame<2200?1:0;
    if(m[s+1404]!==1||m[s+1405]!==expected)throw new Error(`Mute state ${m[s+1405]} at ${activeFrame}; expected ${expected}`);
    const sub=m.readUInt32LE(s+4)-0x02000000,work=m.readUInt32LE(sub+32)-0x02000000,actor=m.readUInt32LE(work+0x8c)-0x02000000;
    if(m.readUInt16LE(actor+0x5a)!==(expected?9:8)||!(m.readUInt32LE(actor+0x60)&0x02000000))throw new Error(`Music icon did not hold its ${expected?'muted':'audible'} animation`);
    console.log('mute',activeFrame,m[s+1405]);
  }
  if(scenario==='pokenav'&&pokenavFrames.includes(activeFrame)){
    const state=navState(ram());console.log('pokenav',activeFrame,JSON.stringify(state));
    if(process.argv.includes('--pokenav-fixture')){
      const expected:Record<number,number>={1150:20,1244:50,1284:20,1324:50,1364:100,1404:100,1444:60,1484:100,1524:60,1564:99,1604:99,1644:1,1764:50,1804:20,1844:1,1884:10,1924:1,2300:20,2550:20};
      if(state.chance!==expected[activeFrame])throw new Error(`Pokenav chance ${state.chance}, expected ${expected[activeFrame]} at ${activeFrame}`);
      if(activeFrame===1484&&(state.species!==550||state.form!==1))throw new Error('Pokenav lost the encounter form');
      if(activeFrame===1150&&iconReference){
        const icon=iconReference.icons[String(state.species)];if(!icon)throw new Error('Missing native icon color reference');
        const raw=Buffer.from(icon.pixels,'hex'),fb=core._getSymbol(4)>>>0;let compared=0;
        for(let y=0;y<32;y++)for(let x=0;x<32;x++){
          const byte=raw[((y>>3)*4+(x>>3))*32+(y&7)*4+((x&7)>>1)],ink=(byte>>((x&1)*4))&15;if(!ink)continue;
          const color=iconReference.palettes[icon.bank*16+ink],pixel=fb+((192+112+y)*256+8+x)*4;
          for(let channel=0;channel<3;channel++){const c=(color>>(channel*5))&31,expected=(c<<3)|(c>>2);if(Math.abs(core.HEAPU8[pixel+channel]-expected)>1)throw new Error(`Bottom icon palette mismatch at ${x},${y}, channel ${channel}`);}
          compared++;
        }
        if(compared<30)throw new Error('Native icon color comparison was empty');
        console.log('pokenav native icon colors',compared,'opaque pixels matched');
      }
    }
    if(partyBefore&&!ram().subarray(partyOffset,partyOffset+1328).equals(partyBefore))throw new Error('Pokenav changed the party');
  }
  if(scenario==='pokenavEmpty'&&[1150,1700].includes(activeFrame)){
    const m=ram();let at=-1,found=false;
    while((at=m.indexOf(Buffer.from([0x50,0x4e,0x41,0x56,1,0,248,0]),at+1))>=0){
      if(m.readUInt16LE(at+8)!==427||m[at+12]!==1||m[at+13]!==0)continue;
      if(m[at+14]||m.subarray(at+16,at+248).some(v=>v!==0))throw new Error('Empty map retained native encounter data');
      found=true;break;
    }
    if(!found)throw new Error('Empty-map Pokenav did not open');
    console.log('pokenav empty map',activeFrame,'no native encounter tables');
  }
  if(scenario==='pokenavPartial'&&[1150,1240,1400].includes(activeFrame)){
    const m=ram();
    if(activeFrame===1240){
      const {request,work}=navRequest(m);
      if(m.readUInt16LE(request+244))throw new Error('Empty section retained its species preview');
      for(let i=0;i<2;i++){
        const actor=m.readUInt32LE(work+0x124+i*4)-0x2000000;
        if(m.readUInt32LE(actor+0x60)&(1<<26))throw new Error('Empty section retained a type badge');
      }
      console.log('pokenav empty section cleared');
    }else console.log('pokenav populated section',activeFrame,JSON.stringify(navState(m)));
  }
  if(fatal.length)throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
  if(scenario==='dial'){
    const m=ram(),s=locateSession(m);
    if(s>=0&&m[s+160]){
      const sub=m.readUInt32LE(s+4)-0x02000000,work=m.readUInt32LE(sub+32)-0x02000000;
      for(let i=0;i<6;i++){
        const actor=m.readUInt32LE(work+0x6c+i*4)-0x02000000;
        if(actor>=0&&actor<m.length-0x64&&(m.readUInt32LE(actor+0x60)&0x04000000))throw new Error(`Clock/decal actor ${i} visible at frame ${frame}`);
      }
    }
  }
  if(scenario==='radar'&&[999,1004,1040,1200].includes(activeFrame)){
    const info=phenomenon(ram());console.log('phenomenon',activeFrame,JSON.stringify(info));
    if(activeFrame===999&&info.valid)throw new Error('Radar fixture already has a phenomenon before pressing');
    if(activeFrame===1004){if(!info.valid)throw new Error('Radar did not generate an immediate phenomenon');radarSpawn=info;}
    if(activeFrame>1004&&JSON.stringify(info)!==JSON.stringify(radarSpawn))throw new Error('Held/repeated Radar changed the existing phenomenon');
  }
  if(scenario==='layout' && [1080,1215,1340].includes(activeFrame)) {
    const m=ram(),s=locateSession(m);if(s<0)throw new Error('Layout lost native session');
    const i=activeFrame===1340?0:7,expected=activeFrame===1080?[225,113]:activeFrame===1215?[160,88]:[81,129];
    if(m[s+120+i*2]!==expected[0]||m[s+121+i*2]!==expected[1])throw new Error(`Layout frame ${activeFrame}: expected ${expected}, found ${m[s+120+i*2]},${m[s+121+i*2]}; resetFrames ${m.readUInt16LE(s+736)}`);
  }
  if(scenario==='skins' && activeFrame>=1040 && activeFrame<=2400 && (activeFrame-1040)%80===0) {
    const m=ram(),s=locateSession(m),cycle=(activeFrame-1040)/80+1;
    const expected=cycle%16,actual=s<0?-1:m.readUInt16LE(s+1380);
    if(actual!==expected)throw new Error(`Skin cycle ${cycle}: expected ${expected}, found ${actual}`);
    if(expected) {
      const buffer=m.readUInt32LE(s+1396)-0x02000000;
      if(!m.subarray(buffer,buffer+0x2600).equals(Buffer.from(compiledArchive.files[15+expected])))throw new Error(`Skin ${expected} source was not retained`);
    }
  }
  if(scenario==='skinFeedback'&&[1004,1016,1040,1104,1140].includes(activeFrame)){
    const m=ram(),s=locateSession(m);if(s<0)throw new Error('Feedback lost native session');
    const expected=[1004,1104].includes(activeFrame);
    if(Boolean(m[s+1407])!==expected)throw new Error(`Dial capture incorrect at ${activeFrame}`);
  }
  if(scenario==='dial'&&[990,1010,1050,1080,1120,1260,1360,2100,2700,3350].includes(activeFrame)){
    const m=ram(),s=locateSession(m);if(s<0)throw new Error('Dial lost C-Gear session');
    const skin=m.readUInt16LE(s+1380),expected=activeFrame<1050?0:activeFrame<1080?1:activeFrame<1260?2:activeFrame<1360?1:2;
    if(skin!==expected)throw new Error(`Dial skin ${skin}, expected ${expected}, frame ${activeFrame}`);
    const captured=[1010,1050,1080].includes(activeFrame),actor=m.readUInt32LE(s+1424)-0x02000000;
    if(Boolean(m[s+1407])!==captured||actor<0||actor>=m.length-0x64||Boolean(m.readUInt32LE(actor+0x60)&0x04000000)!==captured)throw new Error(`Dial marker/capture mismatch at ${activeFrame}`);
    if(captured){const x=m.readInt16LE(s+1416),y=m.readInt16LE(s+1418);if(Math.abs(Math.hypot(x-128,y-96)-125)>2)throw new Error('Dial marker left rim');}
    if(m.readUInt32LE(m.readUInt32LE(s+4)-0x02000000+32)>=0x02000000){
      const work=m.readUInt32LE(m.readUInt32LE(s+4)-0x02000000+32)-0x02000000;
      if(m[work+0x2fe])throw new Error('Captured dial activated native wrench');
    }
    console.log('dial',activeFrame,JSON.stringify({skin,captured,marker:[m.readInt16LE(s+1416),m.readInt16LE(s+1418)]}));
  }
  // Check each transition frame: a screenshot every 120 frames can miss the
  // one-frame disappearance reported while mounting or dismounting.
  if(scenario==='bike' && activeFrame>=990) {
    const m=ram();if(lastSession<0)lastSession=locateSession(m);
    if(lastSession<0 || !m[lastSession+160])throw new Error(`Bike hid overlay at frame ${frame}`);
    const sub=m.readUInt32LE(lastSession+4)-0x02000000,field=m.readUInt32LE(sub+20)-0x02000000,game=m.readUInt32LE(field+8)-0x02000000;
    const riding=m.readUInt32LE(game+0x154);
    if(activeFrame>1000 && activeFrame<1250 && riding===1)bikeMounted=true;
    if(activeFrame>1250 && riding===0)bikeDismounted=true;
  }
  if(frame%120===0||frame===frameCount-1||[849,854,914,974,1041,1085,1150,1250,1399,1520,1580,1800,2240,2350,2599,3950].includes(frame)||scenario==='dial'&&[990,1010,1050,1080,1120,1260,1360,2100,2700,3350].includes(activeFrame)||scenario==='pcDirect'&&[1100,1400,1700,2250,3800].includes(activeFrame)||scenario==='skinFeedback'&&[999,1004,1016,1040,1104,1140,1240].includes(activeFrame)||scenario==='mute'&&[999,1041,1085,2240].includes(activeFrame)||scenario==='pokenav'&&pokenavFrames.includes(activeFrame)||scenario==='pokenavPartial'&&[1240,1400].includes(activeFrame)) {
    const png=new PNG({width:256,height:384}),fb=core._getSymbol(4)>>>0;png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));
    await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));
    const m=ram();let cgear=-1;
    for(let p=0;p<m.length-0x320;p+=4) if(m.readUInt32LE(p)===(project.session.baseVersion==="B2"?0x21ec98d:0x21ec9cd) && m[p+0x30b]<=1 && m[p+0x2fe]<=1 && m.readUInt32LE(p+0x14)>=0x02000000 && m.readUInt32LE(p+0x14)<0x02400000) {cgear=p;break;}
    const game=cgear>=0?m.readUInt32LE(cgear+20)-0x02000000:-1;
    const session=locateSession(m);
    const row={frame,error:session>=0?m[session+735]:null,buttonCount:session>=0?m[session+733]:null,visible:session>=0?m[session+160]:null,cgear,power:cgear>=0?m[cgear+0x30b]:null,edit:cgear>=0?m[cgear+0x2fe]:null,design:cgear>=0?m[cgear+0x300]:null,riding:game>=0&&game<0x400000-0x158?m.readUInt32LE(game+0x154):null,repelActive:session>=0&&(m[session+136]>>4)===1};trace.push(row);console.log(JSON.stringify(row));
    if(scenario==='pc' && [1150,3950].includes(frame) && (session<0 || !m[session+160]))throw new Error('PC dialog hid custom buttons');
    if(['idle','pc','pcDirect','map','travel','bike','gates','action','radar','skins','skinFeedback','dial','saveIcon','party','mute','pokenav','pokenavEmpty','pokenavPartial'].includes(scenario) && frame===frameCount-1) {
      if(cgear<0 || session<0 || !m[session+160])throw new Error('Custom buttons did not return with C-Gear');
      if(Boolean(row.power)!==process.argv.includes('--power-on'))throw new Error('C-Gear power state does not match this test');
      if(scenario==='skins' && m.readUInt16LE(session+1380)!==2)throw new Error('Selected skin did not survive PC and MAP return');
      if(scenario==='skinFeedback'&&m.readUInt16LE(session+1380)!==2)throw new Error('Held selector touch repeated the skin cycle');
      if(scenario==='dial'&&m.readUInt16LE(session+1380)!==2)throw new Error('Dial skin did not survive Party, PC and Map return');
      if(scenario==='idle'){
        const buffer=m.readUInt32LE(session+464)-0x02000000;
        for(const i of [1,4]){
          const pixels=untile(m.subarray(buffer+i*512,buffer+(i+1)*512));
          for(const [x,y] of [[4,4],[27,4],[4,27],[27,27]])if(pixels[y*32+x])throw new Error(`Button ${i} has a diagonal ring protrusion in its uploaded graphics`);
        }
      }
      const shown=[selectedAction?.id==='mapFlyHm'?!process.argv.includes('--no-hm'):true,!process.argv.includes('--hide-pc'),process.argv.includes('--bicycle'),!process.argv.includes('--no-map')];
      for(let i=0;i<design.buttons.length;i++)if(Boolean(m[session+725+i])!==(i<4?shown[i]:true))throw new Error(`Incorrect visibility gate for button ${i}`);
      // Validate every rendered caption locally, including unavailable poses.
      // Actor visibility alone misses native fade buffers overwriting palettes.
      for(let i=0;i<design.buttons.length;i++) {
        const pose=m[session+136+i]>>4;
        const c=m.readUInt16LE(session+468+i*32+(pose===3?28:16));
        const [r,g,b]=[c&31,c>>5&31,c>>10&31].map(n=>(n<<3)|(n>>2));
        const x=m[session+120+i*2],y=m[session+121+i*2];let pixels=0;
        for(let dy=-16;dy<16;dy++)for(let dx=-16;dx<16;dx++) {
          const p=((192+y+dy)*256+x+dx)*4;
          if(Math.abs(png.data[p]-r)<=1&&Math.abs(png.data[p+1]-g)<=1&&Math.abs(png.data[p+2]-b)<=1)pixels++;
        }
        const visible=Boolean(m[session+725+i]);
        if(visible && pixels<8)throw new Error(`Missing button ${i} (${design.buttons[i].label}) caption ${r}/${g}/${b}: ${pixels} pixels`);
        if(!visible && pixels)throw new Error(`Hidden button ${i} still has visible pixels`);
      }
    }
    if(scenario==='reload' && frame===frameCount-1 && (!row.repelActive || cgear<0))throw new Error('Saved Repel preference did not load');
    await writeFile(new URL("ram.bin",out),m);
  }
}
if(scenario==='bike' && (!bikeMounted||!bikeDismounted))throw new Error('Bike did not mount and dismount');
if(scenario==='pokenav'&&partyBefore&&!ram().subarray(partyOffset,partyOffset+1328).equals(partyBefore))throw new Error('Party changed after Pokenav exit');
const writeRom=process.argv.indexOf('--write-rom');if(writeRom>=0){const output=process.argv[writeRom+1];await writeFile(output,romBytes,{flag:'wx'});await writeFile(output.replace(/\.nds$/iu,'.sav'),saveBytes.subarray(0,524288),{flag:'wx'});}
await writeFile(new URL("trace.json",out),JSON.stringify(trace,null,2));console.log(fileURLToPath(out));
if(scenario==='save'||scenario==='layout'||scenario==='saveIcon') {
 const size=core._savGetSize(),ptr=core._savGetPointer(size)>>>0,saved=Buffer.from(core.HEAPU8.subarray(ptr,ptr+size));
 await writeFile(new URL('saved-fixture.dsv',out),saved);
 console.log('saved Options bits',saved.readUInt16LE(0x19400).toString(16),saved.readUInt16LE(0x26000+0x19400).toString(16));
 if(scenario==='saveIcon'){let found=false;for(const half of [0,0x26000])if(saved.readUInt16LE(half+0x1c038)===0xa000&&(saved.readUInt16LE(half+0x19400)&0x1000))found=true;if(!found)throw new Error('Save icon did not persist the custom layout and Repel preference');}
 if(scenario==='layout') {
   const marker=0x1c038;let matched=false;
   for(const half of [0,0x26000])if(saved.readUInt16LE(half+marker)===0xa000&&saved.readUInt16LE(half+marker+2)===1&&saved[half+marker+4]===81&&saved[half+marker+5]===129)matched=true;
   if(!matched)throw new Error('Custom position was not persisted by native saving');
 }
}
if(process.env.QUICK_ACTIONS_DEBUG) {
 console.log('symbols',Array.from({length:16},(_,i)=>[i,core._getSymbol(i)>>>0]));
 console.log('exports',Object.keys(core).filter(k=>k.startsWith('_')&&!k.startsWith('_emscripten')));
 const m=ram(),p=locateSession(m);
 console.log('session',p>=0?m.subarray(p,p+260).toString('hex'):'missing');
 const {NARC}=await import('../../src/nds/narc');const a=new NARC(new Uint8Array(await readFile(new URL('../../src/assets/codeinjection/cgearQuickActions.narc',import.meta.url))));
 const b=Buffer.alloc(512),pose=m[p+136],art=a.files[4].subarray((pose>>4)*512),pattern=a.files[12].subarray((pose&15)*512);
 for(let i=0;i<512;i++){let lo=art[i]&15,hi=art[i]>>4;if(lo===9)lo=(pattern[i]&15)===13?13:9;if(hi===9)hi=pattern[i]>>4===13?13:9;b[i]=lo|(hi<<4);}
 const heap=Buffer.from(core.HEAPU8.buffer);let found=-1;const hits:number[]=[];while((found=heap.indexOf(b,found+1))>=0)hits.push(found);
 console.log('composed graphic copies',hits.map(x=>x.toString(16)));
 const palette=m.subarray(p+468,p+468+128);let q=-1;const palettes:number[]=[];
 while((q=heap.indexOf(palette,q+1))>=0)palettes.push(q);
 console.log('palette copies',palettes.map(q=>({at:q.toString(16),tail:heap.subarray(q+128,q+256).toString('hex')})));
}
