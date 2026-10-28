import * as THREE from "three";
import { cameraBytesEqual, createCameraRectangle, decodeCameraRegions, encodeCameraRegions, evaluateFieldCamera, loadFieldCamera, saveFieldCamera,
  type CameraPose, type CameraRectangle, type CameraRegion, type FieldCameraDocument } from "../pokeweb/fieldCameraModel";
import { loadMap3dPlayerSprite, type Map3dSceneData, type Map3dNpcSpriteFrames } from "../pokeweb/map3dModel";
import { CAMERA_WALK_KEYS, cameraWalkStart, cameraWalkTileCenter, cameraWalkStep, type CameraWalkDirection } from "./map3dCameraWalk";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import type { MapCameraTestPosition } from '../pokeweb/mapCameraTest';

type CameraView = {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; terrainGroup: THREE.Group;
  target: THREE.Vector3; distance: number; yaw: number; pitch: number; cameraPose?: CameraPose;
};
type Mode = "navigate" | "move" | "draw" | "pick" | "walk";
type Drag = { start: THREE.Vector3; before: Uint8Array; index: number; rect: CameraRectangle; corner?: number; drawing?: boolean };
const num = (value: number) => String(Math.round(value * 10000) / 10000);
const input = (name: string, label: string, value: number, step = "any") => `<label class="map3d-field"><span>${label}</span><input class="filter-input" type="number" name="${name}" value="${num(value)}" step="${step}" required /></label>`;

export function cameraViewport(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const w = Math.min(width, height * 4 / 3), h = w * 3 / 4;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export class Map3dCameraEditor {
  private doc?: FieldCameraDocument;
  private data?: Map3dSceneData;
  private token = 0;
  private selected = -1;
  private active = true;
  private player?: THREE.Sprite;
  private playerTextures = new Map<CameraWalkDirection, THREE.Texture>();
  private playerFrames?: Map3dNpcSpriteFrames;
  private playerGender: "male" | "female" = "male";
  private facing: CameraWalkDirection = "down";
  private autoHeight = true;
  private lastWalkStep = 0;
  private mode: Mode = "navigate";
  private drag?: Drag;
  private undo: Uint8Array[] = [];
  private redo: Uint8Array[] = [];
  private overlay = new THREE.Group();
  private point = new THREE.Vector3();
  private pointSelected = false;
  private locationHud = document.createElement("div");
  private overlayHeight = 0;
  private visible = false;
  private error = "Load a map to inspect its camera.";
  private notice = "";
  private disposed = false;
  private listeners = new AbortController();
  private testing = false;

  constructor(private project: ProjectState, private host: HTMLElement, private state: CameraView, private onDirty?: () => void, private onTestInGame?: (position:MapCameraTestPosition)=>Promise<void>) {
    state.scene.add(this.overlay);
    this.overlay.name = "editor-camera-regions";
    const canvas = state.renderer.domElement, options = { capture: true, signal: this.listeners.signal };
    this.locationHud.className = "map3d-camera-location";
    this.locationHud.hidden = true;
    this.locationHud.setAttribute("aria-label", "Camera preview position");
    this.locationHud.innerHTML = `<strong data-camera-location-title></strong><span data-camera-location-coordinates role="status"></span><span data-camera-location-cell></span><span data-camera-location-help></span><button class="ow-tool" type="button">Locate on map</button>${onTestInGame?'<button class="ow-tool" data-camera-test type="button" disabled>Test in game</button>':''}`;
    const toolbar = canvas.closest(".map3d-view")?.querySelector(".map3d-toolbar");
    if (toolbar) toolbar.insertBefore(this.locationHud, toolbar.querySelector(".map3d-controls"));
    else canvas.parentElement?.append(this.locationHud);
    this.locationHud.querySelector("button")!.addEventListener("click", () => this.safe(() => {
      if (this.state.cameraPose) {
        this.leavePreview();
        this.state.target.copy(this.point); this.state.distance = 320;
        this.state.pitch = Math.PI / 2 - 0.001; this.state.yaw = 0;
        this.notice = "Selected camera tile highlighted in the overhead view.";
        this.drawOverlay(); this.render();
      } else {
        this.preview(); this.render(); canvas.focus({ preventScroll: true });
      }
    }));
    if(onTestInGame)this.locationHud.querySelector('[data-camera-test]')!.addEventListener('click',()=>{void this.testInGame();});
    canvas.addEventListener("pointerdown", this.pointerDown, options);
    canvas.addEventListener("pointermove", this.pointerMove, options);
    canvas.addEventListener("pointerup", this.pointerUp, options);
    canvas.addEventListener("pointercancel", this.pointerCancel, options);
    canvas.addEventListener("keydown", this.keyDown, options);
    canvas.addEventListener("wheel", this.leavePreview, { ...options, passive: true });
    this.render();
  }

  freeView(): void { this.leavePreview(); }
  private async testInGame():Promise<void>{
    if(!this.onTestInGame||this.testing||!this.active||!this.doc||!this.data||!this.state.cameraPose||!this.pointSelected)return;
    const token=this.token,position:MapCameraTestPosition={zoneId:this.doc.zoneId,tileX:Math.floor(this.point.x/16),tileZ:Math.floor(this.point.z/16),height:this.point.y,facing:this.facing};
    this.testing=true;this.updateLocation();
    try{await this.onTestInGame(position);if(token===this.token&&!this.disposed)this.notice='Continue, then press Down to warp.';}
    catch(error){if(token===this.token&&!this.disposed)this.notice=error instanceof Error?error.message:String(error);}
    finally{this.testing=false;if(!this.disposed){this.updateLocation();this.render();}}
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      const wasWalking = this.mode === "walk";
      this.cancelDrag(); this.mode = "navigate"; this.state.cameraPose = undefined;
      if (wasWalking) this.render();
      else { const control = this.host.querySelector<HTMLSelectElement>('[name="mode"]'); if (control) control.value = "navigate"; }
    }
    this.drawOverlay();
  }

  clear(): void {
    this.token++; this.cancelDrag(); this.clearPlayer(); this.doc = undefined; this.data = undefined; this.selected = -1;
    this.pointSelected = false;
    this.mode = "navigate"; this.state.cameraPose = undefined; this.error = "Loading map camera…"; this.notice = "";
    this.undo = []; this.redo = []; this.drawOverlay(); this.render();
  }

  async load(data: Map3dSceneData): Promise<void> {
    this.clear(); const token = this.token; this.data = data;
    if (data.matrixCell) { this.error = "This matrix cell has no owning header. Assign a zone before editing its camera."; this.render(); return; }
    try {
      const doc = await loadFieldCamera(this.project, data.zoneId);
      if (token !== this.token || this.disposed) return;
      this.doc = doc; this.loadPlayer(); this.error = ""; this.selected = doc.regions.length ? 0 : -1;
      const start = cameraWalkStart(data.chunks, (x, z) => this.groundHeight(x, z));
      this.point.set(start.x, start.y, start.z);
      const r = this.rectangle();
      this.overlayHeight = r ? this.terrainHeight((r.x + r.width / 2) * 16, (r.z + r.height / 2) * 16) ?? this.point.y : this.point.y;
      this.render(); this.drawOverlay();
    } catch (error) {
      if (token !== this.token || this.disposed) return;
      this.error = error instanceof Error ? error.message : String(error); this.render();
    }
  }

  dispose(): void {
    this.disposed = true; this.token++; this.listeners.abort(); this.clearPlayer(); this.clearOverlay(); this.overlay.removeFromParent();
    this.locationHud.closest(".map3d-view")?.classList.remove("map3d-camera-snapped"); this.locationHud.remove();
  }

  private editable() { return Boolean(this.doc); }
  private rectangle(): CameraRectangle | undefined {
    const r = this.doc?.regions[this.selected]; return r?.kind === "rectangle" ? r : undefined;
  }
  private field(name: string): HTMLInputElement | HTMLSelectElement { return this.host.querySelector(`[name="${name}"]`)!; }
  private number(name: string): number {
    const raw = this.field(name).value;
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) throw new Error(`${name} needs a number.`);
    return Number(raw);
  }
  private render(): void {
    if (!this.doc) {
      this.host.innerHTML = `<strong>Map camera · White 2</strong><div class="map3d-metadata-note" role="status">${escapeHtml(this.error)}</div>`;
      return;
    }
    const doc = this.doc, r = this.rectangle(), editable = this.editable(), editing = this.mode !== "walk";
    this.host.innerHTML = `<strong>Map camera · White 2</strong>
      <div class="map3d-metadata-note">Preset ${doc.presetId} · ${doc.regions.length} regions${doc.memberId === undefined ? "" : ` · Camera set ${doc.memberId}`}</div>
      ${editable && editing ? `<label class="map3d-toggle"><input name="visible" type="checkbox" ${this.visible ? "checked" : ""} /> Show camera regions</label>
      <label class="map3d-field"><span>Region, in game priority order</span><select name="region" class="filter-input"><option value="-1">Select a region</option>${doc.regions.map((region, i) => `<option value="${i}" ${i === this.selected ? "selected" : ""}>${i + 1}. ${region.kind === "rectangle" ? `${region.width} × ${region.height} at ${region.x}, ${region.z}` : `Unsupported shape ${region.type}`}</option>`).join("")}</select></label>` : ""}
      ${!doc.regions.length ? '<div class="map3d-metadata-note">No regions yet. Draw a rectangle or use Add rectangle to create one.</div>' : ""}
      ${doc.sharedZones.length > 1 ? `<div class="map3d-metadata-note">Shared by zones ${doc.sharedZones.join(", ")}. Saving creates an independent camera set for this zone.</div>` : ""}
      <label class="map3d-field"><span>Mouse tool · Shift-drag pans</span><select name="mode" class="filter-input">
        <option value="navigate" ${this.mode === "navigate" ? "selected" : ""}>Navigate</option>
        ${editable ? `<option value="move" ${this.mode === "move" ? "selected" : ""}>Select / move / resize region</option><option value="draw" ${this.mode === "draw" ? "selected" : ""}>Draw rectangle</option>` : ""}
        <option value="walk" ${this.mode === "walk" ? "selected" : ""}>Walk camera · click and arrow keys</option>
        <option value="pick" ${this.mode === "pick" ? "selected" : ""}>Pick camera coordinate</option></select></label>
      <div class="map3d-metadata-note">${this.mode === "walk" ? "Click a tile to snap immediately. Arrow keys move one tile in the map's north/south/east/west directions. Escape returns to free view." : this.mode === "move" ? "Drag inside a region to move it; drag a gold corner to resize. Release to save. Escape cancels the drag." : this.mode === "draw" ? "Drag over the map to create a rectangle. Release to save. Escape cancels the drag." : this.mode === "pick" ? "Click the terrain, then choose Snap camera." : "Choose a mouse tool to edit regions or pick a preview coordinate."}</div>
      ${editable && editing ? `<div class="map3d-camera-actions"><button class="ow-tool" data-action="add" type="button">Add rectangle</button><button class="ow-tool" data-action="delete" type="button" ${this.selected < 0 ? "disabled" : ""}>Delete</button></div>
      <div class="map3d-camera-actions"><button class="ow-tool" data-action="undo" type="button" ${!this.undo.length ? "disabled" : ""}>Undo camera edit</button><button class="ow-tool" data-action="redo" type="button" ${!this.redo.length ? "disabled" : ""}>Redo</button></div>` : ""}
      ${r && editing ? `<form data-camera-region><div class="map3d-meta-grid">
        ${input("x", "West (tile X)", r.x, "1")}${input("z", "North (tile Z)", r.z, "1")}${input("width", "Width (tiles)", r.width, "1")}${input("height", "Height (tiles)", r.height, "1")}
        </div><label class="map3d-field"><span>Interpolation direction</span><select name="axis" class="filter-input"><option value="z" ${r.axis === "z" ? "selected" : ""}>North → south</option><option value="x" ${r.axis === "x" ? "selected" : ""}>West → east</option></select></label>
        ${(["start", "end"] as const).map(key => `<details class="map3d-camera-endpoint"><summary>${key === "start" ? "Start camera" : "End camera"}</summary><div class="map3d-meta-grid">
        ${input(`${key}-pitch`, "Pitch (degrees)", r[key].pitch)}${input(`${key}-yaw`, "Yaw (degrees)", r[key].yaw)}${input(`${key}-distance`, "Distance (world units)", r[key].distance)}${input(`${key}-fov`, "Field of view (degrees)", r[key].fov)}
        ${input(`${key}-offset-x`, "Target offset X", r[key].offset.x)}${input(`${key}-offset-y`, "Target offset Y", r[key].offset.y)}${input(`${key}-offset-z`, "Target offset Z", r[key].offset.z)}</div></details>`).join("")}
        <details><summary>Native transition settings</summary><div class="map3d-meta-grid">${input("stay", "Stay function", r.stay, "1")}${input("enter", "Enter function", r.enter, "1")}${input("exit", "Exit function", r.exit, "1")}</div><label><input name="delay" type="checkbox" ${r.disableDelay ? "checked" : ""} /> Disable delay manager</label></details>
        <div class="map3d-camera-actions"><button class="ow-tool" type="submit">Apply region</button><button class="ow-tool" type="button" data-action="focus">Frame region</button></div>
        <div class="map3d-camera-actions"><button class="ow-tool" type="button" data-action="earlier" ${this.selected === 0 ? "disabled" : ""}>Higher priority</button><button class="ow-tool" type="button" data-action="later" ${this.selected === doc.regions.length - 1 ? "disabled" : ""}>Lower priority</button></div></form>` : ""}
      ${editing ? `<label class="map3d-field"><span>Region overlay height (world Y)</span><input name="overlay-height" class="filter-input" type="number" step="any" value="${num(this.overlayHeight)}" /></label>` : ""}
      ${this.mode === "walk" ? `<label class="map3d-toggle"><input name="auto-height" type="checkbox" ${this.autoHeight ? "checked" : ""} /> Follow terrain height</label>
      <label class="map3d-field"><span>Player billboard</span><select name="player-gender" class="filter-input"><option value="male" ${this.playerGender === "male" ? "selected" : ""}>Male player</option><option value="female" ${this.playerGender === "female" ? "selected" : ""}>Female player</option></select></label>
      <div class="map3d-metadata-note">Walk preview stays in the loaded zone and ignores collisions, events and warps. Turn off Follow terrain height to keep the entered player height.</div>` : ""}
      <strong>Snap to map camera</strong><div class="map3d-metadata-note">Snap camera shows the player and starts arrow-key walking. Click another terrain tile to move the preview there.</div><div class="map3d-meta-grid">${input("point-x", "Tile X", this.point.x / 16)}${input("point-z", "Tile Z", this.point.z / 16)}${input("point-y", "Player height (world Y)", this.point.y)}</div>
      <div class="map3d-camera-actions"><button class="ow-tool" type="button" data-action="preview">Snap camera</button><button class="ow-tool" type="button" data-action="free">Free view</button></div>
      <div class="map3d-metadata-note">Camera coordinates use the whole matrix: 32 tiles per chunk, 16 world units per tile. Region bounds ignore player height.</div>
      <div class="map3d-metadata-note">Map camera, framed at 4:3. Pick terrain to estimate player height, or enter it above. Script overrides, rails and transition timing are not simulated. A stationary pose has been checked in an emulator; exact screen framing is not guaranteed.</div>
      <div class="map3d-camera-status" role="status">${escapeHtml(this.notice)}</div>`;
    this.field("mode").addEventListener("change", () => {
      const mode = this.field("mode").value as Mode;
      this.leavePreview(); this.mode = mode;
      if (mode === "walk") this.notice = "Click a tile to begin walking the camera.";
      if (this.mode === "move" || this.mode === "draw") this.visible = true;
      this.render(); this.drawOverlay();
      const scroller = this.host.closest<HTMLElement>(".map3d-tab-panels"); if (scroller) scroller.scrollTop = 0;
    });
    this.host.querySelector('[name="auto-height"]')?.addEventListener("change", () => { this.autoHeight = (this.field("auto-height") as HTMLInputElement).checked; });
    this.host.querySelector('[name="player-gender"]')?.addEventListener("change", () => { this.playerGender = this.field("player-gender").value as "male" | "female"; this.loadPlayer(); this.updatePlayer(); });
    this.host.querySelector('[name="visible"]')?.addEventListener("change", () => { this.visible = (this.field("visible") as HTMLInputElement).checked; this.drawOverlay(); });
    this.host.querySelector('[name="region"]')?.addEventListener("change", () => { this.selected = Number(this.field("region").value); this.drawOverlay(); this.render(); });
    this.host.querySelector('[name="overlay-height"]')?.addEventListener("change", () => this.safe(() => { this.overlayHeight = this.number("overlay-height"); this.drawOverlay(); }));
    this.host.querySelector("form")?.addEventListener("submit", event => {
      event.preventDefault(); this.safe(() => {
        const before = encodeCameraRegions(doc.regions), selected = structuredClone(this.rectangle()!);
        for (const k of ["x", "z", "width", "height", "stay", "enter", "exit"] as const) selected[k] = this.number(k);
        selected.axis = this.field("axis").value as "x" | "z"; selected.disableDelay = (this.field("delay") as HTMLInputElement).checked;
        for (const key of ["start", "end"] as const) {
          for (const field of ["pitch", "yaw", "distance", "fov"] as const) selected[key][field] = this.number(`${key}-${field}`);
          for (const field of ["x", "y", "z"] as const) selected[key].offset[field] = this.number(`${key}-offset-${field}`);
        }
        const next = [...doc.regions]; next[this.selected] = selected; this.commit(next, before);
      });
    });
    this.host.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => button.addEventListener("click", () => this.safe(() => this.action(button.dataset.action!))));
  }

  private safe(fn: () => void): void {
    try { fn(); } catch (error) { this.notice = error instanceof Error ? error.message : String(error); const status = this.host.querySelector<HTMLElement>(".map3d-camera-status"); if (status) status.textContent = this.notice; }
  }
  private commit(next: CameraRegion[], before: Uint8Array, history = true): void {
    const doc = this.doc!;
    if (cameraBytesEqual(encodeCameraRegions(next), before)) { this.drawOverlay(); this.render(); return; }
    try {
      saveFieldCamera(this.project, doc, next);
    } catch (error) { doc.regions = decodeCameraRegions(doc.baseline); this.drawOverlay(); throw error; }
    if (history) { this.undo.push(before); if (this.undo.length > 50) this.undo.shift(); this.redo = []; }
    this.selected = Math.min(this.selected, doc.regions.length - 1);
    this.notice = "Camera regions saved to the project. Export ROM to play these changes.";
    this.onDirty?.(); this.drawOverlay(); this.render();
    if (this.state.cameraPose) this.preview();
  }
  private action(action: string): void {
    const doc = this.doc!;
    if (action === "free") { this.leavePreview(); this.render(); return; }
    if (action === "preview") {
      this.point.set(this.number("point-x") * 16, this.number("point-y"), this.number("point-z") * 16);
      this.preview(); this.render();
      const scroller = this.host.closest<HTMLElement>(".map3d-tab-panels"); if (scroller) scroller.scrollTop = 0;
      this.state.renderer.domElement.focus({ preventScroll: true }); return;
    }
    if (action === "focus") {
      this.leavePreview(); const r = this.rectangle()!;
      this.state.target.set((r.x + r.width / 2) * 16, this.overlayHeight, (r.z + r.height / 2) * 16);
      this.state.distance = Math.max(140, Math.max(r.width, r.height) * 24); this.visible = true; this.drawOverlay(); this.render(); return;
    }
    const before = encodeCameraRegions(doc.regions), next = structuredClone(doc.regions);
    if (action === "add") { next.push(createCameraRectangle(doc.preset, Math.max(0, Math.floor(this.point.x / 16)), Math.max(0, Math.floor(this.point.z / 16)))); this.selected = next.length - 1; this.visible = true; }
    if (action === "delete") next.splice(this.selected, 1);
    if (action === "earlier" || action === "later") {
      const other = this.selected + (action === "earlier" ? -1 : 1);
      [next[this.selected], next[other]] = [next[other], next[this.selected]]; this.selected = other;
    }
    if (action === "undo" || action === "redo") {
      const from = action === "undo" ? this.undo : this.redo, to = action === "undo" ? this.redo : this.undo;
      const snapshot = from.at(-1); if (!snapshot) return;
      this.commit(decodeCameraRegions(snapshot), before, false); from.pop(); to.push(before); this.render(); return;
    }
    this.commit(next, before);
  }

  private terrainHeight(x: number, z: number): number | undefined {
    this.state.terrainGroup.updateMatrixWorld(true);
    return new THREE.Raycaster(new THREE.Vector3(x, 100000, z), new THREE.Vector3(0, -1, 0)).intersectObject(this.state.terrainGroup, true)[0]?.point.y;
  }
  private groundHeight(x: number, z: number): number | undefined {
    this.state.terrainGroup.updateMatrixWorld(true);
    const hits = new THREE.Raycaster(new THREE.Vector3(x, 100000, z), new THREE.Vector3(0, -1, 0)).intersectObject(this.state.terrainGroup, true);
    return hits.find(hit => hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y >= 0.9)?.point.y;
  }
  private clearPlayer(): void {
    this.player?.removeFromParent(); this.player?.material.dispose(); this.player = undefined;
    this.playerTextures.forEach(texture => texture.dispose()); this.playerTextures.clear(); this.playerFrames = undefined;
  }
  private loadPlayer(): void {
    this.clearPlayer();
    if (!this.doc) return;
    try { this.playerFrames = loadMap3dPlayerSprite(this.project, this.doc.rom, this.playerGender); } catch { /* A damaged sprite must not prevent camera editing. */ }
    const frames = this.playerFrames; if (!frames) return;
    for (const direction of ["up", "down", "left", "right"] as const) {
      const frame = frames.framesByDirection[direction]?.[0]; if (!frame) continue;
      const texture = new THREE.DataTexture(frame.rgba, frame.width, frame.height, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.NearestFilter;
      texture.flipY = true; texture.needsUpdate = true; this.playerTextures.set(direction, texture);
    }
    this.player = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.05, depthTest: false, depthWrite: false }));
    this.player.center.set(0.5, 0); this.player.scale.set(frames.width, frames.height, 1); this.player.renderOrder = 104;
    this.player.name = "editor-camera-player"; this.state.scene.add(this.player); this.updatePlayer();
  }
  private updatePlayer(): void {
    if (!this.player) return;
    this.player.visible = this.active && this.mode === "walk" && this.pointSelected;
    this.player.position.copy(this.point); this.player.position.y += 0.2;
    this.player.material.map = this.playerTextures.get(this.facing) ?? this.playerTextures.values().next().value ?? null;
    this.player.material.needsUpdate = true;
  }
  private walkHeight(x: number, z: number, preferredY = this.point.y): number | undefined {
    this.state.terrainGroup.updateMatrixWorld(true);
    const hits = new THREE.Raycaster(new THREE.Vector3(x, 100000, z), new THREE.Vector3(0, -1, 0)).intersectObject(this.state.terrainGroup, true);
    return hits.reduce<number | undefined>((best, hit) => best === undefined || Math.abs(hit.point.y - preferredY) < Math.abs(best - preferredY) ? hit.point.y : best, undefined);
  }
  private preview(): void {
    const doc = this.doc!;
    const pose = evaluateFieldCamera(doc.preset, doc.regions, this.point, doc.boundaries);
    this.pointSelected = true;
    this.state.cameraPose = pose; this.mode = "walk";
    this.notice = `Map camera · ${pose.regionIndex === undefined ? `default preset ${doc.presetId}` : `region ${pose.regionIndex + 1}, ${num(pose.weight * 100)}%`} · 4:3${this.mode === "walk" ? ` · Tile ${Math.floor(this.point.x / 16)}, ${Math.floor(this.point.z / 16)} · Arrow keys to walk` : ""}`;
    this.drawOverlay();
  }
  private leavePreview = (): void => {
    if (this.state.cameraPose || this.mode === "walk") { this.state.cameraPose = undefined; this.mode = "navigate"; this.notice = "Free view"; this.drawOverlay(); this.render(); }
  };
  private ray(event: PointerEvent): THREE.Raycaster {
    const rect = this.state.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    const vp = this.state.cameraPose ? cameraViewport(rect.width, rect.height) : { x: 0, y: 0, width: rect.width, height: rect.height };
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left - vp.x) / vp.width * 2 - 1, -(event.clientY - rect.top - vp.y) / vp.height * 2 + 1), this.state.camera); return ray;
  }
  private planePoint(event: PointerEvent): THREE.Vector3 | undefined {
    return this.ray(event).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.overlayHeight), new THREE.Vector3()) ?? undefined;
  }
  private consume(event: PointerEvent) { event.preventDefault(); event.stopImmediatePropagation(); }
  private pointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) return;
    if (event.shiftKey) { this.leavePreview(); return; }
    if (this.doc && this.mode === "walk") {
      this.consume(event); this.state.renderer.domElement.focus({ preventScroll: true });
      const hit = this.ray(event).intersectObject(this.state.terrainGroup, true)[0]; if (!hit) return;
      const centered = cameraWalkTileCenter(hit.point);
      if (!this.data?.chunks.some(c => c.matrixX === Math.floor(centered.x / 512) && c.matrixY === Math.floor(centered.z / 512))) return;
      const height = this.walkHeight(centered.x, centered.z, hit.point.y) ?? hit.point.y;
      this.safe(() => {
        this.point.set(centered.x, this.autoHeight ? height : this.number("point-y"), centered.z);
        this.preview(); this.render();
      }); return;
    }
    if (this.state.cameraPose) { this.leavePreview(); return; }
    if (!this.doc || this.mode === "navigate") return;
    this.consume(event); const p = this.planePoint(event); if (!p) return;
    if (this.mode === "pick") {
      const hit = this.ray(event).intersectObject(this.state.terrainGroup, true)[0];
      this.point.copy(hit?.point ?? p); this.pointSelected = true; this.mode = "navigate"; this.notice = "Coordinate selected. Snap camera to preview it."; this.drawOverlay(); this.render(); return;
    }
    const doc = this.doc, before = encodeCameraRegions(doc.regions);
    if (this.mode === "draw") {
      const r = createCameraRectangle(doc.preset, Math.max(0, Math.floor(p.x / 16)), Math.max(0, Math.floor(p.z / 16)));
      doc.regions.push(r); this.selected = doc.regions.length - 1;
      this.drag = { start: p, before, index: this.selected, rect: structuredClone(r), drawing: true };
    } else {
      const handles = this.ray(event).intersectObjects(this.overlay.children, true).find(hit => hit.object.userData.corner !== undefined);
      if (handles && this.rectangle()) {
        this.drag = { start: p, before, index: this.selected, rect: structuredClone(this.rectangle()!), corner: handles.object.userData.corner };
      } else {
        this.selected = doc.regions.findIndex(r => r.kind === "rectangle" && p.x >= r.x * 16 && p.x < (r.x + r.width) * 16 && p.z >= r.z * 16 && p.z < (r.z + r.height) * 16);
        if (this.rectangle()) this.drag = { start: p, before, index: this.selected, rect: structuredClone(this.rectangle()!) };
      }
    }
    this.state.renderer.domElement.setPointerCapture(event.pointerId); this.drawOverlay(); this.render();
  };
  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || !this.doc) return;
    this.consume(event); const p = this.planePoint(event); if (!p) return;
    const d = this.drag, r = this.doc.regions[d.index] as CameraRectangle;
    const dx = Math.round((p.x - d.start.x) / 16), dz = Math.round((p.z - d.start.z) / 16);
    if (d.drawing) {
      const x = Math.max(0, Math.floor(p.x / 16)), z = Math.max(0, Math.floor(p.z / 16));
      r.x = Math.min(d.rect.x, x); r.z = Math.min(d.rect.z, z); r.width = Math.max(2, Math.abs(d.rect.x - x) + 1); r.height = Math.abs(d.rect.z - z) + 1;
    } else if (d.corner !== undefined) {
      const west = d.corner === 0 || d.corner === 3, north = d.corner < 2, minWidth = r.axis === "z" ? 2 : 1;
      const left = west ? Math.max(0, Math.min(d.rect.x + dx, d.rect.x + d.rect.width - minWidth)) : d.rect.x;
      const top = north ? Math.max(0, Math.min(d.rect.z + dz, d.rect.z + d.rect.height - 1)) : d.rect.z;
      const right = west ? d.rect.x + d.rect.width : Math.max(d.rect.x + minWidth, d.rect.x + d.rect.width + dx);
      const bottom = north ? d.rect.z + d.rect.height : Math.max(d.rect.z + 1, d.rect.z + d.rect.height + dz);
      Object.assign(r, { x: left, z: top, width: right - left, height: bottom - top });
    } else { r.x = Math.max(0, d.rect.x + dx); r.z = Math.max(0, d.rect.z + dz); }
    this.drawOverlay();
  };
  private pointerUp = (event: PointerEvent): void => {
    if (!this.drag || !this.doc) return;
    this.consume(event); const drag = this.drag; this.drag = undefined;
    if (this.state.renderer.domElement.hasPointerCapture(event.pointerId)) this.state.renderer.domElement.releasePointerCapture(event.pointerId);
    this.safe(() => this.commit(this.doc!.regions, drag.before));
  };
  private cancelDrag(): void {
    if (this.drag && this.doc) this.doc.regions = decodeCameraRegions(this.drag.before);
    this.drag = undefined;
  }
  private pointerCancel = (): void => { this.cancelDrag(); this.drawOverlay(); this.render(); };
  private keyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if ((this.mode === "walk" || this.state.cameraPose) && CAMERA_WALK_KEYS[event.key] && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat && performance.now() - this.lastWalkStep < 100) return;
      this.lastWalkStep = performance.now();
      const next = cameraWalkStep(this.point, event.key, this.data?.chunks ?? []);
      if (!next) { this.notice = "The next tile is outside the loaded zone."; this.render(); return; }
      this.safe(() => {
        const height = this.autoHeight ? this.walkHeight(next.x, next.z) : this.number("point-y");
        if (height === undefined) { this.notice = "No loaded terrain at the next tile."; this.render(); return; }
        this.point.set(next.x, height, next.z); this.facing = next.direction;
        this.preview(); this.render();
      }); return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) this.leavePreview();
    if (event.key === "Escape") { this.cancelDrag(); this.mode = "navigate"; this.leavePreview(); this.drawOverlay(); this.render(); }
  };
  private clearOverlay(): void {
    this.overlay.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose()); }
    });
    this.overlay.clear();
  }
  private drawOverlay(): void {
    this.clearOverlay(); this.overlay.visible = this.active; this.updatePlayer(); this.updateLocation();
    if (!this.active || !this.doc) return;
    if (this.visible && !this.state.cameraPose) this.doc.regions.forEach((r, i) => {
      if (r.kind !== "rectangle") return;
      const selected = i === this.selected, color = selected ? 0xffcc5c : 0x46d7dd;
      const corners = [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.height], [r.x, r.z + r.height]];
      const points = corners.map(([x, z]) => new THREE.Vector3(x * 16, this.overlayHeight + 0.6, z * 16));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false })); line.renderOrder = 100; this.overlay.add(line);
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(r.width * 16, r.height * 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.2 : 0.09, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.set((r.x + r.width / 2) * 16, this.overlayHeight + 0.5, (r.z + r.height / 2) * 16); fill.renderOrder = 99; this.overlay.add(fill);
      if (selected) points.forEach((p, corner) => {
        const handle = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false }));
        handle.position.copy(p); handle.userData.corner = corner; handle.renderOrder = 101; this.overlay.add(handle);
      });
    });
    if (!this.pointSelected) return;
    const x = Math.floor(this.point.x / 16) * 16, z = Math.floor(this.point.z / 16) * 16, y = this.point.y + 0.5;
    const points = [[x, z], [x + 16, z], [x + 16, z + 16], [x, z + 16]].map(([px, pz]) => new THREE.Vector3(px, y, pz));
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x65efff, transparent: true, depthTest: false, depthWrite: false }));
    outline.name = "editor-camera-selected-tile"; outline.renderOrder = 102; this.overlay.add(outline);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ color: 0x65efff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(x + 8, y, z + 8); fill.renderOrder = 102; this.overlay.add(fill);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.5, 5.5, 32), new THREE.MeshBasicMaterial({ color: 0xffd45c, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(this.point.x, y + 0.1, this.point.z); ring.renderOrder = 103; this.overlay.add(ring);
  }
  private updateLocation(): void {
    const test=this.onTestInGame?this.locationHud.querySelector<HTMLButtonElement>('[data-camera-test]'):undefined;
    if(test){test.disabled=this.testing||!this.active||!this.doc||!this.pointSelected||!this.state.cameraPose;test.textContent=this.testing?'Preparing test…':'Test in game';test.title=this.state.cameraPose?'Continue the bundled save, then press Down.':'Snap camera to select the test destination.';}
    this.locationHud.closest(".map3d-view")?.classList.toggle("map3d-camera-snapped", Boolean(this.active && this.state.cameraPose));
    this.locationHud.hidden = !this.active || !this.doc || !this.pointSelected;
    if (this.locationHud.hidden) return;
    const tileX = Math.floor(this.point.x / 16), tileZ = Math.floor(this.point.z / 16);
    const cellX = Math.floor(tileX / 32), cellZ = Math.floor(tileZ / 32);
    this.locationHud.querySelector("[data-camera-location-title]")!.textContent = this.state.cameraPose ? "Walk camera · Snapped position" : "Selected position";
    this.locationHud.querySelector("[data-camera-location-coordinates]")!.textContent = `Tile X ${tileX} · Z ${tileZ} · Height ${num(this.point.y)}`;
    this.locationHud.querySelector("[data-camera-location-cell]")!.textContent = `Zone ${this.doc!.zoneId} · Chunk ${cellX}, ${cellZ} · Local ${tileX - cellX * 32}, ${tileZ - cellZ * 32}`;
    this.locationHud.querySelector("[data-camera-location-help]")!.textContent = this.state.cameraPose ? "Arrow keys: walk · Esc: free view" : "Return to camera to continue walking.";
    this.locationHud.querySelector("button")!.textContent = this.state.cameraPose ? "Locate on map" : "Return to camera";
  }
}
