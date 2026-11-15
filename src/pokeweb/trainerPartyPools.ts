import { readTrainerMemberSettings, validTrainerMemberSettings, writeTrainerMemberSettings, type TrainerMemberSettings } from "./trainerMemberSettings";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export const TRAINER_POOLS_PATH = "battle/trainer-party-pools.bin";
export const TRAINER_POOL_MAX_ID = 255;
export const TRAINER_PARTY_MAX_ID = 0x3fff;
export const TRAINER_POOL_MAX_MEMBERS = 32;
export const TRAINER_POOL_GROUPS = ["A", "B", "C", "D", "E", "F"] as const;
export const trainerPoolGroupBit = (group: number) => 1 << (group - 1);
export const TRAINER_POOL_ROLES = ["Any slot", "Lead", "Ace"] as const;
export const TRAINER_POOL_SPECIES_RULES = ["Allow repeats", "Unique species", "Unique species/form pairs"] as const;

const POOL_FLAG = 0x8000;
const MAGIC = 0x50545750;
const HEADER = 16;
const POOL = 16;
const MEMBER = 10;
const DIRECT_MEMBER = 28;
const SLOT_MEMBER = 29;
const SLOT_COUNT = TRAINER_POOL_GROUPS.length;

export const isTrainerPoolSource = (id: number) => Number.isInteger(id) && id > POOL_FLAG && id <= POOL_FLAG + TRAINER_PARTY_MAX_ID;
export const trainerPoolSource = (poolId: number) => POOL_FLAG + poolId;
export const trainerPoolId = (source: number) => source - POOL_FLAG;
export const isFixedTrainerPartySource = (source: number) => isTrainerPoolSource(source) && trainerPoolId(source) > TRAINER_POOL_MAX_ID;
export const trainerPartyLabel = (id: number) => id > TRAINER_POOL_MAX_ID ? `Alternate party ${id - TRAINER_POOL_MAX_ID}` : `Pool #${id}`;

export type TrainerPoolReference = { trainerId: number; slot: number; role: number; groups?: number };
export type TrainerPoolPokemon = {
  species: number; form: number; item: number;
  level: number; ivs: number; ability: number; gender: number; nature: number;
  moves: number[];
  settings: TrainerMemberSettings;
};
export type TrainerPoolMember = TrainerPoolReference | { role: number; groups?: number; pokemon: TrainerPoolPokemon };
export type TrainerPartyPool = {
  owner?: number;
  slotGroups?: number[];
  size: number;
  roleSlots: number;
  speciesRule: number;
  itemClause: boolean;
  itemExceptions: number[];
  members: TrainerPoolMember[];
};

type MemberData = { template: number; species: number; form: number; item: number };
type PoolEntry = Omit<TrainerPartyPool, "members"> & {
  members: Array<TrainerPoolMember & MemberData>;
  leads: number;
  aces: number;
  fallback: number[];
};

const within = (n: number, min: number, max: number) => Number.isInteger(n) && min <= n && n <= max;

const pokemonTemplate = (pokemon: TrainerPoolPokemon) => Number(pokemon.moves.some(Boolean)) | (pokemon.item ? 2 : 0);

function validPoolPokemon(pokemon: TrainerPoolPokemon): boolean {
  return within(pokemon.species, 1, 2047) && within(pokemon.form, 0, 31) && within(pokemon.item, 0, 65535)
    && within(pokemon.level, 1, 100) && within(pokemon.ivs, 0, 255) && within(pokemon.ability, 0, 15)
    && within(pokemon.gender, 0, 2) && within(pokemon.nature, 0, 25)
    && pokemon.moves.length === 4 && pokemon.moves.every(move => within(move, 0, 65535))
    && validTrainerMemberSettings(pokemon.settings);
}

type SlotCandidate = Pick<MemberData, "species" | "form" | "item"> & { groups?: number };
type SlotRules = Pick<TrainerPartyPool, "slotGroups" | "speciesRule" | "itemClause" | "itemExceptions">;

function bitCount(mask: number): number {
  let count = 0;
  for (; mask; mask &= mask - 1) ++count;
  return count;
}

/** Prove a legal lineup, or sample one with a fresh candidate shuffle for each slot. */
export function findSlotPoolTeam(pool: SlotRules, members: readonly SlotCandidate[], random?: () => number): number[] | undefined {
  const slotGroups = pool.slotGroups;
  if (!slotGroups?.length || slotGroups.length > SLOT_COUNT || slotGroups.some(group => !within(group, 1, SLOT_COUNT))
    || members.length > TRAINER_POOL_MAX_MEMBERS) return undefined;
  const exceptions = new Set(pool.itemExceptions);
  const species = members.map(member => pool.speciesRule === 2 ? member.species * 65536 + member.form : member.species);
  const items = members.map(member => pool.itemClause && !exceptions.has(member.item) ? member.item : 0);
  const options = slotGroups.map(group => members.reduce((mask, member, i) =>
    (member.groups ?? 0) & trainerPoolGroupBit(group) ? mask | (1 << i) : mask, 0));
  const conflicts = members.map((_member, i) => members.reduce((mask, _other, j) =>
    i === j || (pool.speciesRule && species[i] === species[j]) || (items[i] && items[i] === items[j]) ? mask | (1 << j) : mask, 0));
  const chosen: number[] = [];
  const allSlots = (1 << slotGroups.length) - 1;
  const failed = new Map<number, Set<number>>();

  // Proving the pool works can start with the tightest slot. Remember equivalent failed partial assignments.
  function prove(remaining: number, blocked: number): boolean {
    if (!remaining) return true;
    let misses = failed.get(remaining);
    if (misses?.has(blocked)) return false;
    let slot = 0, available = 0, union = 0, smallest = TRAINER_POOL_MAX_MEMBERS + 1;
    for (let i = 0; i < options.length; ++i) {
      if (!(remaining & (1 << i))) continue;
      const choices = options[i] & ~blocked;
      const count = bitCount(choices);
      if (!count) return false;
      if (count < smallest) {
        slot = i;
        available = choices;
        smallest = count;
      }
      union |= choices;
    }
    if (bitCount(union) < bitCount(remaining)) return false;
    for (let choices = available; choices; choices &= choices - 1) {
      const index = 31 - Math.clz32(choices & -choices);
      chosen[slot] = index;
      if (prove(remaining & ~(1 << slot), blocked | conflicts[index])) return true;
    }
    if (!misses) {
      misses = new Set();
      failed.set(remaining, misses);
    }
    misses.add(blocked);
    return false;
  }

  if (random) {
    // A slot gets its own order even when another slot uses the same group.
    const orders = options.map((mask) => {
      const order: number[] = [];
      for (let choices = mask; choices; choices &= choices - 1) {
        const index = 31 - Math.clz32(choices & -choices);
        const last = order.length;
        const position = last ? Math.floor(random() * (last + 1)) : 0;
        if (position !== last) order[last] = order[position];
        order[position] = index;
      }
      return order;
    });
    let budget = 4096;
    function sample(slot: number, blocked: number): boolean {
      if (slot === orders.length) return true;
      if (!(options[slot] & ~blocked)) return false;
      for (const index of orders[slot]) {
        if (budget-- <= 0) return false;
        if (blocked & (1 << index)) continue;
        chosen[slot] = index;
        if (sample(slot + 1, blocked | conflicts[index])) return true;
      }
      return false;
    }
    if (sample(0, 0)) return chosen;
  }
  return prove(allSlots, 0) ? chosen : undefined;
}

export function compileTrainerPool(id: number, pool: TrainerPartyPool, resolve: (member: TrainerPoolReference) => MemberData): PoolEntry {
  const { owner, size, roleSlots, speciesRule, itemClause, itemExceptions, slotGroups } = pool;
  const label = trainerPartyLabel(id);
  const fixed = id > TRAINER_POOL_MAX_ID;
  if (fixed && (!within(owner ?? 0, 1, 0x4ff) || !within(size, 1, 6) || size !== pool.members.length || slotGroups || speciesRule || itemClause || itemExceptions.length
    || pool.members.some(member => member.role || !("pokemon" in member))))
    throw new Error(`${label} needs one to six Pokémon in party order.`);
  if ((!fixed && owner !== undefined) || !within(id, 1, TRAINER_PARTY_MAX_ID) || !within(size, 1, 6) || !within(roleSlots, 1, 2) || !within(speciesRule, 0, 2)
    || typeof itemClause !== "boolean" || !within(pool.members.length, size, TRAINER_POOL_MAX_MEMBERS))
    throw new Error(`${label} needs a party size of 1–6 and enough candidates (up to ${TRAINER_POOL_MAX_MEMBERS}).`);
  if (itemExceptions.length > TRAINER_POOL_MAX_MEMBERS || itemExceptions.some(item => !within(item, 1, 65535))
    || new Set(itemExceptions).size !== itemExceptions.length)
    throw new Error(`${label} needs distinct held item exception IDs from 1 to 65,535.`);

  if (slotGroups && (slotGroups.length !== size || slotGroups.some(group => !within(group, 1, SLOT_COUNT))))
    throw new Error(`${label} needs a group for every party slot.`);
  const seen = new Set<number>();
  const members = pool.members.map(member => {
    const { role, groups } = member;
    if (!within(groups ?? 0, 0, slotGroups ? (1 << SLOT_COUNT) - 1 : 0))
      throw new Error(`${label} has invalid candidate groups.`);
    const membership = slotGroups && groups ? { groups } : {};
    if (!within(role, 0, 2)) throw new Error(`${label} needs valid candidate tags.`);
    if ("pokemon" in member) {
      const pokemon = member.pokemon;
      if (!validPoolPokemon(pokemon)) throw new Error(`${label} has invalid Pokémon settings.`);
      return { role, ...membership, pokemon, species: pokemon.species, form: pokemon.form, item: pokemon.item, template: pokemonTemplate(pokemon) };
    }
    const { trainerId, slot } = member;
    const key = trainerId * 6 + slot;
    if (!within(trainerId, 1, 0x4ff) || !within(slot, 0, 5) || seen.has(key))
      throw new Error(`${label} needs distinct trainer Pokémon slots.`);
    seen.add(key);
    const data = resolve(member);
    if (!within(data.species, 1, 65535) || !within(data.template, 0, 3) || !within(data.form, 0, 65535) || !within(data.item, 0, 65535))
      throw new Error(`${label} has invalid Pokémon data for trainer #${trainerId}, slot ${slot + 1}.`);
    return { trainerId, slot, role, ...membership, ...data };
  });

  if (fixed) return { owner, size, roleSlots, speciesRule, itemClause, itemExceptions, members, leads: 0, aces: 0,
    fallback: members.map((_member, index) => index) };

  if (slotGroups) {
    const fallback = findSlotPoolTeam(pool, members);
    if (!fallback) throw new Error(`${label} can't fill every slot with its groups and duplicate rules.`);
    return { slotGroups, size, roleSlots, speciesRule, itemClause, itemExceptions, members, leads: 0, aces: 0, fallback };
  }

  const groups = [0, 1, 2].map(role => members.flatMap((member, i) => member.role === role ? [i] : []));
  const exceptions = new Set(itemExceptions);
  // The same role's slots are interchangeable. Visit combinations once while
  // proving the configuration can generate a legal party.
  const findTeam = (leads: number, aces: number) => {
    const counts = [size - leads - aces, leads, aces];
    if (counts.some((needed, role) => needed > groups[role].length)) return undefined;
    const picks: number[][] = [[], [], []];
    const species = new Set<number>(), items = new Set<number>();
    const roles = [1, 2, 0].filter(role => counts[role]);
    function search(group: number, start: number): boolean {
      if (group === roles.length) return true;
      const role = roles[group];
      const remaining = counts[role] - picks[role].length;
      if (!remaining) return search(group + 1, 0);
      const candidates = groups[role];
      for (let i = start; i <= candidates.length - remaining; ++i) {
        const member = members[candidates[i]];
        const speciesKey = speciesRule === 2 ? member.species * 65536 + member.form : member.species;
        const item = itemClause && !exceptions.has(member.item) ? member.item : 0;
        if ((speciesRule && species.has(speciesKey)) || (item && items.has(item))) continue;
        if (speciesRule) species.add(speciesKey);
        if (item) items.add(item);
        picks[role].push(candidates[i]);
        if (search(group, i + 1)) return true;
        picks[role].pop();
        species.delete(speciesKey);
        if (item) items.delete(item);
      }
      return false;
    }
    return search(0, 0) ? [...picks[1], ...picks[0], ...picks[2]] : undefined;
  };

  const minLead = groups[1].length ? 1 : 0;
  const minAce = groups[2].length && size > minLead ? 1 : 0;
  const maxLead = Math.min(groups[1].length, roleSlots, size - minAce);
  const maxAce = Math.min(groups[2].length, roleSlots, size - minLead);
  for (let tagged = Math.min(size, maxLead + maxAce); tagged >= minLead + minAce; --tagged) {
    for (let leads = Math.min(tagged, maxLead); leads >= minLead; --leads) {
      const aces = tagged - leads;
      if (aces < minAce || aces > maxAce) continue;
      const fallback = findTeam(leads, aces);
      if (fallback) return { size, roleSlots, speciesRule, itemClause, itemExceptions, members, leads, aces, fallback };
    }
  }
  throw new Error(`${label} cannot fill ${size} slots with its tags and duplicate rules.`);
}

export function decodeTrainerPools(bytes?: Uint8Array): Map<number, PoolEntry> {
  const pools = new Map<number, PoolEntry>();
  if (!bytes) return pools;
  const fail = () => new Error("Invalid trainer party pool data.");
  const version = readU16(bytes, 4), entrySize = readU16(bytes, 6);
  const slotFormat = version === 4;
  const rowHeader = POOL + (slotFormat ? SLOT_COUNT : 0);
  const expectedSize = slotFormat ? SLOT_MEMBER : version === 2 || version === 3 ? DIRECT_MEMBER : version === 1 ? MEMBER : 0;
  if (bytes.length < HEADER + 4 || readU32(bytes, 0) !== MAGIC || !expectedSize || entrySize !== expectedSize) throw fail();
  const count = readU32(bytes, 8), payload = readU32(bytes, 12);
  const directoryEnd = HEADER + (count + 1) * 4;
  if (count > (version >= 3 ? TRAINER_PARTY_MAX_ID : TRAINER_POOL_MAX_ID) + 1 || directoryEnd + payload !== bytes.length || readU32(bytes, HEADER) !== 0
    || readU32(bytes, directoryEnd - 4) !== payload) throw fail();

  for (let id = 0; id < count; ++id) {
    const start = readU32(bytes, HEADER + id * 4), end = readU32(bytes, HEADER + (id + 1) * 4);
    if (end < start || end > payload) throw fail();
    if (end === start) continue;
    const at = directoryEnd + start;
    if (!id || end - start < rowHeader) throw fail();
    const [size, memberCount, speciesRule, itemClause, roleSlots, exceptionCount, leads, aces] = bytes.subarray(at, at + 8);
    const owner = readU16(bytes, at + 14);
    const fixed = id > TRAINER_POOL_MAX_ID;
    const slots = slotFormat ? Array.from(bytes.subarray(at + POOL, at + rowHeader)) : [];
    const slotGroups = slots.some(Boolean) ? slots.slice(0, size) : undefined;
    if (slotGroups && (fixed || leads || aces || slotGroups.some(group => !within(group, 1, SLOT_COUNT))
      || slots.slice(size).some(Boolean))) throw fail();
    const fallback = Array.from(bytes.subarray(at + 8, at + 8 + size));
    if (fixed ? !within(owner, 1, 0x4ff) || size !== memberCount || speciesRule || itemClause || exceptionCount
      || leads || aces || fallback.some((index, slot) => index !== slot) : owner !== 0) throw fail();
    if (!within(size, 1, 6) || !within(memberCount, size, TRAINER_POOL_MAX_MEMBERS) || speciesRule > 2 || itemClause > 1
      || !within(roleSlots, 1, 2) || exceptionCount > TRAINER_POOL_MAX_MEMBERS || leads > roleSlots || aces > roleSlots || leads + aces > size
      || end - start !== rowHeader + exceptionCount * 2 + memberCount * entrySize
      || new Set(fallback).size !== size || fallback.some(index => index >= memberCount)) throw fail();
    let offset = at + rowHeader;
    const itemExceptions = Array.from({ length: exceptionCount }, () => {
      const item = readU16(bytes, offset);
      offset += 2;
      return item;
    });
    if (itemExceptions.includes(0) || new Set(itemExceptions).size !== exceptionCount) throw fail();
    const seen = new Set<number>();
    const members = Array.from({ length: memberCount }, () => {
      const trainerId = readU16(bytes, offset);
      const packed = bytes[offset + 2], slot = packed & 7, role = packed >> 3;
      const template = bytes[offset + 3], species = readU16(bytes, offset + 4), form = readU16(bytes, offset + 6), item = readU16(bytes, offset + 8);
      const at = offset;
      const groups = slotFormat ? bytes[at + DIRECT_MEMBER] : 0;
      if (!within(groups, 0, slotGroups ? (1 << SLOT_COUNT) - 1 : 0)) throw fail();
      const membership = groups ? { groups } : {};
      offset += entrySize;
      if (slot > 5 || role > 2 || template > 3 || !species || (fixed && (role || trainerId))) throw fail();
      if (version >= 2 && trainerId === 0) {
        const pokemon = {
          species, form, item,
          ivs: bytes[at + 10], ability: bytes[at + 11] >> 4, gender: bytes[at + 11] & 15,
          level: bytes[at + 12], nature: bytes[at + 13],
          moves: Array.from({ length: 4 }, (_, move) => readU16(bytes, at + 14 + move * 2)),
          settings: readTrainerMemberSettings(bytes, at + 22),
        };
        if (slot || !validPoolPokemon(pokemon) || template !== pokemonTemplate(pokemon)) throw fail();
        return { role, ...membership, pokemon, template, species, form, item };
      }
      const key = trainerId * 6 + slot;
      if (!within(trainerId, 1, 0x4ff) || seen.has(key)) throw fail();
      seen.add(key);
      return { trainerId, slot, role, ...membership, template, species, form, item };
    });
    if (slotGroups?.some((group, slot) => !((members[fallback[slot]].groups ?? 0) & trainerPoolGroupBit(group)))) throw fail();
    pools.set(id, { ...(fixed ? { owner } : {}), ...(slotGroups ? { slotGroups } : {}), size, roleSlots, speciesRule, itemClause: itemClause === 1, itemExceptions, members, leads, aces, fallback });
  }
  return pools;
}

export function encodeTrainerPools(pools: ReadonlyMap<number, PoolEntry>): Uint8Array {
  const count = Math.max(-1, ...pools.keys()) + 1;
  const directoryEnd = HEADER + (count + 1) * 4;
  const hasDirect = [...pools.values()].some(pool => pool.members.some(member => "pokemon" in member));
  const hasSlots = [...pools.values()].some(pool => pool.slotGroups);
  const rowHeader = POOL + (hasSlots ? SLOT_COUNT : 0);
  const entrySize = hasSlots ? SLOT_MEMBER : hasDirect ? DIRECT_MEMBER : MEMBER;
  const payload = [...pools.values()].reduce((sum, pool) => sum + rowHeader + pool.itemExceptions.length * 2 + pool.members.length * entrySize, 0);
  const bytes = new Uint8Array(directoryEnd + payload);
  writeU32(bytes, 0, MAGIC);
  writeU16(bytes, 4, hasSlots ? 4 : count > TRAINER_POOL_MAX_ID + 1 ? 3 : hasDirect ? 2 : 1);
  writeU16(bytes, 6, entrySize);
  writeU32(bytes, 8, count);
  writeU32(bytes, 12, payload);
  let at = directoryEnd;
  for (let id = 0; id < count; ++id) {
    writeU32(bytes, HEADER + id * 4, at - directoryEnd);
    const pool = pools.get(id);
    if (!pool) continue;
    bytes.set([pool.size, pool.members.length, pool.speciesRule, Number(pool.itemClause), pool.roleSlots, pool.itemExceptions.length,
      pool.leads, pool.aces, ...pool.fallback], at);
    writeU16(bytes, at + 14, pool.owner ?? 0);
    if (pool.slotGroups) bytes.set(pool.slotGroups, at + POOL);
    at += rowHeader;
    for (const item of pool.itemExceptions) {
      writeU16(bytes, at, item);
      at += 2;
    }
    for (const member of pool.members) {
      const linked = "trainerId" in member;
      writeU16(bytes, at, linked ? member.trainerId : 0);
      bytes[at + 2] = (linked ? member.slot : 0) | (member.role << 3);
      bytes[at + 3] = member.template;
      writeU16(bytes, at + 4, member.species);
      writeU16(bytes, at + 6, member.form);
      writeU16(bytes, at + 8, member.item);
      if ("pokemon" in member) {
        const { ivs, ability, gender, level, nature, moves, settings } = member.pokemon;
        bytes.set([ivs, (ability << 4) | gender, level, nature], at + 10);
        moves.forEach((move, index) => writeU16(bytes, at + 14 + index * 2, move));
        writeTrainerMemberSettings(bytes, at + 22, settings);
      }
      if (hasSlots) bytes[at + DIRECT_MEMBER] = member.groups ?? 0;
      at += entrySize;
    }
  }
  writeU32(bytes, directoryEnd - 4, payload);
  return bytes;
}
