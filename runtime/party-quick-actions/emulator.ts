// Isolated emulator smoke test. Only the bundled fixture save is used in RAM.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, patchTestBattleSaveBadges } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerFirstMove } from "../../src/pokeweb/testBattleTeam";
import { installPartyQuickActions, getPartyQuickActionsStatus } from "../../src/pokeweb/partyQuickActionsModel";
import { decryptPk5Party, encryptPk5Party, patchTestBattleSavePlayerParty } from "../../src/pokeweb/testBattleTeam";
import { installCGearQuickActions, CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG } from "../../src/pokeweb/cgearQuickActionsModel";
import { installLearnsetViewer } from "../../src/pokeweb/learnsetViewerModel";
import { installSummaryStatViewer } from "../../src/pokeweb/summaryStatViewerModel";
import { installPortaPc } from "../../src/pokeweb/portaPcModel";
import { installBattleLog } from "../../src/pokeweb/battleLogModel";
import { installMenuEvolution } from "../../src/pokeweb/menuEvolutionModel";
import { INFINITE_CANDY_ITEM_ID, getInfiniteCandyStatus } from "../../src/pokeweb/infiniteCandyModel";
const input=process.argv[2];if(!input) throw new Error("Pass clean B2/W2 ROM.");
const scenarioArg=process.argv.indexOf('--scenario');
const scenario=scenarioArg<0?'hp':process.argv[scenarioArg+1];
const hideFlag = process.argv.includes('--flag-configured') || scenario==='hidden' ? 0x05ee : null;

globalThis.fetch=(async(v:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(v instanceof URL?v:new URL(v instanceof Request?v.url:String(v)))))) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),"quick-actions.nds",{selectedNarcs:[]});
const out=new URL(`./build/emulator-${project.session.baseVersion}-${scenario}${process.argv.includes("--power-on")?"-on":"-off"}${process.argv.includes("--companions")?"-companions":""}${process.argv.includes("--no-candy")?"-no-candy":""}/`,import.meta.url);await mkdir(out,{recursive:true});
await installCGearQuickActions(project);
if(process.argv.includes('--companions')) {
 await installBattleLog(project);await installMenuEvolution(project);
 await installLearnsetViewer(project);await installSummaryStatViewer(project);await installPortaPc(project);
}
await installPartyQuickActions(project, { hideFlag });
if(!getPartyQuickActionsStatus(project).compatible)throw new Error('Party toolbar compatibility failed after staging');
if(!getInfiniteCandyStatus(project).installed)throw new Error('Required Infinite Candy dependency was not installed');
const downloads=await buildQuickLaunchDownloads(project),romBytes=downloads.romBytes;
const fixtureArg=process.argv.indexOf('--fixture-copy');
const saveBytes=fixtureArg<0?patchTestBattleSavePlayerFirstMove(patchTestBattleSaveBadges(downloads.saveBytes,getTestBattleConfigForProject(project)),project,19):new Uint8Array(await readFile(process.argv[fixtureArg+1]));
function crc(b:Uint8Array) {let c=0xffff;for(const v of b) {c^=v<<8;for(let n=0;n<8;n++) c=c&0x8000?(c<<1)^0x1021:c<<1;c&=0xffff;}return c;}
const team = `Oshawott
Level: ${scenario==="candy"?16:15}
- Tackle
- Tail Whip
- Water Gun
- Water Sport

Mew
Level: 20
- Pound`;
const testTeam=(process.argv.includes("--six") || scenario==="heal")?team+"\n\nPikachu\nLevel: 15\n- Tackle\n\nEevee\nLevel: 15\n- Tackle\n\nSnivy\nLevel: 15\n- Tackle\n\nTepig\nLevel: 15\n- Tackle":team;
const changed=patchTestBattleSavePlayerParty(saveBytes,project,testTeam);
const fixture=Buffer.from(changed.buffer,changed.byteOffset,changed.length);
// Enable obtained status only in the isolated fixture. The original bundled
// fixture and every user's save stay untouched. Fix native block checksums.
for(const half of [0,0x26000]) {
  if(scenario==='heal') {
    for(let i=0;i<6;i++) {
      const at=half+0x18e08+i*220, pk=Buffer.from(decryptPk5Party(new Uint8Array(fixture.subarray(at,at+220))));
      pk.writeUInt16LE(i===0?0:Math.max(1,pk.readUInt16LE(144)-i*3),142);
      pk.writeUInt32LE([2,5,4,3,1,0][i],136);
      fixture.set(encryptPk5Party(pk),at);
    }
    const partyCrc=crc(fixture.subarray(half+0x18e00,half+0x19334));fixture.writeUInt16LE(partyCrc,half+0x19336);fixture.writeUInt16LE(partyCrc,half+0x25f34);
  }
  for(const id of [442,INFINITE_CANDY_ITEM_ID,...process.argv.includes('--bicycle')?[450]:[],...process.argv.includes('--eight')?[471,447,627,465]:[],]) {
    let slot=-1;
    for(let n=0;n<83;n++) {const at=half+0x18400+310*4+n*4,current=fixture.readUInt16LE(at);if(current===id){slot=at;break;}if(current===0 && slot<0)slot=at;}
    if(slot<0)throw new Error('No empty key-item fixture slot');const remove=(id===442&&process.argv.includes('--no-map'))||(id===INFINITE_CANDY_ITEM_ID&&process.argv.includes('--no-candy'));
    fixture.writeUInt16LE(remove?0:id,slot);fixture.writeUInt16LE(remove?0:1,slot+2);
  }
  const bagCrc=crc(fixture.subarray(half+0x18400,half+0x18dec));fixture.writeUInt16LE(bagCrc,half+0x18dee);fixture.writeUInt16LE(bagCrc,half+0x25f32);
  const flag=CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG,at=half+0x1ff00+0x35e+(flag>>3);
  if(process.argv.includes('--hide-pc'))fixture[at]|=1<<(flag&7);else if(fixtureArg<0)fixture[at]&=~(1<<(flag&7));
  if(hideFlag) {
    const at=half+0x1ff00+0x35e+(hideFlag>>3);
    if(scenario==='hidden')fixture[at]|=1<<(hideFlag&7);else fixture[at]&=~(1<<(hideFlag&7));
  }
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
core.HEAPU8.set(romBytes,ptr);core.HEAPU8.fill(255,ptr+romBytes.length,ptr+size);core.HEAPU8.set(fixture,core._savGetPointer(fixture.length));core._savUpdateChangeFlag();
if(core._loadROM(size)!==1)throw new Error("Emulator rejected ROM");
const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);

function sessionOffset(m:Buffer){let p=m.length;while((p=m.lastIndexOf(Buffer.from([0x50,0x41,0x50,0x53]),p-1))>=0){const w=m.readUInt32LE(p+4)-0x2000000;if(w>0&&w<m.length-0x290&&m.readUInt16LE(w)===23)return p;}return -1;}
type Input={frame:number;touch?:[number,number];buttons?:number;duration?:number};
const actions:Record<string,Input[]>={
 nav:[{frame:1210,touch:[73,180],duration:12},{frame:1230,touch:[110,180]},{frame:1250,buttons:1024},{frame:1290,buttons:1},{frame:1330,buttons:128},{frame:1370,buttons:2},{frame:1410,buttons:128},{frame:1450,buttons:1},{frame:1490,buttons:128},{frame:1530,buttons:64},{frame:1570,buttons:128},{frame:1610,buttons:128},{frame:1650,buttons:1},{frame:1690,buttons:128},{frame:1730,buttons:128},{frame:1770,buttons:64},{frame:1790,touch:[214,180]},{frame:1810,touch:[190,180]},{frame:1830,touch:[73,180]},{frame:1870,touch:[128,180]},{frame:1930,touch:[73,180]},{frame:1970,touch:[75,180]},{frame:2030,buttons:64},{frame:2230,touch:[188,60]}],
 hp:[{frame:1250,touch:[53,180]},{frame:1300,buttons:2},{frame:1350,buttons:2,duration:30},{frame:1400,touch:[160,40]},{frame:1450,buttons:128},{frame:1500,touch:[93,180]},{frame:1560,touch:[113,180]},{frame:1620,touch:[133,180]},{frame:1680,touch:[153,180]},{frame:1740,touch:[173,180]},{frame:1800,buttons:64},{frame:2000,touch:[188,60]},{frame:2300,buttons:128},{frame:2400,buttons:64}],
 candy:[{frame:1250,touch:[13,180],duration:40},...Array.from({length:36},(_,i)=>({frame:1450+i*150,buttons:128})),{frame:7000,buttons:64}],
 status:[...Array.from({length:5},(_,i)=>[
  {frame:1250+i*120,touch:[53,180] as [number,number]},
  {frame:1270+i*120,touch:[93+20*i,180] as [number,number]},
  {frame:1300+i*120,touch:[53,180] as [number,number]},
  {frame:1320+i*120,touch:[93+20*i,180] as [number,number],duration:20},
 ]).flat(),{frame:1860,touch:[93,180]},{frame:1900,touch:[173,180]},
 {frame:1940,touch:[53,180]},{frame:1960,touch:[173,180]},
 {frame:2000,buttons:64},{frame:2200,touch:[188,60]}],
};
actions.heal=[{frame:1250,touch:[53,180]},{frame:1290,touch:[33,180],duration:24},{frame:1330,buttons:64},{frame:1370,touch:[33,180]},{frame:1400,touch:[111,180]},{frame:1450,touch:[33,180]},{frame:1490,touch:[95,180],duration:24},{frame:1570,buttons:1024},...process.argv.includes('--no-candy')?[]:[{frame:1590,buttons:1}],{frame:1610,buttons:128},{frame:1650,buttons:64},{frame:1690,buttons:128},{frame:1730,buttons:128,duration:24},{frame:1780,buttons:64},{frame:1850,buttons:64},{frame:2050,touch:[188,60]}];
actions.hidden=[{frame:1250,buttons:1024},{frame:1290,touch:[33,180]},{frame:1500,buttons:64},{frame:1700,touch:[188,60]}];
if(scenario==='nav'&&!process.argv.includes('--no-candy'))actions.nav.push({frame:1270,buttons:1});
const captures=new Set([...Array.from({length:50},(_,i)=>990+i*3),...Array.from({length:40},(_,i)=>1998+i*3),1318,1474,1494,1920,2304,2404,1254,1304,1380,1404,1454,1504,1564,1624,1684,1744,
 ...actions[scenario].flatMap(v=>[v.frame+4,v.frame+(v.duration??4)+4])]);
if(scenario==='heal')for(const frame of [1318,1540,1760,2190])captures.add(frame);
if(scenario==='nav'){
 actions.nav.push({frame:1630,buttons:128},{frame:2000,buttons:128});
 for(const frame of [1634,2004])captures.add(frame);
 for(let frame=1254;frame<1324;frame++)captures.add(frame);
}
function nativePartyWork(m:Buffer){
 for(let w=m.indexOf(Buffer.from([23,0]));w>=0;w=m.indexOf(Buffer.from([23,0]),w+1)){
  if(w+0x290>=m.length||m.readUInt16LE(w)!==23||m[w+12]!==2||m[w+14]!==1)continue;
  const req=m.readUInt32LE(w+0x28c)-0x2000000;if(req<0||req+0xa8>=m.length||m.readUInt32LE(req+0x44)!==0)continue;
  const party=m.readUInt32LE(req)-0x2000000;
  const flags=m.indexOf(fixture.subarray(0x1ff00+0x35e,0x1ff00+0x4dd))-0x35e;
  if(party<0||party+1328>=m.length||m.readUInt32LE(party)!==6||m.readUInt32LE(party+4)<1||m.readUInt32LE(party+4)>6||flags<0||flags+0x4e0>=m.length)continue;
  return {w,req,party,flags};
 }
 return undefined;
}
const nativeTrace:any[]=[];
let found=false,candyStarted=false,candyFinished=false;const trace:any[]=[];const frames=Number(process.env.PARTY_FRAMES??2500);
for(let frame=0;frame<frames;frame++){
 const v=[{frame:1000,touch:[188,60] as [number,number]},...actions[scenario]].find(v=>frame>=v.frame&&frame<v.frame+(v.duration??4));
 const activeSession=sessionOffset(ram());if(scenario==="candy"&&activeSession>=0){const m=ram(),w=m.readUInt32LE(activeSession+4)-0x2000000;if(frame>1250&&m[w+12]!==2)candyStarted=true;if(candyStarted&&frame>1600&&m[w+12]===2)candyFinished=true;}
 core._runFrame(1,candyFinished?0:v?.buttons??0,v?.touch?1:0,v?.touch?.[0]??0,v?.touch?.[1]??0);
 if(fatal.length)throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
 if(frame%60===0||captures.has(frame)){
  const m=ram(),s=sessionOffset(m);
  if(scenario==='hidden') {const native=nativePartyWork(m);if(native)nativeTrace.push({frame,...native,flagByte:m[native.flags+0x35e+(hideFlag!>>3)],party:[...m.subarray(native.party,native.party+1328)]});}
  if(s>=0){found=true;const w=m.readUInt32LE(s+4)-0x2000000,req=m.readUInt32LE(w+0x28c)-0x2000000,party=m.readUInt32LE(req)-0x2000000;const pokemon=party+8;
   const pk=Buffer.from(decryptPk5Party(new Uint8Array(m.subarray(pokemon,pokemon+220))));
   const text=m.readUInt32LE(s+336)-0x2000000;
   const members=Array.from({length:m[party+4]},(_,i)=>{const pk=Buffer.from(decryptPk5Party(new Uint8Array(m.subarray(party+8+i*220,party+8+(i+1)*220))));return {hp:pk.readUInt16LE(142),max:pk.readUInt16LE(144),status:pk.readUInt32LE(136),exp:pk.readUInt32LE(16),pp:[...pk.subarray(48,52)]};});
   trace.push({members,exp:pk.readUInt32LE(16),nav:!!m[s+331],navItem:m[s+332],confirm:!!m[s+335],confirmStage:m[s+335],message:text>=0?m.subarray(text+8,text+8+m.readUInt16LE(text+2)*2).toString('utf16le'):undefined,nativeSelector:m.readUInt16LE(w+0xac),toolbarSelector:m.readUInt16LE(s+390),selectorPhase:m.readUInt16LE(w+0x106),frameHidden:!!m[s+329],species:pk.readUInt16LE(8),hp:pk.readUInt16LE(142),max:pk.readUInt16LE(144),level:pk[140],status:pk.readUInt32LE(136),candyVisible:!!m[s+330],frame,s,w,slot:m.readUInt32LE(w+0x30),fsm:[...m.subarray(w+12,w+16)],mode:m.readUInt32LE(req+0x44),result:m.readUInt32LE(req+0x50),flags:[...m.subarray(s+120,s+128)],pokemon:[...m.subarray(pokemon+0x88,pokemon+0x94)]});}
 }
 if(frame%120===0||captures.has(frame)){const png=new PNG({width:256,height:384}),fb=core._getSymbol(4)>>>0;png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));}
}
await writeFile(new URL('trace.json',out),JSON.stringify(trace,null,2));await writeFile(new URL('native-trace.json',out),JSON.stringify(nativeTrace,null,2));await writeFile(new URL('test.nds',out),romBytes);await writeFile(new URL('test.sav',out),fixture);await writeFile(new URL('ram.bin',out),ram());if(scenario!=='hidden'&&!found)throw new Error('Party toolbar did not initialize');
function check(condition:unknown,message:string){if(!condition)throw new Error(message);}
if(scenario!=='hidden')check(trace.some(t=>t.frame===1200&&t.candyVisible===!process.argv.includes('--no-candy')),'Candy visibility did not match possession of Infinite Candy');
if(scenario==='heal'&&frames>=2300){
 const at=(f:number)=>trace.find(t=>t.frame===f), before=at(1200)?.members;
 check(before?.length===6&&before[0].hp===0&&before.every((m:any)=>m.hp<m.max),'Fixture did not start with six hurt party members including a fainted member');
 check(at(1254)?.flags[2]===1,'HP mode did not begin before healing');
 for(const f of [1294,1318,1374,1454]) {
   const t=at(f);check(t?.confirmStage===3&&t.message==='Heal Party? A:Yes B:No'&&t.flags[2]===0&&!t.frameHidden,'Healing confirmation did not display or exit HP mode');
   check(JSON.stringify(t.members)===JSON.stringify(before),'Healing prompt/held touch changed the party before acceptance');
 }
 for(const f of [1334,1404])check(!at(f)?.confirm&&JSON.stringify(at(f)?.members)===JSON.stringify(before),'B/touch NO healed the party');
 for(const f of [1540,1760,2190]) {
   const t=at(f);check(t?.members?.length===6&&t.members.every((m:any,i:number)=>m.hp===(before[i].hp?m.max:0)&&m.status===(before[i].hp?0:before[i].status)&&m.exp===before[i].exp&&JSON.stringify(m.pp)===JSON.stringify(before[i].pp)),`Confirmed whole-party heal failed or changed EXP/PP at ${f}`);
   check(t.flags[2]===0&&!t.confirm,`Confirmed healing did not return to toolbar at ${f}`);
 }
 check(at(1614)?.navItem===8&&at(1614)?.confirmStage===3&&at(1614)?.message==='Heal Party? A:Yes B:No','L/Right/A failed to prompt for healing');
 check(!at(1654)?.confirm&&at(1654)?.nav&&at(1654)?.navItem===8,'Keyboard cancel did not restore the selected toolbar item');
 check(at(1694)?.confirmStage===3&&at(1760)?.nav,'Keyboard acceptance did not restore toolbar navigation');
 check(trace.filter(t=>t.fsm[0]===1||t.fsm[0]===19).every(t=>t.frameHidden),'Prompt flashed during heal scenario fade');
}
if(scenario==='hidden'){
 check(!found,'Set hide flag still allocated the custom toolbar');
 check(nativeTrace.some(t=>t.frame===1200)&&nativeTrace.some(t=>t.frame>=1800),'Flag-gated native Party menu did not open/reopen');
 const before=nativeTrace.find(t=>t.frame===1200);check(nativeTrace.every(t=>t.flagByte===before.flagByte),'Toolbar inputs modified the visibility flag or its adjacent bits');
 check(getPartyQuickActionsStatus(project).hideFlag===hideFlag,'Installer lost configured hide flag');
}
if(scenario==='nav'&&frames>=2400){
 const at=(frame:number)=>trace.find(t=>t.frame===frame);
 const noCandy=process.argv.includes('--no-candy');
 check(at(1214)?.confirm&&at(1214)?.exp===at(1200)?.exp,'Held XP changed EXP before confirmation');
 check(!at(1234)?.confirm&&at(1234)?.exp===at(1200)?.exp,'Touch NO changed EXP');
 check(trace.filter(t=>t.fsm[0]===1||t.fsm[0]===19).every(t=>t.frameHidden),'Blank prompt returned during fade-in/out');
 check(at(1254)?.nav&&at(1254)?.navItem===(noCandy?8:0),'L did not enter toolbar navigation');
 check(at(1334)?.flags[2]===1&&at(1334)?.slot===0,'A failed to activate HP');
 check(at(1374)?.hp===at(1200)?.hp-1,'HP via navigation did not adjust');
 check(at(1494)?.confirm&&at(1494)?.exp===at(1200)?.exp,'XP changed before confirmation');
 check(!at(1534)?.confirm&&at(1534)?.exp===at(1200)?.exp,'Cancel changed EXP');
 check(at(1614)?.confirmStage===2&&at(1614)?.exp===2534&&at(1614)?.level===15&&at(1614)?.message==="Oshawott's xp was edged!",'XP confirmation failed to edge and acknowledge the selected nickname');
 check(!at(1634)?.confirm&&at(1634)?.nav,'Success message did not return to toolbar navigation');
 check(at(1694)?.status===2&&at(1734)?.status===0,'A failed to toggle status');
 check(!at(1774)?.nav,'B failed to exit toolbar navigation');
 check(at(1794)?.fsm[0]===2,'Removed Cancel region still closed Party');
 check(at(1814)?.fsm[0]===2&&at(1814)?.slot===at(1774)?.slot,'Removed checkmark region still changed Party state');
 check(!at(1874)?.confirm,'Touch NO failed to cancel XP');
 check(at(1974)?.exp===2534&&at(1974)?.level===15,'Touch YES failed to confirm XP');
 check(at(1974)?.confirmStage===2&&at(1974)?.message==="Oshawott's xp was edged!"&&!at(2004)?.confirm,'Touch XP acknowledgement did not appear or dismiss');
 const pulse=trace.filter(t=>t.frame>=1254&&t.frame<1324);
 // The VBlank task reads the completed previous frame's native palette.
 check(pulse.slice(1).every((t,i)=>t.toolbarSelector===pulse[i].nativeSelector),'Scheduled toolbar selector diverged from native palette animation');
 check(pulse[0].toolbarSelector===pulse[64].toolbarSelector&&new Set(pulse.map(t=>t.toolbarSelector)).size>=20,'Native selector did not retain its smooth 64-frame cycle');
 check(trace.some(t=>t.frame>=2340&&t.exp===2534&&t.fsm[0]===2),'XP failed to survive Party reopening');
}
if(scenario==='status'&&frames>=2400){
 const at=(frame:number)=>trace.find(t=>t.frame===frame);
 for(const [i,status] of [2,5,4,3,1].entries()){
  const start=1250+i*120;
  check(at(start+4)?.flags[2]===1,'HP mode did not activate before status '+status);
  check(at(start+24)?.flags[2]===0&&at(start+24)?.status===status,'Status tap failed to apply and leave HP mode');
  check(at(start+54)?.flags[2]===1,'HP mode did not reactivate before clearing');
  for(const frame of [start+74,start+94])check(at(frame)?.flags[2]===0&&at(frame)?.status===0,'Matching status tap/hold failed to clear and leave HP mode');
  check(at(start+74)?.hp===at(start+4)?.hp,'Status tap changed HP');
 }
 check(at(1904)?.status===1,'Different status did not replace the previous condition');
 check(at(1964)?.status===0&&at(1964)?.flags[2]===0,'Final matching status failed to clear');
 check(trace.some(t=>t.frame>=2300&&t.mode===0&&t.fsm[0]===2&&t.status===0&&t.flags[5]===1),'Cleared status failed to persist through Party close/reopen');
}
if(scenario==='hp'&&frames>=2400){
 const at=(frame:number)=>trace.find(t=>t.frame===frame);
 check(at(1254)?.flags[2]===1,'HP mode did not activate');
 check(at(1304)?.hp===at(1200)?.hp-1,'Initial Left did not immediately subtract one HP');
 check(at(1380)?.hp<at(1304)?.hp,'Held Left did not repeat');
 check(at(1404)?.slot===0&&at(1404)?.flags[2]===1,'HP mode failed to lock the selected member');
 check(at(1454)?.flags[2]===0,'A did not leave HP mode');
 for(const [frame,status] of [[1504,2],[1564,5],[1624,4],[1684,3],[1744,1]])check(at(frame)?.status===status,'Incorrect native status at '+frame);
 check(at(2304)?.flags[5]===0,'Toolbar covered the native command menu');
 check(trace.some(t=>t.frame>=2440&&t.flags[5]===1),'Toolbar did not return after the native command menu');
 check(trace.some(t=>t.frame>=2200&&t.mode===0&&t.fsm[0]===2&&t.hp===at(1744)?.hp&&t.status===1),'Party close/reopen lost edits or toolbar');
}
if(scenario==='candy'&&frames>=7000){
 check(Math.max(...trace.map(t=>t.level))===17,'Held Candy applied more than once');
 check(trace.some(t=>t.frame>=5000&&t.species===502&&t.mode===0&&t.fsm[0]===2),'Candy evolution failed to return to normal Party mode');
}
console.log('Party emulator assertions passed',project.session.baseVersion,scenario);
