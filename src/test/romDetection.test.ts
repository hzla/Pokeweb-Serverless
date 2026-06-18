import { describe, expect, it } from "vitest";
import { detectVersionInfo } from "../pokeweb/constants";

describe("ROM version detection", () => {
  it("uses the ARM9 fingerprint when it is recognized", () => {
    expect(detectVersionInfo(63038, "IREO")).toEqual({ baseVersion: "W2", baseRom: "BW2" });
  });

  it("falls back to the ROM id code when a hack changes the ARM9 fingerprint", () => {
    expect(detectVersionInfo(0xf001, "IREO")).toEqual({ baseVersion: "B2", baseRom: "BW2" });
  });

  it("keeps the legacy W2 fallback when neither signal is recognized", () => {
    expect(detectVersionInfo(0xf001, "TEST")).toEqual({ baseVersion: "W2", baseRom: "BW2" });
  });
});
