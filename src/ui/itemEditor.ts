import { publicAsset } from "../assetUrl";
import { typeNamesForProject } from "../pokeweb/constants";
import { ITEM_PACKED_FIELDS, getItemCount, getItemRecord, itemMatchesSearch, updateItemField, updateItemPackedField, type ItemRecord } from "../pokeweb/moveItemModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { attachListArrows, changedKeys, installDetailFields, markSelectedRow, patchDetail, refreshEditMarks } from "./detailFields";
import { escapeHtml } from "./dom";
import { installItemEffects, renderItemEffects } from "./itemEffectsEditor";
import { installItemSpriteEditor, renderItemSpriteEditor } from "./itemSpriteEditor";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";
import "../styles/encounterData.css";
import "../styles/itemData.css";

type ItemTab = "data" | "effect" | "sprite";

type ItemEditorState = { itemId: number; tab: ItemTab; search: string; pocket: string };

const editorStates = new WeakMap<ProjectState, ItemEditorState>();

/** Bag pockets, from the field pocket bits of type_attribute. */
const FIELD_POCKETS: Record<number, string> = { 0: "Items", 1: "Medicine", 2: "TMs & HMs", 3: "Berries", 4: "Key items" };
/** Battle bag pocket, from the battle pocket bits of type_attribute. */
const BATTLE_POCKETS: Record<number, string> = { 0: "Not usable", 1: "Poké Balls", 2: "Battle items", 4: "HP/PP restore", 8: "Status restore" };
const NO_NATURAL_GIFT_TYPE = 31;

const STAT_BOOSTS: Array<[label: string, field: string, part: string]> = [
  ["Attack", "hp_atk_boost", "attack_boost"],
  ["Defense", "def_spatk_boost", "defense_boost"],
  ["Sp. Atk", "def_spatk_boost", "sp_atk_boost"],
  ["Sp. Def", "spd_spdef_boost", "sp_def_boost"],
  ["Speed", "spd_spdef_boost", "speed_boost"],
  ["Accuracy", "acc_crit_pp_boost", "accuracy_boost"],
  ["Critical hit", "acc_crit_pp_boost", "critical_boost"],
];

const EV_ROWS: Array<[label: string, field: string, flag: string]> = [
  ["HP", "hp_ev_gain", "hp_ev"],
  ["Attack", "atk_ev_gain", "attack_ev"],
  ["Defense", "def_ev_gain", "defense_ev"],
  ["Sp. Atk", "spatk_ev_gain", "sp_atk_ev"],
  ["Sp. Def", "spdef_ev_gain", "sp_def_ev"],
  ["Speed", "spd_ev_gain", "speed_ev"],
];

const FRIENDSHIP_ROWS: Array<[label: string, field: string, flag: string]> = [
  ["Low friendship", "battle_happiness", "friendship_low"],
  ["Mid friendship", "ow_happiness", "friendship_mid"],
  ["High friendship", "hold_happiness", "friendship_high"],
];

const CURES: Array<[label: string, part: string]> = [
  ["Sleep", "sleep"], ["Poison", "poison"], ["Burn", "burn"], ["Freeze", "freeze"],
  ["Paralysis", "paralysis"], ["Confusion", "confusion"], ["Infatuation", "infatuation"], ["Ability Guard", "ability_guard"],
];

export function renderItemEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const count = getItemCount(project);
  const state = editorStates.get(project) ?? { itemId: 1, tab: "data" as ItemTab, search: "", pocket: "" };
  editorStates.set(project, state);
  if (state.itemId >= count || state.itemId < 1) state.itemId = count > 1 ? 1 : 0;
  if (state.tab !== "data" && !["BW","BW2"].includes(project.session.baseRom)) state.tab = "data";
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";
  // Item 0 is the game's "None" placeholder.
  const ids = Array.from({ length: Math.max(0, count - 1) }, (_unused, index) => index + 1);

  root.innerHTML = `
    <div class="item-data" id="item-data">
      <aside class="md-list" aria-label="Items">
        <div class="md-filters">
          <input class="md-search" id="item-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search items" autocomplete="off" spellcheck="false" aria-label="Search items">
          <select data-item-pocket aria-label="Pocket">
            <option value="">All pockets</option>
            ${Object.entries(FIELD_POCKETS).map(([value, label]) => `<option value="${value}"${state.pocket === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="md-rows" id="item-list" role="listbox" aria-label="Items" tabindex="0">
          ${ids.map((id) => renderItemRow(project, id)).join("")}
        </div>
      </aside>
      <section class="md-detail" id="item-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#item-list")!;
  const detail = root.querySelector<HTMLElement>("#item-detail")!;
  const searchInput = root.querySelector<HTMLInputElement>("#item-search")!;
  const pocketSelect = root.querySelector<HTMLSelectElement>("[data-item-pocket]")!;

  const filter = () => {
    list.querySelectorAll<HTMLElement>("[data-item]").forEach((row) => {
      let show = !state.pocket || row.dataset.pocket === state.pocket;
      if (show && state.search.trim()) show = itemMatchesSearch(getItemRecord(project, Number(row.dataset.item)), state.search);
      row.style.display = show ? "" : "none";
    });
  };

  const refreshRow = (id: number) => {
    const row = list.querySelector<HTMLElement>(`[data-item="${id}"]`);
    if (!row) return;
    const template = document.createElement("template");
    template.innerHTML = renderItemRow(project, id).trim();
    const next = template.content.firstElementChild as HTMLElement;
    next.classList.toggle("is-selected", row.classList.contains("is-selected"));
    next.setAttribute("aria-selected", row.getAttribute("aria-selected") ?? "false");
    next.style.display = row.style.display;
    row.replaceWith(next);
  };

  const html = () => renderItemDetail(project, state.itemId, state.tab);
  const install = (scope: HTMLElement) => {
    installDetailFields(scope, { autofills: {}, commit });
    installItemSpriteEditor(scope, project, state.itemId, () => { onDirty?.(); refreshRow(state.itemId); marks(); });
    installItemEffects(scope, project, () => {
      onDirty?.();
      refreshRow(state.itemId);
      marks();
    });
  };
  const marks = () => refreshEditMarks(detail, changedKeys(project.actionChangelog?.entries, `item:${state.itemId}:`));
  const render = () => {
    detail.innerHTML = html();
    install(detail);
    marks();
  };
  const refresh = () => {
    patchDetail(detail, html(), install);
    marks();
  };

  function commit(field: HTMLElement, value: string | boolean): boolean {
    const name = field.dataset.fieldName ?? "";
    const [itemField, part] = name.split(".");
    try {
      if (part) updateItemPackedField(project, state.itemId, itemField, part, value);
      else updateItemField(project, state.itemId, itemField, String(value));
      onDirty?.();
      refreshRow(state.itemId);
      window.setTimeout(refresh, 0);
      return true;
    } catch (error) {
      field.title = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  const select = (id: number, scroll = false) => {
    state.itemId = id;
    markSelectedRow(list, "[data-item]", (row) => Number(row.dataset.item) === id, scroll);
    render();
    detail.scrollTop = 0;
  };

  detail.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-item-tab]");
    if (tab) {
      state.tab = tab.dataset.itemTab as ItemTab;
      render();
    }
  });
  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".item-native-effects")) return;
    if (target instanceof HTMLSelectElement && target.dataset.fieldName) {
      if (!commit(target, target.value)) refresh();
    } else if (target instanceof HTMLInputElement && target.type === "checkbox" && target.dataset.fieldName) {
      if (!commit(target, target.checked)) refresh();
    }
  });

  searchInput.addEventListener("input", () => {
    window.clearTimeout(Number(searchInput.dataset.timer));
    searchInput.dataset.timer = String(window.setTimeout(() => {
      state.search = searchInput.value;
      filter();
    }, 160));
  });
  pocketSelect.addEventListener("change", () => {
    state.pocket = pocketSelect.value;
    filter();
  });
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-item]");
    if (row) select(Number(row.dataset.item));
  });
  attachListArrows(list, "[data-item]", (row) => select(Number(row.dataset.item), true));

  filter();
  select(state.itemId, true);
}

// ---------- List ----------

function itemName(item: ItemRecord): string {
  return String(item.readable.name ?? `Item ${item.id}`);
}

function itemIcon(name: string, className: string): string {
  const slug = name.normalize("NFKD").replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
  return `<img class="${className}" src="${publicAsset(`images/item_sprites/${slug}.png`)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`;
}

/** The game stores prices divided by 10. */
function itemPrice(item: ItemRecord): number {
  return Number(item.raw.market_value ?? 0) * 10;
}

function part(item: ItemRecord, offset: number, size: number): number {
  return (Number(item.raw.type_attribute ?? 0) >> offset) & ((1 << size) - 1);
}

function renderItemRow(project: ProjectState, id: number): string {
  const item = getItemRecord(project, id);
  const edits = (project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(`item:${id}:`)).length;
  const price = itemPrice(item);
  return `
    <div class="md-row it-row" role="option" aria-selected="false" data-item="${id}" data-pocket="${part(item, 7, 4)}">
      <span class="md-row-id">${id}</span>
      ${itemIcon(itemName(item), "it-row-icon")}
      <span class="md-row-name">${escapeHtml(itemName(item))}${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
      <span class="it-row-price">${price ? `₽${price.toLocaleString("en-US")}` : ""}</span>
    </div>
  `;
}

// ---------- Detail ----------

function renderItemDetail(project: ProjectState, id: number, tab: ItemTab): string {
  const item = getItemRecord(project, id);
  const name = itemName(item);
  const price = itemPrice(item);
  const pocket = FIELD_POCKETS[part(item, 7, 4)] ?? `Pocket ${part(item, 7, 4)}`;
  const hasEffects = ["BW","BW2"].includes(project.session.baseRom);
  const tabButton = (key: ItemTab, label: string) => `<button class="uv-tab" type="button" role="tab" data-item-tab="${key}" aria-selected="${tab === key}">${label}</button>`;
  return `
    <article class="item-card it-card" data-index="${id}">
      <header class="td-head fd-head">
        <div class="td-sprite it-sprite">${itemIcon(name, "it-head-icon")}</div>
        <div class="td-ident">
          <div class="td-title"><h1>${escapeHtml(name)}</h1><span class="td-num">#${id}</span></div>
          <div class="fd-subtitle" data-derived="subtitle">${escapeHtml(pocket)}${price ? ` · ₽${price.toLocaleString("en-US")}, sells for ₽${Math.floor(price / 2).toLocaleString("en-US")}` : ""}</div>
        </div>
      </header>
      ${hasEffects ? `<div class="md-tabs" role="tablist" aria-label="Item editor">${tabButton("data", "Data")}${tabButton("effect", "Held effect")}${tabButton("sprite", "Sprite")}</div>` : ""}
      ${tab === "effect" && hasEffects ? `<div class="it-effect">${renderItemEffects(project, id)}</div>` : tab === "sprite" && hasEffects ? renderItemSpriteEditor() : renderDataPanel(project, item)}
    </article>
  `;
}

function renderDataPanel(project: ProjectState, item: ItemRecord): string {
  const types = typeNamesForProject(project);
  const giftType = part(item, 0, 5);
  const battlePocket = part(item, 11, 5);
  const fieldPocket = part(item, 7, 4);
  const options = (entries: Array<[number, string]>, current: number) => {
    const all = entries.some(([value]) => value === current) ? entries : [...entries, [current, `Value ${current}`] as [number, string]];
    return all.map(([value, label]) => `<option value="${value}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  };
  return `
    <div class="it-grid">
      <section>
        <div class="section-bar">Bag and shop</div>
        <div class="md-form">
          ${row("Price", "market_value", `${num("market_value", item, 65535)}<span class="md-unit" data-derived="sell">${itemPrice(item) ? `× 10 = ₽${itemPrice(item).toLocaleString("en-US")}` : ""}</span>`)}
          ${row("Pocket", "type_attribute", `<select data-field-name="type_attribute.field_pocket">${options(Object.entries(FIELD_POCKETS).map(([value, label]) => [Number(value), label]), fieldPocket)}</select>`)}
          ${row("Battle pocket", "type_attribute", `<select data-field-name="type_attribute.battle_pocket">${options(Object.entries(BATTLE_POCKETS).map(([value, label]) => [Number(value), label]), battlePocket)}</select>`)}
          ${row("Sort order", "name_order_id", num("name_order_id", item))}
          ${row("Item type", "item_type", num("item_type", item))}
        </div>
        <div class="td-checks">
          ${check("Key item", "type_attribute", "type_attribute.important_item", part(item, 5, 1) > 0)}
          ${check("Can be registered", "type_attribute", "type_attribute.register_button", part(item, 6, 1) > 0)}
        </div>
      </section>
      <section>
        <div class="section-bar">Use</div>
        <div class="md-form">
          ${row("Field use", "item_group", num("item_group", item))}
          ${row("Battle use", "battle_item_group", num("battle_item_group", item))}
          ${row("Work type", "usability_flag", num("usability_flag", item))}
          ${row("Consumed", "consumable_flag", num("consumable_flag", item))}
          ${row("Effect param", "gain_values", num("gain_values", item))}
        </div>
      </section>
      <section>
        <div class="section-bar">Held, Fling and Natural Gift</div>
        <div class="md-form">
          ${row("Held effect", "battle_flags", num("battle_flags", item))}
          ${row("Pluck effect", "berry_flags", num("berry_flags", item))}
          ${row("Fling effect", "held_flags", num("held_flags", item))}
          ${row("Fling power", "unknown_flag_1", num("unknown_flag_1", item))}
          ${row("Gift power", "nature_gift_power", num("nature_gift_power", item))}
          ${row("Gift type", "type_attribute", `<select data-field-name="type_attribute.natural_gift_type">${options([[NO_NATURAL_GIFT_TYPE, "None"], ...types.map((type, index) => [index, type] as [number, string])], giftType)}</select>`)}
        </div>
      </section>
    </div>
    <div class="it-grid">
      <section>
        <div class="section-bar md-gap">Healing</div>
        <div class="md-form">
          ${row("HP restored", "hp_gain", num("hp_gain", item))}
          ${row("PP restored", "pp_gain", num("pp_gain", item))}
        </div>
        <div class="td-checks it-checks">
          ${packedCheck(item, "pp_flags", "hp_recovery", "Restores HP")}
          ${packedCheck(item, "pp_flags", "pp_recovery", "Restores PP")}
          ${packedCheck(item, "pp_flags", "all_pp_recovery", "Restores all moves' PP")}
          ${packedCheck(item, "hp_atk_boost", "revive", "Revives")}
          ${packedCheck(item, "hp_atk_boost", "revive_all", "Revives whole party")}
          ${packedCheck(item, "hp_atk_boost", "level_up", "Levels up")}
          ${packedCheck(item, "hp_atk_boost", "evolution", "Evolution item")}
          ${packedCheck(item, "acc_crit_pp_boost", "pp_up", "PP Up")}
          ${packedCheck(item, "acc_crit_pp_boost", "pp_max", "PP Max")}
        </div>
      </section>
      <section>
        <div class="section-bar md-gap">Cures</div>
        <div class="td-checks it-checks">
          ${CURES.map(([label, key]) => packedCheck(item, "status_removal_flag", key, label)).join("")}
        </div>
      </section>
      <section>
        <div class="section-bar md-gap">Stat boosts</div>
        <table class="md-table it-table">
          <thead><tr><th>Stat</th><th class="r">Stages</th></tr></thead>
          <tbody>${STAT_BOOSTS.map(([label, field, key]) => `<tr data-mark-fields="${field}"><td>${label}</td><td class="r">${packedNum(item, field, key)}</td></tr>`).join("")}</tbody>
        </table>
      </section>
    </div>
    <div class="it-grid">
      <section>
        <div class="section-bar md-gap">EVs</div>
        <table class="md-table it-table">
          <thead><tr><th>Stat</th><th class="r">Gain</th><th class="r">Applies</th></tr></thead>
          <tbody>${EV_ROWS.map(([label, field, flag]) => `<tr data-mark-fields="${field}|pp_flags"><td>${label}</td><td class="r">${num(field, item)}</td><td class="r">${packedBox(item, "pp_flags", flag, `${label} EV applies`)}</td></tr>`).join("")}</tbody>
        </table>
        <div class="td-checks">${packedCheck(item, "pp_flags", "ev_limit_check", "Checks the EV limit")}</div>
      </section>
      <section>
        <div class="section-bar md-gap">Friendship</div>
        <table class="md-table it-table">
          <thead><tr><th>Friendship</th><th class="r">Change</th><th class="r">Applies</th></tr></thead>
          <tbody>${FRIENDSHIP_ROWS.map(([label, field, flag]) => `<tr data-mark-fields="${field}|pp_flags"><td>${label}</td><td class="r">${num(field, item)}<span class="md-unit it-signed" data-derived="signed-${field}">${signed(item.raw[field])}</span></td><td class="r">${packedBox(item, "pp_flags", flag, `${label} applies`)}</td></tr>`).join("")}</tbody>
        </table>
      </section>
      <section></section>
    </div>
  `;
}

/** Friendship changes are signed bytes: show 251 as −5. */
function signed(value: unknown): string {
  const n = Number(value ?? 0);
  return n > 127 ? `= ${n - 256}` : "";
}

function row(label: string, markField: string, value: string): string {
  return `<span class="md-label" data-mark-fields="${markField}">${escapeHtml(label)}</span><span class="md-value">${value}</span>`;
}

function num(field: string, item: ItemRecord, max = 255): string {
  return `<div autocorrect="off" spellcheck="false" contenteditable="true" data-narc="item" data-field-name="${field}" data-type="int-${max}">${escapeHtml(String(item.raw[field] ?? 0))}</div>`;
}

function packedPart(field: string, key: string): { offset: number; size: number } {
  const part = ITEM_PACKED_FIELDS[field]?.find((candidate) => candidate.key === key);
  if (!part) throw new Error(`Unknown item field part: ${field}.${key}`);
  return part;
}

function packedValue(item: ItemRecord, field: string, key: string): number {
  const { offset, size } = packedPart(field, key);
  return (Number(item.raw[field] ?? 0) >> offset) & ((1 << size) - 1);
}

function packedNum(item: ItemRecord, field: string, key: string): string {
  return `<div autocorrect="off" spellcheck="false" contenteditable="true" data-narc="item-part" data-field-name="${field}.${key}" data-type="int-${(1 << packedPart(field, key).size) - 1}">${packedValue(item, field, key)}</div>`;
}

function packedBox(item: ItemRecord, field: string, key: string, label: string): string {
  return `<input type="checkbox" data-field-name="${field}.${key}" aria-label="${escapeHtml(label)}"${packedValue(item, field, key) ? " checked" : ""}>`;
}

function packedCheck(item: ItemRecord, field: string, key: string, label: string): string {
  return `<label class="md-check td-check" data-mark-fields="${field}">${packedBox(item, field, key, label)}<span>${escapeHtml(label)}</span></label>`;
}

function check(label: string, markField: string, name: string, checked: boolean): string {
  return `<label class="md-check td-check" data-mark-fields="${markField}"><input type="checkbox" data-field-name="${name}"${checked ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`;
}
