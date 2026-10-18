import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { encodeFollowerFrames, followerFramesFromSheet, followerPreview, validateFollowerResource } from "../pokeweb/followingPokemonModel";

describe("supplied Dewott replacement sheet", () => {
  it("imports all eight poses with transparency and the original DS palette", () => {
    const png = PNG.sync.read(readFileSync(new URL("./fixtures/follower-dewott-replacement.png", import.meta.url)));
    expect([png.width, png.height]).toEqual([64, 128]);
    const frames = followerFramesFromSheet({ width: png.width, height: png.height, rgba: new Uint8Array(png.data) });
    const template = new Uint8Array(readFileSync(new URL("../assets/following/template-32-8.btx", import.meta.url)));
    const bytes = encodeFollowerFrames(frames, template);
    expect(validateFollowerResource(bytes, "pokemon-asymmetric").size).toBe(32);
    const colors = new Set<string>();
    for (const [directionIndex, direction] of (["up", "down", "left", "right"] as const).entries()) for (let pose = 0; pose < 2; ++pose) {
      const expected = frames[directionIndex * 2 + pose], actual = followerPreview(bytes, "pokemon-asymmetric", direction, pose * 10);
      for (let at = 0; at < expected.rgba.length; at += 4) {
        expect(actual.rgba[at + 3]).toBe(expected.rgba[at + 3]);
        if (!expected.rgba[at + 3]) continue;
        colors.add(Array.from(expected.rgba.subarray(at, at + 3)).join(","));
        for (let channel = 0; channel < 3; ++channel) expect(Math.abs(actual.rgba[at + channel] - expected.rgba[at + channel])).toBeLessThanOrEqual(7);
      }
    }
    expect(colors.size).toBe(12);
  });
});
