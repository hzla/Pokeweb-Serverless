import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import {
  BW2_ARM9_RAM_BASE,
  buildForgettableHmsDll,
  findBw2MoveIsHm,
  findForgettableHmsConflict,
  getForgettableHmsPmcStatus,
  installForgettableHmsPmc,
  readForgettableHmsDll,
  restoreInlineForgettableHmsEdit,
} from "../pokeweb/forgettableHmsRuntime";
import type { ProjectState } from "../pokeweb/projectStore";
import { detectForgettableHmPatch } from "../pokeweb/romPatchModel";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

// PML_MoveIsHM in the swan White 2 symbol database.
const W2_MOVE_IS_HM = 0x02026b44;
const TABLE_LITERAL = 0x0209f000;
const TABLE_DISPLACEMENT = 0xa4;
const HM_MOVES = [15, 19, 57, 70, 127, 291];

function moveIsHmCode(literal = TABLE_LITERAL, displacement = TABLE_DISPLACEMENT): number[] {
  return [
    0x08, 0x4a, 0x00, 0x23, 0x59, 0x00, 0x51, 0x18, displacement, 0x31, 0x09, 0x88, 0x88, 0x42, 0x01, 0xd1,
    0x01, 0x20, 0x70, 0x47, 0x59, 0x1c, 0x09, 0x06, 0x0b, 0x0e, 0x06, 0x2b, 0xf2, 0xd3, 0x00, 0x20,
    0x70, 0x47, 0x00, 0x00, literal & 0xff, (literal >> 8) & 0xff, (literal >> 16) & 0xff, literal >>> 24,
  ];
}

function makeBw2Arm9(address = W2_MOVE_IS_HM): Uint8Array {
  const arm9 = new Uint8Array(0xa0000);
  arm9.set(moveIsHmCode(), address - BW2_ARM9_RAM_BASE);
  const table = TABLE_LITERAL + TABLE_DISPLACEMENT - BW2_ARM9_RAM_BASE;
  HM_MOVES.forEach((move, index) => writeU16(arm9, table + index * 2, move));
  return arm9;
}

function makeBw2Project(arm9 = makeBw2Arm9()): ProjectState {
  const originalRomBytes = new Uint8Array(0x200);
  originalRomBytes.set([0x49, 0x52, 0x44, 0x4f], 12); // IRDO
  return {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 0 },
    arm9,
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
    originalRomBytes,
    codeInjection: { pmc: { overlayId: 316 } },
  } as unknown as ProjectState;
}

describe("Black 2 / White 2 forgettable HMs (PMC)", () => {
  it("finds PML_MoveIsHM by code shape and reads its HM table", () => {
    const match = findBw2MoveIsHm(makeBw2Arm9());
    expect(match).toEqual({ address: W2_MOVE_IS_HM, offset: W2_MOVE_IS_HM - BW2_ARM9_RAM_BASE, state: "original", hmMoves: HM_MOVES });
  });

  it("finds the function at a shifted Black 2 address", () => {
    expect(findBw2MoveIsHm(makeBw2Arm9(W2_MOVE_IS_HM - 0x2c))?.address).toBe(W2_MOVE_IS_HM - 0x2c);
  });

  it("rejects ambiguous, misaligned, or table-less matches", () => {
    const duplicate = makeBw2Arm9();
    duplicate.set(moveIsHmCode(), 0x40000);
    expect(findBw2MoveIsHm(duplicate)).toBeUndefined();

    const misaligned = new Uint8Array(0xa0000);
    misaligned.set(makeBw2Arm9().subarray(0, 0x9fff0), 2);
    expect(findBw2MoveIsHm(misaligned)).toBeUndefined();

    const noTable = makeBw2Arm9();
    noTable.fill(0, TABLE_LITERAL + TABLE_DISPLACEMENT - BW2_ARM9_RAM_BASE, TABLE_LITERAL + TABLE_DISPLACEMENT - BW2_ARM9_RAM_BASE + 12);
    expect(findBw2MoveIsHm(noTable)).toBeUndefined();
  });

  it("recognizes and restores an inline early-return edit", () => {
    const arm9 = makeBw2Arm9();
    arm9.set([0x00, 0x20, 0x70, 0x47], W2_MOVE_IS_HM - BW2_ARM9_RAM_BASE);
    const match = findBw2MoveIsHm(arm9)!;
    expect(match.state).toBe("inline");
    const restored = restoreInlineForgettableHmsEdit(arm9, match);
    expect(findBw2MoveIsHm(restored)?.state).toBe("original");
    expect(arm9[W2_MOVE_IS_HM - BW2_ARM9_RAM_BASE]).toBe(0x00);
  });

  it("generates a DLXF module that replaces PML_MoveIsHM with return false", () => {
    const bytes = buildForgettableHmsDll("W2", W2_MOVE_IS_HM);
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    expect([...rpm.code]).toEqual([0x00, 0x20, 0x70, 0x47]);
    expect(rpm.metadata).toEqual({ PMCGameID: "W2", PMCModulePriority: 4, PMCVersion: "1.0.0" });
    expect(rpm.relocations).toEqual([{ target: { module: "ARM9", address: W2_MOVE_IS_HM | 1, type: "THUMB_BRANCH" }, sourceSymbolIndex: 0 }]);
    expect(rpm.symbols[0]).toMatchObject({ type: "FUNCTION_THM", address: 0, size: 4 });
    expect(readForgettableHmsDll(bytes)).toEqual({ gameId: "W2", moveIsHmAddress: W2_MOVE_IS_HM });
    expect(readForgettableHmsDll(writeRpm({ ...rpm, code: Uint8Array.of(0x70, 0x47, 0, 0) }, { ident: "DLXF" }))).toBeUndefined();
  });

  it("installs the runtime as a staged PMC DLL without editing ARM9", async () => {
    const project = makeBw2Project();
    const arm9Before = project.arm9.slice();
    expect(getForgettableHmsPmcStatus(project)).toBe("unpatched");

    const result = await installForgettableHmsPmc(project);

    expect(result.status).toBe("applied");
    expect(result.summary).toContain("0x2026b44");
    expect(result.path).toBe("patches/ForgettableHmsW2.dll");
    expect(project.arm9).toEqual(arm9Before);
    expect(project.arm9Dirty).toBeFalsy();
    const dll = project.fileSystem?.additions?.["patches/ForgettableHmsW2.dll"];
    expect(dll && readForgettableHmsDll(dll)).toEqual({ gameId: "W2", moveIsHmAddress: W2_MOVE_IS_HM });
    expect(project.patches?.applied?.forgettableHms).toBe(true);
    expect(getForgettableHmsPmcStatus(project)).toBe("patched");
    expect((await installForgettableHmsPmc(project)).status).toBe("already-applied");
  });

  it("migrates an inline ARM9 edit to the PMC runtime", async () => {
    const arm9 = makeBw2Arm9();
    arm9.set([0x00, 0x20, 0x70, 0x47], W2_MOVE_IS_HM - BW2_ARM9_RAM_BASE);
    const project = makeBw2Project(arm9);
    expect(getForgettableHmsPmcStatus(project)).toBe("legacy");

    const result = await installForgettableHmsPmc(project);

    expect(result.summary).toMatch(/Migrated/);
    expect(project.arm9Dirty).toBe(true);
    expect(findBw2MoveIsHm(project.arm9)?.state).toBe("original");
    expect(getForgettableHmsPmcStatus(project)).toBe("patched");
  });

  it("refuses to stack on another DLL that already hooks the HM check", async () => {
    const project = makeBw2Project();
    const other = buildForgettableHmsDll("W2", W2_MOVE_IS_HM);
    project.fileSystem = { additions: { "patches/SomeoneElse.dll": other } } as unknown as ProjectState["fileSystem"];
    expect(findForgettableHmsConflict(project, "W2", W2_MOVE_IS_HM)).toBe("SomeoneElse.dll");
    await expect(installForgettableHmsPmc(project)).rejects.toThrow(/SomeoneElse\.dll already patches/);
    expect(project.fileSystem?.additions?.["patches/ForgettableHmsW2.dll"]).toBeUndefined();
  });

  it("is offered on Code Injection, not the Patches page", () => {
    const project = makeBw2Project();
    expect(detectForgettableHmPatch(project)).toBe("unsupported");
    expect(getForgettableHmsPmcStatus(project)).toBe("unpatched");
  });

  it("reports an unknown layout instead of guessing", async () => {
    const project = makeBw2Project(new Uint8Array(0xa0000));
    expect(getForgettableHmsPmcStatus(project)).toBe("unknown");
    await expect(installForgettableHmsPmc(project)).rejects.toThrow(/PML_MoveIsHM/);
  });
});
