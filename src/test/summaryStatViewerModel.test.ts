import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const versions = ["W2", "B2", "W", "B"] as const;
type Version = typeof versions[number];
const assets = Object.fromEntries(versions.flatMap(v => [
  [`SummaryStatViewer${v}.dll`, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/SummaryStatViewer${v}.dll`, import.meta.url)))],
  ...(v.endsWith("2") ? [[`PMC_${v}.rpm`, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${v}.rpm`, import.meta.url)))]] : []),
])) as Record<string, Uint8Array>;
const graphics = new Uint8Array(readFileSync(new URL("./fixtures/summaryStatViewerGraphics.narc", import.meta.url)));
const graphicsBw1 = new Uint8Array(readFileSync(new URL("./fixtures/summaryStatViewerGraphicsBW1.narc", import.meta.url)));
const acceptance = { B: manifest.games.B.dsAccepted, W: manifest.games.W.dsAccepted };
afterEach(() => {
  vi.unstubAllGlobals();
  manifest.games.B.dsAccepted = acceptance.B;
  manifest.games.W.dsAccepted = acceptance.W;
});
function acceptBw1Fixture() { manifest.games.B.dsAccepted = manifest.games.W.dsAccepted = true; }
function graphicsFor(version: Version) { return version.endsWith("2") ? graphics : graphicsBw1; }
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
  // Exercise candidate installation without changing the shipped release gate.
  beforeEach(() => { if (!version.endsWith("2")) acceptBw1Fixture(); });
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
    const profile = manifest.games[version];
    expect(exported.loadArm9Overlays([profile.overlayId]).get(profile.overlayId)!.data).toEqual(original.loadArm9Overlays([profile.overlayId]).get(profile.overlayId)!.data);
    // Ordinary export normalizes nameless NARC header padding; members remain exact.
    expect(new NARC(exported.getFileByName(profile.graphicsArchive)).files).toEqual(new NARC(graphicsFor(version)).files);
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
  it.each(version.endsWith("2") ? ["1.0.0", "1.0.1", "1.0.2"] : [])("updates the exported %s viewer in place while preserving the EV choice", async (previousVersion) => {
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
    const rom = new NintendoDSRom(p.originalRomBytes!); const overlay = rom.loadArm9Overlays([profile.overlayId]).get(profile.overlayId)!;
    const changed = overlay.data.slice();changed[profile.signatures[0].address - overlay.ramAddress] ^= 1;
    p.overlays[profile.overlayId] = changed;
    await expect(installSummaryStatViewer(p)).rejects.toThrow(`overlay ${profile.overlayId}`); expect(p.codeInjection).toBeUndefined();
    p.overlays[profile.overlayId] = overlay.data;
    const member = profile.resources[0].member, a = new NARC(graphicsFor(version)); a.files[member][50] ^= 1;
    p.fileSystem = { replacements: { [rom.fileId(profile.graphicsArchive)]: a.save() } };
    await expect(installSummaryStatViewer(p)).rejects.toThrow(`graphics member ${member}`); expect(p.codeInjection).toBeUndefined();
    p.fileSystem = undefined; await installSummaryStatViewer(p); uninstallSummaryStatViewer(p);
    const conflict = parseRpm(assets[`SummaryStatViewer${version}.dll`], { allowedMagics: ["DLXF"] });
    conflict.code[0] ^= 1; stageCodeInjectionDll(p, "UnknownSummary.dll", writeRpm(conflict, { ident: "DLXF" }));
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/UnknownSummary.dll/u);
  });
  it("rejects a wrong-version DLL under its reserved name", async () => {
    stubAssets();const p = makeProject(version);await installSummaryStatViewer(p);
    const other = { W2: "B2", B2: "W2", W: "B", B: "W" }[version];
    p.fileSystem!.additions![`patches/SummaryStatViewer${version}.dll`] = assets[`SummaryStatViewer${other}.dll`];
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/Conflicting/u);
  });
});
describe("Summary installer rollback and compatibility", () => {
  it.each(["B", "W"] as const)("keeps %s unavailable until both BW1 games pass acceptance", async version => {
    stubAssets(); const p = makeProject(version);
    expect(acceptance).toEqual({ B: true, W: true });
    for (const flags of [[false, false], [true, false], [false, true]]) {
      [manifest.games.B.dsAccepted, manifest.games.W.dsAccepted] = flags;
      expect(getSummaryStatViewerStatus(p)).toMatchObject({ supported: false, compatible: false });
      await expect(installSummaryStatViewer(p)).rejects.toThrow(/awaiting DS gameplay/u);
      expect(p.codeInjection).toBeUndefined(); expect(p.fileSystem).toBeUndefined();
    }
    acceptBw1Fixture();
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ supported: true, compatible: true });
    p.originalRomBytes![0x1e] = 1;
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/revision 0/u);
  });
  it.each(["B", "W"] as const)("rolls back %s when PMC or overlay staging fails", async version => {
    acceptBw1Fixture(); stubAssets(true);
    const p = makeProject(version), original = structuredClone(p);
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/PMC download/u);
    expect(p).toEqual(original);
    stubAssets(); const rom = new NintendoDSRom(p.originalRomBytes!);
    rom.arm9OverlayTable = rom.arm9OverlayTable.slice(0, 236 * 32); p.originalRomBytes = rom.save();
    const missingOverlay = structuredClone(p);
    await expect(installSummaryStatViewer(p)).rejects.toThrow(/overlay 237/u);
    expect(p).toEqual(missingOverlay);
  });
  it.each(["B", "W"] as const)("coexists with the %s Battle Log and counter companions", async version => {
    acceptBw1Fixture(); stubAssets(); const p = makeProject(version); await installSummaryStatViewer(p);
    const prefix = version === "B" ? "Black1" : "White1";
    for (const module of ["BattleLog", "BattleCounters", "BattleLogSummary"]) {
      const name = `${prefix}${module}.dll`;
      stageCodeInjectionDll(p, name, new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url))));
    }
    expect(getSummaryStatViewerStatus(p)).toMatchObject({ installed: true, compatible: true });
  });
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
  it.each(["W2", "B2"] as const)("coexists with %s Summary sprite, learnset and Upgrade hook sites", async v => {
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
    session: { romName: "test", baseVersion: version, baseRom: version.endsWith("2") ? "BW2" : "BW", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: detectPmcInstallFromRom(rom) };
}
function makeRom(version: Version): Uint8Array {
  const profile = manifest.games[version], rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(profile.idCode), 12);
  rom.arm9 = new Uint8Array(0x90000);rom.arm9RamAddress = 0x02004000;writeU32(rom.data, 0x28, rom.arm9RamAddress);
  const bw1 = !version.endsWith("2"), count = bw1 ? 237 : 344;
  rom.arm7 = new Uint8Array(4);rom.arm9OverlayTable = new Uint8Array(count * 32);
  rom.files = Array.from({ length: count + 1 }, () => new Uint8Array(4));rom.files[count] = graphicsFor(version);
  rom.filenames = new Folder({ folders: [["a", new Folder({ folders: [["0", new Folder({ folders: [["7", new Folder({ files: [bw1 ? "8" : "7"], firstId: count })]] })]] })]] });
  for (let id = 0; id < count; id++) { writeU32(rom.arm9OverlayTable, id * 32, id);writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  const base = { W2: 0x21b2fc0, B2: 0x21b2f80, W: 0x21d4260, B: 0x21d4240 }[version];
  const size = bw1 ? 34336 : 34688, overlay = profile.overlayId;
  rom.files[overlay] = new Uint8Array(size);writeU32(rom.arm9OverlayTable, overlay * 32 + 4, base);writeU32(rom.arm9OverlayTable, overlay * 32 + 8, size);
  for (const s of profile.signatures) (s.module === "ARM9" ? rom.arm9 : rom.files[overlay]).set(Buffer.from(s.expectedHex, "hex"), s.address - (s.module === "ARM9" ? rom.arm9RamAddress : base));
  if (bw1) {
    const delta = version === "B" ? -0x18 : 0;
    for (const [address, value] of [[0x0200512a, "00f097f9"], [0x02034b94 + delta, "b81101eb"],
      [0x02034a68 + delta, "181201eb"], [0x02078ec0 + delta, "ed000000"]] as const)
      rom.arm9.set(Buffer.from(value, "hex"), address - rom.arm9RamAddress);
    rom.arm9[0x02078d8f + delta - rom.arm9RamAddress] = 0x0a;
  }
  return rom.save({ filenames: rom.filenames });
}
