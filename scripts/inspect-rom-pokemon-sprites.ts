import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import {
  getPokemonAnimation,
  getPokemonCellBank,
  getPokemonMultiCellAnimation,
  getPokemonMultiCells,
  getPokemonSpriteEntry,
  getPokemonSpriteImage,
  type PokemonAnimationSide,
  type PokemonCell,
  type PokemonPaletteKind,
  type PokemonSpriteVariant,
  type RgbaImageData,
} from "../src/pokeweb/pokemonSpriteModel";

const [romPath, ...idArgs] = process.argv.slice(2);
if (!romPath || idArgs.length === 0) {
  throw new Error("Usage: npx vite-node scripts/inspect-rom-pokemon-sprites.ts rom.nds speciesId [...]");
}

const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});

for (const spriteId of idArgs.map((arg) => Number(arg))) {
  const entry = getPokemonSpriteEntry(project, spriteId);
  console.log(`\n# Species ${spriteId}`);
  console.log(`files ${entry.files.map((file, index) => `${index}:${file.length}`).join(" ")}`);
  for (const side of ["front", "back"] as const) {
    console.log(`\n${side.toUpperCase()}`);
    inspectImages(spriteId, side);
    inspectAnimation(spriteId, side);
  }
}

function inspectImages(spriteId: number, side: PokemonAnimationSide): void {
  for (const kind of ["sprite", "rig"] as const) {
    for (const gender of ["male", "female"] as const) {
      const variant: PokemonSpriteVariant = { kind, side, gender };
      for (const paletteKind of ["normal"] as PokemonPaletteKind[]) {
        try {
          const image = getPokemonSpriteImage(project, spriteId, variant, paletteKind);
          console.log(`${kind}/${gender}: opaque=${countOpaque(image)} bounds=${formatBounds(alphaBounds(image))}`);
        } catch (error) {
          console.log(`${kind}/${gender}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}

function inspectAnimation(spriteId: number, side: PokemonAnimationSide): void {
  try {
    const cellBank = getPokemonCellBank(project, spriteId, side);
    const animation = getPokemonAnimation(project, spriteId, side);
    const multiCells = getPokemonMultiCells(project, spriteId, side);
    const multiAnim = getPokemonMultiCellAnimation(project, spriteId, side);
    const usedCellIndexes = new Set(animation.sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.cellIndex)));
    const usedCells = cellBank.cells.filter((cell) => usedCellIndexes.has(cell.index));
    const maxOams = Math.max(0, ...cellBank.cells.map((cell) => cell.oams.length));
    const usedMaxOams = Math.max(0, ...usedCells.map((cell) => cell.oams.length));
    console.log(`cellBank cells=${cellBank.cells.length} mappingMode=${cellBank.mappingMode} maxOams=${maxOams} usedMaxOams=${usedMaxOams}`);
    console.log(`cell sizes used=${Array.from(usedCellIndexes).sort((a, b) => a - b).map((index) => cellSummary(cellBank.cells[index])).join(" | ")}`);
    console.log(`anim seq=${animation.sequences.length} frames=${animation.sequences.map((sequence) => sequence.frames.length).join(",")} target=${animation.sequences.map((sequence) => sequence.targetType).join(",")} mode=${animation.sequences.map((sequence) => sequence.mode).join(",")}`);
    console.log(`anim bounds=${formatBounds(animationBounds(cellBank.cells, animation.sequences.flatMap((sequence) => sequence.frames)))}`);
    console.log(`multiCells=${multiCells.cells.length} nodes=${multiCells.cells.map((cell) => cell.nodes.map((node) => `seq${node.sequenceNumber}@${node.x},${node.y} visible=${node.visible}`).join(";")).join(" | ")}`);
    console.log(`multiAnim seq=${multiAnim.sequences.length} frames=${multiAnim.sequences.map((sequence) => sequence.frames.length).join(",")} duration=${multiAnim.sequences.map((sequence) => sequence.frames.reduce((sum, frame) => sum + frame.duration, 0)).join(",")}`);
    for (const cell of usedCells.slice(0, 6)) {
      console.log(`cell ${cell.index}: ${cell.oams.map((oam) => `${oam.width}x${oam.height}@${oam.x},${oam.y} tile=${oam.characterName}`).join(" ; ")}`);
    }
  } catch (error) {
    console.log(`animation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cellSummary(cell: PokemonCell | undefined): string {
  return cell ? `${cell.index}:${cell.oams.length}oam bounds=${cell.minX},${cell.minY},${cell.maxX},${cell.maxY}` : "missing";
}

function animationBounds(cells: PokemonCell[], frames: Array<{ cellIndex: number; x: number; y: number }>): { x: number; y: number; width: number; height: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    const cell = cells[frame.cellIndex];
    if (!cell) continue;
    minX = Math.min(minX, cell.minX + frame.x);
    minY = Math.min(minY, cell.minY + frame.y);
    maxX = Math.max(maxX, cell.maxX + frame.x);
    maxY = Math.max(maxY, cell.maxY + frame.y);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : undefined;
}

function countOpaque(image: RgbaImageData): number {
  let count = 0;
  for (let offset = 0; offset < image.pixels.length; offset += 4) if ((image.pixels[offset + 3] ?? 0) >= 128) count += 1;
  return count;
}

function alphaBounds(image: RgbaImageData): { x: number; y: number; width: number; height: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.pixels[(y * image.width + x) * 4 + 3] ?? 0) < 128) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
}

function formatBounds(bounds: ReturnType<typeof alphaBounds>): string {
  return bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : "none";
}
