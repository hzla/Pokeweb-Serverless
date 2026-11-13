import type { HeaderRow } from "../pokeweb/headerModel";
import {
  HEADER_FIELD_LABELS,
  HEADER_MAIN_FIELDS,
  HEADER_PACKED_FIELDS,
  getHeaderPackedValue,
  headerFieldMax,
} from "../pokeweb/headerModel";
import { isGen4Project } from "../pokeweb/constants";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import {
  initializeHeaderBattleEnvironmentEditors,
  renderBattleBackgroundTypeSelect,
  renderHeaderBattleEnvironmentCard,
} from "./headerBattleEnvironmentEditor";
import { attachHeaderInteractions } from "./legacyInteractions";
import { headerMatchesSearch } from "../pokeweb/headerModel";
import { getEncounterCount } from "../pokeweb/encounterModel";
import "../styles/moveData.css";
import "../styles/headerData.css";


type HeaderDetailItem =
  | { kind: "field"; field: string; max?: number; openOverworld?: boolean; text?: boolean }
  | { kind: "packed"; field: string }
  | { kind: "battleEnvironment" };
type HeaderDetailSection = { title: string; items: readonly HeaderDetailItem[] };

const GEN5_HEADER_DETAIL_SECTIONS: HeaderDetailSection[] = [
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
    items: [{ kind: "packed", field: "map_behavior" }, { kind: "battleEnvironment" }],
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

function headerDetailSectionsFor(project: ProjectState): HeaderDetailSection[] {
  if (!isGen4Project(project)) return GEN5_HEADER_DETAIL_SECTIONS;

  const isHgss = project.session.baseRom === "HGSS";
  const isPt = project.session.baseRom === "Pt";
  const locationMax = project.session.baseRom === "DP" ? 65535 : 255;
  const wildMax = isHgss ? 255 : 65535;
  const weatherMax = isHgss ? 127 : 255;
  const cameraMax = isHgss ? 63 : 255;
  const battleBgMax = project.session.baseRom === "DP" ? 15 : 31;
  const flagsMax = isHgss ? 127 : 15;

  const familyExtras: HeaderDetailSection[] = isHgss
    ? [
        {
          title: "HGSS World Map",
          items: [
            { kind: "field", field: "kanto_flag", max: 1 },
            { kind: "field", field: "worldmap_x", max: 63 },
            { kind: "field", field: "worldmap_y", max: 63 },
            { kind: "field", field: "area_icon", max: 15 },
            { kind: "field", field: "unknown_0", max: 15 },
            { kind: "field", field: "unknown_1", max: 15 },
          ],
        },
      ]
    : [
        {
          title: isPt ? "Platinum Extras" : "DP Extras",
          items: [
            ...(isPt ? ([{ kind: "field", field: "area_icon", max: 15 }] as HeaderDetailItem[]) : []),
            { kind: "field", field: "unknown_1", max: 255 },
          ],
        },
      ];

  return [
    {
      title: "Map Identity",
      items: [
        { kind: "field", field: "internal_name", text: true },
        { kind: "field", field: "area_data_id", max: 255 },
        { kind: "field", field: "matrix_id", max: 65535 },
        { kind: "field", field: "event_id", max: 65535, openOverworld: true },
        { kind: "field", field: "wild_id", max: wildMax },
      ],
    },
    {
      title: "Scripts & Text",
      items: [
        { kind: "field", field: "script_id", max: 65535 },
        { kind: "field", field: "level_script_id", max: 65535 },
        { kind: "field", field: "text_bank_id", max: 65535 },
        { kind: "field", field: "place_name_id", max: locationMax },
      ],
    },
    {
      title: "Audio & Camera",
      items: [
        { kind: "field", field: "music_day_id", max: 65535 },
        { kind: "field", field: "music_night_id", max: 65535 },
        { kind: "field", field: "weather_id", max: weatherMax },
        { kind: "field", field: "camera_id", max: cameraMax },
      ],
    },
    {
      title: "Behavior",
      items: [
        ...(isHgss ? ([{ kind: "field", field: "location_type", max: 15 }, { kind: "field", field: "follow_mode", max: 3 }] as HeaderDetailItem[]) : []),
        ...(!isHgss ? ([{ kind: "field", field: "location_specifier", max: isPt ? 127 : 255 }] as HeaderDetailItem[]) : []),
        { kind: "field", field: "battle_background", max: battleBgMax },
        { kind: "field", field: "flags", max: flagsMax },
      ],
    },
    ...familyExtras,
  ];
}

export type HeaderEditorOptions = {
  onDirty?: () => void;
  /** Header row (1-based) to show; the host keeps it in the URL so Back returns here. */
  selectedRowId?: number;
  onSelect?: (rowId: number) => void;
  onOpenOverworld?: (overworldId: number, rowId: number) => void;
  onOpenSeasons?: (headerIndex: number) => void;
  onOpenText?: (bankId: number) => void;
  onOpenScript?: (scriptId: number) => void;
  onOpenMap?: (zoneId: number) => void;
  onOpenEncounters?: (encounterId: number) => void;
};

/** Selection and search survive re-renders of the header list per project. */
const headerSelection = new WeakMap<ProjectState, { rowId: number; search: string; scrollTop: number }>();

export function renderHeaderEditor(project: ProjectState, root: HTMLElement, options: HeaderEditorOptions = {}): void {
  const headers = project.headers;
  if (!headers) throw new Error("Header data has not been parsed");
  const gen4 = isGen4Project(project);
  const view = headerSelection.get(project) ?? { rowId: 1, search: "", scrollTop: 0 };
  headerSelection.set(project, view);
  if (options.selectedRowId !== undefined) view.rowId = options.selectedRowId;
  if (view.rowId < 1 || view.rowId > headers.count) view.rowId = 1;
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";

  const rowIds = Array.from({ length: headers.count }, (_, index) => index + 1);
  root.innerHTML = `
    <div class="header-data" id="header-data">
      <aside class="md-list" aria-label="Map headers">
        <div class="md-filters">
          <input class="md-search" id="header-search" type="search" placeholder="Search headers" autocomplete="off" spellcheck="false" aria-label="Search headers" value="${escapeHtml(view.search)}">
        </div>
        <div class="md-list-head" aria-hidden="true"><span>ID</span><span>Location</span><span>Matrix</span></div>
        <div class="md-rows" id="header-list" role="listbox" aria-label="Map headers" tabindex="0">
          ${rowIds.map((rowId) => `<div class="md-row hd-row" data-header-row="${rowId}" role="option" aria-selected="false">${renderHeaderListRow(headers.rows[rowId], rowId)}</div>`).join("")}
        </div>
      </aside>
      <section class="md-detail" id="header-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#header-list")!;
  const detail = root.querySelector<HTMLElement>("#header-detail")!;
  const search = root.querySelector<HTMLInputElement>("#header-search")!;
  const rows = [...list.querySelectorAll<HTMLElement>("[data-header-row]")];

  const applyFilter = () => {
    const text = view.search.trim();
    rows.forEach((element) => {
      const rowId = Number(element.dataset.headerRow);
      const row = headers.rows[rowId];
      const visible = !text || String(rowId - 1) === text || (row ? headerMatchesSearch(row, text) : false);
      element.style.display = visible ? "" : "none";
    });
  };

  const markSelection = (scroll: boolean) => {
    rows.forEach((element) => {
      const active = Number(element.dataset.headerRow) === view.rowId;
      element.classList.toggle("is-selected", active);
      element.setAttribute("aria-selected", String(active));
      if (active && scroll) element.scrollIntoView({ block: "nearest" });
    });
  };

  const refreshListRow = (rowId: number) => {
    const element = rows[rowId - 1];
    if (element) element.innerHTML = renderHeaderListRow(headers.rows[rowId], rowId);
  };

  const renderDetail = () => {
    const rowId = view.rowId;
    const row = headers.rows[rowId];
    if (!row) {
      detail.innerHTML = "";
      return;
    }
    detail.innerHTML = `<div class="hd-detail">${renderHeaderDetail(project, rowId, row, options, gen4)}</div>`;
    const host = detail.querySelector<HTMLElement>(".hd-detail")!;
    const onDirty = () => {
      options.onDirty?.();
      refreshListRow(rowId);
      const links = host.querySelector<HTMLElement>("[data-header-links]");
      if (links) links.innerHTML = renderHeaderLinks(project, row, options, gen4);
      const title = host.querySelector<HTMLElement>("[data-header-title]");
      if (title) title.textContent = String(row.location_name ?? "");
      const subtitle = host.querySelector<HTMLElement>("[data-header-subtitle]");
      if (subtitle) subtitle.textContent = headerSubtitle(row, gen4);
    };
    attachHeaderInteractions(host, project, { onDirty });
    if (!gen4) initializeHeaderBattleEnvironmentEditors(host, project, onDirty);
    host.addEventListener("click", (event) => {
      const link = (event.target as Element).closest<HTMLElement>("[data-open-ref]");
      if (!link || link.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      const id = Number(link.dataset.refId);
      if (!Number.isSafeInteger(id)) return;
      const kind = link.dataset.openRef;
      if (kind === "overworld") options.onOpenOverworld?.(id, rowId);
      else if (kind === "matrix") options.onOpenSeasons?.(id);
      else if (kind === "text") options.onOpenText?.(id);
      else if (kind === "script") options.onOpenScript?.(id);
      else if (kind === "map") options.onOpenMap?.(id);
      else if (kind === "encounters") options.onOpenEncounters?.(id);
    });
  };

  const select = (rowId: number, scroll: boolean) => {
    if (rowId === view.rowId && detail.childElementCount > 0) return;
    view.rowId = rowId;
    markSelection(scroll);
    renderDetail();
    detail.scrollTop = 0;
    options.onSelect?.(rowId);
  };

  list.addEventListener("click", (event) => {
    const element = (event.target as Element).closest<HTMLElement>("[data-header-row]");
    if (element) select(Number(element.dataset.headerRow), false);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const visible = rows.filter((element) => element.style.display !== "none");
    const index = visible.findIndex((element) => element.classList.contains("is-selected"));
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(Number(next.dataset.headerRow), true);
  });
  list.addEventListener("scroll", () => {
    view.scrollTop = list.scrollTop;
  });
  let searchTimer: number | undefined;
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      view.search = search.value;
      applyFilter();
    }, 150);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = rows.find((element) => element.style.display !== "none");
    if (first) select(Number(first.dataset.headerRow), true);
  });

  applyFilter();
  list.scrollTop = view.scrollTop;
  markSelection(true);
  renderDetail();
  options.onSelect?.(view.rowId);
}

function renderHeaderListRow(row: HeaderRow | undefined, rowId: number): string {
  return `
    <span class="md-row-id">${rowId - 1}</span>
    <span class="md-row-name">${escapeHtml(String(row?.location_name ?? ""))}</span>
    <span class="md-row-pow">${escapeHtml(String(row?.matrix_id ?? ""))}</span>
  `;
}

function headerSubtitle(row: HeaderRow, gen4: boolean): string {
  return gen4 ? `Matrix ${row.matrix_id}` : `Zone ${row.index} · Matrix ${row.matrix_id}`;
}

function renderHeaderDetail(project: ProjectState, rowId: number, row: HeaderRow, options: HeaderEditorOptions, gen4: boolean): string {
  return `
    <article class="filterable hd-card" data-index="${rowId}">
      <header class="hd-head">
        <div class="td-title"><h1 data-header-title>${escapeHtml(String(row.location_name ?? ""))}</h1><span class="td-num">#${rowId - 1}</span></div>
        <div class="fd-subtitle" data-header-subtitle>${escapeHtml(headerSubtitle(row, gen4))}</div>
      </header>
      <nav class="hd-links" data-header-links aria-label="Open referenced data">${renderHeaderLinks(project, row, options, gen4)}</nav>
      <div class="expanded-header show-flex hd-sections">
        <div class="header-detail-grid">
          <section class="header-detail-section" data-section="location">
            <div class="header-detail-section-title">Location</div>
            <div class="header-detail-section-fields">
              <div class="header-detail-field">
                <label class="header-detail-label"><span>${escapeHtml(HEADER_FIELD_LABELS.location_name ?? "Location name")}</span></label>
                ${field("location_name", "header-detail-value hd-location", row.location_name, { autofill: "location_names" })}
              </div>
            </div>
          </section>
          ${headerDetailSectionsFor(project).map((section) => renderHeaderDetailSection(rowId, row, section.title, section.items)).join("")}
        </div>
      </div>
    </article>
  `;
}

export function renderHeaderLinks(project: ProjectState, row: HeaderRow, options: HeaderEditorOptions, gen4: boolean): string {
  const value = (name: string) => Number(row[name]);
  const link = (kind: string, label: string, id: number, available: boolean, title: string, limit = Infinity, shown = id) => {
    const exists = Number.isSafeInteger(id) && id >= 0 && id !== 0xffff && id < limit;
    const usable = available && exists;
    return `<a class="hd-link" href="#" data-open-ref="${kind}" data-ref-id="${id}" ${usable ? "" : `aria-disabled="true"`} title="${escapeHtml(usable ? title : exists ? `${title} (not available)` : "Not used by this header")}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(exists ? String(shown) : "None")}</strong></a>`;
  };
  let encounterLimit = Infinity;
  try {
    encounterLimit = project.narcs.encounters ? getEncounterCount(project) : Infinity;
  } catch {
    // Without the encounter archive the id is shown as stored.
  }
  const overworld = gen4 ? value("event_id") : value("overworlds_id");
  // Gen 5 packs the table id into the low byte of enc_data_id (exposed as encounter_id); 255 means none.
  const packed = Number(row.encounter_id ?? value("enc_data_id") & 0xff);
  const encounters = gen4 ? value("wild_id") : packed === 0xff ? 0xffff : packed;
  return [
    link("text", "Text bank", value("text_bank_id"), Boolean(options.onOpenText), "Open this text bank"),
    link("script", "Script", value("script_id"), Boolean(options.onOpenScript), "Open this script file"),
    link("overworld", "Overworld", overworld, Boolean(options.onOpenOverworld), "Open the overworld (NPCs, warps, triggers)"),
    link("map", "Map zone", Number(row.index), Boolean(options.onOpenMap), "Open this zone in the map editor"),
    link("matrix", "Matrix", Number(row.index), Boolean(options.onOpenSeasons), "Open this header's matrix", Infinity, value("matrix_id")),
    link("encounters", "Encounters", encounters, Boolean(options.onOpenEncounters), "Open this encounter table", encounterLimit),
  ].join("");
}

/** "Scripts & Text" → "scripts-text": names the section for the stylesheet. */
function headerSectionKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function renderHeaderDetailSection(rowId: number, row: HeaderRow, title: string, items: readonly HeaderDetailItem[]): string {
  return `
    <section class="header-detail-section" data-section="${headerSectionKey(title)}">
      <div class="header-detail-section-title">${escapeHtml(title)}</div>
      <div class="header-detail-section-fields">
        ${items.map((item) => renderHeaderDetailItem(rowId, row, item)).join("")}
      </div>
    </section>
  `;
}

function renderHeaderDetailItem(rowId: number, row: HeaderRow, item: HeaderDetailItem): string {
  if (item.kind === "battleEnvironment") return renderHeaderBattleEnvironmentCard(rowId, row);
  if (item.kind === "packed") return renderHeaderPackedField(row, item.field);

  const max = item.max ?? headerFieldMax(item.field) ?? 65535;
  const value = row[item.field] ?? "";
  const label = HEADER_FIELD_LABELS[item.field] ?? titleize(item.field);
  return `
    <div class="header-detail-field">
      <label class="header-detail-label">
        <span>${escapeHtml(label)}</span>
      </label>
      ${field(item.field, `header-detail-value header-${item.field}`, value, { type: item.text ? null : `int-${max}` })}
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
      if (fieldName === "map_behavior" && part.key === "battle_bg_type") {
        return `
          <label class="header-flag-number -battle-environment-type">
            <span>${escapeHtml(part.label)}</span>
            ${renderBattleBackgroundTypeSelect(partValue)}
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
  options: { type?: string | null; autofill?: string; narc?: "header" | "header-part"; part?: string } = {},
): string {
  const type = options.type === null ? undefined : (options.type ?? (name === "location_name" ? undefined : `int-${headerFieldMax(name) ?? 65535}`));
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
