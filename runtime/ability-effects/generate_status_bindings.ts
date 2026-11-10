/** Native status-attempt call boundary. Source ROMs are explicit revision-0 inputs. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {NintendoDSRom} from '../../src/nds/rom';
import {decompressCode} from '../../src/nds/codeCompression';
import {readU16} from '../../src/nds/binary';
import {battleBranchTarget,battleRuntimeResolver,BATTLE_RUNTIME_SIGNATURES,type BattleRuntimeSignature} from '../../src/pokeweb/battleRuntimeBindings';
import black from '../../src/assets/data/abilityBindingsB1.json';
import white from '../../src/assets/data/abilityBindingsW1.json';
const [w2,b,w,output]=process.argv.slice(2);assert(output,'Usage: CLEAN_W2 CLEAN_B CLEAN_W OUTPUT');
const profiles:Record<string,Record<string,BattleRuntimeSignature>>={};
for(const[key,path,overlayId,catalog]of [['BW2',w2,167,BATTLE_RUNTIME_SIGNATURES],['B',b,93,black.functions],['W',w,93,white.functions]] as const){
 const rom=new NintendoDSRom(new Uint8Array(await readFile(path)),{fileData:'view'});assert.equal(rom.data[30],0);
 const ov=rom.loadArm9Overlays([overlayId]).get(overlayId)!,module=String(overlayId),base=ov.ramAddress;
 const prefix=Buffer.from('f0b583b0171c08aa12791c1c08ab0092','hex'),matches:number[]=[];
 for(let at=0;at+32<ov.data.length;at+=2)if(prefix.every((v,n)=>v===ov.data[at+n]))matches.push(at);
 assert.equal(matches.length,1,key);const at=matches[0],target=battleBranchTarget(ov.data,at+24,base),check=ov.data.slice(target-base,target-base+228);
 assert.equal(Buffer.from(check.subarray(0,12)).toString('hex'),'70b50d1c141c061c281c211c');
 const resolver=battleRuntimeResolver(ov.data,base,decompressCode(rom.arm9),rom.arm9RamAddress,catalog as Record<string,BattleRuntimeSignature>);
 const calls:Array<{offset:number;target:string}>=[],mask=new Uint8Array(check.length).fill(255),extra:Record<string,BattleRuntimeSignature>={};
 for(let i=0;i+4<=check.length;i+=2)if((readU16(check,i)&0xf800)===0xf000&&(readU16(check,i+2)&0xf800)===0xf800){
  const address=battleBranchTarget(check,i,target);let name=Object.keys(catalog).find(n=>resolver.matches(n,address));
  if(!name){name=`AbilityStatusDependency${i}`;const bytes=ov.data.slice(address-base,address-base+12);assert(bytes.length===12);extra[name]={module,hex:Buffer.from(bytes).toString('hex'),mask:'ff'.repeat(12),calls:[]};}
  calls.push({offset:i,target:name});mask.fill(0,i,i+4);i+=2;
 }
 const site=ov.data.slice(at,at+32),siteMask=new Uint8Array(32).fill(255);siteMask.fill(0,24,28);
 profiles[key]={AbilityStatusBoundary:{module,hex:Buffer.from(site).toString('hex'),mask:Buffer.from(siteMask).toString('hex'),calls:[{offset:24,target:'AbilityStatusNativeCheck'}]},AbilityStatusNativeCheck:{module,hex:Buffer.from(check).toString('hex'),mask:Buffer.from(mask).toString('hex'),calls},...extra};
 console.log(key,target.toString(16),calls);
}
await writeFile(output,JSON.stringify({version:1,profiles})+'\n');
