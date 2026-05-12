import { readFile } from "node:fs/promises";
import path from "node:path";
import { readAscii, readU16, readU32 } from "../src/nds/binary";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { decompressNitro } from "../src/pokeweb/pokemonSpriteModel";

const [romPath, speciesText] = process.argv.slice(2);
if (!romPath || !speciesText) {
  throw new Error("Usage: npx vite-node scripts/inspect-pokemon-rig-format.ts rom.nds speciesId");
}

const speciesId = Number(speciesText);
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const files = project.narcs.pokemon_sprites?.rawFiles.slice(speciesId * 20, speciesId * 20 + 20);
if (!files) throw new Error("Pokemon sprite NARC was not loaded");

console.log(`# ${path.basename(romPath)} species ${speciesId}`);
inspectImage("front sprite M", files[0]);
inspectImage("front rig M", files[2]);
inspectNcec("front NCEC", files[8]);
inspectImage("back sprite M", files[9]);
inspectImage("back rig M", files[11]);
inspectNcec("back NCEC", files[17]);

function inspectImage(label: string, file: Uint8Array | undefined): void {
  if (!file || file.length === 0) {
    console.log(`\n${label}: empty`);
    return;
  }
  const bytes = maybeDecompress(file);
  console.log(`\n${label}: fileLen=${file.length} decodedLen=${bytes.length} sig=${ascii(bytes, 0, 4)}`);
  const rahc = findBlock(bytes, "RAHC") ?? findBlock(bytes, "CHAR");
  if (!rahc) {
    console.log("  no character block");
    return;
  }
  const p = rahc.offset;
  const h = readU16(bytes, p);
  const w = readU16(bytes, p + 2);
  const fmt = readU32(bytes, p + 4);
  const mapping = readU32(bytes, p + 8);
  const type = readU32(bytes, p + 0x0c);
  const dataSize = readU32(bytes, p + 0x10);
  const gfxOffset = readU32(bytes, p + 0x14);
  const presentTiles4bpp = dataSize / 32;
  console.log(`  RAHC h=${h} w=${w} fmt=${fmt} mapping=${mapping} type=${type} dataSize=${dataSize} gfxOffset=${gfxOffset} tiles4bpp=${presentTiles4bpp}`);
  console.log(`  header48=${hex(bytes.slice(0, 48))}`);
}

function inspectNcec(label: string, file: Uint8Array | undefined): void {
  if (!file || file.length === 0) {
    console.log(`\n${label}: empty`);
    return;
  }
  const bytes = maybeDecompress(file);
  const count = readU32(bytes, 0);
  const sizeX = readU16(bytes, 4);
  const sizeY = readU16(bytes, 6);
  const ofsX = readS16(bytes, 8);
  const ofsY = readS16(bytes, 10);
  console.log(`\n${label}: fileLen=${file.length} decodedLen=${bytes.length} count=${count} size=${sizeX}x${sizeY} ofs=${ofsX},${ofsY} flags=${Math.max(0, bytes.length - (12 + count * 48))}`);
  for (let i = 0; i < Math.min(count, 16); i += 1) {
    const o = 12 + i * 48;
    console.log(
      `  ${i}: sprite=${readS32(bytes, o) / 0x100},${readS32(bytes, o + 4) / 0x100}` +
        ` size=${readS32(bytes, o + 8) / 0x1000}x${readS32(bytes, o + 12) / 0x1000}` +
        ` tex=${readS32(bytes, o + 16) / 0x1000},${readS32(bytes, o + 20) / 0x1000}` +
        ` subSize=${readS32(bytes, o + 32) / 0x1000}x${readS32(bytes, o + 36) / 0x1000}`,
    );
  }
  console.log(`  first64=${hex(bytes.slice(0, 64))}`);
}

function maybeDecompress(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function findBlock(bytes: Uint8Array, signature: string): { offset: number; size: number } | undefined {
  const headerSize = readU16(bytes, 0x0c);
  const count = readU16(bytes, 0x0e);
  let offset = headerSize;
  for (let i = 0; i < count && offset + 8 <= bytes.length; i += 1) {
    const block = ascii(bytes, offset, 4);
    const size = readU32(bytes, offset + 4);
    if (block === signature) return { offset: offset + 8, size: size - 8 };
    offset += size;
  }
  return undefined;
}

function readS16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readS32(bytes: Uint8Array, offset: number): number {
  const value = readU32(bytes, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return offset + length <= bytes.length ? readAscii(bytes, offset, length) : "";
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
