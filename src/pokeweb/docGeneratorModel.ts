import vanillaAbilitiesText from "../assets/data/vanilla_abilities.txt?raw";
import vanillaItemsText from "../assets/data/vanilla_items.txt?raw";
import vanillaMovesText from "../assets/data/vanilla_moves.txt?raw";
import vanillaPokedexText from "../assets/data/vanilla_pokedex.txt?raw";
import { readU16, readU32 } from "../nds/binary";
import { BATTLE_TYPES, CATEGORIES, TYPES } from "./constants";
import { getEncounterCount, getEncounterRecord } from "./encounterModel";
import { parseHeaders } from "./headerModel";
import { getMartCount, getMartRecord } from "./martGrottoModel";
import { getItemCount, getItemRecord, getMoveCount, getMoveRecord } from "./moveItemModel";
import { getPokemonCount, getPokemonRecord, getPokemonSummaryRecord } from "./pokemonModel";
import { decodeRecord, type DocGeneratorState, type ProjectState, type ReadableRecord } from "./projectStore";
import { getTextBank } from "./textModel";
import { getTrainerCount, getTrainerRecord, type TrainerRecord } from "./trainerModel";

export type DownloadFile = {
  filename: string;
  contents: string;
  mimeType: string;
};

export type EnrichmentResult = {
  count: number;
  message: string;
};

type SearchCollection = Record<string, { name?: string; types?: string[]; type?: string; t?: string }>;

const SHOWDOWN_SUBS: Record<string, string> = {
  Bubblebeam: "Bubble Beam",
  Doubleslap: "Double Slap",
  Solarbeam: "Solar Beam",
  Sonicboom: "Sonic Boom",
  Poisonpowder: "Poison Powder",
  Thunderpunch: "Thunder Punch",
  Thundershock: "Thunder Shock",
  Ancientpower: "Ancient Power",
  Extremespeed: "Extreme Speed",
  Dragonbreath: "Dragon Breath",
  Dynamicpunch: "Dynamic Punch",
  Grasswhistle: "Grass Whistle",
  "Faint Attack": "Feint Attack",
  Smellingsalt: "Smelling Salts",
  "Roar Of Time": "Roar of Time",
  "U-Turn": "U-turn",
  "V-Create": "V-create",
  "Sand-Attack": "Sand Attack",
  Selfdestruct: "Self-Destruct",
  Softboiled: "Soft-Boiled",
  Vicegrip: "Vise Grip",
  "Hi Jump Kick": "High Jump Kick",
};

const VANILLA = {
  pokedex: lines(vanillaPokedexText),
  moves: lines(vanillaMovesText),
  abilities: lines(vanillaAbilitiesText),
  items: lines(vanillaItemsText),
};

export function ensureDocs(project: ProjectState): DocGeneratorState {
  project.docs ??= {
    romTitle: project.session.romName,
    trainerLocations: {},
    itemLocations: {},
    groundItemScriptMap: {},
  };
  project.docs.romTitle ||= project.session.romName;
  project.docs.trainerLocations ??= {};
  project.docs.itemLocations ??= {};
  project.docs.groundItemScriptMap ??= {};
  return project.docs;
}

export function setDocRomTitle(project: ProjectState, title: string): void {
  ensureDocs(project).romTitle = title;
}

export function generateCalcDownload(project: ProjectState, title: string): DownloadFile {
  const payload = buildCalcPayload(project, title.trim());
  return {
    filename: `${safeFilename(title)}-calc.js`,
    contents: `backup_data = ${JSON.stringify(payload, null, 2)};\n`,
    mimeType: "text/javascript",
  };
}

export function generateDexDownloads(project: ProjectState, title: string): DownloadFile[] {
  const overrides = buildDexOverrides(project);
  const safeTitle = safeFilename(title);
  return [
    {
      filename: `${safeTitle}.js`,
      contents: `overrides = ${JSON.stringify(overrides, null, 2)};\n`,
      mimeType: "text/javascript",
    },
    {
      filename: `${safeTitle}_searchindex.js`,
      contents: buildSearchIndexJs(overrides),
      mimeType: "text/javascript",
    },
  ];
}

export function enrichTrainerLocations(project: ProjectState): EnrichmentResult {
  requireNarcs(project, ["headers", "overworlds"]);
  const docs = ensureDocs(project);
  docs.trainerLocations = {};
  if (!project.headers) project.headers = parseHeaders(project);

  const overworlds = project.narcs.overworlds;
  let count = 0;
  for (let overworldId = 0; overworldId < (overworlds?.fileCount ?? 0); overworldId += 1) {
    const record = decodeRecord(project, "overworlds", overworldId);
    const raw = record.raw;
    if (!raw) continue;
    const location = locationForOverworld(project, overworldId);
    const npcCount = Number(raw.npc_count ?? 0);
    for (let npc = 0; npc < npcCount; npc += 1) {
      const scriptId = Number(raw[`npc_${npc}_script_id`] ?? 0);
      if (!((scriptId > 3000 && scriptId < 4000) || (scriptId > 5000 && scriptId < 6000))) continue;
      const trainerId = scriptId % 1000;
      addUnique(docs.trainerLocations, trainerId, location);
      count += 1;
    }
  }

  return { count, message: `Found ${Object.keys(docs.trainerLocations).length} trainers across ${count} overworld NPCs.` };
}

export function enrichItemLocations(project: ProjectState): EnrichmentResult {
  requireNarcs(project, ["headers", "overworlds", "scripts", "items"]);
  const docs = ensureDocs(project);
  docs.itemLocations = {};
  const scriptMap = buildGroundItemScriptMap(project);
  docs.groundItemScriptMap = Object.fromEntries([...scriptMap].map(([scriptId, itemId]) => [String(scriptId), itemId]));

  const overworlds = project.narcs.overworlds;
  let groundCount = 0;
  for (let overworldId = 0; overworldId < (overworlds?.fileCount ?? 0); overworldId += 1) {
    const record = decodeRecord(project, "overworlds", overworldId);
    const raw = record.raw;
    if (!raw) continue;
    const location = locationForOverworld(project, overworldId);
    const npcCount = Number(raw.npc_count ?? 0);
    for (let npc = 0; npc < npcCount; npc += 1) {
      const scriptId = Number(raw[`npc_${npc}_script_id`] ?? 0);
      if (scriptId <= 7000 || scriptId > 7400) continue;
      const itemId = scriptMap.get(scriptId);
      if (itemId === undefined) continue;
      addUnique(docs.itemLocations, itemId, location);
      groundCount += 1;
    }
  }
  const derivedCount = enrichDerivedItemSources(project);

  return {
    count: groundCount + derivedCount,
    message: `Found ${Object.keys(docs.itemLocations).length} items across ${groundCount} ground item NPCs and ${derivedCount} derived sources.`,
  };
}

export function parseGroundItemScripts(bytes: Uint8Array): Map<number, number> {
  const starts = scriptStarts(bytes);
  const sorted = [...starts].sort((a, b) => a - b);
  const map = new Map<number, number>();
  starts.forEach((start, scriptIndex) => {
    const end = sorted.find((candidate) => candidate > start) ?? bytes.length;
    for (let offset = start; offset + 6 <= end; offset += 2) {
      if (readU16(bytes, offset) !== 0x28) continue;
      if (readU16(bytes, offset + 2) !== 32780) continue;
      map.set(7000 + scriptIndex, readU16(bytes, offset + 4));
      break;
    }
  });
  return map;
}

export function buildGroundItemScriptMap(project: ProjectState): Map<number, number> {
  const store = project.narcs.scripts;
  if (!store) throw new Error("Scripts NARC is not loaded.");
  const scriptFileId = project.session.baseRom === "BW2" ? 1240 : 864;
  const bytes = store.rawFiles[scriptFileId];
  if (!bytes) throw new Error(`Global item script file ${scriptFileId} is not loaded.`);
  return parseGroundItemScripts(bytes);
}

function buildCalcPayload(project: ProjectState, title: string): Record<string, unknown> {
  return {
    title,
    pok_replacements: replacementMap(VANILLA.pokedex, project.texts.banks.pokedex ?? [], (value) =>
      toId(String(value).replace(/fletcinder/iu, "fletchinder").replace(/lycanrocm/iu, "lycanrocmidnight")),
    ),
    move_replacements: replacementMap(VANILLA.moves, project.texts.banks.moves ?? [], (value) => toId(showdownName(value))),
    ability_replacements: replacementMap(VANILLA.abilities, project.texts.banks.abilities ?? [], toId),
    item_replacements: replacementMap(VANILLA.items, project.texts.banks.items ?? [], toId),
    moves: buildCalcMoves(project),
    poks: buildCalcPokemon(project),
    formatted_sets: buildFormattedTrainerSets(project),
  };
}

function buildDexOverrides(project: ProjectState): Record<string, unknown> {
  return {
    poks: buildDexPokemon(project),
    moves: buildDexMoves(project),
    abilities: buildDexAbilities(project),
    encs: buildDexEncounters(project),
    items: buildDexItems(project),
  };
}

function buildCalcMoves(project: ProjectState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let id = 1; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    const name = showdownName(project.texts.banks.moves?.[id] ?? move.readable.name ?? `Move ${id}`);
    out[name] = {
      type: titleize(move.readable.type),
      basePower: move.readable.power ?? 0,
      category: move.readable.category ?? "Status",
      pp: move.readable.pp ?? 0,
      accuracy: move.readable.accuracy ?? 0,
      priority: move.readable.priority ?? 0,
      e_id: move.raw.effect ?? 0,
      ...(move.readable.target === "All adjacent opponents" ? { target: "allAdjacentFoes" } : {}),
      ...(move.readable.target === "All excluding user" ? { target: "allAdjacent" } : {}),
      ...(Number(move.readable.crit ?? 0) === 6 ? { willCrit: true } : {}),
      ...(Number(move.readable.min_hits ?? 0) > 0 ? { multihit: [move.readable.min_hits, move.readable.max_hits] } : {}),
      ...(Number(move.readable.recoil ?? 0) > 0 && Number(move.readable.recoil ?? 0) < 100 ? { recoil: [move.readable.recoil, 100] } : {}),
      ...(String(move.readable.effect_category ?? "").toLowerCase().includes("stat") ? { sf: true } : {}),
      ...moveFlags(move.readable),
    };
  }
  return out;
}

function buildDexMoves(project: ProjectState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const descriptions = moveDescriptions(project);
  for (let id = 1; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    const name = showdownName(project.texts.banks.moves?.[id] ?? move.readable.name ?? `Move ${id}`);
    out[name] = {
      t: titleize(move.readable.type),
      bp: move.readable.power ?? 0,
      cat: move.readable.category ?? "Status",
      pp: move.readable.pp ?? 0,
      acc: move.readable.accuracy ?? 0,
      prio: move.readable.priority ?? 0,
      name,
      num: id - 1,
      desc: descriptions[id] ?? "",
      e_id: move.raw.effect ?? 0,
      ...(move.readable.target === "All adjacent opponents" ? { tar: "allAdjacentFoes" } : {}),
      ...(move.readable.target === "All excluding user" ? { tar: "allAdjacent" } : {}),
      ...(Number(move.readable.crit ?? 0) === 6 ? { willCrit: true } : {}),
      ...(Number(move.readable.min_hits ?? 0) > 0 ? { multihit: [move.readable.min_hits, move.readable.max_hits] } : {}),
      ...(Number(move.readable.recoil ?? 0) > 0 && Number(move.readable.recoil ?? 0) < 100 ? { recoil: [move.readable.recoil, 100] } : {}),
      ...(String(move.readable.effect_category ?? "").toLowerCase().includes("stat") ? { sf: true } : {}),
      ...moveFlags(move.readable),
    };
  }
  return out;
}

function buildCalcPokemon(project: ProjectState): Record<string, unknown> {
  return buildDexPokemon(project);
}

function buildDexPokemon(project: ProjectState): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const record = getPokemonRecord(project, id);
    const name = titleizeName(record.personal.name ?? project.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`);
    const types = [record.personal.type_1, record.personal.type_2].map((type) => String(type ?? "")).filter(Boolean);
    out[name] = {
      name,
      num: id,
      types: types[0] === types[1] ? [types[0]] : types,
      items: [record.personal.item_1, record.personal.item_2, record.personal.item_3],
      bs: {
        hp: record.personal.base_hp ?? 0,
        at: record.personal.base_atk ?? 0,
        df: record.personal.base_def ?? 0,
        sa: record.personal.base_spatk ?? 0,
        sd: record.personal.base_spdef ?? 0,
        sp: record.personal.base_speed ?? 0,
      },
      learnset_info: {
        learnset: record.learnset.slice(0, 25).map((move) => [move.level, showdownName(move.moveName)]),
        tms: record.tmCompatibility.filter((tm) => tm.enabled).map((tm) => showdownName(tm.moveName)),
      },
      abs: [record.personal.ability_1, record.personal.ability_2, record.personal.ability_3].map((ability) => titleizeAbility(ability)),
    };
  }

  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const record = getPokemonRecord(project, id);
    const sourceName = titleizeName(record.personal.name ?? project.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`);
    for (const evo of record.evolutions) {
      const target = titleizeName(evo.target);
      if (!target || target === "0" || !out[target] || Number(evo.param) === 0) continue;
      out[sourceName].evos ??= [];
      out[sourceName].evoMethods ??= [];
      out[sourceName].evoParams ??= [];
      (out[sourceName].evos as string[]).push(target);
      (out[sourceName].evoMethods as string[]).push(String(evo.method));
      (out[sourceName].evoParams as Array<string | number>).push(evo.param);
    }
  }
  return out;
}

function buildDexAbilities(project: ProjectState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ability of project.texts.banks.abilities ?? []) {
    const name = titleizeAbility(ability);
    if (!name || name === "None") continue;
    out[toId(name)] = { name };
  }
  return out;
}

function buildDexEncounters(project: ProjectState): Record<string, unknown> {
  if (!project.narcs.encounters) return {};
  const out: Record<string, unknown> = {};
  const used: Record<string, number> = {};
  for (let id = 0; id < getEncounterCount(project); id += 1) {
    const encounter = getEncounterRecord(project, id);
    const displayName = encounter.locations[0]?.split("(")[0].trim() || `Location ${id}`;
    let key = toId(displayName);
    used[key] = (used[key] ?? 0) + 1;
    if (used[key] > 1) key = `${key}${used[key]}`;
    out[key] = {
      name: used[toId(displayName)] > 1 ? `${displayName}${used[toId(displayName)]}` : displayName,
      wilds: encounter.wilds,
    };
  }
  return out;
}

function buildDexItems(project: ProjectState): Record<string, unknown> {
  if (!project.narcs.items) return {};
  const docs = ensureDocs(project);
  if (Object.keys(docs.itemLocations).length === 0) enrichDerivedItemSources(project);
  const out: Record<string, Record<string, unknown>> = {};
  const itemDescs = itemDescriptions(project);
  for (let id = 0; id < getItemCount(project); id += 1) {
    const item = getItemRecord(project, id);
    const name = String(project.texts.banks.items?.[id] ?? item.readable.name ?? `Item ${id}`);
    out[toId(name)] = {
      name,
      desc: itemDescs[id] ?? "",
      location: docs.itemLocations[String(id)]?.join(", ") ?? "",
    };
  }

  if (project.narcs.trdata) {
    for (let id = 0; id < getTrainerCount(project); id += 1) {
      const trainer = getTrainerRecord(project, id);
      const reward = String(trainer.readable.reward_item ?? "");
      const key = toId(reward);
      if (!reward || reward === "None" || !out[key]) continue;
      const label = `${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}`.trim();
      const locations = docs.trainerLocations[String(id)] ?? [];
      const title = locations[0] ? `${label} - ${locations[0]}` : label;
      out[key].rewards = unique([...(out[key].rewards as string[] | undefined ?? []), title]);
    }
  }

  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const pok = getPokemonSummaryRecord(project, id);
    const species = titleizeName(pok.personal.name ?? project.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`);
    for (const item of [pok.personal.item_1, pok.personal.item_2, pok.personal.item_3]) {
      const key = toId(String(item ?? ""));
      if (!out[key] || key === "none") continue;
      out[key].wilds = unique([...(out[key].wilds as string[] | undefined ?? []), species]);
    }
  }
  addMartDexSources(project, out);
  return out;
}

function enrichDerivedItemSources(project: ProjectState): number {
  const docs = ensureDocs(project);
  let count = 0;
  count += addWildHeldItemSources(project, docs.itemLocations);
  count += addTrainerRewardSources(project, docs.itemLocations);
  count += addMartItemSources(project, docs.itemLocations);
  return count;
}

function addWildHeldItemSources(project: ProjectState, target: Record<string, string[]>): number {
  if (!project.narcs.personal) return 0;
  let count = 0;
  for (let speciesId = 1; speciesId < getPokemonCount(project); speciesId += 1) {
    const pok = getPokemonSummaryRecord(project, speciesId);
    const species = titleizeName(pok.personal.name ?? project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`);
    for (const itemField of ["item_1", "item_2", "item_3"]) {
      const itemId = Number(pok.rawPersonal[itemField] ?? 0);
      if (itemId <= 0) continue;
      addUnique(target, itemId, `Wild held by ${species}`);
      count += 1;
    }
  }
  return count;
}

function addTrainerRewardSources(project: ProjectState, target: Record<string, string[]>): number {
  if (!project.narcs.trdata) return 0;
  const docs = ensureDocs(project);
  let count = 0;
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    const trainer = decodeRecord(project, "trdata", trainerId);
    if (!trainer.raw || !trainer.readable) continue;
    const itemId = Number(trainer.raw.reward_item ?? 0);
    if (itemId <= 0) continue;
    const trainerClass = project.texts.banks.tr_classes?.[trainer.raw.class] ?? trainer.readable.class ?? "";
    const trainerName = project.texts.banks.tr_names?.[trainerId] ?? trainer.readable.name ?? "";
    const label = `${trainerClass} ${trainerName}`.trim() || `Trainer ${trainerId}`;
    const location = docs.trainerLocations[String(trainerId)]?.[0];
    addUnique(target, itemId, location ? `Reward from ${label} - ${location}` : `Reward from ${label}`);
    count += 1;
  }
  return count;
}

function addMartItemSources(project: ProjectState, target: Record<string, string[]>): number {
  if (!project.narcs.marts) return 0;
  let count = 0;
  for (let martId = 0; martId < getMartCount(project); martId += 1) {
    const mart = getMartRecord(project, martId);
    const location = String(mart.readable.name ?? `Mart ${martId}`);
    for (let slot = 0; slot < 20; slot += 1) {
      const itemId = Number(mart.raw[`item_${slot}`] ?? 0);
      if (itemId <= 0) continue;
      addUnique(target, itemId, `Sold at ${location}`);
      count += 1;
    }
  }
  return count;
}

function addMartDexSources(project: ProjectState, out: Record<string, Record<string, unknown>>): void {
  if (!project.narcs.marts) return;
  for (let martId = 0; martId < getMartCount(project); martId += 1) {
    const mart = getMartRecord(project, martId);
    const location = String(mart.readable.name ?? `Mart ${martId}`);
    for (let slot = 0; slot < 20; slot += 1) {
      const itemName = String(mart.readable[`item_${slot}`] ?? "None");
      const key = toId(itemName);
      if (!out[key] || key === "none") continue;
      out[key].marts = unique([...(out[key].marts as string[] | undefined ?? []), location]);
    }
  }
}

function buildFormattedTrainerSets(project: ProjectState): Record<string, Record<string, unknown>> {
  if (!project.narcs.trdata || !project.narcs.trpok || !project.narcs.personal) return {};
  const formatted: Record<string, Record<string, unknown>> = {};
  const nameCounts: Record<string, number> = {};
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    if (!project.narcs.trpok.rawFiles[trainerId]) continue;
    const trainer = getTrainerRecord(project, trainerId);
    const baseName = `${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}`.trim();
    nameCounts[baseName] = (nameCounts[baseName] ?? 0) + 1;
    for (const pok of trainer.party) {
      if (pok.ivs < 0) continue;
      const species = titleizeName(pok.speciesName);
      formatted[species] ??= {};
      const setName = trainerSetName(project, trainer, pok.level, nameCounts[baseName]);
      const iv = Math.floor((pok.ivs * 31) / 255);
      formatted[species][dedupeSetName(formatted[species], setName)] = {
        level: pok.level,
        ai: trainer.readable.ai ?? trainer.raw.ai ?? 0,
        noCh: false,
        tr_id: trainerId,
        ivs: { hp: iv, at: iv, df: iv, sa: iv, sd: iv, sp: iv },
        battle_type: trainer.readable.battle_type_1,
        reward_item: trainer.readable.reward_item,
        item: pok.itemName ?? "None",
        nature: pok.nature,
        moves: pok.moves.map((move) => showdownName(move)),
        sub_index: pok.slot,
        ability: titleizeAbility(pok.abilityName),
        sprite: trainer.spritePath,
        form: pok.form,
        evs: { df: 0 },
      };
    }
  }
  return formatted;
}

function buildSearchIndexJs(overrides: Record<string, unknown>): string {
  const pokedex = overrides.poks as SearchCollection;
  const moves = overrides.moves as SearchCollection;
  const items = overrides.items as SearchCollection;
  const abilities = overrides.abilities as SearchCollection;
  const locations = overrides.encs as SearchCollection;
  const typeChart = Object.fromEntries(TYPES.map((type) => [type, {}]));
  let index: string[] = [];
  index = index.concat(Object.keys(pokedex).map((id) => `${cleanString(id)} pokemon`));
  index = index.concat(Object.keys(moves).map((id) => `${cleanString(id)} move`));
  index = index.concat(Object.keys(items).map((id) => `${id} item`));
  index = index.concat(Object.keys(abilities).map((id) => `${id} ability`));
  index = index.concat(TYPES.map((type) => `${toId(type)} type`));
  index = index.concat(Object.keys(locations).map((id) => `${toId(id)} location`));
  index = index.concat(CATEGORIES.map((category) => `${toId(category)} category`));

  for (const [collection, type] of [
    [pokedex, "pokemon"],
    [moves, "move"],
    [items, "item"],
    [abilities, "ability"],
    [locations, "location"],
  ] as Array<[SearchCollection, string]>) {
    for (const [id, data] of Object.entries(collection)) generateAliases(index, id, data.name ?? id, type);
  }

  index = unique(index).sort();
  const searchIndex = index.map((entry) => entry.split(" ").map((part, index) => (index === 3 ? Number(part) : part)));
  const offsets = searchIndex.map(() => "");
  const counts: Record<string, number> = {};
  for (const type of Object.keys(typeChart)) {
    counts[`${type} move`] = Object.values(moves).filter((move) => move.type === type || move.t === type).length;
    counts[`${type} pokemon`] = Object.values(pokedex).filter((pok) => pok.types?.includes(type)).length;
  }

  return [
    "// DO NOT EDIT - automatically built by Pokeweb Doc Generators",
    "",
    `exports.BattleSearchIndex = ${JSON.stringify(searchIndex)};`,
    "",
    `exports.BattleSearchIndexOffset = ${JSON.stringify(offsets)};`,
    "",
    `exports.BattleSearchCountIndex = ${JSON.stringify(counts)};`,
    "",
    "exports.BattleArticleTitles = {};",
    "",
  ].join("\n");
}

function scriptStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  let pointerOffset = 0;
  while (pointerOffset + 4 <= bytes.length && readU16(bytes, pointerOffset) !== 0xfd13) {
    const start = pointerOffset + readU32(bytes, pointerOffset) + 4;
    if (start >= 0 && start < bytes.length) starts.push(start);
    pointerOffset += 4;
  }
  return starts;
}

function locationForOverworld(project: ProjectState, overworldId: number): string {
  if (!project.headers) project.headers = parseHeaders(project);
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    const row = project.headers.rows[rowId];
    if (Number(row?.overworlds_id ?? row?.map_id) === overworldId) return String(row.location_name ?? `Overworld ${overworldId}`);
  }
  return `Overworld ${overworldId}`;
}

function requireNarcs(project: ProjectState, names: Array<keyof ProjectState["narcs"]>): void {
  const missing = names.filter((name) => !project.narcs[name]);
  if (missing.length > 0) throw new Error(`Missing loaded data: ${missing.join(", ")}`);
}

function trainerSetName(project: ProjectState, trainer: TrainerRecord, level: number, duplicateIndex: number): string {
  const showDuplicate = duplicateIndex > 1 || String(trainer.readable.name ?? "") === "Grunt" || String(trainer.readable.name ?? "") === "Shadow";
  const base = `Lvl ${level} ${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}${showDuplicate ? duplicateIndex : ""}`.trim();
  const location = ensureDocs(project).trainerLocations[String(trainer.id)]?.[0];
  return location ? `${base} - ${location}` : base;
}

function dedupeSetName(existing: Record<string, unknown>, setName: string): string {
  if (!existing[setName]) return setName;
  let index = 2;
  while (existing[`${setName} ${index}`]) index += 1;
  return `${setName} ${index}`;
}

function moveFlags(readable: ReadableRecord): Record<string, unknown> {
  const flags: Record<string, boolean> = {};
  if (Number(readable.punch_move ?? 0) === 1) flags.punch = true;
  if (Number(readable.sound_move ?? 0) === 1) flags.sound = true;
  return Object.keys(flags).length > 0 ? { flags } : {};
}

function moveDescriptions(project: ProjectState): string[] {
  const bank = project.session.baseRom === "BW2" ? 402 : 202;
  try {
    return getTextBank(project, "message_texts", bank).map((entry) => String(entry?.[1] ?? "").replace(/\\n/gu, " "));
  } catch {
    return [];
  }
}

function itemDescriptions(project: ProjectState): string[] {
  const bank = project.session.baseRom === "BW2" ? 63 : 53;
  try {
    return getTextBank(project, "message_texts", bank).map((entry) => String(entry?.[1] ?? "").replace(/\\n/gu, " "));
  } catch {
    return [];
  }
}

function replacementMap(vanillaValues: string[], currentValues: string[], normalize: (value: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  vanillaValues.forEach((vanilla, index) => {
    const current = currentValues[index];
    if (current === undefined) return;
    const vanillaId = normalize(vanilla);
    const currentId = normalize(current);
    if (vanillaId && currentId && vanillaId !== currentId) out[vanillaId] = currentId;
  });
  return out;
}

function generateAliases(index: string[], id: string, name: string, type: string): void {
  const parts = name.split(/ |-/u).map(toId).filter(Boolean);
  if (parts.length < 2) return;
  const acronym = parts.map((part) => part[0]).join("") + parts.at(-1)!.slice(1);
  index.push(`${acronym} ${type} ${id} 0`);
  for (let n = 1; n < parts.length; n += 1) index.push(`${parts.slice(n).join("")} ${type} ${id} ${parts.slice(0, n).join("").length}`);
}

function addUnique(target: Record<string, string[]>, id: number, value: string): void {
  const key = String(id);
  target[key] = unique([...(target[key] ?? []), value]);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function cleanString(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
}

function toId(value: string): string {
  return value.toLowerCase().replace(/é/gu, "e").replace(/[^a-z0-9]+/gu, "");
}

function showdownName(value: unknown): string {
  const titled = titleizeName(value);
  return SHOWDOWN_SUBS[titled] ?? titled;
}

function titleizeName(value: unknown): string {
  return String(value ?? "")
    .replace(/_/gu, " ")
    .split(/([\s-]+)/u)
    .map((part) => (/^[a-z]/iu.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("")
    .replace(/Porygon Z/gu, "Porygon-Z")
    .replace(/Ho Oh/gu, "Ho-Oh")
    .replace(/'/gu, "’");
}

function titleizeAbility(value: unknown): string {
  return titleizeName(value).replace(/Lightningrod/gu, "Lightning Rod").replace(/Compoundeyes/gu, "Compound Eyes");
}

function titleize(value: unknown): string {
  return titleizeName(value);
}

function safeFilename(value: string): string {
  return toId(value) || "pokeweb";
}

function lines(text: string): string[] {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}
