import type {
  MastersheetDocument,
  MsBlock,
  MsEncounterTable,
  MsInline,
  MsPage,
  MsPartyMon,
  MsTrainer,
} from "../pokeweb/mastersheetDocument";
import { createMastersheetCatalog, normalizeName, titleCase } from "../pokeweb/mastersheetDocument";
import {
  getMastersheetAbilityDetail,
  getMastersheetItemDetail,
  getMastersheetItemSources,
  getMastersheetMove,
  ITEM_SOURCE_LABELS,
  type MsItemSource,
  type MsItemSourceKind,
  getMastersheetMoveDetail,
  getMastersheetPokemonDetail,
} from "../pokeweb/mastersheetDetails";
import type { ProjectState } from "../pokeweb/projectStore";
import { typeNamesForProject } from "../pokeweb/constants";
import { assetKeys, type AssetProvider } from "./assets";

/**
 * The viewer UI: a sticky outline of splits and areas, one area per page, and a drawer for Pokémon, move,
 * ability, item and map details. Routes live in the hash: #/<page>[/<anchor>][?d=<kind>-<id>].
 */

export type ViewerContext = {
  project: ProjectState;
  document: MastersheetDocument;
  assets: AssetProvider;
  /** ROM-file mode: forget the remembered ROM and go back to the open screen. */
  onOpenAnotherRom?: () => void;
};

type Detail = { kind: "pokemon" | "move" | "item" | "ability" | "map" | "wild" | "dex"; id: string };
type DexCategory = "all" | "pokemon" | "move" | "item" | "ability" | "area";
type DexEntry = { kind: Exclude<DexCategory, "all">; id: string; name: string; terms: string; note?: string; page?: string };
const DEX_CATEGORIES: Array<[DexCategory, string]> = [["all", "All"], ["pokemon", "Pokémon"], ["move", "Moves"], ["item", "Items"], ["ability", "Abilities"], ["area", "Areas"]];

/** Pokeweb's type plate colours (src/styles/unova.css), so types look the same as in the editor. */
const TYPE_COLORS: Record<string, string> = {
  normal: "#a8a878", fire: "#f08030", water: "#6890f0", grass: "#78c850", electric: "#f8d030", ice: "#98d8d8",
  fighting: "#c03028", poison: "#a040a0", ground: "#e0c068", flying: "#a890f0", psychic: "#f85888", bug: "#a8b820",
  rock: "#b8a038", ghost: "#705898", dragon: "#7038f8", dark: "#705848", steel: "#b8b8d0", fairy: "#ee99ac",
};
/** Types whose plates take white text; the rest take dark text. */
const LIGHT_INK_TYPES = new Set(["fighting", "poison", "ghost", "dragon", "dark"]);
/** Type name → the ROM's type index, for the game's own type icons. Set when the viewer mounts. */
let typeIndexByName = new Map<string, number>();
const ROLE_LABELS: Record<string, string> = { mandatory: "Mandatory", optional: "Optional", rematch: "Rematch" };
const SEASON_LABELS: Record<string, string> = { spring: "Spring", summer: "Summer", fall: "Autumn", winter: "Winter" };

export function mountViewer(root: HTMLElement, context: ViewerContext): void {
  const { document: doc } = context;
  typeIndexByName = new Map(typeNamesForProject(context.project).map((name, index) => [normalizeName(name), index]));
  const pageIndex = new Map(doc.pages.map((page, index) => [page.id, index]));
  const highlights = highlightIndex(doc);
  const search = buildSearchIndex(doc);
  const encounterState = new Map<number, { method: string; season: string }>();
  let observer: IntersectionObserver | undefined;

  root.innerHTML = `
    <div class="msv">
      <header class="msv-bar">
        <button class="msv-hex -nav" type="button" data-toggle-outline aria-expanded="false" aria-controls="msv-outline"><span>Contents</span></button>
        <span class="msv-bar__title">${esc(doc.title)}</span>
      </header>
      <aside class="msv-outline" id="msv-outline" aria-label="Contents">
        <a class="msv-brand" href="#/${esc(doc.pages[0]?.id ?? "")}"><span class="msv-brand__title">${esc(doc.title)}</span><span class="msv-brand__sub">Mastersheet</span></a>
        <div class="msv-search"><input type="search" placeholder="Search this sheet" aria-label="Search this mastersheet's trainers, Pokémon and areas" autocomplete="off" spellcheck="false" /></div>
        <nav class="msv-nav" aria-label="Splits and areas"></nav>
        ${context.onOpenAnotherRom ? `<div class="msv-outline__foot"><button class="msv-hex -nav" type="button" data-open-another-rom><span>Open another ROM</span></button></div>` : ""}
      </aside>
      <main class="msv-main" tabindex="-1"></main>
      <button class="msv-dex-tab" type="button" data-dex-tab aria-expanded="false" aria-controls="msv-drawer" title="Dex: look up any Pokémon, move, item, ability or wild area (/)">
        <img data-asset="${assetKeys.dexTab}" alt="" decoding="async"><span class="msv-dex-tab__text">Dex</span>
      </button>
      <aside class="msv-drawer" id="msv-drawer" aria-label="Details" hidden>
        <div class="msv-drawer__bar"><button class="msv-hex -nav" type="button" data-drawer-back hidden><span>Back</span></button><button class="msv-hex -nav" type="button" data-open="dex-all" data-drawer-dex><span>Dex</span></button><button class="msv-hex -nav" type="button" data-drawer-close><span>Close</span></button></div>
        <div class="msv-drawer__body"></div>
      </aside>
    </div>
  `;
  const shell = root.querySelector<HTMLElement>(".msv")!;
  const nav = root.querySelector<HTMLElement>(".msv-nav")!;
  const main = root.querySelector<HTMLElement>(".msv-main")!;
  const drawer = root.querySelector<HTMLElement>(".msv-drawer")!;
  const drawerBody = root.querySelector<HTMLElement>(".msv-drawer__body")!;
  const searchInput = root.querySelector<HTMLInputElement>(".msv-search input")!;
  const outlineToggle = root.querySelector<HTMLButtonElement>("[data-toggle-outline]")!;
  const drawerBack = root.querySelector<HTMLButtonElement>("[data-drawer-back]")!;
  const dexTab = root.querySelector<HTMLButtonElement>("[data-dex-tab]")!;
  let drawerStack: Detail[] = [];
  /** History entries this page pushed for open details, so Close can step back over them. */
  let pushedDetails = 0;
  let currentPage = "";
  const catalog = createMastersheetCatalog(context.project, doc);
  const tableById = (id: number) => doc.encounters[id] ?? catalog.encounter(id);
  const dex = { category: "all" as DexCategory, query: "" };
  let dexIndex: DexEntry[] | undefined;
  let wildIndex: Map<number, Array<{ tableId: number; methods: Set<string>; min: number; max: number }>> | undefined;
  root.querySelector<HTMLButtonElement>("[data-open-another-rom]")?.addEventListener("click", () => context.onOpenAnotherRom?.());

  // ---------- Routing ----------

  const parseHash = (): { page: string; anchor?: string; detail?: Detail } => {
    const [path = "", query = ""] = window.location.hash.replace(/^#\/?/u, "").split("?");
    const [page = "", anchor] = path.split("/");
    const d = new URLSearchParams(query).get("d");
    const match = d ? /^(pokemon|move|item|ability|map|wild|dex)-(.+)$/u.exec(d) : null;
    return { page: decodeURIComponent(page), anchor: anchor ? decodeURIComponent(anchor) : undefined, detail: match ? { kind: match[1] as Detail["kind"], id: match[2]! } : undefined };
  };

  const hrefFor = (page: string, anchor?: string, detail?: Detail) =>
    `#/${encodeURIComponent(page)}${anchor ? `/${encodeURIComponent(anchor)}` : ""}${detail ? `?d=${detail.kind}-${encodeURIComponent(detail.id)}` : ""}`;

  const route = () => {
    const { page, anchor, detail } = parseHash();
    const target = pageIndex.has(page) ? page : doc.pages[0]?.id ?? "";
    if (target !== currentPage) {
      currentPage = target;
      renderPage(target);
      renderNav();
      // The window scrolls, not <main>.
      if (!anchor) window.scrollTo({ top: 0 });
    }
    if (anchor) window.requestAnimationFrame(() => root.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: "start" }));
    if (detail) openDetail(detail, false);
    else closeDrawer(false);
    shell.classList.remove("-outline-open");
    outlineToggle.setAttribute("aria-expanded", "false");
  };

  // ---------- Outline ----------

  const renderNav = () => {
    const query = searchInput.value.trim();
    if (query) {
      const results = searchSheet(search, query);
      nav.innerHTML = results.length
        ? `<ul class="msv-results">${results.map((result) => `<li><a href="${hrefFor(result.page, result.anchor)}"><span class="msv-results__name">${esc(result.label)}</span><span class="msv-results__where">${esc(result.where)}</span></a></li>`).join("")}</ul>`
        : `<p class="msv-empty">Nothing matches “${esc(query)}”.</p>`;
      return;
    }
    const intro = doc.pages.filter((page) => page.kind === "intro" && !page.splitId);
    nav.innerHTML = `
      ${intro.map((page) => navLink(page)).join("")}
      ${doc.splits.map((split) => {
        const splitIntro = doc.pages.find((page) => page.splitId === split.id && page.kind === "intro");
        const pages = split.pageIds.map((id) => doc.pages[pageIndex.get(id)!]!);
        const open = pages.some((page) => page.id === currentPage) || splitIntro?.id === currentPage;
        return `
          <section class="msv-split${open ? " -current" : ""}">
            <a class="msv-split__head" href="#/${esc(splitIntro?.id ?? pages[0]?.id ?? "")}"${splitIntro?.id === currentPage ? ' aria-current="page"' : ""}>
              <span class="msv-split__name">${esc(split.title)}</span>
              ${split.detail ? `<span class="msv-split__detail">${esc(split.detail)}</span>` : ""}
            </a>
            <ul>${pages.map((page) => `<li>${navLink(page)}</li>`).join("")}</ul>
          </section>`;
      }).join("")}
    `;
    nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  };

  const navLink = (page: MsPage) => `<a class="msv-nav__link" href="#/${esc(page.id)}"${page.id === currentPage ? ' aria-current="page"' : ""}>${esc(page.title)}</a>`;

  // ---------- Pages ----------

  const renderPage = (pageId: string) => {
    observer?.disconnect();
    const page = doc.pages[pageIndex.get(pageId)!];
    if (!page) {
      main.innerHTML = `<p class="msv-empty">This mastersheet has no pages yet.</p>`;
      return;
    }
    const index = pageIndex.get(pageId)!;
    const split = doc.splits.find((candidate) => candidate.id === page.splitId);
    const previous = doc.pages[index - 1];
    const next = doc.pages[index + 1];
    main.innerHTML = `
      <article class="msv-page${page.kind === "intro" ? " -intro" : ""}">
        <header class="msv-titlebar -page -run">
          <h1>${esc(page.title)}</h1>
          ${split && (page.kind === "area" || split.detail) ? `<p class="msv-titlebar__meta">${page.kind === "area" ? `<span>${esc(split.title)}</span>` : ""}${split.detail ? `<span class="msv-plate">${esc(split.detail)}</span>` : ""}</p>` : ""}
          ${hatch()}
        </header>
        ${page.blocks.map((block) => renderBlock(block, page)).join("")}
        ${doc.pages.length === 1 && !page.blocks.length ? `<p class="msv-empty">This mastersheet has nothing in it yet. Write it in Pokeweb's Mastersheet editor; splits start with "#" and areas with "##".</p>` : ""}
        <nav class="msv-pager" aria-label="Pages">
          ${previous ? `<a class="msv-hex -nav -pager" href="#/${esc(previous.id)}" rel="prev"><span><small>Previous</small>${esc(previous.title)}</span></a>` : "<span></span>"}
          ${next ? `<a class="msv-hex -nav -pager" href="#/${esc(next.id)}" rel="next"><span><small>Next</small>${esc(next.title)}</span></a>` : "<span></span>"}
        </nav>
      </article>
    `;
    hydrateAssets(main);
  };

  const renderBlock = (block: MsBlock, page: MsPage): string => {
    switch (block.kind) {
      case "heading":
        return block.level === 3 ? `<h2 class="msv-band" id="${esc(block.id)}"><span>${esc(block.text)}</span>${hatch()}</h2>` : `<h3 class="msv-h4" id="${esc(block.id)}">${esc(block.text)}</h3>`;
      case "text":
        return `<p class="msv-text">${inline(block.parts)}</p>`;
      case "list":
        return `<ul class="msv-list">${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
      case "notice":
        return `<aside class="msv-notice"${block.color ? ` style="--notice:${esc(block.color)}"` : ""}><strong>${esc(sentenceCase(block.title))}</strong><p>${esc(block.text)}</p></aside>`;
      case "items":
        return `
          <section class="msv-pickups">
            <h3 class="msv-band -bag"><span>${esc(block.title || "Items")}</span>${hatch()}</h3>
            ${block.description ? `<p class="msv-pickups__lead">${esc(block.description)}</p>` : ""}
            <ul class="msv-bag-grid">${block.entries.map((entry) => `
              <li class="msv-bag -static">
                <span class="msv-bag__plate">${entry.tmType ? asset(assetKeys.tm(entry.tmType), "", "msv-item-icon") : entry.itemId !== undefined ? asset(assetKeys.item(entry.itemId), "", "msv-item-icon") : ""}</span>
                <span class="msv-bag__text"><span class="msv-bag__desc">${esc(entry.note?.trim() || entry.name)}</span></span>
              </li>`).join("")}
            </ul>
          </section>`;
      case "gifts":
        return `
          <section class="msv-pickups -gifts">
            <h3 class="msv-band -mon"><span>${esc(block.title || "Gift Pokémon")}</span>${hatch()}</h3>
            ${block.description ? `<p class="msv-pickups__lead">${esc(block.description)}</p>` : ""}
            <ul class="msv-bag-grid">${block.entries.map((entry) => {
              const mon = entry.personalId !== undefined ? doc.pokemon[entry.personalId] : undefined;
              const inner = `<span class="msv-bag__plate">${mon ? asset(assetKeys.icon(mon.species, mon.form), "", "msv-icon") : ""}</span><span class="msv-bag__text"><span class="msv-bag__desc">${esc(entry.note?.trim() || mon?.name || entry.name)}</span></span>`;
              return `<li>${mon ? `<button type="button" class="msv-bag -mon" data-open="pokemon-${mon.personalId}">${inner}</button>` : `<div class="msv-bag -mon">${inner}</div>`}</li>`;
            }).join("")}</ul>
          </section>`;
      case "encounter":
        return renderEncounter(block.tableId, page);
      case "trainer":
        return renderTrainer(block);
    }
  };

  const renderEncounter = (tableId: number, page: MsPage): string => {
    const table = doc.encounters[tableId];
    if (!table) return `<p class="msv-empty">Encounter table ${tableId} isn't in this ROM.</p>`;
    const zone = encounterMapZone(table, page);
    return `
      <section class="msv-wild" id="e-${tableId}" data-table="${tableId}">
        <div class="msv-wild__layout${zone ? " -with-map" : ""}">
          <div class="msv-wild__data">${wildInner(table)}</div>
          ${zone ? `
            <figure class="msv-wild__map">
              <button type="button" data-open="map-${zone.zoneId}" aria-label="Larger map of ${esc(zone.name)}">${asset(assetKeys.map(zone.zoneId), "", "msv-map")}</button>
              <figcaption>${esc(zone.name)}</figcaption>
            </figure>` : ""}
        </div>
      </section>
    `;
  };

  /** The map beside a wild Pokémon table, showing where it applies: the table's zone named like the page, else its first zone. */
  const encounterMapZone = (table: MsEncounterTable, page: MsPage): { zoneId: number; name: string } | undefined => {
    const title = normalizeName(page.title);
    return table.zones.find((zone) => normalizeName(zone.name) === title) ?? table.zones[0];
  };

  const wildInner = (table: MsEncounterTable): string => {
    const state = encounterState.get(table.id) ?? { season: table.seasons[0]?.season ?? "spring", method: table.seasons[0]?.methods[0]?.kind ?? "grass" };
    const season = table.seasons.find((entry) => entry.season === state.season) ?? table.seasons[0];
    if (!season) return `<h3 class="msv-band -mon"><span>Wild Pokémon</span>${hatch()}</h3><p class="msv-empty">No wild Pokémon here.</p>`;
    const method = season.methods.find((entry) => entry.kind === state.method) ?? season.methods[0]!;
    const rows = aggregateSlots(method.slots);
    return `
      <h3 class="msv-band -mon"><span>Wild Pokémon</span>${hatch()}</h3>
      ${uniqueNames(table.zones.map((zone) => zone.name)).length > 1 ? `<p class="msv-wild__where">Used on ${esc(uniqueNames(table.zones.map((zone) => zone.name)).join(", "))}</p>` : ""}
      <div class="msv-tabs">
        <div class="msv-tabs__group" role="tablist" aria-label="Encounter method">${season.methods.map((entry) => `<button type="button" class="msv-hex -tab" role="tab" aria-selected="${entry.kind === method.kind}" data-method="${entry.kind}"><span>${esc(entry.label)}</span></button>`).join("")}</div>
        ${table.seasons.length > 1 ? `<div class="msv-tabs__group" aria-label="Season">${table.seasons.map((entry) => `<button type="button" class="msv-hex -tab -season" aria-pressed="${entry.season === season.season}" data-season="${entry.season}"><span>${esc(SEASON_LABELS[entry.season] ?? entry.season)}</span></button>`).join("")}</div>` : ""}
      </div>
      <table class="msv-wild__table">
        <thead><tr><th scope="col">Pokémon</th><th scope="col">Type</th><th scope="col" class="-num">Level</th><th scope="col" class="-num">Chance</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <th scope="row"><button type="button" class="msv-mon-link" data-open="pokemon-${row.personalId}">${asset(assetKeys.icon(row.species, row.form), "", "msv-icon")}<span>${esc(row.name)}</span></button></th>
            <td>${typeChips(doc.pokemon[row.personalId]?.types ?? [])}</td>
            <td class="-num">${row.minLevel === row.maxLevel ? row.minLevel : `${row.minLevel}–${row.maxLevel}`}</td>
            <td class="-num"><span class="msv-chance"><span class="msv-chance__bar" aria-hidden="true"><span style="width:${Math.min(100, row.chance)}%"></span></span>${row.chance}%</span></td>
          </tr>`).join("")}
        </tbody>
      </table>
    `;
  };

  const renderTrainer = (block: Extract<MsBlock, { kind: "trainer" }>): string => {
    const trainer = doc.trainers[block.trainerId];
    if (!trainer) return `<p class="msv-empty">Trainer ${block.trainerId} isn't in this ROM.</p>`;
    const scene = trainer.placements[0];
    const role = ROLE_LABELS[block.role];
    const slots = Array.from({ length: Math.max(6, trainer.party.length) }, (_, index) => trainer.party[index]);
    return `
      <article class="msv-trainer${block.role === "mandatory" ? " -mandatory" : ""}" id="t-${trainer.id}">
        <header class="msv-titlebar -fight">
          <h3><span class="msv-trainer__class">${esc(trainer.className)}</span> ${esc(trainer.name)}</h3>
          ${pokeballs(trainer.party.length)}
          <p class="msv-trainer__tags">
            ${role ? `<span class="msv-tag -${block.role}">${role}</span>` : ""}
            ${trainer.battleType !== "Singles" ? `<span class="msv-tag">${esc(trainer.battleType)}</span>` : ""}
          </p>
          ${hatch()}
        </header>
        <div class="msv-trainer__body">
          <div class="msv-trainer__info">
            <div class="msv-trainer__art${scene ? " -scene" : ""}">
              ${scene ? asset(assetKeys.scene(trainer.id), `${trainer.className} ${trainer.name} on ${scene.zoneName}`, "msv-scene") : asset(assetKeys.trainer(trainer.classId), `${trainer.className} ${trainer.name}`, "msv-battle-sprite")}
            </div>
            ${block.notes.length ? `<p class="msv-trainer__notes">${inline(block.notes)}</p>` : ""}
          </div>
          <ol class="msv-party">${slots.map((mon) => mon ? renderMon(mon) : `<li class="msv-mon -empty" aria-hidden="true"></li>`).join("")}</ol>
        </div>
      </article>
    `;
  };

  const renderMon = (mon: MsPartyMon): string => {
    const pokemon = doc.pokemon[mon.personalId];
    const ability = displayName(mon.ability);
    return `
      <li class="msv-mon">
        <button type="button" class="msv-mon__sprite" data-open="pokemon-${mon.personalId}" aria-label="${esc(mon.name)} details">${asset(assetKeys.pokemon(mon.species, mon.form), "", "msv-front")}</button>
        <p class="msv-mon__id">
          <button type="button" class="msv-mon__name" data-open="pokemon-${mon.personalId}" title="${esc(mon.name)}">${esc(mon.name)}</button>
          <span class="msv-mon__level">Lv ${mon.level}</span>
        </p>
        ${typeChips(pokemon?.types ?? [])}
        <button type="button" class="msv-mon__fact msv-plain${markClass(highlights, mon.ability)}" data-open="ability-${encodeURIComponent(mon.ability)}" title="Ability: ${esc(ability)}">${esc(ability)}</button>
        ${mon.item
          ? mon.item.id !== undefined
            ? `<button type="button" class="msv-mon__fact msv-held" data-open="item-${mon.item.id}" title="Held item: ${esc(mon.item.name)}">${asset(assetKeys.item(mon.item.id), "", "msv-item-icon")}<span>${esc(mon.item.name)}</span></button>`
            : `<span class="msv-mon__fact msv-held" title="Held item: ${esc(mon.item.name)}"><span>${esc(mon.item.name)}</span></span>`
          : `<span class="msv-mon__fact msv-held -none" title="No held item"><span>No item</span></span>`}
        <span class="msv-mon__fact msv-mon__nature" title="Nature: ${esc(mon.nature)}">${esc(mon.nature)}</span>
        <ul class="msv-moves">${Array.from({ length: 4 }, (_, index) => mon.moves[index]).map((ref) => {
          if (!ref) return `<li><span class="msv-hex -move -empty"><span>—</span></span></li>`;
          const move = doc.moves[ref.id];
          const type = (move?.type ?? "").toLowerCase();
          const mark = highlightOf(highlights, ref.name);
          const label = mark === "new" ? "New in this hack" : mark ? "Changed in this hack" : "";
          return `<li><button type="button" class="msv-hex -move${mark ? ` -${mark}` : ""}" style="--type:${TYPE_COLORS[type] ?? "#a0a0a0"}" data-open="move-${ref.id}" title="${esc([ref.name, move?.type, label].filter(Boolean).join(", "))}"><span>${esc(ref.name)}</span></button></li>`;
        }).join("")}</ul>
      </li>
    `;
  };

  // ---------- Drawer ----------

  const openDetail = (detail: Detail, push: boolean) => {
    if (push) {
      drawerStack.push(detail);
      pushedDetails += 1;
      const { page, anchor } = parseHash();
      history.pushState(null, "", hrefFor(page || currentPage, anchor, detail));
    } else {
      const last = drawerStack[drawerStack.length - 1];
      if (!last || last.kind !== detail.kind || last.id !== detail.id) drawerStack = [detail];
    }
    if (drawer.hidden) {
      keepReadingPlace(() => {
        drawer.hidden = false;
        shell.classList.add("-drawer-open");
      });
    }
    dexTab.setAttribute("aria-expanded", "true");
    drawerBack.hidden = drawerStack.length < 2;
    drawerBody.innerHTML = renderDetail(detail);
    drawerBody.scrollTop = 0;
    hydrateAssets(drawerBody);
    drawer.querySelector<HTMLElement>("[data-drawer-dex]")!.hidden = detail.kind === "dex";
    if (detail.kind === "dex") {
      const input = drawerBody.querySelector<HTMLInputElement>(".msv-dex__field input");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(input.value.length, input.value.length);
    } else {
      drawer.querySelector<HTMLElement>("[data-drawer-close]")?.focus({ preventScroll: true });
    }
  };

  /**
   * At 1600 px and wider the panel takes a column from the page, so the page re-wraps (six party columns become
   * three) and whatever you were reading moves. Keep the block at the top of the screen where it was.
   */
  const keepReadingPlace = (change: () => void) => {
    // The first block that starts on screen; if one block fills the screen, that block.
    const blocks = [...main.querySelectorAll<HTMLElement>(".msv-page > *")];
    const anchor = blocks.find((block) => block.getBoundingClientRect().top >= 0) ?? blocks.find((block) => block.getBoundingClientRect().bottom > 0);
    const before = anchor?.getBoundingClientRect().top;
    change();
    if (anchor && before !== undefined) {
      const shift = anchor.getBoundingClientRect().top - before;
      if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: "instant" });
    }
  };

  const closeDrawer = (updateUrl: boolean) => {
    if (drawer.hidden) return;
    keepReadingPlace(() => {
      drawer.hidden = true;
      shell.classList.remove("-drawer-open");
    });
    dexTab.setAttribute("aria-expanded", "false");
    drawerStack = [];
    if (updateUrl) {
      if (pushedDetails > 0) {
        const steps = pushedDetails;
        pushedDetails = 0;
        history.go(-steps);
      } else {
        const { page, anchor } = parseHash();
        history.replaceState(null, "", hrefFor(page || currentPage, anchor));
      }
    }
  };

  const renderDetail = (detail: Detail): string => {
    const { project } = context;
    if (detail.kind === "pokemon") {
      const info = getMastersheetPokemonDetail(project, Number(detail.id));
      const mon = doc.pokemon[Number(detail.id)];
      if (!info) return `<p class="msv-empty">This Pokémon couldn't be read.</p>`;
      const found = whereFound(Number(detail.id));
      return `
        <div class="msv-detail -pokemon">
          <header class="msv-titlebar -mon"><h2>${esc(info.name)}</h2>${hatch()}</header>
          <div class="msv-detail__hero">
            ${asset(assetKeys.pokemon(mon?.species ?? info.personalId, mon?.form ?? 0), "", "msv-front -large")}
            ${typeChips(info.types)}
          </div>
          <section><h3 class="msv-band"><span>Base stats</span>${hatch()}</h3>${statBars(info.stats)}</section>
          <section><h3 class="msv-band"><span>Abilities</span>${hatch()}</h3><ul class="msv-abilities">${info.abilities.map((ability) => `<li><strong class="${markClass(highlights, ability.name).trim()}">${esc(displayName(ability.name))}</strong>${ability.hidden ? `<span class="msv-tag">Hidden</span>` : ""}<p>${esc(ability.description)}</p></li>`).join("")}</ul></section>
          ${info.evolutions.length ? `<section><h3 class="msv-band"><span>Evolves into</span>${hatch()}</h3><ul class="msv-evolutions">${info.evolutions.map((evolution) => `<li><button type="button" class="msv-plain" data-open="pokemon-${evolution.targetId}">${esc(evolution.target)}</button><span>${esc(evolution.method)}</span></li>`).join("")}</ul></section>` : ""}
          ${found.length ? `<section><h3 class="msv-band -mon"><span>Where to find it in this sheet</span>${hatch()}</h3><ul class="msv-found">${found.map((entry) => `<li><a href="${hrefFor(entry.page, entry.anchor)}">${esc(entry.label)}</a><span>${esc(entry.detail)}</span></li>`).join("")}</ul></section>` : ""}
          ${renderWildElsewhere(Number(detail.id))}
          <section><h3 class="msv-band"><span>Level-up moves</span>${hatch()}</h3>
            <table class="msv-learnset"><thead><tr><th scope="col" class="-num">Lv</th><th scope="col">Move</th><th scope="col">Type</th><th scope="col" class="-num">Power</th><th scope="col" class="-num">Acc</th></tr></thead>
            <tbody>${info.learnset.map((entry) => `<tr><td class="-num">${entry.level}</td><th scope="row"><button type="button" class="msv-plain${markClass(highlights, entry.move.name)}" data-open="move-${entry.move.id}">${esc(entry.move.name)}</button></th><td>${typeChips([entry.move.type])}</td><td class="-num">${entry.move.power || "—"}</td><td class="-num">${entry.move.accuracy || "—"}</td></tr>`).join("")}</tbody></table>
          </section>
          <dl class="msv-detail__facts">
            <div><dt>Height</dt><dd>${info.height.toFixed(1)} m</dd></div>
            <div><dt>Weight</dt><dd>${info.weight.toFixed(1)} kg</dd></div>
            <div><dt>Catch rate</dt><dd>${info.catchRate}</dd></div>
            <div><dt>Egg groups</dt><dd>${esc(info.eggGroups.join(", "))}</dd></div>
          </dl>
        </div>`;
    }
    if (detail.kind === "move") {
      const move = getMastersheetMoveDetail(project, Number(detail.id));
      if (!move) return `<p class="msv-empty">This move couldn't be read.</p>`;
      const mark = highlightOf(highlights, move.name);
      return `
        <div class="msv-detail -move">
          <header class="msv-titlebar"><h2>${esc(move.name)}</h2>${hatch()}</header>
          <p class="msv-detail__tags">${typeChips([move.type])}<span class="msv-tag">${esc(move.category)}</span>${mark ? `<span class="msv-tag -${mark}">${mark === "new" ? "New in this hack" : "Changed in this hack"}</span>` : ""}</p>
          <dl class="msv-detail__stats">
            <div><dt>Power</dt><dd>${move.power || "—"}</dd></div>
            <div><dt>Accuracy</dt><dd>${move.accuracy ? `${move.accuracy}%` : "—"}</dd></div>
            <div><dt>PP</dt><dd>${move.pp}</dd></div>
            <div><dt>Priority</dt><dd>${move.priority > 0 ? `+${move.priority}` : move.priority}</dd></div>
            ${move.effectChance ? `<div><dt>Effect chance</dt><dd>${move.effectChance}%</dd></div>` : ""}
          </dl>
          ${move.description ? `<p class="msv-detail__desc">${esc(move.description)}</p>` : ""}
        </div>`;
    }
    if (detail.kind === "dex") {
      if (DEX_CATEGORIES.some(([key]) => key === detail.id)) dex.category = detail.id as DexCategory;
      return renderDex();
    }
    if (detail.kind === "wild") {
      const table = tableById(Number(detail.id));
      if (!table) return `<p class="msv-empty">This wild area couldn't be read.</p>`;
      const zone = table.zones[0];
      return `
        <div class="msv-detail -wild">
          <header class="msv-titlebar -mon"><h2>${esc(uniqueNames(table.zones.map((entry) => entry.name)).join(", ") || table.name)}</h2>${hatch()}</header>
          <section class="msv-wild" data-table="${table.id}"><div class="msv-wild__data">${wildInner(table)}</div></section>
          ${zone ? `<figure class="msv-wild__map -drawer"><button type="button" data-open="map-${zone.zoneId}" aria-label="Larger map of ${esc(zone.name)}">${asset(assetKeys.map(zone.zoneId), "", "msv-map")}</button><figcaption>${esc(zone.name)}</figcaption></figure>` : ""}
        </div>`;
    }
    if (detail.kind === "item") {
      const item = getMastersheetItemDetail(project, Number(detail.id));
      if (!item) return `<p class="msv-empty">This item couldn't be read.</p>`;
      return `
        <div class="msv-detail -item">
          <header class="msv-titlebar -bag"><h2>${esc(item.name)}</h2>${hatch()}</header>
          <div class="msv-detail__hero -item"><span class="msv-bag__plate">${asset(assetKeys.item(item.id), "", "msv-item-icon -large")}</span></div>
          ${item.description ? `<p class="msv-detail__desc">${esc(item.description)}</p>` : ""}
          ${renderItemSources(item.id)}
        </div>`;
    }
    if (detail.kind === "ability") {
      const name = decodeURIComponent(detail.id);
      const ability = getMastersheetAbilityDetail(project, name);
      return `
        <div class="msv-detail -ability">
          <header class="msv-titlebar"><h2>${esc(displayName(ability?.name ?? name))}</h2>${hatch()}</header>
          <p class="msv-detail__desc">${esc(ability?.description || "No description in this ROM.")}</p>
        </div>`;
    }
    const zoneId = Number(detail.id);
    const zone = Object.values(doc.encounters).flatMap((table) => table.zones).find((entry) => entry.zoneId === zoneId)
      ?? Object.values(doc.trainers).flatMap((trainer) => trainer.placements).map((placement) => ({ zoneId: placement.zoneId, name: placement.zoneName })).find((entry) => entry.zoneId === zoneId);
    return `
      <div class="msv-detail -map">
        <header class="msv-titlebar -mon"><h2>${esc(zone?.name ?? `Zone ${zoneId}`)}</h2>${hatch()}</header>
        ${asset(assetKeys.map(zoneId), `Map of ${zone?.name ?? `zone ${zoneId}`}`, "msv-map -large")}
      </div>`;
  };

  // ---------- Item locations ----------

  let itemSources: Map<number, MsItemSource[]> | undefined;
  /** Sheet pages by area name, and the page each trainer is on, so item sources can link into the sheet. */
  const pageByName = new Map(doc.pages.filter((page) => page.kind === "area").map((page) => [normalizeName(page.title), page.id]));
  const pageByTrainer = new Map(doc.pages.flatMap((page) => page.blocks.flatMap((block) => block.kind === "trainer" ? [[block.trainerId, page.id] as const] : [])));

  const renderItemSources = (itemId: number): string => {
    itemSources ??= getMastersheetItemSources(context.project);
    const sources = itemSources.get(itemId) ?? [];
    if (!sources.length) return `<section><h3 class="msv-band -bag"><span>Where to find it</span>${hatch()}</h3><p class="msv-empty">Not found on the ground, held by wild Pokémon, given by trainers or sold in this game.</p></section>`;
    const kinds: MsItemSourceKind[] = ["ground", "wild", "reward", "mart"];
    return kinds.map((kind) => {
      const list = sources.filter((source) => source.kind === kind);
      if (!list.length) return "";
      return `<section><h3 class="msv-band -bag"><span>${ITEM_SOURCE_LABELS[kind]}</span>${hatch()}</h3><ul class="msv-found">${list.map((source) => {
        const page = source.zoneName ? pageByName.get(normalizeName(source.zoneName)) : source.trainerId !== undefined ? pageByTrainer.get(source.trainerId) : undefined;
        const count = source.count > 1 ? `<span class="msv-found__count">×${source.count}</span>` : "";
        if (source.personalId !== undefined) return `<li><button type="button" class="msv-plain msv-found__link" data-open="pokemon-${source.personalId}">${esc(source.place)}</button></li>`;
        if (page) return `<li><a href="${hrefFor(page, source.trainerId !== undefined ? `t-${source.trainerId}` : undefined)}">${esc(source.place)}</a>${count}<span>In this sheet</span></li>`;
        return `<li><span class="msv-found__place">${esc(source.place)}</span>${count}</li>`;
      }).join("")}</ul></section>`;
    }).join("");
  };

  // ---------- Dex: look anything up, like the old ddex panel ----------

  /** Every Pokémon, move, item and ability the ROM names, plus the sheet's pages and every wild area in the game. */
  const buildDexIndex = (): DexEntry[] => {
    const { project } = context;
    const entries: DexEntry[] = [];
    const named = (bank: string[] | undefined, kind: DexEntry["kind"], limit = Infinity) => {
      (bank ?? []).forEach((raw, id) => {
        const name = displayName(String(raw ?? "").trim());
        if (id === 0 || id >= limit || !name || name === "-" || /^\?+$/u.test(name)) return;
        entries.push({ kind, id: String(id), name, terms: normalizeName(name) });
      });
    };
    named(project.texts.banks.pokedex, "pokemon", project.narcs.personal?.fileCount ?? Infinity);
    named(project.texts.banks.moves, "move");
    named(project.texts.banks.items, "item");
    named(project.texts.banks.abilities, "ability");
    for (const page of doc.pages) {
      if (page.kind === "area") entries.push({ kind: "area", id: page.id, page: page.id, name: page.title, note: "In this sheet", terms: normalizeName(page.title) });
    }
    for (const tableId of catalog.wildTableIds()) {
      const table = tableById(tableId);
      if (!table?.seasons.length) continue;
      const name = uniqueNames(table.zones.map((zone) => zone.name)).join(", ") || table.name;
      entries.push({ kind: "area", id: String(tableId), name, note: "Wild Pokémon", terms: normalizeName(name) });
    }
    return entries;
  };

  const dexMatches = (category: DexCategory, query: string): DexEntry[] => {
    dexIndex ??= buildDexIndex();
    const pool = category === "all" ? dexIndex : dexIndex.filter((entry) => entry.kind === category);
    const needle = normalizeName(query);
    if (!needle) return pool;
    return [...pool.filter((entry) => entry.terms.startsWith(needle)), ...pool.filter((entry) => !entry.terms.startsWith(needle) && entry.terms.includes(needle))];
  };

  const dexRow = (entry: DexEntry): string => {
    const { project } = context;
    switch (entry.kind) {
      case "pokemon": {
        const mon = catalog.pokemon(Number(entry.id));
        return `<li><button type="button" class="msv-dex__row" data-open="pokemon-${entry.id}">${asset(assetKeys.icon(Number(entry.id), 0), "", "msv-icon")}<span class="msv-dex__name">${esc(entry.name)}</span>${typeChips(mon?.types ?? [])}</button></li>`;
      }
      case "move": {
        const move = getMastersheetMove(project, Number(entry.id));
        return `<li><button type="button" class="msv-dex__row" data-open="move-${entry.id}"><span class="msv-dex__name${markClass(highlights, entry.name)}">${esc(entry.name)}</span>${typeChips(move ? [move.type] : [])}<span class="msv-dex__note">${esc(move ? `${move.category}${move.power ? `, ${move.power}` : ""}` : "")}</span></button></li>`;
      }
      case "item":
        return `<li><button type="button" class="msv-dex__row" data-open="item-${entry.id}">${asset(assetKeys.item(Number(entry.id)), "", "msv-item-icon")}<span class="msv-dex__name">${esc(entry.name)}</span></button></li>`;
      case "ability":
        return `<li><button type="button" class="msv-dex__row" data-open="ability-${encodeURIComponent(entry.name)}"><span class="msv-dex__name${markClass(highlights, entry.name)}">${esc(entry.name)}</span></button></li>`;
      case "area":
        return entry.page
          ? `<li><a class="msv-dex__row" href="${hrefFor(entry.page)}"><span class="msv-dex__name">${esc(entry.name)}</span><span class="msv-dex__note">${esc(entry.note ?? "")}</span></a></li>`
          : `<li><button type="button" class="msv-dex__row" data-open="wild-${entry.id}"><span class="msv-dex__name">${esc(entry.name)}</span><span class="msv-dex__note">${esc(entry.note ?? "")}</span></button></li>`;
    }
  };

  const renderDexResults = (): string => {
    const { category, query } = dex;
    if (category === "all") {
      if (!query.trim()) return `<p class="msv-dex__hint">Type a name to look up any Pokémon, move, item, ability or wild area in the game, or pick a list above.</p>`;
      const groups = DEX_CATEGORIES.slice(1).map(([kind, label]) => ({ kind, label, matches: dexMatches(kind, query) })).filter((group) => group.matches.length);
      if (!groups.length) return `<p class="msv-dex__hint">Nothing in the game matches “${esc(query)}”.</p>`;
      return groups.map((group) => `
        <section>
          <h3 class="msv-band"><span>${esc(group.label)}</span>${hatch()}</h3>
          <ul class="msv-dex__list">${group.matches.slice(0, 8).map(dexRow).join("")}</ul>
          ${group.matches.length > 8 ? `<button type="button" class="msv-hex -tab msv-dex__more" data-dex-category="${group.kind}"><span>Show all ${group.matches.length}</span></button>` : ""}
        </section>`).join("");
    }
    const matches = dexMatches(category, query);
    if (!matches.length) return `<p class="msv-dex__hint">No ${esc(DEX_CATEGORIES.find(([key]) => key === category)![1].toLowerCase())} match “${esc(query)}”.</p>`;
    const shown = matches.slice(0, 200);
    return `<ul class="msv-dex__list">${shown.map(dexRow).join("")}</ul>${matches.length > shown.length ? `<p class="msv-dex__hint">Showing ${shown.length} of ${matches.length}. Type to narrow the list.</p>` : ""}`;
  };

  const renderDex = (): string => `
    <div class="msv-detail -dex">
      <header class="msv-titlebar -run"><h2>Dex</h2>${hatch()}</header>
      <div class="msv-search msv-dex__field"><input type="search" value="${esc(dex.query)}" placeholder="Pokémon, move, item, ability or area" aria-label="Look up in the dex" autocomplete="off" spellcheck="false" /></div>
      <div class="msv-tabs__group msv-dex__tabs" role="tablist" aria-label="What to look up">${DEX_CATEGORIES.map(([key, label]) => `<button type="button" class="msv-hex -tab" role="tab" aria-selected="${key === dex.category}" data-dex-category="${key}"><span>${esc(label)}</span></button>`).join("")}</div>
      <div class="msv-dex__results" aria-live="polite">${renderDexResults()}</div>
    </div>`;

  const refreshDexResults = () => {
    const results = drawerBody.querySelector<HTMLElement>(".msv-dex__results");
    if (!results) return;
    results.innerHTML = renderDexResults();
    results.scrollTop = 0;
    hydrateAssets(results);
  };

  /** Wild tables across the whole game, by Pokémon: built once, when a Pokémon's details first ask. */
  const wildTablesFor = (personalId: number) => {
    if (!wildIndex) {
      wildIndex = new Map();
      for (const tableId of catalog.wildTableIds()) {
        const table = tableById(tableId);
        for (const season of table?.seasons ?? []) {
          for (const method of season.methods) {
            for (const slot of method.slots) {
              const list = wildIndex.get(slot.personalId) ?? [];
              let entry = list.find((candidate) => candidate.tableId === tableId);
              if (!entry) list.push(entry = { tableId, methods: new Set(), min: slot.minLevel, max: slot.maxLevel });
              entry.methods.add(method.label);
              entry.min = Math.min(entry.min, slot.minLevel);
              entry.max = Math.max(entry.max, slot.maxLevel);
              wildIndex.set(slot.personalId, list);
            }
          }
        }
      }
    }
    return wildIndex.get(personalId) ?? [];
  };

  /** Wild areas in the game that the sheet doesn't cover. */
  const renderWildElsewhere = (personalId: number): string => {
    const inSheet = new Set(doc.pages.flatMap((page) => page.blocks.flatMap((block) => block.kind === "encounter" ? [block.tableId] : [])));
    const elsewhere = wildTablesFor(personalId).filter((entry) => !inSheet.has(entry.tableId));
    if (!elsewhere.length) return "";
    return `<section><h3 class="msv-band"><span>Wild elsewhere in the game</span>${hatch()}</h3><ul class="msv-found">${elsewhere.map((entry) => {
      const table = tableById(entry.tableId);
      const name = uniqueNames((table?.zones ?? []).map((zone) => zone.name)).join(", ") || table?.name || `Table ${entry.tableId}`;
      return `<li><button type="button" class="msv-plain msv-found__link" data-open="wild-${entry.tableId}">${esc(name)}</button><span>${esc(`${[...entry.methods].join(", ")}, Lv ${entry.min === entry.max ? entry.min : `${entry.min}–${entry.max}`}`)}</span></li>`;
    }).join("")}</ul></section>`;
  };

  /** Pages where a Pokémon is wild or a gift. */
  const whereFound = (personalId: number): Array<{ page: string; anchor?: string; label: string; detail: string }> => {
    const out: Array<{ page: string; anchor?: string; label: string; detail: string }> = [];
    for (const page of doc.pages) {
      for (const block of page.blocks) {
        if (block.kind === "encounter") {
          const table = doc.encounters[block.tableId];
          const methods = new Set<string>();
          const levels: number[] = [];
          for (const season of table?.seasons ?? []) {
            for (const method of season.methods) {
              for (const slot of method.slots) {
                if (slot.personalId !== personalId) continue;
                methods.add(method.label);
                levels.push(slot.minLevel, slot.maxLevel);
              }
            }
          }
          if (methods.size) out.push({ page: page.id, anchor: `e-${block.tableId}`, label: page.title, detail: `${[...methods].join(", ")}, Lv ${Math.min(...levels)}–${Math.max(...levels)}` });
        }
        if (block.kind === "gifts" && block.entries.some((entry) => entry.personalId === personalId)) out.push({ page: page.id, label: page.title, detail: block.title || "Gift" });
      }
    }
    return out;
  };

  // ---------- Images ----------

  const hydrateAssets = (scope: HTMLElement) => {
    const images = [...scope.querySelectorAll<HTMLImageElement>("img[data-asset]:not([src])")];
    if (!images.length) return;
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target as HTMLImageElement;
        observer!.unobserve(image);
        loadImage(image);
      }
    }, { rootMargin: "600px 0px" });
    for (const image of images) observer.observe(image);
  };

  const loadImage = (image: HTMLImageElement) => {
    const key = image.dataset.asset!;
    image.closest(".msv-asset")?.classList.add("-loading");
    context.assets.url(key).then((url) => {
      if (image.closest(".msv-dex-tab")) {
        image.addEventListener("load", () => image.closest(".msv-dex-tab")?.classList.add("-icon"), { once: true });
      }
      if (image.closest(".msv-battle-sprite")) {
        image.addEventListener("load", () => {
          image.style.width = `${image.naturalWidth * 2}px`;
          image.style.height = `${image.naturalHeight * 2}px`;
        }, { once: true });
      }
      if (image.closest(".msv-type")) {
        image.addEventListener("load", () => {
          image.style.width = `${image.naturalWidth * 2}px`;
          image.style.height = `${image.naturalHeight * 2}px`;
          image.closest(".msv-type")?.classList.add("-icon");
        }, { once: true });
      }
      if (image.closest(".msv-front")) {
        // 2× (3× in the drawer) keeps every pixel square. The stylesheet only shrinks the rare sprite too big for its slot.
        image.addEventListener("load", () => {
          const scale = image.closest(".-large") ? 3 : 2;
          image.style.width = `${image.naturalWidth * scale}px`;
          image.style.height = `${image.naturalHeight * scale}px`;
        }, { once: true });
      }
      image.src = url;
      image.closest(".msv-asset")?.classList.remove("-loading");
    }, () => {
      image.closest(".msv-asset")?.classList.replace("-loading", "-missing");
      image.remove();
    });
  };

  // ---------- Events ----------

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const open = target.closest<HTMLElement>("[data-open]");
    if (open) {
      const [kind, ...rest] = open.dataset.open!.split("-");
      openDetail({ kind: kind as Detail["kind"], id: rest.join("-") }, true);
      return;
    }
    if (target.closest("[data-dex-tab]")) {
      // The tab pulls the panel out (to the dex) and pushes it back in.
      if (drawer.hidden) openDetail({ kind: "dex", id: dex.category }, true);
      else closeDrawer(true);
      return;
    }
    const dexCategory = target.closest<HTMLElement>("[data-dex-category]");
    if (dexCategory) {
      dex.category = dexCategory.dataset.dexCategory as DexCategory;
      for (const tab of drawerBody.querySelectorAll<HTMLElement>(".msv-dex__tabs [data-dex-category]")) tab.setAttribute("aria-selected", String(tab.dataset.dexCategory === dex.category));
      refreshDexResults();
      return;
    }
    const methodButton = target.closest<HTMLButtonElement>("[data-method],[data-season]");
    if (methodButton) {
      const section = methodButton.closest<HTMLElement>("[data-table]")!;
      const table = tableById(Number(section.dataset.table))!;
      const state = encounterState.get(table.id) ?? { season: table.seasons[0]!.season, method: table.seasons[0]!.methods[0]!.kind };
      if (methodButton.dataset.method) state.method = methodButton.dataset.method;
      if (methodButton.dataset.season) state.season = methodButton.dataset.season;
      encounterState.set(table.id, state);
      const data = section.querySelector<HTMLElement>(".msv-wild__data")!;
      data.innerHTML = wildInner(table);
      hydrateAssets(data);
      section.querySelector<HTMLElement>(methodButton.dataset.method ? `[data-method="${state.method}"]` : `[data-season="${state.season}"]`)?.focus();
      return;
    }
    if (target.closest("[data-drawer-close]")) {
      closeDrawer(true);
      return;
    }
    if (target.closest("[data-drawer-back]")) {
      history.back();
      return;
    }
    if (target.closest("[data-toggle-outline]")) {
      const open = !shell.classList.contains("-outline-open");
      shell.classList.toggle("-outline-open", open);
      outlineToggle.setAttribute("aria-expanded", String(open));
      if (open) searchInput.focus();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) {
      closeDrawer(true);
    } else if (event.key === "Escape" && shell.classList.contains("-outline-open")) {
      shell.classList.remove("-outline-open");
      outlineToggle.setAttribute("aria-expanded", "false");
      outlineToggle.focus();
    }
  });
  let dexTimer = 0;
  drawerBody.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>(".msv-dex__field input");
    if (!input) return;
    dex.query = input.value;
    window.clearTimeout(dexTimer);
    dexTimer = window.setTimeout(refreshDexResults, 100);
  });
  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
    if (event.key !== "/" || typing || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const current = drawerStack[drawerStack.length - 1];
    if (current?.kind === "dex") drawerBody.querySelector<HTMLInputElement>(".msv-dex__field input")?.focus();
    else openDetail({ kind: "dex", id: dex.category }, true);
  });
  let searchTimer = 0;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderNav, 120);
  });
  window.addEventListener("popstate", () => {
    const { detail } = parseHash();
    if (pushedDetails > 0) pushedDetails -= 1;
    if (detail && drawerStack.length > 1) drawerStack.pop();
    route();
  });
  window.addEventListener("hashchange", route);

  route();
  hydrateAssets(dexTab);
}

// ---------- Helpers ----------

function asset(key: string, alt: string, className: string): string {
  return `<span class="msv-asset ${className}"><img data-asset="${esc(key)}" alt="${esc(alt)}" decoding="async"></span>`;
}

/** Types as the game draws them: its own type icons from the ROM, with a coloured plate as the fallback. */
function typeChips(types: string[]): string {
  return `<span class="msv-types">${types.filter(Boolean).map((type) => {
    const key = type.toLowerCase();
    const index = typeIndexByName.get(normalizeName(type));
    const icon = index !== undefined ? `<img data-asset="${esc(assetKeys.type(index))}" alt="${esc(type)}" decoding="async">` : "";
    return `<span class="msv-type${LIGHT_INK_TYPES.has(key) ? " -light-ink" : ""}" style="--type:${TYPE_COLORS[key] ?? "#a0a0a0"}" title="${esc(type)}">${icon}<span class="msv-type__text"${icon ? ' aria-hidden="true"' : ""}>${esc(type)}</span></span>`;
  }).join("")}</span>`;
}

/** The diagonal hatching at the end of Gen 5 title bars. */
function hatch(): string {
  return `<svg class="msv-hatch" viewBox="0 0 40 16" aria-hidden="true" focusable="false"><path d="M0 16 6 0h4L4 16ZM10 16 16 0h4l-6 16ZM20 16 26 0h4l-6 16ZM30 16 36 0h4l-6 16Z"/></svg>`;
}

/** The battle screen's team row: a Poké Ball for each party member, an empty ring for each free slot. */
function pokeballs(count: number): string {
  const balls = Array.from({ length: Math.max(6, count) }, (_, index) => index < count
    ? `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="5.25" fill="#f0f0f8" stroke="#181818" stroke-width="1.5"/><path d="M.75 6a5.25 5.25 0 0 1 10.5 0Z" fill="#f82018"/><path d="M.75 6h10.5" stroke="#181818" stroke-width="1.5"/><circle cx="6" cy="6" r="1.75" fill="#f0f0f8" stroke="#181818" stroke-width="1.25"/></svg>`
    : `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#606060" stroke-width="1.5"/></svg>`).join("");
  return `<span class="msv-balls" role="img" aria-label="${count} Pokémon">${balls}</span>`;
}

/** Retail names are stored in capitals ("STURDY"); show them the way the hack's own names read. */
function displayName(name: string): string {
  return titleCase(name);
}

function statBars(stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }): string {
  const rows: Array<[string, number]> = [["HP", stats.hp], ["Attack", stats.atk], ["Defense", stats.def], ["Sp. Atk", stats.spa], ["Sp. Def", stats.spd], ["Speed", stats.spe]];
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  // Bars are measured against 180 and snap to 2 px steps, the DS pixel grid.
  return `<dl class="msv-stats">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd><span class="msv-stats__value">${value}</span><span class="msv-stats__bar" aria-hidden="true"><span style="width:${Math.min(100, Math.round(value / 1.8 / 2) * 2)}%"></span></span></dd></div>`).join("")}<div class="-total"><dt>Total</dt><dd><span class="msv-stats__value">${total}</span></dd></div></dl>`;
}

function inline(parts: MsInline[]): string {
  return parts.map((part) => part.type === "link" ? `<a href="${esc(safeUrl(part.href))}" target="_blank" rel="noopener noreferrer">${esc(part.text)}</a>` : esc(part.text)).join("");
}

function safeUrl(href: string): string {
  return /^(https?:|mailto:|#)/iu.test(href) ? href : "#";
}

function sentenceCase(text: string): string {
  return text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text;
}

function uniqueNames(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) === index);
}

/** One row per species: chances add up, levels span every slot. */
function aggregateSlots(slots: MsEncounterTable["seasons"][number]["methods"][number]["slots"]) {
  const rows = new Map<number, { personalId: number; species: number; form: number; name: string; minLevel: number; maxLevel: number; chance: number }>();
  for (const slot of slots) {
    const row = rows.get(slot.personalId);
    if (row) {
      row.chance += slot.chance;
      row.minLevel = Math.min(row.minLevel, slot.minLevel);
      row.maxLevel = Math.max(row.maxLevel, slot.maxLevel);
    } else {
      rows.set(slot.personalId, { ...slot });
    }
  }
  return [...rows.values()].sort((a, b) => b.chance - a.chance);
}

type HighlightKind = "changed" | "minor" | "new";

function highlightIndex(doc: MastersheetDocument): Map<string, HighlightKind> {
  const index = new Map<string, HighlightKind>();
  for (const kind of ["minor", "changed", "new"] as const) {
    for (const name of Object.keys(doc.highlights[kind] ?? {})) index.set(normalizeName(name), kind);
  }
  return index;
}

function highlightOf(index: Map<string, HighlightKind>, name: string): HighlightKind | undefined {
  return index.get(normalizeName(name));
}

function markClass(index: Map<string, HighlightKind>, name: string): string {
  const kind = highlightOf(index, name);
  return kind ? ` -${kind}` : "";
}

type SearchEntry = { label: string; where: string; page: string; anchor?: string; terms: string };

function buildSearchIndex(doc: MastersheetDocument): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const page of doc.pages) {
    const split = doc.splits.find((candidate) => candidate.id === page.splitId);
    const kind = page.kind === "intro" ? (split ? "Split" : "Introduction") : split?.title ?? "Area";
    entries.push({ label: page.title, where: kind, page: page.id, terms: normalizeName(page.title) });
    for (const block of page.blocks) {
      if (block.kind === "trainer") {
        const trainer = doc.trainers[block.trainerId];
        if (!trainer) continue;
        entries.push({
          label: `${trainer.className} ${trainer.name}`,
          where: page.title,
          page: page.id,
          anchor: `t-${trainer.id}`,
          terms: normalizeName(`${trainer.className} ${trainer.name} ${trainer.party.map((mon) => mon.name).join(" ")}`),
        });
      }
      if (block.kind === "encounter") {
        const table = doc.encounters[block.tableId];
        const names = uniqueNames((table?.seasons ?? []).flatMap((season) => season.methods.flatMap((method) => method.slots.map((slot) => slot.name))));
        for (const name of names) entries.push({ label: `Wild ${name}`, where: page.title, page: page.id, anchor: `e-${block.tableId}`, terms: normalizeName(name) });
      }
      if (block.kind === "items" || block.kind === "gifts") {
        for (const entry of block.entries) entries.push({ label: entry.name, where: page.title, page: page.id, terms: normalizeName(entry.name) });
      }
      if (block.kind === "heading") entries.push({ label: block.text, where: page.title, page: page.id, anchor: block.id, terms: normalizeName(block.text) });
    }
  }
  return entries;
}

function searchSheet(index: SearchEntry[], query: string): SearchEntry[] {
  const needle = normalizeName(query);
  if (!needle) return [];
  const starts = index.filter((entry) => entry.terms.startsWith(needle));
  const contains = index.filter((entry) => !entry.terms.startsWith(needle) && entry.terms.includes(needle));
  return [...starts, ...contains].slice(0, 60);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
