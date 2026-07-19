export type BattlePreviewAnchor = [number, number, number];

// Legacy preview-space anchors used by the Gen 4 effect interpreters. Gen 5
// retail scene coordinates live in gen5BattleSceneLayout.ts and are selected
// by the renderer/simulator when a Gen 5 battle environment is present.
export const USER_BATTLE_ANCHOR: BattlePreviewAnchor = [-18, 12, 18];
export const TARGET_BATTLE_ANCHOR: BattlePreviewAnchor = [15, 18, -10];
export const CENTER_BATTLE_ANCHOR: BattlePreviewAnchor = [0, 18, 0];

export function copyBattleAnchor(anchor: BattlePreviewAnchor): BattlePreviewAnchor {
  return [anchor[0], anchor[1], anchor[2]];
}
