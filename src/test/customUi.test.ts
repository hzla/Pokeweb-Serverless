import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { newProject, newElement } from "../customUi/document";
import { validate } from "../customUi/validate";
import { archive, recoverArchive, importBundle, exportBundle } from "../customUi/bundle";
import { History, duplicateScreen, removeScreen, moveElements } from "../customUi/history";
import { activate, completeNative, input, resolveText, start } from "../customUi/interaction";
import { fixtures } from "../customUi/fixtures";
import { compile, decodeTiles, encodeTiles, preview } from "../customUi/compiler";
import { NativeFont, rgb555, type Assets } from "../customUi/assets";
import { nativeLearnsetPreset } from "../customUi/nativeCatalog";
import { compileLearnsetNative } from "../customUi/learnsetNative";
import { updateArchiveSource, mergeImportedBundle } from "../customUi/bundle";
import { NARC } from "../nds/narc";

const assets: Assets = { glyph: (_font, c) => ({ width: 2, height: 2, advance: 3, pixels: Uint8Array.from(c === " " ? [0, 0, 0, 0] : [1, 0, 2, 1]) }), image: () => undefined, icon: () => undefined };
describe("Native UI imports", () => {
  it("imports live regions and compiles a bounded, data-only native adapter", () => {
    const p = nativeLearnsetPreset(); expect(validate(p.document)).toEqual([]);
    const full = compileLearnsetNative(p.document); expect(full.diagnostics).toEqual([]); expect(full.bytes?.length).toBe(32);
    expect(new DataView(full.bytes!.buffer).getUint32(12, true)).toBe(63);
    p.document.screens[0].elements.find(e => e.native === "learnset.stats")!.hidden = true;
    expect(new DataView(compileLearnsetNative(p.document).bytes!.buffer).getUint32(12, true)).toBe(61);
    expect(importBundle(exportBundle(p))).toEqual(p);
  });
  it("rejects unsupported native layout edits and launchers before staging", () => {
    const p = nativeLearnsetPreset(), region = p.document.screens[0].elements.find(e => e.native === "learnset.stats")!;
    region.x += 8; expect(compileLearnsetNative(p.document).bytes).toBeUndefined(); region.x -= 8;
    p.document.launchers.field = "learnset"; expect(compileLearnsetNative(p.document).bytes).toBeUndefined(); delete p.document.launchers.field;
    p.document.screens[0].elements.push(newElement("button", "unimplemented")); expect(compileLearnsetNative(p.document).bytes).toBeUndefined();
  });
  it("accepts equivalent native shortcuts regardless of JSON property order", () => {
    const p = nativeLearnsetPreset(), screen = p.document.screens[0];
    screen.shortcuts = Object.fromEntries(Object.entries(screen.shortcuts!).reverse());
    expect(compileLearnsetNative(p.document).bytes?.length).toBe(32);
  });
  it("retains the applied program when a later draft is exported", () => {
    const p = nativeLearnsetPreset(), program = compileLearnsetNative(p.document).bytes!;
    p.installation = { version: 1, enabled: true, digest: "applied" };
    const bytes = archive(p, undefined, program); p.document.name = "Unapplied draft";
    const updated = updateArchiveSource(bytes, p);
    expect(new NARC(updated).files[2]).toEqual(program); expect(recoverArchive(updated).document.name).toBe("Unapplied draft");
  });
  it("locks native geometry while moving neighboring authored components", () => {
    const p = nativeLearnsetPreset(), native = p.document.screens[0].elements[2], authored = newElement("text", "added");
    p.document.screens[0].elements.push(authored); moveElements(p.document.screens[0].elements, new Set([native.id, authored.id]), 8, 8, false);
    expect(native.x).toBe(0); expect(authored.x).toBe(24);
  });
});
describe("Custom UI document boundaries", () => {
  it("keeps bundle bytes stable across different export dates", () => {
    vi.useFakeTimers();
    try {
      const p = newProject(); vi.setSystemTime(new Date("2026-01-01")); const first = exportBundle(p);
      vi.setSystemTime(new Date("2027-06-15")); expect(exportBundle(p)).toEqual(first);
    } finally { vi.useRealTimers(); }
  });
  it("rejects executable or unknown content, dangling references and invalid bounds", () => {
    const project = newProject(); expect(validate(project.document)).toEqual([]);
    const element = project.document.screens[0].elements[0]; element.x = 250;
    (element.action as unknown as Record<string, unknown>).script = "alert(1)";
    project.document.launchers.field = "missing";
    expect(validate(project.document).map(d => d.code)).toEqual(expect.arrayContaining(["bounds", "unknown-property", "launcher"]));
  });
  it("round trips source bundles and private ROM archives without editor state", () => {
    const p = newProject(); expect(importBundle(exportBundle(p))).toEqual(p);
    expect(recoverArchive(archive(p, compile(p.document, assets)))).toEqual(p);
  });
  it("rejects zip paths, orphan files and missing asset data", () => {
    expect(() => importBundle(zipSync({ "../project.json": strToU8("{}") }))).toThrow("paths");
    const p = newProject(); p.document.assets.push({ id: "image", name: "Image", path: "assets/image.png", width: 1, height: 1 });
    expect(() => exportBundle(p)).toThrow("Missing");
  });
});
describe("Custom UI edit transactions", () => {
  it("preserves old asset bytes when undoing an import with colliding paths", () => {
    const p = newProject(); p.document.assets.push({ id: "art", name: "Art", path: "assets/art.png", width: 1, height: 1 });
    p.files["assets/art.png"] = Uint8Array.of(1); const history = new History(p.document);
    const incoming = structuredClone(p); incoming.files["assets/art.png"] = Uint8Array.of(2);
    history.commit(mergeImportedBundle(p, incoming));
    expect(p.files[history.document.assets[0].path]).toEqual(Uint8Array.of(2));
    history.undo(); expect(p.files[history.document.assets[0].path]).toEqual(Uint8Array.of(1));
  });
  it("commits a drag once and preserves the original snapshot through redo", () => {
    const history = new History(newProject().document), draft = structuredClone(history.document), element = draft.screens[0].elements[0];
    moveElements(draft.screens[0].elements, new Set([element.id]), 17, 3, true);
    history.commit(draft); expect(history.document.screens[0].elements[0].x).toBe(32);
    history.undo(); expect(history.document.screens[0].elements[0].x).toBe(16); expect(history.canUndo).toBe(false);
    history.redo(); expect(history.document.screens[0].elements[0].x).toBe(32);
  });
  it("remaps internal IDs on duplication and cleans references on deletion", () => {
    const doc = newProject().document; doc.screens[0].elements[2].action = { type: "open", screen: "screen-1" };
    const copy = duplicateScreen(doc, "screen-1"); expect(validate(doc)).toEqual([]);
    expect(doc.screens[1].elements[2].action).toEqual({ type: "open", screen: copy });
    removeScreen(doc, "screen-1"); expect(doc.launchers).toEqual({}); expect(validate(doc)).toEqual([]);
  });
});
describe("Custom UI read-only interaction", () => {
  it("disables native actions for empty party and learnset without its dependency", () => {
    const doc = newProject().document, session = start(doc, fixtures.empty, "field");
    activate({ type: "summary" }, doc, fixtures.empty, session); expect(session.nativeRequest).toBeUndefined();
    const full = start(doc, fixtures.full, "party", 4); activate({ type: "learnset" }, doc, fixtures.full, full); expect(full.nativeRequest).toBeUndefined();
  });
  it("preserves navigation and selection across a native request", () => {
    const doc = newProject().document, session = start(doc, fixtures.full, "party", 4), before = structuredClone(session.stack);
    activate({ type: "summary" }, doc, fixtures.full, session); input(doc, fixtures.full, session, "b");
    expect(session.nativeRequest).toBe("summary"); expect(session.stack).toEqual(before);
    completeNative(session); expect(session.stack).toEqual(before);
    input(doc, fixtures.full, session, "b"); expect(session.closed).toBe(true);
  });
  it("touch and A invoke the same button action, top controls are not touchable", () => {
    const doc = newProject().document, e = newElement("button", "close", "bottom"); e.action = { type: "close" }; e.y = 164; e.height = 24; doc.screens[0].elements.push(e);
    const a = start(doc, fixtures.full, "field"), touch = structuredClone(a);
    a.stack[0].focus = e.id; input(doc, fixtures.full, a, "a"); input(doc, fixtures.full, touch, { x: 20, y: 170 });
    expect(a.closed).toBe(true); expect(touch.closed).toBe(true);
    const top = start(doc, fixtures.full, "field"); input(doc, fixtures.full, top, { x: 150, y: 150 }); expect(top.nativeRequest).toBeUndefined();
  });
  it("scrolls long lists and masks egg data", () => {
    const doc = newProject().document, list = doc.screens[0].elements[3]; list.list.source = "moves"; list.list.rows = 3;
    const s = start(doc, fixtures.long, "field"); s.stack[0].focus = list.id;
    for (let i = 0; i < 12; i++) input(doc, fixtures.long, s, "down");
    expect(s.stack[0].lists[list.id]).toEqual({ index: 12, scroll: 10 });
    expect(resolveText({ binding: "pokemon.hp" }, fixtures.egg, start(doc, fixtures.egg, "field").stack[0])).toBe("");
  });
});
describe("Custom UI compiled graphics", () => {
  it("keeps transparency and DS precision in tile round trips", () => {
    const image = { width: 2, height: 1, pixels: Uint8ClampedArray.from([255, 128, 0, 255, 255, 255, 255, 0]) };
    const tiles = encodeTiles(image), decoded = decodeTiles(tiles);
    expect(tiles.palette).toContain(rgb555("#ff8000")); expect(decoded.pixels[3]).toBe(255); expect(decoded.pixels[7]).toBe(0);
    expect(decoded.pixels[1]).toBe(132); expect(encodeTiles(decoded)).toEqual(tiles);
  });
  it("uses glyph shadows and reports clipping beside the affected element", () => {
    const p = newProject(), e = p.document.screens[0].elements[0]; e.text = { literal: "ABCD" }; e.width = 3; e.height = 2;
    const compiled = compile(p.document, assets), result = preview(compiled, assets, fixtures.full, start(p.document, fixtures.full, "field"));
    expect(result.diagnostics.some(d => d.element === e.id && d.code === "clipped-text")).toBe(true);
    expect(result.top.pixels[(e.y * 256 + e.x) * 4]).toBe(255);
    expect(result.top.pixels[((e.y + 1) * 256 + e.x) * 4]).toBeLessThan(100);
  });
  it("rejects oversized native sprites and reports missing imported resources", () => {
    const p = newProject(); p.document.screens[0].elements[1].width = 64;
    expect(compile(p.document, assets).valid).toBe(false);
  });
  it("decodes a bounded native glyph including authored foreground and shadow", () => {
    const b = new Uint8Array(96), v = new DataView(b.buffer); v.setUint32(32, 48, true); v.setUint32(40, 64, true);
    b.set([2, 2, 4, 0], 48); b.set([0, 2, 3, 0x60], 56);
    v.setUint16(64, 65, true); v.setUint16(66, 65, true);
    const font = new NativeFont(b); expect(font.glyph("A")?.pixels).toEqual(Uint8Array.from([1, 2, 0, 0])); expect(font.glyph("B")).toBeUndefined();
  });
});
