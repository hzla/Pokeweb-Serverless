import type { NintendoDSRom } from "../nds/rom";
import { isShopMachine, readBattlePointShop, setBattlePointShop, vendorItemName, type BattlePointShopId } from "../pokeweb/battlePointShopModel";
import {
  getBlackCityOffers, getJoinAvenueGoods, getJoinAvenueShops, joinAvenueServiceChoices, JOIN_AVENUE_CAPACITY, JOIN_AVENUE_SHOP_NAMES,
  setBlackCityOffer, setJoinAvenueOffer, type JoinAvenueEdit, type JoinAvenueOffer, type JoinAvenueShop,
} from "../pokeweb/localShopModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { specialVendorEntries, specialVendorGroups, specialVendorOptions, type SpecialVendorGroup, type SpecialVendorValue } from "../pokeweb/specialVendorModel";
import { escapeHtml } from "./dom";

export type VendorShopPage = "bpShops" | "joinAvenueShops" | "blackCityMarket" | "specialVendors";
type VendorColumn = "Vendor" | "Resident" | "Offer" | "Quantity" | "Price";
const VARIANTS = ["Black", "White", "Black 2", "White 2"];
const BP_SHOP_NAMES = ["Items", "TMs"];

export function renderVendorShopEditor(project: ProjectState, rom: NintendoDSRom, root: HTMLElement, page: VendorShopPage, onDirty: () => void): void {
  let bpShop: BattlePointShopId = 0;
  let shopId: number | undefined;
  let specialGroup: SpecialVendorGroup = "scripts";
  let specialOption = 0;
  let show: () => void;

  const paint = (title: string, controls: string, headings: VendorColumn[], rows: string, editor: string, add: boolean, meta = "") => {
    root.innerHTML = `<div class="item-data mart-data vendor-data"><section class="md-detail">
      <article class="mt-card">
        <header class="td-head fd-head -no-sprite"><div class="td-ident"><div class="td-title"><h1>${title}</h1></div>
          ${meta ? `<div class="fd-subtitle">${meta}</div>` : ""}</div></header>
        ${controls}
        <div class="vendor-stock-header">
          <div class="section-bar">Stock</div>
          ${add ? `<button class="btn sm -g5-add -g5-add-mark" type="button" data-add-offer>Add offer</button>` : ""}
        </div>
        ${editor}
        <div class="vendor-table-scroll">
          <table class="md-table vendor-table">
            <colgroup>${headings.map((heading) => `<col class="vendor-col-${heading.toLowerCase()}">`).join("")}<col class="vendor-col-actions"></colgroup>
            <thead><tr>${headings.map((heading) => `<th scope="col" class="vendor-${heading.toLowerCase()}">${heading}</th>`).join("")}<th scope="col" aria-label="Actions"></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="${headings.length + 1}">No offers</td></tr>`}</tbody>
          </table>
        </div>
      </article>
    </section></div>`;
  };

  const editBP = (slot?: number) => {
    const shop = readBattlePointShop(project, rom, bpShop);
    const editing = slot === undefined ? undefined : shop.entries[slot];
    const bw2 = project.session.baseRom === "BW2";
    const controls = `<div class="vendor-toolbar"><label>Counter ${select("counter", BP_SHOP_NAMES.map((name, index) => [index, name]), bpShop)}</label></div>`;
    const rows = shop.entries.map(({ itemId, price }, index) => `<tr><td class="vendor-offer">${escapeHtml(vendorItemName(project, itemId))}</td><td class="vendor-price">${price.toLocaleString()}&nbsp;BP</td>${actions(index, true)}</tr>`).join("");
    const editor = slot === undefined ? "" : offerForm(itemField(project, editing?.itemId, (id) => bpShop === 0 || isShopMachine(id)), priceField(editing?.price, bpShop === 1 ? 0 : 1, 9999, 1, "Price (BP)"));
    paint("Battle Point Shops", controls, ["Offer", "Price"], rows, editor, shop.entries.length < shop.capacity, bw2 ? "Battle Subway and Pokémon World Tournament" : "Battle Subway");
    root.querySelector<HTMLSelectElement>('[name="counter"]')!.onchange = (event) => {
      bpShop = Number((event.currentTarget as HTMLSelectElement).value) as BattlePointShopId;
      show();
    };
    bindRows(shop.entries.length, editBP, (index) => {
      setBattlePointShop(project, rom, bpShop, shop.entries.filter((_, i) => i !== index));
    });
    if (slot !== undefined) bindForm((fields) => {
      const entries = shop.entries.slice();
      entries[slot] = { itemId: itemId(fields), price: Number(fields.get("price")) };
      setBattlePointShop(project, rom, bpShop, entries);
    });
  };

  const editAvenue = (slot?: number, offerType?: "item" | "service") => {
    const shops = getJoinAvenueShops(project, rom);
    const shop = shops.find((candidate) => candidate.id === shopId) ?? shops.find((candidate) => candidate.kind === 2) ?? shops[0];
    if (!shop) throw new Error("No Join Avenue shop stock was found.");
    shopId = shop.id;
    const goods = getJoinAvenueGoods(project, rom);
    const offers = shop.goodIds.map((id) => goods[id]);
    const editing = slot === undefined ? undefined : offers[slot];
    const types = values(shops, "kind");
    const sameType = shops.filter((choice) => choice.kind === shop.kind);
    const variants = values(sameType, "variant");
    const ranks = values(sameType.filter((choice) => choice.variant === shop.variant), "rank");
    const controls = `<div class="vendor-toolbar">
      <label>Shop ${select("kind", types.map((type) => [type, JOIN_AVENUE_SHOP_NAMES[type]]), shop.kind)}</label>
      <label>Owner’s game ${select("variant", variants.map((id) => [id, VARIANTS[id] ?? `Variant ${id}`]), shop.variant)}</label>
      <label>Rank ${select("rank", ranks.map((rank) => [rank, String(rank)]), shop.rank)}</label>
    </div>`;
    const rows = offers.map((offer, index) => `<tr><td class="vendor-offer">${escapeHtml(offer.label)}</td><td class="vendor-quantity">${offer.kind === 0 ? offer.quantity : "—"}</td><td class="vendor-price">₽${offer.price.toLocaleString()}</td>${actions(index, true)}</tr>`).join("");
    const services = joinAvenueServiceChoices(shop, goods);
    if (editing?.kind && !services.some((service) => service.id === editing.id)) services.unshift(editing);
    const type = offerType ?? ((editing ? editing.kind > 0 : services.length > 0) ? "service" : "item");
    const choosingService = type === "service";
    const template = services.find((service) => service.id === editing?.id) ?? services[0];
    const editor = slot === undefined ? "" : offerForm(
      services.length ? `<label>Offer type ${select("offerType", [[0, "Item"], [1, "Service"]], choosingService ? 1 : 0)}</label>` : "",
      choosingService
        ? `<label>Service ${select("service", services.map(serviceOption), template?.id)}</label>`
        : `${itemField(project, editing?.kind === 0 ? editing.itemId : undefined)}<label>Quantity <input name="quantity" type="number" min="1" max="999" required value="${editing?.kind === 0 ? editing.quantity : 1}"></label>`,
      priceField(editing?.price ?? (choosingService ? template?.price : undefined), 0, 655350, 10, "Price (₽)"));
    paint("Join Avenue", controls, ["Offer", "Quantity", "Price"], rows, editor, offers.length < JOIN_AVENUE_CAPACITY);

    for (const field of ["kind", "variant", "rank"] as const) {
      root.querySelector<HTMLSelectElement>(`[name="${field}"]`)!.onchange = (event) => {
        const value = Number((event.currentTarget as HTMLSelectElement).value);
        const filter = { kind: shop.kind, variant: shop.variant, rank: shop.rank, [field]: value };
        shopId = shops.find((candidate) => candidate.kind === filter.kind && candidate.variant === filter.variant && candidate.rank === filter.rank)?.id
          ?? shops.find((candidate) => candidate.kind === filter.kind && candidate.variant === filter.variant)?.id
          ?? shops.find((candidate) => candidate.kind === filter.kind)?.id;
        show();
      };
    }
    const selector = root.querySelector<HTMLSelectElement>('[name="offerType"]');
    if (selector) selector.onchange = () => editAvenue(slot, selector.value === "1" ? "service" : "item");
    const service = root.querySelector<HTMLSelectElement>('[name="service"]');
    if (service && !editing) service.onchange = () => {
      const price = root.querySelector<HTMLInputElement>('[name="price"]')!;
      price.value = String(goods[Number(service.value)].price);
    };
    bindRows(offers.length, editAvenue, (index) => setJoinAvenueOffer(project, rom, shop.id, index, null));
    if (slot !== undefined) bindForm((fields) => {
      const price = Number(fields.get("price"));
      const edit: JoinAvenueEdit = choosingService ? { price, templateId: Number(fields.get("service")) }
        : { price, itemId: itemId(fields), quantity: Number(fields.get("quantity")) };
      setJoinAvenueOffer(project, rom, shop.id, slot, edit);
    });
  };

  const editCity = (slot?: number) => {
    const offers = getBlackCityOffers(project, rom);
    const editing = slot === undefined ? undefined : offers[slot];
    const rows = offers.map(({ resident, itemId, price }) => `<tr><td class="vendor-resident">${resident + 1}</td><td class="vendor-offer">${escapeHtml(vendorItemName(project, itemId))}</td><td class="vendor-price">₽${price.toLocaleString()}</td>${actions(resident, false)}</tr>`).join("");
    paint("Black City Market", "", ["Resident", "Offer", "Price"], rows,
      editing ? offerForm(itemField(project, editing.itemId), priceField(editing.price, 1, 65535, 1, "Price (₽)")) : "", false);
    bindRows(offers.length, editCity);
    if (editing) bindForm((fields) => setBlackCityOffer(project, rom, editing.resident, itemId(fields), Number(fields.get("price"))));
  };

  const editSpecial = (slot?: number) => {
    const groups = specialVendorGroups(project.session.baseRom === "BW2");
    const context = { project, rom };
    let options: ReturnType<typeof specialVendorOptions> = [];
    let entries: ReturnType<typeof specialVendorEntries> = [];
    let unavailable = "";
    try {
      options = specialVendorOptions(context, specialGroup);
      if (options.length && !options.some(([id]) => id === specialOption)) specialOption = options[0][0];
      entries = specialVendorEntries(context, specialGroup, specialOption);
    } catch (error) { unavailable = error instanceof Error ? error.message : String(error); }
    const editing = slot === undefined ? undefined : entries[slot];
    const controls = `<div class="vendor-toolbar"><label>Vendor group ${select("vendorGroup", groups.map(([, label], i) => [i, label]), groups.findIndex(([id]) => id === specialGroup))}</label>
      ${options.length ? `<label>Table ${select("vendorOption", options.map(([value, label]) => [value, label]), specialOption)}</label>` : ""}</div>`;
    const hasPrices = entries.some((entry) => entry.values.some((value) => value.kind === "price"));
    const headings: VendorColumn[] = hasPrices ? ["Vendor", "Offer", "Price"] : ["Vendor", "Offer"];
    const rows = entries.map((entry, index) => {
      const name = `<td class="vendor-vendor">${escapeHtml(entry.label)}</td>`;
      if (entry.unavailable) return `<tr>${name}<td colspan="${headings.length}">${escapeHtml(entry.unavailable)}</td></tr>`;
      const fields = entry.values.filter((value) => value.kind !== "price").map((field) => {
        const metadata = field.kind === undefined ? ' class="vendor-offer-meta"' : "";
        return `<span${metadata}>${escapeHtml(specialDescription(project, field))}</span>`;
      }).join("");
      const prices = entry.values.filter((value) => value.kind === "price").map(({ value }) => `<div>₽${value.toLocaleString()}</div>`).join("");
      return `<tr>${name}<td class="vendor-offer"><div class="vendor-offer-details">${fields || "—"}</div></td>${hasPrices ? `<td class="vendor-price">${prices || "—"}</td>` : ""}${actions(index, false)}</tr>`;
    }).join("");
    const editor = editing ? offerForm(...editing.values.map((value, i) => specialField(project, value, i))) : "";
    paint("Special Vendors", controls, headings, unavailable ? `<tr><td colspan="${headings.length + 1}">${escapeHtml(unavailable)}</td></tr>` : rows, editor, false);
    root.querySelector<HTMLSelectElement>('[name="vendorGroup"]')!.onchange = (event) => {
      specialGroup = groups[Number((event.currentTarget as HTMLSelectElement).value)][0];
      specialOption = 0;
      show();
    };
    const table = root.querySelector<HTMLSelectElement>('[name="vendorOption"]');
    if (table) table.onchange = () => { specialOption = Number(table.value); show(); };
    bindRows(entries.length, editSpecial);
    if (editing) bindForm((form) => editing.save(editing.values.map((value, i) =>
      value.kind === "item" || value.kind === "species" ? catalogId(form.get(`field${i}`)) : Number(form.get(`field${i}`)))));
  };

  function bindRows(count: number, edit: (slot?: number) => void, remove?: (slot: number) => void) {
    root.querySelector<HTMLButtonElement>("[data-add-offer]")?.addEventListener("click", () => edit(count));
    root.querySelectorAll<HTMLButtonElement>("[data-edit-offer]").forEach((button) => button.onclick = () => edit(Number(button.dataset.editOffer)));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-offer]").forEach((button) => button.onclick = () => {
      try {
        remove?.(Number(button.dataset.removeOffer));
        onDirty();
        show();
      } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    });
  }

  function bindForm(commit: (data: FormData) => void) {
    const form = root.querySelector<HTMLFormElement>(".vendor-form")!;
    form.querySelector<HTMLButtonElement>("[data-cancel-offer]")!.onclick = show;
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        commit(new FormData(form));
        onDirty();
        show();
      } catch (error) {
        form.querySelector<HTMLElement>("[role=alert]")!.textContent = error instanceof Error ? error.message : String(error);
      }
    };
    form.querySelector<HTMLInputElement>('input[name="item"]')?.focus();
  }

  show = () => {
    try {
      if (page === "bpShops") editBP();
      else if (page === "joinAvenueShops") editAvenue();
      else if (page === "specialVendors") editSpecial();
      else editCity();
    } catch (error) {
      root.innerHTML = `<div class="file-system-page"><div class="file-system-empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div></div>`;
    }
  };
  show();
}

function values(shops: JoinAvenueShop[], field: "kind" | "variant" | "rank"): number[] {
  return [...new Set(shops.map((shop) => shop[field]))].sort((a, b) => a - b);
}

function serviceOption(offer: JoinAvenueOffer): [number, string] {
  return [offer.id, offer.label];
}

function select(name: string, options: [number, string][], selected?: number): string {
  return `<select name="${name}">${options.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function actions(index: number, remove: boolean): string {
  return `<td class="mt-actions"><button type="button" class="btn sm -ghost" data-edit-offer="${index}">Edit</button>
    ${remove ? `<button type="button" class="btn sm -ghost" data-remove-offer="${index}" aria-label="Remove offer ${index + 1}">×</button>` : ""}</td>`;
}

function offerForm(...fields: string[]): string {
  return `<form class="vendor-form vendor-toolbar">${fields.join("")}
    <button class="btn sm -default" type="submit">Save offer</button><button class="btn sm -ghost" type="button" data-cancel-offer>Cancel</button>
    <span class="fd-invalid" role="alert"></span></form>`;
}

function itemField(project: ProjectState, selected?: number, filter = (_id: number) => true): string {
  const label = (id: number) => `${vendorItemName(project, id)} (#${id})`;
  const items = (project.texts.banks.items ?? []).map((name, id) => id > 0 && name && filter(id) && `<option value="${escapeHtml(label(id))}"></option>`).filter(Boolean);
  return `<label>Item <input name="item" list="vendor-items" autocomplete="off" required value="${selected ? escapeHtml(label(selected)) : ""}"></label>
    <datalist id="vendor-items">${items.join("")}</datalist>`;
}

function itemId(data: FormData): number {
  return catalogId(data.get("item"));
}

function catalogId(value: FormDataEntryValue | null): number {
  const input = String(value).trim();
  const match = /^(\d+)$|\(#(\d+)\)$/u.exec(input);
  if (!match) throw new Error("Choose an item from the list or enter its ID.");
  return Number(match[1] ?? match[2]);
}

function specialDescription(project: ProjectState, field: SpecialVendorValue): string {
  if (field.kind === "item") return field.value === 0 ? "None" : vendorItemName(project, field.value);
  if (field.kind === "species") return pokemonSpeciesLabel(project, field.value);
  return `${field.label} ${field.value.toLocaleString()}`;
}

function specialField(project: ProjectState, field: SpecialVendorValue, index: number): string {
  const name = `field${index}`;
  if (field.kind !== "item" && field.kind !== "species") return `<label>${escapeHtml(field.label)} <input name="${name}" type="number" min="${field.min}" max="${field.max}" required value="${field.value}"></label>`;
  const labels = field.kind === "item" ? project.texts.banks.items : project.texts.banks.pokedex;
  const options = (labels ?? []).map((label, id) => label && id >= field.min && `<option value="${escapeHtml(`${label} (#${id})`)}"></option>`).filter(Boolean);
  return `<label>${escapeHtml(field.label)} <input name="${name}" list="${name}-choices" required value="${escapeHtml(`${specialDescription(project, field)} (#${field.value})`)}"></label>
    <datalist id="${name}-choices">${options.join("")}</datalist>`;
}

function priceField(value: number | undefined, min: number, max: number, step: number, label: string): string {
  return `<label>${label} <input name="price" type="number" required min="${min}" max="${max}" step="${step}" value="${value ?? ""}"></label>`;
}
