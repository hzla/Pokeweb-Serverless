import { readFile, writeFile } from "node:fs/promises";
import { parseRpm } from "../../src/pokeweb/rpm";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const rpm = parseRpm(new Uint8Array(await readFile(process.argv[2])), { allowedMagics: ["DLXF"] });
if (rpm.code.length + rpm.bssSize > 32768 || rpm.symbols.some(s => s.attributes & 2)) throw Error("Move runtime exceeds its code/state budget or has unresolved imports.");
// RPMTool exports compiler-local symbols too. Preserve their relocation records,
// but use the ELF binding rather than guessing visibility from their names.
if(process.argv[3].endsWith("Compact.json")){
  const bin=process.env.ARM_TOOLCHAIN_BIN??resolve("../toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin");
  const listing=execFileSync(resolve(bin,"arm-none-eabi-readelf"),["-sW",process.argv[4]],{encoding:"utf8"});
  const locals=new Set(listing.split("\n").flatMap(line=>{const match=line.match(/^\s*\d+:\s+\S+\s+\d+\s+\S+\s+LOCAL\s+\S+\s+\S+\s+(\S+)\s*$/u);return match?[match[1]]:[];}));
  for(const symbol of rpm.symbols)if(symbol.name&&locals.has(symbol.name)&&!(symbol.attributes&2))symbol.attributes&=~1;
  rpm.metadata.PokewebMoveLocals=1;
}
await writeFile(process.argv[3], JSON.stringify({ ...rpm, code: Array.from(rpm.code) }) + "\n");
console.log(`Move runtime: ${rpm.code.length} code bytes, ${rpm.bssSize} state bytes.`);
