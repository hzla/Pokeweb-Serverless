import { getMoveAnimationCommandDoc } from "./moveAnimationDocumentation";
import { parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "./moveAnimationModel";
import type { SpaArchive, SpaResource, SpaTexture } from "./nitroSpa";

export type MoveAnimationAnalysisEvent = {
  label: string;
  frame: number;
  command: string;
  params: number[];
  category: string;
  boundary: "Script" | "SPA" | "Both";
  summary: string;
};

export type MoveAnimationScriptAnalysis = {
  ok: boolean;
  commandCount: number;
  labels: string[];
  loadedSpaIds: number[];
  spawnedSpaEvents: Array<{ frame: number; command: string; spaId: number; resourceId?: number; label: string }>;
  backgrounds: Array<{ frame: number; command: string; backgroundId?: number; label: string }>;
  sounds: Array<{ frame: number; command: string; soundId?: number; label: string }>;
  spriteCommands: MoveAnimationAnalysisEvent[];
  cameraCommands: MoveAnimationAnalysisEvent[];
  waitCommands: Array<{ frame: number; frames: number; label: string }>;
  warnings: string[];
  events: MoveAnimationAnalysisEvent[];
};

export type SpaDiagnosticSeverity = "info" | "warning";

export type SpaDiagnostic = {
  severity: SpaDiagnosticSeverity;
  title: string;
  detail: string;
  field: string;
};

export type SpaArchiveDiagnosticReport = {
  spaId?: number;
  resourceCount: number;
  textureCount: number;
  archiveWarnings: string[];
  selectedResourceDiagnostics: SpaDiagnostic[];
  archiveDiagnostics: SpaDiagnostic[];
  textureDiagnostics: SpaDiagnostic[];
};

const SPA_COMMANDS = new Set([
  "LoadSPA",
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAAllAnimations",
  "DeleteSPA",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation",
  "DoSPAOrthoCircleAnimation",
]);

const SPA_SPAWN_COMMANDS = new Set([...SPA_COMMANDS].filter((command) => command !== "LoadSPA" && command !== "DeleteSPA"));
const BACKGROUND_COMMANDS = new Set(["LoadBackground", "MoveBackground", "DistortBackground", "BackgroundPaletteAnimation", "BackgroundPriority", "BackgroundAlpha", "ChangeBackgroundColor", "ApplyBackground"]);
const SOUND_COMMANDS = new Set(["PlaySound", "StopSound", "SwitchAudioSide", "AdjustSound", "AudioContainer", "PlayPokemonCry"]);
const SPRITE_COMMANDS = new Set([
  "ShakeSprite",
  "MoveSprite",
  "PokemonSineMove",
  "DistortSprite",
  "TiltSprite",
  "SpriteOpacity",
  "PokemonMosaic",
  "PokemonBlinkFlag",
  "FreezeSprite",
  "ChangeColor",
  "ChangeVisibility",
  "PokemonShadowVanish",
  "PokemonShadowScale",
  "DeletePokemon",
  "Transform",
]);
const CAMERA_COMMANDS = new Set(["MoveCamera", "AdjustCamera", "CameraMoveAngle", "ShakeScreen", "CameraProjection", "CameraPosPush"]);

export function analyzeMoveAnimationScript(scriptText: string): MoveAnimationScriptAnalysis {
  const analysis: MoveAnimationScriptAnalysis = {
    ok: true,
    commandCount: 0,
    labels: [],
    loadedSpaIds: [],
    spawnedSpaEvents: [],
    backgrounds: [],
    sounds: [],
    spriteCommands: [],
    cameraCommands: [],
    waitCommands: [],
    warnings: [],
    events: [],
  };

  let parsed;
  try {
    parsed = parseMoveAnimationScript(scriptText);
  } catch (error) {
    return {
      ...analysis,
      ok: false,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }

  const loadedSpaIds = new Set<number>();
  analysis.labels = parsed.labelOrder.slice();
  for (const label of parsed.labelOrder) {
    const commands = parsed.scripts.get(label) ?? [];
    let frame = 0;
    for (const command of commands) {
      analysis.commandCount += 1;
      const event = commandEvent(label, frame, command);
      analysis.events.push(event);

      if (command.name === "Wait") {
        const frames = Math.max(0, command.params[0] ?? 0);
        analysis.waitCommands.push({ frame, frames, label });
        frame += frames;
        continue;
      }

      if (command.name === "LoadSPA") {
        const spaId = command.params[0] ?? 0;
        loadedSpaIds.add(spaId);
      } else if (SPA_SPAWN_COMMANDS.has(command.name)) {
        const spaId = command.params[0] ?? 0;
        const resourceId = command.name === "DoSPAAllAnimations" ? undefined : command.params[1];
        analysis.spawnedSpaEvents.push({ frame, command: command.name, spaId, resourceId, label });
        if (!loadedSpaIds.has(spaId)) analysis.warnings.push(`${label} frame ${frame}: ${command.name} references SPA ${spaId} before LoadSPA.`);
      } else if (command.name === "DeleteSPA") {
        const spaId = command.params[0] ?? 0;
        if (!loadedSpaIds.has(spaId)) analysis.warnings.push(`${label} frame ${frame}: DeleteSPA references SPA ${spaId} before LoadSPA.`);
      }

      if (BACKGROUND_COMMANDS.has(command.name)) {
        analysis.backgrounds.push({ frame, command: command.name, backgroundId: command.params[0], label });
      }
      if (SOUND_COMMANDS.has(command.name)) {
        analysis.sounds.push({ frame, command: command.name, soundId: soundIdForCommand(command), label });
      }
      if (SPRITE_COMMANDS.has(command.name)) analysis.spriteCommands.push(event);
      if (CAMERA_COMMANDS.has(command.name)) analysis.cameraCommands.push(event);
    }
  }

  analysis.loadedSpaIds = [...loadedSpaIds].sort((a, b) => a - b);
  return analysis;
}

function commandEvent(label: string, frame: number, command: ParsedMoveAnimationCommand): MoveAnimationAnalysisEvent {
  const doc = getMoveAnimationCommandDoc(command.name);
  return {
    label,
    frame,
    command: command.name,
    params: command.params.slice(),
    category: doc?.category ?? commandCategory(command.name),
    boundary: commandBoundary(command.name),
    summary: commandSummary(command),
  };
}

function commandCategory(commandName: string): string {
  if (SPA_COMMANDS.has(commandName)) return "Particles";
  if (BACKGROUND_COMMANDS.has(commandName)) return "Background";
  if (SOUND_COMMANDS.has(commandName)) return "Sound";
  if (SPRITE_COMMANDS.has(commandName)) return "Sprite";
  if (CAMERA_COMMANDS.has(commandName)) return "Camera";
  if (commandName === "Wait" || commandName === "LetCMDsFinish") return "Timing";
  return "Flow";
}

function commandBoundary(commandName: string): "Script" | "SPA" | "Both" {
  if (SPA_SPAWN_COMMANDS.has(commandName)) return "Both";
  if (commandName === "LoadSPA" || commandName === "DeleteSPA") return "SPA";
  return "Script";
}

function commandSummary(command: ParsedMoveAnimationCommand): string {
  if (command.name === "LoadSPA") return `Loads SPA ${command.params[0] ?? 0}.`;
  if (SPA_SPAWN_COMMANDS.has(command.name)) {
    const spaId = command.params[0] ?? 0;
    const resourceId = command.name === "DoSPAAllAnimations" ? "all resources" : `resource ${command.params[1] ?? 0}`;
    return `Spawns ${resourceId} from SPA ${spaId}; visual shape, texture, color curves, and behavior live in the SPA.`;
  }
  if (command.name === "LoadBackground") return `Loads background ${command.params[0] ?? 0}.`;
  if (command.name === "PlaySound") return `Plays sound ${command.params[0] ?? 0}.`;
  if (command.name === "Wait") return `Waits ${command.params[0] ?? 0} frame(s).`;
  return getMoveAnimationCommandDoc(command.name)?.description ?? `${command.name} command.`;
}

function soundIdForCommand(command: ParsedMoveAnimationCommand): number | undefined {
  if (command.name === "PlaySound" || command.name === "StopSound" || command.name === "AdjustSound" || command.name === "AudioContainer") return command.params[0];
  if (command.name === "PlayPokemonCry") return command.params[0];
  return undefined;
}

export function analyzeSpaArchive(archive: SpaArchive, options: { spaId?: number; selectedResourceIndex?: number } = {}): SpaArchiveDiagnosticReport {
  const selected = archive.resources[options.selectedResourceIndex ?? 0] ?? archive.resources[0];
  return {
    spaId: options.spaId,
    resourceCount: archive.resources.length,
    textureCount: archive.textures.length,
    archiveWarnings: archive.warnings.map((warning) => warning.message),
    selectedResourceDiagnostics: selected ? analyzeSpaResource(selected, archive) : [],
    archiveDiagnostics: analyzeArchiveResources(archive),
    textureDiagnostics: analyzeTextures(archive.textures),
  };
}

function analyzeArchiveResources(archive: SpaArchive): SpaDiagnostic[] {
  const diagnostics: SpaDiagnostic[] = [];
  const delayed = archive.resources.filter((resource) => resource.startDelayFrames > 0);
  const children = archive.resources.filter((resource) => resource.childResource);
  const behaviors = archive.resources.filter((resource) => resource.behaviors.length > 0);
  const colorCurves = archive.resources.filter((resource) => resource.colorAnim);
  const scaleCurves = archive.resources.filter((resource) => resource.scaleAnim);
  const alphaCurves = archive.resources.filter((resource) => resource.alphaAnim);
  if (delayed.length) diagnostics.push(info("Start delays present", `Emitter(s) ${listResourceIndexes(delayed)} wait before spawning. Donor delays can make copied effects appear late.`, "resource.startDelayFrames"));
  if (children.length) diagnostics.push(info("Child resources present", `Emitter(s) ${listResourceIndexes(children)} spawn secondary particles. Check child texture/color/alpha before recoloring.`, "resource.childResource"));
  if (behaviors.length) diagnostics.push(info("Behaviors present", `Emitter(s) ${listResourceIndexes(behaviors)} use forces or collision behavior. Remove donor bounce/spin/convergence when it conflicts with the new effect.`, "resource.behaviors"));
  if (colorCurves.length) diagnostics.push(warning("Color curves present", `Emitter(s) ${listResourceIndexes(colorCurves)} animate color. Replace these curves when shifting donor particles into a new palette.`, "resource.colorAnim"));
  if (scaleCurves.length) diagnostics.push(info("Scale curves present", `Emitter(s) ${listResourceIndexes(scaleCurves)} animate size. These can hide script-side projectile scale changes.`, "resource.scaleAnim"));
  if (alphaCurves.length) diagnostics.push(info("Alpha curves present", `Emitter(s) ${listResourceIndexes(alphaCurves)} animate opacity. These can cause flicker or perceived color shifts.`, "resource.alphaAnim"));
  return diagnostics;
}

function analyzeSpaResource(resource: SpaResource, archive: SpaArchive): SpaDiagnostic[] {
  const diagnostics: SpaDiagnostic[] = [];
  if (!isWhite(resource.color)) diagnostics.push(warning("Emitter tint is not white", `Base color is ${formatColor(resource.color)}. This multiplies texture pixels and can leak donor color.`, "resource.color"));
  if (resource.colorAnim) diagnostics.push(warning("Color animation curve", "This emitter changes color over particle lifetime. Scrub or replace it for deliberate recolors.", "resource.colorAnim"));
  if (resource.alphaAnim) diagnostics.push(info("Alpha animation curve", `Opacity animates ${formatNumber(resource.alphaAnim.start)} -> ${formatNumber(resource.alphaAnim.mid)} -> ${formatNumber(resource.alphaAnim.end)}.`, "resource.alphaAnim"));
  if (resource.scaleAnim) diagnostics.push(info("Scale animation curve", `Scale animates ${formatNumber(resource.scaleAnim.start)} -> ${formatNumber(resource.scaleAnim.mid)} -> ${formatNumber(resource.scaleAnim.end)} on top of base scale ${formatNumber(resource.baseScale)}.`, "resource.scaleAnim"));
  if (resource.texAnim) diagnostics.push(info("Texture animation", `Cycles through texture(s) ${resource.texAnim.textures.slice(0, resource.texAnim.textureCount).join(", ")}. Check frame references after adding/removing textures.`, "resource.texAnim"));
  if (resource.childResource) {
    const childColor = resource.childResource.useChildColor ? ` with color ${formatColor(resource.childResource.color)}` : "";
    diagnostics.push(info("Child particle resource", `Spawns child texture ${resource.childResource.textureIndex}${childColor}. Child particles often explain unexpected duplicate glows/circles.`, "resource.childResource"));
  }
  if (resource.behaviors.length) diagnostics.push(info("Particle behaviors", `Uses ${resource.behaviors.map((behavior) => behavior.type).join(", ")} behavior. Verify donor motion/collision still fits the new animation.`, "resource.behaviors"));
  if (resource.startDelayFrames > 0) diagnostics.push(info("Delayed emitter start", `Starts after ${resource.startDelayFrames} frame(s).`, "resource.startDelayFrames"));
  if (resource.baseScale !== 1 || resource.aspectRatio !== 1) diagnostics.push(info("Baked size data", `Base scale ${formatNumber(resource.baseScale)}, aspect ratio ${formatNumber(resource.aspectRatio)}. This may matter more than script scale parameters.`, "resource.baseScale"));
  if (resource.radius !== 0 || resource.length !== 0) diagnostics.push(info("Spawn volume", `Radius ${formatNumber(resource.radius)}, length ${formatNumber(resource.length)}. Donor spawn volumes affect placement even when script coordinates are correct.`, "resource.radius"));
  if (resource.randomInitAngle || resource.hasRotation || resource.minRotation !== 0 || resource.maxRotation !== 0) diagnostics.push(info("Rotation/random angle", "Particles rotate or start at randomized angles. Good for sparks, risky for precise icons/projectiles.", "resource.initAngle"));
  if (resource.textureIndex < 0 || resource.textureIndex >= archive.textures.length) diagnostics.push(warning("Texture reference out of range", `Emitter references texture ${resource.textureIndex}, but the SPA has ${archive.textures.length} texture(s).`, "resource.textureIndex"));
  return diagnostics;
}

function analyzeTextures(textures: SpaTexture[]): SpaDiagnostic[] {
  const diagnostics: SpaDiagnostic[] = [];
  for (const texture of textures) {
    if (texture.fallback) diagnostics.push(warning(`Texture ${texture.index} fallback`, texture.fallbackReason ?? "Texture could not be decoded completely.", `texture.${texture.index}`));
    if (texture.format !== 1 && texture.format !== 6 && texture.format !== 7) {
      diagnostics.push(info(`Texture ${texture.index} uses legacy format ${texture.format}`, "The editor can preview it, but replacing edited images is safest as Direct Color, A5I3, or A3I5.", `texture.${texture.index}.format`));
    }
    if (!isPowerOfTwo(texture.width) || !isPowerOfTwo(texture.height)) diagnostics.push(warning(`Texture ${texture.index} dimensions`, `${texture.width}x${texture.height} is not power-of-two; DS SPA serialization expects power-of-two dimensions.`, `texture.${texture.index}.size`));
  }
  return diagnostics;
}

function info(title: string, detail: string, field: string): SpaDiagnostic {
  return { severity: "info", title, detail, field };
}

function warning(title: string, detail: string, field: string): SpaDiagnostic {
  return { severity: "warning", title, detail, field };
}

function isWhite(color: [number, number, number]): boolean {
  return color.every((component) => Math.abs(component - 1) < 0.01);
}

function formatColor(color: [number, number, number]): string {
  return `#${color.map((component) => Math.round(Math.max(0, Math.min(1, component)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function listResourceIndexes(resources: SpaResource[]): string {
  return resources.map((resource) => resource.index).join(", ");
}

function isPowerOfTwo(value: number): boolean {
  return value >= 8 && value <= 1024 && (value & (value - 1)) === 0;
}
