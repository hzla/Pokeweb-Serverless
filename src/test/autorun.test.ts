import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import autorunManifest from "../assets/codeinjection/autorunManifest.json";
import rowsManifest from "../assets/codeinjection/optionRowsManifest.json";
import { getAutorunStatus, installAutorun, isAutorunModule, uninstallAutorun, type AutorunVersion } from "../pokeweb/autorunModel";
import { followerRemovedModule } from "../pokeweb/followingPokemonProject";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import {
  configureOptionRowsDll, followingOptionsStub, readOptionRowsState, readTable, reconcileOptionRows,
} from "../pokeweb/optionRowsModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm } from "../pokeweb/rpm";
import { decodeGen5TextBank, encodeGen5TextBank } from "../pokeweb/text";

afterEach(() => vi.unstubAllGlobals());
const assets = () => vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(new Uint8Array(readFileSync(url)))));
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const GAMES = ["B", "W", "B2", "W2"] as const;

/** Synthetic ROM with retail bytes at every hook site and the Options text bank. */
async function fixture(game: AutorunVersion, options: { optionsHookBytes?: string } = {}): Promise<ProjectState> {
  const bw1 = game === "B" || game === "W";
  const profile = autorunManifest.games[game], rows = rowsManifest.games[game];
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(profile.idCode), 12);
  rom.arm9RamAddress = 0x02004000; writeU32(rom.data, 0x28, 0x02004000);
  rom.arm9 = new Uint8Array(0x1000); rom.arm7 = new Uint8Array(4);
  const overlayCount = bw1 ? 237 : 344;
  rom.files = Array.from({ length: overlayCount + 4 }, () => new Uint8Array(4));
  rom.arm9OverlayTable = new Uint8Array(overlayCount * 32); rom.filenames = new Folder();
  for (let id = 0; id < overlayCount; ++id) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  const place = (id: number, hooks: Array<{ address: string; bytes: string }>, override?: (address: string) => string | undefined) => {
    const addresses = hooks.map(hook => Number.parseInt(hook.address, 16));
    const base = Math.min(...addresses) & ~0xfff;
    const data = new Uint8Array(Math.max(...addresses) - base + 0x20);
    for (const hook of hooks) data.set(Buffer.from(override?.(hook.address) ?? hook.bytes, "hex"), Number.parseInt(hook.address, 16) - base);
    rom.files[id] = data;
    writeU32(rom.arm9OverlayTable, id * 32 + 4, base); writeU32(rom.arm9OverlayTable, id * 32 + 8, data.length);
  };
  place(profile.fieldOverlay, Object.values(profile.hooks));
  place(rows.optionsOverlay, Object.values(rows.hooks), address => address === rows.hooks.init.address ? options.optionsHookBytes : undefined);
  const member = bw1 ? 29 : 32, blank = bw1 ? "" : "    ";
  const texts = new NARC(); texts.files = Array.from({ length: member + 1 }, () => encodeGen5TextBank([["0_0", "", 0]]));
  texts.files[member] = encodeGen5TextBank(Array.from({ length: 37 }, (_, id) => [`0_${id}`, id === 13 ? "ON" : id === 14 ? "OFF" : [6, 19, 20, 21, 22, 29, 30, 36].includes(id) ? blank : `TEXT ${id}`, 0]));
  const headers = new NARC(); headers.files = [new Uint8Array(48)];
  for (const [index, path, data] of [[0, "a/0/0/2", texts.save()], [1, "a/0/0/3", new NARC().save()], [2, "a/0/1/2", headers.save()]] as const) {
    rom.files[overlayCount + index] = data; rom.filenames = addFilePath(rom.filenames, path, overlayCount + index);
  }
  const project = await loadProjectFromRomBytes(rom.save({ filenames: rom.filenames }), "fixture.nds", { selectedNarcs: [] });
  project.codeInjection = { pmc: bw1
    ? { overlayId: 237, overlayBaseAddress: 0x02217d20, overlayPath: "overlay/overlay_0237.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: game }
    : { overlayId: 344, overlayBaseAddress: 0x021fd1c0, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: game } };
  return project;
}

function optionsText(project: ProjectState): string[] {
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  const id = rom.filenames.idOf("a/0/0/2")!;
  const member = project.session.baseRom === "BW" ? 29 : 32;
  const store = project.narcs.message_texts;
  const bank = store?.dirty.has(member) ? store.rawFiles[member] : new NARC(project.fileSystem?.replacements?.[id] ?? rom.files[id]).files[member];
  return decodeGen5TextBank(bank).map(entry => entry[1]);
}

describe("bundled Autorun and Options rows modules", () => {
  it.each(GAMES)("%s modules match their manifests", async game => {
    const dll = asset(autorunManifest.games[game].fileName);
    const rows = asset(rowsManifest.games[game].fileName);
    const hash = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
    expect(await hash(dll)).toBe(autorunManifest.games[game].sha256);
    expect(await hash(rows)).toBe(rowsManifest.games[game].sha256);
    expect(isAutorunModule(parseRpm(dll, { allowedMagics: ["DLXF"] }), game)).toBe(true);
    const rowsRpm = parseRpm(rows, { allowedMagics: ["DLXF"] });
    const external = rowsRpm.relocations.filter(r => r.target.module !== "base");
    expect(external.map(r => `0x${r.target.address.toString(16).padStart(8, "0")}`).sort()).toEqual(Object.values(rowsManifest.games[game].hooks).map(h => h.address).sort());
    expect(external.every(r => r.target.type === "THUMB_BRANCH_LINK" && r.target.module === String(rowsManifest.games[game].optionsOverlay))).toBe(true);
    expect(rowsRpm.metadata).toMatchObject({ PMCGameID: game });
    expect(readTable(rows)).toEqual([]);
  });

  it("writes and reads the row table without moving code", () => {
    const rows = asset("PokewebOptionRowsW2.dll");
    const configured = configureOptionRowsDll(rows, ["following", "autorun"]);
    expect(readTable(configured)).toEqual(["following", "autorun"]);
    const before = parseRpm(rows, { allowedMagics: ["DLXF"] }), after = parseRpm(configured, { allowedMagics: ["DLXF"] });
    expect(after.relocations).toEqual(before.relocations);
    expect(after.code.length).toBe(before.code.length);
    const table = Buffer.from(after.code).indexOf(Buffer.from("PWOR"));
    // count, then {bit, gate, label, on, off, help} per row
    expect(Array.from(new Uint16Array(after.code.slice(table + 12, table + 36).buffer))).toEqual([11, 1, 6, 21, 22, 30, 12, 0, 19, 13, 14, 29]);
    expect(() => configureOptionRowsDll(rows, ["following", "autorun", "autorun"])).toThrow(/two extra rows/u);
  });

  it("uses the Following package's own Options stub", () => {
    expect(followingOptionsStub("W2")).toEqual(followerRemovedModule("stock", 3));
    expect(followingOptionsStub("B2")).toEqual(followerRemovedModule("black2", 3));
  });
});

describe.each(GAMES)("Autorun install on %s", game => {
  it("stages the movement DLL, the Options row and its text, then removes them", async () => {
    const project = await fixture(game); assets();
    expect(getAutorunStatus(project)).toMatchObject({ supported: true, installed: false, compatible: true });
    await installAutorun(project);
    const status = getAutorunStatus(project);
    expect(status).toMatchObject({ installed: true, compatible: true, updateAvailable: false, optionsRow: true, sharedWithFollowing: false, canUninstall: true });
    expect(project.fileSystem!.additions![`patches/Autorun${game}.dll`]).toEqual(asset(`Autorun${game}.dll`));
    expect(readOptionRowsState(project).rows).toEqual(["autorun"]);
    const text = optionsText(project);
    expect(text[19]).toBe("AUTORUN");
    expect(text[29]).toMatch(/Running Shoes/u);
    await uninstallAutorun(project);
    expect(listCodeInjectionDlls(project).some(entry => /Autorun|OptionRows/u.test(entry.fileName))).toBe(false);
    expect(optionsText(project)[19]).toBe(game === "B" || game === "W" ? "" : "    ");
    expect(getAutorunStatus(project)).toMatchObject({ installed: false, compatible: true });
  });

  it("refuses changed Options code", async () => {
    const project = await fixture(game, { optionsHookBytes: "00bf00bf" }); assets();
    expect(getAutorunStatus(project)).toMatchObject({ compatible: false, message: expect.stringMatching(/Options init call/u) });
    await expect(installAutorun(project)).rejects.toThrow(/Options init call/u);
    expect(listCodeInjectionDlls(project)).toEqual([]);
  });

  it("refuses a DLL that already hooks the field movement wrapper", async () => {
    const project = await fixture(game); assets();
    const other = parseRpm(asset(`Autorun${game}.dll`), { allowedMagics: ["DLXF"] });
    const { writeRpm } = await import("../pokeweb/rpm");
    stageCodeInjectionDll(project, "Other.dll", writeRpm({ ...other, metadata: { ...other.metadata, PMCVersion: "other" } }, { ident: "DLXF" }), "patches", project.originalRomBytes);
    expect(getAutorunStatus(project).message).toMatch(/Other\.dll already patches the field movement/u);
  });
});

describe.each(["W2", "B2"] as const)("Following Pokémon Options row on %s", game => {
  const followingPath = `patches/PokewebFollowingOptions${game}.dll`;
  async function withFollowingOptions(): Promise<ProjectState> {
    const project = await fixture(game); assets();
    // Following's own single-row module hooks the same seven call sites.
    stageCodeInjectionDll(project, followingPath.slice(8), asset(`PokewebOptionRows${game}.dll`), "patches", project.originalRomBytes);
    return project;
  }

  it("moves Following's row into the shared module and keeps it after Autorun is removed", async () => {
    const project = await withFollowingOptions();
    await installAutorun(project);
    expect(readOptionRowsState(project)).toMatchObject({ rows: ["following", "autorun"], followingModuleActive: false });
    expect(project.fileSystem!.additions![followingPath]).toEqual(followingOptionsStub(game));
    expect(getAutorunStatus(project)).toMatchObject({ optionsRow: true, sharedWithFollowing: true });
    await uninstallAutorun(project);
    expect(readOptionRowsState(project)).toMatchObject({ installed: true, rows: ["following"], followingModuleActive: false });
  });

  it("drops Following's row when Following is removed", async () => {
    const project = await withFollowingOptions();
    await installAutorun(project);
    await reconcileOptionRows(project, { following: false });
    expect(readOptionRowsState(project).rows).toEqual(["autorun"]);
  });

  it("does not add a shared module for Following alone", async () => {
    const project = await withFollowingOptions();
    expect(await reconcileOptionRows(project, { following: true })).toEqual(["following"]);
    expect(readOptionRowsState(project)).toMatchObject({ installed: false, followingModuleActive: true });
  });
});
