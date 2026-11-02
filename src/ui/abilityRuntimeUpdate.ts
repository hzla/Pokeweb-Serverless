import { CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects, upgradeAbilityRuntime } from "../pokeweb/abilityEffectsModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import "../styles/moveDllFlags.css";

export function renderAbilityRuntimeUpdate(project: ProjectState): string {
  const state = inspectAbilityEffects(project), older = state.editable && state.runtimeVersion !== undefined && state.runtimeVersion < CURRENT_ABILITY_RUNTIME_VERSION;
  const title = !state.editable ? state.message : older ? "Update the shared runtime and preserve existing ability settings" : state.runtimeVersion === undefined ? "No ability runtime installed" : "Ability runtime is current";
  return `<div class="ability-runtime-update"><button type="button" class="btn -default" data-update-ability-runtime ${older ? "" : "disabled"} title="${escapeHtml(title)}">Update Ability Runtime</button><span role="status" data-ability-runtime-status></span></div>`;
}
export function refreshAbilityRuntimeUpdate(root: HTMLElement, project: ProjectState): void {
  const button = root.querySelector<HTMLButtonElement>("[data-update-ability-runtime]");
  if (!button) return;
  const state = inspectAbilityEffects(project);
  button.disabled = !state.editable || state.runtimeVersion === undefined || state.runtimeVersion >= CURRENT_ABILITY_RUNTIME_VERSION;
  button.title = !state.editable ? state.message : state.runtimeVersion === undefined ? "No ability runtime installed" : button.disabled ? "Ability runtime is current" : "Update the shared runtime and preserve existing ability settings";
}
export function installAbilityRuntimeUpdate(root: HTMLElement, project: ProjectState, onDirty?: () => void): void {
  const button = root.querySelector<HTMLButtonElement>("[data-update-ability-runtime]");
  button?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("[data-ability-runtime-status]")!;
    button.disabled = true; status.textContent = "Updating…";
    try { await upgradeAbilityRuntime(project); status.textContent = "Updated"; onDirty?.(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { refreshAbilityRuntimeUpdate(root, project); }
  });
}
