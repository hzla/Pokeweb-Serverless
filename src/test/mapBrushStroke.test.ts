import { describe, expect, it } from "vitest";
import {
  countedAs, emptyBrushStroke, permission, redoBrushStroke, startBrushStroke, undoBrushStroke, writeBrushStroke, writePermission,
  type BrushStroke, type BrushStrokeKind,
} from "../pokeweb/mapBrushStroke";
import type { MapTreeOriginal } from "../pokeweb/mapTrees";
import { gen5ImportProject } from "./fixtures/gen5MapImport";

type Saved = Record<number, MapTreeOriginal>;
type TestStroke = BrushStroke<"place" | "remove", "blocked" | "water", Saved> & { extra?: number };

const KIND: BrushStrokeKind<TestStroke> = {
  originals: "mapTreeOriginalPermissions",
  thing: "object",
  counted: countedAs("object"),
  actions: { place: { done: "Placed", label: "Place Objects" }, remove: { done: "Removed", label: "Remove Objects" } },
};

/** A stroke that rewrites map chunk 0 and saves one tile for it. */
function placeOne(project: ReturnType<typeof gen5ImportProject>) {
  const before = project.narcs.maps!.rawFiles[0]!.slice();
  const after = before.slice();
  after[after.length - 1] ^= 0xff;
  const stroke: TestStroke = { ...emptyBrushStroke("place"), count: 1 };
  stroke.maps.push({ id: 0, before, after, originalsAfter: { 5: { type: "pine", tiles: [] } } });
  return stroke;
}

const latest = (project: ReturnType<typeof gen5ImportProject>) => project.actionChangelog?.entries.at(-1)?.text;

describe("shared brush strokes", () => {
  it("writes, undoes and redoes a stroke's files and saved tiles", () => {
    const project = gen5ImportProject();
    const stroke = placeOne(project), maps = project.narcs.maps!;
    writeBrushStroke(project, KIND, stroke, false);
    expect(maps.rawFiles[0]).toEqual(stroke.maps[0]!.after);
    expect(maps.dirty.has(0)).toBe(true);
    expect(project.mapTreeOriginalPermissions).toEqual({ 0: { 5: { type: "pine", tiles: [] } } });
    expect(latest(project)).toBe("Placed 1 object.");

    undoBrushStroke(project, KIND, stroke);
    expect(maps.rawFiles[0]).toEqual(stroke.maps[0]!.before);
    // The chunk had no saved tiles before, so the field goes away.
    expect(project.mapTreeOriginalPermissions).toBeUndefined();
    expect(latest(project)).toBe("Undid an object edit (1 object).");

    redoBrushStroke(project, KIND, stroke);
    expect(maps.rawFiles[0]).toEqual(stroke.maps[0]!.after);
    expect(project.mapTreeOriginalPermissions?.[0]).toBe(stroke.maps[0]!.originalsAfter);
  });

  it("refuses to undo or redo over later changes", () => {
    const project = gen5ImportProject();
    const stroke = placeOne(project), maps = project.narcs.maps!;
    writeBrushStroke(project, KIND, stroke, false);
    maps.rawFiles[0] = maps.rawFiles[0]!.slice(1);
    expect(() => undoBrushStroke(project, KIND, stroke)).toThrow("Map resources changed after this object edit.");
    maps.rawFiles[0] = stroke.maps[0]!.after.slice();
    project.mapTreeOriginalPermissions = { 0: { 5: { type: "pine", tiles: [] } } };
    // Equal content is not enough: the saved tiles must be the stroke's own record.
    expect(() => undoBrushStroke(project, KIND, stroke)).toThrow("The saved object tiles changed after this object edit.");
    project.mapTreeOriginalPermissions = { 0: stroke.maps[0]!.originalsAfter! };
    undoBrushStroke(project, KIND, stroke);
    maps.rawFiles[0] = stroke.maps[0]!.after.slice();
    expect(() => redoBrushStroke(project, KIND, stroke)).toThrow("Map resources changed after this object edit was undone.");
  });

  it("leaves strokes that changed nothing alone", () => {
    const project = gen5ImportProject();
    const stroke: TestStroke = emptyBrushStroke("remove");
    undoBrushStroke(project, KIND, stroke);
    expect(project.actionChangelog?.entries.length ?? 0).toBe(0);
  });

  it("runs a brush's own checks and writes for state outside the NARCs", () => {
    const project = gen5ImportProject();
    const calls: string[] = [];
    let current = 0;
    const kind: BrushStrokeKind<TestStroke> = {
      ...KIND,
      changesAssets: () => true,
      extra: {
        what: "Map texture animations",
        matches: (_project, stroke, side) => current === (side === "before" ? 0 : stroke.extra),
        write: (_project, stroke, undo) => { current = undo ? 0 : stroke.extra!; calls.push(undo ? "undo" : "write"); },
      },
      afterWrite: () => calls.push("after"),
    };
    const stroke = { ...placeOne(project), extra: 7 };
    writeBrushStroke(project, kind, stroke, false);
    expect(current).toBe(7);
    current = 3;
    expect(() => undoBrushStroke(project, kind, stroke)).toThrow("Map texture animations changed after this object edit.");
    current = 7;
    undoBrushStroke(project, kind, stroke);
    expect(current).toBe(0);
    expect(calls).toEqual(["write", "after", "undo", "after"]);
  });

  it("groups skipped tiles by reason and season", () => {
    const { result, skip } = startBrushStroke<TestStroke>(emptyBrushStroke("place"));
    skip("water");
    skip("water");
    skip("water", "summer");
    skip("blocked");
    expect(result.skipped).toBe(4);
    expect(result.skipReasons).toEqual([{ reason: "water", count: 2 }, { reason: "water", count: 1, season: "summer" }, { reason: "blocked", count: 1 }]);
  });

  it("reads and writes collision tile records", () => {
    const bytes = new Uint8Array(8 + 8 * 4);
    writePermission(bytes, 2, { tileClass: 0x1234, flags: 0x81 });
    expect(permission(bytes, 2)).toEqual({ tileClass: 0x1234, flags: 0x81 });
    expect([...bytes.subarray(24, 28)]).toEqual([0x34, 0x12, 0x81, 0]);
  });
});
