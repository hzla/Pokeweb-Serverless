/**
 * Black 2 / White 2 and Black / White save formats for the Pokeweb item expansion.
 *
 * Black 2 / White 2: the expanded format keeps the retail 512 KiB file, both 0x26000-byte main copies at 0x0 /
 * 0x26000, the retail footer position (used size 0x25fa4) and every extra save at 0x4c000+. Only two blocks change
 * size:
 *   block 25 (bag)                     0x9ec -> 0x1080  pokebw2's shared 1,023-slot pool (version word 2)
 *   block 31 (Pal Pad trade history)   0xd54 -> 0x6fc   Pal Pad is disabled; the first 0x6fc bytes (where Battle
 *                                                       Log keeps its records) are retained
 * so blocks 26-31 move by 0x700 and nothing else moves. The footer magic is "PWI2".
 *
 * Black / White (family "BW1"): the same scheme on its 0x24000-byte copies (used size 0x23f9c, 69 blocks). The bag
 * grows from 0x9c0 to 0x1000 (version word "PWB1" and 1,023 slots; Black / White have no Free Space) and block 31
 * (trade history) shrinks from 0xd54 to 0x6fc, so blocks 26-31 again move by 0x700.
 *
 * Retail -> expanded conversion is internal: the editor's test battles, test warps and quick launch build retail saves
 * and convert them when the ROM has the expansion. It is pure: it never mutates its input, and it validates the whole
 * source before producing output. (The expansion has never shipped, so there is no user-facing save converter.)
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
export const BW1_EXPANDED_BAG_SIZE = 0x1000;
export const BW1_BAG_POOL_VERSION = 0x31425750; // "PWB1"

export type SaveFamily = "BW2" | "BW1";

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

/** Retail Black / White main-save block payload sizes (aletheia: the size callbacks of the main save's table). */
const BW1_RETAIL_BLOCK_SIZES = [
  992, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080, 4080,
  4080, 4080, 4080, 4080, 4080, 4080, 2496, 1332, 104, 156, 4920, 1988, 3412, 44, 1624, 2708, 428, 1004, 92, 480,
  168, 1120, 5120, 676, 732, 844, 1004, 248, 764, 148, 860, 460, 360, 236, 432, 28, 1236, 52, 60, 428, 2960, 156,
  2128, 40, 644, 16, 92, 364, 64, 252,
];

type FamilySpec = {
  regionSize: number;
  usedSize: number;
  blockSizes: number[];
  crcTableSize: number;
  expandedBagSize: number;
  poolVersion: number;
  /** Free Space bits (Black 2 / White 2 only). */
  freeSpace: boolean;
  /** PlayerInfo.version values of the family's games. */
  gameVersions: number[];
  gameName: string;
  /** The last retail item ID. */
  nativeLast: number;
};

const FAMILIES: Record<SaveFamily, FamilySpec> = {
  BW2: { regionSize: SAVE_REGION_SIZE, usedSize: SAVE_USED_SIZE, blockSizes: RETAIL_BLOCK_SIZES, crcTableSize: 0x94,
    expandedBagSize: EXPANDED_BAG_SIZE, poolVersion: BAG_POOL_VERSION, freeSpace: true, gameVersions: [22, 23],
    gameName: "Black 2 / White 2", nativeLast: 638 },
  BW1: { regionSize: 0x24000, usedSize: 0x23f9c, blockSizes: BW1_RETAIL_BLOCK_SIZES, crcTableSize: 0x8c,
    expandedBagSize: BW1_EXPANDED_BAG_SIZE, poolVersion: BW1_BAG_POOL_VERSION, freeSpace: false, gameVersions: [20, 21],
    gameName: "Black / White", nativeLast: 626 },
};

export type SaveLayout = {
  family: SaveFamily;
  format: "retail" | "expanded";
  magic: number;
  regionSize: number;
  usedSize: number;
  blocks: Array<{ offset: number; size: number }>;
  crcOffset: number;
  footerOffset: number;
};

function buildLayout(format: SaveLayout["format"], family: SaveFamily = "BW2"): SaveLayout {
  const spec = FAMILIES[family];
  const blocks: SaveLayout["blocks"] = [];
  let offset = 0;
  spec.blockSizes.forEach((retailSize, index) => {
    const size = format === "expanded" && index === BAG_BLOCK ? spec.expandedBagSize
      : format === "expanded" && index === PAL_PAD_BLOCK ? EXPANDED_PAL_PAD_SIZE : retailSize;
    blocks.push({ offset, size });
    offset = (offset + size + 4 + 0xff) & ~0xff;
  });
  const layout = { family, format, magic: format === "retail" ? RETAIL_SAVE_MAGIC : EXPANDED_SAVE_MAGIC,
    regionSize: spec.regionSize, usedSize: spec.usedSize, blocks, crcOffset: offset, footerOffset: offset + spec.crcTableSize };
  if (layout.footerOffset + 0x10 !== spec.usedSize) throw new Error("Save layout does not end at the retail footer.");
  return layout;
}

export const RETAIL_SAVE_LAYOUT = buildLayout("retail");
export const EXPANDED_SAVE_LAYOUT = buildLayout("expanded");
export const BW1_RETAIL_SAVE_LAYOUT = buildLayout("retail", "BW1");
export const BW1_EXPANDED_SAVE_LAYOUT = buildLayout("expanded", "BW1");
const LAYOUTS: Record<SaveFamily, { retail: SaveLayout; expanded: SaveLayout }> = {
  BW2: { retail: RETAIL_SAVE_LAYOUT, expanded: EXPANDED_SAVE_LAYOUT },
  BW1: { retail: BW1_RETAIL_SAVE_LAYOUT, expanded: BW1_EXPANDED_SAVE_LAYOUT },
};
export function saveLayout(family: SaveFamily, format: SaveLayout["format"]): SaveLayout {
  return LAYOUTS[family][format];
}
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
  return u32(data, base + layout.footerOffset + 4) === layout.usedSize && u32(data, base + layout.footerOffset + 8) === layout.magic;
}

/** The format of a raw 512 KiB save of a family, by its footers (the game applies the same rules at boot). */
export function detectSaveFormat(data: Uint8Array, family: SaveFamily = "BW2"): SaveFormat {
  if (data.length !== SAVE_FILE_SIZE) return "unknown";
  const { retail: retailLayout, expanded: expandedLayout } = LAYOUTS[family];
  const region = retailLayout.regionSize;
  const retail = [0, region].some((base) => hasSignature(data, base, retailLayout));
  const expanded = [0, region].some((base) => hasSignature(data, base, expandedLayout));
  if (retail && expanded) return "mixed";
  if (retail) return "retail";
  if (expanded) return "expanded";
  const fill = data[0];
  if (fill !== 0 && fill !== 0xff) return "unknown";
  for (let i = 0; i < 2 * region; i++) if (data[i] !== fill) return "unknown";
  return "empty";
}

/** Whether a raw save uses the expanded item format of either family (its party block moves by 0x700). */
export function isExpandedItemSave(data: Uint8Array): boolean {
  return detectSaveFormat(data, "BW2") === "expanded" || detectSaveFormat(data, "BW1") === "expanded";
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
  const checks = [0, 1].map((copy) => footerStatus(data, copy * layout.regionSize, layout));
  if (!checks.some((check) => check.status === 0)) throw new Error("Neither main save copy has a valid footer.");
  const [main, backup] = checks;
  const preferMain = main.status === 0 && ((main.count === 0 && backup.count === 0xffffffff) || main.count >= backup.count || backup.status !== 0);
  for (const candidate of preferMain ? [0, 1] : [1, 0]) {
    if (checks[candidate].status !== 0) continue;
    const tableBase = candidate * layout.regionSize + layout.crcOffset;
    const payloads: Uint8Array[] = [], counts: number[] = [];
    let recoveredBlocks = 0;
    for (let index = 0; index < layout.blocks.length; index++) {
      const block = layout.blocks[index];
      const expected = u16(data, tableBase + index * 2);
      const valid: Array<{ copy: number; payload: Uint8Array; count: number }> = [];
      for (const copy of [0, 1]) {
        const start = copy * layout.regionSize + block.offset;
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
    if (payloads.length === layout.blocks.length) return { payloads, counts, generation: checks[candidate].count, copy: candidate, recoveredBlocks };
  }
  throw new Error("No coherent main save generation can be recovered.");
}

/** Writes both main copies (identical) and keeps every byte from the extra-save area on. */
export function encodeSave(source: Uint8Array, layout: SaveLayout, payloads: Uint8Array[], counts: number[], generation: number): Uint8Array {
  const region = new Uint8Array(layout.regionSize).fill(0xff);
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
  put32(region, layout.footerOffset + 4, layout.usedSize);
  put32(region, layout.footerOffset + 8, layout.magic);
  put16(region, layout.footerOffset + 12, 0);
  put16(region, layout.footerOffset + 14, crc16(table));
  const output = source.slice();
  output.set(region, 0);
  output.set(region, layout.regionSize);
  return output;
}

export type ItemSaveRules = {
  /** The ROM's bag pocket of an item (0-4), or undefined when the ROM has no such item. */
  pocketOf: (item: number) => number | undefined;
  /** Most of an item one slot holds (999, or 1 for TMs/HMs). */
  maxCount?: (item: number) => number;
  /** The save family (default Black 2 / White 2). */
  family?: SaveFamily;
};

export type ItemSaveConversionReport = {
  sourceFormat: SaveFormat;
  targetFormat: "expanded" | "retail";
  generation: number;
  selectedCopy: number;
  recoveredBlocks: number;
  bagItems: number;
  palPadBattleLogKept: boolean;
  /** PlayerInfo.version of the save: 20 White, 21 Black, 22 White 2, 23 Black 2. */
  gameVersion: number;
};

function maxCountFor(rules: ItemSaveRules, item: number, pocket: number): number {
  return rules.maxCount?.(item) ?? (pocket === 2 ? 1 : 999);
}

function checkGame(payloads: Uint8Array[], family: SaveFamily): number {
  // TrainerDataSave.config is four bytes; PlayerInfo.version is its byte 27 (the same in Black / White). The two
  // games of a family share the save format (and load each other's saves), so either is accepted.
  const version = payloads[TRAINER_BLOCK][4 + 27];
  const spec = FAMILIES[family];
  if (!spec.gameVersions.includes(version)) throw new Error(`This is not a ${spec.gameName} save (game version ${version}).`);
  return version;
}

/** Retail bag -> pool, ordered by the ROM's pockets (the in-game validator requires that order). */
function convertBag(payload: Uint8Array, rules: ItemSaveRules): { bag: Uint8Array; count: number } {
  const spec = FAMILIES[rules.family ?? "BW2"];
  if (payload.length !== spec.blockSizes[BAG_BLOCK]) throw new Error("Wrong retail bag size.");
  if (spec.freeSpace && u32(payload, RETAIL_FREE_SPACE_OFFSET) & 1) throw new Error("The bag marks the empty item as Free Space.");
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
  const bag = new Uint8Array(spec.expandedBagSize);
  put32(bag, 0, spec.poolVersion);
  let slot = 0;
  for (const rows of byPocket) for (const [item, count] of rows) { put16(bag, 4 + slot * 4, item); put16(bag, 6 + slot * 4, count); slot++; }
  if (spec.freeSpace) bag.set(payload.subarray(RETAIL_FREE_SPACE_OFFSET, RETAIL_FREE_SPACE_OFFSET + RETAIL_FREE_SPACE_WORDS * 4), EXPANDED_FREE_SPACE_OFFSET);
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
  const family = rules.family ?? "BW2";
  const format = detectSaveFormat(data, family);
  if (format === "expanded") throw new Error("This save already uses the expanded item format.");
  if (format === "mixed") throw new Error("This save has both formats; restore the original file.");
  if (format !== "retail") throw new Error(`No retail ${FAMILIES[family].gameName} save footer was found.`);
  const recovered = recoverSave(data, LAYOUTS[family].retail);
  const gameVersion = checkGame(recovered.payloads, family);
  const { bag, count } = convertBag(recovered.payloads[BAG_BLOCK], rules);
  const palPad = shrinkPalPad(recovered.payloads[PAL_PAD_BLOCK]);
  const payloads = recovered.payloads.slice();
  payloads[BAG_BLOCK] = bag;
  payloads[PAL_PAD_BLOCK] = palPad.block;
  const bytes = encodeSave(data, LAYOUTS[family].expanded, payloads, recovered.counts, recovered.generation);
  return { bytes, report: { sourceFormat: format, targetFormat: "expanded", generation: recovered.generation, selectedCopy: recovered.copy, recoveredBlocks: recovered.recoveredBlocks, bagItems: count, palPadBattleLogKept: palPad.kept, gameVersion } };
}

/** Checks an expanded bag the way the game does at boot (W2U_BagValidate / PwBag_Validate). */
export function validateExpandedBag(bag: Uint8Array, rules: ItemSaveRules): string | undefined {
  const spec = FAMILIES[rules.family ?? "BW2"];
  if (bag.length !== spec.expandedBagSize || u32(bag, 0) !== spec.poolVersion) return "The bag is not an expanded item pool.";
  if (spec.freeSpace && u32(bag, EXPANDED_FREE_SPACE_OFFSET) & 1) return "The bag marks the empty item as Free Space.";
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

/** The retail bag's slots of a pocket (0 items, 1 medicine, 2 TMs/HMs, 3 berries, 4 key items) in a retail save. */
export function retailPocketItems(data: Uint8Array, family: SaveFamily, pocket: number): Array<[number, number]> {
  const recovered = recoverSave(data, LAYOUTS[family].retail);
  const bag = recovered.payloads[BAG_BLOCK];
  let offset = 0;
  for (const [id, slots] of RETAIL_POCKETS) {
    if (id === pocket) {
      const out: Array<[number, number]> = [];
      for (let i = 0; i < slots; i++) if (u16(bag, offset + i * 4)) out.push([u16(bag, offset + i * 4), u16(bag, offset + i * 4 + 2)]);
      return out;
    }
    offset += slots * 4;
  }
  throw new Error(`No bag pocket ${pocket}.`);
}

/**
 * Puts an item in a retail save's bag pocket (the first empty slot), unless the pocket already holds it. Both main
 * copies are rewritten with valid checksums; the rest of the file is kept. Used for the bundled test saves.
 */
export function addRetailBagItem(data: Uint8Array, family: SaveFamily, pocket: number, item: number, count = 1): { bytes: Uint8Array; added: boolean } {
  if (detectSaveFormat(data, family) !== "retail") throw new Error(`Expected a retail ${FAMILIES[family].gameName} save.`);
  const recovered = recoverSave(data, LAYOUTS[family].retail);
  const bag = recovered.payloads[BAG_BLOCK].slice();
  let offset = 0;
  for (const [id, slots] of RETAIL_POCKETS) {
    if (id === pocket) {
      for (let i = 0; i < slots; i++) if (u16(bag, offset + i * 4) === item) return { bytes: data, added: false };
      for (let i = 0; i < slots; i++) {
        const at = offset + i * 4;
        if (u16(bag, at) !== 0) continue;
        put16(bag, at, item);
        put16(bag, at + 2, count);
        const payloads = recovered.payloads.slice();
        payloads[BAG_BLOCK] = bag;
        return { bytes: encodeSave(data, LAYOUTS[family].retail, payloads, recovered.counts, recovered.generation), added: true };
      }
      throw new Error(`Bag pocket ${pocket} is full.`);
    }
    offset += slots * 4;
  }
  throw new Error(`No bag pocket ${pocket}.`);
}
