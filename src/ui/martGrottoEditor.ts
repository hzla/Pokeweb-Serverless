import { publicAsset } from "../assetUrl";
import { getMartAutofills, getMartCount, getMartRecord, martMatchesSearch, updateMartField, type MartRecord } from "../pokeweb/martGrottoModel";
import { getItemRecord } from "../pokeweb/moveItemModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { attachListArrows, changedKeys, installDetailFields, markSelectedRow, patchDetail, refreshEditMarks } from "./detailFields";
import { escapeHtml } from "./dom";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";
import "../styles/encounterData.css";
import "../styles/itemData.css";

const MART_SLOTS = 20;

type MartEditorState = { martId: number; search: string };
const editorStates = new WeakMap<ProjectState, MartEditorState>();

export function renderMartEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const count = getMartCount(project);
  const state = editorStates.get(project) ?? { martId: 0, search: "" };
  editorStates.set(project, state);
  if (state.martId >= count) state.martId = 0;
  const autofills = getMartAutofills(project);
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";

  root.innerHTML = `
    <div class="item-data mart-data" id="item-data">
      <aside class="md-list" aria-label="Marts">
        <div class="md-filters">
          <input class="md-search" id="mart-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search marts or items" autocomplete="off" spellcheck="false" aria-label="Search marts">
        </div>
        <div class="md-rows" id="mart-list" role="listbox" aria-label="Marts" tabindex="0">
          ${Array.from({ length: count }, (_unused, id) => renderMartRow(project, id)).join("")}
        </div>
        <div class="md-list-foot" data-mart-count></div>
      </aside>
      <section class="md-detail" id="mart-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#mart-list")!;
  const detail = root.querySelector<HTMLElement>("#mart-detail")!;
  const countLabel = root.querySelector<HTMLElement>("[data-mart-count]")!;
  const searchInput = root.querySelector<HTMLInputElement>("#mart-search")!;

  const filter = () => {
    let visible = 0;
    list.querySelectorAll<HTMLElement>("[data-mart]").forEach((row) => {
      const show = !state.search.trim() || martMatchesSearch(getMartRecord(project, Number(row.dataset.mart)), state.search);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    countLabel.textContent = visible === count ? `${count} marts` : `${visible} of ${count} marts`;
  };

  const refreshRow = (id: number) => {
    const row = list.querySelector<HTMLElement>(`[data-mart="${id}"]`);
    if (!row) return;
    const template = document.createElement("template");
    template.innerHTML = renderMartRow(project, id).trim();
    const next = template.content.firstElementChild as HTMLElement;
    next.classList.toggle("is-selected", row.classList.contains("is-selected"));
    next.setAttribute("aria-selected", row.getAttribute("aria-selected") ?? "false");
    next.style.display = row.style.display;
    row.replaceWith(next);
  };

  const html = () => renderMartDetail(project, state.martId);
  const install = (scope: HTMLElement) => installDetailFields(scope, { autofills, commit });
  const marks = () => refreshEditMarks(detail, changedKeys(project.actionChangelog?.entries, `mart:${state.martId}:`));
  const render = () => {
    detail.innerHTML = html();
    install(detail);
    marks();
  };
  const changed = () => {
    onDirty?.();
    refreshRow(state.martId);
  };

  function commit(field: HTMLElement, value: string): boolean {
    try {
      updateMartField(project, state.martId, field.dataset.fieldName ?? "", value === "" ? itemLabel(project, 0) : value);
      changed();
      // Clearing a slot pulls the items below it up, so the shop list stays contiguous.
      window.setTimeout(() => {
        compact(project, state.martId);
        patchDetail(detail, html(), install);
        marks();
      }, 0);
      return true;
    } catch (error) {
      field.title = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  const select = (id: number, scroll = false) => {
    state.martId = id;
    markSelectedRow(list, "[data-mart]", (row) => Number(row.dataset.mart) === id, scroll);
    render();
    detail.scrollTop = 0;
  };

  detail.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const mart = getMartRecord(project, state.martId);
    const items = martItemIds(mart);
    try {
      if (button.matches("[data-mart-remove]")) {
        const slot = Number(button.dataset.martRemove);
        writeItems(project, state.martId, items.filter((_unused, index) => index !== slot));
      } else if (button.matches("[data-mart-move]")) {
        const slot = Number(button.dataset.slot);
        const to = slot + Number(button.dataset.martMove);
        if (to < 0 || to >= items.length) return;
        [items[slot], items[to]] = [items[to], items[slot]];
        writeItems(project, state.martId, items);
      } else return;
      changed();
      render();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  });

  searchInput.addEventListener("input", () => {
    window.clearTimeout(Number(searchInput.dataset.timer));
    searchInput.dataset.timer = String(window.setTimeout(() => {
      state.search = searchInput.value;
      filter();
    }, 160));
  });
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-mart]");
    if (row) select(Number(row.dataset.mart));
  });
  attachListArrows(list, "[data-mart]", (row) => select(Number(row.dataset.mart), true));

  filter();
  select(state.martId, true);
}

/** Mart slots are written by item name; slot 0's name is the empty value. */
function itemLabel(project: ProjectState, itemId: number): string {
  return project.texts.banks.items?.[itemId] ?? String(itemId);
}

function martItemIds(mart: MartRecord): number[] {
  return Array.from({ length: MART_SLOTS }, (_unused, slot) => Number(mart.raw[`item_${slot}`] ?? 0)).filter((itemId) => itemId > 0);
}

/** Write a new item order through the normal field updates, touching only slots that change. */
function writeItems(project: ProjectState, martId: number, items: number[]): void {
  const mart = getMartRecord(project, martId);
  for (let slot = 0; slot < MART_SLOTS; slot += 1) {
    const next = items[slot] ?? 0;
    if (Number(mart.raw[`item_${slot}`] ?? 0) !== next) updateMartField(project, martId, `item_${slot}`, itemLabel(project, next));
  }
}

function compact(project: ProjectState, martId: number): void {
  const mart = getMartRecord(project, martId);
  const slots = Array.from({ length: MART_SLOTS }, (_unused, slot) => Number(mart.raw[`item_${slot}`] ?? 0));
  const items = slots.filter((itemId) => itemId > 0);
  if (items.some((itemId, index) => slots[index] !== itemId)) writeItems(project, martId, items);
}

// ---------- List ----------

function renderMartRow(project: ProjectState, id: number): string {
  const mart = getMartRecord(project, id);
  const edits = (project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(`mart:${id}:`)).length;
  const count = martItemIds(mart).length;
  return `
    <div class="md-row mt-row" role="option" aria-selected="false" data-mart="${id}">
      <span class="md-row-id">${id}</span>
      <span class="md-row-name">${escapeHtml(String(mart.readable.name ?? `Mart ${id}`))}${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
      <span class="it-row-price">${count} item${count === 1 ? "" : "s"}</span>
    </div>
  `;
}

// ---------- Detail ----------

function itemIcon(name: string): string {
  const slug = name.normalize("NFKD").replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
  return `<img class="it-row-icon" src="${publicAsset(`images/item_sprites/${slug}.png`)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

function renderMartDetail(project: ProjectState, id: number): string {
  const mart = getMartRecord(project, id);
  const items = martItemIds(mart);
  const rows = items.map((itemId, slot) => {
    const name = String(mart.readable[`item_${slot}`] ?? "");
    const price = Number(getItemRecord(project, itemId).raw.market_value ?? 0) * 10;
    return `
      <tr data-mark-fields="item_${slot}">
        <td class="mt-pos">${slot + 1}</td>
        <td class="en-mon-cell"><div class="en-mon"><span class="en-mon-icon" data-derived="icon-${slot}">${itemIcon(name)}</span><div autocorrect="off" spellcheck="false" contenteditable="true" data-field-name="item_${slot}" data-autofill="items">${escapeHtml(name)}</div></div></td>
        <td class="r mt-price" data-derived="price-${slot}">${price ? `₽${price.toLocaleString("en-US")}` : "—"}</td>
        <td class="mt-actions">
          <button class="btn sm -ghost" type="button" data-mart-move="-1" data-slot="${slot}" title="Move up" aria-label="Move up" ${slot === 0 ? "disabled" : ""}>↑</button>
          <button class="btn sm -ghost" type="button" data-mart-move="1" data-slot="${slot}" title="Move down" aria-label="Move down" ${slot === items.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn sm -ghost" type="button" data-mart-remove="${slot}" title="Remove" aria-label="Remove">×</button>
        </td>
      </tr>
    `;
  }).join("");
  const addRow = items.length < MART_SLOTS ? `
    <tr class="mt-add-row">
      <td class="mt-pos">${items.length + 1}</td>
      <td class="en-mon-cell"><div class="en-mon"><span class="en-mon-icon"></span><div autocorrect="off" spellcheck="false" contenteditable="true" data-field-name="item_${items.length}" data-autofill="items" data-placeholder="Add an item"></div></div></td>
      <td></td><td></td>
    </tr>
  ` : "";
  return `
    <article class="mt-card" data-index="${id}">
      <header class="td-head fd-head -no-sprite">
        <div class="td-ident">
          <div class="td-title"><h1>${escapeHtml(String(mart.readable.name ?? `Mart ${id}`))}</h1><span class="td-num">#${id}</span></div>
          <div class="fd-subtitle">${items.length} of ${MART_SLOTS} slots used</div>
        </div>
      </header>
      <div class="section-bar">Stock</div>
      <table class="md-table mt-table" data-structure="${items.length}">
        <thead><tr><th class="mt-pos">#</th><th>Item</th><th class="r">Price</th><th></th></tr></thead>
        <tbody>${rows}${addRow}</tbody>
      </table>
    </article>
  `;
}
