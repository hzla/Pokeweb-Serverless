import type { RecipeAbilityEffect } from "./abilityRecipeEffects";
import type { ItemRuleEffect } from "./itemRules";

export const ACTION_ABILITY_EFFECTS: RecipeAbilityEffect[] = [{
  kind: "abilityRecipe:knockoutSplash", code: 164, label: "Knockout splash damage",
  value: 20, min: .01, max: 100, step: .01, unit: "% max HP", scale: 100, bypassable: false,
  parameters: [{ key: "hpBasis", label: "HP basis", original: 0, min: 0, max: 1, step: 1, kind: "number",
    choices: [0, 1], labels: { 0: "Defeated opponent", 1: "Each receiving ally" }, sites: [] }],
}];

/** Earlier configurations keep their exact runtime and record layout. */
export function needsAbilityActionRuntime(effect: ItemRuleEffect): boolean {
  return effect.kind === "abilityRecipe:knockoutSplash" || effect.kind === "abilityRecipe:statAction"
    && (effect.parameters?.activation === 5 || effect.parameters?.statSource === 1);
}
