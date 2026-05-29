import { decompressFrames, parseGIF } from "gifuct-js";
import { createHash } from "node:crypto";

export type VirtualSpriteFrame = {
  index: number;
  width: number;
  height: number;
  delayMs: number;
  pixels: Uint8ClampedArray;
};

export type VirtualSpriteTimelineEntry = {
  frameIndex: number;
  durationTicks: number;
};

export type VirtualSpriteAsset = {
  width: number;
  height: number;
  frames: Uint8ClampedArray[];
  timeline: VirtualSpriteTimelineEntry[];
  totalTicks: number;
  report: {
    sourceWidth: number;
    sourceHeight: number;
    sourceFrameCount: number;
    uniqueFrameCount: number;
    timelineEntryCount: number;
    crop: { x: number; y: number; width: number; height: number };
  };
};

const SPRITE_SIZE = 96;
const PWGF_MAGIC = [0x50, 0x57, 0x47, 0x46] as const; // PWGF
const PWGF_VERSION = 1;

type Rect = { x: number; y: number; width: number; height: number };

export function buildVirtualSpriteAssetFromGif(bytes: Uint8Array): VirtualSpriteAsset {
  const sourceFrames = decodeGifFrames(bytes);
  const normalized = normalizeFrames(sourceFrames);
  const { frames, timeline } = dedupeFrames(normalized);
  const totalTicks = timeline.reduce((sum, entry) => sum + entry.durationTicks, 0);
  const source = sourceFrames[0];
  if (!source) throw new Error("GIF does not contain any frames.");
  const crop = computeCenterCrop(sourceFrames);

  return {
    width: SPRITE_SIZE,
    height: SPRITE_SIZE,
    frames,
    timeline,
    totalTicks,
    report: {
      sourceWidth: source.width,
      sourceHeight: source.height,
      sourceFrameCount: sourceFrames.length,
      uniqueFrameCount: frames.length,
      timelineEntryCount: timeline.length,
      crop,
    },
  };
}

export function encodeVirtualSpriteAsset(asset: VirtualSpriteAsset): Uint8Array {
  if (asset.width <= 0 || asset.width > 0xffff || asset.height <= 0 || asset.height > 0xffff) {
    throw new Error(`Invalid virtual sprite dimensions ${asset.width}x${asset.height}.`);
  }
  if (asset.frames.length > 0xffff) throw new Error("Too many unique frames for PWGF v1.");
  if (asset.timeline.length > 0xffff) throw new Error("Too many timeline entries for PWGF v1.");

  const frameBytes = asset.width * asset.height * 4;
  const headerSize = 20;
  const timelineSize = asset.timeline.length * 4;
  const output = new Uint8Array(headerSize + timelineSize + asset.frames.length * frameBytes);
  const view = new DataView(output.buffer);
  output.set(PWGF_MAGIC, 0);
  view.setUint16(4, PWGF_VERSION, true);
  view.setUint16(6, asset.width, true);
  view.setUint16(8, asset.height, true);
  view.setUint16(10, asset.frames.length, true);
  view.setUint16(12, asset.timeline.length, true);
  view.setUint32(14, asset.totalTicks, true);
  view.setUint16(18, 0, true);

  let offset = headerSize;
  for (const entry of asset.timeline) {
    view.setUint16(offset, entry.frameIndex, true);
    view.setUint16(offset + 2, entry.durationTicks, true);
    offset += 4;
  }
  for (const frame of asset.frames) {
    if (frame.length !== frameBytes) throw new Error(`Frame has ${frame.length} bytes; expected ${frameBytes}.`);
    output.set(frame, offset);
    offset += frameBytes;
  }
  return output;
}

export function decodeGifFrames(bytes: Uint8Array): VirtualSpriteFrame[] {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = parseGIF(arrayBuffer);
  const decompressed = decompressFrames(parsed, true);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  let canvas = new Uint8ClampedArray(width * height * 4);

  return decompressed.map((frame, index) => {
    const before = new Uint8ClampedArray(canvas);
    blitPatch(canvas, width, frame.patch, frame.dims);
    const pixels = new Uint8ClampedArray(canvas);
    if (frame.disposalType === 2) clearRect(canvas, width, frame.dims);
    else if (frame.disposalType === 3) canvas = before;
    return { index, width, height, delayMs: Math.max(10, frame.delay ?? 100), pixels };
  });
}

function normalizeFrames(frames: VirtualSpriteFrame[]): VirtualSpriteFrame[] {
  if (frames.length === 0) throw new Error("Cannot normalize an empty frame set.");
  const crop = computeCenterCrop(frames);
  return frames.map((frame) => ({
    index: frame.index,
    width: SPRITE_SIZE,
    height: SPRITE_SIZE,
    delayMs: frame.delayMs,
    pixels: cropFrame(frame, crop),
  }));
}

function computeCenterCrop(frames: VirtualSpriteFrame[]): Rect {
  const bounds = unionBounds(frames.map((frame) => alphaBounds(frame)).filter((box): box is Rect => Boolean(box)));
  const first = frames[0];
  if (!first) throw new Error("Cannot crop an empty frame set.");
  const centerX = bounds ? bounds.x + bounds.width / 2 : first.width / 2;
  const centerY = bounds ? bounds.y + bounds.height / 2 : first.height / 2;
  return { x: Math.round(centerX - SPRITE_SIZE / 2), y: Math.round(centerY - SPRITE_SIZE / 2), width: SPRITE_SIZE, height: SPRITE_SIZE };
}

function dedupeFrames(frames: VirtualSpriteFrame[]): Pick<VirtualSpriteAsset, "frames" | "timeline"> {
  const unique = new Map<string, number>();
  const outFrames: Uint8ClampedArray[] = [];
  const timeline: VirtualSpriteTimelineEntry[] = [];

  for (const frame of frames) {
    const hash = createHash("sha1").update(frame.pixels).digest("hex");
    let frameIndex = unique.get(hash);
    if (frameIndex === undefined) {
      frameIndex = outFrames.length;
      unique.set(hash, frameIndex);
      outFrames.push(frame.pixels);
    }
    timeline.push({ frameIndex, durationTicks: msToTicks(frame.delayMs) });
  }
  return { frames: outFrames, timeline };
}

function msToTicks(delayMs: number): number {
  return Math.max(1, Math.min(0xffff, Math.round((delayMs * 60) / 1000)));
}

function blitPatch(canvas: Uint8ClampedArray, canvasWidth: number, patch: Uint8ClampedArray, dims: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      const source = (y * dims.width + x) * 4;
      if (patch[source + 3] === 0) continue;
      const dest = ((dims.top + y) * canvasWidth + dims.left + x) * 4;
      canvas.set(patch.subarray(source, source + 4), dest);
    }
  }
}

function clearRect(canvas: Uint8ClampedArray, canvasWidth: number, dims: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      const offset = ((dims.top + y) * canvasWidth + dims.left + x) * 4;
      canvas.fill(0, offset, offset + 4);
    }
  }
}

function cropFrame(frame: VirtualSpriteFrame, crop: Rect): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const sourceX = crop.x + x;
      const sourceY = crop.y + y;
      if (sourceX < 0 || sourceX >= frame.width || sourceY < 0 || sourceY >= frame.height) continue;
      pixels.set(frame.pixels.subarray((sourceY * frame.width + sourceX) * 4, (sourceY * frame.width + sourceX) * 4 + 4), (y * crop.width + x) * 4);
    }
  }
  return pixels;
}

function alphaBounds(frame: VirtualSpriteFrame): Rect | undefined {
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (frame.pixels[(y * frame.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
}

function unionBounds(bounds: Rect[]): Rect | undefined {
  if (bounds.length === 0) return undefined;
  const x = Math.min(...bounds.map((box) => box.x));
  const y = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.width));
  const bottom = Math.max(...bounds.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}
