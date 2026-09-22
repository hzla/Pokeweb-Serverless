// Inspect executed command locations in the stock US PC script, never raw operands.
import { readFile } from 'node:fs/promises';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';
import { gen5ScriptCommandOffsets } from '../src/pokeweb/gen5ScriptCommands';
import policy from '../runtime/following-pokemon/event-policy.json';
const path = process.argv[2];
if (!path) throw new Error('Expected stock US White 2 or audited Upgrade ROM');
const rom = new NintendoDSRom(new Uint8Array(await readFile(path)), {fileData:'view'});
const archive = new NARC(rom.files[rom.filenames.idOf('a/0/5/6')!]);
// Verified native common-script table: ID 10090..10099 -> bank 1244.
const bytes = archive.files[1244];
const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const codes = new Set(gen5ScriptCommandOffsets(bytes,'BW2').map(o=>view.getUint16(o,true)));
const safe = new Set(policy.commands.map(e=>e.opcode));
const conditionalPc = new Set([0x1a3,0x1a4,0x1a7]);
const otherApplications = new Set([0x14d,0x150,0x231]);
for (const c of [0xea,0x130,0x131,0x132,0x14f,0x1a3,0x1a4,0x1a7]) {
 if (!codes.has(c)) throw new Error(`PC script missing expected command ${c.toString(16)}`);
}
for(const c of codes) if(!safe.has(c)&&!conditionalPc.has(c)&&!otherApplications.has(c))
 throw new Error(`Unreviewed PC script command ${c.toString(16)}`);
console.log(`PC bank 1244: ${codes.size} reachable command types; normal storage path classified; three other application branches remain conservative. No emulator execution.`);
