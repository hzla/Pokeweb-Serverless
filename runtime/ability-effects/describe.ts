import { readFile, writeFile } from "node:fs/promises";
import { parseRpm } from "../../src/pokeweb/rpm";
const rpm = parseRpm(new Uint8Array(await readFile(process.argv[2])), { allowedMagics: ["DLXF"] });
if (rpm.bssSize > 16384 || rpm.symbols.some(s => s.attributes & 2)) throw new Error("Ability template exceeds its state budget or has unresolved imports.");
await writeFile(process.argv[3], JSON.stringify({ ...rpm, code: Array.from(rpm.code) }) + "\n");
console.log(`Ability runtime: ${rpm.code.length} code bytes, ${rpm.bssSize} BSS bytes, ${rpm.relocations.length} internal relocations.`);
