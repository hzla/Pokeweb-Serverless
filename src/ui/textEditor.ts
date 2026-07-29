import {
  addTextEntries,
  deleteLastTextEntries,
  getTextBank,
  getTextBankCount,
  getTextBankSummaries,
  parseTextEntryId,
  updateTextEntry,
  type TextNarcName,
} from "../pokeweb/textModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { Gen5TextEntry } from "../pokeweb/text";
import { escapeHtml, selectText } from "./dom";

const TEXT_BANK_STORAGE_KEY_PREFIX = "pokeweb-serverless-active-text-bank";

export function renderTextEditor(project: ProjectState, root: HTMLElement, narcName: TextNarcName, title: string, onDirty?: () => void): void {
  let selectedBank = loadRememberedTextBank(narcName, getTextBankCount(project, narcName));
  let searchText = "";
  let ignoreCase = false;

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
        ${getTextBankSummaries(project, narcName, searchText, ignoreCase).map((summary) => renderBankSummary(summary.id, summary.preview)).join("")}
      </div>
    `;
    attachListHandlers();
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
        ${bank.map((entry, flatIndex) => renderTextEntry(entry, flatIndex)).join("")}
      </div>
    `;
    attachDetailHandlers(bankId);
  };

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
      header.addEventListener("click", () => renderDetail(Number(header.dataset.bankId)));
    });
  }

  function attachDetailHandlers(bankId: number): void {
    root.querySelector<HTMLButtonElement>("#back-textbanks")?.addEventListener("click", () => renderList());
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
