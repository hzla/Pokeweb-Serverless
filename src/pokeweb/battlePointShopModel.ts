import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NintendoDSRom } from "../nds/rom";
import { recordFieldChange } from "./actionChangelog";
import { bw1MartCapacity, readBw1Marts, setBw1BpItems, type Bw1BpEntry } from "./bw1MartModel";
import { getOverlayWorkingBytes } from "./overlayEditModel";
import type { ProjectState } from "./projectStore";

const OVERLAY = 36;
const ENTRY_SIZE = 8;
const CAPACITIES = [42, 18] as const;
const LOAD_TABLES = 0x2d2d4; // Literal pool in ShopUI_LoadBPShopItems.
const BP_LAYOUTS = {
  IREO: { base: 0x0217f600, items: 0x51808, tms: 0x514a8, counts: 0x51318 },
  IRDO: { base: 0x0217f640, items: 0x517fc, tms: 0x5149c, counts: 0x5130c },
};

export type BattlePointShopId = 0 | 1;
export type BattlePointShop = { capacity: number; entries: Bw1BpEntry[] };

export function isShopMachine(itemId: number): boolean {
  return (itemId >= 328 && itemId <= 425) || (itemId >= 618 && itemId <= 620);
}

export function readBattlePointShop(project: ProjectState, rom: NintendoDSRom, shop: BattlePointShopId): BattlePointShop {
  if (project.session.baseRom === "BW") {
    const data = readBw1Marts(project);
    return { capacity: bw1MartCapacity(data, data.shops.length + shop), entries: data.bpShops[shop] };
  }
  const { bytes, counts, offsets } = readBw2Tables(project, rom);
  return {
    capacity: CAPACITIES[shop],
    entries: Array.from({ length: bytes[counts + shop] }, (_, index) => {
      const offset = offsets[shop] + index * ENTRY_SIZE;
      return { itemId: readU16(bytes, offset), price: readU32(bytes, offset + 4) };
    }),
  };
}

export function setBattlePointShop(project: ProjectState, rom: NintendoDSRom, shop: BattlePointShopId, entries: Bw1BpEntry[]): void {
  const before = readBattlePointShop(project, rom, shop);
  const bw2 = project.session.baseRom === "BW2";
  // Only the item counter calculates an affordable quantity by dividing by the price.
  const minimumPrice = shop === 1 ? 0 : 1;
  if (entries.length > before.capacity) throw new Error(`This shop has ${before.capacity} slots.`);
  for (const { itemId, price } of entries) {
    validateVendorItem(project, itemId);
    if (shop === 1 && !isShopMachine(itemId)) throw new Error("Choose a TM or HM.");
    if (!Number.isInteger(price) || price < minimumPrice || price > 9999) throw new Error(`Enter a price from ${minimumPrice} to 9,999 BP.`);
  }
  if (before.entries.length === entries.length && entries.every((entry, i) =>
    entry.itemId === before.entries[i].itemId && entry.price === before.entries[i].price)) return;
  if (!bw2) {
    const data = readBw1Marts(project);
    setBw1BpItems(project, data.shops.length + shop, entries);
    return;
  }

  const { bytes, counts, offsets } = readBw2Tables(project, rom);
  const next = new Uint8Array(bytes);
  next[counts + shop] = entries.length;
  entries.forEach(({ itemId, price }, index) => {
    const offset = offsets[shop] + index * ENTRY_SIZE;
    writeU16(next, offset, itemId);
    writeU32(next, offset + 4, price);
  });
  project.overlays[OVERLAY] = next;
  const patches = project.patches ??= { dirtyOverlayIds: [] };
  if (!patches.dirtyOverlayIds.includes(OVERLAY)) patches.dirtyOverlayIds.push(OVERLAY);
  const describe = (list: Bw1BpEntry[]) => list.map(({ itemId, price }) => `${vendorItemName(project, itemId)} (${price} BP)`).join(", ");
  recordFieldChange(project, "marts", shop === 1 ? "Subway and PWT BP TMs" : "Subway and PWT BP items", "Stock", describe(before.entries), describe(entries), {
    key: `bp-shop:${shop}`,
  });
}

function readBw2Tables(project: ProjectState, rom: NintendoDSRom) {
  const layout = rom.idCode === "IREO" ? BP_LAYOUTS.IREO : rom.idCode === "IRDO" ? BP_LAYOUTS.IRDO : undefined;
  const bytes = getOverlayWorkingBytes(project, rom, OVERLAY);
  if (!layout || bytes.length < LOAD_TABLES + 8 ||
      readU16(bytes, 0x2d254) !== 0x481f || readU16(bytes, 0x2d25e) !== 0x5dc0 ||
      readU32(bytes, LOAD_TABLES + 4) !== layout.base + layout.counts) {
    throw new Error("This ROM's BP shops use an unsupported overlay 36 layout.");
  }
  const pointers = readU32(bytes, LOAD_TABLES) - layout.base;
  if (pointers !== 0x55b60 || pointers + 8 > bytes.length ||
      readU32(bytes, pointers) !== layout.base + layout.items || readU32(bytes, pointers + 4) !== layout.base + layout.tms ||
      bytes[layout.counts] > CAPACITIES[0] || bytes[layout.counts + 1] > CAPACITIES[1]) {
    throw new Error("This ROM's BP shops use an unsupported overlay 36 layout.");
  }
  return { bytes, counts: layout.counts, offsets: [layout.items, layout.tms] as const };
}

export function validateVendorItem(project: ProjectState, itemId: number): void {
  const count = project.narcs.items?.fileCount ?? project.texts.banks.items?.length ?? 0;
  if (!Number.isInteger(itemId) || itemId < 1 || itemId >= count || itemId > 0xffff) throw new Error("Choose an item from this ROM.");
}

export function vendorItemName(project: ProjectState, itemId: number): string {
  return project.texts.banks.items?.[itemId] || `Item ${itemId}`;
}
