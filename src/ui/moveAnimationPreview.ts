import { simulateBattleCamera, type BattleCameraState } from "../pokeweb/battleCameraSimulator";
import { TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "../pokeweb/battlePreviewAnchors";
import type { MoveAnimationPreview } from "../pokeweb/moveAnimationPreviewModel";
import { renderNitroBackgroundImage, type NitroBackgroundPaletteAnimation, type NitroPaletteData } from "../pokeweb/nitroBg";
import { nitroCellEffectFrameAt, type NitroCellEffectFrame } from "../pokeweb/nitroCell";
import type { SpaTexture } from "../pokeweb/nitroSpa";
import { simulateSplPreview, type SplFrameParticle } from "../pokeweb/splEmitterSimulator";
import { escapeHtml } from "./dom";

type ThreeModule = typeof import("three");

export type MoveAnimationPreviewController = {
  destroy: () => void;
};

type MoveAnimationPreviewOptions = {
  initialPlaying?: boolean;
};

export async function installMoveAnimationPreview(
  host: HTMLElement,
  preview: MoveAnimationPreview,
  options: MoveAnimationPreviewOptions = {},
): Promise<MoveAnimationPreviewController> {
  const THREE = await import("three");
  const rendererHost = document.createElement("div");
  rendererHost.className = "move-animation-preview-stage";
  const backgroundCanvas = document.createElement("canvas");
  backgroundCanvas.className = "move-animation-preview-bg";
  const initialPlaying = options.initialPlaying ?? true;
  host.innerHTML = renderPreviewShell(preview, initialPlaying);
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
  const stage = makeStage(THREE);
  scene.add(stage.group);

  const effectRoot = new THREE.Group();
  scene.add(effectRoot);
  const effects = createEffects(THREE, preview, effectRoot, camera, stage.actors);
  const background = createBackgroundController(preview, backgroundCanvas);

  let frame = 0;
  let speed = 1;
  let playing = initialPlaying;
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
    effects.update(frame);
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

function renderPreviewShell(preview: MoveAnimationPreview, initialPlaying: boolean): string {
  return `
    <div class="move-animation-preview">
      <div class="move-animation-preview-controls">
        <button class="script-btn move-preview-play" type="button">${initialPlaying ? "Pause" : "Play"}</button>
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

type StageActor = {
  sprite: import("three").Sprite;
  base: [number, number, number];
  baseScale: [number, number, number];
};

type StageActors = {
  user: StageActor;
  target: StageActor;
};

function makeStage(THREE: ThreeModule): { group: import("three").Group; actors: StageActors } {
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
  const user = makeActor(THREE, "USER", USER_BATTLE_ANCHOR[0], USER_BATTLE_ANCHOR[2], 1.12, 0x6fc9ff);
  const target = makeActor(THREE, "TARGET", TARGET_BATTLE_ANCHOR[0], TARGET_BATTLE_ANCHOR[2], 0.92, 0xff9f65);
  group.add(user, target);
  return {
    group,
    actors: {
      user: { sprite: user, base: [user.position.x, user.position.y, user.position.z], baseScale: [user.scale.x, user.scale.y, user.scale.z] },
      target: { sprite: target, base: [target.position.x, target.position.y, target.position.z], baseScale: [target.scale.x, target.scale.y, target.scale.z] },
    },
  };
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
  camera.updateMatrixWorld();
}

type EffectRenderer = {
  update: (frame: number) => void;
  destroy: () => void;
};

type EffectSprite = {
  mesh: import("three").Mesh;
  material: import("three").MeshBasicMaterial;
};

type CapSprite = {
  sprite: import("three").Sprite;
  material: import("three").SpriteMaterial;
};

function createEffects(
  THREE: ThreeModule,
  preview: MoveAnimationPreview,
  root: import("three").Group,
  camera: import("three").PerspectiveCamera,
  actors: StageActors,
): EffectRenderer {
  const effects: EffectSprite[] = [];
  const cellSprites: EffectSprite[] = [];
  const capSprites: CapSprite[] = [];
  const textureCache = new Map<string, import("three").CanvasTexture>();
  const cellTextureCache = new Map<string, import("three").DataTexture>();
  const capTextureCache = new Map<"user" | "target", import("three").CanvasTexture>();
  const fallback = fallbackTexture(THREE);
  const circle = circleTexture(THREE);
  const geometry = new THREE.PlaneGeometry(1, 1);

  const getTexture = (particle: SplFrameParticle): import("three").CanvasTexture => {
    if (particle.textureKind === "circle") return circle;
    const event = preview.timeline.find((timelineEvent) => timelineEvent.id === particle.eventId);
    const archive = event?.spaId === undefined ? undefined : preview.spaArchives.get(event.spaId);
    const texture = archive?.textures[particle.textureIndex] ?? archive?.textures[0];
    if (!texture) return fallback;
    const mapping = spaTextureMapping(particle);
    const key = `${event?.spaId ?? "missing"}:${texture.index}:${mapping.repeatS}:${mapping.repeatT}:${mapping.flipS ? 1 : 0}:${mapping.flipT ? 1 : 0}`;
    const cached = textureCache.get(key);
    if (cached) return cached;
    const decoded = textureFromSpa(THREE, texture, mapping);
    textureCache.set(key, decoded);
    return decoded;
  };

  const ensureSprite = (): EffectSprite => {
    const material = new THREE.MeshBasicMaterial({
      map: fallback,
      transparent: true,
      depthWrite: false,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    const effect = { mesh, material };
    effects.push(effect);
    return effect;
  };

  const update = (frame: number) => {
    updateActors(preview, actors, frame);
    const particles = simulateSplPreview(preview, frame);
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      const effect = effects[index] ?? ensureSprite();
      const texture = getTexture(particle);
      effect.mesh.visible = particle.alpha > 0.01;
      effect.mesh.renderOrder = index * 10 + particle.renderLayer;
      applyParticleTransform(THREE, effect.mesh, particle, camera);
      effect.material.map = texture;
      effect.material.color.setRGB(particle.color[0], particle.color[1], particle.color[2]);
      effect.material.opacity = particle.alpha;
      effect.material.needsUpdate = true;
    }
    for (let index = particles.length; index < effects.length; index += 1) effects[index].mesh.visible = false;
    const cells = visibleCellEffects(preview, frame);
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const effect = cellSprites[index] ?? ensureCellSprite();
      const texture = getCellTexture(cell.effect.id, cell.sequenceIndex, cell.frame);
      effect.mesh.visible = cell.opacity > 0.01;
      effect.mesh.renderOrder = 50000 + index;
      effect.mesh.position.set(cell.position[0], cell.position[1], cell.position[2]);
      effect.mesh.quaternion.copy(camera.quaternion);
      effect.mesh.rotateZ(cell.rotation);
      effect.mesh.scale.set(cell.frame.width * cell.scale[0] * 0.18, cell.frame.height * cell.scale[1] * 0.18, 1);
      effect.material.map = texture;
      effect.material.color.setRGB(1, 1, 1);
      effect.material.opacity = cell.opacity;
      effect.material.needsUpdate = true;
    }
    for (let index = cells.length; index < cellSprites.length; index += 1) cellSprites[index].mesh.visible = false;
    const caps = visibleCapEffects(preview, frame);
    for (let index = 0; index < caps.length; index += 1) {
      const cap = caps[index];
      const sprite = capSprites[index] ?? ensureCapSprite();
      const source = actors[cap.source];
      sprite.material.map = getCapTexture(cap.source);
      sprite.sprite.position.set(source.base[0], source.base[1], source.base[2] + 0.35 + index * 0.02);
      const mosaicScale = 1 + Math.max(0, cap.state.mosaic) * 0.015;
      sprite.sprite.scale.set(
        source.baseScale[0] * cap.state.scaleX * mosaicScale,
        source.baseScale[1] * cap.state.scaleY * mosaicScale,
        source.baseScale[2],
      );
      sprite.material.opacity = cap.state.alpha;
      sprite.material.color.setRGB(
        1 + (cap.state.tint[0] - 1) * cap.state.tint[3],
        1 + (cap.state.tint[1] - 1) * cap.state.tint[3],
        1 + (cap.state.tint[2] - 1) * cap.state.tint[3],
      );
      sprite.sprite.visible = cap.state.visible && cap.state.alpha > 0.01;
    }
    for (let index = caps.length; index < capSprites.length; index += 1) capSprites[index].sprite.visible = false;
  };

  const ensureCellSprite = (): EffectSprite => {
    const material = new THREE.MeshBasicMaterial({
      map: fallback,
      transparent: true,
      depthWrite: false,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    root.add(mesh);
    const effect = { mesh, material };
    cellSprites.push(effect);
    return effect;
  };

  const getCellTexture = (effectId: string, sequenceIndex: number, frame: NitroCellEffectFrame): import("three").DataTexture => {
    const key = `${effectId}:${sequenceIndex}:${frame.index}:${frame.cellIndex}`;
    const cached = cellTextureCache.get(key);
    if (cached) return cached;
    const texture = new THREE.DataTexture(frame.rgba, frame.width, frame.height);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.needsUpdate = true;
    cellTextureCache.set(key, texture);
    return texture;
  };

  const ensureCapSprite = (): CapSprite => {
    const material = new THREE.SpriteMaterial({ map: fallback, transparent: true, opacity: 1, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 40000 + capSprites.length;
    root.add(sprite);
    const cap = { sprite, material };
    capSprites.push(cap);
    return cap;
  };

  const getCapTexture = (source: "user" | "target"): import("three").CanvasTexture => {
    const cached = capTextureCache.get(source);
    if (cached) return cached;
    const texture = labelTexture(THREE, source === "user" ? "USER" : "TARGET", source === "user" ? 0x6fc9ff : 0xff9f65);
    capTextureCache.set(source, texture);
    return texture;
  };

  return {
    update,
    destroy: () => {
      for (const effect of effects) {
        effect.material.dispose();
        root.remove(effect.mesh);
      }
      for (const texture of textureCache.values()) texture.dispose();
      for (const effect of cellSprites) {
        effect.material.dispose();
        root.remove(effect.mesh);
      }
      for (const texture of cellTextureCache.values()) texture.dispose();
      for (const cap of capSprites) {
        cap.material.dispose();
        root.remove(cap.sprite);
      }
      for (const texture of capTextureCache.values()) texture.dispose();
      fallback.dispose();
      circle.dispose();
      geometry.dispose();
    },
  };
}

function updateActors(preview: MoveAnimationPreview, actors: StageActors, frame: number): void {
  for (const target of ["user", "target"] as const) {
    const actor = actors[target];
    const offset = actorMotionOffset(preview, target, frame);
    const visual = actorVisualState(preview, target, frame);
    actor.sprite.position.set(actor.base[0] + offset[0], actor.base[1] + offset[1], actor.base[2] + offset[2]);
    actor.sprite.scale.set(actor.baseScale[0] * visual.scale[0], actor.baseScale[1] * visual.scale[1], actor.baseScale[2]);
    actor.sprite.material.rotation = visual.rotation;
    actor.sprite.material.opacity = visual.opacity;
    actor.sprite.material.color.setRGB(
      1 + (visual.tint[0] - 1) * visual.tint[3],
      1 + (visual.tint[1] - 1) * visual.tint[3],
      1 + (visual.tint[2] - 1) * visual.tint[3],
    );
    actor.sprite.visible = visual.visible && visual.opacity > 0.01;
  }
}

function actorMotionOffset(preview: MoveAnimationPreview, target: "user" | "target", frame: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const event of preview.timeline) {
    const motion = event.actorMotion;
    if (!motion || motion.target !== target || frame < event.frame) continue;
    const localFrame = frame - event.frame;
    const t = Math.min(1, Math.max(0, localFrame / Math.max(1, motion.duration)));
    const eased = motion.easing === "easeOut" ? 1 - (1 - t) ** 3 : t;
    out[0] += motion.offset[0] * eased;
    out[1] += motion.offset[1] * eased;
    out[2] += motion.offset[2] * eased;
  }
  return out;
}

function actorVisualState(
  preview: MoveAnimationPreview,
  target: "user" | "target",
  frame: number,
): { visible: boolean; opacity: number; tint: [number, number, number, number]; scale: [number, number]; rotation: number } {
  const out = {
    visible: true,
    opacity: 1,
    tint: [1, 1, 1, 0] as [number, number, number, number],
    scale: [1, 1] as [number, number],
    rotation: 0,
  };
  for (const event of preview.timeline) {
    const visual = event.actorVisual;
    if (!visual || visual.target !== target || frame < event.frame) continue;
    const duration = Math.max(1, visual.duration ?? 1);
    const localFrame = frame - event.frame;
    if (!visual.persist && localFrame > duration) continue;
    if (visual.visible !== undefined) out.visible = visual.visible;
    if (visual.opacity !== undefined) out.opacity *= Math.max(0, Math.min(1, visual.opacity));
    if (visual.tint) out.tint = visual.tint;
    if (visual.scale) {
      out.scale[0] *= visual.scale[0];
      out.scale[1] *= visual.scale[1];
    }
    if (visual.rotation !== undefined) out.rotation += visual.rotation;
  }
  return out;
}

function applyParticleTransform(THREE: ThreeModule, mesh: import("three").Mesh, particle: SplFrameParticle, camera: import("three").PerspectiveCamera): void {
  const position = new THREE.Vector3(particle.position[0], particle.position[1], particle.position[2]);
  const localOffsetX = particle.polygonOffsetX + (0.5 - particle.anchorX);
  const localOffsetY = particle.polygonOffsetY + (0.5 - particle.anchorY) + particle.anchorOffsetY;
  const offset = new THREE.Matrix4().makeTranslation(localOffsetX, localOffsetY, 0);
  const scale = new THREE.Matrix4().makeScale(particle.scaleX, particle.scaleY * particle.tiltScale, 1);
  const translation = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z);
  const orientation = particleOrientationMatrix(THREE, particle, camera, position);
  mesh.matrix.identity().multiply(translation).multiply(orientation).multiply(scale).multiply(offset);
  mesh.matrixWorldNeedsUpdate = true;
}

function visibleCellEffects(preview: MoveAnimationPreview, frame: number): Array<{
  effect: NonNullable<MoveAnimationPreview["cellEffects"]> extends Map<string, infer T> ? T : never;
  frame: NitroCellEffectFrame;
  position: [number, number, number];
  scale: [number, number];
  opacity: number;
  sequenceIndex: number;
  rotation: number;
}> {
  const out: Array<{
    effect: NonNullable<MoveAnimationPreview["cellEffects"]> extends Map<string, infer T> ? T : never;
    frame: NitroCellEffectFrame;
    position: [number, number, number];
    scale: [number, number];
    opacity: number;
    sequenceIndex: number;
    rotation: number;
  }> = [];
  const targetFrame = Math.max(0, Math.round(frame));
  for (const event of preview.timeline) {
    if (event.effectKind !== "cell" || !event.cellEffectId || !event.cellEffect) continue;
    const localFrame = targetFrame - event.frame;
    const duration = Math.max(1, event.cellEffect.duration ?? 45);
    if (localFrame < 0 || localFrame > duration) continue;
    const effect = preview.cellEffects?.get(event.cellEffectId);
    if (!effect) continue;
    if (event.cellEffect.catsActors?.length) {
      for (const actor of event.cellEffect.catsActors) {
        const state = actor.states[Math.min(actor.states.length - 1, localFrame)] ?? actor.states[actor.states.length - 1];
        if (!state?.visible || state.alpha <= 0) continue;
        const frameEntry = effect.sequences[state.sequenceIndex]?.frames[state.sequenceFrame] ?? nitroCellEffectFrameAt(effect, state.sequenceFrame, state.sequenceIndex);
        if (!frameEntry) continue;
        out.push({
          effect,
          frame: frameEntry,
          position: catsScreenToWorld(state.x + frameEntry.x, state.y + frameEntry.y),
          scale: [
            (state.flipX ? -1 : 1) * state.scaleX * frameEntry.xScale,
            (state.flipY ? -1 : 1) * state.scaleY * frameEntry.yScale,
          ],
          opacity: Math.max(0, Math.min(1, state.alpha)),
          sequenceIndex: state.sequenceIndex,
          rotation: ((state.rotation + frameEntry.rotation) * Math.PI) / 180,
        });
      }
      continue;
    }
    const sequence = cellEffectSequence(event, localFrame);
    const frameEntry = nitroCellEffectFrameAt(effect, sequence.frame, sequence.index);
    if (!frameEntry) continue;
    const basePosition = addVec3(cellEffectPosition(event, localFrame), cellFrameWorldOffset(frameEntry));
    const instances = event.cellEffect.instances?.length ? event.cellEffect.instances : [{ offset: [0, 0, 0] as [number, number, number] }];
    for (const instance of instances) {
      const opacity = cellEffectOpacity(event, localFrame, duration, instance);
      if (opacity <= 0) continue;
      out.push({
        effect,
        frame: frameEntry,
        position: [basePosition[0] + instance.offset[0], basePosition[1] + instance.offset[1], basePosition[2] + instance.offset[2]],
        scale: [(event.cellEffect.scale ?? 1) * frameEntry.xScale, (event.cellEffect.scale ?? 1) * frameEntry.yScale],
        opacity,
        sequenceIndex: sequence.index,
        rotation: cellEffectRotation(event, localFrame) + (frameEntry.rotation * Math.PI) / 180,
      });
    }
  }
  return out;
}

function visibleCapEffects(preview: MoveAnimationPreview, frame: number): Array<{
  source: "user" | "target";
  state: NonNullable<NonNullable<MoveAnimationPreview["timeline"][number]["capEffect"]>["states"]>[number];
}> {
  const out: Array<{
    source: "user" | "target";
    state: NonNullable<NonNullable<MoveAnimationPreview["timeline"][number]["capEffect"]>["states"]>[number];
  }> = [];
  const targetFrame = Math.max(0, Math.round(frame));
  for (const event of preview.timeline) {
    if (event.effectKind !== "cap" || !event.capEffect?.states?.length) continue;
    const localFrame = targetFrame - event.frame;
    const duration = Math.max(1, event.capEffect.duration ?? event.capEffect.states.length - 1);
    if (localFrame < 0 || localFrame > duration) continue;
    const state = event.capEffect.states[Math.min(event.capEffect.states.length - 1, localFrame)];
    if (!state?.visible || state.alpha <= 0.01) continue;
    out.push({ source: event.capEffect.source, state });
  }
  return out;
}

function catsScreenToWorld(x: number, y: number): [number, number, number] {
  const sx = (x - 63) / (192 - 63);
  const sy = (y - 64) / (124 - 64);
  return [
    mix(USER_BATTLE_ANCHOR[0], TARGET_BATTLE_ANCHOR[0], sx),
    mix(TARGET_BATTLE_ANCHOR[1], USER_BATTLE_ANCHOR[1], sy),
    mix(TARGET_BATTLE_ANCHOR[2], USER_BATTLE_ANCHOR[2], sy),
  ];
}

function cellFrameWorldOffset(frame: NitroCellEffectFrame): [number, number, number] {
  return [frame.x * 0.18, -frame.y * 0.18, 0];
}

function addVec3(left: readonly [number, number, number], right: readonly [number, number, number]): [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function cellEffectPosition(event: MoveAnimationPreview["timeline"][number], localFrame: number): [number, number, number] {
  const origin = event.cellEffect?.origin ?? [TARGET_BATTLE_ANCHOR[0], TARGET_BATTLE_ANCHOR[1] + 4.5, TARGET_BATTLE_ANCHOR[2] + 1];
  const motion = event.cellEffect?.motion;
  if (motion?.legs.length) return cellEffectMotionPosition(motion.legs, localFrame, origin);
  if (event.cellEffect?.supportFuncId === 9) return lockOnCellEffectPosition(origin, localFrame);
  if (event.cellEffect?.supportFuncId !== 7) return origin;
  const rate = Math.min(1, Math.max(0, localFrame / 32));
  return [origin[0], origin[1] - rate * 1.8, origin[2]];
}

function cellEffectRotation(event: MoveAnimationPreview["timeline"][number], localFrame: number): number {
  const motion = event.cellEffect?.motion;
  if (!motion?.faceMotion) return 0;
  const position = cellEffectPosition(event, localFrame);
  const next = cellEffectPosition(event, localFrame + 1);
  const dx = next[0] - position[0];
  const dy = next[1] - position[1];
  if (Math.hypot(dx, dy) < 0.00001) return 0;
  return Math.atan2(dy, dx) - Math.PI / 2 + (motion.rotationOffset ?? 0);
}

function cellEffectSequence(event: MoveAnimationPreview["timeline"][number], localFrame: number): { index: number; frame: number } {
  if (event.cellEffect?.supportFuncId === 9 && localFrame >= 50) return { index: 1, frame: localFrame - 50 };
  return { index: 0, frame: localFrame };
}

function lockOnCellEffectPosition(origin: [number, number, number], localFrame: number): [number, number, number] {
  const pixelScale = 0.18;
  const halfWidth = 40 * pixelScale;
  const initialWait = 18;
  const legDuration = 4;
  const points: Array<[number, number, number]> = [
    [origin[0] - halfWidth, origin[1] + halfWidth, origin[2]],
    [origin[0] + halfWidth, origin[1] - halfWidth, origin[2]],
    [origin[0] + halfWidth, origin[1] + halfWidth, origin[2]],
    [origin[0] - halfWidth, origin[1] - halfWidth, origin[2]],
    origin,
  ];
  if (localFrame < initialWait) return points[0];
  const cursor = localFrame - initialWait;
  const legIndex = Math.floor(cursor / legDuration);
  if (legIndex < 0 || legIndex >= points.length - 1) return origin;
  const t = Math.min(1, Math.max(0, (cursor % legDuration) / legDuration));
  const from = points[legIndex];
  const to = points[legIndex + 1];
  return [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)];
}

function cellEffectMotionPosition(
  legs: NonNullable<NonNullable<MoveAnimationPreview["timeline"][number]["cellEffect"]>["motion"]>["legs"],
  localFrame: number,
  fallback: [number, number, number],
): [number, number, number] {
  let cursor = Math.max(0, localFrame);
  for (const leg of legs) {
    const duration = Math.max(1, leg.duration);
    if (cursor <= duration) {
      const t = Math.min(1, Math.max(0, cursor / duration));
      const yArc = Math.sin(t * Math.PI) * (leg.arcHeight ?? 0);
      return [
        mix(leg.from[0], leg.to[0], t),
        mix(leg.from[1], leg.to[1], t) + yArc,
        mix(leg.from[2], leg.to[2], t),
      ];
    }
    cursor -= duration;
  }
  return legs[legs.length - 1]?.to ?? fallback;
}

function cellEffectOpacity(
  event: MoveAnimationPreview["timeline"][number],
  localFrame: number,
  duration: number,
  instance?: NonNullable<NonNullable<MoveAnimationPreview["timeline"][number]["cellEffect"]>["instances"]>[number],
): number {
  if (event.cellEffect?.supportFuncId === 1) {
    const startFrame = instance?.startFrame ?? 0;
    if (localFrame < startFrame) return 0;
    if (localFrame < 45 && instance?.blinkInterval) return Math.floor((localFrame - startFrame) / instance.blinkInterval) % 2 === 0 ? 1 : 0;
    if (localFrame <= 100) return 1;
    return Math.max(0, 1 - (localFrame - 100) / Math.max(1, duration - 100));
  }
  if (event.cellEffect?.supportFuncId === 7) {
    if (localFrame <= 32) return 1;
    return Math.max(0, 1 - (localFrame - 32) / Math.max(1, duration - 32));
  }
  if (event.cellEffect?.supportFuncId === 9) {
    if (localFrame < 74) return 1;
    return Math.floor((localFrame - 74) / 4) % 2 === 0 ? 1 : 0;
  }
  return localFrame <= duration ? 1 : 0;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function particleOrientationMatrix(
  THREE: ThreeModule,
  particle: SplFrameParticle,
  camera: import("three").PerspectiveCamera,
  position: import("three").Vector3,
): import("three").Matrix4 {
  switch (particle.drawType) {
    case 1:
      return directionalBillboardMatrix(THREE, particle, camera);
    case 2:
      return polygonMatrix(THREE, particle);
    case 3:
    case 4:
      return directionalPolygonMatrix(THREE, particle, camera);
    case 0:
    default:
      return billboardMatrix(THREE, particle, camera, position);
  }
}

function billboardMatrix(
  THREE: ThreeModule,
  particle: SplFrameParticle,
  camera: import("three").PerspectiveCamera,
  position: import("three").Vector3,
): import("three").Matrix4 {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const viewAxis = camera.position.clone().sub(position).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, viewAxis);
  return basis.multiply(new THREE.Matrix4().makeRotationZ(billboardRotation(THREE, particle, right, up)));
}

function billboardRotation(
  THREE: ThreeModule,
  particle: SplFrameParticle,
  right: import("three").Vector3,
  up: import("three").Vector3,
): number {
  if (!particle.alignToMotion || (particle.dspreScreenRotation && particle.sourceDrawType === 0)) return particle.rotation;
  const velocity = vectorFromTuple(THREE, particle.velocity);
  const x = velocity.dot(right);
  const y = velocity.dot(up);
  if (Math.hypot(x, y) < 0.00001) return particle.rotation;
  return Math.atan2(y, x) + (particle.alignRotationOffset ?? 0) + (particle.authoredRotation ?? 0);
}

function directionalBillboardMatrix(THREE: ThreeModule, particle: SplFrameParticle, camera: import("three").PerspectiveCamera): import("three").Matrix4 {
  const velocity = vectorFromTuple(THREE, particle.velocity);
  if (velocity.lengthSq() < 0.00001) return billboardMatrix(THREE, particle, camera, vectorFromTuple(THREE, particle.position));
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward).normalize();
  const xAxis = new THREE.Vector3().crossVectors(velocity, forward);
  if (xAxis.lengthSq() < 0.00001) return billboardMatrix(THREE, particle, camera, vectorFromTuple(THREE, particle.position));
  xAxis.normalize();
  const yAxis = new THREE.Vector3().crossVectors(forward, xAxis).normalize();
  const velocityDir = velocity.clone().normalize();
  const dot = Math.abs(velocityDir.dot(forward.clone().multiplyScalar(-1)));
  const yScale = 1 + (1 - dot) * particle.directionalBillboardScale;
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis.multiplyScalar(yScale), forward);
  return basis.multiply(new THREE.Matrix4().makeRotationZ(particle.authoredRotation ?? 0));
}

function polygonMatrix(THREE: ThreeModule, particle: SplFrameParticle): import("three").Matrix4 {
  const rotation = polygonRotationMatrix(THREE, particle);
  if (particle.polygonReferencePlane === 1) rotation.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return rotation;
}

function directionalPolygonMatrix(THREE: ThreeModule, particle: SplFrameParticle, camera: import("three").PerspectiveCamera): import("three").Matrix4 {
  const facing = particle.dpolFaceEmitter ? vectorFromTuple(THREE, particle.relativePosition).multiplyScalar(-1) : vectorFromTuple(THREE, particle.velocity);
  if (facing.lengthSq() < 0.00001) camera.getWorldDirection(facing).multiplyScalar(-1);
  facing.normalize();
  let axis = new THREE.Vector3(0, 1, 0);
  const dot = facing.dot(axis);
  if (dot > 0.8 || dot < -0.8) axis = new THREE.Vector3(1, 0, 0);
  const xAxis = new THREE.Vector3().crossVectors(facing, axis);
  if (xAxis.lengthSq() < 0.00001) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(facing, xAxis).normalize();
  const direction = new THREE.Matrix4().makeBasis(xAxis, facing, zAxis);
  const rotation = polygonRotationMatrix(THREE, particle).multiply(direction);
  if (particle.polygonReferencePlane === 1) rotation.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return rotation;
}

function polygonRotationMatrix(THREE: ThreeModule, particle: SplFrameParticle): import("three").Matrix4 {
  if (particle.polygonRotAxis === 1) return new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 1, 1).normalize(), particle.rotation);
  return new THREE.Matrix4().makeRotationY(particle.rotation);
}

function vectorFromTuple(THREE: ThreeModule, tuple: [number, number, number]): import("three").Vector3 {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
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
  let battleLayerCanvasCache = new Map<string, HTMLCanvasElement>();
  const loadEvents = preview.timeline.filter((event) => event.command === "LoadBackground" && event.backgroundId !== undefined).sort((a, b) => a.frame - b.frame);
  const moveEvents = preview.timeline.filter((event) => event.command === "MoveBackground").sort((a, b) => a.frame - b.frame);
  const fadeEvents = preview.timeline.filter((event) => event.command === "ChangeBackgroundColor").sort((a, b) => a.frame - b.frame);
  const alphaEvents = preview.timeline.filter((event) => event.command === "BackgroundAlpha").sort((a, b) => a.frame - b.frame);
  const visibilityEvents = preview.timeline.filter((event) => event.command === "ApplyBackground").sort((a, b) => a.frame - b.frame);
  const paletteAnimationEvents = preview.timeline.filter((event) => event.command === "BackgroundPaletteAnimation").sort((a, b) => a.frame - b.frame);
  const distortionEvents = preview.timeline.filter((event) => event.command === "DistortBackground").sort((a, b) => a.frame - b.frame);

  const draw = (frame: number, cameraState: BattleCameraState) => {
    if (!context) return;
    const state = backgroundStateAt(preview, frame, loadEvents, moveEvents, fadeEvents, alphaEvents, visibilityEvents, paletteAnimationEvents, distortionEvents);
    const key = `${width}:${height}:${frame}:${state.backgroundId}:${state.backgroundEffect ?? ""}:${state.backgroundFrameIndex ?? ""}:${state.paletteFrameIndex ?? ""}:${state.scrollX}:${state.scrollY}:${state.opacity.toFixed(3)}:${state.tintColor.join(",")}:${state.tintAmount.toFixed(3)}:${state.overlayColor.join(",")}:${state.overlayAmount.toFixed(3)}:${state.visible}:${state.distortion ? `${state.distortion.amplitude}:${state.distortion.speed}:${state.distortion.localFrame}` : ""}:${cameraState.backdropZoom.toFixed(3)}:${cameraState.backdropFocus.join(",")}:${cameraState.backdropOffset.join(",")}:${cameraState.shake.join(",")}`;
    if (key === lastKey) return;
    lastKey = key;
    context.clearRect(0, 0, width, height);
    drawBattleSceneBackdrop(context, preview, width, height, cameraState, battleLayerCanvasCache);
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
    context.save();
    context.translate(cameraState.shake[0] * width, cameraState.shake[1] * height);
    if (state.backgroundEffect === "hgDiagonalBeam") {
      drawHgDiagonalBeamBackground(context, width, height, frame, state.scrollX, state.scrollY, state.opacity);
    } else {
      const backgroundFrameCount = background.frameImages?.length ?? 1;
      const backgroundFrameIndex = Math.max(0, Math.min(backgroundFrameCount - 1, state.backgroundFrameIndex ?? 0));
      const backgroundFrame = background.frameImages?.[backgroundFrameIndex] ?? background;
      const imageCacheKey = background.datId * 100000 + backgroundFrameIndex * 1000 + (state.paletteFrameIndex === undefined ? 0 : state.paletteFrameIndex + 1);
      const paletteAnimation = state.backgroundId === undefined ? undefined : preview.backgroundPaletteAnimations?.get(state.backgroundId);
      const image = sourceImageCache.get(imageCacheKey) ?? makeBackgroundImageData(backgroundFrame, state.paletteFrameIndex, paletteAnimation);
      sourceImageCache.set(imageCacheKey, image);
      if (backgroundFrame.hasTransparency) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
      }
      if (state.distortion) {
        drawLasterDistortedTiledBackground(context, image, width, height, state.scrollX, state.scrollY, state.tintColor, state.tintAmount, state.opacity, state.distortion);
      } else {
        drawTiledBackground(context, image, width, height, state.scrollX, state.scrollY, state.tintColor, state.tintAmount, state.opacity);
      }
    }
    context.restore();
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
      battleLayerCanvasCache = new Map();
    },
  };
}

type BackgroundState = {
  backgroundId?: number;
  backgroundEffect?: MoveAnimationPreview["timeline"][number]["backgroundEffect"];
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
  paletteFrameIndex?: number;
  backgroundFrameIndex?: number;
  distortion?: { localFrame: number; amplitude: number; speed: number };
};

function backgroundStateAt(
  preview: MoveAnimationPreview,
  frame: number,
  loadEvents: MoveAnimationPreview["timeline"],
  moveEvents: MoveAnimationPreview["timeline"],
  fadeEvents: MoveAnimationPreview["timeline"],
  alphaEvents: MoveAnimationPreview["timeline"],
  visibilityEvents: MoveAnimationPreview["timeline"],
  paletteAnimationEvents: MoveAnimationPreview["timeline"],
  distortionEvents: MoveAnimationPreview["timeline"],
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
  const paletteFrameIndex = load?.backgroundId === undefined ? undefined : backgroundPaletteFrameIndexAt(preview, load.backgroundId, frame, paletteAnimationEvents);
  const distortion = backgroundDistortionAt(distortionEvents, frame);
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
    backgroundEffect: load?.backgroundEffect,
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
    paletteFrameIndex,
    backgroundFrameIndex: load?.backgroundFrameIndex,
    distortion,
  };
}

function backgroundDistortionAt(distortionEvents: MoveAnimationPreview["timeline"], frame: number): BackgroundState["distortion"] | undefined {
  const event = lastEventAt(distortionEvents, frame);
  if (!event) return undefined;
  const duration = Math.max(1, event.params[1] ?? event.params[5] ?? 1);
  const localFrame = frame - event.frame;
  if (localFrame < 0 || localFrame >= duration) return undefined;
  return {
    localFrame,
    amplitude: Math.max(1, Math.abs(event.params[2] ?? 24)),
    speed: Math.max(1, Math.abs(event.params[3] ?? 160)),
  };
}

function backgroundPaletteFrameIndexAt(
  preview: MoveAnimationPreview,
  backgroundId: number,
  frame: number,
  paletteAnimationEvents: MoveAnimationPreview["timeline"],
): number | undefined {
  const event = lastEventAt(
    paletteAnimationEvents.filter((paletteEvent) => (paletteEvent.params[0] ?? -1) === backgroundId),
    frame,
  );
  if (!event || (event.params[1] ?? 0) === 0) return undefined;
  const animation = preview.backgroundPaletteAnimations?.get(backgroundId);
  if (!animation || animation.frames.length === 0) return undefined;
  const localFrame = Math.max(0, frame - event.frame);
  const cycleLength = animation.frames.reduce((sum, planmFrame) => sum + Math.max(1, planmFrame.wait), 0);
  let cursor = cycleLength > 0 ? localFrame % cycleLength : 0;
  for (const planmFrame of animation.frames) {
    const wait = Math.max(1, planmFrame.wait);
    if (cursor < wait) return planmFrame.paletteIndex;
    cursor -= wait;
  }
  return animation.frames[0]?.paletteIndex;
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

function makeBackgroundImageData(
  background: NonNullable<MoveAnimationPreview["backgrounds"] extends Map<number, infer T> ? T : never>,
  planmPaletteIndex?: number,
  paletteAnimation?: NitroBackgroundPaletteAnimation,
): ImageData {
  const palette = planmPaletteIndex === undefined || !paletteAnimation ? undefined : backgroundPaletteWithPlanmFrame(background, paletteAnimation.palettes, planmPaletteIndex);
  const rgba = palette ? renderNitroBackgroundImage(background, palette) : background.rgba;
  const data = new Uint8ClampedArray(new ArrayBuffer(rgba.length));
  data.set(rgba);
  return new ImageData(data, background.width, background.height);
}

function backgroundPaletteWithPlanmFrame(
  background: NonNullable<MoveAnimationPreview["backgrounds"] extends Map<number, infer T> ? T : never>,
  planmPalettes: NitroPaletteData,
  planmPaletteIndex: number,
): NitroPaletteData {
  const palette = background.indexed.palette.map((color) => [...color] as [number, number, number, number]);
  const sourceBase = planmPaletteIndex * 16;
  const destinationBanks = background.indexed.palette.length <= 16 ? [0, 9] : [9];
  const destinationBank = Math.max(...destinationBanks) * 16;
  while (palette.length < destinationBank + 16) palette.push([0, 0, 0, 255]);
  for (let index = 0; index < 16; index += 1) {
    const color = planmPalettes[sourceBase + index] ?? planmPalettes[index] ?? [0, 0, 0, 255];
    for (const bank of destinationBanks) palette[bank * 16 + index] = color;
  }
  return palette;
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
  drawDefaultBattlePlatforms(context, width, height);
  context.restore();
}

function drawBattleSceneBackdrop(
  context: CanvasRenderingContext2D,
  preview: MoveAnimationPreview,
  width: number,
  height: number,
  cameraState: BattleCameraState,
  cache: Map<string, HTMLCanvasElement>,
): void {
  const battleScene = preview.battleScene;
  if (!battleScene) {
    drawDefaultBattleBackdrop(context, width, height, cameraState);
    return;
  }
  context.save();
  const focusX = width * cameraState.backdropFocus[0];
  const focusY = height * cameraState.backdropFocus[1];
  context.translate(width / 2 + cameraState.backdropOffset[0] * width + cameraState.shake[0] * width, height / 2 + cameraState.backdropOffset[1] * height + cameraState.shake[1] * height);
  context.scale(cameraState.backdropZoom, cameraState.backdropZoom);
  context.translate(-focusX, -focusY);
  context.imageSmoothingEnabled = false;
  if (battleScene.backdrop) {
    const backdropCanvas = canvasForRgbaLayer(cache, `backdrop:${battleScene.backdrop.datId}`, battleScene.backdrop.width, battleScene.backdrop.height, battleScene.backdrop.rgba);
    context.drawImage(backdropCanvas, 0, 0, Math.min(256, battleScene.backdrop.width), Math.min(192, battleScene.backdrop.height), 0, 0, width, height);
  } else {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#5f88e6");
    sky.addColorStop(0.38, "#bbc8e8");
    sky.addColorStop(0.56, "#8aa16d");
    sky.addColorStop(1, "#2d6251");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
  }
  if (battleScene.platforms.length > 0) {
    for (const layer of battleScene.platforms) {
      const layerCanvas = canvasForRgbaLayer(cache, layer.id, layer.width, layer.height, layer.rgba);
      context.drawImage(
        layerCanvas,
        (layer.left / 256) * width,
        (layer.top / 192) * height,
        (layer.width / 256) * width,
        (layer.height / 192) * height,
      );
    }
  } else {
    drawDefaultBattlePlatforms(context, width, height);
  }
  context.restore();
}

function drawDefaultBattlePlatforms(context: CanvasRenderingContext2D, width: number, height: number): void {
  drawBattlePlatform(context, width * 0.67, height * 0.49, width * 0.29, height * 0.11, "#276e5a", "#18493c");
  drawBattlePlatform(context, width * 0.18, height * 0.86, width * 0.44, height * 0.15, "#1f6c61", "#164940");
}

function canvasForRgbaLayer(cache: Map<string, HTMLCanvasElement>, id: string, width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const key = `${id}:${width}:${height}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    const image = new ImageData(new Uint8ClampedArray(rgba), width, height);
    context.putImageData(image, 0, 0);
  }
  cache.set(key, canvas);
  return canvas;
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

function drawHgDiagonalBeamBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: number,
  scrollX: number,
  scrollY: number,
  opacity: number,
): void {
  const phase = frame * 0.32;
  const pulse = Math.sin(phase) * 0.5 + 0.5;
  const bandWidth = height * (0.56 + pulse * 0.14);
  const axisScroll = frame * 18 + scrollX * 7 - scrollY * 4;

  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2);
  context.rotate(-0.34);
  context.translate(-width / 2, -height / 2);

  const bandY = height * (0.48 + Math.sin(phase * 0.65) * 0.02);
  const gradient = context.createLinearGradient(0, bandY - bandWidth / 2, 0, bandY + bandWidth / 2);
  gradient.addColorStop(0, "rgba(245, 253, 255, 0.98)");
  gradient.addColorStop(0.08, "rgba(108, 211, 255, 0.72)");
  gradient.addColorStop(0.17, "rgba(8, 62, 162, 0.94)");
  gradient.addColorStop(0.5, "rgba(0, 24, 112, 0.98)");
  gradient.addColorStop(0.83, "rgba(8, 74, 170, 0.94)");
  gradient.addColorStop(0.92, "rgba(140, 226, 255, 0.76)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0.98)");
  context.fillStyle = gradient;
  context.fillRect(-width * 0.4, bandY - bandWidth / 2, width * 1.8, bandWidth);

  const core = context.createLinearGradient(0, bandY - bandWidth * 0.25, 0, bandY + bandWidth * 0.25);
  core.addColorStop(0, "rgba(53, 135, 228, 0)");
  core.addColorStop(0.48, "rgba(90, 237, 255, 0.24)");
  core.addColorStop(0.52, "rgba(255, 255, 255, 0.2)");
  core.addColorStop(1, "rgba(53, 135, 228, 0)");
  context.fillStyle = core;
  context.fillRect(-width * 0.4, bandY - bandWidth * 0.28, width * 1.8, bandWidth * 0.56);

  context.globalCompositeOperation = "screen";
  for (let index = -2; index < 9; index += 1) {
    const x = mod(index * 180 + axisScroll, width + 360) - 180;
    const streakAlpha = 0.08 + (index % 3 === 0 ? 0.08 : 0);
    const streakWidth = 18 + (index % 2) * 16;
    const streak = context.createLinearGradient(x - streakWidth, 0, x + streakWidth, 0);
    streak.addColorStop(0, `rgba(255, 255, 255, 0)`);
    streak.addColorStop(0.5, `rgba(190, 244, 255, ${streakAlpha})`);
    streak.addColorStop(1, `rgba(255, 255, 255, 0)`);
    context.fillStyle = streak;
    context.fillRect(x - streakWidth, bandY - bandWidth * 0.48, streakWidth * 2, bandWidth * 0.96);
  }

  const glow = context.createRadialGradient(width * 0.38, bandY + bandWidth * 0.08, 0, width * 0.38, bandY + bandWidth * 0.08, bandWidth * 0.48);
  glow.addColorStop(0, `rgba(120, 48, 255, ${0.28 + pulse * 0.12})`);
  glow.addColorStop(0.45, "rgba(85, 83, 255, 0.16)");
  glow.addColorStop(1, "rgba(85, 83, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, bandY - bandWidth * 0.45, width * 0.7, bandWidth * 0.9);
  context.restore();
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
  context.globalAlpha = 0.24;
  context.filter = "blur(1.5px) brightness(1.08)";
  drawTiledBackgroundPass(context, source, width, height, viewportWidth, viewportHeight, sx, sy);
  context.restore();
}

function drawLasterDistortedTiledBackground(
  context: CanvasRenderingContext2D,
  image: ImageData,
  width: number,
  height: number,
  scrollX: number,
  scrollY: number,
  tintColor: [number, number, number],
  tintAmount: number,
  opacity: number,
  distortion: { localFrame: number; amplitude: number; speed: number },
): void {
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  source.getContext("2d")?.putImageData(processEffectBackgroundImageData(image, tintColor, tintAmount, opacity), 0, 0);
  const viewportWidth = Math.min(256, image.width);
  const viewportHeight = Math.min(192, image.height);
  const sx = mod(scrollX, Math.max(1, image.width));
  const sy = mod(scrollY, Math.max(1, image.height));
  const rowHeight = Math.max(1, Math.ceil(height / 96));
  const phase = (distortion.localFrame * distortion.speed) / 192;
  const scaledAmplitude = (distortion.amplitude / viewportWidth) * width;

  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (let y = 0; y < height; y += rowHeight) {
    const sourceRow = Math.floor((y / height) * viewportHeight);
    const sourceY = mod(sy + sourceRow, source.height);
    const sourceHeight = Math.min(source.height - sourceY, Math.max(1, Math.ceil((rowHeight / height) * viewportHeight)));
    const rowPhase = (sourceRow / 192) * Math.PI * 2 + phase;
    const dx = Math.sin(rowPhase) * scaledAmplitude;
    drawTiledBackgroundRowPass(context, source, width, y, rowHeight, viewportWidth, sourceY, sourceHeight, sx, dx);
  }
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.18;
  context.filter = "blur(1.5px) brightness(1.08)";
  for (let y = 0; y < height; y += rowHeight * 2) {
    const sourceRow = Math.floor((y / height) * viewportHeight);
    const sourceY = mod(sy + sourceRow, source.height);
    const sourceHeight = Math.min(source.height - sourceY, Math.max(1, Math.ceil(((rowHeight * 2) / height) * viewportHeight)));
    const rowPhase = (sourceRow / 192) * Math.PI * 2 + phase;
    const dx = Math.sin(rowPhase) * scaledAmplitude;
    drawTiledBackgroundRowPass(context, source, width, y, rowHeight * 2, viewportWidth, sourceY, sourceHeight, sx, dx);
  }
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

function drawTiledBackgroundRowPass(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  y: number,
  rowHeight: number,
  viewportWidth: number,
  sourceY: number,
  sourceHeight: number,
  sx: number,
  rowOffsetX: number,
): void {
  for (let drawnX = 0; drawnX < viewportWidth; ) {
    const sourceX = (sx + drawnX) % source.width;
    const sourceWidth = Math.min(source.width - sourceX, viewportWidth - drawnX);
    const dx = (drawnX / viewportWidth) * width + rowOffsetX;
    const dw = (sourceWidth / viewportWidth) * width;
    context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, dx, y, dw, rowHeight);
    if (rowOffsetX > 0 && dx > 0) context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, dx - width, y, dw, rowHeight);
    if (rowOffsetX < 0 && dx + dw < width) context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, dx + width, y, dw, rowHeight);
    drawnX += sourceWidth;
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
    const whiteMix = Math.max(cyanBias ? 0.04 : 0, highlight * 0.2);
    const glowBoost = 1 + highlight * 0.12;
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

type SpaTextureMapping = {
  repeatS: number;
  repeatT: number;
  flipS: boolean;
  flipT: boolean;
};

function spaTextureMapping(particle: SplFrameParticle): SpaTextureMapping {
  return {
    repeatS: particle.textureRepeatS || 1,
    repeatT: particle.textureRepeatT || 1,
    flipS: particle.textureFlipS ?? false,
    flipT: particle.textureFlipT ?? false,
  };
}

function textureFromSpa(THREE: ThreeModule, texture: SpaTexture, mapping: SpaTextureMapping): import("three").CanvasTexture {
  const canvas = document.createElement("canvas");
  const baked = bakeSpaTextureMapping(texture, mapping);
  canvas.width = baked.width;
  canvas.height = baked.height;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(baked.width, baked.height);
    image.data.set(baked.rgba);
    context.putImageData(image, 0, 0);
  }
  const canvasTexture = new THREE.CanvasTexture(canvas);
  canvasTexture.magFilter = THREE.NearestFilter;
  canvasTexture.minFilter = THREE.NearestFilter;
  canvasTexture.generateMipmaps = false;
  canvasTexture.needsUpdate = true;
  return canvasTexture;
}

function bakeSpaTextureMapping(texture: SpaTexture, mapping: SpaTextureMapping): { width: number; height: number; rgba: Uint8ClampedArray } {
  const repeatS = Math.max(1, Math.round(mapping.repeatS));
  const repeatT = Math.max(1, Math.round(mapping.repeatT));
  if (repeatS === 1 && repeatT === 1 && !mapping.flipS && !mapping.flipT) {
    return { width: texture.width, height: texture.height, rgba: texture.rgba };
  }
  const width = texture.width * repeatS;
  const height = texture.height * repeatT;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const tileY = Math.floor(y / texture.height);
    const localY = y % texture.height;
    const sourceY = mirroredTileCoord(localY, texture.height, tileY, mapping.flipT);
    for (let x = 0; x < width; x += 1) {
      const tileX = Math.floor(x / texture.width);
      const localX = x % texture.width;
      const sourceX = mirroredTileCoord(localX, texture.width, tileX, mapping.flipS);
      const source = (sourceY * texture.width + sourceX) * 4;
      rgba.set(texture.rgba.subarray(source, source + 4), (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

function mirroredTileCoord(local: number, size: number, tile: number, flipped: boolean): number {
  const mirror = tile % 2 === 1;
  return mirror !== flipped ? size - 1 - local : local;
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
