import type { ProjectState } from "../pokeweb/projectStore";
import { getTrainerLevelCap, getTrainerLevelCapsStatus, updateTrainerLevelCap } from "../pokeweb/trainerLevelCapsModel";
import { escapeHtml } from "./dom";

export function renderTrainerLevelCapSetting(project: ProjectState, trainerId: number): string {
  const status = getTrainerLevelCapsStatus(project);
  if (!status.installed) return "";
  try {
    const cap = getTrainerLevelCap(project, trainerId);
    return `<span class="md-label" data-mark-fields="data:level_cap_after_win"><label for="trainer-level-cap-${trainerId}">Lvl Cap after Win</label></span>
      <span class="md-value"><input id="trainer-level-cap-${trainerId}" type="number" min="0" max="100" step="1" data-trainer-level-cap
        aria-label="Lvl Cap after Win" placeholder="No change" title="0 or blank: no change" value="${cap || ""}" ${status.compatible ? "" : "disabled"}>
      <span data-trainer-level-cap-status role="status">${status.compatible ? "" : escapeHtml(status.message)}</span></span>`;
  } catch (error) {
    return `<div role="alert">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}
const controllers = new WeakMap<HTMLElement, AbortController>();
export function attachTrainerLevelCapSetting(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  controllers.get(root)?.abort();
  const controller = new AbortController(); controllers.set(root, controller);
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-trainer-level-cap]")) return;
    const card = input.closest<HTMLElement>(".trainer-card"), id = Number(card?.dataset.index);
    if (!card || !Number.isInteger(id)) return;
    const note = input.parentElement?.querySelector<HTMLElement>("[data-trainer-level-cap-status]");
    try {
      const cap = input.value.trim() === "" ? 0 : Number(input.value);
      if (input.validity.badInput) throw new Error("Enter a level from 1 to 100, or clear for no change.");
      updateTrainerLevelCap(project, id, cap);
      input.value = cap ? String(cap) : "";
      input.removeAttribute("aria-invalid");
      if (note) note.textContent = "";
      onDirty();
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  }, { signal: controller.signal });
}
