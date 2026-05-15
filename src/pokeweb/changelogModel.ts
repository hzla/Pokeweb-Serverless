import { MANDATORY_NARCS, type BaseVersion, type NarcName } from "./constants";
import { ENCOUNTER_GRASS_FIELDS, ENCOUNTER_SEASONS, ENCOUNTER_WATER_FIELDS, PROPERTIES, TRAINER_AIS } from "./constants";
import { getEncounterRecord } from "./encounterModel";
import { HEADER_FIELD_LABELS, parseHeaders } from "./headerModel";
import { getGrottoOdds, getGrottoRecord, getMartRecord, GROTTO_ODDS_FIELDS } from "./martGrottoModel";
import { ITEM_FIELD_LABELS, MOVE_EFFECT_FIELDS, MOVE_MISC_FIELDS, MOVE_STAT_FIELDS, getItemRecord, getMoveRecord, syncMoveReadable } from "./moveItemModel";
import { getPokemonRecord, getPokemonSummaryRecord, learnsetEntries } from "./pokemonModel";
import { decodeRecord, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { getTrainerRecord, type TrainerPokemonSlot } from "./trainerModel";
import { loadProjectFromRomFile, type LoadOptions, type LoadProgress } from "./loader";

export type ChangelogEntry = {
  domain: string;
  subject?: string;
  text: string;
  parts?: ChangelogEntryPart[];
};

export type ChangelogEntryPart = {
  text: string;
  changed?: boolean;
  breakBefore?: boolean;
};

export type ChangelogSummary = {
  beforeVersion: BaseVersion;
  afterVersion: BaseVersion;
  totalChanges: number;
  domains: Record<string, number>;
};

export type ChangelogResult = {
  text: string;
  entries: ChangelogEntry[];
  summary: ChangelogSummary;
  beforeVersion: BaseVersion;
  afterVersion: BaseVersion;
};

export type ChangelogOptions = Pick<LoadOptions, "fairy">;

const SEMANTIC_NARCS = [
  "personal",
  "learnsets",
  "evolutions",
  "moves",
  "items",
  "trdata",
  "trpok",
  "encounters",
  "marts",
  "grottos",
  "grotto_odds",
] as const satisfies readonly NarcName[];

const GENERIC_NARCS = ["maps", "matrix", "overworlds", "move_animations", "battle_animations", "move_spas"] as const satisfies readonly NarcName[];

const CHANGELOG_NARCS: NarcName[] = [...new Set<NarcName>([...MANDATORY_NARCS, ...SEMANTIC_NARCS, ...GENERIC_NARCS])];

const DOMAIN_TITLES: Record<string, string> = {
  headers: "Headers",
  personal: "Pokemon Personal Data",
  learnsets: "Learnsets",
  evolutions: "Evolutions",
  moves: "Moves",
  items: "Items",
  trdata: "Trainer Data",
  trpok: "Trainer Pokemon",
  encounters: "Encounters",
  marts: "Marts",
  grottos: "Hidden Grottoes",
  grotto_odds: "Hidden Grotto Odds",
  maps: "Maps",
  matrix: "Matrices",
  overworlds: "Overworld Files",
  move_animations: "Move Animations",
  battle_animations: "Battle Animations",
  move_spas: "Move Particle Files",
};

const PERSONAL_FIELDS: Array<[string, string]> = [
  ["base_hp", "base HP"],
  ["base_atk", "base attack"],
  ["base_def", "base defense"],
  ["base_speed", "base speed"],
  ["base_spatk", "base special attack"],
  ["base_spdef", "base special defense"],
  ["type_1", "primary type"],
  ["type_2", "secondary type"],
  ["catchrate", "catch rate"],
  ["base_exp", "base EXP yield"],
  ["hp_yield", "HP EV yield"],
  ["atk_yield", "Attack EV yield"],
  ["def_yield", "Defense EV yield"],
  ["speed_yield", "Speed EV yield"],
  ["spatk_yield", "Special Attack EV yield"],
  ["spdef_yield", "Special Defense EV yield"],
  ["item_1", "50% held item"],
  ["item_2", "5% held item"],
  ["item_3", "1% held item"],
  ["gender", "gender ratio"],
  ["hatch_cycle", "hatch rate"],
  ["base_happy", "base happiness"],
  ["exp_rate", "growth rate"],
  ["egg_group_1", "egg group 1"],
  ["egg_group_2", "egg group 2"],
  ["ability_1", "ability 1"],
  ["ability_2", "ability 2"],
  ["ability_3", "hidden ability"],
  ["flee", "flee rate"],
  ["form_id", "form data ID"],
  ["form", "form sprite ID"],
  ["num_forms", "number of forms"],
  ["color", "color"],
  ["height", "height"],
  ["weight", "weight"],
  ["tutors", "special tutor compatibility mask"],
  ["driftveil_tutor", "Driftveil tutor compatibility mask"],
  ["lentimas_tutor", "Lentimas tutor compatibility mask"],
  ["humilau_tutor", "Humilau tutor compatibility mask"],
  ["nacrene_tutor", "Nacrene tutor compatibility mask"],
];

const MOVE_FIELDS: Array<[string, string]> = [
  ["type", "type"],
  ["category", "category"],
  ["power", "power"],
  ["accuracy", "accuracy"],
  ...MOVE_EFFECT_FIELDS.map(([label, field]) => [field, label.toLowerCase()] as [string, string]),
  ...MOVE_STAT_FIELDS.map(([label, field]) => [field, label.toLowerCase()] as [string, string]),
  ...MOVE_MISC_FIELDS.filter(([, field]) => field !== "animation").map(([label, field]) => [field, label.toLowerCase()] as [string, string]),
  ...PROPERTIES.map((field) => [field, titleize(field.replace(/_/gu, " "))] as [string, string]),
];

const ITEM_FIELDS: Array<[string, string]> = [
  ["market_value", "market value"],
  ...Object.entries(ITEM_FIELD_LABELS).map(([field, label]) => [field, label.toLowerCase()] as [string, string]),
];

const TRAINER_FIELDS: Array<[string, string]> = [
  ["class", "class"],
  ["battle_type_1", "battle type"],
  ["num_pokemon", "Pokemon count"],
  ["item_1", "item 1"],
  ["item_2", "item 2"],
  ["item_3", "item 3"],
  ["item_4", "item 4"],
  ["money", "money"],
  ["reward_item", "reward item"],
  ["heal", "heal flag"],
  ...TRAINER_AIS.map((field) => [field, `AI flag ${field}`] as [string, string]),
];

const HEADER_FIELDS = [
  "location_name",
  "matrix_id",
  "script_id",
  "text_bank_id",
  "enc_data_id",
  "map_type",
  "weather_id",
  "overworlds_id",
  "parent_map_id",
  "texture_id",
  "level_script_id",
  "name_style_id",
  "name_icon_id",
  "camera_id",
  "flags",
  "fly_x",
  "fly_y",
  "fly_z",
  "music_spring_id",
  "music_summer_id",
  "music_fall_id",
  "music_winter_id",
];

export async function generateChangelogFromRomFiles(
  beforeFile: File,
  afterFile: File,
  options: ChangelogOptions = {},
  onProgress?: LoadProgress,
): Promise<ChangelogResult> {
  let beforeProject: ProjectState | undefined;
  let afterProject: ProjectState | undefined;
  try {
    onProgress?.("Loading original ROM");
    beforeProject = await loadProjectFromRomFile(beforeFile, { ...options, selectedNarcs: CHANGELOG_NARCS }, onProgress);
    onProgress?.("Loading modified ROM");
    afterProject = await loadProjectFromRomFile(afterFile, { ...options, selectedNarcs: CHANGELOG_NARCS }, onProgress);
    return generateChangelogFromProjects(beforeProject, afterProject);
  } finally {
    releaseProjectMemory(beforeProject);
    releaseProjectMemory(afterProject);
  }
}

export function generateChangelogFromProjects(beforeProject: ProjectState, afterProject: ProjectState): ChangelogResult {
  validateSameBaseVersion(beforeProject, afterProject);
  const entries: ChangelogEntry[] = [];
  addHeaderChanges(beforeProject, afterProject, entries);
  addSemanticNarcChanges(beforeProject, afterProject, entries);
  addGenericNarcChanges(beforeProject, afterProject, entries);
  const summary = summarizeEntries(beforeProject.session.baseVersion, afterProject.session.baseVersion, entries);
  return {
    text: renderChangelogText(beforeProject, afterProject, entries, summary),
    entries,
    summary,
    beforeVersion: beforeProject.session.baseVersion,
    afterVersion: afterProject.session.baseVersion,
  };
}

export function validateSameBaseVersion(beforeProject: ProjectState, afterProject: ProjectState): void {
  if (beforeProject.session.baseVersion !== afterProject.session.baseVersion) {
    throw new Error(`ROM versions must match exactly. Original is ${beforeProject.session.baseVersion}; modified is ${afterProject.session.baseVersion}.`);
  }
}

function addHeaderChanges(beforeProject: ProjectState, afterProject: ProjectState, entries: ChangelogEntry[]): void {
  if (!changedFile(beforeProject, afterProject, "headers", 0)) return;
  const beforeHeaders = beforeProject.headers ?? parseHeaders(beforeProject);
  const afterHeaders = afterProject.headers ?? parseHeaders(afterProject);
  const count = Math.max(beforeHeaders.count, afterHeaders.count);
  for (let id = 1; id <= count; id += 1) {
    const before = beforeHeaders.rows[id];
    const after = afterHeaders.rows[id];
    const subject = String(after?.location_name ?? before?.location_name ?? `Header ${id}`);
    if (!before || !after) {
      push(entries, "headers", `${subject} header ${after ? "was added" : "was removed"}.`);
      continue;
    }
    for (const field of HEADER_FIELDS) {
      pushIfDifferent(entries, "headers", subject, HEADER_FIELD_LABELS[field] ?? titleize(field), before[field], after[field]);
    }
  }
}

function addSemanticNarcChanges(beforeProject: ProjectState, afterProject: ProjectState, entries: ChangelogEntry[]): void {
  for (const name of SEMANTIC_NARCS) {
    if (name === "grotto_odds") {
      addGrottoOddsChanges(beforeProject, afterProject, entries);
      continue;
    }
    const beforeStore = beforeProject.narcs[name];
    const afterStore = afterProject.narcs[name];
    if (!beforeStore && !afterStore) continue;
    const count = Math.max(beforeStore?.fileCount ?? 0, afterStore?.fileCount ?? 0);
    for (let id = 0; id < count; id += 1) {
      if (!changedFile(beforeProject, afterProject, name, id)) continue;
      switch (name) {
        case "personal":
          addPersonalChange(beforeProject, afterProject, id, entries);
          break;
        case "learnsets":
          addLearnsetChange(beforeProject, afterProject, id, entries);
          break;
        case "evolutions":
          addEvolutionChange(beforeProject, afterProject, id, entries);
          break;
        case "moves":
          addMoveChange(beforeProject, afterProject, id, entries);
          break;
        case "items":
          addItemChange(beforeProject, afterProject, id, entries);
          break;
        case "trdata":
          addTrainerDataChange(beforeProject, afterProject, id, entries);
          break;
        case "trpok":
          addTrainerPokemonChange(beforeProject, afterProject, id, entries);
          break;
        case "encounters":
          addEncounterChange(beforeProject, afterProject, id, entries);
          break;
        case "marts":
          addMartChange(beforeProject, afterProject, id, entries);
          break;
        case "grottos":
          addGrottoChange(beforeProject, afterProject, id, entries);
          break;
      }
    }
  }
}

function addPersonalChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "personal", id, () => getPokemonSummaryRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "personal", id, () => getPokemonSummaryRecord(afterProject, id));
  const subject = pokemonName(afterProject, beforeProject, id);
  if (!before || !after) {
    push(entries, "personal", `${subject} personal data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (const [field, label] of PERSONAL_FIELDS) pushIfDifferent(entries, "personal", subject, label, before.personal[field], after.personal[field]);
  addTmCompatibilityChanges(beforeProject, afterProject, subject, before.rawPersonal, after.rawPersonal, entries);
}

function addLearnsetChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalDecoded(beforeProject, "learnsets", id);
  const after = optionalDecoded(afterProject, "learnsets", id);
  const subject = pokemonName(afterProject, beforeProject, id);
  if (!before?.raw || !after?.raw) {
    push(entries, "learnsets", `${subject} learnset ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  const beforeMoves = learnsetEntries(before.raw);
  const afterMoves = learnsetEntries(after.raw);
  const count = Math.max(beforeMoves.length, afterMoves.length);
  for (let index = 0; index < count; index += 1) {
    const oldMove = beforeMoves[index];
    const newMove = afterMoves[index];
    if (!oldMove || !newMove) {
      push(entries, "learnsets", `${subject} learnset slot ${index + 1} ${newMove ? `added ${moveName(afterProject, newMove.moveId)} at level ${newMove.level}` : `removed ${moveName(beforeProject, oldMove!.moveId)} at level ${oldMove!.level}`}.`, subject);
      continue;
    }
    if (oldMove.moveId === newMove.moveId && oldMove.level === newMove.level) continue;
    push(entries, "learnsets", `${subject} learnset slot ${index + 1} changed from ${moveName(beforeProject, oldMove.moveId)} at level ${oldMove.level} to ${moveName(afterProject, newMove.moveId)} at level ${newMove.level}.`, subject);
  }
}

function addEvolutionChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "evolutions", id, () => getPokemonRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "evolutions", id, () => getPokemonRecord(afterProject, id));
  const subject = pokemonName(afterProject, beforeProject, id);
  if (!before || !after) {
    push(entries, "evolutions", `${subject} evolution data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (let slot = 0; slot < 7; slot += 1) {
    pushIfDifferent(entries, "evolutions", subject, `evolution ${slot + 1} method`, before.evolutions[slot]?.method, after.evolutions[slot]?.method);
    pushIfDifferent(entries, "evolutions", subject, `evolution ${slot + 1} parameter`, before.evolutions[slot]?.param, after.evolutions[slot]?.param);
    pushIfDifferent(entries, "evolutions", subject, `evolution ${slot + 1} target`, before.evolutions[slot]?.target, after.evolutions[slot]?.target);
  }
}

function addTmCompatibilityChanges(
  beforeProject: ProjectState,
  afterProject: ProjectState,
  subject: string,
  beforeRaw: RawRecord,
  afterRaw: RawRecord,
  entries: ChangelogEntry[],
): void {
  const added: string[] = [];
  const removed: string[] = [];
  for (const slot of tmCompatibilitySlots()) {
    const beforeEnabled = bitEnabled(beforeRaw, slot.field, slot.bit);
    const afterEnabled = bitEnabled(afterRaw, slot.field, slot.bit);
    if (beforeEnabled === afterEnabled) continue;
    const label = tmCompatibilityLabel(afterProject, beforeProject, slot.kind, slot.index);
    if (afterEnabled) added.push(label);
    else removed.push(label);
  }
  if (added.length > 0) push(entries, "personal", `${subject} now compatible with: ${added.join(", ")}.`, subject);
  if (removed.length > 0) push(entries, "personal", `${subject} removed compatibility with: ${removed.join(", ")}.`, subject);
}

function tmCompatibilitySlots(): Array<{ kind: "tm" | "hm"; index: number; field: string; bit: number }> {
  return [
    ...Array.from({ length: 95 }, (_, index) => {
      const number = index + 1;
      if (number <= 32) return { kind: "tm" as const, index: number, field: "tm_1-32", bit: number - 1 };
      if (number <= 64) return { kind: "tm" as const, index: number, field: "tm_33-64", bit: number - 33 };
      return { kind: "tm" as const, index: number, field: "tm_65-95+hm_1", bit: number - 65 };
    }),
    { kind: "hm" as const, index: 1, field: "tm_65-95+hm_1", bit: 31 },
    ...Array.from({ length: 5 }, (_, index) => ({ kind: "hm" as const, index: index + 2, field: "hm_2-6", bit: index })),
  ];
}

function tmCompatibilityLabel(primary: ProjectState, fallback: ProjectState, kind: "tm" | "hm", index: number): string {
  const prefix = `${kind.toUpperCase()}${String(index).padStart(2, "0")}`;
  const field = `${kind}_${index}`;
  const move = primary.tms?.readable[field] ?? fallback.tms?.readable[field] ?? "";
  return `${prefix}${move ? ` ${move}` : ""}`;
}

function bitEnabled(raw: RawRecord, field: string, bit: number): boolean {
  return ((Number(raw[field] ?? 0) >>> bit) & 1) === 1;
}

function addMoveChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "moves", id, () => getMoveRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "moves", id, () => getMoveRecord(afterProject, id));
  const subject = moveName(afterProject, id) || moveName(beforeProject, id);
  if (!before || !after) {
    push(entries, "moves", `${subject} move data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  syncMoveReadable(beforeProject, before.raw, before.readable, id);
  syncMoveReadable(afterProject, after.raw, after.readable, id);
  for (const [field, label] of MOVE_FIELDS) pushIfDifferent(entries, "moves", subject, label, before.readable[field], after.readable[field]);
}

function addItemChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "items", id, () => getItemRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "items", id, () => getItemRecord(afterProject, id));
  const subject = itemName(afterProject, id) || itemName(beforeProject, id);
  if (!before || !after) {
    push(entries, "items", `${subject} item data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (const [field, label] of ITEM_FIELDS) pushIfDifferent(entries, "items", subject, label, before.readable[field], after.readable[field]);
}

function addTrainerDataChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "trdata", id, () => getTrainerRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "trdata", id, () => getTrainerRecord(afterProject, id));
  const subject = trainerName(beforeProject, afterProject, id);
  if (!before || !after) {
    push(entries, "trdata", `${subject} trainer data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (const [field, label] of TRAINER_FIELDS) pushIfDifferent(entries, "trdata", subject, label, before.readable[field], after.readable[field]);
}

function addTrainerPokemonChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "trpok", id, () => getTrainerRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "trpok", id, () => getTrainerRecord(afterProject, id));
  const subject = trainerName(beforeProject, afterProject, id);
  if (!before || !after) {
    push(entries, "trpok", `${subject} trainer Pokemon data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  const oldTeam = teamSummaryParts(before.party, after.party, "old");
  const newTeam = teamSummaryParts(before.party, after.party, "new");
  push(entries, "trpok", `${subject} team changed.\nOld Team: ${partsToText(oldTeam)}\nNew Team: ${partsToText(newTeam)}`, subject, [
    { text: `${subject} team changed.` },
    { text: "Old Team: ", breakBefore: true },
    ...oldTeam,
    { text: "New Team: ", breakBefore: true },
    ...newTeam,
  ]);
}

function teamSummaryParts(beforeParty: TrainerPokemonSlot[], afterParty: TrainerPokemonSlot[], side: "old" | "new"): ChangelogEntryPart[] {
  const current = side === "old" ? beforeParty : afterParty;
  const other = side === "old" ? afterParty : beforeParty;
  if (current.length === 0) return [{ text: "None", changed: other.length > 0 }];
  return current.flatMap((slot, index) => {
    const otherSlot = other[index];
    return [
      ...(index > 0 ? [{ text: "; " }] : []),
      ...pokemonSlotSummaryParts(slot, otherSlot),
    ];
  });
}

function pokemonSlotSummaryParts(slot: TrainerPokemonSlot, otherSlot: TrainerPokemonSlot | undefined): ChangelogEntryPart[] {
  const moves = slot.moves.filter((move) => String(move ?? "None") !== "None" && String(move ?? "0") !== "0");
  const otherMoves = otherSlot?.moves.filter((move) => String(move ?? "None") !== "None" && String(move ?? "0") !== "0") ?? [];
  return [
    { text: `Pokemon ${slot.slot + 1}: ` },
    { text: `Lv ${slot.level}`, changed: !otherSlot || slot.level !== otherSlot.level },
    { text: " " },
    { text: slot.speciesName, changed: !otherSlot || slot.speciesName !== otherSlot.speciesName },
    { text: " (" },
    { text: `Ability ${slot.abilitySlot}`, changed: !otherSlot || slot.abilitySlot !== otherSlot.abilitySlot },
    { text: ", " },
    { text: `Item ${formatValue(slot.itemName ?? "None")}`, changed: !otherSlot || normalizeValue(slot.itemName ?? "None") !== normalizeValue(otherSlot.itemName ?? "None") },
    { text: ", " },
    { text: `Gender ${slot.gender}`, changed: !otherSlot || slot.gender !== otherSlot.gender },
    { text: ", " },
    { text: `Form ${slot.form}`, changed: !otherSlot || slot.form !== otherSlot.form },
    { text: ", Moves: " },
    { text: moves.length ? moves.map(String).join(", ") : "None", changed: !otherSlot || moves.map(String).join("|") !== otherMoves.map(String).join("|") },
    { text: ")" },
  ];
}

function addEncounterChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "encounters", id, () => getEncounterRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "encounters", id, () => getEncounterRecord(afterProject, id));
  const subject = encounterName(after, before, id);
  if (!before || !after) {
    push(entries, "encounters", `${subject} encounter data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (const season of ENCOUNTER_SEASONS) {
    for (const kind of [...ENCOUNTER_GRASS_FIELDS, ...ENCOUNTER_WATER_FIELDS]) {
      const slotCount = (ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? 12 : 5;
      pushIfDifferent(entries, "encounters", subject, `${season} ${kindLabel(kind)} rate`, before.readable[`${season}_${kind}_rate`], after.readable[`${season}_${kind}_rate`]);
      for (let slot = 0; slot < slotCount; slot += 1) {
        const base = `${season}_${kind}_slot_${slot}`;
        pushIfDifferent(entries, "encounters", subject, `${season} ${kindLabel(kind)} slot ${slot}`, before.readable[base], after.readable[base]);
        pushIfDifferent(entries, "encounters", subject, `${season} ${kindLabel(kind)} slot ${slot} form`, before.readable[`${base}_form`], after.readable[`${base}_form`]);
        pushIfDifferent(entries, "encounters", subject, `${season} ${kindLabel(kind)} slot ${slot} min level`, before.readable[`${base}_min_level`], after.readable[`${base}_min_level`]);
        pushIfDifferent(entries, "encounters", subject, `${season} ${kindLabel(kind)} slot ${slot} max level`, before.readable[`${base}_max_level`], after.readable[`${base}_max_level`]);
      }
    }
  }
}

function addMartChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "marts", id, () => getMartRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "marts", id, () => getMartRecord(afterProject, id));
  const subject = String(after?.readable.name ?? before?.readable.name ?? `Mart ${id}`);
  if (!before || !after) {
    push(entries, "marts", `${subject} mart data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (let slot = 0; slot < 20; slot += 1) {
    pushIfDifferent(entries, "marts", subject, `item ${slot + 1}`, before.readable[`item_${slot}`], after.readable[`item_${slot}`]);
  }
}

function addGrottoChange(beforeProject: ProjectState, afterProject: ProjectState, id: number, entries: ChangelogEntry[]): void {
  const before = optionalRecord(beforeProject, "grottos", id, () => getGrottoRecord(beforeProject, id));
  const after = optionalRecord(afterProject, "grottos", id, () => getGrottoRecord(afterProject, id));
  const subject = String(after?.readable.name ?? before?.readable.name ?? `Grotto ${id}`);
  if (!before || !after) {
    push(entries, "grottos", `${subject} grotto data ${after ? "was added" : "was removed"}.`, subject);
    return;
  }
  for (const field of Object.keys({ ...before.raw, ...after.raw })) {
    pushIfDifferent(entries, "grottos", subject, grottoFieldLabel(field), before.readable[field], after.readable[field]);
  }
}

function addGrottoOddsChanges(beforeProject: ProjectState, afterProject: ProjectState, entries: ChangelogEntry[]): void {
  if (!changedFile(beforeProject, afterProject, "grotto_odds", 0)) return;
  if (!beforeProject.narcs.grotto_odds || !afterProject.narcs.grotto_odds) {
    push(entries, "grotto_odds", `Hidden grotto odds data ${afterProject.narcs.grotto_odds ? "was added" : "was removed"}.`);
    return;
  }
  const before = getGrottoOdds(beforeProject);
  const after = getGrottoOdds(afterProject);
  for (const field of GROTTO_ODDS_FIELDS) {
    pushIfDifferent(entries, "grotto_odds", "Hidden grotto odds", grottoFieldLabel(field), before.readable[field], after.readable[field]);
  }
}

function addGenericNarcChanges(beforeProject: ProjectState, afterProject: ProjectState, entries: ChangelogEntry[]): void {
  for (const name of GENERIC_NARCS) {
    const beforeStore = beforeProject.narcs[name];
    const afterStore = afterProject.narcs[name];
    if (!beforeStore && !afterStore) continue;
    const count = Math.max(beforeStore?.fileCount ?? 0, afterStore?.fileCount ?? 0);
    for (let id = 0; id < count; id += 1) {
      if (!changedFile(beforeProject, afterProject, name, id)) continue;
      push(entries, name, genericChangedLine(beforeProject, afterProject, name, id));
    }
  }
}

function genericChangedLine(beforeProject: ProjectState, afterProject: ProjectState, name: NarcName, id: number): string {
  const beforeFile = beforeProject.narcs[name]?.rawFiles[id];
  const afterFile = afterProject.narcs[name]?.rawFiles[id];
  const action = beforeFile && afterFile ? "changed" : afterFile ? "was added" : "was removed";
  if (name === "move_animations") return `Move animation file for ${moveName(afterProject, id) || moveName(beforeProject, id)} ${action}.`;
  if (name === "move_spas") return `Move particle file ${id} ${action}.`;
  if (name === "battle_animations") return `Battle animation file ${id} ${action}.`;
  if (name === "maps") return `Map file ${id} ${action}.`;
  if (name === "matrix") return `Matrix file ${id} ${action}.`;
  if (name === "overworlds") return `Overworld file ${id} ${action}.`;
  return `${DOMAIN_TITLES[name] ?? name} file ${id} ${action}.`;
}

function changedFile(beforeProject: ProjectState, afterProject: ProjectState, name: NarcName, id: number): boolean {
  const before = beforeProject.narcs[name]?.rawFiles[id];
  const after = afterProject.narcs[name]?.rawFiles[id];
  if (!before || !after) return before !== after;
  if (before.length !== after.length) return true;
  return !bytesEqual(before, after);
}

function optionalDecoded(project: ProjectState, name: NarcName, id: number) {
  return optionalRecord(project, name, id, () => decodeRecord(project, name, id));
}

function optionalRecord<T>(project: ProjectState, name: NarcName, id: number, read: () => T): T | undefined {
  if (!project.narcs[name]?.rawFiles[id]) return undefined;
  return read();
}

function pushIfDifferent(entries: ChangelogEntry[], domain: string, subject: string, label: string, before: unknown, after: unknown): void {
  if (normalizeValue(before) === normalizeValue(after)) return;
  push(entries, domain, `${subject} ${label} changed from ${formatValue(before)} to ${formatValue(after)}.`, subject);
}

function push(entries: ChangelogEntry[], domain: string, text: string, subject?: string, parts?: ChangelogEntryPart[]): void {
  entries.push({ domain, subject, text, parts });
}

function summarizeEntries(beforeVersion: BaseVersion, afterVersion: BaseVersion, entries: ChangelogEntry[]): ChangelogSummary {
  const domains: Record<string, number> = {};
  for (const entry of entries) domains[entry.domain] = (domains[entry.domain] ?? 0) + 1;
  return { beforeVersion, afterVersion, totalChanges: entries.length, domains };
}

function renderChangelogText(beforeProject: ProjectState, afterProject: ProjectState, entries: ChangelogEntry[], summary: ChangelogSummary): string {
  const lines = [
    `Changelog: ${beforeProject.session.romName} -> ${afterProject.session.romName}`,
    `Game version: ${summary.beforeVersion}`,
    `Total changes: ${summary.totalChanges}`,
    "",
  ];
  if (entries.length === 0) {
    lines.push("No changes detected in the selected Pokeweb data.");
    return lines.join("\n");
  }
  const domains = [...new Set(entries.map((entry) => entry.domain))];
  for (const domain of domains) {
    lines.push(`${DOMAIN_TITLES[domain] ?? titleize(domain)} (${summary.domains[domain] ?? 0})`);
    let previousSubject = "";
    for (const entry of entries.filter((candidate) => candidate.domain === domain)) {
      if ((domain === "personal" || domain === "learnsets" || domain === "evolutions") && previousSubject && entry.subject && entry.subject !== previousSubject) {
        lines.push("");
      }
      lines.push(`- ${entry.text}`);
      previousSubject = entry.subject ?? previousSubject;
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function pokemonName(primary: ProjectState, fallback: ProjectState, id: number): string {
  return primary.texts.banks.pokedex?.[id] ?? fallback.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`;
}

function moveName(project: ProjectState, id: number): string {
  return project.texts.banks.moves?.[id] ?? `Move ${id}`;
}

function itemName(project: ProjectState, id: number): string {
  return project.texts.banks.items?.[id] ?? `Item ${id}`;
}

function trainerName(primary: ProjectState, fallback: ProjectState, id: number): string {
  const project = primary.texts.banks.tr_names?.[id] ? primary : fallback;
  const name = project.texts.banks.tr_names?.[id] ?? `Trainer ${id}`;
  const record = project.narcs.trdata?.rawFiles[id] ? optionalDecoded(project, "trdata", id) : undefined;
  const trainerClass = record?.readable?.class ?? "";
  return `${`${trainerClass} ${name}`.trim()} (Trainer ${id})`;
}

function encounterName(after: { locations: string[] } | undefined, before: { locations: string[] } | undefined, id: number): string {
  return after?.locations[0] ?? before?.locations[0] ?? `Encounter ${id}`;
}

function kindLabel(kind: string): string {
  return kind.replace(/_/gu, " ");
}

function grottoFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}

function normalizeValue(value: unknown): string {
  return String(value ?? "").trim();
}

function formatValue(value: unknown): string {
  const text = normalizeValue(value);
  return text.length > 0 ? text : "None";
}

function partsToText(parts: ChangelogEntryPart[]): string {
  return parts.map((part) => part.text).join("");
}

function titleize(value: string): string {
  return value
    .replace(/_/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function releaseProjectMemory(project: ProjectState | undefined): void {
  if (!project) return;
  delete project.originalRomBytes;
  project.arm9 = new Uint8Array();
  project.overlays = {};
  for (const store of Object.values(project.narcs)) {
    if (!store) continue;
    store.rawFiles = [];
    store.records.clear();
  }
  project.texts.messageTexts = undefined;
  project.texts.storyTexts = undefined;
}
