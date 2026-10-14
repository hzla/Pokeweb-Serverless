import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import toolbar from "../assets/codeinjection/partyQuickActionsBw1Manifest.json";
import candy from "../assets/codeinjection/infiniteCandyBw1Manifest.json";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getPartyQuickActionsStatus, installPartyQuickActions, disablePartyQuickActions, parsePartyToolbarHideFlag } from "../pokeweb/partyQuickActionsModel";
import { getInfiniteCandyStatus, installInfiniteCandy } from "../pokeweb/infiniteCandyModel";
import * as pmc from "../pokeweb/pmcModel";
import { encodeGen5TextBank } from "../pokeweb/text";
import type { ProjectState } from "../pokeweb/projectStore";

const acceptance = [toolbar.games.B.dsAccepted, toolbar.games.W.dsAccepted, candy.games.B.dsAccepted, candy.games.W.dsAccepted];
beforeEach(() => { toolbar.games.B.dsAccepted = toolbar.games.W.dsAccepted = candy.games.B.dsAccepted = candy.games.W.dsAccepted = true; });
afterEach(() => {
  [toolbar.games.B.dsAccepted, toolbar.games.W.dsAccepted, candy.games.B.dsAccepted, candy.games.W.dsAccepted] = acceptance;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function assets() { vi.stubGlobal("fetch", vi.fn(async (input: URL) => new Response(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${input.pathname.split("/").pop()}`, import.meta.url)))))); }
function project(game: "B" | "W", bytes?: Uint8Array): ProjectState {
  if (!bytes) {
    const profile = toolbar.games[game], dependency = candy.games[game];
    const rom = new NintendoDSRom(new Uint8Array(0x200));
    rom.data.set(new TextEncoder().encode(profile.idCode), 12);
    rom.arm9RamAddress = 0x2004000; writeU32(rom.data, 0x28, rom.arm9RamAddress);
    rom.arm9 = new Uint8Array(0xa0000); rom.arm7 = new Uint8Array(4);
    rom.files = Array.from({ length: 237 }, () => new Uint8Array(4)); rom.filenames = new Folder();
    rom.arm9OverlayTable = new Uint8Array(237 * 32);
    for (let id = 0; id < 237; id++) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
    const signatures = [...profile.signatures, ...dependency.signatures];
    for (const id of [10, 91]) {
      const rows = signatures.filter(s => s.module === String(id));
      const base = Math.min(...rows.map(s => s.address)) & ~255;
      rom.files[id] = new Uint8Array(Math.max(...rows.map(s => s.address + s.expectedHex.length / 2)) - base);
      writeU32(rom.arm9OverlayTable, id * 32 + 4, base); writeU32(rom.arm9OverlayTable, id * 32 + 8, rom.files[id].length);
      for (const s of rows) rom.files[id].set(Buffer.from(s.expectedHex, "hex"), s.address - base);
    }
    for (const s of signatures.filter(s => s.module === "ARM9")) rom.arm9.set(Buffer.from(s.expectedHex, "hex"), s.address - rom.arm9RamAddress);
    for (const [address, data] of [[0x200512a, "00f097f9"], [game === "B" ? 0x2034b7c : 0x2034b94, "b81101eb"],
      [game === "B" ? 0x2034a50 : 0x2034a68, "181201eb"], [game === "B" ? 0x2078ea8 : 0x2078ec0, "ed000000"]] as const) {
      rom.arm9.set(Buffer.from(data, "hex"), address - rom.arm9RamAddress);
    }
    rom.arm9[(game === "B" ? 0x2078d77 : 0x2078d8f) - rom.arm9RamAddress] = 10;
    for (const [id, character, palette] of [[50, 90, 91], [622, 827, 828]]) {
      writeU16(rom.arm9, dependency.iconTable - rom.arm9RamAddress + id * 4, character);
      writeU16(rom.arm9, dependency.iconTable - rom.arm9RamAddress + id * 4 + 2, palette);
    }
    const items = new NARC(); items.files = Array.from({ length: 627 }, () => new Uint8Array(36));
    items.files[622] = new Uint8Array(Buffer.from(dependency.retailItemDataHex, "hex"));
    const texts = new NARC(); texts.files = Array.from({ length: 55 }, () => encodeGen5TextBank([["0_0", "", 0]]));
    for (const bank of [53, 54]) texts.files[bank] = encodeGen5TextBank(Array.from({ length: 627 }, (_, id) => [`0_${id}`, `Item ${id}`, 0]));
    rom.files[0] = texts.save(); rom.files[1] = items.save();
    rom.files[2] = new Uint8Array(readFileSync(new URL("./fixtures/party-quick-actions-dependency-icons.narc", import.meta.url)));
    const pokeIcons = new NARC(), palette = new Uint8Array(158);
    palette.set(Buffer.from("524c434efffe00019e0000001000020054544c507800000003000000000000006000000010000000", "hex"));
    palette.set(Buffer.from("504d4350160000000300efbe08000000000001000200", "hex"), 136);
    pokeIcons.files = [palette]; rom.files[3] = rom.files[2]; rom.files[2] = rom.files[1]; rom.files[1] = pokeIcons.save();
    for (const [path, id] of [["a/0/0/2", 0], ["a/0/0/7", 1], ["a/0/2/4", 2], ["a/0/2/5", 3]] as const) rom.filenames = addFilePath(rom.filenames, path, id);
    bytes = rom.save({ filenames: rom.filenames });
  }
  const rom = new NintendoDSRom(bytes);
  return { originalRomBytes: bytes, session: { romName: "bw1-fixture.nds", baseRom: "BW", baseVersion: game }, romInfo: { idCode: rom.idCode },
    arm9: rom.arm9.slice(), arm9Dirty: false, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], files: {},
    fileSystem: { replacements: {} }, patches: {}, codeInjection: { dlls: [] }, actionChangelog: { entries: [] } } as unknown as ProjectState;
}

for (const game of ["B", "W"] as const) describe(`BW1 Party Toolbar ${game}`, () => {
  it("offers and installs standalone Candy without preloading item or text archives", async () => {
    const p = project(game), before = structuredClone(p); assets();
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: false });
    deepStrictEqual(structuredClone(p), before);
    await installInfiniteCandy(p);
    expect(getInfiniteCandyStatus(p)).toMatchObject({ compatible: true, installed: true });
  });
  it("requires acceptance of both exact game profiles", async () => {
    const p = project(game), before = structuredClone(p); toolbar.games.W.dsAccepted = false;
    expect(getPartyQuickActionsStatus(p).supported).toBe(false);
    await expect(installPartyQuickActions(p)).rejects.toThrow(/acceptance/);
    deepStrictEqual(structuredClone(p), before);
    toolbar.games.W.dsAccepted = true; candy.games.B.dsAccepted = false;
    await expect(installPartyQuickActions(p)).rejects.toThrow(/acceptance/);
    deepStrictEqual(structuredClone(p), before);
  });
  it("installs its dependency and per-game graphics with nine icons, default on", async () => {
    const p = project(game); assets(); await installPartyQuickActions(p);
    expect(getPartyQuickActionsStatus(p)).toMatchObject({ installed: true, enabled: true, compatible: true, candyInstalled: true, hideFlag: null });
    expect(getInfiniteCandyStatus(p)).toMatchObject({ installed: true, compatible: true });
    expect(new NARC(p.fileSystem!.additions![toolbar.archivePath]).files).toHaveLength(13);
    expect(pmc.listCodeInjectionDlls(p).map(d => d.fileName)).toEqual(expect.arrayContaining([`PartyQuickActions${game}.dll`, `InfiniteCandy${game}.dll`]));
  });
  it("preserves all six flags through update, disable/enable and export/reopen", async () => {
    const p = project(game); assets();
    const flags = { candy: 1, heal: 2911, hp: 42, exp: 0x500, statuses: 0x501 };
    await installPartyQuickActions(p, { hideFlag: 0x502, sectionHideFlags: flags });
    const reopened = project(game, await exportModifiedRom(p));
    expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ enabled: true, hideFlag: 0x502, sectionHideFlags: flags });
    disablePartyQuickActions(reopened); await installPartyQuickActions(reopened);
    expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ enabled: true, hideFlag: 0x502, sectionHideFlags: flags, updateAvailable: false });
    await installPartyQuickActions(reopened, { sectionHideFlags: { statuses: null } });
    expect(getPartyQuickActionsStatus(project(game, await exportModifiedRom(reopened))).sectionHideFlags).toEqual({ ...flags, statuses: null });
    expect(pmc.listCodeInjectionDlls(reopened).filter(d => d.fileName.startsWith("PartyQuickActions"))).toHaveLength(1);
  });
  it("validates BW1 flag bounds without changing the project", async () => {
    const p = project(game), before = structuredClone(p); assets();
    expect(parsePartyToolbarHideFlag("0xB5F", game)).toBe(2911);
    for (const flag of [0, -1, 2912, 3059, 0x4000, NaN, 1.5]) {
      await expect(installPartyQuickActions(p, { sectionHideFlags: { hp: flag } })).rejects.toThrow(/saved flag/);
      deepStrictEqual(structuredClone(p), before);
    }
  });
  it("allows palette recolors while rejecting expansion into toolbar banks", async () => {
    const p = project(game); assets();
    const icons = new NARC(new NintendoDSRom(p.originalRomBytes!).files[1]); icons.files[0][40] = 31;
    p.fileSystem!.replacements![1] = icons.save();
    expect(getPartyQuickActionsStatus(p).compatible).toBe(true);
    writeU32(icons.files[0], 32, 128); p.fileSystem!.replacements![1] = icons.save();
    const before = structuredClone(p);
    await expect(installPartyQuickActions(p)).rejects.toThrow(/three-bank/); deepStrictEqual(structuredClone(p), before);
  });
  it("rejects changed hooks, repurposed item data, and damaged owned graphics", async () => {
    const p = project(game); assets(); await installPartyQuickActions(p);
    p.narcs.items!.rawFiles[622]![12] ^= 1;
    const before = structuredClone(p); await expect(installPartyQuickActions(p)).rejects.toThrow(/custom data/); deepStrictEqual(structuredClone(p), before);
    p.narcs.items!.rawFiles[622]![12] ^= 1;
    const archive = new NARC(p.fileSystem!.additions![toolbar.archivePath]); archive.files[12][0] ^= 1;
    p.fileSystem!.additions![toolbar.archivePath] = archive.save();
    expect(getPartyQuickActionsStatus(p).message).toMatch(/graphics are altered/);
  });
  it("rejects an altered DLL under the owned filename", async () => {
    const p = project(game); assets(); await installPartyQuickActions(p);
    const path = `patches/PartyQuickActions${game}.dll`, dll = p.fileSystem!.additions![path];
    const h = new DataView(dll.buffer).getUint32(8, true), info = h + new DataView(dll.buffer).getUint32(h + 8, true);
    dll[new DataView(dll.buffer).getUint32(info + 16, true)] ^= 1;
    const before = structuredClone(p); await expect(installPartyQuickActions(p)).rejects.toThrow(/Conflicting/); deepStrictEqual(structuredClone(p), before);
  });
  it("rolls back the toolbar and dependency together when staging fails", async () => {
    const p = project(game), before = structuredClone(p); assets();
    const nativeStage = pmc.stageCodeInjectionDll;
    vi.spyOn(pmc, "stageCodeInjectionDll").mockImplementation((...args) => {
      if (args[1].startsWith("PartyQuickActions")) throw new Error("Toolbar staging failure");
      return nativeStage(...args);
    });
    await expect(installPartyQuickActions(p)).rejects.toThrow(/staging failure/); deepStrictEqual(structuredClone(p), before);
  });
});
