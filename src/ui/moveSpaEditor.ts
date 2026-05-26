import { parseMoveAnimationScript } from "../pokeweb/moveAnimationModel";
import { loadMoveSpaArchive } from "../pokeweb/moveAnimationPreviewModel";
import { exportMoveSpaArchive, updateMoveSpaArchive } from "../pokeweb/moveSpaModel";
import type {
  SpaAlphaAnim,
  SpaArchive,
  SpaBehavior,
  SpaChildResource,
  SpaColorAnim,
  SpaResource,
  SpaScaleAnim,
  SpaTexAnim,
} from "../pokeweb/nitroSpa";
import { parseSpaArchive } from "../pokeweb/nitroSpa";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const SPA_COMMANDS = new Set([
  "LoadSPA",
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPACircleAnimation",
]);

const EMISSION_TYPES = ["Point", "Sphere Surface", "Circle Border", "Circle Border Uniform", "Sphere", "Circle", "Cylinder Surface", "Cylinder", "Hemisphere Surface", "Hemisphere"];
const DRAW_TYPES = ["Billboard", "Directional Billboard", "Polygon", "Directional Polygon", "Directional Polygon Center"];
const EMISSION_AXES = ["Z", "Y", "X", "Emitter"];
const POLYGON_ROT_AXES = ["Y", "XYZ"];
const CHILD_ROTATION_TYPES = ["None", "Inherit Angle", "Inherit Angle + Velocity"];
let activeOpenSections: Set<string> | undefined;

type SpaFieldHelp = {
  title: string;
  body: string;
  values?: string[];
  notes?: string[];
};

const FIELD_HELP: Record<string, SpaFieldHelp> = {
  "resource.emissionType": {
    title: "Emission Type",
    body: "Chooses the shape that new particles spawn from. This only controls the starting positions; velocity and behaviors decide where particles travel after they appear.",
    values: [
      "Point: every particle starts at the emitter center. Useful for flashes, hits, sparks, and single sprite effects.",
      "Sphere Surface: particles start on the outside of a sphere. Useful for burst shells or a ring of energy in 3D.",
      "Circle Border: particles start around the edge of a circle. Useful for rings, shockwaves, and halos.",
      "Circle Border Uniform: like Circle Border, but spacing is more even. Useful when the ring should look deliberate instead of random.",
      "Sphere: particles start anywhere inside a sphere. Useful for clouds, glows, smoke balls, and dense explosions.",
      "Circle: particles start anywhere inside a flat disk. Useful for ground splashes, impact marks, or flat area effects.",
      "Cylinder Surface: particles start on the outside wall of a cylinder. Useful for columns, tubes, or vertical walls of particles.",
      "Cylinder: particles start anywhere inside a cylinder. Useful for volume columns like water, smoke, or energy shafts.",
      "Hemisphere Surface: particles start on half of a sphere's outside. Useful for dome bursts or effects that should face one direction.",
      "Hemisphere: particles start anywhere inside half of a sphere. Useful for one-sided clouds or impact sprays.",
    ],
  },
  "resource.emissionAxis": {
    title: "Emission Axis",
    body: "Chooses which direction counts as the emitter's main axis when using circle, cylinder, hemisphere, and directional movement.",
    values: ["Z: depth axis.", "Y: vertical axis.", "X: horizontal axis.", "Emitter: use the custom Axis X/Y/Z vector below."],
  },
  "resource.emitterBasePos": {
    title: "Emitter Base Position",
    body: "Offsets the whole emitter away from the script's spawn point. Think of it as nudging the particle source before any particles are created.",
    notes: ["X moves left/right, Y moves up/down, and Z moves nearer/farther in the preview scene."],
  },
  "resource.emitterLifeFrames": {
    title: "Emitter Lifetime Frames",
    body: "How long the emitter keeps producing new particles. Existing particles can remain visible after this ends until their own lifetime runs out.",
    notes: ["The game runs these effects at about 30 frames per second, so 30 frames is roughly one second."],
  },
  "resource.emissionCount": {
    title: "Emission Amount",
    body: "How many particles are created each time the emitter fires.",
    notes: ["Large values can quickly make effects dense or expensive to preview."],
  },
  "resource.emissionIntervalFrames": {
    title: "Emission Interval",
    body: "How many frames pass between each emission. Lower numbers create particles more often.",
    values: ["0: emit immediately/continuously in this preview.", "1: emit every frame.", "30: emit about once per second."],
  },
  "resource.startDelayFrames": {
    title: "Start Delay",
    body: "How many frames the emitter waits before it starts making particles.",
  },
  "resource.radius": {
    title: "Radius",
    body: "Controls how wide circular, spherical, and cylindrical spawn shapes are.",
  },
  "resource.length": {
    title: "Length",
    body: "Controls how long cylinder-shaped emitters are along their main axis.",
  },
  "resource.axis": {
    title: "Axis",
    body: "A custom direction vector for directional emitters and movement. It is most noticeable when Emission Axis is set to Emitter.",
    notes: ["A vector of 0, 1, 0 points upward. A vector of 1, 0, 0 points sideways."],
  },
  "resource.drawType": {
    title: "Draw Type",
    body: "Chooses how each particle sprite faces the camera or its motion direction.",
    values: [
      "Billboard: always faces the camera. Most common for particles.",
      "Directional Billboard: faces the camera but also turns along movement direction.",
      "Polygon: uses a flat polygon with its own orientation.",
      "Directional Polygon: polygon aligned to particle direction.",
      "Directional Polygon Center: directional polygon centered around movement.",
    ],
  },
  "resource.textureIndex": {
    title: "Texture Index",
    body: "Which texture image this particle uses from the SPA texture list.",
  },
  "resource.hasRotation": {
    title: "Rotate",
    body: "Allows each particle to spin over time using the Min Rotation and Max Rotation values.",
  },
  "resource.randomInitAngle": {
    title: "Random Init Angle",
    body: "Starts particles at random rotations instead of all using the same initial angle.",
  },
  "resource.followEmitter": {
    title: "Follow Emitter",
    body: "Keeps particles attached to the emitter as it moves, instead of leaving them behind in world space.",
  },
  "resource.color": {
    title: "Color",
    body: "Tint color applied to the particle texture. White keeps the texture closest to its original colors.",
  },
  "resource.baseScale": {
    title: "Base Scale",
    body: "Starting size of each particle before animation and script scale are applied.",
  },
  "resource.initAngle": {
    title: "Init Angle",
    body: "Starting rotation angle for particles when Random Init Angle is off.",
  },
  "resource.baseAlpha": {
    title: "Base Alpha",
    body: "Overall opacity of the particle. 0 is invisible and 1 is fully visible.",
  },
  "resource.particleLifeFrames": {
    title: "Particle Lifetime",
    body: "How long each individual particle stays alive after it spawns.",
  },
  "resource.aspectRatio": {
    title: "Aspect Ratio",
    body: "Stretches the particle texture wider or taller without changing its base scale.",
  },
  "resource.initVelPosAmplifier": {
    title: "Init Velocity Pos",
    body: "Adds starting speed away from the particle's spawn position. Higher values make particles burst outward more strongly.",
  },
  "resource.initVelAxisAmplifier": {
    title: "Init Velocity Axis",
    body: "Adds starting speed along the emitter axis. Useful for streams, jets, and directional sprays.",
  },
  "resource.minRotation": {
    title: "Min Rotation Speed",
    body: "Lowest spin speed a particle can randomly receive when Rotate is enabled.",
  },
  "resource.maxRotation": {
    title: "Max Rotation Speed",
    body: "Highest spin speed a particle can randomly receive when Rotate is enabled.",
  },
  "resource.variance.baseScale": {
    title: "Variance Scale",
    body: "Randomizes particle size. 0 keeps sizes consistent; higher values make some particles smaller or larger.",
  },
  "resource.variance.lifeTime": {
    title: "Variance Life",
    body: "Randomizes how long particles live. Higher values create more natural uneven fading.",
  },
  "resource.variance.initVel": {
    title: "Variance Velocity",
    body: "Randomizes particle starting speed. Higher values make the motion less uniform.",
  },
  "resource.airResistance": {
    title: "Air Resistance",
    body: "How much particle velocity is damped over time. Lower values slow particles more; higher values preserve motion.",
  },
  "resource.loopFrames": {
    title: "Loop Frames",
    body: "How long one cycle of looped particle animation lasts.",
  },
  "resource.randomizeLoopedAnim": {
    title: "Randomize Looped Anim",
    body: "Starts looped animations at different points per particle so they do not all animate in sync.",
  },
  "resource.textureTileCountS": {
    title: "Texture Tile S",
    body: "Repeats the texture horizontally across the particle polygon.",
  },
  "resource.textureTileCountT": {
    title: "Texture Tile T",
    body: "Repeats the texture vertically across the particle polygon.",
  },
  "resource.flipTextureS": {
    title: "Flip X",
    body: "Mirrors the particle texture horizontally.",
  },
  "resource.flipTextureT": {
    title: "Flip Y",
    body: "Mirrors the particle texture vertically.",
  },
  "resource.polygonX": {
    title: "Polygon X Offset",
    body: "Offsets polygon-style particles horizontally within their own sprite plane.",
  },
  "resource.polygonY": {
    title: "Polygon Y Offset",
    body: "Offsets polygon-style particles vertically within their own sprite plane.",
  },
  "resource.hideParent": {
    title: "Hide Parent",
    body: "Hides the main particle and only renders child particles. Useful for emitters that exist just to spawn smaller particles.",
  },
  "scaleAnim.start": { title: "Start Scale", body: "Particle size at the beginning of the scale animation." },
  "scaleAnim.mid": { title: "Mid Scale", body: "Particle size around the middle of the scale animation." },
  "scaleAnim.end": { title: "End Scale", body: "Particle size at the end of the scale animation." },
  "alphaAnim.start": { title: "Start Alpha", body: "Particle opacity at the beginning of the alpha animation." },
  "alphaAnim.mid": { title: "Mid Alpha", body: "Particle opacity around the middle of the alpha animation." },
  "alphaAnim.end": { title: "End Alpha", body: "Particle opacity at the end of the alpha animation." },
  "texAnim.textureCount": { title: "Texture Count", body: "How many texture frames are used by this texture animation." },
  "texAnim.step": { title: "Texture Animation Step", body: "How quickly the texture animation advances through its frame list." },
  "behavior.magnitude": { title: "Behavior Magnitude", body: "Strength and direction for this behavior. X/Y/Z values describe the direction of the force." },
  "behavior.force": { title: "Behavior Force", body: "Overall pull or push strength for this behavior." },
  "behavior.target": { title: "Behavior Target", body: "The point that magnet or convergence behavior pulls particles toward." },
  "selector.archive": {
    title: "SPA",
    body: "The particle archive referenced by the current move animation script. A move can load one or more SPA files, and each SPA contains emitters plus textures.",
  },
  "selector.resource": {
    title: "Emitter",
    body: "The emitter resource inside the selected SPA. Each emitter describes one particle effect, such as a flash, smoke puff, leaf, flame, splash, or projectile trail.",
  },
};

export type MoveSpaEditorController = {
  ensureReferences: (scriptText: string) => Promise<void>;
  setSpaIds: (spaIds: number[], selectedSpaId?: number) => Promise<void>;
  getArchiveOverride: (spaId: number) => SpaArchive | undefined;
  hasDirtyArchives: () => boolean;
};

type MoveSpaEditorOptions = {
  onDirty?: () => void;
};

export type MoveSpaEditorDataSource = {
  loadArchive: (spaId: number) => Promise<SpaArchive> | SpaArchive;
  updateArchive: (spaId: number, archive: SpaArchive) => Promise<Uint8Array> | Uint8Array;
  exportArchive: (spaId: number, archiveOverride?: SpaArchive) => Promise<Uint8Array> | Uint8Array;
  referencedSpaIds?: (scriptText: string) => number[];
  emptyLabel?: string;
  loadingLabel?: string;
  selectorLabel?: string;
};

type State = {
  source: MoveSpaEditorDataSource;
  host: HTMLElement;
  spaIds: number[];
  archives: Map<number, SpaArchive>;
  dirtySpaIds: Set<number>;
  selectedSpaId?: number;
  selectedResourceIndex: number;
  selectedTextureIndex: number;
  loading: boolean;
  saving: boolean;
  scriptText: string;
  explicitSpaIds?: number[];
  openSections: Set<string>;
  error?: string;
  status?: string;
};

type EditableTarget = "resource" | "scaleAnim" | "colorAnim" | "alphaAnim" | "texAnim" | "child" | "behavior" | "texture";

export function installMoveSpaEditor(host: HTMLElement, project: ProjectState, scriptText: string, options: MoveSpaEditorOptions = {}): MoveSpaEditorController {
  return installMoveSpaEditorWithSource(
    host,
    scriptText,
    {
      loadArchive: (spaId) => loadMoveSpaArchive(project, spaId),
      updateArchive: (spaId, archive) => updateMoveSpaArchive(project, spaId, archive),
      exportArchive: (spaId, archive) => exportMoveSpaArchive(project, spaId, archive),
      referencedSpaIds,
      emptyLabel: "No SPA commands are referenced by the current script.",
      loadingLabel: "Loading referenced SPA archives...",
      selectorLabel: "referenced SPA archive",
    },
    options,
  );
}

export function installMoveSpaEditorWithSource(
  host: HTMLElement,
  scriptText: string,
  source: MoveSpaEditorDataSource,
  options: MoveSpaEditorOptions = {},
): MoveSpaEditorController {
  const state: State = {
    source,
    host,
    spaIds: [],
    archives: new Map(),
    dirtySpaIds: new Set(),
    selectedResourceIndex: 0,
    selectedTextureIndex: 0,
    loading: false,
    saving: false,
    scriptText,
    openSections: new Set(["emitter", "particle"]),
  };

  host.addEventListener("click", (event) => {
    const help = (event.target as HTMLElement).closest<HTMLElement>("[data-spa-help]");
    if (help) {
      event.preventDefault();
      showFieldHelp(host, help.dataset.spaHelp ?? "", help.textContent?.trim() ?? "SPA Field");
      return;
    }
    const selectButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-spa-select='texture']");
    if (selectButton) {
      state.selectedTextureIndex = Number(selectButton.value);
      render(state);
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-spa-action]");
    if (!button) return;
    void handleAction(state, button.dataset.spaAction ?? "", options);
  });
  host.addEventListener("change", (event) => handleFieldEvent(state, event));
  host.addEventListener("input", (event) => handleFieldEvent(state, event));
  host.addEventListener(
    "toggle",
    (event) => {
      const detail = event.target instanceof HTMLDetailsElement ? event.target : undefined;
      const section = detail?.dataset.spaSection;
      if (!section) return;
      if (detail.open) state.openSections.add(section);
      else state.openSections.delete(section);
    },
    true,
  );
  render(state);
  void ensureReferences(state, scriptText, false);

  return {
    ensureReferences: (nextScriptText) => ensureReferences(state, nextScriptText, true),
    setSpaIds: (spaIds, selectedSpaId) => {
      state.explicitSpaIds = spaIds.slice();
      return ensureSpaIds(state, spaIds, true, selectedSpaId);
    },
    getArchiveOverride: (spaId) => state.archives.get(spaId),
    hasDirtyArchives: () => state.dirtySpaIds.size > 0,
  };
}

async function ensureReferences(state: State, scriptText: string, preserveExisting: boolean): Promise<void> {
  state.scriptText = scriptText;
  state.explicitSpaIds = undefined;
  const spaIds = (state.source.referencedSpaIds ?? referencedSpaIds)(scriptText);
  await ensureSpaIds(state, spaIds, preserveExisting);
}

async function ensureSpaIds(state: State, spaIds: number[], preserveExisting: boolean, selectedSpaId?: number): Promise<void> {
  const uniqueSpaIds = [...new Set(spaIds.filter((spaId) => Number.isInteger(spaId) && spaId >= 0))].sort((a, b) => a - b);
  const missing = uniqueSpaIds.filter((spaId) => !state.archives.has(spaId));
  if (!missing.length && arrayEqual(uniqueSpaIds, state.spaIds)) {
    if (selectedSpaId !== undefined && state.archives.has(selectedSpaId)) {
      state.selectedSpaId = selectedSpaId;
      render(state);
    }
    return;
  }
  state.loading = true;
  state.error = undefined;
  state.spaIds = uniqueSpaIds;
  if (!preserveExisting) {
    state.archives.clear();
    state.dirtySpaIds.clear();
  }
  render(state);
  try {
    for (const spaId of missing) {
      state.archives.set(spaId, cloneArchive(await state.source.loadArchive(spaId)));
    }
    for (const spaId of [...state.archives.keys()]) {
      if (!uniqueSpaIds.includes(spaId) && !state.dirtySpaIds.has(spaId)) state.archives.delete(spaId);
    }
    state.selectedSpaId =
      selectedSpaId !== undefined && state.archives.has(selectedSpaId)
        ? selectedSpaId
        : state.selectedSpaId !== undefined && state.archives.has(state.selectedSpaId)
          ? state.selectedSpaId
          : uniqueSpaIds[0];
    state.selectedResourceIndex = 0;
    state.selectedTextureIndex = 0;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render(state);
  }
}

function referencedSpaIds(scriptText: string): number[] {
  try {
    const parsed = parseMoveAnimationScript(scriptText);
    const ids = new Set<number>();
    for (const commands of parsed.scripts.values()) {
      for (const command of commands) {
        if (SPA_COMMANDS.has(command.name) && command.params.length > 0) ids.add(command.params[0] ?? 0);
      }
    }
    return [...ids].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function handleAction(state: State, action: string, options: MoveSpaEditorOptions): Promise<void> {
  const archive = currentArchive(state);
  const resource = currentResource(state);
  if (action === "reload") {
    if (state.dirtySpaIds.size > 0 && !window.confirm("Discard unsaved SPA edits and reload referenced SPA files?")) return;
    state.archives.clear();
    state.dirtySpaIds.clear();
    state.selectedSpaId = undefined;
    state.status = undefined;
    render(state);
    if (state.explicitSpaIds) await ensureSpaIds(state, state.explicitSpaIds, false, state.selectedSpaId);
    else await ensureReferences(state, state.scriptText, false);
    return;
  }
  if (action === "import") {
    state.host.querySelector<HTMLInputElement>("[data-spa-import-file]")?.click();
    return;
  }
  if (!archive || state.selectedSpaId === undefined) return;
  if (action === "save") {
    state.saving = true;
    state.error = undefined;
    state.status = "Saving SPA edits...";
    render(state);
    try {
      await state.source.updateArchive(state.selectedSpaId, archive);
      state.dirtySpaIds.delete(state.selectedSpaId);
      state.status = `Saved SPA ${state.selectedSpaId}`;
      options.onDirty?.();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = undefined;
    } finally {
      state.saving = false;
      render(state);
    }
    return;
  }
  if (action === "export") {
    try {
      const bytes = await state.source.exportArchive(state.selectedSpaId, archive);
      downloadBytes(bytes, `spa_${state.selectedSpaId}.spa`);
      state.status = `Exported SPA ${state.selectedSpaId}`;
      render(state);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      render(state);
    }
    return;
  }
  if (action === "export-texture") {
    try {
      await exportSelectedTexture(state, archive);
      state.status = `Exported texture ${state.selectedTextureIndex}`;
      state.error = undefined;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    render(state);
    return;
  }
  if (!resource) return;

  if (action === "add-scale") resource.scaleAnim = defaultScaleAnim();
  if (action === "remove-scale") resource.scaleAnim = undefined;
  if (action === "add-color") resource.colorAnim = defaultColorAnim(resource.color);
  if (action === "remove-color") resource.colorAnim = undefined;
  if (action === "add-alpha") resource.alphaAnim = defaultAlphaAnim(resource.baseAlpha);
  if (action === "remove-alpha") resource.alphaAnim = undefined;
  if (action === "add-tex") resource.texAnim = defaultTexAnim(resource.textureIndex);
  if (action === "remove-tex") resource.texAnim = undefined;
  if (action === "add-child") resource.childResource = defaultChildResource(resource.textureIndex);
  if (action === "remove-child") resource.childResource = undefined;
  if (action.startsWith("add-behavior:")) resource.behaviors.push(defaultBehavior(action.slice("add-behavior:".length)));
  if (action.startsWith("remove-behavior:")) resource.behaviors.splice(Number(action.slice("remove-behavior:".length)), 1);

  markDirty(state);
  render(state);
}

function handleFieldEvent(state: State, event: Event): void {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (input instanceof HTMLInputElement && input.dataset.spaImportFile !== undefined) {
    const file = input.files?.[0];
    if (file) void importSelectedArchive(state, file);
    input.value = "";
    return;
  }
  if (input instanceof HTMLInputElement && input.dataset.spaTextureImport !== undefined) {
    const file = input.files?.[0];
    if (file) void replaceSelectedTexture(state, file);
    return;
  }
  if (!input.dataset.spaField && !input.dataset.spaSelect) return;

  if (input.dataset.spaSelect === "archive") {
    state.selectedSpaId = Number(input.value);
    state.selectedResourceIndex = 0;
    state.selectedTextureIndex = 0;
    render(state);
    return;
  }
  if (input.dataset.spaSelect === "resource") {
    state.selectedResourceIndex = Number(input.value);
    render(state);
    return;
  }
  if (input.dataset.spaSelect === "texture") {
    state.selectedTextureIndex = Number(input.value);
    render(state);
    return;
  }

  const target = input.dataset.spaTarget as EditableTarget | undefined;
  const field = input.dataset.spaField;
  if (!target || !field) return;
  const subject = targetObject(state, target, Number(input.dataset.behaviorIndex ?? 0));
  if (!subject) return;
  setPathValue(subject, field, readInputValue(input));
  markDirty(state);
  updateDerivedFlags(state);
  render(state);
}

function render(state: State): void {
  syncOpenSections(state);
  activeOpenSections = state.openSections;
  const archive = currentArchive(state);
  const resource = currentResource(state);
  const fileLabel = state.selectedSpaId === undefined ? "" : ` - File ${state.selectedSpaId}${state.dirtySpaIds.has(state.selectedSpaId) ? " *" : ""}`;
  const canUseSelected = archive !== undefined && state.selectedSpaId !== undefined;
  state.host.innerHTML = `
    <div class="move-spa-editor">
      <div class="move-spa-editor-header">
        <div>
          <h4>SPA Particle Editor${fileLabel}</h4>
          <span>${state.status ? escapeHtml(state.status) : state.loading ? escapeHtml(state.source.loadingLabel ?? "Loading SPA archives...") : `${state.spaIds.length} ${escapeHtml(state.source.selectorLabel ?? "SPA archive")}${state.spaIds.length === 1 ? "" : "s"}`}</span>
        </div>
        <div class="move-spa-header-actions">
          <button class="script-btn" data-spa-action="save" type="button" ${canUseSelected && state.dirtySpaIds.has(state.selectedSpaId!) && !state.saving ? "" : "disabled"}>Save SPA Edits</button>
          <button class="script-btn" data-spa-action="import" type="button" ${canUseSelected ? "" : "disabled"}>Import SPA</button>
          <button class="script-btn" data-spa-action="export" type="button" ${canUseSelected ? "" : "disabled"}>Export SPA</button>
          <button class="script-btn" data-spa-action="reload" type="button">Reload</button>
        </div>
        <input data-spa-import-file type="file" accept=".spa,application/octet-stream" hidden>
      </div>
      ${state.error ? `<div class="move-spa-error">${escapeHtml(state.error)}</div>` : ""}
      ${renderSelectors(state, archive)}
      ${archive && resource ? renderResourceEditor(archive, resource, state.selectedTextureIndex) : renderEmptyState(state)}
    </div>
  `;
  drawTextureCanvases(state);
}

function syncOpenSections(state: State): void {
  state.host.querySelectorAll<HTMLDetailsElement>("details[data-spa-section]").forEach((detail) => {
    const section = detail.dataset.spaSection;
    if (!section) return;
    if (detail.open) state.openSections.add(section);
    else state.openSections.delete(section);
  });
}

function renderSelectors(state: State, archive?: SpaArchive): string {
  if (!state.spaIds.length) return "";
  const controls = [
    state.spaIds.length > 1
      ? `<label>${fieldHelpButton("SPA", "selector", "archive")}
        <select data-spa-select="archive">
          ${state.spaIds.map((spaId) => `<option value="${spaId}" ${spaId === state.selectedSpaId ? "selected" : ""}>${spaId}${state.dirtySpaIds.has(spaId) ? " *" : ""}</option>`).join("")}
        </select>
      </label>`
      : "",
    (archive?.resources.length ?? 0) > 1
      ? `<label>${fieldHelpButton("Emitter", "selector", "resource")}
        <select data-spa-select="resource">
          ${(archive?.resources ?? []).map((resource) => `<option value="${resource.index}" ${resource.index === state.selectedResourceIndex ? "selected" : ""}>${resource.index}</option>`).join("")}
        </select>
      </label>`
      : "",
  ].filter(Boolean);
  return controls.length ? `<div class="move-spa-selectors">${controls.join("")}</div>` : "";
}

function renderEmptyState(state: State): string {
  if (state.loading) return `<div class="move-spa-empty">Loading particle data...</div>`;
  if (!state.spaIds.length) return `<div class="move-spa-empty">${escapeHtml(state.source.emptyLabel ?? "No SPA archive is selected.")}</div>`;
  return `<div class="move-spa-empty">Choose a SPA archive to edit particle resources.</div>`;
}

function renderResourceEditor(archive: SpaArchive, resource: SpaResource, selectedTextureIndex: number): string {
  return `
    <div class="move-spa-editor-body">
      ${detailSection("emitter", "Emitter Settings", `
        <div class="move-spa-groups">
          ${fieldGroup("Spawn Shape", `
            <div class="move-spa-grid">
              ${selectField("Emission Type", "resource", "emissionType", resource.emissionType, EMISSION_TYPES)}
              ${selectField("Emission Axis", "resource", "emissionAxis", resource.emissionAxis, EMISSION_AXES)}
              ${numberField("Radius", "resource", "radius", resource.radius, 0.01)}
              ${numberField("Length", "resource", "length", resource.length, 0.01)}
            </div>
          `)}
          ${fieldGroup("Emitter Position", `
            <div class="move-spa-vector">
              ${numberField("X", "resource", "emitterBasePos.0", resource.emitterBasePos[0], 0.01)}
              ${numberField("Y", "resource", "emitterBasePos.1", resource.emitterBasePos[1], 0.01)}
              ${numberField("Z", "resource", "emitterBasePos.2", resource.emitterBasePos[2], 0.01)}
            </div>
          `)}
          ${fieldGroup("Emitter Direction Axis", `
            <div class="move-spa-vector">
              ${numberField("X", "resource", "axis.0", resource.axis[0], 0.01)}
              ${numberField("Y", "resource", "axis.1", resource.axis[1], 0.01)}
              ${numberField("Z", "resource", "axis.2", resource.axis[2], 0.01)}
            </div>
          `)}
          ${fieldGroup("Timing And Count", `
            <div class="move-spa-grid">
              ${numberField("Lifetime Frames", "resource", "emitterLifeFrames", resource.emitterLifeFrames, 1)}
              ${numberField("Start Delay", "resource", "startDelayFrames", resource.startDelayFrames, 1)}
              ${numberField("Emission Amount", "resource", "emissionCount", resource.emissionCount, 1)}
              ${numberField("Emission Interval", "resource", "emissionIntervalFrames", resource.emissionIntervalFrames, 1)}
            </div>
          `)}
        </div>
      `)}
      ${detailSection("particle", "Particle Settings", `
        <div class="move-spa-groups">
          ${fieldGroup("Visual", `
            <div class="move-spa-grid">
              ${selectField("Draw Type", "resource", "drawType", resource.drawType, DRAW_TYPES)}
              ${numberField("Texture Index", "resource", "textureIndex", resource.textureIndex, 1, 0, Math.max(0, archive.textures.length - 1))}
              ${colorField("Color", "resource", "color", resource.color)}
              ${numberField("Base Alpha", "resource", "baseAlpha", resource.baseAlpha, 0.01, 0, 1)}
              ${numberField("Base Scale", "resource", "baseScale", resource.baseScale, 0.01)}
              ${numberField("Aspect Ratio", "resource", "aspectRatio", resource.aspectRatio, 0.01)}
              ${checkboxField("Hide Parent", "resource", "hideParent", resource.hideParent)}
            </div>
          `)}
          ${fieldGroup("Motion", `
            <div class="move-spa-grid">
              ${numberField("Particle Lifetime", "resource", "particleLifeFrames", resource.particleLifeFrames, 1)}
              ${numberField("Init Velocity Pos", "resource", "initVelPosAmplifier", resource.initVelPosAmplifier, 0.01)}
              ${numberField("Init Velocity Axis", "resource", "initVelAxisAmplifier", resource.initVelAxisAmplifier, 0.01)}
              ${numberField("Air Resistance", "resource", "airResistance", resource.airResistance, 0.01)}
              ${checkboxField("Follow Emitter", "resource", "followEmitter", resource.followEmitter)}
            </div>
          `)}
          ${fieldGroup("Rotation", `
            <div class="move-spa-grid">
              ${checkboxField("Rotate", "resource", "hasRotation", resource.hasRotation)}
              ${checkboxField("Random Init Angle", "resource", "randomInitAngle", resource.randomInitAngle)}
              ${numberField("Init Angle", "resource", "initAngle", resource.initAngle, 0.01)}
              ${numberField("Min Rotation", "resource", "minRotation", resource.minRotation, 0.01)}
              ${numberField("Max Rotation", "resource", "maxRotation", resource.maxRotation, 0.01)}
              ${selectField("Polygon Rotation Axis", "resource", "scaleAnimDir", resource.scaleAnimDir, POLYGON_ROT_AXES)}
            </div>
          `)}
          ${fieldGroup("Randomness And Loops", `
            <div class="move-spa-grid">
              ${numberField("Variance Scale", "resource", "variance.baseScale", resource.variance.baseScale, 0.01, 0, 1)}
              ${numberField("Variance Life", "resource", "variance.lifeTime", resource.variance.lifeTime, 0.01, 0, 1)}
              ${numberField("Variance Velocity", "resource", "variance.initVel", resource.variance.initVel, 0.01, 0, 1)}
              ${numberField("Loop Frames", "resource", "loopFrames", resource.loopFrames, 1)}
              ${checkboxField("Randomize Looped Anim", "resource", "randomizeLoopedAnim", resource.randomizeLoopedAnim)}
            </div>
          `)}
          ${fieldGroup("Texture Mapping", `
            <div class="move-spa-grid">
              ${numberField("Texture Tile S", "resource", "textureTileCountS", resource.textureTileCountS, 1, 0, 3)}
              ${numberField("Texture Tile T", "resource", "textureTileCountT", resource.textureTileCountT, 1, 0, 3)}
              ${checkboxField("Flip X", "resource", "flipTextureS", resource.flipTextureS)}
              ${checkboxField("Flip Y", "resource", "flipTextureT", resource.flipTextureT)}
            </div>
          `)}
          ${fieldGroup("Polygon Offset", `
            <div class="move-spa-vector">
              ${numberField("X", "resource", "polygonX", resource.polygonX, 0.01)}
              ${numberField("Y", "resource", "polygonY", resource.polygonY, 0.01)}
            </div>
          `)}
        </div>
      `)}
      ${renderAnimations(resource)}
      ${renderChildResource(resource)}
      ${renderBehaviors(resource)}
      ${renderTextures(archive, selectedTextureIndex)}
    </div>
  `;
}

function renderAnimations(resource: SpaResource): string {
  return detailSection(
    "animations",
    "Animations",
    `
      ${resource.scaleAnim ? renderScaleAnim(resource.scaleAnim) : addButton("add-scale", "Add Scale Animation")}
      ${resource.colorAnim ? renderColorAnim(resource.colorAnim) : addButton("add-color", "Add Color Animation")}
      ${resource.alphaAnim ? renderAlphaAnim(resource.alphaAnim) : addButton("add-alpha", "Add Alpha Animation")}
      ${resource.texAnim ? renderTexAnim(resource.texAnim) : addButton("add-tex", "Add Texture Animation")}
    `,
  );
}

function renderScaleAnim(anim: SpaScaleAnim): string {
  return section("Scale Animation", "remove-scale", `
    <div class="move-spa-groups">
      ${fieldGroup("Scale Values", `<div class="move-spa-vector">${numberField("Start", "scaleAnim", "start", anim.start, 0.01)}${numberField("Mid", "scaleAnim", "mid", anim.mid, 0.01)}${numberField("End", "scaleAnim", "end", anim.end, 0.01)}</div>`)}
      ${fieldGroup("Timing Curve", `<div class="move-spa-grid">${numberField("Curve In", "scaleAnim", "curveIn", anim.curveIn, 0.01, 0, 1)}${numberField("Curve Out", "scaleAnim", "curveOut", anim.curveOut, 0.01, 0, 1)}${checkboxField("Loop", "scaleAnim", "loop", anim.loop)}</div>`)}
    </div>
  `);
}

function renderColorAnim(anim: SpaColorAnim): string {
  return section("Color Animation", "remove-color", `
    <div class="move-spa-groups">
      ${fieldGroup("Colors", `<div class="move-spa-grid">${colorField("Start Color", "colorAnim", "start", anim.start)}${colorField("End Color", "colorAnim", "end", anim.end)}</div>`)}
      ${fieldGroup("Timing Curve", `<div class="move-spa-grid">${numberField("Curve In", "colorAnim", "curveIn", anim.curveIn, 0.01, 0, 1)}${numberField("Curve Peak", "colorAnim", "curvePeak", anim.curvePeak, 0.01, 0, 1)}${numberField("Curve Out", "colorAnim", "curveOut", anim.curveOut, 0.01, 0, 1)}</div>`)}
      ${fieldGroup("Playback", `<div class="move-spa-grid">${checkboxField("Loop", "colorAnim", "loop", anim.loop)}${checkboxField("Interpolate", "colorAnim", "interpolate", anim.interpolate)}${checkboxField("Random Start", "colorAnim", "randomStartColor", anim.randomStartColor)}</div>`)}
    </div>
  `);
}

function renderAlphaAnim(anim: SpaAlphaAnim): string {
  return section("Alpha Animation", "remove-alpha", `
    <div class="move-spa-groups">
      ${fieldGroup("Opacity Values", `<div class="move-spa-vector">${numberField("Start", "alphaAnim", "start", anim.start, 0.01, 0, 1)}${numberField("Mid", "alphaAnim", "mid", anim.mid, 0.01, 0, 1)}${numberField("End", "alphaAnim", "end", anim.end, 0.01, 0, 1)}</div>`)}
      ${fieldGroup("Timing And Variation", `<div class="move-spa-grid">${numberField("Random Range", "alphaAnim", "randomRange", anim.randomRange, 0.01, 0, 1)}${numberField("Curve In", "alphaAnim", "curveIn", anim.curveIn, 0.01, 0, 1)}${numberField("Curve Out", "alphaAnim", "curveOut", anim.curveOut, 0.01, 0, 1)}${checkboxField("Loop", "alphaAnim", "loop", anim.loop)}</div>`)}
    </div>
  `);
}

function renderTexAnim(anim: SpaTexAnim): string {
  return section("Texture Animation", "remove-tex", `
    <div class="move-spa-groups">
      ${fieldGroup("Playback", `<div class="move-spa-grid">${numberField("Texture Count", "texAnim", "textureCount", anim.textureCount, 1, 1, 8)}${numberField("Step", "texAnim", "step", anim.step, 0.01, 0, 1)}${checkboxField("Randomize Start", "texAnim", "randomizeInit", anim.randomizeInit)}${checkboxField("Loop", "texAnim", "loop", anim.loop)}</div>`)}
      ${fieldGroup("Texture Frames", `<div class="move-spa-grid">${anim.textures.map((texture, index) => numberField(`Frame ${index}`, "texAnim", `textures.${index}`, texture, 1, 0)).join("")}</div>`)}
    </div>
  `);
}

function renderChildResource(resource: SpaResource): string {
  if (!resource.childResource) {
    return detailSection("child", "Child Resource", addButton("add-child", "Add Child Resource"));
  }
  const child = resource.childResource;
  return detailSection(
    "child",
    "Child Resource",
    `
      <button class="script-btn move-spa-remove" data-spa-action="remove-child" type="button">Remove Child Resource</button>
      <div class="move-spa-groups">
        ${fieldGroup("Parent Emission", `<div class="move-spa-grid">${numberField("Emission Amount", "child", "emissionCount", child.emissionCount, 1)}${numberField("Emission Delay", "child", "emissionDelay", child.emissionDelay, 0.01, 0, 1)}${numberField("Emission Interval", "child", "emissionIntervalFrames", child.emissionIntervalFrames, 1)}</div>`)}
        ${fieldGroup("Child Appearance", `<div class="move-spa-grid">${selectField("Draw Type", "child", "drawType", child.drawType, DRAW_TYPES)}${numberField("Texture Index", "child", "textureIndex", child.textureIndex, 1)}${colorField("Color", "child", "color", child.color)}${checkboxField("Use Color", "child", "useChildColor", child.useChildColor)}</div>`)}
        ${fieldGroup("Child Motion", `<div class="move-spa-grid">${checkboxField("Uses Behaviors", "child", "usesBehaviors", child.usesBehaviors)}${checkboxField("Follow Emitter", "child", "followEmitter", child.followEmitter)}${numberField("Lifetime Frames", "child", "lifeFrames", child.lifeFrames, 1)}${numberField("Initial Velocity Random", "child", "randomInitVelMag", child.randomInitVelMag, 0.01)}${numberField("Velocity Ratio", "child", "velocityRatio", child.velocityRatio, 0.01, 0, 1)}${numberField("Scale Ratio", "child", "scaleRatio", child.scaleRatio, 0.01)}</div>`)}
        ${fieldGroup("Child Rotation And Polygon", `<div class="move-spa-grid">${selectField("Child Rotation", "child", "rotationType", child.rotationType, CHILD_ROTATION_TYPES)}${selectField("Polygon Rotation Axis", "child", "polygonRotAxis", child.polygonRotAxis, POLYGON_ROT_AXES)}${numberField("Polygon Reference Plane", "child", "polygonReferencePlane", child.polygonReferencePlane, 1, 0, 1)}</div>`)}
        ${fieldGroup("Texture Mapping", `<div class="move-spa-grid">${numberField("Texture Tile S", "child", "textureTileCountS", child.textureTileCountS, 1, 0, 3)}${numberField("Texture Tile T", "child", "textureTileCountT", child.textureTileCountT, 1, 0, 3)}${checkboxField("DPol Face Emitter", "child", "dpolFaceEmitter", child.dpolFaceEmitter)}${checkboxField("Flip X", "child", "flipTextureS", child.flipTextureS)}${checkboxField("Flip Y", "child", "flipTextureT", child.flipTextureT)}</div>`)}
        ${fieldGroup("Child Animations", `<div class="move-spa-grid">${checkboxField("Scale Animation", "child", "hasScaleAnim", child.hasScaleAnim)}${numberField("End Scale", "child", "endScale", child.endScale, 0.01)}${checkboxField("Fade Out", "child", "hasAlphaAnim", child.hasAlphaAnim)}</div>`)}
      </div>
    `,
  );
}

function renderBehaviors(resource: SpaResource): string {
  return detailSection(
    "behaviors",
    "Behaviors",
    `
      <div class="move-spa-button-row">
        ${["gravity", "random", "magnet", "spin", "collision", "convergence"].map((type) => `<button class="script-btn" data-spa-action="add-behavior:${type}" type="button">Add ${title(type)}</button>`).join("")}
      </div>
      ${resource.behaviors.map((behavior, index) => renderBehavior(behavior, index)).join("") || `<div class="move-spa-empty -compact">No behaviors.</div>`}
    `,
  );
}

function renderBehavior(behavior: SpaBehavior, index: number): string {
  const remove = `<button class="script-btn move-spa-remove" data-spa-action="remove-behavior:${index}" type="button">Remove</button>`;
  const target = "behavior";
  if (behavior.type === "gravity") return section(`Gravity ${remove}`, undefined, `<div class="move-spa-groups">${fieldGroup("Force Direction", `<div class="move-spa-vector">${vecFields("Magnitude", target, "magnitude", behavior.magnitude, index)}</div>`)}</div>`);
  if (behavior.type === "random") return section(`Random ${remove}`, undefined, `<div class="move-spa-groups">${fieldGroup("Random Push", `<div class="move-spa-vector">${vecFields("Magnitude", target, "magnitude", behavior.magnitude, index)}</div>`)}${fieldGroup("Timing", `<div class="move-spa-grid">${numberField("Apply Interval", target, "applyIntervalFrames", behavior.applyIntervalFrames, 1, undefined, undefined, index)}</div>`)}</div>`);
  if (behavior.type === "magnet") return section(`Magnet ${remove}`, undefined, `<div class="move-spa-groups">${fieldGroup("Target Point", `<div class="move-spa-vector">${vecFields("Target", target, "target", behavior.target, index)}</div>`)}${fieldGroup("Strength", `<div class="move-spa-grid">${numberField("Force", target, "force", behavior.force, 0.01, undefined, undefined, index)}</div>`)}</div>`);
  if (behavior.type === "spin") return section(`Spin ${remove}`, undefined, `<div class="move-spa-groups">${fieldGroup("Spin", `<div class="move-spa-grid">${numberField("Angle", target, "angle", behavior.angle, 0.01, undefined, undefined, index)}${numberField("Axis", target, "axis", behavior.axis, 1, 0, 2, index)}</div>`)}</div>`);
  if (behavior.type === "collision") return section(`Collision Plane ${remove}`, undefined, `<div class="move-spa-groups">${fieldGroup("Plane", `<div class="move-spa-grid">${numberField("Height", target, "y", behavior.y, 0.01, undefined, undefined, index)}${numberField("Collision Type", target, "collisionType", behavior.collisionType, 1, 0, 1, index)}</div>`)}${fieldGroup("Bounce", `<div class="move-spa-grid">${numberField("Elasticity", target, "elasticity", behavior.elasticity, 0.01, 0, 2, index)}</div>`)}</div>`);
  return section(`Convergence ${remove}`, undefined, `<div class="move-spa-groups">${fieldGroup("Target Point", `<div class="move-spa-vector">${vecFields("Target", target, "target", behavior.target, index)}</div>`)}${fieldGroup("Strength", `<div class="move-spa-grid">${numberField("Force", target, "force", behavior.force, 0.01, undefined, undefined, index)}</div>`)}</div>`);
}

function renderTextures(archive: SpaArchive, selectedTextureIndex: number): string {
  const texture = archive.textures[selectedTextureIndex] ?? archive.textures[0];
  return detailSection(
    "textures",
    "Textures",
    `
      <div class="move-spa-texture-strip">
        ${archive.textures.map((tex) => `<button class="move-spa-texture-choice ${tex.index === selectedTextureIndex ? "-active" : ""}" type="button" data-spa-select="texture" value="${tex.index}"><canvas class="spa-texture-canvas" data-texture-index="${tex.index}"></canvas><span>${tex.index}</span></button>`).join("")}
      </div>
      ${
        texture
          ? `<div class="move-spa-texture-info">
              <canvas class="spa-texture-canvas -large" data-texture-index="${texture.index}"></canvas>
              <div>
                <div>Format: ${texture.format}</div>
                <div>Size: ${texture.width}x${texture.height}</div>
                <div>Texture bytes: ${texture.textureSize}</div>
                <div>Palette bytes: ${texture.paletteSize}</div>
                <div>4x4 index bytes: ${texture.paletteIndexSize}</div>
                <div>${texture.useSharedTexture ? `Shared texture: ${texture.sharedTexId}` : "Own texture data"}</div>
                ${texture.fallback ? `<div class="move-spa-error">${escapeHtml(texture.fallbackReason ?? "Fallback texture")}</div>` : ""}
                <label class="move-spa-texture-import">Replace selected texture
                  <input data-spa-texture-import type="file" accept="image/png,image/webp,image/jpeg,image/gif">
                </label>
                <button class="script-btn move-spa-texture-export" data-spa-action="export-texture" type="button">Export selected texture</button>
              </div>
            </div>`
          : ""
      }
    `,
  );
}

function section(titleText: string, removeAction: string | undefined, body: string): string {
  return `<div class="move-spa-subsection"><div class="move-spa-subsection-title"><strong>${titleText}</strong>${removeAction ? `<button class="script-btn move-spa-remove" data-spa-action="${removeAction}" type="button">Remove</button>` : ""}</div>${body}</div>`;
}

function detailSection(key: string, titleText: string, body: string): string {
  const open = activeOpenSections?.has(key) ? " open" : "";
  return `<details data-spa-section="${escapeHtml(key)}"${open}><summary>${escapeHtml(titleText)}</summary>${body}</details>`;
}

function fieldGroup(titleText: string, body: string): string {
  return `<div class="move-spa-field-group"><h5>${escapeHtml(titleText)}</h5>${body}</div>`;
}

function addButton(action: string, label: string): string {
  return `<button class="script-btn" data-spa-action="${action}" type="button">${label}</button>`;
}

function numberField(label: string, target: string, field: string, value: number, step: number, min?: number, max?: number, behaviorIndex?: number): string {
  return `<label>${fieldHelpButton(label, target, field)}<input data-spa-target="${target}" data-spa-field="${field}" ${behaviorIndex === undefined ? "" : `data-behavior-index="${behaviorIndex}"`} type="number" step="${step}" ${min === undefined ? "" : `min="${min}"`} ${max === undefined ? "" : `max="${max}"`} value="${Number.isFinite(value) ? value : 0}"></label>`;
}

function checkboxField(label: string, target: string, field: string, checked: boolean): string {
  return `<label class="move-spa-check"><input data-spa-target="${target}" data-spa-field="${field}" type="checkbox" ${checked ? "checked" : ""}>${fieldHelpButton(label, target, field)}</label>`;
}

function selectField(label: string, target: string, field: string, value: number, options: string[]): string {
  return `<label>${fieldHelpButton(label, target, field)}<select data-spa-target="${target}" data-spa-field="${field}">${options.map((option, index) => `<option value="${index}" ${index === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
}

function colorField(label: string, target: string, field: string, color: [number, number, number]): string {
  return `<label>${fieldHelpButton(label, target, field)}<input data-spa-target="${target}" data-spa-field="${field}" type="color" value="${rgbToHex(color)}"></label>`;
}

function vecFields(label: string, target: string, field: string, value: [number, number, number], behaviorIndex?: number): string {
  return [0, 1, 2].map((index) => numberField(`${label} ${["X", "Y", "Z"][index]}`, target, `${field}.${index}`, value[index], 0.01, undefined, undefined, behaviorIndex)).join("");
}

function fieldHelpButton(label: string, target: string, field: string): string {
  return `<button class="move-spa-field-help" data-spa-help="${escapeHtml(helpKey(target, field))}" type="button">${escapeHtml(label)}</button>`;
}

function helpKey(target: string, field: string): string {
  const normalized = field.replace(/\.\d+$/u, "");
  const exact = `${target}.${normalized}`;
  if (FIELD_HELP[exact]) return exact;
  const base = normalized.split(".").at(-1) ?? normalized;
  const fallback = `${target}.${base}`;
  return FIELD_HELP[fallback] ? fallback : exact;
}

function showFieldHelp(host: HTMLElement, key: string, fallbackTitle: string): void {
  const sidebar = host.ownerDocument.querySelector<HTMLElement>("#move-command-reference");
  if (!sidebar) return;
  const help = FIELD_HELP[key] ?? {
    title: fallbackTitle,
    body: "This SPA field changes how the selected particle emitter behaves in the move preview. Try small changes first, then press Preview to compare the result.",
  };
  sidebar.innerHTML = `
    <div class="move-command-reference-kicker">SPA particle field</div>
    <div class="move-command-reference-title">${escapeHtml(help.title)}</div>
    <p>${escapeHtml(help.body)}</p>
    ${help.values?.length ? `<div class="move-command-reference-notes"><div>Values</div><ul>${help.values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>` : ""}
    ${help.notes?.length ? `<div class="move-command-reference-notes"><div>Notes</div><ul>${help.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>` : ""}
  `;
}

function targetObject(state: State, target: EditableTarget, behaviorIndex: number): unknown {
  const resource = currentResource(state);
  const archive = currentArchive(state);
  if (!resource) return undefined;
  if (target === "resource") return resource;
  if (target === "scaleAnim") return resource.scaleAnim;
  if (target === "colorAnim") return resource.colorAnim;
  if (target === "alphaAnim") return resource.alphaAnim;
  if (target === "texAnim") return resource.texAnim;
  if (target === "child") return resource.childResource;
  if (target === "behavior") return resource.behaviors[behaviorIndex];
  if (target === "texture") return archive?.textures[state.selectedTextureIndex];
  return undefined;
}

function readInputValue(input: HTMLInputElement | HTMLSelectElement): unknown {
  if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
  if (input instanceof HTMLInputElement && input.type === "color") return hexToRgb(input.value);
  return Number(input.value);
}

function setPathValue(target: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]] as Record<string, unknown>;
  cursor[parts[parts.length - 1]] = value;
}

function updateDerivedFlags(state: State): void {
  const resource = currentResource(state);
  if (!resource) return;
  resource.emissionCount = Math.max(0, Math.round(resource.emissionCount));
  resource.textureIndex = clampInt(resource.textureIndex, 0, Math.max(0, (currentArchive(state)?.textures.length ?? 1) - 1));
  resource.emitterLifeFrames = Math.max(1, Math.round(resource.emitterLifeFrames));
  resource.particleLifeFrames = Math.max(1, Math.round(resource.particleLifeFrames));
  resource.startDelayFrames = Math.max(0, Math.round(resource.startDelayFrames));
  resource.emissionIntervalFrames = Math.max(0, Math.round(resource.emissionIntervalFrames));
  resource.textureTileCountS = clampInt(resource.textureTileCountS, 0, 3);
  resource.textureTileCountT = clampInt(resource.textureTileCountT, 0, 3);
  if (resource.texAnim) {
    resource.texAnim.textureCount = clampInt(resource.texAnim.textureCount, 1, 8);
    resource.texAnim.textures = resource.texAnim.textures.slice(0, 8);
    while (resource.texAnim.textures.length < resource.texAnim.textureCount) resource.texAnim.textures.push(resource.textureIndex);
  }
  if (resource.childResource) {
    resource.childResource.textureIndex = clampInt(resource.childResource.textureIndex, 0, Math.max(0, (currentArchive(state)?.textures.length ?? 1) - 1));
    resource.childResource.emissionCount = Math.max(0, Math.round(resource.childResource.emissionCount));
    resource.childResource.lifeFrames = Math.max(1, Math.round(resource.childResource.lifeFrames));
  }
}

function currentArchive(state: State): SpaArchive | undefined {
  return state.selectedSpaId === undefined ? undefined : state.archives.get(state.selectedSpaId);
}

function currentResource(state: State): SpaResource | undefined {
  return currentArchive(state)?.resources[state.selectedResourceIndex] ?? currentArchive(state)?.resources[0];
}

function markDirty(state: State): void {
  if (state.selectedSpaId !== undefined) state.dirtySpaIds.add(state.selectedSpaId);
  state.status = undefined;
}

async function replaceSelectedTexture(state: State, file: File): Promise<void> {
  const archive = currentArchive(state);
  const texture = archive?.textures[state.selectedTextureIndex];
  if (!archive || !texture) return;
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, width, height);
  bitmap.close();
  texture.width = width;
  texture.height = height;
  texture.format = 7;
  texture.textureSize = width * height * 2;
  texture.paletteSize = 0;
  texture.paletteIndexSize = 0;
  texture.resourceSize = texture.textureSize + 32;
  texture.useSharedTexture = false;
  texture.sharedTexId = 0;
  texture.rgba = image.data;
  texture.fallback = false;
  texture.fallbackReason = undefined;
  texture.sourceChanged = true;
  markDirty(state);
  render(state);
}

async function exportSelectedTexture(state: State, archive: SpaArchive): Promise<void> {
  if (state.selectedSpaId === undefined) throw new Error("No SPA archive is selected.");
  const texture = archive.textures[state.selectedTextureIndex];
  if (!texture) throw new Error("No texture is selected.");
  if (!texture.rgba || texture.rgba.length < texture.width * texture.height * 4) throw new Error("Selected texture has no decoded image data.");
  const canvas = document.createElement("canvas");
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create a PNG canvas.");
  const rgba = new Uint8ClampedArray(texture.width * texture.height * 4);
  rgba.set(texture.rgba.subarray(0, rgba.length));
  context.putImageData(new ImageData(rgba, texture.width, texture.height), 0, 0);
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, `spa_${state.selectedSpaId}_texture_${texture.index}.png`);
}

async function importSelectedArchive(state: State, file: File): Promise<void> {
  if (state.selectedSpaId === undefined) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const archive = parseSpaArchive(bytes);
    state.archives.set(state.selectedSpaId, cloneArchive(archive));
    state.selectedResourceIndex = 0;
    state.selectedTextureIndex = 0;
    state.dirtySpaIds.add(state.selectedSpaId);
    state.status = `Imported ${file.name}`;
    state.error = undefined;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = undefined;
  }
  render(state);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to encode texture PNG."));
    }, "image/png");
  });
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

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawTextureCanvases(state: State): void {
  const archive = currentArchive(state);
  if (!archive) return;
  state.host.querySelectorAll<HTMLCanvasElement>(".spa-texture-canvas").forEach((canvas) => {
    const texture = archive.textures[Number(canvas.dataset.textureIndex)];
    const context = canvas.getContext("2d");
    if (!texture || !context) return;
    const large = canvas.classList.contains("-large");
    const rgba = new Uint8ClampedArray(texture.width * texture.height * 4);
    rgba.set(texture.rgba);
    canvas.width = texture.width;
    canvas.height = texture.height;
    context.clearRect(0, 0, texture.width, texture.height);
    context.putImageData(new ImageData(rgba, texture.width, texture.height), 0, 0);
    canvas.style.width = large ? "128px" : "42px";
    canvas.style.height = large ? "128px" : "42px";
  });
}

function cloneArchive(archive: SpaArchive): SpaArchive {
  return structuredClone(archive) as SpaArchive;
}

function defaultScaleAnim(): SpaScaleAnim {
  return { start: 1, mid: 1, end: 1, curveIn: 0, curveOut: 1, loop: false };
}

function defaultColorAnim(color: [number, number, number]): SpaColorAnim {
  return { start: [...color], end: [...color], curveIn: 0, curvePeak: 0.5, curveOut: 1, randomStartColor: false, loop: false, interpolate: true };
}

function defaultAlphaAnim(alpha: number): SpaAlphaAnim {
  return { start: alpha, mid: alpha, end: 0, randomRange: 0, curveIn: 0, curveOut: 1, loop: false };
}

function defaultTexAnim(textureIndex: number): SpaTexAnim {
  return { textures: [textureIndex], textureCount: 1, step: 1, randomizeInit: false, loop: false };
}

function defaultChildResource(textureIndex: number): SpaChildResource {
  return {
    usesBehaviors: false,
    hasScaleAnim: false,
    hasAlphaAnim: false,
    rotationType: 0,
    followEmitter: false,
    useChildColor: false,
    drawType: 0,
    polygonRotAxis: 0,
    polygonReferencePlane: 0,
    randomInitVelMag: 0,
    endScale: 1,
    lifeFrames: 30,
    velocityRatio: 1,
    scaleRatio: 1,
    color: [1, 1, 1],
    emissionCount: 1,
    emissionDelay: 0,
    emissionIntervalFrames: 1,
    textureIndex,
    textureTileCountS: 0,
    textureTileCountT: 0,
    flipTextureS: false,
    flipTextureT: false,
    dpolFaceEmitter: false,
  };
}

function defaultBehavior(type: string): SpaBehavior {
  if (type === "gravity") return { type: "gravity", magnitude: [0, 0, 0] };
  if (type === "random") return { type: "random", magnitude: [0, 0, 0], applyIntervalFrames: 1 };
  if (type === "magnet") return { type: "magnet", target: [0, 0, 0], force: 0 };
  if (type === "spin") return { type: "spin", axis: 1, angle: 0 };
  if (type === "collision") return { type: "collision", y: 0, elasticity: 1, collisionType: 1 };
  return { type: "convergence", target: [0, 0, 0], force: 0 };
}

function rgbToHex(color: [number, number, number]): string {
  return `#${color.map((component) => Math.round(clamp01(component) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [0, 1, 2].map((index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16) / 255) as [number, number, number];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function title(value: string): string {
  return value.replace(/^\w/u, (match) => match.toUpperCase());
}

function arrayEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
