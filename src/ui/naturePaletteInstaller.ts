import { getNaturePaletteRuntimeStatus, installNaturePaletteRuntime, uninstallNaturePaletteRuntime } from "../pokeweb/naturePaletteRuntime";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
export function renderNaturePaletteInstaller(project: ProjectState): string {
  const status = getNaturePaletteRuntimeStatus(project);
  return `<div class="nature-palette-installer">
    <button type="button" class="btn -default" data-install-nature-palettes ${status.compatible ? "" : "disabled"} title="${escapeHtml(status.message)}">${status.installed ? "Reinstall" : "Install"} Nature Palettes</button>
    ${status.installed ? '<button type="button" class="btn -default" data-remove-nature-palettes>Remove</button>' : ""}
    <span role="status" data-nature-palette-status>${escapeHtml(status.message)}</span>
  </div>`;
}
export function attachNaturePaletteInstaller(project: ProjectState, root: HTMLElement, onChanged: () => void): void {
  for (const [selector, action] of [["[data-install-nature-palettes]", installNaturePaletteRuntime], ["[data-remove-nature-palettes]", uninstallNaturePaletteRuntime]] as const) {
    root.querySelectorAll<HTMLButtonElement>(selector).forEach(button => button.addEventListener("click", async () => {
      const note = button.closest(".nature-palette-installer")?.querySelector<HTMLElement>("[data-nature-palette-status]");
      button.disabled = true;
      try { await action(project); onChanged(); }
      catch (error) { button.disabled = false; if (note) note.textContent = error instanceof Error ? error.message : String(error); }
    }));
  }
}
