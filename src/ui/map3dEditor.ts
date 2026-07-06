import * as THREE from "three";
import {
  getMap3dZoneMetadata,
  getMap3dZones,
  loadMap3dZone,
  saveMap3dPermissionEdits,
  updateMap3dAreaMetadata,
  updateMap3dZoneMetadata,
  type Map3dAreaMetadata,
  type Map3dEntityOverlay,
  type Map3dPermissionEdit,
  type Map3dPermissionTile,
  type Map3dSceneData,
  type Map3dSeason,
  type Map3dZoneMetadata,
} from "../pokeweb/map3dModel";
import { isGen4Project } from "../pokeweb/constants";
import { buildGen4Map3dScene, ensureGen4Map3dResources, saveGen4Map3dPermissionEdits } from "../pokeweb/gen4Map3dModel";
import { clampU16, formatHex16, GEN5_PERMISSION_FLAGS, gen5PermissionColorNumber } from "../pokeweb/gen5PermissionModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const PERMISSION_TILE_SIZE = 16;
const MAP3D_VIEW_STORAGE_KEY = "pokeweb.maps3d.lastView";

type RendererState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  terrainGroup: THREE.Group;
  buildingGroup: THREE.Group;
  buildingBoundsGroup: THREE.Group;
  npcGroup: THREE.Group;
  overlayGroup: THREE.Group;
  permissionGroup: THREE.Group;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  animationId: number;
  dragging: boolean;
  dragMode: "rotate" | "pan";
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  yaw: number;
  pitch: number;
  distance: number;
  target: THREE.Vector3;
  currentData?: Map3dSceneData;
  selectedPermission?: PermissionSelection;
  onPermissionPick?: (selection: PermissionSelection) => void;
};

type PermissionSelection = {
  chunkId: number;
  matrixX: number;
  matrixY: number;
  tileX: number;
  tileY: number;
  tile: Map3dPermissionTile;
};

type PermissionMeshUserData = {
  chunk: Map3dSceneData["chunks"][number];
  tileIndices: number[];
};

export function renderMap3dEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  let zones = getMap3dZones(project);
  const rememberedView = readRememberedMap3dView(project, zones.map((zone) => zone.zoneId));
  const initialZone = rememberedView?.zoneId ?? zones[0]?.zoneId ?? 0;
  let activeZone = initialZone;
  let activeSeason: Map3dSeason = rememberedView?.season ?? "spring";
  let state: RendererState | undefined;
  let loadToken = 0;
  let activeData: Map3dSceneData | undefined;
  const dirtyPermissionEdits = new Map<string, Map3dPermissionEdit>();

  root.innerHTML = `
    <div class="pokemon-filter map3d-sidebar">
      <div class="filter-title">Maps</div>
      <input class="filter-input" id="map3d-search" type="text" placeholder="Search zones" />
      <select class="filter-input map3d-zone-select" id="map3d-zone">
        ${zones.map((zone) => `<option value="${zone.zoneId}" ${zone.zoneId === activeZone ? "selected" : ""}>${escapeHtml(zone.label)}</option>`).join("")}
      </select>
      <button class="ow-tool map3d-load-button" id="map3d-load" type="button">Load Map</button>
      <label class="map3d-field">
        <span>Season</span>
        <select class="filter-input" id="map3d-season">
          <option value="spring" ${activeSeason === "spring" ? "selected" : ""}>Spring</option>
          <option value="summer" ${activeSeason === "summer" ? "selected" : ""}>Summer</option>
          <option value="autumn" ${activeSeason === "autumn" ? "selected" : ""}>Autumn</option>
          <option value="winter" ${activeSeason === "winter" ? "selected" : ""}>Winter</option>
        </select>
      </label>
      <div class="map3d-metadata-editor">
        <strong>Zone / Area Metadata</strong>
        <div class="map3d-metadata-note">
          Headers choose the zone, matrix, scripts, text, encounters, and source area. Area rows choose the 3D texture/building resources.
        </div>
        <label class="map3d-field">
          <span>Location name</span>
          <input class="filter-input" id="map3d-meta-location" type="text" />
        </label>
        <div class="map3d-meta-grid">
          ${metadataNumberInput("map3d-meta-matrix", "Matrix", 0, 65535)}
          ${metadataNumberInput("map3d-meta-area-source", "Source area", 0, 65535)}
          ${metadataNumberInput("map3d-meta-overworlds", "Overworlds", 0, 65535)}
          ${metadataNumberInput("map3d-meta-script", "Scripts", 0, 65535)}
          ${metadataNumberInput("map3d-meta-text", "Text bank", 0, 65535)}
          ${metadataNumberInput("map3d-meta-encounter", "Encounters", 0, 65535)}
          ${metadataNumberInput("map3d-meta-map-type", "Map type", 0, 255)}
          ${metadataNumberInput("map3d-meta-weather", "Weather", 0, 255)}
        </div>
        <details class="map3d-tile-guide">
          <summary>More Header Fields</summary>
          <div class="map3d-meta-grid map3d-meta-grid-spaced">
            ${metadataNumberInput("map3d-meta-parent", "Parent map", 0, 65535)}
            ${metadataNumberInput("map3d-meta-level-script", "Level script", 0, 65535)}
            ${metadataNumberInput("map3d-meta-camera", "Camera", 0, 255)}
            ${metadataNumberInput("map3d-meta-flags", "Header flags", 0, 255)}
          </div>
        </details>
        <div class="map3d-meta-section-title">Loaded Area Row</div>
        <div class="map3d-meta-grid">
          <label class="map3d-field">
            <span>Concrete area</span>
            <input class="filter-input" id="map3d-meta-area-loaded" type="number" disabled />
          </label>
          ${metadataNumberInput("map3d-meta-texture-pack", "Texture pack", 0, 65535)}
          ${metadataNumberInput("map3d-meta-buildings", "Building bundle", 0, 65535)}
          ${metadataNumberInput("map3d-meta-srt", "SRT anim", 0, 255)}
          ${metadataNumberInput("map3d-meta-pat", "PAT anim", 0, 255)}
          <label class="map3d-check map3d-meta-check">
            <input id="map3d-meta-exterior" type="checkbox" />
            <span>Exterior area</span>
          </label>
        </div>
        <button class="ow-tool map3d-load-button" id="map3d-meta-save" type="button">Save Metadata</button>
      </div>
      <div class="map3d-layer-grid">
        <label class="map3d-check"><input id="map3d-show-buildings" type="checkbox" checked /> Buildings</label>
        <label class="map3d-check"><input id="map3d-show-building-bounds" type="checkbox" /> Building bounds</label>
        <label class="map3d-check"><input id="map3d-show-npcs" type="checkbox" checked /> NPC models</label>
        <label class="map3d-check"><input id="map3d-show-entities" type="checkbox" checked /> Entity overlays</label>
        <label class="map3d-check"><input id="map3d-show-permissions" type="checkbox" /> Collision overlay</label>
      </div>
      <div class="map3d-permission-editor">
        <strong>Collision / Permissions</strong>
        <label class="map3d-field">
          <span>Tile class</span>
          <input class="filter-input" id="map3d-permission-class" type="number" min="0" max="65535" step="1" value="0" />
        </label>
        <details class="map3d-tile-guide">
          <summary>Tile Class Guide</summary>
          <div class="map3d-tile-guide-grid">
            <div><strong>0, 17, 19</strong><span>Normal walkable ground variants.</span></div>
            <div><strong>1, 18</strong><span>Not-move / blocked tile classes.</span></div>
            <div><strong>2, 3, 30</strong><span>Ground variants, including seasonal ground.</span></div>
            <div><strong>4-13, 22, 33-35</strong><span>Encounter terrain: grass, long grass, cave, ground, desert, room.</span></div>
            <div><strong>14-16, 24</strong><span>Snow and ice surfaces.</span></div>
            <div><strong>20-23, 28, 66</strong><span>Puddles, shoals, marsh, and deep marsh.</span></div>
            <div><strong>11, 12, 25, 35, 124</strong><span>Sand, desert, and drift sand.</span></div>
            <div><strong>27</strong><span>Mirror floor.</span></div>
            <div><strong>29</strong><span>Strength/boulder hole.</span></div>
            <div><strong>31, 32</strong><span>Lawn and bridge special surfaces.</span></div>
            <div><strong>48-51</strong><span>Gimmick floors: electric, floating, electric rock, up/down floor.</span></div>
            <div><strong>61-68</strong><span>Water, sea, waterfall, shore, deep sea.</span></div>
            <div><strong>81-88</strong><span>Directional no-move wall classes.</span></div>
            <div><strong>114-121</strong><span>Jump and forced-move directional tiles.</span></div>
            <div><strong>148-156, 176</strong><span>Currents and diving behavior.</span></div>
            <div><strong>160-168</strong><span>Slippery/ice movement, slip jumps, turn tiles, hybrid change.</span></div>
            <div><strong>190, 191</strong><span>Ooze/swamp and ooze stairs.</span></div>
            <div><strong>212-226</strong><span>Indoor/object interactions: counter, PC, TV, shelves, vending machine.</span></div>
            <div><strong>255</strong><span>No attribute / invalid attribute.</span></div>
          </div>
        </details>
        <div class="map3d-field">
          <span>Flags</span>
          <div class="map3d-flag-grid">
            ${GEN5_PERMISSION_FLAGS.map(
              (flag) => `
                <label class="map3d-check map3d-flag-check">
                  <input type="checkbox" data-flag="${flag.bit}" />
                  <span>${flag.label}</span>
                </label>
              `,
            ).join("")}
          </div>
          <div class="map3d-flag-value" id="map3d-permission-flag-value">Calculated flags: 0x0000</div>
        </div>
        <label class="map3d-check"><input id="map3d-permission-paint" type="checkbox" /> Paint on click</label>
        <button class="ow-tool map3d-load-button" id="map3d-permission-apply" type="button">Apply To Selected</button>
        <button class="ow-tool map3d-load-button" id="map3d-permission-save" type="button">Save Permission Edits</button>
        <div class="map3d-permission-selected" id="map3d-permission-selected">Load a map, enable the overlay, then click a tile.</div>
      </div>
    </div>
    <div class="pokemon-list map3d-view">
      <div class="map3d-toolbar">
        <div class="map3d-toolbar-buttons">
          <button class="ow-tool" id="map3d-reset" type="button">Reset View</button>
          <button class="ow-tool" id="map3d-topdown" type="button">Top Down</button>
        </div>
        <div class="map3d-controls">
          <strong>Controls</strong>
          <div>Drag: rotate</div>
          <div>Shift + drag: pan</div>
          <div>Arrow keys: pan</div>
          <div>Trackpad pinch or wheel: zoom</div>
          <div>Collision overlay: click a tile to edit</div>
        </div>
      </div>
      <div class="map3d-canvas-wrap" id="map3d-canvas-wrap"></div>
      <div class="map3d-warnings" id="map3d-warnings"></div>
    </div>
  `;

  const select = root.querySelector<HTMLSelectElement>("#map3d-zone");
  const loadButton = root.querySelector<HTMLButtonElement>("#map3d-load");
  const seasonSelect = root.querySelector<HTMLSelectElement>("#map3d-season");
  const metadataSave = root.querySelector<HTMLButtonElement>("#map3d-meta-save");
  const metadataFields = {
    location: root.querySelector<HTMLInputElement>("#map3d-meta-location"),
    matrix: root.querySelector<HTMLInputElement>("#map3d-meta-matrix"),
    sourceArea: root.querySelector<HTMLInputElement>("#map3d-meta-area-source"),
    overworlds: root.querySelector<HTMLInputElement>("#map3d-meta-overworlds"),
    script: root.querySelector<HTMLInputElement>("#map3d-meta-script"),
    text: root.querySelector<HTMLInputElement>("#map3d-meta-text"),
    encounter: root.querySelector<HTMLInputElement>("#map3d-meta-encounter"),
    mapType: root.querySelector<HTMLInputElement>("#map3d-meta-map-type"),
    weather: root.querySelector<HTMLInputElement>("#map3d-meta-weather"),
    parent: root.querySelector<HTMLInputElement>("#map3d-meta-parent"),
    levelScript: root.querySelector<HTMLInputElement>("#map3d-meta-level-script"),
    camera: root.querySelector<HTMLInputElement>("#map3d-meta-camera"),
    flags: root.querySelector<HTMLInputElement>("#map3d-meta-flags"),
    loadedArea: root.querySelector<HTMLInputElement>("#map3d-meta-area-loaded"),
    texturePack: root.querySelector<HTMLInputElement>("#map3d-meta-texture-pack"),
    buildings: root.querySelector<HTMLInputElement>("#map3d-meta-buildings"),
    srt: root.querySelector<HTMLInputElement>("#map3d-meta-srt"),
    pat: root.querySelector<HTMLInputElement>("#map3d-meta-pat"),
    exterior: root.querySelector<HTMLInputElement>("#map3d-meta-exterior"),
  };
  const showBuildings = root.querySelector<HTMLInputElement>("#map3d-show-buildings");
  const showBuildingBounds = root.querySelector<HTMLInputElement>("#map3d-show-building-bounds");
  const showNpcs = root.querySelector<HTMLInputElement>("#map3d-show-npcs");
  const showEntities = root.querySelector<HTMLInputElement>("#map3d-show-entities");
  const showPermissions = root.querySelector<HTMLInputElement>("#map3d-show-permissions");
  const permissionClass = root.querySelector<HTMLInputElement>("#map3d-permission-class");
  const permissionFlagInputs = Array.from(root.querySelectorAll<HTMLInputElement>(".map3d-flag-check input"));
  const permissionFlagValue = root.querySelector<HTMLDivElement>("#map3d-permission-flag-value");
  const permissionPaint = root.querySelector<HTMLInputElement>("#map3d-permission-paint");
  const permissionApply = root.querySelector<HTMLButtonElement>("#map3d-permission-apply");
  const permissionSave = root.querySelector<HTMLButtonElement>("#map3d-permission-save");
  const permissionSelected = root.querySelector<HTMLDivElement>("#map3d-permission-selected");
  const search = root.querySelector<HTMLInputElement>("#map3d-search");
  const canvasWrap = root.querySelector<HTMLDivElement>("#map3d-canvas-wrap");
  const warningsHost = root.querySelector<HTMLDivElement>("#map3d-warnings");
  if (!select || !canvasWrap) return;
  const zoneSelect = select;

  const setStatus = (message: string) => {
    if (message) console.info(`[Maps 3D] ${message}`);
  };

  const load = async (zoneId: number) => {
    const token = ++loadToken;
    activeZone = zoneId;
    setStatus("Loading map assets...");
    try {
      const data = await loadMap3dEditorZone(project, zoneId, activeSeason, (message) => {
        if (token === loadToken) setStatus(message);
      });
      if (token !== loadToken) return;
      activeData = data;
      dirtyPermissionEdits.clear();
      state ??= createRenderer(canvasWrap);
      state.onPermissionPick = (selection) => {
        selectPermissionTile(selection);
        if (permissionPaint?.checked) applyPermissionBrush();
      };
      renderSceneData(state, data);
      writeMetadataForm(getMap3dZoneMetadata(project, zoneId), data);
      renderMap3dDiagnostics(warningsHost, data);
      applyLayerVisibility(state, showBuildings?.checked ?? true, showBuildingBounds?.checked ?? false, showNpcs?.checked ?? true, showEntities?.checked ?? true, showPermissions?.checked ?? false);
      rememberMap3dView(project, zoneId, activeSeason);
      setStatus(data.label);
    } catch (error) {
      if (token !== loadToken) return;
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      if (warningsHost) warningsHost.innerHTML = `<strong>Map load failed</strong><div>${escapeHtml(message)}</div>`;
      state ??= createRenderer(canvasWrap);
      clearGroup(state.terrainGroup);
      clearGroup(state.buildingGroup);
      clearGroup(state.buildingBoundsGroup);
      clearGroup(state.npcGroup);
      clearGroup(state.overlayGroup);
      clearGroup(state.permissionGroup);
    }
  };

  select.addEventListener("change", () => {
    activeZone = Number(select.value);
  });

  loadButton?.addEventListener("click", () => {
    void load(Number(select.value));
  });

  seasonSelect?.addEventListener("change", () => {
    activeSeason = seasonSelect.value as Map3dSeason;
    void load(activeZone);
  });

  showBuildings?.addEventListener("change", () => {
    if (state) applyLayerVisibility(state, showBuildings.checked, showBuildingBounds?.checked ?? false, showNpcs?.checked ?? true, showEntities?.checked ?? true, showPermissions?.checked ?? false);
  });

  showBuildingBounds?.addEventListener("change", () => {
    if (state) applyLayerVisibility(state, showBuildings?.checked ?? true, showBuildingBounds.checked, showNpcs?.checked ?? true, showEntities?.checked ?? true, showPermissions?.checked ?? false);
  });

  showNpcs?.addEventListener("change", () => {
    if (state) applyLayerVisibility(state, showBuildings?.checked ?? true, showBuildingBounds?.checked ?? false, showNpcs.checked, showEntities?.checked ?? true, showPermissions?.checked ?? false);
  });

  showEntities?.addEventListener("change", () => {
    if (state) applyLayerVisibility(state, showBuildings?.checked ?? true, showBuildingBounds?.checked ?? false, showNpcs?.checked ?? true, showEntities.checked, showPermissions?.checked ?? false);
  });

  showPermissions?.addEventListener("change", () => {
    if (state) applyLayerVisibility(state, showBuildings?.checked ?? true, showBuildingBounds?.checked ?? false, showNpcs?.checked ?? true, showEntities?.checked ?? true, showPermissions.checked);
  });

  permissionPaint?.addEventListener("change", () => {
    if (!permissionPaint.checked || !showPermissions) return;
    showPermissions.checked = true;
    if (state) applyLayerVisibility(state, showBuildings?.checked ?? true, showBuildingBounds?.checked ?? false, showNpcs?.checked ?? true, showEntities?.checked ?? true, true);
  });

  for (const input of permissionFlagInputs) {
    input.addEventListener("change", () => {
      updateFlagValueDisplay();
    });
  }

  permissionApply?.addEventListener("click", () => {
    applyPermissionBrush();
  });

  permissionSave?.addEventListener("click", async () => {
    if (dirtyPermissionEdits.size === 0) {
      setStatus("No permission edits to save.");
      return;
    }
    try {
      const edits = [...dirtyPermissionEdits.values()];
      if (isGen4Project(project)) saveGen4Map3dPermissionEdits(project, edits);
      else await saveMap3dPermissionEdits(project, edits);
      const saved = dirtyPermissionEdits.size;
      dirtyPermissionEdits.clear();
      onDirty?.();
      setStatus(`Saved ${saved} permission edit${saved === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  metadataSave?.addEventListener("click", () => {
    if (!activeData) {
      setStatus("Load a map before editing metadata.");
      return;
    }
    try {
      updateMap3dZoneMetadata(project, activeZone, readZoneMetadataForm());
      updateMap3dAreaMetadata(project, activeData.areaId, activeData.areaMetadata, readAreaMetadataForm());
      zones = getMap3dZones(project);
      refreshZoneSelect(search?.value ?? "");
      onDirty?.();
      setStatus("Saved metadata. Reloading map assets...");
      void load(activeZone);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  search?.addEventListener("input", () => {
    refreshZoneSelect(search.value);
  });

  root.querySelector<HTMLButtonElement>("#map3d-reset")?.addEventListener("click", () => {
    if (state) frameGroup(state);
  });

  root.querySelector<HTMLButtonElement>("#map3d-topdown")?.addEventListener("click", () => {
    if (state) topDownGroup(state);
  });

  if (zones.length === 0) setStatus("No parsed headers are available.");
  else void load(initialZone);

  function selectPermissionTile(selection: PermissionSelection): void {
    if (!state) return;
    state.selectedPermission = selection;
    const tile = selection.tile;
    if (permissionPaint?.checked !== true) {
      if (permissionClass) permissionClass.value = String(tile.tileClass);
      setFlagCheckboxes(tile.flags);
    }
    if (permissionSelected) {
      permissionSelected.innerHTML = `
        <div>Chunk ${selection.chunkId} / Tile ${selection.tileX}, ${selection.tileY}</div>
        <div>Matrix cell: ${selection.matrixX}, ${selection.matrixY}</div>
        <div>Class: ${tile.tileClass} / Flags: ${formatHex16(tile.flags)}</div>
        <div>Height type: ${tile.heightType} / Slope: ${tile.slope} / Height: ${tile.height}</div>
      `;
    }
    updatePermissionSelectionMarker(state);
  }

  function applyPermissionBrush(): void {
    if (!state?.selectedPermission || !activeData) {
      setStatus("Select a collision tile first.");
      return;
    }
    const tileClass = clampU16(Number(permissionClass?.value ?? 0));
    const flags = readFlagCheckboxes();
    const selection = state.selectedPermission;
    for (const chunk of activeData.chunks) {
      if (chunk.chunkId !== selection.chunkId || !chunk.permissions) continue;
      const tile = chunk.permissions.tiles[selection.tileY * chunk.permissions.width + selection.tileX];
      if (!tile) continue;
      tile.tileClass = tileClass;
      tile.flags = flags;
      selection.tile = tile;
    }
    dirtyPermissionEdits.set(permissionEditKey(selection.chunkId, selection.tileX, selection.tileY), {
      chunkId: selection.chunkId,
      tileX: selection.tileX,
      tileY: selection.tileY,
      tileClass,
      flags,
    });
    renderPermissionOverlays(state, activeData);
    selectPermissionTile(selection);
    setStatus(`Edited chunk ${selection.chunkId} tile ${selection.tileX}, ${selection.tileY}.`);
  }

  function setFlagCheckboxes(flags: number): void {
    for (const input of permissionFlagInputs) {
      input.checked = (flags & Number(input.dataset.flag ?? 0)) !== 0;
    }
    updateFlagValueDisplay();
  }

  function readFlagCheckboxes(): number {
    return permissionFlagInputs.reduce((flags, input) => (input.checked ? flags | Number(input.dataset.flag ?? 0) : flags), 0) & 0xffff;
  }

  function updateFlagValueDisplay(): void {
    if (permissionFlagValue) permissionFlagValue.textContent = `Calculated flags: ${formatHex16(readFlagCheckboxes())}`;
  }

  function writeMetadataForm(zone: Map3dZoneMetadata, data: Map3dSceneData): void {
    if (metadataFields.location) metadataFields.location.value = zone.locationName;
    setInputValue(metadataFields.matrix, zone.matrixId);
    setInputValue(metadataFields.sourceArea, zone.areaId);
    setInputValue(metadataFields.overworlds, zone.overworldsId);
    setInputValue(metadataFields.script, zone.scriptId);
    setInputValue(metadataFields.text, zone.textBankId);
    setInputValue(metadataFields.encounter, zone.encounterId);
    setInputValue(metadataFields.mapType, zone.mapType);
    setInputValue(metadataFields.weather, zone.weatherId);
    setInputValue(metadataFields.parent, zone.parentMapId);
    setInputValue(metadataFields.levelScript, zone.levelScriptId);
    setInputValue(metadataFields.camera, zone.cameraId);
    setInputValue(metadataFields.flags, zone.flags);
    setInputValue(metadataFields.loadedArea, data.areaId);
    setInputValue(metadataFields.texturePack, data.areaMetadata.texturesId);
    setInputValue(metadataFields.buildings, data.areaMetadata.buildingsId);
    setInputValue(metadataFields.srt, data.areaMetadata.srtAnimeIdx);
    setInputValue(metadataFields.pat, data.areaMetadata.patAnimeIdx);
    if (metadataFields.exterior) metadataFields.exterior.checked = data.areaMetadata.isExterior;
  }

  function readZoneMetadataForm(): Partial<Record<keyof Map3dZoneMetadata, string | number>> {
    return {
      locationName: metadataFields.location?.value ?? "",
      matrixId: readNumberInput(metadataFields.matrix, "Matrix"),
      areaId: readNumberInput(metadataFields.sourceArea, "Source area"),
      overworldsId: readNumberInput(metadataFields.overworlds, "Overworlds"),
      scriptId: readNumberInput(metadataFields.script, "Scripts"),
      textBankId: readNumberInput(metadataFields.text, "Text bank"),
      encounterId: readNumberInput(metadataFields.encounter, "Encounters"),
      mapType: readNumberInput(metadataFields.mapType, "Map type"),
      weatherId: readNumberInput(metadataFields.weather, "Weather"),
      parentMapId: readNumberInput(metadataFields.parent, "Parent map"),
      levelScriptId: readNumberInput(metadataFields.levelScript, "Level script"),
      cameraId: readNumberInput(metadataFields.camera, "Camera"),
      flags: readNumberInput(metadataFields.flags, "Header flags"),
    };
  }

  function readAreaMetadataForm(): Partial<Map3dAreaMetadata> {
    return {
      texturesId: readNumberInput(metadataFields.texturePack, "Texture pack"),
      buildingsId: readNumberInput(metadataFields.buildings, "Building bundle"),
      srtAnimeIdx: readNumberInput(metadataFields.srt, "SRT anim"),
      patAnimeIdx: readNumberInput(metadataFields.pat, "PAT anim"),
      isExterior: metadataFields.exterior?.checked ?? true,
    };
  }

  function refreshZoneSelect(queryText: string): void {
    const query = queryText.trim().toLowerCase();
    zoneSelect.innerHTML = zones
      .filter((zone) => zone.label.toLowerCase().includes(query) || String(zone.zoneId).includes(query))
      .map((zone) => `<option value="${zone.zoneId}" ${zone.zoneId === activeZone ? "selected" : ""}>${escapeHtml(zone.label)}</option>`)
      .join("");
  }
}

async function loadMap3dEditorZone(project: ProjectState, zoneId: number, season: Map3dSeason, onProgress?: (message: string) => void): Promise<Map3dSceneData> {
  if (!isGen4Project(project)) return loadMap3dZone(project, zoneId, { season }, onProgress);
  onProgress?.("Reading Gen 4 map archives");
  await ensureGen4Map3dResources(project);
  const metadata = getMap3dZoneMetadata(project, zoneId);
  onProgress?.("Building Gen 4 stitched map scene");
  return buildGen4Map3dScene(project, metadata.matrixId, { headerId: zoneId, label: metadata.locationName, locationGroup: true });
}

function renderMap3dDiagnostics(host: HTMLDivElement | null, data: Map3dSceneData): void {
  if (!host) return;
  const diagnostics = data.buildingDiagnostics ?? [];
  const placementCount = data.buildingPlacementCount ?? data.buildingCount;
  const failedBuildings = diagnostics.filter((entry) => entry.status !== "rendered");
  if (data.warnings.length === 0 && placementCount === 0) {
    host.innerHTML = "";
    return;
  }

  const lines = [
    `<strong>${escapeHtml(data.label)}</strong>`,
    `<div>Chunks: ${data.chunkCount} / Buildings: ${data.buildingCount}/${placementCount} rendered / Textured primitives: ${data.textureCount}</div>`,
  ];

  if (diagnostics.length > 0) {
    const rendered = diagnostics.filter((entry) => entry.status === "rendered").length;
    const failedSummary = failedBuildings.length === 0 ? `all ${rendered} placement${rendered === 1 ? "" : "s"} decoded` : `${failedBuildings.length} unresolved placement${failedBuildings.length === 1 ? "" : "s"}`;
    lines.push(`<div>Building audit: ${failedSummary}</div>`);
    if (failedBuildings.length > 0) {
      lines.push(
        `<details open><summary>Unresolved buildings</summary>${failedBuildings
          .slice(0, 24)
          .map((entry) => `<div>${formatBuildingDiagnostic(entry)}</div>`)
          .join("")}${failedBuildings.length > 24 ? `<div>...${failedBuildings.length - 24} more</div>` : ""}</details>`,
      );
    }
  }

  if (data.warnings.length > 0) {
    lines.push(
      `<details ${failedBuildings.length === 0 ? "" : "open"}><summary>${data.warnings.length} warning${data.warnings.length === 1 ? "" : "s"}</summary>${data.warnings
        .slice(0, 24)
        .map((warning) => `<div>${escapeHtml(warning)}</div>`)
        .join("")}${data.warnings.length > 24 ? `<div>...${data.warnings.length - 24} more</div>` : ""}</details>`,
    );
  }

  host.innerHTML = lines.join("");
}

function formatBuildingDiagnostic(entry: NonNullable<Map3dSceneData["buildingDiagnostics"]>[number]): string {
  const base = `Map ${entry.mapId} placement ${entry.placementIndex} model ${entry.modelId}: ${entry.status}`;
  const detail =
    entry.status === "rendered"
      ? `${entry.primitiveCount ?? 0} primitive${entry.primitiveCount === 1 ? "" : "s"}, ${entry.triangleCount ?? 0} triangle${entry.triangleCount === 1 ? "" : "s"}`
      : (entry.message ?? "");
  return escapeHtml(detail ? `${base} (${detail})` : base);
}

function metadataNumberInput(id: string, label: string, min: number, max: number): string {
  return `
    <label class="map3d-field">
      <span>${label}</span>
      <input class="filter-input" id="${id}" type="number" min="${min}" max="${max}" step="1" />
    </label>
  `;
}

function setInputValue(input: HTMLInputElement | null | undefined, value: number): void {
  if (input) input.value = String(value);
}

function readNumberInput(input: HTMLInputElement | null | undefined, label: string): number {
  const raw = input?.value.trim() ?? "";
  if (!/^-?\d+$/u.test(raw)) throw new Error(`${label} must be an integer`);
  const value = Number(raw);
  const min = input?.min ? Number(input.min) : Number.MIN_SAFE_INTEGER;
  const max = input?.max ? Number(input.max) : Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}

function createRenderer(container: HTMLElement): RendererState {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20232a);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = "";
  container.append(renderer.domElement);

  const grid = new THREE.GridHelper(4096, 32, 0x6c7080, 0x3c4048);
  scene.add(grid);
  const group = new THREE.Group();
  const terrainGroup = new THREE.Group();
  const buildingGroup = new THREE.Group();
  const buildingBoundsGroup = new THREE.Group();
  const npcGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  const permissionGroup = new THREE.Group();
  buildingBoundsGroup.visible = false;
  group.add(terrainGroup, buildingGroup, buildingBoundsGroup, npcGroup, overlayGroup, permissionGroup);
  scene.add(group);

  const state: RendererState = {
    renderer,
    scene,
    camera,
    group,
    terrainGroup,
    buildingGroup,
    buildingBoundsGroup,
    npcGroup,
    overlayGroup,
    permissionGroup,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    animationId: 0,
    dragging: false,
    dragMode: "rotate",
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    yaw: Math.PI / 4,
    pitch: 0.9,
    distance: 1400,
    target: new THREE.Vector3(),
  };

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const updateCamera = () => {
    const y = Math.sin(state.pitch) * state.distance;
    const r = Math.cos(state.pitch) * state.distance;
    camera.position.set(state.target.x + Math.sin(state.yaw) * r, state.target.y + y, state.target.z + Math.cos(state.yaw) * r);
    camera.lookAt(state.target);
  };
  const animate = () => {
    resize();
    updateCamera();
    renderer.render(scene, camera);
    state.animationId = window.requestAnimationFrame(animate);
  };

  renderer.domElement.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.dragMode = event.shiftKey ? "pan" : "rotate";
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.startX = event.clientX;
    state.startY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    if (state.dragMode === "pan") {
      panCameraTarget(state, camera, dx, dy);
    } else {
      state.yaw -= dx * 0.008;
      state.pitch = Math.min(1.45, Math.max(0.12, state.pitch + dy * 0.006));
    }
    state.lastX = event.clientX;
    state.lastY = event.clientY;
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (state.dragging && state.dragMode === "rotate" && moved < 4) pickPermissionTile(state, event);
    state.dragging = false;
  });
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const clampedDelta = Math.max(-80, Math.min(80, event.deltaY));
      state.distance = Math.min(12000, Math.max(80, state.distance * Math.exp(clampedDelta * 0.0018)));
    },
    { passive: false },
  );
  renderer.domElement.tabIndex = 0;
  renderer.domElement.addEventListener("pointerdown", () => renderer.domElement.focus());
  renderer.domElement.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const panStep = Math.max(16, state.distance * 0.035);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() === 0) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    if (event.key === "ArrowLeft") state.target.addScaledVector(right, -panStep);
    if (event.key === "ArrowRight") state.target.addScaledVector(right, panStep);
    if (event.key === "ArrowUp") state.target.addScaledVector(forward, panStep);
    if (event.key === "ArrowDown") state.target.addScaledVector(forward, -panStep);
  });

  animate();
  return state;
}

function pickPermissionTile(state: RendererState, event: PointerEvent): void {
  if (!state.currentData || !state.permissionGroup.visible) return;
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const meshes = state.permissionGroup.children.filter((child): child is THREE.Mesh & { userData: PermissionMeshUserData } => {
    const userData = (child as THREE.Mesh).userData as Partial<PermissionMeshUserData>;
    return Array.isArray(userData.tileIndices) && Boolean(userData.chunk);
  });
  const hits = state.raycaster.intersectObjects(meshes, false);
  const hit = hits[0];
  if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return;
  const mesh = hit.object as THREE.Mesh & { userData: PermissionMeshUserData };
  const tileIndex = mesh.userData.tileIndices[hit.faceIndex];
  const chunk = mesh.userData.chunk;
  const permissions = chunk.permissions;
  if (!permissions || tileIndex === undefined) return;
  const tile = permissions.tiles[tileIndex];
  if (!tile) return;
  state.onPermissionPick?.({
    chunkId: chunk.chunkId,
    matrixX: chunk.matrixX,
    matrixY: chunk.matrixY,
    tileX: tileIndex % permissions.width,
    tileY: Math.floor(tileIndex / permissions.width),
    tile,
  });
}

function panCameraTarget(state: RendererState, camera: THREE.PerspectiveCamera, dx: number, dy: number): void {
  const panScale = Math.max(0.08, state.distance * 0.0018);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() === 0) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  state.target.addScaledVector(right, -dx * panScale);
  state.target.addScaledVector(forward, dy * panScale);
}

function renderSceneData(state: RendererState, data: Map3dSceneData): void {
  state.currentData = data;
  state.selectedPermission = undefined;
  clearGroup(state.terrainGroup);
  clearGroup(state.buildingGroup);
  clearGroup(state.buildingBoundsGroup);
  clearGroup(state.npcGroup);
  clearGroup(state.overlayGroup);
  clearGroup(state.permissionGroup);
  const textureCache = new Map<string, THREE.Texture>();

  for (const chunk of data.chunks) {
    const chunkGroup = new THREE.Group();
    chunkGroup.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
    for (const primitive of chunk.primitives) {
      if (primitive.indices.length === 0 || primitive.positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
      if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
      if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
      if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
      if (!primitive.normals) geometry.computeVertexNormals();
      const texture = primitive.material.texture ? getTexture(textureCache, primitive.material.texture, primitive.material) : undefined;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: texture ? 0xffffff : new THREE.Color(...primitive.material.diffuse),
        vertexColors: Boolean(primitive.colors),
        transparent: primitive.material.alpha < 1 || Boolean(texture),
        opacity: primitive.material.alpha,
        alphaTest: texture ? 0.05 : 0,
        side: THREE.DoubleSide,
      });
      chunkGroup.add(new THREE.Mesh(geometry, material));
    }
    state.terrainGroup.add(chunkGroup);
  }
  for (const building of data.buildings) {
    const buildingGroup = new THREE.Group();
    buildingGroup.position.set(building.worldX, building.worldY, building.worldZ);
    buildingGroup.rotation.y = THREE.MathUtils.degToRad(building.rotationY);
    addPrimitivesToGroup(buildingGroup, building.primitives, textureCache);
    state.buildingGroup.add(buildingGroup);
    const boundsOverlay = createBuildingBoundsOverlay(building);
    if (boundsOverlay) state.buildingBoundsGroup.add(boundsOverlay);
  }
  for (const npc of data.npcModels) {
    const npcGroup = new THREE.Group();
    npcGroup.position.set(npc.x, npc.y, npc.z);
    npcGroup.rotation.y = THREE.MathUtils.degToRad(npc.rotationY);
    addPrimitivesToGroup(npcGroup, npc.primitives, textureCache);
    state.npcGroup.add(npcGroup);
  }
  for (const entity of data.entities) {
    if (entity.kind !== "npc" || data.npcModels.length === 0) state.overlayGroup.add(createEntityOverlay(entity, textureCache));
  }
  renderPermissionOverlays(state, data);
  topDownGroup(state);
}

function createBuildingBoundsOverlay(building: Map3dSceneData["buildings"][number]): THREE.Group | undefined {
  const bounds = buildingWorldBounds(building);
  if (!bounds) return undefined;
  const sizeX = Math.max(1, bounds.maxX - bounds.minX);
  const sizeY = Math.max(1, bounds.maxY - bounds.minY);
  const sizeZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const group = new THREE.Group();
  group.name = `building-bounds-${building.sourceChunkId}-${building.placementIndex ?? building.uid}`;

  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xff2f2f,
      transparent: true,
      opacity: 0.22,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.position.set(centerX, centerY, centerZ);
  fill.renderOrder = 30;
  group.add(fill);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0xffd0d0,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    }),
  );
  edges.position.copy(fill.position);
  edges.renderOrder = 31;
  group.add(edges);
  return group;
}

function buildingWorldBounds(building: Map3dSceneData["buildings"][number]): NonNullable<Map3dSceneData["buildings"][number]["bounds"]> | undefined {
  if (building.bounds) return building.bounds;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let seen = false;
  const rotation = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(building.rotationY));
  const point = new THREE.Vector3();
  for (const primitive of building.primitives) {
    for (let index = 0; index < primitive.positions.length; index += 3) {
      point.set(primitive.positions[index] ?? 0, primitive.positions[index + 1] ?? 0, primitive.positions[index + 2] ?? 0);
      point.applyMatrix4(rotation);
      point.x += building.worldX;
      point.y += building.worldY;
      point.z += building.worldZ;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      minZ = Math.min(minZ, point.z);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      maxZ = Math.max(maxZ, point.z);
      seen = true;
    }
  }
  return seen ? { minX, maxX, minY, maxY, minZ, maxZ } : undefined;
}

function renderPermissionOverlays(state: RendererState, data: Map3dSceneData): void {
  clearGroup(state.permissionGroup);
  for (const chunk of data.chunks) {
    if (!chunk.permissions) continue;
    state.permissionGroup.add(createPermissionMesh(chunk));
  }
  updatePermissionSelectionMarker(state);
}

function createPermissionMesh(chunk: Map3dSceneData["chunks"][number]): THREE.Mesh {
  const permissions = chunk.permissions;
  if (!permissions) throw new Error("Permission mesh requires permission data");
  const positions: number[] = [];
  const colors: number[] = [];
  const tileIndices: number[] = [];
  const halfWidth = (permissions.width * PERMISSION_TILE_SIZE) / 2;
  const halfHeight = (permissions.height * PERMISSION_TILE_SIZE) / 2;

  permissions.tiles.forEach((tile, tileIndex) => {
    const x = tileIndex % permissions.width;
    const y = Math.floor(tileIndex / permissions.width);
    const x0 = -halfWidth + x * PERMISSION_TILE_SIZE;
    const x1 = x0 + PERMISSION_TILE_SIZE;
    const z0 = -halfHeight + y * PERMISSION_TILE_SIZE;
    const z1 = z0 + PERMISSION_TILE_SIZE;
    positions.push(x0, 5, z0, x1, 5, z0, x1, 5, z1, x0, 5, z0, x1, 5, z1, x0, 5, z1);
    const color = permissionColor(tile);
    for (let i = 0; i < 6; i += 1) colors.push(color.r, color.g, color.b);
    tileIndices.push(tileIndex, tileIndex);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.46,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
  mesh.renderOrder = 4;
  mesh.userData = { chunk, tileIndices } satisfies PermissionMeshUserData;
  return mesh;
}

function updatePermissionSelectionMarker(state: RendererState): void {
  const previous = state.permissionGroup.getObjectByName("permission-selection");
  if (previous) {
    state.permissionGroup.remove(previous);
    previous.traverse((object) => {
      const line = object as THREE.Line;
      line.geometry?.dispose();
      const material = line.material;
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else if (material) disposeMaterial(material);
    });
  }
  const selection = state.selectedPermission;
  const data = state.currentData;
  if (!selection || !data) return;
  const chunk = data.chunks.find(
    (candidate) => candidate.chunkId === selection.chunkId && candidate.matrixX === selection.matrixX && candidate.matrixY === selection.matrixY && candidate.permissions,
  );
  const permissions = chunk?.permissions;
  if (!chunk || !permissions) return;
  const halfWidth = (permissions.width * PERMISSION_TILE_SIZE) / 2;
  const halfHeight = (permissions.height * PERMISSION_TILE_SIZE) / 2;
  const x0 = chunk.worldX - halfWidth + selection.tileX * PERMISSION_TILE_SIZE;
  const x1 = x0 + PERMISSION_TILE_SIZE;
  const z0 = chunk.worldZ - halfHeight + selection.tileY * PERMISSION_TILE_SIZE;
  const z1 = z0 + PERMISSION_TILE_SIZE;
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0, (chunk.worldY ?? 0) + 8, z0),
    new THREE.Vector3(x1, (chunk.worldY ?? 0) + 8, z0),
    new THREE.Vector3(x1, (chunk.worldY ?? 0) + 8, z1),
    new THREE.Vector3(x0, (chunk.worldY ?? 0) + 8, z1),
  ]);
  const marker = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
  marker.name = "permission-selection";
  marker.renderOrder = 5;
  state.permissionGroup.add(marker);
}

function addPrimitivesToGroup(group: THREE.Group, primitives: Map3dSceneData["chunks"][number]["primitives"], textureCache: Map<string, THREE.Texture>): void {
  for (const primitive of primitives) {
    if (primitive.indices.length === 0 || primitive.positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
    if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
    if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
    if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
    if (!primitive.normals) geometry.computeVertexNormals();
    const texture = primitive.material.texture ? getTexture(textureCache, primitive.material.texture, primitive.material) : undefined;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: texture ? 0xffffff : new THREE.Color(...primitive.material.diffuse),
      vertexColors: Boolean(primitive.colors),
      transparent: primitive.material.alpha < 1 || Boolean(texture),
      opacity: primitive.material.alpha,
      alphaTest: texture ? 0.05 : 0,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(geometry, material));
  }
}

function createEntityOverlay(entity: Map3dEntityOverlay, textureCache: Map<string, THREE.Texture>): THREE.Group {
  if (entity.kind === "warp") return createGroundEntityOverlay(entity);
  if ((entity.kind === "npc" || entity.kind === "furniture") && entity.sprite) return createSpriteEntityOverlay(entity, textureCache);
  return createVolumeEntityOverlay(entity);
}

function createSpriteEntityOverlay(entity: Map3dEntityOverlay, textureCache: Map<string, THREE.Texture>): THREE.Group {
  const texture = getEntitySpriteTexture(textureCache, entity);
  const source = entity.sprite?.texture;
  const worldHeight = Math.max(8, entity.sprite?.worldHeight ?? entity.height);
  const aspect = source && source.height > 0 ? source.width / source.height : 1;
  const worldWidth = Math.max(8, worldHeight * aspect);
  const positions = new Float32Array([-worldWidth / 2, 0, 0, worldWidth / 2, 0, 0, worldWidth / 2, worldHeight, 0, -worldWidth / 2, worldHeight, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: entity.sprite?.missing ? 0 : 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 5;
  mesh.renderOrder = 24;

  const x = entity.centered ? entity.x : entity.x + entity.width / 2;
  const z = entity.centered ? entity.z : entity.z + entity.depth / 2;
  const y = entity.kind === "npc" ? entity.y : entity.y + 1;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.add(mesh);
  return group;
}

function createGroundEntityOverlay(entity: Map3dEntityOverlay): THREE.Group {
  const color = entityColor(entity.kind);
  const group = new THREE.Group();
  const width = Math.max(1, entity.width);
  const depth = Math.max(1, entity.depth);
  const x = entity.centered ? entity.x : entity.x + width / 2;
  const z = entity.centered ? entity.z : entity.z + depth / 2;
  const geometry = new THREE.PlaneGeometry(width, depth);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, entity.y + 1.5, z);
  mesh.renderOrder = 12;
  group.add(mesh);

  const halfW = width / 2;
  const halfD = depth / 2;
  const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x - halfW, entity.y + 2, z - halfD),
    new THREE.Vector3(x + halfW, entity.y + 2, z - halfD),
    new THREE.Vector3(x + halfW, entity.y + 2, z + halfD),
    new THREE.Vector3(x - halfW, entity.y + 2, z + halfD),
  ]);
  const edges = new THREE.LineLoop(edgeGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  edges.renderOrder = 13;
  group.add(edges);
  return group;
}

function createVolumeEntityOverlay(entity: Map3dEntityOverlay): THREE.Group {
  const group = new THREE.Group();
  const color = entityColor(entity.kind);
  const height = Math.max(8, entity.height);
  const geometry = entity.kind === "npc" ? new THREE.CylinderGeometry(5, 5, height, 12) : new THREE.BoxGeometry(entity.width, height, entity.depth);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: entity.kind === "npc" ? 0.9 : 0.28, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  const x = entity.centered ? entity.x : entity.x + entity.width / 2;
  const z = entity.centered ? entity.z : entity.z + entity.depth / 2;
  group.position.set(x, entity.y + height / 2, z);
  group.add(mesh);

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  group.add(edges);

  const label = makeLabelSprite(entity.label, color);
  label.position.set(0, height / 2 + 12, 0);
  group.add(label);
  return group;
}

function getEntitySpriteTexture(textureCache: Map<string, THREE.Texture>, entity: Map3dEntityOverlay): THREE.Texture {
  const source = entity.sprite?.texture;
  const assetUrl = entity.sprite?.assetUrl;
  const key = source ? `entity:${source.name}` : assetUrl ? `entity-asset:${assetUrl}` : `entity-missing:${entity.kind}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  if (assetUrl && !source) {
    const texture = new THREE.TextureLoader().load(assetUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    textureCache.set(key, texture);
    return texture;
  }
  const rgba = source?.rgba ?? missingEntitySpriteRgba();
  const texture = new THREE.DataTexture(rgba, source?.width ?? 16, source?.height ?? 16, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

function missingEntitySpriteRgba(): Uint8Array {
  const size = 16;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      rgba[offset] = 255;
      rgba[offset + 1] = border ? 255 : 40;
      rgba[offset + 2] = border ? 255 : 40;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

function entityColor(kind: Map3dEntityOverlay["kind"]): number {
  return {
    furniture: 0x78dce8,
    npc: 0xffd866,
    warp: 0x59c2ff,
    trigger: 0xff8f40,
  }[kind];
}

function makeLabelSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 64;
  if (context) {
    context.fillStyle = "rgba(12, 14, 20, 0.78)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.lineWidth = 4;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = "#f8f8f2";
    context.font = "24px system-ui, sans-serif";
    context.textBaseline = "middle";
    context.fillText(text.slice(0, 24), 14, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(96, 24, 1);
  return sprite;
}

function applyLayerVisibility(state: RendererState, showBuildings: boolean, showBuildingBounds: boolean, showNpcs: boolean, showEntities: boolean, showPermissions: boolean): void {
  state.buildingGroup.visible = showBuildings;
  state.buildingBoundsGroup.visible = showBuildingBounds;
  state.npcGroup.visible = showNpcs;
  state.overlayGroup.visible = showEntities;
  state.permissionGroup.visible = showPermissions;
}

function permissionColor(tile: Map3dPermissionTile): THREE.Color {
  return new THREE.Color(gen5PermissionColorNumber(tile));
}

function permissionEditKey(chunkId: number, tileX: number, tileY: number): string {
  return `${chunkId}:${tileX}:${tileY}`;
}

function readRememberedMap3dView(project: ProjectState, validZoneIds: number[]): { zoneId: number; season: Map3dSeason } | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const parsed = JSON.parse(localStorage.getItem(map3dViewStorageKey(project)) ?? "null") as { zoneId?: unknown; season?: unknown } | null;
    if (!parsed || typeof parsed.zoneId !== "number" || !validZoneIds.includes(parsed.zoneId)) return undefined;
    const season = isMap3dSeason(parsed.season) ? parsed.season : "spring";
    return { zoneId: parsed.zoneId, season };
  } catch {
    return undefined;
  }
}

function rememberMap3dView(project: ProjectState, zoneId: number, season: Map3dSeason): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(map3dViewStorageKey(project), JSON.stringify({ zoneId, season }));
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

function map3dViewStorageKey(project: ProjectState): string {
  return `${MAP3D_VIEW_STORAGE_KEY}.${project.session.baseVersion}`;
}

function isMap3dSeason(value: unknown): value is Map3dSeason {
  return value === "spring" || value === "summer" || value === "autumn" || value === "winter";
}

function getTexture(
  cache: Map<string, THREE.Texture>,
  textureData: NonNullable<Map3dSceneData["chunks"][number]["primitives"][number]["material"]["texture"]>,
  material: Map3dSceneData["chunks"][number]["primitives"][number]["material"],
): THREE.Texture {
  const key = `${textureData.name}:${material.repeatS ? 1 : 0}:${material.repeatT ? 1 : 0}:${material.flipS ? 1 : 0}:${material.flipT ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const texture = new THREE.DataTexture(textureData.rgba, textureData.width, textureData.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = textureWrapMode(Boolean(material.repeatS), Boolean(material.flipS));
  texture.wrapT = textureWrapMode(Boolean(material.repeatT), Boolean(material.flipT));
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

function textureWrapMode(repeat: boolean, flip: boolean): THREE.Wrapping {
  if (!repeat) return THREE.ClampToEdgeWrapping;
  return flip ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else if (material) disposeMaterial(material);
    });
  }
}

function disposeMaterial(material: THREE.Material): void {
  const mapped = material as THREE.Material & { map?: THREE.Texture };
  mapped.map?.dispose();
  material.dispose();
}

function frameGroup(state: RendererState): void {
  const box = new THREE.Box3().setFromObject(state.group);
  if (box.isEmpty()) {
    state.target.set(0, 0, 0);
    state.distance = 1200;
    return;
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  state.target.copy(center);
  state.distance = Math.max(200, Math.max(size.x, size.y, size.z) * 1.4);
}

function topDownGroup(state: RendererState): void {
  const box = new THREE.Box3().setFromObject(state.group);
  if (box.isEmpty()) {
    state.target.set(0, 0, 0);
    state.distance = 1200;
  } else {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    state.target.copy(center);
    const fov = THREE.MathUtils.degToRad(state.camera.fov);
    const fitZ = size.z / (2 * Math.tan(fov / 2));
    const fitX = size.x / (2 * Math.tan(fov / 2) * Math.max(0.1, state.camera.aspect));
    state.distance = Math.max(220, Math.max(fitX, fitZ, size.y) * 1.2);
  }
  state.yaw = 0;
  state.pitch = Math.PI / 2 - 0.001;
}
