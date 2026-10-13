import { describe, expect, it } from "vitest";
import { decodeGen5TextBank, encodeGen5TextBank } from "../pokeweb/text";
import { fillTranslationArticleNames } from "../pokeweb/translationNames";
import { validateTranslationTrainerText } from "../pokeweb/translationTrainerText";
import { writeU16 } from "../nds/binary";
const bank = (...text: string[]) => encodeGen5TextBank(text.map((value, i) => [`0_${i}`, value, 0]));
const words = (values: number[]) => { const bytes = new Uint8Array(values.length * 2); values.forEach((value, i) => writeU16(bytes, i * 2, value)); return bytes; };

describe("US native localized names", () => {
  it("fills blank article forms with the final localized names while keeping donor-authored forms", () => {
    const forms = bank("", "  ", "custom article"), names = bank("MT01", "edited MT02", "other");
    const result = fillTranslationArticleNames(forms, names);
    expect(decodeGen5TextBank(result.bytes).map(entry => entry[1])).toEqual(["MT01", "edited MT02", "custom article"]);
    expect(result.adjustedTextEntries).toEqual([{ id: "0_0", before: "", after: "MT01" }, { id: "0_1", before: "  ", after: "edited MT02" }]);
    expect(decodeGen5TextBank(forms)[0][1]).toBe("");
  });
  it("rejects changed name IDs and leaves genuinely empty name slots empty", () => {
    expect(() => fillTranslationArticleNames(bank(""), bank("one", "two"))).toThrow("different IDs");
    const result = fillTranslationArticleNames(bank(""), bank(""));
    expect(result.adjustedTextEntries).toHaveLength(0);
  });
});
describe("Linked trainer dialogue data", () => {
  it("accepts additions and deletions when all three files still resolve", () => {
    expect(() => validateTranslationTrainerText(bank("first", "new", "last"), words([0, 0, 1, 0, 2, 0]), words([0, 4, 8]), 6)).not.toThrow();
    expect(() => validateTranslationTrainerText(bank("first"), words([0, 0]), words([0, 4, 4]), 6)).not.toThrow();
  });
  it("rejects mismatched row counts, unaligned/skipping offsets and unsupported trainer IDs", () => {
    expect(() => validateTranslationTrainerText(bank("one", "two"), words([0, 0]), words([0]), 2)).toThrow("entry count");
    expect(() => validateTranslationTrainerText(bank("one"), words([0, 0]), words([1]), 2)).toThrow("unaligned");
    expect(() => validateTranslationTrainerText(bank("one"), words([0, 0]), words([4]), 2)).toThrow("skips");
    expect(() => validateTranslationTrainerText(bank("one"), words([1, 0]), words([0]), 2)).toThrow("unsupported trainer");
    expect(() => validateTranslationTrainerText(bank("one"), words([0, 0]), words([0, 4]), 2)).toThrow("trainer-ID range");
  });
});
