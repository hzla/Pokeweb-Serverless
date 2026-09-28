import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { compressLz11Literal, decompressNitro, parsePokemonAnimation, parsePokemonMultiCells, parseRigCells } from "../src/pokeweb/pokemonSpriteModel";
import { buildPokemonAnimationFile, buildPokemonMultiCellsFileFromParsed, buildRigCellsFile } from "../src/pokeweb/pokemonSpriteWriters";
import { decodeTrainerSpriteAnimation, decodeTrainerSpritePalette, decodeTrainerSpriteRigAtlas, encodeTrainerSpriteRigAtlas } from "../src/pokeweb/trainerSpriteModel";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const previewOnly = args.includes("--preview-only");
const [inputArg, outputArg] = args.filter((arg) => !arg.startsWith("--"));
const inputPath = path.resolve(inputArg ?? path.join(workspace, "cleanwhite2.nds"));
const outputPath = path.resolve(outputArg ?? path.join(workspace, "cleanwhite2-pointing-trainer-v3.nds"));
const assetDir = path.join(workspace, "bw2-pointing-arm-assets");
const previewDir = path.join(assetDir, "test-preview-v3");
const startHoldTicks = 20;
const totalTicks = 100;

const rom = new NintendoDSRom(await readFile(inputPath), { fileData: "view" });
if (!rom.idCode.startsWith("IRD")) throw new Error(`Expected a White 2 ROM, got ${rom.idCode}`);
const archiveFileId = rom.fileId("a/0/7/2");
const archive = new NARC(rom.files[archiveFileId]);
if (archive.files.length < 16) throw new Error("Trainer back-sprite archive is missing the playable graphics");
await mkdir(previewDir, { recursive: true });

const unpack = (data: Uint8Array): Uint8Array => data[0] === 0x10 || data[0] === 0x11 ? decompressNitro(data) : data;
const repack = (source: Uint8Array, raw: Uint8Array): Uint8Array => {
  if (source[0] === 0x11) return compressLz11Literal(raw);
  if (source[0] === 0x10) throw new Error("Unexpected LZ10 compressed trainer rig metadata");
  return raw;
};

for (const config of [
  { appearance: 0, name: "nate", pointCell: 5, pointSequence: 5, atlasX: 112, atlasY: 16, spriteX: 5, spriteY: 46 },
  { appearance: 1, name: "rosa", pointCell: 6, pointSequence: 6, atlasX: 120, atlasY: 32, spriteX: 5, spriteY: 46 },
] as const) {
  const start = config.appearance * 8;
  const original = archive.files.slice(start, start + 8);
  const files = original.map((file) => file.slice());
  const originalIdle = decodeTrainerSpriteAnimation(original, 0).frames[0];
  const originalThrow = decodeTrainerSpriteAnimation(original, 1);
  if (originalThrow.totalTicks !== totalTicks || originalThrow.frames[0].index !== 0) {
    throw new Error(`${config.name}: unexpected source trainer timeline`);
  }

  const sourceArm = PNG.sync.read(await readFile(path.join(
    assetDir,
    config.name === "nate" ? "nate-pointing-arm-cleaned-source-64x64.png" : "rosa-pointing-arm-64x48.png",
  )));
  if (config.name === "nate" && (sourceArm.width !== 64 || sourceArm.height !== 64)) {
    throw new Error("Nate's cleaned arm source must be 64x64");
  }
  if (config.name === "rosa" && (sourceArm.width !== 64 || sourceArm.height !== 48)) {
    throw new Error("Rosa's pointing arm source must be 64x48");
  }
  // Nate's cleaned art already has the desired pixel scale. Its 64x64 canvas
  // just pads the same 48x36 placement used by the previous asset.
  const arm = config.name === "nate" ? cropArm(sourceArm, 8, 14, 48, 36) : downscaleNearest(sourceArm, 48, 36);
  await writeFile(path.join(assetDir, `${config.name}-pointing-arm-48x36.png`), PNG.sync.write(arm));
  const atlas = decodeTrainerSpriteRigAtlas(files);
  const colors = new Set(decodeTrainerSpritePalette(files).slice(1).map(([r, g, b]) => `${r},${g},${b}`));
  const rig = parseRigCells(unpack(files[6]));
  const oldCell = rig.cells[config.pointCell];
  if (!oldCell || oldCell.cellX !== config.atlasX || oldCell.cellY !== config.atlasY) {
    throw new Error(`${config.name}: follow-through atlas slot changed`);
  }
  // This whole-body follow-through region is unused by the new two-pose timeline.
  for (let y = oldCell.cellY; y < oldCell.cellY + oldCell.height; y += 1) {
    for (let x = oldCell.cellX; x < oldCell.cellX + oldCell.width; x += 1) {
      atlas.pixels.fill(0, (y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4);
    }
  }
  for (let y = 0; y < arm.height; y += 1) {
    for (let x = 0; x < arm.width; x += 1) {
      const sourceOffset = (y * arm.width + x) * 4;
      if (arm.data[sourceOffset + 3] !== 0 && arm.data[sourceOffset + 3] !== 255) throw new Error(`${config.name}: arm alpha is not binary`);
      if (arm.data[sourceOffset + 3] === 0) continue;
      const color = `${arm.data[sourceOffset]},${arm.data[sourceOffset + 1]},${arm.data[sourceOffset + 2]}`;
      if (!colors.has(color)) throw new Error(`${config.name}: arm color ${color} is outside the ROM palette`);
      atlas.pixels.set(arm.data.subarray(sourceOffset, sourceOffset + 4), ((config.atlasY + y) * atlas.width + config.atlasX + x) * 4);
    }
  }
  files[1] = encodeTrainerSpriteRigAtlas(files, atlas);

  rig.cells[config.pointCell] = {
    ...oldCell,
    cellX: config.atlasX,
    cellY: config.atlasY,
    width: arm.width,
    height: arm.height,
    spriteX: config.spriteX,
    // Keep the bottom-left shoulder end fixed when the source shrinks.
    spriteY: config.spriteY - (48 - arm.height),
    subCell: { ...oldCell.subCell, width: 0, height: 0 },
  };
  files[6] = repack(files[6], buildRigCellsFile(rig));

  const multiCells = parsePokemonMultiCells(unpack(files[4]));
  const idle = multiCells.cells[0];
  const restingArmNode = idle?.nodes.find((node) => node.sequenceNumber !== 0);
  const bodyNode = idle?.nodes.find((node) => node.sequenceNumber === 0);
  if (!idle || idle.nodes.length !== 2 || !restingArmNode || !bodyNode || !multiCells.cells[4]) {
    throw new Error(`${config.name}: unexpected idle multi-cell layout`);
  }
  // Keep the complete native resting rig and layer the pointing arm over it.
  // Node 0 draws last, so the new arm can meet the shoulder without erasing
  // the original lowered arm on the opposite side.
  multiCells.cells[4] = {
    ...multiCells.cells[4],
    cellAnimationCount: 3,
    nodes: [
      { ...restingArmNode, sequenceNumber: config.pointSequence, cellAnimationIndex: 2 },
      ...idle.nodes.map((node) => ({ ...node })),
    ],
  };
  files[4] = repack(files[4], buildPokemonMultiCellsFileFromParsed(multiCells.cells));

  const outer = parsePokemonAnimation(unpack(files[5]), "front", "RAMN", "Multi-cell animation");
  const throwSequence = outer.sequences[1];
  if (!throwSequence || outer.sequences.length !== 2) throw new Error(`${config.name}: unexpected outer animation layout`);
  const template = throwSequence.frames[0];
  outer.sequences[1] = {
    ...throwSequence,
    frameCount: 2,
    frames: [
      { ...template, cellIndex: 0, duration: startHoldTicks, x: 0, y: 0 },
      { ...template, cellIndex: 4, duration: totalTicks - startHoldTicks, x: 0, y: 0 },
    ],
  };
  files[5] = repack(files[5], buildPokemonAnimationFile(outer.sequences));

  const preview = decodeTrainerSpriteAnimation(files, 1);
  if (preview.totalTicks !== totalTicks) throw new Error(`${config.name}: patched timeline is not ${totalTicks} ticks`);
  if (!sameFrame(preview.frames[0], originalIdle)) throw new Error(`${config.name}: initial pose differs from native idle`);
  if (!sameFrame(preview.frames[0], preview.frames[startHoldTicks - 1])) throw new Error(`${config.name}: resting pose moves before pointing`);
  if (sameFrame(preview.frames[0], preview.frames[startHoldTicks])) throw new Error(`${config.name}: pointing pose did not appear at tick ${startHoldTicks}`);
  if (!sameFrame(preview.frames[startHoldTicks], preview.frames[totalTicks - 1])) throw new Error(`${config.name}: pointing pose changes after tick ${startHoldTicks}`);
  if (!preservesOpaquePixels(originalIdle, preview.frames[startHoldTicks])) {
    throw new Error(`${config.name}: pointing pose hides part of the resting rig`);
  }

  await saveFrame(path.join(previewDir, `${config.name}-rest-t0.png`), preview.frames[0]);
  await saveFrame(path.join(previewDir, `${config.name}-point-t20.png`), preview.frames[startHoldTicks]);
  files.forEach((file, index) => { archive.files[start + index] = file; });
  console.log(`${config.name}: rest ticks 0-${startHoldTicks - 1}, point ticks ${startHoldTicks}-${totalTicks - 1}; point frame ${preview.frames[startHoldTicks].width}x${preview.frames[startHoldTicks].height}`);
}

if (!previewOnly) {
  const output = rom.save({ files: new Map([[archiveFileId, archive.save()]]), preserveOriginalLength: true });
  await writeFile(outputPath, output, { flag: "wx" });
  console.log(`Wrote ${outputPath}`);
} else {
  console.log(`Preview only: ${previewDir}`);
}

type RenderedFrame = { x: number; y: number; width: number; height: number; rgba: Uint8ClampedArray };
function cropArm(source: PNG, left: number, top: number, width: number, height: number): PNG {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((top + y) * source.width + left + x) * 4;
      output.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return output;
}
function downscaleNearest(source: PNG, width: number, height: number): PNG {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / width));
      const sourceY = Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / height));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      output.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return output;
}
function sameFrame(a: RenderedFrame, b: RenderedFrame): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
    && Buffer.from(a.rgba).equals(Buffer.from(b.rgba));
}
function preservesOpaquePixels(rest: RenderedFrame, point: RenderedFrame): boolean {
  for (let y = 0; y < rest.height; y += 1) {
    for (let x = 0; x < rest.width; x += 1) {
      if (rest.rgba[(y * rest.width + x) * 4 + 3] === 0) continue;
      const pointX = rest.x + x - point.x;
      const pointY = rest.y + y - point.y;
      if (pointX < 0 || pointY < 0 || pointX >= point.width || pointY >= point.height) return false;
      if (point.rgba[(pointY * point.width + pointX) * 4 + 3] === 0) return false;
    }
  }
  return true;
}
async function saveFrame(file: string, frame: RenderedFrame): Promise<void> {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data = Buffer.from(frame.rgba);
  await writeFile(file, PNG.sync.write(png));
}
