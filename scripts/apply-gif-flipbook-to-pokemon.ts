import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { buildPokemonFlipbookRigFromGif, defaultPokemonFlipbookImportConfig, type PokemonFlipbookPackingMode, type PokemonFlipbookSamplingStrategy } from "../src/pokeweb/pokemonFlipbookRig";
import {
  importPokemonAnimationBundle,
  setPokemonPalette,
  setPokemonSpriteImage,
  type PokemonAnimationSide,
  type PokemonPaletteKind,
} from "../src/pokeweb/pokemonSpriteModel";

const args = parseArgs(process.argv.slice(2));
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(args.inputRom))], path.basename(args.inputRom)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const result = buildPokemonFlipbookRigFromGif(new Uint8Array(await readFile(args.gif)), {
  ...defaultPokemonFlipbookImportConfig(args.side),
  strategy: args.strategy,
  packingMode: args.packingMode,
  sourceFramePercent: args.sourcePercent,
  maxUniqueFrames: args.maxFrames,
  maxAtlasTiles: args.maxTiles,
  durationScale: args.durationScale,
});
setPokemonPalette(project, args.speciesId, args.palette, result.palette);
setPokemonSpriteImage(project, args.speciesId, { kind: "sprite", side: args.side, gender: "male" }, args.palette, result.sprite);
setPokemonSpriteImage(project, args.speciesId, { kind: "rig", side: args.side, gender: "male" }, args.palette, result.rig);
importPokemonAnimationBundle(project, args.speciesId, result.bundle);
if (args.duplicateFemale) {
  copySpriteFile(args.speciesId, args.side === "front" ? 0 : 9, args.side === "front" ? 1 : 10);
  copySpriteFile(args.speciesId, args.side === "front" ? 2 : 11, args.side === "front" ? 3 : 12);
}
await writeFile(args.outputRom, await exportModifiedRom(project));
console.log(JSON.stringify({ outputRom: args.outputRom, report: result.report }, null, 2));

function copySpriteFile(spriteId: number, sourceFileIndex: number, targetFileIndex: number): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon sprite NARC is not loaded");
  const source = store.rawFiles[spriteId * 20 + sourceFileIndex];
  if (!source || source.length === 0) throw new Error(`Species ${spriteId} source file ${sourceFileIndex} is empty`);
  const target = spriteId * 20 + targetFileIndex;
  store.rawFiles[target] = source.slice();
  store.dirty.add(target);
}

function parseArgs(argv: string[]): {
  inputRom: string;
  outputRom: string;
  gif: string;
  speciesId: number;
  side: PokemonAnimationSide;
  palette: PokemonPaletteKind;
  strategy: PokemonFlipbookSamplingStrategy;
  packingMode: PokemonFlipbookPackingMode;
  sourcePercent: number;
  maxFrames: number;
  maxTiles: number;
  durationScale: number;
  duplicateFemale: boolean;
} {
  const get = (flag: string, fallback?: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const inputRom = get("--input-rom");
  const outputRom = get("--output-rom");
  const gif = get("--gif");
  const speciesId = Number(get("--species-id"));
  if (!inputRom || !outputRom || !gif || !Number.isInteger(speciesId)) throw new Error("Required: --input-rom rom.nds --output-rom out.nds --gif file.gif --species-id n");
  const side = get("--side", "front") === "back" ? "back" : "front";
  const palette = get("--palette", "normal") === "shiny" ? "shiny" : "normal";
  const strategyValue = get("--strategy", "loop-rest");
  const strategy = strategyValue === "first-window" || strategyValue === "even" ? strategyValue : "loop-rest";
  const packingMode = parsePackingMode(get("--packing-mode", "mcss-safe"));
  return {
    inputRom,
    outputRom,
    gif,
    speciesId,
    side,
    palette,
    strategy,
    packingMode,
    sourcePercent: Number(get("--source-percent", "100")),
    maxFrames: Number(get("--max-frames", "96")),
    maxTiles: Number(get("--max-tiles", "512")),
    durationScale: Number(get("--duration-scale", "1")),
    duplicateFemale: argv.includes("--duplicate-female"),
  };
}

function parsePackingMode(value: string | undefined): PokemonFlipbookPackingMode {
  return value === "macro-blocks" || value === "rotated-pose-blocks" || value === "tile-node-dedup" ? value : "mcss-safe";
}
