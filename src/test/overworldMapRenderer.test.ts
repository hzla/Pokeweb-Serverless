import { describe, expect, it } from "vitest";
import {
  getOverworldMapRenderSize,
  getOverworldMapWorldBounds,
  mapWorldBoundsToTilePlacement,
  OVERWORLD_MAP_UNITS_PER_TILE,
} from "../ui/overworldMapRenderer";

describe("overworldMapRenderer", () => {
  it("derives chunk-grid world bounds from loaded 3D map chunks", () => {
    const bounds = getOverworldMapWorldBounds({
      chunkSpan: 512,
      chunks: [
        { matrixX: 2, matrixY: 4 },
        { matrixX: 3, matrixY: 4 },
        { matrixX: 2, matrixY: 5 },
      ],
    } as Parameters<typeof getOverworldMapWorldBounds>[0]);

    expect(bounds).toEqual({
      minX: 1024,
      minZ: 2048,
      maxX: 2048,
      maxZ: 3072,
      width: 1024,
      height: 1024,
    });
  });

  it("maps 3D world bounds into overworld tile-space placement", () => {
    const placement = mapWorldBoundsToTilePlacement(
      { minX: 1536, minZ: 512, maxX: 2048, maxZ: 1024, width: 512, height: 512 },
      { x: 1024, z: 512 },
      OVERWORLD_MAP_UNITS_PER_TILE,
    );

    expect(placement).toEqual({
      x: 32,
      y: 0,
      width: 32,
      height: 32,
    });
  });

  it("caps large top-down renders to browser-friendly dimensions", () => {
    expect(getOverworldMapRenderSize({ width: 4096, height: 2048 }, 2048)).toEqual({
      width: 2048,
      height: 1024,
      pixelScale: 0.5,
    });
  });
});
