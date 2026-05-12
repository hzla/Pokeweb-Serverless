import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import {
  compressLz11Literal,
  getPokemonPalettes,
  importPokemonAnimationBundle,
  setPokemonSpriteImage,
  type RgbColor,
  type RgbaImageData,
} from "../src/pokeweb/pokemonSpriteModel";
import {
  buildPokemonAnimationAssetBundle,
  packagePokemonAnimationBundle,
  type PokemonAnimationBundleFileIndex,
} from "../src/pokeweb/pokemonSpriteWriters";

const inputRom = process.argv[2] ?? "/path/to/Port-Pokeweb/testani.nds";
const outputRom = process.argv[3] ?? "/path/to/Port-Pokeweb/testani-tepig-back-one-oam.nds";
const TEPIG = 498;

const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(inputRom))], path.basename(inputRom)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const palette = getPokemonPalettes(project, TEPIG).normal;
const fill = visibleColor(palette);
const outline = palette[2] ?? fill;

const staticSprite = emptyImage(96, 96);
fillRect(staticSprite, 40, 64, 16, 16, outline);
fillRect(staticSprite, 42, 66, 12, 12, fill);
const rig = emptyImage(256, 128);
fillRect(rig, 0, 0, 16, 16, outline);
fillRect(rig, 2, 2, 12, 12, fill);

setPokemonSpriteImage(project, TEPIG, { kind: "sprite", side: "back", gender: "male" }, "normal", staticSprite);
setPokemonSpriteImage(project, TEPIG, { kind: "rig", side: "back", gender: "male" }, "normal", rig);
copySpriteFile(TEPIG, 9, 10);
copySpriteFile(TEPIG, 11, 12);

const bundle = buildPokemonAnimationAssetBundle({
  side: "back",
  loopDuration: 64,
  parts: [
    {
      name: "tepig-one-oam-test-block",
      cellX: 0,
      cellY: 0,
      width: 16,
      height: 16,
      spriteX: -8,
      spriteY: 16,
      pivot: { x: 8, y: 16 },
      frames: [{ duration: 64, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 }],
    },
  ],
});
importPokemonAnimationBundle(project, TEPIG, packagePokemonAnimationBundle({
  side: "back",
  files: Object.fromEntries(
    Object.entries(bundle.files).map(([index, file]) => {
      const fileIndex = Number(index) as PokemonAnimationBundleFileIndex;
      return [fileIndex, file && shouldCompressAnimationFile(fileIndex) ? compressLz11Literal(file) : file];
    }),
  ) as typeof bundle.files,
}));

await writeFile(outputRom, await exportModifiedRom(project));
console.log(`wrote ${outputRom}`);
console.log("Tepig back test: 16x16 square, one animation cell, one 16x16 OAM, male back copied to female back sprite/rig slots.");

function copySpriteFile(spriteId: number, sourceFileIndex: number, targetFileIndex: number): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon sprite NARC is not loaded");
  const source = store.rawFiles[spriteId * 20 + sourceFileIndex];
  if (!source || source.length === 0) throw new Error(`Species ${spriteId} source file ${sourceFileIndex} is empty`);
  const target = spriteId * 20 + targetFileIndex;
  store.rawFiles[target] = source.slice();
  store.dirty.add(target);
}

function shouldCompressAnimationFile(fileIndex: PokemonAnimationBundleFileIndex): boolean {
  return fileIndex === 5 || fileIndex === 14;
}

function visibleColor(palette: RgbColor[]): RgbColor {
  return palette.find((color, index) => index > 0 && (color.r !== 0 || color.g !== 0 || color.b !== 0)) ?? { r: 255, g: 255, b: 255 };
}

function emptyImage(width: number, height: number): RgbaImageData {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function fillRect(image: RgbaImageData, x: number, y: number, width: number, height: number, color: RgbColor): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = (py * image.width + px) * 4;
      image.pixels[offset] = color.r;
      image.pixels[offset + 1] = color.g;
      image.pixels[offset + 2] = color.b;
      image.pixels[offset + 3] = 255;
    }
  }
}
