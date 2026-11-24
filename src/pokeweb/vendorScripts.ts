// Operands of the retail US BW and BW2 vendor scripts. A site gives the
// command offset, its opcode, then any fixed work operand before the value.
export type VendorScriptSite = readonly [offset: number, opcode: number, work?: number, skipBytes?: number];
export type VendorScriptField = {
  label: string;
  kind: "item" | "species" | "price" | "quantity" | "level";
  sites: readonly VendorScriptSite[];
  text?: { bank: number; entries?: readonly number[] };
};
export type VendorScriptRow = { label: string; member: number; fields: VendorScriptField[] };

const set = (offset: number, work: number): VendorScriptSite => [offset, 0x28, work];
const give = (offset: number): VendorScriptSite => [offset, 0x2a, 0x8000];
const bag = (offset: number): VendorScriptSite => [offset, 0xb7];
const money = (check: number, take: number, result: number): VendorScriptSite[] => [[check, 0xfb, result], [take, 0xfa]];
const field = (label: string, kind: VendorScriptField["kind"], sites: readonly VendorScriptSite[], bank?: number, entries?: readonly number[]): VendorScriptField =>
  ({ label, kind, sites, text: bank === undefined ? undefined : { bank, entries } });
const price = (sites: readonly VendorScriptSite[], bank?: number, entries?: readonly number[]) => field("Price (₽)", "price", sites, bank, entries);
const item = (sites: readonly VendorScriptSite[], bank?: number, entries?: readonly number[]) => field("Item", "item", sites, bank, entries);

export function scriptedVendors(bw2: boolean): VendorScriptRow[] {
  const vendingBank = bw2 ? 664 : 464;
  const vending: VendorScriptRow[] = [0xe9, 0x114, 0x13f].map((offset, i) => ({
    label: `Vending machine · Slot ${i + 1}`, member: bw2 ? 1263 : 887,
    fields: [item([set(offset, 0x8021)], vendingBank, [6 + i]), price([set(offset + 6, 0x8022)], vendingBank, [6 + i])],
  }));
  const cone = bw2 ? 40 : 38;
  const milk = bw2 ? 124 : 110;
  return [...vending, {
    label: "Castelia · Ice cream stand", member: 66,
    fields: [item((bw2 ? [bag(0x22c), give(0x2bc), bag(0xa01), give(0xa85)] : [bag(0x696), give(0x71a), bag(0x772), give(0x7f6)]), cone),
      { ...price(bw2 ? [set(0x1d8, 0x8025), set(0x9ad, 0x8025)] : [set(0x650, 0x8027)], cone), label: "Single price (₽)" },
      ...(bw2 ? [{ ...price([set(0x1fd, 0x8025), set(0x9d2, 0x8025)], cone), label: "Dozen price (₽)" }] : [])],
  }, {
    label: "Driftveil Market · Milk stand", member: 210,
    fields: [item(bw2 ? [bag(0x128), give(0x1e3)] : [bag(0x2fd), give(0x3ac)], milk),
      { ...price([bw2 ? set(0xd4, 0x8022) : set(0x2a9, 0x8027)], milk), label: "Single price (₽)" },
      { ...price([bw2 ? set(0xf9, 0x8022) : set(0x2ce, 0x8027)], milk), label: "Dozen price (₽)" }],
  }, {
    label: "Marvelous Bridge · Pokémon seller", member: 526,
    fields: [field("Pokémon", "species", [[bw2 ? 0x27a : 0x754, 0x10c, 0x8010]], bw2 ? 430 : 279),
      field("Level", "level", [[bw2 ? 0x27a : 0x754, 0x10c, 0x8010, 4]]),
      price(bw2 ? money(0x201, 0x266, 0x8027) : money(0x6db, 0x740, 0x8027), bw2 ? 430 : 279)],
  }, {
    label: "Royal Unova · Ticket", member: 78,
    fields: [price(bw2 ? money(0x2e9, 0x450, 0x8022) : money(0x2fc, 0x478, 0x8022), bw2 ? 46 : 44)],
  }, {
    label: "Move Reminder · Fee", member: bw2 ? 1235 : 859,
    fields: [item([[bw2 ? 0x29e : 0x29c, 0xb8], [bw2 ? 0x457 : 0x453, 0xb6]], bw2 ? 511 : 347, [29, 34]),
      field("Quantity", "quantity", [[bw2 ? 0x29e : 0x29c, 0xb8, undefined, 2], [bw2 ? 0x457 : 0x453, 0xb6, undefined, 2]], bw2 ? 511 : 347, [29, 34])],
  }, ...(bw2 ? bw2OnlyVendors() : [])];
}

function bw2OnlyVendors(): VendorScriptRow[] {
  return [{
    label: "Route 5 · Berry seller", member: 658,
    fields: [price([set(0x534, 0x8026)], 541, [30, 32, 36]), ...Array.from({ length: 6 }, (_, i) =>
      ({ ...item([bag(0x661 + i * 0x21), give(0x7a7 + i * 0x39), [0x553 + i * 0x21, 0x4e, undefined, 1]]), label: `Berry pack ${i + 1}` }))],
  }, {
    label: "Skyarrow Bridge · Drink seller", member: 498,
    fields: [item([bag(0x179), give(0x203)], 415, [0, 1, 2, 8, 9, 10, 11]), price(money(0x181, 0x1e1, 0x8021), 415, [0, 1, 2, 8, 9, 10, 11])],
  }, {
    label: "Shopping Mall Nine · Evening Poké Ball deal", member: 700,
    fields: [item([bag(0x230), give(0x2ba)], 562, [5, 8]), price([set(0x1fb, 0x8022)], 562, [5, 8])],
  }, {
    label: "Shopping Mall Nine · Evening Potion deal", member: 700,
    fields: [item([bag(0x321), give(0x3ab)], 562, [6, 9]), price([set(0x2ec, 0x8022)], 562, [6, 9])],
  }, ...market("Black City", 10, 0x221), ...market("White Forest", 848, 0x328)];
}

function market(name: string, member: number, start: number): VendorScriptRow[] {
  return Array.from({ length: 8 }, (_, index) => {
    const offset = start + Math.floor(index / 2) * 0x8c + (index % 2) * 0x12;
    return { label: `${name} · Stall ${1 + Math.floor(index / 2)} · ${index % 2 ? "Weekdays" : "Weekend"}`, member,
      fields: [item([set(offset, 0x802b)]), price([set(offset + 6, 0x802c)])] };
  });
}
