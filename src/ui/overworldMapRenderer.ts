import * as THREE from "three";
import type { DecodedTexture, Map3dPrimitive, Map3dSceneData } from "../pokeweb/map3dModel";

export const OVERWORLD_MAP_UNITS_PER_TILE = 16;

const TARGET_PIXELS_PER_TILE = 16;
const MAX_RENDER_DIMENSION = 2048;
const FALLBACK_RENDER_DIMENSIONS = [1536, 1024] as const;
const CLEAR_COLOR: [number, number, number] = [40, 42, 54];

export type OverworldMapWorldBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  width: number;
  height: number;
};

export type OverworldMapRender = {
  canvas: HTMLCanvasElement;
  worldBounds: OverworldMapWorldBounds;
  worldOrigin: { x: number; z: number };
  unitsPerTile: typeof OVERWORLD_MAP_UNITS_PER_TILE;
  warnings: string[];
};

export type OverworldMapTilePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverworldMapRenderSize = {
  width: number;
  height: number;
  pixelScale: number;
};

type OverworldMapRenderStyle = "textured" | "solid";

export function getOverworldMapWorldBounds(data: Pick<Map3dSceneData, "chunks" | "chunkSpan">): OverworldMapWorldBounds {
  if (data.chunks.length === 0) throw new Error("Map has no renderable chunks");
  const minMatrixX = Math.min(...data.chunks.map((chunk) => chunk.matrixX));
  const minMatrixY = Math.min(...data.chunks.map((chunk) => chunk.matrixY));
  const maxMatrixX = Math.max(...data.chunks.map((chunk) => chunk.matrixX)) + 1;
  const maxMatrixY = Math.max(...data.chunks.map((chunk) => chunk.matrixY)) + 1;
  const minX = minMatrixX * data.chunkSpan;
  const minZ = minMatrixY * data.chunkSpan;
  const maxX = maxMatrixX * data.chunkSpan;
  const maxZ = maxMatrixY * data.chunkSpan;
  return {
    minX,
    minZ,
    maxX,
    maxZ,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxZ - minZ),
  };
}

export function getOverworldMapRenderSize(
  worldBounds: Pick<OverworldMapWorldBounds, "width" | "height">,
  maxDimension = MAX_RENDER_DIMENSION,
): OverworldMapRenderSize {
  const tileWidth = worldBounds.width / OVERWORLD_MAP_UNITS_PER_TILE;
  const tileHeight = worldBounds.height / OVERWORLD_MAP_UNITS_PER_TILE;
  const pixelScale = Math.min(1, maxDimension / Math.max(tileWidth * TARGET_PIXELS_PER_TILE, tileHeight * TARGET_PIXELS_PER_TILE));
  return {
    width: Math.max(1, Math.round(tileWidth * TARGET_PIXELS_PER_TILE * pixelScale)),
    height: Math.max(1, Math.round(tileHeight * TARGET_PIXELS_PER_TILE * pixelScale)),
    pixelScale,
  };
}

export function mapWorldBoundsToTilePlacement(
  worldBounds: OverworldMapWorldBounds,
  worldOrigin: { x: number; z: number },
  unitsPerTile = OVERWORLD_MAP_UNITS_PER_TILE,
): OverworldMapTilePlacement {
  return {
    x: (worldBounds.minX - worldOrigin.x) / unitsPerTile,
    y: (worldBounds.minZ - worldOrigin.z) / unitsPerTile,
    width: worldBounds.width / unitsPerTile,
    height: worldBounds.height / unitsPerTile,
  };
}

export function renderOverworldMapTopDown(data: Map3dSceneData): OverworldMapRender {
  const matrixBounds = getOverworldMapWorldBounds(data);
  const warnings = [...data.warnings];
  let lastError: unknown;
  const hasTextures = hasTexturedGeometry(data);
  const styles: OverworldMapRenderStyle[] = hasTextures ? ["textured", "solid"] : ["solid"];
  for (const style of styles) {
    for (const maxDimension of [MAX_RENDER_DIMENSION, ...FALLBACK_RENDER_DIMENSIONS]) {
      try {
        const render = renderOverworldMapTopDownAtSize(data, matrixBounds, maxDimension, warnings, style);
        if (style === "solid") {
          render.warnings.push(hasTextures ? "Map view used solid geometry because the textured render was blank." : "Map view used solid geometry because no map textures were decoded.");
        }
        if (maxDimension !== MAX_RENDER_DIMENSION) render.warnings.push(`Map view rendered at reduced ${render.canvas.width}x${render.canvas.height} resolution for browser stability.`);
        return render;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function renderOverworldMapTopDownAtSize(
  data: Map3dSceneData,
  matrixBounds: OverworldMapWorldBounds,
  maxDimension: number,
  warnings: string[],
  style: OverworldMapRenderStyle,
): OverworldMapRender {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x282a36, 1);

  const group = new THREE.Group();
  const textureCache = new Map<string, THREE.DataTexture>();
  try {
    const scene = new THREE.Scene();
    scene.add(group);

    for (const chunk of data.chunks) {
      const chunkGroup = new THREE.Group();
      chunkGroup.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
      addPrimitivesToGroup(chunkGroup, chunk.primitives, textureCache, style);
      group.add(chunkGroup);
    }

    for (const building of data.buildings) {
      const buildingGroup = new THREE.Group();
      buildingGroup.position.set(building.worldX, building.worldY, building.worldZ);
      buildingGroup.rotation.y = THREE.MathUtils.degToRad(building.rotationY);
      addPrimitivesToGroup(buildingGroup, building.primitives, textureCache, style);
      group.add(buildingGroup);
    }

    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) throw new Error("Map view rendered no terrain or building geometry");
    const worldBounds = matrixBounds;
    const { width, height } = getOverworldMapRenderSize(worldBounds, maxDimension);
    renderer.setSize(width, height, false);
    const maxY = box.max.y;
    const centerX = worldBounds.minX + worldBounds.width / 2;
    const centerZ = worldBounds.minZ + worldBounds.height / 2;
    const camera = new THREE.OrthographicCamera(
      -worldBounds.width / 2,
      worldBounds.width / 2,
      worldBounds.height / 2,
      -worldBounds.height / 2,
      0.1,
      Math.max(4096, maxY + 4096),
    );
    camera.position.set(centerX, maxY + 2048, centerZ);
    camera.up.set(0, 0, -1);
    camera.lookAt(centerX, 0, centerZ);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to create overworld map render canvas");
    context.drawImage(renderer.domElement, 0, 0);
    if (isBlankMapCanvas(context, width, height)) throw new Error(`Map view rendered blank at ${width}x${height} using ${style} materials`);

    return {
      canvas,
      worldBounds,
      worldOrigin: { x: matrixBounds.minX, z: matrixBounds.minZ },
      unitsPerTile: OVERWORLD_MAP_UNITS_PER_TILE,
      warnings,
    };
  } finally {
    renderer.dispose();
    clearGroup(group);
    for (const texture of textureCache.values()) texture.dispose();
  }
}

function isBlankMapCanvas(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const sampleColumns = Math.min(width, 32);
  const sampleRows = Math.min(height, 32);
  const tolerance = 6;
  let visibleSamples = 0;
  const requiredSamples = Math.max(4, Math.floor(sampleColumns * sampleRows * 0.015));
  for (let row = 0; row < sampleRows; row += 1) {
    const y = Math.min(height - 1, Math.floor(((row + 0.5) / sampleRows) * height));
    for (let column = 0; column < sampleColumns; column += 1) {
      const x = Math.min(width - 1, Math.floor(((column + 0.5) / sampleColumns) * width));
      const pixel = context.getImageData(x, y, 1, 1).data;
      if (
        Math.abs((pixel[0] ?? 0) - CLEAR_COLOR[0]) > tolerance ||
        Math.abs((pixel[1] ?? 0) - CLEAR_COLOR[1]) > tolerance ||
        Math.abs((pixel[2] ?? 0) - CLEAR_COLOR[2]) > tolerance
      ) {
        visibleSamples += 1;
        if (visibleSamples >= requiredSamples) return false;
      }
    }
  }
  return true;
}

function addPrimitivesToGroup(
  group: THREE.Group,
  primitives: Map3dPrimitive[],
  textureCache: Map<string, THREE.DataTexture>,
  style: OverworldMapRenderStyle,
): void {
  for (const primitive of primitives) {
    if (primitive.indices.length === 0 || primitive.positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
    if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
    if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
    if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
    if (!primitive.normals) geometry.computeVertexNormals();
    const material = style === "solid" ? solidMaterial(primitive) : texturedMaterial(primitive, textureCache);
    group.add(new THREE.Mesh(geometry, material));
  }
}

function solidMaterial(primitive: Map3dPrimitive): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: primitive.colors ? 0xffffff : 0x9da7b3,
    vertexColors: Boolean(primitive.colors),
    transparent: primitive.material.alpha < 1,
    opacity: primitive.material.alpha,
    side: THREE.DoubleSide,
  });
}

function texturedMaterial(primitive: Map3dPrimitive, textureCache: Map<string, THREE.DataTexture>): THREE.MeshBasicMaterial {
  const texture = primitive.material.texture ? getTexture(textureCache, primitive.material.texture, primitive.material) : undefined;
  const options: THREE.MeshBasicMaterialParameters = {
    color: texture ? 0xffffff : new THREE.Color(...primitive.material.diffuse),
    vertexColors: Boolean(primitive.colors),
    transparent: primitive.material.alpha < 1 || Boolean(texture),
    opacity: primitive.material.alpha,
    alphaTest: texture ? 0.05 : 0,
    side: THREE.DoubleSide,
  };
  if (texture) options.map = texture;
  return new THREE.MeshBasicMaterial(options);
}

function getTexture(cache: Map<string, THREE.DataTexture>, textureData: DecodedTexture, material: Map3dPrimitive["material"]): THREE.DataTexture {
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

function hasTexturedGeometry(data: Map3dSceneData): boolean {
  const chunkHasTexture = data.chunks.some((chunk) => chunk.primitives.some((primitive) => Boolean(primitive.material.texture)));
  const buildingHasTexture = data.buildings.some((building) => building.primitives.some((primitive) => Boolean(primitive.material.texture)));
  return chunkHasTexture || buildingHasTexture;
}
