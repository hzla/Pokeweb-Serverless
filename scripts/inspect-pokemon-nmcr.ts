import { readFile } from "node:fs/promises";
import path from "node:path";
import { readAscii, readU16, readU32 } from "../src/nds/binary";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";

const [romPath, speciesText] = process.argv.slice(2);
if (!romPath || !speciesText) throw new Error("Usage: npx vite-node scripts/inspect-pokemon-nmcr.ts rom.nds speciesId");

const speciesId = Number(speciesText);
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const nmcr = project.narcs.pokemon_sprites?.rawFiles[speciesId * 20 + 15];
if (!nmcr) throw new Error(`Missing species ${speciesId} file 15`);

const blockOffset = 0x10;
const payloadOffset = blockOffset + 8;
const blockSize = readU32(nmcr, blockOffset + 4);
const multiCellDataOffset = readU32(nmcr, payloadOffset + 4);
const hierarchyDataOffset = readU32(nmcr, payloadOffset + 8);
const stringBankOffset = readU32(nmcr, payloadOffset + 0x0c);
const extendedDataOffset = readU32(nmcr, payloadOffset + 0x10);

console.log(`# ${path.basename(romPath)} species ${speciesId} NMCR/file15 len=${nmcr.length}`);
console.log(`fileSig=${readAscii(nmcr, 0, 4)} blockSig=${readAscii(nmcr, blockOffset, 4)} blockSize=${blockSize}`);
console.log(
  `bank count=${readU16(nmcr, payloadOffset)} pad=${readU16(nmcr, payloadOffset + 2)}` +
    ` multiCellDataOffset=0x${hex32(multiCellDataOffset)}` +
    ` hierarchyDataOffset=0x${hex32(hierarchyDataOffset)}` +
    ` stringBankOffset=0x${hex32(stringBankOffset)}` +
    ` extendedDataOffset=0x${hex32(extendedDataOffset)}`,
);

const multiCellBase = payloadOffset + multiCellDataOffset;
const hierarchyBase = payloadOffset + hierarchyDataOffset;
const count = readU16(nmcr, payloadOffset);
for (let index = 0; index < count; index += 1) {
  const offset = multiCellBase + index * 8;
  const nodeCount = readU16(nmcr, offset);
  const cellAnimCount = readU16(nmcr, offset + 2);
  const nodeOffset = readU32(nmcr, offset + 4);
  console.log(`multiCell[${index}] nodes=${nodeCount} cellAnim=${cellAnimCount} hierarchyOffset=0x${hex32(nodeOffset)}`);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const node = hierarchyBase + nodeOffset + nodeIndex * 8;
    console.log(
      `  node[${nodeIndex}] seq=${readU16(nmcr, node)}` +
        ` x=${readS16(nmcr, node + 2)} y=${readS16(nmcr, node + 4)}` +
        ` attr=0x${readU16(nmcr, node + 6).toString(16).padStart(4, "0")}`,
    );
  }
}
console.log(`hex=${Array.from(nmcr).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`);

function readS16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function hex32(value: number): string {
  return value.toString(16).padStart(8, "0");
}
