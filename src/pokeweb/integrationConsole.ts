import {
  ENCOUNTER_GRASS_FIELDS,
  ENCOUNTER_SEASONS,
  ENCOUNTER_WATER_FIELDS,
  TYPES,
} from "./constants";
import { exportModifiedRom } from "./exportRom";
import { getEncounterRecord, updateEncounterField } from "./encounterModel";
import { getMartRecord, updateMartField } from "./martGrottoModel";
import { getMoveRecord, updateMoveField } from "./moveItemModel";
import { getPokemonRecord, updatePokemonField } from "./pokemonModel";
import { saveActiveProject } from "./persistence";
import { decodeRecord, type ProjectState } from "./projectStore";
import { getTextBank, updateTextEntry, type TextNarcName } from "./textModel";
import { ensureTms, updateTmMove } from "./tmModel";
import {
  addTrainerPokemon,
  deleteTrainerPokemon,
  getTrainerRecord,
  updateTrainerField,
  updateTrainerPokemonField,
} from "./trainerModel";

type IntegrationChangeSet = {
  version: 1;
  generatedAt: string;
  romName: string;
  notes: string[];
  pokemon: {
    id: 1;
    stats: Record<string, number>;
    types: Record<string, { id: number; name: string }>;
    abilities: Record<string, { id: number; name: string }>;
    learnset: Array<{ field: string; moveId: number; moveName: string }>;
    evolution: { paramField: string; param: number; targetField: string; targetId: number; targetName: string };
  };
  trainer: {
    id: 1;
    hasMoves: true;
    hasItems: true;
    party: Array<{
      slot: number;
      speciesId: number;
      speciesName: string;
      level: number;
      itemId: number;
      itemName: string;
      moves: Array<{ field: string; moveId: number; moveName: string }>;
    }>;
  };
  encounters: { id: number; slots: Array<{ field: string; speciesId: number; speciesName: string }> };
  move: { id: 1; power: number; accuracy: number };
  tm: { field: "tm_1"; moveId: number; moveName: string };
  mart?: { id: 1; itemId: number; itemName: "Master Ball"; fields: string[] };
  texts: Array<{ narcName: TextNarcName; bankId: 0; entryIndex: 0; value: string }>;
};

type VerificationResult = {
  ok: boolean;
  checked: number;
  failures: string[];
};

type IntegrationApi = {
  mutateAndDownload: () => Promise<IntegrationChangeSet>;
  verify: (changes: IntegrationChangeSet | string) => VerificationResult;
};

export function installIntegrationConsoleApi(getProject: () => ProjectState | undefined, markDirty: () => void): void {
  const api: IntegrationApi = {
    mutateAndDownload: async () => {
      const project = requireProject(getProject());
      const changes = mutateProject(project);
      markDirty();
      await saveActiveProject(project);
      const bytes = await exportModifiedRom(project);
      downloadBytes(bytes, `${project.session.romName || "pokeweb"}-integration-test.nds`);
      console.log("Pokeweb integration test changes:", changes);
      console.log("Pokeweb integration test changes JSON:", JSON.stringify(changes));
      return changes;
    },
    verify: (input) => {
      const project = requireProject(getProject());
      const changes = typeof input === "string" ? (JSON.parse(input) as IntegrationChangeSet) : input;
      const result = verifyProject(project, changes);
      console.log("Pokeweb integration test verification:", result);
      return result;
    },
  };

  (window as Window & { pokewebIntegrationTest?: IntegrationApi }).pokewebIntegrationTest = api;
}

function mutateProject(project: ProjectState): IntegrationChangeSet {
  requireLoaded(project, ["personal", "learnsets", "evolutions", "trdata", "trpok", "encounters", "moves", "items", "message_texts", "story_texts"]);
  const notes = ["Trainer Pokemon support four moves per Pokemon in Gen V, so each of the six party slots receives four random moves."];
  const changes: IntegrationChangeSet = {
    version: 1,
    generatedAt: new Date().toISOString(),
    romName: project.session.romName,
    notes,
    pokemon: mutateBulbasaur(project),
    trainer: mutateTrainer(project),
    encounters: mutateEncounter(project, 9),
    move: mutateMove(project),
    tm: mutateTm(project),
    texts: mutateTexts(project),
  };
  const mart = mutateMart(project);
  if (mart) changes.mart = mart;
  return changes;
}

function mutateBulbasaur(project: ProjectState): IntegrationChangeSet["pokemon"] {
  const id = 1;
  const stats: Record<string, number> = {};
  for (const field of ["base_hp", "base_atk", "base_def", "base_spatk", "base_spdef", "base_speed"]) {
    const value = randomInt(1, 255);
    updatePokemonField(project, id, "personal", field, String(value));
    stats[field] = value;
  }

  const types: IntegrationChangeSet["pokemon"]["types"] = {};
  for (const field of ["type_1", "type_2"]) {
    const typeId = randomInt(0, TYPES.length - 1);
    updatePokemonField(project, id, "personal", field, TYPES[typeId]);
    types[field] = { id: typeId, name: TYPES[typeId] };
  }

  const abilities: IntegrationChangeSet["pokemon"]["abilities"] = {};
  for (const field of ["ability_1", "ability_2", "ability_3"]) {
    const abilityId = randomBankId(project.texts.banks.abilities ?? [], 1);
    const abilityName = project.texts.banks.abilities?.[abilityId] ?? String(abilityId);
    updatePokemonField(project, id, "personal", field, abilityName);
    abilities[field] = { id: abilityId, name: abilityName };
  }

  const learnsetRecord = decodeRecord(project, "learnsets", id);
  const learnset: IntegrationChangeSet["pokemon"]["learnset"] = [];
  for (const field of Object.keys(learnsetRecord.raw ?? {}).filter((key) => key.startsWith("move_id_"))) {
    const moveId = randomMoveId(project);
    const moveName = moveNameFor(project, moveId);
    updatePokemonField(project, id, "learnset", field, moveName);
    learnset.push({ field, moveId, moveName });
  }

  const targetId = randomPokemonId(project);
  const targetName = pokemonNameFor(project, targetId);
  const param = randomInt(1, 99);
  updatePokemonField(project, id, "evolutions", "param_0", String(param));
  updatePokemonField(project, id, "evolutions", "target_0", targetName);

  return {
    id,
    stats,
    types,
    abilities,
    learnset,
    evolution: { paramField: "param_0", param, targetField: "target_0", targetId, targetName },
  };
}

function mutateTrainer(project: ProjectState): IntegrationChangeSet["trainer"] {
  const trainerId = 1;
  let trainer = getTrainerRecord(project, trainerId);
  while (trainer.party.length > 6) {
    deleteTrainerPokemon(project, trainerId, trainer.party.length - 1);
    trainer = getTrainerRecord(project, trainerId);
  }
  while (trainer.party.length < 6) {
    addTrainerPokemon(project, trainerId);
    trainer = getTrainerRecord(project, trainerId);
  }

  updateTrainerField(project, trainerId, "has_moves", true);
  updateTrainerField(project, trainerId, "has_items", true);

  const party: IntegrationChangeSet["trainer"]["party"] = [];
  for (let slot = 0; slot < 6; slot += 1) {
    const speciesId = randomPokemonId(project);
    const speciesName = pokemonNameFor(project, speciesId);
    const level = randomInt(1, 100);
    const initialItemName = itemNameFor(project, randomItemId(project));
    const speciesResult = updateTrainerPokemonField(project, trainerId, slot, `species_id_${slot}`, speciesName);
    updateTrainerPokemonField(project, trainerId, slot, `level_${slot}`, String(level));
    const itemResult = updateTrainerPokemonField(project, trainerId, slot, `item_id_${slot}`, initialItemName);
    const moves: Array<{ field: string; moveId: number; moveName: string }> = [];
    for (let moveSlot = 1; moveSlot <= 4; moveSlot += 1) {
      const moveId = randomMoveId(project);
      const moveName = moveNameFor(project, moveId);
      const field = `move_${moveSlot}_${slot}`;
      const moveResult = updateTrainerPokemonField(project, trainerId, slot, field, moveName);
      moves.push({ field, moveId: moveResult.rawValue, moveName: String(moveResult.value) });
    }
    party.push({
      slot,
      speciesId: speciesResult.rawValue,
      speciesName: String(speciesResult.value),
      level,
      itemId: itemResult.rawValue,
      itemName: String(itemResult.value),
      moves,
    });
  }

  return { id: trainerId, hasMoves: true, hasItems: true, party };
}

function mutateEncounter(project: ProjectState, encounterId: number): IntegrationChangeSet["encounters"] {
  const record = getEncounterRecord(project, encounterId);
  const slots: IntegrationChangeSet["encounters"]["slots"] = [];
  for (const field of encounterSpeciesFields()) {
    const rawValue = record.raw[field] ?? 0;
    if (rawValue % 2048 === 0) continue;
    const speciesId = randomPokemonId(project);
    const speciesName = pokemonNameFor(project, speciesId);
    updateEncounterField(project, encounterId, field, speciesName);
    slots.push({ field, speciesId, speciesName });
  }
  return { id: encounterId, slots };
}

function mutateMove(project: ProjectState): IntegrationChangeSet["move"] {
  const power = randomInt(1, 100);
  const accuracy = randomInt(1, 100);
  updateMoveField(project, 1, "power", String(power));
  updateMoveField(project, 1, "accuracy", String(accuracy));
  return { id: 1, power, accuracy };
}

function mutateTm(project: ProjectState): IntegrationChangeSet["tm"] {
  const moveId = randomMoveId(project);
  const moveName = moveNameFor(project, moveId);
  updateTmMove(project, "tm_1", moveName);
  return { field: "tm_1", moveId, moveName };
}

function mutateMart(project: ProjectState): IntegrationChangeSet["mart"] | undefined {
  if (project.session.baseRom !== "BW2" || !project.narcs.marts) return undefined;
  const itemId = findBankId(project.texts.banks.items ?? [], "Master Ball");
  const itemName = "Master Ball" as const;
  const fields: string[] = [];
  const mart = getMartRecord(project, 1);
  for (let slot = 0; slot < 20; slot += 1) {
    const field = `item_${slot}`;
    if (Number(mart.raw[field] ?? 0) === 0) continue;
    updateMartField(project, 1, field, itemName);
    fields.push(field);
  }
  return { id: 1, itemId, itemName, fields };
}

function mutateTexts(project: ProjectState): IntegrationChangeSet["texts"] {
  const value = "This is a test message";
  const texts: IntegrationChangeSet["texts"] = [];
  for (const narcName of ["message_texts", "story_texts"] as const) {
    updateTextEntry(project, narcName, 0, 0, value);
    texts.push({ narcName, bankId: 0, entryIndex: 0, value });
  }
  return texts;
}

function verifyProject(project: ProjectState, changes: IntegrationChangeSet): VerificationResult {
  const failures: string[] = [];
  let checked = 0;
  const check = (condition: boolean, label: string) => {
    checked += 1;
    if (!condition) failures.push(label);
  };

  const pokemon = getPokemonRecord(project, changes.pokemon.id);
  for (const [field, value] of Object.entries(changes.pokemon.stats)) check(pokemon.rawPersonal[field] === value, `Pokemon ${field}`);
  for (const [field, value] of Object.entries(changes.pokemon.types)) check(pokemon.rawPersonal[field] === value.id, `Pokemon ${field}`);
  for (const [field, value] of Object.entries(changes.pokemon.abilities)) check(pokemon.rawPersonal[field] === value.id, `Pokemon ${field}`);
  const learnset = decodeRecord(project, "learnsets", changes.pokemon.id).raw ?? {};
  for (const change of changes.pokemon.learnset) check(learnset[change.field] === change.moveId, `Learnset ${change.field}`);
  const evolution = decodeRecord(project, "evolutions", changes.pokemon.id).raw ?? {};
  check(evolution[changes.pokemon.evolution.paramField] === changes.pokemon.evolution.param, "Evolution param");
  check(evolution[changes.pokemon.evolution.targetField] === changes.pokemon.evolution.targetId, "Evolution target");

  const trdata = decodeRecord(project, "trdata", changes.trainer.id).raw ?? {};
  check((trdata.template & 1) !== 0, "Trainer has_moves");
  check((trdata.template & 2) !== 0, "Trainer has_items");
  check(trdata.num_pokemon === 6, "Trainer party count");
  const trpok = decodeRecord(project, "trpok", changes.trainer.id).raw ?? {};
  for (const pok of changes.trainer.party) {
    check(trpok[`species_id_${pok.slot}`] === pok.speciesId, `Trainer slot ${pok.slot} species`);
    check(trpok[`level_${pok.slot}`] === pok.level, `Trainer slot ${pok.slot} level`);
    check(trpok[`item_id_${pok.slot}`] === pok.itemId, `Trainer slot ${pok.slot} item`);
    for (const move of pok.moves) check(trpok[move.field] === move.moveId, `Trainer slot ${pok.slot} ${move.field}`);
  }

  const encounter = getEncounterRecord(project, changes.encounters.id);
  for (const slot of changes.encounters.slots) check((encounter.raw[slot.field] ?? 0) % 2048 === slot.speciesId, `Encounter ${slot.field}`);

  const move = getMoveRecord(project, changes.move.id);
  check(move.raw.power === changes.move.power, "Move 1 power");
  check(move.raw.accuracy === changes.move.accuracy, "Move 1 accuracy");
  check(ensureTms(project).raw[changes.tm.field] === changes.tm.moveId, "TM01 move");

  if (changes.mart) {
    const mart = getMartRecord(project, changes.mart.id);
    for (const field of changes.mart.fields) check(mart.raw[field] === changes.mart.itemId, `Mart ${field}`);
  }

  for (const text of changes.texts) {
    check(getTextBank(project, text.narcName, text.bankId)[text.entryIndex]?.[1] === text.value, `${text.narcName} bank ${text.bankId} msg ${text.entryIndex}`);
  }

  return { ok: failures.length === 0, checked, failures };
}

function encounterSpeciesFields(): string[] {
  const fields: string[] = [];
  for (const season of ENCOUNTER_SEASONS) {
    for (const kind of ENCOUNTER_GRASS_FIELDS) {
      for (let slot = 0; slot < 12; slot += 1) fields.push(`${season}_${kind}_slot_${slot}`);
    }
    for (const kind of ENCOUNTER_WATER_FIELDS) {
      for (let slot = 0; slot < 5; slot += 1) fields.push(`${season}_${kind}_slot_${slot}`);
    }
  }
  return fields;
}

function requireProject(project: ProjectState | undefined): ProjectState {
  if (!project) throw new Error("No Pokeweb project is loaded.");
  return project;
}

function requireLoaded(project: ProjectState, names: string[]): void {
  const missing = names.filter((name) => !project.narcs[name as keyof ProjectState["narcs"]]);
  if (missing.length > 0) throw new Error(`Missing loaded data for integration test: ${missing.join(", ")}`);
}

function randomPokemonId(project: ProjectState): number {
  return randomBankId(project.texts.banks.pokedex ?? [], 1, Math.max(1, (project.narcs.personal?.fileCount ?? 2) - 1));
}

function randomMoveId(project: ProjectState): number {
  return randomBankId(project.texts.banks.moves ?? [], 1, Math.max(1, (project.narcs.moves?.fileCount ?? 2) - 1));
}

function randomItemId(project: ProjectState): number {
  return randomBankId(project.texts.banks.items ?? [], 1, Math.max(1, (project.narcs.items?.fileCount ?? 2) - 1));
}

function randomBankId(bank: string[], min: number, max = bank.length - 1): number {
  const candidates = bank
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => index >= min && index <= max && value.trim() !== "" && value !== "None");
  if (candidates.length === 0) return randomInt(min, Math.max(min, max));
  return candidates[randomInt(0, candidates.length - 1)].index;
}

function findBankId(bank: string[], value: string): number {
  const index = bank.findIndex((entry) => normalize(entry) === normalize(value));
  if (index < 0) throw new Error(`Unable to find ${value} in text bank.`);
  return index;
}

function pokemonNameFor(project: ProjectState, id: number): string {
  return project.texts.banks.pokedex?.[id] ?? String(id);
}

function moveNameFor(project: ProjectState, id: number): string {
  return project.texts.banks.moves?.[id] ?? String(id);
}

function itemNameFor(project: ProjectState, id: number): string {
  return project.texts.banks.items?.[id] ?? String(id);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
