import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { attachStudioTileset, createStudioTilesetPack, openStudioTilesetPack, saveStudioTilesetPack, writeStudioTileset } from "../pokeweb/mapStudioTilesets";
import { findStudioAsset, openStudioWorkspace, parseStudioTileset, saveStudioWorkspace } from "../pokeweb/mapStudioFormats";
import { compileStudioChunk } from "../pokeweb/mapStudioCompiler";
import { StudioHistory } from "../pokeweb/mapStudioModel";
import { validateMapNitro } from "../pokeweb/gen5MapImportFormats";
import { studioFixture } from "./fixtures/mapStudio";

const enc = new TextEncoder(), dec = new TextDecoder();
function source(name = "Grass") {
  const ws = studioFixture(); ws.tileset.tiles[0].name = name;
  return { "set.pdsts": writeStudioTileset(ws.tileset), "ground.png": ws.files["project/ground.png"], "set.pdsts.meta": enc.encode(`folder|Terrain|8|4|0|0|1|0|0\ntile|0|${name}|Terrain|2|1|1|2|3|0|1|0,0,0,02\nmembership|0|Favorites|0\nsmart|0|Terrain\n`) };
}

describe("reusable Map Studio tilesets", () => {
  it("retains geometry, material flags, tiling and desktop nonfinite unused attributes", () => {
    const ws = studioFixture(); const t = ws.tileset.tiles[0], m = ws.tileset.materials[0];
    t.tileX = false; t.tileY = true; t.normals.push(NaN, NaN, NaN); t.globalMapping = true; t.globalScale = 0.5;
    Object.assign(m, { normalOrientation: false, includeInImd: true, renderBorder: true, colorFormat: 4 });
    expect(parseStudioTileset(writeStudioTileset(ws.tileset))).toEqual({ ...ws.tileset, tiles: ws.tileset.tiles.map(({ folder: _, ...tile }) => tile) });
  });
  it("combines sets with colliding filenames, remaps materials and smart IDs, and preserves metadata defaults", () => {
    const a = source("First"), b = source("Second");
    const set = parseStudioTileset(b["set.pdsts"]); set.smart = [[[0, -1]]]; b["set.pdsts"] = writeStudioTileset(set);
    b["ground.png"] = b["ground.png"].slice(); b["ground.png"][b["ground.png"].length - 1] ^= 1;
    const input = Object.fromEntries([...Object.entries(a).map(([p, v]) => [`A/${p}`, v]), ...Object.entries(b).map(([p, v]) => [`B/${p}`, v])]);
    const pack = createStudioTilesetPack(input, "Combined");
    expect(pack.tileset.tiles.map(t => t.name)).toEqual(["First", "Second"]);
    expect(pack.tileset.tiles.map(t => t.materials)).toEqual([[0], [1]]); expect(pack.tileset.smart).toEqual([[[1, -1]]]);
    expect(pack.tileset.tiles.map(t => t.folder)).toEqual(["A/Terrain", "B/Terrain"]);
    const meta = dec.decode(pack.files["tileset.pdsts.meta"]); expect(meta).toContain("tile|1|Second|B/Terrain|2|1|1|2|3|0|1|0,0,0,02"); expect(meta).toContain("membership|1|B/Favorites|0");
    const images = pack.tileset.materials.map(m => findStudioAsset(pack.files, pack.tilesetPath, m.image));
    expect(images[0]).not.toBe(images[1]); expect(pack.files[images[0]]).toEqual(a["ground.png"]); expect(pack.files[images[1]]).toEqual(b["ground.png"]);
    const zip = saveStudioTilesetPack(pack); expect(saveStudioTilesetPack(pack)).toEqual(zip);
    const reopened = openStudioTilesetPack({ "pack.zip": zip }); expect(reopened.tileset).toEqual(pack.tileset); expect(reopened.sourceCount).toBe(2);
  });
  it("adds tiles without replacing cells, preserves undo, avoids duplicate imports and survives project save/reopen", () => {
    const ws = studioFixture(), history = new StudioHistory(ws), map = ws.map;
    history.paint(0, 2, 3, 4, 0, 3, "paint"); history.finish();
    const pack = createStudioTilesetPack(source("New ground"), "Library"), { workspace: next, palette } = attachStudioTileset(ws, pack, "fixture");
    expect(next.map).toBe(map); expect(next.map.chunks[0].tiles[2][131]).toBe(0); expect(palette.start).toBe(1); expect(next.tileset.tiles[1].materials).toEqual([1]);
    Object.assign(ws, { files: next.files, tileset: next.tileset, palettes: next.palettes });
    history.undo(); expect(map.chunks[0].tiles[2][131]).toBe(-1); history.redo(); expect(map.chunks[0].heights[2][131]).toBe(3);
    history.paint(0, 0, 1, 0, 1, 0, "paint"); history.finish();
    const duplicate = attachStudioTileset(ws, pack, "fixture"); expect(duplicate.workspace).toBe(ws); expect(duplicate.workspace.tileset.tiles).toHaveLength(2);
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(ws) });
    expect(reopened.map).toEqual(ws.map); expect(reopened.tileset).toEqual(ws.tileset); expect(reopened.palettes).toEqual(ws.palettes);
    expect(reopened.files["project/ground.png"]).toEqual(ws.files["project/ground.png"]);
    const compiled = compileStudioChunk(reopened, 0, 0); validateMapNitro(compiled.model, "BMD0"); validateMapNitro(compiled.textures, "BTX0");
  });
  it("starts a paintable empty map from a library without loading source projects or ROM data", () => {
    const pack = createStudioTilesetPack({ ...source(), "irrelevant.pdsmap": enc.encode("not a project"), "source-ROM.nds": Uint8Array.of(1, 2, 3) }, "Standalone");
    expect(pack.files["irrelevant.pdsmap"]).toBeUndefined(); expect(pack.files["source-ROM.nds"]).toBeUndefined();
    const { workspace } = attachStudioTileset(undefined, pack, "standalone", 5);
    expect(workspace.map.game).toBe(5); expect(workspace.map.chunks[0].tiles[0].every(id => id === -1)).toBe(true);
    const history = new StudioHistory(workspace); history.paint(0, 0, 0, 0, 0, 0, "paint"); history.finish();
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(workspace) }); expect(reopened.map).toEqual(workspace.map); validateMapNitro(compileStudioChunk(reopened, 0, 0).model, "BMD0");
  });
  it("preserves escaped display names and folder names through repeated imports", () => {
    const ws = studioFixture(); ws.tileset.tiles[0].name = "Grass | \\path";
    const pack = createStudioTilesetPack({ "set.pdsts": writeStudioTileset(ws.tileset), "ground.png": ws.files["project/ground.png"] }, "Set | \\pack");
    const { workspace } = attachStudioTileset(undefined, pack, "escaped");
    const second = attachStudioTileset(workspace, pack, "escaped2").workspace;
    const reopened = openStudioWorkspace({ "saved.zip": saveStudioWorkspace(second) });
    expect(reopened.tileset.tiles.map(t => t.name)).toEqual(["Grass | \\path", "Grass | \\path"]); expect(reopened.tileset.tiles.map(t => t.folder)).toEqual(["Set | \\pack", "Set | \\pack"]);
  });
  it("rejects missing textures, remote manifest references and unsafe archive paths before attaching", () => {
    const files = source(); delete (files as Record<string, Uint8Array>)["ground.png"];
    expect(() => createStudioTilesetPack(files, "Broken")).toThrow(/Missing/);
    expect(() => openStudioTilesetPack({ "unsafe.zip": zipSync({ "../escape.pdsts": Uint8Array.of(0) }) })).toThrow(/escapes/);
    expect(() => openStudioTilesetPack({ "mapstudio-tileset.json": enc.encode(JSON.stringify({ format: "pokeweb-map-studio-tileset", version: 1, name: "Remote", tileset: "https://example.invalid/remote.pdsts" })) })).toThrow();
    expect(() => attachStudioTileset(studioFixture(), createStudioTilesetPack(source(), "Pack"), "../bad")).toThrow(/Invalid/);
  });
});
