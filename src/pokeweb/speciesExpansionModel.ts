import manifestJson from "../assets/codeinjection/speciesExpansionManifest.json";
import { insertKoMoveLearnsetMembers } from "./koMoveLearnsetModel";
import indexJson from "../assets/data/speciesExpansionIndex.json";
import { recordGenericChange } from "./actionChangelog";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { canOpenMapStudio } from "./mapStudioAccess";
import { resolveAbilities } from "./megaContentModel";
import { NintendoDSRom } from "../nds/rom";
import { detectBlack2UpgradeDlls, detectWhite2UpgradeDlls, stageCodeInjectionDll } from "./pmcModel";
import { emptyEvolutionRecord, emptyLearnsetRecord } from "./pokemonFormModel";
import { setPokemonEvolutions, setPokemonLearnset, usesWhite2UpgradePokemonData } from "./pokemonModel";
import { ensurePokemonIconPaletteAssignmentCapacity, getPokemonSpriteEntry, setPokemonIconPaletteAssignment } from "./pokemonSpriteModel";
import { decodeRecord, markDirty, refreshRecordReadable, type NarcStore, type ProjectState } from "./projectStore";
import { loadBundledPwanCarrierTemplate } from "./pwanCarrierPatch";
import { hasPwanRuntimeDll, installPwanRuntime } from "./pwanAnimationModel";
import { importPwanLibraryEntryFromLoadedLibrary, loadPwanLibrary } from "./pwanLibraryModel";
import { addFairyTypeSupport, addMoveExpansion, detectFairyTypePatch } from "./romPatchModel";
import { detectMoveExpansionPatch } from "./moveExpansionPatch";
import { commitTextBank, getTextBank, parseTextEntryId } from "./textModel";
import { materializeProjectEdits } from "./projectMaterialize";
import { hydrateMissingOverlays } from "./persistence";
import { patchDexSearchCode, stagePokedexData } from "./speciesExpansionDexModel";
import { FIRST_ADDED_SPECIES, NATIONAL_OFFSET, expansionSpeciesOf, installedExpansionNationals } from "./speciesExpansionIds";
import type { NarcName } from "./constants";
import type { Gen5TextEntry } from "./text";

export { FIRST_ADDED_SPECIES, NATIONAL_OFFSET, expansionSpeciesOf, expansionSpriteOf, firstAppendedFormRecord, hydrateSpeciesExpansion,
  isAddedSpecies, nationalNumberOf, readSpeciesExpansionTable } from "./speciesExpansionIds";

/**
 * Species expansion (Black 2 / White 2): the species after Genesect, from White2Upgrade's data and the PWAN library.
 *
 * Retail numbers 650 (Egg), 651 (Bad Egg), 652-684 (the Pokéstar Studios actors) and 685-686 (two more Egg names),
 * and checks for an Egg against 650 in many places. The added species are numbered after all of them: national + 37,
 * Chespin 687 ... Iron Crown 1060. Their records are at their own number, as retail's: personal, learnset, evolution,
 * the three species-name banks (90 names, 483 with article, 486 upper case), baby species and egg moves. To make
 * room, every form record (retail 685-708 and any added since) and the regional Pokédex table (personal 709) move
 * past them; the form owners' first-form fields and evolution targets naming a form record follow.
 *
 * The runtime (runtime/species-expansion: SpeciesExpansion<game>.dll and its summary / box companions) gives their
 * sprites and icons a sprite block of their own (retail's form sprites follow the species' blocks), a placeholder
 * cry (a retail species), the moved regional Pokédex table, battle rules that allow them, and the summary's and box's
 * national numbers. Overlay 36's party check, which corrupts species above 649, is raised to the last added species.
 */
export type ExpansionSpecies = {
  national: number;
  name: string;
  family: number;
  library: string | null;
  spriteStandIn?: number;
  credits: Partial<Record<"front" | "back", string>>;
  cry: number;
  /** Legendary or mythical: battle rules that ban retail's legendaries ban it too. */
  restricted?: boolean;
  /** Mythical: left out of the national Pokédex's completion. */
  mythical?: boolean;
  personal: {
    stats: number[]; types: number[]; catchRate: number; stage: number; evs: number; items: number[]; gender: number;
    hatchCycles: number; happiness: number; growth: number; eggGroups: number[]; flee: number; color: number;
    baseExp: number; height: number; weight: number; tm: number[]; typeTutors: number; tutors: number[];
  };
  abilities: number[];
  abilityNames: Record<string, string>;
  abilityDescriptions: Record<string, string>;
  learnset: Array<[number, number] | [number, number, string]>;
  /** The Pokédex's texts. */
  dex: { description: string; height: string; weight: string; category: string };
  evolutions: Array<{ method: number; param: number; species: number; moveName?: string }>;
};

/** The package (runtime/species-expansion/content), fetched on install: it is half a megabyte. */
const CONTENT_URL = new URL("../assets/data/speciesExpansion.json", import.meta.url);
let contentPromise: Promise<ExpansionSpecies[]> | undefined;

export function loadExpansionSpecies(): Promise<ExpansionSpecies[]> {
  contentPromise ??= fetch(CONTENT_URL).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load the species expansion package (${response.status})`);
    const content = await response.json() as { format: string; species: ExpansionSpecies[] };
    if (content.format !== "pokeweb-species-expansion-v1") throw new Error("The species expansion package has an unknown format.");
    return content.species;
  }).catch((error: unknown) => { contentPromise = undefined; throw error; });
  return contentPromise;
}
export const SPECIES_EXPANSION_VERSION = 1;
/** Retail's first form record; every record from here on moves by FORM_SHIFT. */
const FIRST_FORM_RECORD = 685;
/** Room for national 650-1025 (species 687-1062). */
const LAST_ADDED_SPECIES = 1025 + NATIONAL_OFFSET;
const FORM_SHIFT = LAST_ADDED_SPECIES + 1 - FIRST_FORM_RECORD;
const RETAIL_REGIONAL_DEX_FILE = 709;
const REGIONAL_DEX_NONE = 999;
const SPECIES_NAME_BANKS = [90, 483, 486] as const;
const SPRITE_FILES = 20;
const ICON_HEADER = 8;
const LAST_RETAIL_MOVE = 559;
const FAIRY = 17;
/** The table's cry field: the cry species, and these bits for a restricted (legendary or mythical) and a mythical species. */
const RESTRICTED_FLAG = 0x8000;
const MYTHICAL_FLAG = 0x4000;
const MANIFEST = manifestJson as unknown as {
  version: string;
  games: Record<"W2" | "B2", Record<RuntimePart, { fileName: string; configOffset?: number }>>;
};
type RuntimePart = "core" | "summary" | "box" | "dexList" | "dexSearch" | "dexInfo";
const RUNTIME_PARTS: readonly RuntimePart[] = ["core", "summary", "box", "dexList", "dexSearch", "dexInfo"];
const DLL_URLS: Record<"W2" | "B2", Record<RuntimePart, URL>> = {
  W2: {
    core: new URL("../assets/codeinjection/SpeciesExpansionW2.dll", import.meta.url),
    summary: new URL("../assets/codeinjection/SpeciesExpansionSummaryW2.dll", import.meta.url),
    box: new URL("../assets/codeinjection/SpeciesExpansionBoxW2.dll", import.meta.url),
    dexList: new URL("../assets/codeinjection/SpeciesExpansionDexListW2.dll", import.meta.url),
    dexSearch: new URL("../assets/codeinjection/SpeciesExpansionDexSearchW2.dll", import.meta.url),
    dexInfo: new URL("../assets/codeinjection/SpeciesExpansionDexInfoW2.dll", import.meta.url),
  },
  B2: {
    core: new URL("../assets/codeinjection/SpeciesExpansionB2.dll", import.meta.url),
    summary: new URL("../assets/codeinjection/SpeciesExpansionSummaryB2.dll", import.meta.url),
    box: new URL("../assets/codeinjection/SpeciesExpansionBoxB2.dll", import.meta.url),
    dexList: new URL("../assets/codeinjection/SpeciesExpansionDexListB2.dll", import.meta.url),
    dexSearch: new URL("../assets/codeinjection/SpeciesExpansionDexSearchB2.dll", import.meta.url),
    dexInfo: new URL("../assets/codeinjection/SpeciesExpansionDexInfoB2.dll", import.meta.url),
  },
};

export type SpeciesExpansionStatus = {
  supported: boolean;
  installed: boolean;
  ready: boolean;
  /** The installed added species. */
  count: number;
  /** National numbers of the installed added species. */
  nationals: number[];
  message: string;
};

/**
 * The Species Expansion card is experimental: it is shown, and installs, only locally or once unlocked
 * (aiFeatureAccess.ts), like Map Studio. The installer itself (installSpeciesExpansion) has no gate, for the build and test scripts.
 */
export function canUseSpeciesExpansionInstaller(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  return canOpenMapStudio(hostname);
}

export function getSpeciesExpansionStatus(project: ProjectState): SpeciesExpansionStatus {
  const config = project.codeInjection?.speciesExpansion;
  const supported = project.session.baseVersion === "W2" || project.session.baseVersion === "B2";
  const nationals = installedExpansionNationals(project);
  const base = { supported, installed: Boolean(config), ready: false, count: nationals.length, nationals };
  if (!supported) return { ...base, message: "The species expansion supports US Black 2 and White 2." };
  if (config) {
    // Some species can be installed now and others later: each keeps its number.
    if (nationals.length < config.count) return { ...base, ready: true, message: `${nationals.length} of ${config.count} species are installed.` };
    return { ...base, message: `All ${config.count} species are installed (national 650-${649 + config.count}).` };
  }
  if (usesWhite2UpgradePokemonData(project) || detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return { ...base, message: "White 2 Upgrade / Black 2 Upgrade ROMs have their own species." };
  }
  return { ...base, ready: true, message: "Ready to install." };
}

/** The package's species ([national, name, family base]), bundled for the installer card. */
const SPECIES_INDEX = indexJson as Array<[number, string, number]>;

export type SpeciesExpansionFamily = {
  /** The family's base species (national; retail's for a new evolution of an old species, as Eevee's Sylveon). */
  family: number;
  label: string;
  generation: 6 | 7 | 8 | 9;
  members: Array<{ national: number; name: string; installed: boolean }>;
};

export function speciesGeneration(national: number): 6 | 7 | 8 | 9 {
  return national <= 721 ? 6 : national <= 809 ? 7 : national <= 905 ? 8 : 9;
}

/** The package's species by evolution family, in national order, with what's installed. */
export function speciesExpansionFamilies(project: ProjectState): SpeciesExpansionFamily[] {
  const installed = new Set(installedExpansionNationals(project));
  const families = new Map<number, SpeciesExpansionFamily>();
  for (const [national, name, family] of SPECIES_INDEX) {
    let entry = families.get(family);
    if (!entry) {
      const base = family <= SPECIES_LAST_RETAIL ? project.texts.banks.pokedex?.[family] : undefined;
      entry = { family, label: base ? `${base}'s line` : name, generation: speciesGeneration(national), members: [] };
      families.set(family, entry);
    }
    entry.members.push({ national, name, installed: installed.has(national) });
  }
  return [...families.values()];
}

export type SpeciesExpansionReport = {
  species: number;
  /** Added species' evolutions into species that aren't installed (they come back when those are). */
  evolutionsWaiting?: string[];
  formsMoved: number;
  abilitiesAdded: string[];
  abilityFallbacks: string[];
  movesLeftOut: string[];
  evolutionsLeftOut: string[];
  spriteStandIns: string[];
  moveExpansion?: "installed" | "present" | "unavailable";
  fairyTypeInstalled?: boolean;
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function store(project: ProjectState, name: NarcName): NarcStore {
  const found = project.narcs[name];
  if (!found) throw new Error(`The ${name} archive is not loaded.`);
  return found;
}

/** Inserts `count` files at `at`, moving the files from `at` on; the record cache is cleared. */
function insertFiles(project: ProjectState, name: NarcName, at: number, count: number, filler: () => Uint8Array): void {
  const target = store(project, name);
  while (target.rawFiles.length < at) target.rawFiles.push(filler());
  target.rawFiles.splice(at, 0, ...Array.from({ length: count }, filler));
  target.fileCount = target.rawFiles.length;
  target.records.clear();
  for (let id = at; id < target.rawFiles.length; id++) target.dirty.add(id);
  markDirty(project, name, at);
}

/** Moves every form record and the regional Pokédex table past the added species; their references follow. */
function moveFormRecords(project: ProjectState): number {
  const personal = store(project, "personal");
  const moved = personal.rawFiles.length - FIRST_FORM_RECORD;
  insertFiles(project, "personal", FIRST_FORM_RECORD, FORM_SHIFT, () => new Uint8Array());
  // Menu Evolution's KO moves are read at the personal record too: theirs move with the records.
  insertKoMoveLearnsetMembers(project, FIRST_FORM_RECORD, FORM_SHIFT);
  for (const name of ["learnsets", "evolutions"] as const) {
    const length = store(project, name).rawFiles.length;
    if (length > FIRST_FORM_RECORD) insertFiles(project, name, FIRST_FORM_RECORD, FORM_SHIFT, () => new Uint8Array());
  }
  const shifted = (id: number) => (id >= FIRST_FORM_RECORD ? id + FORM_SHIFT : id);
  const recordLength = personal.rawFiles[1]!.length;
  for (let id = 1; id < personal.rawFiles.length; id++) {
    // Records only: the regional Pokédex table is a personal file too.
    const record = personal.rawFiles[id]?.length === recordLength ? decodeRecord(project, "personal", id).raw : undefined;
    const first = Number(record?.form_id ?? 0);
    if (record && first >= FIRST_FORM_RECORD) {
      record.form_id = shifted(first);
      refreshRecordReadable(project, "personal", id);
      markDirty(project, "personal", id);
    }
  }
  const evolutions = store(project, "evolutions");
  for (let id = 1; id < evolutions.rawFiles.length; id++) {
    if (!evolutions.rawFiles[id]?.length) continue;
    const record = decodeRecord(project, "evolutions", id).raw;
    if (!record) continue;
    let changed = false;
    for (const field of Object.keys(record)) {
      if (field.startsWith("target_") && Number(record[field]) >= FIRST_FORM_RECORD) {
        record[field] = shifted(Number(record[field]));
        changed = true;
      }
    }
    if (changed) { refreshRecordReadable(project, "evolutions", id); markDirty(project, "evolutions", id); }
  }
  // The name bank keeps an added form's name at its record (megaEditorModel.nameMegaForm); retail's ends at 686.
  moveNameEntries(project, 90, FIRST_ADDED_SPECIES, FORM_SHIFT);
  const regional = project.codeInjection?.regionalForms;
  if (regional) regional.forms = regional.forms.map((form) => ({ ...form, personalId: shifted(form.personalId) }));
  return moved;
}

/** Moves a bank's entries from `from` on by `by`, leaving empty entries behind. */
function moveNameEntries(project: ProjectState, bankId: number, from: number, by: number): void {
  const bank = getTextBank(project, "message_texts", bankId);
  if (!bank.some((entry) => parseTextEntryId(entry[0]).entry >= from)) return;
  const next: Gen5TextEntry[] = bank.map((entry) => {
    const id = parseTextEntryId(entry[0]);
    return id.entry >= from ? [`${id.block}_${id.entry + by}${id.suffix}`, entry[1], entry[2]] : entry;
  });
  const blocks = new Set(bank.map((entry) => parseTextEntryId(entry[0]).block));
  for (const block of blocks) {
    for (let entry = from; entry < from + by; entry++) next.push([`${block}_${entry}`, "", 0]);
  }
  bank.splice(0, bank.length, ...sortEntries(next));
  commitTextBank(project, "message_texts", bankId);
}

function sortEntries(entries: Gen5TextEntry[]): Gen5TextEntry[] {
  return entries.sort((a, b) => {
    const left = parseTextEntryId(a[0]), right = parseTextEntryId(b[0]);
    return left.block - right.block || left.entry - right.entry;
  });
}

/** Sets a bank's entries (every block), adding empty entries up to the last. */
function setNameEntries(project: ProjectState, bankId: number, texts: ReadonlyMap<number, string>): void {
  const bank = getTextBank(project, "message_texts", bankId);
  const ids = bank.map((entry) => parseTextEntryId(entry[0]));
  const count = Math.max(0, ...ids.map((id) => id.entry + 1));
  const blocks = new Set(ids.map((id) => id.block));
  for (let entry = count; entry <= Math.max(...texts.keys()); entry++) {
    for (const block of blocks) bank.push([`${block}_${entry}`, "", 0]);
  }
  for (const entry of bank) {
    const text = texts.get(parseTextEntryId(entry[0]).entry);
    if (text !== undefined) entry[1] = text;
  }
  bank.splice(0, bank.length, ...sortEntries(bank.slice()));
  commitTextBank(project, "message_texts", bankId);
}

/** The regional Pokédex table, grown to every species (999: none). */
function growRegionalDex(project: ProjectState, file: number, species: number): void {
  const personal = store(project, "personal");
  const old = personal.rawFiles[file]!;
  const entries = Math.max(old.length / 2, species);
  const next = new Uint8Array(entries * 2);
  next.set(old);
  for (let i = old.length / 2; i < entries; i++) { next[i * 2] = REGIONAL_DEX_NONE & 0xff; next[i * 2 + 1] = REGIONAL_DEX_NONE >> 8; }
  personal.rawFiles[file] = next;
  personal.records.delete(file);
  markDirty(project, "personal", file);
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, value >> 8);
}

/** Writes an added species' personal record (a copy of Bulbasaur's, with its own fields and no forms). */
function writePersonal(project: ProjectState, species: number, entry: ExpansionSpecies, typeCount: number): void {
  const personal = store(project, "personal");
  personal.rawFiles[species] = personal.rawFiles[1]!.slice();
  personal.records.delete(species);
  const record = decodeRecord(project, "personal", species);
  if (!record.raw) throw new Error(`Personal record ${species} could not be read.`);
  const p = entry.personal;
  const [hp, atk, def, speed, spatk, spdef] = p.stats;
  const types = p.types.map((type) => (type < typeCount && (type !== FAIRY || typeCount > FAIRY) ? type : -1));
  const values: Record<string, number> = {
    base_hp: hp!, base_atk: atk!, base_def: def!, base_speed: speed!, base_spatk: spatk!, base_spdef: spdef!,
    // A type the ROM lacks (Fairy without Fairy Type Support): the other type, else Normal.
    type_1: types[0]! >= 0 ? types[0]! : Math.max(0, types[1]!), type_2: types[1]! >= 0 ? types[1]! : Math.max(0, types[0]!),
    catchrate: p.catchRate, stage: p.stage, evs: p.evs, item_1: p.items[0]!, item_2: p.items[1]!, item_3: p.items[2]!,
    gender: p.gender, hatch_cycle: p.hatchCycles, base_happy: p.happiness, exp_rate: p.growth,
    egg_group_1: p.eggGroups[0]!, egg_group_2: p.eggGroups[1]!, flee: p.flee, color: p.color, base_exp: p.baseExp,
    height: p.height, weight: p.weight, form_id: 0, form: 0, num_forms: 1,
    "tm_1-32": p.tm[0]!, "tm_33-64": p.tm[1]!, "tm_65-95+hm_1": p.tm[2]!, "hm_2-6": p.tm[3]!, tutors: p.typeTutors,
  };
  (["driftveil_tutor", "lentimas_tutor", "humilau_tutor", "nacrene_tutor"] as const).forEach((field, n) => { values[field] = p.tutors[n]!; });
  for (const [field, value] of Object.entries(values)) if (field in record.raw) record.raw[field] = value;
  refreshRecordReadable(project, "personal", species);
  markDirty(project, "personal", species);
}

/** A sprite block for an added species: a copy of Bulbasaur's (the PWAN import replaces it), its icon after it. */
function addSpriteBlock(project: ProjectState): number {
  const sprites = store(project, "pokemon_sprites");
  const donor = getPokemonSpriteEntry(project, 1).files;
  // Retail's archive ends with five reserved members (addPokemonForm): the gap to a whole block takes the donor's last files.
  const padding = (SPRITE_FILES - (sprites.rawFiles.length % SPRITE_FILES)) % SPRITE_FILES;
  for (const file of donor.slice(SPRITE_FILES - padding)) sprites.rawFiles.push(file.slice());
  const block = sprites.rawFiles.length / SPRITE_FILES;
  for (const file of donor) sprites.rawFiles.push(file.slice());
  sprites.fileCount = sprites.rawFiles.length;
  for (let id = block * SPRITE_FILES - padding; id < sprites.rawFiles.length; id++) sprites.dirty.add(id);
  markDirty(project, "pokemon_sprites", block * SPRITE_FILES);
  const icons = store(project, "pokemon_icons");
  const icon = ICON_HEADER + block * 2;
  while (icons.rawFiles.length < icon) icons.rawFiles.push(new Uint8Array());
  icons.rawFiles[icon] = icons.rawFiles[ICON_HEADER + 2]!.slice(); // Bulbasaur's, until the library icon
  icons.rawFiles[icon + 1] = new Uint8Array();
  icons.fileCount = icons.rawFiles.length;
  icons.dirty.add(icon); icons.dirty.add(icon + 1);
  markDirty(project, "pokemon_icons", icon);
  ensurePokemonIconPaletteAssignmentCapacity(project, block);
  setPokemonIconPaletteAssignment(project, block, "male", 0);
  setPokemonIconPaletteAssignment(project, block, "female", 0);
  return block;
}

const FIELD_OVERLAY = 36;
const DEX_SEARCH_OVERLAY = 302;
const SPECIES_LAST_RETAIL = 649;
const DEX_TEXT_BANKS = [442, 451, 464, 471] as const;
// CheckResetKeldeoOrdinaryForme (overlay 36, at every field map start and end) corrupts a party Pokémon whose species is
// above 649 (two 0xFF bytes into its encrypted data: a bad egg). Its limit is built in a stack slot:
//   adds r0, r7, #0 (548) / str r0, [sp, #20] / adds r0, #101 / movs r6, #0 / str r0, [sp, #20]
// which becomes  movs r0, #(limit >> 3) / lsls r0, r0, #3 / adds r0, #(limit & 7) / movs r6, #0 / str r0, [sp, #20].
const FIELD_GUARD_RETAIL = [0x38, 0x1c, 0x05, 0x90, 0x65, 0x30, 0x00, 0x26, 0x05, 0x90];

function fieldGuardAt(code: Uint8Array): { at: number; patched: boolean } | undefined {
  for (let at = 0; at + FIELD_GUARD_RETAIL.length <= code.length; at += 2) {
    if (FIELD_GUARD_RETAIL.every((value, i) => code[at + i] === value)) return { at, patched: false };
    if (code[at + 1] === 0x20 && code[at + 2] === 0xc0 && code[at + 3] === 0x00 && code[at + 5] === 0x30
        && code[at + 6] === 0x00 && code[at + 7] === 0x26 && code[at + 8] === 0x05 && code[at + 9] === 0x90) return { at, patched: true };
  }
  return undefined;
}

/** Overlay 36 with its species check raised to `last` (retail's or an earlier patch's). */
export function patchFieldSpeciesGuardCode(code: Uint8Array, last: number): Uint8Array {
  const found = fieldGuardAt(code);
  if (!found) throw new Error("The field's species check (overlay 36) was not found.");
  if (last < 649 || last > 2047) throw new Error(`Species ${last} can't be the field's limit.`);
  const next = code.slice();
  next.set([last >> 3, 0x20, 0xc0, 0x00, last & 7, 0x30], found.at);
  return next;
}

/** Raises the field's species check to the last added species, so the added species are kept. */
function patchFieldSpeciesGuard(project: ProjectState, rom: NintendoDSRom, last: number): void {
  hydrateMissingOverlays(project, rom, [FIELD_OVERLAY]);
  const code = project.overlays[FIELD_OVERLAY];
  if (!code) throw new Error("Overlay 36 could not be loaded.");
  project.overlays[FIELD_OVERLAY] = patchFieldSpeciesGuardCode(code, last);
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(FIELD_OVERLAY)) project.patches.dirtyOverlayIds.push(FIELD_OVERLAY);
}

/** Stages the runtime DLLs, the core one with its table ("PWSX"). */
async function stageRuntime(project: ProjectState, config: NonNullable<NonNullable<ProjectState["codeInjection"]>["speciesExpansion"]>): Promise<void> {
  const game = project.session.baseVersion as "W2" | "B2";
  for (const part of RUNTIME_PARTS) {
    const entry = MANIFEST.games[game][part];
    const response = await fetch(DLL_URLS[game][part]);
    if (!response.ok) throw new Error(`Could not load bundled ${entry.fileName} (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (part === "core") {
      const at = entry.configOffset!;
      if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== "PWSX") throw new Error(`${entry.fileName} has no species table.`);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const capacity = (bytes.length - at - 12) / 4;
      if (config.count > capacity) throw new Error(`${entry.fileName} holds at most ${capacity} species.`);
      view.setUint16(at + 6, config.count, true);
      view.setUint16(at + 8, config.regionalDexFile, true);
      for (let i = 0; i < config.count; i++) {
        view.setUint16(at + 12 + i * 4, config.sprites[i]!, true);
        const species = FIRST_ADDED_SPECIES + i;
        view.setUint16(at + 14 + i * 4, config.cries[i]! | (config.restricted?.includes(species) ? RESTRICTED_FLAG : 0)
          | (config.mythical?.includes(species) ? MYTHICAL_FLAG : 0), true);
      }
    }
    stageCodeInjectionDll(project, entry.fileName, bytes, "patches");
  }
}

/** A blank record for a slot the user leaves out: no species (the editors hide it, the runtime treats it as none). */
function writeAbsentSlot(project: ProjectState, species: number): void {
  const personal = store(project, "personal");
  personal.rawFiles[species] = new Uint8Array(personal.rawFiles[1]!.length);
  personal.records.delete(species);
  markDirty(project, "personal", species);
  const learnsets = store(project, "learnsets"), evolutions = store(project, "evolutions");
  learnsets.rawFiles[species] = emptyLearnsetRecord();
  learnsets.records.delete(species);
  markDirty(project, "learnsets", species);
  evolutions.rawFiles[species] = emptyEvolutionRecord(project, evolutions, 1);
  evolutions.records.delete(species);
  markDirty(project, "evolutions", species);
}

type EvolutionRow = { method: number; param: number; target: number };

function evolutionRows(project: ProjectState, species: number): EvolutionRow[] {
  const raw = decodeRecord(project, "evolutions", species).raw ?? {};
  const rows: EvolutionRow[] = [];
  for (let slot = 0; `method_${slot}` in raw; slot++) {
    const method = Number(raw[`method_${slot}`]);
    if (method) rows.push({ method, param: Number(raw[`param_${slot}`]), target: Number(raw[`target_${slot}`]) });
  }
  return rows;
}

/** An added species' evolutions in the ROM's numbering; a row into a species that isn't installed waits (undefined). */
function contentEvolutions(entry: ExpansionSpecies, moveByName: ReadonlyMap<string, number>, report: SpeciesExpansionReport): Array<EvolutionRow & { national: number }> {
  return entry.evolutions.flatMap((row) => {
    let param = row.param;
    if (row.method === 21 && param > LAST_RETAIL_MOVE) {
      const move = moveByName.get(normalize(row.moveName ?? ""));
      if (move === undefined) { report.evolutionsLeftOut.push(`${entry.name}: knows ${row.moveName}`); return []; }
      param = move;
    }
    if (row.method === 22) param = expansionSpeciesOf(param);
    return [{ method: row.method, param, target: expansionSpeciesOf(row.species), national: row.species }];
  });
}

/**
 * Installs added species into a staged project (Fairy Type Support, Move Expansion and PWAN first): `nationals`, or all.
 * Every species keeps its number (national + 37), installed or not: the first install moves the form records past
 * all of them and leaves blank slots for the ones left out, which a later install fills in.
 */
export async function stageSpeciesExpansion(project: ProjectState, nationals?: readonly number[]): Promise<SpeciesExpansionReport> {
  const status = getSpeciesExpansionStatus(project);
  if (!status.ready) throw new Error(status.message);
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing the species expansion.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["personal", "learnsets", "evolutions", "egg_moves", "baby_species", "pokemon_sprites",
    "pokemon_icons", "message_texts", "pokedex_search", "pokemon_footprints", "town_map_species_habitats"]);
  const content = await loadExpansionSpecies();
  const installedBefore = new Set(status.nationals);
  const chosen = new Set(nationals ?? content.map((entry) => entry.national));
  const adding = content.filter((entry) => chosen.has(entry.national) && !installedBefore.has(entry.national));
  if (!adding.length) throw new Error("Choose at least one species that isn't installed yet.");
  const present = new Set([...installedBefore, ...adding.map((entry) => entry.national)]);
  const [library, carrier] = await Promise.all([loadPwanLibrary(), loadBundledPwanCarrierTemplate(project.session.baseVersion === "B2" ? "B2" : "W2")]);
  const report: SpeciesExpansionReport = { species: 0, formsMoved: 0, abilitiesAdded: [], abilityFallbacks: [], movesLeftOut: [],
    evolutionsLeftOut: [], evolutionsWaiting: [], spriteStandIns: [] };
  const typeCount = detectFairyTypePatch(project) === "patched" ? 18 : 17;
  const moveByName = new Map<string, number>();
  (project.texts.banks.moves ?? []).forEach((name, id) => { if (id > 0 && name && !moveByName.has(normalize(name))) moveByName.set(normalize(name), id); });

  // Abilities first: one the ROM lacks is added through a staged install of its own, which replaces the project's state.
  const abilities = await resolveAbilities(project, adding, report);
  // Byte copies and moves below: pending record edits first.
  materializeProjectEdits(project);
  const first = !project.codeInjection?.speciesExpansion;
  const learnsets = store(project, "learnsets"), evolutions = store(project, "evolutions");
  const eggMoves = store(project, "egg_moves"), babies = store(project, "baby_species");
  let config = project.codeInjection?.speciesExpansion;
  if (!config) {
    report.formsMoved = moveFormRecords(project);
    const regionalDexFile = RETAIL_REGIONAL_DEX_FILE + FORM_SHIFT;
    // The configuration from here on: with it, the long personal archive is not read as White2Upgrade's, and the
    // sprite model resolves an added species' sprite block. A slot without a sprite block (0) is left out.
    const restricted = content.filter((entry) => entry.restricted).map((entry) => expansionSpeciesOf(entry.national));
    const mythical = content.filter((entry) => entry.mythical).map((entry) => expansionSpeciesOf(entry.national));
    config = { version: SPECIES_EXPANSION_VERSION, count: content.length, regionalDexFile, formShift: FORM_SHIFT,
      sprites: content.map(() => 0), cries: content.map((entry) => entry.cry), restricted, mythical };
    project.codeInjection ??= {};
    project.codeInjection.speciesExpansion = config;
    growRegionalDex(project, regionalDexFile, LAST_ADDED_SPECIES + 1);
    while (eggMoves.rawFiles.length < FIRST_ADDED_SPECIES) eggMoves.rawFiles.push(u16(0));
    while (babies.rawFiles.length < FIRST_ADDED_SPECIES) babies.rawFiles.push(u16(babies.rawFiles.length));
    for (const entry of content) {
      const species = expansionSpeciesOf(entry.national);
      eggMoves.rawFiles[species] = u16(0);
      babies.rawFiles[species] = u16(species);
      if (!present.has(entry.national)) writeAbsentSlot(project, species);
    }
  }
  const last = FIRST_ADDED_SPECIES + config.count - 1;
  const names = new Map<number, Map<number, string>>(SPECIES_NAME_BANKS.map((id) => [id, new Map()]));
  if (first) for (const entry of content) if (!present.has(entry.national)) for (const id of SPECIES_NAME_BANKS) names.get(id)!.set(expansionSpeciesOf(entry.national), "");

  for (const entry of adding) {
    const species = expansionSpeciesOf(entry.national);
    writePersonal(project, species, entry, typeCount);
    const record = decodeRecord(project, "personal", species).raw!;
    const own = entry.abilities.map((id) => abilities.get(id));
    const fallback = own.find((id) => id !== undefined) ?? 0;
    own.forEach((id, slot) => {
      const label = `${entry.name}: ${entry.abilityNames[String(entry.abilities[slot])] ?? entry.abilities[slot]}`;
      if (id === undefined && !report.abilityFallbacks.includes(label)) report.abilityFallbacks.push(label);
      record[`ability_${slot + 1}`] = id ?? fallback;
    });
    refreshRecordReadable(project, "personal", species);

    learnsets.rawFiles[species] = emptyLearnsetRecord();
    learnsets.records.delete(species);
    const moves: Array<{ moveId: number; level: number }> = [];
    for (const [level, move, name] of entry.learnset) {
      const id = move <= LAST_RETAIL_MOVE ? move : moveByName.get(normalize(name ?? ""));
      if (id === undefined) { report.movesLeftOut.push(`${name} (${entry.name})`); continue; }
      moves.push({ moveId: id, level });
    }
    setPokemonLearnset(project, species, moves);
    evolutions.rawFiles[species] = emptyEvolutionRecord(project, evolutions, 1);
    evolutions.records.delete(species);

    names.get(90)!.set(species, entry.name);
    names.get(483)!.set(species, `VAR(48385)${/^[aeiou]/iu.test(entry.name) ? "an" : "a"} VAR(65280, 255)${entry.name}`);
    names.get(486)!.set(species, entry.name.toUpperCase());
    eggMoves.rawFiles[species] = u16(0);

    config.sprites[species - FIRST_ADDED_SPECIES] = addSpriteBlock(project);
    config.cries[species - FIRST_ADDED_SPECIES] = entry.cry;
    if (entry.spriteStandIn) report.spriteStandIns.push(`${entry.name} uses ${content.find((other) => other.national === entry.spriteStandIn)?.name}'s sprite`);
    report.species++;
  }
  // Eggs hatch into the earliest installed species of the family (Froakie's line without Froakie: Frogadier).
  const families = new Set(adding.map((entry) => entry.family));
  for (const entry of content) {
    if (!present.has(entry.national) || !families.has(entry.family)) continue;
    const base = entry.family <= SPECIES_LAST_RETAIL ? entry.family
      : content.filter((other) => other.family === entry.family && present.has(other.national))
        .sort((a, b) => a.personal.stage - b.personal.stage || a.national - b.national)[0]!.national;
    babies.rawFiles[expansionSpeciesOf(entry.national)] = u16(expansionSpeciesOf(base));
  }
  for (const id of SPECIES_NAME_BANKS) setNameEntries(project, id, names.get(id)!);
  // The Pokédex: its texts, lists, footprints and area maps.
  stagePokedexData(project, adding, { first });
  for (const id of DEX_TEXT_BANKS) commitTextBank(project, "message_texts", id);
  for (const target of [eggMoves, babies]) {
    target.fileCount = target.rawFiles.length;
    for (let id = 0; id < target.rawFiles.length; id++) target.dirty.add(id);
    markDirty(project, target.name, FIRST_ADDED_SPECIES);
  }

  // Evolutions into species that aren't installed wait for them: an installed species gets them when they come.
  const waiting = (entry: ExpansionSpecies, national: number) => `${entry.name} → ${content.find((other) => other.national === national)?.name ?? national}`;
  for (const entry of adding) {
    const species = expansionSpeciesOf(entry.national);
    const rows = contentEvolutions(entry, moveByName, report).filter((row) => {
      if (present.has(row.national) || row.national <= SPECIES_LAST_RETAIL) return true;
      report.evolutionsWaiting!.push(waiting(entry, row.national));
      return false;
    });
    setPokemonEvolutions(project, species, rows.map(({ method, param, target }) => ({ method, param, target })));
    if (entry.library) importPwanLibraryEntryFromLoadedLibrary(project, species, entry.library, library, carrier);
  }
  const added = new Set(adding.map((entry) => entry.national));
  for (const entry of content) {
    if (!installedBefore.has(entry.national)) continue;
    const species = expansionSpeciesOf(entry.national);
    const current = evolutionRows(project, species);
    const arriving = contentEvolutions(entry, moveByName, { ...report, evolutionsLeftOut: [] })
      .filter((row) => added.has(row.national) && !current.some((other) => other.target === row.target));
    if (arriving.length) setPokemonEvolutions(project, species, [...current, ...arriving.map(({ method, param, target }) => ({ method, param, target }))]);
  }

  await stageRuntime(project, config);
  patchFieldSpeciesGuard(project, rom, last);
  hydrateMissingOverlays(project, rom, [DEX_SEARCH_OVERLAY]);
  project.overlays[DEX_SEARCH_OVERLAY] = patchDexSearchCode(project.overlays[DEX_SEARCH_OVERLAY]!, SPECIES_LAST_RETAIL + present.size);
  if (!project.patches!.dirtyOverlayIds.includes(DEX_SEARCH_OVERLAY)) project.patches!.dirtyOverlayIds.push(DEX_SEARCH_OVERLAY);
  const credits = [...new Set(adding.flatMap((entry) => [entry.credits.front, entry.credits.back]).filter((credit): credit is string => Boolean(credit)))];
  const which = adding.length === content.length ? `national 650-${649 + content.length}` : adding.map((entry) => entry.name).join(", ");
  recordGenericChange(project, "code_injection",
    `Species expansion: ${report.species} species added (${which}; ROM species = national + ${NATIONAL_OFFSET})` +
    (first ? `; ${report.formsMoved} form records and the regional Pokédex table moved by ${FORM_SHIFT}` : "") +
    `. Data from White2Upgrade; sprites by ${credits.join("; ")}.`,
    "Species Expansion", { key: `code-injection:species-expansion:${[...present].sort((a, b) => a - b).join(",")}` });
  return report;
}

/** Fairy Type Support, Move Expansion and the animated sprite runtime first (in the live project), then the species. */
export async function installSpeciesExpansion(
  project: ProjectState,
  install: (stage: (staged: ProjectState) => Promise<SpeciesExpansionReport>) => Promise<SpeciesExpansionReport>,
  nationals?: readonly number[],
): Promise<SpeciesExpansionReport> {
  const status = getSpeciesExpansionStatus(project);
  if (!status.ready) throw new Error(status.message);
  // Adding species to an installed expansion: its dependencies came with the first install.
  if (status.installed) return install((staged) => stageSpeciesExpansion(staged, nationals));
  if (!hasPwanRuntimeDll(project)) await installPwanRuntime(project);
  const fairyBefore = detectFairyTypePatch(project);
  if (fairyBefore === "unpatched") await addFairyTypeSupport(project, { updateModernFairyTypings: true });
  let moveExpansion: SpeciesExpansionReport["moveExpansion"] = "present";
  const moveState = detectMoveExpansionPatch(project);
  if (moveState === "unpatched" || moveState === "routing-only") {
    await addMoveExpansion(project);
    moveExpansion = "installed";
  } else if (moveState !== "patched") {
    moveExpansion = "unavailable";
  }
  const report = await install((staged) => stageSpeciesExpansion(staged, nationals));
  return { ...report, moveExpansion, fairyTypeInstalled: fairyBefore === "unpatched" && detectFairyTypePatch(project) === "patched" };
}

