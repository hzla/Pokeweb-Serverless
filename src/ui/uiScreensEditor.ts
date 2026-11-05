import type { ProjectState } from "../pokeweb/projectStore";
import { canUseLocalRomBridge } from "../pokeweb/localRomBridge";
import { decodePng, type Image } from "../customUi/assets";
import { COMMANDS, DIRECTIONS, moveButton, neighbor, swapButtons, type Button, type Design, type Direction, type Rect } from "../nativeUi/document";
import { SCREEN_ADAPTERS } from "../nativeUi/registry";
import { designKey, type Library } from "../nativeUi/model";
import { compileGraphics, crop, iconImage, iconPalette, fixedPaletteColors } from "../nativeUi/graphics";
import { parsePokemonCellBank } from "../pokeweb/pokemonSpriteModel";
import { iconMembers } from "../nativeUi/graphics";
import { parseNitroBackground } from "../pokeweb/nitroBg";

let dispose: (() => void) | undefined;
export function stopUiScreensEditor(): void { dispose?.(); dispose = undefined; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}
function button(text: string, action: () => void, disabled = false): HTMLButtonElement {
  const node = el("button", text); node.type = "button"; node.disabled = disabled; node.onclick = action; return node;
}
function field(name: string, control: HTMLElement): HTMLLabelElement { const label = el("label"); control.dataset.uiField = name; label.append(el("span", name), control); return label; }
function select(values: [string, string][], value: string, changed: (value: string) => void): HTMLSelectElement {
  const node = el("select"); for (const [id, name] of values) { const option = el("option", name); option.value = id; node.append(option); } node.value = value; node.onchange = () => changed(node.value); return node;
}
export async function renderUiScreensEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): Promise<void> {
  stopUiScreensEditor();
  if (!canUseLocalRomBridge()) {
    root.replaceChildren(el("p", "UI screens are available only on localhost."));
    return;
  }
  let closed = false, busy = false, selected = 1, focus = 1, pressed = false, interactive = false;
  let part: "button" | "icon" | "label" | "touch" = "button", gender: "male" | "female" = "male", trainer = "Player", showTouch = false, showNavigation = false;
  let library: Library, past: Design[] = [], future: Design[] = [], swapWith = 2;
  let importTarget: "body" | "normal" | "selected" = "normal", message = "", problems: string[] = [], image: Image | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const adapter = SCREEN_ADAPTERS[0];
  const controller = new AbortController();
  dispose = () => { closed = true; controller.abort(); if (releaseTimer) clearTimeout(releaseTimer); };
  root.replaceChildren(el("p", "Loading native menu…"));
  try { library = await adapter.load(project); } catch (error) { if (!closed) root.replaceChildren(el("p", error instanceof Error ? error.message : String(error), "ui-screens-error")); return; }
  if (closed) return;
  const editor = el("main", undefined, "ui-screens-editor"), header = el("header"), toolbar = el("div", undefined, "ui-screens-toolbar");
  const content = el("div", undefined, "ui-screens-layout"), screens = el("aside", undefined, "ui-screens-list"), stage = el("section", undefined, "ui-screens-stage"), properties = el("aside", undefined, "ui-screens-properties");
  const previewBar = el("div", undefined, "ui-screens-toolbar"), canvas = el("canvas"), status = el("div", undefined, "ui-screens-status");
  canvas.width = 256; canvas.height = 192; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Main menu layout preview");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  header.append(el("h1", "UI screens"), toolbar); editor.append(header, content, status); content.append(screens, stage, properties); stage.append(previewBar, canvas); root.replaceChildren(editor);
  const current = () => library.state.draft;
  const chosen = () => current().buttons.find(b => b.id === selected)!;
  function commit(next: Design): void {
    if (designKey(next) === designKey(current())) return;
    past.push(structuredClone(current())); if (past.length > 100) past.shift(); future = [];
    library.state.draft = next; project.uiScreens = library.state; message = ""; onDirty(); render();
  }
  function edit(change: (design: Design, button: Button) => void): void { const next = structuredClone(current()); change(next, next.buttons.find(b => b.id === selected)!); commit(next); }
  function number(name: string, value: number, changed: (n: number) => void, step = 1): HTMLLabelElement {
    const input = el("input"); input.type = "number"; input.value = String(value); input.step = String(step); input.onchange = () => { const n = Number(input.value); if (Number.isFinite(n)) changed(n); if (input.isConnected) render(); }; return field(name, input);
  }
  function check(name: string, value: boolean, changed: (n: boolean) => void): HTMLLabelElement {
    const input = el("input"); input.type = "checkbox"; input.checked = value; input.onchange = () => changed(input.checked); return field(name, input);
  }
  function bounds(b: Button): Rect {
    return part === "button" ? { x: b.x, y: b.y, width: 128, height: 40 } : part === "icon" ? { x: b.iconX - 28, y: b.iconY - 16, width: 32, height: 32 } : part === "label" ? { x: b.labelX, y: b.labelY, width: 64, height: 16 } : b.touch;
  }
  function paint(): void {
    try { if (!problems.length) image = adapter.preview(library, current(), { gender, focus, pressed, trainer }); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    const ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    if (image) ctx.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
    if (showTouch || part === "touch") for (const b of current().buttons) { const r = b.touch; ctx.strokeStyle = b.id === selected ? "#ffcd50" : "#52e3d6"; ctx.setLineDash([2, 2]); ctx.strokeRect(r.x + .5, r.y + .5, r.width - 1, r.height - 1); } ctx.setLineDash([]);
    if (showNavigation) {
      const b = chosen(), sx = b.x + 64, sy = b.y + 20;
      for (const d of DIRECTIONS) {
        const id = neighbor(current(), b.id, d), target = current().buttons.find(b => b.id === id), tx = target ? target.x + 64 : 128, ty = target ? target.y + 20 : 180;
        if (id === b.id) continue;
        ctx.strokeStyle = "#ffce52"; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
        const angle = Math.atan2(ty - sy, tx - sx); ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(angle - .5) * 6, ty - Math.sin(angle - .5) * 6); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(angle + .5) * 6, ty - Math.sin(angle + .5) * 6); ctx.stroke();
      }
    }
    if (!interactive) { const r = bounds(chosen()); ctx.strokeStyle = "#57caff"; ctx.strokeRect(r.x + .5, r.y + .5, r.width - 1, r.height - 1); }
    status.replaceChildren(...problems.map(p => el("p", p, "ui-screens-error")), ...(message ? [el("p", message)] : []));
  }
  async function apply(): Promise<void> {
    busy = true; render();
    try { const result = await adapter.stage(project, library, controller.signal); message = result.changed ? "Applied. Export ROM to play." : "No unapplied changes."; onDirty(); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { busy = false; if (!closed) render(); }
  }
  async function importPng(): Promise<void> {
    const input = el("input"); input.type = "file"; input.accept = ".png,image/png";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error("Use a PNG smaller than 2 MiB.");
        const decoded = decodePng(new Uint8Array(await file.arrayBuffer())); if (closed) return; const next = structuredClone(current());
        const variant = selected === 2 || selected === 3 ? gender : "male";
        next.images[importTarget === "body" ? `body:${selected}` : `icon:${selected}:${variant}:${importTarget}`] = decoded;
        const errors = adapter.validate(library, next); if (errors.length) throw new Error(errors[0]);
        const result = compileGraphics(library.resources.files, next, library.version); commit(next);
        message = result.quantized ? "Imported; colors matched to the native palette." : "Imported."; paint();
      } catch (error) { message = error instanceof Error ? error.message : String(error); paint(); }
    };
    input.click();
  }
  function exportPng(): void {
    try {
      const files = compileGraphics(library.resources.files, current(), library.version).files, b = chosen(); let image: Image;
      if (importTarget === "body") { const background = parseNitroBackground(18, files[18], files[3], files[library.version === "B2" ? 1 : 0], { transparentIndexZero: true }); image = crop({ width: background.width, height: background.height, pixels: background.rgba }, b.x, b.y, 128, 40); }
      else image = iconImage(files, selected, gender, importTarget === "selected");
      const out = el("canvas"); out.width = image.width; out.height = image.height; out.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
      out.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob), a = el("a"); a.href = url; a.download = `main-menu-${selected}-${importTarget}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, "image/png");
    } catch (error) { message = error instanceof Error ? error.message : String(error); paint(); }
  }
  function render(): void {
    if (closed) return;
    const activeField = (document.activeElement as HTMLElement | null)?.dataset.uiField;
    problems = adapter.validate(library, current()); editor.inert = busy;
    toolbar.replaceChildren(button("Undo", () => { const d = past.pop(); if (d) { future.push(current()); library.state.draft = d; onDirty(); render(); } }, !past.length), button("Redo", () => { const d = future.pop(); if (d) { past.push(current()); library.state.draft = d; onDirty(); render(); } }, !future.length), button("Reset all", () => commit(structuredClone(library.state.baseline))), button("Apply to ROM", () => { void apply(); }, problems.length > 0 || designKey(current()) === designKey(library.state.applied)), el("span", busy ? "Applying…" : designKey(current()) === designKey(library.state.applied) ? "Applied" : "Draft", "ui-screens-indicator"));
    screens.replaceChildren(el("h2", "Screens"), ...SCREEN_ADAPTERS.map(a => { const item = button(a.name, () => {}); item.classList.add("-selected"); item.setAttribute("aria-current", "page"); return item; }), el("h2", "Buttons"));
    for (const b of current().buttons) { const item = button(COMMANDS[b.id - 1], () => { selected = b.id; focus = selected; render(); }); item.classList.toggle("-selected", b.id === selected); screens.append(item); }
    previewBar.replaceChildren(select([["button", "Move button"], ["icon", "Move icon"], ["label", "Move label"], ["touch", "Move touch area"]], part, value => { part = value as typeof part; render(); }), select([["male", "Male"], ["female", "Female"]], gender, value => { gender = value as typeof gender; render(); }), select([["normal", "Normal"], ["focused", "Focused"], ["pressed", "Pressed"]], pressed ? "pressed" : focus ? "focused" : "normal", value => { pressed = value === "pressed"; focus = value === "normal" ? 0 : selected; paint(); }), check("Touch areas", showTouch, value => { showTouch = value; paint(); }), check("Navigation", showNavigation, value => { showNavigation = value; paint(); }), check("Interact", interactive, value => { interactive = value; paint(); }));
    const b = chosen(); properties.replaceChildren(el("h2", COMMANDS[b.id - 1]));
    properties.append(number("Button X", b.x, n => edit((_, b) => moveButton(b, n - b.x, 0)), 8), number("Button Y", b.y, n => edit((_, b) => moveButton(b, 0, n - b.y)), 8));
    const coords = el("div", undefined, "ui-screens-coordinates");
    for (const [key, label, step] of [["iconX", "Icon X", 1], ["iconY", "Icon Y", 1], ["labelX", "Label X", 8], ["labelY", "Label Y", 8]] as const) coords.append(number(label, b[key], n => edit((_, b) => { b[key] = n; }), step));
    properties.append(coords);
    const labels = el("input"); labels.value = b.label ?? (b.id === 4 ? trainer : library.resources.labels[b.id]); labels.disabled = b.label === undefined; labels.maxLength = 24; labels.onchange = () => edit((_, b) => { b.label = labels.value; });
    properties.append(check(b.id === 4 ? "Use player name" : "Use native label", b.label === undefined, checked => edit((_, b) => { if (checked) delete b.label; else b.label = labels.value; })), field("Label", labels));
    properties.append(el("h3", "Touch area"));
    const touchFields = el("div", undefined, "ui-screens-coordinates");
    for (const key of ["x", "y", "width", "height"] as const) touchFields.append(number(key, b.touch[key], n => edit((_, b) => { b.touch[key] = n; })));
    properties.append(touchFields, el("h3", "D-pad"));
    for (const direction of DIRECTIONS) properties.append(field(direction, select([["0", "Automatic"], ...current().buttons.map(b => [String(b.id), COMMANDS[b.id - 1]] as [string, string]), ["7", "Close"]], String(b.neighbors[direction] ?? 0), value => edit((_, b) => { if (value === "0") delete b.neighbors[direction]; else b.neighbors[direction] = Number(value); }))));
    properties.append(field("Swap with", select(COMMANDS.map((name, i) => [String(i + 1), name]), String(swapWith), value => { swapWith = Number(value); })), button("Swap positions", () => edit((d, b) => swapButtons(b, d.buttons.find(b => b.id === swapWith)!))));
    properties.append(el("h3", "Artwork"), field("Target", select([["normal", "Icon · normal (32×32)"], ["selected", "Icon · selected / pressed (32×32)"], ["body", "Button panel (128×40)"]], importTarget, value => { importTarget = value as typeof importTarget; })), button("Import PNG", () => { void importPng(); }), button("Export PNG", exportPng), button("Reset artwork", () => edit(d => { for (const key of Object.keys(d.images)) if (key === `body:${selected}` || key.startsWith(`icon:${selected}:`)) delete d.images[key]; })));
    const palette = iconPalette(library.resources.files), pinned = fixedPaletteColors(library.resources.files), swatches = el("div", undefined, "ui-screens-swatches");
    properties.append(el("h3", "Shared icon colors"));
    const [, paletteCell] = iconMembers(selected, gender), paletteBanks = parsePokemonCellBank(library.resources.files[paletteCell]).cells.slice(0, 2).map(c => c.oams[0].palette);
    for (const [state, bank] of paletteBanks.entries()) for (let slot = 1; slot < 16; slot++) { const i = bank * 16 + slot; const input = el("input"); input.type = "color"; input.value = current().colors[`2:${i}`] ?? palette[i]; input.disabled = pinned.has(i); input.title = input.disabled ? "Shared with fixed controls" : `${state === 0 ? "Normal" : "Selected"} color ${slot}`; input.setAttribute("aria-label", input.title); input.onchange = () => edit(d => { d.colors[`2:${i}`] = input.value; }); swatches.append(input); }
    properties.append(swatches, button("Reset colors", () => edit(d => { d.colors = {}; })));
    paint();
    if (activeField) [...properties.querySelectorAll<HTMLElement>("[data-ui-field]")].find(e => e.dataset.uiField === activeField)?.focus({ preventScroll: true });
  }
  const point = (event: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * 256 / r.width, y: (event.clientY - r.top) * 192 / r.height }; };
  const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
  function activate(): void { message = focus === 7 ? "Close" : `${COMMANDS[focus - 1]} · native action`; pressed = true; paint(); releaseTimer = setTimeout(() => { pressed = false; if (!closed) paint(); }, 180); }
  let drag: { start: { x: number; y: number }; before: Design } | undefined;
  canvas.onpointerdown = event => {
    if (event.button !== 0 || busy) return;
    const p = point(event); canvas.focus();
    if (interactive) { const b = current().buttons.find(b => inside(p, b.touch)); if (b) { focus = b.id; activate(); } else if (p.y >= 168) { focus = 7; activate(); } return; }
    const b = [...current().buttons].reverse().find(b => inside(p, bounds(b))); if (!b) return;
    selected = b.id; focus = b.id; drag = { start: p, before: structuredClone(current()) }; canvas.setPointerCapture(event.pointerId); paint();
  };
  canvas.onpointermove = event => {
    if (!drag) return; const p = point(event), step = part === "button" || part === "label" ? 8 : 1, dx = Math.round((p.x - drag.start.x) / step) * step, dy = Math.round((p.y - drag.start.y) / step) * step;
    const d = structuredClone(drag.before), b = d.buttons.find(b => b.id === selected)!;
    if (part === "button") moveButton(b, dx, dy);
    else if (part === "icon") { b.iconX += dx; b.iconY += dy; }
    else if (part === "label") { b.labelX += dx; b.labelY += dy; }
    else { b.touch.x += dx; b.touch.y += dy; }
    library.state.draft = d; problems = adapter.validate(library, d); paint();
  };
  canvas.onpointerup = event => { if (!drag) return; const next = current(), before = drag.before; drag = undefined; library.state.draft = before; canvas.releasePointerCapture(event.pointerId); commit(next); render(); };
  canvas.onpointercancel = () => { if (drag) { library.state.draft = drag.before; drag = undefined; render(); } };
  canvas.onkeydown = event => {
    if (event.ctrlKey || event.metaKey) { if (event.key.toLowerCase() === "z") { event.preventDefault(); const d = (event.shiftKey ? future : past).pop(); if (d) { (event.shiftKey ? past : future).push(current()); library.state.draft = d; onDirty(); render(); } } return; }
    const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as Record<string, Direction | undefined>)[event.key];
    if (interactive) {
      if (direction) { event.preventDefault(); focus = neighbor(current(), focus, direction); paint(); }
      else if (["Enter", "a", "A"].includes(event.key)) { event.preventDefault(); activate(); }
      else if (["Escape", "b", "B", "x", "X"].includes(event.key)) { event.preventDefault(); focus = 7; activate(); }
      return;
    }
    if (!direction) return; event.preventDefault(); const step = part === "button" || part === "label" ? 8 : 1, dx = direction === "left" ? -step : direction === "right" ? step : 0, dy = direction === "up" ? -step : direction === "down" ? step : 0;
    edit((_, b) => { if (part === "button") moveButton(b, dx, dy); else if (part === "icon") { b.iconX += dx; b.iconY += dy; } else if (part === "label") { b.labelX += dx; b.labelY += dy; } else { b.touch.x += dx; b.touch.y += dy; } }); canvas.focus();
  };
  render();
}
