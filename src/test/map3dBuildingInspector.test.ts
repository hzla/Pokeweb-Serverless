import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pickMap3dBuilding, renderBuildingDetails } from "../ui/map3dBuildingInspector";
import type { Map3dBuilding, Map3dChunk } from "../pokeweb/map3dModel";

describe("building inspector selection", () => {
  function scene() {
    const buildings = new THREE.Group();
    const terrain = new THREE.Group();
    for (const [index, z] of [[0, 0], [1, -5]]) {
      const placement = new THREE.Group();
      placement.userData.map3dBuildingIndex = index;
      placement.position.z = z;
      placement.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
      buildings.add(placement);
    }
    buildings.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    return { buildings, terrain, ray };
  }

  it("selects the nearest placement and ignores hidden instances or the hidden building layer", () => {
    const { buildings, terrain, ray } = scene();
    expect(pickMap3dBuilding(ray, buildings, terrain)).toBe(0);
    buildings.children[0].visible = false;
    expect(pickMap3dBuilding(ray, buildings, terrain)).toBe(1);
    buildings.visible = false;
    expect(pickMap3dBuilding(ray, buildings, terrain)).toBeUndefined();
  });

  it("does not pick through terrain, but supports isolation with terrain hidden", () => {
    const { buildings, terrain, ray } = scene();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), new THREE.MeshBasicMaterial());
    wall.position.z = 5;
    terrain.add(wall);
    terrain.updateMatrixWorld(true);
    expect(pickMap3dBuilding(ray, buildings, terrain)).toBeUndefined();
    terrain.visible = false;
    expect(pickMap3dBuilding(ray, buildings, terrain)).toBe(0);
    ray.set(new THREE.Vector3(100, 0, 10), new THREE.Vector3(0, 0, -1));
    expect(pickMap3dBuilding(ray, buildings, terrain)).toBeUndefined();
  });
});

describe("building placement details", () => {
  const building: Map3dBuilding = {
    uid: 8, modelId: 22, placementIndex: 0, chunkId: 4, sourceChunkId: 5,
    worldX: 800.5, worldY: 64.25, worldZ: 1200, rotationY: 90,
    primitives: [{
      material: { name: "wall<script>", diffuse: [1, 1, 1], alpha: 1 },
      positions: new Float32Array(9), indices: new Uint16Array([0, 1, 2]),
    }],
  };
  const chunk: Map3dChunk = {
    chunkId: 4, sourceChunkId: 5, matrixX: 1, matrixY: 2, worldX: 768, worldY: 48, worldZ: 1280, primitives: [],
  };

  it("shows source IDs, exact placement coordinates, rotation and offsets from the actual chunk origin", () => {
    const html = renderBuildingDetails(building, 2, { chunks: [chunk], buildingsId: 7 });
    expect(html).toContain("Building 3");
    expect(html).toContain("<dt>Placement index</dt><dd>0</dd>");
    expect(html).toContain("<dt>World X</dt><dd>800.5</dd>");
    expect(html).toContain("<dt>World Y (height)</dt><dd>64.25</dd>");
    expect(html).toContain("<dt>Rotation Y</dt><dd>90°</dd>");
    expect(html).toContain("<dt>Chunk-relative X</dt><dd>32.5</dd>");
    expect(html).toContain("<dt>Chunk-relative Y</dt><dd>16.25</dd>");
    expect(html).toContain("<dt>Chunk-relative Z</dt><dd>-80</dd>");
    expect(html).toContain("wall&lt;script&gt;");
    expect(html).not.toContain("wall<script>");
  });

  it("does not invent a chunk-relative location when source IDs appear in multiple cells", () => {
    const html = renderBuildingDetails(building, 0, { chunks: [chunk, { ...chunk, matrixX: 2, worldX: 1280 }], buildingsId: 7 });
    expect(html).not.toContain("Chunk-relative");
    expect(html).toContain("<dt>World X</dt><dd>800.5</dd>");
  });

  it("offers editable transforms and bundle models while retaining source identifiers as metadata", () => {
    const editableBuilding = { ...building, modelId: undefined, chunkOrigin: { x: 768, y: 0, z: 1280, matrixX: 1, matrixY: 2 } };
    const html = renderBuildingDetails(editableBuilding, 0, {
      chunks: [chunk, { ...chunk, worldX: 1280 }], buildingsId: 7,
      buildingModels: [{ uid: 8, primitives: building.primitives }, { uid: 258, primitives: building.primitives }],
    }, true);
    expect(html).toContain('data-building-field="worldX" value="800.5"');
    expect(html).toContain('data-building-field="localX" value="32.5"');
    expect(html).toContain('data-building-field="rotationY" value="90" step="any" min="0" max="360"');
    expect(html).toContain('<option value="8" selected>8</option><option value="258">258</option>');
    expect(html).toContain("<dt>Placement index</dt><dd>0</dd>");
    expect(html).toContain("<dt>Chunk ID</dt><dd>4</dd>");
    expect(renderBuildingDetails(building, 0, { chunks: [chunk], buildingsId: 7 }, true)).not.toContain("<input");
  });
});
