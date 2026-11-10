import { canUseMegaEvolutionInstaller, isMegaEvolutionInstalled, MEGA_ROUTE_CAPACITY, setMegaEvolutionConfig, type MegaRoute } from "./megaEvolutionModel";
import { BW2_MESSAGE_BANKS } from "./constants";
import { findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "./pokemonLabels";
import { decodeRecord, type ProjectState } from "./projectStore";
import { commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

/**
 * The Pokémon editor's Mega Evolution section (Evolutions tab): the Mega routes of one Pokémon form, kept in the Mega
 * runtime's route table (`project.codeInjection.megaEvolution.routes`), not in the evolution NARC.
 */

export type MegaEditorRoute = { index: number; route: MegaRoute; problem?: string };
export type MegaFormOption = { form: number; personalId: number; label: string };
export type MegaEditorState = {
  /** Black 2 / White 2 on localhost, like the Code Injection card. */
  available: boolean;
  installed: boolean;
  species: number;
  form: number;
  forms: MegaFormOption[];
  /** Routes from this form. */
  routes: MegaEditorRoute[];
  /** Routes into this form (it is a Mega form). */
  reachedBy: MegaEditorRoute[];
  capacityLeft: number;
};

/** Items below this ID are retail items, which keep their own battle effect when used as a Mega trigger. */
export const FIRST_MEGA_STONE_ID = 657;

export function megaEditorAvailable(project: ProjectState, hostname?: string): boolean {
  return project.session.baseRom === "BW2" && project.session.generation !== "gen4" && canUseMegaEvolutionInstaller(hostname);
}

/** The species and form index of a personal record (form 0 for a base species). */
export function megaFormOwner(project: ProjectState, personalId: number): { species: number; form: number } {
  const owner = findPokemonPersonalFormOwner(project, personalId);
  return owner ? { species: owner.speciesId, form: owner.formIndex } : { species: personalId, form: 0 };
}

export function megaFormOptions(project: ProjectState, species: number): MegaFormOption[] {
  const raw = decodeRecord(project, "personal", species).raw ?? {};
  const count = Math.max(1, Number(raw.num_forms ?? 1));
  const firstFormId = Number(raw.form_id ?? 0);
  // The Mega Pokémon package's own names, for forms it installed before it named them in the name bank.
  const packaged = new Map((project.codeInjection?.megaEvolution?.content?.forms ?? []).filter((form) => form.species === species).map((form) => [form.form, form.name]));
  const options: MegaFormOption[] = [{ form: 0, personalId: species, label: pokemonSpeciesLabel(project, species) }];
  for (let form = 1; form < count; form++) {
    const personalId = firstFormId > 0 ? firstFormId + form - 1 : species;
    const label = firstFormId > 0 ? pokemonSpeciesLabel(project, personalId) : `Form ${form}`;
    options.push({ form, personalId, label: /\bForm \d+$/u.test(label) && packaged.has(form) ? packaged.get(form)! : label });
  }
  return options;
}

/** "Mega Charizard X" for Charizard → "Mega-X"; "Mega Venusaur" → "Mega". */
export function megaFormSuffix(formName: string, baseName: string): string {
  const rest = formName.replace(baseName, " ").replace(/\s+/gu, " ").trim();
  return (rest || "Mega").replace(/ /gu, "-");
}

/**
 * Names an added form "<Base>-<suffix>" at its personal index in the Pokémon name bank. The game reads names by
 * species, so these entries only label the form in Pokeweb (the Pokémon list, pickers, this section).
 */
export function nameMegaForm(project: ProjectState, personalId: number, suffix: string): void {
  const owner = findPokemonPersonalFormOwner(project, personalId);
  const bankId = BW2_MESSAGE_BANKS.find(([, name]) => name === "pokedex")?.[0];
  if (!owner || typeof bankId !== "number" || !project.narcs.message_texts) return;
  const name = `${pokemonSpeciesLabel(project, owner.speciesId)}-${suffix}`;
  const bank = getTextBank(project, "message_texts", bankId);
  let changed = false;
  for (const entry of bank) {
    if (parseTextEntryId(entry[0]).entry !== personalId || entry[1] === name) continue;
    entry[1] = name;
    changed = true;
  }
  if (changed) commitTextBank(project, "message_texts", bankId);
}

/** The next free "-Mega" suffix among a species' form labels ("Mega", then "Mega-2", ...). */
export function nextMegaSuffix(project: ProjectState, species: number): string {
  const labels = new Set(megaFormOptions(project, species).map((option) => option.label.toLowerCase()));
  const base = pokemonSpeciesLabel(project, species).toLowerCase();
  if (!labels.has(`${base}-mega`)) return "Mega";
  let n = 2;
  while (labels.has(`${base}-mega-${n}`)) n++;
  return `Mega-${n}`;
}

export function getMegaEditorState(project: ProjectState, personalId: number, hostname?: string): MegaEditorState {
  const available = megaEditorAvailable(project, hostname);
  if (!available) return { available, installed: false, species: personalId, form: 0, forms: [], routes: [], reachedBy: [], capacityLeft: 0 };
  const { species, form } = megaFormOwner(project, personalId);
  const installed = available && isMegaEvolutionInstalled(project) && Boolean(project.codeInjection?.megaEvolution);
  const routes = project.codeInjection?.megaEvolution?.routes ?? [];
  const forms = installed ? megaFormOptions(project, species) : [];
  const describe = (route: MegaRoute, index: number): MegaEditorRoute => ({
    index, route, problem: route.targetForm >= forms.length ? `Form ${route.targetForm} no longer exists.` : undefined,
  });
  return {
    available,
    installed,
    species,
    form,
    forms,
    routes: installed ? routes.flatMap((route, index) => route.species === species && route.sourceForm === form ? [describe(route, index)] : []) : [],
    reachedBy: installed && form > 0 ? routes.flatMap((route, index) => route.species === species && route.targetForm === form ? [describe(route, index)] : []) : [],
    capacityLeft: MEGA_ROUTE_CAPACITY - routes.length,
  };
}

/** The route table, without routes whose Mega form was deleted since (the runtime can't use them either). */
function currentRoutes(project: ProjectState): MegaRoute[] {
  const config = project.codeInjection?.megaEvolution;
  if (!config) throw new Error("Install Mega Evolution first.");
  return config.routes.filter((route) => {
    try { return route.targetForm < Math.max(1, Number(decodeRecord(project, "personal", route.species).raw?.num_forms ?? 1)); }
    catch { return true; }
  }).map((route) => ({ ...route }));
}

/** Adds a Mega route; returns its index in the route table. */
export function addMegaRoute(project: ProjectState, route: MegaRoute): number {
  const routes = currentRoutes(project);
  routes.push({ ...route, moveTrigger: route.moveTrigger || undefined });
  setMegaEvolutionConfig(project, { routes });
  return routes.length - 1;
}

/** `index` is the route's position in the stored table (as `getMegaEditorState` lists it). */
export function updateMegaRoute(project: ProjectState, index: number, change: Partial<MegaRoute>): void {
  const stored = project.codeInjection?.megaEvolution?.routes[index];
  if (!stored) throw new Error(`Route ${index + 1} does not exist.`);
  const routes = currentRoutes(project);
  const next = { ...stored, ...change, moveTrigger: (change.moveTrigger ?? stored.moveTrigger) || undefined };
  const at = routes.findIndex((route) => sameRoute(route, stored));
  if (at < 0) routes.push(next); else routes[at] = next;
  setMegaEvolutionConfig(project, { routes });
}

export function removeMegaRoute(project: ProjectState, index: number): void {
  const stored = project.codeInjection?.megaEvolution?.routes[index];
  if (!stored) throw new Error(`Route ${index + 1} does not exist.`);
  setMegaEvolutionConfig(project, { routes: currentRoutes(project).filter((route) => !sameRoute(route, stored)) });
}

function sameRoute(a: MegaRoute, b: MegaRoute): boolean {
  return a.species === b.species && a.sourceForm === b.sourceForm && a.targetForm === b.targetForm && a.trigger === b.trigger && Boolean(a.moveTrigger) === Boolean(b.moveTrigger);
}

/** Item or move names for the trigger pickers, without the "???" placeholders of unused expansion slots. */
export function megaTriggerNames(names: readonly string[] | undefined): Array<{ id: number; name: string }> {
  return (names ?? []).flatMap((name, id) => {
    const trimmed = String(name ?? "").trim();
    return id > 0 && trimmed && trimmed !== "???" && trimmed !== "-" ? [{ id, name: trimmed }] : [];
  });
}

/** Reads a picker value: a name (first match, case-insensitive) or an ID. Returns 0 when nothing matches. */
export function resolveMegaTrigger(names: readonly string[] | undefined, value: string): number {
  const text = value.trim();
  if (!text) return 0;
  const options = megaTriggerNames(names);
  const numeric = /^#?(\d+)$/u.exec(text);
  if (numeric) return options.some((option) => option.id === Number(numeric[1])) ? Number(numeric[1]) : 0;
  const lower = text.toLowerCase();
  return options.find((option) => option.name.toLowerCase() === lower)?.id ?? 0;
}
