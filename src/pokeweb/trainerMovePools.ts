import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";

/**
 * Per-slot move pools for trainer Pokémon. Each of a Pokémon's four move slots can list alternative moves with
 * weights; in battle, Trainer Customization rolls one move per slot, with the slot's own move as the first choice.
 * A move never appears twice: the game rerolls a set that would repeat one.
 *
 * `battle/trainer-move-pools.bin` has a 16-byte header (PWMP, 16-bit version 1, 16-bit key size 8, 32-bit key count,
 * 32-bit payload size), then keys sorted by source and index: 16-bit source (a trainer ID, or a pool source with
 * bit 15 set), 8-bit party slot or pool candidate, a zero byte, and a 32-bit payload offset. Each entry holds four
 * alternative counts, four 16-bit weights for the slots' own moves, and the alternatives as 16-bit move and weight.
 */
export const TRAINER_MOVE_POOLS_PATH = "battle/trainer-move-pools.bin";
export const TRAINER_MOVE_SLOT_MAX = 15;
export const TRAINER_MOVE_POOL_MAX = 32;
export const TRAINER_MOVE_WEIGHT_MAX = 65535;

const MAGIC = 0x504d5750;
const HEADER = 16;
const KEY = 8;
const ENTRY = 12;

export type TrainerMoveOption = { move: number; weight: number };
/** A move slot: the weight of its own move, and its alternatives. */
export type TrainerMoveSlot = { weight: number; alternatives: TrainerMoveOption[] };
/** Always four slots. */
export type TrainerMovePools = TrainerMoveSlot[];

export const trainerMovePoolKey = (source: number, index: number) => source * 256 + index;
export const trainerMovePoolSource = (key: number) => Math.floor(key / 256);
export const trainerMovePoolIndex = (key: number) => key % 256;

export function emptyTrainerMovePools(): TrainerMovePools {
  return Array.from({ length: 4 }, () => ({ weight: 1, alternatives: [] }));
}

export function hasMoveAlternatives(pools?: TrainerMovePools): pools is TrainerMovePools {
  return !!pools?.some((slot) => slot.alternatives.length);
}

const within = (n: number, min: number, max: number) => Number.isInteger(n) && min <= n && n <= max;

/**
 * Whether some roll gives every slot a move without repeating one. `moves` are the slots' own moves. Returns a
 * sentence describing the problem, or undefined when the pools are usable.
 */
export function trainerMovePoolProblem(pools: TrainerMovePools, moves: readonly number[]): string | undefined {
  if (pools.length !== 4) return "A Pokémon has four move slots.";
  let total = 0;
  for (const [index, slot] of pools.entries()) {
    const label = `Move ${index + 1}`;
    if (!within(slot.weight, 0, TRAINER_MOVE_WEIGHT_MAX)) return `${label}'s chance needs a weight from 0 to ${TRAINER_MOVE_WEIGHT_MAX}.`;
    if (slot.alternatives.length > TRAINER_MOVE_SLOT_MAX) return `${label} can have up to ${TRAINER_MOVE_SLOT_MAX} alternatives.`;
    total += slot.alternatives.length;
    const seen = new Set<number>([moves[index] ?? 0]);
    for (const option of slot.alternatives) {
      if (!within(option.move, 1, 65535)) return `${label} has an alternative without a move.`;
      if (!within(option.weight, 1, TRAINER_MOVE_WEIGHT_MAX)) return `${label}'s alternatives need weights from 1 to ${TRAINER_MOVE_WEIGHT_MAX}.`;
      if (seen.has(option.move)) return `${label} lists the same move twice.`;
      seen.add(option.move);
    }
  }
  if (total > TRAINER_MOVE_POOL_MAX) return `A Pokémon can have up to ${TRAINER_MOVE_POOL_MAX} alternative moves in all.`;
  if (!total) return undefined;
  // The game rolls slots in order and starts over when a slot has nothing left, so make sure some set exists.
  // Slots without alternatives keep their moves, and the rolled slots must avoid those.
  const rolled = pools.flatMap((slot, index) => slot.alternatives.length
    ? [[...(slot.weight ? [moves[index] ?? 0] : []), ...slot.alternatives.map((option) => option.move)]] : []);
  const used = pools.flatMap((slot, index) => slot.alternatives.length ? [] : [moves[index] ?? 0]).filter(Boolean);
  const search = (slot: number): boolean => {
    if (slot === rolled.length) return true;
    for (const move of rolled[slot]!) {
      if (move && used.includes(move)) continue;
      used.push(move);
      if (search(slot + 1)) return true;
      used.pop();
    }
    return false;
  };
  return search(0) ? undefined : "These move slots can't all get different moves; add more alternatives or change a fixed move.";
}

/** Each option's share of its slot's rolls, before rerolls for repeated moves. */
export function trainerMoveSlotChances(slot: TrainerMoveSlot, move: number): Array<TrainerMoveOption & { chance: number }> {
  const options = [{ move, weight: slot.weight }, ...slot.alternatives];
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  return options.map((option) => ({ ...option, chance: total ? option.weight / total : 0 }));
}

export function decodeTrainerMovePools(bytes?: Uint8Array): Map<number, TrainerMovePools> {
  const result = new Map<number, TrainerMovePools>();
  if (!bytes) return result;
  const fail = () => new Error("Invalid trainer move pool data.");
  if (bytes.length < HEADER || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== KEY) throw fail();
  const count = readU32(bytes, 8), payload = readU32(bytes, 12);
  const keysEnd = HEADER + count * KEY;
  if (count > 0x10000 || bytes.length !== keysEnd + payload) throw fail();
  let previous = -1;
  for (let index = 0; index < count; ++index) {
    const at = HEADER + index * KEY;
    const key = trainerMovePoolKey(readU16(bytes, at), bytes[at + 2]!);
    const offset = readU32(bytes, at + 4);
    if (bytes[at + 3] || key <= previous || offset + ENTRY > payload) throw fail();
    previous = key;
    const entry = keysEnd + offset;
    const counts = Array.from(bytes.subarray(entry, entry + 4));
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (counts.some((n) => n > TRAINER_MOVE_SLOT_MAX) || !total || total > TRAINER_MOVE_POOL_MAX || offset + ENTRY + total * 4 > payload) throw fail();
    let option = entry + ENTRY;
    result.set(key, counts.map((n, slot) => ({
      weight: readU16(bytes, entry + 4 + slot * 2),
      alternatives: Array.from({ length: n }, () => {
        const value = { move: readU16(bytes, option), weight: readU16(bytes, option + 2) };
        option += 4;
        return value;
      }),
    })));
  }
  return result;
}

/** Entries without alternatives are left out. */
export function encodeTrainerMovePools(pools: ReadonlyMap<number, TrainerMovePools>): Uint8Array {
  const entries = [...pools].filter(([, value]) => hasMoveAlternatives(value)).sort(([a], [b]) => a - b);
  const sizes = entries.map(([, value]) => ENTRY + value.reduce((sum, slot) => sum + slot.alternatives.length, 0) * 4);
  const keysEnd = HEADER + entries.length * KEY;
  const payload = sizes.reduce((sum, size) => sum + size, 0);
  const bytes = new Uint8Array(keysEnd + payload);
  writeU32(bytes, 0, MAGIC);
  writeU16(bytes, 4, 1);
  writeU16(bytes, 6, KEY);
  writeU32(bytes, 8, entries.length);
  writeU32(bytes, 12, payload);
  let offset = 0;
  entries.forEach(([key, value], index) => {
    const at = HEADER + index * KEY;
    writeU16(bytes, at, trainerMovePoolSource(key));
    bytes[at + 2] = trainerMovePoolIndex(key);
    writeU32(bytes, at + 4, offset);
    const entry = keysEnd + offset;
    let option = entry + ENTRY;
    value.forEach((slot, index) => {
      bytes[entry + index] = slot.alternatives.length;
      writeU16(bytes, entry + 4 + index * 2, slot.weight);
      for (const { move, weight } of slot.alternatives) {
        writeU16(bytes, option, move);
        writeU16(bytes, option + 2, weight);
        option += 4;
      }
    });
    offset += sizes[index]!;
  });
  return bytes;
}

/**
 * Keep a slot's alternatives sensible when its own move changes: picking one of its alternatives swaps the two,
 * so the old move becomes the alternative with the same weight. Returns the pools to store (undefined for none).
 */
export function changeOwnMove(pools: TrainerMovePools | undefined, slot: number, previous: number, next: number): TrainerMovePools | undefined {
  if (!pools || previous === next) return pools;
  const result = structuredClone(pools);
  const alternatives = result[slot]?.alternatives;
  const index = alternatives?.findIndex((option) => option.move === next) ?? -1;
  if (alternatives && index >= 0) {
    if (previous && !alternatives.some((option) => option.move === previous)) alternatives[index]!.move = previous;
    else alternatives.splice(index, 1);
  }
  return hasMoveAlternatives(result) ? result : undefined;
}

/** Drop alternatives that repeat their slot's own move, as after filling in level-up moves. */
export function withoutOwnMoves(pools: TrainerMovePools | undefined, moves: readonly number[]): TrainerMovePools | undefined {
  if (!pools) return pools;
  const result = pools.map((slot, index) => ({ ...slot, alternatives: slot.alternatives.filter((option) => option.move !== (moves[index] ?? 0)) }));
  return hasMoveAlternatives(result) ? result : undefined;
}
