import { MOVE_ALWAYS, newMoveEffect, validateMoveRule, type MoveRuleSet } from "./moveRules";

/** Move-local recipes with checked native calculation adapters. */
export const MOVE_STAGE2B_CANDIDATES: readonly { sourceId: number; label: string; rule: MoveRuleSet }[] = [
  {
    sourceId: 573,
    label: "Freeze-Dry",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("typeMatchup"), { ...newMoveEffect("status"), target: "target", value: 3, chance: 10, secondary: true }],
    }),
  },
  {
    sourceId: 676,
    label: "Pollen Puff",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS),
      prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [{ ...newMoveEffect("allyHealInstead"), value: 1, parameters: { denominator: 2 } }],
    }),
  },
  {
    sourceId: 786,
    label: "Overdrive",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("bypassSubstitute")],
    }),
  },
  {
    sourceId: 745,
    label: "Snipe Shot",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("ignoreRedirection")],
    }),
  },
  {
    sourceId: 776,
    label: "Body Press",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("attackStat")],
    }),
  },
  {
    sourceId: 686,
    label: "Revelation Dance",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("moveUserType")],
    }),
  },
  {
    sourceId: 871,
    label: "Torch Song",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("bypassSubstitute"), { ...newMoveEffect("statStage"), phase: "afterMove", value: 1, parameters: { stat: 3 } }],
    }),
  },
  {
    sourceId: 815,
    label: "Scorching Sands",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("thawTargets"), { ...newMoveEffect("status"), target: "target", value: 4, chance: 30, secondary: true }],
    }),
  },
  {
    sourceId: 876,
    label: "Hydro Steam",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("damageWeather")],
    }),
  },
  {
    sourceId: 902,
    label: "Matcha Gotcha",
    rule: validateMoveRule({
      conditions: structuredClone(MOVE_ALWAYS), prerequisites: structuredClone(MOVE_ALWAYS),
      effects: [newMoveEffect("thawTargets"), { ...newMoveEffect("drainEachHit"), value: 50 }, { ...newMoveEffect("status"), target: "target", value: 4, chance: 20, secondary: true }],
    }),
  },
];
export const MOVE_STAGE2B_ENABLED: readonly number[] = MOVE_STAGE2B_CANDIDATES.map(t=>t.sourceId);
