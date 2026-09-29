import { describe, expect, it } from "vitest";
import { newProject, newElement, STATS, SUMMARY_PAGES, type Access } from "../customUi/document";
import { accessFor, cgearHit, defaultAccess, matchesChord, setAccess } from "../customUi/access";
import { validate } from "../customUi/validate";
import { exportBundle, importBundle, archive, recoverArchive } from "../customUi/bundle";
import { History, removeScreen, moveElements } from "../customUi/history";
import { duplicateElements, deleteElements, resizeElement } from "../customUi/editorOperations";
import { addSummaryPage, addStatOverlay, resetSummaryElement, resolveSummary, migrateSummaryLayouts } from "../customUi/summaryCatalog";
import { fixtures } from "../customUi/fixtures";
import { resolveText, start } from "../customUi/interaction";
import { compileLearnsetNative } from "../customUi/learnsetNative";
import { nativeLearnsetPreset } from "../customUi/nativeCatalog";

describe("Custom UI access authoring", () => {
  function configured() {
    const p = newProject(), id = p.document.screens[0].id;
    const a: Access = { hotkey: defaultAccess("hotkey", id) as Access["hotkey"], party: { screen: id, label: "Custom UI" }, cgear: defaultAccess("cgear", id) as Access["cgear"] };
    setAccess(p.document, a); return p;
  }
  it("preserves legacy documents and round trips all access methods through bundles and ROM source archives", () => {
    const legacy = newProject(); expect(accessFor(legacy.document).party?.screen).toBe("screen-1"); expect(legacy.document.access).toBeUndefined();
    const p = configured(); expect(validate(p.document)).toEqual([]);
    expect(importBundle(exportBundle(p))).toEqual(p); expect(recoverArchive(archive(p))).toEqual(p);
  });
  it("makes one access edit undoable and does not share modal draft references", () => {
    const h = new History(newProject().document), a = accessFor(h.document);
    a.hotkey = { screen: "screen-1", keys: ["L", "Y"] };
    h.edit(doc => setAccess(doc, a)); a.hotkey.keys.push("B");
    expect(h.document.access!.hotkey!.keys).toEqual(["L", "Y"]);
    h.undo(); expect(h.document.access).toBeUndefined(); h.redo(); expect(h.document.access?.hotkey).toBeDefined();
  });
  it.each([["L"], ["L", "L"], ["L", "R", "Start", "Select"], ["Up", "Down"], ["Left", "Right"]])("rejects unsafe or impossible chord %s", (...keys) => {
    const p = configured(); p.document.access!.hotkey!.keys = keys as NonNullable<Access["hotkey"]>["keys"];
    expect(validate(p.document).some(d => d.code === "hotkey")).toBe(true);
  });
  it("requires valid custom destinations and contained touch bounds", () => {
    const p = configured(), summary = addSummaryPage(p.document, "stats");
    p.document.access!.hotkey!.screen = summary; p.document.access!.cgear!.x = 255;
    expect(validate(p.document).filter(d => d.code === "access")).toHaveLength(2);
  });
  it("cleans launch references when a screen is removed", () => {
    const p = configured(); addSummaryPage(p.document, "stats"); removeScreen(p.document, "screen-1");
    expect(p.document.access).toEqual({}); expect(p.document.launchers).toEqual({}); expect(validate(p.document)).toEqual([]);
  });
  it("requires a new complete chord and limits touch activation to the enabled overworld area", () => {
    expect(matchesChord(["L", "Y"], ["L", "Y"], ["L"], true)).toBe(true);
    expect(matchesChord(["L", "Y"], ["L", "Y"], ["L", "Y"], true)).toBe(false);
    expect(matchesChord(["L", "Y"], ["L", "Y"], [], false)).toBe(false);
    const a = configured().document.access!;
    expect(cgearHit(a, 176, 152, true, false)).toBe("screen-1");
    expect(cgearHit(a, 248, 184, true, true)).toBeUndefined();
    expect(cgearHit(a, 176, 152, false, true)).toBeUndefined();
    a.cgear!.whenOff = false; expect(cgearHit(a, 176, 152, true, false)).toBeUndefined();
  });
  it("prevents new access settings from being silently ignored by the existing runtime", () => {
    const p = nativeLearnsetPreset(); setAccess(p.document, { party: { screen: "learnset", label: "Custom UI" } });
    expect(compileLearnsetNative(p.document).bytes).toBeDefined();
    p.document.access!.hotkey = { screen: "learnset", keys: ["L", "Y"] };
    expect(compileLearnsetNative(p.document).bytes).toBeUndefined();
  });
});
describe("Summary layout and data authoring", () => {
  it("adds each native page once, preserves stable identities and round trips overlays", () => {
    const p = newProject(); for (const page of SUMMARY_PAGES) { const id = addSummaryPage(p.document, page); expect(addSummaryPage(p.document, page)).toBe(id); }
    const s = p.document.screens[2]; addStatOverlay(p.document, s, "bottom", "ev"); addStatOverlay(p.document, s, "top", "iv");
    expect(validate(p.document)).toEqual([]); expect(importBundle(exportBundle(p))).toEqual(p);
    expect(compileLearnsetNative(p.document).bytes).toBeUndefined();
  });
  it("moves and resizes a native window without scaling its glyphs and can restore its baseline", () => {
    const p = newProject(), id = addSummaryPage(p.document, "stats"), s = p.document.screens.find(s => s.id === id)!;
    const e = s.elements.find(e => e.native === "summary.stats.attack")!, old = structuredClone(e);
    moveElements(s.elements, new Set([e.id]), 8, 8, true); resizeElement(e, 96, 32, true);
    expect(e.x).toBe(old.x + 8); expect(e.height).toBe(32);
    const resolved = resolveSummary(e); expect(resolved.every(r => r.font === 0 && r.x >= e.x && r.x + r.width <= e.x + e.width)).toBe(true);
    resetSummaryElement(e); expect({ x: e.x, y: e.y, width: e.width, height: e.height }).toEqual({ x: old.x, y: old.y, width: old.width, height: old.height });
    e.locked = true; moveElements(s.elements, new Set([e.id]), 8, 8, false); expect(e.x).toBe(old.x);
  });
  it("upgrades only untouched approximate regions and preserves authored overlays and IDs", () => {
    const p = newProject(), id = addSummaryPage(p.document, "stats"), s = p.document.screens.find(s => s.id === id)!;
    delete s.target!.layoutVersion;
    const nickname = s.elements.find(e => e.native?.endsWith(".nickname"))!, level = s.elements.find(e => e.native?.endsWith(".level"))!;
    Object.assign(nickname, { x: 160, y: 8, width: 88, height: 16 });
    Object.assign(level, { x: 168, y: 120, width: 72, height: 16, hidden: true });
    const oldLevel = structuredClone(level), ids = s.elements.map(e => e.id);
    migrateSummaryLayouts(p.document);
    expect(nickname).toMatchObject({ x: 152, y: 0, width: 104, height: 16 }); expect(level).toEqual(oldLevel);
    expect(s.elements.map(e => e.id)).toEqual(ids); expect(s.target?.layoutVersion).toBe(1);
    const once = structuredClone(p.document); migrateSummaryLayouts(p.document); expect(p.document).toEqual(once);
    s.target!.layoutVersion = 2 as 1; migrateSummaryLayouts(p.document); expect(validate(p.document).some(d => d.code === "summary")).toBe(true);
  });
  it("provides all EVs and IVs, keeps zeroes, and masks missing and egg data", () => {
    const doc = newProject().document, data = structuredClone(fixtures.full), state = start(doc, data, "party").stack[0];
    for (const stat of STATS) {
      expect(resolveText({ binding: `pokemon.ev.${stat}` }, data, state)).toBe(String(data.party[0].evs![stat]));
      expect(resolveText({ binding: `pokemon.iv.${stat}` }, data, state)).toBe(String(data.party[0].ivs![stat]));
    }
    expect(resolveText({ binding: "pokemon.ev.total" }, data, state)).toBe("508");
    data.party[0].egg = true; expect(resolveText({ binding: "pokemon.iv.hp" }, data, state)).toBe("");
    data.party[0].egg = false; delete data.party[0].ivs; expect(resolveText({ binding: "pokemon.iv.hp" }, data, state)).toBe("");
  });
  it("rejects cross-page native identities and arbitrary ROM assets", () => {
    const p = newProject(), id = addSummaryPage(p.document, "info"), s = p.document.screens.find(s => s.id === id)!;
    s.elements[2].native = "summary.stats.hp"; const e = newElement("image", "injected"); e.image = { kind: "rom", key: "arbitrary-path" }; s.elements.push(e);
    expect(validate(p.document).map(d => d.code)).toEqual(expect.arrayContaining(["summary", "asset"]));
  });
});
describe("Graphical editor selection operations", () => {
  it("duplicates internal list/focus references and cleans only deleted references", () => {
    const p = newProject(), s = p.document.screens[0], list = s.elements.find(e => e.kind === "list")!, button = s.elements.find(e => e.kind === "button")!;
    button.action = { type: "selectList", list: list.id, delta: 1 }; button.neighbors.down = list.id;
    const copies = duplicateElements(p.document, s.id, new Set([button.id, list.id]));
    const copy = s.elements.find(e => copies.includes(e.id) && e.kind === "button")!;
    expect(copy.action.type === "selectList" && copy.action.list).not.toBe(list.id); expect(copy.neighbors.down).toBe(copy.action.type === "selectList" ? copy.action.list : "");
    list.locked = true; deleteElements(p.document, s.id, new Set([list.id])); expect(button.neighbors.down).toBe(list.id);
    list.locked = false; deleteElements(p.document, s.id, new Set([list.id])); expect(button.action).toEqual({ type: "back" }); expect(validate(p.document)).toEqual([]);
  });
});
