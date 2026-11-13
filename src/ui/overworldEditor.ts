import {
  addOverworldEntity,
  deleteOverworldEntity,
  getOverworldScene,
  moveOverworldEntity,
  NPC_FIELDS,
  OVERWORLD_ENTITY_KINDS,
  spriteDirectionOffset,
  updateMapPermissionTiles,
  updateMapTile,
  updateOverworldEntityField,
  type MapPermissionTileEdit,
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
import type { OverworldTestWarpSelection } from "../pokeweb/testOverworldWarp";
import { escapeHtml, selectText } from "./dom";
import { changedKeys } from "./detailFields";
import { installPicker } from "./trainerInteractions";
import { openItemShortcut, openSpritePicker, openTrainerShortcut, spriteClassLabels } from "./overworldShortcuts";
import { buildTrainerOverworldIndex, supportsOverworldShortcuts } from "../pokeweb/overworldShortcutModel";
import { publicAsset } from "../assetUrl";
import { gen4PermissionTileFill } from "./gen4MapPreviewRenderer";
import type { OverworldMapRender } from "./overworldMapRenderer";
import { clampU16, formatHex16, GEN5_PERMISSION_FLAGS, gen5PermissionColorHex } from "../pokeweb/gen5PermissionModel";
import "../styles/overworldData.css";

const TILE_SIZE = 32;
const MAP_VIEW_TILE_SCALE = 1;
const MAP_VIEW_SEASON = "spring";
const WHEEL_ZOOM_STEP = 0.025;
const MAP_RENDER_CACHE_VERSION = 10;
const MIN_ZOOM = 0.05;
const MIN_NPC_SCREEN_SIZE = 18;
const ENTITY_DRAG_START_PX = 6;
const GEN5_STAGE_PADDING = 48;
const MAX_ZOOM = 3;

type OverworldViewMode = "permissions" | "map";
type SidebarTab = OverworldEntityKind | "permissions";
type SidebarFieldOption = { value: number; label: string };
type FieldGroup = "identity" | "behaviour" | "destination" | "event" | "position" | "advanced";
type SidebarField = {
  key: string;
  label: string;
  group: FieldGroup;
  editable?: boolean;
  showWhenRail?: boolean;
  showWhenGrid?: boolean;
  options?: readonly SidebarFieldOption[];
  title?: string;
};
type ActiveCellViewport = { key: string; x: number; y: number; width: number; height: number; map?: OverworldMapScene };
type PermissionTileSelection = { mapId: number; index: number; x: number; y: number; layer2: number; layer3: number };
type PermissionGridLayout = { x: number; y: number; cellSize: number; bounds: { x: number; y: number; width: number; height: number } };
type OverworldLayer = OverworldEntityKind | "permissions";

const mapRenderCache = new Map<string, Promise<OverworldMapRender> | OverworldMapRender>();
const MAP_RENDER_CACHE_LIMIT = 6;

/** Layer visibility survives switching between overworlds; the permission overlay starts off. */
const layerPrefs: Record<OverworldLayer, boolean> & { opacity: number; matrix: boolean } = {
  npc: true,
  furniture: true,
  warp: true,
  trigger: true,
  permissions: false,
  opacity: 0.45,
  matrix: false,
};

const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  identity: "Identity",
  behaviour: "Behaviour",
  destination: "Destination",
  event: "Event",
  position: "Position",
  advanced: "Advanced",
};

const MOVEMENT_MODIFIER_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 0, label: "Normal" },
  { value: 1, label: "Trainer sight" },
  { value: 2, label: "All-direction trainer sight" },
  { value: 3, label: "Item" },
  { value: 4, label: "Trainer look-around pause" },
  { value: 5, label: "Trainer spin pause left" },
  { value: 6, label: "Trainer spin pause right" },
  { value: 7, label: "Trainer spin while moving left" },
  { value: 8, label: "Trainer spin while moving right" },
  { value: 9, label: "Message ID" },
  { value: 10, label: "Trainer escape/reversal" },
  { value: 11, label: "Dash direction change" },
  { value: 12, label: "Dash movement burst" },
  { value: 13, label: "Dash-accelerated movement" },
  { value: 14, label: "Dash-accelerated look-around" },
  { value: 15, label: "Dash spin pause left" },
  { value: 16, label: "Dash spin pause right" },
  { value: 17, label: "Dash spin while moving left" },
  { value: 18, label: "Dash spin while moving right" },
  { value: 19, label: "Dash movement non-trainer" },
  { value: 20, label: "Non-trainer spin pause" },
];

/* Field model directions (MMDL_DIR_*): 0 up, 1 down, 2 left, 3 right. */
const FACING_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 0, label: "Up" },
  { value: 1, label: "Down" },
  { value: 2, label: "Left" },
  { value: 3, label: "Right" },
];

/* BgEventData.dir, matched against the player's facing in EVENTDATA_SYSTEM_SearchBgEventScriptId. */
const BG_FACING_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 0, label: "Facing up" },
  { value: 1, label: "Facing right" },
  { value: 2, label: "Facing left" },
  { value: 3, label: "Facing down" },
  { value: 4, label: "Any direction" },
  { value: 5, label: "Facing left or right" },
  { value: 6, label: "Facing up or down" },
];

/* BgEventData.type: 2 is a hidden item (its flag is checked instead of the facing). */
const BG_TYPE_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 0, label: "Talk" },
  { value: 2, label: "Hidden item" },
];

/* ConnectData.exitDir (EVENTDATA_SYSTEM_ConnectExitDirToDir); 0 never matches a walking direction. */
const EXIT_DIRECTION_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 0, label: "None" },
  { value: 1, label: "Up" },
  { value: 2, label: "Down" },
  { value: 3, label: "Left" },
  { value: 4, label: "Right" },
];

/* EventRec.checkType: 1-4 from EVENTDATA_SYSTEM_DirToPosEventType, 6 runs automatically. */
const TRIGGER_TYPE_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 1, label: "Moving up" },
  { value: 2, label: "Moving down" },
  { value: 3, label: "Moving left" },
  { value: 4, label: "Moving right" },
  { value: 6, label: "Automatic" },
];

const POSITION_TYPE_OPTIONS: readonly SidebarFieldOption[] = [
  { value: 0, label: "Grid" },
  { value: 1, label: "Rail" },
];

/* MmdlHeader layout (fldmmdl_types.h). */
const NPC_FIELD_DEFS: Record<string, Omit<SidebarField, "key">> = {
  overworld_id: { label: "Object ID", group: "identity", editable: false },
  overworld_sprite: { label: "Sprite", group: "identity" },
  script_id: { label: "Script", group: "identity" },
  overworld_flag: { label: "Event flag", group: "identity" },
  movement_permissions_2: { label: "Event type", group: "behaviour" },
  movement_permissions: { label: "Movement", group: "behaviour" },
  direction: { label: "Facing", group: "behaviour" },
  sight: { label: "Sight range", group: "behaviour", title: "Param 0" },
  unknown_1: { label: "Param 1", group: "behaviour", title: "Modifier step count" },
  unknown_2: { label: "Param 2", group: "behaviour" },
  horizontal_leash: { label: "Move limit X", group: "behaviour" },
  vertical_leash: { label: "Move limit Y", group: "behaviour" },
  x_cord: { label: "X", group: "position" },
  y_cord: { label: "Y", group: "position" },
  z_cord: { label: "Z", group: "position" },
  unknown_3: { label: "Position type", group: "advanced", title: "0 grid, otherwise rail" },
  unknown_4: { label: "Position type (high)", group: "advanced" },
  unknown_5: { label: "Height (low)", group: "advanced" },
};

const NPC_FIELD_ORDER = [
  "overworld_id",
  "overworld_sprite",
  "script_id",
  "overworld_flag",
  "movement_permissions_2",
  "movement_permissions",
  "direction",
  "sight",
  "unknown_1",
  "unknown_2",
  "horizontal_leash",
  "vertical_leash",
  "x_cord",
  "y_cord",
  "z_cord",
  "unknown_3",
  "unknown_4",
  "unknown_5",
];

const LAYER_LABELS: Record<OverworldLayer, string> = {
  npc: "NPCs",
  furniture: "Furniture",
  warp: "Warps",
  trigger: "Triggers",
  permissions: "Permissions",
};

const PERMISSION_LEGEND: ReadonlyArray<{ label: string; color: string }> = [
  { label: "Walkable", color: "#7bd88f" },
  { label: "Blocked", color: "#ff4d4f" },
  { label: "Water", color: "#3da5ff" },
  { label: "Grass", color: "#42d66b" },
  { label: "Sand", color: "#d8b35a" },
  { label: "Encounter", color: "#ffc857" },
  { label: "Special", color: "#8de8ff" },
  { label: "Reflection", color: "#a78bfa" },
  { label: "Shadow", color: "#a5b4c8" },
];

export function renderOverworldEditor(
  project: ProjectState,
  root: HTMLElement,
  overworldId: number,
  onDirty?: () => void,
  onBack?: () => void,
  onTestWarp?: (selection: OverworldTestWarpSelection) => Promise<void>,
  headerRowId?: number,
  onOpenOverworld?: (overworldId: number) => void,
): void {
  let scene = getOverworldScene(project, overworldId, headerRowId);
  const isGen4 = isGen4Project(project);
  const shortcuts = supportsOverworldShortcuts(project);
  const tileLayerLabels = isGen4 ? { flag: "Type", movement: "Collision" } : { flag: "Flag", movement: "Movement" };
  let activeKind: OverworldEntityKind = "npc";
  let activeSidebarTab: SidebarTab = "npc";
  let selectedEntity: OverworldEntitySelection | undefined = scene.npcs[0] ? { kind: "npc", index: scene.npcs[0].index } : undefined;
  let selectedTile: PermissionTileSelection | undefined;
  let activeCellKey = isGen4 ? initialActiveCellKey(scene, selectedEntity) : "";
  const permissionBrush = { tileClass: 0, flags: 0, painting: false };
  const pendingPaintEdits = new Map<string, MapPermissionTileEdit>();
  let permissionGridLayout: PermissionGridLayout | undefined;

  const testWarpHtml =
    project.session.baseRom === "BW2" && onTestWarp
      ? `<div class="overworld-test-warp" id="test-warp-controls" hidden>
          <button class="btn sm -default" id="test-warp-here" type="button">Test warp here</button>
          <div class="overworld-test-warp-status" id="test-warp-status" role="status"></div>
        </div>`
      : "";
  const layerChip = (layer: OverworldLayer) =>
    `<label class="ow-chip" title="Show ${escapeHtml(LAYER_LABELS[layer].toLowerCase())}"><input type="checkbox" data-layer="${layer}" ${layerPrefs[layer] ? "checked" : ""}><span class="ow-chip-dot -${layer}"></span>${escapeHtml(LAYER_LABELS[layer])}</label>`;

  root.innerHTML = `
    <div id="overworld-editor" class="ow-shell ${isGen4 ? "-gen4" : "-gen5"}">
      <aside class="ow-side">
        <header class="ow-head" data-index="${overworldId}">
          <div class="ow-file-row">
            <button class="btn sm -ghost" type="button" data-ow-step="-1" aria-label="Previous overworld" title="Previous overworld">&lsaquo;</button>
            <div class="ow-file-picker"><div contenteditable="true" spellcheck="false" data-ow-picker aria-label="Overworld file"></div></div>
            <button class="btn sm -ghost" type="button" data-ow-step="1" aria-label="Next overworld" title="Next overworld">&rsaquo;</button>
          </div>
          <h1>${escapeHtml(scene.locationName)}</h1>
          <div class="ow-sub">Overworld ${overworldId} · Matrix ${scene.matrixId}</div>
        </header>
        <div class="md-tabs ow-tabs" role="tablist" aria-label="Edit">
          ${OVERWORLD_ENTITY_KINDS.map((kind) => `<button class="uv-tab ow-entity-tab" data-sidebar-tab="${kind}" type="button" role="tab" aria-selected="${kind === activeSidebarTab}">${escapeHtml(LAYER_LABELS[kind])}</button>`).join("")}
          ${isGen4 ? "" : `<button class="uv-tab ow-entity-tab" data-sidebar-tab="permissions" type="button" role="tab" aria-selected="false">Permissions</button>`}
        </div>
        <div id="entity-sidebar-content" class="ow-entity-panel">
          <div class="ow-block ow-pick">
            <div class="ow-pick-row">
              <button class="btn sm -default" id="entity-prev" type="button" aria-label="Previous" title="Previous">&lsaquo;</button>
              <select class="ow-select" id="entity-select" aria-label="Selected"></select>
              <button class="btn sm -default" id="entity-next" type="button" aria-label="Next" title="Next">&rsaquo;</button>
            </div>
            <div class="ow-pick-actions" id="entity-command-buttons">
              <button class="btn sm -default" id="add-entity" type="button">Add NPC</button>
              <button class="btn sm -default" id="del-entity" type="button" title="Delete (Del)">Delete</button>
              ${shortcuts ? `<button class="btn sm -default" id="add-trainer" type="button" title="Place a trainer that battles on sight">+ Trainer</button>
              <button class="btn sm -default" id="add-item" type="button" title="Place an item ball">+ Item</button>` : ""}
            </div>
          </div>
          <div class="ow-fields" id="entity-fields"></div>
          <div class="ow-entity-actions" id="entity-actions"></div>
        </div>
        ${
          isGen4
            ? `<div class="ow-block popup-editor field-holder" id="tile-editor">
                <div class="ow-group-title">Tile</div>
                <div class="popup-field-row">
                  <div class="popup-field-label">${tileLayerLabels.flag}</div>
                  <div class="popup-field" data-layer="2" id="tile-flag" contenteditable="true" data-type="int-65535">0</div>
                </div>
                <div class="popup-field-row">
                  <div class="popup-field-label">${tileLayerLabels.movement}</div>
                  <div class="popup-field" data-layer="3" id="tile-mov" contenteditable="true" data-type="int-65535">0</div>
                </div>
              </div>`
            : `<div id="permission-sidebar-content" class="ow-permission-panel" hidden>${renderGen5PermissionControls(testWarpHtml)}</div>`
        }
      </aside>
      <section class="ow-main">
        <div class="ow-toolbar">
          ${
            isGen4
              ? `<div class="ow-view-toggle" role="group" aria-label="View">
                  <button class="btn sm -default" id="view-permissions" type="button" aria-pressed="true">Permissions</button>
                  <button class="btn sm -default" id="view-map" type="button" aria-pressed="false">Map</button>
                </div>`
              : ""
          }
          <div class="ow-layers" role="group" aria-label="Layers">
            ${OVERWORLD_ENTITY_KINDS.map(layerChip).join("")}
            ${
              isGen4
                ? ""
                : `${layerChip("permissions")}<input class="ow-opacity" id="ow-permission-opacity" type="range" min="10" max="90" step="5" value="${Math.round(layerPrefs.opacity * 100)}" aria-label="Permission overlay opacity" title="Overlay opacity" ${layerPrefs.permissions ? "" : "hidden"}>`
            }
          </div>
          <span class="ow-cursor" id="ow-cursor" aria-live="off"></span>
          <div class="ow-zoom" role="group" aria-label="Zoom">
            <button class="btn sm -default" id="zoom-out" type="button" aria-label="Zoom out">&minus;</button>
            <span class="ow-zoom-label" id="zoom-label" title="${isGen4 ? "Scroll to zoom" : "Pinch or ⌘-scroll to zoom"}">100%</span>
            <button class="btn sm -default" id="zoom-in" type="button" aria-label="Zoom in">+</button>
            <button class="btn sm -default" id="zoom-fit" type="button" title="Fit the map">Fit</button>
          </div>
          ${isGen4 ? "" : `<button class="btn sm -default" id="toggle-matrix" type="button" aria-pressed="${layerPrefs.matrix}" title="Permissions matrix">Matrix</button>`}
          ${testWarpHtml ? `<button class="btn sm -default" id="warp-pick" type="button" aria-pressed="false" title="Click a tile on the map to open the game there">Open Game &amp; Warp Here</button>` : ""}
        </div>
        ${isGen4 ? "" : `<div class="ow-legend" id="ow-legend" ${layerPrefs.permissions ? "" : "hidden"}>${renderPermissionLegend()}</div>`}
        <div class="ow-body">
          <div class="ow-viewport ${isGen4 ? "" : "-gen5"}" id="ow-viewport">
            <div class="overworld-stage">
              <canvas class="overworld-map" id="overworld-canvas"></canvas>
              ${
                isGen4
                  ? `<div class="overworld-cell-nav" role="group" aria-label="Map section">
                      <button class="btn sm -default overworld-cell-button overworld-cell-left" id="cell-left" type="button" title="Previous section west">&larr;</button>
                      <button class="btn sm -default overworld-cell-button overworld-cell-up" id="cell-up" type="button" title="Previous section north">&uarr;</button>
                      <span class="overworld-cell-label" id="cell-label"></span>
                      <button class="btn sm -default overworld-cell-button overworld-cell-down" id="cell-down" type="button" title="Next section south">&darr;</button>
                      <button class="btn sm -default overworld-cell-button overworld-cell-right" id="cell-right" type="button" title="Next section east">&rarr;</button>
                    </div>`
                  : ""
              }
              <div class="overworld-map-status" id="overworld-map-status" hidden></div>
              <div class="overworld-entities" id="overworld-entities"></div>
            </div>
          </div>
          ${isGen4 ? "" : renderGen5PermissionMatrix()}
        </div>
      </section>
    </div>
  `;

  const stage = root.querySelector<HTMLDivElement>(".overworld-stage");
  const overworldPane = root.querySelector<HTMLDivElement>("#ow-viewport");
  const canvas = root.querySelector<HTMLCanvasElement>("#overworld-canvas");
  const entities = root.querySelector<HTMLDivElement>("#overworld-entities");
  const tileEditor = root.querySelector<HTMLDivElement>("#tile-editor");
  const zoomLabel = root.querySelector<HTMLElement>("#zoom-label");
  const cursorReadout = root.querySelector<HTMLElement>("#ow-cursor");
  const legend = root.querySelector<HTMLElement>("#ow-legend");
  const opacityInput = root.querySelector<HTMLInputElement>("#ow-permission-opacity");
  const matrixToggle = root.querySelector<HTMLButtonElement>("#toggle-matrix");
  const mapStatus = root.querySelector<HTMLDivElement>("#overworld-map-status");
  const permissionGrid = root.querySelector<HTMLCanvasElement>("#permission-grid-canvas");
  const permissionClassInput = root.querySelector<HTMLInputElement>("#ow-permission-class");
  const permissionFlagsInput = root.querySelector<HTMLInputElement>("#ow-permission-flags");
  const permissionSelected = root.querySelector<HTMLDivElement>("#permission-selected");
  const permissionSwatch = root.querySelector<HTMLElement>("#ow-permission-swatch");
  const permissionPaintToggle = root.querySelector<HTMLInputElement>("#ow-permission-paint");
  const permissionMatrix = root.querySelector<HTMLElement>("#ow-matrix");
  const entitySidebarContent = root.querySelector<HTMLDivElement>("#entity-sidebar-content");
  const permissionSidebarContent = root.querySelector<HTMLDivElement>("#permission-sidebar-content");
  const testWarpControls = root.querySelector<HTMLDivElement>("#test-warp-controls");
  const testWarpButton = root.querySelector<HTMLButtonElement>("#test-warp-here");
  const testWarpStatus = root.querySelector<HTMLDivElement>("#test-warp-status");
  if (!stage || !overworldPane || !canvas || !entities) return;
  const stageEl = stage;
  const overworldPaneEl = overworldPane;
  const entityLayer = entities;

  // ---------- Overworld file picker ----------
  const fileOptions = overworldFileOptions(project);
  const filePicker = root.querySelector<HTMLElement>("[data-ow-picker]");
  if (filePicker) {
    const label = () => fileOptions[overworldId] ?? `Overworld ${overworldId}`;
    filePicker.textContent = label();
    const picker = installPicker(filePicker, fileOptions);
    const open = (id: number) => {
      if (id === overworldId || id < 0 || id >= fileOptions.length) {
        filePicker.textContent = label();
        return;
      }
      onOpenOverworld?.(id);
    };
    filePicker.addEventListener("focus", () => {
      window.setTimeout(() => {
        if (document.activeElement !== filePicker) return;
        const range = document.createRange();
        range.selectNodeContents(filePicker);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }, 0);
      picker?.open();
    });
    filePicker.addEventListener("keydown", (event) => {
      if (picker?.handleKey(event)) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        if (event.key === "Escape") filePicker.textContent = label();
        filePicker.blur();
      }
    });
    filePicker.addEventListener("blur", () => {
      picker?.close();
      const raw = filePicker.dataset.commitValue ?? filePicker.textContent ?? "";
      delete filePicker.dataset.commitValue;
      delete filePicker.dataset.commitLabel;
      const match = /\bOverworld (\d+)\s*$/u.exec(raw) ?? /^\s*(\d+)\s*$/u.exec(raw);
      const query = raw.trim().toLowerCase();
      const id = match
        ? Number(match[1])
        : query
          ? fileOptions.findIndex((option) => option.toLowerCase().includes(query))
          : -1;
      open(id);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-ow-step]").forEach((button) => {
      const next = overworldId + Number(button.dataset.owStep);
      button.disabled = next < 0 || next >= fileOptions.length;
      button.addEventListener("click", () => open(next));
    });
  }

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
    viewMode: (isGen4 ? "permissions" : "map") as OverworldViewMode,
    paintingPermissions: false,
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
    scene = getOverworldScene(project, overworldId, headerRowId);
    selectedTile = selectedTile ? tileAt(scene, selectedTile) : undefined;
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

  const resizeCanvasToRect = (rect: DOMRect): void => {
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  };

  const resize = () => {
    const rect = syncGen5ScrollableStage();
    resizeCanvasToRect(rect);
    if (!state.framed && rect.width > 1 && rect.height > 1) frameScene(rect);
    draw();
  };

  const frameScene = (rect = stage.getBoundingClientRect(), whole = false) => {
    const focus = whole ? undefined : selectedEntityBounds(scene, selectedEntity) ?? selectedEntityBounds(scene, { kind: "npc", index: scene.npcs[0]?.index ?? -1 });
    const bounds = displayBounds(focus);
    const fitRect = isGen4 ? rect : overworldPane.getBoundingClientRect();
    const tileSize = activeTileSize();
    const fit = Math.min(fitRect.width / Math.max(1, bounds.width * tileSize), fitRect.height / Math.max(1, bounds.height * tileSize));
    state.zoom = isGen4 ? Math.min(1, Math.max(MIN_ZOOM, fit * 0.85)) : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit * 0.94));
    const frameRect = syncGen5ScrollableStage(bounds);
    resizeCanvasToRect(frameRect);
    centerDisplayBounds(bounds, frameRect);
    state.framed = true;
    updateZoomLabel();
    resetGen5Scroll();
  };

  /** Zooms keeping the world point under the given client position (default: the view centre) fixed. */
  const setZoom = (nextZoom: number, clientX?: number, clientY?: number) => {
    const bounds = displayBounds();
    const tileSize = activeTileSize();
    const previousZoom = state.zoom;
    state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    if (state.zoom === previousZoom) return;
    if (!isGen4) {
      const view = overworldPaneEl.getBoundingClientRect();
      const anchorX = clientX ?? view.left + view.width / 2;
      const anchorY = clientY ?? view.top + view.height / 2;
      const stageRect = stageEl.getBoundingClientRect();
      const worldX = (anchorX - stageRect.left - state.panX) / (tileSize * previousZoom);
      const worldY = (anchorY - stageRect.top - state.panY) / (tileSize * previousZoom);
      const frameRect = syncGen5ScrollableStage(bounds);
      resizeCanvasToRect(frameRect);
      centerDisplayBounds(bounds, frameRect);
      overworldPaneEl.scrollLeft = state.panX + worldX * tileSize * state.zoom - (anchorX - view.left);
      overworldPaneEl.scrollTop = state.panY + worldY * tileSize * state.zoom - (anchorY - view.top);
      updateZoomLabel();
      draw();
      return;
    }
    const rect = stage.getBoundingClientRect();
    const screenX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const screenY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const worldX = (screenX - state.panX) / (tileSize * previousZoom);
    const worldY = (screenY - state.panY) / (tileSize * previousZoom);
    state.panX = screenX - worldX * tileSize * state.zoom;
    state.panY = screenY - worldY * tileSize * state.zoom;
    updateZoomLabel();
    draw();
  };

  function centerDisplayBounds(bounds: { x: number; y: number; width: number; height: number }, rect: DOMRect): void {
    const tileSize = activeTileSize();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    state.panX = rect.width / 2 - centerX * tileSize * state.zoom;
    state.panY = rect.height / 2 - centerY * tileSize * state.zoom;
  }

  function syncGen5ScrollableStage(bounds = displayBounds()): DOMRect {
    if (isGen4) return stageEl.getBoundingClientRect();
    const paneRect = overworldPaneEl.getBoundingClientRect();
    const tileSize = activeTileSize() * state.zoom;
    const width = Math.max(paneRect.width, Math.ceil(bounds.width * tileSize + GEN5_STAGE_PADDING * 2));
    const height = Math.max(paneRect.height, Math.ceil(bounds.height * tileSize + GEN5_STAGE_PADDING * 2));
    const nextWidth = `${width}px`;
    const nextHeight = `${height}px`;
    if (stageEl.style.width !== nextWidth) stageEl.style.width = nextWidth;
    if (stageEl.style.height !== nextHeight) stageEl.style.height = nextHeight;
    return stageEl.getBoundingClientRect();
  }

  function resetGen5Scroll(): void {
    if (isGen4) return;
    const stageRect = stageEl.getBoundingClientRect();
    const view = overworldPaneEl.getBoundingClientRect();
    overworldPaneEl.scrollLeft = Math.max(0, (stageRect.width - view.width) / 2);
    overworldPaneEl.scrollTop = Math.max(0, (stageRect.height - view.height) / 2);
  }

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
      else {
        drawTrueMap(ctx, state.mapRender, mapViewTileBounds(scene, state.mapRender, isGen4), tileSize, state.panX, state.panY);
        if (layerPrefs.permissions) drawGen5PermissionOverlay(ctx, scene, tileSize, state.panX, state.panY, layerPrefs.opacity);
      }
    } else {
      const origin = activeOrigin();
      const maps = isGen4 ? [activeCellViewport().map].filter((map): map is OverworldMapScene => map !== undefined) : scene.maps;
      for (const map of maps) drawMap(ctx, map, tileSize, state.panX, state.panY, origin);
    }
    if (!isGen4) drawSelectedPermissionTile(ctx, selectedTile, tileSize, state.panX, state.panY);
    drawPermissionGrid();
    renderEntityOverlay();
  };

  const setViewMode = (viewMode: OverworldViewMode) => {
    if (!isGen4 && viewMode !== "map") return;
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

  function updatePermissionPanel(): void {
    if (isGen4) return;
    if (testWarpControls) testWarpControls.hidden = !selectedTile;
    if (permissionSelected) {
      permissionSelected.innerHTML = selectedTile
        ? `<div class="ow-tile-line"><span class="ow-swatch" style="background:${gen5PermissionColorHex({ tileClass: selectedTile.layer2, flags: selectedTile.layer3 })}"></span><strong>X ${selectedTile.x}, Y ${selectedTile.y}</strong><span class="ow-muted">map ${selectedTile.mapId}</span></div>
           <div class="ow-tile-line ow-muted">Class ${selectedTile.layer2} · flags ${formatHex16(selectedTile.layer3)} · ${escapeHtml(permissionCategoryLabel(selectedTile.layer2, selectedTile.layer3))}</div>`
        : `<div class="ow-muted">Click a tile on the map to sample it.</div>`;
    }
    if (permissionSwatch) {
      permissionSwatch.style.background = gen5PermissionColorHex({ tileClass: permissionBrush.tileClass, flags: permissionBrush.flags });
      permissionSwatch.title = permissionCategoryLabel(permissionBrush.tileClass, permissionBrush.flags);
    }
  }

  function readPermissionBrushFromInputs(): void {
    const nextClass = parseU16Input(permissionClassInput?.value ?? "");
    const nextFlags = parseU16Input(permissionFlagsInput?.value ?? "");
    permissionClassInput?.classList.toggle("invalid", nextClass === undefined);
    permissionFlagsInput?.classList.toggle("invalid", nextFlags === undefined);
    if (nextClass !== undefined) permissionBrush.tileClass = nextClass;
    if (nextFlags !== undefined) {
      permissionBrush.flags = nextFlags;
      setFlagCheckboxes(nextFlags);
    }
    updatePermissionPanel();
  }

  function writePermissionBrushToInputs(tileClass: number, flags: number): void {
    permissionBrush.tileClass = clampU16(tileClass);
    permissionBrush.flags = clampU16(flags);
    if (permissionClassInput) {
      permissionClassInput.value = String(permissionBrush.tileClass);
      permissionClassInput.classList.remove("invalid");
    }
    if (permissionFlagsInput) {
      permissionFlagsInput.value = formatHex16(permissionBrush.flags);
      permissionFlagsInput.classList.remove("invalid");
    }
    setFlagCheckboxes(permissionBrush.flags);
    updatePermissionPanel();
  }

  function setFlagCheckboxes(flags: number): void {
    root.querySelectorAll<HTMLInputElement>("[data-ow-permission-flag]").forEach((checkbox) => {
      const bit = Number(checkbox.dataset.owPermissionFlag ?? 0);
      checkbox.checked = (flags & bit) !== 0;
      checkbox.closest<HTMLElement>(".choosable-text")?.classList.toggle("-active", checkbox.checked);
    });
  }

  function readFlagCheckboxes(): number {
    let flags = 0;
    root.querySelectorAll<HTMLInputElement>("[data-ow-permission-flag]").forEach((checkbox) => {
      const bit = Number(checkbox.dataset.owPermissionFlag ?? 0);
      if (checkbox.checked) flags |= bit;
    });
    return clampU16(flags);
  }

  function selectPermissionTile(tile: PermissionTileSelection | undefined, syncBrush: boolean): void {
    const shouldShowPermissions = !isGen4 && tile !== undefined && activeSidebarTab !== "permissions";
    selectedTile = tile;
    if (shouldShowPermissions) activeSidebarTab = "permissions";
    if (tile && syncBrush) writePermissionBrushToInputs(tile.layer2, tile.layer3);
    else updatePermissionPanel();
    if (shouldShowPermissions) fillSidebar();
    draw();
  }

  function applyBrushToTile(tile: PermissionTileSelection | undefined): void {
    if (!tile) return;
    const map = scene.maps.find((entry) => entry.id === tile.mapId);
    if (!map) return;
    const tileClass = permissionBrush.tileClass;
    const flags = permissionBrush.flags;
    if ((map.layer2[tile.index] ?? 0) === tileClass && (map.layer3[tile.index] ?? 0) === flags) {
      selectedTile = { ...tile, layer2: tileClass, layer3: flags };
      updatePermissionPanel();
      return;
    }
    map.layer2[tile.index] = tileClass;
    map.layer3[tile.index] = flags;
    const nextTile = { ...tile, layer2: tileClass, layer3: flags };
    selectedTile = nextTile;
    pendingPaintEdits.set(`${tile.mapId}:${tile.index}`, {
      mapId: tile.mapId,
      tileIndex: tile.index,
      tileClass,
      flags,
    });
    updatePermissionPanel();
    draw();
  }

  function commitPermissionPaint(): void {
    if (pendingPaintEdits.size === 0) return;
    const changed = updateMapPermissionTiles(project, [...pendingPaintEdits.values()]);
    pendingPaintEdits.clear();
    if (changed > 0) onDirty?.();
  }

  // ---------- Test warp: build the ROM and open the emulator with a warp to a tile ----------
  const warpPickButton = root.querySelector<HTMLButtonElement>("#warp-pick");
  const WARP_PICK_LABEL = "Open Game & Warp Here";
  let warpPicking = false;
  let warpRunning = false;

  function setWarpPicking(on: boolean): void {
    warpPicking = on;
    stageEl.classList.toggle("-warp-pick", on);
    if (!warpPickButton) return;
    warpPickButton.setAttribute("aria-pressed", String(on));
    warpPickButton.textContent = on ? "Click a tile… (Esc cancels)" : WARP_PICK_LABEL;
  }

  async function runTestWarp(tile: PermissionTileSelection): Promise<void> {
    if (!onTestWarp || warpRunning) return;
    const selection = { overworldId, ...tile };
    warpRunning = true;
    for (const button of [testWarpButton, warpPickButton]) {
      if (!button) continue;
      button.disabled = true;
      button.textContent = "Building...";
    }
    if (testWarpStatus) testWarpStatus.textContent = "Building ROM and preparing the test warp...";
    try {
      commitPermissionPaint();
      await onTestWarp(selection);
      if (testWarpStatus) testWarpStatus.textContent = `Test launched for tile ${selection.x}, ${selection.y}. Press Down in Aspertia City to warp there.`;
    } catch (error) {
      if (testWarpStatus) testWarpStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      warpRunning = false;
      if (testWarpButton) {
        testWarpButton.disabled = false;
        testWarpButton.textContent = "Test Warp to Here";
      }
      if (warpPickButton) {
        warpPickButton.disabled = false;
        warpPickButton.textContent = WARP_PICK_LABEL;
      }
    }
  }

  testWarpButton?.addEventListener("click", () => {
    if (selectedTile && !testWarpButton.disabled) void runTestWarp(selectedTile);
  });

  // Picking a tile works in the permissions view, where the map shows where the player can stand.
  warpPickButton?.addEventListener("click", () => {
    if (warpRunning) return;
    if (warpPicking) {
      setWarpPicking(false);
      return;
    }
    if (activeSidebarTab !== "permissions") root.querySelector<HTMLButtonElement>('.ow-entity-tab[data-sidebar-tab="permissions"]')?.click();
    if (!layerPrefs.permissions) setLayer("permissions", true);
    setWarpPicking(true);
  });

  function paintCanvasTileAt(clientX: number, clientY: number): void {
    applyBrushToTile(tileAt(scene, screenToWorld(clientX, clientY)));
  }

  function paintGridTileAt(clientX: number, clientY: number): void {
    applyBrushToTile(tileAtPermissionGrid(clientX, clientY));
  }

  function tileAtPermissionGrid(clientX: number, clientY: number): PermissionTileSelection | undefined {
    if (!permissionGridLayout || !permissionGrid) return undefined;
    const rect = permissionGrid.getBoundingClientRect();
    const x = permissionGridLayout.bounds.x + (clientX - rect.left - permissionGridLayout.x) / permissionGridLayout.cellSize;
    const y = permissionGridLayout.bounds.y + (clientY - rect.top - permissionGridLayout.y) / permissionGridLayout.cellSize;
    return tileAt(scene, { x, y });
  }

  function drawPermissionGrid(): boolean {
    if (isGen4 || !permissionGrid) return false;
    const rect = permissionGrid.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const scale = window.devicePixelRatio || 1;
    permissionGrid.width = Math.max(1, Math.floor(rect.width * scale));
    permissionGrid.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = permissionGrid.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#202330";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const bounds = permissionGridBounds(scene);
    const padding = 10;
    const cellSize = Math.max(0.08, Math.min((rect.width - padding * 2) / bounds.width, (rect.height - padding * 2) / bounds.height));
    const gridWidth = bounds.width * cellSize;
    const gridHeight = bounds.height * cellSize;
    const x0 = (rect.width - gridWidth) / 2;
    const y0 = (rect.height - gridHeight) / 2;
    permissionGridLayout = { x: x0, y: y0, cellSize, bounds };

    for (const map of scene.maps) {
      const startX = x0 + (map.x - bounds.x) * cellSize;
      const startY = y0 + (map.y - bounds.y) * cellSize;
      if (map.empty || map.missing) {
        ctx.fillStyle = map.missing ? "#3b2430" : "#282a36";
        ctx.fillRect(startX, startY, map.width * cellSize, map.height * cellSize);
        continue;
      }
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          const index = y * map.width + x;
          ctx.fillStyle = gen5PermissionColorHex({ tileClass: map.layer2[index] ?? 0, flags: map.layer3[index] ?? 0 });
          ctx.fillRect(startX + x * cellSize, startY + y * cellSize, Math.ceil(cellSize), Math.ceil(cellSize));
        }
      }
      ctx.strokeStyle = "rgba(248, 248, 242, 0.45)";
      ctx.lineWidth = 1;
      ctx.strokeRect(startX, startY, map.width * cellSize, map.height * cellSize);
    }

    if (selectedTile) {
      ctx.strokeStyle = "#ffb86c";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + (selectedTile.x - bounds.x) * cellSize, y0 + (selectedTile.y - bounds.y) * cellSize, cellSize, cellSize);
    }
    return true;
  }

  function schedulePermissionGridDraw(attempts = 6): void {
    if (isGen4) return;
    window.requestAnimationFrame(() => {
      if (drawPermissionGrid() || attempts <= 0) return;
      window.setTimeout(() => schedulePermissionGridDraw(attempts - 1), 50);
    });
  }

  const updateViewButtons = () => {
    root.querySelector<HTMLButtonElement>("#view-permissions")?.setAttribute("aria-pressed", String(state.viewMode === "permissions"));
    root.querySelector<HTMLButtonElement>("#view-map")?.setAttribute("aria-pressed", String(state.viewMode === "map"));
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
      mapRenderCache.delete(key);
      mapRenderCache.set(key, render);
      // Each render is a canvas of up to 2048x2048; keep the recently viewed few.
      while (mapRenderCache.size > MAP_RENDER_CACHE_LIMIT) mapRenderCache.delete(mapRenderCache.keys().next().value!);
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
    // Hidden layers still draw the selected entity so the selection never disappears.
    const shown = (kind: OverworldEntityKind, index: number) => layerPrefs[kind] || isSelected(selected, kind, index);
    const overlays = [
      ...(["warp", "trigger", "furniture"] as const).flatMap((kind) =>
        visibleEntitiesByKind(kind)
          .filter((entry): entry is OverworldFurniture | OverworldWarp | OverworldTrigger => entry.kind !== "npc" && !entry.isRail && shown(kind, entry.index))
          .map((entry) => renderGridEntity(entry, worldToScreen, isSelected(selected, entry.kind, entry.index))),
      ),
      ...visibleEntitiesByKind("npc")
        .filter((entity): entity is OverworldNpc => entity.kind === "npc" && shown("npc", entity.index))
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
          scene = getOverworldScene(project, overworldId, headerRowId);
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
    activeSidebarTab = kind;
    selectedEntity = { kind, index };
    setActiveCellForSelection(selectedEntity);
    selectedTile = undefined;
    if (tileEditor) tileEditor.style.display = "none";
  }

  function bindEntityFieldEvents(host: HTMLElement): void {
    host.querySelector<HTMLButtonElement>("[data-sprite-picker]")?.addEventListener("click", () => {
      const selection = selectedEntity;
      const entity = visibleEntityBySelection(selection);
      if (!selection || entity?.kind !== "npc") return;
      openSpritePicker(root, {
        current: entity.spriteId,
        labels: spriteClassLabels(project, buildTrainerOverworldIndex(project)),
        onPick: (spriteId) => {
          updateOverworldEntityField(project, overworldId, selection, "overworld_sprite", spriteId);
          reloadScene();
          onDirty?.();
        },
      });
    });
    host.querySelectorAll<HTMLSelectElement>(".sidebar-field-select").forEach((select) => {
      select.addEventListener("change", () => {
        const key = select.dataset.fieldKey;
        const selection = selectedEntity;
        if (!key || !selection) return;
        try {
          updateOverworldEntityField(project, overworldId, selection, key, select.value);
          reloadScene();
          onDirty?.();
        } catch {
          select.classList.add("invalid");
          window.setTimeout(() => select.classList.remove("invalid"), 800);
        }
      });
    });
    host.querySelectorAll<HTMLInputElement>("input.sidebar-val:not([readonly])").forEach((field) => {
      let initial = field.value;
      field.addEventListener("focus", () => {
        initial = field.value.trim();
        field.select();
      });
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          field.blur();
        } else if (event.key === "Escape") {
          field.value = initial;
          field.blur();
        }
      });
      field.addEventListener("change", () => {
        const key = field.dataset.fieldKey;
        const selection = selectedEntity;
        if (!key || !selection) return;
        const next = field.value.trim();
        if (next === initial) return;
        try {
          const value = updateOverworldEntityField(project, overworldId, selection, key, next);
          field.value = String(value);
          initial = field.value;
          reloadScene();
          onDirty?.();
        } catch {
          field.value = initial;
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

  /** Scrolls the map so the selected entity is in view (Gen 4 switches to its map section). */
  function revealEntity(selection: OverworldEntitySelection | undefined): void {
    const entity = entityBySelection(scene, selection);
    if (!entity || (entity.kind !== "npc" && entity.isRail)) return;
    if (isGen4) {
      const map = mapForPoint(scene, entity.x, entity.y);
      if (map && cellKey(map) !== activeCellKey) setActiveCell(map);
      return;
    }
    const width = entity.kind === "npc" || entity.kind === "furniture" ? 1 : entity.width;
    const height = entity.kind === "npc" || entity.kind === "furniture" ? 1 : entity.height;
    const point = worldToScreen(entity.x + width / 2, entity.y + height / 2);
    const view = overworldPaneEl.getBoundingClientRect();
    const left = overworldPaneEl.scrollLeft;
    const top = overworldPaneEl.scrollTop;
    const margin = 60;
    const inside = point.x > left + margin && point.x < left + view.width - margin && point.y > top + margin && point.y < top + view.height - margin;
    if (inside) return;
    overworldPaneEl.scrollTo({ left: point.x - view.width / 2, top: point.y - view.height / 2, behavior: "smooth" });
  }

  function chooseEntity(selection: OverworldEntitySelection | undefined, reveal: boolean): void {
    selectedEntity = selection;
    selectedTile = undefined;
    if (tileEditor) tileEditor.style.display = "none";
    if (reveal) revealEntity(selection);
    renderEntityOverlay();
    fillSidebar();
  }

  function setLayer(layer: OverworldLayer, visible: boolean): void {
    layerPrefs[layer] = visible;
    const checkbox = root.querySelector<HTMLInputElement>(`[data-layer="${layer}"]`);
    if (checkbox) checkbox.checked = visible;
    if (layer === "permissions") {
      if (legend) legend.hidden = !visible;
      if (opacityInput) opacityInput.hidden = !visible;
    }
    draw();
  }

  const fillSidebar = () => {
    updateCellNav();
    updateEntityTabs(root, activeSidebarTab);
    const addButton = root.querySelector<HTMLButtonElement>("#add-entity");
    const deleteButton = root.querySelector<HTMLButtonElement>("#del-entity");
    const permissionsActive = activeSidebarTab === "permissions";
    if (entitySidebarContent) entitySidebarContent.hidden = permissionsActive;
    if (permissionSidebarContent) permissionSidebarContent.hidden = !permissionsActive;
    stageEl.classList.toggle("-tiles", permissionsActive);
    if (permissionsActive) {
      updatePermissionPanel();
      return;
    }

    const select = root.querySelector<HTMLSelectElement>("#entity-select");
    selectedEntity = normalizeVisibleSelection(selectedEntity, activeKind);
    const entitiesForKind = visibleEntitiesByKind(activeKind);
    const position = entitiesForKind.findIndex((entity) => selectedEntity?.kind === activeKind && entity.index === selectedEntity.index);
    if (select) {
      select.innerHTML = entitiesForKind.length
        ? entitiesForKind.map((entity) => `<option value="${entity.index}" ${position >= 0 && entitiesForKind[position] === entity ? "selected" : ""}>${escapeHtml(entityOptionLabel(project, entity, scene.raw))}</option>`).join("")
        : `<option value="">No ${escapeHtml(entityKindLabel(activeKind))} yet</option>`;
      select.disabled = entitiesForKind.length === 0;
    }
    const prev = root.querySelector<HTMLButtonElement>("#entity-prev");
    const next = root.querySelector<HTMLButtonElement>("#entity-next");
    if (prev) prev.disabled = position <= 0;
    if (next) next.disabled = position < 0 || position >= entitiesForKind.length - 1;

    const entity = visibleEntityBySelection(selectedEntity);
    const fieldsHost = root.querySelector<HTMLDivElement>("#entity-fields");
    if (fieldsHost) {
      fieldsHost.innerHTML = entity ? renderEntityFields(project, overworldId, entity, isGen4, scene.raw) : "";
      if (entity) {
        bindEntityFieldEvents(fieldsHost);
        adjustSpriteDirections(fieldsHost);
      }
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

    if (addButton) addButton.textContent = `Add ${entityKindLabel(activeKind)}`;
    const trainerButton = root.querySelector<HTMLButtonElement>("#add-trainer");
    if (trainerButton) trainerButton.hidden = activeKind !== "npc";
    const itemButton = root.querySelector<HTMLButtonElement>("#add-item");
    if (itemButton) itemButton.hidden = activeKind !== "npc";
    if (deleteButton) deleteButton.disabled = !entity || entity.kind !== activeKind;
    updatePermissionPanel();
  };

  function addEntity(): void {
    if (activeSidebarTab === "permissions") return;
    const index = addOverworldEntity(project, overworldId, activeKind);
    selectedEntity = { kind: activeKind, index };
    const position = defaultNewEntityPosition();
    moveOverworldEntity(project, overworldId, activeKind, index, position.x, position.y);
    reloadScene();
    onDirty?.();
  }

  function deleteSelectedEntity(): void {
    if (activeSidebarTab === "permissions" || !selectedEntity) return;
    const entities = visibleEntitiesByKind(selectedEntity.kind);
    const position = entities.findIndex((entity) => entity.index === selectedEntity?.index);
    deleteOverworldEntity(project, overworldId, selectedEntity.kind, selectedEntity.index);
    const neighbour = entities[position + 1] ?? entities[position - 1];
    // Gen 5 keeps the other indexes; Gen 4 renumbers, so fall back to the first entry there.
    selectedEntity = neighbour && !isGen4 ? { kind: selectedEntity.kind, index: neighbour.index } : undefined;
    reloadScene();
    onDirty?.();
  }

  function stepEntity(delta: number): void {
    const entities = visibleEntitiesByKind(activeKind);
    const position = entities.findIndex((entity) => selectedEntity?.kind === activeKind && entity.index === selectedEntity.index);
    const target = entities[Math.max(0, Math.min(entities.length - 1, position + delta))];
    if (target) chooseEntity({ kind: activeKind, index: target.index }, true);
  }

  function nudgeSelectedEntity(dx: number, dy: number): void {
    const entity = visibleEntityBySelection(selectedEntity);
    if (!entity || (entity.kind !== "npc" && entity.isRail)) return;
    const next = clampToActiveCell(entity.x + dx, entity.y + dy);
    if (next.x === entity.x && next.y === entity.y) return;
    moveOverworldEntity(project, overworldId, entity.kind, entity.index, next.x, next.y);
    reloadScene();
    onDirty?.();
  }

  root.querySelector<HTMLButtonElement>("#add-entity")?.addEventListener("click", addEntity);
  root.querySelector<HTMLButtonElement>("#add-trainer")?.addEventListener("click", () => {
    if (activeSidebarTab === "permissions") return;
    const labels = overworldFileOptions(project);
    openTrainerShortcut(root, project, {
      overworldId,
      position: defaultNewEntityPosition(),
      overworldLabel: (id) => labels[id] ?? `Overworld ${id}`,
      onPlaced: (indexes) => {
        activeKind = "npc";
        activeSidebarTab = "npc";
        selectedEntity = { kind: "npc", index: indexes[0]! };
        reloadScene();
        revealEntity(selectedEntity);
        onDirty?.();
      },
    });
  });
  root.querySelector<HTMLButtonElement>("#add-item")?.addEventListener("click", () => {
    if (activeSidebarTab === "permissions") return;
    openItemShortcut(root, project, {
      overworldId,
      position: defaultNewEntityPosition(),
      onPlaced: (index) => {
        activeKind = "npc";
        activeSidebarTab = "npc";
        selectedEntity = { kind: "npc", index };
        reloadScene();
        revealEntity(selectedEntity);
        onDirty?.();
      },
    });
  });
  root.querySelector<HTMLButtonElement>("#del-entity")?.addEventListener("click", deleteSelectedEntity);
  root.querySelector<HTMLButtonElement>("#entity-prev")?.addEventListener("click", () => stepEntity(-1));
  root.querySelector<HTMLButtonElement>("#entity-next")?.addEventListener("click", () => stepEntity(1));

  root.querySelector<HTMLSelectElement>("#entity-select")?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    chooseEntity(target.value === "" ? undefined : { kind: activeKind, index: Number(target.value) }, true);
  });

  root.querySelectorAll<HTMLButtonElement>(".ow-entity-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.sidebarTab as SidebarTab | undefined;
      if (!tab || tab === activeSidebarTab) return;
      const leavingPermissions = activeSidebarTab === "permissions";
      if (leavingPermissions) setWarpPicking(false);
      activeSidebarTab = tab;
      if (tab === "permissions") {
        if (!layerPrefs.permissions) setLayer("permissions", true);
      } else {
        activeKind = tab;
        selectedEntity = normalizeVisibleSelection(selectedEntity?.kind === tab ? selectedEntity : undefined, activeKind);
        if (leavingPermissions) {
          selectedTile = undefined;
          draw();
        }
        if (tileEditor) tileEditor.style.display = "none";
        revealEntity(selectedEntity);
      }
      renderEntityOverlay();
      fillSidebar();
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-layer]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => setLayer(checkbox.dataset.layer as OverworldLayer, checkbox.checked));
  });
  opacityInput?.addEventListener("input", () => {
    layerPrefs.opacity = Number(opacityInput.value) / 100;
    draw();
  });
  const setMatrixVisible = (visible: boolean) => {
    layerPrefs.matrix = visible;
    if (permissionMatrix) permissionMatrix.hidden = !visible;
    matrixToggle?.setAttribute("aria-pressed", String(visible));
    resize();
    if (visible) schedulePermissionGridDraw();
  };
  matrixToggle?.addEventListener("click", () => setMatrixVisible(!layerPrefs.matrix));
  root.querySelector<HTMLButtonElement>("#close-matrix")?.addEventListener("click", () => setMatrixVisible(false));

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

  if (!isGen4) {
    writePermissionBrushToInputs(0, 0);
    permissionClassInput?.addEventListener("input", readPermissionBrushFromInputs);
    permissionFlagsInput?.addEventListener("input", readPermissionBrushFromInputs);
    permissionPaintToggle?.addEventListener("change", () => {
      permissionBrush.painting = Boolean(permissionPaintToggle.checked);
      stageEl.classList.toggle("-painting", permissionBrush.painting);
    });
    root.querySelectorAll<HTMLInputElement>("[data-ow-permission-flag]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        checkbox.closest<HTMLElement>(".choosable-text")?.classList.toggle("-active", checkbox.checked);
        permissionBrush.flags = readFlagCheckboxes();
        if (permissionFlagsInput) {
          permissionFlagsInput.value = formatHex16(permissionBrush.flags);
          permissionFlagsInput.classList.remove("invalid");
        }
        updatePermissionPanel();
      });
    });
    permissionGrid?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (permissionBrush.painting) {
        pendingPaintEdits.clear();
        state.paintingPermissions = true;
        permissionGrid.setPointerCapture(event.pointerId);
        paintGridTileAt(event.clientX, event.clientY);
      } else {
        selectPermissionTile(tileAtPermissionGrid(event.clientX, event.clientY), true);
      }
    });
    permissionGrid?.addEventListener("pointermove", (event) => {
      if (!state.paintingPermissions) return;
      paintGridTileAt(event.clientX, event.clientY);
    });
    const endGridPaint = (event: PointerEvent) => {
      if (!state.paintingPermissions) return;
      paintGridTileAt(event.clientX, event.clientY);
      state.paintingPermissions = false;
      try {
        if (permissionGrid?.hasPointerCapture(event.pointerId)) permissionGrid.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      commitPermissionPaint();
    };
    permissionGrid?.addEventListener("pointerup", endGridPaint);
    permissionGrid?.addEventListener("pointercancel", endGridPaint);
  }

  const releaseCapture = (pointerId: number) => {
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };
  const tilesActive = () => !isGen4 && activeSidebarTab === "permissions";

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    if (event.button === 0 && tilesActive() && permissionBrush.painting && !warpPicking) {
      event.preventDefault();
      pendingPaintEdits.clear();
      state.paintingPermissions = true;
      canvas.setPointerCapture(event.pointerId);
      paintCanvasTileAt(event.clientX, event.clientY);
      return;
    }
    event.preventDefault();
    state.draggingMap = true;
    state.dragPanX = isGen4 ? state.panX : overworldPaneEl.scrollLeft;
    state.dragPanY = isGen4 ? state.panY : overworldPaneEl.scrollTop;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (state.paintingPermissions) {
      paintCanvasTileAt(event.clientX, event.clientY);
      return;
    }
    if (!state.draggingMap) return;
    const dx = event.clientX - state.dragStartX;
    const dy = event.clientY - state.dragStartY;
    stageEl.classList.toggle("-panning", Math.abs(dx) + Math.abs(dy) >= 4);
    if (isGen4) {
      state.panX = state.dragPanX + dx;
      state.panY = state.dragPanY + dy;
      draw();
    } else {
      overworldPaneEl.scrollLeft = state.dragPanX - dx;
      overworldPaneEl.scrollTop = state.dragPanY - dy;
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    releaseCapture(event.pointerId);
    if (state.paintingPermissions) {
      paintCanvasTileAt(event.clientX, event.clientY);
      state.paintingPermissions = false;
      commitPermissionPaint();
      return;
    }
    const moved = Math.abs(event.clientX - state.dragStartX) + Math.abs(event.clientY - state.dragStartY);
    state.draggingMap = false;
    stageEl.classList.remove("-panning");
    if (moved >= 4 || event.button !== 0) return;
    if (warpPicking) {
      const tile = tileAt(scene, screenToWorld(event.clientX, event.clientY));
      if (!tile) return;
      setWarpPicking(false);
      selectPermissionTile(tile, true);
      void runTestWarp(tile);
      return;
    }
    if (tilesActive()) {
      selectPermissionTile(tileAt(scene, screenToWorld(event.clientX, event.clientY)), true);
      return;
    }
    if (isGen4 && state.viewMode === "permissions") {
      selectedTile = tileAt(scene, screenToWorld(event.clientX, event.clientY));
      if (selectedTile && tileEditor) {
        selectedEntity = undefined;
        renderEntityOverlay();
        fillSidebar();
        tileEditor.style.display = "block";
        root.querySelector<HTMLElement>("#tile-flag")!.textContent = String(selectedTile.layer2);
        root.querySelector<HTMLElement>("#tile-mov")!.textContent = String(selectedTile.layer3);
      }
    } else if (isGen4) {
      selectedTile = undefined;
      if (tileEditor) tileEditor.style.display = "none";
    }
  });
  canvas.addEventListener("pointercancel", (event) => {
    releaseCapture(event.pointerId);
    if (state.paintingPermissions) {
      state.paintingPermissions = false;
      commitPermissionPaint();
    }
    state.draggingMap = false;
    stageEl.classList.remove("-panning");
  });

  stageEl.addEventListener("pointermove", (event) => {
    if (!cursorReadout) return;
    const world = screenToWorld(event.clientX, event.clientY);
    const tile = tileAt(scene, world);
    const x = Math.floor(world.x);
    const y = Math.floor(world.y);
    cursorReadout.textContent = tile
      ? `X ${x}, Y ${y} · class ${tile.layer2} · ${formatHex16(tile.layer3)}`
      : `X ${x}, Y ${y}`;
  });
  stageEl.addEventListener("pointerleave", () => {
    if (cursorReadout) cursorReadout.textContent = "";
  });

  stageEl.addEventListener(
    "wheel",
    (event) => {
      // Gen 5 scrolls natively; pinch (ctrlKey) or Cmd/Ctrl-scroll zooms around the cursor.
      if (!isGen4 && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey && !isGen4 ? 0.01 : 0.002));
      setZoom(isGen4 ? state.zoom + (event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP) : state.zoom * factor, event.clientX, event.clientY);
    },
    { passive: false },
  );

  root.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => setZoom(state.zoom * 1.25));
  root.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => setZoom(state.zoom / 1.25));
  root.querySelector<HTMLButtonElement>("#zoom-fit")?.addEventListener("click", () => {
    state.framed = false;
    frameScene(stage.getBoundingClientRect(), true);
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

  const NUDGES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!canvas.isConnected) {
      window.removeEventListener("keydown", onKeyDown);
      return;
    }
    if (isTextEntryTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (warpPicking && event.key === "Escape") {
      event.preventDefault();
      setWarpPicking(false);
      return;
    }
    if (isGen4 && event.key === "Tab" && !isEditableTarget(event.target)) {
      event.preventDefault();
      setViewMode(state.viewMode === "permissions" ? "map" : "permissions");
      return;
    }
    if (activeSidebarTab === "permissions") return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!selectedEntity) return;
      event.preventDefault();
      deleteSelectedEntity();
      return;
    }
    const nudge = NUDGES[event.key];
    if (nudge && selectedEntity && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault();
      nudgeSelectedEntity(nudge[0], nudge[1]);
    }
  };
  window.addEventListener("keydown", onKeyDown);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  if (!isGen4) resizeObserver.observe(overworldPaneEl);
  if (permissionGrid) {
    const permissionGridObserver = new ResizeObserver(() => schedulePermissionGridDraw());
    permissionGridObserver.observe(permissionGrid);
  }
  window.addEventListener("resize", resize, { once: false });
  fillSidebar();
  resize();
  schedulePermissionGridDraw();
  if (!isGen4) void ensureMapRender();
  window.requestAnimationFrame(resize);
}

function renderFieldControl(field: SidebarField, value: number, edited: boolean): string {
  const title = field.title ? ` title="${escapeHtml(field.title)}"` : "";
  const mark = edited ? " is-edited" : "";
  if (field.options) {
    const listed = field.options.some((option) => option.value === value);
    const options = listed ? field.options : [...field.options, { value, label: "Other" }];
    return `
      <label class="ow-row${mark}"${title}>
        <span class="ow-label">${escapeHtml(field.label)}</span>
        <select class="ow-input sidebar-field-select" data-field-key="${escapeHtml(field.key)}">
          ${options.map((option) => `<option value="${option.value}" ${value === option.value ? "selected" : ""}>${escapeHtml(option.label)} (${option.value})</option>`).join("")}
        </select>
      </label>
    `;
  }
  const readOnly = field.editable === false ? "readonly tabindex=\"-1\"" : "";
  return `
    <label class="ow-row${mark}"${title}>
      <span class="ow-label">${escapeHtml(field.label)}</span>
      <input class="ow-input sidebar-val" data-field-key="${escapeHtml(field.key)}" type="text" inputmode="numeric" spellcheck="false" autocomplete="off" value="${escapeHtml(String(value))}" ${readOnly}>
    </label>
  `;
}

function renderEntityFields(project: ProjectState, overworldId: number, entity: OverworldEntity, isGen4: boolean, raw: Record<string, unknown>): string {
  const edited = changedKeys(project.actionChangelog?.entries, `overworld:${overworldId}:${entity.kind}:${entity.index}:`);
  const fields = sidebarFields(entity, isGen4);
  const groups = new Map<FieldGroup, SidebarField[]>();
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return [...groups.entries()]
    .map(([group, entries]) => {
      const rows = entries
        .map((field) => {
          const value = Number(entityFieldValue(entity, field.key, raw));
          const control = renderFieldControl(field, value, edited.has(field.key));
          if (entity.kind === "npc" && field.key === "overworld_sprite") {
            return control.replace("</label>", `${renderSpritePreview(project, entity)}</label>`).replace('class="ow-row', 'class="ow-row -sprite');
          }
          return control;
        })
        .join("");
      if (group === "advanced") {
        return `<details class="ow-group -advanced"><summary>${FIELD_GROUP_LABELS[group]}</summary><div class="ow-grid">${rows}</div></details>`;
      }
      return `<section class="ow-group"><div class="ow-group-title">${FIELD_GROUP_LABELS[group]}</div><div class="ow-grid ${group === "position" ? "-pos" : ""}">${rows}</div></section>`;
    })
    .join("");
}

function renderSpritePreview(project: ProjectState, npc: OverworldNpc): string {
  const isGen4 = isGen4Project(project);
  const romSprite = isGen4 ? getGen4OverworldSpriteDataUrl(project, npc.spriteId, npc.direction) : undefined;
  const src = isGen4 ? romSprite : publicAsset(`images/overworlds/${npc.spriteSlug}.png`);
  if (!src) return `<span class="ow-sprite-preview -missing" aria-hidden="true"></span>`;
  const attrs = isGen4 ? `data-rom-sprite="true"` : `onerror="this.hidden=true;this.parentElement?.classList.add('-missing')"`;
  if (!isGen4 && supportsOverworldShortcuts(project)) {
    return `<button class="ow-sprite-preview -pick" type="button" data-sprite-picker data-dir="${npc.direction}" title="Choose a sprite" aria-label="Choose a sprite"><img class="overworld-sprite" src="${escapeHtml(src)}" alt="" ${attrs}></button>`;
  }
  return `<span class="ow-sprite-preview" data-dir="${npc.direction}" aria-hidden="true"><img class="overworld-sprite" src="${escapeHtml(src)}" alt="" ${attrs}></span>`;
}

function permissionCategoryLabel(tileClass: number, flags: number): string {
  const color = gen5PermissionColorHex({ tileClass, flags });
  return PERMISSION_LEGEND.find((entry) => entry.color === color)?.label ?? "Other";
}

function renderPermissionLegend(): string {
  return PERMISSION_LEGEND.map((entry) => `<span class="ow-legend-item"><span class="ow-swatch" style="background:${entry.color}"></span>${escapeHtml(entry.label)}</span>`).join("") +
    `<span class="ow-legend-item"><span class="ow-swatch -other"></span>Other</span>`;
}

function renderGen5PermissionControls(testWarpHtml: string): string {
  const known = GEN5_PERMISSION_FLAGS.filter((flag) => !flag.label.startsWith("Unknown"));
  const unknown = GEN5_PERMISSION_FLAGS.filter((flag) => flag.label.startsWith("Unknown"));
  const chip = (flag: (typeof GEN5_PERMISSION_FLAGS)[number]) => `
    <label class="ow-flag choosable-text">
      <input type="checkbox" data-ow-permission-flag="${flag.bit}" />
      ${escapeHtml(flag.label.startsWith("Unknown") ? formatHex16(flag.bit) : flag.label)}
    </label>`;
  return `
    <section class="ow-group">
      <div class="ow-group-title">Selected tile</div>
      <div id="permission-selected" class="ow-tile"></div>
      ${testWarpHtml}
    </section>
    <section class="ow-group">
      <div class="ow-group-title">Brush</div>
      <div class="ow-brush">
        <span class="ow-swatch -lg" id="ow-permission-swatch"></span>
        <label class="ow-row -stack"><span class="ow-label">Class</span><input class="ow-input" id="ow-permission-class" type="text" inputmode="numeric" value="0" spellcheck="false" /></label>
        <label class="ow-row -stack"><span class="ow-label">Flags</span><input class="ow-input" id="ow-permission-flags" type="text" value="0x0000" spellcheck="false" /></label>
      </div>
      <div class="ow-flags">${known.map(chip).join("")}</div>
      <details class="ow-group -advanced -flags"><summary>Other flag bits</summary><div class="ow-flags">${unknown.map(chip).join("")}</div></details>
      <label class="md-check td-check ow-paint"><input id="ow-permission-paint" type="checkbox" /><span>Paint on the map</span></label>
    </section>
  `;
}

function renderGen5PermissionMatrix(): string {
  return `
    <aside class="ow-matrix" id="ow-matrix" ${layerPrefs.matrix ? "" : "hidden"}>
      <div class="ow-matrix-head"><span>Permissions matrix</span><button class="btn sm -ghost" id="close-matrix" type="button" aria-label="Hide matrix">&times;</button></div>
      <canvas id="permission-grid-canvas" class="overworld-permission-grid"></canvas>
    </aside>
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

/** "Black City - Overworld 1", named from the map headers that load each overworld file. */
function overworldFileOptions(project: ProjectState): string[] {
  const count = project.narcs.overworlds?.fileCount ?? 0;
  const names = new Map<number, string[]>();
  for (const row of Object.values(project.headers?.rows ?? {})) {
    const id = Number(row.overworlds_id ?? row.map_id);
    const name = String(row.location_name ?? "").trim();
    if (!Number.isSafeInteger(id) || !name) continue;
    const list = names.get(id) ?? [];
    if (!list.includes(name)) list.push(name);
    names.set(id, list);
  }
  return Array.from({ length: count }, (_, id) => {
    const list = names.get(id) ?? [];
    if (list.length === 0) return `Overworld ${id}`;
    const name = list.length > 2 ? `${list[0]}, ${list[1]} +${list.length - 2}` : list.join(", ");
    return `${name} - Overworld ${id}`;
  });
}

function overworldRouteUrl(overworldId: number): string {
  const url = new URL(window.location.href);
  url.hash = `overworlds/${overworldId}`;
  return url.href;
}

function updateEntityTabs(root: ParentNode, activeTab: SidebarTab): void {
  root.querySelectorAll<HTMLButtonElement>(".ow-entity-tab").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.sidebarTab === activeTab));
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

function entityOptionLabel(project: ProjectState, entity: OverworldEntity, raw: Record<string, unknown>): string {
  if (entity.kind === "npc") {
    const script = Number(raw[`npc_${entity.index}_script_id`] ?? 0);
    const eventType = Number(raw[`npc_${entity.index}_movement_permissions_2`] ?? 0);
    const role = eventType === 1 || eventType === 2 ? " · trainer" : eventType === 3 ? " · item" : "";
    return `${entity.index}: Sprite ${entity.spriteId} · script ${script}${role}`;
  }
  const rail = entity.isRail ? " · rail" : "";
  if (entity.kind === "warp") {
    const target = warpTargetForZone(project, entity.targetZone);
    return `${entity.index}: To ${target?.locationName ?? `zone ${entity.targetZone}`} · warp ${entity.targetWarpId}${rail}`;
  }
  if (entity.kind === "trigger") {
    const check = entity.variable ? ` · var ${entity.variable} = ${entity.value}` : "";
    return `${entity.index}: Script ${entity.script}${check}${rail}`;
  }
  return `${entity.index}: Script ${entity.script}${entity.condition === 2 ? " · hidden item" : ""}${rail}`;
}

function entityKindLabel(kind: OverworldEntityKind): string {
  return kind === "npc" ? "NPC" : kind;
}

function sidebarFields(entity: OverworldEntity, isGen4: boolean): SidebarField[] {
  if (entity.kind === "npc") {
    return NPC_FIELD_ORDER.filter((key) => (NPC_FIELDS as readonly string[]).includes(key)).map((key) => {
      const def = NPC_FIELD_DEFS[key]!;
      const options = key === "direction" ? FACING_OPTIONS : !isGen4 && key === "movement_permissions_2" ? MOVEMENT_MODIFIER_OPTIONS : undefined;
      return { key, ...def, options };
    });
  }
  const gen5 = (options: readonly SidebarFieldOption[]) => (isGen4 ? undefined : options);
  const railFields = (unused: boolean): SidebarField[] => [
    { key: "railLineNo", label: "Rail line", group: "position", showWhenRail: true },
    { key: "railFrontPos", label: "Rail front", group: "position", showWhenRail: true },
    { key: "railSidePos", label: "Rail side", group: "position", showWhenRail: true },
    ...(unused ? [{ key: "railUnused", label: "Rail unused", group: "advanced" as const, showWhenRail: true }] : []),
  ];
  const isRail: SidebarField = { key: "isRail", label: "Position type", group: "advanced", options: POSITION_TYPE_OPTIONS };
  if (entity.kind === "furniture") {
    return ([
      { key: "script", label: "Script", group: "event" },
      { key: "condition", label: "Type", group: "event", options: gen5(BG_TYPE_OPTIONS) },
      { key: "interactibility", label: "Activates", group: "event", options: gen5(BG_FACING_OPTIONS) },
      { key: "gridX", label: "X", group: "position", showWhenGrid: true },
      { key: "gridZ", label: "Y", group: "position", showWhenGrid: true },
      { key: "altitude", label: "Z", group: "position" },
      ...railFields(true),
      isRail,
    ] satisfies SidebarField[]).filter((field) => fieldVisible(field, entity));
  }
  if (entity.kind === "warp") {
    return ([
      { key: "targetZone", label: "Zone", group: "destination" },
      { key: "targetWarpId", label: "Warp", group: "destination" },
      { key: "contactDirection", label: "Exit direction", group: "behaviour", options: gen5(EXIT_DIRECTION_OPTIONS) },
      { key: "transitionType", label: "Exit type", group: "behaviour" },
      { key: "gridX", label: "X", group: "position", showWhenGrid: true },
      { key: "gridZ", label: "Y", group: "position", showWhenGrid: true },
      { key: "worldY", label: "Z", group: "position", showWhenGrid: true },
      ...railFields(false),
      { key: "width", label: "W", group: "position" },
      { key: "height", label: "H", group: "position" },
      isRail,
      { key: "unknown", label: "Unknown", group: "advanced" },
    ] satisfies SidebarField[]).filter((field) => fieldVisible(field, entity));
  }
  return ([
    { key: "script", label: "Script", group: "event" },
    { key: "type", label: "Fires when", group: "event", options: gen5(TRIGGER_TYPE_OPTIONS) },
    { key: "variable", label: "Variable", group: "event", title: "0 fires without checking a variable" },
    { key: "value", label: "Value", group: "event", title: "Fires when the variable equals this" },
    { key: "gridX", label: "X", group: "position", showWhenGrid: true },
    { key: "gridZ", label: "Y", group: "position", showWhenGrid: true },
    { key: "worldY", label: "Z", group: "position", showWhenGrid: true },
    ...railFields(false),
    { key: "width", label: "W", group: "position" },
    { key: "height", label: "H", group: "position" },
    isRail,
    { key: "unknown", label: "Unknown", group: "advanced" },
  ] satisfies SidebarField[]).filter((field) => fieldVisible(field, entity));
}

function fieldVisible(field: SidebarField, entity: OverworldFurniture | OverworldWarp | OverworldTrigger): boolean {
  if (field.showWhenRail) return entity.isRail;
  if (field.showWhenGrid) return !entity.isRail;
  return true;
}

/* Semantic field keys that the scene exposes under another name. */
const ENTITY_FIELD_ALIASES: Record<string, string> = { gridX: "x", gridZ: "y", worldY: "altitude" };

function entityFieldValue(entity: OverworldEntity, key: string, raw: Record<string, unknown>): number | boolean {
  if (entity.kind === "npc") {
    if (key === "x_cord" || key === "y_cord") return sceneRawNpcValue(entity, key);
    return Number(raw[`npc_${entity.index}_${key}`] ?? sceneRawNpcValue(entity, key));
  }
  const record = entity as unknown as Record<string, number | boolean>;
  return Number(record[ENTITY_FIELD_ALIASES[key] ?? key] ?? record[key] ?? 0);
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

export function drawMap(
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
            : gen5PermissionColorHex({ tileClass: permission, flags: collision });
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

function drawGen5PermissionOverlay(context: CanvasRenderingContext2D, scene: OverworldScene, size: number, panX: number, panY: number, opacity: number): void {
  context.save();
  context.globalAlpha = opacity;
  for (const map of scene.maps) {
    if (map.empty || map.missing) continue;
    const startX = panX + map.x * size;
    const startY = panY + map.y * size;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const index = y * map.width + x;
        context.fillStyle = gen5PermissionColorHex({ tileClass: map.layer2[index] ?? 0, flags: map.layer3[index] ?? 0 });
        context.fillRect(startX + x * size, startY + y * size, Math.ceil(size), Math.ceil(size));
      }
    }
  }
  context.restore();
  context.save();
  context.strokeStyle = "rgba(248, 248, 242, 0.18)";
  context.lineWidth = 1;
  for (const map of scene.maps) {
    if (map.empty || map.missing) continue;
    const startX = panX + map.x * size;
    const startY = panY + map.y * size;
    context.strokeRect(startX, startY, map.width * size, map.height * size);
  }
  context.restore();
}

function drawSelectedPermissionTile(
  context: CanvasRenderingContext2D,
  selectedTile: PermissionTileSelection | undefined,
  size: number,
  panX: number,
  panY: number,
): void {
  if (!selectedTile) return;
  context.save();
  context.strokeStyle = "#ffb86c";
  context.lineWidth = 3;
  context.strokeRect(panX + selectedTile.x * size, panY + selectedTile.y * size, size, size);
  context.restore();
}

export function drawTrueMap(
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

export function mapRenderTileBounds(render: OverworldMapRender): { x: number; y: number; width: number; height: number } {
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

export function mapGridBounds(scene: OverworldScene): { x: number; y: number; width: number; height: number } {
  const maps = scene.maps.length > 0 ? scene.maps : [{ x: 0, y: 0, width: scene.width, height: scene.height }];
  const minX = Math.min(...maps.map((map) => map.x), 0);
  const minY = Math.min(...maps.map((map) => map.y), 0);
  const maxX = Math.max(...maps.map((map) => map.x + map.width), scene.width, 1);
  const maxY = Math.max(...maps.map((map) => map.y + map.height), scene.height, 1);
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function permissionGridBounds(scene: OverworldScene): { x: number; y: number; width: number; height: number } {
  const maps = scene.maps.filter((map) => !map.empty && !map.missing && map.width > 0 && map.height > 0);
  if (maps.length === 0) return mapGridBounds(scene);
  const minX = Math.min(...maps.map((map) => map.x));
  const minY = Math.min(...maps.map((map) => map.y));
  const maxX = Math.max(...maps.map((map) => map.x + map.width));
  const maxY = Math.max(...maps.map((map) => map.y + map.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function mapRenderCacheKey(project: ProjectState, overworldId: number, zoneId: number): string {
  return `${MAP_RENDER_CACHE_VERSION}:${project.session.baseVersion}:${project.session.romName}:${overworldId}:${zoneId}:${MAP_VIEW_SEASON}:${project.narcs.maps?.revision ?? 0}:${project.narcs.matrix?.revision ?? 0}:${project.narcs.headers?.revision ?? 0}:${project.narcs.map_replace?.revision ?? 0}`;
}

function associatedMapZoneId(scene: OverworldScene): number {
  return Number(scene.header.index);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox" && (target as HTMLInputElement).type !== "range");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName);
}

export function renderNpc(
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

export function renderGridEntity(
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
  const tiny = Math.min(width, height) < 20 ? "-tiny" : "";
  const label = `${entity.kind === "furniture" ? "Furniture" : entity.kind === "warp" ? "Warp" : "Trigger"} ${entity.index}`;
  return `
    <div class="overworld-item overworld-grid-entity overworld-${entity.kind} ${tiny} ${selected ? "selected" : ""}"
      data-kind="${entity.kind}" data-index="${entity.index}" title="${escapeHtml(label)}"
      style="left:${position.x - offsetX}px;top:${position.y - offsetY}px;width:${width}px;height:${height}px">
      <span>${escapeHtml(entity.kind[0]!.toUpperCase())}${entity.index}</span>
    </div>
  `;
}

export function adjustSpriteDirections(root: HTMLElement): void {
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


function parseU16Input(value: string): number | undefined {
  const text = value.trim();
  if (/^0x[0-9a-f]+$/iu.test(text)) return clampU16(Number.parseInt(text.slice(2), 16));
  if (/^\d+$/u.test(text)) return clampU16(Number(text));
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tileAt(scene: OverworldScene, point: { x: number; y: number }): PermissionTileSelection | undefined {
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
