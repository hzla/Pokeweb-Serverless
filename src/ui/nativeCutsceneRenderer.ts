import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { nativeCameraPose, type NativeCameraPose } from "../pokeweb/nativeCameraTrack";
import { nativeSceneFade, nativeSceneProjection, type NativeCutsceneDocument, type compileNativeCutscene } from "../pokeweb/nativeCutsceneModel";
import type { DecodedTexture } from "../pokeweb/map3dModel";
import { mountNativeJointGizmo, type JointGizmoCallbacks } from './nativeJointGizmo';

export function mountNativeCutsceneRenderer(host: HTMLElement, document: NativeCutsceneDocument, data: ReturnType<typeof compileNativeCutscene>, onSeek: (frame: number) => void, joints:JointGizmoCallbacks={}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.domElement.setAttribute("aria-label", `Native cutscene ${document.definition.id} preview`); renderer.domElement.tabIndex = 0;
  const fade = window.document.createElement("div"); fade.className = "cutscene-fade";
  const bottomFade = fade.cloneNode() as HTMLElement;
  host.replaceChildren(renderer.domElement, fade, bottomFade);
  const scene = new THREE.Scene(), def = document.definition;
  const clear = def.clearColor, color = new THREE.Color((clear & 31) / 31, (clear >>> 5 & 31) / 31, (clear >>> 10 & 31) / 31);
  renderer.setClearColor(color);
  const native = new THREE.PerspectiveCamera(def.fov, def.aspect, def.near, def.far), free = native.clone();
  const controls = new OrbitControls(free, renderer.domElement); controls.enableDamping = false; controls.enabled = false;
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures = new Map<DecodedTexture, THREE.DataTexture>();
  const meshes: Array<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; primitive: typeof data.models[number]["primitives"][number]; translucentTexture: boolean }> = [];
  const textureFor = (image?: DecodedTexture) => {
    if (!image) return null;
    let texture = textures.get(image);
    if (!texture) {
      texture = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat);
      texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.needsUpdate = true; textures.set(image, texture);
    }
    return texture;
  };
  for (const model of data.models) for (const primitive of model.primitives) {
    const geometry = new THREE.BufferGeometry(), mat = primitive.material, attr = primitive.polygonAttributes, faces = attr >>> 6 & 3;
    for (const [name, array, size] of [["position", primitive.positions, 3], ["color", primitive.colors!, 3], ["uv", primitive.uvs!, 2]] as const) geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
    const translucentTexture = mat.texture?.rgba.some((n, i) => i % 4 === 3 && n > 0 && n < 255) ?? false, translucent = mat.alpha < 1 || translucentTexture;
    const material = new THREE.MeshBasicMaterial({ map: textureFor(mat.texture), vertexColors: true, opacity: mat.alpha, transparent: translucent, alphaTest: .001, side: faces === 3 ? THREE.DoubleSide : faces === 1 ? THREE.BackSide : THREE.FrontSide, depthWrite: !translucent || Boolean(attr & 1 << 11), toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = faces !== 0;
    scene.add(mesh); geometries.push(geometry); materials.push(material); meshes.push({ mesh, material, primitive, translucentTexture });
  }
  const pathGeometry = new THREE.BufferGeometry(), pathMaterial = new THREE.LineBasicMaterial({ color: 0xffd966, depthTest: false, transparent: true, opacity: .85 });
  const path = new THREE.Line(pathGeometry, pathMaterial); path.renderOrder = 100; scene.add(path);
  const pointsMaterial = new THREE.PointsMaterial({ color: 0xffd966, size: .35, depthTest: false });
  const points = new THREE.Points(pathGeometry, pointsMaterial); points.renderOrder = 101; scene.add(points);
  const markerGeometry = new THREE.SphereGeometry(.55, 12, 8), markerMaterial = new THREE.MeshBasicMaterial({ color: 0x4de3d2, depthTest: false });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial); marker.renderOrder = 102; scene.add(marker);
  const objectMarker = new THREE.Mesh(markerGeometry, markerMaterial); objectMarker.scale.setScalar(.6); objectMarker.renderOrder = 103; objectMarker.visible = false; scene.add(objectMarker);
  let selectedJoint: { model: number; node: number } | undefined;
  const visualCamera = native.clone(); visualCamera.near = .5; visualCamera.far = 12; visualCamera.updateProjectionMatrix();
  const helper = new THREE.CameraHelper(visualCamera); scene.add(helper);
  let sceneCamera = true, disposed = false, lastFrame = 0;
  const gizmo=mountNativeJointGizmo(renderer.domElement,scene,free,data.models,joints,()=>draw(lastFrame),dragging=>{controls.enabled=!sceneCamera&&!dragging;});
  const resize = new ResizeObserver(() => { if (!disposed) draw(lastFrame); }); resize.observe(host);
  function updatePath() {
    const positions = new Float32Array(document.camera.frameCount * 3);
    for (let frame = 0; frame < document.camera.frameCount; frame++) positions.set(nativeCameraPose(document.camera, frame).position, frame * 3);
    pathGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); pathGeometry.computeBoundingSphere();
  }
  updatePath();
  function draw(frame: number) {
    if (disposed) return;
    lastFrame = frame;
    const pose = nativeCameraPose(document.camera, frame);
    native.position.fromArray(pose.position); native.rotation.set(...pose.rotation.map(n => n * Math.PI / 180) as [number, number, number], "YXZ"); native.updateMatrixWorld();
    const projection = nativeSceneProjection(def, frame);
    native.fov = projection.fov;
    if (native.fov <= 0 || native.fov >= 179) native.fov = def.fov;
    native.updateProjectionMatrix();
    visualCamera.position.copy(native.position); visualCamera.quaternion.copy(native.quaternion); visualCamera.updateMatrixWorld(); helper.update(); marker.position.copy(native.position);
    path.visible = points.visible = marker.visible = helper.visible = !sceneCamera;
    const camera = sceneCamera ? native : free;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements, basis = [e[0], e[4], e[8], 0, e[1], e[5], e[9], 0, e[2], e[6], e[10], 0, 0, 0, 0, 1];
    data.sample(frame, basis);
    gizmo.sync(frame);
    const joint = selectedJoint && data.models[selectedJoint.model]?.jointPositions.subarray(selectedJoint.node * 3, selectedJoint.node * 3 + 3);
    objectMarker.visible = Boolean(joint?.length === 3); if (joint) objectMarker.position.fromArray(joint);
    for (const geometry of geometries) for (const key of ["position", "color", "uv"]) geometry.getAttribute(key).needsUpdate = true;
    for (const { mesh, material, primitive, translucentTexture } of meshes) {
      mesh.visible = primitive.visible !== false && Boolean(primitive.polygonAttributes >>> 6 & 3) && primitive.material.alpha > 0;
      material.opacity = primitive.material.alpha;
      const transparent = translucentTexture || material.opacity < 1;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.depthWrite = !transparent || Boolean(primitive.polygonAttributes & 1 << 11);
      const map = textureFor(primitive.material.texture);
      if (map) {
        const mat = primitive.material;
        map.wrapS = mat.repeatS ? mat.flipS ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        map.wrapT = mat.repeatT ? mat.flipT ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      }
      if (material.map !== map) { material.map = map; material.needsUpdate = true; }
    }
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false); renderer.setViewport(0, 0, width, height); renderer.setScissorTest(false); renderer.setClearColor(0x11151c); renderer.clear();
    if (sceneCamera) {
      const screens = def.dualScreen ? 2 : 1, gap = screens === 2 ? 12 : 0, w = Math.min(width, (height - gap) / screens * def.aspect), h = w / def.aspect, x = (width - w) / 2, top = (height - (h * screens + gap)) / 2;
      for (let screen = 0; screen < screens; screen++) {
        const cssY = top + screen * (h + gap), y = height - cssY - h, element = screen ? bottomFade : fade;
        native.updateProjectionMatrix();
        const offset = screen ? projection.bottomOffset : def.dualScreen ? projection.topOffset : 0;
        native.projectionMatrix.elements[9] += offset / def.ndc / (native.near * Math.tan(native.fov * Math.PI / 360)); native.projectionMatrixInverse.copy(native.projectionMatrix).invert();
        renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true); renderer.setClearColor(color); renderer.clear(); renderer.render(scene, native);
        const effect = nativeSceneFade(def, frame, screens === 1 ? 3 : screen === 0 ? 1 : 2, document.camera.frameCount); element.hidden = false; element.style.background = effect.color; element.style.opacity = String(effect.opacity);
        Object.assign(element.style, { left: `${x}px`, top: `${cssY}px`, width: `${w}px`, height: `${h}px` });
      }
      if (screens === 1) bottomFade.hidden = true;
    } else { free.aspect = width / height; free.updateProjectionMatrix(); renderer.setClearColor(color); renderer.render(scene, free); fade.hidden = bottomFade.hidden = true; }
  }
  controls.addEventListener("change", () => draw(lastFrame));
  let pointerStart = { x: 0, y: 0 };
  renderer.domElement.addEventListener("pointerdown", e => { pointerStart = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("click", e => {
    if (sceneCamera || Math.hypot(pointerStart.x - e.clientX, pointerStart.y - e.clientY) > 4) return;
    if(gizmo.pick(e.clientX,e.clientY))return;
    const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.params.Points!.threshold = .75;
    ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), free);
    const hit = ray.intersectObject(points)[0]; if (hit?.index !== undefined) onSeek(hit.index);
  });
  draw(0);
  return {
    draw, updatePath,
    selectJoint(model?: number, node = 0) {
      if (selectedJoint?.model === model && (model === undefined || selectedJoint?.node === node)) return;
      selectedJoint = model === undefined ? undefined : { model, node }; draw(lastFrame);
      gizmo.select(selectedJoint);draw(lastFrame);
    },
    setJointEditing(enabled:boolean,mode:'rotate'|'scale'='rotate'){gizmo.mode(mode);gizmo.setEnabled(enabled);draw(lastFrame);},
    jointPose(model:number,node:number){return data.models[model]?.jointPoses[node];},
    viewState(){return {position:free.position.toArray(),quaternion:free.quaternion.toArray(),target:controls.target.toArray(),near:free.near};},
    restoreView(view:{position:number[];quaternion:number[];target:number[];near:number}){free.position.fromArray(view.position);free.quaternion.fromArray(view.quaternion);free.near=view.near;controls.target.fromArray(view.target);controls.update();draw(lastFrame);},
    focusJoint(){
      if(!selectedJoint)return;
      const model=data.models[selectedJoint.model],position=new THREE.Vector3().fromArray(model.jointPositions,selectedJoint.node*3);
      // Native groups can contain actors scattered across the whole map. Frame
      // the chosen joint, rather than every unrelated actor in that resource.
      const radius=5;controls.target.copy(position).add(new THREE.Vector3(0,1.3,0));free.position.copy(controls.target).add(new THREE.Vector3(radius*.8,radius*.35,radius*1.4));free.near=.01;free.updateProjectionMatrix();controls.update();draw(lastFrame);
    },
    setSceneCamera(enabled: boolean) {
      if (!enabled && sceneCamera) {
        controls.target.copy(native.position); free.position.copy(native.position).add(new THREE.Vector3(60, 75, 90)); free.lookAt(controls.target); controls.update();
      }
      sceneCamera = enabled; controls.enabled = !enabled; draw(lastFrame);
    },
    capture(): NativeCameraPose {
      const rotation = new THREE.Euler().setFromQuaternion(free.quaternion, "YXZ");
      return { position: free.position.toArray(), rotation: [rotation.x, rotation.y, rotation.z].map(n => n * 180 / Math.PI) };
    },
    dispose() {
      disposed = true; resize.disconnect(); gizmo.dispose();controls.dispose(); helper.dispose(); pathGeometry.dispose(); pathMaterial.dispose(); pointsMaterial.dispose(); markerGeometry.dispose(); markerMaterial.dispose();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
