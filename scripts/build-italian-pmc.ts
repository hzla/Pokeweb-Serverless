/** Retarget the bundled White 2 PMC loader to the audited IRDI address map. */
import { readFile, writeFile } from "node:fs/promises";
import { parseRpm, writeRpm } from "../src/pokeweb/rpm";

function italianAddress(address: number): number {
  if (address >= 0x02024800 && address < 0x02091a00) return address - 0x80;
  if (address >= 0x02091a00 && address < 0x02099000) return address - 0x108;
  if (address >= 0x02099000 && address < 0x020a0000) return address - 0x100;
  return address;
}

const input = new URL("../src/assets/codeinjection/PMC_W2.rpm", import.meta.url);
const output = new URL("../src/assets/codeinjection/PMC_W2I.rpm", import.meta.url);
const rpm = parseRpm(new Uint8Array(await readFile(input)));
if (rpm.metadata.PMCGameID !== "W2" || rpm.metadata.PMCVersion !== "13.2.4")
  throw new Error("Bundled White 2 PMC loader differs from the audited source");
const external = rpm.relocations.filter(relocation => relocation.target.module !== "base");
if (external.length !== 6 || external.some(relocation => relocation.target.module !== "ARM9"))
  throw new Error("Unexpected PMC external relocation layout");
const expectedTargets = [0x0200400c, 0x0200512a, 0x0207b41c, 0x02071080, 0x0203ceae, 0x0203cdea];
for (let i = 0; i < expectedTargets.length; i += 1) {
  if (external[i].target.address !== expectedTargets[i]) throw new Error(`Unexpected PMC hook ${i}`);
  external[i].target.address = italianAddress(external[i].target.address);
}
let imported = 0;
for (const symbol of rpm.symbols) {
  if (!(symbol.attributes & 4)) continue;
  if (symbol.address < 0x02000000 || symbol.address >= 0x02100000) continue;
  symbol.address = italianAddress(symbol.address);
  imported += 1;
}
if (imported !== 24) throw new Error(`Unexpected PMC imported-symbol count: ${imported}`);
rpm.metadata.PMCGameID = "W2I";
rpm.metadata.PMCVersion = "13.2.4-w2i";
await writeFile(output, writeRpm(rpm));
console.log(`Wrote ${output.pathname}; ${external.length} hooks and ${imported} imported addresses retargeted.`);
