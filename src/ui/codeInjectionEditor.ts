import {
  detectBundledDoubleBattleFixDll,
  getPmcInstallStatus,
  installBundledPmc,
  listCodeInjectionDlls,
  stageBundledDoubleBattleFixDll,
  stageCodeInjectionDll,
  type CodeInjectionDllTarget,
} from "../pokeweb/pmcModel";
import { getPwanRuntimeStatus, installPwanRuntime } from "../pokeweb/pwanAnimationModel";
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
  const doubleBattleFixStatus = detectBundledDoubleBattleFixDll(project);
  const doubleBattleFixSupported = status.installed && doubleBattleFixStatus !== "unsupported";
  const pwanRuntimeStatus = getPwanRuntimeStatus(project);
  const pwanRuntimeInstalled = pwanRuntimeStatus.supported && pwanRuntimeStatus.installed;
  const pwanLegacyInstalled = pwanRuntimeStatus.supported && pwanRuntimeStatus.legacyInstalled;
  const pwanCompatibility = detectPwanRuntimeCompatibility(project);
  const pwanCanInstall = pwanRuntimeStatus.supported && pwanCompatibility.compatible;
  if (shouldHydrateRomBytesForPwanCompatibility(project, pwanCompatibility)) {
    void hydrateRomBytesForPwanCompatibility(project, root, onDirty);
  }
  root.innerHTML = `
    <section class="code-injection-page">
      <aside class="code-injection-sidebar">
        <h1>Code Injection</h1>
        <p>Install runtime support for prebuilt Gen V patch modules.</p>
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
              <h2>Installed DLLs</h2>
              <p>${status.installed ? "DLLs found in the ROM filesystem under patches/ and lib/." : "Install PMC first, then add built patch DLLs."}</p>
            </div>
          </div>
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
                          <div>
                            <strong>${escapeHtml(module.fileName)}</strong>
                            <span>${escapeHtml(module.path)}</span>
                          </div>
                          <em>${module.target === "patches" ? "Patch" : "Library"}</em>
                        </div>
                      `,
                    )
                    .join("")
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
