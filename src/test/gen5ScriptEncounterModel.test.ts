import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { parseGen5ScriptEncounters, patchGen5ScriptEncounters, scanGen5ScriptEncounterRefs } from "../pokeweb/gen5ScriptEncounterModel";

describe("gen5ScriptEncounterModel", () => {
  it("parses direct gift Pokemon commands", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x10c, 0x8010, 1, 0, 10]), "BW2")).toEqual([
      { kind: "gift", speciesId: 1, level: 10, form: 0 },
    ]);
  });

  it("parses gift Pokemon commands that start on odd byte offsets", () => {
    const bytes = makeScriptFileBytes([0xff, 0x0c, 0x01, 0x10, 0x80, 0x02, 0x00, 0x00, 0x00, 0x05, 0x00]);

    expect(parseGen5ScriptEncounters(bytes, "BW2")).toEqual([{ kind: "gift", speciesId: 2, level: 5, form: 0 }]);
  });

  it("parses extended gift Pokemon commands", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x10e, 0x8010, 2, 1, 12, 0, 0, 0, 0, 4]), "BW2")).toEqual([
      { kind: "gift", speciesId: 2, level: 12, form: 1 },
    ]);
  });

  it("parses N-style gift Pokemon commands", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x2ea, 0x8010, 3, 25, 0, 0, 0]), "BW2")).toEqual([
      { kind: "gift", speciesId: 3, level: 25, form: 0 },
    ]);
  });

  it("parses gift eggs as level 1 gifts", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x10f, 0x8010, 4, 0]), "BW2")).toEqual([
      { kind: "gift", speciesId: 4, level: 1, form: 0 },
    ]);
  });

  it("parses BW scripted wild battles with zero flags", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x178, 5, 30, 0]), "BW")).toEqual([
      { kind: "static", speciesId: 5, level: 30, form: 0 },
    ]);
  });

  it("parses BW2 scripted wild battle commands, including form-aware commands", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x174, 6, 35, 0, 0x297, 7, 40, 2, 0]), "BW2")).toEqual([
      { kind: "static", speciesId: 6, level: 35, form: 0 },
      { kind: "static", speciesId: 7, level: 40, form: 2 },
    ]);
  });

  it("exports scripted wild battles with nonzero battle fields", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x174, 8, 45, 1]), "BW2")).toEqual([
      { kind: "static", speciesId: 8, level: 45, form: 0 },
    ]);
  });

  it("resolves simple WorkSetConst variables before encounter commands", () => {
    expect(
      parseGen5ScriptEncounters(makeScriptFile([0x28, 0x4000, 9, 0x28, 0x4001, 50, 0x174, 0x4000, 0x4001, 0]), "BW2"),
    ).toEqual([{ kind: "static", speciesId: 9, level: 50, form: 0 }]);
  });

  it("skips unresolved variables and invalid levels", () => {
    expect(parseGen5ScriptEncounters(makeScriptFile([0x10c, 0, 0x4000, 0, 10, 0x174, 10, 0, 0]), "BW2")).toEqual([]);
  });

  it("retains writable provenance for variable gifts and distinguishes eggs", () => {
    const bytes = makeScriptFile([0x28, 0x4000, 9, 0x10c, 0x8010, 0x4000, 2, 10, 0x10f, 0x8010, 4, 0]);
    const refs = scanGen5ScriptEncounterRefs(bytes, "BW2");

    expect(refs.map((ref) => ({ kind: ref.kind, species: ref.speciesId, offset: ref.speciesRef.valueOffset }))).toEqual([
      { kind: "gift", species: 9, offset: 12 },
      { kind: "egg", species: 4, offset: 28 },
    ]);

    const patched = patchGen5ScriptEncounters(bytes, [
      { encounter: refs[0]!, speciesId: 25, form: 0 },
      { encounter: refs[1]!, speciesId: 133, form: 0 },
    ]);
    expect(readU16(patched, 12)).toBe(25);
    expect(readU16(patched, 28)).toBe(133);
    expect(readU16(patched, 30)).toBe(0);
  });
});

function makeScriptFile(words: number[]): Uint8Array {
  const body = new Uint8Array(words.length * 2);
  words.forEach((word, index) => writeInt(body, index * 2, 2, word));
  return makeScriptFileBytes([...body]);
}

function makeScriptFileBytes(body: number[]): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  writeInt(out, 0, 4, 4);
  writeInt(out, 4, 2, 0xfd13);
  out.set(body, 8);
  return out;
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}
