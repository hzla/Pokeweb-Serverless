import "../../styles/mastersheetEditor.css";
import { typeNamesForProject } from "../../pokeweb/constants";
import { MastersheetAuthoringIndex, pageZones } from "../../pokeweb/mastersheetAuthoring";
import { createMastersheetCatalog, normalizeName, type MastersheetCatalog, type MastersheetDocument, type MsBlock, type MsPage, type MsSplit } from "../../pokeweb/mastersheetDocument";
import {
  areaHeading,
  duplicateRange,
  emptyBlock,
  insertBlockLines,
  insertHeading,
  moveRange,
  moveSection,
  NOTICE_COLOUR,
  printBlock,
  readBlock,
  removeRange,
  replaceHeading,
  replaceRange,
  setPageSkips,
  setPageZones,
  sourceLines,
  splitHeading,
  swapRanges,
  type BlockDraft,
  type BlockKind,
  type SourceChange,
  type SourceRange,
} from "../../pokeweb/mastersheetEdits";
import { setMastersheetMarkdown } from "../../pokeweb/mastersheetModel";
import { writeMastersheetIntoRom } from "../../pokeweb/mastersheetRomFile";
import { announceMastersheet, listenForMastersheet } from "../../pokeweb/mastersheetSync";
import type { ProjectState } from "../../pokeweb/projectStore";
import { cleanDisplayText } from "../../pokeweb/text";
import { tmTypePalette } from "../../pokeweb/tmModel";
import type { ViewerController, ViewerEditingHooks } from "../app";
import type { AssetProvider } from "../assets";
import type { MastersheetSession } from "../session";
import { noticeFrameVars, SIGN_COLOURS } from "../noticeFrames";
import { fillBanner, fillChange, fillState, ghostCard, ghostItem, ghostItemGroup, renderCoverage, type Candidate } from "./fill";
import { decorateBlock, decorateTableBand, inlineMarkdown, isEmptyDraft, linkHtml, plainText, readField, tableCard, trainerCard } from "./inplace";
import { pickerPlaceholder, renderPicker, searchTrainers, type EditorHost, type PickerContext, type PickerKind } from "./pickers";
import { rememberedEditMode, rememberEditMode, saveDraft, type EditSource } from "./storage";
import { createTemplatePane, type TemplateCompletion, type TemplatePane } from "./template";
import { ARROW_DOWN, ARROW_UP, button, esc, GRIP, titlebar, WARNING } from "./ui";

/**
 * Edit mode for the Mastersheet Viewer. The source stays the master copy: every action here rewrites the lines of one
 * block, page or split (mastersheetEdits.ts) through the session (session.ts), which rebuilds the document; the
 * viewer then patches the page in place.
 *
 * Blocks are edited where they stand: a click selects one, a double-click (or Enter, or Edit) turns it into its own
 * editor (inplace.ts), with pickers for what comes from the ROM (pickers.ts). While text is typed the viewer leaves the
 * block's element to the editor (`heldBlock`); anything that changes how the block looks (a new trainer, an icon) has
 * the viewer draw it again and the editor decorate it again. Fill from the ROM shows its suggestions in the page
 * (fill.ts). The panel keeps only Problems and the whole-sheet Coverage.
 */

export type EditorOptions = {
  project: ProjectState;
  session: MastersheetSession;
  assets: AssetProvider & { setDocument?(document: MastersheetDocument): void };
  /** "project": opened from the editor, saves into the project. "rom": a ROM file, saves a new copy of it. */
  source: EditSource;
  romName?: string;
  /** The ROM's cache key, which also keys its unsaved draft. */
  romKey?: string;
  /** Edits from an earlier visit were restored from the draft. */
  restoredDraft?: boolean;
  /** A ROM was saved: the viewer keeps it for the next visit. */
  onRomSaved?(bytes: Uint8Array): Promise<void> | void;
};

/** "inplace": typing or picking in the block being edited; it keeps being edited. Everything else lets go of it. */
type Origin = "inplace" | "template" | "menu" | "other";
type PanelId = "problems" | "coverage";
type Focus = { point?: { x: number; y: number }; selectAll?: boolean; caret?: "start" | "end"; field?: string; entry?: number; none?: boolean };
type Popover = {
  kind: PickerKind | "link";
  element: HTMLElement;
  anchor: HTMLElement;
  query: string;
  context: PickerContext;
  pick(value: string): void;
  timer: number;
};
type HeaderEdit = { element: HTMLElement; which: "title" | "split" | "detail"; original: string; shown: string };
type Editing = { start: number; range: SourceRange; draft: BlockDraft };

const ADD_KINDS: Array<[BlockKind, string, string, string]> = [
  ["text", "Text", "A paragraph, with links", "var(--msv-text)"],
  ["heading", "Section", "A heading inside this area", "var(--msv-text)"],
  ["list", "List", "Bullet points", "var(--msv-text)"],
  ["trainer", "Trainer", "Pick one from the ROM", "var(--msv-fight)"],
  ["encounter", "Wild Pokémon", "A zone's encounter table", "var(--msv-mon)"],
  ["items", "Items", "Icons with a note each", "var(--msv-bag)"],
  ["gifts", "Pokémon list", "Gifts, trades, eggs", "var(--msv-mon)"],
  ["notice", "Notice", "A signpost or system box", "#9c7342"],
];

const BLOCK_LABELS: Record<BlockKind, string> = {
  text: "Text",
  heading: "Heading",
  list: "List",
  trainer: "Trainer",
  encounter: "Wild Pokémon",
  items: "Items",
  gifts: "Pokémon list",
  notice: "Notice",
};

/** The sheet's notice colours first (as its author uses them), then a few in the same family. */
const NOTICE_COLOURS = ["#469e62", "#f26253", "#af74b3", "#4e86d4", "#f8c828"];

const TYPING_APPLY_MS = 250;
const PROJECT_SAVE_MS = 700;
const DRAFT_SAVE_MS = 800;

export function createEditor(options: EditorOptions): { hooks: ViewerEditingHooks; attach(controller: ViewerController): void } {
  const { project, session } = options;
  const romMode = options.source === "rom";
  let controller: ViewerController | undefined;
  let active = rememberedEditMode(options.source);
  let templatePane: TemplatePane | undefined;
  let origin: Origin = "other";

  // What is selected, edited, added or being picked on the page.
  let selected: SourceRange | undefined;
  let hovered: number | undefined;
  let editing: Editing | undefined;
  /** Whether the viewer leaves the edited block's element alone on the next patch (typing); off for picks. */
  let held = true;
  let typingTimer = 0;
  let typingKey = "";
  let pending: { kind: "trainer" | "encounter"; at: number; mandatory: boolean; card?: HTMLElement } | undefined;
  let adding: { line: number; strip?: HTMLElement } | undefined;
  let popover: Popover | undefined;
  let headerEdit: HeaderEdit | undefined;
  /** A page just added: its title is edited once it shows. */
  let titleEditFor: string | undefined;
  let decoratedPage: string | undefined;

  // Fill from the ROM.
  let fillOn = false;
  let showSkipped = false;
  let zonePickerWanted = false;
  let fillKey = "";
  let fillNodes: HTMLElement[] = [];

  // Panel, menus, drags, saving.
  let panel: PanelId | undefined;
  let menu: HTMLElement | undefined;
  let overlay: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let toolsKey = "";
  let dragBlock: number | undefined;
  let dragEntry: number | undefined;
  let dragPage: string | undefined;
  let saveTimer = 0;
  let saveState: "idle" | "saving" | "error" = "idle";
  let saveError = "";
  let restoredDraft = Boolean(options.restoredDraft);
  let catalog: MastersheetCatalog | undefined;
  let index: MastersheetAuthoringIndex | undefined;
  let indexReady = false;

  const doc = () => session.document;
  const page = () => controller?.currentPage();
  const getCatalog = () => (catalog ??= createMastersheetCatalog(project, session.document));

  /** The ROM-wide index; reading it takes a second or two, so it is read once, when something first asks. */
  const readyIndex = (): MastersheetAuthoringIndex | undefined => {
    if (indexReady) return index;
    if (!index) {
      index = new MastersheetAuthoringIndex(project, getCatalog());
      window.setTimeout(() => {
        try {
          index!.zones();
          index!.trainers();
        } finally {
          indexReady = true;
          onIndexReady();
        }
      }, 30);
    }
    return undefined;
  };

  const host: EditorHost = { project, doc, page, catalog: getCatalog, index: readyIndex };

  const onIndexReady = () => {
    renderPopoverBody();
    const current = page();
    const pageElement = article();
    if (current && pageElement && active) {
      placeFill(pageElement, current);
      layout();
    }
    refreshPanel();
  };

  // ---------- Session ----------

  const apply = (edit: (source: string) => SourceChange, by: Origin, coalesce?: string): SourceChange => {
    origin = by;
    try {
      return session.apply(edit, { coalesce });
    } finally {
      origin = "other";
    }
  };

  let shownSource = session.source;
  session.onChange((current, _reason, range) => {
    // Saving changes no text: only the toolbar has news.
    if (current.source === shownSource) {
      renderBar();
      return;
    }
    shownSource = current.source;
    options.assets.setDocument?.(current.document);
    setMastersheetMarkdown(project, current.source);
    const by = origin;
    if (by !== "inplace") {
      // Undo, redo, the template and other edits can move or change what is being edited: let go of it.
      window.clearTimeout(typingTimer);
      typingTimer = 0;
      editing = undefined;
      closePopover();
      if (by !== "menu") {
        dropPending();
        closeAdd();
      }
    }
    controller?.update(current.document, { line: range?.start });
    if (by !== "template") templatePane?.sync(current.source);
    templatePane?.setProblems(current.document.warnings);
    if (panel === "problems" || (panel === "coverage" && by !== "inplace")) refreshPanel();
    renderBar();
    scheduleSave();
  });

  const linesOf = (range: SourceRange) => sourceLines(session.source).slice(range.start, range.end);
  const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, n) => line === b[n]);

  // ---------- Saving ----------

  const scheduleSave = () => {
    window.clearTimeout(saveTimer);
    if (!session.dirty) return;
    if (romMode) {
      saveTimer = window.setTimeout(() => {
        if (options.romKey) saveDraft(options.romKey, session.dirty ? { source: session.source, base: session.savedSource, savedAt: Date.now() } : undefined);
      }, DRAFT_SAVE_MS);
      return;
    }
    saveTimer = window.setTimeout(() => void saveToProject(), PROJECT_SAVE_MS);
  };

  const saveToProject = async () => {
    const source = session.source;
    saveState = "saving";
    renderBar();
    try {
      const { saveActiveProjectMastersheet } = await import("../../pokeweb/persistence");
      await saveActiveProjectMastersheet(source);
      announceMastersheet(source);
      saveState = "idle";
      session.markSaved(source);
    } catch (error) {
      saveState = "error";
      saveError = error instanceof Error ? error.message : String(error);
      renderBar();
    }
  };

  const saveRom = async () => {
    if (!project.originalRomBytes) return;
    flushTyping();
    saveState = "saving";
    renderBar();
    try {
      const source = session.source;
      const bytes = writeMastersheetIntoRom(project.originalRomBytes, { romTitle: project.docs?.romTitle, markdown: source, highlights: project.docs?.mastersheetHighlights });
      const saved = await deliverRom(bytes, options.romName ?? "mastersheet.nds");
      if (!saved) {
        saveState = "idle";
        renderBar();
        return;
      }
      project.originalRomBytes = bytes;
      session.markSaved(source);
      restoredDraft = false;
      if (options.romKey) saveDraft(options.romKey, undefined);
      saveState = "idle";
      await options.onRomSaved?.(bytes);
    } catch (error) {
      saveState = "error";
      saveError = error instanceof Error ? error.message : String(error);
    }
    renderBar();
  };

  /** Back to the sheet the ROM carries; Undo can still bring the restored edits back. */
  const discardDraft = () => {
    restoredDraft = false;
    if (options.romKey) saveDraft(options.romKey, undefined);
    apply(() => ({ source: session.savedSource, range: { start: 0, end: 0 } }), "other");
  };

  if (!romMode) {
    // The editor tab imported or chose another sheet: take it when nothing here is unsaved.
    listenForMastersheet((markdown) => {
      if (!session.dirty) session.replaceSaved(markdown);
    });
  }
  window.addEventListener("beforeunload", (event) => {
    flushTyping();
    if (romMode && session.dirty) event.preventDefault();
  });

  // ---------- Toolbar ----------

  const renderBar = () => {
    const bar = controller?.elements.bar;
    if (!bar) return;
    bar.hidden = !active;
    if (!active) {
      bar.innerHTML = "";
      return;
    }
    const warnings = doc().warnings;
    const steps = session.unsavedSteps();
    const state = saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? `Couldn't save: ${saveError}`
        : romMode
          ? restoredDraft && session.dirty ? "Unsaved edits restored" : steps ? `${steps} unsaved change${steps === 1 ? "" : "s"}` : "No unsaved changes"
          : session.dirty ? "Saving soon…" : "Saved to project";
    bar.innerHTML = `
      <div class="mse-bar">
        <div class="mse-bar__group">
          ${button("Undo", "undo", "nav", session.canUndo ? ' title="Undo (Ctrl+Z)"' : " disabled")}
          ${button("Redo", "redo", "nav", session.canRedo ? ' title="Redo (Ctrl+Shift+Z)"' : " disabled")}
        </div>
        <button type="button" class="msv-hex -tab" aria-pressed="${Boolean(templatePane)}" data-action="template" title="Show the template beside the sheet"><span>Template</span></button>
        <button type="button" class="msv-hex -tab" aria-pressed="${fillOn}" data-action="fill" title="Show what the ROM puts in each area that its page doesn't show yet"><span>Fill from ROM</span></button>
        <span class="mse-bar__spacer"></span>
        ${warnings.length ? `<button type="button" class="mse-bar__problems" data-action="problems">${WARNING}<span>${warnings.length} problem${warnings.length === 1 ? "" : "s"}</span></button>` : ""}
        <span class="mse-bar__state${saveState === "error" ? " -error" : ""}" role="status">${esc(state)}</span>
        ${romMode && restoredDraft && session.dirty ? button("Discard", "discard") : ""}
        ${romMode ? button("Save ROM", "save-rom", "fight", ` title="Edits stay in this browser until you save: this writes a copy of the ROM with the new mastersheet, and nothing else in it changes"${session.dirty && saveState !== "saving" ? "" : " disabled"}`) : ""}
      </div>`;
  };

  // ---------- Edit mode ----------

  const setActive = (on: boolean) => {
    active = on;
    rememberEditMode(options.source, active);
    const elements = controller?.elements;
    if (!elements) return;
    elements.shell.classList.toggle("-editing", active);
    elements.editTab?.setAttribute("aria-pressed", String(active));
    if (!active) {
      endEditing();
      commitHeader();
      dropPending();
      closeAdd();
      closePopover();
      closeTemplate();
      closeMenu();
      if (panel) {
        panel = undefined;
        controller?.closePanel();
      }
      selected = undefined;
      removeFill();
    }
    renderBar();
    controller?.update(session.document);
    controller?.refreshNav();
  };

  // ---------- Blocks on the page ----------

  const article = (): HTMLElement | undefined => controller?.elements.pageHost.querySelector<HTMLElement>(":scope > .msv-page") ?? undefined;
  const blockElements = (): HTMLElement[] => [...(controller?.elements.pageHost.querySelectorAll<HTMLElement>(":scope > .msv-page > [data-block]") ?? [])];
  const blockAt = (start: number): MsBlock | undefined => page()?.blocks.find((block) => block.src.start === start);
  const blockOf = (element: HTMLElement): MsBlock | undefined => page()?.blocks[Number(element.dataset.block)];

  /** The elements the viewer drew for the block starting on `start` (a line with `<br>`s draws several). */
  const elementsAt = (start: number): HTMLElement[] => {
    const elements = blockElements();
    return (page()?.blocks ?? []).flatMap((block, n) => (block.src.start === start && elements[n] ? [elements[n]!] : []));
  };

  const editingElement = (): HTMLElement | undefined => (editing ? elementsAt(editing.start)[0] : undefined);

  /** What the frame and toolbar go round: a new trainer or table, the block being edited, or the one selected. */
  const targetElement = (): HTMLElement | undefined => pending?.card ?? editingElement() ?? (selected ? elementsAt(selected.start)[0] : undefined);

  const endOfPage = (current: MsPage) => {
    const last = current.blocks.at(-1);
    if (last) return last.src.end;
    return (current.skipLine ?? current.zonesLine ?? current.headingLine ?? current.src.start - 1) + 1;
  };

  const previousBlock = (current: MsPage, n: number): MsBlock | undefined => {
    const block = current.blocks[n];
    for (let i = n - 1; i >= 0; i -= 1) if (current.blocks[i]!.src.start !== block?.src.start) return current.blocks[i];
    return undefined;
  };

  const nextBlock = (current: MsPage, n: number): MsBlock | undefined => {
    const block = current.blocks[n];
    for (let i = n + 1; i < current.blocks.length; i += 1) if (current.blocks[i]!.src.start !== block?.src.start) return current.blocks[i];
    return undefined;
  };

  const splitOf = (current: MsPage | undefined): MsSplit | undefined => (current?.splitId ? doc().allSplits.find((split) => split.id === current.splitId) : undefined);

  const select = (range: SourceRange | undefined, reveal = true) => {
    if (editing && range?.start !== editing.start) endEditing();
    selected = range;
    layout();
    if (range && reveal) templatePane?.reveal(range);
  };

  // ---------- Editing a block in place ----------

  const startEditing = (start: number, focus: Focus = {}) => {
    if (editing && editing.start !== start) endEditing();
    commitHeader();
    dropPending();
    closeAdd();
    closePopover();
    const block = blockAt(start);
    const draft = block ? readBlock(linesOf(block.src)) : undefined;
    if (!block || !draft) return;
    editing = { start, range: block.src, draft };
    selected = block.src;
    decorateEditing();
    focusEditing(focus);
    layout();
    templatePane?.reveal(block.src);
  };

  /** Decorates the edited block's element, unless it already is (the viewer left it alone while it was typed in). */
  const decorateEditing = () => {
    if (!editing) return;
    const block = blockAt(editing.start);
    const [first, ...rest] = elementsAt(editing.start);
    if (!block || !first) {
      editing = undefined;
      return;
    }
    if (first.classList.contains("mse-editing")) return;
    editing.range = block.src;
    editing.draft = readBlock(linesOf(block.src)) ?? editing.draft;
    const element = decorateBlock(first, editing.draft, host);
    for (const other of rest) other.hidden = true;
    controller?.hydrate(element);
  };

  /** Ends editing: what was typed is written, an emptied paragraph or list goes, and the viewer draws the block again. */
  const endEditing = (commit = true) => {
    if (!editing) return;
    if (commit) flushTyping();
    const { start, draft, range } = editing;
    editing = undefined;
    closePopover();
    if (commit && isEmptyDraft(draft) && blockAt(start)) {
      selected = undefined;
      apply((text) => removeRange(text, range), "menu");
      return;
    }
    controller?.redrawBlock(start);
    refreshExtras();
  };

  const scheduleTyping = (key: string) => {
    typingKey = key;
    window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      typingTimer = 0;
      applyTyping();
    }, TYPING_APPLY_MS);
  };

  const flushTyping = () => {
    if (!typingTimer) return;
    window.clearTimeout(typingTimer);
    typingTimer = 0;
    applyTyping();
  };

  /** Writes what was typed, as one Undo step per field; the viewer leaves the element as it is. */
  const applyTyping = () => {
    if (!editing || isEmptyDraft(editing.draft)) return;
    const current = editing;
    const lines = printBlock(current.draft);
    if (sameLines(lines, linesOf(current.range))) return;
    held = true;
    const change = apply((text) => replaceRange(text, current.range, lines), "inplace", `inplace:${current.start}:${typingKey}`);
    current.range = change.range;
    selected = change.range;
  };

  /** Writes a change that alters how the block looks (a pick, a role, a colour): the block is drawn and decorated again. */
  const applyStructural = (draft: BlockDraft) => {
    if (!editing) return;
    window.clearTimeout(typingTimer);
    typingTimer = 0;
    const current = editing;
    current.draft = draft;
    const lines = printBlock(draft);
    if (!sameLines(lines, linesOf(current.range))) {
      held = false;
      try {
        const change = apply((text) => replaceRange(text, current.range, lines), "inplace");
        current.range = blockAt(current.start)?.src ?? change.range;
        selected = current.range;
      } finally {
        held = true;
      }
    }
    if (editing !== current) return;
    controller?.redrawBlock(current.start);
    decorateEditing();
    refreshExtras();
  };

  /** Puts the caret where the block was double-clicked, or in its first field. */
  const focusEditing = (focus: Focus) => {
    const element = editingElement();
    if (!element || !editing || focus.none) return;
    const fields = editFields(element);
    if (!fields.length) return;
    if (focus.point) {
      const range = caretAt(focus.point.x, focus.point.y);
      const field = range ? fieldOf(range.startContainer, element) : undefined;
      if (range && field) {
        field.focus({ preventScroll: true });
        setSelection(range);
        return;
      }
      // A double-click on a picture or a team isn't a wish to type.
      if (editing.draft.kind === "trainer" || editing.draft.kind === "encounter" || editing.draft.kind === "gifts" || editing.draft.kind === "items") return;
    }
    const field = (focus.entry !== undefined ? fields.find((candidate) => candidate.dataset.entry === String(focus.entry)) : undefined)
      ?? (focus.field ? fields.find((candidate) => candidate.dataset.edit === focus.field) : undefined)
      ?? fields[0]!;
    field.focus({ preventScroll: true });
    const range = document.createRange();
    // In a list, the first bullet's text (so typing doesn't replace the list itself).
    range.selectNodeContents(field.dataset.edit === "items" ? field.querySelector("li") ?? field : field);
    if (!focus.selectAll) range.collapse(focus.caret === "start");
    setSelection(range);
  };

  const editFields = (element: HTMLElement): HTMLElement[] =>
    [element, ...element.querySelectorAll<HTMLElement>("[data-edit]")].filter((candidate) => candidate.dataset.edit !== undefined && !candidate.hidden);

  const fieldOf = (node: Node, element: HTMLElement): HTMLElement | undefined => {
    const start = node instanceof HTMLElement ? node : node.parentElement;
    const field = start?.closest<HTMLElement>("[data-edit]");
    return field && element.contains(field) ? field : undefined;
  };

  /** Enter in a paragraph: the text after the caret becomes a paragraph of its own (a new one when there is none). */
  const splitParagraph = (field: HTMLElement) => {
    if (!editing) return;
    const range = currentRange(field);
    if (!range) return;
    const before = document.createRange();
    before.selectNodeContents(field);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(field);
    after.setStart(range.endContainer, range.endOffset);
    const head = inlineMarkdown(before.cloneContents()).trimEnd();
    const tail = inlineMarkdown(after.cloneContents()).trim();
    if (!head) return;
    window.clearTimeout(typingTimer);
    typingTimer = 0;
    const { start, range: lines } = editing;
    editing = undefined;
    apply((text) => replaceRange(text, lines, [head, tail || "New text"]), "menu");
    startEditing(start + 1, tail ? { caret: "start" } : { selectAll: true });
  };

  /** Enter in a list: a new bullet with the text after the caret; on an empty bullet, the list is done. */
  const newBullet = (field: HTMLElement) => {
    if (!editing) return;
    const range = currentRange(field);
    const item = (range?.startContainer instanceof HTMLElement ? range.startContainer : range?.startContainer.parentElement)?.closest("li");
    if (!range || !item || !field.contains(item)) return;
    if (!plainText(item).trim()) {
      if (field.children.length > 1) {
        item.remove();
        readField(editing.draft, field);
        scheduleTyping("items");
      }
      endEditing();
      return;
    }
    const rest = document.createRange();
    rest.selectNodeContents(item);
    rest.setStart(range.endContainer, range.endOffset);
    const next = document.createElement("li");
    next.append(rest.extractContents());
    item.after(next);
    const caret = document.createRange();
    caret.setStart(next, 0);
    caret.collapse(true);
    setSelection(caret);
    readField(editing.draft, field);
    scheduleTyping("items");
    layout();
  };

  /** Backspace at the start of an empty bullet removes it. */
  const removeEmptyBullet = (field: HTMLElement, event: KeyboardEvent) => {
    if (!editing) return;
    const range = currentRange(field);
    const item = (range?.startContainer instanceof HTMLElement ? range.startContainer : range?.startContainer.parentElement)?.closest("li");
    if (!item || plainText(item).trim() || field.children.length < 2) return;
    event.preventDefault();
    const previous = item.previousElementSibling ?? item.nextElementSibling;
    item.remove();
    if (previous) {
      const caret = document.createRange();
      caret.selectNodeContents(previous);
      caret.collapse(false);
      setSelection(caret);
    }
    readField(editing.draft, field);
    scheduleTyping("items");
    layout();
  };

  /** Paragraph ↔ bullet list. A list becomes one paragraph per bullet. */
  const convertText = (to: "text" | "list") => {
    if (!editing) return;
    const draft = editing.draft;
    if (to === "list" && draft.kind === "text") applyStructural({ kind: "list", items: [draft.text] });
    if (to === "text" && draft.kind === "list") applyStructural({ kind: "text", text: draft.items.filter((item) => item.trim()).join("\n") || "New text" });
    focusEditing({});
  };

  // ---------- Links ----------

  /** Link in the toolbar: the selected text becomes a link, or the link at the caret opens. */
  const linkAction = () => {
    const element = editingElement();
    if (!editing || !element) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const field = (active && element.contains(active) ? active.closest<HTMLElement>("[data-rich]") : undefined) ?? element.querySelector<HTMLElement>("[data-rich]") ?? (element.dataset.rich ? element : undefined);
    if (!field) return;
    let range = currentRange(field);
    if (!range) {
      field.focus({ preventScroll: true });
      range = document.createRange();
      range.selectNodeContents(field.dataset.edit === "items" ? field.querySelector("li:last-child") ?? field : field);
      range.collapse(false);
    }
    const existing = (range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement)?.closest("a");
    if (existing && field.contains(existing)) {
      openLinkPopover(existing, field);
      return;
    }
    const text = range.toString().trim() || "link";
    const holder = document.createElement("span");
    holder.innerHTML = linkHtml(text, "");
    const link = holder.firstElementChild as HTMLAnchorElement;
    range.deleteContents();
    range.insertNode(link);
    readField(editing.draft, field);
    openLinkPopover(link, field, true);
  };

  const openLinkPopover = (link: HTMLAnchorElement, field: HTMLElement, isNew = false) => {
    closePopover();
    const pageElement = article();
    if (!pageElement || !editing) return;
    const element = document.createElement("div");
    element.className = "mse-pop -link";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", "Link");
    element.innerHTML = `
      <label class="mse-pop__label">Text<span class="msv-search"><input data-link-text value="${esc(link.textContent ?? "")}" autocomplete="off"></span></label>
      <label class="mse-pop__label">Address<span class="msv-search"><input data-link-href value="${esc(link.dataset.href ?? "")}" placeholder="https://…" autocomplete="off" spellcheck="false"></span></label>
      <div class="mse-pop__actions">${button("Remove link", "link-remove")}${button("Done", "link-done", "fight")}</div>`;
    pageElement.append(element);
    popover = { kind: "link", element, anchor: link, query: "", context: {}, pick: () => undefined, timer: 0 };
    link.classList.add("-open");
    const update = () => {
      if (!editing) return;
      readField(editing.draft, field);
      scheduleTyping(field.dataset.edit ?? "link");
    };
    const finish = () => {
      closePopover();
      if (!link.isConnected) return;
      field.focus({ preventScroll: true });
      const caret = document.createRange();
      caret.setStartAfter(link);
      caret.collapse(true);
      setSelection(caret);
    };
    element.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches("[data-link-text]")) link.textContent = input.value;
      if (input.matches("[data-link-href]")) {
        link.dataset.href = input.value.trim();
        link.setAttribute("href", /^(https?:|mailto:|#)/iu.test(input.value.trim()) ? input.value.trim() : "#");
      }
      update();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish();
      }
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "link-remove") {
        link.replaceWith(document.createTextNode(link.textContent ?? ""));
        update();
        closePopover();
        field.focus({ preventScroll: true });
      }
      if (action === "link-done") finish();
    });
    placePopover();
    element.querySelector<HTMLInputElement>(isNew ? "[data-link-href]" : "[data-link-text]")?.focus({ preventScroll: true });
  };

  // ---------- Pickers ----------

  const openPicker = (kind: PickerKind, anchor: HTMLElement, context: PickerContext, pick: (value: string) => void) => {
    closePopover();
    const pageElement = article();
    if (!pageElement) return;
    const element = document.createElement("div");
    element.className = `mse-pop -${kind}`;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", pickerPlaceholder(kind));
    element.innerHTML = `<span class="msv-search"><input type="search" data-pop-query placeholder="${esc(pickerPlaceholder(kind))}" aria-label="${esc(pickerPlaceholder(kind))}" autocomplete="off" spellcheck="false"></span><div class="mse-pop__body"></div>`;
    pageElement.append(element);
    popover = { kind, element, anchor, query: "", context, pick, timer: 0 };
    anchor.classList.add("-open");
    element.addEventListener("input", (event) => {
      const current = popover;
      if (!current || !(event.target as HTMLElement).matches("[data-pop-query]")) return;
      current.query = (event.target as HTMLInputElement).value;
      window.clearTimeout(current.timer);
      current.timer = window.setTimeout(renderPopoverBody, 70);
    });
    element.addEventListener("keydown", (event) => {
      const options = [...element.querySelectorAll<HTMLElement>("[data-pick-value]")];
      const at = options.findIndex((option) => option.classList.contains("-active"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = options[Math.max(0, Math.min(options.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
        options.forEach((option) => option.classList.toggle("-active", option === next));
        next?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const choice = options[at] ?? options[0];
        if (choice) choose(choice.dataset.pickValue!);
      }
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const choice = (event.target as HTMLElement).closest<HTMLElement>("[data-pick-value]");
      if (choice) choose(choice.dataset.pickValue!);
    });
    renderPopoverBody();
    placePopover();
    element.querySelector<HTMLInputElement>("[data-pop-query]")?.focus({ preventScroll: true });
  };

  const choose = (value: string) => {
    const current = popover;
    closePopover();
    current?.pick(value);
  };

  const renderPopoverBody = () => {
    if (!popover || popover.kind === "link") return;
    const body = popover.element.querySelector<HTMLElement>(".mse-pop__body")!;
    body.innerHTML = renderPicker(host, popover.kind, popover.query, popover.context);
    controller?.hydrate(body);
    body.querySelector("[data-pick-value]")?.classList.add("-active");
  };

  /** Under what it changes, inside the page's column. */
  const placePopover = () => {
    if (!popover) return;
    const pageElement = popover.element.parentElement;
    if (!pageElement || !popover.anchor.isConnected) return;
    const base = pageElement.getBoundingClientRect();
    const box = popover.anchor.getBoundingClientRect();
    const width = popover.element.offsetWidth;
    popover.element.style.top = `${box.bottom - base.top + 8}px`;
    popover.element.style.left = `${Math.max(8, Math.min(box.left - base.left, pageElement.clientWidth - width - 8))}px`;
  };

  function closePopover() {
    if (!popover) return;
    window.clearTimeout(popover.timer);
    popover.anchor.classList.remove("-open");
    popover.element.remove();
    popover = undefined;
  }

  /** The picks a block being edited offers, by what was clicked in it. */
  const pickInBlock = (target: HTMLElement): boolean => {
    if (!editing) return false;
    const kind = editing.draft.kind;
    /** The draft as it is when the pick is made: typing may have changed it since the picker opened. */
    const now = () => editing?.draft;
    const open = target.closest<HTMLElement>("[data-pick-open]");
    const role = target.closest<HTMLElement>("[data-role]");
    if (kind === "trainer" || kind === "encounter") {
      const draft = editing.draft as Extract<BlockDraft, { kind: "trainer" | "encounter" }>;
      if (open) {
        openPicker(kind === "trainer" ? "trainer" : "table", open, { current: draft.ref }, (value) => {
          const latest = now();
          if (latest?.kind === "trainer" || latest?.kind === "encounter") applyStructural({ ...latest, ref: value });
        });
        return true;
      }
      if (role && draft.kind === "trainer") {
        applyStructural({ ...draft, mandatory: role.dataset.role === "mandatory" });
        return true;
      }
      return false;
    }
    if (kind !== "items" && kind !== "gifts") return false;
    const list = () => {
      const latest = now();
      return latest?.kind === "items" || latest?.kind === "gifts" ? latest : undefined;
    };
    const picker: PickerKind = kind === "items" ? "item" : "species";
    const entryButton = target.closest<HTMLElement>("[data-entry-icon], [data-entry-species]");
    if (entryButton) {
      const at = Number(entryButton.dataset.entryIcon ?? entryButton.dataset.entrySpecies);
      const entry = list()?.entries[at];
      if (!entry) return true;
      openPicker(picker, entryButton, { current: entry.name }, (value) => {
        const latest = list();
        if (latest) applyStructural({ ...latest, entries: latest.entries.map((candidate, n) => (n === at ? { ...candidate, name: value } : candidate)) });
      });
      return true;
    }
    const add = target.closest<HTMLElement>("[data-add-entry]");
    if (add) {
      openPicker(picker, add, {}, (value) => {
        const latest = list();
        if (!latest) return;
        applyStructural({ ...latest, entries: [...latest.entries, { name: value, note: "" }] });
        focusEditing({ field: "note", entry: latest.entries.length });
      });
      return true;
    }
    const remove = target.closest<HTMLElement>("[data-remove-entry]");
    const latest = list();
    if (remove && latest) {
      const at = Number(remove.dataset.removeEntry);
      applyStructural({ ...latest, entries: latest.entries.filter((_, n) => n !== at) });
      return true;
    }
    return false;
  };

  // ---------- Adding blocks ----------

  const kindsGrid = () => `<div class="mse-kinds">${ADD_KINDS.map(([kind, label, hint, colour]) => `
    <button type="button" class="mse-kind" data-add-kind="${kind}"><i style="background:${colour}"></i><b>${esc(label)}</b><small>${esc(hint)}</small></button>`).join("")}</div>`;

  const openAdd = (line: number) => {
    endEditing();
    dropPending();
    closePopover();
    adding?.strip?.remove();
    adding = { line };
    refreshExtras();
    adding.strip?.querySelector<HTMLElement>("[data-add-kind]")?.focus({ preventScroll: true });
  };

  function closeAdd() {
    adding?.strip?.remove();
    adding = undefined;
  }

  const insertNew = (kind: BlockKind, line: number) => {
    endEditing();
    closeAdd();
    closePopover();
    if (kind === "trainer" || kind === "encounter") {
      pending = { kind, at: line, mandatory: false };
      selected = undefined;
      refreshExtras();
      const pick = pending.card?.querySelector<HTMLElement>("[data-pick-open]");
      if (pick) openPendingPicker(pick);
      return;
    }
    const change = apply((text) => insertBlockLines(text, line, printBlock(emptyBlock(kind))), "menu");
    startEditing(change.range.start, { selectAll: true, field: kind === "items" || kind === "gifts" || kind === "notice" ? "title" : undefined });
  };

  const openPendingPicker = (anchor: HTMLElement) => {
    if (!pending) return;
    openPicker(pending.kind === "trainer" ? "trainer" : "table", anchor, {}, (value) => {
      if (!pending) return;
      const draft: BlockDraft = pending.kind === "trainer" ? { kind: "trainer", ref: value, mandatory: pending.mandatory, notes: "" } : { kind: "encounter", ref: value };
      const at = pending.at;
      dropPending();
      const change = apply((text) => insertBlockLines(text, at, printBlock(draft)), "menu");
      startEditing(change.range.start, { none: true });
    });
  };

  function dropPending() {
    pending?.card?.remove();
    pending = undefined;
  }

  // ---------- Page decorations ----------

  const decorate = (hostElement: HTMLElement, current: MsPage | undefined) => {
    const pageElement = hostElement.querySelector<HTMLElement>(":scope > .msv-page");
    if (current?.id !== decoratedPage) {
      // Another page: what was edited, added or picked on the last one stays behind (typing is written first).
      if (editing && typingTimer) {
        const left = editing;
        window.clearTimeout(typingTimer);
        typingTimer = 0;
        if (!isEmptyDraft(left.draft)) window.setTimeout(() => apply((text) => replaceRange(text, left.range, printBlock(left.draft)), "other"), 0);
      }
      decoratedPage = current?.id;
      editing = undefined;
      pending = undefined;
      adding = undefined;
      selected = undefined;
      hovered = undefined;
      headerEdit = undefined;
      closePopover();
      fillKey = "";
      fillNodes = [];
    }
    pageElement?.classList.toggle("mse-page", active);
    if (!active || !pageElement || !current) {
      overlay?.remove();
      overlay = undefined;
      resizeObserver?.disconnect();
      return;
    }
    cleanupLeftovers(pageElement);
    ensureOverlay(pageElement);
    decorateHeader(pageElement, current);
    decorateEditing();
    placeExtras(pageElement, current);
    if (titleEditFor === current.id) {
      titleEditFor = undefined;
      const title = pageElement.querySelector<HTMLElement>(':scope > header [data-header-edit="title"]');
      if (title) editHeader(title);
    }
    layout();
  };

  /** Blocks still decorated from an edit that ended (an undo, another page's patch) are drawn plainly again. */
  const cleanupLeftovers = (pageElement: HTMLElement) => {
    const starts = new Set<number>();
    for (const element of pageElement.querySelectorAll<HTMLElement>(":scope > .mse-editing, :scope > [data-block][hidden]")) {
      const block = blockOf(element);
      if (block && block.src.start !== editing?.start) starts.add(block.src.start);
    }
    for (const start of starts) controller?.redrawBlock(start);
  };

  const ensureOverlay = (pageElement: HTMLElement) => {
    if (overlay && overlay.parentElement === pageElement) return;
    overlay?.remove();
    overlay = document.createElement("div");
    overlay.className = "mse-overlay";
    overlay.innerHTML = `
      <div class="mse-frame -hover" hidden></div>
      <div class="mse-frame -selected" hidden></div>
      <div class="mse-grips"></div>
      <div class="mse-badges"></div>
      <div class="mse-addline" hidden><button type="button" class="msv-hex -nav mse-addline__button" data-add-gap><span>+ Add</span></button></div>
      <div class="mse-tools" role="toolbar" aria-label="Block" hidden></div>`;
    pageElement.append(overlay);
    toolsKey = "";
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => layout());
    resizeObserver.observe(pageElement);
  };

  /** The page's title, its split's name and level cap can be renamed where they show, with a double-click. */
  const decorateHeader = (pageElement: HTMLElement, current: MsPage) => {
    const header = pageElement.querySelector<HTMLElement>(":scope > header");
    if (!header || header.dataset.decorated) return;
    header.dataset.decorated = "true";
    const split = splitOf(current);
    const title = header.querySelector<HTMLElement>("h1");
    if (title && current.headingLine !== undefined) {
      title.dataset.headerEdit = "title";
      title.title = "Double-click to rename";
    }
    if (!split) return;
    let meta = header.querySelector<HTMLElement>(".msv-titlebar__meta");
    if (!meta) {
      meta = document.createElement("p");
      meta.className = "msv-titlebar__meta";
      title?.after(meta);
    }
    const name = meta.querySelector<HTMLElement>(":scope > span:not(.msv-plate)");
    if (name) {
      name.dataset.headerEdit = "split";
      name.title = "Double-click to rename the split";
    }
    let plate = meta.querySelector<HTMLElement>(".msv-plate");
    if (!plate) {
      plate = document.createElement("span");
      plate.className = "msv-plate mse-ghostplate";
      plate.textContent = "+ Level cap";
      meta.append(plate);
    }
    plate.dataset.headerEdit = "detail";
    plate.title = "Double-click to change the split's level cap";
  };

  /** Puts the editor's own pieces where they go: the empty page's choices, Fill, the add strip, a new trainer or table. */
  const placeExtras = (pageElement: HTMLElement, current: MsPage) => {
    const tail = pageElement.querySelector<HTMLElement>(":scope > .msv-page__tail");
    pageElement.querySelector(":scope > .mse-empty")?.remove();
    if (!current.blocks.length) {
      const empty = document.createElement("div");
      empty.className = "mse-empty";
      empty.dataset.line = String(endOfPage(current));
      empty.innerHTML = `<p>Nothing on this page yet. Add something here${current.kind === "area" ? ", or fill it from the ROM" : ""}.</p>${kindsGrid()}${current.kind === "area" && !fillOn ? `<div>${button("Fill from ROM", "fill")}</div>` : ""}`;
      pageElement.insertBefore(empty, tail);
    }
    placeFill(pageElement, current);
    const end = pageElement.querySelector<HTMLElement>(":scope > .mse-ghosts") ?? pageElement.querySelector<HTMLElement>(":scope > .mse-empty") ?? tail;
    const elements = blockElements();
    const before = (line: number) => {
      const n = current.blocks.findIndex((block) => block.src.start >= line);
      return (n >= 0 ? elements[n] : undefined) ?? end;
    };
    if (adding && current.blocks.length) {
      if (!adding.strip) {
        adding.strip = document.createElement("div");
        adding.strip.className = "mse-addstrip";
        adding.strip.setAttribute("role", "group");
        adding.strip.setAttribute("aria-label", "Add here");
        adding.strip.innerHTML = `<div class="mse-addstrip__head"><span>Add here</span><button type="button" class="mse-link" data-addstrip-close>Cancel</button></div>${kindsGrid()}`;
      }
      const spot = before(adding.line);
      if (adding.strip.nextElementSibling !== spot) pageElement.insertBefore(adding.strip, spot);
    }
    if (pending) {
      if (!pending.card) {
        pending.card = pending.kind === "trainer" ? trainerCard(pending.mandatory) : tableCard();
        pending.card.classList.add("mse-pending");
      }
      const spot = before(pending.at);
      if (pending.card.nextElementSibling !== spot) pageElement.insertBefore(pending.card, spot);
    }
  };

  const refreshExtras = () => {
    const current = page();
    const pageElement = article();
    if (!current || !pageElement || !active) return;
    placeExtras(pageElement, current);
    layout();
  };

  // ---------- Fill from the ROM ----------

  /** Fill's note under the title and its suggestions where each would go; rebuilt only when what they say changes. */
  const placeFill = (pageElement: HTMLElement, current: MsPage) => {
    if (!fillOn) {
      removeFill();
      return;
    }
    const state = current.kind === "area" ? fillState(host, current) : undefined;
    const banner = fillBanner(host, current, state, { showSkipped });
    const skippedKeys = new Set(state?.skipped.map((candidate) => candidate.key) ?? []);
    const shown: Candidate[] = state ? [...state.missing, ...(showSkipped ? state.skipped : [])] : [];
    const cards = shown.filter((candidate) => candidate.kind !== "item").map((candidate) => ghostCard(host, candidate, skippedKeys.has(candidate.key))).join("");
    const items = shown.flatMap((candidate) => (candidate.kind === "item" ? [ghostItem(candidate, skippedKeys.has(candidate.key))] : [])).join("");
    const list = current.blocks.findIndex((block) => block.kind === "items");
    const grid = list >= 0 ? blockElements()[list]?.querySelector<HTMLElement>(".msv-bag-grid") : undefined;
    const key = `${banner}${cards}${items}${list}`;
    const header = pageElement.querySelector<HTMLElement>(":scope > header");
    const tail = pageElement.querySelector<HTMLElement>(":scope > .msv-page__tail");
    const end = () => pageElement.querySelector<HTMLElement>(":scope > .mse-empty") ?? tail;
    if (key === fillKey && fillNodes.length && fillNodes.every((node) => node.isConnected)) {
      // Same suggestions: only keep them in place (blocks added at the end go above the suggested cards).
      const ghosts = pageElement.querySelector<HTMLElement>(":scope > .mse-ghosts");
      if (ghosts && ghosts.nextElementSibling !== end()) pageElement.insertBefore(ghosts, end());
    } else {
      removeFill();
      fillKey = key;
      const make = (html: string) => {
        const holder = document.createElement("div");
        holder.innerHTML = html.trim();
        return holder.firstElementChild as HTMLElement;
      };
      const bannerNode = make(banner);
      header?.after(bannerNode);
      fillNodes.push(bannerNode);
      if (cards) {
        const ghosts = document.createElement("div");
        ghosts.className = "mse-ghosts";
        ghosts.innerHTML = cards;
        pageElement.insertBefore(ghosts, end());
        fillNodes.push(ghosts);
      }
      if (items && grid) {
        const holder = document.createElement("ul");
        holder.innerHTML = items;
        const add = grid.querySelector(":scope > .mse-addtile");
        for (const tile of [...holder.children] as HTMLElement[]) {
          grid.insertBefore(tile, add);
          fillNodes.push(tile);
        }
      } else if (items) {
        const group = make(ghostItemGroup(items));
        bannerNode.after(group);
        fillNodes.push(group);
      }
      for (const node of fillNodes) controller?.hydrate(node);
    }
    if (zonePickerWanted && current.kind === "area" && state) {
      zonePickerWanted = false;
      const anchor = pageElement.querySelector<HTMLElement>(".mse-fill [data-zone-picker]");
      if (anchor) window.requestAnimationFrame(() => openZonePicker(anchor));
    }
  };

  function removeFill() {
    for (const node of fillNodes) node.remove();
    fillNodes = [];
    fillKey = "";
  }

  const setFill = (on: boolean) => {
    fillOn = on;
    if (on) readyIndex();
    renderBar();
    refreshExtras();
  };

  const setZones = (zones: number[]) => {
    const current = page();
    if (!current || current.kind !== "area") return;
    apply((text) => setPageZones(text, current, [...new Set(zones)]), "menu");
  };

  const openZonePicker = (anchor: HTMLElement) => {
    openPicker("zone", anchor, {}, (value) => {
      const current = page();
      const ready = readyIndex();
      if (!current) return;
      setZones([...(ready ? pageZones(ready, current).zoneIds : current.zones), Number(value)]);
    });
  };

  /** Fill's buttons in the page: add one or all, not needed, needed after all, zones. */
  const fillClick = (target: HTMLElement): boolean => {
    const current = page();
    if (!current) return false;
    const add = target.closest<HTMLElement>("[data-fill-add]");
    const all = target.closest<HTMLElement>("[data-fill-all]");
    if (add || all) {
      const state = fillState(host, current);
      const keys = add ? [add.dataset.fillAdd!] : state?.missing.map((candidate) => candidate.key) ?? [];
      const change = fillChange(host, current, session.source, keys);
      if (change) apply(() => change, "menu");
      return true;
    }
    const skip = target.closest<HTMLElement>("[data-fill-skip], [data-fill-unskip]");
    if (skip) {
      const key = skip.dataset.fillSkip ?? skip.dataset.fillUnskip!;
      const keys = skip.dataset.fillSkip ? [...current.skips, key] : current.skips.filter((candidate) => candidate !== key);
      apply((text) => setPageSkips(text, current, keys), "menu");
      return true;
    }
    if (target.closest("[data-fill-show-skipped]")) {
      showSkipped = !showSkipped;
      refreshExtras();
      return true;
    }
    const unlink = target.closest<HTMLElement>("[data-unlink-zone]");
    if (unlink) {
      setZones(current.zones.filter((zone) => zone !== Number(unlink.dataset.unlinkZone)));
      return true;
    }
    const suggested = target.closest<HTMLElement>("[data-link-suggested]");
    if (suggested) {
      setZones(suggested.dataset.linkSuggested!.split(",").map(Number));
      return true;
    }
    const picker = target.closest<HTMLElement>("[data-zone-picker]");
    if (picker) {
      openZonePicker(picker);
      return true;
    }
    return false;
  };

  // ---------- Frame, toolbar and grips ----------

  /** Places what is drawn over the page: it lives in an overlay, as bands and tiles clip what is inside them. */
  const layout = () => {
    if (!overlay) return;
    const current = page();
    const elements = blockElements();
    const grips = overlay.querySelector<HTMLElement>(".mse-grips")!;
    if (grips.children.length !== elements.length) {
      grips.innerHTML = elements.map((_, n) => `<span class="mse-grip" draggable="true" data-drag-block="${n}" title="Drag to move">${GRIP}</span>`).join("");
    }
    elements.forEach((element, n) => {
      const grip = grips.children[n] as HTMLElement;
      grip.hidden = element.hidden;
      grip.style.top = `${element.offsetTop + 4}px`;
    });
    const target = targetElement();
    // Room under the selected block for its toolbar, so it doesn't cover the next one.
    overlay.parentElement?.querySelectorAll<HTMLElement>(":scope > .mse-room").forEach((element) => {
      if (element === target) return;
      element.classList.remove("mse-room");
      element.style.removeProperty("--mse-room");
    });
    target?.classList.add("mse-room");
    placeFrame(overlay.querySelector(".mse-frame.-selected")!, target);
    const hover = hovered === undefined ? undefined : elements[hovered];
    placeFrame(overlay.querySelector(".mse-frame.-hover")!, hover && hover !== target && !hover.hidden ? hover : undefined);
    const first = elements.find((element) => !element.hidden);
    if (first) {
      overlay.style.setProperty("--mse-left", `${first.offsetLeft}px`);
      overlay.style.setProperty("--mse-right", `${overlay.offsetWidth - first.offsetLeft - first.offsetWidth}px`);
    }
    placeTools(target, current);
    placeBadges();
    placePopover();
  };

  const placeFrame = (frame: HTMLElement, element: HTMLElement | undefined) => {
    frame.hidden = !element;
    if (!element) return;
    frame.style.top = `${element.offsetTop}px`;
    frame.style.left = `${element.offsetLeft}px`;
    frame.style.width = `${element.offsetWidth}px`;
    frame.style.height = `${element.offsetHeight}px`;
  };

  /** The selected block's toolbar sits on the frame's bottom edge, at its right: the top holds what is edited. */
  const placeTools = (target: HTMLElement | undefined, current: MsPage | undefined) => {
    const tools = overlay!.querySelector<HTMLElement>(".mse-tools")!;
    const key = target && current ? toolsSignature(current) : "";
    if (key !== toolsKey) {
      tools.innerHTML = key ? toolsHtml(current!) : "";
      toolsKey = key;
    }
    tools.hidden = !tools.innerHTML;
    if (tools.hidden || !target) return;
    // No wider than the block: a long toolbar wraps under itself instead of running off the page.
    // Measured from the block's left edge, where it has all the room it may take, then moved to the right edge.
    tools.style.maxWidth = `${target.offsetWidth}px`;
    tools.style.top = `${target.offsetTop + target.offsetHeight - 4}px`;
    tools.style.left = `${target.offsetLeft}px`;
    tools.style.left = `${Math.max(target.offsetLeft, target.offsetLeft + target.offsetWidth - tools.offsetWidth)}px`;
    // A toolbar that wraps (narrow windows) gets the room it takes.
    const room = `${Math.max(48, tools.offsetHeight + 18)}px`;
    if (target.style.getPropertyValue("--mse-room") !== room) target.style.setProperty("--mse-room", room);
  };

  /** What the toolbar offers, without the colour being typed (redrawing it would take the field's focus). */
  const toolsSignature = (current: MsPage): string => {
    if (pending) return `pending:${pending.kind}`;
    const start = editing?.start ?? selected?.start;
    const n = current.blocks.findIndex((block) => block.src.start === start);
    const block = current.blocks[n];
    if (!block) return "";
    const draft = editing?.draft;
    return JSON.stringify([start, blockLabel(block), draft?.kind, draft?.kind === "heading" ? draft.level : draft?.kind === "notice" ? draft.frame || "sign" : 0, Boolean(previousBlock(current, n)), Boolean(nextBlock(current, n))]);
  };

  const toolsHtml = (current: MsPage): string => {
    if (pending) return `<span class="mse-tools__label">${pending.kind === "trainer" ? "New trainer" : "New wild Pokémon"}</span><button type="button" data-block-act="cancel">Cancel</button>`;
    const start = editing?.start ?? selected?.start;
    const n = current.blocks.findIndex((block) => block.src.start === start);
    const block = current.blocks[n];
    if (!block) return "";
    const draft = editing?.draft;
    return `<span class="mse-tools__label">${esc(blockLabel(block))}</span>
      ${draft ? kindControls(draft) : ""}
      <button type="button" class="-primary" data-block-act="${draft ? "done" : "edit"}" title="${draft ? "Done (Esc)" : "Edit (Enter, or double-click)"}">${draft ? "Done" : "Edit"}</button>
      <button type="button" data-block-act="up" title="Move up" aria-label="Move up"${previousBlock(current, n) ? "" : " disabled"}>${ARROW_UP}</button>
      <button type="button" data-block-act="down" title="Move down" aria-label="Move down"${nextBlock(current, n) ? "" : " disabled"}>${ARROW_DOWN}</button>
      <button type="button" data-block-act="duplicate">Duplicate</button>
      <button type="button" class="-danger" data-block-act="delete">Delete</button>`;
  };

  const blockLabel = (block: MsBlock): string => {
    if (block.kind === "trainer") return `Trainer #${block.trainerId}`;
    if (block.kind === "encounter") return `Wild Pokémon · table ${block.tableId}`;
    return BLOCK_LABELS[block.kind];
  };

  const kindControls = (draft: BlockDraft): string => {
    const toggle = (action: string, label: string, on: boolean) => `<button type="button" data-block-act="${action}" aria-pressed="${on}">${label}</button>`;
    switch (draft.kind) {
      case "text":
      case "list":
        return `${toggle("as-text", "Paragraph", draft.kind === "text")}${toggle("as-list", "Bullet list", draft.kind === "list")}<button type="button" data-block-act="link" title="Make the selected text a link">Link</button>`;
      case "heading":
        return `${toggle("level-3", "Section", draft.level === 3)}${toggle("level-4", "Subsection", draft.level === 4)}`;
      case "notice": {
        // The game's text boxes; a sign offers the game's four sign colours first.
        const frame = draft.frame || "sign";
        const swatches = [...(frame === "sign" ? SIGN_COLOURS.map(({ colour, name }) => ({ colour, name: `${name} sign` })) : []), ...noticeColours().map((colour) => ({ colour, name: colour }))]
          .filter((swatch, n, all) => all.findIndex((other) => sameColour(other.colour, swatch.colour)) === n).slice(0, 10);
        return `${toggle("frame-sign", "Signpost", frame === "sign")}${toggle("frame-system", "System box", frame === "system")}
          <span class="mse-swatches">${swatches.map(({ colour, name }) => `<button type="button" class="mse-swatch${sameColour(colour, draft.color) ? " -on" : ""}" data-colour="${esc(colour)}" style="--swatch:${esc(colour)}" title="${esc(name)}" aria-label="Colour: ${esc(name)}"></button>`).join("")}
          <button type="button" class="mse-swatch -none${draft.color ? "" : " -on"}" data-colour="" title="The game's own colours" aria-label="The game's own colours"></button>
          <input class="mse-hexinput" data-tool-colour value="${esc(draft.color)}" placeholder="#af74b3" aria-label="Colour" spellcheck="false" autocomplete="off"></span>`;
      }
      default:
        return "";
    }
  };

  const noticeColours = (): string[] => {
    const used = doc().pages.flatMap((entry) => entry.blocks.flatMap((block) => (block.kind === "notice" && block.color ? [block.color] : [])));
    const seen = new Set<string>();
    return [...used, ...NOTICE_COLOURS].filter((colour) => {
      const key = colour.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  };

  const setNoticeColour = (colour: string, typed = false) => {
    if (!editing || editing.draft.kind !== "notice") return;
    const draft = { ...editing.draft, color: colour.trim() };
    const tools = overlay?.querySelector<HTMLElement>(".mse-tools");
    tools?.querySelectorAll<HTMLElement>("[data-colour]").forEach((swatch) => swatch.classList.toggle("-on", sameColour(swatch.dataset.colour ?? "", draft.color)));
    if (!typed) {
      const input = tools?.querySelector<HTMLInputElement>("[data-tool-colour]");
      if (input) input.value = draft.color;
      applyStructural(draft);
      return;
    }
    // Typing a colour: the notice follows as it is typed, and the field keeps its focus.
    editing.draft = draft;
    const element = editingElement();
    const vars = noticeFrameVars(draft.frame || "sign", NOTICE_COLOUR.test(draft.color) ? draft.color : undefined);
    if (element) for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value);
    scheduleTyping("colour");
  };

  /** Each entry's remove button, outside its tile (tiles clip what is inside them). */
  const placeBadges = () => {
    const badges = overlay!.querySelector<HTMLElement>(".mse-badges")!;
    const element = editingElement();
    const entries = element && (editing?.draft.kind === "items" || editing?.draft.kind === "gifts") ? [...element.querySelectorAll<HTMLElement>("[data-entry-at]")] : [];
    if (badges.children.length !== entries.length) {
      badges.innerHTML = entries.map((entry) => `<button type="button" class="mse-entryx" data-remove-entry="${entry.dataset.entryAt}" title="Remove" aria-label="Remove">×</button>`).join("");
    }
    if (!entries.length) return;
    const base = overlay!.getBoundingClientRect();
    entries.forEach((entry, n) => {
      const badge = badges.children[n] as HTMLElement;
      const box = entry.getBoundingClientRect();
      badge.dataset.removeEntry = entry.dataset.entryAt;
      badge.style.top = `${box.top - base.top - 10}px`;
      badge.style.left = `${box.right - base.left - 14}px`;
    });
  };

  /** The gaps where a block can go: before each block, and after the last. */
  const gaps = (): Array<{ y: number; line: number }> => {
    const current = page();
    const pageElement = overlay?.parentElement;
    if (!current || !pageElement) return [];
    const elements = blockElements();
    const header = pageElement.querySelector<HTMLElement>(":scope > header");
    const top = header ? header.offsetTop + header.offsetHeight : 0;
    const list: Array<{ y: number; line: number }> = [];
    let above: HTMLElement | undefined;
    elements.forEach((element, n) => {
      if (element.hidden) return;
      const y = above ? (above.offsetTop + above.offsetHeight + element.offsetTop) / 2 : (top + element.offsetTop) / 2;
      list.push({ y, line: current.blocks[n]!.src.start });
      above = element;
    });
    if (above) list.push({ y: above.offsetTop + above.offsetHeight + 14, line: endOfPage(current) });
    return list;
  };

  const showAddLine = (gapIndex: number | undefined, drop = false) => {
    const line = overlay?.querySelector<HTMLElement>(".mse-addline");
    if (!line) return;
    const gap = gapIndex === undefined ? undefined : gaps()[gapIndex];
    line.hidden = !gap;
    line.classList.toggle("-drop", drop);
    if (gap) {
      line.style.top = `${gap.y}px`;
      line.dataset.gap = String(gapIndex);
    }
  };

  const nearestGap = (clientY: number, limit = 22): number | undefined => {
    const pageElement = overlay?.parentElement;
    if (!pageElement) return undefined;
    const y = clientY - pageElement.getBoundingClientRect().top;
    let best: number | undefined;
    let distance = limit;
    gaps().forEach((gap, n) => {
      const d = Math.abs(gap.y - y);
      if (d < distance) {
        distance = d;
        best = n;
      }
    });
    return best;
  };

  // ---------- Block toolbar ----------

  const blockAction = (action: string) => {
    if (action === "cancel") {
      dropPending();
      layout();
      return;
    }
    if (action === "link") return linkAction();
    if (action === "as-text" || action === "as-list") return convertText(action === "as-text" ? "text" : "list");
    if ((action === "frame-sign" || action === "frame-system") && editing?.draft.kind === "notice") {
      applyStructural({ ...editing.draft, frame: action === "frame-system" ? "system" : "" });
      return;
    }
    if ((action === "level-3" || action === "level-4") && editing?.draft.kind === "heading") {
      applyStructural({ ...editing.draft, level: action === "level-3" ? 3 : 4 });
      return;
    }
    const start = editing?.start ?? selected?.start;
    if (start === undefined) return;
    if (action === "edit") return startEditing(start);
    if (action === "done") {
      endEditing();
      return;
    }
    const wasEditing = Boolean(editing);
    if (action === "delete") {
      window.clearTimeout(typingTimer);
      typingTimer = 0;
      editing = undefined;
      const block = blockAt(start);
      selected = undefined;
      hovered = undefined;
      if (block) apply((text) => removeRange(text, block.src), "menu");
      return;
    }
    endEditing();
    const current = page();
    const n = current?.blocks.findIndex((candidate) => candidate.src.start === start) ?? -1;
    const block = current?.blocks[n];
    if (!current || !block) return;
    if (action === "up" || action === "down") {
      const other = action === "up" ? previousBlock(current, n) : nextBlock(current, n);
      if (!other) return;
      const change = apply((text) => swapRanges(text, block.src, other.src), "menu");
      selected = change.range;
      if (wasEditing) startEditing(change.range.start, { none: true });
      else layout();
      targetElement()?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (action === "duplicate") {
      const change = apply((text) => duplicateRange(text, block.src), "menu");
      select(change.range);
    }
  };

  // ---------- Header and outline renames ----------

  /** The heading line a page's title, its split's name or level cap is written on, with the new text. */
  const headingFor = (current: MsPage, which: HeaderEdit["which"], text: string): { line: number; heading: string } | undefined => {
    const split = splitOf(current);
    if (which === "title") {
      if (current.headingLine === undefined) return undefined;
      if (current.headingLine === doc().titleLine && current.id === doc().pages[0]?.id) return { line: current.headingLine, heading: `# ${text}` };
      if (split && split.headingLine === current.headingLine) return { line: split.headingLine, heading: splitHeading(text, split.detail ?? "") };
      return { line: current.headingLine, heading: areaHeading(text) };
    }
    if (!split) return undefined;
    return which === "split"
      ? { line: split.headingLine, heading: splitHeading(text, split.detail ?? "") }
      : { line: split.headingLine, heading: splitHeading(split.title, text) };
  };

  const editHeader = (element: HTMLElement) => {
    endEditing();
    commitHeader();
    const current = page();
    if (!current) return;
    const which = element.dataset.headerEdit as HeaderEdit["which"];
    const split = splitOf(current);
    const original = which === "title" ? current.title : which === "split" ? split?.title ?? "" : split?.detail ?? "";
    headerEdit = { element, which, original, shown: element.innerHTML };
    element.textContent = original;
    element.contentEditable = "true";
    element.spellcheck = true;
    element.classList.add("-editing");
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    setSelection(range);
    element.addEventListener("blur", () => commitHeader(), { once: true });
  };

  function commitHeader(cancel = false) {
    const edit = headerEdit;
    if (!edit) return;
    headerEdit = undefined;
    const text = plainText(edit.element).trim();
    edit.element.contentEditable = "false";
    edit.element.classList.remove("-editing");
    const current = page();
    const change = current && !cancel && text !== edit.original.trim() && (text || edit.which === "detail") ? headingFor(current, edit.which, text) : undefined;
    if (!change) {
      edit.element.innerHTML = edit.shown;
      return;
    }
    apply((source) => replaceHeading(source, change.line, change.heading), "menu");
  }

  /** Renames a page or split, or changes a split's level cap, in a field in the outline. */
  const renameInNav = (target: { pageId?: string; splitId?: string }, field: "name" | "detail" = "name") => {
    closeMenu();
    const nav = controller?.elements.nav;
    if (!nav) return;
    const current = doc();
    const pageTarget = target.pageId ? current.pages.find((candidate) => candidate.id === target.pageId) : undefined;
    const split = target.splitId ? current.allSplits.find((candidate) => candidate.id === target.splitId) : undefined;
    const holder = target.pageId
      ? nav.querySelector<HTMLElement>(`.msv-nav__link[data-page="${CSS.escape(target.pageId)}"]`)
      : nav.querySelector<HTMLElement>(`.msv-split[data-split="${CSS.escape(target.splitId ?? "")}"] > .msv-split__head`);
    if (!holder || (!pageTarget && !split)) return;
    const value = field === "detail" ? split?.detail ?? "" : pageTarget?.title ?? split?.title ?? "";
    const input = document.createElement("input");
    input.className = "mse-nav-input";
    input.value = value;
    input.placeholder = field === "detail" ? "Level Cap 15" : "Name";
    input.setAttribute("aria-label", field === "detail" ? "Level cap and notes" : "Name");
    input.spellcheck = false;
    holder.classList.add("mse-hidden");
    holder.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      holder.classList.remove("mse-hidden");
      if (!save || text === value.trim() || (!text && field === "name")) return;
      let change: { line: number; heading: string } | undefined;
      if (split) change = { line: split.headingLine, heading: field === "name" ? splitHeading(text, split.detail ?? "") : splitHeading(split.title, text) };
      else if (pageTarget) change = headingFor(pageTarget, "title", text);
      if (change) apply((source) => replaceHeading(source, change!.line, change!.heading), "menu");
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  };

  // ---------- Outline menus ----------

  function closeMenu() {
    menu?.remove();
    menu = undefined;
  }

  const placeMenu = (element: HTMLElement, anchor: HTMLElement | undefined) => {
    document.body.append(element);
    const box = anchor?.getBoundingClientRect() ?? { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 3, bottom: window.innerHeight / 3 };
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(8, Math.min(box.right + 6, window.innerWidth - width - 8));
    let top = box.top;
    if (top + height > window.innerHeight - 8) top = Math.max(8, box.bottom - height);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  };

  const menuItem = (action: string, label: string, hint = "", extra = "") => `<button type="button" class="mse-menu__item${extra}" role="menuitem" data-outline-act="${action}"><span class="mse-menu__name">${esc(label)}</span>${hint ? `<span class="mse-menu__hint">${esc(hint)}</span>` : ""}</button>`;

  const openPageMenu = (target: { pageId?: string; splitId?: string }, anchor: HTMLElement) => {
    closeMenu();
    const current = doc();
    menu = document.createElement("div");
    menu.className = "mse-menu";
    menu.setAttribute("role", "menu");
    if (target.splitId) {
      const split = current.allSplits.find((candidate) => candidate.id === target.splitId);
      if (!split) return;
      menu.dataset.split = split.id;
      menu.innerHTML = `<div class="mse-menu__head">${esc(split.title)}</div>
        ${menuItem("rename-split", "Rename")}
        ${menuItem("detail-split", "Level cap", split.detail ?? "None")}
        ${menuItem("add-area", "Add area")}
        ${menuItem("split-up", "Move up")}${menuItem("split-down", "Move down")}
        <div class="mse-menu__sep"></div>
        ${menuItem("delete-split", "Delete split…", `${split.pageIds.length} area${split.pageIds.length === 1 ? "" : "s"}`, " -danger")}`;
    } else {
      const target2 = current.pages.find((candidate) => candidate.id === target.pageId);
      if (!target2) return;
      menu.dataset.page = target2.id;
      const isArea = target2.kind === "area";
      const zones = target2.zones.length ? `zone ${target2.zones.join(", ")}` : "";
      const moveTo = current.allSplits.filter((split) => split.id !== target2.splitId);
      menu.innerHTML = `<div class="mse-menu__head">${esc(target2.title)}</div>
        ${target2.headingLine !== undefined ? menuItem("rename-page", "Rename") : ""}
        ${isArea ? menuItem("link-zones", "Link zones", zones) : ""}
        ${isArea ? `${menuItem("page-up", "Move up")}${menuItem("page-down", "Move down")}` : ""}
        ${isArea && moveTo.length ? `<div class="mse-menu__sub"><span class="mse-menu__head">Move to split</span>${moveTo.map((split) => `<button type="button" class="mse-menu__item" role="menuitem" data-outline-act="move-to" data-split="${esc(split.id)}"><span class="mse-menu__name">${esc(split.title)}</span></button>`).join("")}</div>` : ""}
        ${isArea || target2.splitId ? menuItem("add-area-after", "Add area after") : ""}
        ${isArea ? `<div class="mse-menu__sep"></div>${menuItem("delete-page", "Delete area…", `and its ${target2.blocks.length} block${target2.blocks.length === 1 ? "" : "s"}`, " -danger")}` : ""}`;
    }
    placeMenu(menu, anchor);
    menu.querySelector<HTMLElement>("button")?.focus();
  };

  /** Deleting asks once, in the menu itself. */
  const confirmInMenu = (question: string, action: string, label: string) => {
    if (!menu) return;
    menu.innerHTML = `<div class="mse-menu__head -ask">${esc(question)}</div>${menuItem(action, label, "", " -danger")}${menuItem("close-menu", "Keep it")}`;
    menu.querySelector<HTMLElement>("button")?.focus();
  };

  const outlineAction = (action: string, element: HTMLElement) => {
    const current = doc();
    const pageId = menu?.dataset.page;
    const splitId = menu?.dataset.split ?? element.closest<HTMLElement>("[data-split]")?.dataset.split;
    const target = current.pages.find((candidate) => candidate.id === pageId);
    const split = current.allSplits.find((candidate) => candidate.id === (element.dataset.split && action === "move-to" ? element.dataset.split : splitId));
    const goToHeading = (line: number) => {
      const added = session.document.pages.find((candidate) => candidate.headingLine === line);
      if (added) controller?.goToPage(added.id);
    };
    if (action === "delete-page" && target) return confirmInMenu(`Delete ${target.title} and its ${target.blocks.length} block${target.blocks.length === 1 ? "" : "s"}?`, "delete-page-yes", "Delete area");
    if (action === "delete-split" && split) return confirmInMenu(`Delete ${split.title} and its ${split.pageIds.length} area${split.pageIds.length === 1 ? "" : "s"}?`, "delete-split-yes", "Delete split");
    closeMenu();
    switch (action) {
      case "rename-page":
        if (target) renameInNav({ pageId: target.id });
        return;
      case "rename-split":
      case "detail-split":
        if (split) renameInNav({ splitId: split.id }, action === "detail-split" ? "detail" : "name");
        return;
      case "link-zones":
        if (!target) return;
        zonePickerWanted = true;
        if (target.id !== page()?.id) controller?.goToPage(target.id);
        setFill(true);
        return;
      case "delete-page-yes":
        if (target) apply((text) => removeRange(text, target.src), "menu");
        return;
      case "delete-split-yes":
        if (split) apply((text) => removeRange(text, split.src), "menu");
        return;
      case "page-up":
      case "page-down": {
        if (!target) return;
        const siblings = current.pages.filter((candidate) => candidate.kind === "area" && candidate.splitId === target.splitId);
        const at = siblings.indexOf(target);
        const other = siblings[action === "page-up" ? at - 1 : at + 1];
        if (!other) return;
        const change = action === "page-up"
          ? apply((text) => moveSection(text, target.src, other.src.start), "menu")
          : apply((text) => moveSection(text, other.src, target.src.start), "menu");
        if (action === "page-up") goToHeading(change.range.start);
        return;
      }
      case "move-to": {
        if (!target || !split) return;
        const change = apply((text) => moveSection(text, target.src, split.src.end), "menu");
        goToHeading(change.range.start);
        return;
      }
      case "add-area-after": {
        const at = target ? target.src.end : split?.src.end;
        if (at !== undefined) addArea(at);
        return;
      }
      case "add-area":
        if (split) addArea(split.src.end);
        return;
      case "split-up":
      case "split-down": {
        if (!split) return;
        const at = current.allSplits.indexOf(split);
        const other = current.allSplits[action === "split-up" ? at - 1 : at + 1];
        if (!other) return;
        if (action === "split-up") apply((text) => moveSection(text, split.src, other.src.start), "menu");
        else apply((text) => moveSection(text, other.src, split.src.start), "menu");
        return;
      }
      case "add-split": {
        const change = apply((text) => insertHeading(text, sourceLines(text).length, splitHeading("New split", "")), "menu");
        const added = session.document.allSplits.find((candidate) => candidate.headingLine === change.range.start);
        if (added) window.requestAnimationFrame(() => renameInNav({ splitId: added.id }));
        return;
      }
    }
  };

  /** A new area, opened with its title ready to type. */
  const addArea = (at: number) => {
    const change = apply((text) => insertHeading(text, at, areaHeading("New area")), "menu");
    const added = session.document.pages.find((candidate) => candidate.headingLine === change.range.start);
    if (!added) return;
    titleEditFor = added.id;
    controller?.goToPage(added.id);
  };

  const decorateNav = (nav: HTMLElement) => {
    if (!active) return;
    for (const section of nav.querySelectorAll<HTMLElement>(".msv-split[data-split]")) {
      const list = section.querySelector("ul");
      const add = document.createElement("li");
      add.innerHTML = `<button type="button" class="mse-nav-add" data-outline-act="add-area">+ Add area</button>`;
      list?.append(add);
      const head = section.querySelector<HTMLElement>(".msv-split__head");
      if (head) head.insertAdjacentHTML("afterend", `<button type="button" class="mse-nav-more -split" data-split-menu="${esc(section.dataset.split!)}" aria-label="Split options">⋯</button>`);
    }
    for (const link of nav.querySelectorAll<HTMLElement>(".msv-nav__link[data-page]")) {
      const pageId = link.dataset.page!;
      const target = doc().pages.find((candidate) => candidate.id === pageId);
      const holder = link.closest("li") ?? link;
      if (target?.kind === "area" && holder !== link) {
        holder.setAttribute("draggable", "true");
        holder.dataset.dragPage = pageId;
      }
      link.insertAdjacentHTML("afterend", `<button type="button" class="mse-nav-more" data-page-menu="${esc(pageId)}" aria-label="${esc(target?.title ?? "Page")} options">⋯</button>`);
    }
    nav.insertAdjacentHTML("beforeend", `<button type="button" class="mse-nav-add -split" data-outline-act="add-split">+ Add split</button>`);
  };

  // ---------- Panel: Problems and Coverage ----------

  const openPanel = (id: PanelId) => {
    panel = id;
    if (id === "coverage") readyIndex();
    if (controller?.panelId() === id) controller.refreshPanel();
    else controller?.openPanel(id);
  };

  function refreshPanel() {
    if (panel && controller?.panelId() === panel) controller.refreshPanel();
  }

  const renderProblems = (): string => {
    const warnings = doc().warnings;
    return `
      <div class="msv-detail mse-form" data-form="problems">
        ${titlebar("Problems")}
        ${warnings.length ? `<ul class="mse-problems">${warnings.map((warning) => `
          <li><button type="button" class="mse-problem" data-problem-line="${warning.line}">
            <span class="mse-problem__line">Line ${warning.line}</span><span>${esc(warning.message)}</span>
          </button></li>`).join("")}</ul>
          <p class="mse-note">A problem marked here stops the calc export until it is fixed. Choose one to see its line in the template.</p>`
        : `<p class="mse-note">No problems.</p>`}
      </div>`;
  };

  // ---------- Template pane ----------

  const completions = {
    trainers(query: string): TemplateCompletion[] | undefined {
      const ready = readyIndex();
      if (!ready) return undefined;
      const current = page();
      const zones = new Set(current?.zones.length ? current.zones : ready.suggestZones(current?.title ?? "").map((zone) => zone.zoneId));
      return searchTrainers(ready.trainers(), query, zones).slice(0, 40).map((trainer) => ({
        label: `${trainer.className} ${trainer.name}`,
        apply: String(trainer.id),
        detail: `#${trainer.id} · ${trainer.locations.join(", ") || "not placed"}`,
      }));
    },
    tables(query: string): TemplateCompletion[] | undefined {
      const ready = readyIndex();
      if (!ready) return undefined;
      const needle = normalizeName(query);
      const byTable = new Map<number, string[]>();
      for (const zone of ready.zones()) if (zone.encounterId !== undefined && ready.hasWildPokemon(zone.encounterId)) byTable.set(zone.encounterId, [...(byTable.get(zone.encounterId) ?? []), zone.name]);
      return [...byTable].filter(([tableId, names]) => !needle || String(tableId).startsWith(query.trim()) || names.some((name) => normalizeName(name).includes(needle)))
        .map(([tableId, names]) => ({ label: [...new Set(names)].join(", "), apply: String(tableId), detail: `table ${tableId}` }));
    },
    zones(query: string): TemplateCompletion[] | undefined {
      const ready = readyIndex();
      if (!ready) return undefined;
      const needle = normalizeName(query);
      return ready.zones().filter((zone) => !needle || String(zone.zoneId).startsWith(query.trim()) || normalizeName(zone.name).includes(needle))
        .map((zone) => ({ label: zone.name, apply: String(zone.zoneId), detail: `zone ${zone.zoneId}` }));
    },
    items(query: string): TemplateCompletion[] {
      const needle = normalizeName(query);
      const names = [
        ...typeNamesForProject(project).filter((type) => tmTypePalette(type) !== undefined).map((type) => `TM ${type}`),
        ...(project.texts.banks.items ?? []).map((name) => cleanDisplayText(String(name ?? "")).trim()).filter((name) => name && name !== "-"),
      ];
      return [...new Set(names)].filter((name) => normalizeName(name).startsWith(needle)).map((name) => ({ label: name, apply: name.toLowerCase() }));
    },
    species(query: string): TemplateCompletion[] {
      const needle = normalizeName(query);
      return [...new Set((project.texts.banks.pokedex ?? []).slice(1).map((name) => cleanDisplayText(String(name ?? "")).trim()).filter(Boolean))]
        .filter((name) => normalizeName(name).startsWith(needle)).map((name) => ({ label: name, apply: name.toLowerCase() }));
    },
    colours(): string[] {
      return [...new Set(doc().pages.flatMap((entry) => entry.blocks.flatMap((block) => (block.kind === "notice" && block.color ? [block.color] : []))))];
    },
  };

  const openTemplate = () => {
    if (templatePane || !controller) return;
    flushTyping();
    controller.elements.shell.classList.add("-template");
    templatePane = createTemplatePane(controller.elements.main, {
      source: session.source,
      onChange: (text) => {
        origin = "template";
        try {
          session.setSource(text, { coalesce: "template" });
        } finally {
          origin = "other";
        }
      },
      onCursor: (line) => {
        const owner = doc().pages.find((candidate) => line >= candidate.src.start && line < candidate.src.end);
        if (owner && owner.id !== page()?.id) controller?.goToPage(owner.id, undefined, true);
        const block = (owner ?? page())?.blocks.find((candidate) => line >= candidate.src.start && line < candidate.src.end);
        if (block) {
          select(block.src, false);
          elementsAt(block.src.start)[0]?.scrollIntoView({ block: "nearest" });
        }
      },
      undo: () => session.undo(),
      redo: () => session.redo(),
      complete: completions,
    });
    templatePane.setProblems(doc().warnings);
    if (selected) templatePane.reveal(selected);
    renderBar();
    layout();
  };

  function closeTemplate() {
    templatePane?.destroy();
    templatePane = undefined;
    controller?.elements.shell.classList.remove("-template");
    renderBar();
  }

  // ---------- Events ----------

  const undo = () => {
    flushTyping();
    commitHeader(true);
    session.undo();
  };

  const redo = () => {
    flushTyping();
    commitHeader(true);
    session.redo();
  };

  const attachEvents = (current: ViewerController) => {
    const { shell, pageHost, nav, bar, drawerBody } = current.elements;

    bar.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "undo") undo();
      if (action === "redo") redo();
      if (action === "template") (templatePane ? closeTemplate() : openTemplate());
      if (action === "fill") setFill(!fillOn);
      if (action === "problems") openPanel("problems");
      if (action === "save-rom") void saveRom();
      if (action === "discard") discardDraft();
    });

    pageHost.addEventListener("pointermove", (event) => {
      if (!active || !overlay) return;
      const target = event.target as HTMLElement;
      if (target.closest(".mse-tools, .mse-addline, .mse-grip, .mse-pop, .mse-entryx")) return;
      const element = target.closest<HTMLElement>("[data-block]");
      const next = element ? Number(element.dataset.block) : undefined;
      if (next !== hovered) {
        hovered = next;
        layout();
      }
      showAddLine(adding || pending ? undefined : nearestGap(event.clientY));
    });
    pageHost.addEventListener("pointerleave", () => {
      if (!active) return;
      hovered = undefined;
      layout();
      showAddLine(undefined);
    });

    // The toolbar and remove buttons keep the caret where it is (Link needs the selection).
    pageHost.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".mse-tools button, .mse-entryx")) event.preventDefault();
    });

    pageHost.addEventListener("click", (event) => {
      if (!active) return;
      const target = event.target as HTMLElement;
      const act = target.closest<HTMLElement>("[data-block-act]");
      if (act) {
        blockAction(act.dataset.blockAct!);
        return;
      }
      const swatch = target.closest<HTMLElement>(".mse-tools [data-colour]");
      if (swatch) {
        setNoticeColour(swatch.dataset.colour ?? "");
        return;
      }
      if (target.closest(".mse-tools")) return;
      if (target.closest("[data-add-gap]")) {
        const gap = gaps()[Number(overlay?.querySelector<HTMLElement>(".mse-addline")?.dataset.gap)];
        if (gap) openAdd(gap.line);
        return;
      }
      const kind = target.closest<HTMLElement>("[data-add-kind]");
      if (kind) {
        const line = adding && kind.closest(".mse-addstrip") ? adding.line : Number(kind.closest<HTMLElement>(".mse-empty")?.dataset.line);
        if (Number.isFinite(line)) insertNew(kind.dataset.addKind as BlockKind, line);
        return;
      }
      if (target.closest("[data-addstrip-close]")) {
        closeAdd();
        return;
      }
      const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "fill") {
        setFill(!fillOn);
        return;
      }
      if (action === "coverage") {
        openPanel("coverage");
        return;
      }
      if (fillClick(target)) return;
      // A new trainer or table, not picked yet.
      if (pending?.card?.contains(target)) {
        const role = target.closest<HTMLElement>("[data-role]");
        if (role) {
          pending.mandatory = role.dataset.role === "mandatory";
          pending.card.querySelectorAll<HTMLElement>("[data-role]").forEach((chip) => chip.setAttribute("aria-pressed", String(chip === role)));
          return;
        }
        const pick = target.closest<HTMLElement>("[data-pick-open]");
        if (pick) openPendingPicker(pick);
        return;
      }
      if (target.closest(".mse-entryx") && pickInBlock(target)) return;
      // Inside the block being edited: its picks and links; any other click is the caret's.
      const editingNow = editingElement();
      if (editingNow?.contains(target)) {
        if (pickInBlock(target)) {
          event.stopPropagation();
          return;
        }
        const link = target.closest<HTMLAnchorElement>("[data-rich] a");
        if (link) {
          event.preventDefault();
          openLinkPopover(link, link.closest<HTMLElement>("[data-rich]")!);
          return;
        }
        if (target.closest("[data-method], [data-season]") && editing?.draft.kind === "encounter") {
          const tableId = Number(editing.draft.ref);
          window.setTimeout(() => {
            const element = editingElement();
            if (element) decorateTableBand(element, tableId, host);
          }, 0);
        }
        return;
      }
      if (target.closest("[data-header-edit], .mse-fill, .mse-ghosts, .mse-ghostgroup, .mse-ghost, .mse-addstrip, .mse-empty, .mse-pop")) return;
      // Links in the sheet select their block here instead of opening (Ctrl or Cmd still opens them).
      const sheetLink = target.closest<HTMLAnchorElement>("[data-block] a[href]");
      if (sheetLink && !event.metaKey && !event.ctrlKey) event.preventDefault();
      else if (target.closest("a, button, [data-open], input, select, textarea")) return;
      const element = target.closest<HTMLElement>("[data-block]");
      if (!element) {
        if (target.closest(".msv-page") && !target.closest("header, .msv-page__tail")) {
          endEditing();
          select(undefined);
        }
        return;
      }
      if (editing) endEditing();
      const block = element.isConnected ? blockOf(element) : undefined;
      if (block) select(block.src);
    });

    pageHost.addEventListener("dblclick", (event) => {
      if (!active) return;
      const target = event.target as HTMLElement;
      const header = target.closest<HTMLElement>("[data-header-edit]");
      if (header && !headerEdit) {
        editHeader(header);
        return;
      }
      const element = target.closest<HTMLElement>("[data-block]");
      if (!element || target.closest("button, [data-open], input")) return;
      const block = blockOf(element);
      if (!block || editing?.start === block.src.start) return;
      startEditing(block.src.start, { point: { x: event.clientX, y: event.clientY } });
    });

    pageHost.addEventListener("input", (event) => {
      const field = (event.target as HTMLElement).closest<HTMLElement>("[data-edit]");
      if (!field || !editing || !editingElement()?.contains(field)) return;
      tidyField(field);
      readField(editing.draft, field);
      scheduleTyping(`${field.dataset.edit}${field.dataset.entry ?? ""}`);
      layout();
    });

    pageHost.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (headerEdit && target === headerEdit.element) {
        if (event.key === "Enter") {
          event.preventDefault();
          commitHeader();
        } else if (event.key === "Escape") {
          event.preventDefault();
          commitHeader(true);
        }
        return;
      }
      if (target.matches("[data-tool-colour]")) {
        if (event.key === "Enter" && editing) {
          event.preventDefault();
          flushTyping();
          applyStructural({ ...editing.draft });
        }
        return;
      }
      const field = target.closest<HTMLElement>("[data-edit]");
      if (!field || !editing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (editing.draft.kind === "text") splitParagraph(field);
        else if (editing.draft.kind === "list") newBullet(field);
        else if (editing.draft.kind === "notice" && field.dataset.edit === "title") focusEditing({ field: "text" });
        else endEditing();
      } else if (event.key === "Backspace" && editing.draft.kind === "list") {
        removeEmptyBullet(field, event);
      }
    });

    pageHost.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches("[data-tool-colour]")) setNoticeColour(input.value, true);
    });

    // Plain text only: pasted formatting, dropped markup and bold or italic keys don't reach the sheet.
    pageHost.addEventListener("paste", (event) => {
      const field = (event.target as HTMLElement).closest<HTMLElement>("[data-edit], [data-header-edit]");
      if (!field || field.contentEditable !== "true") return;
      event.preventDefault();
      const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/gu, " ");
      document.execCommand("insertText", false, text);
    });
    pageHost.addEventListener("beforeinput", (event) => {
      const field = (event.target as HTMLElement).closest?.("[data-edit], [data-header-edit]");
      if (!field) return;
      if (event.inputType.startsWith("format") || event.inputType === "insertFromDrop") event.preventDefault();
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault();
        if (event.inputType === "historyUndo") undo();
        else redo();
      }
    });

    // Dragging blocks by their grips, and list entries by their icon or sprite.
    pageHost.addEventListener("dragstart", (event) => {
      const target = event.target as HTMLElement;
      const entry = target.closest<HTMLElement>("[data-entry-icon][draggable], [data-entry-species][draggable]");
      if (entry && editing) {
        dragEntry = Number(entry.dataset.entryIcon ?? entry.dataset.entrySpecies);
        event.dataTransfer?.setData("text/plain", "entry");
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        return;
      }
      const grip = target.closest<HTMLElement>("[data-drag-block]");
      if (!grip) return;
      endEditing();
      dragBlock = Number(grip.dataset.dragBlock);
      event.dataTransfer?.setData("text/plain", "block");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      const element = blockElements()[dragBlock];
      if (element && event.dataTransfer) event.dataTransfer.setDragImage(element, 20, 20);
    });
    pageHost.addEventListener("dragover", (event) => {
      if (dragEntry !== undefined) {
        const over = (event.target as HTMLElement).closest<HTMLElement>("[data-entry-at]");
        if (!over) return;
        event.preventDefault();
        pageHost.querySelectorAll(".-drop-before").forEach((marked) => marked.classList.remove("-drop-before"));
        over.classList.add("-drop-before");
        return;
      }
      if (dragBlock === undefined) return;
      event.preventDefault();
      showAddLine(nearestGap(event.clientY, 10_000), true);
    });
    pageHost.addEventListener("drop", (event) => {
      if (dragEntry !== undefined) {
        event.preventDefault();
        const over = (event.target as HTMLElement).closest<HTMLElement>("[data-entry-at]");
        const from = dragEntry;
        dragEntry = undefined;
        pageHost.querySelectorAll(".-drop-before").forEach((marked) => marked.classList.remove("-drop-before"));
        const draft = editing?.draft;
        if (!over || !draft || (draft.kind !== "items" && draft.kind !== "gifts")) return;
        const to = Number(over.dataset.entryAt);
        if (to === from) return;
        const entries = [...draft.entries];
        const [moved] = entries.splice(from, 1);
        entries.splice(to, 0, moved!);
        applyStructural({ ...draft, entries });
        return;
      }
      if (dragBlock === undefined) return;
      event.preventDefault();
      const gap = nearestGap(event.clientY, 10_000);
      const block = page()?.blocks[dragBlock];
      const to = gap === undefined ? undefined : gaps()[gap]?.line;
      dragBlock = undefined;
      showAddLine(undefined);
      if (!block || to === undefined) return;
      select(apply((text) => moveRange(text, block.src, to), "menu").range);
    });
    pageHost.addEventListener("dragend", () => {
      dragBlock = undefined;
      dragEntry = undefined;
      pageHost.querySelectorAll(".-drop-before").forEach((marked) => marked.classList.remove("-drop-before"));
      showAddLine(undefined);
    });

    // The outline.
    nav.addEventListener("click", (event) => {
      if (!active) return;
      const target = event.target as HTMLElement;
      const more = target.closest<HTMLElement>("[data-page-menu], [data-split-menu]");
      if (more) {
        event.preventDefault();
        openPageMenu(more.dataset.pageMenu ? { pageId: more.dataset.pageMenu } : { splitId: more.dataset.splitMenu }, more);
        return;
      }
      const act = target.closest<HTMLElement>("[data-outline-act]");
      if (act) {
        event.preventDefault();
        outlineAction(act.dataset.outlineAct!, act);
      }
    });
    nav.addEventListener("dblclick", (event) => {
      if (!active) return;
      const link = (event.target as HTMLElement).closest<HTMLElement>(".msv-nav__link[data-page]");
      if (link) {
        event.preventDefault();
        renameInNav({ pageId: link.dataset.page });
      }
    });
    nav.addEventListener("dragstart", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-drag-page]");
      if (!item) return;
      dragPage = item.dataset.dragPage;
      event.dataTransfer?.setData("text/plain", "page");
    });
    nav.addEventListener("dragover", (event) => {
      if (!dragPage) return;
      const over = (event.target as HTMLElement).closest<HTMLElement>("li, .msv-split");
      if (!over) return;
      event.preventDefault();
      for (const marked of nav.querySelectorAll(".-drop-before")) marked.classList.remove("-drop-before");
      over.classList.add("-drop-before");
    });
    nav.addEventListener("drop", (event) => {
      if (!dragPage) return;
      event.preventDefault();
      for (const marked of nav.querySelectorAll(".-drop-before")) marked.classList.remove("-drop-before");
      const moving = doc().pages.find((candidate) => candidate.id === dragPage);
      dragPage = undefined;
      const target = event.target as HTMLElement;
      const onPage = target.closest<HTMLElement>("li")?.querySelector<HTMLElement>("[data-page]")?.dataset.page;
      const onSplit = target.closest<HTMLElement>(".msv-split")?.dataset.split;
      const targetPage = doc().pages.find((candidate) => candidate.id === onPage);
      const targetSplit = doc().allSplits.find((candidate) => candidate.id === onSplit);
      if (!moving) return;
      const to = targetPage && targetPage.kind === "area" ? targetPage.src.start : targetSplit?.src.end;
      if (to === undefined || targetPage?.id === moving.id) return;
      const change = apply((text) => moveSection(text, moving.src, to), "menu");
      const moved = session.document.pages.find((candidate) => candidate.headingLine === change.range.start);
      if (moved) controller?.goToPage(moved.id);
    });
    nav.addEventListener("dragend", () => {
      dragPage = undefined;
      for (const marked of nav.querySelectorAll(".-drop-before")) marked.classList.remove("-drop-before");
    });

    // Menus float over everything; a picker closes when something else is clicked.
    document.addEventListener("click", (event) => {
      if (!menu) return;
      const target = event.target as HTMLElement;
      const act = target.closest<HTMLElement>("[data-outline-act]");
      if (act && menu.contains(act)) {
        if (act.dataset.outlineAct === "close-menu") closeMenu();
        else outlineAction(act.dataset.outlineAct!, act);
        return;
      }
      if (!menu.contains(target) && !target.closest("[data-page-menu], [data-split-menu]")) closeMenu();
    }, true);
    document.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement;
      if (popover && !popover.element.contains(target) && !popover.anchor.contains(target)) closePopover();
      // Leaving the block (for the outline, say): what was typed is written now.
      if (editing && !editingElement()?.contains(target) && !target.closest(".mse-tools, .mse-pop")) flushTyping();
    }, true);

    drawerBody.addEventListener("click", (event) => {
      const problem = (event.target as HTMLElement).closest<HTMLElement>("[data-problem-line]");
      if (!problem) return;
      const line = Number(problem.dataset.problemLine) - 1;
      const owner = doc().pages.find((candidate) => line >= candidate.src.start && line < candidate.src.end);
      if (owner && owner.id !== page()?.id) controller?.goToPage(owner.id);
      openTemplate();
      templatePane?.reveal({ start: line, end: line + 1 });
    });

    document.addEventListener("keydown", (event) => {
      if (!active) return;
      const target = event.target as HTMLElement;
      const inCode = Boolean(target.closest?.(".cm-editor"));
      if (event.key === "Escape" && !inCode) {
        if (menu) {
          closeMenu();
          event.stopPropagation();
          return;
        }
        if (popover) {
          const back = popover.kind === "link" ? undefined : popover.anchor;
          closePopover();
          back?.focus({ preventScroll: true });
          event.stopPropagation();
          return;
        }
        if (headerEdit) return;
        if (pending) {
          dropPending();
          layout();
          return;
        }
        if (adding) {
          closeAdd();
          return;
        }
        if (editing) {
          endEditing();
          return;
        }
        if (selected && !target.closest("input, textarea, [contenteditable='true'], .msv-drawer")) {
          select(undefined);
          return;
        }
      }
      if (event.key === "Enter" && selected && !editing && !pending && !event.metaKey && !event.ctrlKey
        && (target === document.body || target === shell || target === current.elements.main)) {
        event.preventDefault();
        startEditing(selected.start);
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || inCode) return;
      // CodeMirror sends its own Undo and Redo to the session.
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    }, true);
    window.addEventListener("resize", () => layout());

    shell.classList.toggle("-editing", active);
    current.elements.editTab?.setAttribute("aria-pressed", String(active));
    // The template sits under the toolbar, which wraps to two lines in narrow windows.
    new ResizeObserver(() => shell.style.setProperty("--mse-bar-height", `${bar.offsetHeight || 0}px`)).observe(bar);
  };

  /** A field emptied by the browser keeps a stray line break; a list keeps at least one bullet. */
  const tidyField = (field: HTMLElement) => {
    if (field.dataset.edit === "items") {
      if (!field.querySelector("li")) {
        const item = document.createElement("li");
        item.append(...field.childNodes);
        field.append(item);
        const caret = document.createRange();
        caret.selectNodeContents(item);
        caret.collapse(false);
        setSelection(caret);
      }
      return;
    }
    if (!plainText(field).trim() && field.childNodes.length && !field.querySelector("a")) field.innerHTML = "";
  };

  // ---------- Hooks ----------

  const hooks: ViewerEditingHooks = {
    active: () => active,
    toggle: () => setActive(!active),
    pageRendered: (hostElement, current) => decorate(hostElement, current),
    heldBlock: () => (editing && held ? editing.start : undefined),
    navRendered: (nav) => decorateNav(nav),
    renderPanel: (id) => (id === "coverage" ? renderCoverage(host) : renderProblems()),
    panelRendered: (panelBody) => controller?.hydrate(panelBody),
    keepPanel: () => true,
    panelClosed: () => {
      panel = undefined;
    },
  };

  return {
    hooks,
    attach(current) {
      controller = current;
      attachEvents(current);
      renderBar();
      if (active) {
        current.update(session.document);
        current.refreshNav();
      }
    },
  };
}

function sameColour(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function setSelection(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The selection, when it is inside `field`. */
function currentRange(field: HTMLElement): Range | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return undefined;
  const range = selection.getRangeAt(0);
  return field.contains(range.startContainer) ? range : undefined;
}

/** Where a click would put the caret. */
function caretAt(x: number, y: number): Range | undefined {
  const withPosition = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
  const position = withPosition.caretPositionFromPoint?.(x, y);
  if (position) {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  const withRange = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null };
  return withRange.caretRangeFromPoint?.(x, y) ?? undefined;
}

/** Saves a ROM where the browser lets the author choose (Chrome, Edge), else downloads it. False when cancelled. */
async function deliverRom(bytes: Uint8Array, name: string): Promise<boolean> {
  type Writable = { write(data: Blob): Promise<void>; close(): Promise<void> };
  type Picker = (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable(): Promise<Writable> }>;
  const picker = (window as Window & { showSaveFilePicker?: Picker }).showSaveFilePicker;
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" });
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: "Nintendo DS ROM", accept: { "application/octet-stream": [".nds"] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
