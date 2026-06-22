import type { FieldSpec } from "./formats";
import type { RawRecord } from "./projectStore";

export const GEN4_MAP_SIZE = 32;

export const GEN4_EVENT_GROUP_FORMATS = {
  spawnable: [
    [2, "script_number"],
    [2, "type"],
    [2, "x_position"],
    [2, "unknown_2"],
    [2, "y_position"],
    [4, "z_position"],
    [2, "unknown_4"],
    [2, "direction"],
    [2, "unknown_5"],
  ],
  overworld: [
    [2, "ow_id"],
    [2, "overlay_table_entry"],
    [2, "movement"],
    [2, "type"],
    [2, "flag"],
    [2, "script_number"],
    [2, "orientation"],
    [2, "sight_range"],
    [2, "unknown_1"],
    [2, "unknown_2"],
    [2, "x_range"],
    [2, "y_range"],
    [2, "x_position"],
    [2, "y_position"],
    [4, "z_position"],
  ],
  warp: [
    [2, "x_position"],
    [2, "y_position"],
    [2, "header"],
    [2, "anchor"],
    [4, "height"],
  ],
  trigger: [
    [2, "script_number"],
    [2, "x_position"],
    [2, "y_position"],
    [2, "width_x"],
    [2, "height_y"],
    [2, "z_position"],
    [2, "expected_var_value"],
    [2, "variable_watched"],
  ],
} as const satisfies Record<string, FieldSpec[]>;

export type Gen4EventGroup = keyof typeof GEN4_EVENT_GROUP_FORMATS;

const GEN4_EVENT_GROUPS = ["spawnable", "overworld", "warp", "trigger"] as const;
const GEN4_COORDINATE_GROUPS = new Set<Gen4EventGroup>(["spawnable", "overworld", "warp", "trigger"]);

export function parseGen4EventFile(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = { byteLength: bytes.length };
  let offset = 0;
  for (const group of GEN4_EVENT_GROUPS) {
    const count = readU32(bytes, offset);
    raw[`${group}_count`] = count;
    offset += 4;
    for (let index = 0; index < count; index += 1) {
      offset = readGen4EventGroup(raw, bytes, offset, group, index);
    }
  }
  raw.footer_length = Math.max(0, bytes.length - offset);
  return raw;
}

export function materializeGen4EventFile(raw: RawRecord, original: Uint8Array): Uint8Array {
  const payloadLength = gen4EventPayloadLength(raw);
  const footerLength = Number(raw.footer_length ?? Math.max(0, original.length - payloadLength));
  const footer = footerLength > 0 ? original.subarray(Math.max(0, original.length - footerLength)) : new Uint8Array();
  const out = new Uint8Array(payloadLength + footer.length);
  let offset = 0;
  for (const group of GEN4_EVENT_GROUPS) {
    const count = Math.max(0, Number(raw[`${group}_count`] ?? 0));
    writeU32(out, offset, count);
    offset += 4;
    for (let index = 0; index < count; index += 1) {
      offset = writeGen4EventGroup(out, offset, raw, group, index);
    }
  }
  out.set(footer, offset);
  return out;
}

export function gen4EventPayloadLength(raw: RawRecord): number {
  return GEN4_EVENT_GROUPS.reduce((sum, group) => sum + 4 + Number(raw[`${group}_count`] ?? 0) * gen4EventGroupByteLength(group), 0);
}

export function gen4EventGroupByteLength(group: Gen4EventGroup): number {
  return GEN4_EVENT_GROUP_FORMATS[group].reduce((sum, [size]) => sum + size, 0);
}

function readGen4EventGroup(raw: RawRecord, bytes: Uint8Array, offset: number, group: Gen4EventGroup, index: number): number {
  const start = offset;
  for (const [size, field] of GEN4_EVENT_GROUP_FORMATS[group]) {
    raw[`${group}_${index}_${field}`] = readField(bytes, offset, size, signedField(group, field));
    offset += size;
  }
  if (GEN4_COORDINATE_GROUPS.has(group)) {
    const x = readS16(bytes, coordinateOffset(group, "x", start));
    const y = readS16(bytes, coordinateOffset(group, "y", start));
    setCoordinateParts(raw, group, index, "x", x);
    setCoordinateParts(raw, group, index, "y", y);
  }
  return offset;
}

function writeGen4EventGroup(out: Uint8Array, offset: number, raw: RawRecord, group: Gen4EventGroup, index: number): number {
  const composed = {
    x_position: composeCoordinate(raw, group, index, "x"),
    y_position: composeCoordinate(raw, group, index, "y"),
  };
  for (const [size, field] of GEN4_EVENT_GROUP_FORMATS[group]) {
    const value = field === "x_position" || field === "y_position" ? composed[field] : (raw[`${group}_${index}_${field}`] ?? 0);
    writeInt(out, offset, size, value);
    offset += size;
  }
  return offset;
}

function setCoordinateParts(raw: RawRecord, group: Gen4EventGroup, index: number, axis: "x" | "y", value: number): void {
  raw[`${group}_${index}_${axis}_map_position`] = value % GEN4_MAP_SIZE;
  raw[`${group}_${index}_${axis}_matrix_position`] = Math.trunc(value / GEN4_MAP_SIZE);
}

function composeCoordinate(raw: RawRecord, group: Gen4EventGroup, index: number, axis: "x" | "y"): number {
  const local = raw[`${group}_${index}_${axis}_map_position`];
  const matrix = raw[`${group}_${index}_${axis}_matrix_position`];
  if (local !== undefined || matrix !== undefined) return Number(local ?? 0) + GEN4_MAP_SIZE * Number(matrix ?? 0);
  return raw[`${group}_${index}_${axis}_position`] ?? 0;
}

function coordinateOffset(group: Gen4EventGroup, axis: "x" | "y", start: number): number {
  if (group === "spawnable") return start + (axis === "x" ? 4 : 8);
  if (group === "overworld") return start + (axis === "x" ? 24 : 26);
  if (group === "warp") return start + (axis === "x" ? 0 : 2);
  return start + (axis === "x" ? 2 : 4);
}

function signedField(group: Gen4EventGroup, field: string): boolean {
  return field === "x_position" || field === "y_position" || (field === "z_position" && (group === "spawnable" || group === "overworld"));
}

function readField(bytes: Uint8Array, offset: number, size: number, signed: boolean): number {
  if (signed && size === 2) return readS16(bytes, offset);
  if (signed && size === 4) return readS32(bytes, offset);
  if (size === 2) return readU16(bytes, offset);
  if (size === 4) return readU32(bytes, offset);
  return bytes[offset] ?? 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function readS16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readS32(bytes: Uint8Array, offset: number): number {
  return readU32(bytes, offset) | 0;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  writeInt(out, offset, 4, value);
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  let next = Number(value) >>> 0;
  for (let index = 0; index < size; index += 1) {
    out[offset + index] = next & 0xff;
    next >>>= 8;
  }
}
