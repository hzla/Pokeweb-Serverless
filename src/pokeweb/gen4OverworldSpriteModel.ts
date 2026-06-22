import { readAscii, readU16, readU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { isGen4Project } from "./constants";
import { decodeBtxImage, parseBtx, type BtxImage } from "./btxModel";
import { ensureGen4NarcStores } from "./gen4ResourceLoader";
import { loadActiveRomBytes } from "./persistence";
import { type ProjectState } from "./projectStore";

export type Gen4OverworldTableEntry = {
  entryId: number;
  spriteId: number;
  properties: number;
  is3d?: boolean;
};

export type Gen4OverworldSpriteImage = {
  name: string;
  overlayTableEntry: number;
  spriteFileId: number;
  frameIndex: number;
  width: number;
  height: number;
  rgba: Uint8Array;
};

const spriteUrlCache = new WeakMap<ProjectState, Map<string, string | undefined>>();
const spriteImageCache = new WeakMap<ProjectState, Map<string, Gen4OverworldSpriteImage | undefined>>();
const overworldTableCache = new WeakMap<ProjectState, Map<number, Gen4OverworldTableEntry>>();

const HGSS_SYNTH_OVERLAY_LOAD_ADDRESS = 0x023c8000;
const DSPRE_3D_OVERWORLD_ENTRIES = [91, 92, 93, 94, 95, 96, 101, ...Array.from({ length: 15 }, (_value, index) => 102 + index)];
const DSPRE_3D_OVERWORLD_ICONS = new Map<number, string>([
  [91, "brown_sign"],
  [92, "red_sign"],
  [93, "gray_sign"],
  [94, "route_sign"],
  [95, "blue_sign"],
  [96, "blue_sign"],
  [101, "dawn_platinum"],
  ...Array.from({ length: 15 }, (_value, index) => [102 + index, "overworld"] as const),
]);

export async function ensureGen4OverworldSpriteResources(project: ProjectState): Promise<void> {
  await ensureGen4NarcStores(project, ["ow_sprites"]);
  await ensureGen4OverworldTableResources(project);
}

export function defaultGen4OverworldTableEntry(): number {
  // Mirrors DSPRE's Overworld(int owID, ...) constructor default.
  return 1;
}

export function resolveGen4OverworldSpriteFileId(project: ProjectState, overlayTableEntry: number): number | undefined {
  const table = getGen4OverworldTable(project);
  const entry = table?.get(overlayTableEntry);
  if (entry?.is3d || entry?.spriteId === 0x3d3d) return undefined;
  return entry?.spriteId;
}

export function gen4SpecialOverworldIconName(overlayTableEntry: number): string | undefined {
  return DSPRE_3D_OVERWORLD_ICONS.get(overlayTableEntry);
}

export function getGen4OverworldTable(project: ProjectState): Map<number, Gen4OverworldTableEntry> | undefined {
  const cached = overworldTableCache.get(project);
  if (cached) return cached;
  const table = buildGen4OverworldTable(project);
  if (table) overworldTableCache.set(project, table);
  return table;
}

export function getGen4OverworldSpriteDataUrl(project: ProjectState, overlayTableEntry: number, direction: number): string | undefined {
  const image = getGen4OverworldSpriteImage(project, overlayTableEntry, direction);
  const key = `${overlayTableEntry}:${image?.spriteFileId ?? "none"}:${direction}`;
  let cache = spriteUrlCache.get(project);
  if (!cache) {
    cache = new Map();
    spriteUrlCache.set(project, cache);
  }
  if (cache.has(key)) return cache.get(key);

  if (!image) {
    cache.set(key, undefined);
    return undefined;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      cache.set(key, undefined);
      return undefined;
    }
    context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
    const url = canvas.toDataURL("image/png");
    cache.set(key, url);
    return url;
  } catch {
    cache.set(key, undefined);
    return undefined;
  }
}

export function getGen4OverworldSpriteImage(project: ProjectState, overlayTableEntry: number, direction: number): Gen4OverworldSpriteImage | undefined {
  const spriteFileId = resolveGen4OverworldSpriteFileId(project, overlayTableEntry);
  const key = `${overlayTableEntry}:${spriteFileId ?? "none"}:${direction}`;
  let cache = spriteImageCache.get(project);
  if (!cache) {
    cache = new Map();
    spriteImageCache.set(project, cache);
  }
  if (cache.has(key)) return cache.get(key);
  if (spriteFileId === undefined) {
    cache.set(key, undefined);
    return undefined;
  }

  const bytes = project.narcs.ow_sprites?.rawFiles[spriteFileId];
  if (!bytes || bytes.length < 4 || readAscii(bytes, 0, 4) !== "BTX0") {
    cache.set(key, undefined);
    return undefined;
  }

  try {
    const file = parseBtx(bytes);
    const frameIndex = gen4OverworldFrameIndexForDirection(file.textures.length, direction);
    const image = decodeBtxImage(file, frameIndex, 0, "auto");
    const spriteImage = gen4SpriteImageFromBtx(image, overlayTableEntry, spriteFileId, frameIndex);
    cache.set(key, spriteImage);
    return spriteImage;
  } catch {
    cache.set(key, undefined);
    return undefined;
  }
}

function gen4SpriteImageFromBtx(image: BtxImage, overlayTableEntry: number, spriteFileId: number, frameIndex: number): Gen4OverworldSpriteImage {
  return {
    name: image.name,
    overlayTableEntry,
    spriteFileId,
    frameIndex,
    width: image.width,
    height: image.height,
    rgba: image.rgba,
  };
}

export function parseDpptOverworldTable(bytes: Uint8Array, offset: number): Map<number, Gen4OverworldTableEntry> {
  const table = new Map<number, Gen4OverworldTableEntry>();
  for (let cursor = offset; cursor + 8 <= bytes.length; cursor += 8) {
    const entryId = readU32(bytes, cursor);
    if (entryId === 0xffff) break;
    const spriteId = readU32(bytes, cursor + 4);
    table.set(entryId, { entryId, spriteId, properties: 0 });
  }
  addDspre3dOverworldEntries(table);
  return table;
}

export function parseHgssOverworldTable(bytes: Uint8Array, offset: number): Map<number, Gen4OverworldTableEntry> {
  const table = new Map<number, Gen4OverworldTableEntry>();
  for (let cursor = offset; cursor + 6 <= bytes.length; cursor += 6) {
    const entryId = readU16(bytes, cursor);
    if (entryId === 0xffff) break;
    const spriteId = readU16(bytes, cursor + 2);
    const properties = readU16(bytes, cursor + 4);
    table.set(entryId, { entryId, spriteId, properties });
  }
  addDspre3dOverworldEntries(table);
  return table;
}

function buildGen4OverworldTable(project: ProjectState): Map<number, Gen4OverworldTableEntry> | undefined {
  if (!isGen4Project(project)) return undefined;
  if (project.originalRomBytes) {
    try {
      return buildGen4OverworldTableFromRom(project, new NintendoDSRom(project.originalRomBytes));
    } catch {
      // Fall back to already hydrated overlays below.
    }
  }
  if (project.session.baseRom === "DP" || project.session.baseRom === "Pt") {
    const overlay5 = project.overlays[5];
    return overlay5 ? parseDpptOverworldTable(overlay5, dpptOverworldTableOffset(project)) : undefined;
  }
  return undefined;
}

async function ensureGen4OverworldTableResources(project: ProjectState): Promise<void> {
  if (!isGen4Project(project)) return;
  if (overworldTableCache.has(project)) return;
  if (project.originalRomBytes) {
    try {
      const table = buildGen4OverworldTableFromRom(project, new NintendoDSRom(project.originalRomBytes));
      overworldTableCache.set(project, table);
      return;
    } catch {
      // Try the active ROM cache next so refreshed sessions can recover resources.
    }
  }

  const bytes = await loadActiveRomBytes();
  if (!bytes) return;
  const rom = new NintendoDSRom(bytes);
  const table = buildGen4OverworldTableFromRom(project, rom);
  overworldTableCache.set(project, table);
}

function buildGen4OverworldTableFromRom(project: ProjectState, rom: NintendoDSRom): Map<number, Gen4OverworldTableEntry> {
  if (project.session.baseRom === "DP" || project.session.baseRom === "Pt") {
    const overlay = rom.loadArm9Overlays([5]).get(5);
    if (!overlay) return dspre3dOnlyTable();
    project.overlays[5] = overlay.data;
    return parseDpptOverworldTable(overlay.data, dpptOverworldTableOffset(project));
  }

  const overlays = rom.loadArm9Overlays([1, 131]);
  const overlay1 = overlays.get(1);
  if (!overlay1) return dspre3dOnlyTable();
  project.overlays[1] = overlay1.data;
  const pointerOffset = hgssOverworldTablePointerAddress(project) - overlay1.ramAddress;
  const ramAddressOfTable = readU32(overlay1.data, pointerOffset);
  if ((ramAddressOfTable >>> 24) !== 0x02) return dspre3dOnlyTable();

  const overlay131 = overlays.get(131);
  if (overlay131) {
    project.overlays[131] = overlay131.data;
    return parseHgssOverworldTable(overlay131.data, ramAddressOfTable - overlay131.ramAddress);
  }
  if (ramAddressOfTable >= HGSS_SYNTH_OVERLAY_LOAD_ADDRESS) {
    return parseHgssOverworldTable(project.arm9, ramAddressOfTable - HGSS_SYNTH_OVERLAY_LOAD_ADDRESS);
  }
  return parseHgssOverworldTable(overlay1.data, ramAddressOfTable - overlay1.ramAddress);
}

function dpptOverworldTableOffset(project: ProjectState): number {
  const language = gen4LanguageCode(project.romInfo.idCode);
  if (project.session.baseRom === "DP") {
    if (language === "E") return 0x22bcc;
    if (language === "J") return 0x23bb8;
    return 0x22b84;
  }
  if (language === "I") return 0x2bc44;
  if (language === "F" || language === "S") return 0x2bc3c;
  if (language === "D") return 0x2bc50;
  if (language === "J") return 0x2ba24;
  return 0x2bc34;
}

function hgssOverworldTablePointerAddress(project: ProjectState): number {
  const language = gen4LanguageCode(project.romInfo.idCode);
  if (language === "I") return 0x021f929c;
  if (language === "F" || language === "S") return 0x021f931c;
  if (language === "D") return 0x021f92dc;
  if (language === "J") return 0x021f86c4;
  return 0x021f92fc;
}

function gen4LanguageCode(idCode: string): string {
  return idCode.slice(3, 4).toUpperCase();
}

function dspre3dOnlyTable(): Map<number, Gen4OverworldTableEntry> {
  const table = new Map<number, Gen4OverworldTableEntry>();
  addDspre3dOverworldEntries(table);
  return table;
}

function addDspre3dOverworldEntries(table: Map<number, Gen4OverworldTableEntry>): void {
  for (const entryId of DSPRE_3D_OVERWORLD_ENTRIES) {
    if (table.has(entryId)) continue;
    table.set(entryId, { entryId, spriteId: 0x3d3d, properties: 0x3d3d, is3d: true });
  }
}

export function gen4OverworldFrameIndexForDirection(frameCount: number, direction: number): number {
  if (frameCount <= 1) return 0;
  const normalized = Math.min(Math.max(Math.trunc(direction) || 0, 0), 3);
  let offsets = [0, 0, 0, 0];
  if (frameCount <= 4) offsets = [0, 1, 2, 3];
  else if (frameCount <= 8) offsets = [0, 2, 4, 6];
  else if (frameCount <= 16) offsets = [0, 11, 2, 4];
  else offsets = [0, 27, 2, 4];
  return Math.min(frameCount - 1, offsets[normalized] ?? 0);
}
