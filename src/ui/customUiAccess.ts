import { accessFor, defaultAccess, setAccess } from "../customUi/access";
import { DS_KEYS, newElement, type Access, type Document as UiDocument } from "../customUi/document";
import type { Assets } from "../customUi/assets";
import { blank, fill, panel, text } from "../customUi/raster";
import { validate } from "../customUi/validate";

/** Inline access editor. Draft settings survive unrelated canvas and property edits. */
export function createCustomUiAccessPanel(root: HTMLElement, documentValue: UiDocument, assets: Assets, commit: (access: Access) => void) {
  const h = (tag: string, value = "") => { const e = document.createElement(tag); e.textContent = value; return e; };
  const button = (label: string, run: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = run; return b; };
  const field = (label: string, control: HTMLElement) => { const l = h("label"); l.className = "cui-field"; l.append(h("span", label), control); return l; };
  let draft = accessFor(documentValue), choices = documentValue.screens.filter(s => !s.target);
  let savedSignature = JSON.stringify(draft), choicesSignature = JSON.stringify(choices.map(s => [s.id, s.name]));
  const cards = h("div"), errors = h("p"); errors.className = "cui-status -error"; cards.className = "cui-access-cards";
  root.replaceChildren(); root.setAttribute("aria-label", "Configure Accessibility");
  root.append(h("h2", "Configure Accessibility"), h("p", "Choose how players open your custom screens."));
  const capability = h("p", "The Learnset adapter supports the party command. Overworld keys and touch buttons are saved for preview; their ROM launchers are not available yet."); capability.className = "cui-access-note"; root.append(capability);
  const legacyNote = h("p", "Saving these settings replaces the old field-menu assignment."); legacyNote.hidden = !documentValue.launchers.field;
  errors.setAttribute("role", "status"); root.append(legacyNote, cards, errors);
  function render() {
    cards.replaceChildren();
    for (const [kind, name, explanation] of [
      ["hotkey", "Overworld key combination", "Opens once when the full combination is pressed, while overworld controls are available."],
      ["party", "Party menu command", "Opens for the selected Pokémon. The native command is omitted when no legal menu slot remains."],
      ["cgear", "Overworld touch button", "Bottom screen only. A hit inside this button belongs to Custom UI; other touches stay with C-Gear."],
    ] as const) {
      const card = h("fieldset"), enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = !!draft[kind]; enabled.disabled = !choices.length;
      enabled.onchange = () => { if (enabled.checked) Object.assign(draft, { [kind]: defaultAccess(kind, choices[0].id) }); else delete draft[kind]; render(); };
      const enabledField = field("Enabled", enabled); enabledField.classList.add("cui-inline-field");
      card.append(h("legend", name), enabledField, h("p", explanation));
      const entry = draft[kind];
      if (entry) {
        const target = document.createElement("select"); for (const s of choices) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.name; target.append(o); } target.value = entry.screen; target.onchange = () => { entry.screen = target.value; };
        card.append(field("Open screen", target));
        if ("label" in entry) { const label = document.createElement("input"); label.value = entry.label; label.maxLength = 24; label.oninput = () => { entry.label = label.value; draw(); }; card.append(field("Button / command label", label)); }
      }
      let draw = () => {};
      if (kind === "hotkey" && draft.hotkey) {
        const value = draft.hotkey, keys = h("div"); keys.className = "cui-key-grid";
        for (const key of DS_KEYS) { const b = button(key, () => { value.keys = value.keys.includes(key) ? value.keys.filter(k => k !== key) : [...value.keys, key]; render(); }); b.setAttribute("aria-pressed", String(value.keys.includes(key))); if (value.keys.includes(key)) b.classList.add("-selected"); keys.append(b); }
        card.append(keys, h("p", `Shortcut: ${value.keys.join(" + ") || "Choose 2–4 buttons"}`));
      }
      if (kind === "cgear" && draft.cgear) {
        const b = draft.cgear, canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 192; canvas.className = "cui-access-canvas"; canvas.setAttribute("aria-label", "Drag overworld button within bottom-screen placement guide");
        const numeric: Partial<Record<"x" | "y" | "width" | "height", HTMLInputElement>> = {};
        draw = () => {
          const image = blank(256, 192); fill(image, { x: 0, y: 0, width: 256, height: 192 }, "#202830");
          for (let y = 0; y < 192; y += 8) fill(image, { x: 0, y, width: 256, height: 1 }, "#303840");
          for (let x = 0; x < 256; x += 8) fill(image, { x, y: 0, width: 1, height: 192 }, "#303840");
          const e = newElement("button", "preview", "bottom"); Object.assign(e, b, { screen: "bottom", text: { literal: b.label }, align: "center" });
          panel(image, e, e.paint); text(image, { ...e, y: e.y + Math.max(0, Math.floor((e.height - 16) / 2)), height: Math.min(e.height, 16) }, b.label, assets, [], "access");
          canvas.getContext("2d")!.putImageData(new ImageData(image.pixels as Uint8ClampedArray<ArrayBuffer>, 256, 192), 0, 0);
          for (const key of ["x", "y", "width", "height"] as const) if (numeric[key]) numeric[key]!.value = String(b[key]);
        };
        const off = document.createElement("input"); off.type = "checkbox"; off.checked = b.whenOff; off.onchange = () => { b.whenOff = off.checked; };
        card.append(field("Also available with C-Gear off", off), h("p", "Placement guide · 256×192. Drag to position; set size below. The grid is not a reproduction of C-Gear."), canvas);
        for (const key of ["x", "y", "width", "height"] as const) {
          const input = document.createElement("input"); input.type = "number"; input.min = key === "x" || key === "y" ? "0" : "16"; input.max = key === "x" || key === "width" ? "256" : "192";
          const commitNumber = () => { b[key] = Math.round(Number(input.value)); draw(); };
          input.onchange = commitNumber; input.onblur = commitNumber; numeric[key] = input; card.append(field(key, input));
        }
        for (const key of ["fill", "border", "foreground", "shadow"] as const) { const input = document.createElement("input"); input.type = "color"; input.value = b.paint[key]; input.oninput = () => { b.paint[key] = input.value; draw(); }; card.append(field(key, input)); }
        let drag: { x: number; y: number; bx: number; by: number } | undefined;
        const point = (event: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * 256 / r.width, y: (event.clientY - r.top) * 192 / r.height }; };
        canvas.onpointerdown = event => { const p = point(event); if (event.button === 0 && p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height) { drag = { ...p, bx: b.x, by: b.y }; canvas.setPointerCapture(event.pointerId); } };
        canvas.onpointermove = event => { if (!drag) return; const p = point(event); b.x = Math.max(0, Math.min(256 - b.width, Math.round(drag.bx + p.x - drag.x))); b.y = Math.max(0, Math.min(192 - b.height, Math.round(drag.by + p.y - drag.y))); draw(); };
        canvas.onpointerup = canvas.onpointercancel = () => { drag = undefined; }; draw();
      }
      cards.append(card);
    }
    if (!choices.length) cards.append(h("p", "Add a custom screen first. Native Summary pages are reached through the existing Summary action."));
  }
  const actions = h("div"); actions.className = "cui-actions";
  const save = button("Save accessibility", () => {
    const candidate = structuredClone(documentValue); setAccess(candidate, draft);
    const problems = validate(candidate).filter(d => ["access", "hotkey"].includes(d.code));
    if (problems.length) { errors.classList.add("-error"); errors.textContent = problems.map(p => p.message).join(" "); return; }
    commit(structuredClone(draft)); errors.classList.remove("-error"); errors.textContent = "Accessibility saved.";
  });
  save.className = "cui-button-primary";
  actions.append(save, button("Reset changes", () => { draft = accessFor(documentValue); errors.textContent = ""; render(); }));
  root.append(actions); render();
  return {
    update(next: UiDocument, nextAssets: Assets) {
      const nextAccess = accessFor(next), signature = JSON.stringify(nextAccess), nextChoices = next.screens.filter(s => !s.target);
      const nextChoicesSignature = JSON.stringify(nextChoices.map(s => [s.id, s.name]));
      const changed = signature !== savedSignature || nextChoicesSignature !== choicesSignature || assets !== nextAssets;
      if (signature !== savedSignature) { draft = nextAccess; errors.textContent = ""; }
      documentValue = next; assets = nextAssets; choices = nextChoices;
      savedSignature = signature; choicesSignature = nextChoicesSignature; legacyNote.hidden = !next.launchers.field;
      if (changed) render();
    },
  };
}
