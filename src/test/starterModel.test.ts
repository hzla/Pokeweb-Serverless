import { describe, expect, it } from "vitest";
import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  compressLz11Literal,
  encodeBattleSpriteIndexedImage,
  type IndexedImageData,
} from "../pokeweb/pokemonSpriteModel";
import {
  applyStarters,
  detectStartersFromScriptBytes,
  getStarterEditorState,
  patchStarterScriptBytes,
  prepareStarterGraphicIndices,
} from "../pokeweb/starterModel";

describe("starterModel script patching", () => {
  it("patches starter species through the variable used by PokePartyAdd", () => {
    const script = makeVariableGiftScript([495, 498, 501]);

    const result = patchStarterScriptBytes(script, [495, 498, 501], [1, 4, 7]);

    expect(result.giftCommandCount).toBe(1);
    expect(result.directGiftUpdates).toBe(0);
    expect(result.variableGiftUpdates).toBe(3);
    expect(result.wordSpeciesUpdates).toBe(3);
    expect(readU16(result.bytes, 4)).toBe(1);
    expect(readU16(result.bytes, 15)).toBe(4);
    expect(readU16(result.bytes, 26)).toBe(7);
    expect(readU16(result.bytes, 37)).toBe(0x8025);
  });

  it("detects starter order from WorkSetConst commands feeding PokePartyAdd", () => {
    const script = makeVariableGiftScript([152, 155, 158]);

    expect(detectStartersFromScriptBytes(script)).toEqual([152, 155, 158]);
  });

  it("ignores assignments from other pointer-table entries", () => {
    const script = makePointerTableGiftScript([50, 47, 442], [498, 495, 501]);

    expect(detectStartersFromScriptBytes(script, "BW2")).toEqual([495, 498, 501]);
  });

  it("uses the loaded starter overlay as the authoritative displayed order", () => {
    const project = makeProject(makeVariableGiftScript([50, 47, 442]), [495, 498, 501]);

    expect(getStarterEditorState(project).slots.map((slot) => slot.speciesId)).toEqual([495, 498, 501]);
  });
});

describe("starterModel selection graphics", () => {
  it("enlarges and centers a battle sprite on the starter-selection canvas", () => {
    const source = indexedImage(96, 96);
    fillIndexedRect(source, 10, 20, 10, 6, 3);

    const prepared = prepareStarterGraphicIndices(source);
    const bounds = opaqueBounds(prepared);

    expect(prepared.width).toBe(96);
    expect(prepared.height).toBe(96);
    expect(bounds).toBeDefined();
    expect(bounds!.x).toBeGreaterThanOrEqual(38);
    expect(bounds!.y).toBeGreaterThanOrEqual(42);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(58);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(54);
  });

  it("rewrites only a changed slot when the other prepared graphics are valid", () => {
    const project = makeStarterAssetProject([495, 498, 501]);
    const starterSprites = project.narcs.starter_sprites!;
    const middleGraphic = starterSprites.rawFiles[13].slice();
    const rightGraphic = starterSprites.rawFiles[14].slice();
    const middlePalette = starterSprites.rawFiles[2].slice();
    const rightPalette = starterSprites.rawFiles[4].slice();

    const state = applyStarters(project, [598, 498, 501]);

    expect(starterSprites.rawFiles[12].length).toBe(0x1230);
    expect(readAscii(starterSprites.rawFiles[12], 0, 4)).toBe("RGCN");
    expect(starterSprites.rawFiles[0].length).toBe(0x228);
    expect(starterSprites.rawFiles[13]).toEqual(middleGraphic);
    expect(starterSprites.rawFiles[14]).toEqual(rightGraphic);
    expect(starterSprites.rawFiles[2]).toEqual(middlePalette);
    expect(starterSprites.rawFiles[4]).toEqual(rightPalette);
    expect(starterSprites.dirty).toEqual(new Set([12, 0]));
    expect(state.warnings.some((warning) => warning.includes("Repaired malformed"))).toBe(false);
  });

  it("detects and repairs every slot corrupted by the legacy direct-copy behavior", () => {
    const speciesIds = [598, 498, 501];
    const project = makeStarterAssetProject(speciesIds);
    const pokemonSprites = project.narcs.pokemon_sprites!;
    const starterSprites = project.narcs.starter_sprites!;

    speciesIds.forEach((speciesId, slot) => {
      starterSprites.rawFiles[12 + slot] = pokemonSprites.rawFiles[speciesId * 20].slice();
      starterSprites.rawFiles[slot * 2] = pokemonSprites.rawFiles[speciesId * 20 + 18].slice();
    });

    expect(getStarterEditorState(project).warnings).toContain(
      "Malformed starter-selection graphics were detected in the left slot, the middle slot, the right slot. Apply Starters to rebuild them.",
    );

    const state = applyStarters(project, speciesIds);

    for (let slot = 0; slot < 3; slot += 1) {
      const graphic = starterSprites.rawFiles[12 + slot];
      const palette = starterSprites.rawFiles[slot * 2];
      const sourcePalette = pokemonSprites.rawFiles[speciesIds[slot] * 20 + 18];
      expect(graphic.length).toBe(0x1230);
      expect(readAscii(graphic, 0, 4)).toBe("RGCN");
      expect(readU32(graphic, 0x28)).toBe(0x1200);
      expect(palette.length).toBe(0x228);
      expect(readAscii(palette, 0, 4)).toBe("RLCN");
      expect(palette.subarray(42, 72)).toEqual(sourcePalette.subarray(42, 72));
    }
    expect(starterSprites.dirty).toEqual(new Set([12, 0, 13, 2, 14, 4]));
    expect(state.warnings).toContain(
      "Repaired malformed starter-selection graphics in the left slot, the middle slot, the right slot.",
    );
    expect(state.warnings.some((warning) => warning.startsWith("Malformed starter-selection"))).toBe(false);
  });

  it("leaves a valid unchanged starter archive byte-for-byte intact", () => {
    const project = makeStarterAssetProject([495, 498, 501]);
    const starterSprites = project.narcs.starter_sprites!;
    const before = starterSprites.rawFiles.map((file) => file.slice());

    applyStarters(project, [495, 498, 501]);

    expect(starterSprites.rawFiles).toEqual(before);
    expect(starterSprites.dirty.size).toBe(0);
  });
});

function makeVariableGiftScript(speciesIds: number[]): Uint8Array {
  const bytes = new Uint8Array(43);
  let offset = 0;
  for (const speciesId of speciesIds) {
    writeU16(bytes, offset, 0x28);
    writeU16(bytes, offset + 2, 0x8025);
    writeU16(bytes, offset + 4, speciesId);
    offset += 6;
    writeU16(bytes, offset, 0x57);
    bytes[offset + 2] = 1;
    writeU16(bytes, offset + 3, speciesId);
    offset += 5;
  }
  writeU16(bytes, offset, 0x10c);
  writeU16(bytes, offset + 2, 0x8010);
  writeU16(bytes, offset + 4, 0x8025);
  writeU16(bytes, offset + 6, 0);
  writeU16(bytes, offset + 8, 5);
  return bytes;
}

function makePointerTableGiftScript(unrelated: number[], starters: number[]): Uint8Array {
  const firstEntry = 10;
  const secondEntry = firstEntry + unrelated.length * 6;
  const bytes = new Uint8Array(secondEntry + starters.length * 6 + 10);
  writeU32(bytes, 0, firstEntry - 4);
  writeU32(bytes, 4, secondEntry - 8);
  writeU16(bytes, 8, 0xfd13);
  let offset = firstEntry;
  for (const speciesId of unrelated) {
    writeU16(bytes, offset, 0x28);
    writeU16(bytes, offset + 2, 0x8025);
    writeU16(bytes, offset + 4, speciesId);
    offset += 6;
  }
  for (const speciesId of starters) {
    writeU16(bytes, offset, 0x28);
    writeU16(bytes, offset + 2, 0x8025);
    writeU16(bytes, offset + 4, speciesId);
    offset += 6;
  }
  writeU16(bytes, offset, 0x10c);
  writeU16(bytes, offset + 2, 0x8010);
  writeU16(bytes, offset + 4, 0x8025);
  writeU16(bytes, offset + 6, 0);
  writeU16(bytes, offset + 8, 5);
  return bytes;
}

function makeProject(script: Uint8Array, overlaySpecies: number[]): ProjectState {
  const overlay = new Uint8Array(0x2c1a);
  overlaySpecies.forEach((speciesId, index) => writeU16(overlay, 0x2c14 + index * 2, speciesId));
  return {
    session: { romName: "starter-test", generation: "gen5", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: { 316: overlay },
    narcs: {
      personal: makeStore("personal", Array.from({ length: 650 }, () => new Uint8Array(76))),
      scripts: makeStore("scripts", Array.from({ length: 855 }, (_unused, fileId) => fileId === 854 ? script : new Uint8Array())),
    },
    texts: { banks: { pokedex: Array.from({ length: 650 }, (_unused, id) => `Pokemon ${id}`) } },
    formats: {},
    trpokInfo: [],
  };
}

function makeStarterAssetProject(currentSpecies: number[]): ProjectState {
  const project = makeProject(makeVariableGiftScript(currentSpecies), currentSpecies);
  const sourceSpecies = [495, 498, 501, 598];
  const pokemonFiles: Uint8Array[] = Array.from({ length: 599 * 20 }, () => new Uint8Array());
  sourceSpecies.forEach((speciesId, sourceIndex) => {
    const image = indexedImage(96, 96);
    fillIndexedRect(image, 24 + sourceIndex, 28, 24 + sourceIndex * 3, 26 + sourceIndex * 2, (sourceIndex % 14) + 1);
    pokemonFiles[speciesId * 20] = compressLz11Literal(makePreparedGraphic(image));
    pokemonFiles[speciesId * 20 + 18] = makePokemonPalette(sourceIndex + 1);
    pokemonFiles[speciesId * 20 + 19] = makePokemonPalette(sourceIndex + 5);
  });
  project.narcs.pokemon_sprites = makeStore("pokemon_sprites", pokemonFiles);

  const starterFiles: Uint8Array[] = Array.from({ length: 42 }, () => new Uint8Array());
  for (let slot = 0; slot < 3; slot += 1) {
    const image = indexedImage(96, 96);
    fillIndexedRect(image, 30 + slot, 32, 28, 30, slot + 1);
    starterFiles[12 + slot] = makePreparedGraphic(image);
    starterFiles[slot * 2] = makePreparedPalette(slot + 1);
    starterFiles[slot * 2 + 1] = makePreparedPalette(slot + 8);
  }
  project.narcs.starter_sprites = makeStore("starter_sprites", starterFiles);
  return project;
}

function indexedImage(width: number, height: number): IndexedImageData {
  return { width, height, indices: new Uint8Array(width * height) };
}

function fillIndexedRect(image: IndexedImageData, x: number, y: number, width: number, height: number, color: number): void {
  for (let row = y; row < y + height; row += 1) {
    image.indices.fill(color, row * image.width + x, row * image.width + x + width);
  }
}

function opaqueBounds(image: IndexedImageData): { x: number; y: number; width: number; height: number } | undefined {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  image.indices.forEach((color, index) => {
    if (color === 0) return;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  return maxX < 0 ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function makePreparedGraphic(image: IndexedImageData): Uint8Array {
  const bytes = new Uint8Array(0x1230);
  bytes.set([0x52, 0x47, 0x43, 0x4e, 0xff, 0xfe, 0x01, 0x01], 0);
  writeU32(bytes, 8, bytes.length);
  writeU16(bytes, 0x0c, 0x10);
  writeU16(bytes, 0x0e, 1);
  bytes.set([0x52, 0x41, 0x48, 0x43], 0x10);
  writeU32(bytes, 0x14, bytes.length - 0x10);
  writeU16(bytes, 0x18, 0xffff);
  writeU16(bytes, 0x1a, 0xffff);
  writeU32(bytes, 0x1c, 3);
  writeU32(bytes, 0x20, 0x10);
  writeU32(bytes, 0x28, 0x1200);
  writeU32(bytes, 0x2c, 0x18);
  encodeBattleSpriteIndexedImage(bytes, image);
  return bytes;
}

function makePokemonPalette(seed: number): Uint8Array {
  const bytes = makePalette(0x48, 0x20, seed);
  writeU32(bytes, 0x14, 0x38);
  writeU32(bytes, 0x18, 4);
  return bytes;
}

function makePreparedPalette(seed: number): Uint8Array {
  const bytes = makePalette(0x228, 0x200, seed);
  writeU32(bytes, 0x14, 0x218);
  writeU32(bytes, 0x18, 3);
  return bytes;
}

function makePalette(fileSize: number, dataSize: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(fileSize);
  bytes.set([0x52, 0x4c, 0x43, 0x4e, 0xff, 0xfe, 0x00, 0x01], 0);
  writeU32(bytes, 8, fileSize);
  writeU16(bytes, 0x0c, 0x10);
  writeU16(bytes, 0x0e, 1);
  bytes.set([0x54, 0x54, 0x4c, 0x50], 0x10);
  writeU32(bytes, 0x20, dataSize);
  writeU32(bytes, 0x24, 0x10);
  for (let offset = 0; offset < dataSize; offset += 2) writeU16(bytes, 0x28 + offset, (seed * 0x111 + offset) & 0x7fff);
  return bytes;
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return { name, sourcePath: "test", fileId: 1, fileCount: rawFiles.length, rawFiles, records: new Map(), dirty: new Set() };
}
