import { describe, expect, it } from "vitest";
import { MOVE_PRIMITIVES, MOVE_CONDITION_CODES } from "../pokeweb/moveRules";
import { MOVE_RECIPE_LIBRARY } from "../pokeweb/moveRecipeLibrary";
import { MOVE_CONDITION_REFERENCE, filterMovePrimitiveReference, movePrimitiveReference } from "../pokeweb/movePrimitiveReference";

describe("move primitive reference", () => {
  it("covers the effect and condition catalog and derives template usage", () => {
    const rows = movePrimitiveReference();
    expect(rows.filter(row => row.category === "Effect" && !row.kind.startsWith("nativeBase:")).map(row => row.kind)).toEqual(MOVE_PRIMITIVES.map(effect => effect.kind));
    expect(Object.keys(MOVE_CONDITION_REFERENCE).sort()).toEqual(Object.keys(MOVE_CONDITION_CODES).sort());
    for (const template of MOVE_RECIPE_LIBRARY) {
      for (const effect of template.rule.effects) expect(rows.find(row => row.category === "Effect" && row.kind === effect.kind)?.templates).toContain(template.label);
    }
    expect(rows.find(row => row.kind === "nativeBase:280")?.templates).toContain("Psychic Fangs");
    expect(rows.find(row => row.kind === "nativeBase:364")?.templates).toContain("Hyperspace Hole");
    expect(rows.find(row => row.kind === "ateBerry")?.templates).toContain("Belch");
    expect(rows.find(row => row.kind === "adjacent")?.templates).toContain("Dragon Cheer");
  });

  it("searches across primitive descriptions, categories and template names", () => {
    const rows = movePrimitiveReference();
    expect(filterMovePrimitiveReference(rows, "dragon cheer").some(row => row.kind === "criticalStageBoost")).toBe(true);
    expect(filterMovePrimitiveReference(rows, "condition berry").some(row => row.kind === "ateBerry")).toBe(true);
    expect(filterMovePrimitiveReference(rows, "no such primitive")).toEqual([]);
    expect(filterMovePrimitiveReference(rows, "  ")).toEqual(rows);
  });
});
