import { describe, expect, it } from "vitest";
import { applyRemoveDustCloudGemRewardsToOverlay, applyRemoveDustCloudItemRewardsToOverlay } from "../pokeweb/romPatchModel";

describe("ROM patches", () => {
  it("turns the cave dust-cloud gem branch into an unconditional skip", () => {
    const overlay = new Uint8Array([
      0x64, 0x28, 0x0b, 0xd2,
      0xa0, 0x42,
      0x0d, 0xd2,
      0x08, 0x48,
      0xff, 0xff,
      0x89, 0x20, 0x80, 0x00, 0x08, 0x18, 0x00, 0x04, 0x00, 0x0c, 0x10, 0xbd, 0xe5, 0x20, 0x10, 0xbd,
    ]);

    const result = applyRemoveDustCloudGemRewardsToOverlay(overlay);

    expect(result?.status).toBe("applied");
    expect(result?.offset).toBe(6);
    expect(result?.overlay[7]).toBe(0xe0);
    expect(overlay[7]).toBe(0xd2);
  });

  it("recognizes an already-patched overlay", () => {
    const overlay = new Uint8Array([
      0x64, 0x28, 0x0b, 0xd2,
      0xa0, 0x42,
      0x0d, 0xe0,
      0x08, 0x48,
      0xff, 0xff,
      0x89, 0x20, 0x80, 0x00, 0x08, 0x18, 0x00, 0x04, 0x00, 0x0c, 0x10, 0xbd, 0xe5, 0x20, 0x10, 0xbd,
    ]);

    const result = applyRemoveDustCloudGemRewardsToOverlay(overlay);

    expect(result?.status).toBe("already-applied");
    expect(result?.overlay).toBe(overlay);
  });

  it("refuses overlays without a unique dust-cloud gem signature", () => {
    expect(applyRemoveDustCloudGemRewardsToOverlay(Uint8Array.of(1, 2, 3))).toBeUndefined();
  });

  it("nops the cave dust-cloud item branch so the encounter path always runs", () => {
    const overlay = new Uint8Array([
      0x07, 0x28, 0x0b, 0xd1,
      0xc8, 0x29, 0x00, 0xd2,
      0x12, 0xe0,
      0xff, 0xff,
      0x04, 0x28, 0x07, 0xd1,
      0x19, 0x20, 0x00, 0x01, 0x81, 0x42,
      0x00, 0xd2,
      0x02, 0xe0,
    ]);

    const result = applyRemoveDustCloudItemRewardsToOverlay(overlay);

    expect(result?.status).toBe("applied");
    expect(result?.offset).toBe(22);
    expect(result?.overlay[23]).toBe(0xbf);
    expect(overlay[23]).toBe(0xd2);
  });

  it("recognizes an already-patched dust-cloud item branch", () => {
    const overlay = new Uint8Array([
      0x07, 0x28, 0x0b, 0xd1,
      0xc8, 0x29, 0x00, 0xd2,
      0x12, 0xe0,
      0xff, 0xff,
      0x04, 0x28, 0x07, 0xd1,
      0x19, 0x20, 0x00, 0x01, 0x81, 0x42,
      0x00, 0xbf,
      0x02, 0xe0,
    ]);

    const result = applyRemoveDustCloudItemRewardsToOverlay(overlay);

    expect(result?.status).toBe("already-applied");
    expect(result?.overlay).toBe(overlay);
  });
});
