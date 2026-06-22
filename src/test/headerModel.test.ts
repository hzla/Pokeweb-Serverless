import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { gen4HeaderTableOffset, getHeaderPackedValue, headerMatchesSearch, parseHeaders, updateHeaderField, updateHeaderPackedField } from "../pokeweb/headerModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("headerModel", () => {
  it("parses BW headers as a 1-based aggregate collection", () => {
    const project = makeProject("BW", [
      { matrix_id: 12, script_id: 34, text_bank_id: 56, encounter_id: 78, location_name_id: 1 },
      { matrix_id: 90, script_id: 91, text_bank_id: 92, encounter_id: 93, location_name_id: 2 },
    ]);

    const headers = parseHeaders(project);

    expect(headers.count).toBe(2);
    expect(headers.rows[1].index).toBe(0);
    expect(headers.rows[1].location_name).toBe("Accumula Town");
    expect(headers.rows[1].place_name_id).toBe(1);
    expect(headers.rows[2].index).toBe(1);
    expect(headers.rows[2].matrix_id).toBe(90);
    expect(headers.rows[1].unknown_4).toBeUndefined();
  });

  it("parses BW2 unknown_4 from the packed header layout", () => {
    const project = makeProject("BW2", [{ encounter_id: 136, unknown_4: 192, location_name_id: 2, name_icon: 0xa123 }]);

    const headers = parseHeaders(project);

    expect(headers.count).toBe(1);
    expect(headers.rows[1].encounter_id).toBe(136);
    expect(headers.rows[1].unknown_4).toBe(192);
    expect(headers.rows[1].enc_data_id).toBe(49288);
    expect(headers.rows[1].name_icon_id).toBe(0x123);
    expect(headers.rows[1].difficulty_level_adjustment).toBe(5);
    expect(headers.rows[1].location_name).toBe("Striaton City");
  });

  it("updates numeric and location fields in memory and marks headers dirty", () => {
    const project = makeProject("BW2", [{ matrix_id: 12, location_name_id: 1 }]);
    project.headers = parseHeaders(project);

    const matrix = updateHeaderField(project, 1, "matrix_id", "99");
    const location = updateHeaderField(project, 1, "location_name", "Striaton City");

    expect(matrix.value).toBe(99);
    expect(location.value).toBe("Striaton City");
    expect(project.headers.rows[1].matrix_id).toBe(99);
    expect(project.headers.rows[1].location_name_id).toBe(2);
    expect(project.headers.rows[1].place_name_id).toBe(2);
    expect(project.narcs.headers?.dirty.has(0)).toBe(true);
  });

  it("updates the 10-bit place name id across its split fields", () => {
    const project = makeProject("BW2", [{ location_name_id: 1, name_style_id: 0 }]);
    project.headers = parseHeaders(project);

    updateHeaderField(project, 1, "place_name_id", "513");

    expect(project.headers.rows[1].place_name_id).toBe(513);
    expect(project.headers.rows[1].location_name_id).toBe(1);
    expect(project.headers.rows[1].name_style_id).toBe(2);
  });

  it("updates BW2 encounter data through its combined editor field", () => {
    const project = makeProject("BW2", [{ encounter_id: 136, unknown_4: 192, location_name_id: 1 }]);
    project.headers = parseHeaders(project);

    const result = updateHeaderField(project, 1, "enc_data_id", "1035");

    expect(result.value).toBe(1035);
    expect(project.headers.rows[1].enc_data_id).toBe(1035);
    expect(project.headers.rows[1].encounter_id).toBe(11);
    expect(project.headers.rows[1].unknown_4).toBe(4);
  });

  it("updates the packed name icon and difficulty level fields without losing the other part", () => {
    const project = makeProject("BW2", [{ name_icon: 0xa123, location_name_id: 1 }]);
    project.headers = parseHeaders(project);

    updateHeaderField(project, 1, "difficulty_level_adjustment", "3");
    expect(project.headers.rows[1].name_icon).toBe(0x6123);
    expect(project.headers.rows[1].name_icon_id).toBe(0x123);

    updateHeaderField(project, 1, "name_icon_id", "1110");
    expect(project.headers.rows[1].name_icon).toBe(0x6456);
    expect(project.headers.rows[1].difficulty_level_adjustment).toBe(3);
  });

  it("updates header packed weather, camera, and movement flags", () => {
    const project = makeProject("BW2", [{ weather_id: 0, camera_id: 0, unknown_2: 0, flags: 0, name_style_id: 0, location_name_id: 1 }]);
    project.headers = parseHeaders(project);

    updateHeaderPackedField(project, 1, "weather_camera", "weather", "12");
    updateHeaderPackedField(project, 1, "weather_camera", "projection", "3");
    updateHeaderPackedField(project, 1, "weather_camera", "camera", "24");
    updateHeaderPackedField(project, 1, "map_behavior", "map_change_type", "2");
    updateHeaderPackedField(project, 1, "map_behavior", "battle_bg_type", "7");
    updateHeaderPackedField(project, 1, "map_behavior", "dash", true);
    updateHeaderPackedField(project, 1, "place_name_flags", "show_window", true);

    const row = project.headers.rows[1];
    expect(getHeaderPackedValue(row, "weather_camera")).toBe(0x30cc);
    expect(row.weather_id).toBe(204);
    expect(row.camera_id).toBe(48);
    expect(getHeaderPackedValue(row, "map_behavior")).toBe(0x08e2);
    expect(row.unknown_2).toBe(226);
    expect(row.flags).toBe(8);
    expect(row.name_style_id).toBe(4);
    expect(project.narcs.headers?.dirty.has(0)).toBe(true);
  });

  it("rejects invalid header values without mutating", () => {
    const project = makeProject("BW2", [{ matrix_id: 12, location_name_id: 1 }]);
    project.headers = parseHeaders(project);

    expect(() => updateHeaderField(project, 1, "matrix_id", "70000")).toThrow(/between 0 and 65535/u);
    expect(() => updateHeaderField(project, 1, "location_name", "Not A Place")).toThrow(/Unknown location/u);
    expect(project.headers.rows[1].matrix_id).toBe(12);
    expect(project.headers.rows[1].location_name_id).toBe(1);
  });

  it("matches old comma-separated JSON-string search behavior", () => {
    const project = makeProject("BW2", [{ matrix_id: 44, location_name_id: 1 }]);
    const row = parseHeaders(project).rows[1];

    expect(headerMatchesSearch(row, "")).toBe(true);
    expect(headerMatchesSearch(row, "accumula")).toBe(true);
    expect(headerMatchesSearch(row, "nope, 44")).toBe(true);
    expect(headerMatchesSearch(row, "nope")).toBe(false);
  });

  it("parses Platinum headers from ARM9 with internal map names", () => {
    const project = makeGen4Project("Pt", [
      packPtHeader({
        area_data_id: 7,
        matrix_id: 22,
        script_id: 33,
        level_script_id: 44,
        text_bank_id: 55,
        music_day_id: 66,
        music_night_id: 77,
        wild_id: 88,
        event_id: 99,
        location_name_id: 2,
        area_icon: 4,
        weather_id: 5,
        camera_id: 6,
        location_specifier: 0x12,
        battle_background: 0x0b,
        flags: 3,
      }),
    ]);

    const headers = parseHeaders(project);

    expect(headers.count).toBe(1);
    expect(headers.rows[1].internal_name).toBe("north_gate");
    expect(headers.rows[1].location_name).toBe("Jubilife City");
    expect(headers.rows[1].texture_id).toBe(7);
    expect(headers.rows[1].enc_data_id).toBe(88);
    expect(headers.rows[1].overworlds_id).toBe(99);
    expect(headers.rows[1].location_specifier).toBe(0x12);
    expect(headers.rows[1].battle_background).toBe(0x0b);
  });

  it("writes edited Platinum headers back into ARM9 without dirtying mapname", () => {
    const project = makeGen4Project("Pt", [packPtHeader({ matrix_id: 22, wild_id: 88, location_name_id: 2 })]);
    project.headers = parseHeaders(project);

    updateHeaderField(project, 1, "matrix_id", "1234");
    updateHeaderField(project, 1, "wild_id", "432");
    updateHeaderField(project, 1, "location_name", "Route 201");

    const offset = gen4HeaderTableOffset(project);
    expect(readInt(project.arm9, offset + 2, 2)).toBe(1234);
    expect(readInt(project.arm9, offset + 14, 2)).toBe(432);
    expect(project.arm9[offset + 18]).toBe(1);
    expect(project.arm9Dirty).toBe(true);
    expect(project.narcs.headers?.dirty.has(0)).toBe(false);
  });

  it("parses and writes HGSS packed header fields", () => {
    const project = makeGen4Project("HG", [
      packHgssHeader({
        wild_id: 7,
        area_data_id: 8,
        unknown_0: 3,
        worldmap_x: 12,
        worldmap_y: 34,
        matrix_id: 101,
        script_id: 102,
        level_script_id: 103,
        text_bank_id: 104,
        music_day_id: 105,
        music_night_id: 106,
        event_id: 107,
        location_name_id: 3,
        area_icon: 5,
        unknown_1: 6,
        kanto_flag: 1,
        weather_id: 70,
        location_type: 9,
        camera_id: 42,
        follow_mode: 2,
        battle_background: 17,
        flags: 65,
      }),
    ]);
    project.headers = parseHeaders(project);

    expect(project.headers.rows[1].location_name).toBe("New Bark Town");
    expect(project.headers.rows[1].worldmap_x).toBe(12);
    expect(project.headers.rows[1].camera_id).toBe(42);

    updateHeaderField(project, 1, "worldmap_x", "22");
    updateHeaderField(project, 1, "camera_id", "31");

    const offset = gen4HeaderTableOffset(project);
    const coords = readInt(project.arm9, offset + 2, 2);
    const settings = readInt(project.arm9, offset + 20, 4) >>> 0;
    expect((coords >>> 4) & 0x3f).toBe(22);
    expect((settings >>> 12) & 0x3f).toBe(31);
    expect((settings >>> 25) & 0x7f).toBe(65);
  });

  it("edits Gen 4 internal header names in mapname without materializing it as a header table", () => {
    const project = makeGen4Project("D", [packDpHeader({ location_name_id: 2 })]);
    project.headers = parseHeaders(project);

    updateHeaderField(project, 1, "internal_name", "ROUTE_201");
    materializeProjectEdits(project);

    const mapname = project.narcs.headers?.rawFiles[0];
    expect(mapname?.length).toBe(16);
    expect(asciiFromBytes(mapname!.subarray(0, 16))).toBe("ROUTE_201");
    expect(project.narcs.headers?.dirty.has(0)).toBe(true);
  });
});

function makeProject(baseRom: "BW" | "BW2", rows: Array<Record<string, number>>): ProjectState {
  const formats = getNarcFormats(baseRom);
  const format = formats.headers;
  if (!format) throw new Error("Missing header format");
  const data = packRows(format, rows);
  const headersStore: NarcStore = {
    name: "headers",
    fileId: 1,
    sourcePath: "a/0/1/2",
    fileCount: 1,
    rawFiles: [data],
    records: new Map(),
    dirty: new Set(),
  };

  return {
    session: {
      romName: "test",
      baseVersion: baseRom === "BW" ? "W" : "W2",
      baseRom,
      fairy: false,
      fileIds: { headers: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: data.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: { headers: headersStore } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { locations: ["Nuvema Town", "Accumula Town", "Striaton City"] } },
    formats,
    trpokInfo: [],
  };
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}

function makeGen4Project(baseVersion: "D" | "P" | "Pt" | "HG" | "SS", headerRows: Uint8Array[]): ProjectState {
  const baseRom = baseVersion === "Pt" ? "Pt" : baseVersion === "HG" || baseVersion === "SS" ? "HGSS" : "DP";
  const idCode = baseVersion === "Pt" ? "CPUE" : baseVersion === "HG" ? "IPKE" : baseVersion === "SS" ? "IPGE" : baseVersion === "P" ? "APAE" : "ADAE";
  const probe = {
    session: { baseVersion, baseRom },
    romInfo: { idCode },
  } as Pick<ProjectState, "session" | "romInfo">;
  const offset = gen4HeaderTableOffset(probe);
  const arm9 = new Uint8Array(offset + headerRows.length * 24);
  headerRows.forEach((row, index) => arm9.set(row, offset + index * 24));
  const mapname = packInternalNames(["north_gate"].slice(0, headerRows.length));
  const headersStore: NarcStore = {
    name: "headers",
    fileId: 1,
    sourcePath: "fielddata/maptable/mapname.bin",
    container: "file",
    fileCount: 1,
    rawFiles: [mapname],
    records: new Map(),
    dirty: new Set(),
  };

  return {
    session: {
      romName: "gen4-test",
      generation: "gen4",
      baseVersion,
      baseRom,
      fairy: false,
      fileIds: { headers: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode, fileName: "test.nds", size: arm9.length },
    arm9,
    overlays: {},
    narcs: { headers: headersStore } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { locations: ["Twinleaf Town", "Route 201", "Jubilife City", "New Bark Town"] } },
    formats: getNarcFormats(baseRom),
    trpokInfo: [],
  };
}

function packDpHeader(values: Record<string, number>): Uint8Array {
  const out = new Uint8Array(24);
  writeInt(out, 0, 1, values.area_data_id ?? 0);
  writeInt(out, 1, 1, values.unknown_1 ?? 0);
  writeInt(out, 2, 2, values.matrix_id ?? 0);
  writeInt(out, 4, 2, values.script_id ?? 0);
  writeInt(out, 6, 2, values.level_script_id ?? 0);
  writeInt(out, 8, 2, values.text_bank_id ?? 0);
  writeInt(out, 10, 2, values.music_day_id ?? 0);
  writeInt(out, 12, 2, values.music_night_id ?? 0);
  writeInt(out, 14, 2, values.wild_id ?? 0);
  writeInt(out, 16, 2, values.event_id ?? 0);
  writeInt(out, 18, 2, values.location_name_id ?? 0);
  writeInt(out, 20, 1, values.weather_id ?? 0);
  writeInt(out, 21, 1, values.camera_id ?? 0);
  writeInt(out, 22, 1, values.location_specifier ?? 0);
  writeInt(out, 23, 1, ((values.battle_background ?? 0) & 0xf) | (((values.flags ?? 0) & 0xf) << 4));
  return out;
}

function packPtHeader(values: Record<string, number>): Uint8Array {
  const out = packDpHeader(values);
  writeInt(out, 18, 1, values.location_name_id ?? 0);
  writeInt(out, 19, 1, values.area_icon ?? 0);
  writeInt(out, 22, 2, ((values.location_specifier ?? 0) & 0x7f) | (((values.battle_background ?? 0) & 0x1f) << 7) | (((values.flags ?? 0) & 0xf) << 12));
  return out;
}

function packHgssHeader(values: Record<string, number>): Uint8Array {
  const out = new Uint8Array(24);
  writeInt(out, 0, 1, values.wild_id ?? 0);
  writeInt(out, 1, 1, values.area_data_id ?? 0);
  writeInt(out, 2, 2, ((values.unknown_0 ?? 0) & 0xf) | (((values.worldmap_x ?? 0) & 0x3f) << 4) | (((values.worldmap_y ?? 0) & 0x3f) << 10));
  writeInt(out, 4, 2, values.matrix_id ?? 0);
  writeInt(out, 6, 2, values.script_id ?? 0);
  writeInt(out, 8, 2, values.level_script_id ?? 0);
  writeInt(out, 10, 2, values.text_bank_id ?? 0);
  writeInt(out, 12, 2, values.music_day_id ?? 0);
  writeInt(out, 14, 2, values.music_night_id ?? 0);
  writeInt(out, 16, 2, values.event_id ?? 0);
  writeInt(out, 18, 1, values.location_name_id ?? 0);
  writeInt(out, 19, 1, ((values.area_icon ?? 0) & 0xf) | (((values.unknown_1 ?? 0) & 0xf) << 4));
  writeInt(
    out,
    20,
    4,
    ((values.kanto_flag ?? 0) & 1) |
      (((values.weather_id ?? 0) & 0x7f) << 1) |
      (((values.location_type ?? 0) & 0xf) << 8) |
      (((values.camera_id ?? 0) & 0x3f) << 12) |
      (((values.follow_mode ?? 0) & 0x3) << 18) |
      (((values.battle_background ?? 0) & 0x1f) << 20) |
      (((values.flags ?? 0) & 0x7f) << 25),
  );
  return out;
}

function packInternalNames(names: string[]): Uint8Array {
  const out = new Uint8Array(names.length * 16);
  names.forEach((name, index) => {
    for (let char = 0; char < Math.min(name.length, 16); char += 1) out[index * 16 + char] = name.charCodeAt(char);
  });
  return out;
}

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i += 1) value += (bytes[offset + i] ?? 0) * 2 ** (8 * i);
  return value;
}

function asciiFromBytes(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end));
}
