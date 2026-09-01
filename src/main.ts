import "./styles.css";
import "./styles/legacyLayout.css";
import "./styles/legacyFields.css";
import "./styles/legacyPokemon.css";
import "./styles/legacyTrainers.css";
import "./styles/legacyTrainerSprites.css";
import "./styles/legacyEncounters.css";
import "./styles/legacyMovesItems.css";
import "./styles/legacyMartsGrottos.css";
import "./styles/legacyText.css";
import "./styles/legacyOverworlds.css";
import "./styles/legacyDocGenerators.css";
import "./styles/legacyMastersheet.css";
import "./styles/legacyMap3d.css";
import "./styles/legacyPokemonSprites.css";
import "./styles/legacyStarters.css";
import "./styles/fileSystem.css";
import "./styles/legacyTypes.css";
import "./styles/codeInjection.css";
import "./styles/legacyPatches.css";
import "./styles/pwanAnimation.css";
import "./styles/moveBackgrounds.css";
import "./styles/battleBackgrounds.css";
import "./styles/headerBattleEnvironments.css";
import "./styles/overworldWeather.css";
import "./styles/randomizer.css";
import "./styles/trainerMusic.css";

import { MANDATORY_NARCS, SELECTABLE_NARCS, isGen4Project, isGen5Project, type NarcName } from "./pokeweb/constants";
import { NARC } from "./nds/narc";
import { NintendoDSRom } from "./nds/rom";
import { generateChangelogFromRomFiles } from "./pokeweb/changelogModel";
import { ensureActionChangelog, renderActionChangelogText, resetActionChangelog } from "./pokeweb/actionChangelog";
import { exportModifiedRom } from "./pokeweb/exportRom";
import { parseHeaders } from "./pokeweb/headerModel";
import { installIntegrationConsoleApi } from "./pokeweb/integrationConsole";
import { canUseLocalRomBridge, pickLocalRomFile, readDevRomFile, readLocalRomFile, readStoredLocalRomPath, rememberLocalRomPath, type LocalRomFile } from "./pokeweb/localRomBridge";
import { loadProjectFromRomBytes, loadProjectFromRomFile } from "./pokeweb/loader";
import { moveEffectHandlerOverlayId } from "./pokeweb/moveEffectHandlerModel";
import { prepareBw2FormEvolutionCodeInjection } from "./pokeweb/pmcModel";
import { clearActiveProject, debounceProjectSave, hasActiveRomBytes, loadActiveProject, loadActiveRomBytes, loadActiveRomMetadata, saveActiveProject } from "./pokeweb/persistence";
import { createNarcStore, getCachedRecordCount, type ProjectState } from "./pokeweb/projectStore";
import { typeChartOverlayId } from "./pokeweb/typeChartModel";
import { openTestBattleEmulator } from "./pokeweb/testBattleEmulatorLauncher";
import { buildMoveTestBattleDownloads, buildTestBattleDownloads } from "./pokeweb/testBattle";
import { renderDebugNarcs } from "./ui/debugNarcs";
import { renderCodeInjectionEditor } from "./ui/codeInjectionEditor";
import { renderFileSystemEditor } from "./ui/fileSystemEditor";
import { renderPatchesEditor } from "./ui/patchesEditor";
import { renderHeaderEditor } from "./ui/headerEditor";
import { renderOverworldWeatherEditor, stopOverworldWeatherEditorPreview } from "./ui/overworldWeatherEditor";
import { renderOverworldWeatherGraphicsEditor, stopOverworldWeatherGraphicsEditor } from "./ui/overworldWeatherGraphicsEditor";
import { renderEncounterEditor } from "./ui/encounterEditor";
import { renderItemEditor, renderMoveAnimationPage, renderMoveEditor } from "./ui/moveItemEditor";
import { renderMoveEffectHandlerEditor } from "./ui/moveEffectHandlerEditor";
import { renderMoveBackgroundEditor } from "./ui/moveBackgroundEditor";
import { renderBattleBackgroundEditor } from "./ui/battleBackgroundEditor";
import { renderPokemonEditor } from "./ui/pokemonEditor";
import { renderPokemonSpriteEditor } from "./ui/pokemonSpriteEditor";
import { renderPwanAnimationEditor } from "./ui/pwanAnimationEditor";
import { getPwanRuntimeStatus } from "./pokeweb/pwanAnimationModel";
import { renderStarterEditor } from "./ui/starterEditor";
import { renderTmEditor } from "./ui/tmEditor";
import { renderTutorMoveEditor } from "./ui/tutorMoveEditor";
import { renderTypeChartEditor } from "./ui/typeChartEditor";
import { renderTrainerEditor } from "./ui/trainerEditor";
import { renderTrainerSpriteEditor, stopTrainerSpriteEditorPlayback } from "./ui/trainerSpriteEditor";
import { renderTrainerMusicEditor, stopTrainerMusicEditorPlayback } from "./ui/trainerMusicEditor";
import { renderBattleFacilityEditor } from "./ui/battleFacilityEditor";
import { renderGrottoEditor, renderGrottoOddsEditor, renderMartEditor } from "./ui/martGrottoEditor";
import { renderTextEditor } from "./ui/textEditor";
import { renderOverworldEditor } from "./ui/overworldEditor";
import { renderDocGenerators } from "./ui/docGenerators";
import { renderMastersheetEditor } from "./ui/mastersheetEditor";
import { renderRandomizerEditor } from "./ui/randomizerEditor";
import { repairReasonLabel, repairRomNarcs, romHeaderRepairReasonLabel, type RomRepairResult } from "./pokeweb/romRepairModel";
import {
  clearChangelogTabs as clearSharedChangelogTabs,
  downloadTextFile as downloadSharedTextFile,
  renderActionChangelogPage,
  renderChangelogTabs as renderSharedChangelogTabs,
} from "./ui/changelogView";
import { escapeHtml } from "./ui/dom";

type AppRoute =
  | "upload"
  | "fileSystem"
  | "codeInjection"
  | "patches"
  | "headers"
  | "weather"
  | "weatherGraphics"
  | "overworlds"
  | "maps3d"
  | "pokemon"
  | "pokemonSprites"
  | "animatedSprites"
  | "starters"
  | "trainers"
  | "trainerMusic"
  | "trainerSprites"
  | "facilities"
  | "wbtFacilities"
  | "encounters"
  | "moves"
  | "moveAnimation"
  | "items"
  | "tms"
  | "tutorMoves"
  | "types"
  | "moveEffectHandlers"
  | "moveBackgrounds"
  | "battleBackgrounds"
  | "randomizer"
  | "marts"
  | "grottos"
  | "grottoOdds"
  | "storyText"
  | "infoText"
  | "docGenerators"
  | "mastersheet"
  | "changelog"
  | "debugNarcs";
type AppHistoryState = {
  route: AppRoute;
  overworldId?: number;
  moveAnimationMoveId?: number;
  pokemonSpriteSpeciesId?: number;
  pokemonSpriteFormIndex?: number;
  trainerSpriteClassId?: number;
  pwanAnimationSpeciesId?: number;
};
type SaveFileHandleLike = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};
type SaveFilePickerOptionsLike = {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};
type RomLoadProgressOverlay = {
  setStage: (message: string) => void;
  setError: (message: string) => void;
  finish: (message?: string) => void;
  close: () => void;
};
const ROUTE_KEY = "pokeweb-serverless-route";
const OVERWORLD_ROUTE_KEY = "pokeweb-serverless-overworld-id";
const MOVE_ANIMATION_ROUTE_KEY = "pokeweb-serverless-move-animation-id";
const PWAN_ANIMATION_ROUTE_KEY = "pokeweb-serverless-pwan-animation-species-id";
const TRAINER_SPRITE_ROUTE_KEY = "pokeweb-serverless-trainer-sprite-class-id";
const HIDE_EXPORT_CHANGELOG_PROMPT_KEY = "pokeweb-hide-export-changelog-prompt";
const CODEX_DEV_MODE = import.meta.env.MODE === "codex-dev";

const ROM_LOAD_STAGE_PROGRESS: Array<[message: string, percent: number]> = [
  ["Starting ROM load", 4],
  ["Reading ROM file", 12],
  ["Decompressing ARM9", 22],
  ["Extracting Gen 4 NARCs", 38],
  ["Extracting header NARCs", 34],
  ["Decoding Gen 4 message banks", 56],
  ["Decoding message banks", 48],
  ["Extracting editor NARCs", 64],
  ["Extracting overlays", 76],
  ["Indexing trainer metadata", 84],
  ["Parsing Gen 4 headers", 90],
  ["Parsing headers", 90],
  ["Parsing TM table", 95],
  ["Saving project in browser storage", 98],
  ["Opening editor", 100],
  ["ROM loaded", 100],
];

const APP_ROUTES: AppRoute[] = [
  "upload",
  "fileSystem",
  "codeInjection",
  "patches",
  "headers",
  "weather",
  "weatherGraphics",
  "overworlds",
  "maps3d",
  "pokemon",
  "pokemonSprites",
  "animatedSprites",
  "starters",
  "trainers",
  "trainerMusic",
  "trainerSprites",
  "facilities",
  "wbtFacilities",
  "encounters",
  "moves",
  "moveAnimation",
  "items",
  "tms",
  "tutorMoves",
  "types",
  "moveEffectHandlers",
  "moveBackgrounds",
  "battleBackgrounds",
  "randomizer",
  "marts",
  "grottos",
  "grottoOdds",
  "storyText",
  "infoText",
  "docGenerators",
  "mastersheet",
  "changelog",
  "debugNarcs",
];

const EDITOR_REQUIREMENTS: Record<
  Exclude<AppRoute, "upload" | "fileSystem" | "codeInjection" | "patches" | "debugNarcs" | "grottoOdds" | "docGenerators" | "mastersheet" | "maps3d" | "changelog" | "tutorMoves">,
  NarcName[]
> = {
  headers: ["headers", "message_texts"],
  weather: ["headers", "message_texts"],
  weatherGraphics: [],
  overworlds: ["headers", "matrix", "maps", "overworlds"],
  pokemon: ["personal", "learnsets", "evolutions", "moves", "items"],
  pokemonSprites: ["personal", "pokemon_sprites", "pokemon_icons"],
  animatedSprites: ["personal", "pokemon_sprites"],
  starters: ["personal", "pokemon_sprites", "starter_sprites", "scripts", "story_texts"],
  trainers: ["trdata", "trpok", "personal", "items", "moves", "trtext_table", "trtext_offsets"],
  trainerMusic: [],
  trainerSprites: ["trdata"],
  facilities: ["moves", "items"],
  wbtFacilities: ["moves", "items"],
  encounters: ["encounters", "personal"],
  moves: ["moves"],
  moveAnimation: ["moves"],
  items: ["items"],
  tms: ["moves"],
  types: [],
  moveEffectHandlers: ["moves"],
  moveBackgrounds: ["move_animations", "battle_animations"],
  battleBackgrounds: [],
  randomizer: [],
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
  area_data: "Area Data",
  map_textures: "Map Textures",
  matrix: "Matrices",
  overworlds: "Overworlds",
  ow_sprites: "Overworld Sprites",
  learnsets: "Learnsets",
  evolutions: "Evolutions",
  egg_moves: "Egg Moves",
  moves: "Moves",
  move_animations: "Move Animations",
  battle_animations: "Battle Animations",
  items: "Items",
  trtext_table: "Trainer Text Table",
  trtext_offsets: "Trainer Text Offsets",
  trdata: "Trainer Data",
  trpok: "Trainer Pokemon",
  trainer_sprites: "Trainer Sprites",
  encounters: "Encounters",
  marts: "Marts",
  mart_counts: "Mart Counts",
  grottos: "Hidden Grottoes",
  habitats: "Dex Habitats",
  tutor_moves: "Tutor Moves",
  type_chart: "Type Chart",
  starter_sprites: "Starter Sprites",
  pokemon_sprites: "Pokemon Sprites",
  pokemon_icons: "Pokemon Icons",
  ingame_trades: "In-game Trades (Scripted Pokemon)",
  subway_sets: "Battle Subway Sets",
  subway_trainers: "Battle Subway Trainers",
  pwt_sets_0: "PWT Sets 0",
  pwt_sets_3: "PWT Sets 3",
  pwt_sets_6: "PWT Sets 6",
  pwt_sets_7: "PWT Sets 7",
  pwt_map_1: "PWT Map 1",
  pwt_map_2: "PWT Map 2",
  pwt_tr1: "PWT 1v1 Choices",
  pwt_tr6: "PWT 6v6 Choices",
  regulations: "Battle Regulations",
  wbt_sets: "Black Tower / White Treehollow Sets",
  wbt_trainers: "Black Tower / White Treehollow Trainers",
  wbt_area_pools: "Black Tower / White Treehollow Area Pools",
};

type NarcLoadSection = {
  title: string;
  names: NarcName[];
  toggleable?: boolean;
};

const NARC_LOAD_SECTIONS: NarcLoadSection[] = [
  { title: "Required", names: [...MANDATORY_NARCS] },
  { title: "Sprites", names: ["pokemon_sprites", "pokemon_icons", "starter_sprites", "ow_sprites"], toggleable: true },
  { title: "Moves", names: ["moves", "tutor_moves", "move_animations", "battle_animations", "move_spas"], toggleable: true },
  { title: "Pokemon", names: ["personal", "learnsets", "evolutions", "egg_moves", "habitats", "ingame_trades"], toggleable: true },
  { title: "Trainers", names: ["trdata", "trpok", "trtext_table", "trtext_offsets", "trainer_sprites"], toggleable: true },
  {
    title: "Battle Facilities",
    names: [
      "subway_sets",
      "subway_trainers",
      "pwt_sets_0",
      "pwt_sets_3",
      "pwt_sets_6",
      "pwt_sets_7",
      "pwt_map_1",
      "pwt_map_2",
      "pwt_tr1",
      "pwt_tr6",
      "regulations",
      "wbt_sets",
      "wbt_trainers",
      "wbt_area_pools",
    ],
    toggleable: true,
  },
  { title: "Maps", names: ["maps", "matrix", "area_data", "map_textures"], toggleable: true },
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
const appRoot = app;
const defaultDocumentTitle = document.title;

let project: ProjectState | undefined;
let route: AppRoute = "upload";
let activeOverworldId: number | undefined;
let activeMoveAnimationMoveId: number | undefined;
let activePokemonSpriteSpeciesId: number | undefined;
let activePokemonSpriteFormIndex = 0;
let activeTrainerSpriteClassId: number | undefined;
let activePwanAnimationSpeciesId: number | undefined;
let dirty = false;
let hasExportBase = false;
let refreshRomRequestInFlight = false;
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
  if (CODEX_DEV_MODE) {
    renderCodexDevBootStatus("Loading clean development ROM...");
    try {
      project = await loadCodexDevProject((message) => renderCodexDevBootStatus(message));
      hasExportBase = true;
    } catch (error) {
      renderCodexDevBootError(error);
      return;
    }
  } else {
    try {
      project = await loadActiveProject();
      hasExportBase = await hasActiveRomBytes();
      if (!project && hasExportBase) project = await restoreProjectFromCachedRom();
    } catch {
      project = await restoreProjectFromCachedRom();
      hasExportBase = Boolean(project);
    }
  }
  if (project) {
    hydrateProject(project);
    hasExportBase = true;
  }
  const initialState = routeStateFromUrl() ?? routeStateFromStorage();
  activeOverworldId = initialState.overworldId;
  activeMoveAnimationMoveId = initialState.moveAnimationMoveId;
  activePokemonSpriteSpeciesId = initialState.pokemonSpriteSpeciesId;
  activePokemonSpriteFormIndex = initialState.pokemonSpriteFormIndex ?? 0;
  activeTrainerSpriteClassId = initialState.trainerSpriteClassId;
  activePwanAnimationSpeciesId = initialState.pwanAnimationSpeciesId;
  route = project ? initialState.route : "upload";
  if (project && route === "upload" && !window.location.hash) route = defaultLoadedRoute();
  route = safeRoute(route);
  syncRouteStorage();
  syncBrowserHistory(true);
  renderApp();
}

async function loadCodexDevProject(onProgress: (message: string) => void): Promise<ProjectState> {
  onProgress("Reading configured development ROM");
  const localRom = await readDevRomFile();
  const loadedProject = await loadProjectFromRomBytes(localRom.bytes, localRom.fileName, {}, onProgress);
  rememberLocalRomPath(localRom.path);
  hydrateProject(loadedProject);
  resetActionChangelog(loadedProject);
  dirty = false;
  onProgress("Saving clean development project");
  await saveActiveProject(loadedProject);
  return loadedProject;
}

function renderCodexDevBootStatus(message: string): void {
  appRoot.innerHTML = `
    <section class="upload-page">
      <div class="upload-panel">
        <h1>Pokeweb Codex Dev</h1>
        <div class="upload-status" role="status">${escapeHtml(message)}</div>
      </div>
    </section>
  `;
}

function renderCodexDevBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  appRoot.innerHTML = `
    <section class="upload-page">
      <div class="upload-panel">
        <h1>Codex dev ROM failed to load</h1>
        <div class="upload-status" role="alert">${escapeHtml(message)}</div>
        <p>Expected a readable ROM at <code>../cleanwhite2.nds</code>. Override it with <code>POKEWEB_DEV_ROM=/absolute/path/to/rom.nds npm run dev:codex</code>.</p>
      </div>
    </section>
  `;
}

async function restoreProjectFromCachedRom(): Promise<ProjectState | undefined> {
  try {
    const bytes = await loadActiveRomBytes();
    if (!bytes) return undefined;
    const metadata = await loadActiveRomMetadata();
    const restored = await loadProjectFromRomBytes(bytes, metadata?.fileName ?? "cached-rom.nds", {
      fairy: metadata?.fairy,
      selectedNarcs: metadata?.selectedNarcs as NarcName[] | undefined,
    });
    resetActionChangelog(restored);
    await saveActiveProject(restored);
    hydrateProject(restored);
    return restored;
  } catch {
    return undefined;
  }
}

window.addEventListener("popstate", (event) => {
  const nextState = routeStateFromHistory(event.state) ?? routeStateFromUrl() ?? routeStateFromStorage();
  applyRouteState(nextState, { fromHistory: true });
});

function renderApp(): void {
  stopTrainerSpriteEditorPlayback();
  stopTrainerMusicEditorPlayback();
  stopOverworldWeatherEditorPreview();
  stopOverworldWeatherGraphicsEditor();
  syncDocumentTitle();
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

  if (route === "weather") {
    renderOverworldWeatherEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "weatherGraphics") {
    content.innerHTML = `<div class="weather-graphics-loading">Loading weather graphics…</div>`;
    void renderOverworldWeatherGraphicsEditor(
      project,
      content,
      () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      () => navigate("weather"),
    ).catch((error) => {
      content.innerHTML = `<div class="weather-graphics-loading -error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    });
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

  if (route === "codeInjection") {
    renderCodeInjectionEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "patches") {
    renderPatchesEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
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
    }).catch((error) => {
      if (route === "maps3d") renderMap3dEditorLoadError(content, error);
    });
    return;
  }

  if (route === "pokemon") {
    renderPokemonEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    }, openPokemonSprites, canOpenPwanFromPokemon() ? openPwanAnimations : undefined, ensurePokemonFormAssets);
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

  if (route === "animatedSprites") {
    renderPwanAnimationEditor(project, content, {
      activeSpeciesId: activePwanAnimationSpeciesId,
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      onRefresh: renderApp,
      onNavigateSpecies: openPwanAnimations,
      onBack: () => navigate("pokemon"),
    });
    return;
  }

  if (route === "starters") {
    renderStarterEditor(project, content, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
    });
    return;
  }

  if (route === "trainers") {
    renderTrainerEditor(
      project,
      content,
      () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      (trainerId, showdownText) => launchTestBattle(trainerId, showdownText),
      openTrainerSprites,
    );
    return;
  }

  if (route === "trainerMusic") {
    void renderTrainerMusicEditor(project, content, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
    });
    return;
  }

  if (route === "trainerSprites") {
    if (activeTrainerSpriteClassId === undefined) {
      navigate("trainers");
      return;
    }
    void renderTrainerSpriteEditor(project, content, activeTrainerSpriteClassId, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
      onBack: () => navigate("trainers"),
      onNavigateClass: openTrainerSprites,
    });
    return;
  }

  if (route === "facilities") {
    renderBattleFacilityEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    }, { group: "subwayPwt" });
    return;
  }

  if (route === "wbtFacilities") {
    renderBattleFacilityEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    }, { group: "wbt" });
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
    }, (moveId, scriptText) => launchMoveTestBattle(moveId, scriptText), openMoveAnimation);
    return;
  }

  if (route === "moveAnimation") {
    renderMoveAnimationPage(project, content, activeMoveAnimationMoveId ?? 0, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    }, (moveId, scriptText) => launchMoveTestBattle(moveId, scriptText), () => navigate("moves"), openMoveAnimation);
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

  if (route === "tutorMoves") {
    renderTutorMoveEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "types") {
    renderTypeChartEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "moveEffectHandlers") {
    renderMoveEffectHandlerEditor(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  if (route === "moveBackgrounds") {
    renderMoveBackgroundEditor(project, content);
    return;
  }

  if (route === "battleBackgrounds") {
    renderBattleBackgroundEditor(project, content);
    return;
  }

  if (route === "randomizer") {
    renderRandomizerEditor(project, content, () => {
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
    renderTextEditor(project, content, "message_texts", "Message Text", () => {
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

  if (route === "mastersheet") {
    renderMastersheetEditor(project, content, {
      onDirty: () => {
        dirty = true;
        scheduleSave(project!);
        renderDirtyIndicator();
      },
    });
    return;
  }

  if (route === "changelog") {
    renderActionChangelogPage(project, content, () => {
      dirty = true;
      scheduleSave(project!);
      renderDirtyIndicator();
    });
    return;
  }

  renderDebugNarcs(project, content, renderDirtyIndicator);
}

function renderMap3dEditorLoadError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `
    <div class="pokemon-filter map3d-sidebar">
      <div class="filter-title">Maps 3D</div>
      <div class="map3d-load-error">
        <strong>Map viewer update required</strong>
        <p>Pokeweb was updated while this tab was open. Refresh to load the current map editor files.</p>
        <code>${escapeHtml(message)}</code>
        <button class="btn -default" id="map3d-refresh-app" type="button">Refresh Pokeweb</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#map3d-refresh-app")?.addEventListener("click", async () => {
    const button = root.querySelector<HTMLButtonElement>("#map3d-refresh-app");
    if (button) {
      button.disabled = true;
      button.textContent = "Refreshing...";
    }
    if (project) await saveActiveProject(project);
    window.location.reload();
  });
}

function renderNav(): string {
  if (!project) return `<div id="header"></div>`;
  return `
    <div id="header">
      <div class="header-left">
        ${navItem("headers", "Headers & Overworlds")}
        ${navItem("maps3d", "Maps")}
        ${project.session.baseRom === "BW2" ? renderWeatherMenu() : ""}
        ${navItem("pokemon", "Pokemon")}
        ${renderTrainersMenu()}
        ${renderEncountersMenu()}
        ${renderMovesMenu()}
        ${renderItemsMenu()}
        ${renderTextsMenu()}
        ${renderMoreMenu()}
      </div>
      <div class="header-status" id="header-status">${dirty ? renderDirtyIndicatorLink() : ""}</div>
      <div class="header-right">
        ${navItem("docGenerators", "Doc Generators")}
        ${navItem("mastersheet", "Mastersheet")}
        ${renderRefreshRomButton()}
        <a class="header-item ${hasExportBase ? "" : "disabled"}" href="#" data-export-rom="true" ${
          hasExportBase ? "" : `title="Reload the ROM before exporting this older saved project"`
        }>Export</a>
        <a class="header-item" href="#" data-route="upload">New</a>
      </div>
    </div>
  `;
}

function renderRefreshRomButton(): string {
  if (!canUseLocalRomBridge()) return "";
  const hasPath = Boolean(readStoredLocalRomPath());
  return `<button class="header-item ${hasPath ? "" : "disabled"}" type="button" data-refresh-rom="true" title="${hasPath ? "Reload this ROM from its local file path" : "Open a ROM with Open Local ROM first"}">Refresh ROM</button>`;
}

function renderMoreMenu(): string {
  const moreRoutes: Array<[Exclude<AppRoute, "upload" | "debugNarcs" | "grottoOdds" | "pokemonSprites">, string]> = [
    ["randomizer", "Randomizer"],
    ["starters", "Scripted PKMN"],
    ["types", "Type Chart"],
    ["battleBackgrounds", "Battle Backgrounds"],
    ["changelog", "Changelog"],
    ["patches", "Patches"],
    ["codeInjection", "Code Injection"],
    ["fileSystem", "File System"],
  ];
  const active = moreRoutes.some(([moreRoute]) => route === moreRoute);
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">More</button>
      <div class="header-more-menu">
        ${moreRoutes.map(([moreRoute, label]) => navItem(moreRoute, label)).join("")}
      </div>
    </div>
  `;
}

function renderTrainersMenu(): string {
  const trainerRoutes: Array<[Exclude<AppRoute, "upload" | "debugNarcs" | "grottoOdds" | "pokemonSprites">, string]> = project && !isGen4Project(project)
    ? [
      ["facilities", "Subway / PWT"],
      ["wbtFacilities", "Black Tower / White Treehollow"],
      ["trainerMusic", "Trainer Music"],
    ]
    : [];
  const active = route === "trainers" || trainerRoutes.some(([trainerRoute]) => route === trainerRoute);
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">Trainers</button>
      <div class="header-more-menu">
        ${navItem("trainers", "Main Trainers")}
        ${trainerRoutes.map(([trainerRoute, label]) => navItem(trainerRoute, label)).join("")}
      </div>
    </div>
  `;
}

function renderWeatherMenu(): string {
  const active = route === "weather" || route === "weatherGraphics";
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">Weather</button>
      <div class="header-more-menu">
        ${navItem("weather", "Area Assignments")}
        ${navItem("weatherGraphics", "Graphics Editor")}
      </div>
    </div>
  `;
}

function renderEncountersMenu(): string {
  const grottoAvailable = project?.session.baseRom === "BW2";
  const active = route === "encounters" || (grottoAvailable && route === "grottos");
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">Encounters</button>
      <div class="header-more-menu">
        ${navItem("encounters", "Wild Encounters")}
        ${grottoAvailable ? navItem("grottos", "Hidden Grottos") : ""}
      </div>
    </div>
  `;
}

function renderItemsMenu(): string {
  const martsAvailable = project?.session.baseRom === "BW2";
  const active = route === "items" || (martsAvailable && route === "marts");
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">Items</button>
      <div class="header-more-menu">
        ${navItem("items", "Item Data")}
        ${martsAvailable ? navItem("marts", "Marts") : ""}
      </div>
    </div>
  `;
}

function renderMovesMenu(): string {
  const active = route === "moves" || route === "moveAnimation" || route === "tms"
    || route === "tutorMoves" || route === "moveEffectHandlers" || route === "moveBackgrounds";
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">Moves</button>
      <div class="header-more-menu">
        ${navItem("moves", "Move Data")}
        ${navItem("tms", "TMs")}
        ${navItem("tutorMoves", "Tutor Data")}
        ${navItem("moveEffectHandlers", "Move Effect Handlers")}
        ${navItem("moveBackgrounds", "Move Backgrounds")}
      </div>
    </div>
  `;
}

function renderTextsMenu(): string {
  const storyAvailable = project ? !isGen4Project(project) : false;
  const active = (storyAvailable && route === "storyText") || route === "infoText";
  return `
    <div class="header-more ${active ? "-active" : ""}">
      <button class="header-item header-more-trigger ${active ? "-active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">Texts</button>
      <div class="header-more-menu">
        ${storyAvailable ? navItem("storyText", "Story Text") : ""}
        ${navItem("infoText", "Message Text")}
      </div>
    </div>
  `;
}

function attachNav(): void {
  appRoot.querySelectorAll<HTMLAnchorElement>("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const nextRoute = link.dataset.route as AppRoute;
      if (nextRoute === "upload") {
        void handleNewProjectClick();
        return;
      }
      navigate(nextRoute);
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>(".header-more-trigger").forEach((trigger) => trigger.addEventListener("click", (event) => {
    event.preventDefault();
    const menu = (event.currentTarget as HTMLElement).closest(".header-more");
    menu?.classList.toggle("-open");
  }));

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

  appRoot.querySelector<HTMLButtonElement>("[data-refresh-rom]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement;
    if (refreshRomRequestInFlight) return;
    refreshRomRequestInFlight = true;
    button.disabled = true;
    try {
      await refreshRomFromLocalPath(button);
    } finally {
      // Keep the guard through the next paints so click events queued behind a
      // native confirm dialog cannot immediately start another refresh request.
      await waitForNextPaint();
      refreshRomRequestInFlight = false;
      button.disabled = false;
    }
  });
}

async function handleNewProjectClick(): Promise<void> {
  if (!project) {
    navigate("upload");
    return;
  }
  if (hasAnyRomChanges(project)) {
    const confirmed = window.confirm(
      "Start a new ROM project?\n\nThis will wipe all saved Pokeweb data for the current ROM from this browser. Export the edited ROM first if you have not already saved your changes.",
    );
    if (!confirmed) return;
  }
  applyRouteState({ route: "upload" }, { clearProject: true });
}

async function refreshRomFromLocalPath(button: HTMLButtonElement): Promise<void> {
  if (!project) return;
  const romPath = readStoredLocalRomPath();
  if (!romPath) {
    window.alert("No local ROM path is saved yet.\n\nUse Open Local ROM from the upload screen once, then Refresh ROM can reload that file after rebuilds.");
    return;
  }
  if (hasAnyRomChanges(project)) {
    const confirmed = window.confirm(
      "Refresh ROM from disk?\n\nThis reloads the current ROM file and discards unsynced browser edits. Sync or export anything you need before continuing.",
    );
    if (!confirmed) return;
  }

  const previousState = currentHistoryState();
  const previousText = button.textContent ?? "Refresh ROM";
  const previousProject = project;
  const selectedNarcs = loadedNarcNames(previousProject);
  const fairy = previousProject.session.fairy;
  button.disabled = true;
  button.textContent = "Refreshing...";
  const progressOverlay = showRomLoadProgressOverlay(romPath.split(/[\\/]/u).pop() ?? "local ROM");
  const updateProgress = (message: string) => progressOverlay.setStage(message);
  try {
    updateProgress("Reading ROM file");
    const localRom = await readLocalRomFile(romPath);
    await waitForNextPaint();
    project = await loadProjectFromRomBytes(localRom.bytes, localRom.fileName, { fairy, selectedNarcs }, updateProgress);
    rememberLocalRomPath(localRom.path);
    hydrateProject(project);
    resetActionChangelog(project);
    dirty = false;
    hasExportBase = true;
    updateProgress("Saving project in browser storage");
    await waitForNextPaint();
    await saveActiveProject(project);
    progressOverlay.finish("ROM refreshed");
    const nextRoute = previousState.route === "upload" ? defaultLoadedRoute() : safeRoute(previousState.route);
    applyRouteState({ ...previousState, route: nextRoute }, { replace: true });
    progressOverlay.close();
  } catch (error) {
    progressOverlay.setError(errorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

async function downloadRom(): Promise<void> {
  if (!project) return;
  const link = appRoot.querySelector<HTMLAnchorElement>("[data-export-rom]");
  const previousText = link?.textContent ?? "Export";
  const filename = `${project.session.romName || "pokeweb"}-modified.nds`;
  let saveStarted = false;
  try {
    if (link) {
      link.textContent = "Building...";
      link.classList.add("disabled");
    }
    const bytes = await exportModifiedRom(project);
    if (bytes.length === 0) throw new Error("Export produced an empty ROM. No file was written.");
    const blob = bytesBlob(bytes, "application/octet-stream");
    await saveActiveProject(project);
    const saveHandle = await chooseRomSaveTargetForPreparedDownload(filename);
    if (saveHandle === null) return;
    saveStarted = true;
    let successMessage: string;
    if (saveHandle) {
      await writeBlobToSaveHandle(saveHandle, blob);
      successMessage = `ROM saved successfully:\n\n${filename}`;
    } else {
      downloadBlob(blob, filename);
      successMessage = `ROM export started:\n\n${filename}`;
    }
    await maybeOfferChangelogExport(filename);
    window.alert(successMessage);
    dirty = false;
    renderDirtyIndicator();
  } catch (error) {
    const message = saveStarted ? "Saving the exported ROM failed." : "Export failed. No ROM file was saved.";
    window.alert(`${message}\n\n${errorMessage(error)}`);
  } finally {
    if (link) {
      link.textContent = previousText;
      link.classList.toggle("disabled", !hasExportBase);
    }
  }
}

async function maybeOfferChangelogExport(romFilename: string): Promise<void> {
  if (!project) return;
  if (window.localStorage.getItem(HIDE_EXPORT_CHANGELOG_PROMPT_KEY) === "true") return;
  const state = ensureActionChangelog(project);
  if (state.entries.length === 0) return;
  const shouldExport = await showExportChangelogPrompt();
  if (!shouldExport) return;
  const baseName = romFilename.replace(/\.[^.]+$/u, "");
  downloadSharedTextFile(`${baseName}-changelog.txt`, renderActionChangelogText(project));
}

function showExportChangelogPrompt(): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("div");
    dialog.className = "export-changelog-dialog";
    dialog.innerHTML = `
      <div class="export-changelog-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="export-changelog-title">
        <h2 id="export-changelog-title">Export changelog?</h2>
        <p>Your edited ROM export is ready. You can also download a text changelog for this editing session.</p>
        <label class="export-changelog-dialog__option">
          <input id="hide-export-changelog-prompt" type="checkbox">
          <span>Do not ask on future ROM exports</span>
        </label>
        <div class="export-changelog-dialog__actions">
          <button class="btn -default" id="skip-changelog-export" type="button">Skip</button>
          <button class="btn -default" id="confirm-changelog-export" type="button">Export Changelog</button>
        </div>
      </div>
    `;

    const finish = (exportChangelog: boolean) => {
      const hide = dialog.querySelector<HTMLInputElement>("#hide-export-changelog-prompt")?.checked ?? false;
      if (hide) window.localStorage.setItem(HIDE_EXPORT_CHANGELOG_PROMPT_KEY, "true");
      dialog.remove();
      resolve(exportChangelog);
    };

    dialog.querySelector<HTMLButtonElement>("#confirm-changelog-export")?.addEventListener("click", () => finish(true));
    dialog.querySelector<HTMLButtonElement>("#skip-changelog-export")?.addEventListener("click", () => finish(false));
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
    });
    document.body.append(dialog);
    dialog.querySelector<HTMLButtonElement>("#confirm-changelog-export")?.focus();
  });
}

async function launchTestBattle(trainerId: number, showdownText = ""): Promise<void> {
  if (!project) return;
  if (!hasExportBase) throw new Error("This saved project does not include the original ROM bytes. Please load the ROM again before exporting.");

  const emulator = openTestBattleEmulator();
  const baseName = project.session.romName || "pokeweb";
  try {
    await saveActiveProject(project);
    const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId, { playerTeamText: showdownText });
    await emulator.launch({
      romName: `${baseName}-test-battle-trainer-${trainerId}.nds`,
      saveName: `${baseName}-test-battle-trainer-${trainerId}.sav`,
      trainerId,
      opponentTrainerId: trainerId,
      pokemonNames: project.texts.banks.pokedex?.slice() ?? [],
      testLabel: `trainer ${trainerId} test battle`,
      romBytes,
      saveBytes,
    });
  } catch (error) {
    emulator.close();
    throw error;
  }
}

async function launchMoveTestBattle(moveId: number, scriptText: string): Promise<void> {
  if (!project) return;
  if (!hasExportBase) throw new Error("This saved project does not include the original ROM bytes. Please load the ROM again before exporting.");

  const emulator = openTestBattleEmulator();
  const baseName = project.session.romName || "pokeweb";
  try {
    await saveActiveProject(project);
    const { romBytes, saveBytes } = await buildMoveTestBattleDownloads(project, moveId, { moveAnimationScriptText: scriptText });
    await emulator.launch({
      romName: `${baseName}-test-move-${moveId}.nds`,
      saveName: `${baseName}-test-move-${moveId}.dsv`,
      trainerId: moveId,
      pokemonNames: project.texts.banks.pokedex?.slice() ?? [],
      testLabel: `move ${moveId} test battle`,
      romBytes,
      saveBytes,
    });
  } catch (error) {
    emulator.close();
    throw error;
  }
}

async function chooseRomSaveTarget(filename: string): Promise<SaveFileHandleLike | undefined | null> {
  const picker = (window as Window & { showSaveFilePicker?: (options: SaveFilePickerOptionsLike) => Promise<SaveFileHandleLike> }).showSaveFilePicker;
  if (!picker) return undefined;
  try {
    return await picker({
      suggestedName: filename,
      types: [
        {
          description: "Nintendo DS ROM",
          accept: { "application/octet-stream": [".nds"] },
        },
      ],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

async function chooseRomSaveTargetForPreparedDownload(filename: string): Promise<SaveFileHandleLike | undefined | null> {
  try {
    return await chooseRomSaveTarget(filename);
  } catch (error) {
    console.warn("Save file picker failed after building the ROM; falling back to browser download.", error);
    window.alert(`The system save dialog failed, so Pokeweb will use the browser download flow instead.\n\n${errorMessage(error)}`);
    return undefined;
  }
}

async function writeBlobToSaveHandle(handle: SaveFileHandleLike, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bytesBlob(bytes: Uint8Array, type: string): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function navigate(nextRoute: AppRoute): void {
  applyRouteState({ route: nextRoute, overworldId: activeOverworldId }, { clearProject: nextRoute === "upload" });
}

function openOverworld(overworldId: number): void {
  if (!canVisit("overworlds")) return;
  applyRouteState({ route: "overworlds", overworldId });
}

function openMoveAnimation(moveId: number): void {
  if (!canVisit("moveAnimation")) return;
  applyRouteState({ route: "moveAnimation", moveAnimationMoveId: moveId });
}

function openPokemonSprites(speciesId: number, formIndex = 0): void {
  void openPokemonSpritesAsync(speciesId, formIndex);
}

function openTrainerSprites(trainerClassId: number): void {
  if (!canVisit("trainerSprites")) return;
  applyRouteState({ route: "trainerSprites", trainerSpriteClassId: trainerClassId });
}

function openPwanAnimations(speciesId: number): void {
  void openPwanAnimationsAsync(speciesId);
}

function canOpenPwanFromPokemon(): boolean {
  if (!project || !project.narcs.personal) return false;
  const status = getPwanRuntimeStatus(project);
  return status.supported && status.installed;
}

async function openPwanAnimationsAsync(speciesId: number): Promise<void> {
  if (!project || !canOpenPwanFromPokemon()) return;
  try {
    await ensurePokemonSpriteNarcs();
    applyRouteState({ route: "animatedSprites", pwanAnimationSpeciesId: speciesId });
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
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

async function ensurePokemonFormAssets(): Promise<void> {
  if (!project) return;
  await ensurePokemonSpriteNarcs();
  if (project.session.baseRom === "BW2") await prepareBw2FormEvolutionCodeInjection(project);
}

function renderUpload(root: HTMLElement): void {
  const mandatoryNarcs = new Set<NarcName>(MANDATORY_NARCS);
  const sectionedNarcs = new Set<NarcName>(NARC_LOAD_SECTIONS.flatMap((section) => section.names));
  const otherNarcs = SELECTABLE_NARCS.map((definition) => definition.name).filter((name) => !sectionedNarcs.has(name));
  const narcSections = [...NARC_LOAD_SECTIONS, { title: "Other", names: otherNarcs }];
  root.innerHTML = `
    <section class="upload-page">
      <div class="home-panels">
        <div class="upload-panel">
          <h1>Pokeweb</h1>
          <label class="upload-dropzone">
            <span>Upload .nds ROM</span>
            <input id="rom-input" type="file" accept=".nds" />
          </label>
          ${canUseLocalRomBridge() ? `<button class="btn -default local-rom-open-btn" id="local-rom-open-btn" type="button">Open Local ROM...</button>` : ""}
          <label class="upload-options">
            <input id="fairy-input" type="checkbox" />
            <span>Fairy ROM offsets</span>
          </label>
          <div class="narc-picker">
            <div class="narc-picker__header">
              <div>
                <h2>NARCs to Load</h2>
              </div>
              <button class="btn -default" id="minimal-narcs-btn" type="button">Core Only</button>
            </div>
            <div class="narc-picker__sections">
              ${narcSections.map((section) => renderNarcLoadSection(section, mandatoryNarcs)).join("")}
            </div>
          </div>
          <div class="upload-status" id="status"></div>
        </div>
        <div class="home-side-panels">
          <div class="upload-panel repair-tool">
            <div class="changelog-generator__header">
              <div>
                <h2>ROM Repair</h2>
              </div>
            </div>
            <label class="changelog-file">
              <span>ROM</span>
              <input id="repair-rom-input" type="file" accept=".nds" />
            </label>
            <div class="changelog-actions repair-actions">
              <button class="btn -default" id="repair-rom-btn" type="button" disabled>Download Repaired ROM</button>
            </div>
            <div class="upload-status" id="repair-status"></div>
          </div>
          <div class="upload-panel changelog-generator">
            <div class="changelog-generator__header">
              <div>
                <h2>Changelog Generator</h2>
              </div>
            </div>
            <div class="changelog-generator__inputs">
              <label class="changelog-file">
                <span>Original ROM</span>
                <input id="changelog-before-input" type="file" accept=".nds" />
              </label>
              <label class="changelog-file">
                <span>Modified ROM</span>
                <input id="changelog-after-input" type="file" accept=".nds" />
              </label>
            </div>
            <label class="upload-options changelog-option">
              <input id="changelog-fairy-input" type="checkbox" />
              <span>Fairy ROM offsets</span>
            </label>
            <div class="changelog-actions">
              <button class="btn -default" id="generate-changelog-btn" type="button">Generate Changelog</button>
              <button class="btn -default" id="copy-changelog-btn" type="button" disabled>Copy</button>
              <button class="btn -default" id="download-changelog-btn" type="button" disabled>Download TXT</button>
            </div>
            <div class="upload-status" id="changelog-status"></div>
            <textarea id="changelog-output" class="changelog-output" readonly></textarea>
            <div id="changelog-tabs" class="changelog-tabs"></div>
          </div>
        </div>
      </div>
    </section>
  `;

  const input = root.querySelector<HTMLInputElement>("#rom-input");
  const localRomButton = root.querySelector<HTMLButtonElement>("#local-rom-open-btn");
  const fairyInput = root.querySelector<HTMLInputElement>("#fairy-input");
  const repairInput = root.querySelector<HTMLInputElement>("#repair-rom-input");
  const repairButton = root.querySelector<HTMLButtonElement>("#repair-rom-btn");
  const repairStatus = root.querySelector<HTMLDivElement>("#repair-status");
  const changelogBeforeInput = root.querySelector<HTMLInputElement>("#changelog-before-input");
  const changelogAfterInput = root.querySelector<HTMLInputElement>("#changelog-after-input");
  const changelogFairyInput = root.querySelector<HTMLInputElement>("#changelog-fairy-input");
  const generateChangelogButton = root.querySelector<HTMLButtonElement>("#generate-changelog-btn");
  const copyChangelogButton = root.querySelector<HTMLButtonElement>("#copy-changelog-btn");
  const downloadChangelogButton = root.querySelector<HTMLButtonElement>("#download-changelog-btn");
  const changelogOutput = root.querySelector<HTMLTextAreaElement>("#changelog-output");
  const changelogStatus = root.querySelector<HTMLDivElement>("#changelog-status");
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

  repairInput?.addEventListener("change", () => {
    if (repairButton) repairButton.disabled = !repairInput.files?.[0];
    statusText(repairStatus, "");
  });

  repairButton?.addEventListener("click", async () => {
    const file = repairInput?.files?.[0];
    if (!file) {
      statusText(repairStatus, "Please choose a ROM file.");
      return;
    }

    try {
      repairButton.disabled = true;
      statusText(repairStatus, "Reading ROM file");
      const bytes = new Uint8Array(await file.arrayBuffer());
      statusText(repairStatus, "Scanning NARCs");
      const result = repairRomNarcs(bytes, (message) => statusText(repairStatus, message));
      const filename = repairedRomFilename(file.name);
      downloadBlob(bytesBlob(result.bytes, "application/octet-stream"), filename);
      statusText(repairStatus, repairSummaryText(result));
    } catch (error) {
      statusText(repairStatus, error instanceof Error ? error.message : String(error));
    } finally {
      if (repairButton) repairButton.disabled = !repairInput?.files?.[0];
    }
  });

  localRomButton?.addEventListener("click", async () => {
    const previousText = localRomButton.textContent ?? "Open Local ROM...";
    try {
      localRomButton.disabled = true;
      localRomButton.textContent = "Opening...";
      statusText(status, "Opening local ROM picker");
      const localRom = await pickLocalRomFile();
      if (!localRom) {
        statusText(status, "Local ROM selection cancelled.");
        return;
      }
      await loadLocalRomIntoEditor(localRom, root, status, fairyInput, input, localRomButton);
    } catch (error) {
      statusText(status, error instanceof Error ? error.message : String(error));
    } finally {
      localRomButton.disabled = false;
      localRomButton.textContent = previousText;
    }
  });

  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const progressOverlay = showRomLoadProgressOverlay(file.name);
    const updateUploadStatus = (message: string) => {
      statusText(status, message);
      progressOverlay.setStage(message);
    };
    try {
      input.disabled = true;
      if (fairyInput) fairyInput.disabled = true;
      updateUploadStatus("Starting ROM load");
      await waitForNextPaint();
      const selectedNarcs = getSelectedNarcs(root);
      project = await loadProjectFromRomFile(file, { fairy: fairyInput?.checked ?? false, selectedNarcs }, updateUploadStatus);
      resetActionChangelog(project);
      dirty = false;
      updateUploadStatus("Saving project in browser storage");
      await waitForNextPaint();
      await saveActiveProject(project);
      rememberLocalRomPath("");
      hasExportBase = true;
      updateUploadStatus("Opening editor");
      progressOverlay.finish("ROM loaded");
      applyRouteState({ route: defaultLoadedRoute() });
      progressOverlay.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusText(status, message);
      progressOverlay.setError(message);
    } finally {
      input.disabled = false;
      if (fairyInput) fairyInput.disabled = false;
      input.value = "";
    }
  });

  generateChangelogButton?.addEventListener("click", async () => {
    const beforeFile = changelogBeforeInput?.files?.[0];
    const afterFile = changelogAfterInput?.files?.[0];
    if (!beforeFile || !afterFile) {
      statusText(changelogStatus, "Please choose both ROM files.");
      return;
    }

    try {
      project = undefined;
      dirty = false;
      hasExportBase = false;
      await clearActiveProject();
      renderDirtyIndicator();
      setChangelogBusy(root, true);
      if (changelogOutput) changelogOutput.value = "";
      clearSharedChangelogTabs(root);
      statusText(changelogStatus, "Cleared active editor session");
      const result = await generateChangelogFromRomFiles(
        beforeFile,
        afterFile,
        { fairy: changelogFairyInput?.checked ?? false },
        (message) => statusText(changelogStatus, message),
      );
      if (changelogOutput) changelogOutput.value = result.text;
      renderSharedChangelogTabs(root, result.entries);
      if (copyChangelogButton) copyChangelogButton.disabled = result.text.length === 0;
      if (downloadChangelogButton) downloadChangelogButton.disabled = result.text.length === 0;
      statusText(changelogStatus, `Generated ${result.summary.totalChanges} changes.`);
    } catch (error) {
      statusText(changelogStatus, error instanceof Error ? error.message : String(error));
    } finally {
      setChangelogBusy(root, false);
      if (changelogBeforeInput) changelogBeforeInput.value = "";
      if (changelogAfterInput) changelogAfterInput.value = "";
    }
  });

  copyChangelogButton?.addEventListener("click", async () => {
    const text = changelogOutput?.value ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      statusText(changelogStatus, "Copied changelog text.");
    } catch {
      changelogOutput?.select();
      document.execCommand("copy");
      statusText(changelogStatus, "Copied changelog text.");
    }
  });

  downloadChangelogButton?.addEventListener("click", () => {
    const text = changelogOutput?.value ?? "";
    if (!text) return;
    downloadSharedTextFile("pokeweb-changelog.txt", text);
    statusText(changelogStatus, "Downloaded changelog text.");
  });
}

async function loadLocalRomIntoEditor(
  localRom: LocalRomFile,
  root: HTMLElement,
  status: HTMLElement | null | undefined,
  fairyInput: HTMLInputElement | null,
  fileInput: HTMLInputElement | null,
  localRomButton: HTMLButtonElement,
): Promise<void> {
  const progressOverlay = showRomLoadProgressOverlay(localRom.fileName);
  const updateUploadStatus = (message: string) => {
    statusText(status, message);
    progressOverlay.setStage(message);
  };
  try {
    fileInput?.setAttribute("disabled", "true");
    if (fairyInput) fairyInput.disabled = true;
    localRomButton.disabled = true;
    updateUploadStatus("Starting ROM load");
    await waitForNextPaint();
    const selectedNarcs = getSelectedNarcs(root);
    project = await loadProjectFromRomBytes(localRom.bytes, localRom.fileName, { fairy: fairyInput?.checked ?? false, selectedNarcs }, updateUploadStatus);
    rememberLocalRomPath(localRom.path);
    hydrateProject(project);
    resetActionChangelog(project);
    dirty = false;
    updateUploadStatus("Saving project in browser storage");
    await waitForNextPaint();
    await saveActiveProject(project);
    hasExportBase = true;
    updateUploadStatus("Opening editor");
    progressOverlay.finish("ROM loaded");
    applyRouteState({ route: defaultLoadedRoute() });
    progressOverlay.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusText(status, message);
    progressOverlay.setError(message);
  } finally {
    fileInput?.removeAttribute("disabled");
    if (fairyInput) fairyInput.disabled = false;
    localRomButton.disabled = false;
  }
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
  ensureActionChangelog(nextProject);
  nextProject.fileSystem ??= { replacements: {} };
  nextProject.fileSystem.replacements ??= {};
  nextProject.fileSystem.additions ??= {};
  nextProject.pwanAnimations ??= { overrides: [] };
  nextProject.pwanAnimations.dirty ??= false;
  nextProject.pwanAnimations.overrides ??= [];
  nextProject.pwanAnimations.nativeCarrierBackups ??= {};
  nextProject.patches ??= { dirtyOverlayIds: [], applied: {} };
  nextProject.patches.dirtyOverlayIds ??= [];
  nextProject.patches.applied ??= {};
  if (nextProject.narcs.headers && !nextProject.headers) nextProject.headers = parseHeaders(nextProject);
  nextProject.docs ??= {
    romTitle: nextProject.session.romName,
    mastersheetMarkdown: `# ${nextProject.session.romName}\n\n`,
    trainerLocations: {},
    trainerDiffs: {},
    itemLocations: {},
    groundItemScriptMap: {},
  };
  nextProject.docs.romTitle ||= nextProject.session.romName;
  nextProject.docs.mastersheetMarkdown ??= `# ${nextProject.docs.romTitle || nextProject.session.romName}\n\n`;
  nextProject.docs.trainerLocations ??= {};
  nextProject.docs.trainerDiffs ??= {};
  nextProject.docs.itemLocations ??= {};
  nextProject.docs.groundItemScriptMap ??= {};
}

function syncDocumentTitle(currentProject: ProjectState | undefined = project): void {
  document.title = currentProject?.session.romName ? `Pokeweb - ${currentProject.session.romName}` : defaultDocumentTitle;
}

function repairedRomFilename(fileName: string): string {
  const baseName = fileName.replace(/\.nds$/iu, "") || "rom";
  return `${baseName}-repaired.nds`;
}

function repairSummaryText(result: RomRepairResult): string {
  const headerLine = result.headerRepair
    ? `Repaired ROM structure: ${result.headerRepair.reasons.map(romHeaderRepairReasonLabel).join(", ")}.`
    : "";
  if (result.repairedNarcs === 0) {
    return [`Scanned ${result.scannedNarcs} NARCs.`, headerLine || "No repairs were needed."].filter(Boolean).join(" ");
  }

  const shownEntries = result.entries.slice(0, 8).map((entry) => {
    const label = entry.path ?? `file ${entry.fileId}`;
    const reasons = entry.reasons.map(repairReasonLabel).join(", ");
    return `${label}: ${reasons}`;
  });
  const remaining = result.entries.length > shownEntries.length ? `\n...and ${result.entries.length - shownEntries.length} more.` : "";
  return [`Scanned ${result.scannedNarcs} NARCs. Repaired ${result.repairedNarcs}.`, headerLine, shownEntries.join("\n") + remaining].filter(Boolean).join("\n");
}

function getSelectedNarcs(root: HTMLElement): NarcName[] {
  const selected = new Set<NarcName>(MANDATORY_NARCS);
  root.querySelectorAll<HTMLInputElement>(".narc-input:checked").forEach((checkbox) => selected.add(checkbox.value as NarcName));
  if (selected.has("encounters")) selected.add("personal");
  return [...selected];
}

function loadedNarcNames(currentProject: ProjectState): NarcName[] {
  return Object.keys(currentProject.narcs).filter((name) => Boolean(currentProject.narcs[name as NarcName])) as NarcName[];
}

function hasAnyRomChanges(currentProject: ProjectState): boolean {
  if (dirty || currentProject.arm9Dirty || currentProject.tms?.dirty) return true;
  if ((currentProject.actionChangelog?.entries.length ?? 0) > 0) return true;
  if (Object.values(currentProject.narcs).some((store) => (store?.dirty.size ?? 0) > 0)) return true;
  if (currentProject.fileSystem && (Object.keys(currentProject.fileSystem.replacements).length > 0 || Object.keys(currentProject.fileSystem.additions ?? {}).length > 0)) return true;
  if (currentProject.pwanAnimations?.dirty || currentProject.pwanAnimations?.runtimeInstalled) return true;
  if ((currentProject.starters?.dirtyOverlayIds.length ?? 0) > 0) return true;
  if ((currentProject.patches?.dirtyOverlayIds.length ?? 0) > 0) return true;
  return false;
}

function canVisit(nextRoute: Exclude<AppRoute, "upload" | "debugNarcs" | "grottoOdds">): boolean {
  if (!project) return false;
  if (nextRoute === "changelog") return true;
  if (nextRoute === "trainerMusic") return isGen5Project(project);
  if (nextRoute === "docGenerators") return true;
  if (nextRoute === "mastersheet") {
    return (project.session.baseRom === "BW" || project.session.baseRom === "BW2") && mastersheetRequirements().every((name) => project?.narcs[name]);
  }
  if (nextRoute === "fileSystem") return hasExportBase;
  if (nextRoute === "codeInjection") return hasExportBase && (project.session.baseRom === "BW" || project.session.baseRom === "BW2");
  if (nextRoute === "patches") return hasExportBase && (project.session.baseRom === "BW" || project.session.baseRom === "BW2");
  if (nextRoute === "maps3d") return Boolean(project.headers && hasExportBase);
  if (nextRoute === "weather") return project.session.baseRom === "BW2" && EDITOR_REQUIREMENTS.weather.every((name) => project?.narcs[name]);
  if (nextRoute === "weatherGraphics") return project.session.baseRom === "BW2" && hasExportBase;
  if (nextRoute === "trainerSprites") return (project.session.baseRom === "BW" || project.session.baseRom === "BW2") && Boolean(project.narcs.trdata);
  if (nextRoute === "animatedSprites") {
    const status = getPwanRuntimeStatus(project);
    return Boolean(project.narcs.personal) && status.supported && status.installed;
  }
  if (nextRoute === "types") {
    return (project.session.baseRom === "BW" || project.session.baseRom === "BW2") && Boolean(project.narcs.type_chart || project.overlays[typeChartOverlayId(project)]);
  }
  if (nextRoute === "tutorMoves") return project.session.baseRom === "BW2" && Boolean(project.narcs.tutor_moves || project.overlays[36]);
  if (nextRoute === "moveEffectHandlers") {
    return (
      (project.session.baseRom === "BW" || project.session.baseRom === "BW2") &&
      Boolean(project.narcs.moves) &&
      Boolean(project.narcs.move_effects_table || project.overlays[moveEffectHandlerOverlayId(project)])
    );
  }
  if (nextRoute === "facilities" && project.session.baseRom !== "BW2") return false;
  if (nextRoute === "facilities") {
    const hasFacilityData = Boolean(project.narcs.subway_sets || project.narcs.pwt_sets_0 || project.narcs.pwt_sets_3 || project.narcs.pwt_sets_6 || project.narcs.pwt_sets_7);
    return (
      Boolean(project.narcs.regulations) ||
      (EDITOR_REQUIREMENTS.facilities.every((name) => project?.narcs[name]) && hasFacilityData)
    );
  }
  if (nextRoute === "wbtFacilities" && project.session.baseRom !== "BW2") return false;
  if (nextRoute === "wbtFacilities") {
    return EDITOR_REQUIREMENTS.wbtFacilities.every((name) => project?.narcs[name]) && Boolean(project.narcs.wbt_sets || project.narcs.wbt_trainers || project.narcs.wbt_area_pools);
  }
  if ((nextRoute === "marts" || nextRoute === "grottos") && project.session.baseRom !== "BW2") return false;
  const editorRoute = nextRoute as Exclude<AppRoute, "upload" | "fileSystem" | "codeInjection" | "patches" | "debugNarcs" | "grottoOdds" | "docGenerators" | "mastersheet" | "maps3d" | "changelog" | "tutorMoves">;
  return EDITOR_REQUIREMENTS[editorRoute].every((name) => project?.narcs[name]);
}

function mastersheetRequirements(): NarcName[] {
  return ["personal", "learnsets", "moves", "items", "trdata", "trpok", "encounters"];
}

function navItem(nextRoute: Exclude<AppRoute, "upload" | "debugNarcs" | "grottoOdds" | "pokemonSprites">, label: string): string {
  const enabled = canVisit(nextRoute);
  const requirements =
    nextRoute === "docGenerators"
      ? []
      : nextRoute === "mastersheet"
        ? mastersheetRequirements()
      : nextRoute === "fileSystem"
        ? ([] as NarcName[])
      : nextRoute === "codeInjection"
        ? ([] as NarcName[])
      : nextRoute === "patches"
        ? ([] as NarcName[])
      : nextRoute === "maps3d"
        ? ([] as NarcName[])
      : nextRoute === "changelog"
        ? ([] as NarcName[])
      : nextRoute === "tutorMoves"
        ? ([] as NarcName[])
      : EDITOR_REQUIREMENTS[nextRoute as Exclude<AppRoute, "upload" | "fileSystem" | "codeInjection" | "patches" | "debugNarcs" | "grottoOdds" | "docGenerators" | "mastersheet" | "maps3d" | "changelog" | "tutorMoves">];
  const missing = enabled
    ? ""
    : nextRoute === "fileSystem"
      ? ` title="Reload the ROM before opening File System"`
    : nextRoute === "codeInjection"
      ? ` title="${project?.session.baseRom === "BW" || project?.session.baseRom === "BW2" ? "Reload the ROM before opening Code Injection" : "Code Injection is currently Gen V only"}"`
    : nextRoute === "patches"
      ? ` title="Reload the ROM before opening Patches"`
      : nextRoute === "maps3d"
        ? ` title="${project?.headers ? "Reload the ROM before opening Maps 3D" : "Missing parsed headers"}"`
      : nextRoute === "mastersheet"
        ? ` title="${project?.session.baseRom === "BW" || project?.session.baseRom === "BW2" ? `Missing: ${requirements.filter((name) => !project?.narcs[name]).join(", ")}` : "Mastersheet generation is currently Gen 5-only"}"`
      : nextRoute === "animatedSprites"
        ? ` title="${project?.session.baseVersion === "B2" || project?.session.baseVersion === "W2" ? "Load Personal Data and install PWAN GIF Support from Code Injection" : "Animated Sprites supports stock US Black 2 and White 2"}"`
        : nextRoute === "types"
          ? ` title="${project?.session.baseRom === "BW" || project?.session.baseRom === "BW2" ? "Load the Moves NARC to extract the type chart overlay" : "Type chart editing is currently Gen V-only"}"`
        : nextRoute === "tutorMoves"
          ? ` title="${project?.session.baseRom === "BW2" ? "Load Tutor Moves, Moves, or Grottos to extract overlay 36" : "Tutor move editing is currently BW2-only"}"`
        : nextRoute === "moveEffectHandlers"
          ? ` title="${project?.session.baseRom === "BW" || project?.session.baseRom === "BW2" ? "Load the Moves NARC to extract the effect handler table" : "Move effect handlers are currently Gen 5-only"}"`
        : nextRoute === "facilities"
          ? ` title="${project?.session.baseRom === "BW2" ? "Load Moves, Items, and at least one facility set NARC" : "Battle facility editing is currently BW2-only"}"`
        : nextRoute === "wbtFacilities"
          ? ` title="${project?.session.baseRom === "BW2" ? "Load Moves, Items, and Black Tower / White Treehollow facility NARCs" : "Battle facility editing is currently BW2-only"}"`
          : ` title="Missing: ${requirements.filter((name) => !project?.narcs[name]).join(", ")}"`;
  const active =
    route === nextRoute ||
    (nextRoute === "headers" && route === "overworlds") ||
    (nextRoute === "moves" && route === "moveAnimation") ||
    (nextRoute === "trainers" && route === "trainerSprites");
  return `<a class="header-item ${active ? "-active" : ""} ${enabled ? "" : "disabled"}" href="${routeUrl(nextRoute)}" ${enabled ? `data-route="${nextRoute}"` : ""}${missing}>${label}</a>`;
}

function safeRoute(nextRoute: AppRoute): AppRoute {
  if (!project || nextRoute === "upload" || nextRoute === "debugNarcs") return nextRoute;
  if (nextRoute === "grottoOdds") return canVisit("grottos") ? nextRoute : safeRoute("grottos");
  if (nextRoute === "overworlds" && activeOverworldId === undefined) return safeRoute("headers");
  if (nextRoute === "moveAnimation" && activeMoveAnimationMoveId === undefined) return safeRoute("moves");
  if (nextRoute === "pokemonSprites" && activePokemonSpriteSpeciesId === undefined) return safeRoute("pokemon");
  if (nextRoute === "trainerSprites" && activeTrainerSpriteClassId === undefined) return safeRoute("trainers");
  if (canVisit(nextRoute)) return nextRoute;
  return canVisit("headers") ? "headers" : "debugNarcs";
}

function defaultLoadedRoute(): AppRoute {
  if (project?.narcs.personal && canVisit("pokemon")) return "pokemon";
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
  activeMoveAnimationMoveId = nextState.moveAnimationMoveId;
  activePokemonSpriteSpeciesId = nextState.pokemonSpriteSpeciesId;
  activePokemonSpriteFormIndex = nextState.pokemonSpriteFormIndex ?? 0;
  activeTrainerSpriteClassId = nextState.trainerSpriteClassId;
  activePwanAnimationSpeciesId = nextState.pwanAnimationSpeciesId;
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
  if (activeMoveAnimationMoveId !== undefined) window.localStorage.setItem(MOVE_ANIMATION_ROUTE_KEY, String(activeMoveAnimationMoveId));
  else window.localStorage.removeItem(MOVE_ANIMATION_ROUTE_KEY);
  if (activeTrainerSpriteClassId !== undefined) window.localStorage.setItem(TRAINER_SPRITE_ROUTE_KEY, String(activeTrainerSpriteClassId));
  else window.localStorage.removeItem(TRAINER_SPRITE_ROUTE_KEY);
  if (activePwanAnimationSpeciesId !== undefined) window.localStorage.setItem(PWAN_ANIMATION_ROUTE_KEY, String(activePwanAnimationSpeciesId));
  else window.localStorage.removeItem(PWAN_ANIMATION_ROUTE_KEY);
}

function syncBrowserHistory(replace: boolean): void {
  const state = currentHistoryState();
  const url = routeUrl(
    state.route,
    state.overworldId,
    state.moveAnimationMoveId,
    state.pokemonSpriteSpeciesId,
    state.pokemonSpriteFormIndex,
    state.trainerSpriteClassId,
    state.pwanAnimationSpeciesId,
  );
  if (replace) window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
}

function currentHistoryState(): AppHistoryState {
  if (route === "overworlds") return { route, overworldId: activeOverworldId };
  if (route === "moveAnimation") return { route, moveAnimationMoveId: activeMoveAnimationMoveId };
  if (route === "pokemonSprites") return { route, pokemonSpriteSpeciesId: activePokemonSpriteSpeciesId, pokemonSpriteFormIndex: activePokemonSpriteFormIndex };
  if (route === "trainerSprites") return { route, trainerSpriteClassId: activeTrainerSpriteClassId };
  if (route === "animatedSprites" && activePwanAnimationSpeciesId !== undefined) return { route, pwanAnimationSpeciesId: activePwanAnimationSpeciesId };
  return { route };
}

function routeUrl(
  nextRoute: AppRoute,
  overworldId = activeOverworldId,
  moveAnimationMoveId = activeMoveAnimationMoveId,
  pokemonSpriteSpeciesId = activePokemonSpriteSpeciesId,
  pokemonSpriteFormIndex = activePokemonSpriteFormIndex,
  trainerSpriteClassId = activeTrainerSpriteClassId,
  pwanAnimationSpeciesId = activePwanAnimationSpeciesId,
): string {
  if (nextRoute === "overworlds" && overworldId !== undefined) return `#overworlds/${overworldId}`;
  if (nextRoute === "moveAnimation" && moveAnimationMoveId !== undefined) return `#moveAnimation/${moveAnimationMoveId}`;
  if (nextRoute === "pokemonSprites" && pokemonSpriteSpeciesId !== undefined) {
    return `#pokemonSprites/${pokemonSpriteSpeciesId}/${pokemonSpriteFormIndex}`;
  }
  if (nextRoute === "trainerSprites" && trainerSpriteClassId !== undefined) return `#trainerSprites/${trainerSpriteClassId}`;
  if (nextRoute === "animatedSprites" && pwanAnimationSpeciesId !== undefined) return `#animatedSprites/${pwanAnimationSpeciesId}`;
  if (nextRoute === "starters") return "#scriptedpkmn";
  return `#${nextRoute}`;
}

function routeStateFromUrl(): AppHistoryState | undefined {
  const hash = window.location.hash.replace(/^#/u, "");
  if (!hash) return undefined;
  const [rawRouteName, idText, extraText] = hash.split("/");
  const routeName = rawRouteName === "scriptedpkmn" ? "starters" : rawRouteName;
  if (!isAppRoute(routeName)) return undefined;
  const id = idText === undefined ? undefined : Number(idText);
  const formIndex = extraText === undefined ? undefined : Number(extraText);
  return {
    route: routeName,
    overworldId: routeName === "overworlds" && Number.isSafeInteger(id) ? id : undefined,
    moveAnimationMoveId: routeName === "moveAnimation" && Number.isSafeInteger(id) ? id : undefined,
    pokemonSpriteSpeciesId: routeName === "pokemonSprites" && Number.isSafeInteger(id) ? id : undefined,
    pokemonSpriteFormIndex: routeName === "pokemonSprites" && Number.isSafeInteger(formIndex) ? formIndex : undefined,
    trainerSpriteClassId: routeName === "trainerSprites" && Number.isSafeInteger(id) ? id : undefined,
    pwanAnimationSpeciesId: routeName === "animatedSprites" && Number.isSafeInteger(id) ? id : undefined,
  };
}

function routeStateFromStorage(): AppHistoryState {
  const savedRoute = window.localStorage.getItem(ROUTE_KEY);
  const routeName = isAppRoute(savedRoute) ? savedRoute : project ? "headers" : "upload";
  const savedOverworldId = Number(window.localStorage.getItem(OVERWORLD_ROUTE_KEY));
  const savedMoveAnimationMoveIdText = window.localStorage.getItem(MOVE_ANIMATION_ROUTE_KEY);
  const savedMoveAnimationMoveId = savedMoveAnimationMoveIdText === null ? undefined : Number(savedMoveAnimationMoveIdText);
  const savedTrainerSpriteClassIdText = window.localStorage.getItem(TRAINER_SPRITE_ROUTE_KEY);
  const savedTrainerSpriteClassId = savedTrainerSpriteClassIdText === null ? undefined : Number(savedTrainerSpriteClassIdText);
  const savedPwanAnimationSpeciesIdText = window.localStorage.getItem(PWAN_ANIMATION_ROUTE_KEY);
  const savedPwanAnimationSpeciesId = savedPwanAnimationSpeciesIdText === null ? undefined : Number(savedPwanAnimationSpeciesIdText);
  return {
    route: routeName,
    overworldId: Number.isSafeInteger(savedOverworldId) ? savedOverworldId : undefined,
    moveAnimationMoveId: Number.isSafeInteger(savedMoveAnimationMoveId) ? savedMoveAnimationMoveId : undefined,
    trainerSpriteClassId: Number.isSafeInteger(savedTrainerSpriteClassId) ? savedTrainerSpriteClassId : undefined,
    pwanAnimationSpeciesId: Number.isSafeInteger(savedPwanAnimationSpeciesId) ? savedPwanAnimationSpeciesId : undefined,
  };
}

function routeStateFromHistory(value: unknown): AppHistoryState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = value as Partial<AppHistoryState>;
  if (!isAppRoute(maybe.route)) return undefined;
  return {
    route: maybe.route,
    overworldId: Number.isSafeInteger(maybe.overworldId) ? maybe.overworldId : undefined,
    moveAnimationMoveId: Number.isSafeInteger(maybe.moveAnimationMoveId) ? maybe.moveAnimationMoveId : undefined,
    pokemonSpriteSpeciesId: Number.isSafeInteger(maybe.pokemonSpriteSpeciesId) ? maybe.pokemonSpriteSpeciesId : undefined,
    pokemonSpriteFormIndex: Number.isSafeInteger(maybe.pokemonSpriteFormIndex) ? maybe.pokemonSpriteFormIndex : undefined,
    trainerSpriteClassId: Number.isSafeInteger(maybe.trainerSpriteClassId) ? maybe.trainerSpriteClassId : undefined,
    pwanAnimationSpeciesId: Number.isSafeInteger(maybe.pwanAnimationSpeciesId) ? maybe.pwanAnimationSpeciesId : undefined,
  };
}

function isAppRoute(value: unknown): value is AppRoute {
  return typeof value === "string" && APP_ROUTES.includes(value as AppRoute);
}

function statusText(status: HTMLElement | null | undefined, message: string): void {
  if (status) status.textContent = message;
}

function showRomLoadProgressOverlay(fileName: string): RomLoadProgressOverlay {
  const overlay = document.createElement("div");
  overlay.className = "rom-load-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "ROM load progress");
  overlay.setAttribute("aria-modal", "true");

  const dialog = document.createElement("div");
  dialog.className = "rom-load-dialog";

  const header = document.createElement("div");
  header.className = "rom-load-dialog__header";

  const titleBlock = document.createElement("div");
  titleBlock.className = "rom-load-dialog__title-block";

  const title = document.createElement("h2");
  title.textContent = "Loading ROM";

  const subtitle = document.createElement("p");
  subtitle.textContent = fileName;

  titleBlock.append(title, subtitle);

  const closeButton = document.createElement("button");
  closeButton.className = "rom-load-dialog__close";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.hidden = true;

  header.append(titleBlock, closeButton);

  const stage = document.createElement("div");
  stage.className = "rom-load-stage";
  stage.setAttribute("aria-live", "polite");
  stage.textContent = "Preparing load...";

  const progress = document.createElement("div");
  progress.className = "rom-load-progress -indeterminate";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");

  const progressBar = document.createElement("div");
  progressBar.className = "rom-load-progress__bar";
  progress.append(progressBar);

  const consoleLog = document.createElement("div");
  consoleLog.className = "rom-load-console";
  consoleLog.setAttribute("aria-live", "polite");

  dialog.append(header, stage, progress, consoleLog);
  overlay.append(dialog);
  document.body.append(overlay);

  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
  };

  const appendLine = (message: string, kind: "stage" | "error" = "stage") => {
    const line = document.createElement("div");
    line.className = `rom-load-console__line${kind === "error" ? " -error" : ""}`;

    const time = document.createElement("span");
    time.className = "rom-load-console__time";
    time.textContent = new Date().toLocaleTimeString();

    const text = document.createElement("span");
    text.textContent = message;

    line.append(time, text);
    consoleLog.append(line);
    consoleLog.scrollTop = consoleLog.scrollHeight;
  };

  const setProgress = (percent: number | undefined) => {
    if (percent === undefined) {
      progress.classList.add("-indeterminate");
      progress.removeAttribute("aria-valuenow");
      progressBar.style.width = "";
      return;
    }
    const boundedPercent = Math.max(0, Math.min(100, percent));
    progress.classList.remove("-indeterminate");
    progress.setAttribute("aria-valuenow", String(Math.round(boundedPercent)));
    progressBar.style.width = `${boundedPercent}%`;
  };

  const api: RomLoadProgressOverlay = {
    setStage(message) {
      if (closed) return;
      stage.textContent = message;
      setProgress(estimateRomLoadProgress(message));
      appendLine(message);
    },
    setError(message) {
      if (closed) return;
      dialog.classList.add("-error");
      stage.textContent = "ROM load failed";
      setProgress(100);
      appendLine(message, "error");
      closeButton.hidden = false;
      closeButton.focus();
    },
    finish(message = "ROM loaded") {
      if (closed) return;
      stage.textContent = message;
      setProgress(100);
      appendLine(message);
    },
    close,
  };

  closeButton.addEventListener("click", close);
  appendLine("Opened ROM load console");
  return api;
}

function estimateRomLoadProgress(message: string): number | undefined {
  const stage = ROM_LOAD_STAGE_PROGRESS.find(([stageMessage]) => message.startsWith(stageMessage));
  return stage?.[1];
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 80);
  });
}

function setChangelogBusy(root: HTMLElement, busy: boolean): void {
  const hasText = (root.querySelector<HTMLTextAreaElement>("#changelog-output")?.value ?? "").length > 0;
  const generateButton = root.querySelector<HTMLButtonElement>("#generate-changelog-btn");
  const copyButton = root.querySelector<HTMLButtonElement>("#copy-changelog-btn");
  const downloadButton = root.querySelector<HTMLButtonElement>("#download-changelog-btn");
  if (generateButton) generateButton.disabled = busy;
  if (copyButton) copyButton.disabled = busy || !hasText;
  if (downloadButton) downloadButton.disabled = busy || !hasText;
  root.querySelectorAll<HTMLInputElement>("#changelog-before-input, #changelog-after-input, #changelog-fairy-input").forEach((input) => {
    input.disabled = busy;
  });
}

function renderDirtyIndicator(): void {
  const headerStatus = appRoot.querySelector<HTMLElement>("#header-status");
  if (headerStatus) {
    headerStatus.innerHTML = dirty ? renderDirtyIndicatorLink() : "";
    headerStatus.querySelector<HTMLAnchorElement>("[data-route='changelog']")?.addEventListener("click", (event) => {
      event.preventDefault();
      navigate("changelog");
    });
  }

  const debugLink = appRoot.querySelector<HTMLAnchorElement>("[data-route='debugNarcs']");
  if (debugLink && project) debugLink.textContent = `Debug (${getCachedRecordCount(project)})`;
}

function renderDirtyIndicatorLink(): string {
  return `<a class="dirty-indicator" href="${routeUrl("changelog")}" data-route="changelog">View Changelog</a>`;
}
