import { describe, expect, it } from "vitest";
import {
  gen5BattleSpriteIdleFrame,
  resolveGen5BattleSpriteTargets,
  simulateGen5BattleSprites,
} from "../pokeweb/gen5BattleSpriteSimulator";
import type { MoveAnimationTimelineEvent } from "../pokeweb/moveAnimationPreviewModel";

describe("gen5BattleSpriteSimulator", () => {
  it("resolves only the occupied single-battle positions", () => {
    expect(resolveGen5BattleSpriteTargets(0)).toEqual(["user"]);
    expect(resolveGen5BattleSpriteTargets(1)).toEqual(["target"]);
    expect(resolveGen5BattleSpriteTargets(14)).toEqual(["user"]);
    expect(resolveGen5BattleSpriteTargets(16)).toEqual(["target"]);
    expect(resolveGen5BattleSpriteTargets(18)).toEqual(["user", "target"]);
    expect(resolveGen5BattleSpriteTargets(19)).toEqual(["user"]);
    expect(resolveGen5BattleSpriteTargets(20)).toEqual(["target"]);
    expect(resolveGen5BattleSpriteTargets(15)).toEqual([]);
    expect(resolveGen5BattleSpriteTargets(17)).toEqual([]);
    expect(resolveGen5BattleSpriteTargets(2)).toEqual([]);
  });

  it("interpolates relative movement and mirrors target-side X", () => {
    const timeline = [
      event("ShakeSprite", [14, 1, 4096, 8192, 2, 0, 0]),
      event("ShakeSprite", [16, 1, 4096, 0, 2, 0, 0]),
    ];

    const start = simulateGen5BattleSprites(timeline, 0);
    const halfway = simulateGen5BattleSprites(timeline, 1);
    const end = simulateGen5BattleSprites(timeline, 2);
    expect(start.user.positionOffset).toEqual([0, 0, 0]);
    expect(halfway.user.positionOffset).toEqual([0.5, 1, 0]);
    expect(halfway.target.positionOffset).toEqual([-0.5, 0, 0]);
    expect(end.user.positionOffset).toEqual([1, 2, 0]);
    expect(end.target.positionOffset).toEqual([-1, 0, 0]);
  });

  it("mirrors MCSS movement according to the physical side after swapping roles", () => {
    const timeline = [
      event("ShakeSprite", [14, 1, 4096, 0, 2, 0, 0]),
      event("ShakeSprite", [16, 1, 4096, 0, 2, 0, 0]),
    ];

    const halfway = simulateGen5BattleSprites(timeline, 1, true);
    expect(halfway.user.positionOffset).toEqual([-0.5, 0, 0]);
    expect(halfway.target.positionOffset).toEqual([0.5, 0, 0]);
  });

  it("implements roundtrip and roundtrip-long legs with exact idle frames", () => {
    const roundtrip = [event("ShakeSprite", [14, 2, 4096, 0, 2, 0, 1])];
    expect(simulateGen5BattleSprites(roundtrip, 2).user.positionOffset[0]).toBe(1);
    expect(simulateGen5BattleSprites(roundtrip, 3).user.positionOffset[0]).toBe(0.5);
    expect(simulateGen5BattleSprites(roundtrip, 4).user.positionOffset[0]).toBe(0);
    expect(gen5BattleSpriteIdleFrame(roundtrip, 0)).toBe(4);

    const long = [event("ShakeSprite", [14, 3, 4096, 0, 2, 0, 1])];
    expect(simulateGen5BattleSprites(long, 6).user.positionOffset[0]).toBe(-1);
    expect(simulateGen5BattleSprites(long, 8).user.positionOffset[0]).toBe(0);
    expect(gen5BattleSpriteIdleFrame(long, 0)).toBe(8);
  });

  it("runs scale, rotation, and opacity on independent channels", () => {
    const quarterTurn = 0x4000 * 4096;
    const timeline = [
      event("DistortSprite", [14, 1, 8192, 2048, 2, 0, 0]),
      event("TiltSprite", [14, 1, quarterTurn, 2, 0, 0]),
      event("SpriteOpacity", [14, 1, 16, 2, 0, 0]),
    ];

    const halfway = simulateGen5BattleSprites(timeline, 1).user;
    expect(halfway.scale[0]).toBeCloseTo(1.5);
    expect(halfway.scale[1]).toBeCloseTo(0.75);
    expect(halfway.rotation).toBeCloseTo(-Math.PI / 4);
    expect(halfway.opacity).toBeCloseTo(23 / 31);

    const end = simulateGen5BattleSprites(timeline, 2).user;
    expect(end.scale).toEqual([2, 0.5]);
    expect(end.rotation).toBeCloseTo(-Math.PI / 2);
    expect(end.opacity).toBeCloseTo(16 / 31);
  });

  it("keeps circle and sine movement in the MCSS effect-position channel", () => {
    const circle = [event("MoveSprite", [14, 4, 2, 4096, 4096, 4 * 4096, 0, 1 * 4096, 0])];
    const firstCircleStep = simulateGen5BattleSprites(circle, 1).user;
    expect(firstCircleStep.effectPositionOffset[0]).toBeCloseTo(-1);
    expect(firstCircleStep.effectPositionOffset[1]).toBeCloseTo(1);
    expect(gen5BattleSpriteIdleFrame(circle, 0)).toBe(4);
    expect(simulateGen5BattleSprites(circle, 4).user.effectPositionOffset).toEqual([0, 0, 0]);

    const sine = [event("PokemonSineMove", [14, 1, 0, 0x4000 * 4096, 4096, 4])];
    expect(simulateGen5BattleSprites(sine, 2).user.effectPositionOffset[1]).toBeGreaterThan(0.6);
    expect(simulateGen5BattleSprites(sine, 4).user.effectPositionOffset).toEqual([0, 0, 0]);
    expect(gen5BattleSpriteIdleFrame(sine, 0)).toBe(4);
  });

  it("keeps the shadow grounded while following horizontal sprite motion", () => {
    const timeline = [event("ShakeSprite", [14, 1, 4096, 8192, 2, 0, 0])];
    const halfway = simulateGen5BattleSprites(timeline, 1).user;
    expect(halfway.positionOffset).toEqual([0.5, 1, 0]);
    expect(halfway.shadow.positionOffset).toEqual([0.5, 0, -1]);
  });

  it("tracks palette, mosaic, visibility, shadow, and deletion state", () => {
    const timeline = [
      event("ChangeColor", [14, 0, 2, 0, 31, 0, 0]),
      event("PokemonMosaic", [14, 0, 3, 0, 0, 0]),
      event("PokemonShadowVanish", [14, 1]),
      event("ChangeVisibility", [16, 3]),
      event("ChangeVisibility", [16, 4], 2),
      event("DeletePokemon", [14], 4),
      event("ChangeVisibility", [14, 1], 5),
    ];

    const frame1 = simulateGen5BattleSprites(timeline, 1);
    expect(frame1.user.palette.evy).toBe(0);
    expect(frame1.user.mosaic).toBe(3);
    expect(frame1.user.shadow.visible).toBe(false);
    expect(frame1.target.visible).toBe(false);

    const frame3 = simulateGen5BattleSprites(timeline, 3);
    expect(frame3.user.palette).toEqual({ evy: 2, color: [31, 0, 0] });
    expect(frame3.target.visible).toBe(true);

    const frame5 = simulateGen5BattleSprites(timeline, 5);
    expect(frame5.user.exists).toBe(false);
    expect(frame5.user.visible).toBe(false);
  });

  it("cancels only the replaced property task", () => {
    const timeline = [
      event("DistortSprite", [14, 1, 12288, 12288, 10, 0, 0]),
      event("SpriteOpacity", [14, 1, 16, 6, 0, 0]),
      event("DistortSprite", [14, 0, 2048, 2048, 0, 0, 0], 2),
    ];

    expect(simulateGen5BattleSprites(timeline, 2).user.scale[0]).toBeCloseTo(1.4);
    const frame3 = simulateGen5BattleSprites(timeline, 3).user;
    expect(frame3.scale).toEqual([0.5, 0.5]);
    expect(frame3.opacity).toBeLessThan(1);
    expect(gen5BattleSpriteIdleFrame(timeline, 2)).toBe(6);
  });

  it("keeps blink visually static while retaining its wait duration", () => {
    const timeline = [event("PokemonBlinkFlag", [14, 2, 2, 1])];
    expect(simulateGen5BattleSprites(timeline, 2).user.visible).toBe(true);
    expect(gen5BattleSpriteIdleFrame(timeline, 0)).toBe(4);
  });
});

function event(command: string, params: number[], frame = 0): MoveAnimationTimelineEvent {
  return {
    id: `${frame}:${command}:${params.join("_")}`,
    frame,
    label: "SCRIPT_TEST",
    command,
    params,
    status: "supported",
    message: command,
  };
}
