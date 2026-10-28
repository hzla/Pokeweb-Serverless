import { decompileMoveAnimationBytes, parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "./moveAnimationModel";
import type { BattleCameraPose, BattleCameraPreset } from "./battleCameraModel";

export const BATTLE_IDLE_CAMERA_EFFECTS = [0x235, 0x24c, 0x24d, 0x24e, 0x24f, 0x250] as const;
export type BattleCameraProgram = ParsedMoveAnimationCommand[];
export type BattleCameraPrograms = Map<number, BattleCameraProgram>;
export type BattleSceneCameraMode = "placement" | "sendout" | "selection" | "idle" | "free";
const axes = ["x", "y", "z"] as const;
const vectors = ["position", "target"] as const;
const clone = (pose: BattleCameraPose): BattleCameraPose => ({ position: { ...pose.position }, target: { ...pose.target } });
const packed = (pose: BattleCameraPose) => vectors.flatMap(key => axes.map(axis => Math.round(pose[key][axis] * 4096)));
const unpack = (p: number[]): BattleCameraPose => ({ position: { x: p[0] / 4096, y: p[1] / 4096, z: p[2] / 4096 }, target: { x: p[3] / 4096, y: p[4] / 4096, z: p[5] / 4096 } });

export function parseBattleCameraProgram(bytes: Uint8Array): BattleCameraProgram {
  const program = parseMoveAnimationScript(decompileMoveAnimationBytes(bytes));
  const commands = program.scripts.get(program.headerLabels[0]);
  if (!commands) throw new Error("Battle camera script has no entry point.");
  return commands;
}

export function selectionCameraEffect(rule: number): number { return rule === 3 ? 0x245 : rule === 1 || rule === 2 ? 0x244 : 0x23f; }

export function battlePhaseCamera(programs: BattleCameraPrograms, mode: "sendout" | "selection", defaultPose: BattleCameraPose, rule: number): BattleCameraPose {
  const effect = mode === "sendout" ? 0x232 : selectionCameraEffect(rule);
  const command = programs.get(effect)?.find(c => c.name === "AdjustCamera");
  if (!command) throw new Error("The selected battle view has no camera placement in this ROM.");
  return coordinatePose(command.params, defaultPose);
}

function coordinatePose(params: number[], current: BattleCameraPose): BattleCameraPose {
  if (params.length !== 10 || ![0, 1, 2].includes(params[0])) throw new Error("Unsupported battle camera command.");
  const raw = params.slice(1, 7);
  if (params[0] === 2) { const base = packed(current); raw.forEach((n, i) => { raw[i] = n + base[i]; }); }
  return unpack(raw);
}

/** Camera-only execution of the ROM's idle shots. Sprite/particle tasks are excluded. */
export function buildBattleIdleCameraFrames(commands: BattleCameraProgram, initial: BattleCameraPose, defaults: BattleCameraPose, presets: BattleCameraPreset[], rule = 0): BattleCameraPose[] {
  let current = packed(initial), saved = clone(initial), motion: { end: number[]; step: number[]; wait: number; reset: number; brake: number } | undefined;
  const frames: BattleCameraPose[] = [unpack(current)];
  const variables = new Map<number, number>([[53, rule === 0 ? 0 : 1], [54, 0]]);
  const offsets = [0];
  for (const c of commands) offsets.push(offsets.at(-1)! + 2 + c.params.length * 4);
  const tick = () => {
    if (frames.length >= 12000) throw new Error("Battle camera shot exceeds the preview frame limit.");
    if (motion) {
      if (motion.wait > 0) motion.wait--;
      else {
        motion.wait = motion.reset;
        if (motion.brake !== 0 && --motion.brake === 0) motion.step = motion.step.map(n => n >> 1 ? n >> 1 : n);
        current = current.map((n, i) => motion!.step[i] < 0 ? Math.max(motion!.end[i], n + motion!.step[i]) : Math.min(motion!.end[i], n + motion!.step[i]));
        if (current.every((n, i) => n === motion!.end[i])) motion = undefined;
      }
    }
    frames.push(unpack(current));
  };
  const move = (pose: BattleCameraPose, type: number, duration: number, wait: number, brake: number) => {
    const end = packed(pose);
    if (type === 0) { current = end; motion = undefined; frames[frames.length - 1] = unpack(current); return; }
    if (duration < 0 || wait < 0 || duration > 6000 || wait > 60) throw new Error("Unsupported battle camera timing.");
    // FX_GetDivResult rounds the hardware quotient before returning fx32.
    motion = { end, step: end.map((n, i) => { const d = n - current[i]; return Math.floor(d / Math.max(1, duration) + 0.5) || Math.sign(d); }), wait, reset: wait, brake };
  };
  for (let pc = 0, budget = 0; pc < commands.length; pc++) {
    if (++budget > 3000) throw new Error("Battle camera script contains an unsupported loop.");
    const c = commands[pc], p = c.params;
    if (c.name === "CheckMoveuser") {
      if (!variables.has(p[0])) throw new Error("Idle camera depends on unsupported battle state.");
      const a = variables.get(p[0])!, b = p[2];
      const take = [a === b, a !== b, a < b, a > b, a <= b, a >= b][p[1]];
      if (take) { const next = offsets.indexOf(offsets[pc + 1] + p[3]); if (next < 0) throw new Error("Invalid camera script branch."); pc = next - 1; }
    } else if (c.name === "SetParam") variables.set(p[0], p[1]);
    else if (c.name === "AdjustCamera") move(coordinatePose(p, unpack(current)), p[0], p[7], p[8], p[9]);
    else if (c.name === "MoveCamera") {
      const preset = p[1] === 13 ? saved : p[1] === 8 || p[1] === 17 ? defaults : presets.find(v => v.id === (p[1] === 14 ? "wide-double" : p[1] === 19 ? "wide-triple" : p[1] === 18 ? "offset" : p[1] === 0 ? "single-player" : p[1] === 1 ? "single-opponent" : ""));
      if (!preset) throw new Error(`Unsupported idle camera preset ${p[1]}.`);
      move(preset, p[0], p[2], p[3], p[4]);
    } else if (c.name === "CameraPosPush") saved = unpack(current);
    else if (c.name === "Wait") { for (let i = 0; i < p[0]; i++) tick(); }
    else if (c.name === "LetCMDsFinish" && (p[0] === 0 || p[0] === 1)) { while (motion) tick(); }
    else if (c.name === "TerminateMoveScript") break;
    else if (/^(?:CameraMoveAngle|CallSequence|Jump|CheckMoveUserElse)$/u.test(c.name)) throw new Error(`Unsupported camera flow: ${c.name}.`);
  }
  while (motion) tick();
  return frames;
}
