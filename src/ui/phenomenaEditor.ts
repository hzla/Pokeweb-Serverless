import { loadActiveRomBytes } from "../pokeweb/persistence";
import {
  getPhenomenaConfig, getPhenomenaStatus, PHENOMENA_LIMITS, PHENOMENON_KINDS, phenomenonItemShares, phenomenonLabel,
  savePhenomenaConfig, vanillaPhenomenaConfig,
  type PhenomenaConfig, type PhenomenaStatus, type PhenomenonItem, type PhenomenonKind, type PhenomenonZoneGroup,
} from "../pokeweb/phenomenaModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { renderInlineStatus } from "./inlineStatus";

const WHERE: Record<PhenomenonKind, string> = { dust: "Caves", shadow: "Driftveil Drawbridge" };
let generation = 0;

export function renderPhenomenaEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const run = ++generation;
  root.innerHTML = `<section class="phen-editor"><h1>Phenomena</h1><p class="phen-muted" role="status">Loading…</p></section>`;
  void (async () => {
    const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
    if (run !== generation || !root.isConnected) return;
    mount(project, root, romBytes, onDirty);
  })();
}

function mount(project: ProjectState, root: HTMLElement, romBytes: Uint8Array | undefined, onDirty?: () => void): void {
  let status: PhenomenaStatus = getPhenomenaStatus(project, romBytes);
  let saved: PhenomenaConfig;
  try { saved = getPhenomenaConfig(project, romBytes); }
  catch (error) {
    root.innerHTML = `<section class="phen-editor"><h1>Phenomena</h1><p role="alert">${escapeHtml(errorText(error))}</p></section>`;
    return;
  }
  let draft: PhenomenaConfig = structuredClone(saved);
  let busy = false;
  const game = status.game!;
  const itemNames = project.texts.banks.items ?? [];
  const itemCount = project.narcs.items?.fileCount || itemNames.length;
  const zoneCount = project.headers?.count ?? 0;
  const itemLabel = (id: number) => `${itemNames[id] || `Item ${id}`} (${id})`;
  const zoneLabel = (id: number) => `${project.headers?.rows[id + 1]?.location_name ?? "Zone"} (${id})`;

  root.innerHTML = `<section class="phen-editor">
    <header class="phen-head">
      <h1>Phenomena</h1>
      <span data-phen-badge></span>
      <div class="phen-actions">
        <button class="btn -default" type="button" data-phen-action="retail">Reset to retail</button>
        <button class="btn -default" type="button" data-phen-action="revert">Revert</button>
        <button class="btn -primary" type="button" data-phen-action="save">Save</button>
      </div>
    </header>
    <p class="phen-status" data-phen-status role="status" aria-live="polite"></p>
    <div data-phen-body></div>
    <datalist id="phen-item-list">${Array.from({ length: Math.max(0, itemCount - 1) }, (_, i) => `<option value="${escapeHtml(itemLabel(i + 1))}"></option>`).join("")}</datalist>
    <datalist id="phen-zone-list">${Array.from({ length: zoneCount }, (_, i) => `<option value="${escapeHtml(zoneLabel(i))}"></option>`).join("")}</datalist>
  </section>`;
  const body = root.querySelector<HTMLElement>("[data-phen-body]")!;
  const statusLine = root.querySelector<HTMLElement>("[data-phen-status]")!;

  const scopeItems = (scope: string): PhenomenonItem[] => {
    if (scope === "dust" || scope === "shadow") return draft[scope].items;
    return draft.groups[Number(scope.slice(6))]!.items;
  };
  const percent = (permille: number) => Number((permille / 10).toFixed(1)).toString();

  function itemsTable(scope: string, items: PhenomenonItem[]): string {
    const shares = phenomenonItemShares(items);
    return `<div class="phen-items" data-scope="${scope}">
      <div class="phen-row -head"><span>Item</span><span>Weight</span><span>Chance</span><span></span></div>
      ${items.map((entry, i) => `<div class="phen-row" data-index="${i}">
        <input class="filter-input" list="phen-item-list" data-item value="${escapeHtml(itemLabel(entry.item))}" aria-label="Item" ${busy ? "disabled" : ""}>
        <input class="filter-input" type="number" min="0" max="${PHENOMENA_LIMITS.weight}" step="1" data-weight value="${entry.weight}" aria-label="Weight" ${busy ? "disabled" : ""}>
        <span class="phen-share" data-share>${shares[i]!.toFixed(1)}%</span>
        <button class="phen-remove" type="button" data-remove-item aria-label="Remove ${escapeHtml(itemLabel(entry.item))}" ${busy ? "disabled" : ""}>×</button>
      </div>`).join("")}
      <button class="btn -default phen-add" type="button" data-add-item ${busy || items.length >= PHENOMENA_LIMITS.items ? "disabled" : ""}>Add item</button>
    </div>`;
  }

  function odds(scope: string, permille: number, own = true): string {
    return `<div class="phen-odds">
      <label>Encounter <span class="phen-pct"><input class="filter-input" type="number" min="0" max="100" step="0.1" data-encounter="${scope}" value="${percent(permille)}" ${busy || !own ? "disabled" : ""}>%</span></label>
      <div class="phen-bar" aria-hidden="true"><span class="-battle" data-bar style="width:${permille / 10}%"></span></div>
      <span class="phen-muted" data-item-chance>Item ${percent(PHENOMENA_LIMITS.permille - permille)}%</span>
    </div>`;
  }

  function kindCard(kind: PhenomenonKind): string {
    return `<section class="phen-card" aria-labelledby="phen-${kind}">
      <header><h2 id="phen-${kind}">${phenomenonLabel(kind)}s</h2><span class="phen-muted">${WHERE[kind]}</span></header>
      ${odds(kind, draft[kind].encounterPermille)}
      ${itemsTable(kind, draft[kind].items)}
    </section>`;
  }

  function groupCard(group: PhenomenonZoneGroup, index: number): string {
    const scope = `group-${index}`;
    const base = draft[group.kind];
    return `<section class="phen-card phen-group" data-group="${index}" aria-label="Zone override ${index + 1}">
      <header>
        <select class="filter-input" data-group-kind aria-label="Phenomenon" ${busy ? "disabled" : ""}>
          ${PHENOMENON_KINDS.map((k) => `<option value="${k}" ${k === group.kind ? "selected" : ""}>${phenomenonLabel(k)}s</option>`).join("")}
        </select>
        <button class="phen-remove" type="button" data-remove-group aria-label="Remove zone override ${index + 1}" ${busy ? "disabled" : ""}>×</button>
      </header>
      <div class="phen-zones">
        ${group.zones.map((zone, z) => `<span class="phen-chip">${escapeHtml(zoneLabel(zone))}<button type="button" data-remove-zone="${z}" aria-label="Remove ${escapeHtml(zoneLabel(zone))}" ${busy ? "disabled" : ""}>×</button></span>`).join("")}
        <input class="filter-input phen-zone-input" list="phen-zone-list" data-add-zone placeholder="Add zone" aria-label="Add zone" ${busy || group.zones.length >= PHENOMENA_LIMITS.zones ? "disabled" : ""}>
      </div>
      <label class="phen-check"><input type="checkbox" data-own-encounter ${group.encounterPermille !== null ? "checked" : ""} ${busy ? "disabled" : ""}> Own encounter chance</label>
      ${odds(scope, group.encounterPermille ?? base.encounterPermille, group.encounterPermille !== null)}
      <label class="phen-check"><input type="checkbox" data-own-items ${group.items.length ? "checked" : ""} ${busy ? "disabled" : ""}> Own items</label>
      ${group.items.length ? itemsTable(scope, group.items) : ""}
    </section>`;
  }

  function render(): void {
    body.innerHTML = `<div class="phen-grid">${PHENOMENON_KINDS.map(kindCard).join("")}</div>
      <h2 class="phen-subhead">Zone overrides</h2>
      <div class="phen-grid">${draft.groups.map(groupCard).join("")}</div>
      <button class="btn -default phen-add" type="button" data-add-group ${busy || draft.groups.length >= PHENOMENA_LIMITS.groups ? "disabled" : ""}>Add zone override</button>`;
    refreshChrome();
  }

  function refreshChrome(): void {
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const label = !status.supported ? "Unsupported" : !status.compatible ? "Incompatible" : status.installed ? "Installed" : "Not installed";
    root.querySelector<HTMLElement>("[data-phen-badge]")!.innerHTML = renderInlineStatus(label, { className: "patch-badge", title: status.message });
    const can = status.compatible && !busy;
    root.querySelector<HTMLButtonElement>('[data-phen-action="save"]')!.disabled = !can || (!dirty && status.installed);
    root.querySelector<HTMLButtonElement>('[data-phen-action="revert"]')!.disabled = busy || !dirty;
    root.querySelector<HTMLButtonElement>('[data-phen-action="retail"]')!.disabled = busy;
    if (!statusLine.dataset.sticky) statusLine.textContent = dirty ? "Unsaved changes." : status.compatible ? "" : status.message;
    statusLine.classList.toggle("-error", !status.compatible);
  }

  function refreshShares(scope: string): void {
    const table = body.querySelector<HTMLElement>(`.phen-items[data-scope="${scope}"]`);
    if (!table) return;
    const shares = phenomenonItemShares(scopeItems(scope));
    table.querySelectorAll<HTMLElement>("[data-share]").forEach((span, i) => { span.textContent = `${(shares[i] ?? 0).toFixed(1)}%`; });
  }

  function refreshOdds(input: HTMLInputElement, permille: number): void {
    const box = input.closest(".phen-odds")!;
    box.querySelector<HTMLElement>("[data-bar]")!.style.width = `${permille / 10}%`;
    box.querySelector<HTMLElement>("[data-item-chance]")!.textContent = `Item ${percent(PHENOMENA_LIMITS.permille - permille)}%`;
  }

  const parseItem = (text: string): number | undefined => {
    const id = /\((\d+)\)\s*$/u.exec(text)?.[1] ?? /^\s*(\d+)\s*$/u.exec(text)?.[1];
    if (id !== undefined) return Number(id) >= 1 && Number(id) < itemCount ? Number(id) : undefined;
    const lower = text.trim().toLowerCase();
    const index = itemNames.findIndex((name, i) => i > 0 && name.toLowerCase() === lower);
    return index > 0 ? index : undefined;
  };
  const parseZone = (text: string): number | undefined => {
    const id = /\((\d+)\)\s*$/u.exec(text)?.[1] ?? /^\s*(\d+)\s*$/u.exec(text)?.[1];
    return id !== undefined && Number(id) < zoneCount ? Number(id) : undefined;
  };
  const setNote = (text: string, error = false) => {
    statusLine.textContent = text;
    statusLine.dataset.sticky = text ? "1" : "";
    statusLine.classList.toggle("-error", error);
  };

  body.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const scope = input.closest<HTMLElement>(".phen-items")?.dataset.scope;
    const row = Number(input.closest<HTMLElement>(".phen-row")?.dataset.index);
    setNote("");
    if (input.dataset.encounter) {
      const value = Number(input.value), permille = Math.round(value * 10);
      if (input.value === "" || !Number.isFinite(value) || permille < 0 || permille > PHENOMENA_LIMITS.permille) { input.setAttribute("aria-invalid", "true"); return; }
      input.removeAttribute("aria-invalid");
      const key = input.dataset.encounter;
      if (key === "dust" || key === "shadow") draft[key].encounterPermille = permille;
      else draft.groups[Number(key.slice(6))]!.encounterPermille = permille;
      refreshOdds(input, permille);
    } else if (scope && "weight" in input.dataset) {
      const value = Number(input.value);
      if (input.value === "" || !Number.isInteger(value) || value < 0 || value > PHENOMENA_LIMITS.weight) { input.setAttribute("aria-invalid", "true"); return; }
      input.removeAttribute("aria-invalid");
      scopeItems(scope)[row]!.weight = value;
      refreshShares(scope);
    }
    refreshChrome();
  });

  body.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const groupIndex = Number(input.closest<HTMLElement>("[data-group]")?.dataset.group);
    const group = Number.isInteger(groupIndex) ? draft.groups[groupIndex] : undefined;
    const scope = input.closest<HTMLElement>(".phen-items")?.dataset.scope;
    if (scope && "item" in input.dataset) {
      const row = Number(input.closest<HTMLElement>(".phen-row")!.dataset.index), entry = scopeItems(scope)[row]!;
      const id = parseItem(input.value);
      if (id === undefined) { input.setAttribute("aria-invalid", "true"); setNote("Choose an item from the list.", true); return; }
      input.removeAttribute("aria-invalid");
      entry.item = id;
      input.value = itemLabel(id);
    } else if (group && "addZone" in input.dataset) {
      const zone = parseZone(input.value);
      if (zone === undefined) { setNote("Choose a zone from the list.", true); return; }
      if (!group.zones.includes(zone)) group.zones.push(zone);
      render();
      body.querySelector<HTMLInputElement>(`[data-group="${groupIndex}"] [data-add-zone]`)?.focus();
    } else if (group && "groupKind" in input.dataset) {
      group.kind = input.value as PhenomenonKind;
      render();
    } else if (group && input instanceof HTMLInputElement && "ownEncounter" in input.dataset) {
      group.encounterPermille = input.checked ? draft[group.kind].encounterPermille : null;
      render();
    } else if (group && input instanceof HTMLInputElement && "ownItems" in input.dataset) {
      group.items = input.checked ? structuredClone(draft[group.kind].items) : [];
      render();
    }
    refreshChrome();
  });

  body.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    const scope = button.closest<HTMLElement>(".phen-items")?.dataset.scope;
    const groupIndex = Number(button.closest<HTMLElement>("[data-group]")?.dataset.group);
    if (scope && "addItem" in button.dataset) {
      scopeItems(scope).push({ item: 1, weight: 1 });
      render();
      body.querySelector<HTMLInputElement>(`.phen-items[data-scope="${scope}"] .phen-row:last-of-type [data-item]`)?.select();
    } else if (scope && "removeItem" in button.dataset) {
      scopeItems(scope).splice(Number(button.closest<HTMLElement>(".phen-row")!.dataset.index), 1);
      render();
    } else if ("removeZone" in button.dataset) {
      draft.groups[groupIndex]!.zones.splice(Number(button.dataset.removeZone), 1);
      render();
    } else if ("removeGroup" in button.dataset) {
      draft.groups.splice(groupIndex, 1);
      render();
    } else if ("addGroup" in button.dataset) {
      draft.groups.push({ kind: "dust", zones: [], encounterPermille: null, items: [] });
      render();
      body.querySelector<HTMLInputElement>(".phen-group:last-of-type [data-add-zone]")?.focus();
    }
  });

  root.querySelector(".phen-actions")!.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-phen-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.phenAction;
    if (action === "retail") { draft = vanillaPhenomenaConfig(game); setNote(""); render(); return; }
    if (action === "revert") { draft = structuredClone(saved); setNote(""); render(); return; }
    busy = true; render(); setNote("Saving…");
    try {
      await savePhenomenaConfig(project, draft);
      saved = structuredClone(draft);
      status = getPhenomenaStatus(project, project.originalRomBytes ?? romBytes);
      onDirty?.();
      setNote("Saved. Export the ROM to apply.");
    } catch (error) {
      setNote(errorText(error), true);
    } finally {
      busy = false; render();
    }
  });

  render();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
