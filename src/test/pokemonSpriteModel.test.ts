import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  compressLz11Literal,
  decompressNitro,
  exportPokemonSpritePackage,
  getPokemonAnimation,
  getPokemonCellBank,
  getPokemonMultiCellAnimation,
  getPokemonMultiCells,
  getPokemonIconImage,
  getPokemonPalettes,
  getPokemonSpriteImage,
  importPokemonAnimationBundle,
  importPokemonSpritePackage,
  parsePokemonAnimation,
  parsePokemonCellBank,
  parsePokemonMultiCells,
  resolvePokemonSpriteId,
  setPokemonAnimationFrame,
  setPokemonIconImage,
  setPokemonPalette,
  setPokemonSpriteImage,
  updatePokemonAnimationFrame,
  type RgbaImageData,
} from "../pokeweb/pokemonSpriteModel";
import {
  buildPokemonAnimationAssetBundle,
  buildPokemonAnimationFile,
  buildPokemonCellBankFile,
  buildPokemonCellBankFileFromCells,
  packagePokemonAnimationBundle,
  packagePokemonCustomSpriteBundle,
  parsePokemonCustomSpriteBundle,
  type PokemonAnimationBundleFileIndex,
} from "../pokeweb/pokemonSpriteWriters";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("pokemonSpriteModel", () => {
  it("resolves BW2 alternate form sprite IDs from personal data", () => {
    const project = makeProject();

    expect(resolvePokemonSpriteId(project, 1, 0)).toBe(1);
    expect(resolvePokemonSpriteId(project, 1, 1)).toBe(688);
  });

  it("round-trips literal LZ11 data", () => {
    const source = new Uint8Array(Array.from({ length: 257 }, (_, index) => (index * 17) & 0xff));
    const compressed = compressLz11Literal(source);

    expect(compressed[0]).toBe(0x11);
    expect(decompressNitro(compressed)).toEqual(source);
  });

  it("exports and imports Frost pksprdat sprite packages", () => {
    const project = makeProject();
    const exported = exportPokemonSpritePackage(project, 1);
    project.narcs.pokemon_sprites!.rawFiles[20] = new Uint8Array([1, 2, 3]);

    importPokemonSpritePackage(project, 1, exported);

    expect(project.narcs.pokemon_sprites!.rawFiles[20]).toEqual(makeCompressedSprite());
    expect(project.narcs.pokemon_sprites!.dirty.has(20)).toBe(true);
    expect(project.narcs.pokemon_sprites!.dirty.has(39)).toBe(true);
  });

  it("decodes, validates, and writes battle sprite PNG data", () => {
    const project = makeProject();
    const image = getPokemonSpriteImage(project, 1, { kind: "sprite", side: "front", gender: "male" }, "normal");
    expect(image.width).toBe(96);
    expect(image.height).toBe(96);
    expect(image.pixels[0]).toBe(8);

    setPokemonSpriteImage(project, 1, { kind: "sprite", side: "front", gender: "male" }, "normal", image);
    const rewritten = getPokemonSpriteImage(project, 1, { kind: "sprite", side: "front", gender: "male" }, "normal");

    expect(rewritten.pixels[0]).toBe(8);
    expect(project.narcs.pokemon_sprites!.dirty.has(20)).toBe(true);
    expect(() =>
      setPokemonSpriteImage(project, 1, { kind: "sprite", side: "front", gender: "male" }, "normal", {
        width: 95,
        height: 96,
        pixels: new Uint8ClampedArray(95 * 96 * 4),
      }),
    ).toThrow(/96 x 96/u);
  });

  it("writes normal and shiny palettes at Frost offsets", () => {
    const project = makeProject();
    const next = Array.from({ length: 16 }, (_, index) => ({ r: index * 8, g: index * 4, b: index * 2 }));

    setPokemonPalette(project, 1, "shiny", next);

    expect(getPokemonPalettes(project, 1).shiny[3].r).toBeGreaterThan(0);
    expect(project.narcs.pokemon_sprites!.dirty.has(39)).toBe(true);
  });

  it("uses BW2 icon indexing and validates icon imports", () => {
    const project = makeProject();
    const icon = getPokemonIconImage(project, 1, "male", 0);
    expect(icon.width).toBe(32);
    expect(icon.height).toBe(64);
    expect(icon.pixels[0]).toBe(8);

    setPokemonIconImage(project, 1, "male", 0, icon);

    expect(project.narcs.pokemon_icons!.dirty.has(10)).toBe(true);
    expect(() => setPokemonIconImage(project, 1, "male", 0, { width: 31, height: 64, pixels: new Uint8ClampedArray(31 * 64 * 4) })).toThrow(/32 x 64/u);
  });

  it("parses and edits NitroPaint NANR animation frames", () => {
    const project = makeProject();

    const animation = getPokemonAnimation(project, 1, "front");
    expect(animation.sequences).toHaveLength(1);
    expect(animation.sequences[0].mode).toBe(2);
    expect(animation.sequences[0].frames[1]).toMatchObject({
      duration: 4,
      cellIndex: 0,
      x: 12,
      y: -8,
      xScale: 1.5,
      yScale: 0.5,
      frameType: "index-srt",
    });

    setPokemonAnimationFrame(project, 1, "front", 0, 1, {
      duration: 7,
      cellIndex: 0,
      x: -3,
      y: 9,
      rotation: 180,
      xScale: 1.25,
      yScale: 0.75,
    });
    const edited = getPokemonAnimation(project, 1, "front").sequences[0].frames[1];
    expect(edited.duration).toBe(7);
    expect(edited.x).toBe(-3);
    expect(edited.y).toBe(9);
    expect(edited.rotation).toBe(180);
    expect(edited.xScale).toBe(1.25);
    expect(project.narcs.pokemon_sprites!.dirty.has(25)).toBe(true);
  });

  it("edits translation-only NANR frames without converting them to SRT", () => {
    const project = makeProject();

    const animation = getPokemonAnimation(project, 1, "back");
    expect(animation.sequences[0].frames[1]).toMatchObject({
      duration: 5,
      cellIndex: 0,
      x: 6,
      y: -4,
      rotation: 0,
      xScale: 1,
      yScale: 1,
      frameType: "index-t",
    });

    const editedAnimation = updatePokemonAnimationFrame(project, 1, "back", 0, 1, {
      duration: 9,
      x: -12,
      y: 11,
      rotation: 270,
      xScale: 2,
      yScale: 0.5,
    });
    const edited = editedAnimation.sequences[0].frames[1];
    expect(edited).toMatchObject({
      duration: 9,
      cellIndex: 0,
      x: -12,
      y: 11,
      rotation: 0,
      xScale: 1,
      yScale: 1,
      frameType: "index-t",
    });
    expect(project.narcs.pokemon_sprites!.dirty.has(34)).toBe(true);
  });

  it("parses NitroPaint NCER cell banks for animation rendering", () => {
    const bank = parsePokemonCellBank(makeNcerFile(), "front");

    expect(bank.mappingMode).toBe(0);
    expect(bank.cells[0]).toMatchObject({ nAttribs: 2, minX: -8, minY: -16, maxX: 24, maxY: 32 });
    expect(bank.cells[0].oams[0]).toMatchObject({ x: 0, y: 0, width: 16, height: 16, characterName: 3, palette: 2 });
    expect(bank.cells[0].oams[1]).toMatchObject({ x: -8, y: -16, width: 16, height: 8, characterName: 10, palette: 1, flipX: true });
    expect(getPokemonCellBank(makeProject(), 1, "front").cells[0].oams).toHaveLength(2);
  });

  it("builds NitroPaint-compatible NCER cells with pivot-relative OAM tiling", () => {
    const file = buildPokemonCellBankFile([
      { name: "wing", cellX: 32, cellY: 16, width: 40, height: 32, spriteX: -10, spriteY: 5, pivot: { x: 12, y: 16 } },
    ]);

    const bank = parsePokemonCellBank(file, "front");

    expect(bank.mappingMode).toBe(4);
    expect(bank.cells).toHaveLength(1);
    expect(bank.cells[0]).toMatchObject({ minX: -12, minY: -16, maxX: 28, maxY: 16 });
    expect(bank.cells[0].oams.map((oam) => [oam.width, oam.height])).toEqual([
      [32, 32],
      [8, 32],
    ]);
    expect(bank.cells[0].oams[0].characterName).toBe(68);
  });

  it("builds explicit NCER cells for shared-tile flipbook poses", () => {
    const file = buildPokemonCellBankFileFromCells([
      {
        oams: [
          { x: -24, y: -16, width: 8, height: 8, characterName: 4 },
          { x: -16, y: -16, width: 8, height: 8, characterName: 4 },
        ],
      },
      {
        oams: [{ x: -20, y: -12, width: 16, height: 16, characterName: 12 }],
      },
    ]);

    const bank = parsePokemonCellBank(file, "front");

    expect(bank.mappingMode).toBe(4);
    expect(bank.cells).toHaveLength(2);
    expect(bank.cells[0]).toMatchObject({ minX: -24, minY: -16, maxX: -8, maxY: -8 });
    expect(bank.cells[0].oams.map((oam) => oam.characterName)).toEqual([4, 4]);
    expect(bank.cells[1].oams[0]).toMatchObject({ x: -20, y: -12, width: 16, height: 16, characterName: 12 });
  });

  it("builds multi-sequence NANR files with local start frame zero", () => {
    const file = buildPokemonAnimationFile({
      targetType: 1,
      frames: [
        [
          { duration: 4, cellIndex: 1, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
          { duration: 4, cellIndex: 2, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
        ],
        [
          { duration: 4, cellIndex: 3, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
          { duration: 4, cellIndex: 4, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
        ],
      ],
    });

    const animation = parsePokemonAnimation(file);

    expect(animation.sequences.map((sequence) => sequence.startFrameIndex)).toEqual([0, 0]);
    expect(animation.sequences.map((sequence) => sequence.frames.map((frame) => frame.cellIndex))).toEqual([[1, 2], [3, 4]]);
  });

  it("builds and imports front NCER/NANR/NMCR/NMAR/NCEC animation bundles", () => {
    const project = makeProject();
    const rawBundle = buildPokemonAnimationAssetBundle({
      side: "front",
      loopDuration: 12,
      parts: [
        {
          name: "body",
          cellX: 0,
          cellY: 0,
          width: 16,
          height: 16,
          spriteX: -8,
          spriteY: -8,
          pivot: { x: 8, y: 8 },
          z: 10,
          frames: [
            { duration: 6, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
            { duration: 6, cellIndex: 0, x: 2, y: -1, rotation: 15, xScale: 1.1, yScale: 0.9 },
          ],
        },
        { name: "ear", cellX: 16, cellY: 0, width: 16, height: 16, spriteX: 4, spriteY: 4, pivot: { x: 4, y: 12 }, z: 20 },
      ],
    });
    const bundle = {
      side: rawBundle.side,
      files: Object.fromEntries(
        Object.entries(rawBundle.files).map(([key, file]) => {
          const index = Number(key) as PokemonAnimationBundleFileIndex;
          return [index, index === 8 || index === 17 ? file : compressLz11Literal(file!)];
        }),
      ) as typeof rawBundle.files,
    };

    expect(parsePokemonAnimation(rawBundle.files[5]!, "front").sequences[0].frames[1]).toMatchObject({ x: 2, y: -1, frameType: "index-srt" });
    const rawMultiCells = parsePokemonMultiCells(rawBundle.files[6]!, "front");
    expect(rawMultiCells.cells).toHaveLength(2);
    expect(rawMultiCells.cells[0].nodes).toHaveLength(2);
    expect(rawMultiCells.cells[1].nodes).toHaveLength(2);
    expect(readU32(rawBundle.files[6]!, 0x1c)).toBe(0x14);
    expect(readU32(rawBundle.files[6]!, 0x28)).toBe(0);
    importPokemonAnimationBundle(project, 1, packagePokemonAnimationBundle(bundle));

    expect(project.narcs.pokemon_sprites!.dirty.has(24)).toBe(true);
    expect(project.narcs.pokemon_sprites!.dirty.has(28)).toBe(true);
    expect(getPokemonAnimation(project, 1, "front").sequences).toHaveLength(2);
    expect(getPokemonAnimation(project, 1, "front").sequences[0].frames[1].rotation).toBeCloseTo(15, 1);
    expect(getPokemonMultiCells(project, 1, "front").cells[0].nodes[0]).toMatchObject({ sequenceNumber: 0, visible: true });
    expect(getPokemonMultiCellAnimation(project, 1, "front").sequences[0].frames[0]).toMatchObject({ duration: 12, cellIndex: 0 });
  });

  it("packages flexible custom sprite bundles with optional images and arbitrary files", () => {
    const bundle = packagePokemonCustomSpriteBundle({
      side: "back",
      frontSpritePng: new Uint8Array([1, 2, 3]),
      backRigPng: new Uint8Array([4, 5, 6]),
      normalPalettePng: new Uint8Array([7, 8, 9]),
      files: {
        0: new Uint8Array([10]),
        13: new Uint8Array([11, 12]),
        17: new Uint8Array([13]),
      },
    });

    const parsed = parsePokemonCustomSpriteBundle(bundle);

    expect(parsed.side).toBe("back");
    expect(parsed.frontSpritePng).toEqual(new Uint8Array([1, 2, 3]));
    expect(parsed.backRigPng).toEqual(new Uint8Array([4, 5, 6]));
    expect(parsed.normalPalettePng).toEqual(new Uint8Array([7, 8, 9]));
    expect(parsed.files?.[0]).toEqual(new Uint8Array([10]));
    expect(parsed.files?.[13]).toEqual(new Uint8Array([11, 12]));
    expect(parsed.files?.[17]).toEqual(new Uint8Array([13]));
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const personal: Uint8Array[] = [
    new Uint8Array(formats.personal!.reduce((sum, [size]) => sum + size, 0)),
    packRows(formats.personal!, [{ num_forms: 2, form: 3 }]),
  ];
  const spriteFiles: Uint8Array[] = Array.from({ length: 40 }, () => new Uint8Array());
  for (let i = 20; i < 40; i += 1) spriteFiles[i] = new Uint8Array([i]);
  spriteFiles[20] = makeCompressedSprite();
  spriteFiles[22] = makeCompressedRig();
  spriteFiles[24] = makeNcerFile();
  spriteFiles[25] = compressLz11Literal(makeNanrFile());
  spriteFiles[28] = makeRigCellsFile();
  spriteFiles[29] = makeCompressedSprite();
  spriteFiles[31] = makeCompressedRig();
  spriteFiles[33] = makeNcerFile();
  spriteFiles[34] = compressLz11Literal(makeNanrTFile());
  spriteFiles[37] = makeRigCellsFile();
  spriteFiles[38] = makePaletteFile();
  spriteFiles[39] = makePaletteFile(true);

  const iconFiles: Uint8Array[] = Array.from({ length: 12 }, () => new Uint8Array());
  iconFiles[0] = makeIconPaletteFile();
  iconFiles[10] = makeIconFile();
  iconFiles[11] = makeIconFile();

  const arm9 = new Uint8Array(0x8c578 + 800);
  arm9.fill(17, 0x8c578, 0x8c578 + 16);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { personal: 1, pokemon_sprites: 4, pokemon_icons: 7 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9,
    overlays: {},
    narcs: {
      personal: makeStore("personal", personal),
      pokemon_sprites: makeStore("pokemon_sprites", spriteFiles),
      pokemon_icons: makeStore("pokemon_icons", iconFiles),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { pokedex: ["None", "Bulbasaur"] } },
    formats,
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeCompressedSprite(): Uint8Array {
  const out = new Uint8Array(48 + 64 * 144 / 2);
  out.fill(0x11, 48);
  return compressLz11Literal(out);
}

function makeCompressedRig(): Uint8Array {
  const out = new Uint8Array(48 + 256 * 128 / 2);
  out.fill(0x11, 48);
  return compressLz11Literal(out);
}

function makePaletteFile(shiny = false): Uint8Array {
  const out = new Uint8Array(72);
  for (let i = 0; i < 16; i += 1) writeU16(out, 40 + i * 2, rgb555(shiny ? i * 2 : i, shiny ? i : i * 2, i));
  return out;
}

function makeIconPaletteFile(): Uint8Array {
  const out = new Uint8Array(40 + 32 * 3);
  for (let palette = 0; palette < 3; palette += 1) {
    for (let i = 0; i < 16; i += 1) writeU16(out, 40 + palette * 32 + i * 2, rgb555(i, i, i));
  }
  return out;
}

function makeIconFile(): Uint8Array {
  const out = new Uint8Array(48 + 32 * 64 / 2);
  out.fill(0x11, 48);
  return out;
}

function makeRigCellsFile(): Uint8Array {
  const out = new Uint8Array(12 + 48 + 4);
  out[0] = 1;
  writeS32(out, 20, 16 * 0x1000);
  writeS32(out, 24, 16 * 0x1000);
  return out;
}

function makeNanrFile(): Uint8Array {
  const out = new Uint8Array(0x70);
  out.set(new TextEncoder().encode("RNAN"), 0);
  out[4] = 0xff;
  out[5] = 0xfe;
  out[7] = 1;
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  out.set(new TextEncoder().encode("KNBA"), 0x10);
  writeU32(out, 0x14, out.length - 0x10);
  const abnk = 0x18;
  writeU16(out, abnk, 1);
  writeU16(out, abnk + 2, 2);
  writeU32(out, abnk + 4, 0x18);
  writeU32(out, abnk + 8, 0x28);
  writeU32(out, abnk + 0x0c, 0x38);
  const sequence = abnk + 0x18;
  writeU16(out, sequence, 2);
  writeU32(out, sequence + 4, 1 | (1 << 16));
  writeU32(out, sequence + 8, 2);
  writeU32(out, sequence + 0x0c, 0);
  const frames = abnk + 0x28;
  writeU16(out, frames + 4, 3);
  writeU32(out, frames + 8, 0x10);
  writeU16(out, frames + 0x0c, 4);
  const anim = abnk + 0x38;
  writeS32(out, anim + 4, 0x1000);
  writeS32(out, anim + 8, 0x1000);
  writeU16(out, anim + 0x10, 0);
  writeU16(out, anim + 0x12, 0x4000);
  writeS32(out, anim + 0x14, 0x1800);
  writeS32(out, anim + 0x18, 0x0800);
  writeS16(out, anim + 0x1c, 12);
  writeS16(out, anim + 0x1e, -8);
  return out;
}

function makeNanrTFile(): Uint8Array {
  const out = new Uint8Array(0x60);
  out.set(new TextEncoder().encode("RNAN"), 0);
  out[4] = 0xff;
  out[5] = 0xfe;
  out[7] = 1;
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  out.set(new TextEncoder().encode("KNBA"), 0x10);
  writeU32(out, 0x14, out.length - 0x10);
  const abnk = 0x18;
  writeU16(out, abnk, 1);
  writeU16(out, abnk + 2, 2);
  writeU32(out, abnk + 4, 0x18);
  writeU32(out, abnk + 8, 0x28);
  writeU32(out, abnk + 0x0c, 0x38);
  const sequence = abnk + 0x18;
  writeU16(out, sequence, 2);
  writeU32(out, sequence + 4, 2 | (1 << 16));
  writeU32(out, sequence + 8, 2);
  writeU32(out, sequence + 0x0c, 0);
  const frames = abnk + 0x28;
  writeU16(out, frames + 4, 3);
  writeU32(out, frames + 8, 8);
  writeU16(out, frames + 0x0c, 5);
  const anim = abnk + 0x38;
  writeU16(out, anim, 0);
  writeS16(out, anim + 4, 2);
  writeS16(out, anim + 6, 3);
  writeU16(out, anim + 8, 0);
  writeS16(out, anim + 12, 6);
  writeS16(out, anim + 14, -4);
  return out;
}

function makeNcerFile(): Uint8Array {
  const out = new Uint8Array(0x44);
  out.set(new TextEncoder().encode("RECN"), 0);
  out[4] = 0xff;
  out[5] = 0xfe;
  out[7] = 1;
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  out.set(new TextEncoder().encode("KBEC"), 0x10);
  writeU32(out, 0x14, out.length - 0x10);
  const cebk = 0x18;
  writeU16(out, cebk, 1);
  writeU16(out, cebk + 2, 1);
  writeU32(out, cebk + 4, 0x10);
  writeU32(out, cebk + 8, 0);
  const cell = cebk + 0x10;
  writeU16(out, cell, 2);
  writeU32(out, cell + 4, 0);
  writeS16(out, cell + 8, 24);
  writeS16(out, cell + 10, 32);
  writeS16(out, cell + 12, -8);
  writeS16(out, cell + 14, -16);
  const oam = cell + 0x10;
  writeU16(out, oam, 0);
  writeU16(out, oam + 2, 1 << 14);
  writeU16(out, oam + 4, 3 | (2 << 12));
  writeU16(out, oam + 6, 0xf0 | (1 << 14));
  writeU16(out, oam + 8, 0x1f8 | (1 << 12));
  writeU16(out, oam + 10, 10 | (1 << 12));
  return out;
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function rgb555(r: number, g: number, b: number): number {
  return r | (g << 5) | (b << 10);
}

function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function writeS32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function writeS16(out: Uint8Array, offset: number, value: number): void {
  writeU16(out, offset, value & 0xffff);
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}
