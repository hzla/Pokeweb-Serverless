import type { BattleBackgroundCatalog, BattleBackgroundVariant } from "../pokeweb/battleBackgroundModel";
import { updateBattleCamera, validateBattleCameraPose, type BattleCameraDocument, type BattleCameraPose } from "../pokeweb/battleCameraModel";
import type { BattleEnvironmentTestSelection } from "../pokeweb/battleEnvironmentTest";
import type { BattlePlatformCatalog, BattlePlatformVariant } from "../pokeweb/battlePlatformModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { supportsAutomaticTestBattle } from "../pokeweb/testBattle";
import type { BattleBackgroundRenderer } from "./battleBackgroundRenderer";
import { escapeHtml } from "./dom";

export type BattleBackgroundEditorOptions = {
  onDirty?: () => void;
  onTest?: (selection: BattleEnvironmentTestSelection) => Promise<void>;
};

export class BattleEnvironmentControls {
  background?: BattleBackgroundVariant;
  platform?: BattlePlatformVariant;
  private trainerId = 1;
  private presetId = "default";
  private drafts = new Map<string, BattleCameraPose>();
  private busy = false;
  private host?: HTMLElement;

  constructor(
    private project: ProjectState,
    private backgrounds: BattleBackgroundCatalog | undefined,
    private platforms: BattlePlatformCatalog | undefined,
    private camera: BattleCameraDocument | undefined,
    private cameraError: string | undefined,
    private renderer: () => BattleBackgroundRenderer | undefined,
    private options: BattleBackgroundEditorOptions,
    private previewPlacement?: () => void,
  ) { this.background = backgrounds?.variants[0]; }

  mount(host: HTMLElement, changed: (kind: "backgrounds" | "platforms") => void): void {
    this.host = host;
    const key = (v: { tableIndex: number; seasonIndex: number }) => `${v.tableIndex}:${v.seasonIndex}`;
    const option = (v: BattleBackgroundVariant | BattlePlatformVariant, selected?: BattleBackgroundVariant | BattlePlatformVariant) =>
      `<option value="${key(v)}" ${selected && key(selected) === key(v) ? "selected" : ""}>${v.tableIndex}${v.variantCount > 1 ? ` · ${v.seasonName}` : ""}</option>`;
    host.innerHTML = `
      <label class="battle-background-selector">Background<select class="filter-input" aria-label="Background" data-environment-background ${this.backgrounds ? "" : "disabled"}>
        ${this.backgrounds?.variants.map(v => option(v, this.background)).join("") ?? "<option>Unavailable</option>"}</select></label>
      <label class="battle-background-selector">Platform<select class="filter-input" aria-label="Platform" data-environment-platform>
        <option value="" ${this.platform ? "" : "selected"}>Automatic</option>${this.platforms?.variants.map(v => option(v, this.platform)).join("") ?? ""}</select></label>
      <section class="battle-environment-test">
        <label class="battle-background-selector">Trainer ID<input class="filter-input" data-environment-trainer type="number" required min="1" max="${Math.max(1, (this.project.narcs.trdata?.fileCount ?? 1) - 1)}" step="1" value="${this.trainerId}"></label>
        <button type="button" class="btn -default" data-environment-test ${this.busy || !this.background || !this.options.onTest || !supportsAutomaticTestBattle(this.project) ? "disabled" : ""}>${this.busy ? "Preparing battle…" : "Test Battle"}</button>
        ${supportsAutomaticTestBattle(this.project) ? "" : '<div class="battle-environment-status">Instant battles require US White 2.</div>'}
      </section>
      <section class="battle-camera-controls">
        <div class="battle-background-sidebar-title">Shared battle camera <span data-camera-state></span></div>
        ${this.camera ? `<label class="battle-background-selector">Placement<select class="filter-input" aria-label="Camera placement" data-camera-preset>${this.camera.presets.map(p => `<option value="${p.id}" ${p.id === this.presetId ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}</select></label>
          <div class="battle-camera-fields" data-camera-fields></div>
          <div class="battle-camera-actions"><button type="button" class="btn -default" data-camera-capture>Use preview</button><button type="button" class="btn -default" data-camera-revert>Revert</button><button type="button" class="btn -default" data-camera-save>Save camera</button></div>`
          : `<div class="battle-environment-status">${escapeHtml(this.cameraError ?? "Camera editing unavailable.")}</div>`}
      </section>
      <div class="battle-environment-status" role="status" aria-live="polite" data-environment-status></div>`;
    host.querySelector<HTMLSelectElement>("[data-environment-background]")?.addEventListener("change", event => {
      this.background = this.backgrounds?.variants.find(v => key(v) === (event.target as HTMLSelectElement).value);
      changed("backgrounds");
    });
    host.querySelector<HTMLSelectElement>("[data-environment-platform]")?.addEventListener("change", event => {
      this.platform = this.platforms?.variants.find(v => key(v) === (event.target as HTMLSelectElement).value);
      changed("platforms");
    });
    host.querySelector<HTMLInputElement>("[data-environment-trainer]")?.addEventListener("input", event => { this.trainerId = (event.target as HTMLInputElement).valueAsNumber; });
    host.querySelector<HTMLInputElement>("[data-environment-trainer]")?.addEventListener("change", () => changed("platforms"));
    host.querySelector("[data-camera-preset]")?.addEventListener("change", event => {
      this.presetId = (event.target as HTMLSelectElement).value;
      this.renderFields(); this.previewCamera();
    });
    host.querySelector("[data-camera-capture]")?.addEventListener("click", () => {
      const pose = this.renderer()?.getCameraPose();
      if (!pose) return;
      this.drafts.set(this.presetId, pose); this.renderFields(); this.previewCamera();
    });
    host.querySelector("[data-camera-revert]")?.addEventListener("click", () => {
      this.drafts.delete(this.presetId); this.renderFields(); this.previewCamera(); this.status("");
    });
    host.querySelector("[data-camera-save]")?.addEventListener("click", () => {
      try {
        const pose = this.pose();
        if (!this.camera || !pose) return;
        updateBattleCamera(this.project, this.camera, this.presetId, pose);
        this.drafts.delete(this.presetId); this.renderFields(); this.previewCamera(); this.options.onDirty?.(); this.status("Camera saved.");
      } catch (error) { this.status(message(error)); }
    });
    host.querySelector("[data-environment-test]")?.addEventListener("click", () => { void this.test(); });
    this.renderFields();
  }

  previewCamera(): void {
    const pose = this.pose();
    if (!pose) return;
    try { validateBattleCameraPose(pose); if (this.previewPlacement) this.previewPlacement(); else this.renderer()?.setBattleCamera(pose); }
    catch { /* Keep the last valid view while a coordinate is being typed. */ }
  }

  get trainer(): number { return this.trainerId; }
  get cameraPresets() { return this.camera?.presets.map(preset => ({ ...preset, ...this.drafts.get(preset.id) })) ?? []; }
  get placementPose(): BattleCameraPose { return this.pose() ?? this.defaultPose; }
  get defaultPose(): BattleCameraPose { return this.drafts.get("default") ?? this.camera?.presets.find(p => p.id === "default") ?? { position: { x: 6.7, y: 6.7, z: 17.3 }, target: { x: 0, y: 2.6, z: 0 } }; }

  private pose(): BattleCameraPose | undefined { return this.drafts.get(this.presetId) ?? this.camera?.presets.find(p => p.id === this.presetId); }

  private renderFields(): void {
    const host = this.host?.querySelector<HTMLElement>("[data-camera-fields]"), pose = this.pose();
    if (!host || !pose) return;
    host.innerHTML = ["position", "target"].map(kind => `<fieldset><legend>${kind === "position" ? "Position" : "Look at"}</legend><div>${["x", "y", "z"].map(axis => `<label>${axis.toUpperCase()}<input type="number" class="filter-input" step="any" data-camera-vector="${kind}" data-camera-axis="${axis}" value="${Number(pose[kind as keyof BattleCameraPose][axis as "x" | "y" | "z"].toFixed(4))}"></label>`).join("")}</div></fieldset>`).join("");
    for (const input of host.querySelectorAll<HTMLInputElement>("input")) input.addEventListener("input", () => {
      const next = structuredClone(this.pose()!);
      next[input.dataset.cameraVector as keyof BattleCameraPose][input.dataset.cameraAxis as "x" | "y" | "z"] = input.valueAsNumber;
      this.drafts.set(this.presetId, next); this.updateDraftState(); this.previewCamera();
    });
    this.updateDraftState();
  }

  private updateDraftState(): void {
    const state = this.host?.querySelector<HTMLElement>("[data-camera-state]");
    if (state) state.textContent = this.drafts.has(this.presetId) ? "Unsaved" : "Saved";
  }

  private status(text: string): void {
    const host = this.host?.querySelector<HTMLElement>("[data-environment-status]");
    if (host) host.textContent = text;
  }

  private async test(): Promise<void> {
    if (this.busy || !this.background || !this.options.onTest) return;
    const input = this.host?.querySelector<HTMLInputElement>("[data-environment-trainer]");
    if (input && !input.reportValidity()) return;
    const pose = this.pose();
    try {
      if (pose) validateBattleCameraPose(pose);
      this.busy = true;
      this.updateTestButton(); this.status("Preparing battle…");
      await this.options.onTest({ trainerId: this.trainerId, backgroundIndex: this.background.tableIndex,
        backgroundSeasonIndex: this.background.seasonIndex, platformIndex: this.platform?.tableIndex,
        platformSeasonIndex: this.platform?.seasonIndex, camera: pose ? { presetId: this.presetId, pose: structuredClone(pose) } : undefined });
      this.status("Battle launched.");
    } catch (error) { this.status(message(error)); }
    finally { this.busy = false; this.updateTestButton(); }
  }

  private updateTestButton(): void {
    const button = this.host?.querySelector<HTMLButtonElement>("[data-environment-test]");
    if (button) { button.disabled = this.busy; button.textContent = this.busy ? "Preparing battle…" : "Test Battle"; }
  }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
