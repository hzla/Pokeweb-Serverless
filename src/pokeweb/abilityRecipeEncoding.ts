import { abilityRuleEvents } from "./abilityEvents";
import type { NativeAbilityProfile } from "./abilityNativeRuntime";
import { encodeAbilityRecipeBook } from "./abilityRecipeBook";
import { EMPTY_ABILITY_RULE, encodeAbilityRules, type AbilityRuleSet } from "./abilityRules";

type RecipeEncodingOptions = {
    compactExecution: boolean;
    usesLocalConditions: boolean;
    battleMessages: boolean;
    formConversion: boolean;
};

/** Pack the rules the battle runtime will execute. */
export function encodeAbilityExecutableRules(
    entries: ReadonlyMap<number, AbilityRuleSet>,
    profiles: NativeAbilityProfile[],
    { compactExecution, usesLocalConditions, battleMessages, formConversion }: RecipeEncodingOptions,
): Uint8Array {
    return encodeAbilityRules(entries, compactExecution, usesLocalConditions
        ? effect => abilityRuleEvents({ effects: [effect], conditions: EMPTY_ABILITY_RULE.conditions }, profiles, battleMessages, formConversion)
        : undefined);
}

/** Save the authored recipes so the editor can recover them when the DLL is reopened. */
export function encodeSavedAbilityRecipes(entries: ReadonlyMap<number, AbilityRuleSet>, compactPackaging: boolean): string {
    const sorted = [...entries].sort(([a], [b]) => a - b);
    return compactPackaging ? encodeAbilityRecipeBook(sorted) : JSON.stringify(sorted);
}
