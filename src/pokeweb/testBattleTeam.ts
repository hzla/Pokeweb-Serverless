import { NATURES, type BaseRom } from "./constants";
import { findPokemonSpeciesId, pokemonSpeciesLabel } from "./pokemonLabels";
import { decodeRecord, type ProjectState, type RawRecord } from "./projectStore";

const TEST_BATTLE_PARTY_BLOCK_OFFSET = 0x18e00;
const TEST_BATTLE_PARTY_BLOCK_LENGTH = 0x534;
const TEST_BATTLE_PARTY_CHECKSUM_OFFSET = 0x19336;
const TEST_BATTLE_PARTY_CHECKSUM_INDEX = 26;
const BW2_PLAYER_DATA_BLOCK_OFFSET = 0x19400;
const BW_CHECKSUM_BLOCK_OFFSET = 0x23f00;
const BW_CHECKSUM_BLOCK_LENGTH = 0x8c;
const BW_CHECKSUM_BLOCK_CHECKSUM_OFFSET = 0x23f9a;
const BW_SAVE_HALF_OFFSET = 0x24000;
const BW2_CHECKSUM_BLOCK_OFFSET = 0x25f00;
const BW2_CHECKSUM_BLOCK_LENGTH = 0x94;
const BW2_CHECKSUM_BLOCK_CHECKSUM_OFFSET = 0x25fa2;
const BW2_SAVE_HALF_OFFSET = 0x26000;
const PK5_PARTY_SIZE = 220;
const PK5_STORED_SIZE = 136;
const PK5_BLOCK_SIZE = 32;
const PK5_NICKNAME_OFFSET = 0x48;
const PK5_NICKNAME_BYTES = 22;
const PK5_NICKNAME_MAX_CHARS = 10;
const PK5_STRING_TERMINATOR = 0xffff;
const PK5_IS_NICKNAMED_FLAG = 0x80000000;
const MAX_PARTY_SIZE = 6;

const BLOCK_POSITION = [
  0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2,
  0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
  2, 0, 1, 3, 3, 0, 1, 2, 2, 0, 3, 1, 3, 0, 2, 1,
  1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2,
  2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0,
  2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0,
  0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2,
  0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
];

const BLOCK_POSITION_INVERT = [
  0, 1, 2, 4, 3, 5, 6, 7,
  12, 18, 13, 19, 8, 10, 14, 20,
  16, 22, 9, 11, 15, 21, 17, 23,
  0, 1, 2, 4, 3, 5, 6, 7,
];

const STAT_KEYS = ["hp", "atk", "def", "spe", "spa", "spd"] as const;
const NATURE_STAT_KEYS = ["atk", "def", "spe", "spa", "spd"] as const;

type StatKey = (typeof STAT_KEYS)[number];

export type ShowdownPokemon = {
  speciesId: number;
  speciesName: string;
  itemId: number;
  abilitySlot: 1 | 2 | 3;
  abilityId: number;
  level: number;
  nature: number;
  gender: 0 | 1 | 2;
  evs: Record<StatKey, number>;
  ivs: Record<StatKey, number>;
  moves: number[];
};

type DraftPokemon = {
  speciesText: string;
  itemText?: string;
  abilityText?: string;
  level?: number;
  nature?: string;
  gender?: "M" | "F";
  evs: Partial<Record<StatKey, number>>;
  ivs: Partial<Record<StatKey, number>>;
  moves: string[];
};

type SaveTrainerIdentity = {
  otNameBytes: Uint8Array;
  id32: number;
  language: number;
  version: number;
  gender: number;
};

type TestBattlePartySaveLayout = {
  saveHalfOffset: number;
  checksumBlockOffset: number;
  checksumBlockLength: number;
  checksumBlockChecksumOffset: number;
};

export function parseShowdownTeam(project: ProjectState, text: string): ShowdownPokemon[] {
  const drafts = parseShowdownDrafts(text).slice(0, MAX_PARTY_SIZE);
  return drafts.map((draft) => resolveDraftPokemon(project, draft));
}

export function patchTestBattleSavePlayerParty(saveBytes: Uint8Array, project: ProjectState, playerTeamText: string, baseRom: BaseRom = "BW2"): Uint8Array {
  const team = parseShowdownTeam(project, playerTeamText);
  if (team.length === 0) return saveBytes;

  const layout = getTestBattlePartySaveLayout(baseRom);
  const out = saveBytes.slice();
  patchPartyHalf(out, layout, 0, project, team);
  if (hasSaveHalf(out, layout)) {
    patchPartyHalf(out, layout, layout.saveHalfOffset, project, team);
  }
  return out;
}

export function patchTestBattleSavePlayerFirstPokemon(saveBytes: Uint8Array, project: ProjectState, pokemonText: string, baseRom: BaseRom = "BW2"): Uint8Array {
  const pokemon = parseShowdownTeam(project, pokemonText)[0];
  if (!pokemon) return saveBytes;

  const layout = getTestBattlePartySaveLayout(baseRom);
  const out = saveBytes.slice();
  patchFirstPartyPokemonHalf(out, layout, 0, project, pokemon);
  if (hasSaveHalf(out, layout)) {
    patchFirstPartyPokemonHalf(out, layout, layout.saveHalfOffset, project, pokemon);
  }
  return out;
}

export function patchTestBattleSavePlayerFirstMove(saveBytes: Uint8Array, project: ProjectState, moveId: number, baseRom: BaseRom = "BW2"): Uint8Array {
  if (!Number.isInteger(moveId) || moveId < 0 || moveId > 0xffff) throw new Error(`Invalid move ID: ${moveId}`);
  const layout = getTestBattlePartySaveLayout(baseRom);
  const out = saveBytes.slice();
  patchFirstPartyMoveHalf(out, layout, 0, project, moveId);
  if (hasSaveHalf(out, layout)) {
    patchFirstPartyMoveHalf(out, layout, layout.saveHalfOffset, project, moveId);
  }
  return out;
}

export function normalizeTestBattleSavePartyNicknames(saveBytes: Uint8Array, project: ProjectState, baseRom: BaseRom = "BW2"): Uint8Array {
  const layout = getTestBattlePartySaveLayout(baseRom);
  const out = saveBytes.slice();
  let changed = normalizePartyNicknamesHalf(out, layout, 0, project);
  if (hasSaveHalf(out, layout)) {
    changed = normalizePartyNicknamesHalf(out, layout, layout.saveHalfOffset, project) || changed;
  }
  return changed ? out : saveBytes;
}

export function decryptPk5Party(encrypted: Uint8Array): Uint8Array {
  const out = encrypted.slice(0, PK5_PARTY_SIZE);
  const pid = readLe32(out, 0);
  const checksum = readLe16(out, 6);
  const shuffleValue = (pid >>> 13) & 31;
  cryptArray(out, 8, PK5_STORED_SIZE - 8, checksum);
  cryptArray(out, PK5_STORED_SIZE, PK5_PARTY_SIZE - PK5_STORED_SIZE, pid);
  shuffle45(out, 8, shuffleValue);
  return out;
}

export function encryptPk5Party(decrypted: Uint8Array): Uint8Array {
  const out = decrypted.slice(0, PK5_PARTY_SIZE);
  writeLe16(out, 6, add16(out.subarray(8, PK5_STORED_SIZE)));
  const pid = readLe32(out, 0);
  const checksum = readLe16(out, 6);
  const shuffleValue = BLOCK_POSITION_INVERT[(pid >>> 13) & 31] ?? 0;
  shuffle45(out, 8, shuffleValue);
  cryptArray(out, 8, PK5_STORED_SIZE - 8, checksum);
  cryptArray(out, PK5_STORED_SIZE, PK5_PARTY_SIZE - PK5_STORED_SIZE, pid);
  return out;
}

function parseShowdownDrafts(text: string): DraftPokemon[] {
  const blocks = text
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map(parseShowdownDraft);
}

function parseShowdownDraft(block: string): DraftPokemon {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) throw new Error("Showdown import contains an empty Pokemon set.");

  const draft = parseShowdownHeader(lines[0]);
  draft.evs = {};
  draft.ivs = {};
  draft.moves = [];

  for (const line of lines.slice(1)) {
    if (line.startsWith("-")) {
      const move = line.replace(/^-\s*/u, "").trim();
      if (move && draft.moves.length < 4) draft.moves.push(move);
      continue;
    }

    const ability = /^Ability:\s*(.+)$/iu.exec(line);
    if (ability) {
      draft.abilityText = ability[1].trim();
      continue;
    }

    const level = /^Level:\s*(\d+)$/iu.exec(line);
    if (level) {
      draft.level = clampInt(Number(level[1]), 1, 100);
      continue;
    }

    const evs = /^EVs:\s*(.+)$/iu.exec(line);
    if (evs) {
      draft.evs = parseStatList(evs[1], 0, 255, "EV");
      continue;
    }

    const ivs = /^IVs:\s*(.+)$/iu.exec(line);
    if (ivs) {
      draft.ivs = parseStatList(ivs[1], 0, 31, "IV");
      continue;
    }

    const nature = /^([A-Za-z]+)\s+Nature$/iu.exec(line);
    if (nature) draft.nature = nature[1];
  }

  return draft;
}

function parseShowdownHeader(line: string): DraftPokemon {
  const [beforeItem, itemText] = splitAtLastAt(line);
  const genderMatch = /\s+\((M|F)\)\s*$/iu.exec(beforeItem);
  const gender = genderMatch?.[1].toUpperCase() as "M" | "F" | undefined;
  const namePart = genderMatch ? beforeItem.slice(0, genderMatch.index).trim() : beforeItem.trim();
  const speciesMatch = /\(([^()]*)\)\s*$/u.exec(namePart);
  const speciesText = (speciesMatch?.[1] ?? namePart).trim();
  if (!speciesText) throw new Error(`Could not read Pokemon species from: ${line}`);
  return {
    speciesText,
    itemText: itemText?.trim(),
    gender,
    evs: {},
    ivs: {},
    moves: [],
  };
}

function splitAtLastAt(line: string): [string, string | undefined] {
  const index = line.lastIndexOf("@");
  if (index < 0) return [line.trim(), undefined];
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseStatList(text: string, min: number, max: number, label: string): Partial<Record<StatKey, number>> {
  const stats: Partial<Record<StatKey, number>> = {};
  for (const part of text.split("/")) {
    const match = /^\s*(\d+)\s*(HP|Atk|Def|SpA|SpD|Spe)\s*$/iu.exec(part);
    if (!match) throw new Error(`Invalid ${label} entry: ${part.trim()}`);
    const key = statKey(match[2]);
    stats[key] = clampInt(Number(match[1]), min, max);
  }
  return stats;
}

function resolveDraftPokemon(project: ProjectState, draft: DraftPokemon): ShowdownPokemon {
  const speciesId = findPokemonSpeciesId(project, draft.speciesText);
  const personal = getPersonal(project, speciesId);
  const itemId = draft.itemText ? resolveItemId(project, draft.itemText) : 0;
  const ability = resolveAbility(project, personal, draft.abilityText);
  const level = draft.level ?? 100;
  const nature = resolveNature(draft.nature);
  const gender = resolveGender(personal, draft.gender);
  const evs = defaultStats(0);
  const ivs = defaultStats(31);
  Object.assign(evs, draft.evs);
  Object.assign(ivs, draft.ivs);
  const moves = draft.moves.map((move) => resolveMoveId(project, move));

  return {
    speciesId,
    speciesName: pokemonSpeciesLabel(project, speciesId),
    itemId,
    abilitySlot: ability.slot,
    abilityId: ability.id,
    level,
    nature,
    gender,
    evs,
    ivs,
    moves,
  };
}

function resolveItemId(project: ProjectState, text: string): number {
  if (normalizeName(text) === "none" || normalizeName(text) === "noitem") return 0;
  return resolveNamedId(project.texts.banks.items ?? [], text, "item");
}

function resolveMoveId(project: ProjectState, text: string): number {
  return resolveNamedId(project.texts.banks.moves ?? [], text, "move");
}

function resolveNamedId(values: string[], input: string, label: string): number {
  const numeric = Number(input.trim());
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  const normalized = normalizeName(input);
  const index = values.findIndex((value) => normalizeName(value) === normalized);
  if (index < 0) throw new Error(`Unknown ${label}: ${input}`);
  return index;
}

function resolveAbility(project: ProjectState, personal: RawRecord, abilityText?: string): { slot: 1 | 2 | 3; id: number } {
  if (!abilityText) return { slot: 1, id: Number(personal.ability_1 ?? 0) };
  const numeric = Number(abilityText.trim());
  if (Number.isInteger(numeric) && numeric >= 0) {
    for (const slot of [1, 2, 3] as const) {
      if (Number(personal[`ability_${slot}`] ?? 0) === numeric) return { slot, id: numeric };
    }
    return { slot: 1, id: numeric };
  }

  const abilityNames = project.texts.banks.abilities ?? [];
  const normalized = normalizeName(abilityText);
  for (const slot of [1, 2, 3] as const) {
    const id = Number(personal[`ability_${slot}`] ?? 0);
    if (normalizeName(abilityNames[id] ?? String(id)) === normalized) return { slot, id };
  }
  return { slot: 1, id: resolveNamedId(abilityNames, abilityText, "ability") };
}

function resolveNature(natureText?: string): number {
  if (!natureText) return 0;
  const index = NATURES.findIndex((nature) => normalizeName(nature) === normalizeName(natureText));
  if (index < 0) throw new Error(`Unknown nature: ${natureText}`);
  return index;
}

function resolveGender(personal: RawRecord, gender?: "M" | "F"): 0 | 1 | 2 {
  if (gender === "M") return 0;
  if (gender === "F") return 1;
  const ratio = Number(personal.gender ?? 127);
  if (ratio === 255) return 2;
  if (ratio === 254) return 1;
  return 0;
}

function patchFirstPartyMoveHalf(out: Uint8Array, layout: TestBattlePartySaveLayout, halfOffset: number, project: ProjectState, moveId: number): void {
  const partyOffset = halfOffset + TEST_BATTLE_PARTY_BLOCK_OFFSET;
  const partyCount = out[partyOffset + 4] ?? out[partyOffset] ?? 0;
  if (partyCount < 1) throw new Error("The bundled test battle save does not have a party Pokemon in slot 1.");

  const slotOffset = partyOffset + 8;
  const decrypted = decryptPk5Party(out.subarray(slotOffset, slotOffset + PK5_PARTY_SIZE));
  if (readLe16(decrypted, 0x08) === 0) throw new Error("The bundled test battle save has an empty party Pokemon slot 1.");

  writeLe16(decrypted, 0x28, moveId);
  decrypted[0x30] = movePp(project, moveId);
  out.set(encryptPk5Party(decrypted), slotOffset);

  refreshPartyBlockChecksums(out, layout, halfOffset);
}

function patchFirstPartyPokemonHalf(out: Uint8Array, layout: TestBattlePartySaveLayout, halfOffset: number, project: ProjectState, pokemon: ShowdownPokemon): void {
  const partyOffset = halfOffset + TEST_BATTLE_PARTY_BLOCK_OFFSET;
  const partyCount = out[partyOffset + 4] ?? out[partyOffset] ?? 0;
  if (partyCount < 1) throw new Error("The bundled test battle save does not have a party Pokemon in slot 1.");

  const slotOffset = partyOffset + 8;
  const decrypted = decryptPk5Party(out.subarray(slotOffset, slotOffset + PK5_PARTY_SIZE));
  if (readLe16(decrypted, 0x08) === 0) throw new Error("The bundled test battle save has an empty party Pokemon slot 1.");

  const trainer = readSaveTrainerIdentity(out, halfOffset);
  const personal = getPersonal(project, pokemon.speciesId);
  applyPokemonToPk5(project, decrypted, pokemon, personal, trainer, 0);
  out.set(encryptPk5Party(decrypted), slotOffset);

  refreshPartyBlockChecksums(out, layout, halfOffset);
}

function patchPartyHalf(out: Uint8Array, layout: TestBattlePartySaveLayout, halfOffset: number, project: ProjectState, team: ShowdownPokemon[]): void {
  const partyOffset = halfOffset + TEST_BATTLE_PARTY_BLOCK_OFFSET;
  const trainer = readSaveTrainerIdentity(out, halfOffset);
  const template = firstTemplatePokemon(out, partyOffset);
  out[partyOffset] = team.length;
  out[partyOffset + 4] = team.length;

  for (let slot = 0; slot < MAX_PARTY_SIZE; slot += 1) {
    const slotOffset = partyOffset + 8 + slot * PK5_PARTY_SIZE;
    const pokemon = team[slot];
    if (!pokemon) {
      out.fill(0, slotOffset, slotOffset + PK5_PARTY_SIZE);
      continue;
    }
    const personal = getPersonal(project, pokemon.speciesId);
    const decrypted = template.slice();
    applyPokemonToPk5(project, decrypted, pokemon, personal, trainer, slot);
    out.set(encryptPk5Party(decrypted), slotOffset);
  }

  refreshPartyBlockChecksums(out, layout, halfOffset);
}

function normalizePartyNicknamesHalf(out: Uint8Array, layout: TestBattlePartySaveLayout, halfOffset: number, project: ProjectState): boolean {
  const partyOffset = halfOffset + TEST_BATTLE_PARTY_BLOCK_OFFSET;
  const partyCount = clampInt(out[partyOffset + 4] ?? out[partyOffset] ?? 0, 0, MAX_PARTY_SIZE);
  let changed = false;

  for (let slot = 0; slot < partyCount; slot += 1) {
    const slotOffset = partyOffset + 8 + slot * PK5_PARTY_SIZE;
    const decrypted = decryptPk5Party(out.subarray(slotOffset, slotOffset + PK5_PARTY_SIZE));
    const speciesId = readLe16(decrypted, 0x08);
    if (speciesId === 0) continue;

    const before = decrypted.slice();
    writeNotNicknamedSpeciesName(decrypted, speciesName(project, speciesId));
    if (bytesEqual(before, decrypted)) continue;
    out.set(encryptPk5Party(decrypted), slotOffset);
    changed = true;
  }

  if (changed) refreshPartyBlockChecksums(out, layout, halfOffset);
  return changed;
}

function getTestBattlePartySaveLayout(baseRom: BaseRom): TestBattlePartySaveLayout {
  if (baseRom === "BW") {
    return {
      saveHalfOffset: BW_SAVE_HALF_OFFSET,
      checksumBlockOffset: BW_CHECKSUM_BLOCK_OFFSET,
      checksumBlockLength: BW_CHECKSUM_BLOCK_LENGTH,
      checksumBlockChecksumOffset: BW_CHECKSUM_BLOCK_CHECKSUM_OFFSET,
    };
  }
  return {
    saveHalfOffset: BW2_SAVE_HALF_OFFSET,
    checksumBlockOffset: BW2_CHECKSUM_BLOCK_OFFSET,
    checksumBlockLength: BW2_CHECKSUM_BLOCK_LENGTH,
    checksumBlockChecksumOffset: BW2_CHECKSUM_BLOCK_CHECKSUM_OFFSET,
  };
}

function hasSaveHalf(saveBytes: Uint8Array, layout: TestBattlePartySaveLayout): boolean {
  return saveBytes.length >= layout.saveHalfOffset + layout.checksumBlockOffset + layout.checksumBlockLength;
}

function refreshPartyBlockChecksums(out: Uint8Array, layout: TestBattlePartySaveLayout, halfOffset: number): void {
  const partyChecksum = crc16Ccitt(out.subarray(halfOffset + TEST_BATTLE_PARTY_BLOCK_OFFSET, halfOffset + TEST_BATTLE_PARTY_BLOCK_OFFSET + TEST_BATTLE_PARTY_BLOCK_LENGTH));
  writeLe16(out, halfOffset + TEST_BATTLE_PARTY_CHECKSUM_OFFSET, partyChecksum);
  writeLe16(out, halfOffset + layout.checksumBlockOffset + TEST_BATTLE_PARTY_CHECKSUM_INDEX * 2, partyChecksum);
  refreshBlockChecksum(
    out,
    halfOffset + layout.checksumBlockOffset,
    layout.checksumBlockLength,
    halfOffset + layout.checksumBlockChecksumOffset,
    halfOffset + layout.checksumBlockChecksumOffset,
  );
}

function firstTemplatePokemon(saveBytes: Uint8Array, partyOffset: number): Uint8Array {
  const count = Math.min(saveBytes[partyOffset + 4] ?? 0, MAX_PARTY_SIZE);
  for (let slot = 0; slot < count; slot += 1) {
    const offset = partyOffset + 8 + slot * PK5_PARTY_SIZE;
    const decrypted = decryptPk5Party(saveBytes.subarray(offset, offset + PK5_PARTY_SIZE));
    if (readLe16(decrypted, 0x08) !== 0) return decrypted;
  }
  return new Uint8Array(PK5_PARTY_SIZE);
}

function readSaveTrainerIdentity(saveBytes: Uint8Array, halfOffset: number): SaveTrainerIdentity {
  const playerOffset = halfOffset + BW2_PLAYER_DATA_BLOCK_OFFSET;
  return {
    otNameBytes: saveBytes.slice(playerOffset + 0x04, playerOffset + 0x14),
    id32: readLe32(saveBytes, playerOffset + 0x14),
    language: saveBytes[playerOffset + 0x1e] ?? 2,
    version: saveBytes[playerOffset + 0x1f] ?? 22,
    gender: saveBytes[playerOffset + 0x21] ?? 0,
  };
}

function applyPokemonToPk5(project: ProjectState, data: Uint8Array, pokemon: ShowdownPokemon, personal: RawRecord, trainer: SaveTrainerIdentity, slot: number): void {
  const pid = makePid(pokemon, slot);
  const stats = calculateStats(pokemon, personal);
  const expRate = Number(personal.exp_rate ?? 0);
  const baseFriendship = Number(personal.base_happy ?? 70);

  writeLe32(data, 0x00, pid);
  writeLe16(data, 0x04, 0);
  writeLe16(data, 0x08, pokemon.speciesId);
  writeLe16(data, 0x0a, pokemon.itemId);
  writeLe32(data, 0x0c, trainer.id32);
  writeLe32(data, 0x10, experienceForLevel(pokemon.level, expRate));
  data[0x14] = clampInt(baseFriendship, 0, 255);
  data[0x15] = pokemon.abilityId & 0xff;
  data[0x16] = 0;
  data[0x17] = trainer.language || 2;

  data[0x18] = pokemon.evs.hp;
  data[0x19] = pokemon.evs.atk;
  data[0x1a] = pokemon.evs.def;
  data[0x1b] = pokemon.evs.spe;
  data[0x1c] = pokemon.evs.spa;
  data[0x1d] = pokemon.evs.spd;

  for (let move = 0; move < 4; move += 1) writeLe16(data, 0x28 + move * 2, pokemon.moves[move] ?? 0);
  for (let move = 0; move < 4; move += 1) data[0x30 + move] = movePp(project, pokemon.moves[move] ?? 0);
  data.fill(0, 0x34, 0x38);
  writeLe32(data, 0x38, packIvs(pokemon.ivs));
  writeNotNicknamedSpeciesName(data, pokemon.speciesName);
  data[0x40] = (pokemon.gender & 0x03) << 1;
  data[0x41] = pokemon.nature;
  data[0x42] = pokemon.abilitySlot === 3 ? 1 : 0;
  data[0x5f] = trainer.version;
  data.set(trainer.otNameBytes, 0x68);
  data[0x84] = (data[0x84] & 0x7f) | ((trainer.gender & 1) << 7);

  writeLe32(data, 0x88, 0);
  data[0x8c] = pokemon.level;
  data[0x8d] = 0;
  writeLe16(data, 0x8e, stats.hp);
  writeLe16(data, 0x90, stats.hp);
  writeLe16(data, 0x92, stats.atk);
  writeLe16(data, 0x94, stats.def);
  writeLe16(data, 0x96, stats.spe);
  writeLe16(data, 0x98, stats.spa);
  writeLe16(data, 0x9a, stats.spd);
}

function speciesName(project: ProjectState, speciesId: number): string {
  return pokemonSpeciesLabel(project, speciesId);
}

function writeNotNicknamedSpeciesName(data: Uint8Array, name: string): void {
  writeLe32(data, 0x38, readLe32(data, 0x38) & ~PK5_IS_NICKNAMED_FLAG);
  writePk5String(data, PK5_NICKNAME_OFFSET, PK5_NICKNAME_BYTES, name, PK5_NICKNAME_MAX_CHARS);
}

function writePk5String(data: Uint8Array, offset: number, byteLength: number, value: string, maxChars: number): void {
  data.fill(0, offset, offset + byteLength);
  let cursor = offset;
  const end = offset + byteLength;
  for (const char of value.slice(0, maxChars)) {
    if (cursor + 1 >= end) break;
    writeLe16(data, cursor, char.charCodeAt(0));
    cursor += 2;
  }
  if (cursor + 1 < end) writeLe16(data, cursor, PK5_STRING_TERMINATOR);
}

function makePid(pokemon: ShowdownPokemon, slot: number): number {
  let pid = (0xa5a50000 ^ (pokemon.speciesId * 0x45d9f3b) ^ (pokemon.nature << 8) ^ slot) >>> 0;
  pid = (pid & 0xffffe0ff) | ((pokemon.nature & 31) << 8);
  if (pokemon.abilitySlot === 2) pid |= 1;
  else pid &= 0xfffffffe;
  return pid >>> 0;
}

function calculateStats(pokemon: ShowdownPokemon, personal: RawRecord): Record<StatKey, number> {
  const level = pokemon.level;
  const hp = pokemon.speciesId === 292 ? 1 : Math.floor(((2 * Number(personal.base_hp ?? 1) + pokemon.ivs.hp + Math.floor(pokemon.evs.hp / 4)) * level) / 100) + level + 10;
  return {
    hp,
    atk: nonHpStat(Number(personal.base_atk ?? 1), pokemon.ivs.atk, pokemon.evs.atk, level, pokemon.nature, "atk"),
    def: nonHpStat(Number(personal.base_def ?? 1), pokemon.ivs.def, pokemon.evs.def, level, pokemon.nature, "def"),
    spe: nonHpStat(Number(personal.base_speed ?? 1), pokemon.ivs.spe, pokemon.evs.spe, level, pokemon.nature, "spe"),
    spa: nonHpStat(Number(personal.base_spatk ?? 1), pokemon.ivs.spa, pokemon.evs.spa, level, pokemon.nature, "spa"),
    spd: nonHpStat(Number(personal.base_spdef ?? 1), pokemon.ivs.spd, pokemon.evs.spd, level, pokemon.nature, "spd"),
  };
}

function nonHpStat(base: number, iv: number, ev: number, level: number, nature: number, stat: Exclude<StatKey, "hp">): number {
  const raw = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  const raised = NATURE_STAT_KEYS[Math.floor(nature / 5)];
  const lowered = NATURE_STAT_KEYS[nature % 5];
  if (raised === lowered) return raw;
  if (raised === stat) return Math.floor(raw * 1.1);
  if (lowered === stat) return Math.floor(raw * 0.9);
  return raw;
}

function experienceForLevel(level: number, growthRate: number): number {
  const n = clampInt(level, 1, 100);
  const n2 = n * n;
  const n3 = n2 * n;
  switch (growthRate) {
    case 1:
      if (n <= 50) return Math.floor((n3 * (100 - n)) / 50);
      if (n <= 68) return Math.floor((n3 * (150 - n)) / 100);
      if (n <= 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n3 * (160 - n)) / 100);
    case 2:
      if (n <= 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n <= 36) return Math.floor((n3 * (n + 14)) / 50);
      return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
    case 3:
      return Math.max(0, Math.floor((6 * n3) / 5 - 15 * n2 + 100 * n - 140));
    case 4:
      return Math.floor((4 * n3) / 5);
    case 5:
      return Math.floor((5 * n3) / 4);
    default:
      return n3;
  }
}

function movePp(project: ProjectState, moveId: number): number {
  if (moveId <= 0 || !project.narcs.moves || moveId >= project.narcs.moves.fileCount) return 0;
  const move = decodeRecord(project, "moves", moveId);
  return clampInt(Number(move.raw?.pp ?? 0), 0, 255);
}

function getPersonal(project: ProjectState, speciesId: number): RawRecord {
  if (!project.narcs.personal || speciesId <= 0 || speciesId >= project.narcs.personal.fileCount) throw new Error(`No personal data is loaded for Pokemon ${speciesId}.`);
  const personal = decodeRecord(project, "personal", speciesId);
  if (!personal.raw) throw new Error(`No personal data is loaded for Pokemon ${speciesId}.`);
  return personal.raw;
}

function defaultStats(value: number): Record<StatKey, number> {
  return { hp: value, atk: value, def: value, spe: value, spa: value, spd: value };
}

function statKey(text: string): StatKey {
  const normalized = text.toLowerCase();
  if (normalized === "hp") return "hp";
  if (normalized === "atk") return "atk";
  if (normalized === "def") return "def";
  if (normalized === "spe") return "spe";
  if (normalized === "spa") return "spa";
  return "spd";
}

function packIvs(ivs: Record<StatKey, number>): number {
  return (
    ((ivs.hp & 0x1f) << 0) |
    ((ivs.atk & 0x1f) << 5) |
    ((ivs.def & 0x1f) << 10) |
    ((ivs.spe & 0x1f) << 15) |
    ((ivs.spa & 0x1f) << 20) |
    ((ivs.spd & 0x1f) << 25)
  ) >>> 0;
}

function shuffle45(bytes: Uint8Array, offset: number, shuffleValue: number): void {
  if (shuffleValue === 0) return;
  const perm = [0, 1, 2, 3];
  const slotOf = [0, 1, 2, 3];
  const shuffleOffset = shuffleValue * 4;
  for (let index = 0; index < 3; index += 1) {
    const desired = BLOCK_POSITION[shuffleOffset + index] ?? index;
    const swapSlot = slotOf[desired] ?? index;
    if (swapSlot === index) continue;
    swapBlocks(bytes, offset + index * PK5_BLOCK_SIZE, offset + swapSlot * PK5_BLOCK_SIZE, PK5_BLOCK_SIZE);
    const blockAtIndex = perm[index] ?? index;
    perm[swapSlot] = blockAtIndex;
    slotOf[blockAtIndex] = swapSlot;
  }
}

function swapBlocks(bytes: Uint8Array, left: number, right: number, length: number): void {
  for (let index = 0; index < length; index += 1) {
    const value = bytes[left + index];
    bytes[left + index] = bytes[right + index];
    bytes[right + index] = value;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function cryptArray(bytes: Uint8Array, offset: number, length: number, seed: number): void {
  let state = seed >>> 0;
  for (let cursor = offset; cursor < offset + length; cursor += 2) {
    state = (Math.imul(0x41c64e6d, state) + 0x6073) >>> 0;
    const value = readLe16(bytes, cursor) ^ (state >>> 16);
    writeLe16(bytes, cursor, value);
  }
}

function refreshBlockChecksum(out: Uint8Array, blockOffset: number, blockLength: number, checksumOffset: number, checksumMirror: number): void {
  const checksum = crc16Ccitt(out.subarray(blockOffset, blockOffset + blockLength));
  writeLe16(out, checksumOffset, checksum);
  writeLe16(out, checksumMirror, checksum);
}

function crc16Ccitt(data: Uint8Array): number {
  let top = 0xff;
  let bottom = 0xff;
  for (const byte of data) {
    let value = byte ^ top;
    value ^= value >> 4;
    top = (bottom ^ (value >> 3) ^ (value << 4)) & 0xff;
    bottom = (value ^ (value << 5)) & 0xff;
  }
  return ((top << 8) | bottom) & 0xffff;
}

function add16(data: Uint8Array): number {
  let checksum = 0;
  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    checksum = (checksum + readLe16(data, offset)) & 0xffff;
  }
  return checksum;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function writeLe16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeLe32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}
