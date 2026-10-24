import {
  getTrainerFieldConditions, getTrainerFieldConditionsStatus, installTrainerFieldConditions,
  TRAINER_FIELD_WEATHERS, TRAINER_GLOBAL_CONDITIONS, TRAINER_SIDE_CONDITIONS, updateTrainerFieldCondition,
} from "../pokeweb/trainerFieldConditionsModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { renderInlineStatus } from "./inlineStatus";

type Status = ReturnType<typeof getTrainerFieldConditionsStatus>;
export function renderTrainerFieldInstaller(status: Status, sidebar = false): string {
  return `<div class="trainer-field-installer ${sidebar ? "trainer-field-sidebar" : ""}">
    ${renderInlineStatus(status.updateAvailable ? "Update available" : status.installed ? "Installed" : status.compatible ? "Ready" : status.supported ? "Unavailable" : "Unsupported", { className: "patch-badge", title: status.message })}
    <button class="btn ${sidebar ? "-default" : "-primary"}" data-install-trainer-fields type="button" ${status.compatible && (!status.installed || status.updateAvailable) ? "" : "disabled"}>${status.updateAvailable ? "Update Field Conditions" : status.installed ? "Installed" : "Install Field Conditions"}</button>
    <span data-trainer-field-install-status role="status"></span>
  </div>`;
}
export function attachTrainerFieldInstaller(project: ProjectState, root: HTMLElement, onInstalled: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-install-trainer-fields]").forEach(button => {
    button.addEventListener("click", async () => {
      const note = button.closest(".trainer-field-installer")?.querySelector<HTMLElement>("[data-trainer-field-install-status]");
      const label = button.textContent;
      button.disabled = true;
      button.textContent = "Installing…";
      try {
        await installTrainerFieldConditions(project);
        onInstalled();
      } catch (error) {
        button.disabled = false;
        button.textContent = label;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  });
}
export function renderTrainerFieldSettings(project: ProjectState, trainerId: number): string {
  const status = getTrainerFieldConditionsStatus(project);
  if (!status.installed) return "";
  try {
    const c = getTrainerFieldConditions(project, trainerId), disabled = status.compatible ? "" : "disabled";
    const toggle = (field: string, label: string, value: boolean) => `<label class="trainer-field-toggle"><input type="checkbox" data-trainer-field="${field}" ${value ? "checked" : ""} ${disabled}> ${label}</label>`;
    const layers = (field: string, label: string, value: number, max: number) => `<label class="trainer-field-select">${label}<select data-trainer-field="${field}" ${disabled}>${Array.from({ length: max + 1 }, (_, n) => `<option value="${n}" ${n === value ? "selected" : ""}>${n === 0 ? "None" : `${n} ${n === 1 ? "layer" : "layers"}`}</option>`).join("")}</select></label>`;
    return `<section class="trainer-field-settings" aria-label="Battle field conditions">
      ${!status.compatible ? `<p role="alert">${escapeHtml(status.message)}</p>` : ""}
      <div class="trainer-field-columns">
        <fieldset><legend>Whole field</legend>
          <label class="trainer-field-select">Weather<select data-trainer-field="weather" ${disabled}>${TRAINER_FIELD_WEATHERS.map((name, value) => `<option value="${value}" ${value === c.weather ? "selected" : ""}>${name}</option>`).join("")}</select></label>
          ${TRAINER_GLOBAL_CONDITIONS.map(({ id, label }) => toggle(`fields_${id}`, label, Boolean(c.fields & (1 << id)))).join("")}
        </fieldset>
        ${(["player", "opponent"] as const).map(side => `<fieldset><legend>${side === "player" ? "Player side" : "Opposing side"}</legend>
          ${TRAINER_SIDE_CONDITIONS.map(({ id, label }) => toggle(`${side}_${id}`, label, Boolean(c[side] & (1 << id)))).join("")}
          ${layers(`${side}Spikes`, "Spikes", c[`${side}Spikes`], 3)}
          ${layers(`${side}ToxicSpikes`, "Toxic Spikes", c[`${side}ToxicSpikes`], 2)}
        </fieldset>`).join("")}
      </div><p data-trainer-field-status role="status"></p>
    </section>`;
  } catch (error) {
    return `<div class="trainer-field-settings" role="alert">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}
const controllers = new WeakMap<HTMLElement, AbortController>();
export function attachTrainerFieldSettings(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  controllers.get(root)?.abort();
  const controller = new AbortController(); controllers.set(root, controller);
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.trainerField;
    const card = input.closest<HTMLElement>(".trainer-card"), id = Number(card?.dataset.index);
    if (!key || !card || !Number.isInteger(id)) return;
    const note = input.closest(".trainer-field-settings")?.querySelector<HTMLElement>("[data-trainer-field-status]");
    try {
      updateTrainerFieldCondition(project, id, key, input instanceof HTMLInputElement && input.type === "checkbox" ? Number(input.checked) : Number(input.value));
      input.removeAttribute("aria-invalid");
      if (note) note.textContent = "Saved to project. Export the ROM to keep changes.";
      onDirty?.();
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = !input.checked;
      else {
        const c = getTrainerFieldConditions(project, id);
        if (key in c) input.value = String(c[key as keyof typeof c]);
      }
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  }, { signal: controller.signal });
}
