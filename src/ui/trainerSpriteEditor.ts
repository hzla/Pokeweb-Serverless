import {
  TRAINER_SPRITE_FILE_FORMATS,
  applyTrainerSpriteGifBuild,
  buildTrainerSpriteGifPreview,
  defaultTrainerSpriteGifConfig,
  ensureTrainerSpriteStore,
  getTrainerClassIdsSharingGraphic,
  getTrainerClassRigAtlas,
  getTrainerClassSpriteAnimation,
  type TrainerSpriteGifBuild,
  type TrainerSpriteGifConfig,
  type TrainerClassSpriteAnimation,
  type TrainerSpriteAnimationFrame,
} from "../pokeweb/trainerSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type TrainerSpriteEditorOptions = {
  onDirty?: () => void;
  onBack?: () => void;
  onNavigateClass?: (trainerClassId: number) => void;
};

type AnimationBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

const TRAINER_ANIMATION_CANVAS_WIDTH = 320;
const TRAINER_ANIMATION_CANVAS_HEIGHT = 400;
const TRAINER_ANIMATION_TICK_MS = 1000 / 60;

let playbackHandle: number | undefined;
let activeTrainerClassId: number | undefined;
let animationTick = 0;
let animationPlaying = true;
const trainerGifState: {
  trainerClassId?: number;
  source?: { bytes: Uint8Array; fileName: string };
  build?: TrainerSpriteGifBuild;
  config: TrainerSpriteGifConfig;
  status: string;
} = {
  config: defaultTrainerSpriteGifConfig(),
  status: "Choose a GIF to generate a native trainer animation preview.",
};

export async function renderTrainerSpriteEditor(
  project: ProjectState,
  root: HTMLElement,
  trainerClassId: number,
  options: TrainerSpriteEditorOptions = {},
): Promise<void> {
  stopTrainerSpriteEditorPlayback();
  root.innerHTML = `<div class="sprite-editor-error"><p>Loading trainer sprite animation...</p></div>`;

  try {
    if (!(await ensureTrainerSpriteStore(project))) throw new Error("Trainer sprite data is not available for this ROM.");
    if (!root.isConnected) return;
    const nativeAnimation = getTrainerClassSpriteAnimation(project, trainerClassId);
    if (activeTrainerClassId !== trainerClassId) {
      activeTrainerClassId = trainerClassId;
      animationTick = 0;
      animationPlaying = true;
      trainerGifState.trainerClassId = trainerClassId;
      trainerGifState.source = undefined;
      trainerGifState.build = undefined;
      trainerGifState.status = "Choose a GIF to generate a native trainer animation preview.";
    }
    const pendingBuild = trainerGifState.trainerClassId === trainerClassId ? trainerGifState.build : undefined;
    const animation = pendingBuild?.animation ?? nativeAnimation;
    const rigAtlas = pendingBuild?.rigAtlas ?? getTrainerClassRigAtlas(project, trainerClassId);
    animationTick = wrapTick(animationTick, animation.totalTicks);

    const className = trainerClassName(project, trainerClassId);
    root.innerHTML = `
      <aside class="pokemon-filter sprite-sidebar trainer-sprite-sidebar">
        <div class="sprite-sidebar-content">
          <div class="filter-title">Trainer Sprite Editor</div>
          <label class="sprite-field">
            <span>Trainer class</span>
            <select id="trainer-sprite-class-select">
              ${renderTrainerClassOptions(project, trainerClassId)}
            </select>
          </label>
          <div class="sprite-meta">
            <strong>${escapeHtml(className)}</strong>
            <span>Class ${trainerClassId} · Graphic ${animation.graphicIndex}</span>
          </div>
          <div class="trainer-sprite-format-panel">
            <div class="sprite-sidebar-heading">ROM files</div>
            <div class="trainer-sprite-format-list">
              ${TRAINER_SPRITE_FILE_FORMATS.map((format, index) => `<span><b>${index}</b>${format}</span>`).join("")}
            </div>
            <p>Uses the same Nitro cell, animation, multi-cell, rig, and palette formats as the Pokémon sprite editor.</p>
          </div>
          <button class="btn -default trainer-sprite-back" id="trainer-sprite-back" type="button">Back to Trainers</button>
        </div>
      </aside>
      <main class="sprite-editor-page trainer-sprite-editor-page">
        <section class="sprite-section">
          <div class="sprite-section-header animation-section-header">
            <div class="animation-title-row">
              <h2>Animation</h2>
              <div class="animation-header-scrubber animation-frame-scrubber">
                <label class="animation-frame-range">
                  <span><strong id="trainer-animation-frame-label">${animationFrameLabel(animationTick, animation.totalTicks)}</strong></span>
                  <input id="trainer-animation-frame" type="range" min="0" max="${Math.max(0, animation.totalTicks - 1)}" value="${animationTick}">
                </label>
              </div>
            </div>
          </div>
          <div class="trainer-animation-workbench">
            <div class="animation-canvas-wrap trainer-animation-canvas-wrap">
              <canvas id="trainer-sprite-animation-canvas" width="${TRAINER_ANIMATION_CANVAS_WIDTH}" height="${TRAINER_ANIMATION_CANVAS_HEIGHT}"></canvas>
              <div class="animation-canvas-playback" aria-label="Animation playback controls">
                <button class="animation-icon-btn" id="trainer-animation-step-back" type="button" aria-label="Step backward" title="Step backward"><span class="animation-icon -step-back" aria-hidden="true"></span></button>
                <button class="animation-icon-btn" id="trainer-animation-play" type="button" aria-label="Pause" title="Pause"><span class="animation-icon -pause" aria-hidden="true"></span></button>
                <button class="animation-icon-btn" id="trainer-animation-step-forward" type="button" aria-label="Step forward" title="Step forward"><span class="animation-icon -step-forward" aria-hidden="true"></span></button>
              </div>
            </div>
            <div class="animation-controls trainer-animation-details">
              <div class="animation-part-summary">
                <strong>${escapeHtml(className)}</strong>
                <span>${pendingBuild ? "Generated GIF preview · not yet applied" : "Native battle-intro multi-cell animation"}</span>
              </div>
              ${animationDetail("Timeline", `${animation.totalTicks} ticks at 60 FPS`)}
              ${animationDetail("Cell sequences", animation.cellSequenceCount)}
              ${animationDetail("Multi-cells", animation.multiCellCount)}
              ${animationDetail("NMAR keys", animation.outerKeyFrameCount)}
              ${animationDetail("Graphic", animation.graphicIndex)}
              ${animationDetail("Trainer class", trainerClassId)}
            </div>
          </div>
        </section>
        ${renderTrainerRigAtlas(rigAtlas.width, rigAtlas.height, Boolean(pendingBuild))}
        ${renderTrainerGifImporter(project, trainerClassId, pendingBuild)}
      </main>
    `;

    const frameCanvases = animation.frames.map(frameCanvas);
    const bounds = animationBounds(animation.frames);
    attachTrainerSpriteEditor(project, root, trainerClassId, animation, frameCanvases, bounds, options);
    drawTrainerAnimationFrame(root, animation, frameCanvases, bounds);
    drawTrainerRigAtlas(root, rigAtlas);
    syncPlaybackButton(root);
    if (animationPlaying) startPlayback(root, animation, frameCanvases, bounds);
  } catch (error) {
    if (!root.isConnected) return;
    root.innerHTML = `
      <div class="sprite-editor-error">
        <button class="btn -default" id="trainer-sprite-back" type="button">Back to Trainers</button>
        <p>${escapeHtml(errorMessage(error))}</p>
      </div>
    `;
    root.querySelector("#trainer-sprite-back")?.addEventListener("click", () => options.onBack?.());
  }
}

function renderTrainerRigAtlas(width: number, height: number, pending: boolean): string {
  return `
    <section class="sprite-section trainer-rig-atlas-section">
      <div class="sprite-section-header">
        <div>
          <h2>Rig Atlas</h2>
          <span>${pending ? "Generated NCBR preview · not yet applied" : "Native NCBR texture used by the trainer cells"}</span>
        </div>
        <strong>${width} × ${height} · 4bpp</strong>
      </div>
      <div class="trainer-rig-atlas-wrap">
        <canvas id="trainer-rig-atlas-canvas" width="${width * 2}" height="${height * 2}" aria-label="Trainer rig atlas"></canvas>
      </div>
    </section>
  `;
}

function drawTrainerRigAtlas(root: HTMLElement, atlas: { width: number; height: number; pixels: Uint8ClampedArray }): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#trainer-rig-atlas-canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const source = document.createElement("canvas");
  source.width = atlas.width;
  source.height = atlas.height;
  source.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(atlas.pixels), atlas.width, atlas.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#242638";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height, 16);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
}

export function stopTrainerSpriteEditorPlayback(): void {
  if (playbackHandle !== undefined) cancelAnimationFrame(playbackHandle);
  playbackHandle = undefined;
}

function attachTrainerSpriteEditor(
  project: ProjectState,
  root: HTMLElement,
  trainerClassId: number,
  animation: TrainerClassSpriteAnimation,
  frameCanvases: HTMLCanvasElement[],
  bounds: AnimationBounds,
  options: TrainerSpriteEditorOptions,
): void {
  root.querySelector("#trainer-sprite-back")?.addEventListener("click", () => options.onBack?.());
  root.querySelector<HTMLSelectElement>("#trainer-sprite-class-select")?.addEventListener("change", (event) => {
    const trainerClassId = Number((event.currentTarget as HTMLSelectElement).value);
    if (Number.isInteger(trainerClassId)) options.onNavigateClass?.(trainerClassId);
  });
  root.querySelector<HTMLInputElement>("#trainer-animation-frame")?.addEventListener("input", (event) => {
    animationPlaying = false;
    stopTrainerSpriteEditorPlayback();
    animationTick = wrapTick(Number((event.currentTarget as HTMLInputElement).value), animation.totalTicks);
    drawTrainerAnimationFrame(root, animation, frameCanvases, bounds);
    syncPlaybackControls(root, animation);
  });
  root.querySelector("#trainer-animation-play")?.addEventListener("click", () => {
    animationPlaying = !animationPlaying;
    stopTrainerSpriteEditorPlayback();
    syncPlaybackButton(root);
    if (animationPlaying) startPlayback(root, animation, frameCanvases, bounds);
  });
  root.querySelector("#trainer-animation-step-back")?.addEventListener("click", () => {
    stepAnimation(root, animation, frameCanvases, bounds, -1);
  });
  root.querySelector("#trainer-animation-step-forward")?.addEventListener("click", () => {
    stepAnimation(root, animation, frameCanvases, bounds, 1);
  });
  installTrainerGifImporter(project, root, trainerClassId, options);
}

function renderTrainerGifImporter(project: ProjectState, trainerClassId: number, build: TrainerSpriteGifBuild | undefined): string {
  const config = trainerGifState.config;
  const sourceName = trainerGifState.source?.fileName ?? "Click or drop animation GIF";
  const affectedClassIds = build?.affectedClassIds ?? getTrainerClassIdsSharingGraphic(project, trainerClassId);
  const affectedLabels = affectedClassIds.map((classId) => `${trainerClassName(project, classId)} (${classId})`);
  const sharedWarning = affectedClassIds.length > 1
    ? `<div class="trainer-gif-shared-warning"><strong>Shared graphic</strong><span>Applying will update ${affectedLabels.map(escapeHtml).join(", ")}.</span></div>`
    : "";
  return `
    <section class="sprite-section trainer-gif-section" id="trainer-gif-import-section">
      <div class="sprite-section-header">
        <div>
          <h2>Import GIF</h2>
          <span>Generate a complete native NCGR/NCBR/NCER/NANR/NMCR/NMAR/NCEC/NCLR bundle.</span>
        </div>
        <div class="sprite-actions -inline">
          <button class="btn -default" id="trainer-gif-generate" type="button" ${trainerGifState.source ? "" : "disabled"}>Generate Preview</button>
          <button class="btn -default" id="trainer-gif-apply" type="button" ${build ? "" : "disabled"}>Apply to ROM</button>
        </div>
      </div>
      ${sharedWarning}
      <div class="gif-flipbook-panel trainer-gif-panel">
        <div class="trainer-gif-controls">
          ${trainerGifSelect("Packing", "trainer-gif-packing", [
            ["mcss-safe", "Pose Blocks"],
            ["rotated-pose-blocks", "Rotated Pose"],
            ["macro-blocks", "Macro Blocks"],
            ["tile-node-dedup", "Tile Nodes"],
          ], config.packingMode)}
          ${trainerGifSelect("Sampling", "trainer-gif-strategy", [
            ["loop-rest", "Loop Rest"],
            ["first-window", "Keyframes"],
            ["front-load", "Front Load"],
            ["even", "Even"],
          ], config.strategy)}
          ${trainerGifSelect("Playback", "trainer-gif-playback", [
            ["auto", "From GIF"],
            ["loop", "Loop"],
            ["once", "Play Once"],
          ], config.playbackMode)}
          ${trainerGifSelect("Rest Loops", "trainer-gif-rest-loops", [
            ["auto", "Auto"],
            ["1", "1"],
            ["2", "2"],
            ["3", "3"],
          ], String(config.restLoopCount))}
          ${trainerGifNumber("Source %", "trainer-gif-source-percent", config.sourceFramePercent, 1, 100, 1)}
          ${trainerGifNumber("Source Scale %", "trainer-gif-downscale", config.downscalePercent, 5, 100, 5)}
          ${trainerGifNumber("Output Scale %", "trainer-gif-output-scale", config.outputScalePercent, 100, 400, 5)}
          ${trainerGifNumber("Speed", "trainer-gif-speed", roundDisplay(1 / Math.max(0.01, config.durationScale)), 0.1, 4, 0.1)}
          <label class="sprite-field -checkbox"><span>Append Finish</span><input id="trainer-gif-include-finish" type="checkbox" ${config.includeFinish ? "checked" : ""}></label>
          <label class="sprite-field trainer-gif-manual"><span>Manual Frames</span><input id="trainer-gif-manual-frames" type="text" value="${escapeHtml(config.manualFrameNumbers?.join(", ") ?? "")}" placeholder="0, 4, 8, 12"></label>
        </div>
        <label class="sprite-bundle-drop gif-flipbook-drop trainer-gif-drop" id="trainer-gif-drop">
          <input id="trainer-gif-file" type="file" accept="image/gif,.gif">
          <strong>Trainer Animation GIF</strong>
          <span id="trainer-gif-file-name">${escapeHtml(sourceName)}</span>
        </label>
        <div class="trainer-gif-status" id="trainer-gif-status">${escapeHtml(trainerGifState.status)}</div>
        ${build ? renderTrainerGifReport(project, build) : ""}
      </div>
    </section>
  `;
}

function renderTrainerGifReport(project: ProjectState, build: TrainerSpriteGifBuild): string {
  const report = build.report;
  const palette = build.palette.map((color, index) => `<span title="Color ${index}" style="background: rgb(${color.r} ${color.g} ${color.b})"></span>`).join("");
  const warnings = report.warnings.length
    ? `<div class="trainer-gif-report-warnings">${report.warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>`
    : `<div class="trainer-gif-report-ok">No conversion warnings.</div>`;
  return `
    <div class="trainer-gif-report">
      ${animationDetail("Selected frames", report.selectedSourceFrames.length)}
      ${animationDetail("Unique poses", report.uniquePoseCount)}
      ${animationDetail("Atlas", `${report.uniqueTileCount} tiles · ${report.atlasOccupancyPercent}%`)}
      ${animationDetail("Max OAM", report.maxOamsPerPose)}
      ${animationDetail("Timeline", `${report.totalTicks} ticks · ${report.playbackMode}`)}
      ${animationDetail("Affected classes", build.affectedClassIds.map((classId) => trainerClassName(project, classId)).join(", "))}
      <div class="trainer-gif-palette">${palette}</div>
      ${warnings}
    </div>
  `;
}

function trainerGifSelect(label: string, id: string, options: Array<[string, string]>, selected: string): string {
  return `<label class="sprite-field"><span>${escapeHtml(label)}</span><select id="${id}">${options
    .map(([value, optionLabel]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`)
    .join("")}</select></label>`;
}

function trainerGifNumber(label: string, id: string, value: number, min: number, max: number, step: number): string {
  return `<label class="sprite-field"><span>${escapeHtml(label)}</span><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function installTrainerGifImporter(project: ProjectState, root: HTMLElement, trainerClassId: number, options: TrainerSpriteEditorOptions): void {
  const fileInput = root.querySelector<HTMLInputElement>("#trainer-gif-file");
  const drop = root.querySelector<HTMLElement>("#trainer-gif-drop");
  const readFile = async (file: File) => {
    trainerGifState.source = { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name };
    trainerGifState.build = undefined;
    trainerGifState.status = `Loaded ${file.name}. Generating native preview...`;
    await generateTrainerGifPreview(project, root, trainerClassId, options);
  };
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) await readFile(file);
  });
  drop?.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("-dragging");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("-dragging"));
  drop?.addEventListener("drop", async (event) => {
    event.preventDefault();
    drop.classList.remove("-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) await readFile(file);
  });
  root.querySelector("#trainer-gif-generate")?.addEventListener("click", async () => generateTrainerGifPreview(project, root, trainerClassId, options));
  root.querySelector("#trainer-gif-apply")?.addEventListener("click", async () => {
    const build = trainerGifState.build;
    if (!build) return;
    if (build.affectedClassIds.length > 1) {
      const labels = build.affectedClassIds.map((classId) => `${trainerClassName(project, classId)} (${classId})`).join(", ");
      if (!window.confirm(`This graphic is shared. Applying will update: ${labels}.\n\nContinue?`)) return;
    }
    try {
      applyTrainerSpriteGifBuild(project, build);
      trainerGifState.build = undefined;
      trainerGifState.status = `Applied ${trainerGifState.source?.fileName ?? "GIF"} to native trainer graphic ${build.graphicIndex}.`;
      options.onDirty?.();
      animationTick = 0;
      animationPlaying = true;
      await renderTrainerSpriteEditor(project, root, trainerClassId, options);
    } catch (error) {
      setTrainerGifStatus(root, errorMessage(error), true);
    }
  });
}

async function generateTrainerGifPreview(project: ProjectState, root: HTMLElement, trainerClassId: number, options: TrainerSpriteEditorOptions): Promise<void> {
  const source = trainerGifState.source;
  if (!source) return;
  try {
    trainerGifState.config = readTrainerGifConfig(root);
    setTrainerGifStatus(root, `Building native trainer animation from ${source.fileName}...`, false);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    trainerGifState.build = buildTrainerSpriteGifPreview(project, trainerClassId, source.bytes, trainerGifState.config);
    trainerGifState.status = `Preview ready: ${trainerGifState.build.report.uniquePoseCount} pose(s), ${trainerGifState.build.report.uniqueTileCount} tiles.`;
    animationTick = 0;
    animationPlaying = true;
    await renderTrainerSpriteEditor(project, root, trainerClassId, options);
  } catch (error) {
    trainerGifState.build = undefined;
    trainerGifState.status = errorMessage(error);
    setTrainerGifStatus(root, trainerGifState.status, true);
  }
}

function readTrainerGifConfig(root: HTMLElement): TrainerSpriteGifConfig {
  const defaults = defaultTrainerSpriteGifConfig();
  const restLoops = root.querySelector<HTMLSelectElement>("#trainer-gif-rest-loops")?.value ?? "auto";
  const speed = clamp(Number(root.querySelector<HTMLInputElement>("#trainer-gif-speed")?.value ?? 1), 0.1, 4);
  const manualText = root.querySelector<HTMLInputElement>("#trainer-gif-manual-frames")?.value.trim() ?? "";
  return {
    ...defaults,
    packingMode: (root.querySelector<HTMLSelectElement>("#trainer-gif-packing")?.value as TrainerSpriteGifConfig["packingMode"]) ?? defaults.packingMode,
    strategy: (root.querySelector<HTMLSelectElement>("#trainer-gif-strategy")?.value as TrainerSpriteGifConfig["strategy"]) ?? defaults.strategy,
    playbackMode: (root.querySelector<HTMLSelectElement>("#trainer-gif-playback")?.value as TrainerSpriteGifConfig["playbackMode"]) ?? defaults.playbackMode,
    sourceFramePercent: clamp(Number(root.querySelector<HTMLInputElement>("#trainer-gif-source-percent")?.value ?? 100), 1, 100),
    downscalePercent: clamp(Number(root.querySelector<HTMLInputElement>("#trainer-gif-downscale")?.value ?? 100), 5, 100),
    outputScalePercent: clamp(Number(root.querySelector<HTMLInputElement>("#trainer-gif-output-scale")?.value ?? 100), 100, 400),
    durationScale: 1 / speed,
    restLoopCount: restLoops === "1" || restLoops === "2" || restLoops === "3" ? Number(restLoops) as 1 | 2 | 3 : "auto",
    includeFinish: Boolean(root.querySelector<HTMLInputElement>("#trainer-gif-include-finish")?.checked),
    manualFrameNumbers: manualText ? parseManualFrames(manualText) : undefined,
  };
}

function parseManualFrames(text: string): number[] {
  const frames = text.split(/[\s,]+/u).filter(Boolean).map(Number);
  if (frames.length === 0 || frames.some((frame) => !Number.isInteger(frame) || frame < 0)) throw new Error("Manual frames must be non-negative frame numbers separated by commas");
  return [...new Set(frames)];
}

function setTrainerGifStatus(root: HTMLElement, message: string, error: boolean): void {
  const status = root.querySelector<HTMLElement>("#trainer-gif-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("-error", error);
}

function startPlayback(root: HTMLElement, animation: TrainerClassSpriteAnimation, frameCanvases: HTMLCanvasElement[], bounds: AnimationBounds): void {
  stopTrainerSpriteEditorPlayback();
  let lastTickAt = performance.now();
  const play = (now: number) => {
    if (!animationPlaying || !root.isConnected) {
      playbackHandle = undefined;
      return;
    }
    const elapsed = now - lastTickAt;
    if (elapsed >= TRAINER_ANIMATION_TICK_MS) {
      const elapsedTicks = Math.max(1, Math.floor(elapsed / TRAINER_ANIMATION_TICK_MS));
      lastTickAt += elapsedTicks * TRAINER_ANIMATION_TICK_MS;
      animationTick = wrapTick(animationTick + elapsedTicks, animation.totalTicks);
      drawTrainerAnimationFrame(root, animation, frameCanvases, bounds);
      syncPlaybackControls(root, animation);
    }
    playbackHandle = requestAnimationFrame(play);
  };
  playbackHandle = requestAnimationFrame(play);
}

function stepAnimation(
  root: HTMLElement,
  animation: TrainerClassSpriteAnimation,
  frameCanvases: HTMLCanvasElement[],
  bounds: AnimationBounds,
  delta: number,
): void {
  animationPlaying = false;
  stopTrainerSpriteEditorPlayback();
  animationTick = wrapTick(animationTick + delta, animation.totalTicks);
  drawTrainerAnimationFrame(root, animation, frameCanvases, bounds);
  syncPlaybackControls(root, animation);
}

function drawTrainerAnimationFrame(
  root: HTMLElement,
  animation: TrainerClassSpriteAnimation,
  frameCanvases: HTMLCanvasElement[],
  bounds: AnimationBounds,
): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#trainer-sprite-animation-canvas");
  const frame = animation.frames[wrapTick(animationTick, animation.totalTicks)] ?? animation.frames[0];
  const source = frameCanvases[frame?.index ?? 0];
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !frame || !source) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#242638";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height, 24);

  const scale = Math.max(1, Math.min(3, Math.floor(Math.min((canvas.width - 40) / bounds.width, (canvas.height - 40) / bounds.height))));
  const originX = Math.round((canvas.width - bounds.width * scale) / 2 - bounds.minX * scale);
  const originY = Math.round((canvas.height - bounds.height * scale) / 2 - bounds.minY * scale);
  ctx.drawImage(source, originX + frame.x * scale, originY + frame.y * scale, frame.width * scale, frame.height * scale);
}

function frameCanvas(frame: TrainerSpriteAnimationFrame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const pixels = new Uint8ClampedArray(frame.rgba.length);
  pixels.set(frame.rgba);
  canvas.getContext("2d")?.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
  return canvas;
}

function animationBounds(frames: TrainerSpriteAnimationFrame[]): AnimationBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const frame of frames) {
    if (!frame.rgba.some((value, index) => index % 4 === 3 && value > 0)) continue;
    minX = Math.min(minX, frame.x);
    minY = Math.min(minY, frame.y);
    maxX = Math.max(maxX, frame.x + frame.width);
    maxY = Math.max(maxY, frame.y + frame.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { minX: 0, minY: 0, width: 1, height: 1 };
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, step: number): void {
  ctx.strokeStyle = "rgb(255 255 255 / 10%)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function syncPlaybackControls(root: HTMLElement, animation: TrainerClassSpriteAnimation): void {
  const slider = root.querySelector<HTMLInputElement>("#trainer-animation-frame");
  if (slider) slider.value = String(animationTick);
  const label = root.querySelector<HTMLElement>("#trainer-animation-frame-label");
  if (label) label.textContent = animationFrameLabel(animationTick, animation.totalTicks);
  syncPlaybackButton(root);
}

function syncPlaybackButton(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>("#trainer-animation-play");
  if (!button) return;
  const label = animationPlaying ? "Pause" : "Play";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  const icon = button.querySelector<HTMLElement>(".animation-icon");
  icon?.classList.toggle("-pause", animationPlaying);
  icon?.classList.toggle("-play", !animationPlaying);
}

function renderTrainerClassOptions(project: ProjectState, selectedClassId: number): string {
  const names = project.texts.banks.tr_classes ?? [];
  const graphicCount = Math.floor((project.narcs.trainer_sprites?.fileCount ?? 0) / TRAINER_SPRITE_FILE_FORMATS.length);
  const classCount = Math.max(names.length, graphicCount, selectedClassId + 1);
  return Array.from({ length: classCount }, (_unused, trainerClassId) => {
    const label = trainerClassName(project, trainerClassId);
    return `<option value="${trainerClassId}" ${trainerClassId === selectedClassId ? "selected" : ""}>${escapeHtml(label)} (${trainerClassId})</option>`;
  }).join("");
}

function trainerClassName(project: ProjectState, trainerClassId: number): string {
  return project.texts.banks.tr_classes?.[trainerClassId] || `Trainer Class ${trainerClassId}`;
}

function animationDetail(label: string, value: string | number): string {
  return `<div class="trainer-animation-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function animationFrameLabel(tick: number, totalTicks: number): string {
  return `Tick ${wrapTick(tick, totalTicks) + 1} / ${Math.max(1, totalTicks)}`;
}

function wrapTick(tick: number, totalTicks: number): number {
  if (totalTicks <= 0) return 0;
  const rounded = Math.round(tick);
  return ((rounded % totalTicks) + totalTicks) % totalTicks;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundDisplay(value: number): number {
  return Math.round(value * 100) / 100;
}
