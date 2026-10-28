import "../styles/mapStudio.css";
import { canOpenMapStudio } from "../pokeweb/mapStudioAccess";
import { newStudioChunk, findStudioAsset, readStudioLayouts, studioAssert, studioPerName, writeStudioMap, type StudioWorkspace, type StudioPalette, type StudioTileLayout } from "../pokeweb/mapStudioFormats";
import { StudioHistory, studioCellKey, type StudioTool } from "../pokeweb/mapStudioModel";
import { paintStudioSmart, prepareStudioSmartBrush, studioSmartBrushIssue } from "../pokeweb/mapStudioSmartBrush";
import { layoutTileIds, layoutWithinPalette, remapStudioLayouts } from "../pokeweb/mapStudioPalette";
import type { ProjectState } from "../pokeweb/projectStore";
import type { Gen5MapImport, Gen5MapImportInput } from "../pokeweb/gen5MapImport";
import type { MatrixSnapshot } from "../pokeweb/matrixModel";
import { escapeHtml } from "./dom";
import { StudioViewport } from "./mapStudioViewport";

const toolPaths: Record<string, string> = {
  new: "M14 3H5v18h14V8l-5-5v5h5M8 14h8m-4-4v8", open: "M3 7V5h7l2 3h9l-3 12H3V7h7l2 3h7",
  save: "M4 3h13l4 4v14H3V3h1m3 0v6h10V3M7 21v-8h10v8", undo: "m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12", redo: "m16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12",
  insert: "M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6", "3d": "m12 2 10 5v10l-10 5-10-5V7l10-5Zm0 10L2 7m10 5 10-5m-10 5v10",
  top: "M3 3h18v18H3V3Zm0 6h18M9 3v18m6-18v18M3 15h18", grid: "M3 3v18m6-18v18m6-18v18m6-18v18M3 3h18M3 9h18M3 15h18M3 21h18",
  wire: "m12 2 10 5v10l-10 5-10-5V7l10-5Zm0 0v10m0 0 10 5m-10-5L2 17m0-10 20 10M22 7 2 17m10-5v10",
  paint: "m15 3 6 6-11 11-7 1 1-7L15 3Zm-3 3 6 6M4 14l6 6", erase: "m15 3 7 7-10 10H6l-5-5L15 3Zm-9 6 9 9M6 20h16",
  fill: "m4 11 8-8 9 9-8 8-9-9Zm0 0h17M9 2l4 4m7 9s-3 3-3 5a3 3 0 0 0 6 0c0-2-3-5-3-5Z",
  pick: "m14 4 6 6m-5-7 6 6M6 17l10-10 3 3L9 20H4v-5l2 2Z", height: "M3 20h18M7 17V7m-3 3 3-3 3 3m7-3v10m-3-3 3 3 3-3M3 3h18",
  smart: "M4 4h5v5H4V4Zm11 0h5v5h-5V4ZM4 15h5v5H4v-5Zm11 0h5v5h-5v-5M9 6h6M6 9v6m3 3h6m3-9v6m-6-5v4m-2-2h4",
  pan: "M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4", fit: "M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M8 8h8v8H8V8Z"
};
function button(action: string, title: string, disabled = false) { return `<button class="ms-icon" data-ms="${action}" title="${title}" aria-label="${title}" ${disabled ? "disabled" : ""}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${toolPaths[action] || toolPaths.paint}" /></svg></button>`; }
function download(bytes: Uint8Array, filename: string, mime = "application/zip") {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime })), link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function renderMapStudio(root: HTMLElement, project: ProjectState | undefined, onRomDirty: () => void): () => void {
  if (!canOpenMapStudio()) { root.replaceChildren(); return () => {}; }
  let workspace: StudioWorkspace | undefined, history: StudioHistory | undefined, viewport: StudioViewport | undefined;
  let chunk = 0, layer = 0, tile = 0, height = 0, tool: StudioTool = "paint", dragging = false, previous: { x: number; y: number } | undefined;
  let disposed = false, busy = false, modified = false, frame = 0, saved = false, autosave = 0, database: IDBDatabase | undefined;
  let worker: Worker | undefined, compileWorker: Worker | undefined, sequence = 0, pending: Gen5MapImport | undefined, lastImport: Gen5MapImport | undefined, insertRevision = -1;
  let thumbnailObserver: IntersectionObserver | undefined, thumbnailFrame = 0, targetReady = false, paletteLimit = 128, paletteEpoch = 0;
  let buildingPreviewChunk = -1, buildingPreviewEpoch = 0;
  let paletteId = "", category = "";
  let paletteView: "layouts" | "tiles" = "layouts", tileProjection: "top" | "3d" = "top", layoutLimit = 24;
  let smartLayoutId = "", smartArmed = false, beforePan: StudioTool = "paint";
  const libraries = new Map<string, { id: string; name: string; count: number }>();
  let resolveDestination: ((matrix: number, season: string) => MatrixSnapshot) | undefined;
  const visible = Array(9).fill(true) as boolean[], requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const abort = new AbortController(), listen = { signal: abort.signal };
  root.innerHTML = `<section class="map-studio" aria-label="Map Studio">
    <div class="ms-menu"><details><summary>File</summary><div class="ms-menu-popover"><button data-ms="new">New from tileset</button><button data-ms="open">Open project…</button><button data-ms="folder">Open project folder…</button><button data-ms="import-tileset">Import tileset…</button><button data-ms="save" disabled>Save project bundle</button><button data-ms="save-map" disabled>Save PDSMAP only</button><button data-ms="insert" disabled>Insert selected chunk into ROM…</button></div></details>
    <details><summary>Edit</summary><div class="ms-menu-popover"><button data-ms="undo" disabled>Undo · Ctrl/⌘ Z</button><button data-ms="redo" disabled>Redo · Ctrl/⌘ Shift Z</button></div></details>
    <details><summary>View</summary><div class="ms-menu-popover"><button data-ms="3d">3D view</button><button data-ms="top">Top view</button><button data-ms="fit">Fit map</button></div></details><span class="ms-title">Map Studio · PDSMS projects</span></div>
    <div class="ms-toolbar" role="toolbar" aria-label="Project tools">${button("new", "New from tileset")}${button("open", "Open project")}${button("save", "Save project bundle (Ctrl/⌘ S)", true)}<span class="ms-separator"></span>${button("undo", "Undo", true)}${button("redo", "Redo", true)}<span class="ms-separator"></span>${button("insert", "Insert selected chunk into ROM", true)}<button data-ms="folder">Open folder…</button><span class="ms-game">Map for: <select data-role="game" aria-label="Project game"><option value="0">Diamond</option><option value="1">Pearl</option><option value="2">Platinum</option><option value="3">HeartGold</option><option value="4">SoulSilver</option><option value="5">Black</option><option value="6">White</option><option value="7">Black 2</option><option value="8" selected>White 2</option></select></span></div>
    <div class="ms-body">
      <fieldset class="ms-layers"><legend>Layers</legend>${Array.from({ length: 9 }, (_, l) => `<div class="ms-layer-row"><input type="checkbox" data-visible="${l}" checked aria-label="Show layer ${l + 1}" disabled /><button class="ms-layer" data-layer="${l}" aria-label="Edit layer ${l + 1}" aria-pressed="${l === 0}" disabled><span>${l + 1}<small data-layer-count="${l}">empty</small></span></button></div>`).join("")}</fieldset>
      <div class="ms-tool-column"><fieldset><legend>View</legend>${button("3d", "3D view")}${button("top", "Top view")}${button("grid", "Toggle grid")}${button("wire", "Toggle wireframe")}</fieldset>
      <fieldset><legend>Tools</legend>${button("paint", "Paint (B)")}${button("smart", "Smart brush (G)", true)}${button("erase", "Erase (E)")}${button("fill", "Bucket fill (F)")}${button("pick", "Pick tile and height (I)")}${button("height", "Paint height (H)")}${button("pan", "Pan (Space)")}${button("fit", "Fit camera to map")}</fieldset></div>
      <div class="ms-viewport"><div class="ms-empty"><h1>Map Studio</h1><p>Open a PDSMAP project with its tileset and textures, or start a new map from a tileset.</p><div class="ms-empty-actions"><button data-ms="folder">Open folder…</button><button data-ms="open">Open files or ZIP…</button></div><button data-ms="restore" class="ms-restore" hidden>Restore browser draft</button></div><div class="ms-view-label" hidden>3D view</div><div class="ms-coords" hidden>X: — &nbsp; Y: —</div></div>
      <fieldset class="ms-height"><legend>Z</legend><input type="number" data-role="height" aria-label="Paint height" min="-128" max="127" value="0" />${Array.from({ length: 33 }, (_, i) => 24 - i).map(h => `<button class="ms-height-step" data-height="${h}" style="--height:${h}" aria-pressed="${h === 0}">${h}</button>`).join("")}</fieldset>
      <fieldset class="ms-palette"><legend>Tile List</legend><select data-role="tileset" aria-label="Tileset library"><option value="">Project tiles</option></select><button data-ms="import-tileset">Import tileset…</button><div class="ms-palette-modes"><div role="group" aria-label="Palette arrangement"><button data-ms="palette-layouts" aria-pressed="true">Layouts</button><button data-ms="palette-tiles" aria-pressed="false">Tiles</button></div><div role="group" aria-label="Tile preview angle"><button data-ms="tile-top" aria-pressed="true">Top</button><button data-ms="tile-3d" aria-pressed="false">3D</button></div></div><select data-role="category" aria-label="Tile category" hidden><option value="">All categories</option></select><input type="search" data-role="search" placeholder="Search tiles or layouts" aria-label="Search tiles" /><button data-ms="new-layout" disabled>New layout…</button><div class="ms-active-brush" data-role="active-brush" hidden><span></span><button data-ms="single-tile" title="Use single tiles (B)" aria-label="Turn off smart brush">×</button></div><div class="ms-tiles"></div><div class="ms-palette-count">No tileset loaded</div></fieldset>
      <aside class="ms-right"><div class="ms-tabs" role="tablist"><button data-tab="matrix" role="tab" aria-selected="true">Matrix</button><button data-tab="tools" role="tab" aria-selected="false">Map Tools</button></div>
      <div class="ms-tab-panel" data-panel="matrix"><div class="ms-fields"><label for="ms-area">Area</label><input id="ms-area" data-role="area" type="number" min="0" max="65535" value="0" disabled /><label for="ms-group">Export Group</label><input id="ms-group" data-role="group" type="number" min="0" max="65535" value="0" disabled /></div><label><input data-role="center" type="checkbox" disabled /> Set as center of Export Group</label><div class="ms-matrix-info"><span>Map matrix</span><span data-role="matrix-size">—</span></div><div class="ms-matrix"></div><div class="ms-fields"><label>Chunk X</label><input data-role="new-x" type="number" value="1" min="-65535" max="65535" /><label>Chunk Y</label><input data-role="new-y" type="number" value="0" min="-65535" max="65535" /></div><button data-ms="add" disabled>Add empty chunk</button></div>
      <div class="ms-tab-panel" data-panel="tools" hidden><strong>Selected map</strong><div class="ms-help">Left drag paints. Middle drag pans. Right drag rotates. Scroll zooms.</div><label>Walking heights<select data-role="walking" aria-label="Walking height source"><option value="-1">Project collision + heights</option>${Array.from({ length: 9 }, (_, l) => `<option value="${l}" ${l === 0 ? "selected" : ""}>Layer ${l + 1}</option>`).join("")}</select></label><button data-ms="building-source" disabled>Load building source ROM…</button><span data-role="building-source-state" class="ms-help"></span>
      <section class="ms-insert"><strong>Insert into ROM</strong><button data-ms="targets" ${project && ["BW", "BW2"].includes(project.session.baseRom) ? "" : "disabled"}>Choose destination…</button><div data-role="destination" hidden><label>Graphics header<select data-role="header" aria-label="Destination header"></select></label><label>Matrix<input data-role="matrix" type="number" readonly aria-label="Destination matrix" /></label><label>Cell X<input data-role="target-x" type="number" min="0" value="0" /></label><label>Cell Y<input data-role="target-y" type="number" min="0" value="0" /></label><label>Season<select data-role="season">${["spring", "summer", "autumn", "winter"].map(s => `<option>${s}</option>`).join("")}</select></label><button data-ms="review" disabled>Review insertion</button></div><div class="ms-review" data-role="review" hidden></div><button data-ms="undo-insert" disabled>Undo ROM insertion</button><span class="ms-help">${project ? `ROM: ${escapeHtml(project.romInfo.fileName ?? project.session.baseVersion)}` : "Load a Gen 5 ROM in Pokeweb to insert terrain."}</span></section></div></aside>
    </div><div class="ms-status"><span class="ms-footer-name">No project</span><span data-role="geometry">0 polygons</span><span data-role="selection">Tile: —</span><span class="ms-message" role="status">Ready</span></div>
    <input data-role="files" type="file" multiple accept=".zip,.pdsmap,.pdsts,.meta,.per,.bdhc,.bld,.bgs,.png,.jpg,.jpeg" hidden /><input data-role="tileset-files" type="file" multiple accept=".zip,.pdsts,.meta,.png,.jpg,.jpeg,.bmp" hidden /><input data-role="folder" type="file" webkitdirectory multiple hidden /><input data-role="building-rom" type="file" accept=".nds" hidden />
  </section>`;
  const studio = root.querySelector<HTMLElement>(".map-studio")!, host = studio.querySelector<HTMLElement>(".ms-viewport")!, message = studio.querySelector<HTMLElement>(".ms-message")!;
  const query = <T extends HTMLElement = HTMLElement>(role: string) => studio.querySelector<T>(`[data-role="${role}"]`)!;
  const actionButton = (action: string) => studio.querySelector<HTMLButtonElement>(`button[data-ms="${action}"]`)!;
  const value = (role: string) => query<HTMLInputElement>(role).value;
  const status = (text: string, error = false) => { if (!disposed) { message.textContent = text; message.title = text; message.dataset.error = String(error); } };
  const setBusy = (state: boolean) => { busy = state; studio.classList.toggle("ms-busy", state); studio.setAttribute("aria-busy", String(state)); };
  const work = (operation: string, args: Record<string, unknown>) => {
    const selected = ["compile", "source", "buildings"].includes(operation)
      ? compileWorker ??= new Worker(new URL("../pokeweb/mapStudioCompileWorker.ts", import.meta.url), { type: "module" })
      : worker ??= new Worker(new URL("../pokeweb/mapStudioWorker.ts", import.meta.url), { type: "module" });
    selected.onmessage = event => { const req = requests.get(event.data.id); if (!req) return; requests.delete(event.data.id); if (event.data.error) req.reject(new Error(event.data.error)); else req.resolve(event.data.result); };
    selected.onerror = () => { for (const req of requests.values()) req.reject(new Error("Map Studio's worker could not finish. Save your project and reload.")); requests.clear(); };
    return new Promise<any>((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); selected.postMessage({ id, operation, ...args }); });
  };
  function cacheDraft() {
    if (!database || !workspace) return;
    try { const tx = database.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(workspace, "current"); tx.oncomplete = () => { if (!disposed) { saved = true; if (modified) status("Draft saved in this browser"); } }; tx.onerror = () => status("Browser draft could not be saved. Use Save project bundle.", true); }
    catch { status("Browser draft unavailable. Use Save project bundle.", true); }
  }
  if (typeof indexedDB !== "undefined") {
    const request = indexedDB.open("pokeweb-map-studio", 3); request.onupgradeneeded = () => { for (const name of ["drafts", "tilesets", "tilesetCatalog", "tilesetLayouts"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => {
      if (disposed) { request.result.close(); return; } database = request.result;
      const get = database.transaction("drafts").objectStore("drafts").get("current"); get.onsuccess = () => { if (!disposed && get.result) { const restore = studio.querySelector<HTMLButtonElement>('[data-ms="restore"]'); if (restore) { restore.hidden = false; restore.onclick = () => void mount(get.result); } } };
      // Read only the small catalog on entry. Pack bytes are loaded when selected.
      const catalog = database.transaction("tilesetCatalog").objectStore("tilesetCatalog").getAll(); catalog.onsuccess = () => { if (disposed) return; for (const library of catalog.result) libraries.set(library.id, library); renderLibraries(); };
      database.onversionchange = () => { database?.close(); database = undefined; };
    };
  }
  function refresh() {
    const smartLayout = workspace?.layouts?.find(g => g.id === smartLayoutId);
    if (!smartLayout) { smartArmed = false; if (tool === "smart") tool = "paint"; }
    actionButton("smart").disabled = !smartLayout;
    query("active-brush").hidden = !smartArmed || !smartLayout;
    query("active-brush").querySelector("span")!.textContent = `${tool === "erase" ? "Smart erase" : "Smart brush"}: ${smartLayout?.name || ""}`;
    studio.querySelectorAll<HTMLElement>('[data-ms="use-smart"]').forEach(b => b.setAttribute("aria-pressed", String(smartArmed && b.dataset.layoutId === smartLayoutId)));
    studio.querySelectorAll<HTMLButtonElement>('[data-ms="save"], [data-ms="save-map"], [data-ms="add"], [data-ms="building-source"], [data-ms="new-layout"]').forEach(b => b.disabled = !workspace);
    const generatedTiles = !!workspace && Object.keys(workspace.smart?.variants || {}).length > 0;
    actionButton("save-map").disabled = !workspace || generatedTiles; actionButton("save-map").title = generatedTiles ? "Save a project bundle to include generated smart brush tiles." : "";
    studio.querySelectorAll<HTMLButtonElement>('[data-ms="insert"]').forEach(b => b.disabled = !workspace || !project || !["BW", "BW2"].includes(project.session.baseRom));
    studio.querySelectorAll<HTMLButtonElement>('[data-ms="undo"]').forEach(b => b.disabled = !history?.canUndo);
    studio.querySelectorAll<HTMLButtonElement>('[data-ms="redo"]').forEach(b => b.disabled = !history?.canRedo);
    studio.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach(b => { b.disabled = !workspace; b.setAttribute("aria-pressed", String(Number(b.dataset.layer) === layer)); });
    studio.querySelectorAll<HTMLInputElement>("[data-visible]").forEach(b => b.disabled = !workspace);
    studio.querySelectorAll<HTMLButtonElement>("[data-height]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.height) === height)));
    for (const t of ["paint", "smart", "erase", "fill", "pick", "height", "pan"]) studio.querySelector(`[data-ms="${t}"]`)?.setAttribute("aria-pressed", String(tool === t));
    query<HTMLInputElement>("height").value = String(height);
    query("selection").textContent = smartArmed && smartLayout ? `Smart: ${smartLayout.name}` : workspace ? `Tile: ${tile} · ${workspace.tileset.tiles[tile]?.name || "—"}` : "Tile: —";
    if (workspace) {
      const c = workspace.map.chunks[chunk]; for (let l = 0; l < 9; l++) studio.querySelector(`[data-layer-count="${l}"]`)!.textContent = `${c.tiles[l].filter(id => id >= 0).length} tiles`;
      query<HTMLInputElement>("area").disabled = query<HTMLInputElement>("group").disabled = query<HTMLInputElement>("center").disabled = false;
      query<HTMLInputElement>("area").value = String(c.area); query<HTMLInputElement>("group").value = String(c.group); query<HTMLInputElement>("center").checked = c.center;
      studio.querySelector(".ms-footer-name")!.textContent = `${workspace.mapPath.split("/").at(-1)}${modified ? " *" : ""} · ${c.x}, ${c.y}`;
    }
  }
  function invalidateReview() { pending = undefined; query("review").hidden = true; }
  function changed() { modified = true; saved = false; invalidateReview(); clearTimeout(autosave); autosave = window.setTimeout(cacheDraft, 900); refresh(); }
  function renderTerrain() {
    if (!workspace || !viewport || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (disposed || !workspace) return; viewport?.update(chunk, visible);
      if (buildingPreviewChunk !== chunk) {
        buildingPreviewChunk = chunk; const epoch = ++buildingPreviewEpoch; viewport?.setBuildings([]);
        if (Object.keys(workspace.files).some(p => p.startsWith("mapstudio-buildings/"))) void work("buildings", { workspace, chunk }).then(primitives => { if (!disposed && epoch === buildingPreviewEpoch) viewport?.setBuildings(primitives); }).catch(error => { if (!disposed && epoch === buildingPreviewEpoch) status(String(error), true); });
      }
      const c = workspace.map.chunks[chunk]; let polygons = 0; for (const grid of c.tiles) for (const id of grid) if (id >= 0) { const t = workspace.tileset.tiles[id]; polygons += t.quads.length + t.triangles.length; } query("geometry").textContent = `${polygons.toLocaleString()} polygons`; });
  }
  function renderMatrix() {
    if (!workspace) return; const matrix = studio.querySelector<HTMLElement>(".ms-matrix")!, coords = workspace.map.chunks;
    const xs = coords.map(c => c.x), ys = coords.map(c => c.y), minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
    query("matrix-size").textContent = `${width} × ${h}`;
    matrix.classList.toggle("-dense", width > 12); matrix.style.gridTemplateColumns = `repeat(${width},minmax(${width > 12 ? 6 : 28}px,1fr))`;
    matrix.innerHTML = coords.map((c, index) => `<button data-chunk="${index}" aria-pressed="${chunk === index}" aria-label="Map ${c.x}, ${c.y}" title="Map ${c.x}, ${c.y}" style="grid-column:${c.x - minX + 1};grid-row:${c.y - minY + 1}">${c.x},${c.y}</button>`).join("");
  }
  function renderPalette() {
    const epoch = ++paletteEpoch;
    thumbnailObserver?.disconnect(); cancelAnimationFrame(thumbnailFrame); thumbnailFrame = 0; if (!workspace || !viewport) return;
    const tiles = studio.querySelector<HTMLElement>(".ms-tiles")!, search = value("search").toLowerCase(), ws = workspace, view = viewport;
    const selected = ws.palettes?.find(p => p.id === paletteId);
    const generated = new Set(Object.values(ws.smart?.variants || {}));
    const matches = ws.tileset.tiles.map((t, index) => ({ t, index })).filter(({ t, index }) => !generated.has(index) && (!selected || index >= selected.start && index < selected.start + selected.count) && (!category || t.folder === category) && `${index} ${t.name} ${t.folder || ""}`.toLowerCase().includes(search));
    const groups = (ws.layouts || []).filter(g => (!selected || layoutWithinPalette(g, selected)) && (!category || g.folder === category || layoutTileIds(g).some(id => ws.tileset.tiles[id].folder === category)) && (!search || `${g.name} ${g.folder} ${layoutTileIds(g).map(id => `${id} ${ws.tileset.tiles[id].name}`).join(" ")}`.toLowerCase().includes(search)));
    const grouped = new Set(paletteView === "layouts" ? groups.flatMap(layoutTileIds) : []), loose = matches.filter(({ index }) => !grouped.has(index));
    const cell = (id: number) => id < 0 ? '<span class="ms-layout-empty"></span>' : `<button class="ms-layout-cell" data-tile="${id}" title="${id}: ${escapeHtml(ws.tileset.tiles[id].name)}" aria-label="Tile ${id}: ${escapeHtml(ws.tileset.tiles[id].name)}" aria-pressed="${tile === id}"><canvas width="96" height="96"></canvas></button>`;
    const brushButton = (g: StudioTileLayout) => { const issue = studioSmartBrushIssue(ws,g); return `<button data-ms="use-smart" data-layout-id="${escapeHtml(g.id)}" aria-label="Use ${escapeHtml(g.name)} as smart brush" aria-pressed="${smartArmed && smartLayoutId === g.id}" title="${escapeHtml(issue || "Paint connected terrain · Shift or E to erase")}" ${issue ? "disabled" : ""}>Brush</button>`; };
    tiles.classList.toggle("-layouts", paletteView === "layouts");
    tiles.innerHTML = (paletteView === "layouts" ? groups.slice(0, layoutLimit).map(g => `<section class="ms-tile-layout" aria-label="${escapeHtml(g.name)}"><header><span title="${escapeHtml(g.folder)}">${escapeHtml(g.name)}</span>${brushButton(g)}<button data-ms="edit-layout" data-layout-id="${escapeHtml(g.id)}" aria-label="Arrange ${escapeHtml(g.name)}" title="Arrange tiles"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${toolPaths.paint}"/></svg></button></header><div class="ms-layout-body${g.extras?.length ? " -extras" : ""}"><div class="ms-layout-grid" style="--columns:${g.columns}">${g.cells.map(cell).join("")}</div>${g.extras?.length ? `<div class="ms-layout-extras" aria-label="Inner corners" title="Inner corners">${g.extras.map(cell).join("")}</div>` : ""}</div></section>`).join("") : "") + (loose.length ? `${paletteView === "layouts" ? '<div class="ms-loose-label">Unarranged tiles</div>' : ""}<div class="ms-loose-grid">${loose.slice(0, paletteLimit).map(({ t, index }) => `<button class="ms-tile" data-tile="${index}" title="${escapeHtml(t.name || `Tile ${index}`)} · ${t.width}×${t.height}" aria-pressed="${tile === index}"><canvas width="72" height="72"></canvas><span>${index}: ${escapeHtml(t.name || "Tile")}</span></button>`).join("")}</div>` : "");
    const tileCount = new Set([...matches.map(m => m.index), ...(paletteView === "layouts" ? groups.flatMap(layoutTileIds) : [])]).size;
    studio.querySelector(".ms-palette-count")!.innerHTML = `${paletteView === "layouts" ? `${groups.length} layouts · ` : ""}${tileCount.toLocaleString()} tiles${paletteView === "layouts" && groups.length > layoutLimit ? '<button data-ms="more-layouts">More layouts</button>' : ""}${loose.length > paletteLimit ? '<button data-ms="more-tiles">More tiles</button>' : ""}`;
    const queue: HTMLButtonElement[] = [];
    async function draw() { thumbnailFrame = 0; if (disposed || viewport !== view || paletteEpoch !== epoch) return; const b = queue.shift(); if (b?.isConnected) await view.thumbnail(Number(b.dataset.tile), b.querySelector("canvas")!, tileProjection); if (!disposed && viewport === view && paletteEpoch === epoch && queue.length) thumbnailFrame = requestAnimationFrame(draw); }
    const observer = new IntersectionObserver(entries => { if (disposed || paletteEpoch !== epoch) return; for (const entry of entries) if (entry.isIntersecting) { queue.push(entry.target as HTMLButtonElement); observer.unobserve(entry.target); } if (!thumbnailFrame && queue.length) thumbnailFrame = requestAnimationFrame(draw); }, { root: tiles, rootMargin: "72px" });
    thumbnailObserver = observer;
    tiles.querySelectorAll<HTMLButtonElement>("[data-tile]").forEach(b => thumbnailObserver!.observe(b));
  }
  async function arrangeLayout(id?: string) {
    if (!workspace || !viewport) return;
    const ws = workspace, view = viewport, selected = ws.palettes?.find(p => p.id === paletteId);
    const previous = ws.layouts?.find(g => g.id === id), layout: StudioTileLayout = previous || { id: (selected ? selected.id + "/" : "") + "custom-" + crypto.randomUUID(), name: "New layout", folder: category, columns: 3, rows: 3, cells: Array(9).fill(-1), source: "custom" };
    const { editStudioPalette } = await import("./mapStudioPaletteEditor"); if (disposed) return;
    const result = await editStudioPalette({ workspace: ws, layout, palette: selected, signal: abort.signal, thumbnail: (id, canvas) => view.thumbnail(id, canvas, "top") });
    if (result === undefined || disposed || workspace !== ws) return;
    if (result && selected && result.folder !== selected.name && !result.folder.startsWith(selected.name + "/")) result.folder = [selected.name, result.folder].filter(Boolean).join("/");
    ws.layouts = result === null ? ws.layouts!.filter(g => g.id !== id) : previous ? ws.layouts!.map(g => g.id === previous.id ? result : g) : [result, ...ws.layouts || []];
    if (database && selected) {
      const local = ws.layouts.filter(g => layoutWithinPalette(g, selected)).map(g => ({ ...g, id: g.id.startsWith(selected.id + "/") ? g.id.slice(selected.id.length + 1) : g.id, folder: g.folder.startsWith(selected.name + "/") ? g.folder.slice(selected.name.length + 1) : g.folder === selected.name ? "" : g.folder, cells: g.cells.map(id => id < 0 ? -1 : id - selected.start), ...(g.extras ? { extras: g.extras.map(id => id < 0 ? -1 : id - selected.start) } : {}) }));
      const tx = database.transaction("tilesetLayouts", "readwrite"); tx.objectStore("tilesetLayouts").put(local, selected.id); tx.onerror = () => status("Layout saved in this project; browser library storage is unavailable.", true);
    }
    if (!previous && result) { paletteView = "layouts"; actionButton("palette-layouts").setAttribute("aria-pressed", "true"); actionButton("palette-tiles").setAttribute("aria-pressed", "false"); category = ""; query<HTMLInputElement>("search").value = ""; renderLibraries(); studio.querySelector(".ms-tiles")!.scrollTop = 0; }
    renderLibraries(); changed(); renderPalette(); status(result ? `Saved layout · ${result.name}` : "Deleted layout");
  }
  function renderLibraries() {
    const options = new Map(libraries); for (const p of workspace?.palettes ?? []) options.set(p.id, p);
    query<HTMLSelectElement>("tileset").innerHTML = '<option value="">Project tiles</option>' + [...options.values()].map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${p.count.toLocaleString()})</option>`).join("");
    query<HTMLSelectElement>("tileset").value = paletteId; query("tileset").title = options.get(paletteId)?.name || "All project tiles";
    const selected = workspace?.palettes?.find(p => p.id === paletteId);
    const folders = new Set(workspace?.tileset.tiles.filter((_, i) => !selected || i >= selected.start && i < selected.start + selected.count).map(t => t.folder).filter((f): f is string => !!f));
    for (const g of workspace?.layouts || []) if (g.folder && (!selected || layoutWithinPalette(g, selected))) folders.add(g.folder);
    if (!folders.has(category)) category = "";
    const select = query<HTMLSelectElement>("category"); select.hidden = folders.size === 0;
    select.innerHTML = '<option value="">All categories</option>' + [...folders].sort().map(f => `<option value="${escapeHtml(f)}">${escapeHtml(selected && f.startsWith(selected.name + "/") ? f.slice(selected.name.length + 1) : f)}</option>`).join(""); select.value = category; select.title = category;
  }
  async function importTileset(files: Record<string, Uint8Array>, name: string) {
    setBusy(true); status("Importing tileset and textures…");
    try {
      if (history?.finish()) changed();
      const result: { workspace: StudioWorkspace; palette: StudioPalette; library: { id: string; name: string; count: number }; zip: Uint8Array } = await work("tileset", { files, name, workspace, game: Number(value("game")) });
      if (disposed) return;
      if (workspace) {
        // Preserve map object/undo history, brush, chunk and camera while appending tile IDs.
        workspace.files = result.workspace.files; workspace.tileset = result.workspace.tileset; workspace.palettes = result.workspace.palettes; workspace.layouts = result.workspace.layouts;
      } else await mount(result.workspace);
      if (database) {
        const stored = await new Promise<unknown>((resolve, reject) => { const req = database!.transaction("tilesetLayouts").objectStore("tilesetLayouts").get(result.library.id); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        if (disposed || !workspace) return;
        if (stored) { const layouts = readStudioLayouts(new TextEncoder().encode(JSON.stringify(stored)), result.palette.count); workspace.layouts = [...(workspace.layouts || []).filter(g => !layoutWithinPalette(g, result.palette)), ...remapStudioLayouts(layouts, result.palette.start, result.palette.id + "/", result.palette.name)]; }
      }
      paletteId = result.palette.id; tile = result.palette.start; category = ""; paletteLimit = 128; query<HTMLInputElement>("search").value = "";
      libraries.set(result.library.id, result.library);
      if (database) {
        const tx = database.transaction(["tilesets", "tilesetCatalog"], "readwrite"); tx.objectStore("tilesets").put(result.zip, result.library.id); tx.objectStore("tilesetCatalog").put(result.library, result.library.id);
        tx.onerror = () => status("Tileset added to the project; browser library storage is full. Keep the ZIP to import it again.", true);
      }
      renderLibraries(); renderPalette(); changed(); status(`Imported ${result.library.name} · ${result.library.count.toLocaleString()} tiles`);
    } finally { if (!disposed) setBusy(false); }
  }
  async function selectLibrary(id: string) {
    if (busy) return;
    if (!id || workspace?.palettes?.some(p => p.id === id)) {
      paletteId = id; category = ""; paletteLimit = 128; const p = workspace?.palettes?.find(p => p.id === id); if (p) tile = p.start;
      renderLibraries(); renderPalette(); refresh(); return;
    }
    studioAssert(database, "Import the tileset ZIP again to use this library.");
    setBusy(true);
    try {
      const bytes = await new Promise<Uint8Array>((resolve, reject) => { const req = database!.transaction("tilesets").objectStore("tilesets").get(id); req.onsuccess = () => req.result ? resolve(req.result) : reject(new Error("Import the tileset ZIP again to restore this library.")); req.onerror = () => reject(req.error); });
      if (!disposed) await importTileset({ "library.zip": bytes }, libraries.get(id)?.name || "Tileset");
    } finally { if (!disposed) setBusy(false); }
  }
  async function mount(ws: StudioWorkspace) {
    if (disposed) return; thumbnailObserver?.disconnect(); cancelAnimationFrame(thumbnailFrame); thumbnailFrame = 0; viewport?.dispose();
    if (!ws.layouts) { status("Arranging tile palette…"); ws.layouts = await work("layouts", { tileset: ws.tileset, metadata: ws.files[ws.tilesetPath + ".meta"] }); if (disposed) return; }
    buildingPreviewChunk = -1; buildingPreviewEpoch++;
    workspace = ws; history = new StudioHistory(ws); chunk = layer = tile = height = 0; paletteId = category = smartLayoutId = ""; smartArmed = false; tool = "paint"; paletteLimit = 128; modified = false; targetReady = false; invalidateReview();
    host.querySelector(".ms-empty")?.remove(); query<HTMLSelectElement>("game").value = String(ws.map.game);
    query<HTMLSelectElement>("walking").value = Object.keys(ws.files).some(p => p.endsWith(".per")) ? "-1" : "0";
    query("building-source-state").textContent = Object.keys(ws.files).some(p => p.startsWith("mapstudio-buildings/")) ? "Building resources loaded" : "";
    try { viewport = new StudioViewport(host, ws); await viewport.loadTextures(); if (disposed) return; }
    catch (error) { status(`3D preview unavailable: ${error instanceof Error ? error.message : error}`, true); return; }
    host.querySelector<HTMLElement>(".ms-view-label")!.hidden = false; host.querySelector<HTMLElement>(".ms-coords")!.hidden = false;
    attachPainting(viewport); renderMatrix(); renderTerrain(); renderLibraries(); renderPalette(); refresh();
    const missing = ws.tileset.materials.filter(m => { try { findStudioAsset(ws.files, ws.tilesetPath, m.image); return false; } catch { return true; } });
    status(missing.length ? `${missing.length} texture images missing; open all project assets before insertion.` : `Opened ${ws.map.chunks.length} chunks · ${ws.tileset.tiles.length} tiles`, missing.length > 0); cacheDraft();
  }
  async function openFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    if (modified && !confirm("Replace the current Map Studio draft? Save a project bundle first to keep a separate copy.")) return;
    setBusy(true);
    try {
      const files: Record<string, Uint8Array> = Object.create(null); let total = 0;
      for (const f of Array.from(list)) { total += f.size; studioAssert(total <= 256 * 1024 * 1024, "Select a project smaller than 256 MB."); files[f.webkitRelativePath || f.name] = new Uint8Array(await f.arrayBuffer()); }
      if (!Object.keys(files).some(p => /\.(pdsmap|zip)$/iu.test(p))) {
        const sets = Object.keys(files).filter(p => p.toLowerCase().endsWith(".pdsts")); studioAssert(sets.length === 1, "Choose one PDSTS tileset and its texture images for a new map.");
        const path = sets[0].replace(/\.pdsts$/iu, ".pdsmap"); files[path] = new TextEncoder().encode(writeStudioMap({ game: Number(value("game")), tileset: sets[0].split("/").at(-1)!, chunks: [newStudioChunk()] }));
      }
      await mount(await work("open", { files }));
    } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
    finally { if (!disposed) setBusy(false); }
  }
  async function openTilesetFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    try {
      const files: Record<string, Uint8Array> = Object.create(null); let total = 0;
      for (const f of Array.from(list)) { total += f.size; studioAssert(total <= 256 * 1024 * 1024, "Select a tileset smaller than 256 MB."); files[f.webkitRelativePath || f.name] = new Uint8Array(await f.arrayBuffer()); }
      await importTileset(files, list[0].name.replace(/\.(zip|pdsts)$/iu, ""));
    } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
    finally { query<HTMLInputElement>("tileset-files").value = ""; }
  }
  function selectTool(next: StudioTool) {
    if (next === "smart") { if (!workspace?.layouts?.some(g => g.id === smartLayoutId)) { status("Choose Brush beside a layout first."); return; } smartArmed = true; }
    if (["paint","fill","pick"].includes(next)) smartArmed = false;
    if (next === "pan" && tool !== "pan") beforePan = tool;
    tool = next; viewport?.setPan(tool === "pan"); refresh();
  }
  function attachPainting(view: StudioViewport) {
    const canvas = view.canvas;
    const paint = (event: PointerEvent) => {
      if (!workspace || !history || busy || tool === "pan") return;
      const point = view.pick(event.clientX, event.clientY, height); if (!point) { previous = undefined; return; }
      host.querySelector(".ms-coords")!.textContent = `X: ${point.x}   Y: ${point.y}   Layer: ${layer + 1}   Z: ${height}`;
      if (!dragging) return;
      const c = workspace.map.chunks[chunk], index = point.y * 32 + point.x;
      if (tool === "pick") { if (c.tiles[layer][index] >= 0) tile = c.tiles[layer][index]; height = c.heights[layer][index]; const owner = workspace.smart?.cells[studioCellKey(chunk,layer,index)]; if (owner && workspace.layouts?.some(g => g.id === owner)) { smartLayoutId = owner; smartArmed = true; tool = "smart"; } refresh(); studio.querySelectorAll<HTMLElement>("[data-tile]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.tile) === tile))); return; }
      try {
        const dx = point.x - (previous?.x ?? point.x), dy = point.y - (previous?.y ?? point.y), steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
        for (let i = 1; i <= steps; i++) {
          const x = Math.round(point.x - dx + dx * i / steps), y = Math.round(point.y - dy + dy * i / steps);
          const owner = tool === "height" ? workspace.smart?.cells[studioCellKey(chunk,layer,y*32+x)] : undefined;
          const smart = workspace.layouts?.find(g => g.id === (owner || (smartArmed && (tool === "smart" || tool === "erase") ? smartLayoutId : "")));
          if (smart) paintStudioSmart(history,smart,chunk,layer,x,y,height,tool === "erase" || tool === "smart" && event.shiftKey);
          else history.paint(chunk, layer, x, y, tile, height, tool);
        }
        previous = point; renderTerrain(); refresh();
      } catch (error) { history.cancelStroke(); dragging = false; previous = undefined; renderTerrain(); refresh(); status(error instanceof Error ? error.message : String(error), true); }
    };
    canvas.addEventListener("pointerdown", event => { if (event.button !== 0 || tool === "pan" || busy) return; dragging = true; previous = undefined; canvas.setPointerCapture(event.pointerId); paint(event); }, listen);
    canvas.addEventListener("pointermove", paint, listen);
    const finish = () => { if (!dragging) return; dragging = false; previous = undefined; if (history?.finish()) changed(); };
    canvas.addEventListener("pointerup", finish, listen); canvas.addEventListener("pointercancel", finish, listen); canvas.addEventListener("lostpointercapture", finish, listen);
    canvas.addEventListener("contextmenu", event => event.preventDefault(), listen);
  }
  function tab(name: string) { studio.querySelectorAll<HTMLElement>("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== name); studio.querySelectorAll<HTMLElement>("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name))); }
  async function targets() {
    studioAssert(project && ["BW", "BW2"].includes(project.session.baseRom), "Load a Gen 5 ROM first.");
    const [{ loadMatrixEditorData }, { resolveSeasonalMatrix }] = await Promise.all([import("../pokeweb/matrixModel"), import("../pokeweb/seasonalMatrixModel")]); await loadMatrixEditorData(project, { seasons: true }); if (disposed) return;
    resolveDestination = (matrix, season) => resolveSeasonalMatrix(project, matrix, season as "spring" | "summer" | "autumn" | "winter");
    const headers = Object.values(project.headers!.rows); query<HTMLSelectElement>("header").innerHTML = headers.map(h => `<option value="${h.index}">${h.index}: ${escapeHtml(String(h.location_name || "Map"))}</option>`).join("");
    const preferred = headers.find(h => h.index === 427) ?? headers[0]; if (preferred) query<HTMLSelectElement>("header").value = String(preferred.index);
    updateTargetHeader(); query("destination").hidden = false; targetReady = true; actionButton("review").disabled = !workspace;
  }
  function updateTargetHeader() {
    if (!project?.headers) return; const h = Object.values(project.headers.rows).find(row => row.index === Number(value("header"))); if (!h) return;
    query<HTMLInputElement>("matrix").value = String(h.matrix_id);
    const snapshot = resolveDestination?.(Number(h.matrix_id), value("season"));
    const cell = snapshot?.cells.find(c => c.headerId === h.index || c.headerId === Number(h.parent_map_id)) ?? snapshot?.cells.find(c => c.mapId !== 0xffffffff);
    if (cell) { query<HTMLInputElement>("target-x").value = String(cell.x); query<HTMLInputElement>("target-y").value = String(cell.y); }
    invalidateReview();
  }
  async function reviewInsertion() {
    studioAssert(workspace && history && project, "Open a map project and load a Gen 5 ROM.");
    status("Compiling terrain, textures and walking heights…");
    const input: Gen5MapImportInput = await work("compile", { workspace, chunk, layer: Number(value("walking")), game: project.session.baseRom }); if (disposed) return;
    const { prepareGen5MapImport } = await import("../pokeweb/gen5MapImport");
    pending = await prepareGen5MapImport(project, input, { matrixId: Number(value("matrix")), x: Number(value("target-x")), y: Number(value("target-y")), headerId: Number(value("header")), season: value("season") as "spring" | "summer" | "autumn" | "winter" });
    if (disposed) return; insertRevision = history.revision;
    const review = query("review"); review.hidden = false;
    review.innerHTML = `${pending.newCell ? "New cell · all seasons" : `Replace cell · ${escapeHtml(value("season"))}`}<br>Map ${pending.mapId} · ${pending.importedTextures} textures<br>${pending.components.map(escapeHtml).join(" · ")}${pending.notes.map(note => `<p>${escapeHtml(note)}</p>`).join("")}<div class="ms-insert-actions"><button data-ms="apply">Apply to ROM</button><button data-ms="cancel">Cancel</button></div>`;
    status("Map compiled. Review the destination, then Apply to ROM.");
  }
  studio.addEventListener("click", event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button"); if (!target || busy) return;
    if (target.dataset.layer !== undefined) { layer = Number(target.dataset.layer); refresh(); return; }
    if (target.dataset.height !== undefined) { height = Number(target.dataset.height); refresh(); return; }
    if (target.dataset.tile !== undefined) { tile = Number(target.dataset.tile); selectTool("paint"); studio.querySelectorAll<HTMLElement>("[data-tile]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.tile) === tile))); refresh(); return; }
    if (target.dataset.chunk !== undefined) { if (history?.finish()) changed(); chunk = Number(target.dataset.chunk); invalidateReview(); renderMatrix(); renderTerrain(); refresh(); return; }
    if (target.dataset.tab) { tab(target.dataset.tab); return; }
    const action = target.dataset.ms; if (!action) return;
    studio.querySelectorAll<HTMLDetailsElement>("details").forEach(d => d.open = false);
    void (async () => {
      if (action === "building-source") { query<HTMLInputElement>("building-rom").click(); return; }
      if (action === "open") { query<HTMLInputElement>("files").click(); return; }
      if (action === "import-tileset") { query<HTMLInputElement>("tileset-files").click(); return; }
      if (action === "use-smart") { const layout = workspace?.layouts?.find(g => g.id === target.dataset.layoutId); studioAssert(workspace && layout,"Choose a smart brush layout."); prepareStudioSmartBrush(workspace,layout); smartLayoutId = layout.id; tile = layout.cells[4] >= 0 ? layout.cells[4] : layout.cells[0]; selectTool("smart"); status(`Smart brush · ${layout.name} · Shift or E to erase`); return; }
      if (action === "single-tile") { selectTool("paint"); return; }
      if (action === "new-layout" || action === "edit-layout") { await arrangeLayout(target.dataset.layoutId); return; }
      if (action === "palette-layouts" || action === "palette-tiles") { paletteView = action === "palette-layouts" ? "layouts" : "tiles"; for (const mode of ["layouts", "tiles"]) actionButton("palette-" + mode).setAttribute("aria-pressed", String(paletteView === mode)); renderPalette(); return; }
      if (action === "tile-top" || action === "tile-3d") { tileProjection = action === "tile-top" ? "top" : "3d"; for (const mode of ["top", "3d"]) actionButton("tile-" + mode).setAttribute("aria-pressed", String(tileProjection === mode)); renderPalette(); return; }
      if (action === "more-layouts") { layoutLimit += 24; renderPalette(); return; }
      if (action === "more-tiles") { paletteLimit += 128; renderPalette(); return; }
      if (action === "folder") { query<HTMLInputElement>("folder").click(); return; }
      if (action === "new") {
        if (!workspace) { query<HTMLInputElement>("tileset-files").click(); return; }
        if (modified && !confirm("Start a new map using this tileset? Save a bundle first to keep a separate copy.")) return;
        const files = Object.fromEntries(Object.entries(workspace.files).filter(([path]) => !/\.(pdsmap|per|bdhc|bdhcam|bld|bgs)$|\.pdsmap\.(smart|palettes)\.json$/iu.test(path)));
        await mount({ ...workspace, files, smart: workspace.smart ? { cells: Object.create(null), variants: { ...workspace.smart.variants } } : undefined, mapPath: workspace.mapPath.replace(/[^/]+$/u, "Untitled.pdsmap"), map: { ...workspace.map, chunks: [newStudioChunk()] } }); changed(); return;
      }
      if (action === "save" || action === "save-map") {
        if (!workspace) return; history?.finish(); setBusy(true);
        if (action === "save") download(await work("save", { workspace }), workspace.mapPath.split("/").at(-1)!.replace(/\.pdsmap$/iu, "-mapstudio.zip"));
        else download(new TextEncoder().encode(writeStudioMap(workspace.map)), workspace.mapPath.split("/").at(-1)!, "text/plain");
        if (disposed) return; modified = false; cacheDraft(); refresh(); status(action === "save" ? "Saved PDSMS-compatible project bundle" : "Saved PDSMAP; its tileset and sidecars remain in the project bundle"); return;
      }
      if (action === "undo" || action === "redo") { if (history?.[action]()) { changed(); renderTerrain(); } return; }
      if (["paint", "smart", "erase", "fill", "pick", "height", "pan"].includes(action)) { selectTool(action as StudioTool); return; }
      if (action === "3d" || action === "top") { viewport?.setView(action); viewport?.setPan(tool === "pan"); host.querySelector(".ms-view-label")!.textContent = action === "3d" ? "3D view" : "Top view"; return; }
      if (action === "fit") { viewport?.fit(); return; }
      if (action === "grid" || action === "wire") { const enabled = target.getAttribute("aria-pressed") !== "true"; target.setAttribute("aria-pressed", String(enabled)); if (action === "grid") viewport?.setGrid(enabled); else viewport?.setWire(enabled); return; }
      if (action === "add") {
        if (!workspace) return; const x = Number(value("new-x")), y = Number(value("new-y")); studioAssert(Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) <= 65535 && Math.abs(y) <= 65535, "Use valid whole-number chunk coordinates."); studioAssert(workspace.map.chunks.length < 900 && !workspace.map.chunks.some(c => c.x === x && c.y === y), "Choose unused coordinates; the project supports at most 900 chunks.");
        workspace.map.chunks.push(newStudioChunk(x, y)); chunk = workspace.map.chunks.length - 1; history = new StudioHistory(workspace); changed(); renderMatrix(); renderTerrain(); return;
      }
      if (action === "insert") { tab("tools"); setBusy(true); if (!targetReady) await targets(); status("Choose the ROM destination and review insertion."); return; }
      if (action === "targets") { setBusy(true); await targets(); return; }
      if (action === "review") { setBusy(true); await reviewInsertion(); return; }
      if (action === "cancel") { invalidateReview(); status("ROM insertion canceled"); return; }
      if (action === "apply") {
        studioAssert(pending && history && project && insertRevision === history.revision, "The source map changed. Review insertion again."); setBusy(true);
        const { applyGen5MapImport } = await import("../pokeweb/gen5MapImport"); await applyGen5MapImport(project, pending); lastImport = pending; invalidateReview(); onRomDirty(); actionButton("undo-insert").disabled = false; status("Inserted into ROM project. Export the ROM from Pokeweb to test in game."); return;
      }
      if (action === "undo-insert") { studioAssert(lastImport && project, "No ROM insertion to undo."); setBusy(true); await (await import("../pokeweb/gen5MapImport")).undoGen5MapImport(project, lastImport); lastImport = undefined; actionButton("undo-insert").disabled = true; onRomDirty(); status("ROM insertion undone"); }
    })().catch(error => status(error instanceof Error ? error.message : String(error), true)).finally(() => { if (!disposed) setBusy(false); });
  }, listen);
  for (const role of ["files", "folder"]) query<HTMLInputElement>(role).addEventListener("change", event => { const input = event.target as HTMLInputElement; void openFiles(input.files); input.value = ""; }, listen);
  query<HTMLInputElement>("tileset-files").addEventListener("change", event => { void openTilesetFiles((event.target as HTMLInputElement).files); }, listen);
  query<HTMLSelectElement>("tileset").addEventListener("change", event => { void selectLibrary((event.target as HTMLSelectElement).value).catch(error => { renderLibraries(); status(error instanceof Error ? error.message : String(error), true); }); }, listen);
  query<HTMLSelectElement>("category").addEventListener("change", event => { category = (event.target as HTMLSelectElement).value; query("category").title = category; paletteLimit = 128; layoutLimit = 24; studio.querySelector(".ms-tiles")!.scrollTop = 0; renderPalette(); }, listen);
  query<HTMLInputElement>("building-rom").addEventListener("change", event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
    if (!workspace || !file || busy) return;
    setBusy(true); status("Loading source building models and textures…");
    void (async () => {
      const files = await work("source", { workspace, bytes: new Uint8Array(await file.arrayBuffer()) });
      if (disposed || !workspace) return;
      Object.assign(workspace.files, files); buildingPreviewChunk = -1; changed(); renderTerrain(); query("building-source-state").textContent = "Building resources loaded";
      status("Building models and textures loaded. Save the project bundle to keep them.");
    })().catch(error => status(error instanceof Error ? error.message : String(error), true)).finally(() => { if (!disposed) setBusy(false); });
  }, listen);
  studio.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.visible !== undefined) { visible[Number(input.dataset.visible)] = input.checked; renderTerrain(); return; }
    if (input.dataset.role === "height") { const n = Number(input.value); if (Number.isInteger(n) && n >= -128 && n <= 127) { height = n; refresh(); } return; }
    if (input.dataset.role === "header") { updateTargetHeader(); return; }
    if (["target-x", "target-y", "season", "walking"].includes(input.dataset.role ?? "")) { invalidateReview(); return; }
    if (workspace && input.dataset.role === "game") { workspace.map.game = Number(input.value); changed(); return; }
    if (workspace && ["area", "group", "center"].includes(input.dataset.role ?? "")) {
      const c = workspace.map.chunks[chunk]; if (input.dataset.role === "center") { for (const other of workspace.map.chunks) if (other.group === c.group) other.center = false; c.center = input.checked; } else { const n = Number(input.value); if (!Number.isInteger(n) || n < 0 || n > 65535) { refresh(); return; } c[input.dataset.role as "area" | "group"] = n; } changed(); if (input.dataset.role === "area") { buildingPreviewChunk = -1; renderTerrain(); }
    }
  }, listen);
  query<HTMLInputElement>("search").addEventListener("input", () => { paletteLimit = 128; layoutLimit = 24; studio.querySelector(".ms-tiles")!.scrollTop = 0; renderPalette(); }, listen);
  query<HTMLInputElement>("height").addEventListener("input", event => {
    const n = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(n) && n >= -128 && n <= 127) height = n;
  }, listen);
  root.addEventListener("dragover", event => { event.preventDefault(); }, listen);
  root.addEventListener("drop", event => { event.preventDefault(); void openFiles(event.dataTransfer?.files ?? null); }, listen);
  document.addEventListener("keydown", event => {
    if (disposed || busy || document.querySelector(".ms-layout-dialog[open]")) return;
    const typing = event.target instanceof HTMLElement && event.target.closest("input,select,textarea,[contenteditable]");
    if (typing && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "z") { event.preventDefault(); studio.querySelector<HTMLButtonElement>(`[data-ms="${event.shiftKey ? "redo" : "undo"}"]`)?.click(); }
      else if (event.key.toLowerCase() === "s") { event.preventDefault(); studio.querySelector<HTMLButtonElement>('[data-ms="save"]')?.click(); }
      else if (event.key.toLowerCase() === "y") { event.preventDefault(); studio.querySelector<HTMLButtonElement>('[data-ms="redo"]')?.click(); }
      return;
    }
    const keys: Record<string, StudioTool> = { b: "paint", g: "smart", e: "erase", f: "fill", i: "pick", h: "height", " ": "pan" };
    if (keys[event.key.toLowerCase()]) { event.preventDefault(); selectTool(keys[event.key.toLowerCase()]); }
    if (event.key === "[" || event.key === "]") { height = Math.max(-128, Math.min(127, height + (event.key === "]" ? 1 : -1))); refresh(); }
  }, listen);
  document.addEventListener("keyup", event => { if (event.key === " " && tool === "pan") selectTool(beforePan); }, listen);
  window.addEventListener("beforeunload", event => { if (modified && !saved) { event.preventDefault(); event.returnValue = ""; } }, listen);
  studio.querySelector('[data-ms="grid"]')?.setAttribute("aria-pressed", "true");
  selectTool("paint");
  return () => {
    if (disposed) return; history?.finish(); if (modified) cacheDraft(); disposed = true; clearTimeout(autosave); cancelAnimationFrame(frame); cancelAnimationFrame(thumbnailFrame); thumbnailObserver?.disconnect(); abort.abort();
    viewport?.dispose(); viewport = undefined; worker?.terminate(); compileWorker?.terminate(); worker = compileWorker = undefined; for (const req of requests.values()) req.reject(new Error("Map Studio closed.")); requests.clear(); database?.close(); database = undefined;
    workspace = undefined; history = undefined; pending = lastImport = undefined;
  };
}
