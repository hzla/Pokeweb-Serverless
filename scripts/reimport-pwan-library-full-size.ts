// Re-imports the PWAN library sprites (src/assets/pwan/library) whose source GIFs were downscaled to fit 96x96.
// npx vite-node scripts/reimport-pwan-library-full-size.ts <sprites dir> [--dry-run]
//
// <sprites dir> is ~/Repos/Port-Pokeweb/sprites: every side's source is the GIF its manifest entry records
// (spriteSources, chosen by "Sprite Import Priority"), so the same priority choice is kept. A side was downscaled when
// its GIF's canvas is larger than 96x96 (the PWAN compiler fits the canvas into 96x96) and the art is drawn at that
// size (not an integer upscale of 96x96 pixel art, as retromc's 480x480 GIFs are). Such a side:
//
// - art larger than 96x96: gains a full-size stream (up to 128x128, an A3I5 MANI, animStreamsFullSize.ts) for the
//   streaming runtime, stored as an extra archive member (manifest `fullSize`). Its 96x96 PWAN stays for the PWAN
//   runtime and previews; the stream uses the PWAN's palette, so the carrier's native palette matches both.
// - art within 96x96 (a canvas with margins): its PWAN is recompiled from the art at its own size.
//
// Sides whose GIF puts a comment between an image and its Graphic Control Extension (ezgif) lost their transparency
// to the old GIF decoder (black boxes); they are recompiled too, at their own size.
//
// Both compile as the library's sprites do: Gen 5 preset (+15% saturation, +10% contrast), 15 RGB555 colours,
// nearest-neighbour scaling, the side's timing (Diego's GIFs at half speed) and its placement (how far the PWAN
// stands above the ground), within the runtime's limits.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGIF } from "gifuct-js";
import { NARC } from "../src/nds/narc";
import { decodeGifFrames, type AnimationAnalysisFrame } from "../src/pokeweb/gifAnimationFrames";
import { compilePwanAnimationFrames, parsePwanHeader, pwanFramePixels, pwanPalette, scalePwanTimelineSpeed, shiftPwanFrames } from "../src/pokeweb/pwanCompiler";
import { adjustFullSizeMani, compileFramesToFullSizeStream, parseFullSizeMani, type FullSizeSide } from "../src/pokeweb/animStreamsFullSize";
import { parsePwanArchive, pwanArchiveMemberId } from "../src/pokeweb/pwanAnimationModel";
import { parsePwanLibraryArchive, type PwanLibraryManifest } from "../src/pokeweb/pwanLibraryModel";
import { readBundledPwanArchive, writeBundledPwanArchive } from "./lib/pwan-library-payload";

const PWAN_SIZE = 96;
const PRESET = "gen5" as const;
/** The highest box top over the ground point each side may take (animStreamsFullSize's placement limits). */
const TOP_LIMIT: Record<FullSizeSide, number> = { front: -6 - 88, back: 0 - 88 };
/**
 * Sources that hold several sprites: the cell that is this side's. Smogon's Minior core GIFs are a 4x2 sheet of all
 * seven cores and the shiny one, 96x96 each (Blue is the first of the second row); the sheet's corner marks are not art.
 */
const SHEET_CELLS: Record<string, { x: number; y: number; width: number; height: number }> = {
  "gen7-sprite-work/downloads/miniorblue-front.gif": { x: 0, y: 96, width: 96, height: 96 },
  "gen7-sprite-work/downloads/miniorblue-back.gif": { x: 0, y: 96, width: 96, height: 96 },
};
const NOTE_FULL = / Full size \(up to 128x128\)[^]*?PWAN runtime\./;
const NOTE_NATIVE = / Re-imported at the art's own size: [^]*?\(scripts\/reimport-pwan-library-full-size\.ts\)\./;

const [spritesDir] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
if (!spritesDir) throw new Error("Usage: reimport-pwan-library-full-size.ts <sprites dir> [--dry-run]");
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/assets/pwan/library");
const manifest: PwanLibraryManifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const narc = new NARC(await readBundledPwanArchive(directory));
const overrides = parsePwanArchive(narc);

type Box = { x: number; y: number; width: number; height: number };
function artBounds(frames: AnimationAnalysisFrame[]): Box | undefined {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      if ((frame.pixels[(y * frame.width + x) * 4 + 3] ?? 0) < 128) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The largest k (2..8) for which the frame is k x k blocks of one colour (at some alignment), else 1. */
function pixelFactor(frame: AnimationAnalysisFrame): number {
  const px = (x: number, y: number) => {
    const at = (y * frame.width + x) * 4;
    return (frame.pixels[at + 3] ?? 0) < 128 ? -1 : (frame.pixels[at]! << 16) | (frame.pixels[at + 1]! << 8) | frame.pixels[at + 2]!;
  };
  let best = 1;
  for (let k = 2; k <= 8; k++) {
    let found = false;
    for (let oy = 0; oy < k && !found; oy++) for (let ox = 0; ox < k && !found; ox++) {
      let blocks = 0, mixed = 0;
      for (let by = oy; by + k <= frame.height; by += k) for (let bx = ox; bx + k <= frame.width; bx += k) {
        const ref = px(bx, by);
        let uniform = true;
        for (let y = 0; y < k && uniform; y++) for (let x = 0; x < k; x++) if (px(bx + x, by + y) !== ref) { uniform = false; break; }
        blocks++;
        if (!uniform) mixed++;
      }
      found = blocks > 0 && mixed / blocks < 0.01;
    }
    if (found) best = k;
  }
  return best;
}

function crop(frames: AnimationAnalysisFrame[], box: Box, dropBorderMarks = false): AnimationAnalysisFrame[] {
  return frames.map((frame) => {
    const pixels = new Uint8ClampedArray(box.width * box.height * 4);
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      const sx = box.x + x, sy = box.y + y;
      if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height) continue;
      pixels.set(frame.pixels.subarray((sy * frame.width + sx) * 4, (sy * frame.width + sx) * 4 + 4), (y * box.width + x) * 4);
    }
    if (dropBorderMarks) {
      const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < box.width && y < box.height && (pixels[(y * box.width + x) * 4 + 3] ?? 0) >= 128;
      for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
        if ((x && y && x < box.width - 1 && y < box.height - 1) || !opaque(x, y)) continue;
        let alone = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && opaque(x + dx, y + dy)) alone = false;
        if (alone) pixels.fill(0, (y * box.width + x) * 4, (y * box.width + x) * 4 + 4);
      }
    }
    return { ...frame, width: box.width, height: box.height, pixels };
  });
}

/**
 * Whether an image's Graphic Control Extension is separated from it by another extension (ezgif's comment): the
 * decoder before decodeGifFrames' fix dropped it, so the side was compiled without transparency (a black box).
 */
function lostGraphicControl(bytes: Uint8Array): boolean {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  let pending = false;
  for (const block of parsed.frames as Array<{ gce?: unknown; image?: unknown }>) {
    if (!block.image) { pending ||= Boolean(block.gce); continue; }
    if (!block.gce && pending) return true;
    pending = false;
  }
  return false;
}

/** The lowest art row of a PWAN (its ground: row 95 stands on the ground point). */
function pwanMaxY(bytes: Uint8Array): number {
  const header = parsePwanHeader(bytes);
  let maxY = -1;
  for (let n = 0; n < header.frameCount; n++) {
    const rows = pwanFramePixels(bytes, n);
    for (let y = PWAN_SIZE - 1; y > maxY; y--) if (rows[y]!.some(Boolean)) { maxY = y; break; }
  }
  return maxY;
}

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fullMembers = new Map<string, number>(); // MANI hash -> member
const previousFullMembers = new Set(manifest.entries.flatMap((entry) => Object.values(entry.fullSize ?? {}).map((record) => record!.memberId)));
// An earlier run's members are reused for the same stream, so a run over an up-to-date library changes nothing.
for (const memberId of previousFullMembers) if (narc.files[memberId]?.length) fullMembers.set(hash(narc.files[memberId]!), memberId);
const doneAssets = new Map<string, Uint8Array>(); // asset:side -> recompiled PWAN
const log: string[] = [];
const report: Array<Record<string, unknown>> = [];

for (const entry of manifest.entries) {
  const override = overrides.find((o) => o.speciesId === entry.speciesId && (o.formIndex ?? 0) === entry.formIndex && (o.assetIndex ?? o.speciesId) === entry.assetIndex);
  delete entry.fullSize;
  if (entry.notes) entry.notes = entry.notes.replace(NOTE_FULL, "").replace(NOTE_NATIVE, "");
  const fullNotes: string[] = [], ownSizeNotes: string[] = [];
  for (const source of entry.spriteSources ?? []) {
    const side = source.side;
    const member = pwanArchiveMemberId(entry.assetIndex, side);
    const libraryPwan = narc.files[member];
    if (!override?.[side] || !libraryPwan?.length) throw new Error(`${entry.name}: no library ${side}`);
    const bytes = new Uint8Array(await readFile(path.join(spritesDir, source.source)));
    const gif = decodeGifFrames(bytes);
    const cell = SHEET_CELLS[source.source];
    const repaired = lostGraphicControl(bytes);
    let frames = cell ? crop(gif, cell, true) : gif;
    const canvas = { width: frames[0]!.width, height: frames[0]!.height };
    if (canvas.width <= PWAN_SIZE && canvas.height <= PWAN_SIZE && !cell && !repaired) continue; // compiled at its own size
    const factor = pixelFactor(frames[0]!);
    if (factor > 1 && canvas.width / factor <= PWAN_SIZE && canvas.height / factor <= PWAN_SIZE && !repaired) continue; // pixel art upscaled
    const art = artBounds(frames);
    if (!art) throw new Error(`${entry.name} ${side}: ${source.source} has no art`);
    // Timing and placement are the library side's: Diego's GIFs play at half speed; the PWAN may stand above the ground.
    const plain = compilePwanAnimationFrames(gif, { colorPreset: PRESET });
    const timing = Math.round(parsePwanHeader(libraryPwan).totalTicks / plain.totalTicks * 2) / 2;
    const lift = PWAN_SIZE - 1 - pwanMaxY(libraryPwan);
    const record: Record<string, unknown> = { entry: entry.id, name: entry.name, side, source: source.source, canvas, art: { width: art.width, height: art.height }, timing, ...(repaired ? { transparencyRepaired: true } : {}) };

    if (cell || (art.width <= PWAN_SIZE && art.height <= PWAN_SIZE)) {
      // The art fits: a 96x96 window over it (the canvas's bottom row, centred as the canvas is, unless that cuts it).
      const key = `${entry.assetIndex}:${side}`;
      let pwan = doneAssets.get(key);
      if (!pwan) {
        let window = frames;
        if (!cell) {
          const bottom = canvas.height;
          let x = Math.floor((canvas.width - PWAN_SIZE) / 2);
          if (art.x < x || art.x + art.width > x + PWAN_SIZE) x = art.x + Math.floor((art.width - PWAN_SIZE) / 2);
          window = crop(frames, { x, y: bottom - PWAN_SIZE, width: PWAN_SIZE, height: PWAN_SIZE });
        }
        const result = compilePwanAnimationFrames(window, { colorPreset: PRESET });
        pwan = result.pwanBytes;
        if (timing !== 1) pwan = scalePwanTimelineSpeed(pwan, timing).pwanBytes;
        // A sheet's cell is the artist's own 96x96 placement; otherwise the library side's lift is kept.
        const shift = cell ? 0 : (PWAN_SIZE - 1 - lift) - pwanMaxY(pwan);
        if (shift) pwan = shiftPwanFrames(pwan, 0, shift).pwanBytes;
        doneAssets.set(key, pwan);
        record.shift = shift;
      }
      narc.files[member] = pwan;
      record.mode = "pwan at own size";
      ownSizeNotes.push(`${side} from its ${cell ? "sheet cell" : `${art.width}x${art.height} art`}${repaired ? " with its transparency" : ""}`);
      log.push(`${entry.name} ${side}: ${source.source} (${canvas.width}x${canvas.height}${cell ? ", sheet cell" : ""}${repaired ? ", transparency restored" : ""}) -> 96x96 PWAN at the art's own size`);
    } else {
      const full = compileFramesToFullSizeStream(frames, { side, colorPreset: PRESET, palette: pwanPalette(libraryPwan) });
      const limit = TOP_LIMIT[side];
      const y0 = Math.max(full.y0 - lift, Math.min(full.y0, limit));
      let mani = adjustFullSizeMani(full.mani, { dy: y0 - full.y0, durationScale: timing });
      const info = parseFullSizeMani(mani);
      const digest = hash(mani);
      let memberId = fullMembers.get(digest);
      if (memberId === undefined) {
        memberId = narc.files.length;
        narc.files.push(mani);
        fullMembers.set(digest, memberId);
      } else mani = narc.files[memberId]!;
      (entry.fullSize ??= {})[side] = { memberId, width: info.width, height: info.height };
      Object.assign(record, { mode: "full size", width: info.width, height: info.height, x0: info.x0, y0: info.y0, lift, liftApplied: full.y0 - y0, uniqueFrames: info.frames.length, bytes: mani.length, memberId, warnings: full.warnings });
      fullNotes.push(`${side} ${info.width}x${info.height}`);
      log.push(`${entry.name} ${side}: ${source.source} (art ${art.width}x${art.height}) -> full size ${info.width}x${info.height} at (${info.x0}, ${info.y0}), ${info.frames.length} frames, ${mani.length} bytes${timing !== 1 ? `, timing x${timing}` : ""}`);
    }
    report.push(record);
  }
  if (fullNotes.length) entry.notes = `${entry.notes ?? ""} Full size (up to 128x128) for the streaming runtime: ${fullNotes.join(", ")} (scripts/reimport-pwan-library-full-size.ts); the 96x96 PWAN is kept for previews and the PWAN runtime.`.trim();
  if (ownSizeNotes.length) entry.notes = `${entry.notes ?? ""} Re-imported at the art's own size: ${ownSizeNotes.join(", ")} (scripts/reimport-pwan-library-full-size.ts).`.trim();
}

// Full-size members no entry uses any more (an earlier run's) are emptied, not renumbered.
const used = new Set(manifest.entries.flatMap((entry) => Object.values(entry.fullSize ?? {}).map((record) => record!.memberId)));
for (const memberId of previousFullMembers) if (!used.has(memberId)) narc.files[memberId] = new Uint8Array();

const archive = narc.save();
manifest.archiveBytes = archive.length;
const library = parsePwanLibraryArchive(manifest, archive); // the app's own loader must accept it
const fullSides = [...library.overridesByEntryId.values()].reduce((n, o) => n + (o.front?.fullSizeMani ? 1 : 0) + (o.back?.fullSizeMani ? 1 : 0), 0);
console.log(log.join("\n"));
const summary = { fullSizeSides: report.filter((r) => r.mode === "full size").length, ownSizePwanSides: report.filter((r) => r.mode !== "full size").length, loadedFullSizeSides: fullSides, fullSizeMembers: fullMembers.size, archiveBytes: archive.length };
console.log(JSON.stringify(summary));
if (dryRun) process.exit(0);
const distribution = await writeBundledPwanArchive(directory, archive);
await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const buildReport = JSON.parse(await readFile(path.join(directory, "build-report.json"), "utf8"));
buildReport.distribution = distribution;
buildReport.archiveBytes = archive.length;
buildReport.fullSize = { script: "scripts/reimport-pwan-library-full-size.ts", preset: PRESET, ...summary, sides: report };
await writeFile(path.join(directory, "build-report.json"), JSON.stringify(buildReport, null, 2) + "\n");
console.log(JSON.stringify(distribution));
