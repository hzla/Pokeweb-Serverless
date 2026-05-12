import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { decodePng, encodePng, roundTripBgr555Color } from "../src/pokeweb/pokemonAnimationAnalysis";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import {
  compressLz11Literal,
  getPokemonSpriteImage,
  importPokemonAnimationBundle,
  setPokemonPalette,
  setPokemonSpriteImage,
  type RigCell,
  type RgbaImageData,
  type RgbColor,
} from "../src/pokeweb/pokemonSpriteModel";
import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS } from "../src/pokeweb/constants";
import { commitTextBank, getTextBank, parseTextEntryId } from "../src/pokeweb/textModel";
import {
  buildPokemonAnimationFile,
  buildPokemonCellBankFileFromCells,
  buildPokemonMultiCellAnimationFile,
  buildPokemonMultiCellsFile,
  buildRigCellsFile,
  packagePokemonAnimationBundle,
  type PokemonAnimationBuildPart,
  type PokemonAnimationBundleFileIndex,
} from "../src/pokeweb/pokemonSpriteWriters";

type Side = "front" | "back";
type Rect = { x: number; y: number; width: number; height: number };
type FrameEntry = { index: number; delayMs: number; file: string; image: RgbaImageData };
type TimelineFrame = FrameEntry & { timelineIndex: number; phase: "rest-loop" | "finish" };
type TimelinePlan = {
  sourceFrameCount: number;
  totalSourceDuration: number;
  loopSearchWindow: { startFrame: number; endFrame: number };
  loopEndFrame: number;
  loopEndScore: number;
  restLoopCount: number;
  restLoopDuration: number;
  finishStartFrame: number;
  generatedFrameCount: number;
  generatedDuration: number;
};
type PackedPose = {
  poseIndex: number;
  sourceFrame: number;
  sourceBounds: Rect;
  paddedBounds: Rect;
  oams: Array<{ x: number; y: number; width: number; height: number; characterName: number }>;
  tileCount: number;
};
type PackedTimelineFrame = TimelineFrame & { poseIndex: number; visibleTileCount: number };
type GroundValidation = { maxAllowedBottomY: number; maxVisibleBottomY: number; appliedShiftY: number };

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const WORK_ROOT = path.join(REPO_ROOT, "gen6-sprite-work");
const OUT_ROOT = path.join(WORK_ROOT, "generated-rigs", "froakie-flipbook-loop-rest");
const INPUT_ROM = path.join(REPO_ROOT, "w2backportcanvas-gen6-static.nds");
const OUTPUT_ROM = path.join(REPO_ROOT, "w2backportcanvas-gen6-froakie-flipbook-loop-rest-001.nds");
const TRANSPARENT = [0, 0, 0, 0] as const;
const VARIANTS = [
  { label: "loop-rest", spriteId: 4, displayName: "Froakie" },
];
const RIG_WIDTH = 256;
const RIG_HEIGHT = 128;
const TILE_SIZE = 8;
const ATLAS_TILE_COLUMNS = RIG_WIDTH / TILE_SIZE;
const ATLAS_TILE_ROWS = RIG_HEIGHT / TILE_SIZE;
const MAX_ATLAS_TILES = ATLAS_TILE_COLUMNS * ATLAS_TILE_ROWS;
const MAX_GROUND_BOTTOM_Y = 3;

async function main(): Promise<void> {
  await mkdir(OUT_ROOT, { recursive: true });
  const report = {
    format: "pokeweb-froakie-flipbook-rig-test-v1",
    createdAt: new Date().toISOString(),
    inputRom: INPUT_ROM,
    outputRom: OUTPUT_ROM,
    outputDir: OUT_ROOT,
    variants: [] as Array<{
      label: string;
      spriteId: number;
      displayName: string;
      sides: Array<{
        side: Side;
        timelineFrames: number[];
        uniquePoseCount: number;
        uniqueTileCount: number;
        atlasOccupancyPercent: number;
        loopPlan: TimelinePlan;
        groundValidation: GroundValidation;
        visibilityValidation: { frameCount: number; invisibleFrameCount: number };
        files: string[];
        warnings: string[];
      }>;
    }>,
    verification: {} as Record<string, unknown>,
  };

  const generated = new Map<string, { rig: RgbaImageData; bundle: Uint8Array }>();
  for (const variant of VARIANTS) {
    const variantReport = { label: variant.label, spriteId: variant.spriteId, displayName: variant.displayName, sides: [] as Array<(typeof report.variants)[number]["sides"][number]> };
    for (const side of ["front", "back"] as const) {
      const sideDir = path.join(OUT_ROOT, variant.label, side);
      await mkdir(sideDir, { recursive: true });
      const result = await generateFlipbookSide(side, sideDir);
      variantReport.sides.push(result.report);
      generated.set(`${variant.label}:${side}`, { rig: result.rig, bundle: result.bundle });
    }
    report.variants.push(variantReport);
  }

  const project = await loadRom(INPUT_ROM);
  for (const variant of VARIANTS) {
    await copyFroakieStaticAssets(project, variant.spriteId);
    updatePokedexName(project, variant.spriteId, variant.displayName);
    for (const side of ["front", "back"] as const) {
      const result = generated.get(`${variant.label}:${side}`);
      if (!result) throw new Error(`Missing generated ${variant.label} ${side} flipbook`);
      setPokemonSpriteImage(project, variant.spriteId, { kind: "rig", side, gender: "male" }, "normal", result.rig);
      importPokemonAnimationBundle(project, variant.spriteId, result.bundle);
    }
  }
  await writeFile(OUTPUT_ROM, await exportModifiedRom(project));

  const verifyProject = await loadRom(OUTPUT_ROM);
  report.verification = {
    romLoaded: true,
    insertedRigImages: {
      "4-front": imageSize(getPokemonSpriteImage(verifyProject, 4, { kind: "rig", side: "front", gender: "male" }, "normal")),
      "4-back": imageSize(getPokemonSpriteImage(verifyProject, 4, { kind: "rig", side: "back", gender: "male" }, "normal")),
    },
    pokedexNames: readPokedexNames(verifyProject, [1, 2, 3, 4]),
  };
  await writeJson(path.join(OUT_ROOT, "report.json"), report);
  console.log(`Wrote Froakie flipbook rig assets to ${OUT_ROOT}`);
  console.log(`Wrote ROM to ${OUTPUT_ROM}`);
}

async function generateFlipbookSide(side: Side, outDir: string): Promise<{
  rig: RgbaImageData;
  bundle: Uint8Array;
  report: {
    side: Side;
    timelineFrames: number[];
    uniquePoseCount: number;
    uniqueTileCount: number;
    atlasOccupancyPercent: number;
    loopPlan: TimelinePlan;
    groundValidation: GroundValidation;
    visibilityValidation: { frameCount: number; invisibleFrameCount: number };
    files: string[];
    warnings: string[];
  };
}> {
  const normalDir = path.join(WORK_ROOT, "normalized", "froakie", side);
  const manifest = await readJson<{ frames: Array<{ index: number; delayMs: number; file: string }> }>(path.join(normalDir, "manifest.json"));
  const palette = await readPalette(path.join(WORK_ROOT, "static", "froakie", "palette_normal.png"));
  const frames: FrameEntry[] = await Promise.all(
    manifest.frames.map(async (entry) => ({
      ...entry,
      image: await readRgbaPng(path.join(normalDir, entry.file)),
    })),
  );
  const { timeline, plan } = buildLoopRestTimeline(frames);
  const groundShiftY = groundClampShiftY(timeline);
  const packedResult = packTimelineAsTileDictionary(timeline, palette, groundShiftY);
  const { rig, poses, timelineFrames, uniqueTileCount } = packedResult;
  const loopDuration = timelineFrames.reduce((sum, frame) => sum + gifDelayToAnimDuration(frame.delayMs), 0);
  const displayPart = visibleDisplayPart(timelineFrames);
  const cellAnimation = buildPokemonAnimationFile({
    targetType: 1,
    frames: [
      timelineFrames.map((frame) => ({
        duration: gifDelayToAnimDuration(frame.delayMs),
        cellIndex: frame.poseIndex,
        x: 0,
        y: 0,
        rotation: 0,
        xScale: 1,
        yScale: 1,
      })),
    ],
  });
  const sideOffset = side === "front" ? 0 : 9;
  const bundle = {
    side,
    files: {
      [(4 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonCellBankFileFromCells(poses.map((pose) => ({ oams: pose.oams }))),
      [(5 + sideOffset) as PokemonAnimationBundleFileIndex]: cellAnimation,
      [(6 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellsFile([displayPart]),
      [(7 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellAnimationFile(loopDuration),
      [(8 + sideOffset) as PokemonAnimationBundleFileIndex]: buildRigCellsFile({ cells: [rigCellFromDisplayPart(displayPart)], flags: new Uint8Array(4) }),
    },
  };
  const compressed = {
    side,
    files: Object.fromEntries(
      Object.entries(bundle.files).map(([index, file]) => {
        const fileIndex = Number(index) as PokemonAnimationBundleFileIndex;
        return [fileIndex, shouldCompress(fileIndex) ? compressLz11Literal(file) : file];
      }),
    ) as typeof bundle.files,
  };

  const rigName = `${side}_flipbook_rig_256x128_ds.png`;
  const previewName = `${side}_flipbook_preview.png`;
  const timelinePreviewName = `${side}_flipbook_timeline_preview.png`;
  const manifestName = `${side}_flipbook_manifest.json`;
  const packageName = `${side}_flipbook_animation.pkanimbundle`;
  await writeFile(path.join(outDir, rigName), encodePng(rig));
  await writeFile(path.join(outDir, previewName), encodePng(renderFlipbookPreview(rig, poses)));
  await writeFile(path.join(outDir, timelinePreviewName), encodePng(renderTimelinePreview(rig, poses, timelineFrames)));
  await writeFile(path.join(outDir, packageName), packagePokemonAnimationBundle(compressed));
  await writeJson(path.join(outDir, manifestName), {
    format: "pokeweb-froakie-flipbook-loop-rest-side-v1",
    side,
    source: path.relative(outDir, normalDir),
    timelineFrames: timelineFrames.map((frame) => frame.index),
    loopPlan: plan,
    loopDuration,
    uniqueTileCount,
    poses,
    groundValidation: validateGroundLimit(timelineFrames, groundShiftY),
    cellAnimationFrames: timelineFrames.map((frame) => ({
      timelineIndex: frame.timelineIndex,
      sourceFrame: frame.index,
      poseIndex: frame.poseIndex,
      delayMs: frame.delayMs,
      phase: frame.phase,
    })),
  });
  const visibilityValidation = validateVisibleTimeline(timelineFrames);
  const groundValidation = validateGroundLimit(timelineFrames, groundShiftY);
  if (visibilityValidation.invisibleFrameCount > 0) throw new Error(`${side} flipbook generated ${visibilityValidation.invisibleFrameCount} invisible frame(s)`);
  if (groundValidation.maxVisibleBottomY > groundValidation.maxAllowedBottomY) {
    throw new Error(`${side} flipbook ground clamp failed: visible bottom y ${groundValidation.maxVisibleBottomY} exceeds ${groundValidation.maxAllowedBottomY}`);
  }
  const warnings: string[] = [];
  if (plan.restLoopCount < 2 || plan.restLoopCount > 3) warnings.push(`Rest loop count ${plan.restLoopCount} is outside the preferred 2-3 range`);
  if (plan.generatedDuration > plan.totalSourceDuration * 1.5) warnings.push("Generated loop-rest timeline is more than 1.5x the source GIF duration");
  return {
    rig,
    bundle: packagePokemonAnimationBundle(compressed),
    report: {
      side,
      timelineFrames: timelineFrames.map((frame) => frame.index),
      uniquePoseCount: poses.length,
      uniqueTileCount,
      atlasOccupancyPercent: Math.round((uniqueTileCount / MAX_ATLAS_TILES) * 1000) / 10,
      loopPlan: plan,
      groundValidation,
      visibilityValidation,
      files: [path.join(side, rigName), path.join(side, previewName), path.join(side, timelinePreviewName), path.join(side, manifestName), path.join(side, packageName)],
      warnings,
    },
  };
}

async function copyFroakieStaticAssets(project: Awaited<ReturnType<typeof loadProjectFromRomFile>>, spriteId: number): Promise<void> {
  const staticDir = path.join(WORK_ROOT, "static", "froakie");
  setPokemonPalette(project, spriteId, "normal", await readPalette(path.join(staticDir, "palette_normal.png")));
  setPokemonPalette(project, spriteId, "shiny", await readPalette(path.join(staticDir, "palette_shiny.png")));
  setPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "front", gender: "male" }, "normal", await readRgbaPng(path.join(staticDir, "front.png")));
  setPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "back", gender: "male" }, "normal", await readRgbaPng(path.join(staticDir, "back.png")));
}

function buildLoopRestTimeline(frames: FrameEntry[]): { timeline: TimelineFrame[]; plan: TimelinePlan } {
  if (frames.length === 0) throw new Error("Cannot build a flipbook timeline without frames");
  const totalSourceDuration = frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  const startIndex = Math.max(1, Math.floor(frames.length * 0.25));
  const preferredEnd = Math.max(startIndex, Math.floor(frames.length * 0.6));
  const endIndex = Math.min(frames.length - 1, Math.max(preferredEnd, Math.floor(frames.length * 0.75)));
  let bestIndex = startIndex;
  let bestScore = Infinity;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const score = frameDifference(frames[0]!.image, frames[index]!.image);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const restSegment = frames.slice(0, bestIndex + 1);
  const restLoopDuration = restSegment.reduce((sum, frame) => sum + frame.delayMs, 0);
  const desiredRestDuration = totalSourceDuration * 0.75;
  const restLoopCount = restLoopDuration > 0 ? clampIntLocal(Math.round(desiredRestDuration / restLoopDuration), 2, 3) : 2;
  const finishFrames = frames.slice(bestIndex + 1);
  const timeline: TimelineFrame[] = [];
  for (let loop = 0; loop < restLoopCount; loop += 1) {
    for (const frame of restSegment) timeline.push({ ...frame, timelineIndex: timeline.length, phase: "rest-loop" });
  }
  for (const frame of finishFrames) timeline.push({ ...frame, timelineIndex: timeline.length, phase: "finish" });

  return {
    timeline,
    plan: {
      sourceFrameCount: frames.length,
      totalSourceDuration,
      loopSearchWindow: { startFrame: frames[startIndex]!.index, endFrame: frames[endIndex]!.index },
      loopEndFrame: frames[bestIndex]!.index,
      loopEndScore: Math.round(bestScore),
      restLoopCount,
      restLoopDuration,
      finishStartFrame: finishFrames[0]?.index ?? -1,
      generatedFrameCount: timeline.length,
      generatedDuration: timeline.reduce((sum, frame) => sum + frame.delayMs, 0),
    },
  };
}

function packTimelineAsTileDictionary(timeline: TimelineFrame[], palette: RgbColor[], groundShiftY: number): {
  rig: RgbaImageData;
  poses: PackedPose[];
  timelineFrames: PackedTimelineFrame[];
  uniqueTileCount: number;
} {
  const rig = emptyImage(RIG_WIDTH, RIG_HEIGHT);
  const tileIndexes = new Map<string, number>();
  const poseIndexes = new Map<string, PackedPose>();
  const poses: PackedPose[] = [];
  const timelineFrames: PackedTimelineFrame[] = [];

  for (const frame of timeline) {
    const poseKey = imageHash(frame.image);
    let pose = poseIndexes.get(poseKey);
    if (!pose) {
      const sourceBounds = alphaBounds(frame.image);
      if (!sourceBounds) throw new Error(`Source frame ${frame.index} has no visible pixels`);
      const paddedBounds = hardRoundedBounds(sourceBounds, frame.image.width, frame.image.height);
      const oams: PackedPose["oams"] = [];
      for (let y = 0; y < paddedBounds.height; y += TILE_SIZE) {
        for (let x = 0; x < paddedBounds.width; x += TILE_SIZE) {
          const tile = extractPaletteTile(frame.image, paddedBounds.x + x, paddedBounds.y + y, palette);
          if (!tile.visible) continue;
          let tileIndex = tileIndexes.get(tile.hash);
          if (tileIndex === undefined) {
            tileIndex = tileIndexes.size;
            if (tileIndex >= MAX_ATLAS_TILES) {
              throw new Error(`Tile-deduplicated flipbook exceeded ${MAX_ATLAS_TILES} rig atlas tiles at source frame ${frame.index}`);
            }
            tileIndexes.set(tile.hash, tileIndex);
            blitTile(rig, tile.pixels, tileIndex);
          }
          oams.push({
            x: paddedBounds.x - 48 + x,
            y: paddedBounds.y - 48 + y + groundShiftY,
            width: TILE_SIZE,
            height: TILE_SIZE,
            characterName: tileIndex,
          });
        }
      }
      if (oams.length === 0) throw new Error(`Source frame ${frame.index} packed as an invisible pose`);
      pose = {
        poseIndex: poses.length,
        sourceFrame: frame.index,
        sourceBounds,
        paddedBounds,
        oams,
        tileCount: oams.length,
      };
      poses.push(pose);
      poseIndexes.set(poseKey, pose);
    }
    timelineFrames.push({ ...frame, poseIndex: pose.poseIndex, visibleTileCount: pose.tileCount });
  }

  return { rig, poses, timelineFrames, uniqueTileCount: tileIndexes.size };
}

function visibleDisplayPart(timelineFrames: PackedTimelineFrame[]): PokemonAnimationBuildPart {
  return {
    name: `visible-flipbook-node-${timelineFrames.length}-frames`,
    cellX: 0,
    cellY: 0,
    width: TILE_SIZE,
    height: TILE_SIZE,
    spriteX: 0,
    spriteY: 0,
    pivot: { x: 0, y: 0 },
    z: 0,
  };
}

function rigCellFromDisplayPart(part: PokemonAnimationBuildPart): RigCell {
  return {
    cellX: part.cellX,
    cellY: part.cellY,
    width: part.width,
    height: part.height,
    spriteX: part.spriteX,
    spriteY: part.spriteY,
    subCell: { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell },
  };
}

function renderFlipbookPreview(rig: RgbaImageData, poses: PackedPose[]): RgbaImageData {
  const scale = 2;
  const columns = Math.min(6, poses.length);
  const rows = Math.ceil(poses.length / columns);
  const out: RgbaImageData = { width: columns * 96 * scale, height: rows * 96 * scale, pixels: new Uint8ClampedArray(columns * 96 * scale * rows * 96 * scale * 4) };
  for (let offset = 0; offset < out.pixels.length; offset += 4) out.pixels.set([28, 31, 45, 255], offset);
  poses.forEach((pose, index) => {
    const baseX = (index % columns) * 96 * scale;
    const baseY = Math.floor(index / columns) * 96 * scale;
    drawPose(out, rig, pose, baseX, baseY, scale);
  });
  return out;
}

function renderTimelinePreview(rig: RgbaImageData, poses: PackedPose[], timelineFrames: PackedTimelineFrame[]): RgbaImageData {
  const scale = 2;
  const shown = timelineFrames.slice(0, Math.min(32, timelineFrames.length));
  const columns = Math.min(8, shown.length);
  const rows = Math.ceil(shown.length / columns);
  const out = emptyImage(columns * 96 * scale, rows * 96 * scale);
  for (let offset = 0; offset < out.pixels.length; offset += 4) out.pixels.set([28, 31, 45, 255], offset);
  shown.forEach((frame, index) => {
    const pose = poses[frame.poseIndex];
    if (!pose) return;
    const baseX = (index % columns) * 96 * scale;
    const baseY = Math.floor(index / columns) * 96 * scale;
    drawPose(out, rig, pose, baseX, baseY, scale);
  });
  return out;
}

function validateVisibleTimeline(timelineFrames: PackedTimelineFrame[]): { frameCount: number; invisibleFrameCount: number } {
  return {
    frameCount: timelineFrames.length,
    invisibleFrameCount: timelineFrames.filter((frame) => frame.visibleTileCount <= 0).length,
  };
}

function groundClampShiftY(frames: FrameEntry[]): number {
  const maxBottom = Math.max(
    -Infinity,
    ...frames.map((frame) => {
      const bounds = alphaBounds(frame.image);
      return bounds ? bounds.y + bounds.height - 1 - 48 : -Infinity;
    }),
  );
  return Number.isFinite(maxBottom) ? Math.min(0, MAX_GROUND_BOTTOM_Y - maxBottom) : 0;
}

function validateGroundLimit(frames: FrameEntry[], groundShiftY: number): GroundValidation {
  const maxBottom = Math.max(
    -Infinity,
    ...frames.map((frame) => {
      const bounds = alphaBounds(frame.image);
      return bounds ? bounds.y + bounds.height - 1 - 48 + groundShiftY : -Infinity;
    }),
  );
  return {
    maxAllowedBottomY: MAX_GROUND_BOTTOM_Y,
    maxVisibleBottomY: Number.isFinite(maxBottom) ? maxBottom : -Infinity,
    appliedShiftY: groundShiftY,
  };
}

function drawPose(target: RgbaImageData, rig: RgbaImageData, pose: PackedPose, baseX: number, baseY: number, scale: number): void {
  for (const oam of pose.oams) {
    const tileX = (oam.characterName % ATLAS_TILE_COLUMNS) * TILE_SIZE;
    const tileY = Math.floor(oam.characterName / ATLAS_TILE_COLUMNS) * TILE_SIZE;
    const screenX = 48 + oam.x;
    const screenY = 48 + oam.y;
    for (let y = 0; y < oam.height; y += 1) {
      for (let x = 0; x < oam.width; x += 1) {
        const sourceOffset = ((tileY + y) * rig.width + tileX + x) * 4;
        if ((rig.pixels[sourceOffset + 3] ?? 0) < 128) continue;
        for (let yy = 0; yy < scale; yy += 1) {
          for (let xx = 0; xx < scale; xx += 1) {
            const targetX = baseX + (screenX + x) * scale + xx;
            const targetY = baseY + (screenY + y) * scale + yy;
            if (targetX < 0 || targetY < 0 || targetX >= target.width || targetY >= target.height) continue;
            const targetOffset = (targetY * target.width + targetX) * 4;
            target.pixels.set(rig.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
          }
        }
      }
    }
  }
}

function frameDifference(left: RgbaImageData, right: RgbaImageData): number {
  if (left.width !== right.width || left.height !== right.height) return Infinity;
  let score = 0;
  for (let offset = 0; offset < left.pixels.length; offset += 4) {
    const leftVisible = (left.pixels[offset + 3] ?? 0) >= 128;
    const rightVisible = (right.pixels[offset + 3] ?? 0) >= 128;
    if (leftVisible !== rightVisible) {
      score += 20000;
      continue;
    }
    if (!leftVisible) continue;
    score += Math.abs((left.pixels[offset] ?? 0) - (right.pixels[offset] ?? 0));
    score += Math.abs((left.pixels[offset + 1] ?? 0) - (right.pixels[offset + 1] ?? 0));
    score += Math.abs((left.pixels[offset + 2] ?? 0) - (right.pixels[offset + 2] ?? 0));
  }
  return score;
}

function extractPaletteTile(image: RgbaImageData, x: number, y: number, palette: RgbColor[]): { pixels: Uint8ClampedArray; hash: string; visible: boolean } {
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  let visible = false;
  for (let yy = 0; yy < TILE_SIZE; yy += 1) {
    for (let xx = 0; xx < TILE_SIZE; xx += 1) {
      const targetOffset = (yy * TILE_SIZE + xx) * 4;
      const sourceX = x + xx;
      const sourceY = y + yy;
      if (sourceX < 0 || sourceY < 0 || sourceX >= image.width || sourceY >= image.height) {
        pixels.set(TRANSPARENT, targetOffset);
        continue;
      }
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      if ((image.pixels[sourceOffset + 3] ?? 0) < 128) {
        pixels.set(TRANSPARENT, targetOffset);
        continue;
      }
      visible = true;
      const color = nearestPaletteColor(
        { r: image.pixels[sourceOffset] ?? 0, g: image.pixels[sourceOffset + 1] ?? 0, b: image.pixels[sourceOffset + 2] ?? 0 },
        palette,
      );
      pixels.set([color.r, color.g, color.b, 255], targetOffset);
    }
  }
  return { pixels, visible, hash: createHash("sha1").update(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)).digest("hex") };
}

function blitTile(rig: RgbaImageData, tilePixels: Uint8ClampedArray, tileIndex: number): void {
  const tileX = (tileIndex % ATLAS_TILE_COLUMNS) * TILE_SIZE;
  const tileY = Math.floor(tileIndex / ATLAS_TILE_COLUMNS) * TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const sourceOffset = (y * TILE_SIZE + x) * 4;
      const targetOffset = ((tileY + y) * rig.width + tileX + x) * 4;
      rig.pixels.set(tilePixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

function imageHash(image: RgbaImageData): string {
  return createHash("sha1").update(Buffer.from(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength)).digest("hex");
}

function emptyImage(width: number, height: number): RgbaImageData {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function alphaBounds(image: RgbaImageData): Rect | undefined {
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

function hardRoundedBounds(bounds: Rect, imageWidth: number, imageHeight: number): Rect {
  const width = roundUp8(bounds.width);
  const height = roundUp8(bounds.height);
  return {
    x: clampIntLocal(bounds.x, 0, imageWidth - width),
    y: clampIntLocal(bounds.y, 0, imageHeight - height),
    width,
    height,
  };
}

function gifDelayToAnimDuration(delayMs: number): number {
  return Math.max(1, Math.round(delayMs / 16.67));
}

async function loadRom(filePath: string): Promise<Awaited<ReturnType<typeof loadProjectFromRomFile>>> {
  const bytes = await readBytes(filePath);
  return loadProjectFromRomFile(new File([bytes], path.basename(filePath)), {
    expandSprites: true,
    selectedNarcs: ["pokemon_sprites"],
  });
}

async function readRgbaPng(filePath: string): Promise<RgbaImageData> {
  const decoded = decodePng(await readBytes(filePath));
  return { width: decoded.width, height: decoded.height, pixels: decoded.pixels };
}

async function readPalette(filePath: string): Promise<RgbColor[]> {
  const image = await readRgbaPng(filePath);
  const colors: RgbColor[] = [];
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    colors.push({ r: image.pixels[offset] ?? 0, g: image.pixels[offset + 1] ?? 0, b: image.pixels[offset + 2] ?? 0 });
  }
  return colors;
}

function nearestPaletteColor(color: RgbColor, palette: RgbColor[]): RgbColor {
  const rounded = roundTripBgr555Color(color);
  let best = palette[0] ?? rounded;
  let bestDistance = Infinity;
  for (const candidate of palette) {
    const distance = (candidate.r - rounded.r) ** 2 + (candidate.g - rounded.g) ** 2 + (candidate.b - rounded.b) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function imageSize(image: RgbaImageData): string {
  return `${image.width}x${image.height}`;
}

function updatePokedexName(project: Awaited<ReturnType<typeof loadProjectFromRomFile>>, spriteId: number, name: string): void {
  const mappings = project.session.baseRom === "BW2" ? BW2_MESSAGE_BANKS : BW_MESSAGE_BANKS;
  const bankId = mappings.find(([, bankName]) => bankName === "pokedex")?.[0];
  if (bankId === undefined) throw new Error("Could not resolve Pokedex text bank");
  const bank = getTextBank(project, "message_texts", bankId);
  let updated = false;
  for (const entry of bank) {
    if (parseTextEntryId(entry[0]).entry !== spriteId) continue;
    entry[1] = name;
    updated = true;
  }
  if (!updated) throw new Error(`Pokedex text entry ${spriteId} does not exist`);
  commitTextBank(project, "message_texts", bankId);
}

function readPokedexNames(project: Awaited<ReturnType<typeof loadProjectFromRomFile>>, spriteIds: number[]): Record<number, string> {
  const mappings = project.session.baseRom === "BW2" ? BW2_MESSAGE_BANKS : BW_MESSAGE_BANKS;
  const bankId = mappings.find(([, bankName]) => bankName === "pokedex")?.[0];
  if (bankId === undefined) throw new Error("Could not resolve Pokedex text bank");
  const wanted = new Set(spriteIds);
  const names: Record<number, string> = {};
  for (const entry of getTextBank(project, "message_texts", bankId)) {
    const id = parseTextEntryId(entry[0]).entry;
    if (wanted.has(id)) names[id] = entry[1];
  }
  return names;
}

function roundUp8(value: number): number {
  return Math.max(8, Math.ceil(value / 8) * 8);
}

function clampIntLocal(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function shouldCompress(fileIndex: PokemonAnimationBundleFileIndex): boolean {
  return fileIndex === 5 || fileIndex === 14;
}

async function readBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

await main();
