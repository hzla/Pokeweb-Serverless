import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { encodeGen5TextBank } from "../pokeweb/text";
import { validateRomData } from "../pokeweb/romDataValidation";
import { coreDataFixture } from "./fixtures/romDataValidationRom";

describe("core Gen 5 ROM data validation", () => {
  it.each(["B", "W", "B2", "W2"] as const)("accepts valid %s tables without changing the ROM", version => {
    const fixture = coreDataFixture(version), bytes = fixture.rom(), before = bytes.slice(), report = validateRomData(bytes);
    expect(report.errors).toBe(0); expect(report.warnings).toBe(0); expect(report.version).toBe(version);
    expect(report.archives.find(a => a.archive === "encounters")?.checked).toBe(1);
    expect(bytes).toEqual(before);
  });
  it("finds Ledyba's exact malformed held item and keeps packed ability bits separate", () => {
    const f = coreDataFixture();
    // An expanded ability 257 plus valid item 1 is not item 0x4001.
    writeU16(f.files.personal[1], 12, 0x4001); f.files.personal[1][24] = 1;
    f.files.message_texts[374] = encodeGen5TextBank(Array.from({ length: 258 }, (_, id) => [`0_${id}`, `Ability ${id}`, 0]));
    writeU16(f.files.personal[2], 12, 0x3fff);
    const report = validateRomData(f.rom());
    expect(report.errors).toBe(1);
    expect(report.issues[0]).toMatchObject({ archive: "personal", record: 2, field: "item_1", offset: 12, value: 16383, code: "reference.invalid", severity: "error" });
  });
  it("uses expanded move/species tables and Fairy names instead of retail ID caps", () => {
    const f = coreDataFixture();
    f.files.personal.push(f.files.personal[1].slice()); f.files.personal[1][32] = 2; writeU16(f.files.personal[1], 28, 3);
    f.files.learnsets.push(f.files.learnsets[1].slice()); f.files.evolutions.push(new Uint8Array(42));
    f.files.moves = Array.from({ length: 601 }, (_, id) => id ? f.files.moves[1].slice() : new Uint8Array(36));
    f.files.moves[600][0] = 17; writeU16(f.files.learnsets[1], 0, 600);
    f.files.message_texts[398] = encodeGen5TextBank(Array.from({ length: 18 }, (_, id) => [`0_${id}`, `Type ${id}`, 0]));
    writeU16(f.files.encounters[0], 8, 1 | 1 << 11);
    const report = validateRomData(f.rom()); expect(report.errors).toBe(0); expect(report.warnings).toBe(0);
    expect(report.limits.moveRecords).toBe(601); expect(report.limits.types).toBe(18);
  });
  it("accepts native sentinels, signed fields, color flags and trainer IV quality", () => {
    const f = coreDataFixture();
    f.files.moves[1][4] = 101; f.files.moves[1][6] = 253; f.files.moves[1][14] = 6; f.files.moves[1][24] = 250;
    writeU16(f.files.moves[1], 8, 0xffff); writeU16(f.files.moves[2], 8, 21); f.files.personal[1][33] = 0xc7;
    const report = validateRomData(f.rom()); expect(report.errors).toBe(0); expect(report.warnings).toBe(0);
  });
  it("skips the regional Dex lookup member rather than decoding it as a Pokemon", () => {
    const f = coreDataFixture();
    f.files.personal = Array.from({ length: 710 }, (_, id) => id === 709 ? new Uint8Array(1370).fill(255) : id < 3 ? f.files.personal[id] : new Uint8Array(76));
    const report = validateRomData(f.rom()); expect(report.errors).toBe(0); expect(report.warnings).toBe(0);
    f.files.personal[709] = new Uint8Array(3);
    expect(validateRomData(f.rom()).issues).toContainEqual(expect.objectContaining({ archive: "personal", record: 709, field: "regional Dex table length", severity: "error" }));
  });
  it.each([
    ["moves", (f: ReturnType<typeof coreDataFixture>) => { f.files.moves[1][2] = 99; }, "category"],
    ["moves", (f: ReturnType<typeof coreDataFixture>) => { f.files.moves[1][4] = 200; }, "accuracy"],
    ["personal", (f: ReturnType<typeof coreDataFixture>) => { f.files.personal[1][6] = 99; }, "type_1"],
    ["personal", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.personal[1], 28, 999); f.files.personal[1][32] = 2; }, "form_id"],
    ["learnsets", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.learnsets[1], 0, 999); }, "move_0"],
    ["egg_moves", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.egg_moves[1], 0, 50); }, "move count"],
    ["evolutions", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.evolutions[1], 4, 999); }, "slot_0.target"],
    ["evolutions", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.evolutions[1], 0, 16); writeU16(f.files.evolutions[1], 2, 65535); }, "slot_0.beauty"],
    ["trpok", (f: ReturnType<typeof coreDataFixture>) => { f.files.trpok[1][2] = 150; }, "slot_0.level"],
    ["trpok", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.trpok[1], 8, 999); }, "slot_0.item"],
    ["marts", (f: ReturnType<typeof coreDataFixture>) => { f.files.mart_counts[0][1] = 20; }, "count"],
    ["baby_species", (f: ReturnType<typeof coreDataFixture>) => { writeU16(f.files.baby_species[1], 0, 999); }, "baby_species"],
    ["ingame_trades", (f: ReturnType<typeof coreDataFixture>) => { writeU32(f.files.ingame_trades[0], 16, 99); }, "iv_0"],
  ] as const)("reports a corrupt %s field", (archive, mutate, field) => {
    const f = coreDataFixture(); mutate(f);
    expect(validateRomData(f.rom()).issues).toContainEqual(expect.objectContaining({ severity: "error", archive, field }));
  });
  it("checks all seasons and treats invalid inactive slots as warnings", () => {
    const f = coreDataFixture(), one = f.files.encounters[0];
    const seasons = new Uint8Array(928); for (let season = 0; season < 4; season++) seasons.set(one, season * 232);
    seasons[3 * 232 + 10] = 80; seasons[3 * 232 + 11] = 20;
    // Surf is disabled, but stale populated slots are still reported.
    writeU16(seasons, 8 + 36 * 4, 999); seasons[8 + 36 * 4 + 2] = 5; seasons[8 + 36 * 4 + 3] = 5;
    f.files.encounters[0] = seasons;
    const report = validateRomData(f.rom());
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: "error", field: "winter.grass.slot_0.levels" }));
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: "warning", field: "spring.surf.slot_0.species" }));
  });
  it("finds missing related records, unterminated learnsets and truncated parties", () => {
    const f = coreDataFixture(); f.files.evolutions.pop(); f.files.learnsets[1] = f.files.learnsets[1].slice(0, 4); f.files.trpok[1] = f.files.trpok[1].slice(0, 8);
    const report = validateRomData(f.rom());
    for (const code of ["reference.missing-record", "learnset.unterminated", "record.truncated"]) expect(report.issues.some(i => i.code === code)).toBe(true);
  });
  it("reports opaque custom party layouts without pretending to validate their slots", () => {
    const f = coreDataFixture(); f.files.trdata[1][0] = 0x80;
    const report = validateRomData(f.rom()); expect(report.errors).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "layout.custom", severity: "warning" }));
    expect(report.archives.find(a => a.archive === "trpok")?.checked).toBe(0);
  });
  it("rejects FAT members outside physical data even when NARC's reader would clamp", () => {
    const f = coreDataFixture();
    const report = validateRomData(f.rom((name, bytes) => { if (name === "personal") writeU32(bytes, 32, bytes.length * 10); return bytes; }));
    expect(report.issues).toContainEqual(expect.objectContaining({ archive: "personal", code: "archive.invalid", severity: "error" }));
  });
  it("reports stale image size metadata as a warning when every member is physically intact", () => {
    const f = coreDataFixture();
    const report = validateRomData(f.rom((name, bytes) => { if (name === "items") { const image = 16 + readU32(bytes, 20) + readU32(bytes, 16 + readU32(bytes, 20) + 4); writeU32(bytes, image + 4, readU32(bytes, image + 4) + 4); } return bytes; }));
    expect(report.errors).toBe(0); expect(report.issues).toContainEqual(expect.objectContaining({ archive: "items", code: "archive.image-size", severity: "warning" }));
  });
  it("keeps accurate totals and prioritizes errors when retained details are capped", () => {
    const f = coreDataFixture(); f.files.personal[1][0] = 0; writeU16(f.files.personal[2], 12, 999); f.files.moves[1][2] = 255;
    const report = validateRomData(f.rom(), { maxIssues: 1 });
    expect(report.errors).toBe(2); expect(report.warnings).toBe(1); expect(report.omittedIssues).toBe(2); expect(report.issues[0].severity).toBe("error");
  });
  it("rejects unsupported games, truncated ROM sections and invalid scan options", () => {
    const f = coreDataFixture(), bytes = f.rom(); bytes.set(new TextEncoder().encode("IPKE"), 12);
    expect(() => validateRomData(bytes)).toThrow(/supports/u);
    expect(() => validateRomData(f.rom().slice(0, 0x4500))).toThrow(/truncated/u);
    expect(() => validateRomData(f.rom(), { maxIssues: -1 })).toThrow(/maxIssues/u);
  });
});
