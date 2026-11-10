import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { getOverlayInfo, getOverlayWorkingBytes } from "./overlayEditModel";
import { canRemoveStagedCodeInjectionDll, getPmcInstallStatus, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule, type RpmRelocation, type RpmSymbol } from "./rpm";

/**
 * Black / White Poké Mart inventories.
 *
 * BW1 has no mart NARC: the shop screen (overlay 21,
 * SCRCMD_PROC_FLD_BuildItemListByBadges / _BuildItemListFixed) reads item
 * lists compiled into the overlay. One literal pool holds the addresses of
 * the badge-tier table (u8 per badge count), the list pointer table (u16
 * item arrays) and the list counts (u8); 0xA8 bytes later a second pool holds
 * the Battle Subway BP shops' pointer table ({u16 item, u16 0, u32 price}
 * entries) and counts.
 *
 * Without code injection, lists are edited in place and keep their retail
 * length as capacity. Expanded inventories move every list into a generated
 * PMC module (PokewebMarts{B,W}.dll) and point the four literal-pool words at
 * it with OFFSET relocations, so each shop can hold up to 40 items (the size
 * of the shop screen's item array). No game code changes.
 */

export const BW1_MART_OVERLAY = 21;
/** ShopWork.items[40] in the shop screen. */
export const BW1_MART_EXPANDED_SLOTS = 40;
const POOL_MARKER = 0x162;
const BP_POOL_OFFSET = 0xa8;
const BP_ENTRY_SIZE = 8;
const DLL_VERSION = "1.0.0";
/** Retail list lengths (identical in every Black and White): the in-place capacity. */
const RETAIL_COUNTS = [2, 11, 14, 17, 18, 19, 7, 8, 9, 11, 7, 11, 4, 3, 11, 8, 8, 9, 8, 8, 4, 9, 16, 2, 16, 6] as const;
const RETAIL_BP_COUNTS = [38, 10] as const;
/** Script shop IDs 0-19 select list ID + 6 (from the zone scripts that call the shop script 10110). */
const SPECIALTY_LABELS = [
  "Accumula Town", "Striaton City", "Nacrene City", "Castelia City", "Nimbasa City", "Driftveil City",
  "Mistralton City", "Icirrus City", "Opelucid City", "Pokémon League", "Lacunosa Town", "Undella Town",
  "Black City / White Forest", "Nacrene City · Shopping Mall Nine: battle items", "Driftveil Market: herbs", "Driftveil Market: incense",
  "Shopping Mall Nine: medicine", "Shopping Mall Nine: TMs", "Shopping Mall Nine: Poké Balls", "Shopping Mall Nine: vitamins",
] as const;
const BP_LABELS = ["Gear Station: BP items", "Gear Station: BP TMs"] as const;

export type Bw1MartVersion = "B" | "W";
export type Bw1BpEntry = { itemId: number; price: number };

export type Bw1MartLayout = {
  base: number;
  pool: number;
  tiers: number;
  table: number;
  counts: number;
  bpPool: number;
  bpTable: number;
  bpCounts: number;
  lists: Array<{ address: number; capacity: number }>;
  bpLists: Array<{ address: number; capacity: number }>;
};

export type Bw1MartData = {
  layout: Bw1MartLayout;
  shops: number[][];
  bpShops: Bw1BpEntry[][];
  tiers: number[];
  expanded: boolean;
  dllPath?: string;
};

export type Bw1MartExpansionStatus = {
  supported: boolean;
  installed: boolean;
  pmcInstalled: boolean;
  canUninstall: boolean;
  /** Every list fits its retail size again, so the module can be removed. */
  fitsInPlace: boolean;
  message: string;
};

export function bw1MartVersion(project: ProjectState): Bw1MartVersion | undefined {
  const version = project.session.baseVersion;
  return project.session.baseRom === "BW" && (version === "B" || version === "W") ? version : undefined;
}

export function bw1MartDllPath(version: Bw1MartVersion): string {
  return `patches/PokewebMarts${version}.dll`;
}

/** True when this is a Black / White project whose overlay 21 shop tables were found. */
export function bw1MartsSupported(project: ProjectState): boolean {
  try { return Boolean(bw1MartVersion(project) && openRom(project) && readLayout(project)); } catch { return false; }
}

export function bw1MartCount(): number {
  return RETAIL_COUNTS.length + RETAIL_BP_COUNTS.length;
}

/** True for the two Battle Subway BP shops, which sit after the regular lists. */
export function isBw1BpMart(martId: number): boolean {
  return martId >= RETAIL_COUNTS.length;
}

export function bw1MartLabel(data: Bw1MartData, martId: number): string {
  if (isBw1BpMart(martId)) return BP_LABELS[martId - RETAIL_COUNTS.length] ?? `BP shop ${martId}`;
  if (martId >= 6) return SPECIALTY_LABELS[martId - 6] ?? `Mart ${martId}`;
  const badges = data.tiers.flatMap((list, count) => list === martId ? [count] : []);
  if (!badges.length) return `Poké Mart stock ${martId} (unused)`;
  const range = badges.length === 1 ? `${badges[0]}` : `${badges[0]}–${badges[badges.length - 1]}`;
  return `Poké Mart: ${range} badge${badges.length === 1 && badges[0] === 1 ? "" : "s"}`;
}

/** Item slots this mart can hold now: retail length in place, 40 with expansion. */
export function bw1MartCapacity(data: Bw1MartData, martId: number): number {
  if (data.expanded) return BW1_MART_EXPANDED_SLOTS;
  return isBw1BpMart(martId) ? data.layout.bpLists[martId - RETAIL_COUNTS.length]!.capacity : data.layout.lists[martId]!.capacity;
}

export function readBw1Marts(project: ProjectState): Bw1MartData {
  const version = bw1MartVersion(project);
  if (!version) throw new Error("BW1 marts need a Black or White project.");
  const layout = readLayout(project);
  const overlay = overlayBytes(project);
  const at = (address: number) => address - layout.base;
  const tiers = Array.from({ length: 9 }, (_unused, n) => overlay[at(layout.tiers) + n]!);
  const module = installedModule(project, version);
  if (module) {
    const parsed = parseBw1MartDll(module.bytes);
    return { layout, ...parsed, tiers, expanded: true, dllPath: module.path };
  }
  const shops = layout.lists.map((list, index) => {
    const count = overlay[at(layout.counts) + index]!;
    return Array.from({ length: count }, (_unused, n) => readU16(overlay, at(list.address) + n * 2));
  });
  const bpShops = layout.bpLists.map((list, index) => {
    const count = overlay[at(layout.bpCounts) + index]!;
    return Array.from({ length: count }, (_unused, n) => ({
      itemId: readU16(overlay, at(list.address) + n * BP_ENTRY_SIZE),
      price: readU32(overlay, at(list.address) + n * BP_ENTRY_SIZE + 4),
    }));
  });
  return { layout, shops, bpShops, tiers, expanded: false };
}

/** Replace one regular mart's items (item IDs, in order). */
export function setBw1MartItems(project: ProjectState, martId: number, items: number[], label?: string): void {
  if (isBw1BpMart(martId) || martId < 0) throw new Error(`Mart ${martId} is not a regular mart.`);
  const data = readBw1Marts(project);
  const before = data.shops[martId]!;
  validateItems(project, items, bw1MartCapacity(data, martId), bw1MartLabel(data, martId));
  data.shops[martId] = items.slice();
  save(project, data, { martId });
  recordFieldChange(project, "marts", bw1MartLabel(data, martId), label ?? "items", itemList(project, before), itemList(project, items), {
    key: `mart:${martId}:${label ?? "items"}`,
  });
}

/** Replace one BP shop's entries. */
export function setBw1BpItems(project: ProjectState, martId: number, entries: Bw1BpEntry[], label?: string): void {
  if (!isBw1BpMart(martId)) throw new Error(`Mart ${martId} is not a BP shop.`);
  const data = readBw1Marts(project);
  const index = martId - RETAIL_COUNTS.length;
  const before = data.bpShops[index]!;
  validateItems(project, entries.map((entry) => entry.itemId), bw1MartCapacity(data, martId), bw1MartLabel(data, martId));
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.price) || entry.price < 0 || entry.price > 0xffff) throw new Error("BP prices must be between 0 and 65535.");
  }
  data.bpShops[index] = entries.map((entry) => ({ ...entry }));
  save(project, data, { bpIndex: index });
  const describe = (list: Bw1BpEntry[]) => list.map((entry) => `${itemName(project, entry.itemId)} (${entry.price} BP)`).join(", ");
  recordFieldChange(project, "marts", bw1MartLabel(data, martId), label ?? "items", describe(before), describe(entries), {
    key: `mart:${martId}:${label ?? "items"}`,
  });
}

export function getBw1MartExpansionStatus(project: ProjectState): Bw1MartExpansionStatus {
  const version = bw1MartVersion(project);
  const status: Bw1MartExpansionStatus = { supported: false, installed: false, pmcInstalled: false, canUninstall: false, fitsInPlace: true, message: "" };
  if (!version || !bw1MartsSupported(project)) return { ...status, message: "Expanded inventories need a Black or White ROM loaded in this session." };
  status.supported = true;
  status.pmcInstalled = getPmcInstallStatus(project).installed;
  const data = readBw1Marts(project);
  status.installed = data.expanded;
  status.fitsInPlace = data.shops.every((items, index) => items.length <= data.layout.lists[index]!.capacity)
    && data.bpShops.every((items, index) => items.length <= data.layout.bpLists[index]!.capacity);
  status.canUninstall = data.expanded && Boolean(data.dllPath) && canRemoveStagedCodeInjectionDll(project, data.dllPath!);
  status.message = data.expanded
    ? status.canUninstall
      ? status.fitsInPlace ? "Every shop can hold 40 items." : "Every shop can hold 40 items. To remove the module, trim each shop back to its retail size first."
      : "Every shop can hold 40 items. The module is part of the loaded ROM."
    : "Each shop holds at most its retail number of items. Expanding moves the lists into a code injection module so each can hold 40.";
  return status;
}

/** Move every list into the generated module (installs PMC first if needed). */
export async function enableBw1MartExpansion(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, (staged) => {
    const data = readBw1Marts(staged);
    if (data.expanded) return;
    data.expanded = true;
    save(staged, data, {});
    recordGenericChange(staged, "marts", "Expanded mart inventories installed: every shop can hold up to 40 items.", "Marts", { key: "marts:bw1-expansion" });
  });
}

/** Put every list back into overlay 21 and remove the module. */
export async function disableBw1MartExpansion(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, (staged) => {
    const data = readBw1Marts(staged);
    if (!data.expanded || !data.dllPath) return;
    if (!canRemoveStagedCodeInjectionDll(staged, data.dllPath)) throw new Error("The mart module is part of the loaded ROM and cannot be removed.");
    for (const [index, items] of data.shops.entries()) {
      const capacity = data.layout.lists[index]!.capacity;
      if (items.length > capacity) throw new Error(`${bw1MartLabel(data, index)} has ${items.length} items; it holds ${capacity} without expansion.`);
    }
    for (const [index, items] of data.bpShops.entries()) {
      const capacity = data.layout.bpLists[index]!.capacity;
      const martId = RETAIL_COUNTS.length + index;
      if (items.length > capacity) throw new Error(`${bw1MartLabel(data, martId)} has ${items.length} items; it holds ${capacity} without expansion.`);
    }
    writeInPlace(staged, data);
    removeStagedCodeInjectionDll(staged, data.dllPath);
    recordGenericChange(staged, "marts", "Expanded mart inventories removed; the lists are back in overlay 21.", "Marts", { key: "marts:bw1-expansion" });
  });
}

// ---------- Module ----------

/**
 * Data-only PMC module. Code image:
 *   0x00 "PWMT", u8 version, u8 list count, u8 BP list count, u8 0
 *   0x08 list pointers (u32 each), then BP list pointers
 *   then list counts (u8 each), BP counts, padded to 4
 *   then each list (u16 items), each BP list ({u16 item, u16 0, u32 price}), 4-aligned
 * Base OFFSET relocations fill the pointers; four OFFSET relocations into
 * overlay 21 replace the literal-pool words for the tables and the counts.
 */
export function buildBw1MartDll(version: Bw1MartVersion, layout: Bw1MartLayout, shops: number[][], bpShops: Bw1BpEntry[][]): Uint8Array {
  const listCount = shops.length, bpCount = bpShops.length;
  const tableAt = 8, bpTableAt = tableAt + listCount * 4;
  const countsAt = bpTableAt + bpCount * 4, bpCountsAt = countsAt + listCount;
  let cursor = align4(bpCountsAt + bpCount);
  const listAt = shops.map((items) => { const at = cursor; cursor = align4(cursor + items.length * 2); return at; });
  const bpAt = bpShops.map((items) => { const at = cursor; cursor += items.length * BP_ENTRY_SIZE; return at; });
  const code = new Uint8Array(Math.max(cursor, 4));
  code.set([0x50, 0x57, 0x4d, 0x54, 1, listCount, bpCount, 0], 0);
  shops.forEach((items, index) => {
    code[countsAt + index] = items.length;
    items.forEach((item, n) => writeU16(code, listAt[index]! + n * 2, item));
  });
  bpShops.forEach((items, index) => {
    code[bpCountsAt + index] = items.length;
    items.forEach((entry, n) => { writeU16(code, bpAt[index]! + n * BP_ENTRY_SIZE, entry.itemId); writeU32(code, bpAt[index]! + n * BP_ENTRY_SIZE + 4, entry.price); });
  });
  const symbols: RpmSymbol[] = [];
  const relocations: RpmRelocation[] = [];
  const symbol = (name: string, address: number, size: number) => { symbols.push({ name, address, size, type: "VALUE", attributes: 0 }); return symbols.length - 1; };
  const overlay = String(BW1_MART_OVERLAY);
  relocations.push({ target: { module: overlay, address: layout.pool + 4, type: "OFFSET" }, sourceSymbolIndex: symbol("MartTable", tableAt, listCount * 4) });
  relocations.push({ target: { module: overlay, address: layout.pool + 12, type: "OFFSET" }, sourceSymbolIndex: symbol("MartCounts", countsAt, listCount) });
  relocations.push({ target: { module: overlay, address: layout.bpPool, type: "OFFSET" }, sourceSymbolIndex: symbol("BpTable", bpTableAt, bpCount * 4) });
  relocations.push({ target: { module: overlay, address: layout.bpPool + 4, type: "OFFSET" }, sourceSymbolIndex: symbol("BpCounts", bpCountsAt, bpCount) });
  shops.forEach((items, index) => relocations.push({ target: { module: "base", address: tableAt + index * 4, type: "OFFSET" }, sourceSymbolIndex: symbol(`Mart${index}`, listAt[index]!, items.length * 2) }));
  bpShops.forEach((items, index) => relocations.push({ target: { module: "base", address: bpTableAt + index * 4, type: "OFFSET" }, sourceSymbolIndex: symbol(`BpMart${index}`, bpAt[index]!, items.length * BP_ENTRY_SIZE) }));
  const rpm: RpmModule = {
    code, bssSize: 0, baseAddress: 0, symbols, relocations,
    metadata: { PMCGameID: version, PMCModulePriority: 4, PMCVersion: DLL_VERSION, PokewebMarts: 1 },
  };
  return writeRpm(rpm, { ident: "DLXF" });
}

export function parseBw1MartDll(bytes: Uint8Array): { shops: number[][]; bpShops: Bw1BpEntry[][] } {
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  const code = rpm.code;
  if (rpm.metadata.PokewebMarts !== 1 || code[0] !== 0x50 || code[1] !== 0x57 || code[2] !== 0x4d || code[3] !== 0x54) throw new Error("Not a Pokeweb mart module.");
  const listCount = code[5]!, bpCount = code[6]!;
  const tableAt = 8, bpTableAt = tableAt + listCount * 4, countsAt = bpTableAt + bpCount * 4, bpCountsAt = countsAt + listCount;
  const target = (slot: number) => {
    const relocation = rpm.relocations.find((entry) => entry.target.module === "base" && entry.target.address === slot && entry.target.type === "OFFSET");
    const source = relocation && rpm.symbols[relocation.sourceSymbolIndex];
    if (!source) throw new Error("The mart module is missing a list pointer.");
    return source.address;
  };
  const shops = Array.from({ length: listCount }, (_unused, index) => {
    const at = target(tableAt + index * 4);
    return Array.from({ length: code[countsAt + index]! }, (_item, n) => readU16(code, at + n * 2));
  });
  const bpShops = Array.from({ length: bpCount }, (_unused, index) => {
    const at = target(bpTableAt + index * 4);
    return Array.from({ length: code[bpCountsAt + index]! }, (_item, n) => ({ itemId: readU16(code, at + n * BP_ENTRY_SIZE), price: readU32(code, at + n * BP_ENTRY_SIZE + 4) }));
  });
  return { shops, bpShops };
}

/** True for a generated module whose four overlay-21 targets match this ROM's literal pools. */
export function isBw1MartModule(rpm: RpmModule, layout: Bw1MartLayout): boolean {
  const external = rpm.relocations.filter((entry) => entry.target.module !== "base").map((entry) => `${entry.target.module}:${entry.target.address}:${entry.target.type}`).sort();
  const expected = [layout.pool + 4, layout.pool + 12, layout.bpPool, layout.bpPool + 4].map((address) => `${BW1_MART_OVERLAY}:${address}:OFFSET`).sort();
  return rpm.metadata.PokewebMarts === 1 && JSON.stringify(external) === JSON.stringify(expected);
}

// ---------- Storage ----------

function save(project: ProjectState, data: Bw1MartData, _changed: { martId?: number; bpIndex?: number }): void {
  if (!data.expanded) { writeInPlace(project, data); return; }
  const version = bw1MartVersion(project)!;
  openRom(project);
  assertNoConflict(project, data.layout, version);
  const bytes = buildBw1MartDll(version, data.layout, data.shops, data.bpShops);
  stageCodeInjectionDll(project, bw1MartDllPath(version).slice("patches/".length), bytes, "patches", project.originalRomBytes);
}

function writeInPlace(project: ProjectState, data: Bw1MartData): void {
  const current = overlayBytes(project);
  const bytes = current.slice();
  const at = (address: number) => address - data.layout.base;
  data.layout.lists.forEach((list, index) => {
    const items = data.shops[index] ?? [];
    if (items.length > list.capacity) throw new Error(`Mart ${index} holds at most ${list.capacity} items without expansion.`);
    bytes[at(data.layout.counts) + index] = items.length;
    for (let n = 0; n < list.capacity; n += 1) writeU16(bytes, at(list.address) + n * 2, items[n] ?? 0);
  });
  data.layout.bpLists.forEach((list, index) => {
    const items = data.bpShops[index] ?? [];
    if (items.length > list.capacity) throw new Error(`BP shop ${index} holds at most ${list.capacity} items without expansion.`);
    bytes[at(data.layout.bpCounts) + index] = items.length;
    for (let n = 0; n < list.capacity; n += 1) {
      const entry = items[n];
      writeU32(bytes, at(list.address) + n * BP_ENTRY_SIZE, entry?.itemId ?? 0);
      writeU32(bytes, at(list.address) + n * BP_ENTRY_SIZE + 4, entry?.price ?? 0);
    }
  });
  if (current.every((byte, index) => byte === bytes[index])) return;
  project.overlays[BW1_MART_OVERLAY] = bytes;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(BW1_MART_OVERLAY)) project.patches.dirtyOverlayIds.push(BW1_MART_OVERLAY);
}

const layoutCache = new WeakMap<Uint8Array, Bw1MartLayout | Error>();
function readLayout(project: ProjectState): Bw1MartLayout {
  const rom = openRom(project);
  if (!rom) throw new Error("Reload the ROM to edit BW1 marts.");
  let layout = layoutCache.get(project.originalRomBytes!);
  if (!layout) {
    try {
      const info = getOverlayInfo(project, rom, BW1_MART_OVERLAY);
      // The original image: lists never move, and capacities come from retail sizes.
      const original = rom.loadArm9Overlays([BW1_MART_OVERLAY]).get(BW1_MART_OVERLAY)?.data;
      if (!info || !original) throw new Error("Overlay 21 is missing.");
      layout = locateBw1MartTables(original, info.ramAddress);
    } catch (error) {
      layout = error instanceof Error ? error : new Error(String(error));
    }
    layoutCache.set(project.originalRomBytes!, layout);
  }
  if (layout instanceof Error) throw layout;
  return layout;
}

/** Find the shop tables by the shop builder's literal pool: tiers, list table, 0x162, counts. */
export function locateBw1MartTables(overlay: Uint8Array, base: number): Bw1MartLayout {
  const inside = (address: number) => address >= base && address < base + overlay.length;
  const word = (address: number) => readU32(overlay, address - base);
  let pool = -1;
  for (let offset = 0; offset + 16 <= overlay.length; offset += 4) {
    if (readU32(overlay, offset + 8) !== POOL_MARKER) continue;
    const [tiers, table, counts] = [readU32(overlay, offset), readU32(overlay, offset + 4), readU32(overlay, offset + 12)];
    if (inside(tiers) && inside(table) && inside(counts) && inside(word(table))) { pool = base + offset; break; }
  }
  if (pool < 0) throw new Error("Overlay 21 does not contain the Black / White shop tables.");
  const tiers = word(pool), table = word(pool + 4), counts = word(pool + 12);
  const bpPool = pool + BP_POOL_OFFSET, bpTable = word(bpPool), bpCounts = word(bpPool + 4);
  if (!inside(bpTable) || !inside(bpCounts)) throw new Error("Overlay 21 does not contain the Battle Subway shop tables.");
  const lists = RETAIL_COUNTS.map((capacity, index) => ({ address: word(table + index * 4), capacity }));
  const bpLists = RETAIL_BP_COUNTS.map((capacity, index) => ({ address: word(bpTable + index * 4), capacity }));
  if (!inside(word(table + (lists.length - 1) * 4)) || inside(word(table + lists.length * 4))) throw new Error("Overlay 21 has an unexpected number of shop lists.");
  // Retail lists never overlap; refuse a layout where the retail sizes would.
  const spans = [...lists.map((list) => [list.address, list.address + list.capacity * 2]), ...bpLists.map((list) => [list.address, list.address + list.capacity * BP_ENTRY_SIZE])]
    .sort((a, b) => a[0]! - b[0]!);
  if (spans.some((span, index) => !inside(span[0]!) || span[1]! > base + overlay.length || (index > 0 && spans[index - 1]![1]! > span[0]!))) {
    throw new Error("Overlay 21's shop lists do not match the retail layout.");
  }
  if (lists.some((list, index) => overlay[counts - base + index]! > list.capacity)) throw new Error("Overlay 21's shop counts exceed the retail sizes.");
  return { base, pool, tiers, table, counts, bpPool, bpTable, bpCounts, lists, bpLists };
}

function assertNoConflict(project: ProjectState, layout: Bw1MartLayout, version: Bw1MartVersion): void {
  const rom = openRom(project)!;
  const own = bw1MartDllPath(version).toLowerCase();
  const targets = [layout.pool + 4, layout.pool + 12, layout.bpPool, layout.bpPool + 4];
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.path.toLowerCase() === own) continue;
    const bytes = fileBytes(project, rom, entry.path);
    let rpm: RpmModule | undefined;
    try { rpm = bytes ? parseRpm(bytes, { allowedMagics: ["DLXF"] }) : undefined; } catch { rpm = undefined; }
    if (rpm?.relocations.some((relocation) => relocation.target.module === String(BW1_MART_OVERLAY) && targets.some((address) => relocation.target.address < address + 4 && (relocation.target.address & ~1) + 4 > address))) {
      throw new Error(`${entry.fileName} already patches the shop tables.`);
    }
  }
}

function installedModule(project: ProjectState, version: Bw1MartVersion): { path: string; bytes: Uint8Array } | undefined {
  openRom(project);
  const path = bw1MartDllPath(version).toLowerCase();
  const entry = listCodeInjectionDlls(project).find((candidate) => candidate.path.toLowerCase() === path);
  if (!entry) return undefined;
  const bytes = fileBytes(project, openRom(project)!, entry.path);
  return bytes ? { path: entry.path, bytes } : undefined;
}

const overlayCache = new WeakMap<ProjectState, { source: Uint8Array | undefined; bytes: Uint8Array }>();
/** Overlay 21 as export will write it. The decoded stored file is cached until it changes. */
function overlayBytes(project: ProjectState): Uint8Array {
  const staged = project.overlays[BW1_MART_OVERLAY];
  if (staged?.length) return staged;
  const rom = openRom(project)!;
  const fileId = getOverlayInfo(project, rom, BW1_MART_OVERLAY)?.fileId;
  const source = fileId === undefined ? undefined : project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  const cached = overlayCache.get(project);
  if (cached && cached.source === source) return cached.bytes;
  const bytes = getOverlayWorkingBytes(project, rom, BW1_MART_OVERLAY);
  overlayCache.set(project, { source, bytes });
  return bytes;
}

function fileBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const staged = Object.keys(project.fileSystem?.additions ?? {}).find((candidate) => candidate.toLowerCase() === path.toLowerCase());
  if (staged) return project.fileSystem!.additions![staged];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}

const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
/**
 * Browser saves drop `originalRomBytes` from the project after every edit (the
 * ROM is stored separately), so remember the bytes the page attached and put
 * them back whenever the marts need them.
 */
const attachedRom = new WeakMap<ProjectState, Uint8Array>();
function openRom(project: ProjectState): NintendoDSRom | undefined {
  if (project.originalRomBytes) attachedRom.set(project, project.originalRomBytes);
  else if (attachedRom.has(project)) project.originalRomBytes = attachedRom.get(project);
  const bytes = project.originalRomBytes;
  if (!bytes) return undefined;
  let rom = romCache.get(bytes);
  if (!rom) {
    try { rom = new NintendoDSRom(bytes, { fileData: "view" }); } catch { return undefined; }
    romCache.set(bytes, rom);
  }
  return rom;
}

function validateItems(project: ProjectState, items: number[], capacity: number, label: string): void {
  if (items.length > capacity) {
    throw new Error(capacity === BW1_MART_EXPANDED_SLOTS
      ? `${label} can hold at most ${capacity} items.`
      : `${label} holds at most ${capacity} items. Expand inventories to raise every shop to ${BW1_MART_EXPANDED_SLOTS}.`);
  }
  const itemCount = project.texts.banks.items?.length ?? 0xffff;
  for (const item of items) {
    if (!Number.isSafeInteger(item) || item <= 0 || item >= Math.max(itemCount, 1) || item > 0xffff) throw new Error(`Item ${item} is not a valid item.`);
  }
}

function itemName(project: ProjectState, itemId: number): string {
  return project.texts.banks.items?.[itemId] ?? String(itemId);
}

function itemList(project: ProjectState, items: number[]): string {
  return items.map((item) => itemName(project, item)).join(", ") || "None";
}

function align4(value: number): number {
  return (value + 3) & ~3;
}
