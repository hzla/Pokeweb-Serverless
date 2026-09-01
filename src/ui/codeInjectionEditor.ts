import {
  detectBundledFormEvolutionDll,
  detectBundledDoubleBattleFixDll,
  detectBundledOverworldWeatherRuntime,
  getPmcInstallStatus,
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
  canUninstallMenuEvolution,
  getMenuEvolutionInstallStatus,
  installMenuEvolution,
  menuEvolutionDisplayName,
  uninstallMenuEvolution,
} from "../pokeweb/menuEvolutionModel";
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

export function renderCodeInjectionEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const status = getPmcInstallStatus(project);
  const modules = listCodeInjectionDlls(project);
  const formEvolutionStatus = detectBundledFormEvolutionDll(project);
  const formEvolutionInstalled = formEvolutionStatus === "patched";
  const doubleBattleFixStatus = detectBundledDoubleBattleFixDll(project);
  const doubleBattleFixSupported = status.installed && doubleBattleFixStatus !== "unsupported";
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
    && menuEvolutionStatus.dependencyInstalled;
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
            <div><span>Runtime ABI</span><strong>3 · PWTH v2</strong></div>
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
              <p>Records the player's team and KO attribution for trainer battles, then shows the species-family frag count in the summary screen's ID value field.</p>
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
                  ? "Uninstall Menu Evolution first."
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
              <h2>Menu Evolution</h2>
              <p>Adds an Evolve command to eligible Pokémon in the BW2 field party menu and exposes individual battle counters to field scripts through command 0x010C.</p>
            </div>
            <span class="code-injection-status ${menuEvolutionStatus.installed ? "-installed" : menuEvolutionCanInstall ? "" : "-error"}">
              ${
                menuEvolutionStatus.installed
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
            <div><span>Battle Counters</span><strong>${menuEvolutionStatus.dependencyInstalled ? "Installed" : "Required"}</strong></div>
            <div><span>PMC</span><strong>${menuEvolutionStatus.pmcInstalled ? "Installed" : "Will Install"}</strong></div>
            <div><span>Hook Checks</span><strong>${menuEvolutionStatus.checked ? `${menuEvolutionStatus.passed}/${menuEvolutionStatus.checks.length}` : "On install"}</strong></div>
          </div>
          <div class="code-injection-actions">
            <button class="btn -primary" id="install-menu-evolution-btn" type="button" ${menuEvolutionCanInstall ? "" : "disabled"}>
              ${menuEvolutionStatus.installed ? "Reinstall Menu Evolution" : "Install Menu Evolution"}
            </button>
            <button class="btn -default" id="uninstall-menu-evolution-btn" type="button" ${menuEvolutionCanUninstall ? "" : "disabled"}
              title="${menuEvolutionStatus.installed && !menuEvolutionCanUninstall ? "A DLL already built into the loaded ROM cannot be removed yet." : "Remove the staged Menu Evolution DLL."}">
              Uninstall Menu Evolution
            </button>
            <div class="code-injection-note" id="menu-evolution-note">
              ${
                !menuEvolutionStatus.dependencyInstalled
                  ? "Install Trainer Battle Log first so the matching individual-counter DLL is available."
                  : `${escapeHtml(menuEvolutionStatus.message)} ${menuEvolutionStatus.pmcInstalled ? "PMC is installed." : "PMC will be installed automatically."}`
              }
            </div>
          </div>
        </section>
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
        refreshedNote.textContent = `Battle log ${updating ? "updated" : "staged"} at ${result.dllPath}, ${result.counterDllPath}, and ${result.summaryDllPath}; ancestry was generated from ${result.evolutionMembers} evolution records.${refreshMenuEvolution ? " The installed Menu Evolution companion was refreshed for the new PK5 counter layout." : ""}`;
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
    const previousText = menuEvolutionButton.textContent ?? "Install Menu Evolution";
    try {
      menuEvolutionButton.disabled = true;
      menuEvolutionButton.textContent = "Installing...";
      if (menuEvolutionNote) {
        menuEvolutionNote.textContent = "Checking BW2 hooks, configuring the Evolve message, and staging the companion DLL.";
      }
      const result = await installMenuEvolution(project);
      onDirty();
      renderCodeInjectionEditor(project, root, onDirty);
      const refreshedNote = root.querySelector<HTMLDivElement>("#menu-evolution-note");
      if (refreshedNote) {
        refreshedNote.textContent = `Menu Evolution staged at ${result.dllPath} using message bank ${result.messageBankId}, entry ${result.messageEntryId}.`;
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
        refreshedNote.textContent = "Menu Evolution removed. The Evolve text entry remains available for a later reinstall.";
      }
    } catch (error) {
      uninstallMenuEvolutionButton.disabled = false;
      const currentNote = root.querySelector<HTMLDivElement>("#menu-evolution-note") ?? menuEvolutionNote;
      if (currentNote) currentNote.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  const input = root.querySelector<HTMLInputElement>("#code-injection-dll-input");
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
