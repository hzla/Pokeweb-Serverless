import { zipSync } from "fflate";
import { readU16, writeU16 } from "../nds/binary";
import { recordFieldChange } from "./actionChangelog";
import { isGen5Project, type Gen5Version } from "./constants";
import {
  extractNitroSequenceAssets,
  loadNitroSdatFromProject,
  type NitroSdat,
} from "./nitroSound";
import type { ProjectState } from "./projectStore";

const BW_TRAINER_CLASS_COUNT = 105;
const BW2_TRAINER_CLASS_COUNT = 236;
const BW_FALLBACK_SEQUENCE_ID = 1114;
const MISSING_SEQUENCE_ID = 0xffff;

const TRAINER_MUSIC_TABLE_OFFSETS: Record<Gen5Version, number> = {
  B: 0xa35a8,
  W: 0xa35c8,
  B2: 0x8e394,
  W2: 0x8e3c0,
};

/**
 * Black/White's sparse trainer-class mapping, transcribed from
 * swan_export/resource/trtype_bgm/trtype_bgm.cdat. Order is part of the
 * masked ARM9 signature; sequence values are defaults, not signature bytes.
 */
export const BW_TRAINER_EYE_SOURCE_MAPPING: ReadonlyArray<readonly [trainerClassId: number, sequenceId: number]> = [
  [2, 1114],
  [3, 1115],
  [4, 1114],
  [5, 1115],
  [50, 1117],
  [49, 1117],
  [70, 1117],
  [71, 1117],
  [25, 1117],
  [24, 1117],
  [18, 1119],
  [17, 1114],
  [46, 1122],
  [52, 1122],
  [42, 1115],
  [41, 1114],
  [75, 1126],
  [76, 1126],
  [51, 1121],
  [64, 1121],
  [60, 1123],
  [59, 1123],
  [29, 1124],
  [91, 1120],
  [90, 1120],
  [85, 1119],
  [84, 1120],
  [6, 1124],
  [73, 1124],
  [53, 1124],
  [7, 1124],
  [43, 1125],
  [44, 1125],
  [26, 1125],
  [34, 1125],
  [13, 1119],
  [66, 1125],
  [48, 1119],
  [67, 1125],
  [58, 1125],
  [27, 1124],
  [28, 1124],
  [61, 1125],
  [62, 1125],
  [35, 1121],
  [36, 1121],
  [83, 1125],
  [57, 1118],
  [72, 1121],
  [31, 1118],
  [30, 1123],
  [32, 1123],
  [33, 1126],
  [86, 1125],
  [87, 1126],
  [65, 1119],
  [74, 1124],
  [16, 1116],
  [63, 1118],
  [68, 1123],
  [69, 1123],
  [39, 1127],
  [77, 1127],
  [45, 1124],
  [15, 1116],
  [14, 1116],
  [8, 1125],
  [9, 1125],
];

/**
 * Non-music byte 0 from each verified Black 2/White 2 four-byte record.
 * This is deliberately separate from trainer sprite routing: special classes
 * use different metadata here. Byte 1 is validated as the 0/1 gender field.
 */
export const BW2_TRAINER_MUSIC_METADATA_SIGNATURE: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 40, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
  63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 71, 4, 70, 74,
  75, 69, 42, 41, 91, 40, 92, 93, 51, 73, 35, 36, 69, 70, 49, 48, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107,
  108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 17, 17, 18, 18, 24, 24, 25,
  25, 87, 87, 49, 49, 48, 48, 69, 69, 70, 70, 92, 92, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
  144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 148, 73, 97, 155, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166,
  167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 50, 63, 46, 43, 186, 32, 187, 148,
];

export type TrainerEyeTheme = {
  sequenceId: number;
  symbol: string;
  displayName: string;
};

export type TrainerMusicClassAssignment = {
  trainerClassId: number;
  trainerClassName: string;
  currentSequenceId?: number;
  effectiveSequenceId?: number;
  writeOffset?: number;
  editable: boolean;
  fallback: boolean;
  readOnlyReason?: string;
};

export type TrainerMusicTableLocation = {
  format: "bw-sparse" | "bw2-records";
  offset: number;
  source: "canonical" | "signature-scan";
};

export type TrainerMusicModel = {
  project: ProjectState;
  sdat: NitroSdat;
  themes: TrainerEyeTheme[];
  assignments: TrainerMusicClassAssignment[];
  tableLocation?: TrainerMusicTableLocation;
  assignmentError?: string;
};

export async function loadTrainerMusicModel(project: ProjectState): Promise<TrainerMusicModel> {
  return createTrainerMusicModel(project, await loadNitroSdatFromProject(project));
}

export function createTrainerMusicModel(project: ProjectState, sdat: NitroSdat): TrainerMusicModel {
  if (!isGen5Project(project)) throw new Error("Trainer Music currently supports Pokémon Black, White, Black 2, and White 2 only.");
  const themes = buildTrainerEyeThemes(project, sdat);
  let tableLocation: TrainerMusicTableLocation | undefined;
  let assignmentError: string | undefined;
  try {
    tableLocation = locateTrainerMusicTable(project);
  } catch (error) {
    assignmentError = error instanceof Error ? error.message : String(error);
  }
  return {
    project,
    sdat,
    themes,
    assignments: buildTrainerMusicAssignments(project, tableLocation, assignmentError),
    tableLocation,
    assignmentError,
  };
}

export function buildTrainerEyeThemes(project: ProjectState, sdat: NitroSdat): TrainerEyeTheme[] {
  const sequenceIds = trainerEyeSequenceIds(project);
  const missing = sequenceIds.filter((sequenceId) => !sdat.sequenceInfos[sequenceId]);
  if (missing.length > 0) throw new Error(`The ROM's SDAT is missing Trainer Eye sequence${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  return sequenceIds.map((sequenceId) => {
    const symbol = sdat.sequenceInfos[sequenceId]?.symbol || sdat.sequenceSymbols[sequenceId] || fallbackThemeSymbol(project, sequenceId);
    return { sequenceId, symbol, displayName: displayNameForTrainerMusicSymbol(symbol, sequenceId) };
  });
}

export function locateTrainerMusicTable(project: ProjectState): TrainerMusicTableLocation {
  if (!isGen5Project(project)) throw new Error("Trainer Music ARM9 tables are only available in Gen 5 ROMs.");
  const version = project.session.baseVersion as Gen5Version;
  const canonicalOffset = TRAINER_MUSIC_TABLE_OFFSETS[version];
  const matches = project.session.baseRom === "BW" ? matchesBwTable.bind(undefined, project.arm9) : matchesBw2Table.bind(undefined, project);
  const byteLength = project.session.baseRom === "BW" ? (BW_TRAINER_EYE_SOURCE_MAPPING.length + 1) * 4 : BW2_TRAINER_CLASS_COUNT * 4;
  const candidates: number[] = [];
  if (matches(canonicalOffset)) candidates.push(canonicalOffset);
  for (let offset = 0; offset <= project.arm9.length - byteLength; offset += 4) {
    if (offset === canonicalOffset) continue;
    if (matches(offset)) candidates.push(offset);
    if (candidates.length > 1) break;
  }
  if (candidates.length === 0) {
    throw new Error("Pokeweb could not locate a supported Trainer Music table in this ARM9. Reassignment is disabled to protect the ROM.");
  }
  if (candidates.length > 1) {
    throw new Error("Pokeweb found multiple possible Trainer Music tables in this ARM9. Reassignment is disabled because the target is ambiguous.");
  }
  return {
    format: project.session.baseRom === "BW" ? "bw-sparse" : "bw2-records",
    offset: candidates[0],
    source: candidates[0] === canonicalOffset ? "canonical" : "signature-scan",
  };
}

export function assignTrainerEyeTheme(
  project: ProjectState,
  model: TrainerMusicModel,
  assignment: TrainerMusicClassAssignment,
  sequenceId: number,
): void {
  const theme = model.themes.find((candidate) => candidate.sequenceId === sequenceId);
  if (!theme) throw new Error(`Sequence ${sequenceId} is not an assignable Trainer Eye theme for this game.`);
  if (!assignment.editable || assignment.writeOffset === undefined) {
    throw new Error(assignment.readOnlyReason || `Trainer class ${assignment.trainerClassId} is read-only.`);
  }
  if (assignment.writeOffset < 0 || assignment.writeOffset + 2 > project.arm9.length) throw new Error("Trainer Music write offset is outside the ARM9.");
  const beforeId = readU16(project.arm9, assignment.writeOffset);
  if (beforeId === sequenceId) return;
  writeU16(project.arm9, assignment.writeOffset, sequenceId);
  project.arm9Dirty = true;
  assignment.currentSequenceId = sequenceId;
  assignment.effectiveSequenceId = sequenceId;
  assignment.fallback = false;
  recordFieldChange(
    project,
    "trainer_music",
    `${assignment.trainerClassName} (Class ${assignment.trainerClassId})`,
    "Approach theme",
    trainerMusicTrackLabel(model, beforeId),
    theme.displayName,
    { key: `trainer-music:${assignment.trainerClassId}` },
  );
}

export function trainerMusicTrackLabel(model: TrainerMusicModel, sequenceId: number | undefined): string {
  if (sequenceId === undefined || sequenceId === MISSING_SEQUENCE_ID) return "Unavailable";
  const theme = model.themes.find((candidate) => candidate.sequenceId === sequenceId);
  if (theme) return theme.displayName;
  const sequence = model.sdat.sequenceInfos[sequenceId];
  const symbol = sequence?.symbol || model.sdat.sequenceSymbols[sequenceId];
  return symbol ? `${displayNameForTrainerMusicSymbol(symbol, sequenceId)} (unsupported)` : `Sequence ${sequenceId} (unsupported)`;
}

export function trainerMusicExportBaseName(model: Pick<TrainerMusicModel, "sdat">, sequenceId: number, displayName?: string): string {
  const label = (displayName ?? trainerMusicSequenceLabel(model.sdat, sequenceId)).replace(/\s+\(unsupported\)$/u, "");
  return `${fileSlug(label)}-sequence-${String(sequenceId).padStart(4, "0")}`;
}

export function buildTrainerMusicNativeZip(
  model: Pick<TrainerMusicModel, "project" | "sdat">,
  sequenceId: number,
  displayName?: string,
): Uint8Array {
  const assets = extractNitroSequenceAssets(model.sdat, sequenceId);
  const sequenceFileName = nativeAssetName("sequence", assets.sequence.id, assets.sequence.symbol, "sseq");
  const bankFileName = nativeAssetName("bank", assets.bank.id, assets.bank.symbol, "sbnk");
  const waveFiles = assets.waveArchives.map((archive) => ({
    archive,
    fileName: `wave-archives/${nativeAssetName("wave", archive.id, archive.symbol, "swar")}`,
  }));
  const metadata = {
    format: "pokeweb-trainer-music",
    formatVersion: 1,
    gameVersion: model.project.session.baseVersion,
    sourceSdat: model.sdat.sourcePath ?? null,
    track: {
      sequenceId,
      symbol: assets.sequence.symbol ?? null,
      displayName: displayName ?? trainerMusicSequenceLabel(model.sdat, sequenceId),
    },
    sequence: { id: assets.sequence.id, fileId: assets.sequence.fileId, symbol: assets.sequence.symbol ?? null, file: sequenceFileName },
    bank: { id: assets.bank.id, fileId: assets.bank.fileId, symbol: assets.bank.symbol ?? null, file: bankFileName },
    waveArchives: waveFiles.map(({ archive, fileName }) => ({
      id: archive.id,
      fileId: archive.fileId,
      symbol: archive.symbol ?? null,
      file: fileName,
    })),
  };
  const files: Record<string, Uint8Array> = {
    [sequenceFileName]: assets.sequence.bytes,
    [bankFileName]: assets.bank.bytes,
    "metadata.json": new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`),
  };
  for (const { archive, fileName } of waveFiles) files[fileName] = archive.bytes;
  return zipSync(files, { level: 6 });
}

function trainerEyeSequenceIds(project: ProjectState): number[] {
  const ids = Array.from({ length: 14 }, (_unused, index) => 1114 + index);
  if (project.session.baseRom === "BW2") ids.push(1243, 1244);
  return ids;
}

function buildTrainerMusicAssignments(
  project: ProjectState,
  location: TrainerMusicTableLocation | undefined,
  assignmentError: string | undefined,
): TrainerMusicClassAssignment[] {
  const classNames = project.texts.banks.tr_classes ?? [];
  if (project.session.baseRom === "BW") {
    const mappingIndex = new Map(BW_TRAINER_EYE_SOURCE_MAPPING.map(([trainerClassId], index) => [trainerClassId, index]));
    return Array.from({ length: BW_TRAINER_CLASS_COUNT }, (_unused, trainerClassId) => {
      const entryIndex = mappingIndex.get(trainerClassId);
      const writeOffset = entryIndex === undefined || !location ? undefined : location.offset + entryIndex * 4 + 2;
      const fallback = entryIndex === undefined;
      const currentSequenceId = writeOffset === undefined ? undefined : readU16(project.arm9, writeOffset);
      return {
        trainerClassId,
        trainerClassName: classNames[trainerClassId] || `Trainer Class ${trainerClassId}`,
        currentSequenceId,
        effectiveSequenceId: fallback ? BW_FALLBACK_SEQUENCE_ID : currentSequenceId,
        writeOffset,
        editable: writeOffset !== undefined,
        fallback,
        readOnlyReason: fallback
          ? "Black/White has no explicit entry for this class; the game falls back to Eye 01. Sparse-table expansion is outside this release."
          : assignmentError,
      };
    });
  }

  return Array.from({ length: BW2_TRAINER_CLASS_COUNT }, (_unused, trainerClassId) => {
    const writeOffset = location ? location.offset + trainerClassId * 4 + 2 : undefined;
    const currentSequenceId = writeOffset === undefined ? undefined : readU16(project.arm9, writeOffset);
    return {
      trainerClassId,
      trainerClassName: classNames[trainerClassId] || `Trainer Class ${trainerClassId}`,
      currentSequenceId,
      effectiveSequenceId: currentSequenceId,
      writeOffset,
      editable: writeOffset !== undefined,
      fallback: false,
      readOnlyReason: assignmentError,
    };
  });
}

function matchesBwTable(arm9: Uint8Array, offset: number): boolean {
  const byteLength = (BW_TRAINER_EYE_SOURCE_MAPPING.length + 1) * 4;
  if (!Number.isInteger(offset) || offset < 0 || offset + byteLength > arm9.length) return false;
  for (let index = 0; index < BW_TRAINER_EYE_SOURCE_MAPPING.length; index += 1) {
    if (readU16(arm9, offset + index * 4) !== BW_TRAINER_EYE_SOURCE_MAPPING[index][0]) return false;
  }
  const terminatorOffset = offset + BW_TRAINER_EYE_SOURCE_MAPPING.length * 4;
  return readU16(arm9, terminatorOffset) === BW_TRAINER_CLASS_COUNT && readU16(arm9, terminatorOffset + 2) === 0;
}

function matchesBw2Table(project: ProjectState, offset: number): boolean {
  const byteLength = BW2_TRAINER_CLASS_COUNT * 4;
  if (!Number.isInteger(offset) || offset < 0 || offset + byteLength > project.arm9.length) return false;
  for (let trainerClassId = 0; trainerClassId < BW2_TRAINER_CLASS_COUNT; trainerClassId += 1) {
    const recordOffset = offset + trainerClassId * 4;
    if (project.arm9[recordOffset] !== BW2_TRAINER_MUSIC_METADATA_SIGNATURE[trainerClassId]) return false;
    if (project.arm9[recordOffset + 1] > 1) return false;
  }
  return true;
}

function fallbackThemeSymbol(project: ProjectState, sequenceId: number): string {
  if (sequenceId >= 1114 && sequenceId <= 1126) return `SEQ_BGM_EYE_${String(sequenceId - 1113).padStart(2, "0")}`;
  if (sequenceId === 1127) return project.session.baseRom === "BW2" ? "SEQ_BGM_EYE_NEO_PLASMA" : "SEQ_BGM_EYE_PLASMA";
  if (sequenceId === 1243) return "SEQ_BGM_EYE_DANCER";
  if (sequenceId === 1244) return "SEQ_BGM_EYE_CLOWN";
  return `SEQ_${sequenceId}`;
}

export function displayNameForTrainerMusicSymbol(symbol: string, sequenceId: number): string {
  const knownName = TRAINER_MUSIC_SYMBOL_NAMES[symbol];
  if (knownName) return knownName;
  const normalized = symbol.replace(/^SEQ_/u, "").replace(/^BGM_/u, "").replace(/_+/gu, " ").trim();
  if (!normalized) return `Sequence ${sequenceId}`;
  return normalized
    .split(" ")
    .map((part) => (/^\d+$/u.test(part) ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`))
    .join(" ");
}

const TRAINER_MUSIC_SYMBOL_NAMES: Readonly<Record<string, string>> = {
  SEQ_BGM_VS_NORAPOKE: "VS Wild Pokémon",
  SEQ_BGM_VS_TSUYOPOKE: "VS Strong Wild Pokémon",
  SEQ_BGM_VS_TRAINER: "VS Trainer",
  SEQ_BGM_VS_SUBWAY_TRAINER: "VS Battle Subway Trainer",
  SEQ_BGM_VS_GYMLEADER: "VS Gym Leader",
  SEQ_BGM_VS_RIVAL: "VS Rival",
  SEQ_BGM_VS_PLASMA: "VS Team Plasma",
  SEQ_BGM_VS_NEO_PLASMA: "VS Team Plasma",
  SEQ_BGM_VS_ELITE_PLASMA: "VS Team Plasma Elite",
  SEQ_BGM_VS_SHITENNO: "VS Elite Four",
  SEQ_BGM_VS_CHAMP: "VS Champion",
  SEQ_BGM_VS_G_CIS: "VS Ghetsis",
  SEQ_BGM_VS_NEW_G_CIS: "VS Ghetsis",
  SEQ_BGM_VS_SHIRONA: "VS Cynthia",
  SEQ_BGM_VS_SWAN_N: "VS N",
  SEQ_BGM_VS_ACHROMA: "VS Colress",
  SEQ_BGM_VS_IRIS: "VS Champion Iris",
  SEQ_BGM_VS_BANJIROU: "VS Benga",
  SEQ_BGM_VS_HUE: "VS Hugh",
  SEQ_BGM_VS_WBT: "VS Pokémon World Tournament",
  SEQ_BGM_VS_DP_LEGEND: "VS Sinnoh Legendary Pokémon",
  SEQ_BGM_VS_DPLEGEND: "VS Sinnoh Legendary Pokémon",
};

export function trainerMusicSequenceLabel(sdat: NitroSdat, sequenceId: number | undefined): string {
  if (sequenceId === undefined || sequenceId === MISSING_SEQUENCE_ID) return "Unavailable";
  const sequence = sdat.sequenceInfos[sequenceId];
  const symbol = sequence?.symbol || sdat.sequenceSymbols[sequenceId];
  return symbol ? displayNameForTrainerMusicSymbol(symbol, sequenceId) : `Sequence ${sequenceId}`;
}

function nativeAssetName(prefix: string, id: number, symbol: string | undefined, extension: string): string {
  const suffix = fileSlug(symbol || `${prefix}-${id}`);
  return `${prefix}-${String(id).padStart(4, "0")}-${suffix}.${extension}`;
}

function fileSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "trainer-music";
}
