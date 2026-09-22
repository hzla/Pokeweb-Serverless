// Read the actual seamless-zone setup entries; do not classify operand bytes.
import {readFile} from 'node:fs/promises';
import {NintendoDSRom} from '../src/nds/rom';
import {NARC} from '../src/nds/narc';
import {gen5ScriptCommandOffsets} from '../src/pokeweb/gen5ScriptCommands';
import policy from '../runtime/following-pokemon/event-policy.json';
const path=process.argv[2];
if(!path) throw new Error('Expected audited US White 2 ROM');
const r=new NintendoDSRom(new Uint8Array(await readFile(path)),{fileData:'view'});
const s=new NARC(r.files[r.filenames.idOf('a/0/5/6')!]);
const headers=new NARC(r.files[r.filenames.idOf('a/0/1/2')!]).files[0];
const h=new DataView(headers.buffer,headers.byteOffset,headers.byteLength);
for(const [zone,bank,entry] of [[439,878,0],[446,892,6]]) {
 if(h.getUint16(zone*48+6,true)!==bank) throw new Error('Zone script bank mismatch');
 const init=s.files[h.getUint16(zone*48+8,true)];
 const iv=new DataView(init.buffer,init.byteOffset,init.byteLength);
 if(iv.getUint16(0,true)!==2||iv.getUint16(2,true)!==entry+1) throw new Error('Zone setup entry mismatch');
 const b=s.files[bank];const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const codes=gen5ScriptCommandOffsets(b,'BW2',{entryIndices:[entry]}).map(o=>v.getUint16(o,true));
 if(!codes.includes(0x1d9)) throw new Error('Expected pending NPC placement command');
 for(const code of codes) if(!policy.commands.some(e=>e.opcode===code)) throw new Error(`Unsupported zone ${zone} setup command ${code.toString(16)}`);
 console.log(`Zone ${zone}, bank ${bank}, entry ${entry}: ${codes.length} reachable commands covered, including pending NPC placement. Conditional branches retained; no game emulator run.`);
}
