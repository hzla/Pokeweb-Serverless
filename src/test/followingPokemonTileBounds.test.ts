import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { followerCrc32 } from "../pokeweb/followingPokemonModel";
import { decodeFollowerDialogueNarc, encodeFollowerDialogueNarc } from "../pokeweb/followingPokemonDialogues";
import { decodeFollowerItemNarc, encodeFollowerItemNarc } from "../pokeweb/followingPokemonItems";
import { FOLLOWER_TILE_BOUND_KEYS, type FollowerTileBounds } from "../pokeweb/followingPokemonTileBounds";
import { followerTileBoundsFields } from "../ui/followingPokemonEditor";

const dialogue = { zone: 42, species: 151, hp: 1, text: "Hello {player}!", beforeAnimation: 2 as const, afterAnimation: 12 as const };
const gift = { zone: 42, species: 151, hp: 1, slot: 4, quantity: 2, itemId: 50, itemName: "Rare Candy", text: "{nickname} found a {item}!" };
const formats = [
  { name: "dialogue", base: dialogue, encode: (rules: (typeof dialogue & FollowerTileBounds)[]) => encodeFollowerDialogueNarc(rules), decode: decodeFollowerDialogueNarc, abi: 3, legacy: 2, maskAt: 35, boundsAt: 36 },
  { name: "gifts", base: gift, encode: (rules: (typeof gift & FollowerTileBounds)[]) => encodeFollowerItemNarc(rules), decode: decodeFollowerItemNarc, abi: 2, legacy: 1, maskAt: 42, boundsAt: 44 },
];
for (const format of formats) describe(`${format.name} tile bounds`, () => {
  it("retains legacy output when all bounds are absent", () => {
    const bytes = format.encode([format.base] as never);
    expect(readU16(new NARC(bytes).files[0], 4)).toBe(format.legacy);
    expect(format.decode(bytes)).toEqual([format.base]);
    expect(format.encode([{ ...format.base, minX: undefined, maxX: undefined }] as never)).toEqual(bytes);
  });
  it("round-trips every presence mask, zero, signed limits and mixed bounded/unbounded rows", () => {
    for (let mask = 1; mask < 16; ++mask) {
      const bounds = Object.fromEntries(FOLLOWER_TILE_BOUND_KEYS.flatMap((key, i) => mask & (1 << i) ? [[key, [-32768, 0, 0, 32767][i]]] : []));
      const rules = [{ ...format.base, ...bounds }, format.base];
      const bytes = format.encode(rules as never);
      expect(readU16(new NARC(bytes).files[0], 4)).toBe(format.abi);
      expect(format.decode(bytes)).toEqual(rules);
    }
    const point = [{ ...format.base, minX: 0, maxX: 0, minY: -4, maxY: -4 }];
    expect(format.decode(format.encode(point as never))).toEqual(point);
  });
  it("enforces the shared 4 KiB budget for the larger bounded rows", () => {
    const rule = { ...format.base, minX: 0, text: "X", ...(format.name === "gifts" ? { itemName: "X" } : {}) };
    const count = format.name === "gifts" ? 91 : 125;
    const rules = Array.from({ length: count }, () => rule);
    expect(format.decode(format.encode(rules as never))).toEqual(rules);
    expect(() => format.encode([...rules, rule] as never)).toThrow(/4 KiB/);
  });
  it("rejects inverted, fractional, non-finite and overflowing coordinates", () => {
    for (const bounds of [{ minX: 1, maxX: 0 }, { minY: 1, maxY: 0 }, ...[-32769, 32768, 1.5, NaN, Infinity].map(minX => ({ minX }))])
      expect(() => format.encode([{ ...format.base, ...bounds }] as never)).toThrow(/tile coordinate|must not exceed/);
  });
  it("rejects bad masks, unused coordinates and reversed bounds after checksum repair", () => {
    for (const edit of [(data: Uint8Array) => { data[format.maskAt] = 16; }, (data: Uint8Array) => { data[format.maskAt] = 0; }, (data: Uint8Array) => { writeU16(data, format.boundsAt + 2, 0); }]) {
      const narc = new NARC(format.encode([{ ...format.base, minX: 1, maxX: 2 }] as never));
      edit(narc.files[0]); writeU32(narc.files[0], 12, followerCrc32(narc.files[0].subarray(16)));
      expect(() => format.decode(narc.save())).toThrow();
    }
  });
});
it("shows all four optional fields for both editors with zero preserved and unsupported profiles disabled", () => {
  for (const prefix of ["d", "i"] as const) {
    const html = followerTileBoundsFields({ minX: 0, maxY: -1 }, prefix, true, true);
    for (const key of FOLLOWER_TILE_BOUND_KEYS) expect(html).toContain(`data-${prefix}-${key}`);
    expect(html).toContain('value="0"'); expect(html).toContain('value=""');
    expect(html).toContain("Inclusive edges"); expect(html).toContain("Update the installed");
    expect(followerTileBoundsFields({}, prefix, false).match(/ disabled/gu)).toHaveLength(4);
  }
});
