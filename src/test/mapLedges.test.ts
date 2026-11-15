import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU32 } from "../nds/binary";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { decodeFaces } from "../pokeweb/mapBrushGeometry";
import { terrainModelLayout } from "../pokeweb/mapGrassGeometry";
import { appendMapLedges, ledgeTiles, readPlacedLedges, type LedgeDirection, type LedgeTemplate } from "../pokeweb/mapLedges";
import { materialRecords, nitroBlocks, readDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { mapBin } from "./fixtures/gen5MapImport";

function terrain() {
  const original = readGen5MapBin(mapBin()).files[0], blocks = nitroBlocks(original);
  const model = readU32(readDictionary(blocks[0], 8)[0].data, 0);
  writeU32(blocks[0], model + 28, 64 * 4096);
  writeU32(blocks[0], model + 32, 4096 / 64);
  return writeNitroFile(original, blocks);
}

/** One quad per piece, marked by its texture coordinate: 1 = first tile, 2 = middle, 3 = last. */
function template(model: Uint8Array, direction: LedgeDirection): LedgeTemplate {
  const record = { ...materialRecords(model)[0], name: "dansa01a", textureName: "dansa01a", paletteName: "dansa01a_pl" };
  const shapeHeader = terrainModelLayout(model).shapes[0].header.slice();
  const piece = (mark: number) => ({ record, shapeHeader, faces: [[[0, 0, 8], [16, 0, 8], [16, 4, 10], [0, 4, 10]].map(([a, y, c]) => ({ position: [a, y, c] as const, texcoord: mark }))] });
  return { direction, pieces: { start: piece(1), middle: piece(2), end: piece(3) } };
}

describe("map ledges", () => {
  it("builds a ledge of any length from its first, middle and last tiles and removes it again", () => {
    const model = terrain(), before = terrainModelLayout(model);
    const placed = appendMapLedges(model, [
      { startIndex: 4 * 32 + 10, length: 5, ground: 16, template: template(model, "left") },
      { startIndex: 20 * 32 + 3, length: 2, ground: 0, template: template(model, "down") },
    ]);
    const layout = terrainModelLayout(placed);
    const faces = decodeFaces(layout.shapes.find(shape => shape.name === "l1_dansa01a")!.list, layout.scale);
    // Left/right ledges run down a column: along is z, across is x.
    expect(faces.slice(0, 5).map(face => [face[0].texcoord, face[0].position])).toEqual([
      [1, [-88, 16, -192]], [2, [-88, 16, -176]], [2, [-88, 16, -160]], [2, [-88, 16, -144]], [3, [-88, 16, -128]],
    ]);
    // Up/down ledges run along a row: along is x, across is z.
    expect(faces.slice(5).map(face => [face[0].texcoord, face[0].position])).toEqual([[1, [-208, 0, 72]], [3, [-192, 0, 72]]]);
    const read = readPlacedLedges(placed);
    expect([...read.ledges.values()]).toEqual([
      { member: 1, startIndex: 138, length: 5, direction: "left" },
      { member: 1, startIndex: 643, length: 2, direction: "down" },
    ]);
    const restored = terrainModelLayout(readPlacedLedges(read.remove(new Set(read.ledges.keys()))).remove(new Set()));
    expect([36, 38, 42].map(at => readU16(restored.original, at))).toEqual([36, 38, 42].map(at => readU16(before.original, at)));
  });

  it("lists the tiles a ledge covers", () => {
    expect(ledgeTiles(100, 3, "right")).toEqual([100, 132, 164]);
    expect(ledgeTiles(100, 3, "up")).toEqual([100, 101, 102]);
  });
});
