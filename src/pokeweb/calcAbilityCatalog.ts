import { ABILITY_IMPORT_LIBRARY } from "./abilityLibrary";
import { libraryAbilityEffect } from "./abilityLibraryEffects";
import { nativeAbilityProfile } from "./abilityNativeRuntime";
import { optimizeAbilityRule } from "./abilityRecipeOptimization";
import { recipeAbilityEffect } from "./abilityRecipeEffects";
import { validateAbilityRule, type AbilityRuleSet } from "./abilityRules";
import { itemRecipeEffect } from "./itemRecipeEffects";
import { ITEM_RULE_EFFECTS, type ItemRuleEffect } from "./itemRules";

export function exportCalcEffect(effect: ItemRuleEffect) {
  const definition = recipeAbilityEffect(effect.kind) ?? libraryAbilityEffect(effect.kind) ??
    itemRecipeEffect(effect.kind) ?? nativeAbilityProfile(effect.kind);
  const native = nativeAbilityProfile(effect.kind);
  const original = (sites?: readonly { original: number }[]) =>
    sites?.length && sites.every(site => site.original === sites[0].original) ? sites[0].original : undefined;
  const defaults = Object.fromEntries((definition?.parameters ?? []).map(p => [p.key, p.original]));
  if (libraryAbilityEffect(effect.kind)) delete defaults.types;
  return {
    ...effect,
    label: libraryAbilityEffect(effect.kind)?.label ?? recipeAbilityEffect(effect.kind)?.label ??
      ITEM_RULE_EFFECTS.find(entry => entry.kind === effect.kind)?.label,
    value: effect.value === -1 && native ? original(native.multipliers) ?? -1 : effect.value,
    ...(native ? { weather: effect.weather ?? original(native.weather) } : {}),
    parameters: { ...defaults, ...effect.parameters },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => [key, canonical(value)]));
}

function normalizeAbility(rule: AbilityRuleSet) {
  const normalized = validateAbilityRule(optimizeAbilityRule(rule));
  return { ...normalized, effects: normalized.effects.map(exportCalcEffect) };
}

export function calcAbilityCatalogEntries() {
  return [...ABILITY_IMPORT_LIBRARY].sort((a, b) => a.id - b.id)
    .map(template => [template.id, template.defaultName, normalizeAbility(template.rule)] as const);
}

const key = (value: unknown) => JSON.stringify(canonical(value));
const templatesByRule = new Map<string, Array<{ id: number; name: string }>>();
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/gu, "");
for (const [id, name, rule] of calcAbilityCatalogEntries()) {
  const signature = key(rule);
  const entries = templatesByRule.get(signature) ?? [];
  entries.push({ id, name });
  templatesByRule.set(signature, entries);
}

/** Omit a recipe only when its complete normalized calculator representation matches. */
export function calcAbilityTemplateId(rule: AbilityRuleSet, name?: string) {
  try {
    const entries = templatesByRule.get(key(normalizeAbility(rule)));
    return entries?.find(entry => name && nameKey(entry.name) === nameKey(name))?.id ?? entries?.[0].id;
  } catch {
    return undefined;
  }
}

export function serializeCalcAbilityCatalog() {
  return key(calcAbilityCatalogEntries());
}
