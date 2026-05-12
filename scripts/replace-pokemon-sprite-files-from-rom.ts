import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";

const [targetRomPath, sourceRomPath, outputRomPath, speciesText, ...fileTexts] = process.argv.slice(2);
if (!targetRomPath || !sourceRomPath || !outputRomPath || !speciesText || fileTexts.length === 0) {
  throw new Error("Usage: npx vite-node scripts/replace-pokemon-sprite-files-from-rom.ts target.nds source.nds output.nds speciesId fileIndex [...]");
}

const speciesId = Number(speciesText);
const fileIndexes = fileTexts.map((text) => Number(text));
if (!Number.isInteger(speciesId)) throw new Error(`Invalid species id: ${speciesText}`);
if (fileIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= 20)) throw new Error(`File indexes must be integers 0-19: ${fileTexts.join(", ")}`);

const [target, source] = await Promise.all([loadRom(targetRomPath), loadRom(sourceRomPath)]);
const targetStore = target.narcs.pokemon_sprites;
const sourceStore = source.narcs.pokemon_sprites;
if (!targetStore || !sourceStore) throw new Error("Pokemon sprite NARC was not loaded");

const copied: Array<{ fileIndex: number; length: number }> = [];
for (const fileIndex of fileIndexes) {
  const absoluteIndex = speciesId * 20 + fileIndex;
  const sourceFile = sourceStore.rawFiles[absoluteIndex];
  if (!sourceFile) throw new Error(`Missing source species ${speciesId} file ${fileIndex}`);
  targetStore.rawFiles[absoluteIndex] = sourceFile.slice();
  targetStore.dirty.add(absoluteIndex);
  copied.push({ fileIndex, length: sourceFile.length });
}

await writeFile(outputRomPath, await exportModifiedRom(target));
console.log(JSON.stringify({ outputRom: outputRomPath, speciesId, copied }, null, 2));

async function loadRom(romPath: string) {
  return loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
    expandSprites: true,
    selectedNarcs: ["pokemon_sprites"],
  });
}
