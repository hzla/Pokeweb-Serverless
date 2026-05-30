import { readU32, writeU16, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { compressLz11Literal, decompressNitro } from "./pokemonSpriteModel";
import type { ProjectState, PwanAnimationOverride } from "./projectStore";
import { markDirty } from "./projectStore";
import {
  makeWidePwanPixels,
  pwanFirstFramePixels,
  pwanPalette,
  pwanVisibleHeight,
  tileIndexedPixels,
} from "./pwanCompiler";

export type PwanCarrierTemplate = Record<number, Uint8Array>;

export const PWAN_CARRIER_METADATA_OFFSETS = [4, 5, 6, 7, 8, 13, 14, 15, 16, 17] as const;
export const PWAN_BACK_LIFT_HEIGHT_THRESHOLD = 70;
export const PWAN_FRONT_NCEC_Y = 48;
export const PWAN_BACK_NCEC_Y = 53;

const FILES_PER_SPRITE = 20;
const PALETTE_OFFSET = 0x28;
const NCEC_ENTRY_OFFSET = 12;
const NCEC_ENTRY_BYTES = 48;
const NCEC_POS_Y_OFFSET = 4;
const NCEC_MEPACHI_POS_Y_OFFSET = 28;
const NCEC_ORIGINAL_POS_Y = 48 << 8;
const NCEC_BACK_LIFTED_POS_Y = 53 << 8;

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
  if (project.session.baseVersion !== "W2" || project.romInfo.idCode !== "IRDO") {
    throw new Error("PWAN animated sprite overrides currently require a stock US Pokemon White 2 ROM.");
  }
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  const base = override.speciesId * FILES_PER_SPRITE;
  if (base + FILES_PER_SPRITE > store.rawFiles.length) throw new Error(`Species ${override.speciesId} is outside the loaded Pokemon sprite archive.`);

  for (const offset of PWAN_CARRIER_METADATA_OFFSETS) {
    const bytes = carrier[offset];
    if (!bytes) throw new Error(`PWAN carrier template is missing file ${offset}.`);
    writeSpriteFile(project, base + offset, bytes.slice());
  }

  patchSide(project, base, 0, override.front.pwanBytes);
  patchSide(project, base, 9, override.back.pwanBytes);
  patchCarrierNcec(project, base, override.back.pwanBytes);

  const paletteSource = override.nativePaletteSource === "front" ? override.front.pwanBytes : override.back.pwanBytes;
  patchPalette(project, base + 18, pwanPalette(paletteSource));
  patchPalette(project, base + 19, pwanPalette(paletteSource));

  recordGenericChange(project, "pokemon_sprites", `PWAN animated carrier patched for species ${override.speciesId}.`, `Species ${override.speciesId}`, {
    key: `pwan-carrier:${override.speciesId}`,
  });
}

export function deriveBackNcecY(backPwanBytes: Uint8Array): 48 | 53 {
  return pwanVisibleHeight(backPwanBytes) > PWAN_BACK_LIFT_HEIGHT_THRESHOLD ? PWAN_BACK_NCEC_Y : PWAN_FRONT_NCEC_Y;
}

function patchSide(project: ProjectState, base: number, sideOffset: 0 | 9, pwanBytes: Uint8Array): void {
  const pixels = pwanFirstFramePixels(pwanBytes);
  patchNcgr(project, base + sideOffset, tileIndexedPixels(pixels, 96, 96));
  patchNcgr(project, base + sideOffset + 2, tileIndexedPixels(makeWidePwanPixels(pixels), 256, 128));
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

function patchCarrierNcec(project: ProjectState, base: number, backPwanBytes: Uint8Array): void {
  setNcecPosY(project, base + 8, NCEC_ORIGINAL_POS_Y);
  setNcecPosY(project, base + 17, deriveBackNcecY(backPwanBytes) === 53 ? NCEC_BACK_LIFTED_POS_Y : NCEC_ORIGINAL_POS_Y);
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
    if (mepachiPosY === NCEC_ORIGINAL_POS_Y || mepachiPosY === NCEC_BACK_LIFTED_POS_Y) writeU32(data, mepachiOffset, posY >>> 0);
  }
  writeSpriteFile(project, absoluteIndex, data);
}

function writeSpriteFile(project: ProjectState, absoluteIndex: number, bytes: Uint8Array): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon Sprites must be loaded before applying PWAN carrier patches.");
  store.rawFiles[absoluteIndex] = bytes;
  markDirty(project, "pokemon_sprites", absoluteIndex);
}
