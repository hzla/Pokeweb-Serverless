import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { decodeFaces, type BrushPart, type BrushVertex } from "../pokeweb/mapBrushGeometry";
import { appendMapFences, fenceForAxis, fenceTiles, MAP_FENCE_TYPES, readPlacedFences, type FenceTemplate } from "../pokeweb/mapFences";
import { terrainModelLayout } from "../pokeweb/mapGrassGeometry";
import { MAP_PROP_TYPES, propPlacement } from "../pokeweb/mapProps";
import { stampBlocked, stampSize } from "../pokeweb/mapStampCatalog";
import { readPlacedThickGrass, rebuildThickGrass, thickGrassTile, type ThickGrassTemplate } from "../pokeweb/mapThickGrass";
import { materialRecords, nitroBlocks, readDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { mapBin } from "./fixtures/gen5MapImport";

function fixture() {
  const bin = readGen5MapBin(mapBin()), blocks = nitroBlocks(bin.files[0]);
  const model = readU32(readDictionary(blocks[0], 8)[0].data, 0);
  writeU32(blocks[0], model + 28, 64 * 4096);
  writeU32(blocks[0], model + 32, 4096 / 64);
  return { model: writeNitroFile(bin.files[0], blocks), collision: bin.files[1] };
}

function part(model: Uint8Array, name: string): BrushPart {
  const native = materialRecords(model)[0];
  return { record: { ...native, name, textureName: name, paletteName: `${name}_pl` }, shapeHeader: terrainModelLayout(model).shapes[0].header.slice(), faces: [] };
}

const quad = (x0: number, x1: number, y: number, z: number, texcoord = 0): BrushVertex[] =>
  [[x0, 0, z], [x1, 0, z], [x1, y, z], [x0, y, z]].map(([x, h, w]) => ({ position: [x, h, w] as const, texcoord, normal: 511 << 20 }));

describe("fence brush", () => {
  it("draws the first, repeated middle and last tile, continuing textures along the run", () => {
    const { model } = fixture();
    const type = MAP_FENCE_TYPES[0];
    const template: FenceTemplate = {
      type, axis: "x",
      parts: [{ part: part(model, "c01saku"), start: [quad(4, 16, 20, 8)], middle: [quad(0, 16, 20, 8, 16 * 16)], end: [quad(0, 12, 20, 8)],
        slope: [16 * 16, 0], period: [32 * 16, 16 * 16], donorStart: 0, donorEnd: 3 }],
    };
    const placed = appendMapFences(model, [{ startIndex: 5 * 32 + 3, length: 4, ground: 0, template }]);
    const layout = terrainModelLayout(placed);
    const faces = decodeFaces(layout.shapes.at(-1)!.list, layout.scale);
    expect(faces.map(face => face[0].position[0])).toEqual([-208 + 4, -192, -176, -160]);
    // The two middle tiles carry the texture on by one tile each, wrapped to the 32-texel repeat.
    expect(faces.slice(1, 3).map(face => face[0].texcoord! & 0xffff)).toEqual([16 * 16, 0]);
    const read = readPlacedFences(placed);
    expect([...read.fences.values()].map(({ type: t, startIndex, length, axis }) => ({ id: t?.id, startIndex, length, axis })))
      .toEqual([{ id: type.id, startIndex: 163, length: 4, axis: "x" }]);
    expect(readPlacedFences(read.remove(new Set(read.fences.keys()))).fences.size).toBe(0);
    expect(fenceTiles(163, 3, "z")).toEqual([163, 195, 227]);
  });

  it("turns a fence a quarter turn for the other direction", () => {
    const { model } = fixture();
    const template: FenceTemplate = { type: MAP_FENCE_TYPES[0], axis: "x",
      parts: [{ part: part(model, "c01saku"), start: [quad(0, 16, 20, 4)], middle: [], end: [], slope: [0, 0], period: [0, 0], donorStart: 0, donorEnd: 0 }] };
    const turned = fenceForAxis(template, "z");
    expect(turned.parts[0].start[0].map(v => v.position)).toEqual([[12, 0, 0], [12, 0, 16], [12, 20, 16], [12, 20, 0]]);
    expect(fenceForAxis(template, "x")).toBe(template);
  });
});

describe("thick grass brush", () => {
  const template = (model: Uint8Array): ThickGrassTemplate => ({
    kind: "green", top: part(model, "nagakusa01a"), side: part(model, "nagakusa01b"), height: 16,
    inset: { north: 7.5, south: 0, west: 4, east: 4 }, topVertex: { normal: 511 << 10, normalLast: true },
    edges: Object.fromEntries((["north", "south", "west", "east"] as const).map(side => [side, { start: [quad(0, 16, 8, 1)], middle: [quad(0, 16, 8, 2)], end: [quad(0, 16, 8, 3)] }])) as ThickGrassTemplate["edges"],
  });

  it("insets the top and adds skirts only on open sides", () => {
    const { model } = fixture();
    const closed = thickGrassTile(template(model), 33, 0, { north: false, south: false, west: false, east: false });
    expect(closed.parts[0].faces[0].map(v => [v.position[0], v.position[2]])).toEqual([[-240, -224], [-224, -224], [-224, -240], [-240, -240]]);
    expect(closed.parts[1].faces).toEqual([]);
    const open = thickGrassTile(template(model), 33, 0, { north: true, south: false, west: true, east: false });
    expect(open.parts[0].faces[0][3].position).toEqual([-236, 16, -232.5]);
    expect(open.parts[1].faces.length).toBeGreaterThan(0);
  });

  it("rebuilds neighbours so the outline follows the painted area", () => {
    const { model, collision } = fixture();
    const templates = { green: template(model) };
    const one = rebuildThickGrass(model, collision, new Map([[100, "green"]]), new Set([100]), templates, "BW2");
    const two = rebuildThickGrass(one, collision, new Map([[100, "green"], [101, "green"]]), new Set([101]), templates, "BW2");
    const tiles = readPlacedThickGrass(two).tiles;
    expect([...tiles.keys()].sort()).toEqual([100, 101]);
    const erased = rebuildThickGrass(two, collision, new Map([[100, "green"]]), new Set([101]), templates, "BW2");
    expect([...readPlacedThickGrass(erased).tiles.keys()]).toEqual([100]);
  });
});

describe("model props", () => {
  it("turns a model's origin and footprint together", () => {
    const gate = MAP_PROP_TYPES.find(type => type.id === "arched-gateway")!;
    expect(stampSize(gate, 1)).toEqual([1, 7]);
    expect([0, 6].map(z => stampBlocked(gate, 1, 0, z))).toEqual([true, true]);
    expect(propPlacement(gate, 0)).toEqual({ origin: [64, 8], angle: 0 });
    // A quarter turn clockwise puts the 64-unit offset on z and is 270° in the game's anticlockwise angles.
    expect(propPlacement(gate, 1)).toEqual({ origin: [8, 64], angle: 49152 });
  });
});
