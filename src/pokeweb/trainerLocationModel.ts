import { readU16, readU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { gen5ScriptCommandOffsets, type ScriptWalkOptions } from "./gen5ScriptCommands";
import type { ProjectState } from "./projectStore";
import { parseFieldScriptRuntime, parseDungeonBossPools, parseFunfestTrainerPool, type FieldScriptRuntime } from "./gen5TrainerRuntime";

type RomSource = { fileId: number; bytes: Uint8Array };
export type TrainerLocationTables = {
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
): number[] {
  const trainers = new Set<number>();
  const offsets = new Set(gen5ScriptCommandOffsets(bytes, "BW2", options));
  const add = (id: number) => { if (id > 0 && id < 0x4000) trainers.add(id); };
  for (const offset of offsets) {
    const command = readU16(bytes, offset);
    if (command === 0x1e3 || command === 0x1e0) {
      // SetupActorSingle / SetupActorsDouble look up a group AND story stage;
      // the NPC's original script ID does not contain the chosen trainer ID.
      const group = readU16(bytes, offset + 2);
      const stage = readU16(bytes, offset + (command === 0x1e3 ? 6 : 8));
      for (const row of context.stadium) if (row.group === group && row.stage === stage) add(row.trainerId);
    } else if (command === 0x1e4) {
      // The three table indices are selected uniformly from the ROM table's
      // random range (80..end), so every row in that range can appear here.
      for (const row of context.stadium) if ((row.index ?? -1) >= 80) add(row.trainerId);
    } else if (command === 0x250) {
      add(readU16(bytes, offset + 8)); // ActorPairSet's fourth argument is the partner trainer.
    } else if (command === 0x1c && readU16(bytes, offset + 2) === 10535 && context.partnerHelper) {
      // _PAIR_TRAINER_SET emits five contiguous WorkSetWorkOrConst commands
      // followed by the common call. Only accept that verified macro, never
      // unrelated constants, stale work values, or bytes inside other commands.
      const start = offset - 30;
      if ([0, 1, 2, 3, 4].every((i) => offsets.has(start + i * 6)
        && readU16(bytes, start + i * 6) === 0x2a
        && readU16(bytes, start + i * 6 + 2) === 0x8000 + i)) {
        add(readU16(bytes, start + 22));
      }
    } else if (command === 0x1a1 && readU16(bytes, offset + 4) === 6) {
      // Royal Unova GetRoomInfo(TR_ID) supplies the battle's trainer at runtime.
      context.royalUnova.forEach(add);
    } else if (command === 0x220) {
      // GetWheelTrainerTrID selects from the eight-entry runtime table.
      context.field?.wheel.forEach(add);
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
