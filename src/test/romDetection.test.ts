import { describe, expect, it } from "vitest";
import { detectVersionInfo } from "../pokeweb/constants";

describe("ROM version detection", () => {
  it("uses the ARM9 fingerprint when it is recognized", () => {
    expect(detectVersionInfo(63038, "IREO")).toEqual({ generation: "gen5", baseVersion: "W2", baseRom: "BW2" });
  });

  it("falls back to the ROM id code when a hack changes the ARM9 fingerprint", () => {
    expect(detectVersionInfo(0xf001, "IREO")).toEqual({ generation: "gen5", baseVersion: "B2", baseRom: "BW2" });
  });

  it("detects Gen 4 ROM id prefixes", () => {
    expect(detectVersionInfo(0xf001, "ADAO")).toEqual({ generation: "gen4", baseVersion: "D", baseRom: "DP" });
    expect(detectVersionInfo(0xf001, "APAO")).toEqual({ generation: "gen4", baseVersion: "P", baseRom: "DP" });
    expect(detectVersionInfo(0xf001, "CPUE")).toEqual({ generation: "gen4", baseVersion: "Pt", baseRom: "Pt" });
    expect(detectVersionInfo(0xf001, "IPKE")).toEqual({ generation: "gen4", baseVersion: "HG", baseRom: "HGSS" });
    expect(detectVersionInfo(0xf001, "IPGE")).toEqual({ generation: "gen4", baseVersion: "SS", baseRom: "HGSS" });
  });

  it("detects known Platinum hack id codes", () => {
    expect(detectVersionInfo(36498, "JAK7")).toEqual({ generation: "gen4", baseVersion: "Pt", baseRom: "Pt" });
  });

  it("keeps the legacy W2 fallback when neither signal is recognized", () => {
    expect(detectVersionInfo(0xf001, "TEST")).toEqual({ generation: "gen5", baseVersion: "W2", baseRom: "BW2" });
  });
});
