import { describe, expect, it } from "vitest";
import { clampU16, formatHex16, GEN5_PERMISSION_FLAGS, gen5PermissionColorHex } from "../pokeweb/gen5PermissionModel";

describe("gen5PermissionModel", () => {
  it("exposes the Gen 5 permission flag labels used by map editors", () => {
    expect(GEN5_PERMISSION_FLAGS.map((flag) => [flag.bit, flag.label])).toEqual([
      [0x0001, "Blocked"],
      [0x0002, "Water"],
      [0x0004, "Encounter"],
      [0x0008, "Footmarks"],
      [0x0010, "Splash"],
      [0x0020, "Grass"],
      [0x0040, "Reflection"],
      [0x0080, "Shadow"],
      [0x0100, "Unknown 0100"],
      [0x0200, "Unknown 0200"],
      [0x0400, "Unknown 0400"],
      [0x0800, "Unknown 0800"],
      [0x1000, "Unknown 1000"],
      [0x2000, "Unknown 2000"],
      [0x4000, "Unknown 4000"],
      [0x8000, "Geometry split"],
    ]);
  });

  it("matches the shared permission colors for common tile semantics", () => {
    expect(gen5PermissionColorHex({ tileClass: 1, flags: 0 })).toBe("#ff4d4f");
    expect(gen5PermissionColorHex({ tileClass: 0, flags: 0x0002 })).toBe("#3da5ff");
    expect(gen5PermissionColorHex({ tileClass: 0, flags: 0x0020 })).toBe("#42d66b");
    expect(gen5PermissionColorHex({ tileClass: 0, flags: 0 })).toBe("#7bd88f");
    expect(gen5PermissionColorHex({ tileClass: 999, flags: 0x4000 })).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it("formats and clamps 16-bit values", () => {
    expect(clampU16(-5)).toBe(0);
    expect(clampU16(0x10004)).toBe(0xffff);
    expect(formatHex16(0x123)).toBe("0x0123");
    expect(formatHex16(0x10004)).toBe("0x0004");
  });
});
