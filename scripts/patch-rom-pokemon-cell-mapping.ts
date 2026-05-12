import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAscii, readU16, readU32, writeU32 } from "../src/nds/binary";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { compressLz11Literal, decompressNitro } from "../src/pokeweb/pokemonSpriteModel";

const [inputRom, outputRom, ...idArgs] = process.argv.slice(2);
if (!inputRom || !outputRom || idArgs.length === 0) {
  throw new Error("Usage: npx vite-node scripts/patch-rom-pokemon-cell-mapping.ts input.nds output.nds speciesId [...]");
}

const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(inputRom))], path.basename(inputRom)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const store = project.narcs.pokemon_sprites;
if (!store) throw new Error("Pokemon sprite NARC is not loaded");

for (const spriteId of idArgs.map((arg) => Number(arg))) {
  for (const fileIndex of [4, 5, 6, 7, 8, 13, 14, 15, 16, 17]) {
    normalizeAnimationFileCompression(store.rawFiles, spriteId, fileIndex);
    store.dirty.add(spriteId * 20 + fileIndex);
  }
  for (const fileIndex of [4, 13]) {
    const absoluteIndex = spriteId * 20 + fileIndex;
    const original = store.rawFiles[absoluteIndex];
    if (!original || original.length === 0) continue;
    const compressed = original[0] === 0x10 || original[0] === 0x11;
    const decompressed = (compressed ? decompressNitro(original) : original).slice();
    const cebk = findNnsBlockPayload(decompressed, "CEBK");
    if (!cebk) continue;
    const previous = readU32(decompressed, cebk.offset + 8);
    writeU32(decompressed, cebk.offset + 8, 4);
    store.rawFiles[absoluteIndex] = compressed ? compressLz11Literal(decompressed) : decompressed;
    store.dirty.add(absoluteIndex);
    console.log(`species ${spriteId} file ${fileIndex}: mappingMode ${previous} -> 4`);
  }
  if (spriteId === 498) {
    duplicateSpriteFile(store.rawFiles, spriteId, 9, 10);
    duplicateSpriteFile(store.rawFiles, spriteId, 11, 12);
    store.dirty.add(spriteId * 20 + 10);
    store.dirty.add(spriteId * 20 + 12);
    console.log("species 498: duplicated back male sprite/rig files into female back slots");
  }
}

await writeFile(outputRom, await exportModifiedRom(project));
console.log(`wrote ${outputRom}`);

function findNnsBlockPayload(bytes: Uint8Array, signature: string): { offset: number; size: number } | undefined {
  const expected = signature.split("").reverse().join("");
  const headerSize = readU16(bytes, 0x0c);
  const sectionCount = readU16(bytes, 0x0e);
  let offset = headerSize;
  for (let i = 0; i < sectionCount && offset + 8 <= bytes.length; i += 1) {
    const blockSize = readU32(bytes, offset + 4);
    if (readAscii(bytes, offset, 4) === expected) return { offset: offset + 8, size: Math.max(0, blockSize - 8) };
    offset += blockSize;
  }
  return undefined;
}

function duplicateSpriteFile(files: Uint8Array[], spriteId: number, sourceFileIndex: number, targetFileIndex: number): void {
  const source = files[spriteId * 20 + sourceFileIndex];
  if (!source || source.length === 0) throw new Error(`Species ${spriteId} source file ${sourceFileIndex} is empty`);
  files[spriteId * 20 + targetFileIndex] = source.slice();
}

function normalizeAnimationFileCompression(files: Uint8Array[], spriteId: number, fileIndex: number): void {
  const absoluteIndex = spriteId * 20 + fileIndex;
  const original = files[absoluteIndex];
  if (!original || original.length === 0) return;
  const compressed = original[0] === 0x10 || original[0] === 0x11;
  const raw = compressed ? decompressNitro(original) : original;
  files[absoluteIndex] = fileIndex === 5 || fileIndex === 14 ? compressLz11Literal(raw) : raw.slice();
}
