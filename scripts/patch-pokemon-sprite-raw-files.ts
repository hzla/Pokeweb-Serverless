import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";

const [inputRomPath, rawFilesDir, outputRomPath, speciesText] = process.argv.slice(2);
if (!inputRomPath || !rawFilesDir || !outputRomPath || !speciesText) {
  throw new Error("Usage: npx vite-node scripts/patch-pokemon-sprite-raw-files.ts input.nds raw-files-dir output.nds speciesId");
}

const speciesId = Number(speciesText);
if (!Number.isInteger(speciesId) || speciesId < 0) throw new Error(`Invalid species id: ${speciesText}`);

const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(inputRomPath))], path.basename(inputRomPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const store = project.narcs.pokemon_sprites;
if (!store) throw new Error("Pokemon sprite NARC was not loaded");

const files = await readdir(rawFilesDir);
const patched: Array<{ fileIndex: number; length: number; source: string }> = [];
for (let fileIndex = 0; fileIndex < 20; fileIndex += 1) {
  const match = files.find((file) => new RegExp(`(?:^|_)${speciesId}_${fileIndex.toString().padStart(2, "0")}\\.bin$`, "u").test(file))
    ?? files.find((file) => new RegExp(`(?:^|_)${speciesId}_${fileIndex}\\.bin$`, "u").test(file))
    ?? files.find((file) => new RegExp(`(?:^|_)${fileIndex.toString().padStart(2, "0")}\\.bin$`, "u").test(file))
    ?? files.find((file) => new RegExp(`(?:^|_)${fileIndex}\\.bin$`, "u").test(file));
  if (!match) throw new Error(`Missing raw file for species ${speciesId} file ${fileIndex}`);
  const bytes = new Uint8Array(await readFile(path.join(rawFilesDir, match)));
  const absoluteIndex = speciesId * 20 + fileIndex;
  store.rawFiles[absoluteIndex] = bytes;
  store.dirty.add(absoluteIndex);
  patched.push({ fileIndex, length: bytes.length, source: match });
}

await writeFile(outputRomPath, await exportModifiedRom(project));
console.log(JSON.stringify({ inputRom: inputRomPath, outputRom: outputRomPath, speciesId, patched }, null, 2));
