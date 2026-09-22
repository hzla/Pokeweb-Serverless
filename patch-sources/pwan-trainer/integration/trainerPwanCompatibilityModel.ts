import { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "./projectStore";

export type TrainerPwanCompatibilityCheck = {
  id: string;
  label: string;
  address: number;
  status: "matched" | "changed" | "missing" | "unsupported";
  expectedHex: string;
  actualHex?: string;
  message: string;
};

export type TrainerPwanCompatibilityReport = {
  compatible: boolean;
  supportedBase: boolean;
  passed: number;
  checks: TrainerPwanCompatibilityCheck[];
};

const signatures = {
  W2: [
    ["manager-delete", "Trainer manager teardown", 0x021e68d2, "f2db686833f6edf8281c53f6ccfc38bd"],
    ["manager-main", "Trainer manager update", 0x021e6928, "e5db606833f6f2f85120000104902058"],
    ["trainer-add", "Trainer MCSS creation", 0x021e6e64, "029a039b33f634fd29198860281c391c"],
    ["trainer-delete", "Trainer MCSS deletion", 0x021e6eaa, "6868315933f6fdfd002737512819006b"],
  ],
  B2: [
    ["manager-delete", "Trainer manager teardown", 0x021e6892, "f2db686833f6f7f8281c53f6d6fc38bd"],
    ["manager-main", "Trainer manager update", 0x021e68e8, "e5db606833f6fcf85120000104902058"],
    ["trainer-add", "Trainer MCSS creation", 0x021e6e24, "029a039b33f63efd29198860281c391c"],
    ["trainer-delete", "Trainer MCSS deletion", 0x021e6e6a, "6868315933f607fe002737512819006b"],
  ],
} as const;

export function detectTrainerPwanCompatibility(project: ProjectState): TrainerPwanCompatibilityReport {
  const version = project.session.baseVersion;
  const supportedVersion: "W2" | "B2" | undefined = version === "W2" || version === "B2" ? version : undefined;
  const expectedId = supportedVersion === "W2" ? "IRDO" : supportedVersion === "B2" ? "IREO" : undefined;
  if (!expectedId || (project.romInfo.idCode && project.romInfo.idCode !== expectedId)) {
    const check: TrainerPwanCompatibilityCheck = { id: "base-rom", label: "Base ROM", address: 0, expectedHex: "", status: "unsupported", message: "Trainer PWAN supports stock US Black 2 and White 2 only." };
    return { compatible: false, supportedBase: false, passed: 0, checks: [check] };
  }
  let source: { data: Uint8Array; ramAddress: number } | undefined;
  if (project.originalRomBytes) {
    try { source = new NintendoDSRom(project.originalRomBytes).loadArm9Overlays([168]).get(168); } catch { source = undefined; }
  }
  const overlay = project.overlays[168];
  if (overlay && source) source = { data: overlay, ramAddress: source.ramAddress };
  const checks = signatures[supportedVersion!].map(([id, label, address, expectedHex]): TrainerPwanCompatibilityCheck => {
    if (!source) return { id, label, address, expectedHex, status: "missing", message: "Overlay 168 is not available for compatibility checking." };
    const offset = address - source.ramAddress;
    if (offset < 0 || offset + expectedHex.length / 2 > source.data.length) return { id, label, address, expectedHex, status: "missing", message: `Overlay 168 does not cover 0x${address.toString(16)}.` };
    const actualHex = [...source.data.subarray(offset, offset + expectedHex.length / 2)].map((value) => value.toString(16).padStart(2, "0")).join("");
    return actualHex === expectedHex
      ? { id, label, address, expectedHex, actualHex, status: "matched", message: `${label} matches the stock ${version} layout.` }
      : { id, label, address, expectedHex, actualHex, status: "changed", message: `${label} differs from the stock ${version} layout.` };
  });
  const passed = checks.filter((check) => check.status === "matched").length;
  return { compatible: checks.length > 0 && passed === checks.length, supportedBase: true, passed, checks };
}

export function trainerPwanCompatibilityFailureSummary(report: TrainerPwanCompatibilityReport): string {
  const failed = report.checks.filter((check) => check.status !== "matched");
  return failed.length ? `Trainer PWAN is not compatible with this ROM code layout (${failed.map((check) => check.label).join("; ")}).` : "Trainer PWAN hook compatibility check passed.";
}
