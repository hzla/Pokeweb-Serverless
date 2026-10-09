import { describe, expect, it } from "vitest";
import { frostReaderOverflowWarning } from "../pokeweb/frostCompatibility";

describe("Frost's capped ROM tail", () => {
  it("identifies the reported snew layout without requiring a changed DSi header", () => {
    const length = 0x132ec400, table = 0x12c46800;
    expect(Math.min(length, 0x12000000) - table).toBe(-12871680);
    const warning = frostReaderOverflowWarning(length, table);
    expect(warning?.code).toBe("frost-reader-overflow");
    expect(warning?.message).toContain("Arithmetic operation resulted in an overflow");
    expect(warning?.message).toContain("retains its DSi data");
  });

  it.each([0, 0x11000000, 0x11ffffff, 0x12000000, 0x14000000])("does not warn at a nonnegative or absent tail offset %i", (table) => {
    expect(frostReaderOverflowWarning(0x132ec400, table)).toBeUndefined();
  });

  it("checks the table location rather than treating every large ROM as incompatible", () => {
    expect(frostReaderOverflowWarning(0x20000000, 0x11000000)).toBeUndefined();
    expect(frostReaderOverflowWarning(0x20000000, 0x12000001)?.code).toBe("frost-reader-overflow");
    expect(frostReaderOverflowWarning(0x12000000, 0x12000001)).toBeUndefined();
  });
});
