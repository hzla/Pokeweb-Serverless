import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import manifest from "../assets/data/calcAbilityManifest.json";
import { abilityImport, ABILITY_IMPORT_LIBRARY } from "../pokeweb/abilityLibrary";
import { calcAbilityCatalogEntries, calcAbilityTemplateId, serializeCalcAbilityCatalog } from "../pokeweb/calcAbilityCatalog";

describe("calculator ability catalog", () => {
  it("matches the checked-in capability and covers every import", () => {
    expect(createHash("sha256").update(serializeCalcAbilityCatalog()).digest("hex")).toBe(manifest.fingerprint);
    expect(calcAbilityCatalogEntries().map(([id]) => id)).toEqual(ABILITY_IMPORT_LIBRARY.map(entry => entry.id).sort((a, b) => a - b));
    for (const entry of ABILITY_IMPORT_LIBRARY) {
      expect(calcAbilityTemplateId(entry.rule, entry.defaultName)).toBe(entry.id);
    }
  });

  it("compacts a rename and explicit defaults, and keeps actual edits in full", () => {
    const {rule} = abilityImport(174);
    expect(calcAbilityTemplateId(rule, "Frost Touch")).toBe(174);
    rule.effects[0].parameters!.sourceType = 0;
    expect(calcAbilityTemplateId(rule, "Frost Touch")).toBe(174);
    rule.effects[0].value = 3;
    expect(calcAbilityTemplateId(rule, "Refrigerate")).toBeUndefined();
  });

  it("preserves different flags and local activation conditions", () => {
    const {rule} = abilityImport(205);
    rule.effects[0].parameters!.moveClass = 268;
    expect(calcAbilityTemplateId(rule, "Triage")).toBeUndefined();
    const conditional = abilityImport(174).rule;
    conditional.effects[0].conditions = {kind: "weather", value: 3};
    expect(calcAbilityTemplateId(conditional, "Refrigerate")).toBeUndefined();
  });
});
