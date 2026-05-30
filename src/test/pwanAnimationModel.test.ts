import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { buildPwanConfig, ensurePwanAnimationState, pwanAssetPath } from "../pokeweb/pwanAnimationModel";
import type { ProjectState, PwanAnimationOverride } from "../pokeweb/projectStore";

describe("pwanAnimationModel", () => {
  it("initializes empty project state", () => {
    const project = { pwanAnimations: undefined } as ProjectState;
    const state = ensurePwanAnimationState(project);

    expect(state.overrides).toEqual([]);
    expect(state.nativeCarrierBackups).toEqual({});
    expect(project.pwanAnimations).toBe(state);
  });

  it("builds deterministic config entries and asset paths", () => {
    const config = buildPwanConfig([makeOverride(498, 3, 5), makeOverride(25, 2, 4)]);

    expect(String.fromCharCode(...config.slice(0, 4))).toBe("PWNC");
    expect(readU16(config, 4)).toBe(1);
    expect(readU16(config, 6)).toBe(2);
    expect(readU16(config, 8)).toBe(5);
    expect(readU32(config, 12)).toBe(16);
    expect(readU16(config, 16)).toBe(498);
    expect(readU16(config, 18)).toBe(0x0003);
    expect(readU16(config, 20)).toBe(0);
    expect(readU16(config, 22)).toBe(0);
    expect(readU16(config, 24)).toBe(25);
    expect(readU16(config, 28)).toBe(1);
    expect(readU16(config, 30)).toBe(1);
    expect(pwanAssetPath(7, "front")).toBe("pokeweb_pwan/007_front.pwan");
    expect(pwanAssetPath(7, "back")).toBe("pokeweb_pwan/007_back.pwan");
  });

  it("rejects config tables that exceed the native runtime asset id range", () => {
    expect(() => buildPwanConfig(Array.from({ length: 128 }, (_value, index) => makeOverride(index + 1, 1, 1)))).toThrow(/127/u);
  });
});

function makeOverride(speciesId: number, frontTimeline: number, backTimeline: number): PwanAnimationOverride {
  const side = (timelineCount: number) => ({
    sourceFileName: "test.gif",
    sourceGifBytes: new Uint8Array(),
    pwanBytes: new Uint8Array(),
    visibleHeight: 1,
    frameCount: 1,
    uniqueFrameCount: 1,
    timelineCount,
    totalTicks: 6,
    paletteBgr555: new Uint16Array(16),
  });
  return {
    speciesId,
    front: side(frontTimeline),
    back: side(backTimeline),
    nativePaletteSource: "back",
    carrierTemplate: "w2u-gen6-placeholder",
    backNcecY: 48,
  };
}
