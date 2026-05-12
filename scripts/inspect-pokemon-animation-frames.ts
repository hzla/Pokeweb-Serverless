import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { getPokemonAnimation, getPokemonCellBank, getPokemonMultiCellAnimation, getPokemonMultiCells, type PokemonAnimationSide } from "../src/pokeweb/pokemonSpriteModel";

const [romPath, speciesText, sideText = "back"] = process.argv.slice(2);
if (!romPath || !speciesText) throw new Error("Usage: npx vite-node scripts/inspect-pokemon-animation-frames.ts rom.nds speciesId [front|back]");

const side: PokemonAnimationSide = sideText === "front" ? "front" : "back";
const speciesId = Number(speciesText);
const project = await loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
  expandSprites: true,
  selectedNarcs: ["pokemon_sprites"],
});
const animation = getPokemonAnimation(project, speciesId, side);
const multiCells = getPokemonMultiCells(project, speciesId, side);
const multiAnimation = getPokemonMultiCellAnimation(project, speciesId, side);
const cellBank = getPokemonCellBank(project, speciesId, side);

console.log(`# ${path.basename(romPath)} species ${speciesId} ${side}`);
console.log(`sequences=${animation.sequences.length} multi=${multiCells.cells.map((cell) => cell.nodes.length).join(",")} cells=${cellBank.cells.length}`);
for (const sequence of animation.sequences) {
  console.log(`sequence ${sequence.index} mode=${sequence.mode} frames=${sequence.frames.length}`);
  console.log(sequence.frames.map((frame, index) => `${index}:${frame.cellIndex}/${frame.duration}`).join(" "));
}
for (const multiCell of multiCells.cells) {
  console.log(`multiCell ${multiCell.index}: ${multiCell.nodes.map((node, index) => `node${index}:seq${node.sequenceNumber}:anim${node.cellAnimationIndex}:play${node.playMode}`).join(" ")}`);
}
for (const sequence of multiAnimation.sequences) {
  console.log(`multiAnim ${sequence.index} mode=${sequence.mode} frames=${sequence.frames.length}`);
  console.log(sequence.frames.map((frame, index) => `${index}:group${frame.cellIndex}/${frame.duration}`).join(" "));
}
for (const cell of cellBank.cells) {
  const bounds = `${cell.minX},${cell.minY},${cell.maxX},${cell.maxY}`;
  console.log(`cell ${cell.index} bounds=${bounds} oams=${cell.oams.map((oam) => `${oam.width}x${oam.height}@${oam.x},${oam.y} tile=${oam.characterName}`).join(";")}`);
}
