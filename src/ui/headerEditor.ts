import type { HeaderRow } from "../pokeweb/headerModel";
import { HEADER_EXPANDED_FIELDS, HEADER_MAIN_FIELDS, headerFieldMax } from "../pokeweb/headerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachHeaderInteractions } from "./legacyInteractions";

const INFO_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-info">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12" y2="8"></line>
  </svg>
`;

export function renderHeaderEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, onOpenOverworld?: (overworldId: number) => void): void {
  if (!project.headers) throw new Error("Header data has not been parsed");

  root.innerHTML = `
    <div class="pokemon-filter">
      <div class="filter-title">Search Location</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <button class="btn -default debug-toggle" id="debug-narcs-btn" type="button">Debug NARCs</button>
    </div>
    <div class="pokemon-list spreadsheet" id="headers">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="hdr-id">ID</div>
          <div class="hdr-location">Location Name</div>
          <div class="hdr-matrix">Matrix</div>
          <div class="hdr-script">Scripts</div>
          <div class="hdr-texts">Texts</div>
          <div class="hdr-encounters">Encounters</div>
        </div>
      </div>
      ${renderRows(project, Boolean(onOpenOverworld))}
    </div>
  `;

  attachHeaderInteractions(root, project, { onDirty });
  root.querySelectorAll<HTMLElement>("[data-open-overworld]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const id = Number(link.dataset.openOverworld);
      if (Number.isSafeInteger(id)) onOpenOverworld?.(id);
    });
  });
}

function renderRows(project: ProjectState, canOpenOverworld: boolean): string {
  const headers = project.headers;
  if (!headers) return "";
  const rows: string[] = [];
  for (let rowId = 1; rowId <= headers.count; rowId += 1) {
    const row = headers.rows[rowId];
    rows.push(renderRow(rowId, row, canOpenOverworld));
  }
  return rows.join("");
}

function renderRow(rowId: number, row: HeaderRow, canOpenOverworld: boolean): string {
  return `
    <div class="expanded-field filterable" data-index="${rowId}">
      <div class="expanded-field-main">
        <div class="hdr-id">${rowId - 1}</div>
        ${field("location_name", "hdr-location", row.location_name, { autofill: "location_names" })}
        ${field("matrix_id", "hdr-matrix", row.matrix_id, { type: "int-65535" })}
        ${field("script_id", "hdr-script", row.script_id, { type: "int-65535" })}
        ${field("text_bank_id", "hdr-texts", row.text_bank_id, { type: "int-65535" })}
        ${field("encounter_id", "hdr-encounters", row.encounter_id, { type: "int-65535" })}
        <div class="move-info expand-action expand-header svg no-fill" data-expand="header">${INFO_ICON}</div>
      </div>
      <div class="expanded-card-content expanded-header">
        ${HEADER_EXPANDED_FIELDS.map((column) => renderExpandedColumn(row, column, canOpenOverworld)).join("")}
      </div>
    </div>
  `;
}

function renderExpandedColumn(row: HeaderRow, column: Array<[number, string]>, canOpenOverworld: boolean): string {
  return `
    <div class="expanded-left">
      ${column
        .map(([max, name]) => {
          const value = row[name] ?? "";
          const label =
            name === "overworlds_id"
              ? `<a href="#" ${canOpenOverworld ? `data-open-overworld="${Number(value)}"` : `aria-disabled="true"`}><div style="background: #1abc9c;padding: 5px; border-radius:2px;" class="header-label">${name}</div></a>`
              : `<div class="header-label">${name}</div>`;
          return `
            <div class="expanded-field">
              ${label}
              ${field(name, `hdr-${max},${name}`, value, { type: `int-${max}` })}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function field(
  name: string,
  className: string,
  value: unknown,
  options: { type?: string; autofill?: string } = {},
): string {
  const type = options.type ?? (name === "location_name" ? undefined : `int-${headerFieldMax(name) ?? 65535}`);
  const typeAttr = type ? ` data-type="${type}"` : "";
  const autocompleteAttr = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  return `<div autocorrect="off" class="${className}" contenteditable="true" data-narc="header" data-field-name="${name}"${autocompleteAttr}${typeAttr}>${escapeHtml(String(value ?? ""))}</div>`;
}

export function getHeaderGlobals(project: ProjectState): { headers: Record<string, HeaderRow | number>; autofills: { location_names: string[] } } {
  const globals: Record<string, HeaderRow | number> = { count: project.headers?.count ?? 0 };
  if (project.headers) {
    for (let rowId = 1; rowId <= project.headers.count; rowId += 1) globals[String(rowId)] = project.headers.rows[rowId];
  }
  return {
    headers: globals,
    autofills: {
      location_names: project.texts.banks.locations ?? [],
    },
  };
}

export const HEADER_MAIN_FIELD_NAMES = HEADER_MAIN_FIELDS;
