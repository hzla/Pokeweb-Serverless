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
export const OVERWORLD_ENTITY_KINDS = ["npc", "furniture", "warp", "trigger"] as const;

export type OverworldEntityKind = (typeof OVERWORLD_ENTITY_KINDS)[number];
export type OverworldEntitySelection = { kind: OverworldEntityKind; index: number };

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
  kind: "npc";
  index: number;
  overworldId: number;
  spriteId: number;
  spriteSlug: string;
  x: number;
  y: number;
  z: number;
  direction: number;
};

export type OverworldFurniture = {
  kind: "furniture";
  index: number;
  script: number;
  condition: number;
  interactibility: number;
  isRail: boolean;
  x: number;
  y: number;
  altitude: number;
  railLineNo: number;
  railFrontPos: number;
  railSidePos: number;
  railUnused: number;
};

export type OverworldWarp = {
  kind: "warp";
  index: number;
  targetZone: number;
  targetWarpId: number;
  contactDirection: number;
  transitionType: number;
  isRail: boolean;
  x: number;
  y: number;
  altitude: number;
  width: number;
  height: number;
  unknown: number;
  railLineNo: number;
  railFrontPos: number;
  railSidePos: number;
};

export type OverworldTrigger = {
  kind: "trigger";
  index: number;
  script: number;
  variable: number;
  value: number;
  type: number;
  isRail: boolean;
  x: number;
  y: number;
  altitude: number;
  width: number;
  height: number;
  unknown: number;
  railLineNo: number;
  railFrontPos: number;
  railSidePos: number;
};

export type OverworldEntity = OverworldNpc | OverworldFurniture | OverworldWarp | OverworldTrigger;

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
  furniture: OverworldFurniture[];
  warps: OverworldWarp[];
  triggers: OverworldTrigger[];
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
    furniture: entityIndexes(overworld, "furniture").map((index) => furnitureFromRaw(overworld, index, minX, minY)),
    warps: entityIndexes(overworld, "warp").map((index) => warpFromRaw(overworld, index, minX, minY)),
    triggers: entityIndexes(overworld, "trigger").map((index) => triggerFromRaw(overworld, index, minX, minY)),
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
  return addOverworldEntity(project, overworldId, "npc");
}

export function deleteOverworldNpc(project: ProjectState, overworldId: number, npcIndex: number): void {
  deleteOverworldEntity(project, overworldId, "npc", npcIndex);
}

export function addOverworldEntity(project: ProjectState, overworldId: number, kind: OverworldEntityKind): number {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  const indexes = entityIndexes(record.raw, kind);
  const nextIndex = indexes.length === 0 ? 0 : Math.max(...indexes) + 1;

  for (const [, field] of OVERWORLD_GROUP_FORMATS[kind]) record.raw[`${kind}_${nextIndex}_${field}`] = 0;
  applyEntityDefaults(record.raw, kind, nextIndex, indexes);

  record.raw[`${kind}_count`] = Number(record.raw[`${kind}_count`] ?? 0) + 1;
  record.raw.file_length = Number(record.raw.file_length ?? 0) + groupByteLength(kind);
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `${entityKindLabel(kind)} ${nextIndex} added.`, `Overworld ${overworldId}`, {
    key: `overworld-${kind}-add:${overworldId}:${nextIndex}`,
  });
  return nextIndex;
}

export function deleteOverworldEntity(project: ProjectState, overworldId: number, kind: OverworldEntityKind, index: number): void {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  if (!entityIndexes(record.raw, kind).includes(index)) throw new Error(`${entityKindLabel(kind)} ${index} does not exist`);
  for (const [, field] of OVERWORLD_GROUP_FORMATS[kind]) delete record.raw[`${kind}_${index}_${field}`];
  record.raw[`${kind}_count`] = Math.max(0, Number(record.raw[`${kind}_count`] ?? 0) - 1);
  record.raw.file_length = Math.max(0, Number(record.raw.file_length ?? 0) - groupByteLength(kind));
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `${entityKindLabel(kind)} ${index} removed.`, `Overworld ${overworldId}`, {
    key: `overworld-${kind}-delete:${overworldId}:${index}`,
  });
}

export function moveOverworldEntity(project: ProjectState, overworldId: number, kind: OverworldEntityKind, index: number, x: number, y: number): void {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  if (!entityIndexes(record.raw, kind).includes(index)) throw new Error(`${entityKindLabel(kind)} ${index} does not exist`);
  if (kind === "npc") {
    moveOverworldNpc(project, overworldId, index, x, y);
    return;
  }
  if (kind === "furniture") {
    record.raw[`furniture_${index}_unknown_3`] = 0;
    setU32Pair(record.raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`, x);
    setU32Pair(record.raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`, y);
  } else if (kind === "warp") {
    setWarpRail(record.raw, index, false);
    setWarpGridX(record.raw, index, x);
    setWarpGridZ(record.raw, index, y);
  } else {
    record.raw[`trigger_${index}_unknown_2`] = 0;
    record.raw[`trigger_${index}_x_cord`] = x;
    record.raw[`trigger_${index}_y_cord`] = y;
  }
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `${entityKindLabel(kind)} ${index} moved.`, `Overworld ${overworldId}`, {
    key: `overworld-${kind}-move:${overworldId}:${index}`,
  });
}

export function updateOverworldEntityField(
  project: ProjectState,
  overworldId: number,
  selection: OverworldEntitySelection,
  field: string,
  value: string | number,
): number {
  const record = decodeRecord(project, "overworlds", overworldId);
  if (!record.raw) throw new Error(`Overworld ${overworldId} could not be decoded`);
  if (!entityIndexes(record.raw, selection.kind).includes(selection.index)) throw new Error(`${entityKindLabel(selection.kind)} ${selection.index} does not exist`);
  const next = coerceInt(value, 0, semanticFieldMax(selection.kind, field), field);
  const before = getSemanticEntityField(record.raw, selection.kind, selection.index, field);
  setSemanticEntityField(record.raw, selection.kind, selection.index, field, next);
  markDirty(project, "overworlds", overworldId);
  recordFieldChange(project, "overworlds", `Overworld ${overworldId}`, `${entityKindLabel(selection.kind)} ${selection.index} ${semanticFieldLabel(field)}`, before, next, {
    key: `overworld:${overworldId}:${selection.kind}:${selection.index}:${field}`,
  });
  return next;
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
  return entityIndexes(raw, "npc");
}

function entityIndexes(raw: RawRecord, kind: OverworldEntityKind): number[] {
  const firstField = OVERWORLD_GROUP_FORMATS[kind][0][1];
  const pattern = new RegExp(`^${kind}_(\\d+)_${firstField}$`, "u");
  return Object.keys(raw)
    .map((key) => pattern.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function npcFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldNpc {
  const spriteId = Number(raw[`npc_${index}_overworld_sprite`] ?? 0);
  return {
    kind: "npc",
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

function furnitureFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldFurniture {
  const x = u32Pair(raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`);
  const y = u32Pair(raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`);
  return {
    kind: "furniture",
    index,
    script: Number(raw[`furniture_${index}_script_id`] ?? 0),
    condition: Number(raw[`furniture_${index}_unknown_1`] ?? 0),
    interactibility: Number(raw[`furniture_${index}_unknown_2`] ?? 0),
    isRail: Number(raw[`furniture_${index}_unknown_3`] ?? 0) !== 0,
    x: x - translateX,
    y: y - translateY,
    altitude: Number(raw[`furniture_${index}_z_cord`] ?? 0),
    railLineNo: Number(raw[`furniture_${index}_x_cord`] ?? 0),
    railFrontPos: Number(raw[`furniture_${index}_x_cord_padding`] ?? 0),
    railSidePos: Number(raw[`furniture_${index}_y_cord`] ?? 0),
    railUnused: Number(raw[`furniture_${index}_y_cord_padding`] ?? 0),
  };
}

function warpFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldWarp {
  const exitX = Number(raw[`warp_${index}_exit_x`] ?? 0);
  const exitY = Number(raw[`warp_${index}_exit_y`] ?? 0);
  const isRail = low16(exitX) === 1;
  const worldX = signed16(high16(exitX));
  const worldY = signed16(low16(exitY));
  const worldZ = signed16(high16(exitY));
  return {
    kind: "warp",
    index,
    targetZone: Number(raw[`warp_${index}_map_id`] ?? 0),
    targetWarpId: Number(raw[`warp_${index}_use_warp_cords`] ?? 0),
    contactDirection: Number(raw[`warp_${index}_contact_direction`] ?? 0),
    transitionType: Number(raw[`warp_${index}_transition_type`] ?? 0),
    isRail,
    x: Math.floor(worldX / 16) - translateX,
    y: Math.floor(worldZ / 16) - translateY,
    altitude: worldY,
    width: Math.max(1, Number(raw[`warp_${index}_x_extension`] ?? 1)),
    height: Math.max(1, Number(raw[`warp_${index}_y_extension`] ?? 1)),
    unknown: Number(raw[`warp_${index}_directionality`] ?? 0),
    railLineNo: high16(exitX),
    railFrontPos: low16(exitY),
    railSidePos: high16(exitY),
  };
}

function triggerFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldTrigger {
  const isRail = Number(raw[`trigger_${index}_unknown_2`] ?? 0) !== 0;
  return {
    kind: "trigger",
    index,
    script: Number(raw[`trigger_${index}_entity_id`] ?? 0),
    variable: Number(raw[`trigger_${index}_to_check_value`] ?? 0),
    value: Number(raw[`trigger_${index}_to_trigger_value`] ?? 0),
    type: Number(raw[`trigger_${index}_unknown_1`] ?? 0),
    isRail,
    x: Number(raw[`trigger_${index}_x_cord`] ?? 0) - translateX,
    y: Number(raw[`trigger_${index}_y_cord`] ?? 0) - translateY,
    altitude: isRail ? 0 : Number(raw[`trigger_${index}_unknown_4`] ?? 0),
    width: Math.max(1, Number(raw[`trigger_${index}_${isRail ? "unknown_3" : "z_cord"}`] ?? 1)),
    height: Math.max(1, Number(raw[`trigger_${index}_${isRail ? "unknown_4" : "unknown_3"}`] ?? 1)),
    unknown: Number(raw[`trigger_${index}_unknown_5`] ?? 0),
    railLineNo: Number(raw[`trigger_${index}_x_cord`] ?? 0),
    railFrontPos: Number(raw[`trigger_${index}_y_cord`] ?? 0),
    railSidePos: Number(raw[`trigger_${index}_z_cord`] ?? 0),
  };
}

function applyEntityDefaults(raw: RawRecord, kind: OverworldEntityKind, index: number, existingIndexes: number[]): void {
  if (kind === "npc") {
    const highestId = existingIndexes.reduce((max, existing) => Math.max(max, Number(raw[`npc_${existing}_overworld_id`] ?? existing)), -1);
    raw[`npc_${index}_overworld_id`] = highestId + 1;
    raw[`npc_${index}_overworld_sprite`] = 1;
    const lastIndex = existingIndexes.at(-1);
    if (lastIndex !== undefined) {
      raw[`npc_${index}_x_cord`] = Number(raw[`npc_${lastIndex}_x_cord`] ?? 0) + 1;
      raw[`npc_${index}_y_cord`] = Number(raw[`npc_${lastIndex}_y_cord`] ?? 0) + 1;
      raw[`npc_${index}_z_cord`] = Number(raw[`npc_${lastIndex}_z_cord`] ?? 0);
    }
    return;
  }
  if (kind === "warp") {
    raw[`warp_${index}_contact_direction`] = 2;
    raw[`warp_${index}_transition_type`] = 3;
    raw[`warp_${index}_x_extension`] = 1;
    raw[`warp_${index}_y_extension`] = 1;
    setWarpRail(raw, index, false);
    setWarpGridX(raw, index, 0);
    setWarpGridZ(raw, index, 0);
    return;
  }
  if (kind === "trigger") {
    raw[`trigger_${index}_unknown_2`] = 0;
    raw[`trigger_${index}_z_cord`] = 2;
    raw[`trigger_${index}_unknown_3`] = 1;
  }
}

function getSemanticEntityField(raw: RawRecord, kind: OverworldEntityKind, index: number, field: string): number {
  if (kind === "npc") return Number(raw[`npc_${index}_${field}`] ?? 0);
  if (kind === "furniture") {
    if (field === "script") return Number(raw[`furniture_${index}_script_id`] ?? 0);
    if (field === "condition") return Number(raw[`furniture_${index}_unknown_1`] ?? 0);
    if (field === "interactibility") return Number(raw[`furniture_${index}_unknown_2`] ?? 0);
    if (field === "isRail") return Number(raw[`furniture_${index}_unknown_3`] ?? 0);
    if (field === "gridX") return u32Pair(raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`);
    if (field === "gridZ") return u32Pair(raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`);
    if (field === "railLineNo") return Number(raw[`furniture_${index}_x_cord`] ?? 0);
    if (field === "railFrontPos") return Number(raw[`furniture_${index}_x_cord_padding`] ?? 0);
    if (field === "railSidePos") return Number(raw[`furniture_${index}_y_cord`] ?? 0);
    if (field === "railUnused") return Number(raw[`furniture_${index}_y_cord_padding`] ?? 0);
    if (field === "altitude") return Number(raw[`furniture_${index}_z_cord`] ?? 0);
  }
  if (kind === "warp") {
    const exitX = Number(raw[`warp_${index}_exit_x`] ?? 0);
    const exitY = Number(raw[`warp_${index}_exit_y`] ?? 0);
    if (field === "targetZone") return Number(raw[`warp_${index}_map_id`] ?? 0);
    if (field === "targetWarpId") return Number(raw[`warp_${index}_use_warp_cords`] ?? 0);
    if (field === "contactDirection") return Number(raw[`warp_${index}_contact_direction`] ?? 0);
    if (field === "transitionType") return Number(raw[`warp_${index}_transition_type`] ?? 0);
    if (field === "isRail") return low16(exitX);
    if (field === "gridX") return Math.floor(signed16(high16(exitX)) / 16);
    if (field === "worldY") return signed16(low16(exitY));
    if (field === "gridZ") return Math.floor(signed16(high16(exitY)) / 16);
    if (field === "railLineNo") return high16(exitX);
    if (field === "railFrontPos") return low16(exitY);
    if (field === "railSidePos") return high16(exitY);
    if (field === "width") return Number(raw[`warp_${index}_x_extension`] ?? 0);
    if (field === "height") return Number(raw[`warp_${index}_y_extension`] ?? 0);
    if (field === "unknown") return Number(raw[`warp_${index}_directionality`] ?? 0);
  }
  if (kind === "trigger") {
    const isRail = Number(raw[`trigger_${index}_unknown_2`] ?? 0) !== 0;
    if (field === "script") return Number(raw[`trigger_${index}_entity_id`] ?? 0);
    if (field === "value") return Number(raw[`trigger_${index}_to_trigger_value`] ?? 0);
    if (field === "variable") return Number(raw[`trigger_${index}_to_check_value`] ?? 0);
    if (field === "type") return Number(raw[`trigger_${index}_unknown_1`] ?? 0);
    if (field === "isRail") return Number(raw[`trigger_${index}_unknown_2`] ?? 0);
    if (field === "gridX" || field === "railLineNo") return Number(raw[`trigger_${index}_x_cord`] ?? 0);
    if (field === "gridZ" || field === "railFrontPos") return Number(raw[`trigger_${index}_y_cord`] ?? 0);
    if (field === "railSidePos") return Number(raw[`trigger_${index}_z_cord`] ?? 0);
    if (field === "width") return Number(raw[`trigger_${index}_${isRail ? "unknown_3" : "z_cord"}`] ?? 0);
    if (field === "height") return Number(raw[`trigger_${index}_${isRail ? "unknown_4" : "unknown_3"}`] ?? 0);
    if (field === "worldY") return Number(raw[`trigger_${index}_unknown_4`] ?? 0);
    if (field === "unknown") return Number(raw[`trigger_${index}_unknown_5`] ?? 0);
  }
  throw new Error(`Unsupported ${kind} field: ${field}`);
}

function setSemanticEntityField(raw: RawRecord, kind: OverworldEntityKind, index: number, field: string, value: number): void {
  if (kind === "npc") {
    raw[`npc_${index}_${field}`] = value;
    return;
  }
  if (kind === "furniture") {
    if (field === "script") raw[`furniture_${index}_script_id`] = value;
    else if (field === "condition") raw[`furniture_${index}_unknown_1`] = value;
    else if (field === "interactibility") raw[`furniture_${index}_unknown_2`] = value;
    else if (field === "isRail") raw[`furniture_${index}_unknown_3`] = value;
    else if (field === "gridX") setU32Pair(raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`, value);
    else if (field === "gridZ") setU32Pair(raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`, value);
    else if (field === "railLineNo") raw[`furniture_${index}_x_cord`] = value;
    else if (field === "railFrontPos") raw[`furniture_${index}_x_cord_padding`] = value;
    else if (field === "railSidePos") raw[`furniture_${index}_y_cord`] = value;
    else if (field === "railUnused") raw[`furniture_${index}_y_cord_padding`] = value;
    else if (field === "altitude") raw[`furniture_${index}_z_cord`] = value;
    else throw new Error(`Unsupported furniture field: ${field}`);
    return;
  }
  if (kind === "warp") {
    if (field === "targetZone") raw[`warp_${index}_map_id`] = value;
    else if (field === "targetWarpId") raw[`warp_${index}_use_warp_cords`] = value;
    else if (field === "contactDirection") raw[`warp_${index}_contact_direction`] = value;
    else if (field === "transitionType") raw[`warp_${index}_transition_type`] = value;
    else if (field === "isRail") setWarpRail(raw, index, value !== 0);
    else if (field === "gridX") setWarpGridX(raw, index, value);
    else if (field === "worldY") setWarpWorldY(raw, index, value);
    else if (field === "gridZ") setWarpGridZ(raw, index, value);
    else if (field === "railLineNo") setPackedHigh(raw, `warp_${index}_exit_x`, value);
    else if (field === "railFrontPos") setPackedLow(raw, `warp_${index}_exit_y`, value);
    else if (field === "railSidePos") setPackedHigh(raw, `warp_${index}_exit_y`, value);
    else if (field === "width") raw[`warp_${index}_x_extension`] = value;
    else if (field === "height") raw[`warp_${index}_y_extension`] = value;
    else if (field === "unknown") raw[`warp_${index}_directionality`] = value;
    else throw new Error(`Unsupported warp field: ${field}`);
    return;
  }
  if (kind === "trigger") {
    const isRail = Number(raw[`trigger_${index}_unknown_2`] ?? 0) !== 0;
    if (field === "script") raw[`trigger_${index}_entity_id`] = value;
    else if (field === "value") raw[`trigger_${index}_to_trigger_value`] = value;
    else if (field === "variable") raw[`trigger_${index}_to_check_value`] = value;
    else if (field === "type") raw[`trigger_${index}_unknown_1`] = value;
    else if (field === "isRail") raw[`trigger_${index}_unknown_2`] = value;
    else if (field === "gridX" || field === "railLineNo") raw[`trigger_${index}_x_cord`] = value;
    else if (field === "gridZ" || field === "railFrontPos") raw[`trigger_${index}_y_cord`] = value;
    else if (field === "railSidePos") raw[`trigger_${index}_z_cord`] = value;
    else if (field === "width") raw[`trigger_${index}_${isRail ? "unknown_3" : "z_cord"}`] = value;
    else if (field === "height") raw[`trigger_${index}_${isRail ? "unknown_4" : "unknown_3"}`] = value;
    else if (field === "worldY") raw[`trigger_${index}_unknown_4`] = value;
    else if (field === "unknown") raw[`trigger_${index}_unknown_5`] = value;
    else throw new Error(`Unsupported trigger field: ${field}`);
  }
}

function semanticFieldMax(kind: OverworldEntityKind, field: string): number {
  if (field === "isRail") return 1;
  if (kind === "npc") {
    const spec = OVERWORLD_GROUP_FORMATS.npc.find(([, name]) => name === field);
    return spec ? maxForSize(spec[0]) : 0xffff;
  }
  if (kind === "furniture" && (field === "gridX" || field === "gridZ" || field === "altitude")) return 0xffffffff;
  if (kind === "warp" && (field === "contactDirection" || field === "transitionType")) return 0xff;
  if (kind === "warp" && (field === "gridX" || field === "gridZ" || field === "worldY")) return 0xffff;
  return 0xffff;
}

function semanticFieldLabel(field: string): string {
  return field.replace(/[A-Z]/gu, (match) => ` ${match.toLowerCase()}`).replace(/_/gu, " ");
}

function entityKindLabel(kind: OverworldEntityKind): string {
  return kind === "npc" ? "NPC" : kind[0]!.toUpperCase() + kind.slice(1);
}

function u32Pair(raw: RawRecord, lowField: string, highField: string): number {
  return Number(raw[lowField] ?? 0) + Number(raw[highField] ?? 0) * 0x10000;
}

function setU32Pair(raw: RawRecord, lowField: string, highField: string, value: number): void {
  raw[lowField] = low16(value);
  raw[highField] = high16(value);
}

function low16(value: number): number {
  return Number(value) & 0xffff;
}

function high16(value: number): number {
  return (Number(value) >>> 16) & 0xffff;
}

function signed16(value: number): number {
  const next = low16(value);
  return next >= 0x8000 ? next - 0x10000 : next;
}

function pack16(low: number, high: number): number {
  return low16(low) + low16(high) * 0x10000;
}

function setPackedLow(raw: RawRecord, field: string, value: number): void {
  raw[field] = pack16(value, high16(Number(raw[field] ?? 0)));
}

function setPackedHigh(raw: RawRecord, field: string, value: number): void {
  raw[field] = pack16(low16(Number(raw[field] ?? 0)), value);
}

function setWarpRail(raw: RawRecord, index: number, isRail: boolean): void {
  setPackedLow(raw, `warp_${index}_exit_x`, isRail ? 1 : 0);
}

function setWarpGridX(raw: RawRecord, index: number, tileX: number): void {
  setPackedHigh(raw, `warp_${index}_exit_x`, tileToCenteredWorld(tileX));
}

function setWarpWorldY(raw: RawRecord, index: number, worldY: number): void {
  setPackedLow(raw, `warp_${index}_exit_y`, worldY);
}

function setWarpGridZ(raw: RawRecord, index: number, tileY: number): void {
  setPackedHigh(raw, `warp_${index}_exit_y`, tileToCenteredWorld(tileY));
}

function tileToCenteredWorld(tile: number): number {
  return tile * 16 + 8;
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
