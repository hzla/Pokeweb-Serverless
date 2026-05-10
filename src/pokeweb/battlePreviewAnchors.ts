export type BattlePreviewAnchor = [number, number, number];

export const USER_BATTLE_ANCHOR: BattlePreviewAnchor = [-18, 12, 18];
export const TARGET_BATTLE_ANCHOR: BattlePreviewAnchor = [15, 18, -10];
export const CENTER_BATTLE_ANCHOR: BattlePreviewAnchor = [0, 18, 0];

export function copyBattleAnchor(anchor: BattlePreviewAnchor): BattlePreviewAnchor {
  return [anchor[0], anchor[1], anchor[2]];
}
