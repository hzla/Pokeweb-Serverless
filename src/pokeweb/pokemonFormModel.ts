import { recordGenericChange } from "./actionChangelog";
import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS, isGen4Project, type NarcName } from "./constants";
import { findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "./pokemonLabels";
import {
  evolutionSlotCount,
  getPokemonPersonalIds,
  isPokemonPersonalRecord,
  updatePokemonField,
  usesWhite2UpgradePokemonData,
} from "./pokemonModel";
import {
  ensurePokemonIconPaletteAssignmentCapacity,
  getPokemonIconPaletteAssignment,
  getPokemonSpriteEntry,
  resolvePokemonSpriteId,
  setPokemonIconPaletteAssignment,
} from "./pokemonSpriteModel";
import { materializeProjectEdits } from "./projectMaterialize";
import { decodeRecord, markDirty, type NarcStore, type ProjectState } from "./projectStore";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

const SPRITE_FILES_PER_ENTRY = 20;
const MAX_FORM_COUNT = 31;
const BW_ALT_FORM_SPRITE_START = 652;
const BW2_ALT_FORM_SPRITE_START = 685;
const W2U_ALT_FORM_SPRITE_START = 724;
const BW2_FIRST_APPENDED_FORM_PERSONAL_ID = 710;

type FileSnapshot = Uint8Array;
type IconPair = { male: Uint8Array; female: Uint8Array };
type IconPalettePair = { male: number; female: number };

export type AddPokemonFormResult = {
  speciesId: number;
  formIndex: number;
  personalId: number;
  spriteId: number;
  relocatedForms: number;
  paddedLearnsetEntries: number;
  paddedEvolutionEntries: number;
};

export function canAddPokemonForm(project: ProjectState): boolean {
  return (
    !isGen4Project(project) &&
    Boolean(project.narcs.personal) &&
    Boolean(project.narcs.learnsets) &&
    Boolean(project.narcs.evolutions) &&
    Boolean(project.narcs.pokemon_sprites) &&
    Boolean(project.narcs.pokemon_icons) &&
    Boolean(project.narcs.message_texts)
  );
}

export function addPokemonForm(project: ProjectState, requestedSpeciesId: number): AddPokemonFormResult {
  if (isGen4Project(project)) throw new Error("Add Form currently supports Black/White and Black 2/White 2 ROMs only.");
  const personal = requiredStore(project, "personal");
  const learnsets = requiredStore(project, "learnsets");
  const evolutions = requiredStore(project, "evolutions");
  const sprites = requiredStore(project, "pokemon_sprites");
  const icons = requiredStore(project, "pokemon_icons");
  requiredStore(project, "message_texts");

  const owner = findPokemonPersonalFormOwner(project, requestedSpeciesId);
  const speciesId = owner?.speciesId ?? requestedSpeciesId;
  if (!isPokemonPersonalRecord(project, speciesId)) throw new Error(`Pokemon ${requestedSpeciesId} does not have a personal record.`);

  const baseRecord = decodeRecord(project, "personal", speciesId);
  if (!baseRecord.raw) throw new Error(`Unable to read Pokemon ${speciesId}.`);
  const oldFormCount = Math.max(1, Number(baseRecord.raw.num_forms ?? 1));
  const oldAltFormCount = oldFormCount - 1;
  const newFormCount = oldFormCount + 1;
  if (newFormCount > MAX_FORM_COUNT) throw new Error(`The Gen 5 form system cannot store more than ${MAX_FORM_COUNT} forms.`);

  const oldFirstPersonalId = Number(baseRecord.raw.form_id ?? 0);
  const oldFormPersonalIds = Array.from({ length: oldAltFormCount }, (_unused, index) =>
    oldFirstPersonalId > 0 ? oldFirstPersonalId + index : speciesId,
  );
  const oldFormSpriteIds = Array.from({ length: oldAltFormCount }, (_unused, index) => resolvePokemonSpriteId(project, speciesId, index + 1));
  const sourceSpriteIds = [...oldFormSpriteIds, resolvePokemonSpriteId(project, speciesId, 0)];

  for (const personalId of oldFormPersonalIds) {
    if (!isPokemonPersonalRecord(project, personalId)) throw new Error(`Existing form personal record ${personalId} is missing.`);
    if (!learnsets.rawFiles[personalId]) throw new Error(`Existing form learnset ${personalId} is missing.`);
    if (!evolutions.rawFiles[personalId]) throw new Error(`Existing form evolution record ${personalId} is missing.`);
  }
  if (!learnsets.rawFiles[speciesId]) throw new Error(`Base learnset ${speciesId} is missing.`);
  if (!evolutions.rawFiles[speciesId]) throw new Error(`Base evolution record ${speciesId} is missing.`);
  const pokemonNameBankId = requirePokemonNameBankId(project);
  const pokemonNameBank = getTextBank(project, "message_texts", pokemonNameBankId);
  if (!pokemonNameBank.some((entry) => parseTextEntryId(entry[0]).entry === speciesId)) {
    throw new Error(`Base Pokemon name ${speciesId} is missing from message bank ${pokemonNameBankId}.`);
  }

  const personalStartId = personal.rawFiles.length;
  const newPersonalId = personalStartId + oldAltFormCount;
  if (newPersonalId > 0xffff) throw new Error("The next personal record does not fit in the form data field.");
  if (learnsets.rawFiles.length > personalStartId || evolutions.rawFiles.length > personalStartId) {
    throw new Error(`Learnset/evolution archives extend beyond the next personal file ${personalStartId}.`);
  }

  const spritePaddingCount = (SPRITE_FILES_PER_ENTRY - (sprites.rawFiles.length % SPRITE_FILES_PER_ENTRY)) % SPRITE_FILES_PER_ENTRY;
  const spriteStartId = (sprites.rawFiles.length + spritePaddingCount) / SPRITE_FILES_PER_ENTRY;
  const lastSpriteId = spriteStartId + oldAltFormCount;
  const expandedPokemonData = usesWhite2UpgradePokemonData(project);

  const formSpriteStart = expandedPokemonData
    ? W2U_ALT_FORM_SPRITE_START
    : project.session.baseRom === "BW2"
      ? BW2_ALT_FORM_SPRITE_START
      : BW_ALT_FORM_SPRITE_START;
  const formSpriteOffset = spriteStartId - formSpriteStart;
  if (!Number.isInteger(formSpriteOffset) || formSpriteOffset < 0 || formSpriteOffset > 0xffff) {
    throw new Error(`Sprite ${spriteStartId} cannot be represented by this ROM's form sprite offset.`);
  }

  const spriteCopies = sourceSpriteIds.map((spriteId) =>
    getPokemonSpriteEntry(project, spriteId).files.map((file) => file.slice()),
  );
  const iconHeaderCount = project.session.baseRom === "BW2" ? 8 : 7;
  const baseIconPair = snapshotIconPair(icons, iconHeaderCount, speciesId);
  if (!baseIconPair.male.length) throw new Error(`Base icon ${speciesId} is missing.`);
  const iconCopies = sourceSpriteIds.map((spriteId, index) =>
    index === sourceSpriteIds.length - 1 ? cloneIconPair(baseIconPair) : snapshotIconPair(icons, iconHeaderCount, spriteId, baseIconPair),
  );
  const paletteCopies = sourceSpriteIds.map((spriteId) => snapshotIconPalettePair(project, spriteId));

  // Serialize any pending field edits before taking byte-for-byte copies.
  // All structural and engine-limit validation above happens before mutation.
  materializeProjectEdits(project);
  ensurePokemonIconPaletteAssignmentCapacity(project, lastSpriteId);

  const relocatedPersonal = oldFormPersonalIds.map((id) => personal.rawFiles[id].slice());
  const relocatedLearnsets = oldFormPersonalIds.map((id) => learnsets.rawFiles[id].slice());
  const relocatedEvolutions = oldFormPersonalIds.map((id) => evolutions.rawFiles[id].slice());
  const basePersonal = personal.rawFiles[speciesId].slice();
  const baseLearnset = learnsets.rawFiles[speciesId].slice();

  const personalCopies = [...relocatedPersonal, basePersonal];
  const learnsetCopies = [...relocatedLearnsets, baseLearnset];
  const evolutionCopies = [...relocatedEvolutions, emptyEvolutionRecord(project, evolutions, speciesId)];

  personalCopies.forEach((bytes) => appendFile(project, personal, "personal", bytes));
  const paddedLearnsetEntries = padStoreToIndex(project, learnsets, "learnsets", personalStartId, emptyLearnsetRecord);
  learnsetCopies.forEach((bytes) => appendFile(project, learnsets, "learnsets", bytes));
  const paddedEvolutionEntries = padStoreToIndex(project, evolutions, "evolutions", personalStartId, () =>
    emptyEvolutionRecord(project, evolutions, speciesId),
  );
  evolutionCopies.forEach((bytes) => appendFile(project, evolutions, "evolutions", bytes));
  appendPokemonFormNames(project, pokemonNameBankId, speciesId, personalStartId, personalCopies.length);

  for (let id = personalStartId; id < personalStartId + personalCopies.length; id += 1) clearNestedFormMetadata(project, id);

  for (let index = 0; index < spritePaddingCount; index += 1) appendFile(project, sprites, "pokemon_sprites", new Uint8Array());
  spriteCopies.flat().forEach((bytes) => appendFile(project, sprites, "pokemon_sprites", bytes));

  iconCopies.forEach((pair, index) => {
    const targetSpriteId = spriteStartId + index;
    const targetMaleIndex = iconHeaderCount + targetSpriteId * 2;
    while (icons.rawFiles.length < targetMaleIndex) appendFile(project, icons, "pokemon_icons", new Uint8Array());
    setStoreFile(project, icons, "pokemon_icons", targetMaleIndex, pair.male);
    setStoreFile(project, icons, "pokemon_icons", targetMaleIndex + 1, pair.female);
  });

  paletteCopies.forEach((pair, index) => {
    const targetSpriteId = spriteStartId + index;
    setPokemonIconPaletteAssignment(project, targetSpriteId, "male", pair.male);
    setPokemonIconPaletteAssignment(project, targetSpriteId, "female", pair.female);
  });

  updatePokemonField(project, speciesId, "personal", "form_id", String(personalStartId));
  updatePokemonField(project, speciesId, "personal", "form", String(formSpriteOffset));
  updatePokemonField(project, speciesId, "personal", "num_forms", String(newFormCount));

  const subject = pokemonSpeciesLabel(project, speciesId);
  recordGenericChange(
    project,
    "personal",
    `Form ${oldFormCount} was added as personal file ${newPersonalId}; its base learnset and empty evolution record were generated.`,
    subject,
    { key: `pokemon-add-form:${speciesId}:${newPersonalId}` },
  );
  recordGenericChange(project, "pokemon_sprites", `Form ${oldFormCount} graphics were copied to sprite ${lastSpriteId}.`, subject, {
    key: `pokemon-add-form-sprite:${speciesId}:${lastSpriteId}`,
  });
  recordGenericChange(project, "pokemon_icons", `Form ${oldFormCount} icon was copied to sprite ${lastSpriteId}.`, subject, {
    key: `pokemon-add-form-icon:${speciesId}:${lastSpriteId}`,
  });

  return {
    speciesId,
    formIndex: oldFormCount,
    personalId: newPersonalId,
    spriteId: lastSpriteId,
    relocatedForms: oldAltFormCount,
    paddedLearnsetEntries,
    paddedEvolutionEntries,
  };
}

function requirePokemonNameBankId(project: ProjectState): number {
  const mappings = project.session.baseRom === "BW2" ? BW2_MESSAGE_BANKS : BW_MESSAGE_BANKS;
  const mapping = mappings.find(([, name]) => name === "pokedex");
  if (!mapping || typeof mapping[0] !== "number") throw new Error("The Pokemon name message bank is not available for this ROM.");
  return mapping[0];
}

function appendPokemonFormNames(project: ProjectState, bankId: number, speciesId: number, firstPersonalId: number, count: number): void {
  const bank = getTextBank(project, "message_texts", bankId);
  const parsed = bank.map((entry) => ({ entry, id: parseTextEntryId(entry[0]) }));
  const numEntries = Math.max(0, ...parsed.map(({ id }) => id.entry + 1));
  const requiredEntries = firstPersonalId + count;
  if (numEntries < requiredEntries) addTextEntries(project, "message_texts", bankId, requiredEntries - numEntries);

  const expanded = getTextBank(project, "message_texts", bankId);
  const sourceByBlock = new Map(
    expanded
      .map((entry) => ({ entry, id: parseTextEntryId(entry[0]) }))
      .filter(({ id }) => id.entry === speciesId)
      .map(({ entry, id }) => [id.block, entry[1]] as const),
  );
  for (const entry of expanded) {
    const id = parseTextEntryId(entry[0]);
    if (id.entry < firstPersonalId || id.entry >= requiredEntries) continue;
    entry[1] = sourceByBlock.get(id.block) ?? sourceByBlock.get(0) ?? "";
  }
  commitTextBank(project, "message_texts", bankId);
  recordGenericChange(project, "message_texts", `Copied the base Pokemon name to personal entries ${firstPersonalId}-${requiredEntries - 1}.`, `Text Bank ${bankId}`, {
    key: `pokemon-form-names:${firstPersonalId}:${requiredEntries - 1}`,
  });
}

export function repairAppendedPokemonFormNames(project: ProjectState): boolean {
  if (project.session.baseRom !== "BW2" || !project.narcs.personal || !project.narcs.message_texts) return false;
  const forms = getPokemonPersonalIds(project)
    .filter((personalId) => personalId >= BW2_FIRST_APPENDED_FORM_PERSONAL_ID)
    .map((personalId) => ({ personalId, owner: findPokemonPersonalFormOwner(project, personalId) }))
    .filter((form): form is { personalId: number; owner: NonNullable<typeof form.owner> } => Boolean(form.owner));
  if (forms.length === 0) return false;

  const bankId = requirePokemonNameBankId(project);
  const bank = getTextBank(project, "message_texts", bankId);
  const numEntries = Math.max(0, ...bank.map((entry) => parseTextEntryId(entry[0]).entry + 1));
  const requiredEntries = Math.max(...forms.map(({ personalId }) => personalId + 1));
  let changed = false;
  if (numEntries < requiredEntries) {
    addTextEntries(project, "message_texts", bankId, requiredEntries - numEntries);
    changed = true;
  }

  const expanded = getTextBank(project, "message_texts", bankId);
  const entriesByKey = new Map(expanded.map((entry) => {
    const id = parseTextEntryId(entry[0]);
    return [`${id.block}:${id.entry}`, entry] as const;
  }));
  for (const { personalId, owner } of forms) {
    for (const target of expanded.filter((entry) => parseTextEntryId(entry[0]).entry === personalId)) {
      const targetId = parseTextEntryId(target[0]);
      const source = entriesByKey.get(`${targetId.block}:${owner.speciesId}`) ?? entriesByKey.get(`0:${owner.speciesId}`);
      if (!source || target[1] === source[1]) continue;
      target[1] = source[1];
      changed = true;
    }
  }
  if (!changed) return false;
  commitTextBank(project, "message_texts", bankId);
  recordGenericChange(project, "message_texts", "Repaired names for appended Pokemon form entries.", `Text Bank ${bankId}`, {
    key: "pokemon-form-names:repair",
  });
  return true;
}

function requiredStore(project: ProjectState, name: NarcName): NarcStore {
  const store = project.narcs[name];
  if (!store) throw new Error(`${name} must be loaded before adding a form.`);
  return store;
}

function snapshotIconPair(store: NarcStore, headerCount: number, spriteId: number, fallback?: IconPair): IconPair {
  const start = headerCount + spriteId * 2;
  const male = store.rawFiles[start];
  const female = store.rawFiles[start + 1];
  if (!male && fallback) return cloneIconPair(fallback);
  if (!male) return { male: new Uint8Array(), female: new Uint8Array() };
  return { male: male.slice(), female: female?.slice() ?? new Uint8Array() };
}

function cloneIconPair(pair: IconPair): IconPair {
  return { male: pair.male.slice(), female: pair.female.slice() };
}

function snapshotIconPalettePair(project: ProjectState, sourceSpriteId: number): IconPalettePair {
  const male = getPokemonIconPaletteAssignment(project, sourceSpriteId, "male");
  const female = getPokemonIconPaletteAssignment(project, sourceSpriteId, "female");
  if (!male.editable || !female.editable) throw new Error(`Icon palette assignment for sprite ${sourceSpriteId} is not available.`);
  return { male: male.paletteId, female: female.paletteId };
}

function appendFile(project: ProjectState, store: NarcStore, name: NarcName, source: FileSnapshot | (() => FileSnapshot)): number {
  const id = store.rawFiles.length;
  const bytes = typeof source === "function" ? source() : source.slice();
  store.rawFiles.push(bytes);
  store.fileCount = store.rawFiles.length;
  store.records.delete(id);
  markDirty(project, name, id);
  return id;
}

function setStoreFile(project: ProjectState, store: NarcStore, name: NarcName, id: number, source: Uint8Array): void {
  store.rawFiles[id] = source.slice();
  store.fileCount = Math.max(store.fileCount, id + 1);
  store.records.delete(id);
  markDirty(project, name, id);
}

function padStoreToIndex(
  project: ProjectState,
  store: NarcStore,
  name: NarcName,
  targetIndex: number,
  makeFiller: () => Uint8Array,
): number {
  let count = 0;
  while (store.rawFiles.length < targetIndex) {
    appendFile(project, store, name, makeFiller);
    count += 1;
  }
  if (store.rawFiles.length > targetIndex) {
    throw new Error(`${name} already extends beyond the new personal block at ${targetIndex}.`);
  }
  return count;
}

function emptyLearnsetRecord(): Uint8Array {
  return Uint8Array.of(0xff, 0xff, 0xff, 0xff);
}

function emptyEvolutionRecord(project: ProjectState, store: NarcStore, speciesId: number): Uint8Array {
  const sourceLength = store.rawFiles[speciesId]?.length ?? 0;
  const expectedLength = evolutionSlotCount(project) * 6;
  return new Uint8Array(Math.max(sourceLength, expectedLength));
}

function clearNestedFormMetadata(project: ProjectState, personalId: number): void {
  const record = decodeRecord(project, "personal", personalId);
  if (!record.raw || !record.readable) throw new Error(`Unable to initialize form personal record ${personalId}.`);
  record.raw.form_id = 0;
  record.raw.form = 0;
  record.raw.num_forms = 1;
  record.readable.form_id = 0;
  record.readable.form = 0;
  record.readable.num_forms = 1;
  markDirty(project, "personal", personalId);
}
