import { describe, expect, it } from "vitest";
import { decodeFollowerItemNarc, encodeFollowerItemNarc, validateFollowerItemRules } from "../pokeweb/followingPokemonItems";

describe("one-time follower gifts", () => {
  const rule = { slot: 4, itemId: 50, quantity: 2, itemName: "Rare Candy", text: "{nickname} found a {item}!", zone: 321, species: 25, form: 0, type: 12, hp: 2, friendship: 3, status: 5, facing: 1 };
  it("round-trips an ordered, stable-slot archive", () => expect(decodeFollowerItemNarc(encodeFollowerItemNarc([rule]))).toEqual([rule]));
  it("accepts an explicit empty default and rejects malformed values", () => {
    expect(decodeFollowerItemNarc(encodeFollowerItemNarc([]))).toEqual([]);
    expect(() => validateFollowerItemRules([{ ...rule, slot: 10 }])).toThrow(/slot/);
    expect(() => validateFollowerItemRules([{ ...rule, quantity: 100 }])).toThrow(/quantity/);
    const corrupt = encodeFollowerItemNarc([rule]); corrupt[25] ^= 1; expect(() => decodeFollowerItemNarc(corrupt)).toThrow();
  });
  it("allows as many ordered rules as fit while reusing the ten per-Pokemon claim slots", () => {
    const rules = Array.from({ length: 111 }, (_, index) => ({ ...rule, slot: index % 10, zone: index, itemId: index + 1, itemName: "X", text: "Y" }));
    expect(decodeFollowerItemNarc(encodeFollowerItemNarc(rules))).toEqual(rules);
    expect(() => encodeFollowerItemNarc([...rules, { ...rule, itemName: "X", text: "Y" }])).toThrow(/4 KiB/);
  });
});
