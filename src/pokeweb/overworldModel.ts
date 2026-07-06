import type { FieldSpec } from "./formats";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { isGen4Project } from "./constants";
import { GEN4_EVENT_GROUP_FORMATS, type Gen4EventGroup } from "./gen4EventModel";
import { defaultGen4OverworldTableEntry } from "./gen4OverworldSpriteModel";
import { clampU16 } from "./gen5PermissionModel";
import { buildGen4MapPreview } from "./gen4MapPreviewModel";
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
  permissionFormat?: "gen4" | "gen5";
  empty?: boolean;
  missing?: boolean;
};

export type MapPermissionTileEdit = {
  mapId: number;
  tileIndex: number;
  tileClass: number;
  flags: number;
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
  translateX: number;
  translateY: number;
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

type SceneMapData = {
  maps: OverworldMapScene[];
  width: number;
  height: number;
  translateX: number;
  translateY: number;
};

type SceneTranslation = Pick<SceneMapData, "translateX" | "translateY">;

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

  const sceneMapData = isGen4Project(project) ? gen4SceneMaps(project, matrixId, found.header.index) : gen5SceneMaps(project, matrix, found.header, found.rowId);
  const { maps, width, height } = sceneMapData;
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
    translateX: sceneMapData.translateX,
    translateY: sceneMapData.translateY,
    maps,
    npcs: isGen4Project(project)
      ? gen4EntityIndexes(overworld, "overworld").map((index) => gen4NpcFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY))
      : npcIndexes(overworld).map((index) => npcFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY)),
    furniture: isGen4Project(project)
      ? gen4EntityIndexes(overworld, "spawnable").map((index) => gen4SpawnableFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY))
      : entityIndexes(overworld, "furniture").map((index) => furnitureFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY)),
    warps: isGen4Project(project)
      ? gen4EntityIndexes(overworld, "warp").map((index) => gen4WarpFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY))
      : entityIndexes(overworld, "warp").map((index) => warpFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY)),
    triggers: isGen4Project(project)
      ? gen4EntityIndexes(overworld, "trigger").map((index) => gen4TriggerFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY))
      : entityIndexes(overworld, "trigger").map((index) => triggerFromRaw(overworld, index, sceneMapData.translateX, sceneMapData.translateY)),
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
  const translation = isGen4Project(project) ? { translateX: 0, translateY: 0 } : gen5SceneTranslation(project, overworldId);
  updateOverworldField(project, overworldId, `npc_${npcIndex}_x_cord`, x + translation.translateX);
  updateOverworldField(project, overworldId, `npc_${npcIndex}_y_cord`, y + translation.translateY);
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
  if (isGen4Project(project)) return addGen4EventEntity(project, record.raw, overworldId, kind);
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
  if (isGen4Project(project)) {
    deleteGen4EventEntity(project, record.raw, overworldId, kind, index);
    return;
  }
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
  if (isGen4Project(project)) {
    moveGen4EventEntity(project, record.raw, overworldId, kind, index, x, y);
    return;
  }
  if (!entityIndexes(record.raw, kind).includes(index)) throw new Error(`${entityKindLabel(kind)} ${index} does not exist`);
  if (kind === "npc") {
    moveOverworldNpc(project, overworldId, index, x, y);
    return;
  }
  const translation = gen5SceneTranslation(project, overworldId);
  const rawX = x + translation.translateX;
  const rawY = y + translation.translateY;
  if (kind === "furniture") {
    record.raw[`furniture_${index}_unknown_3`] = 0;
    setU32Pair(record.raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`, rawX);
    setU32Pair(record.raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`, rawY);
  } else if (kind === "warp") {
    setWarpRail(record.raw, index, false);
    setWarpGridX(record.raw, index, rawX);
    setWarpGridZ(record.raw, index, rawY);
  } else {
    record.raw[`trigger_${index}_unknown_2`] = 0;
    record.raw[`trigger_${index}_x_cord`] = rawX;
    record.raw[`trigger_${index}_y_cord`] = rawY;
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
  if (isGen4Project(project)) return updateGen4EventEntityField(project, record.raw, overworldId, selection, field, value);
  if (!entityIndexes(record.raw, selection.kind).includes(selection.index)) throw new Error(`${entityKindLabel(selection.kind)} ${selection.index} does not exist`);
  const next = coerceInt(value, 0, semanticFieldMax(selection.kind, field), field);
  const translation = gen5SceneTranslation(project, overworldId);
  const before = getSemanticEntityField(record.raw, selection.kind, selection.index, field, translation);
  setSemanticEntityField(record.raw, selection.kind, selection.index, field, next, translation);
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
  const isGen4 = isGen4Project(project);
  const field = isGen4 ? `${layer === 2 ? "type" : "collision"}_${tileIndex}` : `layer_${layer}_${tileIndex}`;
  const next = coerceInt(value, 0, isGen4 ? 255 : 65535, field);
  const before = record.raw[field] ?? 0;
  record.raw[field] = next;
  if (isGen4 && layer === 3) record.raw[`blocked_${tileIndex}`] = (next & 0x80) !== 0 ? 1 : 0;
  markDirty(project, "maps", mapId);
  recordFieldChange(project, "maps", `Map ${mapId}`, `${isGen4 ? (layer === 2 ? "Type" : "Collision") : `Layer ${layer}`} tile ${tileIndex}`, before, next, {
    key: `map-tile:${mapId}:${layer}:${tileIndex}`,
  });
  return next;
}

export function updateMapPermissionTiles(project: ProjectState, edits: MapPermissionTileEdit[]): number {
  if (isGen4Project(project)) throw new Error("Batch permission painting is only supported for Gen 5 maps");
  const records = new Map<number, { record: ReturnType<typeof decodeRecord>; tileCount: number }>();
  const touchedMaps = new Set<number>();
  let changedCount = 0;
  let firstMap = 0;
  let firstTile = 0;

  for (const edit of edits) {
    let entry = records.get(edit.mapId);
    if (!entry) {
      const record = decodeRecord(project, "maps", edit.mapId);
      if (!record.raw) throw new Error(`Map ${edit.mapId} could not be decoded`);
      entry = {
        record,
        tileCount: Number(record.raw.width ?? 0) * Number(record.raw.height ?? 0),
      };
      records.set(edit.mapId, entry);
    }
    if (edit.tileIndex < 0 || edit.tileIndex >= entry.tileCount) throw new Error(`Tile ${edit.tileIndex} is outside map ${edit.mapId}`);

    const tileClass = clampU16(edit.tileClass);
    const flags = clampU16(edit.flags);
    const classField = `layer_2_${edit.tileIndex}`;
    const flagsField = `layer_3_${edit.tileIndex}`;
    const beforeClass = Number(entry.record.raw?.[classField] ?? 0);
    const beforeFlags = Number(entry.record.raw?.[flagsField] ?? 0);
    if (beforeClass === tileClass && beforeFlags === flags) continue;

    if (changedCount === 0) {
      firstMap = edit.mapId;
      firstTile = edit.tileIndex;
    }
    entry.record.raw![classField] = tileClass;
    entry.record.raw![flagsField] = flags;
    touchedMaps.add(edit.mapId);
    changedCount += 1;
  }

  if (changedCount === 0) return 0;
  for (const mapId of touchedMaps) markDirty(project, "maps", mapId);
  recordGenericChange(
    project,
    "maps",
    `${changedCount} permission tile${changedCount === 1 ? "" : "s"} painted across ${touchedMaps.size} map${touchedMaps.size === 1 ? "" : "s"}.`,
    "Map permissions",
    {
      key: `map-permission-paint:${project.actionChangelog?.entries.length ?? 0}:${firstMap}:${firstTile}:${changedCount}`,
    },
  );
  return changedCount;
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
    if (Number(header.overworlds_id ?? header.map_id) === overworldId) {
      const index = Number(header.index);
      return { rowId, header: Number.isFinite(index) ? header : { ...header, index: rowId - 1 } };
    }
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

    const mapId = Number(matrixEntry(matrix, "map", index) ?? NULL_MAP_ID);
    const dimensions = mapDimensions(project, mapId);
    cells.push({
      index,
      mapId,
      headerId: matrixEntry(matrix, "header", index),
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

function matrixEntry(matrix: RawRecord, field: "map" | "header", index: number): number | undefined {
  const direct = matrix[`${field}_${index}`];
  if (direct !== undefined) return Number(direct);
  const raw = matrix as unknown as Record<string, unknown>;
  const array = raw[field === "map" ? "maps" : "headers"];
  if (!Array.isArray(array)) return undefined;
  const value = array[index];
  return value === undefined ? undefined : Number(value);
}

function gen4SceneMaps(project: ProjectState, matrixId: number, headerId: number): SceneMapData {
  const preview = buildGen4MapPreview(project, matrixId, { headerId });
  const firstCell = preview.cells[0];
  const translateX = firstCell ? firstCell.matrixX * 32 - firstCell.x : 0;
  const translateY = firstCell ? firstCell.matrixY * 32 - firstCell.y : 0;
  return {
    width: preview.width,
    height: preview.height,
    translateX,
    translateY,
    maps: preview.cells.map((cell) => ({
      id: cell.mapId,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      layer2: cell.tiles.length > 0 ? cell.tiles.map((tile) => tile.type) : Array.from({ length: cell.width * cell.height }, () => 0),
      layer3: cell.tiles.length > 0 ? cell.tiles.map((tile) => tile.collision) : Array.from({ length: cell.width * cell.height }, () => 0),
      permissionFormat: "gen4",
      empty: cell.empty,
      missing: cell.missing,
    })),
  };
}

function gen5SceneMaps(project: ProjectState, matrix: RawRecord, header: HeaderRow, rowId: number): SceneMapData {
  const cells = matrixCells(project, matrix);
  const matchingCells = selectSceneCells(cells, header, rowId);
  const minX = matchingCells.length > 0 ? Math.min(...matchingCells.map((cell) => cell.x)) : 0;
  const minY = matchingCells.length > 0 ? Math.min(...matchingCells.map((cell) => cell.y)) : 0;
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
        permissionFormat: "gen5" as const,
      };
    });

  return {
    maps,
    width: Math.max(...matchingCells.map((cell) => cell.x - minX + cell.width), 1),
    height: Math.max(...matchingCells.map((cell) => cell.y - minY + cell.height), 1),
    translateX: minX,
    translateY: minY,
  };
}

function gen5SceneTranslation(project: ProjectState, overworldId: number): SceneTranslation {
  requireStore(project, "matrix");
  requireStore(project, "maps");
  if (!project.headers) project.headers = parseHeaders(project);
  const found = findHeaderForOverworld(project, overworldId);
  if (!found) return { translateX: 0, translateY: 0 };
  const matrixId = Number(found.header.matrix_id ?? 0);
  const matrix = decodeRecord(project, "matrix", matrixId).raw;
  if (!matrix) return { translateX: 0, translateY: 0 };
  const sceneMapData = gen5SceneMaps(project, matrix, found.header, found.rowId);
  return { translateX: sceneMapData.translateX, translateY: sceneMapData.translateY };
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

function selectSceneCells(cells: MatrixCell[], header: HeaderRow, rowId: number): MatrixCell[] {
  const headerValues = cells.map((cell) => Number(cell.headerId)).filter((value) => Number.isFinite(value) && value !== NULL_MAP_ID);
  const flySelection = selectSceneCellsByFlyPosition(cells, header);
  if (headerValues.length === 0 || headerValues.every((value) => value === 0)) return flySelection ?? cells;

  for (const candidate of sceneHeaderCandidates(header, rowId)) {
    const matching = cells.filter((cell) => Number(cell.headerId) === candidate);
    if (matching.length > 0) return matching;
  }

  return flySelection ?? cells;
}

function sceneHeaderCandidates(header: HeaderRow, rowId: number): number[] {
  const candidates = [header.index, rowId - 1, rowId, header.parent_map_id]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value !== NULL_MAP_ID);
  return [...new Set(candidates)];
}

function selectSceneCellsByFlyPosition(cells: MatrixCell[], header: HeaderRow): MatrixCell[] | undefined {
  const flyX = Number(header.fly_x);
  const flyY = Number(header.fly_z);
  if (!Number.isFinite(flyX) || !Number.isFinite(flyY) || (flyX < 32 && flyY < 32)) return undefined;
  const cell = cells.find((entry) => entry.mapId !== NULL_MAP_ID && flyX >= entry.x && flyY >= entry.y && flyX < entry.x + entry.width && flyY < entry.y + entry.height);
  if (!cell) return undefined;
  const headerId = Number(cell.headerId);
  if (Number.isFinite(headerId) && headerId !== NULL_MAP_ID) {
    const matching = cells.filter((entry) => Number(entry.headerId) === headerId);
    if (matching.length > 0) return matching;
  }
  return [cell];
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

function gen4NpcFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldNpc {
  const spriteId = Number(raw[`overworld_${index}_overlay_table_entry`] ?? 0);
  return {
    kind: "npc",
    index,
    overworldId: Number(raw[`overworld_${index}_ow_id`] ?? index),
    spriteId,
    spriteSlug: spriteSlugForOverworldSprite(spriteId),
    x: gen4Coord(raw, "overworld", index, "x") - translateX,
    y: gen4Coord(raw, "overworld", index, "y") - translateY,
    z: Number(raw[`overworld_${index}_z_position`] ?? 0),
    direction: Number(raw[`overworld_${index}_orientation`] ?? 0),
  };
}

function gen4SpawnableFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldFurniture {
  return {
    kind: "furniture",
    index,
    script: Number(raw[`spawnable_${index}_script_number`] ?? 0),
    condition: Number(raw[`spawnable_${index}_type`] ?? 0),
    interactibility: 0,
    isRail: false,
    x: gen4Coord(raw, "spawnable", index, "x") - translateX,
    y: gen4Coord(raw, "spawnable", index, "y") - translateY,
    altitude: Number(raw[`spawnable_${index}_z_position`] ?? 0),
    railLineNo: 0,
    railFrontPos: 0,
    railSidePos: 0,
    railUnused: 0,
  };
}

function gen4WarpFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldWarp {
  return {
    kind: "warp",
    index,
    targetZone: Number(raw[`warp_${index}_header`] ?? 0),
    targetWarpId: Number(raw[`warp_${index}_anchor`] ?? 0),
    contactDirection: 0,
    transitionType: 0,
    isRail: false,
    x: gen4Coord(raw, "warp", index, "x") - translateX,
    y: gen4Coord(raw, "warp", index, "y") - translateY,
    altitude: Number(raw[`warp_${index}_height`] ?? 0),
    width: 1,
    height: 1,
    unknown: 0,
    railLineNo: 0,
    railFrontPos: 0,
    railSidePos: 0,
  };
}

function gen4TriggerFromRaw(raw: RawRecord, index: number, translateX: number, translateY: number): OverworldTrigger {
  return {
    kind: "trigger",
    index,
    script: Number(raw[`trigger_${index}_script_number`] ?? 0),
    variable: Number(raw[`trigger_${index}_variable_watched`] ?? 0),
    value: Number(raw[`trigger_${index}_expected_var_value`] ?? 0),
    type: 0,
    isRail: false,
    x: gen4Coord(raw, "trigger", index, "x") - translateX,
    y: gen4Coord(raw, "trigger", index, "y") - translateY,
    altitude: Number(raw[`trigger_${index}_z_position`] ?? 0),
    width: Math.max(1, Number(raw[`trigger_${index}_width_x`] ?? 1)),
    height: Math.max(1, Number(raw[`trigger_${index}_height_y`] ?? 1)),
    unknown: 0,
    railLineNo: 0,
    railFrontPos: 0,
    railSidePos: 0,
  };
}

function addGen4EventEntity(project: ProjectState, raw: RawRecord, overworldId: number, kind: OverworldEntityKind): number {
  const group = gen4GroupForKind(kind);
  const indexes = gen4EntityIndexes(raw, group);
  const nextIndex = indexes.length === 0 ? 0 : Math.max(...indexes) + 1;
  for (const [, field] of GEN4_EVENT_GROUP_FORMATS[group]) raw[`${group}_${nextIndex}_${field}`] = 0;
  applyGen4EntityDefaults(project, raw, group, nextIndex, indexes);
  raw[`${group}_count`] = Number(raw[`${group}_count`] ?? 0) + 1;
  raw.footer_length ??= 0;
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `${entityKindLabel(kind)} ${nextIndex} added.`, `Overworld ${overworldId}`, {
    key: `overworld-${kind}-add:${overworldId}:${nextIndex}`,
  });
  return nextIndex;
}

function deleteGen4EventEntity(project: ProjectState, raw: RawRecord, overworldId: number, kind: OverworldEntityKind, index: number): void {
  const group = gen4GroupForKind(kind);
  if (!gen4EntityIndexes(raw, group).includes(index)) throw new Error(`${entityKindLabel(kind)} ${index} does not exist`);
  for (const [, field] of GEN4_EVENT_GROUP_FORMATS[group]) delete raw[`${group}_${index}_${field}`];
  for (const axis of ["x", "y"] as const) {
    delete raw[`${group}_${index}_${axis}_map_position`];
    delete raw[`${group}_${index}_${axis}_matrix_position`];
  }
  raw[`${group}_count`] = Math.max(0, Number(raw[`${group}_count`] ?? 0) - 1);
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `${entityKindLabel(kind)} ${index} removed.`, `Overworld ${overworldId}`, {
    key: `overworld-${kind}-delete:${overworldId}:${index}`,
  });
}

function moveGen4EventEntity(project: ProjectState, raw: RawRecord, overworldId: number, kind: OverworldEntityKind, index: number, x: number, y: number): void {
  const group = gen4GroupForKind(kind);
  if (!gen4EntityIndexes(raw, group).includes(index)) throw new Error(`${entityKindLabel(kind)} ${index} does not exist`);
  setGen4Coord(raw, group, index, "x", x);
  setGen4Coord(raw, group, index, "y", y);
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `${entityKindLabel(kind)} ${index} moved.`, `Overworld ${overworldId}`, {
    key: `overworld-${kind}-move:${overworldId}:${index}`,
  });
}

function updateGen4EventEntityField(
  project: ProjectState,
  raw: RawRecord,
  overworldId: number,
  selection: OverworldEntitySelection,
  field: string,
  value: string | number,
): number {
  const group = gen4GroupForKind(selection.kind);
  if (!gen4EntityIndexes(raw, group).includes(selection.index)) throw new Error(`${entityKindLabel(selection.kind)} ${selection.index} does not exist`);
  const next = coerceInt(value, 0, gen4SemanticFieldMax(selection.kind, field), field);
  const before = getGen4SemanticEntityField(raw, selection.kind, selection.index, field);
  setGen4SemanticEntityField(raw, selection.kind, selection.index, field, next);
  markDirty(project, "overworlds", overworldId);
  recordFieldChange(project, "overworlds", `Overworld ${overworldId}`, `${entityKindLabel(selection.kind)} ${selection.index} ${semanticFieldLabel(field)}`, before, next, {
    key: `overworld:${overworldId}:${selection.kind}:${selection.index}:${field}`,
  });
  return next;
}

function applyGen4EntityDefaults(project: ProjectState, raw: RawRecord, group: Gen4EventGroup, index: number, existingIndexes: number[]): void {
  if (group === "overworld") {
    const highestId = existingIndexes.reduce((max, existing) => Math.max(max, Number(raw[`overworld_${existing}_ow_id`] ?? existing)), -1);
    const lastIndex = existingIndexes.at(-1);
    raw[`overworld_${index}_ow_id`] = highestId + 1;
    raw[`overworld_${index}_overlay_table_entry`] =
      lastIndex === undefined ? defaultGen4OverworldTableEntry() : Number(raw[`overworld_${lastIndex}_overlay_table_entry`] ?? defaultGen4OverworldTableEntry());
    raw[`overworld_${index}_movement`] = lastIndex === undefined ? 0 : Number(raw[`overworld_${lastIndex}_movement`] ?? 0);
    raw[`overworld_${index}_type`] = lastIndex === undefined ? 0 : Number(raw[`overworld_${lastIndex}_type`] ?? 0);
    raw[`overworld_${index}_orientation`] = lastIndex === undefined ? 1 : Number(raw[`overworld_${lastIndex}_orientation`] ?? 1);
    raw[`overworld_${index}_sight_range`] = lastIndex === undefined ? 0 : Number(raw[`overworld_${lastIndex}_sight_range`] ?? 0);
    if (lastIndex !== undefined) {
      setGen4Coord(raw, group, index, "x", gen4Coord(raw, group, lastIndex, "x") + 1);
      setGen4Coord(raw, group, index, "y", gen4Coord(raw, group, lastIndex, "y") + 1);
      raw[`overworld_${index}_z_position`] = Number(raw[`overworld_${lastIndex}_z_position`] ?? 0);
    } else {
      setGen4Coord(raw, group, index, "x", 16);
      setGen4Coord(raw, group, index, "y", 16);
      raw[`overworld_${index}_z_position`] = 0;
    }
    return;
  }
  if (group === "warp") {
    raw[`warp_${index}_anchor`] = 0;
    raw[`warp_${index}_height`] = 0;
    return;
  }
  if (group === "trigger") {
    raw[`trigger_${index}_width_x`] = 1;
    raw[`trigger_${index}_height_y`] = 1;
  }
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

function getSemanticEntityField(raw: RawRecord, kind: OverworldEntityKind, index: number, field: string, translation: SceneTranslation): number {
  if (kind === "npc") {
    if (field === "x_cord") return Number(raw[`npc_${index}_${field}`] ?? 0) - translation.translateX;
    if (field === "y_cord") return Number(raw[`npc_${index}_${field}`] ?? 0) - translation.translateY;
    return Number(raw[`npc_${index}_${field}`] ?? 0);
  }
  if (kind === "furniture") {
    if (field === "script") return Number(raw[`furniture_${index}_script_id`] ?? 0);
    if (field === "condition") return Number(raw[`furniture_${index}_unknown_1`] ?? 0);
    if (field === "interactibility") return Number(raw[`furniture_${index}_unknown_2`] ?? 0);
    if (field === "isRail") return Number(raw[`furniture_${index}_unknown_3`] ?? 0);
    if (field === "gridX") return u32Pair(raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`) - translation.translateX;
    if (field === "gridZ") return u32Pair(raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`) - translation.translateY;
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
    if (field === "gridX") return Math.floor(signed16(high16(exitX)) / 16) - translation.translateX;
    if (field === "worldY") return signed16(low16(exitY));
    if (field === "gridZ") return Math.floor(signed16(high16(exitY)) / 16) - translation.translateY;
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
    if (field === "gridX") return Number(raw[`trigger_${index}_x_cord`] ?? 0) - translation.translateX;
    if (field === "gridZ") return Number(raw[`trigger_${index}_y_cord`] ?? 0) - translation.translateY;
    if (field === "railLineNo") return Number(raw[`trigger_${index}_x_cord`] ?? 0);
    if (field === "railFrontPos") return Number(raw[`trigger_${index}_y_cord`] ?? 0);
    if (field === "railSidePos") return Number(raw[`trigger_${index}_z_cord`] ?? 0);
    if (field === "width") return Number(raw[`trigger_${index}_${isRail ? "unknown_3" : "z_cord"}`] ?? 0);
    if (field === "height") return Number(raw[`trigger_${index}_${isRail ? "unknown_4" : "unknown_3"}`] ?? 0);
    if (field === "worldY") return Number(raw[`trigger_${index}_unknown_4`] ?? 0);
    if (field === "unknown") return Number(raw[`trigger_${index}_unknown_5`] ?? 0);
  }
  throw new Error(`Unsupported ${kind} field: ${field}`);
}

function setSemanticEntityField(raw: RawRecord, kind: OverworldEntityKind, index: number, field: string, value: number, translation: SceneTranslation): void {
  if (kind === "npc") {
    raw[`npc_${index}_${field}`] = field === "x_cord" ? value + translation.translateX : field === "y_cord" ? value + translation.translateY : value;
    return;
  }
  if (kind === "furniture") {
    if (field === "script") raw[`furniture_${index}_script_id`] = value;
    else if (field === "condition") raw[`furniture_${index}_unknown_1`] = value;
    else if (field === "interactibility") raw[`furniture_${index}_unknown_2`] = value;
    else if (field === "isRail") raw[`furniture_${index}_unknown_3`] = value;
    else if (field === "gridX") setU32Pair(raw, `furniture_${index}_x_cord`, `furniture_${index}_x_cord_padding`, value + translation.translateX);
    else if (field === "gridZ") setU32Pair(raw, `furniture_${index}_y_cord`, `furniture_${index}_y_cord_padding`, value + translation.translateY);
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
    else if (field === "gridX") setWarpGridX(raw, index, value + translation.translateX);
    else if (field === "worldY") setWarpWorldY(raw, index, value);
    else if (field === "gridZ") setWarpGridZ(raw, index, value + translation.translateY);
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
    else if (field === "gridX") raw[`trigger_${index}_x_cord`] = value + translation.translateX;
    else if (field === "gridZ") raw[`trigger_${index}_y_cord`] = value + translation.translateY;
    else if (field === "railLineNo") raw[`trigger_${index}_x_cord`] = value;
    else if (field === "railFrontPos") raw[`trigger_${index}_y_cord`] = value;
    else if (field === "railSidePos") raw[`trigger_${index}_z_cord`] = value;
    else if (field === "width") raw[`trigger_${index}_${isRail ? "unknown_3" : "z_cord"}`] = value;
    else if (field === "height") raw[`trigger_${index}_${isRail ? "unknown_4" : "unknown_3"}`] = value;
    else if (field === "worldY") raw[`trigger_${index}_unknown_4`] = value;
    else if (field === "unknown") raw[`trigger_${index}_unknown_5`] = value;
    else throw new Error(`Unsupported trigger field: ${field}`);
  }
}

function getGen4SemanticEntityField(raw: RawRecord, kind: OverworldEntityKind, index: number, field: string): number {
  if (kind === "npc") {
    if (field === "overworld_id") return Number(raw[`overworld_${index}_ow_id`] ?? 0);
    if (field === "overworld_sprite") return Number(raw[`overworld_${index}_overlay_table_entry`] ?? 0);
    if (field === "movement_permissions") return Number(raw[`overworld_${index}_movement`] ?? 0);
    if (field === "overworld_flag") return Number(raw[`overworld_${index}_flag`] ?? 0);
    if (field === "script_id") return Number(raw[`overworld_${index}_script_number`] ?? 0);
    if (field === "direction") return Number(raw[`overworld_${index}_orientation`] ?? 0);
    if (field === "sight") return Number(raw[`overworld_${index}_sight_range`] ?? 0);
    if (field === "horizontal_leash") return Number(raw[`overworld_${index}_x_range`] ?? 0);
    if (field === "vertical_leash") return Number(raw[`overworld_${index}_y_range`] ?? 0);
    if (field === "x_cord") return gen4Coord(raw, "overworld", index, "x");
    if (field === "y_cord") return gen4Coord(raw, "overworld", index, "y");
    if (field === "z_cord") return Number(raw[`overworld_${index}_z_position`] ?? 0);
    return Number(raw[`overworld_${index}_${field}`] ?? 0);
  }
  if (kind === "furniture") {
    if (field === "script") return Number(raw[`spawnable_${index}_script_number`] ?? 0);
    if (field === "condition") return Number(raw[`spawnable_${index}_type`] ?? 0);
    if (field === "gridX") return gen4Coord(raw, "spawnable", index, "x");
    if (field === "gridZ") return gen4Coord(raw, "spawnable", index, "y");
    if (field === "altitude") return Number(raw[`spawnable_${index}_z_position`] ?? 0);
    return 0;
  }
  if (kind === "warp") {
    if (field === "targetZone") return Number(raw[`warp_${index}_header`] ?? 0);
    if (field === "targetWarpId") return Number(raw[`warp_${index}_anchor`] ?? 0);
    if (field === "gridX") return gen4Coord(raw, "warp", index, "x");
    if (field === "gridZ") return gen4Coord(raw, "warp", index, "y");
    if (field === "worldY") return Number(raw[`warp_${index}_height`] ?? 0);
    if (field === "width" || field === "height") return 1;
    return 0;
  }
  if (field === "script") return Number(raw[`trigger_${index}_script_number`] ?? 0);
  if (field === "variable") return Number(raw[`trigger_${index}_variable_watched`] ?? 0);
  if (field === "value") return Number(raw[`trigger_${index}_expected_var_value`] ?? 0);
  if (field === "gridX") return gen4Coord(raw, "trigger", index, "x");
  if (field === "gridZ") return gen4Coord(raw, "trigger", index, "y");
  if (field === "width") return Number(raw[`trigger_${index}_width_x`] ?? 0);
  if (field === "height") return Number(raw[`trigger_${index}_height_y`] ?? 0);
  if (field === "worldY") return Number(raw[`trigger_${index}_z_position`] ?? 0);
  return 0;
}

function setGen4SemanticEntityField(raw: RawRecord, kind: OverworldEntityKind, index: number, field: string, value: number): void {
  if (kind === "npc") {
    if (field === "overworld_id") raw[`overworld_${index}_ow_id`] = value;
    else if (field === "overworld_sprite") raw[`overworld_${index}_overlay_table_entry`] = value;
    else if (field === "movement_permissions") raw[`overworld_${index}_movement`] = value;
    else if (field === "overworld_flag") raw[`overworld_${index}_flag`] = value;
    else if (field === "script_id") raw[`overworld_${index}_script_number`] = value;
    else if (field === "direction") raw[`overworld_${index}_orientation`] = value;
    else if (field === "sight") raw[`overworld_${index}_sight_range`] = value;
    else if (field === "horizontal_leash") raw[`overworld_${index}_x_range`] = value;
    else if (field === "vertical_leash") raw[`overworld_${index}_y_range`] = value;
    else if (field === "x_cord") setGen4Coord(raw, "overworld", index, "x", value);
    else if (field === "y_cord") setGen4Coord(raw, "overworld", index, "y", value);
    else if (field === "z_cord") raw[`overworld_${index}_z_position`] = value;
    else raw[`overworld_${index}_${field}`] = value;
    return;
  }
  if (kind === "furniture") {
    if (field === "script") raw[`spawnable_${index}_script_number`] = value;
    else if (field === "condition") raw[`spawnable_${index}_type`] = value;
    else if (field === "gridX") setGen4Coord(raw, "spawnable", index, "x", value);
    else if (field === "gridZ") setGen4Coord(raw, "spawnable", index, "y", value);
    else if (field === "altitude") raw[`spawnable_${index}_z_position`] = value;
    return;
  }
  if (kind === "warp") {
    if (field === "targetZone") raw[`warp_${index}_header`] = value;
    else if (field === "targetWarpId") raw[`warp_${index}_anchor`] = value;
    else if (field === "gridX") setGen4Coord(raw, "warp", index, "x", value);
    else if (field === "gridZ") setGen4Coord(raw, "warp", index, "y", value);
    else if (field === "worldY") raw[`warp_${index}_height`] = value;
    return;
  }
  if (field === "script") raw[`trigger_${index}_script_number`] = value;
  else if (field === "variable") raw[`trigger_${index}_variable_watched`] = value;
  else if (field === "value") raw[`trigger_${index}_expected_var_value`] = value;
  else if (field === "gridX") setGen4Coord(raw, "trigger", index, "x", value);
  else if (field === "gridZ") setGen4Coord(raw, "trigger", index, "y", value);
  else if (field === "width") raw[`trigger_${index}_width_x`] = value;
  else if (field === "height") raw[`trigger_${index}_height_y`] = value;
  else if (field === "worldY") raw[`trigger_${index}_z_position`] = value;
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

function gen4SemanticFieldMax(kind: OverworldEntityKind, field: string): number {
  if (field === "isRail") return 1;
  if (kind === "npc") {
    if (field === "x_cord" || field === "y_cord") return 0xffff;
    const mapped = gen4NpcFieldName(field);
    const spec = GEN4_EVENT_GROUP_FORMATS.overworld.find(([, name]) => name === mapped);
    return spec ? maxForSize(spec[0]) : 0xffff;
  }
  if (field === "gridX" || field === "gridZ") return 0xffff;
  if (kind === "warp" && field === "worldY") return 0xffffffff;
  return 0xffff;
}

const SEMANTIC_FIELD_LABELS: Record<string, string> = {
  movement_permissions: "move code",
  movement_permissions_2: "movement modifier",
  sight: "sight range",
  unknown_1: "modifier step count",
  unknown_2: "modifier parameter 2",
};

function semanticFieldLabel(field: string): string {
  return SEMANTIC_FIELD_LABELS[field] ?? field.replace(/[A-Z]/gu, (match) => ` ${match.toLowerCase()}`).replace(/_/gu, " ");
}

function entityKindLabel(kind: OverworldEntityKind): string {
  return kind === "npc" ? "NPC" : kind[0]!.toUpperCase() + kind.slice(1);
}

function gen4EntityIndexes(raw: RawRecord, group: Gen4EventGroup): number[] {
  const firstField = GEN4_EVENT_GROUP_FORMATS[group][0][1];
  const pattern = new RegExp(`^${group}_(\\d+)_${firstField}$`, "u");
  return Object.keys(raw)
    .map((key) => pattern.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function gen4GroupForKind(kind: OverworldEntityKind): Gen4EventGroup {
  if (kind === "npc") return "overworld";
  if (kind === "furniture") return "spawnable";
  return kind;
}

function gen4NpcFieldName(field: string): string {
  return (
    {
      overworld_id: "ow_id",
      overworld_sprite: "overlay_table_entry",
      movement_permissions: "movement",
      overworld_flag: "flag",
      script_id: "script_number",
      direction: "orientation",
      sight: "sight_range",
      horizontal_leash: "x_range",
      vertical_leash: "y_range",
      x_cord: "x_position",
      y_cord: "y_position",
      z_cord: "z_position",
    } as Record<string, string>
  )[field] ?? field;
}

function gen4Coord(raw: RawRecord, group: Gen4EventGroup, index: number, axis: "x" | "y"): number {
  const map = raw[`${group}_${index}_${axis}_map_position`];
  const matrix = raw[`${group}_${index}_${axis}_matrix_position`];
  if (map !== undefined || matrix !== undefined) return Number(map ?? 0) + Number(matrix ?? 0) * 32;
  return Number(raw[`${group}_${index}_${axis}_position`] ?? 0);
}

function setGen4Coord(raw: RawRecord, group: Gen4EventGroup, index: number, axis: "x" | "y", value: number): void {
  const next = Math.max(0, Math.trunc(value));
  raw[`${group}_${index}_${axis}_map_position`] = next % 32;
  raw[`${group}_${index}_${axis}_matrix_position`] = Math.trunc(next / 32);
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
