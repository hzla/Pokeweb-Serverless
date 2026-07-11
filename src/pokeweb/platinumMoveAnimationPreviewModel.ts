import { CENTER_BATTLE_ANCHOR, TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "./battlePreviewAnchors";
import { readAscii } from "../nds/binary";
import { NARC } from "../nds/narc";
import {
  compilePlatinumMoveAnimationScript,
  parsePlatinumMoveAnimationBinary,
  platinumCallFuncName,
  type ParsedPlatinumMoveAnimationCommand,
  type PlatinumMoveAnimationRom,
} from "./platinumMoveAnimationModel";
import { parseNitroBackground, type NitroBackgroundImage } from "./nitroBg";
import { parseNitroCellEffect, parseNitroCellImage, type NitroCellEffect } from "./nitroCell";
import { parseSpaArchive, type SpaArchive } from "./nitroSpa";
import type { MoveAnimationPreview, MoveAnimationPreviewWarning, MoveAnimationTimelineEvent } from "./moveAnimationPreviewModel";
import { decompressNitro } from "./pokemonSpriteModel";

const DEFAULT_MAX_STEPS = 4096;
const DEFAULT_MAX_CALL_DEPTH = 16;
const PARTICLE_EVENT_DURATION = 45;
const LOAD_PARTICLE_DELAY = 2;
const BACKGROUND_EVENT_DURATION = 12;
const PLATINUM_BATTLE_BG_PATH = "battle/graphic/pl_batt_bg.narc";
const PLATINUM_BATTLE_OBJ_PATH = "battle/graphic/pl_batt_obj.narc";
const PLATINUM_EFFECT_CLACT_CHAR_PATH = "wazaeffect/effectclact/wechar.narc";
const PLATINUM_EFFECT_CLACT_PLTT_PATH = "wazaeffect/effectclact/wepltt.narc";
const PLATINUM_EFFECT_CLACT_CELL_PATH = "wazaeffect/effectclact/wecell.narc";
const PLATINUM_EFFECT_CLACT_CELLANM_PATH = "wazaeffect/effectclact/wecellanm.narc";
const PLATINUM_PIXEL_TO_WORLD = 0.18;
const PLATINUM_PARTICLE_ORIGIN_X = 120;
const PLATINUM_PARTICLE_ORIGIN_Y = 96;
const PLATINUM_PARTICLE_ATTACKER_SCREEN = {
  x: -15360 / 172 + PLATINUM_PARTICLE_ORIGIN_X,
  y: PLATINUM_PARTICLE_ORIGIN_Y + 6272 / 172,
};
const PLATINUM_PARTICLE_DEFENDER_SCREEN = {
  x: 13568 / 172 + PLATINUM_PARTICLE_ORIGIN_X,
  y: PLATINUM_PARTICLE_ORIGIN_Y - 2944 / 172,
};
const BATTLE_ANIM_VAR_BG_MOVE_STEP_X = 0;
const BATTLE_ANIM_VAR_BG_MOVE_STEP_Y = 1;
const BATTLE_ANIM_VAR_BG_MOVE_START_X = 2;
const BATTLE_ANIM_VAR_BG_MOVE_START_Y = 3;
const BATTLE_ANIM_VAR_BG_SCREEN_MODE = 7;
const BATTLE_BG_SCREEN_REVERSE_DEFAULT = 2;
const BATTLE_BG_SCREEN_REVERSE_NEVER = 0;
const BATTLE_BG_SWITCH_FLAG_MOVE = 0x02;
const BATTLE_BG_SWITCH_FLAG_STOP = 0x04;
const WE_TOOL_M1 = 0x0002;
const WE_TOOL_M2 = 0x0004;
const WE_TOOL_E1 = 0x0008;
const WE_TOOL_E2 = 0x0010;
const WE_TOOL_BG = 0x0400;
const EMTFUNC_FIELD_OPERATOR = 17;
const FN_HAIKEI_PAL_FADE = 33;
const FN_SSP_POKE_PAL_FADE = 34;
const FN_CAP_POKE_SCALE = 35;
const FN_WT_SHAKE = 36;
const FN_CAP_NORMAL_ALPHA_FADE = 38;
const FN_POKE_VANISH = 40;
const FN_SSP_POKE_SCALE = 42;
const FN_WE_T02 = 44;
const FN_WE_T22 = 45;
const FN_WE_057 = 49;
const FN_WE_MOVE = new Set([51, 52, 53, 54, 57]);
const FN_DISP_OUT = 61;
const FN_DISP_DEF = 62;
const FN_OAM_PAL_FADE = 63;
const FN_BG_SHAKE = 68;
const FN_MOSAIC = 69;
const FN_PALCOL_CHANGE = 74;
const FN_DISP_MOVE = 77;
const FN_RENDER_POKEMON_SPRITES = 78;
const WET02_START_Y_OFFSET = Math.floor(128 / 3) * 2;
const WET02_STOP_Y_HIGH = 512;
const WET02_STOP_Y_LOW = -412;
const OPERATOR_FLD_MAGNET_POS = 0x10;
const OPERATOR_FLD_CONVERGENCE_POS = 0x1000;
const OPERATOR_FLD_AT = 2;
const OPERATOR_FLD_DF = 3;
const OPERATOR_FLD_SET_DF = 4;
const PLATINUM_BATTLE_BACKDROP_COUNT = 23;
const PLATINUM_BATTLE_BACKDROP_CHR0 = 3;
const PLATINUM_BATTLE_BACKDROP_SCR = 2;
const PLATINUM_BATTLE_BACKDROP_PAL0 = 172;
const PLATINUM_BATTLE_GROUND_MINE_NCER = 128;
const PLATINUM_BATTLE_GROUND_ENEMY_NCER = 131;
const PLATINUM_BATTLE_GROUND_CANVAS = 256;
const PLATINUM_BATTLE_GROUND_MINE_X = 64;
const PLATINUM_BATTLE_GROUND_MINE_Y = 136;
const PLATINUM_BATTLE_GROUND_ENEMY_X = 192;
const PLATINUM_BATTLE_GROUND_ENEMY_Y = 88;
const PLATINUM_BATTLE_GROUND_GFX = [2, 7, 0, 10, 4, 9, 5, 1, 3, 6];
const PLATINUM_CATS_PLAYER = { x: 63, y: 124 };
const PLATINUM_CATS_ENEMY = { x: 192, y: 64 };
const PLATINUM_CATS_WE057_PLAYER = { x: 76, y: 120 };
const PLATINUM_CATS_WE057_ENEMY = { x: 144, y: 64 };
const PLATINUM_CATS_WE057_OAM_HEIGHT = 16;
const FN_CSP_WE_081 = 1;
const FN_CSP_WE_134 = 2;
const FN_CSP_WE_271 = 3;
const FN_CSP_WE_118 = 4;
const FN_CSP_WE_132 = 5;
const FN_CSP_WE_155 = 6;
const FN_CSP_WE_184 = 7;
const FN_CSP_WE_193 = 8;
const FN_CSP_WE_199 = 9;
const FN_CSP_WE_207_SUB = 10;
const FN_CSP_WE_212 = 11;
const FN_CSP_WE_259 = 12;
const FN_CSP_WE_226 = 13;
const FN_CSP_WE_286 = 14;
const FN_CSP_WE_288 = 15;
const FN_CSP_WE_320 = 16;
const FN_CSP_WE_333 = 17;
const FN_CSP_WE_252 = 18;
const FN_CSP_WE_269 = 19;
const FN_CSP_WE_270 = 20;
const FN_CSP_WE_274 = 21;
const FN_CSP_WE_232 = 22;
const FN_CSP_WE_275 = 23;
const FN_CSP_WE_338 = 24;
const FN_CSP_FREE = 25;
const FN_CSP_266 = 26;
const FN_CSP_090 = 27;
const WE081_WAIT = [[8, 2], [13, 1], [18, 3]] as const;

export type PlatinumMoveAnimationPreviewScenario = {
  attackerSide: "player" | "opponent";
  checkturn: 0 | 1;
  weatherIndex: number;
  contest: boolean;
  playerAttack: boolean;
  battleTerrainId?: number;
  battleBackdropId?: number;
  battleTimeZone?: 0 | 1 | 2;
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

type LoadedCellResource = {
  charId: number;
  paletteId: number;
  cellId: number;
  animationId: number;
};

type EmitterPlacement = {
  origin: Vec3;
  destination: Vec3;
  sourceTarget: number;
  destinationTarget: number;
  projectile: boolean;
  supported: boolean;
  message: string;
  axis?: Vec3;
  field?: NonNullable<MoveAnimationTimelineEvent["particle"]>["field"];
  screenPlane?: boolean;
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
  particleEvents: MoveAnimationTimelineEvent[];
  emitterSlots: Map<number, MoveAnimationTimelineEvent>;
  cellResources: Map<number, Partial<LoadedCellResource>>;
  pokemonSpriteCaps: Map<number, MoveAnimationTimelineEvent>;
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
  const resolvedScenario = { ...DEFAULT_PLATINUM_MOVE_ANIMATION_PREVIEW_SCENARIO, ...scenario };
  const timeline = executePlatinumAnimation(commands, fileId, resolvedScenario, warnings);
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
  const cellEffects = loadPlatinumCellEffects(state, uniqueCellEffectIds(timeline), warnings);
  hydratePlatinumCatsActors(timeline, cellEffects, resolvedScenario, warnings);
  hydratePlatinumCapActors(timeline);
  const battleScene = loadPlatinumBattleScene(state, resolvedScenario, warnings);

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
    cellEffects,
    battleScene,
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
    particleEvents: [],
    emitterSlots: new Map(),
    cellResources: new Map(),
    pokemonSpriteCaps: new Map(),
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
      emitParticleEvent(vm, command, command.params[0] ?? 0, command.params[1] ?? 0, command.params[2] ?? 0, nextPc);
      return nextPc;
    case "createemitterex":
      emitParticleEvent(vm, command, command.params[0] ?? 0, command.params[2] ?? 0, command.params[3] ?? 0, nextPc, command.params[1] ?? 0);
      return nextPc;
    case "createemitterformove":
      emitParticleEvent(vm, command, command.params[0] ?? 0, moveResourceId(vm, command), command.params[7] ?? 0, nextPc);
      return nextPc;
    case "createemitterforfriendlyfire":
      emitParticleEvent(vm, command, command.params[0] ?? 0, friendlyFireResourceId(vm, command), command.params[5] ?? 0, nextPc);
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
    case "initpokemonspritemanager":
      vm.pokemonSpriteCaps.clear();
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", "Initialize dropped Pokemon sprite caps"));
      return nextPc;
    case "loadpokemonspritedummyresources":
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Load dropped Pokemon sprite dummy resource ${command.params[0] ?? 0}`));
      return nextPc;
    case "addpokemonsprite":
      emitPlatinumPokemonSpriteCapEvent(vm, command);
      return nextPc;
    case "setpokemonspritevisible":
      setPlatinumPokemonSpriteCapVisible(vm, command, command.params[0] ?? 0, (command.params[1] ?? 0) !== 0);
      return nextPc;
    case "removepokemonsprite":
      removePlatinumPokemonSpriteCap(vm, command, command.params[0] ?? 0);
      return nextPc;
    case "freepokemonspritemanager":
      freePlatinumPokemonSpriteCaps(vm, command);
      return nextPc;
    case "initspritemanager": {
      const slot = command.params[0] ?? 0;
      vm.cellResources.set(slot, {});
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Initialize CATS cell resources in slot ${slot}`));
      return nextPc;
    }
    case "loadcharresobj": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.charId = command.params[1] ?? 0;
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Load CATS NCGR ${resource.charId} into slot ${slot}`));
      return nextPc;
    }
    case "loadplttres": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.paletteId = command.params[1] ?? 0;
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Load CATS NCLR ${resource.paletteId} into slot ${slot}`));
      return nextPc;
    }
    case "loadcellresobj": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.cellId = command.params[1] ?? 0;
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Load CATS NCER ${resource.cellId} into slot ${slot}`));
      return nextPc;
    }
    case "loadanimresobj": {
      const slot = command.params[0] ?? 0;
      const resource = ensureCellResource(vm, slot);
      resource.animationId = command.params[1] ?? 0;
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Load CATS NANR ${resource.animationId} into slot ${slot}`));
      return nextPc;
    }
    case "addspritewithfunc":
    case "addsprite":
      emitPlatinumCellEffectEvent(vm, command);
      return nextPc;
    case "freespritemanager": {
      const slot = command.params[0] ?? 0;
      vm.cellResources.delete(slot);
      vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Free CATS cell resource slot ${slot}`));
      return nextPc;
    }
    case "setextraparams": {
      const count = Math.max(0, command.params[0] ?? 0);
      vm.lastExtraParams = command.params.slice(1, 1 + count);
      vm.timeline.push(makePlatinumEvent(vm, command, "SetExtraParams", command.params, "marker", `Cache ${vm.lastExtraParams.length} extra parameter(s)`));
      return nextPc;
    }
    case "callfunc":
      emitCallFuncEvent(vm, command);
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

function emitParticleEvent(
  vm: VmState,
  command: ParsedPlatinumMoveAnimationCommand,
  psIndex: number,
  resourceId: number,
  callbackId: number,
  nextPc: number,
  emitterSlot?: number,
): void {
  const particleSystem = vm.particleSystems.get(psIndex);
  if (!particleSystem) {
    vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "unsupported", `${command.name} references unloaded particle system ${psIndex}`));
    vm.warnings.push({ frame: vm.frame, command: command.name, message: `${command.name} references unloaded particle system ${psIndex}` });
    return;
  }
  const placement = callbackId === EMTFUNC_FIELD_OPERATOR ? operatorPlacement(vm, nextPc) : callbackPlacement(vm, callbackId);
  const particle: NonNullable<MoveAnimationTimelineEvent["particle"]> = {
    sourceTarget: placement.sourceTarget,
    destinationTarget: placement.destinationTarget,
    origin: particleSystem.flipY ? flipY(placement.origin) : placement.origin,
    destination: particleSystem.flipY ? flipY(placement.destination) : placement.destination,
    projectile: placement.projectile,
    useResourceAnchor: true,
    invertResourceYAxis: true,
    invertTextureXAxis: true,
    invertTextureYAxis: true,
    dspreScreenRotation: true,
  };
  const axis = placement.axis ? (particleSystem.flipY ? flipY(placement.axis) : placement.axis) : undefined;
  if (axis) {
    particle.axis = axis;
    particle.alignToMotion = true;
    particle.alignDirection = axis;
    particle.alignRotationOffset = -Math.PI / 2;
    particle.forceAxisRotation = true;
    if (callbackId === EMTFUNC_FIELD_OPERATOR) particle.extendToDestination = true;
  }
  if (placement.field) particle.field = placement.field;
  if (placement.screenPlane) particle.screenPlane = true;
  if (particleSystem.projection === 0) particle.foreshorten = true;
  const event = makePlatinumEvent(vm, command, command.name, command.params, placement.supported ? "supported" : "unsupported", `${command.name} SPA ${particleSystem.spaId} resource ${resourceId}; ${placement.message}`, {
    effectKind: "spa",
    spaId: particleSystem.spaId,
    resourceId: Math.max(0, resourceId),
    particle,
  });
  vm.timeline.push(event);
  vm.particleEvents.push(event);
  if (emitterSlot !== undefined) vm.emitterSlots.set(emitterSlot, event);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + PARTICLE_EVENT_DURATION);
  if (!placement.supported) vm.warnings.push({ frame: vm.frame, command: command.name, message: `Emitter callback ${callbackId} uses fallback placement` });
}

function ensureCellResource(vm: VmState, slot: number): Partial<LoadedCellResource> {
  let resource = vm.cellResources.get(slot);
  if (!resource) {
    resource = {};
    vm.cellResources.set(slot, resource);
  }
  return resource;
}

function emitPlatinumCellEffectEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): void {
  const slot = command.params[0] ?? 0;
  const loaded = vm.cellResources.get(slot);
  const withCallback = command.name.toLowerCase() === "addspritewithfunc";
  const supportFuncId = withCallback ? command.params[1] ?? 0 : 0;
  const catsArgs = withCallback ? command.params.slice(9, 9 + Math.max(0, command.params[8] ?? 0)) : [];
  const charId = loaded?.charId ?? command.params[2] ?? 0;
  const paletteId = loaded?.paletteId ?? command.params[3] ?? charId;
  const cellId = loaded?.cellId ?? command.params[4] ?? charId;
  const animationId = loaded?.animationId ?? command.params[5] ?? cellId;
  const duration = platinumCellEffectDuration(supportFuncId);
  const cellEffectId = platinumCellEffectKey(charId, paletteId, cellId, animationId);
  const event = makePlatinumEvent(vm, command, command.name, command.params, "supported", `${command.name} CATS cell effect char ${charId}, palette ${paletteId}, cell ${cellId}, animation ${animationId}`, {
    effectKind: "cell",
    cellEffectId,
    cellEffect: {
      charId,
      paletteId,
      cellId,
      animationId,
      supportFuncId,
      origin: platinumCellEffectOrigin(vm, supportFuncId),
      scale: platinumCellEffectScale(supportFuncId),
      duration,
      catsArgs,
      catsAddMode: withCallback ? "callback" : "sprite",
    },
  });
  vm.timeline.push(event);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
}

function emitPlatinumPokemonSpriteCapEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): void {
  const role = command.params[0] ?? 0;
  const capId = command.params[2] ?? 0;
  const source = pokemonSpriteCapSource(vm, role);
  const event = makePlatinumEvent(vm, command, command.name, command.params, "supported", `Drop ${source} battler into Pokemon sprite cap ${capId}`, {
    effectKind: "cap",
    capEffect: {
      capId,
      source,
      duration: PARTICLE_EVENT_DURATION,
      modifiers: [],
    },
  });
  vm.timeline.push(event);
  vm.pokemonSpriteCaps.set(capId, event);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + PARTICLE_EVENT_DURATION);
}

function setPlatinumPokemonSpriteCapVisible(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, capId: number, visible: boolean): void {
  const cap = vm.pokemonSpriteCaps.get(capId);
  if (cap?.capEffect) {
    cap.capEffect.modifiers ??= [];
    cap.capEffect.modifiers.push({ kind: "visible", frame: vm.frame - cap.frame, visible });
    cap.capEffect.duration = Math.max(cap.capEffect.duration ?? 0, vm.frame - cap.frame + PARTICLE_EVENT_DURATION);
  }
  vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, cap ? "supported" : "unsupported", cap ? `Set Pokemon sprite cap ${capId} ${visible ? "visible" : "hidden"}` : `Pokemon sprite cap ${capId} is not active`));
}

function removePlatinumPokemonSpriteCap(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, capId: number): void {
  const cap = vm.pokemonSpriteCaps.get(capId);
  if (cap?.capEffect) cap.capEffect.duration = Math.max(1, vm.frame - cap.frame);
  vm.pokemonSpriteCaps.delete(capId);
  vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, cap ? "supported" : "marker", cap ? `Remove Pokemon sprite cap ${capId}` : `Remove inactive Pokemon sprite cap ${capId}`));
}

function freePlatinumPokemonSpriteCaps(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): void {
  for (const cap of vm.pokemonSpriteCaps.values()) {
    if (cap.capEffect) cap.capEffect.duration = Math.max(1, vm.frame - cap.frame);
  }
  const count = vm.pokemonSpriteCaps.size;
  vm.pokemonSpriteCaps.clear();
  vm.timeline.push(makePlatinumEvent(vm, command, command.name, command.params, "marker", `Free ${count} dropped Pokemon sprite cap${count === 1 ? "" : "s"}`));
}

function platinumCellEffectOrigin(vm: VmState, supportFuncId: number): Vec3 {
  const defender = defenderAnchor(vm);
  if (supportFuncId === 6) return [defender[0], defender[1] + 4.5, defender[2] + 1];
  if (supportFuncId === 9) return [defender[0], defender[1] - 3.5, defender[2] + 1];
  return [defender[0], defender[1] + 4.5, defender[2] + 1];
}

function platinumCellEffectScale(supportFuncId: number): number {
  if (supportFuncId === 6) return 1.35;
  if (supportFuncId === 7) return 1.25;
  if (supportFuncId === 9) return 1.1;
  return 1;
}

function platinumCellEffectDuration(supportFuncId: number): number {
  if (supportFuncId === 6) return 20;
  if (supportFuncId === 7) return 40;
  if (supportFuncId === 9) return 92;
  return PARTICLE_EVENT_DURATION;
}

function emitCallFuncEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand): void {
  const functionId = command.params[0] ?? 0;
  const args = command.params.slice(2);
  if (functionId === FN_WE_057) {
    const applied = applyPlatinumSurfWaveCats(vm);
    vm.timeline.push(makePlatinumEvent(vm, command, "SurfWaveCats", args, applied ? "supported" : "unsupported", applied ? "Drive DSPRE CATS Surf wave actor" : "Could not find Surf CATS actors to drive"));
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: "CallFunc 49 could not find preceding CATS wave actors" });
    return;
  }
  if (FN_WE_MOVE.has(functionId)) {
    const event = makePlatinumBattlerMoveEvent(vm, command, args);
    vm.timeline.push(event);
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + Math.max(1, event.actorMotion?.duration ?? 1));
    return;
  }
  if (functionId === FN_HAIKEI_PAL_FADE) {
    const wait = args[1] ?? 0;
    const start = args[2] ?? 0;
    const end = args[3] ?? 0;
    const duration = platinumPaletteFadeDuration(wait, start, end);
    vm.timeline.push(makePlatinumEvent(vm, command, "ChangeBackgroundColor", [0, start, end, duration, args[4] ?? 0], "supported", `Fade battle background color over ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === FN_SSP_POKE_PAL_FADE) {
    const target = actorForToolFlags(vm, args[0] ?? WE_TOOL_E1);
    const amount = Math.max(0, Math.min(1, (args[4] ?? 8) / 16));
    const tint = rgb555ToUnit(args[3] ?? 0x7fff, amount);
    vm.timeline.push(makePlatinumEvent(vm, command, "TintBattler", args, "supported", `Tint ${target} battler`, {
      actorVisual: { target, tint, duration: Math.max(1, Math.abs(args[5] ?? args[1] ?? 12)) },
    }));
    return;
  }
  if (functionId === FN_WT_SHAKE || functionId === FN_BG_SHAKE) {
    const duration = Math.max(1, (Math.max(1, Math.abs(args[2] ?? 1)) * Math.max(1, Math.abs(args[3] ?? 1))) * 4);
    const targetFlags = args[4] ?? WE_TOOL_E1;
    if (functionId === FN_BG_SHAKE || (targetFlags & WE_TOOL_BG) !== 0) {
      const event = makePlatinumEvent(vm, command, "ShakeScreen", [2, Math.abs(args[0] ?? 2) * 512, Math.abs(args[1] ?? 0) * 512, duration, 0, 1], "supported", `Shake screen for ${duration} frame(s)`);
      vm.timeline.push(event);
      vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
      return;
    }
    const target = actorForToolFlags(vm, targetFlags);
    vm.timeline.push(makePlatinumEvent(vm, command, "ShakeSprite", args, "marker", `Shake ${target} battler for ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === FN_POKE_VANISH) {
    const target = actorForToolFlags(vm, args[0] ?? WE_TOOL_E1);
    const hide = (args[1] ?? 0) !== 0;
    vm.timeline.push(makePlatinumEvent(vm, command, hide ? "HideBattler" : "ShowBattler", args, "supported", `${hide ? "Hide" : "Show"} ${target} battler`, {
      actorVisual: { target, visible: !hide, persist: true },
    }));
    return;
  }
  if (functionId === FN_SSP_POKE_SCALE) {
    const target = actorForToolFlags(vm, args[0] ?? WE_TOOL_E1);
    const scaleX = Math.max(0.05, (args[2] ?? 100) / 100);
    const scaleY = Math.max(0.05, (args[4] ?? 100) / 100);
    const duration = Math.max(1, (((args[6] ?? 1) >>> 16) & 0xffff) + ((args[7] ?? 1) & 0xffff) + (((args[7] ?? 1) >>> 16) & 0xffff));
    vm.timeline.push(makePlatinumEvent(vm, command, "ScaleBattler", args, "supported", `Scale ${target} battler`, {
      actorVisual: { target, scale: [scaleX, scaleY], duration },
    }));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === FN_CAP_NORMAL_ALPHA_FADE) {
    const events = makePlatinumActorAlphaFadeEvents(vm, command, args);
    for (const event of events) vm.timeline.push(event);
    const duration = Math.max(1, args[5] ?? 8);
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    return;
  }
  if (functionId === FN_CAP_POKE_SCALE) {
    const applied = applyPlatinumCapScale(vm, args);
    vm.timeline.push(makePlatinumEvent(vm, command, "ScalePokemonSpriteCap", args, applied ? "supported" : "unsupported", applied ? `Scale dropped Pokemon sprite cap ${args[7] ?? -1}` : `Could not find dropped Pokemon sprite cap ${args[7] ?? -1}`));
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `CallFunc ${functionId} could not find dropped Pokemon sprite cap ${args[7] ?? -1}` });
    return;
  }
  if (functionId === FN_OAM_PAL_FADE) {
    const applied = applyPlatinumCapPaletteFade(vm, args);
    vm.timeline.push(makePlatinumEvent(vm, command, "FadePokemonSpriteCap", args, applied ? "supported" : "unsupported", applied ? "Fade dropped Pokemon sprite cap palette" : "Could not find dropped Pokemon sprite cap for palette fade"));
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `CallFunc ${functionId} could not find dropped Pokemon sprite cap` });
    return;
  }
  if (functionId === FN_MOSAIC) {
    const applied = applyPlatinumCapMosaic(vm, args);
    vm.timeline.push(makePlatinumEvent(vm, command, "PixelatePokemonSpriteCap", args, applied ? "supported" : "unsupported", applied ? `Pixelate dropped Pokemon sprite cap ${args[0] ?? 0}` : `Could not find dropped Pokemon sprite cap ${args[0] ?? 0}`));
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `CallFunc ${functionId} could not find dropped Pokemon sprite cap ${args[0] ?? 0}` });
    return;
  }
  if (functionId === FN_RENDER_POKEMON_SPRITES) {
    const duration = Math.max(1, args[0] ?? 1);
    vm.timeline.push(makePlatinumEvent(vm, command, "RenderPokemonSpriteCaps", args, "supported", `Keep dropped Pokemon sprite caps rendered for ${duration} frame(s)`));
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
    for (const cap of vm.pokemonSpriteCaps.values()) {
      if (cap.capEffect) cap.capEffect.duration = Math.max(cap.capEffect.duration ?? 0, vm.frame - cap.frame + duration);
    }
    return;
  }
  if (functionId === FN_WE_T02 || functionId === FN_WE_T22) {
    emitPlatinumFunctionBackground(vm, command, args);
    return;
  }
  if (functionId === FN_DISP_OUT || functionId === FN_DISP_MOVE) {
    const event = makePlatinumOffscreenEvent(vm, command, args, functionId === FN_DISP_MOVE);
    vm.timeline.push(event);
    vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + Math.max(1, event.actorMotion?.duration ?? 1));
    return;
  }
  if (functionId === FN_DISP_DEF) {
    const target = actorForToolFlags(vm, args[0] ?? WE_TOOL_E1);
    vm.timeline.push(makePlatinumEvent(vm, command, "ResetBattlerPosition", args, "marker", `Reset ${target} battler position`));
    return;
  }
  if (functionId === FN_PALCOL_CHANGE) {
    const grayscale = (args[0] ?? 0) !== 0;
    vm.timeline.push(makePlatinumEvent(vm, command, "ChangeBackgroundColor", [0, grayscale ? 0 : 8, grayscale ? 8 : 0, 8, 0x4210], "supported", `${grayscale ? "Apply" : "Clear"} grayscale scene tint`));
    return;
  }
  if (functionId === 65 || functionId === 66) {
    const applied = applyPlatinumEmitterMotion(vm, args, functionId === 66);
    vm.timeline.push(makePlatinumEvent(vm, command, functionId === 66 ? "ParabolicEmitter" : "StraightEmitter", args, applied ? "supported" : "unsupported", applied ? `Move particle emitter ${args[0] ?? 0}` : `Could not find particle emitter ${args[0] ?? 0}`));
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `CallFunc ${functionId} could not find particle emitter ${args[0] ?? 0}` });
    return;
  }
  if (functionId === 72) {
    const applied = applyPlatinumRotatingEmitterMotion(vm, args);
    vm.timeline.push(makePlatinumEvent(vm, command, "RotatingEmitter", args, applied ? "supported" : "unsupported", applied ? `Rotate particle emitter ${args[0] ?? 0}` : `Could not find particle emitter ${args[0] ?? 0}`));
    if (!applied) vm.warnings.push({ frame: vm.frame, command: command.name, message: `CallFunc ${functionId} could not find particle emitter ${args[0] ?? 0}` });
    return;
  }
  vm.timeline.push(makePlatinumEvent(vm, command, "CallFunc", command.params, "marker", `${platinumCallFuncName(functionId) ?? `CallFunc ${functionId}`} marker`));
}

function applyPlatinumSurfWaveCats(vm: VmState): boolean {
  let applied = false;
  for (let index = vm.timeline.length - 1; index >= 0; index -= 1) {
    const event = vm.timeline[index];
    if (event.command === "FreeSpriteManager") break;
    if (event.effectKind !== "cell" || !event.cellEffect || event.cellEffect.catsAddMode !== "sprite") continue;
    event.cellEffect.catsSurfWave = true;
    event.cellEffect.duration = Math.max(event.cellEffect.duration ?? 0, 32);
    event.message = `${event.message}; Surf wave driven by DSPRE CallFunc 49`;
    vm.pendingUntil = Math.max(vm.pendingUntil, event.frame + event.cellEffect.duration);
    applied = true;
  }
  return applied;
}

function applyPlatinumCapScale(vm: VmState, args: number[]): boolean {
  const capId = args[7] ?? -1;
  const cap = vm.pokemonSpriteCaps.get(capId);
  if (!cap?.capEffect) return false;
  const divisor = Math.max(1, args[4] ?? 100);
  const startScale = (args[2] ?? divisor) / divisor;
  const endScale = (args[3] ?? divisor) / divisor;
  const cycles = Math.max(1, args[5] ?? 1);
  const packed = args[6] ?? 0x00010001;
  const upFrames = Math.max(1, (packed >>> 16) & 0xffff);
  const downFrames = Math.max(1, packed & 0xffff);
  const localFrame = vm.frame - cap.frame;
  const duration = cycles * (upFrames + downFrames);
  cap.capEffect.modifiers ??= [];
  cap.capEffect.modifiers.push({ kind: "scale", frame: localFrame, startScale, endScale, upFrames, downFrames, cycles });
  cap.capEffect.duration = Math.max(cap.capEffect.duration ?? 0, localFrame + duration);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
  return true;
}

function applyPlatinumCapPaletteFade(vm: VmState, args: number[]): boolean {
  const mode = args[0] ?? 0;
  const capId = capIdFromToolFlag(mode);
  const cap = capId >= 0 ? vm.pokemonSpriteCaps.get(capId) : undefined;
  if (!cap?.capEffect) return false;
  const duration = Math.max(1, args[1] ?? 1);
  const startAmount = args[3] ?? 0;
  const endAmount = args[4] ?? 16;
  const color = rgb555ToUnit(args[5] ?? 0x7fff, 1);
  const localFrame = vm.frame - cap.frame;
  cap.capEffect.modifiers ??= [];
  cap.capEffect.modifiers.push({
    kind: "tint",
    frame: localFrame,
    duration,
    startAmount,
    endAmount,
    color: [color[0], color[1], color[2]],
  });
  cap.capEffect.duration = Math.max(cap.capEffect.duration ?? 0, localFrame + duration);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
  return true;
}

function applyPlatinumCapMosaic(vm: VmState, args: number[]): boolean {
  const capId = args[0] ?? 0;
  const cap = vm.pokemonSpriteCaps.get(capId);
  if (!cap?.capEffect) return false;
  const step = args[1] ?? 1;
  const start = args[2] ?? 0;
  const end = step < 0 ? 0 : 15;
  const duration = Math.max(1, Math.ceil(Math.abs(end - start) / Math.max(1, Math.abs(step))) + 1);
  const localFrame = vm.frame - cap.frame;
  cap.capEffect.modifiers ??= [];
  cap.capEffect.modifiers.push({ kind: "mosaic", frame: localFrame, duration, start, end, step });
  cap.capEffect.duration = Math.max(cap.capEffect.duration ?? 0, localFrame + duration);
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration);
  return true;
}

function makePlatinumActorAlphaFadeEvents(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, args: number[]): MoveAnimationTimelineEvent[] {
  const capBits = args[0] ?? 1;
  const startAlpha = args[1] ?? 16;
  const endAlpha = args[2] ?? 16;
  const duration = Math.max(1, args[5] ?? 8);
  const targets: Array<"user" | "target"> = [];
  if ((capBits & 1) !== 0) targets.push("user");
  if ((capBits & 2) !== 0) targets.push("target");
  if (targets.length === 0) targets.push(actorForToolFlags(vm, WE_TOOL_E1));
  return targets.map((target) =>
    makePlatinumEvent(vm, command, "AlphaFadePokemonSprite", args, "supported", `Fade ${target} battler alpha ${startAlpha}/16 to ${endAlpha}/16`, {
      actorVisual: { target, opacity: Math.max(0, Math.min(1, endAlpha / 16)), duration },
    }),
  );
}

type PlatinumCapState = NonNullable<NonNullable<MoveAnimationTimelineEvent["capEffect"]>["states"]>[number];

function hydratePlatinumCapActors(timeline: MoveAnimationTimelineEvent[]): void {
  for (const event of timeline) {
    const cap = event.capEffect;
    if (event.effectKind !== "cap" || !cap) continue;
    const duration = Math.max(1, cap.duration ?? PARTICLE_EVENT_DURATION);
    const states: PlatinumCapState[] = [];
    for (let frame = 0; frame <= duration; frame += 1) {
      states.push(resolvePlatinumCapState(cap, frame));
    }
    cap.states = states;
    event.message = `${event.message}; ${states.length} frame cap state`;
  }
}

function resolvePlatinumCapState(cap: NonNullable<MoveAnimationTimelineEvent["capEffect"]>, frame: number): PlatinumCapState {
  let visible = true;
  let scaleX = 1;
  let scaleY = 1;
  let alpha = 1;
  let tint: [number, number, number, number] = [1, 1, 1, 0];
  let mosaic = 0;
  for (const modifier of cap.modifiers ?? []) {
    if (frame < modifier.frame) continue;
    const local = frame - modifier.frame;
    switch (modifier.kind) {
      case "visible":
        visible = modifier.visible;
        break;
      case "scale": {
        const per = Math.max(1, modifier.upFrames + (modifier.waitFrames ?? 0) + modifier.downFrames);
        const total = Math.max(1, per * modifier.cycles);
        if (local >= total) break;
        const cycleFrame = local % per;
        let value: number;
        if (cycleFrame < modifier.upFrames) value = lerp(modifier.startScale, modifier.endScale, cycleFrame / modifier.upFrames);
        else if (cycleFrame < modifier.upFrames + (modifier.waitFrames ?? 0)) value = modifier.endScale;
        else value = lerp(modifier.endScale, modifier.startScale, (cycleFrame - modifier.upFrames - (modifier.waitFrames ?? 0)) / modifier.downFrames);
        scaleX *= value;
        scaleY *= value;
        break;
      }
      case "alpha": {
        const t = Math.min(1, local / Math.max(1, modifier.duration));
        alpha *= lerp(modifier.startAlpha, modifier.endAlpha, t);
        break;
      }
      case "tint": {
        const t = Math.min(1, local / Math.max(1, modifier.duration));
        const amount = lerp(modifier.startAmount, modifier.endAmount, t) / 16;
        tint = [modifier.color[0], modifier.color[1], modifier.color[2], Math.max(0, Math.min(1, amount))];
        break;
      }
      case "mosaic": {
        if (local < modifier.duration) mosaic = Math.max(0, Math.min(15, modifier.start + modifier.step * local));
        else mosaic = modifier.end;
        break;
      }
    }
  }
  return {
    frame,
    visible,
    scaleX,
    scaleY,
    alpha,
    tint,
    mosaic,
  };
}

function makePlatinumBattlerMoveEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, args: number[]): MoveAnimationTimelineEvent {
  const count = Math.max(0, command.params[1] ?? 0);
  const duration = Math.max(1, Math.abs(args[0] ?? 1));
  const offsetX = args[1] ?? 0;
  const offsetY = count >= 4 ? args[2] ?? 0 : 0;
  const flags = args[Math.max(0, count - 1)] ?? WE_TOOL_E1;
  const target = actorForToolFlags(vm, flags);
  const sign = target === "user" ? 1 : -1;
  const offset = convertPlatinumPixelOffset([offsetX * sign, -offsetY, 0]);
  return makePlatinumEvent(vm, command, "BattlerMove", args, "supported", `Move ${target} battler by ${offsetX}, ${offsetY} over ${duration} frame(s)`, {
    actorMotion: { target, offset, duration, easing: "linear" },
  });
}

function makePlatinumOffscreenEvent(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, args: number[], modeInArgs: boolean): MoveAnimationTimelineEvent {
  const mode = modeInArgs ? args[0] ?? 0 : 0;
  const flagIndex = modeInArgs ? 1 : 0;
  const durationIndex = modeInArgs ? 2 : 1;
  const target = actorForToolFlags(vm, args[flagIndex] ?? WE_TOOL_E1);
  const duration = Math.max(1, Math.abs(args[durationIndex] ?? 1));
  const offscreenX = target === "user" ? -80 : 80;
  const offset = convertPlatinumPixelOffset([mode === 0 ? offscreenX : -offscreenX, 0, 0]);
  return makePlatinumEvent(vm, command, mode === 0 ? "MoveBattlerOffscreen" : "MoveBattlerOnscreen", args, "supported", `${mode === 0 ? "Move" : "Return"} ${target} battler over ${duration} frame(s)`, {
    actorMotion: { target, offset, duration, easing: "linear" },
  });
}

function emitPlatinumFunctionBackground(vm: VmState, command: ParsedPlatinumMoveAnimationCommand, args: number[]): void {
  const backgroundId = args[0] ?? 0;
  const reversed = (args[5] ?? 0) !== 0 && vm.scenario.attackerSide === "opponent";
  const sign = reversed ? -1 : 1;
  const posY = (args[2] ?? 0) * sign + (reversed ? -WET02_START_Y_OFFSET : WET02_START_Y_OFFSET);
  const speedY = (args[4] ?? 0) * sign;
  vm.activeBackgroundId = backgroundId;
  vm.backgroundMoveActive = true;
  vm.timeline.push(makePlatinumEvent(vm, command, "LoadBackground", args, "supported", `Load scrolling effect background ${backgroundId}`, {
    backgroundId,
    backgroundFrameIndex: reversed ? 1 : 0,
  }));
  vm.timeline.push(makePlatinumEvent(vm, command, "MoveBackground", [0, (args[3] ?? 0) * sign, speedY, 9999, 0, 0, (args[1] ?? 0) * sign, posY], "supported", `Scroll effect background ${backgroundId}`));
  vm.timeline.push(makePlatinumEvent(vm, command, "BackgroundAlpha", [0, 0, Math.min(args[6] ?? 16, 16), BACKGROUND_EVENT_DURATION], "supported", `Blend effect background ${backgroundId}`));
  const stopY = speedY < 0 ? WET02_STOP_Y_LOW : WET02_STOP_Y_HIGH;
  vm.timeline.push(makePlatinumEvent(vm, command, "StopBackgroundScroll", [backgroundId, stopY], "marker", `DSPRE stop line ${stopY}`));
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + BACKGROUND_EVENT_DURATION);
}

function applyPlatinumEmitterMotion(vm: VmState, args: number[], parabolic: boolean): boolean {
  const event = findPlatinumParticleEvent(vm, args[0] ?? 0);
  if (!event?.particle) return false;
  const delay = Math.max(0, Math.abs(args[3] ?? 0));
  const duration = Math.max(1, Math.abs(args[4] ?? 12));
  const height = Math.abs(args[5] ?? 0) * PLATINUM_PIXEL_TO_WORLD;
  const targetMode = args[6] ?? 0;
  const from = [0, 0, 0] as Vec3;
  const offset = convertPlatinumPixelOffset([args[1] ?? 0, -(args[2] ?? 0), 0]);
  const attacker = attackerAnchor(vm);
  const defender = defenderAnchor(vm);
  const destinationOffset = targetMode === 0 ? subVec(defender, attacker) : subVec(attacker, defender);
  const to = addVec(destinationOffset, offset);
  event.particle.originMotion = {
    from,
    to,
    duration,
    delay,
    arcHeight: parabolic ? height : undefined,
    easing: "linear",
  };
  event.particle.forceFollowMotion = true;
  event.particle.alignToMotion = true;
  event.particle.alignDirection = to;
  event.particle.alignRotationOffset = -Math.PI / 2;
  event.message = `${event.message}; ${parabolic ? "parabolic" : "straight"} DSPRE emitter motion`;
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + delay + duration + PARTICLE_EVENT_DURATION);
  return true;
}

function applyPlatinumRotatingEmitterMotion(vm: VmState, args: number[]): boolean {
  const event = findPlatinumParticleEvent(vm, args[0] ?? 0);
  if (!event?.particle) return false;
  const duration = Math.max(1, Math.abs(args[7] ?? 12));
  const radiusX = Math.abs(args[5] ?? 0) * PLATINUM_PIXEL_TO_WORLD;
  const radiusY = Math.abs(args[6] ?? 0) * PLATINUM_PIXEL_TO_WORLD;
  event.particle.originMotion = {
    from: [0, 0, 0],
    to: [0, 0, 0],
    duration,
    easing: "linear",
    rotation: {
      startAngleX: args[1] ?? 0,
      endAngleX: args[2] ?? 360,
      startAngleY: args[3] ?? 0,
      endAngleY: args[4] ?? 360,
      radiusX,
      radiusY,
    },
  };
  event.particle.forceFollowMotion = true;
  event.particle.projectile = false;
  event.message = `${event.message}; rotating DSPRE emitter motion`;
  vm.pendingUntil = Math.max(vm.pendingUntil, vm.frame + duration + PARTICLE_EVENT_DURATION);
  return true;
}

function findPlatinumParticleEvent(vm: VmState, emitterId: number): MoveAnimationTimelineEvent | undefined {
  const slotted = vm.emitterSlots.get(emitterId);
  if (slotted) return slotted;
  for (let index = vm.particleEvents.length - 1; index >= 0; index -= 1) {
    const event = vm.particleEvents[index];
    if (event.resourceId === emitterId) return event;
  }
  return vm.particleEvents[vm.particleEvents.length - 1];
}

function platinumPaletteFadeDuration(wait: number, start: number, end: number): number {
  const fadeValue = wait < 0 ? 2 + Math.abs(wait) : 2;
  const effectiveWait = wait < 0 ? 0 : wait;
  const steps = Math.max(1, Math.ceil(Math.abs(end - start) / fadeValue));
  return steps * (effectiveWait + 1);
}

function actorForToolFlags(vm: VmState, flags: number): "user" | "target" {
  const actorFlags = flags & ~(0x0100 | WE_TOOL_BG);
  const attacker = vm.scenario.attackerSide === "player" ? "user" : "target";
  const defender = vm.scenario.playerAttack ? attacker : vm.scenario.attackerSide === "player" ? "target" : "user";
  if ((actorFlags & (WE_TOOL_M1 | WE_TOOL_M2)) !== 0) return attacker;
  if ((actorFlags & (WE_TOOL_E1 | WE_TOOL_E2)) !== 0) return defender;
  return defender;
}

function attackerActor(vm: VmState): "user" | "target" {
  return vm.scenario.attackerSide === "player" ? "user" : "target";
}

function defenderActor(vm: VmState): "user" | "target" {
  if (vm.scenario.playerAttack) return attackerActor(vm);
  return vm.scenario.attackerSide === "player" ? "target" : "user";
}

function pokemonSpriteCapSource(vm: VmState, role: number): "user" | "target" {
  return role === 1 || role === 3 ? defenderActor(vm) : attackerActor(vm);
}

function capIdFromToolFlag(flag: number): number {
  for (let index = 0; index < 4; index += 1) {
    if ((flag & (0x2 << index)) !== 0) return index;
  }
  return -1;
}

function rgb555ToUnit(value: number, amount: number): [number, number, number, number] {
  return [((value & 0x1f) << 3) / 255, (((value >>> 5) & 0x1f) << 3) / 255, (((value >>> 10) & 0x1f) << 3) / 255, amount];
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
  const axis = normalizeVec(subVec(defender, attacker));
  switch (callbackId) {
    case 1:
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
      return projectilePlacement(attacker, defender, 3, 4, true, `callback ${callbackId} attacker to defender`, axis);
    case 6:
      return projectilePlacement(defender, attacker, 4, 3, true, "callback 6 defender to attacker", scaleVec(axis, -1));
    case 17:
      return genericPlacement(vm);
    case 18: {
      const placement = fixedPlacement(CENTER_BATTLE_ANCHOR, 17, true, "callback 18 SEP origin");
      placement.screenPlane = true;
      return placement;
    }
    case 19:
      return fixedPlacement(attackerSideAnchor(vm), 20, true, "callback 19 attacker side");
    case 20:
      return fixedPlacement(defenderSideAnchor(vm), 21, true, "callback 20 defender side");
    default:
      return fixedPlacement(defender, 4, false, `callback ${callbackId} fallback defender`);
  }
}

function operatorPlacement(vm: VmState, nextPc: number): EmitterPlacement {
  const first = extraDataParams(vm.commands[nextPc]);
  const second = extraDataParams(vm.commands[nextPc + 1]);
  const target = first[2] ?? 2;
  const pos = first[3] ?? 0;
  const axisMode = first[4] ?? 0;
  const fieldMode = first[5] ?? 0;
  let positionOffset: Vec3 = [0, 0, 0];
  let fieldTargetMode = -1;
  let fieldFractionN = 1;
  let fieldFractionD = 1;

  if (second.length) {
    if (pos === 4 || pos === 5 || pos === 12 || pos === 13) {
      positionOffset = platinumParticleScreenDeltaToWorld(vm, signed32(second[2] ?? 0) / 172, -signed32(second[3] ?? 0) / 172);
    } else {
      const mode = second[1] ?? -1;
      if (mode === OPERATOR_FLD_AT || mode === OPERATOR_FLD_DF) fieldTargetMode = mode;
      else if (mode === OPERATOR_FLD_SET_DF && (second[4] ?? 0) !== 0) {
        fieldTargetMode = OPERATOR_FLD_DF;
        fieldFractionN = second[3] ?? 1;
        fieldFractionD = second[4] ?? 1;
      }
    }
  }

  const swapClients = target === 1 || target === 3;
  const sourceClient = swapClients ? 1 : 0;
  const endClient = swapClients ? 0 : 1;
  const sourceForPosition = isOperatorStartPosition(pos) || pos === 12 ? sourceClient : endClient;
  const source = sourceForPosition === 0 ? attackerAnchor(vm) : defenderAnchor(vm);
  const end = endClient === 0 ? attackerAnchor(vm) : defenderAnchor(vm);
  let origin = addVec(source, positionOffset);
  if (pos === 30 || pos === 31 || pos === 32) origin = fixedOperatorPosition(vm, pos, sourceClient);

  const placement = projectilePlacement(origin, end, sourceForPosition === 0 ? 3 : 4, endClient === 0 ? 3 : 4, true, `field operator target=${target} pos=${pos} axis=${axisMode}`, undefined);
  placement.projectile = false;

  if (axisMode >= 1 && axisMode <= 21 && axisMode !== 3) placement.axis = platinumParticleAxisBetweenClients(vm, sourceClient, endClient);
  else if (axisMode === 24) {
    const [x, y] = PLATINUM_OPERATOR_AXIS_145[sourceClient === 0 ? 0 : 1];
    placement.axis = platinumParticleAxisToWorld(vm, x, y);
  } else if (axisMode === 26) {
    const mine = sourceClient === 0 ? vm.scenario.attackerSide === "player" : vm.scenario.attackerSide !== "player";
    placement.axis = platinumParticleAxisToWorld(vm, mine ? 3776 : -6000, mine ? 2112 : -2200);
  } else if (axisMode === 3) placement.axis = platinumParticleAxisToWorld(vm, -800, 1200);

  if (fieldTargetMode >= 0 && fieldMode !== 0) {
    let targetScreen = fieldTargetMode === OPERATOR_FLD_AT ? operatorClientScreenPoint(0) : operatorClientScreenPoint(1);
    if (fieldFractionD !== 1 || fieldFractionN !== 1) {
      const fraction = fieldFractionD === 0 ? 1 : fieldFractionN / fieldFractionD;
      targetScreen = {
        x: PLATINUM_PARTICLE_ORIGIN_X + (targetScreen.x - PLATINUM_PARTICLE_ORIGIN_X) * fraction,
        y: PLATINUM_PARTICLE_ORIGIN_Y + (targetScreen.y - PLATINUM_PARTICLE_ORIGIN_Y) * fraction,
      };
    }
    const targetAnchor = platinumParticleScreenToWorld(vm, targetScreen.x, targetScreen.y);
    placement.field = {};
    if ((fieldMode & OPERATOR_FLD_CONVERGENCE_POS) !== 0) {
      placement.field.convergenceTarget = targetAnchor;
      placement.field.convergenceTargetRelative = true;
    } else if ((fieldMode & OPERATOR_FLD_MAGNET_POS) !== 0) {
      placement.field.magnetTarget = targetAnchor;
      placement.field.magnetTargetRelative = true;
    }
  }

  return placement;
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
  axis?: Vec3,
): EmitterPlacement {
  return {
    origin: copyVec(originAnchor),
    destination: copyVec(destinationAnchor),
    sourceTarget,
    destinationTarget,
    projectile: true,
    supported,
    message,
    axis,
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

type PlatinumCatsActorState = NonNullable<NonNullable<MoveAnimationTimelineEvent["cellEffect"]>["catsActors"]>[number]["states"][number];

type PlatinumCatsActor = {
  id: number;
  capId: number;
  funcId: number;
  gp: number[];
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  flipY: boolean;
  visible: boolean;
  alpha: number;
  rotation: number;
  seq: number;
  seqFrame: number;
  seqTimer: number;
  finished: boolean;
  age: number;
  alive: boolean;
};

type PlatinumCatsContext = {
  attackerIsEnemy: boolean;
  atX: number;
  atY: number;
  dfX: number;
  dfY: number;
  seqCount: number;
};

function hydratePlatinumCatsActors(
  timeline: MoveAnimationTimelineEvent[],
  cellEffects: Map<string, NitroCellEffect>,
  scenario: PlatinumMoveAnimationPreviewScenario,
  warnings: MoveAnimationPreviewWarning[],
): void {
  const context = platinumCatsContext(scenario, 1);
  for (const event of timeline) {
    if (event.effectKind !== "cell" || !event.cellEffect || !event.cellEffectId) continue;
    const effect = cellEffects.get(event.cellEffectId);
    const ctx = { ...context, seqCount: Math.max(1, effect?.sequences.length ?? 1) };
    const actors = platinumCatsInitialActors(event, ctx);
    if (actors.length === 0) continue;
    const duration = event.cellEffect.catsSurfWave
      ? 32
      : platinumCatsEffectDuration(event.cellEffect.supportFuncId, event.cellEffect.catsArgs ?? []);
    const states = new Map<number, PlatinumCatsActorState[]>();
    for (const actor of actors) states.set(actor.id, []);
    for (let frame = 0; frame <= duration; frame += 1) {
      if (event.cellEffect.catsSurfWave) {
        for (const actor of actors) applyPlatinumCatsSurfWave(actor, frame, ctx);
      } else {
        for (const actor of actors) {
          if (actor.alive) {
            tickPlatinumCatsActor(actor, effect);
            runPlatinumCatsDriver(actor, ctx);
            actor.age += 1;
          }
        }
      }
      for (const actor of actors) states.get(actor.id)?.push(snapshotPlatinumCatsActor(actor, frame));
    }
    event.cellEffect.duration = Math.max(event.cellEffect.duration ?? 0, duration);
    event.cellEffect.catsActors = actors.map((actor) => ({
      id: actor.id,
      capId: actor.capId,
      funcId: actor.funcId,
      states: states.get(actor.id) ?? [],
    }));
    event.message = `${event.message}; ${actors.length} DSPRE CATS actor${actors.length === 1 ? "" : "s"}`;
    if (!effect) warnings.push({ frame: event.frame, command: event.command, message: `CATS actor states generated for ${event.cellEffectId}, but decoded cell graphics are unavailable` });
  }
}

function platinumCatsContext(scenario: PlatinumMoveAnimationPreviewScenario, seqCount: number): PlatinumCatsContext {
  const attackerIsEnemy = scenario.attackerSide === "opponent";
  const at = attackerIsEnemy ? PLATINUM_CATS_ENEMY : PLATINUM_CATS_PLAYER;
  const df = scenario.playerAttack ? at : attackerIsEnemy ? PLATINUM_CATS_PLAYER : PLATINUM_CATS_ENEMY;
  return { attackerIsEnemy, atX: at.x, atY: at.y, dfX: df.x, dfY: df.y, seqCount };
}

function platinumCatsInitialActors(event: MoveAnimationTimelineEvent, ctx: PlatinumCatsContext): PlatinumCatsActor[] {
  const cell = event.cellEffect;
  if (!cell) return [];
  const actors: PlatinumCatsActor[] = [];
  if (cell.catsAddMode === "sprite") {
    const capId = event.params[1] ?? 0;
    const seq = capId >= 0 && capId < ctx.seqCount ? capId : 0;
    actors.push(makePlatinumCatsActor(actors, ctx, { capId, funcId: -1, seq, x: ctx.dfX, y: ctx.dfY, baseX: ctx.dfX, baseY: ctx.dfY }));
    return actors;
  }
  const leader = makePlatinumCatsActor(actors, ctx, {
    capId: 0,
    funcId: cell.supportFuncId,
    gp: cell.catsArgs ?? [],
    x: ctx.dfX,
    y: ctx.dfY,
    baseX: ctx.dfX,
    baseY: ctx.dfY,
  });
  actors.push(leader);
  setupPlatinumCats(leader, actors, ctx);
  return actors;
}

function makePlatinumCatsActor(
  actors: PlatinumCatsActor[],
  ctx: PlatinumCatsContext,
  init: Partial<PlatinumCatsActor> & { capId: number; funcId: number },
): PlatinumCatsActor {
  const actor: PlatinumCatsActor = {
    id: actors.length,
    capId: init.capId,
    funcId: init.funcId,
    gp: init.gp?.slice() ?? [],
    x: init.x ?? ctx.dfX,
    y: init.y ?? ctx.dfY,
    baseX: init.baseX ?? init.x ?? ctx.dfX,
    baseY: init.baseY ?? init.y ?? ctx.dfY,
    scaleX: init.scaleX ?? 1,
    scaleY: init.scaleY ?? 1,
    flipX: init.flipX ?? false,
    flipY: init.flipY ?? false,
    visible: init.visible ?? true,
    alpha: init.alpha ?? 1,
    rotation: init.rotation ?? 0,
    seq: 0,
    seqFrame: 0,
    seqTimer: 0,
    finished: false,
    age: init.age ?? 0,
    alive: init.alive ?? true,
  };
  setPlatinumCatsSeq(actor, init.seq ?? 0, ctx);
  return actor;
}

function addPlatinumCatsActor(actors: PlatinumCatsActor[], ctx: PlatinumCatsContext, init: Partial<PlatinumCatsActor> & { capId: number; funcId: number }): PlatinumCatsActor {
  const actor = makePlatinumCatsActor(actors, ctx, init);
  actors.push(actor);
  return actor;
}

function setPlatinumCatsSeq(actor: PlatinumCatsActor, seq: number, ctx: PlatinumCatsContext): void {
  actor.seq = Math.max(0, Math.min(Math.max(0, ctx.seqCount - 1), Math.round(seq)));
  actor.seqFrame = 0;
  actor.seqTimer = 0;
  actor.finished = false;
}

function setupPlatinumCats(leader: PlatinumCatsActor, actors: PlatinumCatsActor[], ctx: PlatinumCatsContext): void {
  switch (leader.funcId) {
    case FN_CSP_WE_207_SUB:
      leader.visible = false;
      break;
    case FN_CSP_WE_226:
      leader.x = leader.baseX = ctx.atX;
      leader.y = leader.baseY = ctx.atY;
      break;
    case FN_CSP_FREE:
      if (leader.gp.length >= 2) {
        leader.x += leader.gp[0] ?? 0;
        leader.y += leader.gp[1] ?? 0;
        leader.baseX = leader.x;
        leader.baseY = leader.y;
      }
      break;
    case FN_CSP_WE_270: {
      const seqs = [0, 0, 1, 1, 2, 3];
      const xs = [-32, 32, -32, 32, -32, 32];
      const ys = [-24, -24, 24, 24, 0, 0];
      for (let i = 0; i < 6; i += 1) {
        const actor = i === 0 ? leader : addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_270, seq: 0 });
        actor.capId = i;
        actor.x = actor.baseX = 128 + (xs[i] ?? 0);
        actor.y = actor.baseY = 80 + (ys[i] ?? 0);
        actor.flipX = i === 0 || i === 3;
        setPlatinumCatsSeq(actor, seqs[i] ?? 0, ctx);
      }
      break;
    }
    case FN_CSP_WE_275: {
      const py = ctx.attackerIsEnemy ? 84 : 140;
      const xo = [-24, -8, 8, 24];
      const flips = [false, true, true, false];
      for (let i = 0; i < 4; i += 1) {
        const actor = i === 0 ? leader : addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_275, seq: 0 });
        actor.capId = i;
        actor.x = actor.baseX = ctx.atX + (xo[i] ?? 0);
        actor.y = actor.baseY = py;
        actor.flipX = flips[i] ?? false;
        actor.visible = false;
      }
      break;
    }
    case FN_CSP_WE_274:
      for (let i = 0; i < 12; i += 1) {
        const actor = i === 0 ? leader : addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_274, seq: 0 });
        actor.capId = i;
        actor.x = actor.baseX = 40 + (i * 53) % 180;
        actor.y = actor.baseY = 30 + (i * 37) % 120;
        actor.visible = false;
      }
      break;
    case FN_CSP_WE_338:
      for (let i = 0; i < 8; i += 1) {
        const f = i / 7;
        const actor = i === 0 ? leader : addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_338, seq: 0 });
        actor.capId = i;
        actor.x = actor.baseX = ctx.atX + (ctx.dfX - ctx.atX) * f;
        actor.y = actor.baseY = ctx.atY + (ctx.dfY - ctx.atY) * f;
        actor.flipX = (i & 1) !== 0;
        actor.visible = false;
      }
      break;
    case FN_CSP_WE_320:
      leader.x = leader.baseX = ctx.atX;
      leader.y = leader.baseY = ctx.atY;
      leader.visible = false;
      setPlatinumCatsSeq(leader, 0, ctx);
      for (let i = 1; i < 15; i += 1) {
        addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_320, seq: i % 3, x: ctx.atX, y: ctx.atY, baseX: ctx.atX, baseY: ctx.atY, visible: false });
      }
      break;
    case FN_CSP_WE_288:
      leader.x = leader.baseX = ctx.atX;
      leader.y = leader.baseY = ctx.atY;
      leader.visible = false;
      for (let i = 1; i < 6; i += 1) {
        addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_288, seq: 0, x: ctx.atX, y: ctx.atY, baseX: ctx.atX, baseY: ctx.atY, visible: false });
      }
      break;
    case FN_CSP_WE_269:
      leader.x = leader.baseX = 128;
      leader.y = leader.baseY = 80;
      if (ctx.attackerIsEnemy && ctx.seqCount > 1) setPlatinumCatsSeq(leader, 1, ctx);
      leader.alpha = 0.5;
      break;
    case FN_CSP_090:
      leader.x = leader.baseX = ctx.dfX;
      leader.y = leader.baseY = ctx.attackerIsEnemy ? 126 : 32;
      if (ctx.seqCount > 1) setPlatinumCatsSeq(leader, ctx.attackerIsEnemy ? 1 : 0, ctx);
      break;
    case FN_CSP_WE_259:
      for (let i = 0; i < 6; i += 1) {
        const ang = Math.floor(i / 2) * 30 * Math.PI / 180;
        const cxo = Math.cos(ang) * 48;
        const cyo = Math.sin(ang) * 48;
        const right = i % 2 === 0;
        const actor = i === 0 ? leader : addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_259, seq: 0 });
        actor.capId = i;
        actor.x = ctx.atX + (right ? cxo : -cxo);
        actor.y = ctx.atY - cyo;
        actor.flipX = right;
        actor.visible = false;
      }
      break;
    case FN_CSP_WE_118: {
      const vec = ctx.attackerIsEnemy ? -1 : 1;
      leader.baseX = ctx.atX;
      leader.baseY = ctx.atY;
      leader.x = ctx.atX + 40 * vec;
      leader.y = ctx.atY;
      leader.scaleX = 0.1;
      leader.scaleY = 0.1;
      if (ctx.attackerIsEnemy && ctx.seqCount > 1) setPlatinumCatsSeq(leader, 1, ctx);
      break;
    }
    case FN_CSP_WE_132:
      leader.x = ctx.dfX;
      leader.y = ctx.dfY + 16;
      leader.capId = 0;
      for (let i = 1; i < 4; i += 1) {
        addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_132, seq: 0, x: ctx.dfX, y: ctx.dfY + 16 - i * 10, baseX: ctx.dfX, baseY: ctx.dfY, flipX: (i & 1) !== 0 });
      }
      break;
    case FN_CSP_WE_155:
      leader.x = leader.baseX = ctx.atX;
      leader.y = leader.baseY = ctx.atY;
      break;
    case FN_CSP_WE_134:
      leader.x = leader.baseX = ctx.atX;
      leader.y = leader.baseY = ctx.atY;
      leader.alpha = 0;
      for (let i = 1; i <= 2; i += 1) {
        addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_134, seq: 0, x: ctx.atX, y: ctx.atY, baseX: ctx.atX, baseY: ctx.atY, alpha: 0, visible: false });
      }
      break;
    case FN_CSP_WE_286:
      leader.x = leader.baseX = ctx.dfX;
      leader.y = leader.baseY = ctx.dfY;
      leader.capId = 0;
      leader.visible = false;
      if (ctx.seqCount > 1) setPlatinumCatsSeq(leader, 1, ctx);
      for (let i = 1; i <= 2; i += 1) {
        addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_286, seq: 0, x: ctx.dfX, y: ctx.dfY, baseX: ctx.dfX, baseY: ctx.dfY, visible: false });
      }
      break;
    case FN_CSP_WE_184: {
      const vec = ctx.attackerIsEnemy ? -1 : 1;
      leader.baseX = ctx.atX;
      leader.baseY = ctx.atY;
      leader.x = ctx.atX + 32 * vec;
      leader.y = ctx.atY;
      leader.scaleX = 0.5;
      leader.scaleY = 0.5;
      break;
    }
    case FN_CSP_WE_271:
      leader.x = leader.baseX = 100;
      leader.y = leader.baseY = 54;
      leader.capId = 0;
      addPlatinumCatsActor(actors, ctx, { capId: 1, funcId: FN_CSP_WE_271, seq: 0, x: 180, y: 39, baseX: 180, baseY: 39 });
      break;
    case FN_CSP_WE_232: {
      leader.x = ctx.dfX - 32;
      leader.y = ctx.dfY;
      leader.flipX = true;
      leader.capId = 0;
      const placements = [
        { dx: -32, dy: 32, flipX: true },
        { dx: 32, dy: 0, flipX: false },
        { dx: 32, dy: 32, flipX: false },
      ];
      for (let i = 0; i < placements.length; i += 1) {
        const placement = placements[i];
        addPlatinumCatsActor(actors, ctx, { capId: i + 1, funcId: FN_CSP_WE_232, seq: 0, x: ctx.dfX + placement.dx, y: ctx.dfY + placement.dy, baseX: ctx.dfX, baseY: ctx.dfY, flipX: placement.flipX });
      }
      break;
    }
    case FN_CSP_WE_081: {
      const count = Math.max(1, leader.gp[0] ?? 1);
      leader.y = leader.baseY + 32;
      for (let i = 1; i < count; i += 1) {
        addPlatinumCatsActor(actors, ctx, { capId: i, funcId: FN_CSP_WE_081, seq: 0, gp: leader.gp, x: ctx.dfX, y: ctx.dfY + (32 - i * 4), baseX: ctx.dfX, baseY: ctx.dfY });
      }
      break;
    }
  }
}

function tickPlatinumCatsActor(actor: PlatinumCatsActor, effect?: NitroCellEffect): void {
  const sequence = effect?.sequences[actor.seq];
  const frames = sequence?.frames;
  if (!frames?.length) {
    actor.finished = true;
    return;
  }
  const loops = Boolean(sequence?.loop);
  if (actor.finished && !loops) return;
  actor.seqTimer += 1;
  const current = frames[Math.min(actor.seqFrame, frames.length - 1)];
  if (actor.seqTimer < Math.max(1, current.duration)) return;
  actor.seqTimer = 0;
  actor.seqFrame += 1;
  if (actor.seqFrame < frames.length) return;
  if (loops) actor.seqFrame = 0;
  else {
    actor.seqFrame = frames.length - 1;
    actor.finished = true;
  }
}

function runPlatinumCatsDriver(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  switch (actor.funcId) {
    case FN_CSP_WE_207_SUB:
      drivePlatinumCats207Sub(actor, ctx);
      break;
    case FN_CSP_WE_081:
      drivePlatinumCats081(actor);
      break;
    case FN_CSP_WE_333:
      drivePlatinumCats333(actor, ctx);
      break;
    case FN_CSP_WE_232:
      drivePlatinumCats232(actor);
      break;
    case FN_CSP_WE_271:
      drivePlatinumCats271(actor);
      break;
    case FN_CSP_WE_184:
      drivePlatinumCats184(actor, ctx);
      break;
    case FN_CSP_WE_134:
      drivePlatinumCats134(actor, ctx);
      break;
    case FN_CSP_WE_286:
      drivePlatinumCats286(actor);
      break;
    case FN_CSP_WE_118:
      drivePlatinumCats118(actor, ctx);
      break;
    case FN_CSP_WE_132:
      drivePlatinumCats132(actor);
      break;
    case FN_CSP_WE_155:
      drivePlatinumCats155(actor, ctx);
      break;
    case FN_CSP_WE_193:
      drivePlatinumCats193(actor);
      break;
    case FN_CSP_WE_199:
      drivePlatinumCats199(actor);
      break;
    case FN_CSP_WE_212:
      drivePlatinumCats212(actor);
      break;
    case FN_CSP_WE_259:
      drivePlatinumCats259(actor);
      break;
    case FN_CSP_266:
      drivePlatinumCats266(actor);
      break;
    case FN_CSP_WE_269:
      actor.x = 128;
      actor.y = 80;
      actor.alpha = 0.5;
      actor.visible = actor.age < 45;
      break;
    case FN_CSP_WE_252:
      drivePlatinumCats252(actor);
      break;
    case FN_CSP_WE_226:
      drivePlatinumCats226(actor, ctx);
      break;
    case FN_CSP_WE_320:
      drivePlatinumCatsFloat(actor, ctx, 3, 0.8, 1.2, 40);
      break;
    case FN_CSP_WE_288:
      drivePlatinumCatsFloat(actor, ctx, 4, 1, 0.8, 44);
      break;
    case FN_CSP_WE_270:
      drivePlatinumCatsAppearHoldFade(actor, actor.capId * 5, 40, 12);
      break;
    case FN_CSP_WE_274:
      drivePlatinumCatsAppearHoldFade(actor, actor.capId * 2, 26 + actor.capId, 10);
      break;
    case FN_CSP_WE_338:
      drivePlatinumCatsAppearHoldFade(actor, actor.capId * 2, 48, 12);
      break;
    case FN_CSP_WE_275:
      drivePlatinumCatsAppearHoldFade(actor, actor.capId * 5, 44, 12);
      break;
  }
}

function drivePlatinumCats226(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const t = actor.age;
  actor.visible = true;
  if (t === 24 && ctx.seqCount > 1) setPlatinumCatsSeq(actor, 1, ctx);
  if (t >= 40 && t < 48) actor.y = actor.baseY * (1 - (t - 40) / 8);
  else if (t >= 48) {
    actor.visible = false;
    actor.alive = false;
  }
}

function drivePlatinumCats252(actor: PlatinumCatsActor): void {
  const fadeIn = 6;
  const fadeOut = 6;
  const maxHold = 40;
  const peak = 0.6;
  actor.visible = true;
  if (actor.age < fadeIn) {
    actor.alpha = peak * (actor.age + 1) / fadeIn;
    return;
  }
  if (!actor.finished && actor.age < maxHold) {
    actor.alpha = peak;
    return;
  }
  actor.alpha -= peak / fadeOut;
  if (actor.alpha <= 0) {
    actor.alpha = 0;
    actor.visible = false;
    actor.alive = false;
  }
}

function drivePlatinumCatsAppearHoldFade(actor: PlatinumCatsActor, delay: number, hold: number, fade: number): void {
  const t = actor.age - delay;
  if (t < 0) {
    actor.visible = false;
    return;
  }
  actor.visible = true;
  if (t >= hold && t < hold + fade) actor.alpha = 1 - (t - hold) / fade;
  else if (t >= hold + fade) actor.visible = false;
  else actor.alpha = 1;
}

function drivePlatinumCatsFloat(actor: PlatinumCatsActor, ctx: PlatinumCatsContext, stagger: number, xSpeed: number, ySpeed: number, life: number): void {
  const t = actor.age - actor.capId * stagger;
  if (t < 0) {
    actor.visible = false;
    return;
  }
  actor.visible = true;
  const vec = ctx.attackerIsEnemy ? -1 : 1;
  actor.x = actor.baseX + vec * t * xSpeed + 8 * Math.sin(t * 0.3 + actor.capId);
  actor.y = actor.baseY - t * ySpeed;
  if (t >= life) actor.visible = false;
  else if (t > life - 12) actor.alpha = (life - t) / 12;
  else actor.alpha = 1;
}

function drivePlatinumCats266(actor: PlatinumCatsActor): void {
  const t = actor.age;
  const sway = 42;
  const rot = 24;
  if (t < sway) actor.x = actor.baseX + 40 * Math.sin((t / sway) * Math.PI * 1.5);
  else if (t < sway + rot) {
    actor.x = actor.baseX;
    actor.rotation = 20 * Math.sin(((t - sway) / 4) * Math.PI);
  } else actor.visible = false;
}

function drivePlatinumCats212(actor: PlatinumCatsActor): void {
  const t = actor.age;
  const hold = 40;
  const fade = 24;
  if (t < hold) {
    actor.scaleX = 1.5;
    actor.scaleY = 1.5;
  } else if (t < hold + fade) {
    const k = (t - hold) / fade;
    actor.scaleX = 1.5 - 0.5 * k;
    actor.scaleY = actor.scaleX;
    actor.alpha = 1 - k;
  } else actor.visible = false;
}

function drivePlatinumCats259(actor: PlatinumCatsActor): void {
  const appear = actor.capId * 4;
  if (actor.age < appear) {
    actor.visible = false;
    return;
  }
  actor.visible = true;
  const u = actor.age - appear;
  const hold = 40;
  const fade = 12;
  if (u >= hold && u < hold + fade) actor.alpha = 1 - (u - hold) / fade;
  else if (u >= hold + fade) actor.visible = false;
  else actor.alpha = 1;
}

function drivePlatinumCats199(actor: PlatinumCatsActor): void {
  const anim = 24;
  const flash = 8;
  const blink = 32;
  if (actor.age < anim + flash) actor.visible = true;
  else if (actor.age < anim + flash + blink) actor.visible = Math.floor((actor.age - anim - flash) / 4) % 2 === 0;
  else actor.visible = false;
}

const PLATINUM_CATS_WE193_POINTS = [
  { x: 0, y: 0 },
  { x: 40, y: 40 },
  { x: 40, y: -40 },
  { x: -40, y: 40 },
  { x: -40, y: -40 },
  { x: 40, y: 40 },
  { x: 0, y: 0 },
];

function drivePlatinumCats193(actor: PlatinumCatsActor): void {
  const seg = 12;
  const move = 8;
  const count = 6;
  const fade = 16;
  if (actor.age < seg * count) {
    const segment = Math.floor(actor.age / seg);
    const f = Math.min(1, (actor.age % seg) / move);
    const from = PLATINUM_CATS_WE193_POINTS[segment] ?? PLATINUM_CATS_WE193_POINTS[0];
    const to = PLATINUM_CATS_WE193_POINTS[segment + 1] ?? PLATINUM_CATS_WE193_POINTS[0];
    actor.x = actor.baseX + from.x + (to.x - from.x) * f;
    actor.y = actor.baseY + from.y + (to.y - from.y) * f;
  } else {
    const ft = actor.age - seg * count;
    actor.x = actor.baseX;
    actor.y = actor.baseY;
    actor.alpha = Math.max(0, 1 - ft / fade);
    if (ft >= fade) actor.visible = false;
  }
}

function drivePlatinumCats118(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const t = actor.age;
  const inFrames = 8;
  const wag = 32;
  const out = 8;
  const center = ctx.attackerIsEnemy ? 20 : -20;
  if (t < inFrames) {
    actor.scaleX = 0.1 + 0.9 * (t / inFrames);
    actor.scaleY = actor.scaleX;
  } else if (t < inFrames + wag) {
    actor.scaleX = 1;
    actor.scaleY = 1;
    actor.rotation = center + 20 * Math.sin(((t - inFrames) / 4) * Math.PI);
  } else if (t < inFrames + wag + out) {
    actor.rotation = 0;
    actor.scaleX = 1 - 0.9 * ((t - inFrames - wag) / out);
    actor.scaleY = actor.scaleX;
  } else actor.visible = false;
}

function drivePlatinumCats132(actor: PlatinumCatsActor): void {
  const appear = actor.capId * 4;
  const allIn = 16;
  const squeeze = 48;
  if (actor.age < appear) {
    actor.visible = false;
    return;
  }
  actor.visible = true;
  if (actor.age >= allIn && actor.age < allIn + squeeze) actor.scaleX = 1 - 0.2 * Math.abs(Math.sin(((actor.age - allIn) / 8) * Math.PI));
  else if (actor.age >= allIn + squeeze) actor.visible = false;
}

function drivePlatinumCats155(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const t = actor.age;
  const leg = 10;
  actor.rotation = t * 30;
  if (t < leg) {
    const f = t / leg;
    actor.x = actor.baseX + (ctx.dfX - actor.baseX) * f;
    actor.y = actor.baseY + (ctx.dfY - actor.baseY) * f - 32 * 4 * f * (1 - f);
  } else if (t < leg * 2) {
    const f = (t - leg) / leg;
    actor.x = ctx.dfX + (actor.baseX - ctx.dfX) * f;
    actor.y = ctx.dfY + (actor.baseY - ctx.dfY) * f - 32 * 4 * f * (1 - f);
  } else actor.visible = false;
}

function drivePlatinumCats134(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const t = actor.age - 8 * actor.capId;
  if (t < 0) {
    actor.visible = false;
    return;
  }
  actor.visible = true;
  const fadeIn = 31;
  const sweep = 18;
  const hold = 12;
  const fadeOut = 8;
  const vec = ctx.attackerIsEnemy ? -1 : 1;
  const peak = actor.capId === 0 ? 1 : 0.5;
  const sweepT = Math.min(sweep, Math.max(0, t - fadeIn));
  const angle = (90 + 180 * (sweepT / sweep)) * Math.PI / 180;
  actor.x = actor.baseX + Math.sin(angle) * -32 * vec;
  actor.y = actor.baseY + Math.cos(angle) * -8;
  if (t < fadeIn) actor.alpha = peak * (t / fadeIn);
  else if (t < fadeIn + sweep + hold) actor.alpha = peak;
  else {
    const f = (t - (fadeIn + sweep + hold)) / fadeOut;
    actor.alpha = Math.max(0, peak * (1 - f));
    if (f >= 1) actor.visible = false;
  }
}

function drivePlatinumCats286(actor: PlatinumCatsActor): void {
  const t = actor.age - 9 * actor.capId;
  if (t < 0) {
    actor.visible = false;
    return;
  }
  actor.visible = true;
  const peak = actor.capId === 0 ? 1 : 0.5;
  const inFrames = 10;
  const hold = 24;
  const out = 6;
  if (t < inFrames) {
    const k = t / inFrames;
    actor.scaleX = 2.5 - 1.5 * k;
    actor.scaleY = actor.scaleX;
    actor.alpha = peak;
  } else if (t < inFrames + hold) {
    actor.scaleX = 1;
    actor.scaleY = 1;
    actor.alpha = peak;
  } else if (t < inFrames + hold + out) {
    const k = (t - inFrames - hold) / out;
    actor.scaleX = 1 + 1.5 * k;
    actor.scaleY = actor.scaleX;
    actor.alpha = peak * (1 - k);
  } else actor.visible = false;
}

function drivePlatinumCats184(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const move = 32;
  const fade = 8;
  const vec = ctx.attackerIsEnemy ? -1 : 1;
  const fx = actor.baseX + 32 * vec;
  const fy = actor.baseY;
  if (actor.age <= move) {
    const k = actor.age / move;
    actor.x = fx + 64 * vec * k;
    actor.y = fy - 16 * k;
    actor.scaleX = 0.5 + 0.7 * k;
    actor.scaleY = actor.scaleX;
  } else if (actor.age <= move + fade) {
    actor.x = fx + 64 * vec;
    actor.y = fy - 16;
    actor.scaleX = 1.2;
    actor.scaleY = 1.2;
    actor.alpha = 1 - (actor.age - move) / fade;
  } else actor.visible = false;
}

function drivePlatinumCats271(actor: PlatinumCatsActor): void {
  const fall = 25;
  const orbit = 50;
  const fallenY = actor.baseY + 50;
  if (actor.age < fall) {
    actor.x = actor.baseX;
    actor.y = actor.baseY + 2 * actor.age;
  } else if (actor.age < fall + orbit) {
    const mx = 140;
    const my = (54 + 50 + 39 + 50) / 2;
    const ox = actor.baseX - mx;
    const oy = fallenY - my;
    const radius = Math.hypot(ox, oy);
    const start = Math.atan2(oy, ox);
    const angle = start + Math.PI * ((actor.age - fall) / 10);
    actor.x = mx + radius * Math.cos(angle);
    actor.y = my + radius * Math.sin(angle);
  } else {
    const k = Math.min(1, (actor.age - fall - orbit) / 8);
    actor.alpha = 1 - k;
    if (k >= 1) actor.visible = false;
  }
}

function drivePlatinumCats232(actor: PlatinumCatsActor): void {
  if (actor.capId >= 2 && actor.age < 10) {
    actor.visible = false;
    return;
  }
  actor.visible = actor.age < 40;
}

function drivePlatinumCats333(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const ofsX = actor.gp[0] ?? 0;
  const ofsY = actor.gp[1] ?? 0;
  const time = Math.max(1, actor.gp[2] ?? 16);
  const height = actor.gp[3] ?? 0;
  const vec = ctx.attackerIsEnemy ? -1 : 1;
  const endX = ctx.dfX + ofsX * vec;
  const endY = ctx.dfY + ofsY * vec;
  const frac = Math.min(1, actor.age / time);
  actor.x = ctx.atX + (endX - ctx.atX) * frac;
  actor.y = ctx.atY + (endY - ctx.atY) * frac - height * 4 * frac * (1 - frac);
  const k = Math.min(1, actor.age / 10);
  actor.rotation = vec > 0 ? 20 + (130 - 20) * k : -(90 + (130 - 90) * k);
  if (actor.age >= time) actor.visible = false;
}

function drivePlatinumCats207Sub(actor: PlatinumCatsActor, ctx: PlatinumCatsContext): void {
  const vec = ctx.attackerIsEnemy ? -1 : 1;
  const pop = 6;
  const wait = 4;
  const applyScale = (frame: number) => {
    actor.scaleX = frame < 4 ? 1 + 0.4 * (frame / 4) : 1.4 - 0.2 * ((frame - 4) / 2);
    actor.scaleY = actor.scaleX;
  };
  if (actor.age < pop) {
    actor.visible = true;
    actor.x = actor.baseX + 24 * vec;
    actor.y = actor.baseY - 16;
    applyScale(actor.age);
  } else if (actor.age < pop + wait) actor.visible = false;
  else if (actor.age < pop + wait + pop) {
    actor.visible = true;
    actor.x = actor.baseX - 24 * vec;
    actor.y = actor.baseY - 24;
    applyScale(actor.age - pop - wait);
  } else actor.visible = false;
}

function drivePlatinumCats081(actor: PlatinumCatsActor): void {
  const idx = Math.min(actor.capId, WE081_WAIT.length - 1);
  const delay = WE081_WAIT[idx]?.[0] ?? 8;
  const interval = Math.max(1, WE081_WAIT[idx]?.[1] ?? 1);
  const eff = 45;
  if (actor.age < eff) actor.visible = actor.age >= delay && Math.floor((actor.age - delay) / interval) % 2 === 0;
  else if (actor.age < eff + 10) {
    actor.visible = true;
    actor.scaleX = 1 - 0.4 * ((actor.age - eff) / 10);
    actor.scaleY = 1;
  } else if (actor.age < eff + 10 + eff) {
    actor.visible = true;
    actor.scaleX = 0.6;
  } else {
    const k = Math.min(1, (actor.age - (eff + 10 + eff)) / 15);
    actor.alpha = 1 - k;
    if (k >= 1) actor.visible = false;
  }
}

function applyPlatinumCatsSurfWave(actor: PlatinumCatsActor, frame: number, ctx: PlatinumCatsContext): void {
  const castCap = ctx.attackerIsEnemy ? 1 : 0;
  if (actor.capId !== castCap) {
    actor.visible = false;
    actor.alive = false;
    return;
  }
  if (ctx.seqCount > castCap && actor.seq !== castCap) setPlatinumCatsSeq(actor, castCap, ctx);
  const def = ctx.attackerIsEnemy ? PLATINUM_CATS_WE057_ENEMY : PLATINUM_CATS_WE057_PLAYER;
  let scaleX = 1;
  let scaleY = 0.05;
  let alpha = 0;
  if (frame < 1) {
    scaleX = 1;
    scaleY = 0.05;
    alpha = 0;
  } else if (frame < 13) {
    const t = (frame - 1) / 12;
    scaleX = lerp(1, 0.6, t);
    scaleY = lerp(0.05, 1.5, t);
    alpha = t;
  } else if (frame < 17) {
    scaleX = 0.6;
    scaleY = 1.5;
    alpha = 1;
  } else if (frame < 29) {
    const t = (frame - 17) / 12;
    scaleX = lerp(0.6, 1.5, t);
    scaleY = lerp(1.5, 0.1, t);
    alpha = 1 - t;
  } else {
    actor.visible = false;
    actor.alive = false;
    actor.alpha = 0;
    return;
  }
  actor.x = def.x;
  actor.y = def.y + ((80 - PLATINUM_CATS_WE057_OAM_HEIGHT * 2) / 2) * (1 - scaleY);
  actor.scaleX = scaleX;
  actor.scaleY = scaleY;
  actor.alpha = alpha;
  actor.visible = alpha > 0;
}

function platinumCatsEffectDuration(funcId: number, gp: number[]): number {
  switch (funcId) {
    case FN_CSP_WE_155:
      return 24;
    case FN_CSP_WE_207_SUB:
      return 18;
    case FN_CSP_WE_226:
      return 52;
    case FN_CSP_WE_252:
      return 56;
    case FN_CSP_266:
      return 70;
    case FN_CSP_WE_269:
      return 48;
    case FN_CSP_WE_320:
      return 86;
    case FN_CSP_WE_288:
      return 68;
    case FN_CSP_WE_270:
      return 80;
    case FN_CSP_WE_274:
      return 72;
    case FN_CSP_WE_338:
      return 78;
    case FN_CSP_WE_275:
      return 76;
    case FN_CSP_WE_271:
      return 88;
    case FN_CSP_WE_193:
      return 92;
    case FN_CSP_WE_081:
      return 118;
    case FN_CSP_WE_134:
      return 90;
    case FN_CSP_WE_286:
      return 62;
    case FN_CSP_WE_118:
      return 52;
    case FN_CSP_WE_132:
      return 68;
    case FN_CSP_WE_199:
      return 68;
    case FN_CSP_WE_212:
      return 68;
    case FN_CSP_WE_333:
      return Math.max(20, (gp[2] ?? 16) + 4);
    case FN_CSP_WE_232:
      return 44;
    case FN_CSP_WE_259:
      return 76;
    case FN_CSP_090:
    case FN_CSP_FREE:
      return 60;
    default:
      return Math.max(PARTICLE_EVENT_DURATION, 60);
  }
}

function snapshotPlatinumCatsActor(actor: PlatinumCatsActor, frame: number): PlatinumCatsActorState {
  return {
    frame,
    sequenceIndex: actor.seq,
    sequenceFrame: actor.seqFrame,
    x: actor.x,
    y: actor.y,
    scaleX: actor.scaleX,
    scaleY: actor.scaleY,
    rotation: actor.rotation,
    alpha: actor.alpha,
    visible: actor.visible && actor.alive,
    flipX: actor.flipX || undefined,
    flipY: actor.flipY || undefined,
  };
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function platinumEventDuration(event: MoveAnimationTimelineEvent): number {
  if (event.effectKind === "spa") return PARTICLE_EVENT_DURATION;
  if (event.effectKind === "cell") return Math.max(1, event.cellEffect?.duration ?? PARTICLE_EVENT_DURATION);
  if (event.effectKind === "cap") return Math.max(1, event.capEffect?.duration ?? PARTICLE_EVENT_DURATION);
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

function addVec(left: readonly [number, number, number], right: readonly [number, number, number]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subVec(left: readonly [number, number, number], right: readonly [number, number, number]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scaleVec(value: readonly [number, number, number], scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function normalizeVec(value: readonly [number, number, number]): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 0.000001) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function convertPlatinumPixelOffset(value: readonly [number, number, number]): Vec3 {
  return [value[0] * PLATINUM_PIXEL_TO_WORLD, value[1] * PLATINUM_PIXEL_TO_WORLD, value[2] * PLATINUM_PIXEL_TO_WORLD];
}

function platinumParticleScreenToWorld(vm: VmState, x: number, y: number): Vec3 {
  const sx = (x - PLATINUM_PARTICLE_ATTACKER_SCREEN.x) / (PLATINUM_PARTICLE_DEFENDER_SCREEN.x - PLATINUM_PARTICLE_ATTACKER_SCREEN.x);
  const sy = (y - PLATINUM_PARTICLE_DEFENDER_SCREEN.y) / (PLATINUM_PARTICLE_ATTACKER_SCREEN.y - PLATINUM_PARTICLE_DEFENDER_SCREEN.y);
  const attacker = attackerAnchor(vm);
  const defender = defenderAnchor(vm);
  return [
    lerp(attacker[0], defender[0], sx),
    lerp(defender[1], attacker[1], sy),
    lerp(defender[2], attacker[2], sy),
  ];
}

function platinumParticleScreenDeltaToWorld(vm: VmState, dx: number, dy: number): Vec3 {
  const origin = platinumParticleScreenToWorld(vm, PLATINUM_PARTICLE_ORIGIN_X, PLATINUM_PARTICLE_ORIGIN_Y);
  const moved = platinumParticleScreenToWorld(vm, PLATINUM_PARTICLE_ORIGIN_X + dx, PLATINUM_PARTICLE_ORIGIN_Y + dy);
  return subVec(moved, origin);
}

function platinumParticleAxisToWorld(vm: VmState, axisX: number, axisY: number): Vec3 {
  return normalizeVec(platinumParticleScreenDeltaToWorld(vm, axisX, -axisY));
}

function platinumParticleAxisBetweenClients(vm: VmState, sourceClient: number, endClient: number): Vec3 {
  const source = operatorClientScreenPoint(sourceClient);
  const end = operatorClientScreenPoint(endClient);
  return platinumParticleAxisToWorld(vm, end.x - source.x, source.y - end.y);
}

function operatorClientScreenPoint(client: number): { x: number; y: number } {
  return client === 0 ? PLATINUM_PARTICLE_ATTACKER_SCREEN : PLATINUM_PARTICLE_DEFENDER_SCREEN;
}

function extraDataParams(command: ParsedPlatinumMoveAnimationCommand | undefined): number[] {
  return command?.name.toLowerCase() === "setextraparams" ? command.params : [];
}

function isOperatorStartPosition(position: number): boolean {
  return PLATINUM_OPERATOR_START_POSITIONS.has(position);
}

function fixedOperatorPosition(vm: VmState, position: number, sourceClient: number): Vec3 {
  const table = position === 30 ? PLATINUM_OPERATOR_POS_226 : position === 32 ? PLATINUM_OPERATOR_POS_225 : PLATINUM_OPERATOR_POS_145;
  const [x, y] = table[sourceClient === 0 ? 0 : 1];
  return platinumParticleScreenToWorld(vm, PLATINUM_PARTICLE_ORIGIN_X + x / 172, PLATINUM_PARTICLE_ORIGIN_Y - y / 172);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
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

function platinumCellEffectKey(charId: number, paletteId: number, cellId: number, animationId: number): string {
  return `${charId}:${paletteId}:${cellId}:${animationId}`;
}

function formatOffset(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

function loadPlatinumBattleScene(
  state: PlatinumMoveAnimationRom,
  scenario: PlatinumMoveAnimationPreviewScenario,
  warnings: MoveAnimationPreviewWarning[],
): MoveAnimationPreview["battleScene"] | undefined {
  const terrainId = Math.max(0, Math.min(PLATINUM_BATTLE_GROUND_GFX.length - 1, Math.round(scenario.battleTerrainId ?? 0)));
  const timeZone = Math.max(0, Math.min(2, Math.round(scenario.battleTimeZone ?? 0)));
  const backdropId = Math.max(0, Math.min(PLATINUM_BATTLE_BACKDROP_COUNT - 1, Math.round(scenario.battleBackdropId ?? platinumBattleBackdropForTerrain(terrainId))));
  let backdrop: NitroBackgroundImage | undefined;
  const platforms: NonNullable<MoveAnimationPreview["battleScene"]>["platforms"] = [];

  try {
    backdrop = loadPlatinumBattleBackdrop(state, backdropId, timeZone);
    for (const warning of backdrop.warnings) warnings.push({ message: `Battle backdrop ${backdropId}: ${warning}` });
  } catch (error) {
    warnings.push({ message: `Battle backdrop ${backdropId}: ${error instanceof Error ? error.message : String(error)}` });
  }

  try {
    const groundNarc = new NARC(state.rom.getFileByName(PLATINUM_BATTLE_OBJ_PATH));
    platforms.push(loadPlatinumBattleGroundPlatform(groundNarc, terrainId, timeZone, "enemy"));
    platforms.push(loadPlatinumBattleGroundPlatform(groundNarc, terrainId, timeZone, "mine"));
    for (const platform of platforms) {
      for (const warning of platform.warnings) warnings.push({ message: `Battle platform ${platform.id}: ${warning}` });
    }
  } catch (error) {
    warnings.push({ message: `Battle platforms: ${error instanceof Error ? error.message : String(error)}` });
  }

  if (!backdrop && platforms.length === 0) return undefined;
  return { backdrop, platforms };
}

function loadPlatinumBattleBackdrop(state: PlatinumMoveAnimationRom, backdropId: number, timeZone: number): NitroBackgroundImage {
  const narc = new NARC(state.rom.getFileByName(PLATINUM_BATTLE_BG_PATH));
  const screen = decompressNitroIfNeeded(requiredPlatinumNarcFile(narc, PLATINUM_BATTLE_BACKDROP_SCR, `battle backdrop ${backdropId} screen`, PLATINUM_BATTLE_BG_PATH));
  const characters = decompressNitroIfNeeded(requiredPlatinumNarcFile(narc, PLATINUM_BATTLE_BACKDROP_CHR0 + backdropId, `battle backdrop ${backdropId} graphics`, PLATINUM_BATTLE_BG_PATH));
  const palette = decompressNitroIfNeeded(requiredPlatinumNarcFile(narc, PLATINUM_BATTLE_BACKDROP_PAL0 + backdropId * 3 + timeZone, `battle backdrop ${backdropId} palette`, PLATINUM_BATTLE_BG_PATH));
  return parseNitroBackground(-1000 - backdropId, screen, characters, palette, { transparentIndexZero: false });
}

function loadPlatinumBattleGroundPlatform(
  narc: NARC,
  terrainId: number,
  timeZone: number,
  side: "mine" | "enemy",
): NonNullable<MoveAnimationPreview["battleScene"]>["platforms"][number] {
  const groundGfx = PLATINUM_BATTLE_GROUND_GFX[terrainId] ?? 0;
  const characterId = side === "mine" ? platinumBattleGroundMineNcgr(groundGfx) : platinumBattleGroundEnemyNcgr(groundGfx);
  const cellId = side === "mine" ? PLATINUM_BATTLE_GROUND_MINE_NCER : PLATINUM_BATTLE_GROUND_ENEMY_NCER;
  const paletteId = platinumBattleGroundPalDay(groundGfx) + timeZone;
  const posX = side === "mine" ? PLATINUM_BATTLE_GROUND_MINE_X : PLATINUM_BATTLE_GROUND_ENEMY_X;
  const posY = side === "mine" ? PLATINUM_BATTLE_GROUND_MINE_Y : PLATINUM_BATTLE_GROUND_ENEMY_Y;
  const image = parseNitroCellImage(
    `pt-ground:${terrainId}:${timeZone}:${side}`,
    requiredPlatinumNarcFile(narc, characterId, `${side} ground NCGR`, PLATINUM_BATTLE_OBJ_PATH),
    requiredPlatinumNarcFile(narc, paletteId, `ground palette`, PLATINUM_BATTLE_OBJ_PATH),
    requiredPlatinumNarcFile(narc, cellId, `${side} ground NCER`, PLATINUM_BATTLE_OBJ_PATH),
    0,
    PLATINUM_BATTLE_GROUND_CANVAS,
  );
  return { ...image, left: posX - PLATINUM_BATTLE_GROUND_CANVAS / 2, top: posY - PLATINUM_BATTLE_GROUND_CANVAS / 2 };
}

function platinumBattleGroundMineNcgr(groundGfx: number): number {
  return groundGfx === 0 ? 127 : 133 + (groundGfx - 1) * 2;
}

function platinumBattleGroundEnemyNcgr(groundGfx: number): number {
  return groundGfx === 0 ? 130 : 134 + (groundGfx - 1) * 2;
}

function platinumBattleGroundPalDay(groundGfx: number): number {
  return 1 + groundGfx * 3;
}

function platinumBattleBackdropForTerrain(terrainId: number): number {
  const groundGfx = PLATINUM_BATTLE_GROUND_GFX[terrainId] ?? 0;
  return Math.max(0, Math.min(PLATINUM_BATTLE_BACKDROP_COUNT - 1, groundGfx));
}

function loadPlatinumCellEffects(
  state: PlatinumMoveAnimationRom,
  cellEffectIds: Array<{ key: string; charId: number; paletteId: number; cellId: number; animationId: number }>,
  warnings: MoveAnimationPreviewWarning[],
): Map<string, NitroCellEffect> {
  const effects = new Map<string, NitroCellEffect>();
  if (cellEffectIds.length === 0) return effects;
  const charNarc = loadPlatinumEffectClactNarc(state, "char", cellEffectIds.map((effect) => effect.charId), warnings);
  const paletteNarc = loadPlatinumEffectClactNarc(state, "palette", cellEffectIds.map((effect) => effect.paletteId), warnings);
  const cellNarc = loadPlatinumEffectClactNarc(state, "cell", cellEffectIds.map((effect) => effect.cellId), warnings);
  const animationNarc = loadPlatinumEffectClactNarc(state, "animation", cellEffectIds.map((effect) => effect.animationId), warnings);
  if (!charNarc || !paletteNarc || !cellNarc || !animationNarc) return effects;

  for (const request of cellEffectIds) {
    try {
      const effect = parseNitroCellEffect(
        request.key,
        request.charId,
        request.paletteId,
        request.cellId,
        request.animationId,
        requiredEffectClactFile(charNarc, request.charId, "wechar"),
        requiredEffectClactFile(paletteNarc, request.paletteId, "wepltt"),
        requiredEffectClactFile(cellNarc, request.cellId, "wecell"),
        requiredEffectClactFile(animationNarc, request.animationId, "wecellanm"),
        { originCentered: true },
      );
      effects.set(request.key, effect);
      for (const warning of effect.warnings) warnings.push({ message: `CATS cell effect ${request.key}: ${warning}` });
    } catch (error) {
      warnings.push({ message: `CATS cell effect ${request.key}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return effects;
}

function loadPlatinumEffectClactNarc(
  state: PlatinumMoveAnimationRom,
  kind: "char" | "palette" | "cell" | "animation",
  requestedIds: number[],
  warnings: MoveAnimationPreviewWarning[],
): NARC | undefined {
  const path = platinumEffectClactPath(kind);
  try {
    return new NARC(state.rom.getFileByName(path));
  } catch {
    // Retail and hack ROM filename tables are not guaranteed to keep source paths.
  }

  const expectedStamp = platinumEffectClactStamp(kind);
  const ids = uniqueSorted(requestedIds);
  let best: { narc: NARC; score: number } | undefined;
  for (const file of state.rom.files) {
    if (readAscii(file, 0, 4) !== "NARC") continue;
    try {
      const narc = new NARC(file);
      const score = scorePlatinumEffectClactNarc(narc, kind, expectedStamp, ids);
      if (score > (best?.score ?? 0)) best = { narc, score };
    } catch {
      // Keep scanning unrelated NARCs.
    }
  }
  if (best) return best.narc;
  warnings.push({ message: `Cannot find Platinum effectclact ${kind} NARC (${path})` });
  return undefined;
}

function scorePlatinumEffectClactNarc(narc: NARC, kind: "char" | "palette" | "cell" | "animation", expectedStamp: string, requestedIds: number[]): number {
  if (requestedIds.length > 0 && !requestedIds.every((id) => fileHasStamp(narc.files[id], expectedStamp))) return 0;
  let matchingFiles = 0;
  for (const file of narc.files) {
    if (fileHasStamp(file, expectedStamp)) matchingFiles += 1;
  }
  const expectedCount = kind === "palette" ? 39 : 37;
  const countDistance = Math.abs(narc.files.length - expectedCount);
  const plausibleEffectClactSize = countDistance <= 4 || (narc.files.length >= 30 && narc.files.length <= 45);
  if (plausibleEffectClactSize && matchingFiles === narc.files.length) return 10_000 - countDistance;
  if (plausibleEffectClactSize && matchingFiles >= Math.floor(narc.files.length * 0.8)) return 9_000 + matchingFiles - countDistance;
  if (matchingFiles < 20) return 0;
  return matchingFiles - countDistance;
}

function platinumEffectClactPath(kind: "char" | "palette" | "cell" | "animation"): string {
  if (kind === "char") return PLATINUM_EFFECT_CLACT_CHAR_PATH;
  if (kind === "palette") return PLATINUM_EFFECT_CLACT_PLTT_PATH;
  if (kind === "cell") return PLATINUM_EFFECT_CLACT_CELL_PATH;
  return PLATINUM_EFFECT_CLACT_CELLANM_PATH;
}

function platinumEffectClactStamp(kind: "char" | "palette" | "cell" | "animation"): string {
  if (kind === "char") return "RGCN";
  if (kind === "palette") return "RLCN";
  if (kind === "cell") return "RECN";
  return "RNAN";
}

function fileHasStamp(bytes: Uint8Array | undefined, stamp: string): boolean {
  if (!bytes || bytes.length < 4) return false;
  try {
    return readAscii(decompressNitroIfNeeded(bytes), 0, 4) === stamp;
  } catch {
    return false;
  }
}

function requiredEffectClactFile(narc: NARC, fileId: number, label: string): Uint8Array {
  const bytes = narc.files[fileId];
  if (!bytes) throw new Error(`${label} file ${fileId} is missing`);
  return bytes;
}

function loadPlatinumMoveBackground(state: PlatinumMoveAnimationRom, backgroundId: number): NitroBackgroundImage {
  const entry = PLATINUM_MOVE_BACKGROUND_TABLE[backgroundId];
  if (!entry) throw new Error(`Platinum move background ${backgroundId} is not in the known background table`);
  const narc = new NARC(state.rom.getFileByName(PLATINUM_BATTLE_BG_PATH));
  const characters = decompressNitroIfNeeded(requiredPlatinumNarcFile(narc, entry.gfx, `background ${backgroundId} graphics`, PLATINUM_BATTLE_BG_PATH));
  const palette = decompressNitroIfNeeded(requiredPlatinumNarcFile(narc, entry.palette, `background ${backgroundId} palette`, PLATINUM_BATTLE_BG_PATH));
  const tilemaps = [entry.tilemap, entry.tilemapReversed, entry.tilemapContest];
  const frameImages = tilemaps.map((tilemap, frameIndex) => {
    const screen = decompressNitroIfNeeded(requiredPlatinumNarcFile(narc, tilemap, `background ${backgroundId} screen ${frameIndex}`, PLATINUM_BATTLE_BG_PATH));
    return parseNitroBackground(backgroundId, screen, characters, palette, { transparentIndexZero: true });
  });
  const [firstFrame] = frameImages;
  if (!firstFrame) throw new Error(`Platinum move background ${backgroundId} has no screen frame`);
  return { ...firstFrame, frameImages };
}

function requiredPlatinumNarcFile(narc: NARC, fileId: number, label: string, path: string): Uint8Array {
  const bytes = narc.files[fileId];
  if (!bytes) throw new Error(`${label} file ${fileId} is missing in ${path}`);
  return bytes;
}

function decompressNitroIfNeeded(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function signed16(value: number): number {
  const normalized = value & 0xffff;
  return normalized & 0x8000 ? normalized - 0x10000 : normalized;
}

function signed32(value: number): number {
  return value | 0;
}

const PLATINUM_OPERATOR_START_POSITIONS = new Set([1, 4, 6, 8, 10, 14, 16, 18, 20, 22, 24, 26, 34]);
const PLATINUM_OPERATOR_POS_145: Array<[number, number]> = [
  [-5760, -4352],
  [9488, -1984],
];
const PLATINUM_OPERATOR_POS_225: Array<[number, number]> = [
  [-4608, -4480],
  [7624, 2248],
];
const PLATINUM_OPERATOR_POS_226: Array<[number, number]> = [
  [-11020, -3488],
  [10880, 7656],
];
const PLATINUM_OPERATOR_AXIS_145: Array<[number, number]> = [
  [2864, 3752],
  [-2944, 1456],
];

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
