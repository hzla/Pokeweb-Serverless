import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import manifest from "../assets/codeinjection/trainerCustomizationManifest.json";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { getOverlayInfo, getOverlayWorkingBytes, isOverlayStaged } from "./overlayEditModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { detectSpecifyTrainerNaturesPatch } from "./romPatchModel";
import { parseRpm } from "./rpm";
import { hasTrainerNaturePmcSetupSignatures, restoreLegacyTrainerNaturePatchToArm9 } from "./trainerNaturePatch";

import {
  changeTrainerMemberSetting, DEFAULT_TRAINER_MEMBER_SETTINGS, readTrainerMemberSettings, validTrainerMemberSettings,
  writeTrainerMemberSettings, TRAINER_HP_OPTIONS, TRAINER_SHINY_OPTIONS, TRAINER_STATUS_OPTIONS, type TrainerMemberSettings,
} from "./trainerMemberSettings";

const PATH = "battle/trainer-customization.bin";
const MAGIC = 0x43545750;
const HEADER = 16;
const MEMBER = 6;
const PARTY = 6 * MEMBER;
const ASSETS = {
  B2: new URL("../assets/codeinjection/TrainerCustomizationB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/TrainerCustomizationW2.dll", import.meta.url),
};

export { TRAINER_SHINY_OPTIONS, TRAINER_STATUS_OPTIONS, TRAINER_HP_OPTIONS, type TrainerMemberSettings } from "./trainerMemberSettings";
type Game = keyof typeof manifest;
type Status = "unsupported" | "unknown" | "ready" | "upgrade" | "installed";
const sourceFiles = new WeakMap<ProjectState, Map<string, { id: number; bytes: Uint8Array }>>();

function gameFor(project: ProjectState): Game | undefined {
  const game = project.session.baseVersion;
  if (project.session.baseRom === "BW2" && (game === "B2" || game === "W2")
    && project.romInfo?.idCode === manifest[game].gameCode) return game;
}

const dllName = (game: Game) => `TrainerNature${game}.dll`;

/**
 * The installed module's hash, worked out once per byte array. The editor asks which version is installed on every
 * render (and once per trainer when listing rosters), and a fresh SHA-256 of the module each time made that slow.
 * Installing or replacing the module stores a new array, so a new array gets a new hash.
 */
const moduleHashes = new WeakMap<Uint8Array, string>();
function moduleHash(module: Uint8Array): string {
  let hash = moduleHashes.get(module);
  if (hash === undefined) moduleHashes.set(module, hash = sha256Hex(module));
  return hash;
}

export function hydrateTrainerCustomizationSources(project: ProjectState, rom: NintendoDSRom): void {
  const game = gameFor(project);
  if (!game) return;
  const files = new Map<string, { id: number; bytes: Uint8Array }>();
  for (const path of [PATH, `patches/${dllName(game)}`]) {
    const id = rom.filenames.idOf(path);
    if (id !== undefined) files.set(path, { id, bytes: rom.files[id].slice() });
  }
  sourceFiles.set(project, files);
}

function file(project: ProjectState, path: string) {
  const source = sourceFiles.get(project)?.get(path);
  return project.fileSystem?.additions?.[path]
    ?? (source && (project.fileSystem?.replacements?.[source.id] ?? source.bytes));
}

function readProjectFile(project: ProjectState, path: string, rom?: NintendoDSRom): Uint8Array | undefined {
  const id = rom?.filenames.idOf(path);
  return file(project, path) ?? (rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined);
}

export function getTrainerCustomizationStatus(project: ProjectState): Status {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return "unsupported";
  const state = detectSpecifyTrainerNaturesPatch(project);
  const module = file(project, `patches/${dllName(game)}`);
  if (module) {
    const hash = moduleHash(module);
    if (hash === manifest[game].sha256) return state === "legacy" ? "upgrade" : "installed";
    if ([manifest[game].legacySha256, manifest[game].previousSha256, manifest[game].weightedSha256, manifest[game].conditionalSha256, manifest[game].linkedPoolsSha256, manifest[game].directPoolsSha256, manifest[game].fixedPartiesSha256, manifest[game].slotPoolsSha256, manifest[game].movePoolsSha256].includes(hash)) return "upgrade";
    return "unknown";
  }
  return state === "legacy" || state === "patched" ? "upgrade" : state === "unpatched" ? "ready" : "unknown";
}

/**
 * Whether the editor offers Trainer Customization's features: it is installed, or it can be installed or updated
 * here. Editors show the controls either way and install the patch the first time one is used.
 */
export function trainerCustomizationAvailable(project: ProjectState): boolean {
  const status = getTrainerCustomizationStatus(project);
  return status === "installed" || status === "ready" || status === "upgrade";
}

/** True when an edit needs Trainer Customization installed (or updated) first. */
export function trainerCustomizationNeedsInstall(project: ProjectState): boolean {
  const status = getTrainerCustomizationStatus(project);
  return status === "ready" || status === "upgrade";
}

export function hasTrainerMemberCustomization(project: ProjectState): boolean {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return false;
  const module = file(project, `patches/${dllName(game)}`);
  if (!module) return false;
  const hash = moduleHash(module);
  return [manifest[game].sha256, manifest[game].previousSha256, manifest[game].weightedSha256, manifest[game].conditionalSha256, manifest[game].linkedPoolsSha256, manifest[game].directPoolsSha256, manifest[game].fixedPartiesSha256, manifest[game].slotPoolsSha256, manifest[game].movePoolsSha256].includes(hash);
}

export function hasWeightedTrainerRosters(project: ProjectState): boolean {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return false;
  const module = file(project, `patches/${dllName(game)}`);
  return !!module && [manifest[game].sha256, manifest[game].weightedSha256, manifest[game].conditionalSha256, manifest[game].linkedPoolsSha256, manifest[game].directPoolsSha256, manifest[game].fixedPartiesSha256, manifest[game].slotPoolsSha256, manifest[game].movePoolsSha256].includes(moduleHash(module));
}

export function hasConditionalTrainerRosters(project: ProjectState): boolean {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return false;
  const module = file(project, `patches/${dllName(game)}`);
  return !!module && [manifest[game].sha256, manifest[game].conditionalSha256, manifest[game].linkedPoolsSha256, manifest[game].directPoolsSha256, manifest[game].fixedPartiesSha256, manifest[game].slotPoolsSha256, manifest[game].movePoolsSha256].includes(moduleHash(module));
}

/** Per-slot move pools: supported runtimes roll each move slot from its alternatives. */
export function hasTrainerMovePools(project: ProjectState): boolean {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return false;
  const module = file(project, `patches/${dllName(game)}`);
  return !!module && [manifest[game].sha256, manifest[game].movePoolsSha256].includes(moduleHash(module));
}

export function hasTrainerPartyPools(project: ProjectState): boolean {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return false;
  const module = file(project, `patches/${dllName(game)}`);
  return !!module && [manifest[game].sha256, manifest[game].linkedPoolsSha256, manifest[game].directPoolsSha256, manifest[game].fixedPartiesSha256, manifest[game].slotPoolsSha256, manifest[game].movePoolsSha256].includes(moduleHash(module));
}

export function hasDirectTrainerPoolPokemon(project: ProjectState): boolean {
  const game = gameFor(project);
  if (!game || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return false;
  const module = file(project, `patches/${dllName(game)}`);
  return !!module && [manifest[game].sha256, manifest[game].directPoolsSha256, manifest[game].fixedPartiesSha256, manifest[game].slotPoolsSha256, manifest[game].movePoolsSha256].includes(moduleHash(module));
}

function count(bytes: Uint8Array): number {
  if (bytes.length < HEADER || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== 1
    || readU16(bytes, 6) !== MEMBER || readU32(bytes, 12) !== 0) throw new Error("Unrecognized Trainer Customization data.");
  const trainers = readU32(bytes, 8);
  if (trainers > 65536 || bytes.length !== HEADER + trainers * PARTY) throw new Error("Invalid Trainer Customization data length.");
  return trainers;
}

function table(trainers: number, source?: Uint8Array): Uint8Array {
  const previous = source ? count(source) : 0;
  const bytes = new Uint8Array(HEADER + Math.max(trainers, previous) * PARTY);
  if (source) bytes.set(source);
  writeU32(bytes, 0, MAGIC);
  writeU16(bytes, 4, 1);
  writeU16(bytes, 6, MEMBER);
  writeU32(bytes, 8, Math.max(trainers, previous));
  return bytes;
}

function stageTable(project: ProjectState, bytes: Uint8Array, rom?: NintendoDSRom): void {
  const id = rom?.filenames.idOf(PATH) ?? sourceFiles.get(project)?.get(PATH)?.id;
  if (id === undefined) addRomFile(project, PATH, bytes);
  else {
    delete project.fileSystem?.additions?.[PATH];
    setRomFileReplacement(project, id, bytes);
    delete project.fileSystem?.tombstones?.[id];
  }
}

export function getTrainerMemberSettings(project: ProjectState, trainer: number, slot: number): TrainerMemberSettings {
  const bytes = file(project, PATH);
  const offset = HEADER + (trainer * 6 + slot) * MEMBER;
  if (!bytes || offset + MEMBER > bytes.length || bytes.length < HEADER || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== 1)
    return { ...DEFAULT_TRAINER_MEMBER_SETTINGS };
  return readTrainerMemberSettings(bytes, offset);
}

export function updateTrainerMemberSettings(project: ProjectState, trainer: number, slot: number, field: keyof TrainerMemberSettings, value: number): void {
  if (!Number.isInteger(trainer) || trainer < 0 || trainer > 65535 || !Number.isInteger(slot) || slot < 0
    || slot >= (project.trpokInfo[trainer]?.numPokemon ?? 0) || slot >= 6) throw new Error("Trainer Pokémon slot does not exist.");
  const original = getTrainerMemberSettings(project, trainer, slot);
  const settings = changeTrainerMemberSetting(original, field, value);
  if (!validTrainerMemberSettings(settings))
    throw new Error("Starting HP or status is outside its allowed range.");
  if (Object.keys(settings).every(key => settings[key as keyof TrainerMemberSettings] === original[key as keyof TrainerMemberSettings])) return;
  const bytes = table(trainer + 1, file(project, PATH));
  const offset = HEADER + (trainer * 6 + slot) * MEMBER;
  writeTrainerMemberSettings(bytes, offset, settings);
  stageTable(project, bytes);
  const labels = { shiny: "Shininess", status: "Starting status", sleepTurns: "Sleep turns", hpMode: "Starting HP mode", hp: "Starting HP" };
  const options = { shiny: TRAINER_SHINY_OPTIONS, status: TRAINER_STATUS_OPTIONS, hpMode: TRAINER_HP_OPTIONS };
  const names = field === "shiny" || field === "status" || field === "hpMode" ? options[field] : undefined;
  recordFieldChange(project, "trpok", `Trainer ${trainer}`, `Pokémon ${slot + 1} ${labels[field]}`,
    names?.[original[field]] ?? original[field], names?.[value] ?? value,
    { key: `trainer:${trainer}:pokemon:${slot}:customization:${field}` });
}

/** Copy or reorder customization along with the corresponding party members. */
export function remapTrainerMemberSettings(project: ProjectState, sourceId: number, targetId: number, slots: readonly (number | undefined)[]): void {
  const source = file(project, PATH);
  if (!source) return;
  try {
    if (sourceId >= count(source)) return;
  } catch {
    // An incompatible table must remain intact when ordinary party data changes.
    return;
  }
  const sourceOffset = HEADER + sourceId * PARTY;
  const targetOffset = HEADER + targetId * PARTY;
  const next = new Uint8Array(PARTY);
  slots.forEach((slot, index) => {
    if (slot !== undefined) next.set(source.subarray(sourceOffset + slot * MEMBER, sourceOffset + (slot + 1) * MEMBER), index * MEMBER);
  });
  if (next.every((byte, index) => byte === (source[targetOffset + index] ?? 0))) return;
  const bytes = table(targetId + 1, source);
  bytes.set(next, targetOffset);
  stageTable(project, bytes);
}

function verifyNative(project: ProjectState, rom: NintendoDSRom, game: Game) {
  const data = manifest[game];
  if (rom.idCode !== data.gameCode || rom.data[0x1e] !== 0 || rom.arm9RamAddress !== 0x02004000)
    throw new Error("Trainer Customization requires US Black 2 or White 2 revision 0.");
  const info = getOverlayInfo(project, rom, 167);
  if (!info) throw new Error("The battle overlay is missing.");
  const rawReplacement = !isOverlayStaged(project, 167) && project.fileSystem?.replacements?.[info.fileId];
  const overlay = getOverlayWorkingBytes(rawReplacement ? { ...project, overlays: {} } : project, rom, 167);
  for (const [bytes, base, signatures] of [[project.arm9, rom.arm9RamAddress, [...data.arm9, ...data.setup]], [overlay, info.ramAddress, data.overlay]] as const) {
    if (signatures.some(({ address, size, sha256 }) =>
      address < base || sha256Hex(bytes.subarray(address - base, address - base + size)) !== sha256)) {
      throw new Error("The ROM’s trainer battle code differs from the supported layout.");
    }
  }
}

export function installTrainerCustomization(project: ProjectState) {
  return installCodeInjectionPatch(project, async (staged) => {
    const game = gameFor(staged);
    if (!game) throw new Error("Trainer Customization requires US Black 2 or White 2 revision 0.");
    const rom = new NintendoDSRom(staged.originalRomBytes!, { fileData: "view" });
    verifyNative(staged, rom, game);
    const data = manifest[game];
    const name = dllName(game);
    const path = `patches/${name}`;
    const existing = readProjectFile(staged, path, rom);
    const existingHash = existing && sha256Hex(existing);
    if (existingHash === data.sha256 && detectSpecifyTrainerNaturesPatch(staged) !== "legacy") return;
    if (existingHash && ![data.legacySha256, data.previousSha256, data.weightedSha256, data.conditionalSha256, data.linkedPoolsSha256, data.directPoolsSha256, data.fixedPartiesSha256, data.slotPoolsSha256, data.movePoolsSha256, data.sha256].includes(existingHash)) {
      throw new Error("An unrecognized trainer nature DLL is already installed.");
    }
    const previousTable = readProjectFile(staged, PATH, rom);
    if (previousTable) count(previousTable);
    const response = await fetch(ASSETS[game]);
    if (!response.ok) throw new Error("Could not load Trainer Customization.");
    const dll = new Uint8Array(await response.arrayBuffer());
    if (sha256Hex(dll) !== data.sha256) throw new Error("The bundled Trainer Customization runtime failed its integrity check.");
    const hooks = parseRpm(dll, { allowedMagics: ["DLXF"] }).relocations
      .filter(({ target }) => target.module === "ARM9" || target.module === "167")
      .map(({ target }) => ({ module: target.module, address: target.address, size: 4 }));
    const ranges = [
      ...hooks,
      ...[...data.arm9, ...data.setup].map(signature => ({ ...signature, module: "ARM9" })),
      ...data.overlay.map(signature => ({ ...signature, module: "167" })),
    ];
    for (const entry of listCodeInjectionDlls(staged)) {
      if (entry.path === path) continue;
      const bytes = readProjectFile(staged, entry.path, rom);
      if (!bytes) throw new Error(`Could not inspect ${entry.fileName}.`);
      const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
      const conflicts = module.relocations.some(({ target, sourceSymbolIndex }) => {
        const segment = target.module === "0" ? "ARM9" : target.module.replace(/^OVL_/i, "");
        const start = target.address & ~1;
        const size = target.type === "FULL_COPY" ? module.symbols[sourceSymbolIndex]?.size ?? 0
          : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : target.type === "ARM_BRANCH" ? 8 : 4;
        return ranges.some(range => range.module === segment && start < range.address + range.size && start + size > range.address);
      });
      if (conflicts) throw new Error(`${entry.fileName} patches the same trainer code.`);
    }
    const restored = restoreLegacyTrainerNaturePatchToArm9(staged.arm9, game, rom.arm9RamAddress);
    if (restored) {
      staged.arm9 = restored;
      staged.arm9Dirty = true;
    }
    if (!hasTrainerNaturePmcSetupSignatures(staged.arm9, game, rom.arm9RamAddress))
      throw new Error("The trainer Pokémon creation routines differ from the supported layout.");
    stageCodeInjectionDll(staged, name, dll);
    if (!previousTable) stageTable(staged, table(0), rom);
    recordGenericChange(staged, "patches", "Installed Trainer Customization.", "Trainer Customization", { key: "patch:trainer-customization" });
  });
}
