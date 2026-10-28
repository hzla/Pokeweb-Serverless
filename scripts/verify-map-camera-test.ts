import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { buildMapCameraTestDownloads } from '../src/pokeweb/mapCameraTest';
import { getTestBattleConfigForProject,loadTestBattleSave } from '../src/pokeweb/testBattle';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';
import { readU16,writeU32 } from '../src/nds/binary';
import { gen5ScriptEntries } from '../src/pokeweb/gen5ScriptCommands';
import { decompileBw2Script,compileBw2Script } from '../src/pokeweb/bw2ScriptCompiler';

const [input,prefix]=process.argv.slice(2);
if(!input||!prefix)throw new Error('Usage: vite-node scripts/verify-map-camera-test.ts CLEAN.nds NEW_OUTPUT_PREFIX');
globalThis.fetch=(async request=>{const url=request instanceof URL?request:new URL(request instanceof Request?request.url:String(request));if(url.protocol!=='file:')throw new Error('Only bundled local assets are expected.');return new Response(new Uint8Array(await fs.readFile(url)));}) as typeof fetch;
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const project=await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)),'map-camera-test.nds',{selectedNarcs:['headers']}),save=await loadTestBattleSave(getTestBattleConfigForProject(project));
for(const [name,position] of [
  ['lookout',{zoneId:427,tileX:35,tileZ:709,height:144,facing:'up'}],
  ['route13',{zoneId:370,tileX:697,tileZ:239,height:0,facing:'right'}],
] as const){
  const dirty=JSON.stringify([Object.keys(project.fileSystem?.replacements??{}),Object.values(project.narcs).map(n=>n&&[...n.dirty])]),result=await buildMapCameraTestDownloads(project,position);
  if(hash(result.saveBytes)!==hash(save.rawSaveBytes))throw new Error('The bundled save changed.');
  if(dirty!==JSON.stringify([Object.keys(project.fileSystem?.replacements??{}),Object.values(project.narcs).map(n=>n&&[...n.dirty])]))throw new Error('The fixture modified the project.');
  const rom=new NintendoDSRom(result.romBytes,{fileData:'view'}),headers=new NARC(rom.getFileByName('a/0/1/2')).files[0],scriptId=readU16(headers,427*48+6),eventId=readU16(headers,427*48+22),scripts=new NARC(rom.getFileByName('a/0/5/6')),events=new NARC(rom.getFileByName('a/1/2/6'));
  const program=scripts.files[scriptId],body=program.subarray(gen5ScriptEntries(program)[result.trigger.entryId-1]),isolated=new Uint8Array(6+body.length);writeU32(isolated,0,2);isolated.set([0x13,0xfd],4);isolated.set(body,6);
  const script=decompileBw2Script(isolated);if(!script.editable)throw new Error('Exported test entry is not round-trip editable.');
  const warp=compileBw2Script(script.source).instructions.filter(i=>i.opcode===0xc2).at(-1);
  if(JSON.stringify(warp?.operands)!==JSON.stringify([position.zoneId,position.tileX,position.tileZ,name==='lookout'?0:3]))throw new Error('Exported destination mismatch.');
  const bytes=events.files[eventId],at=8+bytes[4]*20+bytes[5]*36+bytes[6]*20+(bytes[7]-1)*22;
  if(readU16(bytes,at+10)!==save.gridX||readU16(bytes,at+12)!==save.gridZ||readU16(bytes,at+16)!==2)throw new Error('Launch trigger is not under/below the saved player.');
  await fs.writeFile(`${prefix}-${name}.nds`,result.romBytes,{flag:'wx'});await fs.writeFile(`${prefix}-${name}.sav`,result.saveBytes,{flag:'wx'});
  const manifest={passed:true,destination:position,trigger:result.trigger,saveUnchanged:true,projectUnchanged:true,nativeWarp:true,romSha256:hash(result.romBytes),saveSha256:hash(result.saveBytes)};
  await fs.writeFile(`${prefix}-${name}.json`,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(manifest));
}
