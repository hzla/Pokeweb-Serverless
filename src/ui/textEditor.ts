import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS } from "../pokeweb/constants";
import { layoutBw2Dialogue, loadBw2DialogueAssets, type DialogueFont } from "../pokeweb/bw2DialoguePreview";
import { parseHeaders } from "../pokeweb/headerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { Gen5TextEntry } from "../pokeweb/text";
import {
  addTextEntries,
  applyTextReplacement,
  deleteLastTextEntries,
  getTextBank,
  getTextBankCount,
  parseTextEntryId,
  previewTextReplacement,
  updateTextEntry,
  type TextNarcName,
  type TextReplacementMode,
  type TextReplacementPlan,
} from "../pokeweb/textModel";
import { installBw2DialoguePreview, type Bw2DialoguePreview } from "./bw2DialoguePreview";
import { escapeHtml } from "./dom";
import { assumedDialogueVariables, installGameTextEditor, renderGameTextEditor } from "./textHighlight";
import { installPicker } from "./trainerInteractions";
import "../styles/moveData.css";
import "../styles/textData.css";

const TEXT_BANK_STORAGE_KEY_PREFIX = "pokeweb-serverless-active-text-bank";
const MATCH_LIST_LIMIT = 200;

type TextEditorState = {
  bankId: number;
  entryIndex: number;
  filter: string;
  overflowOnly: boolean;
  find: string;
  replace: string;
  mode: TextReplacementMode;
  scope: "bank" | "all";
  lastMatch?: TextReplacementPlan["matches"][number];
};

const editorStates = new WeakMap<ProjectState, Partial<Record<TextNarcName, TextEditorState>>>();

const KNOWN_BANK_NAMES: Record<string, string> = {
  moves: "Move names",
  abilities: "Ability names",
  pokedex: "Pokémon names",
  tr_classes: "Trainer classes",
  tr_names: "Trainer names",
  locations: "Location names",
  items: "Item names",
};

/** Opens a bank the next time the editor renders (used by links from other editors). */
export function selectTextBank(project: ProjectState, narcName: TextNarcName, bankId: number): void {
  const states = editorStates.get(project) ?? {};
  editorStates.set(project, states);
  const state = states[narcName];
  if (state) {
    state.bankId = bankId;
    state.entryIndex = 0;
    state.filter = "";
    state.overflowOnly = false;
  }
  rememberTextBank(narcName, bankId);
}

export function renderTextEditor(project: ProjectState, root: HTMLElement, narcName: TextNarcName, title: string, onDirty?: () => void): void {
  const bankCount = getTextBankCount(project, narcName);
  const states = editorStates.get(project) ?? {};
  editorStates.set(project, states);
  const state: TextEditorState = states[narcName] ?? {
    bankId: loadRememberedTextBank(narcName, bankCount) ?? 0,
    entryIndex: 0,
    filter: "",
    overflowOnly: false,
    find: "",
    replace: "",
    mode: "ignore-case",
    scope: "bank",
  };
  states[narcName] = state;
  if (state.bankId >= bankCount) state.bankId = 0;
  const names = bankNames(project, narcName, bankCount);
  const bankLabel = (id: number) => (names[id] === `Bank ${id}` ? `Bank ${id}` : `${names[id]} - Bank ${id}`);
  const bankOptions = names.map((_name, id) => bankLabel(id));
  const canPreview = project.session.baseRom === "BW2";
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";

  root.innerHTML = `
    <div class="text-data" id="text-data">
      <aside class="md-list tx-side" aria-label="${escapeHtml(title)} tools">
        <div class="tx-block">
          <div class="tx-block-title">Bank</div>
          <div class="tx-bank-row">
            <button class="btn sm -ghost" type="button" data-bank-step="-1" aria-label="Previous bank">‹</button>
            <div class="tx-bank-picker"><div contenteditable="true" spellcheck="false" data-bank-picker data-autofill="banks" aria-label="Text bank"></div></div>
            <button class="btn sm -ghost" type="button" data-bank-step="1" aria-label="Next bank">›</button>
          </div>
          <input class="md-search" type="search" data-text-filter placeholder="Search in bank" value="${escapeHtml(state.filter)}" autocomplete="off" spellcheck="false" aria-label="Search in bank">
          <label class="md-check td-check"><input type="checkbox" data-overflow-only ${state.overflowOnly ? "checked" : ""} ${canPreview ? "" : "disabled"}><span>Only overflowing messages</span></label>
        </div>
        <form class="tx-block tx-replace" aria-label="Find and replace">
          <div class="tx-block-title">Find and replace</div>
          <input class="md-search" data-find placeholder="Find" value="${escapeHtml(state.find)}" autocomplete="off" spellcheck="false" aria-label="Find">
          <input class="md-search" data-replace placeholder="Replace with (empty deletes)" value="${escapeHtml(state.replace)}" autocomplete="off" spellcheck="false" aria-label="Replace with">
          <div class="tx-replace-options">
            <select data-mode aria-label="Matching">
              <option value="ignore-case"${state.mode === "ignore-case" ? " selected" : ""}>Ignore case</option>
              <option value="match-case"${state.mode === "match-case" ? " selected" : ""}>Match case</option>
              <option value="capitalization-aware"${state.mode === "capitalization-aware" ? " selected" : ""} title="Matches any case and keeps UPPERCASE, lowercase and Title Case">Keep capitalization</option>
            </select>
            <select data-scope aria-label="Search in">
              <option value="bank"${state.scope === "bank" ? " selected" : ""}>This bank</option>
              <option value="all"${state.scope === "all" ? " selected" : ""}>All banks</option>
            </select>
          </div>
          <div class="tx-replace-actions">
            <button class="btn" type="button" data-find-next>Find next</button>
            <button class="btn" type="submit" data-replace-all>Replace all…</button>
          </div>
          <div class="tx-match-status" data-match-status role="status" aria-live="polite"></div>
          <div class="tx-matches" data-matches></div>
        </form>
        <div class="tx-block tx-bank-actions">
          <button class="btn sm" type="button" data-add-entry>Add message</button>
          <button class="btn sm" type="button" data-delete-entry>Delete last message</button>
        </div>
      </aside>
      <section class="md-detail tx-main" data-text-main></section>
      <aside class="tx-preview" aria-label="In-game preview">
        <div class="tx-preview-head"><span class="tx-block-title">In-game preview</span><span class="tx-preview-entry" data-preview-entry></span></div>
        ${canPreview ? `<div data-preview-root></div>` : `<p class="td-empty">The in-game preview needs a Black 2 / White 2 project.</p>`}
      </aside>
      <dialog class="text-replace-confirm" aria-labelledby="text-replace-confirm-title">
        <h2 id="text-replace-confirm-title">Confirm replacements</h2>
        <p data-confirm-summary></p>
        <pre data-confirm-details></pre>
        <div class="tx-replace-actions">
          <button class="btn" type="button" data-confirm-cancel autofocus>Cancel</button>
          <button class="btn -primary" type="button" data-confirm-apply>Apply replacements</button>
        </div>
      </dialog>
    </div>
  `;

  const main = root.querySelector<HTMLElement>("[data-text-main]")!;
  const picker = root.querySelector<HTMLElement>("[data-bank-picker]")!;
  const filterInput = root.querySelector<HTMLInputElement>("[data-text-filter]")!;
  const overflowOnly = root.querySelector<HTMLInputElement>("[data-overflow-only]")!;
  const form = root.querySelector<HTMLFormElement>(".tx-replace")!;
  const dialog = root.querySelector<HTMLDialogElement>(".text-replace-confirm")!;
  const previewEntry = root.querySelector<HTMLElement>("[data-preview-entry]")!;
  const previewRoot = root.querySelector<HTMLElement>("[data-preview-root]");
  let font: DialogueFont | undefined;
  let previewText = "";
  const preview: Bw2DialoguePreview | undefined = previewRoot ? installBw2DialoguePreview(project, previewRoot, () => previewText, assumedDialogueVariables, { stacked: true }) : undefined;
  preview?.show();
  if (canPreview) {
    void loadBw2DialogueAssets(project).then((assets) => {
      font = assets.font;
      if (!root.isConnected) return;
      main.querySelectorAll<HTMLElement>("[data-entry]").forEach(flagRow);
      refreshSummary();
      applyFilter();
    }).catch(() => {
      overflowOnly.disabled = true;
    });
  }

  // ---------- Bank ----------

  const bankPicker = installPicker(picker, bankOptions);
  const setPickerLabel = () => {
    picker.textContent = bankLabel(state.bankId);
  };
  const commitPicker = () => {
    const raw = picker.dataset.commitValue ?? picker.textContent ?? "";
    delete picker.dataset.commitValue;
    delete picker.dataset.commitLabel;
    const match = /\bBank (\d+)\s*$/u.exec(raw) ?? /^\s*(\d+)\s*$/u.exec(raw);
    const index = match ? Number(match[1]) : names.findIndex((name) => name.toLowerCase() === raw.trim().toLowerCase());
    if (Number.isInteger(index) && index >= 0 && index < bankCount && index !== state.bankId) selectBank(index);
    else setPickerLabel();
  };
  picker.addEventListener("focus", () => {
    window.setTimeout(() => {
      if (document.activeElement !== picker) return;
      const range = document.createRange();
      range.selectNodeContents(picker);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, 0);
    bankPicker?.open();
  });
  picker.addEventListener("keydown", (event) => {
    if (bankPicker?.handleKey(event)) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      if (event.key === "Escape") setPickerLabel();
      picker.blur();
    }
  });
  picker.addEventListener("blur", () => {
    bankPicker?.close();
    commitPicker();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-bank-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = state.bankId + Number(button.dataset.bankStep);
      if (next >= 0 && next < bankCount) selectBank(next);
    });
  });

  function selectBank(bankId: number, entryIndex = 0): void {
    state.bankId = bankId;
    state.entryIndex = entryIndex;
    rememberTextBank(narcName, bankId);
    setPickerLabel();
    renderBank();
    if (state.scope === "bank") updateMatches();
  }

  // ---------- Messages ----------

  const editedEntries = () => {
    const prefix = `text:${narcName}:${state.bankId}:`;
    return new Set((project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(prefix)).map((entry) => Number(entry.key.slice(prefix.length))));
  };

  function renderBank(): void {
    const bank = getTextBank(project, narcName, state.bankId);
    const edited = editedEntries();
    main.innerHTML = `
      <header class="tx-head">
        <h1>${escapeHtml(names[state.bankId] ?? `Bank ${state.bankId}`)}${names[state.bankId] === `Bank ${state.bankId}` ? "" : `<span class="td-num">#${state.bankId}</span>`}</h1>
        <span class="fd-subtitle" data-bank-summary></span>
      </header>
      <div class="tx-rows" role="list">
        ${bank.map((entry, index) => renderRow(entry, index, edited.has(index))).join("") || `<p class="td-empty">This bank has no messages. Add one from the sidebar.</p>`}
      </div>
    `;
    main.querySelectorAll<HTMLTextAreaElement>("textarea.tx-input").forEach(installGameTextEditor);
    if (font) main.querySelectorAll<HTMLElement>("[data-entry]").forEach(flagRow);
    refreshSummary();
    applyFilter();
    selectEntry(Math.min(state.entryIndex, Math.max(0, bank.length - 1)), false);
    main.scrollTop = 0;
  }

  function renderRow(entry: Gen5TextEntry, index: number, edited: boolean): string {
    const meta = parseTextEntryId(entry[0]);
    const label = meta.block === 0 ? String(meta.entry) : `${meta.block}_${meta.entry}`;
    return `
      <div class="tx-row" role="listitem" data-entry="${index}">
        <span class="tx-id${edited ? " is-edited" : ""}" title="Message ${escapeHtml(label)}">${escapeHtml(label)}</span>
        ${renderGameTextEditor(entry[1], `data-entry-input="${index}" aria-label="Message ${escapeHtml(label)}"`, "(empty)")}
        <span class="tx-flag" data-flag></span>
      </div>
    `;
  }

  /** Mark a message whose lines run past the box or past two lines before a page break. */
  function flagRow(row: HTMLElement): void {
    const flag = row.querySelector<HTMLElement>("[data-flag]");
    const text = row.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "";
    if (!flag || !font) return;
    let problems: string[] = [];
    try {
      problems = layoutBw2Dialogue(text, font, assumedDialogueVariables()).warnings.filter((warning) => /exceeds|below the two-line/u.test(warning));
    } catch (error) {
      problems = [error instanceof Error ? error.message : String(error)];
    }
    row.classList.toggle("-overflow", problems.length > 0);
    flag.textContent = problems.length ? "Overflow" : "";
    flag.title = problems.join("\n");
  }

  function refreshSummary(): void {
    const total = main.querySelectorAll("[data-entry]").length;
    const overflowing = main.querySelectorAll("[data-entry].-overflow").length;
    const summary = main.querySelector<HTMLElement>("[data-bank-summary]");
    if (summary) summary.textContent = `${total} message${total === 1 ? "" : "s"}${font && overflowing ? ` · ${overflowing} overflowing` : ""}`;
  }

  function applyFilter(): void {
    const term = state.filter.trim().toLowerCase();
    main.querySelectorAll<HTMLElement>("[data-entry]").forEach((row) => {
      const text = row.querySelector<HTMLTextAreaElement>("textarea")?.value.toLowerCase() ?? "";
      const show = (!term || text.includes(term) || row.querySelector(".tx-id")?.textContent === term) && (!state.overflowOnly || row.classList.contains("-overflow"));
      row.hidden = !show;
    });
  }

  function selectEntry(index: number, focus: boolean): void {
    state.entryIndex = index;
    main.querySelectorAll<HTMLElement>("[data-entry]").forEach((row) => row.classList.toggle("is-selected", Number(row.dataset.entry) === index));
    const textarea = main.querySelector<HTMLTextAreaElement>(`textarea[data-entry-input="${index}"]`);
    previewText = textarea?.value ?? "";
    const id = textarea?.closest("[data-entry]")?.querySelector(".tx-id")?.textContent ?? "";
    previewEntry.textContent = textarea ? `Message ${id}` : "";
    preview?.refresh();
    if (focus) textarea?.focus();
  }

  let previewTimer = 0;
  main.addEventListener("focusin", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-entry-input]");
    if (textarea) {
      textarea.dataset.initial = textarea.value;
      selectEntry(Number(textarea.dataset.entryInput), false);
    }
  });
  main.addEventListener("input", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-entry-input]");
    if (!textarea) return;
    previewText = textarea.value;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      preview?.refresh();
      const row = textarea.closest<HTMLElement>("[data-entry]");
      if (row) flagRow(row);
      refreshSummary();
    }, 120);
  });
  main.addEventListener("focusout", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-entry-input]");
    if (textarea) commitEntry(textarea);
  });
  main.addEventListener("keydown", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-entry-input]");
    if (!textarea) return;
    const index = Number(textarea.dataset.entryInput);
    const step = (direction: number) => {
      const rows = [...main.querySelectorAll<HTMLElement>("[data-entry]")].filter((row) => !row.hidden);
      const at = rows.findIndex((row) => Number(row.dataset.entry) === index);
      const next = rows[at + direction];
      if (next) selectEntry(Number(next.dataset.entry), true);
    };
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      step(1);
    } else if (event.key === "Escape") {
      textarea.value = textarea.dataset.initial ?? textarea.value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.blur();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && (event.altKey || event.metaKey)) {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
    }
  });

  function commitEntry(textarea: HTMLTextAreaElement): void {
    const index = Number(textarea.dataset.entryInput);
    const value = textarea.value;
    if (value === (textarea.dataset.initial ?? value)) return;
    try {
      updateTextEntry(project, narcName, state.bankId, index, value);
      textarea.dataset.initial = value;
      textarea.classList.remove("invalid");
      onDirty?.();
      const prefix = `text:${narcName}:${state.bankId}:${index}`;
      const edited = (project.actionChangelog?.entries ?? []).some((entry) => entry.key === prefix);
      textarea.closest("[data-entry]")?.querySelector(".tx-id")?.classList.toggle("is-edited", edited);
      updateMatches();
    } catch (error) {
      textarea.classList.add("invalid");
      textarea.title = error instanceof Error ? error.message : String(error);
    }
  }

  filterInput.addEventListener("input", () => {
    state.filter = filterInput.value;
    applyFilter();
  });
  overflowOnly.addEventListener("change", () => {
    state.overflowOnly = overflowOnly.checked;
    applyFilter();
  });
  root.querySelector("[data-add-entry]")?.addEventListener("click", () => {
    addTextEntries(project, narcName, state.bankId, 1);
    onDirty?.();
    const count = getTextBank(project, narcName, state.bankId).length;
    state.entryIndex = count - 1;
    renderBank();
    selectEntry(count - 1, true);
    main.querySelector<HTMLElement>(`[data-entry="${count - 1}"]`)?.scrollIntoView({ block: "center" });
  });
  root.querySelector("[data-delete-entry]")?.addEventListener("click", () => {
    const bank = getTextBank(project, narcName, state.bankId);
    if (!bank.length) return;
    const last = bank[bank.length - 1];
    if (last[1] && !window.confirm(`Delete the last message?\n\n${last[1].slice(0, 200)}`)) return;
    deleteLastTextEntries(project, narcName, state.bankId, 1);
    onDirty?.();
    renderBank();
  });

  // ---------- Find and replace ----------

  const findInput = form.querySelector<HTMLInputElement>("[data-find]")!;
  const replaceInput = form.querySelector<HTMLInputElement>("[data-replace]")!;
  const modeSelect = form.querySelector<HTMLSelectElement>("[data-mode]")!;
  const scopeSelect = form.querySelector<HTMLSelectElement>("[data-scope]")!;
  const status = form.querySelector<HTMLElement>("[data-match-status]")!;
  const matchList = form.querySelector<HTMLElement>("[data-matches]")!;
  let pendingPlan: TextReplacementPlan | undefined;

  const plan = () => previewTextReplacement(project, narcName, state.find, state.replace, state.mode, state.scope === "bank" ? state.bankId : undefined);
  const summarize = (result: TextReplacementPlan) => `${result.replacementCount} replacement${result.replacementCount === 1 ? "" : "s"} in ${result.changes.length} message${result.changes.length === 1 ? "" : "s"} across ${result.bankCount} bank${result.bankCount === 1 ? "" : "s"}`;

  function updateMatches(): void {
    const result = state.find ? plan() : undefined;
    form.querySelector<HTMLButtonElement>("[data-find-next]")!.disabled = !result?.matches.length;
    form.querySelector<HTMLButtonElement>("[data-replace-all]")!.disabled = !result?.replacementCount;
    status.textContent = !result ? "" : result.matches.length === 0 ? "No matches" : `${result.matches.length} match${result.matches.length === 1 ? "" : "es"} in ${result.changes.length} message${result.changes.length === 1 ? "" : "s"}`;
    if (!result?.matches.length) {
      matchList.innerHTML = "";
      return;
    }
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const match of result.matches) {
      const key = `${match.bankId}:${match.entryIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (rows.length >= MATCH_LIST_LIMIT) break;
      const text = getTextBank(project, narcName, match.bankId)[match.entryIndex]?.[1] ?? "";
      const start = Math.max(0, match.offset - 18);
      const snippet = `${start > 0 ? "…" : ""}${escapeHtml(text.slice(start, match.offset))}<mark>${escapeHtml(text.slice(match.offset, match.offset + match.length))}</mark>${escapeHtml(text.slice(match.offset + match.length, match.offset + match.length + 30))}`;
      rows.push(`<button class="tx-match" type="button" data-match-bank="${match.bankId}" data-match-entry="${match.entryIndex}" data-match-offset="${match.offset}" data-match-length="${match.length}"><span class="tx-match-where">${state.scope === "all" ? `${match.bankId} · ` : ""}#${match.entryIndex}</span><span class="tx-match-text">${snippet}</span></button>`);
    }
    matchList.innerHTML = rows.join("") + (seen.size > MATCH_LIST_LIMIT ? `<p class="td-empty">Showing the first ${MATCH_LIST_LIMIT} messages.</p>` : "");
  }

  function revealMatch(bankId: number, entryIndex: number, offset: number, length: number): void {
    if (bankId !== state.bankId) selectBank(bankId, entryIndex);
    if (state.filter || state.overflowOnly) {
      state.filter = "";
      state.overflowOnly = false;
      filterInput.value = "";
      overflowOnly.checked = false;
      applyFilter();
    }
    selectEntry(entryIndex, true);
    const textarea = main.querySelector<HTMLTextAreaElement>(`textarea[data-entry-input="${entryIndex}"]`);
    textarea?.setSelectionRange(offset, offset + length);
    textarea?.closest("[data-entry]")?.scrollIntoView({ block: "center" });
  }

  const readForm = () => {
    state.find = findInput.value;
    state.replace = replaceInput.value;
    state.mode = modeSelect.value as TextReplacementMode;
    state.scope = scopeSelect.value as "bank" | "all";
    state.lastMatch = undefined;
    updateMatches();
  };
  let findTimer = 0;
  form.addEventListener("input", () => {
    window.clearTimeout(findTimer);
    findTimer = window.setTimeout(readForm, 150);
  });
  form.addEventListener("change", readForm);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      readForm();
      findNext();
    }
  });
  const findNext = () => {
    const { matches } = plan();
    if (!matches.length) return;
    const previous = matches.findIndex((match) => match.bankId === state.lastMatch?.bankId && match.entryIndex === state.lastMatch.entryIndex && match.offset === state.lastMatch.offset);
    const match = matches[(previous + 1) % matches.length];
    state.lastMatch = match;
    revealMatch(match.bankId, match.entryIndex, match.offset, match.length);
  };
  form.querySelector("[data-find-next]")?.addEventListener("click", findNext);
  matchList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-match-bank]");
    if (button) revealMatch(Number(button.dataset.matchBank), Number(button.dataset.matchEntry), Number(button.dataset.matchOffset), Number(button.dataset.matchLength));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    readForm();
    const result = plan();
    if (!result.replacementCount) return;
    pendingPlan = result;
    dialog.querySelector<HTMLElement>("[data-confirm-summary]")!.textContent = `Make ${summarize(result)} in ${state.scope === "bank" ? `bank ${state.bankId}` : `all ${title} banks`}?`;
    dialog.querySelector<HTMLElement>("[data-confirm-details]")!.textContent = `Find: ${state.find}\nReplace with: ${state.replace || "(nothing)"}\nMatching: ${modeSelect.selectedOptions[0]?.text ?? state.mode}`;
    dialog.showModal();
  });
  dialog.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    pendingPlan = undefined;
  });
  dialog.querySelector("[data-confirm-apply]")?.addEventListener("click", () => {
    const result = pendingPlan;
    dialog.close();
    if (!result) return;
    try {
      applyTextReplacement(project, result);
      onDirty?.();
      status.textContent = `Applied ${summarize(result)}.`;
      renderBank();
      updateMatches();
    } catch (error) {
      status.textContent = `No replacements were made. ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  setPickerLabel();
  renderBank();
  updateMatches();
}

/** Bank labels: known name banks for message text, and the maps that load each story bank. */
function bankNames(project: ProjectState, narcName: TextNarcName, count: number): string[] {
  const names = Array.from({ length: count }, (_unused, id) => `Bank ${id}`);
  if (narcName === "message_texts") {
    const known = project.session.baseRom === "BW2" ? BW2_MESSAGE_BANKS : project.session.baseRom === "BW" ? BW_MESSAGE_BANKS : [];
    for (const [source, key] of known) {
      for (const id of Array.isArray(source) ? source : [source]) if (id < count) names[id] = KNOWN_BANK_NAMES[key] ?? key;
    }
    return names;
  }
  try {
    if (!project.headers) project.headers = parseHeaders(project);
  } catch {
    return names;
  }
  const places = new Map<number, string[]>();
  for (const row of Object.values(project.headers.rows)) {
    const bankId = Number(row.text_bank_id);
    if (!Number.isInteger(bankId) || bankId >= count) continue;
    const list = places.get(bankId) ?? [];
    const place = String(row.location_name ?? "");
    if (place && !list.includes(place)) list.push(place);
    places.set(bankId, list);
  }
  for (const [bankId, list] of places) names[bankId] = list.length > 2 ? `${list.slice(0, 2).join(", ")} +${list.length - 2}` : list.join(", ") || names[bankId];
  return names;
}

function loadRememberedTextBank(narcName: TextNarcName, bankCount: number): number | undefined {
  try {
    const value = globalThis.localStorage?.getItem(`${TEXT_BANK_STORAGE_KEY_PREFIX}:${narcName}`);
    if (value === null || value === undefined) return undefined;
    const bankId = Number(value);
    if (Number.isSafeInteger(bankId) && bankId >= 0 && bankId < bankCount) return bankId;
  } catch {
    // Storage may be unavailable in private or constrained browser contexts.
  }
  return undefined;
}

function rememberTextBank(narcName: TextNarcName, bankId: number): void {
  try {
    globalThis.localStorage?.setItem(`${TEXT_BANK_STORAGE_KEY_PREFIX}:${narcName}`, String(bankId));
  } catch {
    // The editor remains usable without persistent UI state.
  }
}
