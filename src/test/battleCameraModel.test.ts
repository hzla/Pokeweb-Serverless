import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import { battleCameraResetPatch, updateBattleCamera, validateBattleCameraPose, type BattleCameraDocument } from "../pokeweb/battleCameraModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { makeEditProject } from "./fixtures/editProject";

function fixture() {
  const overlay = new Uint8Array(0x16800).fill(0xa5);
  const document: BattleCameraDocument = { baseAddress: 0x021ddaa0, overlay, presets: [
    { id: "default", label: "Default", position: { x: 6.7, y: 6.7, z: 17.3 }, target: { x: 0, y: 2.6, z: 0 } },
    { id: "single-player", label: "Player", position: { x: 4, y: 5, z: 6 }, target: { x: 1, y: 2, z: 3 } },
  ] };
  const project = { overlays: {}, patches: { dirtyOverlayIds: [36], applied: {} } } as unknown as ProjectState;
  return { project, document };
}

describe("native battle camera placement", () => {
  it("writes six independent signed fx32 coordinates, updates reset, and preserves other overlay bytes", () => {
    const { project, document } = fixture(), before = document.overlay.slice();
    const pose = { position: { x: -10.125, y: 9.25, z: 23.875 }, target: { x: 2.5, y: -1.75, z: -4.625 } };
    const result = updateBattleCamera(project, document, "default", pose);
    expect(result).toMatchObject(pose);
    const bytes = project.overlays[168]!, view = new DataView(bytes.buffer);
    for (const [i, value] of [2.5, -1.75, -4.625, -10.125, 9.25, 23.875].entries()) expect(view.getInt32(0x15514 + i * 4, true)).toBe(value * 4096);
    expect(bytes.subarray(0x1020, 0x1044)).toEqual(battleCameraResetPatch());
    const restored = bytes.slice(); restored.set(before.subarray(0x1020, 0x1044), 0x1020); restored.set(before.subarray(0x15514, 0x1552c), 0x15514);
    expect(restored).toEqual(before);
    expect(project.patches!.dirtyOverlayIds).toEqual([36, 168]);
    expect(document.overlay).toEqual(bytes);
    expect(readU32(battleCameraResetPatch(), 32)).toBe(0x021f2fb4);
  });
  it("edits focused presets independently and quantizes to the native precision", () => {
    const { project, document } = fixture();
    const pose = { position: { x: 1.23456, y: 4, z: 9 }, target: { x: 0, y: 2, z: 0 } };
    const saved = updateBattleCamera(project, document, "single-player", pose);
    expect(saved.position.x).toBe(Math.round(1.23456 * 4096) / 4096);
    expect(project.overlays[168]!.subarray(0x1020, 0x1044)).toEqual(new Uint8Array(36).fill(0xa5));
    updateBattleCamera(project, document, "default", document.presets[0]);
    expect(new DataView(project.overlays[168]!.buffer).getInt32(0x16594, true)).toBe(Math.round(1.23456 * 4096));
  });
  it("rejects singular, overflowing and nonfinite poses before changing the project", () => {
    const { project, document } = fixture();
    for (const pose of [
      { position: { x: 0, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } },
      { position: { x: NaN, y: 0, z: 2 }, target: { x: 0, y: 0, z: 0 } },
      { position: { x: 524288, y: 0, z: 2 }, target: { x: 0, y: 0, z: 0 } },
    ]) expect(() => updateBattleCamera(project, document, "default", pose)).toThrow();
    expect(project.overlays).toEqual({});
    expect(project.patches!.dirtyOverlayIds).toEqual([36]);
    expect(() => validateBattleCameraPose({ position: { x: 0.00001, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } })).toThrow();
  });
  it("rejects stale overlay documents without discarding another edit", () => {
    const { project, document } = fixture();
    project.overlays[168] = document.overlay.slice(); project.overlays[168]![0] = 7;
    expect(() => updateBattleCamera(project, document, "default", document.presets[0])).toThrow(/changed/);
    expect(project.overlays[168]![0]).toBe(7);
  });
  it("retains the edited camera overlay through compact autosave documents", () => {
    const { document } = fixture(), project = makeEditProject();
    updateBattleCamera(project, document, "default", { position: { x: 10, y: 8, z: 21 }, target: { x: 2, y: 3, z: -1 } });
    const saved = structuredClone(createProjectDocument(project, true));
    expect(saved.overlays[168]).toEqual(project.overlays[168]);
    const reopened = openProjectSession(saved);
    expect(reopened.overlays[168]).toEqual(project.overlays[168]);
    expect(reopened.patches!.dirtyOverlayIds).toContain(168);
  });
});
