import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
import white2 from "../assets/codeinjection/trainerFieldConditionsManifest.json";
import black2 from "../assets/codeinjection/trainerFieldConditionsB2Manifest.json";
import previous from "../assets/codeinjection/trainerFieldConditionsPrevious.json";

const profiles = { W2: white2, B2: black2 };
type Game = keyof typeof profiles;
const isGame = (game: unknown): game is Game => game === "W2" || game === "B2";

export const TRAINER_FIELD_CONDITIONS_PATH = "battle/trainer-fields.bin";
export const TRAINER_FIELD_CONDITIONS_VERSION = white2.version;
const DLL_URLS = {
  W2: new URL("../assets/codeinjection/TrainerFieldConditionsW2.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/TrainerFieldConditionsB2.dll", import.meta.url),
};
const HEADER_SIZE = 16;
const RECORD_SIZE = 12;
const FIELD_MASK = 0xf6;
const SIDE_MASK = 0x393f;
export const TRAINER_FIELD_WEATHERS = ["Inherit battle weather", "Clear", "Sun", "Rain", "Hail", "Sandstorm"] as const;
export const TRAINER_GLOBAL_CONDITIONS = [
  { id: 1, label: "Trick Room" }, { id: 2, label: "Gravity" },
  { id: 4, label: "Water Sport" }, { id: 5, label: "Mud Sport" },
  { id: 6, label: "Wonder Room" }, { id: 7, label: "Magic Room" },
] as const;
export const TRAINER_SIDE_CONDITIONS = [
  { id: 0, label: "Reflect" }, { id: 1, label: "Light Screen" }, { id: 2, label: "Safeguard" },
  { id: 3, label: "Mist" }, { id: 4, label: "Tailwind" }, { id: 5, label: "Lucky Chant" },
  { id: 8, label: "Stealth Rock" }, { id: 11, label: "Rainbow" },
  { id: 12, label: "Sea of Fire" }, { id: 13, label: "Swamp" },
] as const;
export type TrainerFieldConditions = {
  weather: number;
  fields: number;
  player: number;
  opponent: number;
  playerSpikes: number;
  playerToxicSpikes: number;
  opponentSpikes: number;
  opponentToxicSpikes: number;
};
export function emptyTrainerFieldConditions(): TrainerFieldConditions {
  return { weather: 0, fields: 0, player: 0, opponent: 0, playerSpikes: 0, playerToxicSpikes: 0, opponentSpikes: 0, opponentToxicSpikes: 0 };
}
type RetainedSources = {
  idCode: string; revision: number; arm9RamAddress: number; overlayTable: Uint8Array;
  paths: Record<string, number>; files: Record<number, Uint8Array>;
};
const retainedSources = new WeakMap<ProjectState, RetainedSources>();
/** Keep only patch inputs when autosave releases the full ROM. Rebuilt on load. */
export function hydrateTrainerFieldConditionsSources(project: ProjectState, rom: NintendoDSRom): void {
  if (!Object.values(profiles).some(profile => rom.idCode === profile.idCode)) return;
  const source: RetainedSources = { idCode: rom.idCode, revision: rom.data[0x1e], arm9RamAddress: rom.arm9RamAddress,
    overlayTable: rom.arm9OverlayTable.slice(), paths: {}, files: {} };
  for (const path of [TRAINER_FIELD_CONDITIONS_PATH, ...listCodeInjectionDlls(project).map(entry => entry.path)]) {
    const id = rom.filenames.idOf(path);
    if (id !== undefined) { source.paths[path.toLowerCase()] = id; source.files[id] = rom.files[id].slice(); }
  }
  try {
    const overlays = loadOverlayTable(rom.arm9OverlayTable, (_, id) => rom.files[id], new Set([167, 169]));
    for (const overlay of overlays.values()) source.files[overlay.fileId] = rom.files[overlay.fileId].slice();
    retainedSources.set(project, source);
  } catch {
    // An unavailable optional battle interface must not prevent other editors loading.
    retainedSources.delete(project);
  }
}
const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
function sourceRom(project: ProjectState): NintendoDSRom | undefined {
  const bytes = project.originalRomBytes;
  if (!bytes) return undefined;
  let rom = romCache.get(bytes);
  if (!rom) { rom = new NintendoDSRom(bytes, { fileData: "view" }); romCache.set(bytes, rom); }
  return rom;
}
function fileBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(key => key.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const rom = sourceRom(project), retained = retainedSources.get(project);
  const id = rom?.filenames.idOf(path) ?? retained?.paths[path.toLowerCase()];
  if (id === undefined) return undefined;
  return rom ? getRomFileBytes(project, rom, id) : project.fileSystem?.replacements?.[id] ?? retained?.files[id];
}
function stageFile(project: ProjectState, bytes: Uint8Array): void {
  const rom = sourceRom(project), id = rom?.filenames.idOf(TRAINER_FIELD_CONDITIONS_PATH) ?? retainedSources.get(project)?.paths[TRAINER_FIELD_CONDITIONS_PATH];
  if (id === undefined) addRomFile(project, TRAINER_FIELD_CONDITIONS_PATH, bytes);
  else setRomFileReplacement(project, id, bytes);
}
function checkedInteger(value: number, max: number): boolean { return Number.isInteger(value) && value >= 0 && value <= max; }
function validateConditions(c: TrainerFieldConditions): void {
  if (!checkedInteger(c.weather, 5) || !checkedInteger(c.fields, FIELD_MASK) || (c.fields & ~FIELD_MASK)
    || !checkedInteger(c.player, SIDE_MASK) || (c.player & ~SIDE_MASK)
    || !checkedInteger(c.opponent, SIDE_MASK) || (c.opponent & ~SIDE_MASK)
    || !checkedInteger(c.playerSpikes, 3) || !checkedInteger(c.opponentSpikes, 3)
    || !checkedInteger(c.playerToxicSpikes, 2) || !checkedInteger(c.opponentToxicSpikes, 2))
    throw new Error("Invalid trainer field conditions.");
}
function tableCount(bytes: Uint8Array): number {
  if (bytes.length < HEADER_SIZE || readU32(bytes, 0) !== 0x43465750 || readU16(bytes, 4) !== 1
    || readU16(bytes, 6) !== RECORD_SIZE || readU32(bytes, 12) !== 0) throw new Error("Unrecognized trainer field conditions table.");
  const count = readU32(bytes, 8);
  if (count < 1 || count > 65536 || bytes.length !== HEADER_SIZE + count * RECORD_SIZE)
    throw new Error("Invalid trainer field conditions table length.");
  return count;
}
export function createTrainerFieldTable(count: number): Uint8Array {
  if (!checkedInteger(count, 65536) || count === 0) throw new Error("Invalid trainer count.");
  const bytes = new Uint8Array(HEADER_SIZE + RECORD_SIZE * count);
  writeU32(bytes, 0, 0x43465750); writeU16(bytes, 4, 1); writeU16(bytes, 6, RECORD_SIZE); writeU32(bytes, 8, count);
  return bytes;
}
export function readTrainerFieldTable(bytes: Uint8Array, trainerId: number): TrainerFieldConditions {
  const count = tableCount(bytes);
  if (!checkedInteger(trainerId, 65535)) throw new Error("Invalid trainer ID.");
  if (trainerId >= count) return emptyTrainerFieldConditions();
  const at = HEADER_SIZE + trainerId * RECORD_SIZE;
  const conditions = {
    weather: bytes[at], fields: readU16(bytes, at + 2), player: readU16(bytes, at + 4), opponent: readU16(bytes, at + 6),
    playerSpikes: bytes[at + 8], playerToxicSpikes: bytes[at + 9], opponentSpikes: bytes[at + 10], opponentToxicSpikes: bytes[at + 11],
  };
  if (bytes[at + 1] !== 0) throw new Error("Unrecognized trainer field conditions record.");
  validateConditions(conditions);
  return conditions;
}
export function writeTrainerFieldTable(bytes: Uint8Array, trainerId: number, conditions: TrainerFieldConditions): Uint8Array {
  const count = tableCount(bytes);
  if (!checkedInteger(trainerId, 65535)) throw new Error("Invalid trainer ID.");
  validateConditions(conditions);
  const result = createTrainerFieldTable(Math.max(count, trainerId + 1));
  result.set(bytes.subarray(HEADER_SIZE), HEADER_SIZE);
  const at = HEADER_SIZE + trainerId * RECORD_SIZE;
  result[at] = conditions.weather; writeU16(result, at + 2, conditions.fields);
  writeU16(result, at + 4, conditions.player); writeU16(result, at + 6, conditions.opponent);
  result.set([conditions.playerSpikes, conditions.playerToxicSpikes, conditions.opponentSpikes, conditions.opponentToxicSpikes], at + 8);
  return result;
}
export function getTrainerFieldConditions(project: ProjectState, trainerId: number): TrainerFieldConditions {
  const bytes = fileBytes(project, TRAINER_FIELD_CONDITIONS_PATH);
  return bytes ? readTrainerFieldTable(bytes, trainerId) : emptyTrainerFieldConditions();
}
export function updateTrainerFieldCondition(project: ProjectState, trainerId: number, field: string, value: number): void {
  const status = getTrainerFieldConditionsStatus(project);
  if (!status.installed || !status.compatible) throw new Error(status.message);
  if (!checkedInteger(trainerId, (project.narcs.trdata?.fileCount ?? 0) - 1)) throw new Error("Trainer does not exist.");
  const before = getTrainerFieldConditions(project, trainerId), next = { ...before };
  const match = /^(fields|player|opponent)_(\d+)$/u.exec(field);
  if (match) {
    const bit = Number(match[2]), mask = match[1] === "fields" ? FIELD_MASK : SIDE_MASK;
    if (bit > 13 || !(mask & (1 << bit)) || (value !== 0 && value !== 1)) throw new Error("Invalid field condition.");
    const key = match[1] as "fields" | "player" | "opponent";
    next[key] = value ? next[key] | (1 << bit) : next[key] & ~(1 << bit);
  } else if (["weather", "playerSpikes", "playerToxicSpikes", "opponentSpikes", "opponentToxicSpikes"].includes(field)) {
    next[field as keyof TrainerFieldConditions] = value;
  } else throw new Error("Unknown field condition.");
  validateConditions(next);
  if (JSON.stringify(before) === JSON.stringify(next)) return;
  const bytes = fileBytes(project, TRAINER_FIELD_CONDITIONS_PATH) ?? createTrainerFieldTable(project.narcs.trdata!.fileCount);
  stageFile(project, writeTrainerFieldTable(bytes, trainerId, next));
  recordGenericChange(project, "trdata", `Updated battle field conditions for trainer ${trainerId}.`, "Trainer Field Conditions", { key: `trainer-field:${trainerId}` });
}
/** Preserve battle configuration when Add Trainer clones an existing trainer. */
export function cloneTrainerFieldConditions(project: ProjectState, source: number, target: number): void {
  const bytes = fileBytes(project, TRAINER_FIELD_CONDITIONS_PATH);
  if (bytes) stageFile(project, writeTrainerFieldTable(bytes, target, readTrainerFieldTable(bytes, source)));
}
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export function isTrainerFieldConditionsModule(rpm: RpmModule, game?: Game): boolean {
  const target = rpm.metadata.PMCGameID;
  if (!isGame(target) || (game !== undefined && target !== game)) return false;
  return matchesModule(rpm, profiles[target]);
}
function matchesModule(rpm: RpmModule, manifest: Pick<typeof white2, "version" | "bss" | "codeHex" | "relocations">): boolean {
  const types = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"];
  return rpm.metadata.PMCVersion === manifest.version && rpm.metadata.PMCModulePriority === 4
    && rpm.baseAddress === 0 && rpm.bssSize === manifest.bss && hex(rpm.code) === manifest.codeHex
    && !rpm.symbols.some(symbol => symbol.attributes & 2)
    && JSON.stringify(rpm.relocations.map(({ target: t, sourceSymbolIndex: i }) => {
      const s = rpm.symbols[i]; return `${t.module}:${t.address.toString(16)}:${t.type}:${s.address.toString(16)}:${types.indexOf(s.type)}:${s.attributes}`;
    }).sort()) === JSON.stringify(manifest.relocations);
}
function isKnownModule(rpm: RpmModule, game?: Game): boolean {
  const target = rpm.metadata.PMCGameID;
  return isGame(target) && (game === undefined || game === target)
    && (matchesModule(rpm, profiles[target]) || matchesModule(rpm, previous[target]));
}
export function getTrainerFieldConditionsStatus(project: ProjectState) {
  const state = { supported: false, compatible: false, installed: false, updateAvailable: false,
    message: "Trainer Field Conditions supports English US revision-0 Black 2 and White 2. Other regions, revisions and BW1 require separate native bindings." };
  const game = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || !isGame(game)) return state;
  const manifest = profiles[game];
  try {
    const rom = sourceRom(project), retained = retainedSources.get(project);
    if ((rom?.idCode ?? retained?.idCode ?? project.romInfo?.idCode) !== manifest.idCode
      || (project.originalRomBytes?.[0x1e] ?? retained?.revision ?? 0) !== 0) return state;
    state.supported = true;
    let matches = 0;
    for (const entry of listCodeInjectionDlls(project)) {
      const raw = fileBytes(project, entry.path);
      let rpm: RpmModule | undefined;
      try { if (raw) rpm = parseRpm(raw, { allowedMagics: ["DLXF"] }); } catch { /* Reserved names still conflict. */ }
      if (rpm && isKnownModule(rpm, game)) {
        if (entry.target !== "patches" || entry.fileName !== manifest.fileName) throw new Error("Restore the standard Trainer Field Conditions filename in patches/.");
        ++matches;
        state.updateAvailable ||= !isTrainerFieldConditionsModule(rpm, game);
      } else if (Object.values(profiles).some(p => entry.fileName.toLowerCase() === p.fileName.toLowerCase())
        || (rpm && isKnownModule(rpm)) || rpm?.relocations.some(({ target: t, sourceSymbolIndex: i }) => {
        const size = t.type === "FULL_COPY" ? rpm!.symbols[i]?.size ?? 0 : t.type === "THUMB_BRANCH_SAFESTACK" ? 16 : t.type === "THUMB_BRANCH" ? 12 : 4;
        return manifest.hooks.some(h => t.module === h.module && t.address < h.address + h.patchSize && t.address + size > h.address);
      })) throw new Error(`Conflicting trainer field runtime: ${entry.path}.`);
    }
    if (matches > 1) throw new Error("Remove the duplicate Trainer Field Conditions DLL.");
    state.installed = matches === 1;
    const config = fileBytes(project, TRAINER_FIELD_CONDITIONS_PATH);
    if (config) tableCount(config);
    if (!rom && !retained) return { ...state, message: "Reload the ROM to verify the battle interfaces." };
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom?.arm9OverlayTable ?? retained!.overlayTable,
      (_, id) => rom ? getRomFileBytes(project, rom, id) : project.fileSystem?.replacements?.[id] ?? retained!.files[id], new Set([167, 169]));
    for (const s of manifest.signatures) {
      const overlay = overlays.get(Number(s.module)), base = s.module === "ARM9" ? rom?.arm9RamAddress ?? retained!.arm9RamAddress : overlay?.ramAddress;
      const candidates = s.module === "ARM9" ? [project.arm9] : [overlay?.data, project.overlays[Number(s.module)] ?? overlay?.data];
      const at = base === undefined ? -1 : s.address - base;
      if (candidates.some(data => !data || at < 0 || hex(data.subarray(at, at + s.expectedHex.length / 2)) !== s.expectedHex))
        throw new Error(`Unrecognized ${s.label} at 0x${s.address.toString(16)}.`);
    }
    state.compatible = true;
    state.message = state.updateAvailable ? "Update available."
      : state.installed ? "Installed. Configure battle conditions in each trainer's settings. Export the ROM to keep changes."
      : "Ready. Conditions are applied once before entry abilities and persist until removed or replaced.";
  } catch (error) { state.message = error instanceof Error ? error.message : String(error); }
  return state;
}
export async function installTrainerFieldConditions(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, async staged => {
    const status = getTrainerFieldConditionsStatus(staged);
    if (!status.compatible) throw new Error(status.message);
    const game = staged.session.baseVersion;
    if (!isGame(game)) throw new Error(status.message);
    const manifest = profiles[game];
    if (!status.installed || status.updateAvailable) {
      const response = await fetch(DLL_URLS[game]);
      if (!response.ok) throw new Error(`Could not load Trainer Field Conditions (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isTrainerFieldConditionsModule(parseRpm(bytes, { allowedMagics: ["DLXF"] }), game)) throw new Error("Trainer Field Conditions bundle failed its integrity check.");
      stageCodeInjectionDll(staged, manifest.fileName, bytes);
    }
    // Existing authored records are retained on every installation.
    if (!fileBytes(staged, TRAINER_FIELD_CONDITIONS_PATH)) stageFile(staged, createTrainerFieldTable(Math.max(1, staged.narcs.trdata?.fileCount ?? 1)));
    recordGenericChange(staged, "code_injection", "Installed permanent, removable trainer battle field conditions.", "Trainer Field Conditions", { key: "code-injection:trainer-field-conditions" });
  });
}
