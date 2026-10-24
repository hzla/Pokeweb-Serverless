export const MAX_SHOPS = 16;
export const MAX_STOCK = 45;
export const MAX_SAVE_FLAG = 0xbf3;
export type StockCondition = {
  /** At least this many native trainer badges, from zero through eight. */
  badges?: number;
  flag?: { id: number; state: "set" | "clear" };
};
export type StockEntry = { item: number; cost: number; condition?: StockCondition };
export type Shop = {
  id: number;
  name: string;
  /** Zero means Poké Dollars; another ID means that stackable bag item. */
  currency: number;
  inventory: StockEntry[];
};
export type Document = { version: 1; nextId: number; shops: Shop[] };
export type Project = { document: Document; applied?: Document };
export const defaults = (): Document => ({ version: 1, nextId: 1, shops: [] });
export function newShop(document: Document): Shop {
  return {
    id: document.nextId++,
    name: "New Shop",
    currency: 0,
    inventory: [{ item: 4, cost: 200 }],
  };
}
export function tmTestShop(document: Document): Shop {
  return {
    id: document.nextId++,
    name: "TM Shop",
    currency: 93,
    inventory: Array.from({ length: 20 }, (_, i) => ({
      item: 328 + i,
      cost: i + 1,
    })),
  };
}
