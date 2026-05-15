import { readFile, writeFile } from "node:fs/promises";
import { patchWhite2ExpandedRigAtlasRom } from "../src/pokeweb/expandedRigAtlasPatch";

const [inputRom, outputRom] = process.argv.slice(2);
if (!inputRom || !outputRom) {
  throw new Error("Usage: npx vite-node scripts/patch-white2-expanded-rig-atlas.ts input.nds output.nds");
}

const { rom, result } = patchWhite2ExpandedRigAtlasRom(new Uint8Array(await readFile(inputRom)));
for (const address of result.patchedAddresses) {
  console.log(`patched ${formatAddress(address)}: mixed-size rig atlas support`);
}
for (const address of result.alreadyPatchedAddresses) {
  console.log(`already patched ${formatAddress(address)}: mixed-size rig atlas support`);
}
await writeFile(outputRom, rom);
console.log(`wrote ${outputRom}`);

function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(8, "0")}`;
}
