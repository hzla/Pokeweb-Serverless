import type { MoveAnimationTimelineEvent } from "./moveAnimationPreviewModel";
import {
  GEN5_BATTLE_VERTICAL_FOV,
  GEN5_DEFAULT_CAMERA_POSITION,
  GEN5_DEFAULT_CAMERA_TARGET,
  GEN5_SINGLE_TARGET_CAMERA_POSITION,
  GEN5_SINGLE_TARGET_CAMERA_TARGET,
  GEN5_SINGLE_USER_CAMERA_POSITION,
  GEN5_SINGLE_USER_CAMERA_TARGET,
} from "./gen5BattleSceneLayout";

export type BattleCameraState = {
  activeCommand?: string;
  backdropFocus: [number, number];
  backdropOffset: [number, number];
  backdropZoom: number;
  fov: number;
  lookAt: [number, number, number];
  position: [number, number, number];
  shake: [number, number];
};

type CameraPose = Omit<BattleCameraState, "activeCommand" | "shake">;

// These poses are the retail single-battle camera tables from Swan.
const DEFAULT_POSE: CameraPose = {
  backdropFocus: [0.48, 0.6],
  backdropOffset: [0, 0],
  backdropZoom: 1,
  fov: GEN5_BATTLE_VERTICAL_FOV,
  lookAt: [...GEN5_DEFAULT_CAMERA_TARGET],
  position: [...GEN5_DEFAULT_CAMERA_POSITION],
};

const USER_POSE: CameraPose = {
  backdropFocus: [0.23, 0.82],
  backdropOffset: [0.08, -0.06],
  backdropZoom: 1.45,
  fov: GEN5_BATTLE_VERTICAL_FOV,
  lookAt: [...GEN5_SINGLE_USER_CAMERA_TARGET],
  position: [...GEN5_SINGLE_USER_CAMERA_POSITION],
};

const TARGET_POSE: CameraPose = {
  backdropFocus: [0.66, 0.42],
  backdropOffset: [-0.08, 0.01],
  backdropZoom: 1.45,
  fov: GEN5_BATTLE_VERTICAL_FOV,
  lookAt: [...GEN5_SINGLE_TARGET_CAMERA_TARGET],
  position: [...GEN5_SINGLE_TARGET_CAMERA_POSITION],
};

export function simulateBattleCamera(timeline: MoveAnimationTimelineEvent[], frame: number): BattleCameraState {
  const cameraEvents = timeline.filter(isCameraCommand).sort((a, b) => a.frame - b.frame);
  const movement = resolveCameraMovement(cameraEvents, frame);
  const shake = resolveCameraShake(cameraEvents, frame);
  return { ...movement, activeCommand: activeCameraCommand(cameraEvents, frame), shake };
}

export function cameraEventDuration(event: Pick<MoveAnimationTimelineEvent, "command" | "params">): number {
  if (event.command === "MoveCamera") return Math.max(1, event.params[2] ?? 1);
  if (event.command === "AdjustCamera") return Math.max(1, event.params[7] ?? 1);
  if (event.command === "CameraMoveAngle") return Math.max(1, event.params[3] ?? 1);
  if (event.command === "CameraProjection") return 1;
  if (event.command === "ShakeScreen") return Math.max(1, (event.params[3] ?? 1) * Math.max(1, event.params[5] ?? 1));
  return 1;
}

function resolveCameraMovement(events: MoveAnimationTimelineEvent[], frame: number): CameraPose {
  let pose = DEFAULT_POSE;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.frame > frame) break;
    if (!isCameraMoveEvent(event)) continue;
    const next = poseForCameraEvent(event, pose);
    const duration = cameraEventDuration(event);
    const rate = smoothstep(Math.min(1, Math.max(0, (frame - event.frame) / duration)));
    pose = interpolatePose(pose, next, rate);
    if (rate < 1) break;
  }
  return pose;
}

function resolveCameraShake(events: MoveAnimationTimelineEvent[], frame: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const event of events) {
    if (event.command !== "ShakeScreen") continue;
    const duration = cameraEventDuration(event);
    const local = frame - event.frame;
    if (local < 0 || local > duration) continue;
    const axis = event.params[0] ?? 0;
    const amplitude = Math.min(0.08, Math.abs(event.params[1] ?? event.params[2] ?? 0) / 4096);
    const wave = Math.sin(local * Math.PI * 2) * (1 - local / duration) * amplitude;
    if (axis === 0 || axis === 2) x += wave;
    if (axis === 1 || axis === 2) y += wave;
  }
  return [x, y];
}

function activeCameraCommand(events: MoveAnimationTimelineEvent[], frame: number): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].frame <= frame) return events[index].command;
  }
  return undefined;
}

function poseForCameraEvent(event: MoveAnimationTimelineEvent, current: CameraPose): CameraPose {
  if (event.command === "MoveCamera") return poseForPreset(event.params[1] ?? 0, current);
  if (event.command === "AdjustCamera") return poseForCoordinates(event);
  if (event.command === "CameraMoveAngle") return poseForAngles(event, current);
  if (event.command === "CameraProjection") return { ...current, fov: projectionFov(event.params[0] ?? 0, event.params[1] ?? 0) };
  if (event.command === "CameraPosPush") return DEFAULT_POSE;
  return current;
}

function poseForPreset(preset: number, current: CameraPose): CameraPose {
  // Source: EFFVM_CAMERA_MOVE in Swan. In a single battle ATTACK/ATTACK_PAIR
  // resolve to position AA, while DEFENCE/DEFENCE_PAIR resolve to BB.
  if (preset === 0 || preset === 9 || preset === 10 || preset === 21) return USER_POSE;
  if (preset === 1 || preset === 11 || preset === 12) return TARGET_POSE;
  if (preset === 8 || preset === 17) return DEFAULT_POSE;
  // Plural and zoom-out presets are no-ops in a retail 1-vs-1 battle.
  return current;
}

function poseForCoordinates(event: MoveAnimationTimelineEvent): CameraPose {
  const pos: [number, number, number] = [fixedToWorld(event.params[1] ?? 0), fixedToWorld(event.params[2] ?? 0), fixedToWorld(event.params[3] ?? 0)];
  const target: [number, number, number] = [fixedToWorld(event.params[4] ?? 0), fixedToWorld(event.params[5] ?? 0), fixedToWorld(event.params[6] ?? 0)];
  const focusX = target[0] >= 0 ? 0.67 : 0.25;
  const focusY = target[2] <= 0 ? 0.48 : 0.78;
  const distance = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  return {
    backdropFocus: [focusX, focusY],
    backdropOffset: [0, 0],
    backdropZoom: Math.max(1, Math.min(2.2, 72 / Math.max(32, distance))),
    fov: 34,
    lookAt: target,
    position: pos,
  };
}

function poseForAngles(event: MoveAnimationTimelineEvent, current: CameraPose): CameraPose {
  const phi = degreesToRadians(angleParamToDegrees(event.params[1] ?? 0));
  const theta = degreesToRadians(angleParamToDegrees(event.params[2] ?? 0));
  const radius = Math.hypot(current.position[0] - current.lookAt[0], current.position[1] - current.lookAt[1], current.position[2] - current.lookAt[2]);
  const horizontal = Math.cos(theta) * radius;
  return {
    ...current,
    position: [
      current.lookAt[0] + Math.sin(phi) * horizontal,
      current.lookAt[1] + Math.sin(theta) * radius,
      current.lookAt[2] + Math.cos(phi) * horizontal,
    ],
  };
}

function projectionFov(type: number, pos: number): number {
  if (type <= 0) return 38;
  if (pos >= 10) return 28;
  if (pos >= 1) return 32;
  return 38;
}

function isCameraCommand(event: MoveAnimationTimelineEvent): boolean {
  return event.command === "MoveCamera" || event.command === "AdjustCamera" || event.command === "CameraMoveAngle" || event.command === "CameraProjection" || event.command === "CameraPosPush" || event.command === "ShakeScreen";
}

function isCameraMoveEvent(event: MoveAnimationTimelineEvent): boolean {
  return event.command !== "ShakeScreen";
}

function interpolatePose(from: CameraPose, to: CameraPose, rate: number): CameraPose {
  return {
    backdropFocus: [lerp(from.backdropFocus[0], to.backdropFocus[0], rate), lerp(from.backdropFocus[1], to.backdropFocus[1], rate)],
    backdropOffset: [lerp(from.backdropOffset[0], to.backdropOffset[0], rate), lerp(from.backdropOffset[1], to.backdropOffset[1], rate)],
    backdropZoom: lerp(from.backdropZoom, to.backdropZoom, rate),
    fov: lerp(from.fov, to.fov, rate),
    lookAt: lerpVec3(from.lookAt, to.lookAt, rate),
    position: lerpVec3(from.position, to.position, rate),
  };
}

function lerpVec3(from: [number, number, number], to: [number, number, number], rate: number): [number, number, number] {
  return [lerp(from[0], to[0], rate), lerp(from[1], to[1], rate), lerp(from[2], to[2], rate)];
}

function fixedToWorld(value: number): number {
  return Math.max(-80, Math.min(80, value / 4096));
}

function angleParamToDegrees(value: number): number {
  return Math.abs(value) > 360 ? (value / 4096) * 360 : value;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(from: number, to: number, rate: number): number {
  return from + (to - from) * rate;
}
