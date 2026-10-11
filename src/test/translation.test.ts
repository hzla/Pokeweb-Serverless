import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { Folder, addFilePath, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { decodeGen5TextBank, encodeGen5TextBank } from "../pokeweb/text";
import { assertTranslationPreservesCode, mergeTranslationTextArchive, translateWhite2ToItalian, translationRomFilename } from "../pokeweb/translationModel";
import { white2ItalianAssetVariant } from "../pokeweb/translationAssets";
import { TRANSLATION_LOCALES, loadTranslationProfile, translationFileNames, type TranslationProfile } from "../pokeweb/translationProfile";
import { planTranslationTransfers, translationSha256 } from "../pokeweb/translationTransfer";
import { compressLz11Literal } from "../pokeweb/pokemonSpriteModel";

const bank = (...texts: string[]) => encodeGen5TextBank(texts.map((text, index) => [`0_${index}`, text, 0]));
const narc = (...files: Uint8Array[]) => { const archive = new NARC(); archive.files = files; return archive; };
function romFixture(): NintendoDSRom {
  const bytes = new Uint8Array(0x6000), fnt = saveFnt(new Folder({ firstId: 1, files: ["asset.narc", "other.bin"] }));
  bytes.set(new TextEncoder().encode("POKEMON W2"), 0);
  bytes.set(new TextEncoder().encode("IRDO"), 12);
  for (const [at, value] of [[0x20, 0x4000], [0x24, 0x2000000], [0x28, 0x2000000], [0x2c, 32],
    [0x30, 0x4200], [0x34, 0x2380000], [0x38, 0x2380000], [0x3c, 32], [0x40, 0x4400], [0x44, fnt.length],
    [0x48, 0x4600], [0x4c, 24], [0x50, 0x4800], [0x54, 32], [0x84, 0x4000]]) writeU32(bytes, at, value);
  bytes.fill(17, 0x4000, 0x4020); bytes.fill(23, 0x4200, 0x4220); bytes.set(fnt, 0x4400);
  const files = [Uint8Array.of(1, 2, 3, 4), narc(bank("Hello")).save(), Uint8Array.of(7, 8, 9)];
  files.forEach((file, id) => {
    const at = 0x4a00 + id * 0x400;
    writeU32(bytes, 0x4600 + id * 8, at); writeU32(bytes, 0x4604 + id * 8, at + file.length); bytes.set(file, at);
  });
  writeU32(bytes, 0x4800, 36); writeU32(bytes, 0x4804, 0x2150000); writeU32(bytes, 0x4808, 4);
  return new NintendoDSRom(bytes);
}

describe("Italian White 2 translation", () => {
  it("preserves US search IDs and trims only audited Italian-only story entries", () => {
    const source = narc(bank("Hello", "VAR(256, 0)"), bank("APPLE", "BOAT"), bank("Old", "Last"));
    const donor = narc(bank("Ciao", "VAR(256, 0)"), bank("ALBERO", "BARCA", "CASA"), bank("Prima", "Ultima", "Extra"));
    const result = mergeTranslationTextArchive(source, donor, [1], { "2": 2 });
    expect(decodeGen5TextBank(result.files[0]).map(e => e[1])).toEqual(["Ciao", "VAR(256, 0)"]);
    expect(result.files[1]).toEqual(source.files[1]);
    expect(decodeGen5TextBank(result.files[2]).map(e => [e[0], e[1]])).toEqual([["0_0", "Prima"], ["0_1", "Ultima"]]);
    expect(readU16(donor.files[2], 2)).toBe(3);
    result.files[1][0] = 0;
    expect(readU16(source.files[1], 0)).toBe(1);
  });
  it("rejects entry or block drift outside the reviewed exceptions without changing either input", () => {
    const source = narc(bank("One")), donor = narc(bank("Uno", "Due"));
    expect(() => mergeTranslationTextArchive(source, donor, [], {})).toThrow("unaudited entry");
    expect(() => mergeTranslationTextArchive(source, donor, [], { "0": 2 })).toThrow("audited entry limit");
    const blocks = narc(encodeGen5TextBank([["0_0", "Uno", 0], ["1_0", "Due", 0]]));
    expect(() => mergeTranslationTextArchive(source, blocks, [], {})).toThrow("block count");
    expect(decodeGen5TextBank(source.files[0])[0][1]).toBe("One");
  });
  it("allows resized assets with relocated FAT offsets while keeping native code and numeric file IDs", () => {
    const source = romFixture(), replacements = new Map([[1, narc(bank("Ciao".repeat(100))).save()]]);
    const exported = new NintendoDSRom(source.save({ files: replacements }));
    expect(() => assertTranslationPreservesCode(source, exported, replacements)).not.toThrow();
    expect(exported.fileId("asset.narc")).toBe(1);
    expect(exported.files[2]).toEqual(source.files[2]);
    exported.arm9[0] ^= 1;
    expect(() => assertTranslationPreservesCode(source, exported, replacements)).toThrow("arm9");
  });
  it("rejects overlay replacement and unrelated file damage even when the game code is unchanged", () => {
    const source = romFixture();
    const replacements = new Map([[0, source.files[0]]]);
    expect(() => assertTranslationPreservesCode(source, new NintendoDSRom(source.save()), replacements)).toThrow("overlay");
    const output = new NintendoDSRom(source.save()); output.files[2][0] ^= 1;
    expect(() => assertTranslationPreservesCode(source, output, new Map())).toThrow("unselected ROM file");
  });
  it("refuses edited or unidentified sources before using a donor", async () => {
    const source = romFixture();
    await expect(translateWhite2ToItalian(source.data, new Uint8Array())).rejects.toThrow("clean US White 2");
    source.data[15] = 73;
    await expect(translateWhite2ToItalian(source.data, new Uint8Array())).rejects.toThrow("clean US White 2 revision-0");
  });
  it("provides pinned Italian graphics alternatives only for reviewed members", () => {
    expect(white2ItalianAssetVariant("a/0/1/1", 438)?.expandedSha256).toMatch(/^[\da-f]{64}$/u);
    expect(white2ItalianAssetVariant("a/0/1/1", 430)).toBeUndefined();
    expect(translationRomFilename("White2.nds")).toBe("White2-Italian-0.3.0-alpha.nds");
  });
});

function dataRom(files: [string, Uint8Array][], code = "IRDO"): NintendoDSRom {
  const rom = romFixture();
  rom.files = [rom.files[0], ...files.map(([, bytes]) => bytes)];
  let names = new Folder();
  files.forEach(([path], index) => { names = addFilePath(names, path, index + 1); });
  rom.data.set(new TextEncoder().encode(code), 12);
  return new NintendoDSRom(rom.save({ filenames: names }));
}
async function baseline(source: NintendoDSRom, donor: NintendoDSRom): Promise<TranslationProfile> {
  const profile: TranslationProfile = { schemaVersion: 2, id: "fixture", locale: "italian", language: "Italian", version: "test", sourceCode: "IRDO", donorCode: "IRDI", revision: 0,
    sourceSha256: "", donorSha256: "", alphabetBanks: [1], storyBankLimits: {}, files: [], native: {}, overlays: {} };
  for (const [path, id] of translationFileNames(source.filenames)) {
    const a = source.files[id], b = donor.getFileByName(path);
    const x = new NARC(a), y = new NARC(b);
    const regionalMembers: Record<string, string> = {};
    for (let member = 0; member < y.files.length; member++) if (!x.files[member] || await translationSha256(y.files[member]) !== await translationSha256(x.files[member])) regionalMembers[member] = await translationSha256(y.files[member]);
    profile.files.push({ path, donorPath: path, sha256: await translationSha256(b), members: y.files.length, sourceMembers: x.files.length, regionalMembers,
      retainedMembers: path === "a/0/5/6" ? Object.keys(regionalMembers).map(Number) : [] });
  }
  for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable", "banner"] as const) profile.native[key] = await translationSha256(donor[key]);
  profile.overlays["arm9/36"] = await translationSha256(donor.files[0]);
  return profile;
}
const recordBytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

describe("Regional donor data transplant", () => {
  it("imports the US range of an audited extended story bank and records the omitted tail", async () => {
    const source = dataRom([["a/0/0/3", narc(bank("First", "Last")).save()]]);
    const donor = dataRom([["a/0/0/3", narc(bank("Primo", "Ultimo", "Extra")).save()]], "IRDI");
    const profile = await baseline(source, donor); profile.storyBankLimits[0] = 2;
    const plan = await planTranslationTransfers(source, donor, profile);
    const output = new NARC(plan.replacements.get(source.fileId("a/0/0/3"))!);
    expect(decodeGen5TextBank(output.files[0]).map(([id, text]) => [id, text])).toEqual([["0_0", "Primo"], ["0_1", "Ultimo"]]);
    expect(plan.records.find(item => item.scope === "member")).toMatchObject({ action: "imported", omittedEntries: 1, reason: expect.stringContaining("callers are not ported") });
  });
  it("detects native donor edits against the regional baseline even when they match US bytes", async () => {
    const files: [string, Uint8Array][] = [["data.narc", narc(recordBytes(4, 1)).save()]];
    const source = dataRom(files), stock = dataRom(files, "IRDI");
    stock.arm9[0] ^= 1; stock.files[0][0] ^= 1;
    const profile = await baseline(source, stock), donor = dataRom(files, "IRDI");
    const plan = await planTranslationTransfers(source, donor, profile);
    for (const path of ["arm9", "overlay/arm9/36"]) expect(plan.records.find(item => item.path === path)).toMatchObject({ action: "retained", change: "regional-and-hack", reason: expect.any(String) });
    expect(plan.replacements.size).toBe(0);
    assertTranslationPreservesCode(source, new NintendoDSRom(source.save({ files: plan.replacements })), plan.replacements);
  });
  it("records removed donor overlays individually and keeps the US overlay", async () => {
    const files: [string, Uint8Array][] = [["data.narc", narc(recordBytes(4, 1)).save()]];
    const source = dataRom(files), donor = dataRom(files, "IRDI"), profile = await baseline(source, donor);
    donor.arm9OverlayTable = new Uint8Array();
    const plan = await planTranslationTransfers(source, donor, profile);
    expect(plan.records.find(item => item.path === "overlay/arm9/36")).toMatchObject({ action: "retained", change: "hack", donor: { bytes: 0 }, reason: expect.stringContaining("removed") });
    assertTranslationPreservesCode(source, new NintendoDSRom(source.save({ files: plan.replacements })), plan.replacements);
  });
  it.each([
    ["german", "IRDD", "EINSTELLUNGEN DER NINTENDO WFC", "NINTENDO WFC-EINSTELLUNGEN"],
    ["spanish", "IRDS", "CONFIG. DE LA CWF DE NINTENDO", "CONFIG. CWF DE NINTENDO"],
  ] as const)("fits the stock %s WFC label without replacing custom hack labels or message IDs", async (locale, code, label, fitted) => {
    const messages = (wfc: string) => narc(...Array.from({ length: 372 }, (_, member) => member === 371 ? bank("Continue", "New game", "Gift", wfc) : bank("Other")));
    const source = dataRom([["a/0/0/2", messages("NINTENDO WFC SETTINGS").save()]]), stock = dataRom([["a/0/0/2", messages(label).save()]], code);
    const profile = await baseline(source, stock); profile.locale = locale;
    const plan = await planTranslationTransfers(source, stock, profile);
    const output = new NintendoDSRom(source.save({ files: plan.replacements })); assertTranslationPreservesCode(source, output, plan.replacements);
    expect(decodeGen5TextBank(new NARC(output.getFileByName("a/0/0/2")).files[371]).map(item => [item[0], item[1]])).toEqual([["0_0", "Continue"], ["0_1", "New game"], ["0_2", "Gift"], ["0_3", fitted]]);
    expect(plan.records.find(item => item.member === 371)?.adjustedTextEntries).toEqual([{ id: "0_3", before: label, after: fitted }]);
    const donor = dataRom([["a/0/0/2", messages("CUSTOM WIFI").save()]], code);
    const customPlan = await planTranslationTransfers(source, donor, profile), custom = new NARC(customPlan.replacements.get(source.fileId("a/0/0/2"))!);
    expect(decodeGen5TextBank(custom.files[371])[3][1]).toBe("CUSTOM WIFI");
    expect(customPlan.records.find(item => item.member === 371)?.adjustedTextEntries).toBeUndefined();
  });
  it("retains wider regional menu maps but imports compatible menu edits and localized labels", async () => {
    const menuMap = (width: number, height: number) => {
      const data = new Uint8Array(36 + width * height / 32);
      data.set(new TextEncoder().encode("RCSN")); writeU16(data, 24, width); writeU16(data, 26, height); writeU32(data, 32, data.length - 36);
      return data;
    };
    const menu = (width: number) => narc(...Array.from({ length: 8 }, (_, member) => member === 6 ? menuMap(width, 112) : member === 7 ? compressLz11Literal(menuMap(width, 24)) : Uint8Array.of(member)));
    const source = dataRom([["a/0/3/4", menu(208).save()], ["a/0/0/2", narc(bank("NEW GAME")).save()]]);
    const stock = dataRom([["a/0/3/4", menu(232).save()], ["a/0/0/2", narc(bank("NEUES SPIEL")).save()]], "IRDD");
    const profile = await baseline(source, stock), editedMenu = menu(232); editedMenu.files[1][0] = 99;
    const donor = dataRom([["a/0/3/4", editedMenu.save()], ["a/0/0/2", stock.getFileByName("a/0/0/2")]], "IRDD");
    const plan = await planTranslationTransfers(source, donor, profile), output = new NintendoDSRom(source.save({ files: plan.replacements }));
    assertTranslationPreservesCode(source, output, plan.replacements);
    const result = new NARC(output.getFileByName("a/0/3/4")), original = new NARC(source.getFileByName("a/0/3/4"));
    expect(result.files[1][0]).toBe(99);
    for (const member of [6, 7]) {
      expect(result.files[member]).toEqual(original.files[member]);
      expect(plan.records.find(item => item.path === "a/0/3/4" && item.member === member)).toMatchObject({ action: "retained", change: "regional", reason: expect.stringContaining("row stride") });
    }
    expect(decodeGen5TextBank(new NARC(output.getFileByName("a/0/0/2")).files[0])[0][1]).toBe("NEUES SPIEL");
    const compatible = menu(208); compatible.files[6][40] = 99;
    const compatibleDonor = dataRom([["a/0/3/4", compatible.save()], ["a/0/0/2", stock.getFileByName("a/0/0/2")]], "IRDD");
    const compatiblePlan = await planTranslationTransfers(source, compatibleDonor, profile);
    expect(compatiblePlan.records.find(item => item.path === "a/0/3/4" && item.member === 6)).toMatchObject({ action: "imported", change: "regional-and-hack" });
  });
  it("moves gameplay and trade edits, retains invalid scripts and native dependencies, and preserves US code", async () => {
    const files: [string, Uint8Array][] = [
      ["a/0/1/6", narc(recordBytes(64, 1), recordBytes(64, 2)).save()],
      ["a/0/2/1", narc(recordBytes(36, 3), recordBytes(36, 4)).save()],
      ["a/0/5/6", narc(recordBytes(48, 5), recordBytes(48, 6)).save()],
      ["a/1/6/3", narc(recordBytes(92, 7)).save()],
      ["a/0/0/2", narc(bank("Hello"), bank("APPLE")).save()],
    ];
    const source = dataRom(files), stock = dataRom(files, "IRDI");
    const script = new NARC(stock.getFileByName("a/0/5/6")); script.files[1][0] = 16;
    const trade = new NARC(stock.getFileByName("a/1/6/3")); trade.files[0][88] = 4;
    const text = narc(bank("Ciao"), bank("ALBERO"));
    const regionalFiles = files.map(([path, bytes]) => [path, path === "a/0/5/6" ? script.save() : path === "a/1/6/3" ? trade.save() : path === "a/0/0/2" ? text.save() : bytes] as [string, Uint8Array]);
    const cleanDonor = dataRom(regionalFiles, "IRDI"), profile = await baseline(source, cleanDonor);
    const hackedFiles = regionalFiles.map(([path, bytes]) => {
      const archive = new NARC(bytes);
      if (path === "a/0/1/6") archive.files[1][0] = 99;
      if (path === "a/0/2/1") archive.files[0][3] = 120;
      if (path === "a/0/5/6") { archive.files[0][5] = 44; archive.files[1][1] = 55; }
      if (path === "a/1/6/3") archive.files[0][2] = 11;
      return [path, archive.save()] as [string, Uint8Array];
    }).reverse();
    const donor = dataRom(hackedFiles, "IRDI"); donor.arm9[0] ^= 1; donor.files[0][0] ^= 1;
    const inputHash = await translationSha256(source.data), donorHash = await translationSha256(donor.data);
    const plan = await planTranslationTransfers(source, donor, profile);
    const output = new NintendoDSRom(source.save({ files: plan.replacements }));
    assertTranslationPreservesCode(source, output, plan.replacements);
    expect(new NARC(output.getFileByName("a/0/1/6")).files[1][0]).toBe(99);
    expect(new NARC(output.getFileByName("a/0/2/1")).files[0][3]).toBe(120);
    const scripts = new NARC(output.getFileByName("a/0/5/6"));
    expect(scripts.files).toEqual(new NARC(source.getFileByName("a/0/5/6")).files);
    expect(plan.scriptAudits[0].diagnostics).toContainEqual(expect.objectContaining({ code: "donor-native-dependency", dependency: "arm9" }));
    const trades = new NARC(output.getFileByName("a/1/6/3")); expect(trades.files[0][2]).toBe(11); expect(trades.files[0][88]).toBe(7);
    const messages = new NARC(output.getFileByName("a/0/0/2"));
    expect(decodeGen5TextBank(messages.files[0])[0][1]).toBe("Ciao"); expect(decodeGen5TextBank(messages.files[1])[0][1]).toBe("APPLE");
    expect(plan.records.find(item => item.path === "a/0/1/6" && item.member === 1)).toMatchObject({ action: "imported", change: "hack", sourceFileId: 1, donorFileId: 5, source: { bytes: 64 }, output: { bytes: 64 } });
    expect(plan.records.find(item => item.path === "a/0/1/6" && item.member === 1)?.fields).toContainEqual({ field: "base_hp", offset: 0, before: 2, after: 99 });
    expect(plan.records.find(item => item.path === "a/0/2/1" && item.member === 0)?.fields).toContainEqual({ field: "power", offset: 3, before: 3, after: 120 });
    expect(plan.records.find(item => item.path === "a/0/5/6" && item.member === 1)).toMatchObject({ action: "retained", change: "regional-and-hack" });
    expect(plan.records.find(item => item.path === "arm9")).toMatchObject({ action: "retained", change: "hack" });
    expect(plan.records.find(item => item.path === "overlay/arm9/36")).toMatchObject({ action: "retained", change: "hack" });
    for (const item of plan.records.filter(item => item.action === "imported")) {
      const bytes = item.scope === "member" ? new NARC(output.getFileByName(item.path)).files[item.member!] : output.getFileByName(item.path);
      expect(item.output?.sha256).toBe(await translationSha256(bytes));
    }
    expect(await translationSha256(source.data)).toBe(inputHash); expect(await translationSha256(donor.data)).toBe(donorHash);
  });
  it("audits scripts after text merging and imports compatible stock regional and minor hack changes", async () => {
    const script = (message: number) => {
      const bytes = new Uint8Array(14); writeU32(bytes, 0, 2); writeU16(bytes, 4, 0xfd13);
      writeU16(bytes, 6, 0x34); writeU16(bytes, 8, message); writeU16(bytes, 12, 2); return bytes;
    };
    const header = new Uint8Array(48);
    const files: [string, Uint8Array][] = [["a/0/5/6", narc(script(0)).save()], ["a/0/1/2", narc(header).save()], ["a/0/0/3", narc(bank("One", "Two")).save()]];
    const source = dataRom(files);
    const stock = dataRom([["a/0/0/3", narc(bank("Uno", "Due")).save()], ["a/0/1/2", narc(header).save()], ["a/0/5/6", narc(script(1)).save()]], "IRDI");
    const profile = await baseline(source, stock);
    const regional = await planTranslationTransfers(source, stock, profile);
    expect(profile.files.find(file => file.path === "a/0/5/6")!.retainedMembers).toEqual([0]);
    expect(regional.scriptAudits[0].status).toBe("imported");
    expect(regional.scriptAudits[0].references[0]).toMatchObject({ bank: 0, messageId: 1, donorText: "Due", outputText: "Due" });
    const output = new NintendoDSRom(source.save({ files: regional.replacements })); assertTranslationPreservesCode(source, output, regional.replacements);
    expect(readU16(new NARC(output.getFileByName("a/0/5/6")).files[0], 8)).toBe(1);
    // An extra entry rejected by text merging must not silently become a script reference.
    const edited = dataRom([["a/0/0/3", narc(bank("Uno", "Due", "Extra")).save()], ["a/0/1/2", narc(header).save()], ["a/0/5/6", narc(script(2)).save()]], "IRDI");
    const rejected = await planTranslationTransfers(source, edited, profile);
    expect(rejected.scriptAudits[0]).toMatchObject({ status: "retained", references: [expect.objectContaining({ messageId: 2, status: "unresolved", donorText: "Extra" })] });
    expect(rejected.records.find(record => record.path === "a/0/5/6" && record.scope === "member")).toMatchObject({ action: "retained", change: "regional-and-hack" });
  });
  it("records unsupported expansions, broken member bounds and fixed-record size changes without importing them", async () => {
    const original = narc(recordBytes(64, 1)).save(), source = dataRom([["a/0/1/6", original]]);
    const stock = dataRom([["a/0/1/6", original]], "IRDI"), profile = await baseline(source, stock);
    for (const bytes of [narc(recordBytes(64, 1), recordBytes(64, 2)).save(), narc(recordBytes(65, 2)).save(), original.slice(0, -8)]) {
      const donor = dataRom([["a/0/1/6", bytes]], "IRDI"), plan = await planTranslationTransfers(source, donor, profile);
      expect(plan.replacements.size).toBe(0);
      expect(plan.records.some(item => item.path === "a/0/1/6" && item.action !== "imported" && item.change === "hack" && item.reason)).toBe(true);
    }
  });
  it("keeps new donor files out of the US file table and logs them as skipped hack changes", async () => {
    const data = narc(recordBytes(4, 1)).save(), source = dataRom([["stock.narc", data]]), stock = dataRom([["stock.narc", data]], "IRDI");
    const profile = await baseline(source, stock);
    const donor = dataRom([["stock.narc", data], ["patches/new.dll", recordBytes(16, 4)]], "IRDI");
    const plan = await planTranslationTransfers(source, donor, profile);
    expect(plan.replacements.size).toBe(0);
    expect(plan.records.find(item => item.path === "patches/new.dll")).toMatchObject({ action: "skipped", change: "hack", source: null, output: null });
  });
  it.each(TRANSLATION_LOCALES)("loads an audited $language baseline with no shipped ROM payloads", async locale => {
    const profile = await loadTranslationProfile(locale.id);
    expect(profile.donorCode).toBe(locale.gameCode);
    expect(profile.files.length).toBe(318);
    expect(profile.files.some(file => file.path === "a/0/1/6" && file.members! > 649)).toBe(true);
    expect(profile.alphabetBanks.at(-1)).toBe(locale.id === "korean" ? 139 : 138);
  });
});
