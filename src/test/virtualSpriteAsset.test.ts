import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVirtualSpriteAssetFromGif, encodeVirtualSpriteAsset } from "../pokeweb/virtualSpriteAsset";

describe("virtualSpriteAsset", () => {
  it("compacts the Tepig test GIF into PWGF frames and timeline", () => {
    const gif = readFileSync(resolve("../testgif.gif"));
    const asset = buildVirtualSpriteAssetFromGif(gif);
    const encoded = encodeVirtualSpriteAsset(asset);

    expect(asset.width).toBe(96);
    expect(asset.height).toBe(96);
    expect(asset.report.sourceFrameCount).toBe(95);
    expect(asset.report.uniqueFrameCount).toBe(48);
    expect(asset.report.timelineEntryCount).toBe(95);
    expect(asset.totalTicks).toBe(570);
    expect(asset.report.crop).toEqual({ x: -1, y: 7, width: 96, height: 96 });
    expect(Array.from(encoded.slice(0, 4)).map((value) => String.fromCharCode(value)).join("")).toBe("PWGF");
    expect(encoded.length).toBe(20 + 95 * 4 + 48 * 96 * 96 * 4);
  });
});
