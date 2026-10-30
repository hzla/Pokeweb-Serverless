import { describe, expect, it } from "vitest";
import { ABILITY_IMPORT_LIBRARY } from "../pokeweb/abilityLibrary";
import { ABILITY_RULE_EFFECTS, ABILITY_RULE_PRESETS, type AbilityRuleSet } from "../pokeweb/abilityRules";
import { ABILITY_PRIMITIVE_DESCRIPTIONS, abilityPrimitiveReference, filterAbilityPrimitiveReference } from "../pokeweb/abilityPrimitiveReference";

describe("ability primitive reference", () => {
  it("covers every adjustable primitive and derives usage from the available templates", () => {
    const rows = abilityPrimitiveReference();
    expect(rows.map(row => row.kind)).toEqual(ABILITY_RULE_EFFECTS.map(effect => effect.kind));
    expect(Object.keys(ABILITY_PRIMITIVE_DESCRIPTIONS).sort()).toEqual(rows.map(row => row.kind).sort());
    for (const template of [...ABILITY_RULE_PRESETS, ...ABILITY_IMPORT_LIBRARY]) {
      for (const effect of template.rule.effects) {
        if (!effect.kind.startsWith("nativeAbility:")) expect(rows.find(row => row.kind === effect.kind)?.templates).toContain(template.label);
      }
    }
    expect(rows.find(row => row.kind === "abilityRecipe:criticalStatus")?.templates).toEqual(["Merciless"]);
    expect(rows.find(row => row.kind === "abilityRecipe:allyPower")?.templates).toEqual(["Battery", "Power Spot", "Steely Spirit"]);
    expect(rows.find(row => row.kind === "abilityRecipe:weatherGuard")?.templates).toEqual([]);
  });

  it("deduplicates saved usage and follows the saved ability name without changing recipes", () => {
    const rule: AbilityRuleSet = { effects: [
      { kind: "abilityRecipe:statAction", value: 1, parameters: { stat: 2 } },
      { kind: "abilityRecipe:statAction", value: -1, parameters: { stat: 5 } },
    ], conditions: { kind: "group", mode: "all", children: [] } };
    const rules = new Map([[165, rule], [166, rule]]), before = structuredClone(rules);
    const names: string[] = []; names[165] = "Harden";
    const row = abilityPrimitiveReference(rules, names).find(row => row.kind === "abilityRecipe:statAction")!;
    expect(row.savedAbilities).toEqual([{ id: 165, name: "Harden" }, { id: 166, name: "Ability 166" }]);
    expect(row.templates).not.toContain("Harden");
    expect(filterAbilityPrimitiveReference([row], "HARDEN 165")).toEqual([row]);
    expect(rules).toEqual(before);
  });

  it("searches descriptions and template names with all query terms", () => {
    const rows = abilityPrimitiveReference();
    expect(filterAbilityPrimitiveReference(rows, "merciless").map(row => row.kind)).toEqual(["abilityRecipe:criticalStatus"]);
    expect(filterAbilityPrimitiveReference(rows, "  sandstorm immunity ").map(row => row.kind)).toEqual(["abilityRecipe:weatherGuard"]);
    expect(filterAbilityPrimitiveReference(rows, "power steely").map(row => row.kind)).toEqual(["abilityRecipe:allyPower"]);
    expect(filterAbilityPrimitiveReference(rows, "nonexistent primitive")).toEqual([]);
    expect(filterAbilityPrimitiveReference(rows, "  ")).toEqual(rows);
  });
});
