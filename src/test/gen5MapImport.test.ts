import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { applyGen5MapImport, prepareGen5MapImport, stageGen5MapDestination, undoGen5MapImport, type Gen5MapImportTarget } from "../pokeweb/gen5MapImport";
import { mergeGen5MapTextures, readGen5MapBin, validateGen5Permissions } from "../pokeweb/gen5MapImportFormats";
import { decodeTexture, loadMap3dZone, packGameFreakContainer, readNitroResources } from "../pokeweb/map3dModel";
import { getMatrixSnapshot, applyMatrixCellEdit } from "../pokeweb/matrixModel";
import { getMapReplacementBytes, MATRIX_SEASONS, replacementRules, resolveSeasonalMatrix, setSeasonalAssignment } from "../pokeweb/seasonalMatrixModel";
import { materialRecords, nitroBlocks, readDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { gen5ImportProject, mapBin, mapModel, mapPermissions, mapTextures } from "./fixtures/gen5MapImport";

const target: Gen5MapImportTarget = { matrixId: 0, x: 0, y: 0, headerId: 0, season: "winter" };
describe("Gen 5 native map formats", () => {
  it("reads native GC chunks with two walking layers and preserves their signature", () => {
    const files = readGen5MapBin(mapBin(true)).files;
    expect(readGen5MapBin(packGameFreakContainer("GC", files))).toEqual({ signature: "GC", files, placements: 3 });
  });
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
  it("imports separate PDSMS files over a GC destination without losing placements or opaque members", async () => {
    const project = gen5ImportProject(game), original = packGameFreakContainer("GC", readGen5MapBin(mapBin(true)).files);
    project.narcs.maps!.rawFiles[0] = original;
    const per = mapPermissions(true); writeU16(per, 8, 0x1234);
    const result = await prepareGen5MapImport(project, { game, model: mapModel(), permissions: per, secondaryPermissions: mapPermissions() }, { ...target, season: "spring" });
    expect(project.narcs.maps!.rawFiles[0]).toEqual(original);
    await applyGen5MapImport(project, result);
    const imported = readGen5MapBin(project.narcs.maps!.rawFiles[result.mapId]);
    expect(imported.signature).toBe("GC"); expect(imported.files[1]).toEqual(per); expect(imported.files[2]).toEqual(mapPermissions());
    expect(imported.files.slice(3)).toEqual(readGen5MapBin(original).files.slice(3));
    for (const season of ["summer", "autumn", "winter"] as const) {
      const id = resolveSeasonalMatrix(project, 0, season).cells[0].mapId; expect(project.narcs.maps!.rawFiles[id]).toEqual(original);
    }
    await undoGen5MapImport(project, result); expect(project.narcs.maps!.rawFiles[0]).toEqual(original);
  });
  it("imports complete native GC BINs", async () => {
    const project = gen5ImportProject(game), bin = packGameFreakContainer("GC", readGen5MapBin(mapBin(true)).files);
    const result = await prepareGen5MapImport(project, { game, bin }, target);
    await applyGen5MapImport(project, result);
    expect(project.narcs.maps!.rawFiles[result.mapId]).toEqual(bin);
  });
  it("stages imported building resources and placements atomically, preserves existing assets and undoes them", async () => {
    const project = gen5ImportProject(game), original = structuredClone(project), input = { game, model: mapModel(), permissions: mapPermissions(), buildings: {
      assets: [{ model: mapModel(), textures: mapTextures(0x7c00) }], placements: [{ asset: 0, x: -56, y: 32, z: -64, rotationY: 90 }] } };
    const result = await prepareGen5MapImport(project, input, target); expect(project).toEqual(original);
    const building = result.converted.buildings.find(b => b.chunkId === result.mapId)!;
    expect(building.uid).toBe(511); expect(building.worldY).toBe(32); expect(building.rotationY).toBe(90); expect(building.primitives[0].material.texture).toBeDefined();
    await applyGen5MapImport(project, result); const after = structuredClone(project.narcs.exterior_building_models!.rawFiles);
    const again = await prepareGen5MapImport(project, input, target); expect(again.changes.some(c => c.name === "exterior_building_models")).toBe(false);
    const rom = new NintendoDSRom(await exportModifiedRom(project)); expect(new NARC(rom.getFileByName(game === "BW2" ? "a/2/2/5" : "a/2/2/9")).files).toEqual(after);
    await undoGen5MapImport(project, result); expect(project.narcs.exterior_building_models!.rawFiles[0]).toEqual(packGameFreakContainer("WB", []));
    expect(project.narcs.maps!.rawFiles).toEqual(original.narcs.maps!.rawFiles);
  });
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
  it("explicitly removes a stale second collision layer while preserving opaque members", async () => {
    const project = gen5ImportProject(game), first = await prepareGen5MapImport(project, { game, bin: mapBin(true) }, target); await applyGen5MapImport(project, first);
    const result = await prepareGen5MapImport(project, { game, permissions: mapPermissions(), secondaryPermissions: null }, target);
    await applyGen5MapImport(project, result); const parsed = readGen5MapBin(project.narcs.maps!.rawFiles[result.mapId]);
    expect(parsed.placements).toBe(2); expect(parsed.files.at(-1)).toEqual(Uint8Array.of(9,8,7,6));
    await undoGen5MapImport(project, result); expect(readGen5MapBin(project.narcs.maps!.rawFiles[first.mapId]).placements).toBe(3);
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
  it.each(MATRIX_SEASONS)("preserves conditional map swaps and other cells when importing %s", season => {
    const project = gen5ImportProject(); applyMatrixCellEdit(project, 0, [1], { mapId: 0 });
    project.narcs.maps!.rawFiles.forEach((bytes, id) => { bytes[bytes.length - 1] = 32 + id; });
    const rules = new Uint8Array(32);
    rules[3] = 3; writeU16(rules, 4, 0); writeU16(rules, 6, 4); writeU16(rules, 14, 65535);
    rules[19] = 7; writeU16(rules, 20, 4); writeU16(rules, 22, 7); writeU16(rules, 30, 65535);
    project.narcs.map_replace!.rawFiles[0] = rules;
    const original = project.narcs.maps!.rawFiles.map(b => b.slice()), changed = mapBin(); changed[changed.length - 1] ^= 1;
    const result = stageGen5MapDestination(project, { ...target, season }, changed);
    // Evaluate the native ordered rules with story conditions both disabled and enabled.
    for (const currentSeason of MATRIX_SEASONS) for (const frozen of [false, true]) for (const nextEvent of [false, true]) {
      const cells = getMatrixSnapshot(project, 0).cells.map(c => c.mapId);
      for (const rule of replacementRules(getMapReplacementBytes(project))) {
        if (rule.condition === 3 && !frozen || rule.condition === 7 && !nextEvent) continue;
        const destination = rule.values[rule.condition === 0 ? MATRIX_SEASONS.indexOf(currentSeason) : 1];
        for (let i = 0; i < cells.length; i++) if (cells[i] === rule.values[0]) cells[i] = destination;
      }
      const alternate = nextEvent ? 7 : 4;
      expect(project.narcs.maps!.rawFiles[cells[0]]).toEqual(frozen ? original[alternate] : currentSeason === season ? changed : original[0]);
      expect(project.narcs.maps!.rawFiles[cells[1]]).toEqual(original[frozen ? alternate : 0]);
    }
    expect(project.narcs.maps!.rawFiles[0]).toEqual(original[0]);
    expect(resolveSeasonalMatrix(project, 0, season).cells[0].mapId).toBe(result.mapId);
  });
  it("keeps blocking a destination with combined seasonal and conditional map substitutions", () => {
    const project = gen5ImportProject(); setSeasonalAssignment(project, 0, "map", 0, [0, 1, 2, 3]);
    const existing = getMapReplacementBytes(project), rules = new Uint8Array(existing.length + 16); rules.set(existing);
    rules[existing.length + 3] = 3; writeU16(rules, existing.length + 6, 4); project.narcs.map_replace!.rawFiles[0] = rules; project.narcs.map_replace!.records.clear();
    const changed = mapBin(); changed[changed.length - 1] ^= 1;
    expect(() => stageGen5MapDestination(project, { ...target, season: "spring" }, changed)).toThrow("conditional map routing");
  });
  it("keeps blocking seasonal cascades that return to the base map before a conditional swap", () => {
    const project = gen5ImportProject(), rules = new Uint8Array(48);
    writeU16(rules, 6, 4);
    writeU16(rules, 20, 4); writeU16(rules, 24, 4); writeU16(rules, 26, 4);
    rules[35] = 3; writeU16(rules, 38, 7); project.narcs.map_replace!.rawFiles[0] = rules;
    expect(MATRIX_SEASONS.map(season => resolveSeasonalMatrix(project, 0, season).cells[0].mapId)).toEqual([0, 0, 0, 0]);
    const changed = mapBin(); changed[changed.length - 1] ^= 1;
    expect(() => stageGen5MapDestination(project, { ...target, season: "spring" }, changed)).toThrow("conditional map routing");
  });
  it("does not turn a no-op story rule into a replacement of the imported map", () => {
    const project = gen5ImportProject(), rule = new Uint8Array(16); rule[3] = 3; project.narcs.map_replace!.rawFiles[0] = rule;
    const changed = mapBin(); changed[changed.length - 1] ^= 1;
    stageGen5MapDestination(project, { ...target, season: "spring" }, changed);
    expect(replacementRules(getMapReplacementBytes(project)).filter(r => r.condition === 3)).toEqual(replacementRules(rule));
  });
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
