import { describe, expect, it } from "vitest";
import {
  detectPwanRuntimeCompatibility,
  pwanCompatibilityFailureSummary,
  PWAN_COMPATIBILITY_SIGNATURES,
} from "../pokeweb/pwanCompatibilityModel";
import type { ProjectState } from "../pokeweb/projectStore";

const W2_ARM9_BASE_ADDRESS = 0x02004000;

describe("pwanCompatibilityModel", () => {
  it("rejects non-White 2 projects before checking hook windows", () => {
    const report = detectPwanRuntimeCompatibility(makeProject({ baseVersion: "B2", idCode: "IRBO" }));

    expect(report.supportedBase).toBe(false);
    expect(report.compatible).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ status: "unsupported", group: "ROM" });
  });

  it("reports missing hook regions when persisted ROM bytes are unavailable", () => {
    const report = detectPwanRuntimeCompatibility(makeProject());

    expect(report.supportedBase).toBe(true);
    expect(report.compatible).toBe(false);
    expect(report.missing).toBeGreaterThan(0);
    expect(pwanCompatibilityFailureSummary(report)).toContain("PWAN runtime is not compatible");
  });

  it("detects changed ARM9 hook bytes against the stock White 2 snapshot", () => {
    const project = makeProject({ arm9: makeMatchingArm9Bytes() });
    const changedSignature = PWAN_COMPATIBILITY_SIGNATURES.find((signature) => signature.id === "arm9-mcss-draw");
    expect(changedSignature).toBeDefined();
    project.arm9[changedSignature!.windowStart - W2_ARM9_BASE_ADDRESS] ^= 0xff;

    const report = detectPwanRuntimeCompatibility(project);
    const check = report.checks.find((entry) => entry.id === "arm9-mcss-draw");

    expect(check).toMatchObject({ status: "changed" });
    expect(check?.message).toContain("ARM9 bytes differ");
  });
});

function makeProject(options: { baseVersion?: "B2" | "W2"; idCode?: string; arm9?: Uint8Array } = {}): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: options.baseVersion ?? "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: options.idCode ?? "IRDO", fileName: "test.nds", size: 0 },
    arm9: options.arm9 ?? new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeMatchingArm9Bytes(): Uint8Array {
  const arm9Signatures = PWAN_COMPATIBILITY_SIGNATURES.filter((signature) => signature.module === "arm9");
  const length = Math.max(...arm9Signatures.map((signature) => signature.windowStart - W2_ARM9_BASE_ADDRESS + signature.expectedHex.length / 2));
  const out = new Uint8Array(length);
  for (const signature of arm9Signatures) {
    out.set(hexToBytes(signature.expectedHex), signature.windowStart - W2_ARM9_BASE_ADDRESS);
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}
