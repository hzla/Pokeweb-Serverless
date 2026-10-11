import bundled from "../assets/codeinjection/cgearSkins.json";
import type { SkinCollection } from "./document";
import type { Image } from "../customUi/assets";
import { readU16 } from "../nds/binary";

export const SKIN_BYTES = 0x2600;
export const MAX_SKINS = 64;
export function defaultSkins(): SkinCollection {
  return { nextId: 16, defaultId: 0, entries: structuredClone(bundled) };
}
export function skinBytes(data: string): Uint8Array {
  if (typeof data !== "string" || data.length !== 12972 || !/^[A-Za-z0-9+/]+=$/.test(data))
    throw new Error("Invalid C-Gear skin data. Import a BW2 .cgb file.");
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  validateSkin(bytes); return bytes;
}
export function encodeSkin(bytes: Uint8Array): string {
  validateSkin(bytes); return btoa(String.fromCharCode(...bytes));
}
export function validateSkin(bytes: Uint8Array): void {
  if (bytes.length !== SKIN_BYTES) throw new Error("A BW2 .cgb skin must be exactly 9,728 bytes.");
  for (let i = 0; i < 16; i++) if (readU16(bytes, 0x1fe0 + i * 2) & 0x8000)
    throw new Error("Skin contains an invalid DS palette color.");
  for (let i = 0; i < 768; i++) {
    const tile = readU16(bytes, 0x2000 + i * 2);
    if ((tile & 1023) >= 255 || (tile & 0xf000))
      throw new Error("Skin uses an incompatible tile map. Import a BW2 .cgb skin, not a BW1 skin.");
  }
}
export function validateSkins(skins: SkinCollection): void {
  if (!skins || !Array.isArray(skins.entries) || skins.entries.length > MAX_SKINS ||
      !Number.isInteger(skins.nextId) || skins.nextId < 1 || skins.nextId > 4096)
    throw new Error("Use at most 64 skins with valid stable IDs.");
  const ids = new Set<number>();
  for (const skin of skins.entries) {
    if (!Number.isInteger(skin.id) || skin.id < 1 || skin.id > 4095 || ids.has(skin.id) || skin.id >= skins.nextId)
      throw new Error("Skin IDs must be unique and smaller than the next ID.");
    if (typeof skin.name !== "string" || !skin.name.trim() || skin.name.length > 80)
      throw new Error("Give each skin a name of up to 80 characters.");
    ids.add(skin.id); skinBytes(skin.data);
  }
  if (!Number.isInteger(skins.defaultId) || (skins.defaultId !== 0 && !ids.has(skins.defaultId)))
    throw new Error("Choose an existing skin as the default.");
}
/** Decode DS 4bpp tiles, including native horizontal and vertical flips. */
export function skinPreview(bytes: Uint8Array): Image {
  validateSkin(bytes); const pixels = new Uint8ClampedArray(256 * 192 * 4);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
    const entry = readU16(bytes, 0x2000 + (Math.floor(y / 8) * 32 + Math.floor(x / 8)) * 2);
    const tx = entry & 0x400 ? 7 - x % 8 : x % 8, ty = entry & 0x800 ? 7 - y % 8 : y % 8;
    const color = bytes[(entry & 1023) * 32 + ty * 4 + Math.floor(tx / 2)] >> (tx % 2 * 4) & 15;
    const rgb = readU16(bytes, 0x1fe0 + color * 2);
    pixels.set([Math.round((rgb & 31) * 255 / 31), Math.round((rgb >> 5 & 31) * 255 / 31), Math.round((rgb >> 10 & 31) * 255 / 31), color ? 255 : 0], (y * 256 + x) * 4);
  }
  return { width: 256, height: 192, pixels };
}
