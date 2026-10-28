import { readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { gen5ResolvedScriptOperands, gen5ScriptCommandSize, gen5ScriptEntries, type ScriptWalkOptions } from "./gen5ScriptCommands";
import { getHeaderPackedValue } from "./headerModel";
import { decodeRecord, type ProjectState } from "./projectStore";
import { getTrainerFieldConditions } from "./trainerFieldConditionsModel";
import { indirectTrainerContext, parseIndirectTrainerScripts, trainerMapEventContext } from "./trainerLocationModel";

export type CalcBattleWeather = "Clear" | "Rain" | "Sand" | "Hail" | "Sun";
type Weather = CalcBattleWeather | undefined;
type GlobalScript = { bytes: Uint8Array; entryIndex: number };

/** Native field-to-battle conversion: visual snow/fog is not battle weather. */
export function fieldBattleWeather(id: number): Weather {
  if (id === 2 || id === 6) return "Rain";
  if (id === 3 || id === 12) return "Sand";
  if (id === 4 || id === 5) return "Hail";
  return id >= 0 && id <= 14 ? "Clear" : undefined;
}

/** Follow weather through branches and returning helpers, observing it at the
 * battle command. Setters after a battle cannot change that battle's weather. */
export function parseTrainerBattleWeather(
  bytes: Uint8Array,
  initial: readonly Weather[],
  options: ScriptWalkOptions & { globalScript?: (id: number) => GlobalScript | undefined } = {},
): Map<number, Set<Weather>> {
  type Script = { bytes: Uint8Array; entries: number[]; values: Map<string, number[]> };
  const scripts: Script[] = [];
  const scriptIds = new Map<Uint8Array, number>();
  const prepare = (data: Uint8Array): number => {
    const found = scriptIds.get(data);
    if (found !== undefined) return found;
    const id = scripts.length;
    scriptIds.set(data, id);
    const values = new Map<string, number[]>();
    for (const operand of gen5ResolvedScriptOperands(data, "BW2", { 0x85: [2, 4], 0x86: [2, 4, 6], 0x94: [2, 4], 0x136: [2], 0x1c: [2] }, { overlayId: options.overlayId })) {
      const key = `${operand.offset}:${operand.operandOffset}`;
      values.set(key, [...new Set([...(values.get(key) ?? []), ...operand.values])]);
    }
    scripts.push({ bytes: data, entries: gen5ScriptEntries(data), values });
    return id;
  };
  const root = prepare(bytes), entries = scripts[root].entries;
  type Frame = { script: number; offset: number };
  type Path = Frame & { weather: Weather; returns: Frame[] };
  const starts = options.entryIndices ? options.entryIndices.map(i => entries[i]).filter(i => i !== undefined) : entries;
  const pending: Path[] = starts.flatMap(offset => initial.map(weather => ({ script: root, offset, weather, returns: [] })));
  const visited = new Set<string>(), result = new Map<number, Set<Weather>>();
  while (pending.length && visited.size < 100000) {
    const path = pending.pop()!;
    const key = `${path.script}:${path.offset}:${path.weather}:${path.returns.map(f => `${f.script}:${f.offset}`).join(",")}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const script = scripts[path.script], data = script.bytes, offset = path.offset;
    if (offset < script.entries.length * 4 + 2 || offset + 2 > data.length) continue;
    const command = readU16(data, offset), size = gen5ScriptCommandSize(command, "BW2", options.overlayId);
    if (!size || offset + size > data.length) continue;
    const next = offset + size;
    const enqueue = (changes: Partial<Path>) => pending.push({ ...path, ...changes });
    if ([0x85, 0x86, 0x94].includes(command)) {
      for (const operand of command === 0x86 ? [2, 4, 6] : [2, 4]) {
        for (const id of script.values.get(`${offset}:${operand}`) ?? []) {
          if (id <= 0 || id >= 0x4000) continue;
          if (!result.has(id)) result.set(id, new Set());
          result.get(id)!.add(path.weather);
        }
      }
    }
    if (command === 0x136) {
      const values = script.values.get(`${offset}:2`);
      for (const weather of values?.length ? values.map(fieldBattleWeather) : [undefined]) enqueue({ offset: next, weather });
    } else if (command === 0x05 || command === 0x1d) {
      const caller = path.returns.at(-1);
      if (caller) enqueue({ ...caller, returns: path.returns.slice(0, -1) });
    } else if (command === 0x02) {
      continue;
    } else if (command === 0x04 || command === 0x20) {
      if (path.returns.length < 32) enqueue({ offset: next + (readU32(data, next - 4) | 0), returns: [...path.returns, { script: path.script, offset: next }] });
      if (command === 0x20) enqueue({ offset: next });
    } else if (command === 0x1e || command === 0x1f) {
      enqueue({ offset: next + (readU32(data, next - 4) | 0) });
      if (command === 0x1f) enqueue({ offset: next });
    } else if (command === 0x1c) {
      const ids = script.values.get(`${offset}:2`) ?? [];
      let entered = false;
      if (path.returns.length < 32) for (const id of ids) {
        const target = options.globalScript?.(id);
        if (!target) continue;
        const scriptId = prepare(target.bytes), targetOffset = scripts[scriptId].entries[target.entryIndex];
        if (targetOffset === undefined) continue;
        enqueue({ script: scriptId, offset: targetOffset, returns: [...path.returns, { script: path.script, offset: next }] });
        entered = true;
      }
      if (!entered) enqueue({ offset: next });
    } else enqueue({ offset: next });
  }
  // A bounded analysis must never turn an unfinished path into certainty.
  if (pending.length) for (const weather of result.values()) weather.add(undefined);
  return result;
}

export function inferTrainerBattleWeather(project: ProjectState): Record<string, CalcBattleWeather> {
  if (project.session.baseRom !== "BW2" || !project.headers || !project.narcs.overworlds) return {};
  const context = indirectTrainerContext(project), mapEvents = trainerMapEventContext(project);
  const observed = new Map<number, Set<Weather>>();
  const add = (id: number, weather: Iterable<Weather>) => {
    if (id <= 0 || id >= (project.narcs.trdata?.fileCount ?? 0)) return;
    if (!observed.has(id)) observed.set(id, new Set());
    for (const value of weather) observed.get(id)!.add(value);
  };
  const calendar = trainerWeatherCalendar(project);
  const globalScript = (id: number): GlobalScript | undefined => {
    const range = context.field?.globals.find(range => id >= range.start && id <= range.end);
    const bytes = range && project.narcs.scripts?.rawFiles[range.fileId];
    return range && bytes ? { bytes, entryIndex: id - range.start } : undefined;
  };
  for (const row of Object.values(project.headers.rows)) {
    const overlayId = context.field?.zoneOverlays[row.index], events = mapEvents(row, overlayId);
    const weather = calendar.get(row.index) ?? [fieldBattleWeather(getHeaderPackedValue(row, "weather_camera") & 0x3f)];
    const raw = decodeRecord(project, "overworlds", Number(row.overworlds_id ?? row.map_id)).raw;
    if (!raw) continue;
    const bytes = project.narcs.scripts?.rawFiles[Number(row.script_id)];
    const local = bytes ? parseTrainerBattleWeather(bytes, weather, { overlayId, entryIndices: events.entryIndices, globalScript }) : new Map<number, Set<Weather>>();
    for (const [id, values] of local) add(id, values);
    if (bytes) for (const id of parseIndirectTrainerScripts(bytes, context, { overlayId, entryIndices: events.entryIndices })) if (!local.has(id)) add(id, weather);
    for (let npc = 0; npc < Number(raw.npc_count ?? 0); npc += 1) {
      if (!events.activeNpc(npc)) continue;
      const id = Number(raw[`npc_${npc}_script_id`]);
      if ((id > 3000 && id < 4000) || (id > 5000 && id < 6000)) add(id % 1000, weather);
      const target = globalScript(id);
      if (target) for (const [trainer, values] of parseTrainerBattleWeather(target.bytes, weather, { overlayId, entryIndices: [target.entryIndex], globalScript })) add(trainer, values);
    }
  }
  const result: Record<string, CalcBattleWeather> = {};
  for (let id = 0; id < (project.narcs.trdata?.fileCount ?? 0); id += 1) {
    const override = getTrainerFieldConditions(project, id).weather;
    const forced = ([undefined, "Clear", "Sun", "Rain", "Hail", "Sand"] as const)[override];
    const values = observed.get(id);
    const weather = forced ?? (values?.size === 1 ? [...values][0] : undefined);
    if (weather && weather !== "Clear") result[id] = weather;
  }
  return result;
}

function trainerWeatherCalendar(project: ProjectState): Map<number, Weather[]> {
  const result = new Map<number, Weather[]>(), source = project.trainerLocationTables?.weatherCalendar;
  if (!source) return result;
  try {
    const files = new NARC(project.fileSystem?.replacements?.[source.fileId] ?? source.bytes).files;
    const data = files[0], index = files[1];
    if (!data || !index || index.length < 2 || 2 + readU16(index, 0) * 4 > index.length) return result;
    for (let i = 0; i < readU16(index, 0); i += 1) {
      const zone = readU16(index, 2 + i * 4), offset = readU16(index, 4 + i * 4);
      if (offset + 366 > data.length) continue;
      result.set(zone, [...new Set(Array.from(data.subarray(offset, offset + 366), fieldBattleWeather))]);
    }
  } catch { /* Unknown calendar data cannot establish constant weather. */ }
  return result;
}
