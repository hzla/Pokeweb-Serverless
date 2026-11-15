import * as THREE from "three";
import type { DecodedTexture, Map3dPrimitive } from "../pokeweb/map3dModel";
import { addPrimitivesToGroup, clearGroup } from "./overworldMapRenderer";

const SIZE = 144;

/** Still renders of brush art for the paint palette. One WebGL context, created on first use. */
export function createBrushThumbnailRenderer() {
  let renderer: THREE.WebGLRenderer | undefined;
  return {
    /** Draw native art from a three-quarter view, framed to its bounds, on a transparent background. */
    render(primitives: readonly Map3dPrimitive[], view: "tree" | "ledge"): string {
      renderer ??= new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SIZE, SIZE, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene(), group = new THREE.Group(), cache = new Map<string, THREE.DataTexture>();
      scene.add(group);
      try {
        addPrimitivesToGroup(group, [...primitives], cache, "textured");
        // Frame only the drawn faces: the clipped primitives still carry the whole donor map's vertex buffers.
        const box = new THREE.Box3(), point = new THREE.Vector3();
        for (const { positions, indices } of primitives) for (const index of indices) box.expandByPoint(point.fromArray(positions, index * 3));
        const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        const camera = new THREE.PerspectiveCamera(24, 1, 1, 4000);
        const radius = Math.max(size.x, size.y, size.z) * (view === "ledge" ? 0.62 : 0.82);
        const distance = radius / Math.tan(THREE.MathUtils.degToRad(12));
        const elevation = THREE.MathUtils.degToRad(view === "ledge" ? 48 : 22), heading = THREE.MathUtils.degToRad(view === "ledge" ? 30 : 0);
        camera.position.set(center.x + Math.sin(heading) * Math.cos(elevation) * distance, center.y + Math.sin(elevation) * distance, center.z + Math.cos(heading) * Math.cos(elevation) * distance);
        camera.lookAt(center);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      } finally {
        clearGroup(group);
        for (const texture of cache.values()) texture.dispose();
      }
    },
    dispose() {
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = undefined;
    },
  };
}

/** The grass brush's layers drawn back to front, as the tile looks from above. */
export function grassSwatch(layers: readonly DecodedTexture[]): string {
  const scale = 6, canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16 * scale;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  layers.forEach(layer => {
    const image = new ImageData(new Uint8ClampedArray(layer.rgba), layer.width, layer.height);
    const tile = document.createElement("canvas");
    tile.width = layer.width;
    tile.height = layer.height;
    tile.getContext("2d")!.putImageData(image, 0, 0);
    context.drawImage(tile, 0, 0, 16 * scale, 16 * scale);
  });
  return canvas.toDataURL("image/png");
}
