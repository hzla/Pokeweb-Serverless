// Fresh-boot playback checks use copied bundled fixtures and separate ROMs.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, buildTestBattleDownloads, patchTestBattleSaveMoveAnimations, getTestBattleConfigForProject } from "../../src/pokeweb/testBattle";
import { loadNitroSdatFromProject } from "../../src/pokeweb/nitroSound";
import { installBundledPmc, configureBundledBgmRuntime, stageCodeInjectionDll, assertBundledBgmRuntimeCompatibility } from "../../src/pokeweb/pmcModel";
import { encodeAdpcmStrm, encodePcm16Strm, appendStandaloneSdatStream, rebuildStreamedBgmMappings } from "../../src/pokeweb/streamedBgmModel";
import { setRomFileReplacement } from "../../src/pokeweb/fileSystemModel";
const input=process.argv[2];if(!input)throw new Error("Pass a clean US BW1 ROM.");
const opt=(s:string,d:string)=>{const i=process.argv.indexOf(s);return i<0?d:process.argv[i+1]!;};
const frames=Number(opt("--frames","4000"));
const controls=process.argv.includes("--controls");
globalThis.fetch=(async(input:RequestInfo|URL)=>{
 let url=input instanceof URL?input:new URL(input instanceof Request?input.url:String(input));
 const match=url.pathname.match(/BgmToggle([BW])\.dll$/);
 if(controls&&match)url=new URL(`./build/bw1-${match[1]}-test/BgmToggle${match[1]}.dll`,import.meta.url);
 return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const fixtureSource=new URL("../../src/assets/testbattle/white.dsv",import.meta.url);
const fixtureHash=digest(await readFile(fixtureSource));
const original=new Uint8Array(await readFile(input)),sourceHash=digest(original);
const project=await loadProjectFromRomBytes(original,"stream-player-test.nds",{selectedNarcs:[]});
const game=project.session.baseVersion;if(game!=="B"&&game!=="W")throw new Error("BW1 only.");
const out=new URL(`./build/emulator-${game}${controls?"-controls":process.argv.includes("--battle")?"-battle":""}/`,import.meta.url);await mkdir(out,{recursive:true});
assertBundledBgmRuntimeCompatibility(project,original);
const sdat=await loadNitroSdatFromProject(project);
const targets=sdat.sequenceInfos.filter(s=>s?.symbol?.startsWith("SEQ_BGM_")&&(!controls||s.id!==1040)).map(s=>s!.id);
const n=32728*3+113;
const encoded=encodeAdpcmStrm({sampleRate:32728,left:Float32Array.from({length:n},(_,i)=>.25*Math.sin(2*Math.PI*440*i/32728)),right:Float32Array.from({length:n},(_,i)=>.25*Math.sin(2*Math.PI*660*i/32728))},12345,n);
await writeFile(new URL("tone.strm",out),encoded.bytes);
const longN=32728*75+113;
const longTrack=controls?encodeAdpcmStrm({sampleRate:32728,left:Float32Array.from({length:longN},(_,i)=>.25*Math.sin(2*Math.PI*(i<32728*60?440:880)*i/32728)),right:Float32Array.from({length:longN},(_,i)=>.25*Math.sin(2*Math.PI*660*i/32728))},12345,longN):encoded;
const rebuilt=rebuildStreamedBgmMappings(sdat.bytes,[],targets.map(targetSequenceId=>({targetSequenceId,bytes:targetSequenceId===1029?longTrack.bytes:encoded.bytes})));
const oneShot=encodePcm16Strm({sampleRate:32728,left:Float32Array.from({length:32728},(_,i)=>.2*Math.sin(2*Math.PI*330*i/32728)),right:Float32Array.from({length:32728},(_,i)=>.2*Math.sin(2*Math.PI*550*i/32728))},0,32728,false);
const standalone=appendStandaloneSdatStream(rebuilt.bytes,oneShot.bytes);
if(controls)rebuilt.bytes=standalone.bytes;
console.log("Prepared",targets.length,"mappings");
await installBundledPmc(project);
const dll=await configureBundledBgmRuntime(game,{shortcutEnabled:true,mappings:rebuilt.mappings});
stageCodeInjectionDll(project,`BgmToggle${game}.dll`,dll,"patches",original);
setRomFileReplacement(project,sdat.sourceFileId!,rebuilt.bytes);
const downloads=process.argv.includes("--battle")?await buildTestBattleDownloads(project,2,{playerTeamText:"Mewtwo\nLevel: 100\n- Aura Sphere"}):await buildQuickLaunchDownloads(project);
if(process.argv.includes("--stereo")){
  const save=downloads.saveBytes.slice();for(const half of [0,0x24000])save[half+0x19400]&=~0x30;
  downloads.saveBytes=patchTestBattleSaveMoveAnimations(save,getTestBattleConfigForProject(project));
}
await writeFile(new URL("test.nds",out),downloads.romBytes);await writeFile(new URL("test.sav",out),downloads.saveBytes);
const corePath=new URL("../../public/desmond/desmond.js",import.meta.url),source=await readFile(corePath,"utf8");
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...args:unknown[])=>{if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(args.join(" ")))fatal.push(args.join(" "));};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:fileURLToPath(corePath),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")),context);await initialized;
const core=context.Module;core._main(0,0);
const rom=downloads.romBytes,size=Math.max(rom.length,128*1024*2**rom[0x14]),ptr=core._prepareRomBuffer(size);
core.HEAPU8.set(rom,ptr);core.HEAPU8.fill(255,ptr+rom.length,ptr+size);core.HEAPU8.set(downloads.saveBytes,core._savGetPointer(downloads.saveBytes.length));core._savUpdateChangeFlag();
if(core._loadROM(size)!==1)throw new Error("Emulator rejected ROM.");
const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
const marker=Buffer.from([0x50,0x53,0x57,0x31]),audio:Buffer[]=[],trace:unknown[]=[];
let diagnostic=-1,mailbox=-1,audioSamples=0;
// Leave five seconds for the native unmapped theme, including mute/unmute.
const commands=[[4000,1,1000],[4100,2,1],[4200,2,0],[4300,5,32],[4400,5,127],[4500,3,60],[4600,4,60,127],[4700,1,1040],[5000,1,1029],[5100,1,1029],[5200,11,0],[5300,6,standalone.streamId],[5500,6,standalone.streamId],[5510,8,1],[5600,8,0],[5610,9,32],[5620,9,127],[5700,7,0],[5800,1,1029]];
const inputs=[{f:1500,b:32},{f:1800,b:128},{f:2000,b:128},{f:2200,b:128},{f:2400,b:4},{f:2500,b:128},{f:3000,b:128},{f:3500,b:128},{f:4000,b:128},{f:4500,b:128},{f:5000,b:128},{f:5500,b:128},{f:5700,b:3088},{f:5900,b:3088},{f:6100,b:128},{f:6700,b:128},{f:7000,b:128},{f:7300,b:128},{f:7600,b:128}];
for(let frame=0;frame<frames;frame++){
 if(controls&&frame%100===0&&mailbox<0)mailbox=ram().indexOf(Buffer.from([0x50,0x57,0x54,0x43]));
 const command=controls?commands.find(c=>c[0]===frame):undefined;
 if(command){if(mailbox<0)throw new Error("Test driver mailbox missing");ram().writeUInt32LE(command[2]??0,mailbox+8);ram().writeUInt32LE(command[3]??0,mailbox+12);ram().writeUInt32LE(command[1]!,mailbox+4);}
 const key=controls&&frame>=3800?(([4720,4760,5920,5960].some(f=>frame>=f&&frame<f+12))?3088:0):inputs.find(i=>frame>=i.f&&frame<i.f+12)?.b??0;
 const touch=process.argv.includes("--battle")?Array.from({length:5},(_,i)=>[{f:6200+i*1000,x:128,y:90},{f:6400+i*1000,x:64,y:40}]).flat().find(t=>frame>=t.f&&frame<t.f+4):undefined;
 core._runFrame(1,key,touch?1:0,touch?.x??0,touch?.y??0);
 const samples=core._fillAudioBuffer(4096);audioSamples+=samples;if(samples)audio.push(Buffer.from(core.HEAPU8.slice(core._getSymbol(6),core._getSymbol(6)+samples*4)));
 if(frame%100===0||(controls&&frame>=4000&&frame<5900&&frame%10===0)){if(diagnostic<0)diagnostic=ram().indexOf(marker);const d=diagnostic<0?[]:Array.from({length:16},(_,i)=>ram().readUInt32LE(diagnostic+i*4));const test=mailbox<0?[]:Array.from({length:8},(_,i)=>ram().readUInt32LE(mailbox+i*4));const player=test[7]?Array.from(ram().subarray(test[7]-0x02000000,test[7]-0x02000000+80)):[];trace.push({frame,audioSamples,d,test,player});if(frame%100===0)console.log(frame,d.join(","));}
 if([1499,2399,2999,3999,4999,5999,6999,7999].includes(frame)||frame===frames-1){const png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.slice(core._getSymbol(4),core._getSymbol(4)+256*384*4));await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));}
 if(fatal.length)break;
}
if(digest(await readFile(input))!==sourceHash||digest(await readFile(fixtureSource))!==fixtureHash)throw new Error("Source ROM/save changed during testing");
const pcm=Buffer.concat(audio),wav=Buffer.alloc(44);wav.write("RIFF");wav.writeUInt32LE(pcm.length+36,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(192000,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(pcm.length,40);
await writeFile(new URL("capture.wav",out),Buffer.concat([wav,pcm]));await writeFile(new URL("trace.json",out),JSON.stringify({game,sourceHash,fixtureHash,romHash:digest(downloads.romBytes),saveCopyHash:digest(downloads.saveBytes),runtimeHash:digest(dll),controls,commands:controls?commands:undefined,standalone:standalone.streamId,trace,fatal},null,2));await writeFile(new URL("ram.bin",out),ram());console.log({fatal});
