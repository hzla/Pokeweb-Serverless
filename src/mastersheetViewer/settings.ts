/**
 * The viewer's own settings, kept in this browser (localStorage) and applied to <html> as classes and CSS variables.
 * The settings panel (app.ts) lists them; a new setting adds a field here, a default, and a section there.
 *
 *   font      "game"    the game's own fonts, read from the ROM (gameFonts.ts), at 1.5× their pixel size
 *             "barlow"  Barlow, the editor's font, at sizes that suit it
 *             "menlo"   Menlo, the monospace font that comes with macOS (DejaVu Sans Mono, bundled, elsewhere)
 *   textSize  how large all text is, as a step from the usual size (24px game font, 18px Barlow)
 */
export type ViewerFont = "game" | "barlow" | "menlo";

export const TEXT_SIZES = [
  { id: "small", label: "Small", scale: 5 / 6 },
  { id: "medium", label: "Medium", scale: 1 },
  { id: "large", label: "Large", scale: 7 / 6 },
  { id: "larger", label: "Larger", scale: 4 / 3 },
] as const;

export type ViewerTextSize = (typeof TEXT_SIZES)[number]["id"];

export type ViewerSettings = { font: ViewerFont; textSize: ViewerTextSize };

const STORAGE_KEY = "pokeweb.mastersheetViewer.settings";
/** A first visit reads in the monospace font (Menlo on a Mac, the bundled DejaVu Sans Mono elsewhere). */
const DEFAULTS: ViewerSettings = { font: "menlo", textSize: "medium" };

let current: ViewerSettings | undefined;
/** False once the ROM's fonts turned out to be unreadable; the viewer then shows Barlow whatever is chosen. */
let gameFontsReadable = true;

export function viewerSettings(): ViewerSettings {
  current ??= readSettings();
  return { ...current };
}

export function updateViewerSettings(change: Partial<ViewerSettings>): ViewerSettings {
  current = { ...viewerSettings(), ...change };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be blocked (private windows, site data off); the choice then lasts until the page closes.
  }
  applyViewerSettings();
  return { ...current };
}

/** Whether the game's fonts can be shown. Unknown (true) until they have loaded or failed. */
export function gameFontsAvailable(): boolean {
  return gameFontsReadable;
}

export function setGameFontsAvailable(available: boolean): void {
  gameFontsReadable = available;
  applyViewerSettings();
}

export function applyViewerSettings(root: HTMLElement = document.documentElement): void {
  const settings = viewerSettings();
  // The game font falls back to Barlow when the ROM's fonts can't be read.
  const font = settings.font === "game" && !gameFontsReadable ? "barlow" : settings.font;
  root.classList.toggle("msv-font-barlow", font === "barlow");
  root.classList.toggle("msv-font-menlo", font === "menlo");
  const scale = TEXT_SIZES.find((size) => size.id === settings.textSize)?.scale ?? 1;
  if (scale === 1) root.style.removeProperty("--msv-text-scale");
  else root.style.setProperty("--msv-text-scale", String(scale));
}

function readSettings(): ViewerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ViewerSettings> | null;
    return {
      font: saved?.font === "game" || saved?.font === "barlow" || saved?.font === "menlo" ? saved.font : DEFAULTS.font,
      textSize: TEXT_SIZES.find((size) => size.id === saved?.textSize)?.id ?? DEFAULTS.textSize,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
