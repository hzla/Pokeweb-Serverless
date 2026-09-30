import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import type { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "../pokeweb/projectStore";
import { repairLegacyBw1PmcBootCalls } from "../pokeweb/pmcModel";

function fixture(version: "B" | "W" = "B") {
  const arm9 = new Uint8Array(0x2000);
  arm9.set([
    0x00, 0xb5, 0x71, 0xf0, version === "B" ? 0x4d : 0x59, 0xee,
    0x00, 0x20, 0x02, 0x49, 0x75, 0xf0, version === "B" ? 0x25 : 0x31, 0xe9,
    0x15, 0xf2, 0x37, 0xfb, 0x00, 0xbd, 0xed, 0, 0, 0,
  ], 0xc);
  const delta = 0x0200400c - (0x0200512a + 4);
  writeU16(arm9, 0x112a, 0xf000 | ((delta >> 12) & 0x7ff));
  writeU16(arm9, 0x112c, 0xf800 | ((delta >> 1) & 0x7ff));
  const table = new Uint8Array(32);
  [237, 0x02217d20, 0x3000, 0, 0, 0, 0, 0].forEach((value, i) => writeU32(table, i * 4, value));
  const overlay = new Uint8Array(0x3000);
  overlay.set([0x52, 0x50, 0x4d, 0x30]);
  const rom = {
    idCode: version === "B" ? "IRBO" : "IRAO",
    arm9RamAddress: 0x02004000, arm9OverlayTable: table, files: [overlay],
  } as unknown as NintendoDSRom;
  const project = { session: { baseRom: "BW" }, arm9, overlays: {}, narcs: {} } as unknown as ProjectState;
  return { project, rom };
}

describe("legacy BW1 startup call repair", () => {
  it.each(["B", "W"] as const)("repairs both %s calls without changing their targets or other code", version => {
    const { project, rom } = fixture(version);
    const before = project.arm9.slice();
    expect(repairLegacyBw1PmcBootCalls(project, rom)).toBe(true);
    const changes = [...project.arm9.keys()].filter(i => before[i] !== project.arm9[i]);
    expect(changes).toEqual([0x10, 0x18]);
    expect(project.arm9[0x10]).toBe(before[0x10] + 1);
    expect(project.arm9[0x18]).toBe(before[0x18] + 1);
    expect(project.arm9Dirty).toBe(true);
    expect(repairLegacyBw1PmcBootCalls(project, rom)).toBe(false);
  });
  it("repairs a partially corrected pair", () => {
    const { project, rom } = fixture();
    project.arm9[0x10]++;
    expect(repairLegacyBw1PmcBootCalls(project, rom)).toBe(true);
    expect(project.arm9[0x18]).toBe(0x26);
  });
  it.each(["inactive", "different-call", "different-overlay", "no-rpm", "wrong-game"] as const)("preserves unrecognized code: %s", change => {
    const { project, rom } = fixture();
    if (change === "inactive") project.arm9[0x112a] = 0;
    if (change === "different-call") project.arm9[0x18] = 0x27;
    if (change === "different-overlay") project.arm9[0x20] = 236;
    if (change === "no-rpm") rom.files[0][0] = 0;
    if (change === "wrong-game") rom.idCode = "IRDO";
    const before = project.arm9.slice();
    expect(repairLegacyBw1PmcBootCalls(project, rom)).toBe(false);
    expect(project.arm9).toEqual(before);
    expect(project.arm9Dirty).toBeUndefined();
  });
});
