import { readU16, readU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { gen5ResolvedScriptOperands, gen5ScriptCommandOffsets, gen5ScriptEntries, type ScriptWalkOptions } from "./gen5ScriptCommands";
import { parseGen5MatrixFile } from "./gen5MatrixModel";
import type { HeaderRow } from "./headerModel";
import { decodeRecord, type RawRecord } from "./projectStore";
import type { ProjectState } from "./projectStore";
import { parseFieldScriptRuntime, parseDungeonBossPools, parseFunfestTrainerPool, type FieldScriptRuntime } from "./gen5TrainerRuntime";

type RomSource = { fileId: number; bytes: Uint8Array };
export type TrainerLocationTables = {
  matrix?: RomSource;
  weatherCalendar?: RomSource;
  stadium?: RomSource;
  royalUnova?: RomSource & { compressed: boolean };
  runtime?: Record<number, RomSource & { compressed: boolean; base: number }>;
};
type StadiumTrainer = { index?: number; group: number; stage: number; trainerId: number };
export type IndirectTrainerContext = {
  stadium: StadiumTrainer[];
  royalUnova: number[];
  partnerHelper: boolean;
  field?: FieldScriptRuntime;
  dungeon?: { white: number[]; black: number[] };
  funfest?: number[];
};

// BW2 sources verified against cleanwhite2.nds. Keep these small sources when
// autosave releases the original ROM, and hydrate them for older saved projects.
export function hydrateTrainerLocationTables(project: ProjectState, rom: NintendoDSRom): void {
  if (project.session.baseRom !== "BW2") return;
  const tables: TrainerLocationTables = {};
  const matrixId = rom.filenames.idOf("a/0/0/9");
  if (matrixId !== undefined) tables.matrix = { fileId: matrixId, bytes: rom.files[matrixId]!.slice() };
  const weatherId = rom.filenames.idOf("a/0/9/6");
  if (weatherId !== undefined) tables.weatherCalendar = { fileId: weatherId, bytes: rom.files[weatherId]!.slice() };
  const fileId = rom.filenames.idOf("a/2/0/6");
  if (fileId !== undefined) tables.stadium = { fileId, bytes: rom.files[fileId]!.slice() };
  const overlay = rom.loadArm9Overlays([89]).get(89);
  if (overlay) tables.royalUnova = { fileId: overlay.fileId, bytes: rom.files[overlay.fileId]!.slice(), compressed: overlay.compressed };
  tables.runtime = {};
  for (const [id, runtime] of rom.loadArm9Overlays([12, 25, 61])) {
    tables.runtime[id] = { fileId: runtime.fileId, bytes: rom.files[runtime.fileId]!.slice(), compressed: runtime.compressed, base: runtime.ramAddress };
  }
  project.trainerLocationTables = tables;
}

/** Keep parked NPCs from lending an unrelated map's difficulty to a battle.
 * Unknown geometry stays eligible; actors moved by scripts also remain eligible. */
export function trainerMapEventContext(project: ProjectState): (row: HeaderRow, overlayId?: number) => {
  activeNpc: (index: number) => boolean;
  entryIndices?: number[];
} {
  const source = project.trainerLocationTables?.matrix;
  let files: Uint8Array[] = [];
  if (!project.narcs.matrix && source) {
    try { files = new NARC(project.fileSystem?.replacements?.[source.fileId] ?? source.bytes).files; }
    catch { /* Missing geometry cannot establish that an NPC is parked. */ }
  }
  const matrices = new Map<number, RawRecord | undefined>();
  return (row, overlayId) => {
    const matrixId = Number(row.matrix_id);
    if (!matrices.has(matrixId)) {
      try {
        matrices.set(matrixId, project.narcs.matrix
          ? decodeRecord(project, "matrix", matrixId).raw
          : files[matrixId] ? parseGen5MatrixFile(files[matrixId]) : undefined);
      } catch { matrices.set(matrixId, undefined); }
    }
    const matrix = matrices.get(matrixId);
    const overworldId = Number(row.overworlds_id ?? row.map_id);
    const raw = project.narcs.overworlds?.rawFiles[overworldId] ? decodeRecord(project, "overworlds", overworldId).raw : undefined;
    const bytes = project.narcs.scripts?.rawFiles[Number(row.script_id)];
    if (!matrix || !raw) return { activeNpc: () => true };
    let zone = Number(row.index);
    if (matrix.matrix_flags) {
      const zones = new Set(Array.from({ length: matrix.width * matrix.height }, (_, i) => matrix[`header_${i}`]));
      if (!zones.has(zone) && zones.has(Number(row.parent_map_id))) zone = Number(row.parent_map_id);
    }
    const commands = bytes ? gen5ScriptCommandOffsets(bytes, project.session.baseRom, { overlayId }) : [];
    const movedActors = new Set<number>();
    const reservedEntries = new Set<number>();
    for (const offset of commands) {
      const command = readU16(bytes!, offset);
      if ([0x64, 0x69, 0x6d, 0x7b, 0x7d, 0x24f, 0x2be].includes(command)) movedActors.add(readU16(bytes!, offset + 2));
      if (command === 0x21) reservedEntries.add(readU16(bytes!, offset + 2));
    }
    const activeNpc = (index: number) => {
      const x = Number(raw[`npc_${index}_x_cord`]), y = Number(raw[`npc_${index}_y_cord`]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || [...movedActors].some((actor) => actor >= 0x4000)
        || movedActors.has(Number(raw[`npc_${index}_overworld_id`]))) return true;
      const col = Math.floor(x / 32), line = Math.floor(y / 32), cell = line * matrix.width + col;
      return col >= 0 && line >= 0 && col < matrix.width && line < matrix.height
        && matrix[`map_${cell}`] !== 0xffffffff && (!matrix.matrix_flags || matrix[`header_${cell}`] === zone);
    };
    const inactiveEntries = new Set<number>();
    for (let i = 0; i < Number(raw.npc_count ?? 0); i += 1) {
      const entry = Number(raw[`npc_${i}_script_id`]);
      if (activeNpc(i)) reservedEntries.add(entry); else inactiveEntries.add(entry);
    }
    for (const group of ["furniture", "trigger"] as const) {
      for (let i = 0; i < Number(raw[`${group}_count`] ?? 0); i += 1) {
        reservedEntries.add(Number(raw[`${group}_${i}_${group === "trigger" ? "entity_id" : "script_id"}`]));
      }
    }
    const reserveInitialization = (table: Uint8Array | undefined, start = 0) => {
      if (!table) return;
      for (let p = start; p + 6 <= table.length; p += 6) {
        const type = readU16(table, p);
        if (type === 0) break;
        if (type !== 1) reservedEntries.add(readU32(table, p + 2));
        else {
          const target = p + 6 + (readU32(table, p + 2) | 0);
          if (target < 0) continue;
          for (let q = target; q + 6 <= table.length && readU16(table, q) !== 0; q += 6) reservedEntries.add(readU16(table, q + 4));
        }
      }
    };
    reserveInitialization(project.narcs.scripts?.rawFiles[Number(row.level_script_id)]);
    const eventBytes = project.narcs.overworlds!.rawFiles[overworldId];
    reserveInitialization(eventBytes, 8 + Number(raw.furniture_count ?? 0) * 20 + Number(raw.npc_count ?? 0) * 36
      + Number(raw.warp_count ?? 0) * 20 + Number(raw.trigger_count ?? 0) * 22);
    const entries = bytes ? gen5ScriptEntries(bytes).map((_, i) => i) : [];
    const bound = entries.filter(i => reservedEntries.has(i + 1));
    const eligible = entries.filter(i => !inactiveEntries.has(i + 1) || reservedEntries.has(i + 1));
    const battles = (entryIndices: number[]) => gen5ResolvedScriptOperands(bytes!, project.session.baseRom,
      { 0x85: [2, 4], 0x86: [2, 4, 6], 0x94: [2, 4] }, { overlayId, entryIndices })
      .flatMap(operand => operand.values).filter(id => id > 0 && id < 0x4000);
    const liveBattles = new Set(bound.length ? battles(bound) : []);
    // Prefer actual event bindings over unbound duplicate battle entrypoints.
    // Preserve unique unbound battles: native events may invoke their entries.
    // Calls from live roots still reach helpers even if their entry is omitted.
    const entryIndices = bytes ? eligible.filter(i => {
      if (reservedEntries.has(i + 1) || !liveBattles.size) return true;
      const ids = battles([i]);
      return !ids.length || !ids.every(id => liveBattles.has(id));
    }) : undefined;
    return { activeNpc, entryIndices };
  };
}

export function indirectTrainerContext(project: ProjectState): IndirectTrainerContext {
  const result: IndirectTrainerContext = { stadium: [], royalUnova: [], partnerHelper: false };
  if (project.session.baseRom !== "BW2") return result;
  const currentBytes = (source: RomSource) => project.fileSystem?.replacements?.[source.fileId] ?? source.bytes;
  for (const [key, source] of Object.entries(project.trainerLocationTables?.runtime ?? {})) {
    const id = Number(key);
    const bytes = project.overlays[id] ?? (source.compressed ? decompressCode(currentBytes(source)) : currentBytes(source));
    if (id === 12) result.field = parseFieldScriptRuntime(bytes, source.base, project.narcs.scripts?.rawFiles ?? [], project.headers?.count ?? 0);
    if (id === 61) result.dungeon = parseDungeonBossPools(bytes);
    if (id === 25) result.funfest = parseFunfestTrainerPool(bytes);
  }
  const stadium = project.trainerLocationTables?.stadium;
  if (stadium) {
    try {
      const bytes = new NARC(currentBytes(stadium)).files[0];
      if (bytes && bytes.length % 8 === 0) {
        // ReBattleTrainer's ROM table: group, story stage, sprite, trainer ID.
        for (let offset = 0; offset < bytes.length; offset += 8) {
          result.stadium.push({ index: offset / 8, group: readU16(bytes, offset), stage: readU16(bytes, offset + 2), trainerId: readU16(bytes, offset + 6) });
        }
      }
    } catch { /* An absent or replaced non-NARC source cannot resolve trainers. */ }
  }
  const boat = project.trainerLocationTables?.royalUnova;
  if (boat) {
    const bytes = project.overlays[89] ?? (boat.compressed ? decompressCode(currentBytes(boat)) : currentBytes(boat));
    result.royalUnova = parseRoyalUnovaTrainerPool(bytes);
  }
  // The standard BW2 common partner helper (10535) lives in script member 1275.
  // Verify its parameter contract in this ROM before interpreting its callers.
  const helper = project.narcs.scripts?.rawFiles[1275];
  result.partnerHelper = Boolean(helper && gen5ScriptCommandOffsets(helper, "BW2").some((offset) =>
    readU16(helper, offset) === 0x250 && [0, 1, 2, 3, 4].every((i) => readU16(helper, offset + 2 + i * 2) === 0x8000 + i)));
  return result;
}

export function parseIndirectTrainerScripts(
  bytes: Uint8Array,
  context: IndirectTrainerContext,
  options: ScriptWalkOptions = {},
  role: "all" | "opponents" | "partners" = "all",
): number[] {
  const trainers = new Set<number>();
  const offsets = new Set(gen5ScriptCommandOffsets(bytes, "BW2", options));
  const add = (id: number) => { if (id > 0 && id < 0x4000) trainers.add(id); };
  const opponent = (id: number) => { if (role !== "partners") add(id); };
  const partner = (id: number) => { if (role !== "opponents") add(id); };
  for (const offset of offsets) {
    const command = readU16(bytes, offset);
    if (command === 0x1e3 || command === 0x1e0) {
      // SetupActorSingle / SetupActorsDouble look up a group AND story stage;
      // the NPC's original script ID does not contain the chosen trainer ID.
      const group = readU16(bytes, offset + 2);
      const stage = readU16(bytes, offset + (command === 0x1e3 ? 6 : 8));
      for (const row of context.stadium) if (row.group === group && row.stage === stage) opponent(row.trainerId);
    } else if (command === 0x1e4) {
      // The three table indices are selected uniformly from the ROM table's
      // random range (80..end), so every row in that range can appear here.
      for (const row of context.stadium) if ((row.index ?? -1) >= 80) opponent(row.trainerId);
    } else if (command === 0x250) {
      partner(readU16(bytes, offset + 8)); // ActorPairSet's fourth argument is the partner trainer.
    } else if (command === 0x1c && readU16(bytes, offset + 2) === 10535 && context.partnerHelper) {
      // _PAIR_TRAINER_SET emits five contiguous WorkSetWorkOrConst commands
      // followed by the common call. Only accept that verified macro, never
      // unrelated constants, stale work values, or bytes inside other commands.
      const start = offset - 30;
      if ([0, 1, 2, 3, 4].every((i) => offsets.has(start + i * 6)
        && readU16(bytes, start + i * 6) === 0x2a
        && readU16(bytes, start + i * 6 + 2) === 0x8000 + i)) {
        partner(readU16(bytes, start + 22));
      }
    } else if (command === 0x1a1 && readU16(bytes, offset + 4) === 6) {
      // Royal Unova GetRoomInfo(TR_ID) supplies the battle's trainer at runtime.
      context.royalUnova.forEach(opponent);
    } else if (command === 0x220) {
      // GetWheelTrainerTrID selects from the eight-entry runtime table.
      context.field?.wheel.forEach(opponent);
    }
  }
  return [...trainers];
}

export function parseRoyalUnovaTrainerPool(bytes: Uint8Array): number[] {
  // pl_boat_setup.c TR_DATA is four u32s: sprite, trainer ID, two messages.
  // Match the ten-row table's sprite/message layout, leaving trainer IDs free
  // to change in ROM hacks. No trainer-name or location-name guesses are used.
  const layout = [[52, 15], [30, 19], [31, 23], [11, 27], [15, 32], [13, 36], [17, 40], [44, 45], [45, 50], [65, 55]];
  const trainers = new Set<number>();
  for (let offset = 0; offset + 160 <= bytes.length; offset += 4) {
    if (!layout.every(([sprite, message], i) => readU32(bytes, offset + i * 16) === sprite
      && readU32(bytes, offset + i * 16 + 8) === message
      && readU32(bytes, offset + i * 16 + 12) === message! + 1)) continue;
    for (let i = 0; i < layout.length; i += 1) {
      const id = readU32(bytes, offset + i * 16 + 4);
      if (id > 0 && id < 0x4000) trainers.add(id);
    }
    offset += 156;
  }
  return [...trainers];
}
