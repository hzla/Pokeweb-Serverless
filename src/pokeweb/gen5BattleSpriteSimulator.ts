import type { MoveAnimationTimelineEvent } from "./moveAnimationPreviewModel";

const FX32_ONE = 0x1000;
const DS_ANGLE_FULL_TURN = 0x10000;
const SHADOW_DEPTH_OFFSET = -FX32_ONE;
const MAX_IDLE_SCAN_FRAMES = 100_000;

const USER_DEFAULT_POSITION: FixedVec3 = [0x800, 0x666, 0x7000];
const TARGET_DEFAULT_POSITION: FixedVec3 = [0x4cd, 0x666, -0xa000];
const UNIT_SCALE: FixedVec3 = [FX32_ONE, FX32_ONE, FX32_ONE];
const ZERO_VEC: FixedVec3 = [0, 0, 0];

export const GEN5_BATTLE_SPRITE_COMMANDS = new Set([
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
]);

export type Gen5BattleSpriteTarget = "user" | "target";

export type Gen5BattleSpriteActorState = {
  exists: boolean;
  visible: boolean;
  positionOffset: [number, number, number];
  basePositionOffset: [number, number, number];
  effectPositionOffset: [number, number, number];
  scale: [number, number];
  rotation: number;
  opacity: number;
  palette: {
    evy: number;
    color: [number, number, number];
  };
  mosaic: number;
  shadow: {
    visible: boolean;
    positionOffset: [number, number, number];
    scale: [number, number];
    opacity: number;
  };
};

export type Gen5BattleSpriteState = Record<Gen5BattleSpriteTarget, Gen5BattleSpriteActorState>;

type FixedVec3 = [number, number, number];
type TaskChannel = "move" | "scale" | "rotate" | "alpha" | "mosaic" | "shadowScale" | "blink" | "palette";

type RuntimeTask = {
  tick: () => boolean;
};

type RuntimeActor = {
  target: Gen5BattleSpriteTarget;
  oddPosition: boolean;
  exists: boolean;
  defaultPosition: FixedVec3;
  position: FixedVec3;
  effectPosition: FixedVec3;
  offsetScale: FixedVec3;
  rotation: FixedVec3;
  alpha: number;
  mosaic: number;
  paletteEvy: number;
  paletteColor: [number, number, number];
  vanish: boolean;
  effectVanish: boolean;
  savedVanish: boolean;
  shadowVanish: boolean;
  shadowOffsetScale: FixedVec3;
  tasks: Map<TaskChannel, RuntimeTask>;
};

class Gen5BattleSpriteRuntime {
  readonly actors: Record<Gen5BattleSpriteTarget, RuntimeActor>;

  constructor(swappedSides = false) {
    this.actors = {
      user: makeActor("user", swappedSides, swappedSides ? TARGET_DEFAULT_POSITION : USER_DEFAULT_POSITION),
      target: makeActor("target", !swappedSides, swappedSides ? USER_DEFAULT_POSITION : TARGET_DEFAULT_POSITION),
    };
  }

  tick(): void {
    for (const actor of Object.values(this.actors)) {
      if (!actor.exists) {
        actor.tasks.clear();
        continue;
      }
      for (const [channel, task] of [...actor.tasks.entries()]) {
        if (task.tick() && actor.tasks.get(channel) === task) actor.tasks.delete(channel);
      }
    }
  }

  apply(event: MoveAnimationTimelineEvent): void {
    if (!GEN5_BATTLE_SPRITE_COMMANDS.has(event.command)) return;
    if (event.command === "ChangeVisibility" && (event.params[1] ?? 0) === 5) {
      for (const actor of Object.values(this.actors)) restoreVanish(actor);
      return;
    }
    const actors = resolveActors(event.params[0] ?? -1, this.actors);
    for (const actor of actors) this.applyToActor(actor, event);
  }

  isIdle(): boolean {
    return Object.values(this.actors).every((actor) => actor.tasks.size === 0);
  }

  state(): Gen5BattleSpriteState {
    return {
      user: actorState(this.actors.user),
      target: actorState(this.actors.target),
    };
  }

  private applyToActor(actor: RuntimeActor, event: MoveAnimationTimelineEvent): void {
    const p = event.params;
    switch (event.command) {
      case "ShakeSprite":
        applyPositionCommand(actor, p);
        return;
      case "MoveSprite":
        applyCircleCommand(actor, p);
        return;
      case "PokemonSineMove":
        applySineCommand(actor, p);
        return;
      case "DistortSprite":
        actor.tasks.set("scale", makeParamTask(actor, "scale", p[1] ?? 0, actor.offsetScale, [p[2] ?? 0, p[3] ?? 0, FX32_ONE], p[4] ?? 0, p[5] ?? 0, p[6] ?? 0, false));
        return;
      case "TiltSprite":
        actor.tasks.set("rotate", makeParamTask(actor, "rotate", p[1] ?? 0, actor.rotation, [0, 0, p[2] ?? 0], p[3] ?? 0, p[4] ?? 0, p[5] ?? 0, true));
        return;
      case "SpriteOpacity": {
        const start: FixedVec3 = [actor.alpha * FX32_ONE, 0, 0];
        const end: FixedVec3 = [(p[2] ?? 0) * FX32_ONE, 0, 0];
        actor.tasks.set("alpha", makeParamTask(actor, "alpha", p[1] ?? 0, start, end, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0, false));
        return;
      }
      case "PokemonMosaic": {
        const start: FixedVec3 = [actor.mosaic * FX32_ONE, 0, 0];
        const end: FixedVec3 = [(p[2] ?? 0) * FX32_ONE, 0, 0];
        actor.tasks.set("mosaic", makeParamTask(actor, "mosaic", p[1] ?? 0, start, end, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0, false));
        return;
      }
      case "PokemonBlinkFlag":
        applyBlinkCommand(actor, p);
        return;
      case "FreezeSprite":
        return;
      case "ChangeColor":
        actor.tasks.set("palette", makePaletteTask(actor, p));
        return;
      case "ChangeVisibility":
        applyVisibilityCommand(actor, p[1] ?? 0);
        return;
      case "PokemonShadowVanish":
        actor.shadowVanish = (p[1] ?? 0) !== 0;
        return;
      case "PokemonShadowScale":
        // Retail starts this task from the Pokemon offset scale rather than the
        // current shadow offset scale. Preserve that MCSS quirk.
        actor.tasks.set("shadowScale", makeParamTask(actor, "shadowScale", p[1] ?? 0, actor.offsetScale, [p[2] ?? 0, p[3] ?? 0, FX32_ONE], p[4] ?? 0, p[5] ?? 0, p[6] ?? 0, false));
        return;
      case "DeletePokemon":
        actor.exists = false;
        actor.tasks.clear();
        return;
    }
  }
}

export function isGen5BattleSpriteCommand(command: string): boolean {
  return GEN5_BATTLE_SPRITE_COMMANDS.has(command);
}

export function resolveGen5BattleSpriteTargets(selector: number): Gen5BattleSpriteTarget[] {
  switch (selector) {
    case 0:
    case 14:
    case 19:
      return ["user"];
    case 1:
    case 16:
    case 20:
      return ["target"];
    case 18:
      return ["user", "target"];
    default:
      return [];
  }
}

export function simulateGen5BattleSprites(
  timeline: MoveAnimationTimelineEvent[],
  targetFrame: number,
  swappedSides = false,
): Gen5BattleSpriteState {
  const runtime = runTimeline(timeline, Math.max(0, Math.floor(targetFrame)), swappedSides);
  return runtime.state();
}

export function gen5BattleSpriteIdleFrame(timeline: MoveAnimationTimelineEvent[], throughFrame: number): number {
  const frame = Math.max(0, Math.floor(throughFrame));
  const runtime = runTimeline(timeline, frame);
  let idleFrame = frame;
  while (!runtime.isIdle() && idleFrame - frame < MAX_IDLE_SCAN_FRAMES) {
    idleFrame += 1;
    runtime.tick();
  }
  return idleFrame;
}

function runTimeline(timeline: MoveAnimationTimelineEvent[], targetFrame: number, swappedSides = false): Gen5BattleSpriteRuntime {
  const runtime = new Gen5BattleSpriteRuntime(swappedSides);
  const events = timeline
    .filter((event) => event.frame <= targetFrame && GEN5_BATTLE_SPRITE_COMMANDS.has(event.command))
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.frame - b.event.frame || a.index - b.index);
  let eventIndex = 0;
  for (let frame = 0; frame <= targetFrame; frame += 1) {
    if (frame > 0) runtime.tick();
    while (eventIndex < events.length && events[eventIndex].event.frame === frame) {
      runtime.apply(events[eventIndex].event);
      eventIndex += 1;
    }
  }
  return runtime;
}

function makeActor(target: Gen5BattleSpriteTarget, oddPosition: boolean, defaultPosition: FixedVec3): RuntimeActor {
  return {
    target,
    oddPosition,
    exists: true,
    defaultPosition: copyVec(defaultPosition),
    position: copyVec(defaultPosition),
    effectPosition: copyVec(ZERO_VEC),
    offsetScale: copyVec(UNIT_SCALE),
    rotation: copyVec(ZERO_VEC),
    alpha: 31,
    mosaic: 0,
    paletteEvy: 0,
    paletteColor: [0, 0, 0],
    vanish: false,
    effectVanish: false,
    savedVanish: false,
    shadowVanish: false,
    shadowOffsetScale: copyVec(UNIT_SCALE),
    tasks: new Map(),
  };
}

function resolveActors(selector: number, actors: Record<Gen5BattleSpriteTarget, RuntimeActor>): RuntimeActor[] {
  return resolveGen5BattleSpriteTargets(selector).map((target) => actors[target]).filter((actor) => actor.exists);
}

function applyPositionCommand(actor: RuntimeActor, params: number[]): void {
  let mode = params[1] ?? 0;
  const input: FixedVec3 = [params[2] ?? 0, params[3] ?? 0, 0];
  const frame = params[4] ?? 0;
  const wait = params[5] ?? 0;
  const count = params[6] ?? 0;
  const start = copyVec(actor.position);
  let end = copyVec(input);
  if (mode === 1) {
    end = [start[0] + (actor.oddPosition ? -input[0] : input[0]), start[1] + input[1], start[2] + input[2]];
  } else if (mode === 5) {
    end = copyVec(actor.defaultPosition);
    mode = 1;
  } else if (mode === 6) {
    end = copyVec(actor.defaultPosition);
    mode = 0;
  }
  if (mode === 0) {
    actor.position = end;
    actor.tasks.delete("move");
    return;
  }
  actor.tasks.set("move", makeParamTask(actor, "move", mode, start, end, frame, wait, count, true));
}

function applyCircleCommand(actor: RuntimeActor, params: number[]): void {
  const count = (params[7] ?? 0) >> 12;
  if (count === 0) return;
  let shift = params[2] ?? 0;
  const axis = params[1] ?? 0;
  if (actor.oddPosition) {
    const verticalShiftOnXZ = (axis === 0 || axis === 1 || axis === 4 || axis === 5) && (shift === 2 || shift === 3);
    if (!verticalShiftOnXZ) shift ^= 1;
  }
  const frame = Math.max(1, (params[5] ?? 0) >> 12);
  const task = makeCircleTask(actor, {
    axis,
    shift,
    radiusH: params[3] ?? 0,
    radiusV: params[4] ?? 0,
    frame,
    rotateWait: Math.max(0, (params[6] ?? 0) >> 12),
    count,
    rotateAfterWait: Math.max(0, params[8] ?? 0),
  });
  actor.tasks.set("move", task);
}

function applySineCommand(actor: RuntimeActor, params: number[]): void {
  const frame = Math.max(1, params[5] ?? 0);
  let angle = params[2] ?? 0;
  const speed = fixedDivide((params[3] ?? 0) - angle, frame);
  let remaining = frame;
  const direction = params[1] ?? 0;
  const radius = params[4] ?? 0;
  const task: RuntimeTask = {
    tick: () => {
      angle += speed;
      const index = ((angle & 0x0ffff000) >>> 12) & 0xffff;
      const value = fixedMultiply(trigSin(index), radius);
      actor.effectPosition = direction !== 0 ? [0, value, 0] : [value, 0, 0];
      remaining -= 1;
      if (remaining === 0) {
        actor.effectPosition = copyVec(ZERO_VEC);
        return true;
      }
      return false;
    },
  };
  actor.tasks.set("move", task);
}

function makeParamTask(
  actor: RuntimeActor,
  channel: Exclude<TaskChannel, "blink" | "palette">,
  mode: number,
  startInput: FixedVec3,
  endInput: FixedVec3,
  frameInput: number,
  waitInput: number,
  countInput: number,
  reverseForOddPosition: boolean,
): RuntimeTask {
  const start = copyVec(startInput);
  const end = copyVec(endInput);
  const now = copyVec(start);
  const frame = Math.max(1, frameInput);
  const waitTmp = Math.max(0, waitInput);
  let wait = 0;
  let vector: FixedVec3 = [0, 0, 0];
  let vecTime = frame;
  let count = Math.max(0, countInput) * 2;
  if (mode === 1 || mode === 4) {
    vector = vectorBetween(start, end, frame);
  } else if (mode === 2 || mode === 3) {
    vector = [fixedDivide(end[0], frame), fixedDivide(end[1], frame), fixedDivide(end[2], frame)];
    if (actor.oddPosition && reverseForOddPosition) vector = [-vector[0], vector[1], -vector[2]];
    if (mode === 3) count *= 2;
  }

  return {
    tick: () => {
      let complete = false;
      if (mode === 0) {
        copyInto(now, end);
        complete = true;
      } else if (mode === 1 || mode === 4) {
        if (wait === 0) {
          wait = waitTmp;
          complete = stepToward(now, vector, end);
        } else {
          wait -= 1;
        }
      } else if (mode === 2 || mode === 3) {
        if (wait === 0) {
          wait = waitTmp;
          addInto(now, vector);
          vecTime -= 1;
          if (vecTime === 0) {
            count -= 1;
            vecTime = frame;
            if (mode === 2 || (mode === 3 && (count & 1) !== 0)) vector = [-vector[0], -vector[1], -vector[2]];
          }
        } else {
          wait -= 1;
        }
        if (count === 0) {
          copyInto(now, start);
          complete = true;
        }
      } else {
        complete = true;
      }
      applyParamValue(actor, channel, now);
      return complete;
    },
  };
}

function applyParamValue(actor: RuntimeActor, channel: Exclude<TaskChannel, "blink" | "palette">, value: FixedVec3): void {
  switch (channel) {
    case "move":
      actor.position = copyVec(value);
      return;
    case "scale":
      actor.offsetScale = copyVec(value);
      return;
    case "rotate":
      actor.rotation = copyVec(value);
      return;
    case "alpha":
      actor.alpha = clamp(value[0] >> 12, 0, 31);
      return;
    case "mosaic":
      actor.mosaic = clamp(value[0] >> 12, 0, 15);
      return;
    case "shadowScale":
      actor.shadowOffsetScale = copyVec(value);
      return;
  }
}

function makeCircleTask(
  actor: RuntimeActor,
  params: { axis: number; shift: number; radiusH: number; radiusV: number; frame: number; rotateWait: number; count: number; rotateAfterWait: number },
): RuntimeTask {
  let angle = (params.axis & 1) !== 0 ? DS_ANGLE_FULL_TURN : 0;
  const speed = Math.trunc(DS_ANGLE_FULL_TURN / params.frame);
  let count = params.count;
  let rotateWaitCount = 0;
  let rotateAfterWaitCount = 0;
  return {
    tick: () => {
      if (rotateAfterWaitCount === 0) {
        if (rotateWaitCount === params.rotateWait) {
          rotateWaitCount = 0;
          angle += (params.axis & 1) !== 0 ? -speed : speed;
          if (angle < 0 || angle >= DS_ANGLE_FULL_TURN) {
            angle &= 0xffff;
            count -= 1;
            rotateAfterWaitCount = params.rotateAfterWait;
          }
          if (count !== 0) actor.effectPosition = circleOffset(params.axis, params.shift, angle, params.radiusH, params.radiusV);
        } else {
          rotateWaitCount += 1;
        }
      } else {
        rotateAfterWaitCount -= 1;
      }
      if (count === 0) actor.effectPosition = copyVec(ZERO_VEC);
      return count === 0;
    },
  };
}

function circleOffset(axis: number, shift: number, angle: number, radiusH: number, radiusV: number): FixedVec3 {
  let sin = 0;
  let cos = 0;
  if (shift === 0) {
    sin = -fixedMultiply(trigSin((angle + 0x4000) & 0xffff), radiusH) + radiusH;
    cos = -fixedMultiply(trigCos((angle + 0x4000) & 0xffff), radiusV);
  } else if (shift === 1) {
    sin = fixedMultiply(trigSin((angle + 0x4000) & 0xffff), radiusH) - radiusH;
    cos = fixedMultiply(trigCos((angle + 0x4000) & 0xffff), radiusV);
  } else if (shift === 2) {
    sin = -fixedMultiply(trigSin(angle), radiusH);
    cos = -fixedMultiply(trigCos(angle), radiusV) + radiusV;
  } else {
    sin = fixedMultiply(trigSin(angle), radiusH);
    cos = fixedMultiply(trigCos(angle), radiusV) - radiusV;
  }
  switch ((axis & 7) >> 1) {
    case 1:
      return [sin, 0, cos];
    case 2:
      return [sin, cos, 0];
    case 0:
    default:
      return [0, cos, sin];
  }
}

function makePaletteTask(actor: RuntimeActor, params: number[]): RuntimeTask {
  let value = params[1] ?? 0;
  const end = params[2] ?? 0;
  const waitParam = params[3] ?? 0;
  const waitTmp = waitParam < 0 ? 0 : waitParam;
  let step = waitParam < 0 ? (waitParam - 1) * -1 : 1;
  if (value > end) step *= -1;
  let wait = 0;
  const color: [number, number, number] = [clamp(params[4] ?? 0, 0, 31), clamp(params[5] ?? 0, 0, 31), clamp(params[6] ?? 0, 0, 31)];
  return {
    tick: () => {
      if (wait !== 0) {
        wait -= 1;
        return false;
      }
      actor.paletteEvy = clamp(value, 0, 16);
      actor.paletteColor = color;
      if (value === end) return true;
      value += step;
      if ((step >= 0 && value >= end) || (step < 0 && value <= end)) value = end;
      wait = waitTmp;
      return false;
    },
  };
}

function applyBlinkCommand(actor: RuntimeActor, params: number[]): void {
  if ((params[1] ?? 0) !== 2) return;
  const waitTmp = Math.max(0, params[2] ?? 0);
  let wait = 0;
  let count = Math.max(1, params[3] ?? 0) * 2;
  actor.tasks.set("blink", {
    tick: () => {
      if (wait === 0) {
        wait = waitTmp;
        count -= 1;
        return count === 0;
      }
      wait -= 1;
      return false;
    },
  });
}

function applyVisibilityCommand(actor: RuntimeActor, flag: number): void {
  if (flag === 0) actor.vanish = true;
  else if (flag === 1) actor.vanish = false;
  else if (flag === 2) actor.vanish = !actor.vanish;
  else if (flag === 3) {
    if (actor.vanish) actor.effectVanish = true;
    actor.vanish = true;
  } else if (flag === 4) {
    if (actor.effectVanish) actor.effectVanish = false;
    else actor.vanish = false;
  }
}

function restoreVanish(actor: RuntimeActor): void {
  actor.vanish = actor.savedVanish;
  actor.effectVanish = false;
}

function actorState(actor: RuntimeActor): Gen5BattleSpriteActorState {
  const baseOffset = subtractVec(actor.position, actor.defaultPosition);
  const totalOffset = addVec(baseOffset, actor.effectPosition);
  const scale: [number, number] = [actor.offsetScale[0] / FX32_ONE, actor.offsetScale[1] / FX32_ONE];
  const shadowScale: [number, number] = [
    scale[0] * (actor.shadowOffsetScale[0] / FX32_ONE),
    scale[1] * (actor.shadowOffsetScale[1] / FX32_ONE),
  ];
  const opacity = clamp(actor.alpha / 31, 0, 1);
  return {
    exists: actor.exists,
    visible: actor.exists && !actor.vanish,
    positionOffset: fixedVecToWorld(totalOffset),
    basePositionOffset: fixedVecToWorld(baseOffset),
    effectPositionOffset: fixedVecToWorld(actor.effectPosition),
    scale,
    rotation: -((((actor.rotation[2] >> 12) % DS_ANGLE_FULL_TURN) / DS_ANGLE_FULL_TURN) * Math.PI * 2),
    opacity,
    palette: { evy: clamp(actor.paletteEvy, 0, 16), color: [...actor.paletteColor] },
    mosaic: clamp(actor.mosaic, 0, 15),
    shadow: {
      visible: actor.exists && !actor.vanish && !actor.shadowVanish,
      // MCSS applies X/Z effect offsets to the shadow matrix but deliberately
      // omits ofs_pos.y, keeping the shadow on the actor's ground plane.
      positionOffset: [totalOffset[0] / FX32_ONE, 0, (totalOffset[2] + SHADOW_DEPTH_OFFSET) / FX32_ONE],
      scale: shadowScale,
      opacity: opacity / 2,
    },
  };
}

function vectorBetween(start: FixedVec3, end: FixedVec3, frame: number): FixedVec3 {
  return [moveVector(start[0], end[0], frame), moveVector(start[1], end[1], frame), moveVector(start[2], end[2], frame)];
}

function moveVector(start: number, end: number, frame: number): number {
  const delta = end - start;
  if (delta === 0) return 0;
  const vector = Math.trunc(delta / Math.max(1, frame));
  return vector === 0 ? (delta > 0 ? 1 : -1) : vector;
}

function stepToward(now: FixedVec3, vector: FixedVec3, end: FixedVec3): boolean {
  let complete = true;
  for (let index = 0; index < 3; index += 1) {
    now[index] += vector[index];
    if (vector[index] < 0) {
      if (now[index] <= end[index]) now[index] = end[index];
      else complete = false;
    } else if (now[index] >= end[index]) {
      now[index] = end[index];
    } else {
      complete = false;
    }
  }
  return complete;
}

function fixedDivide(value: number, divisor: number): number {
  if (divisor === 0) return value;
  const result = Math.trunc(value / divisor);
  if (result !== 0 || value === 0) return result;
  return value > 0 ? 1 : -1;
}

function fixedMultiply(a: number, b: number): number {
  return Math.trunc((a * b) / FX32_ONE);
}

function trigSin(angle: number): number {
  return Math.round(Math.sin((angle / DS_ANGLE_FULL_TURN) * Math.PI * 2) * FX32_ONE);
}

function trigCos(angle: number): number {
  return Math.round(Math.cos((angle / DS_ANGLE_FULL_TURN) * Math.PI * 2) * FX32_ONE);
}

function copyVec(value: readonly number[]): FixedVec3 {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function copyInto(target: FixedVec3, value: FixedVec3): void {
  target[0] = value[0];
  target[1] = value[1];
  target[2] = value[2];
}

function addInto(target: FixedVec3, value: FixedVec3): void {
  target[0] += value[0];
  target[1] += value[1];
  target[2] += value[2];
}

function addVec(a: FixedVec3, b: FixedVec3): FixedVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtractVec(a: FixedVec3, b: FixedVec3): FixedVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function fixedVecToWorld(value: FixedVec3): [number, number, number] {
  return [value[0] / FX32_ONE, value[1] / FX32_ONE, value[2] / FX32_ONE];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
