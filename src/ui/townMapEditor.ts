import "../styles/townMap.css";
import { loadTownMapDraft, applyTownMapDraft, TownMapHistory, TOWN_MAP_TYPES, TOWN_MAP_CONDITIONS,
  appendTownMapArea, editTownMapText, moveTownMapArea, townMapHit, type TownMapDraft, type TownMapArea } from "../pokeweb/townMapModel";
import { TOWN_MAP_LAYERS, readTownMapLayer, writeTownMapLayer, convertTownMapImage, fillTownMapTiles,
  unpackTownMapResource, editTownMapAnimationFrame, readTownMapTileSet, writeTownMapTileSet, type TownMapImageConversion, type TownMapLayer } from "../pokeweb/townMapGraphics";
import { renderNitroBackgroundImage, type NitroBackgroundImage } from "../pokeweb/nitroBg";
import { parseNitroCellEffect, type NitroCellEffect } from "../pokeweb/nitroCell";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { townMapCapacity } from "../pokeweb/townMapCapacity";
import { captureTownMapArtwork, placeTownMapArtwork, townMapArtworkAreas, townMapArtworkRgba,
  type TownMapArtworkClipboard, type TownMapArtworkRect } from "../pokeweb/townMapArtwork";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const esc = (v: unknown) => escapeHtml(String(v));
const MAP_TOOLS = [
  { id: "select", label: "Areas", name: "Area handles", key: "V", icon: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>' },
  { id: "artwork", label: "Select", name: "Select artwork", key: "S", icon: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>' },
  { id: "paint", label: "Pencil", name: "Paint tiles", key: "B", icon: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/>' },
  { id: "fill", label: "Fill", name: "Fill tiles", key: "F", icon: '<path d="m5 3 11 11M10 4l9 9-8 8-9-9 8-8ZM3 13h15M21 15s-2 2.6-2 4a2 2 0 0 0 4 0c0-1.4-2-4-2-4Z"/>' },
  { id: "pick", label: "Picker", name: "Pick tile", key: "I", icon: '<path d="m14 4 6 6M13 7l4-4a2.8 2.8 0 0 1 4 4l-4 4M14 8 4 18v3h3L17 11M6 16l2 2"/>' },
] as const;
type Tool = typeof MAP_TOOLS[number]["id"];
type Target = "marker" | "cursor" | "hitStart" | "hitEnd" | "habitat";
type ArtworkPreview = { clip: TownMapArtworkClipboard; destination: { x: number; y: number }; canvases: Map<number, HTMLCanvasElement> };
type ArtworkGesture = { kind: "select"; id: number; start: { x: number; y: number }; rect: TownMapArtworkRect }
  | { kind: "move"; id: number; start: { x: number; y: number }; preview: ArtworkPreview; moveAreas: boolean; areas: number[] };
export function renderTownMapEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): () => void {
  let stopped = false, busy = false, draft: TownMapDraft, selected = 0, layerId = 0, tileId = 0, paletteBank = 0, colorId = 1;
  let tool: Tool = "artwork", target: Target = "marker", linked = true, grid = true, overlays = false, search = "", view = "map", sequence = 0;
  const layerCanvases = new Map<number, HTMLCanvasElement>();
  let inspectorTab = "area", importRequest = 0;
  let zoom = 1, artworkBoth = false, artworkSnap = false, artworkMoveAreas = false;
  let artworkSelection: TownMapArtworkRect | undefined, artworkClipboard: TownMapArtworkClipboard | undefined;
  let artworkGesture: ArtworkGesture | undefined, artworkPaste: ArtworkPreview | undefined;
  let history = new TownMapHistory(), pendingImport: TownMapImageConversion | undefined;
  let effects: NitroCellEffect | undefined, habitatEffect: NitroCellEffect | undefined, tick = 0, timer: ReturnType<typeof setInterval> | undefined;
  root.innerHTML = `<section class="town-map-editor" aria-label="Town Map"><h1>Town Map</h1><p role="status">Loading map…</p></section>`;
  const cleanup = () => { stopped = true; if (timer) clearInterval(timer); };
  void loadTownMapDraft(project).then(value => { if (stopped) return; draft = value; mount(); }).catch(error => {
    if (!stopped) root.innerHTML = `<section class="town-map-editor"><h1>Town Map</h1><p role="alert">${esc(message(error))}</p></section>`;
  });
  return cleanup;
  function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
  function status(text: string, error = false) {
    const node = root.querySelector<HTMLElement>(".tm-message"); if (!node) return;
    node.textContent = text; node.classList.toggle("-error", error);
  }
  function run(action: () => void) { try { action(); } catch (error) { status(message(error), true); } }
  function clearImport() { pendingImport = undefined; importRequest++; root.querySelector(".tm-import-host")?.replaceChildren(); }
  function change(action: () => void, inspector = true) {
    if (busy) return false;
    artworkGesture = undefined; artworkPaste = undefined;
    try { history.edit(draft, action); clearImport(); refresh(inspector); status("Draft changed"); return true; }
    catch (error) { draw(); renderArtworkControls(); status(message(error), true); return false; }
  }
  function areaName(a: TownMapArea) { return String(project.headers?.rows[a.zone + 1]?.location_name ?? `Map ${a.zone}`); }
  function files() { return view === "habitat-art" ? draft.habitatGraphics : draft.graphics; }
  function spriteIds() { return view === "habitat-art" ? { char: 15, pal: 5, cell: 29, anim: 46 } : { char: 8, pal: 2, cell: 12, anim: 19 }; }
  function isSprite() { return view === "icons" || view === "habitat-art"; }
  function selectedLayer() { return TOWN_MAP_LAYERS[layerId]; }
  function artworkLayers() { return artworkBoth && layerId < 2 ? TOWN_MAP_LAYERS.slice(0, 2) : [selectedLayer()]; }
  function clearArtwork() { artworkSelection = undefined; artworkGesture = undefined; artworkPaste = undefined; }
  function canPasteArtwork() {
    const layers = artworkLayers();
    return artworkClipboard && artworkClipboard.layers.length === layers.length && artworkClipboard.layers.every(c => layers.some(l => l.screen === c.layer.screen));
  }
  function makeArtworkPreview(clip: TownMapArtworkClipboard, destination: { x: number; y: number }): ArtworkPreview {
    const canvases = new Map<number, HTMLCanvasElement>();
    clip.layers.forEach(({ layer, pixels }) => {
      const canvas = document.createElement("canvas"), palette = readTownMapLayer(draft.graphics, layer).indexed.palette;
      imageToCanvas(canvas, clip.source.width, clip.source.height, townMapArtworkRgba(pixels, palette)); canvases.set(layer.screen, canvas);
    });
    return { clip, destination, canvases };
  }
  function artworkDestination(clip: TownMapArtworkClipboard, x: number, y: number) {
    const step = artworkSnap ? 8 : 1;
    return { x: Math.max(0, Math.min(Math.floor((256 - clip.source.width) / step) * step, Math.round(x / step) * step)),
      y: Math.max(0, Math.min(Math.floor((256 - clip.source.height) / step) * step, Math.round(y / step) * step)) };
  }
  function moveArtwork(dx: number, dy: number) {
    if (artworkPaste) {
      artworkPaste.destination = artworkDestination(artworkPaste.clip, artworkPaste.destination.x + dx, artworkPaste.destination.y + dy); draw(); return;
    }
    if (!artworkSelection || !dx && !dy) return;
    const clip = captureTownMapArtwork(draft.graphics, artworkLayers(), artworkSelection);
    const destination = { x: clip.source.x + dx, y: clip.source.y + dy };
    change(() => { placeTownMapArtwork(draft, clip, destination, { move: true, moveAreas: artworkMoveAreas }); artworkSelection = { ...clip.source, ...destination }; });
  }
  function commitArtworkPaste() {
    const preview = artworkPaste; if (!preview) return;
    change(() => { placeTownMapArtwork(draft, preview.clip, preview.destination); artworkSelection = { ...preview.clip.source, ...preview.destination }; });
  }
  function chooseTool(next: Tool) {
    if (busy || tool === next && !isSprite()) return;
    clearArtwork(); tool = next;
    if (tool === "select") { overlays = true; root.querySelector<HTMLInputElement>("#tm-overlays")!.checked = true; }
    if (isSprite() || tool === "artwork" && (view === "habitat" || layerId === 2)) {
      view = "layer"; root.querySelector<HTMLSelectElement>("#tm-view")!.value = view; rebuildEffects(); refresh(false);
    }
    root.querySelector<HTMLCanvasElement>(".tm-map")!.style.cursor = "crosshair"; renderArtworkControls(); draw();
  }
  function toolShortcut(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const next = MAP_TOOLS.find(t => t.key.toLowerCase() === event.key.toLowerCase());
    if (!next) return false;
    event.preventDefault(); chooseTool(next.id); return true;
  }
  function renderArtworkControls() {
    const host = root.querySelector<HTMLElement>(".tm-artwork-controls"); if (!host) return;
    host.hidden = tool !== "artwork" || isSprite();
    const rect = artworkGesture?.kind === "select" ? artworkGesture.rect : artworkSelection;
    const areas = rect ? townMapArtworkAreas(draft.areas, rect) : [];
    host.querySelector<HTMLElement>(".tm-artwork-readout")!.textContent = artworkPaste ? "Click or Enter to paste · Esc cancels" : rect ? `${rect.width} × ${rect.height} px · ${rect.x}, ${rect.y}` : "Drag to select · drag inside to move";
    for (const name of ["artCopy", "artClear", "artNew"]) host.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!.disabled = !rect || busy;
    const paste = host.querySelector<HTMLButtonElement>('[data-action="artPaste"]')!; paste.disabled = !canPasteArtwork() || busy; paste.setAttribute("aria-pressed", String(Boolean(artworkPaste)));
    root.querySelector<HTMLButtonElement>('[data-action="apply"]')!.disabled = busy || Boolean(artworkPaste || artworkGesture);
    root.querySelector<HTMLElement>(".tm-area-controls")!.hidden = tool !== "select" || isSprite();
    root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(button => {
      const active = button.dataset.tool === tool; button.setAttribute("aria-pressed", String(active)); button.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll<HTMLButtonElement>(".tm-nudge button").forEach(button => { button.disabled = busy || isSprite() || tool !== "select" && tool !== "artwork"; });
    const linked = host.querySelector<HTMLInputElement>("#tm-artwork-handles")!; linked.checked = artworkMoveAreas; linked.disabled = !areas.length || Boolean(artworkPaste) || busy;
    host.querySelector(".tm-artwork-area-count")!.textContent = `Move area handles (${areas.length})`;
    host.querySelectorAll<HTMLButtonElement>("[data-artwork-scope]").forEach(b => { b.disabled = layerId === 2 || busy; b.setAttribute("aria-pressed", String((b.dataset.artworkScope === "both") === artworkBoth)); });
    root.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.layer) === layerId)));
  }
  function tileSet() {
    if (isSprite()) { const ids = spriteIds(); return readTownMapTileSet(files(), ids.char, ids.pal); }
    const image = readTownMapLayer(draft.graphics, selectedLayer());
    return { tiles: image.indexed.tilePixels, palette: image.indexed.palette, bitsPerPixel: image.indexed.bitsPerPixel };
  }
  function writeSet(set: ReturnType<typeof tileSet>) {
    if (isSprite()) { const ids = spriteIds(); writeTownMapTileSet(files(), ids.char, ids.pal, set); }
    else { const image = readTownMapLayer(draft.graphics, selectedLayer()); Object.assign(image.indexed, { tilePixels: set.tiles, palette: set.palette }); writeTownMapLayer(draft.graphics, selectedLayer(), image); }
  }
  function imageToCanvas(canvas: HTMLCanvasElement, width: number, height: number, rgba: Uint8ClampedArray) {
    canvas.width = width; canvas.height = height; canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  }
  function bitmap(image: NitroBackgroundImage) {
    const canvas = document.createElement("canvas"); imageToCanvas(canvas, image.width, image.height, renderNitroBackgroundImage(image)); return canvas;
  }
  function layerBitmap(layer: TownMapLayer) {
    let canvas = layerCanvases.get(layer.screen);
    if (!canvas) { canvas = bitmap(readTownMapLayer(draft.graphics, layer)); layerCanvases.set(layer.screen, canvas); }
    return canvas;
  }
  function rebuildEffects() {
    try {
      const ids = spriteIds(), f = files(); effects = parseNitroCellEffect("Town Map", ids.char, ids.pal, ids.cell, ids.anim,
        f.get(ids.char)!, f.get(ids.pal)!, f.get(ids.cell)!, f.get(ids.anim)!, { originCentered: true });
      const h = draft.habitatGraphics;
      habitatEffect = parseNitroCellEffect("Habitat", 15, 5, 29, 46, h.get(15)!, h.get(5)!, h.get(29)!, h.get(46)!, { originCentered: true });
    } catch (error) { effects = undefined; habitatEffect = undefined; status(message(error), true); }
  }
  function mount() {
    root.innerHTML = `<section class="town-map-editor" aria-label="Town Map">
      <header class="tm-heading"><div><h1>Town Map</h1><span class="tm-count"></span></div><div class="tm-controls"><a class="tm-link" href="#flyDestinations" data-route="flyDestinations">Fly Destinations ↗</a><a class="tm-link" href="#headers" data-route="headers">Headers &amp; Overworlds ↗</a></div></header>
      <div class="tm-toolbar"><button class="btn -default" data-action="import">Import image</button><button class="btn -default" data-action="export">Export layer</button><button class="btn -default" data-action="composite">Export composite</button><input id="tm-file" type="file" accept="image/png,image/bmp,.bmp" hidden />
        <button class="btn -default" data-action="undo">Undo</button><button class="btn -default" data-action="redo">Redo</button><button class="btn -default" data-action="apply">Apply</button><button class="btn -default" data-action="reload">Reload</button></div>
      <div class="tm-message" role="status" aria-live="polite"></div><div class="tm-import-host"></div>
      <div class="tm-layout"><div class="tm-art"><section class="tm-panel"><h2>Map preview</h2><div class="tm-panel-body"><div class="tm-controls">
        <select id="tm-view" aria-label="Preview"><option value="map">Composite map</option><option value="layer">Artwork layer</option><option value="habitat">Pokédex highlights</option><option value="icons">Markers &amp; animations</option><option value="habitat-art">Habitat shapes &amp; animations</option></select>
        <label><input id="tm-grid" type="checkbox" checked />Grid</label><label><input id="tm-overlays" type="checkbox" />Handles</label><div class="tm-segmented" role="group" aria-label="Zoom"><button type="button" data-zoom="1" aria-pressed="true">1×</button><button type="button" data-zoom="2" aria-pressed="false">2×</button></div></div>
        <div class="tm-toolbox"><div class="tm-tools" role="toolbar" aria-label="Map tools" aria-orientation="horizontal">${MAP_TOOLS.map(t => `<button type="button" data-tool="${t.id}" aria-label="${t.name}" aria-pressed="${tool === t.id}" aria-keyshortcuts="${t.key}" title="${t.name} (${t.key})" tabindex="${tool === t.id ? 0 : -1}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${t.icon}</svg><span>${t.label}</span></button>`).join("")}</div><div class="tm-nudge" role="group" aria-label="Nudge selection"><button type="button" data-action="left" aria-label="Move left" title="Move left">←</button><button type="button" data-action="up" aria-label="Move up" title="Move up">↑</button><button type="button" data-action="down" aria-label="Move down" title="Move down">↓</button><button type="button" data-action="right" aria-label="Move right" title="Move right">→</button></div></div>
        <div class="tm-controls"><div class="tm-segmented" role="group" aria-label="Artwork layer">${TOWN_MAP_LAYERS.map((l, i) => `<button type="button" data-layer="${i}" aria-label="${esc(l.label)}" aria-pressed="${i === layerId}">${["Back", "Front", "Information"][i]}</button>`).join("")}</div></div>
        <div class="tm-artwork-controls" hidden><div class="tm-controls"><div class="tm-segmented" role="group" aria-label="Artwork scope"><button type="button" data-artwork-scope="layer" aria-pressed="true">Active layer</button><button type="button" data-artwork-scope="both" aria-pressed="false">Both map layers</button></div><label><input id="tm-artwork-snap" type="checkbox" />Snap 8 px</label></div><div class="tm-controls"><button class="btn -default" data-action="artCopy" title="Copy artwork (Ctrl/Cmd+C)">Copy</button><button class="btn -default" data-action="artPaste" title="Paste artwork (Ctrl/Cmd+V)">Paste</button><button class="btn -default" data-action="artNew">New selection</button><button class="btn -default" data-action="artClear" title="Clear selected artwork (Delete)">Clear artwork</button></div><div class="tm-controls"><label title="Move the marker, cursor and touch region of areas inside the selection"><input id="tm-artwork-handles" type="checkbox" /><span class="tm-artwork-area-count">Move area handles (0)</span></label><span class="tm-artwork-readout"></span></div></div>
        <div class="tm-viewport"><canvas class="tm-map" width="256" height="256" tabindex="0" aria-label="Town Map editing canvas"></canvas></div>
        <div class="tm-controls tm-area-controls"><label>Move <select id="tm-target" aria-label="Move target"><option value="marker">Marker</option><option value="cursor">Cursor</option><option value="hitStart">Touch start</option><option value="hitEnd">Touch end</option><option value="habitat">Habitat</option></select></label><label title="Keep the marker, cursor and touch region linked"><input id="tm-linked" type="checkbox" checked />Move together</label><span class="tm-readout"></span></div>

      </div></section></div>
      <div class="tm-data"><section class="tm-panel tm-tiles-panel"><h2>Tile palette &amp; pixel editor</h2><div class="tm-panel-body"><div class="tm-controls"><label>Palette <select id="tm-bank"></select></label><button data-action="flipX">Flip tile X</button><button data-action="flipY">Flip tile Y</button></div><div class="tm-tiles-wrap"><canvas class="tm-tiles" aria-label="Tile palette"></canvas></div><div class="tm-status"><span class="tm-tile-count"></span><span class="tm-tile-selected"></span></div>
        <div class="tm-pixel-row"><canvas class="tm-pixel" width="8" height="8" aria-label="Selected tile pixel editor"></canvas><div style="flex:1;min-width:150px"><div class="tm-palette" aria-label="Colors"></div><div class="tm-controls"><label>Color <input id="tm-color" type="color" /></label><span class="tm-color-index"></span></div></div></div><div class="tm-animation"></div></div></section>
      <section class="tm-panel"><h2>Areas</h2><div class="tm-panel-body"><input class="filter-input tm-search" type="search" aria-label="Find an area" placeholder="Area name or map ID" /><div class="tm-table-wrap tm-areas"></div><div class="tm-controls"><select class="tm-add" id="tm-add-zone" aria-label="New area map header"></select><button data-action="add">Add / duplicate area</button><button data-action="remove">Remove appended area</button></div></div></section>
      </div>
      <section class="tm-panel tm-inspector"><h2 class="tm-area-title">Area</h2><div class="tm-controls tm-inspector-tabs"><button class="btn -default" data-inspector-tab="area">Area</button><button class="btn -default" data-inspector-tab="text">Description &amp; landmarks</button><button class="btn -default" data-action="disable">Disable area</button></div><div class="tm-panel-body"><div class="tm-fields-host"></div><div class="tm-texts"></div></div></section></div></section>`;
    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => button.addEventListener("click", () => action(button.dataset.action!)));
    root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach(button => button.addEventListener("click", () => { inspectorTab = button.dataset.inspectorTab!; renderInspector(); }));
    const bind = (id: string, listener: (el: HTMLInputElement | HTMLSelectElement) => void) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#tm-${id}`)!.addEventListener("change", event => run(() => listener(event.target as HTMLInputElement)));
    bind("view", el => { clearImport(); clearArtwork(); view = el.value; if (layerId === 2 && (view === "map" || view === "habitat")) layerId = 0; tileId = paletteBank = sequence = 0; rebuildEffects(); refresh(); });
    root.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach(button => button.addEventListener("click", () => run(() => {
      if (busy) return; clearImport(); clearArtwork(); layerId = Number(button.dataset.layer); tileId = paletteBank = 0;
      if (layerId === 2) { artworkBoth = false; view = "layer"; root.querySelector<HTMLSelectElement>("#tm-view")!.value = view; }
      refresh(false);
    })));
    root.querySelectorAll<HTMLButtonElement>("[data-artwork-scope]").forEach(button => button.addEventListener("click", () => {
      clearArtwork(); artworkBoth = button.dataset.artworkScope === "both"; if (artworkBoth) { view = "map"; root.querySelector<HTMLSelectElement>("#tm-view")!.value = view; } renderArtworkControls(); draw();
    }));
    bind("artwork-snap", el => { clearArtwork(); artworkSnap = (el as HTMLInputElement).checked; renderArtworkControls(); draw(); });
    bind("artwork-handles", el => { artworkMoveAreas = (el as HTMLInputElement).checked; });
    bind("bank", el => { paletteBank = Number(el.value); renderTiles(); });
    bind("grid", el => { grid = (el as HTMLInputElement).checked; draw(); });
    bind("overlays", el => { overlays = (el as HTMLInputElement).checked; if (!overlays && tool === "select") chooseTool("artwork"); else draw(); });
    bind("linked", el => { linked = (el as HTMLInputElement).checked; });
    bind("target", el => { target = el.value as Target; draw(); });
    const tools = root.querySelector<HTMLElement>(".tm-tools")!;
    tools.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(button => button.addEventListener("click", () => run(() => chooseTool(button.dataset.tool as Tool))));
    tools.addEventListener("keydown", event => {
      if (toolShortcut(event)) return;
      const index = MAP_TOOLS.findIndex(t => t.id === tool);
      const next = event.key === "ArrowRight" ? (index + 1) % MAP_TOOLS.length : event.key === "ArrowLeft" ? (index + MAP_TOOLS.length - 1) % MAP_TOOLS.length : event.key === "Home" ? 0 : event.key === "End" ? MAP_TOOLS.length - 1 : -1;
      if (next < 0 || busy) return;
      event.preventDefault(); chooseTool(MAP_TOOLS[next].id); tools.querySelector<HTMLButtonElement>(`[data-tool="${MAP_TOOLS[next].id}"]`)!.focus({ preventScroll: true });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(button => button.addEventListener("click", () => {
      zoom = Number(button.dataset.zoom); root.querySelector<HTMLCanvasElement>(".tm-map")!.style.width = `${zoom * 100}%`;
      root.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.zoom) === zoom)));
    }));
    bind("color", el => change(() => {
      const set = tileSet(), c = el.value, at = paletteBank * (set.bitsPerPixel === 8 ? 256 : 16) + colorId;
      set.palette[at] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]; writeSet(set); rebuildEffects();
    }, false));
    root.querySelector<HTMLInputElement>(".tm-search")!.addEventListener("input", event => { search = (event.target as HTMLInputElement).value; renderTables(); });
    root.querySelector<HTMLInputElement>("#tm-file")!.addEventListener("change", event => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) void importImage(file); (event.target as HTMLInputElement).value = ""; });
    installCanvas(); rebuildEffects(); refresh();
    timer = setInterval(() => { if (stopped) return; tick++; if (isSprite() || view === "habitat") draw(); }, 1000 / 30);
  }
  function refresh(inspector = true) {
    if (stopped) return; layerCanvases.clear(); selected = Math.max(0, Math.min(selected, draft.areas.length - 1));
    const capacity = townMapCapacity(draft);
    root.querySelector(".tm-count")!.textContent = `${draft.areas.length} / 128 areas · ${capacity.mapActors} / 128 actors · ${capacity.mapSprites} / 124 sprites · ${Math.ceil(capacity.mapHeapBytes / 1024)} / 384 KiB`;
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !history.canUndo;
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !history.canRedo;
    root.querySelector<HTMLButtonElement>('[data-action="remove"]')!.disabled = selected < 85;
    root.querySelector<HTMLButtonElement>('[data-action="add"]')!.disabled = draft.areas.length >= 128;
    root.querySelector<HTMLButtonElement>('[data-action="import"]')!.disabled = isSprite();
    renderArtworkControls(); renderTables(); renderTiles(); draw(); if (inspector) renderInspector();
    const add = root.querySelector<HTMLSelectElement>("#tm-add-zone")!, old = add.value;
    add.innerHTML = Object.values(project.headers?.rows ?? {}).filter(h => !draft.areas.some(a => a.zone === h.index)).map(h => `<option value="${h.index}">${esc(h.location_name)} · ${h.index}</option>`).join("");
    if ([...add.options].some(o => o.value === old)) add.value = old;
  }
  function renderTables() {
    const entries = draft.areas.map((area, i) => ({ area, i })).filter(({ area }) => `${areaName(area)} ${area.zone}`.toLowerCase().includes(search.toLowerCase()));
    root.querySelector(".tm-areas")!.innerHTML = `<table class="tm-table"><thead><tr><th>Area</th><th>Map</th><th>Type</th><th>X</th><th>Y</th></tr></thead><tbody>${entries.map(({ area: a, i }) => `<tr data-area="${i}" class="${i === selected ? "-selected" : ""}" tabindex="0" aria-selected="${i === selected}"><td>${esc(areaName(a))}</td><td>${a.zone}</td><td>${esc(TOWN_MAP_TYPES[a.type] ?? a.type)}</td><td>${a.position.x}</td><td>${a.position.y}</td></tr>`).join("")}</tbody></table>`;
    root.querySelectorAll<HTMLElement>("[data-area]").forEach(row => {
      const select = () => { selected = Number(row.dataset.area); renderTables(); renderInspector(); draw(); };
      row.addEventListener("click", select); row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    });
  }
  function getPath(a: TownMapArea, path: string): number { return path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], a) as number; }
  function setPath(a: TownMapArea, path: string, value: number) { const keys = path.split("."), last = keys.pop()!; const obj = keys.reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], a) as Record<string, unknown>; obj[last] = value; }
  function field(label: string, path: string, min = 0, max = 65535) {
    return `<label>${esc(label)}<input class="filter-input" data-field="${path}" type="number" min="${min}" max="${max}" step="1" value="${getPath(draft.areas[selected], path)}" /></label>`;
  }
  function condition(label: string, path: "arrivalFlag" | "visibilityFlag") {
    const value = draft.areas[selected][path], special = TOWN_MAP_CONDITIONS.some(c => c.value === value);
    return `<label>${label}<select class="filter-input" data-condition="${path}"><option value="event" ${!special ? "selected" : ""}>Event flag</option>${TOWN_MAP_CONDITIONS.filter(c => path !== "arrivalFlag" || c.value !== 61443).map(c => `<option value="${c.value}" ${c.value === value ? "selected" : ""}>${path === "arrivalFlag" && c.value === 65535 ? "No visit flag" : c.label}</option>`).join("")}</select></label>${field("Flag ID", path)}`;
  }
  function renderInspector() {
    const a = draft.areas[selected];
    root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.inspectorTab === inspectorTab)));
    root.querySelector<HTMLElement>(".tm-fields-host")!.hidden = inspectorTab !== "area";
    root.querySelector<HTMLElement>(".tm-texts")!.hidden = inspectorTab !== "text";
    root.querySelector<HTMLButtonElement>('[data-action="disable"]')!.textContent = a.visibilityFlag === 61443 ? "Enable area" : "Disable area";
    root.querySelector(".tm-area-title")!.textContent = `${areaName(a)} · record ${selected + 1}`;
    root.querySelector(".tm-fields-host")!.innerHTML = `<div class="tm-fields"><label class="tm-wide">Map header<select class="filter-input" data-field="zone">${Object.values(project.headers?.rows ?? {}).map(h => `<option value="${h.index}" ${h.index === a.zone ? "selected" : ""}>${esc(h.location_name)} · ${h.index}</option>`).join("")}</select></label>
      <label>Place type<select class="filter-input" data-field="type">${TOWN_MAP_TYPES.map((name, i) => `<option value="${i}" ${a.type === i ? "selected" : ""}>${name}</option>`).join("")}</select></label>${field("Selection radius", "radius")}
      <fieldset><legend>Marker</legend>${field("X", "position.x")}${field("Y", "position.y")}</fieldset><fieldset><legend>Cursor</legend>${field("X", "cursor.x")}${field("Y", "cursor.y")}</fieldset>
      <fieldset><legend>Touch capsule</legend>${field("Start X", "hit.start.x")}${field("Start Y", "hit.start.y")}${field("End X", "hit.end.x")}${field("End Y", "hit.end.y")}${field("Radius", "hit.radius")}</fieldset>
      <fieldset><legend>Conditions</legend>${condition("Shown when", "visibilityFlag")}${condition("Visited when", "arrivalFlag")}</fieldset><fieldset><legend>Pokédex highlight</legend>${field("Animation", "habitat.animation")}${field("X", "habitat.x", -32768, 32767)}${field("Y", "habitat.y", -32768, 32767)}</fieldset></div>
      <details><summary>Raw fields</summary><div class="tm-fields">${field("Unknown 13", "unknown13")}${field("Unknown 14", "unknown14")}</div></details>`;
    const references = [a.description, ...a.landmarks];
    root.querySelector(".tm-texts")!.innerHTML = `<label class="tm-shared"><input id="tm-shared" type="checkbox" />Edit shared text</label>${references.map((id, slot) => `<label>${slot ? `Landmark ${slot}` : "Description"}<textarea class="filter-input" data-text-slot="${slot}" aria-label="${slot ? `Landmark ${slot}` : "Description"}">${esc((draft.texts[id]?.[1] ?? "").replace(/\\n/gu, "\n"))}</textarea><span>Text ${id === 65535 ? "—" : id}</span></label>`).join("")}`;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach(input => input.addEventListener("change", () => change(() => {
      const value = Number(input.value); if (!input.value.trim() || !Number.isInteger(value) || !input.checkValidity()) throw new Error("Enter a whole number within the field's range.");
      if (input.dataset.field === "zone" && draft.areas.some((other, i) => i !== selected && other.zone === value)) throw new Error("That header already has a Town Map area.");
      setPath(draft.areas[selected], input.dataset.field!, value);
    })));
    root.querySelectorAll<HTMLSelectElement>("[data-condition]").forEach(input => input.addEventListener("change", () => change(() => { draft.areas[selected][input.dataset.condition as "arrivalFlag" | "visibilityFlag"] = input.value === "event" ? 1 : Number(input.value); })));
    root.querySelectorAll<HTMLTextAreaElement>("[data-text-slot]").forEach(input => input.addEventListener("change", () => change(() => editTownMapText(draft, selected, Number(input.dataset.textSlot), input.value, root.querySelector<HTMLInputElement>("#tm-shared")!.checked))));

  }
  function draw() {
    const canvas = root.querySelector<HTMLCanvasElement>(".tm-map"); if (!canvas || !draft) return;
    const ctx = canvas.getContext("2d")!; canvas.width = canvas.height = 256; ctx.clearRect(0, 0, 256, 256);
    if (isSprite()) {
      const frames = effects?.sequences[sequence]?.frames, frame = frames?.[tick % (frames?.length || 1)];
      if (frame) imageToCanvas(canvas, frame.width, frame.height, frame.rgba);
      return;
    }
    const layers = view === "layer" ? [selectedLayer()] : TOWN_MAP_LAYERS.slice(0, 2);
    const preview = artworkGesture?.kind === "move" ? artworkGesture.preview : artworkPaste;
    for (const layer of layers) {
      const stamp = preview?.canvases.get(layer.screen);
      if (stamp && preview) {
        const working = document.createElement("canvas"); working.width = working.height = 256;
        const layerCtx = working.getContext("2d")!; layerCtx.drawImage(layerBitmap(layer), 0, 0);
        if (artworkGesture?.kind === "move") { const r = preview.clip.source; layerCtx.clearRect(r.x, r.y, r.width, r.height); }
        layerCtx.drawImage(stamp, preview.destination.x, preview.destination.y); ctx.drawImage(working, 0, 0);
      } else ctx.drawImage(layerBitmap(layer), 0, 0);
    }
    if (view === "habitat") {
      const a = draft.areas[selected], frames = habitatEffect?.sequences[a.habitat.animation]?.frames, frame = frames?.[tick % (frames?.length || 1)];
      if (frame) { const c = document.createElement("canvas"); imageToCanvas(c, frame.width, frame.height, frame.rgba); ctx.drawImage(c, a.habitat.x - 128, a.habitat.y - 128); }
    }
    if (grid) { ctx.strokeStyle = "#ffffff23"; ctx.lineWidth = .4; ctx.beginPath(); for (let i = 0; i <= 256; i += 8) { ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.moveTo(0, i); ctx.lineTo(256, i); } ctx.stroke(); }
    if (overlays) draft.areas.forEach((a, i) => {
      ctx.save();
      if (artworkGesture?.kind === "move" && artworkGesture.moveAreas && artworkGesture.areas.includes(i)) {
        const p = artworkGesture.preview; ctx.translate(p.destination.x - p.clip.source.x, p.destination.y - p.clip.source.y);
      }
      const chosen = i === selected; ctx.strokeStyle = chosen ? "#ffce62" : "#49d4c099"; ctx.fillStyle = chosen ? "#ffce62" : "#49d4c0"; ctx.lineWidth = chosen ? 1 : .5;
      if (chosen) {
        ctx.save(); ctx.lineCap = "round"; ctx.lineWidth = Math.max(1, a.hit.radius * 2); ctx.strokeStyle = "#ffce6238"; ctx.beginPath(); ctx.moveTo(a.hit.start.x, a.hit.start.y); ctx.lineTo(a.hit.end.x + .01, a.hit.end.y); ctx.stroke(); ctx.restore();
        for (const p of [a.hit.start, a.hit.end]) ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
        ctx.strokeRect(a.cursor.x - 3, a.cursor.y - 3, 6, 6);
        if (tool === "select") { ctx.beginPath(); ctx.arc(a.position.x, a.position.y, a.radius, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.beginPath(); ctx.arc(a.position.x, a.position.y, chosen ? 2.5 : 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    const rect = preview ? { ...preview.clip.source, ...preview.destination } : artworkGesture?.kind === "select" ? artworkGesture.rect : artworkSelection;
    if (rect && tool === "artwork") {
      ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = "#10151c"; ctx.strokeRect(rect.x + .5, rect.y + .5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1));
      ctx.setLineDash([2, 2]); ctx.strokeStyle = preview ? "#ffce62" : "#8be9fd"; ctx.strokeRect(rect.x + .5, rect.y + .5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1)); ctx.restore();
    }
  }
  function renderTiles() {
    const set = tileSet(), bankSize = set.bitsPerPixel === 8 ? 256 : 16;
    tileId = Math.min(tileId, set.tiles.length - 1); paletteBank = Math.min(paletteBank, Math.floor(set.palette.length / bankSize) - 1);
    const bank = root.querySelector<HTMLSelectElement>("#tm-bank")!;
    bank.innerHTML = Array.from({ length: Math.min(16, set.palette.length / bankSize) }, (_, i) => `<option value="${i}">${i}</option>`).join(""); bank.value = String(paletteBank);
    const canvas = root.querySelector<HTMLCanvasElement>(".tm-tiles")!, width = 256, height = Math.ceil(set.tiles.length / 32) * 8, rgba = new Uint8ClampedArray(width * height * 4);
    set.tiles.forEach((tile, t) => { for (let p = 0; p < 64; p++) { const at = (((t >> 5) * 8 + (p >> 3)) * width + (t % 32) * 8 + (p & 7)) * 4; const c = set.palette[paletteBank * bankSize + tile[p]] ?? [0, 0, 0, 0]; rgba.set(tile[p] ? c : [0, 0, 0, 0], at); } });
    imageToCanvas(canvas, width, height, rgba); const ctx = canvas.getContext("2d")!; ctx.strokeStyle = "#ffce62"; ctx.lineWidth = 1; ctx.strokeRect((tileId % 32) * 8 + .5, (tileId >> 5) * 8 + .5, 7, 7);
    const pixel = new Uint8ClampedArray(256); for (let p = 0; p < 64; p++) pixel.set(set.palette[paletteBank * bankSize + set.tiles[tileId][p]] ?? [0, 0, 0, 0], p * 4);
    imageToCanvas(root.querySelector<HTMLCanvasElement>(".tm-pixel")!, 8, 8, pixel);
    root.querySelector(".tm-tile-count")!.textContent = `${set.tiles.length}${isSprite() ? "" : ` / ${selectedLayer().maxTiles}`} tiles · ${set.palette.length} colors`;
    root.querySelector(".tm-tile-selected")!.textContent = `Tile ${tileId}`;
    root.querySelector(".tm-palette")!.innerHTML = set.palette.slice(paletteBank * bankSize, (paletteBank + 1) * bankSize).map((c, i) => `<button type="button" style="background:rgb(${c.slice(0, 3).join(",")})" data-color="${i}" class="${i === colorId ? "-selected" : ""}" aria-label="Color ${i}"></button>`).join("");
    const c = set.palette[paletteBank * bankSize + colorId] ?? [0, 0, 0, 255]; root.querySelector<HTMLInputElement>("#tm-color")!.value = `#${c.slice(0, 3).map(n => n.toString(16).padStart(2, "0")).join("")}`;
    root.querySelector(".tm-color-index")!.textContent = `Index ${colorId}`;
    root.querySelectorAll<HTMLButtonElement>("[data-color]").forEach(b => b.addEventListener("click", () => { colorId = Number(b.dataset.color); renderTiles(); }));
    canvas.onclick = event => { const r = canvas.getBoundingClientRect(); tileId = Math.min(set.tiles.length - 1, Math.floor((event.clientY - r.top) * canvas.height / r.height / 8) * 32 + Math.floor((event.clientX - r.left) * 256 / r.width / 8)); renderTiles(); };
    const panel = root.querySelector<HTMLElement>(".tm-animation")!; panel.innerHTML = "";
    if (isSprite()) {
      const ids = spriteIds(), anim = parsePokemonAnimation(unpackTownMapResource(files().get(ids.anim)!)); sequence = Math.min(sequence, anim.sequences.length - 1);
      panel.innerHTML = `<div class="tm-controls"><label>Animation <select id="tm-sequence">${anim.sequences.map((s, i) => `<option value="${i}" ${i === sequence ? "selected" : ""}>${i} · ${s.frames.length} frames</option>`).join("")}</select></label></div><table class="tm-table"><thead><tr><th>Frame</th><th>Cell</th><th>Duration</th></tr></thead><tbody>${anim.sequences[sequence]?.frames.map((f, i) => `<tr><td>${i}</td><td><input data-frame="${i}" data-frame-key="cellIndex" type="number" min="0" value="${f.cellIndex}" /></td><td><input data-frame="${i}" data-frame-key="duration" type="number" min="1" max="65535" value="${f.duration}" /></td></tr>`).join("")}</tbody></table>`;
      panel.querySelector<HTMLSelectElement>("#tm-sequence")!.onchange = event => { sequence = Number((event.target as HTMLSelectElement).value); renderTiles(); draw(); };
      panel.querySelectorAll<HTMLInputElement>("[data-frame]").forEach(input => input.onchange = () => change(() => {
        const value = Number(input.value); if (!input.checkValidity() || !Number.isInteger(value)) throw new Error("Enter a valid frame value.");
        editTownMapAnimationFrame(files(), ids.anim, sequence, Number(input.dataset.frame), input.dataset.frameKey as "cellIndex" | "duration", value); rebuildEffects();
      }, false));
    }
  }
  function installCanvas() {
    const canvas = root.querySelector<HTMLCanvasElement>(".tm-map")!, pixels = root.querySelector<HTMLCanvasElement>(".tm-pixel")!;
    let pointer: { id: number; x: number; y: number; target: Target } | undefined;
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * 256 / r.width), y: Math.round((e.clientY - r.top) * 256 / r.height) }; };
    const artPos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(255, Math.floor((e.clientX - r.left) * 256 / r.width))), y: Math.max(0, Math.min(255, Math.floor((e.clientY - r.top) * 256 / r.height))) }; };
    function selectionBetween(a: { x: number; y: number }, b: { x: number; y: number }): TownMapArtworkRect {
      const step = artworkSnap ? 8 : 1, x = Math.floor(Math.min(a.x, b.x) / step) * step, y = Math.floor(Math.min(a.y, b.y) / step) * step;
      return { x, y, width: (Math.floor(Math.max(a.x, b.x) / step) + 1) * step - x, height: (Math.floor(Math.max(a.y, b.y) / step) + 1) * step - y };
    }
    canvas.addEventListener("pointerdown", event => run(() => {
      if (busy || isSprite() || event.button !== 0) return; const p = pos(event); canvas.focus({ preventScroll: true });
      if (tool === "artwork") {
        const point = artPos(event);
        if (artworkPaste) {
          artworkPaste.destination = artworkDestination(artworkPaste.clip, point.x - artworkPaste.clip.source.width / 2, point.y - artworkPaste.clip.source.height / 2);
          commitArtworkPaste(); return;
        }
        const r = artworkSelection;
        if (r && !event.shiftKey && point.x >= r.x && point.y >= r.y && point.x < r.x + r.width && point.y < r.y + r.height) {
          const clip = captureTownMapArtwork(draft.graphics, artworkLayers(), r);
          artworkGesture = { kind: "move", id: event.pointerId, start: point, preview: makeArtworkPreview(clip, { x: r.x, y: r.y }), moveAreas: artworkMoveAreas, areas: townMapArtworkAreas(draft.areas, r) };
        } else artworkGesture = { kind: "select", id: event.pointerId, start: point, rect: selectionBetween(point, point) };
        canvas.setPointerCapture(event.pointerId); renderArtworkControls(); draw(); return;
      }
      if (tool !== "select") {
        const at = Math.floor(p.y / 8) * 32 + Math.floor(p.x / 8); if (p.x < 0 || p.x >= 256 || p.y < 0 || p.y >= 256) return;
        const image = readTownMapLayer(draft.graphics, selectedLayer());
        if (tool === "pick") { tileId = image.indexed.entries[at] & 1023; paletteBank = image.indexed.entries[at] >>> 12; renderTiles(); return; }
        change(() => { const value = tileId | paletteBank << 12; if (tool === "fill") fillTownMapTiles(image.indexed.entries, at, value); else image.indexed.entries[at] = value; writeTownMapLayer(draft.graphics, selectedLayer(), image); }, false); return;
      }
      const current = draft.areas[selected]; let dragTarget = target;
      const handles: Array<[Target, { x: number; y: number }]> = [["hitStart", current.hit.start], ["hitEnd", current.hit.end], ["cursor", current.cursor]];
      const handle = handles.find(([, point]) => Math.hypot(point.x - p.x, point.y - p.y) < 4); if (handle) dragTarget = handle[0];
      else {
        const hits = draft.areas.map((a, i) => ({ a, i, d: Math.hypot(a.position.x - p.x, a.position.y - p.y) })).filter(v => v.d < 6 || townMapHit(v.a, p.x, p.y)).sort((a, b) => a.d - b.d);
        if (hits.length) selected = hits[0].i; else if (target !== "habitat") return;
      }
      history.checkpoint(draft); pointer = { id: event.pointerId, ...p, target: view === "habitat" ? "habitat" : dragTarget }; canvas.setPointerCapture(event.pointerId); renderTables(); renderInspector(); draw();
    }));
    canvas.addEventListener("pointermove", event => run(() => { const p = pos(event); root.querySelector(".tm-readout")!.textContent = `${p.x}, ${p.y}`;
      if (tool === "artwork") {
        const point = artPos(event), gesture = artworkGesture;
        if (artworkPaste) { artworkPaste.destination = artworkDestination(artworkPaste.clip, point.x - artworkPaste.clip.source.width / 2, point.y - artworkPaste.clip.source.height / 2); draw(); return; }
        if (gesture?.id === event.pointerId) {
          if (gesture.kind === "select") gesture.rect = selectionBetween(gesture.start, point);
          else gesture.preview.destination = artworkDestination(gesture.preview.clip, gesture.preview.clip.source.x + point.x - gesture.start.x, gesture.preview.clip.source.y + point.y - gesture.start.y);
          renderArtworkControls(); draw();
        }
        const r = artworkSelection; canvas.style.cursor = r && point.x >= r.x && point.y >= r.y && point.x < r.x + r.width && point.y < r.y + r.height ? "move" : "crosshair";
        return;
      }
      if (!pointer || pointer.id !== event.pointerId) return;
      moveTownMapArea(draft.areas[selected], p.x - pointer.x, p.y - pointer.y, linked, pointer.target); pointer.x = p.x; pointer.y = p.y; draw(); }));
    const finish = (event: PointerEvent) => {
      const gesture = artworkGesture;
      if (gesture && gesture.id === event.pointerId) {
        artworkGesture = undefined;
        if (gesture.kind === "select") {
          artworkSelection = gesture.rect;
          const areas = townMapArtworkAreas(draft.areas, gesture.rect);
          if (areas.length === 1) { selected = areas[0]; renderTables(); renderInspector(); }
          renderArtworkControls(); draw();
        } else if (gesture.preview.destination.x !== gesture.preview.clip.source.x || gesture.preview.destination.y !== gesture.preview.clip.source.y) {
          const { clip, destination } = gesture.preview;
          change(() => { placeTownMapArtwork(draft, clip, destination, { move: true, moveAreas: gesture.moveAreas }); artworkSelection = { ...clip.source, ...destination }; });
        } else { renderArtworkControls(); draw(); }
        return;
      }
      if (!pointer) return; pointer = undefined; refresh(); status("Draft changed");
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", event => {
      artworkGesture = undefined;
      if (pointer?.id === event.pointerId) { pointer = undefined; refresh(); status("Draft changed"); }
      else { renderArtworkControls(); draw(); }
    });
    canvas.addEventListener("lostpointercapture", () => { if (artworkGesture) { artworkGesture = undefined; renderArtworkControls(); draw(); } });
    canvas.addEventListener("keydown", event => {
      if (toolShortcut(event)) return;
      if (tool === "artwork") {
        const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
        if (command && (key === "c" || key === "v")) { event.preventDefault(); action(key === "c" ? "artCopy" : "artPaste"); return; }
        if (event.key === "Escape") { event.preventDefault(); clearArtwork(); renderArtworkControls(); draw(); return; }
        if (event.key === "Enter" && artworkPaste) { event.preventDefault(); commitArtworkPaste(); return; }
        if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); action("artClear"); return; }
        if (command && key === "a") { event.preventDefault(); artworkPaste = undefined; artworkGesture = undefined; artworkSelection = { x: 0, y: 0, width: 256, height: 256 }; renderArtworkControls(); draw(); return; }
      }
      const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (delta[event.key]) { event.preventDefault(); const [x, y] = delta[event.key], step = event.shiftKey || artworkSnap && tool === "artwork" ? 8 : 1;
        if (tool === "artwork") {
          moveArtwork(x * step, y * step);
        } else if (tool === "select") change(() => moveTownMapArea(draft.areas[selected], x * step, y * step, linked, target));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); action(event.shiftKey ? "redo" : "undo"); }
    });
    let painting = false;
    function paint(event: PointerEvent) { const r = pixels.getBoundingClientRect(), x = Math.floor((event.clientX - r.left) * 8 / r.width), y = Math.floor((event.clientY - r.top) * 8 / r.height); if (x < 0 || x > 7 || y < 0 || y > 7) return;
      const set = tileSet(); set.tiles[tileId][y * 8 + x] = colorId; writeSet(set); renderTiles(); draw(); }
    pixels.addEventListener("pointerdown", event => run(() => { if (busy) return; history.checkpoint(draft); painting = true; pixels.setPointerCapture(event.pointerId); paint(event); }));
    pixels.addEventListener("pointermove", event => { if (painting) run(() => paint(event)); });
    const endPaint = () => { if (!painting) return; painting = false; rebuildEffects(); refresh(false); status("Draft changed"); }; pixels.addEventListener("pointerup", endPaint); pixels.addEventListener("pointercancel", endPaint);
  }
  async function importImage(file: File) {
    clearImport();
    const request = importRequest, layer = selectedLayer();
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("Image exceeds 16 MiB.");
      const image = await createImageBitmap(file);
      if (stopped || request !== importRequest) { image.close(); return; }
      if (image.width !== 256 || image.height !== 256) { image.close(); throw new Error("Use a 256 × 256 image for this native map layer."); }
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d")!.drawImage(image, 0, 0); image.close();
      pendingImport = convertTownMapImage(readTownMapLayer(draft.graphics, layer), canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, layer.maxTiles);
      const host = root.querySelector<HTMLElement>(".tm-import-host")!; host.innerHTML = `<div class="tm-import"><canvas></canvas><div><p>${pendingImport.tiles} / ${layer.maxTiles} tiles · ${pendingImport.paletteBanks} palette banks</p><p>${pendingImport.changedPixels} pixels mapped · palette unchanged</p><button class="btn -default" id="tm-accept-import">Use image</button><button class="btn -default" id="tm-cancel-import">Cancel</button></div></div>`;
      imageToCanvas(host.querySelector("canvas")!, 256, 256, renderNitroBackgroundImage(pendingImport.image));
      host.querySelector("#tm-accept-import")!.addEventListener("click", () => { const value = pendingImport; if (value && request === importRequest) change(() => writeTownMapLayer(draft.graphics, layer, value.image), false); });
      host.querySelector("#tm-cancel-import")!.addEventListener("click", clearImport);
    } catch (error) { if (!stopped && request === importRequest) status(message(error), true); }
  }

  function download(canvas: HTMLCanvasElement, name: string) { canvas.toBlob(blob => { if (!blob || stopped) return; const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, "image/png"); }
  function action(name: string) {
    if (busy) return;
    run(() => {
      if (name.startsWith("art")) {
        if (tool !== "artwork" || isSprite()) return;
        const canvas = root.querySelector<HTMLCanvasElement>(".tm-map")!;
        if (name === "artCopy" && artworkSelection) {
          artworkClipboard = captureTownMapArtwork(draft.graphics, artworkLayers(), artworkSelection); status("Artwork copied");
        } else if (name === "artPaste" && canPasteArtwork()) {
          artworkPaste = artworkPaste ? undefined : makeArtworkPreview(artworkClipboard!, artworkDestination(artworkClipboard!, artworkClipboard!.source.x + 8, artworkClipboard!.source.y + 8));
        } else if (name === "artNew") clearArtwork();
        else if (name === "artClear" && artworkSelection) {
          const clip = captureTownMapArtwork(draft.graphics, artworkLayers(), artworkSelection);
          change(() => placeTownMapArtwork(draft, clip, clip.source, { erase: true }), false);
        }
        renderArtworkControls(); draw(); canvas.focus({ preventScroll: true }); return;
      }
      if (name === "undo" || name === "redo") { clearArtwork(); history[name](draft); clearImport(); rebuildEffects(); refresh(); return; }
      if (["left", "right", "up", "down"].includes(name)) {
        const [x, y] = ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as Record<string, number[]>)[name];
        if (tool === "artwork") moveArtwork(x * (artworkSnap ? 8 : 1), y * (artworkSnap ? 8 : 1));
        else if (tool === "select") change(() => moveTownMapArea(draft.areas[selected], x, y, linked, target)); return;
      }
      if (name === "add") { const value = root.querySelector<HTMLSelectElement>("#tm-add-zone")!.value; if (value) change(() => { selected = appendTownMapArea(draft, selected, Number(value)); }); return; }
      if (name === "remove") { if (selected >= 85) change(() => { const [a] = draft.areas.splice(selected, 1); delete draft.landings[a.zone]; selected--; }); return; }
      if (name === "disable") { change(() => { const a = draft.areas[selected]; a.visibilityFlag = a.visibilityFlag === 61443 ? 65535 : 61443; if (a.visibilityFlag === 61443) a.fly = 0; }); return; }
      if (name === "flipX" || name === "flipY") { change(() => {
        const set = tileSet(), source = set.tiles[tileId].slice(); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set.tiles[tileId][y * 8 + x] = source[(name === "flipY" ? 7 - y : y) * 8 + (name === "flipX" ? 7 - x : x)]; writeSet(set); rebuildEffects();
      }, false); return; }
      if (name === "import") { root.querySelector<HTMLInputElement>("#tm-file")!.click(); return; }
      if (name === "export") { if (isSprite()) download(root.querySelector<HTMLCanvasElement>(".tm-tiles")!, "town-map-tiles.png"); else download(bitmap(readTownMapLayer(draft.graphics, selectedLayer())), `town-map-layer-${layerId}.png`); return; }
      if (name === "composite") { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256; TOWN_MAP_LAYERS.slice(0, 2).forEach(layer => canvas.getContext("2d")!.drawImage(layerBitmap(layer), 0, 0)); download(canvas, "town-map.png"); return; }
      if (name === "apply" || name === "reload") {
        clearArtwork(); clearImport(); busy = true; root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>("input, select, button, textarea").forEach(el => el.disabled = true); status(name === "apply" ? "Applying Town Map…" : "Reloading…");
        void (async () => {
          try { if (name === "apply") { await applyTownMapDraft(project, draft); onDirty(); } const value = await loadTownMapDraft(project); if (stopped) return; draft = value; history = new TownMapHistory(); rebuildEffects(); status(name === "apply" ? "Applied. Export the ROM to use these changes." : "Reloaded."); }
          catch (error) { if (!stopped) status(message(error), true); }
          finally { if (!stopped) { busy = false; root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>("input, select, button, textarea").forEach(el => el.disabled = false); refresh(); } }
        })();
      }
    });
  }
}
