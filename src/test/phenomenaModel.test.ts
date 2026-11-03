import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import manifest from "../assets/codeinjection/phenomenaManifest.json";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { encodeGen5TextBank } from "../pokeweb/text";
import {
  configurePhenomenaRuntime, decodePhenomenaConfig, encodePhenomenaConfig, getPhenomenaConfig, getPhenomenaStatus,
  inspectPhenomenaRuntime, phenomenonItemShares, savePhenomenaConfig, validatePhenomenaConfig, vanillaPhenomenaConfig,
  type PhenomenaConfig, type PhenomenaGame,
} from "../pokeweb/phenomenaModel";
import { stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

const GAMES = ["B", "W", "B2", "W2"] as const;
const ID_CODES = { B: "IRBO", W: "IRAO", B2: "IREO", W2: "IRDO" } as const;
const dll = (game: PhenomenaGame) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/Phenomena${game}.dll`, import.meta.url)));
afterEach(() => vi.unstubAllGlobals());
function assets() { vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(new Uint8Array(readFileSync(url))))); }

const custom = (): PhenomenaConfig => ({
  dust: { encounterPermille: 250, items: [{ item: 50, weight: 3 }, { item: 1, weight: 1 }] },
  shadow: { encounterPermille: 0, items: [{ item: 565, weight: 1 }] },
  groups: [{ kind: "dust", zones: [7, 9], encounterPermille: null, items: [{ item: 72, weight: 1 }] },
    { kind: "shadow", zones: [3], encounterPermille: 1000, items: [] }],
});

async function fixture(game: PhenomenaGame): Promise<ProjectState> {
  const spec = manifest.games[game], base = 0x02004000, overlayId = spec.overlay;
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(ID_CODES[game]), 12);
  rom.arm9RamAddress = base; writeU32(rom.data, 0x28, base);
  rom.arm9 = new Uint8Array(0x1000); rom.arm7 = new Uint8Array(4);
  rom.files = Array.from({ length: 346 }, () => new Uint8Array(4));
  rom.arm9OverlayTable = new Uint8Array(344 * 32); rom.filenames = new Folder();
  for (let id = 0; id < 344; ++id) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  const code = new Uint8Array(0x400);
  code.set(Buffer.from(spec.signature.expectedHex, "hex"), 0x100);
  rom.files[overlayId] = code;
  writeU32(rom.arm9OverlayTable, overlayId * 32 + 4, spec.signature.address - 0x100);
  writeU32(rom.arm9OverlayTable, overlayId * 32 + 8, code.length);
  const items = new NARC(); items.files = Array.from({ length: 639 }, () => new Uint8Array(36));
  const texts = new NARC(); texts.files = Array.from({ length: 65 }, () => encodeGen5TextBank([["0_0", "", 0]]));
  const headers = new NARC(); headers.files = [new Uint8Array(48 * 16)];
  for (const [path, id, data] of [["a/0/0/2", 341, texts.save()], ["a/0/0/3", 342, new NARC().save()], ["a/0/1/2", 343, headers.save()], ["a/0/2/4", 344, items.save()]] as const) {
    rom.files[id] = data; rom.filenames = addFilePath(rom.filenames, path, id);
  }
  const p = await loadProjectFromRomBytes(rom.save({ filenames: rom.filenames }), "fixture.nds", { selectedNarcs: ["items"] });
  p.codeInjection = { pmc: { overlayId: 344, overlayBaseAddress: 0x021fd1c0, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } };
  return p;
}

describe("phenomenon configuration", () => {
  it.each(GAMES)("%s: retail odds add up to whole tables", (game) => {
    const v = vanillaPhenomenaConfig(game);
    expect([v.dust.encounterPermille, v.shadow.encounterPermille]).toEqual([400, 200]);
    for (const items of [v.dust.items, v.shadow.items, ...v.groups.map((g) => g.items)])
      expect(items.reduce((sum, e) => sum + e.weight, 0)).toBe(1000);
    expect(v.dust.items).toHaveLength(28);
    expect(phenomenonItemShares(v.shadow.items)).toEqual([15, 15, 15, 15, 15, 15, 10]);
    expect(v.groups.length).toBe(game.endsWith("2") ? 1 : 0);
    if (game.endsWith("2")) expect(v.groups[0]).toMatchObject({ kind: "dust", zones: expect.arrayContaining([503, 542]), items: [72, 73, 74, 75].map((item) => ({ item, weight: 250 })) });
  });
  it("round-trips the native block and rejects malformed values", () => {
    expect(decodePhenomenaConfig(encodePhenomenaConfig(custom()), "W2")).toEqual(custom());
    const bad = encodePhenomenaConfig(custom()); bad[0] ^= 1;
    expect(() => decodePhenomenaConfig(bad, "W2")).toThrow();
    for (const mutate of [
      (c: PhenomenaConfig) => { c.dust.encounterPermille = 1001; },
      (c: PhenomenaConfig) => { c.shadow.items = []; },
      (c: PhenomenaConfig) => { c.dust.items = [{ item: 5, weight: 0 }]; },
      (c: PhenomenaConfig) => { c.groups[0]!.zones = [7, 7]; },
      (c: PhenomenaConfig) => { c.dust.items = Array.from({ length: 49 }, () => ({ item: 1, weight: 1 })); },
    ]) { const c = custom(); mutate(c); expect(() => validatePhenomenaConfig(c)).toThrow(); }
    expect(() => validatePhenomenaConfig(custom(), { itemCount: 60 })).toThrow(/does not exist \(565\)/u);
  });
  it.each(GAMES)("%s: configures only the bundled runtime's data block", (game) => {
    const rpm = parseRpm(dll(game), { allowedMagics: ["DLXF"] });
    expect(rpm.metadata.PMCGameID).toBe(game);
    expect(rpm.relocations.filter((r) => r.target.module !== "base").map((r) => r.target.address).sort())
      .toEqual(manifest.games[game].hooks.map((h) => h.address).sort());
    const configured = configurePhenomenaRuntime(dll(game), game, custom());
    expect(inspectPhenomenaRuntime(parseRpm(configured, { allowedMagics: ["DLXF"] }), game)).toEqual(custom());
    const other = game === "W2" ? "B2" : "W2";
    expect(inspectPhenomenaRuntime(parseRpm(configured, { allowedMagics: ["DLXF"] }), other)).toBeUndefined();
    const tampered = parseRpm(configured, { allowedMagics: ["DLXF"] }); tampered.code[0] ^= 1;
    expect(inspectPhenomenaRuntime(tampered, game)).toBeUndefined();
  });
});

describe.each(GAMES)("Phenomena editor install %s", (game) => {
  it("starts from retail behavior and stages a configured DLL", async () => {
    const p = await fixture(game); assets();
    expect(getPhenomenaStatus(p)).toMatchObject({ supported: true, compatible: true, installed: false, legacyItemPatch: false });
    expect(getPhenomenaConfig(p)).toEqual(vanillaPhenomenaConfig(game));
    await savePhenomenaConfig(p, custom());
    expect(getPhenomenaStatus(p)).toMatchObject({ compatible: true, installed: true });
    expect(getPhenomenaConfig(p)).toEqual(custom());
    const next = custom(); next.dust.encounterPermille = 1000;
    await savePhenomenaConfig(p, next);
    expect(getPhenomenaConfig(p).dust.encounterPermille).toBe(1000);
    expect(Object.keys(p.fileSystem!.additions!).filter((path) => /phenomena/iu.test(path))).toEqual([`patches/Phenomena${game}.dll`]);
  });
  it("migrates the Patches-page dust cloud item removal", async () => {
    const p = await fixture(game), spec = manifest.games[game]; assets();
    const overlay = p.overlays[spec.overlay] ?? new NintendoDSRom(p.originalRomBytes!).loadArm9Overlays([spec.overlay]).get(spec.overlay)!.data.slice();
    const at = spec.signature.dustBranchAddress - (spec.signature.address - 0x100);
    overlay[at] = spec.signature.dustBranchLegacy; p.overlays[spec.overlay] = overlay;
    p.patches = { dirtyOverlayIds: [spec.overlay], applied: { removeDustCloudItems: true } };
    expect(getPhenomenaStatus(p)).toMatchObject({ compatible: true, legacyItemPatch: true });
    expect(getPhenomenaConfig(p).dust.encounterPermille).toBe(1000);
    await savePhenomenaConfig(p, custom());
    expect(p.overlays[spec.overlay]![at]).toBe(spec.signature.dustBranchNative);
    expect(p.patches.applied?.removeDustCloudItems).toBeUndefined();
    expect(getPhenomenaStatus(p)).toMatchObject({ installed: true, legacyItemPatch: false });
  });
  it("refuses changed handler code and overlapping DLLs", async () => {
    const changed = await fixture(game), spec = manifest.games[game];
    const overlay = new NintendoDSRom(changed.originalRomBytes!).loadArm9Overlays([spec.overlay]).get(spec.overlay)!.data.slice();
    overlay[0x101] ^= 0xff; changed.overlays[spec.overlay] = overlay;
    expect(getPhenomenaStatus(changed)).toMatchObject({ compatible: false });
    const p = await fixture(game);
    const other = parseRpm(dll(game), { allowedMagics: ["DLXF"] });
    other.code[0] ^= 1;
    stageCodeInjectionDll(p, "Other.dll", writeRpm(other, { ident: "DLXF" }));
    expect(getPhenomenaStatus(p)).toMatchObject({ compatible: false, message: expect.stringContaining("Other.dll") });
  });
});
