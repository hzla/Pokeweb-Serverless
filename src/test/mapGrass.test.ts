import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { gen5HeightAt } from "../pokeweb/gen5MapHeightGeneration";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { updateHeaderField } from "../pokeweb/headerModel";
import { loadMap3dZone, packGameFreakContainer, parseVMapTerrain, readNitroResources } from "../pokeweb/map3dModel";
import { paintMapGrass, removeMapGrass, undoMapGrass } from "../pokeweb/mapGrass";
import { appendMapGrass, GRASS_LAYERS, grassTileKey, readPaintedMapGrass } from "../pokeweb/mapGrassGeometry";
import { materialRecords, nitroBlocks, readDictionary, replaceMaterialRecords, writeDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { appendNitroTextures } from "../pokeweb/nitroTextureWriter";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { MATRIX_SEASONS, setSeasonalAssignment } from "../pokeweb/seasonalMatrixModel";
import { gen5ImportProject, mapBin, mapTextures } from "./fixtures/gen5MapImport";

const tile = (tileX: number) => ({ matrixX: 0, matrixY: 0, tileX, tileY: 16 });
const index = 16 * 32 + 16;

function centerLegacyGrass(model: Uint8Array) {
  const blocks = nitroBlocks(model), mdl = blocks[0], offset = readU32(readDictionary(mdl, 8)[0].data, 0);
  const shapesAt = offset + readU32(mdl, offset + 12), shift = 2 * 4096 ** 2 / readU32(mdl, offset + 28);
  for (const { name, data } of readDictionary(mdl, shapesAt)) {
    if (!name.startsWith("pw_")) continue;
    const shape = shapesAt + readU32(data, 0);
    let cursor = shape + readU32(mdl, shape + 8);
    const end = cursor + readU32(mdl, shape + 12);
    const sizes: Record<number, number> = { 0: 0, 0x21: 1, 0x22: 1, 0x23: 2, 0x40: 1, 0x41: 0 };
    while (cursor < end) {
      const packet = readU32(mdl, cursor);
      cursor += 4;
      for (let i = 0; i < 4; i++) {
        const opcode = (packet >>> (i * 8)) & 255;
        if (opcode === 0x23) writeU32(mdl, cursor + 4, (readU32(mdl, cursor + 4) - shift) & 65535);
        cursor += sizes[opcode] * 4;
      }
    }
  }
  return writeNitroFile(model, blocks);
}

function grassProject(game: "BW" | "BW2") {
  const project = gen5ImportProject(game);
  updateHeaderField(project, 1, "texture_id", "2");
  setSeasonalAssignment(project, 0, "map", 0, [0, 5, 0, 6]);

  const map = readGen5MapBin(mapBin()), original = map.files[0], blocks = nitroBlocks(original);
  const model = readU32(readDictionary(blocks[0], 8)[0].data, 0);
  writeU32(blocks[0], model + 28, 64 * 4096);
  writeU32(blocks[0], model + 32, 4096 / 64);
  map.files[0] = writeNitroFile(original, blocks);
  const nativeMaterial = materialRecords(map.files[0])[0];
  const names = [...new Set(Object.values(GRASS_LAYERS).flatMap(layers => layers.map(layer => layer.texture)))];
  const donor = map.files.slice();
  donor[0] = replaceMaterialRecords(map.files[0], [nativeMaterial, ...names.map(name => ({ ...nativeMaterial, name, textureName: name, paletteName: `${name}_pl` }))]);
  const donorMap = packGameFreakContainer(map.signature, donor);
  for (const [slot, id] of [0, 5, 6].entries()) {
    const permissions = map.files[1].slice();
    writeU16(permissions, 6 + index * 8, 3 + slot);
    // White 2 Route 1 uses class 31 for walkable short grass.
    writeU16(permissions, 8 + index * 8, id === 6 ? 3 : 31);
    writeU16(permissions, 10 + index * 8, id === 0 ? 0x80 : 0x88);
    writeU16(permissions, 10 + (index + 1) * 8, 0x08);
    if (id === 6) {
      writeU16(permissions, 8 + (index + 2) * 8, 1);
      writeU16(permissions, 10 + (index + 2) * 8, 1);
    }
    project.narcs.maps!.rawFiles[id] = packGameFreakContainer(map.signature, [map.files[0], permissions, ...map.files.slice(2)]);
  }
  const makeArchive = (files: Uint8Array[]) => { const archive = new NARC(); archive.files = files; return archive.save(); };
  const vanilla = new NintendoDSRom(project.originalRomBytes!);
  const area = new Uint8Array(60);
  for (let i = 0; i < 6; i++) {
    writeU16(area, i * 10 + 2, i);
    area.set([255, 255, 1], i * 10 + 4);
  }
  const baseBank = mapTextures();
  const donors = MATRIX_SEASONS.map((_, season) => appendNitroTextures(baseBank, names.map(name => {
    const format = name === "kusa_ec3" ? 6 : 3;
    const palette = new Uint8Array(format === 6 ? 16 : 32);
    writeU16(palette, 0, season + 1);
    return { name, paletteName: `${name}_pl`, width: 16, height: 16, params: (1 << 20) | (1 << 23) | (format << 26),
      pixels: new Uint8Array(format === 6 ? 256 : 128), palette, quantized: false };
  })));
  project.originalRomBytes = vanilla.save({ files: new Map([
    [vanilla.fileId("a/0/0/8"), makeArchive([...project.narcs.maps!.rawFiles, ...Array(8).fill(mapBin()), donorMap])],
    [vanilla.fileId("a/0/1/3"), area],
    [vanilla.fileId("a/0/1/4"), makeArchive([baseBank, baseBank, ...donors])],
  ]) });
  project.romInfo.size = project.originalRomBytes.length;
  // Exercise fallback copies while keeping the seasonal donors in the source ROM.
  project.fileSystem = { ...project.fileSystem, replacements: { ...project.fileSystem?.replacements,
    [vanilla.fileId("a/0/1/4")]: makeArchive(Array(6).fill(baseBank)) } };
  return project;
}

describe.each(["BW", "BW2"] as const)("%s grass painting", game => {
  it("persists additive layers, preserves native walking planes and fills seasonal banks", async () => {
    const project = grassProject(game), scene = await loadMap3dZone(project, 0);
    const regular = await paintMapGrass(project, scene, [tile(16), tile(16), tile(18)], "regular");
    expect(regular).toMatchObject({
      count: 1, skipped: 1, skipReasons: [{ reason: "blocked", season: "winter", count: 1 }],
    });
    expect(regular.maps.map(edit => edit.id)).toEqual([0, 5, 6]);
    expect(regular.textures.map(edit => edit.id)).toEqual([2, 3, 4, 5, 0]);
    const dark = await paintMapGrass(project, scene, [tile(17)], "dark");
    expect(dark.count).toBe(1);
    for (const change of dark.maps) {
      const after = readGen5MapBin(change.after), before = readGen5MapBin(regular.maps.find(edit => edit.id === change.id)!.before);
      const models = [before, after].map(map => readNitroResources(map.files[0]).models[0]);
      expect(models[1].pieces[0].commands).toEqual(models[0].pieces[0].commands);
      expect(after.files.slice(2)).toEqual(before.files.slice(2));
      expect(after.files[1].slice(4 + index * 8, 8 + index * 8)).toEqual(before.files[1].slice(4 + index * 8, 8 + index * 8));
    }

    for (const [slot, season] of MATRIX_SEASONS.entries()) {
      const updated = await loadMap3dZone(project, 0, { season }), chunk = updated.chunks[0];
      expect(chunk.permissions?.tiles[index]).toMatchObject({ tileClass: 4, flags: 36 });
      expect(chunk.permissions?.tiles[index + 1]).toMatchObject({ tileClass: 6, flags: 36 });
      expect(chunk.permissions?.tiles[index + 2].tileClass).toBe(season === "winter" ? 1 : 0);
      const regularLayer = chunk.primitives.find(p => p.material.name === "pw_kusa_ec1");
      const permission = readGen5MapBin(project.narcs.maps!.rawFiles[chunk.chunkId]).files[1];
      expect(regularLayer?.positions[1]).toBeCloseTo(gen5HeightAt(permission, index, 0, 1, game) * 16 + 8, 1);
      expect(regularLayer?.positions[2]).toBe(18);
      expect(regularLayer?.material.texture?.rgba[0]).toBeGreaterThan(slot * 8);
      expect(chunk.primitives.find(p => p.material.name === "pw_kusa_ec3")?.indices.length).toBe(12);
    }
    expect(await paintMapGrass(project, scene, [tile(16), tile(16)], "regular")).toMatchObject({
      count: 0, skipped: 1, skipReasons: [{ reason: "already-matching", count: 1 }],
    });
    expect(await paintMapGrass(project, scene, [tile(16), tile(18)], "dark")).toMatchObject({
      count: 0, skipped: 2, skipReasons: [{ reason: "existing-grass", count: 1 }, { reason: "blocked", season: "winter", count: 1 }],
    });
    const rom = new NintendoDSRom(await exportModifiedRom(project));
    const exportedMaps = new NARC(rom.getFileByName("a/0/0/8")).files;
    for (const id of [0, 5, 6]) {
      const { tiles } = parseVMapTerrain(readGen5MapBin(exportedMaps[id]).files[1]);
      expect(tiles[index]).toMatchObject({ tileClass: 4, flags: 0x0024 });
      expect(tiles[index + 1]).toMatchObject({ tileClass: 6, flags: 0x0024 });
    }
    expect(new NARC(rom.getFileByName("a/0/1/4")).files[5]).toEqual(project.narcs.map_textures!.rawFiles[5]);
    undoMapGrass(project, dark);
    undoMapGrass(project, regular);
    for (const change of regular.maps) expect(project.narcs.maps!.rawFiles[change.id]).toEqual(change.before);
  });

  it("draws a patch as merged quads and keeps every tile erasable", () => {
    const project = grassProject(game);
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const donor = readGen5MapBin(new NARC(rom.getFileByName("a/0/0/8")).files[16]);
    const { files } = readGen5MapBin(project.narcs.maps!.rawFiles[0]);
    const polygons = (model: Uint8Array) => {
      const mdl = nitroBlocks(model)[0], offset = readU32(readDictionary(mdl, 8)[0].data, 0);
      return mdl[offset + 38] | (mdl[offset + 39] << 8);
    };
    const before = polygons(files[0]);
    // A flat 3×2 patch, painted in two strokes.
    const quad = (x: number, z: number) => ({ x: x * 16, z: z * 16, heights: [4, 4, 4, 4], layerLifts: [8, 6, 2] });
    let model = appendMapGrass(files[0], "regular", [quad(0, 0), quad(1, 0), quad(2, 0)], materialRecords(donor.files[0]));
    model = appendMapGrass(model, "regular", [quad(0, 1), quad(1, 1), quad(2, 1)], materialRecords(donor.files[0]));
    const tiles = [0, 1, 2, 32, 33, 34].map(i => 16 * 32 + 16 + i);
    expect([...readPaintedMapGrass(model).tiles.keys()].sort((a, b) => a - b)).toEqual(tiles);
    // One quad per layer for the whole patch instead of one per tile.
    expect(polygons(model) - before).toBe(3);
    // Erasing a corner leaves an L, drawn as two quads per layer.
    const erased = readPaintedMapGrass(model).remove(new Set([tiles[5]]));
    expect([...readPaintedMapGrass(erased).tiles.keys()].sort((a, b) => a - b)).toEqual(tiles.slice(0, 5));
    expect(polygons(erased) - before).toBe(6);
    expect(polygons(readPaintedMapGrass(erased).remove(new Set(tiles))) - before).toBe(0);
  });

  it("matches a nearby native dark grass patch's layer heights and tile offset", async () => {
    const project = grassProject(game);
    const rom = new NintendoDSRom(project.originalRomBytes!);
    const donor = readGen5MapBin(new NARC(rom.getFileByName("a/0/0/8")).files[16]);
    for (const id of [0, 5, 6]) {
      const { files, signature } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
      const model = appendMapGrass(files[0], "dark", [
        { x: 0, z: 0, heights: [0, 0, 0, 0], layerLifts: [10, 6, 2] },
      ], materialRecords(donor.files[0]));

      // Give the fixture stock material and shape names so the brush samples its native layers.
      const native = replaceMaterialRecords(model, materialRecords(model).map(record => ({ ...record, name: record.name.replace(/^pw_/, "") })));
      const blocks = nitroBlocks(native), mdl = blocks[0];
      const offset = readU32(readDictionary(mdl, 8)[0].data, 0);
      const shapesAt = offset + readU32(mdl, offset + 12);
      const shapes = readDictionary(mdl, shapesAt).map(shape => ({ ...shape, name: shape.name.replace(/^pw_/, "") }));
      mdl.set(writeDictionary(shapes, 4), shapesAt);
      files[0] = writeNitroFile(native, blocks);

      // Use the same walking height for the native and destination tiles.
      const flatGround = game === "BW" ? 0 : 3;
      writeU16(files[1], 6 + index * 8, flatGround);
      writeU16(files[1], 6 + (index + 1) * 8, flatGround);
      writeU16(files[1], 8 + index * 8, 6);
      writeU16(files[1], 10 + index * 8, 36);
      project.narcs.maps!.rawFiles[id] = packGameFreakContainer(signature, files);
    }
    const scene = await loadMap3dZone(project, 0);
    expect((await paintMapGrass(project, scene, [tile(17)], "dark")).count).toBe(1);
    for (const season of MATRIX_SEASONS) {
      const painted = await loadMap3dZone(project, 0, { season });
      for (const { texture } of GRASS_LAYERS.dark) {
        const stock = painted.chunks[0].primitives.find(p => p.material.name === texture)!;
        const added = painted.chunks[0].primitives.find(p => p.material.name === `pw_${texture}`)!;
        expect(added.positions[1]).toBe(stock.positions[1]);
        expect(added.positions[2]).toBe(stock.positions[2]);
      }
    }
  });

  it("erases individual tiles after reopening and restores each seasonal permission and untouched display list", async () => {
    const project = grassProject(game);
    const ids = [0, 5, 6];
    const originals = ids.map(id => {
      // Change a permission after ROM load, so a source-only restore would be wrong.
      const { signature, files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
      writeU16(files[1], 8 + index * 8, 31);
      writeU16(files[1], 10 + index * 8, id === 0 ? 0x08 : 0x80);
      writeU16(files[1], 8 + (index + 3) * 8, 6);
      writeU16(files[1], 10 + (index + 3) * 8, 0x24);
      project.narcs.maps!.rawFiles[id] = packGameFreakContainer(signature, files);
      return files;
    });
    const scene = await loadMap3dZone(project, 0);
    expect((await paintMapGrass(project, scene, [tile(16), tile(17)], "regular")).count).toBe(2);

    const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
    reopened.originalRomBytes = project.originalRomBytes;
    const winter = await loadMap3dZone(reopened, 0, { season: "winter" });
    const erasure = await removeMapGrass(reopened, winter, [tile(16), tile(19)]);
    expect(erasure).toMatchObject({ count: 1, skipped: 1, sourceFallbackCount: 0,
      skipReasons: [{ reason: "no-painted-grass", count: 1 }] });
    for (const [i, id] of ids.entries()) {
      const { files } = readGen5MapBin(reopened.narcs.maps!.rawFiles[id]);
      const original = originals[i], at = 4 + index * 8;
      expect(files[1].slice(at, at + 8)).toEqual(original[1].slice(at, at + 8));
      expect(files[1].slice(at + 16)).toEqual(original[1].slice(at + 16));
      expect(files.slice(2)).toEqual(original.slice(2));
      expect(readPaintedMapGrass(files[0]).tiles).toEqual(new Map([[index + 1, "regular"]]));
      expect(readNitroResources(files[0]).models[0].pieces[0].commands).toEqual(readNitroResources(original[0]).models[0].pieces[0].commands);
      expect(reopened.mapGrassOriginalPermissions?.[id]?.[index]).toBeUndefined();
    }
    undoMapGrass(reopened, erasure);
    expect(reopened.mapGrassOriginalPermissions?.[0]?.[index]).toEqual({ kind: "regular", tileClass: 31, flags: 8 });
    expect((await removeMapGrass(reopened, winter, [tile(16), tile(17)])).count).toBe(2);
    expect(reopened.mapGrassOriginalPermissions).toBeUndefined();
    expect((await paintMapGrass(reopened, winter, [tile(16)], "dark")).count).toBe(1);
    expect((await removeMapGrass(reopened, winter, [tile(16)])).count).toBe(1);
    const rom = new NintendoDSRom(await exportModifiedRom(reopened));
    const exportedMaps = new NARC(rom.getFileByName("a/0/0/8")).files;
    for (const [i, id] of ids.entries()) {
      const { files } = readGen5MapBin(exportedMaps[id]);
      expect(files[1]).toEqual(originals[i][1]);
      expect(readPaintedMapGrass(files[0]).tiles.size).toBe(0);
    }
  });

  it("recovers older strokes from a matching source and leaves an ambiguous seasonal tile intact", async () => {
    const project = grassProject(game), scene = await loadMap3dZone(project, 0);
    const paint = await paintMapGrass(project, scene, [tile(16), tile(17)], "dark");
    expect(paint.count).toBe(2);
    project.mapGrassOriginalPermissions = undefined;
    for (const { id } of paint.maps) {
      const { signature, files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
      files[0] = centerLegacyGrass(files[0]);
      project.narcs.maps!.rawFiles[id] = packGameFreakContainer(signature, files);
    }

    // Damage a single seasonal precondition. No other variant of this tile should erase.
    const winter = readGen5MapBin(project.narcs.maps!.rawFiles[6]);
    writeU16(winter.files[1], 10 + (index + 1) * 8, 0x124);
    project.narcs.maps!.rawFiles[6] = packGameFreakContainer(winter.signature, winter.files);
    const erase = await removeMapGrass(project, scene, [tile(16), tile(17)]);
    expect(erase).toMatchObject({ count: 1, skipped: 1, sourceFallbackCount: 1,
      skipReasons: [{ reason: "missing-original-permissions", count: 1, season: "winter" }] });
    for (const id of [0, 5, 6]) {
      const { files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
      const { files: original } = readGen5MapBin(paint.maps.find(change => change.id === id)!.before);
      const at = 4 + index * 8;
      expect(files[1].slice(at, at + 8)).toEqual(original[1].slice(at, at + 8));
      expect(readPaintedMapGrass(files[0]).tiles).toEqual(new Map([[index + 1, "dark"]]));
    }
  });

});

it("paints duplicate GC walking planes once, preserves the bridge layers, and restores both permissions after reopening", async () => {
  const project = grassProject("BW2");
  const ids = [0, 5, 6];
  const originals = ids.map(id => {
    const { files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
    const primary = files[1], secondary = primary.slice();
    for (const per of [primary, secondary]) for (const i of [index, index + 1, index + 2]) {
      writeU16(per, 6 + i * 8, 3);
      writeU16(per, 8 + i * 8, 31);
      writeU16(per, 10 + i * 8, 0x80);
    }

    writeU16(secondary, 8 + index * 8, 0);
    writeU16(secondary, 10 + index * 8, id === 5 ? 0x100 : 0x88);
    writeU16(secondary, 6 + (index + 1) * 8, 35); // Bridge above the primary ground.
    writeU16(secondary, 8 + (index + 2) * 8, 1);
    writeU16(secondary, 10 + (index + 2) * 8, 0x81);
    files.splice(2, 0, secondary);
    const bytes = packGameFreakContainer("GC", files);
    project.narcs.maps!.rawFiles[id] = bytes;
    return files;
  });
  const scene = await loadMap3dZone(project, 0);
  const painted = await paintMapGrass(project, scene, [tile(16), tile(17), tile(18)], "regular");
  expect(painted).toMatchObject({ count: 2, skipped: 1, skipReasons: [{ reason: "multiple-surfaces", count: 1 }] });

  for (const [i, id] of ids.entries()) {
    const { files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
    const primary = parseVMapTerrain(files[1]), secondary = parseVMapTerrain(files[2]);
    expect(primary.tiles[index]).toMatchObject({ tileClass: 4, flags: 0x24, height: 3 });
    expect(secondary.tiles[index]).toMatchObject({ tileClass: 4, flags: id === 5 ? 0x124 : 0x24, height: 3 });
    expect(files[1].slice(4 + (index + 1) * 8, 4 + (index + 2) * 8)).toEqual(originals[i][1].slice(4 + (index + 1) * 8, 4 + (index + 2) * 8));
    expect(files[2].slice(4 + (index + 1) * 8)).toEqual(originals[i][2].slice(4 + (index + 1) * 8));
    expect(readPaintedMapGrass(files[0]).tiles).toEqual(new Map([[index, "regular"], [index + 2, "regular"]]));
  }

  const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
  reopened.originalRomBytes = project.originalRomBytes;
  const winter = await loadMap3dZone(reopened, 0, { season: "winter" });
  const removed = await removeMapGrass(reopened, winter, [tile(16), tile(18)]);
  expect(removed.count).toBe(2);
  for (const [i, id] of ids.entries()) {
    const { files } = readGen5MapBin(reopened.narcs.maps!.rawFiles[id]);
    expect(files.slice(1)).toEqual(originals[i].slice(1));
  }
  undoMapGrass(reopened, removed);
  for (const change of painted.maps) expect(reopened.narcs.maps!.rawFiles[change.id]).toEqual(change.after);
});

it("paints and erases both surfaces at one tile independently when the seasonal PER order varies", async () => {
  const project = grassProject("BW2");
  const originals = [0, 5, 6].map(id => {
    const { files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
    const lower = files[1], upper = lower.slice();
    writeU16(lower, 6 + index * 8, 141);
    writeU16(upper, 6 + index * 8, 3);
    writeU16(upper, 8 + index * 8, 0);
    writeU16(upper, 10 + index * 8, 0x100);
    const upperMember = id === 5 ? 1 : 2;
    const lowerMember = id === 5 ? 2 : 1;
    files.splice(1, 1, ...(upperMember === 1 ? [upper, lower] : [lower, upper]));
    project.narcs.maps!.rawFiles[id] = packGameFreakContainer("GC", files);
    return { id, files, upperMember, lowerMember } as const;
  });
  const scene = await loadMap3dZone(project, 0);
  expect((await paintMapGrass(project, scene, [tile(16), tile(17)], "regular", { surface: "upper" }))).toMatchObject({
    count: 1, skipped: 1, skipReasons: [{ reason: "no-stacked-surface", count: 1 }],
  });
  for (const { id, files: original, upperMember, lowerMember } of originals) {
    const { files } = readGen5MapBin(project.narcs.maps!.rawFiles[id]);
    expect(files[lowerMember]).toEqual(original[lowerMember]);
    expect(parseVMapTerrain(files[upperMember]).tiles[index]).toMatchObject({ tileClass: 4, flags: 0x124, height: 3 });
    expect(readPaintedMapGrass(files[0]).tiles).toEqual(new Map([[grassTileKey(index, upperMember), "regular"]]));
  }

  expect((await paintMapGrass(project, scene, [tile(16)], "dark", { surface: "lower" })).count).toBe(1);
  const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
  reopened.originalRomBytes = project.originalRomBytes;
  const summer = await loadMap3dZone(reopened, 0, { season: "summer" });
  const [upper, lower] = ["pw_kusa_ec1", "pw2_kusa_ec1s"].map(name =>
    summer.chunks[0].primitives.find(primitive => primitive.material.name === name)!);
  expect(upper.positions[1]).toBe(8);
  expect(lower.positions[1]).toBeCloseTo(gen5HeightAt(originals[1].files[2], index, 0, 1, "BW2") * 16 + 9, 2);
  const removedUpper = await removeMapGrass(reopened, summer, [tile(16)], { surface: "upper" });
  expect(removedUpper).toMatchObject({ count: 1, sourceFallbackCount: 0 });
  for (const { id, files: original, upperMember, lowerMember } of originals) {
    const { files } = readGen5MapBin(reopened.narcs.maps!.rawFiles[id]);
    expect(files[upperMember]).toEqual(original[upperMember]);
    expect(parseVMapTerrain(files[lowerMember]).tiles[index]).toMatchObject({ tileClass: 6, flags: 0x24, height: 141 });
    expect(readPaintedMapGrass(files[0]).tiles).toEqual(new Map([[grassTileKey(index, lowerMember), "dark"]]));
  }
  expect(await removeMapGrass(reopened, summer, [tile(16)], { surface: "lower" })).toMatchObject({ count: 1, sourceFallbackCount: 0 });
  for (const { id, files: original } of originals) {
    const { files } = readGen5MapBin(reopened.narcs.maps!.rawFiles[id]);
    expect(files.slice(1)).toEqual(original.slice(1));
    expect(readPaintedMapGrass(files[0]).tiles.size).toBe(0);
    expect(readPaintedMapGrass(files[0]).matchesSourceTerrain(original[0])).toBe(true);
  }
  expect(reopened.mapGrassOriginalPermissions).toBeUndefined();
});
