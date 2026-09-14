import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU16, writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import manifest from "../assets/codeinjection/learnsetViewerManifest.json";
import { configureLearnsetViewerDll, getLearnsetViewerStatus, learnsetViewerPaths, uninstallLearnsetViewer } from "../pokeweb/learnsetViewerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
const dll = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}.dll`, import.meta.url)));
const assets = Object.fromEntries(["W2", "B2"].flatMap(version => ["Menu", "Viewer"].map(group => [`Learnset${group}${version}`, dll(`Learnset${group}${version}`)])));

describe("standalone LEARNSET companions", () => {
  for (const version of ["W2", "B2"] as const) {
    it(`${version}: stripped pair has only intended overlay dependencies, no dynamic imports or constructors`, () => {
      for (const [group, expected, count] of [["Menu", ["12", "165"], 3], ["Viewer", ["258"], 24]] as const) {
        const bytes = assets[`Learnset${group}${version}`]!;
        const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        expect(rpm.metadata).toMatchObject({ PMCGameID: version, PMCVersion: "1.0.3", PMCModulePriority: 4 });
        // The actual PMC activation loop visits only chains 0..4. Merely
        // matching our own manifest does not prove a DLL will load.
        expect(Number(rpm.metadata.PMCModulePriority)).toBeGreaterThanOrEqual(0);
        expect(Number(rpm.metadata.PMCModulePriority)).toBeLessThanOrEqual(4);
        expect(rpm.symbols.every(s => s.name === null && !(s.attributes & 2))).toBe(true);
        const hooks = rpm.relocations.filter(r => r.target.module !== "base");
        expect([...new Set(hooks.map(r => r.target.module))].sort()).toEqual([...expected].sort());
        expect(hooks).toHaveLength(count);
        for (const r of hooks) expect(manifest.games[version].hooks.some(h => h.address === r.target.address && String(h.overlayId) === r.target.module)).toBe(true);
      }
    });
    it(`${version}: offers repair for the unloaded priority-5 release, including a mislabeled current version`, () => {
      const project = fixture(version);
      for (const group of ["Menu", "Viewer"]) {
        const rpm = parseRpm(configureLearnsetViewerDll(assets[`Learnset${group}${version}`]!, { menu: 1, empty: 2, error: 3 }), { allowedMagics: ["DLXF"] });
        rpm.metadata.PMCModulePriority = 5;
        rpm.metadata.PMCVersion = group === "Menu" ? "1.0.0" : "1.0.3";
        add(project, `Learnset${group}${version}`, writeRpm(rpm, { ident: "DLXF" }));
      }
      expect(getLearnsetViewerStatus(project)).toMatchObject({ installed: true, compatible: true, updateAvailable: true, messageIds: { menu: 1, empty: 2, error: 3 } });
    });
    it(`${version}: offers the spacing update for an otherwise valid 1.0.2 pair`, () => {
      const project = fixture(version);
      for (const group of ["Menu", "Viewer"]) {
        const rpm = parseRpm(configureLearnsetViewerDll(assets[`Learnset${group}${version}`]!, { menu: 1, empty: 2, error: 3 }), { allowedMagics: ["DLXF"] });
        rpm.metadata.PMCVersion = "1.0.2";
        add(project, `Learnset${group}${version}`, writeRpm(rpm, { ident: "DLXF" }));
      }
      expect(getLearnsetViewerStatus(project)).toMatchObject({ installed: true, compatible: true, updateAvailable: true, messageIds: { menu: 1, empty: 2, error: 3 } });
    });
    it(`${version}: configuration modifies only allocated ID/complement fields`, () => {
      const bytes = assets[`LearnsetMenu${version}`]!;
      const configured = configureLearnsetViewerDll(bytes, { menu: 0, empty: 55, error: 65534 });
      const offset = Buffer.from(bytes).indexOf(Buffer.from("LSVMSG1\0"));
      expect(readU16(configured, offset + 10)).toBe(0);
      expect(readU16(configured, offset + 14)).toBe(55);
      expect(readU16(configured, offset + 18)).toBe(65534);
      expect(readU16(bytes, offset + 10)).toBe(65535);
      for (let i = 0; i < bytes.length; ++i) if (i < offset + 10 || i >= offset + 22) expect(configured[i]).toBe(bytes[i]);
      for (const value of [-1, 65535, NaN, 0.5]) expect(() => configureLearnsetViewerDll(bytes, { menu: value, empty: 1, error: 2 })).toThrow();
      expect(() => configureLearnsetViewerDll(bytes.slice(0, offset + 23), { menu: 1, empty: 2, error: 3 })).toThrow();
    });
    it(`${version}: verifies hooks, rejects unknown changes, coexists with enhanced menu`, () => {
      const project = fixture(version);
      expect(getLearnsetViewerStatus(project)).toMatchObject({ supported: true, compatible: true, checked: true, installed: false });
      add(project, `MenuEvolution${version}`, dll(`MenuEvolution${version}`));
      expect(getLearnsetViewerStatus(project).compatible).toBe(true);
      add(project, `LearnsetMenu${version}`, configureLearnsetViewerDll(assets[`LearnsetMenu${version}`]!, { menu: 1, empty: 2, error: 3 }));
      expect(getLearnsetViewerStatus(project)).toMatchObject({ partial: true, installed: false });
      add(project, `LearnsetViewer${version}`, configureLearnsetViewerDll(assets[`LearnsetViewer${version}`]!, { menu: 1, empty: 2, error: 3 }));
      expect(getLearnsetViewerStatus(project)).toMatchObject({ installed: true, compatible: true, canUninstall: true, updateAvailable: false });
      project.fileSystem!.additions![`patches/LearnsetViewer${version}.dll`] = configureLearnsetViewerDll(assets[`LearnsetViewer${version}`]!, { menu: 4, empty: 2, error: 3 });
      expect(getLearnsetViewerStatus(project).updateAvailable).toBe(true);
      project.fileSystem!.additions![`patches/LearnsetViewer${version}.dll`] = configureLearnsetViewerDll(assets[`LearnsetViewer${version}`]!, { menu: 1, empty: 2, error: 3 });
      // An unknown DLL with identical targets must be rejected, even renamed.
      add(project, "OtherTutorPatch", assets[`LearnsetViewer${version}`]!);
      expect(getLearnsetViewerStatus(project)).toMatchObject({ compatible: false });
      project.codeInjection!.modules!.pop(); delete project.fileSystem!.additions!["patches/OtherTutorPatch.dll"];
      const rom = new NintendoDSRom(project.originalRomBytes!);
      const overlay = rom.loadArm9Overlays([258]).get(258)!;
      const changed = overlay.data.slice(); changed[0] ^= 1;
      project.overlays[258] = changed;
      expect(getLearnsetViewerStatus(project).compatible).toBe(false);
      delete project.overlays[258];
      uninstallLearnsetViewer(project);
      expect(getLearnsetViewerStatus(project).installed).toBe(false);
      expect(project.fileSystem!.additions![`patches/MenuEvolution${version}.dll`]).toBeDefined();
      for (const path of learnsetViewerPaths(version)) expect(project.fileSystem!.additions![path]).toBeUndefined();
    });
  }
});
function add(project: ProjectState, name: string, bytes: Uint8Array) {
  const path = `patches/${name}.dll`;
  project.codeInjection!.modules!.push({ path, fileName: name + ".dll", target: "patches" });
  project.fileSystem!.additions![path] = bytes;
}
function fixture(version: "W2" | "B2"): ProjectState {
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(manifest.games[version].idCode), 12);
  rom.arm9 = new Uint8Array(16); rom.arm9RamAddress = 0x2004000; writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4); rom.arm9OverlayTable = new Uint8Array(259 * 32);
  rom.files = Array.from({ length: 260 }, () => new Uint8Array(4));
  rom.filenames = new Folder({ files: ["base.bin"], firstId: 259 });
  for (let i = 0; i < 259; ++i) { writeU32(rom.arm9OverlayTable, i * 32, i); writeU32(rom.arm9OverlayTable, i * 32 + 24, i); }
  for (const id of [12, 165, 258]) {
    const hooks = manifest.games[version].hooks.filter(h => h.overlayId === id);
    const base = Math.min(...hooks.map(h => h.address));
    const end = Math.max(...hooks.map(h => h.address + h.expectedHex.length / 2));
    const data = new Uint8Array(end - base + 16);
    for (const hook of hooks) data.set(Buffer.from(hook.expectedHex, "hex"), hook.address - base);
    rom.files[id] = data; writeU32(rom.arm9OverlayTable, id * 32 + 4, base); writeU32(rom.arm9OverlayTable, id * 32 + 8, data.length);
  }
  const bytes = rom.save();
  return { originalRomBytes: bytes, session: { romName: "fixture", baseRom: "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "fixture", idCode: manifest.games[version].idCode, fileName: "fixture.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: { modules: [] }, fileSystem: { replacements: {}, additions: {} } } as ProjectState;
}
