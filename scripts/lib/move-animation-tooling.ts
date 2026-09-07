import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getMoveAnimationCommandDoc } from "../../src/pokeweb/moveAnimationDocumentation";
import {
  decompileMoveAnimationBytes,
  parseMoveAnimationScript,
  type ParsedMoveAnimationCommand,
} from "../../src/pokeweb/moveAnimationModel";
import {
  parseSpaArchive,
  type SpaArchive,
  type SpaChildResource,
  type SpaResource,
  type SpaTexture,
} from "../../src/pokeweb/nitroSpa";

export const PARTICLE_GLOBAL_MAX = 16;
export const TEMP_WORK_SIZE = 16;
export const PARTICLE_POLYGON_ID_MIN = 6;
export const PARTICLE_POLYGON_ID_MAX = 54;
export const PARTICLE_POLYGON_CAPACITY = PARTICLE_POLYGON_ID_MAX - PARTICLE_POLYGON_ID_MIN + 1;

export const RETAIL_LIMIT_SOURCES = {
  loadedSpas: "reference_repos/swan_export/lib/gflib/include/particle.h:66 (PARTICLE_GLOBAL_MAX)",
  temporaryEmitters: "reference_repos/swan_export/prog/src/battle/btlv/btlv_effvm.c:38 (TEMP_WORK_SIZE)",
  polygons: "retail particle polygon IDs 6-54",
} as const;

export type MoveAnimationManifestExpectation = {
  loadSpas?: number[];
  forbidSpas?: number[];
  backgrounds?: number[];
  text?: string[];
  maxLoadedSpas?: number;
  maxTemporaryEmitters?: number;
  maxConcurrentParticles?: number;
};

export type MoveAnimationFileHash = {
  path: string;
  bytes: number;
  sha256: string;
};

export type MoveAnimationFinishRecord = {
  completedAt: string;
  generated: MoveAnimationFileHash[];
  staged: {
    mirror: MoveAnimationFileHash[];
    build: MoveAnimationFileHash[];
  };
  builtRom: {
    path: string;
    sha256: string;
    animation: MoveAnimationFileHash;
    spas: MoveAnimationFileHash[];
    expandedRoute: "not-required" | "frost-patched" | "w2u-patched";
  };
  outputRom: {
    path: string;
    sha256: string;
  };
  dependencies: {
    loadSpas: number[];
    backgrounds: number[];
    calledAnimations: number[];
    logicalTarget: {
      storeName: "move_animations" | "battle_animations";
      sourcePath: string;
      index: number;
      white2UpgradeLayout: boolean;
    };
    spas: MoveAnimationFileHash[];
  };
};

export type MoveAnimationManifest = {
  version?: 1;
  moveId: number;
  slug: string;
  donorMoveIds?: number[];
  reservedSpaIds?: number[];
  generator?: string;
  script?: string;
  animation: string;
  spas?: string[];
  expect?: MoveAnimationManifestExpectation;
  finish?: MoveAnimationFinishRecord;
  final?: MoveAnimationFinishRecord & { finalizedAt: string };
  history?: Array<{ finalizedAt: string; final: MoveAnimationFinishRecord }>;
  reopenedAt?: string;
};

export type ResolvedMoveAnimationManifest = {
  manifestPath: string;
  directory: string;
  manifest: MoveAnimationManifest;
  generatorPath: string;
  scriptPath?: string;
  animationPath: string;
  spaPaths: string[];
};

export type SpaPeakEstimate = {
  peakParents: number;
  peakChildren: number;
  peakParticles: number;
  durationFrames: number;
  frameCounts: number[];
};

export type SpaResourceInspection = {
  index: number;
  textureReferences: number[];
  color: [number, number, number];
  colorAnim?: SpaResource["colorAnim"];
  alpha: { base: number; animation?: SpaResource["alphaAnim"] };
  scale: { base: number; aspectRatio: number; animation?: SpaResource["scaleAnim"] };
  child?: SpaChildResource;
  timing: {
    startDelayFrames: number;
    emitterLifeFrames: number;
    particleLifeFrames: number;
    emissionIntervalFrames: number;
    emissionCount: number;
  };
  rotation: {
    enabled: boolean;
    randomInitial: boolean;
    initial: number;
    min: number;
    max: number;
    axis: number;
    referencePlane: number;
  };
  behaviors: SpaResource["behaviors"];
  emitterBasePos: [number, number, number];
  drawType: number;
  emissionType: number;
  selfMaintaining: boolean;
  followEmitter: boolean;
  peak: Omit<SpaPeakEstimate, "frameCounts">;
};

export type SpaInspectionReport = {
  resourceCount: number;
  textureCount: number;
  warnings: string[];
  resources: SpaResourceInspection[];
  textures: Array<{
    index: number;
    format: number;
    dimensions: string;
    sharedTexture?: number;
    rgbaSha256: string;
  }>;
};

export type SpaSemanticDifference = {
  path: string;
  before: unknown;
  after: unknown;
  allowed: boolean;
  detail?: string;
};

export type SpaSemanticDiffReport = {
  differences: SpaSemanticDifference[];
  disallowed: SpaSemanticDifference[];
};

export type MoveAnimationLintIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  label?: string;
  frame?: number;
  command?: string;
  spaId?: number;
  resourceId?: number;
};

export type MoveAnimationWaitExplanation = {
  label: string;
  frame: number;
  kind: number;
  waitedUntil: number;
  activeTasks: string[];
};

export type MoveAnimationLintReport = {
  ok: boolean;
  issues: MoveAnimationLintIssue[];
  labels: string[];
  commandCount: number;
  loadSpas: number[];
  backgrounds: number[];
  metrics: {
    maxLoadedSpas: number;
    maxTemporaryEmitters: number;
    maxConcurrentParticles: number;
    maxPolygonPressure: number;
  };
  waits: MoveAnimationWaitExplanation[];
};

type ActiveTask = {
  group: number;
  endFrame: number;
  description: string;
};

type SpriteLifecycle = {
  scaleX: number;
  scaleY: number;
  hidden: boolean;
  freeze: boolean;
  shadowHidden: boolean;
};

const SPA_SPAWN_COMMANDS = new Set([
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAAllAnimations",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation",
  "DoSPAOrthoCircleAnimation",
]);

const TEMP_EMITTER_COMMANDS = new Set([
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation",
  "DoSPAOrthoCircleAnimation",
]);

const FX16_MIN = -8;
const FX16_MAX = 0x7fff / 4096;
const FX16_STEP = 1 / 4096;
const MAX_PROFILE_FRAMES = 20_000;
const KNOWN_RESOURCE_FLAG_MASK =
  0x0f |
  (0x03 << 4) |
  (0x03 << 6) |
  (0xffff << 8) |
  (0x3f << 24);
const W2U_MOVE_ANIMATION_ROUTE_SIGNATURE = hexBytes(
  "00b50d4b814205db0c48814201da012101e0733e00210120814200bd" +
  "c0b5064b844205db0548844201da012601e0733c00260127be42c0bd" +
  "ff7f0000a4020000",
);

export function hasW2uMoveAnimationRoutingSignature(romBytes: Uint8Array): boolean {
  const rom = Buffer.from(romBytes.buffer, romBytes.byteOffset, romBytes.byteLength);
  const signature = Buffer.from(
    W2U_MOVE_ANIMATION_ROUTE_SIGNATURE.buffer,
    W2U_MOVE_ANIMATION_ROUTE_SIGNATURE.byteOffset,
    W2U_MOVE_ANIMATION_ROUTE_SIGNATURE.byteLength,
  );
  return rom.indexOf(signature) >= 0;
}

export async function readMoveAnimationManifest(manifestPath: string): Promise<ResolvedMoveAnimationManifest> {
  const absoluteManifestPath = path.resolve(manifestPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read move animation manifest ${absoluteManifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${absoluteManifestPath} must contain a JSON object.`);
  const manifest = value as MoveAnimationManifest;
  if (!Number.isInteger(manifest.moveId) || manifest.moveId < 0) throw new Error(`${absoluteManifestPath}: moveId must be a non-negative integer.`);
  if (!manifest.slug || !/^[a-z0-9-]+$/u.test(manifest.slug)) throw new Error(`${absoluteManifestPath}: slug must use lowercase letters, digits, and dashes.`);
  if (!manifest.animation || typeof manifest.animation !== "string") throw new Error(`${absoluteManifestPath}: animation is required.`);
  if (manifest.spas !== undefined && (!Array.isArray(manifest.spas) || manifest.spas.some((entry) => typeof entry !== "string"))) {
    throw new Error(`${absoluteManifestPath}: spas must be an array of paths.`);
  }
  const directory = path.dirname(absoluteManifestPath);
  const generatorPath = path.resolve(directory, manifest.generator ?? `make-${manifest.slug}.ts`);
  const scriptPath = manifest.script
    ? path.resolve(directory, manifest.script)
    : await inferGeneratedScript(directory, manifest.moveId);
  return {
    manifestPath: absoluteManifestPath,
    directory,
    manifest,
    generatorPath,
    scriptPath,
    animationPath: path.resolve(directory, manifest.animation),
    spaPaths: (manifest.spas ?? []).map((entry) => path.resolve(directory, entry)),
  };
}

export function inspectSpaArchive(archive: SpaArchive, resourceIndex?: number): SpaInspectionReport {
  const resources = resourceIndex === undefined
    ? archive.resources
    : [archive.resources[resourceIndex]].filter((resource): resource is SpaResource => resource !== undefined);
  if (resourceIndex !== undefined && resources.length === 0) throw new Error(`SPA resource ${resourceIndex} does not exist (resource count ${archive.resources.length}).`);
  return {
    resourceCount: archive.resources.length,
    textureCount: archive.textures.length,
    warnings: archive.warnings.map((warning) => warning.message),
    resources: resources.map((resource) => {
      const peak = estimateSpaResourcePeak(resource);
      return {
        index: resource.index,
        textureReferences: resourceTextureReferences(resource),
        color: resource.color,
        colorAnim: resource.colorAnim,
        alpha: { base: resource.baseAlpha, animation: resource.alphaAnim },
        scale: { base: resource.baseScale, aspectRatio: resource.aspectRatio, animation: resource.scaleAnim },
        child: resource.childResource,
        timing: {
          startDelayFrames: resource.startDelayFrames,
          emitterLifeFrames: resource.emitterLifeFrames,
          particleLifeFrames: resource.particleLifeFrames,
          emissionIntervalFrames: resource.emissionIntervalFrames,
          emissionCount: resource.emissionCount,
        },
        rotation: {
          enabled: resource.hasRotation,
          randomInitial: resource.randomInitAngle,
          initial: resource.initAngle,
          min: resource.minRotation,
          max: resource.maxRotation,
          axis: resource.polygonRotAxis,
          referencePlane: resource.polygonReferencePlane,
        },
        behaviors: resource.behaviors,
        emitterBasePos: resource.emitterBasePos,
        drawType: resource.drawType,
        emissionType: resource.emissionType,
        selfMaintaining: resource.selfMaintaining,
        followEmitter: resource.followEmitter,
        peak: {
          peakParents: peak.peakParents,
          peakChildren: peak.peakChildren,
          peakParticles: peak.peakParticles,
          durationFrames: peak.durationFrames,
        },
      };
    }),
    textures: archive.textures.map((texture) => ({
      index: texture.index,
      format: texture.format,
      dimensions: `${texture.width}x${texture.height}`,
      sharedTexture: texture.useSharedTexture ? texture.sharedTexId : undefined,
      rgbaSha256: sha256(texture.rgba),
    })),
  };
}

export function estimateSpaResourcePeak(resource: SpaResource, lifeMultiplier = 1): SpaPeakEstimate {
  const multiplier = clamp(lifeMultiplier, 0.25, 4);
  const emitterLife = Math.max(1, Math.ceil(resource.emitterLifeFrames * multiplier));
  const parentLife = Math.max(1, Math.ceil(resource.particleLifeFrames * multiplier * (1 + resource.variance.lifeTime)));
  const interval = Math.max(0, Math.floor(resource.emissionIntervalFrames));
  const parentBirths: number[] = [];
  for (let frame = 0; frame < emitterLife; frame += Math.max(1, interval)) {
    parentBirths.push(resource.startDelayFrames + frame);
    if (interval === 0) break;
  }
  const finalParentDeath = (parentBirths.at(-1) ?? resource.startDelayFrames) + parentLife;
  const child = resource.childResource;
  const childLife = child ? Math.max(1, Math.ceil(child.lifeFrames * multiplier)) : 0;
  const estimatedEnd = finalParentDeath + childLife + 1;
  const durationFrames = Math.min(MAX_PROFILE_FRAMES, Math.max(1, estimatedEnd));
  const parents = new Array<number>(durationFrames).fill(0);
  const children = new Array<number>(durationFrames).fill(0);
  const addLifetime = (target: number[], birth: number, life: number, count: number) => {
    for (let frame = Math.max(0, birth); frame < Math.min(target.length, birth + life); frame += 1) target[frame] += count;
  };
  for (const birth of parentBirths) {
    addLifetime(parents, birth, parentLife, Math.max(0, resource.emissionCount));
    if (!child || child.emissionCount <= 0) continue;
    const firstChildFrame = birth + Math.ceil(parentLife * clamp(child.emissionDelay, 0, 1));
    const childInterval = Math.max(0, Math.floor(child.emissionIntervalFrames));
    for (let childBirth = firstChildFrame; childBirth < birth + parentLife; childBirth += Math.max(1, childInterval)) {
      addLifetime(children, childBirth, childLife, child.emissionCount * Math.max(0, resource.emissionCount));
      if (childInterval === 0) continue;
    }
  }
  const frameCounts = parents.map((count, frame) => count + (children[frame] ?? 0));
  return {
    peakParents: Math.max(0, ...parents),
    peakChildren: Math.max(0, ...children),
    peakParticles: Math.max(0, ...frameCounts),
    durationFrames: Math.max(1, estimatedEnd),
    frameCounts,
  };
}

export function diffSpaArchives(before: SpaArchive, after: SpaArchive, allow: string[] = []): SpaSemanticDiffReport {
  const differences: SpaSemanticDifference[] = [];
  compareValues(spaSemanticProjection(before), spaSemanticProjection(after), "", allow, differences);
  return { differences, disallowed: differences.filter((difference) => !difference.allowed) };
}

export function lintMoveAnimationScript(
  scriptText: string,
  spaArchives: ReadonlyMap<number, SpaArchive>,
  expectations: MoveAnimationManifestExpectation = {},
): MoveAnimationLintReport {
  const issues: MoveAnimationLintIssue[] = [];
  let parsed;
  try {
    parsed = parseMoveAnimationScript(scriptText);
  } catch (error) {
    return {
      ok: false,
      issues: [{ severity: "error", code: "script-parse", message: error instanceof Error ? error.message : String(error) }],
      labels: [],
      commandCount: 0,
      loadSpas: [],
      backgrounds: [],
      metrics: { maxLoadedSpas: 0, maxTemporaryEmitters: 0, maxConcurrentParticles: 0, maxPolygonPressure: 0 },
      waits: [],
    };
  }

  const allLoadSpas = new Set<number>();
  const allBackgrounds = new Set<number>();
  const waits: MoveAnimationWaitExplanation[] = [];
  let commandCount = 0;
  let maxLoadedSpas = 0;
  let maxTemporaryEmitters = 0;
  let maxConcurrentParticles = 0;

  for (const label of parsed.labelOrder) {
    const loadedSpas = new Set<number>();
    const activeTasks: ActiveTask[] = [];
    const tempTasks: ActiveTask[] = [];
    const particleFrames: number[] = [];
    const sprites = new Map<number, SpriteLifecycle>();
    const backgroundVisibility = new Map<number, boolean>();
    const backgroundColors = new Map<number, number>();
    let cameraDirty = false;
    let projection = 1;
    let frame = 0;

    for (const command of parsed.scripts.get(label) ?? []) {
      commandCount += 1;
      pruneTasks(activeTasks, frame);
      pruneTasks(tempTasks, frame);

      if (command.name === "Wait") {
        frame += Math.max(0, command.params[0] ?? 0);
        continue;
      }
      if (command.name === "LetCMDsFinish") {
        const kind = command.params[0] ?? 0;
        const matching = activeTasks.filter((task) => task.endFrame > frame && (kind === 0 || task.group === kind));
        const waitedUntil = matching.reduce((maximum, task) => Math.max(maximum, task.endFrame), frame);
        waits.push({ label, frame, kind, waitedUntil, activeTasks: matching.map((task) => `${task.description} (through frame ${task.endFrame})`) });
        if (kind === 0) {
          issues.push(issue("warning", "broad-wait", matching.length
            ? `LetCMDsFinish ALL waits on ${matching.map((task) => task.description).join(", ")}; a non-terminating task in any group can stall here.`
            : "LetCMDsFinish ALL has no modeled active tasks and may be broader than necessary.", label, frame, command));
        }
        frame = waitedUntil;
        pruneTasks(activeTasks, frame);
        pruneTasks(tempTasks, frame);
        continue;
      }

      if (command.name === "LoadSPA") {
        const spaId = command.params[0] ?? -1;
        loadedSpas.add(spaId);
        allLoadSpas.add(spaId);
        maxLoadedSpas = Math.max(maxLoadedSpas, loadedSpas.size);
        if (!spaArchives.has(spaId)) issues.push(issue("error", "missing-spa", `LoadSPA ${spaId} has no matching staged/custom or clean-ROM SPA archive.`, label, frame, command, spaId));
      } else if (command.name === "DeleteSPA") {
        const spaId = command.params[0] ?? -1;
        if (!loadedSpas.delete(spaId)) issues.push(issue("warning", "delete-unloaded-spa", `DeleteSPA ${spaId} is not loaded on this script path.`, label, frame, command, spaId));
      } else if (SPA_SPAWN_COMMANDS.has(command.name)) {
        const spaId = command.params[0] ?? -1;
        if (!loadedSpas.has(spaId)) issues.push(issue("error", "spawn-before-load", `${command.name} references SPA ${spaId} before LoadSPA.`, label, frame, command, spaId));
        const archive = spaArchives.get(spaId);
        const resourceIds = command.name === "DoSPAAllAnimations"
          ? archive?.resources.map((resource) => resource.index) ?? []
          : [command.params[1] ?? -1];
        if (!archive) {
          issues.push(issue("error", "spawn-missing-spa", `${command.name} cannot resolve SPA ${spaId}.`, label, frame, command, spaId));
        } else {
          for (const resourceId of resourceIds) {
            const resource = archive.resources[resourceId];
            if (!resource) {
              issues.push(issue("error", "missing-resource", `${command.name} references missing SPA ${spaId} resource ${resourceId}.`, label, frame, command, spaId, resourceId));
              continue;
            }
            const lifeMultiplier = commandLifeMultiplier(command);
            const profile = estimateSpaResourcePeak(resource, lifeMultiplier);
            for (let localFrame = 0; localFrame < profile.frameCounts.length; localFrame += 1) {
              particleFrames[frame + localFrame] = (particleFrames[frame + localFrame] ?? 0) + (profile.frameCounts[localFrame] ?? 0);
            }
            activeTasks.push({ group: 2, endFrame: frame + profile.durationFrames, description: `SPA ${spaId} resource ${resourceId}` });
          }
        }
        if (TEMP_EMITTER_COMMANDS.has(command.name)) {
          const duration = temporaryEmitterDuration(command);
          const task = { group: 2, endFrame: frame + duration, description: `${command.name} SPA ${spaId} resource ${command.params[1] ?? -1}` };
          tempTasks.push(task);
          activeTasks.push(task);
          maxTemporaryEmitters = Math.max(maxTemporaryEmitters, tempTasks.length);
        }
      }

      if (command.name === "LoadBackground") {
        allBackgrounds.add(command.params[0] ?? -1);
      } else if (command.name === "ApplyBackground" || command.name === "BackgroundVisible") {
        const background = command.params[0] ?? -1;
        backgroundVisibility.set(background, (command.params[1] ?? 0) === 0);
      } else if (command.name === "ChangeBackgroundColor") {
        const background = command.params[0] ?? -1;
        backgroundColors.set(background, command.params[2] ?? 0);
      }

      if (command.name === "MoveCamera") cameraDirty = (command.params[1] ?? -1) !== 8;
      else if (command.name === "AdjustCamera" || command.name === "CameraMoveAngle" || command.name === "CameraPosPush") cameraDirty = true;
      if (command.name === "CameraProjection") projection = command.params[0] ?? projection;

      if (command.name === "DistortSprite" && ((command.params[2] ?? 0) === 0 || (command.params[3] ?? 0) === 0)) {
        issues.push(issue("warning", "zero-scale", "ScaleSprite uses a zero X or Y scale. Zero is not a neutral reset; restore both axes to 1x (4096).", label, frame, command));
      }
      updateSpriteLifecycle(command, sprites);
      const taskDuration = genericTaskDuration(command);
      const group = taskGroup(command.name);
      if (taskDuration > 0 && group !== undefined && !SPA_SPAWN_COMMANDS.has(command.name)) {
        activeTasks.push({ group, endFrame: frame + taskDuration, description: command.name });
      }
    }

    const routeParticlePeak = particleFrames.reduce((maximum, count) => Math.max(maximum, count ?? 0), 0);
    maxConcurrentParticles = Math.max(maxConcurrentParticles, routeParticlePeak);
    const dirtyBackgrounds = [...backgroundVisibility].filter(([background, visible]) => visible !== defaultBackgroundVisibility(background));
    for (const [background, visible] of dirtyBackgrounds) {
      issues.push({ severity: "error", code: "background-visibility-dirty", message: `Background layer ${background} ends ${visible ? "visible" : "hidden"}, not in its battle-default state.`, label });
    }
    for (const [background, coefficient] of backgroundColors) {
      if (coefficient !== 0) issues.push({ severity: "error", code: "background-color-dirty", message: `Background ${background} palette coefficient ends at ${coefficient}, not 0.`, label });
    }
    if (cameraDirty) issues.push({ severity: "warning", code: "camera-dirty", message: "Camera does not end at the INIT preset on this script path.", label });
    if (projection !== 1) issues.push({ severity: "error", code: "projection-dirty", message: "Camera projection remains orthographic at termination; restore PERSPECTIVE.", label });
    for (const [selector, state] of sprites) {
      const target = selectorName(selector);
      if (state.scaleX !== 4096 || state.scaleY !== 4096) issues.push({ severity: "error", code: "sprite-scale-dirty", message: `${target} is left scaled to ${formatFx(state.scaleX)}x/${formatFx(state.scaleY)}x.`, label });
      if (state.hidden) issues.push({ severity: "error", code: "sprite-hidden", message: `${target} is hidden at termination.`, label });
      if (state.freeze) issues.push({ severity: "error", code: "sprite-frozen", message: `${target} freeze state remains START at termination.`, label });
      if (state.shadowHidden) issues.push({ severity: "error", code: "sprite-shadow-hidden", message: `${target} shadow remains hidden at termination.`, label });
    }
    const unfinished = activeTasks.filter((task) => task.endFrame > frame);
    if (unfinished.length) issues.push({ severity: "info", code: "tasks-at-termination", message: `Termination relies on engine cleanup for ${unfinished.map((task) => `${task.description} through frame ${task.endFrame}`).join(", ")}.`, label, frame });
  }

  if (maxLoadedSpas > PARTICLE_GLOBAL_MAX) {
    issues.push({ severity: "error", code: "loaded-spa-limit", message: `Script can hold ${maxLoadedSpas} SPA archives; retail limit is ${PARTICLE_GLOBAL_MAX}. ${RETAIL_LIMIT_SOURCES.loadedSpas}.` });
  }
  if (maxTemporaryEmitters > TEMP_WORK_SIZE) {
    issues.push({ severity: "error", code: "temporary-emitter-limit", message: `Script can hold ${maxTemporaryEmitters} moving/circular emitter tasks; retail limit is ${TEMP_WORK_SIZE}. ${RETAIL_LIMIT_SOURCES.temporaryEmitters}.` });
  }
  if (maxConcurrentParticles > PARTICLE_POLYGON_CAPACITY) {
    issues.push({ severity: "warning", code: "polygon-pressure", message: `Estimated peak is ${maxConcurrentParticles} live particles against ${PARTICLE_POLYGON_CAPACITY} particle polygon IDs (${PARTICLE_POLYGON_ID_MIN}-${PARTICLE_POLYGON_ID_MAX}); retail may drop or reorder particles.` });
  }

  validateSpaArchives(spaArchives, issues);
  checkExpectations(scriptText, allLoadSpas, allBackgrounds, maxLoadedSpas, maxTemporaryEmitters, maxConcurrentParticles, expectations, issues);
  return {
    ok: !issues.some((entry) => entry.severity === "error"),
    issues,
    labels: parsed.labelOrder.slice(),
    commandCount,
    loadSpas: [...allLoadSpas].sort((a, b) => a - b),
    backgrounds: [...allBackgrounds].sort((a, b) => a - b),
    metrics: {
      maxLoadedSpas,
      maxTemporaryEmitters,
      maxConcurrentParticles,
      maxPolygonPressure: maxConcurrentParticles,
    },
    waits,
  };
}

export function scriptTextFromBytesOrText(bytes: Uint8Array, fileName: string): string {
  return /\.(?:s|txt)$/iu.test(fileName) ? new TextDecoder().decode(bytes) : decompileMoveAnimationBytes(bytes);
}

export function spaIdFromPath(filePath: string): number {
  const match = /^6_0*(\d+)\.bin$/u.exec(path.basename(filePath));
  if (!match) throw new Error(`SPA filename must look like 6_00000803.bin: ${filePath}`);
  return Number.parseInt(match[1] ?? "", 10);
}

export async function hashFile(filePath: string, displayPath = filePath): Promise<MoveAnimationFileHash> {
  const bytes = new Uint8Array(await readFile(filePath));
  return { path: displayPath, bytes: bytes.length, sha256: sha256(bytes) };
}

export function sha256(bytes: Uint8Array | Uint8ClampedArray): string {
  return createHash("sha256").update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
}

function resourceTextureReferences(resource: SpaResource): number[] {
  return [...new Set([
    resource.textureIndex,
    ...(resource.texAnim?.textures.slice(0, resource.texAnim.textureCount) ?? []),
    ...(resource.childResource ? [resource.childResource.textureIndex] : []),
  ])].sort((a, b) => a - b);
}

function spaSemanticProjection(archive: SpaArchive): unknown {
  return {
    resources: archive.resources.map(({ rawHeader: _rawHeader, flags, ...resource }) => ({
      ...resource,
      unknownFlags: flags & ~KNOWN_RESOURCE_FLAG_MASK,
    })),
    textures: archive.textures.map((texture) => textureProjection(texture)),
    warnings: archive.warnings.map((warning) => warning.message),
  };
}

function textureProjection(texture: SpaTexture): unknown {
  return {
    index: texture.index,
    format: texture.format,
    width: texture.width,
    height: texture.height,
    useSharedTexture: texture.useSharedTexture,
    sharedTexId: texture.sharedTexId,
    palColor0Transparent: texture.palColor0Transparent,
    fallback: texture.fallback,
    fallbackReason: texture.fallbackReason,
    pixels: texture.rgba,
  };
}

function compareValues(before: unknown, after: unknown, currentPath: string, allow: string[], out: SpaSemanticDifference[]): void {
  if (before instanceof Uint8Array || before instanceof Uint8ClampedArray || after instanceof Uint8Array || after instanceof Uint8ClampedArray) {
    const left = before instanceof Uint8Array || before instanceof Uint8ClampedArray ? before : new Uint8Array();
    const right = after instanceof Uint8Array || after instanceof Uint8ClampedArray ? after : new Uint8Array();
    if (bytesEqual(left, right)) return;
    let changed = 0;
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) if (left[index] !== right[index]) changed += 1;
    out.push({ path: currentPath, before: sha256(left), after: sha256(right), allowed: isAllowedPath(currentPath, allow), detail: `${changed} RGBA byte(s) changed` });
    return;
  }
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) compareValues(before[index], after[index], `${currentPath}[${index}]`, allow, out);
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) compareValues(before[key], after[key], currentPath ? `${currentPath}.${key}` : key, allow, out);
    return;
  }
  out.push({ path: currentPath, before, after, allowed: isAllowedPath(currentPath, allow) });
}

function isAllowedPath(value: string, allow: string[]): boolean {
  const segments = value.replace(/\[\d+\]/gu, "").split(".");
  return allow.some((entry) => {
    const wanted = entry.trim();
    if (!wanted) return false;
    if (wanted === "texturePixels" || wanted === "pixels") return segments.includes("pixels");
    return segments.includes(wanted) || value === wanted || value.startsWith(`${wanted}.`);
  });
}

function validateSpaArchives(spaArchives: ReadonlyMap<number, SpaArchive>, issues: MoveAnimationLintIssue[]): void {
  for (const [spaId, archive] of spaArchives) {
    for (const warning of archive.warnings) issues.push({ severity: "warning", code: "spa-parse-warning", message: warning.message, spaId });
    for (const texture of archive.textures) {
      if (texture.useSharedTexture && !archive.textures[texture.sharedTexId]) {
        issues.push({ severity: "error", code: "shared-texture-reference", message: `SPA ${spaId} texture ${texture.index} shares missing texture ${texture.sharedTexId}.`, spaId });
      }
    }
    for (const resource of archive.resources) {
      for (const textureIndex of resourceTextureReferences(resource)) {
        if (!archive.textures[textureIndex]) issues.push({ severity: "error", code: "texture-reference", message: `SPA ${spaId} resource ${resource.index} references missing texture ${textureIndex}.`, spaId, resourceId: resource.index });
      }
      if (resource.texAnim && (resource.texAnim.textureCount < 1 || resource.texAnim.textureCount > 8 || resource.texAnim.textureCount > resource.texAnim.textures.length)) {
        issues.push({ severity: "error", code: "texture-animation-reference", message: `SPA ${spaId} resource ${resource.index} has invalid texture animation count ${resource.texAnim.textureCount}.`, spaId, resourceId: resource.index });
      }
      for (const violation of fx16Violations(resource)) {
        issues.push({ severity: violation.range ? "error" : "warning", code: violation.range ? "fx16-range" : "fx16-precision", message: `SPA ${spaId} resource ${resource.index} ${violation.path}=${violation.value} ${violation.range ? `is outside ${FX16_MIN}..${FX16_MAX}` : `is not aligned to ${FX16_STEP}`}.`, spaId, resourceId: resource.index });
      }
    }
  }
}

function fx16Violations(resource: SpaResource): Array<{ path: string; value: number; range: boolean }> {
  const values: Array<[string, number]> = [
    ["aspectRatio", resource.aspectRatio], ["polygonX", resource.polygonX], ["polygonY", resource.polygonY],
  ];
  if (resource.scaleAnim) values.push(["scaleAnim.start", resource.scaleAnim.start], ["scaleAnim.mid", resource.scaleAnim.mid], ["scaleAnim.end", resource.scaleAnim.end]);
  if (resource.childResource) values.push(["child.randomInitVelMag", resource.childResource.randomInitVelMag], ["child.endScale", resource.childResource.endScale]);
  resource.behaviors.forEach((behavior, index) => {
    if (behavior.type === "gravity" || behavior.type === "random") behavior.magnitude.forEach((value, axis) => values.push([`behaviors[${index}].magnitude[${axis}]`, value]));
    if (behavior.type === "magnet" || behavior.type === "convergence") values.push([`behaviors[${index}].force`, behavior.force]);
    if (behavior.type === "collision") values.push([`behaviors[${index}].elasticity`, behavior.elasticity]);
  });
  const violations: Array<{ path: string; value: number; range: boolean }> = [];
  for (const [fieldPath, value] of values) {
    if (!Number.isFinite(value) || value < FX16_MIN || value > FX16_MAX) violations.push({ path: fieldPath, value, range: true });
    else if (Math.abs(value / FX16_STEP - Math.round(value / FX16_STEP)) > 1e-6) violations.push({ path: fieldPath, value, range: false });
  }
  return violations;
}

function checkExpectations(
  scriptText: string,
  loadSpas: Set<number>,
  backgrounds: Set<number>,
  maxLoadedSpas: number,
  maxTemporaryEmitters: number,
  maxConcurrentParticles: number,
  expectations: MoveAnimationManifestExpectation,
  issues: MoveAnimationLintIssue[],
): void {
  for (const spaId of expectations.loadSpas ?? []) if (!loadSpas.has(spaId)) issues.push({ severity: "error", code: "expected-spa", message: `Expected LoadSPA ${spaId}, but it is absent.` });
  for (const spaId of expectations.forbidSpas ?? []) if (loadSpas.has(spaId)) issues.push({ severity: "error", code: "forbidden-spa", message: `Forbidden LoadSPA ${spaId} is present.` });
  for (const background of expectations.backgrounds ?? []) if (!backgrounds.has(background)) issues.push({ severity: "error", code: "expected-background", message: `Expected LoadBackground ${background}, but it is absent.` });
  for (const text of expectations.text ?? []) if (!scriptText.includes(text)) issues.push({ severity: "error", code: "expected-text", message: `Expected script text is absent: ${text}` });
  if (expectations.maxLoadedSpas !== undefined && maxLoadedSpas > expectations.maxLoadedSpas) issues.push({ severity: "error", code: "manifest-loaded-spa-limit", message: `Peak loaded SPA count ${maxLoadedSpas} exceeds manifest maximum ${expectations.maxLoadedSpas}.` });
  if (expectations.maxTemporaryEmitters !== undefined && maxTemporaryEmitters > expectations.maxTemporaryEmitters) issues.push({ severity: "error", code: "manifest-temp-limit", message: `Peak temporary emitter count ${maxTemporaryEmitters} exceeds manifest maximum ${expectations.maxTemporaryEmitters}.` });
  if (expectations.maxConcurrentParticles !== undefined && maxConcurrentParticles > expectations.maxConcurrentParticles) issues.push({ severity: "error", code: "manifest-particle-limit", message: `Estimated peak particle count ${maxConcurrentParticles} exceeds manifest maximum ${expectations.maxConcurrentParticles}.` });
}

function updateSpriteLifecycle(command: ParsedMoveAnimationCommand, sprites: Map<number, SpriteLifecycle>): void {
  if (!["DistortSprite", "FreezeSprite", "ChangeVisibility", "PokemonShadowVanish"].includes(command.name)) return;
  const selector = command.params[0] ?? -1;
  if (command.name === "ChangeVisibility" && (command.params[1] ?? 0) === 5) {
    for (const state of sprites.values()) state.hidden = false;
    return;
  }
  const state = sprites.get(selector) ?? { scaleX: 4096, scaleY: 4096, hidden: false, freeze: false, shadowHidden: false };
  if (command.name === "DistortSprite") {
    const mode = command.params[1] ?? 0;
    if (mode === 0 || mode === 1 || mode === 4) {
      state.scaleX = command.params[2] ?? 0;
      state.scaleY = command.params[3] ?? 0;
      if (state.scaleX === 0 || state.scaleY === 0) {
        // The caller emits the final dirty-state error too; this marker makes the suspicious reset immediately visible.
        state.scaleX = command.params[2] ?? 0;
      }
    }
  } else if (command.name === "FreezeSprite") state.freeze = (command.params[1] ?? 0) !== 0;
  else if (command.name === "PokemonShadowVanish") state.shadowHidden = (command.params[1] ?? 0) !== 0;
  else {
    const flag = command.params[1] ?? 0;
    if (flag === 0 || flag === 3) state.hidden = true;
    else if (flag === 1 || flag === 4) state.hidden = false;
    else if (flag === 2) state.hidden = !state.hidden;
  }
  sprites.set(selector, state);
}

function commandLifeMultiplier(command: ParsedMoveAnimationCommand): number {
  const lifeIndex = command.name === "DoSPAAllAnimations" ? 7
    : command.name === "DoSPAProjectileAnimation2" || command.name === "DoSPAProjectileAnimationOrthoCoordinate" ? 10
      : command.name === "DoSPACircleAnimation" || command.name === "DoSPAOrthoCircleAnimation" ? -1
        : command.name === "DoSPAScreenAnimation" ? 12
          : 8;
  if (lifeIndex < 0) return 1;
  const raw = command.params[lifeIndex] ?? 4096;
  return raw === 0 ? 1 : raw / 4096;
}

function temporaryEmitterDuration(command: ParsedMoveAnimationCommand): number {
  if (command.name === "DoSPACircleAnimation" || command.name === "DoSPAOrthoCircleAnimation") {
    const frames = Math.max(1, command.params[6] ?? 1);
    const wait = Math.max(0, command.params[7] ?? 0);
    const count = Math.max(1, command.params[8] ?? 1);
    return Math.max(1, (frames + wait) * count);
  }
  const durationIndex = command.name === "DoSPAProjectileAnimation2" || command.name === "DoSPAProjectileAnimationOrthoCoordinate" ? 8 : 6;
  return Math.max(1, Math.ceil(Math.abs(command.params[durationIndex] ?? 4096) / 4096));
}

function genericTaskDuration(command: ParsedMoveAnimationCommand): number {
  if (command.name === "MoveCamera") return Math.max(0, (command.params[2] ?? 0) + (command.params[3] ?? 0));
  if (command.name === "AdjustCamera") return Math.max(0, (command.params[7] ?? 0) + (command.params[8] ?? 0));
  if (["ShakeSprite", "DistortSprite", "TiltSprite", "SpriteOpacity", "PokemonMosaic"].includes(command.name)) {
    const frameIndex = command.name === "TiltSprite" ? 3 : command.name === "SpriteOpacity" || command.name === "PokemonMosaic" ? 3 : 4;
    const waitIndex = frameIndex + 1;
    const countIndex = waitIndex + 1;
    const mode = command.params[1] ?? 0;
    const legs = mode === 2 ? 2 : mode === 3 ? 4 : 1;
    return Math.max(0, (command.params[waitIndex] ?? 0) + (command.params[frameIndex] ?? 0) * legs * Math.max(1, command.params[countIndex] ?? 1));
  }
  if (command.name === "ChangeBackgroundColor") return Math.max(0, command.params[3] ?? 0);
  const doc = getMoveAnimationCommandDoc(command.name);
  const frameParam = doc?.params.find((param) => param.name === "frame");
  const waitParam = doc?.params.find((param) => param.name === "wait");
  return Math.max(0, (frameParam ? command.params[frameParam.index] ?? 0 : 0) + (waitParam ? command.params[waitParam.index] ?? 0 : 0));
}

function taskGroup(command: string): number | undefined {
  if (["MoveCamera", "AdjustCamera", "CameraMoveAngle", "ShakeScreen", "CameraProjection", "CameraPosPush"].includes(command)) return 1;
  if (SPA_SPAWN_COMMANDS.has(command)) return 2;
  if (["ShakeSprite", "MoveSprite", "PokemonSineMove", "DistortSprite", "TiltSprite", "SpriteOpacity", "PokemonMosaic", "PokemonBlinkFlag", "ChangeColor"].includes(command)) return 3;
  if (["MoveBackground", "DistortBackground", "BackgroundPaletteAnimation", "BackgroundPriority", "BackgroundAlpha", "ChangeBackgroundColor", "ApplyBackground", "BackgroundVisible"].includes(command)) return 5;
  return undefined;
}

function pruneTasks(tasks: ActiveTask[], frame: number): void {
  for (let index = tasks.length - 1; index >= 0; index -= 1) if ((tasks[index]?.endFrame ?? 0) <= frame) tasks.splice(index, 1);
}

function issue(
  severity: MoveAnimationLintIssue["severity"],
  code: string,
  message: string,
  label: string,
  frame: number,
  command: ParsedMoveAnimationCommand,
  spaId?: number,
  resourceId?: number,
): MoveAnimationLintIssue {
  return { severity, code, message, label, frame, command: command.name, spaId, resourceId };
}

function selectorName(selector: number): string {
  if (selector === 14) return "attacker sprite (selector 14)";
  if (selector === 16) return "defender sprite (selector 16)";
  return `sprite selector ${selector}`;
}

function defaultBackgroundVisibility(background: number): boolean {
  return background === 0 || background === 1;
}

function formatFx(value: number): string {
  return (value / 4096).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array) && !(value instanceof Uint8ClampedArray);
}

function bytesEqual(left: Uint8Array | Uint8ClampedArray, right: Uint8Array | Uint8ClampedArray): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hexBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(value)) throw new Error("Invalid embedded hex byte sequence.");
  return Uint8Array.from({ length: value.length / 2 }, (_unused, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

async function inferGeneratedScript(directory: string, moveId: number): Promise<string | undefined> {
  const generated = path.join(directory, "generated");
  let names: string[];
  try {
    names = await readdir(generated);
  } catch {
    return undefined;
  }
  const prefix = `5_${moveId.toString().padStart(8, "0")}`;
  const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(".s"));
  return matches.length === 1 ? path.join(generated, matches[0] ?? "") : undefined;
}

export function parseSpaBytes(bytes: Uint8Array): SpaArchive {
  return parseSpaArchive(bytes);
}
