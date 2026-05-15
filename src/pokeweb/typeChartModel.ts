import { recordFieldChange } from "./actionChangelog";
import { TYPES } from "./constants";
import type { ProjectState } from "./projectStore";

export const TYPE_CHART_OVERLAY_ID = 167;
export const TYPE_CHART_OFFSET = 0x0003dc40;
export const TYPE_CHART_TYPES = TYPES.slice(0, 17);
export const TYPE_EFFECTIVENESS_VALUES = [0, 2, 4, 8] as const;

export type TypeEffectivenessValue = (typeof TYPE_EFFECTIVENESS_VALUES)[number];

export type TypeChartCell = {
  attackType: string;
  defendType: string;
  attackIndex: number;
  defendIndex: number;
  value: TypeEffectivenessValue;
  label: string;
};

export function ensureTypeChartStore(project: ProjectState): void {
  if (project.narcs.type_chart) return;
  const overlay = project.overlays[TYPE_CHART_OVERLAY_ID];
  if (!overlay) throw new Error("Type chart overlay data is not loaded. Load the Moves NARC or reload the ROM with Moves selected.");
  project.narcs.type_chart = {
    name: "type_chart",
    fileId: -1,
    sourcePath: "overlay167:type_chart",
    fileCount: 1,
    rawFiles: [overlay.slice(TYPE_CHART_OFFSET, TYPE_CHART_OFFSET + TYPE_CHART_TYPES.length * TYPE_CHART_TYPES.length)],
    records: new Map(),
    dirty: new Set(),
  };
}

export function getTypeChart(project: ProjectState): TypeChartCell[] {
  ensureTypeChartStore(project);
  const bytes = project.narcs.type_chart?.rawFiles[0] ?? new Uint8Array();
  const cells: TypeChartCell[] = [];
  TYPE_CHART_TYPES.forEach((attackType, attackIndex) => {
    TYPE_CHART_TYPES.forEach((defendType, defendIndex) => {
      const value = normalizeEffectiveness(bytes[typeChartOffset(attackIndex, defendIndex)] ?? 4);
      cells.push({
        attackType,
        defendType,
        attackIndex,
        defendIndex,
        value,
        label: effectivenessLabel(value),
      });
    });
  });
  return cells;
}

export function getTypeChartValue(project: ProjectState, attackIndex: number, defendIndex: number): TypeEffectivenessValue {
  ensureTypeChartStore(project);
  const bytes = project.narcs.type_chart?.rawFiles[0] ?? new Uint8Array();
  return normalizeEffectiveness(bytes[typeChartOffset(attackIndex, defendIndex)] ?? 4);
}

export function updateTypeChartValue(project: ProjectState, attackIndex: number, defendIndex: number, value: TypeEffectivenessValue): void {
  ensureTypeChartStore(project);
  if (!TYPE_EFFECTIVENESS_VALUES.includes(value)) throw new Error(`Unsupported type effectiveness value: ${value}`);
  if (!Number.isInteger(attackIndex) || attackIndex < 0 || attackIndex >= TYPE_CHART_TYPES.length) throw new Error(`Attack type index out of range: ${attackIndex}`);
  if (!Number.isInteger(defendIndex) || defendIndex < 0 || defendIndex >= TYPE_CHART_TYPES.length) throw new Error(`Defend type index out of range: ${defendIndex}`);
  const store = project.narcs.type_chart;
  if (!store) return;
  const bytes = store.rawFiles[0]?.slice() ?? new Uint8Array(TYPE_CHART_TYPES.length * TYPE_CHART_TYPES.length);
  const offset = typeChartOffset(attackIndex, defendIndex);
  const before = normalizeEffectiveness(bytes[offset] ?? 4);
  bytes[offset] = value;
  store.rawFiles[0] = bytes;
  recordFieldChange(project, "type_chart", "Type Chart", `${TYPE_CHART_TYPES[attackIndex]} vs ${TYPE_CHART_TYPES[defendIndex]}`, effectivenessLabel(before), effectivenessLabel(value), {
    key: `type-chart:${attackIndex}:${defendIndex}`,
  });
  store.dirty.add(0);
}

export function effectivenessLabel(value: TypeEffectivenessValue): string {
  if (value === 0) return "0x";
  if (value === 2) return "0.5x";
  if (value === 8) return "2x";
  return "1x";
}

function typeChartOffset(attackIndex: number, defendIndex: number): number {
  return attackIndex * TYPE_CHART_TYPES.length + defendIndex;
}

function normalizeEffectiveness(value: number): TypeEffectivenessValue {
  if (value === 0 || value === 2 || value === 8) return value;
  return 4;
}
