import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii, readU16, readU32, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import {
  detectBundledMainMenuSkipDll,
  detectPmcInstallFromRom,
  detectBundledDoubleBattleFixDll,
  detectWhite2UpgradeDlls,
  getPmcInstallStatus,
  installPmcBytes,
  listCodeInjectionDlls,
  PMC_OVERLAY_ID_PATH,
  PMC_PATCHES_KEEP_PATH,
  PMC_SYMBOL_PATH,
  prepareBw2TestBattleCodeInjection,
  stageCodeInjectionDll,
  validateCodeInjectionDll,
} from "../pokeweb/pmcModel";
import { parseRpm, writeRelocationDataByType, writeRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";

const pmcB2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/PMC_B2.rpm", import.meta.url)));
const pmcW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/PMC_W2.rpm", import.meta.url)));
const doubleBattleFixW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/DoubleBattleFixW2.dll", import.meta.url)));
const mainMenuSkipB2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/MainMenuSkipB2.dll", import.meta.url)));
const mainMenuSkipW2 = new Uint8Array(readFileSync(new URL("../assets/codeinjection/MainMenuSkipW2.dll", import.meta.url)));

describe("PMC installer", () => {
  it("parses bundled PMC metadata", () => {
    expect(parseRpm(pmcB2).metadata).toMatchObject({ PMCGameID: "B2", PMCVersion: "13.2.4" });
    expect(parseRpm(pmcW2).metadata).toMatchObject({ PMCGameID: "W2", PMCVersion: "13.2.4" });
  });

  it("does not double-count BSS when writing a packed code RPM", () => {
    const rpm = {
      code: Uint8Array.of(1, 2, 3, 4),
      bssSize: 0x10,
      baseAddress: 0,
      symbols: [],
      relocations: [],
      metadata: {},
    };

    const packed = writeRpm(rpm, { writeBss: true });

    expect(readU32(packed, 4)).toBe(packed.length);
  });

  it("writes Thumb BLX when a Thumb relocation targets ARM code", () => {
    const rpm = makeRelocationRpm("FUNCTION_ARM", 0x02001000);
    const out = new Uint8Array(4);

    writeRelocationDataByType(rpm, rpm.relocations[0]!, out, 0x02100000, 0x02100000);

    expect(readU16(out, 2) & 0xf800).toBe(0xe800);
  });

  it("keeps Thumb BL when a Thumb relocation targets Thumb code", () => {
    const rpm = makeRelocationRpm("FUNCTION_THM", 0x02001000);
    const out = new Uint8Array(4);

    writeRelocationDataByType(rpm, rpm.relocations[0]!, out, 0x02100000, 0x02100000);

    expect(readU16(out, 2) & 0xf800).toBe(0xf800);
  });

  it("rejects a bundled PMC binary for the wrong BW2 version", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    expect(() => installPmcBytes(project, pmcB2, romBytes)).toThrow(/for B2/u);
  });

  it("stages a CTRMap-compatible PMC overlay and exports its overlay table entry", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");

    const result = installPmcBytes(project, pmcW2, romBytes);
    expect(result.overlayId).toBe(344);
    expect(getPmcInstallStatus(project)).toMatchObject({ installed: true, overlayId: 344, version: "13.2.4" });

    const overlayBytes = project.fileSystem?.additions?.["overlay/overlay_0344.bin"];
    expect(overlayBytes).toBeTruthy();
    expect(readAscii(overlayBytes!, overlayBytes!.length - 0x10, 4)).toBe("OVL0");
    expect(new TextDecoder().decode(project.fileSystem?.additions?.[PMC_OVERLAY_ID_PATH])).toBe("344");
    expect(project.fileSystem?.additions?.[PMC_SYMBOL_PATH]?.length).toBeGreaterThan(0);
    expect(readU32(project.arm9, 0x400c)).not.toBe(0);

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    const overlayEntry = 344 * 32;
    const overlayFileId = rom.fileId("overlay/overlay_0344.bin");
    expect(rom.arm9OverlayTable.length).toBe(345 * 32);
    expect(readU16(rom.fntData, 4)).toBe(344);
    expect(duplicateFntFileIds(rom.fntData)).toEqual([]);
    expect(readU32(rom.arm9OverlayTable, overlayEntry)).toBe(344);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 8)).toBe(0x8000);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 24)).toBe(overlayFileId);
    expect(rom.fileId("base.bin")).toBe(344);
    expect(overlayFileId).toBeGreaterThan(344);
    expect(new TextDecoder().decode(rom.getFileByName(PMC_OVERLAY_ID_PATH))).toBe("344");
    expect(new TextDecoder().decode(rom.getFileByName(PMC_PATCHES_KEEP_PATH))).toBe("pokeweb");
    expect(readAscii(rom.getFileByName("overlay/overlay_0344.bin"), 0x2ff0, 4)).toBe("OVL0");
    expect(readU32(project.arm9, 0x7b41c)).toBe(result.overlayBaseAddress + 0x8000);
  });

  it("stages built DLXF patch and library DLLs after PMC is installed", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    const dll = makeDllFromRpm(pmcW2);

    const patch = stageCodeInjectionDll(project, "../My Patch.dll", dll, "patches");
    const library = stageCodeInjectionDll(project, "Helper", dll, "lib");

    expect(patch.path).toBe("patches/My Patch.dll");
    expect(library.path).toBe("lib/Helper.dll");
    expect(listCodeInjectionDlls(project).map((module) => module.path)).toEqual(["patches/My Patch.dll", "lib/Helper.dll"]);

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    expect(readAscii(rom.getFileByName("patches/My Patch.dll"), 0, 4)).toBe("DLXF");
    expect(readAscii(rom.getFileByName("lib/Helper.dll"), 0, 4)).toBe("DLXF");
  });

  it("lists DLXF DLLs already present in a reimported ROM filesystem", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    const dll = makeDllFromRpm(pmcW2);
    stageCodeInjectionDll(project, "My Patch.dll", dll, "patches");
    stageCodeInjectionDll(project, "Helper.dll", dll, "lib");

    const exported = await exportModifiedRom(project);
    const reimportedRom = new NintendoDSRom(exported);
    const reimportedProject = makeProject(exported, "W2");
    reimportedProject.codeInjection = detectPmcInstallFromRom(reimportedRom);

    expect(listCodeInjectionDlls(reimportedProject).map((module) => module.path)).toEqual(["lib/Helper.dll", "patches/My Patch.dll"]);
    expect(reimportedProject.codeInjection?.modules?.map((module) => module.path)).toEqual(["lib/Helper.dll", "patches/My Patch.dll"]);
  });

  it("detects White2Upgrade DLLs from staged or reimported code injection modules", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);
    stageCodeInjectionDll(project, "White2Upgrade.dll", makeDllFromRpm(pmcW2), "patches");

    expect(detectWhite2UpgradeDlls(project)).toBe(true);

    const reimportedRom = new NintendoDSRom(await exportModifiedRom(project));
    const reimportedProject = makeProject(reimportedRom.save(), "W2");
    reimportedProject.codeInjection = detectPmcInstallFromRom(reimportedRom);

    expect(detectWhite2UpgradeDlls(reimportedProject)).toBe(true);
    expect(reimportedProject.codeInjection?.modules?.map((module) => module.path)).toContain("patches/White2Upgrade.dll");
  });

  it("recognizes the bundled single-NPC double battle fix DLL", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);

    expect(detectBundledDoubleBattleFixDll(project)).toBe("unpatched");
    stageCodeInjectionDll(project, "DoubleBattleFixW2.dll", doubleBattleFixW2, "patches");

    expect(detectBundledDoubleBattleFixDll(project)).toBe("patched");
    expect(parseRpm(doubleBattleFixW2, { allowedMagics: ["DLXF"] }).metadata).toMatchObject({ PMCModulePriority: 4 });
  });

  it("recognizes bundled BW2 main menu skip DLLs", () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "W2");
    installPmcBytes(project, pmcW2, romBytes);

    expect(detectBundledMainMenuSkipDll(project)).toBe("unpatched");
    stageCodeInjectionDll(project, "MainMenuSkipW2.dll", mainMenuSkipW2, "patches");

    expect(detectBundledMainMenuSkipDll(project)).toBe("patched");
    expect(readAscii(mainMenuSkipB2, 0, 4)).toBe("DLXF");
    expect(readAscii(mainMenuSkipW2, 0, 4)).toBe("DLXF");
    expect([...mainMenuSkipB2]).not.toEqual([...mainMenuSkipW2]);
  });

  it("prepares BW2 Test Battle code injection with bundled PMC and main menu skip", async () => {
    const romBytes = makeBw2LikeRom();
    const project = makeProject(romBytes, "B2");

    await withBundledCodeInjectionFetch(async () => {
      const result = await prepareBw2TestBattleCodeInjection(project);

      expect(result).toMatchObject({ path: "patches/MainMenuSkipB2.dll", fileName: "MainMenuSkipB2.dll", target: "patches" });
      expect(getPmcInstallStatus(project)).toMatchObject({ installed: true, overlayId: 344, version: "13.2.4", gameId: "B2" });
      expect(detectBundledMainMenuSkipDll(project)).toBe("patched");
      expect(project.fileSystem?.additions?.["patches/MainMenuSkipB2.dll"]).toEqual(mainMenuSkipB2);

      const exported = new NintendoDSRom(await exportModifiedRom(project));
      expect(readAscii(exported.getFileByName("patches/MainMenuSkipB2.dll"), 0, 4)).toBe("DLXF");
      expect(new TextDecoder().decode(exported.getFileByName(PMC_OVERLAY_ID_PATH))).toBe("344");
    });
  });

  it("rejects Windows DLLs and unconverted RPM modules for user patch upload", () => {
    expect(() => validateCodeInjectionDll(Uint8Array.of(0x4d, 0x5a, 0, 0))).toThrow(/Windows DLL/u);
    expect(() => validateCodeInjectionDll(pmcW2)).toThrow(/RPM module/u);
  });
});

function makeProject(originalRomBytes: Uint8Array, baseVersion: "B2" | "W2"): ProjectState {
  return {
    originalRomBytes,
    session: {
      romName: "test",
      baseVersion,
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: originalRomBytes.length },
    arm9: new Uint8Array(0x80000),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeRelocationRpm(type: "FUNCTION_ARM" | "FUNCTION_THM", address: number) {
  return {
    code: new Uint8Array(),
    bssSize: 0,
    baseAddress: 0,
    symbols: [{ name: "target", size: 4, address, type, attributes: 1 << 2 }],
    relocations: [{ target: { module: "base", address: 0, type: "THUMB_BRANCH_LINK" as const }, sourceSymbolIndex: 0 }],
    metadata: {},
  };
}

function makeBw2LikeRom(): Uint8Array {
  const files = Array.from({ length: 345 }, (_value, index) => Uint8Array.of(index & 0xff));
  const fnt = saveFnt(new Folder({ files: ["base.bin"], firstId: 344 }));
  const overlayTable = new Uint8Array(344 * 32);
  writeU32(overlayTable, 0, 0);
  writeU32(overlayTable, 4, 0x021f8000);
  writeU32(overlayTable, 8, 0x2000);
  writeU32(overlayTable, 24, 0);

  const arm9 = new Uint8Array(0x80000);
  const out = new Uint8Array(0x100000);
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x49, 0x52, 0x44, 0x4f], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x28, 0x02000000);
  writeU32(out, 0x2c, arm9.length);
  writeU32(out, 0x30, 0x84000);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x85000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x85200);
  writeU32(out, 0x4c, files.length * 8);
  writeU32(out, 0x50, 0x86000);
  writeU32(out, 0x54, overlayTable.length);
  writeU32(out, 0x58, 0x88c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set(arm9, 0x4000);
  out.set([5, 6, 7, 8], 0x84000);
  out.set(fnt, 0x85000);
  out.set(overlayTable, 0x86000);
  let cursor = 0x88e00;
  files.forEach((file, index) => {
    cursor = align(cursor, 0x200);
    writeU32(out, 0x85200 + index * 8, cursor);
    out.set(file, cursor);
    cursor += file.length;
    writeU32(out, 0x85200 + index * 8 + 4, cursor);
  });
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

function duplicateFntFileIds(fnt: Uint8Array): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  const stack: number[] = [0];
  while (stack.length > 0) {
    const folderOffset = stack.shift()!;
    let fileId = readU16(fnt, folderOffset + 4);
    let offset = readU32(fnt, folderOffset);
    while (fnt[offset] !== 0) {
      const length = fnt[offset] & 0x7f;
      const isFolder = (fnt[offset] & 0x80) !== 0;
      offset += length + 1;
      if (isFolder) {
        stack.push((readU16(fnt, offset) & 0x0fff) * 8);
        offset += 2;
      } else {
        if (seen.has(fileId)) duplicates.add(fileId);
        seen.add(fileId);
        fileId += 1;
      }
    }
  }
  return [...duplicates].sort((a, b) => a - b);
}

function makeDllFromRpm(rpm: Uint8Array): Uint8Array {
  const dll = rpm.slice();
  dll.set([0x44, 0x4c, 0x58, 0x46], 0);
  return dll;
}

async function withBundledCodeInjectionFetch(run: () => Promise<void>): Promise<void> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
    const fileName = url.pathname.split("/").pop();
    if (fileName === "PMC_B2.rpm") return new Response(pmcB2);
    if (fileName === "PMC_W2.rpm") return new Response(pmcW2);
    if (fileName === "MainMenuSkipB2.dll") return new Response(mainMenuSkipB2);
    if (fileName === "MainMenuSkipW2.dll") return new Response(mainMenuSkipW2);
    return new Response(undefined, { status: 404 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}
