import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import contract from "../../runtime/double-battle-fix/black1-contract.json";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { detectBundledDoubleBattleFixDll, stageBundledDoubleBattleFixDll, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

const dll = new Uint8Array(readFileSync(new URL("../assets/codeinjection/DoubleBattleFixB.dll", import.meta.url)));
afterEach(() => vi.unstubAllGlobals());

describe("Black 1 double battle fix", () => {
  it("targets only the two BW1 trainer routines and carries a Black game ID", () => {
    const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
    expect(rpm.metadata).toEqual({ PMCGameID: "B", PMCModulePriority: 4, PMCVersion: "1.0.0" });
    expect(rpm.bssSize).toBe(0);
    expect(rpm.relocations.map(({ target }) => target).sort((a, b) => a.address - b.address)).toEqual([
      { module: "21", address: 0x021ae0cc, type: "THUMB_BRANCH" },
      { module: "21", address: 0x021aebb0, type: "THUMB_BRANCH" },
    ]);
  });

  it("requires PMC before fetching or staging a DLL", async () => {
    const project = makeProject();
    delete project.codeInjection;
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/Install PMC/u);
    expect(fetch).not.toHaveBeenCalled();
    expect(project.fileSystem).toBeUndefined();
  });

  it("stages the Black asset once and recognizes repeat installation", async () => {
    const project = makeProject();
    stubAsset();
    expect(detectBundledDoubleBattleFixDll(project)).toBe("unpatched");
    expect(await stageBundledDoubleBattleFixDll(project)).toMatchObject({ path: "patches/DoubleBattleFixB.dll", gameId: "B" });
    await stageBundledDoubleBattleFixDll(project);
    expect(detectBundledDoubleBattleFixDll(project)).toBe("patched");
    expect(project.codeInjection?.modules).toHaveLength(1);
    expect(project.fileSystem?.additions?.["patches/DoubleBattleFixB.dll"]).toEqual(dll);
  });

  it.each(["region", "revision"])("rejects an unknown %s before staging", async kind => {
    const project = makeProject();
    if (kind === "region") project.originalRomBytes!.set(new TextEncoder().encode("IRBJ"), 12);
    else project.originalRomBytes![0x1e] = 1;
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/US Black.*revision 0/u);
    expect(project.fileSystem).toBeUndefined();
  });

  it.each([10, 21])("checks edited and replaced executable bytes in overlay %i", async id => {
    const project = makeProject();
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const original = rom.loadArm9Overlays([id]).get(id)!;
    const changed = original.data.slice();
    const signature = contract.signatures.find(item => item.overlayId === id)!;
    changed[signature.address - original.ramAddress] ^= 1;
    project.overlays[id] = changed;
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/trainer code differs/u);
    project.overlays[id] = original.data;
    project.fileSystem = { replacements: { [original.fileId]: changed } };
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/trainer code differs/u);
    expect(project.codeInjection?.modules).toBeUndefined();
  });

  it("rejects relocated overlays and competing DLL hooks", async () => {
    const project = makeProject();
    const rom = new NintendoDSRom(project.originalRomBytes!);
    project.patches = { dirtyOverlayIds: [], arm9OverlayTable: rom.arm9OverlayTable.slice() };
    writeU32(project.patches.arm9OverlayTable!, 21 * 32 + 4, 0x02190000);
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/incompatible/u);
    delete project.patches;
    stageCodeInjectionDll(project, "OtherTrainerHooks.dll", dll);
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/Conflicting.*OtherTrainerHooks/u);
  });

  it("preserves an unrecognized file using the bundled filename", async () => {
    const project = makeProject();
    const other = parseRpm(dll, { allowedMagics: ["DLXF"] });
    other.code[0] ^= 1;
    const bytes = writeRpm(other, { ident: "DLXF" });
    stageCodeInjectionDll(project, "DoubleBattleFixB.dll", bytes);
    stubAsset();
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/unrecognized/u);
    expect(project.fileSystem?.additions?.["patches/DoubleBattleFixB.dll"]).toEqual(bytes);
  });

  it("rejects an incorrectly bundled DLL and a hook starting before a trainer routine", async () => {
    const project = makeProject();
    const other = parseRpm(dll, { allowedMagics: ["DLXF"] });
    other.metadata.PMCGameID = "B2";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(writeRpm(other, { ident: "DLXF" }).slice())));
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/does not match/u);
    expect(project.fileSystem).toBeUndefined();
    other.metadata.PMCGameID = "B";
    other.relocations = [{ sourceSymbolIndex: 0, target: { module: "21", address: 0x021ae0c2, type: "THUMB_BRANCH_SAFESTACK" } }];
    stageCodeInjectionDll(project, "OtherTrainerHooks.dll", writeRpm(other, { ident: "DLXF" }));
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/Conflicting/u);
  });

  it("leaves White 1 unsupported and rejects installing the Black DLL there", async () => {
    const project = makeProject();
    project.session.baseVersion = "W";
    expect(detectBundledDoubleBattleFixDll(project)).toBe("unsupported");
    await expect(stageBundledDoubleBattleFixDll(project)).rejects.toThrow(/No bundled/u);
    expect(() => stageCodeInjectionDll(project, "DoubleBattleFixB.dll", dll)).toThrow(/for B.*loaded ROM is W/u);
  });
});

function stubAsset(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    expect(url.pathname).toMatch(/\/DoubleBattleFixB\.dll$/u);
    return new Response(dll.slice());
  }));
}

function makeProject(): ProjectState {
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode("IRBO"), 12);
  rom.arm9 = new Uint8Array(0x80000);
  rom.arm9RamAddress = 0x02004000;
  writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4);
  rom.arm9OverlayTable = new Uint8Array(237 * 32);
  rom.files = Array.from({ length: 238 }, () => new Uint8Array(4));
  rom.filenames = new Folder({ files: ["base.bin"], firstId: 237 });
  for (let id = 0; id < 237; id++) {
    writeU32(rom.arm9OverlayTable, id * 32, id);
    writeU32(rom.arm9OverlayTable, id * 32 + 24, id);
  }
  for (const id of [10, 21] as const) {
    const base = contract.overlayBases[id];
    const signatures = contract.signatures.filter(signature => signature.overlayId === id);
    const size = Math.max(...signatures.map(signature => signature.address - base + 16));
    rom.files[id] = new Uint8Array(size);
    for (const signature of signatures) rom.files[id].set(Buffer.from(signature.hex, "hex"), signature.address - base);
    writeU32(rom.arm9OverlayTable, id * 32 + 4, base);
    writeU32(rom.arm9OverlayTable, id * 32 + 8, size);
  }
  const bytes = rom.save();
  return {
    originalRomBytes: bytes,
    session: { romName: "test", baseRom: "BW", baseVersion: "B", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRBO", fileName: "test.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    codeInjection: { pmc: { overlayId: 237, overlayBaseAddress: 0x02217d20, overlayPath: "overlay/overlay_0237.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: "B" } },
  };
}
