import { describe, expect, it } from "vitest";
import { buildVirtualSpriteAssetFromGif, encodeVirtualSpriteAsset } from "../pokeweb/virtualSpriteAsset";

describe("virtualSpriteAsset", () => {
  it("compacts a GIF into PWGF frames and timeline", () => {
    const gif = Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64");
    const asset = buildVirtualSpriteAssetFromGif(gif);
    const encoded = encodeVirtualSpriteAsset(asset);

    expect(asset.width).toBe(96);
    expect(asset.height).toBe(96);
    expect(asset.report.sourceWidth).toBe(1);
    expect(asset.report.sourceHeight).toBe(1);
    expect(asset.report.sourceFrameCount).toBe(1);
    expect(asset.report.uniqueFrameCount).toBe(1);
    expect(asset.report.timelineEntryCount).toBe(1);
    expect(asset.totalTicks).toBe(6);
    expect(asset.report.crop).toEqual({ x: -47, y: -47, width: 96, height: 96 });
    expect(Array.from(encoded.slice(0, 4)).map((value) => String.fromCharCode(value)).join("")).toBe("PWGF");
    expect(encoded.length).toBe(20 + 4 + 96 * 96 * 4);
  });
});

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";
