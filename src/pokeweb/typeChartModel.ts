import { recordFieldChange } from "./actionChangelog";
import { TYPES } from "./constants";
import type { NarcStore, ProjectState } from "./projectStore";

export const TYPE_CHART_OVERLAY_ID = 167;
export const TYPE_CHART_OFFSET = 0x0003dc40;
export const TYPE_CHART_FAIRY_FROST_OFFSET = 0x00001740;
export const TYPE_CHART_FAIRY_REDUX_OFFSET = 0x00000000;
export const TYPE_CHART_VANILLA_TYPE_COUNT = 17;
export const TYPE_CHART_FAIRY_TYPE_COUNT = 18;
export const TYPE_CHART_ROMFS_PATH = "type_chart.bin";
export const BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH = "data/black2upgrade/type_chart.bin";
export const TYPE_CHART_TYPES = TYPES.slice(0, TYPE_CHART_VANILLA_TYPE_COUNT);
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
  const existing = project.narcs.type_chart;
  const overlay = project.overlays[TYPE_CHART_OVERLAY_ID];
  if (existing) {
    const expectedLength = typeChartTableLength(project);
    if (isRomFsTypeChartStore(existing)) {
      if ((existing.rawFiles[0]?.length ?? 0) >= expectedLength) return;
      throw new Error("Type chart file data is not loaded. Reload the ROM before editing the type chart.");
    }
    if ((existing.rawFiles[0]?.length ?? 0) === expectedLength) return;
    if (!overlay) return;
    const offset = typeChartTableOffset(project, overlay);
    existing.sourcePath = typeChartSourcePath(offset);
    existing.rawFiles = [overlay.slice(offset, offset + expectedLength)];
    existing.records = new Map();
    existing.dirty = new Set();
    return;
  }
  if (!overlay) throw new Error("Type chart overlay data is not loaded. Load the Moves NARC or reload the ROM with Moves selected.");
  project.narcs.type_chart = createTypeChartStore(project, overlay);
}

export function createRomFsTypeChartStore(fileId: number, bytes: Uint8Array, sourcePath = TYPE_CHART_ROMFS_PATH): NarcStore {
  if (!isPlausibleRomFsTypeChart(bytes)) throw new Error(`Could not locate an 18x18 Fairy type chart in ${sourcePath}.`);
  return {
    name: "type_chart",
    fileId,
    sourcePath,
    fileCount: 1,
    rawFiles: [bytes.slice()],
    records: new Map(),
    dirty: new Set(),
  };
}

export function createTypeChartStore(project: ProjectState, overlay: Uint8Array): NarcStore {
  const offset = typeChartTableOffset(project, overlay);
  const length = typeChartTableLength(project);
  return {
    name: "type_chart",
    fileId: -1,
    sourcePath: typeChartSourcePath(offset),
    fileCount: 1,
    rawFiles: [overlay.slice(offset, offset + length)],
    records: new Map(),
    dirty: new Set(),
  };
}

export function getTypeChart(project: ProjectState): TypeChartCell[] {
  ensureTypeChartStore(project);
  const types = getTypeChartTypes(project);
  const bytes = project.narcs.type_chart?.rawFiles[0] ?? new Uint8Array();
  const cells: TypeChartCell[] = [];
  types.forEach((attackType, attackIndex) => {
    types.forEach((defendType, defendIndex) => {
      const value = normalizeEffectiveness(bytes[typeChartOffset(attackIndex, defendIndex, types.length)] ?? 4);
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
  const typeCount = getTypeChartTypes(project).length;
  const bytes = project.narcs.type_chart?.rawFiles[0] ?? new Uint8Array();
  return normalizeEffectiveness(bytes[typeChartOffset(attackIndex, defendIndex, typeCount)] ?? 4);
}

export function updateTypeChartValue(project: ProjectState, attackIndex: number, defendIndex: number, value: TypeEffectivenessValue): void {
  ensureTypeChartStore(project);
  const types = getTypeChartTypes(project);
  if (!TYPE_EFFECTIVENESS_VALUES.includes(value)) throw new Error(`Unsupported type effectiveness value: ${value}`);
  if (!Number.isInteger(attackIndex) || attackIndex < 0 || attackIndex >= types.length) throw new Error(`Attack type index out of range: ${attackIndex}`);
  if (!Number.isInteger(defendIndex) || defendIndex < 0 || defendIndex >= types.length) throw new Error(`Defend type index out of range: ${defendIndex}`);
  const store = project.narcs.type_chart;
  if (!store) return;
  const bytes = store.rawFiles[0]?.slice() ?? new Uint8Array(types.length * types.length);
  const offset = typeChartOffset(attackIndex, defendIndex, types.length);
  const before = normalizeEffectiveness(bytes[offset] ?? 4);
  bytes[offset] = value;
  store.rawFiles[0] = bytes;
  recordFieldChange(project, "type_chart", "Type Chart", `${types[attackIndex]} vs ${types[defendIndex]}`, effectivenessLabel(before), effectivenessLabel(value), {
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

export function getTypeChartTypes(project: ProjectState): string[] {
  return TYPES.slice(0, typeChartTypeCount(project));
}

export function typeChartTypeCount(project: ProjectState): number {
  const store = project.narcs.type_chart;
  const storeLength = store?.rawFiles[0]?.length ?? 0;
  if (isRomFsTypeChartStore(store) && storeLength >= TYPE_CHART_FAIRY_TYPE_COUNT * TYPE_CHART_FAIRY_TYPE_COUNT) return TYPE_CHART_FAIRY_TYPE_COUNT;
  if (project.session.fairy || detectFairyTypeUsage(project)) return TYPE_CHART_FAIRY_TYPE_COUNT;
  if (storeLength >= TYPE_CHART_FAIRY_TYPE_COUNT * TYPE_CHART_FAIRY_TYPE_COUNT) return TYPE_CHART_FAIRY_TYPE_COUNT;
  return TYPE_CHART_VANILLA_TYPE_COUNT;
}

export function typeChartTableLength(project: ProjectState): number {
  const typeCount = typeChartTypeCount(project);
  return typeCount * typeCount;
}

export function typeChartTableOffset(project: ProjectState, overlay?: Uint8Array): number {
  if (typeChartTypeCount(project) <= TYPE_CHART_VANILLA_TYPE_COUNT) return TYPE_CHART_OFFSET;
  if (overlay) {
    const detected = detectFairyTypeChartOffset(overlay);
    if (detected !== undefined) return detected;
    throw new Error("Could not locate an 18x18 Fairy type chart in overlay 167.");
  }
  return TYPE_CHART_FAIRY_FROST_OFFSET;
}

export function detectFairyTypeUsage(project: ProjectState): boolean {
  const fairyTypeId = TYPES.indexOf("Fairy");
  if (fairyTypeId < 0) return false;

  const personal = project.narcs.personal;
  if (personal?.rawFiles.some((file) => file.length > 7 && (file[6] === fairyTypeId || file[7] === fairyTypeId))) return true;

  const moves = project.narcs.moves;
  return moves?.rawFiles.some((file) => file.length > 0 && file[0] === fairyTypeId) ?? false;
}

export function detectFairyTypeChartOffset(overlay: Uint8Array): number | undefined {
  for (const offset of [TYPE_CHART_FAIRY_FROST_OFFSET, TYPE_CHART_FAIRY_REDUX_OFFSET]) {
    if (isPlausibleTypeChartAt(overlay, offset, TYPE_CHART_FAIRY_TYPE_COUNT)) return offset;
  }
  return findPlausibleFairyTypeChartOffset(overlay);
}

export function isRomFsTypeChartStore(store: NarcStore | undefined): boolean {
  return store?.name === "type_chart" &&
    (store.sourcePath === TYPE_CHART_ROMFS_PATH || store.sourcePath === BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH);
}

function typeChartOffset(attackIndex: number, defendIndex: number, typeCount: number): number {
  return attackIndex * typeCount + defendIndex;
}

function normalizeEffectiveness(value: number): TypeEffectivenessValue {
  if (value === 0 || value === 2 || value === 8) return value;
  return 4;
}

function typeChartSourcePath(offset: number): string {
  return `overlay${TYPE_CHART_OVERLAY_ID}:type_chart@0x${offset.toString(16)}`;
}

function isPlausibleTypeChartAt(overlay: Uint8Array, offset: number, typeCount: number): boolean {
  const length = typeCount * typeCount;
  if (offset < 0 || offset + length > overlay.length) return false;
  let hasNotEffective = false;
  let hasNotVeryEffective = false;
  let hasEffective = false;
  let hasSuperEffective = false;
  for (let i = 0; i < length; i += 1) {
    const value = overlay[offset + i] ?? -1;
    if (!isEffectivenessByte(value)) return false;
    if (value === 0) hasNotEffective = true;
    else if (value === 2) hasNotVeryEffective = true;
    else if (value === 4) hasEffective = true;
    else if (value === 8) hasSuperEffective = true;
  }
  return hasEffective && hasNotEffective && hasNotVeryEffective && hasSuperEffective;
}

function isPlausibleRomFsTypeChart(bytes: Uint8Array): boolean {
  const length = TYPE_CHART_FAIRY_TYPE_COUNT * TYPE_CHART_FAIRY_TYPE_COUNT;
  if (bytes.length < length) return false;
  for (let i = 0; i < length; i += 1) {
    if (!isEffectivenessByte(bytes[i] ?? -1)) return false;
  }
  return true;
}

function findPlausibleFairyTypeChartOffset(overlay: Uint8Array): number | undefined {
  const length = TYPE_CHART_FAIRY_TYPE_COUNT * TYPE_CHART_FAIRY_TYPE_COUNT;
  const expectedCounts = new Map<TypeEffectivenessValue, number>([
    [0, 8],
    [2, 61],
    [4, 204],
    [8, 51],
  ]);
  let best: { offset: number; penalty: number } | undefined;

  for (let runStart = -1, offset = 0; offset <= overlay.length; offset += 1) {
    const inRun = offset < overlay.length && isEffectivenessByte(overlay[offset] ?? -1);
    if (inRun && runStart < 0) runStart = offset;
    if (inRun) continue;
    if (runStart >= 0 && offset - runStart >= length) {
      for (let candidate = runStart; candidate + length <= offset; candidate += 1) {
        const penalty = typeChartCountPenalty(overlay, candidate, expectedCounts);
        if (penalty <= 64 && (!best || penalty < best.penalty)) best = { offset: candidate, penalty };
      }
    }
    runStart = -1;
  }

  return best?.offset;
}

function typeChartCountPenalty(overlay: Uint8Array, offset: number, expectedCounts: Map<TypeEffectivenessValue, number>): number {
  const length = TYPE_CHART_FAIRY_TYPE_COUNT * TYPE_CHART_FAIRY_TYPE_COUNT;
  const counts = new Map<TypeEffectivenessValue, number>([
    [0, 0],
    [2, 0],
    [4, 0],
    [8, 0],
  ]);
  for (let i = 0; i < length; i += 1) {
    const value = overlay[offset + i] as TypeEffectivenessValue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let penalty = 0;
  for (const value of TYPE_EFFECTIVENESS_VALUES) {
    penalty += Math.abs((counts.get(value) ?? 0) - (expectedCounts.get(value) ?? 0));
  }
  return penalty;
}

function isEffectivenessByte(value: number): value is TypeEffectivenessValue {
  return value === 0 || value === 2 || value === 4 || value === 8;
}
