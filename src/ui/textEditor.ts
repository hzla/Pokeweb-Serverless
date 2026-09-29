import {
  addTextEntries,
  applyTextReplacement,
  deleteLastTextEntries,
  getTextBank,
  getTextBankCount,
  getTextBankSummaries,
  parseTextEntryId,
  previewTextReplacement,
  updateTextEntry,
  type TextNarcName,
  type TextReplacementMode,
  type TextReplacementPlan,
} from "../pokeweb/textModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { Gen5TextEntry } from "../pokeweb/text";
import { escapeHtml, selectText } from "./dom";

const TEXT_BANK_STORAGE_KEY_PREFIX = "pokeweb-serverless-active-text-bank";

export function renderTextEditor(project: ProjectState, root: HTMLElement, narcName: TextNarcName, title: string, onDirty?: () => void): void {
  let selectedBank = loadRememberedTextBank(narcName, getTextBankCount(project, narcName));
  let searchText = "";
  let ignoreCase = false;
  let findText = "";
  let replacementText = "";
  let replacementMode: TextReplacementMode = "ignore-case";
  let replacementScope = selectedBank === undefined ? "all" : "bank";
  let lastMatch: TextReplacementPlan["matches"][number] | undefined;
  let replacementNotice = "";

  const renderList = (remember = true) => {
    selectedBank = undefined;
    if (remember) rememberTextBank(narcName, undefined);
    root.innerHTML = `
      <div class="pokemon-filter text-filter">
        <div class="filter-title">Search Text</div>
        <input class="filter-input" id="search-textbanks" value="${escapeHtml(searchText)}"/>
        <label class="container filter-check">
          <div class="filter-label">Ignore Case?</div>
          <input class="ignore-case" type="checkbox" ${ignoreCase ? "checked" : ""}>
          <span class="checkmark"></span>
        </label>
        <button class="btn -default" id="search-textbanks-btn" type="button">Search</button>
      </div>
      <div class="pokemon-list spreadsheet" id="texts" data-narc="${narcName}">
        ${renderReplacementControls()}
        ${getTextBankSummaries(project, narcName, searchText, ignoreCase).map((summary) => renderBankSummary(summary.id, summary.preview)).join("")}
      </div>
    `;
    attachListHandlers();
    attachReplacementHandlers();
  };

  const renderDetail = (bankId: number, remember = true) => {
    selectedBank = bankId;
    if (remember) rememberTextBank(narcName, bankId);
    const bank = getTextBank(project, narcName, bankId);
    root.innerHTML = `
      <div class="pokemon-filter text-filter">
        <div class="filter-title">Bank ${bankId}</div>
        <button class="btn -default" id="back-textbanks" type="button">${title}</button>
        <div class="sidebar-btns">
          <div class="sb-btn" id="add-text">Add Text(s)</div>
          <input class="sb-field" id="add-text-count" value="1">
        </div>
        <div class="sidebar-btns">
          <div class="sb-btn" id="del-text">Del Last Text(s)</div>
          <input class="sb-field" id="del-text-count" value="1">
        </div>
      </div>
      <div class="pokemon-list spreadsheet text-detail-list" id="texts" data-narc="${narcName}" data-index="${bankId}">
        ${renderReplacementControls()}
        ${bank.map((entry, flatIndex) => renderTextEntry(entry, flatIndex)).join("")}
      </div>
    `;
    attachDetailHandlers(bankId);
    attachReplacementHandlers();
  };

  function renderReplacementControls(): string {
    return `
      <form class="text-replace" aria-label="Find and replace">
        <h2>Find and replace</h2>
        <div class="text-replace-fields">
          <label>Find<input id="text-find" value="${escapeHtml(findText)}" autocomplete="off" spellcheck="false"></label>
          <label>Replace with<input id="text-replacement" value="${escapeHtml(replacementText)}" autocomplete="off" spellcheck="false" placeholder="Leave empty to delete matches"></label>
          <label>Matching<select id="text-replacement-mode">
            <option value="ignore-case" ${replacementMode === "ignore-case" ? "selected" : ""}>Ignore case</option>
            <option value="match-case" ${replacementMode === "match-case" ? "selected" : ""}>Match case</option>
            <option value="capitalization-aware" ${replacementMode === "capitalization-aware" ? "selected" : ""}>Capitalization aware</option>
          </select></label>
          <label>Search in<select id="text-replacement-scope">
            ${selectedBank === undefined ? "" : `<option value="bank" ${replacementScope === "bank" ? "selected" : ""}>Current bank (${selectedBank})</option>`}
            <option value="all" ${replacementScope === "all" || selectedBank === undefined ? "selected" : ""}>All ${escapeHtml(title)} banks</option>
          </select></label>
        </div>
        <p class="text-replace-help">Finds literal text, including parts of words. Capitalization aware matches any case and preserves UPPERCASE, lowercase, and Title Case. Mixed case uses your replacement as typed.</p>
        <div class="text-replace-actions">
          <button class="btn -default" id="text-find-next" type="button">Find next</button>
          <button class="btn -default" id="text-replace-all" type="submit">Replace all…</button>
          <span id="text-replace-count" role="status" aria-live="polite"></span>
        </div>
        <p id="text-replace-notice" role="status">${escapeHtml(replacementNotice)}</p>
      </form>
      <dialog class="text-replace-confirm" aria-labelledby="text-replace-confirm-title" aria-describedby="text-replace-confirm-summary">
        <h2 id="text-replace-confirm-title">Confirm replacements</h2>
        <p id="text-replace-confirm-summary"></p>
        <pre id="text-replace-confirm-details"></pre>
        <div class="text-replace-actions">
          <button class="btn -default" id="text-replace-cancel" type="button" autofocus>Cancel</button>
          <button class="btn -default" id="text-replace-confirm-apply" type="button">Apply replacements</button>
        </div>
      </dialog>
    `;
  }

  function replacementPreview(): TextReplacementPlan {
    return previewTextReplacement(project, narcName, findText, replacementText, replacementMode, replacementScope === "bank" ? selectedBank : undefined);
  }

  function replacementSummary(plan: TextReplacementPlan): string {
    return `${plan.replacementCount} replacement${plan.replacementCount === 1 ? "" : "s"} in ${plan.changes.length} text entr${plan.changes.length === 1 ? "y" : "ies"} across ${plan.bankCount} bank${plan.bankCount === 1 ? "" : "s"}`;
  }

  function updateReplacementPreview(): void {
    const plan = replacementPreview();
    const status = root.querySelector<HTMLElement>("#text-replace-count");
    if (status) status.textContent = !findText ? "Enter text to find."
      : plan.matches.length === 0 ? "No matches found."
        : `${plan.matches.length} match${plan.matches.length === 1 ? "" : "es"}; ${replacementSummary(plan)}.`;
    const replaceButton = root.querySelector<HTMLButtonElement>("#text-replace-all");
    if (replaceButton) replaceButton.disabled = plan.replacementCount === 0;
    const findButton = root.querySelector<HTMLButtonElement>("#text-find-next");
    if (findButton) findButton.disabled = plan.matches.length === 0;
  }

  function attachReplacementHandlers(): void {
    const form = root.querySelector<HTMLFormElement>(".text-replace");
    const dialog = root.querySelector<HTMLDialogElement>(".text-replace-confirm");
    let pendingPlan: TextReplacementPlan | undefined;
    const readInputs = () => {
      findText = root.querySelector<HTMLInputElement>("#text-find")?.value ?? "";
      replacementText = root.querySelector<HTMLInputElement>("#text-replacement")?.value ?? "";
      replacementMode = (root.querySelector<HTMLSelectElement>("#text-replacement-mode")?.value ?? "ignore-case") as TextReplacementMode;
      replacementScope = root.querySelector<HTMLSelectElement>("#text-replacement-scope")?.value ?? "all";
      lastMatch = undefined;
      replacementNotice = "";
      const notice = root.querySelector<HTMLElement>("#text-replace-notice");
      if (notice) notice.textContent = "";
      updateReplacementPreview();
    };
    form?.addEventListener("input", readInputs);
    form?.addEventListener("change", readInputs);
    // Enter in a search field finds the next match; replacing is an explicit action.
    form?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        findNext();
      }
    });
    root.querySelector<HTMLButtonElement>("#text-find-next")?.addEventListener("click", findNext);
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const plan = replacementPreview();
      if (plan.replacementCount === 0) return;
      const scope = replacementScope === "bank" && selectedBank !== undefined ? `${title}, bank ${selectedBank}` : `all ${title} banks`;
      const summary = root.querySelector<HTMLElement>("#text-replace-confirm-summary");
      const details = root.querySelector<HTMLElement>("#text-replace-confirm-details");
      if (summary) summary.textContent = `Make ${replacementSummary(plan)} in ${scope}?`;
      if (details) details.textContent = `Find: ${findText}\nReplace with: ${replacementText || "(empty text)"}\nMatching: ${replacementMode === "capitalization-aware" ? "Capitalization aware" : replacementMode === "match-case" ? "Match case" : "Ignore case"}`;
      pendingPlan = plan;
      dialog?.showModal();
    });
    root.querySelector<HTMLButtonElement>("#text-replace-cancel")?.addEventListener("click", () => dialog?.close());
    dialog?.addEventListener("close", () => { pendingPlan = undefined; });
    root.querySelector<HTMLButtonElement>("#text-replace-confirm-apply")?.addEventListener("click", () => {
      const plan = pendingPlan;
      if (!plan) return;
      pendingPlan = undefined;
      dialog?.close();
      try {
        applyTextReplacement(project, plan);
      } catch (error) {
        replacementNotice = `No replacements were made. ${error instanceof Error ? error.message : String(error)}`;
        const notice = root.querySelector<HTMLElement>("#text-replace-notice");
        if (notice) notice.textContent = replacementNotice;
        return;
      }
      replacementNotice = `Applied ${replacementSummary(plan)}.`;
      lastMatch = undefined;
      onDirty?.();
      if (selectedBank === undefined) renderList(false);
      else renderDetail(selectedBank, false);
    });
    updateReplacementPreview();
  }

  function findNext(): void {
    const { matches } = replacementPreview();
    if (matches.length === 0) return;
    const previous = matches.findIndex((match) => match.bankId === lastMatch?.bankId && match.entryIndex === lastMatch.entryIndex && match.offset === lastMatch.offset);
    const match = matches[(previous + 1) % matches.length];
    lastMatch = match;
    if (selectedBank !== match.bankId) renderDetail(match.bankId);
    const field = root.querySelector<HTMLElement>(`.text-line[data-entry-index="${match.entryIndex}"]`);
    if (!field?.firstChild) return;
    field.focus();
    field.scrollIntoView({ block: "center" });
    const range = document.createRange();
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const end = offset + (node.textContent?.length ?? 0);
      if (!started && match.offset < end) {
        range.setStart(node, match.offset - offset);
        started = true;
      }
      if (started && match.offset + match.length <= end) {
        range.setEnd(node, match.offset + match.length - offset);
        break;
      }
      offset = end;
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function attachListHandlers(): void {
    const input = root.querySelector<HTMLInputElement>("#search-textbanks");
    const checkbox = root.querySelector<HTMLInputElement>(".ignore-case");
    const searchButton = root.querySelector<HTMLButtonElement>("#search-textbanks-btn");
    const search = () => {
      searchText = input?.value ?? "";
      ignoreCase = checkbox?.checked ?? false;
      renderList(false);
    };
    searchButton?.addEventListener("click", search);
    input?.addEventListener("keypress", (event) => {
      if (event.key === "Enter") search();
    });
    root.querySelectorAll<HTMLElement>(".text-header[data-bank-id]").forEach((header) => {
      header.addEventListener("click", () => {
        replacementScope = "bank";
        lastMatch = undefined;
        renderDetail(Number(header.dataset.bankId));
      });
    });
  }

  function attachDetailHandlers(bankId: number): void {
    root.querySelector<HTMLButtonElement>("#back-textbanks")?.addEventListener("click", () => {
      replacementScope = "all";
      lastMatch = undefined;
      renderList();
    });
    root.querySelector<HTMLButtonElement>("#add-text")?.addEventListener("click", () => {
      addTextEntries(project, narcName, bankId, readCount("#add-text-count"));
      onDirty?.();
      renderDetail(bankId, false);
    });
    root.querySelector<HTMLButtonElement>("#del-text")?.addEventListener("click", () => {
      deleteLastTextEntries(project, narcName, bankId, readCount("#del-text-count"));
      onDirty?.();
      renderDetail(bankId, false);
    });

    root.querySelectorAll<HTMLElement>(".text-line[contenteditable='true']").forEach((field) => {
      let initialValue = field.textContent ?? "";
      field.addEventListener("mousedown", () => {
        initialValue = field.textContent ?? "";
      });
      field.addEventListener("click", () => selectText(field));
      field.addEventListener("focusout", () => {
        if (selectedBank === undefined) return;
        const flatIndex = Number(field.dataset.entryIndex);
        const nextValue = field.textContent ?? "";
        if (!Number.isInteger(flatIndex) || nextValue === initialValue) return;
        try {
          updateTextEntry(project, narcName, selectedBank, flatIndex, nextValue);
          field.classList.remove("invalid");
          field.style.border = "";
          onDirty?.();
          initialValue = nextValue;
          updateReplacementPreview();
        } catch {
          field.textContent = initialValue;
          field.classList.add("invalid");
          field.style.border = "1px solid red";
        }
      });
    });
  }

  function readCount(selector: string): number {
    const value = Number(root.querySelector<HTMLInputElement>(selector)?.value ?? "1");
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 50) : 1;
  }

  if (selectedBank === undefined) renderList(false);
  else renderDetail(selectedBank, false);
}

function loadRememberedTextBank(narcName: TextNarcName, bankCount: number): number | undefined {
  try {
    const value = globalThis.localStorage?.getItem(textBankStorageKey(narcName));
    if (value === null || value === undefined) return undefined;
    const bankId = Number(value);
    if (Number.isSafeInteger(bankId) && bankId >= 0 && bankId < bankCount) return bankId;
    globalThis.localStorage?.removeItem(textBankStorageKey(narcName));
  } catch {
    // Storage may be unavailable in private or constrained browser contexts.
  }
  return undefined;
}

function rememberTextBank(narcName: TextNarcName, bankId: number | undefined): void {
  try {
    const key = textBankStorageKey(narcName);
    if (bankId === undefined) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, String(bankId));
  } catch {
    // The editor remains usable without persistent UI state.
  }
}

function textBankStorageKey(narcName: TextNarcName): string {
  return `${TEXT_BANK_STORAGE_KEY_PREFIX}:${narcName}`;
}

function renderBankSummary(bankId: number, entries: Gen5TextEntry[]): string {
  return `
    <div class="expanded-field filterable text-header" data-bank-id="${bankId}" data-index="${bankId}">
      <div class="expanded-field-main">
        <div class="log-text">Text Bank ${bankId}</div>
      </div>
    </div>
    <div class="text-bank">
      ${entries.map((entry) => renderPreviewEntry(entry)).join("")}
    </div>
  `;
}

function renderPreviewEntry(entry: Gen5TextEntry): string {
  const meta = parseTextEntryId(entry[0]);
  return `
    <div class="expanded-field filterable">
      <div class="expanded-field-main">
        <div class="msg-id">MSG ${meta.entry}</div>
        <div class="log-text">${escapeHtml(entry[1])}</div>
      </div>
    </div>
  `;
}

function renderTextEntry(entry: Gen5TextEntry, flatIndex: number): string {
  const meta = parseTextEntryId(entry[0]);
  return `
    <div class="expanded-field filterable text-header">
      <div class="expanded-field-main">
        <div class="log-text">MSG ${meta.block === 0 ? meta.entry : `${meta.block}_${meta.entry}`}</div>
      </div>
    </div>
    <div class="text-bank" data-index="${meta.entry}">
      <div class="expanded-field filterable">
        <div class="expanded-field-main">
          <div class="log-text text-line" data-entry-index="${flatIndex}" contenteditable="true">${escapeHtml(entry[1])}</div>
        </div>
      </div>
    </div>
  `;
}
