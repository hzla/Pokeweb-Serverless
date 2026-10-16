import { GEN5_MATRIX_EMPTY, resolveMatrixCellGraphicsHeader, type MatrixSnapshot } from "../pokeweb/matrixModel";
import { clearSeasonalAssignment, getSeasonalAssignment, MATRIX_SEASONS, resolveSeasonalMatrix, seasonalAssignmentDraft, setSeasonalAssignment, type SeasonalScope } from "../pokeweb/seasonalMatrixModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { installMatrixThumbnails, type MatrixThumbnailPreview } from "./matrixThumbnails";

export function installMatrixSeasons(project: ProjectState, root: HTMLElement, grid: HTMLElement, refresh: (changed: boolean) => void) {
  const thumbnails = installMatrixThumbnails(project, root, root);
  let snapshot: MatrixSnapshot | undefined, selection: number[] = [], scope: SeasonalScope = "map", mapId: number | undefined;
  let opened = false, stopped = false, timer: ReturnType<typeof setTimeout> | undefined, preferredHeaderId: number | undefined;
  const node = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  function cancel() { clearTimeout(timer); thumbnails.show(); }
  function highlight(indices: number[] = []) {
    const affected = new Set(indices);
    grid.querySelectorAll<HTMLElement>("[data-matrix-cell]").forEach(cell => cell.classList.toggle("-season-affected", affected.has(Number(cell.dataset.matrixCell))));
  }
  function message(error: unknown) { const status = node("#matrix-season-status"); if (status) status.textContent = error instanceof Error ? error.message : String(error); }
  function values() { return MATRIX_SEASONS.map(season => {
    const text = node<HTMLInputElement>(`#matrix-season-${season}`).value.trim();
    if (!/^\d+$/u.test(text)) throw new Error("Enter an existing numeric ID for each season."); return Number(text);
  }); }
  function graphicsHeader(): number {
    if (!snapshot) throw new Error("Select a matrix.");
    if (preferredHeaderId !== undefined && Number(project.headers?.rows[preferredHeaderId + 1]?.matrix_id) === snapshot.id) return preferredHeaderId;
    const candidates = [...selection.map(i => snapshot!.cells[i]), ...snapshot.cells];
    const cell = candidates.find(c => scope === "map" ? c.mapId === mapId : c.mapId !== GEN5_MATRIX_EMPTY);
    if (!cell) {
      const header = snapshot.referencingHeaders[0]; if (header) return header.index;
      throw new Error("Link a header to this matrix to provide preview graphics.");
    }
    return resolveMatrixCellGraphicsHeader({ width: snapshot.width, height: snapshot.height, hasZones: snapshot.hasHeaders,
      chunkIds: snapshot.cells.map(c => c.mapId), zoneIds: snapshot.cells.map(c => c.headerId ?? GEN5_MATRIX_EMPTY) },
      { matrixId: snapshot.id, x: cell.x, y: cell.y }, Object.values(project.headers?.rows ?? {})).index;
  }
  function preview() {
    cancel(); if (!snapshot || !opened || stopped || !node("#matrix-season-form")) return;
    try {
      const draft = seasonalAssignmentDraft(project, snapshot.id, scope, mapId, values()), headerId = graphicsHeader();
      const requests: MatrixThumbnailPreview[] = [];
      MATRIX_SEASONS.forEach(season => {
        const target = node(`#matrix-season-preview-${season}`);
        try {
          let resolved = resolveSeasonalMatrix(project, snapshot!.id, season, undefined, draft);
          let label = `Matrix ${resolved.id} · ${resolved.width} × ${resolved.height}`;
          if (scope === "map") {
            const baseCell = [...selection.map(i => snapshot!.cells[i]), ...snapshot!.cells].find(c => c.mapId === mapId)!;
            const cell = resolved.cells.find(c => c.x === baseCell.x && c.y === baseCell.y);
            if (!cell) throw new Error("This coordinate is outside the seasonal matrix.");
            label = cell.mapId === GEN5_MATRIX_EMPTY ? "Empty" : `Map ${cell.mapId}`;
            resolved = { ...resolved, width: 1, height: 1, cells: [{ ...cell, index: 0, x: 0, y: 0 }] };
          }
          if (resolved.cells.length > 900) throw new Error("Preview exceeds the 900-cell limit.");
          target.innerHTML = `<div class="matrix-season-mini" style="grid-template-columns:repeat(${resolved.width},1fr);aspect-ratio:${resolved.width}/${resolved.height}">${resolved.cells.map(cell => `<div class="matrix-season-pixel" data-matrix-cell="${cell.index}" title="Map ${cell.mapId === GEN5_MATRIX_EMPTY ? "Empty" : cell.mapId} (${cell.x},${cell.y})"></div>`).join("")}</div><small>${label}</small>`;
          requests.push({ snapshot: resolved, root: target, season, ...(scope === "map" ? { headerId } : { preview: true, resourceMatrixId: snapshot!.id, fallbackHeaderId: headerId }) });
        } catch (error) { target.innerHTML = `<small>${escapeHtml(error instanceof Error ? error.message : String(error))}</small>`; }
      });
      thumbnails.showPreviews(requests); message("");
    } catch (error) {
      for (const season of MATRIX_SEASONS) { const target = node(`#matrix-season-preview-${season}`); if (target) target.textContent = "Preview unavailable"; }
      message(error);
    }
  }
  function render() {
    cancel(); root.hidden = !opened; highlight();
    if (!opened || !snapshot || stopped) return;
    const maps = [...new Set(selection.map(i => snapshot!.cells[i]?.mapId).filter((id): id is number => id !== undefined && id !== GEN5_MATRIX_EMPTY))];
    if (mapId === undefined || !maps.includes(mapId)) mapId = maps[0];
    root.innerHTML = `<fieldset><legend>Seasonal assignments</legend><label for="matrix-season-scope">Scope</label><select id="matrix-season-scope"><option value="map" ${scope === "map" ? "selected" : ""}>Selected map</option><option value="matrix" ${scope === "matrix" ? "selected" : ""}>Whole matrix</option></select><div id="matrix-season-content"></div><p id="matrix-season-status" class="matrix-warning" role="status"></p></fieldset>`;
    node<HTMLSelectElement>("#matrix-season-scope").addEventListener("change", event => { scope = (event.target as HTMLSelectElement).value as SeasonalScope; render(); });
    if (scope === "map" && !maps.length) { node("#matrix-season-content").textContent = "Select a populated map cell."; return; }
    try {
      const state = getSeasonalAssignment(project, snapshot.id, scope, mapId);
      highlight(state.affected);
      node("#matrix-season-content").innerHTML = `${scope === "map" && maps.length > 1 ? `<label for="matrix-season-source">Base map</label><select id="matrix-season-source">${maps.map(id => `<option value="${id}" ${id === mapId ? "selected" : ""}>Map ${id}</option>`).join("")}</select>` : ""}
        <p class="matrix-season-count">${scope === "map" ? `Map ${mapId} · ` : ""}${state.affected.length} affected cell${state.affected.length === 1 ? "" : "s"}</p>
        <form id="matrix-season-form"><div class="matrix-season-cards">${MATRIX_SEASONS.map((season, i) => `<label class="matrix-season-card" for="matrix-season-${season}"><span>${season[0].toUpperCase() + season.slice(1)}${i === 0 ? " · base" : ""}</span><input type="text" inputmode="numeric" id="matrix-season-${season}" aria-label="${season} ${scope} ID" value="${state.values[i]}" ${i === 0 ? "readonly" : ""} autocomplete="off"><span id="matrix-season-preview-${season}" class="matrix-season-preview"></span></label>`).join("")}</div>
        <div class="matrix-buttons"><button class="btn -default" type="submit" ${snapshot.editable ? "" : "disabled"}>Apply seasons</button><button class="btn -default" type="button" id="matrix-season-remove" ${snapshot.editable && state.matches.length ? "" : "disabled"}>Remove rule</button></div></form>`;
      node("#matrix-season-source")?.addEventListener("change", event => { mapId = Number((event.target as HTMLSelectElement).value); render(); });
      node("#matrix-season-form").addEventListener("submit", event => {
        event.preventDefault(); event.stopPropagation();
        try { refresh(setSeasonalAssignment(project, snapshot!.id, scope, mapId, values())); } catch (error) { message(error); }
      });
      node("#matrix-season-remove").addEventListener("click", () => {
        try { refresh(clearSeasonalAssignment(project, snapshot!.id, scope, mapId)); } catch (error) { message(error); }
      });
      root.querySelectorAll<HTMLInputElement>(".matrix-season-card input").forEach(input => input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(preview, 250); }));
      preview();
    } catch (error) { message(error); }
  }
  return {
    select(data: MatrixSnapshot, indices: number[], headerId?: number) { snapshot = data; selection = indices; preferredHeaderId = headerId; render(); },
    setOpen(value: boolean) { opened = value; render(); },
    destroy() { stopped = true; cancel(); highlight(); thumbnails.destroy(); },
  };
}
