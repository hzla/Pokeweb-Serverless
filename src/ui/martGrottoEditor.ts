import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import {
  GROTTO_ITEM_RARITIES,
  GROTTO_ITEM_TYPES,
  GROTTO_POKEMON_RARITIES,
  GROTTO_VERSIONS,
  getGrottoAutofills,
  getGrottoCount,
  getGrottoOdds,
  getGrottoRecord,
  getMartAutofills,
  getMartCount,
  getMartRecord,
  remainingHiddenCommonOdd,
  type GrottoRecord,
  type MartRecord,
} from "../pokeweb/martGrottoModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachGrottoInteractions, attachGrottoOddsInteractions, attachMartInteractions } from "./martGrottoInteractions";
import { publicAsset } from "../assetUrl";

export function renderMartEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter mart-filter">
      <div class="filter-title">Search Text</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
    </div>
    <div class="pokemon-list spreadsheet" id="marts">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="mart-id">ID</div>
          <div class="mart-name">Location/Description</div>
          <div class="mart-inv">Inventory</div>
        </div>
      </div>
      ${renderMartRows(project)}
    </div>
  `;

  attachMartInteractions(root, project, {
    onDirty,
    autofills: getMartAutofills(project),
    renderPanel: (martId) => renderMartPanel(getMartRecord(project, martId)),
  });
}

export function renderGrottoEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, showOdds?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter grotto-filter">
      <div class="filter-title">Search</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <button class="btn -default" id="edit-odds" type="button">Edit Odds</button>
    </div>
    <div class="pokemon-list spreadsheet" id="grottos">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="grotto-id">ID</div>
          <div class="grotto-location">Location</div>
          <div class="grotto-wilds">Encounters</div>
        </div>
      </div>
      ${renderGrottoRows(project)}
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#edit-odds")?.addEventListener("click", () => showOdds?.());
  attachGrottoInteractions(root, project, {
    onDirty,
    autofills: getGrottoAutofills(project),
    renderRow: (grottoId) => renderGrottoRow(project, grottoId),
    renderPanel: (grottoId) => renderGrottoPanel(project, getGrottoRecord(project, grottoId)),
  });
}

export function renderGrottoOddsEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, showGrottos?: () => void): void {
  const odds = getGrottoOdds(project).readable;
  root.innerHTML = `
    <div class="pokemon-filter grotto-odds-filter">
      SR = Super Rare
      <br><br>
      R = Rare
      <br><br>
      UC = Uncommon
      <br><br>
      CM = Common
      <br><br>
      H-Item = Hidden Item
      <br><br>
      CM H-Item = 100 - all other odds
      <button class="btn -default" id="back-grottos" type="button">Grottos</button>
    </div>
    <div class="pokemon-list pokemon-move-list spreadsheet tm-list" id="grotto-odds">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="odds-header grotto-name">Name</div>
          <div class="odds-header">R Pok</div>
          <div class="odds-header">UC Pok</div>
          <div class="odds-header">CM Pok</div>
          <div class="odds-header">SR Item</div>
          <div class="odds-header">R Item</div>
          <div class="odds-header">UC Item</div>
          <div class="odds-header">CM Item</div>
          <div class="odds-header">SR H-Item</div>
          <div class="odds-header">R H-Item</div>
          <div class="odds-header">UC H-Item</div>
        </div>
      </div>
      ${Array.from({ length: Math.min(20, getGrottoCount(project)) }, (_, id) => renderGrottoOddsRow(project, id, odds)).join("")}
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#back-grottos")?.addEventListener("click", () => showGrottos?.());
  attachGrottoOddsInteractions(root, project, { onDirty });
}

function renderMartRows(project: ProjectState): string {
  return Array.from({ length: getMartCount(project) }, (_, id) => renderMartRow(getMartRecord(project, id))).join("");
}

function renderMartRow(mart: MartRecord): string {
  return `
    <div class="expanded-field filterable mart-card" data-index="${mart.id}">
      <div class="expanded-field-main">
        <div class="mart-id">${mart.id}</div>
        <div class="mart-name">${escapeHtml(String(mart.readable.name ?? "-"))}</div>
        <div class="mart-inv">${escapeHtml(mart.inventory)}</div>
        <div class="move-info expand-action expand-mart svg no-fill" data-expand="mart">${miscDataIcon}</div>
      </div>
    </div>
  `;
}

function renderMartPanel(mart: MartRecord): string {
  return `
    <div class="expanded-card-content expanded-mart">
      ${[[0, 9], [10, 19]]
        .map(
          ([start, end]) => `
            <div class="expanded-left">
              ${Array.from({ length: end - start + 1 }, (_, index) => start + index)
                .map((n) => `<div class="expanded-field">${editable("mart", `item_${n}`, "mart-item", mart.readable[`item_${n}`], { autofill: "items" })}</div>`)
                .join("")}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderGrottoRows(project: ProjectState): string {
  return Array.from({ length: getGrottoCount(project) }, (_, id) => renderGrottoRow(project, id)).join("");
}

export function renderGrottoRow(project: ProjectState, grottoId: number): string {
  const grotto = getGrottoRecord(project, grottoId);
  return `
    <div class="expanded-field filterable grotto-card" data-index="${grotto.id}">
      <div class="expanded-field-main">
        <div class="grotto-id">${grotto.id}</div>
        <div class="grotto-location">${escapeHtml(String(grotto.readable.name ?? ""))}</div>
        <div class="grotto-wilds">
          ${grotto.wilds.map((wild, index) => renderWild(wild, grotto.spriteSlugs[index])).join("")}
        </div>
        <div class="move-info expand-action expand-grotto svg no-fill" data-expand="grotto">${miscDataIcon}</div>
      </div>
    </div>
  `;
}

function renderGrottoPanel(project: ProjectState, grotto: GrottoRecord): string {
  return `
    <div class="expanded-card-content expanded-grotto">
      ${GROTTO_VERSIONS.map((version) => GROTTO_POKEMON_RARITIES.map((rarity) => renderGrottoPokemonColumn(project, grotto, version, rarity)).join("")).join("")}
      ${GROTTO_ITEM_TYPES.map((itemType) => GROTTO_ITEM_RARITIES.map((rarity) => renderGrottoItemColumn(project, grotto, itemType, rarity)).join("")).join("")}
    </div>
  `;
}

function renderGrottoPokemonColumn(project: ProjectState, grotto: GrottoRecord, version: string, rarity: string): string {
  const odds = getGrottoOdds(project).readable[`${rarity}_pok_odds_${grotto.id}`] ?? 0;
  return `
    <div class="expanded-left">
      <div class="expanded-field multi field-header">
        <div class="enc-slot">${escapeHtml(titleize(version))} ${odds}%</div>
        <div class="enc-lvl">Min</div>
        <div class="enc-lvl">Max</div>
        <div class="enc-lvl">F/M</div>
        <div class="enc-form">Form</div>
      </div>
      ${Array.from({ length: 4 }, (_, n) => {
        const base = `${version}_${rarity}`;
        return `
          <div class="expanded-field multi">
            ${editable("grotto", `${base}_pok_${n}`, "enc-slot enc-name", grotto.readable[`${base}_pok_${n}`], { autofill: "pokemon_names" })}
            ${editable("grotto", `${base}_min_lvl_${n}`, "enc-lvl", grotto.readable[`${base}_min_lvl_${n}`], { type: "int-100" })}
            ${editable("grotto", `${base}_max_lvl_${n}`, "enc-lvl", grotto.readable[`${base}_max_lvl_${n}`], { type: "int-100" })}
            ${editable("grotto", `${base}_gender_${n}`, "enc-lvl", grotto.readable[`${base}_gender_${n}`], { type: "int-100" })}
            ${editable("grotto", `${base}_form_${n}`, "enc-form", grotto.readable[`${base}_form_${n}`], { type: "int-100" })}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderGrottoItemColumn(project: ProjectState, grotto: GrottoRecord, itemType: string, rarity: string): string {
  const odds =
    itemType === "hidden" && rarity === "common"
      ? remainingHiddenCommonOdd(project, grotto.id)
      : (getGrottoOdds(project).readable[`${rarity}_${itemType}_item_odds_${grotto.id}`] ?? 0);
  return `
    <div class="expanded-left grotto-item">
      <div class="expanded-field multi field-header">
        <div class="enc-slot">${escapeHtml(titleize(itemType))} Items ${odds}%</div>
      </div>
      ${Array.from({ length: 4 }, (_, n) =>
        `<div class="expanded-field multi">${editable("grotto", `${itemType}_${rarity}_item_${n}`, "grotto-item-name", grotto.readable[`${itemType}_${rarity}_item_${n}`], { autofill: "items" })}</div>`,
      ).join("")}
    </div>
  `;
}

function renderGrottoOddsRow(project: ProjectState, grottoId: number, odds: Record<string, string | number>): string {
  const grotto = getGrottoRecord(project, grottoId);
  return `
    <div class="expanded-field filterable grotto-odds-card" data-index="${grottoId}">
      <div class="expanded-field-main">
        <div class="grotto-name" data-narc="grotto">${escapeHtml(String(grotto.readable.name ?? ""))}</div>
        ${["rare", "uncommon", "common"].map((rarity) => oddsEditable(`${rarity}_pok_odds_${grottoId}`, odds[`${rarity}_pok_odds_${grottoId}`])).join("")}
        ${["superrare", "rare", "uncommon", "common"].map((rarity) => oddsEditable(`${rarity}_normal_item_odds_${grottoId}`, odds[`${rarity}_normal_item_odds_${grottoId}`])).join("")}
        ${["superrare", "rare", "uncommon"].map((rarity) => oddsEditable(`${rarity}_hidden_item_odds_${grottoId}`, odds[`${rarity}_hidden_item_odds_${grottoId}`])).join("")}
      </div>
    </div>
  `;
}

function renderWild(name: string, slug: string): string {
  const missingSprite = publicAsset("images/pokesprite/-.png");
  return `
    <div class="wild">
      <img src="${publicAsset(`images/pokesprite/${slug}.png`)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.src='${missingSprite}'">
    </div>
  `;
}

function editable(narc: "mart" | "grotto", field: string, className: string, value: unknown, options: { autofill?: string; type?: string } = {}): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}>${escapeHtml(String(value ?? ""))}</div>`;
}

function oddsEditable(field: string, value: unknown): string {
  return `<div data-narc="grotto" class="odds-item" data-type="int-100" contenteditable="true" data-field-name="${field}">${escapeHtml(String(value ?? 0))}</div>`;
}

function titleize(value: string): string {
  return value
    .replace(/_/gu, " ")
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}
