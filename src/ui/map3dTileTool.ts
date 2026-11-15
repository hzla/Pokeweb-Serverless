import * as THREE from "three";
import type { Map3dSceneData, Map3dTile } from "../pokeweb/map3dModel";

const TILE_SIZE = 16;
const CHUNK_TILES = 32;

type View = {
  scene: THREE.Scene;
  tileCamera: THREE.OrthographicCamera;
  tileMode: boolean;
  terrainGroup: THREE.Group;
  currentData?: Map3dSceneData;
};
type Hit = { x: number; z: number };
/** Brush footprint in tiles. Larger footprints are centred on the cursor and kept inside one chunk; a stroke reports each footprint's top-left tile. */
type Footprint = () => number | readonly [width: number, depth: number];
const dims = (footprint: Footprint): [number, number] => {
  const value = footprint();
  return typeof value === "number" ? [Math.max(1, value), Math.max(1, value)] : [Math.max(1, value[0]), Math.max(1, value[1])];
};
/** Line brushes draw one straight run of tiles from where the drag starts, along a row ("x"), a column ("z"), or whichever the drag mostly follows ("auto"). */
type LineAxis = () => "x" | "z" | "auto" | undefined;

export function installMap3dTileTool(
  canvas: HTMLCanvasElement, view: View, brushEnabled: () => boolean, onStroke: (tiles: Map3dTile[]) => void,
  onEscape: () => void, pickingDestination: () => boolean, footprint: Footprint = () => 1, lineAxis: LineAxis = () => undefined,
) {
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const overlay = new THREE.Group();
  overlay.visible = false;
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    color: 0xe1e8ed, opacity: .38, transparent: true, depthTest: false, depthWrite: false,
  }));
  grid.renderOrder = 41;

  const tileOutline = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(), new THREE.Vector3(TILE_SIZE, 0, 0),
    new THREE.Vector3(TILE_SIZE, 0, TILE_SIZE), new THREE.Vector3(0, 0, TILE_SIZE),
  ]);
  const hover = new THREE.Group();
  const hoverOutline = new THREE.LineLoop(tileOutline, new THREE.LineBasicMaterial({
    color: 0xf4ffbd, transparent: true, depthTest: false, depthWrite: false,
  }));
  hoverOutline.renderOrder = 44;
  const hoverFill = new THREE.Mesh(new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE), new THREE.MeshBasicMaterial({
    color: 0xb8f86b, opacity: .39, transparent: true, depthTest: false, depthWrite: false,
  }));
  hoverFill.rotation.x = -Math.PI / 2;
  hoverFill.position.set(TILE_SIZE / 2, 0, TILE_SIZE / 2);
  hoverFill.renderOrder = 43;
  hover.visible = false;
  hover.add(hoverOutline, hoverFill);

  const marks = new THREE.Group();
  const markMaterial = new THREE.LineBasicMaterial({
    color: 0xbafb92, transparent: true, depthTest: false, depthWrite: false,
  });
  overlay.add(grid, hover, marks);
  view.scene.add(overlay);

  let data: Map3dSceneData | undefined;
  const editableChunks = new Set<string>();
  let active: number | undefined, last: Hit | undefined, cursor: { x: number; y: number } | undefined;
  const tiles = new Map<string, Map3dTile>();
  const anchors: Hit[] = [];
  let lineStart: Hit | undefined;
  const listeners = new AbortController();
  const capture = { capture: true, signal: listeners.signal };

  function resetStroke() {
    const captured = active;
    active = undefined;
    if (captured !== undefined && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
    last = undefined;
    tiles.clear();
    anchors.length = 0;
    lineStart = undefined;
    marks.clear();
  }

  function updateGrid(next: Map3dSceneData) {
    const lines: number[] = [];
    editableChunks.clear();
    const span = TILE_SIZE * CHUNK_TILES;
    for (const { matrixX, matrixY, permissions } of next.chunks) {
      if (permissions?.width !== CHUNK_TILES || permissions.height !== CHUNK_TILES) continue;
      editableChunks.add(`${matrixX},${matrixY}`);
      const x0 = matrixX * span, z0 = matrixY * span;
      for (let step = 0; step <= span; step += TILE_SIZE) {
        lines.push(x0 + step, 0, z0, x0 + step, 0, z0 + span);
        lines.push(x0, 0, z0 + step, x0 + span, 0, z0 + step);
      }
    }
    grid.geometry.dispose();
    grid.geometry = new THREE.BufferGeometry();
    grid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    data = next;
  }

  function pick(at: { x: number; y: number }): Hit | undefined {
    const { left, top, width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    pointer.set((at.x - left) / width * 2 - 1, 1 - (at.y - top) / height * 2);
    if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return;
    ray.setFromCamera(pointer, view.tileCamera);
    // Orthographic rays point straight down, so every height projects to the
    // same tile. Picking and the overlay both use the native permission grid.
    const [spanX, spanZ] = dims(footprint), fx = ray.ray.origin.x / TILE_SIZE, fz = ray.ray.origin.z / TILE_SIZE;
    const x = Math.floor(fx), z = Math.floor(fz);
    if (!editableChunks.has(`${Math.floor(x / CHUNK_TILES)},${Math.floor(z / CHUNK_TILES)}`)) return;
    if (spanX === 1 && spanZ === 1) return { x, z };
    // Centre the footprint on the cursor, inside the chunk under it.
    const clamp = (value: number, tile: number, size: number) => {
      const start = Math.floor(tile / CHUNK_TILES) * CHUNK_TILES;
      if (size === 1) return tile;
      return Math.min(Math.max(Math.round(value - size / 2), start), start + CHUNK_TILES - size);
    };
    return { x: clamp(fx, x, spanX), z: clamp(fz, z, spanZ) };
  }

  function update() {
    const next = view.currentData;
    overlay.visible = view.tileMode && view.terrainGroup.visible && !!next;
    if (!overlay.visible || !next) return;
    if (data !== next) updateGrid(next);
    const highlighted = cursor && (brushEnabled() || pickingDestination()) ? pick(cursor) : undefined;
    hover.visible = !!highlighted;
    if (highlighted) {
      const [width, depth] = pickingDestination() ? [1, 1] : dims(footprint);
      hover.position.set(highlighted.x * TILE_SIZE, 0, highlighted.z * TILE_SIZE);
      hover.scale.set(width, 1, depth);
    }
  }

  function selection(x: number, z: number): Map3dTile {
    const matrixX = Math.floor(x / CHUNK_TILES), matrixY = Math.floor(z / CHUNK_TILES);
    return { matrixX, matrixY, tileX: x - matrixX * CHUNK_TILES, tileY: z - matrixY * CHUNK_TILES };
  }

  function add(x: number, z: number) {
    const key = `${x},${z}`, tile = selection(x, z);
    if (tiles.has(key) || !editableChunks.has(`${tile.matrixX},${tile.matrixY}`)) return;
    tiles.set(key, tile);
    const line = new THREE.LineLoop(tileOutline, markMaterial);
    line.position.set(x * TILE_SIZE, 0, z * TILE_SIZE);
    line.renderOrder = 42;
    marks.add(line);
  }

  /** Footprint brushes take each footprint the drag reaches that does not overlap one already in the stroke. */
  function addFootprint(hit: Hit, [width, depth]: [number, number]) {
    if (anchors.some(other => Math.abs(other.x - hit.x) < width && Math.abs(other.z - hit.z) < depth)) return;
    anchors.push(hit);
    const tile = selection(hit.x, hit.z);
    tiles.set(`${hit.x},${hit.z}`, tile);
    const line = new THREE.LineLoop(tileOutline, markMaterial);
    line.position.set(hit.x * TILE_SIZE, 0, hit.z * TILE_SIZE);
    line.scale.set(width, 1, depth);
    line.renderOrder = 42;
    marks.add(line);
  }

  /** Replace the stroke with the straight run from where it started to the cursor, kept inside the starting chunk. */
  function drawLine(hit: Hit, lineAxis: "x" | "z" | "auto") {
    lineStart ??= hit;
    const start = lineStart;
    // "auto" follows the drag's main direction.
    const axis = lineAxis !== "auto" ? lineAxis : Math.abs(hit.x - start.x) >= Math.abs(hit.z - start.z) ? "x" : "z";
    const chunk = Math.floor((axis === "x" ? start.x : start.z) / CHUNK_TILES) * CHUNK_TILES;
    const target = Math.min(Math.max(axis === "x" ? hit.x : hit.z, chunk), chunk + CHUNK_TILES - 1);
    const from = axis === "x" ? start.x : start.z;
    tiles.clear();
    marks.clear();
    for (let step = Math.min(from, target); step <= Math.max(from, target); step++) {
      if (axis === "x") add(step, start.z);
      else add(start.x, step);
    }
  }

  function sample() {
    const hit = cursor && pick(cursor);
    const axis = lineAxis();
    if (axis) {
      if (hit) drawLine(hit, axis);
      last = hit;
      return;
    }
    const size = dims(footprint);
    if (size[0] > 1 || size[1] > 1) {
      if (hit) addFootprint(hit, size);
      last = hit;
      return;
    }
    if (last && hit) {
      const dx = hit.x - last.x, dz = hit.z - last.z;
      const steps = Math.max(Math.abs(dx), Math.abs(dz));
      for (let i = 1; i < steps; i++) add(last.x + Math.round(dx * i / steps), last.z + Math.round(dz * i / steps));
    }
    if (hit) add(hit.x, hit.z);
    last = hit;
  }

  canvas.addEventListener("pointerenter", event => { cursor = { x: event.clientX, y: event.clientY }; }, capture);
  canvas.addEventListener("pointerleave", () => { cursor = undefined; }, capture);
  canvas.addEventListener("pointerdown", event => {
    if (!brushEnabled() || !event.isPrimary || event.button !== 0 || event.shiftKey) return;
    event.stopImmediatePropagation();
    canvas.focus({ preventScroll: true });
    active = event.pointerId;
    canvas.setPointerCapture(active);
    cursor = { x: event.clientX, y: event.clientY };
    sample();
  }, capture);
  canvas.addEventListener("pointermove", event => {
    if (!event.isPrimary) return;
    cursor = { x: event.clientX, y: event.clientY };
    if (event.pointerId !== active) return;
    event.stopImmediatePropagation();
    sample();
  }, capture);
  canvas.addEventListener("pointerup", event => {
    if (event.pointerId !== active) return;
    event.stopImmediatePropagation();
    cursor = event.pointerType === "touch" ? undefined : { x: event.clientX, y: event.clientY };
    if (cursor) sample();
    const stroke = [...tiles.values()];
    resetStroke();
    if (stroke.length && brushEnabled()) onStroke(stroke);
  }, capture);
  canvas.addEventListener("pointercancel", () => { cursor = undefined; resetStroke(); }, capture);
  canvas.addEventListener("lostpointercapture", event => { if (event.pointerId === active) resetStroke(); }, capture);
  canvas.addEventListener("keydown", event => {
    if (event.key === "Escape" && view.tileMode) onEscape();
  }, capture);

  return {
    pickTile(clientX: number, clientY: number) {
      const hit = pick({ x: clientX, y: clientY });
      return hit && selection(hit.x, hit.z);
    },
    update,
    reset: resetStroke,
    dispose() {
      listeners.abort();
      resetStroke();
      overlay.removeFromParent();
      grid.geometry.dispose();
      grid.material.dispose();
      tileOutline.dispose();
      hoverOutline.material.dispose();
      hoverFill.geometry.dispose();
      hoverFill.material.dispose();
      markMaterial.dispose();
    },
  };
}
