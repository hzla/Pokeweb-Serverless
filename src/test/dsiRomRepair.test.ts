import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU32 } from "../nds/binary";
import { NintendoDSRom, crc16 } from "../nds/rom";
import type { DsiExportWarning } from "../nds/dsiWarning";
import { repairDsiRom, dsiRepairedRomFilename } from "../pokeweb/dsiRomRepairModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderDsiRomRepairCard } from "../ui/dsiRomRepair";
import { bytes, makeTwlRom, verifyAllDigests } from "./fixtures/dsiRom";

const games = [["IRBO", "Black"], ["IRAO", "White"], ["IREO", "Black 2"], ["IRDO", "White 2"]] as const;

describe("damaged DSi exports", () => {
  it.each(games)("allows a warned %s DS export while preserving edits and original inputs", async (code) => {
    const donor = makeTwlRom(code);
    // Reproduce the old exporter's packed-program/stale-table layout.
    const source = new NintendoDSRom(donor).save({ forDsi: false });
    const before = source.slice(), original = new NintendoDSRom(source);
    const warnings: DsiExportWarning[] = [];
    const project = makeProject(source);
    project.fileSystem = { replacements: { 0: bytes(0x1800) } };
    const out = await exportModifiedRom(project, { onWarning: (warning) => warnings.push(warning) });
    const parsed = new NintendoDSRom(out);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("previous-exporter-dsi");
    expect(warnings[0].message).toContain("previous version of the Pokeweb exporter");
    expect(warnings[0].message).toContain("DS mode");
    expect(out.subarray(0x1c0, 0x208).every((v) => v === 0)).toBe(true);
    expect(readU32(out, 0x210)).toBe(0);
    expect(readU32(out, 0x220)).toBe(0);
    expect(parsed.files[0]).toEqual(bytes(0x1800));
    expect(parsed.arm9).toEqual(original.arm9);
    expect(parsed.arm7).toEqual(original.arm7);
    expect(parsed.fntData).toEqual(original.fntData);
    expect(parsed.save()).toEqual(out);
    expect(readU16(out, 0x92) * 0x80000).toBeGreaterThanOrEqual(readU32(out, 0x80));
    expect(readU16(out, 0x15e)).toBe(crc16(out.subarray(0, 0x15e)));
    expect(source).toEqual(before);
    expect(project.originalRomBytes).toBe(source);
    const repaired = await repairDsiRom(out, donor);
    expect(new NintendoDSRom(repaired.bytes).files[0]).toEqual(bytes(0x1800));
    verifyAllDigests(repaired.bytes);
  });

  it.each([
    (source: Uint8Array) => writeU32(source, 0x200, 0),
    (source: Uint8Array) => writeU32(source, 0x1f8, source.length + 4),
    (source: Uint8Array) => { source[0x6400] ^= 1; },
    (source: Uint8Array) => writeU32(source, 0x220, 0x72000),
    (source: Uint8Array) => { source.fill(0, 0x1c0, 0x208); writeU32(source, 0x210, 0); },
  ])("permits unknown missing/damaged DSi data with a qualified warning", (corrupt) => {
    const source = makeTwlRom("IRDO"); corrupt(source);
    const warnings: DsiExportWarning[] = [];
    const out = new NintendoDSRom(source).save({ allowDamagedDsi: true, onWarning: (warning) => warnings.push(warning) });
    expect(warnings[0].code).toBe("damaged-dsi");
    expect(warnings[0].message).toContain("could have caused");
    expect(new NintendoDSRom(out).arm9).toEqual(new NintendoDSRom(source).arm9);
    expect(() => new NintendoDSRom(out).save()).not.toThrow();
  });

  it("keeps forced DSi exports strict and refuses damaged native DS data", async () => {
    const source = makeTwlRom("IRDO"); writeU32(source, 0x200, 0);
    await expect(exportModifiedRom(makeProject(source), { forDsi: true })).rejects.toThrow("Cannot rebuild DSi");
    await expect(exportModifiedRom(makeProject(source), { allowDamagedDsi: false })).rejects.toThrow("Cannot rebuild DSi");
    writeU32(source, 0x5404, source.length + 1);
    expect(() => new NintendoDSRom(source).save({ allowDamagedDsi: true })).toThrow("DS file 0");
  });

  it("does not warn or downgrade intact DSi exports", async () => {
    const source = makeTwlRom("IRDO"), warnings: DsiExportWarning[] = [];
    const out = await exportModifiedRom(makeProject(source), { onWarning: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);
    verifyAllDigests(out);
  });
});

describe("donor DSi repair", () => {
  it.each(games)("repairs truncated %s DSi programs while preserving all edited DS content", async (code, game) => {
    const donor = makeTwlRom(code), source = donor.slice(0, 0x83680);
    source[0x4050] ^= 1;
    source[0x5600] ^= 1;
    writeU32(source, 0x200, 0);
    const sourceBefore = source.slice(), donorBefore = donor.slice();
    const progress: string[] = [];
    const result = await repairDsiRom(source, donor, (message) => { progress.push(message); });
    const original = new NintendoDSRom(source), repaired = new NintendoDSRom(result.bytes);
    expect(result.game).toBe(game);
    for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable", "fntData", "banner"] as const) expect(repaired[key]).toEqual(original[key]);
    expect(repaired.files).toEqual(original.files);
    const region = readU16(result.bytes, 0x92) * 0x80000;
    expect(result.bytes.subarray(region)).toEqual(donor.subarray(0x80000));
    expect(readU32(result.bytes, 0x220)).toBe(region + 0x3020);
    expect(result.bytes.subarray(0x300, 0x328)).toEqual(donor.subarray(0x300, 0x328));
    verifyAllDigests(result.bytes);
    expect(repaired.save()).toEqual(result.bytes);
    expect(progress).toHaveLength(6);
    expect(source).toEqual(sourceBefore);
    expect(donor).toEqual(donorBefore);
  });

  it.each(games)("restores stripped %s metadata and supports relocated digest configuration", async (code) => {
    const donor = makeTwlRom(code), source = donor.slice(0, 0x80000);
    source.copyWithin(0x4c00, 0x4900, 0x4940);
    source.fill(0, 0x4900, 0x4940);
    source.fill(0, 0x180, 0x1000);
    const result = await repairDsiRom(source, donor);
    expect(new NintendoDSRom(result.bytes).arm9).toEqual(new NintendoDSRom(source).arm9);
    verifyAllDigests(result.bytes);
  });

  it.each(games)("repairs a compacted %s editing copy shorter than the donor's declared NTR span", async (code) => {
    const donor = makeTwlRom(code), stripped = donor.slice(0, 0x80000);
    stripped.fill(0, 0x1c0, 0x208);
    writeU32(stripped, 0x210, 0);
    stripped.fill(0, 0x220, 0x230);
    const source = new NintendoDSRom(stripped).save({ allowDamagedDsi: true });
    expect(source.length).toBeLessThan(readU32(donor, 0x1e0) + readU32(donor, 0x1e4));
    const before = source.slice(), donorBefore = donor.slice();
    const result = await repairDsiRom(source, donor);
    const repaired = new NintendoDSRom(result.bytes), native = new NintendoDSRom(source);
    expect(repaired.arm9).toEqual(native.arm9);
    expect(repaired.arm7).toEqual(native.arm7);
    expect(repaired.files).toEqual(native.files);
    verifyAllDigests(result.bytes);
    expect(repaired.save()).toEqual(result.bytes);
    expect(source).toEqual(before);
    expect(donor).toEqual(donorBefore);
  });

  it.each(games)("preserves intact %s DSi data through ordinary export and reload", async (code) => {
    const source = makeTwlRom(code), before = source.slice(), warnings: DsiExportWarning[] = [];
    const out = await exportModifiedRom(makeProject(source), { onWarning: (warning) => warnings.push(warning) });
    expect(warnings).toEqual([]);
    verifyAllDigests(out);
    expect(new NintendoDSRom(out).save()).toEqual(out);
    expect(source).toEqual(before);
  });

  it.each(games)("requires a matching %s donor rather than another game or revision", async (code, game) => {
    const source = makeTwlRom(code), before = source.slice();
    for (const [other] of games.filter(([other]) => other !== code)) {
      const donor = makeTwlRom(other), donorBefore = donor.slice();
      await expect(repairDsiRom(source, donor)).rejects.toThrow(`clean ${game} ROM`);
      expect(donor).toEqual(donorBefore);
    }
    const revision = source.slice(); revision[0x1e] ^= 1;
    await expect(repairDsiRom(source, revision)).rejects.toThrow("revision");
    expect(source).toEqual(before);
  });

  it.each(["IRBJ", "IRAJ", "IPKE"])("rejects unsupported %s inputs without changing them", async (code) => {
    const source = makeTwlRom(code), before = source.slice();
    await expect(repairDsiRom(source, source)).rejects.toThrow("supports English");
    expect(source).toEqual(before);
  });

  it("recovers absent mapping represented by 0/1 placeholders in stripped ROMs", async () => {
    const donor = makeTwlRom("IRDO"), source = donor.slice(0, 0x80000);
    source.fill(0, 0x180, 0x1000);
    source.fill(1, 0x188, 0x1c0);
    const result = await repairDsiRom(source, donor);
    expect(result.bytes.subarray(0x180, 0x1c0)).toEqual(donor.subarray(0x180, 0x1c0));
    verifyAllDigests(result.bytes);
  });

  it.each([
    ["wrong game", (s: Uint8Array) => { s.set(new TextEncoder().encode("IREO"), 12); }, "match"],
    ["wrong revision", (s: Uint8Array) => { s[0x1e] ^= 1; }, "revision"],
    ["different mapping", (s: Uint8Array) => { s[0x180] ^= 1; }, "mapping"],
    ["different program addresses", (s: Uint8Array) => writeU32(s, 0x28, 0x02008000), "addresses"],
    ["different header layout", (s: Uint8Array) => writeU32(s, 0x84, 0x200), "header layout"],
    ["missing key", (s: Uint8Array) => { s.fill(0, 0x4900, 0x4940); }, "digest configuration"],
    ["truncated ARM9", (s: Uint8Array) => writeU32(s, 0x2c, s.length), "ARM9 program"],
    ["truncated native file", (s: Uint8Array) => writeU32(s, 0x5404, s.length + 1), "DS file 0"],
    ["malformed FAT", (s: Uint8Array) => writeU32(s, 0x4c, 7), "invalid size"],
  ] as const)("rejects %s without modifying either input", async (_name, corrupt, message) => {
    const source = makeTwlRom("IRDO"), donor = source.slice(); corrupt(source);
    const before = source.slice(), donorBefore = donor.slice();
    await expect(repairDsiRom(source, donor)).rejects.toThrow(message);
    expect(source).toEqual(before);
    expect(donor).toEqual(donorBefore);
  });

  it.each([
    (s: Uint8Array) => { s[0x6400] ^= 1; },
    (s: Uint8Array) => writeU32(s, 0x1f8, s.length + 4),
    (s: Uint8Array) => { s.fill(0, 0x1e0, 0x208); },
    (s: Uint8Array) => writeU32(s, 0x1cc, 0),
    (s: Uint8Array) => writeU32(s, 0x220, 0x1000),
  ])("rejects damaged or incomplete donor DSi data", async (corrupt) => {
    const source = makeTwlRom("IRDO"), donor = source.slice(); corrupt(donor);
    await expect(repairDsiRom(source, donor)).rejects.toThrow(/donor/i);
  });

  it("uses distinct download filenames and provides a separate local two-ROM homepage form", () => {
    expect(dsiRepairedRomFilename("my-hack.NDS")).toBe("my-hack-dsi-repaired.nds");
    const card = renderDsiRomRepairCard();
    expect(card).toContain("DSi ROM Repair");
    expect(card).toContain("Matching clean Black / White / Black 2 / White 2 ROM");
    expect(card.match(/type="file"/gu)).toHaveLength(2);
    expect(card).toContain('id="dsi-repair-download" type="button" disabled');
    expect(card).toContain('role="status"');
  });
});

function makeProject(source: Uint8Array): ProjectState {
  const rom = new NintendoDSRom(source);
  return {
    originalRomBytes: source,
    session: { romName: "fixture", baseVersion: rom.idCode === "IRDO" ? "W2" : rom.idCode === "IREO" ? "B2" : rom.idCode === "IRAO" ? "W" : "B", baseRom: ["IRBO", "IRAO"].includes(rom.idCode) ? "BW" : "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: rom.name, idCode: rom.idCode, fileName: "fixture.nds", size: source.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
  };
}
