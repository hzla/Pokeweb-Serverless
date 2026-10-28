import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { applyGen5MapImport, prepareGen5MapImport, stageGen5MapDestination, undoGen5MapImport, type Gen5MapImportTarget } from "../pokeweb/gen5MapImport";
import { mergeGen5MapTextures, readGen5MapBin, validateGen5Permissions } from "../pokeweb/gen5MapImportFormats";
import { decodeTexture, loadMap3dZone, packGameFreakContainer, readNitroResources } from "../pokeweb/map3dModel";
import { getMatrixSnapshot, applyMatrixCellEdit } from "../pokeweb/matrixModel";
import { getMapReplacementBytes, resolveSeasonalMatrix, setSeasonalAssignment } from "../pokeweb/seasonalMatrixModel";
import { materialRecords, nitroBlocks, readDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { gen5ImportProject, mapBin, mapModel, mapPermissions, mapTextures } from "./fixtures/gen5MapImport";

const target: Gen5MapImportTarget = { matrixId: 0, x: 0, y: 0, headerId: 0, season: "winter" };
describe("Gen 5 native map formats", () => {
  it("distinguishes a second PER from placements and retains opaque members", () => {
    for (const second of [false, true]) {
      const parsed = readGen5MapBin(mapBin(second));
      expect(parsed.placements).toBe(second ? 3 : 2); expect(parsed.files.at(-1)).toEqual(Uint8Array.of(9, 8, 7, 6));
    }
  });
  it("rejects Gen 4 BINs, overlapping offsets and truncated collision corner references", () => {
    expect(() => readGen5MapBin(new Uint8Array(16))).toThrow("Gen 4");
    const bin = mapBin(); writeU32(bin, 4, 0); expect(() => readGen5MapBin(bin)).toThrow("header");
    const per = mapPermissions(true); expect(() => validateGen5Permissions(per)).not.toThrow();
    writeU16(per, 6, 1); expect(() => validateGen5Permissions(per)).toThrow("corner");
    expect(() => validateGen5Permissions(new Uint8Array(2048))).toThrow("32");
  });
  it.each([false, true])("copies native textures without changing decoded pixels (compressed=%s)", compressed => {
    const model = mapModel(), old = mapTextures(), source = mapTextures(0x7c00, compressed);
    const result = mergeGen5MapTextures(old, source, model), resources = readNitroResources(result.textures), native = readNitroResources(source);
    const material = materialRecords(result.model)[0], texture = resources.textures.find(t => t.name === material.textureName)!, palette = resources.palettes.find(p => p.name === material.paletteName)!;
    expect(decodeTexture(texture, palette)?.rgba).toEqual(decodeTexture(native.textures[0], native.palettes[0])?.rgba);
    expect(decodeTexture(resources.textures[0], resources.palettes[0])?.rgba).toEqual(decodeTexture(readNitroResources(old).textures[0], readNitroResources(old).palettes[0])?.rgba);
    expect(texture.data1).toEqual(native.textures[0].data1); expect(texture.data2).toEqual(native.textures[0].data2);
    const again = mergeGen5MapTextures(result.textures, source, model); expect(again.textures).toEqual(result.textures); expect(again.model).toEqual(result.model); expect(again.added).toBe(0);
  });
  it("rejects truncated compressed banks and over-budget native texture data", () => {
    const broken = nitroBlocks(mapTextures(31, true)); writeU16(broken[0], 28, 1);
    expect(() => mergeGen5MapTextures(mapTextures(), writeNitroFile(mapTextures(), broken), mapModel())).toThrow("pixel bounds");
    const block = nitroBlocks(mapTextures())[0], expanded = new Uint8Array(300 * 1024 + block.length); expanded.set(block);
    writeU32(expanded, 4, expanded.length); writeU16(expanded, 12, 300 * 1024 / 8);
    expect(() => mergeGen5MapTextures(mapTextures(), writeNitroFile(mapTextures(), [expanded]), mapModel())).toThrow("memory budget");
  });
});

describe.each(["BW", "BW2"] as const)("%s map import", game => {
  it("previews without changing the project, preserves opaque data and other seasons, then applies and undoes", async () => {
    const project = gen5ImportProject(game), before = createProjectDocument(project, false), per = mapPermissions(true); writeU16(per, 8, 0x1234);
    const result = await prepareGen5MapImport(project, { game, permissions: per }, target);
    expect(createProjectDocument(project, false)).toEqual(before); expect(result.changes.length).toBeGreaterThan(0);
    await applyGen5MapImport(project, result);
    const scene = await loadMap3dZone(project, 0, { season: "winter" }); expect(scene.chunks[0].chunkId).toBe(result.mapId);
    const files = readGen5MapBin(project.narcs.maps!.rawFiles[result.mapId]).files;
    expect(files[1]).toEqual(per); expect(files[0]).toEqual(mapModel()); expect(files.at(-1)).toEqual(Uint8Array.of(9, 8, 7, 6));
    for (const season of ["spring", "summer", "autumn"] as const) {
      const id = resolveSeasonalMatrix(project, 0, season).cells[0].mapId; expect(project.narcs.maps!.rawFiles[id]).toEqual(before.narcs.maps!.rawFiles[0]);
    }
    await undoGen5MapImport(project, result); expect(project.narcs.maps!.rawFiles).toEqual(before.narcs.maps!.rawFiles); expect(getMapReplacementBytes(project).length).toBe(0);
  });
  it("produces no patches for identical model/PER/BIN inputs", async () => {
    for (const input of [{ model: mapModel() }, { permissions: mapPermissions() }, { bin: mapBin() }]) {
      const result = await prepareGen5MapImport(gen5ImportProject(game), { game, ...input }, target); expect(result.changes).toEqual([]);
    }
  });
  it("imports embedded textures and adds a cell in every season; export and project reopen retain new entries", async () => {
    const project = gen5ImportProject(game), embedded = writeNitroFile(mapModel(), [...nitroBlocks(mapModel()), ...nitroBlocks(mapTextures(0x7c00, true))]);
    const result = await prepareGen5MapImport(project, { game, model: embedded, permissions: mapPermissions(), secondaryPermissions: mapPermissions(true) }, { ...target, x: 2 });
    await applyGen5MapImport(project, result); expect(result.newCell).toBe(true);
    for (const season of ["spring", "summer", "autumn", "winter"] as const) expect(resolveSeasonalMatrix(project, 0, season).cells[2]).toMatchObject({ mapId: result.mapId, headerId: 0 });
    const reopened = openProjectSession(structuredClone(createProjectDocument(project, false))); expect(reopened.narcs.maps!.rawFiles).toEqual(project.narcs.maps!.rawFiles);
    const rom = new NintendoDSRom(await exportModifiedRom(project)), maps = new NARC(rom.getFileByName("a/0/0/8"));
    expect(maps.files[result.mapId]).toEqual(project.narcs.maps!.rawFiles[result.mapId]); expect(readGen5MapBin(maps.files[result.mapId]).placements).toBe(3);
    expect(new NARC(rom.getFileByName("a/0/1/4")).files).toEqual(project.narcs.map_textures!.rawFiles);
    await undoGen5MapImport(project, result); expect(getMatrixSnapshot(project, 0).cells[2].mapId).toBe(0xffffffff);
  });
  it("rejects stale reviews and dependent edits before undo without a partial commit", async () => {
    const project = gen5ImportProject(game), per = mapPermissions(); writeU16(per, 8, 7);
    const stale = await prepareGen5MapImport(project, { game, permissions: per }, target);
    applyMatrixCellEdit(project, 0, [1], { mapId: 3 }); const originalCount = project.narcs.maps!.fileCount;
    await expect(applyGen5MapImport(project, stale)).rejects.toThrow("changed"); expect(project.narcs.maps!.fileCount).toBe(originalCount);
    const fresh = await prepareGen5MapImport(project, { game, permissions: per }, target); await applyGen5MapImport(project, fresh);
    applyMatrixCellEdit(project, 1, [0], { mapId: fresh.mapId });
    await expect(undoGen5MapImport(project, fresh)).rejects.toThrow("changed"); expect(project.narcs.maps!.fileCount).toBeGreaterThan(originalCount);
  });
  it("requires complete new chunks and matching families and resolves missing textures", async () => {
    const project = gen5ImportProject(game);
    await expect(prepareGen5MapImport(project, { game, permissions: mapPermissions() }, { ...target, x: 2 })).rejects.toThrow("requires");
    await expect(prepareGen5MapImport(project, { game: game === "BW" ? "BW2" : "BW", model: mapModel() }, target)).rejects.toThrow("family");
    await expect(prepareGen5MapImport(project, { game, model: mapModel("missing") }, target)).rejects.toThrow("Missing texture");
  });
  it("imports complete native second-layer BINs with trailing opaque sections", async () => {
    const project = gen5ImportProject(game), bin = mapBin(true), result = await prepareGen5MapImport(project, { game, bin }, target);
    await applyGen5MapImport(project, result);
    expect(readGen5MapBin(project.narcs.maps!.rawFiles[result.mapId]).files).toEqual(readGen5MapBin(bin).files);
    expect(result.converted.chunks.find(c => c.chunkId === result.mapId)).toBeDefined();
  });
  it("rejects missing building UIDs and model capacity overflow before applying anything", async () => {
    const project = gen5ImportProject(game), files = readGen5MapBin(mapBin()).files, placements = new Uint8Array(20);
    writeU32(placements, 0, 1); placements[19] = 37; files[2] = placements;
    await expect(prepareGen5MapImport(project, { game, bin: packGameFreakContainer("WB", files) }, target)).rejects.toThrow("Building UID 37");
    const blocks = nitroBlocks(mapModel()), modelAt = readU32(readDictionary(blocks[0], 8)[0].data, 0); writeU16(blocks[0], modelAt + 36, 6145);
    await expect(prepareGen5MapImport(project, { game, model: writeNitroFile(mapModel(), blocks) }, target)).rejects.toThrow("geometry budget");
    expect(project.narcs.maps!.fileCount).toBe(8); expect(project.narcs.maps!.dirty.size).toBe(0);
  });
});

describe("seasonal destination isolation", () => {
  it("isolates repeated chunks for spring and leaves the original resources unchanged", () => {
    const project = gen5ImportProject(); applyMatrixCellEdit(project, 0, [1], { mapId: 0 });
    setSeasonalAssignment(project, 0, "map", 0, [0, 1, 2, 3]); const original = project.narcs.maps!.rawFiles[0].slice(), changed = original.slice(); changed[changed.length - 1] ^= 1;
    const result = stageGen5MapDestination(project, { ...target, season: "spring" }, changed);
    expect(resolveSeasonalMatrix(project, 0, "spring").cells[0].mapId).toBe(result.mapId); expect(resolveSeasonalMatrix(project, 0, "spring").cells[1].mapId).toBe(0);
    expect(resolveSeasonalMatrix(project, 0, "winter").cells[0].mapId).toBe(3); expect(project.narcs.maps!.rawFiles[0]).toEqual(original);
  });
  it("edits the resolved whole-matrix seasonal target", () => {
    const project = gen5ImportProject(); setSeasonalAssignment(project, 0, "matrix", undefined, [0, 1, 0, 1]);
    const changed = mapBin(); changed[changed.length - 1] ^= 1;
    const result = stageGen5MapDestination(project, target, changed);
    expect(resolveSeasonalMatrix(project, 0, "winter").cells[0].mapId).toBe(result.mapId); expect(resolveSeasonalMatrix(project, 0, "summer").cells[0].mapId).toBe(5);
    expect(getMatrixSnapshot(project, 0).cells[0].mapId).toBe(0);
  });
  it("blocks conditional matrix routing rather than changing event-dependent behavior", () => {
    const project = gen5ImportProject(), rules = new Uint8Array(16); rules[2] = 1; rules[3] = 3; project.narcs.map_replace!.rawFiles[0] = rules;
    const changed = mapBin(); changed[changed.length - 1] ^= 1;
    expect(() => stageGen5MapDestination(project, target, changed)).toThrow("conditional");
    expect(stageGen5MapDestination(project, target, mapBin()).mapId).toBe(0);
  });
  it("preserves unrelated conditional entries whose unused slots contain zero", () => {
    const project = gen5ImportProject(), rule = new Uint8Array(16); writeU16(rule, 0, 1); rule[2] = 1; rule[3] = 1; writeU16(rule, 4, 1); writeU16(rule, 6, 1);
    project.narcs.map_replace!.rawFiles[0] = rule;
    const changed = mapBin(); changed[changed.length - 1] ^= 1;
    expect(stageGen5MapDestination(project, target, changed).mapId).toBeGreaterThan(7);
    expect(getMapReplacementBytes(project).subarray(0, 16)).toEqual(rule);
  });
});
