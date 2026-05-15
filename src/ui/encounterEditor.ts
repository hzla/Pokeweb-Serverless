import grassIcon from "../assets/svgs/grass.svg?raw";
import waterIcon from "../assets/svgs/water.svg?raw";
import springIcon from "../assets/svgs/spring.svg?raw";
import summerIcon from "../assets/svgs/summer.svg?raw";
import fallIcon from "../assets/svgs/fall.svg?raw";
import winterIcon from "../assets/svgs/winter.svg?raw";
import { ENCOUNTER_SEASONS } from "../pokeweb/constants";
import {
  encounterKindsForGroup,
  encounterPercentFor,
  encounterSlotCount,
  getEncounterAutofills,
  getEncounterCount,
  getEncounterRecord,
  syncEncountersToDexHabitats,
  type EncounterGroup,
  type EncounterKind,
  type EncounterRecord,
  type EncounterSeason,
} from "../pokeweb/encounterModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachEncounterInteractions } from "./encounterInteractions";
import { publicAsset } from "../assetUrl";

const SEASON_ICONS: Record<EncounterSeason, string> = {
  spring: springIcon,
  summer: summerIcon,
  fall: fallIcon,
  winter: winterIcon,
};

export function renderEncounterEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter encounter-filter">
      <div class="filter-title">Search</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      ${renderHabitatSyncControls(project)}
      <div class="small-filters">Tip: You can right click a season icon to copy to other seasons</div>
    </div>
    <div class="pokemon-list spreadsheet" id="encounters">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="encounter-id">ID</div>
          <div class="encounter-locations">Location/Header(s)</div>
          <div class="encounter-wilds">Pokemon</div>
        </div>
      </div>
      ${renderEncounterRows(project)}
    </div>
  `;

  attachEncounterInteractions(root, project, {
    onDirty,
    autofills: getEncounterAutofills(project),
    renderRow: (encounterId) => renderEncounterRow(project, encounterId),
    renderPanel: (encounterId, season, group) => renderEncounterPanel(getEncounterRecord(project, encounterId), season, group),
  });

  const syncButton = root.querySelector<HTMLButtonElement>("#sync-habitats-btn");
  const syncStatus = root.querySelector<HTMLElement>("#encounter-sync-status");
  const defaultSyncLabel = syncButton?.textContent?.trim() || "Sync Encounters to Dex Habitats";
  syncButton?.addEventListener("click", async () => {
    try {
      syncButton.disabled = true;
      syncButton.textContent = "Syncing habitats...";
      setSyncStatus(syncStatus, "Syncing habitat list...", "busy");
      const result = await syncEncountersToDexHabitats(project);
      onDirty?.();
      syncButton.textContent = "Habitats synced";
      setSyncStatus(syncStatus, `Synced ${result.habitats} habitats with ${result.species} species entries. Export the ROM to keep the change.`, "success");
    } catch (error) {
      syncButton.textContent = "Sync failed";
      setSyncStatus(syncStatus, error instanceof Error ? error.message : String(error), "error");
    } finally {
      syncButton.disabled = false;
      window.setTimeout(() => {
        if (syncButton.textContent !== "Syncing habitats...") syncButton.textContent = defaultSyncLabel;
      }, 2500);
    }
  });
}

function renderHabitatSyncControls(project: ProjectState): string {
  if (project.session.baseRom !== "BW2") return "";
  return `
    <button class="btn -default encounter-habitat-sync" id="sync-habitats-btn" type="button">
      Sync Encounters to Dex Habitats
    </button>
    <div class="encounter-sync-status" id="encounter-sync-status" role="status" aria-live="polite"></div>
  `;
}

function setSyncStatus(status: HTMLElement | null, message: string, state: "busy" | "success" | "error"): void {
  if (!status) return;
  status.textContent = message;
  status.classList.remove("-busy", "-success", "-error");
  status.classList.add(`-${state}`);
}

export function renderEncounterRow(project: ProjectState, encounterId: number): string {
  return renderEncounterCard(getEncounterRecord(project, encounterId));
}

function renderEncounterRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let encounterId = 0; encounterId < getEncounterCount(project); encounterId += 1) rows.push(renderEncounterRow(project, encounterId));
  return rows.join("");
}

function renderEncounterCard(encounter: EncounterRecord): string {
  return `
    <div class="expanded-field filterable encounter-card" data-index="${encounter.id}">
      <div class="expanded-field-main">
        <div class="encounter-id">${encounter.id}</div>
        <div class="encounter-locations">${escapeHtml(encounter.locations.join(", "))}</div>
        <div class="encounter-wilds">
          ${renderWildGroup("grass", "Grass", encounter.grassWilds, encounter.grassSpriteSlugs)}
          ${renderWildGroup("water", "Water", encounter.waterWilds, encounter.waterSpriteSlugs)}
        </div>
        <div class="move-info expand-action expand-grass svg" data-expand="grass">${grassIcon}</div>
        <div class="move-info expand-action expand-water svg" data-expand="water">${waterIcon}</div>
        <div class="expanded-tab-icons">
          ${ENCOUNTER_SEASONS.map((season) => `<div class="expanded-tab-icon season-icon show-${season} svg" data-show="${season}" title="${titleize(season)}">${SEASON_ICONS[season]}</div>`).join("")}
        </div>
      </div>
    </div>
  `;
}

export function renderEncounterPanel(encounter: EncounterRecord, season: EncounterSeason, group: EncounterGroup): string {
  return `
    <div class="expanded-card-content expanded-encounter expanded-${group} expanded-${season}" data-group="${group}" data-season="${season}">
      ${encounterKindsForGroup(group).map((kind) => renderEncounterKind(encounter, season, kind)).join("")}
    </div>
  `;
}

function renderEncounterKind(encounter: EncounterRecord, season: EncounterSeason, kind: EncounterKind): string {
  const rateField = `${season}_${kind}_rate`;
  const slots = Array.from({ length: encounterSlotCount(kind) }, (_, slot) => renderEncounterSlot(encounter, season, kind, slot));
  return `
    <div class="expanded-left">
      <div class="expanded-field field-header">
        <div class="enc-slot">Encounter Rate</div>
        ${editable(rateField, "enc-rate", encounter.readable[rateField], { type: "int-100" })}
      </div>
      <div class="expanded-field multi field-header">
        <div class="enc-slot">${escapeHtml(titleize(kind))}</div>
        <div class="enc-lvl">Min</div>
        <div class="enc-lvl">Max</div>
        <div class="enc-form">Form</div>
        <div class="enc-percent">%</div>
      </div>
      ${slots.join("")}
    </div>
  `;
}

function renderEncounterSlot(encounter: EncounterRecord, season: EncounterSeason, kind: EncounterKind, slot: number): string {
  const base = `${season}_${kind}_slot_${slot}`;
  return `
    <div class="expanded-field multi">
      ${editable(base, "enc-slot enc-name", encounter.readable[base], { autofill: "pokemon_names" })}
      ${editable(`${base}_min_level`, "enc-lvl", encounter.readable[`${base}_min_level`], { type: "int-100" })}
      ${editable(`${base}_max_level`, "enc-lvl", encounter.readable[`${base}_max_level`], { type: "int-100" })}
      ${editable(`${base}_form`, "enc-form", encounter.readable[`${base}_form`] ?? 0, { type: "int-100" })}
      <div class="enc-percent">${encounterPercentFor(kind, slot)}</div>
    </div>
  `;
}

function renderWildGroup(group: EncounterGroup, label: string, wilds: string[], slugs: string[]): string {
  return `
    <div class="encounter-wild-group -${group}">
      <div class="encounter-wild-group-label">${escapeHtml(label)}</div>
      <div class="encounter-wild-group-sprites">
        ${wilds.length > 0 ? wilds.map((wild, index) => renderWild(wild, slugs[index])).join("") : `<div class="encounter-empty-wilds">None</div>`}
      </div>
    </div>
  `;
}

function renderWild(name: string, slug = "-"): string {
  const missingSprite = publicAsset("images/pokesprite/-.png");
  return `
    <div class="wild">
      <img src="${publicAsset(`images/pokesprite/${slug}.png`)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.src='${missingSprite}'">
    </div>
  `;
}

function editable(field: string, className: string, value: unknown, options: { autofill?: string; type?: string } = {}): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  return `<div autocorrect="off" data-narc="encounter" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}>${escapeHtml(String(value ?? ""))}</div>`;
}

function titleize(value: string): string {
  return value
    .replace(/_/gu, " ")
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}
