// Isolated emulator smoke test. Only the bundled fixture save is used in RAM.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, patchTestBattleSaveBadges } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerFirstMove } from "../../src/pokeweb/testBattleTeam";
import { installCGearQuickActions, CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG } from "../../src/pokeweb/cgearQuickActionsModel";
const input=process.argv[2];if(!input) throw new Error("Pass clean B2/W2 ROM.");
const scenarioArg=process.argv.indexOf('--scenario');
const scenario=scenarioArg<0?'default':process.argv[scenarioArg+1];
const out=new URL(`./build/emulator-${input.includes("black")?"B2":"W2"}${scenario==='default'?'':`-${scenario}`}/`,import.meta.url);await mkdir(out,{recursive:true});
globalThis.fetch=(async(v:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(v instanceof URL?v:new URL(v instanceof Request?v.url:String(v)))))) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),"quick-actions.nds",{selectedNarcs:[]});
await installCGearQuickActions(project);
const downloads=await buildQuickLaunchDownloads(project),romBytes=downloads.romBytes;
const fixtureArg=process.argv.indexOf('--fixture-copy');
const saveBytes=fixtureArg<0?patchTestBattleSavePlayerFirstMove(patchTestBattleSaveBadges(downloads.saveBytes,getTestBattleConfigForProject(project)),project,process.argv.includes('--no-fly')?0:19):new Uint8Array(await readFile(process.argv[fixtureArg+1]));
function crc(b:Uint8Array) {let c=0xffff;for(const v of b) {c^=v<<8;for(let n=0;n<8;n++) c=c&0x8000?(c<<1)^0x1021:c<<1;c&=0xffff;}return c;}
const fixture=Buffer.from(saveBytes.buffer,saveBytes.byteOffset,saveBytes.length);
// Enable obtained status only in the isolated fixture. The original bundled
// fixture and every user's save stay untouched. Fix native block checksums.
for(const half of [0,0x26000]) {
  for(const id of [442,...process.argv.includes('--bicycle')?[450]:[]]) {
    let slot=-1;
    for(let n=0;n<83;n++) {const at=half+0x18400+310*4+n*4,current=fixture.readUInt16LE(at);if(current===id){slot=at;break;}if(current===0 && slot<0)slot=at;}
    if(slot<0)throw new Error('No empty key-item fixture slot');const remove=id===442&&process.argv.includes('--no-map');
    fixture.writeUInt16LE(remove?0:id,slot);fixture.writeUInt16LE(remove?0:1,slot+2);
  }
  const bagCrc=crc(fixture.subarray(half+0x18400,half+0x18dec));fixture.writeUInt16LE(bagCrc,half+0x18dee);fixture.writeUInt16LE(bagCrc,half+0x25f32);
  const flag=CGEAR_QUICK_ACTIONS_DEFAULT_PC_HIDE_FLAG,at=half+0x1ff00+0x35e+(flag>>3);
  if(process.argv.includes('--hide-pc'))fixture[at]|=1<<(flag&7);else if(fixtureArg<0)fixture[at]&=~(1<<(flag&7));
  const eventCrc=crc(fixture.subarray(half+0x1ff00,half+0x203e0));fixture.writeUInt16LE(eventCrc,half+0x203e2);fixture.writeUInt16LE(eventCrc,half+0x25f5a);
  fixture[half+0x1c02f]=1;fixture[half+0x1c02e]=process.argv.includes("--power-on")?1:0;
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
const trace:unknown[]=[];
type Input={frame:number;touch?:[number,number];buttons?:number};
const extras:Record<string,Input[]>={
  default:[{frame:790,touch:[128,10]},{frame:930,touch:[128,10]},{frame:1480,touch:[128,10]},{frame:1600,touch:[128,10]},{frame:2700,touch:[88,152]},{frame:2820,touch:[88,152]}],
  pc:[{frame:1000,touch:[196,116]},{frame:1120,buttons:128},{frame:1240,buttons:128},{frame:1360,buttons:128},{frame:1480,buttons:128},{frame:1600,buttons:128},{frame:1780,buttons:64},{frame:1900,buttons:64},{frame:2020,buttons:64},{frame:2140,buttons:64},{frame:2260,buttons:64},{frame:2420,buttons:4},{frame:2460,buttons:4},{frame:2500,buttons:4},{frame:2540,buttons:4},{frame:2600,buttons:128},{frame:2760,buttons:128}],
  travel:[{frame:1000,touch:[172,152]},{frame:1200,buttons:128},{frame:1280,buttons:128},{frame:1400,buttons:128},{frame:1700,buttons:128},{frame:1820,buttons:128}],
  map:[{frame:1000,touch:[172,152]},{frame:1400,buttons:64}],
  bike:[{frame:1000,touch:[88,152]},{frame:1250,touch:[88,152]}],
  save:[{frame:850,touch:[60,116]},{frame:1000,buttons:512},{frame:1250,touch:[64,140]},{frame:1370,buttons:128},{frame:1490,buttons:128},{frame:1610,buttons:128},{frame:1800,buttons:128},{frame:1900,buttons:128}],
  reload:[],gates:[]
};
if(process.argv.includes('--repeat')) {
  const first=extras[scenario];extras[scenario]=[...first,...first.map(v=>({...v,frame:v.frame+2800}))];
}
if(!(scenario in extras))throw new Error('Unknown emulator scenario');
const frameCount=Number(process.env.QUICK_ACTIONS_FRAMES ?? 2600);
let lastSession=-1;let bikeMounted=false,bikeDismounted=false;
for(let frame=0;frame<frameCount;frame++) {
  const extra=extras[scenario].find(v=>frame>=v.frame&&frame<v.frame+4);
  const touch=extra?.touch ?? (scenario!=='default'?null:frame>=850&&frame<854 ? [60,116] : frame>=910&&frame<914 ? [60,116] : frame>=970&&frame<974 ? [228,144] : frame>=1020&&frame<1024 ? [60,116] : frame>=1024&&frame<1040 ? [70,120] : frame>=1080&&frame<1084 ? [228,144] : frame>=1120&&frame<1124 ? [196,176] : frame>=1400&&frame<1404 ? [205,62] : frame>=1500&&frame<1504 ? [228,144] : frame>=1560&&frame<1564 ? [228,144] : frame>=1650&&frame<1654 ? [196,116] : frame>=2250&&frame<2254 ? [172,152] : null);
  const buttons=extra?.buttons ?? (scenario!=='default'?0:frame>=1220&&frame<1224||frame>=1400&&frame<1404?128:frame>=2020&&frame<2024||frame>=2080&&frame<2084||frame>=2140&&frame<2144||frame>=2450&&frame<2454?64:0);
  core._runFrame(1,buttons,touch?1:0,touch?.[0]??0,touch?.[1]??0);
  if(fatal.length)throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
  // Check each transition frame: a screenshot every 120 frames can miss the
  // one-frame disappearance reported while mounting or dismounting.
  if(scenario==='bike' && frame>=990) {
    const m=ram();if(lastSession<0)lastSession=m.lastIndexOf(Buffer.from([0x43,0x51,0x41,0x53]));
    if(lastSession<0 || !m[lastSession+92])throw new Error(`Bike hid overlay at frame ${frame}`);
    const sub=m.readUInt32LE(lastSession+4)-0x02000000,field=m.readUInt32LE(sub+20)-0x02000000,game=m.readUInt32LE(field+8)-0x02000000;
    const riding=m.readUInt32LE(game+0x154);
    if(frame>1000 && frame<1250 && riding===1)bikeMounted=true;
    if(frame>1250 && riding===0)bikeDismounted=true;
  }
  if(frame%120===0||frame===frameCount-1||[849,854,914,974,1041,1085,1150,1250,1399,1520,1580,1800,2240,2350,2599,3950].includes(frame)) {
    const png=new PNG({width:256,height:384}),fb=core._getSymbol(4)>>>0;png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));
    await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));
    const m=ram();let cgear=-1;
    for(let p=0;p<m.length-0x320;p+=4) if(m.readUInt32LE(p)===(project.session.baseVersion==="B2"?0x21ec98d:0x21ec9cd) && m[p+0x30b]<=1 && m[p+0x2fe]<=1 && m.readUInt32LE(p+0x14)>=0x02000000 && m.readUInt32LE(p+0x14)<0x02400000) {cgear=p;break;}
    const game=cgear>=0?m.readUInt32LE(cgear+20)-0x02000000:-1;
    const session=m.lastIndexOf(Buffer.from([0x43,0x51,0x41,0x53]));
    const row={frame,cgear,power:cgear>=0?m[cgear+0x30b]:null,edit:cgear>=0?m[cgear+0x2fe]:null,design:cgear>=0?m[cgear+0x300]:null,riding:game>=0&&game<0x400000-0x158?m.readUInt32LE(game+0x154):null,repelActive:session>=0&&(m[session+80]>>4)===1};trace.push(row);console.log(JSON.stringify(row));
    if(scenario==='pc' && [1150,3950].includes(frame) && (session<0 || !m[session+92]))throw new Error('PC dialog hid custom buttons');
    if(['pc','map','bike','gates'].includes(scenario) && frame===frameCount-1) {
      if(cgear<0 || session<0 || !m[session+92])throw new Error('Custom buttons did not return with C-Gear');
      const shown=[true,!process.argv.includes('--hide-pc'),process.argv.includes('--bicycle'),!process.argv.includes('--no-map')];
      for(let i=0;i<4;i++)if(Boolean(m[session+385+i])!==shown[i])throw new Error(`Incorrect visibility gate for button ${i}`);
      const colours=[[24,216,120],[248,120,0],[216,48,248],[192,104,240]];
      for(const [i,colour] of colours.entries()) {
        const [r,g,b]=colour.map(v=>{const n=Math.floor(v/8);return(n<<3)|(n>>2);});
        let pixels=0;for(let p=256*192*4;p<png.data.length;p+=4)if(Math.abs(png.data[p]-r)<=1&&Math.abs(png.data[p+1]-g)<=1&&Math.abs(png.data[p+2]-b)<=1)pixels++;
        if(shown[i] && pixels<8)throw new Error(`Missing visible button outline ${r}/${g}/${b}: ${pixels} pixels`);
        if(!shown[i] && pixels)throw new Error(`Hidden button ${i} still has visible pixels`);
      }
    }
    if(scenario==='reload' && frame===frameCount-1 && (!row.repelActive || cgear<0))throw new Error('Saved Repel preference did not load');
    await writeFile(new URL("ram.bin",out),m);
  }
}
if(scenario==='bike' && (!bikeMounted||!bikeDismounted))throw new Error('Bike did not mount and dismount');
await writeFile(new URL("trace.json",out),JSON.stringify(trace,null,2));console.log(fileURLToPath(out));
if(scenario==='save') {
 const size=core._savGetSize(),ptr=core._savGetPointer(size)>>>0,saved=Buffer.from(core.HEAPU8.subarray(ptr,ptr+size));
 await writeFile(new URL('saved-fixture.dsv',out),saved);
 console.log('saved Options bits',saved.readUInt16LE(0x19400).toString(16),saved.readUInt16LE(0x26000+0x19400).toString(16));
}
if(process.env.QUICK_ACTIONS_DEBUG) {
 console.log('symbols',Array.from({length:16},(_,i)=>[i,core._getSymbol(i)>>>0]));
 console.log('exports',Object.keys(core).filter(k=>k.startsWith('_')&&!k.startsWith('_emscripten')));
 const m=ram(),p=m.lastIndexOf(Buffer.from([0x43,0x51,0x41,0x53]));
 console.log('session',p>=0?m.subarray(p,p+260).toString('hex'):'missing');
 const {NARC}=await import('../../src/nds/narc');const a=new NARC(new Uint8Array(await readFile(new URL('../../src/assets/codeinjection/cgearQuickActions.narc',import.meta.url))));
 const b=Buffer.alloc(512),pose=m[p+80],art=a.files[4].subarray((pose>>4)*512),pattern=a.files[8].subarray((pose&15)*512);
 for(let i=0;i<512;i++){let lo=art[i]&15,hi=art[i]>>4;if(lo===9)lo=(pattern[i]&15)===13?13:9;if(hi===9)hi=pattern[i]>>4===13?13:9;b[i]=lo|(hi<<4);}
 const heap=Buffer.from(core.HEAPU8.buffer);let found=-1;const hits:number[]=[];while((found=heap.indexOf(b,found+1))>=0)hits.push(found);
 console.log('composed graphic copies',hits.map(x=>x.toString(16)));
}
