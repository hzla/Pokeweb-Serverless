import type { ProjectState } from "./projectStore";
import type { FieldSpec } from "./formats";

export type HeaderRawRecord = Record<string, number>;

export type HeaderRow = Record<string, number | string> & {
  index: number;
  location_name: string;
};

export type HeaderCollection = {
  count: number;
  rows: Record<number, HeaderRow>;
};

export type HeaderUpdateResult = {
  row: HeaderRow;
  field: string;
  value: number | string;
};

export const HEADER_EXPANDED_FIELDS: Array<Array<[number, keyof HeaderRow | string]>> = [
  [
    [255, "map_type"],
    [255, "weather_id"],
    [65535, "overworlds_id"],
    [65535, "parent_map_id"],
    [65535, "texture_id"],
    [65535, "level_script_id"],
  ],
  [
    [255, "name_style_id"],
    [65535, "name_icon"],
    [255, "camera_id"],
    [255, "flags"],
    [4294967296, "fly_x"],
    [4294967296, "fly_y"],
    [4294967296, "fly_z"],
  ],
  [
    [65535, "music_spring_id"],
    [65535, "music_summer_id"],
    [65535, "music_fall_id"],
    [65535, "music_winter_id"],
    [255, "unknown_1"],
    [255, "unknown_2"],
    [65535, "unknown_3"],
    [65535, "unknown_4"],
  ],
];

export const HEADER_MAIN_FIELDS = ["location_name", "matrix_id", "script_id", "text_bank_id", "encounter_id"] as const;

const HEADER_FIELD_MAX: Record<string, number> = {
  matrix_id: 65535,
  script_id: 65535,
  text_bank_id: 65535,
  encounter_id: 65535,
};

for (const column of HEADER_EXPANDED_FIELDS) {
  for (const [max, field] of column) HEADER_FIELD_MAX[field] = max;
}

export function parseHeaders(project: ProjectState): HeaderCollection {
  const store = project.narcs.headers;
  const format = project.formats.headers;
  if (!store) throw new Error("Headers NARC has not been extracted");
  if (!format) throw new Error("Header format is unavailable");

  const data = store.rawFiles[0];
  if (!data) throw new Error("Headers NARC is missing file 0");

  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const count = Math.floor(data.length / rowLength);
  const rows: Record<number, HeaderRow> = {};
  const locations = project.texts.banks.locations ?? [];

  for (let rowId = 1; rowId <= count; rowId += 1) {
    const offset = (rowId - 1) * rowLength;
    const raw = readHeaderRow(data, offset, format);
    rows[rowId] = {
      ...raw,
      overworlds_id: raw.map_id,
      index: rowId - 1,
      location_name: locations[raw.location_name_id] ?? "Unknown Location",
    };
  }

  return { count, rows };
}

export function updateHeaderField(project: ProjectState, rowId: number, field: string, value: string): HeaderUpdateResult {
  if (!project.headers) project.headers = parseHeaders(project);
  const row = project.headers.rows[rowId];
  if (!row) throw new Error(`Header row ${rowId} does not exist`);

  let nextValue: number | string = value.trim();
  if (field === "location_name") {
    const locations = project.texts.banks.locations ?? [];
    const locationId = locations.findIndex((location) => location === nextValue);
    if (locationId < 0) throw new Error(`Unknown location name: ${nextValue}`);
    row.location_name = nextValue;
    row.location_name_id = locationId;
  } else {
    const max = HEADER_FIELD_MAX[field];
    if (max === undefined) throw new Error(`Unsupported header field: ${field}`);
    if (!/^-?\d+$/u.test(nextValue)) throw new Error(`${field} must be an integer`);
    const numericValue = Number(nextValue);
    if (!Number.isSafeInteger(numericValue)) throw new Error(`${field} must be a safe integer`);
    if (numericValue < 0 || numericValue > max) throw new Error(`${field} must be between 0 and ${max}`);
    nextValue = numericValue;
    row[field] = numericValue;
    if (field === "overworlds_id") row.map_id = numericValue;
  }

  project.narcs.headers?.dirty.add(0);
  return { row, field, value: nextValue };
}

export function headerMatchesSearch(row: HeaderRow, searchText: string): boolean {
  const terms = searchText
    .split(", ")
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = JSON.stringify(row).toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

export function headerFieldMax(field: string): number | undefined {
  return HEADER_FIELD_MAX[field];
}

function readHeaderRow(data: Uint8Array, startOffset: number, format: FieldSpec[]): HeaderRawRecord {
  let offset = startOffset;
  const row: HeaderRawRecord = {};
  for (const [size, field] of format) {
    row[field] = readInt(data, offset, size);
    offset += size;
  }
  return row;
}

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i += 1) value += (bytes[offset + i] ?? 0) * 2 ** (8 * i);
  return value;
}
