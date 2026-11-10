import { describe, expect, it } from "vitest";
import {
  BAG_BLOCK, EXPANDED_SAVE_LAYOUT, PAL_PAD_BLOCK, PARTY_BLOCK_SHIFT, RETAIL_SAVE_LAYOUT, TRAINER_BLOCK, SAVE_EXTRA_START,
  convertSaveToExpanded, convertSaveToRetail, crc16, detectSaveFormat, encodeSave, recoverSave, validateExpandedBag,
  type ItemSaveRules,
} from "../pokeweb/itemSaveFormat";

const POCKETS = new Map<number, number>([[1, 0], [17, 1], [328, 2], [149, 3], [442, 4], [700, 0]]);
const rules: ItemSaveRules = { pocketOf: (item) => POCKETS.get(item) ?? (item > 0 && item < 639 ? 0 : undefined) };

function retailSave(options: { battleLog?: boolean; version?: number } = {}): Uint8Array {
  const payloads = RETAIL_SAVE_LAYOUT.blocks.map((block, index) => {
    const payload = new Uint8Array(block.size);
    for (let i = 0; i < payload.length; i++) payload[i] = (index * 31 + i) & 0xff;
    return payload;
  });
  payloads[TRAINER_BLOCK][4 + 27] = options.version ?? 22;
  // Bag: items pocket (offset 0), key items (0x4d8), TMs (0x624), medicine (0x7d8), berries (0x898); Free Space bits.
  const bag = new Uint8Array(0x9ec);
  const put = (offset: number, item: number, count: number) => { bag[offset] = item & 0xff; bag[offset + 1] = item >> 8; bag[offset + 2] = count & 0xff; bag[offset + 3] = count >> 8; };
  put(0, 1, 5);
  put(0x4d8, 442, 1);
  put(0x624, 328, 1);
  put(0x7d8, 17, 20);
  put(0x898, 149, 3);
  bag[0x998] = 0x02; // item 1 is in the Free Space
  payloads[BAG_BLOCK] = bag;
  const palPad = new Uint8Array(0xd54).fill(0x5a);
  if (options.battleLog) { palPad.set([0x4b, 0x4c, 0x4f, 0x47, 2, 0], 0); }
  payloads[PAL_PAD_BLOCK] = palPad;
  const file = new Uint8Array(0x80000).fill(0xee);
  return encodeSave(file, RETAIL_SAVE_LAYOUT, payloads, payloads.map((_, i) => i), 41);
}

describe("item save format", () => {
  it("uses the native CRC-16/CCITT with initial value 0xffff", () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
  });

  it("keeps the retail footer position and moves only blocks 26-31", () => {
    expect(EXPANDED_SAVE_LAYOUT.crcOffset).toBe(RETAIL_SAVE_LAYOUT.crcOffset);
    expect(PARTY_BLOCK_SHIFT).toBe(0x700);
    RETAIL_SAVE_LAYOUT.blocks.forEach((block, index) => {
      const moved = EXPANDED_SAVE_LAYOUT.blocks[index].offset - block.offset;
      expect(moved).toBe(index >= 26 && index <= 31 ? 0x700 : 0);
    });
    expect(EXPANDED_SAVE_LAYOUT.blocks[BAG_BLOCK].size).toBe(0x1080);
    expect(EXPANDED_SAVE_LAYOUT.blocks[PAL_PAD_BLOCK].size).toBe(0x6fc);
  });

  it("converts a retail save to the pool, ordered by pocket, and back without loss", () => {
    const source = retailSave();
    expect(detectSaveFormat(source)).toBe("retail");
    const { bytes, report } = convertSaveToExpanded(source, rules);
    expect(detectSaveFormat(bytes)).toBe("expanded");
    expect(report).toMatchObject({ bagItems: 5, generation: 41, palPadBattleLogKept: false, gameVersion: 22 });
    const expanded = recoverSave(bytes, EXPANDED_SAVE_LAYOUT);
    const bag = expanded.payloads[BAG_BLOCK];
    const slots = [0, 1, 2, 3, 4].map((slot) => bag[4 + slot * 4] | (bag[5 + slot * 4] << 8));
    expect(slots).toEqual([1, 17, 328, 149, 442]); // pockets 0, 1, 2, 3, 4
    expect(bag[0x1000]).toBe(0x02);
    expect(validateExpandedBag(bag, rules)).toBeUndefined();
    expect(bytes.subarray(SAVE_EXTRA_START)).toEqual(source.subarray(SAVE_EXTRA_START));
    const original = recoverSave(source, RETAIL_SAVE_LAYOUT);
    for (let index = 0; index < 73; index++) {
      if (index !== BAG_BLOCK && index !== PAL_PAD_BLOCK) expect(expanded.payloads[index]).toEqual(original.payloads[index]);
    }
    const back = recoverSave(convertSaveToRetail(bytes, rules).bytes, RETAIL_SAVE_LAYOUT);
    expect(back.payloads[BAG_BLOCK].subarray(0, 4)).toEqual(original.payloads[BAG_BLOCK].subarray(0, 4));
    expect(back.payloads[BAG_BLOCK].subarray(0x998)).toEqual(original.payloads[BAG_BLOCK].subarray(0x998));
  });

  it("keeps Battle Log records and drops other Pal Pad data", () => {
    const withLog = recoverSave(convertSaveToExpanded(retailSave({ battleLog: true }), rules).bytes, EXPANDED_SAVE_LAYOUT);
    expect(withLog.payloads[PAL_PAD_BLOCK].subarray(0, 4)).toEqual(new Uint8Array([0x4b, 0x4c, 0x4f, 0x47]));
    expect(withLog.payloads[PAL_PAD_BLOCK][0x6fb]).toBe(0x5a);
    const without = recoverSave(convertSaveToExpanded(retailSave(), rules).bytes, EXPANDED_SAVE_LAYOUT);
    expect(without.payloads[PAL_PAD_BLOCK].every((byte) => byte === 0)).toBe(true);
  });

  it("refuses what it cannot convert exactly", () => {
    const converted = convertSaveToExpanded(retailSave(), rules).bytes;
    expect(() => convertSaveToExpanded(converted, rules)).toThrow(/already/);
    const mixed = converted.slice();
    mixed.set(retailSave().subarray(0x26000, 0x4c000), 0x26000);
    expect(detectSaveFormat(mixed)).toBe("mixed");
    expect(() => convertSaveToExpanded(new Uint8Array(0x80000).fill(0xff), rules)).toThrow(/No retail/);
    expect(() => convertSaveToExpanded(retailSave({ version: 21 }), rules)).toThrow(/not a Black 2/);
    expect(() => convertSaveToExpanded(retailSave(), { pocketOf: (item) => (item === 442 ? undefined : 0) })).toThrow(/442/);
    expect(() => convertSaveToExpanded(retailSave().subarray(0, 0x40000), rules)).toThrow(/512 KiB/);
  });

  it("refuses to downgrade a bag holding an item above 638", () => {
    const converted = convertSaveToExpanded(retailSave(), rules);
    const recovered = recoverSave(converted.bytes, EXPANDED_SAVE_LAYOUT);
    const bag = recovered.payloads[BAG_BLOCK].slice();
    bag.copyWithin(8, 4, 4 + 5 * 4);
    bag[4] = 700 & 0xff; bag[5] = 700 >> 8; bag[6] = 1; bag[7] = 0;
    recovered.payloads[BAG_BLOCK] = bag;
    const withNew = encodeSave(converted.bytes, EXPANDED_SAVE_LAYOUT, recovered.payloads, recovered.counts, recovered.generation);
    expect(validateExpandedBag(bag, rules)).toBeUndefined();
    expect(() => convertSaveToRetail(withNew, rules)).toThrow(/700/);
  });

  it("recovers the newest valid generation when one copy is damaged", () => {
    const save = convertSaveToExpanded(retailSave(), rules).bytes.slice();
    save[0x400] ^= 0xff; // corrupt box 0 in the main copy only
    const recovered = recoverSave(save, EXPANDED_SAVE_LAYOUT);
    expect(recovered.recoveredBlocks).toBe(1);
    expect(recovered.payloads[1]).toEqual(recoverSave(convertSaveToExpanded(retailSave(), rules).bytes, EXPANDED_SAVE_LAYOUT).payloads[1]);
  });
});
