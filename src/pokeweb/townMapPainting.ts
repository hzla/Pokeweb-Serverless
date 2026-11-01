import type { NitroBackgroundImage } from "./nitroBg";
import { townMapArtworkPixels, TOWN_MAP_TRANSPARENT_PIXEL as CLEAR, type TownMapArtworkPatch, type TownMapArtworkRect } from "./townMapArtwork";
import type { TownMapPoint } from "./townMapModel";

export type TownMapCitySize = "small" | "large";
export type TownMapCityPaint = { kind: "city"; center: TownMapPoint; size: TownMapCitySize };
export type TownMapRoutePaint = { kind: "route"; start: TownMapPoint; end: TownMapPoint };
export type TownMapPaintSpec = TownMapCityPaint | TownMapRoutePaint;
// Native Front palette roles. Resolve through the current palette, including edits.
export const TOWN_MAP_PAINT_INKS = { A: 193, D: 194, G: 195, J: 196, H: 197, I: 202, B: 205, C: 206 } as const;
type Ink = keyof typeof TOWN_MAP_PAINT_INKS;
const CITY_STENCILS: Record<TownMapCitySize, readonly string[]> = {
  small: [".JDAADJ.", "JAAAAAAJ", "DAGCCGAD", "AACCCCAA", "AACCCCAA", "DAGCCGAD", "JAAAAAAJ", "BJDAADJB", "IBBBBBBI", ".IBBBBI."],
  large: ["...GDAADG...", "..DAAAAAAD..", ".DAAGHHGAAD.", "GAAHCCCCHAAG", "DAGCCCCCCGAD", "AAHCCCCCCHAA", "AAHCCCCCCHAA", "DAGCCCCCCGAD", "JAAHCCCCHAAJ", "BDAAGHHGAADB", "IBDAAAAAADBI", ".BBJDAADJBB.", ".IBBBBBBBBI.", "...IBBBBI..."],
};
export type TownMapPaintSource = { pixels: Uint16Array; roles: ReadonlyMap<number, Ink>; cities: Uint8Array };
const rgbKey = (c: readonly number[]) => c[0] | c[1] << 8 | c[2] << 16;
const coverage: Partial<Record<Ink, number>> = { A: 64, D: 48, G: 32, J: 16 };

/** Detect gray-centered native city symbols, without depending on area positions. */
function cityMask(pixels: Uint16Array, roles: ReadonlyMap<number, Ink>): Uint8Array {
  const mask = new Uint8Array(65536), seen = new Uint8Array(65536);
  for (let at = 0; at < pixels.length; at++) {
    if (seen[at] || roles.get(pixels[at]) !== "C") continue;
    const pending = [at]; seen[at] = 1;
    let left = at % 256, right = left, top = at >> 8, bottom = top;
    while (pending.length) {
      const i = pending.pop()!, x = i % 256, y = i >> 8;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const n of [x ? i - 1 : -1, x < 255 ? i + 1 : -1, i - 256, i + 256]) {
        if (n < 0 || n >= 65536 || seen[n] || roles.get(pixels[n]) !== "C") continue;
        seen[n] = 1; pending.push(n);
      }
    }
    const diameter = Math.max(right - left + 1, bottom - top + 1);
    if (diameter < 3) continue;
    const pad = diameter <= 4 ? 2 : diameter <= 6 ? 3 : 4;
    for (let y = Math.max(0, top - pad); y <= Math.min(255, bottom + pad); y++) for (let x = Math.max(0, left - pad); x <= Math.min(255, right + pad); x++) {
      const i = y * 256 + x, role = roles.get(pixels[i]);
      if (role && role !== "B" && role !== "I") mask[i] = 1;
    }
  }
  return mask;
}

export function createTownMapPaintSource(image: NitroBackgroundImage): TownMapPaintSource {
  if (image.width !== 256 || image.height !== 256 || image.indexed.bitsPerPixel !== 8 || image.indexed.palette.length < 256)
    throw new Error("City and Route tools require the native Front layer.");
  const palette = image.indexed.palette, roles = new Map<number, Ink>(), colors = new Map<number, Ink>();
  for (const [role, ink] of Object.entries(TOWN_MAP_PAINT_INKS) as [Ink, number][]) {
    if (!palette[ink] || palette[ink][3] === 0) throw new Error("The Front layer's native painting colors are missing.");
    colors.set(rgbKey(palette[ink]), role);
  }
  // Recognize equivalent colors in other banks without changing their relationships.
  palette.forEach((color, ink) => { const role = colors.get(rgbKey(color)); if (ink % 256 && role) roles.set(ink, role); });
  for (const [role, ink] of Object.entries(TOWN_MAP_PAINT_INKS) as [Ink, number][]) roles.set(ink, role);
  const pixels = townMapArtworkPixels(image);
  return { pixels, roles, cities: cityMask(pixels, roles) };
}

export function snapTownMapPaintPoint(point: TownMapPoint, snap: boolean): TownMapPoint {
  const step = snap ? 8 : 1;
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
}
export function townMapRouteMetrics(route: TownMapRoutePaint): { length: number; angle: number } {
  const dx = route.end.x - route.start.x, dy = route.end.y - route.start.y;
  return { length: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360 };
}
export function townMapRouteEndpoint(start: TownMapPoint, length: number, angle: number, snap = false): TownMapPoint {
  if (!Number.isFinite(length) || length <= 0 || length > 362 || !Number.isFinite(angle)) throw new Error("Use a positive route length up to 362 pixels and a finite angle.");
  const radians = (angle % 360) * Math.PI / 180;
  return snapTownMapPaintPoint({ x: start.x + length * Math.cos(radians), y: start.y + length * Math.sin(radians) }, snap);
}
function pointValid(point: TownMapPoint) {
  if (![point.x, point.y].every(Number.isInteger) || point.x < 0 || point.y < 0 || point.x > 255 || point.y > 255) throw new Error("Keep painting coordinates inside the 256 × 256 map.");
}
function boundsValid(rect: TownMapArtworkRect) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > 256 || rect.y + rect.height > 256) throw new Error("Keep the complete shape and its shadow inside the map.");
}
function patch(rect: TownMapArtworkRect, pixels: Uint16Array): TownMapArtworkPatch {
  const result = new Uint16Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row++) result.set(pixels.subarray((rect.y + row) * 256 + rect.x, (rect.y + row) * 256 + rect.x + rect.width), row * rect.width);
  return { rect, pixels: result };
}

export function createTownMapCityPatch(source: TownMapPaintSource, spec: TownMapCityPaint): TownMapArtworkPatch {
  pointValid(spec.center);
  const rows = CITY_STENCILS[spec.size]; if (!rows) throw new Error("Choose a native city size.");
  const width = rows[0].length, rect = { x: spec.center.x - width / 2, y: spec.center.y - width / 2, width, height: rows.length };
  boundsValid(rect);
  const pixels = source.pixels.slice();
  rows.forEach((row, y) => [...row].forEach((symbol, x) => {
    if (symbol === ".") return;
    const at = (rect.y + y) * 256 + rect.x + x, role = symbol as Ink;
    // Preserve routes entering beneath the city, while the ring and center cover them.
    if ((role === "B" || role === "I") && coverage[source.roles.get(pixels[at])!]) return;
    pixels[at] = TOWN_MAP_PAINT_INKS[role];
  }));
  return patch(rect, pixels);
}

/** 8×8 fixed sampling gives deterministic pixel contours for every angle. */
export function createTownMapRoutePatch(source: TownMapPaintSource, spec: TownMapRoutePaint): TownMapArtworkPatch {
  pointValid(spec.start); pointValid(spec.end);
  // Canonical endpoint order makes reversing a line byte-identical.
  const [a, b] = spec.start.x < spec.end.x || spec.start.x === spec.end.x && spec.start.y < spec.end.y ? [spec.start, spec.end] : [spec.end, spec.start];
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!length) throw new Error("Drag a route with two different endpoints.");
  const tx = dx / length, ty = dy / length, nx = -ty, ny = tx;
  const left = Math.floor(Math.min(a.x - nx, a.x + nx, b.x - nx, b.x + nx));
  const right = Math.ceil(Math.max(a.x - nx, a.x + nx, b.x - nx, b.x + nx));
  const top = Math.floor(Math.min(a.y - ny, a.y + ny, b.y - ny, b.y + ny));
  const bottom = Math.ceil(Math.max(a.y - ny, a.y + ny, b.y - ny, b.y + ny));
  const rect = { x: left, y: top, width: right - left, height: bottom - top + 2 }; boundsValid(rect);
  const stroke = new Uint8Array(rect.width * (rect.height - 2)), reach = (Math.abs(tx) + Math.abs(ty)) / 2;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const cx = x + .5 - a.x, cy = y + .5 - a.y, alongCenter = cx * tx + cy * ty;
    if (alongCenter < -reach || alongCenter > length + reach || Math.abs(cx * nx + cy * ny) > 1 + reach) continue;
    let hits = 0;
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const px = x + (sx + .5) / 8 - a.x, py = y + (sy + .5) / 8 - a.y;
      const along = px * tx + py * ty, across = px * nx + py * ny;
      if (along >= -1e-9 && along < length && Math.abs(across) < 1) hits++;
    }
    stroke[(y - top) * rect.width + x - left] = hits;
  }
  const pixels = source.pixels.slice();
  // Shadows go beneath all existing yellow cores. Additive core union removes seams.
  for (let i = 0; i < stroke.length; i++) {
    const weight = stroke[i]; if (!weight) continue;
    const x = left + i % rect.width, y = top + Math.floor(i / rect.width), at = (y + 2) * 256 + x;
    const role = source.roles.get(source.pixels[at]);
    if (source.cities[at] || role && coverage[role]) continue;
    if (pixels[at] === CLEAR || role === "I" || role === "B") pixels[at] = role === "B" || weight >= 24 ? TOWN_MAP_PAINT_INKS.B : TOWN_MAP_PAINT_INKS.I;
  }
  for (let i = 0; i < stroke.length; i++) {
    const weight = stroke[i]; if (!weight) continue;
    const at = (top + Math.floor(i / rect.width)) * 256 + left + i % rect.width;
    if (source.cities[at]) continue;
    const oldWeight = coverage[source.roles.get(source.pixels[at])!] ?? 0;
    if (oldWeight >= weight) continue;
    pixels[at] = weight >= 56 ? TOWN_MAP_PAINT_INKS.A : weight >= 40 ? TOWN_MAP_PAINT_INKS.D : weight >= 24 ? TOWN_MAP_PAINT_INKS.G : TOWN_MAP_PAINT_INKS.J;
  }
  return patch(rect, pixels);
}
export function createTownMapPaintPatch(source: TownMapPaintSource, spec: TownMapPaintSpec): TownMapArtworkPatch {
  return spec.kind === "city" ? createTownMapCityPatch(source, spec) : createTownMapRoutePatch(source, spec);
}
