/** Generate move-selection signatures from explicit clean US revision-0 ROMs. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
const [black,white,black2,white2,output]=process.argv.slice(2);assert(black&&white&&black2&&white2&&output,"Usage: BLACK.nds WHITE.nds BLACK2.nds WHITE2.nds OUTPUT.json");
const profiles:Record<string,unknown>={};
for(const [path,game,id,address,size] of [[black,"IRBO",93,0x21cf5b0,620],[white,"IRAO",93,0x21cf5d0,620],[black2,"IREO",167,0x21b47b8,748],[white2,"IRDO",167,0x21b47f8,748]] as const){
 const rom=new NintendoDSRom(new Uint8Array(await readFile(path)),{fileData:"view"});assert.equal(rom.idCode,game);assert.equal(rom.data[30],0);
 const ov=rom.loadArm9Overlays([id]).get(id)!,at=address-ov.ramAddress,bytes=ov.data.slice(at,at+size);assert.equal(bytes.length,size);
 assert.deepEqual([...bytes.slice(0,12)],[0xf0,0xb5,0x85,0xb0,0x15,0x1c,0x07,0x1c,0x0e,0x1c,0x1c,0x1c]);
 const mask=new Uint8Array(size).fill(255);
 for(let offset=0;offset+4<=size;offset+=2)if((address+offset)%4===0){const value=readU32(bytes,offset);if(value>=0x02000000&&value<0x02400000)mask.fill(0,offset,offset+4);}
 assert.equal(readU16(bytes,0),0xb5f0);
 profiles[game]={hex:Buffer.from(bytes).toString("hex"),mask:Buffer.from(mask).toString("hex"),module:String(id),calls:[]};
}
await writeFile(output,JSON.stringify(profiles)+"\n");
console.log("Generated checked BW1 and BW2 move-selection signatures.");
