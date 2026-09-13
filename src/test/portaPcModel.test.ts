import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { detectPmcInstallFromRom, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import { getPortaPcStatus, installPortaPc, uninstallPortaPc } from "../pokeweb/portaPcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

const versions = ["W2", "B2"] as const;
type Version = typeof versions[number];
const assets = Object.fromEntries(versions.flatMap((v) => [
  [`PortaPC${v}.dll`, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PortaPC${v}.dll`, import.meta.url)))],
  [`PMC_${v}.rpm`, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${v}.rpm`, import.meta.url)))],
])) as Record<string, Uint8Array>;
const addresses = {
  W2: { base: 0x0217f640, fieldBase: 0x02150400, grid: 0x0218151c, rail: 0x02181aa0, heap: 0x02180500, script: 0x021536ac, keys: 0x0203df28, idCode: "IRDO" },
  B2: { base: 0x0217f600, fieldBase: 0x021503c0, grid: 0x021814dc, rail: 0x02181a60, heap: 0x021804c0, script: 0x0215366c, keys: 0x0203defc, idCode: "IREO" },
};
afterEach(() => vi.unstubAllGlobals());

describe.each(versions)("Porta PC %s", (version) => {
  it("bundles a stripped module sharing the shortcut code between grid and rail hooks", () => {
    const dll = assets[`PortaPC${version}.dll`];
    const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
    expect(dll.length).toBe(416);
    expect(rpm.code.length).toBe(48);
    expect(rpm.bssSize).toBe(0);
    expect(rpm.metadata).toMatchObject({ PMCGameID: version, PMCModulePriority: 4, PMCVersion: "1.0.0" });
    expect(rpm.symbols).toHaveLength(5);
    expect(rpm.symbols.every((s) => !s.name && !(s.attributes & 2))).toBe(true);
    const a = addresses[version];
    expect(rpm.relocations).toHaveLength(5);
    expect(rpm.relocations.map(({ target, sourceSymbolIndex }) => [target.module, target.address, target.type, rpm.symbols[sourceSymbolIndex].address])).toEqual(expect.arrayContaining([
      ["base", 6, "THUMB_BRANCH_LINK", a.keys], ["base", 20, "THUMB_BRANCH_LINK", a.heap],
      ["base", 32, "THUMB_BRANCH_LINK", a.script], ["36", a.grid + 0x36e, "THUMB_BRANCH_LINK", 0],
      ["36", a.rail + 0x248, "THUMB_BRANCH_LINK", 0],
    ]));
  });

  it("installs PMC and the matching DLL, and detects it after export/reimport", async () => {
    const project = makeProject(version);
    const original = new NintendoDSRom(project.originalRomBytes!);
    expect(getPortaPcStatus(project)).toMatchObject({ compatible: true, installed: false, pmcInstalled: false });
    stubAssets();
    const result = await installPortaPc(project);
    expect(result.path).toBe(`patches/PortaPC${version}.dll`);
    expect(project.fileSystem?.additions?.[result.path]).toEqual(assets[result.fileName]);
    expect(getPortaPcStatus(project)).toMatchObject({ installed: true, compatible: true, updateAvailable: false, canUninstall: true });
    const exported = new NintendoDSRom(await exportModifiedRom(project));
    expect(exported.getFileByName(result.path)).toEqual(assets[result.fileName]);
    for (const id of [12, 36]) expect(exported.loadArm9Overlays([id]).get(id)!.data).toEqual(original.loadArm9Overlays([id]).get(id)!.data);
    const reimported = makeProject(version, exported.data);
    expect(getPortaPcStatus(reimported)).toMatchObject({ installed: true, compatible: true, updateAvailable: false, canUninstall: false });
    await installPortaPc(reimported);
    expect(reimported.fileSystem?.additions?.[result.path]).toBeUndefined();
    expect(() => uninstallPortaPc(reimported)).toThrow(/staged/u);
  });

  it("replaces the original ButtonScript in place without adding another DLL", async () => {
    const project = makeProject(version);
    stubAssets();
    await installPortaPc(project);
    uninstallPortaPc(project);
    const fileName = "01_ButtonScript.dll";
    const path = `patches/${fileName}`;
    stageCodeInjectionDll(project, fileName, legacyDll(version));
    const exported = new NintendoDSRom(await exportModifiedRom(project));
    const legacyId = exported.fileId(path);
    const reimported = makeProject(version, exported.data);
    expect(getPortaPcStatus(reimported)).toMatchObject({ installed: true, updateAvailable: true, compatible: true });
    expect(await installPortaPc(reimported)).toMatchObject({ path, version: "1.0.0" });
    expect(reimported.fileSystem?.replacements[legacyId]).toEqual(assets[`PortaPC${version}.dll`]);
    expect(reimported.fileSystem?.additions?.[`patches/PortaPC${version}.dll`]).toBeUndefined();
    const updated = new NintendoDSRom(await exportModifiedRom(reimported));
    expect(updated.fileId(path)).toBe(legacyId);
    expect(updated.files).toHaveLength(exported.files.length);
    expect(getPortaPcStatus(makeProject(version, updated.data))).toMatchObject({ installed: true, updateAvailable: false });
  });

  it("recognizes a renamed copy and removes only a staged DLL", async () => {
    const project = makeProject(version);
    stubAssets();
    await installPortaPc(project);
    uninstallPortaPc(project);
    stageCodeInjectionDll(project, "MyPcShortcut.dll", assets[`PortaPC${version}.dll`]);
    expect((await installPortaPc(project)).path).toBe("patches/MyPcShortcut.dll");
    expect(listCodeInjectionDlls(project)).toHaveLength(1);
    uninstallPortaPc(project);
    expect(getPortaPcStatus(project)).toMatchObject({ installed: false, pmcInstalled: true });
  });

  it.each(["grid", "rail"] as const)("rejects altered %s field code and native key helpers before mutation", async (provider) => {
    const project = makeProject(version);
    project.arm9[addresses[version].keys - 0x02004000] ^= 1;
    await expect(installPortaPc(project)).rejects.toThrow(/ARM9/u);
    project.arm9[addresses[version].keys - 0x02004000] ^= 1;
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const overlay = rom.loadArm9Overlays([36]).get(36)!;
    const changed = overlay.data.slice();
    changed[addresses[version][provider] + (provider === "grid" ? 0x36e : 0x248) - overlay.ramAddress] ^= 1;
    project.overlays[36] = changed;
    await expect(installPortaPc(project)).rejects.toThrow(/overlay 36/u);
    project.overlays[36] = overlay.data;
    project.fileSystem = { replacements: { [overlay.fileId]: changed } };
    await expect(installPortaPc(project)).rejects.toThrow(/overlay 36/u);
    expect(project.codeInjection).toBeUndefined();
  });

  it("rejects another region or a build for the wrong version", async () => {
    const project = makeProject(version);
    stubAssets();
    await installPortaPc(project);
    uninstallPortaPc(project);
    // A wrong-version module under its reserved name must never be overwritten.
    project.fileSystem!.additions![`patches/PortaPC${version}.dll`] = assets[`PortaPC${version === "W2" ? "B2" : "W2"}.dll`];
    await expect(installPortaPc(project)).rejects.toThrow(/unrecognized Porta PC/u);
    const otherRegion = makeProject(version);
    otherRegion.originalRomBytes![15] = "J".charCodeAt(0);
    await expect(installPortaPc(otherRegion)).rejects.toThrow(/US Black 2/u);
  });
});

describe("Porta PC conflicts", () => {
  it("rejects BW1 projects", async () => {
    const project = makeProject("W2");
    project.session.baseRom = "BW";
    project.session.baseVersion = "W";
    await expect(installPortaPc(project)).rejects.toThrow(/US Black 2/u);
  });

  it("detects duplicated hooks and unrelated modules overlapping the epilogue", async () => {
    const project = makeProject("W2");
    stubAssets();
    await installPortaPc(project);
    stageCodeInjectionDll(project, "Duplicate.dll", assets["PortaPCW2.dll"]);
    await expect(installPortaPc(project)).rejects.toThrow(/Multiple/u);
    delete project.fileSystem!.additions!["patches/Duplicate.dll"];
    project.codeInjection!.modules = project.codeInjection!.modules!.filter((entry) => entry.fileName !== "Duplicate.dll");
    const conflict = parseRpm(assets["PortaPCW2.dll"], { allowedMagics: ["DLXF"] });
    conflict.code[0] ^= 1;
    stageCodeInjectionDll(project, "OtherButtons.dll", writeRpm(conflict, { ident: "DLXF" }));
    await expect(installPortaPc(project)).rejects.toThrow(/OtherButtons.dll/u);
  });

  it("rejects a corrupt asset before installing PMC", async () => {
    const project = makeProject("W2");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2]))));
    await expect(installPortaPc(project)).rejects.toThrow();
    expect(project.codeInjection).toBeUndefined();
    expect(project.fileSystem).toBeUndefined();
  });

  it("rejects an unrelated DLL that hooks only the rail epilogue", async () => {
    const project = makeProject("W2");
    stubAssets();
    await installPortaPc(project);
    uninstallPortaPc(project);
    const conflict = parseRpm(assets["PortaPCW2.dll"], { allowedMagics: ["DLXF"] });
    conflict.relocations = conflict.relocations.filter(({ target }) => target.module === "36" && target.address === addresses.W2.rail + 0x248);
    stageCodeInjectionDll(project, "RailEvents.dll", writeRpm(conflict, { ident: "DLXF" }));
    await expect(installPortaPc(project)).rejects.toThrow(/RailEvents.dll/u);
  });

  it("rejects a bundled asset missing its rail hook", async () => {
    const project = makeProject("W2");
    const broken = parseRpm(assets["PortaPCW2.dll"], { allowedMagics: ["DLXF"] });
    broken.relocations = broken.relocations.filter(({ target }) => target.module !== "36" || target.address === addresses.W2.grid + 0x36e);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(writeRpm(broken, { ident: "DLXF" }).slice())));
    await expect(installPortaPc(project)).rejects.toThrow(/verified runtime/u);
    expect(project.codeInjection).toBeUndefined();
    expect(project.fileSystem).toBeUndefined();
  });
});

function stubAssets(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    const bytes = assets[url.pathname.split("/").pop()!];
    if (!bytes) throw new Error(`Unexpected asset: ${url}`);
    return new Response(bytes.slice());
  }));
}

function legacyDll(version: Version): Uint8Array {
  const rpm = parseRpm(assets[`PortaPC${version}.dll`], { allowedMagics: ["DLXF"] });
  rpm.relocations = rpm.relocations.filter(({ target }) => target.module !== "36" || target.address === addresses[version].grid + 0x36e);
  rpm.symbols.pop(); // The original ButtonScript exported only the grid hook.
  rpm.code = new Uint8Array(Buffer.from("07b4000000000749014207bc08d0201c00000000031c281c03490022000000001cb0f8bd080000006a270000", "hex"));
  rpm.metadata = {};
  for (const relocation of rpm.relocations) if (relocation.target.module === "base") relocation.target.address -= 4;
  rpm.symbols[3].size = 36;
  return writeRpm(rpm, { ident: "DLXF" });
}

function makeProject(version: Version, bytes = makeRom(version)): ProjectState {
  const rom = new NintendoDSRom(bytes);
  return {
    originalRomBytes: bytes,
    session: { romName: "test", baseVersion: version, baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: detectPmcInstallFromRom(rom),
  };
}

function makeRom(version: Version): Uint8Array {
  const a = addresses[version];
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(a.idCode), 12);
  rom.arm9 = new Uint8Array(0x90000);
  rom.arm9RamAddress = 0x02004000;
  writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm9.set(Buffer.from("08b5fff7ebf9fff7efff08bd", "hex"), a.keys - rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4);
  rom.arm9OverlayTable = new Uint8Array(344 * 32);
  rom.files = Array.from({ length: 345 }, () => new Uint8Array(4));
  rom.filenames = new Folder({ files: ["base.bin"], firstId: 344 });
  for (let id = 0; id < 344; id++) {
    writeU32(rom.arm9OverlayTable, id * 32, id);
    writeU32(rom.arm9OverlayTable, id * 32 + 24, id);
  }
  for (const [id, base, length, regions] of [
    [36, a.base, 0x3000, [
      [a.grid, "f8b59cb00c1c161c0021051c3160181c"], [a.grid + 0x368, "002800d100201cb0f8bdc046"], [a.heap, "00887047"],
      [a.rail, "f8b59cb0051c0c1c0ca8291c221c06ae"], [a.rail + 0x242, "002800d100201cb0f8bd"],
    ]],
    [12, a.fieldBase, 0x4000, [[a.script, "38b50d1c141c00210091191c2a1c231c00f0d2f838bd0000"]]],
  ] as const) {
    rom.files[id] = new Uint8Array(length);
    for (const [address, hex] of regions) rom.files[id].set(Buffer.from(hex, "hex"), address - base);
    writeU32(rom.arm9OverlayTable, id * 32 + 4, base);
    writeU32(rom.arm9OverlayTable, id * 32 + 8, length);
  }
  return rom.save();
}
