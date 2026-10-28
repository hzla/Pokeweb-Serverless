import { ITEM_RULE_EFFECTS, validateItemRule, type ItemRuleSet } from "./itemRules";
const always = () => ({ kind: "group" as const, mode: "all" as const, children: [] });
export const ITEM_RULE_PRESETS = [
  ...ITEM_RULE_EFFECTS.filter(effect => effect.nativeItem).map(effect => ({ id: effect.nativeItem!, label: effect.label.replace(/ behavior$/u, "") })),
  { id: 295, label: "Shed Shell" }, { id: 116, label: "Douse Drive" }, { id: 117, label: "Shock Drive" }, { id: 118, label: "Burn Drive" }, { id: 119, label: "Chill Drive" },
].sort((a, b) => a.label.localeCompare(b.label));
/** A preset remains an editable composition; native behaviors retain their own checks. */
export function itemRulePreset(id: number, consumed: boolean): ItemRuleSet {
  let effects: ItemRuleSet["effects"] = [{ kind: `native:${id}`, value: -1 }];
  if ([220, 297, 287].includes(id)) effects = [{ kind: id === 220 ? "attack" : id === 297 ? "specialAttack" : "speed", value: 1.5 }, { kind: "moveLock", value: 1 }];
  if (id === 234) effects = [{ kind: "healDivisor", value: 16 }];
  if (id === 295) effects = [{ kind: "escapeTrap", value: 1 }];
  if (id >= 116 && id <= 119) effects = [{ kind: "moveType", value: [10, 12, 9, 14][id - 116], move: 546 }];
  if (id >= 298 && id <= 313) effects.push({ kind: "moveType", value: [9, 10, 12, 11, 14, 1, 3, 4, 2, 13, 6, 5, 7, 15, 16, 8][id - 298], move: 449 });
  return validateItemRule({ effects, conditions: always(), consumable: consumed || id === 541 });
}
