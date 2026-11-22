import { pageUses, pageZones, sheetCoverage, type AuthoringTrainer } from "../../pokeweb/mastersheetAuthoring";
import { normalizeName, type MsPage } from "../../pokeweb/mastersheetDocument";
import { insertBlockLines, printBlock, readBlock, replaceRange, sourceLines, type BlockDraft, type SourceChange } from "../../pokeweb/mastersheetEdits";
import { assetKeys } from "../assets";
import { levels, tableName, type EditorHost } from "./pickers";
import { band, esc, hatch, image } from "./ui";

/**
 * Fill from the ROM, in the page: what the game puts in an area's zones (trainers on the map or started by its
 * scripts, the wild table, items on the ground) and the page doesn't show yet, as suggestions where each would go.
 * Each can be added, or marked not needed (kept in the sheet as `!skip`, so it doesn't come back). Coverage, in the
 * panel, looks at the whole sheet.
 */

/** Keys as `!skip` writes them: "tr 180", "enc 44", "item 417". */
export type Candidate =
  | { key: string; kind: "trainer"; trainer: AuthoringTrainer; namesakes: number }
  | { key: string; kind: "table"; tableId: number; name: string }
  | { key: string; kind: "item"; itemId: number; name: string; count: number };

export type FillState = {
  missing: Candidate[];
  skipped: Candidate[];
  present: number;
  zoneIds: number[];
  linked: boolean;
};

export function fillState(host: EditorHost, page: MsPage): FillState | undefined {
  const index = host.index();
  if (!index) return undefined;
  const { zoneIds, linked } = pageZones(index, page);
  const contents = index.contents(zoneIds);
  const uses = pageUses(page);
  const skips = new Set(page.skips);
  const all: Array<[Candidate, boolean]> = [];
  for (const tableId of contents.tableIds) {
    const table = host.catalog().encounter(tableId);
    all.push([{ key: `enc ${tableId}`, kind: "table", tableId, name: tableName((table?.zones ?? []).map((zone) => zone.name), tableId) }, uses.tables.has(tableId)]);
  }
  // Same-named trainers (a rival by starter, difficulty copies) sit together.
  const trainers = [...contents.trainers].sort((a, b) => `${a.className} ${a.name}`.localeCompare(`${b.className} ${b.name}`) || a.id - b.id);
  for (const trainer of trainers) {
    const namesakes = trainers.filter((other) => other.className === trainer.className && other.name === trainer.name).length;
    all.push([{ key: `tr ${trainer.id}`, kind: "trainer", trainer, namesakes }, uses.trainers.has(trainer.id)]);
  }
  for (const item of contents.groundItems) {
    all.push([{ key: `item ${item.itemId}`, kind: "item", itemId: item.itemId, name: item.name, count: item.count }, uses.itemText.includes(normalizeName(item.name))]);
  }
  const shown = all.filter(([, present]) => !present).map(([candidate]) => candidate);
  return {
    missing: shown.filter((candidate) => !skips.has(candidate.key)),
    skipped: shown.filter((candidate) => skips.has(candidate.key)),
    present: all.filter(([, present]) => present).length,
    zoneIds,
    linked,
  };
}

/**
 * Adds the candidates with these keys as one edit: wild tables, then trainers, at the end of the page; items into the
 * page's first item list (or a new list at its top). Edits run from the bottom of the page up, so earlier lines don't
 * move under later ones.
 */
export function fillChange(host: EditorHost, page: MsPage, source: string, keys: string[]): SourceChange | undefined {
  const state = fillState(host, page);
  if (!state) return undefined;
  const wanted = new Set(keys);
  const chosen = [...state.missing, ...state.skipped].filter((candidate) => wanted.has(candidate.key));
  if (!chosen.length) return undefined;
  const blocks: string[] = [];
  for (const candidate of chosen) if (candidate.kind === "table") blocks.push(`!enc ${candidate.tableId}`);
  for (const candidate of chosen) if (candidate.kind === "trainer") blocks.push(`!tr ${candidate.trainer.id}`);
  const items = chosen.flatMap((candidate) => (candidate.kind === "item" ? [{ name: candidate.name, note: candidate.count > 1 ? `${candidate.name} ×${candidate.count}` : "" }] : []));
  const top = (page.skipLine ?? page.zonesLine ?? page.headingLine ?? page.src.start) + 1;
  const end = page.blocks.length ? page.blocks[page.blocks.length - 1]!.src.end : top;
  let change: SourceChange = { source, range: { start: end, end } };
  if (blocks.length) change = insertBlockLines(change.source, end, blocks.flatMap((line, index) => (index ? ["", line] : [line])));
  if (items.length) {
    const list = page.blocks.find((block) => block.kind === "items");
    if (list) {
      const draft = readBlock(sourceLines(change.source).slice(list.src.start, list.src.end)) as Extract<BlockDraft, { kind: "items" }>;
      change = replaceRange(change.source, list.src, printBlock({ ...draft, entries: [...draft.entries, ...items] }));
    } else {
      change = insertBlockLines(change.source, top, printBlock({ kind: "items", title: "Items", description: "", entries: items }));
    }
  }
  return change;
}

// ---------- In the page ----------

export type BannerOptions = { showSkipped: boolean };

/** The note under the page's title: what the ROM adds, from which zones, and what to do about it. */
export function fillBanner(host: EditorHost, page: MsPage, state: FillState | undefined, options: BannerOptions): string {
  const actions = (count: number) => `
    <div class="mse-fill__actions">
      ${count ? `<button type="button" class="msv-hex -fight" data-fill-all><span>Add all ${count}</span></button>` : ""}
      <button type="button" class="msv-hex -nav" data-action="fill"><span>Hide</span></button>
    </div>`;
  if (page.kind !== "area") {
    return `<div class="mse-fill"><div class="mse-fill__text"><p>Fill from the ROM works on area pages (## headings), from the zones each one covers.</p>
      <p class="mse-fill__more"><button type="button" class="mse-link" data-action="coverage">See the whole sheet</button></p></div>${actions(0)}</div>`;
  }
  if (!state) return `<div class="mse-fill"><div class="mse-fill__text"><p class="mse-wait">Reading the ROM's trainers, wild areas and items…</p></div>${actions(0)}</div>`;
  const index = host.index()!;
  const count = state.missing.length;
  const headline = !state.zoneIds.length
    ? "Link the zones this area covers to see what the ROM puts here."
    : count
      ? `The ROM puts ${count} thing${count === 1 ? "" : "s"} in this area that the page doesn't show yet. ${count === 1 ? "It's" : "They're"} marked below.`
      : "Everything the ROM puts in this area is on the page.";
  const chips = state.zoneIds.map((zoneId) => `<span class="mse-chip">${esc(index.zone(zoneId)?.name ?? "Zone")} <span>zone ${zoneId}</span>${state.linked ? `<button type="button" class="mse-chip__x" data-unlink-zone="${zoneId}" aria-label="Unlink zone ${zoneId}">×</button>` : ""}</span>`).join("");
  const from = state.zoneIds.length
    ? `${state.linked ? "From" : "From zones named like the page:"} ${chips}${state.linked ? "" : ` <button type="button" class="mse-link" data-link-suggested="${state.zoneIds.join(",")}">Link ${state.zoneIds.length === 1 ? "it" : "them"}</button>`}`
    : "";
  const skipped = state.skipped.length
    ? `${state.skipped.length} marked not needed · <button type="button" class="mse-link" data-fill-show-skipped>${options.showSkipped ? "Hide them" : "Show them"}</button> · `
    : "";
  return `
    <div class="mse-fill" role="region" aria-label="Fill from the ROM">
      <div class="mse-fill__text">
        <p>${headline}</p>
        <p class="mse-fill__from">${from} <button type="button" class="mse-link" data-zone-picker>+ Link a zone</button></p>
        <p class="mse-fill__more">${skipped}<button type="button" class="mse-link" data-action="coverage">See the whole sheet</button>
          <span class="mse-fill__hint">Hidden items and items scripts give out can't be read yet: add those by hand.</span></p>
      </div>
      ${actions(count)}
    </div>`;
}

function ghostActions(candidate: Candidate, skipped: boolean): string {
  return skipped
    ? `<button type="button" class="msv-hex -nav" data-fill-unskip="${esc(candidate.key)}"><span>Needed after all</span></button>`
    : `<button type="button" class="msv-hex -nav" data-fill-add="${esc(candidate.key)}"><span>+ Add</span></button><button type="button" class="msv-hex -nav" data-fill-skip="${esc(candidate.key)}"><span>Not needed</span></button>`;
}

/** A trainer or wild table the page could show, as a dashed card where it would go. */
export function ghostCard(host: EditorHost, candidate: Candidate, skipped: boolean): string {
  if (candidate.kind === "trainer") {
    const { trainer } = candidate;
    const where = trainer.locations.length ? `In ${trainer.locations[0]}${trainer.locations.length > 1 ? `; also ${trainer.locations.slice(1).join(", ")}` : ""}.` : "Started by a script here.";
    const namesakes = candidate.namesakes > 1 ? ` One of ${candidate.namesakes} with this name.` : "";
    return `
      <div class="mse-ghostcard -fight${skipped ? " -skipped" : ""}" data-ghost="${esc(candidate.key)}">
        <span class="mse-ghostcard__who"><b>${esc(trainer.className)} ${esc(trainer.name)}</b><small>#${trainer.id}${trainer.party.length ? ` · ${levels(trainer)}` : ""}</small></span>
        <span class="mse-ghostcard__party">${trainer.party.slice(0, 6).map((mon) => image(assetKeys.icon(mon.species, mon.form), "msv-icon")).join("")}</span>
        <span class="mse-ghostcard__why">${esc(where + namesakes)}</span>
        <span class="mse-ghostcard__actions">${ghostActions(candidate, skipped)}</span>
      </div>`;
  }
  if (candidate.kind === "table") {
    const table = host.catalog().encounter(candidate.tableId);
    const slots = table?.seasons[0]?.methods[0]?.slots ?? [];
    const species = [...new Map(slots.map((slot) => [slot.personalId, slot])).values()].slice(0, 8);
    return `
      <div class="mse-ghostcard -mon${skipped ? " -skipped" : ""}" data-ghost="${esc(candidate.key)}">
        <span class="mse-ghostcard__who"><b>Wild Pokémon</b><small>table ${candidate.tableId} · ${esc(candidate.name)}</small></span>
        <span class="mse-ghostcard__party">${species.map((slot) => image(assetKeys.icon(slot.species, slot.form), "msv-icon")).join("")}</span>
        <span class="mse-ghostcard__why">${esc(table?.seasons[0]?.methods.map((method) => method.label).join(", ") ?? "")}</span>
        <span class="mse-ghostcard__actions">${ghostActions(candidate, skipped)}</span>
      </div>`;
  }
  return ghostItem(candidate, skipped);
}

/** An item on the ground, as a dashed tile in the page's item list. */
export function ghostItem(candidate: Extract<Candidate, { kind: "item" }>, skipped: boolean): string {
  return `
    <li class="msv-bag -static mse-ghost${skipped ? " -skipped" : ""}" data-ghost="${esc(candidate.key)}">
      <span class="msv-bag__face" aria-hidden="true"></span>
      <span class="msv-bag__plate">${image(assetKeys.item(candidate.itemId), "msv-item-icon")}</span>
      <span class="msv-bag__text"><span class="msv-bag__desc">${esc(candidate.name)}${candidate.count > 1 ? ` ×${candidate.count}` : ""} · on the ground</span>
        <span class="mse-ghost__actions">${ghostActions(candidate, skipped)}</span></span>
    </li>`;
}

/** Item suggestions for a page with no item list: a list of their own, where Fill would put one. */
export function ghostItemGroup(items: string): string {
  return `<section class="msv-pickups mse-ghostgroup"><h3 class="msv-band -bag"><span>Items</span>${hatch()}</h3><ul class="msv-bag-grid">${items}</ul></section>`;
}

// ---------- Whole sheet, in the panel ----------

export function renderCoverage(host: EditorHost): string {
  const index = host.index();
  const body = !index
    ? `<p class="mse-note mse-wait">Reading the ROM's trainers and wild areas…</p>`
    : coverageBody(host);
  return `<div class="msv-detail mse-form" data-form="coverage"><header class="msv-titlebar -run"><h2>Whole sheet</h2>${hatch()}</header>${body}</div>`;
}

function coverageBody(host: EditorHost): string {
  const index = host.index()!;
  const doc = host.doc();
  const coverage = sheetCoverage(index, doc);
  // What an author marked not needed on any page isn't missing.
  const skipped = new Set(doc.pages.flatMap((page) => page.skips));
  const missingTrainers = coverage.missingTrainers.filter((trainer) => !skipped.has(`tr ${trainer.id}`));
  const missingTables = coverage.missingTables.filter((tableId) => !skipped.has(`enc ${tableId}`));
  const byPlace = new Map<string, AuthoringTrainer[]>();
  for (const trainer of missingTrainers) {
    const place = trainer.locations[0] ?? "Elsewhere";
    byPlace.set(place, [...(byPlace.get(place) ?? []), trainer]);
  }
  const places = [...byPlace].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return `
    <p class="mse-note">What the game has that this sheet doesn't show, and what it shows twice. Rematches, later visits and difficulty copies show up here too, so not everything needs adding. What a page marks not needed is left out.</p>
    ${band("Trainers not in the sheet", "fight", `<span class="mse-count">${missingTrainers.length}</span>`)}
    ${places.length ? `<ul class="mse-coverage">${places.map(([place, trainers]) => `
      <li><details><summary><span>${esc(place)}</span><span class="mse-count">${trainers.length}</span></summary>
        <ul>${trainers.map((trainer) => `<li><span>${esc(trainer.className)} ${esc(trainer.name)}</span><span>#${trainer.id}${trainer.party.length ? ` · ${levels(trainer)}` : ""}</span></li>`).join("")}</ul>
      </details></li>`).join("")}</ul>` : `<p class="mse-note">Every trainer the game places is in the sheet.</p>`}
    ${band("Trainers shown twice", "fight", `<span class="mse-count">${coverage.repeatedTrainers.length}</span>`)}
    ${coverage.repeatedTrainers.length ? `<ul class="mse-coverage -flat">${coverage.repeatedTrainers.map((entry) => `<li><span>${esc(entry.trainer ? `${entry.trainer.className} ${entry.trainer.name}` : `Trainer ${entry.id}`)} #${entry.id}</span><span>${esc(entry.pages.join(", "))}</span></li>`).join("")}</ul>` : `<p class="mse-note">None.</p>`}
    ${band("Wild areas not in the sheet", "mon", `<span class="mse-count">${missingTables.length}</span>`)}
    ${missingTables.length ? `<ul class="mse-coverage -flat">${missingTables.map((tableId) => {
      const table = host.catalog().encounter(tableId);
      return `<li><button type="button" class="msv-plain" data-open="wild-${tableId}">${esc(tableName((table?.zones ?? []).map((zone) => zone.name), tableId))}</button><span>table ${tableId}</span></li>`;
    }).join("")}</ul>` : `<p class="mse-note">Every wild area is in the sheet.</p>`}`;
}
