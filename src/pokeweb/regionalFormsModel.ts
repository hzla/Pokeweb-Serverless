import contentJson from "../assets/data/regionalForms.json";
import zenModeManifest from "../assets/codeinjection/regionalZenModeManifest.json";
import { recordGenericChange } from "./actionChangelog";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { resolveAbilities } from "./megaContentModel";
import { nameMegaForm } from "./megaEditorModel";
import { detectMoveExpansionPatch } from "./moveExpansionPatch";
import { NintendoDSRom } from "../nds/rom";
import { detectBlack2UpgradeDlls, detectWhite2UpgradeDlls, prepareFormEvolutionCodeInjection, stageCodeInjectionDll } from "./pmcModel";
import { addPokemonForm } from "./pokemonFormModel";
import { pokemonSpeciesLabel } from "./pokemonLabels";
import { setPokemonEvolutions, setPokemonLearnset, usesWhite2UpgradePokemonData } from "./pokemonModel";
import { decodeRecord, markDirty, refreshRecordReadable, type ProjectState } from "./projectStore";
import { loadBundledPwanCarrierTemplate } from "./pwanCarrierPatch";
import { hasPwanRuntimeDll, installPwanRuntime } from "./pwanAnimationModel";
import { importPwanLibraryEntryFromLoadedLibrary, loadPwanLibrary } from "./pwanLibraryModel";
import { addFairyTypeSupport, addMoveExpansion, detectFairyTypePatch } from "./romPatchModel";

/**
 * The regional forms package: the Alolan, Galarian, Hisuian and Paldean forms of species 1-649 as added forms of their
 * species (stats, types, abilities, held items, TM and tutor compatibility, level-up moves, evolutions, animated
 * sprites and icons), from the user's White2Upgrade data and the PWAN library (runtime/regional-forms/content builds
 * src/assets/data/regionalForms.json).
 *
 * Installed by family (an evolution line), so a family the user already gave forms of their own can be left out.
 * Fairy Type Support and Move Expansion are installed first (Fairy types and newer moves); the evolution by form
 * runtime makes each form evolve by its own record. Abilities the ability library cannot add keep the base form's;
 * moves the ROM does not have are left out of the learnsets. A battle runtime gives Galarian Darmanitan Zen Mode
 * (runtime/regional-forms: RegionalZenMode<game>.dll).
 */

type RegionalPersonal = {
  stats: number[]; types: number[]; catchRate: number; stage: number; evs: number; items: number[]; gender: number;
  hatchCycles: number; happiness: number; growth: number; eggGroups: number[]; flee: number; color: number;
  baseExp: number; height: number; weight: number; tm: number[]; typeTutors: number; tutors: number[];
};
export type RegionalForm = {
  key: string;
  name: string;
  species: number;
  family: number;
  w2uForm: number;
  suffix: string;
  library: string;
  credits: Partial<Record<"front" | "back", string>>;
  personal: RegionalPersonal;
  abilities: number[];
  abilityNames: Record<string, string>;
  abilityDescriptions: Record<string, string>;
  /** [level, move, name for moves newer than Gen 5] */
  learnset: Array<[number, number] | [number, number, string]>;
  /** A row's target is the regional form `form` of `species`, else the species. */
  evolutions: Array<{ method: number; param: number; species: number; form?: string }>;
};

export const REGIONAL_FORMS = (contentJson as unknown as { forms: RegionalForm[] }).forms;
export const REGIONAL_FORMS_VERSION = 1;
const LAST_RETAIL_MOVE = 559;
const FAIRY = 17;
const ZEN_MODE_URLS = {
  B: new URL("../assets/codeinjection/RegionalZenModeB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/RegionalZenModeW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/RegionalZenModeB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/RegionalZenModeW2.dll", import.meta.url),
} as const;
const FIRST_APPENDED_FORM = { BW: 669, BW2: 710 } as const;
/** An evolution that cannot happen ("use item 0"): a form that does not evolve though its species does. */
const NO_EVOLUTION = { method: 8, param: 0 };

export type RegionalFamily = {
  /** The first species of the evolution line. */
  id: number;
  name: string;
  forms: RegionalForm[];
  /** Keys of this family's forms already in the ROM (by their names). */
  installed: string[];
  /** Forms of the family's species added before (not by this package): name labels. */
  otherForms: string[];
};

export type RegionalFormsStatus = {
  supported: boolean;
  ready: boolean;
  installedForms: number;
  message: string;
};

export type RegionalFormsReport = {
  forms: Array<{ key: string; name: string; species: number; form: number; personalId: number }>;
  skipped: Array<{ name: string; reason: string }>;
  abilitiesAdded: string[];
  /** Forms whose ability slot kept the base form's ability: "Galarian Stunfisk: Mimicry". */
  abilityFallbacks: string[];
  /** Moves the ROM does not have, left out: "Snap Trap (Galarian Stunfisk)". */
  movesLeftOut: string[];
  noEvolution: string[];
  /** The Galarian Zen Mode runtime was staged. */
  zenMode?: boolean;
  fairyTypeInstalled?: boolean;
  moveExpansion?: "present" | "installed" | "unavailable";
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

/** "Rattata-Alola": the name the package gives a form, which also tells it is installed. */
function formLabel(project: ProjectState, form: RegionalForm): string {
  return `${pokemonSpeciesLabel(project, form.species)}-${form.suffix}`;
}

/** Form personal records of a species: [form, personal ID, label]. */
function speciesForms(project: ProjectState, species: number): Array<{ form: number; personalId: number; label: string }> {
  const raw = decodeRecord(project, "personal", species).raw ?? {};
  const count = Math.max(1, Number(raw.num_forms ?? 1));
  const first = Number(raw.form_id ?? 0);
  if (first <= 0) return [];
  return Array.from({ length: count - 1 }, (_, n) => ({ form: n + 1, personalId: first + n, label: pokemonSpeciesLabel(project, first + n) }));
}

/** The personal ID of each package form already in the ROM. */
function installedForms(project: ProjectState): Map<string, { form: number; personalId: number }> {
  const out = new Map<string, { form: number; personalId: number }>();
  for (const form of REGIONAL_FORMS) {
    const label = normalize(formLabel(project, form));
    const found = speciesForms(project, form.species).find((candidate) => normalize(candidate.label) === label);
    if (found) out.set(form.key, { form: found.form, personalId: found.personalId });
  }
  return out;
}

export function regionalFamilies(project: ProjectState): RegionalFamily[] {
  // Without the personal data loaded, the forms this project's installs recorded.
  const installed = project.narcs.personal ? installedForms(project)
    : new Map((project.codeInjection?.regionalForms?.forms ?? []).map((form) => [form.key, form]));
  const firstAppended = FIRST_APPENDED_FORM[project.session.baseRom === "BW" ? "BW" : "BW2"];
  const families = new Map<number, RegionalFamily>();
  for (const form of REGIONAL_FORMS) {
    let family = families.get(form.family);
    if (!family) {
      family = { id: form.family, name: pokemonSpeciesLabel(project, form.family), forms: [], installed: [], otherForms: [] };
      families.set(form.family, family);
    }
    family.forms.push(form);
    if (installed.has(form.key)) family.installed.push(form.key);
  }
  if (project.narcs.personal) {
    const ours = new Set([...installed.values()].map((entry) => entry.personalId));
    for (const family of families.values()) {
      for (const species of new Set(family.forms.map((form) => form.species))) {
        for (const entry of speciesForms(project, species)) {
          if (entry.personalId >= firstAppended && !ours.has(entry.personalId)) family.otherForms.push(entry.label);
        }
      }
    }
  }
  return [...families.values()];
}

export function getRegionalFormsStatus(project: ProjectState): RegionalFormsStatus {
  const status: RegionalFormsStatus = { supported: false, ready: false, installedForms: 0, message: "" };
  const version = project.session.baseVersion;
  if (!["B", "W", "B2", "W2"].includes(version) || project.session.generation === "gen4") {
    return { ...status, message: "Regional forms support US Black, White, Black 2 and White 2." };
  }
  status.supported = true;
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project) || (project.narcs.personal && usesWhite2UpgradePokemonData(project))) {
    return { ...status, supported: false, message: "White 2 Upgrade / Black 2 Upgrade already have the regional forms." };
  }
  status.installedForms = project.narcs.personal ? installedForms(project).size : project.codeInjection?.regionalForms?.forms.length ?? 0;
  status.ready = true;
  status.message = status.installedForms ? `${status.installedForms} of ${REGIONAL_FORMS.length} regional forms are installed.` : "Ready to install.";
  return status;
}

function writePersonal(project: ProjectState, personalId: number, form: RegionalForm, typeCount: number): void {
  const p = form.personal;
  const record = decodeRecord(project, "personal", personalId);
  if (!record.raw) throw new Error(`Personal record ${personalId} could not be read.`);
  const [hp, atk, def, speed, spatk, spdef] = p.stats;
  const values: Record<string, number> = {
    base_hp: hp!, base_atk: atk!, base_def: def!, base_speed: speed!, base_spatk: spatk!, base_spdef: spdef!,
    catchrate: p.catchRate, stage: p.stage, evs: p.evs, item_1: p.items[0]!, item_2: p.items[1]!, item_3: p.items[2]!,
    gender: p.gender, hatch_cycle: p.hatchCycles, base_happy: p.happiness, exp_rate: p.growth,
    egg_group_1: p.eggGroups[0]!, egg_group_2: p.eggGroups[1]!, flee: p.flee, color: p.color, base_exp: p.baseExp,
    height: p.height, weight: p.weight,
    "tm_1-32": p.tm[0]!, "tm_33-64": p.tm[1]!, "tm_65-95+hm_1": p.tm[2]!, "hm_2-6": p.tm[3]!, tutors: p.typeTutors,
  };
  // Fairy is type 17 with Fairy Type Support; without it the slot keeps the base form's type.
  p.types.forEach((type, slot) => { if (type < typeCount && (type !== FAIRY || typeCount > FAIRY)) values[`type_${slot + 1}`] = type; });
  if (project.session.baseRom === "BW2") {
    (["driftveil_tutor", "lentimas_tutor", "humilau_tutor", "nacrene_tutor"] as const).forEach((field, n) => {
      if (field in record.raw!) values[field] = p.tutors[n]!;
    });
  }
  for (const [field, value] of Object.entries(values)) if (field in record.raw) record.raw[field] = value;
  refreshRecordReadable(project, "personal", personalId);
  markDirty(project, "personal", personalId);
}

/**
 * Installs the regional forms of the chosen families (all when `families` is omitted) into a staged project. Forms
 * already in the ROM (found by name) are kept; the others are added after the species' existing forms.
 */
export async function stageRegionalForms(project: ProjectState, families?: readonly number[]): Promise<RegionalFormsReport> {
  const status = getRegionalFormsStatus(project);
  if (!status.ready) throw new Error(status.message);
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing the regional forms.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["personal", "learnsets", "evolutions", "pokemon_sprites", "pokemon_icons", "message_texts"]);
  const chosen = families ? new Set(families) : undefined;
  const selected = REGIONAL_FORMS.filter((form) => !chosen || chosen.has(form.family));
  if (!selected.length) throw new Error("Choose at least one family.");
  const [library, carrier] = await Promise.all([loadPwanLibrary(), loadBundledPwanCarrierTemplate(project.session.baseVersion === "B2" ? "B2" : "W2")]);
  const report: RegionalFormsReport = { forms: [], skipped: [], abilitiesAdded: [], abilityFallbacks: [], movesLeftOut: [], noEvolution: [] };
  const typeCount = detectFairyTypePatch(project) === "patched" ? 18 : 17;
  const moveNames = project.texts.banks.moves ?? [];
  const moveByName = new Map<string, number>();
  moveNames.forEach((name, id) => { if (id > 0 && name && !moveByName.has(normalize(name))) moveByName.set(normalize(name), id); });

  const present = installedForms(project);
  const toAdd = selected.filter((form) => {
    if (present.has(form.key)) { report.skipped.push({ name: form.name, reason: "already installed" }); return false; }
    if (!decodeRecord(project, "personal", form.species).raw) { report.skipped.push({ name: form.name, reason: "the species is missing" }); return false; }
    return true;
  });
  const abilities = await resolveAbilities(project, toAdd, report);
  const added = new Map(present);

  for (const form of toAdd) {
    const result = addPokemonForm(project, form.species);
    const personalId = result.personalId;
    nameMegaForm(project, personalId, form.suffix);
    writePersonal(project, personalId, form, typeCount);
    const record = decodeRecord(project, "personal", personalId).raw!;
    for (let slot = 0; slot < 3; slot++) {
      const ability = abilities.get(form.abilities[slot]!);
      if (ability === undefined) {
        const name = form.abilityNames[String(form.abilities[slot])] ?? String(form.abilities[slot]);
        if (!report.abilityFallbacks.includes(`${form.name}: ${name}`)) report.abilityFallbacks.push(`${form.name}: ${name}`);
        continue; // the base form's ability stays in this slot
      }
      if (`ability_${slot + 1}` in record) record[`ability_${slot + 1}`] = ability;
    }
    refreshRecordReadable(project, "personal", personalId);
    markDirty(project, "personal", personalId);

    const learnset: Array<{ moveId: number; level: number }> = [];
    for (const [level, move, name] of form.learnset) {
      const id = move <= LAST_RETAIL_MOVE ? move : moveByName.get(normalize(name ?? ""));
      if (id === undefined) { report.movesLeftOut.push(`${name} (${form.name})`); continue; }
      learnset.push({ moveId: id, level });
    }
    setPokemonLearnset(project, personalId, learnset);

    importPwanLibraryEntryFromLoadedLibrary(project, personalId, form.library, library, carrier);
    added.set(form.key, { form: result.formIndex, personalId });
    report.forms.push({ key: form.key, name: form.name, species: form.species, form: result.formIndex, personalId });
  }

  // Evolutions, once every form of the family has its record: a target that is a regional form names its record.
  for (const form of toAdd) {
    const personalId = added.get(form.key)!.personalId;
    const rows = form.evolutions.map((row) => ({
      method: row.method, param: row.param,
      target: row.form && added.has(row.form) ? added.get(row.form)!.personalId : row.species,
    }));
    const speciesEvolves = Number(decodeRecord(project, "evolutions", form.species).raw?.method_0 ?? 0) !== 0;
    if (!rows.length && speciesEvolves) {
      rows.push({ ...NO_EVOLUTION, target: form.species });
      report.noEvolution.push(form.name);
    }
    setPokemonEvolutions(project, personalId, rows);
  }

  await prepareFormEvolutionCodeInjection(project);
  const galar = added.get("REGIONAL_GALAR_DARMANITAN"), galarZen = added.get("REGIONAL_GALAR_DARMANITAN_ZEN");
  if (galar && galarZen) {
    await stageRegionalZenMode(project, galar.form, galarZen.form);
    report.zenMode = true;
  }
  project.codeInjection ??= {};
  const previous = project.codeInjection.regionalForms?.forms.filter((entry) => !report.forms.some((form) => form.key === entry.key)) ?? [];
  project.codeInjection.regionalForms = {
    version: REGIONAL_FORMS_VERSION,
    forms: [...previous, ...report.forms.map((form) => ({ ...form, name: REGIONAL_FORMS.find((entry) => entry.key === form.key)!.name }))],
  };
  const credits = [...new Set(toAdd.flatMap((form) => [form.credits.front, form.credits.back]).filter((credit): credit is string => Boolean(credit)))];
  recordGenericChange(project, "code_injection",
    `Regional forms: ${report.forms.length} forms added (${[...new Set(toAdd.map((form) => pokemonSpeciesLabel(project, form.family)))].join(", ")}). ` +
    `Data from White2Upgrade; sprites by ${credits.join("; ")}.`,
    "Regional Forms", { key: "code-injection:regional-forms" });
  return report;
}

/**
 * Zen Mode for Galarian Darmanitan: retail's Zen Mode switches Darmanitan between forms 0 and 1, and the runtime makes
 * it switch a Galarian Darmanitan between its two Galarian forms (their numbers are written at the DLL's "PWZN" mark).
 */
export async function stageRegionalZenMode(project: ProjectState, galar: number, galarZen: number) {
  const version = project.session.baseVersion;
  if (!(version in ZEN_MODE_URLS)) throw new Error("Galarian Zen Mode supports US Black, White, Black 2 and White 2.");
  const game = version as keyof typeof ZEN_MODE_URLS;
  const manifest = (zenModeManifest.games as Record<string, { fileName: string; configOffset: number }>)[game]!;
  const response = await fetch(ZEN_MODE_URLS[game]);
  if (!response.ok) throw new Error(`Could not load bundled ${manifest.fileName} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const at = manifest.configOffset;
  if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== "PWZN") throw new Error(`${manifest.fileName} has no Zen Mode settings.`);
  bytes[at + 4] = galar;
  bytes[at + 5] = galarZen;
  return stageCodeInjectionDll(project, manifest.fileName, bytes, "patches");
}

/** Fairy Type Support and Move Expansion first (in the live project), then the forms through the staged installer. */
export async function installRegionalForms(
  project: ProjectState,
  install: (stage: (staged: ProjectState) => Promise<RegionalFormsReport>) => Promise<RegionalFormsReport>,
  families?: readonly number[],
): Promise<RegionalFormsReport> {
  const status = getRegionalFormsStatus(project);
  if (!status.ready) throw new Error(status.message);
  if (!hasPwanRuntimeDll(project)) await installPwanRuntime(project);
  const fairyBefore = detectFairyTypePatch(project);
  if (fairyBefore === "unpatched") await addFairyTypeSupport(project, { updateModernFairyTypings: true });
  let moveExpansion: RegionalFormsReport["moveExpansion"] = "present";
  const moveState = detectMoveExpansionPatch(project);
  if (moveState === "unpatched" || moveState === "routing-only") {
    await addMoveExpansion(project);
    moveExpansion = "installed";
  } else if (moveState !== "patched") {
    moveExpansion = "unavailable";
  }
  const report = await install((staged) => stageRegionalForms(staged, families));
  return { ...report, moveExpansion, fairyTypeInstalled: fairyBefore === "unpatched" && detectFairyTypePatch(project) === "patched" };
}
