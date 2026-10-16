import { addMatrixHeaderTable, applyMatrixCellEdit, countCroppedMatrixCells, createMatrix, duplicateMatrix,
  getMatrixSnapshot, linkHeaderToMatrix, matrixSelection, matrixMapHasTrees, resizeMatrix, GEN5_MATRIX_EMPTY,
  type MatrixCell, type MatrixSnapshot } from "../pokeweb/matrixModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { Map3dMatrixCell } from "../pokeweb/map3dModel";
import { escapeHtml } from "./dom";
import { installMatrixThumbnails } from "./matrixThumbnails";
import { installMatrixSeasons } from "./matrixSeasons";

let dispose: (() => void) | undefined;
export function stopMatrixEditor(): void { dispose?.(); dispose = undefined; }

export function parseMatrixInput(value: string): number {
  const text = value.trim();
  if (/^empty$/iu.test(text)) return GEN5_MATRIX_EMPTY;
  if (!/^(?:\d+|0x[\da-f]+)$/iu.test(text)) throw new Error("Enter a whole-number ID, hexadecimal ID, or Empty.");
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id < 0 || id > GEN5_MATRIX_EMPTY) throw new Error("ID is outside the allowed range.");
  return id;
}

const headerColor = (headerId: number) => `hsl(${(headerId * 137.508) % 360} 40% 30%)`;
const waterColor = "#3168be";
const brownColor = "#8b5a35";
const waterMapIds = new Set([106, 250, 251, 258, 259, 261, 262, 267, 268, 269, 270, 271, 342, 379, 389, 390, 391, 392, 396]);
const waterLocation = (name: string) => /^(?:Route\s+(?:18|21)|Undella Bay)$/iu.test(name.trim());
const caveOrMountainLocation = (name: string) => /cave|mountain/iu.test(name);

export function matrixCellColor(headerId: number | undefined, locationName = "", cityColor = headerColor(107), treeFiller = false): string {
  if (headerId === undefined || headerId === GEN5_MATRIX_EMPTY) return treeFiller ? "hsl(130 40% 30%)" : "#343b4d";
  const name = locationName.trim();
  if (caveOrMountainLocation(name)) return brownColor;
  if (waterLocation(name)) return waterColor;
  if (/^Route\s/iu.test(name)) return "#efdea2";
  if (/\b(?:City|Town)$/iu.test(name)) return cityColor;
  return headerColor(headerId);
}

const displayId = (id: number | undefined) => id === undefined ? "No table" : id === GEN5_MATRIX_EMPTY ? "Empty" : String(id);

export type MatrixEditorNavigation = {
  openMap?: (zoneId: number | undefined, mapId: number, matrixCell?: Map3dMatrixCell) => void;
  openOverworld?: (overworldId: number, headerId: number) => void | Promise<void>;
};

export function renderMatrixEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, navigation: MatrixEditorNavigation = {}, initial: { matrixId?: number; headerId?: number; seasons?: boolean } = {}): void {
  stopMatrixEditor();
  let id = initial.matrixId ?? 0, snapshot: MatrixSnapshot | undefined, anchor = 0, selection = [0], cellSize = 72;
  let initialHeader = initial.headerId, preferredHeader = initial.headerId, seasonsOpen = initial.seasons ?? false;
  let fitted: "width" | "all" | false = "width";
  let matrixZeroThumbnails = false;
  let inlineEdit: { input: HTMLInputElement; button: HTMLButtonElement } | undefined;
  const node = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const headers = () => Object.values(project.headers?.rows ?? {});
  const cityColor = headerColor(headers().find(header => /^Mistralton City$/iu.test(header.location_name.trim()))?.index ?? 107);
  root.innerHTML = `<section class="matrix-editor">
    <header class="matrix-heading"><div class="matrix-title"><h1>Matrix Editor</h1>
      <div class="matrix-tools"><button class="btn -default" type="button" data-matrix-action="zoom-out" aria-label="Zoom grid out">−</button>
        <button class="btn -default" type="button" data-matrix-action="fit" title="Fit the entire matrix">Fit</button><button class="btn -default" type="button" data-matrix-action="zoom-in" aria-label="Zoom grid in">+</button>
        <label class="matrix-thumbnail-toggle" id="matrix-thumbnail-toggle"><input type="checkbox" role="switch" id="matrix-zero-thumbnails"><span class="matrix-switch-track" aria-hidden="true"></span>Thumbnails</label>
        <button class="btn -default" type="button" data-matrix-action="seasons" id="matrix-seasons-toggle" aria-pressed="${seasonsOpen}">Seasons</button></div></div>
      <div class="matrix-toolbar"><label for="matrix-index">Matrix index</label><select id="matrix-index" aria-label="Matrix index"></select>
        <button type="button" class="btn -default" data-matrix-action="new">New matrix</button><button type="button" class="btn -default" id="matrix-duplicate" data-matrix-action="duplicate">Duplicate</button></div></header>
    <form id="matrix-new-form" class="matrix-new" hidden><h2>New matrix</h2><label>Width <input id="matrix-new-width" type="number" min="1" max="900" step="1" value="1" required></label>
      <label>Height <input id="matrix-new-height" type="number" min="1" max="900" step="1" value="1" required></label>
      <label><input id="matrix-new-headers" type="checkbox" checked> Per-cell headers</label><button class="btn -default" type="submit">Create matrix</button>
      <button class="btn -default" type="button" data-matrix-action="cancel-new">Cancel</button></form>
    <p id="matrix-status" class="matrix-status" role="status" aria-live="polite"></p>
    <div class="matrix-layout"><div class="matrix-map">
      <div class="matrix-viewport" tabindex="0" aria-label="Scrollable matrix grid"><div class="matrix-grid" role="group" aria-label="Matrix cells"></div></div></div>
      <aside class="matrix-inspector" aria-label="Cell inspector"><div id="matrix-selection"></div><div id="matrix-seasons" class="matrix-seasons" hidden></div><div id="matrix-structure"></div></aside>
      <aside id="matrix-references" class="matrix-references" aria-label="Header Reference"></aside></div>
    <datalist id="matrix-header-options">${headers().map(header => `<option value="${header.index}" label="${escapeHtml(header.location_name)}"></option>`).join("")}<option value="Empty"></option></datalist>
  </section>`;
  const thumbnails = installMatrixThumbnails(project, node(".matrix-viewport"), node(".matrix-grid"));
  const seasons = installMatrixSeasons(project, node("#matrix-seasons"), node(".matrix-grid"), didChange => { changed(didChange); render(); });
  seasons.setOpen(seasonsOpen);

  function status(message: string, error = false): void {
    node("#matrix-status").textContent = message; node("#matrix-status").classList.toggle("-error", error);
  }
  function attempt(action: () => string): void {
    try { status(action()); } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
  }
  function changed(didChange: boolean): void { if (didChange) onDirty?.(); }
  function cancelInlineEdit(refocus = false): void {
    const edit = inlineEdit;
    if (!edit) return;
    inlineEdit = undefined;
    edit.input.replaceWith(edit.button);
    if (refocus) edit.button.focus({ preventScroll: true });
  }
  function beginInlineEdit(button: HTMLButtonElement): void {
    if (!snapshot) return;
    cancelInlineEdit();
    if (!snapshot.editable) { status("Read only: this matrix exceeds the 900-cell editor limit.", true); return; }
    if (!snapshot.hasHeaders) { status("Add a header table before editing cell headers.", true); return; }
    const index = Number(button.dataset.matrixCell), cell = snapshot.cells[index];
    if (!cell) return;
    anchor = index; selection = [index]; renderSelection(); status("");
    const input = document.createElement("input");
    input.id = "matrix-cell-header-editor"; input.type = "text";
    input.className = `${button.className} matrix-cell-editor`;
    input.style.cssText = button.style.cssText;
    input.style.backgroundImage = "none";
    input.value = cell.headerId === GEN5_MATRIX_EMPTY ? "" : String(cell.headerId);
    input.autocomplete = "off"; input.spellcheck = false;
    input.setAttribute("aria-label", `Header ID at (${cell.x},${cell.y})`);
    input.setAttribute("aria-describedby", "matrix-status");
    input.title = "Enter to apply. Escape or click away to cancel. Leave blank to clear the header.";
    input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelInlineEdit(true); status(""); return; }
      if (event.key !== "Enter") return;
      event.preventDefault(); event.stopPropagation();
      try {
        const headerId = input.value.trim() ? parseMatrixInput(input.value) : GEN5_MATRIX_EMPTY;
        const didChange = applyMatrixCellEdit(project, id, [index], { headerId });
        const stage = node(".matrix-viewport"), top = stage.scrollTop, left = stage.scrollLeft;
        cancelInlineEdit(); status(""); render();
        stage.scrollTop = top; stage.scrollLeft = left;
        root.querySelector<HTMLButtonElement>(`[data-matrix-cell="${index}"]`)?.focus({ preventScroll: true });
        changed(didChange);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        status(message, true); input.setAttribute("aria-invalid", "true"); input.title = message;
      }
    });
    input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); });
    input.addEventListener("blur", () => { if (inlineEdit?.input === input) { cancelInlineEdit(); status(""); } });
    inlineEdit = { input, button };
    button.replaceWith(input); input.focus({ preventScroll: true }); input.select();
  }
  function render(): void {
    cancelInlineEdit();
    thumbnails.show();
    node<HTMLSelectElement>("#matrix-index").innerHTML = Array.from({ length: project.narcs.matrix?.fileCount ?? 0 }, (_, i) => `<option value="${i}" ${i === id ? "selected" : ""}>Matrix ${i}</option>`).join("");
    try {
      snapshot = getMatrixSnapshot(project, id);
    } catch (error) {
      snapshot = undefined;
      status(`Matrix ${id} cannot be edited: ${error instanceof Error ? error.message : String(error)}`, true);
      for (const selector of [".matrix-grid", "#matrix-selection", "#matrix-structure", "#matrix-references"]) node(selector).innerHTML = "";
      node<HTMLButtonElement>("#matrix-duplicate").disabled = true;
      return;
    }
    const data = snapshot;
    if (initialHeader !== undefined) {
      const matching = data.cells.filter(cell => cell.headerId === initialHeader).map(cell => cell.index);
      if (matching.length) { selection = matching; anchor = matching[0]; }
      initialHeader = undefined;
    }
    const thumbnailToggle = node<HTMLInputElement>("#matrix-zero-thumbnails");
    node("#matrix-thumbnail-toggle").hidden = id !== 0; thumbnailToggle.checked = matrixZeroThumbnails;
    thumbnailToggle.title = matrixZeroThumbnails ? "Show color-coded cells for matrix 0" : "Show map thumbnails for matrix 0";
    selection = selection.filter(index => index < data.cells.length); if (!selection.length) selection = [0];
    if (anchor >= data.cells.length) anchor = selection[0];
    node<HTMLButtonElement>("#matrix-duplicate").disabled = !data.editable;
    if (!data.editable) status("Read only: this matrix exceeds the 900-cell editor limit.", true);
    const grid = node(".matrix-grid");
    grid.style.gridTemplateColumns = `28px repeat(${data.width}, var(--matrix-cell))`;
    grid.style.gridTemplateRows = `24px repeat(${data.height}, var(--matrix-cell))`;
    grid.innerHTML = `<span class="matrix-axis" aria-hidden="true">Y/X</span>${Array.from({ length: data.width }, (_, x) => `<span class="matrix-axis" aria-hidden="true">${x}</span>`).join("")}`
      + Array.from({ length: data.height }, (_, y) => `<span class="matrix-axis" aria-hidden="true">${y}</span>` + data.cells.slice(y * data.width, (y + 1) * data.width).map(cell => {
        const vacant = cell.mapId === GEN5_MATRIX_EMPTY && (cell.headerId === undefined || cell.headerId === GEN5_MATRIX_EMPTY);
        const name = cell.headerId === undefined ? "No per-cell header table" : cell.headerId === GEN5_MATRIX_EMPTY ? "Unassigned header" : project.headers?.rows[cell.headerId + 1]?.location_name ?? "Missing header";
        const missing = (cell.mapId !== GEN5_MATRIX_EMPTY && !project.narcs.maps?.rawFiles[cell.mapId]?.length)
          || (cell.headerId !== undefined && cell.headerId !== GEN5_MATRIX_EMPTY && !project.headers?.rows[cell.headerId + 1]);
        const treeFiller = cell.headerId === GEN5_MATRIX_EMPTY && cell.mapId !== GEN5_MATRIX_EMPTY && matrixMapHasTrees(project.narcs.maps?.rawFiles[cell.mapId]);
        const brown = cell.mapId === 395 || caveOrMountainLocation(name);
        const waterMap = !brown && waterMapIds.has(cell.mapId);
        const route = !brown && !waterMap && /^Route\s/iu.test(name.trim()) && !waterLocation(name);
        const color = vacant ? "#000" : brown ? brownColor : waterMap ? waterColor : matrixCellColor(cell.headerId, name, cityColor, treeFiller);
        const label = `X ${cell.x}, Y ${cell.y}. Header ${displayId(cell.headerId)}: ${name}. Map ${displayId(cell.mapId)}.${missing ? " Missing reference." : ""}`;
        return `<button type="button" class="matrix-cell ${vacant ? "-vacant" : cell.mapId === GEN5_MATRIX_EMPTY ? "-empty" : ""} ${route ? "-route" : ""} ${missing ? "-missing" : ""}" data-matrix-cell="${cell.index}" style="background-color:${color}" title="${escapeHtml(label + (data.hasHeaders && data.editable ? " Double-click or press F2 to edit the header ID." : ""))}" aria-label="${escapeHtml(label)}" aria-pressed="false">${cell.headerId === undefined || cell.headerId === GEN5_MATRIX_EMPTY ? "" : cell.headerId}</button>`;
      }).join("")).join("");
    renderSelection(); renderStructure(); renderReferences(); updateZoom();
    if (fitted) fit();
    thumbnails.show(data, { allowMatrixZero: matrixZeroThumbnails });
  }
  function renderSelection(): void {
    if (!snapshot) return;
    const data = snapshot, selected = new Set(selection), cells = selection.map(index => data.cells[index]);
    node(".matrix-grid").querySelectorAll<HTMLButtonElement>("[data-matrix-cell]").forEach(button => {
      const active = selected.has(Number(button.dataset.matrixCell));
      button.classList.toggle("-selected", active); button.setAttribute("aria-pressed", String(active));
    });
    const common = (field: "mapId" | "headerId") => cells.every(cell => cell[field] === cells[0][field]) ? displayId(cells[0][field]) : "";
    const cell = cells[0], hasHeader = cell.headerId !== undefined && cell.headerId !== GEN5_MATRIX_EMPTY;
    const location = hasHeader ? project.headers?.rows[cell.headerId! + 1]?.location_name ?? "Missing header" : cell.headerId === undefined ? "No header table" : "Unassigned";
    const heading = cells.length === 1 ? `${location}${hasHeader ? ` - ${cell.headerId}` : ""} - (${cell.x},${cell.y})` : `${cells.length} cells selected`;
    node("#matrix-selection").innerHTML = `<h2>${escapeHtml(heading)}</h2>
      <form id="matrix-apply-form"><fieldset ${data.editable ? "" : "disabled"}><legend>Assignments</legend>
      <label class="matrix-field-label" for="matrix-map-id">Map ID</label><input id="matrix-map-id" aria-label="Map ID" type="text" value="${common("mapId")}" placeholder="Mixed — unchanged" autocomplete="off">
      <label class="matrix-field-label" for="matrix-header-id">Header ID</label><input id="matrix-header-id" aria-label="Header ID" type="text" list="matrix-header-options" value="${data.hasHeaders ? common("headerId") : ""}" placeholder="${data.hasHeaders ? "Mixed — unchanged" : "Add a header table first"}" ${data.hasHeaders ? "" : "disabled"} autocomplete="off">
      <div class="matrix-buttons"><button class="btn -default" type="submit">Apply</button><button class="btn -default" type="button" data-matrix-action="clear">Clear cells</button></div></fieldset></form>
      <div class="matrix-shortcuts">${mapShortcuts(cells)}</div>
      <div class="matrix-assigned">${assignedHeaders(cells)}</div>`;
    seasons.select(data, selection, preferredHeader);
  }
  function mapShortcuts(cells: MatrixCell[]): string {
    const maps = [...new Map(cells.filter(cell => cell.mapId !== GEN5_MATRIX_EMPTY && project.narcs.maps?.rawFiles[cell.mapId]?.length).map(cell => [cell.mapId, cell])).values()];
    return maps.map(cell => {
      if (cell.headerId === GEN5_MATRIX_EMPTY) {
        return `<a class="btn -primary" href="#maps3d/matrix/${id}/${cell.x}/${cell.y}" data-matrix-open-map="${cell.mapId}" data-matrix-id="${id}" data-matrix-x="${cell.x}" data-matrix-y="${cell.y}">Open map ${cell.mapId}</a>`;
      }
      const header = cell.headerId === undefined ? snapshot?.referencingHeaders[0] : project.headers?.rows[cell.headerId + 1];
      if (!header || Number(header.matrix_id) !== id) return "";
      return `<a class="btn -primary" href="#maps3d/${header.index}/${cell.mapId}" data-matrix-open-map="${cell.mapId}" data-matrix-zone="${header.index}">Open map ${cell.mapId}</a>`;
    }).join("");
  }
  function assignedHeaders(cells: MatrixCell[]): string {
    const ids = [...new Set(cells.map(cell => cell.headerId).filter((value): value is number => value !== undefined && value !== GEN5_MATRIX_EMPTY))];
    return ids.map(headerId => {
      const header = project.headers?.rows[headerId + 1];
      if (!header) return `<p class="matrix-warning">Missing header ${headerId}</p>`;
      const overworldId = Number(header.overworlds_id ?? header.map_id);
      const overworldLink = Number.isInteger(overworldId) && overworldId >= 0 && overworldId < 65535
        ? `<a href="#overworlds/${overworldId}/${headerId}" data-matrix-open-overworld="${overworldId}" data-matrix-header="${headerId}">Open overworld ${overworldId}</a>` : "";
      return `<p><strong>H ${headerId}</strong> · ${escapeHtml(header.location_name)}</p>${overworldLink}${Number(header.matrix_id) !== id ? `<p class="matrix-warning">This header points to matrix ${Number(header.matrix_id)}.</p><button type="button" class="btn -default" data-matrix-link="${headerId}" ${snapshot?.editable ? "" : "disabled"}>Point header ${headerId} to matrix ${id}</button><p class="matrix-help">Changes the shared header’s Matrix ID for all its uses.</p>` : ""}`;
    }).join("");
  }
  function renderStructure(): void {
    if (!snapshot) return;
    const data = snapshot;
    node("#matrix-structure").innerHTML = `<form id="matrix-resize-form"><fieldset ${data.editable ? "" : "disabled"}><legend>Resize matrix</legend><div class="matrix-dimensions"><label>Width <input id="matrix-width" type="number" min="1" max="900" step="1" value="${data.width}" required></label><label>Height <input id="matrix-height" type="number" min="1" max="900" step="1" value="${data.height}" required></label></div>
      <p id="matrix-crop-preview" class="matrix-help">Existing cells stay at the same coordinates.</p><button class="btn -default" type="submit">Resize</button></fieldset></form>
      ${!data.hasHeaders ? `<form id="matrix-table-form"><fieldset ${data.editable ? "" : "disabled"}><legend>Add header table</legend><p class="matrix-help">Choose a header for every populated cell. Empty cells stay unassigned.</p><label for="matrix-initial-header">Initial header</label><select id="matrix-initial-header" required><option value="">Choose a header…</option>${headers().map(header => `<option value="${header.index}">${header.index} · ${escapeHtml(header.location_name)}</option>`).join("")}</select><button class="btn -default" type="submit">Add header table</button></fieldset></form>` : ""}`;
  }
  function renderReferences(): void {
    if (!snapshot) return;
    node("#matrix-references").innerHTML = `<h2>Header Reference</h2><ul>${snapshot.referencingHeaders.map(header => `<li><strong>${header.index}</strong> · ${escapeHtml(header.location_name)}</li>`).join("") || "<li>No headers point to this matrix.</li>"}</ul>`;
  }
  function updateZoom(): void {
    node(".matrix-grid").style.setProperty("--matrix-cell", `${cellSize}px`);
    node(".matrix-grid").style.setProperty("--matrix-font", `${Math.max(6, Math.min(14, (cellSize - 2) / 1.9))}px`);
  }
  function fit(): void {
    if (!snapshot) return;
    const stage = node(".matrix-viewport");
    stage.style.height = `${Math.max(300, window.innerHeight - Math.max(16, stage.getBoundingClientRect().top) - 16)}px`;
    const widthFit = (stage.clientWidth - 45 - snapshot.width) / snapshot.width;
    const heightFit = (stage.clientHeight - 41 - snapshot.height) / snapshot.height;
    cellSize = Math.max(6, Math.floor((fitted === "all" ? Math.min(widthFit, heightFit) : widthFit) * 100) / 100);
    stage.scrollTop = 0; stage.scrollLeft = 0; updateZoom();
  }
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    if (event.target === inlineEdit?.input) return;
    const link = event.target.closest<HTMLAnchorElement>("a[data-matrix-open-map], a[data-matrix-open-overworld]");
    if (link) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.dataset.matrixOpenMap !== undefined && navigation.openMap) {
        event.preventDefault();
        if (link.dataset.matrixId !== undefined) navigation.openMap(undefined, Number(link.dataset.matrixOpenMap), {
          matrixId: Number(link.dataset.matrixId), x: Number(link.dataset.matrixX), y: Number(link.dataset.matrixY),
        });
        else navigation.openMap(Number(link.dataset.matrixZone), Number(link.dataset.matrixOpenMap));
      } else if (link.dataset.matrixOpenOverworld !== undefined && navigation.openOverworld) {
        event.preventDefault();
        void Promise.resolve(navigation.openOverworld(Number(link.dataset.matrixOpenOverworld), Number(link.dataset.matrixHeader))).catch(error => {
          if (root.querySelector("#matrix-status")) status(error instanceof Error ? error.message : String(error), true);
        });
      }
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button"); if (!button || button.disabled) return;
    if (button.dataset.matrixCell !== undefined && snapshot) {
      const end = Number(button.dataset.matrixCell);
      if (snapshot.hasHeaders) preferredHeader = undefined;
      selection = event.shiftKey ? matrixSelection(snapshot.width, anchor, end) : [end];
      if (!event.shiftKey) anchor = end;
      renderSelection(); return;
    }
    if (button.dataset.matrixLink !== undefined) {
      attempt(() => { const headerId = Number(button.dataset.matrixLink); changed(linkHeaderToMatrix(project, id, headerId)); render(); return `Header ${headerId} now points to matrix ${id}.`; }); return;
    }
    const action = button.dataset.matrixAction;
    if (action === "seasons") { seasonsOpen = !seasonsOpen; node("#matrix-seasons-toggle").setAttribute("aria-pressed", String(seasonsOpen)); seasons.setOpen(seasonsOpen); }
    if (action === "new" || action === "cancel-new") { node<HTMLFormElement>("#matrix-new-form").hidden = action !== "new"; if (action === "new") node("#matrix-new-width").focus(); }
    if (action === "zoom-in" || action === "zoom-out") { fitted = false; cellSize = Math.max(6, Math.min(1024, cellSize * (action === "zoom-in" ? 1.25 : 0.8))); updateZoom(); }
    if (action === "fit") { fitted = "all"; fit(); }
    if (action === "duplicate") attempt(() => { const source = id; id = duplicateMatrix(project, id); anchor = 0; selection = [0]; changed(true); render(); return `Duplicated matrix ${source} as matrix ${id}. Link a header to use it in game.`; });
    if (action === "clear" && snapshot) attempt(() => { changed(applyMatrixCellEdit(project, id, selection, { mapId: GEN5_MATRIX_EMPTY, ...(snapshot!.hasHeaders ? { headerId: GEN5_MATRIX_EMPTY } : {}) })); render(); return "Selected cells cleared."; });
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target === inlineEdit?.input) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-matrix-cell]");
    if (!button || button.dataset.matrixCell === undefined) return;
    event.preventDefault(); beginInlineEdit(button);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "F2" || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-matrix-cell]");
    if (!button || button.dataset.matrixCell === undefined) return;
    event.preventDefault(); beginInlineEdit(button);
  };
  const onSubmit = (event: SubmitEvent) => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.id.startsWith("matrix-")) return;
    event.preventDefault();
    attempt(() => {
      switch ((event.target as HTMLFormElement).id) {
        case "matrix-apply-form": {
          const map = node<HTMLInputElement>("#matrix-map-id").value.trim(), header = snapshot!.hasHeaders ? node<HTMLInputElement>("#matrix-header-id").value.trim() : "";
          if (!map && !header) throw new Error("Enter a map or header ID to apply.");
          const edit = { ...(map ? { mapId: parseMatrixInput(node<HTMLInputElement>("#matrix-map-id").value) } : {}), ...(header ? { headerId: parseMatrixInput(node<HTMLInputElement>("#matrix-header-id").value) } : {}) };
          // Preserve existing invalid references when their field was not changed.
          for (const field of ["mapId", "headerId"] as const) if (edit[field] !== undefined && selection.every(index => snapshot!.cells[index][field] === edit[field])) delete edit[field];
          const didChange = applyMatrixCellEdit(project, id, selection, edit); changed(didChange); render(); return didChange ? "Assignments applied." : "Assignments are unchanged.";
        }
        case "matrix-resize-form": {
          const width = Number(node<HTMLInputElement>("#matrix-width").value), height = Number(node<HTMLInputElement>("#matrix-height").value);
          const cropped = countCroppedMatrixCells(project, id, width, height);
          if (cropped && !window.confirm(`Resize matrix ${id} to ${width} × ${height}? This removes ${cropped} populated cell(s). Event and warp coordinates will not move.`)) return "Resize cancelled.";
          const didChange = resizeMatrix(project, id, width, height, true); changed(didChange); anchor = 0; selection = [0]; render(); return didChange ? "Matrix resized." : "Dimensions are unchanged.";
        }
        case "matrix-table-form": {
          const initial = node<HTMLSelectElement>("#matrix-initial-header").value;
          if (!initial) throw new Error("Choose an initial header.");
          changed(addMatrixHeaderTable(project, id, parseMatrixInput(initial))); render(); return "Header table added. Cell assignments can now be edited.";
        }
        case "matrix-new-form": {
          id = createMatrix(project, Number(node<HTMLInputElement>("#matrix-new-width").value), Number(node<HTMLInputElement>("#matrix-new-height").value), node<HTMLInputElement>("#matrix-new-headers").checked);
          node<HTMLFormElement>("#matrix-new-form").hidden = true; anchor = 0; selection = [0]; changed(true); render(); return `Created matrix ${id}. Assign maps and link a header to use it in game.`;
        }
        default: return "";
      }
    });
  };
  const onChange = () => { id = Number(node<HTMLSelectElement>("#matrix-index").value); anchor = 0; selection = [0]; preferredHeader = undefined; fitted = id === 0 ? "width" : "all"; status(""); render(); };
  const onInput = (event: Event) => {
    if (!(event.target instanceof HTMLInputElement) || !["matrix-width", "matrix-height"].includes(event.target.id)) return;
    try {
      const count = countCroppedMatrixCells(project, id, Number(node<HTMLInputElement>("#matrix-width").value), Number(node<HTMLInputElement>("#matrix-height").value));
      node("#matrix-crop-preview").textContent = count ? `${count} populated cell(s) will be removed. You will be asked to confirm.` : "No populated cells will be removed.";
    } catch (error) { node("#matrix-crop-preview").textContent = error instanceof Error ? error.message : String(error); }
  };
  root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("input", onInput);
  root.addEventListener("dblclick", onDoubleClick); root.addEventListener("keydown", onKeyDown);
  const onThumbnailChange = () => {
    matrixZeroThumbnails = node<HTMLInputElement>("#matrix-zero-thumbnails").checked;
    thumbnails.show(snapshot, { allowMatrixZero: matrixZeroThumbnails });
    if (!matrixZeroThumbnails) node(".matrix-grid").querySelectorAll<HTMLElement>("[data-matrix-cell]").forEach(cell => { cell.style.backgroundImage = ""; cell.classList.toggle("-thumbnail", false); delete cell.dataset.matrixThumbnail; });
  };
  node("#matrix-zero-thumbnails").addEventListener("change", onThumbnailChange);
  node("#matrix-index").addEventListener("change", onChange);
  const observer = new ResizeObserver(() => { if (fitted && !inlineEdit) fit(); }); observer.observe(node(".matrix-viewport"));
  const onResize = () => { if (fitted && !inlineEdit) fit(); };
  window.addEventListener("resize", onResize);
  dispose = () => { cancelInlineEdit(); thumbnails.destroy(); seasons.destroy(); observer.disconnect(); window.removeEventListener("resize", onResize); root.removeEventListener("click", onClick); root.removeEventListener("submit", onSubmit); root.removeEventListener("input", onInput); root.removeEventListener("dblclick", onDoubleClick); root.removeEventListener("keydown", onKeyDown); node("#matrix-index").removeEventListener("change", onChange); node("#matrix-zero-thumbnails").removeEventListener("change", onThumbnailChange); };
  render();
}
