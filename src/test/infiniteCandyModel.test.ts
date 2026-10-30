import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU16, writeU32, readU16 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { encodeGen5TextBank } from "../pokeweb/text";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getInfiniteCandyStatus, getInstalledInfiniteCandyItemId, installInfiniteCandy } from "../pokeweb/infiniteCandyModel";
import { getTextBank } from "../pokeweb/textModel";
import { getLevelCapsStatus, installLevelCaps } from "../pokeweb/levelCapsModel";
import { getLevelCapsRuntime } from "../pokeweb/levelCapsRuntime";
import { stageCodeInjectionDll } from "../pokeweb/pmcModel";
import levelCapsManifest from "../assets/codeinjection/levelCapsManifest.json";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import template from "../assets/codeinjection/infiniteCandyBw2Manifest.json";
import type { ProjectState } from "../pokeweb/projectStore";

afterEach(() => vi.unstubAllGlobals());
function assets() { vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(new Uint8Array(readFileSync(url))))); }
async function fixture(game: "W2" | "B2", custom622 = true): Promise<ProjectState> {
  const white = game === "W2", base = 0x02004000;
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(white ? "IRDO" : "IREO"), 12);
  rom.arm9RamAddress = base; writeU32(rom.data, 0x28, base);
  rom.arm9 = new Uint8Array(0xa0000); rom.arm7 = new Uint8Array(4);
  rom.files = Array.from({ length: 346 }, () => new Uint8Array(4));
  rom.arm9OverlayTable = new Uint8Array(344 * 32); rom.filenames = new Folder();
  for (let id = 0; id < 344; ++id) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  for (const [id, address, hex] of [[12, white ? 0x0215b8ac : 0x0215b86c, "ac308742"], [165, white ? 0x0219e688 : 0x0219e648, "08b5031ca3208000"]] as const) {
    rom.files[id] = new Uint8Array(Buffer.from(hex, "hex"));
    writeU32(rom.arm9OverlayTable, id * 32 + 4, address); writeU32(rom.arm9OverlayTable, id * 32 + 8, rom.files[id].length);
  }
  // Include the independent Hard Level Caps hooks in the synthetic ROM.
  const party = rom.files[165]!, expandedParty = new Uint8Array(0x4000); expandedParty.set(party); rom.files[165] = expandedParty;
  writeU32(rom.arm9OverlayTable, 165 * 32 + 8, expandedParty.length);
  const battleHooks = [
    [36, 0x021bd300, white ? 0x021bd52c : 0x021bd4f4, "f8b582b0051ca868"],
    [36, 0x021bd300, white ? 0x021bd3a8 : 0x021bd370, "00f06af9"],
    [36, 0x021bd300, white ? 0x021bd6d8 : 0x021bd6a0, "5ff636fb"],
    [167, 0x021af000, white ? 0x021af0b0 : 0x021af070, white ? "64f69efb" : "64f6befb"],
  ] as const;
  for (const id of [36, 167]) { rom.files[id] = new Uint8Array(0x1000); writeU32(rom.arm9OverlayTable, id * 32 + 4, id === 36 ? 0x021bd300 : 0x021af000); writeU32(rom.arm9OverlayTable, id * 32 + 8, 0x1000); }
  for (const [id, address, hook, data] of battleHooks) rom.files[id]!.set(Buffer.from(data, "hex"), hook - address);
  // The B2 Day Care commit call has a different BL displacement.
  if (!white) rom.files[36]!.set(Buffer.from("5ff63cfb", "hex"), 0x021bd6a0 - 0x021bd300);
  expandedParty.set(Buffer.from("f0b587b0171c1a04", "hex"), 0x3da0);
  const pocket = (white ? 0x0208f4fc : 0x0208f4d0) - base;
  const iconsAt = (white ? 0x02090d7c : 0x02090d50) - base;
  rom.arm9[pocket + 622] = 4;
  for (const [id, character, palette] of [[50, 90, 91], [622, 827, 828], [113, 90, 91], [114, 90, 91]]) {
    writeU16(rom.arm9, iconsAt + id * 4, character); writeU16(rom.arm9, iconsAt + id * 4 + 2, palette);
  }
  const items = new NARC(); items.files = Array.from({ length: 639 }, () => new Uint8Array(36));
  items.files[50]!.fill(7);
  items.files[622] = Buffer.from("00000000000000001f020000000000ff0000000000000000000000000000000000000000", "hex");
  const texts = new NARC(); texts.files = Array.from({ length: 65 }, () => encodeGen5TextBank([["0_0", "", 0]]));
  texts.files[63] = encodeGen5TextBank(Array.from({ length: 639 }, (_, id) => [`0_${id}`, id === 622 && custom622 ? "A custom map." : "", 0]));
  texts.files[64] = encodeGen5TextBank(Array.from({ length: 639 }, (_, id) => [`0_${id}`, id === 622 && custom622 ? "Old Sea Map" : id === 50 ? "Rare Candy" : "???", 0]));
  const icons = new NARC(); icons.files = Array.from({ length: 829 }, (_, i) => new Uint8Array([i & 255]));
  const headers = new NARC(); headers.files = [new Uint8Array(48)];
  const iconBytes = custom622 ? icons.save() : new Uint8Array(readFileSync(new URL("./fixtures/party-quick-actions-dependency-icons.narc", import.meta.url)));
  for (const [path, id, data] of [["a/0/0/2", 341, texts.save()], ["a/0/0/3", 342, new NARC().save()], ["a/0/1/2", 343, headers.save()], ["a/0/2/4", 344, items.save()], ["a/0/2/5", 345, iconBytes]] as const) {
    rom.files[id] = data; rom.filenames = addFilePath(rom.filenames, path, id);
  }
  const p = await loadProjectFromRomBytes(rom.save({ filenames: rom.filenames }), "fixture.nds", { selectedNarcs: ["items", "message_texts"] });
  // Framework behavior has separate coverage. These tests isolate the item and DLL contracts.
  p.codeInjection = { pmc: { overlayId: 344, overlayBaseAddress: 0x021fd1c0, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } };
  return p;
}

describe.each(["W2", "B2"] as const)("configurable Infinite Candy %s", game => {
  it("retains default item 622 and recognizes existing fixed-ID DLLs", async () => {
    const p = await fixture(game, false); assets();
    await installInfiniteCandy(p);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: true, itemId: 622 });
    deepStrictEqual(p.fileSystem!.additions![`patches/InfiniteCandy${game}.dll`], new Uint8Array(readFileSync(new URL(`../assets/codeinjection/InfiniteCandy${game}.dll`, import.meta.url))));
  });
  it("preserves a repurposed 622 and shared icons, and retains the chosen ID through export/reimport", async () => {
    const p = await fixture(game); assets();
    const original = new NintendoDSRom(p.originalRomBytes!), originalIcons = original.getFileByName("a/0/2/5").slice();
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: false, itemId: 113 });
    expect(getInfiniteCandyStatus(p, 113)).toMatchObject({ compatible: true, installed: false, itemId: 113 });
    await installInfiniteCandy(p);
    expect(getInstalledInfiniteCandyItemId(p)).toBe(113);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: true, itemId: 113 });
    expect(getLevelCapsStatus(p)).toMatchObject({ compatible: true, candyItemId: 113 });
    const bytes = await exportModifiedRom(p), rom = new NintendoDSRom(bytes);
    deepStrictEqual(rom.getFileByName("a/0/2/5"), originalIcons);
    const before = new NARC(original.getFileByName("a/0/2/4")), after = new NARC(rom.getFileByName("a/0/2/4"));
    for (let id = 0; id < before.files.length; ++id) if (id !== 113) deepStrictEqual(after.files[id], before.files[id]);
    const reopened = await loadProjectFromRomBytes(bytes, "reopened.nds", { selectedNarcs: ["items", "message_texts"] });
    reopened.codeInjection ??= {}; reopened.codeInjection.pmc = p.codeInjection!.pmc;
    expect(getInfiniteCandyStatus(reopened)).toMatchObject({ installed: true, compatible: true, itemId: 113 });
    expect(getTextBank(reopened, "message_texts", 64).find(e => e[0] === "0_622")?.[1]).toBe("Old Sea Map");
    expect(getTextBank(reopened, "message_texts", 64).find(e => e[0] === "0_113")?.[1]).toBe("Infinite Candy");
    const at = (game === "W2" ? 0x02090d7c : 0x02090d50) - rom.arm9RamAddress;
    expect(readU16(reopened.arm9, at + 113 * 4)).toBe(90);
    expect(readU16(reopened.arm9, at + 113 * 4 + 2)).toBe(91);
    await installInfiniteCandy(reopened);
    expect(getInstalledInfiniteCandyItemId(reopened)).toBe(113);
    expect(reopened.fileSystem?.additions?.[`patches/InfiniteCandy${game}.dll`]).toBeUndefined();
    const saved = structuredClone(p);
    await expect(installInfiniteCandy(p, 114)).rejects.toThrow(/already uses item 113/u);
    deepStrictEqual(structuredClone(p), saved);
  });
  it("rejects invalid, occupied and damaged slots without changing project state", async () => {
    const p = await fixture(game); assets(); const before = structuredClone(p);
    for (const id of [0, -1, 50, 639, NaN, 113.5, 622]) {
      await expect(installInfiniteCandy(p, id)).rejects.toThrow(); deepStrictEqual(structuredClone(p), before);
    }
    p.narcs.items!.rawFiles[113]![2] = 1;
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: false, itemId: 622 });
    await expect(installInfiniteCandy(p, 113)).rejects.toThrow(/custom data/u);
  });
  it("selects the validated alternate with lazy archives and keeps explicit item choices", async () => {
    const p = await fixture(game); assets();
    p.narcs = {}; p.texts = { banks: {} };
    const before = structuredClone(p);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: false, itemId: 113 });
    deepStrictEqual(structuredClone(p), before);
    expect(getInfiniteCandyStatus(p, 622)).toMatchObject({ compatible: false, itemId: 622 });
    await installInfiniteCandy(p, 114);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: true, itemId: 114 });
  });
  it("does not offer an alternate when native hooks are incompatible", async () => {
    const p = await fixture(game);
    p.overlays[12] = new Uint8Array([0, 0, 0, 0]);
    expect(getInfiniteCandyStatus(p).compatible).toBe(false);
    expect(getInfiniteCandyStatus(p, 113)).toMatchObject({ compatible: false, message: expect.stringContaining("party item hooks") });
  });
  it.each(["caps first", "candy first"])("keeps item 113 synchronized when installed %s", async order => {
    const p = await fixture(game); assets();
    if (order === "caps first") {
      await installLevelCaps(p); expect(getLevelCapsRuntime(p)?.itemId).toBe(622);
      await installInfiniteCandy(p, 113);
    } else { await installInfiniteCandy(p, 113); await installLevelCaps(p); }
    expect(getLevelCapsRuntime(p)).toMatchObject({ itemId: 113, legacy: false });
    expect(getLevelCapsStatus(p)).toMatchObject({ installed: true, compatible: true, updateAvailable: false, candyItemId: 113 });
    expect(getInfiniteCandyStatus(p)).toMatchObject({ installed: true, compatible: true, itemId: 113 });
    const reopened = await loadProjectFromRomBytes(await exportModifiedRom(p), "reopened.nds", { selectedNarcs: ["items", "message_texts"] });
    reopened.codeInjection ??= {}; reopened.codeInjection.pmc = p.codeInjection!.pmc;
    expect(getLevelCapsRuntime(reopened)?.itemId).toBe(113);
    await installLevelCaps(reopened); await installInfiniteCandy(reopened);
    expect(getLevelCapsRuntime(reopened)?.itemId).toBe(113);
    expect(getLevelCapsStatus(reopened)).toMatchObject({ compatible: true, updateAvailable: false });
  });
  it("upgrades a verified legacy cap DLL when Candy selects item 113", async () => {
    const p = await fixture(game); assets();
    const old = new Uint8Array(readFileSync(new URL(`./fixtures/level-caps-v1/HardLevelCaps${game}.dll`, import.meta.url)));
    stageCodeInjectionDll(p, `HardLevelCaps${game}.dll`, old);
    expect(getLevelCapsRuntime(p)).toMatchObject({ itemId: 622, legacy: true });
    await installInfiniteCandy(p);
    expect(getLevelCapsRuntime(p)).toMatchObject({ itemId: 113, legacy: false });
    expect(getLevelCapsStatus(p)).toMatchObject({ installed: true, updateAvailable: false, compatible: true });
  });
  it("synchronizes another chosen Candy ID when caps are installed first", async () => {
    const p = await fixture(game); assets(); await installLevelCaps(p); await installInfiniteCandy(p, 114);
    expect(getLevelCapsRuntime(p)?.itemId).toBe(114);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, itemId: 114 });
  });
  it("repairs mismatched IDs and rejects modified cap DLLs", async () => {
    const p = await fixture(game); assets(); await installInfiniteCandy(p, 113); await installLevelCaps(p);
    const path = `patches/HardLevelCaps${game}.dll`, data = p.fileSystem!.additions![path];
    const mismatched = parseRpm(data, { allowedMagics: ["DLXF"] });
    writeU32(mismatched.code, levelCapsManifest.games[game].current.itemIdOffset, 114);
    p.fileSystem!.additions![path] = writeRpm(mismatched, { ident: "DLXF" });
    expect(getLevelCapsStatus(p)).toMatchObject({ installed: true, compatible: true, updateAvailable: true });
    await installLevelCaps(p); expect(getLevelCapsRuntime(p)?.itemId).toBe(113);
    const corrupt = parseRpm(data, { allowedMagics: ["DLXF"] }); corrupt.code[0] ^= 1;
    p.fileSystem!.additions![path] = writeRpm(corrupt, { ident: "DLXF" });
    expect(getLevelCapsStatus(p)).toMatchObject({ installed: true, compatible: false });
    expect(getInfiniteCandyStatus(p, 113)).toMatchObject({ compatible: false, message: expect.stringContaining("unrecognized") });
    p.fileSystem!.additions![path] = new Uint8Array([1, 2, 3]);
    const before = structuredClone(p);
    expect(getLevelCapsStatus(p)).toMatchObject({ installed: true, compatible: false });
    await expect(installLevelCaps(p)).rejects.toThrow(/unrecognized/u);
    deepStrictEqual(structuredClone(p), before);
  });
  it("leaves Candy and an existing cap unchanged if cap synchronization fails", async () => {
    const p = await fixture(game); assets(); await installLevelCaps(p); const before = structuredClone(p);
    vi.stubGlobal("fetch", async (url: URL) => url.href.includes("HardLevelCaps") ? new Response(null, { status: 404 })
      : new Response(new Uint8Array(readFileSync(url))));
    await expect(installInfiniteCandy(p, 113)).rejects.toThrow(/Hard Level Caps \(404\)/u);
    deepStrictEqual(structuredClone(p), before);
  });
  it("verifies both ID literals, immutable code and native import relocations", async () => {
    const p = await fixture(game); assets(); await installInfiniteCandy(p, 113);
    const path = `patches/InfiniteCandy${game}.dll`, data = p.fileSystem!.additions![path];
    const rpm = parseRpm(data, { allowedMagics: ["DLXF"] });
    writeU32(rpm.code, template.games[game].itemIdOffsets[1]!, 114);
    p.fileSystem!.additions![path] = writeRpm(rpm, { ident: "DLXF" });
    expect(getInstalledInfiniteCandyItemId(p)).toBeUndefined();
    expect(getInfiniteCandyStatus(p).compatible).toBe(false);
    const code = parseRpm(data, { allowedMagics: ["DLXF"] }); code.code[0] ^= 1;
    p.fileSystem!.additions![path] = writeRpm(code, { ident: "DLXF" });
    expect(getInstalledInfiniteCandyItemId(p)).toBeUndefined();
    const badImport = parseRpm(data, { allowedMagics: ["DLXF"] });
    badImport.symbols[badImport.relocations.find(r => r.target.module === "base")!.sourceSymbolIndex]!.address ^= 2;
    p.fileSystem!.additions![path] = writeRpm(badImport, { ident: "DLXF" });
    expect(getInstalledInfiniteCandyItemId(p)).toBeUndefined();
  });
  it("leaves the project unchanged when loading its DLL fails", async () => {
    const p = await fixture(game), before = structuredClone(p);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(installInfiniteCandy(p, 113)).rejects.toThrow(/404/u); deepStrictEqual(structuredClone(p), before);
  });
});
