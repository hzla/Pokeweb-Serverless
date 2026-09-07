import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { PerspectiveCamera, Vector3 } from "three";
import { simulateBattleCamera, cameraEventDuration } from "../../src/pokeweb/battleCameraSimulator";
import {
  GEN5_SINGLE_TARGET_POKEMON_POSITION,
  GEN5_SINGLE_USER_POKEMON_POSITION,
} from "../../src/pokeweb/gen5BattleSceneLayout";
import { simulateGen5BattleSprites } from "../../src/pokeweb/gen5BattleSpriteSimulator";
import type { MoveAnimationPreview, MoveAnimationTimelineEvent } from "../../src/pokeweb/moveAnimationPreviewModel";
import { simulateSplPreview, type SplFrameParticle } from "../../src/pokeweb/splEmitterSimulator";
import type { SpaTexture } from "../../src/pokeweb/nitroSpa";

const WIDTH = 256;
const HEIGHT = 192;
const CAMERA_COMMANDS = new Set(["MoveCamera", "AdjustCamera", "CameraMoveAngle", "CameraProjection", "CameraPosPush", "ShakeScreen"]);
const CLEANUP_COMMANDS = new Set(["ApplyBackground", "CameraPosPush", "DeleteSPA", "DeleteObject", "DeleteTrainer", "TerminateMoveScript"]);

export type MoveAnimationSnapshotOptions = {
  preview: MoveAnimationPreview;
  outputDirectory: string;
  frames: "auto" | number[];
};

export type MoveAnimationSnapshotReport = {
  moveId: number;
  frameCount: number;
  frames: number[];
  sides: Array<{ name: "normal" | "swapped"; files: string[]; contactSheet: string }>;
  previewWarnings: MoveAnimationPreview["warnings"];
  approximationWarnings: string[];
};

export async function generateMoveAnimationSnapshots(options: MoveAnimationSnapshotOptions): Promise<MoveAnimationSnapshotReport> {
  const frames = options.frames === "auto" ? selectAutomaticSnapshotFrames(options.preview) : normalizeFrames(options.frames, options.preview.frameCount);
  const sides: MoveAnimationSnapshotReport["sides"] = [];
  for (const swapped of [false, true]) {
    const name = swapped ? "swapped" : "normal";
    const directory = path.join(options.outputDirectory, name);
    await mkdir(directory, { recursive: true });
    const images = frames.map((frame) => renderMoveAnimationSnapshot(options.preview, frame, swapped));
    const files: string[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      const file = path.join(directory, `frame-${String(frames[index]).padStart(5, "0")}.png`);
      await writeFile(file, PNG.sync.write(images[index]!));
      files.push(path.relative(options.outputDirectory, file));
    }
    const contactSheet = path.join(options.outputDirectory, `contact-sheet-${name}.png`);
    await writeFile(contactSheet, PNG.sync.write(makeContactSheet(images)));
    sides.push({ name, files, contactSheet: path.relative(options.outputDirectory, contactSheet) });
  }
  const report: MoveAnimationSnapshotReport = {
    moveId: options.preview.moveId,
    frameCount: options.preview.frameCount,
    frames,
    sides,
    previewWarnings: options.preview.warnings,
    approximationWarnings: [
      "Headless snapshots use Pokeweb's deterministic VM simulators, not the retail DS renderer.",
      "Actor silhouettes and the neutral battlefield are diagnostic stand-ins when no battle-scene sprites are attached.",
      "DS polygon ordering, hardware blending, edge marking, and texture quantization may differ in game.",
    ],
  };
  await writeFile(path.join(options.outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(options.outputDirectory, "README.md"), renderSnapshotReadme(report));
  return report;
}

export function selectAutomaticSnapshotFrames(preview: MoveAnimationPreview): number[] {
  const frames = new Set<number>([0, Math.max(0, preview.frameCount - 1)]);
  const firstResources = new Set<string>();
  for (const event of preview.timeline) {
    if (CAMERA_COMMANDS.has(event.command)) {
      frames.add(event.frame);
      frames.add(event.frame + cameraEventDuration(event));
    }
    if (event.effectKind === "spa" && event.spaId !== undefined && event.resourceId !== undefined) {
      const key = `${event.spaId}:${event.resourceId}`;
      if (!firstResources.has(key)) {
        frames.add(event.frame);
        firstResources.add(key);
      }
      if (event.particle?.projectile) frames.add(event.frame + Math.max(1, event.taskDuration ?? 1));
    }
    if (event.command === "ShakeSprite" || event.actorVisual?.target === "target") frames.add(event.frame);
    if (CLEANUP_COMMANDS.has(event.command)) frames.add(event.frame);
  }
  return normalizeFrames([...frames], preview.frameCount);
}

export function renderMoveAnimationSnapshot(preview: MoveAnimationPreview, frame: number, swappedSides: boolean): PNG {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  renderBackdrop(image, preview, frame);
  const cameraState = simulateBattleCamera(preview.timeline, frame, swappedSides);
  const camera = makeCamera(cameraState);
  drawPlatform(image, projectPoint(camera, swappedSides ? GEN5_SINGLE_TARGET_POKEMON_POSITION : GEN5_SINGLE_USER_POKEMON_POSITION), 54, [52, 96, 112, 150]);
  drawPlatform(image, projectPoint(camera, swappedSides ? GEN5_SINGLE_USER_POKEMON_POSITION : GEN5_SINGLE_TARGET_POKEMON_POSITION), 38, [80, 112, 124, 130]);
  const sprites = simulateGen5BattleSprites(preview.timeline, frame, swappedSides);
  drawActor(image, camera, swappedSides ? GEN5_SINGLE_TARGET_POKEMON_POSITION : GEN5_SINGLE_USER_POKEMON_POSITION, sprites.user, [51, 204, 215]);
  drawActor(image, camera, swappedSides ? GEN5_SINGLE_USER_POKEMON_POSITION : GEN5_SINGLE_TARGET_POKEMON_POSITION, sprites.target, [239, 91, 94]);

  const simulationPreview: MoveAnimationPreview = preview.actorSprites
    ? { ...preview, actorSprites: { ...preview.actorSprites, swappedSides } }
    : { ...preview, actorSprites: { userSprite: transparentPixel(), targetSprite: transparentPixel(), swappedSides } };
  const events = new Map(preview.timeline.map((event) => [event.id, event]));
  for (const particle of simulateSplPreview(simulationPreview, frame).sort((left, right) => left.renderLayer - right.renderLayer)) {
    drawParticle(image, camera, particle, events.get(particle.eventId), preview);
  }
  return image;
}

function renderBackdrop(out: PNG, preview: MoveAnimationPreview, frame: number): void {
  const active = latestEvent(preview.timeline, frame, (event) => event.command === "LoadBackground" && event.backgroundId !== undefined);
  const background = active?.backgroundId === undefined ? undefined : preview.backgrounds.get(active.backgroundId);
  if (background) {
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const sx = Math.min(background.width - 1, Math.floor(x * background.width / WIDTH));
      const sy = Math.min(background.height - 1, Math.floor(y * background.height / HEIGHT));
      const source = (sy * background.width + sx) * 4;
      setPixel(out, x, y, [background.rgba[source]!, background.rgba[source + 1]!, background.rgba[source + 2]!, 255]);
    }
    return;
  }
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const sky = y < 105;
    const rate = sky ? y / 105 : (y - 105) / 87;
    setPixel(out, x, y, sky ? [Math.round(120 - rate * 35), Math.round(188 - rate * 25), Math.round(207 - rate * 35), 255] : [Math.round(130 - rate * 45), Math.round(174 - rate * 45), Math.round(120 - rate * 28), 255]);
  }
}

function drawActor(out: PNG, camera: PerspectiveCamera, base: readonly [number, number, number], state: ReturnType<typeof simulateGen5BattleSprites>["user"], color: [number, number, number]): void {
  if (!state.exists || !state.visible || state.opacity <= 0) return;
  const world: [number, number, number] = [base[0] + state.positionOffset[0], base[1] + state.positionOffset[1] + 2.1, base[2] + state.positionOffset[2]];
  const point = projectPoint(camera, world);
  const width = Math.max(5, 17 * Math.abs(state.scale[0]));
  const height = Math.max(5, 25 * Math.abs(state.scale[1]));
  fillEllipse(out, point.x, point.y, width + 2, height + 2, [20, 26, 34, Math.round(255 * state.opacity)]);
  const evy = state.palette.evy / 16;
  const tint = state.palette.color.map((value) => Math.max(0, Math.min(255, value * 8))) as [number, number, number];
  fillEllipse(out, point.x, point.y, width, height, [mix(color[0], tint[0], evy), mix(color[1], tint[1], evy), mix(color[2], tint[2], evy), Math.round(255 * state.opacity)]);
}

function drawParticle(out: PNG, camera: PerspectiveCamera, particle: SplFrameParticle, event: MoveAnimationTimelineEvent | undefined, preview: MoveAnimationPreview): void {
  const archive = event?.spaId === undefined ? undefined : preview.spaArchives.get(event.spaId);
  const texture = archive?.textures[particle.textureIndex];
  if (!texture) return;
  const point = projectPoint(camera, particle.position);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1.2 || point.z > 1.2) return;
  const size = Math.max(2, Math.min(112, Math.abs(particle.scale) * 22));
  blitTexture(out, texture, point.x, point.y, size * Math.max(0.05, Math.abs(particle.scaleX)), size * Math.max(0.05, Math.abs(particle.scaleY)), particle.rotation, particle.color, particle.alpha);
}

function blitTexture(out: PNG, texture: SpaTexture, centerX: number, centerY: number, width: number, height: number, rotation: number, tint: [number, number, number], alpha: number): void {
  const halfW = Math.max(1, Math.ceil(width / 2));
  const halfH = Math.max(1, Math.ceil(height / 2));
  const radius = Math.ceil(Math.hypot(halfW, halfH));
  const cosine = Math.cos(-rotation);
  const sine = Math.sin(-rotation);
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const localX = dx * cosine - dy * sine;
    const localY = dx * sine + dy * cosine;
    const u = localX / (halfW * 2) + 0.5;
    const v = localY / (halfH * 2) + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const sx = Math.min(texture.width - 1, Math.floor(u * texture.width));
    const sy = Math.min(texture.height - 1, Math.floor(v * texture.height));
    const source = (sy * texture.width + sx) * 4;
    blendPixel(out, Math.round(centerX + dx), Math.round(centerY + dy), [
      Math.round(texture.rgba[source]! * tint[0]),
      Math.round(texture.rgba[source + 1]! * tint[1]),
      Math.round(texture.rgba[source + 2]! * tint[2]),
      Math.round(texture.rgba[source + 3]! * Math.max(0, Math.min(1, alpha))),
    ]);
  }
}

function makeCamera(state: ReturnType<typeof simulateBattleCamera>): PerspectiveCamera {
  const camera = new PerspectiveCamera(state.fov, WIDTH / HEIGHT, 0.1, 1000);
  camera.position.set(state.position[0], state.position[1], state.position[2]);
  camera.lookAt(state.lookAt[0], state.lookAt[1], state.lookAt[2]);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function projectPoint(camera: PerspectiveCamera, value: readonly [number, number, number]): { x: number; y: number; z: number } {
  const projected = new Vector3(value[0], value[1], value[2]).project(camera);
  return { x: (projected.x * 0.5 + 0.5) * WIDTH, y: (-projected.y * 0.5 + 0.5) * HEIGHT, z: projected.z };
}

function drawPlatform(out: PNG, point: { x: number; y: number }, radius: number, color: [number, number, number, number]): void {
  fillEllipse(out, point.x, point.y + 12, radius, radius * 0.24, color);
}

function fillEllipse(out: PNG, centerX: number, centerY: number, radiusX: number, radiusY: number, color: [number, number, number, number]): void {
  const minX = Math.floor(centerX - radiusX);
  const maxX = Math.ceil(centerX + radiusX);
  const minY = Math.floor(centerY - radiusY);
  const maxY = Math.ceil(centerY + radiusY);
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const dx = (x - centerX) / radiusX;
    const dy = (y - centerY) / radiusY;
    if (dx * dx + dy * dy <= 1) blendPixel(out, x, y, color);
  }
}

function makeContactSheet(images: PNG[]): PNG {
  const columns = Math.min(4, Math.max(1, images.length));
  const rows = Math.max(1, Math.ceil(images.length / columns));
  const sheet = new PNG({ width: columns * WIDTH, height: rows * HEIGHT });
  sheet.data.fill(22);
  images.forEach((source, index) => {
    const left = (index % columns) * WIDTH;
    const top = Math.floor(index / columns) * HEIGHT;
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const src = (y * WIDTH + x) * 4;
      const dst = ((top + y) * sheet.width + left + x) * 4;
      sheet.data[dst] = source.data[src]!;
      sheet.data[dst + 1] = source.data[src + 1]!;
      sheet.data[dst + 2] = source.data[src + 2]!;
      sheet.data[dst + 3] = 255;
    }
  });
  return sheet;
}

function latestEvent(timeline: MoveAnimationTimelineEvent[], frame: number, predicate: (event: MoveAnimationTimelineEvent) => boolean): MoveAnimationTimelineEvent | undefined {
  let result: MoveAnimationTimelineEvent | undefined;
  for (const event of timeline) if (event.frame <= frame && predicate(event)) result = event;
  return result;
}

function normalizeFrames(frames: number[], frameCount: number): number[] {
  return [...new Set(frames.map((frame) => Math.max(0, Math.min(Math.max(0, frameCount - 1), Math.round(frame)))))]
    .sort((left, right) => left - right);
}

function renderSnapshotReadme(report: MoveAnimationSnapshotReport): string {
  return `# Move ${report.moveId} preview snapshots\n\nFrames: ${report.frames.join(", ")}\n\nThese are deterministic Pokeweb preview snapshots, not emulator captures or proof of retail parity. See \`report.json\` for preview and approximation warnings.\n`;
}

function transparentPixel(): { width: number; height: number; pixels: Uint8ClampedArray } {
  return { width: 1, height: 1, pixels: new Uint8ClampedArray(4) };
}

function setPixel(out: PNG, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
  const offset = (y * out.width + x) * 4;
  out.data[offset] = color[0];
  out.data[offset + 1] = color[1];
  out.data[offset + 2] = color[2];
  out.data[offset + 3] = color[3];
}

function blendPixel(out: PNG, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= out.width || y >= out.height || color[3] <= 0) return;
  const offset = (y * out.width + x) * 4;
  const alpha = color[3] / 255;
  out.data[offset] = Math.round(color[0] * alpha + out.data[offset]! * (1 - alpha));
  out.data[offset + 1] = Math.round(color[1] * alpha + out.data[offset + 1]! * (1 - alpha));
  out.data[offset + 2] = Math.round(color[2] * alpha + out.data[offset + 2]! * (1 - alpha));
  out.data[offset + 3] = 255;
}

function mix(left: number, right: number, rate: number): number {
  return Math.round(left + (right - left) * Math.max(0, Math.min(1, rate)));
}
