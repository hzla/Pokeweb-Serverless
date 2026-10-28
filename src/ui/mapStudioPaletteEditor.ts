import { resizeStudioLayout } from "../pokeweb/mapStudioPalette";
import type { StudioPalette, StudioTileLayout, StudioWorkspace } from "../pokeweb/mapStudioFormats";
import { escapeHtml } from "./dom";

/** Loaded only when arranging a layout. Choosing tiles here never paints the map. */
export function editStudioPalette(options: { workspace: StudioWorkspace; layout: StudioTileLayout; palette?: StudioPalette; signal?: AbortSignal; thumbnail: (tile: number, canvas: HTMLCanvasElement) => Promise<void> }): Promise<StudioTileLayout | null | undefined> {
  return new Promise(resolve => {
    const { workspace, palette } = options, dialog = document.createElement("dialog"), abort = new AbortController(), listen = { signal: abort.signal };
    let draft = structuredClone(options.layout), active = 0, stopped = false, frame = 0, limit = 128;
    const past: StudioTileLayout[] = [], future: StudioTileLayout[] = [], queue: { tile: number; canvas: HTMLCanvasElement }[] = [];
    let observer: IntersectionObserver | undefined;
    dialog.className = "ms-layout-dialog";
    dialog.innerHTML = `<div class="ms-arrange-header"><h2>Arrange tiles</h2><button data-edit="cancel" aria-label="Close tile arrangement">×</button></div>
      <div class="ms-arrange-fields"><label>Name<input data-edit="name" value="${escapeHtml(draft.name)}" /></label><label>Category<input data-edit="folder" value="${escapeHtml(draft.folder)}" /></label><label>Columns<input data-edit="columns" type="number" min="1" max="16" value="${draft.columns}" /></label><label>Rows<input data-edit="rows" type="number" min="1" max="16" value="${draft.rows}" /></label></div>
      <div class="ms-arrange-body"><section class="ms-arrange-preview"><div class="ms-arrange-board"></div><div class="ms-arrange-extras"></div><div class="ms-arrange-actions"><button data-edit="clear">Clear cell</button><button data-edit="undo" disabled>Undo</button><button data-edit="redo" disabled>Redo</button><label><input data-edit="inner-corners" type="checkbox" ${draft.extras ? "checked" : ""}/> Inner corners</label></div><span class="ms-arrange-hint">Select a cell, then a tile. Drag cells to swap.</span></section>
      <section class="ms-arrange-browser"><div class="ms-arrange-filters"><select data-edit="category" aria-label="Arrangement tile category"><option value="">All categories</option></select><input data-edit="search" type="search" placeholder="Search tiles" aria-label="Find a tile for the arrangement" /></div><div class="ms-arrange-candidates"></div><button data-edit="more" hidden>Show more tiles</button></section></div>
      <div class="ms-arrange-footer">${workspace.layouts?.some(g => g.id === draft.id) ? '<button data-edit="delete">Delete layout</button>' : ""}<span role="status" class="ms-arrange-status"></span><button data-edit="cancel">Cancel</button><button data-edit="save">Save layout</button></div>`;
    document.body.append(dialog); dialog.showModal();
    const el = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-edit="${name}"]`)!;
    const gallery = dialog.querySelector<HTMLElement>(".ms-arrange-candidates")!;
    const matchesPalette = (id: number) => !palette || id >= palette.start && id < palette.start + palette.count;
    const generated = new Set(Object.values(workspace.smart?.variants || {}));
    const candidates = workspace.tileset.tiles.map((tile, id) => ({ tile, id })).filter(({ id }) => !generated.has(id) && matchesPalette(id));
    const folders = [...new Set(candidates.map(({ tile }) => tile.folder).filter((f): f is string => !!f))].sort();
    el<HTMLSelectElement>("category").innerHTML += folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(palette && f.startsWith(palette.name + "/") ? f.slice(palette.name.length + 1) : f)}</option>`).join("");
    const counts = new Map<string, number>(); for (const id of draft.cells) if (id >= 0) { const folder = workspace.tileset.tiles[id].folder || ""; counts.set(folder, (counts.get(folder) || 0) + 1); }
    const initialFolder = [...counts].sort((a,b) => b[1] - a[1])[0]?.[0] || draft.folder;
    if (folders.includes(initialFolder)) el<HTMLSelectElement>("category").value = initialFolder;
    const finish = (result?: StudioTileLayout | null) => { if (stopped) return; stopped = true; abort.abort(); cancelAnimationFrame(frame); observer?.disconnect(); dialog.close(); dialog.remove(); resolve(result); };
    options.signal?.addEventListener("abort", () => finish(), { once: true, signal: abort.signal });
    async function draw() {
      frame = 0; if (stopped) return; let job = queue.shift(); while (job && !job.canvas.isConnected) job = queue.shift();
      if (job?.canvas.isConnected) await options.thumbnail(job.tile, job.canvas);
      if (!stopped && queue.length) frame = requestAnimationFrame(draw);
    }
    function enqueue(tile: number, canvas: HTMLCanvasElement) { queue.push({ tile, canvas }); if (!frame) frame = requestAnimationFrame(draw); }
    function snapshot() { past.push(structuredClone(draft)); if (past.length > 50) past.shift(); future.length = 0; }
    function cell(id: number, slot: number) {
      return `<button data-slot="${slot}" ${id >= 0 ? "draggable=\"true\"" : ""} class="ms-arrange-cell" aria-pressed="${active === slot}" aria-label="${slot >= 1000 ? "Inner corner" : `Row ${Math.floor(slot / draft.columns) + 1}, column ${slot % draft.columns + 1}`} · ${id >= 0 ? escapeHtml(workspace.tileset.tiles[id].name) : "Empty"}" title="${id >= 0 ? `${id}: ${escapeHtml(workspace.tileset.tiles[id].name)}` : "Empty cell"}">${id >= 0 ? `<canvas width="96" height="96" data-preview-tile="${id}"></canvas>` : '<span aria-hidden="true">+</span>'}</button>`;
    }
    function renderBoard() {
      const board = dialog.querySelector<HTMLElement>(".ms-arrange-board")!; board.style.setProperty("--columns", String(draft.columns));
      board.innerHTML = draft.cells.map((id, index) => cell(id, index)).join("");
      const extras = dialog.querySelector<HTMLElement>(".ms-arrange-extras")!;
      extras.innerHTML = draft.extras?.length ? `<span>Inner corners</span><div>${draft.extras.map((id, index) => cell(id, index + 1000)).join("")}</div>` : "";
      for (const canvas of dialog.querySelectorAll<HTMLCanvasElement>("[data-preview-tile]")) enqueue(Number(canvas.dataset.previewTile), canvas);
      el<HTMLButtonElement>("undo").disabled = !past.length; el<HTMLButtonElement>("redo").disabled = !future.length;
      el<HTMLInputElement>("columns").value = String(draft.columns); el<HTMLInputElement>("rows").value = String(draft.rows);
      el<HTMLInputElement>("inner-corners").checked = !!draft.extras;
    }
    function renderCandidates() {
      observer?.disconnect(); const search = el<HTMLInputElement>("search").value.toLowerCase(), folder = el<HTMLSelectElement>("category").value;
      const matches = candidates.filter(({ tile, id }) => (!folder || folder === tile.folder) && `${id} ${tile.name} ${tile.folder}`.toLowerCase().includes(search));
      gallery.innerHTML = matches.slice(0, limit).map(({ tile, id }) => `<button data-candidate="${id}" draggable="true" title="${id}: ${escapeHtml(tile.name)}"><canvas width="72" height="72"></canvas><span>${id}: ${escapeHtml(tile.name)}</span></button>`).join("");
      el("more").hidden = matches.length <= limit;
      observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { const b = entry.target as HTMLButtonElement; enqueue(Number(b.dataset.candidate), b.querySelector("canvas")!); observer!.unobserve(b); } }, { root: gallery, rootMargin: "72px" });
      gallery.querySelectorAll("button").forEach(b => observer!.observe(b));
    }
    function setCell(id: number, slot = active, advance = true) {
      snapshot(); if (slot >= 1000) draft.extras![slot - 1000] = id; else draft.cells[slot] = id;
      active = advance ? slot >= 1000 ? 1000 + (slot - 999) % draft.extras!.length : (slot + 1) % draft.cells.length : slot; renderBoard();
    }
    dialog.addEventListener("click", event => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b) return;
      if (b.dataset.slot !== undefined) { active = Number(b.dataset.slot); dialog.querySelectorAll<HTMLElement>("[data-slot]").forEach(cell => cell.setAttribute("aria-pressed", String(Number(cell.dataset.slot) === active))); return; }
      if (b.dataset.candidate !== undefined) { setCell(Number(b.dataset.candidate)); return; }
      const action = b.dataset.edit;
      if (action === "cancel") finish();
      if (action === "delete") finish(null);
      if (action === "clear") setCell(-1, active, false);
      if (action === "more") { limit += 128; renderCandidates(); }
      if (action === "undo" && past.length) { future.push(draft); draft = past.pop()!; active = 0; renderBoard(); }
      if (action === "redo" && future.length) { past.push(draft); draft = future.pop()!; active = 0; renderBoard(); }
      if (action === "save") {
        const name = el<HTMLInputElement>("name").value.trim();
        if (!name || !draft.cells.some(id => id >= 0)) { dialog.querySelector(".ms-arrange-status")!.textContent = "Name the layout and add at least one tile."; return; }
        finish({ ...draft, name, folder: el<HTMLInputElement>("folder").value.trim(), source: "custom" });
      }
    }, listen);
    dialog.addEventListener("change", event => {
      const input = event.target as HTMLInputElement;
      if (["columns", "rows"].includes(input.dataset.edit || "")) { const c = Number(el<HTMLInputElement>("columns").value), r = Number(el<HTMLInputElement>("rows").value); if (Number.isInteger(c) && c > 0 && c <= 16 && Number.isInteger(r) && r > 0 && r <= 16) { snapshot(); draft = resizeStudioLayout(draft, c, r); active = 0; } renderBoard(); }
      if (input.dataset.edit === "category") { limit = 128; renderCandidates(); }
      if (input.dataset.edit === "inner-corners") { snapshot(); draft.extras = input.checked ? Array(4).fill(-1) : undefined; active = 0; renderBoard(); }
    }, listen);
    el("search").addEventListener("input", () => { limit = 128; renderCandidates(); }, listen);
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(); }, listen);
    dialog.addEventListener("keydown", event => {
      event.stopPropagation(); if (event.target instanceof HTMLElement && event.target.closest("input,select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); el<HTMLButtonElement>(event.shiftKey ? "redo" : "undo").click(); }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); el<HTMLButtonElement>("clear").click(); }
    }, listen);
    dialog.addEventListener("dragstart", event => {
      const b = (event.target as HTMLElement).closest<HTMLElement>("[data-candidate],[data-slot]"); if (!b || !event.dataTransfer) return;
      const slot = b.dataset.slot === undefined ? undefined : Number(b.dataset.slot), tile = slot === undefined ? Number(b.dataset.candidate) : slot >= 1000 ? draft.extras![slot - 1000] : draft.cells[slot];
      event.dataTransfer.setData("application/x-pokeweb-layout-tile", JSON.stringify({ tile, slot })); event.dataTransfer.effectAllowed = "copyMove";
    }, listen);
    dialog.addEventListener("dragover", event => { if ((event.target as HTMLElement).closest("[data-slot]")) event.preventDefault(); }, listen);
    dialog.addEventListener("drop", event => {
      const b = (event.target as HTMLElement).closest<HTMLElement>("[data-slot]"); if (!b) return; event.preventDefault();
      try {
        const data = JSON.parse(event.dataTransfer?.getData("application/x-pokeweb-layout-tile") || "null");
        if (!data || !Number.isInteger(data.tile) || data.tile < 0 || !workspace.tileset.tiles[data.tile] || !matchesPalette(data.tile)) return;
        const slot = Number(b.dataset.slot), previous = slot >= 1000 ? draft.extras![slot - 1000] : draft.cells[slot];
        snapshot(); if (slot >= 1000) draft.extras![slot - 1000] = data.tile; else draft.cells[slot] = data.tile;
        if (Number.isInteger(data.slot) && data.slot !== slot) { if (data.slot >= 1000 && draft.extras && data.slot < 1000 + draft.extras.length) draft.extras[data.slot - 1000] = previous; else if (data.slot >= 0 && data.slot < draft.cells.length) draft.cells[data.slot] = previous; }
        active = slot; renderBoard();
      } catch { /* Ignore unrelated drag data. */ }
    }, listen);
    renderBoard(); renderCandidates();
  });
}
