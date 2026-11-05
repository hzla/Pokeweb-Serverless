import { pokemonFormLabel } from "../pokeweb/pokemonFormLabels";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { decodeRecord, type ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

/** Number of forms a species has, from its personal record (1 when unknown). */
export function pokemonFormCount(project: ProjectState, speciesId: number): number {
  if (speciesId <= 0 || !project.narcs.personal || speciesId >= project.narcs.personal.fileCount) return 1;
  try {
    return Math.max(1, Number(decodeRecord(project, "personal", speciesId).raw?.num_forms ?? 1));
  } catch {
    return 1;
  }
}

/** A form `<select>` named after the species' forms; keeps an out-of-range current value selectable. */
export function pokemonFormOptions(project: ProjectState, speciesId: number, current: number, field: string): string {
  const count = pokemonFormCount(project, speciesId);
  const name = speciesId > 0 ? pokemonSpeciesLabel(project, speciesId) : "";
  const options = Array.from({ length: Math.max(count, current + 1) }, (_unused, form) => {
    const label = form === 0 ? (count > 1 ? "Base form" : "—") : form < count ? pokemonFormLabel(name, form) : `Form ${form}`;
    return `<option value="${form}"${form === current ? " selected" : ""}>${escapeHtml(label)}</option>`;
  });
  const fixed = count <= 1 && current === 0;
  return `<select class="en-form" data-field-name="${escapeHtml(field)}" aria-label="Form"${fixed ? " disabled" : ""}>${options.join("")}</select>`;
}
