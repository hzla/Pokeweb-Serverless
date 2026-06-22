import type { Gen4MapPermissionTile } from "../pokeweb/gen4MapModel";
import type { Gen4StitchedMapCell, Gen4StitchedMapPreview } from "../pokeweb/gen4MapPreviewModel";

export type Gen4MapPreviewRenderOptions = {
  pixelsPerTile?: number;
  showTileGrid?: boolean;
  showMatrixBorders?: boolean;
};

const DEFAULT_PIXELS_PER_TILE = 8;
const BACKGROUND_FILL = "#282a36";
const EMPTY_CELL_FILL = "#202330";
const MISSING_CELL_FILL = "#3b2430";

export function createGen4MapPreviewCanvas(preview: Gen4StitchedMapPreview, options: Gen4MapPreviewRenderOptions = {}): HTMLCanvasElement {
  const pixelsPerTile = Math.max(1, Math.floor(options.pixelsPerTile ?? DEFAULT_PIXELS_PER_TILE));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, preview.width * pixelsPerTile);
  canvas.height = Math.max(1, preview.height * pixelsPerTile);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create Gen 4 map preview canvas");
  drawGen4MapPreviewGrid(context, preview, { ...options, pixelsPerTile });
  return canvas;
}

export function drawGen4MapPreviewGrid(
  context: CanvasRenderingContext2D,
  preview: Gen4StitchedMapPreview,
  options: Gen4MapPreviewRenderOptions = {},
): void {
  const pixelsPerTile = Math.max(1, Math.floor(options.pixelsPerTile ?? DEFAULT_PIXELS_PER_TILE));
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.fillStyle = BACKGROUND_FILL;
  context.fillRect(0, 0, preview.width * pixelsPerTile, preview.height * pixelsPerTile);

  for (const cell of preview.cells) drawCell(context, cell, pixelsPerTile);
  if (options.showTileGrid ?? pixelsPerTile >= 6) drawTileGrid(context, preview, pixelsPerTile);
  if (options.showMatrixBorders ?? true) drawMatrixBorders(context, preview.cells, pixelsPerTile);
}

export function gen4PermissionTileFill(tile: Pick<Gen4MapPermissionTile, "type" | "collision" | "blocked">): string {
  if (tile.blocked) return "#343946";
  if (isWaterLikeGen4Permission(tile.type)) return "#3da5ff";
  if (isGrassLikeGen4Permission(tile.type)) return "#42d66b";
  if (isSandLikeGen4Permission(tile.type)) return "#d8b35a";
  if (isLedgeLikeGen4Permission(tile.type)) return "#d38b4f";
  if ((tile.collision & 0x40) !== 0) return "#a78bfa";
  if ((tile.collision & 0x20) !== 0) return "#ffcf66";
  if (tile.type === 0 && tile.collision === 0) return "#7bd88f";
  return colorFromPermission(tile.type, tile.collision);
}

function drawCell(context: CanvasRenderingContext2D, cell: Gen4StitchedMapCell, pixelsPerTile: number): void {
  const x = cell.x * pixelsPerTile;
  const y = cell.y * pixelsPerTile;
  const width = cell.width * pixelsPerTile;
  const height = cell.height * pixelsPerTile;
  if (cell.empty || cell.missing) {
    context.fillStyle = cell.missing ? MISSING_CELL_FILL : EMPTY_CELL_FILL;
    context.fillRect(x, y, width, height);
    return;
  }

  for (const tile of cell.tiles) {
    context.fillStyle = gen4PermissionTileFill(tile);
    context.fillRect(x + tile.x * pixelsPerTile, y + tile.y * pixelsPerTile, pixelsPerTile, pixelsPerTile);
  }
}

function drawTileGrid(context: CanvasRenderingContext2D, preview: Gen4StitchedMapPreview, pixelsPerTile: number): void {
  context.save();
  context.strokeStyle = "rgba(10, 12, 18, 0.20)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= preview.width; x += 1) {
    const px = x * pixelsPerTile + 0.5;
    context.moveTo(px, 0);
    context.lineTo(px, preview.height * pixelsPerTile);
  }
  for (let y = 0; y <= preview.height; y += 1) {
    const py = y * pixelsPerTile + 0.5;
    context.moveTo(0, py);
    context.lineTo(preview.width * pixelsPerTile, py);
  }
  context.stroke();
  context.restore();
}

function drawMatrixBorders(context: CanvasRenderingContext2D, cells: Gen4StitchedMapCell[], pixelsPerTile: number): void {
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 2;
  for (const cell of cells) {
    context.strokeRect(cell.x * pixelsPerTile + 1, cell.y * pixelsPerTile + 1, cell.width * pixelsPerTile - 2, cell.height * pixelsPerTile - 2);
  }
  context.restore();
}

function isWaterLikeGen4Permission(type: number): boolean {
  return [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x1c, 0x3d, 0x3e, 0x3f, 0x40, 0x41].includes(type);
}

function isGrassLikeGen4Permission(type: number): boolean {
  return [0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x1f, 0x21, 0x22, 0xa2].includes(type);
}

function isSandLikeGen4Permission(type: number): boolean {
  return [0x0b, 0x0c, 0x19, 0x23, 0x7c].includes(type);
}

function isLedgeLikeGen4Permission(type: number): boolean {
  return [0x72, 0x73, 0x74, 0x75].includes(type);
}

function colorFromPermission(type: number, collision: number): string {
  const hue = (type * 47 + collision * 13) % 360;
  const saturation = 54 + (collision % 22);
  const lightness = 46 + (type % 12);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
