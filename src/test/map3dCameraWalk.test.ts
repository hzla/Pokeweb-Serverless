import { describe, expect, it } from "vitest";
import { cameraWalkStep, cameraWalkTileCenter } from "../ui/map3dCameraWalk";

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
});
