import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Folder } from "../nds/fnt";
import { writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { sha256Hex } from "../nds/sha256";
import manifest from "../assets/codeinjection/summaryTypeIconsManifest.json";
import statsManifest from "../assets/codeinjection/summaryStatViewerManifest.json";
import { getSummaryTypeIconsStatus, installSummaryTypeIcons, uninstallSummaryTypeIcons } from "../pokeweb/summaryTypeIconsModel";
import { getSummaryStatViewerStatus, installSummaryStatViewer } from "../pokeweb/summaryStatViewerModel";
import { stageCodeInjectionDll, listCodeInjectionDlls, detectPmcInstallFromRom } from "../pokeweb/pmcModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";

const read = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const art = read("summaryTypeIcons.narc"), graphics = new Uint8Array(readFileSync(new URL("./fixtures/summaryStatViewerGraphics.narc", import.meta.url)));
afterEach(() => vi.unstubAllGlobals());
function fetchAssets(bad?: string) {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    const name = url.pathname.split("/").pop()!;
    if (name === bad) throw new Error("Download failed");
    return new Response(read(name));
  }));
}
function makeProject(v: "W2" | "B2", bytes?: Uint8Array): ProjectState {
  if (!bytes) {
    const rom = new NintendoDSRom(new Uint8Array(512)), p = manifest.games[v];
    rom.data.set(new TextEncoder().encode(p.idCode), 12);
    rom.arm9 = new Uint8Array(0x90000); rom.arm9RamAddress = 0x02004000; writeU32(rom.data, 0x28, rom.arm9RamAddress);
    rom.arm7 = new Uint8Array(4); rom.arm9OverlayTable = new Uint8Array(344 * 32);
    rom.files = Array.from({ length: 345 }, () => new Uint8Array(4)); rom.files[344] = graphics;
    rom.filenames = new Folder({ folders: [["a", new Folder({ folders: [["0", new Folder({ folders: [["7", new Folder({ files: ["7"], firstId: 344 })]] })]] })]] });
    for (let i = 0; i < 344; i++) { writeU32(rom.arm9OverlayTable, i * 32, i); writeU32(rom.arm9OverlayTable, i * 32 + 24, i); }
    const base = v === "W2" ? 0x21b2fc0 : 0x21b2f80;
    rom.files[207] = new Uint8Array(34688); writeU32(rom.arm9OverlayTable, 207 * 32 + 4, base); writeU32(rom.arm9OverlayTable, 207 * 32 + 8, 34688);
    for (const s of [...statsManifest.games[v].signatures, ...p.signatures])
      (s.module === "ARM9" ? rom.arm9 : rom.files[207]).set(Buffer.from(s.expectedHex, "hex"), s.address - (s.module === "ARM9" ? rom.arm9RamAddress : base));
    bytes = rom.save({ filenames: rom.filenames });
  }
  const rom = new NintendoDSRom(bytes);
  return { originalRomBytes: bytes, session: { romName: "test", baseVersion: v, baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: rom.idCode, fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], codeInjection: detectPmcInstallFromRom(rom) };
}
describe.each(["W2", "B2"] as const)("Summary Type Icons %s", v => {
  it("ships only 17 type characters with 15 visible-color indices and extended palettes", () => {
    const n = new NARC(art);
    expect(n.files).toHaveLength(20);
    expect(new DataView(n.files[0].buffer).getUint32(24, true)).toBe(4);
    expect(new DataView(n.files[0].buffer).getUint32(28, true)).toBe(1);
    for (const f of n.files.slice(3)) { expect(f.length).toBe(560); expect(Math.max(...f.slice(48))).toBeLessThanOrEqual(15); }
    const rpm = parseRpm(read(`SummaryTypeIcons${v}.dll`), { allowedMagics: ["DLXF"] });
    expect(rpm.bssSize).toBeLessThan(2048); expect(rpm.code.length).toBeLessThan(10000);
    for (const r of rpm.relocations.filter(r => r.target.module === "207"))
      expect(r.target.address < 0x21b6d6c - (v === "B2" ? 64 : 0) || r.target.type === "FULL_COPY").toBe(true);
    const rows = rpm.relocations.find(r => r.target.type === "FULL_COPY" && rpm.symbols[r.sourceSymbolIndex]?.size === 40)!;
    const s = rpm.symbols[rows.sourceSymbolIndex]; expect(rpm.code[s.address + 1]).toBe(5); expect(rpm.code[s.address + 9]).toBe(1);
  });
  it("installs, reinstalls and removes the staged module and owned art", async () => {
    fetchAssets(); const p = makeProject(v);
    expect(getSummaryTypeIconsStatus(p)).toMatchObject({ compatible: true, installed: false });
    const result = await installSummaryTypeIcons(p);
    expect(getSummaryTypeIconsStatus(p)).toMatchObject({ compatible: true, installed: true, canUninstall: true });
    expect(p.fileSystem!.additions![manifest.archivePath]).toEqual(art);
    await installSummaryTypeIcons(p); expect(listCodeInjectionDlls(p)).toHaveLength(1);
    expect(result.path).toBe(`patches/SummaryTypeIcons${v}.dll`);
    uninstallSummaryTypeIcons(p);
    expect(getSummaryTypeIconsStatus(p).installed).toBe(false); expect(p.fileSystem!.additions![manifest.archivePath]).toBeUndefined();
  });
  it.each([false, true])("coexists with the Summary IV/EV Viewer (icons first: %s)", async first => {
    fetchAssets(); const p = makeProject(v);
    if (first) await installSummaryTypeIcons(p);
    await installSummaryStatViewer(p);
    if (!first) await installSummaryTypeIcons(p);
    expect(getSummaryStatViewerStatus(p).compatible).toBe(true);
    expect(getSummaryTypeIconsStatus(p).compatible).toBe(true); expect(listCodeInjectionDlls(p)).toHaveLength(2);
  });
  it("round-trips the exact art and module while retaining native summary assets", async () => {
    fetchAssets(); const p = makeProject(v), source = p.originalRomBytes!, digest = sha256Hex(source);
    const original = new NintendoDSRom(source); await installSummaryTypeIcons(p);
    const exported = new NintendoDSRom(await exportModifiedRom(p));
    expect(exported.getFileByName(manifest.archivePath)).toEqual(art);
    expect(exported.loadArm9Overlays([207]).get(207)!.data).toEqual(original.loadArm9Overlays([207]).get(207)!.data);
    expect(new NARC(exported.getFileByName("a/0/7/7")).files).toEqual(new NARC(graphics).files);
    expect(sha256Hex(source)).toBe(digest);
    const re = makeProject(v, exported.data); expect(getSummaryTypeIconsStatus(re)).toMatchObject({ installed: true, compatible: true, canUninstall: false });
    const id = exported.fileId(`patches/SummaryTypeIcons${v}.dll`); await installSummaryTypeIcons(re);
    expect(re.fileSystem!.replacements[id]).toBeDefined(); expect(re.fileSystem!.additions?.[`patches/SummaryTypeIcons${v}.dll`]).toBeUndefined();
  });
  it("rejects altered hooks, unknown artwork and failed downloads atomically", async () => {
    fetchAssets(); const p = makeProject(v), original = structuredClone(p);
    p.overlays[207] = new NintendoDSRom(p.originalRomBytes!).loadArm9Overlays([207]).get(207)!.data.slice();
    p.overlays[207]![manifest.games[v].signatures[0].address - (v === "W2" ? 0x21b2fc0 : 0x21b2f80)] ^= 1;
    await expect(installSummaryTypeIcons(p)).rejects.toThrow(/Unrecognized/u); expect(p.fileSystem).toBeUndefined();
    const q = makeProject(v); q.fileSystem = { replacements: {}, additions: { [manifest.archivePath]: Uint8Array.of(1) } };
    const before = structuredClone(q); await expect(installSummaryTypeIcons(q)).rejects.toThrow(/unrecognized artwork/u); expect(q).toEqual(before);
    fetchAssets("summaryTypeIcons.narc"); await expect(installSummaryTypeIcons(original)).rejects.toThrow("Download failed"); expect(original.fileSystem).toBeUndefined();
  });
  it("updates renamed modules and rejects duplicates or corrupted modules", async () => {
    fetchAssets(); const p = makeProject(v); await installSummaryTypeIcons(p); uninstallSummaryTypeIcons(p);
    stageCodeInjectionDll(p, "MySummaryTypes.dll", read(`SummaryTypeIcons${v}.dll`));
    p.fileSystem!.additions![manifest.archivePath] = art;
    expect((await installSummaryTypeIcons(p)).path).toBe("patches/MySummaryTypes.dll");
    stageCodeInjectionDll(p, "Duplicate.dll", read(`SummaryTypeIcons${v}.dll`));
    await expect(installSummaryTypeIcons(p)).rejects.toThrow(/Multiple/u);
    const q = makeProject(v); await installSummaryTypeIcons(q); uninstallSummaryTypeIcons(q);
    const bad = parseRpm(read(`SummaryTypeIcons${v}.dll`), { allowedMagics: ["DLXF"] }); bad.code[0] ^= 1;
    stageCodeInjectionDll(q, `SummaryTypeIcons${v}.dll`, writeRpm(bad, { ident: "DLXF" }));
    await expect(installSummaryTypeIcons(q)).rejects.toThrow(/Conflicting/u);
  });
});
