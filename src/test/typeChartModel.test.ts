import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import type { ProjectState } from "../pokeweb/projectStore";
import type { NarcStore } from "../pokeweb/projectStore";
import {
  BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH,
  BW_TYPE_CHART_FAIRY_FROST_OFFSET,
  BW_TYPE_CHART_OFFSET,
  BW_TYPE_CHART_OVERLAY_ID,
  TYPE_CHART_FAIRY_FROST_OFFSET,
  TYPE_CHART_FAIRY_REDUX_OFFSET,
  TYPE_CHART_FAIRY_TYPE_COUNT,
  TYPE_CHART_OFFSET,
  TYPE_CHART_ROMFS_PATH,
  TYPE_CHART_TYPES,
  createRomFsTypeChartStore,
  detectFairyTypeUsage,
  getTypeChartTypes,
  getTypeChartValue,
  typeChartOverlayId,
  typeChartTableOffset,
  updateTypeChartValue,
} from "../pokeweb/typeChartModel";

describe("typeChartModel", () => {
  it("reads and updates the overlay-backed vanilla BW1 type chart", () => {
    const project = makeProject({ baseRom: "BW" });
    const overlay = project.overlays[BW_TYPE_CHART_OVERLAY_ID]!;
    overlay[BW_TYPE_CHART_OFFSET + 9 * TYPE_CHART_TYPES.length + 11] = 8;

    expect(typeChartOverlayId(project)).toBe(BW_TYPE_CHART_OVERLAY_ID);
    expect(typeChartTableOffset(project, overlay)).toBe(BW_TYPE_CHART_OFFSET);
    expect(getTypeChartValue(project, 9, 11)).toBe(8);

    updateTypeChartValue(project, 9, 11, 2);

    expect(project.narcs.type_chart?.sourcePath).toBe("overlay93:type_chart@0x3a37c");
    expect(project.narcs.type_chart?.rawFiles[0][9 * TYPE_CHART_TYPES.length + 11]).toBe(2);
    expect(project.narcs.type_chart?.dirty.has(0)).toBe(true);
  });

  it("detects and updates Frost's 18-type Black 1 chart", () => {
    const project = makeProject({ baseRom: "BW", chartOffset: BW_TYPE_CHART_FAIRY_FROST_OFFSET });
    const overlay = project.overlays[BW_TYPE_CHART_OVERLAY_ID]!;
    overlay[BW_TYPE_CHART_FAIRY_FROST_OFFSET + 17 * TYPE_CHART_FAIRY_TYPE_COUNT + 15] = 0;

    expect(project.session.fairy).toBe(false);
    expect(getTypeChartValue(project, 17, 15)).toBe(0);
    expect(project.session.fairy).toBe(true);
    expect(getTypeChartTypes(project)).toContain("Fairy");
    expect(typeChartTableOffset(project, overlay)).toBe(BW_TYPE_CHART_FAIRY_FROST_OFFSET);

    updateTypeChartValue(project, 17, 15, 8);

    expect(project.narcs.type_chart?.sourcePath).toBe("overlay93:type_chart@0x1f80");
    expect(project.narcs.type_chart?.rawFiles[0][17 * TYPE_CHART_FAIRY_TYPE_COUNT + 15]).toBe(8);
  });

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

  it("reads and updates White2Upgrade standalone Fairy type chart files", () => {
    const project = makeProject();
    const chart = makeTypeChartBytes(TYPE_CHART_FAIRY_TYPE_COUNT);
    project.overlays = {};
    project.narcs.type_chart = createRomFsTypeChartStore(12, chart);

    expect(project.narcs.type_chart.sourcePath).toBe(TYPE_CHART_ROMFS_PATH);
    expect(getTypeChartTypes(project)).toContain("Fairy");
    expect(getTypeChartValue(project, 17, 15)).toBe(4);

    updateTypeChartValue(project, 17, 15, 8);

    expect(project.narcs.type_chart.rawFiles[0][17 * TYPE_CHART_FAIRY_TYPE_COUNT + 15]).toBe(8);
    expect(project.narcs.type_chart.dirty.has(0)).toBe(true);
  });

  it("recognizes the nested Black2Upgrade standalone Fairy type chart", () => {
    const project = makeProject();
    const chart = makeTypeChartBytes(TYPE_CHART_FAIRY_TYPE_COUNT);
    project.overlays = {};
    project.narcs.type_chart = createRomFsTypeChartStore(12, chart, BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH);

    expect(project.narcs.type_chart.sourcePath).toBe(BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH);
    expect(getTypeChartTypes(project)).toContain("Fairy");
  });
});

function makeProject(options: { baseRom?: "BW" | "BW2"; fairyTypeSource?: "personal" | "moves"; chartOffset?: number } = {}): ProjectState {
  const baseRom = options.baseRom ?? "BW2";
  const typeCount = options.chartOffset === undefined ? TYPE_CHART_TYPES.length : TYPE_CHART_FAIRY_TYPE_COUNT;
  const defaultChartOffset = baseRom === "BW" ? BW_TYPE_CHART_OFFSET : TYPE_CHART_OFFSET;
  const chartOffset = options.chartOffset ?? defaultChartOffset;
  const overlay = new Uint8Array(Math.max(defaultChartOffset + TYPE_CHART_TYPES.length * TYPE_CHART_TYPES.length + 16, chartOffset + typeCount * typeCount + 16));
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
      baseVersion: baseRom === "BW" ? "B" : "W2",
      baseRom,
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: overlay.length },
    arm9: new Uint8Array(),
    overlays: { [baseRom === "BW" ? BW_TYPE_CHART_OVERLAY_ID : 167]: overlay },
    narcs: options.fairyTypeSource ? { personal, moves } : {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeTypeChartBytes(typeCount: number): Uint8Array {
  const chart = new Uint8Array(typeCount * typeCount);
  chart.fill(4);
  chart[5] = 2;
  chart[7] = 0;
  chart[typeCount] = 8;
  return chart;
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
