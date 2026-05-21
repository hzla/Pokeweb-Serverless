import { readAscii, readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { cameraEventDuration } from "./battleCameraSimulator";
import { CENTER_BATTLE_ANCHOR, TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "./battlePreviewAnchors";
import {
  compileHgMoveAnimationScript,
  parseHgMoveAnimationBinary,
  type HgMoveAnimationRom,
  type HgMoveAnimationScriptArchiveKind,
  type ParsedHgMoveAnimationCommand,
} from "./hgMoveAnimationModel";
import {
  convertHgParticleOffset,
  convertHgRawParticlePosition,
  hgOperatorAxis,
  hgOperatorEndpointPosition,
  hgOperatorPosition,
  hgOperatorPositionName,
  type HgParticleOperatorEndpoint,
} from "./hgParticleOperatorTables";
import type { MoveAnimationPreview, MoveAnimationPreviewWarning, MoveAnimationTimelineEvent } from "./moveAnimationPreviewModel";
import { parseNitroBackground, parseNitroPalette, type NitroBackgroundImage, type NitroBackgroundPaletteAnimation } from "./nitroBg";
import { parseNitroCellEffect, type NitroCellEffect } from "./nitroCell";
import { parseSpaArchive, type SpaArchive } from "./nitroSpa";
import { decompressNitro } from "./pokemonSpriteModel";

const HG_MOVE_SPA_PATH = "a/0/2/9";
const HG_BATTLE_GFX_PATH = "a/0/0/7";
const HG_BATTLE_BG_PLANM_PATH = "wazaeffect/batt_bg_planm.narc";
const HG_EFFECT_CLACT_CHAR_PATH = "wazaeffect/effectclact/wechar.narc";
const HG_EFFECT_CLACT_PLTT_PATH = "wazaeffect/effectclact/wepltt.narc";
const HG_EFFECT_CLACT_CELL_PATH = "wazaeffect/effectclact/wecell.narc";
const HG_EFFECT_CLACT_CELLANM_PATH = "wazaeffect/effectclact/wecellanm.narc";
const HG_BATTLE_BG_PLANM_CANDIDATE_PATHS = [HG_BATTLE_BG_PLANM_PATH];
const DEFAULT_MAX_STEPS = 4096;
const DEFAULT_MAX_CALL_DEPTH = 16;
const PARTICLE_EVENT_DURATION = 45;
const BACKGROUND_EVENT_DURATION = 12;
const HG_HAIKEI_SBIT_MOVE = 0x0002;
const HG_HAIKEI_SBIT_STOP = 0x0004;
const HG_HAIKEI_SBIT_PLANM = 0x0080;
const HG_HAIKEI_SBIT_PLANM_STOP = 0x0100;
const CMD37_USER_BEAM_MODES = new Set([6, 8, 10, 14, 16, 18, 20, 22, 24, 26]);
const CMD37_END_BEAM_MODES = new Set([7, 9, 11, 15, 17, 19, 21, 23, 25, 27]);
const CMD37_TARGET_USER = 1;
const CMD37_TARGET_DEFENDER = 2;
const EMTFUNC_DUMMY = 0;
const EMTFUNC_ATTACK_POS = 3;
const EMTFUNC_DEFENCE_POS = 4;
const EMTFUNC_FIELD_OPERATOR = 17;
const EMTFUNC_AT_SIDE = 19;
const EMTFUNC_DF_SIDE = 20;
const EMTFUNC_ATTACK_POS_CR = 21;
const HG_BEAM_SCREEN_ROTATION = -0.72;
const HG_GUILLOTINE_SPA_ID = 43;
const HG_BITE_SPA_ID = 75;
const HG_FOCUS_ENERGY_SPA_ID = 143;
const HG_POWDER_SNOW_SPA_ID = 201;
const HG_SHADOW_BALL_SPA_ID = 265;
const HG_PARTICLE_SCREEN_DOT = 172;
const HG_SIN360_AMPLITUDE = 4096;
const HG_CATS_WE_081_FUNC_ID = 1;
const HG_CATS_WE_081_BLINK_DURATION = 45;
const HG_CATS_WE_081_HOLD_DURATION = 45;
const HG_CATS_WE_081_SCALE_DURATION = 10;
const HG_CATS_WE_081_FADE_DURATION = 15;
const HG_CATS_WE_081_DURATION = HG_CATS_WE_081_BLINK_DURATION + HG_CATS_WE_081_SCALE_DURATION + HG_CATS_WE_081_HOLD_DURATION + HG_CATS_WE_081_FADE_DURATION;
const HG_CATS_WE_155_FUNC_ID = 6;
const HG_CATS_WE_155_DURATION = 20;
const HG_CATS_WE_155_LEG_DURATION = 10;
const HG_CATS_WE_155_ARC_HEIGHT = 3;
const HG_CATS_WE_184_FUNC_ID = 7;
const HG_CATS_WE_184_DURATION = 40;
const HG_CATS_WE_199_FUNC_ID = 9;
const HG_CATS_WE_199_DURATION = 92;
const HG_CATS_WE_333_FUNC_ID = 17;
const HG_CATS_WE_333_DEFAULT_DURATION = 10;
const HG_CATS_WE_333_DEFAULT_HEIGHT = 32;
const WE_TOOL_M1 = 0x0002;
const WE_TOOL_M2 = 0x0004;
const WE_TOOL_E1 = 0x0008;
const WE_TOOL_E2 = 0x0010;
const WE_TOOL_SSP = 0x0100;
const OPERATOR_FLD_GRAVITY_MAG = 0x0002;
const OPERATOR_FLD_RANDOM_MAG = 0x0004;
const OPERATOR_FLD_RANDOM_INTVL = 0x0008;
const OPERATOR_FLD_MAGNET_POS = 0x0010;
const OPERATOR_FLD_MAGNET_MAG = 0x0020;
const OPERATOR_FLD_CONVERGENCE_POS = 0x1000;
const OPERATOR_FLD_CONVERGENCE_RATIO = 0x2000;
const OPERATOR_FLD_SET = 1;
const OPERATOR_FLD_AT = 2;
const OPERATOR_FLD_DF = 3;
const OPERATOR_FLD_SET_DF = 4;
const OPERATOR_EX_REVERCE_OFF = 1;
const OPERATOR_POS_SET = 3;
const OPERATOR_POS_SP_OFS = 4;
const OPERATOR_POS_EP_OFS = 5;
const OPERATOR_POS_AT_SIDE_OFS = 12;
const OPERATOR_POS_DF_SIDE_OFS = 13;
const FIELD_OPERATOR_ORDER = [
  0x0000,
  OPERATOR_FLD_GRAVITY_MAG,
  OPERATOR_FLD_RANDOM_MAG,
  OPERATOR_FLD_RANDOM_INTVL,
  OPERATOR_FLD_MAGNET_POS,
  OPERATOR_FLD_MAGNET_MAG,
  0x0040,
  0x0080,
  0x0100,
  0x0200,
  0x0400,
  0x0800,
  OPERATOR_FLD_CONVERGENCE_POS,
  OPERATOR_FLD_CONVERGENCE_RATIO,
];
const hgPlanmNarcCache = new WeakMap<HgMoveAnimationRom, NARC | null>();

export type HgMoveAnimationPreviewScenario = {
  attackerSide: "player" | "opponent";
  checkturn: 0 | 1;
  weatherIndex: number;
  contest: boolean;
  playerAttack: boolean;
  maxSteps?: number;
  maxCallDepth?: number;
};

export const DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO: HgMoveAnimationPreviewScenario = {
  attackerSide: "player",
  checkturn: 0,
  weatherIndex: 0,
  contest: false,
  playerAttack: true,
};

type VmState = {
  commands: ParsedHgMoveAnimationCommand[];
  commandIndexByOffset: Map<number, number>;
  frame: number;
  pendingUntil: number;
  pc: number;
  callStack: number[];
  loopStack: Array<{ startPc: number; remaining: number }>;
  loadedParticles: Map<number, number>;
  backgroundParams: Map<number, number>;
  cellResources: Map<number, Partial<HgLoadedCellResource>>;
  timeline: MoveAnimationTimelineEvent[];
  warnings: MoveAnimationPreviewWarning[];
  scenario: HgMoveAnimationPreviewScenario;
  archiveKind: HgMoveAnimationScriptArchiveKind;
  fileId: number;
};

type Vec3 = [number, number, number];

type HgLoadedCellResource = {
  charId: number;
  paletteId: number;
  cellId: number;
  animationId: number;
};

export async function buildHgMoveAnimationPreview(
  state: HgMoveAnimationRom,
  archiveKind: HgMoveAnimationScriptArchiveKind,
  fileId: number,
  scriptText: string,
  scenario: HgMoveAnimationPreviewScenario = DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO,
): Promise<MoveAnimationPreview> {
  const bytes = compileHgMoveAnimationScript(scriptText, { archiveKind, fileId });
  const commands = parseHgMoveAnimationBinary(bytes);
  const warnings: MoveAnimationPreviewWarning[] = [];
  const timeline = executeHgAnimation(commands, archiveKind, fileId, { ...DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO, ...scenario }, warnings);
  const spaIds = uniqueSorted(
    timeline.flatMap((event) => (event.spaId === undefined ? [] : [event.spaId])),
  );
  const backgroundIds = uniqueSorted(
    timeline.flatMap((event) => (event.command === "LoadBackground" && event.backgroundId !== undefined ? [event.backgroundId] : [])),
  );
  const paletteAnimationIds = uniqueSorted(
    timeline.flatMap((event) => (event.command === "BackgroundPaletteAnimation" && (event.params[1] ?? 0) !== 0 ? [event.params[0] ?? 0] : [])),
  );
  const cellEffectIds = uniqueCellEffectIds(timeline);
  const spaArchives = new Map<number, SpaArchive>();
  const moveSpaNarc = loadHgMoveSpaNarc(state, warnings);
  if (moveSpaNarc) {
    for (const spaId of spaIds) {
      try {
        const spaBytes = moveSpaNarc.files[spaId];
        if (!spaBytes) throw new Error(`Move particle SPA ${spaId} does not exist in ${HG_MOVE_SPA_PATH}`);
        const archive = parseSpaArchive(spaBytes);
        spaArchives.set(spaId, archive);
        for (const warning of archive.warnings) warnings.push({ message: `SPA ${spaId}: ${warning.message}` });
      } catch (error) {
        warnings.push({ message: `SPA ${spaId}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  hydrateHgTimelineDebug(timeline, spaArchives, warnings);
  const cellEffects = loadHgCellEffects(state, cellEffectIds, warnings);

  const backgrounds = new Map<number, NitroBackgroundImage>();
  for (const backgroundId of backgroundIds) {
    try {
      const background = loadHgMoveBackground(state, backgroundId);
      backgrounds.set(backgroundId, background);
      for (const warning of background.warnings) warnings.push({ message: `Background ${backgroundId}: ${warning}` });
    } catch (error) {
      warnings.push({ message: `Background ${backgroundId}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const backgroundPaletteAnimations = new Map<number, NitroBackgroundPaletteAnimation>();
  for (const backgroundId of paletteAnimationIds) {
    try {
      backgroundPaletteAnimations.set(backgroundId, loadHgBackgroundPaletteAnimation(state, backgroundId));
    } catch (error) {
      warnings.push({ message: `Background ${backgroundId} PLANM: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return {
    moveId: fileId,
    rootLabel: `${archiveKind === "move" ? "a010" : "a061"}_${String(fileId).padStart(3, "0")}`,
    timeline,
    spaIds,
    spaArchives,
    cellEffects,
    backgrounds,
    backgroundPaletteAnimations,
    warnings,
    frameCount: Math.max(60, ...timeline.map((event) => event.frame + hgEventDuration(event))),
  };
}

function executeHgAnimation(
  commands: ParsedHgMoveAnimationCommand[],
  archiveKind: HgMoveAnimationScriptArchiveKind,
  fileId: number,
  scenario: HgMoveAnimationPreviewScenario,
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
    loadedParticles: new Map(),
    backgroundParams: new Map(),
    cellResources: new Map(),
    timeline: [],
    warnings,
    scenario,
    archiveKind,
    fileId,
  };
  const maxSteps = scenario.maxSteps ?? DEFAULT_MAX_STEPS;
  for (let step = 0; step < maxSteps && vm.pc >= 0 && vm.pc < commands.length; step += 1) {
    const command = commands[vm.pc];
    const nextPc = runCommand(vm, command);
    if (nextPc === -1) break;
    vm.pc = nextPc;
  }
  if (vm.pc >= 0 && vm.pc < commands.length) warnings.push({ frame: vm.frame, message: `Preview stopped after ${maxSteps} VM step(s); possible loop or recursion` });
  return vm.timeline;
}

function runCommand(vm: VmState, command: ParsedHgMoveAnimationCommand): number {
  const name = command.name.toLowerCase();
  const nextPc = vm.pc + 1;
  switch (name) {
    case "wait": {
      const frames = Math.max(0, command.params[0] ?? 0);
      vm.timeline.push(makeHgEvent(vm, command, "wait", command.params, "supported", `Wait ${frames} frame(s)`));
      vm.frame += frames;
      vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame);
      return nextPc;
    }
    case "waitstate":
    case "waitparticle":
    case "waitforchangebg":
    case "waitforchangebg2": {
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "supported", `${command.name} until pending effects finish`));
      vm.frame = Math.max(vm.frame, vm.pendingUntil);
      return nextPc;
    }
    case "loadparticle": {
      const slot = command.params[0] ?? 0;
      const spaId = command.params[1] ?? 0;
      vm.loadedParticles.set(slot, spaId);
      vm.timeline.push(makeHgEvent(vm, command, "loadparticle", command.params, "supported", `Load SPA ${spaId} into slot ${slot}`, { spaId }));
      return nextPc;
    }
    case "unloadparticle": {
      const slot = command.params[0] ?? 0;
      vm.loadedParticles.delete(slot);
      vm.timeline.push(makeHgEvent(vm, command, "unloadparticle", command.params, "marker", `Unload particle slot ${slot}`));
      return nextPc;
    }
    case "initresources": {
      const slot = command.params[0] ?? 0;
      vm.cellResources.set(slot, {});
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `Initialize CATS cell resources in slot ${slot}`));
      return nextPc;
    }
    case "loadresources": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.charId = command.params[1] ?? 0;
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `Load CATS NCGR ${resource.charId} into slot ${slot}`));
      return nextPc;
    }
    case "loadpalette": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.paletteId = command.params[1] ?? 0;
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `Load CATS NCLR ${resource.paletteId} into slot ${slot}`));
      return nextPc;
    }
    case "loadcell": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.cellId = command.params[1] ?? 0;
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `Load CATS NCER ${resource.cellId} into slot ${slot}`));
      return nextPc;
    }
    case "loadcellanm": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.animationId = command.params[1] ?? 0;
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `Load CATS NANR ${resource.animationId} into slot ${slot}`));
      return nextPc;
    }
    case "addsomething":
      emitCellEffectEvent(vm, command);
      return nextPc;
    case "freeresources": {
      const slot = command.params[0] ?? 0;
      vm.cellResources.delete(slot);
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `Free CATS cell resource slot ${slot}`));
      return nextPc;
    }
    case "addparticle":
    case "addparticle2":
    case "addsequentialparticle":
    case "addparticlebasedonbattler":
      emitParticleEvent(vm, command);
      return nextPc;
    case "call":
      vm.timeline.push(makeHgEvent(vm, command, "call", command.params, "marker", `Call ${formatOffset(targetOffset(command, 0))}`));
      if (vm.callStack.length >= (vm.scenario.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH)) {
        vm.warnings.push({ frame: vm.frame, command: command.name, message: `Call depth limit reached at ${formatOffset(command.offset)}` });
        return nextPc;
      }
      vm.callStack.push(nextPc);
      return branchPc(vm, command, 0, nextPc);
    case "return":
      vm.timeline.push(makeHgEvent(vm, command, "return", command.params, "marker", "Return"));
      return vm.callStack.pop() ?? -1;
    case "loop": {
      const count = Math.max(0, command.params[0] ?? 0);
      vm.loopStack.push({ startPc: nextPc, remaining: count });
      vm.timeline.push(makeHgEvent(vm, command, "loop", command.params, "marker", `Loop ${count} time(s)`));
      return nextPc;
    }
    case "doloop": {
      const loop = vm.loopStack[vm.loopStack.length - 1];
      vm.timeline.push(makeHgEvent(vm, command, "doloop", command.params, "marker", "Loop checkpoint"));
      if (!loop) {
        vm.warnings.push({ frame: vm.frame, command: command.name, message: "doloop has no matching loop command" });
        return nextPc;
      }
      if (loop.remaining > 1) {
        loop.remaining -= 1;
        return loop.startPc;
      }
      vm.loopStack.pop();
      return nextPc;
    }
    case "checkturn":
      vm.timeline.push(makeHgEvent(vm, command, "checkturn", command.params, "marker", `Scenario chose branch ${vm.scenario.checkturn + 1}`));
      return branchPc(vm, command, vm.scenario.checkturn, nextPc);
    case "jumpifside": {
      const branch = vm.scenario.attackerSide === "player" ? 1 : 2;
      vm.timeline.push(makeHgEvent(vm, command, "jumpifside", command.params, "marker", `Scenario chose ${vm.scenario.attackerSide} side`));
      return branchPc(vm, command, branch, nextPc);
    }
    case "jumpbasedonweather": {
      const branch = Math.max(0, Math.min(4, Math.round(vm.scenario.weatherIndex)));
      vm.timeline.push(makeHgEvent(vm, command, "jumpbasedonweather", command.params, "marker", `Scenario chose weather branch ${branch}`));
      return branchPc(vm, command, branch, nextPc);
    }
    case "jumpifcontest":
      vm.timeline.push(makeHgEvent(vm, command, "jumpifcontest", command.params, "marker", `Contest mode ${vm.scenario.contest ? "on" : "off"}`));
      return vm.scenario.contest ? branchPc(vm, command, 0, nextPc) : nextPc;
    case "jumpifplayerattack":
      vm.timeline.push(makeHgEvent(vm, command, "jumpifplayerattack", command.params, "marker", `Player attacker ${vm.scenario.playerAttack ? "on" : "off"}`));
      return vm.scenario.playerAttack ? branchPc(vm, command, 0, nextPc) : nextPc;
    case "callfunction":
      emitCallFunctionEvent(vm, command);
      return nextPc;
    case "cmd0c": {
      vm.backgroundParams.set(command.params[0] ?? 0, command.params[1] ?? 0);
      vm.timeline.push(makeHgEvent(vm, command, "cmd0C", command.params, "marker", `WORK_SET ${hgBackgroundWorkName(command.params[0] ?? 0)} = ${command.params[1] ?? 0}`));
      return nextPc;
    }
    case "cmd37":
      applyCmd37ParticleTransform(vm, command);
      vm.timeline.push(makeHgEvent(vm, command, "cmd37", command.params, "marker", cmd37Message(command)));
      return nextPc;
    case "changebg":
    case "changebgparam": {
      const backgroundId = command.params[0] ?? 0;
      const event = makeHgEvent(vm, command, "LoadBackground", command.params, "supported", `${command.name} ${backgroundId}`, {
        backgroundId,
        backgroundEffect: hgBackgroundEffect(backgroundId, command.params[1] ?? 0),
        backgroundFrameIndex: resolveHgBackgroundFrameIndex(vm),
      });
      vm.timeline.push(event);
      emitHgBackgroundScroll(vm, command, backgroundId);
      emitHgBackgroundPaletteAnimation(vm, command, backgroundId);
      vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + BACKGROUND_EVENT_DURATION);
      return nextPc;
    }
    case "changepermanentbg":
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "marker", `${command.name} marker; battlefield background rendering is future work`));
      return nextPc;
    case "resetbg":
      vm.timeline.push(makeHgEvent(vm, command, "ApplyBackground", [0, 1], "supported", `Reset background ${command.params[0] ?? 0}`));
      emitHgBackgroundPaletteAnimation(vm, command, command.params[0] ?? 0);
      vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + BACKGROUND_EVENT_DURATION);
      return nextPc;
    case "end":
      vm.timeline.push(makeHgEvent(vm, command, "end", command.params, "marker", "End animation"));
      return -1;
    default:
      vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, supportedMarkerCommand(name) ? "marker" : "unsupported", defaultMessage(command)));
      if (!supportedMarkerCommand(name)) vm.warnings.push({ frame: vm.frame, command: command.name, message: `${command.name} is shown as a timeline marker only` });
      return nextPc;
  }
}

function emitParticleEvent(vm: VmState, command: ParsedHgMoveAnimationCommand): void {
  const slot = command.params[0] ?? 0;
  const resourceId = Math.max(0, particleResourceId(command));
  const target = particleTarget(command);
  const spaId = vm.loadedParticles.get(slot);
  if (spaId === undefined) {
    vm.timeline.push(makeHgEvent(vm, command, command.name, command.params, "unsupported", `${command.name} references unloaded particle slot ${slot}`));
    vm.warnings.push({ frame: vm.frame, command: command.name, message: `${command.name} references unloaded particle slot ${slot}` });
    return;
  }
  const destination = command.name.toLowerCase() === "addparticlebasedonbattler" ? opposingTarget(target) : target;
  const origin = hgEmitterCallbackAnchor(target, vm);
  const destinationAnchor = command.name.toLowerCase() === "addparticlebasedonbattler" ? hgParticleTargetAnchor(destination, vm) : origin;
  const event = makeHgEvent(vm, command, command.name, command.params, "supported", `${command.name} SPA ${spaId} resource ${resourceId} at target ${target}`, {
    effectKind: "spa",
    spaId,
    resourceId,
    particle: {
      sourceTarget: target,
      destinationTarget: destination,
      origin,
      destination: destinationAnchor,
      projectile: command.name.toLowerCase() === "addparticlebasedonbattler",
      useResourceAnchor: true,
      invertResourceYAxis: true,
    },
  });
  applyHgParticlePlacementProfile(event);
  vm.timeline.push(event);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + PARTICLE_EVENT_DURATION);
}

function ensureCellResource(vm: VmState, slot: number): Partial<HgLoadedCellResource> {
  let resource = vm.cellResources.get(slot);
  if (!resource) {
    resource = {};
    vm.cellResources.set(slot, resource);
  }
  return resource;
}

function emitCellEffectEvent(vm: VmState, command: ParsedHgMoveAnimationCommand): void {
  const slot = command.params[0] ?? 0;
  const supportFuncId = command.params[1] ?? 0;
  const loaded = vm.cellResources.get(slot);
  const charId = command.params[2] ?? loaded?.charId ?? 0;
  const paletteId = command.params[3] ?? loaded?.paletteId ?? charId;
  const cellId = command.params[4] ?? loaded?.cellId ?? charId;
  const animationId = command.params[5] ?? loaded?.animationId ?? cellId;
  const duration = cellEffectDuration(supportFuncId, command);
  const cellEffectId = hgCellEffectKey(charId, paletteId, cellId, animationId);
  const event = makeHgEvent(vm, command, command.name, command.params, "supported", `${command.name} CATS cell effect char ${charId}, palette ${paletteId}, cell ${cellId}, animation ${animationId}`, {
    effectKind: "cell",
    cellEffectId,
    cellEffect: {
      charId,
      paletteId,
      cellId,
      animationId,
      supportFuncId,
      origin: cellEffectOrigin(vm, supportFuncId, command),
      scale: cellEffectScale(supportFuncId),
      duration,
      instances: cellEffectInstances(supportFuncId),
      motion: cellEffectMotion(vm, supportFuncId, command),
    },
  });
  vm.timeline.push(event);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
}

function cellEffectOrigin(vm: VmState, supportFuncId: number, command?: ParsedHgMoveAnimationCommand): Vec3 {
  if (supportFuncId === HG_CATS_WE_081_FUNC_ID) return stringShotWebAnchor(TARGET_BATTLE_ANCHOR);
  if (supportFuncId === HG_CATS_WE_155_FUNC_ID) return bonemerangAnchor(USER_BATTLE_ANCHOR);
  if (supportFuncId === HG_CATS_WE_199_FUNC_ID) return lockOnAnchor(TARGET_BATTLE_ANCHOR);
  if (supportFuncId === HG_CATS_WE_333_FUNC_ID) return icicleSpearMotion(vm, command).from;
  const target = copyAnchor(TARGET_BATTLE_ANCHOR);
  if (supportFuncId === HG_CATS_WE_184_FUNC_ID) {
    const attacker = copyAnchor(vm.scenario.attackerSide === "player" ? USER_BATTLE_ANCHOR : TARGET_BATTLE_ANCHOR);
    const defender = vm.scenario.attackerSide === "player" ? TARGET_BATTLE_ANCHOR : USER_BATTLE_ANCHOR;
    const direction = defender[0] >= attacker[0] ? 1 : -1;
    return [attacker[0] + direction * 4.25, attacker[1] + 5.25, attacker[2] + 1.5];
  }
  return [target[0], target[1] + 4.5, target[2] + 1];
}

function cellEffectScale(supportFuncId: number): number {
  if (supportFuncId === HG_CATS_WE_081_FUNC_ID) return 1.05;
  if (supportFuncId === HG_CATS_WE_155_FUNC_ID) return 1.35;
  if (supportFuncId === HG_CATS_WE_184_FUNC_ID) return 1.25;
  if (supportFuncId === HG_CATS_WE_199_FUNC_ID) return 1.1;
  if (supportFuncId === HG_CATS_WE_333_FUNC_ID) return 1.15;
  return 1;
}

function cellEffectInstances(supportFuncId: number): NonNullable<MoveAnimationTimelineEvent["cellEffect"]>["instances"] | undefined {
  if (supportFuncId !== HG_CATS_WE_081_FUNC_ID) return undefined;
  return [
    { offset: [0, -1.44, 0], startFrame: 8, blinkInterval: 2 },
    { offset: [0, -0.72, 0.03], startFrame: 13, blinkInterval: 1 },
    { offset: [0, 0, 0.06], startFrame: 18, blinkInterval: 3 },
  ];
}

function cellEffectMotion(
  vm: VmState,
  supportFuncId: number,
  command?: ParsedHgMoveAnimationCommand,
): NonNullable<MoveAnimationTimelineEvent["cellEffect"]>["motion"] | undefined {
  if (supportFuncId === HG_CATS_WE_155_FUNC_ID) {
    const user = bonemerangAnchor(USER_BATTLE_ANCHOR);
    const target = bonemerangAnchor(TARGET_BATTLE_ANCHOR);
    return {
      legs: [
        { from: user, to: target, duration: HG_CATS_WE_155_LEG_DURATION, arcHeight: HG_CATS_WE_155_ARC_HEIGHT },
        { from: target, to: user, duration: HG_CATS_WE_155_LEG_DURATION, arcHeight: -HG_CATS_WE_155_ARC_HEIGHT },
      ],
    };
  }
  if (supportFuncId === HG_CATS_WE_333_FUNC_ID) {
    const motion = icicleSpearMotion(vm, command);
    return {
      faceMotion: true,
      legs: [{ from: motion.from, to: motion.to, duration: motion.duration, arcHeight: motion.arcHeight }],
    };
  }
  return undefined;
}

function bonemerangAnchor(anchor: readonly [number, number, number]): Vec3 {
  return [anchor[0], anchor[1] + 4.5, anchor[2] + 1];
}

function stringShotWebAnchor(anchor: readonly [number, number, number]): Vec3 {
  return [anchor[0], anchor[1] - 8.25, anchor[2] + 1];
}

function lockOnAnchor(anchor: readonly [number, number, number]): Vec3 {
  return [anchor[0], anchor[1] - 3.5, anchor[2] + 1];
}

function shadowBallChargeAnchor(): Vec3 {
  const direction = sub(TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR);
  return [
    USER_BATTLE_ANCHOR[0] + direction[0] * 0.28,
    USER_BATTLE_ANCHOR[1] + direction[1] * 0.28 + 2.5,
    USER_BATTLE_ANCHOR[2] + direction[2] * 0.28,
  ];
}

function cellEffectDuration(supportFuncId: number, command?: ParsedHgMoveAnimationCommand): number {
  if (supportFuncId === HG_CATS_WE_081_FUNC_ID) return HG_CATS_WE_081_DURATION;
  if (supportFuncId === HG_CATS_WE_155_FUNC_ID) return HG_CATS_WE_155_DURATION;
  if (supportFuncId === HG_CATS_WE_184_FUNC_ID) return HG_CATS_WE_184_DURATION;
  if (supportFuncId === HG_CATS_WE_199_FUNC_ID) return HG_CATS_WE_199_DURATION;
  if (supportFuncId === HG_CATS_WE_333_FUNC_ID) return icicleSpearMotionParams(command).duration;
  return PARTICLE_EVENT_DURATION;
}

function icicleSpearMotion(vm: VmState, command?: ParsedHgMoveAnimationCommand): { from: Vec3; to: Vec3; duration: number; arcHeight: number } {
  const params = icicleSpearMotionParams(command);
  const attacker = vm.scenario.attackerSide === "player" ? USER_BATTLE_ANCHOR : TARGET_BATTLE_ANCHOR;
  const defender = vm.scenario.attackerSide === "player" ? TARGET_BATTLE_ANCHOR : USER_BATTLE_ANCHOR;
  const direction = defender[0] >= attacker[0] ? 1 : -1;
  const offset = convertHgScreenDotOffset([params.offsetX * direction, params.offsetY * direction, 0]);
  const from = bonemerangAnchor(attacker);
  const target = bonemerangAnchor(defender);
  return {
    from,
    to: [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]],
    duration: params.duration,
    arcHeight: Math.abs(convertHgScreenDotOffset([0, params.height, 0])[1]),
  };
}

function icicleSpearMotionParams(command?: ParsedHgMoveAnimationCommand): { offsetX: number; offsetY: number; duration: number; height: number } {
  const args = cellEffectSupportArgs(command);
  return {
    offsetX: args[0] ?? 0,
    offsetY: args[1] ?? 0,
    duration: Math.max(1, Math.abs(args[2] ?? HG_CATS_WE_333_DEFAULT_DURATION)),
    height: Math.abs(args[3] ?? HG_CATS_WE_333_DEFAULT_HEIGHT),
  };
}

function cellEffectSupportArgs(command?: ParsedHgMoveAnimationCommand): number[] {
  if (!command) return [];
  const count = Math.max(0, command.params[8] ?? 0);
  return command.params.slice(9, 9 + count);
}

function applyHgParticlePlacementProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle) return;
  if (event.spaId === HG_GUILLOTINE_SPA_ID) applyHgGuillotinePlacementProfile(event);
  if (event.spaId === HG_BITE_SPA_ID) applyHgBitePlacementProfile(event);
  if (event.spaId === HG_FOCUS_ENERGY_SPA_ID) applyHgFocusEnergyPlacementProfile(event);
  if (event.spaId === HG_SHADOW_BALL_SPA_ID) applyHgShadowBallPlacementProfile(event);
}

function applyHgGuillotinePlacementProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle) return;
  if (event.resourceId !== 1 && event.resourceId !== 2 && event.resourceId !== 3 && event.resourceId !== 4) return;
  event.particle.origin = [TARGET_BATTLE_ANCHOR[0], TARGET_BATTLE_ANCHOR[1] - 7, TARGET_BATTLE_ANCHOR[2]];
  event.particle.anchoredPaneMotionDirection = -1;
  event.message = `${event.message}; HG Guillotine pincer rises from below with SPL anchor`;
}

function applyHgBitePlacementProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle) return;
  const center: Vec3 = [TARGET_BATTLE_ANCHOR[0], TARGET_BATTLE_ANCHOR[1] + 3.5, TARGET_BATTLE_ANCHOR[2] + 1.5];
  event.particle.destinationTarget = 4;
  event.particle.foreshorten = false;
  switch (event.resourceId) {
    case 0:
      event.particle.origin = [center[0], center[1] - 1, center[2] + 1];
      event.particle.emissionOffsets = [
        [-2.25, 0, 0],
        [2.25, 0, 0],
      ];
      event.particle.scaleMultiplier = 0.9;
      event.message = `${event.message}; HG Bite side impacts`;
      break;
    case 1:
      event.particle.scaleMultiplier = 0.46;
      event.message = `${event.message}; HG Bite lower jaw uses SPL anchor and scale animation`;
      break;
    case 2:
      event.particle.scaleMultiplier = 0.46;
      event.message = `${event.message}; HG Bite lower jaw follow-through uses SPL anchor`;
      break;
    case 3:
    case 4:
      event.particle.scaleMultiplier = 0.46;
      event.message = `${event.message}; HG Bite upper jaw uses SPL anchor and scale animation`;
      break;
    default:
      break;
  }
}

function applyHgFocusEnergyPlacementProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle || event.resourceId !== 1) return;
  event.particle.anchoredPaneMotionDirection = -1;
  event.message = `${event.message}; HG Focus Energy strip rises from attacker anchor`;
}

function applyHgShadowBallPlacementProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle) return;
  if (event.resourceId !== 0 && event.resourceId !== 1 && event.resourceId !== 2 && event.resourceId !== 4) return;
  event.particle.origin = shadowBallChargeAnchor();
  event.particle.destinationTarget = 4;
  event.particle.foreshorten = false;
  event.message = `${event.message}; HG Shadow Ball charge origin near attacker`;
}

function emitCallFunctionEvent(vm: VmState, command: ParsedHgMoveAnimationCommand): void {
  const functionId = command.params[0] ?? 0;
  const args = command.params.slice(2);
  if (functionId === 68) {
    const amplitudeX = Math.max(1, Math.abs(args[0] ?? 8)) * 512;
    const amplitudeY = Math.max(1, Math.abs(args[1] ?? 8)) * 512;
    const duration = Math.max(1, Math.abs(args[3] ?? 10));
    const event = makeHgEvent(vm, command, "ShakeScreen", [2, amplitudeX, amplitudeY, duration, 0, 1], "supported", `Shake screen for ${duration} frame(s)`);
    vm.timeline.push(event);
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + cameraEventDuration(event));
    return;
  }
  if (functionId === 76) {
    const duration = Math.max(1, Math.abs(args[0] ?? 1));
    vm.timeline.push(makeHgEvent(vm, command, "DistortBackground", [0, duration, 32, 200], "supported", `Raster-wave background distortion for ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === 33) {
    const duration = Math.max(1, Math.abs(args[2] ?? args[3] ?? 12));
    const event = makeHgEvent(vm, command, "ChangeBackgroundColor", [0, Math.max(0, args[3] ?? 0), 16, duration, args[4] ?? 0], "supported", "Screen color fade");
    vm.timeline.push(event);
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === 34) {
    vm.timeline.push(makeHgEvent(vm, command, "ShadeActor", args, "marker", "Battler shade/fade marker"));
    return;
  }
  if (functionId === 36) {
    const duration = Math.max(1, Math.abs(args[3] ?? args[1] ?? 8));
    vm.timeline.push(makeHgEvent(vm, command, "ShakeSprite", [...args, duration], "marker", `Battler shake for ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === 52) {
    const event = makeBattlerSlideXEvent(vm, command, args);
    vm.timeline.push(event);
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + Math.max(1, event.actorMotion?.duration ?? 1));
    return;
  }
  if (functionId === 57) {
    const duration = Math.max(1, Math.abs(args[2] ?? 8));
    vm.timeline.push(makeHgEvent(vm, command, "MoveSprite", args, "marker", `Battler slide for ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === 65) {
    const applied = applyStraightEmitterMotion(vm, command, args);
    vm.timeline.push(
      makeHgEvent(
        vm,
        command,
        "StraightEmitter",
        args,
        applied ? "supported" : "unsupported",
        applied ? `Straight particle emitter ${args[0] ?? 0}` : `Straight particle emitter ${args[0] ?? 0} could not find a recent particle event`,
      ),
    );
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `callfunction 65 could not find particle emitter ${args[0] ?? 0}` });
    return;
  }
  if (functionId === 66) {
    const applied = applyParabolicEmitterMotion(vm, command, args);
    vm.timeline.push(
      makeHgEvent(
        vm,
        command,
        "ParabolicEmitter",
        args,
        applied ? "supported" : "unsupported",
        applied ? `Parabolic particle emitter ${args[0] ?? 0}` : `Parabolic particle emitter ${args[0] ?? 0} could not find a recent particle event`,
      ),
    );
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `callfunction 66 could not find particle emitter ${args[0] ?? 0}` });
    return;
  }
  if (functionId === 72) {
    const applied = applyRotatingEmitterMotion(vm, command, args);
    vm.timeline.push(
      makeHgEvent(
        vm,
        command,
        "RotatingEmitter",
        args,
        applied ? "supported" : "unsupported",
        applied ? `Rotating particle emitter ${args[0] ?? 0}` : `Rotating particle emitter ${args[0] ?? 0} could not find a recent particle event`,
      ),
    );
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `callfunction 72 could not find particle emitter ${args[0] ?? 0}` });
    return;
  }
  if (functionId === 78) {
    vm.timeline.push(makeHgEvent(vm, command, "SetupParticleResources", args, "marker", "Particle sprite resource setup"));
    return;
  }
  vm.timeline.push(makeHgEvent(vm, command, "callfunction", command.params, "unsupported", `callfunction ${functionId} marker`));
  vm.warnings.push({ frame: vm.frame, command: command.name, message: `callfunction ${functionId} is shown as a timeline marker only` });
}

function applyStraightEmitterMotion(vm: VmState, command: ParsedHgMoveAnimationCommand, args: number[]): boolean {
  const emitterId = Math.max(0, args[0] ?? 0);
  const offset = convertHgScreenDotOffset([args[1] ?? 0, args[2] ?? 0, 0]);
  const delay = Math.max(0, Math.abs(args[3] ?? 0));
  const duration = Math.max(1, Math.abs(args[4] ?? 12));
  const target = args[6] ?? 0;
  const loopWindow = Math.max(0, args[7] ?? 0);
  const dummyLoop = (loopWindow >>> 16) & 0xffff;
  const rawStopLoop = loopWindow & 0xffff;
  const freezeAtInitialSample = rawStopLoop !== 0;
  const wave = args[8] ?? 0;
  const event =
    findLatestParticleEventForEmitterSet(vm, emitterId) ??
    findLatestParticleEventAtCurrentFrame(vm) ??
    findLatestParticleEventForResource(vm, emitterId) ??
    findLatestParticleEventForSlot(vm, emitterId) ??
    findLatestParticleEvent(vm);
  if (!event?.particle) return false;

  const start = target === 1 ? hgRoleAnchor("defender", vm) : hgRoleAnchor("attacker", vm);
  const end = target === 1 ? hgRoleAnchor("attacker", vm) : hgRoleAnchor("defender", vm);
  const origin = event.particle.origin ?? start;
  const delta = add(sub(end, origin), offset);
  const startRatio = Math.max(0, Math.min(1, dummyLoop / duration));
  const from: Vec3 = startRatio <= 0 ? [0, 0, 0] : scaleVec(delta, startRatio);
  const to = freezeAtInitialSample ? from : delta;
  const motionDuration = freezeAtInitialSample ? duration : Math.max(1, duration - Math.min(dummyLoop, duration - 1));
  const waveAmplitude = wave ? Math.abs(convertHgParticleOffset([0, HG_SIN360_AMPLITUDE, 0])[1]) : undefined;

  event.particle.origin = origin;
  event.particle.destination = end;
  event.particle.originMotion = { from, to, duration: motionDuration, delay, easing: "linear", waveAmplitude };
  event.particle.axis = normalize(delta);
  event.particle.destinationTarget = target === 1 ? 3 : 4;
  event.particle.forceFollowMotion = !wave;
  event.particle.alignToMotion = true;
  event.particle.alignDirection = delta;
  event.particle.alignRotationOffset = Math.PI;
  event.particle.projectile = false;
  event.particle.foreshorten = false;
  event.message = `${event.message}; straight emitter ${target === 1 ? "target to user" : "user to target"} over ${duration} frame(s)`;
  event.debug = `${event.debug ? `${event.debug}\n` : ""}callfunction 65 emitter ${emitterId}, offset [${offset.map((value) => value.toFixed(2)).join(", ")}], delay ${delay}, duration ${duration}, height ${args[5] ?? 0}, target ${target}, loopWindow ${loopWindow}, wave ${wave}`;
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + delay + motionDuration + PARTICLE_EVENT_DURATION);
  return true;
}

function applyParabolicEmitterMotion(vm: VmState, command: ParsedHgMoveAnimationCommand, args: number[]): boolean {
  const emitterId = Math.max(0, args[0] ?? 0);
  const offset = convertHgScreenDotOffset([args[1] ?? 0, args[2] ?? 0, 0]);
  const duration = Math.max(1, Math.abs(args[4] ?? 12));
  const arcHeight = Math.abs(convertHgScreenDotOffset([0, args[5] ?? 64, 0])[1]);
  const event =
    findLatestParticleEventForEmitterSet(vm, emitterId) ??
    findLatestParticleEventAtCurrentFrame(vm) ??
    findLatestParticleEventForResource(vm, emitterId) ??
    findLatestParticleEventForSlot(vm, emitterId) ??
    findLatestParticleEvent(vm);
  if (!event?.particle) return false;

  const start = event.particle.origin ?? cmd37FallbackOrigin(event);
  const destination = event.particle.destinationTarget ?? opposingTarget(event.particle.sourceTarget ?? 3);
  const end = destination === event.particle.sourceTarget ? hgRoleAnchor("defender", vm) : hgPreviewAnchor(destination, vm);
  const delta = sub(end, start);
  event.particle.origin = start;
  event.particle.destination = end;
  event.particle.originMotion = { from: offset, to: add(delta, offset), duration, arcHeight, easing: "linear" };
  event.particle.axis = normalize(delta);
  event.particle.destinationTarget = destination === event.particle.sourceTarget ? 4 : destination;
  event.particle.forceFollowMotion = true;
  event.particle.alignToMotion = true;
  event.particle.alignDirection = delta;
  event.particle.alignRotationOffset = -Math.PI / 2;
  event.particle.projectile = false;
  event.particle.foreshorten = false;
  event.message = `${event.message}; parabolic emitter to target over ${duration} frame(s)`;
  event.debug = `${event.debug ? `${event.debug}\n` : ""}callfunction 66 emitter ${emitterId}, offset [${offset.map((value) => value.toFixed(2)).join(", ")}], arc ${arcHeight.toFixed(2)}`;
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration + PARTICLE_EVENT_DURATION);
  return true;
}

function applyRotatingEmitterMotion(vm: VmState, command: ParsedHgMoveAnimationCommand, args: number[]): boolean {
  const emitterId = Math.max(0, args[0] ?? 0);
  const duration = Math.max(1, Math.abs(args[7] ?? 1));
  const target = args[8] ?? 0;
  const particleSlot = args[9] ?? 0;
  const origin = target === 0 ? hgRoleAnchor("attacker", vm) : hgRoleAnchor("defender", vm);
  const rotation = {
    startAngleX: args[1] ?? 0,
    endAngleX: args[2] ?? args[1] ?? 0,
    startAngleY: args[3] ?? 0,
    endAngleY: args[4] ?? args[3] ?? 0,
    radiusX: convertHgScreenDotOffset([args[5] ?? 0, 0, 0])[0],
    radiusY: convertHgScreenDotOffset([0, args[6] ?? 0, 0])[1],
  };
  const from = rotatingEmitterOffset(rotation, duration, 0);
  const to = rotatingEmitterOffset(rotation, duration, duration);
  const event =
    findLatestParticleEventForEmitterSet(vm, emitterId) ??
    findLatestParticleEventAtCurrentFrame(vm) ??
    findLatestParticleEventForResource(vm, emitterId) ??
    findLatestParticleEventForSlot(vm, particleSlot) ??
    findLatestParticleEvent(vm);
  if (!event?.particle) return false;

  event.particle.origin = origin;
  event.particle.originMotion = { from, to, duration, easing: "linear", rotation };
  event.particle.forceFollowMotion = true;
  event.particle.projectile = false;
  event.particle.foreshorten = false;
  event.message = `${event.message}; rotating emitter around ${target === 0 ? "attacker" : "defender"} over ${duration} frame(s)`;
  event.debug = `${event.debug ? `${event.debug}\n` : ""}callfunction 72 emitter ${emitterId}, angleX ${rotation.startAngleX}->${rotation.endAngleX}, angleY ${rotation.startAngleY}->${rotation.endAngleY}, radii [${rotation.radiusX.toFixed(2)}, ${rotation.radiusY.toFixed(2)}], particle slot ${particleSlot}`;
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration + PARTICLE_EVENT_DURATION);
  return true;
}

type ParticleRotationMotion = NonNullable<NonNullable<NonNullable<MoveAnimationTimelineEvent["particle"]>["originMotion"]>["rotation"]>;

function rotatingEmitterOffset(rotation: ParticleRotationMotion, duration: number, frame: number): Vec3 {
  const t = Math.max(0, Math.min(1, (frame + 1) / Math.max(1, duration)));
  const angleX = degToRad(rotation.startAngleX + (rotation.endAngleX - rotation.startAngleX) * t);
  const angleY = degToRad(rotation.startAngleY + (rotation.endAngleY - rotation.startAngleY) * t);
  return [Math.sin(angleX) * rotation.radiusX, Math.cos(angleY) * rotation.radiusY, 0];
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function makeBattlerSlideXEvent(vm: VmState, command: ParsedHgMoveAnimationCommand, args: number[]): MoveAnimationTimelineEvent {
  const duration = Math.max(1, Math.abs(args[0] ?? 1));
  const offsetX = args[1] ?? 0;
  const targetFlags = args[2] ?? 0;
  const target = callfunction52Target(targetFlags);
  const supported = target !== undefined && (targetFlags & WE_TOOL_SSP) === WE_TOOL_SSP;
  const signedOffset = offsetX * callfunction52Direction(target);
  const offset = convertHgScreenDotOffset([signedOffset, 0, 0]);
  return makeHgEvent(
    vm,
    command,
    "BattlerSlideX",
    args,
    supported ? "supported" : "unsupported",
    supported ? `Slide ${target} battler sprite by ${offsetX} px over ${duration} frame(s)` : `Battler sprite slide has unsupported target flags ${targetFlags}`,
    supported
      ? {
          actorMotion: {
            target,
            offset,
            duration,
            easing: "linear",
          },
          debug: `callfunction 52 WEST_SP_WE_T05 wait ${duration}, offsetX ${offsetX}, target flags ${targetFlags}`,
        }
      : {},
  );
}

function callfunction52Target(flags: number): "user" | "target" | undefined {
  const actorFlags = flags & ~WE_TOOL_SSP;
  if (actorFlags === WE_TOOL_M1 || actorFlags === WE_TOOL_M2) return "user";
  if (actorFlags === WE_TOOL_E1 || actorFlags === WE_TOOL_E2) return "target";
  return undefined;
}

function callfunction52Direction(target: "user" | "target" | undefined): number {
  return target === "target" ? -1 : 1;
}

function convertHgScreenDotOffset(offset: Vec3): Vec3 {
  return convertHgParticleOffset([
    offset[0] * HG_PARTICLE_SCREEN_DOT,
    offset[1] * HG_PARTICLE_SCREEN_DOT,
    offset[2] * HG_PARTICLE_SCREEN_DOT,
  ]);
}

function emitHgBackgroundScroll(vm: VmState, command: ParsedHgMoveAnimationCommand, backgroundId: number): void {
  const flags = command.params[1] ?? 0;
  if (!hgBackgroundFlagSet(flags, HG_HAIKEI_SBIT_MOVE)) return;
  const rawX = vm.backgroundParams.get(0) ?? 0;
  const rawY = vm.backgroundParams.get(1) ?? 0;
  if (rawX === 0 && rawY === 0) return;
  const reversed = (vm.backgroundParams.get(6) ?? 0) !== 0;
  const direction = reversed ? -1 : 1;
  const speedX = cleanZero(Math.round((rawX * direction * 3) / 8));
  const speedY = cleanZero(Math.round((rawY * direction * 3) / 8));
  const params = [0, speedX, speedY, 9999, 0, 0];
  vm.timeline.push(makeHgEvent(vm, command, "MoveBackground", params, "supported", `Scroll background ${backgroundId} by ${speedX}, ${speedY} per frame`));
}

function emitHgBackgroundPaletteAnimation(vm: VmState, command: ParsedHgMoveAnimationCommand, backgroundId: number): void {
  const flags = command.params[1] ?? 0;
  if (hgBackgroundFlagSet(flags, HG_HAIKEI_SBIT_PLANM)) {
    vm.timeline.push(makeHgEvent(vm, command, "BackgroundPaletteAnimation", [backgroundId, 1], "marker", `Start BG palette animation for background ${backgroundId}`));
  }
  if (hgBackgroundFlagSet(flags, HG_HAIKEI_SBIT_PLANM_STOP)) {
    vm.timeline.push(makeHgEvent(vm, command, "BackgroundPaletteAnimation", [backgroundId, 0], "marker", `Stop BG palette animation for background ${backgroundId}`));
  }
  if (hgBackgroundFlagSet(flags, HG_HAIKEI_SBIT_STOP)) {
    vm.timeline.push(makeHgEvent(vm, command, "StopBackgroundScroll", [backgroundId], "marker", `Stop background scroll for background ${backgroundId}`));
  }
}

function hgBackgroundFlagSet(flags: number, unshiftedFlag: number): boolean {
  return ((flags >>> 16) & unshiftedFlag) === unshiftedFlag;
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function hgBackgroundWorkName(index: number): string {
  switch (index) {
    case 0:
      return "SPEED_X";
    case 1:
      return "SPEED_Y";
    case 2:
      return "BGPOS_X";
    case 3:
      return "BGPOS_Y";
    case 4:
      return "FADE_TYPE";
    case 5:
      return "FADE_VALUE";
    case 6:
      return "SPEED_R";
    case 7:
      return "SCREEN_R";
    default:
      return `GP_WORK_${index}`;
  }
}

function resolveHgBackgroundFrameIndex(vm: VmState): number {
  if (vm.scenario.contest) return 2;
  return hgBackgroundParamReversed(vm, 7) ? 1 : 0;
}

function hgBackgroundParamReversed(vm: VmState, gpIndex: number): boolean {
  const value = vm.backgroundParams.get(gpIndex) ?? 0;
  if (value === 0) return false;
  // In singles previews the defender is the opposite side from the attacker.
  return vm.scenario.attackerSide === "opponent";
}

function hgBackgroundEffect(backgroundId: number, flags: number): MoveAnimationTimelineEvent["backgroundEffect"] | undefined {
  if (backgroundId === 17 && hgBackgroundFlagSet(flags, HG_HAIKEI_SBIT_PLANM)) return "hgDiagonalBeam";
  return undefined;
}

function makeHgEvent(
  vm: VmState,
  command: ParsedHgMoveAnimationCommand,
  displayCommand: string,
  params: number[],
  status: MoveAnimationTimelineEvent["status"],
  message: string,
  extra: Partial<MoveAnimationTimelineEvent> = {},
): MoveAnimationTimelineEvent {
  return {
    id: `${vm.archiveKind}:${vm.fileId}:${command.offset}:${vm.frame}:${displayCommand}:${params.join("_")}`,
    frame: vm.frame,
    label: `${vm.archiveKind === "move" ? "a010" : "a061"}_${String(vm.fileId).padStart(3, "0")}`,
    command: displayCommand,
    params,
    status,
    message,
    sourceMoveId: vm.fileId,
    ...extra,
  };
}

function branchPc(vm: VmState, command: ParsedHgMoveAnimationCommand, paramIndex: number, fallbackPc: number): number {
  const offset = targetOffset(command, paramIndex);
  const targetPc = vm.commandIndexByOffset.get(offset);
  if (targetPc === undefined) {
    vm.warnings.push({ frame: vm.frame, command: command.name, message: `${command.name} target ${formatOffset(offset)} is outside the parsed script` });
    return fallbackPc;
  }
  return targetPc;
}

function targetOffset(command: ParsedHgMoveAnimationCommand, paramIndex: number): number {
  return command.branchTargets.find((target) => target.paramIndex === paramIndex)?.offset ?? -1;
}

function particleTarget(command: ParsedHgMoveAnimationCommand): number {
  if (command.name.toLowerCase() === "addparticle") return command.params[2] ?? 4;
  return command.params[command.params.length - 1] ?? 4;
}

function particleResourceId(command: ParsedHgMoveAnimationCommand): number {
  if (command.name.toLowerCase() === "addparticle2") return command.params[2] ?? 0;
  return command.params[1] ?? 0;
}

function opposingTarget(target: number): number {
  if (target === 3) return 4;
  if (target === 4 || target === 20) return 3;
  return target;
}

function applyCmd37ParticleTransform(vm: VmState, command: ParsedHgMoveAnimationCommand): void {
  const count = command.params[0] ?? 0;
  if (count === 4) {
    applyCmd37Offset(command, vm);
    return;
  }
  if (count === 5) {
    applyCmd37FieldData(command, vm);
    return;
  }
  if (count < 6) return;
  const targetMode = command.params[2] ?? 0;
  const positionMode = command.params[3] ?? 0;
  const axisMode = command.params[4] ?? 0;
  const fieldMode = command.params[5] ?? 0;
  const event = findLatestParticleEventAtCurrentFrame(vm) ?? findLatestParticleEvent(vm);
  if (!event?.particle) return;

  const operatorContext = { attackerSide: vm.scenario.attackerSide, contest: vm.scenario.contest, cameraMode: 0 as const };
  const origin = hgOperatorPosition(positionMode, targetMode, operatorContext) ?? cmd37Origin(positionMode, targetMode, vm, event);
  const source = origin ?? event.particle.origin ?? cmd37FallbackOrigin(event);
  const destination = cmd37Destination(axisMode, targetMode, vm);
  if (origin) event.particle.origin = origin;
  event.particle.destination = destination;
  if (axisMode !== 0) event.particle.axis = hgOperatorAxis(axisMode, targetMode, operatorContext) ?? normalize(sub(destination, source));
  if (axisMode === 0 && origin) event.particle.screenPlane = true;
  if (targetMode === CMD37_TARGET_DEFENDER || axisMode !== 0) event.particle.destinationTarget = 4;
  event.particle.field = { ...event.particle.field, mode: fieldMode, targetMode, positionMode, axisMode, cursor: 0 };

  if (positionMode === 6 && axisMode === 5 && targetMode === CMD37_TARGET_DEFENDER) {
    applyDefenderSideLaserProfile(event);
  }

  if (CMD37_USER_BEAM_MODES.has(positionMode) || CMD37_END_BEAM_MODES.has(positionMode)) {
    event.particle.foreshorten = false;
    event.particle.screenRotation = HG_BEAM_SCREEN_ROTATION;
  }
  event.message = `${event.message}; cmd37 ${hgOperatorPositionName(positionMode)} ${axisMode === 0 ? "position" : "axis"}`;
  event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 target ${targetMode}, position ${positionMode}, axis ${axisMode}, field ${fieldMode}`;
}

function applyDefenderSideLaserProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle) return;
  if (event.spaId === HG_POWDER_SNOW_SPA_ID) {
    applyHgPowderSnowPlacementProfile(event);
    return;
  }
  const origin: Vec3 = [USER_BATTLE_ANCHOR[0] + 3, USER_BATTLE_ANCHOR[1] + 1, USER_BATTLE_ANCHOR[2]];
  const target: Vec3 = [TARGET_BATTLE_ANCHOR[0] + 4, TARGET_BATTLE_ANCHOR[1] + 1, TARGET_BATTLE_ANCHOR[2]];
  event.particle.origin = origin;
  event.particle.axis = normalize(sub(target, origin));
  event.particle.destinationTarget = 4;
  event.particle.radiusMultiplier = event.particle.radiusMultiplier ?? 0.35;
  event.particle.beamTrail = { start: origin, alpha: 0.78, scale: 1.25 };
}

function applyHgPowderSnowPlacementProfile(event: MoveAnimationTimelineEvent): void {
  if (!event.particle) return;
  const axis = event.particle.axis ?? normalize(sub(TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR));
  event.particle.axis = normalize([axis[0], -0.3, axis[2]]);
  event.particle.foreshorten = false;
  event.particle.screenRotation = undefined;
  event.message = `${event.message}; HG Powder Snow broad flake cloud`;
}

function applyCmd37FieldData(command: ParsedHgMoveAnimationCommand, vm: VmState): void {
  const event = findLatestParticleEvent(vm);
  if (!event?.particle) return;
  const field = event.particle.field;
  const fieldMode = field?.mode ?? 0;
  const bit = nextCmd37FieldBit(fieldMode, field?.cursor ?? 0);
  if (!bit) return;
  event.particle.field = { ...field, mode: fieldMode, cursor: FIELD_OPERATOR_ORDER.indexOf(bit) + 1 };

  if (bit === OPERATOR_FLD_GRAVITY_MAG) {
    const gravity = cmd37FieldFx16Vector(command);
    if (!gravity) return;
    event.particle.field.gravityMagnitude = gravity;
    event.message = `${event.message}; cmd37 gravity field`;
    event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 field ${fieldMode} gravity [${gravity.map((value) => value.toFixed(4)).join(", ")}]`;
    return;
  }

  if (bit === OPERATOR_FLD_RANDOM_MAG) {
    const magnitude = cmd37FieldFx16Vector(command);
    if (!magnitude) return;
    event.particle.field.randomMagnitude = magnitude;
    event.message = `${event.message}; cmd37 random field magnitude`;
    event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 field ${fieldMode} random magnitude [${magnitude.map((value) => value.toFixed(4)).join(", ")}]`;
    return;
  }

  if (bit === OPERATOR_FLD_RANDOM_INTVL) {
    const interval = cmd37FieldInterval(command);
    if (interval === undefined) return;
    event.particle.field.randomIntervalFrames = interval;
    event.message = `${event.message}; cmd37 random field interval`;
    event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 field ${fieldMode} random interval ${interval}`;
    return;
  }

  if (bit === OPERATOR_FLD_MAGNET_POS || bit === OPERATOR_FLD_CONVERGENCE_POS) {
    const target = cmd37FieldTarget(command, vm, event, bit);
    if (!target) return;
    if (bit === OPERATOR_FLD_MAGNET_POS) event.particle.field.magnetTarget = target;
    else event.particle.field.convergenceTarget = target;
    event.message = `${event.message}; cmd37 ${bit === OPERATOR_FLD_MAGNET_POS ? "magnet" : "convergence"} field target`;
    event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 field ${fieldMode} target [${target.map((value) => value.toFixed(2)).join(", ")}]`;
    return;
  }

  if (bit === OPERATOR_FLD_MAGNET_MAG || bit === OPERATOR_FLD_CONVERGENCE_RATIO) {
    const force = cmd37FieldForce(command);
    if (force === undefined) return;
    if (bit === OPERATOR_FLD_MAGNET_MAG) event.particle.field.magnetForce = force;
    else event.particle.field.convergenceForce = force;
    event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 field ${fieldMode} force ${force.toFixed(4)}`;
  }
}

function nextCmd37FieldBit(fieldMode: number, cursor: number): number | undefined {
  for (let index = Math.max(0, cursor); index < FIELD_OPERATOR_ORDER.length; index += 1) {
    const bit = FIELD_OPERATOR_ORDER[index];
    if (bit !== 0 && (fieldMode & bit) !== 0) return bit;
  }
  return undefined;
}

function cmd37FieldFx16Vector(command: ParsedHgMoveAnimationCommand): Vec3 | undefined {
  const exMode = command.params[1] ?? 0;
  if (exMode !== OPERATOR_FLD_SET) return undefined;
  const reverse = (command.params[2] ?? 0) === OPERATOR_EX_REVERCE_OFF ? 1 : -1;
  return [
    ((command.params[3] ?? 0) / 4096) * reverse,
    ((command.params[4] ?? 0) / 4096) * reverse,
    ((command.params[5] ?? 0) / 4096) * reverse,
  ];
}

function cmd37FieldTarget(command: ParsedHgMoveAnimationCommand, vm: VmState, event: MoveAnimationTimelineEvent, bit: number): Vec3 | undefined {
  const exMode = command.params[1] ?? 0;
  const reverse = (command.params[2] ?? 0) === OPERATOR_EX_REVERCE_OFF ? 1 : -1;
  const raw = [command.params[3] ?? 0, command.params[4] ?? 0, command.params[5] ?? 0] as Vec3;
  const origin = event.particle?.origin ?? cmd37FallbackOrigin(event);
  const targetMode = event.particle?.field?.targetMode ?? CMD37_TARGET_DEFENDER;
  const operatorContext = { attackerSide: vm.scenario.attackerSide, contest: vm.scenario.contest, cameraMode: 0 as const };
  let absolute: Vec3 | undefined;
  switch (exMode) {
    case OPERATOR_FLD_SET:
      absolute = convertHgRawParticlePosition(scaleVec(raw, reverse));
      break;
    case OPERATOR_FLD_AT:
      absolute = hgOperatorPosition(1, targetMode, operatorContext) ?? copyAnchor(USER_BATTLE_ANCHOR);
      break;
    case OPERATOR_FLD_DF:
      absolute = hgOperatorPosition(2, targetMode, operatorContext) ?? copyAnchor(TARGET_BATTLE_ANCHOR);
      break;
    case OPERATOR_FLD_SET_DF: {
      const denominator = raw[1] || 1;
      const defender = hgOperatorPosition(2, targetMode, operatorContext) ?? copyAnchor(TARGET_BATTLE_ANCHOR);
      absolute = scaleVec(defender, raw[0] / denominator);
      break;
    }
    default:
      return undefined;
  }
  if (!absolute) return undefined;
  const local = sub(absolute, origin);
  return bit === OPERATOR_FLD_MAGNET_POS ? [local[0], local[1], absolute[2]] : local;
}

function cmd37FieldForce(command: ParsedHgMoveAnimationCommand): number | undefined {
  const exMode = command.params[1] ?? 0;
  if (exMode !== OPERATOR_FLD_SET) return undefined;
  const reverse = (command.params[2] ?? 0) === OPERATOR_EX_REVERCE_OFF ? 1 : -1;
  return ((command.params[3] ?? 0) / 4096) * reverse;
}

function cmd37FieldInterval(command: ParsedHgMoveAnimationCommand): number | undefined {
  const exMode = command.params[1] ?? 0;
  if (exMode !== OPERATOR_FLD_SET) return undefined;
  return Math.max(0, Math.round(command.params[3] ?? 0));
}

function applyCmd37Offset(command: ParsedHgMoveAnimationCommand, vm: VmState): void {
  const event = findLatestParticleEventAtCurrentFrame(vm) ?? findLatestParticleEvent(vm);
  if (!event?.particle) return;
  const targetMode = event.particle.field?.targetMode ?? CMD37_TARGET_DEFENDER;
  const positionMode = event.particle.field?.positionMode;
  const raw = [command.params[2] ?? 0, command.params[3] ?? 0, command.params[4] ?? 0] as Vec3;
  const reverseSign = cmd37PositionReverseSign(command.params[1] ?? 0, targetMode, vm);
  if (positionMode === OPERATOR_POS_SET) {
    const explicit = convertHgRawParticlePosition([raw[0] * reverseSign, raw[1] * reverseSign, raw[2]]);
    event.particle.origin = explicit;
    event.message = `${event.message}; cmd37 explicit position ${explicit.map((value) => value.toFixed(2)).join(", ")}`;
    event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 explicit base position from HG particle units [${command.params.slice(2, 5).join(", ")}]`;
    return;
  }

  const offsetSign = cmd37PositionModeUsesOffset(positionMode) ? reverseSign : 1;
  const offset = convertHgParticleOffset(scaleVec(raw, offsetSign));
  const origin = event.particle.origin ?? cmd37FallbackOrigin(event);
  event.particle.origin = add(origin, offset);
  event.message = `${event.message}; cmd37 offset ${offset.map((value) => value.toFixed(2)).join(", ")}`;
  event.debug = `${event.debug ? `${event.debug}\n` : ""}cmd37 offset from HG particle point units [${command.params.slice(2, 5).join(", ")}]`;
}

function cmd37PositionModeUsesOffset(positionMode: number | undefined): boolean {
  return (
    positionMode === OPERATOR_POS_SP_OFS ||
    positionMode === OPERATOR_POS_EP_OFS ||
    positionMode === OPERATOR_POS_AT_SIDE_OFS ||
    positionMode === OPERATOR_POS_DF_SIDE_OFS
  );
}

function cmd37PositionReverseSign(exMode: number, targetMode: number, vm: VmState): number {
  if (exMode === OPERATOR_EX_REVERCE_OFF) return 1;
  const attackerOnPlayerSide = vm.scenario.attackerSide === "player";
  const sourceOnAttackerSide = targetMode !== CMD37_TARGET_USER && targetMode !== 3;
  const sourceOnPlayerSide = sourceOnAttackerSide ? attackerOnPlayerSide : !attackerOnPlayerSide;
  return sourceOnPlayerSide ? 1 : -1;
}

function findLatestParticleEventForSlot(vm: VmState, slot: number): MoveAnimationTimelineEvent | undefined {
  for (let index = vm.timeline.length - 1; index >= 0; index -= 1) {
    const event = vm.timeline[index];
    if (event.effectKind === "spa" && event.particle && event.params[0] === slot) return event;
  }
  return undefined;
}

function findLatestParticleEventForResource(vm: VmState, resourceId: number): MoveAnimationTimelineEvent | undefined {
  for (let index = vm.timeline.length - 1; index >= 0; index -= 1) {
    const event = vm.timeline[index];
    if (event.effectKind === "spa" && event.particle && event.resourceId === resourceId) return event;
  }
  return undefined;
}

function findLatestParticleEventForEmitterSet(vm: VmState, emitterId: number): MoveAnimationTimelineEvent | undefined {
  for (let index = vm.timeline.length - 1; index >= 0; index -= 1) {
    const event = vm.timeline[index];
    if (event.effectKind === "spa" && event.particle && event.command === "addparticle2" && event.params[1] === emitterId) return event;
  }
  return undefined;
}

function findLatestParticleEventAtCurrentFrame(vm: VmState): MoveAnimationTimelineEvent | undefined {
  for (let index = vm.timeline.length - 1; index >= 0; index -= 1) {
    const event = vm.timeline[index];
    if (event.frame !== vm.frame) break;
    if (event.effectKind === "spa" && event.particle) return event;
  }
  return undefined;
}

function findLatestParticleEvent(vm: VmState): MoveAnimationTimelineEvent | undefined {
  for (let index = vm.timeline.length - 1; index >= 0; index -= 1) {
    const event = vm.timeline[index];
    if (event.effectKind === "spa" && event.particle) return event;
  }
  return undefined;
}

function cmd37Origin(positionMode: number, targetMode: number, vm: VmState, event: MoveAnimationTimelineEvent): Vec3 | undefined {
  switch (positionMode) {
    case 1:
    case 4:
      return hgOperatorEndpointPosition("attacker", targetMode, operatorContext(vm));
    case 2:
    case 5:
      return hgOperatorEndpointPosition("defender", targetMode, operatorContext(vm));
    case 3:
      return event.particle?.origin ?? cmd37FallbackOrigin(event);
    case 6:
    case 8:
    case 10:
    case 14:
    case 16:
    case 18:
    case 20:
    case 22:
    case 24:
    case 26:
      return hgOperatorEndpointPosition("attacker", targetMode, operatorContext(vm));
    case 7:
    case 9:
    case 11:
    case 15:
    case 17:
    case 19:
    case 21:
    case 23:
    case 25:
    case 27:
      return hgOperatorEndpointPosition("defender", targetMode, operatorContext(vm));
    case 12:
      return hgOperatorEndpointPosition("attackerSide", targetMode, operatorContext(vm));
    case 13:
      return hgOperatorEndpointPosition("defenderSide", targetMode, operatorContext(vm));
    default:
      return undefined;
  }
}

function cmd37FallbackOrigin(event: MoveAnimationTimelineEvent): Vec3 {
  const source = event.particle?.sourceTarget;
  if (source === 3 || source === EMTFUNC_AT_SIDE) return copyAnchor(USER_BATTLE_ANCHOR);
  if (source === 4 || source === EMTFUNC_DF_SIDE) return copyAnchor(TARGET_BATTLE_ANCHOR);
  return copyAnchor(CENTER_BATTLE_ANCHOR);
}

function cmd37Destination(axisMode: number, targetMode: number, vm: VmState): Vec3 {
  if (axisMode === 0) return hgOperatorEndpointPosition("defender", targetMode, operatorContext(vm));
  if (axisMode === 8 || axisMode === 17) return copyAnchor(CENTER_BATTLE_ANCHOR);
  if (axisMode === 4) return hgOperatorEndpointPosition("attackerSide", targetMode, operatorContext(vm));
  if (axisMode === 5) return hgOperatorEndpointPosition("defenderSide", targetMode, operatorContext(vm));
  if (axisMode === 2 || axisMode === 7 || axisMode === 9 || axisMode === 11 || axisMode === 13 || axisMode === 15 || axisMode === 19 || axisMode === 21) {
    return hgOperatorEndpointPosition("defender", targetMode, operatorContext(vm));
  }
  return hgOperatorEndpointPosition("attacker", targetMode, operatorContext(vm));
}

function hgPreviewAnchor(target: number, vm: VmState): Vec3 {
  return hgParticleTargetAnchor(target, vm) ?? copyAnchor(CENTER_BATTLE_ANCHOR);
}

function hgParticleTargetAnchor(target: number, vm: VmState): Vec3 | undefined {
  const callbackAnchor = hgEmitterCallbackAnchor(target, vm);
  if (callbackAnchor) return callbackAnchor;
  if (target === 17) return copyAnchor(CENTER_BATTLE_ANCHOR);
  if (target === 3) return hgRoleAnchor("attacker", vm);
  if (target === 4) return hgRoleAnchor("defender", vm);
  if (target === 8) return copyAnchor(CENTER_BATTLE_ANCHOR);
  return undefined;
}

function hgEmitterCallbackAnchor(callbackId: number, vm: VmState): Vec3 | undefined {
  switch (callbackId) {
    case EMTFUNC_ATTACK_POS:
    case EMTFUNC_ATTACK_POS_CR:
      return hgRoleAnchor("attacker", vm);
    case EMTFUNC_DEFENCE_POS:
      return hgRoleAnchor("defender", vm);
    case EMTFUNC_AT_SIDE:
      return hgRoleAnchor("attackerSide", vm);
    case EMTFUNC_DF_SIDE:
      return hgRoleAnchor("defenderSide", vm);
    case EMTFUNC_DUMMY:
    case EMTFUNC_FIELD_OPERATOR:
    default:
      return undefined;
  }
}

function hgRoleAnchor(endpoint: HgParticleOperatorEndpoint, vm: VmState): Vec3 {
  return hgOperatorEndpointPosition(endpoint, CMD37_TARGET_DEFENDER, operatorContext(vm));
}

function operatorContext(vm: VmState): { attackerSide: "player" | "opponent"; contest?: boolean; cameraMode: 0 } {
  return { attackerSide: vm.scenario.attackerSide, contest: vm.scenario.contest, cameraMode: 0 };
}

function cmd37Message(command: ParsedHgMoveAnimationCommand): string {
  if ((command.params[0] ?? 0) >= 6 && (command.params[3] ?? 0) === 6) return `Particle axis/position helper for slot ${command.params[1] ?? "?"}`;
  return "Particle axis/position marker";
}

function copyAnchor(anchor: readonly [number, number, number]): Vec3 {
  return [anchor[0], anchor[1], anchor[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 0.00001 ? [0, 1, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

function defaultMessage(command: ParsedHgMoveAnimationCommand): string {
  if (command.name.startsWith("playse")) return `${command.name} sound marker`;
  if (command.name.includes("sprite") || command.name.includes("resource")) return `${command.name} resource marker`;
  return `${command.name} marker`;
}

function supportedMarkerCommand(name: string): boolean {
  return (
    name.startsWith("playse") ||
    name === "playcry" ||
    name === "waitcry" ||
    name === "stopse" ||
    name.includes("sprite") ||
    name.includes("resource") ||
    name === "transform" ||
    name === "copymonsprite" ||
    name === "enablemonsprite"
  );
}

function loadHgMoveSpaNarc(state: HgMoveAnimationRom, warnings: MoveAnimationPreviewWarning[]): NARC | undefined {
  try {
    return state.archives.spa.narc;
  } catch (error) {
    warnings.push({ message: `${HG_MOVE_SPA_PATH}: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
}

function loadHgCellEffects(
  state: HgMoveAnimationRom,
  cellEffectIds: Array<{ key: string; charId: number; paletteId: number; cellId: number; animationId: number }>,
  warnings: MoveAnimationPreviewWarning[],
): Map<string, NitroCellEffect> {
  const effects = new Map<string, NitroCellEffect>();
  if (cellEffectIds.length === 0) return effects;
  const charNarc = loadHgEffectClactNarc(state, "char", cellEffectIds.map((effect) => effect.charId), warnings);
  const paletteNarc = loadHgEffectClactNarc(state, "palette", cellEffectIds.map((effect) => effect.paletteId), warnings);
  const cellNarc = loadHgEffectClactNarc(state, "cell", cellEffectIds.map((effect) => effect.cellId), warnings);
  const animationNarc = loadHgEffectClactNarc(state, "animation", cellEffectIds.map((effect) => effect.animationId), warnings);
  if (!charNarc || !paletteNarc || !cellNarc || !animationNarc) return effects;

  for (const request of cellEffectIds) {
    try {
      const characterBytes = requiredEffectClactFile(charNarc, request.charId, "wechar");
      const paletteBytes = requiredEffectClactFile(paletteNarc, request.paletteId, "wepltt");
      const cellBytes = requiredEffectClactFile(cellNarc, request.cellId, "wecell");
      const animationBytes = requiredEffectClactFile(animationNarc, request.animationId, "wecellanm");
      const effect = parseNitroCellEffect(request.key, request.charId, request.paletteId, request.cellId, request.animationId, characterBytes, paletteBytes, cellBytes, animationBytes);
      effects.set(request.key, effect);
      for (const warning of effect.warnings) warnings.push({ message: `CATS cell effect ${request.key}: ${warning}` });
    } catch (error) {
      warnings.push({ message: `CATS cell effect ${request.key}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return effects;
}

function uniqueCellEffectIds(timeline: MoveAnimationTimelineEvent[]): Array<{ key: string; charId: number; paletteId: number; cellId: number; animationId: number }> {
  const out = new Map<string, { key: string; charId: number; paletteId: number; cellId: number; animationId: number }>();
  for (const event of timeline) {
    if (event.effectKind !== "cell" || !event.cellEffect || !event.cellEffectId) continue;
    out.set(event.cellEffectId, {
      key: event.cellEffectId,
      charId: event.cellEffect.charId,
      paletteId: event.cellEffect.paletteId,
      cellId: event.cellEffect.cellId,
      animationId: event.cellEffect.animationId,
    });
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function hgCellEffectKey(charId: number, paletteId: number, cellId: number, animationId: number): string {
  return `${charId}:${paletteId}:${cellId}:${animationId}`;
}

function loadHgEffectClactNarc(
  state: HgMoveAnimationRom,
  kind: "char" | "palette" | "cell" | "animation",
  requestedIds: number[],
  warnings: MoveAnimationPreviewWarning[],
): NARC | undefined {
  const path = hgEffectClactPath(kind);
  try {
    return new NARC(state.rom.getFileByName(path));
  } catch {
    // HG-engine and retail ROM filename tables are not guaranteed to retain source paths.
  }

  const expectedStamp = hgEffectClactStamp(kind);
  const ids = uniqueSorted(requestedIds);
  let best: { narc: NARC; score: number } | undefined;
  for (const file of state.rom.files) {
    if (readAscii(file, 0, 4) !== "NARC") continue;
    try {
      const narc = new NARC(file);
      const score = scoreHgEffectClactNarc(narc, kind, expectedStamp, ids);
      if (score > (best?.score ?? 0)) best = { narc, score };
    } catch {
      // Keep scanning unrelated NARCs.
    }
  }
  if (best) return best.narc;
  warnings.push({ message: `Cannot find HG effectclact ${kind} NARC (${path})` });
  return undefined;
}

function scoreHgEffectClactNarc(narc: NARC, kind: "char" | "palette" | "cell" | "animation", expectedStamp: string, requestedIds: number[]): number {
  if (requestedIds.length > 0 && !requestedIds.every((id) => fileHasStamp(narc.files[id], expectedStamp))) return 0;
  let matchingFiles = 0;
  for (const file of narc.files) {
    if (fileHasStamp(file, expectedStamp)) matchingFiles += 1;
  }
  const expectedCount = hgEffectClactExpectedFileCount(kind);
  const countDistance = Math.abs(narc.files.length - expectedCount);
  const plausibleEffectClactSize = countDistance <= 4 || (narc.files.length >= 30 && narc.files.length <= 45);
  if (plausibleEffectClactSize && matchingFiles === narc.files.length) return 10_000 - countDistance;
  if (plausibleEffectClactSize && matchingFiles >= Math.floor(narc.files.length * 0.8)) return 9_000 + matchingFiles - countDistance;
  if (matchingFiles < 20) return 0;
  return matchingFiles - countDistance;
}

function hgEffectClactExpectedFileCount(kind: "char" | "palette" | "cell" | "animation"): number {
  return kind === "palette" ? 39 : 37;
}

function hgEffectClactPath(kind: "char" | "palette" | "cell" | "animation"): string {
  if (kind === "char") return HG_EFFECT_CLACT_CHAR_PATH;
  if (kind === "palette") return HG_EFFECT_CLACT_PLTT_PATH;
  if (kind === "cell") return HG_EFFECT_CLACT_CELL_PATH;
  return HG_EFFECT_CLACT_CELLANM_PATH;
}

function hgEffectClactStamp(kind: "char" | "palette" | "cell" | "animation"): string {
  if (kind === "char") return "RGCN";
  if (kind === "palette") return "RLCN";
  if (kind === "cell") return "RECN";
  return "RNAN";
}

function fileHasStamp(bytes: Uint8Array | undefined, stamp: string): boolean {
  if (!bytes || bytes.length < 4) return false;
  try {
    const raw = decompressNitroIfNeeded(bytes);
    return readAscii(raw, 0, 4) === stamp;
  } catch {
    return false;
  }
}

function requiredEffectClactFile(narc: NARC, fileId: number, label: string): Uint8Array {
  const bytes = narc.files[fileId];
  if (!bytes) throw new Error(`${label} file ${fileId} is missing`);
  return bytes;
}

function loadHgMoveBackground(state: HgMoveAnimationRom, backgroundId: number): NitroBackgroundImage {
  const entry = HG_MOVE_BACKGROUND_TABLE[backgroundId];
  if (!entry) throw new Error(`HG move background ${backgroundId} is not in the known background table`);
  const narc = new NARC(state.rom.getFileByName(HG_BATTLE_GFX_PATH));
  const characters = decompressNitroIfNeeded(requiredNarcFile(narc, entry.gfx, `background ${backgroundId} graphics`));
  const palette = decompressNitroIfNeeded(requiredNarcFile(narc, entry.palette, `background ${backgroundId} palette`));
  const tilemaps = HG_MOVE_BACKGROUND_TILEMAP_VARIANTS.get(backgroundId) ?? [entry.tilemap];
  const frameImages = tilemaps.map((tilemap, frameIndex) => {
    const screen = decompressNitroIfNeeded(requiredNarcFile(narc, tilemap, `background ${backgroundId} screen ${frameIndex}`));
    return parseNitroBackground(backgroundId, screen, characters, palette, { transparentIndexZero: false });
  });
  const [firstFrame] = frameImages;
  if (!firstFrame) throw new Error(`HG move background ${backgroundId} has no screen frame`);
  return frameImages.length > 1 ? { ...firstFrame, frameImages } : firstFrame;
}

function loadHgBackgroundPaletteAnimation(state: HgMoveAnimationRom, backgroundId: number): NitroBackgroundPaletteAnimation {
  const datId = HG_BACKGROUND_PLANM_DAT_IDS.get(backgroundId);
  if (datId === undefined) throw new Error(`HG move background ${backgroundId} has no PLANM table entry`);
  const narc = resolveHgPlanmNarc(state);
  if (!narc) throw new Error(`Cannot find ${HG_BATTLE_BG_PLANM_PATH} or a matching HG PLANM NARC in the ROM`);
  const dat = requiredPlanmFile(narc, datId, `background ${backgroundId} PLANM dat`);
  const paletteWarnings: string[] = [];
  const palettes = parseNitroPalette(requiredPlanmFile(narc, datId + 1, `background ${backgroundId} PLANM palette`), paletteWarnings);
  const frames = parseHgPlanmDat(dat);
  return { datId, paletteArcId: datId + 1, frames, palettes, warnings: paletteWarnings };
}

function resolveHgPlanmNarc(state: HgMoveAnimationRom): NARC | undefined {
  if (hgPlanmNarcCache.has(state)) return hgPlanmNarcCache.get(state) ?? undefined;

  for (const path of HG_BATTLE_BG_PLANM_CANDIDATE_PATHS) {
    try {
      const narc = new NARC(state.rom.getFileByName(path));
      if (isLikelyHgPlanmNarc(narc)) {
        hgPlanmNarcCache.set(state, narc);
        return narc;
      }
    } catch {
      // Retail/HG-engine ROM filename tables often do not preserve source paths.
    }
  }

  for (const file of state.rom.files) {
    if (readAscii(file, 0, 4) !== "NARC") continue;
    try {
      const narc = new NARC(file);
      if (isLikelyHgPlanmNarc(narc)) {
        hgPlanmNarcCache.set(state, narc);
        return narc;
      }
    } catch {
      // Keep scanning; many unrelated NARCs share the same container format.
    }
  }

  hgPlanmNarcCache.set(state, null);
  return undefined;
}

function isLikelyHgPlanmNarc(narc: NARC): boolean {
  let matchingPairs = 0;
  for (const datId of new Set(HG_BACKGROUND_PLANM_DAT_IDS.values())) {
    if (isLikelyHgPlanmDat(narc.files[datId]) && readAscii(narc.files[datId + 1] ?? new Uint8Array(), 0, 4) === "RLCN") matchingPairs += 1;
    if (matchingPairs >= 2) return true;
  }
  return matchingPairs > 0 && narc.files.length <= 80;
}

function isLikelyHgPlanmDat(bytes?: Uint8Array): boolean {
  if (!bytes || bytes.length < 128 + 128 * 2) return false;
  let paletteFrames = 0;
  for (let index = 0; index < 128; index += 1) {
    const paletteIndex = bytes[index] ?? 255;
    if (paletteIndex === 255) break;
    if (paletteIndex > 127) return false;
    paletteFrames += 1;
  }
  if (paletteFrames === 0) return false;
  for (let index = 0; index < Math.min(paletteFrames + 1, 128); index += 1) {
    const wait = readU16(bytes, 128 + index * 2);
    if (wait === 65432) return true;
    if (wait === 0 || wait > 600) return false;
  }
  return false;
}

function parseHgPlanmDat(bytes: Uint8Array): NitroBackgroundPaletteAnimation["frames"] {
  const frames: NitroBackgroundPaletteAnimation["frames"] = [];
  const paletteCountOffset = 0;
  const waitOffset = 128;
  for (let index = 0; index < 128; index += 1) {
    const paletteIndex = bytes[paletteCountOffset + index] ?? 255;
    if (paletteIndex === 255) break;
    if (waitOffset + index * 2 + 2 > bytes.length) break;
    const sourceWait = readU16(bytes, waitOffset + index * 2);
    if (sourceWait === 65432) break;
    // HeartGold's HaikeiSubSystem_PlAnm switches immediately, then waits `wait - 2` TCB ticks.
    frames.push({ paletteIndex, wait: Math.max(1, sourceWait - 2) });
  }
  if (frames.length === 0) throw new Error("PLANM dat contains no palette frames");
  return frames;
}

function decompressNitroIfNeeded(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function requiredNarcFile(narc: NARC, fileId: number, label: string): Uint8Array {
  const bytes = narc.files[fileId];
  if (!bytes) throw new Error(`${label} file ${fileId} is missing in ${HG_BATTLE_GFX_PATH}`);
  return bytes;
}

function requiredPlanmFile(narc: NARC, fileId: number, label: string): Uint8Array {
  const bytes = narc.files[fileId];
  if (!bytes) throw new Error(`${label} file ${fileId} is missing in ${HG_BATTLE_BG_PLANM_PATH}`);
  return bytes;
}

function hydrateHgTimelineDebug(
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
      event.fallbackReason ? `fallback: ${event.fallbackReason}` : "decoded texture",
    ].join(" / ");
    if (event.particle?.axis && resource?.drawType === 1 && resource.aspectRatio > 0 && resource.aspectRatio < 0.1) {
      event.particle.radiusMultiplier = event.particle.radiusMultiplier ?? 0.35;
    }
    if (!archive) warnings.push({ frame: event.frame, command: event.command, message: `SPA ${event.spaId} was not loaded for event debug` });
    else if (!resource) warnings.push({ frame: event.frame, command: event.command, message: `SPA ${event.spaId} resource ${event.resourceId} is missing; using archive fallback resource` });
  }
}

function hgEventDuration(event: MoveAnimationTimelineEvent): number {
  if (event.command === "wait") return Math.max(1, event.params[0] ?? 1);
  if (event.command === "ShakeScreen") return cameraEventDuration(event);
  if (event.actorMotion) return Math.max(1, event.actorMotion.duration);
  if (event.effectKind === "spa") return PARTICLE_EVENT_DURATION;
  if (event.effectKind === "cell") return Math.max(1, event.cellEffect?.duration ?? PARTICLE_EVENT_DURATION);
  if (event.command === "LoadBackground" || event.command === "ApplyBackground") return BACKGROUND_EVENT_DURATION;
  if (event.command === "ChangeBackgroundColor") return Math.max(1, event.params[3] ?? 1);
  if (event.command === "ShakeSprite" || event.command === "MoveSprite") return Math.max(1, event.params[event.params.length - 1] ?? 1);
  return 1;
}

type HgMoveBackgroundTableEntry = {
  gfx: number;
  palette: number;
  tilemap: number;
};

const HG_BACKGROUND_PLANM_DAT_IDS = new Map<number, number>([
  [0, 0],
  [1, 0],
  [2, 22],
  [3, 0],
  [4, 2],
  [5, 0],
  [7, 28],
  [14, 20],
  [17, 18],
  [19, 4],
  [22, 10],
  [28, 14],
  [29, 16],
  [38, 24],
  [48, 30],
  [52, 8],
  [53, 6],
  [57, 26],
  [58, 12],
]);

const HG_MOVE_BACKGROUND_TILEMAP_VARIANTS = new Map<number, number[]>([
  [0, [56, 57, 58]],
  [1, [56, 57, 58]],
  [3, [56, 57, 58]],
  [4, [56, 57, 58]],
  [5, [56, 57, 58]],
  [6, [60, 61, 62]],
  [8, [60, 61, 62]],
  [20, [80, 81, 82]],
  [21, [86, 87, 88]],
  [22, [90, 91, 92]],
  [25, [103, 103, 101]],
  [31, [115, 116, 117]],
  [37, [137, 138, 138]],
  [40, [147, 148, 149]],
  [41, [151, 152, 153]],
  [45, [161, 162, 163]],
  [58, [96, 97, 96]],
]);

const HG_MOVE_BACKGROUND_TABLE: HgMoveBackgroundTableEntry[] = [
  { gfx: 59, palette: 295, tilemap: 56 },
  { gfx: 59, palette: 295, tilemap: 56 },
  { gfx: 119, palette: 319, tilemap: 120 },
  { gfx: 59, palette: 295, tilemap: 56 },
  { gfx: 59, palette: 295, tilemap: 56 },
  { gfx: 59, palette: 330, tilemap: 56 },
  { gfx: 63, palette: 296, tilemap: 60 },
  { gfx: 142, palette: 334, tilemap: 143 },
  { gfx: 63, palette: 337, tilemap: 60 },
  { gfx: 64, palette: 297, tilemap: 65 },
  { gfx: 64, palette: 297, tilemap: 65 },
  { gfx: 119, palette: 320, tilemap: 120 },
  { gfx: 64, palette: 329, tilemap: 65 },
  { gfx: 64, palette: 336, tilemap: 65 },
  { gfx: 119, palette: 318, tilemap: 120 },
  { gfx: 70, palette: 300, tilemap: 66 },
  { gfx: 70, palette: 308, tilemap: 66 },
  { gfx: 119, palette: 317, tilemap: 120 },
  { gfx: 70, palette: 308, tilemap: 66 },
  { gfx: 75, palette: 301, tilemap: 76 },
  { gfx: 83, palette: 303, tilemap: 80 },
  { gfx: 89, palette: 305, tilemap: 86 },
  { gfx: 93, palette: 306, tilemap: 90 },
  { gfx: 94, palette: 307, tilemap: 95 },
  { gfx: 99, palette: 310, tilemap: 100 },
  { gfx: 102, palette: 311, tilemap: 103 },
  { gfx: 108, palette: 312, tilemap: 107 },
  { gfx: 108, palette: 348, tilemap: 107 },
  { gfx: 109, palette: 313, tilemap: 110 },
  { gfx: 111, palette: 314, tilemap: 112 },
  { gfx: 109, palette: 313, tilemap: 110 },
  { gfx: 118, palette: 316, tilemap: 115 },
  { gfx: 118, palette: 316, tilemap: 115 },
  { gfx: 118, palette: 316, tilemap: 115 },
  { gfx: 125, palette: 324, tilemap: 126 },
  { gfx: 130, palette: 326, tilemap: 131 },
  { gfx: 132, palette: 327, tilemap: 133 },
  { gfx: 139, palette: 332, tilemap: 137 },
  { gfx: 140, palette: 333, tilemap: 141 },
  { gfx: 145, palette: 335, tilemap: 146 },
  { gfx: 150, palette: 338, tilemap: 147 },
  { gfx: 154, palette: 339, tilemap: 151 },
  { gfx: 155, palette: 340, tilemap: 156 },
  { gfx: 157, palette: 341, tilemap: 158 },
  { gfx: 159, palette: 342, tilemap: 160 },
  { gfx: 164, palette: 343, tilemap: 161 },
  { gfx: 165, palette: 344, tilemap: 166 },
  { gfx: 46, palette: 290, tilemap: 47 },
  { gfx: 167, palette: 345, tilemap: 168 },
  { gfx: 167, palette: 347, tilemap: 168 },
  { gfx: 170, palette: 346, tilemap: 172 },
  { gfx: 72, palette: 299, tilemap: 73 },
  { gfx: 84, palette: 304, tilemap: 85 },
  { gfx: 79, palette: 302, tilemap: 77 },
  { gfx: 113, palette: 315, tilemap: 114 },
  { gfx: 123, palette: 323, tilemap: 124 },
  { gfx: 121, palette: 322, tilemap: 122 },
  { gfx: 135, palette: 331, tilemap: 136 },
  { gfx: 98, palette: 309, tilemap: 96 },
  { gfx: 135, palette: 351, tilemap: 136 },
  { gfx: 135, palette: 352, tilemap: 136 },
];

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function formatOffset(offset: number): string {
  return offset < 0 ? "unknown" : `0x${offset.toString(16).toUpperCase().padStart(4, "0")}`;
}
