import { readAscii, readU16 } from "../nds/binary";
import { isGen4Project } from "./constants";
import { extractGen4MapModelBytes, GEN4_MAP_TILE_HEIGHT, GEN4_MAP_TILE_WIDTH, parseGen4MapBuildings, type Gen4MapBuilding, type Gen4MapPermissionTile } from "./gen4MapModel";
import { buildGen4MapPreview } from "./gen4MapPreviewModel";
import { parseHeaders, type HeaderRow } from "./headerModel";
import {
  buildModelPrimitives,
  readNitroResources,
  type Map3dBounds,
  type Map3dBuildingDiagnostic,
  type Map3dEntityOverlay,
  type Map3dPermissionEdit,
  type Map3dPrimitive,
  type Map3dSceneData,
  type NitroResources,
} from "./map3dModel";
import { decodeRecord, markDirty, type ProjectState, type RawRecord } from "./projectStore";
import { ensureGen4NarcStores } from "./gen4ResourceLoader";
import { recordGenericChange } from "./actionChangelog";
import type { Gen4StitchedMapCell } from "./gen4MapPreviewModel";
import { ensureGen4OverworldSpriteResources, gen4SpecialOverworldIconName, getGen4OverworldSpriteImage } from "./gen4OverworldSpriteModel";
import { publicAsset } from "../assetUrl";

const GEN4_MAP_WORLD_UNITS_PER_TILE = 16;
const GEN4_MAP_CHUNK_SPAN = GEN4_MAP_TILE_WIDTH * GEN4_MAP_WORLD_UNITS_PER_TILE;
const GEN4_MATRIX_ALTITUDE_UNIT = 8;
const GEN4_HGSS_INDOOR_AREA_TYPE = 0;
const GEN4_PERMISSION_FALLBACK_Y = -4;
const GEN4_EVENT_OVERLAY_LIFT_Y = 8;
const GEN4_TOP_LEFT_OBJECT_NUDGE_X = 5 * GEN4_MAP_WORLD_UNITS_PER_TILE;
const GEN4_TOP_LEFT_OBJECT_NUDGE_Z = -3 * GEN4_MAP_WORLD_UNITS_PER_TILE;

export type Gen4AreaData = {
  buildingTileset: number;
  mapTileset: number;
  dynamicTextureType?: number;
  unknown1?: number;
  areaType?: number;
  lightType: number;
};

type Gen4AreaRenderResources = {
  areaData: Gen4AreaData;
  mapTextures?: NitroResources;
  buildingTextures?: NitroResources;
  interiorBuildings: boolean;
};

type ColMat4 = number[];
type Gen4CellPlacementOffset = { x: number; z: number };

export async function ensureGen4Map3dResources(project: ProjectState): Promise<void> {
  await ensureGen4NarcStores(project, [
    "area_data",
    "map_textures",
    "building_textures",
    "exterior_building_models",
    "overworlds",
    ...(project.session.baseRom === "HGSS" ? (["interior_building_models"] as const) : []),
  ]);
  await ensureGen4OverworldSpriteResources(project);
}

export function buildGen4Map3dScene(
  project: ProjectState,
  matrixId: number,
  options: { headerId?: number; label?: string; locationGroup?: boolean } = {},
): Map3dSceneData {
  if (!isGen4Project(project)) throw new Error("Gen 4 map rendering requires a Gen 4 project");
  const groupHeaderIds = options.locationGroup && options.headerId !== undefined ? gen4LocationGroupHeaderIds(project, matrixId, options.headerId) : undefined;
  const preview = buildGen4MapPreview(project, matrixId, { headerId: options.headerId, headerIds: groupHeaderIds });
  const warnings = [...preview.warnings];
  if (groupHeaderIds && groupHeaderIds.length > 1) warnings.push(`Location group render includes ${groupHeaderIds.length} headers from matrix ${matrixId}.`);
  const chunks: Map3dSceneData["chunks"] = [];
  const buildings: Map3dSceneData["buildings"] = [];
  const buildingDiagnostics: Map3dBuildingDiagnostic[] = [];
  let buildingPlacementCount = 0;
  const areaResourcesByAreaDataId = new Map<number, Gen4AreaRenderResources | undefined>();

  for (const cell of preview.cells) {
    if (cell.empty || cell.missing) continue;
    const mapBytes = project.narcs.maps?.rawFiles[cell.mapId];
    if (!mapBytes) {
      warnings.push(`Map ${cell.mapId} is missing`);
      continue;
    }
    const fallbackPrimitive = buildPermissionFallbackPrimitive(cell.tiles);
    let primitives: Map3dPrimitive[] = [fallbackPrimitive];
    const worldX = cell.x * GEN4_MAP_WORLD_UNITS_PER_TILE + GEN4_MAP_CHUNK_SPAN / 2;
    const worldY = cell.altitude * GEN4_MATRIX_ALTITUDE_UNIT;
    const worldZ = cell.y * GEN4_MAP_WORLD_UNITS_PER_TILE + GEN4_MAP_CHUNK_SPAN / 2;
    const areaDataId = areaDataIdForCell(project, cell.headerId, options.headerId);
    const areaResources = areaDataId === undefined ? undefined : renderResourcesForAreaData(project, areaDataId, areaResourcesByAreaDataId, warnings);
    const buildingPlacements = parseGen4MapBuildings(mapBytes, project.session.baseRom);
    buildingPlacementCount += buildingPlacements.length;
    const modelBytes = extractGen4MapModelBytes(mapBytes, project.session.baseRom);
    try {
      if (!modelBytes || modelBytes.length === 0) {
        warnings.push(`Map ${cell.mapId} has no terrain model section; showing permission-grid fallback.`);
      } else if (readAscii(modelBytes, 0, 4) !== "BMD0") {
        warnings.push(`Map ${cell.mapId} terrain model has unsupported stamp ${readAscii(modelBytes, 0, 4)}; showing permission-grid fallback.`);
      } else {
        const modelResources = readNitroResources(modelBytes);
        const modelPrimitives = buildModelPrimitives(areaResources?.mapTextures ? combineResources(modelResources, areaResources.mapTextures) : modelResources, warnings, {
          recoverSkippedPieces: true,
        });
        if (modelPrimitives.length === 0) warnings.push(`Map ${cell.mapId} terrain model produced no primitives; showing permission-grid fallback.`);
        else primitives = modelPrimitives;
      }
    } catch (error) {
      warnings.push(`Map ${cell.mapId}: ${error instanceof Error ? error.message : String(error)}; showing permission-grid fallback.`);
    }
    const placementOffset = gen4ObjectPlacementOffsetForTerrain(boundsForPrimitives(primitives));
    buildings.push(
      ...buildGen4MapBuildings(project, cell.mapId, buildingPlacements, worldX + placementOffset.x, worldY, worldZ + placementOffset.z, areaResources, warnings, buildingDiagnostics),
    );

    chunks.push({
      chunkId: cell.mapId,
      sourceChunkId: cell.mapId,
      matrixX: cell.x / GEN4_MAP_TILE_WIDTH,
      matrixY: cell.y / GEN4_MAP_TILE_HEIGHT,
      worldX,
      worldY,
      worldZ,
      primitives,
      permissions: {
        chunkId: cell.mapId,
        width: GEN4_MAP_TILE_WIDTH,
        height: GEN4_MAP_TILE_HEIGHT,
        tiles: cell.tiles.map((tile) => ({
          tileClass: tile.type,
          flags: tile.collision,
          heightType: 0,
          slope: 0,
          height: 0,
        })),
      },
    });
  }
  const entities = buildGen4EventOverlays(project, preview.cells, options.headerId, warnings);

  return {
    zoneId: options.headerId ?? matrixId,
    label: options.label ?? `Matrix ${matrixId}`,
    season: "spring",
    matrixId,
    sourceMatrixId: matrixId,
    areaId: 0,
    sourceAreaId: 0,
    textureId: 0,
    buildingsId: 0,
    areaMetadata: { buildingsId: 0, texturesId: 0, srtAnimeIdx: 0, patAnimeIdx: 0, isExterior: true },
    seasonal: false,
    chunkSpan: GEN4_MAP_CHUNK_SPAN,
    chunkCount: chunks.length,
    textureCount:
      chunks.reduce((sum, chunk) => sum + chunk.primitives.filter((primitive) => primitive.material.texture).length, 0) +
      buildings.reduce((sum, building) => sum + building.primitives.filter((primitive) => primitive.material.texture).length, 0),
    buildingCount: buildings.length,
    buildingPlacementCount,
    entityCount: entities.length,
    npcModelCount: 0,
    permissionTileCount: chunks.reduce((sum, chunk) => sum + (chunk.permissions?.tiles.length ?? 0), 0),
    chunks,
    buildings,
    buildingDiagnostics,
    entities,
    npcModels: [],
    warnings,
  };
}

export function saveGen4Map3dPermissionEdits(project: ProjectState, edits: Map3dPermissionEdit[]): void {
  if (!isGen4Project(project) || edits.length === 0) return;
  const byMap = new Map<number, Map3dPermissionEdit[]>();
  for (const edit of edits) {
    const bucket = byMap.get(edit.chunkId) ?? [];
    bucket.push(edit);
    byMap.set(edit.chunkId, bucket);
  }
  for (const [mapId, mapEdits] of byMap) {
    const record = decodeRecord(project, "maps", mapId);
    if (!record.raw) throw new Error(`Map ${mapId} could not be decoded`);
    for (const edit of mapEdits) {
      if (edit.tileX < 0 || edit.tileY < 0 || edit.tileX >= GEN4_MAP_TILE_WIDTH || edit.tileY >= GEN4_MAP_TILE_HEIGHT) {
        throw new Error(`Tile ${edit.tileX}, ${edit.tileY} is outside map ${mapId}`);
      }
      const tileIndex = edit.tileY * GEN4_MAP_TILE_WIDTH + edit.tileX;
      record.raw[`type_${tileIndex}`] = clampByte(edit.tileClass);
      record.raw[`collision_${tileIndex}`] = clampByte(edit.flags);
      record.raw[`blocked_${tileIndex}`] = (clampByte(edit.flags) & 0x80) !== 0 ? 1 : 0;
    }
    markDirty(project, "maps", mapId);
    recordGenericChange(project, "maps3d", `${mapEdits.length} Gen 4 permission tile${mapEdits.length === 1 ? "" : "s"} changed in map ${mapId}.`, `Gen 4 map ${mapId}`, {
      key: `gen4-map3d-permissions:${mapId}`,
    });
  }
}

function buildPermissionFallbackPrimitive(tiles: Gen4MapPermissionTile[]): Map3dPrimitive {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const half = GEN4_MAP_CHUNK_SPAN / 2;
  for (const tile of tiles) {
    const base = positions.length / 3;
    const x0 = -half + tile.x * GEN4_MAP_WORLD_UNITS_PER_TILE;
    const x1 = x0 + GEN4_MAP_WORLD_UNITS_PER_TILE;
    const z0 = -half + tile.y * GEN4_MAP_WORLD_UNITS_PER_TILE;
    const z1 = z0 + GEN4_MAP_WORLD_UNITS_PER_TILE;
    positions.push(x0, GEN4_PERMISSION_FALLBACK_Y, z0, x1, GEN4_PERMISSION_FALLBACK_Y, z0, x1, GEN4_PERMISSION_FALLBACK_Y, z1, x0, GEN4_PERMISSION_FALLBACK_Y, z1);
    const color = gen4PermissionColor(tile);
    for (let vertex = 0; vertex < 4; vertex += 1) colors.push(color[0], color[1], color[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    material: { name: "gen4_permission_fallback", diffuse: [1, 1, 1], alpha: 0.82 },
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}

function gen4PermissionColor(tile: Gen4MapPermissionTile): [number, number, number] {
  if (tile.blocked) return rgb(0x34, 0x39, 0x46);
  if (isWaterLikeGen4Permission(tile.type)) return rgb(0x3d, 0xa5, 0xff);
  if (isGrassLikeGen4Permission(tile.type)) return rgb(0x42, 0xd6, 0x6b);
  if (isSandLikeGen4Permission(tile.type)) return rgb(0xd8, 0xb3, 0x5a);
  if (isLedgeLikeGen4Permission(tile.type)) return rgb(0xd3, 0x8b, 0x4f);
  if ((tile.collision & 0x40) !== 0) return rgb(0xa7, 0x8b, 0xfa);
  if ((tile.collision & 0x20) !== 0) return rgb(0xff, 0xcf, 0x66);
  if (tile.type === 0 && tile.collision === 0) return rgb(0x7b, 0xd8, 0x8f);
  return hslToRgb(((tile.type * 47 + tile.collision * 13) % 360) / 360, (54 + (tile.collision % 22)) / 100, (46 + (tile.type % 12)) / 100);
}

function rgb(r: number, g: number, b: number): [number, number, number] {
  return [r / 255, g / 255, b / 255];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
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

export function parseGen4AreaData(bytes: Uint8Array, baseRom = "Pt"): Gen4AreaData {
  if (bytes.length < 8) throw new Error("Gen 4 area data is too small");
  const buildingTileset = readU16(bytes, 0);
  const mapTileset = readU16(bytes, 2);
  if (baseRom === "HGSS") {
    return {
      buildingTileset,
      mapTileset,
      dynamicTextureType: readU16(bytes, 4),
      areaType: bytes[6] ?? 0,
      lightType: bytes[7] ?? 0,
    };
  }
  return {
    buildingTileset,
    mapTileset,
    unknown1: readU16(bytes, 4),
    lightType: readU16(bytes, 6),
  };
}

export function resolveGen4AreaDataIdForMapCell(project: ProjectState, cellHeaderId?: number, fallbackHeaderId?: number): number | undefined {
  const headerId = cellHeaderId ?? fallbackHeaderId;
  if (headerId === undefined) return undefined;
  try {
    if (!project.headers) project.headers = parseHeaders(project);
  } catch {
    return undefined;
  }
  const row = Object.values(project.headers.rows).find((candidate) => Number(candidate.index) === headerId) ?? project.headers.rows[headerId + 1];
  const areaDataId = Number(row?.area_data_id ?? row?.texture_id);
  return Number.isFinite(areaDataId) ? areaDataId : undefined;
}

function areaDataIdForCell(project: ProjectState, cellHeaderId?: number, fallbackHeaderId?: number): number | undefined {
  return resolveGen4AreaDataIdForMapCell(project, cellHeaderId, fallbackHeaderId);
}

function gen4LocationGroupHeaderIds(project: ProjectState, matrixId: number, headerId: number): number[] {
  try {
    if (!project.headers) project.headers = parseHeaders(project);
  } catch {
    return [headerId];
  }
  const headers = Object.values(project.headers.rows);
  const target = findGen4HeaderRow(headers, headerId);
  if (!target) return [headerId];
  const targetLocationId = Number(target.location_name_id ?? target.place_name_id);
  const targetLocationName = String(target.location_name ?? "");
  const targetAreaDataId = Number(target.area_data_id ?? target.texture_id);
  const ids = headers
    .filter((row) => Number(row.matrix_id) === matrixId)
    .filter((row) => {
      const rowAreaDataId = Number(row.area_data_id ?? row.texture_id);
      if (!Number.isFinite(targetAreaDataId) || !Number.isFinite(rowAreaDataId)) return true;
      return rowAreaDataId === targetAreaDataId;
    })
    .filter((row) => {
      const rowLocationId = Number(row.location_name_id ?? row.place_name_id);
      if (Number.isFinite(targetLocationId) && Number.isFinite(rowLocationId)) return rowLocationId === targetLocationId;
      return targetLocationName !== "" && String(row.location_name ?? "") === targetLocationName;
    })
    .map((row) => Number(row.index))
    .filter((index) => Number.isSafeInteger(index));
  return [...new Set(ids.length > 0 ? ids : [headerId])];
}

function findGen4HeaderRow(rows: HeaderRow[], headerId: number): HeaderRow | undefined {
  return rows.find((row) => Number(row.index) === headerId);
}

function buildGen4EventOverlays(
  project: ProjectState,
  cells: Gen4StitchedMapCell[],
  fallbackHeaderId: number | undefined,
  warnings: string[],
): Map3dEntityOverlay[] {
  if (!project.narcs.overworlds) return [];
  let rows: HeaderRow[] = [];
  try {
    if (!project.headers) project.headers = parseHeaders(project);
    rows = Object.values(project.headers.rows);
  } catch {
    return [];
  }
  const cellByMatrix = new Map(cells.filter((cell) => !cell.empty && !cell.missing).map((cell) => [`${cell.matrixX},${cell.matrixY}`, cell]));
  const eventIds = new Set<number>();
  for (const cell of cells) {
    const header = cell.headerId === undefined ? undefined : findGen4HeaderRow(rows, cell.headerId);
    const fallbackHeader = fallbackHeaderId === undefined ? undefined : findGen4HeaderRow(rows, fallbackHeaderId);
    const eventId = Number(header?.overworlds_id ?? header?.event_id ?? header?.map_id ?? fallbackHeader?.overworlds_id ?? fallbackHeader?.event_id ?? fallbackHeader?.map_id);
    if (Number.isSafeInteger(eventId) && eventId >= 0) eventIds.add(eventId);
  }

  const overlays: Map3dEntityOverlay[] = [];
  for (const eventId of eventIds) {
    let raw: RawRecord | undefined;
    try {
      raw = decodeRecord(project, "overworlds", eventId).raw;
    } catch (error) {
      warnings.push(`Gen 4 event file ${eventId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!raw) {
      warnings.push(`Gen 4 event file ${eventId} could not be decoded for map overlays.`);
      continue;
    }
    overlays.push(...gen4SpawnableOverlays(raw, eventId, cellByMatrix));
    overlays.push(...gen4NpcOverlays(project, raw, eventId, cellByMatrix));
    overlays.push(...gen4WarpOverlays(raw, eventId, cellByMatrix));
    overlays.push(...gen4TriggerOverlays(raw, eventId, cellByMatrix));
  }
  if (overlays.length > 0) warnings.push(`Loaded ${overlays.length} Gen 4 event overlay${overlays.length === 1 ? "" : "s"} from ${eventIds.size} event file${eventIds.size === 1 ? "" : "s"}.`);
  return overlays;
}

function gen4SpawnableOverlays(raw: RawRecord, eventId: number, cells: Map<string, Gen4StitchedMapCell>): Map3dEntityOverlay[] {
  return Array.from({ length: Number(raw.spawnable_count ?? 0) }, (_value, index): Map3dEntityOverlay | undefined => {
    const placed = gen4OverlayPlacement(raw, "spawnable", index, cells, false);
    if (!placed) return undefined;
    return {
      kind: "furniture" as const,
      id: index,
      label: `Spawnable ${index} / Event ${eventId} / Script ${Number(raw[`spawnable_${index}_script_number`] ?? 0)}`,
      x: placed.x,
      y: placed.y + gen4EventOverlayY(raw[`spawnable_${index}_z_position`]),
      z: placed.z,
      width: GEN4_MAP_WORLD_UNITS_PER_TILE,
      height: GEN4_MAP_WORLD_UNITS_PER_TILE,
      depth: GEN4_MAP_WORLD_UNITS_PER_TILE,
      centered: false,
      sprite: { missing: true, worldHeight: GEN4_MAP_WORLD_UNITS_PER_TILE },
    };
  }).filter((overlay): overlay is Map3dEntityOverlay => Boolean(overlay));
}

function gen4NpcOverlays(
  project: ProjectState,
  raw: RawRecord,
  eventId: number,
  cells: Map<string, Gen4StitchedMapCell>,
): Map3dEntityOverlay[] {
  return Array.from({ length: Number(raw.overworld_count ?? 0) }, (_value, index): Map3dEntityOverlay | undefined => {
    const placed = gen4OverlayPlacement(raw, "overworld", index, cells, true);
    if (!placed) return undefined;
    const owId = Number(raw[`overworld_${index}_ow_id`] ?? index);
    const sprite = Number(raw[`overworld_${index}_overlay_table_entry`] ?? 0);
    const direction = Number(raw[`overworld_${index}_orientation`] ?? 0);
    const image = getGen4OverworldSpriteImage(project, sprite, direction);
    const specialIcon = image ? undefined : gen4SpecialOverworldIconName(sprite);
    return {
      kind: "npc" as const,
      id: owId,
      label: `NPC ${owId} / Event ${eventId} / Sprite ${sprite}`,
      x: placed.x,
      y: placed.y + gen4EventOverlayY(raw[`overworld_${index}_z_position`]),
      z: placed.z,
      width: GEN4_MAP_WORLD_UNITS_PER_TILE,
      height: GEN4_MAP_WORLD_UNITS_PER_TILE * 2,
      depth: GEN4_MAP_WORLD_UNITS_PER_TILE,
      centered: true,
      sprite: image
        ? {
            texture: { name: `gen4_ow_${sprite}_${direction}_${image.name}`, width: image.width, height: image.height, rgba: image.rgba },
            worldHeight: GEN4_MAP_WORLD_UNITS_PER_TILE * 2,
          }
        : specialIcon
          ? { assetUrl: publicAsset(`images/overworlds/gen4-special/${specialIcon}.png`), worldHeight: gen4SpecialOverworldWorldHeight(specialIcon) }
          : { missing: true, worldHeight: GEN4_MAP_WORLD_UNITS_PER_TILE * 2 },
    };
  }).filter((overlay): overlay is Map3dEntityOverlay => Boolean(overlay));
}

function gen4SpecialOverworldWorldHeight(iconName: string): number {
  return iconName.includes("sign") ? GEN4_MAP_WORLD_UNITS_PER_TILE * 1.5 : GEN4_MAP_WORLD_UNITS_PER_TILE * 2;
}

function gen4WarpOverlays(raw: RawRecord, eventId: number, cells: Map<string, Gen4StitchedMapCell>): Map3dEntityOverlay[] {
  return Array.from({ length: Number(raw.warp_count ?? 0) }, (_value, index): Map3dEntityOverlay | undefined => {
    const placed = gen4OverlayPlacement(raw, "warp", index, cells, false);
    if (!placed) return undefined;
    return {
      kind: "warp" as const,
      id: index,
      label: `Warp ${index} / Event ${eventId} -> Header ${Number(raw[`warp_${index}_header`] ?? 0)}`,
      x: placed.x,
      y: placed.y + GEN4_EVENT_OVERLAY_LIFT_Y,
      z: placed.z,
      width: GEN4_MAP_WORLD_UNITS_PER_TILE,
      height: GEN4_MAP_WORLD_UNITS_PER_TILE,
      depth: GEN4_MAP_WORLD_UNITS_PER_TILE,
      centered: false,
    };
  }).filter((overlay): overlay is Map3dEntityOverlay => Boolean(overlay));
}

function gen4TriggerOverlays(raw: RawRecord, eventId: number, cells: Map<string, Gen4StitchedMapCell>): Map3dEntityOverlay[] {
  return Array.from({ length: Number(raw.trigger_count ?? 0) }, (_value, index): Map3dEntityOverlay | undefined => {
    const placed = gen4OverlayPlacement(raw, "trigger", index, cells, false);
    if (!placed) return undefined;
    const width = Math.max(1, Number(raw[`trigger_${index}_width_x`] ?? 1)) * GEN4_MAP_WORLD_UNITS_PER_TILE;
    const depth = Math.max(1, Number(raw[`trigger_${index}_height_y`] ?? 1)) * GEN4_MAP_WORLD_UNITS_PER_TILE;
    return {
      kind: "trigger" as const,
      id: index,
      label: `Trigger ${index} / Event ${eventId} / Script ${Number(raw[`trigger_${index}_script_number`] ?? 0)}`,
      x: placed.x,
      y: placed.y + Number(raw[`trigger_${index}_z_position`] ?? 0) + GEN4_EVENT_OVERLAY_LIFT_Y,
      z: placed.z,
      width,
      height: GEN4_MAP_WORLD_UNITS_PER_TILE,
      depth,
      centered: false,
    };
  }).filter((overlay): overlay is Map3dEntityOverlay => Boolean(overlay));
}

function gen4OverlayPlacement(
  raw: RawRecord,
  group: "spawnable" | "overworld" | "warp" | "trigger",
  index: number,
  cells: Map<string, Gen4StitchedMapCell>,
  centered: boolean,
): { x: number; y: number; z: number } | undefined {
  const matrixX = Number(raw[`${group}_${index}_x_matrix_position`] ?? 0);
  const matrixY = Number(raw[`${group}_${index}_y_matrix_position`] ?? 0);
  const cell = cells.get(`${matrixX},${matrixY}`);
  if (!cell) return undefined;
  const localX = Number(raw[`${group}_${index}_x_map_position`] ?? 0);
  const localY = Number(raw[`${group}_${index}_y_map_position`] ?? 0);
  const baseX = cell.x * GEN4_MAP_WORLD_UNITS_PER_TILE;
  const baseZ = cell.y * GEN4_MAP_WORLD_UNITS_PER_TILE;
  const centerOffset = centered ? GEN4_MAP_WORLD_UNITS_PER_TILE / 2 : 0;
  return {
    x: baseX + localX * GEN4_MAP_WORLD_UNITS_PER_TILE + centerOffset,
    y: cell.altitude * GEN4_MATRIX_ALTITUDE_UNIT,
    z: baseZ + localY * GEN4_MAP_WORLD_UNITS_PER_TILE + centerOffset,
  };
}

function gen4EventOverlayY(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return GEN4_EVENT_OVERLAY_LIFT_Y;
  return numeric / 4096 + GEN4_EVENT_OVERLAY_LIFT_Y;
}

function renderResourcesForAreaData(
  project: ProjectState,
  areaDataId: number,
  cache: Map<number, Gen4AreaRenderResources | undefined>,
  warnings: string[],
): Gen4AreaRenderResources | undefined {
  if (cache.has(areaDataId)) return cache.get(areaDataId);
  const areaDataBytes = project.narcs.area_data?.rawFiles[areaDataId];
  if (!areaDataBytes) {
    warnings.push(`Area data ${areaDataId} is missing; terrain and building models will render without area texture packs.`);
    cache.set(areaDataId, undefined);
    return undefined;
  }
  let areaData: Gen4AreaData;
  try {
    areaData = parseGen4AreaData(areaDataBytes, project.session.baseRom);
  } catch (error) {
    warnings.push(`Area data ${areaDataId}: ${error instanceof Error ? error.message : String(error)}`);
    cache.set(areaDataId, undefined);
    return undefined;
  }

  const resources: Gen4AreaRenderResources = {
    areaData,
    interiorBuildings: project.session.baseRom === "HGSS" && areaData.areaType === GEN4_HGSS_INDOOR_AREA_TYPE,
  };
  const textureBytes = project.narcs.map_textures?.rawFiles[areaData.mapTileset];
  if (!textureBytes) {
    warnings.push(`Map texture pack ${areaData.mapTileset} is missing; terrain model will render without map textures.`);
  } else {
    try {
      resources.mapTextures = readNitroResources(textureBytes);
    } catch (error) {
      warnings.push(`Map texture pack ${areaData.mapTileset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const buildingTextureBytes = project.narcs.building_textures?.rawFiles[areaData.buildingTileset];
  if (!buildingTextureBytes) {
    warnings.push(`Building texture pack ${areaData.buildingTileset} is missing; building models will render without building textures.`);
  } else {
    try {
      resources.buildingTextures = readNitroResources(buildingTextureBytes);
    } catch (error) {
      warnings.push(`Building texture pack ${areaData.buildingTileset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  cache.set(areaDataId, resources);
  return resources;
}

function combineResources(model: ReturnType<typeof readNitroResources>, textures: ReturnType<typeof readNitroResources>): ReturnType<typeof readNitroResources> {
  return {
    models: model.models,
    textures: [...model.textures, ...textures.textures],
    palettes: [...model.palettes, ...textures.palettes],
  };
}

function buildGen4MapBuildings(
  project: ProjectState,
  mapId: number,
  placements: Gen4MapBuilding[],
  worldX: number,
  worldY: number,
  worldZ: number,
  areaResources: Gen4AreaRenderResources | undefined,
  warnings: string[],
  diagnostics: Map3dBuildingDiagnostic[],
): Map3dSceneData["buildings"] {
  if (placements.length === 0) return [];
  const modelStore = areaResources?.interiorBuildings ? project.narcs.interior_building_models : project.narcs.exterior_building_models;
  if (!modelStore) {
    warnings.push(`Map ${mapId} has ${placements.length} building placement${placements.length === 1 ? "" : "s"}, but the Gen 4 building model NARC is not loaded.`);
    for (const placement of placements) {
      diagnostics.push({ mapId, placementIndex: placement.index, modelId: placement.modelId, status: "missing-model-store" });
    }
    return [];
  }
  const buildings: Map3dSceneData["buildings"] = [];
  for (const placement of placements) {
    const modelBytes = modelStore.rawFiles[placement.modelId];
    if (!modelBytes) {
      warnings.push(`Map ${mapId} building ${placement.index} references missing building model ${placement.modelId}.`);
      diagnostics.push({ mapId, placementIndex: placement.index, modelId: placement.modelId, status: "missing-model" });
      continue;
    }
    if (readAscii(modelBytes, 0, 4) !== "BMD0") {
      const stamp = readAscii(modelBytes, 0, 4);
      warnings.push(`Map ${mapId} building ${placement.index} model ${placement.modelId} has unsupported stamp ${stamp}.`);
      diagnostics.push({ mapId, placementIndex: placement.index, modelId: placement.modelId, status: "bad-stamp", message: stamp });
      continue;
    }
    try {
      const modelResources = readNitroResources(modelBytes);
      const primitives = buildModelPrimitives(areaResources?.buildingTextures ? combineResources(modelResources, areaResources.buildingTextures) : modelResources, warnings, {
        recoverSkippedPieces: true,
      });
      if (primitives.length === 0) {
        warnings.push(`Map ${mapId} building ${placement.index} model ${placement.modelId} produced no primitives.`);
        diagnostics.push({ mapId, placementIndex: placement.index, modelId: placement.modelId, status: "empty-primitives" });
        continue;
      }
      const transformedPrimitives = transformPrimitives(primitives, gen4BuildingTransform(placement));
      const primitiveCount = transformedPrimitives.length;
      const triangleCount = countTriangles(transformedPrimitives);
      const bounds = offsetBounds(boundsForPrimitives(transformedPrimitives), worldX, worldY, worldZ);
      if (bounds && bounds.maxY < 0) {
        warnings.push(
          `Map ${mapId} building ${placement.index} model ${placement.modelId} is entirely below the terrain plane (${bounds.minY.toFixed(1)}..${bounds.maxY.toFixed(1)} Y).`,
        );
      }
      buildings.push({
        uid: placement.modelId,
        placementIndex: placement.index,
        modelId: placement.modelId,
        sourceChunkId: mapId,
        chunkId: mapId,
        worldX,
        worldY,
        worldZ,
        rotationY: 0,
        primitives: transformedPrimitives,
        primitiveCount,
        triangleCount,
        bounds,
      });
      diagnostics.push({ mapId, placementIndex: placement.index, modelId: placement.modelId, status: "rendered", primitiveCount, triangleCount, bounds });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Map ${mapId} building ${placement.index} model ${placement.modelId}: ${message}`);
      diagnostics.push({ mapId, placementIndex: placement.index, modelId: placement.modelId, status: "error", message });
    }
  }
  return buildings;
}

function countTriangles(primitives: Map3dPrimitive[]): number {
  return primitives.reduce((sum, primitive) => sum + Math.floor(primitive.indices.length / 3), 0);
}

function boundsForPrimitives(primitives: Map3dPrimitive[]): Map3dBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const primitive of primitives) {
    for (let index = 0; index < primitive.positions.length; index += 3) {
      const x = primitive.positions[index] ?? 0;
      const y = primitive.positions[index + 1] ?? 0;
      const z = primitive.positions[index + 2] ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
      seen = true;
    }
  }
  return seen ? { minX, maxX, minY, maxY, minZ, maxZ } : undefined;
}

function offsetBounds(bounds: Map3dBounds | undefined, x: number, y: number, z: number): Map3dBounds | undefined {
  if (!bounds) return undefined;
  return {
    minX: bounds.minX + x,
    maxX: bounds.maxX + x,
    minY: bounds.minY + y,
    maxY: bounds.maxY + y,
    minZ: bounds.minZ + z,
    maxZ: bounds.maxZ + z,
  };
}

export function gen4PlacementOffsetForTerrain(bounds: Map3dBounds | undefined): Gen4CellPlacementOffset {
  if (!bounds) return { x: 0, z: 0 };
  return {
    x: gen4PlacementOffsetForAxis(bounds.minX),
    z: gen4PlacementOffsetForAxis(bounds.minZ),
  };
}

export function gen4ObjectPlacementOffsetForTerrain(bounds: Map3dBounds | undefined): Gen4CellPlacementOffset {
  const offset = gen4PlacementOffsetForTerrain(bounds);
  if (offset.x === 0 && offset.z === 0) return offset;
  return {
    x: offset.x + GEN4_TOP_LEFT_OBJECT_NUDGE_X,
    z: offset.z + GEN4_TOP_LEFT_OBJECT_NUDGE_Z,
  };
}

function gen4PlacementOffsetForAxis(min: number): number {
  return min > -GEN4_MAP_CHUNK_SPAN / 4 ? GEN4_MAP_CHUNK_SPAN / 2 : 0;
}

function transformPrimitives(primitives: Map3dPrimitive[], matrix: ColMat4): Map3dPrimitive[] {
  return primitives.map((primitive) => {
    const positions = new Float32Array(primitive.positions.length);
    for (let index = 0; index < primitive.positions.length; index += 3) {
      const [x, y, z] = colTransformPoint(matrix, primitive.positions[index] ?? 0, primitive.positions[index + 1] ?? 0, primitive.positions[index + 2] ?? 0);
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = z;
    }
    return { ...primitive, positions };
  });
}

function gen4BuildingTransform(building: Gen4MapBuilding): ColMat4 {
  return colTranslate(building.x, building.y, building.z);
}

function colIdentity(): ColMat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function colTranslate(x: number, y: number, z: number): ColMat4 {
  const matrix = colIdentity();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

function colTransformPoint(matrix: ColMat4, x: number, y: number, z: number): [number, number, number] {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function clampByte(value: number): number {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(0xff, Math.round(Number(value)))) & 0xff;
}
