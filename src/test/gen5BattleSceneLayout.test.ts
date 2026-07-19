import { describe, expect, it } from "vitest";
import {
  GEN5_DEFAULT_CAMERA_POSITION,
  GEN5_DEFAULT_CAMERA_TARGET,
  GEN5_EFFECT_PARTICLE_DEPTH_OFFSET,
  GEN5_PLATFORM_SCALE,
  GEN5_SINGLE_TARGET_CAMERA_POSITION,
  GEN5_SINGLE_TARGET_CAMERA_TARGET,
  GEN5_SINGLE_TARGET_POKEMON_SCALE,
  GEN5_SINGLE_TARGET_POKEMON_POSITION,
  GEN5_SINGLE_USER_POKEMON_POSITION,
  GEN5_SINGLE_USER_POKEMON_SCALE,
  GEN5_TARGET_PLATFORM_POSITION,
  GEN5_USER_PLATFORM_POSITION,
} from "../pokeweb/gen5BattleSceneLayout";

describe("gen5BattleSceneLayout", () => {
  it("ports the Swan single-battle platform and Pokemon placement tables", () => {
    expect(GEN5_USER_PLATFORM_POSITION).toEqual([0, 0, 5.449]);
    expect(GEN5_TARGET_PLATFORM_POSITION).toEqual([0, 0, -12.718]);
    expect(GEN5_PLATFORM_SCALE).toBe(1);
    expect(GEN5_SINGLE_USER_POKEMON_POSITION).toEqual([0.5, 0x666 / 0x1000, 7]);
    expect(GEN5_SINGLE_TARGET_POKEMON_POSITION).toEqual([0x4cd / 0x1000, 0x666 / 0x1000, -10]);
    expect(GEN5_SINGLE_USER_POKEMON_SCALE).toBe(0x1030 / 0x1000);
    expect(GEN5_SINGLE_TARGET_POKEMON_SCALE).toBe(0x11bf / 0x1000);
    expect(GEN5_EFFECT_PARTICLE_DEPTH_OFFSET).toBe(5 / 16);
  });

  it("keeps the default and defender cameras on the same Swan view vector", () => {
    const defaultVector = GEN5_DEFAULT_CAMERA_POSITION.map((value, index) => value - GEN5_DEFAULT_CAMERA_TARGET[index]);
    const targetVector = GEN5_SINGLE_TARGET_CAMERA_POSITION.map((value, index) => value - GEN5_SINGLE_TARGET_CAMERA_TARGET[index]);
    expect(targetVector[0]).toBeCloseTo(defaultVector[0], 3);
    expect(targetVector[1]).toBeCloseTo(defaultVector[1], 3);
    expect(targetVector[2]).toBeCloseTo(defaultVector[2], 3);
  });
});
