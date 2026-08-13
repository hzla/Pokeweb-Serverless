import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { BaseRom } from "./constants";
import { markDirty, type ProjectState } from "./projectStore";

export const GEN5_INGAME_TRADE_RECORD_LENGTH = 0x6c;
const GIVEN_SPECIES_OFFSET = 0x04;
const IVS_OFFSET = 0x10;
const IV_COUNT = 6;
const HELD_ITEM_OFFSET = 0x4c;
const REQUESTED_SPECIES_OFFSET = 0x5c;
const MINIMUM_RECORD_LENGTH = GEN5_INGAME_TRADE_RECORD_LENGTH;
const WORD_SET_POKE_SPECIES = 0x57;
const WORD_SET_POKE_SPECIES_WITH_ARTICLE = 0x58;

export function gen5InGameTradeTextBankId(baseRom: BaseRom): number | undefined {
  if (baseRom === "BW") return 35;
  if (baseRom === "BW2") return 37;
  return undefined;
}

export type Gen5InGameTrade = {
  fileId: number;
  tradeId: number;
  givenSpeciesId: number;
  givenForm: number;
  level: number;
  requestedSpeciesId: number;
  heldItemId: number;
  ivs: number[];
  abilityChoice: number;
  nature: number;
  gender: number;
  pokemonId: number;
  contestStyle: number;
  contestBeauty: number;
  contestCute: number;
  contestClever: number;
  contestTough: number;
  otGender: number;
  rawMetadata: number;
  worldCode: number;
  requestedGender: number;
  nicknameTextId: number;
  otNameTextId: number;
};

export type Gen5InGameTradePatch = {
  trade: Gen5InGameTrade;
  givenSpeciesId: number;
  requestedSpeciesId: number;
  tradeId?: number;
  givenForm?: number;
  level?: number;
  heldItemId?: number;
  ivs?: number[];
  abilityChoice?: number;
  nature?: number;
  gender?: number;
  pokemonId?: number;
  contestStyle?: number;
  contestBeauty?: number;
  contestCute?: number;
  contestClever?: number;
  contestTough?: number;
  otGender?: number;
  rawMetadata?: number;
  worldCode?: number;
  requestedGender?: number;
  nicknameTextId?: number;
  otNameTextId?: number;
};

export type Gen5InGameTradeField = Exclude<keyof Gen5InGameTrade, "fileId" | "ivs"> | `iv${number}`;

export type Gen5InGameTradeFieldSpec = {
  field: Gen5InGameTradeField;
  label: string;
  offset: number;
  min: number;
  max: number;
  known: boolean;
};

export const GEN5_INGAME_TRADE_FIELDS: readonly Gen5InGameTradeFieldSpec[] = [
  { field: "tradeId", label: "Trade ID", offset: 0x00, min: 0, max: 0xffffffff, known: false },
  { field: "givenSpeciesId", label: "Received Pokemon", offset: 0x04, min: 1, max: 0xffffffff, known: true },
  { field: "givenForm", label: "Received Form", offset: 0x08, min: 0, max: 0xffffffff, known: true },
  { field: "level", label: "Level", offset: 0x0c, min: 1, max: 100, known: true },
  ...["HP IV", "Attack IV", "Defense IV", "Speed IV", "Sp. Attack IV", "Sp. Defense IV"].map((label, index) => ({
    field: `iv${index}` as Gen5InGameTradeField,
    label,
    offset: IVS_OFFSET + index * 4,
    min: 0,
    max: 31,
    known: true,
  })),
  { field: "abilityChoice", label: "Ability Slot", offset: 0x28, min: 0, max: 2, known: true },
  { field: "nature", label: "Nature", offset: 0x2c, min: 0, max: 24, known: true },
  { field: "gender", label: "Received Gender", offset: 0x30, min: 0, max: 2, known: true },
  { field: "pokemonId", label: "Trainer ID", offset: 0x34, min: 0, max: 0xffffffff, known: true },
  { field: "contestStyle", label: "Cool / Style", offset: 0x38, min: 0, max: 255, known: true },
  { field: "contestBeauty", label: "Beauty", offset: 0x3c, min: 0, max: 255, known: true },
  { field: "contestCute", label: "Cute", offset: 0x40, min: 0, max: 255, known: true },
  { field: "contestClever", label: "Clever", offset: 0x44, min: 0, max: 255, known: true },
  { field: "contestTough", label: "Tough", offset: 0x48, min: 0, max: 255, known: true },
  { field: "heldItemId", label: "Held Item", offset: 0x4c, min: 0, max: 0xffffffff, known: true },
  { field: "otGender", label: "OT Gender", offset: 0x50, min: 0, max: 2, known: true },
  { field: "rawMetadata", label: "Sheen", offset: 0x54, min: 0, max: 255, known: true },
  { field: "worldCode", label: "OT Language / World Code", offset: 0x58, min: 1, max: 8, known: true },
  { field: "requestedSpeciesId", label: "Requested Pokemon", offset: 0x5c, min: 1, max: 0xffffffff, known: true },
  { field: "requestedGender", label: "Requested Gender", offset: 0x60, min: 0, max: 2, known: true },
  { field: "nicknameTextId", label: "Nickname Text Entry ID", offset: 0x64, min: 0, max: 0xffffffff, known: true },
  { field: "otNameTextId", label: "OT Name Text Entry ID", offset: 0x68, min: 0, max: 0xffffffff, known: true },
] as const;

export function scanGen5InGameTrades(project: ProjectState): Gen5InGameTrade[] {
  const store = project.narcs.ingame_trades;
  if (!store) return [];
  const pokemonCount = project.narcs.personal?.fileCount ?? 0x4000;
  return store.rawFiles.flatMap((bytes, fileId) => {
    if (bytes.length < MINIMUM_RECORD_LENGTH) return [];
    const givenSpeciesId = readU32(bytes, GIVEN_SPECIES_OFFSET);
    const requestedSpeciesId = readU32(bytes, REQUESTED_SPECIES_OFFSET);
    if (!isSpeciesId(givenSpeciesId, pokemonCount) || !isSpeciesId(requestedSpeciesId, pokemonCount)) return [];
    return [readTradeRecord(bytes, fileId)];
  });
}

/** Includes structurally valid records with expanded or hacked species IDs. */
export function scanAllGen5InGameTrades(project: ProjectState): Gen5InGameTrade[] {
  const store = project.narcs.ingame_trades;
  if (!store) return [];
  return store.rawFiles.flatMap((bytes, fileId) => bytes.length < MINIMUM_RECORD_LENGTH ? [] : [readTradeRecord(bytes, fileId)]);
}

export function applyGen5InGameTradePatches(project: ProjectState, patches: Gen5InGameTradePatch[]): { records: number; scriptMirrors: number } {
  const store = project.narcs.ingame_trades;
  if (!store) throw new Error("In-game trade data is not loaded.");
  patches.forEach(validateTradePatch);
  let records = 0;
  for (const patch of patches) {
    const source = store.rawFiles[patch.trade.fileId];
    if (!source || source.length < MINIMUM_RECORD_LENGTH) continue;
    const out = new Uint8Array(source);
    writeU32(out, GIVEN_SPECIES_OFFSET, patch.givenSpeciesId);
    writeU32(out, REQUESTED_SPECIES_OFFSET, patch.requestedSpeciesId);
    for (const spec of GEN5_INGAME_TRADE_FIELDS) {
      if (spec.field === "givenSpeciesId" || spec.field === "requestedSpeciesId" || spec.field.startsWith("iv")) continue;
      const value = patch[spec.field as Exclude<Gen5InGameTradeField, `iv${number}`>];
      if (typeof value === "number") writeU32(out, spec.offset, value);
    }
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

function readTradeRecord(bytes: Uint8Array, fileId: number): Gen5InGameTrade {
  return {
    fileId,
    tradeId: readU32(bytes, 0x00),
    givenSpeciesId: readU32(bytes, GIVEN_SPECIES_OFFSET),
    givenForm: readU32(bytes, 0x08),
    level: readU32(bytes, 0x0c),
    requestedSpeciesId: readU32(bytes, REQUESTED_SPECIES_OFFSET),
    heldItemId: readU32(bytes, HELD_ITEM_OFFSET),
    ivs: Array.from({ length: IV_COUNT }, (_unused, index) => readU32(bytes, IVS_OFFSET + index * 4)),
    abilityChoice: readU32(bytes, 0x28),
    nature: readU32(bytes, 0x2c),
    gender: readU32(bytes, 0x30),
    pokemonId: readU32(bytes, 0x34),
    contestStyle: readU32(bytes, 0x38),
    contestBeauty: readU32(bytes, 0x3c),
    contestCute: readU32(bytes, 0x40),
    contestClever: readU32(bytes, 0x44),
    contestTough: readU32(bytes, 0x48),
    otGender: readU32(bytes, 0x50),
    rawMetadata: readU32(bytes, 0x54),
    worldCode: readU32(bytes, 0x58),
    requestedGender: readU32(bytes, 0x60),
    nicknameTextId: readU32(bytes, 0x64),
    otNameTextId: readU32(bytes, 0x68),
  };
}

function validateTradePatch(patch: Gen5InGameTradePatch): void {
  for (const spec of GEN5_INGAME_TRADE_FIELDS) {
    if (spec.field.startsWith("iv")) continue;
    const value = spec.field === "givenSpeciesId" ? patch.givenSpeciesId
      : spec.field === "requestedSpeciesId" ? patch.requestedSpeciesId
        : patch[spec.field as Exclude<Gen5InGameTradeField, `iv${number}`>];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
      throw new Error(`${spec.label} must be an integer between ${spec.min} and ${spec.max}.`);
    }
  }
  if (patch.ivs && (patch.ivs.length > IV_COUNT || patch.ivs.some((value) => !Number.isInteger(value) || value < 0 || value > 31))) {
    throw new Error("Trade IVs must contain at most six integers between 0 and 31.");
  }
}
