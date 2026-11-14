import { readU16, readU32 } from "../nds/binary";
import { ensureGen5RomBytes, gen5RomArchive } from "../pokeweb/gen5UiImages";
import type { ProjectState } from "../pokeweb/projectStore";

/**
 * Move buttons in the viewer wear the frame of Pokeweb's Move Effectiveness patch: the battle screen's own move button,
 * squeezed into a one-line nameplate. This follows the patch's drawing code (runtime/battle-type-hud/move_colors.h,
 * captureLabelFrame and showLabel, the BW2 profile): sample the stock move page (BG5, archive a/0/1/1) at fixed rows,
 * keep each side's frame pixels up to the dot grid, inset the rows along the bend, and add the two raised corners above
 * and below. The stock button's colours come from its type's palette (BtlvInput_DrawMoveTiles), so a hack's own
 * move buttons show through.
 *
 * Each type gets three images for CSS: the left end, a 3-pixel tile of the middle (the dot grid's period) and the
 * right end. They are set on the viewer as --msv-move-<type>-<l|m|r>; an empty slot uses --msv-move-none-*.
 */

const ARCHIVE = "a/0/1/1";
const BUTTON_TILES = 0x166;
const MOVE_PAGE_MAP = 0x174;
/** The tile palette of each move type, by type index (ov168 data_ov168_021f3864); 572 is Fairy's where a hack adds it. */
const TYPE_PALETTES = [464, 470, 473, 471, 472, 476, 475, 477, 479, 465, 466, 468, 467, 469, 478, 474, 480, 572];
/** The palette of a slot without a move. */
const EMPTY_PALETTE = 463;

const LABEL_HEIGHT = 17;
const EDGE_WIDTH = 16;
const GRID_PERIOD = 3;
const GRID_TOP = 3;
const GRID_BOTTOM = 14;
const FRAME_ROWS = [3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 39, 40, 41, 42, 43, 44];
const FRAME_INSETS = [6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3];
/** Widths of the left and right images: everything that isn't the plain middle. The left is a whole number of grid periods. */
export const MOVE_FRAME_LEFT = 24;
export const MOVE_FRAME_RIGHT = 22;
export const MOVE_FRAME_HEIGHT = LABEL_HEIGHT + 2;

type FrameRow = { sides: [number[], number[]]; grid: number[] };
type Frame = { rows: FrameRow[]; caps: [[number[], number[]], [number[], number[]]] };

function chunk(bytes: Uint8Array, magic: string): number {
  for (let at = readU16(bytes, 12); at + 8 <= bytes.length; at += readU32(bytes, at + 4)) {
    if (String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!) === magic) return at;
    if (!readU32(bytes, at + 4)) break;
  }
  throw new Error(`Missing ${magic} block.`);
}

function palette(file: Uint8Array): Array<[number, number, number]> {
  const data = chunk(file, "TTLP") + 0x18;
  return Array.from({ length: 16 }, (_, index) => {
    const value = readU16(file, data + index * 2);
    return [((value & 31) * 255) / 31, (((value >> 5) & 31) * 255) / 31, (((value >> 10) & 31) * 255) / 31].map(Math.round) as [number, number, number];
  });
}

/** The pixel value of the stock move button in slot 0 (the top-left button), as the patch reads it from VRAM. */
function stockReader(tilesFile: Uint8Array, mapFile: Uint8Array) {
  const tiles = chunk(tilesFile, "RAHC") + 0x20;
  const map = chunk(mapFile, "NRCS") + 0x14;
  return (x: number, row: number): number => {
    const y = 224 + row;
    // The move page lies in the right-hand screen blocks of BG5's 512 × 512 map.
    const entry = readU16(mapFile, map + 0x800 + Math.floor(y / 256) * 0x1000 + ((Math.floor((y & 255) / 8) * 32 + Math.floor(x / 8)) * 2));
    if (entry >> 12 !== 9) return 0;
    const tx = (x & 7) ^ (entry & 0x400 ? 7 : 0);
    const ty = (y & 7) ^ (entry & 0x800 ? 7 : 0);
    const byte = tilesFile[tiles + (entry & 1023) * 32 + ty * 4 + (tx >> 1)] ?? 0;
    return (byte >> ((tx & 1) * 4)) & 15;
  };
}

/** captureLabelFrame: each label row's two ends and grid, sampled from the stock button. */
function captureFrame(stock: (x: number, row: number) => number): Frame {
  const sideRow = (y: number, side: number) => (side ? LABEL_HEIGHT - 1 - y : y);
  const grid = (pixel: number) => pixel === 3 || pixel === 5;
  const rows: FrameRow[] = [];
  const caps: Frame["caps"] = [[[], []], [[], []]];
  let gridRow = 6;
  for (let y = 0; y < LABEL_HEIGHT; y++) {
    const interior = y >= GRID_TOP && y < GRID_BOTTOM;
    const row: FrameRow = { sides: [[], []], grid: [] };
    for (const side of [0, 1] as const) {
      const sample = FRAME_ROWS[sideRow(y, side)]!;
      const source = side ? 47 - sample : sample;
      const at = (x: number, from: number) => stock(side ? 127 - x : x, from);
      let start = 0;
      while (start < 64 && !at(start, source)) start++;
      if (start === 64) throw new Error("The stock move button has no frame.");
      if (y === 0 || y === LABEL_HEIGHT - 1) {
        const cap = y === 0 ? 0 : 1;
        for (let i = 0; i < EDGE_WIDTH; i++) caps[cap][side].push(at(start + i, cap ? 45 : 2));
      }
      for (let i = 0; i < EDGE_WIDTH; i++) {
        const pixel = at(start + i, source);
        if (interior && grid(pixel)) break;
        row.sides[side].push(pixel);
      }
    }
    const gridSource = interior ? gridRow : FRAME_ROWS[y]!;
    for (let x = 0; x < GRID_PERIOD; x++) row.grid.push(stock(56 + x, gridSource));
    if (interior && ++gridRow === 6 + GRID_PERIOD) gridRow = 6;
    rows.push(row);
  }
  return { rows, caps };
}

/** showLabel: the plate at a width, as pixel values, with the corners above and below. 0 is transparent. */
function drawLabel(frame: Frame, width: number): number[][] {
  const sideRow = (y: number, side: number) => (side ? LABEL_HEIGHT - 1 - y : y);
  const image = Array.from({ length: MOVE_FRAME_HEIGHT }, () => new Array<number>(width).fill(0));
  for (let y = 0; y < LABEL_HEIGHT; y++) {
    const row = frame.rows[y]!;
    const left = FRAME_INSETS[y]!;
    const right = FRAME_INSETS[sideRow(y, 1)]!;
    let phase = left % GRID_PERIOD;
    for (let x = left; x < width - right; x++) {
      let color = row.grid[phase]!;
      const fromLeft = x - left;
      const fromRight = width - right - 1 - x;
      if (fromLeft < row.sides[0].length) color = row.sides[0][fromLeft]!;
      if (fromRight < row.sides[1].length) color = row.sides[1][fromRight]!;
      image[y + 1]![x] = color;
      phase = (phase + 1) % GRID_PERIOD;
    }
  }
  for (const cap of [0, 1] as const) {
    const edgeY = cap ? LABEL_HEIGHT - 1 : 0;
    const y = cap ? LABEL_HEIGHT + 1 : 0;
    for (let i = 0; i < EDGE_WIDTH; i++) {
      image[y]![FRAME_INSETS[edgeY]! + i] = frame.caps[cap][0][i]!;
      image[y]![width - 1 - FRAME_INSETS[sideRow(edgeY, 1)]! - i] = frame.caps[cap][1][i]!;
    }
  }
  return image;
}

function toUrl(image: number[][], colors: Array<[number, number, number]>, from: number, to: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = to - from;
  canvas.height = image.length;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(canvas.width, canvas.height);
  image.forEach((row, y) => {
    for (let x = from; x < to; x++) {
      const value = row[x]!;
      if (!value) continue;
      const at = (y * canvas.width + (x - from)) * 4;
      const [r, g, b] = colors[value]!;
      data.data[at] = r;
      data.data[at + 1] = g;
      data.data[at + 2] = b;
      data.data[at + 3] = 255;
    }
  });
  context.putImageData(data, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Couldn't draw a move frame."))), "image/png"));
}

let installed: Promise<boolean> | undefined;

/** Draws every type's move frame from the ROM and sets them on `host` as CSS variables. BW2 only. */
export function installMoveFrames(project: ProjectState, host: HTMLElement): Promise<boolean> {
  installed ??= (async () => {
    try {
      if (project.session.baseRom !== "BW2" || !(await ensureGen5RomBytes(project))) return false;
      const files = gen5RomArchive(project, ARCHIVE);
      const frame = captureFrame(stockReader(files[BUTTON_TILES]!, files[MOVE_PAGE_MAP]!));
      // One grid period between the ends; the middle image is that period.
      const width = MOVE_FRAME_LEFT + GRID_PERIOD + MOVE_FRAME_RIGHT;
      const image = drawLabel(frame, width);
      const entries: Array<[string, number]> = [["none", EMPTY_PALETTE], ...TYPE_PALETTES.map((file, type) => [String(type), file] as [string, number])];
      for (const [name, file] of entries) {
        const source = files[file];
        if (!source) continue;
        const colors = palette(source);
        const [left, middle, right] = await Promise.all([
          toUrl(image, colors, 0, MOVE_FRAME_LEFT),
          toUrl(image, colors, MOVE_FRAME_LEFT, MOVE_FRAME_LEFT + GRID_PERIOD),
          toUrl(image, colors, width - MOVE_FRAME_RIGHT, width),
        ]);
        host.style.setProperty(`--msv-move-${name}-l`, `url("${left}")`);
        host.style.setProperty(`--msv-move-${name}-m`, `url("${middle}")`);
        host.style.setProperty(`--msv-move-${name}-r`, `url("${right}")`);
      }
      host.classList.add("-move-frames");
      return true;
    } catch (error) {
      console.warn("The move button frames couldn't be drawn from the ROM; moves keep the plain frame.", error);
      return false;
    }
  })();
  return installed;
}
