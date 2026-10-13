import type { ProjectState } from "../pokeweb/projectStore";
import { bw2ScriptDisplayText, bw2ScriptTextBanks, bw2ScriptTextEntries, updateBw2ScriptText, type Bw2ScriptMessageReference, type Bw2ScriptTextBank } from "../pokeweb/bw2ScriptTextModel";
import { escapeHtml } from "./dom";
import { installBw2DialoguePreview, type Bw2DialoguePreview } from "./bw2DialoguePreview";
import type { DialogueVariables } from "../pokeweb/bw2DialoguePreview";

export type Bw2ScriptTexts = { setReference: (reference?: Bw2ScriptMessageReference) => void; destroy: () => void };

/** The sidebar and bank browser share project text data, never a second copy of a bank. */
export function installBw2ScriptTexts(project: ProjectState, sidebar: HTMLElement, panel: HTMLElement, fileId: number, onDirty: () => void, onShowTexts: () => void): Bw2ScriptTexts {
  let stopped = false;
  let banks: Bw2ScriptTextBank[] = [];
  let contextError = "";
  try { banks = bw2ScriptTextBanks(project, fileId); }
  catch (error) { contextError = error instanceof Error ? error.message : String(error); }
  let bankId = banks[0]?.bankId;
  let reference: Bw2ScriptMessageReference | undefined;
  let referenceKey = "";
  let block = 0;
  let previewSelected = false;
  let preview: Bw2DialoguePreview | undefined;
  const variableHints = new Map<string, DialogueVariables>();
  const drafts = new Map<string, { before: string; value: string }>();
  const bankLabel = (bank: Bw2ScriptTextBank): string => `Bank ${bank.bankId}${bank.maps.length ? ` — ${bank.maps.map((map) => `${map.name} (Zone ${map.zoneId})`).join(", ")}` : " — explicit command reference"}`;

  panel.innerHTML = `<div class="bw2-text-toolbar"><label for="bw2-text-bank">Associated story text bank</label><select id="bw2-text-bank" aria-label="Associated story text bank"></select><label for="bw2-text-search">Search this bank</label><input id="bw2-text-search" type="search" placeholder="Text or entry ID" autocomplete="off"></div><p id="bw2-text-context" class="bw2-text-context"></p><div id="bw2-text-entries" class="bw2-text-entries"></div>`;
  const bankSelect = panel.querySelector<HTMLSelectElement>("#bw2-text-bank");
  const search = panel.querySelector<HTMLInputElement>("#bw2-text-search");
  const context = panel.querySelector<HTMLElement>("#bw2-text-context");
  const list = panel.querySelector<HTMLElement>("#bw2-text-entries");
  function renderEntries(): void {
    if (stopped || !list) return;
    try {
      if (bankId === undefined) { list.textContent = contextError || `No map header assigns a story text bank to script file ${fileId}.`; return; }
      const entries = bw2ScriptTextEntries(project, bankId);
      const query = search?.value.toLocaleLowerCase() ?? "";
      const blocks = new Set(entries.map((entry) => entry.block));
      const matching = entries.filter((entry) => !query || entry.value[1].toLocaleLowerCase().includes(query) || `${entry.entry} ${entry.value[0]}`.includes(query));
      list.innerHTML = matching.length ? matching.map(({ entry, block, value }) => `<button type="button" class="bw2-text-entry" data-text-entry="${escapeHtml(value[0])}"><strong>Entry ${entry}${blocks.size > 1 ? ` · Block ${block}` : ""}</strong><span>${escapeHtml(bw2ScriptDisplayText(value[1]))}</span></button>`).join("") : '<p class="bw2-text-context">No matching entries.</p>';
    } catch (error) { list.textContent = error instanceof Error ? error.message : String(error); }
  }
  function renderBanks(): void {
    if (bankSelect) { bankSelect.innerHTML = banks.map((bank) => `<option value="${bank.bankId}">${escapeHtml(bankLabel(bank))}</option>`).join(""); bankSelect.value = bankId === undefined ? "" : String(bankId); bankSelect.disabled = !banks.length; }
    if (context) context.textContent = banks.find((bank) => bank.bankId === bankId)?.maps.map((map) => `${map.name} · Zone ${map.zoneId}`).join("; ") ?? "";
    renderEntries();
  }
  function openEntry(selectedBank: number, entryId: string): void {
    if (stopped) return;
    preview?.destroy(); preview = undefined;
    try {
      const entries = bw2ScriptTextEntries(project, selectedBank);
      const entry = entries.find((entry) => entry.value[0] === entryId);
      if (!entry) throw new Error(`Text entry ${entryId} is missing from bank ${selectedBank}.`);
      const key = `${selectedBank}:${entryId}`;
      if (reference?.variables) variableHints.set(key, reference.variables);
      const draft = drafts.get(key) ?? { before: entry.value[1], value: entry.value[1] };
      drafts.set(key, draft);
      sidebar.hidden = false;
      sidebar.innerHTML = `<h2>Dialogue text</h2><p class="bw2-text-context">Story bank ${selectedBank} · Entry ${entry.entry}${new Set(entries.map((entry) => entry.block)).size > 1 ? ` · Block ${entry.block}` : ""}</p>
        ${reference?.defaultBank && banks.length > 1 ? `<label for="bw2-message-bank">Map-specific bank</label><select id="bw2-message-bank">${banks.map((bank) => `<option value="${bank.bankId}" ${bank.bankId === selectedBank ? "selected" : ""}>${escapeHtml(bankLabel(bank))}</option>`).join("")}</select>` : ""}
        ${new Set(entries.map((entry) => entry.block)).size > 1 ? `<label for="bw2-message-block">Text block</label><select id="bw2-message-block">${[...new Set(entries.map((entry) => entry.block))].map((id) => `<option value="${id}" ${id === entry.block ? "selected" : ""}>Block ${id}</option>`).join("")}</select>` : ""}
        <div class="bw2-script-tabs bw2-message-tabs" role="tablist" aria-label="Dialogue editor views"><button type="button" role="tab" id="bw2-message-text-tab" aria-controls="bw2-message-edit-pane" aria-selected="true">Text</button><button type="button" role="tab" id="bw2-message-preview-tab" aria-controls="bw2-message-preview-pane" aria-selected="false" tabindex="-1">Preview</button></div>
        <div id="bw2-message-edit-pane" role="tabpanel" aria-labelledby="bw2-message-text-tab"><label for="bw2-message-text">Stored text</label><textarea id="bw2-message-text" aria-label="Dialogue text" spellcheck="false" rows="8">${escapeHtml(draft.value)}</textarea><p class="bw2-text-controls">Keep VAR(...) and \\n, \\r, \\f controls intact.</p></div>
        <div id="bw2-message-preview-pane" class="bw2-dialogue-preview" role="tabpanel" aria-labelledby="bw2-message-preview-tab" hidden></div>
        <div class="bw2-text-actions"><button type="button" id="bw2-message-save" class="btn -primary">Save text</button><button type="button" id="bw2-message-open-bank" class="btn -default">View bank</button></div><p id="bw2-message-status" class="bw2-text-context" role="status">${draft.value !== draft.before ? "Text draft · not saved" : ""}</p>`;
      const field = sidebar.querySelector<HTMLTextAreaElement>("#bw2-message-text");
      const notice = sidebar.querySelector<HTMLElement>("#bw2-message-status");
      const editPane = sidebar.querySelector<HTMLElement>("#bw2-message-edit-pane"), previewPane = sidebar.querySelector<HTMLElement>("#bw2-message-preview-pane");
      const textTab = sidebar.querySelector<HTMLButtonElement>("#bw2-message-text-tab"), previewTab = sidebar.querySelector<HTMLButtonElement>("#bw2-message-preview-tab");
      if (previewPane) preview = installBw2DialoguePreview(project, previewPane, () => field?.value ?? draft.value, () => variableHints.get(key) ?? {});
      const selectView = (selected: boolean) => {
        previewSelected = selected;
        if (editPane) editPane.hidden = selected;
        if (previewPane) previewPane.hidden = !selected;
        textTab?.setAttribute("aria-selected", String(!selected)); textTab?.setAttribute("tabindex", selected ? "-1" : "0");
        previewTab?.setAttribute("aria-selected", String(selected)); previewTab?.setAttribute("tabindex", selected ? "0" : "-1");
        if (selected) preview?.show();
      };
      textTab?.addEventListener("click", () => selectView(false)); previewTab?.addEventListener("click", () => selectView(true));
      for (const tab of [textTab, previewTab]) tab?.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); selectView(event.key === "Home" ? false : event.key === "End" ? true : !previewSelected); (previewSelected ? previewTab : textTab)?.focus();
      });
      selectView(previewSelected);
      field?.addEventListener("input", () => { draft.value = field.value; preview?.refresh(); if (notice) { notice.className = "bw2-text-context"; notice.textContent = draft.value === draft.before ? "" : "Text draft · not saved"; } });
      sidebar.querySelector<HTMLButtonElement>("#bw2-message-save")?.addEventListener("click", () => {
        if (stopped || !field) return;
        try {
          const changed = draft.before !== field.value;
          updateBw2ScriptText(project, selectedBank, entryId, draft.before, field.value);
          draft.before = field.value; draft.value = field.value;
          if (notice) { notice.className = "bw2-text-context -success"; notice.textContent = "Saved to the project. Export the ROM to use it in game."; }
          renderEntries();
          if (changed) onDirty();
        } catch (error) { if (notice) { notice.className = "bw2-text-context -error"; notice.textContent = error instanceof Error ? error.message : String(error); } }
      });
      sidebar.querySelector<HTMLButtonElement>("#bw2-message-open-bank")?.addEventListener("click", () => {
        if (!banks.some((bank) => bank.bankId === selectedBank)) banks.push({ bankId: selectedBank, maps: [] });
        bankId = selectedBank; if (search) search.value = "";
        renderBanks(); onShowTexts();
      });
      sidebar.querySelector<HTMLSelectElement>("#bw2-message-bank")?.addEventListener("change", (event) => {
        bankId = Number((event.target as HTMLSelectElement).value); block = 0;
        renderBanks(); renderReference();
      });
      sidebar.querySelector<HTMLSelectElement>("#bw2-message-block")?.addEventListener("change", (event) => { block = Number((event.target as HTMLSelectElement).value); renderReference(); });
    } catch (error) { sidebar.hidden = false; sidebar.textContent = error instanceof Error ? error.message : String(error); }
  }
  function renderReference(): void {
    preview?.destroy(); preview = undefined;
    if (!reference) { sidebar.hidden = true; sidebar.innerHTML = ""; return; }
    const selectedBank = reference.defaultBank ? (banks.find((bank) => bank.bankId === bankId && bank.maps.length)?.bankId ?? banks.find((bank) => bank.maps.length)?.bankId) : reference.bankId;
    let reason = reference.reason;
    if (!reason && selectedBank === undefined) reason = contextError || "No assigned header supplies the default bank. A global script may use its caller's bank.";
    if (reason) { sidebar.hidden = false; sidebar.innerHTML = `<h2>Dialogue text</h2><p>${escapeHtml(reason)}</p>`; return; }
    try {
      const entry = bw2ScriptTextEntries(project, selectedBank!).find((entry) => entry.entry === reference!.entryId && entry.block === block);
      if (!entry) throw new Error(`Entry ${reference.entryId} is missing from story bank ${selectedBank}, block ${block}.`);
      openEntry(selectedBank!, entry.value[0]);
    } catch (error) { sidebar.hidden = false; sidebar.innerHTML = `<h2>Dialogue text</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
  }
  bankSelect?.addEventListener("change", () => { bankId = Number(bankSelect.value); block = 0; renderBanks(); if (reference?.defaultBank) renderReference(); });
  search?.addEventListener("input", renderEntries);
  list?.addEventListener("click", (event) => {
    const entryId = (event.target as HTMLElement).closest<HTMLElement>("[data-text-entry]")?.dataset.textEntry;
    if (entryId !== undefined && bankId !== undefined) { reference = undefined; referenceKey = "manual"; openEntry(bankId, entryId); }
  });
  sidebar.hidden = true;
  renderBanks();
  return { setReference: (next) => {
    if (stopped) return;
    const key = JSON.stringify(next) ?? "";
    if (key === referenceKey) return;
    referenceKey = key; reference = next; block = 0; renderReference();
  }, destroy: () => { stopped = true; preview?.destroy(); drafts.clear(); variableHints.clear(); } };
}
