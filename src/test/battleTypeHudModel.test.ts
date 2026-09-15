import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/battleTypeHudManifest.json";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getBattleTypeHudStatus, installBattleTypeHud, uninstallBattleTypeHud, getMoveEffectivenessStatus, installMoveEffectiveness, uninstallMoveEffectiveness, moveHighlightRgb555, DEFAULT_MOVE_HIGHLIGHT_COLORS } from "../pokeweb/battleTypeHudModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { detectPmcInstallFromRom, getPmcInstallStatus, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

vi.mock("../assets/codeinjection/battleTypeHudManifest.json", async (original) => {
  const value = await original<{ default: typeof manifest }>();
  const copy = structuredClone(value.default);
  // Small synthetic resource, so tests exercise hash rejection without a ROM.
  const { createHash } = await import("node:crypto");
  for (const game of Object.values(copy.games)) game.resources = { "430": createHash("sha256").update("PLTT").digest("hex") } as typeof game.resources;
  return { default: copy };
});
afterEach(() => vi.unstubAllGlobals());
const dll = (v: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/TypeIcons${v}.dll`, import.meta.url)));
function assets() {
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(new Uint8Array(readFileSync(url)))));
}
describe("Battle HUD bundled installer", () => {
  it.each(["B2", "W2"] as const)("installs, exports, reimports and recognizes %s without duplicate hooks", async v => {
    const p = project(v); assets();
    expect(getBattleTypeHudStatus(p)).toMatchObject({ compatible: true, checked: true, installed: false });
    await installBattleTypeHud(p);
    expect(getPmcInstallStatus(p).installed).toBe(true);
    expect(getBattleTypeHudStatus(p)).toMatchObject({ installed: true, canUninstall: true, updateAvailable: false });
    const exported = new NintendoDSRom(await exportModifiedRom(p));
    expect(exported.getFileByName(`patches/TypeIcons${v}.dll`)).toEqual(dll(v));
    const reimported = project(v, exported.data);
    expect(getBattleTypeHudStatus(reimported)).toMatchObject({ installed: true, compatible: true, canUninstall: false });
    await installBattleTypeHud(reimported);
    expect(reimported.fileSystem?.additions?.[`patches/TypeIcons${v}.dll`]).toBeUndefined();
    expect(() => uninstallBattleTypeHud(reimported)).toThrow(/staged/);
    uninstallBattleTypeHud(p);
    expect(getBattleTypeHudStatus(p)).toMatchObject({ installed: false, pmcInstalled: true });
  });
  it.each(["B2", "W2"] as const)("checks the distributed %s code and overlay-only imports", v => {
    const bytes = dll(v); const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.games[v].dllSha256);
    expect(rpm.bssSize).toBeLessThanOrEqual(384);
    expect(rpm.symbols.some(s => s.attributes & 2)).toBe(false);
    expect(rpm.relocations.filter(r => r.target.module !== "base").every(r => r.target.module === "168")).toBe(true);
  });
  it("rejects a raw native hook change even if an unchanged overlay is cached", async () => {
    const p = project("W2"); const rom = new NintendoDSRom(p.originalRomBytes!); const ov = rom.loadArm9Overlays([168]).get(168)!;
    p.overlays[168] = ov.data.slice(); const changed = ov.data.slice(); changed[manifest.games.W2.hooks[0]!.address - ov.ramAddress] ^= 1;
    p.fileSystem = { replacements: { [ov.fileId]: changed } };
    await expect(installBattleTypeHud(p)).rejects.toThrow(/compatibility failed/);
    expect(p.codeInjection).toBeUndefined();
  });
  it("updates the previous enemy-only build in place, including a renamed DLL", async () => {
    const p = project("W2"); assets();
    await installBattleTypeHud(p); uninstallBattleTypeHud(p);
    const old = new Uint8Array(readFileSync(new URL("./fixtures/battle-type-hud/BattleTypeHudW2-0.1.0.dll", import.meta.url)));
    stageCodeInjectionDll(p, "MyHud.dll", old);
    expect(getBattleTypeHudStatus(p)).toMatchObject({ installed: true, updateAvailable: true, dllPath: "patches/MyHud.dll" });
    await installBattleTypeHud(p);
    expect(p.fileSystem?.additions?.["patches/MyHud.dll"]).toEqual(dll("W2"));
    expect(p.fileSystem?.additions?.["patches/TypeIconsW2.dll"]).toBeUndefined();
    expect(getBattleTypeHudStatus(p)).toMatchObject({ installed: true, updateAvailable: false });
  });
  it("rejects incompatible resources and fetch failures before staging PMC", async () => {
    const p = project("W2"); const a = new NARC(); a.files = Array.from({ length: 431 }, () => new Uint8Array([0]));
    p.fileSystem = { replacements: { 344: a.save() } };
    await expect(installBattleTypeHud(p)).rejects.toThrow(/member 430/);
    expect(p.codeInjection).toBeUndefined();
    p.fileSystem = undefined;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(installBattleTypeHud(p)).rejects.toThrow(/404/);
    expect(p.codeInjection).toBeUndefined();
  });
  it("recognizes renamed copies, blocks duplicates and overlapping veneers", async () => {
    const p = project("W2"); assets(); await installBattleTypeHud(p); uninstallBattleTypeHud(p);
    stageCodeInjectionDll(p, "Renamed.dll", dll("W2"));
    expect(getBattleTypeHudStatus(p)).toMatchObject({ installed: true, dllPath: "patches/Renamed.dll" });
    stageCodeInjectionDll(p, "Copy.dll", dll("W2"));
    expect(getBattleTypeHudStatus(p).compatible).toBe(false);
    delete p.fileSystem!.additions!["patches/Copy.dll"]; p.codeInjection!.modules = p.codeInjection!.modules!.filter(m => m.fileName !== "Copy.dll");
    uninstallBattleTypeHud(p);
    const foreign = parseRpm(dll("W2"), { allowedMagics: ["DLXF"] }); foreign.code[0] ^= 1;
    foreign.relocations = [{ sourceSymbolIndex: 0, target: { module: "168", address: manifest.games.W2.hooks[0]!.address - 8, type: "THUMB_BRANCH_SAFESTACK" } }];
    stageCodeInjectionDll(p, "Foreign.dll", writeRpm(foreign, { ident: "DLXF" }));
    await expect(installBattleTypeHud(p)).rejects.toThrow(/Foreign.dll/);
  });
  it.each(["B2", "W2"] as const)("installs %s components independently and removes either without touching the other", async v => {
    const p = project(v); assets();
    await installMoveEffectiveness(p);
    expect(getBattleTypeHudStatus(p).installed).toBe(false);
    expect(getMoveEffectivenessStatus(p).installed).toBe(true);
    await installBattleTypeHud(p);
    expect(getMoveEffectivenessStatus(p).compatible).toBe(true);
    uninstallBattleTypeHud(p);
    expect(getMoveEffectivenessStatus(p).installed).toBe(true);
    await installBattleTypeHud(p); uninstallMoveEffectiveness(p);
    expect(getBattleTypeHudStatus(p).installed).toBe(true);
    expect(getMoveEffectivenessStatus(p).installed).toBe(false);
  });
  it("keeps custom move hooks and type-chart changes independent from icons", async () => {
    const p = project("W2"); assets();
    const rom = new NintendoDSRom(p.originalRomBytes!); const ov = rom.loadArm9Overlays([167]).get(167)!;
    const data = ov.data.slice(); const check = manifest.moveGames.W2.signatures.find(s => s.name === "TypeAffinity")!;
    data[check.address - ov.ramAddress] ^= 1; p.fileSystem = { replacements: { [ov.fileId]: data } };
    expect(getMoveEffectivenessStatus(p).compatible).toBe(false);
    await installBattleTypeHud(p);
    expect(getBattleTypeHudStatus(p)).toMatchObject({ installed: true, compatible: true });
  });
  it.each(["icons", "moves"])("replaces the old combined module with %s only, then can install its companion", async kind => {
    const p = project("W2"); assets(); await installBattleTypeHud(p); uninstallBattleTypeHud(p);
    const old = new Uint8Array(readFileSync(new URL("./fixtures/battle-type-hud/BattleTypeHudW2-0.2.0.dll", import.meta.url)));
    stageCodeInjectionDll(p, "MyCombined.dll", old);
    expect(getBattleTypeHudStatus(p).legacyCombined).toBe(true);
    expect(getMoveEffectivenessStatus(p).legacyCombined).toBe(true);
    const selected = kind === "icons" ? installBattleTypeHud : installMoveEffectiveness;
    const companion = kind === "icons" ? installMoveEffectiveness : installBattleTypeHud;
    await selected(p);
    expect(kind === "icons" ? getMoveEffectivenessStatus(p).installed : getBattleTypeHudStatus(p).installed).toBe(false);
    expect(Object.keys(p.fileSystem!.additions!).filter(p => p.endsWith(".dll"))).toEqual(["patches/MyCombined.dll"]);
    await companion(p);
    const rom = new NintendoDSRom(await exportModifiedRom(p)); const reimport = project("W2", rom.data);
    expect(getBattleTypeHudStatus(reimport)).toMatchObject({ installed: true, compatible: true, legacyCombined: false });
    expect(getMoveEffectivenessStatus(reimport)).toMatchObject({ installed: true, compatible: true, legacyCombined: false });
  });
  it("rejects other games and regions", async () => {
    const p = project("W2"); p.session.baseVersion = "W"; p.session.baseRom = "BW";
    await expect(installBattleTypeHud(p)).rejects.toThrow(/English Black 2/);
    const q = project("B2"); q.originalRomBytes!.set(new TextEncoder().encode("IREJ"), 12);
    await expect(installBattleTypeHud(q)).rejects.toThrow(/English Black 2/);
  });
  it.each(["B2", "W2"] as const)("edits only the six %s color bytes, preserving custom colors across export, reimport and reinstall", async v => {
    const p = project(v); assets();
    const colors = { superEffective: "#00ff00", notVeryEffective: "#0000ff", immune: "#ff00ff" };
    const original = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/MoveEffectiveness${v}.dll`, import.meta.url)));
    await installMoveEffectiveness(p, colors);
    const customized = p.fileSystem!.additions![`patches/MoveEffectiveness${v}.dll`]!;
    expect(customized.length).toBe(original.length);
    const rpm = parseRpm(customized, { allowedMagics: ["DLXF"] });
    const base = parseRpm(original, { allowedMagics: ["DLXF"] });
    const offset = manifest.moveGames[v].builds["0.4.0"].colorOffset;
    const changed = [...rpm.code.keys()].filter(i => rpm.code[i] !== base.code[i]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every(i => i >= offset && i < offset + 6)).toBe(true);
    expect(rpm.relocations).toEqual(base.relocations); expect(rpm.symbols).toEqual(base.symbols);
    expect([...rpm.code.slice(offset, offset + 6)]).toEqual([0xe0, 3, 0, 0x7c, 0x1f, 0x7c]);
    expect(getMoveEffectivenessStatus(p)).toMatchObject({ installed: true, updateAvailable: false, colors });
    const rom = new NintendoDSRom(await exportModifiedRom(p)); const reimport = project(v, rom.data);
    expect(getMoveEffectivenessStatus(reimport)).toMatchObject({ installed: true, compatible: true, colors });
    await installMoveEffectiveness(reimport);
    const again = new NintendoDSRom(await exportModifiedRom(reimport));
    expect(again.getFileByName(`patches/MoveEffectiveness${v}.dll`)).toEqual(customized);
    await installBattleTypeHud(reimport);
    expect(getMoveEffectivenessStatus(reimport).colors).toEqual(colors);
  });
  it("rejects invalid colors before staging and round-trips RGB555 at DS precision", async () => {
    const p = project("W2"); assets();
    await expect(installMoveEffectiveness(p, { ...DEFAULT_MOVE_HIGHLIGHT_COLORS, immune: "red" })).rejects.toThrow(/valid six-digit/);
    expect(p.codeInjection).toBeUndefined();
    expect(moveHighlightRgb555("#ffffff")).toBe(0x7fff);
    expect(moveHighlightRgb555("#000000")).toBe(0);
    expect(moveHighlightRgb555(DEFAULT_MOVE_HIGHLIGHT_COLORS.immune)).toBe(0x211f);
    expect(moveHighlightRgb555(DEFAULT_MOVE_HIGHLIGHT_COLORS.superEffective)).toBe(0x2b5e);
    expect(moveHighlightRgb555(DEFAULT_MOVE_HIGHLIGHT_COLORS.notVeryEffective)).toBe(0x62b3);
  });
  it.each(["code", "color high bit", "state size"])("rejects a customized DLL with invalid %s", async mutation => {
    const p = project("W2"); assets(); await installMoveEffectiveness(p); uninstallMoveEffectiveness(p);
    const original = new Uint8Array(readFileSync(new URL("../assets/codeinjection/MoveEffectivenessW2.dll", import.meta.url)));
    const rpm = parseRpm(original, { allowedMagics: ["DLXF"] });
    if (mutation === "code") rpm.code[0] ^= 1;
    else if (mutation === "color high bit") rpm.code[manifest.moveGames.W2.builds["0.4.0"].colorOffset + 1] |= 0x80;
    else rpm.bssSize = 0;
    stageCodeInjectionDll(p, "CustomPreview.dll", writeRpm(rpm, { ident: "DLXF" }));
    expect(getMoveEffectivenessStatus(p).compatible).toBe(false);
  });
  it("updates the previous standalone move module without changing icons", async () => {
    const p = project("W2"); assets(); await installBattleTypeHud(p);
    const icons = p.fileSystem!.additions!["patches/TypeIconsW2.dll"]!.slice();
    stageCodeInjectionDll(p, "OldPreview.dll", new Uint8Array(readFileSync(new URL("./fixtures/battle-type-hud/MoveEffectivenessW2-0.3.0.dll", import.meta.url))));
    expect(getMoveEffectivenessStatus(p)).toMatchObject({ installed: true, updateAvailable: true });
    await installMoveEffectiveness(p, { superEffective: "#00ff00", notVeryEffective: "#0000ff", immune: "#ff00ff" });
    expect(getMoveEffectivenessStatus(p)).toMatchObject({ installed: true, updateAvailable: false, dllPath: "patches/OldPreview.dll" });
    expect(p.fileSystem!.additions!["patches/TypeIconsW2.dll"]).toEqual(icons);
  });
  it.each(["0.3.0", "0.3.1", "0.3.2", "0.3.3", "0.3.7", "0.3.8", "0.3.9", "0.3.10", "0.3.11", "0.3.12", "0.3.13", "0.3.14", "0.3.15"])("updates imported %s icons without touching customized move colors", async version => {
    const p = project("W2"); assets();
    const colors = { superEffective: "#00ff00", notVeryEffective: "#0000ff", immune: "#ff00ff" };
    await installMoveEffectiveness(p, colors);
    const moves = p.fileSystem!.additions!["patches/MoveEffectivenessW2.dll"]!.slice();
    stageCodeInjectionDll(p, "MyIcons.dll", new Uint8Array(readFileSync(new URL(`./fixtures/battle-type-hud/TypeIconsW2-${version}.dll`, import.meta.url))));
    const imported = project("W2", await exportModifiedRom(p));
    expect(getBattleTypeHudStatus(imported)).toMatchObject({ installed: true, updateAvailable: true });
    expect(getMoveEffectivenessStatus(imported)).toMatchObject({ updateAvailable: false, colors });
    await installBattleTypeHud(imported);
    const exported = new NintendoDSRom(await exportModifiedRom(imported));
    expect(exported.getFileByName("patches/MyIcons.dll")).toEqual(dll("W2"));
    expect(exported.getFileByName("patches/MoveEffectivenessW2.dll")).toEqual(moves);
    expect(getBattleTypeHudStatus(imported)).toMatchObject({ installed: true, updateAvailable: false });
  });
});
function project(v: "B2" | "W2", bytes?: Uint8Array): ProjectState {
  const profile = manifest.games[v];
  if (!bytes) {
    const rom = new NintendoDSRom(new Uint8Array(0x200)); rom.data.set(new TextEncoder().encode(profile.rom_code), 12);
    rom.arm9 = new Uint8Array(0xa0000); rom.arm9RamAddress = 0x02000000; writeU32(rom.data, 0x28, rom.arm9RamAddress); rom.arm7 = new Uint8Array(4);
    rom.arm9OverlayTable = new Uint8Array(344 * 32); rom.files = Array.from({ length: 345 }, () => new Uint8Array(4));
    const archive = new NARC(); archive.files = Array.from({ length: 431 }, () => new Uint8Array([0])); archive.files[430] = new TextEncoder().encode("PLTT"); rom.files[344] = archive.save();
    rom.filenames = new Folder({ folders: [["a", new Folder({ folders: [["0", new Folder({ folders: [["1", new Folder({ files: ["1"], firstId: 344 })]] })]] })]] });
    for (let id = 0; id < 344; id++) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
    for (const id of [167, 168]) { rom.files[id] = new Uint8Array(0x40000); writeU32(rom.arm9OverlayTable, id * 32 + 4, id === 168 ? profile.overlay_base : 0x02199000); writeU32(rom.arm9OverlayTable, id * 32 + 8, 0x40000); }
    for (const s of [...profile.signatures, ...manifest.moveGames[v].signatures, ...profile.hooks.map(h => ({ ...h, segment: 168 })), ...manifest.moveGames[v].hooks.map(h => ({ ...h, segment: 168 }))]) {
      const base = s.segment === 0 ? 0x02000000 : s.segment === 168 ? profile.overlay_base : 0x02199000;
      (s.segment === 0 ? rom.arm9 : rom.files[s.segment]!).set(Buffer.from(s.bytes, "hex"), s.address - base);
    }
    bytes = rom.save({ filenames: rom.filenames });
  }
  const rom = new NintendoDSRom(bytes);
  return { originalRomBytes: bytes, session: { romName: "fixture", baseRom: "BW2", baseVersion: v, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { idCode: rom.idCode, title: "fixture", fileName: "fixture.nds", size: bytes.length }, arm9: rom.arm9,
    overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], codeInjection: detectPmcInstallFromRom(rom) };
}
