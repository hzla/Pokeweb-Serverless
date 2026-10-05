import { cascadeWhitePersonalName } from "./cascadeWhiteModel";
import { pokemonFormSpeciesLabel } from "./pokemonFormLabels";
import { getPokemonCount, getPokemonPersonalIds, isPokemonPersonalRecord, isPokemonReferenceId } from "./pokemonModel";
import { decodeRecord, type NarcStore, type ProjectState } from "./projectStore";
import type { FieldSpec } from "./formats";

const FIRST_GEN5_FORM_PERSONAL_ID = 650;

export type PokemonPersonalFormOwner = {
  speciesId: number;
  formIndex: number;
  formSpriteOffset: number;
};

type FormOwnerIndex = {
  revision: number;
  files: Uint8Array[];
  fileCount: number;
  fileLength: number;
  format: FieldSpec[] | undefined;
  owners: Map<number, PokemonPersonalFormOwner>;
};

const formOwnerIndexes = new WeakMap<NarcStore, FormOwnerIndex>();

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
  const personalIds = getPokemonPersonalIds(project);
  const textCount = project.texts.banks.pokedex?.length ?? 0;
  const ids = new Set([...Array.from({ length: textCount }, (_unused, speciesId) => speciesId), ...personalIds]);
  return [...ids].sort((a, b) => a - b).map((speciesId) => pokemonBaseSpeciesLabel(project, speciesId));
}

export function pokemonBaseSpeciesNameOptions(project: ProjectState): string[] {
  const personalIds = getPokemonPersonalIds(project);
  const textCount = project.texts.banks.pokedex?.length ?? 0;
  const ids = new Set([...Array.from({ length: textCount }, (_unused, speciesId) => speciesId), ...personalIds]);
  const names = [...ids]
    .sort((a, b) => a - b)
    .filter((speciesId) => !findPokemonPersonalFormOwner(project, speciesId))
    .map((speciesId) => pokemonBaseSpeciesLabel(project, speciesId));
  return [...new Set(names)];
}

export function pokemonPersonalDisplayIds(project: ProjectState): number[] {
  const ids = getPokemonPersonalIds(project);
  const idSet = new Set(ids);
  const formsByOwner = new Map<number, Array<{ id: number; formIndex: number }>>();
  const baseIds: number[] = [];

  for (const id of ids) {
    const owner = findPokemonPersonalFormOwner(project, id);
    if (!owner || !idSet.has(owner.speciesId)) {
      baseIds.push(id);
      continue;
    }
    const forms = formsByOwner.get(owner.speciesId) ?? [];
    forms.push({ id, formIndex: owner.formIndex });
    formsByOwner.set(owner.speciesId, forms);
  }

  return baseIds.flatMap((id) => [
    id,
    ...(formsByOwner.get(id) ?? [])
      .sort((left, right) => left.formIndex - right.formIndex || left.id - right.id)
      .map((form) => form.id),
  ]);
}

export function findPokemonSpeciesId(project: ProjectState, inputValue: string, maxId = 2047): number {
  const numeric = Number(inputValue.trim());
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= maxId && isPokemonReferenceId(project, numeric)) return numeric;
  const normalizedInput = normalizeName(inputValue);
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, getPokemonCount(project));
  for (let speciesId = 0; speciesId < count && speciesId <= maxId; speciesId += 1) {
    if (!isPokemonReferenceId(project, speciesId)) continue;
    if (normalizeName(pokemonBaseSpeciesLabel(project, speciesId)) === normalizedInput) return speciesId;
  }
  throw new Error(`Unknown Pokemon: ${inputValue}`);
}

export function findPokemonBaseSpeciesId(project: ProjectState, inputValue: string, maxId = 2047): number {
  const speciesId = findPokemonSpeciesId(project, inputValue, maxId);
  const owner = findPokemonPersonalFormOwner(project, speciesId);
  if (!owner) return speciesId;
  throw new Error(
    `${pokemonSpeciesLabel(project, speciesId)} is an alternate-form personal record. ` +
      `Use ${pokemonSpeciesLabel(project, owner.speciesId)} as the species and set Form to ${owner.formIndex}.`,
  );
}

export function findPokemonPersonalFormOwner(project: ProjectState, speciesId: number): PokemonPersonalFormOwner | undefined {
  const store = project.narcs.personal;
  if (!store || speciesId < FIRST_GEN5_FORM_PERSONAL_ID || !isPokemonPersonalRecord(project, speciesId)) return undefined;
  const format = project.formats.personal;
  const cached = formOwnerIndexes.get(store);
  if (cached && cached.revision === (store.revision ?? 0) && cached.files === store.rawFiles &&
      cached.fileCount === store.fileCount && cached.fileLength === store.rawFiles.length && cached.format === format) {
    return cached.owners.get(speciesId);
  }

  // Build once per personal-data revision, including misses. Prefer an exact
  // first-form pointer over an overlapping range, as the original lookup did.
  const count = getPokemonCount(project);
  const owners = new Map<number, PokemonPersonalFormOwner>();
  for (let ownerId = 1; ownerId < count; ownerId += 1) {
    if (!isPokemonPersonalRecord(project, ownerId)) continue;
    const owner = decodeRecord(project, "personal", ownerId);
    const formCount = Math.max(1, Number(owner.raw?.num_forms ?? 1));
    const firstFormId = Number(owner.raw?.form_id ?? 0);
    if (formCount <= 1 || firstFormId <= 0) continue;
    for (let formId = Math.max(FIRST_GEN5_FORM_PERSONAL_ID, firstFormId); formId < Math.min(count, firstFormId + formCount - 1); formId += 1) {
      if (formId === ownerId || !isPokemonPersonalRecord(project, formId)) continue;
      const formIndex = formId - firstFormId + 1;
      const previous = owners.get(formId);
      if (!previous || (formIndex === 1 && previous.formIndex !== 1)) {
        owners.set(formId, { speciesId: ownerId, formIndex, formSpriteOffset: Number(owner.raw?.form ?? 0) });
      }
    }
  }
  formOwnerIndexes.set(store, {
    revision: store.revision ?? 0, files: store.rawFiles, fileCount: store.fileCount,
    fileLength: store.rawFiles.length, format, owners,
  });
  return owners.get(speciesId);
}

function pokemonBaseSpeciesLabel(project: ProjectState, speciesId: number): string {
  const cascadeName = cascadeWhitePersonalName(project, speciesId);
  if (cascadeName) return cascadeName;
  return project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}
