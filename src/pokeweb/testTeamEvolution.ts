import { pokemonSpeciesLabel, findPokemonPersonalFormOwner } from "./pokemonLabels";
import { evolutionSlotCount } from "./pokemonModel";
import { decodeRecord, type ProjectState } from "./projectStore";

const LEVEL_REQUIREMENT_METHODS = new Set([4, 9, 10, 11, 12, 13, 14, 15, 23, 24]);
const ITEM_REQUIREMENT_METHODS = new Set([6, 8, 17, 18, 19, 20]);

export type EvolutionItem = {
  itemId: number;
  itemName: string;
};

export type TestTeamEvolution = {
  speciesId: number;
  formIndex: number;
  speciesName: string;
};

type EvolutionState = TestTeamEvolution & {
  personalId: number;
};

type EvolutionEdge = {
  method: number;
  param: number;
  targetPersonalId: number;
};

export function evolvePokemonForLevel(
  project: ProjectState,
  speciesId: number,
  formIndex: number,
  level: number,
  obtainedItemIds: ReadonlySet<number> = new Set(),
): TestTeamEvolution {
  return evolvePokemonForLevelTargets(project, speciesId, formIndex, level, obtainedItemIds)[0];
}

export function evolvePokemonForLevelTargets(
  project: ProjectState,
  speciesId: number,
  formIndex: number,
  level: number,
  obtainedItemIds: ReadonlySet<number> = new Set(),
): TestTeamEvolution[] {
  return followEvolutionBranches(project, initialState(project, speciesId, formIndex), (edge) => (
    LEVEL_REQUIREMENT_METHODS.has(edge.method) && edge.param <= level
  ) || (
    ITEM_REQUIREMENT_METHODS.has(edge.method) && obtainedItemIds.has(edge.param)
  ));
}

export function getEvolutionItems(project: ProjectState): EvolutionItem[] {
  const itemIds = new Set<number>();
  const store = project.narcs.evolutions;
  if (!store) return [];
  for (let personalId = 0; personalId < store.rawFiles.length; personalId += 1) {
    if (!store.rawFiles[personalId]) continue;
    try {
      const raw = decodeRecord(project, "evolutions", personalId).raw;
      if (!raw) continue;
      for (let index = 0; index < evolutionSlotCount(project); index += 1) {
        const method = Number(raw[`method_${index}`] ?? 0);
        const itemId = Number(raw[`param_${index}`] ?? 0);
        if (ITEM_REQUIREMENT_METHODS.has(method) && itemId > 0) itemIds.add(itemId);
      }
    } catch {
      // Ignore malformed or non-record archive members.
    }
  }
  return [...itemIds]
    .sort((left, right) => left - right)
    .map((itemId) => ({
      itemId,
      itemName: project.texts.banks.items?.[itemId] || `Item ${itemId}`,
    }));
}

export function forceFinalPokemonEvolution(
  project: ProjectState,
  speciesId: number,
  formIndex: number,
): TestTeamEvolution {
  return forceFinalPokemonEvolutions(project, speciesId, formIndex)[0];
}

export function forceFinalPokemonEvolutions(
  project: ProjectState,
  speciesId: number,
  formIndex: number,
): TestTeamEvolution[] {
  return followEvolutionBranches(project, initialState(project, speciesId, formIndex), () => true);
}

export function replaceShowdownPokemonSpecies(
  showdownText: string,
  speciesName: string,
  formIndex: number,
): string {
  const lines = showdownText.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.length === 0) return showdownText;
  const species = formIndex > 0 ? `${speciesName}^${formIndex}` : speciesName;
  const header = lines[0];
  const itemIndex = header.lastIndexOf("@");
  const itemSuffix = itemIndex >= 0 ? ` ${header.slice(itemIndex).trim()}` : "";
  const beforeItem = (itemIndex >= 0 ? header.slice(0, itemIndex) : header).trim();
  const genderMatch = /\s+\((M|F)\)\s*$/iu.exec(beforeItem);
  const genderSuffix = genderMatch ? ` (${genderMatch[1].toUpperCase()})` : "";
  const namePart = (genderMatch ? beforeItem.slice(0, genderMatch.index) : beforeItem).trim();
  const namedSpecies = /\(([^()]*)\)\s*$/u.exec(namePart);
  const evolvedNamePart = namedSpecies
    ? `${namePart.slice(0, namedSpecies.index).trimEnd()} (${species})`
    : species;
  lines[0] = `${evolvedNamePart}${genderSuffix}${itemSuffix}`;
  return lines.join("\n");
}

function followEvolutionBranches(
  project: ProjectState,
  initial: EvolutionState,
  eligible: (edge: EvolutionEdge) => boolean,
): TestTeamEvolution[] {
  const terminalStates = collectEvolutionBranches(project, initial, eligible, new Set());
  const unique = new Map<number, EvolutionState>();
  terminalStates.forEach((state) => unique.set(state.personalId, state));
  return [...unique.values()].map((state) => ({
    speciesId: state.speciesId,
    formIndex: state.formIndex,
    speciesName: state.speciesName,
  }));
}

function collectEvolutionBranches(
  project: ProjectState,
  current: EvolutionState,
  eligible: (edge: EvolutionEdge) => boolean,
  visited: ReadonlySet<number>,
): EvolutionState[] {
  if (visited.has(current.personalId)) return [current];
  const nextVisited = new Set(visited).add(current.personalId);
  const edges = evolutionEdges(project, current.personalId)
    .filter(eligible)
    .filter((edge) => !nextVisited.has(edge.targetPersonalId));
  if (edges.length === 0) return [current];
  return edges.flatMap((edge) => collectEvolutionBranches(
    project,
    stateForPersonalId(project, edge.targetPersonalId),
    eligible,
    nextVisited,
  ));
}

function evolutionEdges(project: ProjectState, personalId: number): EvolutionEdge[] {
  if (!project.narcs.evolutions?.rawFiles[personalId]) return [];
  try {
    const raw = decodeRecord(project, "evolutions", personalId).raw;
    if (!raw) return [];
    const edges: EvolutionEdge[] = [];
    for (let index = 0; index < evolutionSlotCount(project); index += 1) {
      const method = Number(raw[`method_${index}`] ?? 0);
      const targetPersonalId = Number(raw[`target_${index}`] ?? 0);
      if (method <= 0 || targetPersonalId <= 0 || !project.narcs.personal?.rawFiles[targetPersonalId]) continue;
      edges.push({ method, param: Number(raw[`param_${index}`] ?? 0), targetPersonalId });
    }
    return edges;
  } catch {
    return [];
  }
}

function initialState(project: ProjectState, speciesId: number, formIndex: number): EvolutionState {
  const personalId = personalIdForForm(project, speciesId, formIndex);
  return {
    personalId,
    speciesId,
    formIndex,
    speciesName: pokemonSpeciesLabel(project, speciesId),
  };
}

function stateForPersonalId(project: ProjectState, personalId: number): EvolutionState {
  const owner = findPokemonPersonalFormOwner(project, personalId);
  const speciesId = owner?.speciesId ?? personalId;
  const formIndex = owner?.formIndex ?? 0;
  return {
    personalId,
    speciesId,
    formIndex,
    speciesName: pokemonSpeciesLabel(project, speciesId),
  };
}

function personalIdForForm(project: ProjectState, speciesId: number, formIndex: number): number {
  if (formIndex <= 0 || !project.narcs.personal?.rawFiles[speciesId]) return speciesId;
  try {
    const raw = decodeRecord(project, "personal", speciesId).raw;
    const firstFormId = Number(raw?.form_id ?? 0);
    const formCount = Math.max(1, Number(raw?.num_forms ?? 1));
    if (firstFormId > 0 && formIndex < formCount) return firstFormId + formIndex - 1;
  } catch {
    // Fall back to the base species evolution record.
  }
  return speciesId;
}
