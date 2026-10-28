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
import { getLevelCapsStatus } from "../pokeweb/levelCapsModel";
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
    expect(p.fileSystem!.additions![`patches/InfiniteCandy${game}.dll`]).toEqual(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/InfiniteCandy${game}.dll`, import.meta.url))));
  });
  it("preserves a repurposed 622 and shared icons, and retains the chosen ID through export/reimport", async () => {
    const p = await fixture(game); assets();
    const original = new NintendoDSRom(p.originalRomBytes!), originalIcons = original.getFileByName("a/0/2/5").slice();
    expect(getInfiniteCandyStatus(p).compatible).toBe(false);
    expect(getInfiniteCandyStatus(p, 113)).toMatchObject({ compatible: true, installed: false, itemId: 113 });
    await installInfiniteCandy(p, 113);
    expect(getInstalledInfiniteCandyItemId(p)).toBe(113);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: true, itemId: 113 });
    expect(getLevelCapsStatus(p)).toMatchObject({ compatible: false, message: expect.stringContaining("622") });
    const bytes = await exportModifiedRom(p), rom = new NintendoDSRom(bytes);
    expect(rom.getFileByName("a/0/2/5")).toEqual(originalIcons);
    const before = new NARC(original.getFileByName("a/0/2/4")), after = new NARC(rom.getFileByName("a/0/2/4"));
    for (let id = 0; id < before.files.length; ++id) if (id !== 113) expect(after.files[id]).toEqual(before.files[id]);
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
    expect(p).toEqual(saved);
  });
  it("rejects invalid, occupied and damaged slots without changing project state", async () => {
    const p = await fixture(game); assets(); const before = structuredClone(p);
    for (const id of [0, -1, 50, 639, NaN, 113.5, 622]) {
      await expect(installInfiniteCandy(p, id)).rejects.toThrow(); expect(p).toEqual(before);
    }
    p.narcs.items!.rawFiles[113]![2] = 1;
    await expect(installInfiniteCandy(p, 113)).rejects.toThrow(/custom data/u);
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
    await expect(installInfiniteCandy(p, 113)).rejects.toThrow(/404/u); expect(p).toEqual(before);
  });
});
