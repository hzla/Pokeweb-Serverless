import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import { PROPERTIES, TYPES, CATEGORIES } from "../pokeweb/constants";
import {
  getItemCount,
  getItemRecord,
  getMoveAutofills,
  getMoveCount,
  getMoveRecord,
  ITEM_EXPANDED_FIELDS,
  MOVE_EFFECT_FIELDS,
  MOVE_MISC_FIELDS,
  MOVE_STAT_FIELDS,
  titleize,
  type ItemRecord,
  type MoveRecord,
} from "../pokeweb/moveItemModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachItemInteractions, attachMoveInteractions } from "./moveItemInteractions";
import { publicAsset } from "../assetUrl";

export function renderMoveEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter move-filter">
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
    <div class="pokemon-list pokemon-move-list spreadsheet" id="moves">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="move-name" data-narc="learnset">Name</div>
          <div class="move-type">Type</div>
          <div class="move-cat" data-field-name="category">Category</div>
          <div class="move-effect">Effect</div>
          <div class="move-power">Pow</div>
          <div class="move-accuracy">Acc</div>
        </div>
      </div>
      ${renderMoveRows(project)}
    </div>
  `;

  attachMoveInteractions(root, project, {
    onDirty,
    autofills: getMoveAutofills(),
    renderExpanded: (moveId) => renderMoveExpanded(getMoveRecord(project, moveId)),
  });
}

export function renderItemEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter item-filter">
      <div class="filter-title">Search Text</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
    </div>
    <div class="pokemon-list spreadsheet" id="items">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="item-id">ID</div>
          <div class="item-name">Name</div>
          <div class="item-value">Market Value</div>
        </div>
      </div>
      ${renderItemRows(project)}
    </div>
  `;

  attachItemInteractions(root, project, {
    onDirty,
    renderExpanded: (itemId) => renderItemExpanded(getItemRecord(project, itemId)),
  });
}

function renderMoveRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let id = 0; id < getMoveCount(project); id += 1) rows.push(renderMoveRow(getMoveRecord(project, id)));
  return rows.join("");
}

function renderItemRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let id = 0; id < getItemCount(project); id += 1) rows.push(renderItemRow(getItemRecord(project, id)));
  return rows.join("");
}

function renderMoveRow(move: MoveRecord): string {
  const type = String(move.readable.type ?? "");
  const category = String(move.readable.category ?? "");
  return `
    <div class="expanded-field filterable move-card" data-index="${move.id}" data-move-index="${move.id}">
      <div class="expanded-field-main">
        <div class="move-name" data-narc="learnset">${move.id} - ${escapeHtml(titleize(String(move.readable.name ?? `Move ${move.id}`)))}</div>
        <div class="move-type">${editable("move", "type", type, `btn -${typeClass(type)} -active`, { autofill: "types" })}</div>
        <div class="move-cat" data-field-name="category" data-narc="move">
          ${renderCategoryImages(category)}
        </div>
        ${editable("move", "effect", move.readable.effect, "move-effect", { autofill: "effects" })}
        ${editable("move", "power", move.readable.power, "move-power", { type: "int-255" })}
        ${editable("move", "accuracy", move.readable.accuracy, "move-accuracy", { type: "int-101" })}
        <div class="move-info expand-action expand-move svg no-fill" data-expand="move">${miscDataIcon}</div>
      </div>
    </div>
  `;
}

function renderMoveExpanded(move: MoveRecord): string {
  return `
    <div class="expanded-card-content expanded-move">
      <div class="expanded-left">
        ${MOVE_EFFECT_FIELDS.map(([label, field, autofillOrType]) => expandedField(label, editable("move", field, move.readable[field], "expanded-field-value", inputOptions(autofillOrType)))).join("")}
      </div>
      <div class="expanded-mid">
        ${MOVE_STAT_FIELDS.map(([label, field, autofillOrType]) => expandedField(label, editable("move", field, move.readable[field], "expanded-field-value", inputOptions(autofillOrType)))).join("")}
      </div>
      <div class="expanded-right">
        ${MOVE_MISC_FIELDS.map(([label, field, type]) => expandedField(label, editable("move", field, field === "animation" ? move.readable.animation : move.readable[field], "expanded-field-value ev-field", { type }))).join("")}
        <button class="script-btn move-animation-toggle" type="button">Edit Anim Script</button>
      </div>
      <div class="move-animation-editor" data-loaded="false"></div>
      <div class="expanded-row expanded-move-props" data-narc="move">
        ${PROPERTIES.map((prop) => `<div class="move-prop svg ${Number(move.readable[prop]) > 0 ? "-active" : ""}" data-field-name="${escapeHtml(prop)}"><img src="${publicAsset(`svgs/${prop}.svg`)}" alt=""><div class="prop-info">${escapeHtml(titleize(prop.replace(/_/gu, " ")))}</div></div>`).join("")}
      </div>
    </div>
  `;
}

function renderItemRow(item: ItemRecord): string {
  return `
    <div class="expanded-field filterable item-card" data-index="${item.id}">
      <div class="expanded-field-main">
        <div class="item-id">${item.id}</div>
        <div class="item-name">${escapeHtml(String(item.readable.name ?? `Item ${item.id}`))}</div>
        ${editable("item", "market_value", item.readable.market_value, "item-value", { type: "int-65535" })}
        <div class="move-info expand-action expand-item svg no-fill" data-expand="item">${miscDataIcon}</div>
      </div>
    </div>
  `;
}

function renderItemExpanded(item: ItemRecord): string {
  return `
    <div class="expanded-card-content expanded-item">
      ${ITEM_EXPANDED_FIELDS.map(
        (column) => `
          <div class="expanded-left">
            ${column.map(([max, field]) => expandedField(titleize(field.replace(/_/gu, " ")), editable("item", field, item.readable[field], `item-${field}`, { type: `int-${max}` }), "header-label")).join("")}
          </div>
        `,
      ).join("")}
    </div>
  `;
}

function renderCategoryImages(category: string): string {
  return CATEGORIES.map((cat) => {
    const active = cat.toLowerCase() === category.toLowerCase();
    return `<img src="${publicAsset(`images/move-${cat.toLowerCase()}.png`)}" class="${active ? "chosen" : "unchosen"} choosable" data-value="${cat.toLowerCase()}" alt="${cat}">`;
  }).join("");
}

function expandedField(label: string, value: string, labelClass = "expanded-field-name"): string {
  return `
    <div class="expanded-field">
      <div class="${labelClass}">${escapeHtml(label)}</div>
      ${value}
    </div>
  `;
}

function editable(
  narc: "move" | "item",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}>${escapeHtml(String(value ?? ""))}</div>`;
}

function inputOptions(value: string): { autofill?: string; type?: string } {
  return value.startsWith("int-") ? { type: value } : { autofill: value };
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}
