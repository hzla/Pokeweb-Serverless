/** Apply the reviewed Frost Black1 Fairy Vpatch to a clean, explicitly supplied ROM. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {NintendoDSRom} from "../../src/nds/rom";
import {NARC} from "../../src/nds/narc";
import {decompressCode} from "../../src/nds/codeCompression";
import {readU32} from "../../src/nds/binary";
const[inputPath,patchPath,outputPath]=process.argv.slice(2);assert(outputPath,"Usage: CLEAN_BLACK.nds Black1Fairy.Vpatch NEW_OUTPUT.nds");
const input=new Uint8Array(await readFile(inputPath)),patch=new Uint8Array(await readFile(patchPath));
const hash=(b:Uint8Array,algorithm="sha256")=>createHash(algorithm).update(b).digest("hex");
assert.equal(hash(input,"sha1"),"26ad0b9967aa279c4a266ee69f52b9b2332399a5","Expected clean US Black revision 0");
assert.equal(hash(patch),"9fd6d01269bada1d8f2195ca26cc33f347de623e18d15d0b90c3033842507f14","Unreviewed Frost patch version");
const chunks=new Map<string,Uint8Array>();for(let at=0;at<patch.length;){assert.equal(patch[at++],123);const start=at;while(patch[at]!==124&&at<patch.length)at++;const name=new TextDecoder().decode(patch.subarray(start,at++)),size=readU32(patch,at);at+=4;assert.equal(patch[at++],58);assert(!chunks.has(name)&&size<=patch.length-at);chunks.set(name,patch.slice(at,at+size));at+=size;assert.equal(patch[at++],125);}
assert.equal(new TextDecoder().decode(chunks.get("version")),"pokemon b");
const rom=new NintendoDSRom(input,{fileData:"view"}),arm9=decompressCode(rom.arm9),table=rom.arm9OverlayTable.slice(),files=new Map<number,Uint8Array>(),narcs=new Map<number,NARC>();
const regions=(bytes:Uint8Array,start:number,apply:(at:number,data:Uint8Array)=>void)=>{for(let at=start;at<bytes.length;){const offset=readU32(bytes,at),length=readU32(bytes,at+4);at+=8;assert(length<=bytes.length-at);apply(offset,bytes.subarray(at,at+length));at+=length;}};
for(const[name,bytes]of chunks){
 if(name==="version")continue;
 if(name==="arm9"){assert.equal(bytes[0],0);regions(bytes,1,(at,data)=>{assert(at+data.length<=arm9.length);arm9.set(data,at);});continue;}
 if(name==="y9"){assert.equal(readU32(bytes,0),0);assert.equal(readU32(bytes,4),0);assert.equal((bytes.length-8)%32,0);for(let at=8;at<bytes.length;at+=32){const id=readU32(bytes,at);assert(id*32+32<=table.length);table.set(bytes.subarray(at,at+32),id*32);}continue;}
 const overlayMatch=/^ov_(\d+)$/u.exec(name);if(overlayMatch){const id=Number(overlayMatch[1]),old=rom.loadArm9Overlays([id]).get(id)!,base=readU32(bytes,0),size=readU32(bytes,4);assert.equal(readU32(bytes,8),old.ramAddress);assert.equal(readU32(bytes,12),old.data.length);assert(base<=old.ramAddress&&size>=old.data.length+old.ramAddress-base);assert.equal(readU32(table,id*32+4),base);assert.equal(readU32(table,id*32+8),size);const code=new Uint8Array(size);code.set(old.data,old.ramAddress-base);regions(bytes,16,(at,data)=>{assert(at+data.length<=size);code.set(data,at);});table[id*32+31]=2;files.set(readU32(table,id*32+24),code);continue;}
 const narcMatch=/^(narc|narcadd)_(\d+)_(\d+)$/u.exec(name);assert(narcMatch,`Unsupported patch section ${name}`);const id=Number(narcMatch[2]),member=Number(narcMatch[3]),digits=String(id).padStart(3,"0"),path=`a/${digits[0]}/${digits[1]}/${digits[2]}`,fileId=rom.fileId(path);let archive=narcs.get(fileId);if(!archive){archive=new NARC(rom.files[fileId]);narcs.set(fileId,archive);}if(narcMatch[1]==="narcadd")assert.equal(member,archive.files.length);else assert(member<archive.files.length);archive.files[member]=bytes;
}
for(const[id,narc]of narcs)files.set(id,narc.save());
const output=rom.save({arm9,arm9OverlayTable:table,files,preserveOriginalLength:true});const rebuilt=new NintendoDSRom(output,{fileData:"view"});
assert.equal(rebuilt.idCode,"IRBO");assert.deepEqual(decompressCode(rebuilt.arm9),arm9);for(const[id,bytes]of files)assert.deepEqual(rebuilt.files[id],bytes);assert.equal(rebuilt.loadArm9Overlays([93]).get(93)!.ramAddress,0x021b4000);
await writeFile(outputPath,output,{flag:"wx"});assert.equal(hash(new Uint8Array(await readFile(inputPath))),hash(input));console.log(JSON.stringify({outputPath,sha256:hash(output),patchSha256:hash(patch),changedFiles:files.size,bytes:output.length}));
