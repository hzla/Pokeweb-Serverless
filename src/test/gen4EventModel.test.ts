import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats } from "../pokeweb/formats";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { readU16 } from "../nds/binary";

describe("gen4EventModel", () => {
  it("parses DSPRE Gen 4 event files into entity groups and coordinate parts", () => {
    const project = makeProject(makeEventBytes());
    const record = decodeRecord(project, "overworlds", 0);

    expect(record.raw).toMatchObject({
      spawnable_count: 1,
      overworld_count: 1,
      warp_count: 1,
      trigger_count: 1,
      spawnable_0_script_number: 100,
      spawnable_0_type: 2,
      spawnable_0_x_map_position: 5,
      spawnable_0_x_matrix_position: 1,
      spawnable_0_y_map_position: 6,
      spawnable_0_y_matrix_position: 2,
      spawnable_0_z_position: -4096,
      overworld_0_ow_id: 7,
      overworld_0_overlay_table_entry: 12,
      overworld_0_x_map_position: 7,
      overworld_0_x_matrix_position: 2,
      overworld_0_y_map_position: 8,
      overworld_0_y_matrix_position: 3,
      warp_0_header: 88,
      warp_0_anchor: 2,
      warp_0_height: 0x12345678,
      trigger_0_script_number: 222,
      trigger_0_width_x: 3,
      trigger_0_height_y: 4,
      trigger_0_variable_watched: 7,
      footer_length: 3,
    });
  });

  it("materializes an unchanged parsed Gen 4 event file byte-for-byte", () => {
    const original = makeEventBytes();
    const project = makeProject(original);

    decodeRecord(project, "overworlds", 0);
    project.narcs.overworlds?.dirty.add(0);
    materializeProjectEdits(project);

    expect([...project.narcs.overworlds!.rawFiles[0]]).toEqual([...original]);
  });

  it("materializes intended field edits for every Gen 4 event group", () => {
    const project = makeProject(makeEventBytes());
    const record = decodeRecord(project, "overworlds", 0);
    if (!record.raw) throw new Error("missing raw event record");

    record.raw.spawnable_0_x_matrix_position = 2;
    record.raw.spawnable_0_x_map_position = 8;
    record.raw.overworld_0_y_matrix_position = 4;
    record.raw.overworld_0_y_map_position = 9;
    record.raw.warp_0_header = 123;
    record.raw.warp_0_x_matrix_position = 1;
    record.raw.warp_0_x_map_position = 10;
    record.raw.trigger_0_script_number = 456;
    record.raw.trigger_0_y_matrix_position = 2;
    record.raw.trigger_0_y_map_position = 11;
    project.narcs.overworlds?.dirty.add(0);

    materializeProjectEdits(project);

    const out = project.narcs.overworlds!.rawFiles[0];
    expect(readU16(out, 8)).toBe(72);
    expect(readU16(out, 54)).toBe(137);
    expect(readU16(out, 64)).toBe(42);
    expect(readU16(out, 68)).toBe(123);
    expect(readU16(out, 80)).toBe(456);
    expect(readU16(out, 84)).toBe(75);
    expect([...out.slice(-3)]).toEqual([0xaa, 0xbb, 0xcc]);
  });
});

function makeProject(eventBytes: Uint8Array): ProjectState {
  return {
    session: {
      romName: "gen4-event-test",
      generation: "gen4",
      baseVersion: "Pt",
      baseRom: "Pt",
      fairy: false,
      fileIds: { overworlds: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "CPUE", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      overworlds: makeStore("overworlds", [eventBytes]),
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

function makeEventBytes(): Uint8Array {
  const footer = Uint8Array.of(0xaa, 0xbb, 0xcc);
  const out = new Uint8Array(4 + 0x14 + 4 + 0x20 + 4 + 0x0c + 4 + 0x10 + footer.length);
  let offset = 0;
  writeU32(out, offset, 1);
  offset += 4;
  writeSpawnable(out, offset);
  offset += 0x14;
  writeU32(out, offset, 1);
  offset += 4;
  writeOverworld(out, offset);
  offset += 0x20;
  writeU32(out, offset, 1);
  offset += 4;
  writeWarp(out, offset);
  offset += 0x0c;
  writeU32(out, offset, 1);
  offset += 4;
  writeTrigger(out, offset);
  offset += 0x10;
  out.set(footer, offset);
  return out;
}

function writeSpawnable(out: Uint8Array, offset: number): void {
  writeInt(out, offset, 2, 100);
  writeInt(out, offset + 2, 2, 2);
  writeInt(out, offset + 4, 2, 37);
  writeInt(out, offset + 6, 2, 0x1111);
  writeInt(out, offset + 8, 2, 70);
  writeInt(out, offset + 10, 4, -4096);
  writeInt(out, offset + 14, 2, 0x2222);
  writeInt(out, offset + 16, 2, 3);
  writeInt(out, offset + 18, 2, 0x3333);
}

function writeOverworld(out: Uint8Array, offset: number): void {
  [7, 12, 3, 1, 55, 200, 2, 3, 0xaaaa, 0xbbbb, 2, 4, 71, 104].forEach((value, index) => writeInt(out, offset + index * 2, 2, value));
  writeInt(out, offset + 28, 4, 8192);
}

function writeWarp(out: Uint8Array, offset: number): void {
  writeInt(out, offset, 2, 9);
  writeInt(out, offset + 2, 2, 43);
  writeInt(out, offset + 4, 2, 88);
  writeInt(out, offset + 6, 2, 2);
  writeInt(out, offset + 8, 4, 0x12345678);
}

function writeTrigger(out: Uint8Array, offset: number): void {
  [222, 33, 34, 3, 4, 5, 6, 7].forEach((value, index) => writeInt(out, offset + index * 2, 2, value));
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
