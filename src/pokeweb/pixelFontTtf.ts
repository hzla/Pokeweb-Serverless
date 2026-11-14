/**
 * Builds a TrueType font from a bitmap font, so web text can use a game's own glyphs. Each glyph's pixels become
 * outlines on a pixel grid: at a font size of `pixelsPerEm` CSS px, one glyph pixel is one CSS px, and text stays
 * crisp at whole multiples of that size. The font lives only in the browser (FontFace); nothing is written to disk.
 */

export type PixelGlyph = {
  /** Unicode code point (Basic Multilingual Plane). */
  code: number;
  /** Pen advance in pixels. */
  advance: number;
  /** Where the bitmap starts relative to the pen, in pixels. */
  left: number;
  width: number;
  height: number;
  /** Row-major, `width` × `height`; non-zero is ink. */
  pixels: Uint8Array;
};

export type PixelFontSpec = {
  family: string;
  /** "Regular", "Bold"… */
  style: string;
  bold?: boolean;
  /** Bitmap rows above the baseline. */
  ascent: number;
  /** Bitmap rows below the baseline. */
  descent: number;
  /** The font size, in pixels, at which one glyph pixel is one pixel. */
  pixelsPerEm: number;
  glyphs: PixelGlyph[];
};

const UNIT = 64;

type Point = [number, number];

/** The outline of a pixel set: closed loops, clockwise around ink, in font units (y up, baseline at 0). */
export function traceOutline(glyph: PixelGlyph, ascent: number): Point[][] {
  const { width, height, pixels } = glyph;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && pixels[y * width + x] !== 0;
  // Edges on the pixel-corner lattice, (column, row) with rows counted down from the bitmap's top.
  const edges = new Map<string, Array<[number, number]>>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = `${x0},${y0}`;
    const list = edges.get(key) ?? [];
    list.push([x1, y1]);
    edges.set(key, list);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!on(x, y)) continue;
      // Clockwise once y points up: up the left side, right along the top, down the right, left along the bottom.
      if (!on(x - 1, y)) add(x, y + 1, x, y);
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    }
  }
  const loops: Point[][] = [];
  const take = (x: number, y: number, from?: [number, number]): [number, number] | undefined => {
    const key = `${x},${y}`;
    const list = edges.get(key);
    if (!list?.length) return undefined;
    let index = 0;
    if (list.length > 1 && from) {
      // Where two loops touch at a corner, keep them apart: turn right (clockwise) first.
      const [dx, dy] = [x - from[0], y - from[1]];
      const right: [number, number] = [-dy, dx];
      const found = list.findIndex(([nx, ny]) => nx - x === right[0] && ny - y === right[1]);
      if (found >= 0) index = found;
    }
    const [next] = list.splice(index, 1);
    if (!list.length) edges.delete(key);
    return next;
  };
  while (edges.size) {
    const startKey = edges.keys().next().value as string;
    const [sx, sy] = startKey.split(",").map(Number) as [number, number];
    const loop: Array<[number, number]> = [[sx, sy]];
    let previous: [number, number] | undefined;
    let current: [number, number] = [sx, sy];
    for (let guard = 0; guard < 100000; guard++) {
      const next = take(current[0], current[1], previous);
      if (!next) break;
      if (next[0] === sx && next[1] === sy) break;
      loop.push(next);
      previous = current;
      current = next;
    }
    // Drop points in the middle of straight runs.
    const simplified = loop.filter((point, index) => {
      const before = loop[(index + loop.length - 1) % loop.length]!;
      const after = loop[(index + 1) % loop.length]!;
      return !((before[0] === point[0] && point[0] === after[0]) || (before[1] === point[1] && point[1] === after[1]));
    });
    if (simplified.length >= 3) {
      loops.push(simplified.map(([x, y]) => [(glyph.left + x) * UNIT, (ascent - y) * UNIT]));
    }
  }
  return loops;
}

/** Thickens a glyph by one pixel to the right, the usual way pixel fonts are made bold. */
export function emboldenGlyph(glyph: PixelGlyph): PixelGlyph {
  const width = glyph.width + 1;
  const pixels = new Uint8Array(width * glyph.height);
  for (let y = 0; y < glyph.height; y++) {
    for (let x = 0; x < glyph.width; x++) {
      if (!glyph.pixels[y * glyph.width + x]) continue;
      pixels[y * width + x] = 1;
      pixels[y * width + x + 1] = 1;
    }
  }
  return { ...glyph, width, pixels, advance: glyph.advance + (glyph.pixels.some(Boolean) ? 1 : 0) };
}

class Writer {
  bytes: number[] = [];
  u8(value: number) { this.bytes.push(value & 0xff); return this; }
  u16(value: number) { this.bytes.push((value >>> 8) & 0xff, value & 0xff); return this; }
  i16(value: number) { return this.u16(value < 0 ? value + 0x10000 : value); }
  u32(value: number) { this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff); return this; }
  tag(text: string) { for (let i = 0; i < 4; i++) this.u8(text.charCodeAt(i)); return this; }
  zeros(count: number) { for (let i = 0; i < count; i++) this.bytes.push(0); return this; }
  pad4() { while (this.bytes.length % 4) this.bytes.push(0); return this; }
  append(bytes: readonly number[]) { for (const byte of bytes) this.bytes.push(byte); return this; }
}

function checksum(bytes: number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + (((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>> 0;
  }
  return sum;
}

export function buildPixelTtf(spec: PixelFontSpec): ArrayBuffer {
  const glyphs = [...spec.glyphs].filter((glyph) => glyph.code > 0 && glyph.code < 0xfffe).sort((a, b) => a.code - b.code);
  const unitsPerEm = spec.pixelsPerEm * UNIT;
  const ascender = spec.ascent * UNIT;
  const descender = -spec.descent * UNIT;

  // glyf and loca. Glyph 0 is .notdef, an empty box.
  const glyf = new Writer();
  const loca: number[] = [];
  const metrics: Array<[number, number]> = [];
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0, maxPoints = 0, maxContours = 0, advanceMax = 0, minLsb = 0, minRsb = 0, xMaxExtent = 0;
  const notdef: PixelGlyph = { code: 0, advance: 6, left: 0, width: 0, height: 0, pixels: new Uint8Array() };
  for (const glyph of [notdef, ...glyphs]) {
    loca.push(glyf.bytes.length);
    const loops = glyph.width ? traceOutline(glyph, spec.ascent) : [];
    const advance = glyph.advance * UNIT;
    advanceMax = Math.max(advanceMax, advance);
    if (!loops.length) {
      metrics.push([advance, 0]);
      continue;
    }
    const xs = loops.flat().map((point) => point[0]);
    const ys = loops.flat().map((point) => point[1]);
    const gxMin = Math.min(...xs), gxMax = Math.max(...xs), gyMin = Math.min(...ys), gyMax = Math.max(...ys);
    xMin = Math.min(xMin, gxMin); yMin = Math.min(yMin, gyMin); xMax = Math.max(xMax, gxMax); yMax = Math.max(yMax, gyMax);
    minLsb = Math.min(minLsb, gxMin); minRsb = Math.min(minRsb, advance - gxMax); xMaxExtent = Math.max(xMaxExtent, gxMax);
    const points = loops.reduce((count, loop) => count + loop.length, 0);
    maxPoints = Math.max(maxPoints, points); maxContours = Math.max(maxContours, loops.length);
    metrics.push([advance, gxMin]);
    glyf.i16(loops.length).i16(gxMin).i16(gyMin).i16(gxMax).i16(gyMax);
    let end = -1;
    for (const loop of loops) { end += loop.length; glyf.u16(end); }
    glyf.u16(0); // no instructions
    for (let i = 0; i < points; i++) glyf.u8(1); // on-curve, 16-bit deltas
    let last = 0;
    for (const loop of loops) for (const [x] of loop) { glyf.i16(x - last); last = x; }
    last = 0;
    for (const loop of loops) for (const [, y] of loop) { glyf.i16(y - last); last = y; }
    glyf.pad4();
  }
  loca.push(glyf.bytes.length);
  const numGlyphs = glyphs.length + 1;

  const head = new Writer()
    .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(unitsPerEm)
    .zeros(16)
    .i16(xMin).i16(yMin).i16(xMax).i16(yMax)
    .u16(spec.bold ? 1 : 0).u16(8).i16(2).i16(1).i16(0);
  const hhea = new Writer()
    .u32(0x00010000).i16(ascender).i16(descender).i16(0).u16(advanceMax).i16(minLsb).i16(minRsb).i16(xMaxExtent)
    .i16(1).i16(0).i16(0).zeros(8).i16(0).u16(numGlyphs);
  const maxp = new Writer()
    .u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(2).zeros(18);
  const hmtx = new Writer();
  for (const [advance, lsb] of metrics) hmtx.u16(advance).i16(lsb);
  const locaTable = new Writer();
  for (const offset of loca) locaTable.u32(offset);
  const post = new Writer().u32(0x00030000).u32(0).i16(-UNIT).i16(UNIT).u32(0).zeros(16);

  // cmap: format 4, one segment per run of consecutive codes (glyph ids follow code order).
  const segments: Array<[number, number, number]> = [];
  glyphs.forEach((glyph, index) => {
    const id = index + 1;
    const last = segments[segments.length - 1];
    if (last && glyph.code === last[1] + 1 && id - glyph.code === last[2]) last[1] = glyph.code;
    else segments.push([glyph.code, glyph.code, id - glyph.code]);
  });
  segments.push([0xffff, 0xffff, 1]);
  const segX2 = segments.length * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segments.length));
  const sub = new Writer().u16(4).u16(16 + segments.length * 8).u16(0).u16(segX2).u16(searchRange)
    .u16(Math.log2(searchRange / 2)).u16(segX2 - searchRange);
  for (const [, end] of segments) sub.u16(end);
  sub.u16(0);
  for (const [start] of segments) sub.u16(start);
  for (const [, , delta] of segments) sub.u16((delta + 0x10000) & 0xffff);
  for (let i = 0; i < segments.length; i++) sub.u16(0);
  const cmap = new Writer().u16(0).u16(1).u16(3).u16(1).u32(12);
  cmap.append(sub.bytes);

  const names: Array<[number, string]> = [
    [1, spec.family], [2, spec.style], [3, `${spec.family} ${spec.style}`], [4, `${spec.family} ${spec.style}`],
    [6, `${spec.family}-${spec.style}`.replace(/[^A-Za-z0-9-]/gu, "")],
  ];
  const name = new Writer().u16(0).u16(names.length).u16(6 + names.length * 12);
  const strings = new Writer();
  for (const [id, text] of names) {
    name.u16(3).u16(1).u16(0x409).u16(id).u16(text.length * 2).u16(strings.bytes.length);
    for (const char of text) strings.u16(char.charCodeAt(0));
  }
  name.append(strings.bytes);

  const capHeight = Math.round(spec.ascent * 0.75) * UNIT;
  const os2 = new Writer()
    .u16(4).i16(Math.round(advanceMax / 2)).u16(spec.bold ? 700 : 400).u16(5).u16(0)
    .i16(unitsPerEm / 2).i16(unitsPerEm / 2).i16(0).i16(UNIT * 2)
    .i16(unitsPerEm / 2).i16(unitsPerEm / 2).i16(0).i16(UNIT * 4)
    .i16(UNIT).i16(Math.round(ascender / 3)).i16(0)
    .zeros(10).zeros(16).tag("NONE")
    .u16(spec.bold ? 0x20 : 0x40)
    .u16(glyphs[0]?.code ?? 32).u16(Math.min(glyphs[glyphs.length - 1]?.code ?? 32, 0xffff))
    .i16(ascender).i16(descender).i16(0).u16(Math.max(ascender, yMax)).u16(Math.max(-descender, -yMin))
    .u32(1).u32(0)
    .i16(Math.round(capHeight * 0.75)).i16(capHeight).u16(0).u16(32).u16(0);

  const tables: Array<[string, number[]]> = [
    ["OS/2", os2.bytes], ["cmap", cmap.bytes], ["glyf", glyf.bytes], ["head", head.bytes], ["hhea", hhea.bytes],
    ["hmtx", hmtx.bytes], ["loca", locaTable.bytes], ["maxp", maxp.bytes], ["name", name.bytes], ["post", post.bytes],
  ];
  const font = new Writer();
  const count = tables.length;
  const range = 16 * 2 ** Math.floor(Math.log2(count));
  font.u32(0x00010000).u16(count).u16(range).u16(Math.log2(range / 16)).u16(count * 16 - range);
  let offset = 12 + count * 16;
  const records: Array<[string, number, number, number]> = [];
  for (const [tag, bytes] of tables) {
    records.push([tag, checksum(bytes), offset, bytes.length]);
    offset += Math.ceil(bytes.length / 4) * 4;
  }
  for (const [tag, sum, at, length] of records) font.tag(tag).u32(sum).u32(at).u32(length);
  let headAt = 0;
  for (const [tag, bytes] of tables) {
    if (tag === "head") headAt = font.bytes.length;
    font.append(bytes);
    font.pad4();
  }
  const adjustment = (0xb1b0afba - checksum(font.bytes)) >>> 0;
  const out = new Uint8Array(font.bytes);
  new DataView(out.buffer).setUint32(headAt + 8, adjustment);
  return out.buffer;
}
