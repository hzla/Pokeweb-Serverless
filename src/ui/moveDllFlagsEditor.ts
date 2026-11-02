import { MOVE_DLL_FLAGS } from "../pokeweb/abilityMoveClasses";
import { configureMoveDllFlags, inspectMoveDllFlags, inspectCustomMoveFlags, createCustomMoveFlag, renameCustomMoveFlag, deleteCustomMoveFlag, configureCustomMoveFlag } from "../pokeweb/abilityEffectsModel";
import { MAX_CUSTOM_MOVE_FLAGS } from "../pokeweb/customMoveFlags";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import "../styles/moveDllFlags.css";

export function renderMoveDllFlags(project: ProjectState, moveId: number): string {
  const state = inspectMoveDllFlags(project, moveId), custom = inspectCustomMoveFlags(project);
  const editable = state.editable && custom.editable;
  return `<section class="move-dll-flags" aria-label="Expanded Flags" data-move-dll-flags="${moveId}">
    <div class="move-dll-flags-heading"><strong>Expanded Flags</strong><span role="status" data-move-dll-status>${escapeHtml(state.message || custom.message || (state.customized || custom.registry.flags.some(flag => flag.moves.includes(moveId)) ? "Custom" : "Default"))}</span></div>
    <div class="move-dll-flags-options">${MOVE_DLL_FLAGS.map(flag => `<label><input type="checkbox" data-move-dll-bit="${flag.mask}" aria-label="Expanded ${flag.label}" ${state.flags & flag.mask ? "checked" : ""} ${editable ? "" : "disabled"}>${flag.label}</label>`).join("")}
      ${custom.registry.flags.map(flag => `<label class="custom-move-flag"><input type="checkbox" data-custom-move-flag="${flag.id}" aria-label="Custom flag ${escapeHtml(flag.name)}" ${flag.moves.includes(moveId) ? "checked" : ""} ${editable ? "" : "disabled"}>${escapeHtml(flag.name)}</label>`).join("")}
    </div>
    <details class="custom-move-flag-manager" data-custom-flag-manager><summary>Manage flags</summary>
      <div class="custom-move-flag-create"><input type="text" maxlength="32" aria-label="New custom flag name" placeholder="New flag name" data-custom-flag-name ${editable ? "" : "disabled"}><button type="button" class="btn -default" data-custom-flag-action="create" ${editable && custom.registry.nextId <= MAX_CUSTOM_MOVE_FLAGS ? "" : "disabled"}>Add flag</button></div>
      <div class="custom-move-flag-list">${custom.registry.flags.map(flag => `<div class="custom-move-flag-row" data-custom-flag-id="${flag.id}">
        <input type="text" value="${escapeHtml(flag.name)}" maxlength="32" aria-label="Rename ${escapeHtml(flag.name)}" data-custom-flag-rename ${editable ? "" : "disabled"}>
        <span>${flag.moves.length} ${flag.moves.length === 1 ? "move" : "moves"}</span>
        <button type="button" class="btn -default" data-custom-flag-action="rename" ${editable ? "" : "disabled"}>Save</button>
        <button type="button" class="btn -default custom-move-flag-remove" data-custom-flag-action="delete" aria-label="Remove ${escapeHtml(flag.name)}" ${editable ? "" : "disabled"}>Remove</button>
      </div>`).join("")}</div>
    </details>
  </section>`;
}
function refreshRows(root: HTMLElement, project: ProjectState): void {
  for (const section of root.querySelectorAll<HTMLElement>("[data-move-dll-flags]")) {
    const open = section.querySelector<HTMLDetailsElement>("[data-custom-flag-manager]")?.open;
    const template = document.createElement("template"); template.innerHTML = renderMoveDllFlags(project, Number(section.dataset.moveDllFlags));
    const next = template.content.firstElementChild as HTMLElement;
    next.querySelector<HTMLDetailsElement>("[data-custom-flag-manager]")!.open = Boolean(open);
    section.replaceWith(next);
  }
}
export function installMoveDllFlags(root: HTMLElement, project: ProjectState, onDirty?: () => void): void {
  let saving = false;
  async function save(section: HTMLElement, action: () => Promise<unknown>): Promise<void> {
    if (saving) return;
    saving = true;
    const moveId = section.dataset.moveDllFlags;
    const controls = [...root.querySelectorAll<HTMLInputElement|HTMLButtonElement>("[data-move-dll-flags] input,[data-move-dll-flags] button")];
    const disabled = controls.map(control => control.disabled); controls.forEach(control => control.disabled = true);
    const status = section.querySelector<HTMLElement>("[data-move-dll-status]")!; status.textContent = "Saving…";
    try {
      await action(); refreshRows(root,project);
      const feedback = root.querySelector<HTMLElement>(`[data-move-dll-flags="${moveId}"] [data-move-dll-status]`);
      if(feedback) feedback.textContent = "Saved"; onDirty?.();
    } catch (error) {
      const state = inspectMoveDllFlags(project,Number(moveId)), custom = inspectCustomMoveFlags(project);
      section.querySelectorAll<HTMLInputElement>("[data-move-dll-bit]").forEach(control => control.checked = Boolean(state.flags & Number(control.dataset.moveDllBit)));
      section.querySelectorAll<HTMLInputElement>("[data-custom-move-flag]").forEach(control => control.checked = Boolean(custom.registry.flags.find(flag => flag.id === Number(control.dataset.customMoveFlag))?.moves.includes(Number(moveId))));
      status.textContent = error instanceof Error ? error.message : String(error); status.classList.add("-error");
    } finally {
      controls.forEach((control,index) => { if(control.isConnected) control.disabled = disabled[index]; }); saving = false;
    }
  }
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-move-dll-bit],[data-custom-move-flag]")) return;
    event.stopPropagation();
    const section = input.closest<HTMLElement>("[data-move-dll-flags]")!, moveId = Number(section.dataset.moveDllFlags);
    if (input.matches("[data-custom-move-flag]")) {
      void save(section,() => configureCustomMoveFlag(project,moveId,Number(input.dataset.customMoveFlag),input.checked));
    } else {
      const flags = [...section.querySelectorAll<HTMLInputElement>("[data-move-dll-bit]")].reduce((mask,control) => mask | (control.checked ? Number(control.dataset.moveDllBit) : 0),0);
      void save(section,() => configureMoveDllFlags(project,moveId,flags));
    }
  });
  root.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-custom-flag-action]");
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const section = button.closest<HTMLElement>("[data-move-dll-flags]")!, row = button.closest<HTMLElement>("[data-custom-flag-id]"), id = Number(row?.dataset.customFlagId);
    const action = button.dataset.customFlagAction;
    if (action === "create") void save(section,() => createCustomMoveFlag(project,section.querySelector<HTMLInputElement>("[data-custom-flag-name]")!.value));
    if (action === "rename") void save(section,() => renameCustomMoveFlag(project,id,row!.querySelector<HTMLInputElement>("[data-custom-flag-rename]")!.value));
    if (action === "delete") void save(section,() => deleteCustomMoveFlag(project,id));
  });
}
