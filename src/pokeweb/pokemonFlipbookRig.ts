import { decompressFrames, parseGIF } from "gifuct-js";
import {
  compressLz11Literal,
  type PokemonAnimationSide,
  type RigCell,
  type RgbColor,
  type RgbaImageData,
} from "./pokemonSpriteModel";
import {
  buildPokemonAnimationFile,
  buildPokemonCellBankFileFromCells,
  buildPokemonMultiCellAnimationFile,
  buildPokemonMultiCellsFile,
  buildPokemonMultiCellsFileFromCells,
  buildRigCellsFile,
  packagePokemonAnimationBundle,
  type PokemonAnimationBundleFileIndex,
  type PokemonAnimationBuildPart,
} from "./pokemonSpriteWriters";

export type PokemonFlipbookSamplingStrategy = "loop-rest" | "first-window" | "even";
export type PokemonFlipbookPackingMode = "mcss-safe" | "rotated-pose-blocks" | "macro-blocks" | "tile-node-dedup";

export type PokemonFlipbookImportConfig = {
  side: PokemonAnimationSide;
  strategy: PokemonFlipbookSamplingStrategy;
  packingMode: PokemonFlipbookPackingMode;
  sourceFramePercent: number;
  maxUniqueFrames: number;
  manualFrameNumbers?: number[];
  restLoopCount: "auto" | 1 | 2 | 3;
  includeFinish: boolean;
  maxAtlasTiles: number;
  durationScale: number;
  downscalePercent: number;
};

export type PokemonFlipbookReport = {
  sourceFrameCount: number;
  normalizedFrameCount: number;
  sourceFramePercent: number;
  durationScale: number;
  downscalePercent: number;
  selectedSourceFrames: number[];
  timelineFrames: number[];
  uniquePoseCount: number;
  uniqueTileCount: number;
  atlasOccupancyPercent: number;
  packingMode: PackedFlipbook["mode"];
  maxOamsPerPose: number;
  loopPlan?: {
    loopSearchWindow: { startFrame: number; endFrame: number };
    loopEndFrame: number;
    loopEndScore: number;
    restLoopCount: number;
    restLoopDuration: number;
    finishStartFrame: number;
  };
  groundValidation: { maxAllowedBottomY: number; maxVisibleBottomY: number; appliedShiftY: number };
  visibilityValidation: { frameCount: number; invisibleFrameCount: number };
  warnings: string[];
};

export type PokemonFlipbookBuildResult = {
  sprite: RgbaImageData;
  palette: RgbColor[];
  rig: RgbaImageData;
  bundle: Uint8Array;
  report: PokemonFlipbookReport;
};

export type PairedPokemonFlipbookBuildResult = {
  front: PokemonFlipbookBuildResult;
  back: PokemonFlipbookBuildResult;
  palette: RgbColor[];
};

export type PokemonFlipbookFrameEntry = { index: number; width: number; height: number; delayMs: number; pixels: Uint8ClampedArray };
type FrameEntry = PokemonFlipbookFrameEntry;
type TimelineFrame = FrameEntry & { timelineIndex: number; phase: "rest-loop" | "finish" | "sample" };
type PackedTimelineFrame = TimelineFrame & { poseIndex: number; visibleTileCount: number };
type Rect = { x: number; y: number; width: number; height: number };
type PreparedFlipbookFrames = {
  sourceFrames: FrameEntry[];
  normalized: FrameEntry[];
  timelineBuild: ReturnType<typeof buildTimeline>;
};
type PackedPose = {
  poseIndex: number;
  sourceFrame: number;
  sourceBounds: Rect;
  paddedBounds: Rect;
  atlasBounds?: Rect;
  oams: Array<{ x: number; y: number; width: number; height: number; characterName: number }>;
  nodeTiles?: Array<{ x: number; y: number; characterName: number }>;
  macroChunks?: MacroChunk[];
  rotated?: boolean;
  displayRotation?: number;
  spriteX?: number;
  spriteY?: number;
  tileCount: number;
};
type MacroChunk = { sourceBounds: Rect; atlasBounds: Rect; spriteX: number; spriteY: number; cellIndex: number };
type TileNodeSlot = { x: number; y: number };

const SPRITE_SIZE = 96;
const RIG_WIDTH = 256;
const RIG_HEIGHT = 128;
const TILE_SIZE = 8;
const ATLAS_TILE_COLUMNS = RIG_WIDTH / TILE_SIZE;
const MAX_ATLAS_TILES = (RIG_WIDTH / TILE_SIZE) * (RIG_HEIGHT / TILE_SIZE);
const MAX_GROUND_BOTTOM_Y = 3;
const DEFAULT_MAX_OAMS_PER_POSE = 64;
const MACRO_MAX_CHUNKS_PER_POSE = 8;
const MACRO_MAX_OAMS_PER_CHUNK = 4;
const MACRO_MIN_SPLIT_GAIN_TILES = 4;
const TRANSPARENT = [0, 0, 0, 0] as const;
const OAM_SIZES = [
  { width: 64, height: 64 },
  { width: 64, height: 32 },
  { width: 32, height: 64 },
  { width: 32, height: 32 },
  { width: 32, height: 16 },
  { width: 16, height: 32 },
  { width: 32, height: 8 },
  { width: 8, height: 32 },
  { width: 16, height: 16 },
  { width: 16, height: 8 },
  { width: 8, height: 16 },
  { width: 8, height: 8 },
] as const;

export function defaultPokemonFlipbookImportConfig(side: PokemonAnimationSide = "front"): PokemonFlipbookImportConfig {
  return {
    side,
    strategy: "loop-rest",
    packingMode: "mcss-safe",
    sourceFramePercent: 100,
    maxUniqueFrames: 96,
    restLoopCount: "auto",
    includeFinish: true,
    maxAtlasTiles: MAX_ATLAS_TILES,
    durationScale: 1,
    downscalePercent: 100,
  };
}

export function buildPokemonFlipbookRigFromGif(bytes: Uint8Array, config: PokemonFlipbookImportConfig): PokemonFlipbookBuildResult {
  return buildPokemonFlipbookRigFromFrames(decodePokemonFlipbookGifFrames(bytes), config);
}

export function buildPairedPokemonFlipbookRigsFromGifs(
  frontBytes: Uint8Array,
  backBytes: Uint8Array,
  config: Omit<PokemonFlipbookImportConfig, "side">,
): PairedPokemonFlipbookBuildResult {
  return buildPairedPokemonFlipbookRigsFromFrames(decodePokemonFlipbookGifFrames(frontBytes), decodePokemonFlipbookGifFrames(backBytes), config);
}

export function buildPairedPokemonFlipbookRigsFromFrames(
  frontFrames: FrameEntry[],
  backFrames: FrameEntry[],
  config: Omit<PokemonFlipbookImportConfig, "side">,
): PairedPokemonFlipbookBuildResult {
  const frontConfig = { ...config, side: "front" as const };
  const backConfig = { ...config, side: "back" as const };
  const frontPrepared = prepareFlipbookFrames(frontFrames, frontConfig);
  const backPrepared = prepareFlipbookFrames(backFrames, backConfig);
  const palette = buildPalette([...frontPrepared.timelineBuild.timeline, ...backPrepared.timelineBuild.timeline]);
  return {
    front: buildPokemonFlipbookRigFromPrepared(frontPrepared, frontConfig, palette),
    back: buildPokemonFlipbookRigFromPrepared(backPrepared, backConfig, palette),
    palette,
  };
}

export function buildPokemonFlipbookRigFromFrames(sourceFrames: FrameEntry[], config: PokemonFlipbookImportConfig): PokemonFlipbookBuildResult {
  const prepared = prepareFlipbookFrames(sourceFrames, config);
  return buildPokemonFlipbookRigFromPrepared(prepared, config, buildPalette(prepared.timelineBuild.timeline));
}

function prepareFlipbookFrames(sourceFrames: FrameEntry[], config: PokemonFlipbookImportConfig): PreparedFlipbookFrames {
  if (sourceFrames.length === 0) throw new Error("GIF contains no frames");
  const scaledFrames = scaleFrames(sourceFrames, config.downscalePercent);
  const normalized = normalizeFrames(scaledFrames);
  const sourceFrameLimit = config.manualFrameNumbers?.length
    ? normalized.length
    : clampInt(Math.ceil(normalized.length * clamp(config.sourceFramePercent, 1, 100) / 100), 1, normalized.length);
  const sourceWindow = normalized.slice(0, sourceFrameLimit);
  const timelineBuild = buildTimeline(sourceWindow, config);
  return { sourceFrames, normalized, timelineBuild };
}

function buildPokemonFlipbookRigFromPrepared(prepared: PreparedFlipbookFrames, config: PokemonFlipbookImportConfig, palette: RgbColor[]): PokemonFlipbookBuildResult {
  const { sourceFrames, normalized, timelineBuild } = prepared;
  const remappedTimeline = timelineBuild.timeline.map((frame) => remapFrameToPalette(frame, palette));
  const groundShiftY = groundClampShiftY(remappedTimeline);
  const remappedSprite = remapFrameToPalette(normalized[0]!, palette);
  const { packed, warnings: packWarnings } = packWithAdaptiveThinning(remappedTimeline, palette, config, groundShiftY);
  const durationScale = clamp(config.durationScale ?? 1, 0.25, 16);
  const loopDuration = packed.timelineFrames.reduce((sum, frame) => sum + gifDelayToAnimDuration(frame.delayMs, durationScale), 0);
  const sideOffset = config.side === "front" ? 0 : 9;
  const files = packed.mode === "tile-node-dedup"
    ? buildTileNodeFiles(packed, sideOffset, durationScale, loopDuration)
    : packed.mode === "macro-blocks"
      ? buildGroupedMacroBlockFiles(packed, sideOffset, durationScale, loopDuration)
    : buildFullPoseFiles(packed, sideOffset, durationScale, loopDuration);
  const compressedFiles = Object.fromEntries(
    Object.entries(files).map(([index, file]) => {
      const fileIndex = Number(index) as PokemonAnimationBundleFileIndex;
      return [fileIndex, shouldCompress(fileIndex) ? compressLz11Literal(file) : file];
    }),
  ) as typeof files;
  const visibilityValidation = validateVisibleTimeline(packed.timelineFrames);
  const groundValidation = validateGroundLimit(packed.timelineFrames, groundShiftY);
  if (visibilityValidation.invisibleFrameCount > 0) throw new Error(`Flipbook generated ${visibilityValidation.invisibleFrameCount} invisible frame(s)`);
  if (groundValidation.maxVisibleBottomY > groundValidation.maxAllowedBottomY) {
    throw new Error(`Flipbook ground clamp failed: visible bottom y ${groundValidation.maxVisibleBottomY} exceeds ${groundValidation.maxAllowedBottomY}`);
  }
  const warnings = [...timelineBuild.warnings, ...packWarnings];
  if (packed.uniqueTileCount > config.maxAtlasTiles) warnings.push(`Packed tile count ${packed.uniqueTileCount} exceeds configured tile budget ${config.maxAtlasTiles}`);

  return {
    sprite: frameToImage(remappedSprite),
    palette,
    rig: packed.rig,
    bundle: packagePokemonAnimationBundle({ side: config.side, files: compressedFiles }),
    report: {
      sourceFrameCount: sourceFrames.length,
      normalizedFrameCount: normalized.length,
      sourceFramePercent: config.sourceFramePercent,
      durationScale,
      downscalePercent: normalizeDownscalePercent(config.downscalePercent),
      selectedSourceFrames: Array.from(new Set(packed.timelineFrames.map((frame) => frame.index))).sort((a, b) => a - b),
      timelineFrames: packed.timelineFrames.map((frame) => frame.index),
      uniquePoseCount: packed.poses.length,
      uniqueTileCount: packed.uniqueTileCount,
      atlasOccupancyPercent: Math.round((packed.uniqueTileCount / MAX_ATLAS_TILES) * 1000) / 10,
      packingMode: packed.mode,
      maxOamsPerPose: Math.max(0, ...packed.poses.map((pose) => pose.oams.length)),
      loopPlan: timelineBuild.loopPlan,
      groundValidation,
      visibilityValidation,
      warnings,
    },
  };
}

export function decodePokemonFlipbookGifFrames(bytes: Uint8Array): PokemonFlipbookFrameEntry[] {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = parseGIF(arrayBuffer);
  const decompressed = decompressFrames(parsed, true);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  let canvas = new Uint8ClampedArray(width * height * 4);
  return decompressed.map((frame, index) => {
    const before = new Uint8ClampedArray(canvas);
    blitPatch(canvas, width, height, frame.patch, frame.dims);
    const pixels = new Uint8ClampedArray(canvas);
    if (frame.disposalType === 2) clearRect(canvas, width, height, frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    else if (frame.disposalType === 3) canvas = before;
    return { index, width, height, delayMs: Math.max(10, frame.delay ?? 100), pixels };
  });
}

function normalizeFrames(frames: FrameEntry[]): FrameEntry[] {
  const contentBounds = unionBounds(frames.map((frame) => alphaBounds(frame)).filter((box): box is Rect => Boolean(box)));
  const centerX = contentBounds ? contentBounds.x + contentBounds.width / 2 : frames[0]!.width / 2;
  const centerY = contentBounds ? contentBounds.y + contentBounds.height / 2 : frames[0]!.height / 2;
  const crop = { x: Math.round(centerX - SPRITE_SIZE / 2), y: Math.round(centerY - SPRITE_SIZE / 2), width: SPRITE_SIZE, height: SPRITE_SIZE };
  return frames.map((frame) => ({
    index: frame.index,
    width: SPRITE_SIZE,
    height: SPRITE_SIZE,
    delayMs: frame.delayMs,
    pixels: cropFrame(frame, crop),
  }));
}

function scaleFrames(frames: FrameEntry[], downscalePercent: number): FrameEntry[] {
  const percent = normalizeDownscalePercent(downscalePercent);
  if (percent === 100) return frames;
  const scale = percent / 100;
  return frames.map((frame) => {
    const width = Math.max(1, Math.round(frame.width * scale));
    const height = Math.max(1, Math.round(frame.height * scale));
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const sy = clampInt(Math.floor((y + 0.5) / scale), 0, frame.height - 1);
      for (let x = 0; x < width; x += 1) {
        const sx = clampInt(Math.floor((x + 0.5) / scale), 0, frame.width - 1);
        pixels.set(frame.pixels.subarray((sy * frame.width + sx) * 4, (sy * frame.width + sx) * 4 + 4), (y * width + x) * 4);
      }
    }
    return { ...frame, width, height, pixels };
  });
}

function normalizeDownscalePercent(value: number | undefined): number {
  if (!Number.isFinite(value)) return 100;
  return clampInt(value ?? 100, 5, 100);
}

function buildTimeline(frames: FrameEntry[], config: PokemonFlipbookImportConfig): {
  timeline: TimelineFrame[];
  loopPlan?: PokemonFlipbookReport["loopPlan"];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (config.manualFrameNumbers?.length) return buildManualTimeline(frames, config.manualFrameNumbers, warnings);
  if (config.strategy === "loop-rest") return buildLoopRestTimeline(frames, config, warnings);
  const selected = config.strategy === "even" ? sampleEvenly(frames, config.maxUniqueFrames) : sampleKeyFrames(frames, config.maxUniqueFrames);
  return {
    timeline: selected.map((frame, timelineIndex) => ({ ...frame, timelineIndex, phase: "sample" })),
    warnings,
  };
}

function buildManualTimeline(frames: FrameEntry[], requestedFrameNumbers: number[], warnings: string[]): { timeline: TimelineFrame[]; warnings: string[] } {
  const byIndex = new Map(frames.map((frame) => [frame.index, frame]));
  const timeline: TimelineFrame[] = [];
  for (const requested of requestedFrameNumbers) {
    const frame = byIndex.get(clampInt(requested, 0, Math.max(0, frames.length - 1)));
    if (!frame) {
      warnings.push(`Manual frame ${requested} is outside the GIF frame range`);
      continue;
    }
    timeline.push({ ...frame, timelineIndex: timeline.length, phase: "sample" });
  }
  if (timeline.length === 0) throw new Error("Manual sampling did not select any valid GIF frames");
  return { timeline, warnings };
}

function buildLoopRestTimeline(
  frames: FrameEntry[],
  config: PokemonFlipbookImportConfig,
  warnings: string[],
): { timeline: TimelineFrame[]; loopPlan: NonNullable<PokemonFlipbookReport["loopPlan"]>; warnings: string[] } {
  const startIndex = Math.max(1, Math.floor(frames.length * 0.25));
  const endIndex = Math.min(frames.length - 1, Math.max(startIndex, Math.floor(frames.length * 0.75)));
  let bestIndex = startIndex;
  let bestScore = Infinity;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const score = frameDifference(frames[0]!, frames[index]!);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  const restSegment = sampleKeyFrames(frames.slice(0, bestIndex + 1), Math.max(2, Math.min(config.maxUniqueFrames, bestIndex + 1)));
  const restLoopDuration = restSegment.reduce((sum, frame) => sum + frame.delayMs, 0);
  const totalDuration = frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  const autoLoopCount = restLoopDuration > 0 ? clampInt(Math.round((totalDuration * 0.75) / restLoopDuration), 2, 3) : 2;
  const restLoopCount = config.restLoopCount === "auto" ? autoLoopCount : config.restLoopCount;
  const finishFrames = config.includeFinish ? frames.slice(bestIndex + 1) : [];
  const finishBudget = Math.max(0, config.maxUniqueFrames - restSegment.length);
  const sampledFinish = sampleKeyFrames(finishFrames, finishBudget);
  const timeline: TimelineFrame[] = [];
  for (let loop = 0; loop < restLoopCount; loop += 1) {
    for (const frame of restSegment) timeline.push({ ...frame, timelineIndex: timeline.length, phase: "rest-loop" });
  }
  for (const frame of sampledFinish) timeline.push({ ...frame, timelineIndex: timeline.length, phase: "finish" });
  if (sampledFinish.length < finishFrames.length) warnings.push(`Sampled ${sampledFinish.length} of ${finishFrames.length} finish frame(s) to fit the configured frame budget`);
  return {
    timeline,
    loopPlan: {
      loopSearchWindow: { startFrame: frames[startIndex]!.index, endFrame: frames[endIndex]!.index },
      loopEndFrame: frames[bestIndex]!.index,
      loopEndScore: Math.round(bestScore),
      restLoopCount,
      restLoopDuration,
      finishStartFrame: sampledFinish[0]?.index ?? -1,
    },
    warnings,
  };
}

function packWithAdaptiveThinning(timeline: TimelineFrame[], palette: RgbColor[], config: PokemonFlipbookImportConfig, groundShiftY: number): {
  packed: PackedFlipbook;
  warnings: string[];
} {
  const warnings: string[] = [];
  let candidate = timeline;
  let lastFailingCount = timeline.length + 1;
  while (candidate.length >= 1) {
    const packed = packTimelineCandidate(candidate, palette, config, groundShiftY);
    if (packedFlipbookFits(packed, config)) {
      let best = { packed, candidate };
      const maxRefineCount = Math.min(lastFailingCount - 1, timeline.length);
      for (let count = maxRefineCount; count > candidate.length; count -= 1) {
        const refinedCandidate = sampleTimelineKeyFrames(timeline, count);
        const refinedPacked = packTimelineCandidate(refinedCandidate, palette, config, groundShiftY);
        if (packedFlipbookFits(refinedPacked, config)) {
          best = { packed: refinedPacked, candidate: refinedCandidate };
          break;
        }
      }
      if (!config.manualFrameNumbers?.length) {
        best = refillPackedTimeline(best.candidate, best.packed, timeline, palette, config, groundShiftY);
      }
      if (best.candidate.length < timeline.length) warnings.push(`Reduced timeline from ${timeline.length} to ${best.candidate.length} frame(s) to fit the tile/OAM budget`);
      return { packed: best.packed, warnings };
    }
    lastFailingCount = candidate.length;
    const nextCount = Math.max(1, Math.floor(candidate.length * 0.8));
    if (nextCount >= candidate.length) break;
    candidate = sampleTimelineKeyFrames(candidate, nextCount);
  }
  throw new Error(`Unable to fit flipbook into ${config.maxAtlasTiles} atlas tiles with <= ${DEFAULT_MAX_OAMS_PER_POSE} OAMs per pose`);
}

function packTimelineCandidate(timeline: TimelineFrame[], palette: RgbColor[], config: PokemonFlipbookImportConfig, groundShiftY: number): PackedFlipbook {
  return config.packingMode === "tile-node-dedup"
    ? packTimelineAsTileNodes(timeline, palette, config.maxAtlasTiles, groundShiftY)
    : config.packingMode === "macro-blocks"
      ? packTimelineAsMacroBlocks(timeline, palette, config.maxAtlasTiles, groundShiftY)
      : config.packingMode === "rotated-pose-blocks"
        ? packTimelineAsRotatedBlocks(timeline, palette, config.maxAtlasTiles, groundShiftY)
      : packTimelineAsBlocks(timeline, palette, config.maxAtlasTiles, groundShiftY);
}

function packedFlipbookFits(packed: PackedFlipbook, config: PokemonFlipbookImportConfig): boolean {
  const maxOams = Math.max(0, ...packed.poses.map((pose) => pose.oams.length));
  const nodeCount = packed.mode === "tile-node-dedup"
    ? uniqueTileNodeSlots(packed).length
    : Math.max(0, ...packed.poses.map((pose) => pose.oams.length));
  const fitsMode = packed.mode === "tile-node-dedup" ? nodeCount <= 255 : maxOams <= DEFAULT_MAX_OAMS_PER_POSE;
  return packed.uniqueTileCount <= config.maxAtlasTiles && fitsMode;
}

function refillPackedTimeline(
  candidate: TimelineFrame[],
  packed: PackedFlipbook,
  timeline: TimelineFrame[],
  palette: RgbColor[],
  config: PokemonFlipbookImportConfig,
  groundShiftY: number,
): { candidate: TimelineFrame[]; packed: PackedFlipbook } {
  let best = { candidate, packed };
  const selectedSourceFrames = new Set(best.candidate.map((frame) => frame.index));
  const refillPool = uniqueTimelineFramesBySource(timeline).filter((frame) => !selectedSourceFrames.has(frame.index));
  let improved = true;
  while (improved) {
    improved = false;
    let bestAddition: { candidate: TimelineFrame[]; packed: PackedFlipbook; frame: TimelineFrame } | undefined;
    for (const frame of refillPool) {
      if (selectedSourceFrames.has(frame.index)) continue;
      const nextCandidate = insertTimelineFrameBySourceIndex(best.candidate, frame);
      const nextPacked = packTimelineCandidate(nextCandidate, palette, config, groundShiftY);
      if (!packedFlipbookFits(nextPacked, config)) continue;
      if (
        !bestAddition ||
        nextPacked.poses.length > bestAddition.packed.poses.length ||
        (nextPacked.poses.length === bestAddition.packed.poses.length && nextPacked.uniqueTileCount < bestAddition.packed.uniqueTileCount)
      ) {
        bestAddition = { candidate: nextCandidate, packed: nextPacked, frame };
      }
    }
    if (bestAddition && bestAddition.packed.poses.length > best.packed.poses.length) {
      best = { candidate: bestAddition.candidate, packed: bestAddition.packed };
      selectedSourceFrames.add(bestAddition.frame.index);
      improved = true;
    }
  }
  return best;
}

function uniqueTimelineFramesBySource(timeline: TimelineFrame[]): TimelineFrame[] {
  const bySource = new Map<number, TimelineFrame>();
  for (const frame of timeline) {
    if (!bySource.has(frame.index)) bySource.set(frame.index, frame);
  }
  return Array.from(bySource.values()).sort((left, right) => left.index - right.index);
}

function insertTimelineFrameBySourceIndex(timeline: TimelineFrame[], frame: TimelineFrame): TimelineFrame[] {
  return [...timeline, frame]
    .sort((left, right) => left.index - right.index || left.timelineIndex - right.timelineIndex)
    .map((row, timelineIndex) => ({ ...row, timelineIndex }));
}

type PackedFlipbook = {
  rig: RgbaImageData;
  poses: PackedPose[];
  timelineFrames: PackedTimelineFrame[];
  uniqueTileCount: number;
  mode: "tile-dedup" | "block" | "rotated-block" | "macro-blocks" | "tile-node-dedup";
};

function buildFullPoseFiles(packed: PackedFlipbook, sideOffset: number, durationScale: number, loopDuration: number): Partial<Record<PokemonAnimationBundleFileIndex, Uint8Array>> {
  const displayPart = visibleDisplayPart(packed.timelineFrames);
  const rigCells = packed.poses.map(rigCellFromPackedPose);
  if (rigCells.some((cell) => !cell)) throw new Error("Flipbook generated a pose without full NCEC rig-cell metadata");
  return {
    [(4 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonCellBankFileFromCells(packed.poses.map((pose) => ({ oams: pose.oams }))),
    [(5 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonAnimationFile({
      targetType: 1,
      frames: [
        packed.timelineFrames.map((frame) => ({
          duration: gifDelayToAnimDuration(frame.delayMs, durationScale),
          cellIndex: frame.poseIndex,
          x: 0,
          y: 0,
          rotation: packed.poses[frame.poseIndex]?.displayRotation ?? 0,
          xScale: 1,
          yScale: 1,
        })),
      ],
    }),
    [(6 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellsFile([displayPart], { multiCellCopies: 2 }),
    [(7 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellAnimationFile(loopDuration),
    [(8 + sideOffset) as PokemonAnimationBundleFileIndex]: buildRigCellsFile({ cells: rigCells as RigCell[], flags: new Uint8Array(4) }),
  };
}

function buildTileNodeFiles(packed: PackedFlipbook, sideOffset: number, durationScale: number, loopDuration: number): Partial<Record<PokemonAnimationBundleFileIndex, Uint8Array>> {
  const slots = uniqueTileNodeSlots(packed);
  const parts: PokemonAnimationBuildPart[] = slots.map((slot, index) => ({
    name: `tile-node-${index}`,
    cellX: 0,
    cellY: 0,
    width: TILE_SIZE,
    height: TILE_SIZE,
    spriteX: slot.x,
    spriteY: -slot.y,
    pivot: { x: 0, y: 0 },
    z: index,
  }));
  const sequences = slots.map((slot) => ({
    targetType: 1 as const,
    mode: 2,
    frames: packed.timelineFrames.map((frame) => {
      const pose = packed.poses[frame.poseIndex];
      const tile = pose?.nodeTiles?.find((candidate) => candidate.x === slot.x && candidate.y === slot.y);
      return {
        duration: gifDelayToAnimDuration(frame.delayMs, durationScale),
        cellIndex: tile?.characterName ?? 0,
        x: 0,
        y: 0,
        rotation: 0,
        xScale: 1,
        yScale: 1,
      };
    }),
  }));
  const cells = Array.from({ length: packed.uniqueTileCount }, (_, tileIndex) => ({
    oams: [{ x: 0, y: 0, width: TILE_SIZE, height: TILE_SIZE, characterName: tileIndex }],
  }));
  const rigCells = Array.from({ length: packed.uniqueTileCount }, (_, tileIndex) => tileRigCell(tileIndex));
  return {
    [(4 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonCellBankFileFromCells(cells),
    [(5 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonAnimationFile(sequences),
    [(6 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellsFile(parts, { multiCellCopies: 2 }),
    [(7 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellAnimationFile(loopDuration),
    [(8 + sideOffset) as PokemonAnimationBundleFileIndex]: buildRigCellsFile({ cells: rigCells, flags: new Uint8Array(4) }),
  };
}

function buildGroupedMacroBlockFiles(packed: PackedFlipbook, sideOffset: number, durationScale: number, loopDuration: number): Partial<Record<PokemonAnimationBundleFileIndex, Uint8Array>> {
  const chunks = packed.poses
    .flatMap((pose) => pose.macroChunks ?? [])
    .sort((left, right) => left.cellIndex - right.cellIndex);
  const cells = [
    { oams: [{ x: 0, y: 0, width: TILE_SIZE, height: TILE_SIZE, characterName: 0 }] },
    ...chunks.map((chunk) => ({ oams: oamsForMacroChunk(chunk) })),
  ];
  const rigCells = [transparentTileRigCell(), ...chunks.map(rigCellFromMacroChunk)];
  const slotCount = Math.max(1, ...packed.poses.map((pose) => pose.macroChunks?.length ?? 0));
  const slotSequences = Array.from({ length: slotCount }, (_, slotIndex) =>
    packed.timelineFrames.map((frame) => {
      const chunk = packed.poses[frame.poseIndex]?.macroChunks?.[slotIndex];
      return {
        duration: gifDelayToAnimDuration(frame.delayMs, durationScale),
        cellIndex: chunk?.cellIndex ?? 0,
        x: 0,
        y: 0,
        rotation: 0,
        xScale: 1,
        yScale: 1,
      };
    }),
  );
  const nodes = Array.from({ length: slotCount }, (_, slotIndex) => ({
    sequenceNumber: slotIndex,
    cellAnimationIndex: slotIndex,
    x: 0,
    y: 0,
  }));
  return {
    [(4 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonCellBankFileFromCells(cells),
    [(5 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonAnimationFile({ targetType: 1, frames: slotSequences }),
    [(6 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellsFileFromCells([nodes, nodes]),
    [(7 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellAnimationFile(loopDuration),
    [(8 + sideOffset) as PokemonAnimationBundleFileIndex]: buildRigCellsFile({ cells: rigCells, flags: new Uint8Array(4) }),
  };
}

function packTimelineAsTileDictionary(timeline: TimelineFrame[], palette: RgbColor[], maxTiles: number, groundShiftY: number): PackedFlipbook {
  const rig = emptyImage(RIG_WIDTH, RIG_HEIGHT);
  const tileIndexes = new Map<string, number>();
  const poseIndexes = new Map<string, PackedPose>();
  const poses: PackedPose[] = [];
  const timelineFrames: PackedTimelineFrame[] = [];
  for (const frame of timeline) {
    const poseKey = hashBytes(frame.pixels);
    let pose = poseIndexes.get(poseKey);
    if (!pose) {
      const sourceBounds = alphaBounds(frame);
      if (!sourceBounds) throw new Error(`Source frame ${frame.index} has no visible pixels`);
      const paddedBounds = hardRoundedBounds(sourceBounds, frame.width, frame.height);
      const oams: PackedPose["oams"] = [];
      for (let y = 0; y < paddedBounds.height; y += TILE_SIZE) {
        for (let x = 0; x < paddedBounds.width; x += TILE_SIZE) {
          const tile = extractTile(frame, paddedBounds.x + x, paddedBounds.y + y, palette);
          if (!tile.visible) continue;
          let tileIndex = tileIndexes.get(tile.hash);
          if (tileIndex === undefined) {
            tileIndex = tileIndexes.size;
            if (tileIndex >= maxTiles || tileIndex >= MAX_ATLAS_TILES) return { rig, poses, timelineFrames, uniqueTileCount: tileIndexes.size + 1, mode: "tile-dedup" };
            tileIndexes.set(tile.hash, tileIndex);
            blitTile(rig, tile.pixels, tileIndex);
          }
          oams.push({ x: paddedBounds.x - 48 + x, y: paddedBounds.y - 48 + y + groundShiftY, width: TILE_SIZE, height: TILE_SIZE, characterName: tileIndex });
        }
      }
      if (oams.length === 0) throw new Error(`Source frame ${frame.index} packed as an invisible pose`);
      pose = { poseIndex: poses.length, sourceFrame: frame.index, sourceBounds, paddedBounds, oams, tileCount: oams.length };
      poses.push(pose);
      poseIndexes.set(poseKey, pose);
    }
    timelineFrames.push({ ...frame, poseIndex: pose.poseIndex, visibleTileCount: pose.tileCount });
  }
  const displayTiles = addDisplayPoseCopy(rig, poses[0], timeline[0], palette, tileIndexes.size);
  return { rig, poses, timelineFrames, uniqueTileCount: tileIndexes.size + displayTiles, mode: "tile-dedup" };
}

function packTimelineAsTileNodes(timeline: TimelineFrame[], palette: RgbColor[], maxTiles: number, groundShiftY: number): PackedFlipbook {
  const rig = emptyImage(RIG_WIDTH, RIG_HEIGHT);
  const tileIndexes = new Map<string, number>();
  const poseIndexes = new Map<string, PackedPose>();
  const poses: PackedPose[] = [];
  const timelineFrames: PackedTimelineFrame[] = [];
  tileIndexes.set(hashBytes(new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)), 0);
  for (const frame of timeline) {
    const poseKey = hashBytes(frame.pixels);
    let pose = poseIndexes.get(poseKey);
    if (!pose) {
      const sourceBounds = alphaBounds(frame);
      if (!sourceBounds) throw new Error(`Source frame ${frame.index} has no visible pixels`);
      const paddedBounds = hardRoundedBounds(sourceBounds, frame.width, frame.height);
      const nodeTiles: NonNullable<PackedPose["nodeTiles"]> = [];
      for (let y = 0; y < paddedBounds.height; y += TILE_SIZE) {
        for (let x = 0; x < paddedBounds.width; x += TILE_SIZE) {
          const tile = extractTile(frame, paddedBounds.x + x, paddedBounds.y + y, palette);
          if (!tile.visible) continue;
          let tileIndex = tileIndexes.get(tile.hash);
          if (tileIndex === undefined) {
            tileIndex = tileIndexes.size;
            if (tileIndex >= maxTiles || tileIndex >= MAX_ATLAS_TILES) return { rig, poses, timelineFrames, uniqueTileCount: tileIndexes.size + 1, mode: "tile-node-dedup" };
            tileIndexes.set(tile.hash, tileIndex);
            blitTile(rig, tile.pixels, tileIndex);
          }
          nodeTiles.push({
            x: paddedBounds.x - 48 + x,
            y: paddedBounds.y - 48 + y + groundShiftY,
            characterName: tileIndex,
          });
        }
      }
      if (nodeTiles.length === 0) throw new Error(`Source frame ${frame.index} packed as an invisible pose`);
      const oams = nodeTiles.map((tile) => ({ x: tile.x, y: tile.y, width: TILE_SIZE, height: TILE_SIZE, characterName: tile.characterName }));
      pose = { poseIndex: poses.length, sourceFrame: frame.index, sourceBounds, paddedBounds, oams, nodeTiles, tileCount: nodeTiles.length };
      poses.push(pose);
      poseIndexes.set(poseKey, pose);
    }
    timelineFrames.push({ ...frame, poseIndex: pose.poseIndex, visibleTileCount: pose.tileCount });
  }
  return { rig, poses, timelineFrames, uniqueTileCount: tileIndexes.size, mode: "tile-node-dedup" };
}

function packTimelineAsMacroBlocks(timeline: TimelineFrame[], palette: RgbColor[], maxTiles: number, groundShiftY: number): PackedFlipbook {
  const rig = emptyImage(RIG_WIDTH, RIG_HEIGHT);
  const poseIndexes = new Map<string, PackedPose>();
  const poseFrames = new Map<number, TimelineFrame>();
  const poses: PackedPose[] = [];
  const timelineFrames: PackedTimelineFrame[] = [];

  for (const frame of timeline) {
    const poseKey = hashBytes(frame.pixels);
    let pose = poseIndexes.get(poseKey);
    if (!pose) {
      const sourceBounds = alphaBounds(frame);
      if (!sourceBounds) throw new Error(`Source frame ${frame.index} has no visible pixels`);
      const paddedBounds = hardRoundedBounds(sourceBounds, frame.width, frame.height);
      const macroChunks = macroChunksForPose(frame, paddedBounds).map((sourceBounds) => ({
        sourceBounds,
        atlasBounds: { x: 0, y: 0, width: sourceBounds.width, height: sourceBounds.height },
        spriteX: sourceBounds.x - 48,
        spriteY: -(sourceBounds.y - 48 + groundShiftY),
        cellIndex: 0,
      }));
      if (macroChunks.length === 0) throw new Error(`Source frame ${frame.index} packed as an invisible pose`);
      pose = {
        poseIndex: poses.length,
        sourceFrame: frame.index,
        sourceBounds,
        paddedBounds,
        atlasBounds: paddedBounds,
        oams: [],
        macroChunks,
        tileCount: 0,
      };
      poses.push(pose);
      poseFrames.set(pose.poseIndex, frame);
      poseIndexes.set(poseKey, pose);
    }
    timelineFrames.push({ ...frame, poseIndex: pose.poseIndex, visibleTileCount: 0 });
  }

  const occupied = new Uint8Array(MAX_ATLAS_TILES);
  const chunks = poses
    .flatMap((pose) => (pose.macroChunks ?? []).map((chunk, chunkIndex) => ({ pose, chunk, chunkIndex })))
    .sort((left, right) => {
      const areaDelta = rectTileArea(right.chunk.sourceBounds) - rectTileArea(left.chunk.sourceBounds);
      if (areaDelta !== 0) return areaDelta;
      return right.chunk.sourceBounds.height - left.chunk.sourceBounds.height || right.chunk.sourceBounds.width - left.chunk.sourceBounds.width;
    });
  occupied[0] = 1;
  let usedTiles = 1;
  let nextCellIndex = 1;
  for (const item of chunks) {
    const { sourceBounds } = item.chunk;
    const placement = firstFreeAtlasPlacement(occupied, sourceBounds.width, sourceBounds.height);
    const frame = poseFrames.get(item.pose.poseIndex);
    if (!placement || !frame) {
      return { rig, poses, timelineFrames, uniqueTileCount: maxTiles + 1, mode: "macro-blocks" };
    }
    item.chunk.atlasBounds = { x: placement.x, y: placement.y, width: sourceBounds.width, height: sourceBounds.height };
    item.chunk.cellIndex = nextCellIndex;
    nextCellIndex += 1;
    blitPoseBlock(rig, frame, sourceBounds, placement.x, placement.y, palette);
    markBlockCovered(occupied, RIG_WIDTH, placement.x, placement.y, sourceBounds.width, sourceBounds.height);
    usedTiles += rectTileArea(sourceBounds);
    if (usedTiles > maxTiles || usedTiles > MAX_ATLAS_TILES) {
      return { rig, poses, timelineFrames, uniqueTileCount: usedTiles, mode: "macro-blocks" };
    }
  }

  for (const pose of poses) {
    const chunksForPose = pose.macroChunks ?? [];
    pose.oams = chunksForPose.flatMap((chunk) => oamsForBlock({ atlasX: chunk.atlasBounds.x, atlasY: chunk.atlasBounds.y, sourceBounds: chunk.sourceBounds, groundShiftY }));
    pose.tileCount = pose.oams.length;
    pose.atlasBounds = unionBounds(chunksForPose.map((chunk) => chunk.atlasBounds)) ?? chunksForPose[0]?.atlasBounds ?? pose.paddedBounds;
  }
  for (const frame of timelineFrames) {
    frame.visibleTileCount = poses[frame.poseIndex]?.tileCount ?? 0;
  }
  return { rig, poses, timelineFrames, uniqueTileCount: usedTiles, mode: "macro-blocks" };
}

function uniqueTileNodeSlots(packed: PackedFlipbook): TileNodeSlot[] {
  const slots = new Map<string, TileNodeSlot>();
  for (const pose of packed.poses) {
    for (const tile of pose.nodeTiles ?? []) {
      const key = `${tile.x},${tile.y}`;
      if (!slots.has(key)) slots.set(key, { x: tile.x, y: tile.y });
    }
  }
  return Array.from(slots.values()).sort((left, right) => left.y - right.y || left.x - right.x);
}

function addDisplayPoseCopy(rig: RgbaImageData, pose: PackedPose | undefined, frame: TimelineFrame | undefined, palette: RgbColor[], occupiedTiles: number): number {
  if (!pose || !frame) return 0;
  const covered = new Uint8Array(MAX_ATLAS_TILES);
  for (let index = 0; index < Math.min(occupiedTiles, MAX_ATLAS_TILES); index += 1) covered[index] = 1;
  for (let y = 0; y <= RIG_HEIGHT - pose.paddedBounds.height; y += TILE_SIZE) {
    for (let x = 0; x <= RIG_WIDTH - pose.paddedBounds.width; x += TILE_SIZE) {
      if (!canPlaceBlock(covered, RIG_WIDTH, x, y, pose.paddedBounds.width, pose.paddedBounds.height)) continue;
      blitPoseBlock(rig, frame, pose.paddedBounds, x, y, palette);
      markBlockCovered(covered, RIG_WIDTH, x, y, pose.paddedBounds.width, pose.paddedBounds.height);
      pose.atlasBounds = { x, y, width: pose.paddedBounds.width, height: pose.paddedBounds.height };
      return (pose.paddedBounds.width / TILE_SIZE) * (pose.paddedBounds.height / TILE_SIZE);
    }
  }
  return 0;
}

function packTimelineAsBlocks(timeline: TimelineFrame[], palette: RgbColor[], maxTiles: number, groundShiftY: number): PackedFlipbook {
  const rig = emptyImage(RIG_WIDTH, RIG_HEIGHT);
  const poseIndexes = new Map<string, PackedPose>();
  const poses: PackedPose[] = [];
  const timelineFrames: PackedTimelineFrame[] = [];
  let nextX = 0;
  let nextY = 0;
  let rowHeight = 0;
  let usedTiles = 0;

  for (const frame of timeline) {
    const poseKey = hashBytes(frame.pixels);
    let pose = poseIndexes.get(poseKey);
    if (!pose) {
      const sourceBounds = alphaBounds(frame);
      if (!sourceBounds) throw new Error(`Source frame ${frame.index} has no visible pixels`);
      const paddedBounds = hardRoundedBounds(sourceBounds, frame.width, frame.height);
      if (nextX + paddedBounds.width > RIG_WIDTH) {
        nextX = 0;
        nextY += rowHeight;
        rowHeight = 0;
      }
      if (nextY + paddedBounds.height > RIG_HEIGHT) return { rig, poses, timelineFrames, uniqueTileCount: maxTiles + 1, mode: "block" };
      blitPoseBlock(rig, frame, paddedBounds, nextX, nextY, palette);
      const oams = oamsForBlock({ atlasX: nextX, atlasY: nextY, sourceBounds: paddedBounds, groundShiftY });
      usedTiles += (paddedBounds.width / TILE_SIZE) * (paddedBounds.height / TILE_SIZE);
      if (usedTiles > maxTiles || usedTiles > MAX_ATLAS_TILES) return { rig, poses, timelineFrames, uniqueTileCount: usedTiles, mode: "block" };
      pose = {
        poseIndex: poses.length,
        sourceFrame: frame.index,
        sourceBounds,
        paddedBounds,
        atlasBounds: { x: nextX, y: nextY, width: paddedBounds.width, height: paddedBounds.height },
        oams,
        tileCount: oams.length,
      };
      poses.push(pose);
      poseIndexes.set(poseKey, pose);
      nextX += paddedBounds.width;
      rowHeight = Math.max(rowHeight, paddedBounds.height);
    }
    timelineFrames.push({ ...frame, poseIndex: pose.poseIndex, visibleTileCount: pose.oams.length });
  }
  return { rig, poses, timelineFrames, uniqueTileCount: usedTiles, mode: "block" };
}

function packTimelineAsRotatedBlocks(timeline: TimelineFrame[], palette: RgbColor[], maxTiles: number, groundShiftY: number): PackedFlipbook {
  const rig = emptyImage(RIG_WIDTH, RIG_HEIGHT);
  const poseIndexes = new Map<string, PackedPose>();
  const poses: PackedPose[] = [];
  const timelineFrames: PackedTimelineFrame[] = [];
  const occupied = new Uint8Array(MAX_ATLAS_TILES);
  let usedTiles = 0;
  let usedRotatedPose = false;

  for (const frame of timeline) {
    const poseKey = hashBytes(frame.pixels);
    let pose = poseIndexes.get(poseKey);
    if (!pose) {
      const sourceBounds = alphaBounds(frame);
      if (!sourceBounds) throw new Error(`Source frame ${frame.index} has no visible pixels`);
      const paddedBounds = hardRoundedBounds(sourceBounds, frame.width, frame.height);
      const placement = chooseRotatedBlockPlacement(occupied, paddedBounds);
      if (!placement) return { rig, poses, timelineFrames, uniqueTileCount: maxTiles + 1, mode: usedRotatedPose ? "rotated-block" : "block" };

      const isRotated = placement.rotated;
      const atlasBounds = {
        x: placement.x,
        y: placement.y,
        width: isRotated ? paddedBounds.height : paddedBounds.width,
        height: isRotated ? paddedBounds.width : paddedBounds.height,
      };
      const rotatedGeometry = isRotated ? rotatedPoseGeometry(paddedBounds, groundShiftY) : undefined;
      if (isRotated) {
        blitPoseBlockRotatedClockwise(rig, frame, paddedBounds, placement.x, placement.y, palette);
        usedRotatedPose = true;
      } else {
        blitPoseBlock(rig, frame, paddedBounds, placement.x, placement.y, palette);
      }
      const oams = isRotated && rotatedGeometry
        ? oamsForStoredBlock({ atlasBounds, spriteX: rotatedGeometry.spriteX, spriteY: rotatedGeometry.spriteY })
        : oamsForBlock({ atlasX: placement.x, atlasY: placement.y, sourceBounds: paddedBounds, groundShiftY });
      usedTiles += rectTileArea(atlasBounds);
      if (usedTiles > maxTiles || usedTiles > MAX_ATLAS_TILES) {
        return { rig, poses, timelineFrames, uniqueTileCount: usedTiles, mode: usedRotatedPose ? "rotated-block" : "block" };
      }
      markBlockCovered(occupied, RIG_WIDTH, atlasBounds.x, atlasBounds.y, atlasBounds.width, atlasBounds.height);
      pose = {
        poseIndex: poses.length,
        sourceFrame: frame.index,
        sourceBounds,
        paddedBounds,
        atlasBounds,
        oams,
        rotated: isRotated,
        displayRotation: rotatedGeometry?.rotation ?? 0,
        spriteX: rotatedGeometry?.spriteX,
        spriteY: rotatedGeometry?.spriteY,
        tileCount: oams.length,
      };
      poses.push(pose);
      poseIndexes.set(poseKey, pose);
    }
    timelineFrames.push({ ...frame, poseIndex: pose.poseIndex, visibleTileCount: pose.oams.length });
  }
  return { rig, poses, timelineFrames, uniqueTileCount: usedTiles, mode: usedRotatedPose ? "rotated-block" : "block" };
}

function chooseRotatedBlockPlacement(occupied: Uint8Array, bounds: Rect): { x: number; y: number; rotated: boolean } | undefined {
  const upright = firstFreeAtlasPlacement(occupied, bounds.width, bounds.height);
  const rotated = bounds.width === bounds.height ? undefined : firstFreeAtlasPlacement(occupied, bounds.height, bounds.width);
  if (!upright && !rotated) return undefined;
  if (!upright) return { ...rotated!, rotated: true };
  if (!rotated) return { ...upright, rotated: false };
  const uprightBottom = upright.y + bounds.height;
  const rotatedBottom = rotated.y + bounds.width;
  if (bounds.height > bounds.width && rotatedBottom <= uprightBottom) return { ...rotated, rotated: true };
  if (rotatedBottom < uprightBottom) return { ...rotated, rotated: true };
  return { ...upright, rotated: false };
}

function rotatedPoseGeometry(sourceBounds: Rect, groundShiftY: number): { spriteX: number; spriteY: number; rotation: number } {
  const desiredX = sourceBounds.x - SPRITE_SIZE / 2;
  const desiredY = sourceBounds.y - SPRITE_SIZE / 2 + groundShiftY - 1;
  return {
    spriteX: -desiredY - sourceBounds.height,
    spriteY: -desiredX,
    rotation: -90,
  };
}

function macroChunksForPose(frame: FrameEntry, bounds: Rect): Rect[] {
  const chunks = [bounds];
  while (chunks.length < MACRO_MAX_CHUNKS_PER_POSE) {
    const oversizedIndex = chunks.findIndex((chunk) => rectOamCount(chunk) > MACRO_MAX_OAMS_PER_CHUNK);
    const best = oversizedIndex >= 0
      ? remapMacroSplit(bestMacroSplit(frame, [chunks[oversizedIndex]!]), oversizedIndex)
      : bestMacroSplit(frame, chunks);
    if (!best) break;
    const original = chunks[best.chunkIndex]!;
    const originalArea = rectTileArea(original);
    const shouldSplit =
      best.gainTiles >= MACRO_MIN_SPLIT_GAIN_TILES ||
      originalArea >= 64 ||
      original.width > 64 ||
      original.height > 64 ||
      rectOamCount(original) > MACRO_MAX_OAMS_PER_CHUNK;
    if (!shouldSplit) break;
    chunks.splice(best.chunkIndex, 1, ...best.rects);
  }
  return chunks.sort((left, right) => left.y - right.y || left.x - right.x);
}

function remapMacroSplit(
  split: { chunkIndex: number; rects: Rect[]; gainTiles: number; score: number } | undefined,
  chunkIndex: number,
): { chunkIndex: number; rects: Rect[]; gainTiles: number; score: number } | undefined {
  return split ? { ...split, chunkIndex } : undefined;
}

function bestMacroSplit(frame: FrameEntry, chunks: Rect[]): { chunkIndex: number; rects: Rect[]; gainTiles: number; score: number } | undefined {
  let best: { chunkIndex: number; rects: Rect[]; gainTiles: number; score: number } | undefined;
  chunks.forEach((chunk, chunkIndex) => {
    if (chunk.width <= TILE_SIZE && chunk.height <= TILE_SIZE) return;
    for (let splitX = chunk.x + TILE_SIZE; splitX <= chunk.x + chunk.width - TILE_SIZE; splitX += TILE_SIZE) {
      const left = tileRoundedAlphaBoundsInRect(frame, { x: chunk.x, y: chunk.y, width: splitX - chunk.x, height: chunk.height });
      const right = tileRoundedAlphaBoundsInRect(frame, { x: splitX, y: chunk.y, width: chunk.x + chunk.width - splitX, height: chunk.height });
      const candidate = macroSplitCandidate(frame, chunk, chunkIndex, [left, right], { x: splitX - TILE_SIZE, y: chunk.y, width: TILE_SIZE * 2, height: chunk.height });
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
    for (let splitY = chunk.y + TILE_SIZE; splitY <= chunk.y + chunk.height - TILE_SIZE; splitY += TILE_SIZE) {
      const top = tileRoundedAlphaBoundsInRect(frame, { x: chunk.x, y: chunk.y, width: chunk.width, height: splitY - chunk.y });
      const bottom = tileRoundedAlphaBoundsInRect(frame, { x: chunk.x, y: splitY, width: chunk.width, height: chunk.y + chunk.height - splitY });
      const candidate = macroSplitCandidate(frame, chunk, chunkIndex, [top, bottom], { x: chunk.x, y: splitY - TILE_SIZE, width: chunk.width, height: TILE_SIZE * 2 });
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  });
  return best;
}

function macroSplitCandidate(
  frame: FrameEntry,
  original: Rect,
  chunkIndex: number,
  maybeRects: Array<Rect | undefined>,
  seam: Rect,
): { chunkIndex: number; rects: Rect[]; gainTiles: number; score: number } | undefined {
  const rects = maybeRects.filter((rect): rect is Rect => Boolean(rect));
  if (rects.length < 2) return undefined;
  const originalArea = rectTileArea(original);
  const newArea = rects.reduce((sum, rect) => sum + rectTileArea(rect), 0);
  const gainTiles = originalArea - newArea;
  const imbalance = Math.abs(rectTileArea(rects[0]!) - rectTileArea(rects[1]!));
  const seamTiles = visibleTileCountInRect(frame, seam);
  const score = gainTiles * 100 - seamTiles * 12 - imbalance * 0.2 + (Math.max(original.width, original.height) > 64 ? 20 : 0);
  return { chunkIndex, rects, gainTiles, score };
}

function tileRoundedAlphaBoundsInRect(frame: FrameEntry, rect: Rect): Rect | undefined {
  const bounds = alphaBoundsInRect(frame, rect);
  if (!bounds) return undefined;
  const x = Math.max(0, Math.floor(bounds.x / TILE_SIZE) * TILE_SIZE);
  const y = Math.max(0, Math.floor(bounds.y / TILE_SIZE) * TILE_SIZE);
  const maxX = Math.min(frame.width, Math.ceil((bounds.x + bounds.width) / TILE_SIZE) * TILE_SIZE);
  const maxY = Math.min(frame.height, Math.ceil((bounds.y + bounds.height) / TILE_SIZE) * TILE_SIZE);
  return { x, y, width: Math.max(TILE_SIZE, maxX - x), height: Math.max(TILE_SIZE, maxY - y) };
}

function alphaBoundsInRect(frame: FrameEntry, rect: Rect): Rect | undefined {
  const startX = clampInt(rect.x, 0, frame.width);
  const startY = clampInt(rect.y, 0, frame.height);
  const endX = clampInt(rect.x + rect.width, 0, frame.width);
  const endY = clampInt(rect.y + rect.height, 0, frame.height);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if ((frame.pixels[(y * frame.width + x) * 4 + 3] ?? 0) < 128) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
}

function visibleTileCountInRect(frame: FrameEntry, rect: Rect): number {
  let count = 0;
  const rounded = {
    x: Math.max(0, Math.floor(rect.x / TILE_SIZE) * TILE_SIZE),
    y: Math.max(0, Math.floor(rect.y / TILE_SIZE) * TILE_SIZE),
    width: Math.max(TILE_SIZE, roundUp8(rect.width)),
    height: Math.max(TILE_SIZE, roundUp8(rect.height)),
  };
  for (let y = rounded.y; y < Math.min(frame.height, rounded.y + rounded.height); y += TILE_SIZE) {
    for (let x = rounded.x; x < Math.min(frame.width, rounded.x + rounded.width); x += TILE_SIZE) {
      if (tileHasAlpha(frame, x, y)) count += 1;
    }
  }
  return count;
}

function tileHasAlpha(frame: FrameEntry, x: number, y: number): boolean {
  for (let yy = y; yy < Math.min(frame.height, y + TILE_SIZE); yy += 1) {
    for (let xx = x; xx < Math.min(frame.width, x + TILE_SIZE); xx += 1) {
      if ((frame.pixels[(yy * frame.width + xx) * 4 + 3] ?? 0) >= 128) return true;
    }
  }
  return false;
}

function firstFreeAtlasPlacement(occupied: Uint8Array, width: number, height: number): { x: number; y: number } | undefined {
  for (let y = 0; y <= RIG_HEIGHT - height; y += TILE_SIZE) {
    for (let x = 0; x <= RIG_WIDTH - width; x += TILE_SIZE) {
      if (canPlaceBlock(occupied, RIG_WIDTH, x, y, width, height)) return { x, y };
    }
  }
  return undefined;
}

function rectTileArea(rect: Rect): number {
  return (rect.width / TILE_SIZE) * (rect.height / TILE_SIZE);
}

function rectOamCount(rect: Rect): number {
  const covered = new Uint8Array((rect.width / TILE_SIZE) * (rect.height / TILE_SIZE));
  let count = 0;
  for (let y = 0; y < rect.height; y += TILE_SIZE) {
    for (let x = 0; x < rect.width; x += TILE_SIZE) {
      if (isBlockCovered(covered, rect.width, x, y)) continue;
      const size = OAM_SIZES.find((candidate) =>
        candidate.width <= rect.width - x &&
        candidate.height <= rect.height - y &&
        canPlaceBlock(covered, rect.width, x, y, candidate.width, candidate.height),
      );
      if (!size) return Number.POSITIVE_INFINITY;
      markBlockCovered(covered, rect.width, x, y, size.width, size.height);
      count += 1;
    }
  }
  return count;
}

function blitPoseBlock(rig: RgbaImageData, frame: FrameEntry, sourceBounds: Rect, atlasX: number, atlasY: number, palette: RgbColor[]): void {
  for (let y = 0; y < sourceBounds.height; y += 1) {
    for (let x = 0; x < sourceBounds.width; x += 1) {
      const sourceX = sourceBounds.x + x;
      const sourceY = sourceBounds.y + y;
      const sourceOffset = (sourceY * frame.width + sourceX) * 4;
      const targetOffset = ((atlasY + y) * rig.width + atlasX + x) * 4;
      if ((frame.pixels[sourceOffset + 3] ?? 0) < 128) {
        rig.pixels.set(TRANSPARENT, targetOffset);
        continue;
      }
      const color = nearestPaletteColor({ r: frame.pixels[sourceOffset] ?? 0, g: frame.pixels[sourceOffset + 1] ?? 0, b: frame.pixels[sourceOffset + 2] ?? 0 }, palette);
      rig.pixels.set([color.r, color.g, color.b, 255], targetOffset);
    }
  }
}

function blitPoseBlockRotatedClockwise(rig: RgbaImageData, frame: FrameEntry, sourceBounds: Rect, atlasX: number, atlasY: number, palette: RgbColor[]): void {
  for (let y = 0; y < sourceBounds.height; y += 1) {
    for (let x = 0; x < sourceBounds.width; x += 1) {
      const sourceX = sourceBounds.x + x;
      const sourceY = sourceBounds.y + y;
      const sourceOffset = (sourceY * frame.width + sourceX) * 4;
      const targetX = atlasX + sourceBounds.height - 1 - y;
      const targetY = atlasY + x;
      const targetOffset = (targetY * rig.width + targetX) * 4;
      if ((frame.pixels[sourceOffset + 3] ?? 0) < 128) {
        rig.pixels.set(TRANSPARENT, targetOffset);
        continue;
      }
      const color = nearestPaletteColor({ r: frame.pixels[sourceOffset] ?? 0, g: frame.pixels[sourceOffset + 1] ?? 0, b: frame.pixels[sourceOffset + 2] ?? 0 }, palette);
      rig.pixels.set([color.r, color.g, color.b, 255], targetOffset);
    }
  }
}

function oamsForBlock(input: { atlasX: number; atlasY: number; sourceBounds: Rect; groundShiftY: number }): PackedPose["oams"] {
  const oams: PackedPose["oams"] = [];
  const covered = new Uint8Array((input.sourceBounds.width / TILE_SIZE) * (input.sourceBounds.height / TILE_SIZE));
  for (let y = 0; y < input.sourceBounds.height; y += TILE_SIZE) {
    for (let x = 0; x < input.sourceBounds.width; x += TILE_SIZE) {
      if (isBlockCovered(covered, input.sourceBounds.width, x, y)) continue;
      const size = OAM_SIZES.find((candidate) =>
        candidate.width <= input.sourceBounds.width - x &&
        candidate.height <= input.sourceBounds.height - y &&
        canPlaceBlock(covered, input.sourceBounds.width, x, y, candidate.width, candidate.height),
      );
      if (!size) throw new Error("Could not tile flipbook block into OAM rectangles");
      markBlockCovered(covered, input.sourceBounds.width, x, y, size.width, size.height);
      oams.push({
        x: input.sourceBounds.x - 48 + x,
        y: input.sourceBounds.y - 48 + y + input.groundShiftY,
        width: size.width,
        height: size.height,
        characterName: input.atlasX / TILE_SIZE + (input.atlasY / TILE_SIZE) * ATLAS_TILE_COLUMNS + x / TILE_SIZE + (y / TILE_SIZE) * ATLAS_TILE_COLUMNS,
      });
    }
  }
  return oams;
}

function oamsForStoredBlock(input: { atlasBounds: Rect; spriteX: number; spriteY: number }): PackedPose["oams"] {
  const oams: PackedPose["oams"] = [];
  const covered = new Uint8Array((input.atlasBounds.width / TILE_SIZE) * (input.atlasBounds.height / TILE_SIZE));
  for (let y = 0; y < input.atlasBounds.height; y += TILE_SIZE) {
    for (let x = 0; x < input.atlasBounds.width; x += TILE_SIZE) {
      if (isBlockCovered(covered, input.atlasBounds.width, x, y)) continue;
      const size = OAM_SIZES.find((candidate) =>
        candidate.width <= input.atlasBounds.width - x &&
        candidate.height <= input.atlasBounds.height - y &&
        canPlaceBlock(covered, input.atlasBounds.width, x, y, candidate.width, candidate.height),
      );
      if (!size) throw new Error("Could not tile stored flipbook block into OAM rectangles");
      markBlockCovered(covered, input.atlasBounds.width, x, y, size.width, size.height);
      oams.push({
        x: input.spriteX + x,
        y: -input.spriteY + y,
        width: size.width,
        height: size.height,
        characterName: input.atlasBounds.x / TILE_SIZE + (input.atlasBounds.y / TILE_SIZE) * ATLAS_TILE_COLUMNS + x / TILE_SIZE + (y / TILE_SIZE) * ATLAS_TILE_COLUMNS,
      });
    }
  }
  return oams;
}

function buildPalette(frames: FrameEntry[]): RgbColor[] {
  const colors = new Map<string, { color: RgbColor; count: number }>();
  for (const frame of frames) {
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      if ((frame.pixels[offset + 3] ?? 0) < 128) continue;
      const color = roundTripBgr555Color({ r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 });
      const key = `${color.r},${color.g},${color.b}`;
      const existing = colors.get(key);
      if (existing) existing.count += 1;
      else colors.set(key, { color, count: 1 });
    }
  }
  const opaque = Array.from(colors.values());
  const selected = opaque.length <= 15 ? opaque.map((entry) => entry.color) : medianCut(opaque.flatMap((entry) => Array.from({ length: Math.min(entry.count, 64) }, () => entry.color)), 15);
  while (selected.length < 15) selected.push(selected[selected.length - 1] ?? { r: 0, g: 0, b: 0 });
  return [{ r: 0, g: 0, b: 0 }, ...selected.slice(0, 15).map(roundTripBgr555Color)];
}

function medianCut(colors: RgbColor[], maxColors: number): RgbColor[] {
  let buckets = [colors.length ? colors : [{ r: 0, g: 0, b: 0 }]];
  while (buckets.length < maxColors) {
    buckets = buckets.sort((left, right) => colorRange(right) - colorRange(left));
    const bucket = buckets.shift();
    if (!bucket || bucket.length <= 1) {
      if (bucket) buckets.push(bucket);
      break;
    }
    const channel = widestChannel(bucket);
    bucket.sort((left, right) => left[channel] - right[channel]);
    const middle = Math.max(1, Math.floor(bucket.length / 2));
    buckets.push(bucket.slice(0, middle), bucket.slice(middle));
  }
  return buckets.map((bucket) => roundTripBgr555Color(averageColor(bucket))).slice(0, maxColors);
}

function remapFrameToPalette<T extends FrameEntry>(frame: T, palette: RgbColor[]): T {
  const pixels = new Uint8ClampedArray(frame.pixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < 128) {
      pixels.set(TRANSPARENT, offset);
      continue;
    }
    const color = nearestPaletteColor({ r: pixels[offset] ?? 0, g: pixels[offset + 1] ?? 0, b: pixels[offset + 2] ?? 0 }, palette);
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
    pixels[offset + 3] = 255;
  }
  return { ...frame, pixels };
}

function sampleKeyFrames<T extends FrameEntry>(frames: T[], maxFrames: number): T[] {
  if (maxFrames <= 0) return [];
  if (frames.length <= maxFrames) return frames;
  const selected = new Set<number>([0, frames.length - 1]);
  while (selected.size < maxFrames) {
    let best = -1;
    let bestScore = -1;
    for (let index = 0; index < frames.length; index += 1) {
      if (selected.has(index)) continue;
      const nearest = Math.min(...Array.from(selected).map((selectedIndex) => Math.abs(index - selectedIndex)));
      const previous = frames[Math.max(0, index - 1)]!;
      const score = nearest * 100000 + frameDifference(previous, frames[index]!);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best < 0) break;
    selected.add(best);
  }
  return Array.from(selected).sort((a, b) => a - b).map((index) => frames[index]!);
}

function sampleTimelineKeyFrames(frames: TimelineFrame[], maxFrames: number): TimelineFrame[] {
  return sampleKeyFrames(frames, maxFrames).map((frame, timelineIndex) => ({ ...frame, timelineIndex }));
}

function sampleEvenly<T>(frames: T[], maxFrames: number): T[] {
  if (frames.length <= maxFrames || maxFrames <= 0) return frames;
  return Array.from({ length: maxFrames }, (_, index) => frames[Math.round((index * (frames.length - 1)) / Math.max(1, maxFrames - 1))]!).filter(Boolean);
}

function extractTile(image: FrameEntry, x: number, y: number, palette: RgbColor[]): { pixels: Uint8ClampedArray; hash: string; visible: boolean } {
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
      const color = nearestPaletteColor({ r: image.pixels[sourceOffset] ?? 0, g: image.pixels[sourceOffset + 1] ?? 0, b: image.pixels[sourceOffset + 2] ?? 0 }, palette);
      pixels.set([color.r, color.g, color.b, 255], targetOffset);
    }
  }
  return { pixels, visible, hash: hashBytes(pixels) };
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

function rigCellFromPackedPose(pose: PackedPose | undefined): RigCell | undefined {
  if (!pose?.atlasBounds || pose.oams.length === 0) return undefined;
  if (pose.spriteX !== undefined && pose.spriteY !== undefined) {
    return {
      cellX: pose.atlasBounds.x,
      cellY: pose.atlasBounds.y,
      width: pose.atlasBounds.width,
      height: pose.atlasBounds.height,
      spriteX: pose.spriteX,
      spriteY: pose.spriteY,
      subCell: emptyRigSubCell(),
    };
  }
  const minX = Math.min(...pose.oams.map((oam) => oam.x));
  const minY = Math.min(...pose.oams.map((oam) => oam.y));
  return {
    cellX: pose.atlasBounds.x,
    cellY: pose.atlasBounds.y,
    width: pose.atlasBounds.width,
    height: pose.atlasBounds.height,
    spriteX: minX,
    spriteY: -minY,
    subCell: emptyRigSubCell(),
  };
}

function rigCellFromMacroChunk(chunk: MacroChunk): RigCell {
  return {
    cellX: chunk.atlasBounds.x,
    cellY: chunk.atlasBounds.y,
    width: chunk.atlasBounds.width,
    height: chunk.atlasBounds.height,
    spriteX: chunk.spriteX,
    spriteY: chunk.spriteY,
    subCell: emptyRigSubCell(),
  };
}

function transparentTileRigCell(): RigCell {
  return {
    cellX: 0,
    cellY: 0,
    width: TILE_SIZE,
    height: TILE_SIZE,
    spriteX: 0,
    spriteY: 0,
    subCell: emptyRigSubCell(),
  };
}

function tileRigCell(tileIndex: number): RigCell {
  return {
    cellX: (tileIndex % ATLAS_TILE_COLUMNS) * TILE_SIZE,
    cellY: Math.floor(tileIndex / ATLAS_TILE_COLUMNS) * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
    spriteX: 0,
    spriteY: 0,
    subCell: emptyRigSubCell(),
  };
}

function oamsForMacroChunk(chunk: MacroChunk): PackedPose["oams"] {
  const oams: PackedPose["oams"] = [];
  const covered = new Uint8Array((chunk.atlasBounds.width / TILE_SIZE) * (chunk.atlasBounds.height / TILE_SIZE));
  for (let y = 0; y < chunk.atlasBounds.height; y += TILE_SIZE) {
    for (let x = 0; x < chunk.atlasBounds.width; x += TILE_SIZE) {
      if (isBlockCovered(covered, chunk.atlasBounds.width, x, y)) continue;
      const size = OAM_SIZES.find((candidate) =>
        candidate.width <= chunk.atlasBounds.width - x &&
        candidate.height <= chunk.atlasBounds.height - y &&
        canPlaceBlock(covered, chunk.atlasBounds.width, x, y, candidate.width, candidate.height),
      );
      if (!size) throw new Error("Could not tile macro chunk into OAM rectangles");
      markBlockCovered(covered, chunk.atlasBounds.width, x, y, size.width, size.height);
      oams.push({
        x: chunk.spriteX + x,
        y: -chunk.spriteY + y,
        width: size.width,
        height: size.height,
        characterName: chunk.atlasBounds.x / TILE_SIZE + (chunk.atlasBounds.y / TILE_SIZE) * ATLAS_TILE_COLUMNS + x / TILE_SIZE + (y / TILE_SIZE) * ATLAS_TILE_COLUMNS,
      });
    }
  }
  return oams;
}

function emptyRigSubCell(): RigCell {
  return { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell };
}

function frameDifference(left: FrameEntry, right: FrameEntry): number {
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

function alphaBounds(image: FrameEntry): Rect | undefined {
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
    x: clampInt(bounds.x, 0, imageWidth - width),
    y: clampInt(bounds.y, 0, imageHeight - height),
    width,
    height,
  };
}

function cropFrame(frame: FrameEntry, crop: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      const sx = crop.x + x;
      const sy = crop.y + y;
      if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height) continue;
      const sourceOffset = (sy * frame.width + sx) * 4;
      const targetOffset = (y * SPRITE_SIZE + x) * 4;
      out.set(frame.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return out;
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

function isBlockCovered(covered: Uint8Array, width: number, x: number, y: number): boolean {
  return covered[(y / TILE_SIZE) * (width / TILE_SIZE) + x / TILE_SIZE] === 1;
}

function canPlaceBlock(covered: Uint8Array, width: number, x: number, y: number, blockWidth: number, blockHeight: number): boolean {
  for (let yy = y; yy < y + blockHeight; yy += TILE_SIZE) {
    for (let xx = x; xx < x + blockWidth; xx += TILE_SIZE) {
      if (isBlockCovered(covered, width, xx, yy)) return false;
    }
  }
  return true;
}

function markBlockCovered(covered: Uint8Array, width: number, x: number, y: number, blockWidth: number, blockHeight: number): void {
  for (let yy = y; yy < y + blockHeight; yy += TILE_SIZE) {
    for (let xx = x; xx < x + blockWidth; xx += TILE_SIZE) {
      covered[(yy / TILE_SIZE) * (width / TILE_SIZE) + xx / TILE_SIZE] = 1;
    }
  }
}

function validateVisibleTimeline(timelineFrames: PackedTimelineFrame[]): { frameCount: number; invisibleFrameCount: number } {
  return { frameCount: timelineFrames.length, invisibleFrameCount: timelineFrames.filter((frame) => frame.visibleTileCount <= 0).length };
}

function groundClampShiftY(frames: FrameEntry[]): number {
  const maxBottom = Math.max(
    -Infinity,
    ...frames.map((frame) => {
      const bounds = alphaBounds(frame);
      return bounds ? bounds.y + bounds.height - 1 - 48 : -Infinity;
    }),
  );
  return Number.isFinite(maxBottom) ? Math.min(0, MAX_GROUND_BOTTOM_Y - maxBottom) : 0;
}

function validateGroundLimit(frames: FrameEntry[], groundShiftY: number): { maxAllowedBottomY: number; maxVisibleBottomY: number; appliedShiftY: number } {
  const maxBottom = Math.max(
    -Infinity,
    ...frames.map((frame) => {
      const bounds = alphaBounds(frame);
      return bounds ? bounds.y + bounds.height - 1 - 48 + groundShiftY : -Infinity;
    }),
  );
  return {
    maxAllowedBottomY: MAX_GROUND_BOTTOM_Y,
    maxVisibleBottomY: Number.isFinite(maxBottom) ? maxBottom : -Infinity,
    appliedShiftY: groundShiftY,
  };
}

function nearestPaletteColor(color: RgbColor, palette: RgbColor[]): RgbColor {
  let best = palette[1] ?? palette[0] ?? color;
  let bestDistance = Infinity;
  for (const candidate of palette.slice(1)) {
    const distance = (candidate.r - color.r) ** 2 + (candidate.g - color.g) ** 2 + (candidate.b - color.b) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function roundTripBgr555Color(color: RgbColor): RgbColor {
  const r = Math.min(31, Math.ceil(clamp(color.r, 0, 255) / 8.25));
  const g = Math.min(31, Math.ceil(clamp(color.g, 0, 255) / 8.25));
  const b = Math.min(31, Math.ceil(clamp(color.b, 0, 255) / 8.25));
  return { r: Math.floor(r * 8.25), g: Math.floor(g * 8.25), b: Math.floor(b * 8.25) };
}

function unionBounds(boxes: Rect[]): Rect | undefined {
  if (boxes.length === 0) return undefined;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function colorRange(colors: RgbColor[]): number {
  return Math.max(range(colors, "r"), range(colors, "g"), range(colors, "b"));
}

function widestChannel(colors: RgbColor[]): "r" | "g" | "b" {
  const ranges = { r: range(colors, "r"), g: range(colors, "g"), b: range(colors, "b") };
  return ranges.r >= ranges.g && ranges.r >= ranges.b ? "r" : ranges.g >= ranges.b ? "g" : "b";
}

function range(colors: RgbColor[], channel: "r" | "g" | "b"): number {
  return Math.max(...colors.map((color) => color[channel])) - Math.min(...colors.map((color) => color[channel]));
}

function averageColor(colors: RgbColor[]): RgbColor {
  const count = Math.max(1, colors.length);
  return {
    r: Math.round(colors.reduce((sum, color) => sum + color.r, 0) / count),
    g: Math.round(colors.reduce((sum, color) => sum + color.g, 0) / count),
    b: Math.round(colors.reduce((sum, color) => sum + color.b, 0) / count),
  };
}

function blitPatch(canvas: Uint8ClampedArray, width: number, height: number, patch: Uint8ClampedArray, dims: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      const source = (y * dims.width + x) * 4;
      if ((patch[source + 3] ?? 0) === 0) continue;
      const tx = dims.left + x;
      const ty = dims.top + y;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      canvas.set(patch.subarray(source, source + 4), (ty * width + tx) * 4);
    }
  }
}

function clearRect(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, boxWidth: number, boxHeight: number): void {
  for (let py = y; py < y + boxHeight; py += 1) {
    for (let px = x; px < x + boxWidth; px += 1) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      pixels.fill(0, (py * width + px) * 4, (py * width + px) * 4 + 4);
    }
  }
}

function frameToImage(frame: FrameEntry): RgbaImageData {
  return { width: frame.width, height: frame.height, pixels: frame.pixels };
}

function emptyImage(width: number, height: number): RgbaImageData {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function gifDelayToAnimDuration(delayMs: number, durationScale = 1): number {
  return clampInt(Math.round((delayMs / 16.67) * durationScale), 1, 0xffff);
}

function roundUp8(value: number): number {
  return Math.max(8, Math.ceil(value / 8) * 8);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashBytes(bytes: Uint8ClampedArray): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function shouldCompress(fileIndex: PokemonAnimationBundleFileIndex): boolean {
  return fileIndex === 5 || fileIndex === 14;
}
