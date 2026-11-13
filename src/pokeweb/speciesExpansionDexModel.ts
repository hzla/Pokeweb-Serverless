import { decodeDexAreaFile, encodeDexAreaFile } from "./dexAreaModel";
import { markDirty, type NarcStore, type ProjectState } from "./projectStore";
import { getTextBank, parseTextEntryId } from "./textModel";
import { FIRST_ADDED_SPECIES, NATIONAL_OFFSET } from "./speciesExpansionIds";
import type { NarcName } from "./constants";

/**
 * The species expansion's Pokédex data (Black 2 / White 2): what the Pokédex reads by species, for the added species.
 *
 * - Texts: description (bank 442), height (451) and weight (471) are read by "message" (the species, then a form's
 *   index through the form chain, a/0/9/7 member 0), category (464) by species. Retail's form entries are at 650-732,
 *   where the added species are numbered, so they move after the last possible added species (650 -> 1063); the chain
 *   and the shapes, which are by message too, move with them.
 * - a/0/9/7 (the search archive): the form chain (0), each species' initial (1) and shape (2), the national order (3, 4),
 *   alphabetical (5), and tallest, shortest, heaviest and lightest first (6-9: species | form << 11; retail's are
 *   << 10, which can't hold species past 1023: the runtime's overlay 302 patch reads 11 bits).
 * - Footprints (a/1/6/5, species + 5): the cry stand-in's; area maps (a/1/7/6, species - 1): no areas (the Pokédex
 *   Areas editor can sync them from the encounters).
 */
export type DexContent = {
  national: number;
  name: string;
  cry: number;
  personal: { height: number; weight: number };
  dex: { description: string; height: string; weight: string; category: string };
};

const TEXT_BANKS = [442, 451, 471] as const;
const CATEGORY_BANK = 464;
const FIRST_FORM_TEXT = 650;
/** Room for national 650-1025 (species 687-1062), as the form records. */
const LAST_ADDED_SPECIES = 1025 + NATIONAL_OFFSET;
export const FORM_TEXT_SHIFT = LAST_ADDED_SPECIES + 1 - FIRST_FORM_TEXT;
const FOOTPRINT_FIRST = 5;
const SEARCH = { chain: 0, initials: 1, shapes: 2, order: 3, national: 4, alphabetical: 5, tallest: 6, shortest: 7, heaviest: 8, lightest: 9 } as const;
const RETAIL_FORM_SHIFT = 10;
export const FORM_SHIFT_BITS = 11;
const SPECIES_MASK = (1 << FORM_SHIFT_BITS) - 1;

function store(project: ProjectState, name: NarcName): NarcStore {
  const found = project.narcs[name];
  if (!found) throw new Error(`The ${name} archive is not loaded.`);
  return found;
}

function u16s(bytes: Uint8Array): number[] {
  return Array.from({ length: bytes.length >> 1 }, (_, i) => bytes[i * 2]! | bytes[i * 2 + 1]! << 8);
}

function bytesOf(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  values.forEach((value, i) => { out[i * 2] = value & 0xff; out[i * 2 + 1] = value >> 8; });
  return out;
}

function setFile(project: ProjectState, name: NarcName, id: number, bytes: Uint8Array): void {
  const target = store(project, name);
  while (target.rawFiles.length <= id) target.rawFiles.push(new Uint8Array());
  target.rawFiles[id] = bytes;
  target.fileCount = target.rawFiles.length;
  target.records.delete(id);
  target.dirty.add(id);
  markDirty(project, name, id);
}

/** A bank's entries from `from` on move by `by`; the gap is filled with empty entries. */
function shiftTextEntries(project: ProjectState, bankId: number, from: number, by: number): void {
  const bank = getTextBank(project, "message_texts", bankId);
  const blocks = new Set<number>();
  for (const entry of bank) {
    const id = parseTextEntryId(entry[0]);
    blocks.add(id.block);
    if (id.entry >= from) entry[0] = `${id.block}_${id.entry + by}${id.suffix}`;
  }
  for (const block of blocks) for (let entry = from; entry < from + by; entry++) bank.push([`${block}_${entry}`, "", 0]);
  bank.sort((a, b) => {
    const left = parseTextEntryId(a[0]), right = parseTextEntryId(b[0]);
    return left.block - right.block || left.entry - right.entry;
  });
}

/** Sets entries (every block), adding empty ones up to the last. */
function setTextEntries(project: ProjectState, bankId: number, texts: ReadonlyMap<number, string>): void {
  const bank = getTextBank(project, "message_texts", bankId);
  const ids = bank.map((entry) => parseTextEntryId(entry[0]));
  const count = Math.max(0, ...ids.map((id) => id.entry + 1));
  const blocks = new Set(ids.map((id) => id.block));
  for (let entry = count; entry <= Math.max(...texts.keys()); entry++) for (const block of blocks) bank.push([`${block}_${entry}`, "", 0]);
  for (const entry of bank) {
    const text = texts.get(parseTextEntryId(entry[0]).entry);
    if (text !== undefined) entry[1] = text;
  }
  bank.sort((a, b) => {
    const left = parseTextEntryId(a[0]), right = parseTextEntryId(b[0]);
    return left.block - right.block || left.entry - right.entry;
  });
}

/** A message index after the form entries moved. */
function moved(index: number): number {
  return index >= FIRST_FORM_TEXT ? index + FORM_TEXT_SHIFT : index;
}

/** An initial of the search screen: A = 0 ... Z = 25 (retail's file 1). */
function initialOf(name: string): number {
  const letter = name.normalize("NFD").replace(/[^A-Za-z]/gu, "")[0]?.toUpperCase();
  return letter ? letter.charCodeAt(0) - 65 : 0;
}

type Sized = { value: number; height: number; weight: number; name: string };

/** Inserts the added entries into a sorted list after every entry they don't come before. */
function insertSorted(list: Sized[], added: readonly Sized[], before: (a: Sized, b: Sized) => boolean): Sized[] {
  const out = list.slice();
  for (const entry of added) {
    let at = out.length;
    for (let i = 0; i < out.length; i++) if (before(entry, out[i]!)) { at = i; break; }
    out.splice(at, 0, entry);
  }
  return out;
}

/** Installs the Pokédex data of the added species (the text banks are committed by the caller). */
export function stagePokedexData(project: ProjectState, content: readonly DexContent[]): void {
  const species = (entry: DexContent) => entry.national + NATIONAL_OFFSET;

  // Texts by message: retail's forms move past the added species, which take their own number.
  for (const bankId of TEXT_BANKS) shiftTextEntries(project, bankId, FIRST_FORM_TEXT, FORM_TEXT_SHIFT);
  const texts: Record<number, Map<number, string>> = { 442: new Map(), 451: new Map(), 471: new Map(), 464: new Map() };
  for (const entry of content) {
    texts[442].set(species(entry), entry.dex.description);
    texts[451].set(species(entry), entry.dex.height);
    texts[471].set(species(entry), entry.dex.weight);
    texts[464].set(species(entry), entry.dex.category);
  }
  for (const bankId of [...TEXT_BANKS, CATEGORY_BANK]) setTextEntries(project, bankId, texts[bankId]!);

  // The search archive.
  const search = store(project, "pokedex_search");
  const chain = u16s(search.rawFiles[SEARCH.chain]!);
  const nextChain = new Array<number>(FIRST_FORM_TEXT + FORM_TEXT_SHIFT + (chain.length - FIRST_FORM_TEXT)).fill(0);
  chain.forEach((next, index) => { nextChain[moved(index)] = next ? moved(next) : 0; });
  setFile(project, "pokedex_search", SEARCH.chain, bytesOf(nextChain));

  const shapes = Array.from(search.rawFiles[SEARCH.shapes]!);
  const nextShapes = new Array<number>(nextChain.length).fill(0);
  shapes.forEach((shape, index) => { nextShapes[moved(index)] = shape; });
  // No shape data for the added species: the shape of the species whose cry stands in for theirs.
  for (const entry of content) nextShapes[species(entry)] = shapes[entry.cry] ?? 0;
  setFile(project, "pokedex_search", SEARCH.shapes, Uint8Array.from(nextShapes));

  const initials = Array.from(search.rawFiles[SEARCH.initials]!);
  while (initials.length <= LAST_ADDED_SPECIES) initials.push(0);
  for (const entry of content) initials[species(entry)] = initialOf(entry.name);
  setFile(project, "pokedex_search", SEARCH.initials, Uint8Array.from(initials));

  const nationalOrder = [...u16s(search.rawFiles[SEARCH.national]!), ...content.map(species)];
  setFile(project, "pokedex_search", SEARCH.order, bytesOf(nationalOrder));
  setFile(project, "pokedex_search", SEARCH.national, bytesOf(nationalOrder));

  const names = project.texts.banks.pokedex ?? [];
  const personal = store(project, "personal");
  const sized = (value: number, speciesId: number, form: number): Sized => {
    const record = personal.rawFiles[formRecord(project, speciesId, form)] ?? personal.rawFiles[speciesId]!;
    return { value, height: record[0x24]! | record[0x25]! << 8, weight: record[0x26]! | record[0x27]! << 8, name: names[speciesId] ?? "" };
  };
  const added = content.map((entry) => ({ value: species(entry), height: entry.personal.height, weight: entry.personal.weight, name: entry.name }));
  const alphabetical = insertSorted(u16s(search.rawFiles[SEARCH.alphabetical]!).map((value) => sized(value, value, 0)), added,
    (a, b) => a.name.localeCompare(b.name, "en") < 0);
  setFile(project, "pokedex_search", SEARCH.alphabetical, bytesOf(alphabetical.map((entry) => entry.value)));
  const orders: Array<[number, (a: Sized, b: Sized) => boolean]> = [
    [SEARCH.tallest, (a, b) => a.height > b.height], [SEARCH.shortest, (a, b) => a.height < b.height],
    [SEARCH.heaviest, (a, b) => a.weight > b.weight], [SEARCH.lightest, (a, b) => a.weight < b.weight],
  ];
  for (const [file, before] of orders) {
    // Retail's entries hold the form above bit 10; they are re-encoded with the form above bit 11.
    const list = u16s(search.rawFiles[file]!).map((value) => {
      const speciesId = value & ((1 << RETAIL_FORM_SHIFT) - 1), form = value >> RETAIL_FORM_SHIFT;
      return sized(speciesId | form << FORM_SHIFT_BITS, speciesId, form);
    });
    setFile(project, "pokedex_search", file, bytesOf(insertSorted(list, added, before).map((entry) => entry.value)));
  }

  // Footprints: the cry stand-in's.
  const footprints = store(project, "pokemon_footprints");
  for (const entry of content) setFile(project, "pokemon_footprints", species(entry) + FOOTPRINT_FIRST, footprints.rawFiles[entry.cry + FOOTPRINT_FIRST]!.slice());
  for (let id = 0; id < footprints.rawFiles.length; id++) {
    if (!footprints.rawFiles[id]!.length) setFile(project, "pokemon_footprints", id, footprints.rawFiles[1 + FOOTPRINT_FIRST]!.slice());
  }

  // Area maps: none.
  const areas = store(project, "town_map_species_habitats");
  const slots = decodeDexAreaFile(areas.rawFiles[0]!)[0]!.length;
  const none = encodeDexAreaFile([0, 1, 2, 3].map(() => new Array<number>(slots).fill(0)), slots);
  for (let id = areas.rawFiles.length; id < LAST_ADDED_SPECIES; id++) setFile(project, "town_map_species_habitats", id, none.slice());
}

/** The personal record of a species' form (retail's form_id + form - 1), or the species'. */
function formRecord(project: ProjectState, speciesId: number, form: number): number {
  if (form === 0) return speciesId;
  const record = project.narcs.personal!.rawFiles[speciesId]!;
  const first = record[0x1c]! | record[0x1d]! << 8;
  return first ? first + form - 1 : speciesId;
}

/** The species value of a search list entry. */
export function searchEntrySpecies(value: number): number {
  return value & SPECIES_MASK;
}

export { FIRST_ADDED_SPECIES };

// Overlay 302's search filter (ZukanSearchEngine_Step) reads list entries as species | form << 10 and treats a list of
// 649 entries as the national one. With the added species they are 11 bits and the national list is longer:
//   ldr r0, =999 / str r0, [sp, #36] / adds r0, #24 / str r0, [sp, #36]   (the species mask, 1023)
//     -> movs r0, #255 / lsls r0, r0, #3 / adds r0, #7 / str r0, [sp, #36]  (2047)
//   movs r1, #63 / lsls r1, r1, #10 / ands r0, r1 / lsls r0, r0, #6 / lsrs r0, r0, #16   (the form)
//     -> movs r1, #31 / lsls r1, r1, #11 / ands r0, r1 / lsls r0, r0, #5 / lsrs r0, r0, #16
//   and the literal pool's 649 (the national count) and 1023 (the result's mask, after 999 and 742).
const SEARCH_MASK = { retail: [0x09, 0x90, 0x18, 0x30, 0x09, 0x90], patched: [0xff, 0x20, 0xc0, 0x00, 0x07, 0x30, 0x09, 0x90] };
const SEARCH_FORM = { retail: [0x3f, 0x21, 0x89, 0x02, 0x08, 0x40, 0x80, 0x01, 0x00, 0x0c], patched: [0x1f, 0x21, 0xc9, 0x02, 0x08, 0x40, 0x40, 0x01, 0x00, 0x0c] };

function find(code: Uint8Array, pattern: readonly (number | undefined)[], step = 2): number[] {
  const hits: number[] = [];
  for (let at = 0; at + pattern.length <= code.length; at += step) {
    if (pattern.every((value, i) => value === undefined || code[at + i] === value)) hits.push(at);
  }
  return hits;
}

/** Overlay 302 with the search filter reading 11-bit species and `nationalCount` as the national list's length. */
export function patchDexSearchCode(code: Uint8Array, nationalCount: number): Uint8Array {
  const next = code.slice();
  const mask = [...find(code, [undefined, 0x48, ...SEARCH_MASK.retail]), ...find(code, SEARCH_MASK.patched)];
  const form = [...find(code, SEARCH_FORM.retail), ...find(code, SEARCH_FORM.patched)];
  const pool = find(code, [0xe7, 0x03, 0x00, 0x00, undefined, undefined, 0x00, 0x00, 0xe6, 0x02, 0x00, 0x00, undefined, undefined, 0x00, 0x00], 4)
    .filter((at) => [0x3ff, 0x7ff].includes(code[at + 12]! | code[at + 13]! << 8));
  if (mask.length !== 1 || form.length !== 1 || pool.length !== 1) {
    throw new Error(`The Pokédex search's species checks (overlay 302) were not found (${mask.length}, ${form.length}, ${pool.length}).`);
  }
  next.set(SEARCH_MASK.patched, mask[0]!);
  next.set(SEARCH_FORM.patched, form[0]!);
  next.set([nationalCount & 0xff, nationalCount >> 8], pool[0]! + 4);
  next.set([0xff, 0x07], pool[0]! + 12);
  return next;
}
