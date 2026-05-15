import { recordFieldChange } from "./actionChangelog";
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

export type HeaderPackedPart = {
  key: string;
  label: string;
  offset: number;
  size: number;
  kind: "checkbox" | "number";
};

export type HeaderPackedField = {
  label: string;
  fields: readonly string[];
  parts: readonly HeaderPackedPart[];
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
    [8191, "name_icon_id"],
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

export const HEADER_MAIN_FIELDS = ["location_name", "matrix_id", "script_id", "text_bank_id", "enc_data_id"] as const;

export const HEADER_FIELD_LABELS: Record<string, string> = {
  map_type: "Map Resource ID",
  weather_id: "Weather / Camera Low Byte",
  overworlds_id: "Event / Overworld Data ID",
  map_id: "Event / Overworld Data ID",
  parent_map_id: "Town Map Zone Group",
  texture_id: "Area ID",
  level_script_id: "Special Script ID",
  name_style_id: "Place Name Packed Byte",
  name_icon: "Packed Name Icon / Difficulty",
  name_icon_id: "Name Icon ID",
  difficulty_level_adjustment: "Difficulty Level Adjustment",
  camera_id: "Weather / Camera High Byte",
  flags: "Behavior Flags High Byte",
  fly_x: "Default Start X",
  fly_y: "Default Start Y",
  fly_z: "Default Start Z",
  music_spring_id: "Spring BGM ID",
  music_summer_id: "Summer BGM ID",
  music_fall_id: "Autumn BGM ID",
  music_winter_id: "Winter BGM ID",
  unknown_1: "Move Model ID",
  unknown_2: "Behavior Flags Low Byte",
  unknown_3: "Camera Area ID",
  unknown_4: "Encounter Data High Byte",
  enc_data_id: "Encounter Data ID",
  matrix_id: "Matrix ID",
  script_id: "Script ID",
  text_bank_id: "Message Bank ID",
  encounter_id: "Encounter Data ID",
  location_name_id: "Place Name Low Byte",
  place_name_id: "Place Name ID",
};

export const HEADER_PACKED_FIELDS: Record<string, HeaderPackedField> = {
  place_name_flags: {
    label: "Place Name Window",
    fields: ["name_style_id"],
    parts: [
      { key: "show_window", label: "Show Place Name Window", offset: 2, size: 1, kind: "checkbox" },
      { key: "window_style_1", label: "Window Style Bit 1", offset: 3, size: 1, kind: "checkbox" },
      { key: "window_style_2", label: "Window Style Bit 2", offset: 4, size: 1, kind: "checkbox" },
      { key: "window_style_3", label: "Window Style Bit 3", offset: 5, size: 1, kind: "checkbox" },
      { key: "window_style_4", label: "Window Style Bit 4", offset: 6, size: 1, kind: "checkbox" },
      { key: "window_style_5", label: "Window Style Bit 5", offset: 7, size: 1, kind: "checkbox" },
    ],
  },
  weather_camera: {
    label: "Weather / Camera",
    fields: ["weather_id", "camera_id"],
    parts: [
      { key: "weather", label: "Weather ID", offset: 0, size: 6, kind: "number" },
      { key: "projection", label: "Projection Type", offset: 6, size: 3, kind: "number" },
      { key: "camera", label: "Camera ID", offset: 9, size: 7, kind: "number" },
    ],
  },
  map_behavior: {
    label: "Movement / Battle Behavior",
    fields: ["unknown_2", "flags"],
    parts: [
      { key: "map_change_type", label: "Map Transition Type", offset: 0, size: 5, kind: "number" },
      { key: "battle_bg_type", label: "Battle Background Type", offset: 5, size: 5, kind: "number" },
      { key: "bicycle", label: "Bicycle Allowed", offset: 10, size: 1, kind: "checkbox" },
      { key: "dash", label: "Running Allowed", offset: 11, size: 1, kind: "checkbox" },
      { key: "escape", label: "Escape Rope / Dig Allowed", offset: 12, size: 1, kind: "checkbox" },
      { key: "fly", label: "Fly Allowed", offset: 13, size: 1, kind: "checkbox" },
      { key: "special_bgm", label: "Use Bicycle BGM", offset: 14, size: 1, kind: "checkbox" },
      { key: "palace", label: "Battle Facility Allowed", offset: 15, size: 1, kind: "checkbox" },
    ],
  },
};

const HEADER_FIELD_MAX: Record<string, number> = {
  matrix_id: 65535,
  script_id: 65535,
  text_bank_id: 65535,
  encounter_id: 65535,
  enc_data_id: 65535,
  location_name_id: 255,
  place_name_id: 1023,
  name_icon: 65535,
  name_icon_id: 8191,
  difficulty_level_adjustment: 7,
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
      enc_data_id: encounterDataId(raw),
      place_name_id: placeNameId(raw),
      name_icon_id: nameIconId(raw),
      difficulty_level_adjustment: difficultyLevelAdjustment(raw),
      index: rowId - 1,
      location_name: locations[placeNameId(raw)] ?? "Unknown Location",
    };
  }

  return { count, rows };
}

export function updateHeaderField(project: ProjectState, rowId: number, field: string, value: string): HeaderUpdateResult {
  if (!project.headers) project.headers = parseHeaders(project);
  const row = project.headers.rows[rowId];
  if (!row) throw new Error(`Header row ${rowId} does not exist`);
  const before = row[field];

  let nextValue: number | string = value.trim();
  if (field === "location_name") {
    const locations = project.texts.banks.locations ?? [];
    const locationId = locations.findIndex((location) => location === nextValue);
    if (locationId < 0) throw new Error(`Unknown location name: ${nextValue}`);
    row.location_name = nextValue;
    setPlaceNameId(row, locationId);
  } else {
    const numericValue = parseInteger(nextValue, field);
    nextValue = numericValue;
    if (field === "enc_data_id") {
      setEncounterDataId(row, numericValue);
    } else if (field === "place_name_id") {
      setPlaceNameId(row, numericValue);
    } else if (field === "name_icon_id") {
      setNameIconId(row, numericValue);
    } else if (field === "difficulty_level_adjustment") {
      setDifficultyLevelAdjustment(row, numericValue);
    } else {
      row[field] = numericValue;
      if (field === "overworlds_id") row.map_id = numericValue;
      if (field === "map_id") row.overworlds_id = numericValue;
      if (field === "encounter_id" || field === "unknown_4") row.enc_data_id = encounterDataId(row);
      if (field === "location_name_id" || field === "name_style_id") row.place_name_id = placeNameId(row);
      if (field === "name_icon") syncNameIconParts(row);
    }
  }

  recordFieldChange(project, "headers", headerSubject(row, rowId), HEADER_FIELD_LABELS[field] ?? field.replace(/_/gu, " "), before, nextValue, {
    key: `header:${rowId}:${field}`,
  });
  project.narcs.headers?.dirty.add(0);
  return { row, field, value: nextValue };
}

export function getHeaderPackedValue(row: HeaderRow, field: string): number {
  const packed = HEADER_PACKED_FIELDS[field];
  if (!packed) throw new Error(`Unsupported header packed field: ${field}`);
  return packed.fields.reduce((value, rawField, index) => value | ((Number(row[rawField] ?? 0) & 0xff) << (index * 8)), 0);
}

export function updateHeaderPackedField(project: ProjectState, rowId: number, field: string, partKey: string, inputValue: string | boolean): HeaderUpdateResult {
  if (!project.headers) project.headers = parseHeaders(project);
  const row = project.headers.rows[rowId];
  if (!row) throw new Error(`Header row ${rowId} does not exist`);

  const packed = HEADER_PACKED_FIELDS[field];
  const part = packed?.parts.find((item) => item.key === partKey);
  if (!packed || !part) throw new Error(`Unsupported header packed field: ${field}.${partKey}`);

  const partMax = (1 << part.size) - 1;
  const nextPartValue = part.kind === "checkbox" ? (inputValue ? 1 : 0) : parseInteger(String(inputValue).trim(), partKey, partMax);
  const current = getHeaderPackedValue(row, field);
  const mask = partMax << part.offset;
  const rawValue = (current & ~mask) | (nextPartValue << part.offset);

  packed.fields.forEach((rawField, index) => {
    row[rawField] = (rawValue >> (index * 8)) & 0xff;
  });
  if (field === "place_name_flags") row.place_name_id = placeNameId(row);

  recordFieldChange(project, "headers", headerSubject(row, rowId), `${HEADER_FIELD_LABELS[field] ?? field.replace(/_/gu, " ")} ${part.label}`, current, rawValue, {
    key: `header:${rowId}:${field}:${partKey}`,
  });
  project.narcs.headers?.dirty.add(0);
  return { row, field, value: rawValue };
}

function headerSubject(row: HeaderRow, rowId: number): string {
  return `${row.location_name ?? "Header"} (${rowId})`;
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

function parseInteger(value: string, field: string, overrideMax?: number): number {
  const max = overrideMax ?? HEADER_FIELD_MAX[field];
  if (max === undefined) throw new Error(`Unsupported header field: ${field}`);
  if (!/^-?\d+$/u.test(value)) throw new Error(`${field} must be an integer`);
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue)) throw new Error(`${field} must be a safe integer`);
  if (numericValue < 0 || numericValue > max) throw new Error(`${field} must be between 0 and ${max}`);
  return numericValue;
}

function encounterDataId(row: HeaderRawRecord | HeaderRow): number {
  const low = Number(row.encounter_id ?? 0);
  const high = row.unknown_4 === undefined ? 0 : Number(row.unknown_4 ?? 0);
  return row.unknown_4 === undefined ? low : low | (high << 8);
}

function setEncounterDataId(row: HeaderRow, value: number): void {
  row.enc_data_id = value;
  if (row.unknown_4 === undefined) {
    row.encounter_id = value;
    return;
  }
  row.encounter_id = value & 0xff;
  row.unknown_4 = (value >> 8) & 0xff;
}

function placeNameId(row: HeaderRawRecord | HeaderRow): number {
  return Number(row.location_name_id ?? 0) | ((Number(row.name_style_id ?? 0) & 0x3) << 8);
}

function setPlaceNameId(row: HeaderRow, value: number): void {
  row.place_name_id = value;
  row.location_name_id = value & 0xff;
  row.name_style_id = (Number(row.name_style_id ?? 0) & ~0x3) | ((value >> 8) & 0x3);
}

function nameIconId(row: HeaderRawRecord | HeaderRow): number {
  return Number(row.name_icon ?? 0) & 0x1fff;
}

function difficultyLevelAdjustment(row: HeaderRawRecord | HeaderRow): number {
  return (Number(row.name_icon ?? 0) >> 13) & 0x7;
}

function setNameIconId(row: HeaderRow, value: number): void {
  row.name_icon_id = value & 0x1fff;
  row.name_icon = (Number(row.name_icon ?? 0) & ~0x1fff) | Number(row.name_icon_id);
  row.difficulty_level_adjustment = difficultyLevelAdjustment(row);
}

function setDifficultyLevelAdjustment(row: HeaderRow, value: number): void {
  row.difficulty_level_adjustment = value & 0x7;
  row.name_icon = nameIconId(row) | (Number(row.difficulty_level_adjustment) << 13);
  row.name_icon_id = nameIconId(row);
}

function syncNameIconParts(row: HeaderRow): void {
  row.name_icon_id = nameIconId(row);
  row.difficulty_level_adjustment = difficultyLevelAdjustment(row);
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
