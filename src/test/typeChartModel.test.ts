import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { TYPE_CHART_OFFSET, TYPE_CHART_TYPES, getTypeChartValue, updateTypeChartValue } from "../pokeweb/typeChartModel";

describe("typeChartModel", () => {
  it("reads and updates the overlay-backed BW2 type chart", () => {
    const project = makeProject();
    project.overlays[167]![TYPE_CHART_OFFSET + 9 * TYPE_CHART_TYPES.length + 11] = 8;

    expect(getTypeChartValue(project, 9, 11)).toBe(8);
    updateTypeChartValue(project, 9, 11, 2);

    expect(project.narcs.type_chart?.rawFiles[0][9 * TYPE_CHART_TYPES.length + 11]).toBe(2);
    expect(project.narcs.type_chart?.dirty.has(0)).toBe(true);
  });
});

function makeProject(): ProjectState {
  const overlay = new Uint8Array(TYPE_CHART_OFFSET + TYPE_CHART_TYPES.length * TYPE_CHART_TYPES.length + 16);
  overlay.fill(4, TYPE_CHART_OFFSET, TYPE_CHART_OFFSET + TYPE_CHART_TYPES.length * TYPE_CHART_TYPES.length);
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: overlay.length },
    arm9: new Uint8Array(),
    overlays: { 167: overlay },
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}
