import { readU16, readU32, writeU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordFieldChange } from "./actionChangelog";
import { isGen5Project, type Gen5Version } from "./constants";
import type { NitroSdat } from "./nitroSound";
import { loadNitroSdatFromProject } from "./nitroSound";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import { displayNameForTrainerMusicSymbol, trainerMusicSequenceLabel } from "./trainerMusicModel";

const BW_BATTLE_EFFECT_SIGNATURE = [
  0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x1b, 0x05, 0x1c, 0x1c, 0x1d, 0x1e, 0x1e, 0x05,
] as const;

const BW2_BATTLE_EFFECT_SIGNATURE = [
  0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x05,
  0x0a, 0x05, 0x18, 0x19, 0x1a, 0x1a, 0x1a, 0x1a, 0x17, 0x1b, 0x1e, 0x1f, 0x05,
  0x05, 0x09, 0x09,
] as const;

/** Thumb epilogue immediately before the table/effect/default-track literal pool. */
const BATTLE_LITERAL_CODE_SIGNATURE = [
  0x00, 0x2e, 0x00, 0xd1, 0x07, 0x21, 0x04, 0x48,
  0x20, 0x80, 0x29, 0x60, 0x03, 0xb0, 0xf0, 0xbd,
] as const;

export const BW_TRAINER_BATTLE_GROUPS = [
  { key: "rival", name: "Rival", scope: "Rival trainer types" },
  { key: "support", name: "Support partner", scope: "Support trainer types; shares the Rival theme by default" },
  { key: "gym-leader", name: "Gym Leaders", scope: "All Gym Leader trainer types" },
  { key: "elite-four", name: "Elite Four", scope: "All Elite Four trainer types" },
  { key: "champion", name: "Champion", scope: "Champion trainer types" },
  { key: "n", name: "N", scope: "N's regular boss encounters" },
  { key: "plasma-boss", name: "Team Plasma boss", scope: "Team Plasma boss trainer types; shares N's theme by default" },
  { key: "n-final", name: "N (final battle)", scope: "N's final-battle trainer type" },
  { key: "ghetsis", name: "Ghetsis", scope: "Ghetsis and Sage trainer types" },
  { key: "team-plasma", name: "Team Plasma", scope: "Team Plasma trainer types" },
  { key: "cynthia", name: "Cynthia", scope: "The returning Sinnoh Champion trainer type" },
] as const;

export const BW2_TRAINER_BATTLE_GROUPS = [
  { key: "gym-leader", name: "Gym Leaders", scope: "Gym Leader battle-intro group" },
  { key: "elite-four", name: "Elite Four", scope: "Elite Four battle-intro group" },
  { key: "cynthia", name: "Cynthia", scope: "Cynthia battle-intro group" },
  { key: "hugh", name: "Hugh", scope: "Hugh battle-intro group" },
  { key: "standard-intro", name: "Standard special intro", scope: "Special trainer types that retain the standard Trainer theme" },
  { key: "colress", name: "Colress", scope: "Colress battle-intro group" },
  { key: "n", name: "N", scope: "N battle-intro group" },
  { key: "team-plasma", name: "Team Plasma", scope: "Team Plasma battle-intro group" },
  { key: "iris", name: "Champion Iris", scope: "Champion Iris battle-intro group" },
  { key: "ghetsis", name: "Ghetsis", scope: "Ghetsis battle-intro group" },
  { key: "elite-plasma", name: "Team Plasma elite", scope: "Elite Team Plasma battle-intro group" },
  { key: "benga", name: "Benga", scope: "Benga battle-intro group" },
  { key: "colress-alt", name: "Colress (alternate)", scope: "Alternate Colress battle-intro group" },
  { key: "rival", name: "Rival theme group", scope: "Legacy rival/support battle-intro group" },
] as const;

const BATTLE_LAYOUTS: Record<
  Gen5Version,
  {
    overlayId: number;
    canonicalTableOffset: number;
    groups: ReadonlyArray<{ key: string; name: string; scope: string }>;
    effectSignature: readonly number[];
  }
> = {
  B: { overlayId: 21, canonicalTableOffset: 0x538e0, groups: BW_TRAINER_BATTLE_GROUPS, effectSignature: BW_BATTLE_EFFECT_SIGNATURE },
  W: { overlayId: 21, canonicalTableOffset: 0x538d8, groups: BW_TRAINER_BATTLE_GROUPS, effectSignature: BW_BATTLE_EFFECT_SIGNATURE },
  B2: { overlayId: 36, canonicalTableOffset: 0x532e4, groups: BW2_TRAINER_BATTLE_GROUPS, effectSignature: BW2_BATTLE_EFFECT_SIGNATURE },
  W2: { overlayId: 36, canonicalTableOffset: 0x532d8, groups: BW2_TRAINER_BATTLE_GROUPS, effectSignature: BW2_BATTLE_EFFECT_SIGNATURE },
};

const BW_BATTLE_SEQUENCE_SYMBOLS: Readonly<Record<number, string>> = {
  1128: "SEQ_BGM_VS_NORAPOKE",
  1129: "SEQ_BGM_VS_TSUYOPOKE",
  1130: "SEQ_BGM_VS_TRAINER",
  1131: "SEQ_BGM_VS_SUBWAY_TRAINER",
  1132: "SEQ_BGM_VS_GYMLEADER",
  1133: "SEQ_BGM_VS_RIVAL",
  1134: "SEQ_BGM_VS_PLASMA",
  1135: "SEQ_BGM_VS_SHITENNO",
  1136: "SEQ_BGM_VS_CHAMP",
  1137: "SEQ_BGM_VS_N",
  1138: "SEQ_BGM_VS_N_2",
  1139: "SEQ_BGM_VS_G_CIS",
  1140: "SEQ_BGM_VS_SHIN",
  1141: "SEQ_BGM_VS_MU",
  1142: "SEQ_BGM_VS_RAI",
  1143: "SEQ_BGM_VS_MOVEPOKE",
  1144: "SEQ_BGM_VS_SETPOKE",
  1145: "SEQ_BGM_VS_SHIRONA",
  1163: "SEQ_BGM_VS_TRAINER_M",
  1164: "SEQ_BGM_VS_TRAINER_S",
  1165: "SEQ_BGM_VS_WCS",
  1168: "SEQ_BGM_VS_TRAINER_WIFI",
};

const BW2_BATTLE_SEQUENCE_SYMBOLS: Readonly<Record<number, string>> = {
  ...Object.fromEntries(Object.entries(BW_BATTLE_SEQUENCE_SYMBOLS).filter(([sequenceId]) => Number(sequenceId) <= 1145)),
  1134: "SEQ_BGM_VS_DPLEGEND",
  1137: "SEQ_BGM_VS_SWAN_N",
  1138: "SEQ_BGM_VS_UMA",
  1139: "SEQ_BGM_VS_REGI",
  1161: "SEQ_BGM_VS_TRAINER_M",
  1162: "SEQ_BGM_VS_TRAINER_S",
  1163: "SEQ_BGM_VS_WCS",
  1164: "SEQ_BGM_VS_TRAINER_WIFI",
  1245: "SEQ_BGM_VS_RG_LEADER",
  1246: "SEQ_BGM_VS_RG_CHAMP",
  1247: "SEQ_BGM_VS_GS_LEADER",
  1248: "SEQ_BGM_VS_GS_CHAMP",
  1249: "SEQ_BGM_VS_RS_LEADER",
  1250: "SEQ_BGM_VS_RS_CHAMP",
  1251: "SEQ_BGM_VS_DP_LEADER",
  1252: "SEQ_BGM_VS_DP_CHAMP",
  1253: "SEQ_BGM_VS_BW_CHAMP",
  1254: "SEQ_BGM_VS_WBT",
  1255: "SEQ_BGM_VS_KYURAMU",
  1256: "SEQ_BGM_VS_KYUROMU",
  1257: "SEQ_BGM_VS_NEO_PLASMA",
  1258: "SEQ_BGM_VS_ACHROMA",
  1259: "SEQ_BGM_VS_NEW_G_CIS",
  1260: "SEQ_BGM_VS_IRIS",
  1261: "SEQ_BGM_VS_BANJIROU",
  1262: "SEQ_BGM_VS_HUE",
  1267: "SEQ_BGM_VS_ELITE_PLASMA",
};

export type TrainerBattleTheme = {
  sequenceId: number;
  symbol: string;
  displayName: string;
};

export type TrainerBattleMusicAssignment = {
  key: string;
  groupIndex?: number;
  name: string;
  scope: string;
  currentSequenceId?: number;
  writeOffset?: number;
  editable: boolean;
  fallback: boolean;
  readOnlyReason?: string;
};

export type TrainerBattleMusicOverlay = {
  overlayId: number;
  ramAddress: number;
  data: Uint8Array;
};

export type TrainerBattleMusicLocation = {
  overlayId: number;
  overlayRamAddress: number;
  tableOffset: number;
  normalSequenceOffset: number;
  groupCount: number;
  source: "canonical" | "signature-scan";
};

export type TrainerBattleMusicModel = {
  project: ProjectState;
  sdat: NitroSdat;
  themes: TrainerBattleTheme[];
  assignments: TrainerBattleMusicAssignment[];
  overlay?: TrainerBattleMusicOverlay;
  location?: TrainerBattleMusicLocation;
  assignmentError?: string;
};

export async function loadTrainerBattleMusicModel(project: ProjectState, sdat?: NitroSdat): Promise<TrainerBattleMusicModel> {
  const loadedSdat = sdat ?? (await loadNitroSdatFromProject(project));
  try {
    const overlay = await loadTrainerBattleMusicOverlay(project);
    return createTrainerBattleMusicModel(project, loadedSdat, overlay);
  } catch (error) {
    return createTrainerBattleMusicModel(
      project,
      loadedSdat,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function createTrainerBattleMusicModel(
  project: ProjectState,
  sdat: NitroSdat,
  overlay?: TrainerBattleMusicOverlay,
  overlayError?: string,
): TrainerBattleMusicModel {
  if (!isGen5Project(project)) throw new Error("Trainer battle music currently supports Pokémon Black, White, Black 2, and White 2 only.");
  const themes = buildTrainerBattleThemes(project, sdat);
  let location: TrainerBattleMusicLocation | undefined;
  let assignmentError = overlayError;
  if (overlay) {
    try {
      location = locateTrainerBattleMusicTable(project, overlay);
    } catch (error) {
      assignmentError = error instanceof Error ? error.message : String(error);
    }
  } else if (!assignmentError) {
    assignmentError = "The field battle overlay is not loaded. Reassignment is disabled to protect the ROM.";
  }
  return {
    project,
    sdat,
    themes,
    assignments: buildTrainerBattleMusicAssignments(project, overlay, location, assignmentError),
    overlay,
    location,
    assignmentError,
  };
}

export function buildTrainerBattleThemes(project: ProjectState, sdat: NitroSdat): TrainerBattleTheme[] {
  const fallbacks = project.session.baseRom === "BW" ? BW_BATTLE_SEQUENCE_SYMBOLS : BW2_BATTLE_SEQUENCE_SYMBOLS;
  const sequenceIds = new Set<number>(Object.keys(fallbacks).map(Number));
  sdat.sequenceInfos.forEach((sequence) => {
    const symbol = sequence?.symbol || sdat.sequenceSymbols[sequence.id];
    if (symbol && /^SEQ_BGM_VS_/u.test(symbol)) sequenceIds.add(sequence.id);
  });
  return [...sequenceIds]
    .filter((sequenceId) => Boolean(sdat.sequenceInfos[sequenceId]))
    .sort((a, b) => a - b)
    .map((sequenceId) => {
      const sequence = sdat.sequenceInfos[sequenceId];
      const symbol = sequence?.symbol || sdat.sequenceSymbols[sequenceId] || fallbacks[sequenceId] || `SEQ_BGM_VS_${sequenceId}`;
      return { sequenceId, symbol, displayName: displayNameForTrainerMusicSymbol(symbol, sequenceId) };
    });
}

export function locateTrainerBattleMusicTable(
  project: ProjectState,
  overlay: TrainerBattleMusicOverlay,
): TrainerBattleMusicLocation {
  if (!isGen5Project(project)) throw new Error("Trainer battle-music tables are only available in Gen 5 ROMs.");
  const layout = BATTLE_LAYOUTS[project.session.baseVersion as Gen5Version];
  if (overlay.overlayId !== layout.overlayId) {
    throw new Error(`Trainer battle music expected overlay ${layout.overlayId}, but overlay ${overlay.overlayId} was provided.`);
  }
  const tableLength = layout.groups.length * 2;
  const candidates: Array<{ tableOffset: number; normalSequenceOffset: number }> = [];
  const canonical = matchBattleTableAt(overlay, layout.canonicalTableOffset, tableLength, layout.effectSignature);
  if (canonical !== undefined) candidates.push({ tableOffset: layout.canonicalTableOffset, normalSequenceOffset: canonical });
  for (let tableOffset = 0; tableOffset <= overlay.data.length - tableLength - layout.effectSignature.length; tableOffset += 2) {
    if (tableOffset === layout.canonicalTableOffset) continue;
    const normalSequenceOffset = matchBattleTableAt(overlay, tableOffset, tableLength, layout.effectSignature);
    if (normalSequenceOffset !== undefined) candidates.push({ tableOffset, normalSequenceOffset });
    if (candidates.length > 1) break;
  }
  if (candidates.length === 0) {
    throw new Error("Pokeweb could not locate a supported trainer battle-music table in the field overlay. Reassignment is disabled to protect the ROM.");
  }
  if (candidates.length > 1) {
    throw new Error("Pokeweb found multiple possible trainer battle-music tables in the field overlay. Reassignment is disabled because the target is ambiguous.");
  }
  return {
    overlayId: overlay.overlayId,
    overlayRamAddress: overlay.ramAddress,
    tableOffset: candidates[0].tableOffset,
    normalSequenceOffset: candidates[0].normalSequenceOffset,
    groupCount: layout.groups.length,
    source: candidates[0].tableOffset === layout.canonicalTableOffset ? "canonical" : "signature-scan",
  };
}

export function assignTrainerBattleTheme(
  project: ProjectState,
  model: TrainerBattleMusicModel,
  assignment: TrainerBattleMusicAssignment,
  sequenceId: number,
): void {
  const theme = model.themes.find((candidate) => candidate.sequenceId === sequenceId);
  if (!theme) throw new Error(`Sequence ${sequenceId} is not an assignable battle theme for this game.`);
  if (!assignment.editable || assignment.writeOffset === undefined || !model.overlay || !model.location) {
    throw new Error(assignment.readOnlyReason || `${assignment.name} is read-only.`);
  }
  if (assignment.writeOffset < 0 || assignment.writeOffset + 2 > model.overlay.data.length) {
    throw new Error("Trainer battle-music write offset is outside the field overlay.");
  }
  const beforeId = readU16(model.overlay.data, assignment.writeOffset);
  if (beforeId === sequenceId) return;
  writeU16(model.overlay.data, assignment.writeOffset, sequenceId);
  project.overlays[model.location.overlayId] = model.overlay.data;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(model.location.overlayId)) {
    project.patches.dirtyOverlayIds.push(model.location.overlayId);
  }
  assignment.currentSequenceId = sequenceId;
  recordFieldChange(
    project,
    "trainer_music",
    assignment.name,
    "Battle theme",
    trainerBattleMusicTrackLabel(model, beforeId),
    theme.displayName,
    { key: `trainer-battle-music:${assignment.key}` },
  );
}

export function trainerBattleMusicTrackLabel(model: TrainerBattleMusicModel, sequenceId: number | undefined): string {
  if (sequenceId === undefined) return "Unavailable";
  const theme = model.themes.find((candidate) => candidate.sequenceId === sequenceId);
  if (theme) return theme.displayName;
  return `${trainerMusicSequenceLabel(model.sdat, sequenceId)} (unsupported)`;
}

async function loadTrainerBattleMusicOverlay(project: ProjectState): Promise<TrainerBattleMusicOverlay> {
  const version = project.session.baseVersion as Gen5Version;
  const overlayId = BATTLE_LAYOUTS[version].overlayId;
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Original ROM bytes are not available; reload the ROM before editing trainer battle music.");
  const rom = new NintendoDSRom(romBytes);
  const original = rom.loadArm9Overlays([overlayId]).get(overlayId);
  if (!original) throw new Error(`Could not load trainer battle-music overlay ${overlayId} from the ROM.`);
  const current = project.overlays[overlayId];
  return {
    overlayId,
    ramAddress: overlayRamAddress(project, rom, overlayId) ?? original.ramAddress,
    data: current && current.length > 0 ? current : original.data,
  };
}

function buildTrainerBattleMusicAssignments(
  project: ProjectState,
  overlay: TrainerBattleMusicOverlay | undefined,
  location: TrainerBattleMusicLocation | undefined,
  assignmentError: string | undefined,
): TrainerBattleMusicAssignment[] {
  const layout = BATTLE_LAYOUTS[project.session.baseVersion as Gen5Version];
  const rows = layout.groups.map((group, groupIndex): TrainerBattleMusicAssignment => {
    const writeOffset = location ? location.tableOffset + groupIndex * 2 : undefined;
    return {
      ...group,
      groupIndex,
      currentSequenceId: writeOffset !== undefined && overlay ? readU16(overlay.data, writeOffset) : undefined,
      writeOffset,
      editable: writeOffset !== undefined,
      fallback: false,
      readOnlyReason: assignmentError,
    };
  });
  const fallbackOffset = location?.normalSequenceOffset;
  rows.push({
    key: "normal-fallback",
    name: "Other trainers (fallback)",
    scope: "Normal trainer classes and any trainer type without a dedicated battle-intro group",
    currentSequenceId: fallbackOffset !== undefined && overlay ? readU16(overlay.data, fallbackOffset) : undefined,
    writeOffset: fallbackOffset,
    editable: fallbackOffset !== undefined,
    fallback: true,
    readOnlyReason: assignmentError,
  });
  return rows;
}

function matchBattleTableAt(
  overlay: TrainerBattleMusicOverlay,
  tableOffset: number,
  tableLength: number,
  effectSignature: readonly number[],
): number | undefined {
  const effectOffset = tableOffset + tableLength;
  if (!bytesMatch(overlay.data, effectOffset, effectSignature)) return undefined;
  const tableAddress = (overlay.ramAddress + tableOffset) >>> 0;
  const effectAddress = (overlay.ramAddress + effectOffset) >>> 0;
  const literalMatches: number[] = [];
  for (let offset = BATTLE_LITERAL_CODE_SIGNATURE.length; offset + 12 <= overlay.data.length; offset += 4) {
    if (readU32(overlay.data, offset) !== tableAddress || readU32(overlay.data, offset + 4) !== effectAddress) continue;
    if (!bytesMatch(overlay.data, offset - BATTLE_LITERAL_CODE_SIGNATURE.length, BATTLE_LITERAL_CODE_SIGNATURE)) continue;
    if (readU16(overlay.data, offset + 10) !== 0) continue;
    literalMatches.push(offset + 8);
    if (literalMatches.length > 1) break;
  }
  return literalMatches.length === 1 ? literalMatches[0] : undefined;
}

function bytesMatch(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset + signature.length > bytes.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function overlayRamAddress(project: ProjectState, rom: NintendoDSRom, overlayId: number): number | undefined {
  const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    if (readU32(table, offset) === overlayId) return readU32(table, offset + 4);
  }
  return undefined;
}
