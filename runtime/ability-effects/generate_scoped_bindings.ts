/** Extract native item checks and the type setter using checked native services.
 * Input is the user's ROM; no decompilation sources or handler bodies are bundled. */
import {readFile,writeFile} from 'node:fs/promises';
import {NintendoDSRom} from '../../src/nds/rom';
import {decompressCode} from '../../src/nds/codeCompression';
import {battleRuntimeResolver,battleBranchTarget} from '../../src/pokeweb/battleRuntimeBindings';
const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: INPUT.nds OUTPUT.json');
const rom=new NintendoDSRom(new Uint8Array(await readFile(input)),{fileData:'view'}),ov=rom.loadArm9Overlays([167]).get(167)!,resolver=battleRuntimeResolver(ov.data,ov.ramAddress,decompressCode(rom.arm9),rom.arm9RamAddress);
const swap=resolver.resolve('IsItemSwapBlocked'),addresses=[battleBranchTarget(swap.code,24,swap.address),battleBranchTarget(swap.code,76,swap.address)];
const functions:Record<string,unknown>={};
for(const [index,name,size,calls]of [[0,'IsItemUnremovable',44,[{offset:2,target:'GetBattleMon'},{offset:8,target:'GetBattleMonSpecies'},{offset:16,target:'GetBattleMonHeldItem'},{offset:26,target:'GiratinaArceusGenesectItemCheck'}]],[1,'GiratinaArceusGenesectItemCheck',68,[]]]as const){
 const bytes=ov.data.slice(addresses[index]-ov.ramAddress,addresses[index]-ov.ramAddress+size),mask=new Uint8Array(size).fill(255);
 for(let at=0;at+4<=bytes.length;at+=2){const h=bytes[at]|bytes[at+1]<<8,l=bytes[at+2]|bytes[at+3]<<8;if((h&0xf800)===0xf000&&(l&0xf800)===0xf800){mask.fill(0,at,at+4);at+=2;}}
 functions[name]={hex:Buffer.from(bytes).toString('hex'),mask:Buffer.from(mask).toString('hex'),calls,module:'167'};
}
const setter=Uint8Array.from(Buffer.from("38b50c1c051c201c12f040fb291cf8310870201c12f03efbf935287038bd","hex")),setterMask=new Uint8Array(setter.length).fill(255);setterMask.fill(0,8,12);setterMask.fill(0,20,24);
const candidates:number[]=[];for(let at=0;at+setter.length<=ov.data.length;at+=2)if(setter.every((v,i)=>(v&setterMask[i])===(ov.data[at+i]&setterMask[i]))&&battleBranchTarget(ov.data,at+8,ov.ramAddress)===resolver.resolve("PokeTypePair_GetType1").address&&battleBranchTarget(ov.data,at+20,ov.ramAddress)===resolver.resolve("PokeTypePair_GetType2").address)candidates.push(at);
if(candidates.length!==1)throw Error("Unrecognized native type setter");
functions.BattleMon_SetType={hex:Buffer.from(ov.data.slice(candidates[0],candidates[0]+setter.length)).toString("hex"),mask:Buffer.from(setterMask).toString("hex"),calls:[{offset:8,target:"PokeTypePair_GetType1"},{offset:20,target:"PokeTypePair_GetType2"}],module:"167"};
await writeFile(output,JSON.stringify({version:1,functions})+'\n');
