import { renderInlineStatus } from "./inlineStatus";
import { installCodeInjectionPatch } from "../pokeweb/codeInjectionInstall";
import { getPartyQuickActionsStatus, installPartyQuickActions, disablePartyQuickActions, parsePartyToolbarHideFlag, PARTY_TOOLBAR_SECTIONS } from "../pokeweb/partyQuickActionsModel";
import {
  detectBundledFormEvolutionDll,
  detectBundledDoubleBattleFixDll,
  detectBundledBgmToggleDll,
  detectBundledOverworldWeatherRuntime,
  getPmcInstallStatus,
  getPmcUpdateConfirmationMessage,
  installBundledOverworldWeatherRuntime,
  installBundledBgmToggleDll,
  installBundledPmc,
  listCodeInjectionDlls,
  prepareBw2FormEvolutionCodeInjection,
  stageBundledDoubleBattleFixDll,
  stageCodeInjectionDll,
  type CodeInjectionDllTarget,
} from "../pokeweb/pmcModel";
import {
  canUninstallPwanRuntime,
  getPwanRuntimeStatus,
  installPwanRuntime,
  uninstallPwanRuntime,
} from "../pokeweb/pwanAnimationModel";
import {
  canUninstallTrainerPwanRuntime,
  getTrainerPwanRuntimeStatus,
  installTrainerPwanRuntime,
  uninstallTrainerPwanRuntime,
} from "../pokeweb/trainerPwanAnimationModel";
import { detectTrainerPwanCompatibility } from "../pokeweb/trainerPwanCompatibilityModel";
import {
  battleLogDisplayName,
  canUninstallBattleLog,
  getBattleLogInstallStatus,
  installBattleLog,
  uninstallBattleLog,
} from "../pokeweb/battleLogModel";
import {
  MENU_EVOLUTION_TITLE,
  canUninstallMenuEvolution,
  getMenuEvolutionInstallStatus,
  installMenuEvolution,
  menuEvolutionDisplayName,
  uninstallMenuEvolution,
} from "../pokeweb/menuEvolutionModel";
import {
  getTagBattleStabilizationStatus,
  installTagBattleStabilization,
  uninstallTagBattleStabilization,
} from "../pokeweb/tagBattleStabilizationModel";
import { getPortaPcStatus, installPortaPc, uninstallPortaPc } from "../pokeweb/portaPcModel";
import { CGEAR_QUICK_ACTIONS_VERSION, getCGearQuickActionsStatus, installCGearQuickActions, disableCGearQuickActions, removeCGearQuickActions } from "../pokeweb/cgearQuickActionsModel";
import { CGEAR_QUICK_ACTIONS_BW1_VERSION } from "../pokeweb/cgearQuickActionsBw1Model";
import { getPokenavStatus, installPokenav, disablePokenav } from "../pokeweb/pokenavModel";
import { getNuzlockeEncountersStatus,installNuzlockeEncounters,disableNuzlockeEncounters } from "../pokeweb/nuzlockeEncountersModel";
import { getLearnsetViewerStatus, installLearnsetViewer, uninstallLearnsetViewer } from "../pokeweb/learnsetViewerModel";
import { getSummaryStatViewerStatus, installSummaryStatViewer, uninstallSummaryStatViewer, SUMMARY_STAT_VIEWER_VERSION } from "../pokeweb/summaryStatViewerModel";
import { getSummaryTypeIconsStatus, installSummaryTypeIcons, uninstallSummaryTypeIcons, SUMMARY_TYPE_ICONS_VERSION } from "../pokeweb/summaryTypeIconsModel";
import { getSaveMenuSettings, getSaveMenuStatus, installSaveMenu, SAVE_MENU_VERSION, SAVE_MENU_VERSION_LABEL_MAX_LENGTH, type SaveMenuSettings } from "../pokeweb/saveMenuModel";
import { canUseLocalRomBridge } from "../pokeweb/localRomBridge";
import { getInfiniteCandyStatus, installInfiniteCandy } from "../pokeweb/infiniteCandyModel";
import { getLevelCapsStatus, installLevelCaps } from "../pokeweb/levelCapsModel";
import { TESTING_PATCHES, getTestingPatchStatus, installTestingPatch, uninstallTestingPatch, type TestingPatchId } from "../pokeweb/testingPatchesModel";
import { getBattleTypeHudStatus, installBattleTypeHud, uninstallBattleTypeHud, getMoveEffectivenessStatus, installMoveEffectiveness, uninstallMoveEffectiveness, DEFAULT_MOVE_HIGHLIGHT_COLORS, type MoveHighlightColors, type TypeIconVariant } from "../pokeweb/battleTypeHudModel";
import {
  detectPwanRuntimeCompatibility,
  pwanCompatibilityFailureSummary,
  type PwanCompatibilityCheck,
  type PwanCompatibilityReport,
} from "../pokeweb/pwanCompatibilityModel";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import { getStandaloneStreamConfigs, type ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const codeInjectionHydrationProjects = new WeakSet<ProjectState>();
const typeIconLettersPreview = new URL("../assets/codeinjection/type-icons-letters-preview.png", import.meta.url).href;
const typeIconCircularPreview = new URL("../assets/codeinjection/type-icons-circular-preview.png", import.meta.url).href;
const typeIconSolidPreview = new URL("../assets/codeinjection/type-icons-solid-preview.png", import.meta.url).href;
const summaryTypeIconsPreview = new URL("../assets/codeinjection/summary-type-icons-preview.png", import.meta.url).href;
const codeInjectionTabs = [
  { id: "infrastructure", label: "Infrastructure and Dependencies" },
  { id: "graphics", label: "Graphical/UI Enhancements" },
  { id: "quality-of-life", label: "Quality of Life" },
  { id: "add-ons", label: "Feature Add-Ons" },
  { id: "debug-helpers", label: "Debug Helpers" },
] as const;
type CodeInjectionTab = (typeof codeInjectionTabs)[number]["id"];
const activeCodeInjectionTabs = new WeakMap<HTMLElement, CodeInjectionTab>();
const showUnsupportedCodeInjectionPatches = new WeakMap<ProjectState, boolean>();

export function renderCodeInjectionEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const activeTab = activeCodeInjectionTabs.get(root) ?? "infrastructure";
  const showUnsupported = showUnsupportedCodeInjectionPatches.get(project) ?? project.session.baseRom !== "BW";
  const patchVisibility = (supported: boolean): string =>
    `data-code-injection-supported="${supported}"${!supported && !showUnsupported ? " hidden" : ""}`;
  const emptyCategoryMessage = `<div class="code-injection-empty" data-code-injection-empty hidden>No supported patches in this category. Enable “Show unsupported patches” in the sidebar to view all patches.</div>`;
  const status = getPmcInstallStatus(project);
  const install = <T>(stage: (candidate: ProjectState) => T | Promise<T>) => installCodeInjectionPatch(project, stage);
  const modules = listCodeInjectionDlls(project);
  const formEvolutionStatus = detectBundledFormEvolutionDll(project);
  const formEvolutionInstalled = formEvolutionStatus === "patched";
  const doubleBattleFixStatus = detectBundledDoubleBattleFixDll(project);
  const doubleBattleFixSupported = status.supported && doubleBattleFixStatus !== "unsupported";
  const bgmToggleStatus = detectBundledBgmToggleDll(project);
  const bgmToggleSupported = bgmToggleStatus !== "unsupported";
  const infiniteCandyStatus = getInfiniteCandyStatus(project);
  const levelCapsStatus = getLevelCapsStatus(project);
  const testingPatchCard = (id: TestingPatchId) => {
    const patch = TESTING_PATCHES[id];
    const state = getTestingPatchStatus(project, id);
    return `<section class="code-injection-panel" ${patchVisibility(state.supported)}>
      <div class="code-injection-panel__header"><div>
        <h2>${escapeHtml(patch.title)}</h2><p>${escapeHtml(patch.description)}</p>
      </div>${renderInlineStatus(state.installed ? "Installed" : state.compatible ? "Ready" : state.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}</div>
      <div class="code-injection-facts"><div><span>ROM</span><strong>US White 2</strong></div><div><span>Version</span><strong>0.1.0 alpha</strong></div></div>
      <p>${escapeHtml(state.message)}</p>
      <div class="code-injection-actions">
        <button class="btn -primary" id="install-${id}-btn" type="button" ${state.compatible && !state.installed ? "" : "disabled"}>${state.installed ? "Installed" : `Install ${escapeHtml(patch.title)}`}</button>
        ${state.canUninstall ? `<button class="btn -default" id="uninstall-${id}-btn" type="button">Remove</button>` : ""}
        <div class="code-injection-note" id="${id}-note" aria-live="polite"></div>
      </div></section>`;
  };
  const tagBattleStatus = getTagBattleStabilizationStatus(project);
  const tagBattleCanInstall = tagBattleStatus.supported && tagBattleStatus.compatible && !tagBattleStatus.installed;
  const portaPcStatus = getPortaPcStatus(project);
  const quickActionsStatus = getCGearQuickActionsStatus(project);
  const learnsetStatus = getLearnsetViewerStatus(project);
  const pokenavStatus = getPokenavStatus(project);
  const nuzlockeStatus = getNuzlockeEncountersStatus(project);
  const summaryStatStatus = getSummaryStatViewerStatus(project);
  const summaryTypeStatus = canUseLocalRomBridge() ? getSummaryTypeIconsStatus(project) : undefined;
  const saveMenuStatus = getSaveMenuStatus(project);
  const saveMenuSettings = getSaveMenuSettings(project);
  const standaloneSongs = getStandaloneStreamConfigs(project);
  const battleHudStatus = getBattleTypeHudStatus(project);
  const moveEffectivenessStatus = getMoveEffectivenessStatus(project);
  const moveColors = moveEffectivenessStatus.colors ?? DEFAULT_MOVE_HIGHLIGHT_COLORS;
  const portaPcCanInstall = portaPcStatus.supported && portaPcStatus.compatible
    && (!portaPcStatus.installed || portaPcStatus.updateAvailable);
  const weatherRuntimeStatus = detectBundledOverworldWeatherRuntime(project);
  const weatherRuntimeInstalled = weatherRuntimeStatus === "patched";
  const weatherRuntimeSupported = weatherRuntimeStatus !== "unsupported";
  const pwanRuntimeStatus = getPwanRuntimeStatus(project);
  const pwanRuntimeInstalled = pwanRuntimeStatus.supported && pwanRuntimeStatus.installed;
  const pwanRuntimeCanUninstall = pwanRuntimeInstalled && canUninstallPwanRuntime(project);
  const pwanLegacyInstalled = pwanRuntimeStatus.supported && pwanRuntimeStatus.legacyInstalled;
  const pwanCompatibility = detectPwanRuntimeCompatibility(project);
  const pwanCanInstall = pwanRuntimeStatus.supported && pwanCompatibility.compatible;
  const trainerPwanStatus = getTrainerPwanRuntimeStatus(project);
  const trainerPwanCompatibility = detectTrainerPwanCompatibility(project);
  const trainerPwanInstalled = trainerPwanStatus.supported && trainerPwanStatus.installed;
  const trainerPwanCanInstall = trainerPwanStatus.supported && (trainerPwanCompatibility.compatible || (!project.originalRomBytes && trainerPwanCompatibility.checks.every((check) => check.status === "missing")));
  const trainerPwanCanUninstall = trainerPwanInstalled && canUninstallTrainerPwanRuntime(project);
  const battleLogStatus = getBattleLogInstallStatus(project);
  const battleLogCanInstall = battleLogStatus.supported && battleLogStatus.compatible;
  const battleLogCanUninstall = battleLogStatus.installed && canUninstallBattleLog(project);
  const partyTools = getPartyQuickActionsStatus(project);
  const menuEvolutionStatus = getMenuEvolutionInstallStatus(project);
  const menuEvolutionCanInstall = menuEvolutionStatus.supported
    && menuEvolutionStatus.compatible
    && battleLogStatus.supported && battleLogStatus.compatible;
  const menuEvolutionCanUninstall = menuEvolutionStatus.installed && canUninstallMenuEvolution(project);
  if (status.supported && !project.originalRomBytes && !codeInjectionHydrationProjects.has(project)) {
    void hydrateRomBytesForCodeInjection(project, root, onDirty);
  }
  const battleUiCards = [
    { id: "battle-hud", title: "Type Icons", status: battleHudStatus,
      description: "Shows type icons on player and enemy health panels in singles, doubles and triples, including compact panels with EXP bars. Choose lettered hexagons, the original circular symbol artwork, or solid type-colored wedges fitted into the HUD edge. Every style preserves the native caught marker. Status labels hide the icons until the condition clears. Installs independently of move highlighting." },
    { id: "move-effectiveness", title: "Move Effectiveness Preview", status: moveEffectivenessStatus,
      description: "Highlights damaging moves as super effective, not very effective, or immune. Includes standard BW2 type immunities, Levitate, Air Balloon, Magnet Rise, and blocking abilities with suppression and bypass checks. Singles and rotation use the opposing Pokémon; doubles and triples color the selected move name while choosing an enemy. Weather Ball, Natural Gift, Judgment and Techno Blast stay neutral. Custom ability and item mechanics need a compatible preview patch." },
  ].map(card => `
        <section class="code-injection-panel" ${patchVisibility(card.status.supported)}>
          <div class="code-injection-panel__header">
            <div><h2>${card.title}</h2><p>${card.description}</p></div>
            ${renderInlineStatus(card.status.legacyCombined ? "Combined Patch Present" : card.status.updateAvailable ? "Update Available" : card.status.installed ? "Installed" : card.status.compatible ? "Ready" : card.status.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>English Black 2 / White 2</strong></div>
            <div><span>Dependency</span><strong>PMC only</strong></div>
          </div>
          ${card.id === "battle-hud" ? `<div class="type-icon-variant-picker">
            <div class="type-icon-variant-previews" aria-label="Type icon variation previews">
              <figure class="type-icon-variant-preview ${(battleHudStatus.iconVariant ?? "letters") === "letters" ? "is-selected" : ""}" data-type-icon-variant-card="letters">
                <figcaption>Hexagonal letters</figcaption>
                <img src="${typeIconLettersPreview}" alt="All 18 lettered hexagonal type icons" loading="lazy">
              </figure>
              <figure class="type-icon-variant-preview ${battleHudStatus.iconVariant === "circular" ? "is-selected" : ""}" data-type-icon-variant-card="circular">
                <figcaption>Circular icons</figcaption>
                <img src="${typeIconCircularPreview}" alt="All 18 circular symbol type icons" loading="lazy">
              </figure>
              <figure class="type-icon-variant-preview ${battleHudStatus.iconVariant === "solid" ? "is-selected" : ""}" data-type-icon-variant-card="solid">
                <figcaption>Angular HUD wedges</figcaption>
                <img src="${typeIconSolidPreview}" alt="Angular dual-type HUD wedge examples" loading="lazy">
              </figure>
            </div>
            <label class="type-icon-variant-toggle">
              <span>Icon style</span>
              <select id="type-icon-variant" aria-label="Type icon style">
                <option value="letters" ${(battleHudStatus.iconVariant ?? "letters") === "letters" ? "selected" : ""}>Hexagonal letters</option>
                <option value="circular" ${battleHudStatus.iconVariant === "circular" ? "selected" : ""}>Circular icons</option>
                <option value="solid" ${battleHudStatus.iconVariant === "solid" ? "selected" : ""}>Angular HUD wedges</option>
              </select>
            </label>
            <p class="code-injection-note">Angular wedges fit the HUD's left face while retaining its lower shadow. Monotypes use the dark summary-label shade at their edges; dual types use black-and-color shading so the native HP-bar palette stays intact. Dual types keep a raised black divider; monotypes remain continuous. Reinstalling replaces the active Type Icons DLL in place.</p>
          </div>` : ""}
          ${card.id === "move-effectiveness" ? `<div class="code-injection-facts">
            ${([
              ["superEffective", "Super effective"], ["notVeryEffective", "Not very effective"], ["immune", "Immune / no damage"],
            ] as const).map(([key, label]) => `<label><span>${label}</span>
              <input type="color" data-move-highlight-color="${key}" aria-label="${label} color" value="${escapeHtml(moveColors[key])}">
              <strong data-move-highlight-sample="${key}" style="color:${escapeHtml(moveColors[key])}">${label}</strong>
            </label>`).join("")}
          </div><p class="code-injection-note">Choose colors, then ${card.status.installed ? "reinstall" : "install"} to apply them. Colors are stored with DS color precision. The preview uses current ability/item state, including unrevealed effects.</p>
          <button class="btn -default" type="button" id="reset-move-highlight-colors">Reset colors</button>` : ""}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-${card.id}-btn" type="button" ${card.status.supported && card.status.compatible ? "" : "disabled"}>${card.status.legacyCombined ? "Replace combined" : card.status.updateAvailable ? "Update" : card.status.installed ? "Reinstall" : "Install"}</button>
            <button class="btn -default" id="uninstall-${card.id}-btn" type="button" ${card.status.canUninstall ? "" : "disabled"} title="Only this project's staged standalone DLL can be removed.">Uninstall</button>
            <div class="code-injection-note" id="${card.id}-note" aria-live="polite"></div>
          </div>
          ${card.id === "battle-hud" ? `<div class="code-injection-credits" aria-label="Type Icons credits">
            <span>Designed in collaboration with</span>
            <strong>TrustyPeaches</strong>
          </div>` : ""}
        </section>`);
  root.innerHTML = `
    <section class="code-injection-page">
      <aside class="code-injection-sidebar">
        <h1>Code Injection</h1>
        <label class="code-injection-sidebar__filter">
          <input type="checkbox" id="show-unsupported-patches" ${showUnsupported ? "checked" : ""} />
          <span>Show unsupported patches</span>
        </label>
        <section class="code-injection-panel code-injection-sidebar__runtime">
          <div class="code-injection-panel__header">
            <div>
              <h2>PMC Runtime</h2>
              <p>Shared runtime for the patch installers on this page. Required dependencies are installed automatically.</p>
            </div>
            ${renderInlineStatus(status.installed ? "Installed" : "Not Installed", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Version</span><strong>${status.installed && status.version ? escapeHtml(status.version) : "—"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pmc-btn" type="button" ${status.supported ? "" : "disabled"}>${status.installed ? "Update PMC" : "Install PMC"}</button>
            <div class="code-injection-note" id="pmc-install-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-sidebar__modules">
          <h2>Installed DLLs</h2>
          <p>${status.installed ? "DLLs found under patches/ and lib/." : "Add built patch DLLs. PMC is installed automatically if needed."}</p>
          <div class="code-injection-actions">
            <button class="btn -primary" data-dll-target="patches" type="button" ${status.supported ? "" : "disabled"}>Add Patch DLL</button>
            <button class="btn -default" data-dll-target="lib" type="button" ${status.supported ? "" : "disabled"}>Add Library DLL</button>
            <input id="code-injection-dll-input" type="file" accept=".dll" hidden />
            <div class="code-injection-note" id="dll-install-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-module-list">
            ${
              modules.length === 0
                ? `<div class="code-injection-empty">No DLLs found.</div>`
                : modules
                    .map(
                      (module) => `
                        <div class="code-injection-module">
                          <strong>${escapeHtml(module.path)}</strong>
                        </div>
                      `,
                    )
                    .join("")
            }
          </div>
        </section>
      </aside>
      <main class="code-injection-main">
        <div class="code-injection-tabs" role="tablist" aria-label="Patch categories">
          ${codeInjectionTabs.map(tab => `<button class="code-injection-tab ${activeTab === tab.id ? "-active" : ""}" type="button" role="tab" id="code-injection-tab-${tab.id}" aria-controls="code-injection-panel-${tab.id}" aria-selected="${activeTab === tab.id}" tabindex="${activeTab === tab.id ? 0 : -1}" data-code-injection-tab="${tab.id}">${tab.label}</button>`).join("")}
        </div>
        <section class="code-injection-tab-panel" id="code-injection-panel-infrastructure" role="tabpanel" aria-labelledby="code-injection-tab-infrastructure" tabindex="0" ${activeTab === "infrastructure" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(pwanRuntimeStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>PWAN GIF Support</h2>
              <p>Installs PMC and the bundled PWAN runtime needed for Pokemon-scoped GIF imports.</p>
            </div>
            ${renderInlineStatus(pwanRuntimeInstalled ? "Installed" : pwanLegacyInstalled ? "Upgrade" : pwanCanInstall ? "Ready" : pwanCompatibility.supportedBase ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Runtime</span><strong>Full split</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
            <div><span>Compatibility</span><strong>${pwanCompatibility.compatible ? "Passed" : pwanCompatibility.supportedBase ? "Failed" : "Unsupported"}</strong></div>
            <div><span>Hook Checks</span><strong>${pwanCompatibility.passed}/${pwanCompatibility.checks.length}</strong></div>
          </div>
          ${renderPwanCompatibilityDetails(project, pwanCompatibility)}
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pwan-runtime-btn" type="button" ${pwanCanInstall ? "" : "disabled"}>
              ${pwanRuntimeInstalled ? "Reinstall PWAN GIF Support" : pwanLegacyInstalled ? "Upgrade PWAN GIF Support" : "Install PWAN GIF Support"}
            </button>
            <button class="btn -default" id="uninstall-pwan-runtime-btn" type="button" ${pwanRuntimeCanUninstall ? "" : "disabled"}
              title="${pwanRuntimeInstalled && !pwanRuntimeCanUninstall ? "DLLs already built into the loaded ROM cannot be removed yet." : "Remove the staged PWAN runtime DLLs."}">
              Uninstall PWAN GIF Support
            </button>
            <div class="code-injection-note" id="pwan-runtime-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(trainerPwanStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Trainer PWAN GIF Support</h2>
              <p>Installs the independent battle-intro runtime used by PWAN GIFs in the Trainer Class Sprite Editor.</p>
            </div>
            ${renderInlineStatus(trainerPwanInstalled ? "Installed" : trainerPwanCanInstall ? "Ready" : trainerPwanStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Sprites</span><strong>Front trainers</strong></div>
            <div><span>Runtime</span><strong>Standalone</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
            <div><span>ROM</span><strong>${escapeHtml(project.session.baseVersion)}</strong></div>
            <div><span>Hook Checks</span><strong>${trainerPwanCompatibility.passed}/${trainerPwanCompatibility.checks.length}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-trainer-pwan-runtime-btn" type="button" ${trainerPwanCanInstall ? "" : "disabled"}>
              ${trainerPwanInstalled ? "Reinstall Trainer PWAN Support" : "Install Trainer PWAN Support"}
            </button>
            <button class="btn -default" id="uninstall-trainer-pwan-runtime-btn" type="button" ${trainerPwanCanUninstall ? "" : "disabled"}>Uninstall Trainer PWAN Support</button>
            <div class="code-injection-note" id="trainer-pwan-runtime-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(weatherRuntimeSupported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Overworld Weather Runtime</h2>
              <p>Installs a resident 64-entry field-weather dispatcher and a data-driven registry so IDs 15–63 can clone stock behavior without per-effect code patches.</p>
            </div>
            ${renderInlineStatus(weatherRuntimeInstalled ? "Installed" : weatherRuntimeSupported ? "Ready" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US White 2 (IRDO)</strong></div>
            <div><span>Custom Slots</span><strong>49 · IDs 15–63</strong></div>
            <div><span>Registry</span><strong>weather/pwth.bin</strong></div>
            <div><span>Generic Resources</span><strong>NCGR · NCLR · NCER · NANR · 2× BTX0</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
            <div><span>Runtime ABI</span><strong>5 · PWTH v4</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-weather-runtime-btn" type="button" ${weatherRuntimeSupported ? "" : "disabled"}>
              ${weatherRuntimeInstalled ? "Reinstall Weather Runtime" : "Install Weather Runtime"}
            </button>
            <div class="code-injection-note" id="weather-runtime-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(battleLogStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Trainer Battle Log</h2>
              <p>Records trainer-battle teams and KO attribution. Installing overwrites Pal Pad/Wi-Fi data in save blocks 29–31. Updating cannot repair previously damaged records.</p>
            </div>
            ${renderInlineStatus(battleLogStatus.updateAvailable
                  ? "Update Available"
                  : battleLogStatus.upToDate
                    ? "Installed"
                    : battleLogCanInstall
                      ? "Ready"
                      : battleLogStatus.supported
                        ? "Incompatible"
                        : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US ${escapeHtml(battleLogDisplayName(project.session.baseVersion) ?? project.session.baseVersion)}</strong></div>
            <div><span>Capacity</span><strong>600 battles</strong></div>
            <div><span>Save Blocks</span><strong>29–31</strong></div>
            <div><span>Runtime</span><strong>${battleLogStatus.updateAvailable ? `Update to v${battleLogStatus.bundledRuntimeVersion}` : battleLogStatus.upToDate ? `v${battleLogStatus.bundledRuntimeVersion}` : `Bundled v${battleLogStatus.bundledRuntimeVersion}`}</strong></div>
            <div><span>Save Ownership</span><strong>${battleLogStatus.saveGuardInstalled ? "Active" : "Pending"}</strong></div>
            <div><span>Hook Checks</span><strong>${battleLogStatus.checked ? `${battleLogStatus.passed}/${battleLogStatus.checks.length}` : "On install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-battle-log-btn" type="button" ${battleLogCanInstall ? "" : "disabled"}>
              ${battleLogStatus.updateAvailable ? "Update Battle Log" : battleLogStatus.installed ? "Reinstall Battle Log" : "Install Battle Log"}
            </button>
            <button class="btn -default" id="uninstall-battle-log-btn" type="button" ${battleLogCanUninstall ? "" : "disabled"}
              title="${
                battleLogStatus.installed && menuEvolutionStatus.installed
                  ? `Uninstall ${MENU_EVOLUTION_TITLE} first.`
                  : battleLogStatus.installed && !battleLogCanUninstall
                    ? "DLLs already built into the loaded ROM cannot be removed yet."
                    : "Remove the staged battle-log DLLs."
              }">
              Uninstall Battle Log
            </button>
            <div class="code-injection-note" id="battle-log-note" aria-live="polite"></div>
          </div>
        </section>
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-graphics" role="tabpanel" aria-labelledby="code-injection-tab-graphics" tabindex="0" ${activeTab === "graphics" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(saveMenuStatus.supported)}>
          <div class="code-injection-panel__header"><div>
            <h2>Black 2 / White 2 Save Menu</h2>
            <p>An animated save card and native Unova map. Continue recalls the party from right to left while the player raises a Poké Ball, then jumps across both screens onto the location marker. The C-Gear question is answered Yes automatically.</p>
          </div>${renderInlineStatus(saveMenuStatus.updateAvailable ? "Update Available" : saveMenuStatus.installed ? "Installed" : !saveMenuStatus.supported ? "Unsupported" : saveMenuStatus.dependencyPresent ? "Ready" : "Requires Following Pokémon", { className: "code-injection-status" })}</div>
          <div class="code-injection-facts"><div><span>ROM</span><strong>English Black 2 / White 2</strong></div><div><span>Version</span><strong>${SAVE_MENU_VERSION}</strong></div></div>
          <p>${escapeHtml(saveMenuStatus.message)}</p>
          ${saveMenuStatus.supported ? `<p><a class="btn -default" href="#followingPokemon" data-route="followingPokemon">${saveMenuStatus.dependencyPresent ? "Open Following Pokémon" : "Install Following Pokémon"}</a></p>` : ""}
          <p>L/R make the left/right three Pokémon Hop; Y/X make alternating party slots Hop. Hold Select with L to spin slots 1–3, R for slots 4–6, Y for slots 1/3/5, or X for slots 2/4/6 using their follower sprites. The player raises the matching hand, and walking stays on the music beat.</p>
          <div class="code-injection-actions code-injection-settings">
            <label>ROM version label<input id="save-menu-version-label" type="text" maxlength="${SAVE_MENU_VERSION_LABEL_MAX_LENGTH}" value="${escapeHtml(saveMenuSettings.versionLabel ?? "")}" placeholder="v1.0" ${saveMenuStatus.supported ? "" : "disabled"} />
              <small>Optional text in the save card header. Up to 30 letters, numbers, spaces, or . , ! ? -.</small>
            </label>
            <label>Menu song
              <select id="save-menu-song" ${saveMenuStatus.supported ? "" : "disabled"}>
                <option value="relic-song" ${saveMenuSettings.music === "relic-song" ? "selected" : ""}>Relic Song (native sequence)</option>
                <option value="off" ${saveMenuSettings.music === "off" ? "selected" : ""}>Off (no save-menu music)</option>
                ${standaloneSongs.map(song => `<option value="stream:${song.streamId}" ${song.loop ? "" : "disabled"} ${saveMenuSettings.music === "stream" && saveMenuSettings.streamId === song.streamId ? "selected" : ""}>${escapeHtml(song.name)} · stream ${song.streamId}${song.loop ? "" : " (not looping)"}</option>`).join("")}
              </select>
              <small>Use Music → Standalone streamed songs to add a track without replacing game music.</small>
            </label>
            <label>Stream tempo (BPM)<input id="save-menu-bpm" type="number" min="30" max="300" step="1" value="${saveMenuSettings.bpm}" ${saveMenuStatus.supported ? "" : "disabled"} /></label>
            <label>Sprite pose changes per beat
              <select id="save-menu-steps-per-beat" ${saveMenuStatus.supported ? "" : "disabled"}>
                ${([1, 2, 4] as const).map(steps => `<option value="${steps}" ${saveMenuSettings.stepsPerBeat === steps ? "selected" : ""}>${steps}</option>`).join("")}
              </select>
              <small>The native song follows its sequence clock. Streams use BPM. With music off, sprites change poses every eight frames.</small>
            </label>
            <button class="btn -primary" id="install-save-menu-btn" type="button" ${saveMenuStatus.supported && saveMenuStatus.dependencyPresent ? "" : "disabled"}>${saveMenuStatus.updateAvailable ? "Update Save Menu" : saveMenuStatus.installed ? "Reinstall Save Menu" : "Install Save Menu"}</button>
            <div class="code-injection-note" id="save-menu-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(summaryStatStatus.supported)}>
          <div class="code-injection-panel__header"><div>
            <h2>Summary IV/EV Viewer</h2>
            <p>View stored IVs and optional EVs in the native Pokémon Summary using Left/Right or the bar-chart tab. The normal HP bar and other Summary controls are preserved.</p>
          </div>${renderInlineStatus(summaryStatStatus.updateAvailable ? "Update Available" : summaryStatStatus.installed ? "Installed" : summaryStatStatus.compatible ? "Ready" : summaryStatStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}</div>
          <div class="code-injection-facts"><div><span>ROM</span><strong>English US Black 2 / White 2</strong></div><div><span>Version</span><strong>${SUMMARY_STAT_VIEWER_VERSION}</strong></div></div>
          <p>${escapeHtml(summaryStatStatus.message)}</p>
          <label><input type="checkbox" id="summary-stat-evs" ${summaryStatStatus.options.includeEvs ? "checked" : ""} ${summaryStatStatus.compatible ? "" : "disabled"}> Include EV view</label>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-summary-stat-btn" type="button" ${summaryStatStatus.compatible ? "" : "disabled"}>${summaryStatStatus.updateAvailable ? "Update Viewer" : summaryStatStatus.installed ? "Apply Settings" : "Install Summary IV/EV Viewer"}</button>
            <button class="btn -default" id="uninstall-summary-stat-btn" type="button" ${summaryStatStatus.canUninstall ? "" : "disabled"}
              title="${summaryStatStatus.installed && !summaryStatStatus.canUninstall ? "A DLL built into the loaded ROM cannot yet be removed." : "Remove the staged viewer."}">Remove</button>
            <div class="code-injection-note" id="summary-stat-note" aria-live="polite"></div>
          </div>
        </section>
        ${summaryTypeStatus ? `<section class="code-injection-panel" ${patchVisibility(summaryTypeStatus.supported)}>
          <div class="code-injection-panel__header"><div>
            <h2>Summary Type Icons</h2>
            <p>Decorated badges for the 17 original BW2 types on the information page only. Places Type first, Name second, and Dex No. third. Other screens retain their original icons.</p>
          </div>${renderInlineStatus(summaryTypeStatus.installed ? "Installed" : summaryTypeStatus.compatible ? "Ready" : summaryTypeStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}</div>
          <div class="code-injection-facts"><div><span>ROM</span><strong>English US Black 2 / White 2</strong></div><div><span>Version</span><strong>${SUMMARY_TYPE_ICONS_VERSION}</strong></div></div>
          <img src="${summaryTypeIconsPreview}" alt="Decorated type icons in native BW2 colors" style="max-width:100%;image-rendering:pixelated" />
          <p>${escapeHtml(summaryTypeStatus.message)}</p>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-summary-types-btn" type="button" ${summaryTypeStatus.compatible ? "" : "disabled"}>${summaryTypeStatus.installed ? "Reinstall Summary Type Icons" : "Install Summary Type Icons"}</button>
            <button class="btn -default" id="uninstall-summary-types-btn" type="button" ${summaryTypeStatus.canUninstall ? "" : "disabled"}>Remove</button>
            <div class="code-injection-note" id="summary-types-note" aria-live="polite"></div>
          </div>
        </section>` : ""}
        <section class="code-injection-panel" ${patchVisibility(menuEvolutionStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>${MENU_EVOLUTION_TITLE}</h2>
              <p>Adds EVOLVE and RELEARN party commands, post-battle KO evolution, and immediate KO-threshold moves. Installs or updates the required Trainer Battle Log automatically.</p>
            </div>
            ${renderInlineStatus(menuEvolutionStatus.updateAvailable
                  ? "Update Available"
                  : menuEvolutionStatus.upToDate
                  ? "Installed"
                  : !menuEvolutionStatus.supported
                    ? "Unsupported"
                    : menuEvolutionCanInstall
                        ? "Ready"
                        : "Incompatible", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US ${escapeHtml(menuEvolutionDisplayName(project.session.baseVersion) ?? project.session.baseVersion)}</strong></div>
            <div><span>Methods</span><strong>Level, KOs, Battles, Used</strong></div>
            <div><span>KO Moves</span><strong>32 per Pokémon</strong></div>
            <div><span>Relearn</span><strong>Current level + earned KOs</strong></div>
            <div><span>Trainer Battle Log</span><strong>${battleLogStatus.upToDate ? "Installed" : battleLogStatus.compatible ? battleLogStatus.installed ? "Will Update" : "Will Install" : "Incompatible"}</strong></div>
            <div><span>PMC</span><strong>${menuEvolutionStatus.pmcInstalled ? "Installed" : "Will Install"}</strong></div>
            <div><span>Hook Checks</span><strong>${menuEvolutionStatus.checked ? `${menuEvolutionStatus.passed}/${menuEvolutionStatus.checks.length}` : "On install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-menu-evolution-btn" type="button" ${menuEvolutionCanInstall ? "" : "disabled"}>
              ${menuEvolutionStatus.updateAvailable ? "Update" : menuEvolutionStatus.installed ? "Reinstall" : "Install"}
            </button>
            <button class="btn -default" id="uninstall-menu-evolution-btn" type="button" ${menuEvolutionCanUninstall ? "" : "disabled"}
              title="${menuEvolutionStatus.installed && !menuEvolutionCanUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : `Remove the staged ${MENU_EVOLUTION_TITLE} DLL.`}">
              Uninstall
            </button>
            <div class="code-injection-note" id="menu-evolution-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-actions party-toolbar-settings" ${partyTools.supported ? "" : "hidden"}>
            <p>Party Toolbar: Leveling, Edging, Pre-dmg, Pre-status, Heal Team<br>Press L to access or use Touch screen</p>
            <div class="party-toolbar-flag">
              <label for="party-tools-hide-flag">Hide toolbar when save flag is set (optional)</label>
              <input id="party-tools-hide-flag" type="text" value="${partyTools.hideFlag === null ? "" : `0x${partyTools.hideFlag.toString(16).toUpperCase().padStart(4, "0")}`}" placeholder="None — always available" spellcheck="false" ${partyTools.compatible ? "" : "disabled"}>
            </div>
            <fieldset class="party-toolbar-section-flags">
              <legend>Hide sections when save flag is set (optional)</legend>
              ${PARTY_TOOLBAR_SECTIONS.map(({ id, label }) => `<div class="party-toolbar-flag">
                <label for="party-tools-${id}-hide-flag">${label}</label>
                <input id="party-tools-${id}-hide-flag" type="text" value="${partyTools.sectionHideFlags[id] === null ? "" : `0x${partyTools.sectionHideFlags[id]!.toString(16).toUpperCase().padStart(4, "0")}`}" placeholder="None — always available" spellcheck="false" ${partyTools.compatible ? "" : "disabled"}>
              </div>`).join("")}
            </fieldset>
            <button class="btn -primary" id="install-party-tools-btn" type="button" ${partyTools.compatible && partyTools.candyCompatible ? "" : "disabled"}>${partyTools.updateAvailable ? "Update Toolbar" : partyTools.installed ? "Enable / Reinstall Toolbar" : "Install Party Toolbar"}</button>
            <button class="btn -default" id="disable-party-tools-btn" type="button" ${partyTools.installed && partyTools.enabled && partyTools.compatible ? "" : "disabled"}>Disable Toolbar</button>
            <div class="party-toolbar-status" id="party-tools-status" aria-live="polite">${escapeHtml(partyTools.message)}</div>
          </div>
        </section>
        ${battleUiCards[0] ?? ""}
        <section class="code-injection-panel" ${patchVisibility(learnsetStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Learnset Viewer</h2>
              <p>Adds a standalone LEARNSET party command. D-pad Right/Left switches party Pokémon, skipping Eggs; L/R browses the evolution family and loads the highlighted species' info and learnset. Only its icon animates. A pages evolution requirements; final evolutions also show their predecessor's requirements. Hidden abilities are purple. The lower screen lists all level-up moves with levels and base max PP. Read-only: browsing never evolves Pokémon or teaches moves; no KO moves, and RELEARN is unchanged.</p>
            </div>
            ${renderInlineStatus(learnsetStatus.partial ? "Incomplete" : learnsetStatus.updateAvailable ? "Update Available" : learnsetStatus.installed ? "Installed" : learnsetStatus.compatible ? "Ready" : learnsetStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US W2 / B2 · vanilla or Upgrade</strong></div>
            <div><span>Dependency</span><strong>PMC only</strong></div>
            <div><span>Full party menu</span><strong>LEARNSET is hidden</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-learnset-viewer-btn" type="button" ${learnsetStatus.supported && learnsetStatus.compatible ? "" : "disabled"}>${learnsetStatus.updateAvailable ? "Update" : learnsetStatus.partial ? "Repair" : learnsetStatus.installed ? "Reinstall" : "Install"}</button>
            <button class="btn -default" id="uninstall-learnset-viewer-btn" type="button" ${learnsetStatus.canUninstall ? "" : "disabled"} title="Only staged companions can be removed; built-in ROM files cannot yet be deleted.">Uninstall</button>
            <div class="code-injection-note" id="learnset-viewer-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-credits" aria-label="Learnset Viewer credits">
            <span>Designed in collaboration with</span>
            <strong>TrustyPeaches</strong>
          </div>
        </section>
        ${battleUiCards[1] ?? ""}
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-quality-of-life" role="tabpanel" aria-labelledby="code-injection-tab-quality-of-life" tabindex="0" ${activeTab === "quality-of-life" ? "" : "hidden"}>
        ${testingPatchCard("instant-fast-text")}
        <section class="code-injection-panel" ${patchVisibility(bgmToggleSupported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Background Music Toggle</h2>
              <p>Press L + R + Select to mute or unmute background music in the overworld and battles. Sound effects, cries, and scripted game pauses are unchanged.</p>
            </div>
            ${renderInlineStatus(bgmToggleStatus === "patched" ? "Installed" : bgmToggleStatus === "unsupported" ? "Unsupported" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US Black / White / Black 2 / White 2</strong></div>
            <div><span>Shortcut</span><strong>L + R + Select</strong></div>
            <div><span>Scope</span><strong>Overworld + Battles</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-bgm-toggle-btn" type="button" ${bgmToggleSupported ? "" : "disabled"}>
              ${bgmToggleStatus === "patched" ? "Reinstall Music Toggle" : "Install Music Toggle"}
            </button>
            <div class="code-injection-note" id="bgm-toggle-note" aria-live="polite"></div>
          </div>
        </section>
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-add-ons" role="tabpanel" aria-labelledby="code-injection-tab-add-ons" tabindex="0" ${activeTab === "add-ons" ? "" : "hidden"}>
        <section class="code-injection-panel" ${patchVisibility(infiniteCandyStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Infinite Rare Candy</h2>
              <p>Adds a reusable level-up item to Key Items. Grant item 622 through an event or save editor; installation does not add it to existing saves.</p>
            </div>
            ${renderInlineStatus(infiniteCandyStatus.installed ? "Installed" : infiniteCandyStatus.compatible ? "Ready" : infiniteCandyStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US Black 2 / White 2</strong></div>
            <div><span>Item ID</span><strong>622</strong></div>
            <div><span>Bag</span><strong>Key Items</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-infinite-candy-btn" type="button" ${infiniteCandyStatus.compatible ? "" : "disabled"}>
              ${infiniteCandyStatus.installed ? "Reinstall Infinite Candy" : "Install Infinite Candy"}
            </button>
            <div class="code-injection-note" id="infinite-candy-note" aria-live="polite"></div>
            <div class="code-injection-credits">Item behavior adapted from PW2Code by Dararo.</div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(levelCapsStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Hard Level Caps</h2>
              <p>Caps battle EXP and Day Care growth at the level set by <code>EventWorks.Set(16415, level)</code>. Infinite Candy respects the cap; regular Rare Candy can still reach level 100.</p>
            </div>
            ${renderInlineStatus(levelCapsStatus.installed ? "Installed" : levelCapsStatus.compatible ? "Ready" : levelCapsStatus.supported ? "Incompatible" : "Unsupported", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US Black 2 / White 2</strong></div>
            <div><span>Cap variable</span><strong>16415</strong></div>
            <div><span>Default</span><strong>100</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-level-caps-btn" type="button" ${levelCapsStatus.compatible ? "" : "disabled"}>
              ${levelCapsStatus.installed ? "Reinstall Hard Level Caps" : "Install Hard Level Caps"}
            </button>
            <div class="code-injection-note" id="level-caps-note" aria-live="polite"></div>
            <div class="code-injection-credits">Adapted from PW2Code by Dararo.</div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(doubleBattleFixStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Single-NPC Double Battle Fix</h2>
              <p>${
                doubleBattleFixStatus !== "unsupported"
                  ? "Fixes common-script trainers changed from Singles to Doubles. Available for US Black 1 and Black 2 / White 2. PMC is installed automatically if needed."
                  : "A White 1 build of this patch is not bundled yet."
              }</p>
            </div>
            ${renderInlineStatus(doubleBattleFixStatus === "patched" ? "Installed" : doubleBattleFixStatus === "unsupported" ? "Unsupported" : "Not Installed", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-double-battle-fix-btn" type="button" ${doubleBattleFixSupported ? "" : "disabled"} title="Install the bundled double battle fix and any missing dependencies.">
              Install Double Battle Fix
            </button>
            <div class="code-injection-note" id="double-battle-fix-note" aria-live="polite"></div>
          </div>
          <div class="code-injection-credits" aria-label="Double Battle Fix credits">
            <span>Implementation credits</span>
            <strong>Sunk</strong>
            <strong>Papaya</strong>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(tagBattleStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Tag Battle Stabilization</h2>
              <p>Allows tag battles with more than the vanilla limit of six opposing Pokemon, such as two opponents with four Pokemon each. Runs one trainer's AI at a time to reduce script memory use and prevent the related battle-start hang.</p>
            </div>
            ${renderInlineStatus(!tagBattleStatus.supported ? "Unsupported" : !tagBattleStatus.compatible ? "Incompatible" : tagBattleStatus.installed ? "Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Supported ROM</span><strong>US White 2</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <p>Configure each trainer's team in the Trainer editor. This patch does not change team sizes.</p>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-tag-battle-stabilization-btn" type="button" ${tagBattleCanInstall ? "" : "disabled"}>
              Install Tag Battle Stabilization
            </button>
            <button class="btn -default" id="uninstall-tag-battle-stabilization-btn" type="button" ${tagBattleStatus.canUninstall ? "" : "disabled"}
              title="${tagBattleStatus.installed && !tagBattleStatus.canUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : "Remove the staged Tag Battle Stabilization DLL."}">
              Uninstall Tag Battle Stabilization
            </button>
            <div class="code-injection-note" id="tag-battle-stabilization-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(quickActionsStatus.supported)}>
          <div class="code-injection-panel__header"><div>
            <h2>C-Gear Quick Actions</h2>
            <a class="btn -primary" href="#cgearButtons" data-route="cgearButtons">Configure Buttons</a>
            <p>REPEL, PC, BIKE, MAP, PARTY and BAG touch shortcuts, with up to eight editable buttons. Available after obtaining C-Gear, including with wireless off. Use the wrench to rearrange them. ${project.session.baseRom==="BW"?"Tap the upper-right button to browse native backgrounds.":"Drag the outer rim to browse skins: clockwise next, counterclockwise previous, every 12°."}</p>
          </div>${renderInlineStatus(!quickActionsStatus.supported ? "Unsupported" : !quickActionsStatus.compatible ? "Incompatible" : quickActionsStatus.enabled ? "Enabled" : quickActionsStatus.installed ? "Disabled" : "Ready", { className: "code-injection-status" })}</div>
          <div class="code-injection-facts"><div><span>Games</span><strong>English Black / White / Black 2 / White 2</strong></div>
            <div><span>Dependency</span><strong>PMC only</strong></div><div><span>Release</span><strong>${escapeHtml(project.session.baseRom==="BW"?CGEAR_QUICK_ACTIONS_BW1_VERSION:CGEAR_QUICK_ACTIONS_VERSION)} development</strong></div></div>
          <img src="${project.session.baseRom==="BW"?new URL("../assets/codeinjection/cgearQuickActionsBw1Preview.png", import.meta.url).href:new URL("../assets/codeinjection/cgearQuickActionsPreview.png", import.meta.url).href}" alt="Editable C-Gear action button layout." width="256" height="192" style="max-width:100%;width:384px;height:auto;image-rendering:pixelated" />
          <p>${escapeHtml(quickActionsStatus.message)}</p>
          <p>Configure up to eight buttons, their labels, colors, starting positions, native key-item actions, and optional save-flag visibility. Changes are applied together from the button editor.</p>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-cgear-quick-actions-btn" type="button" ${quickActionsStatus.compatible ? "" : "disabled"}>${quickActionsStatus.installed ? "Update / Enable" : "Install"}</button>
            <button class="btn -default" id="disable-cgear-quick-actions-btn" type="button" ${quickActionsStatus.compatible && quickActionsStatus.enabled ? "" : "disabled"}>Disable</button>
            <button class="btn -default" id="remove-cgear-quick-actions-btn" type="button" ${quickActionsStatus.canRemove ? "" : "disabled"} title="Exported installations can be disabled; only newly staged modules can be removed.">Remove staged patch</button>
            <div class="code-injection-note" id="cgear-quick-actions-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(pokenavStatus.supported)}>
          <div class="code-injection-panel__header"><div><h2>Pokenav</h2>
            <p>Browse the current area's seasonal Surf, Rod, and Grass encounters from a custom C-Gear button. The top screen shows species information and the selected Pokémon's combined encounter chance. All species are revealed.</p></div>
            ${renderInlineStatus(pokenavStatus.updateAvailable ? "Update Available" : pokenavStatus.enabled ? "Enabled" : pokenavStatus.installed ? "Disabled" : pokenavStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <p>${escapeHtml(pokenavStatus.message)}</p>
          <div class="code-injection-actions">
            <a class="btn -default" href="#cgearButtons" data-route="cgearButtons">Configure Buttons</a>
            <button class="btn -primary" id="install-pokenav-btn" type="button" ${pokenavStatus.compatible ? "" : "disabled"}>${pokenavStatus.updateAvailable ? "Update" : pokenavStatus.installed ? "Enable / Reinstall" : "Install"}</button>
            <button class="btn -default" id="disable-pokenav-btn" type="button" ${pokenavStatus.compatible && pokenavStatus.enabled ? "" : "disabled"}>Disable</button>
            <div class="code-injection-note" id="pokenav-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(nuzlockeStatus.supported)}>
          <div class="code-injection-panel__header"><div><h2>Nuzlocke Style Encounters</h2>
            <p>Exclude evolution families already registered as caught, including released Pokémon. Remaining slots keep their relative chances. Pokenav shows dupes in gray and adjusts its displayed percentages; Pokenav is optional.</p></div>
            ${renderInlineStatus(nuzlockeStatus.updateAvailable ? "Update Available" : nuzlockeStatus.enabled && nuzlockeStatus.installed ? "Enabled" : nuzlockeStatus.installed ? "Disabled" : nuzlockeStatus.compatible ? "Ready" : "Incompatible", { className: "code-injection-status" })}
          </div>
          <p>${escapeHtml(nuzlockeStatus.message)}</p>
          <label>If every slot is a dupe <select id="nuzlocke-exhausted-select" ${nuzlockeStatus.supported ? "" : "disabled"}>
            <option value="allow" ${nuzlockeStatus.allowExhausted ? "selected" : ""}>Allow the original encounters</option>
            <option value="prevent" ${!nuzlockeStatus.allowExhausted ? "selected" : ""}>Prevent encounters for that method</option>
          </select></label>
          <p>Settings apply with Install / Update. Export and cold boot the ROM to use them. Static, roaming and scripted Pokémon retain their existing rules.</p>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-nuzlocke-encounters-btn" type="button" ${nuzlockeStatus.compatible ? "" : "disabled"}>${nuzlockeStatus.updateAvailable ? "Update" : nuzlockeStatus.installed ? "Enable / Reinstall" : "Install"}</button>
            <button class="btn -default" id="disable-nuzlocke-encounters-btn" type="button" ${nuzlockeStatus.compatible && nuzlockeStatus.enabled && nuzlockeStatus.installed ? "" : "disabled"}>Disable</button>
            <div class="code-injection-note" id="nuzlocke-encounters-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(portaPcStatus.supported)}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Porta PC</h2>
              <p>Press Start while exploring to open the in-game PC and access your Pokemon boxes. Supports grid and rail maps, including Castelia City. Uses the normal PC menu and gives other field events priority.</p>
            </div>
            ${renderInlineStatus(!portaPcStatus.supported ? "Unsupported" : !portaPcStatus.compatible ? "Incompatible" : portaPcStatus.updateAvailable ? "Update Available" : portaPcStatus.installed ? "Installed" : "Ready", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Button</span><strong>Start</strong></div>
            <div><span>Supported ROMs</span><strong>US Black 2 / White 2</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-porta-pc-btn" type="button" ${portaPcCanInstall ? "" : "disabled"}>
              ${portaPcStatus.updateAvailable ? "Update Porta PC" : "Install Porta PC"}
            </button>
            <button class="btn -default" id="uninstall-porta-pc-btn" type="button" ${portaPcStatus.canUninstall ? "" : "disabled"}
              title="${portaPcStatus.installed && !portaPcStatus.canUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : "Remove the staged Porta PC DLL."}">
              Uninstall Porta PC
            </button>
            <div class="code-injection-note" id="porta-pc-note" aria-live="polite"></div>
          </div>
        </section>
        <section class="code-injection-panel" ${patchVisibility(formEvolutionStatus !== "unsupported")}>
          <div class="code-injection-panel__header">
            <div>
              <h2>Added-Form Evolution Support</h2>
              <p>Allows evolution NARC targets to reference appended personal-form IDs while storing the evolved Pokemon as a safe base species and form.</p>
            </div>
            ${renderInlineStatus(formEvolutionInstalled ? "Installed" : formEvolutionStatus === "unsupported" ? "Unsupported" : "Not Installed", { className: "code-injection-status" })}
          </div>
          <div class="code-injection-facts">
            <div><span>Runtime</span><strong>${formEvolutionStatus === "unsupported" ? "B2/W2 only" : `FormEvolution${escapeHtml(project.session.baseVersion)}.dll`}</strong></div>
            <div><span>Module Path</span><strong>${formEvolutionInstalled ? `patches/FormEvolution${escapeHtml(project.session.baseVersion)}.dll` : "Pending"}</strong></div>
            <div><span>Installation</span><strong>Installer or Add Form</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Will Install"}</strong></div>
          </div>
          <div class="code-injection-note">
            ${
              formEvolutionInstalled
                ? "The bundled form-evolution DLL is active in this project and will be included in the exported ROM."
                : formEvolutionStatus === "unsupported"
                  ? "The bundled form-evolution runtime currently supports Black 2 and White 2."
                  : "Install here or use Add Form in the Pokemon editor. PMC is installed automatically if needed."
            }
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-form-evolution-btn" type="button" ${formEvolutionStatus === "unpatched" ? "" : "disabled"}>${formEvolutionInstalled ? "Installed" : "Install Added-Form Evolution Support"}</button>
            <div class="code-injection-note" id="form-evolution-note" aria-live="polite"></div>
          </div>
        </section>
        </section>
        <section class="code-injection-tab-panel" id="code-injection-panel-debug-helpers" role="tabpanel" aria-labelledby="code-injection-tab-debug-helpers" tabindex="0" ${activeTab === "debug-helpers" ? "" : "hidden"}>
          ${testingPatchCard("walk-through-walls")}
          ${testingPatchCard("instant-victory")}
        </section>
      </main>
    </section>
  `;

  root.querySelectorAll<HTMLElement>(".code-injection-tab-panel").forEach(panel => {
    panel.insertAdjacentHTML("beforeend", emptyCategoryMessage);
  });
  const applyPatchVisibility = (show: boolean): void => {
    root.querySelectorAll<HTMLElement>("[data-code-injection-supported]").forEach(card => {
      card.hidden = !show && card.dataset.codeInjectionSupported === "false";
    });
    root.querySelectorAll<HTMLElement>(".code-injection-tab-panel").forEach(panel => {
      const message = panel.querySelector<HTMLElement>("[data-code-injection-empty]");
      if (message) {
        message.hidden = Array.from(panel.querySelectorAll<HTMLElement>("[data-code-injection-supported]"))
          .some(card => !card.hidden);
      }
    });
  };
  applyPatchVisibility(showUnsupported);
  const unsupportedToggle = root.querySelector<HTMLInputElement>("#show-unsupported-patches");
  unsupportedToggle?.addEventListener("change", () => {
    showUnsupportedCodeInjectionPatches.set(project, unsupportedToggle.checked);
    applyPatchVisibility(unsupportedToggle.checked);
  });

  const tabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-code-injection-tab]"));
  const selectTab = (tab: CodeInjectionTab, focus = false): void => {
    activeCodeInjectionTabs.set(root, tab);
    for (const button of tabButtons) {
      const selected = button.dataset.codeInjectionTab === tab;
      button.classList.toggle("-active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    root.querySelectorAll<HTMLElement>(".code-injection-tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== `code-injection-panel-${tab}`;
    });
  };
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectTab(codeInjectionTabs[index].id));
    button.addEventListener("keydown", (event) => {
      let nextIndex: number;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabButtons.length - 1;
      else return;
      event.preventDefault();
      selectTab(codeInjectionTabs[nextIndex].id, true);
    });
  });

  const button = root.querySelector<HTMLButtonElement>("#install-pmc-btn");
  const note = root.querySelector<HTMLDivElement>("#pmc-install-note");
  button?.addEventListener("click", async () => {
    const previousText = button.textContent ?? "Install PMC";
    try {
      if (status.installed) {
        const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
        if (!romBytes) throw new Error("Reload the ROM before updating PMC.");
        const confirmation = getPmcUpdateConfirmationMessage(project, romBytes);
        if (confirmation && !window.confirm(confirmation)) {
          if (note) note.textContent = "PMC update cancelled; the existing installation was left unchanged.";
          return;
        }
      }
      button.disabled = true;
      button.textContent = "Installing...";
      if (note) note.textContent = "Installing the runtime and preparing patch folders...";
      const result = await installBundledPmc(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pmc-install-note");
      if (refreshedNote) refreshedNote.textContent = `PMC ${result.version ?? "runtime"} installed.`;
    } catch (error) {
      button.disabled = false;
      button.textContent = previousText;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const weatherRuntimeButton = root.querySelector<HTMLButtonElement>("#install-weather-runtime-btn");
  const weatherRuntimeNote = root.querySelector<HTMLDivElement>("#weather-runtime-note");
  weatherRuntimeButton?.addEventListener("click", async () => {
    const previousText = weatherRuntimeButton.textContent ?? "Install Weather Runtime";
    try {
      weatherRuntimeButton.disabled = true;
      weatherRuntimeButton.textContent = "Installing...";
      if (weatherRuntimeNote) weatherRuntimeNote.textContent = status.installed ? "Staging the weather DLL and PWTH registry." : "Installing PMC, then staging the weather DLL and PWTH registry.";
      const result = await install(candidate => installBundledOverworldWeatherRuntime(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#weather-runtime-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}. The 49 PWTH slots are ready for data-driven clones from Weather Graphics.`;
    } catch (error) {
      weatherRuntimeButton.disabled = false;
      weatherRuntimeButton.textContent = previousText;
      if (weatherRuntimeNote) weatherRuntimeNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const pwanButton = root.querySelector<HTMLButtonElement>("#install-pwan-runtime-btn");
  const pwanNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note");
  pwanButton?.addEventListener("click", async () => {
    const previousText = pwanButton.textContent ?? "Install PWAN GIF Support";
    try {
      const compatibility = detectPwanRuntimeCompatibility(project);
      if (!compatibility.compatible) {
        if (pwanNote) pwanNote.textContent = pwanCompatibilityFailureSummary(compatibility);
        return;
      }
      pwanButton.disabled = true;
      pwanButton.textContent = "Installing...";
      if (pwanNote) {
        pwanNote.textContent = status.installed ? "Staging the bundled PWAN runtime DLLs." : "Installing PMC and staging the bundled PWAN runtime DLLs.";
      }
      await install(candidate => installPwanRuntime(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note");
      if (refreshedNote) {
        refreshedNote.textContent = project.session.baseVersion === "B2"
          ? "Black 2 split PWAN support is staged. Export the ROM to include the runtimes and PWAN archive."
          : "White 2 split PWAN support is staged. Export the ROM to include the runtimes and PWAN archive.";
      }
    } catch (error) {
      pwanButton.disabled = false;
      pwanButton.textContent = previousText;
      if (pwanNote) pwanNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallPwanButton = root.querySelector<HTMLButtonElement>("#uninstall-pwan-runtime-btn");
  uninstallPwanButton?.addEventListener("click", () => {
    try {
      uninstallPwanButton.disabled = true;
      uninstallPwanRuntime(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note");
      if (refreshedNote) refreshedNote.textContent = "PWAN runtime DLLs removed. Imported PWAN assets remain in the project for later reinstallation.";
    } catch (error) {
      uninstallPwanButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#pwan-runtime-note") ?? pwanNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const trainerPwanButton = root.querySelector<HTMLButtonElement>("#install-trainer-pwan-runtime-btn");
  const trainerPwanNote = root.querySelector<HTMLDivElement>("#trainer-pwan-runtime-note");
  trainerPwanButton?.addEventListener("click", async () => {
    const previousText = trainerPwanButton.textContent ?? "Install Trainer PWAN Support";
    try {
      trainerPwanButton.disabled = true;
      trainerPwanButton.textContent = "Installing...";
      if (trainerPwanNote) trainerPwanNote.textContent = "Installing PMC if needed and staging the trainer PWAN runtime.";
      await install(candidate => installTrainerPwanRuntime(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      trainerPwanButton.disabled = false;
      trainerPwanButton.textContent = previousText;
      if (trainerPwanNote) trainerPwanNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  root.querySelector<HTMLButtonElement>("#uninstall-trainer-pwan-runtime-btn")?.addEventListener("click", () => {
    try {
      uninstallTrainerPwanRuntime(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (trainerPwanNote) trainerPwanNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const doubleBattleButton = root.querySelector<HTMLButtonElement>("#install-double-battle-fix-btn");
  const doubleBattleNote = root.querySelector<HTMLDivElement>("#double-battle-fix-note");
  doubleBattleButton?.addEventListener("click", async () => {
    const previousText = doubleBattleButton.textContent ?? "Install Double Battle Fix";
    try {
      doubleBattleButton.disabled = true;
      doubleBattleButton.textContent = "Installing...";
      if (doubleBattleNote) doubleBattleNote.textContent = "Loading and staging the bundled double battle patch DLL.";
      const result = await install(candidate => stageBundledDoubleBattleFixDll(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#double-battle-fix-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}.`;
    } catch (error) {
      doubleBattleButton.disabled = false;
      doubleBattleButton.textContent = previousText;
      if (doubleBattleNote) doubleBattleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#install-form-evolution-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await install(candidate => prepareBw2FormEvolutionCodeInjection(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      button.disabled = false;
      const note = root.querySelector("#form-evolution-note");
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  for (const id of Object.keys(TESTING_PATCHES) as TestingPatchId[]) {
    const button = root.querySelector<HTMLButtonElement>(`#install-${id}-btn`);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
      if (note) note.textContent = "Checking compatibility and installing...";
      try {
        await install(candidate => installTestingPatch(candidate, id));
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    root.querySelector<HTMLButtonElement>(`#uninstall-${id}-btn`)?.addEventListener("click", () => {
      try {
        uninstallTestingPatch(project, id);
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }

  const bgmToggleButton = root.querySelector<HTMLButtonElement>("#install-bgm-toggle-btn");
  const bgmToggleNote = root.querySelector<HTMLDivElement>("#bgm-toggle-note");
  bgmToggleButton?.addEventListener("click", async () => {
    const previousText = bgmToggleButton.textContent ?? "Install Music Toggle";
    try {
      bgmToggleButton.disabled = true;
      bgmToggleButton.textContent = "Installing...";
      if (bgmToggleNote) bgmToggleNote.textContent = status.installed ? "Staging the background-music toggle DLL." : "Installing PMC, then staging the background-music toggle DLL.";
      const result = await install(candidate => installBundledBgmToggleDll(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#bgm-toggle-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}. Press L + R + Select in-game to mute or unmute BGM.`;
    } catch (error) {
      bgmToggleButton.disabled = false;
      bgmToggleButton.textContent = previousText;
      if (bgmToggleNote) bgmToggleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const infiniteCandyButton = root.querySelector<HTMLButtonElement>("#install-infinite-candy-btn");
  infiniteCandyButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#infinite-candy-note");
    infiniteCandyButton.disabled = true;
    if (note) note.textContent = "Checking item 622 and installing the patch...";
    try {
      await install(candidate => installInfiniteCandy(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      infiniteCandyButton.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const levelCapsButton = root.querySelector<HTMLButtonElement>("#install-level-caps-btn");
  levelCapsButton?.addEventListener("click", async () => {
    const note = root.querySelector<HTMLDivElement>("#level-caps-note");
    levelCapsButton.disabled = true;
    if (note) note.textContent = "Checking battle, Day Care, and item hooks...";
    try {
      await install(candidate => installLevelCaps(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      levelCapsButton.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const tagBattleButton = root.querySelector<HTMLButtonElement>("#install-tag-battle-stabilization-btn");
  const tagBattleNote = root.querySelector<HTMLDivElement>("#tag-battle-stabilization-note");
  tagBattleButton?.addEventListener("click", async () => {
    try {
      tagBattleButton.disabled = true;
      tagBattleButton.textContent = "Installing...";
      if (tagBattleNote) tagBattleNote.textContent = "Checking battle AI compatibility and installing Tag Battle Stabilization.";
      await install(candidate => installTagBattleStabilization(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#tag-battle-stabilization-note");
      if (refreshedNote) refreshedNote.textContent = "Tag Battle Stabilization is staged. Export the ROM to apply it.";
    } catch (error) {
      tagBattleButton.disabled = false;
      tagBattleButton.textContent = "Install Tag Battle Stabilization";
      if (tagBattleNote) tagBattleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallTagBattleButton = root.querySelector<HTMLButtonElement>("#uninstall-tag-battle-stabilization-btn");
  uninstallTagBattleButton?.addEventListener("click", () => {
    try {
      uninstallTagBattleStabilization(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (tagBattleNote) tagBattleNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  for (const [id, action] of [
    ["install", () => install(candidate => installCGearQuickActions(candidate))],
    ["disable", () => disableCGearQuickActions(project)],
    ["remove", () => removeCGearQuickActions(project)],
  ] as const) {
    root.querySelector<HTMLButtonElement>(`#${id}-cgear-quick-actions-btn`)?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;button.disabled = true;
      const note = root.querySelector<HTMLDivElement>("#cgear-quick-actions-note");
      try {
        if (note) note.textContent = "Checking and staging Quick Actions changes…";
        await action();onDirty();renderCodeInjectionEditor(project, root, onDirty);
        const updated = root.querySelector<HTMLDivElement>("#cgear-quick-actions-note");
        if (updated) updated.textContent = "Changes staged. Export a new ROM to use them.";
      } catch (error) {
        button.disabled = false;if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  for (const [id, action] of [["install", installPokenav], ["disable", disablePokenav]] as const) {
    root.querySelector<HTMLButtonElement>(`#${id}-pokenav-btn`)?.addEventListener("click", async event => {
      const button = event.currentTarget as HTMLButtonElement, note = root.querySelector<HTMLDivElement>("#pokenav-note"); button.disabled = true;
      try { if (note) note.textContent = "Checking and staging Pokenav…"; await action(project); onDirty(); renderCodeInjectionEditor(project, root, onDirty); }
      catch (error) { button.disabled = false; if (note) note.textContent = error instanceof Error ? error.message : String(error); }
    });
  }
  for(const id of ["install","disable"] as const){
    root.querySelector<HTMLButtonElement>(`#${id}-nuzlocke-encounters-btn`)?.addEventListener("click",async()=>{
      const note=root.querySelector<HTMLElement>("#nuzlocke-encounters-note");
      try{
        if(note)note.textContent="Checking and staging Nuzlocke Style Encounters…";
        if(id==="install")await installNuzlockeEncounters(project,{allowExhausted:root.querySelector<HTMLSelectElement>("#nuzlocke-exhausted-select")?.value!=="prevent"});
        else await disableNuzlockeEncounters(project);
        onDirty();renderCodeInjectionEditor(project,root,onDirty);
      }catch(error){if(note)note.textContent=error instanceof Error?error.message:String(error);}
    });
  }
  const portaPcButton = root.querySelector<HTMLButtonElement>("#install-porta-pc-btn");
  const portaPcNote = root.querySelector<HTMLDivElement>("#porta-pc-note");
  portaPcButton?.addEventListener("click", async () => {
    const previousText = portaPcButton.textContent;
    try {
      portaPcButton.disabled = true;
      portaPcButton.textContent = "Installing...";
      if (portaPcNote) portaPcNote.textContent = "Checking field compatibility and installing Porta PC.";
      await install(candidate => installPortaPc(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#porta-pc-note");
      if (refreshedNote) refreshedNote.textContent = "Porta PC is staged. Export the ROM, then press Start while exploring to use the PC.";
    } catch (error) {
      portaPcButton.disabled = false;
      portaPcButton.textContent = previousText;
      if (portaPcNote) portaPcNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#uninstall-porta-pc-btn")?.addEventListener("click", () => {
    try {
      uninstallPortaPc(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
    } catch (error) {
      if (portaPcNote) portaPcNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const battleLogButton = root.querySelector<HTMLButtonElement>("#install-battle-log-btn");
  const battleLogNote = root.querySelector<HTMLDivElement>("#battle-log-note");
  battleLogButton?.addEventListener("click", async () => {
    const previousText = battleLogButton.textContent ?? "Install Battle Log";
    const updating = battleLogStatus.updateAvailable;
    const refreshMenuEvolution = updating && menuEvolutionStatus.installed;
    try {
      battleLogButton.disabled = true;
      battleLogButton.textContent = updating ? "Updating..." : "Installing...";
      if (battleLogNote) {
        battleLogNote.textContent = `${updating ? "Updating" : "Installing"} the split battle-log runtimes, checking ROM hooks, retiring Pal Pad save handling, and generating species ancestry.`;
      }
      const result = await install(async candidate => {
        const result = await installBattleLog(candidate);
        if (refreshMenuEvolution) await installMenuEvolution(candidate);
        return result;
      });
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#battle-log-note");
      if (refreshedNote) {
        refreshedNote.textContent = `Battle log ${updating ? "updated" : "staged"} at ${result.dllPath}, ${result.counterDllPath}, and ${result.summaryDllPath}; ancestry was generated from ${result.evolutionMembers} evolution records.${refreshMenuEvolution ? ` The installed ${MENU_EVOLUTION_TITLE} companion was refreshed for immediate KO events and KO moves.` : ""}`;
      }
    } catch (error) {
      const currentButton = root.querySelector<HTMLButtonElement>("#install-battle-log-btn") ?? battleLogButton;
      const currentNote = root.querySelector<HTMLDivElement>("#battle-log-note") ?? battleLogNote;
      currentButton.disabled = false;
      currentButton.textContent = previousText;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallBattleLogButton = root.querySelector<HTMLButtonElement>("#uninstall-battle-log-btn");
  uninstallBattleLogButton?.addEventListener("click", () => {
    try {
      uninstallBattleLogButton.disabled = true;
      uninstallBattleLog(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#battle-log-note");
      if (refreshedNote) {
        refreshedNote.textContent = "Battle-log DLLs removed and normal Pal Pad/Wi-Fi save handling restored. Existing battle-log save records remain untouched.";
      }
    } catch (error) {
      uninstallBattleLogButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#battle-log-note") ?? battleLogNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#install-party-tools-btn")?.addEventListener("click", async () => {
    const button = root.querySelector<HTMLButtonElement>("#install-party-tools-btn")!;
    button.disabled = true;
    try {
      const hideFlag = parsePartyToolbarHideFlag(root.querySelector<HTMLInputElement>("#party-tools-hide-flag")?.value ?? "", project.session.baseVersion);
      const sectionHideFlags = Object.fromEntries(PARTY_TOOLBAR_SECTIONS.map(({ id, label }) => {
        try { return [id, parsePartyToolbarHideFlag(root.querySelector<HTMLInputElement>(`#party-tools-${id}-hide-flag`)?.value ?? "", project.session.baseVersion)]; }
        catch (error) { throw new Error(`${label}: ${(error as Error).message}`); }
      }));
      await install(candidate => installPartyQuickActions(candidate, { hideFlag, sectionHideFlags })); onDirty(); renderCodeInjectionEditor(project, root, onDirty);
    }
    catch (error) { button.disabled = false; const note = root.querySelector("#party-tools-status"); if (note) note.textContent = error instanceof Error ? error.message : String(error); }
  });
  root.querySelector<HTMLButtonElement>("#disable-party-tools-btn")?.addEventListener("click", () => {
    try { disablePartyQuickActions(project); onDirty(); renderCodeInjectionEditor(project, root, onDirty); }
    catch (error) { const note = root.querySelector("#party-tools-status"); if (note) note.textContent = error instanceof Error ? error.message : String(error); }
  });

  const menuEvolutionButton = root.querySelector<HTMLButtonElement>("#install-menu-evolution-btn");
  const menuEvolutionNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
  menuEvolutionButton?.addEventListener("click", async () => {
    const previousText = menuEvolutionButton.textContent ?? "Install";
    try {
      menuEvolutionButton.disabled = true;
      menuEvolutionButton.textContent = "Installing...";
      if (menuEvolutionNote) {
        menuEvolutionNote.textContent = "Checking hooks, installing required dependencies, and configuring EVOLVE and RELEARN.";
      }
      const result = await install(candidate => installMenuEvolution(candidate));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
      if (refreshedNote) {
        refreshedNote.textContent = `${MENU_EVOLUTION_TITLE} staged at ${result.dllPath} using message bank ${result.messageBankId}, EVOLVE entry ${result.messageEntryId} and RELEARN entry ${result.relearnMessageEntryId}; ${result.koLearnsetMembers} KO learnset members are available at ${result.koLearnsetPath}.`;
      }
    } catch (error) {
      const currentButton = root.querySelector<HTMLButtonElement>("#install-menu-evolution-btn") ?? menuEvolutionButton;
      const currentNote = root.querySelector<HTMLDivElement>("#menu-evolution-note") ?? menuEvolutionNote;
      currentButton.disabled = false;
      currentButton.textContent = previousText;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const uninstallMenuEvolutionButton = root.querySelector<HTMLButtonElement>("#uninstall-menu-evolution-btn");
  uninstallMenuEvolutionButton?.addEventListener("click", () => {
    try {
      uninstallMenuEvolutionButton.disabled = true;
      uninstallMenuEvolution(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
      if (refreshedNote) {
        refreshedNote.textContent = `${MENU_EVOLUTION_TITLE} removed. The EVOLVE and RELEARN text entries remain available for a later reinstall.`;
      }
    } catch (error) {
      uninstallMenuEvolutionButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#menu-evolution-note") ?? menuEvolutionNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const input = root.querySelector<HTMLInputElement>("#code-injection-dll-input");
  for (const [id, installAction, uninstall] of [
    ["battle-hud", installBattleTypeHud, uninstallBattleTypeHud],
    ["move-effectiveness", installMoveEffectiveness, uninstallMoveEffectiveness],
  ] as const) {
    for (const [verb, action] of [["install", installAction], ["uninstall", uninstall]] as const) {
      const button = root.querySelector<HTMLButtonElement>(`#${verb}-${id}-btn`);
      button?.addEventListener("click", async () => {
        const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
        button.disabled = true;
        if (note) note.textContent = "Checking and updating the patch...";
        try {
          if (id === "move-effectiveness" && verb === "install") {
            const colors = Object.fromEntries([...root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]")]
              .map(input => [input.dataset.moveHighlightColor!, input.value])) as MoveHighlightColors;
            await install(candidate => installMoveEffectiveness(candidate, colors));
          } else if (id === "battle-hud" && verb === "install") {
            const variant = (root.querySelector<HTMLSelectElement>("#type-icon-variant")?.value ?? "letters") as TypeIconVariant;
            await install(candidate => installBattleTypeHud(candidate, variant));
          } else await action(project);
          onDirty(); renderCodeInjectionEditor(project, root, onDirty);
        }
        catch (error) { button.disabled = false; if (note) note.textContent = error instanceof Error ? error.message : String(error); }
      });
    }
  }
  const typeIconVariant = root.querySelector<HTMLSelectElement>("#type-icon-variant");
  const updateTypeIconPreviewSelection = () => {
    const selected = (typeIconVariant?.value ?? "letters") as TypeIconVariant;
    root.querySelectorAll<HTMLElement>("[data-type-icon-variant-card]").forEach(card => {
      card.classList.toggle("is-selected", card.dataset.typeIconVariantCard === selected);
    });
  };
  typeIconVariant?.addEventListener("change", updateTypeIconPreviewSelection);
  updateTypeIconPreviewSelection();
  root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]").forEach(input => {
    input.addEventListener("input", () => {
      const sample = root.querySelector<HTMLElement>(`[data-move-highlight-sample="${input.dataset.moveHighlightColor}"]`);
      if (sample) sample.style.color = input.value;
    });
  });
  root.querySelector<HTMLButtonElement>("#reset-move-highlight-colors")?.addEventListener("click", () => {
    root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]").forEach(input => {
      input.value = DEFAULT_MOVE_HIGHLIGHT_COLORS[input.dataset.moveHighlightColor as keyof MoveHighlightColors];
      input.dispatchEvent(new Event("input"));
    });
  });
  for (const [selector, action] of [
    ["#install-learnset-viewer-btn", () => install(candidate => installLearnsetViewer(candidate))],
    ["#uninstall-learnset-viewer-btn", () => uninstallLearnsetViewer(project)],
  ] as const) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLDivElement>("#learnset-viewer-note");
      if (note) note.textContent = "Checking and updating the LEARNSET companions...";
      try {
        await action();
        onDirty();
        renderCodeInjectionEditor(project, root, onDirty);
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  const dllNote = root.querySelector<HTMLDivElement>("#dll-install-note");
  root.querySelector<HTMLButtonElement>("#install-save-menu-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const note = root.querySelector<HTMLElement>("#save-menu-note");
    button.disabled = true;
    if (note) note.textContent = "Checking menu compatibility and staging the save menu…";
    try {
      const song = root.querySelector<HTMLSelectElement>("#save-menu-song")?.value ?? "relic-song";
      const settings: SaveMenuSettings = {
        music: song.startsWith("stream:") ? "stream" : song === "off" ? "off" : "relic-song",
        ...(song.startsWith("stream:") ? { streamId: Number(song.slice(7)) } : {}),
        bpm: Number(root.querySelector<HTMLInputElement>("#save-menu-bpm")?.value ?? 150),
        stepsPerBeat: Number(root.querySelector<HTMLSelectElement>("#save-menu-steps-per-beat")?.value ?? 2) as 1 | 2 | 4,
        versionLabel: root.querySelector<HTMLInputElement>("#save-menu-version-label")?.value.trim() ?? "",
      };
      await install(candidate => installSaveMenu(candidate, settings)); onDirty(); renderCodeInjectionEditor(project, root, onDirty);
      const updated = root.querySelector<HTMLElement>("#save-menu-note");
      if (updated) updated.textContent = "Save menu staged. Export the ROM to use it.";
    } catch (error) {
      button.disabled = false;
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  for (const [selector, action] of [
    ["#install-summary-stat-btn", () => install(candidate => installSummaryStatViewer(candidate, { includeEvs: root.querySelector<HTMLInputElement>("#summary-stat-evs")?.checked ?? true }))],
    ["#uninstall-summary-stat-btn", () => uninstallSummaryStatViewer(project)],
  ] as const) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLElement>("#summary-stat-note");
      if (note) note.textContent = "Checking Summary compatibility and staging changes…";
      try {
        await action(); onDirty(); renderCodeInjectionEditor(project, root, onDirty);
        const updated = root.querySelector<HTMLElement>("#summary-stat-note");
        if (updated) updated.textContent = "Changes staged. Export the ROM to use them.";
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  let selectedTarget: CodeInjectionDllTarget = "patches";
  for (const [selector, action] of [
    ["#install-summary-types-btn", () => install(candidate => installSummaryTypeIcons(candidate))],
    ["#uninstall-summary-types-btn", () => uninstallSummaryTypeIcons(project)],
  ] as const) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    button?.addEventListener("click", async () => {
      button.disabled = true;
      const note = root.querySelector<HTMLElement>("#summary-types-note");
      if (note) note.textContent = "Checking Summary compatibility and staging type icons…";
      try {
        await action(); onDirty(); renderCodeInjectionEditor(project, root, onDirty);
        const updated = root.querySelector<HTMLElement>("#summary-types-note");
        if (updated) updated.textContent = "Changes staged. Export the ROM to use them.";
      } catch (error) {
        button.disabled = false;
        if (note) note.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  }
  root.querySelectorAll<HTMLButtonElement>("[data-dll-target]").forEach((targetButton) => {
    targetButton.addEventListener("click", () => {
      selectedTarget = targetButton.dataset.dllTarget === "lib" ? "lib" : "patches";
      if (input) {
        input.value = "";
        input.click();
      }
    });
  });
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await install(candidate => stageCodeInjectionDll(candidate, file.name, bytes, selectedTarget));
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#dll-install-note");
      if (refreshedNote) refreshedNote.textContent = `${result.fileName} staged at ${result.path}.`;
    } catch (error) {
      if (dllNote) dllNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

function renderPwanCompatibilityDetails(project: ProjectState, report: PwanCompatibilityReport): string {
  if (report.compatible) {
    return `<div class="code-injection-compat-ok">All ${report.passed} PWAN hook regions match the stock ${project.session.baseVersion === "B2" ? "Black 2" : "White 2"} snapshot.</div>`;
  }
  return `
    <div class="code-injection-compat-list" aria-label="PWAN compatibility failures">
      ${report.checks
        .filter((check) => check.status !== "matched")
        .map(renderPwanCompatibilityRow)
        .join("")}
    </div>
  `;
}

function renderPwanCompatibilityRow(check: PwanCompatibilityCheck): string {
  const address = check.address > 0 ? `0x${check.address.toString(16).padStart(8, "0")}` : "ROM";
  const moduleLabel = check.module === "arm9" ? "ARM9" : `Overlay ${check.overlayId}`;
  return `
    <div class="code-injection-compat-item -${check.status}">
      <div>
        <strong>${escapeHtml(check.group)} / ${escapeHtml(check.label)}</strong>
        <span>${escapeHtml(moduleLabel)} at ${escapeHtml(address)}</span>
      </div>
      <em>${escapeHtml(check.status)}</em>
      <p>${escapeHtml(check.message)}</p>
    </div>
  `;
}

async function hydrateRomBytesForCodeInjection(project: ProjectState, root: HTMLElement, onDirty: () => void): Promise<void> {
  codeInjectionHydrationProjects.add(project);
  try {
    const bytes = await loadActiveRomBytes();
    if (!bytes || project.originalRomBytes) return;
    project.originalRomBytes = bytes;
    if (root.isConnected) renderCodeInjectionEditor(project, root, onDirty);
  } catch {
    // The page can still report the missing regions; export/install paths will surface storage errors separately.
  } finally {
    codeInjectionHydrationProjects.delete(project);
  }
}
