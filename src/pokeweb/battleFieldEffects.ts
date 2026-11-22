/** Native whole-field and side-effect IDs shared by BW and BW2. */
export const BATTLE_FIELD_EFFECTS: Readonly<Record<number, string>> = {
  1: "Trick Room", 2: "Gravity", 4: "Water Sport", 5: "Mud Sport",
  6: "Wonder Room", 7: "Magic Room",
};

export const BATTLE_SIDE_EFFECTS: Readonly<Record<number, string>> = {
  0: "Reflect", 1: "Light Screen", 2: "Safeguard", 3: "Mist", 4: "Tailwind",
  5: "Lucky Chant", 6: "Spikes", 7: "Toxic Spikes", 8: "Stealth Rock",
  11: "Pledge rainbow", 12: "Pledge sea of fire", 13: "Pledge swamp",
};

export const maxSideEffectLayers = (id: number): number => id === 6 ? 3 : id === 7 ? 2 : 1;

export type SideBattleCondition = {
  kind: "sideEffect"; value: number; side: "own" | "opposing"; layers?: number; negate?: boolean;
};
export type BattleFieldCondition = { kind: "fieldEffect"; value: number; negate?: boolean } | SideBattleCondition;

export function validateBattleFieldCondition(condition: BattleFieldCondition): BattleFieldCondition {
  const labels = condition.kind === "fieldEffect" ? BATTLE_FIELD_EFFECTS : BATTLE_SIDE_EFFECTS;
  if (!Number.isInteger(condition.value) || !Object.hasOwn(labels, condition.value) ||
      condition.negate !== undefined && typeof condition.negate !== "boolean") throw Error("Invalid activation condition.");
  const negate = Boolean(condition.negate);
  if (condition.kind === "fieldEffect") return { kind: condition.kind, value: condition.value, negate };
  const layers = condition.layers === undefined ? 1 : condition.layers;
  if ((condition.side !== "own" && condition.side !== "opposing") || !Number.isInteger(layers) ||
      layers < 1 || layers > maxSideEffectLayers(condition.value)) throw Error("Invalid activation condition.");
  return { kind: condition.kind, value: condition.value, side: condition.side, layers, negate };
}

// Low byte for effect ID, bit 8 for opposing side and high bits for minimum layers.
export const encodeSideBattleCondition = (condition: SideBattleCondition): number =>
  condition.value | Number(condition.side === "opposing") << 8 | (condition.layers ?? 1) << 9;

type ConditionTree = { kind: string; children?: readonly ConditionTree[] };
export function usesBattleCondition(node: ConditionTree, kind: string): boolean {
  return node.kind === kind || (node.children?.some(child => usesBattleCondition(child, kind)) ?? false);
}
