import { describe, expect, it } from "vitest";
import { parseTownMapAreas, writeTownMapAreas, moveTownMapArea, editTownMapText, appendTownMapArea, townMapHit, TownMapHistory, type TownMapDraft } from "../pokeweb/townMapModel";
import { fillTownMapTiles, repackTownMapResource, unpackTownMapResource } from "../pokeweb/townMapGraphics";
import { parseNitroBackground } from "../pokeweb/nitroBg";
import { writeU16, writeU32 } from "../nds/binary";

function draft(): TownMapDraft {
  const bytes = new Uint8Array(85 * 54);
  for (let i = 0; i < 85; i++) { writeU16(bytes, i * 54, i); writeU16(bytes, i * 54 + 34, 0); for (let n = 18; n < 24; n++) writeU16(bytes, i * 54 + n * 2, 65535); }
  return { areas: parseTownMapAreas(bytes), graphics: new Map(), habitatGraphics: new Map(), texts: [["0_0", "Shared", 42]], landings: {},
    baseline: { areas: bytes, graphics: new Map(), habitatGraphics: new Map(), texts: new Uint8Array(), landings: "null" } };
}
function resource(stamp: string, block: string, payload: Uint8Array) {
  const out = new Uint8Array(24 + payload.length); out.set(new TextEncoder().encode(stamp)); writeU16(out, 4, 0xfeff); writeU16(out, 6, 0x100); writeU32(out, 8, out.length); writeU16(out, 12, 16); writeU16(out, 14, 1); out.set(new TextEncoder().encode(block), 16); writeU32(out, 20, 8 + payload.length); out.set(payload, 24); return out;
}
describe("BW2 Town Map areas", () => {
  it("round trips every word, including unknown values and signed habitat coordinates", () => {
    const bytes = new Uint8Array(85 * 54);
    for (let i = 0; i < bytes.length / 2; i++) writeU16(bytes, i * 2, (i * 117 + 0x8000) & 65535);
    const areas = parseTownMapAreas(bytes); expect(areas[0].habitat.x).toBeLessThan(0); expect(writeTownMapAreas(areas)).toEqual(bytes);
    expect(() => parseTownMapAreas(bytes.subarray(1))).toThrow("complete");
    expect(() => parseTownMapAreas(new Uint8Array(129 * 54))).toThrow();
    areas[0].habitat.x = 32768; expect(() => writeTownMapAreas(areas)).toThrow("invalid");
  });
  it("moves linked handles atomically and leaves habitat placement independent", () => {
    const a = draft().areas[0]; a.position = { x: 40, y: 50 }; a.cursor = { x: 42, y: 55 }; a.hit = { start: { x: 39, y: 50 }, end: { x: 45, y: 50 }, radius: 4 }; a.habitat.x = -16;
    moveTownMapArea(a, 3, -2, true); expect(a.position).toEqual({ x: 43, y: 48 }); expect(a.cursor).toEqual({ x: 45, y: 53 }); expect(a.hit.start.x).toBe(42); expect(a.habitat.x).toBe(-16);
    const before = structuredClone(a); expect(() => moveTownMapArea(a, -100, 0, true)).toThrow(); expect(a).toEqual(before);
    moveTownMapArea(a, 1, 1, false, "cursor"); expect(a.position).toEqual(before.position); expect(a.cursor.x).toBe(before.cursor.x + 1);
  });
  it("selects a capsule including rounded endpoints and zero-length segments", () => {
    const a = draft().areas[0]; a.hit = { start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, radius: 3 };
    expect(townMapHit(a, 8, 10)).toBe(true); expect(townMapHit(a, 15, 14)).toBe(false); a.hit.end = { x: 10, y: 10 }; expect(townMapHit(a, 12, 10)).toBe(true);
  });
  it("copies shared descriptions on edit and supports explicit shared edits", () => {
    const d = draft(); editTownMapText(d, 0, 0, "Local"); expect(d.areas[0].description).toBe(1); expect(d.texts[0][1]).toBe("Shared");
    editTownMapText(d, 1, 0, "Everyone", true); expect(d.texts[0][1]).toBe("Everyone"); expect(d.texts[1][1]).toBe("Local");
    editTownMapText(d, 0, 1, "New landmark"); expect(d.areas[0].landmarks[0]).toBe(2);
  });
  it("appends without renumbering stock records and rejects duplicates and overflow", () => {
    const d = draft(), original = structuredClone(d.areas); expect(appendTownMapArea(d, 0, 300)).toBe(85); expect(d.areas.slice(0, 85)).toEqual(original); expect(d.areas[85].fly).toBe(0);
    expect(() => appendTownMapArea(d, 0, 300)).toThrow("already"); while (d.areas.length < 128) appendTownMapArea(d, 0, d.areas.length + 300); expect(() => appendTownMapArea(d, 0, 999)).toThrow("128");
  });
  it("undoes graphics, areas and text together, then invalidates redo on new work", () => {
    const d = draft(), h = new TownMapHistory(); d.graphics.set(0, Uint8Array.of(1)); h.checkpoint(d); d.areas[0].radius = 12; d.graphics.get(0)![0] = 2; editTownMapText(d, 0, 0, "Changed");
    expect(h.undo(d)).toBe(true); expect(d.areas[0].radius).toBe(0); expect(d.graphics.get(0)![0]).toBe(1); expect(d.texts).toHaveLength(1);
    h.redo(d); expect(d.areas[0].radius).toBe(12); h.undo(d); h.checkpoint(d); expect(h.canRedo).toBe(false);
  });
});
describe("Town Map graphics", () => {
  it("selects extended 256-color banks while leaving ordinary 8bpp decoding unchanged", () => {
    const sp = new Uint8Array(14); writeU16(sp, 0, 8); writeU16(sp, 2, 8); writeU16(sp, 4, 2); writeU16(sp, 6, 2); writeU32(sp, 8, 2); writeU16(sp, 12, 0x1000);
    const cp = new Uint8Array(24 + 64); writeU32(cp, 4, 4); writeU32(cp, 16, 64); writeU32(cp, 20, 24); cp.fill(1, 24);
    const pp = new Uint8Array(16 + 1024); writeU32(pp, 8, 1024); writeU32(pp, 12, 16); writeU16(pp, 16 + 2, 31); writeU16(pp, 16 + 257 * 2, 31 << 5);
    const screen = resource("RCSN", "NRCS", sp), chars = resource("RGCN", "RAHC", cp), palette = resource("RLCN", "TTLP", pp);
    expect([...parseNitroBackground(0, screen, chars, palette).rgba.slice(0, 4)]).toEqual([0, 248, 0, 255]);
    expect([...parseNitroBackground(0, screen, chars, palette, { extendedPaletteBanks: false }).rgba.slice(0, 4)]).toEqual([248, 0, 0, 255]);
  });
  it.each([0x10, 0x11])("preserves unchanged compressed resources and edits valid literal streams (%i)", kind => {
    const original = Uint8Array.of(kind, 8, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8), data = unpackTownMapResource(original);
    expect(repackTownMapResource(original, data)).toBe(original); data[2] = 99; expect(unpackTownMapResource(repackTownMapResource(original, data))).toEqual(data);
  });
  it("fills adjacent cells without wrapping across a row edge", () => {
    const e = new Uint16Array(1024).fill(2); e[31] = e[32] = 0; fillTownMapTiles(e, 31, 3); expect(e[31]).toBe(3); expect(e[32]).toBe(0);
  });
});
