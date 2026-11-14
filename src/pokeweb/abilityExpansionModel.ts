import descriptionsJson from "../assets/data/abilityLibraryDescriptions.json";
import { recordGenericChange } from "./actionChangelog";
import { createCustomAbilities, supportsAbilityEditor } from "./abilityEffectsModel";
import { ABILITY_IMPORT_LIBRARY, type AbilityImport } from "./abilityLibrary";
import { canUseAiFeatures } from "./aiFeatureAccess";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "./projectStore";

/**
 * Ability Expansion: adds the ability library's Gen 6-9 (and Legends Z-A) abilities the user picks as new abilities
 * (name, description and the library's effect rules, in one ability runtime build), at the free IDs after the
 * ROM's last ability (165-255). An ability whose name the ROM already has counts as installed.
 */
const DESCRIPTIONS = descriptionsJson as Record<string, string>;
const LAST_ABILITY_ID = 255;

export type AbilityExpansionRow = {
  id: number;
  name: string; // the in-game name the ability is added with
  label: string;
  generation: AbilityImport["generation"];
  group?: string;
  description: string;
  installedAs?: number; // the ROM's ability ID with this name
};

export type AbilityExpansionStatus = {
  supported: boolean;
  ready: boolean;
  installed: number;
  freeSlots: number;
  message: string;
};

export type AbilityExpansionReport = { added: Array<{ name: string; id: number }>; skipped: string[] };

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/gu, "");

/** The card is experimental: shown only locally or once unlocked (aiFeatureAccess.ts). */
export function canUseAbilityExpansionInstaller(hostname?: string): boolean {
  return canUseAiFeatures(hostname);
}

export function abilityLibraryDescription(id: number): string {
  return DESCRIPTIONS[String(id)] ?? "";
}

function romAbilityIds(project: ProjectState): Map<string, number> {
  const ids = new Map<string, number>();
  (project.texts.banks.abilities ?? []).forEach((name, id) => {
    if (id > 0 && id <= LAST_ABILITY_ID && name?.trim() && !ids.has(normalize(name))) ids.set(normalize(name), id);
  });
  return ids;
}

/** Every library ability, in the library's order (generation, then name), with the ROM's ID when it has it. */
export function abilityExpansionRows(project: ProjectState): AbilityExpansionRow[] {
  const rom = romAbilityIds(project);
  return ABILITY_IMPORT_LIBRARY.map((entry) => ({
    id: entry.id,
    name: entry.defaultName,
    label: entry.label,
    generation: entry.generation,
    group: entry.group,
    description: abilityLibraryDescription(entry.id),
    installedAs: rom.get(normalize(entry.defaultName)) ?? rom.get(normalize(entry.label)),
  }));
}

/** Free ability IDs: new abilities go after the ROM's last named one. */
export function freeAbilitySlots(project: ProjectState): number {
  const names = project.texts.banks.abilities ?? [];
  let last = 164;
  for (let id = 1; id <= LAST_ABILITY_ID; id++) if (names[id]?.trim()) last = id;
  return LAST_ABILITY_ID - last;
}

export function getAbilityExpansionStatus(project: ProjectState): AbilityExpansionStatus {
  const supported = supportsAbilityEditor(project) && !!project.texts.banks.abilities?.length;
  const installed = supported ? abilityExpansionRows(project).filter((row) => row.installedAs !== undefined).length : 0;
  const freeSlots = supported ? freeAbilitySlots(project) : 0;
  const message = !supported ? "Ability Expansion needs a Black, White, Black 2 or White 2 ROM."
    : !freeSlots ? "All 255 ability IDs are in use." : "";
  return { supported, ready: supported && freeSlots > 0, installed, freeSlots, message };
}

/** Adds the chosen library abilities (by library ID) the ROM doesn't have yet. */
export async function stageAbilityExpansion(project: ProjectState, ids: readonly number[]): Promise<AbilityExpansionReport> {
  const status = getAbilityExpansionStatus(project);
  if (!status.supported) throw new Error(status.message);
  // The descriptions live in a message bank.
  if (!project.narcs.message_texts) {
    if (!project.originalRomBytes) throw new Error("Reload the ROM before installing abilities.");
    loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }), ["message_texts"]);
  }
  const chosen = new Set(ids);
  const rows = abilityExpansionRows(project).filter((row) => chosen.has(row.id));
  if (!rows.length) throw new Error("Choose at least one ability.");
  const report: AbilityExpansionReport = { added: [], skipped: [] };
  const toAdd = rows.filter((row) => {
    if (row.installedAs === undefined) return true;
    report.skipped.push(`${row.name} (already ability ${row.installedAs})`);
    return false;
  });
  if (!toAdd.length) return report;
  if (toAdd.length > status.freeSlots) {
    throw new Error(`${toAdd.length} abilities chosen, but only ${status.freeSlots} ability IDs are free (up to ${LAST_ABILITY_ID}).`);
  }
  const library = new Map(ABILITY_IMPORT_LIBRARY.map((entry) => [entry.id, entry]));
  const created = await createCustomAbilities(project, toAdd.map((row) => ({
    name: row.name, rules: structuredClone(library.get(row.id)!.rule), description: row.description || undefined,
  })));
  toAdd.forEach((row, index) => report.added.push({ name: row.name, id: created[index]! }));
  recordGenericChange(project, "code_injection",
    `Ability Expansion: ${report.added.map((ability) => `${ability.name} (${ability.id})`).join(", ")}.`,
    "Ability Expansion", { key: `code-injection:ability-expansion:${report.added.map((ability) => ability.id).join(",")}` });
  return report;
}
