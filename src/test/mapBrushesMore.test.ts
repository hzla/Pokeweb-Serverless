import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { decodeFaces, mergeBrushFaces, type BrushPart, type BrushVertex } from "../pokeweb/mapBrushGeometry";
import { appendMapFences, fenceForAxis, fenceKit, fenceTilePiece, fenceTiles, MAP_FENCE_TYPES, readPlacedFences, readPlacedFenceTiles, rebuildFenceTiles, type FenceTemplate } from "../pokeweb/mapFences";
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
    expect(faces.map(face => Math.min(...face.map(v => v.position[0])))).toEqual([-208 + 4, -192, -176, -160]);
    // The two middle tiles carry the texture on by one tile each, without wrapping, so long runs can be joined.
    expect(faces.slice(1, 3).map(face => face[0].texcoord! & 0xffff)).toEqual([16 * 16, 32 * 16]);
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

describe("merging faces", () => {
  const vertex = (x: number, z: number, s: number): BrushVertex => ({ position: [x, 0, z], texcoord: (s & 0xffff) | ((z * 16 & 0xffff) << 16), normal: 511 << 10 });
  const tile = (x: number, s0: number) => [vertex(x, 0, s0), vertex(x + 16, 0, s0 + 256), vertex(x + 16, 16, s0 + 256), vertex(x, 16, s0)];

  it("joins neighbouring faces whose texture runs on into one face", () => {
    const merged = mergeBrushFaces([tile(0, 0), tile(16, 256), tile(32, 512)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].map(v => v.position[0]).sort((a, b) => a - b)).toEqual([0, 0, 48, 48]);
  });

  it("keeps faces apart where the texture restarts or the plane turns", () => {
    expect(mergeBrushFaces([tile(0, 0), tile(16, 0)])).toHaveLength(2);
    const raised = tile(16, 256).map(v => ({ ...v, position: [v.position[0], v.position[0] === 32 ? 8 : 0, v.position[2]] as const }));
    expect(mergeBrushFaces([tile(0, 0), raised])).toHaveLength(2);
  });

  it("turns a pair of triangles into a quad", () => {
    const [a, b, c, d] = tile(0, 0);
    expect(mergeBrushFaces([[a, b, c], [a, c, d]]).map(face => face.length)).toEqual([4]);
  });
});

describe("connected fences", () => {
  const kit = (model: Uint8Array) => {
    // An east–west rail along z = 4 of its tile, and the same rail turned for north–south runs (x = 12).
    const x: FenceTemplate = { type: MAP_FENCE_TYPES[0], axis: "x",
      parts: [{ part: part(model, "c01saku"), start: [quad(2, 16, 20, 4)], middle: [quad(0, 16, 20, 4)], end: [quad(0, 14, 20, 4)], slope: [0, 0], period: [0, 0], donorStart: 0, donorEnd: 2 }] };
    return fenceKit(MAP_FENCE_TYPES[0], x, fenceForAxis(x, "z"));
  };
  const xs = (faces: BrushVertex[][]) => faces.flat().map(v => v.position[0]);
  const zs = (faces: BrushVertex[][]) => faces.flat().map(v => v.position[2]);

  it("joins runs at corners where the two rails cross", () => {
    const { model } = fixture();
    const fence = kit(model);
    expect([fence.lineX, fence.lineZ]).toEqual([4, 12]);
    // West and south neighbours: the west half of the east–west rail, the south half of the north–south rail.
    const corner = fenceTilePiece(fence, 0, 0, { north: false, south: true, west: true, east: false });
    const faces = corner.parts[0].faces, ox = -256, oz = -256;
    const rail = faces.filter(face => face.every(v => v.position[2] === oz + 4)), post = faces.filter(face => face.every(v => v.position[0] === ox + 12));
    expect(Math.max(...xs(rail)) - ox).toBe(12);
    expect(Math.min(...zs(post)) - oz).toBe(4);
    // A straight run uses the whole middle tile; a lone tile keeps both ends.
    expect(xs(fenceTilePiece(fence, 0, 0, { north: false, south: false, west: true, east: true }).parts[0].faces).map(x => x - ox).sort((a, b) => a - b)).toEqual([0, 0, 16, 16]);
    expect(Math.min(...xs(fenceTilePiece(fence, 0, 0, { north: false, south: false, west: false, east: false }).parts[0].faces)) - ox).toBe(2);
  });

  it("ends straight when asked, dropping a native end's turn", () => {
    const { model, collision } = fixture();
    // The donor's first tile turns: a face across the run at x = 2, from z = 4 to 12.
    const turn: BrushVertex[] = [[2, 0, 4], [2, 0, 12], [2, 20, 12], [2, 20, 4]].map(([x, y, z]) => ({ position: [x, y, z] as const, texcoord: 0, normal: 511 }));
    const x: FenceTemplate = { type: MAP_FENCE_TYPES[0], axis: "x",
      parts: [{ part: part(model, "c01saku"), start: [quad(2, 16, 20, 4), turn], middle: [quad(0, 16, 20, 4)], end: [quad(0, 14, 20, 4)], slope: [0, 0], period: [0, 0], donorStart: 0, donorEnd: 2 }] };
    const fence = fenceKit(MAP_FENCE_TYPES[0], x, fenceForAxis(x, "z"));
    const east = { north: false, south: false, west: false, east: true };
    expect(fenceTilePiece(fence, 0, 0, east).parts[0].faces).toHaveLength(2);
    expect(fenceTilePiece(fence, 0, 0, east, "straight").parts[0].faces).toHaveLength(1);
    // A middle tile is the same either way, and the style is saved with the tile.
    expect(fenceTilePiece(fence, 0, 0, { ...east, west: true }, "straight").parts[0].faces).toHaveLength(1);
    const kits = new Map([[MAP_FENCE_TYPES[0].id, fence]]);
    const run = new Map([100, 101].map(index => [index, MAP_FENCE_TYPES[0].id]));
    const drawn = rebuildFenceTiles(model, collision, run, new Set(run.keys()), kits, "BW2", new Set([100]));
    expect([...readPlacedFenceTiles(drawn).tiles].map(([index, tile]) => [index, tile.ends]).sort()).toEqual([[100, "straight"], [101, "corner"]]);
  });

  it("rebuilds neighbours when tiles are added or removed", () => {
    const { model, collision } = fixture();
    const kits = new Map([[MAP_FENCE_TYPES[0].id, kit(model)]]);
    const id = MAP_FENCE_TYPES[0].id;
    const square = new Map([100, 101, 132, 133].map(index => [index, id]));
    const drawn = rebuildFenceTiles(model, collision, square, new Set(square.keys()), kits, "BW2");
    expect([...readPlacedFenceTiles(drawn).tiles.keys()].sort((a, b) => a - b)).toEqual([100, 101, 132, 133]);
    const fewer = new Map(square); fewer.delete(133);
    const erased = rebuildFenceTiles(drawn, collision, fewer, new Set([133]), kits, "BW2");
    expect([...readPlacedFenceTiles(erased).tiles.keys()].sort((a, b) => a - b)).toEqual([100, 101, 132]);
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
