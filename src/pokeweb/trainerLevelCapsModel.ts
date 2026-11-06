import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import profiles from "../assets/codeinjection/trainerLevelCapsManifest.json";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { getLevelCapsStatus, LEVEL_CAP_WORK_VARIABLE } from "./levelCapsModel";
import { inspectLevelCapsRuntime } from "./levelCapsRuntime";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

type Game = keyof typeof profiles;
const isGame = (game: unknown): game is Game => game === "B2" || game === "W2";
const urls = {
  B2: new URL("../assets/codeinjection/TrainerLevelCapsB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/TrainerLevelCapsW2.dll", import.meta.url),
};
export const TRAINER_LEVEL_CAPS_PATH = "battle/trainer-caps.bin";
const HEADER = 16;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const integer = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max;
const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
type Source = { idCode: string; revision: number; overlayTable: Uint8Array; paths: Record<string, number>; files: Record<number, Uint8Array> };
const sources = new WeakMap<ProjectState, Source>();
function sourceRom(project: ProjectState): NintendoDSRom | undefined {
  if (!project.originalRomBytes) return;
  let rom = romCache.get(project.originalRomBytes);
  if (!rom) { rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); romCache.set(project.originalRomBytes, rom); }
  return rom;
}
/** Preserve the small editor inputs when autosave releases the full source ROM. */
export function hydrateTrainerLevelCapsSources(project: ProjectState, rom: NintendoDSRom): void {
  if (!Object.values(profiles).some(p => p.idCode === rom.idCode)) return;
  const source: Source = { idCode: rom.idCode, revision: rom.data[0x1e], overlayTable: rom.arm9OverlayTable.slice(), paths: {}, files: {} };
  for (const path of [TRAINER_LEVEL_CAPS_PATH, ...listCodeInjectionDlls(project).map(m => m.path)]) {
    const id = rom.filenames.idOf(path);
    if (id !== undefined) { source.paths[path.toLowerCase()] = id; source.files[id] = rom.files[id].slice(); }
  }
  try {
    const overlay = loadOverlayTable(rom.arm9OverlayTable, (_, id) => rom.files[id], new Set([12])).get(12);
    if (overlay) source.files[overlay.fileId] = rom.files[overlay.fileId].slice();
    sources.set(project, source);
  } catch { sources.delete(project); }
}
function fileBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(key => key.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const rom = sourceRom(project), retained = sources.get(project);
  const id = rom?.filenames.idOf(path) ?? retained?.paths[path.toLowerCase()];
  return id === undefined ? undefined : rom ? getRomFileBytes(project, rom, id) : project.fileSystem?.replacements?.[id] ?? retained?.files[id];
}
function stageTable(project: ProjectState, bytes: Uint8Array): void {
  const id = sourceRom(project)?.filenames.idOf(TRAINER_LEVEL_CAPS_PATH) ?? sources.get(project)?.paths[TRAINER_LEVEL_CAPS_PATH];
  if (id === undefined) addRomFile(project, TRAINER_LEVEL_CAPS_PATH, bytes);
  else setRomFileReplacement(project, id, bytes);
}
function tableCount(bytes: Uint8Array): number {
  if (bytes.length < HEADER || readU32(bytes, 0) !== 0x434c5750 || readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== 1
    || readU32(bytes, 12) !== LEVEL_CAP_WORK_VARIABLE) throw new Error("Unrecognized trainer level cap table.");
  const count = readU32(bytes, 8);
  if (!integer(count, 65536) || count === 0 || bytes.length !== HEADER + count) throw new Error("Invalid trainer level cap table length.");
  return count;
}
export function createTrainerLevelCapTable(count: number): Uint8Array {
  if (!integer(count, 65536) || count === 0) throw new Error("Invalid trainer count.");
  const bytes = new Uint8Array(HEADER + count);
  writeU32(bytes, 0, 0x434c5750); writeU16(bytes, 4, 1); writeU16(bytes, 6, 1);
  writeU32(bytes, 8, count); writeU32(bytes, 12, LEVEL_CAP_WORK_VARIABLE);
  return bytes;
}
export function readTrainerLevelCapTable(bytes: Uint8Array, trainerId: number): number {
  const count = tableCount(bytes);
  if (!integer(trainerId, 65535)) throw new Error("Invalid trainer ID.");
  const cap = trainerId < count ? bytes[HEADER + trainerId] : 0;
  if (cap > 100) throw new Error("Invalid trainer level cap.");
  return cap;
}
export function writeTrainerLevelCapTable(bytes: Uint8Array, trainerId: number, cap: number): Uint8Array {
  const count = tableCount(bytes);
  if (!integer(trainerId, 65535) || !integer(cap, 100)) throw new Error("Trainer level cap must be 0–100.");
  const result = createTrainerLevelCapTable(Math.max(count, trainerId + 1));
  result.set(bytes.subarray(HEADER), HEADER); result[HEADER + trainerId] = cap;
  return result;
}
export function getTrainerLevelCap(project: ProjectState, trainerId: number): number {
  const bytes = fileBytes(project, TRAINER_LEVEL_CAPS_PATH);
  return bytes ? readTrainerLevelCapTable(bytes, trainerId) : 0;
}
export function updateTrainerLevelCap(project: ProjectState, trainerId: number, cap: number): void {
  const status = getTrainerLevelCapsStatus(project);
  if (!status.installed || !status.compatible) throw new Error(status.message);
  if (!integer(trainerId, (project.narcs.trdata?.fileCount ?? 0) - 1)) throw new Error("Trainer does not exist.");
  const before = getTrainerLevelCap(project, trainerId);
  const bytes = fileBytes(project, TRAINER_LEVEL_CAPS_PATH) ?? createTrainerLevelCapTable(project.narcs.trdata!.fileCount);
  const next = writeTrainerLevelCapTable(bytes, trainerId, cap);
  if (before === cap) return;
  stageTable(project, next);
  recordGenericChange(project, "trdata", `Trainer ${trainerId}: Lvl Cap after Win ${before} → ${cap}.`, "Trainer Level Caps",
    { key: `trainer:${trainerId}:data:level_cap_after_win` });
}
export function cloneTrainerLevelCap(project: ProjectState, source: number, target: number): void {
  const bytes = fileBytes(project, TRAINER_LEVEL_CAPS_PATH);
  if (bytes) stageTable(project, writeTrainerLevelCapTable(bytes, target, readTrainerLevelCapTable(bytes, source)));
}
export function isTrainerLevelCapsModule(rpm: RpmModule, game: Game): boolean {
  const expected = profiles[game], types = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"];
  return rpm.metadata.PMCGameID === game && rpm.metadata.PMCVersion === expected.version && rpm.metadata.PMCModulePriority === 4
    && rpm.baseAddress === 0 && rpm.bssSize === expected.bssSize && hex(rpm.code) === expected.codeHex
    && rpm.symbols.length === expected.symbols.length && rpm.relocations.length === expected.relocations.length
    && expected.symbols.every((s, i) => {
      const actual = rpm.symbols[i];
      return actual.address === s.address && actual.size === s.size && actual.type === types[s.type] && actual.attributes === s.attributes;
    }) && expected.relocations.every(r => rpm.relocations.filter(a => a.target.address === r.address && a.target.module === r.module
      && a.target.type === r.type && a.sourceSymbolIndex === r.symbol).length === 1);
}
export function getTrainerLevelCapsStatus(project: ProjectState) {
  const state = { supported: false, compatible: false, installed: false, message: "Trainer Level Caps requires US revision-0 Black 2 or White 2 and Hard Level Caps." };
  const game = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || !isGame(game)) return state;
  try {
    const p = profiles[game], rom = sourceRom(project), retained = sources.get(project);
    if ((rom?.idCode ?? retained?.idCode ?? project.romInfo.idCode) !== p.idCode || (rom?.data[0x1e] ?? retained?.revision ?? 0) !== 0) return state;
    state.supported = true;
    let matches = 0, baseInstalled = false;
    for (const entry of listCodeInjectionDlls(project)) {
      const bytes = fileBytes(project, entry.path);
      let rpm: RpmModule | undefined;
      try { if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { /* Reserved filenames still conflict. */ }
      if (rpm && isTrainerLevelCapsModule(rpm, game)) {
        if (entry.target !== "patches" || entry.fileName !== p.fileName) throw new Error("Restore the standard Trainer Level Caps filename in patches/.");
        ++matches; state.installed = true;
      } else if (Object.values(profiles).some(profile => profile.fileName.toLowerCase() === entry.fileName.toLowerCase())
        || (rpm && Object.keys(profiles).some(g => isTrainerLevelCapsModule(rpm!, g as Game)))
        || rpm?.relocations.some(({ target: t, sourceSymbolIndex: i }) => {
          const size = t.type === "FULL_COPY" ? rpm!.symbols[i]?.size ?? 0 : t.type === "THUMB_BRANCH_SAFESTACK" ? 16 : t.type === "THUMB_BRANCH" ? 12 : 4;
          return t.module === "12" && t.address < p.signatureAddress + p.expectedHex.length / 2 && t.address + size > p.signatureAddress;
        })) throw new Error(`Conflicting trainer level cap runtime: ${entry.path}.`);
      if (entry.target === "patches" && entry.fileName.toLowerCase() === `hardlevelcaps${game}.dll`.toLowerCase()
        && rpm && inspectLevelCapsRuntime(rpm, game)) baseInstalled = true;
    }
    if (matches > 1) throw new Error("Remove the duplicate Trainer Level Caps DLL.");
    if (!baseInstalled) throw new Error("Install Hard Level Caps first.");
    const config = fileBytes(project, TRAINER_LEVEL_CAPS_PATH);
    if (config) { tableCount(config); if (config.subarray(HEADER).some(cap => cap > 100)) throw new Error("Invalid trainer level cap."); }
    if (!rom && !retained) throw new Error("Reload the ROM to verify the battle-return hook.");
    const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom?.arm9OverlayTable ?? retained!.overlayTable,
      (_, id) => rom ? getRomFileBytes(project, rom, id) : project.fileSystem?.replacements?.[id] ?? retained!.files[id], new Set([12])).get(12);
    const at = p.signatureAddress - (overlay?.ramAddress ?? 0);
    for (const data of [overlay?.data, project.overlays[12] ?? overlay?.data])
      if (!data || at < 0 || hex(data.subarray(at, at + p.expectedHex.length / 2)) !== p.expectedHex)
        throw new Error("The trainer battle-return code differs from the supported US BW2 code.");
    state.compatible = true;
    state.message = state.installed ? "Installed." : "Ready.";
  } catch (error) { state.message = error instanceof Error ? error.message : String(error); }
  return state;
}
export async function installTrainerLevelCaps(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, async staged => {
    const base = getLevelCapsStatus(staged), status = getTrainerLevelCapsStatus(staged);
    if (!base.installed || !base.compatible) throw new Error(base.installed ? base.message : "Install Hard Level Caps first.");
    if (!status.compatible) throw new Error(status.message);
    const game = staged.session.baseVersion;
    if (!isGame(game)) throw new Error(status.message);
    if (!status.installed) {
      const response = await fetch(urls[game]);
      if (!response.ok) throw new Error(`Could not load Trainer Level Caps (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isTrainerLevelCapsModule(parseRpm(bytes, { allowedMagics: ["DLXF"] }), game)) throw new Error("Trainer Level Caps bundle failed its integrity check.");
      stageCodeInjectionDll(staged, profiles[game].fileName, bytes);
    }
    if (!fileBytes(staged, TRAINER_LEVEL_CAPS_PATH)) stageTable(staged, createTrainerLevelCapTable(Math.max(1, staged.narcs.trdata?.fileCount ?? 1)));
    recordGenericChange(staged, "code_injection", "Installed trainer victory level caps.", "Trainer Level Caps", { key: "code-injection:trainer-level-caps" });
  });
}
