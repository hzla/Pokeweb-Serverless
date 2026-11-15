import { readU16 } from "../nds/binary";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { buildModelPrimitives, readNitroResources, type Map3dPrimitive } from "./map3dModel";
import { GRASS_LAYERS, GRASS_TILE_CLASSES, GRASS_Z_OFFSET, type MapGrassKind } from "./mapGrassGeometry";

function sampleLayer(primitives: Map3dPrimitive[], x: number, z: number): number | undefined {
  let height: number | undefined;
  for (const { positions, indices } of primitives) for (let face = 0; face + 2 < indices.length; face += 3) {
    const a = indices[face] * 3, b = indices[face + 1] * 3, c = indices[face + 2] * 3;
    const ax = positions[a] - positions[c], az = positions[a + 2] - positions[c + 2];
    const bx = positions[b] - positions[c], bz = positions[b + 2] - positions[c + 2];
    const determinant = ax * bz - az * bx;
    if (!determinant) continue;
    const dx = x - positions[c], dz = z - positions[c + 2];
    const u = (dx * bz - dz * bx) / determinant;
    const v = (ax * dz - az * dx) / determinant;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-7) continue;
    const y = u * positions[a + 1] + v * positions[b + 1] + w * positions[c + 1];
    if (height !== undefined && Math.abs(height - y) > 1e-5) return undefined;
    height = y;
  }
  return height;
}

/** Compare native layers to the walking plane at their logical tile centers. */
export function mapGrassPlacement(model: Uint8Array, collision: Uint8Array, kind: MapGrassKind, game: "BW" | "BW2") {
  const native = readNitroResources(model);
  const layers = GRASS_LAYERS[kind];
  const hasLayers = layers.every(({ texture }) => native.models.some(model =>
    model.materials.some(material => material.name === texture)));
  const samples: Array<{ index: number; ground: number; lifts: number[] }> = [];

  if (hasLayers) {
    const primitives = buildModelPrimitives(native, []);
    const surfaces = layers.map(({ texture }) => primitives.filter(p => p.material.name === texture));
    for (let index = 0; index < 1024; index++) {
      if (readU16(collision, 8 + index * 8) !== GRASS_TILE_CLASSES[kind]) continue;
      if ((readU16(collision, 4 + index * 8) & 3) === 2) continue;
      const x = (index % 32 - 16) * 16 + 8, z = (Math.floor(index / 32) - 16) * 16 + 8;
      const heights = surfaces.map(layer => sampleLayer(layer, x, z + GRASS_Z_OFFSET));
      if (!heights.every((y): y is number => y !== undefined)) continue;
      let ground: number;
      try { ground = gen5HeightAt(collision, index, .5, .5, game) * 16; }
      catch { continue; }
      const lifts = heights.map(y => y - ground);
      if (lifts.every((lift, i) => lift > 0 && lift < 16 && (i === 0 || lift <= lifts[i - 1]))) samples.push({ index, ground, lifts });
    }
  }

  return (index: number, ground: number): number[] | undefined => {
    let closest: (typeof samples)[number] | undefined, distance = 9;
    for (const sample of samples) {
      const tiles = Math.abs(sample.index % 32 - index % 32) + Math.abs(Math.floor(sample.index / 32) - Math.floor(index / 32));
      if (tiles >= distance || Math.abs(sample.ground - ground) > 1) continue;
      closest = sample;
      distance = tiles;
    }
    return closest?.lifts;
  };
}
