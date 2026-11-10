/**
 * Black 2 / White 2 save formats for the Pokeweb item expansion.
 *
 * The expanded format keeps the retail 512 KiB file, both 0x26000-byte main copies at 0x0 / 0x26000, the retail
 * footer position (used size 0x25fa4) and every extra save at 0x4c000+. Only two blocks change size:
 *   block 25 (bag)                     0x9ec -> 0x1080  pokebw2's shared 1,023-slot pool (version word 2)
 *   block 31 (Pal Pad trade history)   0xd54 -> 0x6fc   Pal Pad is disabled; the first 0x6fc bytes (where Battle
 *                                                       Log keeps its records) are retained
 * so blocks 26-31 move by 0x700 and nothing else moves. The footer magic is "PWI2".
 *
 * Conversion is pure: it never mutates its input, and it validates the whole source before producing output.
 */

export const SAVE_FILE_SIZE = 0x80000;
export const SAVE_REGION_SIZE = 0x26000;
export const SAVE_EXTRA_START = 0x4c000;
export const SAVE_USED_SIZE = 0x25fa4;
export const RETAIL_SAVE_MAGIC = 0x31053527;
export const EXPANDED_SAVE_MAGIC = 0x32495750; // "PWI2"
export const BAG_BLOCK = 25;
export const TRAINER_BLOCK = 27;
export const PAL_PAD_BLOCK = 31;
export const EXPANDED_BAG_SIZE = 0x1080;
export const EXPANDED_PAL_PAD_SIZE = 0x6fc;
export const BAG_POOL_SLOTS = 1023;
export const BAG_POOL_VERSION = 2;
const CRC_TABLE_SIZE = 0x94;
const BLOCK_COUNT = 73;

/** Retail Black 2 / White 2 main-save block payload sizes (pokebw2 save_table.c). */
const RETAIL_BLOCK_SIZES = [
  992, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080,
  4080, 4080, 4080, 4080, 4080, 4080, 2540, 1332, 176, 168, 4920, 1988, 3412, 148, 1624, 2708, 428, 1004, 92, 480,
  168, 1120, 5120, 676, 224, 844, 1248, 248, 764, 148, 860, 468, 480, 240, 436, 1244, 52, 60, 428, 2960, 172, 2128,
  644, 16, 168, 364, 128, 252, 5800, 1176, 96, 252, 996, 240,
];

/** Retail pockets in save order: [pocket id, slots]. Pocket ids: 0 items, 1 medicine, 2 TMs/HMs, 3 berries, 4 key. */
const RETAIL_POCKETS: ReadonlyArray<readonly [number, number]> = [[0, 310], [4, 83], [2, 109], [1, 48], [3, 64]];
const RETAIL_FREE_SPACE_OFFSET = 0x998;
const RETAIL_FREE_SPACE_WORDS = 21;
const EXPANDED_FREE_SPACE_OFFSET = 0x1000;

export type SaveLayout = {
  format: "retail" | "expanded";
  magic: number;
  blocks: Array<{ offset: number; size: number }>;
  crcOffset: number;
  footerOffset: number;
};

function buildLayout(format: SaveLayout["format"]): SaveLayout {
  const blocks: SaveLayout["blocks"] = [];
  let offset = 0;
  RETAIL_BLOCK_SIZES.forEach((retailSize, index) => {
    const size = format === "expanded" && index === BAG_BLOCK ? EXPANDED_BAG_SIZE
      : format === "expanded" && index === PAL_PAD_BLOCK ? EXPANDED_PAL_PAD_SIZE : retailSize;
    blocks.push({ offset, size });
    offset = (offset + size + 4 + 0xff) & ~0xff;
  });
  const layout = { format, magic: format === "retail" ? RETAIL_SAVE_MAGIC : EXPANDED_SAVE_MAGIC, blocks, crcOffset: offset, footerOffset: offset + CRC_TABLE_SIZE };
  if (layout.footerOffset + 0x10 !== SAVE_USED_SIZE) throw new Error("Save layout does not end at the retail footer.");
  return layout;
}

export const RETAIL_SAVE_LAYOUT = buildLayout("retail");
export const EXPANDED_SAVE_LAYOUT = buildLayout("expanded");
/** How far blocks 26-31 (party, trainer, player position, Wi-Fi) move in the expanded format: 0x700. */
export const PARTY_BLOCK_SHIFT = EXPANDED_SAVE_LAYOUT.blocks[26].offset - RETAIL_SAVE_LAYOUT.blocks[26].offset;

export type SaveFormat = "retail" | "expanded" | "mixed" | "empty" | "unknown";

const u16 = (data: Uint8Array, offset: number) => data[offset] | (data[offset + 1] << 8);
const u32 = (data: Uint8Array, offset: number) => (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
const put16 = (data: Uint8Array, offset: number, value: number) => { data[offset] = value & 0xff; data[offset + 1] = (value >> 8) & 0xff; };
const put32 = (data: Uint8Array, offset: number, value: number) => { put16(data, offset, value & 0xffff); put16(data, offset + 2, (value >>> 16) & 0xffff); };

/** MATH_CalcCRC16CCITT with the native initial value 0xffff (binascii.crc_hqx). */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function hasSignature(data: Uint8Array, base: number, layout: SaveLayout): boolean {
  return u32(data, base + layout.footerOffset + 4) === SAVE_USED_SIZE && u32(data, base + layout.footerOffset + 8) === layout.magic;
}

/** The format of a raw 512 KiB save, by its footers (the game applies the same rules at boot). */
export function detectSaveFormat(data: Uint8Array): SaveFormat {
  if (data.length !== SAVE_FILE_SIZE) return "unknown";
  const retail = [0, SAVE_REGION_SIZE].some((base) => hasSignature(data, base, RETAIL_SAVE_LAYOUT));
  const expanded = [0, SAVE_REGION_SIZE].some((base) => hasSignature(data, base, EXPANDED_SAVE_LAYOUT));
  if (retail && expanded) return "mixed";
  if (retail) return "retail";
  if (expanded) return "expanded";
  const fill = data[0];
  if (fill !== 0 && fill !== 0xff) return "unknown";
  for (let i = 0; i < 2 * SAVE_REGION_SIZE; i++) if (data[i] !== fill) return "unknown";
  return "empty";
}

type Recovered = { payloads: Uint8Array[]; counts: number[]; generation: number; copy: number; recoveredBlocks: number };

function footerStatus(data: Uint8Array, base: number, layout: SaveLayout): { status: number; count: number } {
  const count = u32(data, base + layout.footerOffset);
  if (!hasSignature(data, base, layout)) return { status: 2, count };
  const table = data.subarray(base + layout.crcOffset, base + layout.footerOffset);
  return { status: crc16(table) === u16(data, base + layout.footerOffset + 14) ? 0 : 1, count };
}

/** Selects one committed CRC-table generation (native rules) and its blocks, never mixing generations. */
export function recoverSave(data: Uint8Array, layout: SaveLayout): Recovered {
  const checks = [0, 1].map((copy) => footerStatus(data, copy * SAVE_REGION_SIZE, layout));
  if (!checks.some((check) => check.status === 0)) throw new Error("Neither main save copy has a valid footer.");
  const [main, backup] = checks;
  const preferMain = main.status === 0 && ((main.count === 0 && backup.count === 0xffffffff) || main.count >= backup.count || backup.status !== 0);
  for (const candidate of preferMain ? [0, 1] : [1, 0]) {
    if (checks[candidate].status !== 0) continue;
    const tableBase = candidate * SAVE_REGION_SIZE + layout.crcOffset;
    const payloads: Uint8Array[] = [], counts: number[] = [];
    let recoveredBlocks = 0;
    for (let index = 0; index < BLOCK_COUNT; index++) {
      const block = layout.blocks[index];
      const expected = u16(data, tableBase + index * 2);
      const valid: Array<{ copy: number; payload: Uint8Array; count: number }> = [];
      for (const copy of [0, 1]) {
        const start = copy * SAVE_REGION_SIZE + block.offset;
        const payload = data.slice(start, start + block.size);
        const checksum = u16(data, start + block.size + 2);
        if (checksum === expected && crc16(payload) === checksum) valid.push({ copy, payload, count: u16(data, start + block.size) });
      }
      if (!valid.length) break;
      const chosen = valid.find((row) => row.copy === candidate) ?? valid[0];
      if (chosen.copy !== candidate) recoveredBlocks++;
      payloads.push(chosen.payload);
      counts.push(chosen.count);
    }
    if (payloads.length === BLOCK_COUNT) return { payloads, counts, generation: checks[candidate].count, copy: candidate, recoveredBlocks };
  }
  throw new Error("No coherent main save generation can be recovered.");
}

/** Writes both main copies (identical) and keeps every byte from the extra-save area on. */
export function encodeSave(source: Uint8Array, layout: SaveLayout, payloads: Uint8Array[], counts: number[], generation: number): Uint8Array {
  const region = new Uint8Array(SAVE_REGION_SIZE).fill(0xff);
  layout.blocks.forEach((block, index) => {
    const payload = payloads[index];
    if (payload.length !== block.size) throw new Error(`Save block ${index} has the wrong size.`);
    region.set(payload, block.offset);
    const checksum = crc16(payload);
    put16(region, block.offset + block.size, counts[index]);
    put16(region, block.offset + block.size + 2, checksum);
    put16(region, layout.crcOffset + index * 2, checksum);
  });
  const table = region.subarray(layout.crcOffset, layout.footerOffset);
  put32(region, layout.footerOffset, generation);
  put32(region, layout.footerOffset + 4, SAVE_USED_SIZE);
  put32(region, layout.footerOffset + 8, layout.magic);
  put16(region, layout.footerOffset + 12, 0);
  put16(region, layout.footerOffset + 14, crc16(table));
  const output = source.slice();
  output.set(region, 0);
  output.set(region, SAVE_REGION_SIZE);
  return output;
}

export type ItemSaveRules = {
  /** The ROM's bag pocket of an item (0-4), or undefined when the ROM has no such item. */
  pocketOf: (item: number) => number | undefined;
  /** Most of an item one slot holds (999, or 1 for TMs/HMs). */
  maxCount?: (item: number) => number;
};

export type ItemSaveConversionReport = {
  sourceFormat: SaveFormat;
  targetFormat: "expanded" | "retail";
  generation: number;
  selectedCopy: number;
  recoveredBlocks: number;
  bagItems: number;
  palPadBattleLogKept: boolean;
  /** PlayerInfo.version of the save: 22 White 2, 23 Black 2. */
  gameVersion: number;
};

function maxCountFor(rules: ItemSaveRules, item: number, pocket: number): number {
  return rules.maxCount?.(item) ?? (pocket === 2 ? 1 : 999);
}

function checkGame(payloads: Uint8Array[]): number {
  // TrainerDataSave.config is four bytes; PlayerInfo.version is its byte 27. Black 2 and White 2 share the save
  // format (and load each other's saves), so either is accepted; anything else is not a Black 2 / White 2 save.
  const version = payloads[TRAINER_BLOCK][4 + 27];
  if (version !== 22 && version !== 23) throw new Error(`This is not a Black 2 / White 2 save (game version ${version}).`);
  return version;
}

/** Retail bag -> pool, ordered by the ROM's pockets (the in-game validator requires that order). */
function convertBag(payload: Uint8Array, rules: ItemSaveRules): { bag: Uint8Array; count: number } {
  if (payload.length !== RETAIL_BLOCK_SIZES[BAG_BLOCK]) throw new Error("Wrong retail bag size.");
  if (u32(payload, RETAIL_FREE_SPACE_OFFSET) & 1) throw new Error("The bag marks the empty item as Free Space.");
  const byPocket: Array<Array<[number, number]>> = [[], [], [], [], []];
  const seen = new Set<number>();
  let offset = 0;
  for (const [, slots] of RETAIL_POCKETS) {
    for (let i = 0; i < slots; i++, offset += 4) {
      const item = u16(payload, offset), count = u16(payload, offset + 2);
      if (item === 0) {
        if (count !== 0) throw new Error("An empty bag slot has a count.");
        continue;
      }
      const pocket = rules.pocketOf(item);
      if (pocket === undefined || pocket < 0 || pocket > 4) throw new Error(`The bag holds item ${item}, which this ROM does not have.`);
      if (count === 0 || count > maxCountFor(rules, item, pocket)) throw new Error(`The bag holds an invalid count of item ${item}.`);
      if (seen.has(item)) throw new Error(`The bag holds item ${item} in two slots.`);
      seen.add(item);
      byPocket[pocket].push([item, count]);
    }
  }
  const bag = new Uint8Array(EXPANDED_BAG_SIZE);
  put32(bag, 0, BAG_POOL_VERSION);
  let slot = 0;
  for (const rows of byPocket) for (const [item, count] of rows) { put16(bag, 4 + slot * 4, item); put16(bag, 6 + slot * 4, count); slot++; }
  bag.set(payload.subarray(RETAIL_FREE_SPACE_OFFSET, RETAIL_FREE_SPACE_OFFSET + RETAIL_FREE_SPACE_WORDS * 4), EXPANDED_FREE_SPACE_OFFSET);
  return { bag, count: slot };
}

const BATTLE_LOG_MAGIC = 0x474f4c4b; // "KLOG"

function shrinkPalPad(payload: Uint8Array): { block: Uint8Array; kept: boolean } {
  const block = new Uint8Array(EXPANDED_PAL_PAD_SIZE);
  const kept = u32(payload, 0) === BATTLE_LOG_MAGIC;
  if (kept) block.set(payload.subarray(0, EXPANDED_PAL_PAD_SIZE));
  return { block, kept };
}

/** Retail save -> expanded item save. Throws (without output) on anything it cannot convert exactly. */
export function convertSaveToExpanded(data: Uint8Array, rules: ItemSaveRules): { bytes: Uint8Array; report: ItemSaveConversionReport } {
  if (data.length !== SAVE_FILE_SIZE) throw new Error("Expected a raw 512 KiB .sav (not an emulator container).");
  const format = detectSaveFormat(data);
  if (format === "expanded") throw new Error("This save already uses the expanded item format.");
  if (format === "mixed") throw new Error("This save has both formats; restore the original file.");
  if (format !== "retail") throw new Error("No retail Black 2 / White 2 save footer was found.");
  const recovered = recoverSave(data, RETAIL_SAVE_LAYOUT);
  const gameVersion = checkGame(recovered.payloads);
  const { bag, count } = convertBag(recovered.payloads[BAG_BLOCK], rules);
  const palPad = shrinkPalPad(recovered.payloads[PAL_PAD_BLOCK]);
  const payloads = recovered.payloads.slice();
  payloads[BAG_BLOCK] = bag;
  payloads[PAL_PAD_BLOCK] = palPad.block;
  const bytes = encodeSave(data, EXPANDED_SAVE_LAYOUT, payloads, recovered.counts, recovered.generation);
  return { bytes, report: { sourceFormat: format, targetFormat: "expanded", generation: recovered.generation, selectedCopy: recovered.copy, recoveredBlocks: recovered.recoveredBlocks, bagItems: count, palPadBattleLogKept: palPad.kept, gameVersion } };
}

/** Checks an expanded bag the way the game does at boot (W2U_BagValidate). */
export function validateExpandedBag(bag: Uint8Array, rules: ItemSaveRules): string | undefined {
  if (bag.length !== EXPANDED_BAG_SIZE || u32(bag, 0) !== BAG_POOL_VERSION) return "The bag is not a version-2 pool.";
  if (u32(bag, EXPANDED_FREE_SPACE_OFFSET) & 1) return "The bag marks the empty item as Free Space.";
  const seen = new Set<number>();
  let ended = false, lastPocket = 0;
  for (let slot = 0; slot < BAG_POOL_SLOTS; slot++) {
    const item = u16(bag, 4 + slot * 4), count = u16(bag, 6 + slot * 4);
    if (item === 0) { if (count) return "An empty bag slot has a count."; ended = true; continue; }
    if (ended) return "The bag has an item after its end.";
    const pocket = rules.pocketOf(item);
    if (pocket === undefined || pocket > 4) return `The bag holds item ${item}, which this ROM does not have.`;
    if (pocket < lastPocket) return "The bag's items are not ordered by pocket.";
    if (!count || count > maxCountFor(rules, item, pocket)) return `The bag holds an invalid count of item ${item}.`;
    if (seen.has(item)) return `The bag holds item ${item} twice.`;
    seen.add(item);
    lastPocket = pocket;
  }
  return undefined;
}

/**
 * Expanded save -> retail save (for uninstalling). Fails when the bag holds an item above 638, or more distinct items
 * in a pocket than the retail pocket has slots.
 */
export function convertSaveToRetail(data: Uint8Array, rules: ItemSaveRules): { bytes: Uint8Array; report: ItemSaveConversionReport } {
  if (data.length !== SAVE_FILE_SIZE) throw new Error("Expected a raw 512 KiB .sav (not an emulator container).");
  const format = detectSaveFormat(data);
  if (format !== "expanded") throw new Error("This save does not use the expanded item format.");
  const recovered = recoverSave(data, EXPANDED_SAVE_LAYOUT);
  const gameVersion = checkGame(recovered.payloads);
  const pool = recovered.payloads[BAG_BLOCK];
  const problem = validateExpandedBag(pool, rules);
  if (problem) throw new Error(problem);
  const bag = new Uint8Array(RETAIL_BLOCK_SIZES[BAG_BLOCK]);
  const fill = new Map<number, number>(RETAIL_POCKETS.map(([pocket]) => [pocket, 0]));
  const starts = new Map<number, [number, number]>();
  let offset = 0;
  for (const [pocket, slots] of RETAIL_POCKETS) { starts.set(pocket, [offset, slots]); offset += slots * 4; }
  let items = 0;
  for (let slot = 0; slot < BAG_POOL_SLOTS; slot++) {
    const item = u16(pool, 4 + slot * 4), count = u16(pool, 6 + slot * 4);
    if (!item) break;
    if (item > 638) throw new Error(`Item ${item} cannot be stored in a retail save.`);
    const pocket = rules.pocketOf(item)!;
    const [start, slots] = starts.get(pocket)!;
    const used = fill.get(pocket)!;
    if (used >= slots) throw new Error(`Pocket ${pocket} holds more items than its ${slots} retail slots.`);
    put16(bag, start + used * 4, item);
    put16(bag, start + used * 4 + 2, count);
    fill.set(pocket, used + 1);
    items++;
  }
  for (let word = 0; word < RETAIL_FREE_SPACE_WORDS; word++) put32(bag, RETAIL_FREE_SPACE_OFFSET + word * 4, u32(pool, EXPANDED_FREE_SPACE_OFFSET + word * 4));
  for (let word = RETAIL_FREE_SPACE_WORDS; word < 32; word++) if (u32(pool, EXPANDED_FREE_SPACE_OFFSET + word * 4)) throw new Error("Free Space holds an item above 671.");
  const palPad = new Uint8Array(RETAIL_BLOCK_SIZES[PAL_PAD_BLOCK]);
  const kept = u32(recovered.payloads[PAL_PAD_BLOCK], 0) === BATTLE_LOG_MAGIC;
  if (kept) palPad.set(recovered.payloads[PAL_PAD_BLOCK]);
  const payloads = recovered.payloads.slice();
  payloads[BAG_BLOCK] = bag;
  payloads[PAL_PAD_BLOCK] = palPad;
  const bytes = encodeSave(data, RETAIL_SAVE_LAYOUT, payloads, recovered.counts, recovered.generation);
  return { bytes, report: { sourceFormat: format, targetFormat: "retail", generation: recovered.generation, selectedCopy: recovered.copy, recoveredBlocks: recovered.recoveredBlocks, bagItems: items, palPadBattleLogKept: kept, gameVersion } };
}
