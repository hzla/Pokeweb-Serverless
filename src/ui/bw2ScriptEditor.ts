import { Bw2ScriptCompileError, type CompiledBw2Script, type SourcePosition } from "../pokeweb/bw2ScriptCompiler";
import { compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript, saveBw2ScriptDraft } from "../pokeweb/bw2ScriptModel";
import { gen5ScriptEntries } from "../pokeweb/gen5ScriptCommands";
import { BW2_OVERLAY_COMMAND_BYTES } from "../pokeweb/gen5ScriptOverlayCommands";
import type { ProjectState } from "../pokeweb/projectStore";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";
import { bw2ScriptCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import { escapeHtml, formatBytes } from "./dom";
import { installBw2ScriptCodeEditor, type Bw2ScriptCodeEditor, type Bw2ScriptCursor } from "./bw2ScriptCodeEditor";
import { installBw2ScriptMapPreview, type Bw2ScriptMapPreview } from "./bw2ScriptMapPreview";

type Options = { onApply: () => void; onDraftChange: () => void };
let dispose: (() => void) | undefined;
const counted = (count: number, unit: string, plural = `${unit}s`): string => `${count} ${count === 1 ? unit : plural}`;

export function stopBw2ScriptEditor(): void { dispose?.(); dispose = undefined; }

export function renderBw2ScriptEditor(project: ProjectState, root: HTMLElement, options: Options): void {
  stopBw2ScriptEditor();
  const scripts = project.narcs.scripts;
  if (project.session.baseRom !== "BW2" || project.session.generation === "gen4" || !scripts?.rawFiles.length) {
    root.innerHTML = '<section class="bw2-script-empty"><h1>BW2 Scripts</h1><p>Load a Black 2 or White 2 ROM with its Scripts archive to open this editor.</p></section>';
    return;
  }
  const files = scripts.rawFiles.map((bytes, id) => ({ id, entries: gen5ScriptEntries(bytes).length, size: bytes.length }));
  const state = project.bw2ScriptEditor ??= { drafts: {} };
  let fileId = files.some((file) => file.id === state.selectedFileId) ? state.selectedFileId! : files.find((file) => file.entries > 0)?.id ?? 0;
  let editor: Bw2ScriptCodeEditor | undefined;
  let mapPreview: Bw2ScriptMapPreview | undefined;
  let sourceContext = buildBw2ScriptSourceContext("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastError: SourcePosition | undefined;
  root.innerHTML = `
    <section class="bw2-script-page">
      <aside class="bw2-script-sidebar">
        <h1>BW2 Scripts</h1>
        <p class="bw2-script-rom">${escapeHtml(project.romInfo.fileName)}</p>
        <label for="bw2-script-file">Script file</label>
        <select id="bw2-script-file">${files.map((file) => `<option value="${file.id}" ${file.id === fileId ? "selected" : ""}>${file.id} — ${file.entries ? counted(file.entries, "entry", "entries") : "unrecognized table"} — ${formatBytes(file.size)}</option>`).join("")}</select>
        <p id="bw2-file-summary"></p>
        <label for="bw2-command-overlay">Command overlay</label>
        <select id="bw2-command-overlay"><option value="">Base commands only</option>${Object.keys(BW2_OVERLAY_COMMAND_BYTES).map((id) => `<option value="${id}">Overlay ${id}</option>`).join("")}</select>
        <p class="bw2-script-notice">For commands 1000+, select the event's loaded overlay before decompiling.</p>
        <div class="bw2-script-source-actions">
          <button type="button" class="btn -default" id="bw2-decompile">Decompile from ROM</button>
          <button type="button" class="btn -default" id="bw2-import-source">Import source</button>
          <button type="button" class="btn -default" id="bw2-download-source">Download source</button>
          <input type="file" id="bw2-source-file" accept=".bws,.rb,.txt" hidden />
        </div>
        <section class="bw2-command-help" aria-labelledby="bw2-command-help-title"><h2 id="bw2-command-help-title">Command help</h2><div id="bw2-command-help">Click a command in the source to see what it does and what each argument means.</div></section>
        <p class="bw2-script-notice">Applying replaces this entire script file. Imports must pass an exact round trip. Decompiling replaces this file's source draft.</p>
        <details class="bw2-script-help">
          <summary>Syntax example</summary>
          <pre>work :counter, 0x8000

script :main, entry: 1 do
  counter = 0
  while counter &lt; 3
    pause_once
    counter += 1
  end
end

def pause_once
  sleep 1
end</pre>
          <p>Use if / elsif / else, unless, while, until, case / when, break, next, and return. Helpers share explicitly bound work variables.</p>
        </details>
      </aside>
      <div class="bw2-script-workspace">
        <div class="bw2-script-toolbar">
          <div><h2 id="bw2-source-title"></h2><span id="bw2-draft-state"></span></div>
          <select id="bw2-source-section" aria-label="Jump to script entry or helper"><option value="">Jump to entry or helper…</option></select>
          <div class="bw2-script-compile-actions">
            <button type="button" class="btn -default" id="bw2-compile">Compile</button>
            <button type="button" class="btn -primary" id="bw2-apply" disabled>Compile &amp; Apply</button>
          </div>
        </div>
        <div class="bw2-script-diagnostics" aria-live="polite" aria-atomic="true">
          <p id="bw2-compile-status">Import a source file or write a complete script to begin.</p>
          <button type="button" id="bw2-error-location" class="bw2-script-error-link" hidden></button>
        </div>
        <div class="bw2-script-split">
          <div id="bw2-source-editor" class="bw2-script-code"></div>
          <aside id="bw2-map-preview" class="bw2-script-map" aria-label="Script map preview"></aside>
        </div>
      </div>
    </section>`;
  const host = root.querySelector<HTMLElement>("#bw2-source-editor");
  const selector = root.querySelector<HTMLSelectElement>("#bw2-script-file");
  const overlaySelector = root.querySelector<HTMLSelectElement>("#bw2-command-overlay");
  const applyButton = root.querySelector<HTMLButtonElement>("#bw2-apply");
  const compileButton = root.querySelector<HTMLButtonElement>("#bw2-compile");
  const status = root.querySelector<HTMLElement>("#bw2-compile-status");
  const mapHost = root.querySelector<HTMLElement>("#bw2-map-preview");
  const help = root.querySelector<HTMLElement>("#bw2-command-help");
  const sectionSelect = root.querySelector<HTMLSelectElement>("#bw2-source-section");
  const errorButton = root.querySelector<HTMLButtonElement>("#bw2-error-location");
  const draftStatus = root.querySelector<HTMLElement>("#bw2-draft-state");
  const summary = root.querySelector<HTMLElement>("#bw2-file-summary");
  const title = root.querySelector<HTMLElement>("#bw2-source-title");
  const importButton = root.querySelector<HTMLButtonElement>("#bw2-import-source");
  const sourceFile = root.querySelector<HTMLInputElement>("#bw2-source-file");
  if (!host || !selector || !applyButton || !compileButton || !status || !errorButton || !draftStatus || !summary || !title || !importButton || !sourceFile) return;

  function clearTimer(): void { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function showError(error: unknown): void {
    status!.textContent = error instanceof Error ? error.message : String(error);
    status!.className = "-error";
    applyButton!.disabled = true;
    lastError = error instanceof Bw2ScriptCompileError ? error.position : undefined;
    editor?.setError(lastError);
    errorButton!.hidden = !lastError;
    if (lastError) errorButton!.textContent = `Go to line ${lastError.line}, column ${lastError.column}`;
  }
  function showResult(result: CompiledBw2Script, applied = false): void {
    status!.className = applied ? "-success" : "";
    const proof = result.roundTrip;
    status!.textContent = applied ? `Applied script file ${fileId}. Export the ROM to use it in game.` : proof ? `Byte-identical original round trip verified. ${proof.editable ? "Compiled successfully. Ready to apply." : "Read-only import; unsupported bytes are preserved."}` : "Compiled successfully. Ready to apply to the loaded ROM.";
    status!.title = proof?.warnings.join("\n") ?? "";
    errorButton!.hidden = true;
    lastError = undefined;
    editor?.setError();
    applyButton!.disabled = proof?.editable === false;
  }
  function validate(): void {
    clearTimer();
    if (stopped || !editor) return;
    try {
      const source = editor.getValue();
      const result = compileBw2ProjectScript(project, fileId, source);
      showResult(result);
      const current = scripts!.rawFiles[fileId];
      const matches = current.length === result.bytes.length && current.every((byte, index) => byte === result.bytes[index]);
      draftStatus!.textContent = matches && state.drafts[fileId]?.appliedSource === source ? "Applied source" : "Source draft · not applied";
    } catch (error) { showError(error); }
  }
  function updateCursor(cursor: Bw2ScriptCursor): void {
    if (stopped) return;
    const overlayId = state.drafts[fileId]?.imported?.overlayId ?? (overlaySelector?.value ? Number(overlaySelector.value) : undefined);
    const focus = sourceContext.focusAt(cursor.line);
    if (sectionSelect) sectionSelect.value = focus?.line.toString() ?? "";
    mapPreview?.setFocus(focus, cursor.text, overlayId);
    const command = bw2ScriptCommandHelp(cursor.word, overlayId);
    if (!help || !command) return;
    help.innerHTML = `<code class="bw2-command-name">${escapeHtml(command.name)}</code><span class="bw2-command-opcode">Opcode 0x${command.opcode.toString(16).padStart(4, "0")}</span><p>${escapeHtml(command.description)}</p>
      ${command.parameters.length ? `<ol>${command.parameters.map((parameter) => `<li><strong>${escapeHtml(parameter.name)}</strong> <span class="bw2-command-width">${parameter.width * 8} bit</span><p>${escapeHtml(parameter.description)}</p></li>`).join("")}</ol>` : "<p>No arguments.</p>"}
      ${command.note ? `<p class="bw2-command-note">${escapeHtml(command.note)}</p>` : ""}`;
  }
  function updateSourceIndex(source: string): void {
    sourceContext = buildBw2ScriptSourceContext(source);
    if (sectionSelect) sectionSelect.innerHTML = '<option value="">Jump to entry or helper…</option>' + sourceContext.definitions.map((definition) => `<option value="${definition.line}">${escapeHtml(definition.kind === "script" ? `Entry ${definition.entries[0] ?? "?"}: ${definition.name}` : `${definition.kind === "helper" ? "Helper" : "Block"}: ${definition.name}`)}</option>`).join("");
  }
  sectionSelect?.addEventListener("change", () => {
    const line = Number(sectionSelect.value);
    if (line > 0 && sourceContext.definitions.some((definition) => definition.line === line)) editor?.focusError({ line, column: 1 });
  });
  function openFile(): void {
    clearTimer();
    editor?.destroy();
    mapPreview?.destroy();
    mapPreview = mapHost ? installBw2ScriptMapPreview(project, mapHost, fileId) : undefined;
    if (help) help.textContent = "Click a command in the source to see what it does and what each argument means.";
    if (overlaySelector) overlaySelector.value = state.drafts[fileId]?.imported?.overlayId?.toString() ?? "";
    const count = gen5ScriptEntries(scripts!.rawFiles[fileId]).length;
    title!.textContent = `Script file ${fileId}`;
    summary!.textContent = count ? `Requires ${counted(count, "entry slot")}. Current size: ${formatBytes(scripts!.rawFiles[fileId].length)}.` : "This file has an unrecognized entry table. Apply is unavailable.";
    errorButton!.hidden = true;
    lastError = undefined;
    status!.className = "";
    status!.textContent = "Decompile from ROM, import source, or write a complete script to begin.";
    draftStatus!.textContent = state.drafts[fileId] ? "Source draft" : "No authored source";
    applyButton!.disabled = true;
    const source = state.drafts[fileId]?.source ?? `# Author ${counted(count, "entry", "entries")} for script file ${fileId}.\n# Import a .bws source or write your script below.\n`;
    updateSourceIndex(source);
    editor = installBw2ScriptCodeEditor(host!, source, (text) => {
      if (stopped) return;
      clearTimer();
      applyButton!.disabled = true;
      errorButton!.hidden = true;
      lastError = undefined;
      status!.className = "";
      status!.textContent = "Checking source…";
      draftStatus!.textContent = "Source draft · not applied";
      try { saveBw2ScriptDraft(project, fileId, text); options.onDraftChange(); }
      catch (error) { showError(error); return; }
      updateSourceIndex(text);
      timer = setTimeout(validate, 250);
    }, updateCursor);
    if (editor.getCursor) updateCursor(editor.getCursor());
    if (state.drafts[fileId]) validate();
  }
  selector.addEventListener("change", () => {
    const next = Number(selector.value);
    if (!Number.isInteger(next) || !files.some((file) => file.id === next)) return;
    fileId = next;
    state.selectedFileId = fileId;
    options.onDraftChange();
    openFile();
  });
  compileButton.addEventListener("click", validate);
  root.querySelector<HTMLButtonElement>("#bw2-decompile")?.addEventListener("click", () => {
    clearTimer();
    if (stopped || !editor) return;
    try {
      const result = decompileBw2ProjectScript(project, fileId, { overlayId: overlaySelector?.value ? Number(overlaySelector.value) : undefined });
      editor.setValue(result.source);
      options.onDraftChange();
      validate();
      draftStatus.textContent = `Imported from ROM · ${counted(result.stats.structuredBlocks, "recovered block")}`;
    } catch (error) { showError(error); }
  });
  applyButton.addEventListener("click", () => {
    clearTimer();
    if (stopped || !editor) return;
    try {
      const result = replaceBw2ProjectScript(project, fileId, editor.getValue());
      showResult(result, true);
      draftStatus.textContent = "Applied source";
      summary.textContent = `Requires ${counted(result.entries.length, "entry slot")}. Current size: ${formatBytes(result.bytes.length)}.`;
      const option = selector.selectedOptions[0];
      if (option) option.textContent = `${fileId} — ${counted(result.entries.length, "entry", "entries")} — ${formatBytes(result.bytes.length)}`;
      options.onApply();
    } catch (error) { showError(error); }
  });
  errorButton.addEventListener("click", () => { if (lastError) editor?.focusError(lastError); });
  importButton.addEventListener("click", () => sourceFile.click());
  sourceFile.addEventListener("change", async () => {
    const file = sourceFile.files?.[0];
    const receivingEditor = editor;
    sourceFile.value = "";
    if (!file || !receivingEditor) return;
    importButton.disabled = true;
    try {
      if (file.size > 4_000_000) throw new Error("Source file is too large; the compiler accepts up to one million characters.");
      const text = await file.text();
      if (stopped || editor !== receivingEditor) return;
      if (text.length > 1_000_000) throw new Error("Source exceeds the one-million-character limit.");
      receivingEditor.setValue(text);
      validate();
    } catch (error) { if (!stopped && editor === receivingEditor) showError(error); }
    finally { if (!stopped) importButton.disabled = false; }
  });
  root.querySelector<HTMLButtonElement>("#bw2-download-source")?.addEventListener("click", () => {
    if (!editor) return;
    const url = URL.createObjectURL(new Blob([editor.getValue()], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `bw2-script-${fileId}.bws`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  dispose = () => { stopped = true; clearTimer(); editor?.destroy(); mapPreview?.destroy(); editor = undefined; mapPreview = undefined; };
  openFile();
}
