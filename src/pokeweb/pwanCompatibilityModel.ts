import { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "./projectStore";

type PwanCompatibilityModule = "arm9" | "overlay";

export type PwanCompatibilityStatus = "matched" | "changed" | "missing" | "unsupported";

export type PwanCompatibilitySignature = {
  id: string;
  label: string;
  group: string;
  module: PwanCompatibilityModule;
  overlayId?: number;
  address: number;
  windowStart: number;
  expectedHex: string;
};

export type PwanCompatibilityCheck = PwanCompatibilitySignature & {
  status: PwanCompatibilityStatus;
  actualHex?: string;
  message: string;
};

export type PwanCompatibilityReport = {
  compatible: boolean;
  supportedBase: boolean;
  passed: number;
  failed: number;
  missing: number;
  checks: PwanCompatibilityCheck[];
};

const DEFAULT_W2_ARM9_BASE_ADDRESS = 0x02004000;

export const PWAN_COMPATIBILITY_SIGNATURES: PwanCompatibilitySignature[] = [
  { id: "summary-update-hook", label: "Summary update hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b337e, windowStart: 0x021b337a, expectedHex: "6ef675fb98f61ffaa06f66f6c6fb96f69cfb96f6c6fba06f" },
  { id: "summary-draw-hook", label: "Summary draw hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b3396, windowStart: 0x021b3392, expectedHex: "66f651fc96f699fb3148251c0168226ae07e8a1a1206120e" },
  { id: "summary-term-hook", label: "Summary teardown hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b31aa, windowStart: 0x021b31a6, expectedHex: "c173281c00f0a5fe281c00f00eff281c00f071fd291c9431" },
  { id: "battle-update-hook", label: "Battle update hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df2c0, windowStart: 0x021df2bc, expectedHex: "183008580af010fb6af6fefb6af628fc201c29680c300858" },
  { id: "battle-draw-hook", label: "Battle draw hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df2f8, windowStart: 0x021df2f4, expectedHex: "45fb20886af6e8fb38bdc04680421f020406000478b581b0" },
  { id: "battle-term-hook", label: "Battle teardown hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df248, windowStart: 0x021df244, expectedHex: "19f828685bf616f82e6070bd80421f0238b52a4d28680028" },
  { id: "battle-summary-cache-hook", label: "Battle summary cache hook", group: "Battle", module: "overlay", overlayId: 167, address: 0x021b2416, windowStart: 0x021b2412, expectedHex: "281c211cfff71fff38bd017042707047000038b5041c2068" },
  { id: "nonbattle-build-params-hook", label: "Nonbattle MCSS build params hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8efa, windowStart: 0x021a8ef6, expectedHex: "201c3a1c73f6b9f803a80090281c00210022002371f6e3fc" },
  { id: "nonbattle-add-hook", label: "Nonbattle MCSS add hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8f0a, windowStart: 0x021a8f06, expectedHex: "0022002371f6e3fc041c012171f6f1ff201c71f6f8fe201c" },
  { id: "nonbattle-draw-hook", label: "Nonbattle MCSS draw hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8664, windowStart: 0x021a8660, expectedHex: "002801d071f6e8fa08bd00000148024b08581847ac060000" },
  { id: "nonbattle-del-hook", label: "Nonbattle MCSS delete hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8f48, windowStart: 0x021a8f44, expectedHex: "281c211c71f6b0fd38bd000030b583b0041c71f661ffe4f6" },
  { id: "evolution-add-loop-hook", label: "Evolution MCSS add loop hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5364, windowStart: 0x021e5360, expectedHex: "0022002336f608ff2065206d012135f6c3fd206d36f6a2ff" },
  { id: "evolution-add-single-hook", label: "Evolution MCSS add single hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e53ae, windowStart: 0x021e53aa, expectedHex: "6968002336f6e3fe6865012135f69ffd686d36f67eff686d" },
  { id: "evolution-main-mcss-hook", label: "Evolution MCSS main hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51b0, windowStart: 0x021e51ac, expectedHex: "02d0e06c34f6b0fc201c00f0f3fa04b0f8bdc046ff7f0000" },
  { id: "evolution-main-independent-hook", label: "Evolution independent main hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51b6, windowStart: 0x021e51b2, expectedHex: "b0fc201c00f0f3fa04b0f8bdc046ff7f000000f8ffff08b5" },
  { id: "evolution-draw-mcss-hook", label: "Evolution MCSS draw hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51d2, windowStart: 0x021e51ce, expectedHex: "03d0c06c34f631fd08bd00f012fb08bd00000121c1617047" },
  { id: "evolution-draw-independent-hook", label: "Evolution independent draw hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51d8, windowStart: 0x021e51d4, expectedHex: "31fd08bd00f012fb08bd00000121c16170470000006a7047" },
  { id: "evolution-del-hook", label: "Evolution delete hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e53f0, windowStart: 0x021e53ec, expectedHex: "e86c316d35f65cfb601c0006040e022cefd370bd002801d1" },
  { id: "evolution-after-graphic-end-hook", label: "Evolution graphic-end hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e3dae, windowStart: 0x021e3daa, expectedHex: "0efa606800f003ff002009b0f0bd1d0100001f010000f144" },
  { id: "egg-frame-tail-hook", label: "Egg hatch frame-tail hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021de040, windowStart: 0x021de03c, expectedHex: "1bff606800f07afc0020f8bd1801000080d91d0210b50c1c" },
  { id: "egg-add-poke-mcss-hook", label: "Egg hatch add Pokemon MCSS hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021def54, windowStart: 0x021def50, expectedHex: "696800243df610f9012168633bf6ccff6868ab2100223df6" },
  { id: "egg-draw-hook", label: "Egg hatch draw hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021dee7a, windowStart: 0x021dee76, expectedHex: "041c206b3af6ddfe201c00f078fa606c00f055fa10bd0121" },
  { id: "egg-after-obj-main-hook", label: "Egg hatch ObjMain hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021dee86, windowStart: 0x021dee82, expectedHex: "78fa606c00f055fa10bd01210161704700004069704738b5" },
  { id: "egg-del-hook", label: "Egg hatch delete hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021df10a, windowStart: 0x021df106, expectedHex: "206b616b3bf6cffc10bd406b014b1847c046a9ad010270b5" },
  { id: "nonbattle-pp-build-hook", label: "Nonbattle PP build hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a156, windowStart: 0x0219a152, expectedHex: "0858311c81f657ff00960b21a869084a0904002380f6b5fb" },
  { id: "nonbattle-pp-add-hook", label: "Nonbattle PP add hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a166, windowStart: 0x0219a162, expectedHex: "0904002380f6b5fbe861211c80f621fde86980f6cafd0db0" },
  { id: "nonbattle-pp-draw-hook", label: "Nonbattle PP draw hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x02199efc, windowStart: 0x02199ef8, expectedHex: "0dfea0697ff69cfeaff6e4fd10bd000010b5041caff6dafd" },
  { id: "nonbattle-pp-del-hook", label: "Nonbattle PP delete hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a194, windowStart: 0x0219a190, expectedHex: "04d0a06980f68afc0020e06110bd000030b583b0041ce069" },
  { id: "arm9-mcss-draw", label: "ARM9 MCSS draw function", group: "ARM9 vanilla calls", module: "arm9", address: 0x02019c38, windowStart: 0x02019c38, expectedHex: "f0b5edb00b904df0c3ffd74a00201060111f08601190906003200860119846ac" },
  { id: "arm9-mcss-del", label: "ARM9 MCSS delete function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201aaac, windowStart: 0x0201aaac, expectedHex: "38b50c1c051c201c00f0f8ff2068002803d001f029f8002020606068002803d0" },
  { id: "arm9-mcss-hide", label: "ARM9 MCSS vanish setter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201ada8, windowStart: 0x0201ada8, expectedHex: "052292010221835889021943815070470522920183580249194081507047c046" },
  { id: "arm9-mcss-shadow-hide", label: "ARM9 MCSS shadow vanish setter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201aef8, windowStart: 0x0201aef8, expectedHex: "18b405239b01c458034ac9072240090a1143c15018bc7047ffff7fff05218901" },
  { id: "arm9-add-poke-mcss", label: "ARM9 add Pokemon MCSS function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201c178, windowStart: 0x0201c178, expectedHex: "f8b58ab00c1c051c161c201c002100221f1c00f0cbfd011c281c00f00ff8201c" },
  { id: "arm9-pp-get", label: "ARM9 Pokemon param getter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201cd24, windowStart: 0x0201cd24, expectedHex: "70b5051c0c1c161c01f050f8281c211c321c01f09df8041c281c01f075f8201c" },
  { id: "arm9-buffer-swap", label: "ARM9 render buffer swap", group: "ARM9 vanilla calls", module: "arm9", address: 0x02049acc, windowStart: 0x02049acc, expectedHex: "08b51ef07bf80348012100689430016008bdc046641914020b490a68002a11d0" },
];

export function detectPwanRuntimeCompatibility(project: ProjectState): PwanCompatibilityReport {
  const supportedBase = project.session.baseVersion === "W2";
  if (!supportedBase) {
    const check: PwanCompatibilityCheck = {
      id: "base-rom",
      label: "Base ROM",
      group: "ROM",
      module: "arm9",
      address: 0,
      windowStart: 0,
      expectedHex: "",
      status: "unsupported",
      message: "PWAN runtime currently supports White 2 code layouts only.",
    };
    return { compatible: false, supportedBase: false, passed: 0, failed: 1, missing: 0, checks: [check] };
  }

  const rom = parseOriginalRom(project);
  const overlayIds = [...new Set(PWAN_COMPATIBILITY_SIGNATURES.map((signature) => signature.overlayId).filter((id): id is number => id !== undefined))];
  const originalOverlays = loadOriginalOverlays(rom, overlayIds);
  const arm9BaseAddress = rom?.arm9RamAddress ?? DEFAULT_W2_ARM9_BASE_ADDRESS;
  const checks = PWAN_COMPATIBILITY_SIGNATURES.map((signature) => checkSignature(project, signature, originalOverlays, arm9BaseAddress));
  const passed = checks.filter((check) => check.status === "matched").length;
  const missing = checks.filter((check) => check.status === "missing").length;
  const failed = checks.length - passed - missing;
  return {
    compatible: checks.every((check) => check.status === "matched"),
    supportedBase: true,
    passed,
    failed,
    missing,
    checks,
  };
}

export function pwanCompatibilityFailureSummary(report: PwanCompatibilityReport, max = 4): string {
  const failures = report.checks.filter((check) => check.status !== "matched");
  if (failures.length === 0) return "PWAN hook compatibility check passed.";
  const listed = failures.slice(0, max).map((check) => `${check.group}: ${check.label}`).join("; ");
  const remaining = failures.length > max ? `; ${failures.length - max} more` : "";
  return `PWAN runtime is not compatible with this ROM code layout (${listed}${remaining}).`;
}

function checkSignature(
  project: ProjectState,
  signature: PwanCompatibilitySignature,
  originalOverlays: Map<number, { data: Uint8Array; ramAddress: number }>,
  arm9BaseAddress: number,
): PwanCompatibilityCheck {
  const source = signature.module === "arm9"
    ? { data: project.arm9, ramAddress: arm9BaseAddress, label: "ARM9" }
    : overlaySource(project, originalOverlays, signature.overlayId);
  if (!source) {
    return {
      ...signature,
      status: "missing",
      message: `${moduleLabel(signature)} could not be loaded for compatibility checking.`,
    };
  }
  const length = signature.expectedHex.length / 2;
  const offset = signature.windowStart - source.ramAddress;
  if (offset < 0 || offset + length > source.data.length) {
    return {
      ...signature,
      status: "missing",
      message: `${source.label} does not cover ${hexAddress(signature.windowStart)}.`,
    };
  }
  const actualHex = bytesToHex(source.data.subarray(offset, offset + length));
  if (actualHex !== signature.expectedHex) {
    return {
      ...signature,
      status: "changed",
      actualHex,
      message: `${source.label} bytes differ from stock White 2 at ${hexAddress(signature.windowStart)}.`,
    };
  }
  return {
    ...signature,
    status: "matched",
    actualHex,
    message: `${source.label} matches stock White 2 at ${hexAddress(signature.windowStart)}.`,
  };
}

function parseOriginalRom(project: ProjectState): NintendoDSRom | undefined {
  if (!project.originalRomBytes) return undefined;
  try {
    return new NintendoDSRom(project.originalRomBytes);
  } catch {
    return undefined;
  }
}

function loadOriginalOverlays(rom: NintendoDSRom | undefined, overlayIds: number[]): Map<number, { data: Uint8Array; ramAddress: number }> {
  if (!rom) return new Map();
  try {
    return rom.loadArm9Overlays(overlayIds);
  } catch {
    return new Map();
  }
}

function overlaySource(
  project: ProjectState,
  originalOverlays: Map<number, { data: Uint8Array; ramAddress: number }>,
  overlayId: number | undefined,
): { data: Uint8Array; ramAddress: number; label: string } | undefined {
  if (overlayId === undefined) return undefined;
  const original = originalOverlays.get(overlayId);
  const data = project.overlays[overlayId] ?? original?.data;
  if (!data || !original) return undefined;
  return { data, ramAddress: original.ramAddress, label: `Overlay ${overlayId}` };
}

function moduleLabel(signature: PwanCompatibilitySignature): string {
  return signature.module === "arm9" ? "ARM9" : `Overlay ${signature.overlayId}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexAddress(address: number): string {
  return `0x${address.toString(16).padStart(8, "0")}`;
}
