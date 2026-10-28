import * as THREE from "three";
import type { DecodedTexture, Map3dPrimitive } from "../pokeweb/map3dModel";
import type { BattleModelScene } from "../pokeweb/battleModelScene";
import type { BattleCameraPose } from "../pokeweb/battleCameraModel";
import type { BattleScenePlatform } from "../pokeweb/battleSceneModel";

const BATTLE_CAMERA_POSITION = new THREE.Vector3(6.7, 6.7, 17.3);
const BATTLE_CAMERA_TARGET = new THREE.Vector3(0, 2.6, 0);

export type BattleBackgroundRenderer = {
  resetBattleCamera: () => void;
  setBattleCamera: (pose: BattleCameraPose) => void;
  getCameraPose: () => BattleCameraPose;
  fitModel: () => void;
  dispose: () => void;
};

export type BattleModelThreeObject = {
  group: THREE.Group;
  dispose: () => void;
};

type BattleRendererOptions = { nativeColors?: boolean; platforms?: BattleScenePlatform[]; onInteract?: () => void; onPoseChange?: (pose: BattleCameraPose) => void };

export function createBattleSceneThreeObject(background: BattleModelScene, platforms: BattleScenePlatform[], options: { nativeColors?: boolean } = {}): BattleModelThreeObject {
  const group = new THREE.Group(), models = [createBattleModelThreeObject(background, options)];
  models[0].group.name = "Battle background";
  group.add(models[0].group);
  platforms.forEach((platform, side) => {
    const model = createBattleModelThreeObject(platform.model, options);
    model.group.name = side ? "Opponent platform" : "Player platform";
    model.group.position.set(platform.position.x, platform.position.y, platform.position.z);
    model.group.scale.setScalar(platform.scale);
    group.add(model.group); models.push(model);
  });
  return { group, dispose: () => { for (const model of models) model.dispose(); group.clear(); } };
}

export function createBattleModelThreeObject(data: Pick<BattleModelScene, "primitives">, options: { nativeColors?: boolean } = {}): BattleModelThreeObject {
  const group = new THREE.Group();
  const textureCache = new Map<string, THREE.DataTexture>();
  for (const primitive of data.primitives) addPrimitive(group, primitive, textureCache, Boolean(options.nativeColors));
  return {
    group,
    dispose: () => {
      clearGroup(group);
      for (const texture of textureCache.values()) texture.dispose();
    },
  };
}

export function mountBattleBackgroundRenderer(host: HTMLElement, data: BattleModelScene, options: BattleRendererOptions = {}): BattleBackgroundRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.outputColorSpace = options.nativeColors ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  renderer.setClearColor(options.nativeColors ? new THREE.Color(0x20 / 255, 0x24 / 255, 0x31 / 255) : 0x202431, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-label", `Interactive 3D preview of battle model resource ${data.resourceId}`);
  renderer.domElement.tabIndex = 0;
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const model = createBattleSceneThreeObject(data, options.platforms ?? [], options);
  if (options.platforms?.length) renderer.domElement.setAttribute("aria-label", "Battle scene with background, player platform and opponent platform");
  scene.add(model.group);

  const camera = new THREE.PerspectiveCamera(26, 4 / 3, 0.25, 2048);
  const target = BATTLE_CAMERA_TARGET.clone();
  let yaw = 0;
  let pitch = 0;
  let distance = 1;
  let dragging = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  let disposed = false;
  let battlePose: BattleCameraPose = {
    position: { x: BATTLE_CAMERA_POSITION.x, y: BATTLE_CAMERA_POSITION.y, z: BATTLE_CAMERA_POSITION.z },
    target: { x: BATTLE_CAMERA_TARGET.x, y: BATTLE_CAMERA_TARGET.y, z: BATTLE_CAMERA_TARGET.z },
  };

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
    options.onPoseChange?.({ position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { x: target.x, y: target.y, z: target.z } });
  };

  const resetBattleCamera = () => {
    target.set(battlePose.target.x, battlePose.target.y, battlePose.target.z);
    camera.position.set(battlePose.position.x, battlePose.position.y, battlePose.position.z);
    camera.near = 0.25;
    camera.far = 2048;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    syncOrbitFromCamera();
    render();
  };

  const fitModel = () => {
    const box = new THREE.Box3().setFromObject(model.group);
    const bounds = box.isEmpty() ? data.bounds : { minX: box.min.x, minY: box.min.y, minZ: box.min.z, maxX: box.max.x, maxY: box.max.y, maxZ: box.max.z };
    target.set(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    );
    yaw = Math.PI / 4;
    pitch = Math.PI / 7;
    const half = new THREE.Vector3(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ).multiplyScalar(.5);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
    const towardCamera = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanX = tanY * camera.aspect;
    distance = 1;
    for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
      const corner = new THREE.Vector3(x, y, z), depth = corner.dot(towardCamera);
      distance = Math.max(distance, depth + Math.abs(corner.dot(up)) / tanY, depth + Math.abs(corner.dot(right)) / tanX);
    }
    distance *= 1.08;
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
    options.onInteract?.();
    dragging = true;
    panning = event.shiftKey || event.button !== 0;
    renderer.domElement.focus({ preventScroll: true });
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
    if (panning) {
      const scale = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, host.clientHeight);
      target.addScaledVector(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), -dx * scale);
      target.addScaledVector(new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)), dy * scale);
    } else {
      yaw -= dx * 0.008;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.006, -Math.PI * 0.47, Math.PI * 0.47);
    }
    applyOrbit();
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    options.onInteract?.();
    distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * 0.001), 0.5, 4000);
    applyOrbit();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "r" || event.key === "R") resetBattleCamera();
    if (event.key === "f" || event.key === "F") { options.onInteract?.(); fitModel(); }
    const key = event.key.toLowerCase(), speed = Math.max(0.05, distance * (event.shiftKey ? 0.12 : 0.03));
    if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault(); event.stopPropagation(); options.onInteract?.();
      const forward = target.clone().sub(camera.position).normalize(), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      if (key === "w" || key === "arrowup") target.addScaledVector(forward, speed);
      if (key === "s" || key === "arrowdown") target.addScaledVector(forward, -speed);
      if (key === "a" || key === "arrowleft") target.addScaledVector(right, -speed);
      if (key === "d" || key === "arrowright") target.addScaledVector(right, speed);
      if (key === "q") target.y -= speed;
      if (key === "e") target.y += speed;
      applyOrbit();
    }
  };
  const onContextMenu = (event: Event) => event.preventDefault();

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("keydown", onKeyDown);
  renderer.domElement.addEventListener("contextmenu", onContextMenu);
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
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    model.dispose();
    renderer.dispose();
  };

  resetBattleCamera();
  resize();
  return {
    resetBattleCamera, fitModel, dispose,
    setBattleCamera: pose => { battlePose = structuredClone(pose); resetBattleCamera(); },
    getCameraPose: () => ({ position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { x: target.x, y: target.y, z: target.z } }),
  };
}

function addPrimitive(group: THREE.Group, primitive: Map3dPrimitive, textureCache: Map<string, THREE.DataTexture>, nativeColors: boolean): void {
  if (primitive.indices.length === 0 || primitive.positions.length === 0) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
  if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
  if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
  if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
  const texture = primitive.material.texture ? getTexture(textureCache, primitive.material.texture, primitive.material, nativeColors) : undefined;
  const material = new THREE.MeshBasicMaterial({
    color: texture ? 0xffffff : new THREE.Color(...primitive.material.diffuse),
    vertexColors: Boolean(primitive.colors),
    transparent: primitive.material.alpha < 1 || Boolean(texture),
    opacity: primitive.material.alpha,
    alphaTest: texture ? 0.05 : 0,
    map: texture ?? null,
    side: THREE.DoubleSide,
    depthWrite: primitive.material.alpha >= 1,
  });
  group.add(new THREE.Mesh(geometry, material));
}

function getTexture(
  cache: Map<string, THREE.DataTexture>,
  data: DecodedTexture,
  material: Map3dPrimitive["material"],
  nativeColors: boolean,
): THREE.DataTexture {
  const key = `${data.name}:${material.repeatS ? 1 : 0}:${material.repeatT ? 1 : 0}:${material.flipS ? 1 : 0}:${material.flipT ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const texture = new THREE.DataTexture(data.rgba, data.width, data.height, THREE.RGBAFormat);
  texture.colorSpace = nativeColors ? THREE.NoColorSpace : THREE.SRGBColorSpace;
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
