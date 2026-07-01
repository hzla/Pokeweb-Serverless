import { describe, expect, it } from "vitest";
import { summarizeMoveAnimationCommandLine } from "../pokeweb/moveAnimationCommandSummary";

describe("moveAnimationCommandSummary", () => {
  it("summarizes long projectile commands using semantic units", () => {
    expect(summarizeMoveAnimationCommandLine("EmitProjectile", "EmitProjectile 293, 1, EMITTER_CURVE, SIDE_ATTACKER, SIDE_DEFENDER, 2px, 122880, 4px, 1x, 1x, 0")).toBe(
      "Emits projectile using SPA ID 293, resource 1, via a curve from attacker side to defender side, lasting 30 frames, adjusted up by +2 units, arc height +4 units, at 1x life, at 1x speed, 0 wave.",
    );
  });

  it("summarizes coordinate projectile variants", () => {
    expect(
      summarizeMoveAnimationCommandLine(
        "EmitProjectileFromCoordinates",
        "EmitProjectileFromCoordinates 0, 1, EMITTER_STRAIGHT, -8px, 2px, 0.5px, SIDE_DEFENDER, 3px, 10f, 4px, 1x, 0.5x, 0",
      ),
    ).toBe(
      "Emits projectile using SPA ID 0, resource 1, in a straight line from coordinates x -8 units, y +2 units, z +0.5 units, to defender side, lasting 10 frames, adjusted up by +3 units, arc height +4 units, at 1x life, at 0.5x speed, 0 wave.",
    );
  });

  it("does not summarize short or unsupported commands", () => {
    expect(summarizeMoveAnimationCommandLine("Wait", "Wait 6")).toBeUndefined();
  });
});
