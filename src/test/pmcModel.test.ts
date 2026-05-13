import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii, readU32, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import {
  getPmcInstallStatus,
  installPmcBytes,
  listCodeInjectionDlls,
  PMC_OVERLAY_ID_PATH,
  PMC_SYMBOL_PATH,
  stageCodeInjectionDll,
  validateCodeInjectionDll,
} from "../pokeweb/pmcModel";
import { parseRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";

const pmcB2 = new Uint8Array(readFileSync(new URL("../../../PMC_B2.rpm", import.meta.url)));
const pmcW2 = new Uint8Array(readFileSync(new URL("../../../PMC_W2.rpm", import.meta.url)));

describe("PMC installer", () => {
  it("parses bundled PMC metadata", () => {
    expect(parseRpm(pmcB2).metadata).toMatchObject({ PMCGameID: "B2", PMCVersion: "13.2.4" });
    expect(parseRpm(pmcW2).metadata).toMatchObject({ PMCGameID: "W2", PMCVersion: "13.2.4" });
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
    expect(rom.arm9OverlayTable.length).toBe(345 * 32);
    expect(readU32(rom.arm9OverlayTable, overlayEntry)).toBe(344);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 8)).toBe(0x3000);
    expect(readU32(rom.arm9OverlayTable, overlayEntry + 24)).toBe(rom.fileId("overlay/overlay_0344.bin"));
    expect(new TextDecoder().decode(rom.getFileByName(PMC_OVERLAY_ID_PATH))).toBe("344");
    expect(readAscii(rom.getFileByName("overlay/overlay_0344.bin"), 0x2ff0, 4)).toBe("OVL0");
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

function makeBw2LikeRom(): Uint8Array {
  const files = [Uint8Array.of(1)];
  const fnt = saveFnt(new Folder({ files: ["base.bin"], firstId: 0 }));
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

function makeDllFromRpm(rpm: Uint8Array): Uint8Array {
  const dll = rpm.slice();
  dll.set([0x44, 0x4c, 0x58, 0x46], 0);
  return dll;
}
