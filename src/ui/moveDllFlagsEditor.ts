import { MOVE_DLL_FLAGS } from "../pokeweb/abilityMoveClasses";
import { configureMoveDllFlags, inspectMoveDllFlags } from "../pokeweb/abilityEffectsModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import "../styles/moveDllFlags.css";

export function renderMoveDllFlags(project: ProjectState, moveId: number): string {
  const state = inspectMoveDllFlags(project, moveId);
  return `<section class="move-dll-flags" aria-label="Expanded Flags" data-move-dll-flags="${moveId}">
    <div class="move-dll-flags-heading"><strong>Expanded Flags</strong><span role="status" data-move-dll-status>${escapeHtml(state.message || (state.customized ? "Custom" : "Default"))}</span></div>
    <div class="move-dll-flags-options">${MOVE_DLL_FLAGS.map(flag => `<label><input type="checkbox" data-move-dll-bit="${flag.mask}" aria-label="Expanded ${flag.label}" ${state.flags & flag.mask ? "checked" : ""} ${state.editable ? "" : "disabled"}>${flag.label}</label>`).join("")}</div>
  </section>`;
}

export function installMoveDllFlags(root: HTMLElement, project: ProjectState, onDirty?: () => void): void {
  root.addEventListener("change", async event => {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-move-dll-bit]")) return;
    event.stopPropagation();
    const section = input.closest<HTMLElement>("[data-move-dll-flags]")!, moveId = Number(section.dataset.moveDllFlags);
    const controls = [...section.querySelectorAll<HTMLInputElement>("[data-move-dll-bit]")];
    const flags = controls.reduce((mask, control) => mask | (control.checked ? Number(control.dataset.moveDllBit) : 0), 0);
    const status = section.querySelector<HTMLElement>("[data-move-dll-status]")!;
    controls.forEach(control => control.disabled = true); status.textContent = "Saving…";
    try {
      await configureMoveDllFlags(project, moveId, flags);
      status.textContent = "Saved"; status.classList.remove("-error"); onDirty?.();
    } catch (error) {
      const saved = inspectMoveDllFlags(project, moveId);
      controls.forEach(control => control.checked = Boolean(saved.flags & Number(control.dataset.moveDllBit)));
      status.textContent = error instanceof Error ? error.message : String(error); status.classList.add("-error");
    } finally {
      const editable = inspectMoveDllFlags(project, moveId).editable;
      controls.forEach(control => control.disabled = !editable);
    }
  });
}
