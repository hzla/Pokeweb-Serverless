import { Bw2ScriptCompileError, compileBw2Script, type CompiledBw2Script, type SourcePosition } from "../pokeweb/bw2ScriptCompiler";
import { bw2EntryTableSignature, compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript, saveBw2ScriptDraft } from "../pokeweb/bw2ScriptModel";
import { gen5ScriptEntries } from "../pokeweb/gen5ScriptCommands";
import { BW2_OVERLAY_COMMAND_BYTES } from "../pokeweb/gen5ScriptOverlayCommands";
import type { ProjectState } from "../pokeweb/projectStore";
import { buildBw2ScriptSourceContext, bw2ScriptMovementReferenceAt } from "../pokeweb/bw2ScriptContextModel";
import { bw2ScriptCommandHelp, bw2MovementCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import { bw2WorkAlias } from "../pokeweb/bw2ScriptCompiler/workAliases";
import { canUseLocalRomBridge } from "../pokeweb/localRomBridge";
import { resolveBw2ScriptOverlay, type Bw2ScriptOverlayContext } from "../pokeweb/bw2ScriptOverlayContext";
import { bw2ScriptPartPosition, bw2ScriptFullPosition, joinBw2ScriptSource, splitBw2ScriptSource, type Bw2ScriptSourcePart, type Bw2ScriptSourceParts } from "../pokeweb/bw2ScriptSourceParts";
import { escapeHtml, formatBytes } from "./dom";
import { installBw2ScriptCodeEditor, type Bw2ScriptCodeEditor, type Bw2ScriptCursor } from "./bw2ScriptCodeEditor";
import { installBw2ScriptMapPreview, type Bw2ScriptMapPreview } from "./bw2ScriptMapPreview";
import { bw2ScriptMessageReference, bw2ScriptWordLimits } from "../pokeweb/bw2ScriptTextModel";
import { installBw2ScriptTexts, type Bw2ScriptTexts } from "./bw2ScriptTexts";
import { addBw2ScriptEntry, removeBw2ScriptEntry, clearBw2ScriptEntry, addBw2ScriptMovement, removeBw2ScriptMovement, type Bw2ScriptStructureEdit } from "../pokeweb/bw2ScriptStructure";
import { prepareBw2ScriptEntryResources } from "../pokeweb/bw2ScriptEntryReferences";

type Options = { onApply: () => void; onDraftChange: () => void };
let dispose: (() => void) | undefined;
const counted = (count: number, unit: string, plural = `${unit}s`): string => `${count} ${count === 1 ? unit : plural}`;

export function stopBw2ScriptEditor(): void { dispose?.(); dispose = undefined; }

export function renderBw2ScriptEditor(project: ProjectState, root: HTMLElement, options: Options): void {
  stopBw2ScriptEditor();
  if (!canUseLocalRomBridge()) {
    root.innerHTML = '<section class="bw2-script-empty"><h1>BW2 Scripts</h1><p>The script editor is available only on localhost.</p></section>';
    return;
  }
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
  let activePart: Bw2ScriptSourcePart | "texts" = "script";
  let settingSource = false;
  let mapPreview: Bw2ScriptMapPreview | undefined;
  let texts: Bw2ScriptTexts | undefined;
  let sourceContext = buildBw2ScriptSourceContext("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastError: SourcePosition | undefined;
  let previewEntryMapping: number[] | undefined;
  let overlayContext: Bw2ScriptOverlayContext | undefined;
  root.innerHTML = `
    <section class="bw2-script-page">
      <aside class="bw2-script-sidebar">
        <h1>BW2 Scripts</h1>
        <p class="bw2-script-rom">${escapeHtml(project.romInfo.fileName)}</p>
        <label for="bw2-script-file">Script file</label>
        <select id="bw2-script-file">${files.map((file) => `<option value="${file.id}" ${file.id === fileId ? "selected" : ""}>${file.id} — ${file.entries ? counted(file.entries, "entry", "entries") : "unrecognized table"} — ${formatBytes(file.size)}</option>`).join("")}</select>
        <label for="bw2-command-overlay">Command overlay</label>
        <select id="bw2-command-overlay"><option value="auto">Auto — map overlay</option><option value="">Base commands only</option>${Object.keys(BW2_OVERLAY_COMMAND_BYTES).map((id) => `<option value="${id}">Overlay ${id}</option>`).join("")}</select>
        <div class="bw2-script-source-actions">
          <button type="button" class="btn -default" id="bw2-decompile">Decompile from ROM</button>
        </div>
        <section class="bw2-script-structure" aria-label="Entries and movements">
          <label for="bw2-entry-slot">Entry to edit</label><select id="bw2-entry-slot"></select>
          <div class="bw2-structure-buttons"><button type="button" class="btn -default" id="bw2-add-entry" disabled>Add entry</button><button type="button" class="btn -default" id="bw2-clear-entry" disabled>Clear entry</button></div>
          <label for="bw2-entry-replacement">Replace removed entry with</label><select id="bw2-entry-replacement"><option value="0">No script — detach events</option></select>
          <button type="button" class="btn -default" id="bw2-remove-entry" disabled>Remove entry</button>
          <div class="bw2-structure-buttons"><button type="button" class="btn -default" id="bw2-add-movement" disabled>Add movement</button><button type="button" class="btn -default" id="bw2-remove-movement" disabled>Remove movement</button></div>
        </section>
        <section id="bw2-message-sidebar" class="bw2-script-message" aria-label="Referenced dialogue editor" hidden></section>
        <section class="bw2-command-help" aria-labelledby="bw2-command-help-title"><h2 id="bw2-command-help-title">Command &amp; work help</h2><div id="bw2-command-help">Click a command or work name in the source to see its meaning.</div></section>
      </aside>
      <div class="bw2-script-workspace">
        <div class="bw2-script-toolbar">
          <div><h2 id="bw2-source-title"></h2><span id="bw2-draft-state"></span></div>
          <select id="bw2-source-section" aria-label="Jump to script entry, helper or movement"><option value="">Jump to entry, helper or movement…</option></select>
          <div class="bw2-script-compile-actions">
            <button type="button" class="btn -default" id="bw2-compile">Compile</button>
            <button type="button" class="btn -primary" id="bw2-apply" disabled>Compile &amp; Apply</button>
          </div>
        </div>
        <div class="bw2-script-diagnostics" aria-live="polite" aria-atomic="true">
          <p id="bw2-compile-status">Decompile from ROM or write a complete script to begin.</p>
          <div id="bw2-entry-impact" hidden></div>
          <button type="button" id="bw2-error-location" class="bw2-script-error-link" hidden></button>
        </div>
        <div class="bw2-script-split">
          <div class="bw2-script-source-pane">
            <div class="bw2-script-tabs" role="tablist" aria-label="Script source sections">
              <button type="button" role="tab" id="bw2-script-tab" aria-controls="bw2-source-editor" aria-selected="true">Script</button>
              <button type="button" role="tab" id="bw2-definitions-tab" aria-controls="bw2-definitions-editor" aria-selected="false" tabindex="-1">Definitions</button>
              <button type="button" role="tab" id="bw2-texts-tab" aria-controls="bw2-texts-editor" aria-selected="false" tabindex="-1">Texts</button>
            </div>
            <div id="bw2-source-editor" class="bw2-script-code" role="tabpanel" aria-labelledby="bw2-script-tab"></div>
            <div id="bw2-definitions-editor" class="bw2-script-code" role="tabpanel" aria-labelledby="bw2-definitions-tab" hidden></div>
            <div id="bw2-texts-editor" class="bw2-script-texts" role="tabpanel" aria-labelledby="bw2-texts-tab" hidden></div>
          </div>
          <aside id="bw2-map-preview" class="bw2-script-map" aria-label="Script map preview"></aside>
        </div>
      </div>
    </section>`;
  const host = root.querySelector<HTMLElement>("#bw2-source-editor");
  const definitionsHost = root.querySelector<HTMLElement>("#bw2-definitions-editor");
  const scriptTab = root.querySelector<HTMLButtonElement>("#bw2-script-tab");
  const definitionsTab = root.querySelector<HTMLButtonElement>("#bw2-definitions-tab");
  const textsTab = root.querySelector<HTMLButtonElement>("#bw2-texts-tab");
  const textsHost = root.querySelector<HTMLElement>("#bw2-texts-editor");
  const messageSidebar = root.querySelector<HTMLElement>("#bw2-message-sidebar");
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
  const entrySlot = root.querySelector<HTMLSelectElement>("#bw2-entry-slot"), entryReplacement = root.querySelector<HTMLSelectElement>("#bw2-entry-replacement"), impact = root.querySelector<HTMLElement>("#bw2-entry-impact");
  const addEntry = root.querySelector<HTMLButtonElement>("#bw2-add-entry"), removeEntry = root.querySelector<HTMLButtonElement>("#bw2-remove-entry"), clearEntry = root.querySelector<HTMLButtonElement>("#bw2-clear-entry"), addMovement = root.querySelector<HTMLButtonElement>("#bw2-add-movement"), removeMovement = root.querySelector<HTMLButtonElement>("#bw2-remove-movement");
  if (!host || !definitionsHost || !scriptTab || !definitionsTab || !selector || !applyButton || !compileButton || !status || !errorButton || !draftStatus || !title) return;

  function sourceParts(): Bw2ScriptSourceParts { return { script: partEditors.script?.getValue() ?? "", definitions: partEditors.definitions?.getValue() ?? "" }; }
  function fullCursor(part: Bw2ScriptSourcePart, cursor: Bw2ScriptCursor): Bw2ScriptCursor {
    return { ...cursor, ...bw2ScriptFullPosition(sourceParts(), part, cursor) };
  }
  function selectPart(part: Bw2ScriptSourcePart | "texts"): void {
    activePart = part;
    host!.hidden = part !== "script";
    definitionsHost!.hidden = part !== "definitions";
    if (textsHost) textsHost.hidden = part !== "texts";
    for (const [name, tab] of [["script", scriptTab], ["definitions", definitionsTab], ["texts", textsTab]] as const) {
      tab?.setAttribute("aria-selected", String(name === part));
      tab?.setAttribute("tabindex", name === part ? "0" : "-1");
    }
    if (part === "texts") return;
    partEditors[part]?.refreshLayout?.();
    const cursor = partEditors[part]?.getCursor();
    if (cursor) updateCursor(fullCursor(part, cursor));
  }
  scriptTab.addEventListener("click", () => selectPart("script"));
  definitionsTab.addEventListener("click", () => selectPart("definitions"));
  textsTab?.addEventListener("click", () => selectPart("texts"));
  const tabs = [["script", scriptTab], ["definitions", definitionsTab], ["texts", textsTab]] as const;
  for (const [, tab] of tabs) tab?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(([name]) => name === activePart);
    const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowLeft" ? 2 : 1)) % 3;
    selectPart(tabs[next][0]); tabs[next][1]?.focus();
  });

  function clearTimer(): void { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function showError(error: unknown): void {
    previewEntryMapping = undefined;
    const local = error instanceof Bw2ScriptCompileError ? bw2ScriptPartPosition(sourceParts(), error.position) : undefined;
    const section = local?.part === "definitions" ? "Definitions" : "Script";
    status!.textContent = local && error instanceof Error ? error.message.replace(/\(line \d+, column \d+\)$/, `(${section} line ${local.position.line}, column ${local.position.column})`) : error instanceof Error ? error.message : String(error);
    status!.className = "-error";
    applyButton!.disabled = true;
    if (impact) impact.hidden = true;
    lastError = error instanceof Bw2ScriptCompileError ? error.position : undefined;
    editor?.setError(lastError);
    errorButton!.hidden = !lastError;
    if (lastError && local) errorButton!.textContent = `Go to ${section} line ${local.position.line}, column ${local.position.column}`;
  }
  function showResult(result: CompiledBw2Script, applied = false): void {
    previewEntryMapping = applied ? undefined : result.entryChanges?.mapping;
    status!.className = applied ? "-success" : "";
    const proof = result.roundTrip;
    status!.textContent = applied ? `Applied script file ${fileId}. Export the ROM to use it in game.` : proof ? `Byte-identical original round trip verified. ${proof.editable ? "Compiled successfully. Ready to apply." : "Read-only import; unsupported bytes are preserved."}` : "Compiled successfully. Ready to apply to the loaded ROM.";
    status!.title = proof?.warnings.join("\n") ?? "";
    errorButton!.hidden = true;
    lastError = undefined;
    editor?.setError();
    applyButton!.disabled = proof?.editable === false;
    const editable = Boolean(state.drafts[fileId]?.imported) && proof?.editable !== false;
    for (const button of [addEntry, removeEntry, clearEntry, addMovement, removeMovement]) if (button) button.disabled = !editable;
    if (impact) {
      const change = result.entryChanges; impact.hidden = !change;
      impact.textContent = change ? `${change.oldCount} → ${change.newCount} entries · ${counted(change.references.length, "assignment")} ${applied ? "updated" : "will update"}` : "";
      if (change?.references.length) impact.innerHTML = `<p>${escapeHtml(impact.textContent)}</p><details><summary>View assignment changes</summary><ul>${change.references.map((ref) => `<li>${escapeHtml(ref.location)}: ${ref.before} → ${ref.after}</li>`).join("")}</ul></details>`;
    }
    if (editor) updateCursor(editor.getCursor());
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
    const overlayId = state.drafts[fileId]?.imported?.overlayId ?? (overlaySelector?.value === "auto" ? overlayContext?.overlayId : overlaySelector?.value ? Number(overlaySelector.value) : undefined);
    const focus = sourceContext.focusAt(cursor.line);
    if (entrySlot && focus?.kind === "script" && focus.entries.length) entrySlot.value = String(focus.entries[0]);
    if (sectionSelect) sectionSelect.value = focus?.line.toString() ?? "";
    const mapFocus = focus && previewEntryMapping ? { ...focus, entries: previewEntryMapping.flatMap((entry, index) => focus.entries.includes(entry) ? [index + 1] : []) } : focus;
    mapPreview?.setFocus(mapFocus, cursor.text, overlayId, sourceContext.constantBindings);
    const call = sourceContext.callAt(cursor.line);
    const message = bw2ScriptMessageReference(call, sourceContext.constantBindings, overlayId);
    if (message && !message.reason) {
      const variables = bw2ScriptWordLimits(project, sourceContext.callsBefore(cursor.line), sourceContext.constantBindings);
      if (Object.keys(variables).length) message.variables = variables;
    }
    texts?.setReference(message);
    const workId = sourceContext.workBindings.get(cursor.word);
    if (help && workId !== undefined) {
      const work = bw2WorkAlias(workId);
      help.innerHTML = `<code class="bw2-command-name">${escapeHtml(cursor.word)}</code><span class="bw2-command-opcode">Work 0x${workId.toString(16).padStart(4, "0")} · ${escapeHtml(work.scope)} · integer</span><p>${escapeHtml(work.description)}</p>
        ${work.scope !== "unknown" && cursor.word !== work.name ? `<p>Catalog name: <code>${escapeHtml(work.name)}</code></p>` : ""}<p class="bw2-command-note">Work variables store numbers. Compare a stage with == or !=; flag_set? reads the separate event-flag storage.</p>`;
      return;
    }
    const command = focus?.kind === "movement" ? bw2MovementCommandHelp(cursor.word) : bw2ScriptCommandHelp(cursor.word, overlayId) ?? (call ? bw2ScriptCommandHelp(call.name, overlayId) : undefined);
    if (!help) return;
    if (!command) { help.textContent = "Click a command or work name in the source to see its meaning."; return; }
    help.innerHTML = `<code class="bw2-command-name">${escapeHtml(command.name)}</code><span class="bw2-command-opcode">${command.macro ? `Macro · ${command.commandCount} commands` : `${focus?.kind === "movement" ? "Movement" : "Opcode"} ${command.name === "raw_step" ? "record" : `0x${command.opcode.toString(16).padStart(4, "0")}`}`}</span><p>${escapeHtml(command.description)}</p>
      ${command.parameters.length ? `<ol>${command.parameters.map((parameter) => `<li><strong>${escapeHtml(parameter.name)}</strong> <span class="bw2-command-width">${parameter.width * 8} bit</span><p>${escapeHtml(parameter.description)}</p></li>`).join("")}</ol>` : "<p>No arguments.</p>"}
      ${command.note ? `<p class="bw2-command-note">${escapeHtml(command.note)}</p>` : ""}`;
  }
  function updateSourceIndex(source: string): void {
    sourceContext = buildBw2ScriptSourceContext(source);
    if (sectionSelect) sectionSelect.innerHTML = '<option value="">Jump to entry, helper or movement…</option>' + sourceContext.definitions.map((definition) => `<option value="${definition.line}">${escapeHtml(definition.kind === "script" ? `Entry ${definition.entries[0] ?? "?"}: ${definition.name}` : `${definition.kind === "helper" ? "Helper" : definition.kind === "movement" ? "Movement" : "Block"}: ${definition.name}`)}</option>`).join("");
    try {
      const entries = compileBw2Script(source).entries, selected = entrySlot?.value, replacement = entryReplacement?.value;
      const choices = entries.map((entry) => `<option value="${entry.entry}">${entry.entry}: ${escapeHtml(entry.name)}</option>`).join("");
      if (entrySlot) { entrySlot.innerHTML = choices; entrySlot.value = entries.some((entry) => String(entry.entry) === selected) ? selected! : String(entries.at(-1)?.entry ?? ""); }
      if (entryReplacement) { entryReplacement.innerHTML = '<option value="0">No script — detach events</option>' + choices; entryReplacement.value = entries.some((entry) => String(entry.entry) === replacement) ? replacement! : "0"; }
    } catch { /* Keep the last useful entry choices during incomplete edits. */ }
  }
  function stageStructure(edit: Bw2ScriptStructureEdit): void {
    const previous = compileBw2ProjectScript(project, fileId, editor!.getValue()).entryChanges?.mapping ?? gen5ScriptEntries(scripts!.rawFiles[fileId]).map((_, index) => index + 1);
    const mapping = edit.mapping ? previous.map((entry) => entry === 0 ? 0 : edit.mapping![entry - 1]) : previous;
    const compiled = compileBw2ProjectScript(project, fileId, edit.source, { entryMapping: mapping });
    editor!.setValue(edit.source); saveBw2ScriptDraft(project, fileId, edit.source);
    state.drafts[fileId].entryMapping = mapping;
    state.drafts[fileId].entryMappingSignature = bw2EntryTableSignature(compiled);
    options.onDraftChange(); editor!.focusError(edit.position); validate();
  }
  addEntry?.addEventListener("click", () => { try { if (!stopped && editor) stageStructure(addBw2ScriptEntry(editor.getValue())); } catch (error) { showError(error); } });
  clearEntry?.addEventListener("click", () => { try { if (!stopped && editor) stageStructure(clearBw2ScriptEntry(editor.getValue(), Number(entrySlot?.value))); } catch (error) { showError(error); } });
  removeEntry?.addEventListener("click", async () => {
    const selectedFile = fileId;
    try {
      await prepareBw2ScriptEntryResources(project);
      if (stopped || selectedFile !== fileId || !editor) return;
      stageStructure(removeBw2ScriptEntry(editor.getValue(), Number(entrySlot?.value), Number(entryReplacement?.value ?? 0)));
    } catch (error) { if (!stopped && selectedFile === fileId) showError(error); }
  });
  addMovement?.addEventListener("click", () => { try { if (!stopped && editor) stageStructure(addBw2ScriptMovement(editor.getValue())); } catch (error) { showError(error); } });
  removeMovement?.addEventListener("click", () => {
    try { const focus = editor && sourceContext.focusAt(editor.getCursor().line); if (focus?.kind !== "movement") throw new Error("Place the cursor in the movement definition to remove it."); stageStructure(removeBw2ScriptMovement(editor!.getValue(), focus.name)); } catch (error) { showError(error); }
  });
  function navigateMovement(cursor: Bw2ScriptCursor): boolean {
    if (stopped) return false;
    const overlayId = state.drafts[fileId]?.imported?.overlayId ?? (overlaySelector?.value ? Number(overlaySelector.value) : undefined);
    const target = bw2ScriptMovementReferenceAt(cursor.text, cursor.column, overlayId);
    const position = target ? sourceContext.movementDefinition(target) : undefined;
    if (!position) return false;
    editor?.focusError(position); return true;
  }
  sectionSelect?.addEventListener("change", () => {
    const line = Number(sectionSelect.value);
    if (line > 0 && sourceContext.definitions.some((definition) => definition.line === line)) editor?.focusError({ line, column: 1 });
  });
  function openFile(): void {
    previewEntryMapping = undefined;
    clearTimer();
    editor?.destroy();
    mapPreview?.destroy();
    texts?.destroy();
    texts = messageSidebar && textsHost ? installBw2ScriptTexts(project, messageSidebar, textsHost, fileId, options.onApply, () => selectPart("texts")) : undefined;
    mapPreview = mapHost ? installBw2ScriptMapPreview(project, mapHost, fileId) : undefined;
    if (help) help.textContent = "Click a command or work name in the source to see its meaning.";
    overlayContext = resolveBw2ScriptOverlay(project, fileId);
    if (overlaySelector) {
      const importedId = state.drafts[fileId]?.imported?.overlayId;
      overlaySelector.value = importedId !== undefined && importedId !== overlayContext.overlayId ? String(importedId) : "auto";
      overlaySelector.title = overlayContext.description;
      const auto = overlaySelector.querySelector<HTMLOptionElement>('option[value="auto"]');
      if (auto) auto.textContent = overlayContext.kind === "detected" ? `Auto — Overlay ${overlayContext.overlayId}` : overlayContext.kind === "base" ? "Auto — Base commands" : overlayContext.kind === "ambiguous" ? "Auto — Conflicting maps" : "Auto — Context unavailable";
    }
    const count = gen5ScriptEntries(scripts!.rawFiles[fileId]).length;
    title!.textContent = `Script file ${fileId}`;
    errorButton!.hidden = true;
    lastError = undefined;
    status!.className = "";
    status!.textContent = "Decompile from ROM or write a complete script to begin.";
    draftStatus!.textContent = state.drafts[fileId] ? "Source draft" : "No authored source";
    applyButton!.disabled = true;
    for (const button of [addEntry, removeEntry, clearEntry, addMovement, removeMovement]) if (button) button.disabled = true;
    if (impact) impact.hidden = true;
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
    partEditors.script = installBw2ScriptCodeEditor(host!, parts.script, changed, (cursor) => { if (!settingSource && activePart === "script") updateCursor(fullCursor("script", cursor)); }, { bindingSource: () => joinBw2ScriptSource(sourceParts()), onNavigate: navigateMovement });
    partEditors.definitions = installBw2ScriptCodeEditor(definitionsHost!, parts.definitions, changed, (cursor) => { if (!settingSource && activePart === "definitions") updateCursor(fullCursor("definitions", cursor)); }, { bindingSource: () => joinBw2ScriptSource(sourceParts()), label: "BW2 script definitions", onNavigate: navigateMovement });
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
      getCursor: () => { const part = activePart === "texts" ? "script" : activePart; return fullCursor(part, partEditors[part]!.getCursor()); },
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
      const result = decompileBw2ProjectScript(project, fileId, overlaySelector?.value === "auto" ? {} : { overlayId: overlaySelector?.value ? Number(overlaySelector.value) : undefined });
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
      if (result.entryChanges?.references.length && mapHost) { mapPreview?.destroy(); mapPreview = installBw2ScriptMapPreview(project, mapHost, fileId); updateCursor(editor.getCursor()); }
    } catch (error) { showError(error); }
  });
  errorButton.addEventListener("click", () => { if (lastError) editor?.focusError(lastError); });
  dispose = () => { stopped = true; clearTimer(); editor?.destroy(); mapPreview?.destroy(); texts?.destroy(); editor = undefined; mapPreview = undefined; texts = undefined; };
  openFile();
}
