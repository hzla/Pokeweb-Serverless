import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import {
  compressLz11Literal,
  copyPokemonSpriteVariant,
  getPokemonPalettes,
  getPokemonRigAtlasDimensions,
  importPokemonAnimationBundle,
  setPokemonPalette,
  setPokemonSpriteImage,
  type PokemonAnimationSide,
  type RgbColor,
  type RgbaImageData,
  type RigCell,
} from "../src/pokeweb/pokemonSpriteModel";
import {
  buildPokemonAnimationFile,
  buildPokemonCellBankFileFromCells,
  buildPokemonMultiCellAnimationFile,
  buildPokemonMultiCellsFileFromCells,
  buildRigCellsFile,
  packagePokemonAnimationBundle,
  type PokemonAnimationBundleFileIndex,
} from "../src/pokeweb/pokemonSpriteWriters";

const TEPIG = 498;
const MARKER_X = 0;
const MARKER_Y = 160;
const MARKER_SIZE = 64;
const MARKER_TILE_INDEX = (MARKER_Y / 8) * 32 + MARKER_X / 8;

const [inputRom, outputRom, sideArg] = process.argv.slice(2);
if (!inputRom || !outputRom) {
  throw new Error("Usage: npx vite-node scripts/make-tepig-expanded-rig-atlas-probe.ts patched-white2.nds output.nds [front|back|both]");
}

const sides: PokemonAnimationSide[] = sideArg === "front" ? ["front"] : sideArg === "back" ? ["back"] : ["front", "back"];
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(inputRom))], path.basename(inputRom)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const atlas = getPokemonRigAtlasDimensions(project);
if (!project.rigAtlas?.expanded || atlas.width !== 256 || atlas.height !== 256) {
  throw new Error("This ROM does not load as a patched White 2 expanded-rig-atlas ROM. Run patch-white2-expanded-rig-atlas.ts first.");
}

setPokemonPalette(project, TEPIG, "normal", probePalette());
const palette = getPokemonPalettes(project, TEPIG).normal;

for (const side of sides) {
  const staticSprite = emptyImage(96, 96);
  drawProbeMarker(staticSprite, 16, 16, 64, palette);
  setPokemonSpriteImage(project, TEPIG, { kind: "sprite", side, gender: "male" }, "normal", staticSprite);

  const rig = emptyImage(256, 256);
  drawProbeMarker(rig, MARKER_X, MARKER_Y, MARKER_SIZE, palette);
  drawAtlasGuide(rig, palette);
  setPokemonSpriteImage(project, TEPIG, { kind: "rig", side, gender: "male" }, "normal", rig);
  importPokemonAnimationBundle(project, TEPIG, buildProbeAnimationBundle(side));

  copyPokemonSpriteVariant(project, TEPIG, { kind: "sprite", side, gender: "male" }, { kind: "sprite", side, gender: "female" });
  copyPokemonSpriteVariant(project, TEPIG, { kind: "rig", side, gender: "male" }, { kind: "rig", side, gender: "female" });
}

await writeFile(outputRom, await exportModifiedRom(project));
console.log(JSON.stringify({
  outputRom,
  speciesId: TEPIG,
  sides,
  atlas,
  markerAtlasRect: { x: MARKER_X, y: MARKER_Y, width: MARKER_SIZE, height: MARKER_SIZE },
  markerTileIndex: MARKER_TILE_INDEX,
  expected: "Tepig should render a large red/cyan/yellow probe marker that flips 180 degrees. The NCER OAM points into the expanded y=160 atlas region.",
}, null, 2));

function buildProbeAnimationBundle(side: PokemonAnimationSide): Uint8Array {
  const sideOffset = side === "front" ? 0 : 9;
  const frames = [
    { duration: 12, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
    { duration: 12, cellIndex: 0, x: 0, y: -8, rotation: 0, xScale: 1, yScale: 1 },
    { duration: 12, cellIndex: 0, x: 0, y: 0, rotation: 180, xScale: 1, yScale: 1 },
    { duration: 12, cellIndex: 0, x: 0, y: 8, rotation: 180, xScale: 1, yScale: 1 },
  ];
  const loopDuration = frames.reduce((sum, frame) => sum + frame.duration, 0);
  const ncer = buildPokemonCellBankFileFromCells([
    {
      oams: [{ x: -32, y: -32, width: MARKER_SIZE, height: MARKER_SIZE, characterName: MARKER_TILE_INDEX }],
    },
  ]);
  const nanr = compressLz11Literal(buildPokemonAnimationFile({ targetType: 1, frames: [frames] }));
  const nmcr = buildPokemonMultiCellsFileFromCells([
    [{ sequenceNumber: 0, x: 0, y: 0, cellAnimationIndex: 0, playMode: 0 }],
    [{ sequenceNumber: 0, x: 0, y: 0, cellAnimationIndex: 0, playMode: 0 }],
  ]);
  const nmar = buildPokemonMultiCellAnimationFile(loopDuration);
  const ncec = buildRigCellsFile({ cells: [probeRigCell()], flags: new Uint8Array(4) });
  return packagePokemonAnimationBundle({
    side,
    files: {
      [(4 + sideOffset) as PokemonAnimationBundleFileIndex]: ncer,
      [(5 + sideOffset) as PokemonAnimationBundleFileIndex]: nanr,
      [(6 + sideOffset) as PokemonAnimationBundleFileIndex]: nmcr,
      [(7 + sideOffset) as PokemonAnimationBundleFileIndex]: nmar,
      [(8 + sideOffset) as PokemonAnimationBundleFileIndex]: ncec,
    },
  });
}

function probeRigCell(): RigCell {
  return {
    cellX: MARKER_X,
    cellY: MARKER_Y,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    spriteX: -32,
    spriteY: 32,
    subCell: { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell },
  };
}

function probePalette(): RgbColor[] {
  return [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 0, b: 255 },
    { r: 128, g: 128, b: 128 },
    { r: 255, g: 128, b: 0 },
    { r: 128, g: 0, b: 255 },
    { r: 0, g: 128, b: 255 },
    { r: 128, g: 255, b: 0 },
    { r: 255, g: 192, b: 192 },
    { r: 64, g: 64, b: 64 },
  ];
}

function drawProbeMarker(image: RgbaImageData, x: number, y: number, size: number, palette: RgbColor[]): void {
  fillRect(image, x, y, size, size, palette[3]);
  fillRect(image, x + 4, y + 4, size - 8, size - 8, palette[4]);
  fillRect(image, x + 8, y + 8, size - 16, size - 16, palette[5]);
  fillRect(image, x + 16, y + 16, size - 32, size - 32, palette[3]);
  drawBorder(image, x, y, size, size, 4, palette[2]);
  drawDiagonal(image, x + 6, y + 6, x + size - 7, y + size - 7, 5, palette[1]);
  drawDiagonal(image, x + size - 7, y + 6, x + 6, y + size - 7, 5, palette[1]);
  fillRect(image, x + 24, y + 4, 16, 8, palette[7]);
  fillRect(image, x + 24, y + size - 12, 16, 8, palette[7]);
}

function drawAtlasGuide(image: RgbaImageData, palette: RgbColor[]): void {
  fillRect(image, 0, 128, 256, 2, palette[1]);
  for (let x = 0; x < 256; x += 16) fillRect(image, x, 128, 8, 2, palette[7]);
}

function drawBorder(image: RgbaImageData, x: number, y: number, width: number, height: number, thickness: number, color: RgbColor): void {
  fillRect(image, x, y, width, thickness, color);
  fillRect(image, x, y + height - thickness, width, thickness, color);
  fillRect(image, x, y, thickness, height, color);
  fillRect(image, x + width - thickness, y, thickness, height, color);
}

function drawDiagonal(image: RgbaImageData, x0: number, y0: number, x1: number, y1: number, thickness: number, color: RgbColor): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillRect(image, x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color);
  }
}

function emptyImage(width: number, height: number): RgbaImageData {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function fillRect(image: RgbaImageData, x: number, y: number, width: number, height: number, color: RgbColor): void {
  for (let py = Math.max(0, y); py < Math.min(image.height, y + height); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(image.width, x + width); px += 1) {
      const offset = (py * image.width + px) * 4;
      image.pixels[offset] = color.r;
      image.pixels[offset + 1] = color.g;
      image.pixels[offset + 2] = color.b;
      image.pixels[offset + 3] = 255;
    }
  }
}
