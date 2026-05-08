import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { headerMatchesSearch, parseHeaders, updateHeaderField } from "../pokeweb/headerModel";
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
    expect(headers.rows[2].index).toBe(1);
    expect(headers.rows[2].matrix_id).toBe(90);
    expect(headers.rows[1].unknown_4).toBeUndefined();
  });

  it("parses BW2 unknown_4 from the packed header layout", () => {
    const project = makeProject("BW2", [{ encounter_id: 136, unknown_4: 192, location_name_id: 2 }]);

    const headers = parseHeaders(project);

    expect(headers.count).toBe(1);
    expect(headers.rows[1].encounter_id).toBe(136);
    expect(headers.rows[1].unknown_4).toBe(192);
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
