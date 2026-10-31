import { MOVE_ALWAYS, newMoveEffect, validateMoveRule, type MoveCondition, type MoveEffect, type MovePhase, type MoveRuleSet, type MoveTarget } from "./moveRules";
export type MoveRecipeTemplate = { sourceId: number; label: string; rule: MoveRuleSet };
const all = (...children: MoveCondition[]): MoveCondition => ({ kind: "group", mode: "all", children });
const any = (...children: MoveCondition[]): MoveCondition => ({ kind: "group", mode: "any", children });
const weather = (value: number, negate = false): MoveCondition => ({ kind: "weather", value, negate });
const targetStatus = (value: number): MoveCondition => ({ kind: "status", subject: "target", value });
const type = (value: number): MoveCondition => ({ kind: "type", subject: "target", value });
const effect = (kind: string, value: number, phase: MovePhase, target: MoveTarget = "user", conditions = all(), parameters?: Record<string, number>, secondary = false, chance = 100): MoveEffect => ({ ...newMoveEffect(kind), value, phase, target, conditions, parameters, secondary, chance });
const stat = (stat: number, value: number, phase: MovePhase, target: MoveTarget = "user", conditions = all(), secondary = false, chance = 100) => effect("statStage", value, phase, target, conditions, { stat }, secondary, chance);
const template = (sourceId: number, label: string, effects: MoveEffect[], prerequisites = all(), nativeBase?: number): MoveRecipeTemplate => ({ sourceId, label, rule: validateMoveRule({ effects, conditions: all(), prerequisites, nativeBase }) });
const grass = type(11), poison = targetStatus(5);
const plusMinus = any({ kind: "ability", subject: "target", value: 57 }, { kind: "ability", subject: "target", value: 58 });
const ally = all({ kind: "ally", value: 1 }, { kind: "sameMon", value: 0 });
const unacted: MoveCondition = { kind: "targetActed", value: 0 };
const superEffective = any({ kind: "effectiveness", value: 4 }, { kind: "effectiveness", value: 5 });
const rainAccuracy = () => effect("accuracy", 1, "accuracy", "user", weather(2));
export const MOVE_RECIPE_LIBRARY: readonly MoveRecipeTemplate[] = [
  template(563, "Rototiller", [stat(1, 1, "status", "all", all(grass, { kind: "grounded", value: 1 })), stat(3, 1, "status", "all", all(grass, { kind: "grounded", value: 1 }))]),
  template(565, "Fell Stinger", [stat(1, 2, "knockout")]),
  template(576, "Topsy-Turvy", [effect("stages", 1, "status", "target", all(), { operation: 1 })]),
  template(579, "Flower Shield", [stat(2, 1, "status", "all", grass)]),
  template(599, "Venom Drench", [1, 3, 5].map(s => stat(s, -1, "status", "target", poison))),
  template(602, "Magnetic Flux", [2, 4].map(s => stat(s, 1, "status", "allies", plusMinus))),
  template(659, "Shore Up", [effect("heal", 1, "status", "user", weather(4, true), { denominator: 2 }), effect("heal", 2, "status", "user", weather(4), { denominator: 3 })]),
  template(660, "First Impression", [], all({ kind: "firstTurn", subject: "user", value: 1 })),
  template(663, "Darkest Lariat", [effect("ignoreStages", 1, "damage")]),
  template(664, "Sparkling Aria", [effect("cure", 4, "afterRealHits", "target")]),
  template(674, "Gear Up", [1, 3].map(s => stat(s, 1, "status", "allies", plusMinus))),
  template(706, "Psychic Fangs", [], all(), 280),
  template(736, "Glitzy Glow", [effect("native", 113, "hitSide")]),
  template(737, "Baddy Bad", [effect("native", 115, "hitSide")]),
  template(739, "Freezy Frost", [effect("stages", 0, "hitSide", "all", all(), { operation: 0 })]),
  template(740, "Sparkly Swirl", [effect("native", 215, "hitSide")]),
  template(754, "Bolt Beak", [effect("power", 2, "power", "user", unacted)]),
  template(755, "Fishious Rend", [effect("power", 2, "power", "user", unacted)]),
  template(777, "Decorate", [stat(1, 2, "status", "target"), stat(3, 2, "status", "target")]),
  template(788, "Grav Apple", [effect("power", 1.5, "power", "user", { kind: "field", value: 2 }), stat(2, -1, "hit", "target", all(), true)]),
  template(799, "Scale Shot", [stat(5, 1, "afterMove"), stat(2, -1, "afterMove")]),
  template(811, "Coaching", [stat(1, 1, "status", "target", ally), stat(2, 1, "status", "target", ally)]),
  template(839, "Barb Barrage", [effect("power", 2, "power", "user", poison), effect("status", 5, "hit", "target", all(), undefined, true, 50)]),
  template(846, "Bleakwind Storm", [rainAccuracy(), stat(5, -1, "hit", "target", all(), true, 30)]),
  template(847, "Wildbolt Storm", [rainAccuracy(), effect("status", 1, "hit", "target", all(), undefined, true, 20)]),
  template(848, "Sandsear Storm", [rainAccuracy(), effect("status", 4, "hit", "target", all(), undefined, true, 20)]),
  template(850, "Take Heart", [stat(3, 1, "status"), stat(4, 1, "status"), effect("cure", 0, "status")]),
  template(878, "Collision Course", [effect("damage", 1.333333, "damage", "user", superEffective)]),
  template(879, "Electro Drift", [effect("damage", 1.333333, "damage", "user", superEffective)]),
  template(912, "Hard Press", [effect("hpPower", 100, "power", "target")]),
  template(918, "Upper Hand", [effect("flinch", 100, "hit", "target", MOVE_ALWAYS, undefined, true)], all(any(...[1, 2, 3].map(value => ({ kind: "pendingPriority" as const, value }))))),
].sort((a, b) => a.label.localeCompare(b.label));
export const moveRecipeTemplate = (id: number) => MOVE_RECIPE_LIBRARY.find(t => t.sourceId === id);
