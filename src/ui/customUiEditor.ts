import { createCustomUiAccessPanel } from "./customUiAccess";
import { setAccess } from "../customUi/access";
import { SUMMARY_LABELS, SUMMARY_REGIONS, addSummaryPage, addStatOverlay, canTransform, isSummaryElement, resetSummaryElement } from "../customUi/summaryCatalog";
import { duplicateElements, deleteElements, transferElements, resizeElement } from "../customUi/editorOperations";
import { compileLearnsetNative } from "../customUi/learnsetNative";
import { nativeLearnsetPreset, NATIVE_REGIONS } from "../customUi/nativeCatalog";
import { withLearnsetData } from "../customUi/learnsetData";
import { type Assets, decodePng } from "../customUi/assets";
import { compile, preview, type Compilation } from "../customUi/compiler";
import { BINDINGS, newElement, nextId, type Document as UiDocument, type Element as UiElement, type GameData, type PhysicalScreen, type SummaryPage, type TextSource } from "../customUi/document";
import { fixtures } from "../customUi/fixtures";
import { History, addScreen, alignElements, duplicateScreen, moveElements, removeScreen } from "../customUi/history";
import { completeNative, input, start, type Interaction } from "../customUi/interaction";
import { romAssets } from "../customUi/romAssets";
import { ensureCustomUi, applyCustomUi, disableCustomUi } from "../pokeweb/customUiModel";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import { NintendoDSRom } from "../nds/rom";

let cleanup: (() => void) | undefined;
export function stopCustomUiEditor() { cleanup?.(); cleanup = undefined; }
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node;
};
const button = (label: string, action: () => void, disabled = false) => { const b = el("button", label); b.type = "button"; b.disabled = disabled; b.onclick = action; return b; };
const iconButton = (label: string, action: () => void, kind: "add" | "delete", disabled = false) => {
  const b = button(label, action, disabled), icon = el("span", kind === "add" ? "+" : "×", "cui-button-icon");
  icon.setAttribute("aria-hidden", "true"); b.prepend(icon); b.classList.add(`cui-button-${kind}`); return b;
};
const addButton = (label: string, action: () => void, disabled = false) => iconButton(label, action, "add", disabled);
const deleteButton = (label: string, action: () => void, disabled = false) => iconButton(label, action, "delete", disabled);
const select = (items: [string, string][], value: string, change: (value: string) => void) => {
  const s = el("select"); items.forEach(([value, label]) => { const o = el("option", label); o.value = value; s.append(o); }); s.value = value; s.onchange = () => change(s.value); return s;
};
const field = (label: string, node: HTMLElement) => { const l = el("label", undefined, "cui-field"); l.append(el("span", label), node); return l; };
export async function renderCustomUiEditor(project: ProjectState, container: HTMLElement, onDirty: () => void) {
  stopCustomUiEditor(); const abort = new AbortController(); let timer = 0, disposed = false;
  cleanup = () => { disposed = true; abort.abort(); cancelAnimationFrame(timer); };
  container.replaceChildren(el("p", "Loading native UI assets…"));
  const root = el("section", undefined, "cui-editor"), header = el("div", undefined, "cui-header"), toolbar = el("div", undefined, "cui-toolbar");
  const columns = el("div", undefined, "cui-columns"), left = el("aside", undefined, "cui-sidebar"), center = el("main", undefined, "cui-stage"), right = el("section", undefined, "cui-properties"), rightRail = el("aside", undefined, "cui-right-rail");
  const previewToolbar = el("div", undefined, "cui-preview-toolbar"), accessPanel = el("section", undefined, "cui-access-panel");
  let accessEditor: ReturnType<typeof createCustomUiAccessPanel> | undefined;
  const status = el("p", "", "cui-status"), diagnostics = el("div", undefined, "cui-diagnostics");
  const title = el("h1", "Custom UI"); header.append(title, el("p", "Design two native DS screens. Turn on Interactable to try touch and button navigation."));
  const previewNotice = el("aside", undefined, "cui-preview-notice"); previewNotice.setAttribute("role", "note");
  previewNotice.append(el("strong", "Experimental · Preview mode"), el("p", "The Custom UI editor is still under development. Previews may differ from in-game results, and ROM installation support is limited."));
  root.append(header, previewNotice, toolbar, status, columns, diagnostics); columns.append(left, center, rightRail); rightRail.append(right, accessPanel); center.append(previewToolbar);
  const source = ensureCustomUi(project), history = new History(structuredClone(source.document));
  let activeScreen = history.document.screens[0].id, selected = new Set<string>(), zoom = 2, snap = true, interact = false, addTo: PhysicalScreen = "top", showRegions = true;
  let sample: GameData = structuredClone(fixtures.full), session: Interaction | undefined, compiled: Compilation, assets: Assets;
  let draft: UiDocument | undefined, rom: NintendoDSRom, lastTick = performance.now(), fixtureName = "full", previewParty = 0, previewMove = 0, assetRevision = "";
  const canvases: Record<PhysicalScreen, HTMLCanvasElement> = { top: el("canvas"), bottom: el("canvas") };
  const currentDoc = () => draft ?? history.document;
  const screen = () => currentDoc().screens.find(s => s.id === activeScreen) ?? currentDoc().screens[0];
  const fault = (error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); status.classList.add("-error"); };
  const attempt = (action: () => void) => { try { status.classList.remove("-error"); status.textContent = ""; action(); } catch (error) { fault(error); } };
  function rebuild() {
    const revision = JSON.stringify([currentDoc().assets, currentDoc().screens.some(s => s.elements.some(e => e.native?.startsWith("learnset."))), currentDoc().screens.some(s => s.target?.kind === "summary")]);
    try { if (revision !== assetRevision) { assets = romAssets(project, rom, { ...source, document: currentDoc() }); assetRevision = revision; } }
    catch (error) { assets = { glyph: () => undefined, image: () => undefined, icon: () => undefined }; fault(error); }
    try { compiled = compile(currentDoc(), assets); }
    catch (error) { compiled = { version: 1, document: structuredClone(currentDoc()), screens: [], diagnostics: [{ severity: "error", code: "assets", message: error instanceof Error ? error.message : String(error) }], valid: false }; }
  }
  function save() {
    if (!history.document.screens.some(s => s.id === activeScreen)) activeScreen = history.document.screens[0].id;
    selected = new Set([...selected].filter(id => history.document.screens.find(s => s.id === activeScreen)!.elements.some(e => e.id === id)));
    source.document = structuredClone(history.document); onDirty(); rebuild(); if (interact) resetInteraction(); renderControls(); paint(); }
  function edit(change: (doc: UiDocument) => void) { attempt(() => { if (history.edit(change)) save(); }); }
  function changeSelected(change: (e: UiElement) => void) { edit(doc => doc.screens.find(s => s.id === activeScreen)!.elements.filter(e => selected.has(e.id)).forEach(change)); }
  function resetInteraction() { lastTick = performance.now(); session = start({ ...compiled.document, launchers: { party: activeScreen } }, sample, "party", previewParty); if (screen().target) session.stack[0].moveSelection = { source: "moves", index: previewMove }; }
  function paint() {
    if (disposed || !compiled) return;
    const doc = compiled.document;
    if (session && screen().target && !session.stack[0].moveSelection) session.stack[0].moveSelection = { source: "moves", index: previewMove };
    if (!session || !interact) { session = start({ ...doc, launchers: { field: activeScreen, party: activeScreen } }, sample, "party", previewParty); if (!interact) session.stack[0].focus = undefined; }
    if (screen().target) session.stack[0].moveSelection ??= { source: "moves", index: previewMove };
    const rendered = preview(compiled, assets, sample, session);
    for (const physical of ["top", "bottom"] as const) {
      const canvas = canvases[physical], ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rendered[physical].pixels), 256, 192), 0, 0);
      canvas.classList.toggle("-active-screen", addTo === physical);
      if (!interact) {
        if (showRegions && screen().target) {
          ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]);
          for (const e of screen().elements.filter(e => e.screen === physical && !e.hidden && isSummaryElement(e))) {
            const region = SUMMARY_REGIONS.find(r => r.id === e.native)!; if (region.art) continue;
            ctx.strokeStyle = region.guide ? "#ffc463" : "#7096b0"; ctx.strokeRect(e.x + .5, e.y + .5, e.width - 1, e.height - 1);
            if (region.guide) { ctx.fillStyle = "#ffc463"; ctx.font = "8px sans-serif"; ctx.fillText(e.name, e.x + 2, e.y + 10, e.width - 4); }
          }
          ctx.setLineDash([]);
        }
        if (snap) { ctx.strokeStyle = "#ffffff14"; ctx.lineWidth = 0.25; for (let x = 0; x <= 256; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 192); ctx.stroke(); } for (let y = 0; y <= 192; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); } }
        ctx.strokeStyle = "#57caff"; ctx.lineWidth = 1;
        for (const e of screen().elements.filter(e => selected.has(e.id) && e.screen === physical)) {
          ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.width - 1, e.height - 1); ctx.fillStyle = "#57caff"; ctx.fillRect(e.x + e.width - 3, e.y + e.height - 3, 3, 3);
        }
      }
    }
    diagnostics.replaceChildren();
    const seen = new Set<string>(); for (const d of rendered.diagnostics) {
      const key = `${d.screen}:${d.element}:${d.code}`; if (seen.has(key)) continue; seen.add(key);
      const item = button(`${d.severity === "error" ? "Error" : "Note"}: ${d.message}`, () => { if (d.screen) activeScreen = d.screen; const owner = screen().elements.find(e => e.id === d.element || d.element?.startsWith(`${e.id}_`)); selected = new Set(owner ? [owner.id] : []); renderControls(); paint(); });
      item.className = `cui-diagnostic -${d.severity}`; diagnostics.append(item);
    }
    const budget = compiled.screens.find(s => s.id === activeScreen)?.budgets;
    if (budget) diagnostics.append(el("p", `Graphics estimates — top: ${budget.top.tiles} tiles, ${budget.top.palette} colors, ${budget.top.sprites} sprites; bottom: ${budget.bottom.tiles} tiles, ${budget.bottom.palette} colors, ${budget.bottom.sprites} sprites. Heap: ${Math.ceil((budget.top.heap + budget.bottom.heap) / 1024)} KiB. These are compiler estimates for the preview; native presets use their host application’s resources.`));
    if (interact && session.nativeRequest) status.replaceChildren(el("span", `Preview paused for read-only ${session.nativeRequest}. `), button("Simulate return", () => { completeNative(session!); status.replaceChildren(); paint(); }));
    else if (interact && session.closed) status.replaceChildren(el("span", "Custom screen closed. "), button("Restart preview", () => { resetInteraction(); status.replaceChildren(); paint(); }));
  }
  function inputText(value: string, change: (value: string) => void, type = "text") {
    const node = el("input"); node.type = type; node.value = value;
    let committed = value;
    const commit = () => { if (node.value !== committed) { committed = node.value; change(node.value); } };
    node.onchange = commit; node.onblur = commit;
    node.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); commit(); } };
    return node;
  }
  function numberField(label: string, value: number, change: (value: number) => void, min = 0, max = 256) {
    const node = inputText(String(value), v => { const n = Number(v); if (Number.isInteger(n) && n >= min && n <= max) change(n); else fault(`${label} must be ${min}–${max}.`); }, "number"); node.min = String(min); node.max = String(max); return field(label, node);
  }
  function checkbox(label: string, checked: boolean, change: (value: boolean) => void) { const node = el("input"); node.type = "checkbox"; node.checked = checked; node.onchange = () => change(node.checked); return field(label, node); }
  function textSource(label: string, text: TextSource, change: (source: TextSource) => void): HTMLElement {
    const group = el("fieldset"); group.append(el("legend", label));
    group.append(select([["literal", "Literal text"], ...BINDINGS.map(b => [b, b] as [string, string])], "literal" in text ? "literal" : text.binding, v => change(v === "literal" ? { literal: "Text" } : { binding: v as typeof BINDINGS[number] })));
    if ("literal" in text) { const t = el("textarea"); t.value = text.literal; let committed = t.value; const commit = () => { if (t.value !== committed) { committed = t.value; change({ literal: t.value }); } }; t.onchange = commit; t.onblur = commit; group.append(t); }
    else group.append(field("Case", select([["", "Original"], ["upper", "UPPERCASE"], ["title", "Title Case"]], text.transform ?? "", v => { const next = { ...text }; if (v) next.transform = v as "upper" | "title"; else delete next.transform; change(next); })), field("Prefix", inputText(text.prefix ?? "", prefix => change({ ...text, prefix }))), field("Suffix", inputText(text.suffix ?? "", suffix => change({ ...text, suffix }))));
    return group;
  }
  function renderControls() {
    toolbar.replaceChildren(); left.replaceChildren(); right.replaceChildren();
    const undo = button("Undo", () => { if (history.undo()) save(); }, !history.canUndo), redo = button("Redo", () => { if (history.redo()) save(); }, !history.canRedo);
    const historyActions = el("div", undefined, "cui-toolbar-group"), assetActions = el("div", undefined, "cui-toolbar-group");
    historyActions.setAttribute("aria-label", "Edit history"); assetActions.setAttribute("aria-label", "Add assets");
    historyActions.append(undo, redo); assetActions.append(addButton("Import PNG", importImage), addButton("Import native UI", importNative));
    toolbar.append(historyActions, assetActions);
    previewToolbar.replaceChildren();
    const viewControls = el("div", undefined, "cui-view-controls"), toggle = el("label", undefined, "cui-switch"), toggleInput = el("input"), track = el("span", undefined, "cui-switch-track");
    toggleInput.type = "checkbox"; toggleInput.setAttribute("role", "switch"); toggleInput.checked = interact; track.setAttribute("aria-hidden", "true");
    toggleInput.onchange = () => { interact = toggleInput.checked; selected.clear(); resetInteraction(); renderControls(); paint(); previewToolbar.querySelector<HTMLInputElement>('[role="switch"]')?.focus({ preventScroll: true }); };
    toggle.append(el("span", "Interactable"), toggleInput, track);
    viewControls.append(checkbox("8 px snap", snap, value => { snap = value; paint(); }), field("Zoom", select([["1", "1×"], ["2", "2×"], ["3", "3×"]], String(zoom), v => {
      zoom = Number(v); root.style.setProperty("--cui-preview-width", `${256 * zoom}px`);
      for (const c of Object.values(canvases)) c.style.width = `${256 * zoom}px`;
    })));
    previewToolbar.append(viewControls, toggle);
    previewControls.hidden = !interact; previewHelp.hidden = !interact;
    root.classList.toggle("-interactable", interact);
    root.style.setProperty("--cui-preview-width", `${256 * zoom}px`);

    async function install(disable = false) {
      root.inert = true; status.textContent = disable ? "Disabling launch entry…" : "Compiling and staging the native learnset layout…";
      try {
        await (disable ? disableCustomUi(project) : applyCustomUi(project));
        Object.assign(source, project.customUi); project.customUi = source; onDirty();
        status.classList.remove("-error"); status.textContent = disable ? "Disabled. Your design is retained." : "Applied to the project. Export a separately named ROM to test it.";
      } catch (error) { fault(error); }
      finally { root.inert = false; if (!disposed) renderControls(); }
    }
    const installProblems = compileLearnsetNative(history.document).diagnostics.filter(d => d.severity === "error");
    const romActions = el("div", undefined, "cui-toolbar-group cui-rom-actions"); romActions.setAttribute("aria-label", "ROM installation");
    romActions.append(button("Enable in ROM", () => { void install(); }, !!source.installation?.enabled || installProblems.length > 0), button("Apply Changes", () => { void install(); }, !source.installation?.enabled || installProblems.length > 0), button("Disable", () => { void install(true); }, !source.installation?.enabled));
    romActions.querySelectorAll("button:not(:last-child)").forEach(b => b.classList.add("cui-button-primary")); toolbar.append(romActions);
    if (!accessEditor) accessEditor = createCustomUiAccessPanel(accessPanel, history.document, assets, access => edit(doc => setAccess(doc, access)));
    else accessEditor.update(history.document, assets);
    if (installProblems.length) left.append(el("p", "Design saved for preview. ROM installation: " + installProblems[0].message, "cui-capability"));
    left.append(el("p", "Native MVP: import the existing Learnset viewer and choose which upper regions appear. The native controls and layout are preserved. Freeform designs remain editable and previewable."));
    left.append(field("Project name", inputText(history.document.name, name => edit(doc => { doc.name = name; }))), el("h2", "Screens"));
    for (const s of currentDoc().screens) {
      const b = button(s.name, () => { activeScreen = s.id; selected.clear(); resetInteraction(); renderControls(); paint(); }); if (s.id === activeScreen) b.classList.add("-selected"); left.append(b);
    }
    left.append(addButton("Add screen", () => edit(doc => { activeScreen = addScreen(doc); selected.clear(); })), addButton("Duplicate screen", () => edit(doc => { activeScreen = duplicateScreen(doc, activeScreen); selected.clear(); }), !!screen().target), deleteButton("Delete screen", () => edit(doc => { removeScreen(doc, activeScreen); activeScreen = doc.screens[0].id; selected.clear(); }), currentDoc().screens.length === 1));
    left.append(el("h2", "Existing game screens"), select([["", "Edit Summary page…"], ...Object.entries(SUMMARY_LABELS)], "", page => {
      if (page) edit(doc => { activeScreen = addSummaryPage(doc, page as SummaryPage); selected.clear(); });
    }));
    left.append(el("h2", "Components"));
    left.append(field("Add to", select([["top", "Top screen"], ["bottom", "Bottom screen (touch)"]], addTo, value => { addTo = value as PhysicalScreen; paint(); })));
    const add = select([["", "+ Add component…"], ...["panel", "text", "image", "pokemon", "button", "list"].map(k => [k, k] as [string, string])], "", kind => {
      if (!kind) return; edit(doc => { const element = newElement(kind as UiElement["kind"], nextId(doc, "element"), addTo); doc.screens.find(s => s.id === activeScreen)!.elements.push(element); selected = new Set([element.id]); });
    }); left.append(add);
    if (screen().target) {
      left.append(checkbox("Show native region guides", showRegions, value => { showRegions = value; paint(); }));
      for (const kind of ["ev", "iv"] as const) left.append(addButton(`Add ${kind.toUpperCase()} values`, () => edit(doc => { selected = new Set(addStatOverlay(doc, doc.screens.find(s => s.id === activeScreen)!, addTo, kind)); })));
    }
    for (const e of [...screen().elements].reverse()) {
      const b = button(`${e.locked ? "▣ " : ""}${e.hidden ? "○ " : ""}${e.name} · ${e.screen}`, () => {}); b.onclick = event => { if (!event.shiftKey) selected.clear(); selected.has(e.id) ? selected.delete(e.id) : selected.add(e.id); renderControls(); paint(); }; if (selected.has(e.id)) b.classList.add("-selected"); left.append(b);
    }
    left.append(el("h2", "Preview data"), select(Object.keys(fixtures).map(k => [k, k]), fixtureName, v => { fixtureName = v; sample = withLearnsetData(project, fixtures[v]); previewParty = Math.max(0, Math.min(previewParty, sample.party.length - 1)); previewMove = 0; resetInteraction(); renderControls(); paint(); }), button("Edit sample JSON", editSample));
    left.append(field("Preview Pokémon", select(sample.party.map((p, i) => [String(i), `${i + 1} · ${p.nickname}`]), String(previewParty), value => { previewParty = Number(value); resetInteraction(); paint(); })));
    if (screen().target?.page === "moves") left.append(field("Selected move", select((sample.party[previewParty]?.moves ?? []).map((m, i) => [String(i), m.name]), String(previewMove), value => { previewMove = Number(value); resetInteraction(); paint(); })));
    renderProperties();
  }
  function renderProperties() {
    const elements = screen().elements.filter(e => selected.has(e.id));
    if (!elements.length) {
      right.append(el("h2", "Screen"), field("Name", inputText(screen().name, name => edit(doc => { doc.screens.find(s => s.id === activeScreen)!.name = name; }))));
      for (const physical of ["top", "bottom"] as const) right.append(field(`${physical} background`, inputText(screen().background[physical], value => edit(doc => { doc.screens.find(s => s.id === activeScreen)!.background[physical] = value; }), "color")));
      if (screen().target) right.append(el("p", "Summary preview uses a static Pokémon sprite. Turn on Interactable to preview the scrolling grid. Custom overlays use the selected preview Pokémon."));
      right.append(el("p", "Click a component to edit it. Shift-click selects more. Drag the lower-right handle to resize. Arrow keys nudge; Shift moves eight pixels.")); return;
    }
    right.append(el("h2", elements.length === 1 ? elements[0].name : `${elements.length} selected`));
    if (elements.length === 1 && isSummaryElement(elements[0])) {
      const e = elements[0], region = SUMMARY_REGIONS.find(r => r.id === e.native)!;
      right.append(el("p", region.art ? "Native background artwork. Kept at the physical screen size." : "Existing native element. Resize its allocated region or drag to reposition. Summary installation is not available yet."));
      right.append(field("Name", inputText(e.name, value => changeSelected(e => { e.name = value; }))));
      if (!region.art) {
        for (const key of ["x", "y", "width", "height"] as const) right.append(numberField(key, e[key], value => changeSelected(e => { e[key] = value; }), key === "width" || key === "height" ? 8 : 0, key === "x" ? 256 - e.width : key === "y" ? 192 - e.height : key === "width" ? 256 - e.x : 192 - e.y));
        right.append(checkbox("Hidden", e.hidden, value => changeSelected(e => { e.hidden = value; })), checkbox("Lock position", !!e.locked, value => changeSelected(e => { e.locked = value; })), button("Reset native layout", () => changeSelected(resetSummaryElement)));
      }
      return;
    }
    if (elements.length === 1 && elements[0].kind === "native") {
      const e = elements[0], set = <K extends keyof UiElement>(key: K, value: UiElement[K]) => changeSelected(element => { element[key] = value; });
      const region = NATIVE_REGIONS.find(r => r.id === e.native)!;
      right.append(el("p", region.description), field("Name", inputText(e.name, v => set("name", v))));
      if (!region.required) right.append(checkbox("Visible", !e.hidden, value => set("hidden", !value)));
      right.append(el("p", `Native region · ${region.width}×${region.height} at (${region.x}, ${region.y}). Its position, font, palette, and behavior are owned by the current Learnset adapter.`)); return;
    }
    const alignment = el("div", undefined, "cui-actions"); for (const axis of ["left", "right", "top", "bottom", "centerX", "centerY"] as const) alignment.append(button(axis, () => edit(doc => alignElements(doc.screens.find(s => s.id === activeScreen)!.elements, selected, axis)))); right.append(alignment);
    right.append(addButton("Duplicate", duplicateSelection), deleteButton("Delete", deleteSelection), button("Bring to front", () => reorder(true)), button("Send to back", () => reorder(false)));
    if (elements.length !== 1) {
      for (const physical of ["top", "bottom"] as const) right.append(button(`Move to ${physical} screen`, () => edit(doc => transferElements(doc.screens.find(s => s.id === activeScreen)!.elements, selected, physical))));
      return;
    }
    const e = elements[0], set = <K extends keyof UiElement>(key: K, value: UiElement[K]) => changeSelected(element => { element[key] = value; });
    right.append(field("Name", inputText(e.name, v => set("name", v))), field("Physical screen", select([["top", "Top"], ["bottom", "Bottom (touch)"]], e.screen, v => set("screen", v as PhysicalScreen))));
    for (const key of ["x", "y", "width", "height"] as const) right.append(numberField(key, e[key], v => set(key, v), key === "width" || key === "height" ? 1 : 0, key === "x" ? 256 - e.width : key === "y" ? 192 - e.height : key === "width" ? 256 - e.x : 192 - e.y));
    right.append(checkbox("Hidden", e.hidden, v => set("hidden", v)), checkbox("Lock position", !!e.locked, v => set("locked", v)), checkbox("Transparent fill", !!e.transparentFill, v => set("transparentFill", v)));
    for (const key of ["fill", "border", "foreground", "shadow"] as const) right.append(field(key, inputText(e.paint[key], v => set("paint", { ...e.paint, [key]: v }), "color")));
    right.append(numberField("Border pixels", e.paint.borderWidth, v => set("paint", { ...e.paint, borderWidth: v }), 0, 4));
    if (["text", "button"].includes(e.kind)) right.append(textSource("Text", e.text, v => set("text", v)));
    if (["text", "button", "list"].includes(e.kind)) right.append(field("Native font", select([["0", "Standard"], ["1", "Small"], ["2", "Medium"], ["3", "Numeric"]], String(e.font), v => set("font", Number(v)))), field("Alignment", select([["left", "Left"], ["center", "Center"], ["right", "Right"]], e.align, v => set("align", v as UiElement["align"]))), checkbox("Wrap text", e.wrap, v => set("wrap", v)));
    if (["panel", "image", "button"].includes(e.kind)) {
      const images: [string, string][] = [["", "None"], ["binding:view.type1", "Viewed primary type"], ["binding:view.type2", "Viewed secondary type"], ["binding:move.type", "Selected move type"], ...currentDoc().assets.map(a => [`import:${a.id}`, a.name] as [string, string]), ...Array.from({ length: 18 }, (_, i) => [`type:${i}`, `Native type ${i}`] as [string, string])];
      right.append(field("Image", select(images, e.image?.kind === "import" ? `import:${e.image.id}` : e.image?.kind === "type" ? `type:${e.image.type}` : e.image?.kind === "typeBinding" ? `binding:${e.image.binding}` : "", value => set("image", value.startsWith("binding:") ? { kind: "typeBinding", binding: value.slice(8) as "view.type1" | "view.type2" | "move.type" } : value.startsWith("import:") ? { kind: "import", id: value.slice(7) } : value ? { kind: "type", type: Number(value.slice(5)) } : undefined))));
    }
    if (e.kind === "pokemon") {
      right.append(field("Icon source", select([["selected", "Selected Pokémon"], ...Array.from({ length: 6 }, (_, i) => [String(i), `Party slot ${i + 1}`] as [string, string]), ...Array.from({ length: 3 }, (_, i) => [`family:${i}`, `Evolution family position ${i + 1}`] as [string, string]), ["fixed", "Fixed species/form"]], e.pokemon.kind === "fixed" ? "fixed" : e.pokemon.kind === "family" ? `family:${e.pokemon.index}` : String(e.pokemon.slot), v => set("pokemon", v.startsWith("family:") ? { kind: "family", index: Number(v.slice(7)) } : v === "fixed" ? { kind: "fixed", species: 1, form: 0 } : { kind: "party", slot: v === "selected" ? "selected" : Number(v) }))));
      if (e.pokemon.kind === "fixed") { const p = e.pokemon; right.append(numberField("Species", p.species, v => set("pokemon", { ...p, species: v }), 1, 65535), numberField("Form", p.form, v => set("pokemon", { ...p, form: v }), 0, 255)); }
      right.append(checkbox("Animate native poses", e.animate, v => set("animate", v)));
    }
    if (e.kind === "list") right.append(field("Rows from", select([["party", "Party"], ["moves", "Selected Pokémon's moves"], ["learnset", "Viewed species learnset"]], e.list.source, v => set("list", { ...e.list, source: v as "party" | "moves" }))), numberField("Visible rows", e.list.rows, v => set("list", { ...e.list, rows: v }), 1, Math.min(12, Math.floor(e.height / 16))), textSource("Row label", e.list.label, v => set("list", { ...e.list, label: v })));
    if (e.kind === "list") {
      const group = el("fieldset"); group.append(el("legend", "Row columns"));
      (e.list.columns ?? []).forEach((column, index) => {
        const setColumn = (next: typeof column) => { const columns = structuredClone(e.list.columns!); columns[index] = next; set("list", { ...e.list, columns }); };
        const row = el("fieldset"); row.append(el("legend", `Column ${index + 1}`),
          field("Content", select([["text", "Text"], ["typeIcon", "Native type icon"]], column.kind ?? "text", kind => setColumn({ ...column, kind: kind as "text" | "typeIcon" }))),
          numberField("Column x", column.x, x => setColumn({ ...column, x }), 0, e.width - column.width),
          numberField("Column width", column.width, width => setColumn({ ...column, width }), 1, e.width - column.x),
          field("Column alignment", select([["left", "Left"], ["right", "Right"]], column.align, align => setColumn({ ...column, align: align as "left" | "right" }))),
          textSource("Column text / type", column.text, text => setColumn({ ...column, text })),
          deleteButton("Remove column", () => set("list", { ...e.list, columns: e.list.columns!.filter((_, i) => i !== index) })));
        group.append(row);
      });
      group.append(addButton("Add column", () => set("list", { ...e.list, columns: [...(e.list.columns ?? []), { x: 0, width: e.width, text: { binding: "move.name" }, align: "left" }] }), (e.list.columns?.length ?? 0) >= 4)); right.append(group);
    }
    if (e.kind === "panel") {
      right.append(checkbox("Fill as a data meter", !!e.meter, value => set("meter", value ? { binding: "pokemon.hp", maximum: 100 } : undefined)));
      if (e.meter) right.append(field("Meter value", select(BINDINGS.map(b => [b, b]), e.meter.binding, binding => set("meter", { ...e.meter!, binding: binding as typeof BINDINGS[number] }))), numberField("Maximum", e.meter.maximum, maximum => set("meter", { ...e.meter!, maximum }), 1, 65535));
    }
    if (e.kind === "button") {
      right.append(checkbox("Disabled", e.disabled, v => set("disabled", v)), field("Action", select(["open", "back", "close", "summary", "learnset", "selectParty", "selectList", "sound"].map(a => [a, a]), e.action.type, v => set("action", v === "open" ? { type: v, screen: currentDoc().screens.find(s => !s.target)?.id ?? "" } : v === "selectParty" ? { type: v, index: 0 } : v === "selectList" ? { type: v, list: screen().elements.find(e => e.kind === "list")?.id ?? "", delta: 1 } : v === "sound" ? { type: v, sound: "confirm" } : { type: v as "back" | "close" | "summary" | "learnset" }))));
      if (e.action.type === "open") right.append(field("Destination", select(currentDoc().screens.filter(s => !s.target).map(s => [s.id, s.name]), e.action.screen, screen => set("action", { type: "open", screen }))));
      if (e.action.type === "selectParty") right.append(numberField("Party slot (0–5)", e.action.index, index => set("action", { type: "selectParty", index }), 0, 5));
      if (e.action.type === "selectList") { const a = e.action; right.append(field("List", select(screen().elements.filter(e => e.kind === "list").map(e => [e.id, e.name]), a.list, list => set("action", { ...a, list }))), field("Direction", select([["-1", "Previous"], ["1", "Next"]], String(a.delta), delta => set("action", { ...a, delta: Number(delta) })))); }
      if (e.action.type === "sound") right.append(field("Sound", select(["cursor", "confirm", "cancel"].map(s => [s, s]), e.action.sound, sound => set("action", { type: "sound", sound: sound as "cursor" | "confirm" | "cancel" }))));
    }
    if (e.kind === "button" || e.kind === "list") {
      for (const state of ["focused", "pressed", "disabled"] as const) { const group = el("fieldset"); group.append(el("legend", state), button("Use normal appearance", () => { const states = { ...e.states }; delete states[state]; set("states", states); })); for (const key of ["fill", "border", "foreground", "shadow"] as const) group.append(field(key, inputText(e.states[state]?.[key] ?? e.paint[key], value => set("states", { ...e.states, [state]: { ...e.states[state], [key]: value } }), "color"))); right.append(group); }
      for (const direction of ["up", "down", "left", "right"] as const) right.append(field(`${direction} focus`, select([["", "Automatic"], ...screen().elements.filter(x => ["button", "list"].includes(x.kind) && x.id !== e.id).map(x => [x.id, x.name] as [string, string])], e.neighbors[direction] ?? "", value => { const neighbors = { ...e.neighbors }; if (value) neighbors[direction] = value; else delete neighbors[direction]; set("neighbors", neighbors); })));
    }
  }
  function duplicateSelection() { edit(doc => { selected = new Set(duplicateElements(doc, activeScreen, selected)); }); }
  function deleteSelection() { edit(doc => { deleteElements(doc, activeScreen, selected); selected.clear(); }); }
  function reorder(front: boolean) { edit(doc => { const s = doc.screens.find(s => s.id === activeScreen)!, chosen = s.elements.filter(e => selected.has(e.id)), other = s.elements.filter(e => !selected.has(e.id)); s.elements = front ? [...other, ...chosen] : [...chosen, ...other]; }); }
  function importNative() {
    const dialog = el("dialog"); dialog.append(el("h2", "Import native UI"), el("p", "Import the current read-only Learnset screen as live regions. Its native list, fonts, palettes, buttons, and animation stay connected to the game."));
    dialog.append(addButton("Use complete Learnset screen", () => {
      const preset = nativeLearnsetPreset(); history.commit(preset.document); activeScreen = preset.document.screens[0].id; selected.clear(); save(); dialog.close(); dialog.remove();
    }));
    const regionSelect = select(NATIVE_REGIONS.map(r => [r.id, r.name]), NATIVE_REGIONS[0].id, () => {});
    dialog.append(field("Individual region", regionSelect), addButton("Add selected region", () => {
      const region = NATIVE_REGIONS.find(r => r.id === regionSelect.value)!; edit(doc => {
        const e = newElement("native", nextId(doc, "native"), region.screen); Object.assign(e, { native: region.id, name: region.name, x: region.x, y: region.y, width: region.width, height: region.height });
        doc.screens.find(s => s.id === activeScreen)!.elements.push(e); selected = new Set([e.id]);
      }); dialog.close(); dialog.remove();
    }), button("Cancel", () => { dialog.close(); dialog.remove(); }));
    root.append(dialog); dialog.showModal();
  }
  function chooseFile(accept: string, callback: (file: File) => Promise<void>) { const input = el("input"); input.type = "file"; input.accept = accept; input.onchange = () => { const file = input.files?.[0]; if (file) callback(file).catch(fault); }; input.click(); }
  function importImage() { chooseFile("image/png,.png", async file => { if (file.size > 8 * 1024 * 1024) throw new Error("PNG is larger than 8 MiB."); const bytes = new Uint8Array(await file.arrayBuffer()), image = decodePng(bytes); if (disposed) return;
    edit(doc => { const id = nextId(doc, "asset"), path = `assets/${crypto.randomUUID()}.png`; source.files[path] = bytes; doc.assets.push({ id, name: file.name, path, width: image.width, height: image.height }); const e = newElement("image", nextId(doc, "element"), addTo); e.image = { kind: "import", id }; const scale = Math.min(1, 224 / image.width, 160 / image.height); e.width = Math.max(1, Math.round(image.width * scale)); e.height = Math.max(1, Math.round(image.height * scale)); doc.screens.find(s => s.id === activeScreen)!.elements.push(e); selected = new Set([e.id]); }); }); }
  function editSample() { const dialog = el("dialog"), area = el("textarea"); area.value = JSON.stringify(sample, null, 2); area.rows = 24; area.cols = 65; dialog.append(el("h2", "Preview game data"), area, button("Use sample", () => { attempt(() => { const parsed = JSON.parse(area.value); if (!parsed.trainer || !parsed.location || !Array.isArray(parsed.party) || parsed.party.length > 6 || parsed.party.some((p: { moves?: unknown }) => !Array.isArray(p.moves))) throw new Error("Sample needs trainer, location and up to six party members with move arrays."); sample = parsed; resetInteraction(); dialog.close(); dialog.remove(); paint(); }); }), button("Cancel", () => { dialog.close(); dialog.remove(); })); root.append(dialog); dialog.showModal(); }
  for (const physical of ["top", "bottom"] as const) {
    const canvas = canvases[physical]; canvas.width = 256; canvas.height = 192; canvas.style.width = `${256 * zoom}px`; canvas.tabIndex = 0; canvas.setAttribute("aria-label", `${physical} DS screen`);
    const heading = el("h2", physical === "top" ? "Top screen" : "Bottom screen · touch");
    const addHere = addButton(`Add to ${physical}`, () => { addTo = physical; selected.clear(); renderControls(); paint(); });
    const screenHeading = el("div", undefined, "cui-screen-heading"); screenHeading.append(heading, addHere); center.append(screenHeading, canvas);
    const point = (event: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: Math.floor((event.clientX - r.left) * 256 / r.width), y: Math.floor((event.clientY - r.top) * 192 / r.height) }; };
    let drag: { x: number; y: number; original: UiDocument; resize?: string } | undefined;
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return; const p = point(event); canvas.focus(); addTo = physical;
      if (interact) { if (physical === "bottom") { input(compiled.document, sample, session!, p); paint(); } return; }
      const hit = [...screen().elements].reverse().find(e => !e.hidden && e.screen === physical && p.x >= e.x && p.y >= e.y && p.x < e.x + e.width && p.y < e.y + e.height);
      if (!hit) { selected.clear(); renderControls(); paint(); return; }
      if (!canTransform(hit)) { selected = new Set([hit.id]); renderControls(); paint(); return; }
      if (event.shiftKey && selected.has(hit.id)) { selected.delete(hit.id); renderControls(); paint(); return; }
      if (!selected.has(hit.id)) { if (!event.shiftKey) selected.clear(); selected.add(hit.id); }
      const resize = selected.size === 1 && p.x >= hit.x + hit.width - 5 && p.y >= hit.y + hit.height - 5 ? hit.id : undefined;
      drag = { ...p, original: structuredClone(history.document), resize }; canvas.setPointerCapture(event.pointerId); renderControls(); paint();
    }, { signal: abort.signal });
    canvas.addEventListener("pointermove", event => {
      if (!drag) return; const p = point(event); draft = structuredClone(drag.original); const s = draft.screens.find(s => s.id === activeScreen)!;
      if (drag.resize) { const e = s.elements.find(e => e.id === drag!.resize)!; resizeElement(e, p.x - e.x, p.y - e.y, snap); }
      else moveElements(s.elements, selected, p.x - drag.x, p.y - drag.y, snap);
      rebuild(); paint();
    }, { signal: abort.signal });
    canvas.addEventListener("pointerup", () => { if (!drag) return; drag = undefined; if (draft) { history.commit(draft); draft = undefined; save(); } }, { signal: abort.signal });
    canvas.addEventListener("pointercancel", () => { drag = undefined; draft = undefined; rebuild(); paint(); }, { signal: abort.signal });
  }
  const previewControls = el("div", undefined, "cui-preview-controls");
  for (const [label, key] of [["←", "left"], ["↑", "up"], ["↓", "down"], ["→", "right"], ["A", "a"], ["B", "b"], ["L", "l"], ["R", "r"]] as const) previewControls.append(button(label, () => {
    if (!interact) { interact = true; resetInteraction(); renderControls(); }
    if (session) { input(compiled.document, sample, session, key); paint(); }
  }));
  const previewHelp = el("p", "Preview keys: arrows · Enter/Z = A · Esc/X = B · Q/W = L/R", "cui-preview-help");
  center.append(previewControls, previewHelp);
  const keys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "a", Escape: "b", z: "a", x: "b", q: "l", w: "r" } as const;
  root.addEventListener("keydown", event => {
    if ((event.target as HTMLElement).closest("dialog, button, .cui-access-panel") || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (interact) { const key = keys[event.key as keyof typeof keys]; if (key && session) { event.preventDefault(); input(compiled.document, sample, session, key); paint(); } return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey ? history.redo() : history.undo()) save(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelection(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selected = new Set(screen().elements.filter(e => e.screen === addTo && canTransform(e)).map(e => e.id)); renderControls(); paint(); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
    else if (event.key.startsWith("Arrow")) { event.preventDefault(); const step = event.shiftKey ? 8 : 1; edit(doc => moveElements(doc.screens.find(s => s.id === activeScreen)!.elements, selected, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0, false)); }
  }, { signal: abort.signal });
  try {
    const bytes = project.originalRomBytes ?? await loadActiveRomBytes(); if (!bytes) throw new Error("Reload the original ROM to resolve native fonts and images."); if (disposed) return;
    rom = new NintendoDSRom(bytes, { fileData: "view" }); sample = withLearnsetData(project, sample); rebuild(); container.replaceChildren(root); renderControls(); paint();
    const tick = (now: number) => { if (disposed) return; if (interact && session && now - lastTick >= 1000 / 60) { const elapsedFrames = Math.max(1, Math.floor((now - lastTick) * 60 / 1000)); session.frame += elapsedFrames; session.pressed = undefined; lastTick += elapsedFrames * 1000 / 60; paint(); } timer = requestAnimationFrame(tick); }; timer = requestAnimationFrame(tick);
  } catch (error) { container.replaceChildren(root); rebuild(); renderControls(); paint(); fault(error); }
}
