import "../styles/townMap.css";
import { loadTownMapDraft, applyTownMapDraft, TownMapHistory, TOWN_MAP_TYPES, TOWN_MAP_CONDITIONS,
  appendTownMapArea, editTownMapText, moveTownMapArea, townMapHit, type TownMapDraft, type TownMapArea } from "../pokeweb/townMapModel";
import { TOWN_MAP_LAYERS, readTownMapLayer, writeTownMapLayer, convertTownMapImage, fillTownMapTiles,
  unpackTownMapResource, repackTownMapResource, readTownMapTileSet, writeTownMapTileSet, type TownMapImageConversion } from "../pokeweb/townMapGraphics";
import { renderNitroBackgroundImage, type NitroBackgroundImage } from "../pokeweb/nitroBg";
import { parseNitroCellEffect, type NitroCellEffect } from "../pokeweb/nitroCell";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { buildPokemonAnimationFile } from "../pokeweb/pokemonSpriteWriters";
import { getFlyDestinations, resolveFlyLandingZone, type FlyLanding } from "../pokeweb/flyDestinationModel";
import { installBw2MapPreview, type Bw2MapPreview } from "./bw2MapPreview";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const esc = (v: unknown) => escapeHtml(String(v));
type Target = "marker" | "cursor" | "hitStart" | "hitEnd" | "habitat";
export function renderTownMapEditor(project: ProjectState, root: HTMLElement, onDirty: () => void, startFly = false): () => void {
  let stopped = false, busy = false, draft: TownMapDraft, selected = 0, layerId = 0, tileId = 0, paletteBank = 0, colorId = 1;
  let tool = "select", target: Target = "marker", linked = true, grid = true, overlays = true, search = "", view = "map", sequence = 0;
  let inspectorTab = "area";
  let history = new TownMapHistory(), landingPreview: Bw2MapPreview | undefined, pendingImport: TownMapImageConversion | undefined;
  let effects: NitroCellEffect | undefined, habitatEffect: NitroCellEffect | undefined, tick = 0, timer: ReturnType<typeof setInterval> | undefined;
  root.innerHTML = `<section class="town-map-editor" aria-label="Town Map"><h1>Town Map</h1><p role="status">Loading map…</p></section>`;
  const cleanup = () => { stopped = true; landingPreview?.destroy(); if (timer) clearInterval(timer); };
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
  function change(action: () => void, inspector = true) {
    if (busy) return;
    history.checkpoint(draft);
    try { action(); pendingImport = undefined; refresh(inspector); status("Draft changed"); }
    catch (error) { history.undo(draft); status(message(error), true); }
  }
  function areaName(a: TownMapArea) { return String(project.headers?.rows[a.zone + 1]?.location_name ?? `Map ${a.zone}`); }
  function files() { return view === "habitat-art" ? draft.habitatGraphics : draft.graphics; }
  function spriteIds() { return view === "habitat-art" ? { char: 15, pal: 5, cell: 29, anim: 46 } : { char: 8, pal: 2, cell: 12, anim: 19 }; }
  function isSprite() { return view === "icons" || view === "habitat-art"; }
  function selectedLayer() { return TOWN_MAP_LAYERS[layerId]; }
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
      <header class="tm-heading"><div><h1>Town Map</h1><span class="tm-count"></span></div><a class="tm-link" href="#headers" data-route="headers">Headers &amp; Overworlds ↗</a></header>
      <div class="tm-toolbar"><button class="btn -default" data-action="import">Import image</button><button class="btn -default" data-action="export">Export layer</button><button class="btn -default" data-action="composite">Export composite</button><input id="tm-file" type="file" accept="image/png,image/bmp,.bmp" hidden />
        <button class="btn -default" data-action="undo">Undo</button><button class="btn -default" data-action="redo">Redo</button><button class="btn -default" data-action="apply">Apply</button><button class="btn -default" data-action="reload">Reload</button></div>
      <div class="tm-message" role="status" aria-live="polite"></div><div class="tm-import-host"></div>
      <div class="tm-layout"><div class="tm-art"><section class="tm-panel"><h2>Map preview</h2><div class="tm-panel-body"><div class="tm-controls">
        <select id="tm-view" aria-label="Preview"><option value="map">Composite map</option><option value="layer">Artwork layer</option><option value="habitat">Pokédex highlights</option><option value="icons">Markers &amp; animations</option><option value="habitat-art">Habitat shapes &amp; animations</option></select>
        <label><input id="tm-grid" type="checkbox" checked />Grid</label><label><input id="tm-overlays" type="checkbox" checked />Regions</label><label>Zoom <select id="tm-zoom"><option value="1">1×</option><option value="2">2×</option></select></label></div>
        <div class="tm-viewport"><canvas class="tm-map" width="256" height="256" tabindex="0" aria-label="Town Map editing canvas"></canvas></div>
        <div class="tm-controls"><select id="tm-target" aria-label="Move target"><option value="marker">Marker</option><option value="cursor">Cursor</option><option value="hitStart">Touch start</option><option value="hitEnd">Touch end</option><option value="habitat">Habitat</option></select><label><input id="tm-linked" type="checkbox" checked />Move together</label><span class="tm-readout"></span></div>
        <div class="tm-controls"><label>Tool <select id="tm-tool"><option value="select">Select / move</option><option value="paint">Paint tiles</option><option value="fill">Fill tiles</option><option value="pick">Pick tile</option></select></label><button data-action="left" aria-label="Move left">←</button><button data-action="up" aria-label="Move up">↑</button><button data-action="down" aria-label="Move down">↓</button><button data-action="right" aria-label="Move right">→</button></div>
        <div class="tm-controls"><label>Layer <select id="tm-layer">${TOWN_MAP_LAYERS.map((l, i) => `<option value="${i}">${esc(l.label)}</option>`).join("")}</select></label><label>Palette <select id="tm-bank"></select></label><button data-action="flipX">Flip X</button><button data-action="flipY">Flip Y</button></div>
        <div class="tm-tiles-wrap"><canvas class="tm-tiles" aria-label="Tile palette"></canvas></div><div class="tm-status"><span class="tm-tile-count"></span><span class="tm-tile-selected"></span></div>
        <div class="tm-pixel-row"><canvas class="tm-pixel" width="8" height="8" aria-label="Selected tile pixel editor"></canvas><div style="flex:1;min-width:150px"><div class="tm-palette" aria-label="Colors"></div><div class="tm-controls"><label>Color <input id="tm-color" type="color" /></label><span class="tm-color-index"></span></div></div></div><div class="tm-animation"></div>
      </div></section></div>
      <div class="tm-data"><section class="tm-panel"><h2>Areas</h2><div class="tm-panel-body"><input class="filter-input tm-search" type="search" aria-label="Find an area" placeholder="Area name or map ID" /><div class="tm-table-wrap tm-areas"></div><div class="tm-controls"><select class="tm-add" id="tm-add-zone" aria-label="New area map header"></select><button data-action="add">Add / duplicate area</button><button data-action="remove">Remove appended area</button></div></div></section>
      <section class="tm-panel tm-landing"><h2>Fly destinations</h2><div class="tm-table-wrap tm-flights"></div><div class="tm-panel-body tm-fly-form"></div><div class="tm-landing-preview bw2-script-map"></div></section></div>
      <section class="tm-panel tm-inspector"><h2 class="tm-area-title">Area</h2><div class="tm-controls tm-inspector-tabs"><button class="btn -default" data-inspector-tab="area">Area</button><button class="btn -default" data-inspector-tab="text">Description &amp; landmarks</button><button class="btn -default" data-action="disable">Disable area</button></div><div class="tm-panel-body"><div class="tm-fields-host"></div><div class="tm-texts"></div></div></section></div></section>`;
    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => button.addEventListener("click", () => action(button.dataset.action!)));
    root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach(button => button.addEventListener("click", () => { inspectorTab = button.dataset.inspectorTab!; renderInspector(); }));
    const bind = (id: string, listener: (el: HTMLInputElement | HTMLSelectElement) => void) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#tm-${id}`)!.addEventListener("change", event => run(() => listener(event.target as HTMLInputElement)));
    bind("view", el => { view = el.value; tileId = paletteBank = sequence = 0; rebuildEffects(); refresh(); });
    bind("layer", el => { layerId = Number(el.value); tileId = paletteBank = 0; refresh(false); });
    bind("bank", el => { paletteBank = Number(el.value); renderTiles(); });
    bind("grid", el => { grid = (el as HTMLInputElement).checked; draw(); });
    bind("overlays", el => { overlays = (el as HTMLInputElement).checked; draw(); });
    bind("linked", el => { linked = (el as HTMLInputElement).checked; });
    bind("target", el => { target = el.value as Target; draw(); });
    bind("tool", el => { tool = el.value; });
    bind("zoom", el => { const canvas = root.querySelector<HTMLCanvasElement>(".tm-map")!; canvas.style.width = `${Number(el.value) * 100}%`; });
    bind("color", el => change(() => {
      const set = tileSet(), c = el.value, at = paletteBank * (set.bitsPerPixel === 8 ? 256 : 16) + colorId;
      set.palette[at] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]; writeSet(set); rebuildEffects();
    }, false));
    root.querySelector<HTMLInputElement>(".tm-search")!.addEventListener("input", event => { search = (event.target as HTMLInputElement).value; renderTables(); });
    root.querySelector<HTMLInputElement>("#tm-file")!.addEventListener("change", event => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) void importImage(file); (event.target as HTMLInputElement).value = ""; });
    installCanvas(); rebuildEffects(); refresh();
    timer = setInterval(() => { if (stopped) return; tick++; if (isSprite() || view === "habitat") draw(); }, 1000 / 30);
    if (startFly) root.querySelector(".tm-landing")?.scrollIntoView({ block: "nearest" });
  }
  function refresh(inspector = true) {
    if (stopped) return; selected = Math.max(0, Math.min(selected, draft.areas.length - 1));
    root.querySelector(".tm-count")!.textContent = `${draft.areas.length} / 128 areas`;
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !history.canUndo;
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !history.canRedo;
    root.querySelector<HTMLButtonElement>('[data-action="remove"]')!.disabled = selected < 85;
    root.querySelector<HTMLButtonElement>('[data-action="add"]')!.disabled = draft.areas.length >= 128;
    root.querySelector<HTMLButtonElement>('[data-action="import"]')!.disabled = isSprite();
    renderTables(); renderTiles(); draw(); if (inspector) renderInspector();
    const add = root.querySelector<HTMLSelectElement>("#tm-add-zone")!, old = add.value;
    add.innerHTML = Object.values(project.headers?.rows ?? {}).filter(h => !draft.areas.some(a => a.zone === h.index)).map(h => `<option value="${h.index}">${esc(h.location_name)} · ${h.index}</option>`).join("");
    if ([...add.options].some(o => o.value === old)) add.value = old;
  }
  function renderTables() {
    const entries = draft.areas.map((area, i) => ({ area, i })).filter(({ area }) => `${areaName(area)} ${area.zone}`.toLowerCase().includes(search.toLowerCase()));
    root.querySelector(".tm-areas")!.innerHTML = `<table class="tm-table"><thead><tr><th>Area</th><th>Map</th><th>Type</th><th>X</th><th>Y</th></tr></thead><tbody>${entries.map(({ area: a, i }) => `<tr data-area="${i}" class="${i === selected ? "-selected" : ""}" tabindex="0" aria-selected="${i === selected}"><td>${esc(areaName(a))}</td><td>${a.zone}</td><td>${esc(TOWN_MAP_TYPES[a.type] ?? a.type)}</td><td>${a.position.x}</td><td>${a.position.y}</td></tr>`).join("")}</tbody></table>`;
    root.querySelector(".tm-flights")!.innerHTML = `<table class="tm-table"><thead><tr><th>Area</th><th>Fly</th><th>Visit flag</th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>${entries.map(({ area: a, i }) => { const p = landing(a); return `<tr data-area="${i}" class="${i === selected ? "-selected" : ""}" tabindex="0" aria-selected="${i === selected}"><td>${esc(areaName(a))}</td><td>${a.fly ? "●" : "—"}</td><td>${a.arrivalFlag === 65535 ? "—" : a.arrivalFlag}</td><td>${p.x}</td><td>${p.y}</td><td>${p.z}</td></tr>`; }).join("")}</tbody></table>`;
    root.querySelectorAll<HTMLElement>("[data-area]").forEach(row => {
      const select = () => { selected = Number(row.dataset.area); renderTables(); renderInspector(); draw(); };
      row.addEventListener("click", select); row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    });
  }
  function landing(a: TownMapArea): FlyLanding {
    const h = project.headers?.rows[resolveFlyLandingZone(project, a.zone === 490 ? 326 : a.zone) + 1];
    return draft.landings[a.zone] ?? { x: Number(h?.fly_x ?? 0) | 0, y: Number(h?.fly_y ?? 0) | 0, z: Number(h?.fly_z ?? 0) | 0 };
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
      <fieldset><legend>Visibility</legend>${condition("Shown when", "visibilityFlag")}</fieldset><fieldset><legend>Pokédex highlight</legend>${field("Animation", "habitat.animation")}${field("X", "habitat.x", -32768, 32767)}${field("Y", "habitat.y", -32768, 32767)}</fieldset></div>
      <details><summary>Raw fields</summary><div class="tm-fields">${field("Unknown 13", "unknown13")}${field("Unknown 14", "unknown14")}</div></details>`;
    const references = [a.description, ...a.landmarks];
    root.querySelector(".tm-texts")!.innerHTML = `<label class="tm-shared"><input id="tm-shared" type="checkbox" />Edit shared text</label>${references.map((id, slot) => `<label>${slot ? `Landmark ${slot}` : "Description"}<textarea class="filter-input" data-text-slot="${slot}" aria-label="${slot ? `Landmark ${slot}` : "Description"}">${esc((draft.texts[id]?.[1] ?? "").replace(/\\n/gu, "\n"))}</textarea><span>Text ${id === 65535 ? "—" : id}</span></label>`).join("")}`;
    root.querySelector(".tm-fly-form")!.innerHTML = `<div class="tm-fields"><label class="tm-wide"><span><input id="tm-fly-enabled" type="checkbox" ${a.fly ? "checked" : ""} />Enable Fly</span></label>${condition("Visit condition", "arrivalFlag")}${(["x", "y", "z"] as const).map(axis => `<label>${esc(axis.toUpperCase())}<input class="filter-input" data-landing="${axis}" type="number" step="1" value="${landing(a)[axis]}" /></label>`).join("")}</div>`;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach(input => input.addEventListener("change", () => change(() => {
      const value = Number(input.value); if (!input.value.trim() || !Number.isInteger(value) || !input.checkValidity()) throw new Error("Enter a whole number within the field's range.");
      if (input.dataset.field === "zone" && draft.areas.some((other, i) => i !== selected && other.zone === value)) throw new Error("That header already has a Town Map area.");
      setPath(draft.areas[selected], input.dataset.field!, value);
    })));
    root.querySelectorAll<HTMLSelectElement>("[data-condition]").forEach(input => input.addEventListener("change", () => change(() => { draft.areas[selected][input.dataset.condition as "arrivalFlag" | "visibilityFlag"] = input.value === "event" ? 1 : Number(input.value); })));
    root.querySelectorAll<HTMLTextAreaElement>("[data-text-slot]").forEach(input => input.addEventListener("change", () => change(() => editTownMapText(draft, selected, Number(input.dataset.textSlot), input.value, root.querySelector<HTMLInputElement>("#tm-shared")!.checked))));
    root.querySelector<HTMLInputElement>("#tm-fly-enabled")!.addEventListener("change", event => change(() => {
      const enabled = (event.target as HTMLInputElement).checked; a.fly = Number(enabled);
      const suggestion = getFlyDestinations(project).find(d => d.zone === a.zone)?.suggestedVisitFlag;
      if (enabled && a.arrivalFlag === 65535 && suggestion !== undefined) a.arrivalFlag = suggestion;
    }));
    root.querySelectorAll<HTMLInputElement>("[data-landing]").forEach(input => input.addEventListener("change", () => change(() => {
      const value = Number(input.value); if (!input.value.trim() || !Number.isInteger(value)) throw new Error("Landing coordinates must be whole numbers.");
      draft.landings[a.zone] = { ...landing(a), [input.dataset.landing!]: value };
    })));
    landingPreview?.destroy();
    const zone = resolveFlyLandingZone(project, a.zone === 490 ? 326 : a.zone), h = project.headers?.rows[zone + 1];
    const destination = getFlyDestinations(project).find(d => d.zone === a.zone), rail = destination?.coordinateKind === "rail";
    root.querySelectorAll<HTMLInputElement>("[data-landing]").forEach((input, i) => { input.parentElement!.firstChild!.textContent = rail ? ["Rail component", "Position along rail", "Side offset"][i] : ["X", "Y (height)", "Z"][i]; });
    landingPreview = installBw2MapPreview(project, root.querySelector<HTMLElement>(".tm-landing-preview")!, {
      choices: h ? [{ headerRowId: zone + 1, zoneId: zone, overworldId: Number(h.overworlds_id ?? h.map_id), label: `${h.location_name} · ${zone}`, header: h }] : [],
      emptyMessage: "No destination map.", landing: { coordinates: rail ? undefined : landing(a), message: rail ? "Rail component · position · side offset" : `Fly landing · ${zone}` },
    });
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
    for (const layer of layers) ctx.drawImage(bitmap(readTownMapLayer(draft.graphics, layer)), 0, 0);
    if (view === "habitat") {
      const a = draft.areas[selected], frames = habitatEffect?.sequences[a.habitat.animation]?.frames, frame = frames?.[tick % (frames?.length || 1)];
      if (frame) { const c = document.createElement("canvas"); imageToCanvas(c, frame.width, frame.height, frame.rgba); ctx.drawImage(c, a.habitat.x - 128, a.habitat.y - 128); }
    }
    if (grid) { ctx.strokeStyle = "#ffffff23"; ctx.lineWidth = .4; ctx.beginPath(); for (let i = 0; i <= 256; i += 8) { ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.moveTo(0, i); ctx.lineTo(256, i); } ctx.stroke(); }
    if (overlays) draft.areas.forEach((a, i) => {
      const chosen = i === selected; ctx.strokeStyle = chosen ? "#ffce62" : "#49d4c099"; ctx.fillStyle = chosen ? "#ffce62" : "#49d4c0"; ctx.lineWidth = chosen ? 1 : .5;
      if (chosen) {
        ctx.save(); ctx.lineCap = "round"; ctx.lineWidth = Math.max(1, a.hit.radius * 2); ctx.strokeStyle = "#ffce6238"; ctx.beginPath(); ctx.moveTo(a.hit.start.x, a.hit.start.y); ctx.lineTo(a.hit.end.x + .01, a.hit.end.y); ctx.stroke(); ctx.restore();
        for (const p of [a.hit.start, a.hit.end]) ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
        ctx.strokeRect(a.cursor.x - 3, a.cursor.y - 3, 6, 6); ctx.beginPath(); ctx.arc(a.position.x, a.position.y, a.radius, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(a.position.x, a.position.y, chosen ? 2.5 : 1.5, 0, Math.PI * 2); ctx.fill();
    });
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
    root.querySelector(".tm-tile-count")!.textContent = `${set.tiles.length} tiles · ${set.palette.length} colors`;
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
        const f = anim.sequences[sequence].frames[Number(input.dataset.frame)]; f[input.dataset.frameKey as "cellIndex" | "duration"] = value;
        const original = files().get(ids.anim)!; files().set(ids.anim, repackTownMapResource(original, buildPokemonAnimationFile(anim.sequences))); rebuildEffects();
      }, false));
    }
  }
  function installCanvas() {
    const canvas = root.querySelector<HTMLCanvasElement>(".tm-map")!, pixels = root.querySelector<HTMLCanvasElement>(".tm-pixel")!;
    let pointer: { id: number; x: number; y: number; target: Target } | undefined;
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * 256 / r.width), y: Math.round((e.clientY - r.top) * 256 / r.height) }; };
    canvas.addEventListener("pointerdown", event => run(() => {
      if (busy || isSprite()) return; const p = pos(event); canvas.focus();
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
    canvas.addEventListener("pointermove", event => run(() => { const p = pos(event); root.querySelector(".tm-readout")!.textContent = `${p.x}, ${p.y}`; if (!pointer || pointer.id !== event.pointerId) return;
      moveTownMapArea(draft.areas[selected], p.x - pointer.x, p.y - pointer.y, linked, pointer.target); pointer.x = p.x; pointer.y = p.y; draw(); }));
    const finish = () => { if (!pointer) return; pointer = undefined; refresh(); status("Draft changed"); };
    canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("keydown", event => {
      const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (delta[event.key]) { event.preventDefault(); const [x, y] = delta[event.key], step = event.shiftKey ? 8 : 1; change(() => moveTownMapArea(draft.areas[selected], x * step, y * step, linked, target)); }
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
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("Image exceeds 16 MiB.");
      const image = await createImageBitmap(file); if (stopped) { image.close(); return; }
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d")!.drawImage(image, 0, 0); image.close();
      pendingImport = convertTownMapImage(readTownMapLayer(draft.graphics, selectedLayer()), canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      const host = root.querySelector<HTMLElement>(".tm-import-host")!; host.innerHTML = `<div class="tm-import"><canvas></canvas><div><p>${pendingImport.tiles} tiles · ${pendingImport.paletteBanks} palette banks</p><p>${pendingImport.changedPixels} pixels mapped to existing colors</p><button class="btn -default" id="tm-accept-import">Use image</button><button class="btn -default" id="tm-cancel-import">Cancel</button></div></div>`;
      imageToCanvas(host.querySelector("canvas")!, 256, 256, renderNitroBackgroundImage(pendingImport.image));
      host.querySelector("#tm-accept-import")!.addEventListener("click", () => { const value = pendingImport; if (value) change(() => writeTownMapLayer(draft.graphics, selectedLayer(), value.image), false); host.replaceChildren(); });
      host.querySelector("#tm-cancel-import")!.addEventListener("click", () => { pendingImport = undefined; host.replaceChildren(); });
    } catch (error) { status(message(error), true); }
  }
  function download(canvas: HTMLCanvasElement, name: string) { canvas.toBlob(blob => { if (!blob || stopped) return; const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, "image/png"); }
  function action(name: string) {
    if (busy) return;
    run(() => {
      if (name === "undo" || name === "redo") { history[name](draft); rebuildEffects(); refresh(); return; }
      if (["left", "right", "up", "down"].includes(name)) { const [x, y] = ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as Record<string, number[]>)[name]; change(() => moveTownMapArea(draft.areas[selected], x, y, linked, target)); return; }
      if (name === "add") { const value = root.querySelector<HTMLSelectElement>("#tm-add-zone")!.value; if (value) change(() => { selected = appendTownMapArea(draft, selected, Number(value)); }); return; }
      if (name === "remove") { if (selected >= 85) change(() => { const [a] = draft.areas.splice(selected, 1); delete draft.landings[a.zone]; selected--; }); return; }
      if (name === "disable") { change(() => { const a = draft.areas[selected]; a.visibilityFlag = a.visibilityFlag === 61443 ? 65535 : 61443; if (a.visibilityFlag === 61443) a.fly = 0; }); return; }
      if (name === "flipX" || name === "flipY") { change(() => {
        const set = tileSet(), source = set.tiles[tileId].slice(); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set.tiles[tileId][y * 8 + x] = source[(name === "flipY" ? 7 - y : y) * 8 + (name === "flipX" ? 7 - x : x)]; writeSet(set); rebuildEffects();
      }, false); return; }
      if (name === "import") { root.querySelector<HTMLInputElement>("#tm-file")!.click(); return; }
      if (name === "export") { if (isSprite()) download(root.querySelector<HTMLCanvasElement>(".tm-tiles")!, "town-map-tiles.png"); else download(bitmap(readTownMapLayer(draft.graphics, selectedLayer())), `town-map-layer-${layerId}.png`); return; }
      if (name === "composite") { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256; TOWN_MAP_LAYERS.slice(0, 2).forEach(layer => canvas.getContext("2d")!.drawImage(bitmap(readTownMapLayer(draft.graphics, layer)), 0, 0)); download(canvas, "town-map.png"); return; }
      if (name === "apply" || name === "reload") {
        busy = true; root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>("input, select, button, textarea").forEach(el => el.disabled = true); status(name === "apply" ? "Applying Town Map…" : "Reloading…");
        void (async () => {
          try { if (name === "apply") { await applyTownMapDraft(project, draft); onDirty(); } const value = await loadTownMapDraft(project); if (stopped) return; draft = value; history = new TownMapHistory(); rebuildEffects(); status(name === "apply" ? "Applied. Export the ROM to use these changes." : "Reloaded."); }
          catch (error) { if (!stopped) status(message(error), true); }
          finally { if (!stopped) { busy = false; root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>("input, select, button, textarea").forEach(el => el.disabled = false); refresh(); } }
        })();
      }
    });
  }
}
