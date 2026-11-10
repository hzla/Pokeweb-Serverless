import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decodeGifFrames, type AnimationAnalysisFrame } from "./gifAnimationFrames";
import { compressLz11Literal, decompressNitro } from "./pokemonSpriteModel";
import { applyPwanColorPreset, compilePwanAnimationFrames, prepareRgb555PaletteFrames, type PwanColorPreset, type PwanCompileResult } from "./pwanCompiler";
import { decodeW2AnimLz, encodeW2AnimLz10 } from "./w2animCodec";

/**
 * Full-size animated sprites for the streaming runtime: up to 128x128, streamed as an A3I5 texture (8 bpp: palette
 * index | alpha << 5) through one quad covering the art's box, instead of the 96x96 4 bpp PWAN. The design and the
 * placement rules are White2Upgrade's (tools/w2anim/a3i5.py, docs/megab2w2-integration.md "A3I5 sprites").
 *
 * MANI: flags own palettes | ticks | morph; the morph block at 0x1C holds the box's top-left relative to the sprite's
 * ground point (y down) and the evolution renderer's 16 -> 15 colour map. Palettes: index 0 unused (transparency is
 * the alpha), the art's colours at 1..15.
 */

export const FULL_SIZE_MAX = 128;
const ROW = 128;
const MANI_OWN = 1, MANI_TICKS = 4, MANI_MORPH = 8;
const MORPH_OFFSET = 0x1c;
const MORPH_BYTES = 36;
const GROUND_ROW = 88; // a PWAN carrier's ground point: canvas row 88 of its 96x96 frame
const PWAN_GROUND = 95; // Pokeweb grounds a PWAN on its frame's last row
const SCREEN_TOP_ROW = { front: -6, back: -22 } as const; // highest canvas row on screen over the ground point
const MAX_SINK = 8;
const BACK_TOP_ROW = 0;
const ALPHA_THRESHOLD = 128;
const OPAQUE = 7 << 5;
const TEMPLATE_BLOCK = 11; // Metapod: one cell, whose animation files are reused (its idle bob removed)
const FILES_PER_SPRITE = 20;

export type FullSizeSide = "front" | "back";
export type FullSizeStream = {
  mani: Uint8Array;
  width: number;
  height: number;
  /** The box's top-left relative to the ground point (y down). */
  x0: number;
  y0: number;
};
export type FullSizeCompileResult = FullSizeStream & {
  /** The same GIF as a 96x96 PWAN, for previews and for the PWAN runtime. */
  preview: PwanCompileResult;
  uniqueFrameCount: number;
  warnings: string[];
};

export function gifFitsPwan(bytes: Uint8Array): boolean {
  const frame = decodeGifFrames(bytes)[0];
  return !frame || (frame.width <= 96 && frame.height <= 96);
}

/** The art's box over every frame (alpha >= 128), on the GIF canvas. */
function unionBounds(frames: AnimationAnalysisFrame[]): { x: number; y: number; width: number; height: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        if ((frame.pixels[(y * frame.width + x) * 4 + 3] ?? 0) < ALPHA_THRESHOLD) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function scaleNearest(frame: AnimationAnalysisFrame, scale: number): AnimationAnalysisFrame {
  const width = Math.max(1, Math.round(frame.width * scale)), height = Math.max(1, Math.round(frame.height * scale));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(frame.width - 1, Math.floor((x + 0.5) / scale));
      pixels.set(frame.pixels.subarray((sy * frame.width + sx) * 4, (sy * frame.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { ...frame, width, height, pixels };
}

const msToTicks = (ms: number): number => Math.min(0xffff, Math.max(1, Math.round(ms * 60 / 1000)));
const bgr555 = (c: { r: number; g: number; b: number }): number => (c.r >> 3) | ((c.g >> 3) << 5) | ((c.b >> 3) << 10);

/**
 * Where the box stands (White2Upgrade's grounding): a front's bottom on the carrier's ground row, a back where a PWAN
 * back stands; art taller than the screen allows sinks (a front by at most 8 px, a back as far as needed); then the
 * side's manual offset (px, +x right, +y down).
 */
export function placeFullSizeBox(side: FullSizeSide, canvasWidth: number, box: { x: number; width: number; height: number }, offsetX = 0, offsetY = 0): { x0: number; y0: number } {
  const x0 = box.x - Math.floor(canvasWidth / 2);
  let y0 = -box.height + (side === "back" ? PWAN_GROUND - GROUND_ROW : 0);
  const top = side === "back" ? BACK_TOP_ROW : SCREEN_TOP_ROW.front;
  const need = top - GROUND_ROW - y0;
  if (need > 0) y0 += side === "back" ? need : Math.min(need, MAX_SINK);
  return { x0: x0 + Math.round(offsetX), y0: y0 + Math.round(offsetY) };
}

export type FullSizeCompileOptions = { side: FullSizeSide; colorPreset?: PwanColorPreset; offsetX?: number; offsetY?: number };

export function compileGifToFullSizeStream(bytes: Uint8Array, options: FullSizeCompileOptions): FullSizeCompileResult {
  return compileFramesToFullSizeStream(decodeGifFrames(bytes), options);
}

export function compileFramesToFullSizeStream(sourceFrames: AnimationAnalysisFrame[], options: FullSizeCompileOptions): FullSizeCompileResult {
  let frames = sourceFrames;
  if (!frames.length) throw new Error("GIF contains no frames");
  const warnings: string[] = [];
  let bounds = unionBounds(frames);
  if (!bounds) throw new Error("GIF has no opaque pixels");
  if (bounds.width > FULL_SIZE_MAX || bounds.height > FULL_SIZE_MAX) {
    const scale = Math.min(FULL_SIZE_MAX / bounds.width, FULL_SIZE_MAX / bounds.height);
    frames = frames.map((frame) => scaleNearest(frame, scale));
    bounds = unionBounds(frames)!;
    warnings.push(`The art is larger than ${FULL_SIZE_MAX}x${FULL_SIZE_MAX}; it was scaled to ${bounds.width}x${bounds.height} (nearest neighbour).`);
  }
  const canvasWidth = frames[0]!.width;
  const box = { ...bounds, width: Math.min(FULL_SIZE_MAX, bounds.width), height: Math.min(FULL_SIZE_MAX, bounds.height) };
  const cropped = frames.map((frame): AnimationAnalysisFrame => {
    const pixels = new Uint8ClampedArray(box.width * box.height * 4);
    for (let y = 0; y < box.height; y++) {
      const from = ((box.y + y) * frame.width + box.x) * 4;
      pixels.set(frame.pixels.subarray(from, from + box.width * 4), y * box.width * 4);
    }
    return { ...frame, width: box.width, height: box.height, pixels };
  });
  const quantized = prepareRgb555PaletteFrames(applyPwanColorPreset(cropped, options.colorPreset ?? "none"), 15);
  warnings.push(...quantized.warnings);
  const colors = quantized.palette.slice(0, 15).map(bgr555);
  const lookup = new Map(colors.map((color, n) => [color, n + 1]));
  const nearest = (color: number): number => {
    let best = 1, distance = Infinity;
    colors.forEach((other, n) => {
      const d = ((color & 31) - (other & 31)) ** 2 + ((color >> 5 & 31) - (other >> 5 & 31)) ** 2 + ((color >> 10 & 31) - (other >> 10 & 31)) ** 2;
      if (d < distance) { distance = d; best = n + 1; }
    });
    return best;
  };
  const unique: Uint8Array[] = [], keys = new Map<string, number>(), sequence: Array<{ frame: number; duration: number }> = [];
  quantized.frames.forEach((frame, n) => {
    const texels = new Uint8Array(box.height * ROW);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const at = (y * box.width + x) * 4;
        if ((frame.pixels[at + 3] ?? 0) < ALPHA_THRESHOLD) continue;
        const color = bgr555({ r: frame.pixels[at]!, g: frame.pixels[at + 1]!, b: frame.pixels[at + 2]! });
        texels[y * ROW + x] = (lookup.get(color) ?? nearest(color)) | OPAQUE;
      }
    }
    const key = Array.from(texels).join(",");
    let index = keys.get(key);
    if (index === undefined) { index = unique.length; keys.set(key, index); unique.push(texels); }
    const ticks = msToTicks(frames[n]?.delayMs ?? 100), last = sequence.at(-1);
    if (last?.frame === index && last.duration + ticks <= 0xffff) last.duration += ticks;
    else sequence.push({ frame: index, duration: ticks });
  });
  const { x0, y0 } = placeFullSizeBox(options.side, canvasWidth, box, options.offsetX, options.offsetY);
  const palette = Uint16Array.from({ length: 16 }, (_, n) => (n === 0 ? colors[0] ?? 0 : colors[n - 1] ?? 0));
  const mani = encodeFullSizeMani({ width: box.width, height: box.height, x0, y0, frames: unique, sequence, palette });
  const preview = compilePwanAnimationFrames(sourceFrames, { colorPreset: options.colorPreset });
  return { mani, width: box.width, height: box.height, x0, y0, preview, uniqueFrameCount: unique.length, warnings };
}

export function encodeFullSizeMani(input: { width: number; height: number; x0: number; y0: number; frames: Uint8Array[];
  sequence: Array<{ frame: number; duration: number }>; palette: Uint16Array; shinyPalette?: Uint16Array }): Uint8Array {
  const { width, height } = input;
  if (width < 1 || height < 1 || width > FULL_SIZE_MAX || height > FULL_SIZE_MAX) throw new Error("A full-size frame is 1..128 pixels each way");
  if (!input.sequence.length || input.sequence.length > 0xffff || !input.frames.length) throw new Error("Invalid full-size timeline");
  const blobs = input.frames.map((frame) => {
    if (frame.length !== height * ROW) throw new Error("Full-size frame size mismatch");
    const blob = encodeW2AnimLz10(frame);
    if (blob.length > 20 * 1024) throw new Error("A full-size frame does not compress under 20 KiB");
    return blob;
  });
  const paletteAt = MORPH_OFFSET + MORPH_BYTES, seqAt = paletteAt + 64, framesAt = seqAt + input.sequence.length * 4;
  let cursor = framesAt + blobs.length * 8;
  const out = new Uint8Array(cursor + blobs.reduce((total, blob) => total + Math.ceil(blob.length / 4) * 4, 0));
  out.set(new TextEncoder().encode("MANI"));
  writeU16(out, 4, 2); writeU16(out, 6, MANI_OWN | MANI_TICKS | MANI_MORPH); writeU16(out, 8, width); writeU16(out, 10, height);
  writeU16(out, 12, input.sequence.length); writeU16(out, 14, blobs.length); writeU32(out, 16, seqAt); writeU32(out, 20, framesAt); writeU32(out, 24, paletteAt);
  writeU16(out, MORPH_OFFSET, input.x0 & 0xffff); writeU16(out, MORPH_OFFSET + 2, input.y0 & 0xffff);
  for (let n = 0; n < 16; n++) {
    out[MORPH_OFFSET + 4 + n] = n === 0 ? 1 : n; // A3I5 index -> the evolution renderer's 4 bpp index (1..15)
    out[MORPH_OFFSET + 20 + n] = n; // 4 bpp index -> the A3I5 index whose colour it shows
  }
  const shiny = input.shinyPalette ?? input.palette;
  input.palette.forEach((color, n) => writeU16(out, paletteAt + n * 2, color));
  shiny.forEach((color, n) => writeU16(out, paletteAt + 32 + n * 2, color));
  input.sequence.forEach((step, n) => {
    if (step.frame >= blobs.length || step.duration < 1) throw new Error("Invalid full-size timeline entry");
    writeU16(out, seqAt + n * 4, step.frame); writeU16(out, seqAt + n * 4 + 2, step.duration);
  });
  blobs.forEach((blob, n) => {
    writeU32(out, framesAt + n * 8, cursor); writeU32(out, framesAt + n * 8 + 4, blob.length);
    out.set(blob, cursor); cursor += Math.ceil(blob.length / 4) * 4;
  });
  return out;
}

export type FullSizeManiInfo = { width: number; height: number; x0: number; y0: number; palette: Uint16Array;
  sequence: Array<{ frame: number; duration: number }>; frames: Uint8Array[] };

export function parseFullSizeMani(mani: Uint8Array): FullSizeManiInfo {
  if (readAscii(mani, 0, 4) !== "MANI" || readU16(mani, 4) !== 2) throw new Error("Not a MANI v2 stream");
  const flags = readU16(mani, 6);
  if ((flags & (MANI_OWN | MANI_MORPH | 2)) !== (MANI_OWN | MANI_MORPH)) throw new Error("Not a full-size (A3I5) stream");
  const width = readU16(mani, 8), height = readU16(mani, 10), seqCount = readU16(mani, 12), uniqueCount = readU16(mani, 14);
  const seqAt = readU32(mani, 16), framesAt = readU32(mani, 20), paletteAt = readU32(mani, 24);
  const s16 = (at: number) => (readU16(mani, at) << 16) >> 16;
  return {
    width, height, x0: s16(MORPH_OFFSET), y0: s16(MORPH_OFFSET + 2),
    palette: Uint16Array.from({ length: 16 }, (_, n) => readU16(mani, paletteAt + n * 2)),
    sequence: Array.from({ length: seqCount }, (_, n) => ({ frame: readU16(mani, seqAt + n * 4), duration: readU16(mani, seqAt + n * 4 + 2) })),
    frames: Array.from({ length: uniqueCount }, (_, n) => {
      const at = readU32(mani, framesAt + n * 8), size = readU32(mani, framesAt + n * 8 + 4);
      return decodeW2AnimLz(mani.subarray(at, at + size), height * ROW);
    }),
  };
}

/** A full-size stream as RGBA frames on a canvas centred on the ground point (for the 96x96 preview PWAN). */
export function fullSizePreviewPwan(mani: Uint8Array): PwanCompileResult {
  const info = parseFullSizeMani(mani);
  const canvas = 160, gx = canvas / 2, gy = canvas - 16;
  const frames: AnimationAnalysisFrame[] = info.sequence.map((step, index) => {
    const pixels = new Uint8ClampedArray(canvas * canvas * 4), texels = info.frames[step.frame]!;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const t = texels[y * ROW + x]!;
        const cx = gx + info.x0 + x, cy = gy + info.y0 + y;
        if (!(t >> 5) || cx < 0 || cy < 0 || cx >= canvas || cy >= canvas) continue;
        const color = info.palette[t & 15]!, at = (cy * canvas + cx) * 4;
        pixels[at] = (color & 31) << 3; pixels[at + 1] = (color >> 5 & 31) << 3; pixels[at + 2] = (color >> 10 & 31) << 3; pixels[at + 3] = 255;
      }
    }
    return { index, width: canvas, height: canvas, delayMs: Math.round(step.duration * 1000 / 60), pixels };
  });
  // Crop to the art so the PWAN compiler fits it into 96x96 standing on its bottom row.
  let minX = canvas, minY = canvas, maxX = -1, maxY = -1;
  for (const frame of frames) for (let y = 0; y < canvas; y++) for (let x = 0; x < canvas; x++) {
    if (!frame.pixels[(y * canvas + x) * 4 + 3]) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const side = Math.max(maxX - minX + 1, maxY - minY + 1, 1);
  const cropped = frames.map((frame) => {
    const pixels = new Uint8ClampedArray(side * side * 4), left = Math.max(0, Math.round((minX + maxX + 1 - side) / 2)), top = maxY + 1 - side;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const sx = left + x, sy = top + y;
      if (sx < 0 || sy < 0 || sx >= canvas || sy >= canvas) continue;
      pixels.set(frame.pixels.subarray((sy * canvas + sx) * 4, (sy * canvas + sx) * 4 + 4), (y * side + x) * 4);
    }
    return { ...frame, width: side, height: side, pixels };
  });
  return compilePwanAnimationFrames(cropped);
}

// ---- the sprite block's side files ---------------------------------------------------------------------------

const OAM_SHAPES = new Map<string, [number, number]>([
  ["8x8", [0, 0]], ["16x16", [0, 1]], ["32x32", [0, 2]], ["64x64", [0, 3]], ["16x8", [1, 0]], ["32x8", [1, 1]],
  ["32x16", [1, 2]], ["64x32", [1, 3]], ["8x16", [2, 0]], ["8x32", [2, 1]], ["16x32", [2, 2]], ["32x64", [2, 3]],
]);

/** OAM-valid rectangles covering a w x h box (multiples of 8). */
function pieces(w: number, h: number): Array<[number, number, number, number]> {
  const sizes = (n: number) => { const out: number[] = []; for (const s of [64, 32, 16, 8]) while (n >= s) { out.push(s); n -= s; } return out; };
  const result: Array<[number, number, number, number]> = [];
  let y = 0;
  for (const ph of sizes(h)) {
    let x = 0;
    for (const pw of sizes(w)) {
      const todo: Array<[number, number, number, number]> = [[x, y, pw, ph]];
      while (todo.length) {
        const [px, py, a, b] = todo.pop()!;
        if (OAM_SHAPES.has(`${a}x${b}`)) result.push([px, py, a, b]);
        else if (a > b) todo.push([px, py, a / 2, b], [px + a / 2, py, a / 2, b]);
        else todo.push([px, py, a, b / 2], [px, py + b / 2, a, b / 2]);
      }
      x += pw;
    }
    y += ph;
  }
  return result;
}

function buildNcer(w: number, h: number): Uint8Array {
  const cw = Math.ceil(w / 8) * 8, ch = Math.ceil(h / 8) * 8, oams = pieces(cw, ch);
  const cell = new Uint8Array(8 + oams.length * 6);
  writeU16(cell, 0, oams.length); writeU16(cell, 2, Math.min(63, Math.max(cw, ch) / 2));
  oams.forEach(([px, py, pw, ph], n) => {
    const [shape, size] = OAM_SHAPES.get(`${pw}x${ph}`)!;
    writeU16(cell, 8 + n * 6, (py & 0xff) | shape << 14);
    writeU16(cell, 10 + n * 6, (px & 0x1ff) | size << 14);
    writeU16(cell, 12 + n * 6, (py / 8) * 32 + px / 8);
  });
  let kbec = new Uint8Array(0x18 + cell.length);
  writeU16(kbec, 0, 1); writeU32(kbec, 4, 0x18); writeU32(kbec, 8, 4);
  kbec.set(cell, 0x18);
  if (kbec.length % 4) { const padded = new Uint8Array(kbec.length + (4 - kbec.length % 4)); padded.set(kbec); kbec = padded; }
  const out = new Uint8Array(0x10 + 8 + kbec.length);
  out.set(new TextEncoder().encode("RECN")); writeU16(out, 4, 0xfeff); writeU16(out, 6, 0x0100); writeU32(out, 8, out.length);
  writeU16(out, 12, 0x10); writeU16(out, 14, 1);
  out.set(new TextEncoder().encode("KBEC"), 0x10); writeU32(out, 0x14, 8 + kbec.length); out.set(kbec, 0x18);
  return out;
}

/** The template's NANR with every keyframe at identity (no idle bob: the stream animates). */
function stillNanr(nanr: Uint8Array): Uint8Array {
  const out = decompressNitro(nanr).slice();
  if (readAscii(out, 0, 4) !== "RNAN") throw new Error("The template NANR is not an NANR");
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength), d = 0x18;
  const count = view.getUint16(d, true), animsAt = view.getUint32(d + 4, true), framesAt = view.getUint32(d + 8, true), keysAt = view.getUint32(d + 12, true);
  for (let a = 0; a < count; a++) {
    const at = d + animsAt + 16 * a, frames = view.getUint32(at, true), type = view.getUint16(at + 6, true), first = view.getUint32(at + 12, true);
    for (let i = 0; i < frames; i++) {
      const key = d + keysAt + view.getUint32(d + framesAt + first + 8 * i, true);
      if (type === 1) { view.setUint16(key + 2, 0, true); view.setInt32(key + 4, 4096, true); view.setInt32(key + 8, 4096, true); view.setInt16(key + 12, 0, true); view.setInt16(key + 14, 0, true); }
      else if (type === 2) { view.setInt16(key + 4, 0, true); view.setInt16(key + 6, 0, true); }
    }
  }
  return compressLz11Literal(out);
}

function zeroedNmcr(nmcr: Uint8Array): Uint8Array {
  const out = (nmcr[0] === 0x10 || nmcr[0] === 0x11 ? decompressNitro(nmcr) : nmcr).slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const hio = 0x18 + view.getUint32(0x20, true);
  const node = hio + view.getUint32(0x18 + view.getUint32(0x1c, true) + 4, true);
  view.setInt16(node + 2, 0, true); view.setInt16(node + 4, 0, true);
  return nmcr[0] === 0x10 || nmcr[0] === 0x11 ? compressLz11Literal(out) : out;
}

/**
 * The side files of a sprite block (offsets in the side: sheet 2, NCER 4, NANR 5, NMCR 6, NMAR 7, NCEC record 8) so
 * MCSS draws one quad of the box at its place. The 4 bpp sheet holds the first frame; the runtime primes the texture
 * with the A3I5 frame before MCSS's upload. `member(n)` reads pokegra member n (the template is block 11).
 */
export function fullSizeBlockFiles(mani: Uint8Array, member: (n: number) => Uint8Array): Map<number, Uint8Array> {
  const info = parseFullSizeMani(mani);
  const t = TEMPLATE_BLOCK * FILES_PER_SPRITE;
  const sheet = decompressNitro(member(t + 2)).slice();
  if (readAscii(sheet, 0, 4) !== "RGCN") throw new Error("The template sheet is not an NCGR");
  const dataAt = 0x10 + 8 + readU32(sheet, 0x10 + 0x1c);
  const first = info.frames[info.sequence[0]!.frame]!;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x += 2) {
      const a = first[y * ROW + x]!, b = x + 1 < info.width ? first[y * ROW + x + 1]! : 0;
      sheet[dataAt + y * 128 + x / 2] = (a >> 5 ? a & 15 : 0) | ((b >> 5 ? b & 15 : 0) << 4);
    }
  }
  const record = member(t + 8).slice();
  writeU16(record, 4, info.width); writeU16(record, 6, info.height);
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  [info.x0 * 256, -info.y0 * 256, info.width << 12, info.height << 12, 0, 0].forEach((value, n) => view.setInt32(0xc + n * 4, value, true));
  record.fill(0, 0x24, 0x3c);
  return new Map([[2, compressLz11Literal(sheet)], [4, buildNcer(info.width, info.height)], [5, stillNanr(member(t + 5))],
    [6, zeroedNmcr(member(t + 6))], [7, member(t + 7).slice()], [8, record]]);
}

/** Moves the box by (dx, dy) px and scales every duration (the side editor's offset and speed on a full-size side). */
export function adjustFullSizeMani(mani: Uint8Array, change: { dx?: number; dy?: number; durationScale?: number }): Uint8Array {
  parseFullSizeMani(mani);
  const out = mani.slice();
  const s16 = (at: number) => (readU16(out, at) << 16) >> 16;
  writeU16(out, MORPH_OFFSET, (s16(MORPH_OFFSET) + Math.round(change.dx ?? 0)) & 0xffff);
  writeU16(out, MORPH_OFFSET + 2, (s16(MORPH_OFFSET + 2) + Math.round(change.dy ?? 0)) & 0xffff);
  const scale = change.durationScale ?? 1;
  if (Math.abs(scale - 1) > 1e-6) {
    const seqAt = readU32(out, 16);
    for (let n = 0; n < readU16(out, 12); n++) {
      const at = seqAt + n * 4 + 2;
      writeU16(out, at, Math.min(0xffff, Math.max(1, Math.round(readU16(out, at) * scale))));
    }
  }
  return out;
}
