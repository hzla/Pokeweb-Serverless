import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  TAG_BATTLE_STABILIZATION_FILENAME,
  uninstallTagBattleStabilization,
} from "../pokeweb/tagBattleStabilizationModel";

const dll = new Uint8Array(readFileSync(new URL("../assets/codeinjection/TagBattleStabilizationW2.dll", import.meta.url)));
const pmc = new Uint8Array(readFileSync(new URL("../assets/codeinjection/PMC_W2.rpm", import.meta.url)));
const dllPath = `patches/${TAG_BATTLE_STABILIZATION_FILENAME}`;

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

  it("installs PMC automatically, exports the DLL, and recognizes it after reimport", async () => {
    const project = makeProject();
    const source = new NintendoDSRom(project.originalRomBytes!);
    expect(getTagBattleStabilizationStatus(project)).toMatchObject({ supported: true, compatible: true, installed: false, pmcInstalled: false });
    stubAssets();
    const result = await installTagBattleStabilization(project);
    expect(result.path).toBe(dllPath);
    expect(getPmcInstallStatus(project).installed).toBe(true);
    expect(project.fileSystem?.additions?.[dllPath]).toEqual(dll);
    expect(getTagBattleStabilizationStatus(project)).toMatchObject({ installed: true, compatible: true, canUninstall: true });

    const exported = new NintendoDSRom(await exportModifiedRom(project));
    expect(exported.getFileByName(dllPath)).toEqual(dll);
    for (const id of [167, 170]) expect(exported.loadArm9Overlays([id]).get(id)!.data).toEqual(source.loadArm9Overlays([id]).get(id)!.data);
    const reimported = makeProject(exported.data);
    expect(getTagBattleStabilizationStatus(reimported)).toMatchObject({ installed: true, compatible: true, canUninstall: false });
    await installTagBattleStabilization(reimported);
    expect(reimported.fileSystem?.additions?.[dllPath]).toBeUndefined();
    expect(listCodeInjectionDlls(reimported).filter((entry) => entry.path === dllPath)).toHaveLength(1);
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

  it.each(["B2", "W"] as const)("rejects %s before any mutation", async (version) => {
    const project = makeProject();
    project.session.baseVersion = version;
    if (version === "W") project.session.baseRom = "BW";
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/US White 2/u);
    expect(project.codeInjection).toBeUndefined();
    expect(project.fileSystem).toBeUndefined();
  });

  it("rejects a different region even when the AI bytes match", async () => {
    const project = makeProject();
    project.originalRomBytes!.set(new TextEncoder().encode("IRDJ"), 12);
    expect(getTagBattleStabilizationStatus(project).supported).toBe(false);
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/US White 2/u);
  });

  it.each([167, 170])("rejects changed overlay %i in the editor or a raw replacement", async (overlayId) => {
    const project = makeProject();
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const overlay = rom.loadArm9Overlays([overlayId]).get(overlayId)!;
    const changed = overlay.data.slice();
    changed[overlayId === 167 ? 0x021b1848 - overlay.ramAddress : 0] ^= 0xff;
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

  it("detects hooks that begin before a protected native entry point", async () => {
    const project = makeProject();
    stubAssets();
    await installTagBattleStabilization(project);
    uninstallTagBattleStabilization(project);
    const conflicting = parseRpm(dll, { allowedMagics: ["DLXF"] });
    conflicting.relocations = [{ sourceSymbolIndex: 0, target: { module: "170", address: 0x0217f638, type: "THUMB_BRANCH_SAFESTACK" } }];
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

  it("rejects duplicate copies and protects a DLL already present in an imported ROM", async () => {
    const project = makeProject();
    stubAssets();
    await installTagBattleStabilization(project);
    stageCodeInjectionDll(project, "CascadeTagAI.dll", dll);
    await expect(installTagBattleStabilization(project)).rejects.toThrow(/Multiple/u);
    const reimported = makeProject(await exportModifiedRom(project));
    expect(() => uninstallTagBattleStabilization(reimported)).toThrow(/staged/u);
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
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    if (url.pathname.endsWith(TAG_BATTLE_STABILIZATION_FILENAME)) return new Response(dll.slice());
    if (url.pathname.endsWith("PMC_W2.rpm")) return new Response(pmc.slice());
    throw new Error(`Unexpected asset: ${url}`);
  }));
}

function makeProject(bytes = makeRom()): ProjectState {
  const rom = new NintendoDSRom(bytes);
  return {
    originalRomBytes: bytes,
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: detectPmcInstallFromRom(rom),
  };
}

function makeRom(): Uint8Array {
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode("IRDO"), 12);
  rom.arm9 = new Uint8Array(0x80000);
  rom.arm9RamAddress = 0x02000000;
  writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4);
  rom.arm9OverlayTable = new Uint8Array(344 * 32);
  rom.files = Array.from({ length: 345 }, () => new Uint8Array(4));
  rom.filenames = new Folder({ files: ["base.bin"], firstId: 344 });
  for (let id = 0; id < 344; id++) {
    writeU32(rom.arm9OverlayTable, id * 32, id);
    writeU32(rom.arm9OverlayTable, id * 32 + 24, id);
  }
  // Small synthetic overlay snapshots; only the relevant call sites/prologues
  // come from the verified White 2 layout. No ROM files are checked into git.
  for (const [id, base, length, regions] of [
    [167, 0x02199780, 0x20000, [
      [0x021b1848, "cdf7fafe291cf831"], [0x021b18e8, "cdf76aff4f208000"], [0x021b5b92, "c9f7adfd002843d1"],
    ]],
    [170, 0x0217f640, 0x1000, [
      [0x0217f640, "f0b583b0061c02930f1c0192089d2548"], [0x0217f6f0, "f8b584b0009096f671f9051c98300068"], [0x0217f7c0, "38b5051c96f60af9041ca4300068cbf6"],
    ]],
  ] as const) {
    rom.files[id] = new Uint8Array(length);
    for (const [address, hex] of regions) rom.files[id].set(Buffer.from(hex, "hex"), address - base);
    writeU32(rom.arm9OverlayTable, id * 32 + 4, base);
    writeU32(rom.arm9OverlayTable, id * 32 + 8, length);
  }
  return rom.save();
}
