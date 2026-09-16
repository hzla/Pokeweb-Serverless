import * as THREE from "three";
import type { TitleScene } from "../pokeweb/titleScreenScene";
import { titleCameraFrame, type TitleCamera } from "../pokeweb/titleScreenModel";

/** Native 256×192 viewport, fixed to the title's recorded camera. No ROM edits. */
export function mountTitleSceneRenderer(host: HTMLElement, data: TitleScene, track: TitleCamera) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  // Nitro colors are already display values; don't add Three's sRGB lighting curve.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0xffffff); renderer.setPixelRatio(1); renderer.setSize(256, 192, false);
  renderer.domElement.setAttribute("aria-label", "Animated bottom title screen");
  host.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 4 / 3, .1, 2048);
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  for (const model of data.models) for (const primitive of model.primitives) {
    const geometry = new THREE.BufferGeometry(), pmat = primitive.material;
    geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors!, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs!, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
    let map: THREE.DataTexture | undefined;
    if (pmat.texture) {
      const image = pmat.texture;
      map = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat);
      map.magFilter = map.minFilter = THREE.NearestFilter;
      map.wrapS = pmat.repeatS ? pmat.flipS ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      map.wrapT = pmat.repeatT ? pmat.flipT ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      map.needsUpdate = true; textures.push(map);
    }
    const attr = primitive.polygonAttributes, faces = attr >>> 6 & 3;
    const translucentTexture = pmat.texture?.rgba.some((v, i) => i % 4 === 3 && v > 0 && v < 255) ?? false;
    const transparent = pmat.alpha < 1 || translucentTexture;
    const material = new THREE.MeshBasicMaterial({ map, vertexColors: true, color: 0xffffff, opacity: pmat.alpha, transparent, alphaTest: .001, side: faces === 3 ? THREE.DoubleSide : faces === 1 ? THREE.BackSide : THREE.FrontSide, depthWrite: !transparent || Boolean(attr & 1 << 11), toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = faces !== 0;
    scene.add(mesh); geometries.push(geometry); materials.push(material);
  }
  let disposed = false;
  return {
    draw(frame: number) {
      if (disposed) return;
      data.sample(frame);
      const values = titleCameraFrame(track, frame), [x, y, z] = values.rotation ?? [0, 0, 0];
      camera.position.fromArray(values.position ?? [0, 0, 60]);
      camera.rotation.set(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180, "YXZ");
      for (const geometry of geometries) for (const name of ["position", "color", "uv"]) geometry.getAttribute(name).needsUpdate = true;
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return; disposed = true;
      geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose()); renderer.dispose();
    },
  };
}
