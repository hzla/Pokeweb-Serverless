import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { overworldZoneScriptFile, resolveScriptId } from "../pokeweb/scriptIdModel";

const project = (baseRom: "BW" | "BW2", rows: Record<number, Record<string, unknown>> = {}) =>
  ({ session: { baseRom }, headers: { count: Object.keys(rows).length, rows } }) as unknown as ProjectState;

describe("script IDs", () => {
  it("resolves global ranges to their file and entry", () => {
    const bw2 = project("BW2");
    expect(resolveScriptId(bw2, 3012, 400)).toEqual({ fileId: 1239, entry: 13, kind: "global" });
    expect(resolveScriptId(bw2, 5012, 400)).toEqual({ fileId: 1239, entry: 13, kind: "global" });
    expect(resolveScriptId(bw2, 7000, 400)).toEqual({ fileId: 1240, entry: 1, kind: "global" });
    expect(resolveScriptId(bw2, 2000, 400)).toEqual({ fileId: 1230, entry: 1, kind: "global" });
    expect(resolveScriptId(project("BW"), 7000, 400)).toEqual({ fileId: 864, entry: 1, kind: "global" });
  });

  it("resolves map scripts to the zone's script file", () => {
    expect(resolveScriptId(project("BW2"), 3, 412)).toEqual({ fileId: 412, entry: 3, kind: "zone" });
    expect(resolveScriptId(project("BW2"), 3, undefined)).toBeUndefined();
    expect(resolveScriptId(project("BW2"), 0, 412)).toBeUndefined();
    // Between ranges the game has no script.
    expect(resolveScriptId(project("BW2"), 2900, 412)).toBeUndefined();
  });

  it("finds an overworld's zone script file, preferring the header it was opened from", () => {
    const rows = { 1: { overworlds_id: 5, script_id: 100 }, 2: { overworlds_id: 5, script_id: 101 }, 3: { overworlds_id: 6, script_id: 102 } };
    expect(overworldZoneScriptFile(project("BW2", rows), 5)).toBe(100);
    expect(overworldZoneScriptFile(project("BW2", rows), 5, 2)).toBe(101);
    expect(overworldZoneScriptFile(project("BW2", rows), 5, 3)).toBe(100);
    expect(overworldZoneScriptFile(project("BW2", rows), 9)).toBeUndefined();
  });
});
