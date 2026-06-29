import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import movieIconUrl from "../assets/svgs/movie.png";
import { PROPERTIES, CATEGORIES, typeNamesForProject } from "../pokeweb/constants";
import {
  decompileMoveAnimation,
  getMoveAnimationTargetInfo,
  hasMoveAnimationScript,
  type MoveAnimationTargetInfo,
} from "../pokeweb/moveAnimationModel";
import {
  getItemCount,
  getItemRecord,
  getMoveAutofills,
  getMoveCount,
  getMoveRecord,
  EFFECTS,
  ITEM_FIELD_LABELS,
  ITEM_PACKED_FIELDS,
  MOVE_EFFECT_FIELDS,
  MOVE_MISC_FIELDS,
  MOVE_STAT_FIELDS,
  titleize,
  type ItemRecord,
  type MoveRecord,
} from "../pokeweb/moveItemModel";
import { getMoveTextInfo, hasMoveTextBanks, type MoveTextInfo, type MoveTextLine, type MoveTextSection } from "../pokeweb/moveTextModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachItemInteractions, attachMoveInteractions, installMoveAnimationEditor, renderMoveAnimationEditor } from "./moveItemInteractions";
import { attachW2uSyncButton, renderW2uSyncButton } from "./w2uLocalSync";
import { publicAsset } from "../assetUrl";

type ItemFieldSpec = readonly [field: string, max: number];

const ITEM_DETAIL_SECTIONS: Array<{ title: string; fields: readonly ItemFieldSpec[] }> = [
  {
    title: "Overview",
    fields: [
      ["item_type", 255],
      ["name_order_id", 255],
      ["gain_values", 255],
      ["nature_gift_power", 1],
    ],
  },
  {
    title: "Use Routing",
    fields: [
      ["item_group", 255],
      ["battle_item_group", 255],
      ["usability_flag", 255],
      ["consumable_flag", 255],
      ["type_attribute", 65535],
    ],
  },
  {
    title: "Battle Behavior",
    fields: [
      ["battle_flags", 255],
      ["berry_flags", 255],
      ["held_flags", 255],
      ["unknown_flag_1", 255],
    ],
  },
  {
    title: "Stat Boosts",
    fields: [
      ["hp_atk_boost", 255],
      ["def_spatk_boost", 255],
      ["spd_spdef_boost", 255],
      ["acc_crit_pp_boost", 255],
    ],
  },
  {
    title: "Recovery And Status",
    fields: [
      ["status_removal_flag", 255],
      ["pp_flags", 65535],
      ["hp_gain", 255],
      ["pp_gain", 255],
    ],
  },
  {
    title: "EV And Friendship",
    fields: [
      ["hp_ev_gain", 255],
      ["atk_ev_gain", 255],
      ["def_ev_gain", 255],
      ["spd_ev_gain", 255],
      ["spatk_ev_gain", 255],
      ["spdef_ev_gain", 255],
      ["battle_happiness", 1],
      ["ow_happiness", 1],
      ["hold_happiness", 1],
    ],
  },
];

const textIcon = `
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M8 7.5h16M8 13.5h16M8 19.5h12M8 25.5h9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.6"/>
  </svg>
`;

export function renderMoveEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onTestMove?: (moveId: number, scriptText: string) => Promise<void>,
  onOpenMoveAnimation?: (moveId: number) => void,
): void {
  root.innerHTML = `
    <div class="pokemon-filter move-filter">
      <div class="filter-title">Search Text</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <div class="small-filters cat-filters">
        ${["physical", "special", "status"].map((cat) => `<button class="btn -default btn-3" data-mcat="${cat}" type="button"><img src="${publicAsset(`images/move-${cat}.png`)}" alt="${cat}"></button>`).join("")}
      </div>
      <div class="small-filters type-filters">
        ${typeNamesForProject(project).map((type) => `<button class="btn -default btn-5 -${type.toLowerCase()}" data-ptype="${type.toLowerCase()}" type="button">${type.toUpperCase().slice(0, 3)}</button>`).join("")}
      </div>
      ${renderW2uSyncButton(project, ["moves"])}
      <div class="move-command-reference" id="move-command-reference">
        <div class="move-command-reference-empty">Click a script command to view its parameters here.</div>
      </div>
    </div>
    <div class="pokemon-list pokemon-move-list spreadsheet" id="moves">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="move-name" data-narc="learnset">Name</div>
          <div class="move-type">Type</div>
          <div class="move-cat" data-field-name="category">Category</div>
          <div class="move-effect">AI Effect Handler</div>
          <div class="move-power">Pow</div>
          <div class="move-accuracy">Acc</div>
        </div>
      </div>
      ${renderMoveRows(project)}
    </div>
  `;

  attachMoveInteractions(root, project, {
    onDirty,
    onTestMove,
    onOpenMoveAnimation,
    autofills: getMoveAutofills(project),
    renderExpanded: (moveId) => renderMoveExpanded(getMoveRecord(project, moveId)),
    renderTextPanel: (moveId) => renderMoveTextPanel(getMoveTextInfo(project, moveId)),
  });
  attachW2uSyncButton(root, project);
}

export function renderMoveAnimationPage(
  project: ProjectState,
  root: HTMLElement,
  moveId: number,
  onDirty?: () => void,
  onTestMove?: (moveId: number, scriptText: string) => Promise<void>,
  onBack?: () => void,
  onOpenMoveAnimation?: (moveId: number) => void,
): void {
  if (!Number.isSafeInteger(moveId) || moveId < 0 || moveId >= getMoveCount(project)) {
    root.innerHTML = `
      <aside class="pokemon-filter move-animation-sidebar">
        <button class="btn -default move-animation-back" type="button">Back to Moves</button>
        <div class="move-command-reference" id="move-command-reference">
          <div class="move-command-reference-empty">Click a script command to view its parameters here.</div>
        </div>
      </aside>
      <main class="pokemon-list pokemon-move-list spreadsheet move-animation-page" id="moves">
        <div class="move-animation-page-header">
          <div>
            <div class="move-animation-page-kicker">Move ${escapeHtml(String(moveId))}</div>
            <h2>Move Animation</h2>
          </div>
        </div>
        <div class="move-animation-editor show-flex">
          <div class="move-animation-error">Move ${escapeHtml(String(moveId))} could not be loaded.</div>
        </div>
      </main>
    `;
    root.querySelector<HTMLButtonElement>(".move-animation-back")?.addEventListener("click", () => onBack?.());
    return;
  }
  const move = getMoveRecord(project, moveId);
  const moveName = titleize(String(move.readable.name ?? `Move ${moveId}`));
  const animationTarget = getMoveAnimationTargetInfo(project, moveId);
  const canTestMoveAnimation = hasMoveAnimationScript(project, moveId) && onTestMove !== undefined;
  root.innerHTML = `
    <aside class="pokemon-filter move-animation-sidebar">
      <button class="btn -default move-animation-back" type="button">Back to Moves</button>
      <label class="move-animation-move-select">
        <span>Move</span>
        <select id="move-animation-move-select">
          ${renderMoveAnimationMoveOptions(project, moveId)}
        </select>
      </label>
      <button class="btn -default move-animation-test-btn" type="button" ${canTestMoveAnimation ? "" : "disabled"}>Test in Game</button>
      <div class="move-command-reference" id="move-command-reference">
        <div class="move-command-reference-empty">Click a script command to view its parameters here.</div>
      </div>
    </aside>
    <main class="pokemon-list pokemon-move-list spreadsheet move-animation-page" id="moves">
      <div class="move-animation-page-header">
        <div>
          <div class="move-animation-page-kicker">Move ${moveId}${renderMoveAnimationTargetLabel(animationTarget)}</div>
          <h2>${escapeHtml(moveName)} Animation</h2>
        </div>
      </div>
      <div class="move-animation-editor show-flex"></div>
    </main>
  `;
  root.querySelector<HTMLButtonElement>(".move-animation-back")?.addEventListener("click", () => onBack?.());
  root.querySelector<HTMLSelectElement>("#move-animation-move-select")?.addEventListener("change", (event) => {
    const nextMoveId = Number((event.currentTarget as HTMLSelectElement).value);
    if (Number.isSafeInteger(nextMoveId)) onOpenMoveAnimation?.(nextMoveId);
  });
  const panel = root.querySelector<HTMLElement>(".move-animation-editor");
  if (!panel) return;
  if (!hasMoveAnimationScript(project, moveId)) {
    panel.innerHTML = `<div class="move-animation-error">Move animation NARCs were not loaded for this ROM session.</div>`;
    return;
  }
  try {
    const script = decompileMoveAnimation(project, moveId);
    panel.innerHTML = renderMoveAnimationEditor(script);
    installMoveAnimationEditor(panel, project, moveId, { onDirty, onTestMove });
  } catch (error) {
    panel.innerHTML = `<div class="move-animation-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

function renderMoveAnimationTargetLabel(target: MoveAnimationTargetInfo | undefined): string {
  if (!target) return "";
  const layout = target.white2UpgradeLayout ? "W2U" : "Retail";
  return ` - ${layout} ${escapeHtml(target.sourcePath)} #${target.index}`;
}

function renderMoveAnimationMoveOptions(project: ProjectState, selectedMoveId: number): string {
  const options: string[] = [];
  for (let id = 0; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    const name = titleize(String(move.readable.name ?? `Move ${id}`));
    options.push(`<option value="${id}" ${id === selectedMoveId ? "selected" : ""}>${escapeHtml(name)} - ${id}</option>`);
  }
  return options.join("");
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
  const showTextBanks = hasMoveTextBanks(project);
  for (let id = 0; id < getMoveCount(project); id += 1) rows.push(renderMoveRow(getMoveRecord(project, id), showTextBanks));
  return rows.join("");
}

function renderItemRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let id = 0; id < getItemCount(project); id += 1) rows.push(renderItemRow(getItemRecord(project, id)));
  return rows.join("");
}

function renderMoveRow(move: MoveRecord, showTextBanks: boolean): string {
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
        ${renderMoveEffectField(move)}
        ${editable("move", "power", move.readable.power, "move-power", { type: "int-255" })}
        ${editable("move", "accuracy", move.readable.accuracy, "move-accuracy", { type: "int-101" })}
        <div class="move-info expand-action expand-move svg no-fill" data-expand="move">${miscDataIcon}</div>
        ${showTextBanks ? `<button class="move-info expand-action expand-move-text svg no-fill" data-expand="move-text" type="button" title="Move text banks">${textIcon}</button>` : ""}
        <button class="move-animation-row-toggle" type="button" title="Edit animation and particles"><img src="${movieIconUrl}" alt="Edit animation"></button>
      </div>
    </div>
  `;
}

function renderMoveEffectField(move: MoveRecord): string {
  return `
    <div class="move-effect">
      ${editable("move", "effect", move.readable.effect, "move-effect-name", { autofill: "effects" })}
      <label class="move-effect-id">
        <span>ID</span>
        <input class="move-effect-id-input" type="number" inputmode="numeric" min="0" max="${EFFECTS.length - 1}" value="${escapeHtml(String(move.raw.effect ?? 0))}">
      </label>
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
      </div>
      <div class="expanded-row expanded-move-props" data-narc="move">
        ${PROPERTIES.map((prop) => `<div class="move-prop svg ${Number(move.readable[prop]) > 0 ? "-active" : ""}" data-field-name="${escapeHtml(prop)}"><img src="${publicAsset(`svgs/${prop}.svg`)}" alt=""><div class="prop-info">${escapeHtml(titleize(prop.replace(/_/gu, " ")))}</div></div>`).join("")}
      </div>
    </div>
  `;
}

function renderMoveTextPanel(info: MoveTextInfo | undefined): string {
  if (!info) {
    return `
      <div class="expanded-card-content expanded-move-texts">
        <div class="move-text-empty">Move text banks are unavailable for this ROM.</div>
      </div>
    `;
  }
  return `
    <div class="expanded-card-content expanded-move-texts" data-move-text-panel="${info.moveId}">
      <div class="move-text-editor">
        <label class="move-text-control">
          <span>Move Name</span>
          <input class="move-text-name-input" type="text" value="${escapeHtml(info.title)}" autocomplete="off" spellcheck="false">
        </label>
        <label class="move-text-control -description">
          <span>Description</span>
          <textarea class="move-text-description-input" spellcheck="false">${escapeHtml(info.description)}</textarea>
        </label>
        <div class="move-text-status" aria-live="polite"></div>
      </div>
      <div class="move-text-bank-list">
        ${info.sections.map(renderMoveTextSection).join("")}
      </div>
    </div>
  `;
}

function renderMoveTextSection(section: MoveTextSection): string {
  return `
    <section class="move-text-bank-section" data-bank-id="${section.bankId}" data-role="${section.role}">
      <div class="move-text-bank-header">
        <span>${escapeHtml(section.title)}</span>
        ${section.editable ? `<small>Description source</small>` : ""}
      </div>
      ${section.lines.length > 0 ? section.lines.map(renderMoveTextLine).join("") : `<div class="move-text-empty">No matching text lines.</div>`}
    </section>
  `;
}

function renderMoveTextLine(line: MoveTextLine): string {
  return `
    <div class="move-text-line" data-entry-index="${line.flatIndex}">
      <div class="move-text-msg">MSG ${escapeHtml(line.entryLabel)}</div>
      <div class="move-text-value">${escapeHtml(line.text)}</div>
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
      <div class="item-detail-grid">
        ${ITEM_DETAIL_SECTIONS.map((section) => renderItemDetailSection(item, section.title, section.fields)).join("")}
      </div>
    </div>
  `;
}

function renderItemDetailSection(item: ItemRecord, title: string, fields: readonly ItemFieldSpec[]): string {
  return `
    <section class="item-detail-section">
      <div class="item-detail-section-title">${escapeHtml(title)}</div>
      <div class="item-detail-section-fields">
        ${fields.map(([field, max]) => renderItemExpandedField(item, field, max)).join("")}
      </div>
    </section>
  `;
}

function renderItemExpandedField(item: ItemRecord, field: string, max: number): string {
  const label = ITEM_FIELD_LABELS[field] ?? titleize(field.replace(/_/gu, " "));
  const packedParts = ITEM_PACKED_FIELDS[field];
  if (!packedParts) {
    return `
      <div class="item-detail-field">
        <label class="item-detail-label">${escapeHtml(label)}</label>
        ${editable("item", field, item.readable[field], `item-detail-value item-${field}`, { type: `int-${max}` })}
      </div>
    `;
  }

  const value = Number(item.readable[field] ?? 0);
  const parts = packedParts
    .map((part) => {
      const partMax = (1 << part.size) - 1;
      const partValue = (value >> part.offset) & partMax;
      if (part.kind === "checkbox") {
        return `
          <label class="item-flag-check">
            <input class="item-flag-checkbox" data-field-name="${escapeHtml(field)}" data-part-key="${escapeHtml(part.key)}" type="checkbox" ${partValue > 0 ? "checked" : ""}>
            <span>${escapeHtml(part.label)}</span>
          </label>
        `;
      }
      return `
        <label class="item-flag-number">
          <span>${escapeHtml(part.label)}</span>
          ${editable("item-part", field, partValue, "item-detail-value item-packed-value", { type: `int-${partMax}`, part: part.key })}
        </label>
      `;
    })
    .join("");

  return `
    <div class="item-detail-field -packed">
      <div class="item-detail-label">${escapeHtml(label)}</div>
      <div class="item-flag-editor" data-field-name="${escapeHtml(field)}" data-raw-value="${value}">${parts}</div>
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
  narc: "move" | "item" | "item-part",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; part?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const part = options.part ? ` data-part-key="${escapeHtml(options.part)}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${part}>${escapeHtml(String(value ?? ""))}</div>`;
}

function inputOptions(value: string): { autofill?: string; type?: string } {
  return value.startsWith("int-") ? { type: value } : { autofill: value };
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}
