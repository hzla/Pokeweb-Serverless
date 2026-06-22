import { recordFieldChange } from "./actionChangelog";
import { isGen4Project } from "./constants";
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
  internal_name: "Internal Name",
  area_data_id: "Area Data ID",
  wild_id: "Encounter Data ID",
  event_id: "Event File ID",
  music_day_id: "Day BGM ID",
  music_night_id: "Night BGM ID",
  location_specifier: "Location Specifier",
  battle_background: "Battle Background",
  map_settings: "Packed Map Settings",
  area_icon: "Area Icon",
  worldmap_x: "World Map X",
  worldmap_y: "World Map Y",
  worldmap_coords: "Packed World Map Coords",
  unknown_0: "Packed Coord Unknown",
  area_properties: "Packed Area Properties",
  kanto_flag: "Kanto Flag",
  location_type: "Location Type",
  follow_mode: "Following Pokemon Mode",
  hgss_settings: "Packed HGSS Settings",
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

const GEN4_HEADER_FIELD_MAX: Record<string, number> = {
  area_data_id: 255,
  texture_id: 255,
  unknown_0: 15,
  unknown_1: 255,
  matrix_id: 65535,
  script_id: 65535,
  level_script_id: 65535,
  text_bank_id: 65535,
  music_day_id: 65535,
  music_night_id: 65535,
  wild_id: 65535,
  encounter_id: 65535,
  enc_data_id: 65535,
  event_id: 65535,
  map_id: 65535,
  overworlds_id: 65535,
  location_name_id: 65535,
  place_name_id: 65535,
  weather_id: 255,
  camera_id: 255,
  location_specifier: 255,
  map_settings: 65535,
  battle_background: 31,
  flags: 127,
  area_icon: 15,
  worldmap_x: 63,
  worldmap_y: 63,
  worldmap_coords: 65535,
  area_properties: 255,
  kanto_flag: 1,
  location_type: 15,
  follow_mode: 3,
  hgss_settings: 4294967295,
};

const GEN4_HEADER_LENGTH = 24;
const GEN4_INTERNAL_NAME_LENGTH = 16;

for (const column of HEADER_EXPANDED_FIELDS) {
  for (const [max, field] of column) HEADER_FIELD_MAX[field] = max;
}

export function parseHeaders(project: ProjectState): HeaderCollection {
  if (isGen4Project(project)) return parseGen4Headers(project);

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

function parseGen4Headers(project: ProjectState): HeaderCollection {
  const tableOffset = gen4HeaderTableOffset(project);
  if (tableOffset + GEN4_HEADER_LENGTH > project.arm9.length) {
    throw new Error(`Gen 4 header table is outside ARM9 at 0x${tableOffset.toString(16)}`);
  }

  const internalNames = readGen4InternalNames(project);
  const arm9Count = Math.floor((project.arm9.length - tableOffset) / GEN4_HEADER_LENGTH);
  const count = internalNames.length > 0 ? Math.min(internalNames.length, arm9Count) : arm9Count;
  const rows: Record<number, HeaderRow> = {};

  for (let rowId = 1; rowId <= count; rowId += 1) {
    const offset = tableOffset + (rowId - 1) * GEN4_HEADER_LENGTH;
    const raw = readGen4HeaderRow(project, project.arm9, offset);
    const row: HeaderRow = {
      ...raw,
      index: rowId - 1,
      internal_name: internalNames[rowId - 1] ?? `Header ${rowId - 1}`,
      location_name: "",
    };
    refreshGen4HeaderDerivedFields(project, row);
    rows[rowId] = row;
  }

  return { count, rows };
}

export function updateHeaderField(project: ProjectState, rowId: number, field: string, value: string): HeaderUpdateResult {
  if (!project.headers) project.headers = parseHeaders(project);
  const row = project.headers.rows[rowId];
  if (!row) throw new Error(`Header row ${rowId} does not exist`);
  const before = row[field];

  let nextValue: number | string = value.trim();
  if (isGen4Project(project) && field === "internal_name") {
    nextValue = validateGen4InternalName(nextValue);
    row.internal_name = nextValue;
    commitGen4InternalName(project, rowId, nextValue);
  } else if (field === "location_name") {
    const locations = project.texts.banks.locations ?? [];
    const locationId = locations.findIndex((location) => location === nextValue);
    if (locationId < 0) throw new Error(`Unknown location name: ${nextValue}`);
    row.location_name = nextValue;
    if (isGen4Project(project)) setGen4LocationId(row, locationId);
    else setPlaceNameId(row, locationId);
    commitHeaderRow(project, rowId, row);
  } else {
    const numericValue = parseInteger(nextValue, field, headerFieldMaxForProject(project, field));
    nextValue = numericValue;
    if (isGen4Project(project)) {
      setGen4HeaderField(row, field, numericValue);
      commitHeaderRow(project, rowId, row);
    } else if (field === "enc_data_id") {
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
    if (!isGen4Project(project)) commitHeaderRow(project, rowId, row);
  }

  recordFieldChange(project, "headers", headerSubject(row, rowId), HEADER_FIELD_LABELS[field] ?? field.replace(/_/gu, " "), before, nextValue, {
    key: `header:${rowId}:${field}`,
  });
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
  commitHeaderRow(project, rowId, row);

  recordFieldChange(project, "headers", headerSubject(row, rowId), `${HEADER_FIELD_LABELS[field] ?? field.replace(/_/gu, " ")} ${part.label}`, current, rawValue, {
    key: `header:${rowId}:${field}:${partKey}`,
  });
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

function headerFieldMaxForProject(project: ProjectState, field: string): number | undefined {
  if (!isGen4Project(project)) return HEADER_FIELD_MAX[field];
  if (field === "wild_id" || field === "encounter_id" || field === "enc_data_id") return project.session.baseRom === "HGSS" ? 255 : 65535;
  if (field === "location_name_id" || field === "place_name_id") return project.session.baseRom === "DP" ? 65535 : 255;
  if (field === "weather_id") return project.session.baseRom === "HGSS" ? 127 : 255;
  if (field === "camera_id") return project.session.baseRom === "HGSS" ? 63 : 255;
  if (field === "location_specifier") return project.session.baseRom === "Pt" ? 127 : 255;
  if (field === "battle_background") return project.session.baseRom === "DP" ? 15 : 31;
  if (field === "flags") return project.session.baseRom === "HGSS" ? 127 : 15;
  return GEN4_HEADER_FIELD_MAX[field] ?? HEADER_FIELD_MAX[field];
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

function readGen4HeaderRow(project: ProjectState, data: Uint8Array, offset: number): HeaderRawRecord {
  if (project.session.baseRom === "HGSS") return readHgssHeaderRow(data, offset);
  if (project.session.baseRom === "Pt") return readPtHeaderRow(data, offset);
  return readDpHeaderRow(data, offset);
}

function readDpHeaderRow(data: Uint8Array, offset: number): HeaderRawRecord {
  const mapSettings = readInt(data, offset + 23, 1);
  return {
    area_data_id: readInt(data, offset, 1),
    unknown_1: readInt(data, offset + 1, 1),
    matrix_id: readInt(data, offset + 2, 2),
    script_id: readInt(data, offset + 4, 2),
    level_script_id: readInt(data, offset + 6, 2),
    text_bank_id: readInt(data, offset + 8, 2),
    music_day_id: readInt(data, offset + 10, 2),
    music_night_id: readInt(data, offset + 12, 2),
    wild_id: readInt(data, offset + 14, 2),
    event_id: readInt(data, offset + 16, 2),
    location_name_id: readInt(data, offset + 18, 2),
    weather_id: readInt(data, offset + 20, 1),
    camera_id: readInt(data, offset + 21, 1),
    location_specifier: readInt(data, offset + 22, 1),
    map_settings: mapSettings,
    battle_background: mapSettings & 0xf,
    flags: (mapSettings >>> 4) & 0xf,
  };
}

function readPtHeaderRow(data: Uint8Array, offset: number): HeaderRawRecord {
  const mapSettings = readInt(data, offset + 22, 2);
  return {
    area_data_id: readInt(data, offset, 1),
    unknown_1: readInt(data, offset + 1, 1),
    matrix_id: readInt(data, offset + 2, 2),
    script_id: readInt(data, offset + 4, 2),
    level_script_id: readInt(data, offset + 6, 2),
    text_bank_id: readInt(data, offset + 8, 2),
    music_day_id: readInt(data, offset + 10, 2),
    music_night_id: readInt(data, offset + 12, 2),
    wild_id: readInt(data, offset + 14, 2),
    event_id: readInt(data, offset + 16, 2),
    location_name_id: readInt(data, offset + 18, 1),
    area_icon: readInt(data, offset + 19, 1),
    weather_id: readInt(data, offset + 20, 1),
    camera_id: readInt(data, offset + 21, 1),
    map_settings: mapSettings,
    location_specifier: mapSettings & 0x7f,
    battle_background: (mapSettings >>> 7) & 0x1f,
    flags: (mapSettings >>> 12) & 0xf,
  };
}

function readHgssHeaderRow(data: Uint8Array, offset: number): HeaderRawRecord {
  const coords = readInt(data, offset + 2, 2);
  const areaProperties = readInt(data, offset + 19, 1);
  const settings = readInt(data, offset + 20, 4) >>> 0;
  return {
    wild_id: readInt(data, offset, 1),
    area_data_id: readInt(data, offset + 1, 1),
    worldmap_coords: coords,
    unknown_0: coords & 0xf,
    worldmap_x: (coords >>> 4) & 0x3f,
    worldmap_y: (coords >>> 10) & 0x3f,
    matrix_id: readInt(data, offset + 4, 2),
    script_id: readInt(data, offset + 6, 2),
    level_script_id: readInt(data, offset + 8, 2),
    text_bank_id: readInt(data, offset + 10, 2),
    music_day_id: readInt(data, offset + 12, 2),
    music_night_id: readInt(data, offset + 14, 2),
    event_id: readInt(data, offset + 16, 2),
    location_name_id: readInt(data, offset + 18, 1),
    area_properties: areaProperties,
    area_icon: areaProperties & 0xf,
    unknown_1: (areaProperties >>> 4) & 0xf,
    hgss_settings: settings,
    kanto_flag: settings & 1,
    weather_id: (settings >>> 1) & 0x7f,
    location_type: (settings >>> 8) & 0xf,
    camera_id: (settings >>> 12) & 0x3f,
    follow_mode: (settings >>> 18) & 0x3,
    battle_background: (settings >>> 20) & 0x1f,
    flags: (settings >>> 25) & 0x7f,
  };
}

function setGen4HeaderField(row: HeaderRow, field: string, value: number): void {
  if (field === "wild_id" || field === "encounter_id" || field === "enc_data_id") {
    row.wild_id = value;
    row.encounter_id = value;
    row.enc_data_id = value;
    return;
  }
  if (field === "event_id" || field === "map_id" || field === "overworlds_id") {
    row.event_id = value;
    row.map_id = value;
    row.overworlds_id = value;
    return;
  }
  if (field === "area_data_id" || field === "texture_id") {
    row.area_data_id = value;
    row.texture_id = value;
    return;
  }
  if (field === "location_name_id" || field === "place_name_id") {
    setGen4LocationId(row, value);
    return;
  }
  row[field] = value;
}

function setGen4LocationId(row: HeaderRow, value: number): void {
  row.location_name_id = value;
  row.place_name_id = value;
}

function refreshGen4HeaderDerivedFields(project: ProjectState, row: HeaderRow): void {
  const locations = project.texts.banks.locations ?? [];
  const locationId = Number(row.location_name_id ?? row.place_name_id ?? 0);
  row.location_name_id = locationId;
  row.place_name_id = locationId;
  row.location_name = locations[locationId] ?? "Unknown Location";
  row.texture_id = Number(row.area_data_id ?? row.texture_id ?? 0);
  row.area_data_id = Number(row.area_data_id ?? row.texture_id ?? 0);
  row.wild_id = Number(row.wild_id ?? row.enc_data_id ?? row.encounter_id ?? 0);
  row.encounter_id = row.wild_id;
  row.enc_data_id = row.wild_id;
  row.event_id = Number(row.event_id ?? row.map_id ?? row.overworlds_id ?? 0);
  row.map_id = row.event_id;
  row.overworlds_id = row.event_id;
}

function commitHeaderRow(project: ProjectState, rowId: number, row: HeaderRow): void {
  if (isGen4Project(project)) {
    refreshGen4HeaderDerivedFields(project, row);
    const tableOffset = gen4HeaderTableOffset(project);
    const offset = tableOffset + (rowId - 1) * GEN4_HEADER_LENGTH;
    if (offset + GEN4_HEADER_LENGTH > project.arm9.length) throw new Error(`Header row ${rowId} is outside ARM9`);
    project.arm9.set(writeGen4HeaderRow(project, row), offset);
    project.arm9Dirty = true;
    return;
  }
  project.narcs.headers?.dirty.add(0);
}

function writeGen4HeaderRow(project: ProjectState, row: HeaderRow): Uint8Array {
  if (project.session.baseRom === "HGSS") return writeHgssHeaderRow(row);
  if (project.session.baseRom === "Pt") return writePtHeaderRow(row);
  return writeDpHeaderRow(row);
}

function writeDpHeaderRow(row: HeaderRow): Uint8Array {
  const out = new Uint8Array(GEN4_HEADER_LENGTH);
  writeInt(out, 0, 1, row.area_data_id);
  writeInt(out, 1, 1, row.unknown_1);
  writeInt(out, 2, 2, row.matrix_id);
  writeInt(out, 4, 2, row.script_id);
  writeInt(out, 6, 2, row.level_script_id);
  writeInt(out, 8, 2, row.text_bank_id);
  writeInt(out, 10, 2, row.music_day_id);
  writeInt(out, 12, 2, row.music_night_id);
  writeInt(out, 14, 2, row.wild_id);
  writeInt(out, 16, 2, row.event_id);
  writeInt(out, 18, 2, row.location_name_id);
  writeInt(out, 20, 1, row.weather_id);
  writeInt(out, 21, 1, row.camera_id);
  writeInt(out, 22, 1, row.location_specifier);
  writeInt(out, 23, 1, (Number(row.battle_background ?? 0) & 0xf) | ((Number(row.flags ?? 0) & 0xf) << 4));
  return out;
}

function writePtHeaderRow(row: HeaderRow): Uint8Array {
  const out = new Uint8Array(GEN4_HEADER_LENGTH);
  writeInt(out, 0, 1, row.area_data_id);
  writeInt(out, 1, 1, row.unknown_1);
  writeInt(out, 2, 2, row.matrix_id);
  writeInt(out, 4, 2, row.script_id);
  writeInt(out, 6, 2, row.level_script_id);
  writeInt(out, 8, 2, row.text_bank_id);
  writeInt(out, 10, 2, row.music_day_id);
  writeInt(out, 12, 2, row.music_night_id);
  writeInt(out, 14, 2, row.wild_id);
  writeInt(out, 16, 2, row.event_id);
  writeInt(out, 18, 1, row.location_name_id);
  writeInt(out, 19, 1, row.area_icon);
  writeInt(out, 20, 1, row.weather_id);
  writeInt(out, 21, 1, row.camera_id);
  writeInt(
    out,
    22,
    2,
    (Number(row.location_specifier ?? 0) & 0x7f) | ((Number(row.battle_background ?? 0) & 0x1f) << 7) | ((Number(row.flags ?? 0) & 0xf) << 12),
  );
  return out;
}

function writeHgssHeaderRow(row: HeaderRow): Uint8Array {
  const out = new Uint8Array(GEN4_HEADER_LENGTH);
  writeInt(out, 0, 1, row.wild_id);
  writeInt(out, 1, 1, row.area_data_id);
  writeInt(out, 2, 2, (Number(row.unknown_0 ?? 0) & 0xf) | ((Number(row.worldmap_x ?? 0) & 0x3f) << 4) | ((Number(row.worldmap_y ?? 0) & 0x3f) << 10));
  writeInt(out, 4, 2, row.matrix_id);
  writeInt(out, 6, 2, row.script_id);
  writeInt(out, 8, 2, row.level_script_id);
  writeInt(out, 10, 2, row.text_bank_id);
  writeInt(out, 12, 2, row.music_day_id);
  writeInt(out, 14, 2, row.music_night_id);
  writeInt(out, 16, 2, row.event_id);
  writeInt(out, 18, 1, row.location_name_id);
  writeInt(out, 19, 1, (Number(row.area_icon ?? 0) & 0xf) | ((Number(row.unknown_1 ?? 0) & 0xf) << 4));
  writeInt(
    out,
    20,
    4,
    (Number(row.kanto_flag ?? 0) & 1) |
      ((Number(row.weather_id ?? 0) & 0x7f) << 1) |
      ((Number(row.location_type ?? 0) & 0xf) << 8) |
      ((Number(row.camera_id ?? 0) & 0x3f) << 12) |
      ((Number(row.follow_mode ?? 0) & 0x3) << 18) |
      ((Number(row.battle_background ?? 0) & 0x1f) << 20) |
      ((Number(row.flags ?? 0) & 0x7f) << 25),
  );
  return out;
}

function readGen4InternalNames(project: ProjectState): string[] {
  const data = project.narcs.headers?.rawFiles[0];
  if (!data) return [];
  const count = Math.floor(data.length / GEN4_INTERNAL_NAME_LENGTH);
  return Array.from({ length: count }, (_, index) => {
    const start = index * GEN4_INTERNAL_NAME_LENGTH;
    return asciiFromBytes(data.subarray(start, start + GEN4_INTERNAL_NAME_LENGTH));
  });
}

function validateGen4InternalName(value: string): string {
  if (value.length > GEN4_INTERNAL_NAME_LENGTH) throw new Error(`Internal name must be ${GEN4_INTERNAL_NAME_LENGTH} characters or fewer`);
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) throw new Error("Internal name must use ASCII characters");
  }
  return value;
}

function commitGen4InternalName(project: ProjectState, rowId: number, value: string): void {
  const store = project.narcs.headers;
  if (!store) throw new Error("Gen 4 internal names file has not been extracted");
  const requiredLength = rowId * GEN4_INTERNAL_NAME_LENGTH;
  const original = store.rawFiles[0] ?? new Uint8Array();
  const out = original.length >= requiredLength ? original.slice() : new Uint8Array(requiredLength);
  out.set(original.subarray(0, Math.min(original.length, out.length)));
  out.set(asciiToFixedBytes(value, GEN4_INTERNAL_NAME_LENGTH), (rowId - 1) * GEN4_INTERNAL_NAME_LENGTH);
  store.rawFiles[0] = out;
  store.dirty.add(0);
}

export function gen4HeaderTableOffset(project: Pick<ProjectState, "session" | "romInfo">): number {
  const language = gen4LanguageCode(project.romInfo.idCode);
  switch (project.session.baseRom) {
    case "DP":
      if (language === "J") return project.session.baseVersion === "D" ? 0xf0d68 : 0xf0d6c;
      return ({ E: 0xeedbc, S: 0xeee08, I: 0xeed70, F: 0xeedfc, D: 0xeedcc } as Partial<Record<string, number>>)[language] ?? 0xeedbc;
    case "Pt":
      return ({ E: 0xe601c, S: 0xe60b0, I: 0xe6038, F: 0xe60a4, D: 0xe6074, J: 0xe56f0 } as Partial<Record<string, number>>)[language] ?? 0xe601c;
    case "HGSS":
      if (language === "S") return project.session.baseVersion === "HG" ? 0xf6bc8 : 0xf6bd0;
      return ({ E: 0xf6be0, I: 0xf6b58, F: 0xf6bc4, D: 0xf6b94, J: 0xf6390 } as Partial<Record<string, number>>)[language] ?? 0xf6be0;
    default:
      throw new Error(`Gen 4 header table offsets are not available for ${project.session.baseRom}`);
  }
}

function gen4LanguageCode(idCode: string): string {
  const code = idCode.slice(3, 4).toUpperCase();
  return code || "E";
}

function asciiFromBytes(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  return String.fromCharCode(...bytes.subarray(0, end));
}

function asciiToFixedBytes(value: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < Math.min(value.length, length); index += 1) out[index] = value.charCodeAt(index) & 0x7f;
  return out;
}

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i += 1) value += (bytes[offset + i] ?? 0) * 2 ** (8 * i);
  return value;
}

function writeInt(out: Uint8Array, offset: number, size: number, value: unknown): void {
  let next = Number(value ?? 0) >>> 0;
  for (let i = 0; i < size; i += 1) {
    out[offset + i] = next & 0xff;
    next >>>= 8;
  }
}
