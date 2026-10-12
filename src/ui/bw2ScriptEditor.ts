import { Bw2ScriptCompileError, type CompiledBw2Script, type SourcePosition } from "../pokeweb/bw2ScriptCompiler";
import { compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript, saveBw2ScriptDraft } from "../pokeweb/bw2ScriptModel";
import { gen5ScriptEntries } from "../pokeweb/gen5ScriptCommands";
import { BW2_OVERLAY_COMMAND_BYTES } from "../pokeweb/gen5ScriptOverlayCommands";
import type { ProjectState } from "../pokeweb/projectStore";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";
import { bw2ScriptCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import { bw2WorkAlias } from "../pokeweb/bw2ScriptCompiler/workAliases";
import { bw2ScriptPartPosition, bw2ScriptPreambleLines, joinBw2ScriptSource, splitBw2ScriptSource, type Bw2ScriptSourcePart, type Bw2ScriptSourceParts } from "../pokeweb/bw2ScriptSourceParts";
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
  let partEditors: Partial<Record<Bw2ScriptSourcePart, Bw2ScriptCodeEditor>> = {};
  let activePart: Bw2ScriptSourcePart = "script";
  let settingSource = false;
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
        <label for="bw2-command-overlay">Command overlay</label>
        <select id="bw2-command-overlay"><option value="">Base commands only</option>${Object.keys(BW2_OVERLAY_COMMAND_BYTES).map((id) => `<option value="${id}">Overlay ${id}</option>`).join("")}</select>
        <div class="bw2-script-source-actions">
          <button type="button" class="btn -default" id="bw2-decompile">Decompile from ROM</button>
        </div>
        <section class="bw2-command-help" aria-labelledby="bw2-command-help-title"><h2 id="bw2-command-help-title">Command &amp; work help</h2><div id="bw2-command-help">Click a command or work name in the source to see its meaning.</div></section>
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
          <p id="bw2-compile-status">Decompile from ROM or write a complete script to begin.</p>
          <button type="button" id="bw2-error-location" class="bw2-script-error-link" hidden></button>
        </div>
        <div class="bw2-script-split">
          <div class="bw2-script-source-pane">
            <div class="bw2-script-tabs" role="tablist" aria-label="Script source sections">
              <button type="button" role="tab" id="bw2-script-tab" aria-controls="bw2-source-editor" aria-selected="true">Script</button>
              <button type="button" role="tab" id="bw2-definitions-tab" aria-controls="bw2-definitions-editor" aria-selected="false" tabindex="-1">Definitions</button>
            </div>
            <div id="bw2-source-editor" class="bw2-script-code" role="tabpanel" aria-labelledby="bw2-script-tab"></div>
            <div id="bw2-definitions-editor" class="bw2-script-code" role="tabpanel" aria-labelledby="bw2-definitions-tab" hidden></div>
          </div>
          <aside id="bw2-map-preview" class="bw2-script-map" aria-label="Script map preview"></aside>
        </div>
      </div>
    </section>`;
  const host = root.querySelector<HTMLElement>("#bw2-source-editor");
  const definitionsHost = root.querySelector<HTMLElement>("#bw2-definitions-editor");
  const scriptTab = root.querySelector<HTMLButtonElement>("#bw2-script-tab");
  const definitionsTab = root.querySelector<HTMLButtonElement>("#bw2-definitions-tab");
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
  const title = root.querySelector<HTMLElement>("#bw2-source-title");
  if (!host || !definitionsHost || !scriptTab || !definitionsTab || !selector || !applyButton || !compileButton || !status || !errorButton || !draftStatus || !title) return;

  function sourceParts(): Bw2ScriptSourceParts { return { script: partEditors.script?.getValue() ?? "", definitions: partEditors.definitions?.getValue() ?? "" }; }
  function fullCursor(part: Bw2ScriptSourcePart, cursor: Bw2ScriptCursor): Bw2ScriptCursor {
    return { ...cursor, line: cursor.line + (part === "script" ? bw2ScriptPreambleLines(sourceParts()) : 0) };
  }
  function selectPart(part: Bw2ScriptSourcePart): void {
    activePart = part;
    host!.hidden = part !== "script";
    definitionsHost!.hidden = part !== "definitions";
    for (const [name, tab] of [["script", scriptTab], ["definitions", definitionsTab]] as const) {
      tab!.setAttribute("aria-selected", String(name === part));
      tab!.setAttribute("tabindex", name === part ? "0" : "-1");
    }
    partEditors[part]?.refreshLayout?.();
    const cursor = partEditors[part]?.getCursor();
    if (cursor) updateCursor(fullCursor(part, cursor));
  }
  scriptTab.addEventListener("click", () => selectPart("script"));
  definitionsTab.addEventListener("click", () => selectPart("definitions"));
  for (const tab of [scriptTab, definitionsTab]) tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectPart(event.key === "Home" ? "script" : event.key === "End" ? "definitions" : activePart === "script" ? "definitions" : "script");
    (activePart === "script" ? scriptTab : definitionsTab).focus();
  });

  function clearTimer(): void { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function showError(error: unknown): void {
    const local = error instanceof Bw2ScriptCompileError ? bw2ScriptPartPosition(sourceParts(), error.position) : undefined;
    const section = local?.part === "definitions" ? "Definitions" : "Script";
    status!.textContent = local && error instanceof Error ? error.message.replace(/\(line \d+, column \d+\)$/, `(${section} line ${local.position.line}, column ${local.position.column})`) : error instanceof Error ? error.message : String(error);
    status!.className = "-error";
    applyButton!.disabled = true;
    lastError = error instanceof Bw2ScriptCompileError ? error.position : undefined;
    editor?.setError(lastError);
    errorButton!.hidden = !lastError;
    if (lastError && local) errorButton!.textContent = `Go to ${section} line ${local.position.line}, column ${local.position.column}`;
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
    const workId = sourceContext.workBindings.get(cursor.word);
    if (help && workId !== undefined) {
      const work = bw2WorkAlias(workId);
      help.innerHTML = `<code class="bw2-command-name">${escapeHtml(cursor.word)}</code><span class="bw2-command-opcode">Work 0x${workId.toString(16).padStart(4, "0")} · ${escapeHtml(work.scope)} · integer</span><p>${escapeHtml(work.description)}</p>
        ${work.scope !== "unknown" && cursor.word !== work.name ? `<p>Catalog name: <code>${escapeHtml(work.name)}</code></p>` : ""}<p class="bw2-command-note">Work variables store numbers. Compare a stage with == or !=; flag_set? reads the separate event-flag storage.</p>`;
      return;
    }
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
    if (help) help.textContent = "Click a command or work name in the source to see its meaning.";
    if (overlaySelector) overlaySelector.value = state.drafts[fileId]?.imported?.overlayId?.toString() ?? "";
    const count = gen5ScriptEntries(scripts!.rawFiles[fileId]).length;
    title!.textContent = `Script file ${fileId}`;
    errorButton!.hidden = true;
    lastError = undefined;
    status!.className = "";
    status!.textContent = "Decompile from ROM or write a complete script to begin.";
    draftStatus!.textContent = state.drafts[fileId] ? "Source draft" : "No authored source";
    applyButton!.disabled = true;
    const source = state.drafts[fileId]?.source ?? `# Author ${counted(count, "entry", "entries")} for script file ${fileId}.\n# Decompile from ROM or write your script below.\n`;
    updateSourceIndex(source);
    const parts = splitBw2ScriptSource(source);
    const changed = () => {
      if (stopped || settingSource) return;
      const text = joinBw2ScriptSource(sourceParts());
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
    };
    partEditors = {};
    partEditors.script = installBw2ScriptCodeEditor(host!, parts.script, changed, (cursor) => { if (!settingSource && activePart === "script") updateCursor(fullCursor("script", cursor)); }, { bindingSource: () => joinBw2ScriptSource(sourceParts()) });
    partEditors.definitions = installBw2ScriptCodeEditor(definitionsHost!, parts.definitions, changed, (cursor) => { if (!settingSource && activePart === "definitions") updateCursor(cursor); }, { bindingSource: () => joinBw2ScriptSource(sourceParts()), label: "BW2 script definitions" });
    editor = {
      getValue: () => joinBw2ScriptSource(sourceParts()),
      setValue: (text) => {
        const parts = splitBw2ScriptSource(text);
        settingSource = true;
        try { partEditors.definitions!.setValue(parts.definitions); partEditors.script!.setValue(parts.script); }
        finally { settingSource = false; }
        updateSourceIndex(text);
        selectPart("script");
      },
      getCursor: () => fullCursor(activePart, partEditors[activePart]!.getCursor()),
      setError: (position) => {
        partEditors.script!.setError(); partEditors.definitions!.setError();
        if (position) { const local = bw2ScriptPartPosition(sourceParts(), position); partEditors[local.part]!.setError(local.position); }
      },
      focusError: (position) => {
        const local = bw2ScriptPartPosition(sourceParts(), position);
        selectPart(local.part); partEditors[local.part]!.focusError(local.position);
      },
      destroy: () => { partEditors.script?.destroy(); partEditors.definitions?.destroy(); partEditors = {}; },
    };
    selectPart("script");
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
      const option = selector.selectedOptions[0];
      if (option) option.textContent = `${fileId} — ${counted(result.entries.length, "entry", "entries")} — ${formatBytes(result.bytes.length)}`;
      options.onApply();
    } catch (error) { showError(error); }
  });
  errorButton.addEventListener("click", () => { if (lastError) editor?.focusError(lastError); });
  dispose = () => { stopped = true; clearTimer(); editor?.destroy(); mapPreview?.destroy(); editor = undefined; mapPreview = undefined; };
  openFile();
}
