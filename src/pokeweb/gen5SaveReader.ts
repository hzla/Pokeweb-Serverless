import { NATURES } from "./constants";
import { pokemonSpeciesLabel } from "./pokemonLabels";
import { decodeRecord, type ProjectState, type RawRecord } from "./projectStore";
import { decryptPk5Party, decryptPk5Stored, experienceForLevel } from "./testBattleTeam";

const GEN5_SAVE_MINIMUM_SIZE = 0x19334;
const PARTY_COUNT_OFFSET = 0x18e04;
const PARTY_DATA_OFFSET = 0x18e08;
const PARTY_SLOT_SIZE = 220;
const MAX_PARTY_SIZE = 6;
const BOX_DATA_OFFSET = 0x400;
const BOX_SIZE = 0x1000;
const BOX_SLOT_SIZE = 136;
const BOX_SLOT_COUNT = 30;
const BOX_COUNT = 24;
const STORED_DATA_END = 136;

const STAT_KEYS = ["hp", "atk", "def", "spe", "spa", "spd"] as const;
type StatKey = (typeof STAT_KEYS)[number];

export type Gen5SavePokemon = {
  speciesId: number;
  formIndex: number;
  speciesName: string;
  nickname: string;
  itemId: number;
  itemName: string;
  abilityId: number;
  abilityName: string;
  level: number;
  nature: string;
  gender: "M" | "F" | "N";
  evs: Record<StatKey, number>;
  ivs: Record<StatKey, number>;
  moveIds: number[];
  moveNames: string[];
  storage: "party" | "box";
  partySlot?: number;
  box?: number;
  boxSlot?: number;
  showdownText: string;
};

export function readGen5SavePokemon(project: ProjectState, saveBytes: Uint8Array): Gen5SavePokemon[] {
  if (saveBytes.length < GEN5_SAVE_MINIMUM_SIZE) {
    throw new Error("This file is too small to be a Generation 5 save.");
  }
  if (!project.narcs.personal) {
    throw new Error("Load a ROM with Pokemon personal data before reading a save.");
  }

  const pokemon: Gen5SavePokemon[] = [];
  const partyCount = Math.min(MAX_PARTY_SIZE, saveBytes[PARTY_COUNT_OFFSET] ?? 0);
  for (let partySlot = 0; partySlot < partyCount; partySlot += 1) {
    const offset = PARTY_DATA_OFFSET + partySlot * PARTY_SLOT_SIZE;
    const encrypted = saveBytes.subarray(offset, offset + PARTY_SLOT_SIZE);
    if (isEmptySlot(encrypted)) continue;
    const decrypted = decryptPk5Party(encrypted);
    const parsed = parsePokemon(project, decrypted, {
      storage: "party",
      partySlot,
      partyLevel: decrypted[0x8c],
    });
    if (parsed) pokemon.push(parsed);
  }

  for (let boxIndex = 0; boxIndex < BOX_COUNT; boxIndex += 1) {
    const boxOffset = BOX_DATA_OFFSET + boxIndex * BOX_SIZE;
    for (let boxSlot = 0; boxSlot < BOX_SLOT_COUNT; boxSlot += 1) {
      const offset = boxOffset + boxSlot * BOX_SLOT_SIZE;
      const encrypted = saveBytes.subarray(offset, offset + BOX_SLOT_SIZE);
      if (isEmptySlot(encrypted)) continue;
      const decrypted = decryptPk5Stored(encrypted);
      const parsed = parsePokemon(project, decrypted, {
        storage: "box",
        box: boxIndex,
        boxSlot,
      });
      if (parsed) pokemon.push(parsed);
    }
  }

  return pokemon;
}

type PokemonLocation = {
  storage: "party" | "box";
  partySlot?: number;
  partyLevel?: number;
  box?: number;
  boxSlot?: number;
};

function parsePokemon(project: ProjectState, data: Uint8Array, location: PokemonLocation): Gen5SavePokemon | undefined {
  if (data.length < STORED_DATA_END || !hasValidChecksum(data)) return undefined;
  const speciesId = readLe16(data, 0x08);
  if (speciesId <= 0 || speciesId >= (project.narcs.personal?.fileCount ?? 0)) return undefined;
  if ((readLe32(data, 0x38) & 0x40000000) !== 0) return undefined;

  let basePersonal: RawRecord;
  try {
    basePersonal = decodeRecord(project, "personal", speciesId).raw ?? {};
  } catch {
    return undefined;
  }

  const storedFormIndex = (data[0x40] ?? 0) >>> 3 & 0x1f;
  const formCount = Math.max(1, Number(basePersonal.num_forms ?? 1));
  const formIndex = storedFormIndex < formCount ? storedFormIndex : 0;
  const personal = personalForForm(project, basePersonal, formIndex);
  const speciesName = pokemonSpeciesLabel(project, speciesId);
  const nickname = cleanNickname(readGen5String(data, 0x48, 22));
  const itemId = readLe16(data, 0x0a);
  const abilityId = data[0x15] ?? 0;
  const itemName = namedValue(project.texts.banks.items, itemId);
  const abilityName = namedValue(project.texts.banks.abilities, abilityId);
  const moveIds = [0x28, 0x2a, 0x2c, 0x2e]
    .map((offset) => readLe16(data, offset))
    .filter((moveId) => moveId > 0);
  const moveNames = moveIds.map((moveId) => namedValue(project.texts.banks.moves, moveId));
  const exp = readLe32(data, 0x10);
  const savedPartyLevel = Number(location.partyLevel ?? 0);
  const level = savedPartyLevel >= 1 && savedPartyLevel <= 100
    ? savedPartyLevel
    : levelForExperience(exp, Number(personal.exp_rate ?? basePersonal.exp_rate ?? 0));
  const nature = NATURES[data[0x41] ?? 0] ?? NATURES[0];
  const genderValue = (data[0x40] ?? 0) >>> 1 & 0x03;
  const gender = genderValue === 1 ? "F" : genderValue === 2 ? "N" : "M";
  const evs = {
    hp: data[0x18] ?? 0,
    atk: data[0x19] ?? 0,
    def: data[0x1a] ?? 0,
    spe: data[0x1b] ?? 0,
    spa: data[0x1c] ?? 0,
    spd: data[0x1d] ?? 0,
  };
  const packedIvs = readLe32(data, 0x38);
  const ivs = {
    hp: packedIvs & 0x1f,
    atk: packedIvs >>> 5 & 0x1f,
    def: packedIvs >>> 10 & 0x1f,
    spe: packedIvs >>> 15 & 0x1f,
    spa: packedIvs >>> 20 & 0x1f,
    spd: packedIvs >>> 25 & 0x1f,
  };

  const pokemon: Gen5SavePokemon = {
    speciesId,
    formIndex,
    speciesName,
    nickname,
    itemId,
    itemName,
    abilityId,
    abilityName,
    level,
    nature,
    gender,
    evs,
    ivs,
    moveIds,
    moveNames,
    storage: location.storage,
    partySlot: location.partySlot,
    box: location.box,
    boxSlot: location.boxSlot,
    showdownText: "",
  };
  pokemon.showdownText = formatShowdownPokemon(pokemon);
  return pokemon;
}

function personalForForm(project: ProjectState, basePersonal: RawRecord, formIndex: number): RawRecord {
  if (formIndex <= 0) return basePersonal;
  const firstFormId = Number(basePersonal.form_id ?? 0);
  if (firstFormId <= 0) return basePersonal;
  const personalId = firstFormId + formIndex - 1;
  if (personalId >= (project.narcs.personal?.fileCount ?? 0)) return basePersonal;
  try {
    return decodeRecord(project, "personal", personalId).raw ?? basePersonal;
  } catch {
    return basePersonal;
  }
}

function formatShowdownPokemon(pokemon: Gen5SavePokemon): string {
  const formSpecies = pokemon.formIndex > 0 ? `${pokemon.speciesName}^${pokemon.formIndex}` : pokemon.speciesName;
  const nickname = normalizeName(pokemon.nickname) && normalizeName(pokemon.nickname) !== normalizeName(pokemon.speciesName)
    ? `${pokemon.nickname} (${formSpecies})`
    : formSpecies;
  let header = nickname;
  if (pokemon.gender !== "N") header += ` (${pokemon.gender})`;
  if (pokemon.itemId > 0) header += ` @ ${pokemon.itemName}`;

  const lines = [header];
  if (pokemon.abilityId > 0) lines.push(`Ability: ${pokemon.abilityName}`);
  lines.push(`Level: ${pokemon.level}`);
  lines.push(`EVs: ${formatStats(pokemon.evs)}`);
  lines.push(`IVs: ${formatStats(pokemon.ivs)}`);
  lines.push(`${pokemon.nature} Nature`);
  for (const move of pokemon.moveNames) lines.push(`- ${move}`);
  return lines.join("\n");
}

function formatStats(stats: Record<StatKey, number>): string {
  return [
    `${stats.hp} HP`,
    `${stats.atk} Atk`,
    `${stats.def} Def`,
    `${stats.spa} SpA`,
    `${stats.spd} SpD`,
    `${stats.spe} Spe`,
  ].join(" / ");
}

function levelForExperience(experience: number, growthRate: number): number {
  for (let level = 100; level > 1; level -= 1) {
    if (experience >= experienceForLevel(level, growthRate)) return level;
  }
  return 1;
}

function namedValue(values: string[] | undefined, id: number): string {
  const value = values?.[id]?.trim();
  return value || String(id);
}

function cleanNickname(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
}

function readGen5String(bytes: Uint8Array, offset: number, byteLength: number): string {
  const chars: string[] = [];
  for (let cursor = offset; cursor + 1 < offset + byteLength; cursor += 2) {
    const value = readLe16(bytes, cursor);
    if (value === 0 || value === 0xffff) break;
    chars.push(String.fromCharCode(value));
  }
  return chars.join("");
}

function isEmptySlot(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let allZero = true;
  let allFf = true;
  for (const byte of bytes) {
    allZero = allZero && byte === 0;
    allFf = allFf && byte === 0xff;
    if (!allZero && !allFf) return false;
  }
  return true;
}

function hasValidChecksum(data: Uint8Array): boolean {
  let checksum = 0;
  for (let offset = 8; offset + 1 < STORED_DATA_END; offset += 2) {
    checksum = (checksum + readLe16(data, offset)) & 0xffff;
  }
  return checksum === readLe16(data, 6);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}
