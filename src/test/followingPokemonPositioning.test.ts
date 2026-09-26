import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { followerCrc32, encodeFollowerRegistry, decodeFollowerRegistry } from "../pokeweb/followingPokemonModel";
import { decodeFollowerPositioningNarc, encodeFollowerPositioningNarc } from "../pokeweb/followingPokemonPositioning";

function fixture() {
  const registry = {
    runtimeAbi: 1, descriptorCount: 1009, resourceCount: 975, zones: [],
    entries: [{
      key: { species: 1, form: 0, gender: 0 as const, shiny: false }, descriptorRow: 1008,
      resourceId: 400, size: 32 as const, animationProfile: "pokemon-mirrored" as const,
      offsets: [0, 0, 0] as [number, number, number], sideGap: 3, placeholder: false, source: "stock" as const,
      directionalGaps: [1, 2, 3, 4] as [number, number, number, number],
      riderAdjustments: [[-1, 1], [2, -2], [3, -3], [4, -4]] as [[number, number], [number, number], [number, number], [number, number]],
    }],
  };
  const encoded = encodeFollowerRegistry(registry);
  const anchors = new Uint8Array(24);
  writeU32(anchors, 0, 0x4d4c5746); writeU16(anchors, 4, 1); writeU16(anchors, 6, 1);
  writeU32(anchors, 8, followerCrc32(encoded)); anchors.set([10, 11, 12, 13, 14, 15, 16, 17], 16);
  const surf = new Uint8Array(24);
  writeU32(surf, 0, 0x4d535746); writeU16(surf, 4, 2); writeU16(surf, 6, 8); writeU16(surf, 8, 1);
  writeU16(surf, 16, 1);
  return { registry, encoded, anchors, surf };
}

describe("ROM-resident follower positioning", () => {
  it("encodes walking gaps without any riding catalog or offsets", () => {
    const { registry, encoded, surf } = fixture();
    const bytes = encodeFollowerPositioningNarc(registry, encoded);
    const decoded = decodeFollowerPositioningNarc(bytes, encoded);
    expect(Array.from(decoded.land)).toEqual([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decoded.surf).toHaveLength(0);
    expect(() => decodeFollowerPositioningNarc(bytes, encoded, surf)).toThrow(/match/);
  });
  it("uses one directly indexed NARC member and preserves all four direction values", () => {
    const { registry, encoded, anchors, surf } = fixture();
    const bytes = encodeFollowerPositioningNarc(registry, encoded, anchors, surf, {
      "1:0:0:0": [[-5, 5], [-6, 6], [-7, 7], [-8, 8]],
    });
    expect(readU32(bytes, 32)).toBe(44); // member length, read by native FS adapter
    expect(readU32(bytes, 60)).toBe(0x4f505746);
    const decoded = decodeFollowerPositioningNarc(bytes, encoded, surf);
    expect(Array.from(decoded.land)).toEqual([1, 2, 3, 4, 9, 12, 14, 11, 17, 12, 20, 13]);
    expect(Array.from(decoded.surf)).toEqual([251, 5, 250, 6, 249, 7, 248, 8]);
  });
  it("adds six side units to automatic gaps without changing authored gaps", () => {
    const { registry, encoded, anchors, surf } = fixture();
    delete (registry.entries[0] as { directionalGaps?: number[] }).directionalGaps;
    let decoded = decodeFollowerPositioningNarc(encodeFollowerPositioningNarc(registry, encoded, anchors, surf), encoded, surf);
    expect(Array.from(decoded.land.subarray(0, 4))).toEqual([0, 0, 9, 9]);
    registry.entries[0].sideGap = 6;
    decoded = decodeFollowerPositioningNarc(encodeFollowerPositioningNarc(registry, encoded, anchors, surf), encoded, surf);
    expect(Array.from(decoded.land.subarray(0, 4))).toEqual([0, 0, 12, 12]);
  });
  it("rejects corrupt payloads, mismatched catalogs, and invalid authored offsets", () => {
    const { registry, encoded, anchors, surf } = fixture();
    const bytes = encodeFollowerPositioningNarc(registry, encoded, anchors, surf);
    const bad = bytes.slice(); bad[84] ^= 1;
    expect(() => decodeFollowerPositioningNarc(bad, encoded, surf)).toThrow(/match/);
    expect(() => decodeFollowerPositioningNarc(bytes, encoded, new Uint8Array(24))).toThrow(/match/);
    expect(() => encodeFollowerPositioningNarc(registry, encoded, anchors, surf, {
      "999:0:0:0": [[0, 0], [0, 0], [0, 0], [0, 0]],
    })).toThrow(/Unknown Surf/);
    const invalid = decodeFollowerRegistry(encoded);
    invalid.entries[0].directionalGaps = [0, 0, 0, 13];
    expect(() => encodeFollowerPositioningNarc(invalid, encoded, anchors, surf)).toThrow(/directional gap/);
  });
});
