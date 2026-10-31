import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { captureTownMapArtwork, placeTownMapArtwork, townMapArtworkAreas, townMapArtworkPixels, TOWN_MAP_TRANSPARENT_PIXEL } from "../pokeweb/townMapArtwork";
import { readTownMapLayer, writeTownMapLayer, type TownMapLayer } from "../pokeweb/townMapGraphics";
import { parseTownMapAreas, TownMapHistory, type TownMapDraft } from "../pokeweb/townMapModel";

const back: TownMapLayer = { label: "Back", screen: 16, characters: 7, palette: 0, extended: true, maxTiles: 768 };
const front: TownMapLayer = { label: "Front", screen: 17, characters: 5, palette: 0, extended: true, maxTiles: 256 };
const clear = TOWN_MAP_TRANSPARENT_PIXEL;
function resource(stamp: string, block: string, payload: Uint8Array) {
  const out = new Uint8Array(24 + payload.length); out.set(new TextEncoder().encode(stamp)); writeU16(out, 4, 0xfeff); writeU16(out, 6, 0x100);
  writeU32(out, 8, out.length); writeU16(out, 12, 16); writeU16(out, 14, 1); out.set(new TextEncoder().encode(block), 16); writeU32(out, 20, 8 + payload.length); out.set(payload, 24); return out;
}
function fixture(): TownMapDraft {
  const graphics = new Map<number, Uint8Array>();
  const palette = new Uint8Array(16 + 512 * 2); writeU32(palette, 8, 1024); writeU32(palette, 12, 16);
  writeU16(palette, 16 + 2, 31); writeU16(palette, 16 + 4, 31 << 5); writeU16(palette, 16 + 257 * 2, 31 << 10); writeU16(palette, 16 + 258 * 2, 31 | 31 << 5);
  graphics.set(0, resource("RLCN", "TTLP", palette));
  for (const layer of [back, front]) {
    const chars = new Uint8Array(24 + 3 * 64); writeU32(chars, 4, 4); writeU32(chars, 16, 3 * 64); writeU32(chars, 20, 24);
    for (let p = 0; p < 64; p++) chars[24 + 64 + p] = p % 8 < 4 ? 1 : 2;
    chars.fill(2, 24 + 128); graphics.set(layer.characters, resource("RGCN", "RAHC", chars));
    const screen = new Uint8Array(12 + 2048); writeU16(screen, 0, 256); writeU16(screen, 2, 256); writeU16(screen, 4, 2); writeU16(screen, 6, 2); writeU32(screen, 8, 2048);
    writeU16(screen, 12, 1 | 1024); writeU16(screen, 14, 1 | 2048 | 1 << 12); writeU16(screen, 12 + 40 * 2, 1); writeU16(screen, 12 + 42 * 2, 2);
    graphics.set(layer.screen, resource("RCSN", "NRCS", screen));
  }
  const bytes = new Uint8Array(85 * 54), areas = parseTownMapAreas(bytes);
  areas.forEach(a => { a.position = { x: 200, y: 200 }; a.cursor = { x: 202, y: 201 }; });
  areas[0].position = { x: 3, y: 3 }; areas[0].cursor = { x: 4, y: 4 }; areas[0].hit = { start: { x: 1, y: 2 }, end: { x: 6, y: 2 }, radius: 3 }; areas[0].habitat = { animation: 0, x: -2, y: 4 };
  return { areas, graphics, habitatGraphics: new Map(), texts: [], landings: {}, baseline: { areas: bytes, graphics: new Map(), habitatGraphics: new Map(), texts: new Uint8Array(), landings: "null", headers: "", cachedTexts: "null" } };
}
const pixels = (d: TownMapDraft, layer = front) => townMapArtworkPixels(readTownMapLayer(d.graphics, layer));

describe("assembled Town Map artwork editing", () => {
  it("captures rendered positions, flips, extended palette banks and transparency", () => {
    const d = fixture(), clip = captureTownMapArtwork(d.graphics, [front], { x: 0, y: 0, width: 24, height: 8 });
    expect([...clip.layers[0].pixels.slice(0, 4)]).toEqual([2, 2, 2, 2]);
    expect(clip.layers[0].pixels[4]).toBe(1); expect(clip.layers[0].pixels[8]).toBe(257); expect(clip.layers[0].pixels[16]).toBe(clear);
    expect(townMapArtworkAreas(d.areas, clip.source)).toEqual([0]);
  });

  it("copies art at pixel precision without changing its source or shared tile aliases", () => {
    const d = fixture(), before = pixels(d), layerBytes = d.graphics.get(back.screen)!.slice(), palette = d.graphics.get(0)!.slice();
    const clip = captureTownMapArtwork(d.graphics, [front], { x: 1, y: 1, width: 5, height: 5 });
    placeTownMapArtwork(d, clip, { x: 19, y: 3 });
    const after = pixels(d);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) expect(after[(3 + y) * 256 + 19 + x]).toBe(before[(1 + y) * 256 + 1 + x]);
    expect(after[1 * 256 + 1]).toBe(before[1 * 256 + 1]); expect(after[8 * 256 + 64]).toBe(before[8 * 256 + 64]);
    expect(d.graphics.get(back.screen)).toEqual(layerBytes); expect(d.graphics.get(0)).toEqual(palette); expect(d.areas[0].position).toEqual({ x: 3, y: 3 });
  });

  it("moves overlapping selections using the original pixels and clears the vacated area", () => {
    const d = fixture(), before = pixels(d), clip = captureTownMapArtwork(d.graphics, [front], { x: 0, y: 0, width: 8, height: 8 });
    placeTownMapArtwork(d, clip, { x: 0, y: 2 }, { move: true });
    const after = pixels(d);
    for (let x = 0; x < 8; x++) { expect(after[x]).toBe(clear); expect(after[256 + x]).toBe(clear); }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(after[(y + 2) * 256 + x]).toBe(before[y * 256 + x]);
  });

  it("moves both layers and associated handles as one undoable edit", () => {
    const d = fixture(), h = new TownMapHistory(), before = structuredClone(d), clip = captureTownMapArtwork(d.graphics, [back, front], { x: 0, y: 0, width: 8, height: 8 });
    h.edit(d, () => placeTownMapArtwork(d, clip, { x: 24, y: 8 }, { move: true, moveAreas: true }));
    expect(d.areas[0].position).toEqual({ x: 27, y: 11 }); expect(d.areas[0].cursor).toEqual({ x: 28, y: 12 });
    expect(d.areas[0].hit.start).toEqual({ x: 25, y: 10 }); expect(d.areas[0].hit.end).toEqual({ x: 30, y: 10 }); expect(d.areas[0].habitat).toEqual(before.areas[0].habitat);
    expect(pixels(d, back)[8 * 256 + 24]).toBe(2); expect(pixels(d)[0]).toBe(clear);
    h.undo(d); expect(d.graphics).toEqual(before.graphics); expect(d.areas).toEqual(before.areas);
    h.redo(d); expect(d.areas[0].position.x).toBe(27); expect(pixels(d)[0]).toBe(clear);
  });

  it("pastes transparent pixels over existing art without erasing that art", () => {
    const d = fixture(), clip = captureTownMapArtwork(d.graphics, [front], { x: 16, y: 0, width: 8, height: 8 }), before = structuredClone(d.graphics);
    placeTownMapArtwork(d, clip, { x: 0, y: 0 }); expect(d.graphics).toEqual(before);
  });

  it("rolls back mixed palette banks, out-of-map placements and invalid linked movement", () => {
    const d = fixture(), before = structuredClone(d), clip = captureTownMapArtwork(d.graphics, [front], { x: 0, y: 0, width: 8, height: 8 });
    expect(() => placeTownMapArtwork(d, clip, { x: 4, y: 0 })).toThrow("palette banks"); expect(d).toEqual(before);
    expect(() => placeTownMapArtwork(d, clip, { x: 252, y: 0 })).toThrow("inside"); expect(d).toEqual(before);
    d.areas[0].hit.start.x = 65535; const invalid = structuredClone(d);
    expect(() => placeTownMapArtwork(d, clip, { x: 24, y: 8 }, { move: true, moveAreas: true })).toThrow("range"); expect(d).toEqual(invalid);
  });

  it("reclaims unused tiles at capacity and rejects edits needing additional unique tiles", () => {
    const d = fixture(), limited = { ...front, maxTiles: 3 }, clip = captureTownMapArtwork(d.graphics, [limited], { x: 0, y: 0, width: 8, height: 8 });
    // A tile-aligned move reuses the source tile and the existing transparent tile.
    placeTownMapArtwork(d, clip, { x: 24, y: 0 }, { move: true }); expect(readTownMapLayer(d.graphics, limited).indexed.tilePixels.length).toBeLessThanOrEqual(3);
    const second = captureTownMapArtwork(d.graphics, [limited], { x: 25, y: 1, width: 5, height: 5 }), before = structuredClone(d);
    expect(() => placeTownMapArtwork(d, second, { x: 40, y: 16 })).toThrow("limit"); expect(d).toEqual(before);
  });

  it("reclaims flipped duplicate tiles while preserving their displayed pixels", () => {
    const d = fixture(), limited = { ...front, maxTiles: 4 }, image = readTownMapLayer(d.graphics, limited);
    const duplicate = new Uint8Array(64);
    for (let p = 0; p < 64; p++) duplicate[p] = image.indexed.tilePixels[1][(p >> 3) * 8 + 7 - (p & 7)];
    image.indexed.tilePixels.push(duplicate); image.indexed.entries[43] = 3 | 2048 | 1 << 12;
    writeTownMapLayer(d.graphics, limited, image);
    const before = pixels(d), clip = captureTownMapArtwork(d.graphics, [limited], { x: 1, y: 1, width: 5, height: 5 });
    placeTownMapArtwork(d, clip, { x: 19, y: 16 });
    const after = pixels(d);
    expect(readTownMapLayer(d.graphics, limited).indexed.tilePixels.length).toBe(4);
    for (let y = 0; y < 8; y++) for (let x = 88; x < 96; x++) expect(after[(y + 8) * 256 + x]).toBe(before[(y + 8) * 256 + x]);
  });

  it("publishes neither layer if the second layer exceeds capacity", () => {
    const d = fixture(), before = structuredClone(d), clip = captureTownMapArtwork(d.graphics, [back, { ...front, maxTiles: 3 }], { x: 0, y: 0, width: 8, height: 8 });
    expect(() => placeTownMapArtwork(d, clip, { x: 19, y: 16 }, { move: true, moveAreas: true })).toThrow("limit"); expect(d).toEqual(before);
  });

  it("clears only the selected rectangle without removing area records", () => {
    const d = fixture(), before = structuredClone(d.areas), clip = captureTownMapArtwork(d.graphics, [front], { x: 0, y: 0, width: 4, height: 8 });
    placeTownMapArtwork(d, clip, clip.source, { erase: true }); const after = pixels(d);
    expect(after[0]).toBe(clear); expect(after[4]).toBe(1); expect(d.areas).toEqual(before);
  });
});
