import {
  analyzePalette,
  decodeGifFrames,
  quantizeFrames,
  type AnimationAnalysisFrame,
  type Box,
  type RgbColor,
} from "./gifAnimationFrames";

export type PwanCompileResult = {
  pwanBytes: Uint8Array;
  visibleHeight: number;
  frameCount: number;
  uniqueFrameCount: number;
  timelineCount: number;
  totalTicks: number;
  paletteBgr555: Uint16Array;
  warnings: string[];
};

export type PwanHeader = {
  magic: string;
  version: number;
  width: number;
  height: number;
  bpp: number;
  frameCount: number;
  timelineCount: number;
  totalTicks: number;
  frameBytes: number;
  paletteColors: number;
  paletteOffset: number;
  timelineOffset: number;
  frameOffset: number;
};

export type PwanTimelineEntry = { frameIndex: number; ticks: number };
export type PwanFrameScaleMode = "nearest" | "outlineFill";
export type PwanFrameScaleOptions = {
  mode?: PwanFrameScaleMode;
  outlineThreshold?: number;
};

export const PWAN_WIDTH = 96;
export const PWAN_HEIGHT = 96;
export const PWAN_FRAME_BYTES = 0x1200;
export const PWAN_PALETTE_COLORS = 16;
export const PWAN_MAX_TIMELINE = 192;

const PWAN_HEADER_BYTES = 0x30;
const TRANSPARENT_ALPHA_THRESHOLD = 128;
const SEGMENTS = [
  { x: 0, y: 0, width: 64, height: 64 },
  { x: 64, y: 0, width: 32, height: 64 },
  { x: 0, y: 64, width: 64, height: 32 },
  { x: 64, y: 64, width: 32, height: 32 },
] as const;

export function compileGifToPwan(bytes: Uint8Array): PwanCompileResult {
  const sourceFrames = decodeGifFrames(bytes);
  if (sourceFrames.length === 0) throw new Error("GIF contains no frames");

  const normalized = sourceFrames.map((frame, index) => normalizeFrameBottomAligned(frame, index));
  const paletteReport = analyzePalette(normalized);
  const warnings = [...paletteReport.warnings];
  if (sourceFrames[0] && (sourceFrames[0].width > 384 || sourceFrames[0].height > 384)) {
    warnings.push(`Source GIF is ${sourceFrames[0].width}x${sourceFrames[0].height}; it will be scaled into 96x96`);
  }
  if (sourceFrames.length > PWAN_MAX_TIMELINE) warnings.push(`GIF has ${sourceFrames.length} frames; PWAN v1 supports up to ${PWAN_MAX_TIMELINE} timeline entries`);

  const quantized = quantizeFrames(normalized, PWAN_PALETTE_COLORS - 1);
  if (paletteReport.opaqueColorCount > PWAN_PALETTE_COLORS - 1) warnings.push("Opaque colors were quantized to fit PWAN's 15-color visible palette");

  const palette = normalizePalette(quantized.palette);
  const compiledFrames = quantized.frames.map((frame) => compilePwanFrame(frame, palette));
  const uniqueFrames: Uint8Array[] = [];
  const frameIndexByHash = new Map<string, number>();
  const timeline: PwanTimelineEntry[] = [];

  compiledFrames.forEach((frame, index) => {
    const hash = hashBytes(frame);
    let frameIndex = frameIndexByHash.get(hash);
    if (frameIndex === undefined) {
      frameIndex = uniqueFrames.length;
      frameIndexByHash.set(hash, frameIndex);
      uniqueFrames.push(frame);
    }
    timeline.push({
      frameIndex,
      ticks: msToTicks(normalized[index]?.delayMs ?? 100),
    });
  });

  if (timeline.length > PWAN_MAX_TIMELINE) throw new Error(`PWAN timeline has ${timeline.length} entries; maximum is ${PWAN_MAX_TIMELINE}`);
  const totalTicks = timeline.reduce((sum, entry) => sum + entry.ticks, 0);
  const paletteBgr555 = Uint16Array.from(palette.map(writeBgr555));
  const pwanBytes = encodePwan({ paletteBgr555, timeline, uniqueFrames, totalTicks });
  if (pwanBytes.length > 1024 * 1024) warnings.push(`PWAN asset is ${(pwanBytes.length / 1024 / 1024).toFixed(1)} MiB; large assets may slow ROM export and runtime loading`);

  return {
    pwanBytes,
    visibleHeight: pwanVisibleHeightFromFrames(uniqueFrames),
    frameCount: sourceFrames.length,
    uniqueFrameCount: uniqueFrames.length,
    timelineCount: timeline.length,
    totalTicks,
    paletteBgr555,
    warnings,
  };
}

export function parsePwanHeader(bytes: Uint8Array): PwanHeader {
  if (bytes.length < PWAN_HEADER_BYTES) throw new Error("PWAN file is too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  return {
    magic,
    version: view.getUint16(4, true),
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
    bpp: view.getUint16(10, true),
    frameCount: view.getUint16(12, true),
    timelineCount: view.getUint16(14, true),
    totalTicks: view.getUint32(16, true),
    frameBytes: view.getUint32(20, true),
    paletteColors: view.getUint32(24, true),
    paletteOffset: view.getUint32(28, true),
    timelineOffset: view.getUint32(32, true),
    frameOffset: view.getUint32(36, true),
  };
}

export function validatePwan(bytes: Uint8Array): PwanHeader {
  const header = parsePwanHeader(bytes);
  if (
    header.magic !== "PWAN" ||
    header.version !== 1 ||
    header.width !== PWAN_WIDTH ||
    header.height !== PWAN_HEIGHT ||
    header.bpp !== 4 ||
    header.frameBytes !== PWAN_FRAME_BYTES ||
    header.paletteColors !== PWAN_PALETTE_COLORS ||
    header.timelineCount > PWAN_MAX_TIMELINE
  ) {
    throw new Error("Unsupported PWAN asset; expected 96x96 4bpp PWAN v1");
  }
  const minimumLength = header.frameOffset + header.frameCount * header.frameBytes;
  if (minimumLength > bytes.length) throw new Error("PWAN asset is truncated");
  return header;
}

export function pwanPalette(bytes: Uint8Array): Uint16Array {
  const header = validatePwan(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: PWAN_PALETTE_COLORS }, (_value, index) => view.getUint16(header.paletteOffset + index * 2, true));
}

export function pwanFirstFramePixels(bytes: Uint8Array): number[][] {
  const header = validatePwan(bytes);
  if (header.frameCount < 1) throw new Error("PWAN asset contains no frames");
  return decodePwanFrame(bytes.subarray(header.frameOffset, header.frameOffset + header.frameBytes));
}

export function pwanFramePixels(bytes: Uint8Array, frameIndex: number): number[][] {
  const header = validatePwan(bytes);
  const index = clampInt(frameIndex, 0, Math.max(0, header.frameCount - 1));
  return decodePwanFrame(bytes.subarray(header.frameOffset + index * header.frameBytes, header.frameOffset + (index + 1) * header.frameBytes));
}

export function pwanTimeline(bytes: Uint8Array): PwanTimelineEntry[] {
  const header = validatePwan(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: header.timelineCount }, (_value, index) => ({
    frameIndex: view.getUint16(header.timelineOffset + index * 4, true),
    ticks: view.getUint16(header.timelineOffset + index * 4 + 2, true),
  }));
}

export function scalePwanTimelineSpeed(bytes: Uint8Array, durationScale: number): { pwanBytes: Uint8Array; totalTicks: number } {
  const header = validatePwan(bytes);
  const out = bytes.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const scale = Number.isFinite(durationScale) && durationScale > 0 ? durationScale : 1;
  let totalTicks = 0;
  for (let index = 0; index < header.timelineCount; index += 1) {
    const offset = header.timelineOffset + index * 4 + 2;
    const ticks = view.getUint16(offset, true);
    const nextTicks = clampInt(ticks * scale, 1, 0xff);
    view.setUint16(offset, nextTicks, true);
    totalTicks += nextTicks;
  }
  view.setUint32(16, totalTicks, true);
  return { pwanBytes: out, totalTicks };
}

export function pwanFramesPerSecond(bytes: Uint8Array): number {
  const timeline = pwanTimeline(bytes);
  const totalTicks = timeline.reduce((sum, entry) => sum + Math.max(1, entry.ticks), 0);
  return totalTicks > 0 ? timeline.length * 60 / totalTicks : 0;
}

export function scalePwanTimelineToFps(bytes: Uint8Array, framesPerSecond: number): { pwanBytes: Uint8Array; totalTicks: number; framesPerSecond: number } {
  const currentFps = pwanFramesPerSecond(bytes);
  const nextFps = clampFinite(framesPerSecond, 1, 60, currentFps || 10);
  if (currentFps <= 0) {
    const header = validatePwan(bytes);
    return { pwanBytes: bytes.slice(), totalTicks: header.totalTicks, framesPerSecond: nextFps };
  }
  const scaled = scalePwanTimelineSpeed(bytes, currentFps / nextFps);
  return { ...scaled, framesPerSecond: pwanFramesPerSecond(scaled.pwanBytes) };
}

export function shiftPwanFrames(bytes: Uint8Array, offsetX: number, offsetY: number): { pwanBytes: Uint8Array; visibleHeight: number } {
  const header = validatePwan(bytes);
  const dx = clampInt(offsetX, -PWAN_WIDTH, PWAN_WIDTH);
  const dy = clampInt(offsetY, -PWAN_HEIGHT, PWAN_HEIGHT);
  const out = bytes.slice();
  const frames: Uint8Array[] = [];
  for (let index = 0; index < header.frameCount; index += 1) {
    const frameOffset = header.frameOffset + index * header.frameBytes;
    const shifted = shiftIndexedPixels(decodePwanFrame(bytes.subarray(frameOffset, frameOffset + header.frameBytes)), dx, dy);
    const encoded = tilePwanSegmentedPixels(shifted);
    out.set(encoded, frameOffset);
    frames.push(encoded);
  }
  return { pwanBytes: out, visibleHeight: pwanVisibleHeightFromFrames(frames) };
}

export function scalePwanFrames(bytes: Uint8Array, scale: number, options: PwanFrameScaleOptions = {}): { pwanBytes: Uint8Array; visibleHeight: number } {
  const header = validatePwan(bytes);
  const factor = clampFinite(scale, 0.25, 4, 1);
  const mode = options.mode === "outlineFill" ? "outlineFill" : "nearest";
  const palette = mode === "outlineFill" ? pwanPalette(bytes) : undefined;
  const out = bytes.slice();
  const frames: Uint8Array[] = [];
  for (let index = 0; index < header.frameCount; index += 1) {
    const frameOffset = header.frameOffset + index * header.frameBytes;
    const pixels = decodePwanFrame(bytes.subarray(frameOffset, frameOffset + header.frameBytes));
    const scaled = mode === "outlineFill" && palette ? scaleIndexedPixelsOutlineFillBottomCenter(pixels, factor, palette, options.outlineThreshold ?? 48) : scaleIndexedPixelsBottomCenter(pixels, factor);
    const encoded = tilePwanSegmentedPixels(scaled);
    out.set(encoded, frameOffset);
    frames.push(encoded);
  }
  return { pwanBytes: out, visibleHeight: pwanVisibleHeightFromFrames(frames) };
}

export function pwanVisibleHeight(bytes: Uint8Array): number {
  const header = validatePwan(bytes);
  const frames = Array.from({ length: header.frameCount }, (_value, index) => bytes.subarray(header.frameOffset + index * header.frameBytes, header.frameOffset + (index + 1) * header.frameBytes));
  return pwanVisibleHeightFromFrames(frames);
}

export function pwanToGifBytes(bytes: Uint8Array): Uint8Array {
  const header = validatePwan(bytes);
  const palette = pwanPalette(bytes);
  const timeline = pwanTimeline(bytes);
  const parts: Uint8Array[] = [
    asciiBytes("GIF89a"),
    u16Bytes(PWAN_WIDTH),
    u16Bytes(PWAN_HEIGHT),
    new Uint8Array([0xf3, 0, 0]),
    gifColorTable(palette),
    new Uint8Array([0x21, 0xff, 0x0b]),
    asciiBytes("NETSCAPE2.0"),
    new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  const entries = timeline.length ? timeline : Array.from({ length: header.frameCount }, (_value, frameIndex) => ({ frameIndex, ticks: 6 }));
  for (const entry of entries) {
    const indices = flattenIndexedPixels(pwanFramePixels(bytes, entry.frameIndex));
    parts.push(new Uint8Array([0x21, 0xf9, 0x04, 0x09]), u16Bytes(clampInt(entry.ticks * 100 / 60, 1, 0xffff)), new Uint8Array([0, 0]));
    parts.push(new Uint8Array([0x2c]), u16Bytes(0), u16Bytes(0), u16Bytes(PWAN_WIDTH), u16Bytes(PWAN_HEIGHT), new Uint8Array([0, 4]));
    parts.push(gifSubBlocks(gifLzwEncode(indices, 4)));
  }
  parts.push(new Uint8Array([0x3b]));
  return concatBytes(parts);
}

export function tileIndexedPixels(pixels: number[][], width: number, height: number): Uint8Array {
  const out = new Uint8Array((width * height) / 2);
  let offset = 0;
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 2) {
          const lo = pixels[tileY + y]?.[tileX + x] ?? 0;
          const hi = pixels[tileY + y]?.[tileX + x + 1] ?? 0;
          out[offset++] = (lo & 0x0f) | ((hi & 0x0f) << 4);
        }
      }
    }
  }
  return out;
}

export function tilePwanSegmentedPixels(pixels: number[][]): Uint8Array {
  const chunks = SEGMENTS.map((segment) => tileIndexedPixelsRegion(pixels, segment.x, segment.y, segment.width, segment.height));
  const out = concatBytes(chunks);
  if (out.length !== PWAN_FRAME_BYTES) throw new Error(`Segmented PWAN frame is ${out.length} bytes; expected ${PWAN_FRAME_BYTES}`);
  return out;
}

export function makeWidePwanPixels(src: number[][]): number[][] {
  const pixels = Array.from({ length: 128 }, () => Array.from({ length: 256 }, () => 0));
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) pixels[y]![x] = src[y]?.[x] ?? 0;
  }
  return pixels;
}

function normalizeFrameBottomAligned(frame: AnimationAnalysisFrame, index: number): AnimationAnalysisFrame {
  const bounds = alphaBounds(frame);
  const scale = Math.min(1, PWAN_WIDTH / frame.width, PWAN_HEIGHT / frame.height);
  const scaledWidth = Math.max(1, Math.round(frame.width * scale));
  const scaledHeight = Math.max(1, Math.round(frame.height * scale));
  const scaled = scaleRgba(frame.pixels, frame.width, frame.height, scaledWidth, scaledHeight);
  const pixels = new Uint8ClampedArray(PWAN_WIDTH * PWAN_HEIGHT * 4);
  const dstX = Math.floor((PWAN_WIDTH - scaledWidth) / 2);
  const dstY = PWAN_HEIGHT - scaledHeight;
  blitRgba(pixels, PWAN_WIDTH, scaled, scaledWidth, scaledHeight, dstX, dstY);
  normalizeAlpha(pixels);
  return { index, width: PWAN_WIDTH, height: PWAN_HEIGHT, delayMs: frame.delayMs, pixels: bounds ? pixels : new Uint8ClampedArray(PWAN_WIDTH * PWAN_HEIGHT * 4) };
}

function normalizePalette(colors: RgbColor[]): RgbColor[] {
  const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, ...colors.slice(0, PWAN_PALETTE_COLORS - 1)];
  while (palette.length < PWAN_PALETTE_COLORS) palette.push({ r: 0, g: 0, b: 0 });
  return palette;
}

function compilePwanFrame(frame: AnimationAnalysisFrame, palette: RgbColor[]): Uint8Array {
  const chunks = SEGMENTS.map((segment) => tileRgbaRegion(frame, palette, segment.x, segment.y, segment.width, segment.height));
  const out = concatBytes(chunks);
  if (out.length !== PWAN_FRAME_BYTES) throw new Error(`Compiled PWAN frame is ${out.length} bytes; expected ${PWAN_FRAME_BYTES}`);
  return out;
}

function tileRgbaRegion(frame: AnimationAnalysisFrame, palette: RgbColor[], x0: number, y0: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width * height) / 2);
  let offset = 0;
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 2) {
          const lo = nearestPaletteIndex(frame, palette, x0 + tileX + x, y0 + tileY + y);
          const hi = nearestPaletteIndex(frame, palette, x0 + tileX + x + 1, y0 + tileY + y);
          out[offset++] = lo | (hi << 4);
        }
      }
    }
  }
  return out;
}

function tileIndexedPixelsRegion(pixels: number[][], x0: number, y0: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width * height) / 2);
  let offset = 0;
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 2) {
          const lo = pixels[y0 + tileY + y]?.[x0 + tileX + x] ?? 0;
          const hi = pixels[y0 + tileY + y]?.[x0 + tileX + x + 1] ?? 0;
          out[offset++] = (lo & 0x0f) | ((hi & 0x0f) << 4);
        }
      }
    }
  }
  return out;
}

function nearestPaletteIndex(frame: AnimationAnalysisFrame, palette: RgbColor[], x: number, y: number): number {
  const offset = (y * frame.width + x) * 4;
  const a = frame.pixels[offset + 3] ?? 0;
  if (a < TRANSPARENT_ALPHA_THRESHOLD) return 0;
  const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < palette.length; index += 1) {
    const distance = colorDistance(color, palette[index]!);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function encodePwan(input: { paletteBgr555: Uint16Array; timeline: PwanTimelineEntry[]; uniqueFrames: Uint8Array[]; totalTicks: number }): Uint8Array {
  const paletteOffset = PWAN_HEADER_BYTES;
  const timelineOffset = paletteOffset + PWAN_PALETTE_COLORS * 2;
  const frameOffset = timelineOffset + input.timeline.length * 4;
  const out = new Uint8Array(frameOffset + input.uniqueFrames.length * PWAN_FRAME_BYTES);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PWAN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, PWAN_WIDTH, true);
  view.setUint16(8, PWAN_HEIGHT, true);
  view.setUint16(10, 4, true);
  view.setUint16(12, input.uniqueFrames.length, true);
  view.setUint16(14, input.timeline.length, true);
  view.setUint32(16, input.totalTicks, true);
  view.setUint32(20, PWAN_FRAME_BYTES, true);
  view.setUint32(24, PWAN_PALETTE_COLORS, true);
  view.setUint32(28, paletteOffset, true);
  view.setUint32(32, timelineOffset, true);
  view.setUint32(36, frameOffset, true);
  input.paletteBgr555.forEach((color, index) => view.setUint16(paletteOffset + index * 2, color, true));
  input.timeline.forEach((entry, index) => {
    view.setUint16(timelineOffset + index * 4, entry.frameIndex, true);
    view.setUint16(timelineOffset + index * 4 + 2, entry.ticks, true);
  });
  input.uniqueFrames.forEach((frame, index) => out.set(frame, frameOffset + index * PWAN_FRAME_BYTES));
  return out;
}

function decodePwanFrame(frame: Uint8Array): number[][] {
  const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  let segmentOffset = 0;
  for (const segment of SEGMENTS) {
    const tilesW = segment.width / 8;
    const tilesH = segment.height / 8;
    for (let tileY = 0; tileY < tilesH; tileY += 1) {
      for (let tileX = 0; tileX < tilesW; tileX += 1) {
        const tileOffset = segmentOffset + (tileY * tilesW + tileX) * 32;
        for (let y = 0; y < 8; y += 1) {
          for (let xPair = 0; xPair < 4; xPair += 1) {
            const packed = frame[tileOffset + y * 4 + xPair] ?? 0;
            const x = segment.x + tileX * 8 + xPair * 2;
            const yy = segment.y + tileY * 8 + y;
            pixels[yy]![x] = packed & 0x0f;
            pixels[yy]![x + 1] = (packed >>> 4) & 0x0f;
          }
        }
      }
    }
    segmentOffset += (segment.width * segment.height) / 2;
  }
  return pixels;
}

function shiftIndexedPixels(pixels: number[][], dx: number, dy: number): number[][] {
  const shifted = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= PWAN_WIDTH || nextY >= PWAN_HEIGHT) continue;
      shifted[nextY]![nextX] = pixels[y]?.[x] ?? 0;
    }
  }
  return shifted;
}

function scaleIndexedPixelsBottomCenter(pixels: number[][], scale: number): number[][] {
  const scaled = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  const anchorX = PWAN_WIDTH / 2;
  const anchorY = PWAN_HEIGHT;
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const sourceX = Math.floor(anchorX + (x + 0.5 - anchorX) / scale);
      const sourceY = Math.floor(anchorY + (y + 0.5 - anchorY) / scale);
      if (sourceX < 0 || sourceY < 0 || sourceX >= PWAN_WIDTH || sourceY >= PWAN_HEIGHT) continue;
      scaled[y]![x] = pixels[sourceY]?.[sourceX] ?? 0;
    }
  }
  return scaled;
}

function scaleIndexedPixelsOutlineFillBottomCenter(pixels: number[][], scale: number, palette: Uint16Array, outlineThreshold: number): number[][] {
  if (Math.abs(scale - 1) < 0.0001) return pixels.map((row) => [...row]);
  const threshold = clampInt(outlineThreshold, 0, 128);
  const silhouette = outlineMask(pixels, palette, 0);
  const protectedMask = outlineMask(pixels, palette, threshold);
  const scaled = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));

  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const source = inverseScalePoint(x, y, scale);
      const index = pixels[source.y]?.[source.x] ?? 0;
      if (index === 0 || protectedMask[source.y]?.[source.x]) continue;
      scaled[y]![x] = index;
    }
  }

  const outlinePixels = maskPoints(silhouette);
  const outlineSource = outlinePixels.length ? outlinePixels : maskPoints(protectedMask);
  if (outlineSource.length > 0) {
    const withOutline = scaled.map((row) => [...row]);
    for (let y = 0; y < PWAN_HEIGHT; y += 1) {
      for (let x = 0; x < PWAN_WIDTH; x += 1) {
        if (scaled[y]?.[x] !== 0 || !touchesOpaque(scaled, x, y)) continue;
        const nearest = nearestPoint(outlineSource, inverseScalePoint(x, y, scale));
        withOutline[y]![x] = pixels[nearest.y]?.[nearest.x] ?? 0;
      }
    }
    for (let y = 0; y < PWAN_HEIGHT; y += 1) scaled[y] = withOutline[y]!;
  }

  for (const point of maskPoints(protectedMask)) {
    if (silhouette[point.y]?.[point.x]) continue;
    const projected = forwardScalePoint(point.x, point.y, scale);
    if (projected.x < 0 || projected.y < 0 || projected.x >= PWAN_WIDTH || projected.y >= PWAN_HEIGHT) continue;
    scaled[projected.y]![projected.x] = pixels[point.y]?.[point.x] ?? 0;
  }

  return scaled;
}

function outlineMask(pixels: number[][], palette: Uint16Array, outlineThreshold: number): boolean[][] {
  const threshold = Math.max(0, outlineThreshold);
  return Array.from({ length: PWAN_HEIGHT }, (_value, y) =>
    Array.from({ length: PWAN_WIDTH }, (_inner, x) => {
      const index = pixels[y]?.[x] ?? 0;
      if (index === 0) return false;
      if (touchesTransparency(pixels, x, y)) return true;
      return threshold > 0 && bgr555Luminance(palette[index] ?? 0) <= threshold;
    }),
  );
}

function touchesTransparency(pixels: number[][], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= PWAN_WIDTH || yy >= PWAN_HEIGHT || (pixels[yy]?.[xx] ?? 0) === 0) return true;
    }
  }
  return false;
}

function touchesOpaque(pixels: number[][], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= PWAN_WIDTH || yy >= PWAN_HEIGHT) continue;
      if ((pixels[yy]?.[xx] ?? 0) !== 0) return true;
    }
  }
  return false;
}

function maskPoints(mask: boolean[][]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      if (mask[y]?.[x]) points.push({ x, y });
    }
  }
  return points;
}

function inverseScalePoint(x: number, y: number, scale: number): { x: number; y: number } {
  const anchorX = PWAN_WIDTH / 2;
  const anchorY = PWAN_HEIGHT;
  return {
    x: clampInt(Math.floor(anchorX + (x + 0.5 - anchorX) / scale), 0, PWAN_WIDTH - 1),
    y: clampInt(Math.floor(anchorY + (y + 0.5 - anchorY) / scale), 0, PWAN_HEIGHT - 1),
  };
}

function forwardScalePoint(x: number, y: number, scale: number): { x: number; y: number } {
  const anchorX = PWAN_WIDTH / 2;
  const anchorY = PWAN_HEIGHT;
  return {
    x: Math.round(anchorX + (x + 0.5 - anchorX) * scale - 0.5),
    y: Math.round(anchorY + (y + 0.5 - anchorY) * scale - 0.5),
  };
}

function nearestPoint(points: Array<{ x: number; y: number }>, target: { x: number; y: number }): { x: number; y: number } {
  let best = points[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function bgr555Luminance(value: number): number {
  const r = ((value & 0x1f) << 3) | ((value & 0x1f) >>> 2);
  const g = (((value >>> 5) & 0x1f) << 3) | (((value >>> 5) & 0x1f) >>> 2);
  const b = (((value >>> 10) & 0x1f) << 3) | (((value >>> 10) & 0x1f) >>> 2);
  return Math.round((r * 299 + g * 587 + b * 114) / 1000);
}

function pwanVisibleHeightFromFrames(frames: Uint8Array[]): number {
  let minY = PWAN_HEIGHT;
  let maxY = -1;
  for (const frame of frames) {
    const pixels = decodePwanFrame(frame);
    for (let y = 0; y < PWAN_HEIGHT; y += 1) {
      for (let x = 0; x < PWAN_WIDTH; x += 1) {
        if ((pixels[y]?.[x] ?? 0) === 0) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxY < minY ? 0 : maxY - minY + 1;
}

function msToTicks(ms: number): number {
  return clampInt(Math.round(ms * 60 / 1000), 1, 0xffff);
}

function writeBgr555(color: RgbColor): number {
  const r = Math.min(31, Math.max(0, Math.round(color.r) >> 3));
  const g = Math.min(31, Math.max(0, Math.round(color.g) >> 3));
  const b = Math.min(31, Math.max(0, Math.round(color.b) >> 3));
  return r | (g << 5) | (b << 10);
}

function scaleRgba(src: Uint8ClampedArray, srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  for (let y = 0; y < dstHeight; y += 1) {
    const sy = Math.min(srcHeight - 1, Math.max(0, (y + 0.5) * srcHeight / dstHeight - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcHeight - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dstWidth; x += 1) {
      const sx = Math.min(srcWidth - 1, Math.max(0, (x + 0.5) * srcWidth / dstWidth - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcWidth - 1, x0 + 1);
      const fx = sx - x0;
      const dst = (y * dstWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const c00 = src[(y0 * srcWidth + x0) * 4 + channel] ?? 0;
        const c10 = src[(y0 * srcWidth + x1) * 4 + channel] ?? 0;
        const c01 = src[(y1 * srcWidth + x0) * 4 + channel] ?? 0;
        const c11 = src[(y1 * srcWidth + x1) * 4 + channel] ?? 0;
        out[dst + channel] = Math.round(c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy);
      }
    }
  }
  return out;
}

function blitRgba(dst: Uint8ClampedArray, dstWidth: number, src: Uint8ClampedArray, srcWidth: number, srcHeight: number, dstX: number, dstY: number): void {
  for (let y = 0; y < srcHeight; y += 1) {
    for (let x = 0; x < srcWidth; x += 1) {
      const tx = dstX + x;
      const ty = dstY + y;
      if (tx < 0 || ty < 0 || tx >= dstWidth || ty >= Math.floor(dst.length / 4 / dstWidth)) continue;
      dst.set(src.subarray((y * srcWidth + x) * 4, (y * srcWidth + x) * 4 + 4), (ty * dstWidth + tx) * 4);
    }
  }
}

function normalizeAlpha(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) pixels.fill(0, offset, offset + 4);
    else pixels[offset + 3] = 255;
  }
}

function alphaBounds(frame: AnimationAnalysisFrame): Box | undefined {
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if ((frame.pixels[(y * frame.width + x) * 4 + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
}

function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function flattenIndexedPixels(pixels: number[][]): Uint8Array {
  const out = new Uint8Array(PWAN_WIDTH * PWAN_HEIGHT);
  let offset = 0;
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) out[offset++] = pixels[y]?.[x] ?? 0;
  }
  return out;
}

function gifColorTable(palette: Uint16Array): Uint8Array {
  const out = new Uint8Array(16 * 3);
  palette.forEach((value, index) => {
    const color = bgr555ToRgb(value);
    out[index * 3] = color.r;
    out[index * 3 + 1] = color.g;
    out[index * 3 + 2] = color.b;
  });
  return out;
}

function bgr555ToRgb(value: number): { r: number; g: number; b: number } {
  return {
    r: ((value & 0x1f) << 3) | ((value & 0x1f) >>> 2),
    g: (((value >>> 5) & 0x1f) << 3) | (((value >>> 5) & 0x1f) >>> 2),
    b: (((value >>> 10) & 0x1f) << 3) | (((value >>> 10) & 0x1f) >>> 2),
  };
}

function gifLzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = initialGifDictionary(clearCode);
  const writer = new GifBitWriter();
  writer.write(clearCode, codeSize);
  let prefix = String.fromCharCode(indices[0] ?? 0);
  for (let index = 1; index < indices.length; index += 1) {
    const char = String.fromCharCode(indices[index] ?? 0);
    const joined = prefix + char;
    if (dictionary.has(joined)) {
      prefix = joined;
      continue;
    }
    writer.write(dictionary.get(prefix) ?? 0, codeSize);
    if (nextCode < 4096) {
      dictionary.set(joined, nextCode);
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    } else {
      writer.write(clearCode, codeSize);
      dictionary = initialGifDictionary(clearCode);
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    prefix = char;
  }
  writer.write(dictionary.get(prefix) ?? 0, codeSize);
  writer.write(endCode, codeSize);
  return writer.finish();
}

function initialGifDictionary(clearCode: number): Map<string, number> {
  const dictionary = new Map<string, number>();
  for (let index = 0; index < clearCode; index += 1) dictionary.set(String.fromCharCode(index), index);
  return dictionary;
}

class GifBitWriter {
  private bytes: number[] = [];
  private current = 0;
  private bitCount = 0;

  write(code: number, size: number): void {
    let value = code;
    for (let index = 0; index < size; index += 1) {
      this.current |= (value & 1) << this.bitCount;
      value >>>= 1;
      this.bitCount += 1;
      if (this.bitCount === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.bitCount = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) this.bytes.push(this.current);
    return Uint8Array.from(this.bytes);
  }
}

function gifSubBlocks(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.slice(offset, offset + 255);
    parts.push(new Uint8Array([chunk.length]), chunk);
  }
  parts.push(new Uint8Array([0]));
  return concatBytes(parts);
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0) & 0xff));
}

function u16Bytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
