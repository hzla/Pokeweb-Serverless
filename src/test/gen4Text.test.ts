import { describe, expect, it } from "vitest";
import { decodeGen4TextBank, encodeGen4TextBank, type TextEntry } from "../pokeweb/text";

describe("Gen 4 text codec", () => {
  it("round-trips encrypted message banks", () => {
    const entries: TextEntry[] = [
      ["0_0", "Tackle", 0x2468],
      ["0_1", "A! z?", 0x2468],
      ["0_2", "{TRNAME}{1234 5,6} ", 0x2468],
    ];

    const encoded = encodeGen4TextBank(entries);
    const decoded = decodeGen4TextBank(encoded);
    const reencoded = encodeGen4TextBank(decoded);

    expect(decoded.map((entry) => entry[1])).toEqual(entries.map((entry) => entry[1]));
    expect(reencoded).toEqual(encoded);
  });
});
