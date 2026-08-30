import { decodeBtxImages } from "../pokeweb/btxModel";
import type { PokemonAnimationSequence, PokemonCell, PokemonCellOam } from "../pokeweb/pokemonSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  replaceWeatherLightingResource,
  updateWeatherLightingRecord,
  weatherLightingSeasonTimes,
  WEATHER_TIMEZONE_NAMES,
  type WeatherDirectionalLight,
  type WeatherLightingDocument,
  type WeatherLightingRecord,
} from "../pokeweb/overworldWeatherLightingModel";
import {
  cloneWeatherEffect,
  loadWeatherGraphicsDocument,
  replaceWeatherResource,
  updateWeatherAnimation,
  updateWeatherCellBank,
  updateWeatherCharacterIndices,
  updateWeatherCloneRuntime,
  updateWeatherPaletteColor,
  type WeatherCharacterData,
  type WeatherGraphicsDocument,
  type WeatherPaletteData,
} from "../pokeweb/overworldWeatherGraphicsModel";
import { CUSTOM_WEATHER_ID_MAX, CUSTOM_WEATHER_ID_MIN, getWeatherEffects, loadOverworldWeatherPreview } from "../pokeweb/overworldWeatherModel";
import { escapeHtml } from "./dom";
import { mountWeatherPreview } from "./overworldWeatherEditor";
import { renderWeatherResourceFootprint } from "./weatherResourceFootprint";

let activeStop: (() => void) | undefined;

type EditorState = {
  effectId: number;
  paletteBank: number;
  sequenceIndex: number;
  cellIndex: number;
  oamIndex: number;
  lightingRecordIndex: number;
  status: string;
  error: boolean;
};

const OAM_SIZES = [
  { shape: 0, size: 0, width: 8, height: 8 }, { shape: 0, size: 1, width: 16, height: 16 },
  { shape: 0, size: 2, width: 32, height: 32 }, { shape: 0, size: 3, width: 64, height: 64 },
  { shape: 1, size: 0, width: 16, height: 8 }, { shape: 1, size: 1, width: 32, height: 8 },
  { shape: 1, size: 2, width: 32, height: 16 }, { shape: 1, size: 3, width: 64, height: 32 },
  { shape: 2, size: 0, width: 8, height: 16 }, { shape: 2, size: 1, width: 8, height: 32 },
  { shape: 2, size: 2, width: 16, height: 32 }, { shape: 2, size: 3, width: 32, height: 64 },
];

export function stopOverworldWeatherGraphicsEditor(): void {
  activeStop?.();
  activeStop = undefined;
}

export async function renderOverworldWeatherGraphicsEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onOpenAssignments?: () => void,
): Promise<void> {
  stopOverworldWeatherGraphicsEditor();
  const initial = getWeatherEffects(project).find((effect) => effect.id === 2) ?? getWeatherEffects(project)[0];
  const state: EditorState = {
    effectId: initial?.id ?? 0,
    paletteBank: 0,
    sequenceIndex: 0,
    cellIndex: 0,
    oamIndex: 0,
    lightingRecordIndex: 0,
    status: "",
    error: false,
  };
  let disposed = false;
  let previewStop = () => {};
  let request = 0;
  const stop = () => { disposed = true; request += 1; previewStop(); };
  activeStop = stop;

  const render = async (): Promise<void> => {
    const localRequest = ++request;
    previewStop();
    root.innerHTML = `<div class="weather-graphics-loading">Loading weather graphics…</div>`;
    try {
      const document = await loadWeatherGraphicsDocument(project, state.effectId);
      if (disposed || localRequest !== request) return;
      clampSelections(state, document);
      root.innerHTML = renderPage(project, document, state);
      bindPage(project, root, document, state, render, onDirty, onOpenAssignments);
      renderCharacterCanvas(root, document.particle?.character, document.particle?.palette, state.paletteBank);
      renderAuxiliaryCanvases(root, document);
      const preview = await loadOverworldWeatherPreview(project, state.effectId);
      if (disposed || localRequest !== request) return;
      previewStop = mountWeatherPreview(root, preview, document.lighting?.records[state.lightingRecordIndex]);
    } catch (error) {
      if (disposed || localRequest !== request) return;
      root.innerHTML = `<div class="weather-graphics-loading -error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    }
  };

  await render();
}

function renderPage(project: ProjectState, document: WeatherGraphicsDocument, state: EditorState): string {
  const effects = getWeatherEffects(project);
  const particle = document.particle;
  const sequence = particle?.animation.sequences[state.sequenceIndex];
  const cell = particle?.cellBank.cells[state.cellIndex];
  const oam = cell?.oams[state.oamIndex];
  const lightingRecord = document.lighting?.records[state.lightingRecordIndex];
  const shared = document.sharedResources.length
    ? `<div class="weather-graphics-warning"><strong>Shared retail resources.</strong> ${document.sharedResources.map((entry) => `Member ${entry.memberId} is used by weather ${entry.effectIds.join(", ")}`).join("; ")}. Clone before editing if the effects should diverge.</div>`
    : "";
  return `
    <div class="weather-graphics-page">
      <aside class="weather-graphics-sidebar">
        <div>
          <div class="filter-title">Weather Graphics</div>
          <p class="weather-help">Edit weather graphics in <code>a/0/5/5</code> and time-of-day lighting in <code>a/0/6/1</code>.</p>
        </div>
        ${renderWeatherResourceFootprint([
          { access: "write", target: "a/0/5/5", description: "Particles, cells, animations, palettes, and screen planes" },
          { access: "write", target: "a/0/6/1", description: "Weather time-of-day lighting keyframes" },
          { access: "write", target: "weather/pwth.bin", description: "Custom-ID registry; NitroFS file, not a NARC" },
          { access: "patch", target: "overlay 36", description: "Custom-ID hooks; reinstall PMC rather than copying this overlay alone" },
          { access: "runtime", target: "overlays 74–78", description: "Donor effect code; unchanged and does not need copying" },
        ], "To transplant stock graphical edits, copy a/0/5/5 and a/0/6/1. Custom IDs additionally require weather/pwth.bin and the bundled PMC runtime.")}
        <label class="weather-field-label" for="weather-graphics-effect">Weather effect</label>
        <select class="filter-input" id="weather-graphics-effect">
          ${effects.map((effect) => `<option value="${effect.id}" ${effect.id === state.effectId ? "selected" : ""}>${effect.id}: ${escapeHtml(effect.name)}</option>`).join("")}
        </select>
        <div class="weather-effect-detail">
          <div class="weather-effect-title"><strong>${document.effect.id}: ${escapeHtml(document.effect.name)}</strong><span class="weather-badge -${document.effect.status}">${document.effect.status}</span></div>
          <p>${escapeHtml(document.effect.description)}</p>
          <div class="weather-effect-meta">${document.effect.channels.map(escapeHtml).join(" · ") || "No graphical channels"}</div>
        </div>
        <div class="weather-preview-frame">
          <canvas id="weather-preview-canvas" width="256" height="192" aria-label="Animated overworld weather preview"></canvas>
          <div class="weather-preview-label">Live composite preview</div>
        </div>
        <div class="weather-preview-warning" id="weather-preview-warning"></div>
        <section class="weather-clone-card">
          <strong>Clone as custom weather</strong>
          <p class="weather-help">Copies every referenced graphics and weather-light member into independent NARC slots, plus the donor behavior template.</p>
          <div class="weather-clone-fields">
            <label>ID <input class="filter-input" id="weather-clone-id" type="number" min="${CUSTOM_WEATHER_ID_MIN}" max="${CUSTOM_WEATHER_ID_MAX}" value="${nextCustomId(project, document.effect.id)}" /></label>
            <label>Name <input class="filter-input" id="weather-clone-name" value="${escapeHtml(`${document.effect.name} Custom`)}" /></label>
          </div>
          <button class="btn -default" id="weather-clone-button" type="button">Clone all resources</button>
        </section>
        <div class="weather-status ${state.error ? "-error" : ""}" role="status">${escapeHtml(state.status)}</div>
      </aside>

      <main class="weather-graphics-main">
        <header class="weather-graphics-heading">
          <div><h1>${escapeHtml(document.effect.name)}</h1><p>Particle appearance is G2D data; the 15-keyframe lighting table controls field lights and material, fog, and background colors across the day.</p></div>
          <button class="btn -default" id="weather-open-assignments" type="button">Area assignments</button>
        </header>
        ${shared}
        ${renderRuntimeSection(document)}
        ${renderLightingSection(document.lighting, state, lightingRecord)}
        ${particle ? renderParticleSection(document, state, sequence, cell, oam) : renderNoParticle(document)}
        ${renderAuxiliarySection(document)}
      </main>
    </div>`;
}

function renderRuntimeSection(document: WeatherGraphicsDocument): string {
  const clone = document.clone;
  if (!clone) {
    return `<section class="weather-graphics-panel"><div class="weather-panel-heading"><h2>Runtime behavior</h2><span class="weather-data-kind -code">overlay code</span></div><p>The stock effect's particle spawn rate, velocities, lifetime, fog depth/slope, sound, and screen-plane scrolling are hardcoded in its weather overlay. Its separate editable lighting keyframes are shown below.</p><p class="weather-help">Clone this effect to create an editable runtime template. Custom slots become assignable when the one-time weather expansion and its data registry are available.</p></section>`;
  }
  const runtime = clone.runtime;
  return `<section class="weather-graphics-panel">
    <div class="weather-panel-heading"><h2>Runtime template</h2><span class="weather-data-kind ${clone.runtimeReady ? "-ready" : "-code"}">${clone.runtimeReady ? "PWTH registered" : "one-time expansion required"}</span></div>
    <p>These values form the row in <code>weather/pwth.bin</code>. ABI 2 applies fog intensity/color; density, movement, and scroll remain versioned preview fields for future behavior adapters.</p>
    <div class="weather-runtime-grid">
      ${numberField("Particle density", "particleDensity", runtime.particleDensity, 0, 4, .1)}
      ${numberField("Movement speed", "movementSpeed", runtime.movementSpeed, 0, 4, .1)}
      ${numberField("Fog intensity", "fogIntensity", runtime.fogIntensity, 0, 2, .05)}
      <label>Fog color<input data-runtime-field="fogColor" type="color" value="${escapeHtml(runtime.fogColor)}" /></label>
      ${numberField("Plane scroll speed", "screenScrollSpeed", runtime.screenScrollSpeed, -4, 4, .1)}
    </div>
  </section>`;
}

function renderLightingSection(
  lighting: WeatherLightingDocument | undefined,
  state: EditorState,
  record: WeatherLightingRecord | undefined,
): string {
  if (!lighting || !record) {
    return `<section class="weather-graphics-panel weather-empty-channel"><div class="weather-panel-heading"><h2>Lighting and time of day</h2><span class="weather-data-kind">a/0/6/1</span></div><p>This effect has no weather-light member. Clear weather falls back to the area's zone/area lighting table.</p></section>`;
  }
  const seasonTimes = weatherLightingSeasonTimes(record);
  const sharedWarning = lighting.sharedEffectIds.length > 1
    ? `<div class="weather-lighting-note -warning"><strong>Shared lighting member.</strong> Member ${lighting.memberId} is referenced by weather ${lighting.sharedEffectIds.join(", ")}. Editing it changes every listed effect; clone first if they should diverge.</div>`
    : "";
  const sourceWarning = lighting.source === "custom" && !lighting.runtimeLinked
    ? `<div class="weather-lighting-note -runtime"><strong>Custom preview resource.</strong> This clone has its own appended lighting member, so edits are independent and visible here. PWTH ABI 2 still uses the donor's lighting in-game; its native lighting lookup must be extended to consume this member ID.</div>`
    : lighting.source === "inherited"
      ? `<div class="weather-lighting-note -warning"><strong>Inherited donor lighting.</strong> This older clone has no independent lighting member and currently edits the donor table.</div>`
      : "";
  return `<section class="weather-graphics-panel weather-lighting-panel">
    <div class="weather-panel-heading"><h2>Lighting and time of day</h2><span class="weather-data-kind">LIGHT_DATA · a/0/6/1</span></div>
    <p>Each keyframe stores four directional lights plus the model material, fog, and clear/background colors. The game chooses a season-specific time from the timezone and signed minute offset, then interpolates between records.</p>
    ${sharedWarning}${sourceWarning}
    <div class="weather-selector-row weather-lighting-selector">
      <label>Keyframe<select class="filter-input" id="weather-lighting-record">${lighting.records.map((candidate, index) => `<option value="${index}" ${index === state.lightingRecordIndex ? "selected" : ""}>${index}: ${escapeHtml(timezoneName(candidate.timezone))} ${signedMinutes(candidate.changeMinutes)}</option>`).join("")}</select></label>
      <label>Timezone<select class="filter-input" data-lighting-record-field="timezone">${WEATHER_TIMEZONE_NAMES.map((name, index) => `<option value="${index}" ${record.timezone === index ? "selected" : ""}>${index}: ${name}</option>`).join("")}</select></label>
      <label>Change offset (minutes)<input class="filter-input" data-lighting-record-field="changeMinutes" type="number" min="-32768" max="32767" step="1" value="${record.changeMinutes}" /></label>
    </div>
    <div class="weather-lighting-times" aria-label="Season-specific keyframe times">
      ${Object.entries(seasonTimes).map(([season, time]) => `<div><span>${season}</span><strong>${time}</strong></div>`).join("")}
    </div>
    <div class="weather-directional-lights">
      ${record.lights.map((light, index) => renderDirectionalLight(light, index)).join("")}
    </div>
    <div class="weather-lighting-colors">
      ${lightingColorField("Diffuse", "diffuse", record.diffuse)}
      ${lightingColorField("Ambient", "ambient", record.ambient)}
      ${lightingColorField("Specular", "specular", record.specular)}
      ${lightingColorField("Emission", "emission", record.emission)}
      ${lightingColorField("Fog", "fogColor", record.fogColor)}
      ${lightingColorField("Background", "backgroundColor", record.backgroundColor)}
    </div>
    <div class="weather-resource-meta">Lighting member ${lighting.memberId} · ${lighting.records.length} keyframes · ${lighting.bytes.length} bytes · vectors shown as signed fx16 / 4096</div>
    <div class="weather-resource-actions">
      <button class="btn -default" id="weather-lighting-export" type="button">Export lighting data</button>
      <label class="btn -default">Replace lighting data<input type="file" id="weather-lighting-replace" accept=".bin,.dat" hidden /></label>
    </div>
  </section>`;
}

function renderDirectionalLight(light: WeatherDirectionalLight, index: number): string {
  return `<article class="weather-directional-light">
    <div class="weather-light-card-heading"><strong>Directional light ${index}</strong><label class="weather-check"><input type="checkbox" data-lighting-light="${index}" data-lighting-light-field="enabled" ${light.enabled ? "checked" : ""} />Enabled</label></div>
    <label class="weather-light-color">Color<input type="color" data-lighting-light="${index}" data-lighting-light-field="color" value="${escapeHtml(light.color)}" /></label>
    <div class="weather-light-vector">
      ${lightingVectorField("X", index, "x", light.vector.x)}
      ${lightingVectorField("Y", index, "y", light.vector.y)}
      ${lightingVectorField("Z", index, "z", light.vector.z)}
    </div>
  </article>`;
}

function lightingVectorField(label: string, index: number, field: keyof WeatherDirectionalLight["vector"], value: number): string {
  return `<label>${label}<input class="filter-input" type="number" min="-8" max="7.999755859375" step="0.000244140625" data-lighting-light="${index}" data-lighting-light-field="${field}" value="${formatVector(value)}" /></label>`;
}

function lightingColorField(label: string, field: keyof Pick<WeatherLightingRecord, "diffuse" | "ambient" | "specular" | "emission" | "fogColor" | "backgroundColor">, value: string): string {
  return `<label><span>${label}</span><input type="color" data-lighting-color-field="${field}" value="${escapeHtml(value)}" /><code>${escapeHtml(value)}</code></label>`;
}

function renderParticleSection(
  document: WeatherGraphicsDocument,
  state: EditorState,
  sequence: PokemonAnimationSequence | undefined,
  cell: PokemonCell | undefined,
  oam: PokemonCellOam | undefined,
): string {
  const particle = document.particle!;
  const paletteBankCount = Math.max(1, Math.ceil(particle.palette.colors.length / 16));
  return `
    <section class="weather-graphics-panel">
      <div class="weather-panel-heading"><h2>Character tiles and palette</h2><span class="weather-data-kind">NCGR + NCLR</span></div>
      <div class="weather-character-layout">
        <div>
          <canvas class="weather-character-canvas" id="weather-character-canvas" width="${particle.character.width}" height="${particle.character.height}"></canvas>
          <div class="weather-resource-meta">Member ${particle.resource.character} · ${particle.character.tileCount} tiles · ${particle.character.bitsPerPixel}bpp · displayed as ${particle.character.width}×${particle.character.height}</div>
          <div class="weather-resource-actions">
            <button class="btn -default" type="button" data-export-member="${particle.resource.character}">Export NCGR</button>
            <label class="btn -default">Replace NCGR<input type="file" data-replace-member="${particle.resource.character}" accept=".ncgr,.bin" hidden /></label>
            <label class="btn -default">Import atlas PNG<input type="file" id="weather-character-import" accept="image/png" hidden /></label>
          </div>
        </div>
        <div>
          <label class="weather-inline-field">Palette bank<select class="filter-input" id="weather-palette-bank">${Array.from({ length: paletteBankCount }, (_, bank) => `<option value="${bank}" ${bank === state.paletteBank ? "selected" : ""}>${bank}</option>`).join("")}</select></label>
          <div class="weather-palette-grid">${renderPaletteBank(particle.palette, state.paletteBank)}</div>
          <div class="weather-resource-meta">Member ${particle.resource.palette}. Index 0 of each 16-color OBJ bank is transparent.</div>
          <div class="weather-resource-actions"><button class="btn -default" type="button" data-export-member="${particle.resource.palette}">Export NCLR</button><label class="btn -default">Replace NCLR<input type="file" data-replace-member="${particle.resource.palette}" accept=".nclr,.bin" hidden /></label></div>
        </div>
      </div>
    </section>

    <section class="weather-graphics-panel">
      <div class="weather-panel-heading"><h2>Cell composition</h2><span class="weather-data-kind">NCER</span></div>
      <div class="weather-selector-row">
        <label>Cell<select class="filter-input" id="weather-cell-select">${particle.cellBank.cells.map((candidate) => `<option value="${candidate.index}" ${candidate.index === state.cellIndex ? "selected" : ""}>Cell ${candidate.index} (${candidate.oams.length} OAM)</option>`).join("")}</select></label>
        <label>OAM<select class="filter-input" id="weather-oam-select">${(cell?.oams ?? []).map((_candidate, index) => `<option value="${index}" ${index === state.oamIndex ? "selected" : ""}>OAM ${index}</option>`).join("")}</select></label>
        <button class="btn -default" id="weather-add-oam" type="button">Add OAM</button>
        <button class="btn -default" id="weather-remove-oam" type="button" ${(cell?.oams.length ?? 0) <= 1 ? "disabled" : ""}>Remove OAM</button>
      </div>
      ${oam ? renderOamFields(oam) : "<p>No OAM selected.</p>"}
      <div class="weather-resource-actions"><button class="btn -default" type="button" data-export-member="${particle.resource.cell}">Export NCER</button><label class="btn -default">Replace NCER<input type="file" data-replace-member="${particle.resource.cell}" accept=".ncer,.bin" hidden /></label></div>
    </section>

    <section class="weather-graphics-panel">
      <div class="weather-panel-heading"><h2>Cell animation</h2><span class="weather-data-kind">NANR</span></div>
      <div class="weather-selector-row">
        <label>Sequence<select class="filter-input" id="weather-sequence-select">${particle.animation.sequences.map((candidate) => `<option value="${candidate.index}" ${candidate.index === state.sequenceIndex ? "selected" : ""}>Sequence ${candidate.index}</option>`).join("")}</select></label>
        <label>Playback mode<input class="filter-input" data-sequence-field="mode" type="number" min="0" max="4" value="${sequence?.mode ?? 0}" /></label>
        <label>Loop start<input class="filter-input" data-sequence-field="startFrameIndex" type="number" min="0" max="${Math.max(0, (sequence?.frames.length ?? 1) - 1)}" value="${sequence?.startFrameIndex ?? 0}" /></label>
        <button class="btn -default" id="weather-add-frame" type="button">Add frame</button>
      </div>
      <div class="weather-animation-table">
        <div class="weather-animation-row -header"><span>#</span><span>Duration</span><span>Cell</span><span>X</span><span>Y</span><span>Rotation</span><span>Scale X</span><span>Scale Y</span><span></span></div>
        ${(sequence?.frames ?? []).map((frame, index) => `<div class="weather-animation-row" data-animation-frame="${index}">
          <span>${index}</span>${animationInput("duration", frame.duration, 0, 65535, 1)}${animationInput("cellIndex", frame.cellIndex, 0, Math.max(0, particle.cellBank.cells.length - 1), 1)}${animationInput("x", frame.x, -32768, 32767, 1)}${animationInput("y", frame.y, -32768, 32767, 1)}${animationInput("rotation", frame.rotation, -360, 360, .1)}${animationInput("xScale", frame.xScale, -128, 128, .05)}${animationInput("yScale", frame.yScale, -128, 128, .05)}<button class="weather-remove-frame" type="button" data-remove-frame="${index}" ${(sequence?.frames.length ?? 0) <= 1 ? "disabled" : ""}>×</button>
        </div>`).join("")}
      </div>
      <div class="weather-resource-actions"><button class="btn -default" type="button" data-export-member="${particle.resource.animation}">Export NANR</button><label class="btn -default">Replace NANR<input type="file" data-replace-member="${particle.resource.animation}" accept=".nanr,.bin" hidden /></label></div>
    </section>`;
}

function renderNoParticle(document: WeatherGraphicsDocument): string {
  return `<section class="weather-graphics-panel weather-empty-channel"><h2>No OAM particle resources</h2><p>${document.effect.behavior === "fog" ? "This effect is produced entirely by the DS depth-fog and lighting systems; it has no rain-drop or snowflake texture to edit." : "This effect does not reference an NCGR/NCLR/NCER/NANR particle quartet."}</p></section>`;
}

function renderAuxiliarySection(document: WeatherGraphicsDocument): string {
  if (!document.auxiliary.length) return "";
  return `<section class="weather-graphics-panel"><div class="weather-panel-heading"><h2>Screen and background resources</h2><span class="weather-data-kind">BTX0 / tiled BG</span></div><div class="weather-aux-grid">${document.auxiliary.map((resource) => `<article class="weather-aux-card"><strong>${escapeHtml(resource.role)}</strong><canvas data-aux-preview="${resource.memberId}" width="128" height="128"></canvas><div class="weather-resource-meta">Member ${resource.memberId} · ${escapeHtml(resource.magic)} · ${resource.byteLength} bytes</div><div class="weather-resource-actions"><button class="btn -default" type="button" data-export-member="${resource.memberId}">Export</button><label class="btn -default">Replace<input type="file" data-replace-member="${resource.memberId}" hidden /></label></div></article>`).join("")}</div></section>`;
}

function bindPage(
  project: ProjectState,
  root: HTMLElement,
  document: WeatherGraphicsDocument,
  state: EditorState,
  render: () => Promise<void>,
  onDirty?: () => void,
  onOpenAssignments?: () => void,
): void {
  root.querySelector<HTMLButtonElement>("#weather-open-assignments")?.addEventListener("click", () => onOpenAssignments?.());
  root.querySelector<HTMLSelectElement>("#weather-graphics-effect")?.addEventListener("change", (event) => {
    state.effectId = Number((event.currentTarget as HTMLSelectElement).value);
    state.paletteBank = state.sequenceIndex = state.cellIndex = state.oamIndex = 0;
    state.lightingRecordIndex = 0;
    state.status = "";
    void render();
  });
  root.querySelector<HTMLButtonElement>("#weather-clone-button")?.addEventListener("click", async () => {
    try {
      const targetId = Number(root.querySelector<HTMLInputElement>("#weather-clone-id")?.value);
      const name = root.querySelector<HTMLInputElement>("#weather-clone-name")?.value ?? "";
      const effect = await cloneWeatherEffect(project, state.effectId, targetId, name);
      state.effectId = effect.id;
      state.status = `Cloned all resources to weather ${effect.id} and wrote its PWTH registry row. No per-clone code patch was generated.`;
      state.error = false;
      onDirty?.();
      await render();
    } catch (error) { showError(state, error); await render(); }
  });
  root.querySelector<HTMLSelectElement>("#weather-palette-bank")?.addEventListener("change", (event) => {
    state.paletteBank = Number((event.currentTarget as HTMLSelectElement).value);
    renderCharacterCanvas(root, document.particle?.character, document.particle?.palette, state.paletteBank);
    const grid = root.querySelector<HTMLElement>(".weather-palette-grid");
    if (grid && document.particle) { grid.innerHTML = renderPaletteBank(document.particle.palette, state.paletteBank); bindPaletteInputs(project, root, state, render, onDirty); }
  });
  bindPaletteInputs(project, root, state, render, onDirty);
  bindCharacterImport(project, root, document, state, render, onDirty);
  bindCells(project, root, document, state, render, onDirty);
  bindAnimation(project, root, document, state, render, onDirty);
  bindRuntime(project, root, state, render, onDirty);
  bindLighting(project, root, document, state, render, onDirty);
  root.querySelectorAll<HTMLButtonElement>("[data-export-member]").forEach((button) => button.addEventListener("click", () => {
    const memberId = Number(button.dataset.exportMember);
    const bytes = memberBytes(document, memberId);
    if (bytes) downloadBytes(bytes, `weather_${state.effectId}_member_${memberId}.${resourceExtension(bytes)}`);
  }));
  root.querySelectorAll<HTMLInputElement>("[data-replace-member]").forEach((input) => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await replaceWeatherResource(project, Number(input.dataset.replaceMember), new Uint8Array(await file.arrayBuffer()));
      state.status = `Replaced weather graphics member ${input.dataset.replaceMember}.`;
      state.error = false;
      onDirty?.();
    } catch (error) { showError(state, error); }
    await render();
  }));
}

function bindLighting(
  project: ProjectState,
  root: HTMLElement,
  document: WeatherGraphicsDocument,
  state: EditorState,
  render: () => Promise<void>,
  onDirty?: () => void,
): void {
  const lighting = document.lighting;
  const record = lighting?.records[state.lightingRecordIndex];
  if (!lighting || !record) return;
  root.querySelector<HTMLSelectElement>("#weather-lighting-record")?.addEventListener("change", (event) => {
    state.lightingRecordIndex = Number((event.currentTarget as HTMLSelectElement).value);
    void render();
  });
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-lighting-record-field]").forEach((input) => input.addEventListener("change", async () => {
    const field = input.dataset.lightingRecordField as "timezone" | "changeMinutes";
    record[field] = Number(input.value);
    await saveLighting(project, lighting, state, record, render, onDirty);
  }));
  root.querySelectorAll<HTMLInputElement>("[data-lighting-light]").forEach((input) => input.addEventListener("change", async () => {
    const light = record.lights[Number(input.dataset.lightingLight)];
    if (!light) return;
    const field = input.dataset.lightingLightField;
    if (field === "enabled") light.enabled = input.checked;
    else if (field === "color") light.color = input.value;
    else if (field === "x" || field === "y" || field === "z") light.vector[field] = Number(input.value);
    await saveLighting(project, lighting, state, record, render, onDirty);
  }));
  root.querySelectorAll<HTMLInputElement>("[data-lighting-color-field]").forEach((input) => input.addEventListener("change", async () => {
    const field = input.dataset.lightingColorField as keyof Pick<WeatherLightingRecord, "diffuse" | "ambient" | "specular" | "emission" | "fogColor" | "backgroundColor">;
    record[field] = input.value;
    await saveLighting(project, lighting, state, record, render, onDirty);
  }));
  root.querySelector<HTMLButtonElement>("#weather-lighting-export")?.addEventListener("click", () => {
    downloadBytes(lighting.bytes, `weather_${state.effectId}_lighting_member_${lighting.memberId}.bin`);
  });
  root.querySelector<HTMLInputElement>("#weather-lighting-replace")?.addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await replaceWeatherLightingResource(project, lighting.memberId, new Uint8Array(await file.arrayBuffer()));
      state.status = `Replaced weather-light member ${lighting.memberId}.`;
      state.error = false;
      onDirty?.();
    } catch (error) { showError(state, error); }
    await render();
  });
}

function bindPaletteInputs(project: ProjectState, root: HTMLElement, state: EditorState, render: () => Promise<void>, onDirty?: () => void): void {
  root.querySelectorAll<HTMLInputElement>("[data-palette-index]").forEach((input) => input.addEventListener("change", async () => {
    try {
      await updateWeatherPaletteColor(project, state.effectId, Number(input.dataset.paletteIndex), input.value);
      state.status = `Updated palette color ${input.dataset.paletteIndex}.`;
      state.error = false;
      onDirty?.();
    } catch (error) { showError(state, error); }
    await render();
  }));
}

function bindCharacterImport(project: ProjectState, root: HTMLElement, document: WeatherGraphicsDocument, state: EditorState, render: () => Promise<void>, onDirty?: () => void): void {
  root.querySelector<HTMLInputElement>("#weather-character-import")?.addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    const particle = document.particle;
    if (!file || !particle) return;
    try {
      const rgba = await imagePixels(file, particle.character.width, particle.character.height);
      const indices = quantizeImage(rgba, particle.character, particle.palette, state.paletteBank);
      await updateWeatherCharacterIndices(project, state.effectId, indices);
      state.status = `Imported ${particle.character.width}×${particle.character.height} tile-atlas PNG using palette bank ${state.paletteBank}.`;
      state.error = false;
      onDirty?.();
    } catch (error) { showError(state, error); }
    await render();
  });
}

function bindCells(project: ProjectState, root: HTMLElement, document: WeatherGraphicsDocument, state: EditorState, render: () => Promise<void>, onDirty?: () => void): void {
  const particle = document.particle;
  if (!particle) return;
  root.querySelector<HTMLSelectElement>("#weather-cell-select")?.addEventListener("change", (event) => { state.cellIndex = Number((event.currentTarget as HTMLSelectElement).value); state.oamIndex = 0; void render(); });
  root.querySelector<HTMLSelectElement>("#weather-oam-select")?.addEventListener("change", (event) => { state.oamIndex = Number((event.currentTarget as HTMLSelectElement).value); void render(); });
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-oam-field]").forEach((input) => input.addEventListener("change", async () => {
    const oam = particle.cellBank.cells[state.cellIndex]?.oams[state.oamIndex];
    if (!oam) return;
    const field = input.dataset.oamField as keyof PokemonCellOam | "shapeSize";
    if (field === "shapeSize") {
      const size = OAM_SIZES.find((candidate) => `${candidate.shape}:${candidate.size}` === input.value);
      if (size) Object.assign(oam, size);
    } else if (input instanceof HTMLInputElement && input.type === "checkbox") (oam as unknown as Record<string, unknown>)[field] = input.checked;
    else (oam as unknown as Record<string, unknown>)[field] = Number(input.value);
    await saveCells(project, state, particle.cellBank, render, onDirty);
  }));
  root.querySelector<HTMLButtonElement>("#weather-add-oam")?.addEventListener("click", async () => {
    const cell = particle.cellBank.cells[state.cellIndex];
    if (!cell) return;
    cell.oams.push({ ...(cell.oams[state.oamIndex] ?? defaultOam()) });
    state.oamIndex = cell.oams.length - 1;
    await saveCells(project, state, particle.cellBank, render, onDirty);
  });
  root.querySelector<HTMLButtonElement>("#weather-remove-oam")?.addEventListener("click", async () => {
    const cell = particle.cellBank.cells[state.cellIndex];
    if (!cell || cell.oams.length <= 1) return;
    cell.oams.splice(state.oamIndex, 1);
    state.oamIndex = Math.max(0, Math.min(state.oamIndex, cell.oams.length - 1));
    await saveCells(project, state, particle.cellBank, render, onDirty);
  });
}

function bindAnimation(project: ProjectState, root: HTMLElement, document: WeatherGraphicsDocument, state: EditorState, render: () => Promise<void>, onDirty?: () => void): void {
  const particle = document.particle;
  if (!particle) return;
  root.querySelector<HTMLSelectElement>("#weather-sequence-select")?.addEventListener("change", (event) => { state.sequenceIndex = Number((event.currentTarget as HTMLSelectElement).value); void render(); });
  root.querySelectorAll<HTMLInputElement>("[data-sequence-field]").forEach((input) => input.addEventListener("change", async () => {
    const sequence = particle.animation.sequences[state.sequenceIndex];
    if (!sequence) return;
    const field = input.dataset.sequenceField as "mode" | "startFrameIndex";
    sequence[field] = Number(input.value);
    await saveAnimation(project, state, particle.animation, render, onDirty);
  }));
  root.querySelectorAll<HTMLInputElement>("[data-animation-field]").forEach((input) => input.addEventListener("change", async () => {
    const row = input.closest<HTMLElement>("[data-animation-frame]");
    const frame = particle.animation.sequences[state.sequenceIndex]?.frames[Number(row?.dataset.animationFrame)];
    if (!frame) return;
    (frame as unknown as Record<string, unknown>)[input.dataset.animationField!] = Number(input.value);
    await saveAnimation(project, state, particle.animation, render, onDirty);
  }));
  root.querySelector<HTMLButtonElement>("#weather-add-frame")?.addEventListener("click", async () => {
    const sequence = particle.animation.sequences[state.sequenceIndex];
    if (!sequence) return;
    const source = sequence.frames[sequence.frames.length - 1];
    sequence.frames.push({ ...(source ?? { duration: 1, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1, frameType: "index-srt", valueOffset: 0, sequenceFrameOffset: 0 }) });
    await saveAnimation(project, state, particle.animation, render, onDirty);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-remove-frame]").forEach((button) => button.addEventListener("click", async () => {
    const sequence = particle.animation.sequences[state.sequenceIndex];
    if (!sequence || sequence.frames.length <= 1) return;
    sequence.frames.splice(Number(button.dataset.removeFrame), 1);
    await saveAnimation(project, state, particle.animation, render, onDirty);
  }));
}

function bindRuntime(project: ProjectState, root: HTMLElement, state: EditorState, render: () => Promise<void>, onDirty?: () => void): void {
  root.querySelectorAll<HTMLInputElement>("[data-runtime-field]").forEach((input) => input.addEventListener("change", async () => {
    try {
      await updateWeatherCloneRuntime(project, state.effectId, { [input.dataset.runtimeField!]: input.type === "color" ? input.value : Number(input.value) });
      state.status = "Updated runtime template preview values.";
      state.error = false;
      onDirty?.();
    } catch (error) { showError(state, error); }
    await render();
  }));
}

async function saveCells(project: ProjectState, state: EditorState, cellBank: NonNullable<WeatherGraphicsDocument["particle"]>["cellBank"], render: () => Promise<void>, onDirty?: () => void): Promise<void> {
  try { await updateWeatherCellBank(project, state.effectId, cellBank); state.status = "Updated NCER cell data."; state.error = false; onDirty?.(); } catch (error) { showError(state, error); }
  await render();
}

async function saveAnimation(project: ProjectState, state: EditorState, animation: NonNullable<WeatherGraphicsDocument["particle"]>["animation"], render: () => Promise<void>, onDirty?: () => void): Promise<void> {
  try { await updateWeatherAnimation(project, state.effectId, animation); state.status = "Updated NANR animation data."; state.error = false; onDirty?.(); } catch (error) { showError(state, error); }
  await render();
}

async function saveLighting(
  project: ProjectState,
  lighting: WeatherLightingDocument,
  state: EditorState,
  record: WeatherLightingRecord,
  render: () => Promise<void>,
  onDirty?: () => void,
): Promise<void> {
  try {
    await updateWeatherLightingRecord(project, lighting.memberId, state.lightingRecordIndex, record);
    state.status = `Updated lighting keyframe ${state.lightingRecordIndex} in member ${lighting.memberId}.`;
    state.error = false;
    onDirty?.();
  } catch (error) { showError(state, error); }
  await render();
}

function renderPaletteBank(palette: WeatherPaletteData, bank: number): string {
  const start = bank * 16;
  return Array.from({ length: 16 }, (_unused, local) => {
    const index = start + local;
    const color = palette.colors[index] ?? [0, 0, 0, 255];
    return `<label title="Palette ${index}"><input type="color" value="${rgbaHex(color)}" data-palette-index="${index}" /><span>${index}</span></label>`;
  }).join("");
}

function renderOamFields(oam: PokemonCellOam): string {
  const number = (label: string, field: keyof PokemonCellOam, min: number, max: number) => `<label>${label}<input class="filter-input" data-oam-field="${field}" type="number" min="${min}" max="${max}" value="${oam[field]}" /></label>`;
  const check = (label: string, field: keyof PokemonCellOam) => `<label class="weather-check"><input data-oam-field="${field}" type="checkbox" ${oam[field] ? "checked" : ""} />${label}</label>`;
  return `<div class="weather-oam-grid">${number("X", "x", -256, 255)}${number("Y", "y", -128, 127)}${number("Tile index", "characterName", 0, 1023)}${number("Palette bank", "palette", 0, 15)}${number("Priority", "priority", 0, 3)}${number("Object mode", "mode", 0, 3)}${number("Affine matrix", "matrix", 0, 31)}<label>Shape / size<select class="filter-input" data-oam-field="shapeSize">${OAM_SIZES.map((size) => `<option value="${size.shape}:${size.size}" ${size.shape === oam.shape && size.size === oam.size ? "selected" : ""}>${size.width}×${size.height} (shape ${size.shape}, size ${size.size})</option>`).join("")}</select></label><label>Color depth<select class="filter-input" data-oam-field="characterBits"><option value="4" ${oam.characterBits === 4 ? "selected" : ""}>4bpp</option><option value="8" ${oam.characterBits === 8 ? "selected" : ""}>8bpp</option></select></label>${check("Flip X", "flipX")}${check("Flip Y", "flipY")}${check("Hidden", "disable")}${check("Affine", "rotateScale")}${check("Double size", "doubleSize")}${check("Mosaic", "mosaic")}</div>`;
}

function renderCharacterCanvas(root: HTMLElement, character: WeatherCharacterData | undefined, palette: WeatherPaletteData | undefined, bank: number): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#weather-character-canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !character || !palette) return;
  const image = context.createImageData(character.width, character.height);
  for (let index = 0; index < character.indices.length; index += 1) {
    const local = character.indices[index];
    const color = palette.colors[character.bitsPerPixel === 4 ? bank * 16 + local : local] ?? [0, 0, 0, 255];
    image.data[index * 4] = color[0]; image.data[index * 4 + 1] = color[1]; image.data[index * 4 + 2] = color[2]; image.data[index * 4 + 3] = local === 0 ? 0 : 255;
  }
  context.putImageData(image, 0, 0);
}

function renderAuxiliaryCanvases(root: HTMLElement, graphicsDocument: WeatherGraphicsDocument): void {
  for (const resource of graphicsDocument.auxiliary) {
    const canvas = root.querySelector<HTMLCanvasElement>(`[data-aux-preview="${resource.memberId}"]`);
    const context = canvas?.getContext("2d");
    if (!canvas || !context) continue;
    context.fillStyle = "#171924"; context.fillRect(0, 0, canvas.width, canvas.height);
    if (resource.magic !== "BTX0") continue;
    try {
      const image = decodeBtxImages(resource.bytes)[0];
      if (!image) continue;
      const source = globalThis.document.createElement("canvas");
      source.width = image.width; source.height = image.height;
      source.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    } catch { /* Raw replacement/export remains available for unsupported auxiliary resources. */ }
  }
}

function quantizeImage(rgba: Uint8ClampedArray, character: WeatherCharacterData, palette: WeatherPaletteData, bank: number): Uint8Array {
  const colors = character.bitsPerPixel === 4 ? palette.colors.slice(bank * 16, bank * 16 + 16) : palette.colors.slice(0, 256);
  const indices = new Uint8Array(character.width * character.height);
  for (let index = 0; index < indices.length; index += 1) {
    if (rgba[index * 4 + 3] < 128) { indices[index] = 0; continue; }
    let best = 1;
    let bestDistance = Infinity;
    for (let colorIndex = 1; colorIndex < colors.length; colorIndex += 1) {
      const color = colors[colorIndex] ?? [0, 0, 0, 255];
      const dr = rgba[index * 4] - color[0]; const dg = rgba[index * 4 + 1] - color[1]; const db = rgba[index * 4 + 2] - color[2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) { bestDistance = distance; best = colorIndex; }
    }
    indices[index] = best;
  }
  return indices;
}

async function imagePixels(file: File, width: number, height: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file);
  if (bitmap.width !== width || bitmap.height !== height) { bitmap.close(); throw new Error(`Atlas PNG must be exactly ${width}×${height}; received ${bitmap.width}×${bitmap.height}.`); }
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create an image canvas.");
  context.drawImage(bitmap, 0, 0); bitmap.close();
  return context.getImageData(0, 0, width, height).data;
}

function clampSelections(state: EditorState, document: WeatherGraphicsDocument): void {
  const particle = document.particle;
  state.paletteBank = Math.max(0, Math.min(state.paletteBank, Math.max(0, Math.ceil((particle?.palette.colors.length ?? 16) / 16) - 1)));
  state.sequenceIndex = Math.max(0, Math.min(state.sequenceIndex, Math.max(0, (particle?.animation.sequences.length ?? 1) - 1)));
  state.cellIndex = Math.max(0, Math.min(state.cellIndex, Math.max(0, (particle?.cellBank.cells.length ?? 1) - 1)));
  state.oamIndex = Math.max(0, Math.min(state.oamIndex, Math.max(0, (particle?.cellBank.cells[state.cellIndex]?.oams.length ?? 1) - 1)));
  state.lightingRecordIndex = Math.max(0, Math.min(state.lightingRecordIndex, Math.max(0, (document.lighting?.records.length ?? 1) - 1)));
}

function memberBytes(document: WeatherGraphicsDocument, memberId: number): Uint8Array | undefined {
  const particle = document.particle;
  if (particle) {
    if (memberId === particle.resource.character) return particle.character.bytes;
    if (memberId === particle.resource.palette) return particle.palette.bytes;
    if (memberId === particle.resource.cell) return particle.cellBytes;
    if (memberId === particle.resource.animation) return particle.animationBytes;
  }
  return document.auxiliary.find((resource) => resource.memberId === memberId)?.bytes;
}

function nextCustomId(project: ProjectState, donorId: number): number {
  const used = new Set((project.overworldWeather?.customEffects ?? []).map((effect) => effect.id));
  used.add(donorId);
  for (let id = CUSTOM_WEATHER_ID_MIN; id <= CUSTOM_WEATHER_ID_MAX; id += 1) if (!used.has(id)) return id;
  return CUSTOM_WEATHER_ID_MAX;
}

function numberField(label: string, field: string, value: number, min: number, max: number, step: number): string {
  return `<label>${label}<input class="filter-input" data-runtime-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" /></label>`;
}

function animationInput(field: string, value: number, min: number, max: number, step: number): string {
  return `<input class="filter-input" data-animation-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" />`;
}

function defaultOam(): PokemonCellOam {
  return { x: 0, y: 0, width: 8, height: 8, characterName: 0, palette: 0, flipX: false, flipY: false, disable: false, rotateScale: false, doubleSize: false, matrix: 0, mode: 0, mosaic: false, shape: 0, size: 0, priority: 0, characterBits: 4 };
}

function rgbaHex(color: readonly number[]): string {
  return `#${color.slice(0, 3).map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function timezoneName(timezone: number): string {
  return WEATHER_TIMEZONE_NAMES[timezone] ?? `Timezone ${timezone}`;
}

function signedMinutes(minutes: number): string {
  if (minutes === 0) return "+0 min";
  return `${minutes > 0 ? "+" : ""}${minutes} min`;
}

function formatVector(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function resourceExtension(bytes: Uint8Array): string {
  return ({ RGCN: "ncgr", RLCN: "nclr", RECN: "ncer", RNAN: "nanr", BTX0: "nsbtx", RCSN: "nscr" } as Record<string, string>)[String.fromCharCode(...bytes.slice(0, 4))] ?? "bin";
}

function downloadBytes(bytes: Uint8Array, name: string): void {
  const copy = bytes.slice();
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/octet-stream" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function showError(state: EditorState, error: unknown): void {
  state.status = error instanceof Error ? error.message : String(error);
  state.error = true;
}
