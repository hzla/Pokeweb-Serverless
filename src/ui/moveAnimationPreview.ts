import { simulateBattleCamera, type BattleCameraState } from "../pokeweb/battleCameraSimulator";
import { TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "../pokeweb/battlePreviewAnchors";
import type { MoveAnimationPreview } from "../pokeweb/moveAnimationPreviewModel";
import type { SpaTexture } from "../pokeweb/nitroSpa";
import { simulateSplPreview, type SplFrameParticle } from "../pokeweb/splEmitterSimulator";
import { escapeHtml } from "./dom";

type ThreeModule = typeof import("three");

export type MoveAnimationPreviewController = {
  destroy: () => void;
};

export async function installMoveAnimationPreview(host: HTMLElement, preview: MoveAnimationPreview): Promise<MoveAnimationPreviewController> {
  const THREE = await import("three");
  const rendererHost = document.createElement("div");
  rendererHost.className = "move-animation-preview-stage";
  const backgroundCanvas = document.createElement("canvas");
  backgroundCanvas.className = "move-animation-preview-bg";
  host.innerHTML = renderPreviewShell(preview);
  const canvasHost = host.querySelector<HTMLElement>(".move-animation-preview-canvas");
  canvasHost?.append(backgroundCanvas, rendererHost);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  rendererHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
  camera.position.set(0, 30, 72);
  camera.lookAt(0, 6, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  scene.add(makeStage(THREE));

  const effectRoot = new THREE.Group();
  scene.add(effectRoot);
  const effects = createEffects(THREE, preview, effectRoot);
  const background = createBackgroundController(preview, backgroundCanvas);

  let frame = 0;
  let speed = 1;
  let playing = true;
  let loop = true;
  let raf = 0;
  let lastTime = performance.now();
  let disposed = false;

  const playButton = host.querySelector<HTMLButtonElement>(".move-preview-play");
  const restartButton = host.querySelector<HTMLButtonElement>(".move-preview-restart");
  const frameSlider = host.querySelector<HTMLInputElement>(".move-preview-frame");
  const speedSelect = host.querySelector<HTMLSelectElement>(".move-preview-speed");
  const loopInput = host.querySelector<HTMLInputElement>(".move-preview-loop");
  const frameLabel = host.querySelector<HTMLElement>(".move-preview-frame-label");

  const setFrame = (nextFrame: number) => {
    frame = Math.max(0, Math.min(preview.frameCount, nextFrame));
    if (frameSlider) frameSlider.value = String(Math.round(frame));
    if (frameLabel) frameLabel.textContent = `${Math.round(frame)} / ${preview.frameCount}`;
    effects.update(frame);
    updateTimeline(host, frame);
  };

  playButton?.addEventListener("click", () => {
    playing = !playing;
    playButton.textContent = playing ? "Pause" : "Play";
  });
  restartButton?.addEventListener("click", () => setFrame(0));
  frameSlider?.addEventListener("input", () => {
    playing = false;
    if (playButton) playButton.textContent = "Play";
    setFrame(Number(frameSlider.value));
  });
  speedSelect?.addEventListener("change", () => {
    speed = Number(speedSelect.value) || 1;
  });
  loopInput?.addEventListener("change", () => {
    loop = loopInput.checked;
  });

  const resize = () => {
    const rect = rendererHost.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    background.resize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(rendererHost);
  resize();

  const tick = (now: number) => {
    if (disposed) return;
    const elapsed = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (playing) {
      const nextFrame = frame + elapsed * 30 * speed;
      if (nextFrame >= preview.frameCount) {
        setFrame(loop ? 0 : preview.frameCount);
        if (!loop) {
          playing = false;
          if (playButton) playButton.textContent = "Play";
        }
      } else {
        setFrame(nextFrame);
      }
    }
    const cameraState = simulateBattleCamera(preview.timeline, frame);
    background.update(frame, cameraState);
    applyCameraState(camera, cameraState);
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(tick);
  };
  setFrame(0);
  raf = window.requestAnimationFrame(tick);

  return {
    destroy: () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      effects.destroy();
      background.destroy();
      renderer.dispose();
      host.innerHTML = "";
    },
  };
}

export function renderMoveBackgroundPreviewCanvas(canvas: HTMLCanvasElement, background: NonNullable<MoveAnimationPreview["backgrounds"] extends Map<number, infer T> ? T : never>): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = 256;
  const height = 192;
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  if (background.hasTransparency) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
  }
  drawTiledBackground(context, makeBackgroundImageData(background), width, height, 0, 0, [0, 0, 0], 0, 1);
}

function renderPreviewShell(preview: MoveAnimationPreview): string {
  return `
    <div class="move-animation-preview">
      <div class="move-animation-preview-controls">
        <button class="script-btn move-preview-play" type="button">Pause</button>
        <button class="script-btn move-preview-restart" type="button">Restart</button>
        <label>Frame <input class="move-preview-frame" type="range" min="0" max="${preview.frameCount}" value="0"></label>
        <span class="move-preview-frame-label">0 / ${preview.frameCount}</span>
        <label>Speed
          <select class="move-preview-speed">
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
          </select>
        </label>
        <label><input class="move-preview-loop" type="checkbox" checked> Loop</label>
      </div>
      <div class="move-animation-preview-grid">
        <div class="move-animation-preview-canvas"></div>
        <div class="move-animation-preview-side">
          <div class="move-animation-preview-timeline">
            ${preview.timeline
              .map(
                (event) => `
                  <div class="move-animation-preview-event -${event.status}" data-frame="${event.frame}">
                    <span>${event.frame}</span>
                    <strong>${escapeHtml(event.command)}</strong>
                    <small>${escapeHtml(event.message)}</small>
                    ${event.debug ? `<code>${escapeHtml(event.debug)}</code>` : ""}
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function makeStage(THREE: ThreeModule): import("three").Group {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(78, 48),
    new THREE.MeshBasicMaterial({ color: 0x2b3140, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  const grid = new THREE.GridHelper(78, 13, 0x50c3a5, 0x45495c);
  for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
    material.transparent = true;
    material.opacity = 0.18;
  }
  grid.position.y = 0.02;
  group.add(grid);
  group.add(makeActor(THREE, "USER", USER_BATTLE_ANCHOR[0], USER_BATTLE_ANCHOR[2], 1.12, 0x6fc9ff));
  group.add(makeActor(THREE, "TARGET", TARGET_BATTLE_ANCHOR[0], TARGET_BATTLE_ANCHOR[2], 0.92, 0xff9f65));
  return group;
}

function makeActor(THREE: ThreeModule, label: string, x: number, z: number, scale: number, color: number): import("three").Sprite {
  const texture = labelTexture(THREE, label, color);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.position.set(x, 7 * scale, z);
  sprite.scale.set(14 * scale, 8 * scale, 1);
  return sprite;
}

function applyCameraState(camera: import("three").PerspectiveCamera, state: BattleCameraState): void {
  camera.fov = state.fov;
  camera.position.set(state.position[0] + state.shake[0] * 12, state.position[1] + state.shake[1] * 8, state.position[2]);
  camera.lookAt(state.lookAt[0], state.lookAt[1], state.lookAt[2]);
  camera.updateProjectionMatrix();
}

type EffectRenderer = {
  update: (frame: number) => void;
  destroy: () => void;
};

type EffectSprite = {
  sprite: import("three").Sprite;
  material: import("three").SpriteMaterial;
};

function createEffects(THREE: ThreeModule, preview: MoveAnimationPreview, root: import("three").Group): EffectRenderer {
  const effects: EffectSprite[] = [];
  const textureCache = new Map<string, import("three").CanvasTexture>();
  const fallback = fallbackTexture(THREE);
  const circle = circleTexture(THREE);

  const getTexture = (particle: SplFrameParticle): import("three").CanvasTexture => {
    if (particle.textureKind === "circle") return circle;
    const event = preview.timeline.find((timelineEvent) => timelineEvent.id === particle.eventId);
    const archive = event?.spaId === undefined ? undefined : preview.spaArchives.get(event.spaId);
    const texture = archive?.textures[particle.textureIndex] ?? archive?.textures[0];
    if (!texture) return fallback;
    const key = `${event?.spaId ?? "missing"}:${texture.index}`;
    const cached = textureCache.get(key);
    if (cached) return cached;
    const decoded = textureFromSpa(THREE, texture);
    textureCache.set(key, decoded);
    return decoded;
  };

  const ensureSprite = (): EffectSprite => {
    const material = new THREE.SpriteMaterial({
      map: fallback,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    root.add(sprite);
    const effect = { sprite, material };
    effects.push(effect);
    return effect;
  };

  const update = (frame: number) => {
    const particles = simulateSplPreview(preview, frame);
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      const effect = effects[index] ?? ensureSprite();
      const texture = getTexture(particle);
      effect.sprite.visible = particle.alpha > 0.01;
      effect.sprite.position.set(particle.position[0], particle.position[1], particle.position[2]);
      effect.sprite.scale.set(particle.scale * particle.aspectRatio, particle.scale, 1);
      effect.material.map = texture;
      effect.material.rotation = particle.rotation;
      effect.material.color.setRGB(particle.color[0], particle.color[1], particle.color[2]);
      effect.material.opacity = particle.alpha;
      effect.material.needsUpdate = true;
    }
    for (let index = particles.length; index < effects.length; index += 1) effects[index].sprite.visible = false;
  };

  return {
    update,
    destroy: () => {
      for (const effect of effects) {
        effect.material.dispose();
        root.remove(effect.sprite);
      }
      for (const texture of textureCache.values()) texture.dispose();
      fallback.dispose();
      circle.dispose();
    },
  };
}

function updateTimeline(host: HTMLElement, frame: number): void {
  let active: HTMLElement | undefined;
  host.querySelectorAll<HTMLElement>(".move-animation-preview-event").forEach((row) => {
    const rowFrame = Number(row.dataset.frame);
    const isActive = rowFrame <= frame;
    row.classList.toggle("-past", isActive);
    if (isActive) active = row;
  });
  active?.scrollIntoView({ block: "nearest" });
}

type BackgroundController = {
  resize: (width: number, height: number) => void;
  update: (frame: number, cameraState: BattleCameraState) => void;
  destroy: () => void;
};

function createBackgroundController(preview: MoveAnimationPreview, canvas: HTMLCanvasElement): BackgroundController {
  const context = canvas.getContext("2d");
  let width = 1;
  let height = 1;
  let lastKey = "";
  let sourceImageCache = new Map<number, ImageData>();
  const loadEvents = preview.timeline.filter((event) => event.command === "LoadBackground" && event.backgroundId !== undefined).sort((a, b) => a.frame - b.frame);
  const moveEvents = preview.timeline.filter((event) => event.command === "MoveBackground").sort((a, b) => a.frame - b.frame);
  const fadeEvents = preview.timeline.filter((event) => event.command === "ChangeBackgroundColor").sort((a, b) => a.frame - b.frame);
  const alphaEvents = preview.timeline.filter((event) => event.command === "BackgroundAlpha").sort((a, b) => a.frame - b.frame);
  const visibilityEvents = preview.timeline.filter((event) => event.command === "ApplyBackground").sort((a, b) => a.frame - b.frame);

  const draw = (frame: number, cameraState: BattleCameraState) => {
    if (!context) return;
    const state = backgroundStateAt(preview, frame, loadEvents, moveEvents, fadeEvents, alphaEvents, visibilityEvents);
    const key = `${width}:${height}:${state.backgroundId}:${state.scrollX}:${state.scrollY}:${state.opacity.toFixed(3)}:${state.tintColor.join(",")}:${state.tintAmount.toFixed(3)}:${state.overlayColor.join(",")}:${state.overlayAmount.toFixed(3)}:${state.visible}:${cameraState.backdropZoom.toFixed(3)}:${cameraState.backdropFocus.join(",")}:${cameraState.backdropOffset.join(",")}:${cameraState.shake.join(",")}`;
    if (key === lastKey) return;
    lastKey = key;
    context.clearRect(0, 0, width, height);
    drawDefaultBattleBackdrop(context, width, height, cameraState);
    if (!state.visible || state.opacity <= 0.01) {
      drawTintOverlay(context, width, height, state.tintColor, state.tintAmount);
      drawTintOverlay(context, width, height, state.overlayColor, state.overlayAmount);
      return;
    }
    const background = state.backgroundId === undefined ? undefined : preview.backgrounds.get(state.backgroundId);
    if (!background) {
      drawTintOverlay(context, width, height, state.tintColor, state.tintAmount);
      drawTintOverlay(context, width, height, state.overlayColor, state.overlayAmount);
      return;
    }
    const image = sourceImageCache.get(background.datId) ?? makeBackgroundImageData(background);
    sourceImageCache.set(background.datId, image);
    if (background.hasTransparency) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
    }
    drawTiledBackground(context, image, width, height, state.scrollX, state.scrollY, state.tintColor, state.tintAmount, state.opacity);
    drawTintOverlay(context, width, height, state.overlayColor, state.overlayAmount);
  };

  return {
    resize: (nextWidth: number, nextHeight: number) => {
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      lastKey = "";
      draw(0, simulateBattleCamera(preview.timeline, 0));
    },
    update: draw,
    destroy: () => {
      sourceImageCache = new Map();
    },
  };
}

type BackgroundState = {
  backgroundId?: number;
  controlLayer: number;
  layer: number;
  scrollX: number;
  scrollY: number;
  opacity: number;
  tintColor: [number, number, number];
  tintAmount: number;
  overlayColor: [number, number, number];
  overlayAmount: number;
  visible: boolean;
};

function backgroundStateAt(
  preview: MoveAnimationPreview,
  frame: number,
  loadEvents: MoveAnimationPreview["timeline"],
  moveEvents: MoveAnimationPreview["timeline"],
  fadeEvents: MoveAnimationPreview["timeline"],
  alphaEvents: MoveAnimationPreview["timeline"],
  visibilityEvents: MoveAnimationPreview["timeline"],
): BackgroundState {
  const load = lastEventAt(loadEvents, frame);
  const loadFrame = load?.frame ?? 0;
  const layers = resolveLoadedBackgroundLayers(loadFrame, moveEvents, fadeEvents, alphaEvents, visibilityEvents);
  const layerMoveEvents = moveEvents.filter((event) => (event.params[0] ?? 0) === layers.controlLayer);
  const screenFadeEvents = fadeEvents.filter((event) => event.frame >= (layers.showFrame ?? loadFrame));
  const overlayFadeEvents = fadeEvents.filter((event) => event.frame <= frame && layers.showFrame !== undefined && event.frame < layers.showFrame);
  const layerAlphaEvents = alphaEvents.filter((event) => (event.params[0] ?? 0) === layers.controlLayer);
  const layerVisibilityEvents = visibilityEvents.filter((event) => (event.params[0] ?? 0) === layers.visibleLayer);
  const fade = lastEventAt(screenFadeEvents, frame);
  const revealFade = layers.showFrame === undefined ? undefined : screenFadeEvents.find((event) => event.frame === layers.showFrame && (event.params[1] ?? 0) < (event.params[2] ?? 0));
  const overlayFade = lastEventAt(overlayFadeEvents, frame);
  const alpha = lastEventAt(layerAlphaEvents, frame);
  const visibility = lastEventAt(layerVisibilityEvents, frame);
  const defaultLayersRestored = hasDefaultBattleLayersRestored(visibilityEvents, frame, layers);
  const specialBackgroundRestoreFrame = resolveSpecialBackgroundRestoreFrame(preview.timeline, layers);
  const restoredToDefaultBackground = specialBackgroundRestoreFrame !== undefined && frame >= specialBackgroundRestoreFrame;
  const scroll = layerMoveEvents.reduce(
    (sum, event) => {
      if (event.frame > frame) return sum;
      const local = Math.max(0, frame - event.frame);
      const duration = Math.max(1, event.params[3] ?? 1);
      const clampedLocal = Math.min(local, duration);
      const rate = Math.min(1, clampedLocal / duration);
      const continuousScroll = event.params.length >= 6 && (event.params[5] ?? 0) === 0 && duration > 1;
      return {
        x: sum.x + Math.round((event.params[1] ?? 0) * (continuousScroll ? clampedLocal : rate)),
        y: sum.y + Math.round((event.params[2] ?? 0) * (continuousScroll ? clampedLocal : rate)),
      };
    },
    { x: 0, y: 0 },
  );
  const tint =
    fade && revealFade && layers.showFrame !== undefined && fade === revealFade
      ? preRevealPaletteFadeAt(fade, frame, layers.showFrame)
      : fade
        ? paletteFadeAt(fade, frame)
        : { color: [0, 0, 0] as [number, number, number], amount: 0 };
  const overlay =
    revealFade && layers.showFrame !== undefined && frame < layers.showFrame
      ? preRevealPaletteFadeAt(revealFade, frame, layers.showFrame)
      : overlayFade && frame < (layers.showFrame ?? Number.POSITIVE_INFINITY)
        ? paletteFadeAt(overlayFade, frame)
        : { color: [0, 0, 0] as [number, number, number], amount: 0 };
  const alphaAmount = alpha ? Math.max(0, Math.min(1, (alpha.params[2] ?? 31) / 31)) : 1;
  return {
    backgroundId: load?.backgroundId,
    controlLayer: layers.controlLayer,
    layer: layers.visibleLayer,
    scrollX: scroll.x,
    scrollY: scroll.y,
    opacity: alphaAmount,
    tintColor: tint.color,
    tintAmount: tint.amount,
    overlayColor: overlay.color,
    overlayAmount: overlay.amount,
    visible: !defaultLayersRestored && !restoredToDefaultBackground && (visibility ? (visibility.params[1] ?? 0) === 0 : layers.showFrame === undefined),
  };
}

function resolveSpecialBackgroundRestoreFrame(
  timeline: MoveAnimationPreview["timeline"],
  layers: { showFrame?: number; visibleLayer: number },
): number | undefined {
  if (layers.visibleLayer <= 1 || layers.showFrame === undefined) return undefined;
  const cameraRestore = timeline.find((event) => event.frame > (layers.showFrame ?? 0) && event.command === "MoveCamera" && (event.params[1] ?? 0) === 8);
  if (cameraRestore) return cameraRestore.frame;
  const darkenAfterReveal = timeline.find(
    (event) => event.frame > (layers.showFrame ?? 0) && event.command === "ChangeBackgroundColor" && (event.params[1] ?? 0) > 0 && (event.params[2] ?? 0) > (event.params[1] ?? 0),
  );
  return darkenAfterReveal?.frame;
}

function hasDefaultBattleLayersRestored(
  visibilityEvents: MoveAnimationPreview["timeline"],
  frame: number,
  layers: { showFrame?: number; visibleLayer: number },
): boolean {
  if (layers.visibleLayer <= 1 || layers.showFrame === undefined) return false;
  return [0, 1].every((layer) => {
    const event = lastEventAt(
      visibilityEvents.filter((visibilityEvent) => (visibilityEvent.params[0] ?? 0) === layer),
      frame,
    );
    return event !== undefined && event.frame > (layers.showFrame ?? 0) && (event.params[1] ?? 0) === 0;
  });
}

function resolveLoadedBackgroundLayers(
  loadFrame: number,
  moveEvents: MoveAnimationPreview["timeline"],
  fadeEvents: MoveAnimationPreview["timeline"],
  alphaEvents: MoveAnimationPreview["timeline"],
  visibilityEvents: MoveAnimationPreview["timeline"],
): { controlLayer: number; showFrame?: number; visibleLayer: number } {
  const show = visibilityEvents.find((event) => event.frame >= loadFrame && (event.params[1] ?? 0) === 0);
  const command = [...moveEvents, ...fadeEvents, ...alphaEvents].filter((event) => event.frame >= loadFrame).sort((a, b) => a.frame - b.frame)[0];
  const visibleLayer = show?.params[0] ?? command?.params[0] ?? 0;
  return {
    controlLayer: command?.params[0] ?? visibleLayer,
    showFrame: show?.frame,
    visibleLayer,
  };
}

function lastEventAt(events: MoveAnimationPreview["timeline"], frame: number): MoveAnimationPreview["timeline"][number] | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].frame <= frame) return events[index];
  }
  return undefined;
}

function paletteFadeAt(event: MoveAnimationPreview["timeline"][number], frame: number): { color: [number, number, number]; amount: number } {
  const start = event.params[1] ?? 0;
  const end = event.params[2] ?? 0;
  const duration = Math.max(1, event.params[3] ?? 0, Math.abs(end - start));
  const rate = Math.min(1, Math.max(0, (frame - event.frame) / duration));
  const evy = start + (end - start) * rate;
  return { color: commandRgbToRgb(event.params), amount: Math.max(0, Math.min(1, evy / 16)) };
}

function preRevealPaletteFadeAt(event: MoveAnimationPreview["timeline"][number], frame: number, revealFrame: number): { color: [number, number, number]; amount: number } {
  const start = event.params[1] ?? 0;
  const end = event.params[2] ?? 0;
  const duration = Math.max(1, event.params[3] ?? 0, Math.abs(end - start));
  const rate = Math.min(1, Math.max(0, (frame - (revealFrame - duration)) / duration));
  const evy = start + (end - start) * rate;
  return { color: commandRgbToRgb(event.params), amount: Math.max(0, Math.min(1, evy / 16)) };
}

function commandRgbToRgb(params: number[]): [number, number, number] {
  if (params.length >= 7) return [rgb5To8(params[4] ?? 0), rgb5To8(params[5] ?? 0), rgb5To8(params[6] ?? 0)];
  return rgb555ToRgb(params[4] ?? 0);
}

function rgb555ToRgb(value: number): [number, number, number] {
  const r = value & 0x1f;
  const g = (value >>> 5) & 0x1f;
  const b = (value >>> 10) & 0x1f;
  return [rgb5To8(r), rgb5To8(g), rgb5To8(b)];
}

function rgb5To8(value: number): number {
  const clamped = Math.max(0, Math.min(31, Math.round(value)));
  return (clamped << 3) | (clamped >>> 2);
}

function makeBackgroundImageData(background: NonNullable<MoveAnimationPreview["backgrounds"] extends Map<number, infer T> ? T : never>): ImageData {
  const data = new Uint8ClampedArray(new ArrayBuffer(background.rgba.length));
  data.set(background.rgba);
  return new ImageData(data, background.width, background.height);
}

function drawDefaultBattleBackdrop(context: CanvasRenderingContext2D, width: number, height: number, cameraState: BattleCameraState): void {
  context.save();
  const focusX = width * cameraState.backdropFocus[0];
  const focusY = height * cameraState.backdropFocus[1];
  context.translate(width / 2 + cameraState.backdropOffset[0] * width + cameraState.shake[0] * width, height / 2 + cameraState.backdropOffset[1] * height + cameraState.shake[1] * height);
  context.scale(cameraState.backdropZoom, cameraState.backdropZoom);
  context.translate(-focusX, -focusY);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#5f88e6");
  sky.addColorStop(0.38, "#bbc8e8");
  sky.addColorStop(0.56, "#8aa16d");
  sky.addColorStop(1, "#2d6251");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  drawBattlePlatform(context, width * 0.67, height * 0.49, width * 0.29, height * 0.11, "#276e5a", "#18493c");
  drawBattlePlatform(context, width * 0.18, height * 0.86, width * 0.44, height * 0.15, "#1f6c61", "#164940");
  context.restore();
}

function drawBattlePlatform(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  fill: string,
  shadow: string,
): void {
  context.fillStyle = shadow;
  context.beginPath();
  context.ellipse(x, y + radiusY * 0.28, radiusX * 1.04, radiusY * 1.08, 0, 0, Math.PI * 2);
  context.fill();
  const platform = context.createRadialGradient(x, y, radiusY * 0.2, x, y, radiusX);
  platform.addColorStop(0, "rgba(98, 190, 165, 0.7)");
  platform.addColorStop(0.54, fill);
  platform.addColorStop(1, "rgba(18, 65, 54, 0.95)");
  context.fillStyle = platform;
  context.beginPath();
  context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fill();
}

function drawTiledBackground(
  context: CanvasRenderingContext2D,
  image: ImageData,
  width: number,
  height: number,
  scrollX: number,
  scrollY: number,
  tintColor: [number, number, number],
  tintAmount: number,
  opacity: number,
): void {
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  source.getContext("2d")?.putImageData(processEffectBackgroundImageData(image, tintColor, tintAmount, opacity), 0, 0);
  const viewportWidth = Math.min(256, image.width);
  const viewportHeight = Math.min(192, image.height);
  const sx = mod(scrollX, Math.max(1, image.width));
  const sy = mod(scrollY, Math.max(1, image.height));
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawTiledBackgroundPass(context, source, width, height, viewportWidth, viewportHeight, sx, sy);
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.65;
  context.filter = "blur(2.4px) brightness(1.45)";
  drawTiledBackgroundPass(context, source, width, height, viewportWidth, viewportHeight, sx, sy);
  context.restore();
}

function drawTiledBackgroundPass(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  sx: number,
  sy: number,
): void {
  for (let drawnY = 0; drawnY < viewportHeight; ) {
    const sourceY = (sy + drawnY) % source.height;
    const sourceHeight = Math.min(source.height - sourceY, viewportHeight - drawnY);
    for (let drawnX = 0; drawnX < viewportWidth; ) {
      const sourceX = (sx + drawnX) % source.width;
      const sourceWidth = Math.min(source.width - sourceX, viewportWidth - drawnX);
      const dx = (drawnX / viewportWidth) * width;
      const dy = (drawnY / viewportHeight) * height;
      const dw = (sourceWidth / viewportWidth) * width;
      const dh = (sourceHeight / viewportHeight) * height;
      context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, dx, dy, dw, dh);
      drawnX += sourceWidth;
    }
    drawnY += sourceHeight;
  }
}

function tintImageData(image: ImageData, tintColor: [number, number, number], tintAmount: number, opacity: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  for (let offset = 0; offset < out.data.length; offset += 4) {
    const alpha = out.data[offset + 3] / 255;
    if (alpha <= 0) continue;
    out.data[offset] = out.data[offset] + (tintColor[0] - out.data[offset]) * tintAmount;
    out.data[offset + 1] = out.data[offset + 1] + (tintColor[1] - out.data[offset + 1]) * tintAmount;
    out.data[offset + 2] = out.data[offset + 2] + (tintColor[2] - out.data[offset + 2]) * tintAmount;
    out.data[offset + 3] = Math.round(out.data[offset + 3] * opacity);
  }
  return out;
}

function processEffectBackgroundImageData(image: ImageData, tintColor: [number, number, number], tintAmount: number, opacity: number): ImageData {
  const out = tintImageData(image, tintColor, tintAmount, opacity);
  for (let offset = 0; offset < out.data.length; offset += 4) {
    const r = out.data[offset];
    const g = out.data[offset + 1];
    const b = out.data[offset + 2];
    const alpha = out.data[offset + 3] / 255;
    if (alpha <= 0) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const cyanBias = g > r + 18 && b > r + 18;
    const highlight = Math.max(0, Math.min(1, (max - 92) / 150));
    const whiteMix = Math.max(cyanBias ? 0.18 : 0, highlight * 0.72);
    const glowBoost = 1 + highlight * 0.55;
    const nr = Math.min(255, r * glowBoost + (255 - r) * whiteMix);
    const ng = Math.min(255, g * glowBoost + (255 - g) * whiteMix);
    const nb = Math.min(255, b * glowBoost + (255 - b) * whiteMix);
    const softContrast = min < 12 && max < 48 ? 0.72 : 1;
    out.data[offset] = Math.round(nr * softContrast);
    out.data[offset + 1] = Math.round(ng * softContrast);
    out.data[offset + 2] = Math.round(nb * softContrast);
  }
  return out;
}

function drawTintOverlay(context: CanvasRenderingContext2D, width: number, height: number, color: [number, number, number], amount: number): void {
  if (amount <= 0) return;
  context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${amount})`;
  context.fillRect(0, 0, width, height);
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function textureFromSpa(THREE: ThreeModule, texture: SpaTexture): import("three").CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(texture.width, texture.height);
    image.data.set(texture.rgba);
    context.putImageData(image, 0, 0);
  }
  const canvasTexture = new THREE.CanvasTexture(canvas);
  canvasTexture.needsUpdate = true;
  return canvasTexture;
}

function labelTexture(THREE: ThreeModule, label: string, color: number): import("three").CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#111827";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.lineWidth = 8;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.fillStyle = "#f8fafc";
    context.font = "bold 34px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2);
  }
  return new THREE.CanvasTexture(canvas);
}

function fallbackTexture(THREE: ThreeModule): import("three").CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#ff00ff";
    context.fillRect(0, 0, 16, 16);
    context.fillRect(16, 16, 16, 16);
    context.fillStyle = "#111827";
    context.fillRect(16, 0, 16, 16);
    context.fillRect(0, 16, 16, 16);
  }
  return new THREE.CanvasTexture(canvas);
}

function circleTexture(THREE: ThreeModule): import("three").CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.62, "rgba(255,255,255,0.92)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(16, 16, 15, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
