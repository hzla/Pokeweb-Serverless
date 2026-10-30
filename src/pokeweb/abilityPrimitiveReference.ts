import { ABILITY_IMPORT_LIBRARY } from "./abilityLibrary";
import { ABILITY_RULE_EFFECTS, ABILITY_RULE_PRESETS, type AbilityRuleSet } from "./abilityRules";

/** Describes the adjustable operations, rather than the copied native handlers. */
export const ABILITY_PRIMITIVE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  attack: "Multiply the holder’s Attack when calculating physical damage. Does not change stat stages.",
  specialAttack: "Multiply the holder’s Sp. Atk when calculating special damage. Does not change stat stages.",
  defense: "Multiply the holder’s Defense when it takes physical damage. Does not change stat stages.",
  specialDefense: "Multiply the holder’s Sp. Def when it takes special damage. Does not change stat stages.",
  speed: "Multiply the holder’s Speed. Does not change stat stages.",
  damage: "Multiply damage dealt by the holder’s attacks.",
  healPercent: "Restore a percentage of the holder’s maximum HP at the end of each turn.",
  healFlat: "Restore a fixed amount of the holder’s HP at the end of each turn.",
  healDivisor: "Restore maximum HP divided by the chosen number at the end of each turn.",
  status: "Try to inflict a chosen status at the selected trigger, target and chance.",
  statStage: "Raise or lower a chosen stat stage at the selected trigger, target and chance. The attack trigger requires damage.",
  recoil: "Deal a percentage of the selected target’s maximum HP at the chosen trigger.",
  critical: "Increase critical-hit chance by adding critical-hit stages.",
  accuracy: "Multiply the accuracy of moves used by the holder.",
  incomingAccuracy: "Multiply the accuracy of moves aimed at the holder.",
  "ability:power": "Multiply move power for a chosen move group, type or category.",
  "ability:damage": "Multiply outgoing damage for a chosen move group, type, category or effectiveness.",
  "ability:damageTaken": "Multiply incoming damage for a chosen move group, type, category or effectiveness.",
  "ability:immunity": "Block matching moves. This alone does not give levitation or protect against ground hazards.",
  "ability:hitStat": "Raise or lower the holder’s or attacker’s chosen stat after the holder takes matching move damage.",
  "ability:priority": "Add priority to the holder’s matching moves. Bonuses from separate matching effects add together.",
  "abilityRecipe:convertType": "Change matching moves to a chosen type and apply a power multiplier. Some moves that choose their own type are excluded.",
  "abilityRecipe:statAction": "Change selected targets’ stat stages on entry, a damaging hit, an HP threshold crossing or a faint. ‘Highest raw stat’ uses the holder’s stats.",
  "abilityRecipe:statusGuard": "Prevent a chosen condition for the holder or allies, optionally curing it too.",
  "abilityRecipe:statGuard": "Prevent selected stat drops for the holder or allies, optionally restricted by their type.",
  "abilityRecipe:allyPower": "Multiply matching allies’ move power, optionally including the holder.",
  "abilityRecipe:stageOperation": "Copy an ally’s stat stages to the holder, or reset allies’ stages, on entry.",
  "abilityRecipe:clearScreens": "Remove Reflect and Light Screen from the chosen sides on entry.",
  "abilityRecipe:weatherAction": "Start chosen weather on entry or after taking move damage, for a chosen duration.",
  "abilityRecipe:weatherStat": "Multiply Attack, Sp. Atk or Speed during chosen weather.",
  "abilityRecipe:healAction": "Heal the holder or allies on entry or after the holder eats a Berry.",
  "abilityRecipe:criticalStatus": "Force a critical hit against a target with the chosen condition, unless critical hits are blocked.",
  "abilityRecipe:ignoreEvasion": "Ignore the target’s evasion stage changes when checking accuracy.",
  "abilityRecipe:fullHpEffectiveness": "Replace incoming type effectiveness while the holder is at or above a chosen HP percentage.",
  "abilityRecipe:hazard": "Place chosen hazards on the opposing side after taking matching move damage.",
  "abilityRecipe:retaliate": "Damage the attacker based on HP lost to the move that knocks the holder out.",
  "abilityRecipe:perish": "Apply a Perish count to the holder and attacker after a matching damaging hit.",
  "abilityRecipe:intimidateCounter": "Block a chosen ability’s entry stat drop and raise a chosen stat instead.",
  "abilityRecipe:windAbsorb": "Block matching moves and raise a chosen stat; optionally react to Tailwind too.",
  "abilityRecipe:moveGuard": "Block matching moves aimed at the holder, optionally allowing its own moves.",
  "abilityRecipe:weatherGuard": "Prevent damage from hail, sandstorm or both. Does not change weather’s other effects.",
  "abilityRecipe:fieldPower": "Multiply one move type’s power for both sides. An aura-inversion effect can reverse the bonus.",
  "abilityRecipe:auraInvert": "Reverse active field-wide aura bonuses using each aura’s inversion setting.",
  "abilityRecipe:fieldStat": "Multiply a chosen battle stat for other Pokémon. Matching copies do not stack or affect one another.",
  "abilityRecipe:moveUserType": "Change the holder’s type to its move’s type, or a fixed type, before moving; once per entry or every move.",
  "abilityRecipe:entryTargetStat": "Multiply attacking stats against an opponent that switched in during this turn. Initial deployment is excluded.",
  "abilityRecipe:fallenPower": "Increase power for each fainted ally, counted when the holder enters or gains the ability, up to a chosen cap.",
  "abilityRecipe:priorityGuard": "Block opposing moves at or above a chosen priority, protecting the holder or its whole side.",
  "abilityRecipe:statEcho": "Reflect opposing stat drops or copy opponents’ stat boosts, optionally filtering by stat.",
  "abilityRecipe:transferItem": "Steal an item after dealing damage, or give the holder’s item to an ally after that ally consumes an item.",
};

export type AbilityPrimitiveReference = {
  kind: string;
  label: string;
  description: string;
  templates: string[];
  savedAbilities: Array<{ id: number; name: string }>;
};

export function abilityPrimitiveReference(
  rules: ReadonlyMap<number, AbilityRuleSet> = new Map(),
  names: readonly string[] = [],
): AbilityPrimitiveReference[] {
  const templates = [...ABILITY_RULE_PRESETS, ...ABILITY_IMPORT_LIBRARY];
  return ABILITY_RULE_EFFECTS.map(definition => ({
    kind: definition.kind,
    label: definition.label,
    description: ABILITY_PRIMITIVE_DESCRIPTIONS[definition.kind] ?? definition.label,
    templates: [...new Set(templates.filter(template => template.rule.effects.some(effect => effect.kind === definition.kind)).map(template => template.label))].sort((a, b) => a.localeCompare(b)),
    savedAbilities: [...rules].filter(([, rule]) => rule.effects.some(effect => effect.kind === definition.kind))
      .map(([id]) => ({ id, name: names[id] || `Ability ${id}` })).sort((a, b) => a.id - b.id),
  }));
}

export function filterAbilityPrimitiveReference(rows: readonly AbilityPrimitiveReference[], query: string): AbilityPrimitiveReference[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return rows.filter(row => {
    const text = [row.label, row.description, ...row.templates, ...row.savedAbilities.map(ability => `${ability.id} ${ability.name}`)].join(" ").toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
