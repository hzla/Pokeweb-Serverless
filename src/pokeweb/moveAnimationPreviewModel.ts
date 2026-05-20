import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import { cameraEventDuration } from "./battleCameraSimulator";
import { decompileMoveAnimationFile, parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "./moveAnimationModel";
import { parseNitroBackground, type NitroBackgroundImage, type NitroBackgroundPaletteAnimation } from "./nitroBg";
import type { NitroCellEffect } from "./nitroCell";
import { parseSpaArchive, type SpaArchive } from "./nitroSpa";

const DEFAULT_CALL_DEPTH = 8;
const MOVE_SPA_PATH = "a/0/0/6";
const MOVE_BACKGROUND_GRAPHICS_PATH = "a/0/9/4";

const SPA_COMMANDS = new Set([
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPACircleAnimation",
]);

const MARKER_COMMANDS = new Set(["MoveCamera", "AdjustCamera", "ShakeScreen", "ShakeSprite", "CallMoveAnimation", "TerminateMoveScript"]);
const BACKGROUND_RENDER_COMMANDS = new Set(["MoveBackground", "BackgroundAlpha", "ChangeBackgroundColor", "ApplyBackground"]);
const BACKGROUND_MARKER_COMMANDS = new Set(["DistortBackground", "BackgroundPaletteAnimation", "BackgroundPriority"]);
const CAMERA_COMMANDS = new Set(["MoveCamera", "AdjustCamera", "CameraMoveAngle", "CameraProjection", "CameraPosPush", "ShakeScreen"]);
const WAIT_FOR_PENDING_COMMANDS = new Set(["LetCMDsFinish"]);

export type MoveAnimationTimelineEvent = {
  id: string;
  frame: number;
  label: string;
  command: string;
  params: number[];
  status: "supported" | "marker" | "unsupported";
  message: string;
  effectKind?: "spa" | "cell";
  spaId?: number;
  resourceId?: number;
  particle?: {
    sourceTarget?: number;
    destinationTarget?: number;
    origin?: [number, number, number];
    axis?: [number, number, number];
    projectile?: boolean;
    screen?: boolean;
    screenPlane?: boolean;
    lifeMultiplier?: number;
    scaleMultiplier?: number;
    speedMultiplier?: number;
    radiusMultiplier?: number;
    foreshorten?: boolean;
    screenRotation?: number;
    originMotion?: {
      from: [number, number, number];
      to: [number, number, number];
      duration: number;
      arcHeight?: number;
      easing?: "linear" | "easeOut";
      rotation?: {
        startAngleX: number;
        endAngleX: number;
        startAngleY: number;
        endAngleY: number;
        radiusX: number;
        radiusY: number;
      };
    };
    emissionOffsets?: [number, number, number][];
    forceFollowMotion?: boolean;
    useResourceAnchor?: boolean;
    invertResourceYAxis?: boolean;
    alignToMotion?: boolean;
    alignDirection?: [number, number, number];
    alignRotationOffset?: number;
    beamTrail?: {
      start: [number, number, number];
      alpha?: number;
      scale?: number;
    };
    field?: {
      mode?: number;
      targetMode?: number;
      cursor?: number;
      gravityMagnitude?: [number, number, number];
      randomMagnitude?: [number, number, number];
      randomIntervalFrames?: number;
      magnetTarget?: [number, number, number];
      magnetForce?: number;
      convergenceTarget?: [number, number, number];
      convergenceForce?: number;
    };
  };
  textureIndex?: number;
  textureFormat?: number;
  textureSize?: number;
  paletteSize?: number;
  paletteIndexSize?: number;
  fallbackReason?: string;
  debug?: string;
  sourceMoveId?: number;
  backgroundId?: number;
  backgroundEffect?: "hgDiagonalBeam";
  backgroundFrameIndex?: number;
  actorMotion?: {
    target: "user" | "target";
    offset: [number, number, number];
    duration: number;
    easing?: "linear" | "easeOut";
  };
  cellEffectId?: string;
  cellEffect?: {
    charId: number;
    paletteId: number;
    cellId: number;
    animationId: number;
    supportFuncId: number;
    origin?: [number, number, number];
    scale?: number;
    duration?: number;
    instances?: Array<{
      offset: [number, number, number];
      startFrame?: number;
      blinkInterval?: number;
    }>;
    motion?: {
      legs: Array<{
        from: [number, number, number];
        to: [number, number, number];
        duration: number;
        arcHeight?: number;
      }>;
    };
  };
};

export type MoveAnimationPreviewWarning = {
  frame?: number;
  command?: string;
  message: string;
};

export type MoveAnimationPreview = {
  moveId: number;
  frameCount: number;
  rootLabel: string;
  spaIds: number[];
  timeline: MoveAnimationTimelineEvent[];
  spaArchives: Map<number, SpaArchive>;
  backgrounds: Map<number, NitroBackgroundImage>;
  cellEffects?: Map<string, NitroCellEffect>;
  backgroundPaletteAnimations?: Map<number, NitroBackgroundPaletteAnimation>;
  warnings: MoveAnimationPreviewWarning[];
};

export type MoveAnimationPreviewOptions = {
  maxCallDepth?: number;
  loadSpaArchive?: (project: ProjectState, spaId: number) => Promise<SpaArchive>;
  loadBackground?: (project: ProjectState, backgroundId: number) => Promise<NitroBackgroundImage>;
};

const projectSpaCache = new WeakMap<ProjectState, Map<number, Promise<SpaArchive>>>();
const projectBackgroundCache = new WeakMap<ProjectState, Map<number, Promise<NitroBackgroundImage>>>();

export async function buildMoveAnimationPreview(
  project: ProjectState,
  moveId: number,
  scriptText: string,
  options: MoveAnimationPreviewOptions = {},
): Promise<MoveAnimationPreview> {
  const maxCallDepth = options.maxCallDepth ?? DEFAULT_CALL_DEPTH;
  const parsed = parseMoveAnimationScript(scriptText);
  const rootLabel = parsed.headerLabels[0] ?? parsed.labelOrder[0];
  if (!rootLabel) throw new Error("Animation script has no previewable script label");

  const warnings: MoveAnimationPreviewWarning[] = [];
  const timeline: MoveAnimationTimelineEvent[] = [];
  const loadEvents = new Set<number>();
  const backgroundEvents = new Set<number>();
  expandScript(project, moveId, rootLabel, parsed.scripts.get(rootLabel) ?? [], 0, 0, maxCallDepth, new Set(), timeline, warnings);
  for (const event of timeline) {
    if ((event.command === "LoadSPA" || SPA_COMMANDS.has(event.command)) && event.spaId !== undefined) loadEvents.add(event.spaId);
    if (event.command === "LoadBackground" && event.backgroundId !== undefined) backgroundEvents.add(event.backgroundId);
  }

  const spaArchives = new Map<number, SpaArchive>();
  for (const spaId of [...loadEvents].sort((a, b) => a - b)) {
    try {
      const archive = await (options.loadSpaArchive ?? loadMoveSpaArchive)(project, spaId);
      spaArchives.set(spaId, archive);
      for (const warning of archive.warnings) warnings.push({ message: `SPA ${spaId}: ${warning.message}` });
    } catch (error) {
      warnings.push({ message: `SPA ${spaId}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  hydrateTimelineDebug(timeline, spaArchives, warnings);

  const backgrounds = new Map<number, NitroBackgroundImage>();
  for (const backgroundId of [...backgroundEvents].sort((a, b) => a - b)) {
    try {
      const background = await (options.loadBackground ?? loadMoveBackground)(project, backgroundId);
      backgrounds.set(backgroundId, background);
      for (const warning of background.warnings) warnings.push({ message: `Background ${backgroundId}: ${warning}` });
    } catch (error) {
      warnings.push({ message: `Background ${backgroundId}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return {
    moveId,
    rootLabel,
    timeline,
    spaIds: [...loadEvents].sort((a, b) => a - b),
    spaArchives,
    backgrounds,
    warnings,
    frameCount: Math.max(60, ...timeline.map((event) => event.frame + eventDuration(event))),
  };
}

function hydrateTimelineDebug(
  timeline: MoveAnimationTimelineEvent[],
  spaArchives: Map<number, SpaArchive>,
  warnings: MoveAnimationPreviewWarning[],
): void {
  for (const event of timeline) {
    if ((event.effectKind !== "spa" && !SPA_COMMANDS.has(event.command)) || event.spaId === undefined || event.resourceId === undefined) continue;
    const archive = spaArchives.get(event.spaId);
    const resource = archive?.resources[event.resourceId] ?? archive?.resources[0];
    const texture = resource ? archive?.textures[resource.textureIndex] ?? archive?.textures[0] : archive?.textures[0];
    event.textureIndex = resource?.textureIndex;
    event.textureFormat = texture?.format;
    event.textureSize = texture?.textureSize;
    event.paletteSize = texture?.paletteSize;
    event.paletteIndexSize = texture?.paletteIndexSize;
    event.fallbackReason = texture?.fallback ? texture.fallbackReason ?? "decoded texture fell back" : undefined;
    event.debug = [
      `SPA ${event.spaId}`,
      `resource ${event.resourceId}`,
      `texture ${event.textureIndex ?? "?"}`,
      `format ${event.textureFormat ?? "?"}`,
      `texture bytes ${event.textureSize ?? "?"}`,
      `palette bytes ${event.paletteSize ?? "?"}`,
      `4x4 index bytes ${event.paletteIndexSize ?? "?"}`,
      event.fallbackReason ? `fallback: ${event.fallbackReason}` : "decoded texture",
    ].join(" / ");
    if (!archive) warnings.push({ frame: event.frame, command: event.command, message: `SPA ${event.spaId} was not loaded for event debug` });
    else if (!resource) warnings.push({ frame: event.frame, command: event.command, message: `SPA ${event.spaId} resource ${event.resourceId} is missing; using archive fallback resource` });
  }
}

export async function loadMoveSpaArchive(project: ProjectState, spaId: number): Promise<SpaArchive> {
  let cache = projectSpaCache.get(project);
  if (!cache) {
    cache = new Map();
    projectSpaCache.set(project, cache);
  }
  const cached = cache.get(spaId);
  if (cached) return cached;
  const promise = loadMoveSpaArchiveUncached(project, spaId);
  cache.set(spaId, promise);
  return promise;
}

export function invalidateMoveSpaArchiveCache(project: ProjectState, spaId?: number): void {
  const cache = projectSpaCache.get(project);
  if (!cache) return;
  if (spaId === undefined) cache.clear();
  else cache.delete(spaId);
}

export async function loadMoveBackground(project: ProjectState, backgroundId: number): Promise<NitroBackgroundImage> {
  let cache = projectBackgroundCache.get(project);
  if (!cache) {
    cache = new Map();
    projectBackgroundCache.set(project, cache);
  }
  const cached = cache.get(backgroundId);
  if (cached) return cached;
  const promise = loadMoveBackgroundUncached(project, backgroundId);
  cache.set(backgroundId, promise);
  return promise;
}

function expandScript(
  project: ProjectState,
  moveId: number,
  label: string,
  commands: ParsedMoveAnimationCommand[],
  startFrame: number,
  depth: number,
  maxDepth: number,
  activeCalls: Set<string>,
  timeline: MoveAnimationTimelineEvent[],
  warnings: MoveAnimationPreviewWarning[],
): number {
  let frame = startFrame;
  let pendingUntil = startFrame;
  const loadedSpaIds = new Set<number>();
  for (const command of commands) {
    if (command.name === "Wait") {
      timeline.push(makeEvent(command, frame, "supported", `Wait ${command.params[0] ?? 0} frame(s)`, { sourceMoveId: moveId }));
      frame += Math.max(0, command.params[0] ?? 0);
      pendingUntil = Math.max(pendingUntil, frame);
      continue;
    }

    if (WAIT_FOR_PENDING_COMMANDS.has(command.name)) {
      const event = makeEvent(command, frame, "supported", `${command.name} wait`, { sourceMoveId: moveId });
      timeline.push(event);
      frame = Math.max(frame, pendingUntil);
      continue;
    }

    if (command.name === "LoadSPA") {
      const spaId = convertParticleDatId(command.params[0]);
      loadedSpaIds.add(spaId);
      const event = makeEvent(command, frame, "supported", `Load SPA ${spaId}`, { spaId, sourceMoveId: moveId });
      timeline.push(event);
      pendingUntil = Math.max(pendingUntil, frame + eventDuration(event));
      continue;
    }

    if (SPA_COMMANDS.has(command.name)) {
      const spaId = convertParticleDatId(command.params[0]);
      const resourceId = command.params[1] ?? 0;
      const event = makeEvent(command, frame, "supported", `${command.name} SPA ${spaId} resource ${resourceId}`, {
          spaId,
          resourceId,
          sourceMoveId: moveId,
      });
      timeline.push(event);
      pendingUntil = Math.max(pendingUntil, frame + eventDuration(event));
      if (!loadedSpaIds.has(spaId)) warnings.push({ frame, command: command.name, message: `${command.name} references SPA ${spaId} before LoadSPA registered it` });
      continue;
    }

    if (command.name === "LoadBackground") {
      const backgroundId = command.params[0] ?? 0;
      const event = makeEvent(command, frame, "supported", `Load background ${backgroundId}`, { backgroundId, sourceMoveId: moveId });
      timeline.push(event);
      pendingUntil = Math.max(pendingUntil, frame + eventDuration(event));
      continue;
    }

    if (BACKGROUND_RENDER_COMMANDS.has(command.name)) {
      const event = makeEvent(command, frame, "supported", backgroundEventMessage(command), { sourceMoveId: moveId, backgroundId: command.params[0] });
      timeline.push(event);
      pendingUntil = Math.max(pendingUntil, frame + eventDuration(event));
      continue;
    }

    if (BACKGROUND_MARKER_COMMANDS.has(command.name)) {
      const event = makeEvent(command, frame, "marker", backgroundEventMessage(command), { sourceMoveId: moveId, backgroundId: command.params[0] });
      timeline.push(event);
      pendingUntil = Math.max(pendingUntil, frame + eventDuration(event));
      continue;
    }

    if (CAMERA_COMMANDS.has(command.name)) {
      const event = makeEvent(command, frame, "supported", cameraEventMessage(command), { sourceMoveId: moveId });
      timeline.push(event);
      pendingUntil = Math.max(pendingUntil, frame + eventDuration(event));
      continue;
    }

    if (command.name === "CallMoveAnimation") {
      const calledMoveId = command.params[0] ?? 0;
      timeline.push(makeEvent(command, frame, "marker", `Call move animation ${calledMoveId}`, { sourceMoveId: moveId }));
      const callKey = String(calledMoveId);
      if (depth >= maxDepth) {
        warnings.push({ frame, command: command.name, message: `Call depth limit reached at move animation ${calledMoveId}` });
      } else if (activeCalls.has(callKey)) {
        warnings.push({ frame, command: command.name, message: `Recursive call skipped for move animation ${calledMoveId}` });
      } else {
        try {
          const called = parseMoveAnimationScript(decompileMoveAnimationFile(project, calledMoveId));
          const calledLabel = called.headerLabels[0] ?? called.labelOrder[0];
          if (calledLabel) {
            activeCalls.add(callKey);
            frame = expandScript(project, calledMoveId, calledLabel, called.scripts.get(calledLabel) ?? [], frame, depth + 1, maxDepth, activeCalls, timeline, warnings);
            activeCalls.delete(callKey);
          }
        } catch (error) {
          warnings.push({ frame, command: command.name, message: `Could not follow CallMoveAnimation ${calledMoveId}: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
      break;
    }

    if (MARKER_COMMANDS.has(command.name)) {
      timeline.push(makeEvent(command, frame, "marker", `${command.name} marker`, { sourceMoveId: moveId }));
      if (command.ends) break;
      continue;
    }

    timeline.push(makeEvent(command, frame, "unsupported", `${command.name} is not simulated in the MVP preview`, { sourceMoveId: moveId }));
    warnings.push({ frame, command: command.name, message: `${command.name} is shown as a timeline marker only` });
    if (command.ends) break;
  }
  return frame;
}

function convertParticleDatId(datId: number): number {
  // Ball/capture particle archives can be remapped by battle item state. The
  // browser preview has no battle item context, so the base datID is the most
  // faithful deterministic value here.
  return datId;
}

function makeEvent(
  command: ParsedMoveAnimationCommand,
  frame: number,
  status: MoveAnimationTimelineEvent["status"],
  message: string,
  extra: Partial<MoveAnimationTimelineEvent> = {},
): MoveAnimationTimelineEvent {
  return {
    id: `${extra.sourceMoveId ?? ""}:${command.label}:${frame}:${command.opcode}:${command.params.join("_")}`,
    frame,
    label: command.label,
    command: command.name,
    params: command.params,
    status,
    message,
    ...extra,
  };
}

function eventDuration(event: MoveAnimationTimelineEvent): number {
  if (event.command === "Wait") return Math.max(1, event.params[0] ?? 1);
  if (CAMERA_COMMANDS.has(event.command)) return cameraEventDuration(event);
  if (event.effectKind === "spa" || SPA_COMMANDS.has(event.command)) return 45;
  if (event.command === "MoveBackground" || event.command === "BackgroundAlpha") return Math.max(1, event.params[3] ?? 1, event.params[5] ?? 1);
  if (event.command === "ChangeBackgroundColor") return Math.max(1, event.params[3] ?? 0, Math.abs((event.params[2] ?? 0) - (event.params[1] ?? 0)));
  if (event.command === "ShakeSprite" || event.command === "ShakeScreen") return Math.max(1, event.params[event.params.length - 1] ?? 1);
  return 1;
}

function cameraEventMessage(command: ParsedMoveAnimationCommand): string {
  if (command.name === "MoveCamera") return `Move camera to preset ${command.params[1] ?? 0}`;
  if (command.name === "AdjustCamera") return "Move camera to explicit position";
  if (command.name === "CameraMoveAngle") return `Move camera by angles ${command.params[1] ?? 0}, ${command.params[2] ?? 0}`;
  if (command.name === "CameraProjection") return `Camera projection ${command.params[0] ?? 0}`;
  if (command.name === "CameraPosPush") return "Reset/save camera position";
  if (command.name === "ShakeScreen") return `Shake camera for ${cameraEventDuration({ command: command.name, params: command.params })} frame(s)`;
  return `${command.name} camera`;
}

function backgroundEventMessage(command: ParsedMoveAnimationCommand): string {
  if (command.name === "MoveBackground") return `Move background by ${command.params[1] ?? 0}, ${command.params[2] ?? 0}`;
  if (command.name === "DistortBackground") return `Raster background scroll type ${command.params[0] ?? 0}`;
  if (command.name === "BackgroundPaletteAnimation") return `Background palette animation ${command.params[0] ?? 0}`;
  if (command.name === "BackgroundPriority") return `Background priority ${command.params[0] ?? 0}`;
  if (command.name === "BackgroundAlpha") return `Background alpha ${command.params[2] ?? 0}`;
  if (command.name === "ChangeBackgroundColor") return `Background palette fade to ${formatRgb(command.params)}`;
  if (command.name === "ApplyBackground") return `${(command.params[1] ?? 0) === 0 ? "Show" : "Hide"} background layer ${command.params[0] ?? 0}`;
  return `${command.name} marker`;
}

function formatRgb(params: number[]): string {
  const packed = params[4] ?? 0;
  const [r, g, b] = params.length >= 7 ? [params[4] ?? 0, params[5] ?? 0, params[6] ?? 0] : [packed & 0x1f, (packed >>> 5) & 0x1f, (packed >>> 10) & 0x1f];
  return `rgb555(${r}, ${g}, ${b})`;
}

async function loadMoveSpaArchiveUncached(project: ProjectState, spaId: number): Promise<SpaArchive> {
  const loadedStore = project.narcs.move_spas;
  if (loadedStore) {
    const bytes = loadedStore.rawFiles[spaId];
    if (!bytes) throw new Error(`Move SPA ${spaId} does not exist in the loaded move_spas NARC`);
    return parseSpaArchive(bytes);
  }

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Original ROM bytes are unavailable. Reload the ROM to preview move particles.");
  const rom = new NintendoDSRom(romBytes);
  const narc = new NARC(rom.getFileByName(MOVE_SPA_PATH));
  const bytes = narc.files[spaId];
  if (!bytes) throw new Error(`Move SPA ${spaId} does not exist in ${MOVE_SPA_PATH}`);
  return parseSpaArchive(bytes);
}

async function loadMoveBackgroundUncached(project: ProjectState, backgroundId: number): Promise<NitroBackgroundImage> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Original ROM bytes are unavailable. Reload the ROM to preview move backgrounds.");
  const rom = new NintendoDSRom(romBytes);
  const narc = new NARC(rom.getFileByName(MOVE_BACKGROUND_GRAPHICS_PATH));
  const screen = narc.files[backgroundId];
  const characters = narc.files[backgroundId + 1];
  const palette = narc.files[backgroundId + 2];
  if (!screen || !characters || !palette) throw new Error(`Move background ${backgroundId} is missing its screen/character/palette files in ${MOVE_BACKGROUND_GRAPHICS_PATH}`);
  return parseNitroBackground(backgroundId, screen, characters, palette, { transparentIndexZero: true });
}
