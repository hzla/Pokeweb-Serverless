import type { AbilityRuleSet } from "./abilityRules";
import { nativeAbilityEvents, type NativeAbilityProfile } from "./abilityNativeRuntime";
import { recipeAbilityEffect, recipeAbilityParameter } from "./abilityRecipeEffects";
import { libraryAbilityEffect } from "./abilityLibraryEffects";

/** Native event subscriptions, including state observers that run before conditions. */
export function abilityRuleEvents(rule: AbilityRuleSet, profiles: NativeAbilityProfile[]): number[] {
  const events = new Set<number>();
  const add = (...ids: number[]) => ids.forEach(id => events.add(id));
  for (const effect of rule.effects) {
    if (effect.kind.startsWith("nativeAbility:")) {
      const profile = profiles.find(p => p.id === Number(effect.kind.slice(14)));
      if (!profile) throw new Error(`Missing native ability profile: ${effect.kind}`);
      nativeAbilityEvents(profile, effect).forEach(e => add(e.event));
      // The client trapping query needs the current live flow before its first
      // menu check, including when the ability is acquired by swapping.
      if (profile.id === 42) add(0x55, 0x8a);
      continue;
    }
    const recipe = recipeAbilityEffect(effect.kind), library = libraryAbilityEffect(effect.kind);
    if (recipe) {
      const p = (key: string) => recipeAbilityParameter(effect, key);
      switch (recipe.code) {
        case 135: add(0x28, 0x38); break;
        case 136:
          switch (p("activation")) {
            case 0: add(0x55, 0x8a); break;
            case 1: add(0x4b); break;
            case 2: add(0x81, 0x4b, 0x84); break;
            case 3: add(0xa3); break;
            case 4: add(0x83); break;
            case 5: add(0x03, 0x29, 0x04); break;
          }
          break;
        case 137: add(0x65); if (p("cure")) add(0x55, 0x8a, 0x88, 0x77); break;
        case 138: case 151: add(0x5b); break;
        case 139: case 155: add(0x38); break;
        case 140: case 141: add(0x55, 0x8a); break;
        case 142: if (p("activation")) add(0x4b); else add(0x55, 0x8a); break;
        case 143: add(p("stat") === 5 ? 0x13 : 0x3b); break;
        case 144: if (p("activation")) add(0xa6); else add(0x55, 0x8a); break;
        case 145: add(0x36); break;
        case 146: add(0x33); break;
        case 147: add(0x3e); break;
        case 148: case 149: case 150: add(0x4b); break;
        case 152: add(0x2d); if (p("tailwind")) add(0x55, 0x8a, 0x9f); break;
        case 153: case 161: add(0x2d); break;
        case 154: add(0x7f); break;
        case 156: break; // Queried as a field provider; no callback changes battle state.
        case 157: add([1, 3].includes(p("stat")) ? 0x3b : 0x3c); break;
        case 158: add(0x03, 0x28, 0x29); break;
        case 159: add(0x3b); break;
        case 160: add(0x55, 0x8a, 0x38); break;
        case 162: add(p("mode") ? 0x5d : 0x5b); break;
        case 163: add(p("mode") ? 0xa7 : 0x4b); break;
        case 164: add(0x03, 0x4b, 0x83); break;
        default: throw new Error(`Missing ability event mapping: ${effect.kind}`);
      }
    } else if (library) {
      const event = ({129: 0x38, 130: 0x47, 131: 0x47, 132: 0x2d, 133: 0x4b, 134: 0x11} as Record<number, number>)[library.code];
      if (event === undefined) throw new Error(`Missing ability event mapping: ${effect.kind}`);
      add(event);
    } else {
      switch (effect.kind) {
        case "attack": case "specialAttack": add(0x3b); break;
        case "defense": case "specialDefense": add(0x3c); break;
        case "speed": add(0x13); break;
        case "damage": add(0x47); break;
        case "critical": add(0x36); break;
        case "accuracy": case "incomingAccuracy": add(0x34); break;
        case "healPercent": case "healFlat": case "healDivisor": add(0x77); break;
        case "status": case "statStage": case "recoil":
          add(({entry: 0x55, turnEnd: 0x77, afterAttack: 0x85, afterHit: 0x4b, afterContact: 0x4b, hpCheck: 0x91})[effect.trigger ?? "entry"]);
          break;
        default: throw new Error(`Missing ability event mapping: ${effect.kind}`);
      }
    }
  }
  return [...events].sort((a, b) => a - b);
}
