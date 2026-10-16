import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { createNarcStore, decodeRecord } from "../pokeweb/projectStore";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { getMatrixSnapshot, applyMatrixCellEdit } from "../pokeweb/matrixModel";
import { clearSeasonalAssignment, getMapReplacementBytes, getSeasonalAssignment, materializeMapReplacementFile, parseMapReplacementFile, replacementRules,
  resolveSeasonalMatrix, seasonalAssignmentDraft, setSeasonalAssignment } from "../pokeweb/seasonalMatrixModel";
import { makeMatrixProject } from "./fixtures/matrixProject";

function bytes(rows: Array<{ matrix?: number; type?: number; condition?: number; values: number[] }>): Uint8Array {
  const raw: Record<string, number> = { entry_count: rows.length };
  rows.forEach((row, i) => {
    raw[`matrix_${i}`] = row.matrix ?? 0; raw[`type_${i}`] = row.type ?? 0; raw[`condition_${i}`] = row.condition ?? 0;
    [...row.values, 0, 65535].slice(0, 6).forEach((value, slot) => { raw[`value_${i}_${slot}`] = value; });
  }); return materializeMapReplacementFile(raw);
}
function fixture(baseRom: "BW" | "BW2" = "BW2") {
  const project = makeMatrixProject(baseRom), narc = new NARC();
  narc.files = [bytes([
    { values: [0, 1, 2, 3, 42, 0xbeef] },
    { condition: 3, values: [0, 7, 0, 0, 12, 0xabcd] },
    { type: 1, matrix: 1, values: [1, 1, 0, 1] },
    { values: [0, 1, 2, 3, 99, 0xffff] },
  ]), Uint8Array.of(8, 9, 10)];
  project.narcs.map_replace = createNarcStore("map_replace", "a/0/1/0", 3, narc);
  return project;
}
describe("Gen 5 seasonal matrix assignments", () => {
  it("round trips all six native values, unknown types/conditions, and malformed inputs", () => {
    const original = bytes([{ type: 240, condition: 230, values: [1, 2, 3, 4, 0x1234, 0xabcd] }]);
    expect(materializeMapReplacementFile(parseMapReplacementFile(original))).toEqual(original);
    for (const length of [1, 15, 17, 65536]) expect(() => parseMapReplacementFile(new Uint8Array(length))).toThrow();
    expect(() => materializeMapReplacementFile({ entry_count: 4096 })).toThrow();
    expect(materializeMapReplacementFile(parseMapReplacementFile(new Uint8Array()))).toEqual(new Uint8Array());
  });
  it.each(["BW", "BW2"] as const)("updates duplicate %s seasonal rules atomically and preserves unrelated bytes", baseRom => {
    const project = fixture(baseRom), original = getMapReplacementBytes(project).slice();
    const state = getSeasonalAssignment(project, 0, "map", 0);
    expect(state.matches).toHaveLength(2); expect(state.affected).toEqual([0]);
    expect(setSeasonalAssignment(project, 0, "map", 0, [0, 2, 3, 4])).toBe(true);
    const changed = getMapReplacementBytes(project), rules = replacementRules(changed);
    expect(rules[0].values).toEqual([0, 2, 3, 4, 42, 0xbeef]); expect(rules[3].values).toEqual([0, 2, 3, 4, 99, 65535]);
    expect(changed.slice(16, 48)).toEqual(original.slice(16, 48));
    expect(project.narcs.map_replace!.rawFiles[1]).toEqual(Uint8Array.of(8, 9, 10));
    expect(project.narcs.map_replace!.dirty).toEqual(new Set([0])); expect(project.narcs.map_replace!.revision).toBe(1);
    expect(getMatrixSnapshot(project, 0).cells[0].mapId).toBe(0); expect(project.headers!.rows[1].matrix_id).toBe(0);
    expect(setSeasonalAssignment(project, 0, "map", 0, [0, 2, 3, 4])).toBe(false);
  });
  it("stages previews without saving and rejects a whole invalid operation", () => {
    const project = fixture(), original = getMapReplacementBytes(project).slice();
    const draft = seasonalAssignmentDraft(project, 0, "map", 0, [0, 2, 3, 4]);
    expect(resolveSeasonalMatrix(project, 0, "winter", undefined, draft).cells[0].mapId).toBe(4);
    expect(getMapReplacementBytes(project)).toEqual(original); expect(project.narcs.map_replace!.dirty.size).toBe(0);
    for (const values of [[0, 1, 2, 8], [0, -1, 2, 3], [1, 1, 2, 3], [0, 65535, 2, 3], [0, 1.5, 2, 3]])
      expect(() => setSeasonalAssignment(project, 0, "map", 0, values)).toThrow();
    expect(getMapReplacementBytes(project)).toEqual(original); expect(project.narcs.map_replace!.dirty.size).toBe(0);
  });
  it("finds every reused map cell and appends and removes only its seasonal rule", () => {
    const project = fixture(); applyMatrixCellEdit(project, 0, [1, 3], { mapId: 4 });
    expect(getSeasonalAssignment(project, 0, "map", 4).affected).toEqual([1, 3, 5]);
    const original = getMapReplacementBytes(project).slice();
    expect(setSeasonalAssignment(project, 0, "map", 4, [4, 4, 4, 4])).toBe(false);
    expect(setSeasonalAssignment(project, 0, "map", 4, [4, 5, 6, 7])).toBe(true);
    expect(getMapReplacementBytes(project).slice(0, original.length)).toEqual(original);
    expect(resolveSeasonalMatrix(project, 0, "winter").cells.filter(cell => cell.mapId === 7).map(cell => cell.index)).toEqual([1, 3, 5]);
    expect(clearSeasonalAssignment(project, 0, "map", 4)).toBe(true); expect(getMapReplacementBytes(project)).toEqual(original);
    clearSeasonalAssignment(project, 0, "map", 0);
    expect(replacementRules(getMapReplacementBytes(project)).map(rule => rule.condition)).toEqual([3, 0]);
  });
  it("applies rules in stored order after a whole-matrix replacement and keeps the base grid intact", () => {
    const project = fixture();
    clearSeasonalAssignment(project, 0, "map", 0);
    setSeasonalAssignment(project, 0, "matrix", undefined, [0, 1, 0, 1]);
    setSeasonalAssignment(project, 1, "map", 5, [5, 6, 7, 6]);
    const summer = resolveSeasonalMatrix(project, 0, "summer");
    expect(summer).toMatchObject({ id: 1, width: 2, height: 1, hasHeaders: false });
    expect(summer.cells.map(cell => cell.mapId)).toEqual([6, 6]);
    expect(getMatrixSnapshot(project, 1).cells.map(cell => cell.mapId)).toEqual([5, 6]);
    expect(getSeasonalAssignment(project, 0, "matrix").affected).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => setSeasonalAssignment(project, 0, "matrix", undefined, [0, 2, 0, 1])).toThrow();
  });
  it("preserves existing invalid targets when another season changes", () => {
    const project = fixture(); project.narcs.map_replace!.rawFiles[0] = bytes([{ values: [0, 99, 2, 3] }]);
    expect(setSeasonalAssignment(project, 0, "map", 0, [0, 99, 2, 4])).toBe(true);
    expect(() => setSeasonalAssignment(project, 0, "map", 0, [0, 99, 98, 4])).toThrow();
  });
  it("retains edits and appended entries through the standard project document", () => {
    const project = fixture(); decodeRecord(project, "map_replace", 0);
    setSeasonalAssignment(project, 0, "map", 4, [4, 5, 6, 7]);
    const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
    expect(getSeasonalAssignment(reopened, 0, "map", 4).values).toEqual([4, 5, 6, 7]);
    expect(getMapReplacementBytes(reopened)).toEqual(getMapReplacementBytes(project));
    expect(reopened.narcs.map_replace!.fileCount).toBe(2);
  });
});
