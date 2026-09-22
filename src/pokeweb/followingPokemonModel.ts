import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { parseBtx, decodeBtxImage, type BtxImage } from "./btxModel";

export const FOLLOWING_ABI = 1;
export const FOLLOWING_CODE_BASE = 0x3000;
export const FOLLOWING_STOCK_ROWS = 1008;
export const FOLLOWING_MAX_ASSETS = 6144;
export type FollowerAppearanceKey = { species: number; form: number; gender: 0 | 1 | 2; shiny: boolean };
export type FollowerAnimationProfile = "pokemon-mirrored" | "pokemon-asymmetric";
export type FollowerAssetEntry = {
  key: FollowerAppearanceKey;
  descriptorRow: number;
  sourceDescriptorRow?: number;
  resourceId: number;
  size: 32 | 64;
  sideGap?: number; // Derived from visible side artwork; 0..6 native world units.
  animationProfile: FollowerAnimationProfile;
  offsets: [number, number, number];
  placeholder: boolean;
  placeholderReason?: string;
  source: "stock" | "hgss" | "hg-engine" | "png";
  sourceLabel?: string;
};
export type FollowerZonePolicy = { zone: number; suppressed: boolean; reason: string };
export type FollowerInstallState = {
  schemaVersion: 1; runtimeVersion: string; dataVersion: number; runtimeAbi: number;
  enabled: boolean; compatibility: "unverified" | "verified" | "conflict";
  ownedResources: Array<{ path: string; beforeHash?: string; afterHash: string }>;
  patchFingerprints: Record<string, string>;
};
export type FollowerRegistry = {
  runtimeAbi: number; entries: FollowerAssetEntry[]; zones: FollowerZonePolicy[];
  descriptorCount: number; resourceCount: number;
};
export type FollowerFrame = { width: number; height: number; rgba: Uint8Array };
export const FOLLOWER_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type FollowerDirection = typeof FOLLOWER_DIRECTIONS[number];

function integer(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}: ${value}`);
}
export function followerKey(key: FollowerAppearanceKey): string {
  integer(key.species, 1, 1023, "species"); integer(key.form, 0, 255, "form"); integer(key.gender, 0, 2, "gender");
  if (typeof key.shiny !== "boolean") throw new Error("Shiny must be a boolean.");
  return `${key.species}:${key.form}:${key.gender}:${Number(key.shiny)}`;
}
function packedKey(key: FollowerAppearanceKey): number { followerKey(key); return key.species * 2048 + key.form * 8 + key.gender * 2 + Number(key.shiny); }
export function stockFollowerRow(code: number): number {
  integer(code, 0, 0xffff, "object code");
  if (code < 0x179) return code;
  if (code >= 0x1000 && code < 0x126c) return code - 0xe87;
  if (code >= 0x2000 && code < 0x200b) return code - 0x1c1b;
  return 10;
}
export function followerDescriptorOffset(row: number): number { integer(row, 0, 0xffff, "descriptor row"); return 4 + row * 28; }
export function validateFollowerRegistry(registry: FollowerRegistry): void {
  if (registry.runtimeAbi !== FOLLOWING_ABI) throw new Error("Unsupported follower runtime ABI.");
  integer(registry.descriptorCount, FOLLOWING_STOCK_ROWS, FOLLOWING_STOCK_ROWS + FOLLOWING_MAX_ASSETS, "descriptor count");
  integer(registry.resourceCount, 1, 0xffff, "resource count");
  integer(registry.entries.length, 1, 16384, "appearance count");
  const keys = new Set<string>();
  for (const entry of registry.entries) {
    const key = followerKey(entry.key);
    if (keys.has(key)) throw new Error(`Duplicate follower appearance ${key}`);
    keys.add(key);
    integer(entry.descriptorRow, FOLLOWING_STOCK_ROWS, registry.descriptorCount - 1, "owned descriptor row");
    integer(entry.resourceId, 0, registry.resourceCount - 1, "resource reference");
    if (entry.sourceDescriptorRow !== undefined) integer(entry.sourceDescriptorRow, 0, FOLLOWING_STOCK_ROWS - 1, "source descriptor row");
    integer(entry.sideGap ?? 0, 0, 6, "sideways spacing");
    if (![32, 64].includes(entry.size)) throw new Error("Follower size must be 32 or 64.");
    if (!["pokemon-mirrored", "pokemon-asymmetric"].includes(entry.animationProfile)) throw new Error("Unknown follower animation profile.");
    if (!Array.isArray(entry.offsets) || entry.offsets.length !== 3) throw new Error("Three sprite offsets are required.");
    entry.offsets.forEach(offset => integer(offset, -128, 127, "sprite offset"));
    if (typeof entry.placeholder !== "boolean") throw new Error("Placeholder status must be explicit.");
    if (entry.placeholder && !entry.placeholderReason?.trim()) throw new Error(`Placeholder ${key} needs a reason.`);
    if (!["stock", "hgss", "hg-engine", "png"].includes(entry.source)) throw new Error("Unknown asset source.");
  }
  integer(registry.zones.length, 0, 65535, "zone count");
  const zones = new Set<number>();
  for (const policy of registry.zones) {
    integer(policy.zone, 0, 65535, "zone");
    if (zones.has(policy.zone)) throw new Error("Duplicate follower zone policy.");
    if (typeof policy.suppressed !== "boolean" || !policy.reason?.trim()) throw new Error("Zone overrides require a diagnostic reason.");
    zones.add(policy.zone);
  }
}
export function followerCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; ++i) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
/** FWDB v3/v4 add bounded spacing in existing reserved bytes/bits of v1/v2.
 * v1/v3: 24-byte appearances; v2/v4: packed 12-byte appearances.
 * Both use a 32-byte header and 8-byte sorted zone rules.
 * Editorial provenance and full diagnostic text stay in the companion JSON. */
export function encodeFollowerRegistry(registry: FollowerRegistry, compact = false): Uint8Array {
  validateFollowerRegistry(registry);
  const entries = [...registry.entries].sort((a, b) => packedKey(a.key) - packedKey(b.key));
  const zones = [...registry.zones].sort((a, b) => a.zone - b.zone);
  const stride = compact ? 12 : 24;
  const bytes = new Uint8Array(32 + entries.length * stride + zones.length * 8);
  bytes.set([0x46, 0x57, 0x44, 0x42]); writeU16(bytes, 4, compact ? 4 : 3); writeU16(bytes, 6, FOLLOWING_ABI);
  writeU32(bytes, 8, bytes.length); writeU16(bytes, 12, entries.length); writeU16(bytes, 14, zones.length);
  writeU16(bytes, 16, registry.descriptorCount); writeU16(bytes, 18, registry.resourceCount);
  writeU16(bytes, 20, FOLLOWING_CODE_BASE); writeU16(bytes, 22, FOLLOWING_STOCK_ROWS);
  entries.forEach((e, i) => {
    const at = 32 + i * stride;
    if (compact) {
      writeU32(bytes, at, packedKey(e.key)); writeU16(bytes, at + 4, e.descriptorRow); writeU16(bytes, at + 6, e.resourceId);
      bytes[at + 8] = Number(e.placeholder) | (e.size === 64 ? 2 : 0) | (e.animationProfile === "pokemon-asymmetric" ? 4 : 0) | ((e.sideGap ?? 0) << 3);
      e.offsets.forEach((v, j) => bytes[at + 9 + j] = v & 255);
      return;
    }
    writeU16(bytes, at, e.key.species); bytes[at + 2] = e.key.form; bytes[at + 3] = e.key.gender;
    bytes[at + 4] = Number(e.key.shiny); bytes[at + 5] = Number(e.placeholder);
    writeU16(bytes, at + 6, e.descriptorRow); writeU16(bytes, at + 8, e.resourceId);
    bytes[at + 10] = e.size; bytes[at + 11] = e.animationProfile === "pokemon-asymmetric" ? 1 : 0;
    e.offsets.forEach((v, j) => bytes[at + 12 + j] = v & 255);
    bytes[at + 15] = e.sideGap ?? 0;
  });
  zones.forEach((z, i) => {
    const at = 32 + entries.length * stride + i * 8;
    writeU16(bytes, at, z.zone); bytes[at + 2] = Number(z.suppressed);
    writeU32(bytes, at + 4, followerCrc32(new TextEncoder().encode(z.reason)));
  });
  // Protect header counts/bounds as well as the payload; checksum field is zero.
  writeU32(bytes, 24, followerCrc32(bytes));
  return bytes;
}
export function decodeFollowerRegistry(bytes: Uint8Array): FollowerRegistry {
  if (bytes.length < 32 || String.fromCharCode(...bytes.subarray(0, 4)) !== "FWDB" || ![1, 2, 3, 4].includes(readU16(bytes, 4)) || readU16(bytes, 6) !== FOLLOWING_ABI) throw new Error("Unsupported follower registry.");
  const version = readU16(bytes, 4), compact = version === 2 || version === 4, stride = compact ? 12 : 24;
  const count = readU16(bytes, 12), zoneCount = readU16(bytes, 14);
  if (readU32(bytes, 8) !== bytes.length || bytes.length !== 32 + count * stride + zoneCount * 8 || readU16(bytes, 20) !== FOLLOWING_CODE_BASE || readU16(bytes, 22) !== FOLLOWING_STOCK_ROWS || readU32(bytes, 28) !== 0) throw new Error("Invalid follower registry length or bounds.");
  const checked = bytes.slice(); writeU32(checked, 24, 0);
  if (followerCrc32(checked) !== readU32(bytes, 24)) throw new Error("Follower registry checksum mismatch.");
  const entries: FollowerAssetEntry[] = [];
  for (let i = 0; i < count; ++i) {
    const at = 32 + i * stride;
    if (compact) {
      const packed = readU32(bytes, at), flags = bytes[at + 8];
      if ((flags & (version === 4 ? 0xc0 : ~7)) || (flags >> 3 & 7) > 6) throw new Error("Invalid packed appearance flags.");
      const key: FollowerAppearanceKey = { species: packed >>> 11, form: (packed >>> 3) & 255, gender: ((packed >>> 1) & 3) as 0 | 1 | 2, shiny: Boolean(packed & 1) };
      if (i && packedKey(entries[i - 1].key) >= packed) throw new Error("Follower appearances must be sorted and unique.");
      entries.push({ key, descriptorRow: readU16(bytes, at + 4), resourceId: readU16(bytes, at + 6), size: flags & 2 ? 64 : 32, sideGap: version === 4 ? flags >> 3 & 7 : 0,
        animationProfile: flags & 4 ? "pokemon-asymmetric" : "pokemon-mirrored",
        offsets: [9, 10, 11].map(j => (bytes[at + j] << 24) >> 24) as [number, number, number],
        placeholder: Boolean(flags & 1), placeholderReason: flags & 1 ? "See companion asset manifest." : undefined, source: "stock" });
      continue;
    }
    if (bytes[at + 4] > 1 || bytes[at + 5] > 1 || bytes[at + 11] > 1 || (version === 3 && bytes[at + 15] > 6) || bytes.subarray(at + (version === 3 ? 16 : 15), at + 24).some(v => v !== 0)) throw new Error("Invalid appearance flags or reserved fields.");
    const key: FollowerAppearanceKey = { species: readU16(bytes, at), form: bytes[at + 2], gender: bytes[at + 3] as 0 | 1 | 2, shiny: Boolean(bytes[at + 4]) };
    if (i && packedKey(entries[i - 1].key) >= packedKey(key)) throw new Error("Follower appearances must be sorted and unique.");
    entries.push({ key, descriptorRow: readU16(bytes, at + 6), resourceId: readU16(bytes, at + 8), size: bytes[at + 10] as 32 | 64, sideGap: version === 3 ? bytes[at + 15] : 0,
      animationProfile: bytes[at + 11] ? "pokemon-asymmetric" : "pokemon-mirrored",
      offsets: [12, 13, 14].map(j => (bytes[at + j] << 24) >> 24) as [number, number, number],
      placeholder: Boolean(bytes[at + 5]), placeholderReason: bytes[at + 5] ? "See companion asset manifest." : undefined, source: "stock" });
  }
  const zones: FollowerZonePolicy[] = [];
  for (let i = 0; i < zoneCount; ++i) {
    const at = 32 + count * stride + i * 8, zone = readU16(bytes, at);
    if (bytes[at + 2] > 1 || bytes[at + 3] || (i && zones[i - 1].zone >= zone)) throw new Error("Invalid zone policy.");
    zones.push({ zone, suppressed: Boolean(bytes[at + 2]), reason: `Manifest reason CRC32: ${readU32(bytes, at + 4).toString(16)}` });
  }
  const registry = { runtimeAbi: FOLLOWING_ABI, entries, zones, descriptorCount: readU16(bytes, 16), resourceCount: readU16(bytes, 18) };
  validateFollowerRegistry(registry); return registry;
}

/** Convert an installed registry without rehashing its stored zone diagnostics. */
export function compactFollowerRegistry(bytes: Uint8Array): Uint8Array {
  const decoded = decodeFollowerRegistry(bytes), compact = encodeFollowerRegistry(decoded, true);
  const zoneBytes = decoded.zones.length * 8;
  compact.set(bytes.subarray(bytes.length - zoneBytes), compact.length - zoneBytes);
  writeU32(compact, 24, 0); writeU32(compact, 24, followerCrc32(compact));
  return compact;
}

export type FollowerStockAppearance = { species: number; gender: number; form: number; code: number };
export function readFollowerStockAppearances(narcBytes: Uint8Array): FollowerStockAppearance[] {
  const narc = new NARC(narcBytes);
  if (narc.files.length !== 1 || narc.files[0].length !== 620 * 8) throw new Error("Unsupported stock Pokémon appearance table.");
  const bytes = narc.files[0];
  return Array.from({ length: 620 }, (_, i) => ({ species: readU16(bytes, i * 8), gender: readU16(bytes, i * 8 + 2), form: readU16(bytes, i * 8 + 4), code: readU16(bytes, i * 8 + 6) }));
}
/** Enumerate legal sexes and forms from the stock personal archive, not filenames. */
export function enumerateFollowerAppearances(personal: readonly Uint8Array[], speciesMax = 649): FollowerAppearanceKey[] {
  integer(speciesMax, 1, 1023, "species limit");
  if (personal.length <= speciesMax) throw new Error("Missing White 2 personal records.");
  const keys: FollowerAppearanceKey[] = [];
  for (let species = 1; species <= speciesMax; ++species) {
    const record = personal[species];
    if (record.length < 33) throw new Error(`Truncated personal record ${species}`);
    const ratio = record[18];
    const genders: Array<0 | 1 | 2> = ratio === 255 ? [2] : ratio === 254 ? [1] : ratio === 0 ? [0] : [0, 1];
    for (let form = 0; form < Math.max(1, record[32]); ++form)
      for (const gender of genders) for (const shiny of [false, true]) keys.push({ species, form, gender, shiny });
  }
  return keys;
}
export function followerAnimationFrame(profile: FollowerAnimationProfile, direction: FollowerDirection, tick: number, walking = true): { index: number; mirror: boolean } {
  if (!FOLLOWER_DIRECTIONS.includes(direction)) throw new Error("Invalid follower direction.");
  integer(tick, 0, Number.MAX_SAFE_INTEGER, "animation tick");
  const phase = walking ? tick % 20 : 0;
  const pose = direction === "down" ? (phase >= 5 && phase < 15 ? 1 : 0) : (phase >= 10 ? 1 : 0);
  const mirror = direction === "right" && profile === "pokemon-mirrored";
  return { index: (mirror ? 2 : FOLLOWER_DIRECTIONS.indexOf(direction)) * 2 + pose, mirror };
}
export function followerPreview(resource: Uint8Array, profile: FollowerAnimationProfile, direction: FollowerDirection, tick: number, walking = true): BtxImage {
  const frame = followerAnimationFrame(profile, direction, tick, walking);
  const image = decodeBtxImage(resource, frame.index, 0, "linear");
  if (!frame.mirror) return image;
  const rgba = image.rgba.slice();
  for (let y = 0; y < image.height; ++y) for (let x = 0; x < image.width; ++x)
    rgba.set(image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4), (y * image.width + image.width - x - 1) * 4);
  return { ...image, rgba };
}
/** Stable maximum across both side directions/poses; transparent margins do
 * not affect spacing and walking frames cannot make the gap oscillate. */
export function followerSideGap(resource: Uint8Array, profile: FollowerAnimationProfile): number {
  validateFollowerResource(resource, profile);
  let widest = 0;
  for (const direction of ["left", "right"] as const) for (const tick of [0, 10]) {
    const frame = followerPreview(resource, profile, direction, tick);
    let min = frame.width, max = -1;
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      if (frame.rgba[(y * frame.width + x) * 4 + 3]) { min = Math.min(min, x); max = Math.max(max, x); }
    }
    widest = Math.max(widest, max >= min ? max - min + 1 : 0);
  }
  // Half the artwork extending beyond a normal 16-unit tile footprint.
  return Math.max(0, Math.min(6, Math.ceil((widest - 16) / 2)));
}
/** Import/export-time cache only; no extra runtime table or image decoding. */
export function deriveFollowerSpacing(registry: FollowerRegistry, resources: readonly Uint8Array[]): void {
  const cache = new Map<string, number>();
  for (const e of registry.entries) {
    const key = `${e.resourceId}:${e.animationProfile}`;
    if (!cache.has(key)) {
      const resource = resources[e.resourceId];
      if (!resource) throw new Error("Missing follower spacing resource.");
      cache.set(key, followerSideGap(resource, e.animationProfile));
    }
    e.sideGap = cache.get(key)!;
  }
}
export function validateFollowerResource(bytes: Uint8Array, profile: FollowerAnimationProfile): { size: 32 | 64; frames: number } {
  if (bytes.length < 80 || bytes.length > 128 * 1024 || readU32(bytes, 8) !== bytes.length) throw new Error("Invalid billboard resource length.");
  const file = parseBtx(bytes), frames = profile === "pokemon-mirrored" ? 6 : 8;
  if (file.textures.length !== frames || file.palettes.length !== 1 || file.warnings.length) throw new Error(`Expected ${frames} frames and one palette.`);
  const size = file.textures[0]?.width;
  if (size !== 32 && size !== 64) throw new Error("Expected 32- or 64-pixel frames.");
  if (file.paletteDataOffset + 32 > bytes.length || file.paletteDataSizeBytes < 32) throw new Error("Truncated billboard palette.");
  for (const texture of file.textures) {
    if (texture.width !== size || texture.height !== size || texture.format !== 3 || !texture.color0Transparent) throw new Error("Billboards require equal square I4 frames and color-zero transparency.");
    if (texture.imageOffsetBytes + size * size / 2 > file.textureDataSizeBytes || file.textureDataOffset + texture.imageOffsetBytes + size * size / 2 > bytes.length) throw new Error("Truncated billboard texture.");
  }
  return { size, frames };
}

/** Four-direction PNG template: two columns (idle, step), rows up/down/left/right. */
export function followerFramesFromSheet(sheet: FollowerFrame): FollowerFrame[] {
  const size = sheet.width / 2;
  if ((size !== 32 && size !== 64) || sheet.height !== size * 4 || sheet.rgba.length !== sheet.width * sheet.height * 4) throw new Error("Use a 64×128 or 128×256 RGBA sheet: up/down/left/right rows, two poses per row.");
  return Array.from({ length: 8 }, (_, i) => {
    const rgba = new Uint8Array(size * size * 4), x = (i % 2) * size, y = Math.floor(i / 2) * size;
    for (let line = 0; line < size; ++line) rgba.set(sheet.rgba.subarray(((y + line) * sheet.width + x) * 4, ((y + line) * sheet.width + x + size) * 4), line * size * 4);
    return { width: size, height: size, rgba };
  });
}
export function followerSheetFromFrames(frames: readonly FollowerFrame[]): FollowerFrame {
  if (frames.length !== 8) throw new Error("Eight frames are required.");
  const size = frames[0].width, rgba = new Uint8Array(size * size * 8 * 4);
  if (![32, 64].includes(size)) throw new Error("Invalid frame size.");
  frames.forEach((frame, i) => {
    if (frame.width !== size || frame.height !== size || frame.rgba.length !== size * size * 4) throw new Error("Frame dimensions differ.");
    for (let y = 0; y < size; ++y) rgba.set(frame.rgba.subarray(y * size * 4, (y + 1) * size * 4), ((Math.floor(i / 2) * size + y) * size * 2 + (i % 2) * size) * 4);
  });
  return { width: size * 2, height: size * 4, rgba };
}
/** Explicit frame mapping avoids interpreting resource filenames as species/poses. */
export function followerFramesFromHgss(bytes: Uint8Array, indices: readonly number[], palette: number): FollowerFrame[] {
  if (indices.length !== 8) throw new Error("Specify eight HGSS frame indices in up/down/left/right pose order.");
  const btx = parseBtx(bytes);
  integer(palette, 0, btx.palettes.length - 1, "palette");
  return indices.map(index => {
    integer(index, 0, btx.textures.length - 1, "HGSS frame");
    const frame = decodeBtxImage(btx, index, palette, "linear");
    if (![32, 64].includes(frame.width) || frame.width !== frame.height) throw new Error("Unsupported HGSS frame size.");
    return frame;
  });
}
/** Encode into a generated, artwork-free Nitro template. Deterministic palette
 * assignment; reject lossy >15-color imports rather than silently changing art. */
export function encodeFollowerFrames(frames: readonly FollowerFrame[], template: Uint8Array): Uint8Array {
  if (frames.length !== 6 && frames.length !== 8) throw new Error("Expected six mirrored or eight independent direction frames.");
  const profile = frames.length === 6 ? "pokemon-mirrored" : "pokemon-asymmetric";
  const { size } = validateFollowerResource(template, profile);
  const colors = new Set<number>();
  const color = (rgba: Uint8Array, i: number) => (rgba[i] >>> 3) | ((rgba[i + 1] >>> 3) << 5) | ((rgba[i + 2] >>> 3) << 10);
  for (const frame of frames) {
    if (frame.width !== size || frame.height !== size || frame.rgba.length !== size * size * 4) throw new Error("Frame size does not match template.");
    for (let i = 0; i < frame.rgba.length; i += 4) {
      if (frame.rgba[i + 3] !== 0 && frame.rgba[i + 3] !== 255) throw new Error("I4 sprites require opaque or transparent pixels; partial alpha is unsupported.");
      if (frame.rgba[i + 3]) colors.add(color(frame.rgba, i));
    }
  }
  if (colors.size > 15) throw new Error(`Sprite uses ${colors.size} opaque DS colors; the I4 limit is 15 plus transparency.`);
  const palette = [...colors].sort((a, b) => a - b), lookup = new Map(palette.map((value, index) => [value, index + 1]));
  const bytes = template.slice(), parsed = parseBtx(bytes);
  bytes.fill(0, parsed.paletteDataOffset, parsed.paletteDataOffset + parsed.paletteDataSizeBytes);
  palette.forEach((value, i) => writeU16(bytes, parsed.paletteDataOffset + (i + 1) * 2, value));
  frames.forEach((frame, i) => {
    const at = parsed.textureDataOffset + parsed.textures[i].imageOffsetBytes;
    for (let pixel = 0; pixel < size * size; pixel += 2) {
      const index = (p: number) => frame.rgba[p * 4 + 3] ? lookup.get(color(frame.rgba, p * 4))! : 0;
      bytes[at + pixel / 2] = index(pixel) | (index(pixel + 1) << 4);
    }
  });
  validateFollowerResource(bytes, profile); return bytes;
}

export function buildFollowerCatalog(personal: readonly Uint8Array[], appearances: readonly FollowerStockAppearance[], descriptors: Uint8Array, resources: readonly Uint8Array[], speciesMax = 649): FollowerRegistry {
  if (descriptors.length !== 4 + FOLLOWING_STOCK_ROWS * 28 || readU32(descriptors, 0) !== FOLLOWING_STOCK_ROWS) throw new Error("Unexpected stock descriptor registry.");
  const keys = enumerateFollowerAppearances(personal, speciesMax);
  if (keys.length > FOLLOWING_MAX_ASSETS) throw new Error("Too many appearances for the audited extension range.");
  const entries = keys.map((key, i): FollowerAssetEntry => {
    const matches = (form: number) => appearances.find(a => a.species === key.species && a.form === form && a.gender === key.gender)
      ?? appearances.find(a => a.species === key.species && a.form === form && a.gender === 2);
    const exact = matches(key.form), base = exact ?? matches(0);
    const appearance = base ?? appearances.find(a => a.species === 1 && a.form === 0);
    if (!appearance) throw new Error("Stock placeholder source is missing.");
    const row = stockFollowerRow(appearance.code), at = 4 + row * 28;
    if (readU16(descriptors, at) !== appearance.code) throw new Error("Stock appearance references a different object code.");
    const resourceId = readU16(descriptors, at + 16), resource = resources[resourceId];
    if (!resource) throw new Error("Missing stock billboard resource.");
    const file = parseBtx(resource), size = file.textures[0]?.width;
    if (size !== 32 && size !== 64) throw new Error("Unexpected stock billboard dimensions.");
    const profile = file.textures.length === 8 ? "pokemon-asymmetric" : "pokemon-mirrored";
    validateFollowerResource(resource, profile);
    const reasons = [!base ? "Species artwork missing; Bulbasaur placeholder." : !exact ? "Form artwork missing; base-form placeholder." : "", key.shiny ? "Shiny palette missing; normal palette placeholder." : ""].filter(Boolean);
    return { key, descriptorRow: FOLLOWING_STOCK_ROWS + i, sourceDescriptorRow: row, resourceId, size, animationProfile: profile,
      offsets: [13, 14, 15].map(j => (descriptors[at + j] << 24) >> 24) as [number, number, number],
      placeholder: reasons.length > 0, placeholderReason: reasons.join(" ") || undefined,
      source: "stock", sourceLabel: `Object 0x${appearance.code.toString(16)}, resource ${resourceId}` };
  });
  const registry: FollowerRegistry = { runtimeAbi: FOLLOWING_ABI, entries, zones: [], descriptorCount: FOLLOWING_STOCK_ROWS + entries.length, resourceCount: resources.length };
  validateFollowerRegistry(registry); return registry;
}
