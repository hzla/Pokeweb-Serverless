import type { NarcName } from "./constants";
import type { ChangelogComparison, ChangelogEntry, ChangelogSummary } from "./changelogModel";
import { createChangelogIconExtractor, type ChangelogIcon } from "./changelogIcons";
import type { ProjectState } from "./projectStore";
import { getTrainerRecord } from "./trainerModel";

export type ChangelogField = { label: string; before: string; after: string; beforeIcon?: ChangelogIcon; afterIcon?: ChangelogIcon };
export type DocumentComparison = ChangelogComparison & { beforeIcons: Array<ChangelogIcon | undefined>; afterIcons: Array<ChangelogIcon | undefined> };
export type ChangelogSubject = {
  title: string;
  fields: ChangelogField[];
  notes: string[];
  comparisons: DocumentComparison[];
  icon?: ChangelogIcon;
  pokemon: Array<{ name: string; icon?: ChangelogIcon }>;
};
export type ChangelogDocument = {
  domain: NarcName | "trainers" | "pokemon";
  narcs: NarcName[];
  title: string;
  filename: string;
  changes: number;
  original: string;
  modified: string;
  version: string;
  emptyMessage: string;
  iconWarning?: string;
  subjects: ChangelogSubject[];
  icons: ChangelogIcon[];
  html: string;
};

// Preview, PDF, and TXT share a structured document; ROM strings are escaped
// only at the HTML boundary. Downloads contain text rather than UI screenshots.
export function buildChangelogDocuments(
  before: ProjectState, after: ProjectState, entries: ChangelogEntry[], summary: ChangelogSummary,
  selectedNarcs: NarcName[], titles: Record<string, string>,
): ChangelogDocument[] {
  const beforeIcons = createChangelogIconExtractor(before, "before");
  const afterIcons = createChangelogIconExtractor(after, "after");
  const sections = new Map<ChangelogDocument["domain"], NarcName[]>();
  for (const narc of selectedNarcs) {
    const domain = narc === "trdata" || narc === "trpok" ? "trainers"
      : narc === "personal" || narc === "learnsets" || narc === "evolutions" ? "pokemon" : narc;
    const narcs = sections.get(domain) ?? [];
    narcs.push(narc);
    sections.set(domain, narcs);
  }
  return [...sections].map(([domain, narcs]) => {
    const used = new Map<string, ChangelogIcon>();
    const unavailable = new Set<string>();
    // Icons decorate names; use one image per Pokemon identity throughout the
    // document, preferring the modified ROM and falling back to the original.
    const extract = (ref: ChangelogEntry["pokemon"]) => {
      const icon = afterIcons.extract(ref) ?? beforeIcons.extract(ref);
      if (icon) used.set(icon.key, icon);
      else if (ref && ref.speciesId > 0) unavailable.add(`${ref.speciesId}:${ref.form ?? 0}:${ref.female ? "female" : "male"}`);
      return icon;
    };
    const title = domain === "trainers" ? "Trainers" : domain === "pokemon" ? "Pokemon" : titles[domain] ?? domain;
    const changes = narcs.reduce((total, narc) => total + (summary.domains[narc] ?? 0), 0);
    const available = narcs.some((narc) => before.narcs[narc] || after.narcs[narc]);
    const emptyMessage = available ? `No changes detected in ${narcs.length > 1 ? "these NARCs" : "this NARC"}.` : `${narcs.length > 1 ? "These NARCs are" : "This NARC is"} not available in either ROM.`;
    const groups = new Map<string, ChangelogEntry[]>();
    for (const entry of entries) {
      if (!narcs.includes(entry.domain as NarcName)) continue;
      const key = entry.recordId === undefined ? entry.subject ?? "Changes" : String(entry.recordId);
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    const subjects = [...groups.values()].map((group): ChangelogSubject => {
      const entry = group[0];
      const comparisons = group.flatMap((entry) => entry.comparison ? [{
        ...entry.comparison,
        beforeIcons: (entry.comparison.beforePokemon ?? []).map(extract),
        afterIcons: (entry.comparison.afterPokemon ?? []).map(extract),
      }] : []);
      const pokemon: ChangelogSubject["pokemon"] = [];
      if (domain === "trainers" && !comparisons.some((comparison) => comparison.layout === "fields")) {
        const id = entry.recordId!;
        const project = after.narcs.trpok?.rawFiles[id] && after.narcs.trdata?.rawFiles[id] ? after : before;
        if (project.narcs.trpok?.rawFiles[id] && project.narcs.trdata?.rawFiles[id]) {
          for (const slot of getTrainerRecord(project, id, { includeTexts: false }).party) pokemon.push({
            name: slot.speciesName,
            icon: extract({ speciesId: slot.speciesId, form: slot.form, female: slot.gender.toLowerCase() === "female" }),
          });
        }
      }
      return {
        title: entry.subject ?? "Changes", icon: extract(entry.pokemon), pokemon, comparisons,
        fields: group.filter((entry) => entry.field && !entry.comparisonDetail).map((entry) => ({
          ...entry.field!, beforeIcon: extract(entry.field!.beforePokemon), afterIcon: extract(entry.field!.afterPokemon),
        })),
        notes: group.filter((entry) => !entry.field && !entry.comparisonDetail).map((entry) => {
          const prefix = `${entry.subject ?? ""} `;
          return entry.text.startsWith(prefix) ? entry.text.slice(prefix.length) : entry.text;
        }),
      };
    });
    const iconWarning = unavailable.size ? `${unavailable.size} referenced Pokemon icon${unavailable.size === 1 ? "" : "s"} could not be extracted. Text comparisons are complete.` : undefined;
    const document: ChangelogDocument = {
      domain, narcs, title, changes, subjects, emptyMessage, iconWarning, icons: [...used.values()],
      original: before.session.romName, modified: after.session.romName, version: summary.beforeVersion,
      filename: `pokeweb-changelog-${domain}.pdf`, html: "",
    };
    document.html = `<header class="changelog-document__header"><h1>${html(title)} changelog</h1>
      <p>${narcs.map((narc) => `<code>${narc}</code>`).join(" + ")} · ${html(document.version)} · ${changes} change${changes === 1 ? "" : "s"}</p>
      <p><strong>Original:</strong> ${html(document.original)}<br><strong>Modified:</strong> ${html(document.modified)}</p>
      <p class="changelog-legend"><span>Original</span> <mark><strong>Updated changes</strong></mark></p></header>
      ${iconWarning ? `<p class="changelog-icon-warning">${html(iconWarning)}</p>` : ""}
      ${subjects.length ? subjects.map(renderSubject).join("") : `<p>${html(emptyMessage)}</p>`}`;
    return document;
  });
}

function renderSubject(subject: ChangelogSubject): string {
  return `<section class="changelog-document__subject"><h2>${iconHtml(subject.icon)}${html(subject.title)}</h2>
    ${subject.pokemon.length ? `<div class="changelog-team-context"><strong>Team:</strong>${subject.pokemon.map((pokemon) => `<span>${iconHtml(pokemon.icon)}${html(pokemon.name)}</span>`).join("")}</div>` : ""}
    ${subject.fields.length ? fieldHtml(subject.fields) : ""}
    ${subject.notes.length ? `<ul>${subject.notes.map((note) => `<li>${html(note)}</li>`).join("")}</ul>` : ""}
    ${subject.comparisons.map((comparison) => `<h3>${html(comparison.title)}</h3><div class="changelog-comparison-scroll">${comparison.layout === "fields" ? teamHtml(comparison) : comparisonHtml(comparison)}</div>`).join("")}
    </section>`;
}

export function teamFields(comparison: DocumentComparison): Array<ChangelogField & { slot: number }> {
  return Array.from({ length: Math.max(comparison.before.length, comparison.after.length) }, (_, index) =>
    comparison.columns.slice(1).map((label, column) => ({
      slot: index + 1, label,
      before: comparison.before[index]?.[column + 1] ?? "None", after: comparison.after[index]?.[column + 1] ?? "None",
      beforeIcon: label === "Pokemon" ? comparison.beforeIcons[index] : undefined,
      afterIcon: label === "Pokemon" ? comparison.afterIcons[index] : undefined,
    }))).flat();
}

function teamHtml(comparison: DocumentComparison): string {
  return `<table class="changelog-field-table"><thead><tr><th scope="col">Slot</th><th scope="col">Field</th><th scope="col">Original</th><th scope="col">Updated</th></tr></thead><tbody>${teamFields(comparison).map((field, index) => {
    const changed = field.before !== field.after;
    const slotStart = index % (comparison.columns.length - 1) === 0;
    return `<tr${slotStart ? ' class="changelog-team-slot"' : ""}>${slotStart ? `<th scope="rowgroup" rowspan="${comparison.columns.length - 1}">${field.slot}</th>` : ""}<th scope="row">${html(field.label)}</th><td>${iconHtml(field.beforeIcon)}${highlight(field.before, "before", changed)}</td><td>${iconHtml(field.afterIcon)}${highlight(field.after, "after", changed)}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function fieldHtml(fields: ChangelogField[]): string {
  return `<div class="changelog-comparison-scroll"><table class="changelog-field-table"><thead><tr><th scope="col">Field</th><th scope="col">Original</th><th scope="col">Updated</th></tr></thead>
    <tbody>${fields.map((field) => `<tr><th scope="row">${html(field.label)}</th><td>${iconHtml(field.beforeIcon)}${html(field.before)}</td><td>${iconHtml(field.afterIcon)}<mark><strong>${html(field.after)}</strong></mark></td></tr>`).join("")}</tbody></table></div>`;
}

function comparisonHtml(comparison: DocumentComparison): string {
  const rate = comparison.rate;
  const rateChanged = rate?.before !== rate?.after;
  return `<table class="changelog-comparison" width="100%"><thead><tr><th scope="col">Original</th><th scope="col">Updated</th></tr></thead><tbody><tr>
<td width="50%" valign="top">${rate ? `<p>Encounter rate: ${highlight(rate.before, "before", rateChanged)}</p>` : ""}${sideTable(comparison.columns, comparison.before, comparison.after, "before", comparison.beforeIcons)}</td>
<td width="50%" valign="top">${rate ? `<p>Encounter rate: ${highlight(rate.after, "after", rateChanged)}</p>` : ""}${sideTable(comparison.columns, comparison.after, comparison.before, "after", comparison.afterIcons)}</td>
</tr></tbody></table>`;
}

function sideTable(columns: string[], rows: string[][], other: string[][], side: "before" | "after", icons: Array<ChangelogIcon | undefined>): string {
  return `<table><thead><tr>${columns.map((column) => `<th scope="col">${html(column)}</th>`).join("")}</tr></thead><tbody>
${rows.length ? rows.map((row, index) => {
    const changed = JSON.stringify(row) !== JSON.stringify(other[index]);
    return `<tr${changed ? ` class="changelog-row-${side}"` : ""}>${row.map((value, column) => `<td>${columns[column] === "Pokemon" ? iconHtml(icons[index]) : ""}${highlight(value, side, changed)}</td>`).join("")}</tr>`;
  }).join("\n") : `<tr><td colspan="${columns.length}">None</td></tr>`}
</tbody></table>`;
}

function highlight(value: string, side: "before" | "after", changed: boolean): string {
  const escaped = html(value);
  if (!changed) return escaped;
  return side === "before" ? `<span class="changelog-old">${escaped}</span>` : `<mark><strong>${escaped}</strong></mark>`;
}

function iconHtml(icon: ChangelogIcon | undefined): string {
  return icon ? `<canvas class="changelog-pokemon-icon" width="32" height="32" data-changelog-icon="${icon.key}" role="img" aria-label="${html(icon.label)} icon"></canvas>` : "";
}
function html(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
