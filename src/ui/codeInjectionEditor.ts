import {
  detectBundledFormEvolutionDll,
  detectBundledDoubleBattleFixDll,
  detectBundledOverworldWeatherRuntime,
  getPmcInstallStatus,
  getPmcUpdateConfirmationMessage,
  installBundledOverworldWeatherRuntime,
  installBundledPmc,
  listCodeInjectionDlls,
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
import { getLearnsetViewerStatus, installLearnsetViewer, uninstallLearnsetViewer } from "../pokeweb/learnsetViewerModel";
import { getBattleTypeHudStatus, installBattleTypeHud, uninstallBattleTypeHud, getMoveEffectivenessStatus, installMoveEffectiveness, uninstallMoveEffectiveness, DEFAULT_MOVE_HIGHLIGHT_COLORS, type MoveHighlightColors, type TypeIconVariant } from "../pokeweb/battleTypeHudModel";
import {
  detectPwanRuntimeCompatibility,
  pwanCompatibilityFailureSummary,
  type PwanCompatibilityCheck,
  type PwanCompatibilityReport,
} from "../pokeweb/pwanCompatibilityModel";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const pwanCompatibilityHydrationProjects = new WeakSet<ProjectState>();
const typeIconLettersPreview = new URL("../assets/codeinjection/type-icons-letters-preview.png", import.meta.url).href;
const typeIconCircularPreview = new URL("../assets/codeinjection/type-icons-circular-preview.png", import.meta.url).href;
const typeIconSolidPreview = new URL("../assets/codeinjection/type-icons-solid-preview.png", import.meta.url).href;

export function renderCodeInjectionEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const status = getPmcInstallStatus(project);
  const modules = listCodeInjectionDlls(project);
  const formEvolutionStatus = detectBundledFormEvolutionDll(project);
  const formEvolutionInstalled = formEvolutionStatus === "patched";
  const doubleBattleFixStatus = detectBundledDoubleBattleFixDll(project);
  const doubleBattleFixSupported = status.installed && doubleBattleFixStatus !== "unsupported";
  const tagBattleStatus = getTagBattleStabilizationStatus(project);
  const tagBattleCanInstall = tagBattleStatus.supported && tagBattleStatus.compatible && !tagBattleStatus.installed;
  const portaPcStatus = getPortaPcStatus(project);
  const learnsetStatus = getLearnsetViewerStatus(project);
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
  const battleLogStatus = getBattleLogInstallStatus(project);
  const battleLogCanInstall = battleLogStatus.supported && battleLogStatus.compatible;
  const battleLogCanUninstall = battleLogStatus.installed && canUninstallBattleLog(project);
  const menuEvolutionStatus = getMenuEvolutionInstallStatus(project);
  const menuEvolutionCanInstall = menuEvolutionStatus.supported
    && menuEvolutionStatus.compatible
    && menuEvolutionStatus.dependencyInstalled
    && battleLogStatus.upToDate;
  const menuEvolutionCanUninstall = menuEvolutionStatus.installed && canUninstallMenuEvolution(project);
  if (shouldHydrateRomBytesForPwanCompatibility(project, pwanCompatibility)) {
    void hydrateRomBytesForPwanCompatibility(project, root, onDirty);
  }
  root.innerHTML = `
    <section class="code-injection-page">
      <aside class="code-injection-sidebar">
        <h1>Code Injection</h1>
        <p>Install runtime support for prebuilt Gen V patch modules.</p>
        <section class="code-injection-sidebar__modules">
          <h2>Installed DLLs</h2>
          <p>${status.installed ? "DLLs found under patches/ and lib/." : "Install PMC first, then add built patch DLLs."}</p>
          <div class="code-injection-actions">
            <button class="btn -primary" data-dll-target="patches" type="button" ${status.installed ? "" : "disabled"}>Add Patch DLL</button>
            <button class="btn -default" data-dll-target="lib" type="button" ${status.installed ? "" : "disabled"}>Add Library DLL</button>
            <input id="code-injection-dll-input" type="file" accept=".dll" hidden />
            <div class="code-injection-note" id="dll-install-note">Patch DLLs are staged in patches/. Library DLLs are staged in lib/.</div>
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
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>PMC Runtime</h2>
              <p>${escapeHtml(status.message)}</p>
            </div>
            <span class="code-injection-status ${status.installed ? "-installed" : ""}">${status.installed ? "Installed" : "Not Installed"}</span>
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>${escapeHtml(project.session.baseVersion)}</strong></div>
            <div><span>Overlay</span><strong>${status.installed ? status.overlayId : "None"}</strong></div>
            <div><span>Base Address</span><strong>${status.installed && status.overlayBaseAddress !== undefined ? `0x${status.overlayBaseAddress.toString(16)}` : "Pending"}</strong></div>
            <div><span>PMC Version</span><strong>${status.installed && status.version ? escapeHtml(status.version) : "Bundled"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-pmc-btn" type="button" ${status.supported ? "" : "disabled"}>${status.installed ? "Update PMC" : "Install PMC"}</button>
            <div class="code-injection-note" id="pmc-install-note">Prebuilt DLL upload will use the ROM filesystem support added for /patches and /lib.</div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Overworld Weather Runtime</h2>
              <p>Installs a resident 64-entry field-weather dispatcher and a data-driven registry so IDs 15–63 can clone stock behavior without per-effect code patches.</p>
            </div>
            <span class="code-injection-status ${weatherRuntimeInstalled ? "-installed" : weatherRuntimeSupported ? "" : "-error"}">
              ${weatherRuntimeInstalled ? "Installed" : weatherRuntimeSupported ? "Ready" : "Unsupported"}
            </span>
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
            <div class="code-injection-note" id="weather-runtime-note">
              ${
                weatherRuntimeInstalled
                  ? "The one-time runtime and PWTH registry are staged. Weather Graphics can now create independently editable slots without another code patch."
                  : weatherRuntimeSupported
                    ? "Installs PMC when needed, then stages PokewebOverworldWeatherW2.dll in patches/."
                    : "A separately audited build is required for Black 2, BW1, and non-US revisions."
              }
            </div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Trainer Battle Log</h2>
              <p>Records trainer-battle teams and KO attribution. Retires Wi-Fi save blocks 29–31 and isolates their former retail users, including daily Geonet maintenance. The save guard uses about 10 KiB of application RAM and less than 1 KiB of PMC memory. Updating prevents future corruption but cannot repair old damaged records.</p>
            </div>
            <span class="code-injection-status ${battleLogStatus.upToDate ? "-installed" : battleLogCanInstall ? "" : "-error"}">
              ${
                battleLogStatus.updateAvailable
                  ? "Update Available"
                  : battleLogStatus.upToDate
                    ? "Installed"
                    : battleLogCanInstall
                      ? "Ready"
                      : battleLogStatus.supported
                        ? "Incompatible"
                        : "Unsupported"
              }
            </span>
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
            <div class="code-injection-note" id="battle-log-note">
              ${escapeHtml(battleLogStatus.message)} ${battleLogStatus.pmcInstalled ? "PMC is installed." : "PMC will be installed automatically."} Installing retires and overwrites Pal Pad/Wi-Fi data in save blocks 29–31. Updating replaces the runtime DLLs without erasing existing battle history. Rename the summary screen's ID No. message to Frags in the text editor if desired.
            </div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>${MENU_EVOLUTION_TITLE}</h2>
              <p>Adds EVOLVE and RELEARN party commands, post-battle KO evolution, and immediate KO-threshold moves. RELEARN opens the native move reminder with eligible level-up and KO moves, without a Heart Scale.</p>
            </div>
            <span class="code-injection-status ${menuEvolutionStatus.upToDate ? "-installed" : menuEvolutionCanInstall ? "" : "-error"}">
              ${
                menuEvolutionStatus.updateAvailable
                  ? "Update Available"
                  : menuEvolutionStatus.upToDate
                  ? "Installed"
                  : !menuEvolutionStatus.supported
                    ? "Unsupported"
                    : !menuEvolutionStatus.dependencyInstalled
                      ? "Dependency Missing"
                      : menuEvolutionStatus.compatible
                        ? "Ready"
                        : "Incompatible"
              }
            </span>
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US ${escapeHtml(menuEvolutionDisplayName(project.session.baseVersion) ?? project.session.baseVersion)}</strong></div>
            <div><span>Methods</span><strong>Level, KOs, Battles, Used</strong></div>
            <div><span>KO Moves</span><strong>32 per Pokémon</strong></div>
            <div><span>Relearn</span><strong>Current level + earned KOs</strong></div>
            <div><span>Battle Counters</span><strong>${menuEvolutionStatus.dependencyInstalled ? "Installed" : "Required"}</strong></div>
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
            <div class="code-injection-note" id="menu-evolution-note">
              ${
                !menuEvolutionStatus.dependencyInstalled || !battleLogStatus.upToDate
                  ? "Install or update Trainer Battle Log first so the immediate-KO counter runtime is available."
                  : `${escapeHtml(menuEvolutionStatus.message)} ${menuEvolutionStatus.pmcInstalled ? "PMC is installed." : "PMC will be installed automatically."}`
              }
            </div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Learnset Viewer</h2>
              <p>Adds a standalone LEARNSET party command. D-pad Right/Left switches party Pokémon, skipping Eggs; L/R pages evolution requirements. Browse current-form base stats, abilities, and a cycle-safe evolution chain. Hidden abilities are purple. The lower screen lists all level-up moves with levels and base max PP. Read-only: no teaching or KO moves; RELEARN is unchanged.</p>
            </div>
            <span class="code-injection-status ${learnsetStatus.installed && !learnsetStatus.updateAvailable ? "-installed" : learnsetStatus.compatible ? "" : "-error"}">
              ${learnsetStatus.partial ? "Incomplete" : learnsetStatus.updateAvailable ? "Update Available" : learnsetStatus.installed ? "Installed" : learnsetStatus.compatible ? "Ready" : "Unsupported / Incompatible"}
            </span>
          </div>
          <div class="code-injection-facts">
            <div><span>ROM</span><strong>US W2 / B2 · vanilla or Upgrade</strong></div>
            <div><span>Dependency</span><strong>PMC only</strong></div>
            <div><span>Full party menu</span><strong>LEARNSET is hidden</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-learnset-viewer-btn" type="button" ${learnsetStatus.supported && learnsetStatus.compatible ? "" : "disabled"}>${learnsetStatus.updateAvailable ? "Update" : learnsetStatus.partial ? "Repair" : learnsetStatus.installed ? "Reinstall" : "Install"}</button>
            <button class="btn -default" id="uninstall-learnset-viewer-btn" type="button" ${learnsetStatus.canUninstall ? "" : "disabled"} title="Only staged companions can be removed; built-in ROM files cannot yet be deleted.">Uninstall</button>
            <div class="code-injection-note" id="learnset-viewer-note">${escapeHtml(learnsetStatus.message)}</div>
          </div>
        </section>
        ${[
          { id: "battle-hud", title: "Type Icons", status: battleHudStatus,
            description: "Shows type icons on player and enemy health panels in singles, doubles and triples, including compact panels with EXP bars. Choose lettered hexagons, the original circular symbol artwork, or solid type-colored wedges fitted into the HUD edge. Every style preserves the native caught marker. Status labels hide the icons until the condition clears. Installs independently of move highlighting." },
          { id: "move-effectiveness", title: "Move Effectiveness Preview", status: moveEffectivenessStatus,
            description: "Highlights damaging moves as super effective, not very effective, or immune. Includes standard BW2 type immunities, Levitate, Air Balloon, Magnet Rise, and blocking abilities with suppression and bypass checks. Singles and rotation use the opposing Pokémon; doubles and triples color the selected move name while choosing an enemy. Weather Ball, Natural Gift, Judgment and Techno Blast stay neutral. Custom ability and item mechanics need a compatible preview patch." },
        ].map(card => `
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div><h2>${card.title}</h2><p>${card.description}</p></div>
            <span class="code-injection-status ${card.status.installed && !card.status.updateAvailable ? "-installed" : card.status.compatible ? "" : "-error"}">
              ${card.status.legacyCombined ? "Combined Patch Present" : card.status.updateAvailable ? "Update Available" : card.status.installed ? "Installed" : card.status.compatible ? "Ready" : "Unsupported / Incompatible"}
            </span>
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
            <div class="code-injection-note" id="${card.id}-note">${escapeHtml(card.status.message)}</div>
          </div>
        </section>`).join("")}

        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>PWAN GIF Support</h2>
              <p>Installs PMC and the bundled PWAN runtime needed for Pokemon-scoped GIF imports.</p>
            </div>
            <span class="code-injection-status ${pwanRuntimeInstalled ? "-installed" : pwanCanInstall ? "" : "-error"}">
              ${pwanRuntimeInstalled ? "Installed" : pwanLegacyInstalled ? "Upgrade" : pwanCanInstall ? "Ready" : pwanCompatibility.supportedBase ? "Incompatible" : "Unsupported"}
            </span>
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
            <div class="code-injection-note" id="pwan-runtime-note">
              ${
                pwanCanInstall
                  ? project.session.baseVersion === "B2"
                    ? "This stages the Black 2 Summary, Battle, and Misc PWAN DLLs."
                    : "This stages the current Summary, Battle, and Misc PWAN DLLs and retires the legacy monolith."
                  : escapeHtml(pwanCompatibilityFailureSummary(pwanCompatibility))
              }
            </div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Single-NPC Double Battle Fix</h2>
              <p>${
                project.session.baseRom === "BW2"
                  ? "Stages the bundled DLXF patch that fixes common-script trainers changed from Singles to Doubles."
                  : "A BW build of this DLXF patch is not bundled yet."
              }</p>
            </div>
            <span class="code-injection-status ${doubleBattleFixStatus === "patched" ? "-installed" : ""}">
              ${doubleBattleFixStatus === "patched" ? "Installed" : doubleBattleFixStatus === "unsupported" ? "Unsupported" : "Not Installed"}
            </span>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-double-battle-fix-btn" type="button" ${doubleBattleFixSupported ? "" : "disabled"}>
              Install Double Battle Fix
            </button>
            <div class="code-injection-note" id="double-battle-fix-note">
              ${status.installed ? "The patch DLL will be staged in patches/." : "Install PMC first, then stage the patch DLL."}
            </div>
          </div>
          <div class="code-injection-credits" aria-label="Double Battle Fix credits">
            <span>Implementation credits</span>
            <strong>Sunk</strong>
            <strong>Papaya</strong>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Tag Battle Stabilization</h2>
              <p>Allows tag battles with more than the vanilla limit of six opposing Pokemon, such as two opponents with four Pokemon each. Runs one trainer's AI at a time to reduce script memory use and prevent the related battle-start hang.</p>
            </div>
            <span class="code-injection-status ${!tagBattleStatus.supported || !tagBattleStatus.compatible ? "-error" : tagBattleStatus.installed ? "-installed" : ""}">
              ${!tagBattleStatus.supported ? "Unsupported" : !tagBattleStatus.compatible ? "Incompatible" : tagBattleStatus.installed ? "Installed" : "Ready"}
            </span>
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
            <div class="code-injection-note" id="tag-battle-stabilization-note">${escapeHtml(tagBattleStatus.message)}</div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Porta PC</h2>
              <p>Press Start while exploring to open the in-game PC and access your Pokemon boxes. Supports grid and rail maps, including Castelia City. Uses the normal PC menu and gives other field events priority.</p>
            </div>
            <span class="code-injection-status ${!portaPcStatus.supported || !portaPcStatus.compatible ? "-error" : portaPcStatus.installed && !portaPcStatus.updateAvailable ? "-installed" : ""}">
              ${!portaPcStatus.supported ? "Unsupported" : !portaPcStatus.compatible ? "Incompatible" : portaPcStatus.updateAvailable ? "Update Available" : portaPcStatus.installed ? "Installed" : "Ready"}
            </span>
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
            <div class="code-injection-note" id="porta-pc-note">${escapeHtml(portaPcStatus.message)}</div>
          </div>
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Added-Form Evolution Support</h2>
              <p>Allows evolution NARC targets to reference appended personal-form IDs while storing the evolved Pokemon as a safe base species and form.</p>
            </div>
            <span class="code-injection-status ${formEvolutionInstalled ? "-installed" : ""}">
              ${formEvolutionInstalled ? "Installed" : formEvolutionStatus === "unsupported" ? "Unsupported" : "Not Installed"}
            </span>
          </div>
          <div class="code-injection-facts">
            <div><span>Runtime</span><strong>${formEvolutionStatus === "unsupported" ? "B2/W2 only" : `FormEvolution${escapeHtml(project.session.baseVersion)}.dll`}</strong></div>
            <div><span>Module Path</span><strong>${formEvolutionInstalled ? `patches/FormEvolution${escapeHtml(project.session.baseVersion)}.dll` : "Pending"}</strong></div>
            <div><span>Installation</span><strong>Automatic with Add Form</strong></div>
            <div><span>PMC</span><strong>${status.installed ? "Installed" : "Pending"}</strong></div>
          </div>
          <div class="code-injection-note">
            ${
              formEvolutionInstalled
                ? "The bundled form-evolution DLL is active in this project and will be included in the exported ROM."
                : formEvolutionStatus === "unsupported"
                  ? "The bundled form-evolution runtime currently supports Black 2 and White 2."
                  : "Use Add Form in the Pokemon editor to install PMC and the matching bundled runtime automatically."
            }
          </div>
        </section>
      </main>
    </section>
  `;

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
      if (note) note.textContent = "Patching ARM9, writing PMC overlay, and staging codeinjection files.";
      const result = await installBundledPmc(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#pmc-install-note");
      if (refreshedNote) refreshedNote.textContent = `PMC ${result.version ?? ""} installed on overlay ${result.overlayId}.`;
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
      const result = await installBundledOverworldWeatherRuntime(project);
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
      await installPwanRuntime(project);
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

  const doubleBattleButton = root.querySelector<HTMLButtonElement>("#install-double-battle-fix-btn");
  const doubleBattleNote = root.querySelector<HTMLDivElement>("#double-battle-fix-note");
  doubleBattleButton?.addEventListener("click", async () => {
    const previousText = doubleBattleButton.textContent ?? "Install Double Battle Fix";
    try {
      doubleBattleButton.disabled = true;
      doubleBattleButton.textContent = "Installing...";
      if (doubleBattleNote) doubleBattleNote.textContent = "Loading and staging the bundled double battle patch DLL.";
      const result = await stageBundledDoubleBattleFixDll(project);
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

  const tagBattleButton = root.querySelector<HTMLButtonElement>("#install-tag-battle-stabilization-btn");
  const tagBattleNote = root.querySelector<HTMLDivElement>("#tag-battle-stabilization-note");
  tagBattleButton?.addEventListener("click", async () => {
    try {
      tagBattleButton.disabled = true;
      tagBattleButton.textContent = "Installing...";
      if (tagBattleNote) tagBattleNote.textContent = "Checking battle AI compatibility and installing Tag Battle Stabilization.";
      await installTagBattleStabilization(project);
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

  const portaPcButton = root.querySelector<HTMLButtonElement>("#install-porta-pc-btn");
  const portaPcNote = root.querySelector<HTMLDivElement>("#porta-pc-note");
  portaPcButton?.addEventListener("click", async () => {
    const previousText = portaPcButton.textContent;
    try {
      portaPcButton.disabled = true;
      portaPcButton.textContent = "Installing...";
      if (portaPcNote) portaPcNote.textContent = "Checking field compatibility and installing Porta PC.";
      await installPortaPc(project);
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
      const result = await installBattleLog(project);
      if (refreshMenuEvolution) await installMenuEvolution(project);
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

  const menuEvolutionButton = root.querySelector<HTMLButtonElement>("#install-menu-evolution-btn");
  const menuEvolutionNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
  menuEvolutionButton?.addEventListener("click", async () => {
    const previousText = menuEvolutionButton.textContent ?? "Install";
    try {
      menuEvolutionButton.disabled = true;
      menuEvolutionButton.textContent = "Installing...";
      if (menuEvolutionNote) {
        menuEvolutionNote.textContent = "Checking BW2 hooks, configuring EVOLVE and RELEARN, preparing the KO learnset NARC, and staging the enhanced companion DLL.";
      }
      const result = await installMenuEvolution(project);
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
  for (const [id, install, uninstall] of [
    ["battle-hud", installBattleTypeHud, uninstallBattleTypeHud],
    ["move-effectiveness", installMoveEffectiveness, uninstallMoveEffectiveness],
  ] as const) {
    for (const [verb, action] of [["install", install], ["uninstall", uninstall]] as const) {
      const button = root.querySelector<HTMLButtonElement>(`#${verb}-${id}-btn`);
      button?.addEventListener("click", async () => {
        const note = root.querySelector<HTMLDivElement>(`#${id}-note`);
        button.disabled = true;
        if (note) note.textContent = "Checking and updating the patch...";
        try {
          if (id === "move-effectiveness" && verb === "install") {
            const colors = Object.fromEntries([...root.querySelectorAll<HTMLInputElement>("[data-move-highlight-color]")]
              .map(input => [input.dataset.moveHighlightColor!, input.value])) as MoveHighlightColors;
            await installMoveEffectiveness(project, colors);
          } else if (id === "battle-hud" && verb === "install") {
            const variant = (root.querySelector<HTMLSelectElement>("#type-icon-variant")?.value ?? "letters") as TypeIconVariant;
            await installBattleTypeHud(project, variant);
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
    ["#install-learnset-viewer-btn", () => installLearnsetViewer(project)],
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
  let selectedTarget: CodeInjectionDllTarget = "patches";
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
      const result = stageCodeInjectionDll(project, file.name, new Uint8Array(await file.arrayBuffer()), selectedTarget);
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

function shouldHydrateRomBytesForPwanCompatibility(project: ProjectState, report: PwanCompatibilityReport): boolean {
  return report.supportedBase && !project.originalRomBytes && report.missing > 0 && !pwanCompatibilityHydrationProjects.has(project);
}

async function hydrateRomBytesForPwanCompatibility(project: ProjectState, root: HTMLElement, onDirty: () => void): Promise<void> {
  pwanCompatibilityHydrationProjects.add(project);
  try {
    const bytes = await loadActiveRomBytes();
    if (!bytes || project.originalRomBytes) return;
    project.originalRomBytes = bytes;
    if (root.isConnected) renderCodeInjectionEditor(project, root, onDirty);
  } catch {
    // The page can still report the missing regions; export/install paths will surface storage errors separately.
  }
}
