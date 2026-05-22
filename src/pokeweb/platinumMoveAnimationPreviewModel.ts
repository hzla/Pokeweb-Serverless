import { CENTER_BATTLE_ANCHOR, TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "./battlePreviewAnchors";
import { NARC } from "../nds/narc";
import {
  compilePlatinumMoveAnimationScript,
  parsePlatinumMoveAnimationBinary,
  type ParsedPlatinumMoveAnimationCommand,
  type PlatinumMoveAnimationRom,
} from "./platinumMoveAnimationModel";
import { parseNitroBackground, type NitroBackgroundImage } from "./nitroBg";
import { parseSpaArchive, type SpaArchive } from "./nitroSpa";
import type { MoveAnimationPreview, MoveAnimationPreviewWarning, MoveAnimationTimelineEvent } from "./moveAnimationPreviewModel";
import { decompressNitro } from "./pokemonSpriteModel";

const DEFAULT_MAX_STEPS = 4096;
const DEFAULT_MAX_CALL_DEPTH = 16;
const PARTICLE_EVENT_DURATION = 45;
const LOAD_PARTICLE_DELAY = 2;
const BACKGROUND_EVENT_DURATION = 12;
const PLATINUM_BATTLE_BG_PATH = "battle/graphic/pl_batt_bg.narc";
const BATTLE_ANIM_VAR_BG_MOVE_STEP_X = 0;
const BATTLE_ANIM_VAR_BG_MOVE_STEP_Y = 1;
const BATTLE_ANIM_VAR_BG_MOVE_START_X = 2;
const BATTLE_ANIM_VAR_BG_MOVE_START_Y = 3;
const BATTLE_ANIM_VAR_BG_SCREEN_MODE = 7;
const BATTLE_BG_SCREEN_REVERSE_DEFAULT = 2;
const BATTLE_BG_SCREEN_REVERSE_NEVER = 0;
const BATTLE_BG_SWITCH_FLAG_MOVE = 0x02;
const BATTLE_BG_SWITCH_FLAG_STOP = 0x04;

export type PlatinumMoveAnimationPreviewScenario = {
  attackerSide: "player" | "opponent";
  checkturn: 0 | 1;
  weatherIndex: number;
  contest: boolean;
  playerAttack: boolean;
  maxSteps?: number;
  maxCallDepth?: number;
};

export const DEFAULT_PLATINUM_MOVE_ANIMATION_PREVIEW_SCENARIO: PlatinumMoveAnimationPreviewScenario = {
  attackerSide: "player",
  checkturn: 0,
  weatherIndex: 0,
  contest: false,
  playerAttack: false,
};

type Vec3 = [number, number, number];

type ParticleSystemState = {
  spaId: number;
  projection?: number;
  flipY?: boolean;
};

type EmitterPlacement = {
  origin: Vec3;
  destination: Vec3;
  sourceTarget: number;
  destinationTarget: number;
  projectile: boolean;
  supported: boolean;
  message: string;
};

type VmState = {
  commands: ParsedPlatinumMoveAnimationCommand[];
  commandIndexByOffset: Map<number, number>;
  frame: number;
  pendingUntil: number;
  pc: number;
  callStack: number[];
  loopStack: Array<{ startPc: number; remaining: number }>;
  vars: number[];
  particleSystems: Map<number, ParticleSystemState>;
  lastExtraParams: number[];
  activeBackgroundId?: number;
  backgroundMoveActive: boolean;
  timeline: MoveAnimationTimelineEvent[];
  warnings: MoveAnimationPreviewWarning[];
  scenario: PlatinumMoveAnimationPreviewScenario;
  fileId: number;
};

export async function buildPlatinumMoveAnimationPreview(
  state: PlatinumMoveAnimationRom,
  fileId: number,
  scriptText: string,
  scenario: PlatinumMoveAnimationPreviewScenario = DEFAULT_PLATINUM_MOVE_ANIMATION_PREVIEW_SCENARIO,
): Promise<MoveAnimationPreview> {
  const bytes = compilePlatinumMoveAnimationScript(scriptText, { archiveKind: "move", fileId });
  const commands = parsePlatinumMoveAnimationBinary(bytes);
  const warnings: MoveAnimationPreviewWarning[] = [];
  const timeline = executePlatinumAnimation(commands, fileId, { ...DEFAULT_PLATINUM_MOVE_ANIMATION_PREVIEW_SCENARIO, ...scenario }, warnings);
  const spaIds = uniqueSorted(
    timeline.flatMap((event) => (event.spaId === undefined ? [] : [event.spaId])),
  );
  const spaArchives = new Map<number, SpaArchive>();
  for (const spaId of spaIds) {
    try {
      const spaBytes = state.archives.spa.narc.files[spaId];
      if (!spaBytes) throw new Error(`Platinum particle SPA ${spaId} does not exist in ${state.archives.spa.path}`);
      const archive = parseSpaArchive(spaBytes);
      spaArchives.set(spaId, archive);
      for (const warning of archive.warnings) warnings.push({ message: `SPA ${spaId}: ${warning.message}` });
    } catch (error) {
      warnings.push({ message: `SPA ${spaId}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  hydratePlatinumTimelineDebug(timeline, spaArchives, warnings);

  const backgroundIds = uniqueSorted(timeline.flatMap((event) => (event.command === "LoadBackground" && event.backgroundId !== undefined ? [event.backgroundId] : [])));
  const backgrounds = new Map<number, NitroBackgroundImage>();
  for (const backgroundId of backgroundIds) {
    try {
      const background = loadPlatinumMoveBackground(state, backgroundId);
      backgrounds.set(backgroundId, background);
      for (const warning of background.warnings) warnings.push({ message: `Background ${backgroundId}: ${warning}` });
    } catch (error) {
      warnings.push({ message: `Background ${backgroundId}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return {
    moveId: fileId,
    rootLabel: `pt_we_${String(fileId).padStart(3, "0")}`,
    timeline,
    spaIds,
    spaArchives,
    backgrounds,
    cellEffects: new Map(),
    backgroundPaletteAnimations: new Map(),
    warnings,
    frameCount: Math.max(60, ...timeline.map((event) => event.frame + platinumEventDuration(event))),
  };
}

function executePlatinumAnimation(
  commands: ParsedPlatinumMoveAnimationCommand[],
  fileId: number,
  scenario: PlatinumMoveAnimationPreviewScenario,
  warnings: MoveAnimationPreviewWarning[],
): MoveAnimationTimelineEvent[] {
  const vm: VmState = {
    commands,
    commandIndexByOffset: new Map(commands.map((command, index) => [command.offset, index])),
    frame: 0,
    pendingUntil: 0,
    pc: 0,
    callStack: [],
    loopStack: [],
    vars: Array.from({ length: 10 }, () => 0),
    particleSystems: new Map(),
    lastExtraParams: [],
    backgroundMoveActive: false,
    timeline: [],
    warnings,
    scenario,
    fileId,
  };
  const maxSteps = scenario.maxSteps ?? DEFAULT_MAX_STEPS;
  for (let step = 0; step < maxSteps && vm.pc >= 0 && vm.pc < commands.length; step += 1) {
    const command = commands[vm.pc];
    const nextPc = runCommand(vm, command);
    if (nextPc === -1) {
      vm.pc = -1;
      break;
    }
    vm.pc = nextPc;
  }
  if (vm.pc >= 0 && vm.pc < commands.length) warnings.push({ frame: vm.frame, message: `Preview stopped after ${maxSteps} VM step(s); possible loop or recursion` });
  return vm.timeline;
}

function runCommand(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): number {
  const name = command.name.toLowerCase();
  const nextPc = vm.pc + 1;
  switch (name) {
    case "delay": {
      const frames = Math.max(0, command.params[0] ?? 0);
      vm.timeline.push(makePlatinumEvent(vm, command, "Delay", command.params, "supported", `Wait ${frames} frame(s)`));
      vm.frame += frames;
      vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame);
      return nextPc;
    }
    case "waitforanimtasks":
    case "waitforallemitters": {
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "supported", `${command.name} until pending effects finish`));
      vm.frame = Math.max(vm.frame, vm.pendingUntil);
      return nextPc;
    }
    case "beginloop": {
      const count = Math.max(0, command.params[0] ?? 0);
      vm.loopStack.push({ startPc: nextPc, remaining: count });
      vm.timeline.push(makePlatinumEvent(vm, command, "BeginLoop", command.params, "marker", `Loop ${count} time(s)`));
      return nextPc;
    }
    case "endloop": {
      const loop = vm.loopStack[vm.loopStack.length - 1];
      vm.timeline.push(makePlatinumEvent(vm, command, "EndLoop", command.params, "marker", "Loop checkpoint"));
      if (!loop) {
        vm.warnings.push({ frame: vm.frame, command: command.name, message: "EndLoop has no matching BeginLoop command" });
        return nextPc;
      }
      if (loop.remaining > 1) {
        loop.remaining -= 1;
        return loop.startPc;
      }
      vm.loopStack.pop();
      return nextPc;
    }
    case "call":
      vm.timeline.push(makePlatinumEvent(vm, command, "Call", command.params, "marker", `Call ${formatOffset(targetOffset(command, 0))}`));
      if (vm.callStack.length >= (vm.scenario.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH)) {
        vm.warnings.push({ frame: vm.frame, command: command.name, message: `Call depth limit reached at ${formatOffset(command.offset)}` });
        return nextPc;
      }
      vm.callStack.push(nextPc);
      return branchPc(vm, command, 0, nextPc);
    case "return":
      vm.timeline.push(makePlatinumEvent(vm, command, "Return", command.params, "marker", "Return"));
      return vm.callStack.pop() ?? -1;
    case "jump":
      vm.timeline.push(makePlatinumEvent(vm, command, "Jump", command.params, "marker", `Jump ${formatOffset(targetOffset(command, 0))}`));
      return branchPc(vm, command, 0, nextPc);
    case "setvar": {
      const id = Math.max(0, Math.min(vm.vars.length - 1, command.params[0] ?? 0));
      const value = command.params[1] ?? 0;
      vm.vars[id] = value;
      vm.timeline.push(makePlatinumEvent(vm, command, "SetVar", command.params, "marker", `Set var ${id} = ${value}`));
      return nextPc;
    }
    case "resetvars":
      vm.vars.fill(0);
      vm.timeline.push(makePlatinumEvent(vm, command, "ResetVars", command.params, "marker", "Reset script variables"));
      return nextPc;
    case "switchbg":
      switchPlatinumBackground(vm, command, command.params[0] ?? 0, command.params[1] ?? 0, "SwitchBg");
      return nextPc;
    case "switchbgex": {
      const backgroundId = selectSwitchBgExBackground(vm, command);
      switchPlatinumBackground(vm, command, backgroundId, 0, "SwitchBgEx");
      return nextPc;
    }
    case "setbg":
      loadPlatinumBackgroundEvent(vm, command, command.params[0] ?? 0, "SetBg");
      return nextPc;
    case "restorebg":
      restorePlatinumBackground(vm, command, command.params[0] ?? 0, command.params[1] ?? 0);
      return nextPc;
    case "setbgswitchvar": {
      const varId = Math.max(0, Math.min(vm.vars.length - 1, command.params[0] ?? 0));
      const value = command.params[1] ?? 0;
      vm.vars[varId] = value;
      vm.timeline.push(makePlatinumEvent(vm, command, "SetBgSwitchVar", command.params, "marker", `Set BG var ${varId} = ${value}`));
      if (vm.backgroundMoveActive && vm.activeBackgroundId !== undefined && varId >= BATTLE_ANIM_VAR_BG_MOVE_STEP_X && varId <= BATTLE_ANIM_VAR_BG_MOVE_START_Y) {
        emitPlatinumBackgroundScroll(vm, command, vm.activeBackgroundId);
      }
      return nextPc;
    }
    case "waitforpartialbgswitch":
    case "waitforbgswitch":
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "supported", `${command.name} until background switch finishes`));
      vm.frame = Math.max(vm.frame, vm.pendingUntil);
      return nextPc;
    case "setbg0bg1alphablending":
      vm.timeline.push(makePlatinumEvent(vm, command, "BackgroundAlpha", [0, command.params[0] ?? 0, command.params[1] ?? 0], "supported", `Set BG alpha ${command.params[0] ?? 0}/${command.params[1] ?? 0}`));
      return nextPc;
    case "setdefaultalphablending":
      vm.timeline.push(makePlatinumEvent(vm, command, "BackgroundAlpha", [0, 8, 8], "supported", "Restore default background alpha"));
      return nextPc;
    case "jumpifequal": {
      const id = Math.max(0, Math.min(vm.vars.length - 1, command.params[0] ?? 0));
      const value = command.params[1] ?? 0;
      const matched = vm.vars[id] === value;
      vm.timeline.push(makePlatinumEvent(vm, command, "JumpIfEqual", command.params, "marker", `Var ${id} ${matched ? "matched" : "did not match"} ${value}`));
      return matched ? branchPc(vm, command, 2, nextPc) : nextPc;
    }
    case "jumpifbattlerside": {
      const side = sideForBattler(vm, command.params[0] ?? 0);
      vm.timeline.push(makePlatinumEvent(vm, command, "JumpIfBattlerSide", command.params, "marker", `Scenario chose ${side} side`));
      return branchPc(vm, command, side === "opponent" ? 1 : 2, nextPc);
    }
    case "jumpifweather": {
      const branch = Math.max(0, Math.min(4, Math.round(vm.scenario.weatherIndex)));
      vm.timeline.push(makePlatinumEvent(vm, command, "JumpIfWeather", command.params, "marker", `Scenario chose weather branch ${branch}`));
      return branchPc(vm, command, branch, nextPc);
    }
    case "jumpifcontest":
      vm.timeline.push(makePlatinumEvent(vm, command, "JumpIfContest", command.params, "marker", `Contest mode ${vm.scenario.contest ? "on" : "off"}`));
      return vm.scenario.contest ? branchPc(vm, command, 0, nextPc) : nextPc;
    case "jumpiffriendlyfire":
      vm.timeline.push(makePlatinumEvent(vm, command, "JumpIfFriendlyFire", command.params, "marker", `Friendly fire ${vm.scenario.playerAttack ? "on" : "off"}`));
      return vm.scenario.playerAttack ? branchPc(vm, command, 0, nextPc) : nextPc;
    case "loadparticlesystem":
      loadParticleSystem(vm, command, command.params[0] ?? 0, command.params[1] ?? 0, false);
      return nextPc;
    case "loaddebugparticlesystem":
      loadParticleSystem(vm, command, command.params[0] ?? 0, command.params[2] ?? 0, true);
      return nextPc;
    case "unloadparticlesystem": {
      const psIndex = command.params[0] ?? 0;
      vm.particleSystems.delete(psIndex);
      vm.timeline.push(makePlatinumEvent(vm, command, "UnloadParticleSystem", command.params, "marker", `Unload particle system ${psIndex}`));
      return nextPc;
    }
    case "createemitter":
      emitParticleEvent(vm, command, command.params[0] ?? 0, command.params[1] ?? 0, command.params[2] ?? 0);
      return nextPc;
    case "createemitterex":
      emitParticleEvent(vm, command, command.params[0] ?? 0, command.params[2] ?? 0, command.params[3] ?? 0);
      return nextPc;
    case "createemitterformove":
      emitParticleEvent(vm, command, command.params[0] ?? 0, moveResourceId(vm, command), command.params[7] ?? 0);
      return nextPc;
    case "createemitterforfriendlyfire":
      emitParticleEvent(vm, command, command.params[0] ?? 0, friendlyFireResourceId(vm, command), command.params[5] ?? 0);
      return nextPc;
    case "setcameraprojection": {
      const psIndex = command.params[0] ?? 0;
      const state = vm.particleSystems.get(psIndex);
      if (state) state.projection = command.params[1] ?? 0;
      vm.timeline.push(makePlatinumEvent(vm, command, "SetCameraProjection", command.params, "marker", `Particle system ${psIndex} projection ${command.params[1] ?? 0}`));
      return nextPc;
    }
    case "setcameraflip": {
      const psIndex = command.params[0] ?? 0;
      const state = vm.particleSystems.get(psIndex);
      if (state) state.flipY = (command.params[1] ?? 0) !== 0;
      vm.timeline.push(makePlatinumEvent(vm, command, "SetCameraFlip", command.params, "marker", `Particle system ${psIndex} flipY ${(command.params[1] ?? 0) !== 0 ? "on" : "off"}`));
      return nextPc;
    }
    case "setextraparams": {
      const count = Math.max(0, command.params[0] ?? 0);
      vm.lastExtraParams = command.params.slice(1, 1 + count);
      vm.timeline.push(makePlatinumEvent(vm, command, "SetExtraParams", command.params, "marker", `Cache ${vm.lastExtraParams.length} extra parameter(s)`));
      return nextPc;
    }
    case "callfunc":
      emitCallFuncMarker(vm, command);
      return nextPc;
    case "end":
      vm.timeline.push(makePlatinumEvent(vm, command, "End", command.params, "marker", "End animation"));
      return -1;
    default:
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, supportedMarkerCommand(name) ? "marker" : "unsupported", defaultMessage(command)));
      if (!supportedMarkerCommand(name)) vm.warnings.push({ frame: vm.frame, command: command.name, message: `${command.name} is shown as a timeline marker only` });
      return nextPc;
  }
}

function loadParticleSystem(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, psIndex: number, spaId: number, debug: boolean): void {
  if (!debug) vm.particleSystems.set(psIndex, { spaId });
  const status = debug ? "unsupported" : "supported";
  const message = debug ? `Debug particle system ${psIndex} references debug member ${spaId}` : `Load SPA ${spaId} into particle system ${psIndex}`;
  vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, status, message, debug ? {} : { spaId }));
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + LOAD_PARTICLE_DELAY);
  if (debug) vm.warnings.push({ frame: vm.frame, command: command.name, message: "Debug particle NARC is not available in Platinum retail ROMs" });
}

function emitParticleEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, psIndex: number, resourceId: number, callbackId: number): void {
  const particleSystem = vm.particleSystems.get(psIndex);
  if (!particleSystem) {
    vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "unsupported", `${command.name} references unloaded particle system ${psIndex}`));
    vm.warnings.push({ frame: vm.frame, command: command.name, message: `${command.name} references unloaded particle system ${psIndex}` });
    return;
  }
  const placement = callbackPlacement(vm, callbackId);
  const particle: NonNullable<MoveAnimationTimelineEvent["particle"]> = {
    sourceTarget: placement.sourceTarget,
    destinationTarget: placement.destinationTarget,
    origin: particleSystem.flipY ? flipY(placement.origin) : placement.origin,
    destination: particleSystem.flipY ? flipY(placement.destination) : placement.destination,
    projectile: placement.projectile,
    useResourceAnchor: true,
    invertResourceYAxis: true,
  };
  if (particleSystem.projection === 0) particle.foreshorten = true;
  const event = makePlatinumEvent(vm, command, command.name, command.params, placement.supported ? "supported" : "unsupported", `${command.name} SPA ${particleSystem.spaId} resource ${resourceId}; ${placement.message}`, {
    effectKind: "spa",
    spaId: particleSystem.spaId,
    resourceId: Math.max(0, resourceId),
    particle,
  });
  vm.timeline.push(event);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + PARTICLE_EVENT_DURATION);
  if (!placement.supported) vm.warnings.push({ frame: vm.frame, command: command.name, message: `Emitter callback ${callbackId} uses fallback placement` });
}

function emitCallFuncMarker(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): void {
  const functionId = command.params[0] ?? 0;
  const args = command.params.slice(2);
  if (functionId === 68 || functionId === 36) {
    const duration = Math.max(1, Math.abs(args[3] ?? args[1] ?? 8));
    vm.timeline.push(makePlatinumEvent(vm, command, functionId === 68 ? "ShakeScreen" : "ShakeSprite", args, "marker", `CallFunc ${functionId} marker for ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  vm.timeline.push(makePlatinumEvent(vm, command, "CallFunc", command.params, "marker", `CallFunc ${functionId} marker`));
}

function switchPlatinumBackground(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, backgroundId: number, param: number, displayCommand: string): void {
  const mode = param & 0xffff;
  const flags = (param >>> 16) & 0xffff;
  vm.activeBackgroundId = backgroundId;
  vm.backgroundMoveActive = Boolean(flags & BATTLE_BG_SWITCH_FLAG_MOVE);
  loadPlatinumBackgroundEvent(vm, command, backgroundId, displayCommand);
  if (vm.backgroundMoveActive) emitPlatinumBackgroundScroll(vm, command, backgroundId);
  if (flags & BATTLE_BG_SWITCH_FLAG_STOP) {
    vm.timeline.push(makePlatinumEvent(vm, command, "StopBackgroundScroll", [backgroundId], "marker", `Stop background scroll for background ${backgroundId}`));
    vm.backgroundMoveActive = false;
  }
  if (mode === 1) {
    const fadeType = vm.vars[4] ?? 0;
    vm.timeline.push(makePlatinumEvent(vm, command, "ChangeBackgroundColor", [0, 16, 0, BACKGROUND_EVENT_DURATION, fadeType === 1 ? 0x7fff : 0], "supported", `Fade ${fadeType === 1 ? "white" : "black"} into background ${backgroundId}`));
  }
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + BACKGROUND_EVENT_DURATION);
}

function loadPlatinumBackgroundEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, backgroundId: number, displayCommand: string): void {
  vm.timeline.push(makePlatinumEvent(vm, command, "LoadBackground", command.params, "supported", `${displayCommand} ${backgroundId}`, {
    backgroundId,
    backgroundFrameIndex: resolvePlatinumBackgroundFrameIndex(vm),
  }));
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + BACKGROUND_EVENT_DURATION);
}

function restorePlatinumBackground(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, backgroundId: number, param: number): void {
  const flags = (param >>> 16) & 0xffff;
  vm.timeline.push(makePlatinumEvent(vm, command, "ApplyBackground", [0, 1], "supported", `Restore battle background from ${backgroundId}`));
  if (flags & BATTLE_BG_SWITCH_FLAG_STOP || vm.backgroundMoveActive) {
    vm.timeline.push(makePlatinumEvent(vm, command, "StopBackgroundScroll", [backgroundId], "marker", `Stop background scroll for background ${backgroundId}`));
  }
  vm.activeBackgroundId = undefined;
  vm.backgroundMoveActive = false;
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + BACKGROUND_EVENT_DURATION);
}

function emitPlatinumBackgroundScroll(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, backgroundId: number): void {
  const stepX = signed16(vm.vars[BATTLE_ANIM_VAR_BG_MOVE_STEP_X] ?? 0);
  const stepY = signed16(vm.vars[BATTLE_ANIM_VAR_BG_MOVE_STEP_Y] ?? 0);
  const startX = signed16(vm.vars[BATTLE_ANIM_VAR_BG_MOVE_START_X] ?? 0);
  const startY = signed16(vm.vars[BATTLE_ANIM_VAR_BG_MOVE_START_Y] ?? 0);
  const params = [0, stepX, stepY, 600, 0, 0, startX, startY];
  vm.timeline.push(makePlatinumEvent(vm, command, "MoveBackground", params, "supported", `Scroll background ${backgroundId} by ${stepX}, ${stepY} per frame`));
}

function selectSwitchBgExBackground(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): number {
  if (vm.scenario.contest) return command.params[2] ?? command.params[0] ?? 0;
  return defenderSide(vm) === "player" ? command.params[1] ?? command.params[0] ?? 0 : command.params[0] ?? 0;
}

function resolvePlatinumBackgroundFrameIndex(vm: VmState): number {
  if (vm.scenario.contest) return 2;
  return shouldReversePlatinumBackground(vm, BATTLE_ANIM_VAR_BG_SCREEN_MODE) ? 1 : 0;
}

function shouldReversePlatinumBackground(vm: VmState, varId: number): boolean {
  const value = vm.vars[varId] ?? BATTLE_BG_SCREEN_REVERSE_NEVER;
  const attacker = vm.scenario.attackerSide;
  const defender = defenderSide(vm);
  if (value === BATTLE_BG_SCREEN_REVERSE_DEFAULT) {
    if (attacker === defender) return defender !== "player";
    return defender === "player";
  }
  return value !== BATTLE_BG_SCREEN_REVERSE_NEVER && defender === "player";
}

function callbackPlacement(vm: VmState, callbackId: number): EmitterPlacement {
  const attacker = attackerAnchor(vm);
  const defender = defenderAnchor(vm);
  switch (callbackId) {
    case 3:
    case 21:
      return fixedPlacement(attacker, 3, true, `callback ${callbackId} attacker`);
    case 4:
      return fixedPlacement(defender, 4, true, "callback 4 defender");
    case 5:
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
      return projectilePlacement(attacker, defender, 3, 4, true, `callback ${callbackId} attacker to defender`);
    case 6:
      return projectilePlacement(defender, attacker, 4, 3, true, "callback 6 defender to attacker");
    case 17:
      return genericPlacement(vm);
    case 18:
      return fixedPlacement(CENTER_BATTLE_ANCHOR, 17, true, "callback 18 based on battlers");
    case 19:
      return fixedPlacement(attackerSideAnchor(vm), 20, true, "callback 19 attacker side");
    case 20:
      return fixedPlacement(defenderSideAnchor(vm), 21, true, "callback 20 defender side");
    default:
      return fixedPlacement(CENTER_BATTLE_ANCHOR, 17, false, `callback ${callbackId} fallback`);
  }
}

function genericPlacement(vm: VmState): EmitterPlacement {
  const targetMode = vm.lastExtraParams[1] ?? 0;
  if (targetMode === 1) return fixedPlacement(attackerAnchor(vm), 3, true, "generic callback attacker target");
  if (targetMode === 2) return fixedPlacement(defenderAnchor(vm), 4, true, "generic callback defender target");
  return fixedPlacement(CENTER_BATTLE_ANCHOR, 17, true, "generic callback center target");
}

function fixedPlacement(anchor: readonly [number, number, number], target: number, supported: boolean, message: string): EmitterPlacement {
  const origin = copyVec(anchor);
  return { origin, destination: copyVec(anchor), sourceTarget: target, destinationTarget: target, projectile: false, supported, message };
}

function projectilePlacement(
  originAnchor: readonly [number, number, number],
  destinationAnchor: readonly [number, number, number],
  sourceTarget: number,
  destinationTarget: number,
  supported: boolean,
  message: string,
): EmitterPlacement {
  return {
    origin: copyVec(originAnchor),
    destination: copyVec(destinationAnchor),
    sourceTarget,
    destinationTarget,
    projectile: true,
    supported,
    message,
  };
}

function moveResourceId(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): number {
  return vm.scenario.attackerSide === "player" ? command.params[1] ?? 0 : command.params[4] ?? command.params[1] ?? 0;
}

function friendlyFireResourceId(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): number {
  return vm.scenario.attackerSide === "player" ? command.params[1] ?? 0 : command.params[2] ?? command.params[1] ?? 0;
}

function sideForBattler(vm: VmState, battler: number): "player" | "opponent" {
  if (battler === 0) return vm.scenario.attackerSide;
  if (vm.scenario.playerAttack) return vm.scenario.attackerSide;
  return vm.scenario.attackerSide === "player" ? "opponent" : "player";
}

function defenderSide(vm: VmState): "player" | "opponent" {
  if (vm.scenario.playerAttack) return vm.scenario.attackerSide;
  return vm.scenario.attackerSide === "player" ? "opponent" : "player";
}

function attackerAnchor(vm: VmState): Vec3 {
  return copyVec(vm.scenario.attackerSide === "player" ? USER_BATTLE_ANCHOR : TARGET_BATTLE_ANCHOR);
}

function defenderAnchor(vm: VmState): Vec3 {
  if (vm.scenario.playerAttack) return attackerAnchor(vm);
  return copyVec(vm.scenario.attackerSide === "player" ? TARGET_BATTLE_ANCHOR : USER_BATTLE_ANCHOR);
}

function attackerSideAnchor(vm: VmState): Vec3 {
  const anchor = attackerAnchor(vm);
  return [anchor[0], CENTER_BATTLE_ANCHOR[1], anchor[2]];
}

function defenderSideAnchor(vm: VmState): Vec3 {
  const anchor = defenderAnchor(vm);
  return [anchor[0], CENTER_BATTLE_ANCHOR[1], anchor[2]];
}

function branchPc(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, paramIndex: number, fallbackPc: number): number {
  const offset = targetOffset(command, paramIndex);
  const index = vm.commandIndexByOffset.get(offset);
  if (index === undefined) {
    vm.warnings.push({ frame: vm.frame, command: command.name, message: `Branch target ${formatOffset(offset)} is not a command boundary` });
    return fallbackPc;
  }
  return index;
}

function targetOffset(command: ParsedPlatinumMoveAnimationCommand, paramIndex: number): number {
  return command.offset + 4 + paramIndex * 4 + (command.params[paramIndex] ?? 0) * 4;
}

function makePlatinumEvent(
  vm: VmState,
  command: ParsedPlatinumMoveAnimationCommand,
  displayCommand: string,
  params: number[],
  status: MoveAnimationTimelineEvent["status"],
  message: string,
  extra: Partial<MoveAnimationTimelineEvent> = {},
): MoveAnimationTimelineEvent {
  return {
    id: `platinum:${vm.fileId}:${command.offset}:${vm.frame}:${displayCommand}:${params.join("_")}`,
    frame: vm.frame,
    label: `0x${formatOffset(command.offset)}`,
    command: displayCommand,
    params: params.slice(),
    status,
    message,
    ...extra,
  };
}

function hydratePlatinumTimelineDebug(
  timeline: MoveAnimationTimelineEvent[],
  spaArchives: Map<number, SpaArchive>,
  warnings: MoveAnimationPreviewWarning[],
): void {
  for (const event of timeline) {
    if (event.effectKind !== "spa" || event.spaId === undefined || event.resourceId === undefined) continue;
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

function platinumEventDuration(event: MoveAnimationTimelineEvent): number {
  if (event.effectKind === "spa") return PARTICLE_EVENT_DURATION;
  if (event.command === "Delay") return Math.max(1, event.params[0] ?? 1);
  if (event.command === "LoadBackground" || event.command === "ApplyBackground") return BACKGROUND_EVENT_DURATION;
  return 1;
}

function supportedMarkerCommand(name: string): boolean {
  return name.startsWith("nop") || name.startsWith("play") || name.includes("sound") || name.includes("pokemon") || name.includes("sprite") || name.includes("bg") || name === "waitforpokemoncries";
}

function defaultMessage(command: ParsedPlatinumMoveAnimationCommand): string {
  return `${command.name} marker; visual support is future work`;
}

function copyVec(value: readonly [number, number, number]): Vec3 {
  return [value[0], value[1], value[2]];
}

function flipY(value: Vec3): Vec3 {
  return [value[0], -value[1], value[2]];
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function formatOffset(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

function loadPlatinumMoveBackground(state: PlatinumMoveAnimationRom, backgroundId: number): NitroBackgroundImage {
  const entry = PLATINUM_MOVE_BACKGROUND_TABLE[backgroundId];
  if (!entry) throw new Error(`Platinum move background ${backgroundId} is not in the known background table`);
  const narc = new NARC(state.rom.getFileByName(PLATINUM_BATTLE_BG_PATH));
  const characters = decompressNitroIfNeeded(requiredPlatinumBgFile(narc, entry.gfx, `background ${backgroundId} graphics`));
  const palette = decompressNitroIfNeeded(requiredPlatinumBgFile(narc, entry.palette, `background ${backgroundId} palette`));
  const tilemaps = [entry.tilemap, entry.tilemapReversed, entry.tilemapContest];
  const frameImages = tilemaps.map((tilemap, frameIndex) => {
    const screen = decompressNitroIfNeeded(requiredPlatinumBgFile(narc, tilemap, `background ${backgroundId} screen ${frameIndex}`));
    return parseNitroBackground(backgroundId, screen, characters, palette, { transparentIndexZero: false });
  });
  const [firstFrame] = frameImages;
  if (!firstFrame) throw new Error(`Platinum move background ${backgroundId} has no screen frame`);
  return { ...firstFrame, frameImages };
}

function requiredPlatinumBgFile(narc: NARC, fileId: number, label: string): Uint8Array {
  const bytes = narc.files[fileId];
  if (!bytes) throw new Error(`${label} file ${fileId} is missing in ${PLATINUM_BATTLE_BG_PATH}`);
  return bytes;
}

function decompressNitroIfNeeded(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function signed16(value: number): number {
  const normalized = value & 0xffff;
  return normalized & 0x8000 ? normalized - 0x10000 : normalized;
}

type PlatinumMoveBackgroundTableEntry = {
  gfx: number;
  palette: number;
  tilemap: number;
  tilemapReversed: number;
  tilemapContest: number;
};

const PLATINUM_MOVE_BACKGROUND_TABLE: PlatinumMoveBackgroundTableEntry[] = [
  { gfx: 0x41, palette: 0x123, tilemap: 0x3e, tilemapReversed: 0x3f, tilemapContest: 0x40 },
  { gfx: 0x41, palette: 0x123, tilemap: 0x3e, tilemapReversed: 0x3f, tilemapContest: 0x40 },
  { gfx: 0x41, palette: 0x123, tilemap: 0x3e, tilemapReversed: 0x3f, tilemapContest: 0x40 },
  { gfx: 0x41, palette: 0x123, tilemap: 0x3e, tilemapReversed: 0x3f, tilemapContest: 0x40 },
  { gfx: 0x41, palette: 0x123, tilemap: 0x3e, tilemapReversed: 0x3f, tilemapContest: 0x40 },
  { gfx: 0x41, palette: 0x141, tilemap: 0x3e, tilemapReversed: 0x3f, tilemapContest: 0x40 },
  { gfx: 0x45, palette: 0x124, tilemap: 0x42, tilemapReversed: 0x43, tilemapContest: 0x44 },
  { gfx: 0x45, palette: 0x145, tilemap: 0x42, tilemapReversed: 0x43, tilemapContest: 0x44 },
  { gfx: 0x45, palette: 0x148, tilemap: 0x42, tilemapReversed: 0x43, tilemapContest: 0x44 },
  { gfx: 0x46, palette: 0x125, tilemap: 0x47, tilemapReversed: 0x47, tilemapContest: 0x47 },
  { gfx: 0x46, palette: 0x125, tilemap: 0x47, tilemapReversed: 0x47, tilemapContest: 0x47 },
  { gfx: 0x46, palette: 0x13f, tilemap: 0x47, tilemapReversed: 0x47, tilemapContest: 0x47 },
  { gfx: 0x46, palette: 0x140, tilemap: 0x47, tilemapReversed: 0x47, tilemapContest: 0x47 },
  { gfx: 0x46, palette: 0x147, tilemap: 0x47, tilemapReversed: 0x47, tilemapContest: 0x47 },
  { gfx: 0x4c, palette: 0x126, tilemap: 0x48, tilemapReversed: 0x48, tilemapContest: 0x48 },
  { gfx: 0x4c, palette: 0x128, tilemap: 0x48, tilemapReversed: 0x48, tilemapContest: 0x48 },
  { gfx: 0x4c, palette: 0x130, tilemap: 0x48, tilemapReversed: 0x48, tilemapContest: 0x48 },
  { gfx: 0x4c, palette: 0x138, tilemap: 0x48, tilemapReversed: 0x48, tilemapContest: 0x48 },
  { gfx: 0x4c, palette: 0x130, tilemap: 0x48, tilemapReversed: 0x48, tilemapContest: 0x48 },
  { gfx: 0x51, palette: 0x129, tilemap: 0x52, tilemapReversed: 0x52, tilemapContest: 0x50 },
  { gfx: 0x59, palette: 0x12b, tilemap: 0x56, tilemapReversed: 0x57, tilemapContest: 0x58 },
  { gfx: 0x5f, palette: 0x12d, tilemap: 0x5c, tilemapReversed: 0x5d, tilemapContest: 0x5e },
  { gfx: 0x63, palette: 0x12e, tilemap: 0x60, tilemapReversed: 0x61, tilemapContest: 0x62 },
  { gfx: 0x64, palette: 0x12f, tilemap: 0x65, tilemapReversed: 0x65, tilemapContest: 0x65 },
  { gfx: 0x66, palette: 0x131, tilemap: 0x67, tilemapReversed: 0x67, tilemapContest: 0x67 },
  { gfx: 0x69, palette: 0x132, tilemap: 0x6a, tilemapReversed: 0x6a, tilemapContest: 0x68 },
  { gfx: 0x6f, palette: 0x133, tilemap: 0x6e, tilemapReversed: 0x6e, tilemapContest: 0x6e },
  { gfx: 0x6f, palette: 0x153, tilemap: 0x6e, tilemapReversed: 0x6e, tilemapContest: 0x6e },
  { gfx: 0x70, palette: 0x134, tilemap: 0x71, tilemapReversed: 0x71, tilemapContest: 0x71 },
  { gfx: 0x70, palette: 0x135, tilemap: 0x71, tilemapReversed: 0x71, tilemapContest: 0x71 },
  { gfx: 0x70, palette: 0x134, tilemap: 0x71, tilemapReversed: 0x71, tilemapContest: 0x71 },
  { gfx: 0x77, palette: 0x137, tilemap: 0x74, tilemapReversed: 0x75, tilemapContest: 0x76 },
  { gfx: 0x77, palette: 0x137, tilemap: 0x74, tilemapReversed: 0x75, tilemapContest: 0x76 },
  { gfx: 0x77, palette: 0x137, tilemap: 0x74, tilemapReversed: 0x75, tilemapContest: 0x76 },
  { gfx: 0x7c, palette: 0x13b, tilemap: 0x7d, tilemapReversed: 0x7d, tilemapContest: 0x7d },
  { gfx: 0x81, palette: 0x13d, tilemap: 0x82, tilemapReversed: 0x82, tilemapContest: 0x80 },
  { gfx: 0x83, palette: 0x13e, tilemap: 0x84, tilemapReversed: 0x84, tilemapContest: 0x85 },
  { gfx: 0x8a, palette: 0x143, tilemap: 0x88, tilemapReversed: 0x89, tilemapContest: 0x89 },
  { gfx: 0x8b, palette: 0x144, tilemap: 0x8c, tilemapReversed: 0x8c, tilemapContest: 0x8c },
  { gfx: 0x8d, palette: 0x146, tilemap: 0x8e, tilemapReversed: 0x8e, tilemapContest: 0x8e },
  { gfx: 0x92, palette: 0x149, tilemap: 0x8f, tilemapReversed: 0x90, tilemapContest: 0x91 },
  { gfx: 0x96, palette: 0x14a, tilemap: 0x93, tilemapReversed: 0x94, tilemapContest: 0x95 },
  { gfx: 0x97, palette: 0x14b, tilemap: 0x98, tilemapReversed: 0x98, tilemapContest: 0x98 },
  { gfx: 0x99, palette: 0x14c, tilemap: 0x9a, tilemapReversed: 0x9a, tilemapContest: 0x9a },
  { gfx: 0x9b, palette: 0x14d, tilemap: 0x9c, tilemapReversed: 0x9c, tilemapContest: 0x9c },
  { gfx: 0xa0, palette: 0x14e, tilemap: 0x9d, tilemapReversed: 0x9e, tilemapContest: 0x9f },
  { gfx: 0xa1, palette: 0x14f, tilemap: 0xa2, tilemapReversed: 0xa2, tilemapContest: 0xa2 },
  { gfx: 0x34, palette: 0x11e, tilemap: 0x35, tilemapReversed: 0x35, tilemapContest: 0x35 },
  { gfx: 0xa3, palette: 0x150, tilemap: 0xa4, tilemapReversed: 0xa5, tilemapContest: 0xa4 },
  { gfx: 0xa3, palette: 0x152, tilemap: 0xa4, tilemapReversed: 0xa5, tilemapContest: 0xa4 },
  { gfx: 0xa6, palette: 0x151, tilemap: 0xa8, tilemapReversed: 0xa7, tilemapContest: 0xa7 },
  { gfx: 0x4e, palette: 0x127, tilemap: 0x4f, tilemapReversed: 0x4f, tilemapContest: 0x4f },
  { gfx: 0x5a, palette: 0x12c, tilemap: 0x5b, tilemapReversed: 0x5b, tilemapContest: 0x5b },
  { gfx: 0x55, palette: 0x12a, tilemap: 0x53, tilemapReversed: 0x53, tilemapContest: 0x53 },
  { gfx: 0x72, palette: 0x136, tilemap: 0x73, tilemapReversed: 0x73, tilemapContest: 0x73 },
  { gfx: 0x7a, palette: 0x13a, tilemap: 0x7b, tilemapReversed: 0x7b, tilemapContest: 0x7b },
  { gfx: 0x78, palette: 0x139, tilemap: 0x79, tilemapReversed: 0x79, tilemapContest: 0x79 },
  { gfx: 0x86, palette: 0x142, tilemap: 0x87, tilemapReversed: 0x87, tilemapContest: 0x87 },
];
