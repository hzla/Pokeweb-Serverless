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

type Node = { value: string; textContent: string; innerHTML: string; disabled: boolean; hidden: boolean; className: string; selectedOptions: { textContent: string }[]; listeners: Record<string, () => unknown>; addEventListener: (event: string, action: () => unknown) => void };
function fixture(version: "BW2" | "BW" = "BW2") {
  const project: ProjectState = {
    session: { romName: "test", baseVersion: version === "BW2" ? "W2" : "W", baseRom: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "fixture.nds", size: 1 },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "test", fileCount: 2, rawFiles: [compileBw2Script(SOURCE).bytes, compileBw2Script(SOURCE).bytes], records: new Map(), dirty: new Set() } },
  };
  const nodes = new Map<string, Node>();
  for (const id of ["source-editor", "source-section", "map-preview", "command-help", "script-file", "command-overlay", "decompile", "apply", "compile", "compile-status", "compile-result", "error-location", "draft-state", "file-summary", "source-title", "import-source", "source-file", "download-source"]) {
    const listeners: Record<string, () => unknown> = {};
    nodes.set(`#bw2-${id}`, { value: "0", textContent: "", innerHTML: "", disabled: false, hidden: false, className: "", selectedOptions: [{ textContent: "" }], listeners, addEventListener: (event, action) => { listeners[event] = action; } });
  }
  const root = { innerHTML: "", querySelector: (selector: string) => nodes.get(selector) };
  const options = { onApply: vi.fn(), onDraftChange: vi.fn() };
  const previews: { setFocus: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  vi.mocked(installBw2ScriptMapPreview).mockImplementation(() => { const preview = { setFocus: vi.fn(), destroy: vi.fn() }; previews.push(preview); return preview; });
  const editors: { getValue: () => string; setValue: (source: string) => void; setError: ReturnType<typeof vi.fn>; focusError: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; getCursor: () => { line: number; column: number; word: string; text: string }; moveCursor: (line: number, word: string) => void }[] = [];
  vi.mocked(installBw2ScriptCodeEditor).mockImplementation((_host, source, onChange, onCursor) => {
    let text = source;
    let line = 1, word = "";
    const getCursor = () => ({ line, column: 1, word, text: text.split("\n")[line - 1] ?? "" });
    const editor = { getValue: () => text, getCursor, moveCursor: (nextLine: number, nextWord: string) => { line = nextLine; word = nextWord; onCursor?.(getCursor()); }, setValue: (next: string) => { text = next; onChange(next); onCursor?.(getCursor()); }, setError: vi.fn(), focusError: vi.fn(), destroy: vi.fn() };
    editors.push(editor);
    return editor;
  });
  const render = () => renderBw2ScriptEditor(project, root as unknown as HTMLElement, options);
  render();
  return { project, root, nodes, options, editors, previews, render, node: (id: string) => nodes.get(`#bw2-${id}`)! };
}

describe("BW2 script editor interactions", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { stopBw2ScriptEditor(); vi.useRealTimers(); });
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
    expect(f.editors[0].getValue()).toContain("preserve_layout");
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
    expect(f.editors[0].getValue()).toContain("overlay 51");
    expect(f.editors[0].getValue()).toContain("cmd_03e8 0x0001");
    expect(f.node("apply").disabled).toBe(false);
  });

  it("starts with apply disabled and an explicit whole-file replacement notice", () => {
    const f = fixture();
    expect(f.node("apply").disabled).toBe(true);
    expect(f.root.innerHTML).toContain("Applying replaces this entire script file");
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
