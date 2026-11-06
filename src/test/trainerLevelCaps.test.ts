import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import profiles from "../assets/codeinjection/trainerLevelCapsManifest.json";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import {
  TRAINER_LEVEL_CAPS_PATH, cloneTrainerLevelCap, createTrainerLevelCapTable, getTrainerLevelCap, getTrainerLevelCapsStatus,
  hydrateTrainerLevelCapsSources, isTrainerLevelCapsModule, readTrainerLevelCapTable, updateTrainerLevelCap, writeTrainerLevelCapTable,
} from "../pokeweb/trainerLevelCapsModel";
import { renderTrainerLevelCapSetting, attachTrainerLevelCapSetting } from "../ui/trainerLevelCaps";

afterEach(() => vi.restoreAllMocks());
type Game = "B2" | "W2";
const bundle = (game: Game, base = false) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${base ? "HardLevelCaps" : "TrainerLevelCaps"}${game}.dll`, import.meta.url)));
function fixture(game: Game, installed = true): ProjectState {
  const p = profiles[game], rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(p.idCode), 12);
  rom.arm9 = new Uint8Array(4); rom.arm7 = new Uint8Array(4); rom.arm9RamAddress = 0x02004000;
  rom.files = [new Uint8Array(Buffer.from(p.expectedHex, "hex"))]; rom.filenames = new Folder();
  rom.arm9OverlayTable = new Uint8Array(32);
  writeU32(rom.arm9OverlayTable, 0, 12); writeU32(rom.arm9OverlayTable, 4, p.signatureAddress); writeU32(rom.arm9OverlayTable, 8, rom.files[0].length);
  const project: ProjectState = {
    originalRomBytes: rom.save(), arm9: rom.arm9, overlays: {},
    session: { baseRom: "BW2", baseVersion: game, romName: "fixture", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { idCode: p.idCode, title: "fixture", fileName: "fixture.nds", size: 0 },
    narcs: {}, formats: {}, texts: { banks: {} }, trpokInfo: [],
    codeInjection: { pmc: { overlayId: 344, overlayBaseAddress: 0x021fd1c0, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } },
  };
  project.narcs.trdata = { fileCount: 1000 } as NonNullable<ProjectState["narcs"]["trdata"]>;
  stageCodeInjectionDll(project, `HardLevelCaps${game}.dll`, bundle(game, true));
  if (installed) stageCodeInjectionDll(project, p.fileName, bundle(game));
  hydrateTrainerLevelCapsSources(project, new NintendoDSRom(project.originalRomBytes!));
  return project;
}

describe("trainer level cap table", () => {
  it("defaults to no change and preserves neighboring records while growing", () => {
    const original = createTrainerLevelCapTable(3);
    let table = writeTrainerLevelCapTable(original, 2, 40);
    table = writeTrainerLevelCapTable(table, 800, 55);
    expect(readTrainerLevelCapTable(original, 2)).toBe(0);
    expect(readTrainerLevelCapTable(table, 2)).toBe(40);
    expect(readTrainerLevelCapTable(table, 799)).toBe(0);
    expect(readTrainerLevelCapTable(table, 800)).toBe(55);
    expect(readTrainerLevelCapTable(table, 801)).toBe(0);
    expect(readTrainerLevelCapTable(writeTrainerLevelCapTable(table, 800, 0), 800)).toBe(0);
    expect(readTrainerLevelCapTable(writeTrainerLevelCapTable(table, 65535, 100), 65535)).toBe(100);
  });
  it("rejects invalid cap values, IDs, headers, and lengths", () => {
    const table = createTrainerLevelCapTable(3);
    for (const cap of [-1, 101, 2.5, NaN, Infinity]) expect(() => writeTrainerLevelCapTable(table, 1, cap)).toThrow();
    for (const id of [-1, 65536, NaN, 1.5]) expect(() => readTrainerLevelCapTable(table, id)).toThrow();
    for (const count of [0, 65537, NaN]) expect(() => createTrainerLevelCapTable(count)).toThrow();
    for (const at of [0, 4, 6, 8, 12]) { const bad = table.slice(); bad[at] ^= 0xff; expect(() => readTrainerLevelCapTable(bad, 1)).toThrow(); }
    expect(() => readTrainerLevelCapTable(table.subarray(0, -1), 1)).toThrow();
    const bad = table.slice(); bad[17] = 101; expect(() => readTrainerLevelCapTable(bad, 1)).toThrow();
  });
});

describe.each(["B2", "W2"] as const)("trainer cap editor %s", game => {
  it("recognizes only the exact shipped runtime, symbols, metadata and hook", () => {
    const rpm = parseRpm(bundle(game), { allowedMagics: ["DLXF"] });
    expect(isTrainerLevelCapsModule(rpm, game)).toBe(true);
    expect(isTrainerLevelCapsModule(rpm, game === "W2" ? "B2" : "W2")).toBe(false);
    expect(rpm.relocations.filter(r => r.target.module !== "base").map(r => r.target)).toEqual([
      { module: "12", address: profiles[game].hookAddress, type: "THUMB_BRANCH_LINK" },
    ]);
    rpm.symbols[0].address += 2; expect(isTrainerLevelCapsModule(rpm, game)).toBe(false);
  });
  it("hides the field before installation, uses the requested label, and permits clearing", () => {
    const p = fixture(game, false);
    expect(getTrainerLevelCapsStatus(p)).toMatchObject({ compatible: true, installed: false });
    expect(renderTrainerLevelCapSetting(p, 800)).toBe("");
    stageCodeInjectionDll(p, profiles[game].fileName, bundle(game));
    updateTrainerLevelCap(p, 800, 55);
    const html = renderTrainerLevelCapSetting(p, 800);
    expect(html).toContain(">Lvl Cap after Win</label>"); expect(html).toContain('value="55"');
    updateTrainerLevelCap(p, 800, 0);
    expect(renderTrainerLevelCapSetting(p, 800)).toContain('placeholder="No change"');
    expect(renderTrainerLevelCapSetting(p, 800)).toContain('value=""');
  });
  it("retains edits after source release and clones the configured value for new trainers", () => {
    const p = fixture(game);
    p.originalRomBytes = undefined;
    expect(getTrainerLevelCapsStatus(p)).toMatchObject({ compatible: true, installed: true });
    updateTrainerLevelCap(p, 800, 55); updateTrainerLevelCap(p, 801, 40);
    expect(getTrainerLevelCap(p, 800)).toBe(55);
    cloneTrainerLevelCap(p, 800, 1000); expect(getTrainerLevelCap(p, 1000)).toBe(55);
    expect(getTrainerLevelCap(p, 801)).toBe(40);
    expect(() => updateTrainerLevelCap(p, 1000, 60)).toThrow("Trainer does not exist");
  });
  it("exports, reopens, edits existing file IDs and exports again without duplicate files", async () => {
    const p = fixture(game); delete p.narcs.trdata;
    p.fileSystem!.additions![TRAINER_LEVEL_CAPS_PATH] = writeTrainerLevelCapTable(createTrainerLevelCapTable(1000), 800, 55);
    const bytes = await exportModifiedRom(p), rom = new NintendoDSRom(bytes);
    expect(readTrainerLevelCapTable(rom.getFileByName(TRAINER_LEVEL_CAPS_PATH), 800)).toBe(55);
    const reopened = fixture(game);
    reopened.originalRomBytes = bytes; reopened.fileSystem = { replacements: {} };
    hydrateTrainerLevelCapsSources(reopened, rom);
    reopened.originalRomBytes = undefined;
    expect(getTrainerLevelCapsStatus(reopened)).toMatchObject({ compatible: true, installed: true });
    updateTrainerLevelCap(reopened, 800, 60);
    expect(reopened.fileSystem!.additions?.[TRAINER_LEVEL_CAPS_PATH]).toBeUndefined();
    expect(readTrainerLevelCapTable(reopened.fileSystem!.replacements[rom.fileId(TRAINER_LEVEL_CAPS_PATH)], 800)).toBe(60);
    reopened.originalRomBytes = bytes; delete reopened.narcs.trdata;
    const final = new NintendoDSRom(await exportModifiedRom(reopened));
    expect(final.fileId(TRAINER_LEVEL_CAPS_PATH)).toBe(rom.fileId(TRAINER_LEVEL_CAPS_PATH));
    expect(readTrainerLevelCapTable(final.getFileByName(TRAINER_LEVEL_CAPS_PATH), 800)).toBe(60);
  });
  it("rejects missing dependencies, modified hook bytes, renamed, corrupt and overlapping modules", () => {
    let p = fixture(game);
    delete p.fileSystem!.additions![`patches/HardLevelCaps${game}.dll`]; p.codeInjection!.modules = p.codeInjection!.modules!.filter(m => m.fileName !== `HardLevelCaps${game}.dll`);
    expect(getTrainerLevelCapsStatus(p).message).toContain("Install Hard Level Caps first");
    p = fixture(game); p.overlays[12] = new Uint8Array(40);
    expect(getTrainerLevelCapsStatus(p).compatible).toBe(false);
    p = fixture(game, false); stageCodeInjectionDll(p, "Renamed.dll", bundle(game));
    expect(getTrainerLevelCapsStatus(p).message).toContain("standard");
    p = fixture(game); const rpm = parseRpm(bundle(game), { allowedMagics: ["DLXF"] }); rpm.code[0] ^= 1;
    stageCodeInjectionDll(p, profiles[game].fileName, writeRpm(rpm, { ident: "DLXF" }));
    expect(getTrainerLevelCapsStatus(p).message).toContain("Conflicting");
    p = fixture(game, false); stageCodeInjectionDll(p, "Other.dll", writeRpm(rpm, { ident: "DLXF" }));
    expect(getTrainerLevelCapsStatus(p).message).toContain("Conflicting");
    p = fixture(game, false);
    const hook = rpm.relocations.find(r => r.target.module === "12")!;
    hook.target.address = profiles[game].signatureAddress; hook.target.type = "THUMB_BRANCH";
    stageCodeInjectionDll(p, "Other.dll", writeRpm(rpm, { ident: "DLXF" }));
    expect(getTrainerLevelCapsStatus(p).message).toContain("Conflicting");
  });
});

it("saves the trainer control, clears it, and rejects invalid inputs without changing saved data", () => {
  const p = fixture("W2");
  let change: (event: Event) => void = () => {};
  const root = { addEventListener: (_: string, callback: typeof change) => { change = callback; } } as unknown as HTMLElement;
  const note = { textContent: "" }, dirty = vi.fn();
  const input = { value: "55", validity: { badInput: false }, matches: () => true,
    closest: () => ({ dataset: { index: "800" } }), parentElement: { querySelector: () => note }, setAttribute: vi.fn(), removeAttribute: vi.fn() };
  attachTrainerLevelCapSetting(p, root, dirty);
  const fire = () => change({ target: input } as unknown as Event);
  fire(); expect(getTrainerLevelCap(p, 800)).toBe(55); expect(dirty).toHaveBeenCalledOnce();
  input.value = "101"; fire(); expect(getTrainerLevelCap(p, 800)).toBe(55); expect(note.textContent).toContain("0–100");
  input.value = ""; fire(); expect(getTrainerLevelCap(p, 800)).toBe(0); expect(dirty).toHaveBeenCalledTimes(2);
  input.validity.badInput = true; fire(); expect(dirty).toHaveBeenCalledTimes(2);
});
