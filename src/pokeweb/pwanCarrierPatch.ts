import { readU32, writeU16, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { compressLz11Literal, decompressNitro } from "./pokemonSpriteModel";
import type { ProjectState, PwanAnimationOverride } from "./projectStore";
import { markDirty } from "./projectStore";
import {
  pwanFirstFramePixels,
  pwanPalette,
  pwanVisibleHeight,
  tilePwanSegmentedPixels,
} from "./pwanCompiler";

export type PwanCarrierTemplate = Record<number, Uint8Array>;

export const PWAN_CARRIER_METADATA_OFFSETS = [4, 5, 6, 7, 8, 13, 14, 15, 16, 17] as const;
export const PWAN_BACK_LIFT_HEIGHT_THRESHOLD = 70;
export const PWAN_CARRIER_BASELINE_RAISE_PX = 5;
export const PWAN_FRONT_NCEC_Y = 43;
export const PWAN_BACK_NCEC_Y = 48;

const FILES_PER_SPRITE = 20;
const PWAN_FRONT_CARRIER_METADATA_OFFSETS = [4, 5, 6, 7, 8] as const;
const PWAN_BACK_CARRIER_METADATA_OFFSETS = [13, 14, 15, 16, 17] as const;
const PALETTE_OFFSET = 0x28;
const NCEC_ENTRY_OFFSET = 12;
const NCEC_ENTRY_BYTES = 48;
const NCEC_POS_Y_OFFSET = 4;
const NCEC_MEPACHI_POS_Y_OFFSET = 28;
const NCEC_ORIGINAL_POS_Y = (PWAN_FRONT_NCEC_Y - PWAN_CARRIER_BASELINE_RAISE_PX) << 8;
const NCEC_BACK_LIFTED_POS_Y = (PWAN_BACK_NCEC_Y - PWAN_CARRIER_BASELINE_RAISE_PX) << 8;
const NCEC_TEMPLATE_ORIGINAL_POS_Y = PWAN_FRONT_NCEC_Y << 8;
const NCEC_TEMPLATE_BACK_LIFTED_POS_Y = PWAN_BACK_NCEC_Y << 8;

const SPRITE_SCRAMBLE_RECTS = [
  [0, 0, 64, 64, 0, 0],
  [64, 0, 32, 8, 0, 64],
  [64, 8, 32, 8, 32, 64],
  [64, 16, 32, 8, 0, 72],
  [64, 24, 32, 8, 32, 72],
  [64, 32, 32, 8, 0, 80],
  [64, 40, 32, 8, 32, 80],
  [64, 48, 32, 8, 0, 88],
  [64, 56, 32, 8, 32, 88],
  [0, 64, 64, 32, 0, 96],
  [64, 64, 32, 8, 0, 128],
  [64, 72, 32, 8, 32, 128],
  [64, 80, 32, 8, 0, 136],
  [64, 88, 32, 8, 32, 136],
] as const;

const CARRIER_URLS = Object.fromEntries(
  PWAN_CARRIER_METADATA_OFFSETS.map((offset) => [offset, new URL(`../assets/pwan/carrier/file${offset}.bin`, import.meta.url)]),
) as Record<(typeof PWAN_CARRIER_METADATA_OFFSETS)[number], URL>;

export async function loadBundledPwanCarrierTemplate(): Promise<PwanCarrierTemplate> {
  const entries = await Promise.all(
    PWAN_CARRIER_METADATA_OFFSETS.map(async (offset) => {
      const response = await fetch(CARRIER_URLS[offset]);
      if (!response.ok) throw new Error(`Could not load PWAN carrier template file ${offset} (${response.status})`);
      return [offset, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function applyPwanCarrierPatch(project: ProjectState, override: PwanAnimationOverride, carrier: PwanCarrierTemplate): void {
  if (project.session.baseVersion !== "W2") {
    throw new Error("PWAN animated sprite overrides currently require a compatible Pokemon White 2 ROM.");
  }
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  const assetIndex = override.assetIndex ?? override.speciesId;
  const base = assetIndex * FILES_PER_SPRITE;
  if (base + FILES_PER_SPRITE > store.rawFiles.length) throw new Error(`Sprite asset ${assetIndex} is outside the loaded Pokemon sprite archive.`);

  const metadataOffsets = [
    ...(override.front ? PWAN_FRONT_CARRIER_METADATA_OFFSETS : []),
    ...(override.back ? PWAN_BACK_CARRIER_METADATA_OFFSETS : []),
  ];
  for (const offset of metadataOffsets) {
    const bytes = carrier[offset];
    if (!bytes) throw new Error(`PWAN carrier template is missing file ${offset}.`);
    writeSpriteFile(project, base + offset, bytes.slice());
  }

  const paletteSide = override.nativePaletteSource === "front" && override.front ? override.front : override.nativePaletteSource === "back" && override.back ? override.back : override.front ?? override.back;
  if (!paletteSide) throw new Error(`PWAN override for species ${override.speciesId} does not include an imported side.`);
  const paletteSource = paletteSide.pwanBytes;
  const nativePalette = pwanPalette(paletteSource);
  if (override.front) patchSide(project, base, 0, override.front.pwanBytes, nativePalette);
  if (override.back) patchSide(project, base, 9, override.back.pwanBytes, nativePalette);
  patchCarrierNcec(project, base, override.back?.pwanBytes, Boolean(override.front), Boolean(override.back));

  if (override.front) patchPalette(project, base + 18, nativePalette);
  if (override.back) patchPalette(project, base + 19, nativePalette);

  recordGenericChange(project, "pokemon_sprites", `PWAN animated carrier patched for species ${override.speciesId}.`, `Species ${override.speciesId}`, {
    key: `pwan-carrier:${override.speciesId}:${assetIndex}`,
  });
}

export function deriveBackNcecY(backPwanBytes: Uint8Array): 43 | 48 {
  return pwanVisibleHeight(backPwanBytes) > PWAN_BACK_LIFT_HEIGHT_THRESHOLD ? PWAN_BACK_NCEC_Y : PWAN_FRONT_NCEC_Y;
}

function patchSide(project: ProjectState, base: number, sideOffset: 0 | 9, pwanBytes: Uint8Array, nativePalette: Uint16Array): void {
  const pixels = remapPixelsToNativePalette(pwanFirstFramePixels(pwanBytes), pwanPalette(pwanBytes), nativePalette);
  patchNcgr(project, base + sideOffset, tilePwanSegmentedPixels(pixels));
  patchNcgr(project, base + sideOffset + 2, linearWidePwanPixels(pixels));
}

export function linearWidePwanPixels(pixels: number[][]): Uint8Array {
  const out = new Uint8Array((256 * 128) / 2);
  for (let y = 0; y < 96; y += 1) {
    for (let x = 0; x < 96; x += 2) {
      const lo = pixels[y]?.[x] ?? 0;
      const hi = pixels[y]?.[x + 1] ?? 0;
      out[(y * 256 + x) >> 1] = (lo & 0x0f) | ((hi & 0x0f) << 4);
    }
  }
  return out;
}

export function scrambleBattleSpritePixels(pixels: number[][]): number[][] {
  const out = Array.from({ length: 144 }, () => Array.from({ length: 64 }, () => 0));
  for (const [srcX, srcY, width, height, dstX, dstY] of SPRITE_SCRAMBLE_RECTS) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[dstY + y]![dstX + x] = pixels[srcY + y]?.[srcX + x] ?? 0;
      }
    }
  }
  return out;
}

export function remapPixelsToNativePalette(pixels: number[][], sourcePalette: Uint16Array, nativePalette: Uint16Array): number[][] {
  const remap = Array.from({ length: 16 }, (_value, index) => index);
  for (let index = 1; index < 16; index += 1) remap[index] = nearestPaletteIndex(sourcePalette[index] ?? 0, nativePalette);
  return pixels.map((row) => row.map((index) => (index === 0 ? 0 : (remap[index] ?? 0))));
}

function nearestPaletteIndex(color: number, palette: Uint16Array): number {
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const source = bgr555ToRgb(color);
  for (let index = 1; index < 16; index += 1) {
    const candidate = bgr555ToRgb(palette[index] ?? 0);
    const distance = (source.r - candidate.r) ** 2 + (source.g - candidate.g) ** 2 + (source.b - candidate.b) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function bgr555ToRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color & 0x1f) << 3,
    g: ((color >>> 5) & 0x1f) << 3,
    b: ((color >>> 10) & 0x1f) << 3,
  };
}

function patchNcgr(project: ProjectState, absoluteIndex: number, tiledData: Uint8Array): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  const file = store.rawFiles[absoluteIndex];
  if (!file || file.length === 0) throw new Error(`Pokemon sprite file ${absoluteIndex} is missing.`);
  const decompressed = new Uint8Array(decompressNitro(file));
  if (decompressed.length < tiledData.length) throw new Error(`Pokemon sprite file ${absoluteIndex} is too small for ${tiledData.length} bytes of PWAN fallback data.`);
  decompressed.set(tiledData, decompressed.length - tiledData.length);
  writeSpriteFile(project, absoluteIndex, compressLz11Literal(decompressed));
}

function patchPalette(project: ProjectState, absoluteIndex: number, palette: Uint16Array): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  const out = (store.rawFiles[absoluteIndex] ?? new Uint8Array()).slice();
  if (out.length < PALETTE_OFFSET + 32) throw new Error(`Pokemon palette file ${absoluteIndex} is too small.`);
  for (let index = 0; index < 16; index += 1) writeU16(out, PALETTE_OFFSET + index * 2, palette[index] ?? 0);
  writeSpriteFile(project, absoluteIndex, out);
}

function patchCarrierNcec(project: ProjectState, base: number, backPwanBytes: Uint8Array | undefined, hasFront: boolean, hasBack: boolean): void {
  if (hasFront) setNcecPosY(project, base + 8, NCEC_ORIGINAL_POS_Y);
  if (hasBack && backPwanBytes) setNcecPosY(project, base + 17, deriveBackNcecY(backPwanBytes) === PWAN_BACK_NCEC_Y ? NCEC_BACK_LIFTED_POS_Y : NCEC_ORIGINAL_POS_Y);
}

function setNcecPosY(project: ProjectState, absoluteIndex: number, posY: number): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  const data = (store.rawFiles[absoluteIndex] ?? new Uint8Array()).slice();
  if (data.length < NCEC_ENTRY_OFFSET + NCEC_ENTRY_BYTES) throw new Error(`Carrier NCEC file ${absoluteIndex} is too small.`);
  const cellCount = readU32(data, 0);
  if (cellCount < 1) throw new Error(`Carrier NCEC file ${absoluteIndex} has no cells.`);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const entry = NCEC_ENTRY_OFFSET + cell * NCEC_ENTRY_BYTES;
    if (entry + NCEC_ENTRY_BYTES > data.length) throw new Error(`Carrier NCEC file ${absoluteIndex} has a truncated cell table.`);
    writeU32(data, entry + NCEC_POS_Y_OFFSET, posY >>> 0);
    const mepachiOffset = entry + NCEC_MEPACHI_POS_Y_OFFSET;
    const mepachiPosY = readU32(data, mepachiOffset) | 0;
    if (
      mepachiPosY === NCEC_ORIGINAL_POS_Y ||
      mepachiPosY === NCEC_BACK_LIFTED_POS_Y ||
      mepachiPosY === NCEC_TEMPLATE_ORIGINAL_POS_Y ||
      mepachiPosY === NCEC_TEMPLATE_BACK_LIFTED_POS_Y
    ) {
      writeU32(data, mepachiOffset, posY >>> 0);
    }
  }
  writeSpriteFile(project, absoluteIndex, data);
}

function writeSpriteFile(project: ProjectState, absoluteIndex: number, bytes: Uint8Array): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  store.rawFiles[absoluteIndex] = bytes;
  markDirty(project, "pokemon_sprites", absoluteIndex);
}
