export const MOVE_ANIMATION_AUTHORS = [
  "Blaze Black/Volt White 2 Redux",
  "Cascade White",
  "Log(n)",
  "Hzla",
] as const;

export type MoveAnimationAuthor = typeof MOVE_ANIMATION_AUTHORS[number];

// Retained imports from W2U's donor maps; overlapping Gen 8-9 slots now use Log(n)'s replacements.
const REDUX_MOVE_IDS = new Set([574, 577, 583, 585, 586, 595, 605, 609, 611, 612, 684]);
const CASCADE_MOVE_IDS = new Set([660, 661, 665, 667, 669, 676, 679, 680, 681, 688, 691, 693, 706, 707, 709, 710, 716]);

export function getBundledMoveAnimationAuthor(sourceMoveId: number): MoveAnimationAuthor {
  if ((sourceMoveId >= 744 && sourceMoveId <= 850) || (sourceMoveId >= 852 && sourceMoveId <= 919)) return "Log(n)";
  if (REDUX_MOVE_IDS.has(sourceMoveId)) return "Blaze Black/Volt White 2 Redux";
  if (CASCADE_MOVE_IDS.has(sourceMoveId)) return "Cascade White";
  return "Hzla";
}

export function summarizeMoveAnimationCredits(moves: ReadonlyArray<{ author: MoveAnimationAuthor }>): Array<{ author: MoveAnimationAuthor; count: number }> {
  return MOVE_ANIMATION_AUTHORS.map((author) => ({ author, count: moves.filter((move) => move.author === author).length }));
}
