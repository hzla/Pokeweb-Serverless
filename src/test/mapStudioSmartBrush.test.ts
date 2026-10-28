import { describe, expect, it } from "vitest";
import { newStudioChunk, openStudioWorkspace, saveStudioWorkspace, type StudioTileLayout } from "../pokeweb/mapStudioFormats";
import { StudioHistory, studioCellKey, studioMeshes } from "../pokeweb/mapStudioModel";
import { composeStudioSmartTile, paintStudioSmart, prepareStudioSmartBrush, studioSmartBrushIssue, studioSmartQuarters } from "../pokeweb/mapStudioSmartBrush";
import { writeStudioTileset } from "../pokeweb/mapStudioTilesetWriter";
import { compileStudioChunk } from "../pokeweb/mapStudioCompiler";
import { validateMapNitro } from "../pokeweb/gen5MapImportFormats";
import { studioFixture } from "./fixtures/mapStudio";

function fixture() {
  const ws = studioFixture(), original = ws.tileset.tiles[0], material = ws.tileset.materials[0];
  ws.map.chunks[0].tiles[0].fill(-1);
  ws.tileset.materials = Array.from({ length: 13 }, (_, i) => ({ ...material, name: `piece_${i}` }));
  ws.tileset.tiles = Array.from({ length: 13 }, (_, i) => ({ ...structuredClone(original), name: `Piece ${i}`, materials: [i], folder: undefined }));
  ws.files[ws.tilesetPath] = writeStudioTileset(ws.tileset); delete ws.files[ws.tilesetPath + ".meta"];
  const layout: StudioTileLayout = { id: "terrain", name: "Terrain", folder: "", columns: 3, rows: 3, cells: [0,1,2,3,4,5,6,7,8], extras: [9,10,11,12], source: "custom" };
  ws.layouts = [layout];
  return { ws, layout, history: new StudioHistory(ws) };
}
const read = (ws: ReturnType<typeof fixture>["ws"], x: number, y: number, chunk = 0, layer = 0) => ws.map.chunks[chunk].tiles[layer][y*32+x];
const materials = (ws: ReturnType<typeof fixture>["ws"], id: number) => [...ws.tileset.tiles[id].materials].sort((a,b) => a-b);
function area(tile: ReturnType<typeof fixture>["ws"]["tileset"]["tiles"][number]) {
  let total = 0;
  for (const face of [...tile.quads,...tile.triangles]) for (let f = 1; f < face.v.length-1; f++) {
    const [a,b,c] = [face.v[0],face.v[f],face.v[f+1]].map(i => tile.vertices.slice((i-1)*3,(i-1)*3+3));
    total += Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  }
  return total;
}

describe("layout smart brushes", () => {
  it("paints a narrow path and repairs its previous end without losing geometry", () => {
    const { ws, layout, history } = fixture(); paintStudioSmart(history,layout,0,0,5,5,0);
    expect(materials(ws,read(ws,5,5))).toEqual([0,2,6,8]); expect(area(ws.tileset.tiles[read(ws,5,5)])).toBeCloseTo(1);
    paintStudioSmart(history,layout,0,0,6,5,0);
    expect(materials(ws,read(ws,5,5))).toEqual([0,1,6,7]); expect(materials(ws,read(ws,6,5))).toEqual([1,2,7,8]);
    history.finish(); history.undo(); expect(read(ws,5,5)).toBe(-1); expect(read(ws,6,5)).toBe(-1); expect(Object.keys(ws.smart!.cells)).toHaveLength(0);
    history.redo(); expect(Object.keys(ws.smart!.cells)).toHaveLength(2);
  });
  it("reproduces the exact original 3×3 layout for a solid plot", () => {
    const { ws, layout, history } = fixture();
    for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) paintStudioSmart(history,layout,0,0,x,y,0);
    expect(Array.from({ length: 9 }, (_, i) => read(ws,4+i%3,4+Math.floor(i/3)))).toEqual(layout.cells);
    expect(history.finish()).toBe(true); history.undo(); expect(ws.map.chunks[0].tiles[0].every(id => id === -1)).toBe(true); history.redo(); expect(read(ws,5,5)).toBe(4);
  });
  it("uses all four correctly oriented inner corners around an erased hole", () => {
    const { ws, layout, history } = fixture();
    for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) paintStudioSmart(history,layout,0,0,x,y,0);
    history.finish(); const before = ws.map.chunks[0].tiles[0].slice();
    paintStudioSmart(history,layout,0,0,5,5,0,true); history.finish();
    expect(read(ws,5,5)).toBe(-1); expect([read(ws,4,4),read(ws,6,4),read(ws,4,6),read(ws,6,6)]).toEqual([9,10,11,12]);
    history.undo(); expect(ws.map.chunks[0].tiles[0]).toEqual(before); history.redo(); expect(read(ws,4,4)).toBe(9);
    paintStudioSmart(history,layout,0,0,5,5,0); expect(read(ws,4,4)).toBe(4); expect(read(ws,5,5)).toBe(4);
  });
  it("handles every neighbor mask, including one-cell junctions and multiple inward corners", () => {
    const { ws, layout } = fixture(), brush = prepareStudioSmartBrush(ws,layout), variants = new Set<string>();
    for (let mask = 0; mask < 256; mask++) {
      const quarters = studioSmartQuarters(brush,mask); variants.add(quarters.join(","));
      const tile = composeStudioSmartTile(ws,brush,quarters); expect(area(tile)).toBeCloseTo(1);
      expect(tile.vertices.every(Number.isFinite)).toBe(true); expect(tile.uvs.every(Number.isFinite)).toBe(true);
    }
    expect(variants.size).toBe(47);
    expect(studioSmartQuarters(brush,2|8|16|64)).toEqual([12,11,10,9]);
  });
  it("keeps brush ownership distinct even when two layouts share a center tile", () => {
    const { ws, layout, history } = fixture(), other = { ...layout, id: "other", name: "Other" }; ws.layouts!.push(other);
    paintStudioSmart(history,layout,0,0,4,4,0); paintStudioSmart(history,layout,0,0,5,4,0); paintStudioSmart(history,layout,0,0,6,4,0);
    paintStudioSmart(history,other,0,0,5,4,0);
    expect(ws.smart!.cells[studioCellKey(0,0,4*32+5)]).toBe("other");
    expect(materials(ws,read(ws,4,4))).toEqual([0,2,6,8]); expect(materials(ws,read(ws,6,4))).toEqual([0,2,6,8]);
    paintStudioSmart(history,layout,0,0,5,4,0,true); expect(read(ws,5,4)).not.toBe(-1);
  });
  it("separates layers and height levels and repairs both levels when a cell is raised", () => {
    const { ws, layout, history } = fixture(); paintStudioSmart(history,layout,0,0,4,4,0); paintStudioSmart(history,layout,0,0,5,4,0);
    paintStudioSmart(history,layout,0,0,5,4,3); paintStudioSmart(history,layout,0,1,4,4,0);
    expect(materials(ws,read(ws,4,4))).toEqual([0,2,6,8]); expect(materials(ws,read(ws,5,4))).toEqual([0,2,6,8]); expect(materials(ws,read(ws,4,4,0,1))).toEqual([0,2,6,8]);
    expect(ws.map.chunks[0].heights[0][4*32+5]).toBe(3);
    paintStudioSmart(history,layout,0,0,5,4,0,true); expect(read(ws,5,4)).toBe(-1);
  });
  it("joins across chunk seams, including negative chunk coordinates", () => {
    const { ws, layout, history } = fixture(); ws.map.chunks[0].x = -2; ws.map.chunks[0].y = -1; ws.map.chunks.push(newStudioChunk(-1,-1));
    paintStudioSmart(history,layout,0,0,31,5,0); paintStudioSmart(history,layout,1,0,0,5,0);
    expect(materials(ws,read(ws,31,5))).toEqual([0,1,6,7]); expect(materials(ws,read(ws,0,5,1))).toEqual([1,2,7,8]);
    history.finish(); paintStudioSmart(history,layout,1,0,0,5,0,true); history.finish(); expect(materials(ws,read(ws,31,5))).toEqual([0,2,6,8]);
    history.undo(); expect(materials(ws,read(ws,31,5))).toEqual([0,1,6,7]);
  });
  it("preserves 3D heights, UV interpolation, vertex colors and material groups while clipping quarters", () => {
    const { ws, layout } = fixture(); for (const tile of ws.tileset.tiles) { tile.z = 1.25; for (let i = 0; i < tile.vertices.length; i += 3) tile.vertices[i+2] = tile.vertices[i]*2+tile.vertices[i+1]*0.5; tile.colors = [0.2,0.4,0.6]; }
    const brush = prepareStudioSmartBrush(ws,layout), tile = composeStudioSmartTile(ws,brush,studioSmartQuarters(brush,0));
    expect(area(tile)).toBeCloseTo(1);
    for (let i = 0; i < tile.vertices.length/3; i++) { expect(tile.vertices[i*3+2]).toBeCloseTo(1.25+tile.vertices[i*3]*2+tile.vertices[i*3+1]*0.5); expect(tile.uvs[i*2]).toBeCloseTo(tile.vertices[i*3]); expect(tile.uvs[i*2+1]).toBeCloseTo(tile.vertices[i*3+1]); expect(tile.colors.slice(i*3,i*3+3)).toEqual([0.2,0.4,0.6]); }
  });
  it("saves generated native-compatible tiles and resumes smart painting after reopening", () => {
    const { ws, layout, history } = fixture(); paintStudioSmart(history,layout,0,0,4,4,0); paintStudioSmart(history,layout,0,0,5,4,0); history.finish();
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) }); expect(reopened.map).toEqual(ws.map); expect(reopened.smart).toEqual(ws.smart); expect(reopened.tileset.tiles).toHaveLength(ws.tileset.tiles.length);
    const count = reopened.tileset.tiles.length, h = new StudioHistory(reopened); paintStudioSmart(h,reopened.layouts![0],0,0,4,4,0); expect(reopened.tileset.tiles).toHaveLength(count);
    paintStudioSmart(h,reopened.layouts![0],0,0,6,4,0); expect(Object.keys(reopened.smart!.cells)).toHaveLength(3);
    const compiled = compileStudioChunk(reopened,0,0); validateMapNitro(compiled.model,"BMD0"); validateMapNitro(compiled.textures,"BTX0"); expect(studioMeshes(reopened,reopened.map.chunks[0]).length).toBeGreaterThan(1);
  });
  it("reports missing pieces without partially applying a point, and can cancel an entire stroke", () => {
    const { ws, layout, history } = fixture(); layout.extras = undefined;
    paintStudioSmart(history,layout,0,0,5,5,0); paintStudioSmart(history,layout,0,0,6,5,0); const before = ws.map.chunks[0].tiles[0].slice();
    expect(() => paintStudioSmart(history,layout,0,0,5,6,0)).toThrow(/inner-corner slot/); expect(ws.map.chunks[0].tiles[0]).toEqual(before);
    history.cancelStroke(); expect(history.finish()).toBe(false); expect(history.canUndo).toBe(false); expect(ws.map.chunks[0].tiles[0].every(id => id === -1)).toBe(true);
    layout.columns = 4; expect(studioSmartBrushIssue(ws,layout)).toMatch(/3×3/);
  });
  it("preserves a hollow center as logical brush terrain across save, erase and undo", () => {
    const { ws,layout,history } = fixture(); layout.cells[4] = -1;
    for (let y = 3; y < 8; y++) for (let x = 3; x < 8; x++) paintStudioSmart(history,layout,0,0,x,y,0);
    history.finish(); expect(read(ws,5,5)).toBe(-1); expect(ws.smart!.cells[studioCellKey(0,0,5*32+5)]).toBe(layout.id);
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) }); expect(reopened.smart).toEqual(ws.smart);
    paintStudioSmart(history,layout,0,0,5,5,0,true); history.finish(); expect(read(ws,4,4)).toBe(9); expect(ws.smart!.cells[studioCellKey(0,0,5*32+5)]).toBeUndefined();
    history.undo(); expect(read(ws,4,4)).toBe(-1); expect(ws.smart!.cells[studioCellKey(0,0,5*32+5)]).toBe(layout.id);
  });
  it("retains source overhangs while dividing geometry at quarter boundaries", () => {
    const { ws,layout } = fixture(); for (const tile of ws.tileset.tiles) for (let i = 0; i < tile.vertices.length; i += 3) { tile.vertices[i] = tile.vertices[i]*1.5-0.25; tile.vertices[i+1] = tile.vertices[i+1]*1.5-0.25; }
    const brush = prepareStudioSmartBrush(ws,layout), tile = composeStudioSmartTile(ws,brush,studioSmartQuarters(brush,0));
    expect(area(tile)).toBeCloseTo(2.25); expect(Math.min(...tile.vertices.filter((_,i) => i%3 === 0))).toBeCloseTo(-0.25); expect(Math.max(...tile.vertices.filter((_,i) => i%3 === 0))).toBeCloseTo(1.25);
  });
  it("bakes mixed global and local UV mapping at the correct position and texture period", () => {
    const { ws,layout } = fixture(); ws.tileset.tiles[0].globalMapping = true; ws.tileset.tiles[0].globalScale = 0.25;
    const brush = prepareStudioSmartBrush(ws,layout); expect(brush.bakeMapping).toBe(true);
    const tile = composeStudioSmartTile(ws,brush,studioSmartQuarters(brush,0),{ x: 17,y:18 }); expect(tile.globalMapping).toBe(false);
    const materialIndex = tile.materials.indexOf(0), start = tile.triOffsets[materialIndex], end = tile.triOffsets[materialIndex+1] ?? tile.triangles.length;
    for (const face of tile.triangles.slice(start,end)) for (const id of face.v) { expect(tile.uvs[(id-1)*2]).toBeCloseTo(tile.vertices[(id-1)*3]*0.25+0.25); expect(tile.uvs[(id-1)*2+1]).toBeCloseTo(tile.vertices[(id-1)*3+1]*0.25+0.5); }
    const history = new StudioHistory(ws); paintStudioSmart(history,layout,0,0,1,1,0); const count = ws.tileset.tiles.length;
    paintStudioSmart(history,layout,0,0,5,5,0); expect(read(ws,1,1)).toBe(read(ws,5,5)); expect(ws.tileset.tiles).toHaveLength(count);
    paintStudioSmart(history,layout,0,0,10,10,0); expect(read(ws,10,10)).not.toBe(read(ws,1,1));
  });
});
