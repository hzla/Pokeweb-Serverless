import type { HeaderRow } from "../pokeweb/headerModel";
import {
  HEADER_FIELD_LABELS,
  HEADER_MAIN_FIELDS,
  HEADER_PACKED_FIELDS,
  getHeaderPackedValue,
  headerFieldMax,
} from "../pokeweb/headerModel";
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

type HeaderDetailItem = { kind: "field"; field: string; max?: number; openOverworld?: boolean } | { kind: "packed"; field: string };

const HEADER_DETAIL_SECTIONS: Array<{ title: string; items: readonly HeaderDetailItem[] }> = [
  {
    title: "Map Identity",
    items: [
      { kind: "field", field: "map_type", max: 255 },
      { kind: "field", field: "texture_id", max: 65535 },
      { kind: "field", field: "parent_map_id", max: 65535 },
      { kind: "field", field: "overworlds_id", max: 65535, openOverworld: true },
      { kind: "field", field: "enc_data_id", max: 65535 },
    ],
  },
  {
    title: "Scripts & Text",
    items: [
      { kind: "field", field: "matrix_id", max: 65535 },
      { kind: "field", field: "script_id", max: 65535 },
      { kind: "field", field: "level_script_id", max: 65535 },
      { kind: "field", field: "text_bank_id", max: 65535 },
      { kind: "field", field: "place_name_id", max: 1023 },
    ],
  },
  {
    title: "Camera & Nameplate",
    items: [
      { kind: "packed", field: "weather_camera" },
      { kind: "packed", field: "place_name_flags" },
      { kind: "field", field: "name_icon_id", max: 8191 },
    ],
  },
  {
    title: "Zone Extras",
    items: [
      { kind: "field", field: "difficulty_level_adjustment", max: 7 },
      { kind: "field", field: "unknown_1", max: 255 },
      { kind: "field", field: "unknown_3", max: 65535 },
      { kind: "field", field: "name_icon", max: 65535 },
    ],
  },
  {
    title: "Movement & Battle",
    items: [{ kind: "packed", field: "map_behavior" }],
  },
  {
    title: "Seasonal Music",
    items: [
      { kind: "field", field: "music_spring_id", max: 65535 },
      { kind: "field", field: "music_summer_id", max: 65535 },
      { kind: "field", field: "music_fall_id", max: 65535 },
      { kind: "field", field: "music_winter_id", max: 65535 },
    ],
  },
  {
    title: "Default Start",
    items: [
      { kind: "field", field: "fly_x", max: 4294967296 },
      { kind: "field", field: "fly_y", max: 4294967296 },
      { kind: "field", field: "fly_z", max: 4294967296 },
    ],
  },
];

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
          <div class="hdr-encounters">Encounter</div>
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
        ${field("enc_data_id", "hdr-encounters", row.enc_data_id, { type: "int-65535" })}
        <div class="move-info expand-action expand-header svg no-fill" data-expand="header">${INFO_ICON}</div>
      </div>
      <div class="expanded-card-content expanded-header">
        <div class="header-detail-grid">
          ${HEADER_DETAIL_SECTIONS.map((section) => renderHeaderDetailSection(row, section.title, section.items, canOpenOverworld)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderHeaderDetailSection(row: HeaderRow, title: string, items: readonly HeaderDetailItem[], canOpenOverworld: boolean): string {
  return `
    <section class="header-detail-section">
      <div class="header-detail-section-title">${escapeHtml(title)}</div>
      <div class="header-detail-section-fields">
        ${items.map((item) => renderHeaderDetailItem(row, item, canOpenOverworld)).join("")}
      </div>
    </section>
  `;
}

function renderHeaderDetailItem(row: HeaderRow, item: HeaderDetailItem, canOpenOverworld: boolean): string {
  if (item.kind === "packed") return renderHeaderPackedField(row, item.field);

  const max = item.max ?? headerFieldMax(item.field) ?? 65535;
  const value = row[item.field] ?? "";
  const label = HEADER_FIELD_LABELS[item.field] ?? titleize(item.field);
  const openLink =
    item.openOverworld && canOpenOverworld
      ? `<a class="header-detail-open-link" href="#" data-open-overworld="${Number(value)}">Open</a>`
      : "";
  return `
    <div class="header-detail-field">
      <label class="header-detail-label">
        <span>${escapeHtml(label)}</span>
        ${openLink}
      </label>
      ${field(item.field, `header-detail-value header-${item.field}`, value, { type: `int-${max}` })}
    </div>
  `;
}

function renderHeaderPackedField(row: HeaderRow, fieldName: string): string {
  const packed = HEADER_PACKED_FIELDS[fieldName];
  if (!packed) return "";

  const value = getHeaderPackedValue(row, fieldName);
  const parts = packed.parts
    .map((part) => {
      const partMax = (1 << part.size) - 1;
      const partValue = (value >> part.offset) & partMax;
      if (part.kind === "checkbox") {
        return `
          <label class="header-flag-check">
            <input class="header-flag-checkbox" data-field-name="${escapeHtml(fieldName)}" data-part-key="${escapeHtml(part.key)}" type="checkbox" ${partValue > 0 ? "checked" : ""}>
            <span>${escapeHtml(part.label)}</span>
          </label>
        `;
      }
      return `
        <label class="header-flag-number">
          <span>${escapeHtml(part.label)}</span>
          ${field(fieldName, "header-detail-value header-packed-value", partValue, { narc: "header-part", type: `int-${partMax}`, part: part.key })}
        </label>
      `;
    })
    .join("");

  return `
    <div class="header-detail-field -packed">
      <div class="header-detail-label">${escapeHtml(packed.label)}</div>
      <div class="header-flag-editor" data-field-name="${escapeHtml(fieldName)}" data-raw-value="${value}">${parts}</div>
    </div>
  `;
}

function field(
  name: string,
  className: string,
  value: unknown,
  options: { type?: string; autofill?: string; narc?: "header" | "header-part"; part?: string } = {},
): string {
  const type = options.type ?? (name === "location_name" ? undefined : `int-${headerFieldMax(name) ?? 65535}`);
  const typeAttr = type ? ` data-type="${type}"` : "";
  const autocompleteAttr = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const partAttr = options.part ? ` data-part-key="${escapeHtml(options.part)}"` : "";
  return `<div autocorrect="off" class="${className}" contenteditable="true" data-narc="${options.narc ?? "header"}" data-field-name="${name}"${partAttr}${autocompleteAttr}${typeAttr}>${escapeHtml(String(value ?? ""))}</div>`;
}

function titleize(value: string): string {
  return value
    .replace(/_/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
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
