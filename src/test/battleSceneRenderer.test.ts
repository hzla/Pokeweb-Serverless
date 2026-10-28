import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBattleSceneThreeObject } from "../ui/battleBackgroundRenderer";
import { buildBattleModelScene } from "../pokeweb/battleModelScene";

function model(id: number, color: [number, number, number]) {
  return buildBattleModelScene(id, [{ material: { name: "floor", diffuse: color, alpha: 1 }, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint16Array([0, 1, 2]) }], [], []);
}

describe("combined battle scenery", () => {
  it("keeps background and two distinct native platform objects in the same scene", () => {
    const background = model(74, [0, 1, 0]), player = model(14, [1, 0, 0]), opponent = model(15, [0, 0, 1]);
    const scene = createBattleSceneThreeObject(background, [
      { model: player, position: { x: 0, y: 0, z: 5.448974609375 }, scale: 1.2 },
      { model: opponent, position: { x: 0, y: 0, z: -12.718017578125 }, scale: 1.2 },
    ]);
    expect(scene.group.children.map(c => c.name)).toEqual(["Battle background", "Player platform", "Opponent platform"]);
    expect(scene.group.children.map(c => c.position.z)).toEqual([0, 5.448974609375, -12.718017578125]);
    expect(scene.group.children.map(c => c.scale.x)).toEqual([1, 1.2, 1.2]);
    const meshes = scene.group.children.map(c => c.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>);
    expect(meshes[1].material.color.r).toBe(1); expect(meshes[2].material.color.b).toBe(1);
    const released = meshes.map(mesh => vi.spyOn(mesh.geometry, "dispose"));
    scene.dispose();
    expect(released.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(scene.group.children).toHaveLength(0);
  });
});
