import { PROPERTIES } from "./constants";

// Values 14–255 remain available to every existing custom flag. Native flags
// use editor-only values; the fixed runtime record stores their index and tag.
export const VANILLA_MOVE_FILTER_BASE = 256;
export const VANILLA_MOVE_FLAGS = PROPERTIES.map((key, index) => ({
  key, index, filter: VANILLA_MOVE_FILTER_BASE + index,
  label: `Vanilla: ${key.replace(/[_-]/g, " ").replace(/^./, c => c.toUpperCase())}`,
}));
export const VANILLA_MOVE_FILTER_MAX = VANILLA_MOVE_FILTER_BASE + VANILLA_MOVE_FLAGS.length - 1;
export const vanillaMoveFlagIndex = (filter: number): number | undefined =>
  Number.isInteger(filter) && filter >= VANILLA_MOVE_FILTER_BASE && filter <= VANILLA_MOVE_FILTER_MAX
    ? filter - VANILLA_MOVE_FILTER_BASE : undefined;
export const VANILLA_MOVE_FILTER_LABELS = Object.fromEntries(VANILLA_MOVE_FLAGS.map(flag => [flag.filter, flag.label]));
export const encodeAbilityMoveFilter = (filter: number) => ({
  filter: vanillaMoveFlagIndex(filter) ?? filter,
  tag: vanillaMoveFlagIndex(filter) === undefined ? 0 : 2,
});
