import { readU16, readU32 } from "../nds/binary";
import type { BaseRom } from "./constants";
import type { RawRecord } from "./projectStore";

export const GEN4_MAP_TILE_WIDTH = 32;
export const GEN4_MAP_TILE_HEIGHT = 32;
export const GEN4_MAP_TILE_COUNT = GEN4_MAP_TILE_WIDTH * GEN4_MAP_TILE_HEIGHT;
export const GEN4_MAP_PERMISSION_BYTES = GEN4_MAP_TILE_COUNT * 2;
export const GEN4_MAP_HEADER_BYTES = 0x10;
export const GEN4_HGSS_BGS_MAGIC = 0x1234;
export const GEN4_MAP_BUILDING_BYTES = 0x30;

export type Gen4MapPermissionTile = {
  index: number;
  x: number;
  y: number;
  type: number;
  collision: number;
  blocked: boolean;
};

export type Gen4MapSectionOffsets = {
  permissionsOffset: number;
  permissionsLength: number;
  buildingsOffset: number;
  buildingsLength: number;
  modelOffset: number;
  modelLength: number;
  bdhcOffset: number;
  bdhcLength: number;
  bgsLength: number;
  truncated: boolean;
};

export type Gen4MapBuilding = {
  index: number;
  modelId: number;
  x: number;
  y: number;
  z: number;
  xRotation: number;
  yRotation: number;
  zRotation: number;
  length: number;
  width: number;
  height: number;
  unknown1: number;
  unknown2: number;
};

export function parseGen4MapFile(bytes: Uint8Array, baseRom?: BaseRom): RawRecord {
  const permissionOffsetInfo = getGen4MapPermissionOffset(bytes, baseRom);
  const raw: RawRecord = {
    byteLength: bytes.length,
    permissions_length: readU32(bytes, 0x00),
    buildings_length: readU32(bytes, 0x04),
    model_length: readU32(bytes, 0x08),
    bdhc_length: readU32(bytes, 0x0c),
    permissions_offset: permissionOffsetInfo.offset,
    has_bgs_section: permissionOffsetInfo.bgsLength > 0 ? 1 : 0,
    bgs_length: permissionOffsetInfo.bgsLength,
    bgs_truncated: permissionOffsetInfo.truncated ? 1 : 0,
    width: GEN4_MAP_TILE_WIDTH,
    height: GEN4_MAP_TILE_HEIGHT,
    permission_tile_count: GEN4_MAP_TILE_COUNT,
  };

  const availablePermissionBytes = Math.max(0, bytes.length - permissionOffsetInfo.offset);
  if (availablePermissionBytes < GEN4_MAP_PERMISSION_BYTES) raw.permissions_truncated = 1;

  for (let index = 0; index < GEN4_MAP_TILE_COUNT; index += 1) {
    const offset = permissionOffsetInfo.offset + index * 2;
    const type = offset < bytes.length ? bytes[offset] ?? 0 : 0;
    const collision = offset + 1 < bytes.length ? bytes[offset + 1] ?? 0 : 0;
    raw[`type_${index}`] = type;
    raw[`collision_${index}`] = collision;
    raw[`blocked_${index}`] = isGen4CollisionBlocked(collision) ? 1 : 0;
  }

  const sectionEnd =
    GEN4_MAP_HEADER_BYTES +
    permissionOffsetInfo.bgsLength +
    Number(raw.permissions_length ?? 0) +
    Number(raw.buildings_length ?? 0) +
    Number(raw.model_length ?? 0) +
    Number(raw.bdhc_length ?? 0);
  raw.footer_length = Math.max(0, bytes.length - sectionEnd);
  return raw;
}

export function materializeGen4MapFile(raw: RawRecord, original: Uint8Array, baseRom?: BaseRom): Uint8Array {
  const permissionsOffset = Number(raw.permissions_offset ?? getGen4MapPermissionOffset(original, baseRom).offset);
  const out = copyWithLength(original, permissionsOffset + GEN4_MAP_PERMISSION_BYTES);
  for (let index = 0; index < GEN4_MAP_TILE_COUNT; index += 1) {
    const offset = permissionsOffset + index * 2;
    out[offset] = clampByte(raw[`type_${index}`] ?? 0);
    out[offset + 1] = gen4CollisionFromRaw(raw, index);
  }
  return out;
}

export function gen4MapTiles(raw: RawRecord): Gen4MapPermissionTile[] {
  return Array.from({ length: GEN4_MAP_TILE_COUNT }, (_value, index) => gen4MapTile(raw, index));
}

export function gen4MapTile(raw: RawRecord, index: number): Gen4MapPermissionTile {
  const collision = gen4CollisionFromRaw(raw, index);
  return {
    index,
    x: index % GEN4_MAP_TILE_WIDTH,
    y: Math.floor(index / GEN4_MAP_TILE_WIDTH),
    type: clampByte(raw[`type_${index}`] ?? 0),
    collision,
    blocked: isGen4CollisionBlocked(collision),
  };
}

export function isGen4CollisionBlocked(collision: number): boolean {
  return (Number(collision) & 0x80) !== 0;
}

export function getGen4MapPermissionOffset(bytes: Uint8Array, baseRom?: BaseRom): { offset: number; bgsLength: number; truncated: boolean } {
  if (baseRom !== "HGSS") {
    return { offset: GEN4_MAP_HEADER_BYTES, bgsLength: 0, truncated: false };
  }
  if (readU16(bytes, GEN4_MAP_HEADER_BYTES) !== GEN4_HGSS_BGS_MAGIC) {
    return { offset: GEN4_MAP_HEADER_BYTES, bgsLength: 0, truncated: false };
  }
  if (bytes.length < GEN4_MAP_HEADER_BYTES + 4) return { offset: GEN4_MAP_HEADER_BYTES, bgsLength: 0, truncated: true };
  const bgsLength = readU16(bytes, GEN4_MAP_HEADER_BYTES + 2) + 4;
  const offset = GEN4_MAP_HEADER_BYTES + bgsLength;
  if (offset > bytes.length) return { offset: GEN4_MAP_HEADER_BYTES, bgsLength: 0, truncated: true };
  return { offset, bgsLength, truncated: false };
}

export function getGen4MapSectionOffsets(bytes: Uint8Array, baseRom?: BaseRom): Gen4MapSectionOffsets {
  const permissionInfo = getGen4MapPermissionOffset(bytes, baseRom);
  const permissionsLength = readU32(bytes, 0x00) || GEN4_MAP_PERMISSION_BYTES;
  const buildingsLength = readU32(bytes, 0x04);
  const modelLength = readU32(bytes, 0x08);
  const bdhcLength = readU32(bytes, 0x0c);
  const permissionsOffset = permissionInfo.offset;
  const buildingsOffset = permissionsOffset + permissionsLength;
  const modelOffset = buildingsOffset + buildingsLength;
  const bdhcOffset = modelOffset + modelLength;
  return {
    permissionsOffset,
    permissionsLength,
    buildingsOffset,
    buildingsLength,
    modelOffset,
    modelLength,
    bdhcOffset,
    bdhcLength,
    bgsLength: permissionInfo.bgsLength,
    truncated: permissionInfo.truncated || bdhcOffset + bdhcLength > bytes.length,
  };
}

export function extractGen4MapModelBytes(bytes: Uint8Array, baseRom?: BaseRom): Uint8Array | undefined {
  const sections = getGen4MapSectionOffsets(bytes, baseRom);
  if (sections.modelLength <= 0 || sections.modelOffset + sections.modelLength > bytes.length) return undefined;
  return bytes.slice(sections.modelOffset, sections.modelOffset + sections.modelLength);
}

export function extractGen4MapBuildingBytes(bytes: Uint8Array, baseRom?: BaseRom): Uint8Array {
  const sections = getGen4MapSectionOffsets(bytes, baseRom);
  if (sections.buildingsLength <= 0 || sections.buildingsOffset + sections.buildingsLength > bytes.length) return new Uint8Array();
  return bytes.slice(sections.buildingsOffset, sections.buildingsOffset + sections.buildingsLength);
}

export function parseGen4MapBuildings(bytes: Uint8Array, baseRom?: BaseRom): Gen4MapBuilding[] {
  const buildingBytes = extractGen4MapBuildingBytes(bytes, baseRom);
  const count = Math.floor(buildingBytes.length / GEN4_MAP_BUILDING_BYTES);
  return Array.from({ length: count }, (_value, index) => {
    const offset = index * GEN4_MAP_BUILDING_BYTES;
    return {
      index,
      modelId: readU32(buildingBytes, offset),
      x: readFx32Local(buildingBytes, offset + 0x04),
      y: readFx32Local(buildingBytes, offset + 0x08),
      z: readFx32Local(buildingBytes, offset + 0x0c),
      xRotation: readFx32Local(buildingBytes, offset + 0x10),
      yRotation: readFx32Local(buildingBytes, offset + 0x14),
      zRotation: readFx32Local(buildingBytes, offset + 0x18),
      length: readFx32Local(buildingBytes, offset + 0x1c),
      width: readFx32Local(buildingBytes, offset + 0x20),
      height: readFx32Local(buildingBytes, offset + 0x24),
      unknown1: readU32(buildingBytes, offset + 0x28),
      unknown2: readU32(buildingBytes, offset + 0x2c),
    };
  });
}

function gen4CollisionFromRaw(raw: RawRecord, index: number): number {
  const collision = clampByte(raw[`collision_${index}`] ?? 0);
  const blocked = raw[`blocked_${index}`];
  if (blocked === undefined) return collision;
  return Number(blocked) ? collision | 0x80 : collision & 0x7f;
}

function copyWithLength(original: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(Math.max(original.length, length));
  out.set(original.subarray(0, Math.min(original.length, out.length)));
  return out;
}

function clampByte(value: number): number {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(0xff, Math.round(Number(value)))) & 0xff;
}

function readS32Local(data: Uint8Array, offset: number): number {
  const value = readU32(data, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function readFx32Local(data: Uint8Array, offset: number): number {
  return readS32Local(data, offset) / 4096;
}
