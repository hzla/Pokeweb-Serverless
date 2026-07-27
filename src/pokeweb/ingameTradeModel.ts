import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { markDirty, type ProjectState } from "./projectStore";

const GIVEN_SPECIES_OFFSET = 0x04;
const IVS_OFFSET = 0x10;
const IV_COUNT = 6;
const HELD_ITEM_OFFSET = 0x4c;
const REQUESTED_SPECIES_OFFSET = 0x5c;
const MINIMUM_RECORD_LENGTH = REQUESTED_SPECIES_OFFSET + 4;
const WORD_SET_POKE_SPECIES = 0x57;
const WORD_SET_POKE_SPECIES_WITH_ARTICLE = 0x58;

export type Gen5InGameTrade = {
  fileId: number;
  givenSpeciesId: number;
  requestedSpeciesId: number;
  heldItemId: number;
  ivs: number[];
};

export type Gen5InGameTradePatch = {
  trade: Gen5InGameTrade;
  givenSpeciesId: number;
  requestedSpeciesId: number;
  heldItemId?: number;
  ivs?: number[];
};

export function scanGen5InGameTrades(project: ProjectState): Gen5InGameTrade[] {
  const store = project.narcs.ingame_trades;
  if (!store) return [];
  const pokemonCount = project.narcs.personal?.fileCount ?? 0x4000;
  return store.rawFiles.flatMap((bytes, fileId) => {
    if (bytes.length < MINIMUM_RECORD_LENGTH) return [];
    const givenSpeciesId = readU32(bytes, GIVEN_SPECIES_OFFSET);
    const requestedSpeciesId = readU32(bytes, REQUESTED_SPECIES_OFFSET);
    if (!isSpeciesId(givenSpeciesId, pokemonCount) || !isSpeciesId(requestedSpeciesId, pokemonCount)) return [];
    return [{
      fileId,
      givenSpeciesId,
      requestedSpeciesId,
      heldItemId: readU32(bytes, HELD_ITEM_OFFSET),
      ivs: Array.from({ length: IV_COUNT }, (_unused, index) => readU32(bytes, IVS_OFFSET + index * 4)),
    }];
  });
}

export function applyGen5InGameTradePatches(project: ProjectState, patches: Gen5InGameTradePatch[]): { records: number; scriptMirrors: number } {
  const store = project.narcs.ingame_trades;
  if (!store) throw new Error("In-game trade data is not loaded.");
  let records = 0;
  for (const patch of patches) {
    const source = store.rawFiles[patch.trade.fileId];
    if (!source || source.length < MINIMUM_RECORD_LENGTH) continue;
    const out = new Uint8Array(source);
    writeU32(out, GIVEN_SPECIES_OFFSET, patch.givenSpeciesId);
    writeU32(out, REQUESTED_SPECIES_OFFSET, patch.requestedSpeciesId);
    if (patch.heldItemId !== undefined) writeU32(out, HELD_ITEM_OFFSET, patch.heldItemId);
    patch.ivs?.slice(0, IV_COUNT).forEach((iv, index) => writeU32(out, IVS_OFFSET + index * 4, iv));
    store.rawFiles[patch.trade.fileId] = out;
    markDirty(project, "ingame_trades", patch.trade.fileId);
    records += 1;
  }
  return { records, scriptMirrors: patchTradeScriptMirrors(project, patches) };
}

/**
 * Gen 5 trade scripts place the two species operands in a small command group
 * beginning with WordSetPokeSpecies. Scanning for that command-and-pair pattern
 * keeps the archive and dialogue/check logic synchronized even if a hack moves
 * the script or changes the absolute offsets used by retail ROMs.
 */
export function patchTradeScriptMirrors(project: ProjectState, patches: Gen5InGameTradePatch[]): number {
  const scripts = project.narcs.scripts;
  if (!scripts || patches.length === 0) return 0;
  let updates = 0;
  scripts.rawFiles.forEach((source, fileId) => {
    let out: Uint8Array | undefined;
    const used = new Set<number>();
    for (let offset = 0; offset + 10 <= source.length; offset += 1) {
      const opcode = readU16(source, offset);
      if (opcode !== WORD_SET_POKE_SPECIES && opcode !== WORD_SET_POKE_SPECIES_WITH_ARTICLE) continue;
      const wordSpecies = readU16(source, offset + 3);
      const pairedSpecies = readU16(source, offset + 8);
      const patchIndex = patches.findIndex((patch, index) => !used.has(index) && (
        (wordSpecies === patch.trade.requestedSpeciesId && pairedSpecies === patch.trade.givenSpeciesId) ||
        (wordSpecies === patch.trade.givenSpeciesId && pairedSpecies === patch.trade.requestedSpeciesId)
      ));
      if (patchIndex < 0) continue;
      const patch = patches[patchIndex]!;
      out ??= new Uint8Array(source);
      if (wordSpecies === patch.trade.requestedSpeciesId && pairedSpecies === patch.trade.givenSpeciesId) {
        writeU16(out, offset + 3, patch.requestedSpeciesId);
        writeU16(out, offset + 8, patch.givenSpeciesId);
      } else {
        writeU16(out, offset + 3, patch.givenSpeciesId);
        writeU16(out, offset + 8, patch.requestedSpeciesId);
      }
      used.add(patchIndex);
      updates += 1;
    }
    if (!out) return;
    scripts.rawFiles[fileId] = out;
    markDirty(project, "scripts", fileId);
  });
  return updates;
}

function isSpeciesId(value: number, pokemonCount: number): boolean {
  return Number.isInteger(value) && value > 0 && value < pokemonCount;
}
