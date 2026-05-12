import { readFile } from "node:fs/promises";
import path from "node:path";
import { readAscii, readU16, readU32 } from "../src/nds/binary";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import {
  decompressNitro,
  getPokemonAnimation,
  getPokemonCellBank,
  getPokemonMultiCellAnimation,
  getPokemonMultiCells,
  getRigCells,
  type PokemonAnimationSide,
} from "../src/pokeweb/pokemonSpriteModel";

const [vanillaRom, editedRom, spriteIdText] = process.argv.slice(2);
if (!vanillaRom || !editedRom || !spriteIdText) {
  throw new Error("Usage: npx vite-node scripts/compare-pokemon-sprite-entry.ts vanilla.nds edited.nds speciesId");
}
const spriteId = Number(spriteIdText);
const vanilla = await load(vanillaRom);
const edited = await load(editedRom);

console.log(`# Species ${spriteId} file comparison`);
for (let fileIndex = 0; fileIndex < 20; fileIndex += 1) {
  const left = vanilla.narcs.pokemon_sprites!.rawFiles[spriteId * 20 + fileIndex] ?? new Uint8Array();
  const right = edited.narcs.pokemon_sprites!.rawFiles[spriteId * 20 + fileIndex] ?? new Uint8Array();
  console.log(`\nfile ${fileIndex} ${labelFor(fileIndex)}`);
  console.log(`  vanilla ${fileSummary(left)}`);
  console.log(`  edited  ${fileSummary(right)}`);
  if (fileIndex === 8 || fileIndex === 17) {
    console.log(`  vanilla rigMeta ${rigMetaSummary(vanilla, fileIndex < 9 ? "front" : "back")}`);
    console.log(`  edited  rigMeta ${rigMetaSummary(edited, fileIndex < 9 ? "front" : "back")}`);
    console.log(`  vanilla first64 ${hex(left.slice(0, 64))}`);
    console.log(`  edited  first64 ${hex(right.slice(0, 64))}`);
  }
}

for (const side of ["front", "back"] as const) {
  console.log(`\n${side.toUpperCase()} parsed summary`);
  console.log(`  vanilla ${parsedSideSummary(vanilla, side)}`);
  console.log(`  edited  ${parsedSideSummary(edited, side)}`);
}

async function load(romPath: string) {
  return loadProjectFromRomFile(new File([new Uint8Array(await readFile(romPath))], path.basename(romPath)), {
    expandSprites: true,
    selectedNarcs: ["pokemon_sprites"],
  });
}

function fileSummary(bytes: Uint8Array): string {
  if (bytes.length === 0) return "empty";
  const decoded = decodeMaybe(bytes);
  return [
    `len=${bytes.length}`,
    `head=${hex(bytes.slice(0, 8))}`,
    `kind=${decoded.kind}`,
    `decodedLen=${decoded.bytes.length}`,
    `sig=${safeAscii(decoded.bytes, 0, 4)}`,
    g2dSummary(decoded.bytes),
  ].filter(Boolean).join(" ");
}

function decodeMaybe(bytes: Uint8Array): { kind: string; bytes: Uint8Array } {
  if (bytes[0] === 0x10 || bytes[0] === 0x11) return { kind: `lz${bytes[0]!.toString(16)}`, bytes: decompressNitro(bytes) };
  return { kind: "raw", bytes };
}

function g2dSummary(bytes: Uint8Array): string {
  const sig = safeAscii(bytes, 0, 4);
  if (!["RECN", "RNAN", "RCMN", "RAMN", "RGCN", "RLCN"].includes(sig)) return "";
  const headerSize = readU16(bytes, 0x0c);
  const sectionCount = readU16(bytes, 0x0e);
  const sections: string[] = [];
  let offset = headerSize;
  for (let index = 0; index < sectionCount && offset + 8 <= bytes.length; index += 1) {
    const block = safeAscii(bytes, offset, 4);
    const size = readU32(bytes, offset + 4);
    sections.push(`${block}:${size}`);
    offset += size;
  }
  return `sections=${sections.join(",")}`;
}

function parsedSideSummary(project: Awaited<ReturnType<typeof load>>, side: PokemonAnimationSide): string {
  try {
    const cells = getPokemonCellBank(project, spriteId, side);
    const anim = getPokemonAnimation(project, spriteId, side);
    const multicell = getPokemonMultiCells(project, spriteId, side);
    const multianim = getPokemonMultiCellAnimation(project, spriteId, side);
    const rig = getRigCells(project, spriteId, side);
    return [
      `cells=${cells.cells.length}/map${cells.mappingMode}/maxOam${Math.max(0, ...cells.cells.map((cell) => cell.oams.length))}`,
      `animSeq=${anim.sequences.length}/frames=${anim.sequences.map((seq) => seq.frames.length).join(",")}`,
      `multi=${multicell.cells.length}/nodes=${multicell.cells.map((cell) => cell.nodes.length).join(",")}`,
      `multiAnim=${multianim.sequences.length}/duration=${multianim.sequences.map((seq) => seq.frames.reduce((sum, frame) => sum + frame.duration, 0)).join(",")}`,
      `rigCells=${rig.cells.length}/flags=${rig.flags.length}`,
    ].join(" ");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function rigMetaSummary(project: Awaited<ReturnType<typeof load>>, side: PokemonAnimationSide): string {
  try {
    const rig = getRigCells(project, spriteId, side);
    const first = rig.cells[0];
    return `count=${rig.cells.length} flags=${rig.flags.length} first=${first ? `${first.cellX},${first.cellY},${first.width},${first.height} sprite=${first.spriteX},${first.spriteY}` : "none"}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function labelFor(index: number): string {
  const labels = ["front sprite M", "front sprite F", "front rig M", "front rig F", "front NCER", "front NANR", "front NMCR", "front NMAR", "front NCEC", "back sprite M", "back sprite F", "back rig M", "back rig F", "back NCER", "back NANR", "back NMCR", "back NMAR", "back NCEC", "normal pal", "shiny pal"];
  return labels[index] ?? "";
}

function safeAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  return readAscii(bytes, offset, length);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
