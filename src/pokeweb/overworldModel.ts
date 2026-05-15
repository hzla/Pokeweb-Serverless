import type { FieldSpec } from "./formats";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { parseHeaders, type HeaderRow } from "./headerModel";
import { decodeRecord, markDirty, type ProjectState, type RawRecord } from "./projectStore";
import spriteHash from "../assets/data/sprite_hash.json";

export const NULL_MAP_ID = 0xffffffff;

export const OVERWORLD_HEADER_FORMAT: FieldSpec[] = [
  [4, "file_length"],
  [1, "furniture_count"],
  [1, "npc_count"],
  [1, "warp_count"],
  [1, "trigger_count"],
];

export const OVERWORLD_GROUP_FORMATS = {
  furniture: [
    [2, "script_id"],
    [2, "unknown_1"],
    [2, "unknown_2"],
    [2, "unknown_3"],
    [2, "x_cord"],
    [2, "x_cord_padding"],
    [2, "y_cord"],
    [2, "y_cord_padding"],
    [4, "z_cord"],
  ],
  npc: [
    [2, "overworld_id"],
    [2, "overworld_sprite"],
    [2, "movement_permissions"],
    [2, "movement_permissions_2"],
    [2, "overworld_flag"],
    [2, "script_id"],
    [2, "direction"],
    [2, "sight"],
    [2, "unknown_1"],
    [2, "unknown_2"],
    [2, "horizontal_leash"],
    [2, "vertical_leash"],
    [2, "unknown_3"],
    [2, "unknown_4"],
    [2, "x_cord"],
    [2, "y_cord"],
    [2, "unknown_5"],
    [2, "z_cord"],
  ],
  warp: [
    [2, "map_id"],
    [2, "use_warp_cords"],
    [1, "contact_direction"],
    [1, "transition_type"],
    [4, "exit_x"],
    [4, "exit_y"],
    [2, "x_extension"],
    [2, "y_extension"],
    [2, "directionality"],
  ],
  trigger: [
    [2, "entity_id"],
    [2, "to_trigger_value"],
    [2, "to_check_value"],
    [2, "unknown_1"],
    [2, "unknown_2"],
    [2, "x_cord"],
    [2, "y_cord"],
    [2, "z_cord"],
    [2, "unknown_3"],
    [2, "unknown_4"],
    [2, "unknown_5"],
  ],
} as const satisfies Record<string, FieldSpec[]>;

export const NPC_FIELDS = OVERWORLD_GROUP_FORMATS.npc.map(([, field]) => field);

export type OverworldMapScene = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  layer2: number[];
  layer3: number[];
};

export type OverworldNpc = {
  index: number;
  overworldId: number;
  spriteId: number;
  spriteSlug: string;
  x: number;
  y: number;
  z: number;
  direction: number;
};

export type OverworldScene = {
  overworldId: number;
  headerRowId: number;
  header: HeaderRow;
  locationName: string;
  matrixId: number;
  width: number;
  height: number;
  maps: OverworldMapScene[];
  npcs: OverworldNpc[];
  raw: RawRecord;
};

type MatrixCell = {
  index: number;
  mapId: number;
  headerId: number | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
};

const spriteMap = spriteHash as Record<string, string>;

export function getOverworldScene(project: ProjectState, overworldId: number): OverworldScene {
  requireStore(project, "overworlds");
  requireStore(project, "matrix");
  requireStore(project, "maps");
  if (!project.headers) project.headers = parseHeaders(project);

  const found = findHeaderForOverworld(project, overworldId);
  if (!found) throw new Error(`No header references overworld ${overworldId}`);

  const matrixId = Number(found.header.matrix_id ?? 0);
  const matrix = decodeRecord(project, "matrix", matrixId).raw;
  if (!matrix) throw new Error(`Matrix ${matrixId} could not be decoded`);

  const cells = matrixCells(project, matrix);
  const matchingCells = selectSceneCells(cells, found.header.index);
  const minX = Math.min(...matchingCells.map((cell) => cell.x), 0);
  const minY = Math.min(...matchingCells.map((cell) => cell.y), 0);

  const maps = matchingCells
    .filter((cell) => cell.mapId !== NULL_MAP_ID)
    .map((cell) => {
      const raw = decodeRecord(project, "maps", cell.mapId).raw;
      if (!raw) throw new Error(`Map ${cell.mapId} could not be decoded`);
      const width = Number(raw.width ?? cell.width);
      const height = Number(raw.height ?? cell.height);
      const tileCount = width * height;
      return {
        id: cell.mapId,
        x: cell.x - minX,
        y: cell.y - minY,
        width,
        height,
        layer2: collectLayer(raw, 2, tileCount),
        layer3: collectLayer(raw, 3, tileCount),
      };
    });

  const width = Math.max(...matchingCells.map((cell) => cell.x - minX + cell.width), 1);
  const height = Math.max(...matchingCells.map((cell) => cell.y - minY + cell.height), 1);
  const overworld = decodeRecord(project, "overworlds", overworldId).raw;
  if (!overworld) throw new Error(`Overworld ${overworldId} could not be decoded`);

  return {
    overworldId,
    headerRowId: found.rowId,
    header: found.header,
    locationName: String(found.header.location_name ?? `Overworld ${overworldId}`),
    matrixId,
    width,
    height,
    maps,
    npcs: npcIndexes(overworld).map((index) => npcFromRaw(overworld, index, minX, minY)),
    raw: overworld,
  };
}

export function updateOverworldField(project: ProjectState, overworldId: number, field: string, value: string | number): number {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  const max = overworldFieldMax(field);
  if (max === undefined) throw new Error(`Unsupported overworld field: ${field}`);
  const before = record.raw[field] ?? 0;
  const next = coerceInt(value, 0, max, field);
  record.raw[field] = next;
  markDirty(project, "overworlds", overworldId);
  recordFieldChange(project, "overworlds", `Overworld ${overworldId}`, overworldFieldLabel(field), before, next, {
    key: `overworld:${overworldId}:${field}`,
  });
  return next;
}

export function moveOverworldNpc(project: ProjectState, overworldId: number, npcIndex: number, x: number, y: number, z?: number): void {
  updateOverworldField(project, overworldId, `npc_${npcIndex}_x_cord`, x);
  updateOverworldField(project, overworldId, `npc_${npcIndex}_y_cord`, y);
  if (z !== undefined) updateOverworldField(project, overworldId, `npc_${npcIndex}_z_cord`, z);
}

export function addOverworldNpc(project: ProjectState, overworldId: number): number {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  const indexes = npcIndexes(record.raw);
  const nextIndex = indexes.length === 0 ? 0 : Math.max(...indexes) + 1;
  const highestId = indexes.reduce((max, index) => Math.max(max, Number(record.raw?.[`npc_${index}_overworld_id`] ?? index)), -1);

  for (const field of NPC_FIELDS) record.raw[`npc_${nextIndex}_${field}`] = 0;
  record.raw[`npc_${nextIndex}_overworld_id`] = highestId + 1;
  record.raw[`npc_${nextIndex}_overworld_sprite`] = 1;

  const lastIndex = indexes.at(-1);
  if (lastIndex !== undefined) {
    record.raw[`npc_${nextIndex}_x_cord`] = Number(record.raw[`npc_${lastIndex}_x_cord`] ?? 0) + 1;
    record.raw[`npc_${nextIndex}_y_cord`] = Number(record.raw[`npc_${lastIndex}_y_cord`] ?? 0) + 1;
    record.raw[`npc_${nextIndex}_z_cord`] = Number(record.raw[`npc_${lastIndex}_z_cord`] ?? 0);
  }

  record.raw.npc_count = Number(record.raw.npc_count ?? 0) + 1;
  record.raw.file_length = Number(record.raw.file_length ?? 0) + groupByteLength("npc");
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `NPC ${nextIndex} added.`, `Overworld ${overworldId}`, {
    key: `overworld-npc-add:${overworldId}:${nextIndex}`,
  });
  return nextIndex;
}

export function deleteOverworldNpc(project: ProjectState, overworldId: number, npcIndex: number): void {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  if (!npcIndexes(record.raw).includes(npcIndex)) throw new Error(`NPC ${npcIndex} does not exist`);
  for (const field of NPC_FIELDS) delete record.raw[`npc_${npcIndex}_${field}`];
  record.raw.npc_count = Math.max(0, Number(record.raw.npc_count ?? 0) - 1);
  record.raw.file_length = Math.max(0, Number(record.raw.file_length ?? 0) - groupByteLength("npc"));
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `NPC ${npcIndex} removed.`, `Overworld ${overworldId}`, {
    key: `overworld-npc-delete:${overworldId}:${npcIndex}`,
  });
}

export function updateMapTile(project: ProjectState, mapId: number, tileIndex: number, layer: 2 | 3, value: string | number): number {
  const record = decodeRecord(project, "maps", mapId);
  if (!record.raw) throw new Error(`Map ${mapId} could not be decoded`);
  const tileCount = Number(record.raw.width ?? 0) * Number(record.raw.height ?? 0);
  if (tileIndex < 0 || tileIndex >= tileCount) throw new Error(`Tile ${tileIndex} is outside map ${mapId}`);
  const next = coerceInt(value, 0, 65535, `layer_${layer}`);
  const before = record.raw[`layer_${layer}_${tileIndex}`] ?? 0;
  record.raw[`layer_${layer}_${tileIndex}`] = next;
  markDirty(project, "maps", mapId);
  recordFieldChange(project, "maps", `Map ${mapId}`, `Layer ${layer} tile ${tileIndex}`, before, next, {
    key: `map-tile:${mapId}:${layer}:${tileIndex}`,
  });
  return next;
}

export function mapPermissionColor(permission: number): { color: string; label: string } {
  return (
    MAP_PERMISSION_COLORS[permission] ?? {
      color: "#44475a",
      label: "unknown",
    }
  );
}

export function spriteSlugForOverworldSprite(spriteId: number): string {
  return spriteMap[String(spriteId)] ?? String(spriteId);
}

export function groupByteLength(group: keyof typeof OVERWORLD_GROUP_FORMATS): number {
  return OVERWORLD_GROUP_FORMATS[group].reduce((sum, [size]) => sum + size, 0);
}

function requireStore(project: ProjectState, name: "overworlds" | "matrix" | "maps"): void {
  if (!project.narcs[name]) throw new Error(`NARC is not loaded: ${name}`);
}

function findHeaderForOverworld(project: ProjectState, overworldId: number): { rowId: number; header: HeaderRow } | undefined {
  const headers = project.headers;
  if (!headers) return undefined;
  for (let rowId = 1; rowId <= headers.count; rowId += 1) {
    const header = headers.rows[rowId];
    if (Number(header.overworlds_id ?? header.map_id) === overworldId) return { rowId, header };
  }
  return undefined;
}

function matrixCells(project: ProjectState, matrix: RawRecord): MatrixCell[] {
  const width = Number(matrix.width ?? 0);
  const count = width * Number(matrix.height ?? 0);
  const cells: MatrixCell[] = [];
  let x = 0;
  let y = 0;
  let lastHeight = 32;

  for (let index = 0; index < count; index += 1) {
    if (index % width === 0 && index > 0) {
      x = 0;
      y += lastHeight;
    }

    const mapId = Number(matrix[`map_${index}`] ?? NULL_MAP_ID);
    const dimensions = mapDimensions(project, mapId);
    cells.push({
      index,
      mapId,
      headerId: matrix[`header_${index}`],
      x,
      y,
      width: dimensions.width,
      height: dimensions.height,
    });
    x += dimensions.width;
    lastHeight = dimensions.height;
  }
  return cells;
}

function mapDimensions(project: ProjectState, mapId: number): { width: number; height: number } {
  if (mapId === NULL_MAP_ID) return { width: 32, height: 32 };
  try {
    const raw = decodeRecord(project, "maps", mapId).raw;
    return { width: Number(raw?.width ?? 32), height: Number(raw?.height ?? 32) };
  } catch {
    return { width: 32, height: 32 };
  }
}

function selectSceneCells(cells: MatrixCell[], headerId: number): MatrixCell[] {
  const headerValues = cells.map((cell) => cell.headerId).filter((value) => value !== undefined);
  if (headerValues.length === 0 || headerValues.every((value) => value === 0)) return cells;
  const matching = cells.filter((cell) => cell.headerId === headerId);
  return matching.length > 0 ? matching : cells;
}

function collectLayer(raw: RawRecord, layer: 2 | 3, count: number): number[] {
  return Array.from({ length: count }, (_value, index) => Number(raw[`layer_${layer}_${index}`] ?? 0));
}

function overworldFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}

function npcIndexes(raw: RawRecord): number[] {
  return Object.keys(raw)
    .map((key) => /^npc_(\d+)_overworld_id$/u.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function npcFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldNpc {
  const spriteId = Number(raw[`npc_${index}_overworld_sprite`] ?? 0);
  return {
    index,
    overworldId: Number(raw[`npc_${index}_overworld_id`] ?? index),
    spriteId,
    spriteSlug: spriteSlugForOverworldSprite(spriteId),
    x: Number(raw[`npc_${index}_x_cord`] ?? 0) - translateX,
    y: Number(raw[`npc_${index}_y_cord`] ?? 0) - translateY,
    z: Number(raw[`npc_${index}_z_cord`] ?? 0),
    direction: Number(raw[`npc_${index}_direction`] ?? 0),
  };
}

function overworldFieldMax(field: string): number | undefined {
  for (const [size, name] of OVERWORLD_HEADER_FORMAT) if (name === field) return maxForSize(size);
  const match = /^(furniture|npc|warp|trigger)_\d+_(.+)$/u.exec(field);
  if (!match) return undefined;
  const format = OVERWORLD_GROUP_FORMATS[match[1] as keyof typeof OVERWORLD_GROUP_FORMATS];
  const found = format.find(([, name]) => name === match[2]);
  return found ? maxForSize(found[0]) : undefined;
}

function maxForSize(size: number): number {
  return size === 4 ? 0xffffffff : 2 ** (size * 8) - 1;
}

function coerceInt(value: string | number, min: number, max: number, field: string): number {
  const text = String(value).trim();
  if (!/^\d+$/u.test(text)) throw new Error(`${field} must be an integer`);
  const next = Number(text);
  if (!Number.isSafeInteger(next) || next < min || next > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return next;
}

const MAP_PERMISSION_COLORS: Record<number, { color: string; label: string }> = {
  0: { color: "#ecf0f1", label: "passable" },
  1: { color: "#e74c3c", label: "unpassable" },
  2: { color: "#ecf0f1", label: "passable" },
  3: { color: "#ecf0f1", label: "passable road" },
  4: { color: "#2ecc71", label: "reg tall grass" },
  6: { color: "#00b894", label: "doubles grass" },
  10: { color: "#636e72", label: "cave encounter" },
  11: { color: "#ffeaa7", label: "sand" },
  12: { color: "#fdcb6e", label: "sand encounter" },
  18: { color: "#0984e3", label: "deep pond ledge" },
  20: { color: "#81ecec", label: "puddle" },
  28: { color: "#6ab04c", label: "swamp" },
  29: { color: "#2d3436", label: "boulder hole" },
  31: { color: "#55efc4", label: "short grass (no enc)" },
  34: { color: "#2ecc71", label: "dreamyard grass" },
  48: { color: "#ecf0f1", label: "passable chargestone interactable" },
  50: { color: "#ecf0f1", label: "passable chargestone interactable" },
  61: { color: "#74b9ff", label: "pond" },
  63: { color: "#0984e3", label: "surf" },
  65: { color: "#0984e3", label: "surf edge" },
  114: { color: "#cc8e35", label: "ledge right" },
  115: { color: "#cc8e35", label: "ledge left" },
  116: { color: "#cc8e35", label: "ledge up" },
  117: { color: "#cc8e35", label: "ledge down" },
  212: { color: "#e74c3c", label: "indoor unpassable" },
  219: { color: "#e74c3c", label: "indoor chair" },
  223: { color: "#e74c3c", label: "indoor unpassable" },
};
