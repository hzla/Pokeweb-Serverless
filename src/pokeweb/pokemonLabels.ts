import { cascadeWhitePersonalName } from "./cascadeWhiteModel";
import { pokemonFormSpeciesLabel } from "./pokemonFormLabels";
import { decodeRecord, type ProjectState } from "./projectStore";

const FIRST_GEN5_FORM_PERSONAL_ID = 650;

export type PokemonPersonalFormOwner = {
  speciesId: number;
  formIndex: number;
  formSpriteOffset: number;
};

export function pokemonSpeciesLabel(project: ProjectState, speciesId: number): string {
  const cascadeName = cascadeWhitePersonalName(project, speciesId);
  if (cascadeName) return cascadeName;
  const formOwner = findPokemonPersonalFormOwner(project, speciesId);
  if (formOwner) return pokemonFormSpeciesLabel(pokemonBaseSpeciesLabel(project, formOwner.speciesId), formOwner.formIndex);
  return pokemonBaseSpeciesLabel(project, speciesId);
}

export function pokemonSpeciesLabelWithId(project: ProjectState, speciesId: number): string {
  return `${pokemonSpeciesLabel(project, speciesId)} #${speciesId}`;
}

export function pokemonSpeciesNameOptions(project: ProjectState): string[] {
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, project.narcs.personal?.fileCount ?? 0);
  return Array.from({ length: count }, (_unused, speciesId) => pokemonBaseSpeciesLabel(project, speciesId));
}

export function findPokemonSpeciesId(project: ProjectState, inputValue: string, maxId = 2047): number {
  const numeric = Number(inputValue.trim());
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= maxId) return numeric;
  const normalizedInput = normalizeName(inputValue);
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, project.narcs.personal?.fileCount ?? 0);
  for (let speciesId = 0; speciesId < count && speciesId <= maxId; speciesId += 1) {
    if (normalizeName(pokemonBaseSpeciesLabel(project, speciesId)) === normalizedInput) return speciesId;
  }
  throw new Error(`Unknown Pokemon: ${inputValue}`);
}

export function findPokemonPersonalFormOwner(project: ProjectState, speciesId: number): PokemonPersonalFormOwner | undefined {
  const store = project.narcs.personal;
  if (!store || speciesId < 0 || speciesId >= store.fileCount) return undefined;
  if (speciesId < FIRST_GEN5_FORM_PERSONAL_ID) return undefined;
  let rangedMatch: PokemonPersonalFormOwner | undefined;
  for (let ownerId = 1; ownerId < store.fileCount; ownerId += 1) {
    if (ownerId === speciesId) continue;
    const owner = decodeRecord(project, "personal", ownerId);
    const formCount = Math.max(1, Number(owner.raw?.num_forms ?? 1));
    const firstFormId = Number(owner.raw?.form_id ?? 0);
    if (formCount <= 1 || firstFormId <= 0) continue;
    const formIndex = speciesId - firstFormId + 1;
    if (formIndex > 0 && formIndex < formCount) {
      const match = { speciesId: ownerId, formIndex, formSpriteOffset: Number(owner.raw?.form ?? 0) };
      if (firstFormId === speciesId) return match;
      rangedMatch ??= match;
    }
  }
  return rangedMatch;
}

function pokemonBaseSpeciesLabel(project: ProjectState, speciesId: number): string {
  const cascadeName = cascadeWhitePersonalName(project, speciesId);
  if (cascadeName) return cascadeName;
  return project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}
