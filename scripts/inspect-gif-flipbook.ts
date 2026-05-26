import { readFile } from "node:fs/promises";
import { buildPokemonFlipbookRigFromGif, defaultPokemonFlipbookImportConfig, type PokemonFlipbookPackingMode, type PokemonFlipbookSamplingStrategy } from "../src/pokeweb/pokemonFlipbookRig";
import type { PokemonAnimationSide } from "../src/pokeweb/pokemonSpriteModel";

type InspectArgs = {
  side: PokemonAnimationSide;
  strategy: PokemonFlipbookSamplingStrategy;
  packingMode: PokemonFlipbookPackingMode;
  sourceFramePercent: number;
  maxUniqueFrames: number;
  maxAtlasTiles: number;
  durationScale: number;
  downscalePercent: number;
  outputScalePercent: number;
  files: string[];
};

const args = parseArgs(process.argv.slice(2));
if (args.files.length === 0) {
  throw new Error("Usage: npx vite-node scripts/inspect-gif-flipbook.ts [--side front|back] [--strategy loop-rest|first-window|even|front-load] [--downscale-percent 90] [--output-scale-percent 200] file.gif [...]");
}

for (const file of args.files) {
  const result = buildPokemonFlipbookRigFromGif(new Uint8Array(await readFile(file)), {
    ...defaultPokemonFlipbookImportConfig(args.side),
    strategy: args.strategy,
    packingMode: args.packingMode,
    sourceFramePercent: args.sourceFramePercent,
    maxUniqueFrames: args.maxUniqueFrames,
    maxAtlasTiles: args.maxAtlasTiles,
    durationScale: args.durationScale,
    downscalePercent: args.downscalePercent,
    outputScalePercent: args.outputScalePercent,
  });
  console.log(JSON.stringify({
    file,
    side: args.side,
    packingMode: result.report.packingMode,
    maxOamsPerPose: result.report.maxOamsPerPose,
    sourceFrameCount: result.report.sourceFrameCount,
    selectedSourceFrames: result.report.selectedSourceFrames,
    timelineFrameCount: result.report.timelineFrames.length,
    uniquePoseCount: result.report.uniquePoseCount,
    uniqueTileCount: result.report.uniqueTileCount,
    atlasOccupancyPercent: result.report.atlasOccupancyPercent,
    durationScale: result.report.durationScale,
    downscalePercent: result.report.downscalePercent,
    outputScalePercent: result.report.outputScalePercent,
    groundValidation: result.report.groundValidation,
    visibilityValidation: result.report.visibilityValidation,
    warnings: result.report.warnings,
  }, null, 2));
}

function parseArgs(argv: string[]): InspectArgs {
  const args: InspectArgs = {
    side: "front",
    strategy: "loop-rest",
    packingMode: "mcss-safe",
    sourceFramePercent: 100,
    maxUniqueFrames: 96,
    maxAtlasTiles: 512,
    durationScale: 1,
    downscalePercent: 100,
    outputScalePercent: 100,
    files: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--side") {
      args.side = parseSide(argv[++index]);
    } else if (arg === "--strategy") {
      args.strategy = parseStrategy(argv[++index]);
    } else if (arg === "--packing-mode") {
      args.packingMode = parsePackingMode(argv[++index]);
    } else if (arg === "--source-percent") {
      args.sourceFramePercent = parseNumber(argv[++index], "--source-percent");
    } else if (arg === "--max-frames") {
      args.maxUniqueFrames = parseNumber(argv[++index], "--max-frames");
    } else if (arg === "--max-tiles") {
      args.maxAtlasTiles = parseNumber(argv[++index], "--max-tiles");
    } else if (arg === "--duration-scale") {
      args.durationScale = parseNumber(argv[++index], "--duration-scale");
    } else if (arg === "--downscale-percent") {
      args.downscalePercent = parseNumber(argv[++index], "--downscale-percent");
    } else if (arg === "--output-scale-percent") {
      args.outputScalePercent = parseNumber(argv[++index], "--output-scale-percent");
    } else {
      args.files.push(arg);
    }
  }
  return args;
}

function parseSide(value: string | undefined): PokemonAnimationSide {
  if (value === "front" || value === "back") return value;
  throw new Error(`Expected --side front|back, got ${value ?? "missing value"}`);
}

function parseStrategy(value: string | undefined): PokemonFlipbookSamplingStrategy {
  if (value === "loop-rest" || value === "first-window" || value === "even" || value === "front-load") return value;
  throw new Error(`Expected --strategy loop-rest|first-window|even|front-load, got ${value ?? "missing value"}`);
}

function parsePackingMode(value: string | undefined): PokemonFlipbookPackingMode {
  if (value === "mcss-safe" || value === "rotated-pose-blocks" || value === "macro-blocks" || value === "tile-node-dedup") return value;
  throw new Error(`Expected --packing-mode mcss-safe|rotated-pose-blocks|macro-blocks|tile-node-dedup, got ${value ?? "missing value"}`);
}

function parseNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric ${flag}, got ${value ?? "missing value"}`);
  return parsed;
}
