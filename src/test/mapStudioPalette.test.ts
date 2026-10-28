import { describe, expect, it } from "vitest";
import { deriveStudioLayouts, layoutWithinPalette, remapStudioLayouts, resizeStudioLayout } from "../pokeweb/mapStudioPalette";
import { openStudioWorkspace, readStudioLayouts, saveStudioWorkspace, type StudioTileLayout, type StudioTileset } from "../pokeweb/mapStudioFormats";
import { attachStudioTileset, createStudioTilesetPack, openStudioTilesetPack, saveStudioTilesetPack } from "../pokeweb/mapStudioTilesets";
import { studioFixture } from "./fixtures/mapStudio";

const enc = new TextEncoder();
function tileset(names: string[]): StudioTileset {
  const base = studioFixture().tileset;
  return { materials: base.materials, smart: [], tiles: names.map(name => ({ ...base.tiles[0], name, folder: "Terrain" })) };
}
const pattern = ["dirt_path_corner", "dirt_path_side", "dirt_path_corner", "dirt_path_side", "dirt_path", "dirt_path_side", "dirt_path_corner", "dirt_path_side", "dirt_path_corner"];
const layout: StudioTileLayout = { id: "custom", name: "Dirt path", folder: "Terrain", columns: 3, rows: 3, cells: [0,1,2,3,4,5,6,7,8], extras: [0,2,6,8], source: "custom" };

describe("functional tile arrangements", () => {
  it("reads PDSMS's column-major 5×3 smart grids as a north-up 3×3 with inner corners", () => {
    const ts = tileset(Array(13).fill("grass.obj")); ts.smart = [[[0,5,10],[1,6,11],[2,7,12],[3,8,-1],[4,9,-1]], Array.from({ length: 5 }, () => [-1,-1,-1])];
    const groups = deriveStudioLayouts(ts, enc.encode("smart|0|Paths\n"));
    expect(groups).toHaveLength(1); expect(groups[0].cells).toEqual([10,11,12,5,6,7,0,1,2]); expect(groups[0].extras).toEqual([8,9,3,4]); expect(groups[0].folder).toBe("Paths"); expect(groups[0].source).toBe("smart");
  });
  it("finds a 3×3 path in a source sheet with an eight-tile row stride", () => {
    const names = Array(19).fill("unrelated.obj"), ids = [0,1,2,8,9,10,16,17,18]; ids.forEach((id, i) => names[id] = pattern[i]);
    const groups = deriveStudioLayouts(tileset(names)); expect(groups).toHaveLength(1); expect(groups[0].cells).toEqual([16,17,18,8,9,10,0,1,2]); expect(groups[0].source).toBe("inferred");
  });
  it("uses authored palette slots even when tile IDs were reordered", () => {
    const ids = [8,4,2,6,0,5,1,3,7], names = Array(9).fill(""); ids.forEach((id, i) => names[id] = pattern[i]);
    const meta = "folder|Terrain|8|3|0|0|1|0|0\n" + ids.map((id, i) => `tile|${id}||Terrain|${Math.floor(i / 3) * 8 + i % 3}|1|1`).join("\n");
    const groups = deriveStudioLayouts(tileset(names), enc.encode(meta)); expect(groups).toHaveLength(1); expect(groups[0].cells).toEqual([1,3,7,6,0,5,8,4,2]); expect(groups[0].source).toBe("metadata");
  });
  it("keeps ambiguous families and mismatched materials out of inferred groups", () => {
    const ts = tileset(pattern); ts.materials.push({ ...ts.materials[0], image: "different.png" }); ts.tiles[8].materials = [1]; expect(deriveStudioLayouts(ts)).toEqual([]);
    ts.tiles[8].materials = [0]; ts.tiles[4].name = "water.obj"; expect(deriveStudioLayouts(ts)).toEqual([]);
  });
  it("resizes from the top left, keeps holes and remaps inner corners with imported tile IDs", () => {
    expect(resizeStudioLayout(layout, 4, 2).cells).toEqual([0,1,2,-1,3,4,5,-1]); expect(() => resizeStudioLayout(layout, 0, 3)).toThrow();
    const moved = remapStudioLayouts([{ ...layout, cells: [-1,1,2,3,4,5,6,7,8] }], 10, "library/", "Pack")[0];
    expect(moved.cells).toEqual([-1,11,12,13,14,15,16,17,18]); expect(moved.extras).toEqual([10,12,16,18]); expect(moved.folder).toBe("Pack/Terrain"); expect(moved.id).toBe("library/custom");
    expect(layoutWithinPalette(moved, { id: "lib", name: "Pack", start: 10, count: 9 })).toBe(true); expect(layoutWithinPalette(moved, { id: "lib", name: "Pack", start: 11, count: 7 })).toBe(false);
  });
  it("persists custom layouts in project bundles and portable libraries without changing library identity", () => {
    const ws = studioFixture(), single: StudioTileLayout = { ...layout, cells: Array(9).fill(0), extras: [0,-1,0,-1] }; ws.layouts = [single];
    expect(openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) }).layouts).toEqual([single]);
    const pack = createStudioTilesetPack(ws.files, "Fixture"), identity = saveStudioTilesetPack(pack, false); pack.layouts = [single];
    expect(saveStudioTilesetPack(pack, false)).toEqual(identity);
    const reopened = openStudioTilesetPack({ "pack.zip": saveStudioTilesetPack(pack) }); expect(reopened.layouts).toEqual([single]); expect(saveStudioTilesetPack(reopened, false)).toEqual(identity);
    const appended = attachStudioTileset(ws, reopened, "fixture").workspace; expect(appended.layouts![1].cells).toEqual(Array(9).fill(1)); expect(appended.layouts![1].extras).toEqual([1,-1,1,-1]);
  });
  it("rejects corrupt saved arrangements instead of silently dropping or changing IDs", () => {
    const read = (value: unknown) => readStudioLayouts(enc.encode(JSON.stringify(value)), 9);
    expect(read([layout])).toEqual([layout]); expect(() => read([{ ...layout, cells: [0] }])).toThrow(); expect(() => read([{ ...layout, cells: [99,...layout.cells.slice(1)] }])).toThrow(); expect(() => read([layout,layout])).toThrow();
  });
});
