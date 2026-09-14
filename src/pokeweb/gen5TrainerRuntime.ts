import { readU16, readU32 } from "../nds/binary";
import { gen5ScriptEntries } from "./gen5ScriptCommands";
import { BW2_OVERLAY_COMMAND_BYTES } from "./gen5ScriptOverlayCommands";

export type GlobalScriptRange = { start: number; end: number; fileId: number };
export type FieldScriptRuntime = {
  globals: GlobalScriptRange[];
  zoneOverlays: Record<number, number>;
  wheel: number[];
  wheelScriptFileIds: number[];
};

/** Locate the dispatch tables by their structure, without fixed ROM addresses. */
export function parseFieldScriptRuntime(bytes: Uint8Array, base: number, scripts: readonly Uint8Array[], headerCount: number): FieldScriptRuntime {
  let globals: GlobalScriptRange[] = [];
  // ScriptArcTable: five u16s (start, end, script member, message archive, bank).
  // Entries are descending, non-overlapping script-ID ranges.
  for (let offset = 0; offset + 10 <= bytes.length; offset += 2) {
    const ranges: GlobalScriptRange[] = [];
    let previous = 65536;
    for (let cursor = offset; cursor + 10 <= bytes.length; cursor += 10) {
      const start = readU16(bytes, cursor), end = readU16(bytes, cursor + 2), fileId = readU16(bytes, cursor + 4);
      const messageArchive = readU16(bytes, cursor + 6);
      if (start < 2000 || end < start || end >= previous || fileId >= scripts.length || messageArchive > 10) break;
      if (!gen5ScriptEntries(scripts[fileId] ?? new Uint8Array()).length) break;
      ranges.push({ start, end, fileId });
      previous = start;
    }
    if (ranges.length >= 20 && ranges.length > globals.length) globals = ranges;
  }
  // ScrCmd_Overlay_table: function table pointer, zone-list pointer, count,
  // overlay ID, secondary overlay ID. Read the ROM's zone assignments.
  let zoneOverlays: Record<number, number> = {};
  let bestCount = 0;
  for (let offset = 0; offset + 20 <= bytes.length; offset += 4) {
    const zones: Record<number, number> = {};
    let count = 0;
    for (let cursor = offset; cursor + 20 <= bytes.length; cursor += 20) {
      const pointer = readU32(bytes, cursor + 4) - base;
      const length = readU32(bytes, cursor + 8), overlay = readU32(bytes, cursor + 12);
      if (!BW2_OVERLAY_COMMAND_BYTES[overlay] || length < 1 || length > 100 || pointer < 0 || pointer + length * 2 > bytes.length) break;
      const ids = Array.from({ length }, (_,i) => readU16(bytes, pointer + i * 2));
      if (ids.some((id) => id >= headerCount)) break;
      ids.forEach((id) => { zones[id] = overlay; });
      count += 1;
    }
    if (count >= 8 && count > bestCount) { bestCount = count; zoneOverlays = zones; }
  }
  // The adjacent eight sprite IDs identify the Ferris wheel table; trainer IDs
  // are read from the current ROM, including edits to that pool.
  const spriteSignature = [15, 55, 23, 52, 53, 64, 303, 296];
  const wheel: number[] = [];
  for (let offset = 0; offset + 32 <= bytes.length; offset += 2) {
    if (spriteSignature.every((value, i) => readU16(bytes, offset + i * 2) === value)) {
      wheel.push(...Array.from({ length: 8 }, (_, i) => readU16(bytes, offset + 16 + i * 2)));
    }
  }
  const wheelScriptFileIds = [...new Set(globals.map((range) => range.fileId).filter((fileId) => {
    const script = scripts[fileId];
    if (!script) return false;
    const fixedEntries = new Set<number>();
    for (let offset = 0; offset + 6 <= script.length; offset += 1) {
      const command = readU16(script, offset);
      if (command !== 0x220 || readU16(script, offset + 4) < 0x4000) continue;
      const entry = readU16(script, offset + 2);
      if (entry < 8) fixedEntries.add(entry);
    }
    return fixedEntries.size === 8;
  }))];
  return { globals, zoneOverlays, wheel, wheelScriptFileIds };
}

export function parseDungeonBossPools(bytes: Uint8Array): { white: number[]; black: number[] } {
  const pools = { white: [] as number[], black: [] as number[] };
  const sprites = { white: [35, 34, 37, 36, 33, 30, 31, 32, 33, 304, 32], black: [34, 35, 36, 37, 32, 31, 30, 33, 32, 304, 33] };
  for (const color of ["white", "black"] as const) {
    for (let offset = 0; offset + 88 <= bytes.length; offset += 4) {
      if (sprites[color].every((sprite, i) => readU32(bytes, offset + i * 8 + 4) === sprite)) {
        pools[color].push(...sprites[color].map((_, i) => readU32(bytes, offset + i * 8)));
      }
    }
  }
  return pools;
}

export function parseFunfestTrainerPool(bytes: Uint8Array): number[] {
  // DATA_NpcTrainer (3 groups of 6 u16s) precedes the gift-item probability
  // tables in the BW2 Funfest data overlay. Trainer IDs are not part of the signature.
  const gifts = [158, 40, 14, 15, 63, 15, 29, 15, 92, 10, 50, 5, 504, 20, 42, 20, 54, 20, 591, 20, 51, 15, 50, 5];
  for (let offset = 36; offset + gifts.length * 2 <= bytes.length; offset += 2) {
    if (gifts.every((value, i) => readU16(bytes, offset + i * 2) === value)) {
      return Array.from({ length: 18 }, (_, i) => readU16(bytes, offset - 36 + i * 2));
    }
  }
  return [];
}
