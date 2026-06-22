import {
  addOverworldEntity,
  deleteOverworldEntity,
  getOverworldScene,
  mapPermissionColor,
  moveOverworldEntity,
  NPC_FIELDS,
  OVERWORLD_ENTITY_KINDS,
  updateMapTile,
  updateOverworldEntityField,
  type OverworldEntity,
  type OverworldEntityKind,
  type OverworldEntitySelection,
  type OverworldFurniture,
  type OverworldMapScene,
  type OverworldNpc,
  type OverworldScene,
  type OverworldTrigger,
  type OverworldWarp,
} from "../pokeweb/overworldModel";
import { isGen4Project } from "../pokeweb/constants";
import { ensureGen4OverworldSpriteResources, gen4SpecialOverworldIconName, getGen4OverworldSpriteDataUrl } from "../pokeweb/gen4OverworldSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, selectText } from "./dom";
import { publicAsset } from "../assetUrl";
import { gen4PermissionTileFill } from "./gen4MapPreviewRenderer";
import type { OverworldMapRender } from "./overworldMapRenderer";

const TILE_SIZE = 32;
const MAP_VIEW_TILE_SCALE = 1;
const MAP_VIEW_SEASON = "spring";
const WHEEL_ZOOM_STEP = 0.025;
const MAP_RENDER_CACHE_VERSION = 10;
const MIN_ZOOM = 0.05;
const MIN_NPC_SCREEN_SIZE = 18;
const ENTITY_DRAG_START_PX = 6;

type OverworldViewMode = "permissions" | "map";
type SidebarField = { key: string; label: string; editable?: boolean; showWhenRail?: boolean; showWhenGrid?: boolean };
type ActiveCellViewport = { key: string; x: number; y: number; width: number; height: number; map?: OverworldMapScene };

const mapRenderCache = new Map<string, Promise<OverworldMapRender> | OverworldMapRender>();

export function renderOverworldEditor(
  project: ProjectState,
  root: HTMLElement,
  overworldId: number,
  onDirty?: () => void,
  onBack?: () => void,
): void {
  let scene = getOverworldScene(project, overworldId);
  const isGen4 = isGen4Project(project);
  const tileLayerLabels = isGen4 ? { flag: "Type", movement: "Collision" } : { flag: "Flag", movement: "Movement" };
  let activeKind: OverworldEntityKind = "npc";
  let selectedEntity: OverworldEntitySelection | undefined = scene.npcs[0] ? { kind: "npc", index: scene.npcs[0].index } : undefined;
  let selectedTile: { mapId: number; index: number; x: number; y: number; layer2: number; layer3: number } | undefined;
  let activeCellKey = isGen4 ? initialActiveCellKey(scene, selectedEntity) : "";

  root.innerHTML = `
    <div class="pokemon-filter overworld-bar">
      <div class="overworld-info filterable" data-index="${overworldId}">
        <div class="filter-title">${escapeHtml(scene.locationName)}</div>
        <div class="overworld-subtitle">Overworld ${overworldId} / Matrix ${scene.matrixId}</div>
        <div class="overworld-entity-tabs" role="group" aria-label="Overworld entity type">
          ${OVERWORLD_ENTITY_KINDS.map((kind) => `<button class="ow-entity-tab ${kind === activeKind ? "active" : ""}" data-kind="${kind}" type="button">${escapeHtml(entityKindLabel(kind))}</button>`).join("")}
        </div>
        <div class="sidebar-row">
          <div class="sidebar-label">Selected</div>
          <select class="sidebar-select" id="entity-select"></select>
        </div>
        <div class="overworld-entity-fields" id="entity-fields"></div>
        <div class="overworld-entity-actions" id="entity-actions"></div>
      </div>
      <div class="sidebar-btns">
        <button class="ow-btn" id="add-entity" type="button">Add NPC</button>
        <button class="ow-btn" id="del-entity" type="button">Del Selected</button>
      </div>
      <div class="sidebar-btns">
        <button class="ow-btn" id="back-headers" type="button">Back to Headers</button>
      </div>
      <div class="popup-editor field-holder" id="tile-editor">
        <div class="popup-field-row">
          <div class="popup-field-label">${tileLayerLabels.flag}</div>
          <div class="popup-field" data-layer="2" id="tile-flag" contenteditable="true" data-type="int-65535">0</div>
        </div>
        <div class="popup-field-row">
          <div class="popup-field-label">${tileLayerLabels.movement}</div>
          <div class="popup-field" data-layer="3" id="tile-mov" contenteditable="true" data-type="int-65535">0</div>
        </div>
      </div>
    </div>
    <div class="pokemon-list" id="overworld">
      <div class="overworld-toolbar">
        <div class="overworld-view-toggle" role="group" aria-label="Overworld view mode">
          <button class="ow-tool overworld-view-button active" id="view-permissions" type="button">Permissions</button>
          <button class="ow-tool overworld-view-button" id="view-map" type="button">Map</button>
        </div>
        <button class="ow-tool" id="zoom-out" type="button">-</button>
        <button class="ow-tool" id="zoom-reset" type="button">100%</button>
        <button class="ow-tool" id="zoom-in" type="button">+</button>
      </div>
      <div class="overworld-stage">
        <canvas class="overworld-map" id="overworld-canvas"></canvas>
        ${
          isGen4
            ? `<div class="overworld-cell-nav" role="group" aria-label="Map section">
                <button class="ow-tool overworld-cell-button overworld-cell-left" id="cell-left" type="button" title="Previous section west">&larr;</button>
                <button class="ow-tool overworld-cell-button overworld-cell-up" id="cell-up" type="button" title="Previous section north">&uarr;</button>
                <span class="overworld-cell-label" id="cell-label"></span>
                <button class="ow-tool overworld-cell-button overworld-cell-down" id="cell-down" type="button" title="Next section south">&darr;</button>
                <button class="ow-tool overworld-cell-button overworld-cell-right" id="cell-right" type="button" title="Next section east">&rarr;</button>
              </div>`
            : ""
        }
        <div class="overworld-map-status" id="overworld-map-status" hidden></div>
        <div class="overworld-entities" id="overworld-entities"></div>
      </div>
    </div>
  `;

  const stage = root.querySelector<HTMLDivElement>(".overworld-stage");
  const canvas = root.querySelector<HTMLCanvasElement>("#overworld-canvas");
  const entities = root.querySelector<HTMLDivElement>("#overworld-entities");
  const tileEditor = root.querySelector<HTMLDivElement>("#tile-editor");
  const zoomLabel = root.querySelector<HTMLButtonElement>("#zoom-reset");
  const mapStatus = root.querySelector<HTMLDivElement>("#overworld-map-status");
  if (!stage || !canvas || !entities) return;
  const entityLayer = entities;

  const state = {
    zoom: 1,
    panX: 24,
    panY: 24,
    framed: false,
    draggingMap: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanX: 0,
    dragPanY: 0,
    viewMode: "permissions" as OverworldViewMode,
    mapRender: undefined as OverworldMapRender | undefined,
    mapRenderError: "",
    mapRenderLoading: false,
    mapRenderToken: 0,
  };

  if (isGen4) {
    void ensureGen4OverworldSpriteResources(project)
      .then(() => {
        renderEntityOverlay();
        fillSidebar();
      })
      .catch(() => undefined);
  }

  const reloadScene = () => {
    const previousZoneId = associatedMapZoneId(scene);
    scene = getOverworldScene(project, overworldId);
    reconcileActiveCell();
    selectedEntity = normalizeVisibleSelection(selectedEntity, activeKind);
    if (associatedMapZoneId(scene) !== previousZoneId) {
      state.mapRender = undefined;
      state.mapRenderError = "";
      state.mapRenderToken += 1;
    }
    renderEntityOverlay();
    fillSidebar();
    draw();
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (!state.framed && rect.width > 1 && rect.height > 1) frameScene(rect);
    draw();
  };

  const frameScene = (rect = stage.getBoundingClientRect()) => {
    const focus = selectedEntityBounds(scene, selectedEntity) ?? selectedEntityBounds(scene, { kind: "npc", index: scene.npcs[0]?.index ?? -1 });
    const bounds = displayBounds(focus);
    const tileSize = activeTileSize();
    const fitZoom = Math.min(1, Math.max(MIN_ZOOM, Math.min(rect.width / Math.max(1, bounds.width * tileSize), rect.height / Math.max(1, bounds.height * tileSize)) * 0.85));
    state.zoom = fitZoom;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    state.panX = rect.width / 2 - centerX * tileSize * state.zoom;
    state.panY = rect.height / 2 - centerY * tileSize * state.zoom;
    state.framed = true;
    updateZoomLabel();
  };

  const setZoom = (nextZoom: number, anchorX?: number, anchorY?: number) => {
    const rect = stage.getBoundingClientRect();
    const screenX = anchorX ?? rect.width / 2;
    const screenY = anchorY ?? rect.height / 2;
    const tileSize = activeTileSize();
    const worldX = (screenX - state.panX) / (tileSize * state.zoom);
    const worldY = (screenY - state.panY) / (tileSize * state.zoom);
    state.zoom = Math.min(3, Math.max(MIN_ZOOM, nextZoom));
    state.panX = screenX - worldX * tileSize * state.zoom;
    state.panY = screenY - worldY * tileSize * state.zoom;
    updateZoomLabel();
    draw();
  };

  const updateZoomLabel = () => {
    if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  };

  const activeTileSize = () => TILE_SIZE * (state.viewMode === "map" ? MAP_VIEW_TILE_SCALE : 1);

  function activeCellViewport(): ActiveCellViewport {
    const map = scene.maps.find((entry) => cellKey(entry) === activeCellKey) ?? scene.maps[0];
    if (!map) return { key: "", x: 0, y: 0, width: Math.max(1, scene.width || 32), height: Math.max(1, scene.height || 32) };
    return { key: cellKey(map), x: map.x, y: map.y, width: map.width, height: map.height, map };
  }

  function activeOrigin(): { x: number; y: number } {
    if (!isGen4) return { x: 0, y: 0 };
    const cell = activeCellViewport();
    return { x: cell.x, y: cell.y };
  }

  function displayBounds(focus?: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    if (isGen4) {
      const cell = activeCellViewport();
      return { x: 0, y: 0, width: Math.max(1, cell.width), height: Math.max(1, cell.height) };
    }
    if (state.viewMode === "map" && state.mapRender) return mapViewTileBounds(scene, state.mapRender, isGen4);
    return sceneBounds(scene, focus);
  }

  function reconcileActiveCell(): void {
    if (!isGen4) return;
    const current = scene.maps.find((map) => cellKey(map) === activeCellKey);
    if (current) return;
    activeCellKey = initialActiveCellKey(scene, selectedEntity);
  }

  function setActiveCell(map: OverworldMapScene | undefined): void {
    if (!isGen4 || !map) return;
    activeCellKey = cellKey(map);
    selectedTile = undefined;
    if (tileEditor) tileEditor.style.display = "none";
    selectedEntity = normalizeVisibleSelection(selectedEntity, activeKind);
    state.framed = false;
    updateCellNav();
    fillSidebar();
    frameScene();
    draw();
  }

  function setActiveCellForSelection(selection: OverworldEntitySelection | undefined): void {
    if (!isGen4) return;
    const entity = entityBySelection(scene, selection);
    const map = entity ? mapForPoint(scene, entity.x, entity.y) : undefined;
    if (map) activeCellKey = cellKey(map);
  }

  function neighborCell(dx: number, dy: number): OverworldMapScene | undefined {
    const cell = activeCellViewport();
    return scene.maps.find((map) => map.x === cell.x + dx * cell.width && map.y === cell.y + dy * cell.height);
  }

  function moveActiveCell(dx: number, dy: number): void {
    setActiveCell(neighborCell(dx, dy));
  }

  function updateCellNav(): void {
    if (!isGen4) return;
    const cell = activeCellViewport();
    const label = root.querySelector<HTMLSpanElement>("#cell-label");
    if (label) label.textContent = cell.map ? `Map ${cell.map.id}` : "Map";
    root.querySelector<HTMLButtonElement>("#cell-left")!.disabled = neighborCell(-1, 0) === undefined;
    root.querySelector<HTMLButtonElement>("#cell-right")!.disabled = neighborCell(1, 0) === undefined;
    root.querySelector<HTMLButtonElement>("#cell-up")!.disabled = neighborCell(0, -1) === undefined;
    root.querySelector<HTMLButtonElement>("#cell-down")!.disabled = neighborCell(0, 1) === undefined;
  }

  function entityInActiveCell(entity: OverworldEntity): boolean {
    if (!isGen4) return true;
    const cell = activeCellViewport();
    return entity.x >= cell.x && entity.y >= cell.y && entity.x < cell.x + cell.width && entity.y < cell.y + cell.height;
  }

  function visibleEntitiesByKind(kind: OverworldEntityKind): OverworldEntity[] {
    const entitiesForKind = entitiesByKind(scene, kind);
    return isGen4 ? entitiesForKind.filter(entityInActiveCell) : entitiesForKind;
  }

  function visibleEntityBySelection(selection: OverworldEntitySelection | undefined): OverworldEntity | undefined {
    const entity = entityBySelection(scene, selection);
    return entity && entityInActiveCell(entity) ? entity : undefined;
  }

  function normalizeVisibleSelection(selection: OverworldEntitySelection | undefined, kind: OverworldEntityKind): OverworldEntitySelection | undefined {
    if (selection && visibleEntityBySelection(selection)) return selection;
    const first = visibleEntitiesByKind(kind)[0];
    return first ? { kind, index: first.index } : undefined;
  }

  function clampToActiveCell(x: number, y: number): { x: number; y: number } {
    if (!isGen4) return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
    const cell = activeCellViewport();
    return {
      x: Math.min(cell.x + cell.width - 1, Math.max(cell.x, Math.round(x))),
      y: Math.min(cell.y + cell.height - 1, Math.max(cell.y, Math.round(y))),
    };
  }

  const worldToScreen = (x: number, y: number) => {
    const tileSize = activeTileSize() * state.zoom;
    const origin = activeOrigin();
    return {
      x: state.panX + (x - origin.x) * tileSize,
      y: state.panY + (y - origin.y) * tileSize,
      tileSize,
    };
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = stage.getBoundingClientRect();
    const tileSize = activeTileSize() * state.zoom;
    const origin = activeOrigin();
    return {
      x: (clientX - rect.left - state.panX) / tileSize + origin.x,
      y: (clientY - rect.top - state.panY) / tileSize + origin.y,
    };
  };

  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = window.devicePixelRatio || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, canvas.width / scale, canvas.height / scale);
    ctx.imageSmoothingEnabled = false;
    const tileSize = activeTileSize() * state.zoom;
    if (state.viewMode === "map" && state.mapRender) {
      if (isGen4) drawTrueMapSection(ctx, state.mapRender, mapGridBounds(scene), activeCellViewport(), tileSize, state.panX, state.panY);
      else drawTrueMap(ctx, state.mapRender, mapViewTileBounds(scene, state.mapRender, isGen4), tileSize, state.panX, state.panY);
    } else {
      const origin = activeOrigin();
      const maps = isGen4 ? [activeCellViewport().map].filter((map): map is OverworldMapScene => map !== undefined) : scene.maps;
      for (const map of maps) drawMap(ctx, map, tileSize, state.panX, state.panY, origin);
    }
    renderEntityOverlay();
  };

  const setViewMode = (viewMode: OverworldViewMode) => {
    state.viewMode = viewMode;
    selectedTile = undefined;
    if (tileEditor) tileEditor.style.display = "none";
    updateViewButtons();
    updateMapStatus();
    if (viewMode === "map") {
      if (state.mapRender) frameScene();
      void ensureMapRender();
    } else {
      frameScene();
    }
    draw();
  };

  const updateViewButtons = () => {
    root.querySelector<HTMLButtonElement>("#view-permissions")?.classList.toggle("active", state.viewMode === "permissions");
    root.querySelector<HTMLButtonElement>("#view-map")?.classList.toggle("active", state.viewMode === "map");
  };

  const updateMapStatus = () => {
    if (!mapStatus) return;
    const message = state.mapRenderLoading
      ? "Loading map view..."
      : state.viewMode === "map" && state.mapRenderError
        ? state.mapRenderError
        : "";
    mapStatus.hidden = message.length === 0;
    mapStatus.textContent = message;
  };

  const ensureMapRender = async () => {
    if (state.mapRender || state.mapRenderLoading) return;
    const token = ++state.mapRenderToken;
    state.mapRenderLoading = true;
    state.mapRenderError = "";
    updateMapStatus();
    draw();

    try {
      const zoneId = associatedMapZoneId(scene);
      const key = mapRenderCacheKey(project, overworldId, zoneId);
      let cached = mapRenderCache.get(key);
      if (!cached) {
        cached = isGen4
          ? Promise.all([import("../pokeweb/gen4Map3dModel"), import("./overworldMapRenderer")]).then(async ([gen4Map3dModel, renderer]) => {
              await gen4Map3dModel.ensureGen4Map3dResources(project);
              return renderer.renderOverworldMapTopDown(
                gen4Map3dModel.buildGen4Map3dScene(project, scene.matrixId, {
                  headerId: scene.header.index,
                  label: scene.locationName,
                }),
              );
            })
          : Promise.all([import("../pokeweb/map3dModel"), import("./overworldMapRenderer")]).then(([map3dModel, renderer]) =>
              map3dModel.loadMap3dZone(project, zoneId, { season: MAP_VIEW_SEASON }).then((data) => renderer.renderOverworldMapTopDown(data)),
            );
        mapRenderCache.set(key, cached);
      }
      const render = await cached;
      mapRenderCache.set(key, render);
      if (token !== state.mapRenderToken) return;
      state.mapRender = render;
      if (state.viewMode === "map") frameScene();
    } catch (error) {
      if (token !== state.mapRenderToken) return;
      state.mapRenderError = `Map view unavailable: ${error instanceof Error ? error.message : String(error)}`;
      mapRenderCache.delete(mapRenderCacheKey(project, overworldId, associatedMapZoneId(scene)));
    } finally {
      if (token === state.mapRenderToken) {
        state.mapRenderLoading = false;
        updateMapStatus();
        draw();
      }
    }
  };

  function renderEntityOverlay(): void {
    const selected = selectedEntity;
    const overlays =
      state.viewMode === "map"
        ? visibleEntitiesByKind("npc")
            .filter((entity): entity is OverworldNpc => entity.kind === "npc")
            .map((npc) => renderNpc(project, npc, worldToScreen, isSelected(selected, "npc", npc.index)))
            .join("")
        : [
            ...visibleEntitiesByKind("furniture")
              .filter((entry): entry is OverworldFurniture => entry.kind === "furniture" && !entry.isRail)
              .map((entry) => renderGridEntity(entry, worldToScreen, isSelected(selected, "furniture", entry.index))),
            ...visibleEntitiesByKind("warp")
              .filter((entry): entry is OverworldWarp => entry.kind === "warp" && !entry.isRail)
              .map((entry) => renderGridEntity(entry, worldToScreen, isSelected(selected, "warp", entry.index))),
            ...visibleEntitiesByKind("trigger")
              .filter((entry): entry is OverworldTrigger => entry.kind === "trigger" && !entry.isRail)
              .map((entry) => renderGridEntity(entry, worldToScreen, isSelected(selected, "trigger", entry.index))),
            ...visibleEntitiesByKind("npc")
              .filter((entity): entity is OverworldNpc => entity.kind === "npc")
              .map((npc) => renderNpc(project, npc, worldToScreen, isSelected(selected, "npc", npc.index))),
          ].join("");
    entityLayer.innerHTML = overlays;
    adjustSpriteDirections(entityLayer);
    entityLayer.querySelectorAll<HTMLDivElement>(".overworld-item").forEach((item) => {
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        const kind = item.dataset.kind as OverworldEntityKind | undefined;
        const index = Number(item.dataset.index);
        if (!kind || !Number.isFinite(index)) return;
        selectEntity(kind, index);
        renderEntityOverlay();
        fillSidebar();
      });
      item.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const kind = item.dataset.kind as OverworldEntityKind | undefined;
        const index = Number(item.dataset.index);
        if (!kind || !Number.isFinite(index)) return;
        selectEntity(kind, index);
        fillSidebar();
        if (item.isConnected) item.setPointerCapture(event.pointerId);
        const entity = entityBySelection(scene, selectedEntity);
        if (!entity || (entity.kind !== "npc" && entity.isRail)) return;
        const start = screenToWorld(event.clientX, event.clientY);
        const startClientX = event.clientX;
        const startClientY = event.clientY;
        const startX = entity.x;
        const startY = entity.y;
        let lastX = startX;
        let lastY = startY;
        let moved = false;
        const move = (moveEvent: PointerEvent) => {
          if (!moved && Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) < ENTITY_DRAG_START_PX) return;
          const next = screenToWorld(moveEvent.clientX, moveEvent.clientY);
          const dx = Math.round(next.x - start.x);
          const dy = Math.round(next.y - start.y);
          const clamped = clampToActiveCell(startX + dx, startY + dy);
          const x = clamped.x;
          const y = clamped.y;
          if (x === lastX && y === lastY) return;
          moved = true;
          lastX = x;
          lastY = y;
          moveOverworldEntity(project, overworldId, kind, index, x, y);
          scene = getOverworldScene(project, overworldId);
          renderEntityOverlay();
          fillSidebar();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          try {
            if (item.hasPointerCapture(event.pointerId)) item.releasePointerCapture(event.pointerId);
          } catch {
            // The overlay may have been rerendered during a drag.
          }
          if (moved) onDirty?.();
          else {
            renderEntityOverlay();
            fillSidebar();
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    });
  }

  function selectEntity(kind: OverworldEntityKind, index: number): void {
    activeKind = kind;
    selectedEntity = { kind, index };
    setActiveCellForSelection(selectedEntity);
    selectedTile = undefined;
    if (tileEditor) tileEditor.style.display = "none";
  }

  function bindEntityFieldEvents(host: HTMLElement): void {
    host.querySelectorAll<HTMLElement>(".sidebar-val[contenteditable='true']").forEach((field) => {
      let initial = "";
      field.addEventListener("focus", () => {
        initial = field.textContent?.trim() ?? "";
        selectText(field);
      });
      field.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          field.blur();
        }
      });
      field.addEventListener("focusout", () => {
        const key = field.dataset.fieldKey;
        const selection = selectedEntity;
        if (!key || !selection) return;
        const next = field.textContent?.trim() ?? "";
        if (next === initial) return;
        try {
          const value = updateOverworldEntityField(project, overworldId, selection, key, next);
          field.textContent = String(value);
          reloadScene();
          onDirty?.();
        } catch {
          field.textContent = initial;
          field.classList.add("invalid");
          window.setTimeout(() => field.classList.remove("invalid"), 800);
        }
      });
    });
  }

  function defaultNewEntityPosition(): { x: number; y: number } {
    if (selectedTile) return { x: selectedTile.x, y: selectedTile.y };
    const entity = visibleEntityBySelection(selectedEntity);
    if (entity && (entity.kind === "npc" || !entity.isRail)) return { x: Math.max(0, Math.round(entity.x)), y: Math.max(0, Math.round(entity.y)) };
    if (isGen4) {
      const cell = activeCellViewport();
      return { x: cell.x + Math.floor(cell.width / 2), y: cell.y + Math.floor(cell.height / 2) };
    }
    return { x: 0, y: 0 };
  }

  const fillSidebar = () => {
    updateCellNav();
    updateEntityTabs(root, activeKind);
    const select = root.querySelector<HTMLSelectElement>("#entity-select");
    selectedEntity = normalizeVisibleSelection(selectedEntity, activeKind);
    const entitiesForKind = visibleEntitiesByKind(activeKind);
    if (select) {
      select.innerHTML = entitiesForKind.map((entity) => `<option value="${entity.index}" ${selectedEntity?.kind === activeKind && selectedEntity.index === entity.index ? "selected" : ""}>${escapeHtml(entityOptionLabel(entity))}</option>`).join("");
      select.disabled = entitiesForKind.length === 0;
    }

    const entity = visibleEntityBySelection(selectedEntity);
    const fieldsHost = root.querySelector<HTMLDivElement>("#entity-fields");
    if (fieldsHost) {
      fieldsHost.innerHTML = entity
        ? sidebarFields(entity)
            .map((field) => sidebarRow(field, entity, scene.raw))
            .join("")
        : `<div class="overworld-empty-selection">No ${escapeHtml(entityKindLabel(activeKind))} selected</div>`;
      bindEntityFieldEvents(fieldsHost);
    }
    const actionsHost = root.querySelector<HTMLDivElement>("#entity-actions");
    if (actionsHost) {
      actionsHost.innerHTML = renderEntityActions(project, entity);
      actionsHost.querySelector<HTMLButtonElement>("#open-warp-target")?.addEventListener("click", () => {
        const warp = entity?.kind === "warp" ? entity : undefined;
        if (!warp) return;
        const target = warpTargetForZone(project, warp.targetZone);
        if (!target) return;
        window.open(overworldRouteUrl(target.overworldId), "_blank", "noopener");
      });
    }

    const addButton = root.querySelector<HTMLButtonElement>("#add-entity");
    if (addButton) addButton.textContent = `Add ${entityKindLabel(activeKind)}`;
    const deleteButton = root.querySelector<HTMLButtonElement>("#del-entity");
    if (deleteButton) deleteButton.disabled = !entity || entity.kind !== activeKind;
  };

  root.querySelector<HTMLButtonElement>("#back-headers")?.addEventListener("click", () => onBack?.());
  root.querySelector<HTMLButtonElement>("#add-entity")?.addEventListener("click", () => {
    const index = addOverworldEntity(project, overworldId, activeKind);
    selectedEntity = { kind: activeKind, index };
    const position = defaultNewEntityPosition();
    moveOverworldEntity(project, overworldId, activeKind, index, position.x, position.y);
    reloadScene();
    onDirty?.();
  });
  root.querySelector<HTMLButtonElement>("#del-entity")?.addEventListener("click", () => {
    if (!selectedEntity) return;
    deleteOverworldEntity(project, overworldId, selectedEntity.kind, selectedEntity.index);
    selectedEntity = undefined;
    reloadScene();
    onDirty?.();
  });

  root.querySelector<HTMLSelectElement>("#entity-select")?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    selectedEntity = target.value === "" ? undefined : { kind: activeKind, index: Number(target.value) };
    selectedTile = undefined;
    if (tileEditor) tileEditor.style.display = "none";
    renderEntityOverlay();
    fillSidebar();
  });

  root.querySelectorAll<HTMLButtonElement>(".ow-entity-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind as OverworldEntityKind | undefined;
      if (!kind) return;
      activeKind = kind;
      selectedEntity = normalizeVisibleSelection(selectedEntity?.kind === kind ? selectedEntity : undefined, activeKind);
      selectedTile = undefined;
      if (tileEditor) tileEditor.style.display = "none";
      renderEntityOverlay();
      fillSidebar();
    });
  });

  root.querySelectorAll<HTMLElement>(".popup-field[contenteditable='true']").forEach((field) => {
    let initial = "";
    field.addEventListener("focus", () => {
      initial = field.textContent?.trim() ?? "";
      selectText(field);
    });
    field.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("focusout", () => {
      if (!selectedTile) return;
      const layer = Number(field.dataset.layer) as 2 | 3;
      const next = field.textContent?.trim() ?? "";
      if (next === initial) return;
      try {
        const value = updateMapTile(project, selectedTile.mapId, selectedTile.index, layer, next);
        field.textContent = String(value);
        reloadScene();
        selectedTile = { ...selectedTile, [layer === 2 ? "layer2" : "layer3"]: value };
        onDirty?.();
      } catch {
        field.textContent = initial;
      }
    });
  });

  canvas.addEventListener("pointerdown", (event) => {
    state.draggingMap = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragPanX = state.panX;
    state.dragPanY = state.panY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.draggingMap) return;
    state.panX = state.dragPanX + event.clientX - state.dragStartX;
    state.panY = state.dragPanY + event.clientY - state.dragStartY;
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    const moved = Math.abs(event.clientX - state.dragStartX) + Math.abs(event.clientY - state.dragStartY);
    state.draggingMap = false;
    if (moved < 4 && state.viewMode === "permissions") {
      selectedTile = tileAt(scene, screenToWorld(event.clientX, event.clientY));
      if (selectedTile && tileEditor) {
        selectedEntity = undefined;
        renderEntityOverlay();
        fillSidebar();
        tileEditor.style.display = "block";
        root.querySelector<HTMLElement>("#tile-flag")!.textContent = String(selectedTile.layer2);
        root.querySelector<HTMLElement>("#tile-mov")!.textContent = String(selectedTile.layer3);
      }
    } else if (state.viewMode === "map") {
      selectedTile = undefined;
      if (tileEditor) tileEditor.style.display = "none";
    }
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      setZoom(state.zoom + (event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP), event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  root.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => {
    setZoom(state.zoom + 0.1);
  });
  root.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => {
    setZoom(state.zoom - 0.1);
  });
  root.querySelector<HTMLButtonElement>("#zoom-reset")?.addEventListener("click", () => {
    state.framed = false;
    frameScene();
    draw();
  });
  root.querySelector<HTMLButtonElement>("#view-permissions")?.addEventListener("click", () => {
    setViewMode("permissions");
  });
  root.querySelector<HTMLButtonElement>("#view-map")?.addEventListener("click", () => {
    setViewMode("map");
  });
  root.querySelector<HTMLButtonElement>("#cell-left")?.addEventListener("click", () => moveActiveCell(-1, 0));
  root.querySelector<HTMLButtonElement>("#cell-right")?.addEventListener("click", () => moveActiveCell(1, 0));
  root.querySelector<HTMLButtonElement>("#cell-up")?.addEventListener("click", () => moveActiveCell(0, -1));
  root.querySelector<HTMLButtonElement>("#cell-down")?.addEventListener("click", () => moveActiveCell(0, 1));

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || isEditableTarget(event.target)) return;
    event.preventDefault();
    setViewMode(state.viewMode === "permissions" ? "map" : "permissions");
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  window.addEventListener("resize", resize, { once: false });
  fillSidebar();
  resize();
  window.requestAnimationFrame(resize);
}

function sidebarRow(field: SidebarField, entity: OverworldEntity, raw = {} as Record<string, unknown>): string {
  const editable = field.editable === false ? "false" : "true";
  return `
    <div class="sidebar-row">
      <div class="sidebar-label">${escapeHtml(field.label)}</div>
      <div class="sidebar-val" data-field-key="${escapeHtml(field.key)}" data-narc="overworld" contenteditable="${editable}" data-type="int-65535">${escapeHtml(String(entityFieldValue(entity, field.key, raw)))}</div>
    </div>
  `;
}

function renderEntityActions(project: ProjectState, entity: OverworldEntity | undefined): string {
  if (entity?.kind !== "warp") return "";
  const target = warpTargetForZone(project, entity.targetZone);
  const disabled = target === undefined ? "disabled" : "";
  const label =
    target === undefined
      ? `Target zone ${entity.targetZone} not found`
      : `Open ${target.locationName}${target.matrixId !== 0 ? ` (Matrix ${target.matrixId})` : ""}`;
  return `
    <div class="sidebar-btns overworld-entity-action-row">
      <button class="ow-btn" id="open-warp-target" type="button" ${disabled}>${escapeHtml(label)}</button>
    </div>
  `;
}

function warpTargetForZone(project: ProjectState, zoneId: number): { overworldId: number; locationName: string; matrixId: number } | undefined {
  const rows = project.headers?.rows ?? {};
  for (const row of Object.values(rows)) {
    if (Number(row.index) !== zoneId) continue;
    const overworldId = Number(row.overworlds_id ?? row.map_id);
    if (!Number.isSafeInteger(overworldId)) return undefined;
    return {
      overworldId,
      locationName: String(row.location_name ?? `Zone ${zoneId}`),
      matrixId: Number(row.matrix_id ?? 0),
    };
  }
  return undefined;
}

function overworldRouteUrl(overworldId: number): string {
  const url = new URL(window.location.href);
  url.hash = `overworlds/${overworldId}`;
  return url.href;
}

function updateEntityTabs(root: ParentNode, activeKind: OverworldEntityKind): void {
  root.querySelectorAll<HTMLButtonElement>(".ow-entity-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.kind === activeKind);
  });
}

function entitiesByKind(scene: OverworldScene, kind: OverworldEntityKind): OverworldEntity[] {
  if (kind === "npc") return scene.npcs;
  if (kind === "furniture") return scene.furniture;
  if (kind === "warp") return scene.warps;
  return scene.triggers;
}

function entityBySelection(scene: OverworldScene, selection: OverworldEntitySelection | undefined): OverworldEntity | undefined {
  if (!selection) return undefined;
  return entitiesByKind(scene, selection.kind).find((entity) => entity.index === selection.index);
}

function cellKey(map: Pick<OverworldMapScene, "x" | "y">): string {
  return `${map.x},${map.y}`;
}

function mapForPoint(scene: OverworldScene, x: number, y: number): OverworldMapScene | undefined {
  return scene.maps.find((map) => x >= map.x && y >= map.y && x < map.x + map.width && y < map.y + map.height);
}

function initialActiveCellKey(scene: OverworldScene, selection: OverworldEntitySelection | undefined): string {
  const entity = entityBySelection(scene, selection);
  const map = entity ? mapForPoint(scene, entity.x, entity.y) : undefined;
  return cellKey(map ?? scene.maps[0] ?? { x: 0, y: 0 });
}

function isSelected(selection: OverworldEntitySelection | undefined, kind: OverworldEntityKind, index: number): boolean {
  return selection?.kind === kind && selection.index === index;
}

function entityOptionLabel(entity: OverworldEntity): string {
  const suffix = entity.kind !== "npc" && entity.isRail ? " rail" : "";
  return `${entityKindLabel(entity.kind)} ${entity.index}${suffix}`;
}

function entityKindLabel(kind: OverworldEntityKind): string {
  return kind === "npc" ? "NPC" : kind[0]!.toUpperCase() + kind.slice(1);
}

function sidebarFields(entity: OverworldEntity): SidebarField[] {
  if (entity.kind === "npc") return NPC_FIELDS.map((field) => ({ key: field, label: field, editable: field !== "overworld_id" }));
  if (entity.kind === "furniture") {
    return [
      { key: "script", label: "script" },
      { key: "condition", label: "condition" },
      { key: "interactibility", label: "interactibility" },
      { key: "isRail", label: "is rail" },
      { key: "gridX", label: "grid x", showWhenGrid: true },
      { key: "gridZ", label: "grid y", showWhenGrid: true },
      { key: "railLineNo", label: "rail line", showWhenRail: true },
      { key: "railFrontPos", label: "rail front", showWhenRail: true },
      { key: "railSidePos", label: "rail side", showWhenRail: true },
      { key: "railUnused", label: "rail unused", showWhenRail: true },
      { key: "altitude", label: "y" },
    ].filter((field) => fieldVisible(field, entity));
  }
  if (entity.kind === "warp") {
    return [
      { key: "targetZone", label: "target zone" },
      { key: "targetWarpId", label: "target warp" },
      { key: "contactDirection", label: "contact dir" },
      { key: "transitionType", label: "transition" },
      { key: "isRail", label: "is rail" },
      { key: "gridX", label: "grid x", showWhenGrid: true },
      { key: "worldY", label: "y", showWhenGrid: true },
      { key: "gridZ", label: "grid y", showWhenGrid: true },
      { key: "railLineNo", label: "rail line", showWhenRail: true },
      { key: "railFrontPos", label: "rail front", showWhenRail: true },
      { key: "railSidePos", label: "rail side", showWhenRail: true },
      { key: "width", label: "width" },
      { key: "height", label: "height" },
      { key: "unknown", label: "unknown" },
    ].filter((field) => fieldVisible(field, entity));
  }
  return [
    { key: "script", label: "script" },
    { key: "variable", label: "variable" },
    { key: "value", label: "value" },
    { key: "type", label: "type" },
    { key: "isRail", label: "is rail" },
    { key: "gridX", label: "grid x", showWhenGrid: true },
    { key: "gridZ", label: "grid y", showWhenGrid: true },
    { key: "railLineNo", label: "rail line", showWhenRail: true },
    { key: "railFrontPos", label: "rail front", showWhenRail: true },
    { key: "railSidePos", label: "rail side", showWhenRail: true },
    { key: "width", label: "width" },
    { key: "height", label: "height" },
    { key: "worldY", label: "y", showWhenGrid: true },
    { key: "unknown", label: "unknown" },
  ].filter((field) => fieldVisible(field, entity));
}

function fieldVisible(field: SidebarField, entity: OverworldFurniture | OverworldWarp | OverworldTrigger): boolean {
  if (field.showWhenRail) return entity.isRail;
  if (field.showWhenGrid) return !entity.isRail;
  return true;
}

function entityFieldValue(entity: OverworldEntity, key: string, raw: Record<string, unknown>): number | boolean {
  if (entity.kind === "npc") return Number(raw[`npc_${entity.index}_${key}`] ?? sceneRawNpcValue(entity, key));
  return Number((entity as unknown as Record<string, number | boolean>)[key] ?? 0);
}

function sceneRawNpcValue(entity: OverworldNpc, key: string): number {
  if (key === "overworld_id") return entity.overworldId;
  if (key === "overworld_sprite") return entity.spriteId;
  if (key === "x_cord") return entity.x;
  if (key === "y_cord") return entity.y;
  if (key === "z_cord") return entity.z;
  if (key === "direction") return entity.direction;
  return 0;
}

function drawMap(
  context: CanvasRenderingContext2D,
  map: OverworldMapScene,
  size: number,
  panX: number,
  panY: number,
  origin = { x: 0, y: 0 },
): void {
  const startX = panX + (map.x - origin.x) * size;
  const startY = panY + (map.y - origin.y) * size;
  if (map.empty || map.missing) {
    context.fillStyle = map.missing ? "#3b2430" : "#202330";
    context.fillRect(startX, startY, map.width * size, map.height * size);
  } else {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const index = y * map.width + x;
        const permission = map.layer2[index] ?? 0;
        const collision = map.layer3[index] ?? 0;
        context.fillStyle =
          map.permissionFormat === "gen4"
            ? gen4PermissionTileFill({ type: permission, collision, blocked: (collision & 0x80) !== 0 })
            : mapPermissionColor(permission).color;
        context.fillRect(startX + x * size, startY + y * size, Math.ceil(size), Math.ceil(size));
        context.strokeStyle = "rgba(40, 42, 54, 0.35)";
        context.strokeRect(startX + x * size, startY + y * size, size, size);
      }
    }
  }
  context.strokeStyle = "#bd93f9";
  context.lineWidth = 2;
  context.strokeRect(startX, startY, map.width * size, map.height * size);
}

function drawTrueMap(
  context: CanvasRenderingContext2D,
  render: OverworldMapRender,
  placement: { x: number; y: number; width: number; height: number },
  size: number,
  panX: number,
  panY: number,
): void {
  const startX = panX + placement.x * size;
  const startY = panY + placement.y * size;
  const width = placement.width * size;
  const height = placement.height * size;
  context.drawImage(render.canvas, startX, startY, width, height);
  context.strokeStyle = "rgba(189, 147, 249, 0.7)";
  context.lineWidth = 2;
  context.strokeRect(startX, startY, width, height);
}

function drawTrueMapSection(
  context: CanvasRenderingContext2D,
  render: OverworldMapRender,
  fullPlacement: { x: number; y: number; width: number; height: number },
  section: { x: number; y: number; width: number; height: number },
  size: number,
  panX: number,
  panY: number,
): void {
  const sourceX = ((section.x - fullPlacement.x) / fullPlacement.width) * render.canvas.width;
  const sourceY = ((section.y - fullPlacement.y) / fullPlacement.height) * render.canvas.height;
  const sourceWidth = (section.width / fullPlacement.width) * render.canvas.width;
  const sourceHeight = (section.height / fullPlacement.height) * render.canvas.height;
  const width = section.width * size;
  const height = section.height * size;
  context.drawImage(render.canvas, sourceX, sourceY, sourceWidth, sourceHeight, panX, panY, width, height);
  context.strokeStyle = "rgba(189, 147, 249, 0.7)";
  context.lineWidth = 2;
  context.strokeRect(panX, panY, width, height);
}

function mapRenderTileBounds(render: OverworldMapRender): { x: number; y: number; width: number; height: number } {
  return {
    x: (render.worldBounds.minX - render.worldOrigin.x) / render.unitsPerTile,
    y: (render.worldBounds.minZ - render.worldOrigin.z) / render.unitsPerTile,
    width: render.worldBounds.width / render.unitsPerTile,
    height: render.worldBounds.height / render.unitsPerTile,
  };
}

function mapViewTileBounds(scene: OverworldScene, render: OverworldMapRender, isGen4: boolean): { x: number; y: number; width: number; height: number } {
  if (isGen4) return mapGridBounds(scene);
  return mapRenderTileBounds(render);
}

function mapGridBounds(scene: OverworldScene): { x: number; y: number; width: number; height: number } {
  const maps = scene.maps.length > 0 ? scene.maps : [{ x: 0, y: 0, width: scene.width, height: scene.height }];
  const minX = Math.min(...maps.map((map) => map.x), 0);
  const minY = Math.min(...maps.map((map) => map.y), 0);
  const maxX = Math.max(...maps.map((map) => map.x + map.width), scene.width, 1);
  const maxY = Math.max(...maps.map((map) => map.y + map.height), scene.height, 1);
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function mapRenderCacheKey(project: ProjectState, overworldId: number, zoneId: number): string {
  return `${MAP_RENDER_CACHE_VERSION}:${project.session.baseVersion}:${project.session.romName}:${overworldId}:${zoneId}:${MAP_VIEW_SEASON}`;
}

function associatedMapZoneId(scene: OverworldScene): number {
  return Number(scene.header.index);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName);
}

function renderNpc(
  project: ProjectState,
  npc: OverworldNpc,
  worldToScreen: (x: number, y: number) => { x: number; y: number; tileSize: number },
  selected: boolean,
): string {
  const position = worldToScreen(npc.x, npc.y);
  const size = Math.max(position.tileSize, MIN_NPC_SCREEN_SIZE);
  const offset = (size - position.tileSize) / 2;
  const isGen4 = isGen4Project(project);
  const romSprite = isGen4 ? getGen4OverworldSpriteDataUrl(project, npc.spriteId, npc.direction) : undefined;
  const specialIcon = isGen4 && !romSprite ? gen4SpecialOverworldIconName(npc.spriteId) : undefined;
  const spriteSrc = isGen4 ? (romSprite ?? (specialIcon ? publicAsset(`images/overworlds/gen4-special/${specialIcon}.png`) : undefined)) : publicAsset(`images/overworlds/${npc.spriteSlug}.png`);
  if (!spriteSrc) {
    return `
      <div class="overworld-item overworld-npc missing-sprite ${selected ? "selected" : ""}" data-kind="npc" data-index="${npc.index}" data-dir="${npc.direction}" title="npc-${npc.index}"
        style="left:${position.x - offset}px;top:${position.y - offset}px;width:${size}px;height:${size}px">
        <span>${npc.overworldId}</span>
      </div>
    `;
  }
  const spriteAttrs = isGen4 ? `data-rom-sprite="true"` : `onerror="this.hidden=true;this.parentElement?.classList.add('missing-sprite')"`;
  return `
    <div class="overworld-item overworld-npc ${selected ? "selected" : ""}" data-kind="npc" data-index="${npc.index}" data-dir="${npc.direction}" title="npc-${npc.index}"
      style="left:${position.x - offset}px;top:${position.y - offset}px;width:${size}px;height:${size}px">
      <img class="overworld-sprite" src="${escapeHtml(spriteSrc)}" alt="" ${spriteAttrs} />
      <span>${npc.overworldId}</span>
    </div>
  `;
}

function renderGridEntity(
  entity: OverworldFurniture | OverworldWarp | OverworldTrigger,
  worldToScreen: (x: number, y: number) => { x: number; y: number; tileSize: number },
  selected: boolean,
): string {
  const position = worldToScreen(entity.x, entity.y);
  const widthTiles = entity.kind === "furniture" ? 0.7 : Math.max(1, entity.width);
  const heightTiles = entity.kind === "furniture" ? 0.7 : Math.max(1, entity.height);
  const width = Math.max(14, position.tileSize * widthTiles);
  const height = Math.max(14, position.tileSize * heightTiles);
  const offsetX = entity.kind === "furniture" ? (width - position.tileSize) / 2 : 0;
  const offsetY = entity.kind === "furniture" ? (height - position.tileSize) / 2 : 0;
  return `
    <div class="overworld-item overworld-grid-entity overworld-${entity.kind} ${selected ? "selected" : ""}"
      data-kind="${entity.kind}" data-index="${entity.index}" title="${escapeHtml(entityKindLabel(entity.kind))} ${entity.index}"
      style="left:${position.x - offsetX}px;top:${position.y - offsetY}px;width:${width}px;height:${height}px">
      <span>${escapeHtml(entity.kind[0]!.toUpperCase())}${entity.index}</span>
    </div>
  `;
}

function adjustSpriteDirections(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>(".overworld-sprite").forEach((image) => {
    if (image.dataset.romSprite === "true") {
      image.style.top = "0";
      image.style.transform = "";
      return;
    }
    const apply = () => {
      const frameCount = Math.round(image.naturalHeight / 32);
      const direction = Number(image.parentElement?.dataset.dir ?? 0);
      const frameSize = image.parentElement?.getBoundingClientRect().width ?? 32;
      const offset = spriteDirectionOffset(frameCount, direction);
      image.style.transform = "";
      if (offset === "f") {
        image.style.top = `${-5 * frameSize}px`;
        image.style.transform = "scaleX(-1)";
      } else {
        image.style.top = `${-offset * frameSize}px`;
      }
    };
    if (image.complete && image.naturalHeight > 0) apply();
    else image.addEventListener("load", apply, { once: true });
  });
}

function spriteDirectionOffset(frameCount: number, direction: number): number | "f" {
  let offsets: Array<number | "f"> = [0, 0, 0, 0];
  if (frameCount >= 12) offsets = [0, 3, 6, 9];
  if (frameCount === 16) offsets = [0, 4, 8, 12];
  if (frameCount === 2) offsets = [0, 4, 8, 12];
  if (frameCount === 6 || frameCount === 7 || frameCount === 9) offsets = [0, 3, 5, "f"];
  return offsets[Math.min(Math.max(direction, 0), offsets.length - 1)] ?? 0;
}

function tileAt(scene: OverworldScene, point: { x: number; y: number }): { mapId: number; index: number; x: number; y: number; layer2: number; layer3: number } | undefined {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  for (const map of scene.maps) {
    if (map.empty || map.missing) continue;
    const localX = x - map.x;
    const localY = y - map.y;
    if (localX < 0 || localY < 0 || localX >= map.width || localY >= map.height) continue;
    const index = localY * map.width + localX;
    return {
      mapId: map.id,
      index,
      x,
      y,
      layer2: map.layer2[index] ?? 0,
      layer3: map.layer3[index] ?? 0,
    };
  }
  return undefined;
}

function selectedEntityBounds(scene: OverworldScene, selection: OverworldEntitySelection | undefined): { x: number; y: number; width: number; height: number } | undefined {
  const entity = entityBySelection(scene, selection);
  if (!entity) return undefined;
  if (entity.kind === "npc") return { x: entity.x - 8, y: entity.y - 8, width: 16, height: 16 };
  if (entity.isRail) return undefined;
  return {
    x: entity.x - 4,
    y: entity.y - 4,
    width: Math.max(8, entity.kind === "furniture" ? 1 : entity.width),
    height: Math.max(8, entity.kind === "furniture" ? 1 : entity.height),
  };
}

function sceneBounds(scene: OverworldScene, focus?: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const xs = scene.maps.flatMap((map) => [map.x, map.x + map.width]);
  const ys = scene.maps.flatMap((map) => [map.y, map.y + map.height]);
  if (focus) {
    xs.push(focus.x, focus.x + focus.width);
    ys.push(focus.y, focus.y + focus.height);
  }
  if (xs.length === 0 || ys.length === 0) return { x: 0, y: 0, width: 32, height: 32 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
  };
}
