import { readFile, writeFile } from "node:fs/promises";
import { parseRpm } from "../../src/pokeweb/rpm";
const rpm = parseRpm(new Uint8Array(await readFile(process.argv[2])), { allowedMagics: ["DLXF"] });
if (rpm.code.length + rpm.bssSize > 32768 || rpm.symbols.some(s => s.attributes & 2)) throw Error("Move runtime exceeds its code/state budget or has unresolved imports.");
await writeFile(process.argv[3], JSON.stringify({ ...rpm, code: Array.from(rpm.code) }) + "\n");
console.log(`Move runtime: ${rpm.code.length} code bytes, ${rpm.bssSize} state bytes.`);
