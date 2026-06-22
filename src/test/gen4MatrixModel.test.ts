import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats } from "../pokeweb/formats";
import { getGen4MatrixName, setGen4MatrixName } from "../pokeweb/gen4MatrixModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { readU16 } from "../nds/binary";

describe("gen4MatrixModel", () => {
  it("parses DSPRE Gen 4 matrix files with header and height sections", () => {
    const project = makeProject(makeMatrixBytes({ headers: true, heights: true, footer: true }));
    const record = decodeRecord(project, "matrix", 0);

    expect(record.raw).toMatchObject({
      width: 2,
      height: 2,
      has_headers_section: 1,
      has_heights_section: 1,
      header_0: 10,
      header_3: 13,
      altitude_0: 3,
      altitude_3: 6,
      map_0: 100,
      map_3: 103,
      footer_length: 2,
    });
    expect(getGen4MatrixName(record.raw!)).toBe("Test");
  });

  it("materializes an unchanged Gen 4 matrix byte-for-byte", () => {
    const original = makeMatrixBytes({ headers: true, heights: true, footer: true });
    const project = makeProject(original);

    decodeRecord(project, "matrix", 0);
    project.narcs.matrix?.dirty.add(0);
    materializeProjectEdits(project);

    expect([...project.narcs.matrix!.rawFiles[0]]).toEqual([...original]);
  });

  it("materializes matrix name, header, altitude, and map edits", () => {
    const project = makeProject(makeMatrixBytes({ headers: true, heights: true, footer: true }));
    const record = decodeRecord(project, "matrix", 0);
    if (!record.raw) throw new Error("missing matrix raw");

    setGen4MatrixName(record.raw, "Cave");
    record.raw.header_1 = 44;
    record.raw.altitude_3 = 12;
    record.raw.map_2 = 999;
    project.narcs.matrix?.dirty.add(0);
    materializeProjectEdits(project);

    const out = project.narcs.matrix!.rawFiles[0];
    expect(out[4]).toBe(4);
    expect(String.fromCharCode(...out.slice(5, 9))).toBe("Cave");
    expect(readU16(out, 11)).toBe(44);
    expect(out[20]).toBe(12);
    expect(readU16(out, 25)).toBe(999);
    expect([...out.slice(-2)]).toEqual([0xaa, 0xbb]);
  });

  it("parses and materializes matrices without optional sections", () => {
    const original = makeMatrixBytes({ headers: false, heights: false, footer: false });
    const project = makeProject(original);
    const record = decodeRecord(project, "matrix", 0);

    expect(record.raw).toMatchObject({
      width: 2,
      height: 2,
      has_headers_section: 0,
      has_heights_section: 0,
      map_0: 100,
      map_3: 103,
      footer_length: 0,
    });
    expect(record.raw?.header_0).toBeUndefined();
    expect(record.raw?.altitude_0).toBeUndefined();

    record.raw!.map_0 = 65535;
    project.narcs.matrix?.dirty.add(0);
    materializeProjectEdits(project);

    expect(readU16(project.narcs.matrix!.rawFiles[0], 9)).toBe(65535);
  });
});

function makeProject(matrixBytes: Uint8Array): ProjectState {
  return {
    session: {
      romName: "gen4-matrix-test",
      generation: "gen4",
      baseVersion: "Pt",
      baseRom: "Pt",
      fairy: false,
      fileIds: { matrix: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "CPUE", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      matrix: makeStore("matrix", [matrixBytes]),
    },
    texts: { banks: {} },
    formats: getNarcFormats("Pt"),
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeMatrixBytes(options: { headers: boolean; heights: boolean; footer: boolean }): Uint8Array {
  const name = "Test";
  const count = 4;
  const footer = options.footer ? Uint8Array.of(0xaa, 0xbb) : new Uint8Array();
  const length = 5 + name.length + (options.headers ? count * 2 : 0) + (options.heights ? count : 0) + count * 2 + footer.length;
  const out = new Uint8Array(length);
  out[0] = 2;
  out[1] = 2;
  out[2] = options.headers ? 1 : 0;
  out[3] = options.heights ? 1 : 0;
  out[4] = name.length;
  for (let index = 0; index < name.length; index += 1) out[5 + index] = name.charCodeAt(index);
  let offset = 5 + name.length;
  if (options.headers) {
    [10, 11, 12, 13].forEach((value) => {
      writeU16(out, offset, value);
      offset += 2;
    });
  }
  if (options.heights) {
    [3, 4, 5, 6].forEach((value) => {
      out[offset++] = value;
    });
  }
  [100, 101, 102, 103].forEach((value) => {
    writeU16(out, offset, value);
    offset += 2;
  });
  out.set(footer, offset);
  return out;
}

function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}
