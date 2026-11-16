import * as THREE from "three";
import { setupMap3dTabs } from "./map3dSidebar";
import { Map3dCameraEditor, cameraViewport } from "./map3dCameraEditor";
import type { CameraPose } from "../pokeweb/fieldCameraModel";
import { Map3dTexturePreview } from "./map3dTexturePreview";
import {
  getMap3dZoneMetadata,
  getMap3dZones,
  loadMap3dZone,
  saveMap3dPermissionEdits,
  updateMap3dAreaMetadata,
  updateMap3dBuilding,
  addMap3dBuilding,
  deleteMap3dBuilding,
  updateMap3dZoneMetadata,
  readMap3dChunkBytes,
  restoreMap3dChunkBytes,
  type Map3dAreaMetadata,
  type Map3dEntityOverlay,
  type Map3dPermissionEdit,
  type Map3dPermissionTile,
  type Map3dSceneData,
  type Map3dSeason,
  type Map3dZoneMetadata,
  type Map3dMatrixCell,
  type Map3dTile,
} from "../pokeweb/map3dModel";
import { isGen4Project } from "../pokeweb/constants";
import { buildGen4Map3dScene, ensureGen4Map3dResources, saveGen4Map3dPermissionEdits } from "../pokeweb/gen4Map3dModel";
import { clampU16, formatHex16, GEN5_PERMISSION_FLAGS, gen5PermissionColorNumber } from "../pokeweb/gen5PermissionModel";
import { GEN5_TILE_CLASS_GROUPS, gen5TileClassName } from "../pokeweb/gen5TileClasses";
import { MapEditHistory, type MapEdit } from "./map3dHistory";
import { assignWeatherToArea, getAssignableWeatherEffects, getHeaderWeatherId, getWeatherEffects } from "../pokeweb/overworldWeatherModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { createMap3dBuildingInspector, pickMap3dBuilding } from "./map3dBuildingInspector";
import type { MapGlbImport } from "../pokeweb/mapGlbImport";
import { installMap3dTileTool } from "./map3dTileTool";
import type { GrassSkipReason, GrassStroke, MapGrassSurface } from "../pokeweb/mapGrass";
import type { TreeSkipReason, TreeStroke } from "../pokeweb/mapTrees";
import { mapTreeTypes, type MapTreeType } from "../pokeweb/mapTreeCatalog";
import type { MapGrassKind } from "../pokeweb/mapGrassGeometry";
import { createBrushThumbnailRenderer, grassSwatch } from "./mapBrushThumbnails";
import type { LedgeDirection, LedgeSkipReason, LedgeStroke } from "../pokeweb/mapLedges";
import { MAP_STAMP_CATEGORIES, mapStampTypes, stampSize, type MapStampCategory, type MapStampType, type StampRotation } from "../pokeweb/mapStampCatalog";
import type { StampSkipReason, StampStroke } from "../pokeweb/mapStamps";
import type { ThickGrassKind, ThickGrassSkipReason, ThickGrassStroke } from "../pokeweb/mapThickGrass";
import { mapFenceTypes, type FenceSkipReason, type FenceTileStroke, type MapFenceType } from "../pokeweb/mapFences";
import { mapPropTypes, type MapPropType, type PropSkipReason, type PropStroke } from "../pokeweb/mapProps";
import type { MapHeightEdit } from "../pokeweb/mapHeightEdit";
import { openTestBattleEmulator } from '../pokeweb/testBattleEmulatorLauncher';
import type { MapCameraTestPosition } from '../pokeweb/mapCameraTest';

const GRASS_SKIP_LABELS: Record<GrassSkipReason, string> = {
  "already-matching": "already the selected grass type",
  "existing-grass": "existing grass permissions",
  blocked: "tiles that block movement — turn on Paint on blocked scenery to paint there anyway",
  water: "water",
  "special-terrain": "special terrain",
  "split-height": "split walking height",
  "multiple-surfaces": "choose Upper or Lower for stacked surfaces",
  "no-stacked-surface": "no stacked surface",
  "crossing-surfaces": "walking surfaces cross within the tile",
  "missing-map": "missing map data",
  "outside-map": "outside the editable map",
  "no-painted-grass": "no brush-painted grass",
  "missing-original-permissions": "original permissions unavailable",
  "changed-grass": "painted grass layers changed",
};

const TREE_SKIP_LABELS: Record<TreeSkipReason, string> = {
  occupied: "overlapping another tree",
  blocked: "tiles that block movement — turn on Paint on blocked scenery to paint there anyway",
  water: "water",
  "existing-grass": "grass (remove it first)",
  "special-terrain": "special terrain",
  "split-height": "split walking height",
  "uneven-ground": "ground that isn't level",
  "multiple-surfaces": "two walking levels",
  "missing-map": "missing map data",
  "outside-map": "outside the editable map",
  "no-placed-tree": "no tree placed with the brush",
  "missing-original-permissions": "saved tiles unavailable",
  "changed-tree": "tree changed since it was placed",
};
const LEDGE_SKIP_LABELS: Record<LedgeSkipReason, string> = {
  ...TREE_SKIP_LABELS,
  occupied: "overlapping another ledge",
  "too-short": "a ledge needs at least 2 tiles",
  "no-placed-ledge": "no ledge drawn with the brush",
  "changed-ledge": "ledge changed since it was drawn",
};
const PROP_SKIP_LABELS: Record<PropSkipReason, string> = {
  ...TREE_SKIP_LABELS,
  occupied: "overlapping another model",
  "changed-prop": "model changed since it was placed",
  interior: "an indoor map (models come from outdoor bundles)",
};
const FENCE_SKIP_LABELS: Record<FenceSkipReason, string> = {
  ...TREE_SKIP_LABELS,
  occupied: "overlapping another fence",
  "too-short": "a fence needs at least 2 tiles",
  "changed-fence": "fence changed since it was drawn",
};
const THICK_SKIP_LABELS: Record<ThickGrassSkipReason, string> = {
  ...TREE_SKIP_LABELS,
  "existing-grass": "grass already there",
  "changed-grass": "thick grass changed since it was painted",
};
const STAMP_SKIP_LABELS: Record<StampSkipReason, string> = {
  ...TREE_SKIP_LABELS,
  occupied: "overlapping another object",
  "no-placed-stamp": "no object placed with the brush",
  "changed-stamp": "object changed since it was placed",
};
/** What a drag does with the Paint or Erase tool: paint grass, plant a tree, draw a ledge, place an object, or erase brush art. */
type BrushMode = "paint" | "tree" | "ledge" | "stamp" | "thick" | "fence" | "prop" | "erase";
/** A swatch in the paint palette. */
type PaintBrush = { id: string; category: MapStampCategory; label: string; mode: Exclude<BrushMode, "erase">; grass?: MapGrassKind; tree?: MapTreeType; stamp?: MapStampType; thick?: ThickGrassKind; fence?: MapFenceType; prop?: MapPropType; note: string };
const PAINT_BRUSH_KEY = "pokeweb.maps3d.paintBrush";
const PALETTE_COLLAPSED_KEY = "pokeweb.maps3d.paletteCollapsed";
const PAINT_BLOCKED_KEY = "pokeweb.maps3d.paintBlockedScenery";
const GAME_NOCLIP_KEY = "pokeweb.maps3d.gameTestWalkThroughWalls";
const ERASE_NATIVE_KEY = "pokeweb.maps3d.eraseNativeArt";
const FENCE_ENDS_KEY = "pokeweb.maps3d.fenceEnds";

const PERMISSION_TILE_SIZE = 16;
const MAP3D_VIEW_STORAGE_KEY = "pokeweb.maps3d.lastView";
const MAP3D_LAYER_STORAGE_KEY = "pokeweb.maps3d.layers";
const MOVEMENT_PREVIEW_TILE_SIZE = 16;
const MOVEMENT_PREVIEW_FPS = 30;
const MOVEMENT_PREVIEW_WALK_FRAMES = 8;
const MOVEMENT_PREVIEW_TURN_FRAMES = 24;
const DEFAULT_MAP3D_LAYER_SETTINGS: Map3dLayerSettings = {
  showBuildings: true,
  showBuildingBounds: false,
  showNpcs: true,
  showEntities: false,
  showPermissions: false,
  showMovementPreview: false,
};

type RendererState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tileCamera: THREE.OrthographicCamera;
  tileMode: boolean;
  tileTool?: ReturnType<typeof installMap3dTileTool>;
  onWarpTilePick?: (tile: Map3dTile | undefined) => void;
  /** Set while "+ Building" waits for a click: gets the terrain point under the pointer. */
  onPlacePick?: (point: THREE.Vector3 | undefined) => void;
  fieldCamera?: Map3dCameraEditor;
  cameraPose?: CameraPose;
  group: THREE.Group;
  terrainGroup: THREE.Group;
  neighboringSceneryGroup: THREE.Group;
  texturePreview: Map3dTexturePreview;
  onTextureFrame?: () => void;
  buildingGroup: THREE.Group;
  buildingBoundsGroup: THREE.Group;
  buildingSelectionGroup: THREE.Group;
  grid: THREE.GridHelper;
  selectedBuildingIndex?: number;
  isolateBuilding: boolean;
  hideOtherBuildings: boolean;
  onBuildingPick?: (index: number | undefined) => void;
  npcGroup: THREE.Group;
  overlayGroup: THREE.Group;
  permissionGroup: THREE.Group;
  permissionPicking: boolean;
  npcMovementActors: NpcMovementActor[];
  movementPreview: boolean;
  movementPreviewStartMs: number;
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
  onCameraUpdate?: () => void;
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

type NpcMovementActor = {
  group: THREE.Group;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseRotationY: number;
  initialDirection: NpcPreviewDirection;
  spriteMaterial?: THREE.MeshBasicMaterial;
  spriteTextures?: Partial<Record<NpcPreviewDirection, THREE.Texture[]>>;
  program?: NpcMovementProgram;
};

type NpcMovementProgram = {
  kind: "walk" | "spin";
  steps: NpcMovementStep[];
  totalFrames: number;
};

type NpcMovementStep =
  | { kind: "walk"; direction: NpcPreviewDirection; frames: number; dx: number; dz: number }
  | { kind: "turn"; direction: NpcPreviewDirection; frames: number };

type NpcPreviewDirection = "U" | "D" | "L" | "R";

type Map3dLayerSettings = {
  showBuildings: boolean;
  showBuildingBounds: boolean;
  showNpcs: boolean;
  showEntities: boolean;
  showPermissions: boolean;
  showMovementPreview: boolean;
};

/** Where the Map tab's Open buttons go. A button shows only when its link is given. */
/** Line icons for the tool group, drawn in the button's text colour. */
const toolIcon = (body: string) => `<svg class="mx-tool-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const GRASS_BLADES = '<path d="M2.5 14c.3-2.6 0-4.6-1-6.2M5.2 14c0-3.2.6-5.9 2.1-7.9M8 14c.2-1.7.9-3.1 2.4-4.1M1 14.5h10" />';
const TOOL_ICONS = {
  select: toolIcon('<path d="M3.5 2v10.8l2.9-2.7 2 3.9 1.9-.9-2-3.9 4-.2z" />'),
  brush: toolIcon('<path d="M13.7 2.3a1 1 0 0 0-1.4 0L7 7.6 8.4 9l5.3-5.3a1 1 0 0 0 0-1.4z" /><path d="M6.2 8.4c-1.8 0-2.6 1.1-2.8 2.4-.2 1.2-.7 1.9-1.6 2.2 2.6 1 5.6.4 6.2-1.9.3-1.1-.4-2-1.8-2.7z" />'),
  grassAdd: toolIcon(`${GRASS_BLADES}<path d="M12.5 1.8v5M10 4.3h5" />`),
  grassRemove: toolIcon(`${GRASS_BLADES}<path d="M10 4.3h5" />`),
  treeAdd: toolIcon('<path d="M6 14.5v-3.2" /><path d="M6 11.3c-2.6 0-4.5-1.6-4.5-3.8 0-1.5.9-2.6 2-3.1C3.8 2.8 4.8 1.8 6 1.8s2.2 1 2.5 2.6c1.1.5 2 1.6 2 3.1 0 2.2-1.9 3.8-4.5 3.8z" /><path d="M12.5 9.5v5M10 12h5" />'),
  treeRemove: toolIcon('<path d="M6 14.5v-3.2" /><path d="M6 11.3c-2.6 0-4.5-1.6-4.5-3.8 0-1.5.9-2.6 2-3.1C3.8 2.8 4.8 1.8 6 1.8s2.2 1 2.5 2.6c1.1.5 2 1.6 2 3.1 0 2.2-1.9 3.8-4.5 3.8z" /><path d="M10 12h5" />'),
  paint: toolIcon('<path d="M13.7 2.3a1 1 0 0 0-1.4 0L7 7.6 8.4 9l5.3-5.3a1 1 0 0 0 0-1.4z" /><path d="M6.2 8.4c-1.8 0-2.6 1.1-2.8 2.4-.2 1.2-.7 1.9-1.6 2.2 2.6 1 5.6.4 6.2-1.9.3-1.1-.4-2-1.8-2.7z" />'),
  erase: toolIcon('<path d="M9.3 2.6l4.1 4.1a1 1 0 0 1 0 1.4L8 13.5H4.6L2.6 11.5a1 1 0 0 1 0-1.4z" /><path d="M5.8 6.1l4.1 4.1M8 13.5h6" />'),
  collision: toolIcon('<rect x="2" y="2" width="12" height="12" rx="1" /><path d="M2 6.7h12M2 11.3h12M6.7 2v12M11.3 2v12" />'),
  ledgeAdd: toolIcon('<path d="M1.5 8.5h5.5l2 5h5.5" /><path d="M12.5 1.8v5M10 4.3h5" />'),
  fenceAdd: toolIcon('<path d="M2.5 14.5V6l1.5-1.5L5.5 6v8.5M7 14.5V6l1.5-1.5L10 6v8.5M1.5 8.5h10M1.5 12h10" /><path d="M13 1.8v4.5M10.8 4h4.4" />'),
  stampAdd: toolIcon('<path d="M5 14.5V5.5M3 5.5h4M5 3.2a1.2 1.2 0 1 0 0-.1" /><path d="M2.5 14.5h6" /><path d="M12.5 1.8v5M10 4.3h5" />'),
  ledgeRemove: toolIcon('<path d="M1.5 8.5h5.5l2 5h5.5" /><path d="M10 4.3h5" />'),
  camera: toolIcon('<rect x="1.5" y="4.5" width="13" height="9" rx="1.5" /><path d="M5.5 4.5l1-2h3l1 2" /><circle cx="8" cy="9" r="2.4" />'),
};

const SEASON_ICONS = {
  spring: toolIcon('<path d="M8 14.5V8.5" /><path d="M8 10.5c-3 0-4.8-1.8-4.8-4.6 2.9 0 4.8 1.8 4.8 4.6z" /><path d="M8 8.5c0-2.9 1.8-4.8 4.8-4.8 0 2.9-1.9 4.8-4.8 4.8z" />'),
  summer: toolIcon('<circle cx="8" cy="8" r="2.8" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />'),
  autumn: toolIcon('<path d="M13.5 2.5C6.5 2.5 2.5 5.8 2.5 10.2c0 1.8 1.2 3.3 3.3 3.3 4.6 0 7.7-4 7.7-11z" /><path d="M2 14.5l7.5-7.5" />'),
  winter: toolIcon('<path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5" /><path d="M6.3 2.6L8 4l1.7-1.4M6.3 13.4L8 12l1.7 1.4M2.6 6.9l2.1-.4-.8-2M13.4 9.1l-2.1.4.8 2M3.9 11.5l.8-2-2.1-.4M12.1 4.5l-.8 2 2.1.4" />'),
};

export type Map3dEditorLinks = {
  /** headerId is the header's index, as the overworld route takes it. */
  openOverworld?: (overworldsId: number, headerId: number) => void;
  openScript?: (scriptId: number) => void;
  openText?: (textBankId: number) => void;
  openEncounters?: (encounterId: number) => void;
};

export function renderMap3dEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, initialTarget?: { zoneId?: number; mapId?: number; matrixCell?: Map3dMatrixCell }, links?: Map3dEditorLinks): void {
  let zones = getMap3dZones(project);
  const rememberedView = readRememberedMap3dView(project, zones.map((zone) => zone.zoneId));
  const layerSettings = readMap3dLayerSettings(project);
  const requestedZone = zones.find(zone => zone.zoneId === initialTarget?.zoneId);
  const initialZone = requestedZone?.zoneId ?? rememberedView?.zoneId ?? zones[0]?.zoneId ?? 0;
  let activeZone = initialZone;
  let activeMatrixCell = isGen4Project(project) ? undefined : initialTarget?.matrixCell;
  let activeSeason: Map3dSeason = requestedZone || activeMatrixCell ? "spring" : rememberedView?.season ?? "spring";
  let includeNeighbors = false;
  let state: RendererState | undefined;
  let loadToken = 0;
  let activeData: Map3dSceneData | undefined;
  let exporting = false;
  let importing = false;
  let pendingImport: MapGlbImport | undefined;
  let testingMap = false;
  let preparingWarp = false;
  let warpDestination: ((tile: Map3dTile) => MapCameraTestPosition) | undefined;
  let grassMode: BrushMode | undefined;
  let grassBusy = false;
  const lockedControls = new Map<HTMLInputElement | HTMLSelectElement | HTMLButtonElement, boolean>();

  const gen4 = isGen4Project(project);
  const treeTypes = gen4 ? [] : mapTreeTypes(project.session.baseRom);
  const paintBrushes: PaintBrush[] = treeTypes.length ? [
    { id: "grass", category: "Vegetation", label: "Grass", mode: "paint", grass: "regular", note: "Tall grass with wild encounters. Drag over tiles." },
    { id: "dark-grass", category: "Vegetation", label: "Dark grass", mode: "paint", grass: "dark", note: "Dark grass: wild double battles. Drag over tiles." },
    ...(project.session.baseRom === "BW2" ? [
      { id: "thick-green", category: "Vegetation", label: "Thick grass", mode: "thick", thick: "green", note: "Tall, thick grass with wild encounters (class 8). Drag over tiles; the edges follow the painted outline." },
      { id: "thick-teal", category: "Vegetation", label: "Teal thick grass", mode: "thick", thick: "teal", note: "Tall, thick grass with wild encounters (class 9). Drag over tiles; the edges follow the painted outline." },
    ] satisfies PaintBrush[] : []),
    ...treeTypes.map((tree): PaintBrush => ({ id: `tree-${tree.id}`, category: "Vegetation", label: tree.label, mode: "tree", tree, note: `${tree.size}×${tree.size} tiles, blocks movement. Click or drag to plant.` })),
    ...mapFenceTypes(project.session.baseRom).map((fence): PaintBrush => ({ id: `fence-${fence.id}`, category: "Fencing", label: fence.label, mode: "fence", fence,
      note: `Blocks movement. Drag any path: turns become corners, and it joins fences of the same kind next to it.${fence.turnedEnds ? " Drag over a fence to change its ends." : ""}` })),
    ...mapPropTypes(project.session.baseRom).map((prop): PaintBrush => {
      const [width, depth] = stampSize(prop);
      return { id: `prop-${prop.id}`, category: prop.category, label: prop.label, mode: "prop", prop,
        note: `Building model, ${width}×${depth} ${width * depth === 1 ? "tile" : "tiles"}, blocks movement. Click to place${prop.rotatable ? "; turn it with T" : ""}.` };
    }),
    { id: "ledge", category: "Misc", label: "Ledge", mode: "ledge", note: "One-way hop. Hold and drag along a column (left/right) or a row (up/down)." },
    ...mapStampTypes(project.session.baseRom).map((stamp): PaintBrush => {
      const [width, depth] = stampSize(stamp);
      const blocks = stamp.blocked.join("").includes("#");
      return { id: `stamp-${stamp.id}`, category: stamp.category, label: stamp.label, mode: "stamp", stamp,
        note: `${width}×${depth} ${width * depth === 1 ? "tile" : "tiles"}${blocks ? ", blocks movement" : ""}. Click to place${stamp.rotatable ? "; turn it with T" : ""}.` };
    }),
  ] : [];
  let paintBrush = paintBrushes.find(brush => brush.id === readStoredText(PAINT_BRUSH_KEY)) ?? paintBrushes[0];
  /** Palette categories the user folded away, remembered between sessions. */
  const collapsedGroups = new Set((readStoredText(PALETTE_COLLAPSED_KEY) ?? "").split(",").filter(Boolean));
  let ledgeDirectionValue: LedgeDirection = "left";
  let stampRotation: StampRotation = 0;
  const railButton = (tool: string, label: string, key: string, title: string, icon: string, disabled = false) =>
    `<button class="mx-rail-tool" type="button" data-map-tool="${tool}" aria-pressed="${tool === "select"}" aria-label="${label} (${key})" title="${label} (${key}) — ${title}"${disabled ? " disabled" : ""}>${icon}<span>${label}</span></button>`;
  const paletteMarkup = () => {
    const groups = MAP_STAMP_CATEGORIES.map(category => {
      const brushes = paintBrushes.filter(brush => brush.category === category);
      const open = !collapsedGroups.has(category), id = `map3d-brushes-${category.toLowerCase()}`;
      return brushes.length ? `<section class="mx-brush-group" aria-label="${category}"><h3><button class="mx-group-toggle" type="button" data-brush-group="${category}" aria-expanded="${open}" aria-controls="${id}"><svg class="mx-group-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>${category}<span class="mx-group-count">${brushes.length}</span></button></h3><div class="mx-brushes" id="${id}"${open ? "" : " hidden"}>${brushes.map(brush =>
        `<button class="mx-brush" type="button" data-brush="${brush.id}" aria-pressed="false" title="${escapeHtml(brush.label)}"><span class="mx-brush-art">${brush.mode === "tree" ? TOOL_ICONS.treeAdd : brush.mode === "ledge" ? TOOL_ICONS.ledgeAdd : brush.mode === "stamp" || brush.mode === "prop" ? TOOL_ICONS.stampAdd : brush.mode === "fence" ? TOOL_ICONS.fenceAdd : TOOL_ICONS.grassAdd}</span><span class="mx-brush-label">${escapeHtml(brush.label)}</span></button>`).join("")}</div></section>` : "";
    }).join("");
    const arrows: [LedgeDirection, string, string][] = [["up", "↑", "Hop up"], ["left", "←", "Hop left"], ["right", "→", "Hop right"], ["down", "↓", "Hop down"]];
    return `<aside class="mx-palette" id="map3d-palette" aria-label="Paint palette">
      <header class="mx-palette-head"><span>Paint</span><span class="mx-palette-season" id="map3d-palette-season"></span></header>
      <div class="mx-palette-body">
        ${groups}
      </div>
      <section class="mx-brush-options" aria-label="Brush options">
          <h3 id="map3d-brush-name"></h3>
          <p class="mx-note" id="map3d-brush-note"></p>
          <label class="mx-row" data-brush-option="surface"><span class="mx-label">Surface</span><select id="map3d-grass-surface" class="mx-select -compact" aria-label="Grass surface"><option value="auto">Auto</option><option value="upper">Upper (bridge)</option><option value="lower">Lower</option></select></label>
          <label class="mx-menu-check" data-brush-option="blocked" title="Also paint on tiles the player can't walk on, such as raised or fenced-off scenery. Their collision is left as it is."><input type="checkbox" id="map3d-paint-blocked" ${readStoredText(PAINT_BLOCKED_KEY) === "on" ? "checked" : ""} /> Paint on blocked scenery</label>
          <label class="mx-row" data-brush-option="ends" title="How a fence looks where it stops. Drag over a fence you drew to give it the other ends."><span class="mx-label">Ends</span><select id="map3d-fence-ends" class="mx-select -compact" aria-label="Fence ends"><option value="corner">Corner start</option><option value="straight"${readStoredText(FENCE_ENDS_KEY) === "straight" ? " selected" : ""}>Straight</option></select></label>
          <label class="mx-menu-check" data-brush-option="native"><input type="checkbox" id="map3d-erase-native" ${readStoredText(ERASE_NATIVE_KEY) === "on" ? "checked" : ""} /> Also erase native elements</label>
          <div class="mx-row" data-brush-option="direction"><span class="mx-label">Hop</span><div class="mx-arrows" role="group" aria-label="Hop direction">${arrows.map(([value, glyph, label]) => `<button class="mx-tool -small" type="button" data-ledge-direction="${value}" aria-pressed="${value === "left"}" aria-label="${label}" title="${label}">${glyph}</button>`).join("")}</div></div>
          <div class="mx-row" data-brush-option="rotate"><span class="mx-label">Turn</span><div class="mx-turn" role="group" aria-label="Turn the object"><button class="mx-tool -small" type="button" data-stamp-turn="-1" aria-label="Turn left" title="Turn left (Shift+T)">⟲</button><output id="map3d-stamp-turn" aria-live="polite">0°</output><button class="mx-tool -small" type="button" data-stamp-turn="1" aria-label="Turn right" title="Turn right (T)">⟳</button></div></div>
      </section>
    </aside>`;
  };
  const flagChip = (flag: (typeof GEN5_PERMISSION_FLAGS)[number]) =>
    `<label class="mx-flag"><input type="checkbox" data-flag="${flag.bit}" /><span>${escapeHtml(flag.label.replace(/^Unknown /u, "0x"))}</span></label>`;
  const layerChip = (id: string, label: string, dot: string, checked: boolean, title: string) =>
    `<label class="mx-chip" title="${escapeHtml(title)}"><input id="${id}" type="checkbox" ${checkedAttr(checked)} /><span class="mx-chip-dot -${dot}"></span>${escapeHtml(label)}</label>`;
  const row = (label: string, control: string, extra = "") => `<label class="mx-row${extra}"><span class="mx-label">${label}</span>${control}</label>`;
  const numberField = (id: string, min: number, max: number, readonly = false) =>
    `<input class="mx-input" id="${id}" type="number" min="${min}" max="${max}" step="1" ${readonly ? "readonly tabindex=\"-1\"" : ""} />`;
  const linkedField = (id: string, label: string, max: number, open: string) =>
    `<div class="mx-row -link"><label class="mx-label" for="${id}">${label}</label>${numberField(id, 0, max)}<button class="btn sm -ghost" type="button" data-map-open="${open}" hidden>Open</button></div>`;

  root.innerHTML = `
    <div id="map-editor" class="mx-shell${gen4 ? " -gen4" : ""}">
      <aside class="mx-side" aria-label="Map">
        <header class="mx-head">
          <div class="mx-pick-row">
            <button class="btn sm -ghost" type="button" data-zone-step="-1" aria-label="Previous map" title="Previous map">&lsaquo;</button>
            <select class="mx-select" id="map3d-zone" aria-label="Map">
              ${matrixCellOption()}
              ${zones.map((zone) => `<option value="${zone.zoneId}" ${!activeMatrixCell && zone.zoneId === activeZone ? "selected" : ""}>${escapeHtml(zone.label)}</option>`).join("")}
            </select>
            <button class="btn sm -ghost" type="button" data-zone-step="1" aria-label="Next map" title="Next map">&rsaquo;</button>
          </div>
          <input class="mx-input mx-search" id="map3d-search" type="search" placeholder="Filter maps by name or zone" aria-label="Filter maps" />
          <h1 id="map3d-title">Loading map…</h1>
          <div class="mx-sub" id="map3d-subtitle"></div>
          <div class="mx-sub" id="map3d-opened-map" hidden></div>
        </header>
        <section id="map3d-import-review" class="mx-block mx-review" aria-label="Review map import" hidden></section>
        <div class="md-tabs mx-tabs" role="tablist" aria-label="Edit">
          <button class="uv-tab" type="button" role="tab" id="map3d-tab-map" data-map-tab="map" aria-controls="map3d-panel-map">Map</button>
          <button class="uv-tab" type="button" role="tab" id="map3d-tab-collisions" data-map-tab="collisions" aria-controls="map3d-panel-collisions">Collisions</button>
          <button class="uv-tab" type="button" role="tab" id="map3d-tab-buildings" data-map-tab="buildings" aria-controls="map3d-panel-buildings">Buildings</button>
          ${gen4 ? "" : `<button class="uv-tab" type="button" role="tab" id="map3d-tab-camera" data-map-tab="camera" aria-controls="map3d-panel-camera">Camera</button>`}
        </div>
        <div class="mx-panels">
          <section class="mx-panel map3d-metadata-editor" id="map3d-panel-map" role="tabpanel" aria-labelledby="map3d-tab-map">
            <p class="mx-note mx-unassigned-note">This matrix cell has no header of its own. Assign it to a zone in the matrix editor to edit its settings.</p>
            <div class="mx-block">
              <div class="mx-group-title">Location</div>
              ${row("Name", `<select class="mx-select" id="map3d-meta-location"></select>`)}
              ${gen4 ? "" : row("Weather", `<select class="mx-select" id="map3d-meta-weather-effect"></select>`)}
            </div>
            <div class="mx-block">
              <div class="mx-group-title">Linked data</div>
              ${linkedField("map3d-meta-overworlds", "Overworld", 65535, "overworld")}
              ${linkedField("map3d-meta-script", "Scripts", 65535, "script")}
              ${linkedField("map3d-meta-level-script", "Level script", 65535, "level-script")}
              ${linkedField("map3d-meta-text", "Text bank", 65535, "text")}
              ${linkedField("map3d-meta-encounter", "Encounters", 65535, "encounters")}
            </div>
            <details class="mx-block mx-advanced">
              <summary>Advanced</summary>
              <div class="mx-grid">
                ${row("Matrix", numberField("map3d-meta-matrix", 0, 65535))}
                ${row("Source area", numberField("map3d-meta-area-source", 0, 65535))}
                ${row("Map type", numberField("map3d-meta-map-type", 0, 255))}
                ${row("Parent map", numberField("map3d-meta-parent", 0, 65535))}
                ${row("Weather byte", numberField("map3d-meta-weather", 0, 255))}
                ${row("Camera", numberField("map3d-meta-camera", 0, 255))}
                ${row("Header flags", numberField("map3d-meta-flags", 0, 255))}
              </div>
              <div class="mx-group-title -spaced">Area resources</div>
              <div class="mx-grid">
                ${row("Area row", numberField("map3d-meta-area-loaded", 0, 65535, true))}
                ${row("Texture pack", numberField("map3d-meta-texture-pack", 0, 65535))}
                ${row("Building bundle", numberField("map3d-meta-buildings", 0, 65535))}
                ${row("SRT anim", numberField("map3d-meta-srt", 0, 255))}
                ${row("PAT anim", numberField("map3d-meta-pat", 0, 255))}
                <label class="mx-row -check"><span class="mx-label">Exterior</span><input id="map3d-meta-exterior" type="checkbox" /></label>
              </div>
              <p class="mx-note">Headers choose the zone's matrix, scripts, text and encounters; the area row chooses its textures and buildings.</p>
            </details>
          </section>
          <section class="mx-panel map3d-permission-editor" id="map3d-panel-collisions" role="tabpanel" aria-labelledby="map3d-tab-collisions" hidden>
            <div class="mx-block">
              <div class="mx-tile-card" id="map3d-permission-selected">Click a tile on the map to see and edit it.</div>
            </div>
            <div class="mx-block">
              <div class="mx-group-title">Tile values</div>
              <div class="mx-row"><label class="mx-label" for="map3d-permission-class-select">Class</label>
                <div class="mx-class-pick">
                  <select class="mx-select" id="map3d-permission-class-select" aria-label="Tile class by name">
                    ${GEN5_TILE_CLASS_GROUPS.map((group) => `<optgroup label="${escapeHtml(group.label)}">${group.classes.map(([value, name]) => `<option value="${value}">${value} · ${escapeHtml(name)}</option>`).join("")}</optgroup>`).join("")}
                    <option value="other" hidden>Other</option>
                  </select>
                  <input class="mx-input -number" id="map3d-permission-class" type="number" min="0" max="65535" step="1" value="0" aria-label="Tile class number" />
                </div>
              </div>
              <div class="mx-row -top"><span class="mx-label">Flags</span>
                <div class="mx-flags map3d-flag-grid">${GEN5_PERMISSION_FLAGS.filter((flag) => flag.bit <= 0x80).map(flagChip).join("")}</div>
              </div>
              <details class="mx-advanced -inline">
                <summary>More flags <span class="mx-hex" id="map3d-permission-flag-value">0x0000</span></summary>
                <div class="mx-flags">${GEN5_PERMISSION_FLAGS.filter((flag) => flag.bit > 0x80).map(flagChip).join("")}</div>
              </details>
              <div class="mx-actions">
                <button class="btn sm -primary" id="map3d-permission-apply" type="button">Apply to selected tile</button>
              </div>
              <p class="mx-note">Pick the <strong>Collision brush</strong> tool above the map to paint these values by dragging.</p>
            </div>
            ${gen4 ? "" : `<div class="mx-block">
              <div class="mx-group-title">Walking heights</div>
              <p class="mx-note">Rebuild a chunk's walking heights from its terrain model.</p>
              <div class="mx-actions"><button class="btn sm" id="map3d-height-generate" type="button" disabled>Generate walking heights…</button></div>
            </div>`}
          </section>
          <section class="mx-panel" id="map3d-panel-buildings" role="tabpanel" aria-labelledby="map3d-tab-buildings" hidden>
            <div class="mx-buildings map3d-building-inspector" id="map3d-building-inspector" aria-label="Buildings"></div>
          </section>
          ${gen4 ? "" : `<section class="mx-panel" id="map3d-panel-camera" role="tabpanel" aria-labelledby="map3d-tab-camera" hidden>
            <div class="mx-camera map3d-building-inspector" id="map3d-camera-inspector" aria-label="Map camera"></div>
          </section>`}
        </div>
      </aside>
      <section class="mx-main map3d-view">
        <div class="mx-toolbar">
          <div class="mx-group" role="group" aria-label="Layers">
            ${layerChip("map3d-show-buildings", "Buildings", "building", layerSettings.showBuildings, "Show buildings")}
            ${layerChip("map3d-show-npcs", "NPCs", "npc", layerSettings.showNpcs, "Show NPC models")}
            ${layerChip("map3d-show-entities", "Events", "entity", layerSettings.showEntities, "Show warps, triggers and other event markers")}
            ${layerChip("map3d-show-permissions", "Collisions", "permissions", layerSettings.showPermissions, "Show the collision overlay")}
            ${layerChip("map3d-show-building-bounds", "Bounds", "bounds", layerSettings.showBuildingBounds, "Show building bounding boxes")}
            ${layerChip("map3d-preview-movement", "Movement", "movement", layerSettings.showMovementPreview, "Animate NPC movement")}
            ${gen4 ? "" : layerChip("map3d-show-neighbors", "Neighbors", "neighbors", false, "Show surrounding terrain for reference; it isn't edited or exported")}
          </div>
          <span class="mx-spacer"></span>
          <div class="mx-group" role="group" aria-label="History">
            <button class="btn sm -ghost" id="map3d-undo" type="button" aria-label="Undo" title="Undo (⌘Z)" disabled>↶ Undo</button>
            <button class="btn sm -ghost" id="map3d-redo" type="button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled>↷ Redo</button>
          </div>
          <div class="mx-group" role="group" aria-label="View">
            <button class="btn sm -ghost" id="map3d-reset" type="button" title="Frame the whole map">Reset view</button>
            <button class="btn sm -ghost" id="map3d-topdown" type="button" title="Look straight down">Top down</button>
          </div>
          <div class="mx-group mx-seasons" role="group" aria-label="Season">
            ${(["spring", "summer", "autumn", "winter"] as const).map(season => `<button class="mx-season" type="button" data-map3d-season="${season}" aria-pressed="${activeSeason === season}">${SEASON_ICONS[season]}${season[0].toUpperCase() + season.slice(1)}</button>`).join("")}
          </div>
          ${gen4 ? "" : `<span class="mx-split">
            <button class="btn sm -primary" id="map3d-game-test" type="button" aria-pressed="false" disabled title="Pick a tile, then play from there in the emulator">Open Game &amp; Warp Here</button>
            <details class="mx-menu mx-split-menu" id="map3d-game-options">
              <summary class="btn sm -primary" aria-label="Game test options" title="Game test options">▾</summary>
              <div class="mx-menu-list">
                <label class="mx-menu-check"><input type="checkbox" id="map3d-game-noclip" ${readStoredText(GAME_NOCLIP_KEY) === "off" ? "" : "checked"} /> Walk through walls</label>
                <p class="mx-note">Off keeps the game's normal collisions, so you test the map as players walk it. Pick a walkable tile.</p>
              </div>
            </details>
          </span>`}
          <details class="mx-menu" id="map3d-files">
            <summary class="btn sm -ghost">Files</summary>
            <div class="mx-menu-list" role="menu">
              <button class="mx-menu-item" id="map3d-export" type="button" role="menuitem" disabled title="Export the loaded map and season, including terrain, buildings, and textures">Export for Blender (.glb)</button>
              ${project.session.baseRom === "BW2" ? '<button class="mx-menu-item" id="map3d-import" type="button" role="menuitem" disabled>Import edited map (.glb)</button><input id="map3d-import-file" type="file" accept=".glb" hidden />' : ""}
              ${gen4 ? "" : '<button class="mx-menu-item" id="map3d-native-folder" type="button" role="menuitem" disabled>Open DS Map Studio folder…</button><button class="mx-menu-item" id="map3d-native-import" type="button" role="menuitem" disabled>Import DS Map Studio map…</button>'}
            </div>
          </details>
        </div>
        <div class="mx-workspace${paintBrushes.length ? "" : " -no-palette"}">
          <nav class="mx-rail" role="toolbar" aria-orientation="vertical" aria-label="Tools">
            ${railButton("select", "Select", "V", "Orbit the camera; click a building or tile to edit it", TOOL_ICONS.select)}
            ${paintBrushes.length ? `${railButton("paint", "Paint", "B", "Paint the brush chosen in the palette", TOOL_ICONS.paint, true)}
            ${railButton("erase", "Erase", "E", "Drag to erase grass, trees and ledges painted with the brushes", TOOL_ICONS.erase, true)}` : ""}
            <span class="mx-rail-gap"></span>
            ${railButton("collision", "Collision brush", "C", "Drag over tiles to paint the collision values from the Collisions tab", TOOL_ICONS.collision)}
            ${gen4 ? "" : railButton("camera", "Camera regions", "R", "Edit the map camera's regions", TOOL_ICONS.camera)}
          </nav>
        <div class="mx-stage">
          <div class="map3d-canvas-wrap" id="map3d-canvas-wrap"></div>
          <div class="mx-hud" data-map3d-hud></div>
          <div class="mx-tool-hints" id="map3d-tool-options">
            <span class="mx-hint" id="map3d-drag-label">Drag: rotate · Shift-drag: pan · Click a building or tile to edit it</span>
            <span class="mx-hint" id="map3d-collision-brush" hidden></span>
            ${gen4 ? "" : `<span class="mx-group" id="map3d-camera-modes" role="group" aria-label="Camera tool" hidden>
              <button class="mx-tool -small" type="button" data-camera-mode="move" aria-pressed="false" title="Drag a region to move it; drag a gold corner to resize">Move / resize</button>
              <button class="mx-tool -small" type="button" data-camera-mode="draw" aria-pressed="false" title="Drag over the map to draw a new region">Draw region</button>
              <button class="mx-tool -small" type="button" data-camera-mode="walk" aria-pressed="false" title="Click a tile, then walk with the arrow keys to preview the camera">Walk</button>
              <button class="mx-tool -small" type="button" data-camera-mode="pick" aria-pressed="false" title="Click the terrain to choose the preview position">Pick point</button>
            </span>`}
          </div>
          <div class="mx-corner">
            ${gen4 ? "" : `<details class="mx-pop">
              <summary class="btn sm -ghost" title="Texture animation preview">Textures</summary>
              <div class="mx-pop-body">
                <label class="mx-row -check"><span class="mx-label">Animate</span><input id="map3d-animate-textures" type="checkbox" checked /></label>
                <div class="mx-actions"><button class="btn sm" id="map3d-textures-play" type="button" disabled>Pause</button><button class="btn sm" id="map3d-textures-reset" type="button" disabled>Restart</button></div>
                <input id="map3d-textures-frame" type="range" min="0" max="0" value="0" disabled aria-label="Texture frame" />
                <p class="mx-note" id="map3d-textures-status">Load a map to preview its texture animations.</p>
              </div>
            </details>`}
            <details class="mx-pop">
              <summary class="btn sm -ghost" title="Camera position">Camera info</summary>
              <div class="mx-pop-body">
                <output id="map3d-camera-values" class="mx-mono" aria-live="off"></output>
                <button class="btn sm" id="map3d-copy-camera" type="button">Copy coordinates</button>
              </div>
            </details>
            <details class="mx-pop">
              <summary class="btn sm -ghost" aria-label="Controls" title="Controls">?</summary>
              <div class="mx-pop-body mx-controls">
                <div><kbd>Drag</kbd> rotate (pan with the brush tools)</div>
                <div id="map3d-shift-pan-hint"><kbd>Shift</kbd> + drag pan</div>
                <div><kbd>Arrows</kbd> pan</div>
                <div><kbd>Wheel</kbd> or pinch zoom</div>
                <div data-map3d-inspect-hint><kbd>Click</kbd> a building or collision tile to edit it</div>
                <div><kbd>Esc</kbd> back to Select</div>
                <div><kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> undo / redo</div>
              </div>
            </details>
          </div>
        </div>
          ${paintBrushes.length ? paletteMarkup() : ""}
        </div>
        <footer class="mx-status">
          <span class="mx-stats" id="map3d-stats"></span>
          <span class="mx-message map3d-export-status" id="map3d-export-status" role="status" aria-live="polite"></span>
          <div class="mx-warnings" id="map3d-warnings"></div>
        </footer>
      </section>
    </div>
  `;

  const select = root.querySelector<HTMLSelectElement>("#map3d-zone");
  const exportButton = root.querySelector<HTMLButtonElement>("#map3d-export");
  const exportStatus = root.querySelector<HTMLDivElement>("#map3d-export-status");
  const grassSurface = root.querySelector<HTMLSelectElement>("#map3d-grass-surface");
  const swatches = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-brush]"));
  const ledgeArrows = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-ledge-direction]"));
  const eraseNative = root.querySelector<HTMLInputElement>("#map3d-erase-native");
  const paintBlocked = root.querySelector<HTMLInputElement>("#map3d-paint-blocked");
  paintBlocked?.addEventListener("change", () => writeStoredText(PAINT_BLOCKED_KEY, paintBlocked.checked ? "on" : "off"));
  const allowBlocked = () => Boolean(paintBlocked?.checked);
  const fenceEnds = root.querySelector<HTMLSelectElement>("#map3d-fence-ends");
  fenceEnds?.addEventListener("change", () => writeStoredText(FENCE_ENDS_KEY, fenceEnds.value));
  const fenceEndStyle = () => (fenceEnds?.value === "straight" ? "straight" : "corner") as "corner" | "straight";
  eraseNative?.addEventListener("change", () => { writeStoredText(ERASE_NATIVE_KEY, eraseNative.checked ? "on" : "off"); updateTileToolHints(); });
  const cameraValues=root.querySelector<HTMLOutputElement>('#map3d-camera-values')!;
  const dragLabel = root.querySelector<HTMLElement>("#map3d-drag-label");
  const shiftPanHint = root.querySelector<HTMLElement>("#map3d-shift-pan-hint");
  const inspectHints = root.querySelectorAll<HTMLElement>("[data-map3d-inspect-hint]");
  function cameraCoordinates() {
    if (!state) return;
    const overhead = state.tileMode;
    const camera = overhead ? state.tileCamera : state.camera;
    const pose = overhead ? undefined : state.cameraPose;
    const target = pose ? new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z) : state.target;
    const delta = camera.position.clone().sub(target);
    const round = (value: number) => Math.round(value * 10000) / 10000;
    return {
      zoneId: state.currentData?.zoneId,
      mode: overhead ? "overhead" : pose ? "game camera" : "free view",
      position: camera.position.toArray().map(round),
      target: target.toArray().map(round),
      pitch: round(THREE.MathUtils.radToDeg(Math.atan2(delta.y, Math.hypot(delta.x, delta.z)))),
      yaw: round(THREE.MathUtils.radToDeg(Math.atan2(delta.x, delta.z)) + 360) % 360,
      distance: round(overhead ? state.distance : delta.length()),
      fov: overhead ? undefined : state.camera.fov,
      aspect: round(state.camera.aspect),
    };
  }
  function updateCameraReadout() {
    const view = cameraCoordinates();
    if (!view) return;
    const lens = view.fov === undefined ? "Orthographic" : `FOV ${view.fov}°`;
    const text = [
      `Position X/Y/Z: ${view.position.join(", ")}`,
      `Look at X/Y/Z: ${view.target.join(", ")}`,
      `Pitch ${view.pitch}° · Yaw ${view.yaw}° · Distance ${view.distance}`,
      `${lens} · Aspect ${view.aspect}`,
    ].join("\n");
    if (cameraValues.textContent !== text) cameraValues.textContent = text;
  }
  root.querySelector<HTMLButtonElement>('#map3d-copy-camera')!.addEventListener('click',()=>{const p=cameraCoordinates();if(!p)return;const text=JSON.stringify(p,null,2),field=document.createElement('textarea');field.value=text;field.style.cssText='position:fixed;left:-10000px;top:0';root.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(copied)setStatus('Camera coordinates copied.');else void navigator.clipboard.writeText(text).then(()=>setStatus('Camera coordinates copied.')).catch(()=>setStatus('Unable to copy. The live camera coordinates remain visible above.'));});
  const importButton = root.querySelector<HTMLButtonElement>("#map3d-import");
  const nativeImportButton = root.querySelector<HTMLButtonElement>("#map3d-native-import");
  const nativeFolderButton = root.querySelector<HTMLButtonElement>("#map3d-native-folder");
  const heightGenerate = root.querySelector<HTMLButtonElement>("#map3d-height-generate");
  const mapGameTest = root.querySelector<HTMLButtonElement>("#map3d-game-test");
  const gameNoclip = root.querySelector<HTMLInputElement>("#map3d-game-noclip");
  gameNoclip?.addEventListener("change", () => writeStoredText(GAME_NOCLIP_KEY, gameNoclip.checked ? "on" : "off"));
  const importFile = root.querySelector<HTMLInputElement>("#map3d-import-file");
  const importReview = root.querySelector<HTMLElement>("#map3d-import-review")!;
  const seasonButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-map3d-season]"));
  const animateTextures = root.querySelector<HTMLInputElement>("#map3d-animate-textures");
  const texturesPlay = root.querySelector<HTMLButtonElement>("#map3d-textures-play");
  const texturesReset = root.querySelector<HTMLButtonElement>("#map3d-textures-reset");
  const texturesFrame = root.querySelector<HTMLInputElement>("#map3d-textures-frame");
  const texturesStatus = root.querySelector<HTMLElement>("#map3d-textures-status");
  const refreshTextureControls = () => {
    const preview = state?.texturePreview, count = preview?.count ?? 0, enabled = Boolean(preview?.enabled && count);
    if (texturesPlay) { texturesPlay.disabled = !enabled; texturesPlay.textContent = preview?.playing ? "Pause" : "Play"; }
    if (texturesReset) texturesReset.disabled = !enabled;
    if (texturesFrame) {
      texturesFrame.disabled = !enabled;
      texturesFrame.max = String((preview?.frameCount ?? 1) - 1);
      texturesFrame.value = String(Math.floor(preview?.frame ?? 0) % (preview?.frameCount ?? 1));
    }
    const text = count ? `${count} animated surfaces · Frame ${texturesFrame?.value ?? 0} · 30 fps` : "No supported texture animations in this view.";
    if (texturesStatus && texturesStatus.textContent !== text) texturesStatus.textContent = text;
  };
  const metadataPanel = root.querySelector<HTMLElement>("#map3d-panel-map")!;
  const weatherEffect = root.querySelector<HTMLSelectElement>("#map3d-meta-weather-effect");
  const metadataFields = {
    location: root.querySelector<HTMLSelectElement>("#map3d-meta-location"),
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
  const showMovementPreview = root.querySelector<HTMLInputElement>("#map3d-preview-movement");
  const permissionClass = root.querySelector<HTMLInputElement>("#map3d-permission-class");
  const permissionClassSelect = root.querySelector<HTMLSelectElement>("#map3d-permission-class-select");
  const permissionFlagInputs = Array.from(root.querySelectorAll<HTMLInputElement>(".map3d-permission-editor [data-flag]"));
  const permissionFlagValue = root.querySelector<HTMLElement>("#map3d-permission-flag-value");
  const permissionApply = root.querySelector<HTMLButtonElement>("#map3d-permission-apply");
  const permissionSelected = root.querySelector<HTMLDivElement>("#map3d-permission-selected");
  const collisionBrushHint = root.querySelector<HTMLElement>("#map3d-collision-brush");
  const cameraModes = root.querySelector<HTMLElement>("#map3d-camera-modes");
  const toolButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-map-tool]"));
  const undoButton = root.querySelector<HTMLButtonElement>("#map3d-undo");
  const redoButton = root.querySelector<HTMLButtonElement>("#map3d-redo");
  const titleHost = root.querySelector<HTMLElement>("#map3d-title");
  const subtitleHost = root.querySelector<HTMLElement>("#map3d-subtitle");
  const statsHost = root.querySelector<HTMLElement>("#map3d-stats");
  const search = root.querySelector<HTMLInputElement>("#map3d-search");
  const canvasWrap = root.querySelector<HTMLDivElement>("#map3d-canvas-wrap");
  const warningsHost = root.querySelector<HTMLDivElement>("#map3d-warnings");
  if (!select || !canvasWrap) return;
  const zoneSelect = select;
  /** One history for every edit in the editor; each edit is saved as it happens. */
  const history = new MapEditHistory(refreshHistoryButtons);
  /** The mouse tool: Select (orbit and pick), a brush (collisions, grass) or camera regions. */
  type MapTool = "select" | "paint" | "erase" | "collision" | "camera";
  let collisionBrush = false;
  let cameraTool = false;
  let historyScope = "";
  const sidebarTabs = setupMap3dTabs(root, tab => {
    if (tab === "camera") {
      if (grassMode) setGrassMode();
      if (collisionBrush) setCollisionBrush(false);
      if (warpDestination) setWarpPicking();
    } else if (cameraTool) setCameraTool(false);
    state?.fieldCamera?.setActive(tab === "camera");
    if (state) state.permissionPicking = tab !== "buildings" && tab !== "camera";
    if (tab === "collisions" && showPermissions && !showPermissions.checked) { showPermissions.checked = true; applyCurrentLayerSettings(); }
  });
  const buildingInspector = createMap3dBuildingInspector(root.querySelector<HTMLElement>("#map3d-building-inspector")!, {
    select: selectBuilding,
    focus: () => { if (state) focusSelectedBuilding(state); },
    editable: !isGen4Project(project),
    add: (input) => {
      if (pendingImport || importing) throw new Error("Apply or cancel the map import before editing placements.");
      if (!state || !activeData) throw new Error("Load a map before adding a building.");
      const data = activeData, chunk = data.chunks[input.chunkIndex];
      if (!chunk) throw new Error("Choose a loaded map chunk.");
      recordBuildingEdit("Add building", chunk.chunkId, () => refreshBuildingPlacements(addMap3dBuilding(project, data, input)));
    },
    remove: () => {
      if (pendingImport || importing) throw new Error("Apply or cancel the map import before editing placements.");
      if (!state || !activeData || state.selectedBuildingIndex === undefined) throw new Error("Select a building to delete.");
      const data = activeData, index = state.selectedBuildingIndex, building = data.buildings[index];
      if (!building) throw new Error("Select a building to delete.");
      recordBuildingEdit("Delete building", building.chunkId, () => {
        deleteMap3dBuilding(project, data, index);
        refreshBuildingPlacements(undefined);
      });
    },
    edit: (field, value) => {
      if (pendingImport || importing) return false;
      if (!state || !activeData || state.selectedBuildingIndex === undefined) return false;
      const data = activeData, index = state.selectedBuildingIndex, building = data.buildings[index];
      if (!building) return false;
      let changed: number[] = [];
      recordBuildingEdit("Move building", building.chunkId, () => {
        changed = updateMap3dBuilding(project, data, index, field, value);
        for (const changedIndex of changed) {
          const placed = data.buildings[changedIndex];
          const group = state!.buildingGroup.children[changedIndex] as THREE.Group;
          group.position.set(placed.worldX, placed.worldY, placed.worldZ);
          group.rotation.y = THREE.MathUtils.degToRad(placed.rotationY);
          if (field === "uid") {
            clearGroup(group);
            addPrimitivesToGroup(group, placed.primitives, new Map());
          }
        }
        refreshBuildingBounds(state!, data);
        applyCurrentLayerSettings(false);
        onDirty?.();
      }, `${building.chunkId}:${building.placementIndex}:${field}`, index);
      return changed.length > 0;
    },
    place: (uid) => setBuildingPlacement(uid),
    hideOthers: (enabled) => {
      if (!state) return;
      state.hideOtherBuildings = enabled && state.selectedBuildingIndex !== undefined;
      applyCurrentLayerSettings(false);
    },
    isolate: (enabled) => {
      if (!state) return;
      state.isolateBuilding = enabled && state.selectedBuildingIndex !== undefined;
      applyCurrentLayerSettings(false);
      if (state.isolateBuilding) focusSelectedBuilding(state);
      else frameGroup(state);
    },
  });

  const setStatus = (message: string) => {
    if (message) console.info(`[Maps 3D] ${message}`);
    if (exportStatus) exportStatus.textContent = message;
  };

  const load = async (zoneId: number, preserveGrassView = false) => {
    const view = preserveGrassView && state
      ? { target: state.target.clone(), pitch: state.pitch, yaw: state.yaw, distance: state.distance } : undefined;
    if (!preserveGrassView) setGrassMode();
    setWarpPicking();
    if (placingUid !== undefined) setBuildingPlacement(undefined);
    // Undo steps belong to the map they were made on.
    const scope = activeMatrixCell ? `cell:${activeMatrixCell.matrixId}:${activeMatrixCell.x}:${activeMatrixCell.y}` : `zone:${zoneId}`;
    if (scope !== historyScope) { history.clear(); historyScope = scope; lastBuildingEdit = undefined; }
    clearImportReview();
    const token = ++loadToken;
    activeZone = zoneId;
    activeData = undefined;
    refreshImportButtons();
    buildingInspector.setData(undefined, "Loading map buildings…");
    if (state) {
      state.fieldCamera?.clear();
      state.currentData = undefined;
      state.selectedBuildingIndex = undefined;
      state.isolateBuilding = false;
      state.hideOtherBuildings = false;
      clearGroup(state.buildingSelectionGroup);
      applyCurrentLayerSettings(false);
    }
    if (exportButton) exportButton.disabled = true;
    if (importButton) importButton.disabled = true;
    if (nativeImportButton) nativeImportButton.disabled = true;
    setStatus("Loading map…");
    try {
      const data = await loadMap3dEditorZone(project, zoneId, activeSeason, (message) => {
        if (token === loadToken) setStatus(message);
      }, activeMatrixCell, includeNeighbors);
      if (token !== loadToken) return;
      activeData = data;
      activeZone = data.zoneId;
      state ??= createRenderer(canvasWrap);state.onCameraUpdate=updateCameraReadout;
      if (!state.tileTool) {
        state.tileTool = installMap3dTileTool(state.renderer.domElement, state,
          () => (!!grassMode || collisionBrush) && !grassBusy && !importing && !exporting && !pendingImport && !testingMap && !history.busy && !!activeData && !state?.cameraPose && lockedControls.size === 0,
          tiles => { if (collisionBrush) void paintCollisionTiles(tiles); else void finishGrassStroke(tiles); },
          () => { if (warpDestination) setWarpPicking(); else setTool("select"); },
          () => !!warpDestination,
          () => grassMode === "tree" ? paintBrush?.tree?.size ?? 1 : grassMode === "stamp" && paintBrush?.stamp ? stampSize(paintBrush.stamp, currentStampRotation()) : grassMode === "prop" && paintBrush?.prop ? stampSize(paintBrush.prop, currentStampRotation()) : 1,
          () => grassMode === "fence" ? "path" : grassMode !== "ledge" ? undefined : ledgeDirectionValue === "up" || ledgeDirectionValue === "down" ? "x" : "z");
      }
      state.permissionPicking = sidebarTabs.active !== "buildings" && sidebarTabs.active !== "camera";
      state.onBuildingPick = selectBuilding;
      state.onPermissionPick = (selection) => {
        sidebarTabs.select("collisions");
        selectPermissionTile(selection);
      };
      renderSceneData(state, data);
      if (paintBrushes.length) void refreshSwatchArt();
      state.fieldCamera ??= new Map3dCameraEditor(project, root.querySelector<HTMLElement>("#map3d-camera-inspector")!, state, onDirty,project.session.baseVersion==='W2'&&project.romInfo.idCode==='IRDO'?testCameraInGame:undefined, {
        recorded: (label, undo, redo) => history.push({ label, undo, redo }),
        modeChanged: refreshCameraModes,
      });
      state.fieldCamera.setActive(sidebarTabs.active === "camera");
      const camera = state.fieldCamera;
      void camera.load(data).then(() => {
        if (cameraTool && camera.mode === "navigate" && token === loadToken) camera.setMode("move");
      });
      state.onTextureFrame = refreshTextureControls;
      state.texturePreview.setEnabled(animateTextures?.checked ?? false);
      refreshTextureControls();
      const openedMap = root.querySelector<HTMLElement>("#map3d-opened-map")!;
      openedMap.hidden = !data.matrixCell && (zoneId !== initialTarget?.zoneId || initialTarget?.mapId === undefined);
      if (data.matrixCell) {
        openedMap.textContent = `${data.label} · Unassigned header`;
        openedMap.title = `Graphics resources: header ${data.zoneId}, area ${data.areaId}`;
        refreshZoneSelect(search?.value ?? "");
      } else if (!openedMap.hidden) {
        const chunk = data.chunks.find(chunk => chunk.sourceChunkId === initialTarget!.mapId)
          ?? data.chunks.find(chunk => chunk.chunkId === initialTarget!.mapId);
        openedMap.textContent = chunk ? `Map ${initialTarget!.mapId} · Header ${zoneId}` : `Map ${initialTarget!.mapId} is not present in this header’s current matrix.`;
        if (chunk) { state.target.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ); state.distance = Math.max(200, data.chunkSpan * 1.5); }
      }
      if (state && view) {
        state.target.copy(view.target);
        state.pitch = view.pitch;
        state.yaw = view.yaw;
        state.distance = view.distance;
      }
      buildingInspector.setData(data);
      metadataPanel.classList.toggle("-unassigned", Boolean(data.matrixCell));
      if (!data.matrixCell) writeMetadataForm(getMap3dZoneMetadata(project, zoneId), data);
      writeHeading(data);
      renderMap3dDiagnostics(warningsHost, statsHost, data);
      applyCurrentLayerSettings(false);
      if (!data.matrixCell) rememberMap3dView(project, zoneId, activeSeason);
      setStatus("");
      if (exportButton) exportButton.disabled = exporting;
      refreshImportButtons();
    } catch (error) {
      if (token !== loadToken) return;
      activeData = undefined;
      const message = error instanceof Error ? error.message : String(error);
      buildingInspector.setData(undefined, `Map load failed: ${message}`);
      setStatus(`Map load failed: ${message}`);
      if (warningsHost) warningsHost.innerHTML = "";
      if (titleHost) titleHost.textContent = "Map load failed";
      state ??= createRenderer(canvasWrap);
      clearGroup(state.terrainGroup);
      state.texturePreview.clear();
      refreshTextureControls();
      clearGroup(state.neighboringSceneryGroup);
      clearGroup(state.buildingGroup);
      clearGroup(state.buildingBoundsGroup);
      clearGroup(state.npcGroup);
      clearGroup(state.overlayGroup);
      clearGroup(state.permissionGroup);
      state.npcMovementActors = [];
    }
  };

  select.addEventListener("change", () => {
    if (select.value === "current") return;
    if (select.value !== "matrix-cell") {
      activeZone = Number(select.value);
      activeMatrixCell = undefined;
      refreshZoneSelect(search?.value ?? "");
    }
    void load(activeZone);
  });
  function setWarpPicking(destination?: typeof warpDestination) {
    warpDestination = destination;
    if (state) {
      state.onWarpTilePick = destination ? pickWarpTile : undefined;
      state.tileMode = Boolean(grassMode || collisionBrush || destination);
      state.dragging = false;
    }
    if (mapGameTest) {
      mapGameTest.setAttribute("aria-pressed", String(Boolean(destination)));
      mapGameTest.textContent = destination ? "Click a tile… (Esc cancels)" : "Open Game & Warp Here";
    }
    canvasWrap?.classList.toggle("map3d-warp-pick", Boolean(destination));
    updateTileToolHints();
    if (destination) {
      if (sidebarTabs.active === "camera") sidebarTabs.select("map");
      state?.fieldCamera?.freeView();
      if (state?.isolateBuilding) selectBuilding(undefined);
      state?.renderer.domElement.focus({ preventScroll: true });
    } else if (exportStatus) {
      exportStatus.textContent = "";
    }
  }

  mapGameTest?.addEventListener("click", async () => {
    if (warpDestination) { setWarpPicking(); return; }
    const data = activeData;
    if (!data || preparingWarp || testingMap || grassBusy || importing || exporting || pendingImport || lockedControls.size) return;
    const tab = sidebarTabs.active;
    preparingWarp = true;
    refreshImportButtons();
    try {
      const { prepareMapExploreDestination } = await import("../pokeweb/mapExploreDestination");
      const destination = await prepareMapExploreDestination(project, data);
      if (activeData !== data || sidebarTabs.active !== tab || !canvasWrap?.isConnected) return;
      setGrassMode();
      setCollisionBrush(false);
      if (exportStatus) exportStatus.textContent = "";
      setWarpPicking(destination);
    } catch (error) {
      if (exportStatus && activeData === data) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      preparingWarp = false;
      refreshImportButtons();
    }
  });

  function pickWarpTile(tile: Map3dTile | undefined) {
    if (!warpDestination || !activeData || state?.currentData !== activeData ||
      importing || exporting || pendingImport || grassBusy || lockedControls.size) return;
    try {
      if (!tile) throw new Error("Select a tile in the loaded map.");
      if (gameNoclip && !gameNoclip.checked) {
        const blocked = (dx: number, dy: number) => {
          const x = tile.matrixX * 32 + tile.tileX + dx, y = tile.matrixY * 32 + tile.tileY + dy;
          const chunk = activeData?.chunks.find(c => c.matrixX === Math.floor(x / 32) && c.matrixY === Math.floor(y / 32));
          const permissions = chunk?.permissions, at = permissions?.tiles[(y % 32) * permissions.width + x % 32];
          return !at || Boolean(at.flags & 1);
        };
        if (blocked(0, 0)) throw new Error("That tile blocks movement in game. Pick a walkable tile, or turn on Walk through walls.");
        if ([[0, -1], [0, 1], [-1, 0], [1, 0]].every(([dx, dy]) => blocked(dx, dy))) throw new Error("Every tile next to that one blocks movement, so you'd be stuck. Pick another tile, or turn on Walk through walls.");
      }
      const destination = warpDestination(tile);
      setWarpPicking();
      void testInGame(destination).catch(error => {
        if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
      });
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function testCameraInGame(position: MapCameraTestPosition) {
    const data = activeData;
    if (!data || data.zoneId !== position.zoneId || data.matrixCell) throw new Error("Reload the map before testing.");
    return testInGame(position);
  }

  /** Build the disposable test ROM and open it; returns what to do in game. */
  async function testInGame(destination: MapCameraTestPosition): Promise<string | undefined> {
    const data = activeData;
    if (!data) throw new Error("Reload the map before testing.");
    if (importing || pendingImport || exporting || grassBusy || lockedControls.size) throw new Error("Finish the current map edit before testing.");
    if (testingMap) return;
    const emulator = openTestBattleEmulator({ mode: "field" });
    testingMap = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = "Preparing game test…";
    try {
      const { buildMapExploreTestDownloads } = await import("../pokeweb/mapExploreTest");
      const { romBytes, saveBytes, walkThroughWalls, menuSkip } = await buildMapExploreTestDownloads(project, destination, { walkThroughWalls: gameNoclip?.checked ?? true });
      const instruction = menuSkip ? "Press Down" : "Continue, then press Down", walls = `Walk Through Walls ${walkThroughWalls ? "on" : "off"}`;
      const name = `${project.session.romName || project.session.baseVersion}-map-test-${destination.zoneId}-${destination.tileX}-${destination.tileZ}`;
      const label = `Zone ${destination.zoneId} · Tile ${destination.tileX}, ${destination.tileZ}`;
      await emulator.launch({ romName: `${name}.nds`, saveName: `${name}.dsv`, trainerId: 0,
        testLabel: `${label} — ${instruction} · ${walls}`, romBytes, saveBytes });
      if (exportStatus && activeData === data) exportStatus.textContent = `${instruction} → ${label} · ${walls} for this test`;
      return `${instruction} to warp.`;
    } catch (error) {
      emulator.close();
      if (activeData === data) throw error;
    } finally {
      testingMap = false;
      refreshImportButtons();
    }
  }
  root.querySelector<HTMLInputElement>("#map3d-show-neighbors")?.addEventListener("change", (event) => {
    includeNeighbors = (event.target as HTMLInputElement).checked;
    void load(activeZone);
  });
  animateTextures?.addEventListener("change", () => { state?.texturePreview.setEnabled(animateTextures.checked); refreshTextureControls(); });
  texturesPlay?.addEventListener("click", () => { if (state) state.texturePreview.setPlaying(!state.texturePreview.playing); refreshTextureControls(); });
  texturesReset?.addEventListener("click", () => { state?.texturePreview.seek(0); refreshTextureControls(); });
  texturesFrame?.addEventListener("input", () => { state?.texturePreview.setPlaying(false); state?.texturePreview.seek(Number(texturesFrame.value)); refreshTextureControls(); });

  exportButton?.addEventListener("click", async () => {
    if (!activeData || exporting || importing || pendingImport) return;
    const data = activeData;
    exporting = true;
    refreshImportButtons();
    exportButton.disabled = true;
    exportButton.textContent = "Exporting…";
    if (exportStatus) exportStatus.textContent = `Preparing ${data.label} (${data.season})…`;
    try {
      const { exportMap3dGlb } = await import("../pokeweb/map3dExport");
      const result = project.session.baseRom === "BW2"
        ? await (await import("../pokeweb/mapGlbImport")).exportMapGlbForImport(project, data)
        : await exportMap3dGlb(data);
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "model/gltf-binary" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (exportStatus && activeData === data) {
        exportStatus.textContent = `Exported ${result.chunkCount} terrain chunk${result.chunkCount === 1 ? "" : "s"} and ${result.buildingCount} building${result.buildingCount === 1 ? "" : "s"}. To import edits, keep the chunk/building parent objects and export the complete scene with Include → Custom Properties enabled and animations disabled. Keep texture dimensions power-of-two (8–1024 pixels), use PNG color textures, and bake complex shaders before import.${result.warnings.length ? " Map loading reported warnings; check the diagnostics below for missing assets." : ""}`;
      }
    } catch (error) {
      if (exportStatus && activeData === data) exportStatus.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      exporting = false;
      exportButton.disabled = !activeData;
      exportButton.textContent = "Export for Blender (.glb)";
      refreshImportButtons();
    }
  });

  function updateTileToolHints() {
    if (dragLabel) dragLabel.textContent = warpDestination ? "Click the tile to warp to · Drag: pan · Esc: cancel"
      : grassMode === "tree" ? `Click or drag to plant: ${paintBrush?.label.toLowerCase()} · Shift-drag: pan · Esc: Select`
      : grassMode === "fence" ? `Drag a path to draw: ${paintBrush?.label.toLowerCase()} — turns become corners · Shift-drag: pan · Esc: Select`
      : grassMode === "stamp" || grassMode === "prop" ? `Click to place: ${paintBrush?.label.toLowerCase()}${brushTurns() ? " · T: turn" : ""} · Shift-drag: pan · Esc: Select`
      : grassMode === "ledge" ? `Hold and drag along a ${ledgeDirectionValue === "up" || ledgeDirectionValue === "down" ? "row" : "column"} to draw a ledge · Shift-drag: pan · Esc: Select`
      : grassMode === "erase" ? `Drag over grass, trees, ledges, fences or objects${eraseNative?.checked ? "" : " you painted"} to erase them · Shift-drag: pan · Esc: Select`
        : grassMode ? `Drag over tiles to paint: ${paintBrush?.label.toLowerCase()} · Shift-drag: pan · Esc: Select`
          : collisionBrush ? "Drag over tiles to paint · Shift-drag: pan · Esc: Select"
            : cameraTool ? "Pick a camera tool · Shift-drag: pan · Esc: Select"
              : "Drag: rotate · Shift-drag: pan · Click a building or tile to edit it";
    if (shiftPanHint) shiftPanHint.hidden = Boolean(warpDestination);
    inspectHints.forEach(hint => { hint.hidden = Boolean(grassMode || collisionBrush || warpDestination); });
    syncToolButtons();
  }

  /** Press the button of the tool in use and show its options beside the tools. */
  function syncToolButtons() {
    const tool: MapTool = grassMode === "erase" ? "erase" : grassMode ? "paint" : collisionBrush ? "collision" : cameraTool ? "camera" : "select";
    for (const button of toolButtons) button.setAttribute("aria-pressed", String(button.dataset.mapTool === tool));
    syncPalette();
    if (cameraModes) cameraModes.hidden = !cameraTool;
    if (collisionBrushHint) {
      collisionBrushHint.hidden = !collisionBrush;
      const tileClass = clampU16(Number(permissionClass?.value ?? 0));
      const name = gen5TileClassName(tileClass);
      collisionBrushHint.textContent = `Paints class ${tileClass}${name ? ` (${name})` : ""} · flags ${formatHex16(readFlagCheckboxes())} — set them in the Collisions tab`;
    }
  }

  function setTool(tool: MapTool) {
    if (tool !== "paint" && tool !== "erase" && grassMode) setGrassMode();
    if (tool !== "collision" && collisionBrush) setCollisionBrush(false);
    if (tool !== "camera" && cameraTool) setCameraTool(false);
    if (tool === "paint" && paintBrush) setGrassMode(paintBrush.mode);
    else if (tool === "erase") setGrassMode("erase");
    else if (tool === "collision") setCollisionBrush(true);
    else if (tool === "camera") setCameraTool(true);
    updateTileToolHints();
  }

  /** The collision brush paints the Collisions tab's class and flags over the tiles a drag covers, in the overhead view. */
  function setCollisionBrush(enabled: boolean) {
    if (enabled && warpDestination) setWarpPicking();
    if (enabled && grassMode) setGrassMode();
    collisionBrush = enabled;
    if (state) {
      state.tileMode = Boolean(grassMode || collisionBrush || warpDestination);
      state.dragging = false;
      state.tileTool?.reset();
    }
    canvasWrap?.classList.toggle("map3d-grass-active", Boolean(grassMode || collisionBrush));
    if (enabled) {
      if (sidebarTabs.active === "camera") sidebarTabs.select("collisions");
      if (showPermissions && !showPermissions.checked) { showPermissions.checked = true; applyCurrentLayerSettings(); }
      state?.fieldCamera?.freeView();
      if (state?.isolateBuilding) selectBuilding(undefined);
      state?.renderer.domElement.focus({ preventScroll: true });
    }
    updateTileToolHints();
  }

  /** Camera regions: the Camera tab, with its region tools beside the tool buttons. */
  function setCameraTool(enabled: boolean) {
    cameraTool = enabled;
    if (enabled) {
      if (grassMode) setGrassMode();
      if (collisionBrush) setCollisionBrush(false);
      if (warpDestination) setWarpPicking();
      if (sidebarTabs.active !== "camera") sidebarTabs.select("camera");
      if (state?.fieldCamera?.mode === "navigate") state.fieldCamera.setMode("move");
    } else state?.fieldCamera?.setMode("navigate");
    refreshCameraModes();
    updateTileToolHints();
  }

  function refreshCameraModes() {
    const mode = state?.fieldCamera?.mode ?? "navigate";
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-camera-mode]")) button.setAttribute("aria-pressed", String(button.dataset.cameraMode === mode));
  }

  function setGrassMode(mode?: BrushMode) {
    if (mode && warpDestination) setWarpPicking();
    const enabled = Boolean(mode);
    grassMode = mode;
    if (mode) { collisionBrush = false; cameraTool = false; state?.fieldCamera?.setMode("navigate"); }
    if (state) {
      state.tileMode = Boolean(mode || collisionBrush || warpDestination);
      state.dragging = false;
      state.tileTool?.reset();
    }
    updateTileToolHints();
    canvasWrap?.classList.toggle("map3d-grass-active", enabled);
    if (enabled) {
      if (sidebarTabs.active === "camera") sidebarTabs.select("map");
      state?.fieldCamera?.freeView();
      if (state?.isolateBuilding) selectBuilding(undefined);
      state?.renderer.domElement.focus({ preventScroll: true });
    }
  }

  // ---------- Paint palette ----------

  /** Mark the chosen swatch and show its options; Erase uses the grass surface option too. */
  function syncPalette() {
    for (const swatch of swatches) swatch.setAttribute("aria-pressed", String(swatch.dataset.brush === paintBrush?.id && grassMode !== "erase"));
    for (const arrow of ledgeArrows) arrow.setAttribute("aria-pressed", String(arrow.dataset.ledgeDirection === ledgeDirectionValue));
    const name = root.querySelector<HTMLElement>("#map3d-brush-name"), note = root.querySelector<HTMLElement>("#map3d-brush-note");
    const erasing = grassMode === "erase";
    if (name) name.textContent = erasing ? "Erase" : paintBrush?.label ?? "";
    if (note) note.textContent = erasing ? "Remove painted elements" : paintBrush?.note ?? "";
    root.querySelector<HTMLElement>('[data-brush-option="surface"]')?.toggleAttribute("hidden", !(erasing || paintBrush?.grass));
    root.querySelector<HTMLElement>('[data-brush-option="direction"]')?.toggleAttribute("hidden", erasing || paintBrush?.mode !== "ledge");
    root.querySelector<HTMLElement>('[data-brush-option="ends"]')?.toggleAttribute("hidden", erasing || paintBrush?.mode !== "fence" || !paintBrush.fence?.turnedEnds);
    root.querySelector<HTMLElement>('[data-brush-option="native"]')?.toggleAttribute("hidden", !erasing);
    root.querySelector<HTMLElement>('[data-brush-option="blocked"]')?.toggleAttribute("hidden", erasing || !paintBrush || paintBrush.mode === "ledge");
    root.querySelector<HTMLElement>('[data-brush-option="rotate"]')?.toggleAttribute("hidden", erasing || !brushTurns());
    const turn = root.querySelector<HTMLElement>("#map3d-stamp-turn");
    if (turn) turn.textContent = `${currentStampRotation() * 90}°`;
  }

  function currentStampRotation(): StampRotation {
    return brushTurns() ? stampRotation : 0;
  }

  /** Whether the chosen object or model can be turned. */
  function brushTurns() {
    return Boolean(paintBrush?.stamp?.rotatable || paintBrush?.prop?.rotatable);
  }

  /** Turn the object brush a quarter turn (clockwise for 1). */
  function turnStamp(step: 1 | -1) {
    if (!brushTurns()) return;
    stampRotation = ((stampRotation + step + 4) % 4) as StampRotation;
    state?.tileTool?.reset();
    syncPalette();
  }

  function choosePaintBrush(id: string) {
    const next = paintBrushes.find(brush => brush.id === id);
    if (!next) return;
    paintBrush = next;
    writeStoredText(PAINT_BRUSH_KEY, next.id);
    if (exportStatus) exportStatus.textContent = "";
    setTool("paint");
  }

  for (const swatch of swatches) swatch.addEventListener("click", () => choosePaintBrush(swatch.dataset.brush!));
  for (const toggle of root.querySelectorAll<HTMLButtonElement>("[data-brush-group]")) toggle.addEventListener("click", () => {
    const category = toggle.dataset.brushGroup!, open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    root.querySelector<HTMLElement>(`#${toggle.getAttribute("aria-controls")}`)?.toggleAttribute("hidden", !open);
    if (open) collapsedGroups.delete(category);
    else collapsedGroups.add(category);
    writeStoredText(PALETTE_COLLAPSED_KEY, [...collapsedGroups].join(","));
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-stamp-turn]")) button.addEventListener("click", () => {
    turnStamp(button.dataset.stampTurn === "-1" ? -1 : 1);
    state?.renderer.domElement.focus({ preventScroll: true });
  });
  for (const arrow of ledgeArrows) arrow.addEventListener("click", () => {
    ledgeDirectionValue = arrow.dataset.ledgeDirection as LedgeDirection;
    if (paintBrush?.mode !== "ledge" || grassMode !== "ledge") choosePaintBrush("ledge");
    state?.tileTool?.reset();
    updateTileToolHints();
    state?.renderer.domElement.focus({ preventScroll: true });
  });

  /** Swatches show the game's art for the season on screen, drawn from the source ROM. */
  const thumbnailRenderer = paintBrushes.length ? createBrushThumbnailRenderer() : undefined;
  const thumbnailCache = new Map<string, string>();
  let thumbnailToken = 0;
  async function refreshSwatchArt() {
    const token = ++thumbnailToken, season = activeSeason;
    const seasonLabel = root.querySelector<HTMLElement>("#map3d-palette-season");
    if (seasonLabel) seasonLabel.textContent = season[0].toUpperCase() + season.slice(1);
    const preview = await import("../pokeweb/mapBrushPreview");
    for (const brush of paintBrushes) {
      const key = `${brush.id}:${brush.mode === "ledge" ? "" : season}`;
      let url = thumbnailCache.get(key);
      try {
        if (!url) {
          if (brush.grass) { const layers = await preview.grassPreview(project, brush.grass, season); url = layers?.length ? grassSwatch(layers) : undefined; }
          else if (brush.tree) { const art = await preview.treePreview(project, brush.tree, season); url = art && thumbnailRenderer?.render(art, "tree"); }
          else if (brush.prop) { const art = await preview.propPreview(project, brush.prop); url = art && thumbnailRenderer?.render(art, "tree"); }
          else if (brush.fence) { const art = await preview.fencePreview(project, brush.fence, season); url = art && thumbnailRenderer?.render(art, "tree"); }
          else if (brush.thick) { const art = await preview.thickGrassPreview(project, brush.thick === "green" ? ["nagakusa01a", "nagakusa01b"] : ["nagakusa02a", "nagakusa02b"], season); url = art && thumbnailRenderer?.render(art, "tree"); }
          else if (brush.stamp) { const art = await preview.stampPreview(project, brush.stamp, season); url = art && thumbnailRenderer?.render(art, "tree"); }
          else { const art = await preview.ledgePreview(project, "down", "spring"); url = art && thumbnailRenderer?.render(art, "ledge"); }
          if (url) thumbnailCache.set(key, url);
        }
      } catch {
        url = undefined; // Keep the icon when the source ROM is unavailable.
      }
      if (token !== thumbnailToken || !root.isConnected) return;
      const art = root.querySelector<HTMLElement>(`[data-brush="${brush.id}"] .mx-brush-art`);
      if (art && url) art.innerHTML = `<img src="${url}" alt="" draggable="false" />`;
    }
  }

  async function finishGrassStroke(tiles: Map3dTile[]) {
    const data = activeData, mode = grassMode;
    if (!data || grassBusy || importing || exporting || pendingImport || !mode) return;
    if (mode === "tree") return finishTreeStroke(data, mode, tiles);
    if (mode === "ledge") return finishLedgeStroke(data, mode, tiles);
    if (mode === "stamp") return finishStampStroke(data, tiles);
    if (mode === "thick") return finishThickStroke(data, tiles);
    if (mode === "fence") return finishFenceStroke(data, tiles);
    if (mode === "prop") return finishPropStroke(data, tiles);
    if (mode === "erase") return finishErase(data, tiles);
    const kind = paintBrush?.grass ?? "regular";
    const choice = grassSurface?.value;
    const surface: MapGrassSurface = choice === "upper" || choice === "lower" ? choice : "auto";
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = "Painting grass…";
    try {
      const { paintMapGrass } = await import("../pokeweb/mapGrass");
      const isCurrent = () => activeData === data && grassMode === mode && !!canvasWrap?.isConnected;
      const stroke = await paintMapGrass(project, data, tiles, kind, { surface, isCurrent, allowBlocked: allowBlocked() });
      if (stroke.count) {
        history.push({
          label: "Plant grass",
          undo: () => replayGrass(stroke, true),
          redo: () => replayGrass(stroke, false),
        });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const done = stroke.count ? `Painted grass on ${stroke.count} ${stroke.count === 1 ? "tile" : "tiles"}.` : "No grass painted.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const where = season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "";
          const label = GRASS_SKIP_LABELS[reason] + where;
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        const detail = skipped.length ? ` Skipped ${stroke.skipped} ${stroke.skipped === 1 ? "tile" : "tiles"} (${skipped.join(", ")}).` : "";
        const recovered = stroke.sourceFallbackCount
          ? ` Used source ROM permissions for ${stroke.sourceFallbackCount} older ${stroke.sourceFallbackCount === 1 ? "tile" : "tiles"}.` : "";
        exportStatus.textContent = done + detail + recovered;
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function finishTreeStroke(data: Map3dSceneData, mode: "tree", tiles: Map3dTile[]) {
    const typeId = paintBrush?.tree?.id ?? "";
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = mode === "tree" ? "Planting trees…" : "Removing trees…";
    try {
      const { placeMapTrees, removeMapTrees } = await import("../pokeweb/mapTrees");
      const isCurrent = () => activeData === data && grassMode === mode && !!canvasWrap?.isConnected;
      const stroke = mode === "tree" ? await placeMapTrees(project, data, tiles, typeId, { isCurrent, allowBlocked: allowBlocked() })
        : await removeMapTrees(project, data, tiles, { isCurrent });
      if (stroke.count) {
        history.push({
          label: mode === "tree" ? "Plant trees" : "Remove trees",
          undo: () => replayTrees(stroke, true),
          redo: () => replayTrees(stroke, false),
        });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const noun = (count: number) => `${count} ${count === 1 ? "tree" : "trees"}`;
        const done = stroke.count ? `${mode === "tree" ? "Planted" : "Removed"} ${noun(stroke.count)}.`
          : mode === "tree" ? "No trees planted." : "No trees removed.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const label = TREE_SKIP_LABELS[reason] + (season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "");
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        exportStatus.textContent = done + (skipped.length ? ` Skipped ${stroke.skipped} (${skipped.join(", ")}).` : "");
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function finishLedgeStroke(data: Map3dSceneData, mode: "ledge", tiles: Map3dTile[]) {
    const direction = ledgeDirectionValue;
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = mode === "ledge" ? "Drawing ledge…" : "Removing ledges…";
    try {
      const { placeMapLedge, removeMapLedges } = await import("../pokeweb/mapLedges");
      const isCurrent = () => activeData === data && grassMode === mode && !!canvasWrap?.isConnected;
      const stroke = mode === "ledge" ? await placeMapLedge(project, data, tiles, direction, { isCurrent })
        : await removeMapLedges(project, data, tiles, { isCurrent });
      if (stroke.count) {
        history.push({
          label: mode === "ledge" ? "Draw ledge" : "Remove ledges",
          undo: () => replayLedges(stroke, true),
          redo: () => replayLedges(stroke, false),
        });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const noun = (count: number) => `${count} ${count === 1 ? "ledge" : "ledges"}`;
        const done = mode === "ledge" ? stroke.count ? `Drew a ${tiles.length}-tile ledge.` : "No ledge drawn."
          : stroke.count ? `Removed ${noun(stroke.count)}.` : "No ledges removed.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const label = LEDGE_SKIP_LABELS[reason] + (season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "");
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        exportStatus.textContent = done + (skipped.length ? ` (${skipped.join(", ")})` : "");
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function finishStampStroke(data: Map3dSceneData, tiles: Map3dTile[]) {
    const stamp = paintBrush?.stamp, rotation = currentStampRotation();
    if (!stamp) return;
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = `Placing ${stamp.label.toLowerCase()}…`;
    try {
      const { placeMapStamps } = await import("../pokeweb/mapStamps");
      const isCurrent = () => activeData === data && grassMode === "stamp" && !!canvasWrap?.isConnected;
      const stroke = await placeMapStamps(project, data, tiles, stamp.id, rotation, { isCurrent, allowBlocked: allowBlocked() });
      if (stroke.count) {
        history.push({ label: `Place ${stamp.label.toLowerCase()}`, undo: () => replayStamps(stroke, true), redo: () => replayStamps(stroke, false) });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const done = stroke.count ? `Placed ${stamp.label.toLowerCase()}${stroke.count > 1 ? ` × ${stroke.count}` : ""}.` : "Nothing placed.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const label = STAMP_SKIP_LABELS[reason] + (season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "");
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        const still = stroke.stillAreas ? " This map's area has no texture animation file, so the art stays still here." : "";
        exportStatus.textContent = done + (skipped.length ? ` Skipped ${stroke.skipped} (${skipped.join(", ")}).` : "") + still;
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function finishThickStroke(data: Map3dSceneData, tiles: Map3dTile[]) {
    const kind = paintBrush?.thick;
    if (!kind) return;
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = "Painting thick grass…";
    try {
      const { strokeThickGrass } = await import("../pokeweb/mapThickGrass");
      const isCurrent = () => activeData === data && grassMode === "thick" && !!canvasWrap?.isConnected;
      const stroke = await strokeThickGrass(project, data, tiles, kind, { isCurrent, allowBlocked: allowBlocked() });
      if (stroke.count) {
        history.push({ label: "Paint thick grass", undo: () => replayThick(stroke, true), redo: () => replayThick(stroke, false) });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const done = stroke.count ? `Painted thick grass on ${stroke.count} ${stroke.count === 1 ? "tile" : "tiles"}.` : "No thick grass painted.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const label = THICK_SKIP_LABELS[reason] + (season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "");
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        exportStatus.textContent = done + (skipped.length ? ` Skipped ${stroke.skipped} (${skipped.join(", ")}).` : "");
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function finishFenceStroke(data: Map3dSceneData, tiles: Map3dTile[]) {
    const fence = paintBrush?.fence;
    if (!fence) return;
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = `Drawing ${fence.label.toLowerCase()}…`;
    try {
      const { strokeFenceTiles } = await import("../pokeweb/mapFences");
      const isCurrent = () => activeData === data && grassMode === "fence" && !!canvasWrap?.isConnected;
      const stroke = await strokeFenceTiles(project, data, tiles, fence.id, { isCurrent, allowBlocked: allowBlocked(), ends: fence.turnedEnds ? fenceEndStyle() : "corner" });
      if (stroke.count) {
        history.push({ label: `Draw ${fence.label.toLowerCase()}`, undo: () => replayFences(stroke, true), redo: () => replayFences(stroke, false) });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const done = stroke.count ? `Drew ${stroke.count} ${stroke.count === 1 ? "tile" : "tiles"} of ${fence.label.toLowerCase()}.` : "No fence drawn.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const label = FENCE_SKIP_LABELS[reason] + (season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "");
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        exportStatus.textContent = done + (skipped.length ? ` Skipped ${stroke.skipped} (${skipped.join(", ")}).` : "");
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function finishPropStroke(data: Map3dSceneData, tiles: Map3dTile[]) {
    const prop = paintBrush?.prop, rotation = currentStampRotation();
    if (!prop) return;
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = `Placing ${prop.label.toLowerCase()}…`;
    try {
      const { placeMapProps } = await import("../pokeweb/mapProps");
      const isCurrent = () => activeData === data && grassMode === "prop" && !!canvasWrap?.isConnected;
      const stroke = await placeMapProps(project, data, tiles, prop.id, rotation, { isCurrent, allowBlocked: allowBlocked() });
      if (stroke.count) {
        history.push({ label: `Place ${prop.label.toLowerCase()}`, undo: () => replayProps(stroke, true), redo: () => replayProps(stroke, false) });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) {
        const done = stroke.count ? `Placed ${prop.label.toLowerCase()}${stroke.count > 1 ? ` × ${stroke.count}` : ""}.` : "Nothing placed.";
        const skipped = stroke.skipReasons.map(({ count, reason, season }) => {
          const label = PROP_SKIP_LABELS[reason] + (season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : "");
          return stroke.skipReasons.length === 1 ? label : `${count} ${label}`;
        });
        exportStatus.textContent = done + (skipped.length ? ` Skipped ${stroke.skipped} (${skipped.join(", ")}).` : "");
      }
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function replayProps(stroke: PropStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoMapProps, undoMapProps } = await import("../pokeweb/mapProps");
      if (undo) undoMapProps(project, stroke);
      else redoMapProps(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  async function replayFences(stroke: FenceTileStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoFenceTiles, undoFenceTiles } = await import("../pokeweb/mapFences");
      if (undo) undoFenceTiles(project, stroke);
      else redoFenceTiles(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  async function replayThick(stroke: ThickGrassStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoThickGrass, undoThickGrass } = await import("../pokeweb/mapThickGrass");
      if (undo) undoThickGrass(project, stroke);
      else redoThickGrass(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  async function replayStamps(stroke: StampStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoMapStamps, undoMapStamps } = await import("../pokeweb/mapStamps");
      if (undo) undoMapStamps(project, stroke);
      else redoMapStamps(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  async function replayLedges(stroke: LedgeStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoMapLedges, undoMapLedges } = await import("../pokeweb/mapLedges");
      if (undo) undoMapLedges(project, stroke);
      else redoMapLedges(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  async function replayTrees(stroke: TreeStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoMapTrees, undoMapTrees } = await import("../pokeweb/mapTrees");
      if (undo) undoMapTrees(project, stroke);
      else redoMapTrees(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  /** Erase: remove brush-placed objects, ledges, trees and grass under the drag as one undoable edit. */
  async function finishErase(data: Map3dSceneData, tiles: Map3dTile[]) {
    const choice = grassSurface?.value;
    const surface: MapGrassSurface = choice === "upper" || choice === "lower" ? choice : "auto";
    grassBusy = true;
    refreshImportButtons();
    if (exportStatus) exportStatus.textContent = "Erasing…";
    const undoers: (() => void)[] = [], redoers: (() => void)[] = [];
    const done: string[] = [], skipped: string[] = [];
    try {
      const [{ removeMapLedges, undoMapLedges, redoMapLedges }, { removeMapTrees, undoMapTrees, redoMapTrees }, { removeMapGrass, undoMapGrass, redoMapGrass }] =
        await Promise.all([import("../pokeweb/mapLedges"), import("../pokeweb/mapTrees"), import("../pokeweb/mapGrass")]);
      const isCurrent = () => activeData === data && grassMode === "erase" && !!canvasWrap?.isConnected;
      const noun = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
      const describe = <R extends string>(reasons: { reason: R; count: number; season?: string }[], labels: Record<R, string>, ignore: R[] = []) => {
        for (const { reason, count, season } of reasons) if (!ignore.includes(reason)) skipped.push(`${count} ${labels[reason]}${season ? ` in ${season[0].toUpperCase()}${season.slice(1)}` : ""}`);
      };
      const { removeMapStamps, undoMapStamps, redoMapStamps } = await import("../pokeweb/mapStamps");
      const stamps = await removeMapStamps(project, data, tiles, { isCurrent });
      if (stamps.count) { undoers.push(() => undoMapStamps(project, stamps)); redoers.push(() => redoMapStamps(project, stamps)); done.push(noun(stamps.count, "object", "objects")); }
      describe(stamps.skipReasons, STAMP_SKIP_LABELS);
      if (project.session.baseRom === "BW2") {
        const { removeMapProps, undoMapProps, redoMapProps } = await import("../pokeweb/mapProps");
        const props = await removeMapProps(project, data, tiles, { isCurrent });
        if (props.count) { undoers.push(() => undoMapProps(project, props)); redoers.push(() => redoMapProps(project, props)); done.push(noun(props.count, "model", "models")); }
        describe(props.skipReasons, PROP_SKIP_LABELS);
        const { removeMapFences, undoMapFences, redoMapFences, strokeFenceTiles, undoFenceTiles, redoFenceTiles } = await import("../pokeweb/mapFences");
        const fenceTiles = await strokeFenceTiles(project, data, tiles, undefined, { isCurrent });
        if (fenceTiles.count) { undoers.push(() => undoFenceTiles(project, fenceTiles)); redoers.push(() => redoFenceTiles(project, fenceTiles)); done.push(noun(fenceTiles.count, "fence tile", "fence tiles")); }
        describe(fenceTiles.skipReasons, FENCE_SKIP_LABELS);
        // Fences drawn as single straight runs before fences joined up.
        const fences = await removeMapFences(project, data, tiles, { isCurrent });
        if (fences.count) { undoers.push(() => undoMapFences(project, fences)); redoers.push(() => redoMapFences(project, fences)); done.push(noun(fences.count, "fence", "fences")); }
        describe(fences.skipReasons, FENCE_SKIP_LABELS);
        const { strokeThickGrass, undoThickGrass, redoThickGrass } = await import("../pokeweb/mapThickGrass");
        const thick = await strokeThickGrass(project, data, tiles, undefined, { isCurrent });
        if (thick.count) { undoers.push(() => undoThickGrass(project, thick)); redoers.push(() => redoThickGrass(project, thick)); done.push(noun(thick.count, "thick grass tile", "thick grass tiles")); }
        describe(thick.skipReasons, THICK_SKIP_LABELS);
      }
      const ledges = await removeMapLedges(project, data, tiles, { isCurrent });
      if (ledges.count) { undoers.push(() => undoMapLedges(project, ledges)); redoers.push(() => redoMapLedges(project, ledges)); done.push(noun(ledges.count, "ledge", "ledges")); }
      describe(ledges.skipReasons, LEDGE_SKIP_LABELS);
      const trees = await removeMapTrees(project, data, tiles, { isCurrent });
      if (trees.count) { undoers.push(() => undoMapTrees(project, trees)); redoers.push(() => redoMapTrees(project, trees)); done.push(noun(trees.count, "tree", "trees")); }
      describe(trees.skipReasons, TREE_SKIP_LABELS);
      const grass = await removeMapGrass(project, data, tiles, { surface, isCurrent });
      if (grass.count) { undoers.push(() => undoMapGrass(project, grass)); redoers.push(() => redoMapGrass(project, grass)); done.push(noun(grass.count, "grass tile", "grass tiles")); }
      describe(grass.skipReasons, GRASS_SKIP_LABELS, ["no-painted-grass", "outside-map"]);
      if (eraseNative?.checked) {
        const { eraseNativeMapArt, undoNativeErase, redoNativeErase } = await import("../pokeweb/mapNativeErase");
        const native = await eraseNativeMapArt(project, data, tiles, { isCurrent });
        if (native.maps.length) {
          undoers.push(() => undoNativeErase(project, native));
          redoers.push(() => redoNativeErase(project, native));
          if (native.trees) done.push(noun(native.trees, "of the map's trees", "of the map's trees"));
          if (native.grassTiles) done.push(noun(native.grassTiles, "of the map's grass tiles", "of the map's grass tiles"));
        }
      }
      if (undoers.length) {
        history.push({
          label: "Erase",
          undo: () => replayEdits([...undoers].reverse()),
          redo: () => replayEdits(redoers),
        });
        onDirty?.();
        await load(data.zoneId, true);
      }
      if (exportStatus) exportStatus.textContent = (done.length ? `Erased ${done.join(", ")}.` : "Nothing painted here to erase.") + (skipped.length ? ` Skipped ${skipped.join(", ")}.` : "");
    } catch (error) {
      if (exportStatus) exportStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  async function replayEdits(steps: (() => void)[]) {
    grassBusy = true;
    refreshImportButtons();
    try {
      for (const step of steps) step();
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  /** Undo or redo a grass stroke from the history, then show the result. */
  async function replayGrass(stroke: GrassStroke, undo: boolean) {
    grassBusy = true;
    refreshImportButtons();
    try {
      const { redoMapGrass, undoMapGrass } = await import("../pokeweb/mapGrass");
      if (undo) undoMapGrass(project, stroke);
      else redoMapGrass(project, stroke);
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
    await load(activeZone, true);
  }

  function refreshImportButtons() {
    const busy = grassBusy || importing || exporting || testingMap || !!pendingImport;
    const grassDisabled = !activeData?.chunks.some(chunk => chunk.permissions) || busy || preparingWarp;
    for (const button of toolButtons) if (button.dataset.mapTool === "paint" || button.dataset.mapTool === "erase") button.disabled = grassDisabled;
    for (const swatch of swatches) swatch.disabled = grassDisabled;
    if (grassSurface) grassSurface.disabled = busy;
    if (importButton) importButton.disabled = !activeData || grassBusy || importing || exporting || !!pendingImport;
    if (nativeImportButton) nativeImportButton.disabled = !activeData || grassBusy || importing || exporting || !!pendingImport;
    if (nativeFolderButton) nativeFolderButton.disabled = !activeData || grassBusy || importing || exporting || !!pendingImport;
    if (exportButton) exportButton.disabled = !activeData || grassBusy || importing || exporting || !!pendingImport;
    if (heightGenerate) heightGenerate.disabled = !activeData || grassBusy || importing || exporting || !!pendingImport;
    if (mapGameTest) mapGameTest.disabled = grassDisabled;
    for (const button of toolButtons) if (button.dataset.mapTool === "collision" || button.dataset.mapTool === "camera") button.disabled = !activeData || busy;
    refreshHistoryButtons();
  }
  function clearImportReview() {
    pendingImport = undefined; importReview.hidden = true;
    for (const [control, disabled] of lockedControls) control.disabled = disabled;
    lockedControls.clear();
    refreshImportButtons();
  }
  function showImportPreview(data: Map3dSceneData) {
    if (!state) return;
    renderSceneData(state, data);
    buildingInspector.setData(undefined, "Apply or cancel the map import to resume placement editing.");
    applyCurrentLayerSettings(false);
  }
  heightGenerate?.addEventListener("click", async () => {
    if (!activeData || importing || exporting || pendingImport) return;
    const data = activeData, locks = new Map<HTMLInputElement | HTMLSelectElement | HTMLButtonElement, boolean>();
    importing = true; refreshImportButtons();
    try {
      const { openMapHeightDialog } = await import("./mapHeightDialog");
      openMapHeightDialog(project, root, data, {
        lock(locked) {
          importing = locked;
          if (locked) for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(".mx-side input, .mx-side select, .mx-side button, .mx-toolbar button, .mx-toolbar select")) { locks.set(control, control.disabled); control.disabled = true; }
          else { for (const [control, disabled] of locks) control.disabled = disabled; locks.clear(); }
          refreshImportButtons();
        },
        preview: showImportPreview,
        restore() { if (state && activeData) { renderSceneData(state, activeData); buildingInspector.setData(activeData); applyCurrentLayerSettings(false); } },
        async applied(edit) {
          history.push({ label: "Generate walking heights", undo: () => replayHeights(edit, true), redo: () => replayHeights(edit, false) });
          onDirty?.(); await load(activeZone); setStatus("Walking heights applied. Export the ROM to test movement.");
        },
      });
    } catch (error) { importing = false; refreshImportButtons(); setStatus(error instanceof Error ? error.message : String(error)); }
  });
  async function replayHeights(edit: MapHeightEdit, undo: boolean) {
    (await import("../pokeweb/mapHeightEdit")).applyMapHeightEdit(project, edit, undo);
    onDirty?.();
    await load(activeZone, true);
  }
  async function openNativeImport(openFolder = false) {
    if (!activeData || importing || exporting || pendingImport) return;
    const data = activeData, locks = new Map<HTMLInputElement | HTMLSelectElement | HTMLButtonElement, boolean>();
    importing = true; refreshImportButtons();
    try {
      const { openGen5MapImportDialog } = await import("./gen5MapImportDialog");
      await openGen5MapImportDialog(project, root, { matrixId: data.sourceMatrixId, x: data.matrixCell?.x ?? data.chunks[0]?.matrixX ?? 0,
        y: data.matrixCell?.y ?? data.chunks[0]?.matrixY ?? 0, headerId: data.zoneId, season: data.season }, {
        lock(locked) {
          importing = locked;
          if (locked) for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(".mx-side input, .mx-side select, .mx-side button, .mx-toolbar button, .mx-toolbar select")) {
            locks.set(control, control.disabled); control.disabled = true;
          }
          else { for (const [control, disabled] of locks) control.disabled = disabled; locks.clear(); }
          refreshImportButtons();
        },
        preview: showImportPreview,
        restore() { if (state && activeData) { renderSceneData(state, activeData); buildingInspector.setData(activeData); applyCurrentLayerSettings(false); } },
        async applied(result) {
          activeMatrixCell = undefined; activeSeason = result.target.season;
          history.push({ label: "DS Map Studio import", undo: async () => {
            await (await import("../pokeweb/gen5MapImport")).undoGen5MapImport(project, result);
            onDirty?.(); await load(activeZone);
          } });
          if (select) select.value = String(result.target.headerId);
          for (const choice of seasonButtons) choice.setAttribute("aria-pressed", String(choice.dataset.map3dSeason === activeSeason));
          onDirty?.(); await load(result.target.headerId);
          if (exportStatus) exportStatus.textContent = "DS Map Studio import applied. Export the ROM to test it in-game.";
        },
      }, { openFolder });
    } catch (error) { importing = false; refreshImportButtons(); if (exportStatus) exportStatus.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`; }
  }
  nativeImportButton?.addEventListener("click", () => { void openNativeImport(); });
  nativeFolderButton?.addEventListener("click", () => { void openNativeImport(true); });
  importButton?.addEventListener("click", () => {
    if (activeData && !importing && !pendingImport) importFile?.click();
  });
  importFile?.addEventListener("change", async () => {
    const file = importFile.files?.[0], data = activeData;
    importFile.value = "";
    if (!file || !data || importing) return;
    if (file.size > 64 * 1024 * 1024) { if (exportStatus) exportStatus.textContent = "Choose a GLB smaller than 64 MB."; return; }
    importing = true; refreshImportButtons();
    if (exportStatus) exportStatus.textContent = "Reading map edits and converting changed game resources…";
    try {
      const { prepareMapGlbImport } = await import("../pokeweb/mapGlbImport");
      const result = await prepareMapGlbImport(project, data, new Uint8Array(await file.arrayBuffer()));
      if (activeData !== data || !canvasWrap.isConnected) return;
      if (!result.patches.length) { if (exportStatus) exportStatus.textContent = "No supported changes found. All native map resources remain unchanged."; return; }
      pendingImport = result;
      for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(".mx-side input, .mx-side select, .mx-side button, .mx-toolbar button, .mx-toolbar select")) {
        if (importReview.contains(control)) continue;
        lockedControls.set(control, control.disabled); control.disabled = true;
      }
      importReview.innerHTML = `<strong>Review converted map</strong>
        <p>${result.terrainModels} terrain models · ${result.buildingModels} building models · ${result.buildingVariants} new variants · ${result.importedTextures} textures</p>
        <p>Placements: ${result.moved} moved · ${result.added} added · ${result.deleted} deleted</p>
        <p>Color textures, basic materials, geometry, and placements are imported. Existing material animations, collision, walking heights, NPCs, and warps are retained. Blender lighting and post-processing are not game assets.</p>
        ${result.notes.map(note => `<p>${escapeHtml(note)}</p>`).join("")}
        <div class="map3d-building-actions"><button class="btn sm -ghost" type="button" data-map-import="original">Show original</button><button class="btn sm -ghost" type="button" data-map-import="converted">Show converted</button><button class="btn sm -primary" type="button" data-map-import="apply">Apply map import</button><button class="btn sm" type="button" data-map-import="cancel">Cancel</button></div>`;
      importReview.hidden = false;
      showImportPreview(result.converted);
      if (exportStatus) exportStatus.textContent = "Previewing converted game assets. Review shared-resource changes and placement deletions before applying.";
    } catch (error) { if (activeData === data && exportStatus) exportStatus.textContent = `Import failed: ${error instanceof Error ? error.message : error}`; }
    finally { importing = false; refreshImportButtons(); }
  });
  importReview.addEventListener("click", async event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-map-import]")?.dataset.mapImport;
    const result = pendingImport;
    if (!action || !result || importing) return;
    if (action === "original" || action === "converted") { showImportPreview(action === "original" ? result.original : result.converted); return; }
    if (action === "cancel") { clearImportReview(); if (state && activeData) { renderSceneData(state, activeData); buildingInspector.setData(activeData); applyCurrentLayerSettings(false); } if (exportStatus) exportStatus.textContent = "Map import canceled."; return; }
    importing = true; refreshImportButtons();
    try {
      await (await import("../pokeweb/mapGlbImport")).applyMapGlbImport(project, result);
      history.push({ label: "Map import", undo: () => replayGlbImport(result, true), redo: () => replayGlbImport(result, false) });
      onDirty?.(); clearImportReview(); await load(activeZone);
      if (exportStatus) exportStatus.textContent = "Map import applied. Export the ROM to test it in-game. Undo restores the previous resources while you stay on this map.";
    } catch (error) { if (exportStatus) exportStatus.textContent = `Apply failed: ${error instanceof Error ? error.message : error}`; }
    finally { importing = false; refreshImportButtons(); }
  });
  async function replayGlbImport(result: MapGlbImport, undo: boolean) {
    importing = true; refreshImportButtons();
    try {
      await (await import("../pokeweb/mapGlbImport")).applyMapGlbImport(project, result, undo);
      onDirty?.();
    } finally { importing = false; refreshImportButtons(); }
    await load(activeZone);
  }

  for (const button of seasonButtons) button.addEventListener("click", () => {
    const season = button.dataset.map3dSeason;
    if (!isMap3dSeason(season) || season === activeSeason) return;
    activeSeason = season;
    for (const choice of seasonButtons) choice.setAttribute("aria-pressed", String(choice === button));
    void load(activeZone);
  });

  showBuildings?.addEventListener("change", () => {
    applyCurrentLayerSettings();
  });

  showBuildingBounds?.addEventListener("change", () => {
    applyCurrentLayerSettings();
  });

  showNpcs?.addEventListener("change", () => {
    applyCurrentLayerSettings();
  });

  showEntities?.addEventListener("change", () => {
    applyCurrentLayerSettings();
  });

  showPermissions?.addEventListener("change", () => {
    applyCurrentLayerSettings();
  });

  showMovementPreview?.addEventListener("change", () => {
    applyCurrentLayerSettings();
  });

  for (const input of permissionFlagInputs) {
    input.addEventListener("change", () => {
      updateFlagValueDisplay();
      syncToolButtons();
    });
  }

  // The class picker and the number beside it show the same value; the picker names the common classes.
  permissionClassSelect?.addEventListener("change", () => {
    if (permissionClass && permissionClassSelect.value !== "other") permissionClass.value = permissionClassSelect.value;
    syncToolButtons();
  });
  permissionClass?.addEventListener("input", () => { syncClassPicker(); syncToolButtons(); });

  permissionApply?.addEventListener("click", () => {
    applyPermissionBrush();
  });

  // ---------- Map settings: saved as they change ----------

  const zoneMetadataInputs: Array<[HTMLInputElement | HTMLSelectElement | null, keyof Map3dZoneMetadata]> = [
    [metadataFields.location, "locationName"], [metadataFields.matrix, "matrixId"], [metadataFields.sourceArea, "areaId"],
    [metadataFields.overworlds, "overworldsId"], [metadataFields.script, "scriptId"], [metadataFields.text, "textBankId"],
    [metadataFields.encounter, "encounterId"], [metadataFields.mapType, "mapType"], [metadataFields.weather, "weatherId"],
    [metadataFields.parent, "parentMapId"], [metadataFields.levelScript, "levelScriptId"], [metadataFields.camera, "cameraId"],
    [metadataFields.flags, "flags"],
  ];
  const areaMetadataInputs = [metadataFields.texturePack, metadataFields.buildings, metadataFields.srt, metadataFields.pat, metadataFields.exterior];
  const sceneMetadataInputs = new Set<HTMLInputElement | HTMLSelectElement | null>([metadataFields.matrix, metadataFields.sourceArea, ...areaMetadataInputs]);
  for (const input of [...zoneMetadataInputs.map(([input]) => input), ...areaMetadataInputs]) {
    input?.addEventListener("change", () => saveMetadata(sceneMetadataInputs.has(input)));
  }

  /** Save the Map tab as one edit: only the fields that changed, undoable together. */
  function saveMetadata(reload: boolean) {
    const data = activeData;
    if (!data || data.matrixCell || pendingImport || importing) return;
    const zoneId = activeZone, areaId = data.areaId;
    try {
      const zoneBefore = getMap3dZoneMetadata(project, zoneId), areaBefore = { ...data.areaMetadata };
      const zoneForm = readZoneMetadataForm(), areaForm = readAreaMetadataForm();
      const zoneChanges = Object.fromEntries(Object.entries(zoneForm).filter(([key, value]) => String(zoneBefore[key as keyof Map3dZoneMetadata]) !== String(value)));
      const areaChanges = Object.fromEntries(Object.entries(areaForm).filter(([key, value]) => areaBefore[key as keyof Map3dAreaMetadata] !== value)) as Partial<Map3dAreaMetadata>;
      if (!Object.keys(zoneChanges).length && !Object.keys(areaChanges).length) return;
      writeMetadata(zoneId, areaId, zoneChanges, areaChanges);
      const zoneAfter = Object.fromEntries(Object.keys(zoneChanges).map((key) => [key, getMap3dZoneMetadata(project, zoneId)[key as keyof Map3dZoneMetadata]]));
      const zoneUndo = Object.fromEntries(Object.keys(zoneChanges).map((key) => [key, zoneBefore[key as keyof Map3dZoneMetadata]]));
      const areaUndo = Object.fromEntries(Object.keys(areaChanges).map((key) => [key, areaBefore[key as keyof Map3dAreaMetadata]])) as Partial<Map3dAreaMetadata>;
      history.push({
        label: "Change map settings",
        undo: () => restoreMetadata(zoneId, areaId, zoneUndo, areaUndo, reload),
        redo: () => restoreMetadata(zoneId, areaId, zoneAfter, areaChanges, reload),
      });
      afterMetadataChange(reload);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      writeMetadataForm(getMap3dZoneMetadata(project, zoneId), data);
    }
  }

  function writeMetadata(zoneId: number, areaId: number, zone: Partial<Record<keyof Map3dZoneMetadata, string | number>>, area: Partial<Map3dAreaMetadata>) {
    if (Object.keys(zone).length) updateMap3dZoneMetadata(project, zoneId, zone);
    if (Object.keys(area).length) {
      const current = activeData?.areaId === areaId ? activeData.areaMetadata : getMap3dAreaMetadataFor(areaId);
      const next = updateMap3dAreaMetadata(project, areaId, current, area);
      if (activeData?.areaId === areaId) activeData.areaMetadata = next;
    }
  }

  function getMap3dAreaMetadataFor(areaId: number): Map3dAreaMetadata {
    const edited = project.map3dAreaEdits?.[String(areaId)];
    if (edited) return edited;
    if (activeData?.areaId === areaId) return activeData.areaMetadata;
    throw new Error("Open the map that uses this area to undo its change.");
  }

  async function restoreMetadata(zoneId: number, areaId: number, zone: Partial<Record<keyof Map3dZoneMetadata, string | number>>, area: Partial<Map3dAreaMetadata>, reload: boolean) {
    writeMetadata(zoneId, areaId, zone, area);
    afterMetadataChange(reload && zoneId === activeZone);
    if (!reload && activeData && zoneId === activeZone) writeMetadataForm(getMap3dZoneMetadata(project, zoneId), activeData);
  }

  function afterMetadataChange(reload: boolean) {
    zones = getMap3dZones(project);
    refreshZoneSelect(search?.value ?? "");
    onDirty?.();
    if (activeData) writeHeading(activeData);
    if (reload) void load(activeZone, true);
    else setStatus("Saved.");
  }

  weatherEffect?.addEventListener("change", () => {
    const data = activeData;
    if (!data || data.matrixCell) return;
    const zoneId = activeZone, rowId = getMap3dZoneMetadata(project, zoneId).rowId;
    const row = project.headers?.rows[rowId];
    const before = row ? getHeaderWeatherId(row) : 0, after = Number(weatherEffect.value);
    const write = (weatherId: number) => {
      assignWeatherToArea(project, rowId, weatherId);
      afterMetadataChange(false);
      if (activeData && activeZone === zoneId) writeMetadataForm(getMap3dZoneMetadata(project, zoneId), activeData);
    };
    try {
      write(after);
      history.push({ label: "Change weather", undo: () => write(before), redo: () => write(after) });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      writeHeading(data);
    }
  });

  root.querySelector(".mx-panel.map3d-metadata-editor")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-map-open]");
    if (!button || !activeData || activeData.matrixCell) return;
    const meta = getMap3dZoneMetadata(project, activeZone);
    const kind = button.dataset.mapOpen;
    if (kind === "overworld") links?.openOverworld?.(meta.overworldsId, meta.rowId - 1);
    else if (kind === "script") links?.openScript?.(meta.scriptId);
    else if (kind === "level-script") links?.openScript?.(meta.levelScriptId);
    else if (kind === "text") links?.openText?.(meta.textBankId);
    else if (kind === "encounters") links?.openEncounters?.(meta.encounterId);
  });

  // ---------- Toolbar ----------

  for (const button of toolButtons) {
    const tool = button.dataset.mapTool as MapTool;
    button.addEventListener("click", () => setTool(tool === "select" || button.getAttribute("aria-pressed") !== "true" ? tool : "select"));
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-camera-mode]")) {
    button.addEventListener("click", () => {
      state?.fieldCamera?.setMode(button.dataset.cameraMode as "move" | "draw" | "walk" | "pick");
      refreshCameraModes();
    });
  }

  undoButton?.addEventListener("click", () => { void stepHistory("undo"); });
  redoButton?.addEventListener("click", () => { void stepHistory("redo"); });
  root.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (event.key === "Escape" && placingUid !== undefined) { setBuildingPlacement(undefined); setStatus(""); return; }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !target.closest("input, textarea, select, [contenteditable=true]")) {
      if (event.key.toLowerCase() === "t" && (grassMode === "stamp" || grassMode === "prop") && brushTurns()) { event.preventDefault(); turnStamp(event.shiftKey ? -1 : 1); return; }
      const tool = ({ v: "select", b: "paint", e: "erase", c: "collision", r: "camera" } as Record<string, MapTool>)[event.key.toLowerCase()];
      const button = tool && toolButtons.find(candidate => candidate.dataset.mapTool === tool);
      if (button && !button.disabled) { event.preventDefault(); setTool(tool); return; }
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (target.closest("input:not([type=checkbox]):not([type=range]), textarea, select, [contenteditable=true]")) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    void stepHistory(key === "y" || event.shiftKey ? "redo" : "undo");
  });

  async function stepHistory(direction: "undo" | "redo") {
    if (grassBusy || importing || exporting || pendingImport || testingMap) return;
    try {
      const message = direction === "undo" ? await history.undo() : await history.redo();
      if (message) setStatus(message);
    } catch (error) {
      setStatus(`Couldn't ${direction}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function refreshHistoryButtons() {
    const blocked = history.busy || grassBusy || importing || exporting || !!pendingImport || testingMap;
    if (undoButton) {
      undoButton.disabled = blocked || !history.undoLabel;
      undoButton.title = history.undoLabel ? `Undo ${history.undoLabel.toLowerCase()} (⌘Z)` : "Nothing to undo";
    }
    if (redoButton) {
      redoButton.disabled = blocked || !history.redoLabel;
      redoButton.title = history.redoLabel ? `Redo ${history.redoLabel.toLowerCase()} (⇧⌘Z)` : "Nothing to redo";
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-zone-step]")) {
    button.addEventListener("click", () => {
      const options = Array.from(zoneSelect.options).filter((option) => /^\d+$/.test(option.value));
      const index = options.findIndex((option) => option.value === String(activeZone));
      const next = options[index < 0 ? 0 : (index + Number(button.dataset.zoneStep) + options.length) % options.length];
      if (!next) return;
      zoneSelect.value = next.value;
      zoneSelect.dispatchEvent(new Event("change"));
    });
  }

  // The Files menu closes once an item is chosen, or on a click elsewhere.
  const filesMenu = root.querySelector<HTMLDetailsElement>("#map3d-files");
  filesMenu?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".mx-menu-item")) filesMenu.open = false;
  });
  const closeMenus = (event: PointerEvent) => {
    if (!root.isConnected || !root.contains(zoneSelect)) { document.removeEventListener("pointerdown", closeMenus, true); thumbnailRenderer?.dispose(); return; }
    for (const menu of root.querySelectorAll<HTMLDetailsElement>(".mx-menu[open], .mx-pop[open]")) {
      if (!menu.contains(event.target as Node)) menu.open = false;
    }
  };
  document.addEventListener("pointerdown", closeMenus, true);

  function writeHeading(data: Map3dSceneData) {
    const meta = data.matrixCell ? undefined : getMap3dZoneMetadata(project, data.zoneId);
    if (titleHost) titleHost.textContent = meta?.locationName || data.label;
    if (subtitleHost) {
      const season = data.season ? `${data.season[0]!.toUpperCase()}${data.season.slice(1)}` : "";
      subtitleHost.textContent = data.matrixCell
        ? `Matrix ${data.sourceMatrixId} · cell ${data.matrixCell.x}, ${data.matrixCell.y}${season ? ` · ${season}` : ""}`
        : `Zone ${data.zoneId} · Matrix ${meta!.matrixId}${data.areaMetadata.isExterior ? "" : " · Interior"}${season && !gen4 ? ` · ${season}` : ""}`;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-map-open]")) {
      const kind = button.dataset.mapOpen;
      button.hidden = Boolean(data.matrixCell) || !(kind === "overworld" ? links?.openOverworld : kind === "text" ? links?.openText : kind === "encounters" ? links?.openEncounters : links?.openScript);
    }
    if (weatherEffect && meta) {
      try {
        const row = project.headers?.rows[meta.rowId];
        const current = row ? getHeaderWeatherId(row) : 0;
        const effects = getAssignableWeatherEffects(project);
        if (!effects.some((effect) => effect.id === current)) effects.push(...getWeatherEffects(project).filter((effect) => effect.id === current));
        weatherEffect.innerHTML = effects.map((effect) => `<option value="${effect.id}"${effect.id === current ? " selected" : ""}>${escapeHtml(effect.name)}</option>`).join("")
          || `<option value="${current}">Weather ${current}</option>`;
        weatherEffect.disabled = false;
      } catch {
        weatherEffect.innerHTML = `<option>Unavailable</option>`;
        weatherEffect.disabled = true;
      }
    }
  }

  search?.addEventListener("input", () => {
    refreshZoneSelect(search.value);
  });
  // Enter opens the first matching map.
  search?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = Array.from(zoneSelect.options).find((option) => /^\d+$/.test(option.value));
    if (!first) return;
    event.preventDefault();
    if (Number(first.value) === activeZone && !activeMatrixCell) return;
    zoneSelect.value = first.value;
    zoneSelect.dispatchEvent(new Event("change"));
  });

  root.querySelector<HTMLButtonElement>("#map3d-reset")?.addEventListener("click", () => {
    if (state) frameGroup(state);
  });

  root.querySelector<HTMLButtonElement>("#map3d-topdown")?.addEventListener("click", () => {
    if (state) topDownGroup(state);
  });


  /** Coalesces typing into one building field into a single undo step. */
  let lastBuildingEdit: { key: string; at: number; entry: MapEdit; after: Uint8Array } | undefined;

  /**
   * Run a building edit and add an undo step that puts the chunk file back byte for byte, then reloads the map. Edits
   * with the same key made within a moment of each other (typing a number) share one step.
   */
  function recordBuildingEdit(label: string, chunkId: number, action: () => void, key?: string, reselect?: number): void {
    const before = readMap3dChunkBytes(project, chunkId);
    action();
    const after = readMap3dChunkBytes(project, chunkId);
    setStatus("Saved.");
    if (!before || !after) return;
    const now = performance.now();
    if (key && lastBuildingEdit?.key === key && now - lastBuildingEdit.at < 2000 && history.isLatest(lastBuildingEdit.entry)) {
      lastBuildingEdit.after = after;
      lastBuildingEdit.at = now;
      return;
    }
    const record = { key: key ?? "", at: now, after, entry: undefined as unknown as MapEdit };
    record.entry = {
      label,
      undo: () => replayBuildingBytes(chunkId, before, reselect),
      redo: () => replayBuildingBytes(chunkId, record.after, reselect),
    };
    lastBuildingEdit = key ? record : undefined;
    history.push(record.entry);
  }

  async function replayBuildingBytes(chunkId: number, bytes: Uint8Array, reselect?: number) {
    restoreMap3dChunkBytes(project, chunkId, bytes);
    onDirty?.();
    await load(activeZone, true);
    if (reselect !== undefined && activeData?.buildings[reselect]) selectBuilding(reselect);
  }

  /** "+ Building": wait for a click on the terrain, then place the chosen model there. */
  let placingUid: number | undefined;
  function setBuildingPlacement(uid: number | undefined) {
    placingUid = uid;
    if (uid !== undefined) {
      if (grassMode) setGrassMode();
      if (collisionBrush) setCollisionBrush(false);
      if (warpDestination) setWarpPicking();
      if (state) state.permissionPicking = false;
      setStatus("Click the map where the new building goes. Esc cancels.");
    } else if (state) state.permissionPicking = sidebarTabs.active !== "buildings" && sidebarTabs.active !== "camera";
    if (state) state.onPlacePick = uid === undefined ? undefined : placeBuildingAt;
    canvasWrap?.classList.toggle("map3d-warp-pick", uid !== undefined || Boolean(warpDestination));
    buildingInspector.setPlacing(uid !== undefined);
  }

  function placeBuildingAt(point: THREE.Vector3 | undefined) {
    const uid = placingUid, data = activeData;
    if (uid === undefined || !data) return;
    if (!point) { setStatus("Click on the map's terrain to place the building."); return; }
    // Chunk origins are their centres, so the nearest one holds the point.
    let chunkIndex = -1, best = Infinity;
    for (const [index, chunk] of data.chunks.entries()) {
      const distance = Math.max(Math.abs(point.x - chunk.worldX), Math.abs(point.z - chunk.worldZ));
      if (distance < best) { best = distance; chunkIndex = index; }
    }
    setBuildingPlacement(undefined);
    if (chunkIndex < 0 || best > data.chunkSpan / 2 + 1) { setStatus("That point is outside the map's chunks."); return; }
    const snap = (value: number) => Math.round(value);
    try {
      const chunkId = data.chunks[chunkIndex]!.chunkId;
      recordBuildingEdit("Add building", chunkId, () => refreshBuildingPlacements(addMap3dBuilding(project, data, {
        chunkIndex, uid, worldX: snap(point.x), worldY: snap(point.y), worldZ: snap(point.z), rotationY: 0,
      })));
      sidebarTabs.select("buildings");
      setStatus("Building added. Adjust it in the Buildings tab.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function selectBuilding(index: number | undefined): void {
    if (!state || !activeData || pendingImport || importing) return;
    const building = index === undefined ? undefined : activeData.buildings[index];
    if (building) sidebarTabs.select("buildings");
    const wasIsolated = state.isolateBuilding;
    state.selectedBuildingIndex = building ? index : undefined;
    if (!building) state.isolateBuilding = state.hideOtherBuildings = false;
    else if (showBuildings) showBuildings.checked = true;
    buildingInspector.select(state.selectedBuildingIndex);
    applyCurrentLayerSettings();
    if (state.isolateBuilding) focusSelectedBuilding(state);
    else if (wasIsolated) frameGroup(state);
  }

  function refreshBuildingPlacements(index: number | undefined): void {
    if (!state || !activeData) return;
    renderBuildingPlacements(state, activeData);
    state.selectedBuildingIndex = index;
    if (index === undefined) state.isolateBuilding = state.hideOtherBuildings = false;
    else if (showBuildings) showBuildings.checked = true;
    buildingInspector.refreshPlacements(index);
    refreshTextureControls();
    applyCurrentLayerSettings(false);
    renderMap3dDiagnostics(warningsHost, statsHost, activeData);
    onDirty?.();
  }

  function selectPermissionTile(selection: PermissionSelection): void {
    if (!state || pendingImport || importing) return;
    state.selectedPermission = selection;
    const tile = selection.tile;
    // While the brush is on, picking a tile must not overwrite the values being painted.
    if (!collisionBrush) {
      if (permissionClass) permissionClass.value = String(tile.tileClass);
      syncClassPicker();
      setFlagCheckboxes(tile.flags);
    }
    writeTileCard(selection);
    updatePermissionSelectionMarker(state);
    syncToolButtons();
  }

  function writeTileCard(selection: PermissionSelection): void {
    if (!permissionSelected) return;
    const tile = selection.tile;
    const name = gen4 ? undefined : gen5TileClassName(tile.tileClass);
    const flags = GEN5_PERMISSION_FLAGS.filter((flag) => (tile.flags & flag.bit) !== 0).map((flag) => flag.label);
    const color = `#${gen5PermissionColorNumber(tile).toString(16).padStart(6, "0")}`;
    permissionSelected.innerHTML = `
      <div class="mx-tile-head"><span class="mx-swatch" style="background:${color}"></span><strong>${escapeHtml(name ?? `Class ${tile.tileClass}`)}</strong><span class="mx-hex">${tile.tileClass}</span></div>
      <div class="mx-tile-meta">${escapeHtml(flags.length ? flags.join(", ") : "No flags")} <span class="mx-hex">${formatHex16(tile.flags)}</span></div>
      <div class="mx-tile-meta">Tile ${selection.tileX}, ${selection.tileY} · Chunk ${selection.chunkId} · Cell ${selection.matrixX}, ${selection.matrixY}</div>
      <div class="mx-tile-meta">Height ${tile.height} · Type ${tile.heightType} · Slope ${tile.slope}</div>
    `;
  }

  /** Show the class number in the named picker, or "Other" when it has no name. */
  function syncClassPicker(): void {
    if (!permissionClassSelect || !permissionClass) return;
    const value = permissionClass.value.trim();
    const known = Array.from(permissionClassSelect.options).some((option) => option.value === value && option.value !== "other");
    permissionClassSelect.value = known ? value : "other";
  }

  function applyPermissionBrush(): void {
    const selection = state?.selectedPermission;
    if (!selection) {
      setStatus("Click a collision tile on the map first.");
      return;
    }
    void paintCollisionTiles([{ matrixX: selection.matrixX, matrixY: selection.matrixY, tileX: selection.tileX, tileY: selection.tileY }], "Edit collision tile");
  }

  /** Give the tiles the Collisions tab's class and flags, save at once, and add one undo step for the whole stroke. */
  async function paintCollisionTiles(tiles: Map3dTile[], label = "Paint collisions"): Promise<void> {
    const data = activeData;
    if (!data || grassBusy || importing || exporting || pendingImport || testingMap) return;
    const tileClass = clampU16(Number(permissionClass?.value ?? 0));
    const flags = readFlagCheckboxes();
    const before: Map3dPermissionEdit[] = [], after: Map3dPermissionEdit[] = [];
    const seen = new Set<string>();
    for (const target of tiles) {
      const chunk = data.chunks.find((candidate) => candidate.matrixX === target.matrixX && candidate.matrixY === target.matrixY && candidate.permissions);
      const permissions = chunk?.permissions;
      if (!chunk || !permissions || target.tileX < 0 || target.tileY < 0 || target.tileX >= permissions.width) continue;
      const key = permissionEditKey(chunk.chunkId, target.tileX, target.tileY);
      const tile = permissions.tiles[target.tileY * permissions.width + target.tileX];
      if (seen.has(key) || !tile) continue;
      seen.add(key);
      if (tile.tileClass === tileClass && tile.flags === flags) continue;
      const at = { chunkId: chunk.chunkId, tileX: target.tileX, tileY: target.tileY };
      before.push({ ...at, tileClass: tile.tileClass, flags: tile.flags });
      after.push({ ...at, tileClass, flags });
    }
    if (!after.length) {
      setStatus(seen.size ? "Those tiles already have these values." : "No collision tiles there.");
      return;
    }
    try {
      await writeCollisions(after);
      history.push({ label, undo: () => writeCollisions(before), redo: () => writeCollisions(after) });
      setStatus(after.length === 1 ? `Saved tile ${after[0]!.tileX}, ${after[0]!.tileY}.` : `Saved ${after.length} tiles.`);
    } catch (error) {
      setStatus(`Couldn't save collisions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Save collision values and show them on every loaded copy of each chunk. */
  async function writeCollisions(edits: Map3dPermissionEdit[]): Promise<void> {
    grassBusy = true;
    refreshImportButtons();
    try {
      if (gen4) saveGen4Map3dPermissionEdits(project, edits);
      else await saveMap3dPermissionEdits(project, edits);
      const data = activeData;
      if (data) {
        for (const edit of edits) {
          for (const chunk of data.chunks) {
            if (chunk.chunkId !== edit.chunkId || !chunk.permissions) continue;
            const tile = chunk.permissions.tiles[edit.tileY * chunk.permissions.width + edit.tileX];
            if (tile) { tile.tileClass = edit.tileClass; tile.flags = edit.flags; }
          }
        }
        if (state?.currentData === data) {
          renderPermissionOverlays(state, data);
          if (state.selectedPermission) selectPermissionTile(state.selectedPermission);
        }
      }
      onDirty?.();
    } finally {
      grassBusy = false;
      refreshImportButtons();
    }
  }

  function currentLayerSettings(): Map3dLayerSettings {
    return {
      showBuildings: showBuildings?.checked ?? DEFAULT_MAP3D_LAYER_SETTINGS.showBuildings,
      showBuildingBounds: showBuildingBounds?.checked ?? DEFAULT_MAP3D_LAYER_SETTINGS.showBuildingBounds,
      showNpcs: showNpcs?.checked ?? DEFAULT_MAP3D_LAYER_SETTINGS.showNpcs,
      showEntities: showEntities?.checked ?? DEFAULT_MAP3D_LAYER_SETTINGS.showEntities,
      showPermissions: showPermissions?.checked ?? DEFAULT_MAP3D_LAYER_SETTINGS.showPermissions,
      showMovementPreview: showMovementPreview?.checked ?? DEFAULT_MAP3D_LAYER_SETTINGS.showMovementPreview,
    };
  }

  function applyCurrentLayerSettings(persist = true): void {
    const settings = currentLayerSettings();
    if (state) {
      applyLayerVisibility(state, settings.showBuildings, settings.showBuildingBounds, settings.showNpcs, settings.showEntities, settings.showPermissions);
      setMovementPreview(state, settings.showMovementPreview);
    }
    if (persist) rememberMap3dLayerSettings(project, settings);
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
    if (permissionFlagValue) permissionFlagValue.textContent = formatHex16(readFlagCheckboxes());
  }

  function writeMetadataForm(zone: Map3dZoneMetadata, data: Map3dSceneData): void {
    const location = metadataFields.location;
    if (location) {
      // Headers can only use names from the game's location list.
      const names = [...new Set(project.texts.banks.locations ?? [])];
      if (!names.includes(zone.locationName)) names.unshift(zone.locationName);
      if (location.options.length !== names.length) location.innerHTML = names.map((name) => `<option>${escapeHtml(name)}</option>`).join("");
      location.value = zone.locationName;
    }
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
    const matches = zones.filter((zone) => zone.label.toLowerCase().includes(query) || String(zone.zoneId).includes(query));
    // When the filter hides the map on screen, keep it as the selected entry so picking any match (even the only
    // one) is a change.
    const shown = activeMatrixCell || matches.some((zone) => zone.zoneId === activeZone);
    const current = zones.find((zone) => zone.zoneId === activeZone);
    const placeholder = shown || !current ? "" : `<option value="current" selected>${escapeHtml(current.label)} (showing)</option>`;
    zoneSelect.innerHTML = matrixCellOption() + placeholder + matches
      .map((zone) => `<option value="${zone.zoneId}" ${!activeMatrixCell && zone.zoneId === activeZone ? "selected" : ""}>${escapeHtml(zone.label)}</option>`)
      .join("");
  }

  function matrixCellOption(): string {
    if (!activeMatrixCell) return "";
    const label = activeData?.matrixCell ? activeData.label : `Matrix ${activeMatrixCell.matrixId} (${activeMatrixCell.x}, ${activeMatrixCell.y})`;
    return `<option value="matrix-cell" selected>${escapeHtml(label)} · Unassigned header</option>`;
  }

  // Last, so every helper above is defined before the first load runs.
  if (zones.length === 0) setStatus("No parsed headers are available.");
  else void load(initialZone);
}

async function loadMap3dEditorZone(project: ProjectState, zoneId: number, season: Map3dSeason, onProgress?: (message: string) => void, matrixCell?: Map3dMatrixCell, includeNeighbors = false): Promise<Map3dSceneData> {
  if (!isGen4Project(project)) return loadMap3dZone(project, zoneId, { season, matrixCell, includeNeighbors }, onProgress);
  onProgress?.("Reading Gen 4 map archives");
  await ensureGen4Map3dResources(project);
  const metadata = getMap3dZoneMetadata(project, zoneId);
  onProgress?.("Building Gen 4 stitched map scene");
  return buildGen4Map3dScene(project, metadata.matrixId, { headerId: zoneId, label: metadata.locationName, locationGroup: true });
}

/** The status bar's map stats, and a Warnings button that opens the load warnings and unresolved buildings. */
function renderMap3dDiagnostics(host: HTMLDivElement | null, statsHost: HTMLElement | null, data: Map3dSceneData): void {
  const diagnostics = data.buildingDiagnostics ?? [];
  const placementCount = data.buildingPlacementCount ?? data.buildingCount;
  const failedBuildings = diagnostics.filter((entry) => entry.status !== "rendered");
  if (statsHost) {
    const parts = [
      `${data.chunkCount} chunk${data.chunkCount === 1 ? "" : "s"}`,
      placementCount === data.buildingCount ? `${data.buildingCount} building${data.buildingCount === 1 ? "" : "s"}` : `${data.buildingCount} of ${placementCount} buildings shown`,
      `${data.textureCount} textured primitive${data.textureCount === 1 ? "" : "s"}`,
    ];
    if (data.neighboringScenery) parts.push(`${data.neighboringScenery.chunks.length} neighbor chunk${data.neighboringScenery.chunks.length === 1 ? "" : "s"}`);
    statsHost.textContent = parts.join(", ");
  }
  if (!host) return;
  const count = data.warnings.length + failedBuildings.length;
  if (count === 0) {
    host.innerHTML = "";
    return;
  }
  const list = (items: string[]) => items.slice(0, 24).map((item) => `<li>${item}</li>`).join("") + (items.length > 24 ? `<li>…and ${items.length - 24} more</li>` : "");
  host.innerHTML = `<details class="mx-pop -up">
    <summary class="btn sm -ghost mx-warn-button">${count} warning${count === 1 ? "" : "s"}</summary>
    <div class="mx-pop-body mx-warning-list">
      ${failedBuildings.length ? `<div class="mx-group-title">Unresolved buildings</div><ul>${list(failedBuildings.map(formatBuildingDiagnostic))}</ul>` : ""}
      ${data.warnings.length ? `<div class="mx-group-title">While loading</div><ul>${list(data.warnings.map((warning) => escapeHtml(warning)))}</ul>` : ""}
    </div>
  </details>`;
}

function formatBuildingDiagnostic(entry: NonNullable<Map3dSceneData["buildingDiagnostics"]>[number]): string {
  const base = `Map ${entry.mapId} placement ${entry.placementIndex} model ${entry.modelId}: ${entry.status}`;
  const detail =
    entry.status === "rendered"
      ? `${entry.primitiveCount ?? 0} primitive${entry.primitiveCount === 1 ? "" : "s"}, ${entry.triangleCount ?? 0} triangle${entry.triangleCount === 1 ? "" : "s"}`
      : (entry.message ?? "");
  return escapeHtml(detail ? `${base} (${detail})` : base);
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

/** Shared navigation and rendering for the map and standalone building viewers. */
export function createBuildingLibraryPreview(container: HTMLElement) {
  const state = createRenderer(container);
  const reset = () => {
    state.selectedBuildingIndex = 0;
    focusSelectedBuilding(state);
  };
  return {
    show(data: Map3dSceneData) {
      renderSceneData(state, data);
      applyLayerVisibility(state, true, false, false, false, false);
      reset();
    },
    clear() {
      state.texturePreview.clear();
      clearGroup(state.buildingGroup);
      clearGroup(state.buildingBoundsGroup);
      clearGroup(state.buildingSelectionGroup);
      state.currentData = undefined;
      state.selectedBuildingIndex = undefined;
    },
    reset,
    topDown: () => { reset(); state.yaw = 0; state.pitch = Math.PI / 2 - 0.001; },
  };
}

function createRenderer(container: HTMLElement): RendererState {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20232a);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100000);
  const tileCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 32768);
  tileCamera.up.set(0, 0, -1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = "";
  container.append(renderer.domElement);

  const grid = new THREE.GridHelper(4096, 32, 0x6c7080, 0x3c4048);
  scene.add(grid);
  const group = new THREE.Group();
  const terrainGroup = new THREE.Group();
  const neighboringSceneryGroup = new THREE.Group();
  const buildingGroup = new THREE.Group();
  const buildingBoundsGroup = new THREE.Group();
  const buildingSelectionGroup = new THREE.Group();
  const npcGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  const permissionGroup = new THREE.Group();
  buildingBoundsGroup.visible = false;
  group.add(terrainGroup, neighboringSceneryGroup, buildingGroup, buildingBoundsGroup, buildingSelectionGroup, npcGroup, overlayGroup, permissionGroup);
  scene.add(group);

  const state: RendererState = {
    renderer,
    scene,
    camera,
    tileCamera,
    tileMode: false,
    group,
    terrainGroup,
    neighboringSceneryGroup,
    texturePreview: new Map3dTexturePreview(),
    buildingGroup,
    buildingBoundsGroup,
    buildingSelectionGroup,
    grid,
    isolateBuilding: false,
    hideOtherBuildings: false,
    npcGroup,
    overlayGroup,
    permissionGroup,
    permissionPicking: true,
    npcMovementActors: [],
    movementPreview: false,
    movementPreviewStartMs: performance.now(),
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
    const viewport = state.cameraPose ? cameraViewport(width, height) : { x: 0, y: 0, width, height };
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.clear();
    renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
    renderer.setScissorTest(true);
    camera.aspect = viewport.width / viewport.height;
    camera.updateProjectionMatrix();
  };
  const updateCamera = () => {
    const pose = state.cameraPose;
    camera.fov = pose?.fov ?? 55; camera.near = pose?.near ?? 0.1; camera.far = pose?.far ?? 100000;
    camera.updateProjectionMatrix();
    if (pose) {
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
      return;
    }
    const y = Math.sin(state.pitch) * state.distance;
    const r = Math.cos(state.pitch) * state.distance;
    camera.position.set(state.target.x + Math.sin(state.yaw) * r, state.target.y + y, state.target.z + Math.cos(state.yaw) * r);
    camera.lookAt(state.target);
  };
  const updateTileCamera = () => {
    // Use the same center and nominal zoom as the free camera.
    const halfHeight = state.distance * Math.tan(THREE.MathUtils.degToRad(55 / 2));
    tileCamera.left = -halfHeight * camera.aspect;
    tileCamera.right = -tileCamera.left;
    tileCamera.top = halfHeight;
    tileCamera.bottom = -halfHeight;
    tileCamera.position.copy(state.target);
    tileCamera.position.y += 8192;
    tileCamera.lookAt(state.target);
    tileCamera.updateProjectionMatrix();
    tileCamera.updateMatrixWorld();
  };
  const animate = () => {
    if (!container.isConnected) {
      state.fieldCamera?.dispose();
      state.tileTool?.dispose();
      state.texturePreview.clear();
      clearGroup(group);
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(disposeMaterial);
      renderer.dispose();
      return;
    }
    resize();
    updateCamera();
    if (state.tileMode) updateTileCamera();
    state.tileTool?.update();
    state.onCameraUpdate?.();
    updateNpcMovementPreview(state, performance.now());
    if (state.texturePreview.update(performance.now())) state.onTextureFrame?.();
    renderer.render(scene, state.tileMode ? tileCamera : camera);
    state.animationId = window.requestAnimationFrame(animate);
  };

  renderer.domElement.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.dragMode = state.tileMode || event.shiftKey ? "pan" : "rotate";
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
    if (state.dragging && state.onWarpTilePick && event.button === 0 && !event.shiftKey && moved < 4) {
      state.onWarpTilePick(state.tileTool?.pickTile(event.clientX, event.clientY));
    } else if (state.dragging && state.dragMode === "rotate" && moved < 4 && state.currentData && state.onPlacePick) {
      const rect = state.renderer.domElement.getBoundingClientRect();
      state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      state.raycaster.setFromCamera(state.pointer, state.camera);
      const terrain: THREE.Object3D[] = [];
      state.terrainGroup.traverseVisible((object) => { if (object instanceof THREE.Mesh) terrain.push(object); });
      state.onPlacePick(state.raycaster.intersectObjects(terrain, false)[0]?.point);
    } else if (state.dragging && state.dragMode === "rotate" && moved < 4 && state.currentData) {
      if (state.permissionGroup.visible && state.permissionPicking) pickPermissionTile(state, event);
      else {
        const rect = state.renderer.domElement.getBoundingClientRect();
        state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        state.raycaster.setFromCamera(state.pointer, state.camera);
        state.onBuildingPick?.(pickMap3dBuilding(state.raycaster, state.buildingGroup, state.terrainGroup));
      }
    }
    state.dragging = false;
  });
  renderer.domElement.addEventListener("pointercancel", () => { state.dragging = false; });
  renderer.domElement.addEventListener("contextmenu", event => { if (state.tileMode) event.preventDefault(); });
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const clampedDelta = Math.max(-80, Math.min(80, event.deltaY));
      state.distance = Math.min(12000, Math.max(16, state.distance * Math.exp(clampedDelta * 0.0018)));
    },
    { passive: false },
  );
  renderer.domElement.tabIndex = 0;
  renderer.domElement.addEventListener("pointerdown", () => renderer.domElement.focus());
  renderer.domElement.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const panStep = Math.max(16, state.distance * 0.035);
    const forward = new THREE.Vector3(0, 0, -1);
    if (!state.tileMode) camera.getWorldDirection(forward);
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
  if (state.tileMode) {
    const unitsPerPixel = 2 * state.tileCamera.top / Math.max(1, state.renderer.domElement.clientHeight);
    state.target.x -= dx * unitsPerPixel;
    state.target.z -= dy * unitsPerPixel;
    return;
  }
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
  state.texturePreview.clear();
  state.currentData = data;
  state.selectedPermission = undefined;
  state.selectedBuildingIndex = undefined;
  state.isolateBuilding = false;
  state.hideOtherBuildings = false;
  clearGroup(state.buildingSelectionGroup);
  clearGroup(state.terrainGroup);
  clearGroup(state.neighboringSceneryGroup);
  clearGroup(state.buildingGroup);
  clearGroup(state.buildingBoundsGroup);
  clearGroup(state.npcGroup);
  clearGroup(state.overlayGroup);
  clearGroup(state.permissionGroup);
  state.npcMovementActors = [];
  const textureCache = new Map<string, THREE.Texture>();

  for (const chunk of data.chunks) {
    const chunkGroup = new THREE.Group();
    chunkGroup.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
    addPrimitivesToGroup(chunkGroup, chunk.primitives, textureCache, state.texturePreview);
    state.terrainGroup.add(chunkGroup);
  }
  renderBuildingPlacements(state, data, textureCache);
  // Context has its own group: it is not pickable, editable, or exported as part
  // of this header's terrain/building arrays.
  for (const chunk of data.neighboringScenery?.chunks ?? []) {
    const group = new THREE.Group();
    group.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
    addPrimitivesToGroup(group, chunk.primitives, textureCache, state.texturePreview);
    state.neighboringSceneryGroup.add(group);
  }
  for (const building of data.neighboringScenery?.buildings ?? []) {
    const group = new THREE.Group();
    group.position.set(building.worldX, building.worldY, building.worldZ);
    group.rotation.y = THREE.MathUtils.degToRad(building.rotationY);
    addPrimitivesToGroup(group, building.primitives, textureCache, state.texturePreview);
    state.neighboringSceneryGroup.add(group);
  }
  for (const npc of data.npcModels) {
    const npcGroup = new THREE.Group();
    const isSpriteNpc = npc.modelType === "sprite";
    const baseRotationY = isSpriteNpc ? 0 : npc.rotationY;
    npcGroup.position.set(npc.x, npc.y, npc.z);
    npcGroup.rotation.y = THREE.MathUtils.degToRad(baseRotationY);
    addPrimitivesToGroup(npcGroup, npc.primitives, textureCache);
    state.npcGroup.add(npcGroup);
    const spriteMaterial = isSpriteNpc ? firstMeshBasicMaterial(npcGroup) : undefined;
    const spriteTextures = npc.spriteFrames ? createNpcSpriteTextures(npc.spriteFrames, textureCache) : undefined;
    const initialDirection = directionFromGameDirection(npc.movement.initialDirection);
    state.npcMovementActors.push({
      group: npcGroup,
      baseX: npc.x,
      baseY: npc.y,
      baseZ: npc.z,
      baseRotationY,
      initialDirection,
      spriteMaterial,
      spriteTextures,
      program: deterministicNpcMovementProgram(npc),
    });
    setNpcActorDirection(state.npcMovementActors[state.npcMovementActors.length - 1]!, initialDirection, 0);
  }
  state.movementPreviewStartMs = performance.now();
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

function addPrimitivesToGroup(group: THREE.Group, primitives: Map3dSceneData["chunks"][number]["primitives"], textureCache: Map<string, THREE.Texture>, preview?: Map3dTexturePreview): void {
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
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    preview?.add(mesh, primitive, source => getTexture(textureCache, source, primitive.material));
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

function renderBuildingPlacements(state: RendererState, data: Map3dSceneData, textureCache = new Map<string, THREE.Texture>()): void {
  state.texturePreview.removeGroup(state.buildingGroup);
  clearGroup(state.buildingGroup);
  for (const [index, building] of data.buildings.entries()) {
    const group = new THREE.Group();
    group.userData.map3dBuildingIndex = index;
    group.position.set(building.worldX, building.worldY, building.worldZ);
    group.rotation.y = THREE.MathUtils.degToRad(building.rotationY);
    addPrimitivesToGroup(group, building.primitives, textureCache, state.texturePreview);
    state.buildingGroup.add(group);
  }
  refreshBuildingBounds(state, data);
}

function refreshBuildingBounds(state: RendererState, data: Map3dSceneData): void {
  clearGroup(state.buildingBoundsGroup);
  for (const [index, building] of data.buildings.entries()) {
    const bounds = createBuildingBoundsOverlay(building);
    if (!bounds) continue;
    bounds.userData.map3dBuildingIndex = index;
    state.buildingBoundsGroup.add(bounds);
  }
}

function applyLayerVisibility(state: RendererState, showBuildings: boolean, showBuildingBounds: boolean, showNpcs: boolean, showEntities: boolean, showPermissions: boolean): void {
  state.neighboringSceneryGroup.visible = !state.isolateBuilding;
  const isolated = state.isolateBuilding && state.selectedBuildingIndex !== undefined;
  state.terrainGroup.visible = !isolated;
  state.grid.visible = !isolated;
  state.buildingGroup.visible = showBuildings || isolated;
  state.buildingBoundsGroup.visible = showBuildingBounds && !isolated;
  state.npcGroup.visible = showNpcs && !isolated;
  state.overlayGroup.visible = showEntities && !isolated;
  state.permissionGroup.visible = showPermissions && !isolated;
  const onlySelected = (isolated || state.hideOtherBuildings) && state.selectedBuildingIndex !== undefined;
  for (const [index, group] of state.buildingGroup.children.entries()) group.visible = !onlySelected || index === state.selectedBuildingIndex;
  for (const bounds of state.buildingBoundsGroup.children) bounds.visible = !onlySelected || bounds.userData.map3dBuildingIndex === state.selectedBuildingIndex;
  clearGroup(state.buildingSelectionGroup);
  const selected = state.selectedBuildingIndex === undefined ? undefined : state.buildingGroup.children[state.selectedBuildingIndex];
  if (selected && state.buildingGroup.visible) {
    const box = new THREE.Box3().setFromObject(selected);
    if (!box.isEmpty()) {
      const outline = new THREE.Box3Helper(box, 0x50f2ce);
      const materials = Array.isArray(outline.material) ? outline.material : [outline.material];
      for (const material of materials) {
        material.depthTest = false;
        material.depthWrite = false;
      }
      outline.renderOrder = 40;
      state.buildingSelectionGroup.add(outline);
    }
  }
}

function focusSelectedBuilding(state: RendererState): void {
  state.fieldCamera?.freeView();
  const selected = state.selectedBuildingIndex === undefined ? undefined : state.buildingGroup.children[state.selectedBuildingIndex];
  if (!selected) return;
  const box = new THREE.Box3().setFromObject(selected);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const halfFov = THREE.MathUtils.degToRad(state.camera.fov / 2);
  const limitingHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * state.camera.aspect));
  state.target.copy(sphere.center);
  state.distance = Math.max(24, sphere.radius / Math.sin(limitingHalfFov) * 1.3);
  state.yaw = Math.PI / 4;
  state.pitch = 0.65;
}

function setMovementPreview(state: RendererState, enabled: boolean): void {
  if (state.movementPreview === enabled) return;
  state.movementPreview = enabled;
  state.movementPreviewStartMs = performance.now();
  if (!enabled) resetNpcMovementActors(state);
}

function updateNpcMovementPreview(state: RendererState, nowMs: number): void {
  if (!state.movementPreview) return;
  const previewFrame = ((nowMs - state.movementPreviewStartMs) / 1000) * MOVEMENT_PREVIEW_FPS;
  for (const actor of state.npcMovementActors) {
    if (!actor.program) {
      resetNpcMovementActor(actor);
      continue;
    }
    applyNpcMovementProgram(actor, actor.program, previewFrame);
  }
}

function resetNpcMovementActors(state: RendererState): void {
  for (const actor of state.npcMovementActors) resetNpcMovementActor(actor);
}

function resetNpcMovementActor(actor: NpcMovementActor): void {
  actor.group.position.set(actor.baseX, actor.baseY, actor.baseZ);
  actor.group.rotation.y = THREE.MathUtils.degToRad(actor.baseRotationY);
  setNpcActorDirection(actor, actor.initialDirection, 0);
}

function applyNpcMovementProgram(actor: NpcMovementActor, program: NpcMovementProgram, previewFrame: number): void {
  if (program.totalFrames <= 0) {
    resetNpcMovementActor(actor);
    return;
  }
  let frame = previewFrame % program.totalFrames;
  if (frame < 0) frame += program.totalFrames;
  let completedX = 0;
  let completedZ = 0;
  for (const step of program.steps) {
    if (frame >= step.frames) {
      if (step.kind === "walk") {
        completedX += step.dx;
        completedZ += step.dz;
      }
      frame -= step.frames;
      continue;
    }
    if (step.kind === "walk") {
      const progress = Math.max(0, Math.min(1, frame / step.frames));
      actor.group.position.set(
        actor.baseX + (completedX + step.dx * progress) * MOVEMENT_PREVIEW_TILE_SIZE,
        actor.baseY,
        actor.baseZ + (completedZ + step.dz * progress) * MOVEMENT_PREVIEW_TILE_SIZE,
      );
      setNpcActorDirection(actor, step.direction, Math.floor(frame));
    } else {
      actor.group.position.set(actor.baseX + completedX * MOVEMENT_PREVIEW_TILE_SIZE, actor.baseY, actor.baseZ + completedZ * MOVEMENT_PREVIEW_TILE_SIZE);
      setNpcActorDirection(actor, step.direction, 0);
    }
    return;
  }
  resetNpcMovementActor(actor);
}

function setNpcActorDirection(actor: NpcMovementActor, direction: NpcPreviewDirection, walkFrame: number): void {
  if (actor.spriteMaterial && actor.spriteTextures) {
    const frames = actor.spriteTextures[direction] ?? actor.spriteTextures[actor.initialDirection] ?? firstNpcSpriteTextureFrames(actor.spriteTextures);
    const frameIndex = frames ? npcSpriteWalkFrameIndex(frames.length, walkFrame) : 0;
    const texture = frames?.[frameIndex] ?? frames?.[0];
    if (texture && actor.spriteMaterial.map !== texture) {
      actor.spriteMaterial.map = texture;
      actor.spriteMaterial.needsUpdate = true;
    }
    actor.group.rotation.y = 0;
    return;
  }
  actor.group.rotation.y = THREE.MathUtils.degToRad(rotationYForPreviewDirection(direction));
}

function createNpcSpriteTextures(
  spriteFrames: NonNullable<Map3dSceneData["npcModels"][number]["spriteFrames"]>,
  textureCache: Map<string, THREE.Texture>,
): Partial<Record<NpcPreviewDirection, THREE.Texture[]>> {
  const out: Partial<Record<NpcPreviewDirection, THREE.Texture[]>> = {};
  for (const direction of ["U", "D", "L", "R"] as const) {
    const frames = spriteFrames.framesByDirection[npcSpriteDirectionKey(direction)];
    if (!frames || frames.length === 0) continue;
    out[direction] = frames.map((frame) =>
      getTexture(textureCache, frame, {
        name: `npc_preview_${frame.name}`,
        diffuse: [1, 1, 1],
        alpha: 1,
      }),
    );
  }
  return out;
}

function firstMeshBasicMaterial(group: THREE.Group): THREE.MeshBasicMaterial | undefined {
  let found: THREE.MeshBasicMaterial | undefined;
  group.traverse((object) => {
    if (found) return;
    const material = (object as THREE.Mesh).material;
    const candidate = Array.isArray(material) ? material[0] : material;
    if (candidate instanceof THREE.MeshBasicMaterial) found = candidate;
  });
  return found;
}

function firstNpcSpriteTextureFrames(textures: Partial<Record<NpcPreviewDirection, THREE.Texture[]>>): THREE.Texture[] | undefined {
  return Object.values(textures).find((frames) => frames && frames.length > 0);
}

function npcSpriteWalkFrameIndex(frameCount: number, walkFrame: number): number {
  if (frameCount <= 1) return 0;
  const normalized = ((walkFrame % MOVEMENT_PREVIEW_WALK_FRAMES) + MOVEMENT_PREVIEW_WALK_FRAMES) % MOVEMENT_PREVIEW_WALK_FRAMES;
  const fourPhase = Math.floor(normalized / (MOVEMENT_PREVIEW_WALK_FRAMES / 4));
  if (frameCount === 2) return [0, 1, 0, 1][fourPhase] ?? 0;
  if (frameCount === 3) return [0, 1, 0, 2][fourPhase] ?? 0;
  return Math.floor((normalized / MOVEMENT_PREVIEW_WALK_FRAMES) * frameCount) % frameCount;
}

function deterministicNpcMovementProgram(npc: Map3dSceneData["npcModels"][number]): NpcMovementProgram | undefined {
  const code = npc.movement.moveCode;
  if (code === 18) return spinProgram(spinSequence("U", "ccw"));
  if (code === 19) return spinProgram(spinSequence("U", "cw"));
  if (code === 49) return spinProgram(reversingSpinSequence(directionFromGameDirection(npc.movement.initialDirection)));
  if (code === 20) return twoPointPatrolProgram(npc);
  const route = PATROL_ROUTES[code];
  return route ? walkProgram(route) : undefined;
}

function twoPointPatrolProgram(npc: Map3dSceneData["npcModels"][number]): NpcMovementProgram | undefined {
  const direction = directionFromGameDirection(npc.movement.initialDirection);
  const limit = movementLimitForDirection(npc, direction);
  const route = [...Array.from({ length: limit }, () => direction), ...Array.from({ length: limit }, () => oppositeDirection(direction))];
  return walkProgram(route);
}

function movementLimitForDirection(npc: Map3dSceneData["npcModels"][number], direction: NpcPreviewDirection): number {
  const leash = direction === "L" || direction === "R" ? npc.movement.horizontalLeash : npc.movement.verticalLeash;
  const fallback = npc.movement.modifierStepCount || 1;
  return Math.max(1, Math.min(16, Math.abs(leash || fallback)));
}

function walkProgram(route: NpcPreviewDirection[]): NpcMovementProgram | undefined {
  if (route.length === 0) return undefined;
  const steps = route.map((direction): NpcMovementStep => {
    const delta = deltaForPreviewDirection(direction);
    return { kind: "walk", direction, frames: MOVEMENT_PREVIEW_WALK_FRAMES, dx: delta.dx, dz: delta.dz };
  });
  return { kind: "walk", steps, totalFrames: steps.reduce((sum, step) => sum + step.frames, 0) };
}

function spinProgram(route: NpcPreviewDirection[]): NpcMovementProgram | undefined {
  if (route.length === 0) return undefined;
  const steps = route.map((direction): NpcMovementStep => ({ kind: "turn", direction, frames: MOVEMENT_PREVIEW_TURN_FRAMES }));
  return { kind: "spin", steps, totalFrames: steps.reduce((sum, step) => sum + step.frames, 0) };
}

function spinSequence(start: NpcPreviewDirection, hand: "cw" | "ccw"): NpcPreviewDirection[] {
  const order: NpcPreviewDirection[] = hand === "cw" ? ["U", "R", "D", "L"] : ["U", "L", "D", "R"];
  const index = Math.max(0, order.indexOf(start));
  return [...order.slice(index), ...order.slice(0, index)];
}

function reversingSpinSequence(start: NpcPreviewDirection): NpcPreviewDirection[] {
  const ccw = spinSequence(start, "ccw");
  const cw = spinSequence(start, "cw");
  return [...ccw, ...cw.slice(1)];
}

const PATROL_ROUTES: Record<number, NpcPreviewDirection[]> = {
  21: ["U", "R", "L", "D"],
  22: ["R", "L", "D", "U"],
  23: ["D", "U", "R", "L"],
  24: ["L", "D", "U", "R"],
  25: ["L", "R", "D", "U"],
  26: ["L", "R", "D", "U"],
  27: ["D", "U", "L", "R"],
  28: ["R", "D", "U", "L"],
  29: ["L", "U", "D", "R"],
  30: ["U", "D", "R", "L"],
  31: ["R", "L", "U", "D"],
  32: ["D", "R", "L", "U"],
  33: ["R", "U", "D", "L"],
  34: ["U", "D", "L", "R"],
  35: ["L", "R", "U", "D"],
  36: ["D", "L", "R", "U"],
  37: ["U", "L", "D", "R"],
  38: ["D", "R", "U", "L"],
  39: ["L", "D", "R", "U"],
  40: ["R", "U", "L", "D"],
  41: ["U", "R", "D", "L"],
  42: ["D", "L", "U", "R"],
  43: ["L", "U", "R", "D"],
  44: ["R", "D", "L", "U"],
};

function directionFromGameDirection(direction: number): NpcPreviewDirection {
  return ({ 1: "D", 2: "U", 3: "L", 4: "R" } as const)[direction] ?? "U";
}

function oppositeDirection(direction: NpcPreviewDirection): NpcPreviewDirection {
  return ({ U: "D", D: "U", L: "R", R: "L" } as const)[direction];
}

function deltaForPreviewDirection(direction: NpcPreviewDirection): { dx: number; dz: number } {
  return {
    U: { dx: 0, dz: -1 },
    D: { dx: 0, dz: 1 },
    L: { dx: -1, dz: 0 },
    R: { dx: 1, dz: 0 },
  }[direction];
}

function npcSpriteDirectionKey(direction: NpcPreviewDirection): "up" | "down" | "left" | "right" {
  return ({ U: "up", D: "down", L: "left", R: "right" } as const)[direction];
}

function rotationYForPreviewDirection(direction: NpcPreviewDirection): number {
  return { U: 0, D: 180, L: -90, R: 90 }[direction];
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

function readMap3dLayerSettings(project: ProjectState): Map3dLayerSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_MAP3D_LAYER_SETTINGS };
  try {
    const parsed = JSON.parse(localStorage.getItem(map3dLayerStorageKey(project)) ?? "null") as Partial<Record<keyof Map3dLayerSettings, unknown>> | null;
    return {
      showBuildings: booleanSetting(parsed?.showBuildings, DEFAULT_MAP3D_LAYER_SETTINGS.showBuildings),
      showBuildingBounds: booleanSetting(parsed?.showBuildingBounds, DEFAULT_MAP3D_LAYER_SETTINGS.showBuildingBounds),
      showNpcs: booleanSetting(parsed?.showNpcs, DEFAULT_MAP3D_LAYER_SETTINGS.showNpcs),
      showEntities: booleanSetting(parsed?.showEntities, DEFAULT_MAP3D_LAYER_SETTINGS.showEntities),
      showPermissions: booleanSetting(parsed?.showPermissions, DEFAULT_MAP3D_LAYER_SETTINGS.showPermissions),
      showMovementPreview: booleanSetting(parsed?.showMovementPreview, DEFAULT_MAP3D_LAYER_SETTINGS.showMovementPreview),
    };
  } catch {
    return { ...DEFAULT_MAP3D_LAYER_SETTINGS };
  }
}

function rememberMap3dLayerSettings(project: ProjectState, settings: Map3dLayerSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(map3dLayerStorageKey(project), JSON.stringify(settings));
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

function map3dViewStorageKey(project: ProjectState): string {
  return `${MAP3D_VIEW_STORAGE_KEY}.${project.session.baseVersion}`;
}

function map3dLayerStorageKey(project: ProjectState): string {
  return `${MAP3D_LAYER_STORAGE_KEY}.${project.session.baseVersion}`;
}

function isMap3dSeason(value: unknown): value is Map3dSeason {
  return value === "spring" || value === "summer" || value === "autumn" || value === "winter";
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function checkedAttr(value: boolean): string {
  return value ? "checked" : "";
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
  state.fieldCamera?.freeView();
  if (state.isolateBuilding) { focusSelectedBuilding(state); return; }
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
  state.fieldCamera?.freeView();
  const target = state.isolateBuilding && state.selectedBuildingIndex !== undefined
    ? state.buildingGroup.children[state.selectedBuildingIndex] ?? state.group : state.group;
  const box = new THREE.Box3().setFromObject(target);
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
  if (!state.tileMode) {
    state.yaw = 0;
    state.pitch = Math.PI / 2 - 0.001;
  }
}

function readStoredText(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function writeStoredText(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Browser storage is a convenience only. */ }
}
