import type { ProjectState } from "../pokeweb/projectStore";
import { applyGen5MapImport, prepareGen5MapImport, type Gen5MapImport, type Gen5MapImportInput, type Gen5MapImportTarget } from "../pokeweb/gen5MapImport";
import { getMatrixSnapshot, loadMatrixEditorData } from "../pokeweb/matrixModel";
import { MATRIX_SEASONS, resolveSeasonalMatrix, type MatrixSeason } from "../pokeweb/seasonalMatrixModel";
import type { Map3dSceneData } from "../pokeweb/map3dModel";
import { escapeHtml } from "./dom";

type Callbacks = {
  lock(locked: boolean): void;
  preview(data: Map3dSceneData): void;
  restore(): void;
  applied(result: Gen5MapImport): Promise<void>;
};
const fields = [
  ["bin", "Native map BIN", ".bin"], ["model", "Terrain model", ".nsbmd"], ["textures", "Textures", ".nsbtx"],
  ["permissions", "Collision / heights", ".per"], ["secondaryPermissions", "Second collision layer", ".per"],
] as const;

/** A single local transaction; files never leave the browser. */
export async function openGen5MapImportDialog(project: ProjectState, root: HTMLElement, initial: Gen5MapImportTarget, callbacks: Callbacks): Promise<void> {
  await loadMatrixEditorData(project, { seasons: true });
  const dialog = document.createElement("dialog"); dialog.className = "map3d-native-import";
  dialog.setAttribute("aria-label", "Import DS Map Studio map");
  const headers = Object.values(project.headers!.rows);
  dialog.innerHTML = `<form method="dialog">
    <strong>Import DS Map Studio map</strong>
    <fieldset data-native-fields><legend>Destination</legend>
      <label class="map3d-field">Matrix<select name="matrixId">${project.narcs.matrix!.rawFiles.map((_b, id) => `<option value="${id}" ${id === initial.matrixId ? "selected" : ""}>${id}</option>`).join("")}</select></label>
      <div class="map3d-meta-grid"><label class="map3d-field">Cell X<input name="x" type="number" min="0" step="1" value="${initial.x}" required /></label><label class="map3d-field">Cell Y<input name="y" type="number" min="0" step="1" value="${initial.y}" required /></label></div>
      <label class="map3d-field">Graphics header<select name="headerId">${headers.map(h => `<option value="${h.index}" data-matrix="${h.matrix_id}" ${h.index === initial.headerId ? "selected" : ""}>${h.index} · ${escapeHtml(String(h.location_name ?? ""))}</option>`).join("")}</select></label>
      <label class="map3d-field">Season<select name="season">${MATRIX_SEASONS.map(s => `<option ${s === initial.season ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <output data-native-destination></output>
    </fieldset>
    <fieldset data-native-fields><legend>Files</legend>
      <label class="map3d-field">Source game<select name="game"><option value="BW" ${project.session.baseRom === "BW" ? "selected" : ""}>Black / White</option><option value="BW2" ${project.session.baseRom === "BW2" ? "selected" : ""}>Black 2 / White 2</option></select></label>
      ${fields.map(([name, label, accept]) => `<label class="map3d-field">${label}<input name="${name}" type="file" accept="${accept}" /><output data-native-component="${name}">Retain destination</output></label>`).join("")}
    </fieldset>
    <div data-native-status role="status" aria-live="polite"></div>
    <div data-native-summary hidden></div>
    <div class="map3d-building-actions">
      <button class="ow-tool" type="button" data-native="prepare">Review import</button>
      <button class="ow-tool" type="button" data-native="original" hidden>Show original</button>
      <button class="ow-tool" type="button" data-native="converted" hidden>Show imported</button>
      <button class="ow-tool" type="button" data-native="apply" hidden>Apply map import</button>
      <button class="ow-tool" type="button" data-native="cancel">Cancel</button>
    </div>
  </form>`;
  root.append(dialog);
  const form = dialog.querySelector("form")!, status = dialog.querySelector<HTMLElement>("[data-native-status]")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  let pending: Gen5MapImport | undefined, busy = false, closed = false;
  const button = (action: string) => dialog.querySelector<HTMLButtonElement>(`[data-native="${action}"]`)!;
  function close(restore = true) {
    if (closed || busy) return; closed = true;
    if (dialog.open) dialog.close(); dialog.remove(); callbacks.lock(false); if (restore) callbacks.restore();
  }
  function refreshDestination() {
    const matrixId = Number(field("matrixId").value), header = field("headerId") as HTMLSelectElement;
    for (const option of header.options) option.hidden = Number(option.dataset.matrix) !== matrixId;
    if (header.selectedOptions[0]?.hidden) header.value = Array.from(header.options).find(o => !o.hidden)?.value ?? "";
    try {
      const matrix = resolveSeasonalMatrix(project, matrixId, field("season").value as MatrixSeason), x = Number(field("x").value), y = Number(field("y").value);
      (field("x") as HTMLInputElement).max = String(matrix.width - 1); (field("y") as HTMLInputElement).max = String(matrix.height - 1);
      const cell = matrix.cells[y * matrix.width + x];
      dialog.querySelector<HTMLElement>("[data-native-destination]")!.textContent = !cell || x >= matrix.width || y >= matrix.height ? "Choose a cell within this matrix." : cell.mapId === 0xffffffff ? "Add new chunk · all seasons" : `Replace cell · ${field("season").value}`;
    } catch (error) { status.textContent = String(error); }
  }
  for (const name of ["matrixId", "headerId", "x", "y", "season"]) field(name).addEventListener("change", refreshDestination);
  for (const [name] of fields) field(name).addEventListener("change", () => {
    const input = field(name) as HTMLInputElement, file = input.files?.[0];
    dialog.querySelector<HTMLElement>(`[data-native-component="${name}"]`)!.textContent = file ? "Import" : "Retain destination";
    if (name === "bin") for (const other of ["model", "permissions", "secondaryPermissions"]) {
      const control = field(other) as HTMLInputElement; control.disabled = Boolean(file); if (file) { control.value = ""; dialog.querySelector<HTMLElement>(`[data-native-component="${other}"]`)!.textContent = "From BIN"; }
    }
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  form.addEventListener("submit", event => { event.preventDefault(); close(); });
  dialog.addEventListener("click", async event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-native]")?.dataset.native;
    if (!action || busy) return;
    if (action === "cancel") { close(); return; }
    if (action === "original" && pending) { callbacks.preview(pending.original); return; }
    if (action === "converted" && pending) { callbacks.preview(pending.converted); return; }
    if (!form.reportValidity()) return;
    busy = true; for (const b of dialog.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    try {
      if (action === "prepare") {
        status.textContent = "Reading native map resources…";
        const input: Gen5MapImportInput = { game: field("game").value as "BW" | "BW2" };
        for (const [name, , accept] of fields) {
          const file = (field(name) as HTMLInputElement).files?.[0]; if (!file) continue;
          if (!file.name.toLowerCase().endsWith(accept)) throw new Error(`Choose a ${accept} file for this component. Gen 4 sidecars are incompatible with Gen 5.`);
          if (file.size > 64 * 1024 * 1024) throw new Error("Choose component files smaller than 64 MB.");
          input[name] = new Uint8Array(await file.arrayBuffer());
        }
        pending = await prepareGen5MapImport(project, input, { matrixId: Number(field("matrixId").value), x: Number(field("x").value), y: Number(field("y").value),
          headerId: Number(field("headerId").value), season: field("season").value as Gen5MapImportTarget["season"] });
        if (!dialog.isConnected) return;
        if (!pending.changes.length) { status.textContent = "No changes. Native resources match the destination."; pending = undefined; return; }
        for (const fs of dialog.querySelectorAll<HTMLFieldSetElement>("fieldset")) fs.disabled = true;
        for (const fs of dialog.querySelectorAll<HTMLFieldSetElement>("fieldset")) fs.hidden = true;
        const summary = dialog.querySelector<HTMLElement>("[data-native-summary]")!;
        summary.hidden = false; summary.innerHTML = `<p>Matrix ${pending.target.matrixId} · Cell ${pending.target.x}, ${pending.target.y} · ${pending.target.season}</p><p>${pending.components.map(escapeHtml).join(" · ")}</p><p>Map ${pending.mapId} · ${pending.importedTextures} added texture resources</p>${pending.notes.map(note => `<p>${escapeHtml(note)}</p>`).join("")}`;
        button("prepare").hidden = true;
        for (const name of ["original", "converted", "apply"]) button(name).hidden = false;
        callbacks.preview(pending.converted); status.textContent = "Previewing imported game assets.";
      } else if (action === "apply" && pending) {
        await applyGen5MapImport(project, pending);
        const applied = pending; busy = false; close(false); await callbacks.applied(applied);
      }
    } catch (error) { status.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`; }
    finally { busy = false; for (const b of dialog.querySelectorAll<HTMLButtonElement>("button")) b.disabled = false; }
  });
  refreshDestination(); callbacks.lock(true); dialog.show();
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); close(); } });
}
