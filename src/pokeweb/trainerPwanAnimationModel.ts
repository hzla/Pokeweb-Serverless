import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { loadActiveRomBytes } from "./persistence";
import {
  canRemoveStagedCodeInjectionDll,
  getPmcInstallStatus,
  installBundledPmc,
  listCodeInjectionDlls,
  removeStagedCodeInjectionDll,
  stageCodeInjectionDll,
} from "./pmcModel";
import type { ProjectState, PwanOverrideSide, TrainerPwanAnimationOverride, TrainerPwanAnimationState } from "./projectStore";
import { compileGifToPwanAsync } from "./pwanCompilerClient";
import { pwanFramesPerSecond, pwanPalette, scalePwanFrames, scalePwanTimelineSpeed, shiftPwanFrames, PWAN_MAX_TIMELINE } from "./pwanCompiler";
import { buildTrainerPwanCarrierFiles, ensureTrainerSpriteStore } from "./trainerSpriteModel";
import { detectTrainerPwanCompatibility, trainerPwanCompatibilityFailureSummary } from "./trainerPwanCompatibilityModel";

export const TRAINER_PWAN_CONFIG_MEMBER_ID = 3203;
export const TRAINER_PWAN_ASSET_MEMBER_BASE = 3204;
export const TRAINER_PWAN_CONFIG_VERSION = 1;
export const TRAINER_PWAN_W2_RUNTIME_FILENAME = "PokewebPwanTrainerW2.dll";
export const TRAINER_PWAN_B2_RUNTIME_FILENAME = "PokewebPwanTrainerB2.dll";
export const TRAINER_PWAN_W2_RUNTIME_PATH = `patches/${TRAINER_PWAN_W2_RUNTIME_FILENAME}`;
export const TRAINER_PWAN_B2_RUNTIME_PATH = `patches/${TRAINER_PWAN_B2_RUNTIME_FILENAME}`;

const CONFIG_MAGIC = "PWNT";
const CONFIG_HEADER_BYTES = 16;
const CONFIG_ENTRY_BYTES = 4;
const NO_CARRIER = 0xffff;
const FILES_PER_TRAINER = 8;

const runtimeUrls = {
  W2: new URL(`../assets/codeinjection/${TRAINER_PWAN_W2_RUNTIME_FILENAME}`, import.meta.url),
  B2: new URL(`../assets/codeinjection/${TRAINER_PWAN_B2_RUNTIME_FILENAME}`, import.meta.url),
} as const;

export type TrainerPwanRuntimeStatus =
  | { supported: false; installed: false; message: string }
  | { supported: true; installed: boolean; pmcInstalled: boolean; message: string };

export function ensureTrainerPwanAnimationState(project: ProjectState): TrainerPwanAnimationState {
  project.trainerPwanAnimations ??= { overrides: [] };
  project.trainerPwanAnimations.dirty ??= false;
  project.trainerPwanAnimations.overrides ??= [];
  return project.trainerPwanAnimations;
}

export function trainerPwanRuntimePath(project: ProjectState): string | undefined {
  if (project.session.baseVersion === "W2") return TRAINER_PWAN_W2_RUNTIME_PATH;
  if (project.session.baseVersion === "B2") return TRAINER_PWAN_B2_RUNTIME_PATH;
  return undefined;
}

export function hasTrainerPwanRuntimeDll(project: ProjectState): boolean {
  const path = trainerPwanRuntimePath(project)?.toLowerCase();
  return Boolean(path && listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === path));
}

export function getTrainerPwanRuntimeStatus(project: ProjectState): TrainerPwanRuntimeStatus {
  if (project.session.baseVersion !== "W2" && project.session.baseVersion !== "B2") {
    return { supported: false, installed: false, message: "Animated trainer PWAN support is available for stock US Black 2 and White 2 projects." };
  }
  const installed = hasTrainerPwanRuntimeDll(project);
  const pmcInstalled = getPmcInstallStatus(project).installed;
  return {
    supported: true,
    installed,
    pmcInstalled,
    message: installed
      ? `${project.session.baseVersion === "B2" ? "Black 2" : "White 2"} trainer PWAN runtime is staged.`
      : pmcInstalled
        ? "PMC is installed; stage the trainer PWAN runtime next."
        : "Installing trainer PWAN support will also install PMC.",
  };
}

export async function installTrainerPwanRuntime(project: ProjectState): Promise<void> {
  if (project.session.baseVersion !== "W2" && project.session.baseVersion !== "B2") {
    throw new Error("Animated trainer PWAN support is available for stock US Black 2 and White 2 projects.");
  }
  const expectedId = project.session.baseVersion === "B2" ? "IREO" : "IRDO";
  if (project.romInfo.idCode && project.romInfo.idCode !== expectedId) {
    throw new Error(`Trainer PWAN requires the stock US ${project.session.baseVersion === "B2" ? "Black 2 (IREO)" : "White 2 (IRDO)"} code layout.`);
  }
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing trainer PWAN support.");
  const compatibility = detectTrainerPwanCompatibility({ ...project, originalRomBytes: romBytes });
  if (!compatibility.compatible) throw new Error(trainerPwanCompatibilityFailureSummary(compatibility));
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const response = await fetch(runtimeUrls[project.session.baseVersion]);
  if (!response.ok) throw new Error(`Could not load the bundled trainer PWAN runtime (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const fileName = project.session.baseVersion === "B2" ? TRAINER_PWAN_B2_RUNTIME_FILENAME : TRAINER_PWAN_W2_RUNTIME_FILENAME;
  stageCodeInjectionDll(project, fileName, bytes, "patches");
  const state = ensureTrainerPwanAnimationState(project);
  state.runtimeInstalled = true;
  state.dirty = true;
  recordGenericChange(project, "code_injection", `${project.session.baseVersion} trainer PWAN runtime staged.`, "Trainer PWAN Runtime", { key: "trainer-pwan-runtime" });
}

export function canUninstallTrainerPwanRuntime(project: ProjectState): boolean {
  const path = trainerPwanRuntimePath(project);
  return Boolean(path && canRemoveStagedCodeInjectionDll(project, path));
}

export function uninstallTrainerPwanRuntime(project: ProjectState): void {
  const path = trainerPwanRuntimePath(project);
  if (!path) throw new Error("Animated trainer PWAN support is available for stock US Black 2 and White 2 projects.");
  if (!canRemoveStagedCodeInjectionDll(project, path)) throw new Error("A trainer PWAN DLL already built into the loaded ROM cannot be removed by this editor yet.");
  removeStagedCodeInjectionDll(project, path);
  ensureTrainerPwanAnimationState(project).runtimeInstalled = false;
  recordGenericChange(project, "code_injection", "Trainer PWAN runtime removed; imported animations were preserved.", "Trainer PWAN Runtime", { key: "trainer-pwan-runtime" });
}

export async function buildTrainerPwanOverride(
  graphicIndex: number,
  fileName: string,
  gifBytes: Uint8Array,
  options: { speed?: number; scale?: number; offsetX?: number; offsetY?: number } = {},
): Promise<TrainerPwanAnimationOverride> {
  validateGraphicIndex(graphicIndex);
  const result = await compileGifToPwanAsync(gifBytes);
  const speed = Math.max(0.1, Math.min(4, options.speed ?? 1));
  const scale = Math.max(0.5, Math.min(2, options.scale ?? 1));
  const offsetX = Math.max(-48, Math.min(48, Math.round(options.offsetX ?? 0)));
  const offsetY = Math.max(-48, Math.min(48, Math.round(options.offsetY ?? 0)));
  let pwanBytes = result.pwanBytes;
  if (scale !== 1) pwanBytes = scalePwanFrames(pwanBytes, scale).pwanBytes;
  if (offsetX !== 0 || offsetY !== 0) pwanBytes = shiftPwanFrames(pwanBytes, offsetX, offsetY).pwanBytes;
  if (speed !== 1) pwanBytes = scalePwanTimelineSpeed(pwanBytes, 1 / speed).pwanBytes;
  return {
    graphicIndex,
    animation: {
      sourceFileName: fileName,
      sourceGifBytes: gifBytes.slice(),
      pwanBytes,
      visibleHeight: result.visibleHeight,
      frameCount: result.frameCount,
      uniqueFrameCount: result.uniqueFrameCount,
      timelineCount: result.timelineCount,
      totalTicks: readU32(pwanBytes, 16),
      paletteBgr555: pwanPalette(pwanBytes),
      speedScale: speed,
      framesPerSecond: pwanFramesPerSecond(pwanBytes),
      scale,
      scaleMode: "nearest",
      outlineThreshold: 48,
      offsetX,
      offsetY,
      notes: result.warnings,
    },
  };
}

export function upsertTrainerPwanOverride(project: ProjectState, override: TrainerPwanAnimationOverride): void {
  validateGraphicIndex(override.graphicIndex);
  const state = ensureTrainerPwanAnimationState(project);
  const normalized = cloneOverride(override);
  const index = state.overrides.findIndex((entry) => entry.graphicIndex === override.graphicIndex);
  if (index === -1) state.overrides.push(normalized);
  else state.overrides[index] = normalized;
  state.overrides.sort((a, b) => a.graphicIndex - b.graphicIndex);
  state.dirty = true;
  recordGenericChange(project, "trainer_sprites", `PWAN animation saved for trainer graphic ${override.graphicIndex}.`, `Trainer graphic ${override.graphicIndex}`, { key: `trainer-pwan:${override.graphicIndex}` });
}

export function removeTrainerPwanOverride(project: ProjectState, graphicIndex: number): boolean {
  const state = ensureTrainerPwanAnimationState(project);
  const before = state.overrides.length;
  state.overrides = state.overrides.filter((entry) => entry.graphicIndex !== graphicIndex);
  if (state.overrides.length === before) return false;
  state.dirty = true;
  recordGenericChange(project, "trainer_sprites", `PWAN animation removed from trainer graphic ${graphicIndex}; the native sprite will be used.`, `Trainer graphic ${graphicIndex}`, { key: `trainer-pwan:${graphicIndex}` });
  return true;
}

export function findTrainerPwanOverride(project: ProjectState, graphicIndex: number): TrainerPwanAnimationOverride | undefined {
  return project.trainerPwanAnimations?.overrides.find((entry) => entry.graphicIndex === graphicIndex);
}

export function buildTrainerPwanConfig(overrides: TrainerPwanAnimationOverride[], carrierGraphicIndex: number): Uint8Array {
  if (overrides.length > 0 && carrierGraphicIndex === NO_CARRIER) throw new Error("Trainer PWAN config requires a carrier graphic");
  const active = [...overrides].sort((a, b) => a.graphicIndex - b.graphicIndex);
  const out = new Uint8Array(CONFIG_HEADER_BYTES + active.length * CONFIG_ENTRY_BYTES);
  out.set(new TextEncoder().encode(CONFIG_MAGIC), 0);
  writeU16(out, 4, TRAINER_PWAN_CONFIG_VERSION);
  writeU16(out, 6, active.length);
  writeU16(out, 8, PWAN_MAX_TIMELINE);
  writeU16(out, 10, carrierGraphicIndex);
  writeU32(out, 12, CONFIG_HEADER_BYTES);
  active.forEach((override, index) => {
    validateGraphicIndex(override.graphicIndex);
    const offset = CONFIG_HEADER_BYTES + index * CONFIG_ENTRY_BYTES;
    writeU16(out, offset, override.graphicIndex);
    writeU16(out, offset + 2, override.assetIndex ?? override.graphicIndex);
  });
  return out;
}

export function parseTrainerPwanArchive(archive: NARC): { overrides: TrainerPwanAnimationOverride[]; carrierGraphicIndex: number } {
  const config = archive.files[TRAINER_PWAN_CONFIG_MEMBER_ID];
  if (!config || config.length === 0) return { overrides: [], carrierGraphicIndex: NO_CARRIER };
  if (readAscii(config, 0, 4) !== CONFIG_MAGIC) throw new Error("Trainer PWAN config is missing PWNT magic.");
  const version = readU16(config, 4);
  if (version !== TRAINER_PWAN_CONFIG_VERSION) throw new Error(`Unsupported trainer PWAN config version ${version}.`);
  const count = readU16(config, 6);
  const carrierGraphicIndex = readU16(config, 10);
  const entryOffset = readU32(config, 12) || CONFIG_HEADER_BYTES;
  if (entryOffset + count * CONFIG_ENTRY_BYTES > config.length) throw new Error("Trainer PWAN config is truncated.");
  const overrides: TrainerPwanAnimationOverride[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = entryOffset + index * CONFIG_ENTRY_BYTES;
    const graphicIndex = readU16(config, offset);
    const assetIndex = readU16(config, offset + 2);
    const bytes = archive.files[trainerPwanAssetMemberId(assetIndex)];
    if (!bytes?.length) throw new Error(`Trainer PWAN asset ${assetIndex} is missing.`);
    const headerFrameCount = readU16(bytes, 12);
    const timelineCount = readU16(bytes, 14);
    const totalTicks = readU32(bytes, 16);
    overrides.push({
      graphicIndex,
      assetIndex: assetIndex === graphicIndex ? undefined : assetIndex,
      animation: {
        sourceFileName: `trainer-${graphicIndex}.pwan`,
        sourceGifBytes: new Uint8Array(),
        pwanBytes: bytes.slice(),
        frameCount: headerFrameCount,
        uniqueFrameCount: headerFrameCount,
        timelineCount,
        totalTicks,
        paletteBgr555: pwanPalette(bytes),
        speedScale: 1,
        framesPerSecond: pwanFramesPerSecond(bytes),
        scale: 1,
        scaleMode: "nearest",
        outlineThreshold: 48,
        offsetX: 0,
        offsetY: 0,
      },
    });
  }
  return { overrides, carrierGraphicIndex };
}

export function hydrateTrainerPwanAnimationsFromRom(project: ProjectState, rom: NintendoDSRom, archivePath: string): void {
  const fileId = rom.filenames.idOf(archivePath);
  if (fileId === undefined) return;
  const state = ensureTrainerPwanAnimationState(project);
  if (state.dirty) return;
  try {
    const parsed = parseTrainerPwanArchive(new NARC(rom.files[fileId]));
    state.overrides = parsed.overrides;
    state.carrierGraphicIndex = parsed.carrierGraphicIndex === NO_CARRIER ? undefined : parsed.carrierGraphicIndex;
    state.detectedArchive = {
      path: archivePath,
      version: TRAINER_PWAN_CONFIG_VERSION,
      count: parsed.overrides.length,
      carrierGraphicIndex: parsed.carrierGraphicIndex,
    };
    state.loadError = undefined;
    state.dirty = false;
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
    state.overrides = [];
    state.dirty = false;
  }
}

export async function materializeTrainerPwanCarrier(project: ProjectState): Promise<number> {
  const state = ensureTrainerPwanAnimationState(project);
  if (!(await ensureTrainerSpriteStore(project))) throw new Error("Trainer sprite data is not available for this ROM.");
  const store = project.narcs.trainer_sprites!;
  if (state.overrides.length === 0) {
    const carrier = state.carrierGraphicIndex;
    if (carrier !== undefined && store.rawFiles.length === (carrier + 1) * FILES_PER_TRAINER) {
      store.rawFiles.splice(carrier * FILES_PER_TRAINER, FILES_PER_TRAINER);
      store.fileCount = store.rawFiles.length;
      store.dirty.add(Math.max(0, store.rawFiles.length - 1));
      state.carrierGraphicIndex = undefined;
    }
    return NO_CARRIER;
  }
  let carrier = state.carrierGraphicIndex;
  if (carrier === undefined || store.rawFiles.length < (carrier + 1) * FILES_PER_TRAINER) {
    if (store.rawFiles.length % FILES_PER_TRAINER !== 0) throw new Error("Trainer sprite NARC does not contain complete eight-file graphics.");
    carrier = store.rawFiles.length / FILES_PER_TRAINER;
  }
  const files = buildTrainerPwanCarrierFiles(project);
  files.forEach((file, index) => {
    const member = carrier! * FILES_PER_TRAINER + index;
    store.rawFiles[member] = file;
    store.dirty.add(member);
  });
  store.fileCount = store.rawFiles.length;
  state.carrierGraphicIndex = carrier;
  return carrier;
}

export function trainerPwanAssetMemberId(assetIndex: number): number {
  return TRAINER_PWAN_ASSET_MEMBER_BASE + assetIndex;
}

function validateGraphicIndex(graphicIndex: number): void {
  if (!Number.isInteger(graphicIndex) || graphicIndex < 0 || graphicIndex >= NO_CARRIER) throw new Error(`Invalid trainer graphic index ${graphicIndex}.`);
}

function cloneOverride(override: TrainerPwanAnimationOverride): TrainerPwanAnimationOverride {
  return {
    ...override,
    animation: {
      ...override.animation,
      sourceGifBytes: override.animation.sourceGifBytes.slice(),
      pwanBytes: override.animation.pwanBytes.slice(),
      paletteBgr555: override.animation.paletteBgr555.slice(),
      notes: override.animation.notes ? [...override.animation.notes] : undefined,
    },
  };
}
