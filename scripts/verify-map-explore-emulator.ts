// Run only disposable test builds and copied bundled saves. All captures require an external output prefix.
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { toDesmumeDsv } from "../src/pokeweb/testBattle";
const [prefix] = process.argv.slice(2); if (!prefix) throw new Error("Pass the external prefix from verify-map-explore-test.ts.");
const romBytes = new Uint8Array(await fs.readFile(prefix+".nds")), save = toDesmumeDsv(new Uint8Array(await fs.readFile(prefix+".sav"))), expected = JSON.parse(await fs.readFile(prefix+".json","utf8"));
const url = new URL("../public/desmond/desmond.js",import.meta.url), source = await fs.readFile(url,"utf8");
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...args:unknown[])=>{const s=args.join(" ");if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(s))fatal.push(s);};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../public/desmond",import.meta.url)),__filename:fileURLToPath(url),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")),context);await initialized;const core=context.Module;
core._main(0,0);const size=Math.max(romBytes.length,128*1024*2**romBytes[0x14]),pointer=core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes,pointer);core.HEAPU8.fill(255,pointer+romBytes.length,pointer+size);core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();if(core._loadROM(size)!==1)throw new Error("Emulator rejected ROM.");
const trace:object[]=[];let arrived=false;
for(let frame=0;frame<3200;frame++){
  // Continue through title/menu, then walk onto the test trigger.
  const keys=frame>=500&&frame<1700?(frame%120<3?32:frame%60<3?128:0):frame>=2000&&frame<2030||frame>=2500&&frame<2530?4:0;
  core._runFrame(1,keys,0,0,0);if(fatal.length)throw new Error(fatal.join("\n"));
  if(frame%300===0||frame===3199){
    const ram=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000),d=expected.destination,pattern=Buffer.alloc(4);pattern.writeUInt32LE(d.zoneId);
    const matches:number[]=[];let at=-1;while((at=ram.indexOf(pattern,at+1))>=0&&at+16<=ram.length){if(ram.readUInt16LE(at+6)===d.tileX&&ram.readUInt16LE(at+14)===d.tileZ)matches.push(at+0x02000000);}
    arrived ||= frame>1300&&matches.length>0;trace.push({frame,matches});
    if(frame===900||frame===1500||frame===3199){const png=new PNG({width:256,height:384}),p=core._getSymbol(4)>>>0;png.data=Buffer.from(core.HEAPU8.subarray(p,p+256*384*4));await fs.writeFile(prefix+`-frame-${frame}.png`,PNG.sync.write(png));}
  }
}
await fs.writeFile(prefix+"-emulator.json",JSON.stringify({game:expected.game,destination:expected.destination,arrived,fatal,trace},null,2));console.log(JSON.stringify({game:expected.game,arrived,fatal,trace}));
if (!arrived) throw new Error("The emulator did not reach the expected map-test destination. Inspect the external captures.");
