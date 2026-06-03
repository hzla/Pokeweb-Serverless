import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import { publicAsset } from "../assetUrl";
import {
  FACILITY_CHOICE_LABELS,
  FACILITY_SET_LABELS,
  facilityAreaPoolMatchesSearch,
  evStatLabels,
  facilityChoiceMatchesSearch,
  facilityRegulationMatchesSearch,
  facilitySetMatchesSearch,
  getFacilityAreaPoolCount,
  getFacilityAreaPoolRecord,
  getFacilityAutofills,
  getFacilityChoiceCount,
  getFacilityChoiceNarcOptions,
  getFacilityChoiceRecord,
  getFacilityRegulationCount,
  getFacilityRegulationRecord,
  getFacilitySetCount,
  getFacilitySetNarcOptions,
  getFacilitySetRecord,
  isBossFacilityChoice,
  updateFacilityAreaPoolValue,
  updateFacilityChoiceField,
  updateFacilityRegulationField,
  updateFacilitySetField,
  type BattleFacilityAreaPoolRecord,
  type BattleFacilityGroup,
  type BattleFacilityChoiceRecord,
  type BattleFacilityRegulationRecord,
  type BattleFacilitySet,
  type FacilityChoiceNarcName,
  type FacilitySetNarcName,
} from "../pokeweb/battleFacilityModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type FacilityMode = "sets" | "choices" | "areaPools" | "bosses" | "regulations";

let activeMode: FacilityMode = "sets";
let activeSetNarc: FacilitySetNarcName | undefined;
let activeChoiceNarc: FacilityChoiceNarcName | undefined;
let searchText = "";

type BattleFacilityEditorOptions = {
  group?: BattleFacilityGroup;
};

const GROUP_LABELS: Record<BattleFacilityGroup, string> = {
  subwayPwt: "Subway / PWT",
  wbt: "Black Tower / White Treehollow",
};

export function renderBattleFacilityEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}): void {
  const group = options.group ?? "subwayPwt";
  const setNarcs = getFacilitySetNarcOptions(project, group);
  const choiceNarcs = getFacilityChoiceNarcOptions(project, group);
  const hasRegulations = group === "subwayPwt" && Boolean(project.narcs.regulations);
  const hasAreaPools = group === "wbt" && Boolean(project.narcs.wbt_area_pools);
  activeSetNarc = activeSetNarc && setNarcs.includes(activeSetNarc) ? activeSetNarc : setNarcs[0];
  activeChoiceNarc = activeChoiceNarc && choiceNarcs.includes(activeChoiceNarc) ? activeChoiceNarc : choiceNarcs[0];
  if (activeMode === "bosses" && group !== "wbt") activeMode = "sets";
  if (activeMode === "areaPools" && !hasAreaPools) activeMode = activeChoiceNarc ? "choices" : "sets";
  if (activeMode === "regulations" && !hasRegulations) activeMode = activeSetNarc ? "sets" : "choices";
  if (activeMode === "sets" && !activeSetNarc && activeChoiceNarc) activeMode = "choices";
  if (activeMode === "sets" && !activeSetNarc && !activeChoiceNarc && hasAreaPools) activeMode = "areaPools";
  if (activeMode === "sets" && !activeSetNarc && !activeChoiceNarc && hasRegulations) activeMode = "regulations";
  if (activeMode === "choices" && !activeChoiceNarc && activeSetNarc) activeMode = "sets";
  if (activeMode === "choices" && !activeChoiceNarc && !activeSetNarc && hasAreaPools) activeMode = "areaPools";
  if (activeMode === "choices" && !activeChoiceNarc && !activeSetNarc && hasRegulations) activeMode = "regulations";
  if (activeMode === "bosses" && !activeChoiceNarc && activeSetNarc) activeMode = "sets";

  root.innerHTML = `
    <div class="pokemon-filter trainer-filter facility-filter">
      <div class="filter-title">${escapeHtml(GROUP_LABELS[group])}</div>
      <div class="facility-tabs">
        <button class="btn -default facility-tab ${activeMode === "sets" ? "-active" : ""}" data-facility-mode="sets" type="button" ${setNarcs.length ? "" : "disabled"}>Sets</button>
        <button class="btn -default facility-tab ${activeMode === "choices" ? "-active" : ""}" data-facility-mode="choices" type="button" ${choiceNarcs.length ? "" : "disabled"}>${group === "wbt" ? "Trainers" : "Choices"}</button>
        ${group === "wbt" ? `<button class="btn -default facility-tab ${activeMode === "areaPools" ? "-active" : ""}" data-facility-mode="areaPools" type="button" ${hasAreaPools ? "" : "disabled"}>Area Pools</button>` : ""}
        ${group === "subwayPwt" ? `<button class="btn -default facility-tab ${activeMode === "regulations" ? "-active" : ""}" data-facility-mode="regulations" type="button" ${hasRegulations ? "" : "disabled"}>Regulations</button>` : ""}
        ${group === "wbt" ? `<button class="btn -default facility-tab ${activeMode === "bosses" ? "-active" : ""}" data-facility-mode="bosses" type="button" ${choiceNarcs.length ? "" : "disabled"}>Boss Teams</button>` : ""}
      </div>
      ${renderArchiveSelect(project, setNarcs, choiceNarcs)}
      <input class="filter-input" id="facility-search-text" value="${escapeHtml(searchText)}"/>
      <button class="btn -default" id="facility-search-btn" type="button">Search</button>
    </div>
    ${renderActivePanel(project, group)}
  `;

  attachFacilityEvents(project, root, onDirty, options);
}

function renderArchiveSelect(project: ProjectState, setNarcs: FacilitySetNarcName[], choiceNarcs: FacilityChoiceNarcName[]): string {
  if (activeMode === "sets") {
    return `
      <label class="facility-select-label">
        <span>Archive</span>
        <select id="facility-set-narc">
          ${setNarcs.map((name) => `<option value="${name}" ${name === activeSetNarc ? "selected" : ""}>${escapeHtml(FACILITY_SET_LABELS[name])}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (activeMode === "regulations") {
    return `
      <div class="facility-select-label">
        <span>Archive</span>
        <div class="facility-readonly facility-archive-note">Battle Regulations (${getFacilityRegulationCount(project)} records)</div>
        <div class="facility-warning facility-regulation-safety-note">Pokemon count changes are unsafe unless matching code-injection edits update the battle mode team-size logic and opponent generation limits.</div>
      </div>
    `;
  }
  if (activeMode === "areaPools") {
    return `
      <div class="facility-select-label">
        <span>Archive</span>
        <div class="facility-readonly facility-archive-note">Black Tower / White Treehollow Area Pools (${getFacilityAreaPoolCount(project)} records)</div>
        <div class="facility-warning facility-regulation-safety-note">Trainer pool entries are inferred from 20-set WBT trainer records inside the area configuration archive. Control values are visible but read-only.</div>
      </div>
    `;
  }
  return `
    <label class="facility-select-label">
      <span>Archive</span>
      <select id="facility-choice-narc">
        ${choiceNarcs.map((name) => `<option value="${name}" ${name === activeChoiceNarc ? "selected" : ""}>${escapeHtml(FACILITY_CHOICE_LABELS[name])}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderActivePanel(project: ProjectState, group: BattleFacilityGroup): string {
  if (activeMode === "sets") {
    if (!activeSetNarc) return `<div class="pokemon-list spreadsheet"><div class="facility-empty">No facility set archives are loaded.</div></div>`;
    return renderSetPanel(project, activeSetNarc);
  }
  if (activeMode === "regulations") {
    if (!project.narcs.regulations) return `<div class="pokemon-list spreadsheet"><div class="facility-empty">No regulation archive is loaded.</div></div>`;
    return renderRegulationPanel(project);
  }
  if (activeMode === "areaPools") {
    if (!project.narcs.wbt_area_pools) return `<div class="pokemon-list spreadsheet"><div class="facility-empty">No Black Tower / White Treehollow area pool archive is loaded.</div></div>`;
    return renderAreaPoolPanel(project);
  }
  if (!activeChoiceNarc) return `<div class="pokemon-list spreadsheet"><div class="facility-empty">No facility choice archives are loaded.</div></div>`;
  return renderChoicePanel(project, activeChoiceNarc, activeMode === "bosses", group);
}

function renderSetPanel(project: ProjectState, narc: FacilitySetNarcName): string {
  const rows: string[] = [];
  const count = getFacilitySetCount(project, narc);
  for (let id = 0; id < count; id += 1) {
    const set = getFacilitySetRecord(project, narc, id);
    if (facilitySetMatchesSearch(set, searchText)) rows.push(renderSetCard(set));
  }
  return `
    <div class="pokemon-list spreadsheet facility-list" id="facility-sets">
      <div class="expanded-field field-header">
        <div class="expanded-field-main facility-set-main">
          <div class="trainer-id">ID</div>
          <div class="trainer-name">Pokemon</div>
          <div class="trainer-poks">Moves</div>
          <div class="trainer-class">Item</div>
          <div class="trainer-btype">Nature</div>
          <div class="trainer-items">EVs</div>
          <div class="trainer-moves">Form</div>
        </div>
      </div>
      ${rows.join("") || `<div class="facility-empty">No matching sets.</div>`}
    </div>
  `;
}

function renderRegulationPanel(project: ProjectState): string {
  const rows: string[] = [];
  const count = getFacilityRegulationCount(project);
  for (let id = 0; id < count; id += 1) {
    const record = getFacilityRegulationRecord(project, id);
    if (facilityRegulationMatchesSearch(record, searchText)) rows.push(renderRegulationCard(record));
  }
  return `
    <div class="pokemon-list spreadsheet facility-list" id="facility-regulations">
      <div class="expanded-field field-header">
        <div class="expanded-field-main facility-regulation-main">
          <div class="trainer-id">ID</div>
          <div class="trainer-name">Regulation</div>
          <div class="trainer-class">Pokemon</div>
          <div class="trainer-btype">Level</div>
          <div class="trainer-poks">Mode</div>
          <div class="trainer-items">Total Lv.</div>
          <div class="trainer-moves">Battle</div>
        </div>
      </div>
      ${rows.join("") || `<div class="facility-empty">No matching regulations.</div>`}
    </div>
  `;
}

function renderAreaPoolPanel(project: ProjectState): string {
  const rows: string[] = [];
  const count = getFacilityAreaPoolCount(project);
  for (let id = 0; id < count; id += 1) {
    const record = getFacilityAreaPoolRecord(project, id);
    if (facilityAreaPoolMatchesSearch(record, searchText)) rows.push(renderAreaPoolCard(record));
  }
  return `
    <div class="pokemon-list spreadsheet facility-list" id="facility-area-pools">
      <div class="expanded-field field-header">
        <div class="expanded-field-main facility-area-pool-main">
          <div class="trainer-id">ID</div>
          <div class="trainer-name">Record</div>
          <div class="trainer-class">Header</div>
          <div class="trainer-poks">Pools</div>
        </div>
      </div>
      ${rows.join("") || `<div class="facility-empty">No matching area pools.</div>`}
    </div>
  `;
}

function renderChoicePanel(project: ProjectState, narc: FacilityChoiceNarcName, bossesOnly: boolean, group: BattleFacilityGroup): string {
  const rows: string[] = [];
  const count = getFacilityChoiceCount(project, narc);
  for (let id = 0; id < count; id += 1) {
    const choice = getFacilityChoiceRecord(project, narc, id);
    if (bossesOnly && !isBossFacilityChoice(choice)) continue;
    if (facilityChoiceMatchesSearch(choice, searchText)) rows.push(renderChoiceCard(choice));
  }
  return `
    <div class="pokemon-list spreadsheet facility-list" id="facility-choices">
      <div class="expanded-field field-header">
        <div class="expanded-field-main facility-choice-main">
          <div class="trainer-id">ID</div>
          <div class="facility-choice-icon-header"></div>
          <div class="trainer-name">Record</div>
          <div class="trainer-class">Trainer Class</div>
          <div class="trainer-btype">Set Count</div>
          <div class="trainer-poks">Sets</div>
          <div class="trainer-moves">Size</div>
        </div>
      </div>
      ${rows.join("") || `<div class="facility-empty">No matching ${bossesOnly ? "boss team" : group === "wbt" ? "trainer" : "choice"} records.</div>`}
    </div>
  `;
}

function renderRegulationCard(record: BattleFacilityRegulationRecord): string {
  return `
    <div class="expanded-field filterable trainer-card facility-card ${record.note ? "facility-regulation-special" : ""}" data-facility-kind="regulation" data-index="${record.id}">
      <div class="expanded-field-main facility-regulation-main">
        <div class="trainer-id">${record.id}</div>
        <div class="trainer-name">
          <strong>${escapeHtml(record.label)}</strong>
          ${record.note ? `<span class="facility-regulation-note">${escapeHtml(record.note)}</span>` : ""}
        </div>
        <div class="trainer-class facility-regulation-counts">
          ${editable("regulation", "numLo", record.numLo, "facility-small-int", { type: "int-255" })}
          <span>to</span>
          ${editable("regulation", "numHi", record.numHi, "facility-small-int", { type: "int-255" })}
        </div>
        ${editable("regulation", "level", record.level, "trainer-btype facility-level-edit", { type: "int-255" })}
        ${regulationLevelRangeSelect(record)}
        ${editable("regulation", "levelTotal", record.levelTotal, "trainer-items", { type: "int-65535" })}
        <div class="trainer-moves facility-regulation-battle">
          ${regulationBattleTypeSelect(record)}
          ${editable("regulation", "battleCount", record.battleCount, "facility-small-int", { type: "int-255" })}
        </div>
      </div>
    </div>
  `;
}

function renderSetCard(set: BattleFacilitySet): string {
  const missingSprite = publicAsset("images/pokesprite/-.png");
  return `
    <div class="expanded-field filterable trainer-card facility-card" data-facility-kind="set" data-narc="${set.narc}" data-index="${set.id}">
      <div class="expanded-field-main facility-set-main">
        <div class="trainer-id">${set.id}</div>
        <div class="trainer-name facility-species-cell">
          <img src="${publicAsset(`images/pokesprite/${set.spriteSlug}.png`)}" alt="" onerror="this.src='${missingSprite}'">
          ${editable("set", "species", set.speciesName, "tr-item trpok-name", { autofill: "pokemon_names" })}
        </div>
        <div class="trainer-poks facility-move-list">
          ${set.moves.map((move, index) => editable("set", `move_${index}`, move.name, "tr-item trpok-mov", { autofill: "move_names" })).join("")}
        </div>
        ${editable("set", "item", set.itemName, "trainer-class", { autofill: "items" })}
        ${editable("set", "nature", set.natureName, "trainer-btype", { autofill: "natures" })}
        <div class="trainer-items facility-ev-summary">${renderEvSummary(set)}</div>
        ${editable("set", "form", set.form, "trainer-moves", { type: "int-65535" })}
      </div>
    </div>
  `;
}

function renderChoiceCard(choice: BattleFacilityChoiceRecord): string {
  const invalidClass = choice.invalidSetIds.length ? " -invalid" : "";
  return `
    <div class="expanded-field filterable trainer-card facility-card" data-facility-kind="choice" data-narc="${choice.narc}" data-index="${choice.id}">
      <div class="expanded-field-main facility-choice-main">
        <div class="trainer-id">${choice.id}</div>
        <div class="move-info expand-action expand-trainer svg no-fill" data-expand="trainer">${miscDataIcon}</div>
        <div class="trainer-name">${escapeHtml(choice.label)}</div>
        ${trainerTypeEdit(choice)}
        ${editable("choice", "count", choice.count, "trainer-btype", { type: "int-65535" })}
        <div class="trainer-poks facility-setids${invalidClass}">${renderChoiceSetIdPreview(choice)}</div>
        <div class="trainer-moves facility-readonly" title="Record byte length. For source-backed Subway records this is 4 bytes plus 2 bytes for each set ID.">${choice.byteLength}</div>
      </div>
      <div class="expanded-card-content expanded-trainer">
        <div class="facility-choice-fields facility-choice-sets">
          <div class="facility-choice-section-title">Sets (${choice.setIds.length}${choice.setIds.length === choice.count ? "" : ` / ${choice.count}`})</div>
          <div class="facility-choice-set-table-host" data-choice-set-table-host>Expand this trainer to load editable set rows.</div>
        </div>
        ${renderChoiceExtras(choice)}
        <div class="expanded-bottom trainer-texts facility-raw">
          ${expandedField("Raw Hex", editable("choice", "rawHex", choice.rawHex, "log-text no-validate facility-hex"))}
        </div>
      </div>
    </div>
  `;
}

function renderAreaPoolCard(record: BattleFacilityAreaPoolRecord): string {
  return `
    <div class="expanded-field filterable trainer-card facility-card" data-facility-kind="areaPool" data-index="${record.id}">
      <div class="expanded-field-main facility-area-pool-main">
        <div class="trainer-id">${record.id}</div>
        <div class="trainer-name">
          <strong>Area Config ${record.recordId}</strong>
          <span class="facility-area-meta">${record.byteLength} bytes</span>
        </div>
        <div class="trainer-class facility-area-header">${record.headerValues.slice(0, 9).map((value) => escapeHtml(String(value))).join(" ")}</div>
        <div class="trainer-poks facility-area-pool-list">${record.pools.map((pool) => renderAreaPool(pool.index, pool.startOffset, pool.values, pool.trainerRefCount)).join("")}</div>
      </div>
    </div>
  `;
}

function renderAreaPool(index: number, startOffset: number, values: BattleFacilityAreaPoolRecord["pools"][number]["values"], trainerRefCount: number): string {
  return `
    <div class="facility-area-pool">
      <div class="facility-area-pool-title">Pool ${index + 1} <span>@0x${startOffset.toString(16).padStart(4, "0")}</span> <em>${trainerRefCount} trainers</em></div>
      <div class="facility-area-pool-values">
        ${values.map((value) => renderAreaPoolValue(value)).join("")}
      </div>
    </div>
  `;
}

function renderAreaPoolValue(value: BattleFacilityAreaPoolRecord["pools"][number]["values"][number]): string {
  if (!value.isTrainerRef) {
    return `<span class="facility-area-control" title="Control or non-trainer value at 0x${value.offset.toString(16).padStart(4, "0")}">${escapeHtml(String(value.value))}</span>`;
  }
  return `
    <span class="facility-area-trainer">
      ${editable("areaPool", "value", value.value, "facility-area-trainer-id", { type: "int-65535", offset: value.offset })}
      <button class="facility-trainer-jump" data-trainer-id="${value.value}" type="button" title="Open trainer ${value.value}">
        ${escapeHtml(value.trainerTypeName ?? `Trainer ${value.value}`)}
      </button>
    </span>
  `;
}

function renderChoiceSetTable(project: ProjectState, choice: BattleFacilityChoiceRecord): string {
  if (!choice.setLibrary) return `<div class="facility-empty-inline">No loaded set archive matches this choice archive.</div>`;
  const missingSprite = publicAsset("images/pokesprite/-.png");
  const rows = choice.setIds
    .map((setId, index) => renderChoiceSetTableRow(project, choice, setId, index, missingSprite))
    .join("");
  return `
    <div class="facility-choice-set-grid" role="table" aria-label="Usable Pokemon sets">
      ${rows}
    </div>
  `;
}

function renderChoiceSetTableRow(project: ProjectState, choice: BattleFacilityChoiceRecord, setId: number, index: number, missingSprite: string): string {
  if (!choice.setLibrary) return "";
  try {
    const set = getFacilitySetRecord(project, choice.setLibrary, setId);
    return `
      <div class="facility-choice-set-entry" role="row">
        ${editable("choice", `set_${index}`, setId, "facility-set-table-id", { type: "int-65535" })}
        <button class="facility-set-jump" data-set-narc="${choice.setLibrary}" data-set-id="${setId}" type="button" title="Open set ${setId}">
          <img src="${publicAsset(`images/pokesprite/${set.spriteSlug}.png`)}" alt="" onerror="this.src='${missingSprite}'">
          <span>${escapeHtml(set.speciesName)}</span>
        </button>
      </div>
    `;
  } catch {
    return `
      <div class="facility-choice-set-entry facility-choice-set-missing" role="row">
        ${editable("choice", `set_${index}`, setId, "facility-set-table-id", { type: "int-65535" })}
        <span class="facility-set-missing-label">Missing set ${escapeHtml(String(setId))}</span>
      </div>
    `;
  }
}

function renderChoiceExtras(choice: BattleFacilityChoiceRecord): string {
  if (!choice.extraValues.length && !choice.invalidSetIds.length) return "";
  return `
    <div class="facility-choice-fields facility-choice-extras">
      ${choice.extraValues.length ? `<div class="facility-choice-section-title">Extras (${choice.extraValues.length})</div>` : ""}
      ${choice.extraValues.map((value, index) => expandedField(`Extra ${index + 1}`, editable("choice", `extra_${index}`, value, "tr-item", { type: "int-65535" }))).join("")}
      ${choice.invalidSetIds.length ? `<div class="facility-warning">Invalid set IDs for ${escapeHtml(choice.setLibrary ?? "selected library")}: ${choice.invalidSetIds.join(", ")}</div>` : ""}
    </div>
  `;
}

function renderChoiceSetIdPreview(choice: BattleFacilityChoiceRecord): string {
  const previewLimit = 12;
  const preview = escapeHtml(choice.setIds.slice(0, previewLimit).join(", "));
  const hiddenCount = Math.max(0, choice.setIds.length - previewLimit);
  return `${preview}${hiddenCount ? `<span class="facility-setid-more" title="${hiddenCount} additional set IDs are visible when expanded">+${hiddenCount} more</span>` : ""}`;
}

function trainerTypeEdit(choice: BattleFacilityChoiceRecord): string {
  return editable("choice", "trainerType", `${choice.trainerTypeName} (${choice.trainerType})`, "trainer-class facility-trainer-type-select", { autofill: "trainer_types" });
}

function regulationLevelRangeSelect(record: BattleFacilityRegulationRecord): string {
  const options: Array<[number, string]> = [
    [0, "Normal"],
    [1, "Minimum"],
    [2, "Maximum"],
    [3, "Scale Down"],
    [4, "Set Level"],
    [5, "Scale Up"],
  ];
  const hasCurrent = options.some(([value]) => value === record.levelRange);
  const allOptions = hasCurrent ? options : [...options, [record.levelRange, record.levelRangeName] as [number, string]];
  return `
    <select data-facility-edit="regulation" data-field-name="levelRange" class="trainer-poks facility-regulation-select" title="Level regulation mode">
      ${allOptions.map(([value, label]) => `<option value="${value}" ${value === record.levelRange ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select>
  `;
}

function regulationBattleTypeSelect(record: BattleFacilityRegulationRecord): string {
  const options: Array<[number, string]> = [
    [0, "Single"],
    [1, "Double"],
    [2, "Triple"],
    [3, "Rotation"],
    [4, "Multi"],
    [5, "Shooter"],
  ];
  const hasCurrent = options.some(([value]) => value === record.battleType);
  const allOptions = hasCurrent ? options : [...options, [record.battleType, record.battleTypeName] as [number, string]];
  return `
    <select data-facility-edit="regulation" data-field-name="battleType" class="facility-regulation-select" title="Battle type">
      ${allOptions.map(([value, label]) => `<option value="${value}" ${value === record.battleType ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select>
  `;
}

function renderEvSummary(set: BattleFacilitySet): string {
  return evStatLabels()
    .map((label, index) => `<button class="facility-ev-chip facility-ev ${set.evStats[index] ? "-active" : ""}" data-field-name="ev_${index}" type="button" title="${escapeHtml(label)}">${escapeHtml(shortEvLabel(label))}</button>`)
    .join("");
}

function shortEvLabel(label: string): string {
  return label
    .replace("Attack", "Atk")
    .replace("Defense", "Def")
    .replace("Speed", "Spe")
    .replace("Sp. ", "Sp");
}

function expandedField(label: string, value: string, labelClass = "expanded-trlabel"): string {
  return `
    <div class="expanded-field">
      <div class="${labelClass}">${escapeHtml(label)}</div>
      ${value}
    </div>
  `;
}

function editable(
  kind: "set" | "choice" | "areaPool" | "regulation",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: keyof ReturnType<typeof getFacilityAutofills>; type?: string; offset?: number } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const offset = options.offset === undefined ? "" : ` data-offset="${options.offset}"`;
  return `<div autocorrect="off" data-facility-edit="${kind}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${offset}>${escapeHtml(String(value ?? ""))}</div>`;
}

function attachFacilityEvents(project: ProjectState, root: HTMLElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}): void {
  root.querySelectorAll<HTMLButtonElement>("[data-facility-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMode = button.dataset.facilityMode as FacilityMode;
      renderBattleFacilityEditor(project, root, onDirty, options);
    });
  });
  root.querySelector<HTMLSelectElement>("#facility-set-narc")?.addEventListener("change", (event) => {
    activeSetNarc = (event.currentTarget as HTMLSelectElement).value as FacilitySetNarcName;
    renderBattleFacilityEditor(project, root, onDirty, options);
  });
  root.querySelector<HTMLSelectElement>("#facility-choice-narc")?.addEventListener("change", (event) => {
    activeChoiceNarc = (event.currentTarget as HTMLSelectElement).value as FacilityChoiceNarcName;
    renderBattleFacilityEditor(project, root, onDirty, options);
  });
  const searchInput = root.querySelector<HTMLInputElement>("#facility-search-text");
  root.querySelector<HTMLButtonElement>("#facility-search-btn")?.addEventListener("click", () => {
    searchText = searchInput?.value ?? "";
    renderBattleFacilityEditor(project, root, onDirty, options);
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchText = searchInput.value;
      renderBattleFacilityEditor(project, root, onDirty, options);
    }
  });

  root.querySelectorAll<HTMLElement>(".expand-action").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>(".trainer-card");
      const panel = card?.querySelector<HTMLElement>(`.expanded-${button.dataset.expand}`);
      if (card && panel && button.dataset.expand === "trainer") {
        hydrateChoiceSetTable(project, root, card, onDirty, options);
      }
      panel?.classList.toggle("show-flex");
      button.classList.toggle("-active", Boolean(panel?.classList.contains("show-flex")));
    });
  });

  attachFacilitySetJumpEvents(project, root, onDirty, options);

  root.querySelectorAll<HTMLButtonElement>(".facility-trainer-jump").forEach((button) => {
    button.addEventListener("click", () => {
      const trainerId = Number(button.dataset.trainerId);
      activeMode = "choices";
      activeChoiceNarc = "wbt_trainers";
      searchText = "";
      renderBattleFacilityEditor(project, root, onDirty, options);
      requestAnimationFrame(() => {
        const target = [...root.querySelectorAll<HTMLElement>("#facility-choices .facility-card")].find((card) => card.dataset.narc === "wbt_trainers" && Number(card.dataset.index) === trainerId);
        target?.scrollIntoView({ block: "center" });
        target?.classList.add("facility-card-flash");
        window.setTimeout(() => target?.classList.remove("facility-card-flash"), 1200);
      });
    });
  });

  root.querySelectorAll<HTMLSelectElement>("select[data-facility-edit]").forEach((field) => {
    field.addEventListener("change", () => {
      commitFacilityField(project, root, field, onDirty, options);
    });
  });

  attachFacilityEditableFieldEvents(project, root, onDirty, options);

  root.querySelectorAll<HTMLElement>(".facility-ev").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>(".facility-card");
      if (!card) return;
      const narc = card.dataset.narc as FacilitySetNarcName;
      const id = Number(card.dataset.index);
      updateFacilitySetField(project, narc, id, button.dataset.fieldName ?? "", !button.classList.contains("-active"));
      onDirty?.();
      renderBattleFacilityEditor(project, root, onDirty, options);
    });
  });

  attachAutocomplete(root, getFacilityAutofills(project));
}

function attachFacilitySetJumpEvents(project: ProjectState, root: HTMLElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}, scope: ParentNode = root): void {
  scope.querySelectorAll<HTMLButtonElement>(".facility-set-jump").forEach((button) => {
    button.addEventListener("click", () => {
      const setNarc = button.dataset.setNarc as FacilitySetNarcName;
      const setId = Number(button.dataset.setId);
      activeMode = "sets";
      activeSetNarc = setNarc;
      searchText = "";
      renderBattleFacilityEditor(project, root, onDirty, options);
      requestAnimationFrame(() => {
        const target = [...root.querySelectorAll<HTMLElement>("#facility-sets .facility-card")].find((card) => card.dataset.narc === setNarc && Number(card.dataset.index) === setId);
        target?.scrollIntoView({ block: "center" });
        target?.classList.add("facility-card-flash");
        window.setTimeout(() => target?.classList.remove("facility-card-flash"), 1200);
      });
    });
  });
}

function attachFacilityEditableFieldEvents(project: ProjectState, root: HTMLElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}, scope: ParentNode = root): void {
  scope.querySelectorAll<HTMLElement>("[data-facility-edit]:not(select)").forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter" && !field.classList.contains("facility-hex")) {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("blur", () => {
      commitFacilityField(project, root, field, onDirty, options);
    });
  });
}

function hydrateChoiceSetTable(project: ProjectState, root: HTMLElement, card: HTMLElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}): void {
  const host = card.querySelector<HTMLElement>("[data-choice-set-table-host]");
  if (!host || host.dataset.hydrated === "true") return;
  const narc = card.dataset.narc as FacilityChoiceNarcName;
  const id = Number(card.dataset.index);
  const choice = getFacilityChoiceRecord(project, narc, id);
  host.innerHTML = renderChoiceSetTable(project, choice);
  host.dataset.hydrated = "true";
  attachFacilitySetJumpEvents(project, root, onDirty, options, host);
  attachFacilityEditableFieldEvents(project, root, onDirty, options, host);
}

function commitFacilityField(project: ProjectState, root: HTMLElement, field: HTMLElement | HTMLSelectElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}): void {
  const card = field.closest<HTMLElement>(".facility-card");
  if (!card) return;
  const kind = field.dataset.facilityEdit;
  const id = Number(card.dataset.index);
  const fieldName = field.dataset.fieldName ?? "";
  const value = field instanceof HTMLSelectElement ? field.value : field.textContent ?? "";
  try {
    if (kind === "set") updateFacilitySetField(project, card.dataset.narc as FacilitySetNarcName, id, fieldName, value);
    else if (kind === "choice") updateFacilityChoiceField(project, card.dataset.narc as FacilityChoiceNarcName, id, fieldName, value);
    else if (kind === "areaPool") updateFacilityAreaPoolValue(project, id, Number(field.dataset.offset), value);
    else updateFacilityRegulationField(project, id, fieldName, value);
    onDirty?.();
    renderBattleFacilityEditor(project, root, onDirty, options);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
    renderBattleFacilityEditor(project, root, onDirty, options);
  }
}

function attachAutocomplete(root: HTMLElement, autofills: ReturnType<typeof getFacilityAutofills>): void {
  root.querySelectorAll<HTMLElement>("[data-autocomplete-spy]").forEach((field) => {
    field.addEventListener("input", () => {
      const key = field.dataset.autofill as keyof typeof autofills;
      const values = autofills[key] ?? [];
      const text = (field.textContent ?? "").trim().toLowerCase();
      field.setAttribute("data-suggestions", values.filter((value) => value.toLowerCase().includes(text)).slice(0, 8).join("\\n"));
    });
  });
}
