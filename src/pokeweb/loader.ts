import { readU16 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import {
  BW2_MESSAGE_BANKS,
  BW2_NARCS,
  BW_MESSAGE_BANKS,
  BW_NARCS,
  HEADER_NARCS,
  VERSION_BY_ARM9_SAMPLE,
  type BaseRom,
  type NarcDefinition,
  type NarcName,
} from "./constants";
import { getNarcFormats } from "./formats";
import { parseHeaders } from "./headerModel";
import { MOVE_EFFECT_HANDLER_TABLE_LENGTH, moveEffectHandlerOverlayId, moveEffectHandlerTableOffset } from "./moveEffectHandlerModel";
import { detectPmcInstallFromRom } from "./pmcModel";
import { detectWhite2ExpandedRigAtlasPatchState } from "./expandedRigAtlasPatch";
import { createNarcStore, decodeRecord, type ProjectState } from "./projectStore";
import { getStarterOverlayIds } from "./starterModel";
import { cleanDisplayText, decodeGen5TextBank } from "./text";
import { parseTms } from "./tmModel";

export type LoadOptions = {
  fairy?: boolean;
  expandSprites?: boolean;
  selectedNarcs?: NarcName[];
};

export type LoadProgress = (message: string) => void;

export async function loadProjectFromRomFile(file: File, options: LoadOptions = {}, onProgress?: LoadProgress): Promise<ProjectState> {
  if (!file.name.toLowerCase().endsWith(".nds")) throw new Error("Please upload a .nds ROM file");

  onProgress?.("Reading ROM file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rom = new NintendoDSRom(bytes);
  const compactBytes = rom.save();

  onProgress?.("Decompressing ARM9");
  const arm9 = decompressCode(rom.arm9);
  const sample = readU16(arm9, 14);
  const version = VERSION_BY_ARM9_SAMPLE[sample] ?? { baseVersion: "W2" as const, baseRom: "BW2" as const };
  const formats = getNarcFormats(version.baseRom);
  const project: ProjectState = {
    originalRomBytes: compactBytes,
    session: {
      romName: file.name.replace(/\.nds$/iu, ""),
      baseVersion: version.baseVersion,
      baseRom: version.baseRom,
      fairy: options.fairy ?? false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: {
      title: rom.name,
      idCode: rom.idCode,
      fileName: file.name,
      size: bytes.length,
    },
    arm9,
    rigAtlas: detectRigAtlasSettings(rom, arm9),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats,
    trpokInfo: [],
    docs: {
      romTitle: file.name.replace(/\.nds$/iu, ""),
      trainerLocations: {},
      trainerDiffs: {},
      itemLocations: {},
      groundItemScriptMap: {},
    },
  };
  project.codeInjection = detectPmcInstallFromRom(rom);

  onProgress?.("Extracting header NARCs");
  const selectedNarcs = new Set<NarcName>(options.selectedNarcs ?? []);
  const shouldExtract = (definition: NarcDefinition) => definition.required || selectedNarcs.size === 0 || selectedNarcs.has(definition.name);

  const headerNarcs = headerDefinitionsFor(version.baseRom).filter(shouldExtract);
  extractNarcSet(rom, project, headerNarcs);

  onProgress?.("Decoding message banks");
  decodeTextNarcs(project);

  onProgress?.("Extracting editor NARCs");
  const editNarcs = [...(version.baseRom === "BW" ? BW_NARCS : BW2_NARCS)].filter(shouldExtract);
  if (options.expandSprites) {
    editNarcs.push({ path: "a/0/0/4", name: "pokemon_sprites" }, { path: "a/0/0/7", name: "pokemon_icons" });
  }
  extractNarcSet(rom, project, editNarcs);

  if (selectedNarcs.size === 0 || selectedNarcs.has("grottos") || selectedNarcs.has("moves") || selectedNarcs.has("starter_sprites")) {
    onProgress?.("Extracting overlays");
    extractOverlays(rom, project, selectedNarcs);
  }

  onProgress?.("Indexing trainer metadata");
  indexTrpokInfo(project);

  onProgress?.("Parsing headers");
  project.headers = parseHeaders(project);

  onProgress?.("Parsing TM table");
  project.tms = parseTms(project);

  return project;
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
      const narc = new NARC(rom.files[fileId]);
      project.narcs[definition.name] = createNarcStore(definition.name, definition.path, fileId, narc);
    } catch (error) {
      if (definition.required) throw error;
      project.session.blacklist.push(definition.name);
    }
  }
}

function decodeTextNarcs(project: ProjectState): void {
  const messageStore = project.narcs.message_texts;
  const storyStore = project.narcs.story_texts;
  if (messageStore) {
    project.texts.messageTexts = messageStore.rawFiles.map((data) => {
      try {
        return decodeGen5TextBank(data);
      } catch {
        return [];
      }
    });
  }
  if (storyStore) {
    project.texts.storyTexts = storyStore.rawFiles.map((data) => {
      try {
        return decodeGen5TextBank(data);
      } catch {
        return [];
      }
    });
  }

  const messageTexts = project.texts.messageTexts as ReturnType<typeof decodeGen5TextBank>[] | undefined;
  if (!messageTexts) return;

  const banks = project.session.baseRom === "BW" ? BW_MESSAGE_BANKS : BW2_MESSAGE_BANKS;
  for (const [bankIndex, bankName] of banks) {
    const nameCase = bankName === "pokedex" || bankName === "moves";
    project.texts.banks[bankName] = (messageTexts[bankIndex] ?? []).map((entry, index) => {
      const text = entry?.[1] ?? `Entry ${index}`;
      return cleanDisplayText(text, nameCase);
    });
  }
}

function extractOverlays(rom: NintendoDSRom, project: ProjectState, selectedNarcs = new Set<NarcName>()): void {
  const includeAll = selectedNarcs.size === 0;
  const includeGrottos = includeAll || selectedNarcs.has("grottos");
  const includeMoves = includeAll || selectedNarcs.has("moves");
  const includeStarters = includeAll || selectedNarcs.has("starter_sprites");
  const moveEffectOverlayId = moveEffectHandlerOverlayId(project);
  const ids = [
    ...(project.session.baseRom === "BW2" ? [includeGrottos ? 36 : undefined] : []),
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
    if (includeMoves && overlay167) {
      project.narcs.type_chart = {
        name: "type_chart",
        fileId: -1,
        sourcePath: "overlay167:type_chart",
        fileCount: 1,
        rawFiles: [overlay167.slice(0x0003dc40, 0x0003dc40 + 17 * 17)],
        records: new Map(),
        dirty: new Set(),
      };
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
