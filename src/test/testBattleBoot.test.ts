import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { parseRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";
import { buildMoveTestBattleDownloads, buildQuickLaunchDownloads, buildTestBattleDownloads, rawSaveBytesFromDesmumeDsv } from "../pokeweb/testBattle";

// Isolate native installation/export here; real ROM cold boots exercise those
// adapters. These checks protect the app's test/overworld routing and isolation.
const native = vi.hoisted(() => ({
  validate: vi.fn(), guard: vi.fn(), trainer: vi.fn((_project: ProjectState, _config: { trainerId: number }) => 2),
  save: vi.fn((save: Uint8Array) => save.slice()),
  party: vi.fn((save: Uint8Array) => save.slice()),
  move: vi.fn((save: Uint8Array) => save.slice()),
  prepare: vi.fn(), stage: vi.fn(), export: vi.fn(), romSave: vi.fn(),
}));
vi.mock("../pokeweb/battleHarness", async original => ({
  ...await original<typeof import("../pokeweb/battleHarness")>(),
  validateHarnessRom: native.validate, patchHarnessExpandedPartyGuard: native.guard,
  patchHarnessTrainer: native.trainer, patchHarnessSave: native.save,
}));
vi.mock("../pokeweb/testBattleTeam", async original => ({
  ...await original<typeof import("../pokeweb/testBattleTeam")>(),
  patchTestBattleSavePlayerParty: native.party, patchTestBattleSavePlayerFirstMove: native.move,
}));
vi.mock("../pokeweb/exportRom", () => ({ exportModifiedRom: native.export }));
vi.mock("../pokeweb/black2UpgradeModel", () => ({ detectBw2Upgrade: (project: ProjectState) =>
  project.codeInjection?.modules?.some(module => module.fileName === "White2Upgrade.dll") ? "white2-upgrade" : undefined,
  usesExpandedBw2Data: (project: ProjectState) => project.codeInjection?.modules?.some(module => module.fileName === "White2Upgrade.dll") ?? false }));
vi.mock("../pokeweb/pmcModel", () => ({
  prepareBw2TestBattleCodeInjection: native.prepare, stageCodeInjectionDll: native.stage,
  listCodeInjectionDlls: (project: ProjectState) => project.codeInjection?.modules ?? [],
}));
vi.mock("../nds/rom", () => ({ NintendoDSRom: class {
  filenames = { idOf: () => 99 };
  files = { 99: (() => { const narc = new NARC(); narc.files = Array.from({ length: 54 }, () => new Uint8Array(8)); return narc.save(); })() };
  loadArm9Overlays() { return new Map([[36, { data: new Uint8Array(16), ramAddress: 0x0217f640 }]]); }
  save = native.romSave;
} }));

const template = new Uint8Array(readFileSync(new URL("../assets/testbattle/BattleHarnessW2.dll", import.meta.url)));
const saved = new Uint8Array(0x80000).fill(0x42);
function project(upgrade = false): ProjectState {
  return {
    session: { baseRom: "BW2", baseVersion: "W2", romName: "test", fileIds: {} },
    romInfo: { idCode: "IRDO" }, originalRomBytes: new Uint8Array(32),
    arm9: new Uint8Array(), overlays: {}, narcs: { move_animations: {
      name: "move_animations", fileId: 7, sourcePath: "a/0/6/5", fileCount: 54,
      rawFiles: Array.from({ length: 54 }, () => new Uint8Array(8)), records: new Map(), dirty: new Set(),
    } },
    codeInjection: { modules: upgrade ? [{ path: "patches/White2Upgrade.dll", fileName: "White2Upgrade.dll", target: "patches" }] : [] },
  } as unknown as ProjectState;
}
function configuration(): { trainer: number; rule: number } {
  const rpm = parseRpm(native.stage.mock.calls.at(-1)![2] as Uint8Array, { allowedMagics: ["DLXF"] });
  const at = rpm.symbols.find(symbol => symbol.nameHash === 0xc3592c1b)!.address;
  return { trainer: readU16(rpm.code, at + 6), rule: readU32(rpm.code, at + 8) };
}
beforeEach(() => {
  vi.clearAllMocks();
  native.export.mockResolvedValue(Uint8Array.of(1, 2, 3));
  native.romSave.mockReturnValue(Uint8Array.of(4, 5, 6));
  native.stage.mockImplementation((temporary: ProjectState, filename: string, bytes: Uint8Array) => {
    temporary.fileSystem = { replacements: {}, additions: { [`patches/${filename}`]: bytes } };
  });
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(url.pathname.endsWith(".dll") ? template : saved)));
});

describe("Pokeweb automatic battle boot", () => {
  it.each([false, true])("launches the real trainer and keeps temporary changes isolated (Upgrade %s)", async upgrade => {
    const source = project(upgrade), before = structuredClone(source);
    const result = await buildTestBattleDownloads(source, 123, { playerTeamText: "authored team" });
    expect(configuration()).toEqual({ trainer: 123, rule: 2 });
    expect(native.trainer.mock.calls[0]![1]).toEqual({ trainerId: 123 });
    expect(native.party.mock.calls[0]!.slice(1)).toEqual([source, "authored team", "BW2"]);
    expect(native.prepare.mock.calls[0]![0]).not.toBe(source);
    expect(native.guard).toHaveBeenCalledTimes(upgrade ? 1 : 0);
    expect(source).toEqual(before);
    const raw = rawSaveBytesFromDesmumeDsv(result.saveBytes);
    expect(raw.subarray(0x1e200, 0x1f600)).toEqual(saved.subarray(0x1e200, 0x1f600)); // Actor save slots.
    expect(raw.subarray(0x1ff00, 0x203e0)).toEqual(saved.subarray(0x1ff00, 0x203e0)); // Trainer flags.
  });
  it("keeps the selected move and pending animation on the automatic battle path", async () => {
    const source = project();
    await buildMoveTestBattleDownloads(source, 53, { moveAnimationScriptText: "TerminateMoveScript" });
    expect(configuration()).toEqual({ trainer: 2, rule: 2 });
    expect(native.move.mock.calls[0]!.slice(1)).toEqual([source, 53, "BW2"]);
    const files = native.romSave.mock.calls[0]![0].files as Map<number, Uint8Array>;
    expect(files.has(99)).toBe(true); // Resolve the post-install NitroFS ID, not the old store ID.
    expect(new NARC(files.get(99)!).files[53]).not.toEqual(new Uint8Array(8));
  });
  it.each([false, true])("leaves overworld quick launch's save and project unchanged (Upgrade %s)", async upgrade => {
    const source = project(upgrade), before = structuredClone(source);
    const result = await buildQuickLaunchDownloads(source);
    expect(native.stage).not.toHaveBeenCalled();
    expect(native.trainer).not.toHaveBeenCalled();
    expect(native.party).not.toHaveBeenCalled();
    expect(native.guard).toHaveBeenCalledTimes(upgrade ? 1 : 0);
    expect(rawSaveBytesFromDesmumeDsv(result.saveBytes)).toEqual(saved);
    expect(source).toEqual(before);
  });
  it("disables an imported test trigger during overworld quick launch", async () => {
    const source = project();
    source.codeInjection!.modules!.push({ path: "patches/BattleHarnessW2.dll", fileName: "BattleHarnessW2.dll", target: "patches" });
    await buildQuickLaunchDownloads(source);
    expect(configuration()).toEqual({ trainer: 0, rule: 0 });
    expect(source.fileSystem).toBeUndefined();
  });
  it("rejects incompatible native code without staging a runtime or mutating the project", async () => {
    const source = project(), before = structuredClone(source);
    native.validate.mockImplementationOnce(() => { throw new Error("Native hook mismatch"); });
    await expect(buildTestBattleDownloads(source, 123)).rejects.toThrow(/Native hook mismatch/);
    expect(native.stage).not.toHaveBeenCalled();
    expect(native.export).not.toHaveBeenCalled();
    expect(source).toEqual(before);
  });
});
