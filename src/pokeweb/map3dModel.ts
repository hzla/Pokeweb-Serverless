import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { loadActiveRomBytes } from "./persistence";
import type { BaseRom } from "./constants";
import type { HeaderRow } from "./headerModel";
import { parseHeaders, updateHeaderField } from "./headerModel";
import { createNarcStore, markDirty, type ProjectState } from "./projectStore";

const MATRIX_PATH = "a/0/0/9";
const MAP_CHUNKS_PATH = "a/0/0/8";
const MAP_REPLACE_PATH = "a/0/1/0";
const AREA_TABLE_PATH = "a/0/1/3";
const MAP_TEXTURES_PATH = "a/0/1/4";
const MMODEL_INDEX_BW_PATH = "a/0/4/8";
const MMODEL_INDEX_BW2_PATH = "a/0/4/7";
const MMODEL_RES_BW_PATH = "a/0/4/9";
const MMODEL_RES_BW2_PATH = "a/0/4/8";
const ZONE_ENTITIES_BW_PATH = "a/1/2/5";
const ZONE_ENTITIES_BW2_PATH = "a/1/2/6";
const BMODEL_TEX_EXT_BW_PATH = "a/1/7/6";
const BMODEL_TEX_EXT_BW2_PATH = "a/1/7/4";
const BMODEL_TEX_INT_BW_PATH = "a/1/7/7";
const BMODEL_TEX_INT_BW2_PATH = "a/1/7/5";
const BMODEL_BUNDLE_EXT_BW_PATH = "a/2/2/9";
const BMODEL_BUNDLE_EXT_BW2_PATH = "a/2/2/5";
const BMODEL_BUNDLE_INT_BW_PATH = "a/2/3/0";
const BMODEL_BUNDLE_INT_BW2_PATH = "a/2/2/6";
const CHUNK_SPAN = 512;
const TILE_REAL_SIZE = 16;
const ENTITY_HEADER_BYTES = 8;
const FURNITURE_BYTES = 0x14;
const NPC_BYTES = 0x24;
const WARP_BYTES = 0x14;
const TRIGGER_BYTES = 0x16;
const NPC_REGISTRY_ENTRY_BYTES = 0x1c;
const SPRITE_MODEL_THRESHOLD_BW = 6;
const SPRITE_MODEL_THRESHOLD_BW2 = 7;
const MMDL_BILLBOARD_SIZES = [
  [32, 32],
  [16, 16],
  [64, 64],
] as const;

export type Map3dSeason = "spring" | "summer" | "autumn" | "winter";

export type Map3dLoadOptions = {
  season?: Map3dSeason;
};

export type Map3dZoneSummary = {
  zoneId: number;
  label: string;
  locationName: string;
  matrixId: number;
};

export type Map3dZoneMetadata = {
  zoneId: number;
  rowId: number;
  locationName: string;
  locationNameId: number;
  matrixId: number;
  areaId: number;
  overworldsId: number;
  scriptId: number;
  textBankId: number;
  encounterId: number;
  mapType: number;
  weatherId: number;
  parentMapId: number;
  levelScriptId: number;
  cameraId: number;
  flags: number;
};

export type Map3dAreaMetadata = {
  buildingsId: number;
  texturesId: number;
  srtAnimeIdx: number;
  patAnimeIdx: number;
  isExterior: boolean;
};

export type Map3dMaterial = {
  name: string;
  diffuse: [number, number, number];
  alpha: number;
  texture?: DecodedTexture;
  repeatS?: boolean;
  repeatT?: boolean;
  flipS?: boolean;
  flipT?: boolean;
};

export type DecodedTexture = {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type Map3dPrimitive = {
  material: Map3dMaterial;
  positions: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  normals?: Float32Array;
  indices: Uint16Array;
};

export type Map3dChunk = {
  chunkId: number;
  sourceChunkId: number;
  matrixX: number;
  matrixY: number;
  worldX: number;
  worldY?: number;
  worldZ: number;
  primitives: Map3dPrimitive[];
  permissions?: Map3dPermissionChunk;
};

export type Map3dPermissionTile = {
  tileClass: number;
  flags: number;
  heightType: number;
  slope: number;
  height: number;
};

export type Map3dPermissionChunk = {
  chunkId: number;
  width: number;
  height: number;
  tiles: Map3dPermissionTile[];
};

export type Map3dPermissionEdit = {
  chunkId: number;
  tileX: number;
  tileY: number;
  tileClass: number;
  flags: number;
};

export type Map3dBuilding = {
  uid: number;
  placementIndex?: number;
  modelId?: number;
  sourceChunkId: number;
  chunkId: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  rotationY: number;
  primitives: Map3dPrimitive[];
  primitiveCount?: number;
  triangleCount?: number;
  bounds?: Map3dBounds;
};

export type Map3dBuildingDiagnostic = {
  mapId: number;
  placementIndex: number;
  modelId: number;
  status: "rendered" | "missing-model-store" | "missing-model" | "bad-stamp" | "empty-primitives" | "error";
  primitiveCount?: number;
  triangleCount?: number;
  bounds?: Map3dBounds;
  message?: string;
};

export type Map3dBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type Map3dEntityOverlay = {
  kind: "furniture" | "npc" | "warp" | "trigger";
  id: number;
  label: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  centered: boolean;
  sprite?: {
    texture?: DecodedTexture;
    assetUrl?: string;
    missing?: boolean;
    worldHeight?: number;
  };
};

export type Map3dNpcModel = {
  uid: number;
  objCode: number;
  resourceId: number;
  modelType: "model" | "sprite";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  movement: Map3dNpcMovement;
  spriteFrames?: Map3dNpcSpriteFrames;
  primitives: Map3dPrimitive[];
};

export type Map3dNpcSpriteDirection = "up" | "down" | "left" | "right";

export type Map3dNpcSpriteFrames = {
  width: number;
  height: number;
  framesByDirection: Partial<Record<Map3dNpcSpriteDirection, DecodedTexture[]>>;
};

export type Map3dNpcMovement = {
  moveCode: number;
  movementModifier: number;
  sightRange: number;
  modifierStepCount: number;
  modifierParameter2: number;
  horizontalLeash: number;
  verticalLeash: number;
  initialDirection: number;
};

export type Map3dSceneData = {
  zoneId: number;
  label: string;
  season: Map3dSeason;
  matrixId: number;
  sourceMatrixId: number;
  areaId: number;
  sourceAreaId: number;
  textureId: number;
  buildingsId: number;
  areaMetadata: Map3dAreaMetadata;
  seasonal: boolean;
  chunkSpan: number;
  chunkCount: number;
  textureCount: number;
  buildingCount: number;
  buildingPlacementCount?: number;
  entityCount: number;
  npcModelCount: number;
  permissionTileCount: number;
  chunks: Map3dChunk[];
  buildings: Map3dBuilding[];
  buildingDiagnostics?: Map3dBuildingDiagnostic[];
  entities: Map3dEntityOverlay[];
  npcModels: Map3dNpcModel[];
  warnings: string[];
};

type LazyArchives = {
  baseRom: BaseRom;
  matrix: NARC;
  chunks: NARC;
  mapReplace: Uint8Array;
  areaTable: Uint8Array;
  textures: NARC;
  npcRegistry: Uint8Array;
  moveModelResources: NARC;
  entities: NARC;
  buildingTexExt: NARC;
  buildingTexInt: NARC;
  buildingBundleExt: NARC;
  buildingBundleInt: NARC;
};

type MatrixData = {
  hasZones: boolean;
  width: number;
  height: number;
  chunkIds: number[];
  zoneIds: number[];
};

type AreaHeader3d = Map3dAreaMetadata;

type MapReplaceEntry = {
  matrixId: number;
  typeIsMatrix: boolean;
  condition: number;
  replacements: number[];
};

type BuildingResource = {
  uid: number;
  primitives: Map3dPrimitive[];
};

type NpcModelResource = {
  modelType: "model" | "sprite";
  primitives: Map3dPrimitive[];
  spriteFrames?: Map3dNpcSpriteFrames;
};

type ChunkBuildingPlacement = {
  modelUid: number;
  x: number;
  y: number;
  z: number;
  rotationY: number;
};

type ParsedZoneEntityData = {
  overlays: Map3dEntityOverlay[];
  npcs: ParsedNpcEntity[];
};

type ParsedNpcEntity = {
  uid: number;
  objCode: number;
  script: number;
  faceDirection: number;
  movement: Map3dNpcMovement;
  x: number;
  y: number;
  z: number;
};

type NpcRegistryEntry = {
  uid: number;
  billboardSize: number;
  spriteControllerType: number;
  width: number;
  height: number;
  wPosOffX: number;
  wPosOffY: number;
  wPosOffZ: number;
  resourceIndices: number[];
};

type NitroTexture = {
  name: string;
  params: TextureParams;
  data1: Uint8Array;
  data2: Uint8Array;
};

type NitroPalette = {
  name: string;
  offset: number;
  block: Uint8Array;
};

type NitroMaterial = {
  name: string;
  textureName?: string;
  paletteName?: string;
  params: TextureParams;
  width: number;
  height: number;
  diffuse: [number, number, number];
  alpha: number;
  defaultVertexColor: boolean;
  repeatS: boolean;
  repeatT: boolean;
  flipS: boolean;
  flipT: boolean;
  textureTransformMode: number;
  scaleS: number;
  scaleT: number;
  transS: number;
  transT: number;
  textureMatrix?: number[];
};

type NitroPiece = {
  commands: Uint8Array;
};

type NitroObject = {
  matrix: Mat4;
};

type NitroModel = {
  materials: NitroMaterial[];
  pieces: NitroPiece[];
  objects: NitroObject[];
  renderOps: RenderOp[];
  upScale: number;
  downScale: number;
};

export type NitroResources = {
  models: NitroModel[];
  textures: NitroTexture[];
  palettes: NitroPalette[];
};

type RenderOp =
  | { kind: "load"; stack: number }
  | { kind: "store"; stack: number }
  | { kind: "mulObject"; object: number }
  | { kind: "scaleUp" }
  | { kind: "scaleDown" }
  | { kind: "bindMaterial"; material: number }
  | { kind: "draw"; piece: number };

type Vertex = {
  position: [number, number, number];
  uv: [number, number];
  color: [number, number, number];
  normal: [number, number, number];
};

type BuildPrimitive = {
  materialId: number;
  usedTexcoords: boolean;
  usedColors: boolean;
  usedNormals: boolean;
  vertices: Vertex[];
  indices: number[];
};

type BuildModelOptions = {
  recoverSkippedPieces?: boolean;
};

type InfoBlockItem<T> = {
  datum: T;
  name: string;
};

class Map3dLoader {
  private archives?: Promise<LazyArchives>;
  private archiveBaseRom?: BaseRom;
  private zoneCache = new Map<string, Promise<Map3dSceneData>>();

  loadZone(project: ProjectState, zoneId: number, options: Map3dLoadOptions = {}, onProgress?: (message: string) => void): Promise<Map3dSceneData> {
    const season = options.season ?? "spring";
    const cacheKey = `${project.session.baseRom}:${zoneId}:${season}`;
    const cached = this.zoneCache.get(cacheKey);
    if (cached) return cached;
    const promise = this.loadZoneUncached(project, zoneId, season, onProgress);
    this.zoneCache.set(cacheKey, promise);
    return promise;
  }

  clearCache(zoneId?: number): void {
    if (zoneId === undefined) {
      this.zoneCache.clear();
      return;
    }
    for (const key of [...this.zoneCache.keys()]) {
      if (key.includes(`:${zoneId}:`)) this.zoneCache.delete(key);
    }
  }

  async savePermissionEdits(project: ProjectState, edits: Map3dPermissionEdit[]): Promise<void> {
    if (edits.length === 0) return;
    const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
    if (!bytes) throw new Error("Reload the ROM before saving 3D map permissions");
    const rom = new NintendoDSRom(bytes);
    let store = project.narcs.maps;
    if (!store) {
      const fileId = rom.fileId(MAP_CHUNKS_PATH);
      store = createNarcStore("maps", MAP_CHUNKS_PATH, fileId, new NARC(rom.files[fileId]));
      project.narcs.maps = store;
    }

    const byChunk = new Map<number, Map3dPermissionEdit[]>();
    for (const edit of edits) {
      const bucket = byChunk.get(edit.chunkId) ?? [];
      bucket.push(edit);
      byChunk.set(edit.chunkId, bucket);
    }

    for (const [chunkId, chunkEdits] of byChunk) {
      const chunkBytes = store.rawFiles[chunkId];
      if (!chunkBytes) throw new Error(`Chunk ${chunkId} is missing from the maps NARC`);
      const container = extractGameFreakContainer(chunkBytes);
      const terrain = container.files[1];
      if (!terrain) throw new Error(`Chunk ${chunkId} does not contain collision/permission data`);
      const editedTerrain = terrain.slice();
      const parsed = parseVMapTerrain(editedTerrain, chunkId);
      for (const edit of chunkEdits) {
        if (edit.tileX < 0 || edit.tileY < 0 || edit.tileX >= parsed.width || edit.tileY >= parsed.height) {
          throw new Error(`Tile ${edit.tileX}, ${edit.tileY} is outside chunk ${chunkId}`);
        }
        const offset = 4 + (edit.tileY * parsed.width + edit.tileX) * 8 + 4;
        writeU16(editedTerrain, offset, edit.tileClass & 0xffff);
        writeU16(editedTerrain, offset + 2, edit.flags & 0xffff);
      }
      container.files[1] = editedTerrain;
      store.rawFiles[chunkId] = packGameFreakContainer(container.signature, container.files);
      markDirty(project, "maps", chunkId);
      recordGenericChange(project, "maps3d", `${chunkEdits.length} permission tile${chunkEdits.length === 1 ? "" : "s"} changed in chunk ${chunkId}.`, `3D map chunk ${chunkId}`, {
        key: `map3d-permissions:${chunkId}`,
      });
    }
  }

  private async loadZoneUncached(project: ProjectState, zoneId: number, season: Map3dSeason, onProgress?: (message: string) => void): Promise<Map3dSceneData> {
    onProgress?.("Reading ROM archives");
    const archives = await this.getArchives(project.session.baseRom);
    const row = getHeaderRow(project, zoneId);
    const sourceMatrixId = Number(row.matrix_id ?? 0);
    const sourceAreaId = Number(row.texture_id ?? 0);
    const replacementTable = parseMapReplaceTable(archives.mapReplace);
    const seasonIndex = seasonToIndex(season);
    const seasonal = areaHasSeasons(archives.baseRom, sourceAreaId);
    const matrixId = resolveMapReplacement(replacementTable, sourceMatrixId, seasonIndex) ?? sourceMatrixId;
    const areaId = seasonal ? sourceAreaId + seasonIndex : sourceAreaId;
    const area = applyAreaEdit(project, areaId, parseAreaHeader(archives.areaTable, areaId));
    const matrixBytes = archives.matrix.files[matrixId];
    if (!matrixBytes) throw new Error(`Matrix ${matrixId} is missing`);
    const matrix = parseMapMatrix(matrixBytes);
    const texturePackBytes = archives.textures.files[area.texturesId];
    if (!texturePackBytes) throw new Error(`Map texture pack ${area.texturesId} is missing`);

    onProgress?.("Decoding map textures");
    const textureResources = readNitroResources(texturePackBytes);
    const chunks: Map3dChunk[] = [];
    const chunkContainers = new Map<number, Uint8Array[]>();
    const warnings: string[] = [];

    for (let y = 0; y < matrix.height; y += 1) {
      for (let x = 0; x < matrix.width; x += 1) {
        const index = y * matrix.width + x;
        const sourceChunkId = matrix.chunkIds[index] ?? -1;
        if (sourceChunkId < 0) continue;
        if (matrix.hasZones && matrix.zoneIds[index] !== zoneId) continue;
        const chunkId = resolveChunkReplacement(replacementTable, matrixId, sourceChunkId, seasonIndex) ?? sourceChunkId;
        const chunkContainer = archives.chunks.files[chunkId];
        if (!chunkContainer) {
          warnings.push(`Chunk ${chunkId} is missing`);
          continue;
        }

        try {
          const chunkFiles = extractGameFreakContainer(chunkContainer);
          chunkContainers.set(chunkId, chunkFiles.files);
          const nsbmd = chunkFiles.files[0];
          if (!nsbmd || readAscii(nsbmd, 0, 4) !== "BMD0") {
            warnings.push(`Chunk ${chunkId} does not contain a terrain BMD0`);
            continue;
          }
          const modelResources = readNitroResources(nsbmd);
          const resources = combineResources(modelResources, textureResources);
          const permissions = chunkFiles.files[1] ? safeParseVMapTerrain(chunkFiles.files[1], chunkId, warnings) : undefined;
          chunks.push({
            chunkId,
            sourceChunkId,
            matrixX: x,
            matrixY: y,
            worldX: x * CHUNK_SPAN + CHUNK_SPAN / 2,
            worldZ: y * CHUNK_SPAN + CHUNK_SPAN / 2,
            primitives: buildModelPrimitives(resources, warnings),
            permissions,
          });
        } catch (error) {
          warnings.push(`Chunk ${chunkId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        onProgress?.(`Decoded ${chunks.length} terrain chunks`);
      }
    }

    onProgress?.("Decoding building models");
    const buildings = loadBuildingsForZone(archives, area, areaId, chunks, chunkContainers, warnings);
    onProgress?.("Loading entity overlays");
    const entityData = loadEntityData(archives, row, warnings);
    onProgress?.("Decoding NPC models");
    const npcModels = loadNpcModels(archives, entityData.npcs, warnings);

    return {
      zoneId,
      label: zoneLabel(row),
      season,
      matrixId,
      sourceMatrixId,
      areaId,
      sourceAreaId,
      textureId: area.texturesId,
      buildingsId: resolveBuildingsId(archives.baseRom, areaId, area),
      areaMetadata: area,
      seasonal,
      chunkSpan: CHUNK_SPAN,
      chunkCount: chunks.length,
      textureCount: textureResources.textures.length,
      buildingCount: buildings.length,
      entityCount: entityData.overlays.length,
      npcModelCount: npcModels.length,
      permissionTileCount: chunks.reduce((sum, chunk) => sum + (chunk.permissions?.tiles.length ?? 0), 0),
      chunks,
      buildings,
      entities: entityData.overlays,
      npcModels,
      warnings,
    };
  }

  private async getArchives(baseRom: BaseRom): Promise<LazyArchives> {
    if (!this.archives || this.archiveBaseRom !== baseRom) {
      this.archives = loadArchives(baseRom);
      this.archiveBaseRom = baseRom;
      this.zoneCache.clear();
    }
    return this.archives;
  }
}

const map3dLoader = new Map3dLoader();

export function getMap3dZones(project: ProjectState): Map3dZoneSummary[] {
  if (!project.headers) project.headers = parseHeaders(project);
  return Object.values(project.headers.rows)
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((row) => ({
      zoneId: Number(row.index),
      label: zoneLabel(row),
      locationName: String(row.location_name ?? "Unknown Location"),
      matrixId: Number(row.matrix_id ?? 0),
    }));
}

export function loadMap3dZone(project: ProjectState, zoneId: number, options?: Map3dLoadOptions, onProgress?: (message: string) => void): Promise<Map3dSceneData> {
  return map3dLoader.loadZone(project, zoneId, options, onProgress);
}

export function saveMap3dPermissionEdits(project: ProjectState, edits: Map3dPermissionEdit[]): Promise<void> {
  return map3dLoader.savePermissionEdits(project, edits);
}

export function getMap3dZoneMetadata(project: ProjectState, zoneId: number): Map3dZoneMetadata {
  const row = getHeaderRow(project, zoneId);
  return {
    zoneId,
    rowId: Number(row.index) + 1,
    locationName: String(row.location_name ?? "Unknown Location"),
    locationNameId: Number(row.location_name_id ?? 0),
    matrixId: Number(row.matrix_id ?? 0),
    areaId: Number(row.texture_id ?? 0),
    overworldsId: Number(row.overworlds_id ?? row.map_id ?? 0),
    scriptId: Number(row.script_id ?? 0),
    textBankId: Number(row.text_bank_id ?? 0),
    encounterId: Number(row.encounter_id ?? 0),
    mapType: Number(row.map_type ?? 0),
    weatherId: Number(row.weather_id ?? 0),
    parentMapId: Number(row.parent_map_id ?? 0),
    levelScriptId: Number(row.level_script_id ?? 0),
    cameraId: Number(row.camera_id ?? 0),
    flags: Number(row.flags ?? 0),
  };
}

export function updateMap3dZoneMetadata(
  project: ProjectState,
  zoneId: number,
  updates: Partial<Record<keyof Map3dZoneMetadata, string | number>>,
): Map3dZoneMetadata {
  const before = getMap3dZoneMetadata(project, zoneId);
  const fields: Array<[keyof Map3dZoneMetadata, string]> = [
    ["locationName", "location_name"],
    ["matrixId", "matrix_id"],
    ["areaId", "texture_id"],
    ["overworldsId", "overworlds_id"],
    ["scriptId", "script_id"],
    ["textBankId", "text_bank_id"],
    ["encounterId", "encounter_id"],
    ["mapType", "map_type"],
    ["weatherId", "weather_id"],
    ["parentMapId", "parent_map_id"],
    ["levelScriptId", "level_script_id"],
    ["cameraId", "camera_id"],
    ["flags", "flags"],
  ];
  for (const [metadataField, headerField] of fields) {
    const value = updates[metadataField];
    if (value === undefined) continue;
    updateHeaderField(project, before.rowId, headerField, String(value));
  }
  map3dLoader.clearCache(zoneId);
  const after = getMap3dZoneMetadata(project, zoneId);
  for (const [field] of fields) {
    if (updates[field] === undefined) continue;
    recordFieldChange(project, "maps3d", `3D map zone ${zoneId}`, map3dFieldLabel(field), before[field], after[field], {
      key: `map3d-zone:${zoneId}:${field}`,
    });
  }
  return after;
}

export function updateMap3dAreaMetadata(project: ProjectState, areaId: number, current: Map3dAreaMetadata, updates: Partial<Map3dAreaMetadata>): Map3dAreaMetadata {
  const next: Map3dAreaMetadata = {
    buildingsId: clampInt(updates.buildingsId ?? current.buildingsId, 0, 65535, "buildingsId"),
    texturesId: clampInt(updates.texturesId ?? current.texturesId, 0, 65535, "texturesId"),
    srtAnimeIdx: clampInt(updates.srtAnimeIdx ?? current.srtAnimeIdx, 0, 255, "srtAnimeIdx"),
    patAnimeIdx: clampInt(updates.patAnimeIdx ?? current.patAnimeIdx, 0, 255, "patAnimeIdx"),
    isExterior: updates.isExterior ?? current.isExterior,
  };
  project.map3dAreaEdits ??= {};
  project.map3dAreaEdits[String(areaId)] = next;
  map3dLoader.clearCache();
  for (const field of Object.keys(updates) as Array<keyof Map3dAreaMetadata>) {
    recordFieldChange(project, "maps3d", `3D map area ${areaId}`, map3dFieldLabel(field), current[field], next[field], {
      key: `map3d-area:${areaId}:${field}`,
    });
  }
  return next;
}

export function materializeMap3dAreaEdits(project: ProjectState, rom: NintendoDSRom, fileReplacements: Map<number, Uint8Array>): void {
  const edits = project.map3dAreaEdits;
  if (!edits || Object.keys(edits).length === 0) return;
  const out = rom.getFileByName(AREA_TABLE_PATH).slice();
  for (const [areaIdText, edit] of Object.entries(edits)) {
    const areaId = Number(areaIdText);
    if (!Number.isSafeInteger(areaId) || areaId < 0) continue;
    const offset = areaId * 10;
    if (offset + 10 > out.length) continue;
    writeAreaHeader(out, offset, edit);
  }
  fileReplacements.set(rom.fileId(AREA_TABLE_PATH), out);
}

export function extractGameFreakContainer(data: Uint8Array): { signature: string; files: Uint8Array[] } {
  if (data.length < 8) throw new Error("Game Freak container is too small");
  const signature = readAscii(data, 0, 2);
  const count = readU16(data, 2);
  if (count <= 0 || 4 + (count + 1) * 4 > data.length) throw new Error("Invalid Game Freak container header");
  const offsets = Array.from({ length: count + 1 }, (_value, index) => readU32(data, 4 + index * 4));
  const files = offsets.slice(0, -1).map((start, index) => {
    const end = offsets[index + 1];
    if (start > end || end > data.length) throw new Error(`Invalid Game Freak container file ${index}`);
    return data.slice(start, end);
  });
  return { signature, files };
}

export function packGameFreakContainer(signature: string, files: Uint8Array[]): Uint8Array {
  if (signature.length < 2) throw new Error("Game Freak container signature is missing");
  const headerLength = 4 + (files.length + 1) * 4;
  const body = concatBytes(files);
  const out = new Uint8Array(headerLength + body.length);
  out[0] = signature.charCodeAt(0);
  out[1] = signature.charCodeAt(1);
  writeU16(out, 2, files.length);
  let offset = headerLength;
  files.forEach((file, index) => {
    writeU32(out, 4 + index * 4, offset);
    out.set(file, offset);
    offset += file.length;
  });
  writeU32(out, 4 + files.length * 4, offset);
  return out;
}

export function parseMapMatrix(data: Uint8Array): MatrixData {
  if (data.length < 8) throw new Error("Map matrix is too small");
  const hasZones = readU32(data, 0) === 1;
  const width = readU16(data, 4);
  const height = readU16(data, 6);
  const count = width * height;
  let offset = 8;
  if (offset + count * 4 > data.length) throw new Error("Map matrix chunk table is truncated");
  const chunkIds = Array.from({ length: count }, () => {
    const value = readS32(data, offset);
    offset += 4;
    return value;
  });
  const zoneIds = hasZones
    ? Array.from({ length: count }, () => {
        const value = readS32(data, offset);
        offset += 4;
        return value;
      })
    : [];
  return { hasZones, width, height, chunkIds, zoneIds };
}

export function parseVMapTerrain(data: Uint8Array, chunkId = 0): Map3dPermissionChunk {
  if (data.length < 4) throw new Error(`Chunk ${chunkId} terrain permissions are too small`);
  const width = readU16(data, 0);
  const height = readU16(data, 2);
  const tileCount = width * height;
  if (width <= 0 || height <= 0 || 4 + tileCount * 8 > data.length) throw new Error(`Chunk ${chunkId} terrain permissions are truncated`);
  const tiles: Map3dPermissionTile[] = [];
  for (let index = 0; index < tileCount; index += 1) {
    const offset = 4 + index * 8;
    const first = readU16(data, offset);
    const typeBits = readU32(data, offset + 4);
    tiles.push({
      heightType: first & 3,
      slope: first >>> 2,
      height: readU16(data, offset + 2),
      tileClass: typeBits & 0xffff,
      flags: typeBits >>> 16,
    });
  }
  return { chunkId, width, height, tiles };
}

function safeParseVMapTerrain(data: Uint8Array, chunkId: number, warnings: string[]): Map3dPermissionChunk | undefined {
  try {
    return parseVMapTerrain(data, chunkId);
  } catch (error) {
    warnings.push(`Chunk ${chunkId} permissions: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function parseAreaHeader(data: Uint8Array, areaId: number): AreaHeader3d {
  const offset = areaId * 10;
  if (offset + 10 > data.length) throw new Error(`Area ${areaId} is missing`);
  return {
    buildingsId: readU16(data, offset),
    texturesId: readU16(data, offset + 2),
    srtAnimeIdx: data[offset + 4] ?? 255,
    patAnimeIdx: data[offset + 5] ?? 255,
    isExterior: (data[offset + 6] ?? 0) !== 0,
  };
}

export function writeAreaHeader(data: Uint8Array, offset: number, area: Map3dAreaMetadata): void {
  if (offset + 10 > data.length) throw new Error("Area metadata write is out of range");
  writeU16(data, offset, area.buildingsId);
  writeU16(data, offset + 2, area.texturesId);
  data[offset + 4] = area.srtAnimeIdx & 0xff;
  data[offset + 5] = area.patAnimeIdx & 0xff;
  data[offset + 6] = area.isExterior ? 1 : 0;
}

function map3dFieldLabel(field: string | number | symbol): string {
  return String(field).replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/_/gu, " ").toLowerCase();
}

export function parseMapReplaceTable(data: Uint8Array): MapReplaceEntry[] {
  const count = Math.floor(data.length / 0x10);
  return Array.from({ length: count }, (_value, index) => {
    const offset = index * 0x10;
    return {
      matrixId: readU16(data, offset),
      typeIsMatrix: (data[offset + 2] ?? 0) !== 0,
      condition: data[offset + 3] ?? 0xff,
      replacements: Array.from({ length: 5 }, (_replacement, replacementIndex) => readU16(data, offset + 4 + replacementIndex * 2)),
    };
  });
}

function seasonToIndex(season: Map3dSeason): number {
  return { spring: 0, summer: 1, autumn: 2, winter: 3 }[season];
}

function areaHasSeasons(baseRom: BaseRom, areaId: number): boolean {
  return baseRom === "BW2" ? areaId >= 2 && areaId < 282 : areaId >= 2 && areaId < 210;
}

function resolveMapReplacement(entries: MapReplaceEntry[], matrixId: number, seasonIndex: number): number | undefined {
  const entry = entries.find((candidate) => candidate.typeIsMatrix && candidate.condition === 0 && candidate.matrixId === matrixId);
  return entry?.replacements[seasonIndex];
}

function resolveChunkReplacement(entries: MapReplaceEntry[], matrixId: number, chunkId: number, seasonIndex: number): number | undefined {
  const entry = entries.find(
    (candidate) => !candidate.typeIsMatrix && candidate.condition === 0 && candidate.matrixId === matrixId && candidate.replacements[0] === chunkId,
  );
  return entry?.replacements[seasonIndex];
}

export function readNitroResources(data: Uint8Array): NitroResources {
  const stamp = readAscii(data, 0, 4);
  if (!["BMD0", "BTX0"].includes(stamp)) throw new Error(`Unsupported Nitro container ${stamp}`);
  if (readU16(data, 4) !== 0xfeff) throw new Error("Unsupported Nitro byte order");
  const sectionCount = readU16(data, 14);
  const resources: NitroResources = { models: [], textures: [], palettes: [] };
  for (let i = 0; i < sectionCount; i += 1) {
    const sectionOffset = readU32(data, 16 + i * 4);
    const sectionStamp = readAscii(data, sectionOffset, 4);
    if (sectionStamp === "MDL0") resources.models.push(...readMdl0(data, sectionOffset));
    if (sectionStamp === "TEX0") {
      const tex = readTex0(data, sectionOffset);
      resources.textures.push(...tex.textures);
      resources.palettes.push(...tex.palettes);
    }
  }
  return resources;
}

export function firstNitroModelScale(resources: NitroResources): number {
  const scale = resources.models[0]?.upScale;
  return scale && Number.isFinite(scale) ? scale : 1;
}

async function loadArchives(baseRom: BaseRom): Promise<LazyArchives> {
  const bytes = await loadActiveRomBytes();
  if (!bytes) throw new Error("Reload the ROM before opening Maps 3D");
  const rom = new NintendoDSRom(bytes);
  return {
    baseRom,
    matrix: new NARC(rom.getFileByName(MATRIX_PATH)),
    chunks: new NARC(rom.getFileByName(MAP_CHUNKS_PATH)),
    mapReplace: firstFile(new NARC(rom.getFileByName(MAP_REPLACE_PATH))) ?? new Uint8Array(),
    areaTable: rom.getFileByName(AREA_TABLE_PATH),
    textures: new NARC(rom.getFileByName(MAP_TEXTURES_PATH)),
    npcRegistry: firstFile(new NARC(rom.getFileByName(baseRom === "BW2" ? MMODEL_INDEX_BW2_PATH : MMODEL_INDEX_BW_PATH))) ?? new Uint8Array(),
    moveModelResources: new NARC(rom.getFileByName(baseRom === "BW2" ? MMODEL_RES_BW2_PATH : MMODEL_RES_BW_PATH)),
    entities: new NARC(rom.getFileByName(baseRom === "BW2" ? ZONE_ENTITIES_BW2_PATH : ZONE_ENTITIES_BW_PATH)),
    buildingTexExt: new NARC(rom.getFileByName(baseRom === "BW2" ? BMODEL_TEX_EXT_BW2_PATH : BMODEL_TEX_EXT_BW_PATH)),
    buildingTexInt: new NARC(rom.getFileByName(baseRom === "BW2" ? BMODEL_TEX_INT_BW2_PATH : BMODEL_TEX_INT_BW_PATH)),
    buildingBundleExt: new NARC(rom.getFileByName(baseRom === "BW2" ? BMODEL_BUNDLE_EXT_BW2_PATH : BMODEL_BUNDLE_EXT_BW_PATH)),
    buildingBundleInt: new NARC(rom.getFileByName(baseRom === "BW2" ? BMODEL_BUNDLE_INT_BW2_PATH : BMODEL_BUNDLE_INT_BW_PATH)),
  };
}

function firstFile(narc: NARC): Uint8Array | undefined {
  return narc.files[0];
}

function getHeaderRow(project: ProjectState, zoneId: number): HeaderRow {
  if (!project.headers) project.headers = parseHeaders(project);
  const row = Object.values(project.headers.rows).find((candidate) => Number(candidate.index) === zoneId);
  if (!row) throw new Error(`Zone ${zoneId} is missing`);
  return row;
}

function applyAreaEdit(project: ProjectState, areaId: number, area: Map3dAreaMetadata): Map3dAreaMetadata {
  return project.map3dAreaEdits?.[String(areaId)] ?? area;
}

function clampInt(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}

function zoneLabel(row: HeaderRow): string {
  return `Zone ${row.index}: ${String(row.location_name ?? "Unknown Location")} (Matrix ${row.matrix_id})`;
}

function combineResources(model: NitroResources, textures: NitroResources): NitroResources {
  return {
    models: model.models,
    textures: [...model.textures, ...textures.textures],
    palettes: [...model.palettes, ...textures.palettes],
  };
}

function loadBuildingsForZone(
  archives: LazyArchives,
  area: AreaHeader3d,
  areaId: number,
  chunks: Map3dChunk[],
  chunkContainers: Map<number, Uint8Array[]>,
  warnings: string[],
): Map3dBuilding[] {
  const buildingNarc = area.isExterior ? archives.buildingBundleExt : archives.buildingBundleInt;
  const textureNarc = area.isExterior ? archives.buildingTexExt : archives.buildingTexInt;
  const buildingsId = resolveBuildingsId(archives.baseRom, areaId, area);
  const bundleBytes = buildingNarc.files[buildingsId];
  if (!bundleBytes) return [];

  let textureResources: NitroResources = { models: [], textures: [], palettes: [] };
  const textureBytes = textureNarc.files[buildingsId];
  if (textureBytes) {
    try {
      textureResources = readNitroResources(textureBytes);
    } catch (error) {
      warnings.push(`Building texture pack ${buildingsId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const resourcesByUid = new Map<number, BuildingResource>();
  try {
    const bundle = extractGameFreakContainer(bundleBytes);
    const count = Math.floor(bundle.files.length / 2);
    for (let index = 0; index < count; index += 1) {
      const meta = bundle.files[index];
      const modelBytes = bundle.files[index + count];
      if (!meta || !modelBytes || readAscii(modelBytes, 0, 4) !== "BMD0") continue;
      const uid = readU16(meta, 0);
      try {
        const modelResources = readNitroResources(modelBytes);
        resourcesByUid.set(uid, {
          uid,
          primitives: buildModelPrimitives(combineResources(modelResources, textureResources), warnings),
        });
      } catch (error) {
        warnings.push(`Building ${uid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    warnings.push(`Building bundle ${buildingsId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  const buildings: Map3dBuilding[] = [];
  for (const chunk of chunks) {
    const chunkFiles = chunkContainers.get(chunk.chunkId);
    const placementsBytes = chunkFiles?.[2] ?? chunkFiles?.at(-1);
    if (!placementsBytes) continue;
    for (const placement of parseChunkBuildings(placementsBytes, warnings, chunk.chunkId)) {
      const resource = resourcesByUid.get(placement.modelUid);
      if (!resource) {
        warnings.push(`Chunk ${chunk.chunkId} references missing building ${placement.modelUid}`);
        continue;
      }
      buildings.push({
        uid: placement.modelUid,
        sourceChunkId: chunk.sourceChunkId,
        chunkId: chunk.chunkId,
        worldX: chunk.worldX + placement.x,
        worldY: placement.y,
        worldZ: chunk.worldZ - placement.z,
        rotationY: placement.rotationY,
        primitives: resource.primitives,
      });
    }
  }
  return buildings;
}

function resolveBuildingsId(baseRom: BaseRom, areaId: number, area: AreaHeader3d): number {
  if (baseRom === "BW2") return area.buildingsId;
  if (areaId >= 210) return areaId - 210;
  if (areaId >= 2) return Math.floor((areaId - 2) / 4);
  return 0;
}

export function parseChunkBuildings(data: Uint8Array, warnings: string[], chunkId: number): ChunkBuildingPlacement[] {
  if (data.length < 4) return [];
  const count = readU32(data, 0);
  const needed = 4 + count * 16;
  if (needed > data.length) {
    warnings.push(`Chunk ${chunkId} building list is truncated`);
    return [];
  }
  return Array.from({ length: count }, (_value, index) => {
    const offset = 4 + index * 16;
    return {
      x: readFx32(data, offset),
      y: readFx32(data, offset + 4),
      z: readFx32(data, offset + 8),
      rotationY: (readU16(data, offset + 12) * 360) / 65536,
      modelUid: readU16Be(data, offset + 14),
    };
  });
}

function loadEntityData(archives: LazyArchives, row: HeaderRow, warnings: string[]): ParsedZoneEntityData {
  const overworldId = Number(row.overworlds_id ?? row.map_id ?? 0);
  const bytes = archives.entities.files[overworldId];
  if (!bytes) return { overlays: [], npcs: [] };
  try {
    return parseZoneEntityData(bytes, warnings);
  } catch (error) {
    warnings.push(`Overworld ${overworldId}: ${error instanceof Error ? error.message : String(error)}`);
    return { overlays: [], npcs: [] };
  }
}

export function parseZoneEntities(data: Uint8Array, warnings: string[] = []): Map3dEntityOverlay[] {
  return parseZoneEntityData(data, warnings).overlays;
}

function parseZoneEntityData(data: Uint8Array, warnings: string[] = []): ParsedZoneEntityData {
  if (data.length < ENTITY_HEADER_BYTES) throw new Error("Zone entity file is too small");
  const furnitureCount = data[4] ?? 0;
  const npcCount = data[5] ?? 0;
  const warpCount = data[6] ?? 0;
  const triggerCount = data[7] ?? 0;
  let offset = ENTITY_HEADER_BYTES;
  const overlays: Map3dEntityOverlay[] = [];
  const npcs: ParsedNpcEntity[] = [];

  for (let index = 0; index < furnitureCount && offset + FURNITURE_BYTES <= data.length; index += 1, offset += FURNITURE_BYTES) {
    const isRail = readU16(data, offset + 6) !== 0;
    if (isRail) {
      warnings.push(`Furniture ${index} uses rail placement`);
      continue;
    }
    const gridX = readS32(data, offset + 8);
    const gridZ = readS32(data, offset + 12);
    overlays.push({
      kind: "furniture",
      id: index,
      label: `Furniture ${index} / Script ${readU16(data, offset)}`,
      x: tileToWorldNonCentered(gridX),
      y: readS32(data, offset + 16),
      z: tileToWorldNonCentered(gridZ),
      width: TILE_REAL_SIZE,
      height: 10,
      depth: TILE_REAL_SIZE,
      centered: false,
    });
  }

  for (let index = 0; index < npcCount && offset + NPC_BYTES <= data.length; index += 1, offset += NPC_BYTES) {
    const uid = readU16(data, offset);
    const isRail = readU32(data, offset + 24) !== 0;
    if (isRail) {
      warnings.push(`NPC ${uid} uses rail placement`);
      continue;
    }
    const gridX = readU16(data, offset + 28);
    const gridZ = readU16(data, offset + 30);
    const x = tileToWorldCentered(gridX);
    const y = readFx32(data, offset + 32);
    const z = tileToWorldCentered(gridZ);
    const objCode = readU16(data, offset + 2);
    const script = readU16(data, offset + 10);
    const faceDirection = readU16(data, offset + 12);
    const movement: Map3dNpcMovement = {
      moveCode: readU16(data, offset + 4),
      movementModifier: readU16(data, offset + 6),
      sightRange: readU16(data, offset + 14),
      modifierStepCount: readU16(data, offset + 16),
      modifierParameter2: readU16(data, offset + 18),
      horizontalLeash: readS16(data, offset + 20),
      verticalLeash: readS16(data, offset + 22),
      initialDirection: faceDirection,
    };
    npcs.push({ uid, objCode, script, faceDirection, movement, x, y, z });
    overlays.push({
      kind: "npc",
      id: uid,
      label: `NPC ${uid} / Obj ${objCode} / Script ${script}`,
      x,
      y,
      z,
      width: Math.max(1, readS16(data, offset + 20)) * TILE_REAL_SIZE,
      height: TILE_REAL_SIZE * 2,
      depth: Math.max(1, readS16(data, offset + 22)) * TILE_REAL_SIZE,
      centered: true,
    });
  }

  for (let index = 0; index < warpCount && offset + WARP_BYTES <= data.length; index += 1, offset += WARP_BYTES) {
    const isRail = readU16(data, offset + 6) === 1;
    if (isRail) {
      warnings.push(`Warp ${index} uses rail placement`);
      continue;
    }
    const x = readS16(data, offset + 8);
    const y = readS16(data, offset + 10);
    const z = readS16(data, offset + 12);
    overlays.push({
      kind: "warp",
      id: index,
      label: `Warp ${index} -> Zone ${readU16(data, offset)} #${readU16(data, offset + 2)}`,
      x: x - TILE_REAL_SIZE / 2,
      y,
      z: z - TILE_REAL_SIZE / 2,
      width: Math.max(1, readS16(data, offset + 14)) * TILE_REAL_SIZE,
      height: TILE_REAL_SIZE * 2,
      depth: Math.max(1, readS16(data, offset + 16)) * TILE_REAL_SIZE,
      centered: false,
    });
  }

  for (let index = 0; index < triggerCount && offset + TRIGGER_BYTES <= data.length; index += 1, offset += TRIGGER_BYTES) {
    const isRail = readS16(data, offset + 8) !== 0;
    if (isRail) {
      warnings.push(`Trigger ${index} uses rail placement`);
      continue;
    }
    const gridX = readS16(data, offset + 10);
    const gridZ = readS16(data, offset + 12);
    overlays.push({
      kind: "trigger",
      id: index,
      label: `Trigger ${index} / Script ${readU16(data, offset)}`,
      x: tileToWorldNonCentered(gridX),
      y: readS16(data, offset + 18),
      z: tileToWorldNonCentered(gridZ),
      width: Math.max(1, readU16(data, offset + 14)) * TILE_REAL_SIZE,
      height: TILE_REAL_SIZE * 2,
      depth: Math.max(1, readU16(data, offset + 16)) * TILE_REAL_SIZE,
      centered: false,
    });
  }

  return { overlays, npcs };
}

function loadNpcModels(archives: LazyArchives, npcs: ParsedNpcEntity[], warnings: string[]): Map3dNpcModel[] {
  if (npcs.length === 0) return [];
  const registry = parseNpcRegistry(archives.npcRegistry);
  const primitiveCache = new Map<string, NpcModelResource>();
  const out: Map3dNpcModel[] = [];

  for (const npc of npcs) {
    const normalizedObjCode = normalizeObjCode(archives.baseRom, npc.objCode);
    const entry = registry[normalizedObjCode];
    if (!entry) {
      warnings.push(`NPC ${npc.uid} references unknown objCode ${npc.objCode}`);
      continue;
    }
    const resourceId = entry.resourceIndices[0] ?? -1;
    if (resourceId < 0) continue;
    const resourceKey = `${resourceId}:${entry.spriteControllerType}:${entry.billboardSize}`;
    let cached = primitiveCache.get(resourceKey);
    if (!cached) {
      cached = loadNpcModelResource(archives, entry, resourceId, warnings);
      primitiveCache.set(resourceKey, cached);
    }
    const primitives = cached.modelType === "sprite" && cached.spriteFrames ? buildNpcSpritePrimitive(cached.spriteFrames, npc.faceDirection) : cached.primitives;
    out.push({
      uid: npc.uid,
      objCode: npc.objCode,
      resourceId,
      modelType: cached.modelType,
      x: npc.x + entry.wPosOffX,
      y: npc.y + entry.wPosOffY,
      z: npc.z + entry.wPosOffZ,
      rotationY: npcModelRotationY(npc.faceDirection),
      movement: npc.movement,
      spriteFrames: cached.spriteFrames,
      primitives,
    });
  }

  return out;
}

export function parseNpcRegistry(data: Uint8Array): NpcRegistryEntry[] {
  if (data.length < 4) return [];
  const count = readU32(data, 0);
  if (4 + count * NPC_REGISTRY_ENTRY_BYTES > data.length) throw new Error("NPC registry is truncated");
  return Array.from({ length: count }, (_value, index) => {
    const offset = 4 + index * NPC_REGISTRY_ENTRY_BYTES;
    return {
      uid: readU16(data, offset),
      billboardSize: data[offset + 7] ?? 0,
      spriteControllerType: data[offset + 9] ?? 0,
      width: data[offset + 11] ?? 1,
      height: data[offset + 12] ?? 1,
      wPosOffX: readS8(data, offset + 13),
      wPosOffY: readS8(data, offset + 14),
      wPosOffZ: readS8(data, offset + 15),
      resourceIndices: Array.from({ length: 5 }, (_resource, resourceIndex) => readU16(data, offset + 16 + resourceIndex * 2)),
    };
  });
}

function loadNpcModelResource(
  archives: LazyArchives,
  entry: NpcRegistryEntry,
  resourceId: number,
  warnings: string[],
): NpcModelResource {
  const bytes = archives.moveModelResources.files[resourceId];
  if (!bytes) {
    warnings.push(`NPC model resource ${resourceId} is missing`);
    return { modelType: "model", primitives: [] };
  }

  try {
    const threshold = archives.baseRom === "BW2" ? SPRITE_MODEL_THRESHOLD_BW2 : SPRITE_MODEL_THRESHOLD_BW;
    if (resourceId < threshold && readAscii(bytes, 0, 4) === "BMD0") {
      return { modelType: "model", primitives: buildModelPrimitives(readNitroResources(bytes), warnings) };
    }
    if (readAscii(bytes, 0, 4) === "BTX0") {
      const spriteFrames = buildNpcSpriteFrames(readNitroResources(bytes), entry, resourceId, warnings);
      return { modelType: "sprite", primitives: spriteFrames ? buildNpcSpritePrimitive(spriteFrames, 2) : [], spriteFrames };
    }
    warnings.push(`NPC model resource ${resourceId} has unsupported stamp ${readAscii(bytes, 0, 4)}`);
  } catch (error) {
    warnings.push(`NPC model resource ${resourceId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { modelType: "model", primitives: [] };
}

function buildNpcSpriteFrames(resources: NitroResources, entry: NpcRegistryEntry, resourceId: number, warnings: string[]): Map3dNpcSpriteFrames | undefined {
  const palette = resources.palettes[0];
  if (resources.textures.length === 0 || (resources.textures.some((texture) => texture.params.requiresPalette()) && !palette)) {
    warnings.push(`NPC sprite ${entry.uid} is missing texture or palette data`);
    return undefined;
  }
  const [width, height] = MMDL_BILLBOARD_SIZES[Math.min(entry.billboardSize, MMDL_BILLBOARD_SIZES.length - 1)] ?? MMDL_BILLBOARD_SIZES[0];
  const frameCount = Math.max(1, npcSpriteFrameCount(entry.spriteControllerType));
  const framesByDirection: Map3dNpcSpriteFrames["framesByDirection"] = {};
  for (const [direction, gameDirection] of Object.entries(NPC_SPRITE_DIRECTION_CODES) as Array<[Map3dNpcSpriteDirection, number]>) {
    const frames: DecodedTexture[] = [];
    for (let frame = 0; frame < frameCount; frame += 1) {
      const texture = resources.textures[npcSpriteTextureIndex(entry.spriteControllerType, gameDirection, frame)] ?? resources.textures[npcSpriteTextureIndex(entry.spriteControllerType, gameDirection, 0)] ?? resources.textures[0];
      const decoded = texture ? decodeTexture(texture, palette) : undefined;
      if (decoded) {
        frames.push({
          ...decoded,
          name: `npc_resource_${resourceId}_${entry.uid}_${direction}_${frame}_${decoded.name}`,
        });
      }
    }
    if (frames.length > 0) framesByDirection[direction] = frames;
  }
  if (Object.keys(framesByDirection).length === 0) return undefined;
  return { width, height, framesByDirection };
}

function buildNpcSpritePrimitive(spriteFrames: Map3dNpcSpriteFrames, faceDirection: number): Map3dPrimitive[] {
  const texture = npcSpriteFrame(spriteFrames, map3dNpcSpriteDirection(faceDirection), 0) ?? firstNpcSpriteFrame(spriteFrames);
  if (!texture) return [];
  const halfWidth = spriteFrames.width / 2;
  return [
    {
      material: { name: `npc_sprite_${texture.name}`, diffuse: [1, 1, 1], alpha: 1, texture },
      positions: new Float32Array([-halfWidth, 0, 0, halfWidth, 0, 0, halfWidth, spriteFrames.height, 0, -halfWidth, spriteFrames.height, 0]),
      uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
  ];
}

function npcSpriteTextureIndex(spriteControllerType: number, faceDirection: number, frame = 0): number {
  const perDirStep = npcSpriteTextureStride(spriteControllerType);
  if (perDirStep <= 0) return 0;
  return Math.max(0, faceDirection) * perDirStep + Math.max(0, Math.min(frame, perDirStep - 1));
}

function npcSpriteFrameCount(spriteControllerType: number): number {
  return Math.max(1, npcSpriteTextureStride(spriteControllerType));
}

function npcSpriteTextureStride(spriteControllerType: number): number {
  return NPC_SPRITE_FRAMES_PER_DIRECTION[spriteControllerType] ?? 0;
}

function npcSpriteFrame(spriteFrames: Map3dNpcSpriteFrames, direction: Map3dNpcSpriteDirection, frame: number): DecodedTexture | undefined {
  const frames = spriteFrames.framesByDirection[direction];
  return frames?.[Math.max(0, Math.min(frame, frames.length - 1))];
}

function firstNpcSpriteFrame(spriteFrames: Map3dNpcSpriteFrames): DecodedTexture | undefined {
  return Object.values(spriteFrames.framesByDirection).find((frames) => frames && frames.length > 0)?.[0];
}

function map3dNpcSpriteDirection(faceDirection: number): Map3dNpcSpriteDirection {
  return ({ 1: "down", 2: "up", 3: "left", 4: "right" } as const)[faceDirection] ?? "up";
}

const NPC_SPRITE_DIRECTION_CODES: Record<Map3dNpcSpriteDirection, number> = {
  down: 1,
  up: 2,
  left: 3,
  right: 4,
};

const NPC_SPRITE_FRAMES_PER_DIRECTION = [0, 3, 2, 3, 0, 1, 3, 0, 0, 0, 4, 0, 4, 2, 2, 2, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 2, 2, 0];

function normalizeObjCode(baseRom: BaseRom, objCode: number): number {
  if (baseRom === "BW2") {
    if (objCode >= 377) {
      if (objCode < 4096 || objCode > 4716) {
        objCode = objCode < 8192 || objCode > 8203 ? 10 : objCode - 7195;
      } else {
        objCode -= 3719;
      }
    }
    return objCode;
  }
  if (objCode >= 223) {
    if (objCode < 4096 || objCode >= 4662) {
      objCode = objCode < 8192 || objCode >= 8202 ? 10 : objCode - 7403;
    } else {
      objCode -= 3873;
    }
  }
  return objCode;
}

function npcModelRotationY(faceDirection: number): number {
  return { 1: 180, 2: 0, 3: -90, 4: 90 }[faceDirection] ?? 0;
}

function readMdl0(data: Uint8Array, sectionOffset: number): NitroModel[] {
  return readInfoBlock(data, sectionOffset + 8, readU32Datum).map((item) => readModel(data, sectionOffset + item.datum));
}

function readModel(data: Uint8Array, offset: number): NitroModel {
  const renderCmdsOff = readU32(data, offset + 4);
  const materialsOff = readU32(data, offset + 8);
  const piecesOff = readU32(data, offset + 12);
  const objectsOffset = offset + 64;
  const modelScale = readFx32(data, offset + 28) || 1;
  return {
    renderOps: parseRenderOps(data, offset + renderCmdsOff),
    pieces: readPieces(data, offset + piecesOff),
    materials: readMaterials(data, offset + materialsOff),
    objects: readObjects(data, objectsOffset, modelScale),
    upScale: modelScale,
    downScale: readFx32(data, offset + 32),
  };
}

function readPieces(data: Uint8Array, offset: number): NitroPiece[] {
  return readInfoBlock(data, offset, readU32Datum).map((item) => {
    const pieceOffset = offset + item.datum;
    const commandsOffset = readU32(data, pieceOffset + 8);
    const commandsLength = readU32(data, pieceOffset + 12);
    return { commands: data.slice(pieceOffset + commandsOffset, pieceOffset + commandsOffset + commandsLength) };
  });
}

function readMaterials(data: Uint8Array, offset: number): NitroMaterial[] {
  const texturePairingOff = readU16(data, offset);
  const palettePairingOff = readU16(data, offset + 2);
  const materials = readInfoBlock(data, offset + 4, readU32Datum).map((item) => readMaterial(data, offset + item.datum, item.name));

  for (const pairing of readInfoBlock(data, offset + texturePairingOff, readPairingDatum)) {
    const materialIds = data.slice(offset + pairing.datum.offset, offset + pairing.datum.offset + pairing.datum.count);
    for (const materialId of materialIds) if (materials[materialId]) materials[materialId].textureName = pairing.name;
  }
  for (const pairing of readInfoBlock(data, offset + palettePairingOff, readPairingDatum)) {
    const materialIds = data.slice(offset + pairing.datum.offset, offset + pairing.datum.offset + pairing.datum.count);
    for (const materialId of materialIds) if (materials[materialId]) materials[materialId].paletteName = pairing.name;
  }
  return materials;
}

function readMaterial(data: Uint8Array, offset: number, name: string): NitroMaterial {
  const sectionSize = readU16(data, offset + 2);
  const difAmb = readU32(data, offset + 4);
  const polygonAttr = readU32(data, offset + 12);
  const texVramOffset = readU16(data, offset + 20);
  const texImageParam = readU16(data, offset + 22);
  const textureTransformMode = (texImageParam >>> 14) & 3;
  const textureParams = new TextureParams((texVramOffset | (texImageParam << 16)) >>> 0);
  let scaleS = 1;
  let scaleT = 1;
  let transS = 0;
  let transT = 0;
  let textureMatrix: number[] | undefined;
  if (textureTransformMode === 1) {
    if (sectionSize >= 52 && offset + 52 <= data.length) {
      scaleS = readFx32(data, offset + 44);
      scaleT = readFx32(data, offset + 48);
    }
    if (sectionSize >= 60 && offset + 58 <= data.length) {
      transS = readS16(data, offset + 54) / 4096;
      transT = readS16(data, offset + 56) / 4096;
    }
  } else if ((textureTransformMode === 2 || textureTransformMode === 3) && sectionSize >= 108 && offset + 108 <= data.length) {
    textureMatrix = Array.from({ length: 16 }, (_value, index) => readFx32(data, offset + 44 + index * 4));
  }
  return {
    name,
    params: textureParams,
    width: readU16(data, offset + 32) || textureParams.width() || 1,
    height: readU16(data, offset + 34) || textureParams.height() || 1,
    diffuse: rgb555(difAmb & 0x7fff),
    defaultVertexColor: ((difAmb >>> 15) & 1) !== 0,
    alpha: ((polygonAttr >>> 16) & 31) / 31,
    repeatS: (texImageParam & 1) !== 0,
    repeatT: ((texImageParam >>> 1) & 1) !== 0,
    flipS: ((texImageParam >>> 2) & 1) !== 0,
    flipT: ((texImageParam >>> 3) & 1) !== 0,
    textureTransformMode,
    scaleS,
    scaleT,
    transS,
    transT,
    textureMatrix,
  };
}

function readObjects(data: Uint8Array, offset: number, modelScale: number): NitroObject[] {
  return readInfoBlock(data, offset, readU32Datum).map((item) => ({ matrix: readObjectMatrix(data, offset + item.datum, modelScale) }));
}

function readObjectMatrix(data: Uint8Array, offset: number, modelScale: number): Mat4 {
  const flags = readU16(data, offset);
  let cursor = offset + 4;
  const hasTranslation = (flags & 1) === 0;
  const hasRotation = (flags & 2) === 0;
  const hasScale = (flags & 4) === 0;
  const pivotRotation = (flags & 8) !== 0;
  let matrix = matIdentity();

  let translation: [number, number, number] | undefined;
  let rotation = matIdentity();
  let scale: [number, number, number] | undefined;

  if (hasTranslation) {
    translation = [readFx32(data, cursor) / modelScale, readFx32(data, cursor + 4) / modelScale, readFx32(data, cursor + 8) / modelScale];
    cursor += 12;
  }
  if (hasRotation) {
    if (pivotRotation) {
      cursor += 4;
    } else {
      const m0 = readFx16(data, offset + 2);
      const values = Array.from({ length: 8 }, (_value, index) => readFx16(data, cursor + index * 2));
      cursor += 16;
      rotation = [m0, values[0], values[1], 0, values[2], values[3], values[4], 0, values[5], values[6], values[7], 0, 0, 0, 0, 1];
    }
  }
  if (hasScale) {
    scale = [readFx32(data, cursor), readFx32(data, cursor + 4), readFx32(data, cursor + 8)];
  }
  if (scale) matrix = matScale(scale[0], scale[1], scale[2]);
  matrix = matMul(rotation, matrix);
  if (translation) matrix = matMul(matTranslate(translation[0], translation[1], translation[2]), matrix);
  return matrix;
}

function readTex0(data: Uint8Array, sectionOffset: number): { textures: NitroTexture[]; palettes: NitroPalette[] } {
  const texBlockLen = readU16(data, sectionOffset + 12) << 3;
  const textureOff = readU16(data, sectionOffset + 14);
  const texBlockOff = readU32(data, sectionOffset + 20);
  const compressed1BlockOff = readU32(data, sectionOffset + 36);
  const compressed2BlockOff = readU32(data, sectionOffset + 40);
  const palBlockLen = readU16(data, sectionOffset + 48) << 3;
  const paletteOff = readU32(data, sectionOffset + 52);
  const palBlockOff = readU32(data, sectionOffset + 56);
  const texBlock = data.slice(sectionOffset + texBlockOff, sectionOffset + texBlockOff + texBlockLen);
  const palBlock = data.slice(sectionOffset + palBlockOff, sectionOffset + palBlockOff + palBlockLen);

  const textures = readInfoBlock(data, sectionOffset + textureOff, readTextureDatum).map((item) => {
    const params = new TextureParams(item.datum.params);
    const offset = params.offset();
    const length = params.byteLength();
    const data1 =
      params.format() === 5
        ? data.slice(sectionOffset + compressed1BlockOff + offset, sectionOffset + compressed1BlockOff + offset + length)
        : texBlock.slice(offset, offset + length);
    const data2 =
      params.format() === 5
        ? data.slice(sectionOffset + compressed2BlockOff + offset / 2, sectionOffset + compressed2BlockOff + offset / 2 + length / 2)
        : new Uint8Array();
    return { name: item.name, params, data1, data2 };
  });
  const palettes = readInfoBlock(data, sectionOffset + paletteOff, readPaletteDatum).map((item) => ({
    name: item.name,
    offset: item.datum.offset,
    block: palBlock,
  }));
  return { textures, palettes };
}

export function buildModelPrimitives(resources: NitroResources, warnings: string[], options: BuildModelOptions = {}): Map3dPrimitive[] {
  const out: Map3dPrimitive[] = [];
  const textureByName = new Map(resources.textures.map((texture) => [texture.name, texture]));
  const paletteByName = new Map(resources.palettes.map((palette) => [palette.name, palette]));
  for (const model of resources.models) {
    const built = buildModel(model, warnings, options);
    for (const primitive of built) {
      if (primitive.vertices.length === 0 || primitive.indices.length === 0) continue;
      const material = model.materials[primitive.materialId] ?? model.materials[0];
      if (isHiddenNitroMaterial(material)) continue;
      const resolvedTexture = material?.textureName ? textureByName.get(material.textureName) : undefined;
      const resolvedPalette = material?.paletteName ? paletteByName.get(material.paletteName) : undefined;
      const texture =
        resolvedTexture && (!resolvedTexture.params.requiresPalette() || resolvedPalette)
          ? decodeTexture(resolvedTexture, resolvedPalette)
          : undefined;
      out.push({
        material: {
          name: material?.name ?? "material",
          diffuse: material?.diffuse ?? [1, 1, 1],
          alpha: material?.alpha ?? 1,
          texture,
          repeatS: material?.repeatS ?? true,
          repeatT: material?.repeatT ?? true,
          flipS: material?.flipS ?? false,
          flipT: material?.flipT ?? false,
        },
        positions: new Float32Array(primitive.vertices.flatMap((vertex) => vertex.position)),
        uvs: primitive.usedTexcoords ? new Float32Array(primitive.vertices.flatMap((vertex) => vertex.uv)) : undefined,
        colors: primitive.usedColors ? new Float32Array(primitive.vertices.flatMap((vertex) => vertex.color)) : undefined,
        normals: primitive.usedNormals ? new Float32Array(primitive.vertices.flatMap((vertex) => vertex.normal)) : undefined,
        indices: new Uint16Array(primitive.indices),
      });
    }
  }
  return out;
}

function isHiddenNitroMaterial(material: NitroMaterial | undefined): boolean {
  const name = material?.name?.toLowerCase() ?? "";
  const texture = material?.textureName?.toLowerCase() ?? "";
  return name.includes("h_kage") || texture.includes("h_kage");
}

function buildModel(model: NitroModel, warnings: string[], options: BuildModelOptions): BuildPrimitive[] {
  const gpu = {
    matrix: matIdentity(),
    stack: Array.from({ length: 32 }, () => matIdentity()),
    material: 0,
  };
  const primitives: BuildPrimitive[] = [];
  const drawnPieces = new Set<number>();
  for (const op of model.renderOps) {
    if (op.kind === "load") gpu.matrix = gpu.stack[op.stack] ?? matIdentity();
    else if (op.kind === "store") gpu.stack[op.stack] = gpu.matrix;
    else if (op.kind === "mulObject") gpu.matrix = matMul(gpu.matrix, model.objects[op.object]?.matrix ?? matIdentity());
    else if (op.kind === "scaleUp") gpu.matrix = matMul(gpu.matrix, matScale(model.upScale, model.upScale, model.upScale));
    else if (op.kind === "scaleDown") gpu.matrix = matMul(gpu.matrix, matScale(model.downScale, model.downScale, model.downScale));
    else if (op.kind === "bindMaterial") gpu.material = op.material;
    else if (op.kind === "draw") {
      const piece = model.pieces[op.piece];
      if (!piece) continue;
      const primitive = runGpuCommands(piece.commands, gpu.matrix, gpu.stack, model.materials[gpu.material], gpu.material, model.upScale || 1, warnings);
      primitives.push(primitive);
      if (primitive.vertices.length > 0 && primitive.indices.length > 0) drawnPieces.add(op.piece);
    }
  }
  if (!primitives.some((primitive) => primitive.vertices.length > 0 && primitive.indices.length > 0) && model.pieces.length > 0) {
    warnings.push("Model render ops produced no geometry; drawing all polygons once.");
    model.pieces.forEach((piece, pieceIndex) => {
      primitives.push(drawUnreferencedPiece(model, piece, pieceIndex, gpu.stack, warnings));
    });
  } else if (options.recoverSkippedPieces && drawnPieces.size < model.pieces.length) {
    const missingPieces = model.pieces.map((_piece, pieceIndex) => pieceIndex).filter((pieceIndex) => !drawnPieces.has(pieceIndex));
    if (missingPieces.length > 0) {
      warnings.push(`Model render ops skipped ${missingPieces.length} polygon piece${missingPieces.length === 1 ? "" : "s"}; drawing unmatched pieces once.`);
      for (const pieceIndex of missingPieces) primitives.push(drawUnreferencedPiece(model, model.pieces[pieceIndex], pieceIndex, gpu.stack, warnings));
    }
  }
  return primitives;
}

function drawUnreferencedPiece(model: NitroModel, piece: NitroPiece | undefined, pieceIndex: number, matrixStack: Mat4[], warnings: string[]): BuildPrimitive {
  const materialId = Math.min(pieceIndex, Math.max(0, model.materials.length - 1));
  return runGpuCommands(piece?.commands ?? new Uint8Array(), matIdentity(), matrixStack, model.materials[materialId], materialId, model.upScale || 1, warnings);
}

function runGpuCommands(
  commands: Uint8Array,
  matrix: Mat4,
  matrixStack: Mat4[],
  material: NitroMaterial | undefined,
  materialId: number,
  modelScale: number,
  warnings: string[],
): BuildPrimitive {
  const primitive: BuildPrimitive = { materialId, usedTexcoords: false, usedColors: false, usedNormals: false, vertices: [], indices: [] };
  let currentMatrix = matrix;
  let opcodeCursor: number[] = [];
  let offset = 0;
  let primType = 0;
  let primStart = 0;
  let lastPosition: [number, number, number] = [0, 0, 0];
  let nextVertex: Vertex = {
    position: [0, 0, 0],
    uv: [0, 0],
    color: material?.defaultVertexColor ? material.diffuse : [1, 1, 1],
    normal: [0, 0, 0],
  };

  const endPrim = () => {
    if (primType === 0) {
      for (let i = primStart; i + 2 < primitive.vertices.length; i += 3) primitive.indices.push(i, i + 1, i + 2);
    } else if (primType === 1) {
      for (let i = primStart; i + 3 < primitive.vertices.length; i += 4) primitive.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    } else if (primType === 2) {
      for (let i = primStart, odd = false; i + 2 < primitive.vertices.length; i += 1, odd = !odd) {
        primitive.indices.push(i, odd ? i + 2 : i + 1, odd ? i + 1 : i + 2);
      }
    } else if (primType === 3) {
      for (let i = primStart; i + 3 < primitive.vertices.length; i += 2) primitive.indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
    primStart = primitive.vertices.length;
  };

  while (offset < commands.length) {
    if (opcodeCursor.length === 0) {
      opcodeCursor = [commands[offset] ?? 0, commands[offset + 1] ?? 0, commands[offset + 2] ?? 0, commands[offset + 3] ?? 0];
      offset += 4;
    }
    const opcode = opcodeCursor.shift() ?? 0;
    const paramCount = GPU_PARAM_COUNTS[opcode];
    if (paramCount === undefined) {
      warnings.push(`Unsupported GPU opcode 0x${opcode.toString(16)}`);
      break;
    }
    const params = Array.from({ length: paramCount }, (_value, index) => readU32(commands, offset + index * 4));
    offset += paramCount * 4;

    if (opcode === 0 || opcode === 0x41) {
      if (opcode === 0x41) endPrim();
      continue;
    }
    if (opcode === 0x40) {
      endPrim();
      primType = params[0] & 3;
      primStart = primitive.vertices.length;
    } else if (opcode === 0x22) {
      primitive.usedTexcoords = true;
      nextVertex = { ...nextVertex, uv: materialUv(material, params[0]) };
    } else if (opcode === 0x20) {
      primitive.usedColors = true;
      nextVertex = { ...nextVertex, color: rgb555(params[0] & 0x7fff) };
    } else if (opcode === 0x21) {
      primitive.usedNormals = true;
      nextVertex = {
        ...nextVertex,
        normal: [
          readPackedFx32(params[0], 0, 10, 1, 0, 9),
          readPackedFx32(params[0], 10, 20, 1, 0, 9),
          readPackedFx32(params[0], 20, 30, 1, 0, 9),
        ],
      };
    } else if (opcode >= 0x23 && opcode <= 0x28) {
      const position = gpuPosition(opcode, params, lastPosition);
      lastPosition = position;
      primitive.vertices.push({ ...nextVertex, position: transformPoint(currentMatrix, position) });
    } else if (opcode === 0x13) {
      matrixStack[params[0] & 0x1f] = currentMatrix;
    } else if (opcode === 0x14) {
      currentMatrix = matrixStack[params[0] & 0x1f] ?? matIdentity();
    } else if (opcode === 0x15) {
      currentMatrix = matIdentity();
    } else if (opcode === 0x16) {
      currentMatrix = gpuMatrixFromParams(params, 4, 4);
    } else if (opcode === 0x17) {
      currentMatrix = gpuMatrixFromParams(params, 4, 3);
    } else if (opcode === 0x18) {
      currentMatrix = matMul(currentMatrix, gpuMatrixFromParams(params, 4, 4));
    } else if (opcode === 0x19) {
      currentMatrix = matMul(currentMatrix, gpuMatrixFromParams(params, 4, 3));
    } else if (opcode === 0x1a) {
      currentMatrix = matMul(currentMatrix, gpuMatrixFromParams(params, 3, 3));
    } else if (opcode === 0x1b) {
      currentMatrix = matMul(currentMatrix, matScale(readFxParam(params[0]) / modelScale, readFxParam(params[1]) / modelScale, readFxParam(params[2]) / modelScale));
    } else if (opcode === 0x1c) {
      currentMatrix = matMul(currentMatrix, matTranslate(readFxParam(params[0]) / modelScale, readFxParam(params[1]) / modelScale, readFxParam(params[2]) / modelScale));
    } else if (!IGNORED_GPU_OPCODES.has(opcode)) {
      warnings.push(`Ignored GPU opcode 0x${opcode.toString(16)}`);
    }
  }
  endPrim();
  return primitive;
}

function gpuMatrixFromParams(params: number[], columns: number, rows: number): Mat4 {
  const matrix = matIdentity();
  let index = 0;
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      matrix[row * 4 + column] = readFxParam(params[index++] ?? 0);
    }
  }
  return matrix;
}

function materialUv(material: NitroMaterial | undefined, packed: number): [number, number] {
  const width = material?.width || 1;
  const height = material?.height || 1;
  const rawS = readPackedFx16(packed, 0, 16, 1, 11, 4);
  const rawT = readPackedFx16(packed, 16, 32, 1, 11, 4);
  let u = rawS / width / (material?.flipS ? 2 : 1);
  let v = rawT / height / (material?.flipT ? 2 : 1);
  if (material?.textureMatrix) {
    const m = material.textureMatrix;
    const nextU = u * (m[0] ?? 1) + v * (m[4] ?? 0) + (m[12] ?? 0);
    const nextV = u * (m[1] ?? 0) + v * (m[5] ?? 1) + (m[13] ?? 0);
    u = nextU;
    v = nextV;
  } else if (material && material.textureTransformMode === 1) {
    u = u * material.scaleS + material.transS;
    v = v * material.scaleT + material.transT;
  }
  return [u, v];
}

function gpuPosition(opcode: number, params: number[], last: [number, number, number]): [number, number, number] {
  if (opcode === 0x23) return [readPackedFx16(params[0], 0, 16, 1, 3, 12), readPackedFx16(params[0], 16, 32, 1, 3, 12), readPackedFx16(params[1], 0, 16, 1, 3, 12)];
  if (opcode === 0x24) return [readPackedFx16(params[0], 0, 10, 1, 3, 6), readPackedFx16(params[0], 10, 20, 1, 3, 6), readPackedFx16(params[0], 20, 30, 1, 3, 6)];
  if (opcode === 0x25) return [readPackedFx16(params[0], 0, 16, 1, 3, 12), readPackedFx16(params[0], 16, 32, 1, 3, 12), last[2]];
  if (opcode === 0x26) return [readPackedFx16(params[0], 0, 16, 1, 3, 12), last[1], readPackedFx16(params[0], 16, 32, 1, 3, 12)];
  if (opcode === 0x27) return [last[0], readPackedFx16(params[0], 0, 16, 1, 3, 12), readPackedFx16(params[0], 16, 32, 1, 3, 12)];
  return [
    last[0] + readPackedFx16(params[0], 0, 10, 1, 0, 9) / 8,
    last[1] + readPackedFx16(params[0], 10, 20, 1, 0, 9) / 8,
    last[2] + readPackedFx16(params[0], 20, 30, 1, 0, 9) / 8,
  ];
}

export function parseNitroRenderOpsForTest(data: Uint8Array, offset = 0): RenderOp[] {
  return parseRenderOps(data, offset);
}

function parseRenderOps(data: Uint8Array, offset: number): RenderOp[] {
  const ops: RenderOp[] = [];
  let cursor = offset;
  while (cursor < data.length) {
    const opcode = data[cursor++] ?? 1;
    if (opcode === 1) break;
    const paramLength = renderParamLength(opcode, data, cursor);
    const params = data.slice(cursor, cursor + paramLength);
    cursor += paramLength;
    if (opcode === 0x03) ops.push({ kind: "load", stack: params[0] ?? 0 });
    else if ([0x04, 0x24, 0x44].includes(opcode)) ops.push({ kind: "bindMaterial", material: params[0] ?? 0 });
    else if (opcode === 0x05) ops.push({ kind: "draw", piece: params[0] ?? 0 });
    else if ([0x06, 0x26, 0x46, 0x66].includes(opcode)) {
      if (opcode === 0x46 || opcode === 0x66) ops.push({ kind: "load", stack: params[3] ?? 0 });
      ops.push({ kind: "mulObject", object: params[0] ?? 0 });
      if (opcode === 0x26 || opcode === 0x66) ops.push({ kind: "store", stack: params[3] ?? 0 });
    } else if (opcode === 0x0b) ops.push({ kind: "scaleUp" });
    else if (opcode === 0x2b) ops.push({ kind: "scaleDown" });
  }
  return ops;
}

function renderParamLength(opcode: number, data: Uint8Array, cursor: number): number {
  if (opcode === 0x09) return 2 + 3 * (data[cursor + 1] ?? 0);
  return (
    {
      0x00: 0,
      0x02: 2,
      0x03: 1,
      0x04: 1,
      0x05: 1,
      0x06: 3,
      0x07: 1,
      0x08: 1,
      0x0b: 0,
      0x0c: 1,
      0x0d: 2,
      0x24: 1,
      0x26: 4,
      0x2b: 0,
      0x40: 0,
      0x44: 1,
      0x46: 4,
      0x47: 2,
      0x66: 5,
      0x80: 0,
    }[opcode] ?? 0
  );
}

function decodeTexture(texture: NitroTexture, palette?: NitroPalette): DecodedTexture | undefined {
  const width = texture.params.width();
  const height = texture.params.height();
  const rgba = new Uint8Array(width * height * 4);
  const palBlock = palette?.block;
  const palOffset = palette?.offset ?? 0;
  const pixel = (index: number, color: [number, number, number, number]) => rgba.set(color, index * 4);
  const pal = (index: number) => (palBlock ? readU16(palBlock, palOffset + index * 2) : 0);

  if (texture.params.requiresPalette() && !palette) return undefined;
  const format = texture.params.format();
  if (format === 1 || format === 6) {
    for (let i = 0; i < width * height; i += 1) {
      const value = texture.data1[i] ?? 0;
      const colorIndex = format === 1 ? value & 0x1f : value & 0x07;
      const alpha = format === 1 ? a3ToA8(value >>> 5) : extend5To8(value >>> 3);
      pixel(i, rgb555a8(pal(colorIndex), alpha));
    }
  } else if (format === 2) {
    for (let i = 0, p = 0; i < texture.data1.length; i += 1) {
      const value = texture.data1[i] ?? 0;
      for (const shift of [0, 2, 4, 6]) {
        const colorIndex = (value >>> shift) & 3;
        pixel(p++, rgb555a8(pal(colorIndex), colorIndex === 0 && texture.params.color0Transparent() ? 0 : 255));
      }
    }
  } else if (format === 3) {
    for (let i = 0, p = 0; i < texture.data1.length; i += 1) {
      const value = texture.data1[i] ?? 0;
      for (const shift of [0, 4]) {
        const colorIndex = (value >>> shift) & 15;
        pixel(p++, rgb555a8(pal(colorIndex), colorIndex === 0 && texture.params.color0Transparent() ? 0 : 255));
      }
    }
  } else if (format === 4) {
    for (let i = 0; i < width * height; i += 1) {
      const colorIndex = texture.data1[i] ?? 0;
      pixel(i, rgb555a8(pal(colorIndex), colorIndex === 0 && texture.params.color0Transparent() ? 0 : 255));
    }
  } else if (format === 5) {
    const blocksX = width / 4;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const blockIndex = blocksX * Math.floor(y / 4) + Math.floor(x / 4);
        const block = readU32(texture.data1, blockIndex * 4);
        const extra = readU16(texture.data2, blockIndex * 2);
        const texelOffset = 2 * (4 * (y % 4) + (x % 4));
        const texel = (block >>> texelOffset) & 3;
        const mode = extra >>> 14;
        const palAddress = (extra & 0x3fff) << 1;
        const color = (n: number) => rgb555a8(pal(palAddress + n), 255);
        const transparent: [number, number, number, number] = [0, 0, 0, 0];
        const c0 = color(0);
        const c1 = color(1);
        const c2 = color(2);
        const c3 = color(3);
        const value =
          mode === 0
            ? [c0, c1, c2, transparent][texel]
            : mode === 1
              ? [c0, c1, avgColor(c0, c1), transparent][texel]
              : mode === 2
                ? [c0, c1, c2, c3][texel]
                : [c0, c1, avgColor(c1, c0, 3, 5), avgColor(c0, c1, 3, 5)][texel];
        pixel(y * width + x, value);
      }
    }
  } else if (format === 7) {
    for (let i = 0; i < width * height; i += 1) {
      const value = readU16(texture.data1, i * 2);
      pixel(i, rgb555a8(value, value & 0x8000 ? 255 : 0));
    }
  } else {
    return undefined;
  }
  return { name: texture.name, width, height, rgba };
}

function avgColor(a: [number, number, number, number], b: [number, number, number, number], aw = 1, bw = 1): [number, number, number, number] {
  const total = aw + bw;
  return [
    Math.floor((a[0] * aw + b[0] * bw) / total),
    Math.floor((a[1] * aw + b[1] * bw) / total),
    Math.floor((a[2] * aw + b[2] * bw) / total),
    Math.floor((a[3] * aw + b[3] * bw) / total),
  ];
}

class TextureParams {
  constructor(private readonly value: number) {}
  offset(): number {
    return (this.value & 0xffff) << 3;
  }
  width(): number {
    return 8 << ((this.value >>> 20) & 7);
  }
  height(): number {
    return 8 << ((this.value >>> 23) & 7);
  }
  format(): number {
    return (this.value >>> 26) & 7;
  }
  color0Transparent(): boolean {
    return ((this.value >>> 29) & 1) !== 0;
  }
  requiresPalette(): boolean {
    return [1, 2, 3, 4, 5, 6].includes(this.format());
  }
  byteLength(): number {
    return (this.width() * this.height() * TEXTURE_BPP[this.format()]) / 8;
  }
}

const TEXTURE_BPP = [0, 8, 2, 4, 8, 2, 8, 16];
const IGNORED_GPU_OPCODES = new Set([0x10, 0x11, 0x12, 0x29, 0x2a, 0x2b, 0x30, 0x31, 0x32, 0x33, 0x34, 0x50, 0x60, 0x70, 0x71, 0x72]);
const GPU_PARAM_COUNTS: Record<number, number> = {
  0x00: 0,
  0x10: 1,
  0x11: 0,
  0x12: 1,
  0x13: 1,
  0x14: 1,
  0x15: 0,
  0x16: 16,
  0x17: 12,
  0x18: 16,
  0x19: 12,
  0x1a: 9,
  0x1b: 3,
  0x1c: 3,
  0x20: 1,
  0x21: 1,
  0x22: 1,
  0x23: 2,
  0x24: 1,
  0x25: 1,
  0x26: 1,
  0x27: 1,
  0x28: 1,
  0x29: 1,
  0x2a: 1,
  0x2b: 1,
  0x30: 1,
  0x31: 1,
  0x32: 1,
  0x33: 1,
  0x34: 32,
  0x40: 1,
  0x41: 0,
  0x50: 1,
  0x60: 1,
  0x70: 3,
  0x71: 2,
  0x72: 1,
};

function readInfoBlock<T>(data: Uint8Array, offset: number, readDatum: (data: Uint8Array, offset: number) => T): InfoBlockItem<T>[] {
  const count = data[offset + 1] ?? 0;
  const datumSize = readU16(data, offset + 12 + count * 4);
  const dataOffset = offset + 16 + count * 4;
  const namesOffset = dataOffset + count * datumSize;
  return Array.from({ length: count }, (_value, index) => ({
    datum: readDatum(data, dataOffset + index * datumSize),
    name: readName(data, namesOffset + index * 16),
  }));
}

function readU32Datum(data: Uint8Array, offset: number): number {
  return readU32(data, offset);
}

function readPairingDatum(data: Uint8Array, offset: number): { offset: number; count: number } {
  return { offset: readU16(data, offset), count: data[offset + 2] ?? 0 };
}

function readTextureDatum(data: Uint8Array, offset: number): { params: number } {
  return { params: readU32(data, offset) };
}

function readPaletteDatum(data: Uint8Array, offset: number): { offset: number } {
  return { offset: readU16(data, offset) << 3 };
}

function readName(data: Uint8Array, offset: number): string {
  return readAscii(data, offset, 16).replace(/\0+$/u, "");
}

function readS32(data: Uint8Array, offset: number): number {
  return readU32(data, offset) | 0;
}

function readS16(data: Uint8Array, offset: number): number {
  return signExtend(readU16(data, offset), 16);
}

function readU16Be(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readS8(data: Uint8Array, offset: number): number {
  return signExtend(data[offset] ?? 0, 8);
}

function readFx16(data: Uint8Array, offset: number): number {
  return signExtend(readU16(data, offset), 16) / 4096;
}

function readFx32(data: Uint8Array, offset: number): number {
  return readS32(data, offset) / 4096;
}

function readFxParam(value: number): number {
  return (value | 0) / 4096;
}

function readPackedFx16(value: number, lo: number, hi: number, signBits: number, intBits: number, fracBits: number): number {
  return fixed((value >>> lo) & ((1 << (hi - lo)) - 1), signBits + intBits + fracBits, fracBits);
}

function readPackedFx32(value: number, lo: number, hi: number, signBits: number, intBits: number, fracBits: number): number {
  return fixed((value >>> lo) & ((1 << (hi - lo)) - 1), signBits + intBits + fracBits, fracBits);
}

function fixed(value: number, bits: number, fracBits: number): number {
  return signExtend(value, bits) / 2 ** fracBits;
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & sign) !== 0 ? value - 2 ** bits : value;
}

function rgb555(value: number): [number, number, number] {
  return [((value >>> 0) & 31) / 31, ((value >>> 5) & 31) / 31, ((value >>> 10) & 31) / 31];
}

function rgb555a8(value: number, alpha: number): [number, number, number, number] {
  return [extend5To8((value >>> 0) & 31), extend5To8((value >>> 5) & 31), extend5To8((value >>> 10) & 31), alpha];
}

function extend5To8(value: number): number {
  return (value << 3) | (value >>> 2);
}

function a3ToA8(value: number): number {
  return extend5To8((value << 2) | (value >>> 1));
}

function tileToWorldCentered(tile: number): number {
  return (tile + 0.5) * TILE_REAL_SIZE;
}

function tileToWorldNonCentered(tile: number): number {
  return tile * TILE_REAL_SIZE;
}

type Mat4 = number[];

function matIdentity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function matTranslate(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

function matScale(x: number, y: number, z: number): Mat4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function matMul(a: Mat4, b: Mat4): Mat4 {
  return Array.from({ length: 16 }, (_value, index) => {
    const row = Math.floor(index / 4);
    const col = index % 4;
    return a[row * 4] * b[col] + a[row * 4 + 1] * b[col + 4] + a[row * 4 + 2] * b[col + 8] + a[row * 4 + 3] * b[col + 12];
  });
}

function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
