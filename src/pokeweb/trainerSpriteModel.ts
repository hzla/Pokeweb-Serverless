import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { isGen5Project, type NarcName } from "./constants";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, type ProjectState } from "./projectStore";
import { parseNitroPalette, type NitroPaletteData } from "./nitroBg";
import {
  compressLz11Literal,
  decompressNitro,
  parsePokemonAnimation,
  parsePokemonMultiCells,
  parseRigCells,
  type PokemonAnimationFrame,
  type PokemonAnimationSequence,
  type PokemonMultiCell,
  type PokemonMultiCellNode,
  type RgbColor,
  type RgbaImageData,
  type RigCell,
} from "./pokemonSpriteModel";
import {
  buildPokemonAnimationFile,
  buildPokemonMultiCellAnimationFile,
  parsePokemonAnimationBundle,
} from "./pokemonSpriteWriters";
import {
  buildPokemonFlipbookRigFromGif,
  defaultPokemonFlipbookImportConfig,
  pokemonFlipbookGifLoopInfo,
  type PokemonFlipbookImportConfig,
  type PokemonFlipbookPackingMode,
  type PokemonFlipbookReport,
  type PokemonFlipbookSamplingStrategy,
} from "./pokemonFlipbookRig";

const TRAINER_SPRITE_NARC_NAME = "trainer_sprites" satisfies NarcName;
const TRAINER_SPRITE_FILES_PER_ENTRY = 8;
const TRAINER_SPRITE_BITMAP_FILE = 1;
const TRAINER_SPRITE_ANIMATION_FILE = 3;
const TRAINER_SPRITE_MULTI_CELL_FILE = 4;
const TRAINER_SPRITE_MULTI_CELL_ANIMATION_FILE = 5;
const TRAINER_SPRITE_NCEC_FILE = 6;
const TRAINER_SPRITE_PALETTE_FILE = 7;
const TRAINER_SPRITE_CANVAS_WIDTH = 256;
const TRAINER_SPRITE_CANVAS_HEIGHT = 256;
const GX_OBJVRAMMODE_CHAR_2D = 0x000000;
const BW2_PWT_TRAINER_CLASS_FIRST = 112;
const BW2_PWT_TRAINER_CLASS_LAST = 204;
const BW2_PWT_GRAPHIC_FIRST = 94;
export const TRAINER_SPRITE_FILE_FORMATS = ["NCGR", "NCBR", "NCER", "NANR", "NMCR", "NMAR", "NCEC", "NCLR"] as const;
const BW2_TRAINER_CLASS_GRAPHIC_INDEX = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 40, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
  63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 71, 4, 70,
  74, 75, 69, 42, 41, 91, 40, 92, 93, 94,
];

export type TrainerSpriteAnimationFrame = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type TrainerClassSpriteAnimation = {
  trainerClassId: number;
  graphicIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  frames: TrainerSpriteAnimationFrame[];
  totalTicks: number;
  cellSequenceCount: number;
  multiCellCount: number;
  outerKeyFrameCount: number;
};

export type TrainerSpriteGifPlaybackMode = "auto" | "loop" | "once";

export type TrainerSpriteGifConfig = {
  strategy: PokemonFlipbookSamplingStrategy;
  packingMode: PokemonFlipbookPackingMode;
  sourceFramePercent: number;
  maxUniqueFrames: number;
  manualFrameNumbers?: number[];
  restLoopCount: "auto" | 1 | 2 | 3;
  includeFinish: boolean;
  durationScale: number;
  downscalePercent: number;
  outputScalePercent: number;
  playbackMode: TrainerSpriteGifPlaybackMode;
};

export type TrainerSpriteGifBuild = {
  trainerClassId: number;
  graphicIndex: number;
  affectedClassIds: number[];
  files: Uint8Array[];
  palette: RgbColor[];
  rigAtlas: RgbaImageData;
  animation: TrainerClassSpriteAnimation;
  report: PokemonFlipbookReport & {
    playbackMode: "loop" | "once";
    sourceLoopKind: "none" | "infinite" | "finite";
    sourceLoopCount: number;
    appliedLoopCount: number;
    totalTicks: number;
  };
};

type TrainerCharacterLayout = {
  bitDepth: 4 | 8;
  bitmapType: boolean;
  dataOffset: number;
  dataSize: number;
  height: number;
  mappingMode: number;
  tileCount: number;
  tilesHigh: number;
  tilesWide: number;
  width: number;
};

export function hasGen5TrainerSprites(project: ProjectState): boolean {
  return isGen5Project(project);
}

export async function ensureTrainerSpriteStore(project: ProjectState): Promise<boolean> {
  if (!hasGen5TrainerSprites(project)) return false;
  const existing = project.narcs.trainer_sprites;
  if (existing?.rawFiles.some((file) => file.length > 0)) return true;

  const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!bytes) return false;

  const path = trainerSpriteNarcPath(project);
  if (!path) return false;
  const rom = new NintendoDSRom(bytes);
  const fileId = rom.fileId(path);
  project.session.fileIds[TRAINER_SPRITE_NARC_NAME] = fileId;
  project.session.blacklist = project.session.blacklist.filter((name) => name !== TRAINER_SPRITE_NARC_NAME);
  project.narcs.trainer_sprites = createNarcStore(TRAINER_SPRITE_NARC_NAME, path, fileId, new NARC(rom.files[fileId]));
  return true;
}

export function defaultTrainerSpriteGifConfig(): TrainerSpriteGifConfig {
  const defaults = defaultPokemonFlipbookImportConfig("front");
  return {
    strategy: "even",
    packingMode: "rotated-pose-blocks",
    sourceFramePercent: defaults.sourceFramePercent,
    maxUniqueFrames: defaults.maxUniqueFrames,
    restLoopCount: defaults.restLoopCount,
    includeFinish: defaults.includeFinish,
    durationScale: defaults.durationScale,
    downscalePercent: defaults.downscalePercent,
    outputScalePercent: defaults.outputScalePercent,
    playbackMode: "auto",
  };
}

export function buildTrainerSpriteGifPreview(
  project: ProjectState,
  trainerClassId: number,
  gifBytes: Uint8Array,
  config: TrainerSpriteGifConfig = defaultTrainerSpriteGifConfig(),
): TrainerSpriteGifBuild {
  const targetFiles = trainerClassSpriteFiles(project, trainerClassId);
  const graphicIndex = trainerClassGraphicIndex(project, trainerClassId);
  const staticLayout = trainerCharacterLayout(decompressNitroIfNeeded(targetFiles[0]), "NCGR");
  const atlasLayout = trainerCharacterLayout(decompressNitroIfNeeded(targetFiles[TRAINER_SPRITE_BITMAP_FILE]), "NCBR");
  validateTrainerGifTarget(staticLayout, atlasLayout);

  const flipbookConfig: PokemonFlipbookImportConfig = {
    ...defaultPokemonFlipbookImportConfig("front"),
    ...config,
    side: "front",
    atlasWidth: atlasLayout.width,
    atlasHeight: atlasLayout.height,
    maxAtlasTiles: atlasLayout.tileCount,
  };
  const flipbook = buildPokemonFlipbookRigFromGif(gifBytes, flipbookConfig);
  const animationBundle = parsePokemonAnimationBundle(flipbook.bundle);
  const ncer = requiredAnimationBundleFile(animationBundle.files[4], "NCER");
  const sourceNanr = requiredAnimationBundleFile(animationBundle.files[5], "NANR");
  const nmcr = requiredAnimationBundleFile(animationBundle.files[6], "NMCR");
  const ncec = requiredAnimationBundleFile(animationBundle.files[8], "NCEC");
  const loopInfo = pokemonFlipbookGifLoopInfo(gifBytes);
  const playbackMode = config.playbackMode === "auto" ? (loopInfo.kind === "infinite" ? "loop" : "once") : config.playbackMode;
  const appliedLoopCount = config.playbackMode === "auto" && loopInfo.kind === "finite" ? loopInfo.count : 1;
  if (appliedLoopCount > 32) throw new Error(`GIF requests ${appliedLoopCount} loops; native trainer import supports at most 32 finite loops`);
  const sequenceMode = playbackMode === "loop" ? 2 : 1;
  const parsedNanr = parsePokemonAnimation(decompressNitroIfNeeded(sourceNanr));
  const nanrSequences = parsedNanr.sequences.map((sequence) => ({
    ...sequence,
    mode: sequenceMode,
    frames: repeatAnimationFrames(sequence.frames, Math.max(1, appliedLoopCount)),
  }));
  const nanr = buildPokemonAnimationFile(nanrSequences);
  const totalTicks = Math.max(1, ...nanrSequences.map((sequence) => sequence.frames.reduce((sum, frame) => sum + Math.max(1, frame.duration), 0)));
  const nmar = buildPokemonMultiCellAnimationFile(totalTicks, sequenceMode);
  const palette = flipbook.palette;

  const rawFiles = [
    encodeTrainerCharacterImage(decompressNitroIfNeeded(targetFiles[0]), fitImageToCanvas(flipbook.sprite, staticLayout.width, staticLayout.height), palette, "NCGR"),
    encodeTrainerCharacterImage(decompressNitroIfNeeded(targetFiles[1]), flipbook.rig, palette, "NCBR"),
    ncer,
    nanr,
    nmcr,
    nmar,
    ncec,
    encodeTrainerPalette(decompressNitroIfNeeded(targetFiles[7]), palette),
  ];
  const files = rawFiles.map((file, index) => preserveNitroCompression(targetFiles[index], file));
  const animation = trainerClassSpriteAnimationFromFiles(files, trainerClassId, graphicIndex);
  const rigAtlas = trainerRigAtlasFromFiles(files);
  const warnings = [...flipbook.report.warnings];
  if (loopInfo.kind === "finite" && appliedLoopCount > 1) warnings.push(`Expanded the native timeline to preserve ${appliedLoopCount} GIF loops`);
  return {
    trainerClassId,
    graphicIndex,
    affectedClassIds: trainerClassIdsForGraphic(project, graphicIndex),
    files,
    palette,
    rigAtlas,
    animation,
    report: {
      ...flipbook.report,
      warnings,
      playbackMode,
      sourceLoopKind: loopInfo.kind,
      sourceLoopCount: loopInfo.count,
      appliedLoopCount,
      totalTicks: animation.totalTicks,
    },
  };
}

export function applyTrainerSpriteGifBuild(project: ProjectState, build: TrainerSpriteGifBuild): void {
  const store = project.narcs.trainer_sprites;
  if (!store) throw new Error("Trainer sprite NARC is not loaded");
  const expectedGraphicIndex = trainerClassGraphicIndex(project, build.trainerClassId);
  if (expectedGraphicIndex !== build.graphicIndex) throw new Error("Trainer class graphic mapping changed after the GIF preview was generated");
  if (build.files.length !== TRAINER_SPRITE_FILES_PER_ENTRY) throw new Error("Trainer GIF build does not contain all eight native files");
  const start = build.graphicIndex * TRAINER_SPRITE_FILES_PER_ENTRY;
  build.files.forEach((file, index) => {
    store.rawFiles[start + index] = file.slice();
    store.dirty.add(start + index);
  });
  recordGenericChange(
    project,
    "trainer_sprites",
    `Trainer graphic ${build.graphicIndex} was replaced from a GIF (${build.report.uniquePoseCount} poses, ${build.report.totalTicks} ticks).`,
    trainerSpriteSubject(project, build),
    { key: `trainer-sprite-gif:${build.graphicIndex}` },
  );
}

export function getTrainerClassIdsSharingGraphic(project: ProjectState, trainerClassId: number): number[] {
  return trainerClassIdsForGraphic(project, trainerClassGraphicIndex(project, trainerClassId));
}

export function getTrainerClassSpriteImage(project: ProjectState, trainerClassId: number): RgbaImageData {
  const frame = representativeFrame(getTrainerClassSpriteAnimation(project, trainerClassId).frames);
  if (!frame) throw new Error(`Trainer class ${trainerClassId} has no renderable sprite frame`);
  return { width: frame.width, height: frame.height, pixels: frame.rgba };
}

export function getTrainerClassRigAtlas(project: ProjectState, trainerClassId: number): RgbaImageData {
  return trainerRigAtlasFromFiles(trainerClassSpriteFiles(project, trainerClassId));
}

export function getTrainerClassSpriteAnimation(project: ProjectState, trainerClassId: number): TrainerClassSpriteAnimation {
  const files = trainerClassSpriteFiles(project, trainerClassId);
  return trainerClassSpriteAnimationFromFiles(files, trainerClassId, trainerClassGraphicIndex(project, trainerClassId));
}

function trainerClassSpriteAnimationFromFiles(files: Uint8Array[], trainerClassId: number, graphicIndex: number): TrainerClassSpriteAnimation {
  const palette = parseNitroPalette(decompressNitroIfNeeded(files[TRAINER_SPRITE_PALETTE_FILE]));
  const texture = decodeTrainerMcssTexture(decompressNitroIfNeeded(files[TRAINER_SPRITE_BITMAP_FILE]), palette);
  const ncecCells = parseRigCells(decompressNitroIfNeeded(files[TRAINER_SPRITE_NCEC_FILE])).cells;
  const animation = parsePokemonAnimation(decompressNitroIfNeeded(files[TRAINER_SPRITE_ANIMATION_FILE]));
  const multiCells = parsePokemonMultiCells(decompressNitroIfNeeded(files[TRAINER_SPRITE_MULTI_CELL_FILE])).cells;
  const multiCellAnimation = parsePokemonAnimation(
    decompressNitroIfNeeded(files[TRAINER_SPRITE_MULTI_CELL_ANIMATION_FILE]),
    "front",
    "RAMN",
    "Multi-cell animation",
  );
  const outerSequence = multiCellAnimation.sequences[0];
  const frames = renderTrainerMcssFrames(texture, ncecCells, animation.sequences, multiCells, outerSequence);
  if (frames.length === 0) throw new Error(`Trainer class ${trainerClassId} has no renderable sprite frames`);
  return {
    trainerClassId,
    graphicIndex,
    canvasWidth: TRAINER_SPRITE_CANVAS_WIDTH,
    canvasHeight: TRAINER_SPRITE_CANVAS_HEIGHT,
    frames,
    totalTicks: frames.length,
    cellSequenceCount: animation.sequences.length,
    multiCellCount: multiCells.length,
    outerKeyFrameCount: outerSequence?.frames.length ?? 0,
  };
}

function trainerRigAtlasFromFiles(files: Uint8Array[]): RgbaImageData {
  const palette = parseNitroPalette(decompressNitroIfNeeded(files[TRAINER_SPRITE_PALETTE_FILE]));
  return decodeTrainerMcssTexture(decompressNitroIfNeeded(files[TRAINER_SPRITE_BITMAP_FILE]), palette);
}

function decodeTrainerMcssTexture(bytes: Uint8Array, palette: NitroPaletteData): RgbaImageData {
  const layout = trainerCharacterLayout(bytes, "NCBR");
  const { bitDepth, bitmapType, dataOffset, dataSize, height, tileCount, tilesWide, width } = layout;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (bitmapType) drawTrainerBitmapTexture(rgba, width, height, bytes, dataOffset, dataSize, bitDepth, palette);
  else drawTrainerCharacterTexture(rgba, width, bytes, dataOffset, dataSize, bitDepth, palette, tilesWide, tileCount);
  return { width, height, pixels: rgba };
}

function trainerCharacterLayout(bytes: Uint8Array, label: "NCGR" | "NCBR"): TrainerCharacterLayout {
  if (readAscii(bytes, 0, 4) !== "RGCN") throw new Error(`Trainer ${label} character file has an unsupported stamp`);
  const blockOffset = findRawBlock(bytes, "RAHC");
  if (blockOffset < 0) throw new Error(`Trainer ${label} character file is missing the RAHC block`);
  const contentOffset = blockOffset + 8;
  let tilesHigh = readU16(bytes, contentOffset);
  let tilesWide = readU16(bytes, contentOffset + 2);
  const bitDepthValue = 1 << (readU32(bytes, contentOffset + 4) - 1);
  if (bitDepthValue !== 4 && bitDepthValue !== 8) throw new Error(`Trainer ${label} uses unsupported ${bitDepthValue}bpp character data`);
  const bitDepth = bitDepthValue as 4 | 8;
  const mappingMode = readU32(bytes, contentOffset + 8);
  const bitmapType = readU32(bytes, contentOffset + 0x0c) === 1;
  const dataSize = readU32(bytes, contentOffset + 0x10);
  const dataOffset = contentOffset + readU32(bytes, contentOffset + 0x14);
  const bytesPerTile = bitDepth === 8 ? 64 : 32;
  const presentTileCount = Math.max(1, Math.floor(dataSize / bytesPerTile));
  let tileCount = Math.max(1, tilesWide * tilesHigh);
  if (mappingMode !== GX_OBJVRAMMODE_CHAR_2D || tileCount !== presentTileCount) {
    tileCount = presentTileCount;
    tilesWide = guessNitroTileSheetWidth(tileCount);
    tilesHigh = Math.max(1, Math.floor(tileCount / tilesWide));
  }
  if (dataOffset < 0 || dataSize <= 0 || dataOffset + dataSize > bytes.length) throw new Error(`Trainer ${label} character payload is truncated`);
  return {
    bitDepth,
    bitmapType,
    dataOffset,
    dataSize,
    height: Math.max(8, tilesHigh * 8),
    mappingMode,
    tileCount,
    tilesHigh,
    tilesWide,
    width: Math.max(8, tilesWide * 8),
  };
}

function drawTrainerBitmapTexture(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bytes: Uint8Array,
  dataOffset: number,
  dataSize: number,
  bitDepth: 4 | 8,
  palette: NitroPaletteData,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const packedOffset = bitDepth === 8 ? dataOffset + y * width + x : dataOffset + y * (width / 2) + Math.floor(x / 2);
      if (packedOffset >= dataOffset + dataSize || packedOffset >= bytes.length) return;
      const packed = bytes[packedOffset] ?? 0;
      const colorIndex = bitDepth === 8 ? packed : x % 2 === 0 ? packed & 0x0f : packed >>> 4;
      setTrainerTexturePixel(rgba, width, x, y, colorIndex, palette);
    }
  }
}

function drawTrainerCharacterTexture(
  rgba: Uint8ClampedArray,
  width: number,
  bytes: Uint8Array,
  dataOffset: number,
  dataSize: number,
  bitDepth: 4 | 8,
  palette: NitroPaletteData,
  tilesWide: number,
  tileCount: number,
): void {
  const bytesPerTile = bitDepth === 8 ? 64 : 32;
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = tile % tilesWide;
    const tileY = Math.floor(tile / tilesWide);
    const tileOffset = dataOffset + tile * bytesPerTile;
    if (tileOffset >= dataOffset + dataSize || tileOffset >= bytes.length) return;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const packedOffset = bitDepth === 8 ? tileOffset + y * 8 + x : tileOffset + y * 4 + Math.floor(x / 2);
        if (packedOffset >= dataOffset + dataSize || packedOffset >= bytes.length) continue;
        const packed = bytes[packedOffset] ?? 0;
        const colorIndex = bitDepth === 8 ? packed : x % 2 === 0 ? packed & 0x0f : packed >>> 4;
        setTrainerTexturePixel(rgba, width, tileX * 8 + x, tileY * 8 + y, colorIndex, palette);
      }
    }
  }
}

function setTrainerTexturePixel(rgba: Uint8ClampedArray, width: number, x: number, y: number, colorIndex: number, palette: NitroPaletteData): void {
  if (colorIndex === 0) return;
  const color = palette[colorIndex] ?? [0, 0, 0, 0];
  if (color[3] === 0) return;
  const offset = (y * width + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = color[3];
}

function validateTrainerGifTarget(staticLayout: TrainerCharacterLayout, atlasLayout: TrainerCharacterLayout): void {
  if (staticLayout.bitDepth !== 4 || atlasLayout.bitDepth !== 4) throw new Error("Trainer GIF import currently supports native 4bpp trainer graphics only");
  if (atlasLayout.width !== 256 || (atlasLayout.height !== 128 && atlasLayout.height !== 256)) {
    throw new Error(`Trainer GIF import requires a 256x128 or 256x256 NCBR atlas; target is ${atlasLayout.width}x${atlasLayout.height}`);
  }
  if (staticLayout.width % 8 !== 0 || staticLayout.height % 8 !== 0) throw new Error("Trainer NCGR dimensions must be aligned to 8px tiles");
}

function requiredAnimationBundleFile(file: Uint8Array | undefined, label: string): Uint8Array {
  if (!file || file.length === 0) throw new Error(`Generated trainer animation is missing ${label}`);
  return file;
}

function repeatAnimationFrames(frames: PokemonAnimationFrame[], count: number): PokemonAnimationFrame[] {
  return Array.from({ length: count }, () => frames.map((frame) => ({ ...frame }))).flat();
}

function fitImageToCanvas(image: RgbaImageData, width: number, height: number): RgbaImageData {
  if (image.width === width && image.height === height) return image;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const sourceX = Math.max(0, Math.floor((image.width - width) / 2));
  const sourceY = Math.max(0, Math.floor((image.height - height) / 2));
  const targetX = Math.max(0, Math.floor((width - image.width) / 2));
  const targetY = Math.max(0, Math.floor((height - image.height) / 2));
  const copyWidth = Math.min(width, image.width);
  const copyHeight = Math.min(height, image.height);
  for (let y = 0; y < copyHeight; y += 1) {
    const sourceStart = ((sourceY + y) * image.width + sourceX) * 4;
    const targetStart = ((targetY + y) * width + targetX) * 4;
    pixels.set(image.pixels.subarray(sourceStart, sourceStart + copyWidth * 4), targetStart);
  }
  return { width, height, pixels };
}

function encodeTrainerCharacterImage(targetRaw: Uint8Array, sourceImage: RgbaImageData, palette: RgbColor[], label: "NCGR" | "NCBR"): Uint8Array {
  const layout = trainerCharacterLayout(targetRaw, label);
  if (layout.bitDepth !== 4) throw new Error(`Trainer ${label} GIF encoding currently supports 4bpp targets only`);
  const image = fitImageToCanvas(sourceImage, layout.width, layout.height);
  const out = targetRaw.slice();
  out.fill(0, layout.dataOffset, layout.dataOffset + layout.dataSize);
  if (layout.bitmapType) {
    for (let y = 0; y < layout.height; y += 1) {
      for (let x = 0; x < layout.width; x += 1) {
        writeTrainer4bppPixel(out, layout.dataOffset + y * (layout.width / 2) + Math.floor(x / 2), x, paletteIndexForPixel(image, x, y, palette));
      }
    }
    return out;
  }
  for (let tile = 0; tile < layout.tileCount; tile += 1) {
    const tileX = tile % layout.tilesWide;
    const tileY = Math.floor(tile / layout.tilesWide);
    const tileOffset = layout.dataOffset + tile * 32;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        writeTrainer4bppPixel(out, tileOffset + y * 4 + Math.floor(x / 2), x, paletteIndexForPixel(image, tileX * 8 + x, tileY * 8 + y, palette));
      }
    }
  }
  return out;
}

function writeTrainer4bppPixel(out: Uint8Array, offset: number, x: number, colorIndex: number): void {
  if (offset < 0 || offset >= out.length) return;
  out[offset] = x % 2 === 0 ? (out[offset] & 0xf0) | colorIndex : (out[offset] & 0x0f) | (colorIndex << 4);
}

function paletteIndexForPixel(image: RgbaImageData, x: number, y: number, palette: RgbColor[]): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
  const offset = (y * image.width + x) * 4;
  if ((image.pixels[offset + 3] ?? 0) < 128) return 0;
  const color = { r: image.pixels[offset] ?? 0, g: image.pixels[offset + 1] ?? 0, b: image.pixels[offset + 2] ?? 0 };
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < Math.min(16, palette.length); index += 1) {
    const candidate = palette[index] ?? { r: 0, g: 0, b: 0 };
    const distance = (candidate.r - color.r) ** 2 + (candidate.g - color.g) ** 2 + (candidate.b - color.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function encodeTrainerPalette(targetRaw: Uint8Array, palette: RgbColor[]): Uint8Array {
  if (readAscii(targetRaw, 0, 4) !== "RLCN") throw new Error("Trainer NCLR palette file has an unsupported stamp");
  const blockOffset = findRawBlock(targetRaw, "TTLP");
  if (blockOffset < 0) throw new Error("Trainer NCLR palette file is missing the TTLP block");
  const dataSize = readU32(targetRaw, blockOffset + 16);
  const dataOffset = blockOffset + 24;
  if (dataSize < 32 || dataOffset + 32 > targetRaw.length) throw new Error("Trainer NCLR palette does not contain a complete 16-color bank");
  const out = targetRaw.slice();
  for (let index = 0; index < 16; index += 1) writeU16(out, dataOffset + index * 2, rgbToBgr555(palette[index] ?? { r: 0, g: 0, b: 0 }));
  return out;
}

function rgbToBgr555(color: RgbColor): number {
  const r = Math.min(31, Math.ceil(clampByte(color.r) / 8.25));
  const g = Math.min(31, Math.ceil(clampByte(color.g) / 8.25));
  const b = Math.min(31, Math.ceil(clampByte(color.b) / 8.25));
  return r | (g << 5) | (b << 10);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function preserveNitroCompression(target: Uint8Array, raw: Uint8Array): Uint8Array {
  if (target[0] === 0x11) return compressLz11Literal(raw);
  if (target[0] === 0x10) return compressLz10Literal(raw);
  return raw;
}

function compressLz10Literal(data: Uint8Array): Uint8Array {
  if (data.length >= 0x1000000) throw new Error("LZ10 literal encoder only supports files smaller than 16 MiB");
  const groups = Math.ceil(data.length / 8);
  const out = new Uint8Array(4 + groups + data.length);
  out[0] = 0x10;
  out[1] = data.length & 0xff;
  out[2] = (data.length >>> 8) & 0xff;
  out[3] = (data.length >>> 16) & 0xff;
  let source = 0;
  let targetOffset = 4;
  while (source < data.length) {
    out[targetOffset++] = 0;
    const count = Math.min(8, data.length - source);
    out.set(data.subarray(source, source + count), targetOffset);
    source += count;
    targetOffset += count;
  }
  return out;
}

function renderTrainerMcssFrames(
  texture: RgbaImageData,
  ncecCells: RigCell[],
  animationSequences: PokemonAnimationSequence[],
  multiCells: PokemonMultiCell[],
  outerSequence: PokemonAnimationSequence | undefined,
): TrainerSpriteAnimationFrame[] {
  const sequenceFrames = outerSequence?.frames.length ? outerSequence.frames : [neutralAnimationFrame(0)];
  const frames: TrainerSpriteAnimationFrame[] = [];
  let frameStartTick = 0;
  for (const outerFrame of sequenceFrames) {
    const duration = Math.max(1, outerFrame.duration || 1);
    for (let tickOffset = 0; tickOffset < duration; tickOffset += 1) {
      frames.push(renderTrainerMcssFrame(texture, ncecCells, animationSequences, multiCells, outerFrame, frameStartTick, frameStartTick + tickOffset, frames.length));
    }
    frameStartTick += duration;
  }
  return frames;
}

function renderTrainerMcssFrame(
  texture: RgbaImageData,
  ncecCells: RigCell[],
  animationSequences: PokemonAnimationSequence[],
  multiCells: PokemonMultiCell[],
  outerFrame: PokemonAnimationFrame,
  frameStartTick: number,
  playbackTick: number,
  index: number,
): TrainerSpriteAnimationFrame {
  const rgba = new Uint8ClampedArray(TRAINER_SPRITE_CANVAS_WIDTH * TRAINER_SPRITE_CANVAS_HEIGHT * 4);
  const multiCell = multiCells[outerFrame.cellIndex] ?? multiCells[0];
  if (!multiCell) return { index, x: 0, y: 0, width: 1, height: 1, rgba: new Uint8ClampedArray(4) };
  for (let nodeIndex = multiCell.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const node = multiCell.nodes[nodeIndex];
    if (!node.visible) continue;
    renderTrainerMcssNode(rgba, texture, ncecCells, animationSequences, node, outerFrame, playbackTick, frameStartTick);
  }
  const cropped = cropTransparentRgba(rgba, TRAINER_SPRITE_CANVAS_WIDTH, TRAINER_SPRITE_CANVAS_HEIGHT);
  return { index, x: cropped.x, y: cropped.y, width: cropped.width, height: cropped.height, rgba: cropped.rgba };
}

function renderTrainerMcssNode(
  target: Uint8ClampedArray,
  texture: RgbaImageData,
  ncecCells: RigCell[],
  animationSequences: PokemonAnimationSequence[],
  node: PokemonMultiCellNode,
  outerFrame: PokemonAnimationFrame,
  playbackTick: number,
  frameStartTick: number,
): void {
  const sequence = animationSequences[node.sequenceNumber];
  const frame = sequence ? animationFrameAtPlayerTick(sequence, nodePlaybackTick(node, playbackTick, frameStartTick)) : undefined;
  const cell = frame ? ncecCells[frame.cellIndex] : undefined;
  if (!frame || !cell) return;
  const baseX = TRAINER_SPRITE_CANVAS_WIDTH / 2 + outerFrame.x + node.x + frame.x;
  const baseY = TRAINER_SPRITE_CANVAS_HEIGHT / 2 + outerFrame.y + node.y + frame.y;
  drawMcssCellPart(target, texture, cell, baseX, baseY, frame);
  if (cell.subCell.width > 0 && cell.subCell.height > 0) drawMcssCellPart(target, texture, cell.subCell, baseX, baseY, frame);
}

function drawMcssCellPart(
  target: Uint8ClampedArray,
  texture: RgbaImageData,
  cell: RigCell,
  baseX: number,
  baseY: number,
  frame: PokemonAnimationFrame,
): void {
  if (cell.width <= 0 || cell.height <= 0) return;
  const radians = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaleX = Number.isFinite(frame.xScale) ? frame.xScale : 1;
  const scaleY = Number.isFinite(frame.yScale) ? frame.yScale : 1;
  const sourceX = Math.round(cell.cellX);
  const sourceY = Math.round(cell.cellY);
  const sourceWidth = Math.round(cell.width);
  const sourceHeight = Math.round(cell.height);
  const localX = cell.spriteX;
  const localY = -cell.spriteY;
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const sx = sourceX + x;
      const sy = sourceY + y;
      if (sx < 0 || sy < 0 || sx >= texture.width || sy >= texture.height) continue;
      const sourceOffset = (sy * texture.width + sx) * 4;
      if ((texture.pixels[sourceOffset + 3] ?? 0) === 0) continue;
      const scaledX = (localX + x) * scaleX;
      const scaledY = (localY + y) * scaleY;
      const dx = Math.round(baseX + scaledX * cos - scaledY * sin);
      const dy = Math.round(baseY + scaledX * sin + scaledY * cos);
      if (dx < 0 || dy < 0 || dx >= TRAINER_SPRITE_CANVAS_WIDTH || dy >= TRAINER_SPRITE_CANVAS_HEIGHT) continue;
      target.set(texture.pixels.subarray(sourceOffset, sourceOffset + 4), (dy * TRAINER_SPRITE_CANVAS_WIDTH + dx) * 4);
    }
  }
}

function representativeFrame(frames: TrainerSpriteAnimationFrame[]): TrainerSpriteAnimationFrame | undefined {
  return mostVisibleFrame(frames);
}

function mostVisibleFrame(frames: TrainerSpriteAnimationFrame[]): TrainerSpriteAnimationFrame | undefined {
  let best = frames[0];
  let bestOpaquePixels = best ? opaquePixelCount(best.rgba) : -1;
  for (const frame of frames.slice(1)) {
    const opaquePixels = opaquePixelCount(frame.rgba);
    if (opaquePixels > bestOpaquePixels) {
      best = frame;
      bestOpaquePixels = opaquePixels;
    }
  }
  return best;
}

function opaquePixelCount(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] > 0) count += 1;
  }
  return count;
}

function guessNitroTileSheetWidth(tileCount: number): number {
  if (tileCount <= 0) return 1;
  if (tileCount % 32 === 0) return 32;
  let width = 1;
  for (let factor = 1; factor < tileCount && factor * factor <= tileCount; factor += 1) {
    if (tileCount % factor === 0) width = factor;
  }
  const height = tileCount / width;
  return width > height ? width : height;
}

function neutralAnimationFrame(cellIndex: number): PokemonAnimationFrame {
  return {
    duration: 1,
    cellIndex,
    x: 0,
    y: 0,
    rotation: 0,
    xScale: 1,
    yScale: 1,
    frameType: "index",
    valueOffset: 0,
    sequenceFrameOffset: 0,
  };
}

function nodePlaybackTick(node: PokemonMultiCellNode, playbackTick: number, frameStartTick: number): number {
  if (node.playMode === 1) return playbackTick;
  if (node.playMode === 2) return 0;
  return Math.max(0, playbackTick - frameStartTick);
}

function animationFrameAtPlayerTick(sequence: PokemonAnimationSequence, tick: number): PokemonAnimationFrame | undefined {
  if (sequence.frames.length === 0) return undefined;
  return sequence.frames[animationPlayerStateAtTick(sequence, tick).frameIndex];
}

function animationPlayerStateAtTick(sequence: PokemonAnimationSequence, tick: number): { frameIndex: number; frameStartTick: number } {
  if (sequence.frames.length === 0) return { frameIndex: 0, frameStartTick: 0 };
  let currentFrame = 0;
  let currentFrameTime = 0;
  let frameStartTick = 0;
  let direction: "forward" | "backward" = "forward";
  let playing = true;
  for (let frameTick = 0; frameTick < tick && playing; frameTick += 1) {
    currentFrameTime += 1;
    const duration = Math.max(1, sequence.frames[currentFrame]?.duration ?? 1);
    if (currentFrameTime < duration) continue;
    currentFrameTime = 0;
    frameStartTick = frameTick + 1;
    if (direction === "forward") {
      currentFrame += 1;
      if (currentFrame >= sequence.frames.length) {
        currentFrame -= 1;
        if (sequence.mode === 1) playing = false;
        else if (sequence.mode === 2) currentFrame = 0;
        else if (sequence.mode === 3 || sequence.mode === 4) {
          direction = "backward";
          if (currentFrame > 0) currentFrame -= 1;
        }
      }
    } else {
      currentFrame -= 1;
      if (currentFrame < 0) {
        currentFrame = 0;
        if (sequence.mode === 4) {
          direction = "forward";
          currentFrame = Math.min(1, sequence.frames.length - 1);
        } else {
          playing = false;
        }
      }
    }
    currentFrame = clampInt(currentFrame, 0, sequence.frames.length - 1);
  }
  return { frameIndex: currentFrame, frameStartTick };
}

function cropTransparentRgba(rgba: Uint8ClampedArray, width: number, height: number): { x: number; y: number; width: number; height: number; rgba: Uint8ClampedArray } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width: 1, height: 1, rgba: new Uint8ClampedArray(4) };
  const croppedWidth = maxX - minX;
  const croppedHeight = maxY - minY;
  const cropped = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
  for (let y = 0; y < croppedHeight; y += 1) {
    const sourceStart = ((minY + y) * width + minX) * 4;
    const sourceEnd = sourceStart + croppedWidth * 4;
    cropped.set(rgba.subarray(sourceStart, sourceEnd), y * croppedWidth * 4);
  }
  return { x: minX, y: minY, width: croppedWidth, height: croppedHeight, rgba: cropped };
}

function findRawBlock(bytes: Uint8Array, signature: string): number {
  const headerSize = readU16(bytes, 0x0c);
  const sectionCount = readU16(bytes, 0x0e);
  let offset = headerSize;
  for (let index = 0; index < sectionCount && offset + 8 <= bytes.length; index += 1) {
    const blockSize = readU32(bytes, offset + 4);
    if (readAscii(bytes, offset, 4) === signature) return offset;
    if (blockSize < 8) break;
    offset += blockSize;
  }
  return -1;
}

function decompressNitroIfNeeded(bytes: Uint8Array): Uint8Array {
  return isCompressedNitroFile(bytes) ? decompressNitro(bytes) : bytes;
}

function isCompressedNitroFile(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || (bytes[0] !== 0x10 && bytes[0] !== 0x11)) return false;
  const shortSize = (bytes[1] ?? 0) | ((bytes[2] ?? 0) << 8) | ((bytes[3] ?? 0) << 16);
  if (shortSize > 0) return true;
  return bytes[0] === 0x11 && bytes.length >= 8 && readU32(bytes, 4) > 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function trainerClassSpriteFiles(project: ProjectState, trainerClassId: number): Uint8Array[] {
  if (!Number.isInteger(trainerClassId) || trainerClassId < 0) throw new Error(`Invalid trainer class id: ${trainerClassId}`);
  const store = project.narcs.trainer_sprites;
  if (!store) throw new Error("Trainer sprite NARC is not loaded");
  const graphicIndex = trainerClassGraphicIndex(project, trainerClassId);
  const start = graphicIndex * TRAINER_SPRITE_FILES_PER_ENTRY;
  const files = store.rawFiles.slice(start, start + TRAINER_SPRITE_FILES_PER_ENTRY);
  if (files.length !== TRAINER_SPRITE_FILES_PER_ENTRY || files.some((file) => !file || file.length === 0)) {
    throw new Error(`Trainer class ${trainerClassId} is missing sprite data for graphic ${graphicIndex}`);
  }
  return files;
}

function trainerClassGraphicIndex(project: ProjectState, trainerClassId: number): number {
  if (project.session.baseRom !== "BW2") return trainerClassId;
  // BW2 appends the PWT and related special trainer classes after several
  // unused class slots, while their unique animated graphics begin at 94.
  // This range is contiguous: class 112 (Elesa) -> graphic 94 through
  // class 204 -> graphic 186. Using the class ID directly makes Elesa load
  // graphic 112, which belongs to Morty's class 130.
  if (trainerClassId >= BW2_PWT_TRAINER_CLASS_FIRST && trainerClassId <= BW2_PWT_TRAINER_CLASS_LAST) {
    return BW2_PWT_GRAPHIC_FIRST + trainerClassId - BW2_PWT_TRAINER_CLASS_FIRST;
  }
  return BW2_TRAINER_CLASS_GRAPHIC_INDEX[trainerClassId] ?? trainerClassId;
}

function trainerClassIdsForGraphic(project: ProjectState, graphicIndex: number): number[] {
  if (project.session.baseRom !== "BW2") return [graphicIndex];
  const classCount = Math.max(project.texts?.banks?.tr_classes?.length ?? 0, BW2_TRAINER_CLASS_GRAPHIC_INDEX.length);
  return Array.from({ length: classCount }, (_unused, trainerClassId) => trainerClassId).filter(
    (trainerClassId) => trainerClassGraphicIndex(project, trainerClassId) === graphicIndex,
  );
}

function trainerSpriteSubject(project: ProjectState, build: TrainerSpriteGifBuild): string {
  const labels = build.affectedClassIds.map((trainerClassId) => project.texts?.banks?.tr_classes?.[trainerClassId] ?? `Class ${trainerClassId}`);
  return labels.length === 1 ? labels[0] : `Shared trainer graphic ${build.graphicIndex}: ${labels.join(", ")}`;
}

function trainerSpriteNarcPath(project: ProjectState): string | undefined {
  if (project.session.baseRom === "BW") return "a/0/7/2";
  if (project.session.baseRom === "BW2") return "a/0/7/1";
  return undefined;
}
