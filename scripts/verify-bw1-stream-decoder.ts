import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeAdpcmStrm, encodePcm16Strm, appendStandaloneSdatStream, decodeNativeSdatStreamPcm } from "../src/pokeweb/streamedBgmModel";
import { readU32, writeU16, writeU32 } from "../src/nds/binary";

const out=resolve("runtime/bgm-toggle/build/decoder-tests");mkdirSync(out,{recursive:true});
const runner=resolve(out,"decoder");
execFileSync(process.env.CC??"cc",["-std=c11","-Wall","-Wextra","-Werror","-fsanitize=undefined,address","-g",
  "runtime/bgm-toggle/bw1_stream_core.c","runtime/bgm-toggle/test_bw1_core.c","-o",runner]);
// Minimal empty archive, built solely for the independent TypeScript decoder.
const archive=new Uint8Array(0xc0);archive.set(new TextEncoder().encode("SDAT"));
writeU16(archive,4,0xfeff);writeU16(archive,6,0x100);writeU16(archive,12,64);writeU16(archive,14,3);
writeU32(archive,8,archive.length);writeU32(archive,24,64);writeU32(archive,28,72);
archive.set(new TextEncoder().encode("INFO"),64);writeU32(archive,68,72);
for(let i=0;i<8;i++)writeU32(archive,72+i*4,40+i*4);
writeU32(archive,32,136);writeU32(archive,36,12);archive.set(new TextEncoder().encode("FAT "),136);writeU32(archive,140,12);
writeU32(archive,40,148);writeU32(archive,44,44);archive.set(new TextEncoder().encode("FILE"),148);writeU32(archive,152,44);
let cases=0;
for(const encode of [encodePcm16Strm,encodeAdpcmStrm])for(const samples of [1,959,960,961,2001,32728])for(const loop of [false,true]){
  const pcm={sampleRate:32728,left:Float32Array.from({length:samples},(_,i)=>Math.sin(i*.37)*.95),right:Float32Array.from({length:samples},(_,i)=>Math.cos(i*.21)*.8)};
  const loopStart=Math.floor(samples/3),encoded=encode(pcm,loopStart,samples,loop);
  const added=appendStandaloneSdatStream(archive,encoded.bytes),expected=decodeNativeSdatStreamPcm(added.bytes,0,2);
  const path=resolve(out,"test.strm");writeFileSync(path,encoded.bytes);
  for(const seek of [0,Math.max(0,samples-139),samples]){
    const count=samples+257,actual=execFileSync(runner,[path,String(seek),String(count)]);
    for(let i=0;i<count;i++){
      const position=seek+i<samples?seek+i:loop?loopStart+(seek+i-samples)%(samples-loopStart):-1;
      for(let ch=0;ch<2;ch++){
        const want=position<0?0:Math.round((ch?expected.right:expected.left)[position]!*32768);
        if(actual.readInt16LE(i*4+ch*2)!==want)throw new Error(`Decode mismatch: format ${encoded.encoding}, samples ${samples}, loop ${loop}, seek ${seek}, sample ${i}, channel ${ch}`);
      }
    }
    cases++;
  }
  for(const field of [36,40,44,48,52,56,60]){
    const bad=encoded.bytes.slice();writeU32(bad,field,field===40?0xfffffff0:0);writeFileSync(path,bad);
    if(spawnSync(runner,[path,"0","2000"]).status===0)throw new Error(`Accepted malformed STRM field ${field}`);
  }
  if(readU32(encoded.bytes,36)!==samples)throw new Error("Encoder length changed");
}
console.log(`BW1 decoder: ${cases} PCM16/ADPCM, loop, tail and seek comparisons passed; malformed headers rejected (ASan/UBSan).`);
