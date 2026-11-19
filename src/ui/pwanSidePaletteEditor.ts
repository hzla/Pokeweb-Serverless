import { rgbFrom555 } from "../pokeweb/naturePaletteData";
import type { PwanSide } from "../pokeweb/pwanAnimationModel";
import type { PwanOverrideSide } from "../pokeweb/projectStore";
import {
  bgr555ToHex, hexToBgr555, paletteIndexCounts, pwanSideIsFullSize, pwanSidePaletteFrames, pwanSidePalettes, sameArtIgnoringPalettes,
  type PwanSidePaletteFrame, type PwanSidePalettes,
} from "../pokeweb/pwanSidePalettes";

/**
 * The Colors panel of an animated sprite side: its 16 colours for normal and (with the streaming runtime) shiny
 * Pokémon. Clicking a colour shows where the art uses it; the picker and hex field round to the nearest DS colour.
 * The panel edits the side's draft through `host`; the side's Apply button saves it with the other edits.
 */
export type PwanSidePaletteHost = {
  side(): PwanOverrideSide;
  /** The main preview's timeline step, so the panel shows the same frame. */
  step(): number;
  setPalettes(palettes: PwanSidePalettes): void;
  /** Show the main preview in shiny colours (true) or normal ones. */
  showShiny(shiny: boolean): void;
};

export type PwanSidePalettePanel = {
  /** Redraw after the draft or the preview's frame changed. */
  refresh(): void;
};

type Kind = "normal" | "shiny";

const ART_SCALE = 2;
const HIGHLIGHT = [255, 236, 64];

export function renderPwanSidePalettePanel(side: PwanSide, data: PwanOverrideSide, withShiny: boolean): string {
  const fullSize = pwanSideIsFullSize(data);
  return `
    <section class="pwan-colors" data-pwan-colors="${side}" aria-label="${side} colors">
      <div class="pwan-colors-head">
        <h3>Colors</h3>
        ${withShiny ? `<div class="pwan-colors-kind" role="group" aria-label="Palette">
          <button class="pwan-segment-button -active" data-pwan-colors-kind="normal" type="button" aria-pressed="true">Normal</button>
          <button class="pwan-segment-button" data-pwan-colors-kind="shiny" type="button" aria-pressed="false">Shiny</button>
        </div>` : ""}
      </div>
      <p class="pwan-colors-hint">Click a color to see where ${fullSize ? "the full-size art" : "the art"} uses it, or click the art to pick one.</p>
      <div class="pwan-colors-body">
        <canvas class="pwan-colors-art" data-pwan-colors-art width="96" height="96" aria-label="${side} art with the selected color highlighted"></canvas>
        <div class="pwan-colors-side">
          <div class="pwan-colors-swatches" role="group" aria-label="${side} palette">
            ${Array.from({ length: 16 }, (_, index) => `<button class="pwan-colors-swatch ${index === 0 ? "-transparent" : ""}" data-pwan-colors-index="${index}" type="button" ${index === 0 ? "disabled title=\"0: transparent\"" : ""}><span>${index}</span></button>`).join("")}
          </div>
          <div class="pwan-colors-edit">
            <strong data-pwan-colors-selected>Color 1</strong>
            <input class="pwan-colors-picker" data-pwan-colors-picker type="color" aria-label="Color">
            <input class="pwan-colors-hex" data-pwan-colors-hex type="text" maxlength="7" spellcheck="false" aria-label="Hex color">
            <span class="pwan-colors-555" data-pwan-colors-555></span>
          </div>
          <p class="pwan-colors-note" data-pwan-colors-note aria-live="polite"></p>
          <div class="pwan-colors-actions">
            <label class="pwan-colors-toggle"><input type="checkbox" data-pwan-colors-highlight checked> Highlight</label>
            ${withShiny ? `<button class="btn -default" data-pwan-colors-link type="button" hidden>Use normal colors</button>` : ""}
          </div>
        </div>
      </div>
    </section>
  `;
}

export function installPwanSidePalettePanel(panel: HTMLElement, host: PwanSidePaletteHost): PwanSidePalettePanel | undefined {
  const root = panel.querySelector<HTMLElement>("[data-pwan-colors]");
  const canvas = root?.querySelector<HTMLCanvasElement>("[data-pwan-colors-art]");
  const ctx = canvas?.getContext("2d");
  if (!root || !canvas || !ctx) return undefined;
  const picker = root.querySelector<HTMLInputElement>("[data-pwan-colors-picker]")!;
  const hex = root.querySelector<HTMLInputElement>("[data-pwan-colors-hex]")!;
  const selectedLabel = root.querySelector<HTMLElement>("[data-pwan-colors-selected]")!;
  const levels = root.querySelector<HTMLElement>("[data-pwan-colors-555]")!;
  const note = root.querySelector<HTMLElement>("[data-pwan-colors-note]")!;
  const highlightToggle = root.querySelector<HTMLInputElement>("[data-pwan-colors-highlight]")!;
  const linkButton = root.querySelector<HTMLButtonElement>("[data-pwan-colors-link]");
  const swatches = [...root.querySelectorAll<HTMLButtonElement>("[data-pwan-colors-index]")];

  let palettes = pwanSidePalettes(host.side());
  // Shiny colours that match the normal ones follow normal edits until shiny is changed on its own.
  let linked = sameColors(palettes.normal, palettes.shiny);
  let kind: Kind = "normal";
  let selected = firstUsedIndex(palettes.normal);
  let hovered: number | undefined;
  let frames: PwanSidePaletteFrame[] = [];
  let framesOf: Uint8Array | undefined;
  let pending: number | undefined;

  const currentFrame = (): PwanSidePaletteFrame | undefined => {
    const side = host.side(), art = side.fullSizeMani ?? side.pwanBytes;
    // Palette edits copy the art's bytes without changing its pixels: only redecode when the frames really differ.
    if (!framesOf || !sameArtIgnoringPalettes(art, framesOf, Boolean(side.fullSizeMani))) {
      try { frames = pwanSidePaletteFrames(side); } catch { frames = []; }
    }
    framesOf = art;
    return frames.length ? frames[Math.max(0, Math.min(frames.length - 1, host.step()))] : undefined;
  };

  const drawArt = () => {
    const frame = currentFrame();
    if (!frame) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas.style.width = `${frame.width * ART_SCALE}px`;
    }
    const palette = palettes[kind], image = ctx.createImageData(frame.width, frame.height);
    const shown = highlightToggle.checked ? hovered ?? selected : hovered;
    frame.indices.forEach((index, at) => {
      if (!index) return;
      const { r, g, b } = rgbFrom555(palette[index] ?? 0), offset = at * 4;
      const color = shown === undefined ? [r, g, b] : index === shown ? HIGHLIGHT : [r * 0.3, g * 0.3, b * 0.3];
      image.data.set([color[0]!, color[1]!, color[2]!, 255], offset);
    });
    ctx.putImageData(image, 0, 0);
    const used = paletteIndexCounts(frame)[selected] ?? 0;
    if (!note.dataset.message) note.textContent = used ? `${used} pixels in this frame use color ${selected}.` : `Color ${selected} isn't used in this frame.`;
  };

  const syncControls = () => {
    const palette = palettes[kind];
    swatches.forEach((swatch, index) => {
      if (index) swatch.style.background = bgr555ToHex(palette[index] ?? 0);
      swatch.classList.toggle("-active", index === selected);
      swatch.setAttribute("aria-pressed", String(index === selected));
      swatch.title = index ? `${index}: ${bgr555ToHex(palette[index] ?? 0)}` : "0: transparent";
    });
    const value = palette[selected] ?? 0;
    selectedLabel.textContent = `Color ${selected}`;
    if (document.activeElement !== picker) picker.value = bgr555ToHex(value);
    if (document.activeElement !== hex) hex.value = bgr555ToHex(value);
    levels.textContent = `${value & 31}, ${(value >> 5) & 31}, ${(value >> 10) & 31} of 31`;
    root.querySelectorAll<HTMLButtonElement>("[data-pwan-colors-kind]").forEach((button) => {
      const active = button.dataset.pwanColorsKind === kind;
      button.classList.toggle("-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (linkButton) linkButton.hidden = kind !== "shiny" || linked;
  };

  const say = (message: string, error = false) => {
    note.textContent = message;
    note.dataset.message = message ? "1" : "";
    note.classList.toggle("-error", error);
  };

  // A colour picker sends many events while dragged; apply at most one draft change per frame.
  const commit = () => {
    if (pending !== undefined) return;
    pending = requestAnimationFrame(() => {
      pending = undefined;
      host.setPalettes({ normal: palettes.normal.slice(), shiny: palettes.shiny.slice() });
    });
  };

  const setColor = (value: number, typed: string) => {
    if (kind === "normal") {
      palettes.normal[selected] = value;
      if (linked) palettes.shiny[selected] = value;
    } else {
      palettes.shiny[selected] = value;
      linked = sameColors(palettes.normal, palettes.shiny);
    }
    const rounded = bgr555ToHex(value);
    say(rounded !== typed.toLowerCase() ? `Rounded to ${rounded}, the nearest color the DS can show.` : "");
    syncControls();
    drawArt();
    commit();
  };

  swatches.forEach((swatch, index) => {
    if (!index) return;
    swatch.addEventListener("click", () => { selected = index; say(""); syncControls(); drawArt(); });
    swatch.addEventListener("mouseenter", () => { hovered = index; drawArt(); });
    swatch.addEventListener("mouseleave", () => { hovered = undefined; drawArt(); });
  });
  canvas.addEventListener("click", (event) => {
    const frame = currentFrame();
    if (!frame) return;
    const box = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) * frame.width / box.width), y = Math.floor((event.clientY - box.top) * frame.height / box.height);
    const index = frame.indices[y * frame.width + x] ?? 0;
    if (!index) return;
    selected = index;
    say("");
    syncControls();
    drawArt();
  });
  picker.addEventListener("input", () => setColor(hexToBgr555(picker.value) ?? 0, picker.value));
  // The native picker keeps the exact colour it was dragged to; show the rounded one once it closes.
  picker.addEventListener("change", () => { picker.value = bgr555ToHex(palettes[kind][selected] ?? 0); });
  const applyHex = () => {
    const value = hexToBgr555(hex.value);
    if (value === undefined) { say("Enter a color like #f8a020.", true); return; }
    setColor(value, hex.value.startsWith("#") ? hex.value : `#${hex.value}`);
    hex.value = bgr555ToHex(value);
  };
  hex.addEventListener("change", applyHex);
  hex.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); applyHex(); } });
  highlightToggle.addEventListener("change", drawArt);
  root.querySelectorAll<HTMLButtonElement>("[data-pwan-colors-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      kind = button.dataset.pwanColorsKind === "shiny" ? "shiny" : "normal";
      say(kind === "shiny" && linked ? "Shiny Pokémon use the normal colors until you change one here." : "");
      host.showShiny(kind === "shiny");
      syncControls();
      drawArt();
    });
  });
  linkButton?.addEventListener("click", () => {
    palettes.shiny = palettes.normal.slice();
    linked = true;
    say("Shiny Pokémon use the normal colors again.");
    syncControls();
    drawArt();
    commit();
  });

  syncControls();
  drawArt();
  return {
    refresh() {
      // A rebuilt or applied draft brings its own colours; keep the editor's choice of normal or shiny. While a colour
      // change waits for the next frame, the draft is older than the panel.
      const next = pending === undefined ? pwanSidePalettes(host.side()) : palettes;
      if (!samePalettes(next, palettes)) {
        palettes = next;
        linked = sameColors(palettes.normal, palettes.shiny);
        syncControls();
      }
      drawArt();
    },
  };
}

function firstUsedIndex(palette: Uint16Array): number {
  for (let index = 1; index < 16; index++) if (palette[index]) return index;
  return 1;
}

function sameColors(a: Uint16Array, b: Uint16Array): boolean {
  return a.every((color, n) => n === 0 || color === b[n]);
}

function samePalettes(a: PwanSidePalettes, b: PwanSidePalettes): boolean {
  return sameColors(a.normal, b.normal) && sameColors(a.shiny, b.shiny);
}
