import "./styles.css";
import "./styles/legacyLayout.css";
import "./styles/legacyFields.css";
import "./styles/legacyPokemon.css";
import "./styles/legacyTrainers.css";
import "./styles/legacyEncounters.css";
import "./styles/legacyMovesItems.css";
import "./styles/legacyMartsGrottos.css";
import "./styles/legacyText.css";
import "./styles/legacyOverworlds.css";
import "./styles/legacyDocGenerators.css";
import "./styles/legacyMap3d.css";
import "./styles/legacyPokemonSprites.css";
import "./styles/fileSystem.css";

import { MANDATORY_NARCS, SELECTABLE_NARCS, type NarcName } from "./pokeweb/constants";
import { NARC } from "./nds/narc";
import { NintendoDSRom } from "./nds/rom";
import { exportModifiedRom } from "./pokeweb/exportRom";
import { parseHeaders } from "./pokeweb/headerModel";
import { installIntegrationConsoleApi } from "./pokeweb/integrationConsole";
import { loadProjectFromRomFile } from "./pokeweb/loader";
import { clearActiveProject, debounceProjectSave, hasActiveRomBytes, loadActiveProject, loadActiveRomBytes, saveActiveProject } from "./pokeweb/persistence";
import { createNarcStore, getCachedRecordCount, type ProjectState } from "./pokeweb/projectStore";
import { renderDebugNarcs } from "./ui/debugNarcs";
import { renderFileSystemEditor } from "./ui/fileSystemEditor";
import { renderHeaderEditor } from "./ui/headerEditor";
import { renderEncounterEditor } from "./ui/encounterEditor";
import { renderItemEditor, renderMoveEditor } from "./ui/moveItemEditor";
import { renderPokemonEditor } from "./ui/pokemonEditor";
import { renderPokemonSpriteEditor } from "./ui/pokemonSpriteEditor";
import { renderTmEditor } from "./ui/tmEditor";
import { renderTrainerEditor } from "./ui/trainerEditor";
import { renderGrottoEditor, renderGrottoOddsEditor, renderMartEditor } from "./ui/martGrottoEditor";
import { renderTextEditor } from "./ui/textEditor";
import { renderOverworldEditor } from "./ui/overworldEditor";
import { renderDocGenerators } from "./ui/docGenerators";

type AppRoute =
  | "upload"
  | "fileSystem"
  | "headers"
  | "overworlds"
  | "maps3d"
  | "pokemon"
  | "pokemonSprites"
  | "trainers"
  | "encounters"
  | "moves"
  | "items"
  | "tms"
  | "marts"
  | "grottos"
  | "grottoOdds"
  | "storyText"
  | "infoText"
  | "docGenerators"
  | "debugNarcs";
type AppHistoryState = {
  route: AppRoute;
  overworldId?: number;
  pokemonSpriteSpeciesId?: number;
  pokemonSpriteFormIndex?: number;
};
const ROUTE_KEY = "pokeweb-serverless-route";
const OVERWORLD_ROUTE_KEY = "pokeweb-serverless-overworld-id";

const APP_ROUTES: AppRoute[] = [
  "upload",
  "fileSystem",
  "headers",
  "overworlds",
  "maps3d",
  "pokemon",
  "pokemonSprites",
  "trainers",
  "encounters",
  "moves",
  "items",
  "tms",
  "marts",
  "grottos",
  "grottoOdds",
  "storyText",
  "infoText",
  "docGenerators",
  "debugNarcs",
];

const EDITOR_REQUIREMENTS: Record<Exclude<AppRoute, "upload" | "fileSystem" | "debugNarcs" | "grottoOdds" | "docGenerators" | "maps3d">, NarcName[]> = {
  headers: ["headers", "message_texts"],
  overworlds: ["headers", "matrix", "maps", "overworlds"],
  pokemon: ["personal", "learnsets", "evolutions", "moves", "items"],
  pokemonSprites: ["personal", "pokemon_sprites", "pokemon_icons"],
  trainers: ["trdata", "trpok", "personal", "items", "moves", "trtext_table", "trtext_offsets"],
  encounters: ["encounters"],
  moves: ["moves"],
  items: ["items"],
  tms: ["moves"],
  marts: ["marts", "mart_counts"],
  grottos: ["grottos", "grotto_odds"],
  storyText: ["story_texts"],
  infoText: ["message_texts"],
};

const NARC_LABELS: Partial<Record<NarcName, string>> = {
  headers: "Headers",
  message_texts: "Message Text",
  story_texts: "Story Text",
  scripts: "Scripts",
  personal: "Personal Data",
  move_spas: "Move SPAs",
  maps: "Map Layouts",
  matrix: "Matrices",
  overworlds: "Overworlds",
  learnsets: "Learnsets",
  evolutions: "Evolutions",
  moves: "Moves",
  move_animations: "Move Animations",
  battle_animations: "Battle Animations",
  items: "Items",
  trtext_table: "Trainer Text Table",
  trtext_offsets: "Trainer Text Offsets",
  trdata: "Trainer Data",
  trpok: "Trainer Pokemon",
  encounters: "Encounters",
  marts: "Marts",
  mart_counts: "Mart Counts",
  grottos: "Hidden Grottoes",
  starter_sprites: "Starter Sprites",
  pokemon_sprites: "Pokemon Sprites",
  pokemon_icons: "Pokemon Icons",
};

type NarcLoadSection = {
  title: string;
  names: NarcName[];
  toggleable?: boolean;
};

const NARC_LOAD_SECTIONS: NarcLoadSection[] = [
  { title: "Required", names: [...MANDATORY_NARCS] },
  { title: "Sprites", names: ["pokemon_sprites", "pokemon_icons", "starter_sprites"], toggleable: true },
  { title: "Moves", names: ["moves", "move_animations", "battle_animations", "move_spas"], toggleable: true },
  { title: "Pokemon", names: ["personal", "learnsets", "evolutions"], toggleable: true },
  { title: "Trainers", names: ["trdata", "trpok", "trtext_table", "trtext_offsets"], toggleable: true },
  { title: "Maps", names: ["maps", "matrix"], toggleable: true },
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
const appRoot = app;

let project: ProjectState | undefined;
let route: AppRoute = "upload";
let activeOverworldId: number | undefined;
let activePokemonSpriteSpeciesId: number | undefined;
let activePokemonSpriteFormIndex = 0;
let dirty = false;
let hasExportBase = false;
const scheduleSave = debounceProjectSave();

installIntegrationConsoleApi(
  () => project,
  () => {
    dirty = true;
    if (project) scheduleSave(project);
    renderDirtyIndicator();
  },
);

void boot();

async function boot(): Promise<void> {
  try {
    project = await loadActiveProject();
    hasExportBase = await hasActiveRomBytes();
    hydrateProject(project);
  } catch {
    project = undefined;
    hasExportBase = false;
  }
  const initialState = routeStateFromUrl() ?? routeStateFromStorage();
  activeOverworldId = initialState.overworldId;
  activePokemonSpriteSpeciesId = initialState.pokemonSpriteSpeciesId;
  activePokemonSpriteFormIndex = initialState.pokemonSpriteFormIndex ?? 0;
  route = project ? initialState.route : "upload";
  if (project && route === "upload" && !window.location.hash) route = "headers";
  route = safeRoute(route);
  syncRouteStorage();
  syncBrowserHistory(true);
  renderApp();
}

window.addEventListener("popstate", (event) => {
  const nextState = routeStateFromHistory(event.state) ?? routeStateFromUrl() ?? routeStateFromStorage();
  applyRouteState(nextState, { fromHistory: true });
});

function renderApp(): void {
  route = safeRoute(route);
  appRoot.innerHTML = `
    ${renderNav()}
    <div id="content-container"></div>
  `;

  const content = document.querySelector<HTMLDivElement>("#content-container");
  if (!content) throw new Error("Missing content container");

  attachNav();
  if (!project || route === "upload") {
    renderUpload(content);
    return;
  }

  if (route === "headers") {
    renderHeaderEditor(
      project,
      content,
      () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      canVisit("overworlds") ? openOverworld : undefined,
    );
    content.querySelector<HTMLButtonElement>("#debug-narcs-btn")?.addEventListener("click", () => navigate("debugNarcs"));
    return;
  }

  if (route === "fileSystem") {
    content.innerHTML = `<div class="file-system-page"><div class="file-system-empty">Loading file system...</div></div>`;
    void renderFileSystemEditor(project, content, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
    }).catch((error) => {
      content.innerHTML = `<div class="file-system-page"><div class="file-system-empty">${error instanceof Error ? error.message : String(error)}</div></div>`;
    });
    return;
  }

  if (route === "overworlds") {
    if (activeOverworldId === undefined) {
      navigate("headers");
      return;
    }
    renderOverworldEditor(
      project,
      content,
      activeOverworldId,
      () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      () => navigate("headers"),
    );
    return;
  }

  if (route === "maps3d") {
    content.innerHTML = `<div class="pokemon-filter map3d-sidebar"><div class="filter-title">Maps 3D</div><div class="map3d-status">Loading viewer...</div></div>`;
    void import("./ui/map3dEditor").then(({ renderMap3dEditor }) => {
      if (route === "maps3d" && project) {
        renderMap3dEditor(project, content, () => {
          dirty = true;
          scheduleSave(project!);
          renderDirtyIndicator();
        });
      }
    });
    return;
  }

  if (route === "pokemon") {
    renderPokemonEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    }, openPokemonSprites);
    return;
  }

  if (route === "pokemonSprites") {
    if (activePokemonSpriteSpeciesId === undefined) {
      navigate("pokemon");
      return;
    }
    renderPokemonSpriteEditor(project, content, activePokemonSpriteSpeciesId, activePokemonSpriteFormIndex, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      onBack: () => navigate("pokemon"),
      onNavigateSpecies: (speciesId) => openPokemonSprites(speciesId, 0),
      onNavigateForm: (formIndex) => openPokemonSprites(activePokemonSpriteSpeciesId!, formIndex),
    });
    return;
  }

  if (route === "trainers") {
    renderTrainerEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "encounters") {
    renderEncounterEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "moves") {
    renderMoveEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "items") {
    renderItemEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "tms") {
    renderTmEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "marts") {
    renderMartEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "grottos") {
    renderGrottoEditor(
      project,
      content,
      () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      () => navigate("grottoOdds"),
    );
    return;
  }

  if (route === "grottoOdds") {
    renderGrottoOddsEditor(
      project,
      content,
      () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      () => navigate("grottos"),
    );
    return;
  }

  if (route === "storyText") {
    renderTextEditor(project, content, "story_texts", "Story Text", () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "infoText") {
    renderTextEditor(project, content, "message_texts", "Info Text", () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "docGenerators") {
    renderDocGenerators(project, content, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
    });
    return;
  }

  renderDebugNarcs(project, content, renderDirtyIndicator);
}

function renderNav(): string {
  if (!project) return `<div id="header"></div>`;
  const bw2Links =
    project.session.baseRom === "BW2"
      ? `
        ${navItem("marts", "Marts")}
        ${navItem("grottos", "Grottoes")}
      `
      : "";
  return `
    <div id="header">
      <div class="header-left">
        ${navItem("headers", "Headers & Overworlds")}
        ${navItem("maps3d", "Maps")}
        ${navItem("pokemon", "Pokemon")}
        ${navItem("trainers", "Trainers")}
        ${navItem("encounters", "Encounters")}
        ${navItem("moves", "Moves")}
        ${navItem("items", "Items")}
        ${navItem("tms", "TMs")}
        ${bw2Links}
        ${navItem("storyText", "Story Text")}
        ${navItem("infoText", "Info Text")}
        ${navItem("docGenerators", "Doc Generators")}
        ${navItem("fileSystem", "File System")}
      </div>
      <div class="header-status" id="header-status">${dirty ? `<div class="dirty-indicator">Unsaved browser edits</div>` : ""}</div>
      <div class="header-right">
        <a class="header-item ${route === "debugNarcs" ? "-active" : ""}" href="#" data-route="debugNarcs">Debug</a>
        <a class="header-item ${hasExportBase ? "" : "disabled"}" href="#" data-export-rom="true" ${
          hasExportBase ? "" : `title="Reload the ROM before exporting this older saved project"`
        }>Download ROM</a>
        <a class="header-item" href="#" data-route="upload">New</a>
      </div>
    </div>
  `;
}

function attachNav(): void {
  appRoot.querySelectorAll<HTMLAnchorElement>("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(link.dataset.route as AppRoute);
    });
  });

  appRoot.querySelector<HTMLDivElement>("#header")?.addEventListener("click", () => {
    if (window.screen.width <= 1180) {
      appRoot.querySelectorAll<HTMLElement>(".header-item").forEach((item) => {
        if (!item.classList.contains("-active")) item.style.display = item.style.display === "block" ? "" : "block";
      });
    }
  });

  appRoot.querySelector<HTMLAnchorElement>("[data-export-rom]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!project || !hasExportBase) {
      window.alert("This saved project does not include the original ROM bytes. Please load the ROM again before exporting.");
      return;
    }
    await downloadRom();
  });
}

async function downloadRom(): Promise<void> {
  if (!project) return;
  const link = appRoot.querySelector<HTMLAnchorElement>("[data-export-rom]");
  const previousText = link?.textContent ?? "Download ROM";
  try {
    if (link) {
      link.textContent = "Building...";
      link.classList.add("disabled");
    }
    await saveActiveProject(project);
    const bytes = await exportModifiedRom(project);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.session.romName || "pokeweb"}-modified.nds`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    dirty = false;
    renderDirtyIndicator();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  } finally {
    if (link) {
      link.textContent = previousText;
      link.classList.toggle("disabled", !hasExportBase);
    }
  }
}

function navigate(nextRoute: AppRoute): void {
  applyRouteState({ route: nextRoute, overworldId: activeOverworldId }, { clearProject: nextRoute === "upload" });
}

function openOverworld(overworldId: number): void {
  if (!canVisit("overworlds")) return;
  applyRouteState({ route: "overworlds", overworldId });
}

function openPokemonSprites(speciesId: number, formIndex = 0): void {
  void openPokemonSpritesAsync(speciesId, formIndex);
}

async function openPokemonSpritesAsync(speciesId: number, formIndex = 0): Promise<void> {
  if (!project) return;
  try {
    await ensurePokemonSpriteNarcs();
    applyRouteState({ route: "pokemonSprites", pokemonSpriteSpeciesId: speciesId, pokemonSpriteFormIndex: formIndex });
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

async function ensurePokemonSpriteNarcs(): Promise<void> {
  if (!project) return;
  if (project.narcs.pokemon_sprites && project.narcs.pokemon_icons) return;

  const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!bytes) throw new Error("Pokemon sprite data is not loaded. Reload the ROM once, then open the paintbrush editor again.");

  const rom = new NintendoDSRom(bytes);
  for (const definition of [
    { path: "a/0/0/4", name: "pokemon_sprites" as const },
    { path: "a/0/0/7", name: "pokemon_icons" as const },
  ]) {
    if (project.narcs[definition.name]) continue;
    const fileId = rom.fileId(definition.path);
    project.session.fileIds[definition.name] = fileId;
    project.session.blacklist = project.session.blacklist.filter((name) => name !== definition.name);
    project.narcs[definition.name] = createNarcStore(definition.name, definition.path, fileId, new NARC(rom.files[fileId]));
  }
  await saveActiveProject(project);
}

function renderUpload(root: HTMLElement): void {
  const mandatoryNarcs = new Set<NarcName>(MANDATORY_NARCS);
  const sectionedNarcs = new Set<NarcName>(NARC_LOAD_SECTIONS.flatMap((section) => section.names));
  const otherNarcs = SELECTABLE_NARCS.map((definition) => definition.name).filter((name) => !sectionedNarcs.has(name));
  const narcSections = [...NARC_LOAD_SECTIONS, { title: "Other", names: otherNarcs }];
  root.innerHTML = `
    <section class="upload-page">
      <div class="upload-panel">
        <h1>Pokeweb</h1>
        <p>Upload a Gen V .nds ROM to parse it locally and open the serverless editors.</p>
        <label class="upload-dropzone">
          <span>Upload .nds ROM</span>
          <input id="rom-input" type="file" accept=".nds" />
        </label>
        <label class="upload-options">
          <input id="fairy-input" type="checkbox" />
          <span>Fairy ROM offsets</span>
        </label>
        <div class="narc-picker">
          <div class="narc-picker__header">
            <div>
              <h2>NARCs to Load</h2>
              <p>Unchecked optional NARCs are skipped and their editors stay unavailable.</p>
            </div>
            <button class="btn -default" id="minimal-narcs-btn" type="button">Core Only</button>
          </div>
          <div class="narc-picker__sections">
            ${narcSections.map((section) => renderNarcLoadSection(section, mandatoryNarcs)).join("")}
          </div>
        </div>
        <div class="upload-status" id="status">Waiting for a ROM.</div>
      </div>
    </section>
  `;

  const input = root.querySelector<HTMLInputElement>("#rom-input");
  const fairyInput = root.querySelector<HTMLInputElement>("#fairy-input");
  const minimalNarcsButton = root.querySelector<HTMLButtonElement>("#minimal-narcs-btn");
  const status = root.querySelector<HTMLDivElement>("#status");
  const sectionToggles = [...root.querySelectorAll<HTMLInputElement>(".narc-section__toggle")];

  const syncSectionToggles = () => {
    sectionToggles.forEach((toggle) => {
      const section = toggle.closest<HTMLElement>(".narc-section");
      const checkboxes = [...(section?.querySelectorAll<HTMLInputElement>(".narc-input:not(:disabled)") ?? [])];
      const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
      toggle.checked = checkedCount > 0 && checkedCount === checkboxes.length;
      toggle.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    });
  };

  sectionToggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const section = toggle.closest<HTMLElement>(".narc-section");
      section?.querySelectorAll<HTMLInputElement>(".narc-input:not(:disabled)").forEach((checkbox) => {
        checkbox.checked = toggle.checked;
      });
      syncSectionToggles();
    });
  });

  root.querySelectorAll<HTMLInputElement>(".narc-input").forEach((checkbox) => {
    checkbox.addEventListener("change", syncSectionToggles);
  });

  syncSectionToggles();

  minimalNarcsButton?.addEventListener("click", () => {
    root.querySelectorAll<HTMLInputElement>(".narc-input").forEach((checkbox) => {
      if (!checkbox.disabled) checkbox.checked = false;
    });
    syncSectionToggles();
  });

  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      statusText(status, "Starting ROM load");
      const selectedNarcs = getSelectedNarcs(root);
      project = await loadProjectFromRomFile(file, { fairy: fairyInput?.checked ?? false, selectedNarcs }, (message) => statusText(status, message));
      dirty = false;
      await saveActiveProject(project);
      hasExportBase = true;
      applyRouteState({ route: "headers" });
    } catch (error) {
      statusText(status, error instanceof Error ? error.message : String(error));
    }
  });
}

function renderNarcLoadSection(section: NarcLoadSection, mandatoryNarcs: Set<NarcName>): string {
  return `
    <section class="narc-section">
      <div class="narc-section__header">
        <h3>${section.title}</h3>
        ${
          section.toggleable
            ? `<label class="narc-section__toggle-label">
                <input class="narc-section__toggle" type="checkbox" checked />
                <span>All</span>
              </label>`
            : ""
        }
      </div>
      <div class="narc-picker__grid">
        ${section.names
          .map((name) => {
            const mandatory = mandatoryNarcs.has(name);
            return `
              <label class="narc-choice ${mandatory ? "-mandatory" : ""}">
                <input class="narc-input" type="checkbox" value="${name}" ${mandatory ? "disabled" : ""} checked />
                <span>${NARC_LABELS[name] ?? name}</span>
                ${mandatory ? `<em>Required</em>` : ""}
              </label>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function hydrateProject(nextProject: ProjectState | undefined): void {
  if (!nextProject) return;
  nextProject.fileSystem ??= { replacements: {} };
  nextProject.fileSystem.replacements ??= {};
  if (nextProject.narcs.headers && !nextProject.headers) nextProject.headers = parseHeaders(nextProject);
  nextProject.docs ??= {
    romTitle: nextProject.session.romName,
    trainerLocations: {},
    itemLocations: {},
    groundItemScriptMap: {},
  };
  nextProject.docs.romTitle ||= nextProject.session.romName;
  nextProject.docs.trainerLocations ??= {};
  nextProject.docs.itemLocations ??= {};
  nextProject.docs.groundItemScriptMap ??= {};
}

function getSelectedNarcs(root: HTMLElement): NarcName[] {
  const selected = new Set<NarcName>(MANDATORY_NARCS);
  root.querySelectorAll<HTMLInputElement>(".narc-input:checked").forEach((checkbox) => selected.add(checkbox.value as NarcName));
  return [...selected];
}

function canVisit(nextRoute: Exclude<AppRoute, "upload" | "debugNarcs" | "grottoOdds">): boolean {
  if (!project) return false;
  if (nextRoute === "docGenerators") return true;
  if (nextRoute === "fileSystem") return hasExportBase;
  if (nextRoute === "maps3d") return Boolean(project.headers && hasExportBase);
  if ((nextRoute === "marts" || nextRoute === "grottos") && project.session.baseRom !== "BW2") return false;
  const editorRoute = nextRoute as Exclude<AppRoute, "upload" | "fileSystem" | "debugNarcs" | "grottoOdds" | "docGenerators" | "maps3d">;
  return EDITOR_REQUIREMENTS[editorRoute].every((name) => project?.narcs[name]);
}

function navItem(nextRoute: Exclude<AppRoute, "upload" | "debugNarcs" | "grottoOdds" | "pokemonSprites">, label: string): string {
  const enabled = canVisit(nextRoute);
  const requirements =
    nextRoute === "docGenerators"
      ? []
      : nextRoute === "fileSystem"
        ? ([] as NarcName[])
      : nextRoute === "maps3d"
        ? ([] as NarcName[])
      : EDITOR_REQUIREMENTS[nextRoute as Exclude<AppRoute, "upload" | "fileSystem" | "debugNarcs" | "grottoOdds" | "docGenerators" | "maps3d">];
  const missing = enabled
    ? ""
    : nextRoute === "fileSystem"
      ? ` title="Reload the ROM before opening File System"`
      : nextRoute === "maps3d"
        ? ` title="${project?.headers ? "Reload the ROM before opening Maps 3D" : "Missing parsed headers"}"`
      : ` title="Missing: ${requirements.filter((name) => !project?.narcs[name]).join(", ")}"`;
  const active = route === nextRoute || (nextRoute === "headers" && route === "overworlds");
  return `<a class="header-item ${active ? "-active" : ""} ${enabled ? "" : "disabled"}" href="${routeUrl(nextRoute)}" ${enabled ? `data-route="${nextRoute}"` : ""}${missing}>${label}</a>`;
}

function safeRoute(nextRoute: AppRoute): AppRoute {
  if (!project || nextRoute === "upload" || nextRoute === "debugNarcs") return nextRoute;
  if (nextRoute === "grottoOdds") return canVisit("grottos") ? nextRoute : safeRoute("grottos");
  if (nextRoute === "overworlds" && activeOverworldId === undefined) return safeRoute("headers");
  if (nextRoute === "pokemonSprites" && activePokemonSpriteSpeciesId === undefined) return safeRoute("pokemon");
  if (canVisit(nextRoute)) return nextRoute;
  return canVisit("headers") ? "headers" : "debugNarcs";
}

function applyRouteState(nextState: AppHistoryState, options: { replace?: boolean; fromHistory?: boolean; clearProject?: boolean } = {}): void {
  const requestedRoute = nextState.route;
  if (
    requestedRoute !== "upload" &&
    requestedRoute !== "debugNarcs" &&
    requestedRoute !== "grottoOdds" &&
    !canVisit(requestedRoute)
  )
    return;
  if (requestedRoute === "grottoOdds" && !canVisit("grottos")) return;

  if (requestedRoute === "upload" && options.clearProject) {
    project = undefined;
    dirty = false;
    hasExportBase = false;
    void clearActiveProject();
  }

  activeOverworldId = nextState.overworldId;
  activePokemonSpriteSpeciesId = nextState.pokemonSpriteSpeciesId;
  activePokemonSpriteFormIndex = nextState.pokemonSpriteFormIndex ?? 0;
  route = safeRoute(project ? requestedRoute : "upload");
  if (route !== "overworlds" && nextState.route !== "overworlds") activeOverworldId = nextState.overworldId;
  syncRouteStorage();
  if (!options.fromHistory) syncBrowserHistory(options.replace ?? false);
  renderApp();
}

function syncRouteStorage(): void {
  window.localStorage.setItem(ROUTE_KEY, route);
  if (activeOverworldId !== undefined) window.localStorage.setItem(OVERWORLD_ROUTE_KEY, String(activeOverworldId));
  else window.localStorage.removeItem(OVERWORLD_ROUTE_KEY);
}

function syncBrowserHistory(replace: boolean): void {
  const state = currentHistoryState();
  const url = routeUrl(state.route, state.overworldId);
  if (replace) window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
}

function currentHistoryState(): AppHistoryState {
  if (route === "overworlds") return { route, overworldId: activeOverworldId };
  if (route === "pokemonSprites") return { route, pokemonSpriteSpeciesId: activePokemonSpriteSpeciesId, pokemonSpriteFormIndex: activePokemonSpriteFormIndex };
  return { route };
}

function routeUrl(nextRoute: AppRoute, overworldId = activeOverworldId): string {
  if (nextRoute === "overworlds" && overworldId !== undefined) return `#overworlds/${overworldId}`;
  if (nextRoute === "pokemonSprites" && activePokemonSpriteSpeciesId !== undefined) {
    return `#pokemonSprites/${activePokemonSpriteSpeciesId}/${activePokemonSpriteFormIndex}`;
  }
  return `#${nextRoute}`;
}

function routeStateFromUrl(): AppHistoryState | undefined {
  const hash = window.location.hash.replace(/^#/u, "");
  if (!hash) return undefined;
  const [routeName, idText, extraText] = hash.split("/");
  if (!isAppRoute(routeName)) return undefined;
  const id = idText === undefined ? undefined : Number(idText);
  const formIndex = extraText === undefined ? undefined : Number(extraText);
  return {
    route: routeName,
    overworldId: routeName === "overworlds" && Number.isSafeInteger(id) ? id : undefined,
    pokemonSpriteSpeciesId: routeName === "pokemonSprites" && Number.isSafeInteger(id) ? id : undefined,
    pokemonSpriteFormIndex: routeName === "pokemonSprites" && Number.isSafeInteger(formIndex) ? formIndex : undefined,
  };
}

function routeStateFromStorage(): AppHistoryState {
  const savedRoute = window.localStorage.getItem(ROUTE_KEY);
  const routeName = isAppRoute(savedRoute) ? savedRoute : project ? "headers" : "upload";
  const savedOverworldId = Number(window.localStorage.getItem(OVERWORLD_ROUTE_KEY));
  return {
    route: routeName,
    overworldId: Number.isSafeInteger(savedOverworldId) ? savedOverworldId : undefined,
  };
}

function routeStateFromHistory(value: unknown): AppHistoryState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = value as Partial<AppHistoryState>;
  if (!isAppRoute(maybe.route)) return undefined;
  return {
    route: maybe.route,
    overworldId: Number.isSafeInteger(maybe.overworldId) ? maybe.overworldId : undefined,
    pokemonSpriteSpeciesId: Number.isSafeInteger(maybe.pokemonSpriteSpeciesId) ? maybe.pokemonSpriteSpeciesId : undefined,
    pokemonSpriteFormIndex: Number.isSafeInteger(maybe.pokemonSpriteFormIndex) ? maybe.pokemonSpriteFormIndex : undefined,
  };
}

function isAppRoute(value: unknown): value is AppRoute {
  return typeof value === "string" && APP_ROUTES.includes(value as AppRoute);
}

function statusText(status: HTMLElement | null | undefined, message: string): void {
  if (status) status.textContent = message;
}

function renderDirtyIndicator(): void {
  const headerStatus = appRoot.querySelector<HTMLElement>("#header-status");
  if (headerStatus) headerStatus.innerHTML = dirty ? `<div class="dirty-indicator">Unsaved browser edits</div>` : "";

  const debugLink = appRoot.querySelector<HTMLAnchorElement>("[data-route='debugNarcs']");
  if (debugLink && project) debugLink.textContent = `Debug (${getCachedRecordCount(project)})`;
}
