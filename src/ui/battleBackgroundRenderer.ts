import * as THREE from "three";
import type { DecodedTexture, Map3dPrimitive } from "../pokeweb/map3dModel";
import type { BattleBackgroundScene } from "../pokeweb/battleBackgroundModel";

const BATTLE_CAMERA_POSITION = new THREE.Vector3(6.7, 6.7, 17.3);
const BATTLE_CAMERA_TARGET = new THREE.Vector3(0, 2.6, 0);

export type BattleBackgroundRenderer = {
  resetBattleCamera: () => void;
  fitModel: () => void;
  dispose: () => void;
};

export function mountBattleBackgroundRenderer(host: HTMLElement, data: BattleBackgroundScene): BattleBackgroundRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x202431, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-label", `Interactive 3D preview of battle background resource ${data.resourceId}`);
  renderer.domElement.tabIndex = 0;
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const textureCache = new Map<string, THREE.DataTexture>();
  for (const primitive of data.primitives) addPrimitive(group, primitive, textureCache);

  const camera = new THREE.PerspectiveCamera(26, 4 / 3, 0.25, 2048);
  const target = BATTLE_CAMERA_TARGET.clone();
  let yaw = 0;
  let pitch = 0;
  let distance = 1;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let disposed = false;

  const render = () => {
    if (!disposed) renderer.render(scene, camera);
  };

  const syncOrbitFromCamera = () => {
    const offset = camera.position.clone().sub(target);
    distance = Math.max(0.01, offset.length());
    yaw = Math.atan2(offset.x, offset.z);
    pitch = Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
  };

  const applyOrbit = () => {
    const cosPitch = Math.cos(pitch);
    camera.position.set(
      target.x + Math.sin(yaw) * cosPitch * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * cosPitch * distance,
    );
    camera.lookAt(target);
    render();
  };

  const resetBattleCamera = () => {
    target.copy(BATTLE_CAMERA_TARGET);
    camera.position.copy(BATTLE_CAMERA_POSITION);
    camera.near = 0.25;
    camera.far = 2048;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    syncOrbitFromCamera();
    render();
  };

  const fitModel = () => {
    const bounds = data.bounds;
    target.set(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    );
    const radius = Math.max(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
      bounds.maxZ - bounds.minZ,
      1,
    ) * 0.72;
    yaw = Math.PI / 4;
    pitch = Math.PI / 7;
    distance = radius * 1.9;
    camera.near = Math.max(0.1, distance / 1000);
    camera.far = Math.max(2048, distance * 8);
    camera.updateProjectionMatrix();
    applyOrbit();
  };

  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    yaw -= dx * 0.008;
    pitch = THREE.MathUtils.clamp(pitch + dy * 0.006, -Math.PI * 0.47, Math.PI * 0.47);
    applyOrbit();
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * 0.001), 0.5, 4000);
    applyOrbit();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "r" || event.key === "R") resetBattleCamera();
    if (event.key === "f" || event.key === "F") fitModel();
  };

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("keydown", onKeyDown);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const removalObserver = new MutationObserver(() => {
    if (!host.isConnected) dispose();
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resizeObserver.disconnect();
    removalObserver.disconnect();
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("keydown", onKeyDown);
    clearGroup(group);
    for (const texture of textureCache.values()) texture.dispose();
    renderer.dispose();
  };

  resetBattleCamera();
  resize();
  return { resetBattleCamera, fitModel, dispose };
}

function addPrimitive(group: THREE.Group, primitive: Map3dPrimitive, textureCache: Map<string, THREE.DataTexture>): void {
  if (primitive.indices.length === 0 || primitive.positions.length === 0) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
  if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
  if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
  if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
  const texture = primitive.material.texture ? getTexture(textureCache, primitive.material.texture, primitive.material) : undefined;
  const material = new THREE.MeshBasicMaterial({
    color: texture ? 0xffffff : new THREE.Color(...primitive.material.diffuse),
    vertexColors: Boolean(primitive.colors),
    transparent: primitive.material.alpha < 1 || Boolean(texture),
    opacity: primitive.material.alpha,
    alphaTest: texture ? 0.05 : 0,
    map: texture,
    side: THREE.DoubleSide,
    depthWrite: primitive.material.alpha >= 1,
  });
  group.add(new THREE.Mesh(geometry, material));
}

function getTexture(
  cache: Map<string, THREE.DataTexture>,
  data: DecodedTexture,
  material: Map3dPrimitive["material"],
): THREE.DataTexture {
  const key = `${data.name}:${material.repeatS ? 1 : 0}:${material.repeatT ? 1 : 0}:${material.flipS ? 1 : 0}:${material.flipT ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const texture = new THREE.DataTexture(data.rgba, data.width, data.height, THREE.RGBAFormat);
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
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
  }
}
