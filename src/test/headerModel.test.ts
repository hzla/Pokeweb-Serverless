import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { getHeaderPackedValue, headerMatchesSearch, parseHeaders, updateHeaderField, updateHeaderPackedField } from "../pokeweb/headerModel";
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
