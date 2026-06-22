import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import { decodeGen4TextBank, encodeGen4TextBank, type TextEntry } from "../pokeweb/text";

describe("Gen 4 text codec", () => {
  it("round-trips encrypted message banks", () => {
    const entries: TextEntry[] = [
      ["0_0", "Tackle", 0x2468],
      ["0_1", "A! z?", 0x2468],
      ["0_2", "{1234 5,6} ", 0x2468],
    ];

    const encoded = encodeGen4TextBank(entries);
    const decoded = decodeGen4TextBank(encoded);
    const reencoded = encodeGen4TextBank(decoded);

    expect(decoded.map((entry) => entry[1])).toEqual(entries.map((entry) => entry[1]));
    expect((readU32(encoded, 4) ^ gen4AllocationKey(0, 0x2468)) >>> 0).toBe(4 + entries.length * 8);
    expect(reencoded).toEqual(encoded);
  });

  it("round-trips Gen 4 trainer-name strings", () => {
    const entries: TextEntry[] = [
      ["0_0", "{TRAINER_NAME:Tristan}", 0x1357],
      ["0_1", "{TRAINER_NAME:Liv & Liz}", 0x1357],
    ];

    const encoded = encodeGen4TextBank(entries);
    const decoded = decodeGen4TextBank(encoded);
    const reencoded = encodeGen4TextBank(decoded);

    expect(decoded).toEqual(entries);
    expect(reencoded).toEqual(encoded);
  });
});

function gen4AllocationKey(entryIndex: number, bankKey: number): number {
  return ((((765 * (entryIndex + 1) * bankKey) & 0xffff) * 0x10001) >>> 0);
}
