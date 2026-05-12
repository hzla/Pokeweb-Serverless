import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { getPokemonMultiCellAnimation, getPokemonMultiCells, type PokemonAnimationSide } from "../src/pokeweb/pokemonSpriteModel";

const [romPath, thresholdText] = process.argv.slice(2);
if (!romPath) {
  throw new Error("Usage: npx vite-node scripts/probe-nmcr-group-counts.ts rom.nds [threshold=2]");
}

const threshold = Number.isFinite(Number(thresholdText)) ? Number(thresholdText) : 2;
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});

const store = project.narcs.pokemon_sprites;
if (!store) throw new Error("ROM did not load pokemon_sprites");

type ProbeRow = {
  spriteId: number;
  side: PokemonAnimationSide;
  groupCount: number;
  nodeCounts: number[];
  cellAnimationCounts: number[];
  nmarReferencedGroups: number[];
  maxNmarGroup: number;
};

const rows: ProbeRow[] = [];
const errors: Array<{ spriteId: number; side: PokemonAnimationSide; message: string }> = [];
const spriteCount = Math.floor(store.rawFiles.length / 20);

for (let spriteId = 0; spriteId < spriteCount; spriteId += 1) {
  for (const side of ["front", "back"] as const) {
    try {
      const multiCells = getPokemonMultiCells(project, spriteId, side);
      const multiAnimation = getPokemonMultiCellAnimation(project, spriteId, side);
      const nmarReferencedGroups = Array.from(
        new Set(multiAnimation.sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.cellIndex))),
      ).sort((left, right) => left - right);
      rows.push({
        spriteId,
        side,
        groupCount: multiCells.cells.length,
        nodeCounts: multiCells.cells.map((cell) => cell.nodes.length),
        cellAnimationCounts: multiCells.cells.map((cell) => cell.cellAnimationCount),
        nmarReferencedGroups,
        maxNmarGroup: Math.max(-1, ...nmarReferencedGroups),
      });
    } catch (error) {
      errors.push({ spriteId, side, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

const aboveThreshold = rows.filter((row) => row.groupCount > threshold);
const maxGroupCount = Math.max(0, ...rows.map((row) => row.groupCount));
const groupHistogram = histogram(rows.map((row) => row.groupCount));
const maxReferencedGroup = Math.max(-1, ...rows.map((row) => row.maxNmarGroup));

console.log(`# NMCR group count probe`);
console.log(`rom=${path.resolve(romPath)}`);
console.log(`spriteEntries=${spriteCount} sides=${rows.length} parseErrors=${errors.length}`);
console.log(`maxGroupCount=${maxGroupCount} maxNmarReferencedGroup=${maxReferencedGroup}`);
console.log(`groupCountHistogram=${formatHistogram(groupHistogram)}`);
console.log(`entriesWithGroupCountGreaterThan${threshold}=${aboveThreshold.length}`);

if (aboveThreshold.length > 0) {
  console.log("\n# Entries above threshold");
  for (const row of aboveThreshold) {
    console.log(
      [
        `sprite=${row.spriteId}`,
        `side=${row.side}`,
        `groups=${row.groupCount}`,
        `nodes=${row.nodeCounts.join("/")}`,
        `cellAnimCounts=${row.cellAnimationCounts.join("/")}`,
        `nmarGroups=${row.nmarReferencedGroups.join("/") || "none"}`,
      ].join(" "),
    );
  }
}

if (errors.length > 0) {
  console.log("\n# Parse errors");
  for (const error of errors.slice(0, 50)) {
    console.log(`sprite=${error.spriteId} side=${error.side} error=${error.message}`);
  }
  if (errors.length > 50) console.log(`... ${errors.length - 50} more`);
}

function histogram(values: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return new Map(Array.from(counts.entries()).sort((left, right) => left[0] - right[0]));
}

function formatHistogram(counts: Map<number, number>): string {
  return Array.from(counts.entries()).map(([value, count]) => `${value}:${count}`).join(" ");
}
