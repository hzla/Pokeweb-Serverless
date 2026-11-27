import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/tagBattleStabilizationManifest.json";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { detectPmcInstallFromRom, getPmcInstallStatus, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import {
  getTagBattleStabilizationStatus,
  installTagBattleStabilization,
  uninstallTagBattleStabilization,
} from "../pokeweb/tagBattleStabilizationModel";

type Game = keyof typeof manifest.games;
const games = ["B", "W", "B2", "W2"] as const;
const readAsset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const dll = readAsset(manifest.games.W2.fileName);
const dllPath = `patches/${manifest.games.W2.fileName}`;

afterEach(() => vi.unstubAllGlobals());

describe("Tag Battle Stabilization", () => {
  it("bundles the verified stripped runtime with only three AI call hooks and no imports", () => {
    expect(dll.length).toBe(496);
    expect(createHash("sha256").update(dll).digest("hex")).toBe("7ed12b4c532f4156365510bb18106c62c39fa5bbf848f0ffbdd8ce01eadd4f2a");
    const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
    expect(rpm.code.length).toBe(92);
    expect(rpm.bssSize).toBe(4);
    expect(rpm.symbols.every((symbol) => !symbol.name && !(symbol.attributes & 2))).toBe(true);
    expect(rpm.relocations.filter(({ target }) => target.module !== "base").map(({ target }) => target)).toEqual([
      { module: "167", address: 0x021b1848, type: "THUMB_BRANCH_LINK" },
      { module: "167", address: 0x021b18e8, type: "THUMB_BRANCH_LINK" },
      { module: "167", address: 0x021b5b92, type: "THUMB_BRANCH_LINK" },
    ]);
  });

  it.each(games)("installs PMC and the correct %s DLL, then recognizes both after reimport", async game => {
    const profile = manifest.games[game];
    const path = `patches/${profile.fileName}`;
    const expectedDll = readAsset(profile.fileName);
    const project = makeProject(makeRom(game), game);
    const source = new NintendoDSRom(project.originalRomBytes!);
    expect(getTagBattleStabilizationStatus(project)).toMatchObject({ supported: true, compatible: true, installed: false, pmcInstalled: false });
    stubAssets();
    const result = await installTagBattleStabilization(project);
    expect(result).toMatchObject({ path, gameId: game });
    expect(getPmcInstallStatus(project).installed).toBe(true);
    expect(project.fileSystem?.additions?.[path]).toEqual(expectedDll);
    expect(getTagBattleStabilizationStatus(project)).toMatchObject({ installed: true, compatible: true, canUninstall: true });

    const exported = new NintendoDSRom(await exportModifiedRom(project));
    expect(exported.getFileByName(path)).toEqual(expectedDll);
    for (const id of [profile.calls[0].overlayId, profile.entries[0].overlayId])
      expect(exported.loadArm9Overlays([id]).get(id)!.data).toEqual(source.loadArm9Overlays([id]).get(id)!.data);
    const reimported = makeProject(exported.data, game);
    expect(getTagBattleStabilizationStatus(reimported)).toMatchObject({ installed: true, compatible: true, canUninstall: true });
    uninstallTagBattleStabilization(reimported);
    expect(getTagBattleStabilizationStatus(reimported).installed).toBe(false);
    await installTagBattleStabilization(reimported);
    expect(reimported.fileSystem?.additions?.[path]).toBeUndefined();
    expect(listCodeInjectionDlls(reimported).filter((entry) => entry.path === path)).toHaveLength(1);
  });

  it.each(["CascadeTagAI.dll", "renamed-ai.dll"])("recognizes %s without staging a second DLL", async (name) => {
    const project = makeProject();
    stubAssets();
    await installTagBattleStabilization(project);
    uninstallTagBattleStabilization(project);
    stageCodeInjectionDll(project, name, dll);
    const exported = await exportModifiedRom(project);
    const reimported = makeProject(exported);
    const status = getTagBattleStabilizationStatus(reimported);
    expect(status).toMatchObject({ installed: true, compatible: true, dllPath: `patches/${name}` });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await installTagBattleStabilization(reimported)).path).toBe(`patches/${name}`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reimported.fileSystem?.additions?.[dllPath]).toBeUndefined();
  });

  it.each(["B2", "W"] as const)("rejects a White 2 ROM mislabeled as %s before any mutation", async (version) => {
    const project = makeProject();
    project.session.baseVersion = version;
    if (version === "W") project.session.baseRom = "BW";
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/US revision-0/u);
    expect(project.codeInjection).toBeUndefined();
    expect(project.fileSystem).toBeUndefined();
  });

  it("rejects a different region even when the AI bytes match", async () => {
    const project = makeProject();
    project.originalRomBytes!.set(new TextEncoder().encode("IRDJ"), 12);
    expect(getTagBattleStabilizationStatus(project).supported).toBe(false);
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/US revision-0/u);
  });

  it.each(["B", "W", "B2"] as const)("rejects an unverified %s revision", game => {
    const project = makeProject(makeRom(game), game);
    project.originalRomBytes![0x1e] = 1;
    expect(getTagBattleStabilizationStatus(project).supported).toBe(false);
  });

  it.each(games.flatMap(game => (["calls", "entries"] as const).map(kind => [game, kind] as const)))(
    "rejects changed %s %s in the editor or a raw replacement", async (game, kind) => {
    const project = makeProject(makeRom(game), game);
    const { overlayId, address } = manifest.games[game][kind][0];
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const overlay = rom.loadArm9Overlays([overlayId]).get(overlayId)!;
    const changed = overlay.data.slice();
    changed[address - overlay.ramAddress] ^= 0xff;
    project.overlays[overlayId] = changed;
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/AI code differs/u);
    project.overlays[overlayId] = overlay.data;
    project.fileSystem = { replacements: { [overlay.fileId]: changed } };
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/AI code differs/u);
    expect(project.codeInjection).toBeUndefined();
  });

  it("rejects a competing hook or an unrecognized DLL using a reserved name", async () => {
    const project = makeProject();
    stubAssets();
    await installTagBattleStabilization(project);
    uninstallTagBattleStabilization(project);
    const conflicting = parseRpm(dll, { allowedMagics: ["DLXF"] });
    conflicting.code[0] ^= 1;
    project.fileSystem!.additions!["patches/OtherAI.dll"] = writeRpm(conflicting, { ident: "DLXF" });
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/OtherAI.dll/u);
    delete project.fileSystem!.additions!["patches/OtherAI.dll"];
    project.fileSystem!.additions!["patches/CascadeTagAI.dll"] = new Uint8Array([1, 2, 3]);
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/CascadeTagAI.dll/u);
    expect(project.fileSystem!.additions!["patches/CascadeTagAI.dll"]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each(games)("detects hooks that begin before a protected native entry point on %s", async game => {
    const profile = manifest.games[game];
    const project = makeProject(makeRom(game), game);
    stubAssets();
    await installTagBattleStabilization(project);
    uninstallTagBattleStabilization(project);
    const conflicting = parseRpm(readAsset(profile.fileName), { allowedMagics: ["DLXF"] });
    const { overlayId, address } = profile.entries[0];
    conflicting.relocations = [{ sourceSymbolIndex: 0, target: { module: String(overlayId), address: address - 8, type: "THUMB_BRANCH_SAFESTACK" } }];
    stageCodeInjectionDll(project, "OtherAI.dll", writeRpm(conflicting, { ident: "DLXF" }));
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/OtherAI.dll/u);
  });

  it("is idempotent and can remove a staged copy without removing PMC", async () => {
    const project = makeProject();
    stubAssets();
    await installTagBattleStabilization(project);
    await installTagBattleStabilization(project);
    expect(listCodeInjectionDlls(project).filter((entry) => entry.path === dllPath)).toHaveLength(1);
    uninstallTagBattleStabilization(project);
    expect(getTagBattleStabilizationStatus(project)).toMatchObject({ installed: false, compatible: true, pmcInstalled: true });
    expect(project.fileSystem?.additions?.[dllPath]).toBeUndefined();
  });

  it("rejects duplicate copies in staged and imported ROMs", async () => {
    const project = makeProject();
    stubAssets();
    await installTagBattleStabilization(project);
    stageCodeInjectionDll(project, "CascadeTagAI.dll", dll);
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/Multiple/u);
    const reimported = makeProject(await exportModifiedRom(project));
    expect(() => uninstallTagBattleStabilization(reimported)).toThrow(/could not be verified/u);
  });

  it("does not install PMC when the bundled DLL fails to load or is corrupt", async () => {
    const project = makeProject();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/404/u);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    await expect(installTagBattleStabilization(project)).rejects.toThrow();
    expect(project.codeInjection).toBeUndefined();
    expect(project.fileSystem).toBeUndefined();
  });
});

function stubAssets(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(readAsset(url.pathname.split("/").pop()!))));
}

function makeProject(bytes = makeRom(), game: Game = "W2"): ProjectState {
  const rom = new NintendoDSRom(bytes);
  return {
    originalRomBytes: bytes,
    session: { romName: "test", baseVersion: game, baseRom: game.endsWith("2") ? "BW2" : "BW", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: detectPmcInstallFromRom(rom),
  };
}

function makeRom(game: Game = "W2"): Uint8Array {
  const profile = manifest.games[game];
  const overlayCount = game.endsWith("2") ? 344 : 237;
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(profile.idCode), 12);
  rom.arm9 = new Uint8Array(0x90000);
  rom.arm9RamAddress = 0x02000000;
  writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4);
  rom.arm9OverlayTable = new Uint8Array(overlayCount * 32);
  rom.files = Array.from({ length: overlayCount + 1 }, () => new Uint8Array(4));
  rom.filenames = new Folder({ files: ["base.bin"], firstId: overlayCount });
  for (let id = 0; id < overlayCount; id++) {
    writeU32(rom.arm9OverlayTable, id * 32, id);
    writeU32(rom.arm9OverlayTable, id * 32 + 24, id);
  }
  if (game === "B" || game === "W") {
    const delta = game === "W" ? 0x18 : 0;
    const put = (address: number, hex: string) => rom.arm9.set(Buffer.from(hex, "hex"), address - rom.arm9RamAddress);
    put(0x0200512a, "00f097f9");
    put(0x02034b7c + delta, "b81101eb");
    put(0x02034a50 + delta, "181201eb");
    put(0x02078ea8 + delta, "ed000000");
    put(0x02078d77 + delta, "0a");
  }
  // Synthetic overlays hold only the installer signatures.
  for (const regions of [profile.calls, profile.entries]) {
    const id = regions[0].overlayId;
    const base = Math.min(...regions.map(s => s.address)) & ~3;
    const length = Math.max(...regions.map(s => s.address + s.hex.length / 2)) - base;
    rom.files[id] = new Uint8Array(length);
    for (const { address, hex } of regions) rom.files[id].set(Buffer.from(hex, "hex"), address - base);
    writeU32(rom.arm9OverlayTable, id * 32 + 4, base);
    writeU32(rom.arm9OverlayTable, id * 32 + 8, length);
  }
  return rom.save();
}
