import "../styles/mastersheetViewer.css";
import { buildMastersheetDocument } from "../pokeweb/mastersheetDocument";
import { hasAuthoredMastersheet } from "../pokeweb/mastersheetRomFile";
import { canOpenMastersheetViewer } from "../pokeweb/mastersheetViewerAccess";
import type { ProjectState } from "../pokeweb/projectStore";
import { ImageCache, RomAssetProvider } from "./assets";
import { mountViewer } from "./app";
import { clearLastRom, loadLastRom, saveLastRom } from "./romStore";

/**
 * Mastersheet Viewer: opens a ROM file (players) or, with ?source=project, the project open in the editor
 * (authors), and shows the mastersheet saved with it. The ROM never leaves the browser.
 */

const root = document.getElementById("mastersheet-viewer")!;
/** The diagonal hatching at the end of Gen 5 title bars (as in app.ts). */
const HATCH = `<svg class="msv-hatch" viewBox="0 0 40 16" aria-hidden="true" focusable="false"><path d="M0 16 6 0h4L4 16ZM10 16 16 0h4l-6 16ZM20 16 26 0h4l-6 16ZM30 16 36 0h4l-6 16Z"/></svg>`;

async function boot(): Promise<void> {
  if (!canOpenMastersheetViewer()) {
    root.innerHTML = `
      <main class="msv-open">
        <div class="msv-open__card">
          <header class="msv-titlebar -run"><h1>Mastersheet Viewer</h1>${HATCH}</header>
          <div class="msv-open__body">
            <p>The Mastersheet Viewer is still in development and is available only when Pokeweb runs on localhost.</p>
            <a class="msv-hex -nav" href="./"><span>Back to Pokeweb</span></a>
          </div>
        </div>
      </main>
    `;
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("source") === "project") {
    showStatus("Opening the project from the editor…");
    try {
      const project = await openEditorProject();
      if (!project) {
        showOpenScreen("There's no project open in the editor on this browser. Open a ROM file instead.");
        return;
      }
      start(project);
    } catch (error) {
      showOpenScreen(`The editor's project couldn't be opened: ${message(error)}`);
    }
    return;
  }
  const last = await loadLastRom();
  if (last) {
    await openRom(last.file, last.name, { remembered: true, cacheKey: last.cacheKey });
    return;
  }
  showOpenScreen();
}

async function openEditorProject(): Promise<ProjectState | undefined> {
  const persistence = await import("../pokeweb/persistence");
  const project = await persistence.loadActiveProject();
  if (!project) return undefined;
  project.originalRomBytes ??= await persistence.loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("its ROM isn't stored in this browser. Open the project in the editor first.");
  return project;
}

async function openRomFile(file: File): Promise<void> {
  if (!/\.nds$/iu.test(file.name)) {
    showOpenScreen("That isn't a .nds ROM file.");
    return;
  }
  await openRom(file, file.name, { remembered: false });
}

/**
 * Opens a ROM and shows its mastersheet. A ROM chosen by the player is remembered so a refresh reopens it;
 * a remembered ROM that no longer opens is forgotten.
 */
async function openRom(file: Blob, name: string, from: { remembered: boolean; cacheKey?: string }): Promise<void> {
  showStatus(`${from.remembered ? "Reopening" : "Reading"} ${name}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { loadProjectFromRomBytes } = await import("../pokeweb/loader");
    const project = await loadProjectFromRomBytes(bytes, name);
    if (!hasAuthoredMastersheet(project)) {
      if (from.remembered) await clearLastRom();
      showOpenScreen(`${name} doesn't have a mastersheet saved in it. Authors can add one in Pokeweb (Mastersheet, "Save in the ROM") and export the ROM again.`);
      return;
    }
    const cacheKey = from.cacheKey ?? (await ImageCache.keyForRom(bytes).catch(() => undefined));
    if (!from.remembered) {
      // Best effort: without storage (private window, full disk) the viewer still works, it just asks again after a refresh.
      await saveLastRom({ name, file, cacheKey: cacheKey ?? "" }).catch((error) => console.warn("The ROM couldn't be kept for the next visit:", error));
    }
    start(project, cacheKey ? new ImageCache(cacheKey) : undefined, openAnotherRom);
  } catch (error) {
    if (from.remembered) await clearLastRom();
    showOpenScreen(`${name} couldn't be read: ${message(error)}`);
  }
}

async function openAnotherRom(): Promise<void> {
  await clearLastRom();
  // A fresh page, so the viewer's listeners and object URLs go with the old ROM.
  window.location.replace(`${window.location.pathname}${window.location.search}`);
}

function start(project: ProjectState, cache?: ImageCache, onOpenAnotherRom?: () => void): void {
  const document = buildMastersheetDocument(project);
  const assets = new RomAssetProvider(project, document, cache);
  window.document.title = `${document.title} mastersheet`;
  mountViewer(root, { project, document, assets, onOpenAnotherRom: onOpenAnotherRom && (() => void onOpenAnotherRom()) });
}

function showStatus(text: string): void {
  root.innerHTML = `<main class="msv-open"><p class="msv-open__status" role="status">${escapeText(text)}</p></main>`;
}

function showOpenScreen(problem?: string): void {
  root.innerHTML = `
    <main class="msv-open">
      <div class="msv-open__card">
        <header class="msv-titlebar -fight"><h1>Mastersheet Viewer</h1>${HATCH}</header>
        <div class="msv-open__body">
          <p>Open a ROM hack to read its mastersheet: every trainer, wild Pokémon and item, with maps and sprites drawn from the game itself.</p>
          <label class="msv-open__drop" id="msv-drop">
            <input type="file" accept=".nds" id="msv-file" hidden />
            <span class="msv-hex -fight"><span>Choose ROM file</span></span>
            <span class="msv-open__hint">or drop a .nds file here</span>
          </label>
          <p class="msv-open__note">Your ROM stays on this device. Nothing is uploaded.</p>
          ${problem ? `<p class="msv-open__problem" role="alert">${escapeText(problem)}</p>` : ""}
        </div>
      </div>
    </main>
  `;
  const input = root.querySelector<HTMLInputElement>("#msv-file")!;
  const drop = root.querySelector<HTMLElement>("#msv-drop")!;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void openRomFile(file);
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("-over");
    const file = event.dataTransfer?.files[0];
    if (file) void openRomFile(file);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

void boot();
