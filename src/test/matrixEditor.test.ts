import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMatrixSnapshot, GEN5_MATRIX_EMPTY as EMPTY } from "../pokeweb/matrixModel";
import { matrixCellColor, parseMatrixInput, renderMatrixEditor, stopMatrixEditor } from "../ui/matrixEditor";
import { makeMatrixProject } from "./fixtures/matrixProject";
import { NARC } from "../nds/narc";
import { createNarcStore } from "../pokeweb/projectStore";
import { getSeasonalAssignment } from "../pokeweb/seasonalMatrixModel";

// Match the project's small DOM fixtures while exercising real model operations.
function fixture(initial: { matrixId?: number; headerId?: number; seasons?: boolean } = {}) {
  const nodes = new Map<string, Node>(); let cells: Node[] = [];
  class Node {
    private nodeId = "";
    get id() { return this.nodeId; }
    set id(value: string) { this.nodeId = value; if (value) nodes.set(`#${value}`, this); }
    value = ""; checked = false; disabled = false; hidden = false; textContent = ""; className = "";
    dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
    listeners: Record<string, (event: unknown) => unknown> = {};
    classes = new Set<string>(); clientWidth = 900; clientHeight = 600; scrollTop = 0; scrollLeft = 0;
    classList = { toggle: (name: string, active: boolean) => active ? this.classes.add(name) : this.classes.delete(name) };
    style: Record<string, unknown> & { setProperty: (key: string, value: string) => void } = { setProperty: (key, value) => { this.style[key] = value; } };
    html = "";
    set innerHTML(html: string) {
      this.html = html;
      for (const match of html.matchAll(/<[\w-]+\b([^>]*\bid="([^"]+)"[^>]*)>/gu)) {
        const node = new Node(); node.id = match[2]; node.value = match[1].match(/\bvalue="([^"]*)"/u)?.[1] ?? "";
        node.checked = /\bchecked\b/u.test(match[1]); node.disabled = /\bdisabled\b/u.test(match[1]); node.hidden = /\bhidden\b/u.test(match[1]);
        nodes.set(`#${node.id}`, node);
      }
      if (this.id === "matrix-index") this.value = html.match(/value="(\d+)" selected/u)?.[1] ?? "0";
      if (this === nodes.get(".matrix-grid")) cells = [...html.matchAll(/data-matrix-cell="(\d+)"/gu)].map(match => { const node = new Node(); node.dataset.matrixCell = match[1]; return node; });
    }
    get innerHTML() { return this.html; }
    addEventListener(name: string, action: (event: unknown) => unknown) { this.listeners[name] = action; }
    removeEventListener(name: string) { delete this.listeners[name]; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    removeAttribute(name: string) { delete this.attributes[name]; }
    closest(selector: string) {
      if (selector === "button[data-matrix-cell]") return this.dataset.matrixCell === undefined ? null : this;
      const link = this.dataset.matrixOpenMap !== undefined || this.dataset.matrixOpenOverworld !== undefined;
      return selector.startsWith("a[") ? link ? this : null : link ? null : this;
    }
    focus() {}
    select() {}
    replaceWith(replacement: Node) {
      cells = cells.map(cell => cell === this ? replacement : cell);
      if (this.id) nodes.delete(`#${this.id}`);
    }
    getBoundingClientRect() { return { top: 200 }; }
    querySelector(selector: string) { return nodes.get(selector) ?? cells.find(cell => cell.dataset.matrixCell === selector.match(/^\[data-matrix-cell="(\d+)"\]$/u)?.[1]); }
    querySelectorAll(selector?: string) {
      if (selector === ".matrix-season-card input") return ["spring", "summer", "autumn", "winter"].map(season => nodes.get(`#matrix-season-${season}`)!).filter(Boolean);
      return cells.filter(cell => cell.dataset.matrixCell !== undefined);
    }
  }
  for (const name of ["Element", "HTMLFormElement", "HTMLInputElement"]) vi.stubGlobal(name, Node);
  vi.stubGlobal("document", { createElement: () => new Node() });
  const disconnected = vi.fn(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnected; });
  const confirm = vi.fn(() => true); vi.stubGlobal("window", { confirm, innerHeight: 900, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  for (const selector of [".matrix-grid", ".matrix-viewport"]) nodes.set(selector, new Node());
  const root = new Node(), project = makeMatrixProject(), dirty = vi.fn();
  const replacements = new NARC(); replacements.files = [new Uint8Array()];
  project.narcs.map_replace = createNarcStore("map_replace", "a/0/1/0", 3, replacements);
  for (const row of Object.values(project.headers!.rows)) row.overworlds_id = row.index + 7;
  const navigation = { openMap: vi.fn(), openOverworld: vi.fn() };
  renderMatrixEditor(project, root as unknown as HTMLElement, dirty, navigation, initial);
  const node = (id: string) => nodes.get(`#matrix-${id}`)!;
  const click = (dataset: Record<string, string>, shiftKey = false) => { const target = new Node(); target.dataset = dataset; root.listeners.click({ target, shiftKey, button: 0, preventDefault: vi.fn() }); };
  const select = (index: number, shift = false) => click({ matrixCell: String(index) }, shift);
  const action = (name: string) => click({ matrixAction: name });
  const submit = (name: string) => root.listeners.submit({ target: node(`${name}-form`), preventDefault: vi.fn() });
  const switchMatrix = (index: number) => { node("index").value = String(index); node("index").listeners.change({}); };
  const edit = (index: number, keyboard = false) => {
    const target = cells.find(cell => cell.dataset.matrixCell === String(index))!;
    root.listeners[keyboard ? "keydown" : "dblclick"]({ target, key: "F2", preventDefault: vi.fn() });
  };
  const editKey = (key: string) => node("cell-header-editor").listeners.keydown({ key, isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  return { project, root, node, cells: () => cells, dirty, select, action, submit, switchMatrix, confirm, disconnected, click, navigation, edit, editKey, viewport: nodes.get(".matrix-viewport")! };
}

describe("matrix grid editor", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { stopMatrixEditor(); vi.unstubAllGlobals(); });
  it("starts at matrix zero and switches to headerless matrices without inventing cell assignments", () => {
    const f = fixture();
    expect(f.node("index").value).toBe("0"); expect(f.cells().length).toBe(6);
    expect(f.node("width").value).toBe("3"); expect(f.node("height").value).toBe("2");
    f.switchMatrix(1);
    expect(f.cells().length).toBe(2);
    expect(f.node("header-id").disabled).toBe(true); expect(f.node("references").innerHTML).toContain("<strong>1</strong>");
    expect(f.dirty).not.toHaveBeenCalled();
  });
  it("toggles matrix zero previews without saving, moving the viewport, or affecting other matrices", () => {
    const f = fixture(); expect(f.node("zero-thumbnails").checked).toBe(false);
    f.viewport.scrollTop = 300; f.viewport.scrollLeft = 40; f.node("zero-thumbnails").checked = !f.node("zero-thumbnails").checked; f.node("zero-thumbnails").listeners.change({});
    expect(f.node("zero-thumbnails").checked).toBe(true);
    expect(f.viewport.scrollTop).toBe(300); expect(f.viewport.scrollLeft).toBe(40);
    f.switchMatrix(1); expect(f.node("thumbnail-toggle").hidden).toBe(true);
    f.switchMatrix(0); expect(f.node("thumbnail-toggle").hidden).toBe(false);
    expect(f.node("zero-thumbnails").checked).toBe(true);
    f.node("zero-thumbnails").checked = !f.node("zero-thumbnails").checked; f.node("zero-thumbnails").listeners.change({}); expect(f.node("zero-thumbnails").checked).toBe(false);
    expect(f.dirty).not.toHaveBeenCalled();
  });
  it("opens from a native header ID with its matching cells selected and seasons visible", () => {
    const f = fixture({ matrixId: 0, headerId: 2, seasons: true });
    expect(f.node("seasons").hidden).toBe(false);
    expect(f.cells().filter(cell => cell.classes.has("-selected")).map(cell => cell.dataset.matrixCell)).toEqual(["4", "5"]);
    expect(f.node("season-content").innerHTML).toContain("Base map");
    expect(f.dirty).not.toHaveBeenCalled();
  });
  it("requires Apply seasons, saves only seasonal data, and removes affected-cell highlighting when closed", () => {
    const f = fixture(); f.action("seasons");
    expect(f.cells().filter(cell => cell.classes.has("-season-affected")).map(cell => cell.dataset.matrixCell)).toEqual(["0"]);
    f.node("season-summer").value = "1"; f.node("season-autumn").value = "2"; f.node("season-winter").value = "3";
    expect(getSeasonalAssignment(f.project, 0, "map", 0).values).toEqual([0, 0, 0, 0]);
    f.node("season-form").listeners.submit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(getSeasonalAssignment(f.project, 0, "map", 0).values).toEqual([0, 1, 2, 3]);
    expect(getMatrixSnapshot(f.project, 0).cells[0]).toMatchObject({ headerId: 0, mapId: 0 });
    expect(f.dirty).toHaveBeenCalledOnce();
    f.node("season-winter").value = "999";
    f.node("season-form").listeners.submit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(f.node("season-status").textContent).toContain("does not exist"); expect(f.dirty).toHaveBeenCalledOnce();
    f.node("season-remove").listeners.click({}); expect(getSeasonalAssignment(f.project, 0, "map", 0).matches).toHaveLength(0);
    f.action("seasons"); expect(f.cells().some(cell => cell.classes.has("-season-affected"))).toBe(false);
  });
  it("edits whole-matrix seasons separately and highlights the full grid", () => {
    const f = fixture(); f.action("seasons");
    f.node("season-scope").value = "matrix"; f.node("season-scope").listeners.change({ target: f.node("season-scope") });
    expect(f.cells().filter(cell => cell.classes.has("-season-affected"))).toHaveLength(6);
    f.node("season-winter").value = "1";
    f.node("season-form").listeners.submit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(getSeasonalAssignment(f.project, 0, "matrix").values).toEqual([0, 0, 0, 1]);
    expect(getMatrixSnapshot(f.project, 0).width).toBe(3); expect(f.dirty).toHaveBeenCalledOnce();
  });
  it("selects rectangles and applies entered assignments while leaving blank mixed fields unchanged", () => {
    const f = fixture(); f.select(1); f.select(5, true);
    expect(f.node("selection").innerHTML).toContain("4 cells selected");
    f.node("map-id").value = ""; f.node("header-id").value = "2";
    expect(getMatrixSnapshot(f.project, 0).cells[1].headerId).toBe(0);
    f.submit("apply");
    const snapshot = getMatrixSnapshot(f.project, 0);
    expect([1, 2, 4, 5].map(i => snapshot.cells[i].headerId)).toEqual([2, 2, 2, 2]);
    expect(snapshot.cells[1].mapId).toBe(1); expect(snapshot.cells[2].mapId).toBe(EMPTY);
    expect(snapshot.cells[0].headerId).toBe(0); expect(f.dirty).toHaveBeenCalledOnce();
  });
  it("keeps invalid input unapplied and reports a useful error", () => {
    const f = fixture(); f.node("map-id").value = "8"; f.node("header-id").value = "2"; f.submit("apply");
    expect(f.node("status").textContent).toContain("does not exist"); expect(f.dirty).not.toHaveBeenCalled();
    expect(getMatrixSnapshot(f.project, 0).cells[0]).toMatchObject({ mapId: 0, headerId: 0 });
  });
  it("applies both entered fields to the selection with one save callback", () => {
    const f = fixture(); f.select(1); f.select(5, true);
    f.node("map-id").value = "7"; f.node("header-id").value = "1"; f.submit("apply");
    const cells = getMatrixSnapshot(f.project, 0).cells;
    for (const index of [1, 2, 4, 5]) expect(cells[index]).toMatchObject({ mapId: 7, headerId: 1 });
    expect(cells[0]).toMatchObject({ mapId: 0, headerId: 0 });
    expect(f.project.headers!.rows[2].matrix_id).toBe(1); expect(f.dirty).toHaveBeenCalledOnce();
  });
  it("retains an existing invalid map reference when applying a changed header", () => {
    const f = fixture(); f.project.narcs.matrix!.records.get(0)!.raw!.map_0 = 99; f.switchMatrix(0);
    expect(f.node("map-id").value).toBe("99");
    f.node("header-id").value = "2"; f.submit("apply");
    expect(getMatrixSnapshot(f.project, 0).cells[0]).toMatchObject({ mapId: 99, headerId: 2 });
    expect(f.dirty).toHaveBeenCalledOnce();
  });
  it("edits only the double-clicked header, preserving maps, shared header links, and scroll position", () => {
    const f = fixture(); f.select(1); f.select(5, true); f.viewport.scrollTop = 300; f.viewport.scrollLeft = 40;
    f.edit(0); expect(f.node("cell-header-editor").value).toBe("0");
    f.node("cell-header-editor").value = "1";
    expect(f.dirty).not.toHaveBeenCalled(); expect(getMatrixSnapshot(f.project, 0).cells[0].headerId).toBe(0);
    f.editKey("Enter");
    expect(getMatrixSnapshot(f.project, 0).cells.map(cell => cell.headerId)).toEqual([1, 0, EMPTY, 1, 2, 2]);
    expect(getMatrixSnapshot(f.project, 0).cells[0].mapId).toBe(0);
    expect(f.project.headers!.rows[2].matrix_id).toBe(1);
    expect(f.node("selection").innerHTML).toContain("Point header 1 to matrix 0");
    expect(f.viewport.scrollTop).toBe(300); expect(f.viewport.scrollLeft).toBe(40);
    expect(f.node("cell-header-editor")).toBeUndefined(); expect(f.dirty).toHaveBeenCalledOnce();
  });
  it("rejects nonexistent headers and lets Escape cancel the draft without saving", () => {
    const f = fixture(); f.edit(0); f.node("cell-header-editor").value = "99"; f.editKey("Enter");
    expect(f.node("status").textContent).toContain("does not exist");
    expect(f.node("cell-header-editor").attributes["aria-invalid"]).toBe("true");
    expect(getMatrixSnapshot(f.project, 0).cells[0].headerId).toBe(0); expect(f.dirty).not.toHaveBeenCalled();
    f.node("cell-header-editor").value = "2"; f.editKey("Escape");
    expect(f.node("cell-header-editor")).toBeUndefined();
    expect(getMatrixSnapshot(f.project, 0).cells[0].headerId).toBe(0); expect(f.dirty).not.toHaveBeenCalled();
  });
  it("assigns native header zero to an empty cell and clears only its header with a blank entry", () => {
    const f = fixture(); f.edit(2, true); expect(f.node("cell-header-editor").value).toBe("");
    f.node("cell-header-editor").value = "0"; f.editKey("Enter");
    expect(getMatrixSnapshot(f.project, 0).cells[2]).toMatchObject({ headerId: 0, mapId: EMPTY });
    f.edit(2); f.node("cell-header-editor").value = ""; f.editKey("Enter");
    expect(getMatrixSnapshot(f.project, 0).cells[2]).toMatchObject({ headerId: EMPTY, mapId: EMPTY });
    f.edit(2); f.editKey("Enter"); expect(f.dirty).toHaveBeenCalledTimes(2);
  });
  it("cancels on blur or matrix switching and requires a header table before inline editing", () => {
    const f = fixture(); f.edit(0); f.node("cell-header-editor").value = "2";
    f.node("cell-header-editor").listeners.blur({}); expect(f.node("cell-header-editor")).toBeUndefined();
    f.edit(0); f.node("cell-header-editor").value = "1"; f.switchMatrix(1);
    expect(getMatrixSnapshot(f.project, 0).cells[0].headerId).toBe(0); expect(f.node("cell-header-editor")).toBeUndefined();
    f.edit(0); expect(f.node("cell-header-editor")).toBeUndefined(); expect(f.node("status").textContent).toContain("Add a header table");
    expect(f.dirty).not.toHaveBeenCalled();
    f.switchMatrix(0); f.edit(0); stopMatrixEditor();
    expect(f.node("cell-header-editor")).toBeUndefined(); expect(f.root.listeners.dblclick).toBeUndefined(); expect(f.root.listeners.keydown).toBeUndefined();
  });
  it("opens the applied cell's map and assigned header's overworld without applying draft fields", () => {
    const f = fixture();
    expect(f.node("selection").innerHTML).toContain('href="#maps3d/0/0"');
    expect(f.node("selection").innerHTML).toContain('href="#overworlds/7/0"');
    f.node("map-id").value = "6"; f.node("header-id").value = "2";
    f.click({ matrixOpenMap: "0", matrixZone: "0" });
    f.click({ matrixOpenOverworld: "7", matrixHeader: "0" });
    expect(f.navigation.openMap).toHaveBeenCalledWith(0, 0);
    expect(f.navigation.openOverworld).toHaveBeenCalledWith(7, 0);
    expect(f.dirty).not.toHaveBeenCalled();
    f.select(4); expect(f.node("selection").innerHTML).toContain('href="#overworlds/9/2"');
    f.select(2); expect(f.node("selection").innerHTML).not.toContain('href="#maps3d/');
    expect(f.node("selection").innerHTML).not.toContain('href="#overworlds/');
  });
  it("uses a referencing header for map shortcuts in headerless matrices", () => {
    const f = fixture(); f.switchMatrix(1);
    expect(f.node("selection").innerHTML).toContain('href="#maps3d/1/5"');
    expect(f.node("selection").innerHTML).not.toContain('href="#overworlds/');
  });
  it("opens a map-only cell directly instead of borrowing a referencing header's zone", () => {
    const f = fixture(); f.select(1);
    f.node("header-id").value = "Empty"; f.submit("apply");
    expect(f.node("selection").innerHTML).toContain('href="#maps3d/matrix/0/1/0"');
    expect(f.node("selection").innerHTML).not.toContain('href="#maps3d/0/');
    expect(f.node("selection").innerHTML).not.toContain('href="#overworlds/');
    f.click({ matrixOpenMap: "1", matrixId: "0", matrixX: "1", matrixY: "0" });
    expect(f.navigation.openMap).toHaveBeenCalledWith(undefined, 1, { matrixId: 0, x: 1, y: 0 });
    expect(getMatrixSnapshot(f.project, 0).cells[1]).toMatchObject({ mapId: 1, headerId: EMPTY });
    expect(f.project.headers!.rows[1].matrix_id).toBe(0);
  });
  it("adds header tables separately from linking a shared header", () => {
    const f = fixture(); f.switchMatrix(1); f.node("initial-header").value = "0"; f.submit("table");
    expect(getMatrixSnapshot(f.project, 1).cells.map(cell => cell.headerId)).toEqual([0, 0]);
    expect(f.project.headers!.rows[1].matrix_id).toBe(0);
    expect(f.node("selection").innerHTML).toContain("Point header 0 to matrix 1");
    f.click({ matrixLink: "0" }); expect(f.project.headers!.rows[1].matrix_id).toBe(1);
  });
  it("cancels a populated crop without changing data, then accepts an explicit confirmation", () => {
    const f = fixture(); f.node("width").value = "1"; f.node("height").value = "1"; f.confirm.mockReturnValueOnce(false); f.submit("resize");
    expect(f.confirm).toHaveBeenCalledWith(expect.stringContaining("removes 4 populated"));
    expect(getMatrixSnapshot(f.project, 0).width).toBe(3); expect(f.dirty).not.toHaveBeenCalled();
    f.submit("resize"); expect(getMatrixSnapshot(f.project, 0).cells.length).toBe(1); expect(f.dirty).toHaveBeenCalledOnce();
  });
  it("creates, duplicates and clears cells through the same save callback", () => {
    const f = fixture(); f.action("new"); expect(f.node("new-form").hidden).toBe(false);
    f.submit("new"); expect(f.node("index").value).toBe("2"); expect(getMatrixSnapshot(f.project, 2).hasHeaders).toBe(true);
    f.action("duplicate"); expect(f.node("index").value).toBe("3");
    f.switchMatrix(0); f.action("clear"); expect(getMatrixSnapshot(f.project, 0).cells[0]).toMatchObject({ mapId: EMPTY, headerId: EMPTY });
    expect(f.dirty).toHaveBeenCalledTimes(3);
    stopMatrixEditor(); expect(f.disconnected).toHaveBeenCalledOnce(); expect(f.root.listeners.click).toBeUndefined();
  });
});

it("accepts whole numeric IDs and Empty, and assigns stable header colors", () => {
  expect(parseMatrixInput("0")).toBe(0); expect(parseMatrixInput("0xFFFFFFFF")).toBe(EMPTY); expect(parseMatrixInput(" empty ")).toBe(EMPTY);
  for (const value of ["", "-1", "1.5", "1e3", "4294967296"]) expect(() => parseMatrixInput(value)).toThrow();
  expect(matrixCellColor(25)).toBe(matrixCellColor(25)); expect(matrixCellColor(25)).not.toBe(matrixCellColor(26));
});
