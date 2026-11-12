import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { itemSpriteTableFromPointers } from "./itemSpriteTable";
import { getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import type { RgbColor } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";
import type { RgbaImageData } from "./pokemonSpriteModel";

const SIZE = 32;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Weighted median cut over the small 15-bit DS color space. */
function quantizeItemColors(counts: Map<number, number>): RgbColor[] {
  type Color = { channels: [number, number, number]; count: number };
  const colors: Color[] = [...counts].map(([value, count]) => ({ channels: [value & 31, (value >> 5) & 31, (value >> 10) & 31], count }));
  const buckets: Color[][] = [colors];
  const ranges = (bucket: Color[]) => [0, 1, 2].map(i => Math.max(...bucket.map(c => c.channels[i])) - Math.min(...bucket.map(c => c.channels[i])));
  while (buckets.length < 15) {
    let selected = -1, best = 0;
    buckets.forEach((bucket, i) => { const score = Math.max(...ranges(bucket)); if (bucket.length > 1 && score > best) { best = score; selected = i; } });
    if (selected < 0) break;
    const bucket = buckets.splice(selected, 1)[0], range = ranges(bucket), channel = range.indexOf(Math.max(...range));
    bucket.sort((a, b) => a.channels[channel] - b.channels[channel]);
    const half = bucket.reduce((sum, c) => sum + c.count, 0) / 2; let split = 0, weight = 0;
    while (split < bucket.length - 1 && weight < half) weight += bucket[split++].count;
    buckets.push(bucket.slice(0, split), bucket.slice(split));
  }
  return buckets.map(bucket => {
    const count = bucket.reduce((sum, c) => sum + c.count, 0);
    const channel = (i: number) => Math.round(bucket.reduce((sum, c) => sum + c.channels[i] * c.count, 0) / count) * 255 / 31;
    return { r: channel(0), g: channel(1), b: channel(2) };
  });
}

/** Position and quantize a source image to the native 32px, 15-color icon. */
export function prepareItemSprite(image: RgbaImageData, x: number, y: number, keyBackground = false): { image: RgbaImageData; colors: RgbColor[]; indices: Uint8Array } {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096 || image.pixels.length !== image.width * image.height * 4) throw Error("Invalid source image.");
  if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 4096 || Math.abs(y) > 4096) throw Error("Invalid sprite position.");
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4), key = image.pixels.subarray(0, 3);
  for (let sy = 0; sy < image.height; ++sy) for (let sx = 0; sx < image.width; ++sx) {
    const dx = sx + x, dy = sy + y;
    if (dx < 0 || dx >= SIZE || dy < 0 || dy >= SIZE) continue;
    const src = (sy * image.width + sx) * 4, dst = (dy * SIZE + dx) * 4;
    if (image.pixels[src + 3] < 128 || keyBackground && image.pixels[src] === key[0] && image.pixels[src + 1] === key[1] && image.pixels[src + 2] === key[2]) continue;
    pixels.set(image.pixels.subarray(src, src + 3), dst); pixels[dst + 3] = 255;
  }
  // Merge colors representable by the DS before reducing to 15 opaque entries.
  const counts = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
    const value = (pixels[i] >> 3) | (pixels[i + 1] >> 3) << 5 | (pixels[i + 2] >> 3) << 10;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    pixels[i] = (value & 31) * 255 / 31; pixels[i + 1] = ((value >> 5) & 31) * 255 / 31; pixels[i + 2] = ((value >> 10) & 31) * 255 / 31;
  }
  let colors: RgbColor[];
  if (counts.size <= 15) colors = [...counts.keys()].map(v => ({ r: Math.round((v & 31) * 255 / 31), g: Math.round(((v >> 5) & 31) * 255 / 31), b: Math.round(((v >> 10) & 31) * 255 / 31) }));
  else colors = quantizeItemColors(counts);
  colors = colors.map(c => ({ r: Math.round((c.r >> 3) * 255 / 31), g: Math.round((c.g >> 3) * 255 / 31), b: Math.round((c.b >> 3) * 255 / 31) }));
  const indices = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < indices.length; ++p) if (pixels[p * 4 + 3]) {
    let best = 0, distance = Infinity;
    colors.forEach((c, i) => { const d = (c.r - pixels[p * 4]) ** 2 + (c.g - pixels[p * 4 + 1]) ** 2 + (c.b - pixels[p * 4 + 2]) ** 2; if (d < distance) { best = i; distance = d; } });
    indices[p] = best + 1; const c = colors[best]; pixels.set([c.r, c.g, c.b, 255], p * 4);
  }
  return { image: { width: SIZE, height: SIZE, pixels }, colors, indices };
}

function archive(project: ProjectState, romBytes: Uint8Array) {
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  if (!["IRBO", "IRAO", "IREO", "IRDO"].includes(rom.idCode) || rom.data[30] !== 0) throw Error("Item sprites require a supported US revision-0 Gen 5 ROM.");
  const fileId = rom.filenames.idOf("a/0/2/5"); if (fileId === undefined) throw Error("Item sprite archive not found.");
  const narc = new NARC(getRomFileBytes(project, rom, fileId));
  const at = itemSpriteTableFromPointers(project.arm9, project.session.baseVersion, rom.arm9RamAddress) ?? -1;
  const valid = (offset: number) => offset >= 0 && offset + 639 * 4 <= project.arm9.length && [1, 2, 3, 50, 100].every(id => {
    const g = narc.files[readU16(project.arm9, offset + id * 4)], p = narc.files[readU16(project.arm9, offset + id * 4 + 2)];
    return g && p && readAscii(g, 0, 4) === "RGCN" && readAscii(p, 0, 4) === "RLCN";
  });
  if (!valid(at)) throw Error("Unrecognized item sprite table or archive.");
  return { narc, fileId, table: at };
}
function checkFormats(graphic: Uint8Array, palette: Uint8Array) {
  if (readAscii(graphic, 0, 4) !== "RGCN" || readAscii(graphic, 16, 4) !== "RAHC" || readU32(graphic, 32) !== 16 || readU32(graphic, 40) !== 512 || graphic.length < 48 + 512) throw Error("Unsupported item graphic layout.");
  if (readAscii(palette, 0, 4) !== "RLCN" || readAscii(palette, 16, 4) !== "TTLP" || readU32(palette, 32) < 32 || palette.length < 72) throw Error("Unsupported item palette layout.");
}
/**
 * Items above the native range (item expansion: 639-1023, or 627-1023 on Black / White) keep their icon members in
 * the project, not in the ARM9 table (639 entries, 627 on Black / White).
 */
const nativeItemCount = (project: ProjectState) => project.session.baseRom === "BW" ? 627 : 639;
const expandedIconNone = (project: ProjectState): [number, number] => project.session.baseRom === "BW" ? [1001, 1002] : [1021, 1022];
function iconMembers(project: ProjectState, table: number, itemId: number): [number, number] {
  if (itemId < nativeItemCount(project)) return [readU16(project.arm9, table + itemId * 4), readU16(project.arm9, table + itemId * 4 + 2)];
  return project.codeInjection?.itemExpansion?.icons?.[itemId] ?? expandedIconNone(project);
}
function files(project: ProjectState, romBytes: Uint8Array, itemId: number, paletteOverride?: number) {
  const a = archive(project, romBytes);
  const native = nativeItemCount(project);
  const limit = project.codeInjection?.itemExpansion ? 1024 : native;
  if (!Number.isInteger(itemId) || itemId < 1 || itemId >= limit) throw Error(limit === native ? "Item ID is outside the native icon table." : "Item ID is outside the expanded item range.");
  const [graphicId, paletteId] = iconMembers(project, a.table, itemId);
  const graphic = a.narc.files[graphicId], palette = a.narc.files[paletteOverride ?? paletteId];
  if (!graphic || !palette) throw Error("Item sprite is missing."); checkFormats(graphic, palette); return { ...a, graphic, palette };
}
/** `paletteOverride` draws the item's graphic with another palette member, e.g. a TM disc in a type's colour. */
export function readItemSprite(project: ProjectState, romBytes: Uint8Array, itemId: number, paletteOverride?: number): RgbaImageData {
  const { graphic, palette } = files(project, romBytes, itemId, paletteOverride), pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; ++y) for (let x = 0; x < SIZE; ++x) {
    const tile = (y >> 3) * 4 + (x >> 3), v = graphic[48 + tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)], i = x & 1 ? v >> 4 : v & 15;
    if (!i) continue; const c = readU16(palette, 40 + i * 2), dst = (y * SIZE + x) * 4;
    pixels.set([Math.round((c & 31) * 255 / 31), Math.round(((c >> 5) & 31) * 255 / 31), Math.round(((c >> 10) & 31) * 255 / 31), 255], dst);
  }
  return { width: SIZE, height: SIZE, pixels };
}
export function writeItemSprite(project: ProjectState, romBytes: Uint8Array, itemId: number, image: RgbaImageData, x: number, y: number, keyBackground: boolean): void {
  const { narc, fileId, table, graphic, palette } = files(project, romBytes, itemId), prepared = prepareItemSprite(image, x, y, keyBackground);
  const g = graphic.slice(), p = palette.slice(); g.fill(0, 48, 560);
  for (let y = 0; y < SIZE; ++y) for (let x = 0; x < SIZE; ++x) {
    const tile = (y >> 3) * 4 + (x >> 3), at = 48 + tile * 32 + (y & 7) * 4 + ((x & 7) >> 1), value = prepared.indices[y * SIZE + x]; g[at] |= value << (x & 1 ? 4 : 0);
  }
  for (let i = 0; i < 16; ++i) { const c = prepared.colors[i - 1]; writeU16(p, 40 + i * 2, c ? (c.r >> 3) | (c.g >> 3) << 5 | (c.b >> 3) << 10 : 0); }
  const index = (bytes: Uint8Array) => { const existing = narc.files.findIndex(member => same(member, bytes)); if (existing >= 0) return existing; if (narc.files.length >= 65536) throw Error("Item sprite archive is full."); narc.files.push(bytes); return narc.files.length - 1; };
  const graphicId = index(g), paletteId = index(p), output = narc.save();
  setRomFileReplacement(project, fileId, output);
  if (itemId >= nativeItemCount(project)) {
    const state = project.codeInjection!.itemExpansion!;
    state.icons = { ...state.icons, [itemId]: [graphicId, paletteId] };
  } else { writeU16(project.arm9, table + itemId * 4, graphicId); writeU16(project.arm9, table + itemId * 4 + 2, paletteId); project.arm9Dirty = true; }
  recordGenericChange(project, "items", "Item sprite imported.", `Item ${itemId}`, { key: `item:${itemId}:sprite` });
}
