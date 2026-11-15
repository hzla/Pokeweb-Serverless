import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { terrainModelLayout } from "../pokeweb/mapGrassGeometry";
import { decodeFaces } from "../pokeweb/mapBrushGeometry";
import { MAP_STAMP_TYPES, mapStampType, stampBlocked, stampSize } from "../pokeweb/mapStampCatalog";
import { appendMapStamps, readPlacedMapStamps, stampTiles, turnStampParts, type MapStampTemplate } from "../pokeweb/mapStamps";
import { materialRecords, nitroBlocks, readDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { mapBin } from "./fixtures/gen5MapImport";

function terrain() {
  const original = readGen5MapBin(mapBin()).files[0], blocks = nitroBlocks(original);
  const model = readU32(readDictionary(blocks[0], 8)[0].data, 0);
  writeU32(blocks[0], model + 28, 64 * 4096);
  writeU32(blocks[0], model + 32, 4096 / 64);
  return writeNitroFile(original, blocks);
}

const light = mapStampType("red-street-light")!; // 3×1, centre tile blocked
const bench = mapStampType("wooden-bench")!; // 2×3

function template(model: Uint8Array): MapStampTemplate {
  const native = materialRecords(model)[0];
  const header = terrainModelLayout(model).shapes[0].header.slice();
  // A post at x 20, z 4..12, with a normal pointing +x.
  const face = [[20, 0, 4], [20, 40, 4], [20, 40, 12], [20, 0, 12]].map(([x, y, z]) => ({ position: [x, y, z] as const, normal: 511, texcoord: 7 }));
  return { type: light, parts: [{ record: { ...native, name: "r04_b_lamp01", textureName: "r04_b_lamp01", paletteName: "r04_b_lamp01_pl" }, shapeHeader: header, faces: [face] }] };
}

describe("map stamps", () => {
  it("has catalog footprints that match their blocked rows", () => {
    expect(new Set(MAP_STAMP_TYPES.map(type => type.id)).size).toBe(MAP_STAMP_TYPES.length);
    for (const type of MAP_STAMP_TYPES) {
      expect(type.blocked.every(row => row.length === type.blocked[0].length && /^[#.]+$/.test(row))).toBe(true);
      expect(type.materials.every(name => `s1_${name}`.length <= 16)).toBe(true);
    }
  });

  it("turns footprints and their blocked tiles clockwise", () => {
    expect(stampSize(light, 0)).toEqual([3, 1]);
    expect(stampSize(light, 1)).toEqual([1, 3]);
    // ".#." stays centred whichever way it faces.
    expect([0, 1, 2].map(z => stampBlocked(light, 1, 0, z))).toEqual([false, true, false]);
    const corner = { ...bench, blocked: ["#.", "..", ".."] };
    // A quarter turn clockwise moves the top-left tile to the top-right.
    expect(stampSize(corner, 1)).toEqual([3, 2]);
    expect(stampBlocked(corner, 1, 2, 0)).toBe(true);
    expect(stampBlocked(corner, 2, 1, 2)).toBe(true);
    expect(stampBlocked(corner, 3, 0, 1)).toBe(true);
    expect(stampTiles(light, 1, 31 * 32 + 5)).toBeUndefined();
    expect(stampTiles(light, 1, 2 * 32 + 5)?.map(tile => tile.index)).toEqual([69, 101, 133]);
  });

  it("turns faces and normals with the footprint", () => {
    const parts = template(terrain());
    const [face] = turnStampParts(parts, 1)[0].faces;
    // In a 1-tile-deep footprint, (x, z) → (16 − z, x).
    expect(face.map(vertex => vertex.position)).toEqual([[12, 0, 20], [12, 40, 20], [4, 40, 20], [4, 0, 20]]);
    // The normal +x turns to +z.
    expect(face[0].normal).toBe(511 << 20);
    expect(face[0].texcoord).toBe(7);
  });

  it("places stamps on the grid, reads them back and removes them", () => {
    const model = terrain();
    const before = terrainModelLayout(model);
    const stamp = template(model);
    const placed = appendMapStamps(model, [
      { tileIndex: 4 * 32 + 6, ground: 32, rotation: 0, template: stamp },
      { tileIndex: 10 * 32 + 2, ground: 0, rotation: 3, template: stamp },
    ]);
    const layout = terrainModelLayout(placed);
    expect(layout.shapes.slice(0, before.shapes.length).map(shape => shape.list)).toEqual(before.shapes.map(shape => shape.list));
    expect(layout.shapes.at(-1)!.name).toBe("s1_r04_b_lamp01");
    const faces = decodeFaces(layout.shapes.at(-1)!.list, layout.scale);
    expect(faces[0][0].position).toEqual([(6 - 16) * 16 + 20, 32, (4 - 16) * 16 + 4]);
    const read = readPlacedMapStamps(placed);
    expect([...read.stamps.values()].map(({ type, tileIndex, rotation }) => ({ type: type?.id, tileIndex, rotation })))
      .toEqual([{ type: "red-street-light", tileIndex: 134, rotation: 0 }, { type: "red-street-light", tileIndex: 322, rotation: 3 }]);
    const [first] = read.stamps.keys();
    const rest = readPlacedMapStamps(read.remove(new Set([first])));
    expect([...rest.stamps.values()].map(stamp => stamp.tileIndex)).toEqual([322]);
  });

  it("keeps an animated material's native name so the area's texture animation binds to it", () => {
    const model = terrain();
    const stamp = template(model);
    const animated: MapStampTemplate = { ...stamp, parts: stamp.parts.map(part => ({ ...part, nativeName: true })) };
    const placed = appendMapStamps(model, [{ tileIndex: 4 * 32 + 6, ground: 0, rotation: 0, template: animated }]);
    const layout = terrainModelLayout(placed);
    expect(layout.shapes.at(-1)!.name).toBe("s1_r04_b_lamp01");
    expect(materialRecords(placed).map(record => record.name)).toContain("r04_b_lamp01");
    expect(materialRecords(placed).map(record => record.name)).not.toContain("s1_r04_b_lamp01");
    const read = readPlacedMapStamps(placed);
    expect([...read.stamps.values()].map(stamp => stamp.type?.id)).toEqual(["red-street-light"]);
    expect(readPlacedMapStamps(read.remove(new Set(read.stamps.keys()))).stamps.size).toBe(0);
  });
});
