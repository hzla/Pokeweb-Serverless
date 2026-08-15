import {
  loadBattleBackgroundScene,
  type BattleBackgroundVariant,
} from "../pokeweb/battleBackgroundModel";
import {
  battleEnvironmentTypeName,
  battleEnvironmentTypeUsage,
  cloneBattleEnvironmentZoneSpec,
  createHeaderSpecificBattleEnvironmentType,
  loadBattleEnvironmentEditorData,
  MAX_BATTLE_BACKGROUND_TYPES,
  NO_BATTLE_ENVIRONMENT_MODEL,
  updateSharedBattleEnvironmentType,
  validateBattleEnvironmentZoneSpec,
  type BattleEnvironmentEditorData,
  type BattleEnvironmentZoneSpec,
} from "../pokeweb/battleEnvironmentEditorModel";
import {
  BATTLE_BACKGROUND_ATTRIBUTE_NAMES,
  BATTLE_BACKGROUND_TYPE_NAMES,
} from "../pokeweb/battleEnvironmentUsage";
import {
  loadBattlePlatformScene,
  type BattlePlatformVariant,
} from "../pokeweb/battlePlatformModel";
import { getHeaderPackedValue, updateHeaderPackedField, type HeaderRow } from "../pokeweb/headerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { mountBattleBackgroundRenderer, type BattleBackgroundRenderer } from "./battleBackgroundRenderer";

const DEFAULT_PREVIEW_ATTRIBUTE = 5;
const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"] as const;

type EnvironmentEditorMode = "shared" | "custom";

export function renderBattleBackgroundTypeSelect(currentType: number): string {
  const optionCount = Math.max(BATTLE_BACKGROUND_TYPE_NAMES.length, currentType + 1);
  const options = Array.from({ length: optionCount }, (_unused, typeIndex) =>
    `<option value="${typeIndex}" ${typeIndex === currentType ? "selected" : ""}>${escapeHtml(typeOptionLabel(typeIndex))}</option>`,
  ).join("");
  return `<select class="header-battle-type-select" data-field-name="map_behavior" data-part-key="battle_bg_type" aria-label="Battle Background Type">${options}</select>`;
}

export function renderHeaderBattleEnvironmentCard(rowId: number, row: HeaderRow): string {
  const typeIndex = headerBattleEnvironmentType(row);
  return `
    <div class="header-battle-environment" data-header-battle-environment data-row-id="${rowId}" data-preview-attribute="${DEFAULT_PREVIEW_ATTRIBUTE}">
      <div class="header-battle-environment-loading">
        <strong>${escapeHtml(battleEnvironmentTypeName(typeIndex))}</strong>
        <span>Loading terrain-resolved background and platform data…</span>
      </div>
    </div>
  `;
}

export function initializeHeaderBattleEnvironmentEditors(
  root: HTMLElement,
  project: ProjectState,
  onDirty?: () => void,
): void {
  let data: BattleEnvironmentEditorData | undefined;

  const refreshAll = () => {
    if (!data) return;
    syncTypeSelectOptions(root, project, data);
    root.querySelectorAll<HTMLElement>(".expanded-header.show-flex [data-header-battle-environment]").forEach((host) => renderResolvedCard(host, project, data!));
  };

  root.querySelectorAll<HTMLSelectElement>(".header-battle-type-select").forEach((select) => {
    select.addEventListener("change", () => {
      const card = select.closest<HTMLElement>(".filterable");
      const rowId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(rowId)) return;
      try {
        const result = updateHeaderPackedField(project, rowId, "map_behavior", "battle_bg_type", select.value);
        select.classList.remove("invalid");
        syncPackedRawValue(card, Number(result.value));
        onDirty?.();
        refreshAll();
      } catch (error) {
        const row = project.headers?.rows[rowId];
        if (row) select.value = String(headerBattleEnvironmentType(row));
        select.classList.add("invalid");
        window.alert(errorMessage(error));
      }
    });
  });

  void loadBattleEnvironmentEditorData(project)
    .then((loaded) => {
      if (!root.isConnected) return;
      data = loaded;
      refreshAll();
    })
    .catch((error) => {
      if (!root.isConnected) return;
      root.querySelectorAll<HTMLElement>("[data-header-battle-environment]").forEach((host) => {
        host.innerHTML = `<div class="header-battle-environment-error"><strong>Environment lookup unavailable</strong><span>${escapeHtml(errorMessage(error))}</span></div>`;
      });
    });

  root.addEventListener("change", (event) => {
    const terrainSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-battle-preview-attribute]");
    if (!terrainSelect || !data) return;
    const host = terrainSelect.closest<HTMLElement>("[data-header-battle-environment]");
    if (!host) return;
    host.dataset.previewAttribute = terrainSelect.value;
    renderResolvedCard(host, project, data);
  });

  root.addEventListener("click", (event) => {
    const expandButton = (event.target as HTMLElement).closest<HTMLElement>(".expand-action[data-expand='header']");
    if (expandButton && data) {
      const host = expandButton.closest<HTMLElement>(".filterable")?.querySelector<HTMLElement>("[data-header-battle-environment]");
      if (host) window.setTimeout(() => {
        if (host.closest(".expanded-header")?.classList.contains("show-flex")) renderResolvedCard(host, project, data!);
      }, 0);
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-battle-environment-action]");
    if (!button || !data) return;
    const host = button.closest<HTMLElement>("[data-header-battle-environment]");
    const rowId = Number(host?.dataset.rowId);
    const row = project.headers?.rows[rowId];
    if (!host || !row || !Number.isInteger(rowId)) return;
    const typeIndex = headerBattleEnvironmentType(row);
    const source = data.rows[typeIndex];
    if (!source) return;
    const action = button.dataset.battleEnvironmentAction;
    if (action === "usage") {
      host.querySelector<HTMLElement>(".header-battle-environment-usage")?.toggleAttribute("hidden");
      return;
    }
    if (action === "edit") {
      openEnvironmentDialog(project, data, rowId, typeIndex, "shared", Number(host.dataset.previewAttribute ?? DEFAULT_PREVIEW_ATTRIBUTE), onDirty, refreshAll);
      return;
    }
    if (action === "customize") {
      if (data.rows.length >= MAX_BATTLE_BACKGROUND_TYPES) {
        window.alert("All 32 values addressable by the header's 5-bit battle environment field are already in use.");
        return;
      }
      openEnvironmentDialog(project, data, rowId, typeIndex, "custom", Number(host.dataset.previewAttribute ?? DEFAULT_PREVIEW_ATTRIBUTE), onDirty, refreshAll);
    }
  });
}

function renderResolvedCard(host: HTMLElement, project: ProjectState, data: BattleEnvironmentEditorData): void {
  const rowId = Number(host.dataset.rowId);
  const row = project.headers?.rows[rowId];
  if (!row) return;
  const typeIndex = headerBattleEnvironmentType(row);
  const spec = data.rows[typeIndex];
  const requestedAttribute = Number(host.dataset.previewAttribute ?? DEFAULT_PREVIEW_ATTRIBUTE);
  const attributeIndex = Number.isInteger(requestedAttribute) && requestedAttribute >= 0 && requestedAttribute < BATTLE_BACKGROUND_ATTRIBUTE_NAMES.length
    ? requestedAttribute
    : DEFAULT_PREVIEW_ATTRIBUTE;
  host.dataset.previewAttribute = String(attributeIndex);
  const usage = project.headers ? battleEnvironmentTypeUsage(project.headers, typeIndex) : [];
  const otherCount = Math.max(0, usage.length - 1);

  if (!spec) {
    host.innerHTML = `
      <div class="header-battle-environment-error">
        <strong>${escapeHtml(typeOptionLabel(typeIndex))}</strong>
        <span>The zone-spec table has only ${data.rows.length} rows, so this header type cannot resolve a battle environment.</span>
      </div>
    `;
    return;
  }

  const backgroundIndex = spec.backgrounds[attributeIndex] ?? NO_BATTLE_ENVIRONMENT_MODEL;
  const platformIndex = spec.platforms[attributeIndex] ?? NO_BATTLE_ENVIRONMENT_MODEL;
  const validation = validateBattleEnvironmentZoneSpec(spec, data.backgroundCatalog, data.platformCatalog);
  const warningCount = validation.errors.length + validation.warnings.length;
  host.innerHTML = `
    <div class="header-battle-environment-heading">
      <div><span>Resolved battle environment</span><strong>${escapeHtml(typeOptionLabel(typeIndex))}</strong></div>
      <button class="header-detail-open-link" type="button" data-battle-environment-action="usage">${usage.length} header${usage.length === 1 ? "" : "s"}</button>
    </div>
    <label class="header-battle-terrain-selector">
      <span>Terrain preview</span>
      <select data-battle-preview-attribute>${renderAttributeOptions(attributeIndex)}</select>
    </label>
    <div class="header-battle-resolution">
      ${resolutionRow("Background", backgroundIndex, backgroundSummary(data, backgroundIndex))}
      ${resolutionRow("Platform", platformIndex, platformSummary(data, platformIndex))}
      ${resolutionRow("Season", undefined, spec.season ? "Uses the current game season" : "Always uses Spring")}
      ${resolutionRow("Lighting", undefined, spec.timeZone ? "Uses field time-of-day lighting" : "Uses static battle lighting")}
    </div>
    ${otherCount > 0 ? `<div class="header-battle-shared-warning">Shared type: edits affect this header and ${otherCount} other header${otherCount === 1 ? "" : "s"}.</div>` : ""}
    ${warningCount > 0 ? `<div class="header-battle-validation-warning">${warningCount} mapping warning${warningCount === 1 ? "" : "s"}; open the editor for details.</div>` : ""}
    <div class="header-battle-environment-actions">
      <button class="btn -default" type="button" data-battle-environment-action="edit">Edit shared type & preview</button>
      <button class="btn -default" type="button" data-battle-environment-action="customize">Customize this header</button>
    </div>
    <div class="header-battle-environment-usage" hidden>
      ${usage.map((item) => `<span><strong>Header ${item.headerIndex}</strong>${escapeHtml(item.locationName || "Unnamed location")}</span>`).join("") || "<span>No loaded header uses this type.</span>"}
    </div>
  `;
}

function openEnvironmentDialog(
  project: ProjectState,
  data: BattleEnvironmentEditorData,
  rowId: number,
  sourceTypeIndex: number,
  mode: EnvironmentEditorMode,
  initialAttribute: number,
  onDirty: (() => void) | undefined,
  refreshAll: () => void,
): void {
  const source = data.rows[sourceTypeIndex];
  if (!source) return;
  const draft = cloneBattleEnvironmentZoneSpec(source);
  let previewAttribute = initialAttribute;
  let backgroundRenderer: BattleBackgroundRenderer | undefined;
  let platformRenderer: BattleBackgroundRenderer | undefined;
  let previewToken = 0;
  const usage = project.headers ? battleEnvironmentTypeUsage(project.headers, sourceTypeIndex) : [];

  const overlay = document.createElement("div");
  overlay.className = "header-battle-environment-modal";
  overlay.innerHTML = `
    <form class="header-battle-environment-dialog" role="dialog" aria-modal="true" aria-labelledby="header-battle-environment-title">
      <header>
        <div>
          <span>${mode === "custom" ? "Header-specific clone" : "Shared zone-spec row"}</span>
          <h2 id="header-battle-environment-title">${mode === "custom" ? `Customize Header ${rowId - 1}` : `Edit ${escapeHtml(typeOptionLabel(sourceTypeIndex))}`}</h2>
        </div>
        <button class="header-battle-dialog-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="header-battle-dialog-notice -${mode}">
        ${mode === "custom"
          ? `Saving creates type ${data.rows.length} and points only Header ${rowId - 1} at it. Custom type IDs are not included in the retail outdoor/cave type lists, which can affect mechanics such as the Dusk Ball bonus.`
          : `Type ${sourceTypeIndex} is currently selected by ${usage.length} header${usage.length === 1 ? "" : "s"}. Saving changes every one of them.`}
      </div>
      <section class="header-battle-dialog-controls">
        <label><input type="checkbox" data-zone-flag="season" ${draft.season ? "checked" : ""}> Use current game season</label>
        <label><input type="checkbox" data-zone-flag="timeZone" ${draft.timeZone ? "checked" : ""}> Use field time-of-day lighting</label>
        <label class="header-battle-preview-season"><span>Preview season</span><select data-preview-season>${SEASON_NAMES.map((name, index) => `<option value="${index}">${name}</option>`).join("")}</select></label>
      </section>
      <section class="header-battle-dialog-body">
        <div class="header-battle-mapping-editor">
          <div class="header-battle-mapping-toolbar">
            <div><strong>Terrain routing</strong><span>Each battle resolves both entries from the map attribute beneath the player.</span></div>
            <button class="btn -default" type="button" data-copy-current-mapping>Apply previewed terrain to all</button>
          </div>
          <div class="header-battle-mapping-table">
            <div class="header-battle-mapping-row -header"><span>Preview</span><strong>Terrain attribute</strong><strong>Background</strong><strong>Platform</strong></div>
            ${BATTLE_BACKGROUND_ATTRIBUTE_NAMES.map((name, attributeIndex) => renderMappingRow(data, draft, name, attributeIndex, previewAttribute)).join("")}
          </div>
        </div>
        <aside class="header-battle-live-preview">
          <header><span>Live 3D preview</span><strong data-preview-title>${escapeHtml(BATTLE_BACKGROUND_ATTRIBUTE_NAMES[previewAttribute] ?? `Attribute ${previewAttribute}`)}</strong></header>
          <div class="header-battle-preview-model"><span>Background</span><div data-background-preview-host><em>Loading…</em></div></div>
          <div class="header-battle-preview-model"><span>Platform</span><div data-platform-preview-host><em>Loading…</em></div></div>
          <div class="header-battle-dialog-validation" data-dialog-validation></div>
        </aside>
      </section>
      <footer>
        <button class="btn -default" type="button" data-dialog-cancel>Cancel</button>
        <button class="btn -default -active" type="submit">${mode === "custom" ? "Create custom type" : "Save shared type"}</button>
      </footer>
    </form>
  `;
  document.body.append(overlay);

  const close = () => {
    backgroundRenderer?.dispose();
    platformRenderer?.dispose();
    overlay.remove();
  };

  const syncDraftFromControls = () => {
    draft.season = Boolean(overlay.querySelector<HTMLInputElement>("[data-zone-flag='season']")?.checked);
    draft.timeZone = Boolean(overlay.querySelector<HTMLInputElement>("[data-zone-flag='timeZone']")?.checked);
    overlay.querySelectorAll<HTMLSelectElement>("[data-mapping-kind]").forEach((select) => {
      const attributeIndex = Number(select.dataset.attributeIndex);
      const value = Number(select.value);
      if (select.dataset.mappingKind === "background") draft.backgrounds[attributeIndex] = value;
      else draft.platforms[attributeIndex] = value;
    });
  };

  const renderValidation = () => {
    syncDraftFromControls();
    const validation = validateBattleEnvironmentZoneSpec(draft, data.backgroundCatalog, data.platformCatalog);
    const host = overlay.querySelector<HTMLElement>("[data-dialog-validation]");
    if (!host) return validation;
    const messages = [...validation.errors.map((message) => ({ message, kind: "error" })), ...validation.warnings.map((message) => ({ message, kind: "warning" }))];
    host.innerHTML = messages.length
      ? `<details><summary>${messages.length} validation message${messages.length === 1 ? "" : "s"}</summary>${messages.map(({ message, kind }) => `<p class="-${kind}">${escapeHtml(message)}</p>`).join("")}</details>`
      : `<span class="-valid">All 17 terrain mappings reference available table entries.</span>`;
    return validation;
  };

  const renderPreview = () => {
    syncDraftFromControls();
    renderValidation();
    const token = ++previewToken;
    const seasonIndex = Number(overlay.querySelector<HTMLSelectElement>("[data-preview-season]")?.value ?? 0);
    const backgroundIndex = draft.backgrounds[previewAttribute] ?? NO_BATTLE_ENVIRONMENT_MODEL;
    const platformIndex = draft.platforms[previewAttribute] ?? NO_BATTLE_ENVIRONMENT_MODEL;
    const backgroundHost = overlay.querySelector<HTMLElement>("[data-background-preview-host]");
    const platformHost = overlay.querySelector<HTMLElement>("[data-platform-preview-host]");
    const title = overlay.querySelector<HTMLElement>("[data-preview-title]");
    if (title) title.textContent = BATTLE_BACKGROUND_ATTRIBUTE_NAMES[previewAttribute] ?? `Attribute ${previewAttribute}`;
    backgroundRenderer?.dispose();
    backgroundRenderer = undefined;
    platformRenderer?.dispose();
    platformRenderer = undefined;
    if (backgroundHost) backgroundHost.innerHTML = "<em>Loading background…</em>";
    if (platformHost) platformHost.innerHTML = "<em>Loading platform…</em>";

    const backgroundVariant = selectBackgroundVariant(data, backgroundIndex, draft.season ? seasonIndex : 0);
    if (!backgroundVariant && backgroundHost) backgroundHost.innerHTML = `<em>Background ${backgroundIndex} has no renderable model.</em>`;
    else if (backgroundVariant && backgroundHost) {
      void loadBattleBackgroundScene(project, backgroundVariant.resourceId)
        .then((scene) => {
          if (token !== previewToken || !backgroundHost.isConnected) return;
          backgroundRenderer = mountBattleBackgroundRenderer(backgroundHost, scene);
        })
        .catch((error) => {
          if (token === previewToken && backgroundHost.isConnected) backgroundHost.innerHTML = `<em>${escapeHtml(errorMessage(error))}</em>`;
        });
    }

    const platformVariant = selectPlatformVariant(data, platformIndex, draft.season ? seasonIndex : 0);
    if (!platformVariant && platformHost) platformHost.innerHTML = `<em>Platform ${platformIndex} has no renderable model.</em>`;
    else if (platformVariant && platformHost) {
      void loadBattlePlatformScene(project, platformVariant.resourceId)
        .then((scene) => {
          if (token !== previewToken || !platformHost.isConnected) return;
          platformRenderer = mountBattleBackgroundRenderer(platformHost, scene);
          platformRenderer.fitModel();
        })
        .catch((error) => {
          if (token === previewToken && platformHost.isConnected) platformHost.innerHTML = `<em>${escapeHtml(errorMessage(error))}</em>`;
        });
    }
  };

  overlay.querySelector(".header-battle-dialog-close")?.addEventListener("click", close);
  overlay.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const previewRadio = target.closest<HTMLInputElement>("[data-preview-attribute-radio]");
    if (previewRadio) previewAttribute = Number(previewRadio.value);
    renderPreview();
  });
  overlay.querySelector("[data-copy-current-mapping]")?.addEventListener("click", () => {
    syncDraftFromControls();
    const background = draft.backgrounds[previewAttribute] ?? NO_BATTLE_ENVIRONMENT_MODEL;
    const platform = draft.platforms[previewAttribute] ?? NO_BATTLE_ENVIRONMENT_MODEL;
    overlay.querySelectorAll<HTMLSelectElement>("[data-mapping-kind='background']").forEach((select) => { select.value = String(background); });
    overlay.querySelectorAll<HTMLSelectElement>("[data-mapping-kind='platform']").forEach((select) => { select.value = String(platform); });
    renderPreview();
  });
  overlay.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const validation = renderValidation();
    if (!validation.valid) {
      window.alert(validation.errors.join("\n"));
      return;
    }
    try {
      if (mode === "custom") createHeaderSpecificBattleEnvironmentType(project, data, rowId, draft);
      else updateSharedBattleEnvironmentType(project, data, sourceTypeIndex, draft);
      onDirty?.();
      close();
      refreshAll();
    } catch (error) {
      window.alert(errorMessage(error));
    }
  });
  renderPreview();
}

function renderMappingRow(
  data: BattleEnvironmentEditorData,
  draft: BattleEnvironmentZoneSpec,
  name: string,
  attributeIndex: number,
  previewAttribute: number,
): string {
  return `
    <label class="header-battle-mapping-row">
      <input type="radio" name="battle-environment-preview-attribute" value="${attributeIndex}" data-preview-attribute-radio ${attributeIndex === previewAttribute ? "checked" : ""}>
      <strong><span>${String(attributeIndex).padStart(2, "0")}</span>${escapeHtml(name)}</strong>
      <select data-mapping-kind="background" data-attribute-index="${attributeIndex}">${renderBackgroundOptions(data, draft.backgrounds[attributeIndex] ?? NO_BATTLE_ENVIRONMENT_MODEL)}</select>
      <select data-mapping-kind="platform" data-attribute-index="${attributeIndex}">${renderPlatformOptions(data, draft.platforms[attributeIndex] ?? NO_BATTLE_ENVIRONMENT_MODEL)}</select>
    </label>
  `;
}

function renderBackgroundOptions(data: BattleEnvironmentEditorData, selected: number): string {
  return renderModelOptions("Background", data.backgroundCatalog.tableEntryCount, new Set(data.backgroundCatalog.variants.map((variant) => variant.tableIndex)), selected);
}

function renderPlatformOptions(data: BattleEnvironmentEditorData, selected: number): string {
  return renderModelOptions("Platform", data.platformCatalog.tableEntryCount, new Set(data.platformCatalog.variants.map((variant) => variant.tableIndex)), selected);
}

function renderModelOptions(label: string, count: number, renderable: Set<number>, selected: number): string {
  const options = [`<option value="${NO_BATTLE_ENVIRONMENT_MODEL}" ${selected === NO_BATTLE_ENVIRONMENT_MODEL ? "selected" : ""}>None (255)</option>`];
  for (let index = 0; index < count; index += 1) {
    const suffix = renderable.has(index) ? "" : " · missing model";
    options.push(`<option value="${index}" ${selected === index ? "selected" : ""}>${label} ${String(index).padStart(2, "0")}${suffix}</option>`);
  }
  if (selected !== NO_BATTLE_ENVIRONMENT_MODEL && selected >= count) options.push(`<option value="${selected}" selected>${label} ${selected} · outside table</option>`);
  return options.join("");
}

function syncTypeSelectOptions(root: HTMLElement, project: ProjectState, data: BattleEnvironmentEditorData): void {
  const usageCounts = data.rows.map((_spec, typeIndex) => project.headers ? battleEnvironmentTypeUsage(project.headers, typeIndex).length : 0);
  root.querySelectorAll<HTMLSelectElement>(".header-battle-type-select").forEach((select) => {
    const card = select.closest<HTMLElement>(".filterable");
    const rowId = Number(card?.dataset.index);
    const row = project.headers?.rows[rowId];
    if (!row) return;
    const selected = headerBattleEnvironmentType(row);
    select.innerHTML = data.rows.map((_spec, typeIndex) => {
      const count = usageCounts[typeIndex] ?? 0;
      return `<option value="${typeIndex}" ${typeIndex === selected ? "selected" : ""}>${escapeHtml(typeOptionLabel(typeIndex))} · ${count} header${count === 1 ? "" : "s"}</option>`;
    }).join("");
    if (selected >= data.rows.length) select.insertAdjacentHTML("beforeend", `<option value="${selected}" selected>${escapeHtml(typeOptionLabel(selected))} · missing zone-spec row</option>`);
  });
}

function selectBackgroundVariant(data: BattleEnvironmentEditorData, tableIndex: number, seasonIndex: number): BattleBackgroundVariant | undefined {
  const variants = data.backgroundCatalog.variants.filter((variant) => variant.tableIndex === tableIndex);
  return variants.find((variant) => variant.seasonIndex === seasonIndex) ?? variants.find((variant) => variant.seasonIndex === 0) ?? variants[0];
}

function selectPlatformVariant(data: BattleEnvironmentEditorData, tableIndex: number, seasonIndex: number): BattlePlatformVariant | undefined {
  const variants = data.platformCatalog.variants.filter((variant) => variant.tableIndex === tableIndex);
  return variants.find((variant) => variant.seasonIndex === seasonIndex) ?? variants.find((variant) => variant.seasonIndex === 0) ?? variants[0];
}

function backgroundSummary(data: BattleEnvironmentEditorData, tableIndex: number): string {
  if (tableIndex === NO_BATTLE_ENVIRONMENT_MODEL) return "No background assigned";
  const variants = data.backgroundCatalog.variants.filter((variant) => variant.tableIndex === tableIndex);
  if (variants.length === 0) return "Missing or unrenderable model";
  return variants.length > 1 ? `${variants.length} seasonal model variants` : `Model resource ${variants[0]?.resourceId}`;
}

function platformSummary(data: BattleEnvironmentEditorData, tableIndex: number): string {
  if (tableIndex === NO_BATTLE_ENVIRONMENT_MODEL) return "No platform assigned";
  const variants = data.platformCatalog.variants.filter((variant) => variant.tableIndex === tableIndex);
  if (variants.length === 0) return "Missing or unrenderable model";
  return variants.length > 1 ? `${variants.length} seasonal model variants` : `Model resource ${variants[0]?.resourceId}`;
}

function resolutionRow(label: string, index: number | undefined, summary: string): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${index === undefined ? "" : String(index).padStart(2, "0")}</strong><em>${escapeHtml(summary)}</em></div>`;
}

function renderAttributeOptions(selected: number): string {
  return BATTLE_BACKGROUND_ATTRIBUTE_NAMES.map((name, index) => `<option value="${index}" ${index === selected ? "selected" : ""}>${String(index).padStart(2, "0")} · ${escapeHtml(name)}</option>`).join("");
}

function typeOptionLabel(typeIndex: number): string {
  return `${String(typeIndex).padStart(2, "0")} · ${battleEnvironmentTypeName(typeIndex)}`;
}

function headerBattleEnvironmentType(row: HeaderRow): number {
  return (getHeaderPackedValue(row, "map_behavior") >>> 5) & 0x1f;
}

function syncPackedRawValue(card: HTMLElement, rawValue: number): void {
  const editor = card.querySelector<HTMLElement>(".header-flag-editor[data-field-name='map_behavior']");
  if (editor) editor.dataset.rawValue = String(rawValue);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
