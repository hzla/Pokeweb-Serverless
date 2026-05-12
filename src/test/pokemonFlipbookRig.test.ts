import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { buildPairedPokemonFlipbookRigsFromFrames, buildPokemonFlipbookRigFromFrames, defaultPokemonFlipbookImportConfig } from "../pokeweb/pokemonFlipbookRig";
import { parsePokemonAnimationBundle } from "../pokeweb/pokemonSpriteWriters";
import { decompressNitro, parsePokemonAnimation, parsePokemonCellBank, parsePokemonMultiCells, parseRigCells, type PokemonAnimationFrame, type PokemonCell } from "../pokeweb/pokemonSpriteModel";

describe("pokemonFlipbookRig", () => {
  it("defaults to compact pose-block flipbook output", () => {
    const frames = Array.from({ length: 6 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillRect(frame, 18 + index, 20, 12, 10, [200, 80, 40, 255]));

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      strategy: "first-window",
      maxUniqueFrames: 4,
    });

    expect(result.sprite).toMatchObject({ width: 96, height: 96 });
    expect(result.rig).toMatchObject({ width: 256, height: 128 });
    expect(result.palette).toHaveLength(16);
    expect(result.report.packingMode).toBe("block");
    expect(result.report.uniquePoseCount).toBeGreaterThan(1);
    expect(result.report.uniqueTileCount).toBeGreaterThan(0);
    expect(result.report.groundValidation.maxVisibleBottomY).toBeLessThanOrEqual(3);
    expect(result.report.groundValidation.appliedShiftY).toBeLessThan(0);
    expect(result.report.visibilityValidation.invisibleFrameCount).toBe(0);
    expect(result.bundle.length).toBeGreaterThan(0);
  });

  it("uses full-pose block packing so every animation cell has NCEC metadata", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillSparseTiles(frame, 0, 0, 48, 48, [80 + index * 20, 180, 80, 255]));

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      packingMode: "mcss-safe",
      strategy: "first-window",
      maxUniqueFrames: 3,
    });

    const bundle = parsePokemonAnimationBundle(result.bundle);
    const rigCells = parseRigCells(bundle.files[8] ?? new Uint8Array());
    const multiCells = parsePokemonMultiCells(bundle.files[6] ?? new Uint8Array());

    expect(result.report.packingMode).toBe("block");
    expect(rigCells.cells).toHaveLength(result.report.uniquePoseCount);
    expect(multiCells.cells).toHaveLength(2);
    expect(multiCells.cells.map((cell) => cell.nodes.length)).toEqual([1, 1]);
    expect(result.report.visibilityValidation.invisibleFrameCount).toBe(0);
  });

  it("can build a tile-node dedup flipbook with one animated sequence per visible tile node", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillSparseTiles(frame, 0, 0, 48, 48, [80 + index * 20, 180, 80, 255]));

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      packingMode: "tile-node-dedup",
      strategy: "first-window",
      maxUniqueFrames: 3,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);
    const rigCells = parseRigCells(bundle.files[8] ?? new Uint8Array());
    const animation = parsePokemonAnimation(decompressNitro(bundle.files[5] ?? new Uint8Array()));
    const multiCells = parsePokemonMultiCells(bundle.files[6] ?? new Uint8Array());

    expect(result.report.packingMode).toBe("tile-node-dedup");
    expect(result.report.uniquePoseCount).toBe(3);
    expect(rigCells.cells).toHaveLength(result.report.uniqueTileCount);
    expect(animation.sequences.length).toBeGreaterThan(16);
    expect(multiCells.cells[0]?.nodes.length).toBe(animation.sequences.length);
    expect(multiCells.cells[0]?.nodes.some((node) => node.x !== 0 || node.y !== 0)).toBe(true);
    expect(animation.sequences.flatMap((sequence) => sequence.frames).every((frame) => frame.x === 0 && frame.y === 0)).toBe(true);
  });

  it("can build occupancy-aware macro blocks without exploding into tile nodes", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => {
      fillRect(frame, 0, 0, 16, 48, [120 + index * 20, 80, 200, 255]);
      fillRect(frame, 32, 24, 16, 24, [120 + index * 20, 80, 200, 255]);
    });

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      packingMode: "macro-blocks",
      strategy: "first-window",
      maxUniqueFrames: 3,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);
    const animation = parsePokemonAnimation(decompressNitro(bundle.files[5] ?? new Uint8Array()));
    const multiCells = parsePokemonMultiCells(bundle.files[6] ?? new Uint8Array());
    const multiAnimation = parsePokemonAnimation(bundle.files[7] ?? new Uint8Array(), "front", "RAMN");
    const rigCells = parseRigCells(bundle.files[8] ?? new Uint8Array());

    expect(result.report.packingMode).toBe("macro-blocks");
    expect(result.report.uniquePoseCount).toBe(3);
    expect(result.report.maxOamsPerPose).toBeLessThan(24);
    expect(animation.sequences.length).toBeGreaterThan(0);
    expect(animation.sequences.every((sequence) => sequence.frames.length === result.report.timelineFrames.length)).toBe(true);
    expect(multiCells.cells).toHaveLength(2);
    expect(multiCells.cells.map((cell) => cell.nodes.length)).toEqual([animation.sequences.length, animation.sequences.length]);
    expect(multiAnimation.sequences[0]?.frames).toEqual([expect.objectContaining({ cellIndex: 0 })]);
    expect(rigCells.cells.length).toBeGreaterThan(result.report.uniquePoseCount);
    expect(animation.sequences.flatMap((sequence) => sequence.frames).some((frame) => frame.cellIndex > 0)).toBe(true);
  });

  it("preserves repeated manual frame numbers as an extended animation timeline", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillRect(frame, 18 + index * 2, 20, 12, 10, [200, 80 + index * 20, 40, 255]));
    const manualFrameNumbers = [0, 1, 2, 1, 0, 1, 2, 1, 0];

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      packingMode: "mcss-safe",
      manualFrameNumbers,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);
    const animation = parsePokemonAnimation(decompressNitro(bundle.files[5] ?? new Uint8Array()));

    expect(result.report.selectedSourceFrames).toEqual([0, 1, 2]);
    expect(result.report.timelineFrames).toEqual(manualFrameNumbers);
    expect(animation.sequences[0]?.frames).toHaveLength(manualFrameNumbers.length);
    expect(animation.sequences[0]?.frames.map((frame) => frame.cellIndex)).toEqual([0, 1, 2, 1, 0, 1, 2, 1, 0]);
  });

  it("can store overflow pose blocks rotated and unrotate them in NANR playback", () => {
    const frames = Array.from({ length: 6 }, (_, index) => makeSizedFrame(index, 96, 96));
    frames.forEach((frame, index) => fillRect(frame, 24, 8, 48, 72, [80 + index * 20, 120, 210 - index * 12, 255]));

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      packingMode: "rotated-pose-blocks",
      strategy: "first-window",
      maxUniqueFrames: 6,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);
    const animation = parsePokemonAnimation(decompressNitro(bundle.files[5] ?? new Uint8Array()));
    const cellBank = parsePokemonCellBank(bundle.files[4] ?? new Uint8Array(), "front");
    const rigCells = parseRigCells(bundle.files[8] ?? new Uint8Array());

    expect(result.report.packingMode).toBe("rotated-block");
    expect(result.report.uniquePoseCount).toBe(6);
    expect(result.report.visibilityValidation.invisibleFrameCount).toBe(0);
    expect(animation.sequences[0]?.frames).toHaveLength(6);
    expect(animation.sequences[0]?.frames.some((frame) => frame.rotation !== 0)).toBe(true);
    expect(rigCells.cells).toHaveLength(6);
    expect(rigCells.cells.some((cell) => cell.width === 72 && cell.height === 48)).toBe(true);
    animation.sequences[0]?.frames.forEach((frame) => {
      const cell = cellBank.cells[frame.cellIndex];
      expect(cell ? transformedCellMaxY(cell, frame) : Infinity).toBeLessThanOrEqual(3.001);
    });
  });

  it("builds paired front/back flipbooks with one shared palette", () => {
    const frontFrames = Array.from({ length: 2 }, (_, index) => makeSizedFrame(index, 48, 48));
    const backFrames = Array.from({ length: 2 }, (_, index) => makeSizedFrame(index, 48, 48));
    frontFrames.forEach((frame, index) => {
      fillRect(frame, 12 + index, 10, 12, 12, [238, 238, 246, 255]);
      fillRect(frame, 24, 24, 8, 8, [80, 56, 140, 255]);
    });
    backFrames.forEach((frame, index) => {
      fillRect(frame, 10, 12 + index, 12, 12, [238, 238, 246, 255]);
      fillRect(frame, 26, 24, 8, 8, [80, 56, 140, 255]);
    });

    const result = buildPairedPokemonFlipbookRigsFromFrames(frontFrames, backFrames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      strategy: "first-window",
      maxUniqueFrames: 2,
    });

    expect(result.front.palette).toEqual(result.palette);
    expect(result.back.palette).toEqual(result.palette);
    expect(result.front.palette).toEqual(result.back.palette);
    expect(result.front.report.visibilityValidation.invisibleFrameCount).toBe(0);
    expect(result.back.report.visibilityValidation.invisibleFrameCount).toBe(0);
  });

  it("scales animation duration without changing the packed poses", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillRect(frame, 18 + index, 20, 12, 10, [200, 80, 40, 255]));

    const normal = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      strategy: "first-window",
      maxUniqueFrames: 3,
      durationScale: 1,
    });
    const slow = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("front"),
      strategy: "first-window",
      maxUniqueFrames: 3,
      durationScale: 4,
    });

    expect(slow.report.durationScale).toBe(4);
    expect(slow.report.maxOamsPerPose).toBe(normal.report.maxOamsPerPose);
    expect(slow.report.uniquePoseCount).toBe(normal.report.uniquePoseCount);
    expect(slow.report.uniqueTileCount).toBe(normal.report.uniqueTileCount);
  });

  it("stores generated animation sidecars with the vanilla compression pattern", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillRect(frame, 18 + index, 20, 12, 10, [200, 80, 40, 255]));

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("back"),
      packingMode: "mcss-safe",
      strategy: "first-window",
      maxUniqueFrames: 3,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);

    expect(bundle.files[13]?.[0]).toBe("R".charCodeAt(0));
    expect(bundle.files[14]?.[0]).toBe(0x11);
    expect(bundle.files[15]?.[0]).toBe("R".charCodeAt(0));
    expect(bundle.files[16]?.[0]).toBe("R".charCodeAt(0));
    expect(bundle.files[17]?.[0]).not.toBe(0x11);
  });

  it("writes a full-pose rig metadata entry for each flipbook pose", () => {
    const frames = Array.from({ length: 3 }, (_, index) => makeFrame(index));
    frames.forEach((frame, index) => fillSparseTiles(frame, 0, 0, 48, 48, [80 + index * 20, 180, 80, 255]));

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("back"),
      packingMode: "mcss-safe",
      strategy: "first-window",
      maxUniqueFrames: 3,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);
    const rigCells = parseRigCells(bundle.files[17] ?? new Uint8Array());

    expect(result.report.packingMode).toBe("block");
    expect(rigCells.cells).toHaveLength(result.report.uniquePoseCount);
    expect(rigCells.cells[0]).toMatchObject({ width: 48, height: 48 });
    expect(rigCells.cells[0].width).toBeGreaterThan(8);
    expect(rigCells.cells[0].height).toBeGreaterThan(8);
    expect(readU16(bundle.files[17] ?? new Uint8Array(), 4)).toBeGreaterThan(0);
    expect(readU16(bundle.files[17] ?? new Uint8Array(), 6)).toBeGreaterThan(0);
  });

  it("can build a single-pose static flipbook for send-out diagnostics", () => {
    const frames = [makeFrame(0)];
    fillRect(frames[0], 18, 20, 12, 10, [200, 80, 40, 255]);

    const result = buildPokemonFlipbookRigFromFrames(frames, {
      ...defaultPokemonFlipbookImportConfig("back"),
      packingMode: "mcss-safe",
      strategy: "first-window",
      maxUniqueFrames: 1,
    });
    const bundle = parsePokemonAnimationBundle(result.bundle);

    expect(result.report.uniquePoseCount).toBe(1);
    expect(result.report.timelineFrames).toHaveLength(1);
    expect(parseRigCells(bundle.files[17] ?? new Uint8Array()).cells).toHaveLength(1);
  });
});

function makeFrame(index: number) {
  return makeSizedFrame(index, 48, 48);
}

function makeSizedFrame(index: number, width: number, height: number) {
  return { index, width, height, delayMs: 100, pixels: new Uint8ClampedArray(width * height * 4) };
}

function fillRect(frame: ReturnType<typeof makeSizedFrame>, x: number, y: number, width: number, height: number, color: [number, number, number, number]): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) frame.pixels.set(color, (py * frame.width + px) * 4);
  }
}

function fillSparseTiles(frame: ReturnType<typeof makeSizedFrame>, x: number, y: number, width: number, height: number, color: [number, number, number, number]): void {
  for (let py = y; py < y + height; py += 8) {
    for (let px = x; px < x + width; px += 8) {
      frame.pixels.set(color, (py * frame.width + px) * 4);
    }
  }
}

function transformedCellMaxY(cell: PokemonCell, frame: PokemonAnimationFrame): number {
  const rotation = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let maxY = -Infinity;
  for (const oam of cell.oams) {
    const corners = [
      { x: oam.x, y: oam.y },
      { x: oam.x + oam.width, y: oam.y },
      { x: oam.x + oam.width, y: oam.y + oam.height },
      { x: oam.x, y: oam.y + oam.height },
    ];
    for (const corner of corners) {
      maxY = Math.max(maxY, corner.x * sin + corner.y * cos + frame.y);
    }
  }
  return maxY;
}
