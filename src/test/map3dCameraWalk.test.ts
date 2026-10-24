import { describe, expect, it } from "vitest";
import { cameraWalkStart, cameraWalkStep, cameraWalkTileCenter } from "../ui/map3dCameraWalk";

describe("map-camera walking", () => {
  const cells = [{ matrixX: 1, matrixY: 22 }, { matrixX: 1, matrixY: 23 }];
  it("snaps picked points to tile centers and advances one map tile in each cardinal direction", () => {
    const p = cameraWalkTileCenter({ x: 561.2, y: 144, z: 11399.9 });
    expect(p).toEqual({ x: 568, y: 144, z: 11400 });
    expect(cameraWalkStep(p, "ArrowUp", cells)).toEqual({ x: 568, y: 144, z: 11384, direction: "up" });
    expect(cameraWalkStep(p, "ArrowRight", cells)).toEqual({ x: 584, y: 144, z: 11400, direction: "right" });
    expect(cameraWalkStep(p, "ArrowDown", cells)).toMatchObject({ z: 11416, direction: "down" });
    expect(cameraWalkStep(p, "ArrowLeft", cells)).toMatchObject({ x: 552, direction: "left" });
  });
  it("crosses loaded chunk boundaries, stops at the loaded zone edge, and ignores unrelated keys", () => {
    expect(cameraWalkStep({ x: 520, y: 0, z: 11768 }, "ArrowDown", cells)).toMatchObject({ z: 11784 });
    expect(cameraWalkStep({ x: 520, y: 0, z: 11400 }, "ArrowLeft", cells)).toBeUndefined();
    expect(cameraWalkStep({ x: 520, y: 0, z: 11400 }, "x", cells)).toBeUndefined();
  });
  it("starts on open ground rather than a cliff, blocked tile or water near the chunk center", () => {
    const tiles = Array.from({ length: 16 }, () => ({ tileClass: 1, flags: 0, heightType: 0, slope: 0, height: 0 }));
    tiles[9] = { ...tiles[9], tileClass: 0, flags: 1 };
    tiles[10] = { ...tiles[10], tileClass: 0 };
    tiles[11] = { ...tiles[11], tileClass: 61 };
    tiles[14] = { ...tiles[14], tileClass: 0 };
    const start = cameraWalkStart([{ ...cells[0], worldX: 768, worldZ: 11520,
      permissions: { chunkId: 1, width: 4, height: 4, tiles } }],
    (x, z) => x === 776 && z === 11544 ? 16 : undefined);
    expect(start).toEqual({ x: 776, y: 16, z: 11544 });
  });
  it("centers the fallback and retains the chunk height when no ground can be sampled", () => {
    expect(cameraWalkStart([{ ...cells[0], worldX: 768, worldY: 48, worldZ: 11520 }], () => undefined))
      .toEqual({ x: 776, y: 48, z: 11528 });
    expect(cameraWalkStart([], () => undefined)).toEqual({ x: 8, y: 0, z: 8 });
  });
});
