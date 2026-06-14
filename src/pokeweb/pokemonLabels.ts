import { decodeRecord, type ProjectState } from "./projectStore";

const FIRST_GEN5_FORM_PERSONAL_ID = 650;

export type PokemonPersonalFormOwner = {
  speciesId: number;
  formIndex: number;
  formSpriteOffset: number;
};

export function pokemonSpeciesLabel(project: ProjectState, speciesId: number): string {
  const formOwner = findPokemonPersonalFormOwner(project, speciesId);
  if (formOwner) return `${pokemonBaseSpeciesLabel(project, formOwner.speciesId)} Form ${formOwner.formIndex}`;
  return pokemonBaseSpeciesLabel(project, speciesId);
}

export function pokemonSpeciesLabelWithId(project: ProjectState, speciesId: number): string {
  return `${pokemonSpeciesLabel(project, speciesId)} #${speciesId}`;
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
  return project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`;
}
