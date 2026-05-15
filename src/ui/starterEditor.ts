import { applyStarters, getStarterEditorState } from "../pokeweb/starterModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type StarterEditorOptions = {
  onDirty?: () => void;
};

export function renderStarterEditor(project: ProjectState, root: HTMLElement, options: StarterEditorOptions = {}): void {
  const state = getStarterEditorState(project);
  root.innerHTML = `
    <div class="starter-page">
      <div class="starter-toolbar">
        <div>
          <h2>Starters</h2>
          <span>${escapeHtml(project.session.baseRom)}</span>
        </div>
        <button class="primary-button" type="button" id="starter-apply-btn">Apply</button>
      </div>
      ${state.warnings.map((warning) => `<div class="starter-warning">${escapeHtml(warning)}</div>`).join("")}
      <div class="starter-grid">
        ${state.slots.map((slot) => renderStarterSlot(project, slot.slot, slot.speciesId)).join("")}
      </div>
      <div class="starter-status" id="starter-status"></div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#starter-apply-btn")?.addEventListener("click", () => {
    const speciesIds = [...root.querySelectorAll<HTMLSelectElement>("[data-starter-slot]")].map((select) => Number(select.value));
    const status = root.querySelector<HTMLDivElement>("#starter-status");
    try {
      const nextState = applyStarters(project, speciesIds);
      options.onDirty?.();
      if (status) status.textContent = `Saved: ${nextState.slots.map((slot) => slot.name).join(", ")}`;
      refreshSlotTypes(project, root);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelectorAll<HTMLSelectElement>("[data-starter-slot]").forEach((select) => {
    select.addEventListener("change", () => refreshSlotTypes(project, root));
  });
}

function renderStarterSlot(project: ProjectState, slot: number, speciesId: number): string {
  const labels = ["Left", "Middle", "Right"];
  const typeName = starterTypeName(project, speciesId);
  return `
    <section class="starter-slot">
      <div class="starter-slot-head">
        <h3>${labels[slot] ?? `Slot ${slot + 1}`}</h3>
        <span data-starter-type="${slot}">${escapeHtml(typeName)}</span>
      </div>
      <select data-starter-slot="${slot}" aria-label="${escapeHtml(labels[slot] ?? `Slot ${slot + 1}`)} starter">
        ${starterOptions(project, speciesId)}
      </select>
    </section>
  `;
}

function starterOptions(project: ProjectState, selectedSpeciesId: number): string {
  const count = Math.min(project.narcs.personal?.fileCount ?? 650, 650);
  const names = project.texts.banks.pokedex ?? [];
  const options: string[] = [];
  for (let speciesId = 1; speciesId < count; speciesId += 1) {
    const name = names[speciesId] ?? `Pokemon ${speciesId}`;
    options.push(`<option value="${speciesId}" ${speciesId === selectedSpeciesId ? "selected" : ""}>${speciesId} - ${escapeHtml(name)}</option>`);
  }
  return options.join("");
}

function refreshSlotTypes(project: ProjectState, root: HTMLElement): void {
  root.querySelectorAll<HTMLSelectElement>("[data-starter-slot]").forEach((select) => {
    const slot = Number(select.dataset.starterSlot);
    const type = root.querySelector<HTMLElement>(`[data-starter-type="${slot}"]`);
    if (type) type.textContent = starterTypeName(project, Number(select.value));
  });
}

function starterTypeName(project: ProjectState, speciesId: number): string {
  const raw = project.narcs.personal?.rawFiles[speciesId];
  if (!raw) return "Unknown";
  const typeId = raw[6] ?? 0;
  return ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy"][typeId] ?? "Unknown";
}
