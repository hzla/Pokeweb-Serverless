import { CATEGORIES, TYPES } from "../pokeweb/constants";
import { getMoveAutofills, titleize } from "../pokeweb/moveItemModel";
import { getTmEntries, type TmEntry } from "../pokeweb/tmModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachTmInteractions } from "./tmInteractions";
import { publicAsset } from "../assetUrl";

export function renderTmEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter move-filter tm-filter">
      <div class="filter-title">Search Text</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <div class="small-filters cat-filters">
        ${["physical", "special", "status"].map((cat) => `<button class="btn -default btn-3" data-mcat="${cat}" type="button"><img src="${publicAsset(`images/move-${cat}.png`)}" alt="${cat}"></button>`).join("")}
      </div>
      <div class="small-filters type-filters">
        ${TYPES.map((type) => `<button class="btn -default btn-5 -${type.toLowerCase()}" data-ptype="${type.toLowerCase()}" type="button">${type.toUpperCase().slice(0, 3)}</button>`).join("")}
      </div>
    </div>
    <div class="pokemon-list pokemon-move-list spreadsheet tm-list" id="moves">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="move-name" data-narc="learnset">Name</div>
          <div class="move-type">Type</div>
          <div class="move-cat" data-field-name="category">Item Name</div>
          <div class="move-effect">Effect</div>
          <div class="move-power">Pow</div>
          <div class="move-accuracy">Acc</div>
        </div>
      </div>
      ${renderTmRows(project)}
    </div>
  `;

  attachTmInteractions(root, project, {
    onDirty,
    autofills: { ...getMoveAutofills(), move_names: project.texts.banks.moves ?? [] },
    renderRow: (entry) => renderTmRow(entry),
  });
}

export function renderTmRow(entry: TmEntry): string {
  const move = entry.move;
  const readable = move?.readable;
  const type = String(readable?.type ?? "");
  const label = `${entry.kind.toUpperCase()}-${entry.number}`;
  return `
    <div class="expanded-field filterable tm-card" data-index="tms" data-tm-field="${entry.field}" data-move-index="${entry.moveId}">
      <div class="expanded-field-main">
        <div class="move-name" data-autofill="move_names" data-narc="tm" contenteditable="true" data-autocomplete-spy data-field-name="${entry.field}">
          ${escapeHtml(entry.moveName)}
        </div>
        <div class="move-type">
          ${type ? `<div class="btn -${typeClass(type)} -active" type="button">${escapeHtml(type)}</div>` : ""}
        </div>
        <div class="move-cat">${escapeHtml(label)}</div>
        <div class="move-effect">${escapeHtml(String(readable?.effect ?? ""))}</div>
        <div class="move-power">${escapeHtml(String(readable?.power ?? ""))}</div>
        <div class="move-accuracy">${escapeHtml(String(readable?.accuracy ?? ""))}</div>
      </div>
    </div>
  `;
}

function renderTmRows(project: ProjectState): string {
  return getTmEntries(project).map((entry) => renderTmRow(entry)).join("");
}

function typeClass(type: string): string {
  return titleize(type).toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}
