import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderBw2ScriptEditor, stopBw2ScriptEditor } from "../ui/bw2ScriptEditor";
import { installBw2ScriptCodeEditor } from "../ui/bw2ScriptCodeEditor";
import { installBw2ScriptMapPreview } from "../ui/bw2ScriptMapPreview";

vi.mock("../ui/bw2ScriptCodeEditor", () => ({ installBw2ScriptCodeEditor: vi.fn() }));
vi.mock("../ui/bw2ScriptMapPreview", () => ({ installBw2ScriptMapPreview: vi.fn() }));
const SOURCE = "script :main, entry: 1 do\n  nop\nend\n";
const REPLACEMENT = "script :main, entry: 1 do\n  face_player\nend\n";

type Node = { value: string; textContent: string; innerHTML: string; disabled: boolean; hidden: boolean; className: string; attributes: Record<string, string>; setAttribute: (name: string, value: string) => void; focus: () => void; selectedOptions: { textContent: string }[]; listeners: Record<string, () => unknown>; addEventListener: (event: string, action: () => unknown) => void };
function fixture(version: "BW2" | "BW" = "BW2") {
  const project: ProjectState = {
    session: { romName: "test", baseVersion: version === "BW2" ? "W2" : "W", baseRom: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "fixture.nds", size: 1 },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "test", fileCount: 2, rawFiles: [compileBw2Script(SOURCE).bytes, compileBw2Script(SOURCE).bytes], records: new Map(), dirty: new Set() } },
  };
  const nodes = new Map<string, Node>();
  for (const id of ["source-editor", "definitions-editor", "script-tab", "definitions-tab", "source-section", "map-preview", "command-help", "script-file", "command-overlay", "decompile", "apply", "compile", "compile-status", "compile-result", "error-location", "draft-state", "source-title"]) {
    const listeners: Record<string, () => unknown> = {};
    const attributes: Record<string, string> = {};
    nodes.set(`#bw2-${id}`, { value: "0", textContent: "", innerHTML: "", disabled: false, hidden: false, className: "", attributes, setAttribute: (name, value) => { attributes[name] = value; }, focus: vi.fn(), selectedOptions: [{ textContent: "" }], listeners, addEventListener: (event, action) => { listeners[event] = action; } });
  }
  const root = { innerHTML: "", querySelector: (selector: string) => nodes.get(selector) };
  const options = { onApply: vi.fn(), onDraftChange: vi.fn() };
  const previews: { setFocus: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  vi.mocked(installBw2ScriptMapPreview).mockImplementation(() => { const preview = { setFocus: vi.fn(), destroy: vi.fn() }; previews.push(preview); return preview; });
  const editors: { getValue: () => string; setValue: (source: string) => void; setError: ReturnType<typeof vi.fn>; focusError: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; getCursor: () => { line: number; column: number; word: string; text: string }; moveCursor: (line: number, word: string) => void }[] = [];
  const definitionsEditors: typeof editors = [];
  vi.mocked(installBw2ScriptCodeEditor).mockImplementation((_host, source, onChange, onCursor) => {
    let text = source;
    let line = 1, word = "";
    const getCursor = () => ({ line, column: 1, word, text: text.split("\n")[line - 1] ?? "" });
    const editor = { getValue: () => text, getCursor, moveCursor: (nextLine: number, nextWord: string) => { line = nextLine; word = nextWord; onCursor?.(getCursor()); }, setValue: (next: string) => { text = next; onChange(next); onCursor?.(getCursor()); }, setError: vi.fn(), focusError: vi.fn(), destroy: vi.fn() };
    (_host === nodes.get("#bw2-definitions-editor") as unknown as HTMLElement ? definitionsEditors : editors).push(editor);
    return editor;
  });
  const render = () => renderBw2ScriptEditor(project, root as unknown as HTMLElement, options);
  render();
  return { project, root, nodes, options, editors, definitionsEditors, previews, render, node: (id: string) => nodes.get(`#bw2-${id}`)! };
}

describe("BW2 script editor interactions", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { stopBw2ScriptEditor(); vi.useRealTimers(); });
  it("shows work-ID meaning for both descriptive and custom bindings during incomplete edits", () => {
    const f = fixture();
    f.editors[0].setValue("work :bianca_intro_progress, 0x40a1\nscript :main, entry: 1 do\nif bianca_intro_progress != 0\nnop\nend\nend");
    f.editors[0].moveCursor(3, "bianca_intro_progress");
    expect(f.node("command-help").innerHTML).toContain("Work 0x40a1");
    expect(f.node("command-help").innerHTML).toContain("Bianca introduction");
    expect(f.node("command-help").innerHTML).toContain("not a Boolean");
    f.editors[0].setValue("work :custom_intro, 0x40a1\nscript :main, entry: 1 do\nif custom_intro !=\n");
    f.editors[0].moveCursor(3, "custom_intro");
    expect(f.node("command-help").innerHTML).toContain("Catalog name:");
    expect(f.node("command-help").innerHTML).toContain("bianca_intro_progress");
    f.editors[0].moveCursor(3, "flag_set?");
    expect(f.node("command-help").innerHTML).toContain("separate flag storage");
  });
  it("shows command parameter help and sends cursor ownership to the map preview", () => {
    const f = fixture();
    f.editors[0].setValue("script :one, entry: 1 do\nactor_set_g_pos 3, 42, 1, 751, 3\nend");
    f.editors[0].moveCursor(2, "actor_set_g_pos");
    expect(f.node("command-help").innerHTML).toContain("elevation");
    expect(f.node("command-help").innerHTML).toContain("3 = right");
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ name: "one", entries: [1] }), expect.stringContaining("actor_set_g_pos"), undefined);
    expect(f.root.innerHTML).toContain("bw2-script-split");
    expect(f.root.innerHTML).not.toContain("Compiled entry points");
    f.node("source-section").value = "1";
    f.node("source-section").listeners.change();
    expect(f.editors[0].focusError).toHaveBeenCalledWith({ line: 1, column: 1 });
    stopBw2ScriptEditor();
    expect(f.previews[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("decompiles current ROM bytes, shows verification, and applies a relocated edit", () => {
    const f = fixture();
    const original = f.project.narcs.scripts!.rawFiles[0].slice();
    f.node("decompile").listeners.click();
    expect(f.definitionsEditors[0].getValue()).toContain("preserve_layout");
    expect(f.node("compile-status").textContent).toContain("Byte-identical original round trip verified");
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(original);
    expect(f.options.onApply).not.toHaveBeenCalled();
    f.editors[0].setValue(f.editors[0].getValue().replace("  nop", "  sleep 1\n  nop"));
    vi.advanceTimersByTime(250);
    f.node("apply").listeners.click();
    expect(f.options.onApply).toHaveBeenCalledTimes(1);
    expect(f.project.narcs.scripts!.rawFiles[0].length).toBe(original.length + 4);
  });
  it("shows a read-only import and refuses forced Apply after an edit", () => {
    const f = fixture();
    const unknown = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0xff, 0xff]);
    f.project.narcs.scripts!.rawFiles[0] = unknown;
    f.node("decompile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Read-only import");
    expect(f.node("apply").disabled).toBe(true);
    f.editors[0].setValue(REPLACEMENT);
    f.node("apply").listeners.click();
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(unknown);
    expect(f.options.onApply).not.toHaveBeenCalled();
  });
  it("uses the explicitly selected overlay for the imported command context", () => {
    const f = fixture();
    f.project.narcs.scripts!.rawFiles[0] = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0xe8, 3, 1, 0, 2, 0]);
    f.node("command-overlay").value = "51";
    f.node("decompile").listeners.click();
    expect(f.definitionsEditors[0].getValue()).toContain("overlay 51");
    expect(f.editors[0].getValue()).toContain("cmd_03e8 0x0001");
    expect(f.node("apply").disabled).toBe(false);
  });

  it("starts with apply disabled and a compact sidebar", () => {
    const f = fixture();
    expect(f.node("apply").disabled).toBe(true);
    for (const removed of ["bw2-script-notice", "bw2-file-summary", "Syntax example", "bw2-import-source", "bw2-download-source"]) expect(f.root.innerHTML).not.toContain(removed);
    expect(f.editors[0].getValue()).toContain("Author 1 entry");
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });

  it("previews without mutation, then applies through the loaded project's script model", () => {
    const f = fixture(), original = f.project.narcs.scripts!.rawFiles[0].slice();
    f.editors[0].setValue(REPLACEMENT);
    expect(f.node("apply").disabled).toBe(true);
    f.node("compile").listeners.click();
    expect(f.node("apply").disabled).toBe(false);
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(original);
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
    expect(f.options.onApply).not.toHaveBeenCalled();
    f.node("apply").listeners.click();
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(compileBw2Script(REPLACEMENT).bytes);
    expect([...f.project.narcs.scripts!.dirty]).toEqual([0]);
    expect(f.project.bw2ScriptEditor!.drafts[0].appliedSource).toBe(REPLACEMENT);
    expect(f.node("compile-status").textContent).toContain("Applied script file 0");
    expect(f.options.onApply).toHaveBeenCalledTimes(1);
  });

  it("shows live compiler errors, disables apply, and jumps to their source position", () => {
    const f = fixture(), original = f.project.narcs.scripts!.rawFiles[0].slice();
    f.editors[0].setValue("script :main, entry: 1 do\n  unknown\nend");
    vi.advanceTimersByTime(250);
    expect(f.node("apply").disabled).toBe(true);
    expect(f.node("compile-status").textContent).toContain("Unknown command or helper");
    expect(f.node("error-location").hidden).toBe(false);
    expect(f.editors[0].setError).toHaveBeenLastCalledWith({ line: 2, column: 3 });
    f.node("error-location").listeners.click();
    expect(f.editors[0].focusError).toHaveBeenCalledWith({ line: 2, column: 3 });
    f.node("apply").listeners.click(); // Handler still guards forced/stale activation.
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(original);
    expect(f.options.onApply).not.toHaveBeenCalled();
  });

  it("revalidates original entry counts at apply time", () => {
    const f = fixture();
    f.editors[0].setValue(REPLACEMENT);
    f.node("compile").listeners.click();
    const updated = compileBw2Script("script :a, entry: 1 do\nend\nscript :b, entry: 2 do\nend").bytes;
    f.project.narcs.scripts!.rawFiles[0] = updated;
    f.node("apply").listeners.click();
    expect(f.node("compile-status").textContent).toContain("preserve all 2 entry slots");
    expect(f.node("apply").disabled).toBe(true);
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(updated);
    expect(f.options.onApply).not.toHaveBeenCalled();
  });

  it("keeps drafts isolated across file switches and survives navigation rerenders", () => {
    const f = fixture();
    f.editors[0].setValue(REPLACEMENT);
    f.node("script-file").value = "1";
    f.node("script-file").listeners.change();
    expect(f.editors[0].destroy).toHaveBeenCalledTimes(1);
    expect(f.editors[1].getValue()).not.toBe(REPLACEMENT);
    f.editors[1].setValue(SOURCE);
    f.node("script-file").value = "0";
    f.node("script-file").listeners.change();
    expect(f.editors[2].getValue()).toBe(REPLACEMENT);
    f.render();
    expect(f.editors[3].getValue()).toBe(REPLACEMENT);
    expect(f.project.bw2ScriptEditor!.drafts[1].source).toBe(SOURCE);
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });

  it("cancels pending compilation and destroys CodeMirror on leaving the editor", () => {
    const f = fixture();
    f.editors[0].setValue(REPLACEMENT);
    stopBw2ScriptEditor();
    vi.advanceTimersByTime(1000);
    expect(f.editors[0].destroy).toHaveBeenCalledTimes(1);
    expect(f.node("compile-status").textContent).toBe("Checking source…");
  });

  it("compiles and saves definitions with the script while tab switches preserve both buffers", () => {
    const f = fixture();
    f.definitionsEditors[0].setValue("work :counter, 0x8020");
    f.editors[0].setValue("script :main, entry: 1 do\ncounter = 7\nend\n");
    const fullSource = "work :counter, 0x8020\nscript :main, entry: 1 do\ncounter = 7\nend\n";
    expect(f.project.bw2ScriptEditor!.drafts[0].source).toBe(fullSource);
    f.node("definitions-tab").listeners.click();
    expect(f.node("source-editor").hidden).toBe(true);
    expect(f.node("definitions-editor").hidden).toBe(false);
    f.node("script-tab").listeners.click();
    expect(f.editors[0].getValue()).toContain("counter = 7");
    expect(f.definitionsEditors[0].getValue()).toBe("work :counter, 0x8020");
    f.node("apply").listeners.click();
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(compileBw2Script(fullSource).bytes);
    f.node("script-file").value = "1"; f.node("script-file").listeners.change();
    expect(f.definitionsEditors[1].getValue()).toBe("");
    f.node("script-file").value = "0"; f.node("script-file").listeners.change();
    expect(f.definitionsEditors[2].getValue()).toBe("work :counter, 0x8020\n");
    expect(f.editors[2].getValue()).toContain("counter = 7");
  });
  it("routes errors and entry navigation to local lines in the correct tab", () => {
    const f = fixture();
    f.definitionsEditors[0].setValue("work :counter, 0x3fff");
    f.editors[0].setValue("script :main, entry: 1 do\ncounter = 1\nend\n");
    f.node("compile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Definitions line 1");
    expect(f.definitionsEditors[0].setError).toHaveBeenLastCalledWith({ line: 1, column: 1 });
    f.node("error-location").listeners.click();
    expect(f.node("definitions-tab").attributes["aria-selected"]).toBe("true");
    expect(f.definitionsEditors[0].focusError).toHaveBeenLastCalledWith({ line: 1, column: 1 });
    f.definitionsEditors[0].setValue("work :counter, 0x8020\n\n");
    f.editors[0].setValue("script :main, entry: 1 do\nunknown\nend\n");
    f.node("compile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Script line 2");
    f.node("error-location").listeners.click();
    expect(f.node("script-tab").attributes["aria-selected"]).toBe("true");
    expect(f.editors[0].focusError).toHaveBeenLastCalledWith({ line: 2, column: 1 });
    f.node("definitions-tab").listeners.click();
    f.node("source-section").value = "3"; f.node("source-section").listeners.change();
    expect(f.node("script-tab").attributes["aria-selected"]).toBe("true");
    expect(f.editors[0].focusError).toHaveBeenLastCalledWith({ line: 1, column: 1 });
  });
  it("maps script cursor ownership through the definitions prefix without changing bytecode", () => {
    const f = fixture();
    f.definitionsEditors[0].setValue("work :intro, 0x40a1\n\n");
    f.editors[0].setValue("script :main, entry: 1 do\nactor_set_g_pos 3, 42, 1, 751, 3\nend");
    f.editors[0].moveCursor(2, "actor_set_g_pos");
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ name: "main", line: 3, entries: [1] }), expect.stringContaining("actor_set_g_pos"), undefined);
    f.node("definitions-tab").listeners.click();
    f.definitionsEditors[0].moveCursor(1, "intro");
    expect(f.node("command-help").innerHTML).toContain("Work 0x40a1");
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(undefined, "work :intro, 0x40a1", undefined);
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });

  it("shows an unavailable state for BW1 and missing script archives", () => {
    const f = fixture("BW");
    expect(f.root.innerHTML).toContain("Load a Black 2 or White 2 ROM");
    expect(f.editors).toHaveLength(0);
    const valid = fixture();
    delete valid.project.narcs.scripts;
    valid.render();
    expect(valid.root.innerHTML).toContain("Load a Black 2 or White 2 ROM");
  });
});
