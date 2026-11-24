import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { recordFieldChange } from "./actionChangelog";
import { validateVendorItem, vendorItemName } from "./battlePointShopModel";
import { ensureFileSystemState } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";
import { cleanDisplayText, decodeGen5TextBank } from "./text";

const AVENUE_ARCHIVE = "a/2/4/4";
const AVENUE_SHOPS = 1;
const AVENUE_GOODS = 2;
const AVENUE_MENU_TEXT = 609;
const SHOP_ROW = 50;
const GOODS_ROW = 20;
const FIRST_GOOD = 18;
const NO_GOOD = 0xffff;
export const JOIN_AVENUE_CAPACITY = 16;
export const JOIN_AVENUE_SHOP_NAMES = ["Raffle Shop", "Beauty Salon", "Market", "Flower Shop", "Dojo", "Nursery", "Antique Shop", "Café"];
// Native service types accepted by each shop's script. The item's native menu
// handles ordinary goods directly, while services pass their payload to scripts.
const SERVICE_TYPES: readonly (readonly number[])[] = [[], [1, 12, 13, 14, 15, 16, 17], [], [], [2, 3, 4, 5, 6, 7, 8], [26], [11], [1, 2, 3, 4, 5, 6, 7, 8]];

const CITY_ARCHIVE = "a/1/5/4";
const CITY_RESIDENTS = 30;
const CITY_RESIDENT_SIZE = 0x30;
const CITY_ITEM = 0x28;
const CITY_PRICE = 0x2a;

export type JoinAvenueShop = { id: number; kind: number; variant: number; rank: number; goodIds: number[] };
export type JoinAvenueOffer = { id: number; kind: number; itemId: number; quantity: number; price: number; label: string };
export type JoinAvenueEdit = { price: number } & ({ itemId: number; quantity: number } | { templateId: number });

export function getJoinAvenueShops(project: ProjectState, rom: NintendoDSRom): JoinAvenueShop[] {
  const { shops, goods } = openAvenue(project, rom);
  // Row zero is the fallback. The Raffle Shop's stock is a free draw, driven by its own script and prize table.
  return Array.from({ length: shops.length / SHOP_ROW - 1 }, (_, index) => readAvenueShop(shops, goods, index + 1))
    .filter((shop) => shop.kind > 0 && shop.kind < JOIN_AVENUE_SHOP_NAMES.length);
}

export function getJoinAvenueGoods(project: ProjectState, rom: NintendoDSRom): JoinAvenueOffer[] {
  const { goods } = openAvenue(project, rom);
  const rawText = project.narcs.story_texts?.rawFiles[AVENUE_MENU_TEXT];
  const texts = project.texts.storyTexts?.[AVENUE_MENU_TEXT] ?? (rawText?.length ? decodeGen5TextBank(rawText) : readAvenueText(rom));
  return Array.from({ length: goods.length / GOODS_ROW }, (_, id) => {
    const offset = id * GOODS_ROW;
    const kind = readU16(goods, offset + 10);
    const itemId = readU16(goods, offset + 12);
    const textId = readU16(goods, offset + 4);
    const customName = readU16(goods, offset + 2) && cleanDisplayText(texts[textId]?.[1] ?? "").trim();
    return {
      id, kind, itemId,
      quantity: readU16(goods, offset + 14),
      price: readU16(goods, offset + 8) * 10,
      label: customName || (kind === 0 ? vendorItemName(project, itemId) : `Service ${kind} · Offer ${id}`),
    };
  });
}

export function joinAvenueServiceChoices(shop: JoinAvenueShop, goods: JoinAvenueOffer[]): JoinAvenueOffer[] {
  const types = SERVICE_TYPES[shop.kind] ?? [];
  const distinct = new Map<string, JoinAvenueOffer>();
  for (const good of goods) {
    if (!types.includes(good.kind)) continue;
    const key = JSON.stringify([good.kind, good.itemId, good.quantity, good.label]);
    if (!distinct.has(key)) distinct.set(key, good);
  }
  return [...distinct.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function setJoinAvenueOffer(project: ProjectState, rom: NintendoDSRom, shopId: number, slot: number, edit: JoinAvenueEdit | null): void {
  const { archive, fileId, shops, goods } = openAvenue(project, rom);
  const shop = readAvenueShop(shops, goods, shopId);
  const currentId = shop.goodIds[slot];
  if (shop.kind < 1 || shop.kind > 7 || !Number.isInteger(slot) || slot < 0 || slot >= JOIN_AVENUE_CAPACITY ||
      slot > shop.goodIds.length || (edit === null && currentId === undefined)) throw new Error("This Join Avenue stock slot is unavailable.");
  const nextIds = [...shop.goodIds];
  if (edit === null) nextIds.splice(slot, 1);
  else {
    if (!Number.isInteger(edit.price) || edit.price < 0 || edit.price > 655350 || edit.price % 10 !== 0) {
      throw new Error("Enter a price from 0 to 655,350 in multiples of 10.");
    }
    const row = newAvenueGood(project, shop, goods, currentId, edit);
    if (currentId !== undefined && row.every((byte, index) => byte === goods[currentId * GOODS_ROW + index])) return;
    const rowCount = goods.length / GOODS_ROW;
    let id = 0;
    while (id < rowCount && !row.every((byte, index) => byte === goods[id * GOODS_ROW + index])) id++;
    if (id === rowCount) {
      // A new ID must never turn an old end-of-list reference into a sale.
      if (id >= NO_GOOD || avenueReferences(shops, id)) throw new Error("This ROM has no room for another Join Avenue goods row.");
      const next = new Uint8Array(goods.length + GOODS_ROW);
      next.set(goods);
      next.set(row, goods.length);
      archive.files[AVENUE_GOODS] = next;
    }
    nextIds[slot] = id;
  }

  const nextShops = new Uint8Array(shops);
  for (let index = 0; index < JOIN_AVENUE_CAPACITY; index++) {
    writeU16(nextShops, shopId * SHOP_ROW + FIRST_GOOD + index * 2, nextIds[index] ?? NO_GOOD);
  }
  archive.files[AVENUE_SHOPS] = nextShops;
  ensureFileSystemState(project).replacements[fileId] = archive.save();
  recordFieldChange(project, "marts", `Join Avenue · ${JOIN_AVENUE_SHOP_NAMES[shop.kind]} (variant ${shop.variant + 1}, rank ${shop.rank})`, `Offer ${slot + 1}`,
    currentId === undefined ? "Empty" : describeAvenueGood(project, goods, currentId),
    edit === null ? "Removed" : describeAvenueGood(project, archive.files[AVENUE_GOODS], nextIds[slot]), { key: `join-avenue:${shopId}:${slot}` });
}

function newAvenueGood(project: ProjectState, shop: JoinAvenueShop, goods: Uint8Array, currentId: number | undefined, edit: JoinAvenueEdit): Uint8Array {
  let row: Uint8Array;
  if ("templateId" in edit) {
    if (!Number.isInteger(edit.templateId) || edit.templateId < 0 || edit.templateId >= goods.length / GOODS_ROW) throw new Error("Choose an available service.");
    row = new Uint8Array(goods.subarray(edit.templateId * GOODS_ROW, (edit.templateId + 1) * GOODS_ROW));
    if (edit.templateId !== currentId && !SERVICE_TYPES[shop.kind].includes(readU16(row, 10))) throw new Error("Choose a service for this shop type.");
  } else {
    validateVendorItem(project, edit.itemId);
    if (!Number.isInteger(edit.quantity) || edit.quantity < 1 || edit.quantity > 999) throw new Error("Enter a quantity from 1 to 999.");
    const offset = currentId === undefined ? -1 : currentId * GOODS_ROW;
    row = offset >= 0 && readU16(goods, offset + 10) === 0 ? new Uint8Array(goods.subarray(offset, offset + GOODS_ROW)) : new Uint8Array(GOODS_ROW);
    if (readU16(row, 12) !== edit.itemId || readU16(row, 14) !== edit.quantity) writeU16(row, 2, 0); // Use the new item's text.
    writeU16(row, 12, edit.itemId);
    writeU16(row, 14, edit.quantity);
  }
  writeU16(row, 8, edit.price / 10);
  return row;
}

function describeAvenueGood(project: ProjectState, goods: Uint8Array, id: number): string {
  const offset = id * GOODS_ROW;
  const kind = readU16(goods, offset + 10);
  const description = kind ? `Service ${kind}, offer ${id}` : `${vendorItemName(project, readU16(goods, offset + 12))} ×${readU16(goods, offset + 14)}`;
  return `${description} (₽${readU16(goods, offset + 8) * 10})`;
}

function readAvenueShop(shops: Uint8Array, goods: Uint8Array, id: number): JoinAvenueShop {
  if (!Number.isInteger(id) || id < 1 || id >= shops.length / SHOP_ROW) throw new Error("Choose a Join Avenue shop.");
  const start = id * SHOP_ROW;
  const goodIds: number[] = [];
  for (let slot = 0; slot < JOIN_AVENUE_CAPACITY; slot++) {
    const good = readU16(shops, start + FIRST_GOOD + slot * 2);
    if (good >= goods.length / GOODS_ROW) break;
    goodIds.push(good);
  }
  return { id, kind: readU16(shops, start), variant: readU16(shops, start + 2), rank: readU16(shops, start + 4) + 1, goodIds };
}

function avenueReferences(shops: Uint8Array, good: number): boolean {
  for (let offset = 0; offset < shops.length; offset += SHOP_ROW) {
    for (let slot = 0; slot < JOIN_AVENUE_CAPACITY; slot++) {
      if (readU16(shops, offset + FIRST_GOOD + slot * 2) === good) return true;
    }
  }
  return false;
}

function readAvenueText(rom: NintendoDSRom) {
  const id = rom.filenames.idOf("a/0/0/3");
  const bytes = id === undefined ? undefined : new NARC(rom.files[id]).files[AVENUE_MENU_TEXT];
  return bytes?.length ? decodeGen5TextBank(bytes) : [];
}

function openAvenue(project: ProjectState, rom: NintendoDSRom) {
  if (project.session.baseRom !== "BW2") throw new Error("Join Avenue is available in Black 2 and White 2.");
  const { archive, fileId } = openArchive(project, rom, AVENUE_ARCHIVE);
  const shops = archive.files[AVENUE_SHOPS];
  const goods = archive.files[AVENUE_GOODS];
  if (!shops?.length || shops.length % SHOP_ROW || !goods?.length || goods.length % GOODS_ROW) {
    throw new Error("This ROM's Join Avenue shop tables have an unsupported format.");
  }
  return { archive, fileId, shops, goods };
}

export function getBlackCityOffers(project: ProjectState, rom: NintendoDSRom) {
  const { archive } = openCity(project, rom);
  return archive.files.slice(0, CITY_RESIDENTS).map((row, resident) => ({ resident, itemId: readU16(row, CITY_ITEM), price: readU16(row, CITY_PRICE) }));
}

export function setBlackCityOffer(project: ProjectState, rom: NintendoDSRom, resident: number, itemId: number, price: number): void {
  const { archive, fileId } = openCity(project, rom);
  if (!Number.isInteger(resident) || resident < 0 || resident >= CITY_RESIDENTS) throw new Error("Choose a Black City resident.");
  validateVendorItem(project, itemId);
  if (!Number.isInteger(price) || price < 1 || price > 0xffff) throw new Error("Enter a price from 1 to 65,535.");
  const row = new Uint8Array(archive.files[resident]);
  const oldItem = readU16(row, CITY_ITEM);
  const oldPrice = readU16(row, CITY_PRICE);
  if (itemId === oldItem && price === oldPrice) return;
  writeU16(row, CITY_ITEM, itemId);
  writeU16(row, CITY_PRICE, price);
  archive.files[resident] = row;
  ensureFileSystemState(project).replacements[fileId] = archive.save();
  recordFieldChange(project, "marts", `Black City · Resident ${resident + 1}`, "Offer", `${vendorItemName(project, oldItem)} (₽${oldPrice})`, `${vendorItemName(project, itemId)} (₽${price})`, {
    key: `black-city-shop:${resident}`,
  });
}

function openCity(project: ProjectState, rom: NintendoDSRom) {
  if (project.session.baseRom !== "BW" || project.session.baseVersion !== "B") throw new Error("The resident market is available in Pokémon Black.");
  const result = openArchive(project, rom, CITY_ARCHIVE);
  if (result.archive.files.length < CITY_RESIDENTS || result.archive.files.slice(0, CITY_RESIDENTS).some((row) => row.length !== CITY_RESIDENT_SIZE)) {
    throw new Error("This ROM's Black City resident records have an unsupported format.");
  }
  return result;
}

function openArchive(project: ProjectState, rom: NintendoDSRom, path: string): { archive: NARC; fileId: number } {
  const fileId = rom.filenames.idOf(path);
  if (fileId === undefined) throw new Error(`Shop archive ${path} is missing from this ROM.`);
  return { fileId, archive: new NARC(project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId]) };
}
