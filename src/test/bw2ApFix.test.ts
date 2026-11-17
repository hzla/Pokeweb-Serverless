import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { planBw2ApFix } from "../pokeweb/bw2ApFixModel";

function fixture() {
  const table = new Uint8Array(4 * 32);
  const files = new Map<number, Uint8Array>();
  const addOverlay = (row: number, id: number, fileId: number, address: number, length: number) => {
    const data = new Uint8Array(length);
    [id, address, length, 0x20, 0, 0, fileId, 0x02000000].forEach((word, i) => writeU32(table, row * 32 + i * 4, word));
    files.set(fileId, data);
    return data;
  };
  const dispatch = (data: Uint8Array, at: number, target: number) => {
    [target, 0xebc8dab4, 0x0af5eaf8, 0x367549b8].forEach((word, i) => writeU32(data, at + i * 4, word));
  };

  const card = addOverlay(0, 338, 501, 0x02160000, 0xd0);
  [0x4a33b5f8, 0xa9004833, 0x60816042].forEach((word, i) => writeU32(card, 0x14 + i * 4, word));
  [0x20804a02, 0x42018811, 0x4770d1fc, 0x040001a0].forEach((word, i) => writeU32(card, 0x34 + i * 4, word));
  [0xd10128aa, 0xbd082001, 0xbd082000].forEach((word, i) => writeU32(card, 0xa0 + i * 4, word));

  const first = addOverlay(1, 165, 110, 0x02130000, 0x200);
  const second = addOverlay(2, 337, 901, 0x02142000, 0x300);
  addOverlay(3, 200, 777, 0x02132000, 0x20);
  for (const [bytes, count, base] of [[first, 6, 0x6a130020], [second, 12, 0x6a142020]] as const) {
    [0xe36a1ab4, 0x078869a4, 0xe7037ac8].forEach((word, i) => writeU32(bytes, 0x20 + i * 4, word));
    for (let i = 0; i < count; i += 1) dispatch(bytes, 0x84 + i * 0x20, base);
  }
  return { table, files };
}

describe("Black 2 and White 2 AP fix", () => {
  it.each(["IREO", "IRDO"])("locates moved routines and file IDs in %s, preserves BSS addresses, and reloads without patching twice", (gameCode) => {
    const { table, files } = fixture();
    const tableBefore = table.slice(), filesBefore = new Map([...files].map(([id, bytes]) => [id, bytes.slice()]));
    const result = planBw2ApFix(gameCode, table, (id) => files.get(id))!;
    expect(table).toEqual(tableBefore);
    expect(files).toEqual(filesBefore);
    expect(readU32(result.table, 0x20 + 12)).toBe(0);
    expect(readU32(result.table, 0x40 + 12)).toBe(0);
    expect(readU32(result.table, 0x20 + 28)).toBe(0x02000000);
    const card = result.files.get(501)!;
    expect(readU32(card, 0x14)).toBe(0x477020aa);
    expect(readU16(card, 0x3c)).toBe(0x46c0);
    expect(readU16(card, 0xa8)).toBe(0x2001);
    const first = result.files.get(110)!, second = result.files.get(901)!;
    expect(first.subarray(0x200, 0x220)).toEqual(new Uint8Array(0x20));
    expect(second.subarray(0x300, 0x320)).toEqual(new Uint8Array(0x20));
    expect(readU32(first, 0x124)).toBe(0x6a130220);
    expect(readU32(first, 0x228)).toBe(0xaa65);
    expect(readU32(second, 0x124)).toBe(0x6a142320);
    expect(readU32(second, 0x144)).toBe(0x6a14232c);
    expect(readU32(second, 0x164)).toBe(0x6a142338);
    expect([0x328, 0x334, 0x340].map((offset) => readU32(second, offset))).toEqual([0xa883, 0xb3cf, 0xc127]);
    expect(planBw2ApFix(gameCode, result.table, (id) => result.files.get(id) ?? files.get(id))).toBeUndefined();
  });

  it("rejects modified AP routines and unsafe overlay growth", () => {
    const { table, files } = fixture();
    const card = files.get(501)!;
    writeU32(card, 0x14, 0xff);
    expect(() => planBw2ApFix("IREO", table, (id) => files.get(id))).toThrow(/overlay 338.*changed card routines/);
    writeU32(card, 0x14, 0x4a33b5f8);
    writeU32(table, 3 * 32 + 4, 0x02130220);
    expect(() => planBw2ApFix("IREO", table, (id) => files.get(id))).toThrow(/overlay 165.*no room/);
  });
});
