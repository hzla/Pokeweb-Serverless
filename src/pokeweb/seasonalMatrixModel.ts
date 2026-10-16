import { readU16, writeU16 } from "../nds/binary";
import { isGen5Project, type BaseRom } from "./constants";
import { recordGenericChange } from "./actionChangelog";
import { getMatrixSnapshot, type MatrixSnapshot } from "./matrixModel";
import { markDirty, type ProjectState, type RawRecord } from "./projectStore";

export const MAP_REPLACE_PATH = "a/0/1/0";
export const MATRIX_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type MatrixSeason = typeof MATRIX_SEASONS[number];
export type SeasonalScope = "map" | "matrix";
export function seasonalAreaId(baseRom: BaseRom, areaId: number, season: MatrixSeason): number {
  const seasonal = baseRom === "BW2" ? areaId >= 2 && areaId < 282 : areaId >= 2 && areaId < 210;
  return seasonal ? areaId + MATRIX_SEASONS.indexOf(season) : areaId;
}
export type MapReplacementRule = { matrixId: number; patchType: number; condition: number; values: number[] };
const ENTRY_SIZE = 16;
// The native reader derives its count from a 16-bit member size.
const MAX_TABLE_BYTES = 0xfff0;

export function parseMapReplacementFile(bytes: Uint8Array): RawRecord {
  if (bytes.length % ENTRY_SIZE || bytes.length > MAX_TABLE_BYTES) throw new Error("Malformed map replacement table: expected complete 16-byte entries within 65520 bytes.");
  const raw: RawRecord = { entry_count: bytes.length / ENTRY_SIZE };
  for (let i = 0; i < raw.entry_count; i++) {
    const offset = i * ENTRY_SIZE;
    raw[`matrix_${i}`] = readU16(bytes, offset); raw[`type_${i}`] = bytes[offset + 2]; raw[`condition_${i}`] = bytes[offset + 3];
    for (let slot = 0; slot < 6; slot++) raw[`value_${i}_${slot}`] = readU16(bytes, offset + 4 + slot * 2);
  }
  return raw;
}
export function materializeMapReplacementFile(raw: RawRecord): Uint8Array {
  if (!Number.isInteger(raw.entry_count) || raw.entry_count < 0 || raw.entry_count * ENTRY_SIZE > MAX_TABLE_BYTES) throw new Error("Map replacement table exceeds its native size limit.");
  const out = new Uint8Array(raw.entry_count * ENTRY_SIZE);
  const value = (key: string, max: number) => {
    const n = raw[key]; if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`Invalid map replacement field ${key}.`); return n;
  };
  for (let i = 0; i < raw.entry_count; i++) {
    const offset = i * ENTRY_SIZE;
    writeU16(out, offset, value(`matrix_${i}`, 65535)); out[offset + 2] = value(`type_${i}`, 255); out[offset + 3] = value(`condition_${i}`, 255);
    for (let slot = 0; slot < 6; slot++) writeU16(out, offset + 4 + slot * 2, value(`value_${i}_${slot}`, 65535));
  }
  return out;
}
export function replacementRules(bytes: Uint8Array): MapReplacementRule[] {
  const raw = parseMapReplacementFile(bytes);
  return Array.from({ length: raw.entry_count }, (_, i) => ({ matrixId: raw[`matrix_${i}`], patchType: raw[`type_${i}`], condition: raw[`condition_${i}`],
    values: Array.from({ length: 6 }, (_, slot) => raw[`value_${i}_${slot}`]) }));
}
function rulesRaw(rules: MapReplacementRule[]): RawRecord {
  const raw: RawRecord = { entry_count: rules.length };
  rules.forEach((rule, i) => {
    raw[`matrix_${i}`] = rule.matrixId; raw[`type_${i}`] = rule.patchType; raw[`condition_${i}`] = rule.condition;
    rule.values.forEach((value, slot) => { raw[`value_${i}_${slot}`] = value; });
  }); return raw;
}
export function getMapReplacementBytes(project: ProjectState, fallback?: Uint8Array): Uint8Array {
  const store = project.narcs.map_replace, raw = store?.records.get(0)?.raw;
  if (raw) return materializeMapReplacementFile(raw);
  const bytes = store?.rawFiles[0];
  if (bytes?.length || (bytes && store?.dirty.has(0))) return bytes;
  if (fallback) return fallback;
  if (store?.parseError) throw new Error(store.parseError);
  if (bytes) return bytes;
  throw new Error("Seasonal replacement data is not loaded. Reconnect the source ROM.");
}
export function getSeasonalAssignment(project: ProjectState, matrixId: number, scope: SeasonalScope, mapId?: number) {
  const snapshot = getMatrixSnapshot(project, matrixId), sourceId = scope === "matrix" ? matrixId : mapId;
  if (sourceId === undefined || sourceId === 0xffffffff) throw new Error("Select a populated map cell.");
  const rules = replacementRules(getMapReplacementBytes(project));
  const matches = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => matchesRule(rule, matrixId, scope, sourceId));
  return { sourceId, rules, matches, values: matches[0]?.rule.values.slice(0, 4) ?? [sourceId, sourceId, sourceId, sourceId],
    affected: snapshot.cells.filter(cell => scope === "matrix" || cell.mapId === sourceId).map(cell => cell.index) };
}
function matchesRule(rule: MapReplacementRule, matrixId: number, scope: SeasonalScope, sourceId: number): boolean {
  return rule.condition === 0 && rule.patchType === (scope === "matrix" ? 1 : 0) && rule.matrixId === matrixId
    && (scope === "matrix" || rule.values[0] === sourceId);
}
export function seasonalAssignmentDraft(project: ProjectState, matrixId: number, scope: SeasonalScope, mapId: number | undefined, values: readonly number[]): MapReplacementRule[] {
  if (!isGen5Project(project)) throw new Error("Seasonal matrix editing is Gen 5 only.");
  const state = getSeasonalAssignment(project, matrixId, scope, mapId);
  if (!getMatrixSnapshot(project, matrixId).editable) throw new Error("This matrix exceeds the 900-cell editor limit.");
  if (values.length !== 4 || values[0] !== state.sourceId) throw new Error("Spring is the base assignment and cannot be changed by a seasonal rule.");
  for (let i = 0; i < 4; i++) {
    const id = values[i];
    if (!Number.isSafeInteger(id) || id < 0 || id >= 65535) throw new Error("Seasonal IDs must be whole numbers from 0 to 65534.");
    // Preserve existing invalid references for inspection, but never introduce one.
    if (state.matches.length && state.matches.every(({ rule }) => rule.values[i] === id)) continue;
    if (scope === "matrix") getMatrixSnapshot(project, id);
    else if (!project.narcs.maps?.rawFiles[id]?.length) throw new Error(`Map ${id} does not exist.`);
  }
  if (state.sourceId >= 65535) throw new Error("Base ID exceeds the seasonal table's 16-bit ID range.");
  if (!state.matches.length && values.every(id => id === state.sourceId)) return state.rules;
  const next = state.rules.map(rule => ({ ...rule, values: rule.values.slice() }));
  if (state.matches.length) for (const { index } of state.matches) next[index].values.splice(0, 4, ...values);
  else next.push({ matrixId, patchType: scope === "matrix" ? 1 : 0, condition: 0, values: [...values, 0, 65535] });
  materializeMapReplacementFile(rulesRaw(next));
  return next;
}
export function setSeasonalAssignment(project: ProjectState, matrixId: number, scope: SeasonalScope, mapId: number | undefined, values: readonly number[]): boolean {
  return commit(project, seasonalAssignmentDraft(project, matrixId, scope, mapId, values), `Updated seasonal ${scope} assignments for matrix ${matrixId}${scope === "map" ? `, map ${mapId}` : ""}.`);
}
export function clearSeasonalAssignment(project: ProjectState, matrixId: number, scope: SeasonalScope, mapId?: number): boolean {
  const state = getSeasonalAssignment(project, matrixId, scope, mapId);
  if (!getMatrixSnapshot(project, matrixId).editable) throw new Error("This matrix exceeds the 900-cell editor limit.");
  if (!state.matches.length) return false;
  return commit(project, state.rules.filter(rule => !matchesRule(rule, matrixId, scope, state.sourceId)), `Removed seasonal ${scope} assignments for matrix ${matrixId}.`);
}
function commit(project: ProjectState, rules: MapReplacementRule[], text: string): boolean {
  const store = project.narcs.map_replace;
  if (!store) throw new Error("Seasonal replacement data is not loaded.");
  const raw = rulesRaw(rules), bytes = materializeMapReplacementFile(raw), previous = getMapReplacementBytes(project);
  if (bytes.length === previous.length && bytes.every((value, i) => value === previous[i])) return false;
  store.rawFiles[0] = bytes; store.records.set(0, { id: 0, bytes, raw, readable: { ...raw, index: 0 } });
  markDirty(project, "map_replace", 0);
  recordGenericChange(project, "matrix", text, "Seasonal assignments", { key: `matrix-seasons:${rules.length}` });
  return true;
}
/** Apply seasonal entries in stored order, including cascades and whole-matrix loads. */
export function resolveSeasonalMatrix(project: ProjectState, matrixId: number, season: MatrixSeason, fallback?: Uint8Array, draft?: MapReplacementRule[]): MatrixSnapshot {
  let snapshot = getMatrixSnapshot(project, matrixId);
  snapshot = { ...snapshot, cells: snapshot.cells.map(cell => ({ ...cell })) };
  const slot = MATRIX_SEASONS.indexOf(season);
  for (const rule of draft ?? replacementRules(getMapReplacementBytes(project, fallback))) {
    if (rule.condition !== 0 || rule.matrixId !== snapshot.id || rule.values[0] === rule.values[slot]) continue;
    if (rule.patchType === 1) {
      const next = getMatrixSnapshot(project, rule.values[slot]); snapshot = { ...next, cells: next.cells.map(cell => ({ ...cell })) };
    } else if (rule.patchType === 0) for (const cell of snapshot.cells) if (cell.mapId === rule.values[0]) cell.mapId = rule.values[slot];
  }
  return snapshot;
}
