import { readFile, writeFile } from "node:fs/promises";
import { parseRpm } from "../../src/pokeweb/rpm";
const rpm=parseRpm(new Uint8Array(await readFile(process.argv[2]!)),{allowedMagics:["DLXF"]});
const types=["NULL","VALUE","FUNCTION_ARM","FUNCTION_THM","SECTION"];
if(rpm.symbols.some(s=>s.attributes&2))throw new Error("Unexpected dynamic import");
await writeFile(process.argv[3]!,JSON.stringify({codeHex:Buffer.from(rpm.code).toString("hex"),bss:rpm.bssSize,
  relocations:rpm.relocations.map(({target:t,sourceSymbolIndex:i})=>{const s=rpm.symbols[i];return `${t.module}:${t.address.toString(16)}:${t.type}:${s.address.toString(16)}:${types.indexOf(s.type)}:${s.attributes}`;}).sort()}));
