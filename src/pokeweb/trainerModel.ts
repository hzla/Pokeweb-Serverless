import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { cascadeWhitePersonalName, cascadeWhiteTrainerAbilityName, trainerAbilitySlotMax } from "./cascadeWhiteModel";
import { BATTLE_TYPES, BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS, NATURES, TRAINER_AIS, TRAINER_GENDERS, isGen4Project, type Gen4BaseRom, type NarcName } from "./constants";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { pokemonSpriteSlug } from "./spriteSlug";
import { commitTextBank, getTextBank } from "./textModel";
import { addTrainerTextFromTemplate, getTrainerTextLines, type TrainerTextLine } from "./trainerTextModel";
import { publicAsset } from "../assetUrl";
import { learnsetEntries } from "./pokemonModel";
import { pokemonFormSuffix } from "./pokemonFormLabels";

export type TrainerPokemonSlot = {
  slot: number;
  speciesId: number;
  speciesName: string;
  spriteSlug: string;
  level: number;
  ivs: number;
  abilitySlot: number;
  resolvedAbilitySlot: number;
  abilityName: string | number;
  gender: string;
  form: number;
  itemName?: string | number;
  moves: Array<string | number>;
  nature: string;
  natureSetting: string;
  natureValue: number;
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

type TrainerPokemonShowdownImport = {
  species: string;
  gender?: string;
  item?: string;
  ability?: string;
  level?: number;
  ivs?: number;
  nature?: string;
  form?: number;
  moves: string[];
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
  const gen4Project = isGen4Project(project);
  const count = Number(trdata.raw.num_pokemon ?? 0);
  for (let slot = 0; slot < count; slot += 1) {
    const abilitySlot = Number(trpok.readable[`ability_${slot}`] ?? 0);
    const displayedAbilitySlot = gen4Project ? gen4TrainerPokemonAbilitySlot(project, trainerId, slot) : abilitySlot === 0 ? carriedAbilitySlot : abilitySlot;
    if (!gen4Project && abilitySlot !== 0) carriedAbilitySlot = abilitySlot;
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
    pokemon_names: pokemonNameAutofills(project),
    class_names: (project.texts.banks.tr_classes ?? []).map((name, index) => `${name} (${index})`),
    battle_types: BATTLE_TYPES,
    genders: TRAINER_GENDERS,
    natures: ["Auto", ...NATURES],
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
  syncTrainerReadable(project, trainerId, record.raw, record.readable);
  const before = record.readable[field];
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
  recordFieldChange(project, "trdata", trainerChangelogSubject(project, trainerId), trainerFieldLabel(field), before, value, { key: `trainer:${trainerId}:data:${field}` });
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

  if (updated > 0) recordGenericChange(project, "trdata", `${field} AI flag set to ${enabled ? "on" : "off"} for ${updated} trainers.`, "Trainer Data", { key: `trainer-ai-all:${field}` });
  return updated;
}

export function updateTrainerPokemonField(project: ProjectState, trainerId: number, slot: number, field: string, inputValue: string): TrainerUpdateResult {
  const record = decodeRecord(project, "trpok", trainerId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update trainer Pokemon ${trainerId}:${slot}`);
  const suffix = `_${slot}`;
  syncTrainerPokemonReadable(project, trainerId, record.raw, record.readable);
  const before = record.readable[field];
  let rawValue: number;
  let value: string | number;

  if (field === `species_id${suffix}`) {
    rawValue = findPokemonValueIndex(project, inputValue);
    record.raw[field] = rawValue;
    value = pokemonName(project, rawValue);
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
  } else if (field === `nature${suffix}`) {
    rawValue = parseTrainerNatureValue(inputValue);
    value = trainerNatureSetting(rawValue);
    record.raw[`padding_${slot}`] = rawValue;
    record.readable[field] = value;
  } else if (field === `form${suffix}`) {
    rawValue = parseInteger(inputValue, 0, 255);
    value = rawValue;
    record.raw[field] = rawValue;
    record.readable[field] = rawValue;
  } else if (field === `ability${suffix}`) {
    rawValue = parseInteger(inputValue, 0, trainerAbilitySlotMax(project));
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
  recordFieldChange(project, "trpok", trainerChangelogSubject(project, trainerId), `Pokemon ${slot + 1} ${trainerFieldLabel(field.replace(suffix, ""))}`, before, value, {
    key: `trainer:${trainerId}:pokemon:${slot}:${field}`,
  });
  markDirty(project, "trpok", trainerId);
  return { value, rawValue, slot: getTrainerPokemonSlot(project, trainerId, slot), trainer: getTrainerRecord(project, trainerId) };
}

export function autofillTrainerPokemonMoves(project: ProjectState, trainerId: number, slot: number): TrainerUpdateResult {
  if (!project.narcs.learnsets) throw new Error("Learnsets are not loaded");
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trdata.readable || !trpok.raw || !trpok.readable) throw new Error(`Unable to autofill trainer Pokemon ${trainerId}:${slot}`);
  const count = Number(trdata.raw.num_pokemon ?? 0);
  if (slot < 0 || slot >= count) throw new Error("Trainer Pokemon slot does not exist");

  const speciesId = Number(trpok.raw[`species_id_${slot}`] ?? 0) % 1024;
  const level = Number(trpok.raw[`level_${slot}`] ?? 0);
  if (speciesId <= 0 || speciesId >= project.narcs.learnsets.fileCount || !project.narcs.learnsets.rawFiles[speciesId]) {
    throw new Error("No learnset is available for this Pokemon");
  }

  const moves = getAutofilledTrainerPokemonMoveIds(project, speciesId, level);
  setTemplateFlag(project, trainerId, "has_moves", true);

  const before = [1, 2, 3, 4].map((move) => trpok.readable?.[`move_${move}_${slot}`] ?? 0);
  for (let move = 1; move <= 4; move += 1) {
    const moveId = moves[move - 1] ?? 0;
    trpok.raw[`move_${move}_${slot}`] = moveId;
    trpok.readable[`move_${move}_${slot}`] = project.texts.banks.moves?.[moveId] ?? moveId;
  }

  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);
  const after = [1, 2, 3, 4].map((move) => trpok.readable?.[`move_${move}_${slot}`] ?? 0);
  recordFieldChange(project, "trpok", trainerChangelogSubject(project, trainerId), `Pokemon ${slot + 1} moves`, before.join(", "), after.join(", "), {
    key: `trainer:${trainerId}:pokemon:${slot}:autofill-moves`,
  });
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);
  return { value: after.join(", "), rawValue: moves[0] ?? 0, slot: getTrainerPokemonSlot(project, trainerId, slot), trainer: getTrainerRecord(project, trainerId) };
}

export function formatTrainerPokemonShowdownText(project: ProjectState, trainerId: number, slot: number): string {
  const trainer = getTrainerRecord(project, trainerId);
  const pok = trainer.party[slot];
  if (!pok) throw new Error("Trainer Pokemon slot does not exist");

  const headerParts = [showdownName(pok.speciesName)];
  const gender = showdownGender(pok.gender);
  if (gender) headerParts.push(`(${gender})`);
  const item = trainer.hasItems ? optionalShowdownValue(pok.itemName) : "";

  const lines = [item ? `${headerParts.join(" ")} @ ${item}` : headerParts.join(" ")];
  const ability = optionalShowdownValue(pok.abilityName);
  if (ability) lines.push(`Ability: ${ability}`);
  lines.push(`Level: ${pok.level}`);
  if (pok.nature !== "Unknown") lines.push(`${pok.nature} Nature`);

  const iv = Math.floor((pok.ivs * 31) / 255);
  lines.push(`IVs: ${iv} HP / ${iv} Atk / ${iv} Def / ${iv} SpA / ${iv} SpD / ${iv} Spe`);
  for (const move of trainerPokemonShowdownMoves(project, trainer, pok)) lines.push(`- ${showdownName(move)}`);
  return lines.join("\n");
}

export function importTrainerPokemonShowdownText(project: ProjectState, trainerId: number, slot: number, text: string): TrainerUpdateResult {
  const parsed = parseTrainerPokemonShowdownImport(text);
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trdata.readable || !trpok.raw || !trpok.readable) throw new Error(`Unable to update trainer Pokemon ${trainerId}:${slot}`);
  const count = Number(trdata.raw.num_pokemon ?? 0);
  if (slot < 0 || slot >= count) throw new Error("Trainer Pokemon slot does not exist");

  const speciesId = findPokemonValueIndex(project, parsed.species);
  trpok.raw[`species_id_${slot}`] = speciesId;
  trpok.raw[`level_${slot}`] = parsed.level ?? 100;
  trpok.raw[`ivs_${slot}`] = parsed.ivs ?? 255;
  trpok.raw[`padding_${slot}`] = parseTrainerNatureValue(parsed.nature ?? "Auto");
  trpok.raw[`form_${slot}`] = parsed.form ?? 0;

  const abilitySlot = parsed.ability === undefined ? Number(trpok.readable[`ability_${slot}`] ?? 0) : trainerAbilitySlotFromShowdown(project, speciesId, parsed.ability);
  trpok.raw[`ability_${slot}`] = packAbilityGender(abilitySlot, genderIndex(parsed.gender ?? "Default"));

  if (parsed.item !== undefined || templateHasItems(trdata.raw.template)) {
    if (!isEmptyShowdownValue(parsed.item)) setTemplateFlag(project, trainerId, "has_items", true);
    trpok.raw[`item_id_${slot}`] = parsed.item === undefined || isEmptyShowdownValue(parsed.item) ? 0 : findValueIndex(project.texts.banks.items ?? [], parsed.item, "item");
  }

  if (parsed.moves.length > 0) setTemplateFlag(project, trainerId, "has_moves", true);
  if (parsed.moves.length > 0 || templateHasMoves(trdata.raw.template)) {
    for (let move = 1; move <= 4; move += 1) {
      const moveName = parsed.moves[move - 1];
      trpok.raw[`move_${move}_${slot}`] = moveName === undefined || isEmptyShowdownValue(moveName) ? 0 : findValueIndex(project.texts.banks.moves ?? [], moveName, "move");
    }
  }

  syncTrainerReadable(project, trainerId, trdata.raw, trdata.readable);
  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);
  recordGenericChange(project, "trpok", `${trainerChangelogSubject(project, trainerId)} Pokemon ${slot + 1} was imported from Showdown text.`, trainerChangelogSubject(project, trainerId), {
    key: `trainer:${trainerId}:pokemon:${slot}:showdown-import`,
  });
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);
  return { value: pokemonName(project, speciesId), rawValue: speciesId, slot: getTrainerPokemonSlot(project, trainerId, slot), trainer: getTrainerRecord(project, trainerId) };
}

export function getAutofilledTrainerPokemonMoveIds(project: ProjectState, speciesId: number, level: number): number[] {
  if (!project.narcs.learnsets) throw new Error("Learnsets are not loaded");
  const learnsetSpeciesId = speciesId % 1024;
  if (learnsetSpeciesId <= 0 || learnsetSpeciesId >= project.narcs.learnsets.fileCount || !project.narcs.learnsets.rawFiles[learnsetSpeciesId]) {
    throw new Error("No learnset is available for this Pokemon");
  }

  const learnset = decodeRecord(project, "learnsets", learnsetSpeciesId);
  if (!learnset.raw) throw new Error("No learnset is available for this Pokemon");

  return learnsetEntries(learnset.raw)
    .filter((entry) => entry.level <= level)
    .slice(-4)
    .reverse()
    .map((entry) => entry.moveId);
}

function trainerPokemonShowdownMoves(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot): Array<string | number> {
  const explicitMoves = pok.moves.filter((move) => !isEmptyShowdownValue(move));
  if (explicitMoves.length > 0) return explicitMoves;

  try {
    return getAutofilledTrainerPokemonMoveIds(project, pok.speciesId, pok.level).map((moveId) => project.texts.banks.moves?.[moveId] ?? moveId);
  } catch {
    return trainer.hasMoves ? explicitMoves : [];
  }
}

function parseTrainerPokemonShowdownImport(text: string): TrainerPokemonShowdownImport {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines.find((line) => !line.startsWith("-") && !/^[A-Za-z]+:/u.test(line) && !/ Nature$/u.test(line));
  if (!header) throw new Error("Paste a single Pokemon Showdown set with a Pokemon name on the first line.");

  const parsedHeader = parseShowdownHeader(header);
  const result: TrainerPokemonShowdownImport = { ...parsedHeader, moves: [] };
  for (const line of lines) {
    const ability = /^Ability:\s*(.+)$/iu.exec(line);
    if (ability) {
      result.ability = ability[1].trim();
      continue;
    }

    const level = /^Level:\s*(\d+)$/iu.exec(line);
    if (level) {
      result.level = parseInteger(level[1], 0, 100);
      continue;
    }

    const nature = /^(.+?)\s+Nature$/iu.exec(line);
    if (nature) {
      result.nature = nature[1].trim();
      continue;
    }

    const ivs = /^IVs:\s*(.+)$/iu.exec(line);
    if (ivs) {
      result.ivs = parseShowdownIvs(ivs[1]);
      continue;
    }

    const form = /^(?:Pokeweb\s+)?Form:\s*(\d+)$/iu.exec(line);
    if (form) {
      result.form = parseInteger(form[1], 0, 255);
      continue;
    }

    const move = /^-\s*(.+)$/u.exec(line);
    if (move && result.moves.length < 4) result.moves.push(move[1].trim());
  }
  return result;
}

function parseShowdownHeader(header: string): Omit<TrainerPokemonShowdownImport, "moves"> {
  const [namePart, ...itemParts] = header.split("@");
  let species = (namePart ?? "").trim();
  const item = itemParts.length > 0 ? itemParts.join("@").trim() : undefined;
  let gender: string | undefined;

  const genderMatch = species.match(/\s+\((M|F)\)$/iu);
  if (genderMatch) {
    gender = genderMatch[1].toUpperCase() === "M" ? "Male" : "Female";
    species = species.slice(0, genderMatch.index).trim();
  }

  const speciesMatch = species.match(/^.+\(([^()]+)\)$/u);
  if (speciesMatch) species = speciesMatch[1].trim();
  if (!species) throw new Error("Showdown import is missing a Pokemon species.");
  return { species, gender, item };
}

function parseShowdownIvs(value: string): number {
  const ivs = [...value.matchAll(/(\d+)\s*(?:HP|Atk|Def|SpA|SpD|Spe)?/giu)].map((match) => parseInteger(match[1], 0, 31));
  if (ivs.length === 0) throw new Error("IVs line does not contain any IV values.");
  const average = ivs.reduce((sum, iv) => sum + iv, 0) / ivs.length;
  return Math.min(255, Math.ceil((average * 255) / 31));
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
  recordGenericChange(project, "trpok", `${trainerChangelogSubject(project, trainerId)} Pokemon ${count + 1} was added.`, trainerChangelogSubject(project, trainerId), {
    key: `trainer:${trainerId}:pokemon-add:${count}`,
  });
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
  delete trpok.readable[`nature_${count - 1}`];

  trdata.raw.num_pokemon = count - 1;
  trdata.readable.num_pokemon = count - 1;
  project.trpokInfo[trainerId] = { template: Number(trdata.raw.template ?? 0), numPokemon: count - 1 };
  syncTrainerPokemonReadable(project, trainerId, trpok.raw, trpok.readable);
  recordGenericChange(project, "trpok", `${trainerChangelogSubject(project, trainerId)} Pokemon ${slot + 1} was removed.`, trainerChangelogSubject(project, trainerId), {
    key: `trainer:${trainerId}:pokemon-delete:${slot}`,
  });
  markDirty(project, "trdata", trainerId);
  markDirty(project, "trpok", trainerId);
  return getTrainerRecord(project, trainerId);
}

export function calculateTrainerPokemonNature(project: ProjectState, trainerId: number, slot: number): string {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trpok.raw) return "Unknown";
  if (isGen4Project(project)) return calculateGen4TrainerPokemonNature(project, trainerId, slot);
  const explicitNature = trainerNatureName(trpok.raw[`padding_${slot}`]);
  if (explicitNature) return explicitNature;
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

export function resolveTrainerPokemonGender(project: ProjectState, trainerId: number, slot: number): string {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trpok.raw) return "";
  const speciesId = Number(trpok.raw[`species_id_${slot}`] ?? 0);
  if (speciesId === 0 || !project.narcs.personal) return "";
  const personalId = normalizedSpeciesId(speciesId);
  if (personalId >= project.narcs.personal.fileCount) return "";
  const personal = decodeRecord(project, "personal", personalId);
  if (!personal.raw) return "";
  const personalGender = Number(personal.raw.gender ?? 255);

  if (isGen4Project(project)) {
    const pid = gen4TrainerPokemonPid(project, trainerId, slot);
    return resolvedGenderFromPidByte(personalGender, pid === undefined ? undefined : pid & 0xff);
  }

  const rawAbilityGender = Number(trpok.raw[`ability_${slot}`] ?? 0);
  const pid = getPid(
    trainerId,
    Number(trdata.raw.class ?? 0),
    speciesId,
    Number(trpok.raw[`ivs_${slot}`] ?? 0),
    Number(trpok.raw[`level_${slot}`] ?? 0),
    rawAbilityGender,
    personalGender,
    false,
    Math.floor(rawAbilityGender / 16),
  );
  return resolvedGenderFromPidByte(personalGender, Number(pid & 0xffn));
}

function resolvedGenderFromPidByte(personalGender: number, pidByte = 136): string {
  if (personalGender === 255) return "";
  if (personalGender === 254) return "Female";
  if (personalGender === 0) return "Male";
  return pidByte < personalGender ? "Female" : "Male";
}

const GEN4_TRAINER_CLASS_GENDER_TABLES: Record<Gen4BaseRom, { length: number; offsets: number[] }> = {
  DP: { length: 98, offsets: [0xf8010, 0xf9f7c, 0xf8054, 0xf8024, 0xf7fc8, 0xf8060] },
  Pt: { length: 105, offsets: [0xf0714, 0xefda4, 0xf079c, 0xf076c, 0xf0730, 0xf07a8] },
  HGSS: { length: 128, offsets: [0xffb90, 0xff310, 0xffb74, 0xffb44, 0xffb08, 0xffb78] },
};

function calculateGen4TrainerPokemonNature(project: ProjectState, trainerId: number, slot: number): string {
  const pid = gen4TrainerPokemonPid(project, trainerId, slot);
  if (pid === undefined) return "Unknown";
  return NATURES[(pid % 100) % 25] ?? "Unknown";
}

function gen4TrainerPokemonAbilitySlot(project: ProjectState, trainerId: number, slot: number): number {
  const pid = gen4TrainerPokemonPid(project, trainerId, slot);
  return pid === undefined ? 1 : pid % 2 === 0 ? 1 : 2;
}

function gen4TrainerPokemonPid(project: ProjectState, trainerId: number, slot: number): number | undefined {
  const trdata = decodeRecord(project, "trdata", trainerId);
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trdata.raw || !trpok.raw) return undefined;
  const trainerClass = Number(trdata.raw.class ?? 0);
  let pidMod = gen4TrainerClassIsMale(project, trainerClass) ? 136 : 120;
  for (let currentSlot = 0; currentSlot <= slot; currentSlot += 1) {
    const speciesId = Number(trpok.raw[`species_id_${currentSlot}`] ?? 0);
    if (speciesId === 0 || !project.narcs.personal || speciesId >= project.narcs.personal.fileCount) return undefined;
    const personal = decodeRecord(project, "personal", speciesId);
    if (!personal.raw) return undefined;
    if (gen4UsesAbilityGenderFlags(project)) {
      pidMod = gen4ApplyTrainerMonOverrideFlags(
        pidMod,
        speciesId,
        Number(personal.raw.gender ?? 0),
        Number(trpok.raw[`ability_${currentSlot}`] ?? 0),
        gen4UsesOutdatedAiBackport(project),
      );
    }
  }

  const speciesId = Number(trpok.raw[`species_id_${slot}`] ?? 0);
  const level = Number(trpok.raw[`level_${slot}`] ?? 0);
  const difficulty = Number(trpok.raw[`ivs_${slot}`] ?? 0);
  const random = gen4TrainerRandom(trainerId + speciesId + level + difficulty, trainerClass);
  return ((random << 8) + pidMod) >>> 0;
}

function gen4TrainerRandom(seed: number, trainerClass: number): number {
  let state = seed >>> 0;
  let random = 0;
  for (let n = 0; n < trainerClass; n += 1) {
    state = (Math.imul(1103515245, state) + 24691) >>> 0;
    random = state >>> 16;
  }
  return random;
}

function gen4ApplyTrainerMonOverrideFlags(pidMod: number, speciesId: number, baseGenderRatio: number, abilityGender: number, outdatedAiBackport: boolean): number {
  const genderOverride = abilityGender & 0x0f;
  const abilityOverride = abilityGender >>> 4;
  if (genderOverride > 0 || abilityOverride > 0) {
    if (outdatedAiBackport) pidMod = speciesId;
    if (genderOverride === 1) pidMod = baseGenderRatio + 2;
    else if (genderOverride === 2) pidMod = baseGenderRatio - 2;
    if (abilityOverride === 1) pidMod &= ~1;
    else if (abilityOverride === 2) pidMod |= 1;
  }
  return outdatedAiBackport ? pidMod : pidMod & 0xff;
}

function gen4TrainerClassIsMale(project: ProjectState, trainerClass: number): boolean {
  const family = project.session.baseRom as Gen4BaseRom;
  const table = GEN4_TRAINER_CLASS_GENDER_TABLES[family];
  if (!table || trainerClass < 0 || trainerClass >= table.length) return true;
  const offset = table.offsets.find((candidate) => candidate + table.length <= project.arm9.length);
  if (offset === undefined) return true;
  return project.arm9[offset + trainerClass] !== 1;
}

function gen4UsesAbilityGenderFlags(project: ProjectState): boolean {
  return project.session.baseRom === "HGSS" || gen4UsesAiBackport(project);
}

function gen4UsesAiBackport(project: ProjectState): boolean {
  if (project.session.baseRom !== "Pt") return false;
  if (project.romInfo.idCode.toUpperCase() === "JAK7") return true;
  return project.arm9[0x0793b8] === 0xf0 && project.arm9[0x0793b9] === 0xb5 && project.arm9[0x0793ba] === 0x93 && project.arm9[0x0793bb] === 0xb0;
}

function gen4UsesOutdatedAiBackport(project: ProjectState): boolean {
  return project.session.baseRom === "Pt" && project.arm9[0x0795a2] === 0x1d && project.arm9[0x0795a3] === 0x1c && project.arm9[0x0795a4] === 0x0f && project.arm9[0x0795a5] === 0x23;
}

function getTrainerPokemonSlot(project: ProjectState, trainerId: number, slot: number, displayedAbilitySlot?: number): TrainerPokemonSlot {
  const trpok = decodeRecord(project, "trpok", trainerId);
  if (!trpok.raw || !trpok.readable) throw new Error(`Unable to decode trainer Pokemon ${trainerId}:${slot}`);
  const speciesId = Number(trpok.raw[`species_id_${slot}`] ?? 0);
  const speciesName = String(trpok.readable[`species_id_${slot}`] ?? speciesId);
  const abilitySlot = Number(trpok.readable[`ability_${slot}`] ?? 0);
  const resolvedAbilitySlot = displayedAbilitySlot ?? abilitySlot;
  const natureValue = trainerNatureRawValue(trpok.raw[`padding_${slot}`]);
  const form = Number(trpok.raw[`form_${slot}`] ?? 0);
  return {
    slot,
    speciesId,
    speciesName,
    spriteSlug: trainerPokemonSpriteSlug(speciesName, form),
    level: Number(trpok.raw[`level_${slot}`] ?? 0),
    ivs: Number(trpok.raw[`ivs_${slot}`] ?? 0),
    abilitySlot,
    resolvedAbilitySlot,
    abilityName: abilityName(project, speciesId, resolvedAbilitySlot),
    gender: String(trpok.readable[`gender_${slot}`] ?? "Default"),
    form,
    itemName: trpok.readable[`item_id_${slot}`],
    moves: [1, 2, 3, 4].map((move) => trpok.readable?.[`move_${move}_${slot}`] ?? 0),
    nature: calculateTrainerPokemonNature(project, trainerId, slot),
    natureSetting: trainerNatureSetting(natureValue),
    natureValue,
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

function trainerChangelogSubject(project: ProjectState, trainerId: number): string {
  const name = project.texts.banks.tr_names?.[trainerId] ?? `Trainer ${trainerId}`;
  return `${name} (Trainer ${trainerId})`;
}

function trainerFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
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
    readable[`species_id_${slot}`] = pokemonName(project, speciesId);
    const abilityByte = raw[`ability_${slot}`] === 255 ? 0 : raw[`ability_${slot}`] ?? 0;
    raw[`ability_${slot}`] = abilityByte;
    readable[`ability_${slot}`] = Math.floor(abilityByte / 16);
    readable[`gender_${slot}`] = TRAINER_GENDERS[Math.min(abilityByte % 16, 2)] ?? "Default";
    readable[`nature_${slot}`] = trainerNatureSetting(raw[`padding_${slot}`]);
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
  const cascadeAbility = cascadeWhiteTrainerAbilityName(project, speciesId, abilitySlot);
  if (cascadeAbility) return cascadeAbility;
  const personalId = normalizedSpeciesId(speciesId);
  if (!project.narcs.personal || personalId >= project.narcs.personal.fileCount) return "";
  const personal = decodeRecord(project, "personal", personalId);
  const slot = Math.min(Math.max(abilitySlot, 1), 3);
  if (isGen4Project(project) && slot === 2 && Number(personal.raw?.ability_2 ?? 0) === 0) return personal.readable?.ability_1 ?? "";
  return personal.readable?.[`ability_${slot}`] ?? "";
}

function trainerAbilitySlotFromShowdown(project: ProjectState, speciesId: number, inputValue: string): number {
  const numeric = Number(inputValue.trim());
  const maxSlot = trainerAbilitySlotMax(project);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= maxSlot) return numeric;
  const normalizedInput = normalizeName(inputValue);
  for (let slot = 1; slot <= maxSlot; slot += 1) {
    if (normalizeName(String(abilityName(project, speciesId, slot))) === normalizedInput) return slot;
  }
  throw new Error(`Unknown ability for ${pokemonName(project, speciesId)}: ${inputValue}`);
}

function pokemonNameAutofills(project: ProjectState): string[] {
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, project.narcs.personal?.fileCount ?? 0);
  return Array.from({ length: count }, (_unused, speciesId) => String(pokemonName(project, speciesId)));
}

function pokemonName(project: ProjectState, speciesId: number): string | number {
  const personalId = normalizedSpeciesId(speciesId);
  return cascadeWhitePersonalName(project, personalId) ?? project.texts.banks.pokedex?.[personalId] ?? speciesId;
}

function findPokemonValueIndex(project: ProjectState, inputValue: string): number {
  const numeric = Number(inputValue.trim());
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, project.narcs.personal?.fileCount ?? 0);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < count) return numeric;
  const normalizedInput = normalizeName(inputValue);
  for (let speciesId = 0; speciesId < count; speciesId += 1) {
    if (normalizeName(String(pokemonName(project, speciesId))) === normalizedInput) return speciesId;
  }
  throw new Error(`Unknown Pokemon: ${inputValue}`);
}

function normalizedSpeciesId(speciesId: number): number {
  return speciesId % 1024;
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

function parseTrainerNatureValue(inputValue: string): number {
  const trimmed = inputValue.trim();
  if (trimmed === "" || normalizeName(trimmed) === "auto") return 0;

  const numeric = Number(trimmed);
  if (Number.isInteger(numeric)) {
    if (numeric < 0 || numeric > NATURES.length) throw new Error(`Nature must be Auto or an integer between 0 and ${NATURES.length}`);
    return numeric;
  }

  const index = NATURES.findIndex((nature) => normalizeName(nature) === normalizeName(trimmed));
  if (index < 0) throw new Error(`Unknown nature: ${inputValue}`);
  return index + 1;
}

function trainerNatureRawValue(value: number | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= NATURES.length ? numeric : 0;
}

function trainerNatureName(value: number | undefined): string | undefined {
  const rawValue = trainerNatureRawValue(value);
  return rawValue === 0 ? undefined : NATURES[rawValue - 1];
}

function trainerNatureSetting(value: number | undefined): string {
  return trainerNatureName(value) ?? "Auto";
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

export function trainerPokemonSpriteSlug(speciesName: string, formIndex: number): string {
  const formSuffix = pokemonFormSuffix(speciesName, formIndex);
  return pokemonSpriteSlug(formSuffix ? `${speciesName}-${formSuffix}` : speciesName);
}

function showdownGender(value: string): "M" | "F" | undefined {
  if (value === "Male") return "M";
  if (value === "Female") return "F";
  return undefined;
}

function optionalShowdownValue(value: unknown): string {
  if (isEmptyShowdownValue(value)) return "";
  return showdownName(value);
}

function isEmptyShowdownValue(value: unknown): boolean {
  const text = String(value ?? "").trim();
  const normalized = normalizeName(text);
  return text === "" || text === "0" || normalized === "none" || normalized === "noitem";
}

function showdownName(value: unknown): string {
  const titled = String(value ?? "")
    .replace(/_/gu, " ")
    .split(/([\s-]+)/u)
    .map((part) => (/^[a-z]/iu.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("")
    .replace(/Porygon Z/gu, "Porygon-Z")
    .replace(/Ho Oh/gu, "Ho-Oh")
    .replace(/'/gu, "'");
  return titled;
}
