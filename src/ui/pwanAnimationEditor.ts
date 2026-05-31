import type { ProjectState, PwanAnimationOverride, PwanPaletteSource } from "../pokeweb/projectStore";
import {
  buildPwanOverride,
  ensurePwanAnimationState,
  getPwanRuntimeStatus,
  installPwanRuntime,
  pwanAssetPath,
  removePwanOverride,
  upsertPwanOverride,
} from "../pokeweb/pwanAnimationModel";
import { formatBytes, escapeHtml } from "./dom";

type PwanAnimationEditorOptions = {
  onDirty?: () => void;
  onRefresh?: () => void;
};

type PwanImportFormOptions = PwanAnimationEditorOptions & {
  title?: string;
  defaultSpeciesId?: number;
  defaultPaletteSource?: PwanPaletteSource;
  showImportStatus?: boolean;
  showPaletteField?: boolean;
  showSpeciesField?: boolean;
  submitLabel?: string;
  workingLabel?: string;
};

const pwanGifPreviewUrls = new WeakMap<HTMLImageElement, string>();

export function renderPwanAnimationEditor(project: ProjectState, root: HTMLElement, options: PwanAnimationEditorOptions = {}): void {
  const state = ensurePwanAnimationState(project);
  const status = getPwanRuntimeStatus(project);
  const speciesOptions = renderSpeciesOptions(project);
  root.innerHTML = `
    <section class="pwan-page">
      <div class="pwan-toolbar">
        <div>
          <h1>Animated Sprites</h1>
          <div class="pwan-subtitle">PWAN GIF overrides for stock US White 2</div>
        </div>
        <div class="pwan-runtime ${status.supported && status.installed ? "-ready" : "-pending"}">
          <strong>${status.supported && status.installed ? "Runtime staged" : "Runtime required"}</strong>
          <span>${escapeHtml(status.message)}</span>
          ${
            status.supported && !status.installed
              ? `<button class="btn -default" id="pwan-install-runtime" type="button">${status.pmcInstalled ? "Stage Runtime" : "Install PMC + Runtime"}</button>`
              : ""
          }
        </div>
      </div>

      ${
        status.supported
          ? renderEditorForm(project, speciesOptions)
          : `<div class="pwan-warning">${escapeHtml(status.message)}</div>`
      }

      <div class="pwan-overrides">
        <div class="pwan-section-title">
          <h2>Overrides</h2>
          <span>${state.overrides.length} active</span>
        </div>
        ${state.overrides.length === 0 ? `<div class="pwan-empty">No animated species overrides saved yet.</div>` : state.overrides.map((override, index) => renderOverride(project, override, index)).join("")}
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#pwan-install-runtime")?.addEventListener("click", async () => {
    const button = root.querySelector<HTMLButtonElement>("#pwan-install-runtime");
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Installing...";
      }
      await installPwanRuntime(project);
      options.onDirty?.();
      options.onRefresh?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      if (button) {
        button.disabled = false;
        button.textContent = "Try Again";
      }
    }
  });

  installPwanImportFormEvents(project, root, options);

  root.querySelectorAll<HTMLButtonElement>("[data-pwan-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const speciesId = Number(button.dataset.pwanRemove);
      removePwanOverride(project, speciesId);
      options.onDirty?.();
      options.onRefresh?.();
    });
  });
}

export function renderPwanImportPanel(project: ProjectState, options: PwanImportFormOptions = {}): string {
  return renderPwanImportForm(project, renderSpeciesOptions(project), options);
}

export function installPwanImportFormEvents(project: ProjectState, root: HTMLElement, options: PwanImportFormOptions = {}): void {
  const submitLabel = options.submitLabel ?? "Save Override";
  const workingLabel = options.workingLabel ?? "Compiling...";
  installPwanGifPreview(root.querySelector<HTMLInputElement>("#pwan-front-gif"), root.querySelector<HTMLImageElement>("#pwan-front-gif-preview"));
  installPwanGifPreview(root.querySelector<HTMLInputElement>("#pwan-back-gif"), root.querySelector<HTMLImageElement>("#pwan-back-gif-preview"));
  root.querySelector<HTMLButtonElement>("#pwan-save-override")?.addEventListener("click", async () => {
    const button = root.querySelector<HTMLButtonElement>("#pwan-save-override");
    const message = root.querySelector<HTMLElement>("#pwan-form-status");
    try {
      if (button) {
        button.disabled = true;
        button.textContent = workingLabel;
      }
      setStatus(message, "Compiling GIFs...");
      const speciesId = Number(root.querySelector<HTMLInputElement>("#pwan-species-id")?.value ?? 0);
      const frontFile = root.querySelector<HTMLInputElement>("#pwan-front-gif")?.files?.[0];
      const backFile = root.querySelector<HTMLInputElement>("#pwan-back-gif")?.files?.[0];
      const paletteSource = root.querySelector<HTMLInputElement | HTMLSelectElement>("#pwan-palette-source")?.value;
      const nativePaletteSource = (paletteSource ?? "back") as PwanPaletteSource;
      if (!frontFile || !backFile) throw new Error("Choose both a front GIF and a back GIF before saving an override.");
      const override = buildPwanOverride({
        speciesId,
        frontFileName: frontFile.name,
        frontGifBytes: new Uint8Array(await frontFile.arrayBuffer()),
        backFileName: backFile.name,
        backGifBytes: new Uint8Array(await backFile.arrayBuffer()),
        nativePaletteSource,
      });
      upsertPwanOverride(project, override);
      options.onDirty?.();
      setStatus(message, `Saved ${speciesLabel(project, speciesId)}. Export will stage PWAN assets and patch native carriers.`);
      options.onRefresh?.();
    } catch (error) {
      setStatus(message, error instanceof Error ? error.message : String(error), true);
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = submitLabel;
      }
    }
  });
}

function installPwanGifPreview(input: HTMLInputElement | null, preview: HTMLImageElement | null): void {
  if (!input || !preview) return;
  input.addEventListener("change", () => {
    const previousUrl = pwanGifPreviewUrls.get(preview);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const file = input.files?.[0];
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute("src");
      pwanGifPreviewUrls.delete(preview);
      return;
    }
    const url = URL.createObjectURL(file);
    pwanGifPreviewUrls.set(preview, url);
    preview.src = url;
    preview.alt = `${file.name} preview`;
    preview.hidden = false;
  });
}

function renderEditorForm(project: ProjectState, speciesOptions: string): string {
  return `
    <div class="pwan-editor-grid">
      ${renderPwanImportForm(project, speciesOptions)}
      <div class="pwan-panel">
        <div class="pwan-section-title">
          <h2>Export Contract</h2>
          <span>IRDO only</span>
        </div>
        <div class="pwan-contract">
          <div><strong>GIF input</strong><span>Compiled to 96x96, 4bpp, 16-color PWAN.</span></div>
          <div><strong>Native carrier</strong><span>Species pokegra metadata and fallback frames are patched at export.</span></div>
          <div><strong>Runtime config</strong><span><code>pokeweb_pwan/config.bin</code> lists only overridden species.</span></div>
        </div>
      </div>
    </div>
  `;
}

function renderPwanImportForm(project: ProjectState, speciesOptions: string, options: PwanImportFormOptions = {}): string {
  const title = options.title ?? "Add Override";
  const defaultSpeciesId = options.defaultSpeciesId ?? 498;
  const defaultPaletteSource = options.defaultPaletteSource ?? "back";
  const existingOverride = options.showImportStatus ? project.pwanAnimations?.overrides?.find((override) => override.speciesId === defaultSpeciesId) : undefined;
  const showPaletteField = options.showPaletteField ?? true;
  const showSpeciesField = options.showSpeciesField ?? true;
  const submitLabel = options.submitLabel ?? "Save Override";
  return `
    <div class="pwan-panel">
      <div class="pwan-section-title">
        <h2>${escapeHtml(title)}</h2>
        <span>Front + back required</span>
      </div>
      ${existingOverride ? renderPwanImportStatus(existingOverride) : ""}
      <div class="pwan-form">
        ${
          showSpeciesField
            ? `<label>
                <span>Species</span>
                <input id="pwan-species-id" type="number" min="1" max="${Math.max(1, (project.narcs.personal?.fileCount ?? 650) - 1)}" value="${defaultSpeciesId}" list="pwan-species-list">
                <datalist id="pwan-species-list">${speciesOptions}</datalist>
              </label>`
            : `<input id="pwan-species-id" type="hidden" value="${defaultSpeciesId}">`
        }
        <label class="pwan-gif-field">
          <span>Front GIF</span>
          <input id="pwan-front-gif" type="file" accept="image/gif,.gif">
          <img class="pwan-gif-preview" id="pwan-front-gif-preview" alt="Front GIF preview" hidden>
        </label>
        <label class="pwan-gif-field">
          <span>Back GIF</span>
          <input id="pwan-back-gif" type="file" accept="image/gif,.gif">
          <img class="pwan-gif-preview" id="pwan-back-gif-preview" alt="Back GIF preview" hidden>
        </label>
        ${
          showPaletteField
            ? `<label>
                <span>Fallback Palette</span>
                <select id="pwan-palette-source">
                  <option value="back" ${defaultPaletteSource === "back" ? "selected" : ""}>Back PWAN palette</option>
                  <option value="front" ${defaultPaletteSource === "front" ? "selected" : ""}>Front PWAN palette</option>
                </select>
              </label>`
            : `<input id="pwan-palette-source" type="hidden" value="${defaultPaletteSource}">`
        }
        <button class="btn -default" id="pwan-save-override" type="button">${escapeHtml(submitLabel)}</button>
        <div class="pwan-status" id="pwan-form-status"></div>
      </div>
    </div>
  `;
}

function renderPwanImportStatus(override: PwanAnimationOverride): string {
  return `
    <div class="pwan-import-status">
      <strong>GIF import active</strong>
      <span>Front: ${escapeHtml(override.front.sourceFileName)} (${override.front.frameCount} frames)</span>
      <span>Back: ${escapeHtml(override.back.sourceFileName)} (${override.back.frameCount} frames)</span>
    </div>
  `;
}

function renderOverride(project: ProjectState, override: PwanAnimationOverride, index: number): string {
  const notes = override.notes?.length ? override.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("") : `<li>No compiler warnings.</li>`;
  return `
    <article class="pwan-override">
      <div class="pwan-override__main">
        <h3>#${override.speciesId} ${escapeHtml(speciesLabel(project, override.speciesId))}</h3>
        <div class="pwan-override__meta">
          <span>${escapeHtml(override.front.sourceFileName)} -> ${escapeHtml(pwanAssetPath(index, "front"))}</span>
          <span>${escapeHtml(override.back.sourceFileName)} -> ${escapeHtml(pwanAssetPath(index, "back"))}</span>
          <span>Palette: ${override.nativePaletteSource}</span>
          <span>Back NCEC Y: ${override.backNcecY}</span>
        </div>
        <div class="pwan-stats">
          ${renderSideStats("Front", override.front)}
          ${renderSideStats("Back", override.back)}
        </div>
        <ul class="pwan-notes">${notes}</ul>
      </div>
      <button class="btn -default" data-pwan-remove="${override.speciesId}" type="button">Remove</button>
    </article>
  `;
}

function renderSideStats(label: string, side: PwanAnimationOverride["front"]): string {
  return `
    <div>
      <strong>${label}</strong>
      <span>${side.frameCount} frames</span>
      <span>${side.uniqueFrameCount} unique</span>
      <span>${side.timelineCount} timeline</span>
      <span>${formatBytes(side.pwanBytes.length)}</span>
    </div>
  `;
}

function renderSpeciesOptions(project: ProjectState): string {
  const count = project.narcs.personal?.fileCount ?? project.texts.banks.pokedex?.length ?? 650;
  const names = project.texts.banks.pokedex ?? [];
  const options: string[] = [];
  for (let speciesId = 1; speciesId < count; speciesId += 1) {
    options.push(`<option value="${speciesId}" label="#${speciesId} ${escapeHtml(names[speciesId] ?? `Pokemon ${speciesId}`)}"></option>`);
  }
  return options.join("");
}

function speciesLabel(project: ProjectState, speciesId: number): string {
  return project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`;
}

function setStatus(element: HTMLElement | null | undefined, message: string, error = false): void {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("-error", error);
}
