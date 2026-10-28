import { describe, expect, it } from "vitest";
import { battlePhaseCamera, buildBattleIdleCameraFrames, parseBattleCameraProgram, selectionCameraEffect, type BattleCameraProgram } from "../pokeweb/battleSceneCamera";
import { compileMoveAnimation } from "../pokeweb/moveAnimationModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { BattleCameraPose } from "../pokeweb/battleCameraModel";

const initial: BattleCameraPose = { position: { x: 10, y: 5, z: 20 }, target: { x: 0, y: 2, z: 0 } };
const program = (text: string) => parseBattleCameraProgram(compileMoveAnimation({} as ProjectState, 561, text));
const move = (type: number, pos: number[], target: number[], frames = 4, brake = 0) => `AdjustCamera ${[type, ...pos.map(n => Math.round(n * 4096)), ...target.map(n => Math.round(n * 4096)), frames, 0, brake].join(", ")}`;

describe("battle phase and roaming cameras", () => {
  it("reads the send-out offset and the format's selection placement from scripts", () => {
    const programs = new Map<number, BattleCameraProgram>([
      [0x232, program(`${move(2, [10, 1, 16], [6, 2, 16])}\nTerminateMoveScript`)],
      [0x23f, program(`${move(1, [5.7, 5.2, 17.3], [-1, 1.1, 0])}\nTerminateMoveScript`)],
      [0x244, program(`${move(1, [8.7, 7.7, 23.8], [2, 3.6, 6.5])}\nTerminateMoveScript`)],
      [0x245, program(`${move(1, [8.7, 7.7, 27.3], [2, 3.6, 10])}\nTerminateMoveScript`)],
    ]);
    expect(battlePhaseCamera(programs, "sendout", initial, 0)).toEqual({ position: { x: 20, y: 6, z: 36 }, target: { x: 6, y: 4, z: 16 } });
    expect(battlePhaseCamera(programs, "selection", initial, 0).target.x).toBe(-1);
    expect(battlePhaseCamera(programs, "selection", initial, 1).target.z).toBe(6.5);
    expect(battlePhaseCamera(programs, "selection", initial, 2).target.z).toBe(6.5);
    expect(battlePhaseCamera(programs, "selection", initial, 3).target.z).toBe(10);
    expect([0, 1, 2, 3].map(selectionCameraEffect)).toEqual([0x23f, 0x244, 0x244, 0x245]);
  });
  it("steps native fixed-point movement and halves the step at the brake frame", () => {
    const commands = program(`${move(1, [14, 9, 16], [4, 6, -4], 4, 2)}\nLetCMDsFinish 0\nTerminateMoveScript`);
    const frames = buildBattleIdleCameraFrames(commands, initial, initial, []);
    expect(frames[1].position).toEqual({ x: 11, y: 6, z: 19 });
    expect(frames[2].position).toEqual({ x: 11.5, y: 6.5, z: 18.5 });
    expect(frames).toHaveLength(8);
    expect(frames.at(-1)).toEqual({ position: { x: 14, y: 9, z: 16 }, target: { x: 4, y: 6, z: -4 } });
  });
  it("keeps movement running during waits and returns to the saved selection camera", () => {
    const commands = program(`${move(2, [4, 0, 0], [4, 0, 0])}\nWait 2\nLetCMDsFinish 0\nCameraPosPush\n${move(2, [2, 0, 0], [2, 0, 0])}\nLetCMDsFinish 0\nMoveCamera 1, 13, 4, 0, 0\nLetCMDsFinish 0\nTerminateMoveScript`);
    const frames = buildBattleIdleCameraFrames(commands, initial, initial, []);
    expect(frames[2].position.x).toBe(12);
    expect(frames.at(-1)?.position.x).toBe(14);
    expect(Math.max(...frames.map(p => p.position.x))).toBe(16);
    expect(initial.position.x).toBe(10);
  });
  it("rounds native division before applying minimum one-unit fixed-point steps", () => {
    const commands = program(`${move(1, [10 + 5 / 4096, 5, 20 - 5 / 4096], [0, 2, 0], 3)}\nLetCMDsFinish 0\nTerminateMoveScript`);
    const frames = buildBattleIdleCameraFrames(commands, initial, initial, []);
    expect(frames).toHaveLength(4);
    expect(frames[1].position.x).toBe(10 + 2 / 4096);
    expect(frames[1].position.z).toBe(20 - 2 / 4096);
  });
  it("waits before the first step and between subsequent native camera steps", () => {
    const commands = program("AdjustCamera 1, 49152, 20480, 81920, 0, 8192, 0, 2, 2, 0\nLetCMDsFinish 0\nTerminateMoveScript");
    const frames = buildBattleIdleCameraFrames(commands, initial, initial, []);
    expect(frames.map(p => p.position.x)).toEqual([10, 10, 10, 11, 11, 11, 12]);
  });
  it("honors the native wide-view branch without jumping into the wrong instruction", () => {
    const commands = program(`CheckMoveuser 53, 0, 0, 42\n${move(2, [4, 0, 0], [4, 0, 0])}\nLetCMDsFinish 0\nTerminateMoveScript`);
    expect(buildBattleIdleCameraFrames(commands, initial, initial, [], 0)).toEqual([initial]);
    expect(buildBattleIdleCameraFrames(commands, initial, initial, [], 1).at(-1)?.position.x).toBe(14);
  });
  it("rejects unavailable camera data and unsupported script flow", () => {
    expect(() => battlePhaseCamera(new Map(), "sendout", initial, 0)).toThrow(/no camera/);
    expect(() => buildBattleIdleCameraFrames(program("MoveCamera 1, 99, 4, 0, 0\nTerminateMoveScript"), initial, initial, [])).toThrow(/preset/);
    expect(() => buildBattleIdleCameraFrames(program("CheckMoveuser 999, 0, 0, 0\nTerminateMoveScript"), initial, initial, [])).toThrow(/battle state/);
  });
});
