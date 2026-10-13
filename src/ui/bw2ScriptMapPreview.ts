import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { BW2_NARCS } from "../pokeweb/constants";
import { activeRomMatchesProject, loadActiveRomBytes } from "../pokeweb/persistence";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { getOverworldScene, type OverworldEntitySelection, type OverworldScene } from "../pokeweb/overworldModel";
import { bw2ScriptAssignedEntities, bw2ScriptMapChoices, bw2ScriptNpcCommandTarget, type Bw2ScriptFocus, type Bw2ScriptMapChoice } from "../pokeweb/bw2ScriptContextModel";
import { drawMap, drawTrueMap, mapGridBounds, mapRenderTileBounds, renderNpc, renderGridEntity, adjustSpriteDirections } from "./overworldEditor";
import type { OverworldMapRender } from "./overworldMapRenderer";
import { escapeHtml } from "./dom";

export type Bw2ScriptMapPreview = { setFocus: (focus: Bw2ScriptFocus | undefined, sourceLine: string, overlayId?: number, constants?: ReadonlyMap<string, number>) => void; destroy: () => void };
const entityKey = (item: OverworldEntitySelection) => `${item.kind}:${item.index}`;
const mapCache = new WeakMap<ProjectState, Map<string, Promise<OverworldMapRender>>>();

async function ensureMapResources(project: ProjectState): Promise<void> {
  const required = BW2_NARCS.filter((definition) => ["maps", "matrix", "overworlds"].includes(definition.name) && !project.narcs[definition.name]);
  if (!required.length) return;
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's source ROM to load map resources.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("The project's source ROM is unavailable.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  if (rom.idCode !== project.romInfo.idCode || bytes.length !== project.romInfo.size) throw new Error("Map resources do not match this project.");
  for (const definition of required) {
    if (project.narcs[definition.name]) continue;
    const fileId = rom.fileId(definition.path);
    project.narcs[definition.name] = createNarcStore(definition.name, definition.path, fileId, new NARC(rom.files[fileId]));
    project.session.fileIds[definition.name] = fileId;
  }
}

/** A navigable read-only view using the overworld editor's terrain and entity renderer. */
export function installBw2ScriptMapPreview(project: ProjectState, root: HTMLElement, fileId: number): Bw2ScriptMapPreview {
  let stopped = false, token = 0;
  let scene: OverworldScene | undefined, terrain: OverworldMapRender | undefined;
  let focus: Bw2ScriptFocus | undefined, sourceLine = "", overlayId: number | undefined;
  let constants: ReadonlyMap<string, number> | undefined;
  let selected = new Set<string>(), commandTarget: OverworldEntitySelection | undefined;
  let choices: Bw2ScriptMapChoice[];
  try { choices = bw2ScriptMapChoices(project, fileId); }
  catch (error) { choices = []; root.innerHTML = `<p class="bw2-map-message">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
  const noop: Bw2ScriptMapPreview = { setFocus: () => {}, destroy: () => { stopped = true; } };
  if (!choices.length) {
    root.innerHTML = `<h3>Map preview</h3><p class="bw2-map-message">No map header references script file ${fileId}. It may be a global or auxiliary script.</p>`;
    return noop;
  }
  root.innerHTML = `<div class="bw2-map-heading"><h3>Map preview</h3><select id="bw2-map-choice" aria-label="Map assigned to script">${choices.map((choice) => `<option value="${choice.headerRowId}">${escapeHtml(choice.label)}</option>`).join("")}</select></div>
    <div class="bw2-map-tools"><button type="button" data-map-action="out" aria-label="Zoom map out">−</button><button type="button" data-map-action="fit">Fit</button><button type="button" data-map-action="in" aria-label="Zoom map in">+</button><span>Drag to pan · scroll to zoom</span></div>
    <p id="bw2-map-focus" class="bw2-map-focus" aria-live="polite">Place the cursor inside an entry, helper or movement to highlight its assigned entities.</p>
    <div class="bw2-map-stage"><canvas class="bw2-map-canvas" aria-label="2D map with overworld entities"></canvas><div class="overworld-entities bw2-map-entities"></div><p class="bw2-map-message bw2-map-loading">Loading map…</p></div>
    <p class="bw2-map-legend">Event placements: NPCs · signs · triggers · warps. Solid red outlines mark assigned entities; dashed red outlines mark other command actors.</p>`;
  const choiceSelect = root.querySelector<HTMLSelectElement>("#bw2-map-choice")!;
  const stage = root.querySelector<HTMLElement>(".bw2-map-stage")!;
  const canvas = root.querySelector<HTMLCanvasElement>(".bw2-map-canvas")!;
  const entities = root.querySelector<HTMLElement>(".bw2-map-entities")!;
  const status = root.querySelector<HTMLElement>(".bw2-map-loading")!;
  const focusText = root.querySelector<HTMLElement>("#bw2-map-focus")!;
  let tileSize = 8, panX = 0, panY = 0, framed = false;
  let pointer: { id: number; x: number; y: number; panX: number; panY: number } | undefined;
  let highlightedKey = "";
  const bounds = () => terrain ? mapRenderTileBounds(terrain) : scene ? mapGridBounds(scene) : { x: 0, y: 0, width: 1, height: 1 };
  const worldToScreen = (x: number, y: number) => ({ x: panX + x * tileSize, y: panY + y * tileSize, tileSize });
  function renderEntities(): void {
    if (!scene) return;
    entities.innerHTML = [
      ...scene.furniture.filter((item) => !item.isRail).map((item) => renderGridEntity(item, worldToScreen, selected.has(entityKey(item)))),
      ...scene.warps.filter((item) => !item.isRail).map((item) => renderGridEntity(item, worldToScreen, false)),
      ...scene.triggers.filter((item) => !item.isRail).map((item) => renderGridEntity(item, worldToScreen, selected.has(entityKey(item)))),
      ...scene.npcs.map((npc) => renderNpc(project, npc, worldToScreen, selected.has(entityKey(npc)))),
    ].join("");
    if (commandTarget) entities.querySelector<HTMLElement>(`[data-kind="${commandTarget.kind}"][data-index="${commandTarget.index}"]`)?.classList.add("bw2-command-actor");
    adjustSpriteDirections(entities);
  }
  function draw(): void {
    if (stopped || !scene) return;
    const rect = stage.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.imageSmoothingEnabled = false;
    context.fillStyle = "#181a23"; context.fillRect(0, 0, rect.width, rect.height);
    if (terrain) drawTrueMap(context, terrain, bounds(), tileSize, panX, panY);
    else scene.maps.forEach((map) => drawMap(context, map, tileSize, panX, panY));
    renderEntities();
  }
  function fit(): void {
    const rect = stage.getBoundingClientRect(), area = bounds();
    if (rect.width <= 1 || rect.height <= 1) return;
    tileSize = Math.max(0.25, Math.min((rect.width - 32) / area.width, (rect.height - 32) / area.height));
    panX = (rect.width - area.width * tileSize) / 2 - area.x * tileSize;
    panY = (rect.height - area.height * tileSize) / 2 - area.y * tileSize;
    framed = true; draw();
  }
  function updateFocus(): void {
    if (!scene) return;
    selected = new Set(bw2ScriptAssignedEntities(scene, focus?.entries ?? []).map(entityKey));
    commandTarget = bw2ScriptNpcCommandTarget(project, sourceLine, scene, overlayId, constants);
    const entries = focus?.entries.join(", ");
    focusText.textContent = !focus ? "Place the cursor inside an entry, helper or movement to highlight its assigned entities." : `${focus.kind === "helper" ? "Helper" : focus.kind === "movement" ? "Movement" : "Script"} ${focus.name}${entries ? ` · ${focus.entries.length === 1 ? "entry" : "caller entries"} ${entries}` : " · no public caller"} · ${selected.size ? `${selected.size} assigned ${selected.size === 1 ? "entity" : "entities"}` : "no entity assignment (map event or unassigned entry)"}${commandTarget ? ` · command actor ${scene.npcs.find((npc) => npc.index === commandTarget!.index)?.overworldId}` : ""}`;
    const key = `${[...selected].sort().join("|")}:${commandTarget ? entityKey(commandTarget) : ""}`;
    if (key === highlightedKey) return;
    highlightedKey = key;
    renderEntities();
    // Keep assigned objects in view without changing the source or their positions.
    const active = [...entities.querySelectorAll<HTMLElement>(".selected, .bw2-command-actor")];
    if (active.length) {
      const rect = stage.getBoundingClientRect();
      const xs = active.map((item) => parseFloat(item.style.left)), ys = active.map((item) => parseFloat(item.style.top));
      const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (x < 20 || y < 20 || x > rect.width - 20 || y > rect.height - 20) { panX += rect.width / 2 - x; panY += rect.height / 2 - y; draw(); }
    }
  }
  async function open(choice: Bw2ScriptMapChoice): Promise<void> {
    const request = ++token; scene = undefined; terrain = undefined; framed = false; highlightedKey = "";
    entities.innerHTML = ""; canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    status.hidden = false; status.textContent = "Loading map…";
    try {
      await ensureMapResources(project);
      if (stopped || request !== token) return;
      scene = getOverworldScene(project, choice.overworldId, choice.headerRowId);
      fit(); updateFocus();
      const cache = mapCache.get(project) ?? new Map<string, Promise<OverworldMapRender>>(); mapCache.set(project, cache);
      const key = `${choice.zoneId}:${project.narcs.maps?.revision ?? 0}:${project.narcs.matrix?.revision ?? 0}`;
      let rendered = cache.get(key);
      if (!rendered) {
        rendered = Promise.all([import("../pokeweb/map3dModel"), import("./overworldMapRenderer")]).then(async ([model, renderer]) => renderer.renderOverworldMapTopDown(await model.loadMap3dZone(project, choice.zoneId, { season: "spring" })));
        cache.set(key, rendered);
        rendered.catch(() => cache.delete(key));
      }
      const result = await rendered;
      if (stopped || request !== token) return;
      terrain = result; status.hidden = true; fit(); updateFocus();
    } catch (error) {
      if (stopped || request !== token) return;
      status.hidden = false; status.textContent = `${scene ? "Showing the permission map. " : ""}${error instanceof Error ? error.message : String(error)}`;
      if (scene) { fit(); updateFocus(); }
    }
  }
  function zoom(factor: number, x: number, y: number): void {
    const next = Math.min(96, Math.max(0.25, tileSize * factor));
    panX = x - (x - panX) * next / tileSize; panY = y - (y - panY) * next / tileSize;
    tileSize = next; draw();
  }
  stage.addEventListener("wheel", (event) => {
    event.preventDefault(); const rect = stage.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY }; stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    panX = pointer.panX + event.clientX - pointer.x; panY = pointer.panY + event.clientY - pointer.y; draw();
  });
  const release = () => { pointer = undefined; };
  stage.addEventListener("pointerup", release); stage.addEventListener("pointercancel", release);
  root.querySelectorAll<HTMLButtonElement>("[data-map-action]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.mapAction === "fit") fit();
    else { const rect = stage.getBoundingClientRect(); zoom(button.dataset.mapAction === "in" ? 1.25 : 0.8, rect.width / 2, rect.height / 2); }
  }));
  choiceSelect.addEventListener("change", () => { const choice = choices.find((choice) => choice.headerRowId === Number(choiceSelect.value)); if (choice) void open(choice); });
  const observer = new ResizeObserver(() => { if (!framed) fit(); else draw(); }); observer.observe(stage);
  void open(choices[0]);
  return { setFocus: (next, line, overlay, bindings) => { focus = next; sourceLine = line; overlayId = overlay; constants = bindings; updateFocus(); }, destroy: () => { stopped = true; token++; observer.disconnect(); } };
}
