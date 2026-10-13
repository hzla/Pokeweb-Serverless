import { describe, expect, it, vi } from "vitest";
import { installBw2ScriptTexts } from "../ui/bw2ScriptTexts";
import { installBw2DialoguePreview } from "../ui/bw2DialoguePreview";
import { encodeGen5TextBank, decodeGen5TextBank } from "../pokeweb/text";
import type { HeaderRow } from "../pokeweb/headerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";
import { bw2ScriptMessageReference, bw2ScriptWordLimits } from "../pokeweb/bw2ScriptTextModel";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";

vi.mock("../ui/bw2DialoguePreview", () => ({ installBw2DialoguePreview: vi.fn(() => ({ refresh: vi.fn(), show: vi.fn(), destroy: vi.fn() })) }));

function fixture() {
  const project = {
    session: { baseRom: "BW2" }, texts: { banks: {} }, narcs: { story_texts: { name: "story_texts", rawFiles: [encodeGen5TextBank([["0_0", "Hi VAR(256, 1)!\\r", 0], ["0_1", "</textarea><img src=x onerror=alert(1)>", 0]]), encodeGen5TextBank([["0_0", "Other map text", 0]])], dirty: new Set(), records: new Map() } },
    headers: { count: 2, rows: { 1: { script_id: 854, text_bank_id: 0, index: 427, location_name: "Aspertia" } as HeaderRow, 2: { script_id: 854, text_bank_id: 1, index: 428, location_name: "Other map" } as HeaderRow } },
  } as unknown as ProjectState;
  type Event = { target?: unknown };
  const node = () => ({ innerHTML: "", textContent: "", value: "", hidden: false, disabled: false, className: "", attributes: {} as Record<string, string>, setAttribute(name: string, value: string) { this.attributes[name] = value; }, listeners: {} as Record<string, (event: Event) => void>, addEventListener(type: string, listener: (event: Event) => void) { this.listeners[type] = listener; } });
  const nodes = new Map(["text-bank", "text-search", "text-context", "text-entries", "message-text", "message-status", "message-save", "message-open-bank", "message-bank", "message-block", "message-text-tab", "message-preview-tab", "message-edit-pane", "message-preview-pane"].map((id) => [`#bw2-${id}`, node()]));
  const host = () => ({ ...node(), querySelector: (id: string) => nodes.get(id) });
  const sidebar = host(), panel = host(), onDirty = vi.fn(), onShow = vi.fn();
  const editor = installBw2ScriptTexts(project, sidebar as unknown as HTMLElement, panel as unknown as HTMLElement, 854, onDirty, onShow);
  return { project, sidebar, panel, editor, onDirty, onShow, node: (id: string) => nodes.get(`#bw2-${id}`)!, click: (id: string) => nodes.get(`#bw2-${id}`)!.listeners.click({}) };
}

describe("BW2 dialogue sidebar and Texts tab", () => {
  it("lists assigned banks and text safely, opens referenced dialogue and clears stale references", () => {
    const f = fixture();
    expect(f.node("text-bank").innerHTML).toContain("Aspertia (Zone 427)");
    expect(f.node("text-bank").innerHTML).toContain("Other map (Zone 428)");
    expect(f.node("text-entries").innerHTML).toContain("Entry 1");
    expect(f.node("text-entries").innerHTML).toContain("&lt;img");
    f.editor.setReference({ defaultBank: true, entryId: 1 });
    expect(f.sidebar.hidden).toBe(false);
    expect(f.sidebar.innerHTML).toContain("Story bank 0 · Entry 1");
    expect(f.sidebar.innerHTML).toContain("Map-specific bank");
    expect(f.sidebar.innerHTML).not.toContain("<img");
    f.editor.setReference(undefined);
    expect(f.sidebar.hidden).toBe(true);
    f.editor.setReference({ defaultBank: false, reason: "runtime value <unknown>" });
    expect(f.sidebar.innerHTML).toContain("runtime value &lt;unknown&gt;");
  });
  it("saves sidebar edits to the shared bank, refreshes the list, preserves drafts across repeated cursor callbacks and reports failures", () => {
    const f = fixture();
    f.editor.setReference({ defaultBank: true, entryId: 0 });
    f.node("message-text").value = "Hello VAR(256, 1)!\\r";
    f.node("message-text").listeners.input({});
    const html = f.sidebar.innerHTML;
    f.editor.setReference({ defaultBank: true, entryId: 0 });
    expect(f.sidebar.innerHTML).toBe(html);
    expect(f.node("message-text").value).toBe("Hello VAR(256, 1)!\\r");
    f.click("message-save");
    expect(f.onDirty).toHaveBeenCalledOnce();
    expect(decodeGen5TextBank(f.project.narcs.story_texts!.rawFiles[0])[0][1]).toBe("Hello VAR(256, 1)!\\r");
    expect(f.node("text-entries").innerHTML).toContain("Hello VAR(256, 1)!");
    expect(f.node("message-status").textContent).toContain("Export the ROM");
    const saved = f.project.narcs.story_texts!.rawFiles[0];
    f.node("message-text").value = "VAR(";
    f.click("message-save");
    expect(f.node("message-status").className).toContain("-error");
    expect(f.project.narcs.story_texts!.rawFiles[0]).toBe(saved);
    expect(f.onDirty).toHaveBeenCalledOnce();
  });
  it("selects different assigned banks explicitly and lets any bank entry be opened from the searchable Texts tab", () => {
    const f = fixture();
    f.editor.setReference({ defaultBank: true, entryId: 0 });
    f.node("message-bank").listeners.change({ target: { value: "1" } });
    expect(f.sidebar.innerHTML).toContain("Story bank 1 · Entry 0");
    expect(f.sidebar.innerHTML).toContain("Other map text");
    f.node("text-bank").value = "0"; f.node("text-bank").listeners.change({});
    f.node("text-search").value = "1"; f.node("text-search").listeners.input({});
    expect(f.node("text-entries").innerHTML).toContain("Entry 1");
    f.node("text-search").value = "no match"; f.node("text-search").listeners.input({});
    expect(f.node("text-entries").innerHTML).toContain("No matching entries");
    f.node("text-entries").listeners.click({ target: { closest: () => ({ dataset: { textEntry: "0_1" } }) } });
    expect(f.sidebar.innerHTML).toContain("Story bank 0 · Entry 1");
    f.click("message-open-bank");
    expect(f.onShow).toHaveBeenCalledOnce();
    expect(f.node("text-search").value).toBe("");
    f.editor.setReference(undefined);
    expect(f.sidebar.hidden).toBe(true);
  });
  it("allows explicitly referenced banks without a header and reports missing entries instead of guessing", () => {
    const f = fixture();
    f.project.headers!.rows = {};
    const sidebar = f.sidebar, panel = f.panel;
    const editor = installBw2ScriptTexts(f.project, sidebar as unknown as HTMLElement, panel as unknown as HTMLElement, 99, f.onDirty, f.onShow);
    editor.setReference({ defaultBank: true, entryId: 0 });
    expect(sidebar.innerHTML).toContain("No assigned header");
    editor.setReference({ defaultBank: false, bankId: 1, entryId: 0 });
    expect(sidebar.innerHTML).toContain("Other map text");
    f.click("message-open-bank");
    expect(f.node("text-bank").innerHTML).toContain("explicit command reference");
    editor.setReference({ defaultBank: true, entryId: 0 });
    expect(sidebar.innerHTML).toContain("No assigned header");
    editor.setReference({ defaultBank: false, bankId: 1, entryId: 99 });
    expect(sidebar.innerHTML).toContain("missing from story bank");
    editor.destroy();
    const html = sidebar.innerHTML;
    editor.setReference({ defaultBank: false, bankId: 1, entryId: 0 });
    expect(sidebar.innerHTML).toBe(html);
  });
  it("switches sidebar Text/Preview tabs, previews unsaved input with known variable limits and disposes old previews", () => {
    const f = fixture();
    f.editor.setReference({ defaultBank: true, entryId: 0, variables: { 1: { length: 7, label: "rival name" } } });
    const preview = vi.mocked(installBw2DialoguePreview).mock.results.at(-1)!.value;
    expect(f.node("message-edit-pane").hidden).toBe(false);
    expect(f.node("message-preview-pane").hidden).toBe(true);
    f.click("message-preview-tab");
    expect(preview.show).toHaveBeenCalledOnce();
    expect(f.node("message-preview-tab").attributes["aria-selected"]).toBe("true");
    expect(f.node("message-edit-pane").hidden).toBe(true);
    expect(f.node("message-preview-pane").hidden).toBe(false);
    f.click("message-text-tab");
    f.node("message-text").value = "Draft VAR(256, 1)";
    f.node("message-text").listeners.input({});
    expect(preview.refresh).toHaveBeenCalledOnce();
    const [, , text, limits] = vi.mocked(installBw2DialoguePreview).mock.calls.at(-1)!;
    expect(text()).toBe("Draft VAR(256, 1)");
    expect(limits()).toEqual({ 1: { length: 7, label: "rival name" } });
    f.editor.setReference(undefined);
    expect(preview.destroy).toHaveBeenCalled();
    expect(f.onDirty).not.toHaveBeenCalled();
    expect(f.project.narcs.story_texts!.dirty.size).toBe(0);
  });
  it.each(["talk message: 0", "read_sign style: :town, message: 0"])("keeps text editing, unsaved previews, and variable placeholders working for %s", (macro) => {
    const f = fixture();
    const source = `preserve_layout\nscript :main, entry: 1 do\nword_set_rival_name 1\n${macro}\nfinish_interaction\nend`;
    const bytes = compileBw2Script(source).bytes;
    f.project.narcs.scripts = { name: "scripts", sourcePath: "a/0/5/6", fileId: 1, fileCount: 1, rawFiles: [bytes], records: new Map(), dirty: new Set() };
    const context = buildBw2ScriptSourceContext(source);
    const reference = bw2ScriptMessageReference(context.callAt(4), context.constantBindings)!;
    reference.variables = bw2ScriptWordLimits(f.project, context.callsBefore(4), context.constantBindings);
    f.editor.setReference(reference);
    expect(f.sidebar.innerHTML).toContain("Story bank 0 · Entry 0");
    const preview = vi.mocked(installBw2DialoguePreview).mock.results.at(-1)!.value;
    f.click("message-preview-tab");
    expect(preview.show).toHaveBeenCalledOnce();
    f.click("message-text-tab");
    f.node("message-text").value = "Draft\\nVAR(256, 1)!\\r";
    f.node("message-text").listeners.input({});
    const [, , text, variables] = vi.mocked(installBw2DialoguePreview).mock.calls.at(-1)!;
    expect(text()).toBe("Draft\\nVAR(256, 1)!\\r");
    expect(variables()).toEqual({ 1: { length: 7, label: "rival name" } });
    expect(preview.refresh).toHaveBeenCalledOnce();
    f.click("message-save");
    expect(decodeGen5TextBank(f.project.narcs.story_texts!.rawFiles[0])[0][1]).toBe("Draft\\nVAR(256, 1)!\\r");
    expect(f.project.narcs.scripts!.rawFiles[0]).toBe(bytes);
    expect(f.project.narcs.scripts!.dirty.size).toBe(0);
    f.editor.setReference(bw2ScriptMessageReference(context.callAt(5), context.constantBindings));
    expect(f.sidebar.hidden).toBe(true);
    expect(preview.destroy).toHaveBeenCalled();
  });
});
