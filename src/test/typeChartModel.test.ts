import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import type { ProjectState } from "../pokeweb/projectStore";
import type { NarcStore } from "../pokeweb/projectStore";
import {
  TYPE_CHART_FAIRY_FROST_OFFSET,
  TYPE_CHART_FAIRY_REDUX_OFFSET,
  TYPE_CHART_FAIRY_TYPE_COUNT,
  TYPE_CHART_OFFSET,
  TYPE_CHART_TYPES,
  detectFairyTypeUsage,
  getTypeChartTypes,
  getTypeChartValue,
  typeChartTableOffset,
  updateTypeChartValue,
} from "../pokeweb/typeChartModel";

describe("typeChartModel", () => {
  it("reads and updates the overlay-backed BW2 type chart", () => {
    const project = makeProject();
    project.overlays[167]![TYPE_CHART_OFFSET + 9 * TYPE_CHART_TYPES.length + 11] = 8;

    expect(getTypeChartValue(project, 9, 11)).toBe(8);
    updateTypeChartValue(project, 9, 11, 2);

    expect(project.narcs.type_chart?.rawFiles[0][9 * TYPE_CHART_TYPES.length + 11]).toBe(2);
    expect(project.narcs.type_chart?.dirty.has(0)).toBe(true);
  });

  it("uses the Frost/Pokeweb Fairy chart offset when Fairy typings are present", () => {
    const project = makeProject({ fairyTypeSource: "personal", chartOffset: TYPE_CHART_FAIRY_FROST_OFFSET });
    const overlay = project.overlays[167]!;
    overlay[TYPE_CHART_FAIRY_FROST_OFFSET + 17 * TYPE_CHART_FAIRY_TYPE_COUNT + 15] = 0;

    expect(detectFairyTypeUsage(project)).toBe(true);
    expect(getTypeChartTypes(project)).toContain("Fairy");
    expect(typeChartTableOffset(project, overlay)).toBe(TYPE_CHART_FAIRY_FROST_OFFSET);
    expect(getTypeChartValue(project, 17, 15)).toBe(0);

    updateTypeChartValue(project, 17, 15, 8);

    expect(project.narcs.type_chart?.rawFiles[0][17 * TYPE_CHART_FAIRY_TYPE_COUNT + 15]).toBe(8);
    expect(project.narcs.type_chart?.rawFiles[0]).toHaveLength(TYPE_CHART_FAIRY_TYPE_COUNT * TYPE_CHART_FAIRY_TYPE_COUNT);
  });

  it("uses the Redux-style Fairy chart at the start of overlay 167", () => {
    const project = makeProject({ fairyTypeSource: "moves", chartOffset: TYPE_CHART_FAIRY_REDUX_OFFSET });
    const overlay = project.overlays[167]!;

    expect(detectFairyTypeUsage(project)).toBe(true);
    expect(typeChartTableOffset(project, overlay)).toBe(TYPE_CHART_FAIRY_REDUX_OFFSET);
    expect(getTypeChartValue(project, 0, 0)).toBe(4);

    updateTypeChartValue(project, 0, 17, 2);

    expect(project.narcs.type_chart?.rawFiles[0][17]).toBe(2);
  });
});

function makeProject(options: { fairyTypeSource?: "personal" | "moves"; chartOffset?: number } = {}): ProjectState {
  const typeCount = options.chartOffset === undefined ? TYPE_CHART_TYPES.length : TYPE_CHART_FAIRY_TYPE_COUNT;
  const chartOffset = options.chartOffset ?? TYPE_CHART_OFFSET;
  const overlay = new Uint8Array(Math.max(TYPE_CHART_OFFSET + TYPE_CHART_TYPES.length * TYPE_CHART_TYPES.length + 16, chartOffset + typeCount * typeCount + 16));
  overlay.fill(4, chartOffset, chartOffset + typeCount * typeCount);
  overlay[chartOffset + 5] = 2;
  overlay[chartOffset + 7] = 0;
  overlay[chartOffset + typeCount] = 8;
  const personal = makeStore("personal", [new Uint8Array(8)]);
  const moves = makeStore("moves", [new Uint8Array(1)]);
  if (options.fairyTypeSource === "personal") personal.rawFiles[0][6] = 17;
  if (options.fairyTypeSource === "moves") moves.rawFiles[0][0] = 17;
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
    narcs: options.fairyTypeSource ? { personal, moves } : {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 0,
    sourcePath: name,
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}
