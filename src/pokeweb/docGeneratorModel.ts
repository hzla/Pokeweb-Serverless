import vanillaAbilitiesText from "../assets/data/vanilla_abilities.txt?raw";
import vanillaItemsText from "../assets/data/vanilla_items.txt?raw";
import vanillaMovesText from "../assets/data/vanilla_moves.txt?raw";
import vanillaPokedexText from "../assets/data/vanilla_pokedex.txt?raw";
import { readU16, readU32 } from "../nds/binary";
import {
  BATTLE_TYPES,
  CATEGORIES,
  ENCOUNTER_GRASS_FIELDS,
  ENCOUNTER_GRASS_PERCENTAGES,
  ENCOUNTER_SEASONS,
  ENCOUNTER_WATER_FIELDS,
  ENCOUNTER_WATER_PERCENTAGES,
  isGen4Project,
  TYPES,
} from "./constants";
import { cascadeWhitePersonalName, cascadeWhiteTrainerAbilityName } from "./cascadeWhiteModel";
import { getEncounterCount, getEncounterRecord } from "./encounterModel";
import { parseGen5ScriptEncounters, type Gen5ScriptEncounter } from "./gen5ScriptEncounterModel";
import { parseHeaders } from "./headerModel";
import { getMartCount, getMartRecord } from "./martGrottoModel";
import { getItemCount, getItemRecord, getMoveCount, getMoveRecord } from "./moveItemModel";
import { pokemonFormSuffix } from "./pokemonFormLabels";
import { getPokemonCount, getPokemonRecord, getPokemonSummaryRecord, type PokemonSummaryRecord } from "./pokemonModel";
import { decodeRecord, type DocGeneratorState, type ProjectState, type ReadableRecord } from "./projectStore";
import { getTextBank } from "./textModel";
import {
  TYPE_CHART_OVERLAY_ID,
  TYPE_CHART_VANILLA_TYPE_COUNT,
  getTypeChart,
  getTypeChartTypes,
  type TypeEffectivenessValue,
} from "./typeChartModel";
import { getAutofilledTrainerPokemonMoveIds, getTrainerCount, getTrainerRecord, resolveTrainerPokemonGender, type TrainerRecord, type TrainerPokemonSlot } from "./trainerModel";

export type TextDownloadFile = {
  filename: string;
  contents: string;
  mimeType: string;
};

export type BinaryDownloadFile = {
  filename: string;
  contents: Uint8Array;
  mimeType: string;
};

export type DownloadFile = TextDownloadFile | BinaryDownloadFile;

export type EnrichmentResult = {
  count: number;
  message: string;
};

export type CalcBridgeConfig = {
  gen: 5;
  damageGen: 5;
  typeChart: 5;
  critGen: 5;
  switchIn: 5;
  gameSwitchIn: 5;
  sourceType: "full";
  baseGame: "BW";
  mechanics: "vanilla";
  customPoks: true;
};

export type CalcBridgePayload = {
  type: "ddex:calc-sync";
  config: CalcBridgeConfig;
  fileName: string;
  sourceGen: 5;
  scriptText: string;
  title: string;
};

type SearchCollection = Record<string, { name?: string; types?: string[]; type?: string; t?: string }>;
type DexEncounterSlot = { s: string; mn: number; mx?: number };
type DexEncounterSection = { name?: string; rates: number[]; encs: DexEncounterSlot[] };
type DexLocationRecord = { name: string; wilds: string[] } & Record<string, string | string[] | DexEncounterSection>;
type CalcTypeChart = Record<string, Record<string, number>>;

const USER_STAT_EFFECT_CATEGORY = "Raise user stats";
const TARGET_STAT_EFFECT_CATEGORIES = new Set(["Target Stat Changing", "Lowering Target's Stat along Attack"]);
const USER_TARGETS = new Set(["User", "User's party", "User's side of field"]);
const NON_BATTLER_TARGETS = new Set(["Entire Field", "Field Itself", "Opponent's side of field", "User's party", "User's side of field"]);

export const GEN5_CALC_BRIDGE_CONFIG: CalcBridgeConfig = {
  gen: 5,
  damageGen: 5,
  typeChart: 5,
  critGen: 5,
  switchIn: 5,
  gameSwitchIn: 5,
  sourceType: "full",
  baseGame: "BW",
  mechanics: "vanilla",
  customPoks: true,
};

const SHOWDOWN_SUBS: Record<string, string> = {
  Bubblebeam: "Bubble Beam",
  Doubleslap: "Double Slap",
  Solarbeam: "Solar Beam",
  Sonicboom: "Sonic Boom",
  Poisonpowder: "Poison Powder",
  Thunderpunch: "Thunder Punch",
  Thundershock: "Thunder Shock",
  Ancientpower: "Ancient Power",
  Extremespeed: "Extreme Speed",
  Dragonbreath: "Dragon Breath",
  Dynamicpunch: "Dynamic Punch",
  Grasswhistle: "Grass Whistle",
  "Faint Attack": "Feint Attack",
  Smellingsalt: "Smelling Salts",
  "Roar Of Time": "Roar of Time",
  "U-Turn": "U-turn",
  "V-Create": "V-create",
  "Sand-Attack": "Sand Attack",
  Selfdestruct: "Self-Destruct",
  Softboiled: "Soft-Boiled",
  Vicegrip: "Vise Grip",
  "Hi Jump Kick": "High Jump Kick",
};

const SHOWDOWN_ITEM_SUBS: Record<string, string> = {
  BlackGlasses: "Black Glasses",
  BrightPowder: "Bright Powder",
  NeverMeltIce: "Never-Melt Ice",
  SilverPowder: "Silver Powder",
  TwistedSpoon: "Twisted Spoon",
};

const VANILLA = {
  pokedex: lines(vanillaPokedexText),
  moves: lines(vanillaMovesText),
  abilities: lines(vanillaAbilitiesText),
  items: lines(vanillaItemsText),
};

const STANDARD_TYPE_MATCHUPS: Array<[string, string, TypeEffectivenessValue]> = [
  ["Normal", "Rock", 2],
  ["Normal", "Ghost", 0],
  ["Normal", "Steel", 2],
  ["Fighting", "Normal", 8],
  ["Fighting", "Flying", 2],
  ["Fighting", "Poison", 2],
  ["Fighting", "Rock", 8],
  ["Fighting", "Bug", 2],
  ["Fighting", "Ghost", 0],
  ["Fighting", "Steel", 8],
  ["Fighting", "Psychic", 2],
  ["Fighting", "Ice", 8],
  ["Fighting", "Dark", 8],
  ["Fighting", "Fairy", 2],
  ["Flying", "Fighting", 8],
  ["Flying", "Rock", 2],
  ["Flying", "Bug", 8],
  ["Flying", "Steel", 2],
  ["Flying", "Grass", 8],
  ["Flying", "Electric", 2],
  ["Poison", "Poison", 2],
  ["Poison", "Ground", 2],
  ["Poison", "Rock", 2],
  ["Poison", "Ghost", 2],
  ["Poison", "Steel", 0],
  ["Poison", "Grass", 8],
  ["Poison", "Fairy", 8],
  ["Ground", "Flying", 0],
  ["Ground", "Poison", 8],
  ["Ground", "Rock", 8],
  ["Ground", "Bug", 2],
  ["Ground", "Steel", 8],
  ["Ground", "Fire", 8],
  ["Ground", "Grass", 2],
  ["Ground", "Electric", 8],
  ["Rock", "Fighting", 2],
  ["Rock", "Flying", 8],
  ["Rock", "Ground", 2],
  ["Rock", "Bug", 8],
  ["Rock", "Steel", 2],
  ["Rock", "Fire", 8],
  ["Rock", "Ice", 8],
  ["Bug", "Fighting", 2],
  ["Bug", "Flying", 2],
  ["Bug", "Poison", 2],
  ["Bug", "Ghost", 2],
  ["Bug", "Steel", 2],
  ["Bug", "Fire", 2],
  ["Bug", "Grass", 8],
  ["Bug", "Psychic", 8],
  ["Bug", "Dark", 8],
  ["Bug", "Fairy", 2],
  ["Ghost", "Normal", 0],
  ["Ghost", "Ghost", 8],
  ["Ghost", "Steel", 2],
  ["Ghost", "Psychic", 8],
  ["Ghost", "Dark", 2],
  ["Steel", "Rock", 8],
  ["Steel", "Steel", 2],
  ["Steel", "Fire", 2],
  ["Steel", "Water", 2],
  ["Steel", "Electric", 2],
  ["Steel", "Ice", 8],
  ["Steel", "Fairy", 8],
  ["Fire", "Rock", 2],
  ["Fire", "Bug", 8],
  ["Fire", "Steel", 8],
  ["Fire", "Fire", 2],
  ["Fire", "Water", 2],
  ["Fire", "Grass", 8],
  ["Fire", "Ice", 8],
  ["Fire", "Dragon", 2],
  ["Water", "Ground", 8],
  ["Water", "Rock", 8],
  ["Water", "Fire", 8],
  ["Water", "Water", 2],
  ["Water", "Grass", 2],
  ["Water", "Dragon", 2],
  ["Grass", "Flying", 2],
  ["Grass", "Poison", 2],
  ["Grass", "Ground", 8],
  ["Grass", "Rock", 8],
  ["Grass", "Bug", 2],
  ["Grass", "Steel", 2],
  ["Grass", "Fire", 2],
  ["Grass", "Water", 8],
  ["Grass", "Grass", 2],
  ["Grass", "Dragon", 2],
  ["Electric", "Flying", 8],
  ["Electric", "Ground", 0],
  ["Electric", "Water", 8],
  ["Electric", "Grass", 2],
  ["Electric", "Electric", 2],
  ["Electric", "Dragon", 2],
  ["Psychic", "Fighting", 8],
  ["Psychic", "Poison", 8],
  ["Psychic", "Steel", 2],
  ["Psychic", "Psychic", 2],
  ["Psychic", "Dark", 0],
  ["Ice", "Flying", 8],
  ["Ice", "Ground", 8],
  ["Ice", "Steel", 2],
  ["Ice", "Fire", 2],
  ["Ice", "Water", 2],
  ["Ice", "Grass", 8],
  ["Ice", "Ice", 2],
  ["Ice", "Dragon", 8],
  ["Dragon", "Steel", 2],
  ["Dragon", "Dragon", 8],
  ["Dragon", "Fairy", 0],
  ["Dark", "Fighting", 2],
  ["Dark", "Ghost", 8],
  ["Dark", "Steel", 2],
  ["Dark", "Psychic", 8],
  ["Dark", "Dark", 2],
  ["Dark", "Fairy", 2],
  ["Fairy", "Fighting", 8],
  ["Fairy", "Poison", 2],
  ["Fairy", "Steel", 2],
  ["Fairy", "Fire", 2],
  ["Fairy", "Dragon", 8],
  ["Fairy", "Dark", 8],
];

const STANDARD_GEN5_TYPE_CHART_BYTES = buildStandardTypeChartBytes(TYPES.slice(0, TYPE_CHART_VANILLA_TYPE_COUNT), false);
const STANDARD_GEN6_TYPE_CHART_BYTES = buildStandardTypeChartBytes(TYPES, true);

const SPECIAL_FIXED_PERSONAL_NAMES: Record<number, string> = {
  29: "Nidoran-F",
  32: "Nidoran-M",
  83: "Farfetch’d",
};

const BW_FIXED_PERSONAL_NAMES: Record<number, string> = {
  ...SPECIAL_FIXED_PERSONAL_NAMES,
  650: "Deoxys-Attack",
  651: "Deoxys-Defense",
  652: "Deoxys-Speed",
  655: "Shaymin-Sky",
  656: "Giratina-Origin",
  657: "Rotom-Heat",
  658: "Rotom-Wash",
  659: "Rotom-Frost",
  660: "Rotom-Fan",
  661: "Rotom-Mow",
  662: "Castform-Sunny",
  663: "Castform-Rainy",
  664: "Castform-Snowy",
  665: "Basculin-Blue-Striped",
  666: "Darmanitan-Zen",
  667: "Meloetta-Pirouette",
};

const BW2_FIXED_PERSONAL_NAMES: Record<number, string> = {
  ...SPECIAL_FIXED_PERSONAL_NAMES,
  652: "UFO",
  653: "BrycenMan",
  654: "MT",
  655: "MT2",
  656: "Transport",
  658: "Humanoid",
  659: "Monster",
  660: "F00",
  661: "Majin",
  662: "WhiteDoor",
  663: "BlackDoor",
  664: "UFO2",
  665: "UFO2",
  666: "Brycen Man",
  682: "F002",
  683: "Black Belt",
  685: "Deoxys-Attack",
  686: "Deoxys-Defense",
  687: "Deoxys-Speed",
  688: "Wormadam-Sandy",
  689: "Wormadam-Trash",
  690: "Shaymin-Sky",
  691: "Giratina-Origin",
  692: "Rotom-Heat",
  693: "Rotom-Wash",
  694: "Rotom-Frost",
  695: "Rotom-Fan",
  696: "Rotom-Mow",
  697: "Castform-Sunny",
  698: "Castform-Rainy",
  699: "Castform-Snowy",
  700: "Basculin-Blue-Striped",
  701: "Darmanitan-Zen",
  702: "Meloetta-Pirouette",
  703: "Kyurem-White",
  704: "Kyurem-Black",
  705: "Keldeo-Resolute",
  706: "Tornadus-Therian",
  707: "Thundurus-Therian",
  708: "Landorus-Therian",
};

const TRAINER_FORM_ABILITY_EXCLUSIONS = new Set(["Arceus", "Deerling"]);

const GEN4_TRAINER_FORM_EXPORT_NAMES: Record<number, readonly string[]> = {
  172: ["Pichu", "Pichu-Spiky-Eared"],
  201: [
    "Unown",
    ...Array.from({ length: 25 }, (_unused, index) => `Unown-${String.fromCharCode(66 + index)}`),
    "Unown-Emark",
    "Unown-Qmark",
  ],
  351: ["Castform", "Castform-Sunny", "Castform-Rainy", "Castform-Snowy"],
  386: ["Deoxys", "Deoxys-Attack", "Deoxys-Defense", "Deoxys-Speed"],
  412: ["Burmy", "Burmy", "Burmy"],
  413: ["Wormadam", "Wormadam-Sandy", "Wormadam-Trash"],
  422: ["Shellos", "Shellos"],
  423: ["Gastrodon", "Gastrodon-East"],
  479: ["Rotom", "Rotom-Heat", "Rotom-Wash", "Rotom-Frost", "Rotom-Fan", "Rotom-Mow"],
  487: ["Giratina", "Giratina-Origin"],
  492: ["Shaymin", "Shaymin-Sky"],
};

const GEN4_EXTRA_PERSONAL_FORMS: ReadonlyArray<readonly [number, string]> = [
  [386, "Attack"],
  [386, "Defense"],
  [386, "Speed"],
  [413, "Sandy"],
  [413, "Trash"],
  [487, "Origin"],
  [492, "Sky"],
  [479, "Heat"],
  [479, "Wash"],
  [479, "Frost"],
  [479, "Fan"],
  [479, "Mow"],
];

export function ensureDocs(project: ProjectState): DocGeneratorState {
  project.docs ??= {
    romTitle: project.session.romName,
    mastersheetMarkdown: `# ${project.session.romName}\n\n`,
    trainerLocations: {},
    trainerDiffs: {},
    itemLocations: {},
    groundItemScriptMap: {},
  };
  project.docs.romTitle ||= project.session.romName;
  project.docs.mastersheetMarkdown ??= `# ${project.docs.romTitle || project.session.romName}\n\n`;
  project.docs.trainerLocations ??= {};
  project.docs.trainerDiffs ??= {};
  project.docs.itemLocations ??= {};
  project.docs.groundItemScriptMap ??= {};
  return project.docs;
}

export function setDocRomTitle(project: ProjectState, title: string): void {
  ensureDocs(project).romTitle = title;
}

export function generateCalcDownload(project: ProjectState, title: string): TextDownloadFile {
  const payload = buildCalcPayload(project, title.trim());
  return {
    filename: `${safeFilename(title)}-calc.js`,
    contents: `backup_data = ${JSON.stringify(payload, null, 2)};\n`,
    mimeType: "text/javascript",
  };
}

export function generateCalcBridgePayload(project: ProjectState, title: string): CalcBridgePayload {
  const exportTitle = title.trim();
  const payload = buildCalcPayload(project, exportTitle);
  return {
    type: "ddex:calc-sync",
    config: { ...GEN5_CALC_BRIDGE_CONFIG },
    fileName: `${safeFilename(exportTitle)}_npoint_data.js`,
    sourceGen: 5,
    scriptText: `var backup_data = ${JSON.stringify(payload, null, 2)};`,
    title: exportTitle,
  };
}

export function generateDexDownloads(project: ProjectState, title: string): DownloadFile[] {
  const overrides = buildDexOverrides(project);
  const safeTitle = safeFilename(title);
  return [
    {
      filename: `${safeTitle}.js`,
      contents: `overrides = ${JSON.stringify(overrides, null, 2)};\n`,
      mimeType: "text/javascript",
    },
    {
      filename: `${safeTitle}_searchindex.js`,
      contents: buildSearchIndexJs(overrides),
      mimeType: "text/javascript",
    },
  ];
}

export function generateTextDocsDownload(project: ProjectState, title: string): BinaryDownloadFile {
  const safeTitle = safeFilename(title || project.session.romName);
  if (project.narcs.headers && project.narcs.overworlds) enrichTrainerLocations(project);
  const files = [
    { filename: `${safeTitle}_pokedex.txt`, contents: buildPokemonTextDoc(project, safeTitle) },
    { filename: `${safeTitle}_moves.txt`, contents: buildMovesTextDoc(project) },
    { filename: `${safeTitle}_trainers.txt`, contents: buildTrainerTextDoc(project) },
  ];
  return {
    filename: `${safeTitle}_text_docs.zip`,
    contents: zipStored(files),
    mimeType: "application/zip",
  };
}

export function enrichTrainerLocations(project: ProjectState): EnrichmentResult {
  requireNarcs(project, ["headers", "overworlds"]);
  const docs = ensureDocs(project);
  docs.trainerLocations = {};
  docs.trainerDiffs = {};
  if (!project.headers) project.headers = parseHeaders(project);

  const overworlds = project.narcs.overworlds;
  let count = 0;
  for (let overworldId = 0; overworldId < (overworlds?.fileCount ?? 0); overworldId += 1) {
    const record = decodeRecord(project, "overworlds", overworldId);
    const raw = record.raw;
    if (!raw) continue;
    const location = locationForOverworld(project, overworldId);
    const diff = difficultyForOverworld(project, overworldId);
    const npcCount = Number(raw.npc_count ?? 0);
    for (let npc = 0; npc < npcCount; npc += 1) {
      const scriptId = Number(raw[`npc_${npc}_script_id`] ?? 0);
      if (!((scriptId > 3000 && scriptId < 4000) || (scriptId > 5000 && scriptId < 6000))) continue;
      const trainerId = scriptId % 1000;
      addTrainerSource(docs, trainerId, location, diff);
      count += 1;
    }
  }

  const scriptCount = enrichTrainerLocationsFromScripts(project, docs);
  return {
    count: count + scriptCount,
    message: `Found ${Object.keys(docs.trainerLocations).length} trainers across ${count} overworld NPCs and ${scriptCount} script battle references.`,
  };
}

export function enrichItemLocations(project: ProjectState): EnrichmentResult {
  requireNarcs(project, ["headers", "overworlds", "scripts", "items"]);
  const docs = ensureDocs(project);
  docs.itemLocations = {};
  const scriptMap = buildGroundItemScriptMap(project);
  docs.groundItemScriptMap = Object.fromEntries([...scriptMap].map(([scriptId, itemId]) => [String(scriptId), itemId]));

  const overworlds = project.narcs.overworlds;
  let groundCount = 0;
  for (let overworldId = 0; overworldId < (overworlds?.fileCount ?? 0); overworldId += 1) {
    const record = decodeRecord(project, "overworlds", overworldId);
    const raw = record.raw;
    if (!raw) continue;
    const location = locationForOverworld(project, overworldId);
    const npcCount = Number(raw.npc_count ?? 0);
    for (let npc = 0; npc < npcCount; npc += 1) {
      const scriptId = Number(raw[`npc_${npc}_script_id`] ?? 0);
      if (scriptId <= 7000 || scriptId > 7400) continue;
      const itemId = scriptMap.get(scriptId);
      if (itemId === undefined) continue;
      addUnique(docs.itemLocations, itemId, location);
      groundCount += 1;
    }
  }
  const derivedCount = enrichDerivedItemSources(project);

  return {
    count: groundCount + derivedCount,
    message: `Found ${Object.keys(docs.itemLocations).length} items across ${groundCount} ground item NPCs and ${derivedCount} derived sources.`,
  };
}

export function parseGroundItemScripts(bytes: Uint8Array): Map<number, number> {
  const starts = scriptStarts(bytes);
  const sorted = [...starts].sort((a, b) => a - b);
  const map = new Map<number, number>();
  starts.forEach((start, scriptIndex) => {
    const end = sorted.find((candidate) => candidate > start) ?? bytes.length;
    for (let offset = start; offset + 6 <= end; offset += 2) {
      if (readU16(bytes, offset) !== 0x28) continue;
      if (readU16(bytes, offset + 2) !== 32780) continue;
      map.set(7000 + scriptIndex, readU16(bytes, offset + 4));
      break;
    }
  });
  return map;
}

export function parseTrainerBattleScripts(bytes: Uint8Array, maxTrainerId = 65535): number[] {
  const starts = scriptStarts(bytes);
  const sorted = [...starts].sort((a, b) => a - b);
  const trainerIds: number[] = [];
  starts.forEach((start) => {
    const end = sorted.find((candidate) => candidate > start) ?? bytes.length;
    // Byte-sized operands can leave later Gen V commands at odd offsets.
    for (let offset = start; offset + 8 <= end; offset += 1) {
      const command = readU16(bytes, offset);
      if (command === 0x85 && offset + 8 <= end) {
        addTrainerIds(trainerIds, maxTrainerId, [readU16(bytes, offset + 2), readU16(bytes, offset + 4)]);
      } else if (command === 0x86 && offset + 10 <= end) {
        addTrainerIds(trainerIds, maxTrainerId, [
          readU16(bytes, offset + 2),
          readU16(bytes, offset + 4),
          readU16(bytes, offset + 6),
        ]);
      } else if (command === 0x94 && offset + 10 <= end) {
        addTrainerIds(trainerIds, maxTrainerId, [readU16(bytes, offset + 2), readU16(bytes, offset + 4)]);
      }
    }
  });
  return unique(trainerIds);
}

export function buildGroundItemScriptMap(project: ProjectState): Map<number, number> {
  const store = project.narcs.scripts;
  if (!store) throw new Error("Scripts NARC is not loaded.");
  const scriptFileId = project.session.baseRom === "BW2" ? 1240 : 864;
  const bytes = store.rawFiles[scriptFileId];
  if (!bytes) throw new Error(`Global item script file ${scriptFileId} is not loaded.`);
  return parseGroundItemScripts(bytes);
}

function buildCalcPayload(project: ProjectState, title: string): Record<string, unknown> {
  const typeChart = buildCalcTypeChart(project);
  return {
    title,
    ...(typeChart ? { type_chart: typeChart } : {}),
    pok_replacements: replacementMap(VANILLA.pokedex, project.texts.banks.pokedex ?? [], (value) =>
      toId(String(value).replace(/fletcinder/iu, "fletchinder").replace(/lycanrocm/iu, "lycanrocmidnight")),
    ),
    move_replacements: replacementMap(VANILLA.moves, project.texts.banks.moves ?? [], (value) => toId(showdownName(value))),
    ability_replacements: replacementMap(VANILLA.abilities, project.texts.banks.abilities ?? [], toId),
    item_replacements: replacementMap(VANILLA.items, project.texts.banks.items ?? [], (value) => toId(showdownItemName(value))),
    moves: buildCalcMoves(project),
    poks: buildCalcPokemon(project),
    formatted_sets: buildFormattedTrainerSets(project),
  };
}

function buildCalcTypeChart(project: ProjectState): CalcTypeChart | undefined {
  if (!project.narcs.type_chart && !project.overlays[TYPE_CHART_OVERLAY_ID]) return undefined;
  const types = getTypeChartTypes(project);
  const bytes = typeChartBytesFromProject(project, types);
  if (isStandardCalcTypeChart(types, bytes)) return undefined;
  return typeChartPayload(types, bytes);
}

function typeChartBytesFromProject(project: ProjectState, types: string[]): Uint8Array {
  const bytes = new Uint8Array(types.length * types.length);
  bytes.fill(4);
  for (const cell of getTypeChart(project)) {
    const offset = cell.attackIndex * types.length + cell.defendIndex;
    if (offset >= 0 && offset < bytes.length) bytes[offset] = cell.value;
  }
  return bytes;
}

function isStandardCalcTypeChart(types: string[], bytes: Uint8Array): boolean {
  if (types.length === TYPE_CHART_VANILLA_TYPE_COUNT) return byteArraysEqual(bytes, STANDARD_GEN5_TYPE_CHART_BYTES);
  if (types.length === TYPES.length && types[types.length - 1] === "Fairy") return byteArraysEqual(bytes, STANDARD_GEN6_TYPE_CHART_BYTES);
  return false;
}

function typeChartPayload(types: string[], bytes: Uint8Array): CalcTypeChart {
  const out: CalcTypeChart = {};
  types.forEach((attackType, attackIndex) => {
    const matchups: Record<string, number> = {};
    types.forEach((defendType, defendIndex) => {
      matchups[defendType] = calcEffectivenessValue(bytes[attackIndex * types.length + defendIndex] as TypeEffectivenessValue);
    });
    out[attackType] = matchups;
  });
  return out;
}

function buildStandardTypeChartBytes(types: string[], steelNerf: boolean): Uint8Array {
  const bytes = new Uint8Array(types.length * types.length);
  bytes.fill(4);
  const set = (attackType: string, defendType: string, value: TypeEffectivenessValue) => {
    const attackIndex = types.indexOf(attackType);
    const defendIndex = types.indexOf(defendType);
    if (attackIndex < 0 || defendIndex < 0) return;
    bytes[attackIndex * types.length + defendIndex] = value;
  };

  for (const [attackType, defendType, value] of STANDARD_TYPE_MATCHUPS) set(attackType, defendType, value);
  if (steelNerf) {
    set("Ghost", "Steel", 4);
    set("Dark", "Steel", 4);
  }
  return bytes;
}

function calcEffectivenessValue(value: TypeEffectivenessValue): number {
  if (value === 0) return 0;
  if (value === 2) return 0.5;
  if (value === 8) return 2;
  return 1;
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function buildDexOverrides(project: ProjectState): Record<string, unknown> {
  return {
    poks: buildDexPokemon(project),
    moves: buildDexMoves(project),
    abilities: buildDexAbilities(project),
    encs: buildDexEncounters(project),
    items: buildDexItems(project),
  };
}

function buildCalcMoves(project: ProjectState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let id = 1; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    const name = showdownName(project.texts.banks.moves?.[id] ?? move.readable.name ?? `Move ${id}`);
    out[name] = {
      type: titleize(move.readable.type),
      basePower: move.readable.power ?? 0,
      category: move.readable.category ?? "Status",
      pp: move.readable.pp ?? 0,
      accuracy: move.readable.accuracy ?? 0,
      priority: move.readable.priority ?? 0,
      e_id: move.raw.effect ?? 0,
      ...(move.readable.target === "All adjacent opponents" ? { target: "allAdjacentFoes" } : {}),
      ...(move.readable.target === "All excluding user" ? { target: "allAdjacent" } : {}),
      ...(Number(move.readable.crit ?? 0) === 6 ? { willCrit: true } : {}),
      ...(Number(move.readable.min_hits ?? 0) > 0 ? { multihit: [move.readable.min_hits, move.readable.max_hits] } : {}),
      ...(Number(move.readable.recoil ?? 0) > 0 && Number(move.readable.recoil ?? 0) < 100 ? { recoil: [move.readable.recoil, 100] } : {}),
      ...(hasSheerForceSecondary(move.readable) ? { secondaries: true } : {}),
      ...moveFlags(move.readable),
    };
  }
  return out;
}

function buildDexMoves(project: ProjectState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const descriptions = moveDescriptions(project);
  for (let id = 1; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    const name = showdownName(project.texts.banks.moves?.[id] ?? move.readable.name ?? `Move ${id}`);
    out[name] = {
      t: titleize(move.readable.type),
      bp: move.readable.power ?? 0,
      cat: move.readable.category ?? "Status",
      pp: move.readable.pp ?? 0,
      acc: move.readable.accuracy ?? 0,
      prio: move.readable.priority ?? 0,
      name,
      num: id - 1,
      desc: descriptions[id] ?? "",
      e_id: move.raw.effect ?? 0,
      ...(move.readable.target === "All adjacent opponents" ? { tar: "allAdjacentFoes" } : {}),
      ...(move.readable.target === "All excluding user" ? { tar: "allAdjacent" } : {}),
      ...(Number(move.readable.crit ?? 0) === 6 ? { willCrit: true } : {}),
      ...(Number(move.readable.min_hits ?? 0) > 0 ? { multihit: [move.readable.min_hits, move.readable.max_hits] } : {}),
      ...(Number(move.readable.recoil ?? 0) > 0 && Number(move.readable.recoil ?? 0) < 100 ? { recoil: [move.readable.recoil, 100] } : {}),
      ...(hasSheerForceSecondary(move.readable) ? { secondaries: true } : {}),
      ...moveFlags(move.readable),
    };
  }
  return out;
}

function hasSheerForceSecondary(move: ReadableRecord): boolean {
  if (hasTargetStatusAffliction(move)) return true;

  const category = String(move.effect_category ?? "");
  const magnitudes = [1, 2, 3].map((slot) => statMagnitude(move, slot));
  const hasPositiveStatChange = magnitudes.some((magnitude) => magnitude > 0);
  const hasNegativeStatChange = magnitudes.some((magnitude) => magnitude < 0);

  if (hasPositiveStatChange && (category === USER_STAT_EFFECT_CATEGORY || isUserTarget(move))) return true;
  return hasNegativeStatChange && TARGET_STAT_EFFECT_CATEGORIES.has(category) && isBattlerTarget(move) && !isUserTarget(move);
}

function statMagnitude(move: ReadableRecord, slot: number): number {
  if (String(move[`stat_${slot}`] ?? "None") === "None") return 0;
  return Number(move[`magnitude_${slot}`] ?? 0);
}

function hasTargetStatusAffliction(move: ReadableRecord): boolean {
  return String(move.status ?? "None") !== "None" && isBattlerTarget(move) && !isUserTarget(move);
}

function isUserTarget(move: ReadableRecord): boolean {
  return USER_TARGETS.has(String(move.target ?? ""));
}

function isBattlerTarget(move: ReadableRecord): boolean {
  const target = String(move.target ?? "");
  return target.length > 0 && !NON_BATTLER_TARGETS.has(target);
}

function buildCalcPokemon(project: ProjectState): Record<string, unknown> {
  return buildDexPokemon(project);
}

function buildDexPokemon(project: ProjectState): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const record = getPokemonRecord(project, id);
    const name = pokemonExportName(project, id, record);
    const types = [record.personal.type_1, record.personal.type_2].map((type) => titleizeName(type)).filter(Boolean);
    out[name] = {
      name,
      num: id,
      types: types[0] === types[1] ? [types[0]] : types,
      items: [record.personal.item_1, record.personal.item_2, record.personal.item_3].map((item) => showdownItemName(item)),
      bs: {
        hp: record.personal.base_hp ?? 0,
        at: record.personal.base_atk ?? 0,
        df: record.personal.base_def ?? 0,
        sa: record.personal.base_spatk ?? 0,
        sd: record.personal.base_spdef ?? 0,
        sp: record.personal.base_speed ?? 0,
      },
      learnset_info: {
        learnset: record.learnset.slice(0, 25).map((move) => [move.level, showdownName(move.moveName)]),
        tms: record.tmCompatibility.filter((tm) => tm.enabled).map((tm) => showdownName(tm.moveName)),
      },
      abs: calcPokemonAbilities(project, id, record),
    };
  }

  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const record = getPokemonRecord(project, id);
    const sourceName = pokemonExportName(project, id, record);
    for (const evo of record.evolutions) {
      const target = titleizeName(evo.target);
      if (!target || target === "0" || !out[target] || Number(evo.param) === 0) continue;
      out[sourceName].evos ??= [];
      out[sourceName].evoMethods ??= [];
      out[sourceName].evoParams ??= [];
      (out[sourceName].evos as string[]).push(target);
      (out[sourceName].evoMethods as string[]).push(String(evo.method));
      (out[sourceName].evoParams as Array<string | number>).push(evo.param);
    }
  }
  return out;
}

function pokemonExportName(project: ProjectState, id: number, record?: PokemonSummaryRecord): string {
  const fixed = fixedPersonalName(project, id);
  if (fixed) return fixed;

  const summary = record ?? safePokemonSummaryRecord(project, id);
  const directName = summary ? directPokemonExportName(project, id, summary) : undefined;
  if (directName) return directName;

  const formName = derivedAltFormName(project, id);
  if (formName) return formName;

  return titleizeName(summary?.personal.name ?? project.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`);
}

function directPokemonExportName(project: ProjectState, id: number, record: PokemonSummaryRecord): string | undefined {
  const readableName = String(record.personal.name ?? "").trim();
  if (readableName && !isGenericPersonalName(readableName, id)) return titleizeName(readableName);
  const textName = String(project.texts.banks.pokedex?.[id] ?? "").trim();
  if (textName && !isGenericPersonalName(textName, id)) return titleizeName(textName);
  return undefined;
}

function derivedAltFormName(project: ProjectState, id: number): string | undefined {
  for (let baseId = 1; baseId < getPokemonCount(project); baseId += 1) {
    if (baseId === id) continue;
    const baseRecord = safePokemonSummaryRecord(project, baseId);
    if (!baseRecord) continue;
    const formId = Number(baseRecord.rawPersonal.form_id ?? 0);
    const numForms = Number(baseRecord.rawPersonal.num_forms ?? 0);
    const altFormCount = Math.max(numForms - 1, 0);
    if (formId <= 0 || altFormCount <= 0 || id < formId || id >= formId + altFormCount) continue;

    const baseName = fixedPersonalName(project, baseId) ?? directPokemonExportName(project, baseId, baseRecord);
    if (!baseName) continue;
    const suffix = pokemonFormSuffix(baseName, id - formId + 1);
    if (suffix) return `${baseName}-${suffix}`;
  }
  return undefined;
}

export function trainerPokemonExportName(project: ProjectState, pok: TrainerPokemonSlot): string {
  const baseName = pokemonExportName(project, pok.speciesId);
  const gen4FormName = gen4TrainerPokemonFormExportName(project, pok, baseName);
  if (gen4FormName) return gen4FormName;
  if (pok.form <= 0 || TRAINER_FORM_ABILITY_EXCLUSIONS.has(baseName)) return baseName;

  const suffix = pokemonFormSuffix(baseName, pok.form);
  if (suffix) return `${baseName}-${suffix}`;

  const altPersonalId = trainerAltFormPersonalId(project, pok.speciesId, pok.form);
  return altPersonalId === undefined ? baseName : pokemonExportName(project, altPersonalId);
}

function gen4TrainerPokemonFormExportName(project: ProjectState, pok: TrainerPokemonSlot, baseName: string): string | undefined {
  if (!isGen4Project(project)) return undefined;
  const name = GEN4_TRAINER_FORM_EXPORT_NAMES[pok.speciesId]?.[pok.form];
  if (!name || pok.form <= 0) return undefined;
  return name === GEN4_TRAINER_FORM_EXPORT_NAMES[pok.speciesId]?.[0] ? baseName : name;
}

export function trainerPokemonExportAbility(project: ProjectState, pok: TrainerPokemonSlot): string {
  const resolvedSlot = Number(pok.resolvedAbilitySlot ?? pok.abilitySlot ?? 0);
  if (resolvedSlot > 3) return titleizeAbility(cascadeWhiteTrainerAbilityName(project, pok.speciesId, resolvedSlot) ?? pok.abilityName);
  const baseName = pokemonExportName(project, pok.speciesId);
  if (pok.form <= 0 || TRAINER_FORM_ABILITY_EXCLUSIONS.has(baseName)) return titleizeAbility(pok.abilityName);

  const altPersonalId = trainerAltFormPersonalId(project, pok.speciesId, pok.form);
  if (altPersonalId === undefined) return titleizeAbility(pok.abilityName);

  const altRecord = safePokemonSummaryRecord(project, altPersonalId);
  const slot = Math.min(Math.max(Number(pok.resolvedAbilitySlot ?? pok.abilitySlot ?? 1), 1), 3);
  const ability = altRecord?.personal[`ability_${slot}`];
  return isEmptyExportValue(ability) ? titleizeAbility(pok.abilityName) : titleizeAbility(ability);
}

function calcPokemonAbilities(project: ProjectState, id: number, record: PokemonSummaryRecord): string[] {
  const abilities = [record.personal.ability_1, record.personal.ability_2, record.personal.ability_3].map((ability) => titleizeAbility(ability));
  const cascadeAbilities = [4, 5, 6]
    .map((slot) => cascadeWhiteTrainerAbilityName(project, id, slot))
    .filter((ability): ability is string => Boolean(ability))
    .map((ability) => titleizeAbility(ability));
  return cascadeAbilities.length > 0 ? [...abilities, ...cascadeAbilities] : abilities;
}

function trainerAltFormPersonalId(project: ProjectState, speciesId: number, form: number): number | undefined {
  if (form <= 0 || !project.narcs.personal || speciesId <= 0 || speciesId >= project.narcs.personal.fileCount) return undefined;
  const baseRecord = safePokemonSummaryRecord(project, speciesId);
  const formId = Number(baseRecord?.rawPersonal.form_id ?? 0);
  const altPersonalId = formId + form - 1;
  return formId > 0 && altPersonalId > 0 && altPersonalId < project.narcs.personal.fileCount ? altPersonalId : undefined;
}

function fixedPersonalName(project: ProjectState, id: number): string | undefined {
  const cascadeName = cascadeWhitePersonalName(project, id);
  if (cascadeName) return cascadeName;
  if (isGen4Project(project)) return gen4ExtraPersonalName(project, id) ?? SPECIAL_FIXED_PERSONAL_NAMES[id];
  if (project.session.baseRom === "BW2") return BW2_FIXED_PERSONAL_NAMES[id];
  if (project.session.baseRom === "BW") return BW_FIXED_PERSONAL_NAMES[id];
  return SPECIAL_FIXED_PERSONAL_NAMES[id];
}

function gen4ExtraPersonalName(project: ProjectState, id: number): string | undefined {
  const formIndex = id - (project.texts.banks.pokedex?.length ?? 0);
  const form = GEN4_EXTRA_PERSONAL_FORMS[formIndex];
  if (!form) return undefined;
  const [baseSpeciesId, suffix] = form;
  const baseName = titleizeName(project.texts.banks.pokedex?.[baseSpeciesId] ?? `Pokemon ${baseSpeciesId}`);
  return `${baseName}-${suffix}`;
}

function isGenericPersonalName(value: string, id: number): boolean {
  const normalized = toId(value);
  return normalized === "" || normalized === "0" || normalized === "altform" || normalized === `pokemon${id}`;
}

function isEmptyExportValue(value: unknown): boolean {
  const normalized = toId(String(value ?? ""));
  return normalized === "" || normalized === "0" || normalized === "none" || normalized === "noitem";
}

function safePokemonSummaryRecord(project: ProjectState, id: number): PokemonSummaryRecord | undefined {
  if (!project.narcs.personal || id <= 0 || id >= project.narcs.personal.fileCount) return undefined;
  try {
    return getPokemonSummaryRecord(project, id);
  } catch {
    return undefined;
  }
}

function buildDexAbilities(project: ProjectState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ability of project.texts.banks.abilities ?? []) {
    const name = titleizeAbility(ability);
    if (!name || name === "None") continue;
    out[toId(name)] = { name };
  }
  return out;
}

function buildDexEncounters(project: ProjectState): Record<string, unknown> {
  const rates: Record<string, number[]> = {};
  const out: Record<string, unknown> = { rates };
  const used: Record<string, number> = {};
  const locationKeys = new Map<string, string>();
  for (const kind of [...ENCOUNTER_GRASS_FIELDS, ...ENCOUNTER_WATER_FIELDS]) rates[kind] = encounterSlotRates(kind);

  if (project.narcs.encounters) {
    for (let id = 0; id < getEncounterCount(project); id += 1) {
      const encounter = getEncounterRecord(project, id);
      const sections = buildDexEncounterSections(encounter);
      if (Object.keys(sections).length === 0) continue;

      for (const encType of Object.keys(sections)) rates[encType] ??= encounterSlotRates(baseEncounterKind(encType));
      for (const displayName of dexEncounterLocationNames(encounter, id)) {
        const baseKey = toId(displayName) || `location${id}`;
        used[baseKey] = (used[baseKey] ?? 0) + 1;
        const key = used[baseKey] > 1 ? `${baseKey}${used[baseKey]}` : baseKey;
        out[key] = {
          name: used[baseKey] > 1 ? `${displayName} ${used[baseKey]}` : displayName,
          wilds: encounter.wilds,
          ...sections,
        } satisfies DexLocationRecord;
        const lookupKey = toId(displayName);
        if (lookupKey && !locationKeys.has(lookupKey)) locationKeys.set(lookupKey, key);
      }
    }
  }

  addScriptDexEncounters(project, out, rates, used, locationKeys);
  return out;
}

function addScriptDexEncounters(
  project: ProjectState,
  out: Record<string, unknown>,
  rates: Record<string, number[]>,
  used: Record<string, number>,
  locationKeys: Map<string, string>,
): void {
  const scripts = project.narcs.scripts;
  if (!scripts) return;
  if (!project.headers && project.narcs.headers) project.headers = parseHeaders(project);
  if (!project.headers) return;

  const pokemonCount = getPokemonCount(project);
  const cache = new Map<number, Gen5ScriptEncounter[]>();
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    const row = project.headers.rows[rowId];
    const location = String(row.location_name ?? `Header ${rowId - 1}`);
    const scriptIds = unique([Number(row.script_id ?? -1), Number(row.level_script_id ?? -1)]).filter(
      (scriptId) => Number.isInteger(scriptId) && scriptId >= 0 && scriptId < scripts.rawFiles.length,
    );

    for (const scriptId of scriptIds) {
      const bytes = scripts.rawFiles[scriptId];
      if (!bytes?.length) continue;
      let encounters = cache.get(scriptId);
      if (!encounters) {
        encounters = parseGen5ScriptEncounters(bytes, project.session.baseRom);
        cache.set(scriptId, encounters);
      }

      for (const encounter of encounters) {
        if (!isExportableScriptEncounter(encounter, pokemonCount)) continue;
        const record = ensureDexLocationRecord(out, used, locationKeys, location);
        addScriptEncounterToDexLocation(record, encounter, pokemonNameForDex(project, encounter.speciesId));
        rates[encounter.kind] ??= [100];
      }
    }
  }
}

function ensureDexLocationRecord(
  out: Record<string, unknown>,
  used: Record<string, number>,
  locationKeys: Map<string, string>,
  displayName: string,
): DexLocationRecord {
  const lookupKey = toId(displayName);
  const existingKey = lookupKey ? locationKeys.get(lookupKey) : undefined;
  if (existingKey && out[existingKey]) return out[existingKey] as DexLocationRecord;

  const baseKey = lookupKey || `location${Object.keys(out).length}`;
  used[baseKey] = (used[baseKey] ?? 0) + 1;
  const key = used[baseKey] > 1 ? `${baseKey}${used[baseKey]}` : baseKey;
  const record = {
    name: used[baseKey] > 1 ? `${displayName} ${used[baseKey]}` : displayName,
    wilds: [],
  } satisfies DexLocationRecord;
  out[key] = record;
  if (lookupKey && !locationKeys.has(lookupKey)) locationKeys.set(lookupKey, key);
  return record;
}

function addScriptEncounterToDexLocation(record: DexLocationRecord, encounter: Gen5ScriptEncounter, speciesName: string): void {
  const section = (record[encounter.kind] ??= { rates: [], encs: [] }) as DexEncounterSection;
  const slot: DexEncounterSlot = { s: speciesName, mn: encounter.level };
  if (section.encs.some((existing) => existing.s === slot.s && existing.mn === slot.mn && (existing.mx ?? 0) === (slot.mx ?? 0))) {
    return;
  }
  section.encs.push(slot);
  section.rates.push(100);
}

function isExportableScriptEncounter(encounter: Gen5ScriptEncounter, pokemonCount: number): boolean {
  return Number.isInteger(encounter.speciesId) && encounter.speciesId > 0 && encounter.speciesId < pokemonCount;
}

function pokemonNameForDex(project: ProjectState, speciesId: number): string {
  return titleizeName(pokemonExportName(project, speciesId));
}

function dexEncounterLocationNames(encounter: ReturnType<typeof getEncounterRecord>, fallbackId: number): string[] {
  const names = encounter.locations
    .map((location) => location.replace(/\s*\(\d+\)\s*$/u, "").trim())
    .filter(Boolean);
  return names.length > 0 ? unique(names) : [`Location ${fallbackId}`];
}

function buildDexEncounterSections(encounter: ReturnType<typeof getEncounterRecord>): Record<string, DexEncounterSection> {
  const sections: Record<string, DexEncounterSection> = {};

  for (const kind of [...ENCOUNTER_GRASS_FIELDS, ...ENCOUNTER_WATER_FIELDS]) {
    const springSection = buildDexEncounterSection(encounter, "spring", kind);
    if (springSection.encs.length > 0) sections[kind] = springSection;

    let hasSeasonalVariant = false;
    for (const season of ENCOUNTER_SEASONS) {
      if (season === "spring") continue;
      const seasonSection = buildDexEncounterSection(encounter, season, kind);
      if (seasonSection.encs.length === 0 || sameEncounterSections(seasonSection, springSection)) continue;
      const encType = `${season}_${kind}`;
      sections[encType] = {
        name: `${titleizeName(season)} ${encounterKindLabel(kind)}`,
        ...seasonSection,
      };
      hasSeasonalVariant = true;
    }

    if (hasSeasonalVariant && sections[kind]) sections[kind].name = `Spring ${encounterKindLabel(kind)}`;
  }

  return sections;
}

function buildDexEncounterSection(
  encounter: ReturnType<typeof getEncounterRecord>,
  season: (typeof ENCOUNTER_SEASONS)[number],
  kind: (typeof ENCOUNTER_GRASS_FIELDS)[number] | (typeof ENCOUNTER_WATER_FIELDS)[number],
): DexEncounterSection {
  const encs: DexEncounterSlot[] = [];
  const rates: number[] = [];
  const slotRates = encounterSlotRates(kind);
  const slotCount = (ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? 12 : 5;
  for (let slot = 0; slot < slotCount; slot += 1) {
    const base = `${season}_${kind}_slot_${slot}`;
    const species = String(encounter.readable[base] ?? "").trim();
    if (!species || species === "-") continue;
    const minLevel = Number(encounter.readable[`${base}_min_level`] ?? 0) || 0;
    const maxLevel = Number(encounter.readable[`${base}_max_level`] ?? 0) || minLevel;
    const entry: DexEncounterSlot = { s: titleizeName(species), mn: minLevel };
    if (maxLevel && maxLevel !== minLevel) entry.mx = maxLevel;
    encs.push(entry);
    rates.push(slotRates[slot] ?? 0);
  }
  return { rates, encs };
}

function sameEncounterSections(left: DexEncounterSection, right: DexEncounterSection): boolean {
  if (left.encs.length !== right.encs.length || left.rates.length !== right.rates.length) return false;
  for (let index = 0; index < left.encs.length; index += 1) {
    const leftSlot = left.encs[index];
    const rightSlot = right.encs[index];
    if (leftSlot.s !== rightSlot.s || leftSlot.mn !== rightSlot.mn || (leftSlot.mx ?? 0) !== (rightSlot.mx ?? 0)) return false;
    if (left.rates[index] !== right.rates[index]) return false;
  }
  return true;
}

function encounterSlotRates(kind: string): number[] {
  return [...((ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? ENCOUNTER_GRASS_PERCENTAGES : ENCOUNTER_WATER_PERCENTAGES)];
}

function baseEncounterKind(encType: string): string {
  for (const season of ENCOUNTER_SEASONS) {
    const prefix = `${season}_`;
    if (encType.startsWith(prefix)) return encType.slice(prefix.length);
  }
  return encType;
}

function encounterKindLabel(kind: string): string {
  return titleizeName(kind);
}

function buildDexItems(project: ProjectState): Record<string, unknown> {
  if (!project.narcs.items) return {};
  const docs = ensureDocs(project);
  if (Object.keys(docs.itemLocations).length === 0) enrichDerivedItemSources(project);
  const out: Record<string, Record<string, unknown>> = {};
  const itemDescs = itemDescriptions(project);
  for (let id = 0; id < getItemCount(project); id += 1) {
    const item = getItemRecord(project, id);
    const name = String(project.texts.banks.items?.[id] ?? item.readable.name ?? `Item ${id}`);
    out[toId(name)] = {
      name,
      desc: itemDescs[id] ?? "",
      location: docs.itemLocations[String(id)]?.join(", ") ?? "",
    };
  }

  if (project.narcs.trdata) {
    for (let id = 0; id < getTrainerCount(project); id += 1) {
      const trainer = getTrainerRecord(project, id);
      const reward = String(trainer.readable.reward_item ?? "");
      const key = toId(reward);
      if (!reward || reward === "None" || !out[key]) continue;
      const label = `${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}`.trim();
      const locations = docs.trainerLocations[String(id)] ?? [];
      const title = locations[0] ? `${label} - ${locations[0]}` : label;
      out[key].rewards = unique([...(out[key].rewards as string[] | undefined ?? []), title]);
    }
  }

  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const pok = getPokemonSummaryRecord(project, id);
    const species = titleizeName(pok.personal.name ?? project.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`);
    for (const item of [pok.personal.item_1, pok.personal.item_2, pok.personal.item_3]) {
      const key = toId(String(item ?? ""));
      if (!out[key] || key === "none") continue;
      out[key].wilds = unique([...(out[key].wilds as string[] | undefined ?? []), species]);
    }
  }
  addMartDexSources(project, out);
  return out;
}

function buildPokemonTextDoc(project: ProjectState, safeTitle: string): string {
  const lines: string[] = [
    `Pokedex: /${safeTitle}_pokedex.txt`,
    `Moves: /${safeTitle}_moves.txt`,
    `Trainers: /${safeTitle}_trainers.txt`,
  ];

  for (let id = 1; id < getPokemonCount(project); id += 1) {
    const pok = getPokemonRecord(project, id);
    if (!pok.personal.base_hp) continue;
    lines.push(
      "===================",
      `${id} - ${titleizeName(pok.personal.name ?? project.texts.banks.pokedex?.[id] ?? `Pokemon ${id}`)}`,
      "===================",
      formatTypes(pok.personal),
      "",
      formatAbilities(pok.personal),
      "",
      formatStats(pok.personal),
      "",
    );

    for (const evo of pok.evolutions) {
      const target = String(evo.target ?? "").replace(/-/gu, "").trim();
      if (!target || target === "0") continue;
      lines.push(`Evolves to ${titleizeName(evo.target)} by ${evo.method} / ${evo.param}`);
    }

    lines.push("", "Level Up:");
    for (const move of pok.learnset) {
      lines.push(`${move.level} - ${titleizeName(move.moveName)}`);
    }
    lines.push("", "");
  }

  return `${lines.join("\n")}\n`;
}

function buildMovesTextDoc(project: ProjectState): string {
  const lines: string[] = [];
  for (let id = 0; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    lines.push(
      "===================",
      titleizeName(project.texts.banks.moves?.[id] ?? move.readable.name ?? `Move ${id}`),
      "===================",
      `${move.readable.power ?? 0}  BP || ${move.readable.accuracy ?? 0} ACC || ${move.readable.category ?? "Status"} || ${move.readable.type ?? "Normal"} || ${move.readable.pp ?? 0} PP`,
      `Effect: ${move.readable.effect ?? "None"}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildTrainerTextDoc(project: ProjectState): string {
  const trainers: TrainerRecord[] = [];
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    if (!project.narcs.trpok?.rawFiles[trainerId]) continue;
    const trainer = getTrainerRecord(project, trainerId);
    if (trainer.party.length > 0) trainers.push(trainer);
  }

  trainers.sort((a, b) => maxTrainerLevel(a) - maxTrainerLevel(b));

  const lines: string[] = [];
  let lastLocation = "";
  for (const trainer of trainers) {
    const location = ensureDocs(project).trainerLocations[String(trainer.id)]?.[0] ?? "";
    if (location && location !== lastLocation) {
      lines.push("-----------------", location, "-----------------", "", ">>>>>>>>>>>>>>>>");
      lastLocation = location;
    }

    const trainerName = `${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}`.trim() || "Trainer";
    lines.push(`${trainerName} ${trainer.id} (${trainer.readable.battle_type_1 ?? ""}) (${trainer.readable.reward_item ?? "None"})`, "");
    for (const pok of trainer.party) {
      const species = titleizeName(pok.speciesName).padEnd(10, " ");
      const level = `Lv.${pok.level}`.padEnd(6, " ");
      const item = String(pok.itemName ?? (trainer.hasItems ? "None" : "-")).padEnd(14, " ");
      const ability = titleizeAbility(pok.abilityName).padEnd(14, " ");
      const nature = String(pok.nature ?? "").padEnd(8, " ");
      const moves = pok.moves.map(formatTrainerMoveName).join(", ");
      lines.push(`${species} ${level} @${item} ${ability} ${nature} ${moves}`);
    }
    lines.push("---", "");
  }

  return `${lines.join("\n")}\n`;
}

function enrichDerivedItemSources(project: ProjectState): number {
  const docs = ensureDocs(project);
  let count = 0;
  count += addWildHeldItemSources(project, docs.itemLocations);
  count += addTrainerRewardSources(project, docs.itemLocations);
  count += addMartItemSources(project, docs.itemLocations);
  return count;
}

function addWildHeldItemSources(project: ProjectState, target: Record<string, string[]>): number {
  if (!project.narcs.personal) return 0;
  let count = 0;
  for (let speciesId = 1; speciesId < getPokemonCount(project); speciesId += 1) {
    const pok = getPokemonSummaryRecord(project, speciesId);
    const species = pokemonExportName(project, speciesId, pok);
    for (const itemField of ["item_1", "item_2", "item_3"]) {
      const itemId = Number(pok.rawPersonal[itemField] ?? 0);
      if (itemId <= 0) continue;
      addUnique(target, itemId, `Wild held by ${species}`);
      count += 1;
    }
  }
  return count;
}

function addTrainerRewardSources(project: ProjectState, target: Record<string, string[]>): number {
  if (!project.narcs.trdata) return 0;
  const docs = ensureDocs(project);
  let count = 0;
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    const trainer = decodeRecord(project, "trdata", trainerId);
    if (!trainer.raw || !trainer.readable) continue;
    const itemId = Number(trainer.raw.reward_item ?? 0);
    if (itemId <= 0) continue;
    const trainerClass = project.texts.banks.tr_classes?.[trainer.raw.class] ?? trainer.readable.class ?? "";
    const trainerName = project.texts.banks.tr_names?.[trainerId] ?? trainer.readable.name ?? "";
    const label = `${trainerClass} ${trainerName}`.trim() || `Trainer ${trainerId}`;
    const location = docs.trainerLocations[String(trainerId)]?.[0];
    addUnique(target, itemId, location ? `Reward from ${label} - ${location}` : `Reward from ${label}`);
    count += 1;
  }
  return count;
}

function addMartItemSources(project: ProjectState, target: Record<string, string[]>): number {
  if (!project.narcs.marts) return 0;
  let count = 0;
  for (let martId = 0; martId < getMartCount(project); martId += 1) {
    const mart = getMartRecord(project, martId);
    const location = String(mart.readable.name ?? `Mart ${martId}`);
    for (let slot = 0; slot < 20; slot += 1) {
      const itemId = Number(mart.raw[`item_${slot}`] ?? 0);
      if (itemId <= 0) continue;
      addUnique(target, itemId, `Sold at ${location}`);
      count += 1;
    }
  }
  return count;
}

function addMartDexSources(project: ProjectState, out: Record<string, Record<string, unknown>>): void {
  if (!project.narcs.marts) return;
  for (let martId = 0; martId < getMartCount(project); martId += 1) {
    const mart = getMartRecord(project, martId);
    const location = String(mart.readable.name ?? `Mart ${martId}`);
    for (let slot = 0; slot < 20; slot += 1) {
      const itemName = String(mart.readable[`item_${slot}`] ?? "None");
      const key = toId(itemName);
      if (!out[key] || key === "none") continue;
      out[key].marts = unique([...(out[key].marts as string[] | undefined ?? []), location]);
    }
  }
}

function buildFormattedTrainerSets(project: ProjectState): Record<string, Record<string, unknown>> {
  if (!project.narcs.trdata || !project.narcs.trpok || !project.narcs.personal) return {};
  const docs = ensureDocs(project);
  if (Object.keys(docs.trainerDiffs).length === 0 && project.narcs.headers && project.narcs.overworlds) enrichTrainerLocations(project);
  const formatted: Record<string, Record<string, unknown>> = {};
  const nameCounts: Record<string, number> = {};
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    if (!project.narcs.trpok.rawFiles[trainerId]) continue;
    const trainer = getTrainerRecord(project, trainerId);
    const baseName = `${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}`.trim();
    nameCounts[baseName] = (nameCounts[baseName] ?? 0) + 1;
    for (const pok of trainer.party) {
      if (pok.ivs < 0) continue;
      const species = trainerPokemonExportName(project, pok);
      formatted[species] ??= {};
      const setName = trainerSetName(project, trainer, pok.level, nameCounts[baseName]);
      const iv = Math.floor((pok.ivs * 31) / 255);
      formatted[species][dedupeSetName(formatted[species], setName)] = {
        level: pok.level,
        ai: trainer.readable.ai ?? trainer.raw.ai ?? 0,
        noCh: false,
        tr_id: trainerId,
        diff: docs.trainerDiffs[String(trainerId)] ?? 0,
        ivs: { hp: iv, at: iv, df: iv, sa: iv, sd: iv, sp: iv },
        battle_type: trainer.readable.battle_type_1,
        reward_item: showdownItemName(trainer.readable.reward_item),
        item: showdownItemName(pok.itemName ?? "None"),
        gender: resolveTrainerPokemonGender(project, trainer.id, pok.slot),
        nature: pok.nature,
        moves: calcTrainerMoves(project, trainer, pok).map((move) => showdownName(move)),
        sub_index: pok.slot,
        ability: trainerPokemonExportAbility(project, pok),
        sprite: trainer.spritePath,
        form: pok.form,
        evs: { df: 0 },
      };
    }
  }
  return formatted;
}

function calcTrainerMoves(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot): Array<string | number> {
  const explicitMoves = pok.moves.filter((move) => Number(move) !== 0 && String(move).trim() !== "" && String(move) !== "0");
  if (explicitMoves.length > 0) return pok.moves;

  try {
    return getAutofilledTrainerPokemonMoveIds(project, pok.speciesId, pok.level).map((moveId) => project.texts.banks.moves?.[moveId] ?? moveId);
  } catch {
    return trainer.hasMoves ? pok.moves : [];
  }
}

function buildSearchIndexJs(overrides: Record<string, unknown>): string {
  const pokedex = overrides.poks as SearchCollection;
  const moves = overrides.moves as SearchCollection;
  const items = overrides.items as SearchCollection;
  const abilities = overrides.abilities as SearchCollection;
  const locations = overrides.encs as SearchCollection;
  const typeChart = Object.fromEntries(TYPES.map((type) => [type, {}]));
  let index: string[] = [];
  index = index.concat(Object.keys(pokedex).map((id) => `${cleanString(id)} pokemon`));
  index = index.concat(Object.keys(moves).map((id) => `${cleanString(id)} move`));
  index = index.concat(Object.keys(items).map((id) => `${id} item`));
  index = index.concat(Object.keys(abilities).map((id) => `${id} ability`));
  index = index.concat(TYPES.map((type) => `${toId(type)} type`));
  index = index.concat(Object.keys(locations).filter((id) => id !== "rates").map((id) => `${toId(id)} location`));
  index = index.concat(CATEGORIES.map((category) => `${toId(category)} category`));

  for (const [collection, type] of [
    [pokedex, "pokemon"],
    [moves, "move"],
    [items, "item"],
    [abilities, "ability"],
    [locations, "location"],
  ] as Array<[SearchCollection, string]>) {
    for (const [id, data] of Object.entries(collection)) {
      if (type === "location" && id === "rates") continue;
      generateAliases(index, id, data.name ?? id, type);
    }
  }

  index = unique(index).sort();
  const searchIndex = index.map((entry) => entry.split(" ").map((part, index) => (index === 3 ? Number(part) : part)));
  const offsets = searchIndex.map(() => "");
  const counts: Record<string, number> = {};
  for (const type of Object.keys(typeChart)) {
    counts[`${type} move`] = Object.values(moves).filter((move) => move.type === type || move.t === type).length;
    counts[`${type} pokemon`] = Object.values(pokedex).filter((pok) => pok.types?.includes(type)).length;
  }

  return [
    "// DO NOT EDIT - automatically built by Pokeweb Doc Generators",
    "",
    `exports.BattleSearchIndex = ${JSON.stringify(searchIndex)};`,
    "",
    `exports.BattleSearchIndexOffset = ${JSON.stringify(offsets)};`,
    "",
    `exports.BattleSearchCountIndex = ${JSON.stringify(counts)};`,
    "",
    "exports.BattleArticleTitles = {};",
    "",
  ].join("\n");
}

function scriptStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  let pointerOffset = 0;
  while (pointerOffset + 4 <= bytes.length && readU16(bytes, pointerOffset) !== 0xfd13) {
    const start = pointerOffset + readU32(bytes, pointerOffset) + 4;
    if (start >= 0 && start < bytes.length) starts.push(start);
    pointerOffset += 4;
  }
  return starts;
}

function enrichTrainerLocationsFromScripts(project: ProjectState, docs: DocGeneratorState): number {
  const scripts = project.narcs.scripts;
  if (!scripts || !project.headers) return 0;

  const maxTrainerId = project.narcs.trdata?.fileCount ? project.narcs.trdata.fileCount - 1 : 65535;
  let count = 0;
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    const row = project.headers.rows[rowId];
    const scriptId = Number(row.script_id ?? -1);
    const bytes = scripts.rawFiles[scriptId];
    if (!bytes?.length) continue;

    const location = String(row.location_name ?? `Header ${rowId - 1}`);
    const diff = Number(row.difficulty_level_adjustment ?? 0);
    for (const trainerId of parseTrainerBattleScripts(bytes, maxTrainerId)) {
      addTrainerSource(docs, trainerId, location, diff);
      count += 1;
    }
  }
  return count;
}

function locationForOverworld(project: ProjectState, overworldId: number): string {
  if (!project.headers) project.headers = parseHeaders(project);
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    const row = project.headers.rows[rowId];
    if (Number(row?.overworlds_id ?? row?.map_id) === overworldId) return String(row.location_name ?? `Overworld ${overworldId}`);
  }
  return `Overworld ${overworldId}`;
}

function difficultyForOverworld(project: ProjectState, overworldId: number): number {
  if (!project.headers) project.headers = parseHeaders(project);
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    const row = project.headers.rows[rowId];
    if (Number(row?.overworlds_id ?? row?.map_id) === overworldId) return Number(row.difficulty_level_adjustment ?? 0);
  }
  return 0;
}

function requireNarcs(project: ProjectState, names: Array<keyof ProjectState["narcs"]>): void {
  const missing = names.filter((name) => !project.narcs[name]);
  if (missing.length > 0) throw new Error(`Missing loaded data: ${missing.join(", ")}`);
}

function trainerSetName(project: ProjectState, trainer: TrainerRecord, level: number, duplicateIndex: number): string {
  const showDuplicate = duplicateIndex > 1 || String(trainer.readable.name ?? "") === "Grunt" || String(trainer.readable.name ?? "") === "Shadow";
  const base = `Lvl ${level} ${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}${showDuplicate ? duplicateIndex : ""}`.trim();
  const location = ensureDocs(project).trainerLocations[String(trainer.id)]?.[0];
  return location ? `${base} - ${location}` : base;
}

function dedupeSetName(existing: Record<string, unknown>, setName: string): string {
  if (!existing[setName]) return setName;
  let index = 2;
  while (existing[`${setName} ${index}`]) index += 1;
  return `${setName} ${index}`;
}

function moveFlags(readable: ReadableRecord): Record<string, unknown> {
  const flags: Record<string, boolean> = {};
  if (Number(readable.punch_move ?? 0) === 1) flags.punch = true;
  if (Number(readable.sound_move ?? 0) === 1) flags.sound = true;
  return Object.keys(flags).length > 0 ? { flags } : {};
}

function moveDescriptions(project: ProjectState): string[] {
  const bank = project.session.baseRom === "BW2" ? 402 : 202;
  try {
    return getTextBank(project, "message_texts", bank).map((entry) => String(entry?.[1] ?? "").replace(/\\n/gu, " "));
  } catch {
    return [];
  }
}

function itemDescriptions(project: ProjectState): string[] {
  const bank = project.session.baseRom === "BW2" ? 63 : 53;
  try {
    return getTextBank(project, "message_texts", bank).map((entry) => String(entry?.[1] ?? "").replace(/\\n/gu, " "));
  } catch {
    return [];
  }
}

function replacementMap(vanillaValues: string[], currentValues: string[], normalize: (value: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  vanillaValues.forEach((vanilla, index) => {
    const current = currentValues[index];
    if (current === undefined) return;
    const vanillaId = normalize(vanilla);
    const currentId = normalize(current);
    if (vanillaId && currentId && vanillaId !== currentId) out[vanillaId] = currentId;
  });
  return out;
}

function generateAliases(index: string[], id: string, name: string, type: string): void {
  const parts = name.split(/ |-/u).map(toId).filter(Boolean);
  if (parts.length < 2) return;
  const acronym = parts.map((part) => part[0]).join("") + parts.at(-1)!.slice(1);
  index.push(`${acronym} ${type} ${id} 0`);
  for (let n = 1; n < parts.length; n += 1) index.push(`${parts.slice(n).join("")} ${type} ${id} ${parts.slice(0, n).join("").length}`);
}

function addUnique(target: Record<string, string[]>, id: number, value: string): void {
  const key = String(id);
  target[key] = unique([...(target[key] ?? []), value]);
}

function addTrainerSource(docs: DocGeneratorState, trainerId: number, location: string, diff: number): void {
  addUnique(docs.trainerLocations, trainerId, location);
  const key = String(trainerId);
  const current = docs.trainerDiffs[key];
  docs.trainerDiffs[key] = current === undefined ? diff : Math.max(current, diff);
}

function addTrainerIds(target: number[], maxTrainerId: number, trainerIds: number[]): void {
  for (const trainerId of trainerIds) {
    if (trainerId > 0 && trainerId <= maxTrainerId) target.push(trainerId);
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function cleanString(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
}

function toId(value: string): string {
  return value.toLowerCase().replace(/é/gu, "e").replace(/[^a-z0-9]+/gu, "");
}

function showdownName(value: unknown): string {
  const titled = titleizeName(value).replace(/^Hp(?=\s)/u, "HP");
  return SHOWDOWN_SUBS[titled] ?? titled;
}

function showdownItemName(value: unknown): string {
  const name = String(value ?? "");
  return SHOWDOWN_ITEM_SUBS[name] ?? name;
}

function titleizeName(value: unknown): string {
  return String(value ?? "")
    .replace(/_/gu, " ")
    .split(/([\s-]+)/u)
    .map((part) => (/^[a-z]/iu.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("")
    .replace(/Porygon Z/gu, "Porygon-Z")
    .replace(/Ho Oh/gu, "Ho-Oh")
    .replace(/'/gu, "’");
}

function titleizeAbility(value: unknown): string {
  return titleizeName(value).replace(/Lightningrod/gu, "Lightning Rod").replace(/Compoundeyes/gu, "Compound Eyes");
}

function titleize(value: unknown): string {
  return titleizeName(value);
}

function formatTypes(pok: ReadableRecord): string {
  return unique([pok.type_1, pok.type_2].map((type) => titleizeName(type)).filter(Boolean)).join(" ");
}

function formatAbilities(pok: ReadableRecord): string {
  return [pok.ability_1, pok.ability_2, pok.ability_3].map((ability) => titleizeAbility(String(ability ?? "").replace(/-/gu, "").trim())).join(" / ");
}

function formatStats(pok: ReadableRecord): string {
  const stats = [
    ["base_hp", "HP"],
    ["base_atk", "Atk"],
    ["base_def", "Def"],
    ["base_spatk", "SAtk"],
    ["base_spdef", "SDef"],
    ["base_speed", "Spd"],
  ] as const;
  const values = stats.map(([field]) => Number(pok[field] ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  return `${stats.map(([field, label]) => `${pok[field] ?? 0} ${label}`).join(" / ")} / (${total}) BST`;
}

function maxTrainerLevel(trainer: TrainerRecord): number {
  return trainer.party.reduce((max, pok) => Math.max(max, pok.level), 0);
}

export function formatTrainerMoveName(move: string | number): string {
  if (move === 0 || move === "0") return "";
  return titleizeName(move);
}

export function safeFilename(value: string): string {
  return toId(value) || "pokeweb";
}

function lines(text: string): string[] {
  const out = text.split(/\r?\n/u).map((line) => line.trim());
  while (out.at(-1) === "") out.pop();
  return out;
}

function zipStored(files: Array<{ filename: string; contents: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.filename);
    const data = encoder.encode(file.contents);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800);
    writeU16(local, 8, 0);
    writeU16(local, 10, 0);
    writeU16(local, 12, 0);
    writeU32(local, 14, crc);
    writeU32(local, 18, data.length);
    writeU32(local, 22, data.length);
    writeU16(local, 26, name.length);
    writeU16(local, 28, 0);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0x0800);
    writeU16(central, 10, 0);
    writeU16(central, 12, 0);
    writeU16(central, 14, 0);
    writeU32(central, 16, crc);
    writeU32(central, 20, data.length);
    writeU32(central, 24, data.length);
    writeU16(central, 28, name.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, 0);
    writeU32(central, 42, offset);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, files.length);
  writeU16(eocd, 10, files.length);
  writeU32(eocd, 12, centralSize);
  writeU32(eocd, 16, centralOffset);
  writeU16(eocd, 20, 0);

  return concatBytes([...localParts, ...centralParts, eocd]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
