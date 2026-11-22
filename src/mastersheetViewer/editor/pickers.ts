import { typeNamesForProject } from "../../pokeweb/constants";
import { pageZones, type AuthoringTrainer, type AuthoringZone, type MastersheetAuthoringIndex } from "../../pokeweb/mastersheetAuthoring";
import { normalizeName, type MastersheetCatalog, type MastersheetDocument, type MsPage } from "../../pokeweb/mastersheetDocument";
import type { ProjectState } from "../../pokeweb/projectStore";
import { cleanDisplayText } from "../../pokeweb/text";
import { tmTypePalette } from "../../pokeweb/tmModel";
import { assetKeys } from "../assets";
import { esc, image } from "./ui";

/**
 * What the editor's pickers list: trainers, wild tables, item icons, Pokémon and zones. Each opens under the thing it
 * changes, over the page (editor.ts places it); this file only says what is in it. Every choosable row carries
 * `data-pick-value`, which is what gets written back.
 */

export type EditorHost = {
  project: ProjectState;
  doc(): MastersheetDocument;
  page(): MsPage | undefined;
  catalog(): MastersheetCatalog;
  /** The ROM-wide index, or undefined while it is being read (pickers then say so). */
  index(): MastersheetAuthoringIndex | undefined;
};

export type PickerKind = "trainer" | "table" | "item" | "species" | "zone";

export type PickerContext = {
  /** What the thing being changed holds now ("This block"). */
  current?: string;
};

const PLACEHOLDERS: Record<PickerKind, string> = {
  trainer: "Name, class, ID, Pokémon or place",
  table: "Place or table number",
  item: "Item, or TM and a type",
  species: "Pokémon",
  zone: "Zone name or number",
};

export function pickerPlaceholder(kind: PickerKind): string {
  return PLACEHOLDERS[kind];
}

export function renderPicker(host: EditorHost, kind: PickerKind, query: string, context: PickerContext = {}): string {
  switch (kind) {
    case "trainer":
      return trainerResults(host, query, context);
    case "table":
      return tableResults(host, query, context);
    case "item":
      return itemResults(host, query, context);
    case "species":
      return speciesResults(host, query, context);
    case "zone":
      return zoneResults(host, query);
  }
}

const wait = (what: string) => `<p class="mse-pop__note mse-wait">Reading the ROM's ${what}…</p>`;

// ---------- Trainers ----------

function trainerResults(host: EditorHost, query: string, context: PickerContext): string {
  const index = host.index();
  if (!index) return wait("trainers");
  const page = host.page();
  const zones = new Set(page ? pageZones(index, page).zoneIds : []);
  const current = context.current !== undefined && /^\d+$/u.test(context.current) ? Number(context.current) : undefined;
  const inSheet = sheetTrainerIds(host.doc());
  const all = index.trainers();
  // With nothing typed: this one and the trainers in the page's zones. Typing searches every trainer.
  const results = query.trim()
    ? searchTrainers(all, query, zones).slice(0, 40)
    : [...all.filter((trainer) => trainer.id === current), ...all.filter((trainer) => trainer.id !== current && trainer.zoneIds.some((zoneId) => zones.has(zoneId)))];
  const place = zones.size && page ? esc(page.title) : "";
  if (!results.length) {
    return `<p class="mse-pop__note">${query.trim() ? `No trainer matches “${esc(query)}”.` : `Type a name, class, ID, Pokémon or place to search all ${all.length} trainers.`}</p>`;
  }
  const note = query.trim() ? (place ? `Trainers in ${place} come first.` : "") : `${place ? `Trainers in ${place}. ` : ""}Type to search all ${all.length}.`;
  return `
    ${note ? `<p class="mse-pop__note">${note}</p>` : ""}
    <ul class="mse-options">${results.map((trainer) => {
      const tag = trainer.id === current ? "This block" : trainer.zoneIds.some((zoneId) => zones.has(zoneId)) && page ? "In this area" : inSheet.has(trainer.id) ? "In the sheet" : "";
      return `
      <li><button type="button" class="mse-option${trainer.id === current ? " -on" : ""}" data-pick-value="${trainer.id}">
        <span class="mse-option__name">${esc(trainer.className)} ${esc(trainer.name)}</span><span class="mse-option__id">#${trainer.id}</span>
        <span class="mse-option__icons">${trainer.party.slice(0, 6).map((mon) => image(assetKeys.icon(mon.species, mon.form), "msv-icon")).join("")}</span>
        <span class="mse-option__meta"><span>${esc(trainer.locations.join(", ") || "Not placed on a map")}${trainer.party.length ? ` · ${levels(trainer)}` : ""}</span>${tag ? `<span class="mse-tag">${tag}</span>` : ""}</span>
      </button></li>`;
    }).join("")}
    </ul>`;
}

export function searchTrainers(trainers: AuthoringTrainer[], query: string, zones: Set<number>): AuthoringTrainer[] {
  const needle = normalizeName(query);
  const inZone = (trainer: AuthoringTrainer) => trainer.zoneIds.some((zoneId) => zones.has(zoneId));
  if (!needle) return [...trainers.filter(inZone), ...trainers.filter((trainer) => !inZone(trainer))];
  const scored: Array<[number, AuthoringTrainer]> = [];
  for (const trainer of trainers) {
    let score = 0;
    if (/^\d+$/u.test(query.trim()) && trainer.id === Number(query.trim())) score = 100;
    const name = normalizeName(`${trainer.className} ${trainer.name}`);
    if (normalizeName(trainer.name).startsWith(needle)) score = Math.max(score, 60);
    else if (name.includes(needle)) score = Math.max(score, 40);
    else if (trainer.locations.some((location) => normalizeName(location).includes(needle))) score = Math.max(score, 25);
    else if (trainer.party.some((mon) => normalizeName(mon.name).startsWith(needle))) score = Math.max(score, 15);
    if (!score) continue;
    if (inZone(trainer)) score += 10;
    scored.push([score, trainer]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].id - b[1].id).map(([, trainer]) => trainer);
}

export function levels(trainer: { party: Array<{ level: number }> }): string {
  if (!trainer.party.length) return "";
  const values = trainer.party.map((mon) => mon.level);
  const low = Math.min(...values), high = Math.max(...values);
  return low === high ? `Lv ${low}` : `Lv ${low}–${high}`;
}

function sheetTrainerIds(doc: MastersheetDocument): Set<number> {
  return new Set(doc.pages.flatMap((page) => page.blocks.flatMap((block) => (block.kind === "trainer" ? [block.trainerId] : []))));
}

// ---------- Wild tables ----------

function tableResults(host: EditorHost, query: string, context: PickerContext): string {
  const index = host.index();
  if (!index) return wait("wild areas");
  const current = context.current !== undefined && /^\d+$/u.test(context.current) ? Number(context.current) : undefined;
  const page = host.page();
  const pageZoneIds = new Set(page ? pageZones(index, page).zoneIds : []);
  const inSheet = new Set(host.doc().pages.flatMap((entry) => entry.blocks.flatMap((block) => (block.kind === "encounter" ? [block.tableId] : []))));
  const tables = tableEntries(index).filter((entry) => matchesTable(entry, query));
  const inArea = (entry: { zones: AuthoringZone[] }) => entry.zones.some((zone) => pageZoneIds.has(zone.zoneId));
  const rank = (entry: { tableId: number; zones: AuthoringZone[] }) => (entry.tableId === current ? 2 : inArea(entry) ? 1 : 0);
  tables.sort((a, b) => rank(b) - rank(a) || a.tableId - b.tableId);
  if (!tables.length) return `<p class="mse-pop__note">No wild area matches “${esc(query)}”.</p>`;
  return `
    ${!query.trim() && pageZoneIds.size ? `<p class="mse-pop__note">This area's zones first.</p>` : ""}
    <ul class="mse-options">${tables.slice(0, 60).map((entry) => {
      const table = host.catalog().encounter(entry.tableId);
      const firstMethod = table?.seasons[0]?.methods[0];
      const species = [...new Map((firstMethod?.slots ?? []).map((slot) => [slot.personalId, slot])).values()].slice(0, 8);
      const tag = entry.tableId === current ? "This block" : inArea(entry) && page ? "In this area" : inSheet.has(entry.tableId) ? "In the sheet" : "";
      return `
      <li><button type="button" class="mse-option${entry.tableId === current ? " -on" : ""}" data-pick-value="${entry.tableId}">
        <span class="mse-option__name">${esc(tableName(entry.zones.map((zone) => zone.name), entry.tableId))}</span><span class="mse-option__id">table ${entry.tableId}</span>
        <span class="mse-option__icons">${species.map((slot) => image(assetKeys.icon(slot.species, slot.form), "msv-icon")).join("")}</span>
        <span class="mse-option__meta"><span>${esc(table?.seasons[0]?.methods.map((method) => method.label).join(", ") ?? "")}</span>${tag ? `<span class="mse-tag">${tag}</span>` : ""}</span>
      </button></li>`;
    }).join("")}
    </ul>`;
}

export function tableName(zoneNames: string[], tableId: number): string {
  return [...new Set(zoneNames)].join(", ") || `Table ${tableId}`;
}

function tableEntries(index: MastersheetAuthoringIndex): Array<{ tableId: number; zones: AuthoringZone[] }> {
  const byTable = new Map<number, AuthoringZone[]>();
  for (const zone of index.zones()) {
    if (zone.encounterId === undefined || !index.hasWildPokemon(zone.encounterId)) continue;
    byTable.set(zone.encounterId, [...(byTable.get(zone.encounterId) ?? []), zone]);
  }
  return [...byTable].map(([tableId, zones]) => ({ tableId, zones }));
}

function matchesTable(entry: { tableId: number; zones: AuthoringZone[] }, query: string): boolean {
  const text = query.trim();
  if (!text) return true;
  if (/^\d+$/u.test(text)) return entry.tableId === Number(text) || entry.zones.some((zone) => zone.zoneId === Number(text));
  const needle = normalizeName(text);
  return entry.zones.some((zone) => normalizeName(zone.name).includes(needle));
}

// ---------- Item icons ----------

function itemResults(host: EditorHost, query: string, context: PickerContext): string {
  const text = query.trim();
  const needle = normalizeName(text.replace(/^[th]m\b\s*/iu, ""));
  const wantsTm = !text || /^[th]m/iu.test(text);
  const current = context.current ? normalizeName(context.current) : "";
  const types = typeNamesForProject(host.project).filter((type) => tmTypePalette(type) !== undefined)
    .filter((type) => wantsTm ? !needle || normalizeName(type).startsWith(needle) : normalizeName(type).startsWith(normalizeName(text)));
  const names = itemNames(host.project);
  const items = text
    ? names.filter(([, name]) => normalizeName(name).startsWith(normalizeName(text))).concat(names.filter(([, name]) => !normalizeName(name).startsWith(normalizeName(text)) && normalizeName(name).includes(normalizeName(text)))).slice(0, 40)
    : [];
  return `
    ${types.length ? `
      <p class="mse-pop__head">TM disc in a type's colour</p>
      <div class="mse-typegrid">${types.map((type) => {
        const value = `TM ${type}`;
        return `<button type="button" class="mse-typecell${normalizeName(value) === current ? " -on" : ""}" data-pick-value="${esc(value)}">${image(assetKeys.tm(type), "msv-item-icon")}<span>${esc(type)}</span></button>`;
      }).join("")}</div>` : ""}
    ${text ? `
      <p class="mse-pop__head">Items</p>
      ${items.length ? `<ul class="mse-options">${items.map(([id, name]) => `
        <li><button type="button" class="mse-option -line${normalizeName(name) === current ? " -on" : ""}" data-pick-value="${esc(name)}">
          <span class="mse-option__name">${image(assetKeys.item(id), "msv-item-icon")}${esc(name)}</span><span class="mse-option__id">item ${id}</span>
        </button></li>`).join("")}</ul>` : `<p class="mse-pop__note">No item matches “${esc(text)}”.</p>`}`
      : `<p class="mse-pop__note">Type an item's name to find its icon.</p>`}`;
}

function itemNames(project: ProjectState): Array<[number, string]> {
  const seen = new Set<string>();
  const list: Array<[number, string]> = [];
  (project.texts.banks.items ?? []).forEach((raw, id) => {
    const name = cleanDisplayText(String(raw ?? "")).trim();
    if (!name || name === "-" || /^\?+$/u.test(name) || seen.has(name)) return;
    seen.add(name);
    list.push([id, name]);
  });
  return list;
}

// ---------- Pokémon ----------

function speciesResults(host: EditorHost, query: string, context: PickerContext): string {
  const text = normalizeName(query);
  const current = context.current ? normalizeName(context.current) : "";
  const names = (host.project.texts.banks.pokedex ?? []).map((raw, id) => [id, cleanDisplayText(String(raw ?? "")).trim()] as [number, string]).slice(1).filter(([, name]) => name && name !== "-");
  const matches = text
    ? [...names.filter(([, name]) => normalizeName(name).startsWith(text)), ...names.filter(([, name]) => !normalizeName(name).startsWith(text) && normalizeName(name).includes(text))]
    : names.filter(([, name]) => normalizeName(name) === current);
  if (!matches.length) return `<p class="mse-pop__note">${text ? `No Pokémon matches “${esc(query)}”.` : "Type a Pokémon's name."}</p>`;
  return `<ul class="mse-options">${matches.slice(0, 40).map(([id, name]) => `
    <li><button type="button" class="mse-option -line${normalizeName(name) === current ? " -on" : ""}" data-pick-value="${esc(name)}">
      <span class="mse-option__name">${image(assetKeys.icon(id, 0), "msv-icon")}${esc(name)}</span><span class="mse-option__id">#${id}</span>
    </button></li>`).join("")}</ul>`;
}

// ---------- Zones ----------

function zoneResults(host: EditorHost, query: string): string {
  const index = host.index();
  if (!index) return wait("zones");
  const page = host.page();
  const linked = new Set(page?.zones ?? []);
  const text = query.trim();
  const needle = normalizeName(text);
  const zones = index.zones().filter((zone) => !linked.has(zone.zoneId) && (!text || (/^\d+$/u.test(text) ? zone.zoneId === Number(text) : normalizeName(zone.name).includes(needle))));
  if (!zones.length) return `<p class="mse-pop__note">No zone matches “${esc(query)}”.</p>`;
  return `<ul class="mse-options">${zones.slice(0, 30).map((zone) => `
    <li><button type="button" class="mse-option" data-pick-value="${zone.zoneId}">
      <span class="mse-option__name">${esc(zone.name)}</span><span class="mse-option__id">zone ${zone.zoneId}</span>
      <span class="mse-option__meta"><span>${esc(zoneContents(index, zone))}</span></span>
    </button></li>`).join("")}</ul>`;
}

function zoneContents(index: MastersheetAuthoringIndex, zone: AuthoringZone): string {
  const contents = index.contents([zone.zoneId]);
  const parts = [];
  if (contents.trainers.length) parts.push(`${contents.trainers.length} trainer${contents.trainers.length === 1 ? "" : "s"}`);
  if (contents.tableIds.length) parts.push(`wild table ${contents.tableIds.join(", ")}`);
  if (contents.groundItems.length) parts.push(`${contents.groundItems.length} item${contents.groundItems.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Nothing to fill from";
}
