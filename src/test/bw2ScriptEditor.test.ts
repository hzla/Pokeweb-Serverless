import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderBw2ScriptEditor, stopBw2ScriptEditor } from "../ui/bw2ScriptEditor";
import { installBw2ScriptCodeEditor } from "../ui/bw2ScriptCodeEditor";
import { installBw2ScriptMapPreview } from "../ui/bw2ScriptMapPreview";
import { resolveBw2ScriptOverlay } from "../pokeweb/bw2ScriptOverlayContext";
import { installBw2ScriptTexts } from "../ui/bw2ScriptTexts";
import { joinBw2ScriptSource } from "../pokeweb/bw2ScriptSourceParts";
import { prepareBw2ScriptEntryResources } from "../pokeweb/bw2ScriptEntryReferences";

vi.mock("../ui/bw2ScriptCodeEditor", () => ({ installBw2ScriptCodeEditor: vi.fn() }));
vi.mock("../ui/bw2ScriptMapPreview", () => ({ installBw2ScriptMapPreview: vi.fn() }));
vi.mock("../ui/bw2ScriptTexts", () => ({ installBw2ScriptTexts: vi.fn(() => ({ setReference: vi.fn(), destroy: vi.fn() })) }));
vi.mock("../pokeweb/bw2ScriptOverlayContext", () => ({ resolveBw2ScriptOverlay: vi.fn(() => ({ kind: "unavailable", zones: [], description: "No source ROM in fixture." })) }));
vi.mock("../pokeweb/bw2ScriptEntryReferences", async (original) => ({ ...await original<typeof import("../pokeweb/bw2ScriptEntryReferences")>(), prepareBw2ScriptEntryResources: vi.fn(async () => {}) }));
const SOURCE = "script :main, entry: 1 do\n  nop\nend\n";
const REPLACEMENT = "script :main, entry: 1 do\n  face_player\nend\n";

type Node = { value: string; textContent: string; innerHTML: string; disabled: boolean; hidden: boolean; className: string; attributes: Record<string, string>; querySelector: () => undefined; setAttribute: (name: string, value: string) => void; focus: () => void; selectedOptions: { textContent: string }[]; listeners: Record<string, () => unknown>; addEventListener: (event: string, action: () => unknown) => void };
function fixture(version: "BW2" | "BW" = "BW2") {
  const project: ProjectState = {
    session: { romName: "test", baseVersion: version === "BW2" ? "W2" : "W", baseRom: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "fixture.nds", size: 1 },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "test", fileCount: 2, rawFiles: [compileBw2Script(SOURCE).bytes, compileBw2Script(SOURCE).bytes], records: new Map(), dirty: new Set() } },
  };
  const nodes = new Map<string, Node>();
  for (const id of ["source-editor", "definitions-editor", "script-tab", "definitions-tab", "texts-tab", "texts-editor", "message-sidebar", "source-section", "map-preview", "command-help", "script-file", "command-overlay", "decompile", "apply", "compile", "compile-status", "compile-result", "error-location", "draft-state", "source-title", "entry-slot", "entry-replacement", "entry-impact", "add-entry", "clear-entry", "remove-entry", "add-movement", "remove-movement"]) {
    const listeners: Record<string, () => unknown> = {};
    const attributes: Record<string, string> = {};
    nodes.set(`#bw2-${id}`, { value: "0", textContent: "", innerHTML: "", disabled: false, hidden: false, className: "", attributes, querySelector: () => undefined, setAttribute: (name, value) => { attributes[name] = value; }, focus: vi.fn(), selectedOptions: [{ textContent: "" }], listeners, addEventListener: (event, action) => { listeners[event] = action; } });
  }
  const root = { innerHTML: "", querySelector: (selector: string) => nodes.get(selector) };
  const options = { onApply: vi.fn(), onDraftChange: vi.fn() };
  const previews: { setFocus: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  vi.mocked(installBw2ScriptMapPreview).mockImplementation(() => { const preview = { setFocus: vi.fn(), destroy: vi.fn() }; previews.push(preview); return preview; });
  const editors: { getValue: () => string; setValue: (source: string) => void; setError: ReturnType<typeof vi.fn>; focusError: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; getCursor: () => { line: number; column: number; word: string; text: string }; moveCursor: (line: number, word: string) => void; doubleClick: (line: number, word: string) => boolean }[] = [];
  const definitionsEditors: typeof editors = [];
  vi.mocked(installBw2ScriptCodeEditor).mockImplementation((_host, source, onChange, onCursor, options) => {
    let text = source;
    let line = 1, word = "";
    const getCursor = () => ({ line, column: 1, word, text: text.split("\n")[line - 1] ?? "" });
    const editor = { getValue: () => text, getCursor, moveCursor: (nextLine: number, nextWord: string) => { line = nextLine; word = nextWord; onCursor?.(getCursor()); }, doubleClick: (line: number, word: string) => { const sourceLine = text.split("\n")[line - 1]; return options?.onNavigate?.({ line, column: sourceLine.indexOf(word) + 1, word, text: sourceLine }) ?? false; }, setValue: (next: string) => { text = next; onChange(next); onCursor?.(getCursor()); }, setError: vi.fn(), focusError: vi.fn(), destroy: vi.fn() };
    (_host === nodes.get("#bw2-definitions-editor") as unknown as HTMLElement ? definitionsEditors : editors).push(editor);
    return editor;
  });
  const render = () => renderBw2ScriptEditor(project, root as unknown as HTMLElement, options);
  render();
  return { project, root, nodes, options, editors, definitionsEditors, previews, render, node: (id: string) => nodes.get(`#bw2-${id}`)! };
}

describe("BW2 script editor interactions", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(resolveBw2ScriptOverlay).mockReturnValue({ kind: "unavailable", zones: [], description: "No source ROM in fixture." }); vi.stubGlobal("window", { location: { hostname: "localhost" } }); });
  afterEach(() => { stopBw2ScriptEditor(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("stages a new entry and movement in their proper tabs and applies both together", () => {
    const f = fixture(), original = f.project.narcs.scripts!.rawFiles[0].slice();
    expect(f.node("add-entry").disabled).toBe(true);
    f.node("decompile").listeners.click(); f.node("add-entry").listeners.click(); f.node("add-movement").listeners.click();
    expect(f.editors[0].getValue()).toContain("entry: 2"); expect(f.editors[0].getValue()).not.toContain("movement :");
    expect(f.definitionsEditors[0].getValue()).toContain("movement :new_movement");
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(original); expect(f.project.narcs.scripts!.dirty.size).toBe(0);
    expect(f.node("entry-impact").textContent).toContain("1 → 2 entries");
    f.node("apply").listeners.click();
    expect(f.options.onApply).toHaveBeenCalledOnce(); expect(f.project.bw2ScriptEditor!.drafts[0].entryMapping).toBeUndefined();
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(compileBw2Script(joinBw2ScriptSource({ script: f.editors[0].getValue(), definitions: f.definitionsEditors[0].getValue() })).bytes);
  });
  it("composes entry mappings through repeated structural edits without applying intermediate drafts", async () => {
    const f = fixture(); f.node("decompile").listeners.click();
    f.node("add-entry").listeners.click(); f.node("add-entry").listeners.click();
    f.node("entry-slot").value = "2"; f.node("entry-replacement").value = "0";
    await f.node("remove-entry").listeners.click();
    expect(prepareBw2ScriptEntryResources).toHaveBeenCalled();
    expect(f.project.bw2ScriptEditor!.drafts[0].entryMapping).toEqual([1]);
    expect(f.editors[0].getValue()).toContain("script :script_3, entry: 2");
    expect(f.node("apply").disabled).toBe(false); expect(f.options.onApply).not.toHaveBeenCalled();
  });
  it("leaves source unchanged when a removal cannot safely inspect event assignments", async () => {
    const f = fixture(); f.node("decompile").listeners.click(); const source = f.editors[0].getValue();
    f.node("entry-slot").value = "1"; f.node("entry-replacement").value = "0";
    await f.node("remove-entry").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Load map headers");
    expect(f.editors[0].getValue()).toBe(source); expect(f.options.onDraftChange).toHaveBeenCalledTimes(1); expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });
  it("clears an entry without renumbering and removes an unused movement from Definitions", () => {
    const f = fixture(); f.node("decompile").listeners.click(); f.node("entry-slot").value = "1"; f.node("clear-entry").listeners.click();
    expect(f.editors[0].getValue()).toContain("block :script_1"); expect(f.editors[0].getValue()).toContain("cleared_entry_1, entry: 1");
    f.node("add-movement").listeners.click(); f.node("definitions-tab").listeners.click();
    const line = f.definitionsEditors[0].getValue().split("\n").findIndex((text) => text.startsWith("movement :new_movement")) + 1;
    f.definitionsEditors[0].moveCursor(line, "new_movement"); f.node("remove-movement").listeners.click();
    expect(f.definitionsEditors[0].getValue()).not.toContain("new_movement"); expect(f.node("apply").disabled).toBe(false);
  });
  it.each(["pokeweb.example.com", "192.168.1.5", "localhost.example.com", "127.0.0.1.example.com", ""]) ("denies direct editor access on %s", (hostname) => {
    vi.stubGlobal("window", { location: { hostname } });
    const f = fixture();
    expect(f.root.innerHTML).toContain("available only on localhost");
    expect(f.editors).toHaveLength(0);
    expect(f.previews).toHaveLength(0);
    expect(f.project.bw2ScriptEditor).toBeUndefined();
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"]) ("allows loopback editor access on %s", (hostname) => {
    vi.stubGlobal("window", { location: { hostname } });
    expect(fixture().editors).toHaveLength(1);
  });
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
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ name: "one", entries: [1] }), expect.stringContaining("actor_set_g_pos"), undefined, expect.any(Map));
    expect(f.root.innerHTML).toContain("bw2-script-split");
    expect(f.root.innerHTML).not.toContain("Compiled entry points");
    f.node("source-section").value = "1";
    f.node("source-section").listeners.change();
    expect(f.editors[0].focusError).toHaveBeenCalledWith({ line: 1, column: 1 });
    stopBw2ScriptEditor();
    expect(f.previews[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("shows a focused message entry from its command or arguments and keeps the Texts tab separate from compilation", () => {
    const f = fixture(), texts = vi.mocked(installBw2ScriptTexts).mock.results.at(-1)!.value;
    f.project.narcs.scripts!.rawFiles[0] = compileBw2Script("preserve_layout\nscript :one, entry: 1 do\nmsg_actor_ex 0x400, 17, 0xfe, 0, 0\nhalt\nend").bytes;
    f.node("decompile").listeners.click();
    f.editors[0].moveCursor(2, "0x400");
    expect(texts.setReference).toHaveBeenLastCalledWith({ bankId: undefined, entryId: 17, defaultBank: true });
    expect(f.node("command-help").innerHTML).toContain("following companion");
    expect(f.node("command-help").innerHTML).toContain("text_bank");
    const source = f.editors[0].getValue();
    f.node("texts-tab").listeners.click();
    expect(f.node("texts-tab").attributes["aria-selected"]).toBe("true");
    expect(f.node("texts-editor").hidden).toBe(false);
    expect(f.node("source-editor").hidden).toBe(true);
    f.node("compile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Compiled successfully");
    expect(f.editors[0].getValue()).toBe(source);
    f.node("script-tab").listeners.click();
    f.editors[0].moveCursor(3, "end");
    expect(texts.setReference).toHaveBeenLastCalledWith(undefined);
    stopBw2ScriptEditor();
    expect(texts.destroy).toHaveBeenCalledOnce();
  });
  it("compiles a companion macro and describes its keyword arguments from the sidebar", () => {
    const f = fixture();
    f.editors[0].setValue("script :one, entry: 1 do\nstop_companion_following script: 1, movement: :none\nend");
    f.editors[0].moveCursor(2, "none");
    expect(f.node("command-help").innerHTML).toContain("Macro · 7 commands");
    expect(f.node("command-help").innerHTML).toContain("Interaction script ID");
    expect(f.node("command-help").innerHTML).toContain("no autonomous movement");
    f.node("compile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Compiled successfully");
    f.node("apply").listeners.click();
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(compileBw2Script(f.editors[0].getValue()).bytes);
    expect(f.options.onApply).toHaveBeenCalledOnce();
  });
  it.each([
    ["talk message: 17", "talk", 5],
    ["read_sign style: :town, message: 17", "read_sign", 4],
  ])("recovers %s from ROM and routes its arguments to text previews and macro help", (call, name, count) => {
    const f = fixture(), texts = vi.mocked(installBw2ScriptTexts).mock.results.at(-1)!.value;
    const original = compileBw2Script(`preserve_layout\nscript :one, entry: 1 do\nword_set_rival_name 1\n${call}\nfinish_interaction\nend`).bytes;
    f.project.narcs.scripts!.rawFiles[0] = original;
    f.node("decompile").listeners.click();
    const lines = f.editors[0].getValue().split("\n");
    const line = lines.findIndex((line) => line.trimStart().startsWith(name as string)) + 1;
    expect(line).toBeGreaterThan(0);
    f.editors[0].moveCursor(line, "message");
    expect(texts.setReference).toHaveBeenLastCalledWith({ bankId: undefined, entryId: 17, defaultBank: true, variables: { 1: { length: 7, label: "rival name" } } });
    expect(f.node("command-help").innerHTML).toContain(`Macro · ${count} commands`);
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ entries: [1] }), expect.any(String), undefined, expect.any(Map));
    f.node("compile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Compiled successfully");
    expect(f.project.narcs.scripts!.rawFiles[0]).toEqual(original);
    const finishLine = lines.findIndex((line) => line.trim() === "finish_interaction") + 1;
    f.editors[0].moveCursor(finishLine, "finish_interaction");
    expect(texts.setReference).toHaveBeenLastCalledWith(undefined);
    expect(f.node("command-help").innerHTML).toContain("Macro · 3 commands");
    f.editors[0].setValue(f.editors[0].getValue().replace("message: 17", "message: 18"));
    f.node("apply").listeners.click();
    expect(f.options.onApply).toHaveBeenCalledOnce();
    expect(f.project.narcs.scripts!.rawFiles[0]).not.toEqual(original);
    stopBw2ScriptEditor();
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
    expect(f.editors[0].getValue()).toContain("pl_boat_start 0x0001");
    expect(f.node("apply").disabled).toBe(false);
  });
  it("automatically imports the map's command overlay, shows semantic help and applies verified edits", () => {
    vi.mocked(resolveBw2ScriptOverlay).mockReturnValue({ kind: "detected", overlayId: 66, zones: [427], description: "Overlay 66 from dispatcher." });
    const f = fixture();
    expect(f.node("command-overlay").value).toBe("auto");
    const bytes = compileBw2Script("preserve_layout\noverlay 66\nscript :main, entry: 1 do\naspertia_start_petals\naspertia_initialize_ending\nhalt\nend").bytes;
    f.project.narcs.scripts!.rawFiles[0] = bytes;
    f.node("decompile").listeners.click();
    expect(f.definitionsEditors[0].getValue()).toContain("overlay 66");
    expect(f.editors[0].getValue()).toContain("aspertia_start_petals");
    expect(f.node("apply").disabled).toBe(false);
    f.editors[0].moveCursor(2, "aspertia_start_petals");
    expect(f.node("command-help").innerHTML).toContain("petal animation");
    f.editors[0].setValue(f.editors[0].getValue().replace("  halt", "  nop\n  halt"));
    f.node("apply").listeners.click();
    expect(f.project.narcs.scripts!.rawFiles[0].length).toBe(bytes.length + 2);
    expect(f.project.bw2ScriptEditor!.drafts[0].imported!.baselineBytes).toEqual(bytes);
    expect(f.options.onApply).toHaveBeenCalledTimes(1);
    const applied = f.project.narcs.scripts!.rawFiles[0];
    vi.mocked(resolveBw2ScriptOverlay).mockReturnValue({ kind: "detected", overlayId: 55, zones: [427], description: "Map now uses overlay 55." });
    f.node("apply").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Map command overlay changed");
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(applied);
  });
  it("requires explicit context for conflicting map overlays without replacing a draft or ROM bytes", () => {
    vi.mocked(resolveBw2ScriptOverlay).mockReturnValue({ kind: "ambiguous", zones: [100, 427], description: "Assigned maps use different command overlays." });
    const f = fixture(), original = f.project.narcs.scripts!.rawFiles[0];
    f.editors[0].setValue(REPLACEMENT);
    f.node("decompile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("different command overlays");
    expect(f.editors[0].getValue()).toBe(REPLACEMENT);
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(original);
    f.node("command-overlay").value = "";
    f.node("decompile").listeners.click();
    expect(f.node("compile-status").textContent).toContain("Byte-identical");
    expect(f.definitionsEditors[0].getValue()).not.toContain("overlay");
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
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ name: "main", line: 3, entries: [1] }), expect.stringContaining("actor_set_g_pos"), undefined, expect.any(Map));
    f.node("definitions-tab").listeners.click();
    f.definitionsEditors[0].moveCursor(1, "intro");
    expect(f.node("command-help").innerHTML).toContain("Work 0x40a1");
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(undefined, "work :intro, 0x40a1", undefined, expect.any(Map));
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });
  it("shows imported movements in Definitions, routes movement navigation/errors and applies relocated edits", () => {
    const f = fixture();
    const original = compileBw2Script("script :main, entry: 1 do\napply_movement 3, :walk\nend\nmovement :walk do\nwait_8 2\nwalk_left 2\nturn_right 1\nend").bytes;
    f.project.narcs.scripts!.rawFiles[0] = original;
    f.node("decompile").listeners.click();
    const definitions = f.definitionsEditors[0].getValue();
    expect(definitions).toContain("movement :movement_10");
    expect(f.editors[0].getValue()).not.toContain("movement :");
    expect(f.node("compile-status").textContent).toContain("Byte-identical");
    const movementLine = definitions.split("\n").findIndex((line) => line.startsWith("movement :")) + 1;
    f.node("definitions-tab").listeners.click();
    f.definitionsEditors[0].moveCursor(movementLine + 2, "walk_left");
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "movement", entries: [1] }), "  walk_left 2", undefined, expect.any(Map));
    expect(f.node("command-help").innerHTML).toContain("Movement 0x000e");
    expect(f.node("command-help").innerHTML).toContain("repeat count");
    const context = f.project.bw2ScriptEditor!.drafts[0].source;
    const fullLine = context.split("\n").findIndex((line) => line.startsWith("movement :")) + 1;
    f.node("script-tab").listeners.click();
    f.node("source-section").value = String(fullLine); f.node("source-section").listeners.change();
    expect(f.node("definitions-tab").attributes["aria-selected"]).toBe("true");
    expect(f.definitionsEditors[0].focusError).toHaveBeenLastCalledWith({ line: movementLine, column: 1 });
    f.definitionsEditors[0].setValue(definitions.replace("walk_left 2", "walk_left 65536"));
    f.node("compile").listeners.click();
    expect(f.node("compile-status").textContent).toContain(`Definitions line ${movementLine + 2}`);
    f.node("error-location").listeners.click();
    expect(f.definitionsEditors[0].focusError).toHaveBeenLastCalledWith({ line: movementLine + 2, column: 13 });
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(original);
    f.definitionsEditors[0].setValue(definitions.replace("walk_left 2", "walk_left 2\n  walk_down 1"));
    f.node("apply").listeners.click();
    expect(f.options.onApply).toHaveBeenCalledTimes(1);
    expect(f.project.narcs.scripts!.rawFiles[0].length).toBe(original.length + 4);
    f.render();
    expect(f.definitionsEditors[1].getValue()).toContain("walk_down 1");
    expect(f.editors[1].getValue()).not.toContain("movement :");
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
  it("double-clicks movement references into Definitions and keeps cursor highlighting read-only", () => {
    const f = fixture(), original = f.project.narcs.scripts!.rawFiles[0];
    f.definitionsEditors[0].setValue("HUGH = 3\nmovement :walk do\n  walk_left 1\n  label :tail\n  turn_up 1\nend\n");
    f.editors[0].setValue("script :main, entry: 1 do\n  apply_movement HUGH, :walk\n  apply_movement 3, :tail\nend\n");
    const changes = f.options.onDraftChange.mock.calls.length, source = f.project.bw2ScriptEditor!.drafts[0].source;
    f.editors[0].moveCursor(2, "apply_movement");
    expect(f.previews[0].setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ entries: [1] }), "  apply_movement HUGH, :walk", undefined, new Map([["HUGH", 3]]));
    expect(f.editors[0].doubleClick(2, "walk")).toBe(true);
    expect(f.node("definitions-tab").attributes["aria-selected"]).toBe("true");
    expect(f.definitionsEditors[0].focusError).toHaveBeenLastCalledWith({ line: 2, column: 1 });
    f.node("script-tab").listeners.click();
    expect(f.editors[0].doubleClick(3, "tail")).toBe(true);
    expect(f.definitionsEditors[0].focusError).toHaveBeenLastCalledWith({ line: 4, column: 3 });
    f.node("script-tab").listeners.click();
    expect(f.editors[0].doubleClick(2, "apply_movement")).toBe(false);
    expect(f.node("script-tab").attributes["aria-selected"]).toBe("true");
    expect(f.project.bw2ScriptEditor!.drafts[0].source).toBe(source);
    expect(f.options.onDraftChange).toHaveBeenCalledTimes(changes);
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(original);
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });
});
