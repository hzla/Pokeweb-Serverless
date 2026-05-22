import {
  detectBundledDoubleBattleFixDll,
  getPmcInstallStatus,
  installBundledPmc,
  listCodeInjectionDlls,
  stageBundledDoubleBattleFixDll,
  stageCodeInjectionDll,
  type CodeInjectionDllTarget,
} from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export function renderCodeInjectionEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const status = getPmcInstallStatus(project);
  const modules = listCodeInjectionDlls(project);
  const doubleBattleFixStatus = detectBundledDoubleBattleFixDll(project);
  const doubleBattleFixSupported = status.installed && doubleBattleFixStatus !== "unsupported";
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
        </section>
        <section class="code-injection-panel">
          <div class="code-injection-panel__header">
            <div>
              <h2>Patch Modules</h2>
              <p>${status.installed ? "Add built Gen V DLXF modules to the ROM filesystem." : "Install PMC first, then add built patch DLLs."}</p>
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
                ? `<div class="code-injection-empty">No user DLLs staged.</div>`
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
