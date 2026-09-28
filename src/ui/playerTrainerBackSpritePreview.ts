import {
  PLAYER_BACK_APPEARANCES,
  ensurePlayerTrainerBackSpriteStore,
  getPlayerTrainerBackSpritePreview,
} from "../pokeweb/playerTrainerBackSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import {
  TRAINER_ANIMATION_TICK_MS,
  animationBounds,
  animationFrameLabel,
  drawTrainerAtlas,
  drawTrainerFrame,
  frameCanvas,
  wrapTick,
} from "./trainerSpritePreview";

type PreviewOptions = { onBack?: () => void };

let playbackHandle: number | undefined;
let renderGeneration = 0;

export function stopPlayerTrainerBackSpritePlayback(): void {
  renderGeneration += 1;
  if (playbackHandle !== undefined) cancelAnimationFrame(playbackHandle);
  playbackHandle = undefined;
}

export async function renderPlayerTrainerBackSpritePreview(
  project: ProjectState,
  root: HTMLElement,
  appearanceIndex = 0,
  options: PreviewOptions = {},
): Promise<void> {
  stopPlayerTrainerBackSpritePlayback();
  const generation = renderGeneration;
  root.innerHTML = `<div class="sprite-editor-error"><p>Loading player back sprite...</p></div>`;
  try {
    if (!(await ensurePlayerTrainerBackSpriteStore(project))) throw new Error("Player back-sprite data is unavailable. Reopen the Black 2 or White 2 ROM.");
    if (generation !== renderGeneration || !root.isConnected) return;
    const preview = getPlayerTrainerBackSpritePreview(project, appearanceIndex);
    const { animation, staticGraphic, rigAtlas, palette } = preview;
    const name = PLAYER_BACK_APPEARANCES[appearanceIndex]?.label ?? `Appearance ${appearanceIndex}`;
    root.innerHTML = `
      <aside class="pokemon-filter sprite-sidebar trainer-sprite-sidebar">
        <div class="sprite-sidebar-content">
          <div class="filter-title">Player Back Sprite</div>
          <label class="sprite-field"><span>Appearance</span><select id="player-back-appearance">
            ${PLAYER_BACK_APPEARANCES.map((entry) => `<option value="${entry.index}" ${entry.index === appearanceIndex ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}
          </select></label>
          <div class="sprite-meta"><strong>${escapeHtml(name)}</strong><span>Archive a/0/7/2 · Graphic ${appearanceIndex}</span></div>
          <p class="player-back-scope">This preview shows the native trainer pose timeline. The thrown ball, Pokémon entrance, and battle scene effects are separate.</p>
          <button class="btn -default trainer-sprite-back" id="player-back-return" type="button">Back to Trainers</button>
        </div>
      </aside>
      <main class="sprite-editor-page trainer-sprite-editor-page player-back-page">
        <section class="sprite-section">
          <div class="sprite-section-header animation-section-header">
            <div class="animation-title-row"><h2>Trainer pose animation</h2>
              <div class="animation-header-scrubber animation-frame-scrubber"><label class="animation-frame-range">
                <span><strong id="player-back-tick-label">${animationFrameLabel(0, animation.totalTicks)}</strong></span>
                <input id="player-back-tick" type="range" min="0" max="${Math.max(0, animation.totalTicks - 1)}" value="0" aria-label="Animation tick">
              </label></div>
            </div>
          </div>
          <div class="trainer-animation-workbench">
            <div class="animation-canvas-wrap trainer-animation-canvas-wrap">
              <canvas id="player-back-animation-canvas" width="320" height="400" aria-label="Player back-sprite animation"></canvas>
              <div class="animation-canvas-playback" aria-label="Animation playback controls">
                <button class="animation-icon-btn" id="player-back-step-back" type="button" aria-label="Step backward" title="Step backward"><span class="animation-icon -step-back" aria-hidden="true"></span></button>
                <button class="animation-icon-btn" id="player-back-play" type="button" aria-label="Pause" title="Pause"><span class="animation-icon -pause" aria-hidden="true"></span></button>
                <button class="animation-icon-btn" id="player-back-step-forward" type="button" aria-label="Step forward" title="Step forward"><span class="animation-icon -step-forward" aria-hidden="true"></span></button>
              </div>
            </div>
            <div class="animation-controls trainer-animation-details">
              ${detail("Timeline", `${animation.totalTicks} ticks at 60 FPS`)}
              ${detail("Cell sequences", animation.cellSequenceCount)}
              ${detail("Multi-cells", animation.multiCellCount)}
              ${detail("NMAR keys", animation.outerKeyFrameCount)}
              ${detail("NMAR sequence", `${animation.outerSequenceIndex + 1} / ${animation.outerSequenceCount}`)}
              ${detail("Graphic", appearanceIndex)}
            </div>
          </div>
        </section>
        <section class="sprite-section player-back-graphics">
          <div class="sprite-section-header"><div><h2>ROM graphics</h2><span>Native NCGR image, NCBR rig atlas, and NCLR palette</span></div></div>
          <div class="player-back-graphics-grid">
            ${graphicCanvas("Static NCGR", "player-back-static", staticGraphic.width, staticGraphic.height, !staticGraphic.pixels.some((value, index) => index % 4 === 3 && value > 0))}
            ${graphicCanvas("Rig atlas NCBR", "player-back-atlas", rigAtlas.width, rigAtlas.height)}
          </div>
          <div class="player-back-palette" aria-label="Trainer palette">${palette.map((color, index) => `<div class="player-back-swatch"><span style="background:rgb(${color[0]} ${color[1]} ${color[2]})"></span><small>${index}</small></div>`).join("")}</div>
        </section>
      </main>
    `;

    const frameCanvases = animation.frames.map(frameCanvas);
    const bounds = animationBounds(animation.frames);
    const canvas = root.querySelector<HTMLCanvasElement>("#player-back-animation-canvas");
    let tick = 0;
    let playing = true;
    const draw = () => {
      drawTrainerFrame(canvas, animation.frames, frameCanvases, bounds, tick);
      const slider = root.querySelector<HTMLInputElement>("#player-back-tick");
      if (slider) slider.value = String(tick);
      const label = root.querySelector<HTMLElement>("#player-back-tick-label");
      if (label) label.textContent = animationFrameLabel(tick, animation.totalTicks);
      const playButton = root.querySelector<HTMLButtonElement>("#player-back-play");
      const playLabel = playing ? "Pause" : "Play";
      playButton?.setAttribute("aria-label", playLabel);
      playButton?.setAttribute("title", playLabel);
      playButton?.querySelector(".animation-icon")?.classList.toggle("-pause", playing);
      playButton?.querySelector(".animation-icon")?.classList.toggle("-play", !playing);
    };
    const pause = () => {
      playing = false;
      if (playbackHandle !== undefined) cancelAnimationFrame(playbackHandle);
      playbackHandle = undefined;
      draw();
    };
    const play = () => {
      if (!playing) return;
      let lastTickAt = performance.now();
      const animate = (now: number) => {
        if (!playing || generation !== renderGeneration || !root.isConnected) {
          playbackHandle = undefined;
          return;
        }
        const elapsedTicks = Math.floor((now - lastTickAt) / TRAINER_ANIMATION_TICK_MS);
        if (elapsedTicks > 0) {
          lastTickAt += elapsedTicks * TRAINER_ANIMATION_TICK_MS;
          tick = wrapTick(tick + elapsedTicks, animation.totalTicks);
          draw();
        }
        playbackHandle = requestAnimationFrame(animate);
      };
      playbackHandle = requestAnimationFrame(animate);
    };

    root.querySelector<HTMLSelectElement>("#player-back-appearance")?.addEventListener("change", (event) => {
      void renderPlayerTrainerBackSpritePreview(project, root, Number((event.currentTarget as HTMLSelectElement).value), options);
    });
    root.querySelector("#player-back-return")?.addEventListener("click", () => options.onBack?.());
    root.querySelector<HTMLInputElement>("#player-back-tick")?.addEventListener("input", (event) => {
      const nextTick = Number((event.currentTarget as HTMLInputElement).value);
      pause();
      tick = wrapTick(nextTick, animation.totalTicks);
      draw();
    });
    root.querySelector("#player-back-play")?.addEventListener("click", () => {
      playing = !playing;
      draw();
      if (playing) play();
      else pause();
    });
    root.querySelector("#player-back-step-back")?.addEventListener("click", () => { pause(); tick = wrapTick(tick - 1, animation.totalTicks); draw(); });
    root.querySelector("#player-back-step-forward")?.addEventListener("click", () => { pause(); tick = wrapTick(tick + 1, animation.totalTicks); draw(); });
    drawTrainerAtlas(root.querySelector<HTMLCanvasElement>("#player-back-static"), staticGraphic);
    drawTrainerAtlas(root.querySelector<HTMLCanvasElement>("#player-back-atlas"), rigAtlas);
    draw();
    play();
  } catch (error) {
    if (generation !== renderGeneration || !root.isConnected) return;
    root.innerHTML = `<div class="sprite-editor-error"><button class="btn -default" id="player-back-return" type="button">Back to Trainers</button><p role="alert">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`;
    root.querySelector("#player-back-return")?.addEventListener("click", () => options.onBack?.());
  }
}

function graphicCanvas(label: string, id: string, width: number, height: number, empty = false): string {
  return `<div class="player-back-graphic"><strong>${escapeHtml(label)}</strong><span>${width} × ${height}</span><div class="trainer-rig-atlas-wrap"><canvas id="${id}" width="${width * 2}" height="${height * 2}" aria-label="${escapeHtml(label)}"></canvas></div>${empty ? `<small class="player-back-empty">This ROM's NCGR image is empty; the poses come from the NCBR rig atlas.</small>` : ""}</div>`;
}

function detail(label: string, value: string | number): string {
  return `<div class="trainer-animation-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}
