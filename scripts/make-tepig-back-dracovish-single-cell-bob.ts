import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { buildPokemonFlipbookRigFromGif, defaultPokemonFlipbookImportConfig } from "../src/pokeweb/pokemonFlipbookRig";
import {
  compressLz11Literal,
  copyPokemonSpriteVariant,
  importPokemonAnimationBundle,
  setPokemonPalette,
  setPokemonSpriteImage,
} from "../src/pokeweb/pokemonSpriteModel";
import {
  buildPokemonAnimationFile,
  buildPokemonMultiCellAnimationFile,
  packagePokemonAnimationBundle,
  parsePokemonAnimationBundle,
} from "../src/pokeweb/pokemonSpriteWriters";

const inputRom = process.argv[2] ?? "/path/to/Port-Pokeweb/testani.nds";
const gifPath = process.argv[3] ?? "/path/to/Docs/dracovish.gif";
const outputRom = process.argv[4] ?? "/path/to/Port-Pokeweb/testani-tepig-back-dracovish-single-cell-bob.nds";
const TEPIG = 498;

const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(inputRom))], path.basename(inputRom)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});

const result = buildPokemonFlipbookRigFromGif(new Uint8Array(await readFile(gifPath)), {
  ...defaultPokemonFlipbookImportConfig("back"),
  strategy: "first-window",
  packingMode: "mcss-safe",
  maxUniqueFrames: 1,
  maxAtlasTiles: 512,
  durationScale: 1,
  includeFinish: false,
});
const generatedBundle = parsePokemonAnimationBundle(result.bundle);

const bobDuration = 8;
const bobFrames = [
  { duration: bobDuration, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
  { duration: bobDuration, cellIndex: 0, x: 0, y: -3, rotation: 0, xScale: 1, yScale: 1 },
  { duration: bobDuration, cellIndex: 0, x: 0, y: -5, rotation: 0, xScale: 1, yScale: 1 },
  { duration: bobDuration, cellIndex: 0, x: 0, y: -3, rotation: 0, xScale: 1, yScale: 1 },
  { duration: bobDuration, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
  { duration: bobDuration, cellIndex: 0, x: 0, y: 2, rotation: 0, xScale: 1, yScale: 1 },
  { duration: bobDuration, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
];
const totalDuration = bobFrames.reduce((sum, frame) => sum + frame.duration, 0);
const bundle = packagePokemonAnimationBundle({
  side: "back",
  files: {
    13: generatedBundle.files[13],
    14: compressLz11Literal(buildPokemonAnimationFile({ targetType: 1, frames: [bobFrames] })),
    15: generatedBundle.files[15],
    16: buildPokemonMultiCellAnimationFile(totalDuration),
    17: generatedBundle.files[17],
  },
});

setPokemonPalette(project, TEPIG, "normal", result.palette);
setPokemonSpriteImage(project, TEPIG, { kind: "sprite", side: "back", gender: "male" }, "normal", result.sprite);
setPokemonSpriteImage(project, TEPIG, { kind: "rig", side: "back", gender: "male" }, "normal", result.rig);
importPokemonAnimationBundle(project, TEPIG, bundle);
copyPokemonSpriteVariant(project, TEPIG, { kind: "sprite", side: "back", gender: "male" }, { kind: "sprite", side: "back", gender: "female" });
copyPokemonSpriteVariant(project, TEPIG, { kind: "rig", side: "back", gender: "male" }, { kind: "rig", side: "back", gender: "female" });

await writeFile(outputRom, await exportModifiedRom(project));
console.log(JSON.stringify({
  outputRom,
  sourceGif: gifPath,
  speciesId: TEPIG,
  side: "back",
  probe: "single full-pose NCEC cell with bobbing SRT frames",
  report: result.report,
  bobFrames,
}, null, 2));
