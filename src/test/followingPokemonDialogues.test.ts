import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { readU16, writeU32 } from "../nds/binary";
import { followerCrc32 } from "../pokeweb/followingPokemonModel";
import { decodeFollowerDialogueNarc, encodeFollowerDialogueNarc, FOLLOWER_DIALOGUE_ANIMATIONS, type FollowerDialogueAnimation } from "../pokeweb/followingPokemonDialogues";
import { followerDialogueAnimationOptions } from "../ui/followingPokemonEditor";

describe("Follower contextual animations", () => {
  it("preserves the text-only ABI and defaults to no animation", () => {
    const rules = [{ zone: 0, text: "Hello {nickname}!" }];
    const archive = encodeFollowerDialogueNarc(rules);
    expect(readU16(new NARC(archive).files[0], 4)).toBe(1);
    expect(decodeFollowerDialogueNarc(archive)).toEqual(rules);
    expect(followerDialogueAnimationOptions()).not.toContain(" selected");
  });
  it("round-trips every motion before, after, or on both sides of dialogue", () => {
    for (const { id } of FOLLOWER_DIALOGUE_ANIMATIONS) {
      for (const timing of [{ beforeAnimation: id }, { afterAnimation: id }, { beforeAnimation: id, afterAnimation: id }]) {
        const rules = [{ zone: 42, species: 151, text: "{player}\n{nickname} likes {location}.", ...timing }];
        const archive = encodeFollowerDialogueNarc(rules);
        expect(readU16(new NARC(archive).files[0], 4)).toBe(2);
        expect(decodeFollowerDialogueNarc(archive)).toEqual(rules);
        expect(followerDialogueAnimationOptions(id)).toContain(`value="${id}" selected`);
      }
    }
  });
  it("rejects invalid IDs and reserved-byte edits even with a repaired checksum", () => {
    for (const id of [0, -1, 13, 1.5, NaN]) {
      expect(() => encodeFollowerDialogueNarc([{ zone: 0, text: "X", beforeAnimation: id as FollowerDialogueAnimation }])).toThrow(/animation/);
    }
    for (const [at, value] of [[27, 13], [34, 13], [35, 1], [4, 1]]) {
      const narc = new NARC(encodeFollowerDialogueNarc([{ zone: 0, text: "X", beforeAnimation: 2, afterAnimation: 3 }]));
      narc.files[0][at] = value;
      writeU32(narc.files[0], 12, followerCrc32(narc.files[0].subarray(16)));
      expect(() => decodeFollowerDialogueNarc(narc.save())).toThrow();
    }
  });
  it("adds no bytes to a rule or reduces the dialogue capacity", () => {
    expect(encodeFollowerDialogueNarc([{ zone: 0, text: "X", beforeAnimation: 2, afterAnimation: 12 }]).length)
      .toBe(encodeFollowerDialogueNarc([{ zone: 0, text: "X" }]).length);
    expect(FOLLOWER_DIALOGUE_ANIMATIONS).toHaveLength(12);
  });
});
