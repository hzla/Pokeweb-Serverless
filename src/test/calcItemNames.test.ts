import { describe, expect, it } from "vitest";
import catalog from "../assets/data/calc_item_names.json";
import { calcItemId, createCalcItemNameResolver, createCalcItemValidator, resolveCalcItemName } from "../pokeweb/calcItemNames";

describe("calculator item names", () => {
  it("keeps every copied canonical spelling intact", () => {
    expect(catalog.names.length).toBeGreaterThan(600);
    expect(new Set(catalog.names).size).toBe(catalog.names.length);
    for (const name of catalog.names) {
      expect(resolveCalcItemName(name)).toBe(name);
      expect(resolveCalcItemName(calcItemId(name))).toBe(name);
    }
  });

  it.each([
    ["Tera K Rock", "Tera K-Rock"],
    ["Tera K-Rock", "Tera K-Rock"],
    ["  TERA_k–ROCK ", "Tera K-Rock"],
    ["terakrock", "Tera K-Rock"],
    ["Tera W Policy", "Tera W-Policy"],
    ["Tera B Policy", "Tera B-Policy"],
    ["clrs booster", "CLRS Booster"],
    ["BlackGlasses", "Black Glasses"],
    ["BrightPowder", "Bright Powder"],
    ["NeverMeltIce", "Never-Melt Ice"],
    ["SilverPowder", "Silver Powder"],
    ["TwistedSpoon", "Twisted Spoon"],
    ["King’s Rock", "King's Rock"],
  ])("maps %s to %s", (input, expected) => {
    expect(resolveCalcItemName(input)).toBe(expected);
  });

  it("reports unresolved names without guessing, dropping, or duplicating them", () => {
    const { resolve, report } = createCalcItemValidator();
    expect(resolve("Tera K Rock")).toBe("Tera K-Rock");
    resolve("Tera K Rock");
    expect(resolve("Tera K-Roc")).toBe("Tera K-Roc");
    resolve("Tera K-Roc");
    expect(resolve("New Hack Item")).toBe("New Hack Item");
    for (const empty of [undefined, "", "None", "NO ITEM", 0]) resolve(empty);
    expect(report).toEqual({
      normalized: [{ from: "Tera K Rock", to: "Tera K-Rock" }],
      unmatched: ["Tera K-Roc", "New Hack Item"],
    });
  });

  it("prefers exact matches but refuses ambiguous normalized matches", () => {
    const resolve = createCalcItemNameResolver(["A-B", "A B", "A-B"]);
    expect(resolve("A-B")).toBe("A-B");
    expect(resolve("A B")).toBe("A B");
    expect(resolve("ab")).toBeUndefined();
  });
});
