import { renderMoveRuntimeUpdate, installMoveRuntimeUpdate, refreshMoveRuntimeUpdate } from "./moveRuntimeUpdate";
import { installMoveRecipeEditor } from "./moveRecipeEditor";
import { renderMoveDllFlags, installMoveDllFlags } from "./moveDllFlagsEditor";
import { renderAbilityRuntimeUpdate, installAbilityRuntimeUpdate, refreshAbilityRuntimeUpdate } from "./abilityRuntimeUpdate";
import { inspectMoveEffects, MOVE_RECIPE_MANAGED_FIELDS, supportsMoveRecipes } from "../pokeweb/moveEffectsModel";
import { PROPERTIES, CATEGORIES, typeNamesForProject } from "../pokeweb/constants";
import {
  getMoveAutofills,
  getMoveCount,
  getMoveRecord,
  EFFECTS,
  MOVE_EFFECT_FIELDS,
  MOVE_MISC_FIELDS,
  MOVE_STAT_FIELDS,
  titleize,
  type MoveRecord,
} from "../pokeweb/moveItemModel";
import { getMoveTextInfo, hasMoveTextBanks, type MoveTextInfo, type MoveTextLine, type MoveTextSection } from "../pokeweb/moveTextModel";
import { descriptionPreviewMarkup } from "./lazyDescriptionPreview";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachMoveInteractions, installMoveEditableFields, installMoveTextFields, type MoveOptions } from "./moveItemInteractions";
import "../styles/moveData.css";
import { publicAsset } from "../assetUrl";

type MoveDetailTab = "data" | "effects" | "text";

/** Selected move and tab survive re-renders (route changes, refreshes) per project. */
const moveDataSelection = new WeakMap<ProjectState, { moveId: number; tab: MoveDetailTab }>();

const MOVE_FIELD_INPUTS: Record<string, string> = Object.fromEntries(
  [...MOVE_EFFECT_FIELDS, ...MOVE_STAT_FIELDS, ...MOVE_MISC_FIELDS].map(([, field, input]) => [field, input]),
);

const MOVE_FLAG_LABELS: Record<string, string> = {
  contact: "Makes contact",
  requires_charge: "Charges first",
  recharge_turn: "Needs recharge",
  blocked_by_protect: "Blocked by Protect",
  reflected_by_magic_coat: "Reflected by Magic Coat",
  stolen_by_snatch: "Stolen by Snatch",
  copied_by_mirror_move: "Copied by Mirror Move",
  punch_move: "Punch move",
  sound_move: "Sound move",
  grounded_by_gravity: "Grounded by Gravity",
  defrosts_targets: "Defrosts targets",
  "hits_non-adjacent_opponents": "Hits non-adjacent foes",
  healing_move: "Healing move",
  hits_through_substitute: "Hits through Substitute",
};

export function renderMoveEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onTestMove?: (moveId: number, scriptText: string) => Promise<void>,
  onOpenMoveAnimation?: (moveId: number) => void,
): void {
  const recipes = supportsMoveRecipes(project);
  const moveCount = getMoveCount(project);
  const selection = moveDataSelection.get(project) ?? { moveId: Math.min(1, moveCount - 1), tab: "data" as MoveDetailTab };
  selection.moveId = Math.max(0, Math.min(moveCount - 1, selection.moveId));
  moveDataSelection.set(project, selection);

  // Page tools sit in the sub-tab row, not in the filter column.
  const actions = document.getElementById("page-actions") ?? root;
  if (actions !== root) {
    actions.innerHTML = recipes ? renderMoveRuntimeUpdate(project) + renderAbilityRuntimeUpdate(project) : "";
    compactRuntimeActions(actions);
  }

  root.innerHTML = `
    <div class="move-data" id="move-data">
      <aside class="md-list" aria-label="Moves">
        <div class="md-filters">
          <input class="md-search" id="search-text" type="search" placeholder="Search moves" autocomplete="off" spellcheck="false" aria-label="Search moves">
          <div class="md-chips">
            ${renderMoveFilter("Type", "type-filters", typeNamesForProject(project).map((type) => `<button class="type-plate -${typeClass(type)} md-type-toggle" data-ptype="${type.toLowerCase()}" type="button" aria-pressed="false">${escapeHtml(type)}</button>`).join(""))}
            ${renderMoveFilter("Category", "cat-filters", ["physical", "special", "status"].map((cat) => `<button class="btn sm" data-mcat="${cat}" type="button" aria-pressed="false"><img src="${publicAsset(`images/move-${cat}.png`)}" alt="">${titleize(cat)}</button>`).join(""))}
            ${renderMoveFilter("Generation", "gen-filters move-generation-filters", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((gen) => `<button class="btn sm" data-gen="${gen}" type="button" aria-pressed="false">Gen ${gen}</button>`).join(""))}
          </div>
        </div>
        <div class="md-list-head" aria-hidden="true"><span>#</span><span>Name</span><span>Type</span><span>Pow</span></div>
        <div class="md-rows" id="move-list" role="listbox" aria-label="Moves" tabindex="0">${renderMoveListRows(project)}</div>
      </aside>
      <section class="md-detail" id="move-detail"></section>
      <div class="move-command-reference" id="move-command-reference" hidden></div>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#move-list")!;
  const detail = root.querySelector<HTMLElement>("#move-detail")!;
  const runtimeChanged = () => {
    refreshMoveRuntimeUpdate(actions, project);
    refreshAbilityRuntimeUpdate(actions, project);
    if (actions !== root) compactRuntimeActions(actions);
    onDirty?.();
  };

  const options: MoveOptions = {
    onDirty,
    onTestMove,
    onOpenMoveAnimation,
    autofills: getMoveAutofills(project),
    renderExpanded: (moveId) => renderMoveDataPanel(project, moveId),
    renderTextPanel: (moveId) => renderMoveTextPanel(getMoveTextInfo(project, moveId)),
    onFiltered: () => {
      updateMoveFilterCounts(root);
    },
  };

  const showTab = (tab: MoveDetailTab) => {
    const card = detail.querySelector<HTMLElement>(".move-card");
    if (!card) return;
    if (tab === "effects" && !recipes) tab = "data";
    if (tab === "text" && !hasMoveTextBanks(project)) tab = "data";
    selection.tab = tab;
    const moveId = Number(card.dataset.index);
    const panels = card.querySelector<HTMLElement>(".md-panels")!;
    if (tab === "data" && !panels.querySelector(".expanded-move")) {
      panels.insertAdjacentHTML("beforeend", options.renderExpanded(moveId));
      installMoveEditableFields(panels, project, options);
    }
    if (tab === "text" && !panels.querySelector(".expanded-move-texts") && options.renderTextPanel) {
      panels.insertAdjacentHTML("beforeend", options.renderTextPanel(moveId));
      installMoveTextFields(card, project, options);
    }
    if (tab === "effects" && !panels.querySelector("[data-move-recipe-panel]")) {
      const host = document.createElement("section");
      host.dataset.moveRecipePanel = "";
      host.className = "expanded-card-content move-recipe-panel";
      panels.append(host);
      installMoveRecipeEditor(project, host, moveId, runtimeChanged);
    }
    const target = tab === "data" ? ".expanded-move" : tab === "text" ? ".expanded-move-texts" : "[data-move-recipe-panel]";
    panels.querySelectorAll<HTMLElement>(":scope > .expanded-card-content").forEach((panel) => panel.classList.toggle("is-open", panel.matches(target)));
    card.querySelectorAll<HTMLButtonElement>("[data-move-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.moveTab === tab)));
    refreshMoveEditState(project, root, moveId);
  };

  const select = (moveId: number, focusList = false) => {
    selection.moveId = moveId;
    detail.innerHTML = renderMoveDetail(project, moveId);
    installMoveEditableFields(detail, project, options);
    list.querySelectorAll<HTMLElement>("[data-move-row]").forEach((row) => {
      const active = Number(row.dataset.moveRow) === moveId;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
      if (active && focusList) row.scrollIntoView({ block: "nearest" });
    });
    showTab(selection.tab);
  };

  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-move-row]");
    if (row) select(Number(row.dataset.moveRow));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-move-row]")].filter((row) => row.style.display !== "none");
    const index = rows.findIndex((row) => Number(row.dataset.moveRow) === selection.moveId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(Number(next.dataset.moveRow), true);
  });
  detail.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-move-tab]");
    if (tab) showTab(tab.dataset.moveTab as MoveDetailTab);
  });
  // Field commits happen on focusout/change; resync the list row and edit marks after them.
  const resync = () => window.setTimeout(() => refreshMoveEditState(project, root, selection.moveId), 0);
  detail.addEventListener("focusout", resync);
  detail.addEventListener("change", resync);
  detail.addEventListener("click", resync);
  root.querySelectorAll<HTMLDetailsElement>(".md-filter").forEach((filter) => {
    filter.addEventListener("toggle", () => {
      if (filter.open) root.querySelectorAll<HTMLDetailsElement>(".md-filter").forEach((other) => { if (other !== filter) other.open = false; });
    });
  });
  document.addEventListener("click", (event) => {
    if (!root.isConnected) return;
    root.querySelectorAll<HTMLDetailsElement>(".md-filter[open]").forEach((filter) => { if (!filter.contains(event.target as Node)) filter.open = false; });
  });

  select(selection.moveId, true);
  attachMoveInteractions(root, project, options);
  installMoveRuntimeUpdate(actions, project, runtimeChanged);
  installAbilityRuntimeUpdate(actions, project, runtimeChanged);
  installMoveDllFlags(root, project, runtimeChanged);
}

/** Fits the runtime updaters into the sub-tab row: release time moves into the tooltip, and a disabled button says why. */
function compactRuntimeActions(actions: HTMLElement): void {
  actions.querySelectorAll<HTMLElement>(".ability-runtime-update").forEach((group) => {
    const button = group.querySelector<HTMLButtonElement>("button");
    const stamp = group.querySelector<HTMLElement>(".runtime-release-timestamp");
    if (!button) return;
    button.classList.add("sm");
    button.textContent = (button.textContent ?? "").replace(/ (\w)/gu, (match) => match.toLowerCase());
    if (stamp) {
      button.title = [button.title, (stamp.textContent ?? "").trim()].filter(Boolean).join(". ");
      stamp.remove();
    }
    group.querySelector(".runtime-reason")?.remove();
    if (button.disabled && button.title) {
      const reason = document.createElement("span");
      reason.className = "runtime-reason";
      reason.textContent = button.title.split(". ")[0];
      group.prepend(reason);
    }
  });
}

function renderMoveFilter(label: string, groupClass: string, buttons: string): string {
  return `
    <details class="md-filter">
      <summary class="btn sm">${label}<span class="md-filter-count" data-filter-count></span></summary>
      <div class="md-filter-pop small-filters ${groupClass}" role="group" aria-label="${label}">${buttons}</div>
    </details>
  `;
}

function updateMoveFilterCounts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".md-filter").forEach((filter) => {
    const count = filter.querySelectorAll('[aria-pressed="true"]').length;
    const label = filter.querySelector<HTMLElement>("[data-filter-count]");
    if (label) label.textContent = count ? String(count) : "";
    filter.classList.toggle("-active", count > 0);
  });
}

/** Fields that differ from the loaded ROM, read from the changelog (entries vanish when a value is reverted). */
function editedMoveFields(project: ProjectState, moveId: number): Set<string> {
  const prefix = `move:${moveId}:`;
  return new Set((project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(prefix)).map((entry) => entry.key.slice(prefix.length)));
}

function refreshMoveEditState(project: ProjectState, root: HTMLElement, moveId: number): void {
  const edited = editedMoveFields(project, moveId);
  const move = getMoveRecord(project, moveId);
  const row = root.querySelector<HTMLElement>(`[data-move-row="${moveId}"]`);
  if (row) row.innerHTML = renderMoveListRowContent(move, edited.size);
  const title = root.querySelector<HTMLElement>("#move-detail .md-title h1");
  if (title) title.textContent = moveDisplayName(move);
  root.querySelectorAll<HTMLElement>("#move-detail [data-mark-fields]").forEach((mark) => {
    const fields = (mark.dataset.markFields ?? "").split(" ");
    mark.classList.toggle("is-edited", fields.some((field) => edited.has(field)));
  });
}

function moveDisplayName(move: MoveRecord): string {
  return titleize(String(move.readable.name ?? `Move ${move.id}`));
}

function renderMoveListRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let id = 0; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    rows.push(`<div class="md-row" data-move-row="${id}" role="option" aria-selected="false">${renderMoveListRowContent(move, editedMoveFields(project, id).size)}</div>`);
  }
  return rows.join("");
}

function renderMoveListRowContent(move: MoveRecord, edits: number): string {
  const type = String(move.readable.type ?? "");
  const power = Number(move.readable.power ?? 0);
  return `
    <span class="md-row-id">${move.id}</span>
    <span class="md-row-name">${escapeHtml(moveDisplayName(move))}${edits ? `<span class="md-edits" title="${edits} changed field${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
    <span class="type-plate sm -${typeClass(type)}">${escapeHtml(type)}</span>
    <span class="md-row-pow">${power > 1 ? power : "—"}</span>
  `;
}

function renderMoveDetail(project: ProjectState, moveId: number): string {
  const move = getMoveRecord(project, moveId);
  const type = String(move.readable.type ?? "");
  const category = String(move.readable.category ?? "");
  return `
    <article class="move-card md-card" data-index="${move.id}" data-move-index="${move.id}">
      <header class="md-head">
        <div class="md-head-main">
          <div class="md-title">
            <h1>${escapeHtml(moveDisplayName(move))}</h1>
            <span class="md-num">#${move.id}</span>
            ${editable("move", "type", type, `type-plate -${typeClass(type)}`, { autofill: "types", title: "Type" })}
            <div class="move-cat md-category" data-field-name="category" data-narc="move" title="Category">${renderCategoryImages(category)}</div>
          </div>
          <div class="md-effect"><span class="md-hint" title="Controls only how the trainer AI evaluates this move. It does not change what the move does in battle.">AI handler</span>${renderMoveEffectField(move)}</div>
        </div>
        <div class="md-keystats">
          <label class="md-stat" data-mark-fields="power"><span>Power</span>${editable("move", "power", move.readable.power, "move-power", { type: "int-255" })}</label>
          <label class="md-stat" data-mark-fields="accuracy"><span>Accuracy</span>${editable("move", "accuracy", move.readable.accuracy, "move-accuracy", { type: "int-101" })}</label>
        </div>
      </header>
      <div class="md-tabs" role="tablist" aria-label="Move editor">
        <button class="uv-tab" type="button" role="tab" data-move-tab="data">Data</button>
        ${supportsMoveRecipes(project) ? `<button class="uv-tab" type="button" role="tab" data-move-tab="effects">Effects</button>` : ""}
        ${hasMoveTextBanks(project) ? `<button class="uv-tab" type="button" role="tab" data-move-tab="text">Text</button>` : ""}
        <button class="uv-tab move-animation-row-toggle" type="button" title="Open the animation and particle editor">Animation</button>
      </div>
      <div class="md-panels"></div>
    </article>
  `;
}

function renderMoveDataPanel(project: ProjectState, moveId: number): string {
  const move = getMoveRecord(project, moveId);
  const recipes = supportsMoveRecipes(project);
  const managed = recipes && inspectMoveEffects(project).rules.has(moveId);
  const value = (field: string) => {
    if (managed && MOVE_RECIPE_MANAGED_FIELDS.includes(field)) return `<span class="md-managed" title="Managed in the Effects tab">Effects</span>`;
    return editable("move", field, move.readable[field], "md-field", inputOptions(MOVE_FIELD_INPUTS[field] ?? "int-255"));
  };
  const row = (label: string, fields: string[], body: string) =>
    `<span class="md-label" data-mark-fields="${fields.join(" ")}">${label}</span><div class="md-value">${body}</div>`;
  const single = (label: string, field: string, unit = "") => row(label, [field], `${value(field)}${unit ? `<span class="md-unit">${unit}</span>` : ""}`);
  const range = (label: string, min: string, max: string) => row(label, [min, max], `${value(min)}<span class="md-unit">to</span>${value(max)}`);
  return `
    <div class="expanded-card-content expanded-move md-data">
      <div class="md-grid">
        <section>
          <div class="section-bar">Core</div>
          <div class="md-form">
            ${single("PP", "pp")}
            ${single("Priority", "priority")}
            ${single("Crit stage", "crit")}
            ${single("Target", "target")}
            ${range("Hits", "min_hits", "max_hits")}
            ${single("Animation", "animation")}
          </div>
        </section>
        <section>
          <div class="section-bar">Secondary effect</div>
          <div class="md-form">
            ${single("Category", "effect_category")}
            ${single("Effect", "result_effect")}
            ${single("Chance", "effect_chance", "%")}
            ${single("Status", "status")}
            ${range("Effect turns", "min_turns", "max_turns")}
          </div>
        </section>
        <section>
          <div class="section-bar">Stat changes</div>
          <table class="md-table">
            <thead><tr><th>Stat</th><th class="r">Stages</th><th class="r">Chance %</th></tr></thead>
            <tbody>
              ${[1, 2, 3].map((n) => `<tr data-mark-fields="stat_${n} magnitude_${n} stat_chance_${n}"><td>${value(`stat_${n}`)}</td><td class="r">${value(`magnitude_${n}`)}</td><td class="r">${value(`stat_chance_${n}`)}</td></tr>`).join("")}
            </tbody>
          </table>
          <div class="section-bar md-gap">Damage modifiers</div>
          <div class="md-form">
            ${single("Flinch", "flinch", "%")}
            ${single("Recoil", "recoil", "%")}
            ${single("Heal", "healing", "%")}
          </div>
        </section>
      </div>
      <section class="md-flags">
        <div class="section-bar">Flags</div>
        <div class="md-flag-grid">
          ${PROPERTIES.map((prop) => `<label class="md-check" data-mark-fields="${escapeHtml(prop)}"><input class="move-native-flag" type="checkbox" data-field-name="${escapeHtml(prop)}" ${Number(move.readable[prop]) > 0 ? "checked" : ""}>${escapeHtml(MOVE_FLAG_LABELS[prop] ?? titleize(prop.replace(/[_-]/gu, " ")))}</label>`).join("")}
        </div>
        ${recipes ? renderMoveDllFlags(project, moveId) : ""}
      </section>
    </div>
  `;
}

function renderMoveEffectField(move: MoveRecord): string {
  return `
    <div class="move-effect">
      ${editable("move", "effect", move.readable.effect, "move-effect-name", { autofill: "effects", title: String(move.readable.effect) })}
      <label class="move-effect-id">
        <span>ID</span>
        <input class="move-effect-id-input" type="number" inputmode="numeric" min="0" max="${EFFECTS.length - 1}" value="${escapeHtml(String(move.raw.effect ?? 0))}">
      </label>
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
        ${descriptionPreviewMarkup}
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

function renderCategoryImages(category: string): string {
  return CATEGORIES.map((cat) => {
    const active = cat.toLowerCase() === category.toLowerCase();
    return `<img src="${publicAsset(`images/move-${cat.toLowerCase()}.png`)}" class="${active ? "chosen" : "unchosen"} choosable" data-value="${cat.toLowerCase()}" alt="${cat}">`;
  }).join("");
}


function editable(
  narc: "move" | "item" | "item-part",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; part?: string; title?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const part = options.part ? ` data-part-key="${escapeHtml(options.part)}"` : "";
  const title = options.title ? ` title="${escapeHtml(options.title)}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${part}${title}>${escapeHtml(String(value ?? ""))}</div>`;
}

function inputOptions(value: string): { autofill?: string; type?: string } {
  return value.startsWith("int-") ? { type: value } : { autofill: value };
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}
