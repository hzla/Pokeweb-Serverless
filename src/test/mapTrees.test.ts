import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU32 } from "../nds/binary";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { terrainModelLayout } from "../pokeweb/mapGrassGeometry";
import { MAP_TREE_TYPES, mapTreeTypeForMaterials } from "../pokeweb/mapTreeCatalog";
import { appendMapTrees, decodeFaces, readPlacedMapTrees, treeTileKey, type MapTreeTemplate } from "../pokeweb/mapTreeGeometry";
import { snapGround } from "../pokeweb/mapTrees";
import { materialRecords, nitroBlocks, readDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { mapBin } from "./fixtures/gen5MapImport";

const round = MAP_TREE_TYPES.find(type => type.id === "round")!;

/** The fixture terrain with a native 64x position scale. */
function terrain() {
  const original = readGen5MapBin(mapBin()).files[0], blocks = nitroBlocks(original);
  const model = readU32(readDictionary(blocks[0], 8)[0].data, 0);
  writeU32(blocks[0], model + 28, 64 * 4096);
  writeU32(blocks[0], model + 32, 4096 / 64);
  return writeNitroFile(original, blocks);
}

function template(model: Uint8Array): MapTreeTemplate {
  const native = materialRecords(model)[0];
  const header = terrainModelLayout(model).shapes[0].header.slice();
  const part = (name: string, faces: MapTreeTemplate["parts"][number]["faces"]) => ({ record: { ...native, name, textureName: name, paletteName: `${name}_pl` }, shapeHeader: header, faces });
  const quad = (y: number) => [[0, y, 0], [32, y, 0], [32, y, 32], [0, y, 32]].map(([x, height, z], i) => ({ position: [x, height, z] as const, texcoord: i * 16, normal: 0x1ff << 10 }));
  return {
    type: round,
    parts: [
      part("ki02c", [quad(3)]),
      part("ki02ax", [quad(26).map(v => ({ ...v, color: 0x7fff, normalLast: false })), [{ position: [0, 3, 16], texcoord: 1 }, { position: [32, 3, 16], texcoord: 2 }, { position: [16, 56, 16], texcoord: 3 }]]),
      part("ki02bx", [quad(22)]),
      part("ki02dx", [quad(46.5)]),
    ],
  };
}

describe("map tree geometry", () => {
  it("adds tagged tree shapes, reads them back and removes them without touching the native terrain", () => {
    const model = terrain();
    const before = terrainModelLayout(model);
    const tree = template(model);
    const placed = appendMapTrees(model, [{ tileIndex: 5 * 32 + 7, ground: 32, template: tree }, { tileIndex: 20 * 32 + 3, ground: 0, template: tree }]);
    const layout = terrainModelLayout(placed);
    expect(layout.shapes.slice(0, before.shapes.length).map(shape => shape.list)).toEqual(before.shapes.map(shape => shape.list));
    expect(layout.shapes.slice(before.shapes.length).map(shape => shape.name)).toEqual(["t1_ki02c", "t1_ki02ax", "t1_ki02bx", "t1_ki02dx"]);

    // Positions land on the tile grid at the given ground height, with every attribute preserved.
    const trunk = decodeFaces(layout.shapes.find(shape => shape.name === "t1_ki02ax")!.list, layout.scale);
    // Triangles are written before quads.
    expect(trunk[0].map(vertex => vertex.position)).toEqual([[-144, 35, -160], [-112, 35, -160], [-128, 88, -160]]);
    expect(trunk[1].map(vertex => vertex.position)).toEqual([[-144, 58, -176], [-112, 58, -176], [-112, 58, -144], [-144, 58, -144]]);
    expect(trunk[1][0]).toMatchObject({ color: 0x7fff, normal: 0x1ff << 10, texcoord: 0 });
    expect(readU16(layout.original, 38) - readU16(before.original, 38)).toBe(2 * 5);
    expect(readU16(layout.original, 36) - readU16(before.original, 36)).toBe(2 * 19);

    const read = readPlacedMapTrees(placed);
    expect([...read.trees.values()].map(({ type, tileIndex, size }) => ({ type: type?.id, tileIndex, size })))
      .toEqual([{ type: "round", tileIndex: 167, size: 2 }, { type: "round", tileIndex: 643, size: 2 }]);

    const one = readPlacedMapTrees(read.remove(new Set([treeTileKey(167, 1)])));
    expect([...one.trees.keys()]).toEqual([643]);
    const none = terrainModelLayout(one.remove(new Set([643])));
    expect([36, 38, 42].map(at => readU16(none.original, at))).toEqual([36, 38, 42].map(at => readU16(before.original, at)));
    expect(none.shapes.slice(0, before.shapes.length).map(shape => shape.list)).toEqual(before.shapes.map(shape => shape.list));
  });

  it("identifies tree types by their native materials", () => {
    expect(mapTreeTypeForMaterials(new Set(["ki02c", "ki03ax", "ki03bx", "ki03dx"]))?.id).toBe("pine");
    expect(mapTreeTypeForMaterials(new Set(["ki02c", "ki03ax"]))).toBeUndefined();
  });

  it("snaps decoded walking heights to the model's fixed-point grid", () => {
    expect(snapGround(32.007568)).toBe(32);
    expect(snapGround(-48.011232)).toBe(-48);
    expect(snapGround(16.5)).toBe(16.5);
  });
});
