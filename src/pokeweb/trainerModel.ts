import { BATTLE_TYPES, BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS, NATURES, TRAINER_AIS, TRAINER_GENDERS, type NarcName } from "./constants";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { pokemonSpriteSlug } from "./spriteSlug";
import { commitTextBank, getTextBank } from "./textModel";
import { addTrainerTextFromTemplate, getTrainerTextLines, type TrainerTextLine } from "./trainerTextModel";
import { publicAsset } from "../assetUrl";

export type TrainerPokemonSlot = {
  slot: number;
  speciesId: number;
  speciesName: string;
  spriteSlug: string;
  level: number;
  ivs: number;
  abilitySlot: number;
  abilityName: string | number;
  gender: string;
  form: number;
  itemName?: string | number;
  moves: Array<string | number>;
  nature: string;
};

export type TrainerRecord = {
  id: number;
  raw: RawRecord;
  readable: ReadableRecord;
  hasMoves: boolean;
  hasItems: boolean;
  party: TrainerPokemonSlot[];
  spritePath: string;
  texts: TrainerTextLine[];
};

export type TrainerUpdateResult = {
  value: string | number;
  rawValue: number;
  trainer?: TrainerRecord;
  slot?: TrainerPokemonSlot;
};

export function getTrainerCount(project: ProjectState): number {
  return project.narcs.trdata?.fileCount ?? 0;
}

export function getTrainerRecord(project: ProjectState, trainerId: number): TrainerRecord {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trdata.readable || !trpok.raw || !trpok.readable) throw new Error(`Unable to decode trainer ${trainerId}`);
  syncTrainerReadable(project, trainerId, trdata.raw, trdata.readable);
  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);

  const party: TrainerPokemonSlot[] = [];
  let carriedAbilitySlot = 1;
  const count = Number(trdata.raw.num_pokemon ?? 0);
  for (let slot = 0; slot < count; slot += 1) {
    const abilitySlot = Number(trpok.readable[`ability_${slot}`] ?? 0);
    const displayedAbilitySlot = abilitySlot === 0 ? carriedAbilitySlot : abilitySlot;
    if (abilitySlot !== 0) carriedAbilitySlot = abilitySlot;
    party.push(getTrainerPokemonSlot(project, trainerId, slot, displayedAbilitySlot));
  }

  return {
    id: trainerId,
    raw: trdata.raw,
    readable: trdata.readable,
    hasMoves: templateHasMoves(trdata.raw.template),
    hasItems: templateHasItems(trdata.raw.template),
    party,
    spritePath: trainerSpritePath(String(trdata.readable.name ?? ""), String(trdata.readable.class ?? "")),
    texts: getTrainerTextLines(project, trainerId),
  };
}

export function getTrainerAutofills(project: ProjectState): Record<string, string[]> {
  return {
    items: project.texts.banks.items ?? [],
    pokemon_names: project.texts.banks.pokedex ?? [],
    class_names: (project.texts.banks.tr_classes ?? []).map((name, index) => `${name} (${index})`),
    battle_types: BATTLE_TYPES,
    genders: TRAINER_GENDERS,
    move_names: project.texts.banks.moves ?? [],
  };
}

export function addTrainer(project: ProjectState, templateTrainerId?: number): TrainerRecord {
  const trdataStore = project.narcs.trdata;
  const trpokStore = project.narcs.trpok;
  if (!trdataStore || !trpokStore) throw new Error("Trainer data is not loaded");
  const trainerId = trdataStore.fileCount;
  const sourceTrainerId = resolveTemplateTrainerId(project, templateTrainerId);
  const sourceTrdata = decodeRecord(project, "trdata", sourceTrainerId);
  const sourceTrpok = decodeRecord(project, "trpok", sourceTrainerId);
  if (!sourceTrdata.raw || !sourceTrpok.raw) throw new Error(`Unable to clone trainer ${sourceTrainerId}`);

  const trdataBytes = (trdataStore.rawFiles[sourceTrainerId] ?? sourceTrdata.bytes ?? new Uint8Array(trdataRowLength(project))).slice();
  const trpokBytes = (trpokStore.rawFiles[sourceTrainerId] ?? sourceTrpok.bytes ?? new Uint8Array()).slice();
  const trdataRaw = cloneRawRecord(sourceTrdata.raw);
  const trpokRaw = cloneRawRecord(sourceTrpok.raw);
  const trpokInfo = {
    template: Number(project.trpokInfo[sourceTrainerId]?.template ?? trdataRaw.template ?? 0),
    numPokemon: Number(project.trpokInfo[sourceTrainerId]?.numPokemon ?? trdataRaw.num_pokemon ?? 0),
  };

  trdataStore.rawFiles.push(trdataBytes);
  trdataStore.fileCount = trdataStore.rawFiles.length;
  trdataStore.records.set(trainerId, { id: trainerId, bytes: trdataBytes, raw: trdataRaw, readable: {} });

  trpokStore.rawFiles.push(trpokBytes);
  trpokStore.fileCount = trpokStore.rawFiles.length;
  trpokStore.records.set(trainerId, { id: trainerId, bytes: trpokBytes, raw: trpokRaw, readable: {} });
  project.trpokInfo[trainerId] = trpokInfo;

  appendTrainerName(project, trainerId);
  addTrainerTextFromTemplate(project, trainerId, sourceTrainerId);
  syncTrainerReadable(project, trainerId, trdataRaw, trdataStore.records.get(trainerId)!.readable!);
  syncTrainerPokemonReadable(project, trainerId, trpokRaw, trpokStore.records.get(trainerId)!.readable!);
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);

  return getTrainerRecord(project, trainerId);
}

export function trainerMatchesSearch(record: TrainerRecord, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = JSON.stringify(record).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export function updateTrainerField(project: ProjectState, trainerId: number, field: string, inputValue: string | number | boolean): TrainerUpdateResult {
  const record = decodeRecord(project, "trdata", trainerId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update trainer ${trainerId}`);
  let rawValue: number;
  let value: string | number;

  if (field === "class") {
    rawValue = parseClassId(project, String(inputValue));
    record.raw.class = rawValue;
    value = `${project.texts.banks.tr_classes?.[rawValue] ?? rawValue} (${rawValue})`;
    record.readable.class = project.texts.banks.tr_classes?.[rawValue] ?? rawValue;
    record.readable.class_id = rawValue;
  } else if (field === "battle_type_1") {
    rawValue = findValueIndex(BATTLE_TYPES, String(inputValue), "battle type");
    record.raw.battle_type_1 = rawValue;
    value = BATTLE_TYPES[rawValue];
    record.readable.battle_type_1 = value;
  } else if (field.startsWith("item_") || field === "reward_item") {
    rawValue = findValueIndex(project.texts.banks.items ?? [], String(inputValue), "item");
    record.raw[field] = rawValue;
    value = project.texts.banks.items?.[rawValue] ?? rawValue;
    record.readable[field] = value;
  } else if (field === "money") {
    rawValue = parseInteger(String(inputValue), 0, 255);
    value = rawValue;
    record.raw.money = rawValue;
    record.readable.money = rawValue;
  } else if (field === "heal") {
    rawValue = parseInteger(String(inputValue), 0, 1);
    value = rawValue;
    record.raw.heal = rawValue;
    record.readable.heal = rawValue;
  } else if (field === "has_moves" || field === "has_items") {
    rawValue = truthyValue(inputValue) ? 1 : 0;
    setTemplateFlag(project, trainerId, field, rawValue === 1);
    value = rawValue;
  } else if (TRAINER_AIS.includes(field)) {
    rawValue = truthyValue(inputValue) ? 1 : 0;
    record.readable[field] = rawValue;
    record.raw.ai = packAiFlags(record.readable);
    value = rawValue;
  } else {
    throw new Error(`Unsupported trainer field: ${field}`);
  }

  syncTrainerReadable(project, trainerId, record.raw, record.readable);
  markDirty(project, "trdata", trainerId);
  return { value, rawValue, trainer: getTrainerRecord(project, trainerId) };
}

export function setTrainerAiFlagForAll(project: ProjectState, field: string, enabled = true): number {
  if (!TRAINER_AIS.includes(field)) throw new Error(`Unsupported trainer AI flag: ${field}`);
  const rawValue = enabled ? 1 : 0;
  let updated = 0;

  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    const record = decodeRecord(project, "trdata", trainerId);
    if (!record.raw || !record.readable) continue;
    syncTrainerReadable(project, trainerId, record.raw, record.readable);
    if (aiFlag(Number(record.raw.ai ?? 0), field) === rawValue) {
      continue;
    }

    record.readable[field] = rawValue;
    record.raw.ai = packAiFlags(record.readable);
    syncTrainerReadable(project, trainerId, record.raw, record.readable);
    markDirty(project, "trdata", trainerId);
    updated += 1;
  }

  return updated;
}

export function updateTrainerPokemonField(project: ProjectState, trainerId: number, slot: number, field: string, inputValue: string): TrainerUpdateResult {
  const record = decodeRecord(project, "trpok", trainerId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update trainer Pokemon ${trainerId}:${slot}`);
  const suffix = `_${slot}`;
  let rawValue: number;
  let value: string | number;

  if (field === `species_id${suffix}`) {
    rawValue = findValueIndex(project.texts.banks.pokedex ?? [], inputValue, "Pokemon");
    record.raw[field] = rawValue;
    value = project.texts.banks.pokedex?.[rawValue] ?? rawValue;
    record.readable[field] = value;
  } else if (field === `item_id${suffix}`) {
    setTemplateFlag(project, trainerId, "has_items", true);
    rawValue = findValueIndex(project.texts.banks.items ?? [], inputValue, "item");
    record.raw[field] = rawValue;
    value = project.texts.banks.items?.[rawValue] ?? rawValue;
    record.readable[field] = value;
  } else if (/^move_[1-4]_\d+$/u.test(field)) {
    setTemplateFlag(project, trainerId, "has_moves", true);
    rawValue = findValueIndex(project.texts.banks.moves ?? [], inputValue, "move");
    record.raw[field] = rawValue;
    value = project.texts.banks.moves?.[rawValue] ?? rawValue;
    record.readable[field] = value;
  } else if (field === `level${suffix}`) {
    rawValue = parseInteger(inputValue, 0, 100);
    value = rawValue;
    record.raw[field] = rawValue;
    record.readable[field] = rawValue;
  } else if (field === `ivs${suffix}`) {
    rawValue = parseInteger(inputValue, 0, 255);
    value = rawValue;
    record.raw[field] = rawValue;
    record.readable[field] = rawValue;
  } else if (field === `form${suffix}`) {
    rawValue = parseInteger(inputValue, 0, 255);
    value = rawValue;
    record.raw[field] = rawValue;
    record.readable[field] = rawValue;
  } else if (field === `ability${suffix}`) {
    rawValue = parseInteger(inputValue, 0, 3);
    record.raw[field] = packAbilityGender(rawValue, genderIndex(String(record.readable[`gender_${slot}`] ?? "Default")));
    value = rawValue;
  } else if (field === `gender${suffix}`) {
    rawValue = genderIndex(inputValue);
    const abilitySlot = Number(record.readable[`ability_${slot}`] ?? 0);
    record.raw[`ability_${slot}`] = packAbilityGender(abilitySlot, rawValue);
    value = TRAINER_GENDERS[rawValue];
  } else {
    throw new Error(`Unsupported trainer Pokemon field: ${field}`);
  }

  syncTrainerPokemonReadable(project, trainerId, record.raw, record.readable);
  markDirty(project, "trpok", trainerId);
  return { value, rawValue, slot: getTrainerPokemonSlot(project, trainerId, slot), trainer: getTrainerRecord(project, trainerId) };
}

export function addTrainerPokemon(project: ProjectState, trainerId: number): TrainerPokemonSlot {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trdata.readable || !trpok.raw || !trpok.readable) throw new Error(`Unable to add trainer Pokemon ${trainerId}`);
  const count = Number(trdata.raw.num_pokemon ?? 0);
  if (count >= 6) throw new Error("Trainer parties cannot exceed 6 Pokemon");

  trdata.raw.num_pokemon = count + 1;
  trdata.readable.num_pokemon = count + 1;
  project.trpokInfo[trainerId] = { template: Number(trdata.raw.template ?? 0), numPokemon: count + 1 };
  trpok.raw[`ivs_${count}`] = 0;
  trpok.raw[`ability_${count}`] = 0;
  trpok.raw[`level_${count}`] = 1;
  trpok.raw[`padding_${count}`] = 0;
  trpok.raw[`species_id_${count}`] = 0;
  trpok.raw[`form_${count}`] = 0;
  if (templateHasItems(trdata.raw.template)) trpok.raw[`item_id_${count}`] = 0;
  if (templateHasMoves(trdata.raw.template)) {
    for (let move = 1; move <= 4; move += 1) trpok.raw[`move_${move}_${count}`] = 0;
  }
  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);
  return getTrainerPokemonSlot(project, trainerId, count);
}

export function deleteTrainerPokemon(project: ProjectState, trainerId: number, slot: number): TrainerRecord {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trdata.readable || !trpok.raw || !trpok.readable) throw new Error(`Unable to delete trainer Pokemon ${trainerId}:${slot}`);
  const count = Number(trdata.raw.num_pokemon ?? 0);
  if (slot < 0 || slot >= count) throw new Error("Trainer Pokemon slot does not exist");

  const fields = ["ivs", "ability", "level", "padding", "species_id", "form", "item_id", "move_1", "move_2", "move_3", "move_4"];
  for (let current = slot; current < count - 1; current += 1) {
    for (const field of fields) {
      const from = `${field}_${current + 1}`;
      const to = `${field}_${current}`;
      if (trpok.raw[from] !== undefined) trpok.raw[to] = trpok.raw[from];
      else delete trpok.raw[to];
      if (trpok.readable[from] !== undefined) trpok.readable[to] = trpok.readable[from];
      else delete trpok.readable[to];
    }
  }
  for (const field of fields) {
    delete trpok.raw[`${field}_${count - 1}`];
    delete trpok.readable[`${field}_${count - 1}`];
  }
  delete trpok.readable[`gender_${count - 1}`];

  trdata.raw.num_pokemon = count - 1;
  trdata.readable.num_pokemon = count - 1;
  project.trpokInfo[trainerId] = { template: Number(trdata.raw.template ?? 0), numPokemon: count - 1 };
  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);
  return getTrainerRecord(project, trainerId);
}

export function calculateTrainerPokemonNature(project: ProjectState, trainerId: number, slot: number): string {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trpok.raw) return "Unknown";
  const speciesId = trpok.raw[`species_id_${slot}`];
  if (speciesId === undefined || !project.narcs.personal || speciesId >= project.narcs.personal.fileCount) return "Unknown";
  const personal = decodeRecord(project, "personal", speciesId);
  if (!personal.raw) return "Unknown";
  const pid = getPid(
    trainerId,
    Number(trdata.raw.class ?? 0),
    speciesId,
    Number(trpok.raw[`ivs_${slot}`] ?? 0),
    Number(trpok.raw[`level_${slot}`] ?? 0),
    Number(trpok.raw[`ability_${slot}`] ?? 0),
    Number(personal.raw.gender ?? 0),
    false,
    Math.floor(Number(trpok.raw[`ability_${slot}`] ?? 0) / 16),
  );
  return NATURES[Number((pid >> 8n) % 25n)] ?? "Unknown";
}

function getTrainerPokemonSlot(project: ProjectState, trainerId: number, slot: number, displayedAbilitySlot?: number): TrainerPokemonSlot {
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trpok.raw || !trpok.readable) throw new Error(`Unable to decode trainer Pokemon ${trainerId}:${slot}`);
  const speciesId = Number(trpok.raw[`species_id_${slot}`] ?? 0);
  const speciesName = String(trpok.readable[`species_id_${slot}`] ?? speciesId);
  const abilitySlot = Number(trpok.readable[`ability_${slot}`] ?? 0);
  const resolvedAbilitySlot = displayedAbilitySlot ?? abilitySlot;
  return {
    slot,
    speciesId,
    speciesName,
    spriteSlug: spriteSlug(speciesName),
    level: Number(trpok.raw[`level_${slot}`] ?? 0),
    ivs: Number(trpok.raw[`ivs_${slot}`] ?? 0),
    abilitySlot,
    abilityName: abilityName(project, speciesId, resolvedAbilitySlot),
    gender: String(trpok.readable[`gender_${slot}`] ?? "Default"),
    form: Number(trpok.raw[`form_${slot}`] ?? 0),
    itemName: trpok.readable[`item_id_${slot}`],
    moves: [1, 2, 3, 4].map((move) => trpok.readable?.[`move_${move}_${slot}`] ?? 0),
    nature: calculateTrainerPokemonNature(project, trainerId, slot),
  };
}

function setTemplateFlag(project: ProjectState, trainerId: number, field: string, enabled: boolean): void {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trdata.readable || !trpok.raw || !trpok.readable) throw new Error(`Unable to update trainer template ${trainerId}`);
  const hasMoves = field === "has_moves" ? enabled : templateHasMoves(trdata.raw.template);
  const hasItems = field === "has_items" ? enabled : templateHasItems(trdata.raw.template);
  trdata.raw.template = (hasMoves ? 1 : 0) + (hasItems ? 2 : 0);
  trdata.readable.has_moves = hasMoves ? 1 : 0;
  trdata.readable.has_items = hasItems ? 1 : 0;
  trdata.readable.template = trdata.raw.template;
  project.trpokInfo[trainerId] = { template: trdata.raw.template, numPokemon: Number(trdata.raw.num_pokemon ?? 0) };

  const count = Number(trdata.raw.num_pokemon ?? 0);
  for (let slot = 0; slot < count; slot += 1) {
    if (hasItems && trpok.raw[`item_id_${slot}`] === undefined) trpok.raw[`item_id_${slot}`] = 0;
    if (hasMoves) {
      for (let move = 1; move <= 4; move += 1) {
        if (trpok.raw[`move_${move}_${slot}`] === undefined) trpok.raw[`move_${move}_${slot}`] = 0;
      }
    }
  }
  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);
}

function syncTrainerReadable(project: ProjectState, _trainerId: number, raw: RawRecord, readable: ReadableRecord): void {
  readable.class = project.texts.banks.tr_classes?.[raw.class] ?? raw.class;
  readable.class_id = raw.class;
  readable.battle_type_1 = BATTLE_TYPES[raw.battle_type_1] ?? raw.battle_type_1;
  for (let n = 1; n <= 4; n += 1) readable[`item_${n}`] = project.texts.banks.items?.[raw[`item_${n}`]] ?? raw[`item_${n}`];
  readable.reward_item = project.texts.banks.items?.[raw.reward_item] ?? raw.reward_item;
  readable.has_moves = templateHasMoves(raw.template) ? 1 : 0;
  readable.has_items = templateHasItems(raw.template) ? 1 : 0;
  for (const ai of TRAINER_AIS) readable[ai] = aiFlag(raw.ai, ai);
}

function syncTrainerPokemonReadable(project: ProjectState, trainerId: number, raw: RawRecord, readable: ReadableRecord): void {
  const count = project.trpokInfo[trainerId]?.numPokemon ?? 0;
  const template = project.trpokInfo[trainerId]?.template ?? 0;
  readable.count = count;
  readable.template = template;
  for (let slot = 0; slot < count; slot += 1) {
    const speciesId = raw[`species_id_${slot}`] ?? 0;
    readable[`species_id_${slot}`] = project.texts.banks.pokedex?.[speciesId % 1024] ?? speciesId;
    const abilityByte = raw[`ability_${slot}`] === 255 ? 0 : raw[`ability_${slot}`] ?? 0;
    raw[`ability_${slot}`] = abilityByte;
    readable[`ability_${slot}`] = Math.floor(abilityByte / 16);
    readable[`gender_${slot}`] = TRAINER_GENDERS[Math.min(abilityByte % 16, 2)] ?? "Default";
    if (templateHasItems(template)) {
      const itemId = raw[`item_id_${slot}`] ?? 0;
      raw[`item_id_${slot}`] = itemId;
      readable[`item_id_${slot}`] = project.texts.banks.items?.[itemId] ?? itemId;
    }
    if (templateHasMoves(template)) {
      for (let move = 1; move <= 4; move += 1) {
        const moveId = raw[`move_${move}_${slot}`] ?? 0;
        raw[`move_${move}_${slot}`] = moveId;
        readable[`move_${move}_${slot}`] = project.texts.banks.moves?.[moveId] ?? moveId;
      }
    }
  }
}

function resolveTemplateTrainerId(project: ProjectState, templateTrainerId?: number): number {
  const count = getTrainerCount(project);
  if (templateTrainerId !== undefined && Number.isInteger(templateTrainerId) && templateTrainerId >= 0 && templateTrainerId < count) return templateTrainerId;
  return count > 1 ? 1 : 0;
}

function cloneRawRecord(raw: RawRecord): RawRecord {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value)]));
}

function trdataRowLength(project: ProjectState): number {
  return project.formats.trdata?.reduce((sum, [size]) => sum + size, 0) ?? 0;
}

function appendTrainerName(project: ProjectState, trainerId: number): void {
  const names = project.texts.banks.tr_names ?? [];
  while (names.length <= trainerId) names.push("Trainer");
  names[trainerId] = "Trainer";
  project.texts.banks.tr_names = names;

  const bankId = trainerNameBankId(project);
  if (bankId === undefined || !project.narcs.message_texts) return;
  const bank = getTextBank(project, "message_texts", bankId);
  while (bank.length <= trainerId) bank.push([`0_${bank.length}`, "Trainer", 0]);
  bank[trainerId][1] = "Trainer";
  commitTextBank(project, "message_texts", bankId);
}

function trainerNameBankId(project: ProjectState): number | undefined {
  const mappings = project.session.baseRom === "BW" ? BW_MESSAGE_BANKS : BW2_MESSAGE_BANKS;
  return mappings.find(([, name]) => name === "tr_names")?.[0];
}

function getPid(
  trainerId: number,
  trainerClass: number,
  pokId: number,
  pokIv: number,
  pokLevel: number,
  abilityGender: number,
  personalGender: number,
  trainerGender: boolean,
  abilitySlot: number,
): bigint {
  let seed = BigInt(trainerId + pokId + pokIv + pokLevel);
  for (let n = 0; n < trainerClass; n += 1) seed = seed * 0x5d588b656c078965n + 0x269ec3n;
  return ((((seed >> 32n) & 0xffffffffn) >> 16n) << 8n) + BigInt(getGenderAbility(abilityGender, personalGender, trainerGender, abilitySlot));
}

function getGenderAbility(abilityGender: number, personalGender: number, trainerGender: boolean, abilitySlot: number): number {
  let result = trainerGender ? 120 : 136;
  const gender = abilityGender & 0x0f;
  if (abilityGender !== 0) {
    if (gender !== 0) result = gender === 1 ? personalGender + 2 : personalGender - 2;
    if (abilitySlot === 1) result &= 0xfffffffe;
    else if (abilitySlot !== 0) result |= 1;
  }
  return result;
}

function packAiFlags(readable: ReadableRecord): number {
  return TRAINER_AIS.reduce((packed, ai, index) => packed | ((Number(readable[ai]) ? 1 : 0) << index), 0);
}

function aiFlag(ai: number, name: string): number {
  const index = TRAINER_AIS.indexOf(name);
  return index < 0 ? 0 : (ai >> index) & 1;
}

function parseClassId(project: ProjectState, value: string): number {
  const match = value.match(/\((\d+)\)\s*$/u);
  if (match) return parseInteger(match[1], 0, 255);
  return findValueIndex(project.texts.banks.tr_classes ?? [], value, "trainer class");
}

function abilityName(project: ProjectState, speciesId: number, abilitySlot: number): string | number {
  if (!project.narcs.personal || speciesId >= project.narcs.personal.fileCount) return "";
  const personal = decodeRecord(project, "personal", speciesId);
  const slot = Math.min(Math.max(abilitySlot, 1), 3);
  return personal.readable?.[`ability_${slot}`] ?? "";
}

function templateHasMoves(template: number): boolean {
  return (template & 1) !== 0;
}

function templateHasItems(template: number): boolean {
  return (template & 2) !== 0;
}

function packAbilityGender(abilitySlot: number, gender: number): number {
  return abilitySlot * 16 + gender;
}

function genderIndex(value: string): number {
  return findValueIndex(TRAINER_GENDERS, value, "gender");
}

function truthyValue(value: string | number | boolean): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "checked";
}

function parseInteger(inputValue: string, min: number, max: number): number {
  const value = Number(inputValue.trim());
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Value must be an integer between ${min} and ${max}`);
  return value;
}

function findValueIndex(values: string[], inputValue: string, label: string): number {
  const numeric = Number(inputValue.trim());
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < values.length) return numeric;
  const normalizedInput = normalizeName(inputValue);
  const index = values.findIndex((value) => normalizeName(value) === normalizedInput);
  if (index < 0) throw new Error(`Unknown ${label}: ${inputValue}`);
  return index;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function trainerSpritePath(_name: string, trainerClass: string): string {
  const classSlug = trainerClass
    .toLowerCase()
    .replace(/pkmn/gu, "pokemon")
    .replace(/\s+/gu, "_")
    .replace(/[^a-z0-9_]/gu, "")
    .replace(/__+/gu, "_");
  return publicAsset(`images/trainer_sprites/${classSlug}.png`);
}

function spriteSlug(name: string): string {
  return pokemonSpriteSlug(name);
}
