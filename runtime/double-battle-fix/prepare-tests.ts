import { readFileSync } from "node:fs";
import { parseRpm, setRpmBaseAddress, updateRpmCodeImageForBase, writeRelocationDataByType } from "../../src/pokeweb/rpm";

const module = parseRpm(new Uint8Array(readFileSync(new URL("../../src/assets/codeinjection/DoubleBattleFixB.dll", import.meta.url))), { allowedMagics: ["DLXF"] });
setRpmBaseAddress(module, 0x021e0000);
const code = updateRpmCodeImageForBase(module);
const hooks = module.relocations.filter(relocation => relocation.target.module === "21").map(relocation => {
  const address = relocation.target.address & ~1;
  const bytes = new Uint8Array(8);
  writeRelocationDataByType(module, relocation, bytes, address, address);
  return { address, bytes: [...bytes] };
});
if (hooks.length !== 2 || module.metadata.PMCGameID !== "B") throw new Error("Unexpected Black 1 runtime contract.");
console.log(JSON.stringify({ base: module.baseAddress + 0x20, code: [...code], hooks }));
