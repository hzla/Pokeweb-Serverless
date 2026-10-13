import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { applyGeneralPatchSections, parseGeneralPatch } from "../pokeweb/generalPatchModel";
import {
  detectPwanRuntimeCompatibility,
  pwanCompatibilityFailureSummary,
  PWAN_B2_COMPATIBILITY_SIGNATURES,
  PWAN_COMPATIBILITY_SIGNATURES,
} from "../pokeweb/pwanCompatibilityModel";
import type { ProjectState } from "../pokeweb/projectStore";

const W2_ARM9_BASE_ADDRESS = 0x02004000;

describe("pwanCompatibilityModel", () => {
  it.each(["B2", "W2"] as const)("checks the staged overlay address after Fairy expands %s overlay 167", async version => {
    const signatures = version === "B2" ? PWAN_B2_COMPATIBILITY_SIGNATURES : PWAN_COMPATIBILITY_SIGNATURES;
    const sections = parseGeneralPatch(new Uint8Array(readFileSync(new URL(`../assets/patches/fairy-${version.toLowerCase()}.bin`, import.meta.url))));
    const overlayPatch = sections.find(section => section.name === "ov_167")!;
    const originalBase = readU32(overlayPatch.payload, 8);
    const originalSize = readU32(overlayPatch.payload, 12);
    const project = makeMatchingRomProject(version, originalBase, originalSize);
    const originalBytes = project.originalRomBytes!.slice();
    expect(detectPwanRuntimeCompatibility(project).compatible).toBe(true);

    // Apply the shipped Fairy code for overlay 167 without needing retail ROM data.
    const y9 = sections.find(section => section.name === "y9")!.payload;
    const stagedTablePatch = new Uint8Array(40);
    for (let offset = 8; offset + 32 <= y9.length; offset += 32) {
      if (readU32(y9, offset) === 167) stagedTablePatch.set(y9.subarray(offset, offset + 32), 8);
    }
    await applyGeneralPatchSections(project, [{ name: "y9", payload: stagedTablePatch }, overlayPatch]);

    expect(readU32(project.patches!.arm9OverlayTable!, 167 * 32 + 4)).toBe(readU32(overlayPatch.payload, 0));
    expect(readU32(overlayPatch.payload, 0)).toBeLessThan(originalBase);
    expect(project.originalRomBytes).toEqual(originalBytes);
    expect(detectPwanRuntimeCompatibility(project)).toMatchObject({ compatible: true, passed: signatures.length, failed: 0, missing: 0 });

    // Relocation must not hide a real hook conflict at the new byte offset.
    const hook = signatures.find(signature => signature.overlayId === 167)!;
    project.overlays[167]![hook.windowStart - readU32(overlayPatch.payload, 0)] ^= 0xff;
    const changed = detectPwanRuntimeCompatibility(project);
    expect(changed.compatible).toBe(false);
    expect(changed.checks.find(check => check.id === hook.id)?.status).toBe("changed");
  });

  it("reports a missing hook when its overlay is removed from the staged table", () => {
    const project = makeMatchingRomProject("W2", 0x02199900, 0x41740);
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const table = rom.arm9OverlayTable.slice();
    writeU32(table, 167 * 32, 999);
    project.patches = { dirtyOverlayIds: [], applied: {}, arm9OverlayTable: table };

    const report = detectPwanRuntimeCompatibility(project);
    expect(report.compatible).toBe(false);
    expect(report.checks.find(check => check.id === "battle-summary-cache-hook")?.status).toBe("missing");
  });

  it.each(["B2", "W2"] as const)("rejects an unknown %s mode getter", version => {
    const signatures = version === "B2" ? PWAN_B2_COMPATIBILITY_SIGNATURES : PWAN_COMPATIBILITY_SIGNATURES;
    const project = makeProject({ baseVersion: version, idCode: version === "B2" ? "IREO" : "IRDO", arm9: makeMatchingArm9Bytes(signatures) });
    const mode = signatures.find(signature => signature.id === "arm9-dsi-mode")!;
    expect(detectPwanRuntimeCompatibility(project).checks.find(check => check.id === mode.id)?.status).toBe("matched");
    project.arm9[mode.windowStart - W2_ARM9_BASE_ADDRESS] ^= 0xff;
    expect(detectPwanRuntimeCompatibility(project).checks.find(check => check.id === mode.id)?.status).toBe("changed");
  });
  it("selects the full Black 2 split-runtime signature profile", () => {
    const report = detectPwanRuntimeCompatibility(makeProject({ baseVersion: "B2", idCode: "IRBO" }));

    expect(report.supportedBase).toBe(true);
    expect(report.compatible).toBe(false);
    expect(report.checks).toHaveLength(PWAN_B2_COMPATIBILITY_SIGNATURES.length);
    expect([...new Set(report.checks.map((check) => check.group))]).toEqual(
      expect.arrayContaining(["Battle", "Summary", "Evolution", "Egg Hatch", "Nonbattle MCSS"]),
    );
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

  it("detects changed ARM9 hook bytes against the stock Black 2 snapshot", () => {
    const project = makeProject({ baseVersion: "B2", idCode: "IREO", arm9: makeMatchingArm9Bytes(PWAN_B2_COMPATIBILITY_SIGNATURES) });
    const changedSignature = PWAN_B2_COMPATIBILITY_SIGNATURES.find((signature) => signature.id === "arm9-battle-free");
    expect(changedSignature).toBeDefined();
    project.arm9[changedSignature!.windowStart - W2_ARM9_BASE_ADDRESS] ^= 0xff;

    const report = detectPwanRuntimeCompatibility(project);
    expect(report.checks.find((entry) => entry.id === "arm9-battle-free")).toMatchObject({ status: "changed" });
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

function makeMatchingArm9Bytes(signatures = PWAN_COMPATIBILITY_SIGNATURES): Uint8Array {
  const arm9Signatures = signatures.filter((signature) => signature.module === "arm9");
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

function makeMatchingRomProject(version: "B2" | "W2", overlay167Base: number, overlay167Size: number): ProjectState {
  const signatures = version === "B2" ? PWAN_B2_COMPATIBILITY_SIGNATURES : PWAN_COMPATIBILITY_SIGNATURES;
  const project = makeProject({ baseVersion: version, idCode: version === "B2" ? "IREO" : "IRDO", arm9: makeMatchingArm9Bytes(signatures) });
  const overlayIds = [...new Set(signatures.flatMap(signature => signature.overlayId === undefined ? [] : [signature.overlayId]))];
  const table = new Uint8Array((Math.max(...overlayIds) + 1) * 32);
  for (let row = 0; row * 32 < table.length; row++) writeU32(table, row * 32, row);
  const files = overlayIds.map((id, fileId) => {
    const hooks = signatures.filter(signature => signature.overlayId === id);
    const base = id === 167 ? overlay167Base : Math.min(...hooks.map(hook => hook.windowStart));
    const size = id === 167 ? overlay167Size : Math.max(...hooks.map(hook => hook.windowStart - base + hook.expectedHex.length / 2));
    const bytes = new Uint8Array(size);
    for (const hook of hooks) bytes.set(hexToBytes(hook.expectedHex), hook.windowStart - base);
    writeU32(table, id * 32 + 4, base);
    writeU32(table, id * 32 + 8, size);
    writeU32(table, id * 32 + 24, fileId);
    return bytes;
  });
  const tableOffset = 0x200;
  const fatOffset = tableOffset + table.length;
  let cursor = fatOffset + files.length * 8;
  const rom = new Uint8Array(cursor + files.reduce((sum, file) => sum + file.length, 0));
  rom.set(new TextEncoder().encode(project.romInfo.idCode), 12);
  writeU32(rom, 0x28, W2_ARM9_BASE_ADDRESS);
  writeU32(rom, 0x50, tableOffset);
  writeU32(rom, 0x54, table.length);
  writeU32(rom, 0x48, fatOffset);
  writeU32(rom, 0x4c, files.length * 8);
  rom.set(table, tableOffset);
  files.forEach((file, fileId) => {
    writeU32(rom, fatOffset + fileId * 8, cursor);
    rom.set(file, cursor);
    cursor += file.length;
    writeU32(rom, fatOffset + fileId * 8 + 4, cursor);
  });
  project.originalRomBytes = rom;
  return project;
}
