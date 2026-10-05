import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import manifest from "../assets/codeinjection/summaryStatViewerManifest.json";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { detectPmcInstallFromRom, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { configureSummaryStatViewerDll, getSummaryStatViewerStatus, installSummaryStatViewer, uninstallSummaryStatViewer } from "../pokeweb/summaryStatViewerModel";

const versions = ["W2", "B2"] as const;
type Version = typeof versions[number];
const assets = Object.fromEntries(versions.flatMap(v => [
  [`SummaryStatViewer${v}.dll`, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/SummaryStatViewer${v}.dll`, import.meta.url)))],
  [`PMC_${v}.rpm`, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${v}.rpm`, import.meta.url)))],
])) as Record<string, Uint8Array>;
const graphics = new Uint8Array(readFileSync(new URL("./fixtures/summaryStatViewerGraphics.narc", import.meta.url)));
afterEach(() => vi.unstubAllGlobals());
function stubAssets(failPmc = false) {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    const key = url.pathname.split("/").pop()!;
    if (failPmc && key.startsWith("PMC_")) throw new Error("PMC download failed");
    const bytes = assets[key];
    if (!bytes) throw new Error(`Unexpected asset ${key}`);
    return new Response(bytes.slice());
  }));
}
describe.each(versions)("Summary IV/EV Viewer %s", version => {
  it("bundles the exact localized hooks, without other patch dependencies", () => {
    const rpm = parseRpm(assets[`SummaryStatViewer${version}.dll`], { allowedMagics: ["DLXF"] });
    expect(rpm.metadata).toMatchObject({ PMCGameID: version, PMCModulePriority: 4, PMCVersion: manifest.version });
    expect(rpm.symbols.every(s => !s.name && !(s.attributes & 2))).toBe(true);
    expect(rpm.relocations.filter(r => r.target.module !== "base").map(r => r.target.address).sort()).toEqual(
      manifest.games[version].signatures.filter(s => s.patchSize).map(s => s.address).sort());
    expect(rpm.bssSize).toBeLessThan(256);
    expect(assets[`SummaryStatViewer${version}.dll`].length).toBeLessThan(13000);
    for (const includeEvs of [false, true]) expect(() => configureSummaryStatViewerDll(assets[`SummaryStatViewer${version}.dll`], { includeEvs })).not.toThrow();
  });
  it("installs independently, defaults to EVs, and updates the recognized DLL", async () => {
    stubAssets(); const p = makeProject(version);
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ compatible: true, installed: false, options: { includeEvs: true } });
    const result = await installSummaryStatViewer(p);
    expect(result.path).toBe(`patches/SummaryStatViewer${version}.dll`);
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ installed: true, canUninstall: true, options: { includeEvs: true } });
    await installSummaryStatViewer(p, { includeEvs: false });
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ compatible: true, options: { includeEvs: false } });
    expect(listCodeInjectionDlls(p)).toHaveLength(1);
    expect(p.fileSystem!.additions![result.path]).toEqual(configureSummaryStatViewerDll(assets[result.fileName], { includeEvs: false }));
    uninstallSummaryStatViewer(p);
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ installed: false, pmcInstalled: true });
  });
  it("preserves settings after export/reload and updates the same FAT ID", async () => {
    stubAssets(); const p = makeProject(version);
    const original = new NintendoDSRom(p.originalRomBytes!);
    const originalHash = await webcrypto.subtle.digest("SHA-256", new Uint8Array(p.originalRomBytes!));
    const result = await installSummaryStatViewer(p, { includeEvs: false });
    const exported = new NintendoDSRom(await exportModifiedRom(p));
    const id = exported.fileId(result.path);
    expect(exported.loadArm9Overlays([207]).get(207)!.data).toEqual(original.loadArm9Overlays([207]).get(207)!.data);
    // Ordinary export normalizes nameless NARC header padding; members remain exact.
    expect(new NARC(exported.getFileByName("a/0/7/7")).files).toEqual(new NARC(graphics).files);
    expect(await webcrypto.subtle.digest("SHA-256", new Uint8Array(p.originalRomBytes!))).toEqual(originalHash);
    const reopened = makeProject(version, exported.data);
    expect(getSummaryStatViewerStatus(reopened)).toMatchObject({ installed: true, canUninstall: false, options: { includeEvs: false } });
    await installSummaryStatViewer(reopened, { includeEvs: true });
    expect(reopened.fileSystem!.replacements[id]).toBeDefined();
    expect(reopened.fileSystem!.additions?.[result.path]).toBeUndefined();
    const updated = new NintendoDSRom(await exportModifiedRom(reopened));
    expect(updated.fileId(result.path)).toBe(id); expect(updated.files.length).toBe(exported.files.length);
    expect(getSummaryStatViewerStatus(makeProject(version, updated.data)).options.includeEvs).toBe(true);
    expect(() => uninstallSummaryStatViewer(reopened)).toThrow(/staged/u);
  });
  it("recognizes renamed modules and rejects duplicates or damaged configuration", async () => {
    stubAssets(); const p = makeProject(version);
    await installSummaryStatViewer(p); uninstallSummaryStatViewer(p);
    stageCodeInjectionDll(p, "MySummary.dll", configureSummaryStatViewerDll(assets[`SummaryStatViewer${version}.dll`], { includeEvs: false }));
    expect((await installSummaryStatViewer(p)).path).toBe("patches/MySummary.dll");
    stageCodeInjectionDll(p, "Duplicate.dll", assets[`SummaryStatViewer${version}.dll`]);
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/Multiple/u);
    const corrupt = parseRpm(assets[`SummaryStatViewer${version}.dll`], { allowedMagics: ["DLXF"] });
    corrupt.code[0] ^= 1;
    expect(() => configureSummaryStatViewerDll(writeRpm(corrupt, { ident: "DLXF" }), { includeEvs: true })).toThrow(/Unrecognized/u);
  });
  it.each(["1.0.0", "1.0.1", "1.0.2"])("updates the exported %s viewer in place while preserving the EV choice", async (previousVersion) => {
    stubAssets(); const p = makeProject(version);
    await installSummaryStatViewer(p); uninstallSummaryStatViewer(p);
    const previous = new Uint8Array(readFileSync(new URL(`./fixtures/SummaryStatViewer${version}-v${previousVersion}.dll`, import.meta.url)));
    stageCodeInjectionDll(p, `SummaryStatViewer${version}.dll`, configureSummaryStatViewerDll(previous, { includeEvs: false }));
    const exported = new NintendoDSRom(await exportModifiedRom(p));
    const reopened = makeProject(version, exported.data);
    const oldStatus = getSummaryStatViewerStatus(reopened);
    expect(oldStatus).toMatchObject({ installed: true, compatible: true, updateAvailable: true,
      installedVersion: previousVersion, options: { includeEvs: false } });
    const id = exported.fileId(oldStatus.dllPath!);
    await installSummaryStatViewer(reopened, oldStatus.options);
    const updated = new NintendoDSRom(await exportModifiedRom(reopened));
    expect(updated.fileId(oldStatus.dllPath!)).toBe(id);
    expect(updated.files.length).toBe(exported.files.length);
    expect(getSummaryStatViewerStatus(makeProject(version, updated.data))).toMatchObject({
      installedVersion: manifest.version, updateAvailable: false, options: { includeEvs: false } });
    expect(listCodeInjectionDlls(reopened)).toHaveLength(1);
  });
  it("rejects changed hooks, unknown module overlaps and changed resources without mutation", async () => {
    stubAssets(); const p = makeProject(version), profile = manifest.games[version];
    const rom = new NintendoDSRom(p.originalRomBytes!); const overlay = rom.loadArm9Overlays([207]).get(207)!;
    const changed = overlay.data.slice();changed[profile.signatures[0].address - overlay.ramAddress] ^= 1;
    p.overlays[207] = changed;
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/overlay 207/u); expect(p.codeInjection).toBeUndefined();
    p.overlays[207] = overlay.data;
    const a = new NARC(graphics); a.files[11][50] ^= 1;
    p.fileSystem = { replacements: { 344: a.save() } };
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/graphics member 11/u); expect(p.codeInjection).toBeUndefined();
    p.fileSystem = undefined; await installSummaryStatViewer(p); uninstallSummaryStatViewer(p);
    const conflict = parseRpm(assets[`SummaryStatViewer${version}.dll`], { allowedMagics: ["DLXF"] });
    conflict.code[0] ^= 1; stageCodeInjectionDll(p, "UnknownSummary.dll", writeRpm(conflict, { ident: "DLXF" }));
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/UnknownSummary.dll/u);
  });
  it("rejects a wrong-version DLL under its reserved name", async () => {
    stubAssets();const p = makeProject(version);await installSummaryStatViewer(p);
    p.fileSystem!.additions![`patches/SummaryStatViewer${version}.dll`] = assets[`SummaryStatViewer${version === "W2" ? "B2" : "W2"}.dll`];
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/Conflicting/u);
  });
});
describe("Summary installer rollback and compatibility", () => {
  it("does not mutate a project if PMC download/staging fails", async () => {
    const p = makeProject("W2"), original = p.arm9.slice();stubAssets(true);
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/PMC download/u);
    expect(p.codeInjection).toBeUndefined();expect(p.fileSystem).toBeUndefined();expect(p.arm9).toEqual(original);
    expect(p.actionChangelog).toBeUndefined();
    stubAssets();const rom = new NintendoDSRom(p.originalRomBytes!);rom.arm9OverlayTable = rom.arm9OverlayTable.slice(0, 343 * 32);p.originalRomBytes = rom.save();
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/overlay 344/u);
    expect(p.codeInjection).toBeUndefined();expect(p.fileSystem).toBeUndefined();expect(p.arm9).toEqual(original);
  });
  it("rejects unsupported games and languages", async () => {
    const p = makeProject("W2");p.session.baseRom = "BW";p.session.baseVersion = "W";
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/US Black 2/u);
    const j = makeProject("W2");j.originalRomBytes![15] = 74;
    await expect(installSummaryStatViewer(j)).rejects.toThrow(/US Black 2/u);
  });
  it.each(versions)("coexists with %s Summary sprite, learnset and Upgrade hook sites", async v => {
    stubAssets(); const p = makeProject(v); await installSummaryStatViewer(p);
    const dlls = [`PokewebPwanSummary${v}.dll`, `LearnsetMenu${v}.dll`, `LearnsetViewer${v}.dll`];
    for (const name of dlls) stageCodeInjectionDll(p, name, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url))));
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ installed: true, compatible: true });
    // Upgrade's additional ability and sprite calls remain native dependencies.
    const upgrade = parseRpm(assets[`SummaryStatViewer${v}.dll`], { allowedMagics: ["DLXF"] });
    upgrade.code[0] ^= 1;upgrade.relocations = upgrade.relocations.filter(r => r.target.module === "207").slice(0, 2);
    upgrade.relocations[0].target.address = 0x21b9204 - (v === "B2" ? 0x40 : 0);
    upgrade.relocations[1].target.address = 0x21b3388 - (v === "B2" ? 0x40 : 0);
    stageCodeInjectionDll(p, "CompanionAbility.dll", writeRpm(upgrade, { ident: "DLXF" }));
    expect(getSummaryStatViewerStatus(p).compatible).toBe(true);
  });
});
function makeProject(version: Version, bytes = makeRom(version)): ProjectState {
  const rom = new NintendoDSRom(bytes);
  return { originalRomBytes: bytes,
    session: { romName: "test", baseVersion: version, baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: detectPmcInstallFromRom(rom) };
}
function makeRom(version: Version): Uint8Array {
  const profile = manifest.games[version], rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(profile.idCode), 12);
  rom.arm9 = new Uint8Array(0x90000);rom.arm9RamAddress = 0x02004000;writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4);rom.arm9OverlayTable = new Uint8Array(344 * 32);
  rom.files = Array.from({ length: 345 }, () => new Uint8Array(4));rom.files[344] = graphics;
  rom.filenames = new Folder({ folders: [["a", new Folder({ folders: [["0", new Folder({ folders: [["7", new Folder({ files: ["7"], firstId: 344 })]] })]] })]] });
  for (let id = 0; id < 344; id++) { writeU32(rom.arm9OverlayTable, id * 32, id);writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  const base = version === "W2" ? 0x21b2fc0 : 0x21b2f80;
  rom.files[207] = new Uint8Array(34688);writeU32(rom.arm9OverlayTable, 207 * 32 + 4, base);writeU32(rom.arm9OverlayTable, 207 * 32 + 8, 34688);
  for (const s of profile.signatures) (s.module === "ARM9" ? rom.arm9 : rom.files[207]).set(Buffer.from(s.expectedHex, "hex"), s.address - (s.module === "ARM9" ? rom.arm9RamAddress : base));
  return rom.save({ filenames: rom.filenames });
}
