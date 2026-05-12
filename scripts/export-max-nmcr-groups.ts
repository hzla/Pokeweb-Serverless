import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { getPokemonMultiCells, getPokemonMultiCellAnimation, type PokemonAnimationSide } from "../src/pokeweb/pokemonSpriteModel";

const [romPath, outDirArg = "analysis/nmcr-max-groups"] = process.argv.slice(2);
if (!romPath) {
  throw new Error("Usage: npx vite-node scripts/export-max-nmcr-groups.ts rom.nds [outDir]");
}

const outDir = path.resolve(outDirArg);
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});

const store = project.narcs.pokemon_sprites;
if (!store) throw new Error("ROM did not load pokemon_sprites");

type Candidate = {
  spriteId: number;
  side: PokemonAnimationSide;
  groupCount: number;
  nodeCounts: number[];
  nmarGroups: number[];
};

const spriteCount = Math.floor(store.rawFiles.length / 20);
const candidates: Candidate[] = [];
for (let spriteId = 0; spriteId < spriteCount; spriteId += 1) {
  for (const side of ["front", "back"] as const) {
    try {
      const multiCells = getPokemonMultiCells(project, spriteId, side);
      const multiAnimation = getPokemonMultiCellAnimation(project, spriteId, side);
      candidates.push({
        spriteId,
        side,
        groupCount: multiCells.cells.length,
        nodeCounts: multiCells.cells.map((cell) => cell.nodes.length),
        nmarGroups: Array.from(new Set(multiAnimation.sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.cellIndex)))).sort((a, b) => a - b),
      });
    } catch {
      // Some terminal placeholder entries do not have valid sprite animation sidecars.
    }
  }
}

const maxGroupCount = Math.max(0, ...candidates.map((candidate) => candidate.groupCount));
const maxEntries = candidates.filter((candidate) => candidate.groupCount === maxGroupCount);
await mkdir(outDir, { recursive: true });

const summary = {
  rom: path.resolve(romPath),
  outDir,
  maxGroupCount,
  entries: maxEntries,
};
await writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const animationIndexes = (side: PokemonAnimationSide) => side === "front"
  ? [4, 5, 6, 7, 8]
  : [13, 14, 15, 16, 17];
const labels = (side: PokemonAnimationSide) => side === "front"
  ? ["ncer", "nanr", "nmcr", "nmar", "ncec"]
  : ["ncer", "nanr", "nmcr", "nmar", "ncec"];

for (const entry of maxEntries) {
  const entryDir = path.join(outDir, `sprite-${String(entry.spriteId).padStart(3, "0")}-${entry.side}`);
  await mkdir(entryDir, { recursive: true });
  const indexes = animationIndexes(entry.side);
  const names = labels(entry.side);
  for (let index = 0; index < indexes.length; index += 1) {
    const fileIndex = indexes[index]!;
    const file = store.rawFiles[entry.spriteId * 20 + fileIndex];
    if (!file) continue;
    await writeFile(path.join(entryDir, `file${fileIndex}-${names[index]}.bin`), file);
  }
  await writeFile(path.join(entryDir, "metadata.json"), `${JSON.stringify(entry, null, 2)}\n`);
}

console.log(`# Exported vanilla max-NMCR-group animation sidecars`);
console.log(`rom=${path.resolve(romPath)}`);
console.log(`outDir=${outDir}`);
console.log(`maxGroupCount=${maxGroupCount}`);
for (const entry of maxEntries) {
  console.log(`sprite=${entry.spriteId} side=${entry.side} groups=${entry.groupCount} nodes=${entry.nodeCounts.join("/")} nmarGroups=${entry.nmarGroups.join("/")}`);
}
