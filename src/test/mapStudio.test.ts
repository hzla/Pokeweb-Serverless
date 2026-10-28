import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readU16 } from "../nds/binary";
import { canOpenMapStudio } from "../pokeweb/mapStudioAccess";
import { findStudioAsset, newStudioChunk, openStudioWorkspace, parseStudioMap, parseStudioTileset, saveStudioWorkspace, studioPath, writeStudioMap } from "../pokeweb/mapStudioFormats";
import { StudioHistory, studioMeshes, studioSurface } from "../pokeweb/mapStudioModel";
import { compileStudioChunk, compileStudioPermissions } from "../pokeweb/mapStudioCompiler";
import { readNitroResources, buildModelPrimitives } from "../pokeweb/map3dModel";
import { validateGen5Permissions, validateMapNitro } from "../pokeweb/gen5MapImportFormats";
import { studioFixture } from "./fixtures/mapStudio";
import { distances } from "../pokeweb/mapStudioHeightTables";
import { optimizeStudioMesh } from "../pokeweb/mapStudioGeometry";
import { writeStaticNitroModel } from "../pokeweb/nitroModelWriter";
import { nitroBlocks, readDictionary } from "../pokeweb/nitroResourceWriter";
import { readU32 } from "../nds/binary";

describe("Map Studio access and performance boundary", () => {
  it("allows only exact loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) expect(canOpenMapStudio(host)).toBe(true);
    for (const host of ["", "pokeweb.example", "localhost.example", "127.0.0.1.example", "192.168.1.1", "0.0.0.0"]) expect(canOpenMapStudio(host)).toBe(false);
  });
  it("loads its UI dynamically and keeps authoring out of ordinary project persistence", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    expect(main).toContain('import("./ui/mapStudioEditor")');
    expect(main).not.toMatch(/^import .*from ["'].*mapStudio(?:Editor|Model|Formats|Compiler)/mu);
    expect(main).not.toContain('import "./styles/mapStudio.css"');
    const document = readFileSync(new URL("../pokeweb/projectDocument.ts", import.meta.url), "utf8"); expect(document).not.toContain("mapStudio");
  });
});
describe("PDSMS project compatibility", () => {
  it("round-trips all nine layers, metadata, coordinates and untouched assets through a ZIP", () => {
    const ws = studioFixture(); ws.map.chunks[0].tiles[8][1023] = 0; ws.map.chunks[0].heights[8][1023] = -4;
    ws.map.chunks[0].area = 3; ws.map.chunks[0].group = 2; ws.map.chunks[0].center = true;
    ws.map.chunks.push(newStudioChunk(3, 7));
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) });
    expect(reopened.map).toEqual(ws.map); expect(reopened.tileset).toEqual(ws.tileset);
    for (const path of Object.keys(ws.files).filter(p => !p.endsWith(".pdsmap"))) expect(reopened.files[path]).toEqual(ws.files[path]);
  });
  it("retains Gen 4 authoring metadata and rejects malformed grids, invalid tile indices and escaped references", () => {
    const ws = studioFixture(), text = writeStudioMap(ws.map);
    expect(parseStudioMap(text.replace("gameindex\n8", "gameindex\n3")).game).toBe(3);
    expect(() => parseStudioMap(text.replace("gameindex\n8", "gameindex\n99"))).toThrow(/Unsupported/);
    expect(() => parseStudioMap(text.replace("-1 -1 -1", "-1 -1"))).toThrow(/32 rows/);
    expect(() => parseStudioTileset(ws.files[ws.tilesetPath].slice(0, 23))).toThrow(/Truncated/);
    expect(() => studioPath("../../private" )).toThrow(/escapes/);
    expect(() => studioPath("https://example.invalid/texture.png")).toThrow(/relative/);
    expect(() => findStudioAsset(ws.files, ws.tilesetPath, "missing.png")).toThrow(/Missing/);
    ws.map.chunks[0].tiles[0][0] = 999;
    expect(() => openStudioWorkspace({ ...ws.files, [ws.mapPath]: new TextEncoder().encode(writeStudioMap(ws.map)) })).toThrow(/absent/);
  });
  it("preserves desktop NaNs in UV data while blocking native compilation of drawn invalid UVs", () => {
    const ws = studioFixture(), bytes = ws.files[ws.tilesetPath].slice();
    const at = bytes.findIndex((b, i) => b === 16 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 0 && bytes[i + 4] === 8);
    expect(at).toBeGreaterThan(0); new DataView(bytes.buffer).setFloat32(at + 5, NaN);
    ws.files[ws.tilesetPath] = bytes; const reopened = openStudioWorkspace(ws.files);
    expect(Number.isNaN(reopened.tileset.tiles[0].uvs[0])).toBe(true);
    expect(() => compileStudioChunk(reopened, 0, 0)).toThrow(/finite/);
    expect(openStudioWorkspace({ "saved.zip": saveStudioWorkspace(reopened) }).files[ws.tilesetPath]).toEqual(bytes);
  });
  const real = new URL("../../../reference_repos/Pokemon-DS-Map-Studio/src/main/resources/tilesets/Black_-_White/Overworld/BlackWhiteTileset.pdsts", import.meta.url);
  it.skipIf(!existsSync(real))("opens a real upstream Gen 5 tileset", () => {
    const tiles = parseStudioTileset(new Uint8Array(readFileSync(real))); expect(tiles.tiles.length).toBeGreaterThan(100); expect(tiles.materials.length).toBeGreaterThan(1);
  });
});
describe("painting and undo", () => {
  it("makes an entire drag one undo, retaining independent layer heights", () => {
    const ws = studioFixture(), history = new StudioHistory(ws), c = ws.map.chunks[0];
    for (let x = 0; x < 10; x++) history.paint(0, 2, x, 4, 0, 3, "paint");
    history.paint(0, 2, 5, 4, 0, 7, "height"); expect(history.finish()).toBe(true); expect(c.heights[2][133]).toBe(7);
    expect(c.tiles[0][0]).toBe(0); history.undo(); expect(c.tiles[2].every(id => id === -1)).toBe(true);
    history.redo(); expect(c.heights[2][133]).toBe(7); expect(c.tiles[2][128]).toBe(0);
    history.paint(0, 2, 0, 4, 0, 0, "erase"); history.finish(); history.undo(); expect(c.heights[2][128]).toBe(3);
  });
  it("fills only connected cells with matching tile and height, and invalidates redo after a new command", () => {
    const ws = studioFixture(), h = new StudioHistory(ws), c = ws.map.chunks[0]; c.tiles[0].fill(0); c.heights[0].fill(1); for (let y = 0; y < 32; y++) c.heights[0][y * 32 + 4] = 2;
    h.paint(0, 0, 0, 0, 0, 5, "fill"); h.finish(); expect(c.heights[0][3]).toBe(5); expect(c.heights[0][5]).toBe(1);
    h.undo(); h.paint(0, 0, 0, 0, 0, 3, "height"); h.finish(); expect(h.canRedo).toBe(false);
  });
});
describe("native terrain compilation", () => {
  it("merges repeated ground textures while retaining clamped atlas boundaries", () => {
    const ws = studioFixture(), chunk = ws.map.chunks[0]; chunk.tiles[0][1] = 0;
    const mesh = studioMeshes(ws, chunk)[0], material = ws.tileset.materials[mesh.material];
    const optimized = optimizeStudioMesh(mesh, material);
    expect(optimized.indices).toHaveLength(6); expect(Math.max(...optimized.positions.filter((_, i) => i % 3 === 0)) - Math.min(...optimized.positions.filter((_, i) => i % 3 === 0))).toBe(2);
    expect(optimizeStudioMesh(mesh, { ...material, repeatU: 1, repeatV: 1 }).indices).toHaveLength(12);
  });
  it("writes native quad strips with six submitted vertices for two quads and preserves their winding", () => {
    const ws = studioFixture(), template = compileStudioChunk(ws, 0, 0).model;
    const model = writeStaticNitroModel(template, [{ materialName: "ms_mat_0", positions: new Float32Array([0,0,0, 0,0,1, 1,0,1, 1,0,0, 2,0,1, 2,0,0]), uvs: new Float32Array([0,0, 0,1, 1,1, 1,0, 2,1, 2,0]), indices: new Uint32Array([0,1,2, 0,2,3, 3,2,4, 3,4,5]) }], { stripify: true });
    const mdl = nitroBlocks(model)[0], offset = readU32(readDictionary(mdl, 8)[0].data, 0);
    expect(readU16(mdl, offset + 36)).toBe(6); expect(readU16(mdl, offset + 38)).toBe(2);
    const warnings: string[] = [], primitives = buildModelPrimitives(readNitroResources(model), warnings);
    expect(warnings).toEqual([]); expect(primitives[0].indices).toHaveLength(12);
    const p = primitives[0]; let area = 0;
    for (let i = 0; i < p.indices.length; i += 3) { const [a,b,c] = Array.from(p.indices.slice(i,i+3), n => Array.from(p.positions.slice(n*3,n*3+3))); const cross = (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]); expect(cross).toBeGreaterThan(0); area += cross / 2; }
    expect(area).toBe(2);
  });
  it("builds fresh model/material/texture dictionaries and native geometry without a ROM template", () => {
    const ws = studioFixture(), result = compileStudioChunk(ws, 0, 0);
    validateMapNitro(result.model, "BMD0"); validateMapNitro(result.textures, "BTX0"); validateGen5Permissions(result.permissions);
    const resources = readNitroResources(result.model), texture = readNitroResources(result.textures); resources.textures.push(...texture.textures); resources.palettes.push(...texture.palettes);
    const warnings: string[] = [], primitives = buildModelPrimitives(resources, warnings);
    expect(warnings).toEqual([]); expect(primitives).toHaveLength(1); expect(primitives[0].material.texture).toBeDefined(); expect(primitives[0].indices).toHaveLength(6);
    expect(Math.min(...primitives[0].positions.filter((_, i) => i % 3 === 0))).toBeCloseTo(-256);
    expect(readU16(result.permissions, 4 + 6) & 1).toBe(0); expect(readU16(result.permissions, 12 + 6) & 1).toBe(1);
  });
  it.each([5, 8])("uses game %s's height table and blocks uncovered cells", game => {
    const ws = studioFixture(); ws.map.game = game; ws.map.chunks[0].heights[0][0] = 2;
    const per = compileStudioPermissions(ws, ws.map.chunks[0], 0); validateGen5Permissions(per); expect(distances[game < 7 ? 0 : 1][readU16(per, 6)]).toBeCloseTo(2, 2);
    const mesh = studioMeshes(ws, ws.map.chunks[0]); expect(studioSurface(mesh, -15.5, -15.5)).toBe(2);
  });
});
