import { readU16 } from "../nds/binary";
import { repairDecompressedArm9CompressionMetadata } from "../nds/arm9ModuleParams";
import { decompressCode, isCodeCompressed } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import {
  BW2_MESSAGE_BANKS,
  BW2_NARCS,
  BW_MESSAGE_BANKS,
  BW_NARCS,
  GEN4_MESSAGE_BANKS,
  HEADER_NARCS,
  detectVersionInfo,
  gen4NarcDefinitions,
  isGen4BaseRom,
  isGen4Project,
  isGen5BaseRom,
  type BaseRom,
  type Gen4Version,
  type NarcDefinition,
  type NarcName,
  type TextBankSource,
} from "./constants";
import { getNarcFormats } from "./formats";
import { normalizeEncounterFormReferences } from "./encounterModel";
import { parseHeaders } from "./headerModel";
import { MOVE_EFFECT_HANDLER_TABLE_LENGTH, moveEffectHandlerOverlayId, moveEffectHandlerTableOffset } from "./moveEffectHandlerModel";
import { detectPmcInstallFromRom } from "./pmcModel";
import { hydratePwanAnimationsFromRom } from "./pwanAnimationModel";
import { detectWhite2ExpandedRigAtlasPatchState } from "./expandedRigAtlasPatch";
import { createFileStore, createNarcStore, decodeRecord, type ProjectState } from "./projectStore";
import { getStarterOverlayIds } from "./starterModel";
import { cleanDisplayText, decodeGen4TextBank, decodeGen5TextBank, type TextEntry } from "./text";
import {
  BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH,
  TYPE_CHART_ROMFS_PATH,
  createRomFsTypeChartStore,
  createTypeChartStore,
  detectFairyTypeUsage,
} from "./typeChartModel";
import { parseTms } from "./tmModel";
import { BW2_TUTOR_MOVE_OVERLAY_ID, createTutorMoveStore } from "./tutorMoveModel";

export type LoadOptions = {
  fairy?: boolean;
  expandSprites?: boolean;
  selectedNarcs?: NarcName[];
};

export type LoadProgress = (message: string) => void;

export async function loadProjectFromRomFile(file: File, options: LoadOptions = {}, onProgress?: LoadProgress): Promise<ProjectState> {
  if (!file.name.toLowerCase().endsWith(".nds")) throw new Error("Please upload a .nds ROM file");

  await reportLoadProgress(onProgress, "Reading ROM file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return loadProjectFromRomBytes(bytes, file.name, options, onProgress);
}

export async function loadProjectFromRomBytes(bytes: Uint8Array, fileName = "cached-rom.nds", options: LoadOptions = {}, onProgress?: LoadProgress): Promise<ProjectState> {
  const rom = new NintendoDSRom(bytes);
  const compactBytes = rom.save();
  const sourceSha256 = await sha256Hex(bytes);

  await reportLoadProgress(onProgress, "Decompressing ARM9");
  const arm9Compressed = isCodeCompressed(rom.arm9);
  const arm9 = decompressCode(rom.arm9);
  const repairedArm9CompressionMetadata = !arm9Compressed && repairDecompressedArm9CompressionMetadata(arm9);
  const sample = readU16(arm9, 14);
  const version = detectVersionInfo(sample, rom.idCode);
  const formats = getNarcFormats(version.baseRom);
  const project: ProjectState = {
    originalRomBytes: compactBytes,
    session: {
      romName: fileName.replace(/\.nds$/iu, ""),
      generation: version.generation,
      baseVersion: version.baseVersion,
      baseRom: version.baseRom,
      fairy: options.fairy ?? false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: {
      title: rom.name,
      idCode: rom.idCode,
      fileName,
      size: bytes.length,
      sourceSha256,
    },
    arm9,
    arm9Compressed,
    arm9Dirty: repairedArm9CompressionMetadata || undefined,
    rigAtlas: detectRigAtlasSettings(rom, arm9),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats,
    trpokInfo: [],
    docs: {
      romTitle: fileName.replace(/\.nds$/iu, ""),
      trainerLocations: {},
      trainerDiffs: {},
      itemLocations: {},
      groundItemScriptMap: {},
    },
  };
  if (isGen5BaseRom(version.baseRom)) {
    project.codeInjection = detectPmcInstallFromRom(rom);
    hydratePwanAnimationsFromRom(project, rom);
  }

  const selectedNarcs = new Set<NarcName>(options.selectedNarcs ?? []);
  const shouldExtract = (definition: NarcDefinition) => definition.required || selectedNarcs.size === 0 || selectedNarcs.has(definition.name);

  if (isGen4BaseRom(version.baseRom)) {
    await reportLoadProgress(onProgress, "Extracting Gen 4 NARCs");
    extractNarcSet(rom, project, gen4NarcDefinitions(version).filter(shouldExtract));

    await reportLoadProgress(onProgress, "Decoding Gen 4 message banks");
    decodeTextNarcs(project);

    await reportLoadProgress(onProgress, "Indexing trainer metadata");
    indexTrpokInfo(project);

    await reportLoadProgress(onProgress, "Parsing Gen 4 headers");
    project.headers = parseHeaders(project);

    await reportLoadProgress(onProgress, "Parsing TM table");
    project.tms = parseTms(project);
    return project;
  }

  await reportLoadProgress(onProgress, "Extracting header NARCs");
  const headerNarcs = headerDefinitionsFor(version.baseRom).filter(shouldExtract);
  extractNarcSet(rom, project, headerNarcs);

  await reportLoadProgress(onProgress, "Decoding message banks");
  decodeTextNarcs(project);

  await reportLoadProgress(onProgress, "Extracting editor NARCs");
  const editNarcs = [...(version.baseRom === "BW" ? BW_NARCS : BW2_NARCS)].filter(shouldExtract);
  if (options.expandSprites) {
    editNarcs.push({ path: "a/0/0/4", name: "pokemon_sprites" }, { path: "a/0/0/7", name: "pokemon_icons" });
  }
  extractNarcSet(rom, project, editNarcs);
  normalizeEncounterFormReferences(project);
  if (!project.session.fairy && detectFairyTypeUsage(project)) project.session.fairy = true;

  if (selectedNarcs.size === 0 || selectedNarcs.has("grottos") || selectedNarcs.has("moves") || selectedNarcs.has("starter_sprites")) {
    await reportLoadProgress(onProgress, "Extracting overlays");
    extractOverlays(rom, project, selectedNarcs);
  }

  await reportLoadProgress(onProgress, "Indexing trainer metadata");
  indexTrpokInfo(project);

  await reportLoadProgress(onProgress, "Parsing headers");
  project.headers = parseHeaders(project);

  await reportLoadProgress(onProgress, "Parsing TM table");
  project.tms = parseTms(project);

  return project;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.length);
  source.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function reportLoadProgress(onProgress: LoadProgress | undefined, message: string): Promise<void> {
  onProgress?.(message);
  if (!onProgress) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function detectRigAtlasSettings(rom: NintendoDSRom, arm9: Uint8Array): ProjectState["rigAtlas"] {
  const expanded = rom.idCode === "IRDO" && detectWhite2ExpandedRigAtlasPatchState(arm9, rom.arm9RamAddress) === "patched";
  return { width: 256, height: expanded ? 256 : 128, expanded };
}

function headerDefinitionsFor(baseRom: BaseRom): NarcDefinition[] {
  if (baseRom === "BW2") return HEADER_NARCS;
  return HEADER_NARCS.map((definition) => (definition.name === "scripts" ? { ...definition, path: "a/0/5/7" } : definition));
}

function extractNarcSet(rom: NintendoDSRom, project: ProjectState, definitions: NarcDefinition[]): void {
  for (const definition of definitions) {
    try {
      const fileId = rom.fileId(definition.path);
      project.session.fileIds[definition.name] = fileId;
      if (definition.container === "file") {
        project.narcs[definition.name] = createFileStore(definition.name, definition.path, fileId, rom.files[fileId]);
        continue;
      }
      const narc = new NARC(rom.files[fileId]);
      project.narcs[definition.name] = createNarcStore(definition.name, definition.path, fileId, narc);
    } catch (error) {
      if (definition.required) throw error;
      project.session.blacklist.push(definition.name);
    }
  }
}

function tryCreateRomFsTypeChartStore(rom: NintendoDSRom) {
  for (const path of [TYPE_CHART_ROMFS_PATH, BLACK2UPGRADE_TYPE_CHART_ROMFS_PATH]) {
    try {
      const fileId = rom.fileId(path);
      return createRomFsTypeChartStore(fileId, rom.files[fileId], path);
    } catch {
      // Try the other supported expansion layout.
    }
  }
  return undefined;
}

export function refreshDecodedTextState(project: ProjectState): void {
  project.texts = { banks: {} };
  decodeTextNarcs(project);
}

function decodeTextNarcs(project: ProjectState): void {
  const messageStore = project.narcs.message_texts;
  const storyStore = project.narcs.story_texts;
  const decodeBank = isGen4Project(project) ? decodeGen4TextBank : decodeGen5TextBank;
  if (messageStore) {
    project.texts.messageTexts = messageStore.rawFiles.map((data) => {
      try {
        return decodeBank(data);
      } catch {
        return [];
      }
    });
  }
  if (storyStore) {
    project.texts.storyTexts = storyStore.rawFiles.map((data) => {
      try {
        return decodeBank(data);
      } catch {
        return [];
      }
    });
  }

  const messageTexts = project.texts.messageTexts as TextEntry[][] | undefined;
  if (!messageTexts) return;

  const banks = isGen4Project(project) ? GEN4_MESSAGE_BANKS[project.session.baseVersion as Gen4Version] : project.session.baseRom === "BW" ? BW_MESSAGE_BANKS : BW2_MESSAGE_BANKS;
  for (const [source, bankName] of banks) {
    const nameCase = bankName === "pokedex" || bankName === "moves";
    if ((project.texts.banks[bankName]?.length ?? 0) > 0) continue;
    const labels = labelsFromTextBankSource(messageTexts, source).map((entry, index) => {
      const text = entry?.[1] ?? `Entry ${index}`;
      return cleanDisplayText(text, nameCase);
    });
    if (labels.length > 0) project.texts.banks[bankName] = labels;
  }
}

function labelsFromTextBankSource(messageTexts: TextEntry[][], source: TextBankSource): TextEntry[] {
  if (typeof source === "number") return messageTexts[source] ?? [];
  const merged: TextEntry[] = [];
  for (const bankIndex of source) {
    const bank = messageTexts[bankIndex] ?? [];
    bank.forEach((entry, index) => {
      if (!entry) return;
      const existing = merged[index];
      if (!existing || !existing[1]) merged[index] = entry;
    });
    for (const entry of bank.slice(merged.length)) merged.push(entry);
  }
  return merged;
}

function extractOverlays(rom: NintendoDSRom, project: ProjectState, selectedNarcs = new Set<NarcName>()): void {
  const includeAll = selectedNarcs.size === 0;
  const includeGrottos = includeAll || selectedNarcs.has("grottos");
  const includeMoves = includeAll || selectedNarcs.has("moves");
  const includeTutorMoves = includeAll || selectedNarcs.has("moves") || selectedNarcs.has("tutor_moves");
  const includeStarters = includeAll || selectedNarcs.has("starter_sprites");
  const moveEffectOverlayId = moveEffectHandlerOverlayId(project);
  const ids = [
    ...(project.session.baseRom === "BW2" ? [includeGrottos || includeTutorMoves ? BW2_TUTOR_MOVE_OVERLAY_ID : undefined] : []),
    includeMoves ? moveEffectOverlayId : undefined,
    ...(includeStarters ? getStarterOverlayIds(project.session.baseRom) : []),
  ].filter((id): id is number => id !== undefined);
  if (ids.length === 0) return;
  const overlays = rom.loadArm9Overlays(ids);
  for (const [id, overlay] of overlays) project.overlays[id] = overlay.data;

  const moveEffectOverlay = project.overlays[moveEffectOverlayId];
  if (includeMoves && moveEffectOverlay) {
    const effectTableOffset = moveEffectHandlerTableOffset(project);
    project.narcs.move_effects_table = {
      name: "move_effects_table",
      fileId: -1,
      sourcePath: `overlay${moveEffectOverlayId}:move_effects_table`,
      fileCount: 1,
      rawFiles: [moveEffectOverlay.slice(effectTableOffset, effectTableOffset + MOVE_EFFECT_HANDLER_TABLE_LENGTH)],
      records: new Map(),
      dirty: new Set(),
    };
  }

  if (project.session.baseRom === "BW2") {
    const overlay36 = project.overlays[36];
    const overlay167 = project.overlays[167];
    if (includeGrottos && overlay36) {
      const grottoOffset = project.session.baseVersion === "B2" ? 0x00055218 : 0x00055218 - 12;
      project.narcs.grotto_odds = {
        name: "grotto_odds",
        fileId: -1,
        sourcePath: "overlay36:grotto_odds",
        fileCount: 1,
        rawFiles: [overlay36.slice(grottoOffset, grottoOffset + 200)],
        records: new Map(),
        dirty: new Set(),
      };
    }
    if (includeTutorMoves && overlay36) {
      project.narcs.tutor_moves = createTutorMoveStore(overlay36, project.session.baseVersion);
    }
    if (includeMoves) {
      const romFsTypeChart = tryCreateRomFsTypeChartStore(rom);
      if (romFsTypeChart) {
        project.session.fairy = true;
        project.narcs.type_chart = romFsTypeChart;
      } else if (overlay167) {
        project.narcs.type_chart = createTypeChartStore(project, overlay167);
      }
    }
  }
}

function indexTrpokInfo(project: ProjectState): void {
  const trdata = project.narcs.trdata;
  if (!trdata) return;
  project.trpokInfo = trdata.rawFiles.map((_bytes, id) => {
    const record = decodeRecord(project, "trdata", id);
    return {
      template: Number(record.raw?.template ?? 0),
      numPokemon: Number(record.raw?.num_pokemon ?? 0),
    };
  });
}
