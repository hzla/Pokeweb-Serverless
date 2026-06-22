import { isGen4Project } from "./constants";
import { GEN4_MAP_TILE_HEIGHT, GEN4_MAP_TILE_WIDTH, gen4MapTiles, type Gen4MapPermissionTile } from "./gen4MapModel";
import { GEN4_MATRIX_EMPTY } from "./gen4MatrixModel";
import { decodeRecord, type ProjectState, type RawRecord } from "./projectStore";

export type Gen4StitchedMapCell = {
  index: number;
  matrixX: number;
  matrixY: number;
  x: number;
  y: number;
  width: typeof GEN4_MAP_TILE_WIDTH;
  height: typeof GEN4_MAP_TILE_HEIGHT;
  mapId: number;
  headerId?: number;
  altitude: number;
  tiles: Gen4MapPermissionTile[];
  empty: boolean;
  missing: boolean;
};

export type Gen4StitchedMapPreview = {
  matrixId: number;
  width: number;
  height: number;
  cellWidth: typeof GEN4_MAP_TILE_WIDTH;
  cellHeight: typeof GEN4_MAP_TILE_HEIGHT;
  cells: Gen4StitchedMapCell[];
  warnings: string[];
};

type MatrixCell = {
  index: number;
  matrixX: number;
  matrixY: number;
  x: number;
  y: number;
  mapId: number;
  headerId?: number;
  altitude: number;
};

export function buildGen4MapPreview(project: ProjectState, matrixId: number, options: { headerId?: number; headerIds?: number[] } = {}): Gen4StitchedMapPreview {
  if (!isGen4Project(project)) throw new Error("Gen 4 map previews require a Gen 4 project");
  if (!project.narcs.matrix) throw new Error("NARC is not loaded: matrix");
  if (!project.narcs.maps) throw new Error("NARC is not loaded: maps");

  const matrix = decodeRecord(project, "matrix", matrixId).raw;
  if (!matrix) throw new Error(`Matrix ${matrixId} could not be decoded`);

  const warnings: string[] = [];
  const cells = selectMatrixCells(matrixCells(matrix), options.headerId, options.headerIds);
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));

  const previewCells = cells.map((cell): Gen4StitchedMapCell => {
    const empty = cell.mapId === GEN4_MATRIX_EMPTY;
    let missing = false;
    let tiles: Gen4MapPermissionTile[] = [];

    if (empty) {
      warnings.push(`Matrix ${matrixId} cell ${cell.index} is empty.`);
    } else {
      try {
        const map = decodeRecord(project, "maps", cell.mapId).raw;
        if (!map) throw new Error(`Map ${cell.mapId} could not be decoded`);
        tiles = gen4MapTiles(map);
        if (Number(map.permissions_truncated ?? 0) !== 0) warnings.push(`Map ${cell.mapId} has a truncated permission grid.`);
      } catch {
        missing = true;
        warnings.push(`Matrix ${matrixId} cell ${cell.index} references missing map ${cell.mapId}.`);
      }
    }

    return {
      index: cell.index,
      matrixX: cell.matrixX,
      matrixY: cell.matrixY,
      x: cell.x - minX,
      y: cell.y - minY,
      width: GEN4_MAP_TILE_WIDTH,
      height: GEN4_MAP_TILE_HEIGHT,
      mapId: cell.mapId,
      headerId: cell.headerId,
      altitude: cell.altitude,
      tiles,
      empty,
      missing,
    };
  });

  return {
    matrixId,
    width: Math.max(...previewCells.map((cell) => cell.x + cell.width), 1),
    height: Math.max(...previewCells.map((cell) => cell.y + cell.height), 1),
    cellWidth: GEN4_MAP_TILE_WIDTH,
    cellHeight: GEN4_MAP_TILE_HEIGHT,
    cells: previewCells,
    warnings,
  };
}

function matrixCells(matrix: RawRecord): MatrixCell[] {
  const width = Number(matrix.width ?? 0);
  const height = Number(matrix.height ?? 0);
  const count = width * height;
  return Array.from({ length: count }, (_value, index) => {
    const matrixX = width > 0 ? index % width : 0;
    const matrixY = width > 0 ? Math.floor(index / width) : 0;
    return {
      index,
      matrixX,
      matrixY,
      x: matrixX * GEN4_MAP_TILE_WIDTH,
      y: matrixY * GEN4_MAP_TILE_HEIGHT,
      mapId: Number(matrix[`map_${index}`] ?? GEN4_MATRIX_EMPTY),
      headerId: matrix[`header_${index}`],
      altitude: Number(matrix[`altitude_${index}`] ?? 0),
    };
  });
}

function selectMatrixCells(cells: MatrixCell[], headerId?: number, headerIds?: number[]): MatrixCell[] {
  if (headerId === undefined) return cells.length > 0 ? cells : [emptyFallbackCell()];
  const headerValues = cells.map((cell) => cell.headerId).filter((value) => value !== undefined);
  if (headerValues.length === 0 || headerValues.every((value) => value === 0)) return cells.length > 0 ? cells : [emptyFallbackCell()];
  const headerIdSet = new Set(headerIds ?? []);
  if (headerIdSet.size > 0) {
    const grouped = cells.filter((cell) => cell.headerId !== undefined && headerIdSet.has(cell.headerId));
    if (grouped.length > 0) return grouped;
  }
  const matching = cells.filter((cell) => cell.headerId === headerId);
  return matching.length > 0 ? matching : cells;
}

function emptyFallbackCell(): MatrixCell {
  return {
    index: 0,
    matrixX: 0,
    matrixY: 0,
    x: 0,
    y: 0,
    mapId: GEN4_MATRIX_EMPTY,
    altitude: 0,
  };
}
