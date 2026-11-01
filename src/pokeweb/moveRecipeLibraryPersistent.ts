import { MOVE_ALWAYS, newMoveEffect, validateMoveRule, type MoveCondition, type MoveEffect, type MoveRuleSet } from "./moveRules";

type Template = { sourceId: number; label: string; rule: MoveRuleSet };
const template = (sourceId: number, label: string, effect: MoveEffect | MoveEffect[], prerequisites: MoveCondition = MOVE_ALWAYS): Template => ({
  sourceId, label, rule: validateMoveRule({ conditions: MOVE_ALWAYS, prerequisites, effects: Array.isArray(effect) ? effect : [effect] }),
});

export const MOVE_PERSISTENT_TEMPLATES: readonly Template[] = [
  template(564, "Sticky Web", { ...newMoveEffect("entryStatHazard"), value: -1, parameters: { stat: 5, side: 1 } }),
  template(569, "Ion Deluge", { ...newMoveEffect("fieldMoveType"), value: 12, parameters: { fromType: 0 } }),
  template(582, "Electrify", { ...newMoveEffect("targetMoveType"), value: 12 }),
  template(587, "Fairy Lock", newMoveEffect("fieldSwitchLock")),
  template(671, "Spotlight", newMoveEffect("spotlight")),
  template(673, "Laser Focus", newMoveEffect("focusCritical")),
  template(675, "Throat Chop", { ...newMoveEffect("blockMoveFlag"), secondary: true, parameters: { turns: 2 } }),
  template(721, "Plasma Fists", { ...newMoveEffect("fieldMoveType"), value: 12, phase: "afterRealHits", parameters: { fromType: 0 } }),
  template(746, "Jaw Lock", newMoveEffect("mutualTrap")),
  template(748, "No Retreat", { ...newMoveEffect("selfTrapBoost"), parameters: { stats: 31 } }),
  template(753, "Octolock", [
    { ...newMoveEffect("sourceCondition"), value: 22, phase: "status", target: "target" },
    ...[2, 4].map(stat => ({ ...newMoveEffect("residualStat"), phase: "status" as const, parameters: { stat, turns: 0, linked: 1 } })),
  ], { kind: "group", mode: "all", children: [
    { kind: "type", subject: "target", value: 7, negate: true },
    { kind: "persistentFromMove", subject: "target", value: 0, negate: true },
  ] }),
  template(756, "Court Change", newMoveEffect("swapSideEffects")),
  template(862, "Glaive Rush", { ...newMoveEffect("vulnerableUntilAction"), value: 2, parameters: { alwaysHits: 1 } }),
  template(864, "Salt Cure", { ...newMoveEffect("residualDamage"), secondary: true, parameters: { specialDenominator: 4, type1: 10, type2: 8, turns: 0 } }),
  template(903, "Syrup Bomb", { ...newMoveEffect("residualStat"), secondary: true, parameters: { stat: 5, turns: 3, linked: 1 } }),
  template(913, "Dragon Cheer", { ...newMoveEffect("criticalStageBoost"), target: "allies", conditions: { kind: "group", mode: "all", children: [
    { kind: "sameMon", subject: "target", value: 0 },
    { kind: "adjacent", subject: "target", value: 1 },
    { kind: "hidden", subject: "target", value: 0 },
  ] }, parameters: { type: 15, enhanced: 2 } }),
];
