import { detectSaveFormat, encodeSave, recoverSave, saveLayout } from "./itemSaveFormat";

/**
 * The species expansion's Pokédex save layout (Black 2 / White 2), as the runtime reads it (runtime/species-expansion
 * src/species.c): save block 54 (0x4dc bytes, retail's size). Its lists are bits by national number - 1; retail's lists
 * (0x54 bytes each: caught at 0x08, seen x4 at 0x5c, shown x4 at 0x1ac) hold 1-672; 673-1025 are nine lists of 45
 * bytes (the same order) in the area retail keeps for the other languages' entries (0x328, 0x1b0 bytes), whose last
 * word is the layout's mark ("PWDX"). Without the mark the runtime clears the area first: any retail save works.
 */
const POKEDEX_BLOCK = 54;
const LISTS = 0x08;
const LIST_BYTES = 0x54;
const LIST_BITS = LIST_BYTES * 8;
const EXT = 0x328;
const EXT_SIZE = 0x1b0;
const EXT_LIST_BYTES = 45;
const EXT_MAGIC = 0x58445750;
const FLAGS = 0x04;
export const POKEDEX_CAUGHT = 0;
export const POKEDEX_SEEN = 1; // + kind: male, female, shiny male, shiny female
export const POKEDEX_SHOWN = 5; // + kind

const u32 = (data: Uint8Array, at: number) => (data[at]! | data[at + 1]! << 8 | data[at + 2]! << 16 | data[at + 3]! << 24) >>> 0;
const put32 = (data: Uint8Array, at: number, value: number) => { for (let i = 0; i < 4; i++) data[at + i] = (value >>> (i * 8)) & 0xff; };

/** Clears the extension area (the other languages' bits) and marks it, as the runtime does on first use. */
export function preparePokedexExtension(dex: Uint8Array): void {
  if (u32(dex, EXT + EXT_SIZE - 4) === EXT_MAGIC) return;
  dex.fill(0, EXT, EXT + EXT_SIZE - 4);
  put32(dex, EXT + EXT_SIZE - 4, EXT_MAGIC);
}

function bitOf(dex: Uint8Array, list: number, national: number): { at: number; mask: number } {
  if (national < 1 || national > 1025) throw new Error(`National number ${national} is outside the Pokédex.`);
  let bit = national - 1;
  let base: number;
  if (bit < LIST_BITS) {
    base = LISTS + list * LIST_BYTES;
  } else {
    preparePokedexExtension(dex);
    bit -= LIST_BITS;
    base = EXT + list * EXT_LIST_BYTES;
  }
  return { at: base + (bit >> 3), mask: 1 << (bit & 7) };
}

export function pokedexFlag(dex: Uint8Array, list: number, national: number): boolean {
  const { at, mask } = bitOf(dex, list, national);
  return (dex[at]! & mask) !== 0;
}

export function setPokedexFlag(dex: Uint8Array, list: number, national: number, value = true): void {
  const { at, mask } = bitOf(dex, list, national);
  dex[at] = value ? dex[at]! | mask : dex[at]! & ~mask;
}

/**
 * Registers a species as seen (and caught), as a non-shiny male, or female (`female`; genderless species are male): the
 * kind shown unless one already is.
 */
export function registerPokedexSpecies(dex: Uint8Array, national: number, caught: boolean, female = false): void {
  const kind = female ? 1 : 0;
  setPokedexFlag(dex, POKEDEX_SEEN + kind, national);
  if (![0, 1, 2, 3].some((shown) => pokedexFlag(dex, POKEDEX_SHOWN + shown, national))) setPokedexFlag(dex, POKEDEX_SHOWN + kind, national);
  if (caught) setPokedexFlag(dex, POKEDEX_CAUGHT, national);
}

/** The national Pokédex obtained, and shown (mode 1). */
export function setNationalPokedex(dex: Uint8Array): void {
  const flags = u32(dex, FLAGS);
  put32(dex, FLAGS, (flags & ~(3 << 10)) | 1 | 1 << 10);
}

function layoutOf(raw: Uint8Array) {
  const format = detectSaveFormat(raw, "BW2");
  if (format !== "retail" && format !== "expanded") throw new Error(`Not a Black 2 / White 2 save (${format}).`);
  return saveLayout("BW2", format); // the Pokédex block is the same in the item expansion's layout
}

/**
 * Edits a Black 2 / White 2 save's Pokédex block (a raw 512 KiB save, retail's or the item expansion's layout; anything
 * after it, a DeSmuME footer, is kept).
 */
export function editPokedexSave(data: Uint8Array, edit: (dex: Uint8Array) => void): Uint8Array {
  const raw = data.subarray(0, 0x80000);
  const layout = layoutOf(raw);
  const recovered = recoverSave(raw, layout);
  const payloads = recovered.payloads.slice();
  const dex = payloads[POKEDEX_BLOCK]!.slice();
  edit(dex);
  payloads[POKEDEX_BLOCK] = dex;
  const out = data.slice();
  out.set(encodeSave(raw, layout, payloads, recovered.counts, recovered.generation));
  return out;
}

/** The Pokédex block of a save. */
export function readPokedexSave(data: Uint8Array): Uint8Array {
  const raw = data.subarray(0, 0x80000);
  return recoverSave(raw, layoutOf(raw)).payloads[POKEDEX_BLOCK]!;
}
