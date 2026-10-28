import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { findStudioAsset, type StudioWorkspace } from "../pokeweb/mapStudioFormats";
import { studioMeshes, type StudioMesh } from "../pokeweb/mapStudioModel";
import type { Map3dPrimitive } from "../pokeweb/map3dModel";

export class StudioViewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private content = new THREE.Group();
  private buildings = new THREE.Group();
  private buildingTextures = new Set<THREE.Texture>();
  private grid = new THREE.GridHelper(32, 32, 0x89999e, 0xb7c4c8);
  private textures = new Map<number, THREE.Texture>();
  private loading = new Map<number, Promise<void>>();
  private version = 0;
  private bitmaps: ImageBitmap[] = [];
  private thumbnailTarget?: THREE.WebGLRenderTarget;
  private frame = 0;
  private stopped = false;
  private resize: ResizeObserver;
  private ray = new THREE.Raycaster();
  private wire = false;
  private mode = "3d";
  private onChange = () => this.requestRender();
  constructor(private host: HTMLElement, private workspace: StudioWorkspace) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setClearColor(0x202432);
    this.renderer.domElement.className = "ms-map-canvas"; this.renderer.domElement.setAttribute("aria-label", "Map Studio terrain viewport"); this.host.append(this.renderer.domElement);
    this.scene.add(this.content, this.buildings, this.grid); this.grid.position.y = -0.025;
    this.camera = this.makeCamera(); this.controls = this.makeControls(); this.fit();
    this.resize = new ResizeObserver(() => this.size()); this.resize.observe(host); this.size();
  }
  get canvas() { return this.renderer.domElement; }
  private makeCamera() { return this.mode === "3d" ? new THREE.PerspectiveCamera(40, 1, 0.05, 2000) : new THREE.OrthographicCamera(-20, 20, 20, -20, 0.05, 2000); }
  private makeControls() {
    const controls = new OrbitControls(this.camera, this.canvas); controls.enableDamping = false; controls.enableRotate = this.mode === "3d";
    controls.mouseButtons = { LEFT: undefined as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.addEventListener("change", this.onChange); return controls;
  }
  setPan(pan: boolean) { this.controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : undefined as unknown as THREE.MOUSE; }
  async loadTextures(indices = studioMeshes(this.workspace, this.workspace.map.chunks[0]).map(m => m.material)) {
    await Promise.all([...new Set(indices)].map(index => {
      if (this.loading.has(index)) return this.loading.get(index);
      const task = (async () => {
        const material = this.workspace.tileset.materials[index];
      try {
        const path = findStudioAsset(this.workspace.files, this.workspace.tilesetPath, material.image);
        const image = await createImageBitmap(new Blob([this.workspace.files[path].slice().buffer]), { imageOrientation: "flipY" });
        if (this.stopped) { image.close(); return; }
        this.bitmaps.push(image); const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
        texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
        texture.wrapS = material.repeatU === 1 ? THREE.ClampToEdgeWrapping : material.repeatU === 2 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        texture.wrapT = material.repeatV === 1 ? THREE.ClampToEdgeWrapping : material.repeatV === 2 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        texture.needsUpdate = true; this.textures.set(index, texture);
      } catch { /* Missing local images are reported by the editor and block insertion. */ }
      })();
      this.loading.set(index, task); return task;
    }));
  }
  private group(meshes: StudioMesh[], wireframe = this.wire) {
    const group = new THREE.Group();
    for (const data of meshes) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs.map(v => Number.isFinite(v) ? v : 0), 2)); geometry.setAttribute("color", new THREE.Float32BufferAttribute(data.colors, 3)); geometry.setIndex(data.indices); geometry.computeVertexNormals();
      const source = this.workspace.tileset.materials[data.material], map = this.textures.get(data.material);
      const material = new THREE.MeshBasicMaterial({ map: map ?? null, color: map ? 0xffffff : 0xdb87c5, vertexColors: true, side: THREE.DoubleSide, wireframe, transparent: source.alpha < 31, opacity: source.alpha / 31, alphaTest: 0.01, polygonOffset: true, polygonOffsetFactor: 0.05 });
      group.add(new THREE.Mesh(geometry, material));
    }
    return group;
  }
  private disposeGroup(group: THREE.Group) { group.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); } }); group.clear(); }
  setBuildings(primitives: Map3dPrimitive[]) {
    this.disposeGroup(this.buildings); this.buildingTextures.forEach(t => t.dispose()); this.buildingTextures.clear();
    for (const p of primitives) {
      let map: THREE.DataTexture | undefined;
      if (p.material.texture) {
        const image = p.material.texture; map = new THREE.DataTexture(image.rgba, image.width, image.height); map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = p.material.repeatS ? p.material.flipS ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        map.wrapT = p.material.repeatT ? p.material.flipT ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.needsUpdate = true; this.buildingTextures.add(map);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(p.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(p.indices, 1));
      if (p.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(p.uvs, 2)); if (p.colors) geometry.setAttribute("color", new THREE.BufferAttribute(p.colors, 3));
      const material = new THREE.MeshBasicMaterial({ map: map ?? null, color: new THREE.Color(...p.material.diffuse), vertexColors: !!p.colors, side: THREE.DoubleSide, alphaTest: 0.01, transparent: p.material.alpha < 1, opacity: p.material.alpha, wireframe: this.wire });
      this.buildings.add(new THREE.Mesh(geometry, material));
    }
    this.requestRender();
  }
  update(chunkIndex: number, visible: boolean[]) {
    const version = ++this.version, meshes = studioMeshes(this.workspace, this.workspace.map.chunks[chunkIndex], visible);
    this.disposeGroup(this.content); this.content.add(this.group(meshes)); this.requestRender();
    if (meshes.some(m => !this.loading.has(m.material))) void this.loadTextures(meshes.map(m => m.material)).then(() => {
      if (this.stopped || version !== this.version) return;
      this.disposeGroup(this.content); this.content.add(this.group(meshes)); this.requestRender();
    });
  }
  setView(mode: string) {
    this.mode = mode; this.controls.dispose(); this.camera = this.makeCamera(); this.controls = this.makeControls(); this.fit(); this.size();
  }
  setGrid(show: boolean) { this.grid.visible = show; this.requestRender(); }
  setWire(show: boolean) { this.wire = show; this.content.traverse(obj => { if (obj instanceof THREE.Mesh) (obj.material as THREE.MeshBasicMaterial).wireframe = show; }); this.requestRender(); }
  fit() {
    this.camera.position.set(this.mode === "3d" ? 30 : 0, this.mode === "3d" ? 36 : 64, this.mode === "3d" ? 34 : 0.001);
    this.controls.target.set(0, 0, 0); this.camera.up.set(0, 1, 0); this.camera.zoom = 1; this.controls.update(); this.requestRender();
  }
  private size() {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight); this.renderer.setSize(width, height);
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = width / height;
    else { this.camera.left = -20 * width / height; this.camera.right = 20 * width / height; }
    this.camera.updateProjectionMatrix(); this.requestRender();
  }
  private requestRender() {
    if (this.stopped || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (!this.stopped) this.renderer.render(this.scene, this.camera); });
  }
  pick(clientX: number, clientY: number, height: number): { x: number; y: number } | undefined {
    const rect = this.canvas.getBoundingClientRect(); this.ray.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const point = this.ray.intersectObject(this.content, true)[0]?.point ?? this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3());
    if (!point) return; const x = Math.floor(point.x + 16), y = Math.floor(point.z + 16); return x >= 0 && x < 32 && y >= 0 && y < 32 ? { x, y } : undefined;
  }
  async thumbnail(tile: number, canvas: HTMLCanvasElement, projection: "top" | "3d" = "top") {
    if (this.stopped) return;
    const meshes = studioMeshes(this.workspace, this.workspace.map.chunks[0], undefined, tile); await this.loadTextures(meshes.map(m => m.material)); if (this.stopped) return;
    const group = this.group(meshes, false), bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()), span = Math.max(size.x, size.y, size.z, 1);
    const footprint = this.workspace.tileset.tiles[tile], topSpan = Math.max(footprint.width, footprint.height);
    const half = projection === "top" ? topSpan / 2 : span * 0.8;
    const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 10000);
    if (projection === "top") {
      // A shared footprint and north-up camera keep neighboring previews joined.
      const target = new THREE.Vector3(footprint.width / 2, center.y, footprint.height / 2);
      camera.up.set(0, 0, -1); camera.position.copy(target).add(new THREE.Vector3(0, Math.max(span, 1) * 3, 0)); camera.lookAt(target);
    } else { camera.position.copy(center).add(new THREE.Vector3(1, 1.6, 1.8).multiplyScalar(span * 3)); camera.lookAt(center); }
    const scene = new THREE.Scene(); scene.add(group);
    // Reuse the context without resizing or drawing over the terrain viewport.
    this.thumbnailTarget ??= new THREE.WebGLRenderTarget(canvas.width, canvas.height, { depthBuffer: true });
    this.thumbnailTarget.texture.colorSpace = THREE.SRGBColorSpace; this.thumbnailTarget.setSize(canvas.width, canvas.height);
    const previous = this.renderer.getRenderTarget(), pixels = new Uint8Array(canvas.width * canvas.height * 4);
    try { this.renderer.setRenderTarget(this.thumbnailTarget); this.renderer.render(scene, camera); this.renderer.readRenderTargetPixels(this.thumbnailTarget, 0, 0, canvas.width, canvas.height, pixels); }
    finally { this.renderer.setRenderTarget(previous); this.disposeGroup(group); }
    const output = new ImageData(canvas.width, canvas.height), row = canvas.width * 4;
    for (let y = 0; y < canvas.height; y++) output.data.set(pixels.subarray((canvas.height - 1 - y) * row, (canvas.height - y) * row), y * row);
    canvas.getContext("2d")?.putImageData(output, 0, 0);
    canvas.dataset.rendered = "true";
  }
  dispose() {
    this.stopped = true; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.controls.removeEventListener("change", this.onChange); this.controls.dispose();
    this.disposeGroup(this.content); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.textures.forEach(t => t.dispose()); this.textures.clear(); this.loading.clear(); this.bitmaps.forEach(b => b.close()); this.bitmaps = [];
    this.disposeGroup(this.buildings); this.buildingTextures.forEach(t => t.dispose()); this.buildingTextures.clear();
    this.thumbnailTarget?.dispose(); this.thumbnailTarget = undefined; this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
  }
}
