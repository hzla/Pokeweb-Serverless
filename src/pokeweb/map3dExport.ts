import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { Map3dMaterial, Map3dPrimitive, Map3dSceneData } from "./map3dModel";
import type { MapGlbManifest } from "./mapGlbContract";

const NATIVE_UNITS_PER_TILE = 16;

export type Map3dExportResult = {
  bytes: ArrayBuffer;
  filename: string;
  chunkCount: number;
  buildingCount: number;
  warnings: string[];
};

/** Export the loaded map, independently of viewport visibility and editor helpers. */
export async function exportMap3dGlb(data: Map3dSceneData, options: { filename?: string; metadata?: Record<string, unknown>; mapManifest?: MapGlbManifest } = {}): Promise<Map3dExportResult> {
  const scene = new THREE.Scene();
  scene.name = data.label;
  const warnings = [...data.warnings];
  const missingBuildings = data.buildingDiagnostics?.filter((entry) => entry.status !== "rendered").length ?? 0;
  if (missingBuildings) warnings.push(`${missingBuildings} building placement(s) could not be decoded and are absent from this export.`);
  scene.userData = {
    pokeweb: {
      ...(options.metadata ?? { zoneId: data.zoneId, label: data.label, season: data.season,
      matrixId: data.matrixId, sourceMatrixId: data.sourceMatrixId,
      areaId: data.areaId, sourceAreaId: data.sourceAreaId,
      textureId: data.textureId, buildingsId: data.buildingsId,
      chunkSpan: data.chunkSpan, content: "Static terrain and placed buildings" }),
      units: "Map tiles; 1 unit per tile", upAxis: "Y", warnings,
      ...(options.mapManifest ? { mapImport: options.mapManifest } : {}),
    },
  };
  const terrain = new THREE.Group();
  terrain.name = "Terrain";
  const buildings = new THREE.Group();
  buildings.name = "Buildings";
  scene.add(terrain, buildings);

  const meshes = new Map<Map3dPrimitive, { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial }>();
  const textures = new Map<string, THREE.DataTexture[]>();
  let chunkCount = 0;
  let buildingCount = 0;

  function getTexture(material: Map3dMaterial): THREE.DataTexture | undefined {
    const source = material.texture;
    if (!source) return undefined;
    const wrapS = textureWrap(material.repeatS, material.flipS);
    const wrapT = textureWrap(material.repeatT, material.flipT);
    // Names alone are not unique: different models and palettes can reuse them.
    let hash = 2166136261;
    for (const byte of source.rgba) hash = Math.imul(hash ^ byte, 16777619);
    const key = `${source.width}:${source.height}:${wrapS}:${wrapT}:${hash >>> 0}`;
    const bucket = textures.get(key) ?? [];
    const existing = bucket.find((texture) => {
      const pixels = texture.image.data;
      return pixels !== null && pixels.length === source.rgba.length && source.rgba.every((byte, i) => byte === pixels[i]);
    });
    if (existing) return existing;
    const texture = new THREE.DataTexture(source.rgba, source.width, source.height, THREE.RGBAFormat);
    texture.name = source.name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.wrapS = wrapS;
    texture.wrapT = wrapT;
    texture.needsUpdate = true;
    bucket.push(texture);
    textures.set(key, bucket);
    return texture;
  }

  function addPrimitives(group: THREE.Group, primitives: Map3dPrimitive[]): boolean {
    for (const [index, primitive] of primitives.entries()) {
      if (!primitive.positions.length || !primitive.indices.length) continue;
      let resource = meshes.get(primitive);
      if (!resource) {
        const geometry = new THREE.BufferGeometry();
        // BufferAttributes reference source arrays, but neither export nor disposal mutates them.
        geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
        if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
        if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
        if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
        if (!primitive.normals) geometry.computeVertexNormals();
        const source = primitive.material;
        const texture = getTexture(source);
        const alpha = textureAlpha(source);
        const material = new THREE.MeshBasicMaterial({
          name: source.name,
          map: texture ?? null,
          color: texture ? 0xffffff : new THREE.Color(...source.diffuse),
          vertexColors: Boolean(primitive.colors),
          side: THREE.DoubleSide,
          opacity: source.alpha,
          transparent: source.alpha < 1 || alpha === "blend",
          alphaTest: alpha === "mask" ? 0.05 : 0,
        });
        material.userData = { pokewebNativeMaterial: source.name };
        resource = { geometry, material };
        meshes.set(primitive, resource);
      }
      const mesh = new THREE.Mesh(resource.geometry, resource.material);
      mesh.name = `${group.name}_${index}_${primitive.material.name}`;
      group.add(mesh);
    }
    return group.children.length > 0;
  }

  try {
    for (const [index, chunk] of data.chunks.entries()) {
      const group = new THREE.Group();
      group.name = `Chunk_${chunk.chunkId}_cell_${chunk.matrixX}_${chunk.matrixY}_${index}`;
      group.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
      group.userData = { chunkId: chunk.chunkId, sourceChunkId: chunk.sourceChunkId, matrixX: chunk.matrixX, matrixY: chunk.matrixY };
      if (options.mapManifest) group.userData.pokewebMapObject = options.mapManifest.terrain[index].id;
      if (addPrimitives(group, chunk.primitives)) {
        terrain.add(group);
        chunkCount++;
      }
    }
    for (const [index, building] of data.buildings.entries()) {
      const group = new THREE.Group();
      group.name = `Building_${building.modelId ?? building.uid}_chunk_${building.chunkId}_placement_${building.placementIndex ?? index}_${index}`;
      group.position.set(building.worldX, building.worldY, building.worldZ);
      group.rotation.y = THREE.MathUtils.degToRad(building.rotationY);
      group.userData = {
        uid: building.uid, modelId: building.modelId, placementIndex: building.placementIndex,
        chunkId: building.chunkId, sourceChunkId: building.sourceChunkId,
      };
      if (options.mapManifest) group.userData.pokewebMapObject = options.mapManifest.buildings[index].id;
      if (addPrimitives(group, building.primitives)) {
        buildings.add(group);
        buildingCount++;
      }
    }
    if (!chunkCount && !buildingCount) throw new Error("This map has no terrain or buildings to export.");

    // Native world coordinates can be tens of thousands of units from the origin,
    // beyond Blender's default viewport clipping distance. Bake a local tile scale
    // into geometry and placement translations, keeping both parent groups at zero.
    // A translated root alone would leave a distant parent origin in Frame All.
    const bounds = new THREE.Box3().setFromObject(scene, true);
    const origin = bounds.getCenter(new THREE.Vector3());
    origin.y = bounds.min.y;
    const scale = 1 / NATIVE_UNITS_PER_TILE;
    for (const { geometry } of meshes.values()) {
      const positions = geometry.getAttribute("position").clone();
      for (let i = 0; i < positions.count; i++) {
        positions.setXYZ(i, positions.getX(i) * scale, positions.getY(i) * scale, positions.getZ(i) * scale);
      }
      geometry.setAttribute("position", positions);
    }
    for (const group of [...terrain.children, ...buildings.children]) group.position.sub(origin).multiplyScalar(scale);
    scene.userData.pokeweb.sourceOrigin = origin.toArray();
    scene.userData.pokeweb.scaleFromSource = scale;
    scene.userData.pokeweb.sourceUnitsPerTile = NATIVE_UNITS_PER_TILE;
    const bytes = await new GLTFExporter().parseAsync(scene, { binary: true, trs: true });
    if (!(bytes instanceof ArrayBuffer)) throw new Error("The map exporter did not produce a GLB file.");
    const label = data.label.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);
    return { bytes, filename: options.filename ?? `map-${data.zoneId}${label ? `-${label}` : ""}-${data.season}.glb`, chunkCount, buildingCount, warnings };
  } finally {
    for (const { geometry, material } of meshes.values()) {
      geometry.dispose();
      material.dispose();
    }
    for (const bucket of textures.values()) for (const texture of bucket) texture.dispose();
  }
}

function textureWrap(repeat?: boolean, flip?: boolean): THREE.Wrapping {
  return repeat ? (flip ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping) : THREE.ClampToEdgeWrapping;
}

function textureAlpha(material: Map3dMaterial): "opaque" | "mask" | "blend" {
  const pixels = material.texture?.rgba;
  let transparent = false;
  if (pixels) {
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0 && pixels[i] < 255) return "blend";
      if (pixels[i] === 0) transparent = true;
    }
  }
  return transparent ? "mask" : "opaque";
}
