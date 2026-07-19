import { recordGenericChange } from "./actionChangelog";
import { readAscii, writeU16, writeU32, readU16, readU32 } from "../nds/binary";
import { addRomFile, setRomFileReplacement } from "./fileSystemModel";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import { findPokemonPersonalFormOwner } from "./pokemonLabels";
import { resolvePokemonSpriteId } from "./pokemonSpriteModel";
import type { ProjectState, PwanAnimationOverride, PwanAnimationState, PwanOverrideSide, PwanPaletteSource } from "./projectStore";
import { markDirty } from "./projectStore";
import { loadActiveRomBytes } from "./persistence";
import { applyPwanCarrierPatch, deriveBackNcecY, loadBundledPwanCarrierTemplate } from "./pwanCarrierPatch";
import { compileGifToPwan, parsePwanHeader, PWAN_MAX_TIMELINE, pwanFramesPerSecond, pwanPalette, scalePwanTimelineSpeed, shiftPwanFrames, pwanVisibleHeight, validatePwan, type PwanCompileResult } from "./pwanCompiler";
import { compileGifToPwanAsync } from "./pwanCompilerClient";
import { detectPwanRuntimeCompatibility, pwanCompatibilityFailureSummary } from "./pwanCompatibilityModel";

export type PwanSide = "front" | "back";
export type PwanFrameScaleMode = "nearest" | "outlineFill";

export const PWAN_ARCHIVE_PATH = "zz_pokeweb_pwan/pwan.narc";
export const PWAN_CONFIG_PATH = `${PWAN_ARCHIVE_PATH}:0000.bin`;
export const PWAN_W2_RUNTIME_FILENAMES = ["PokewebPwanSummaryW2.dll", "PokewebPwanBattleW2.dll", "PokewebPwanMiscW2.dll"] as const;
export const PWAN_B2_RUNTIME_FILENAMES = ["PokewebPwanSummaryB2.dll", "PokewebPwanBattleB2.dll", "PokewebPwanMiscB2.dll"] as const;
export const PWAN_LEGACY_W2_RUNTIME_FILENAME = "PokewebPwanW2.dll";
export const PWAN_LEGACY_W2_RUNTIME_PATH = `patches/${PWAN_LEGACY_W2_RUNTIME_FILENAME}`;
export const PWAN_W2_RUNTIME_PATHS = PWAN_W2_RUNTIME_FILENAMES.map((fileName) => `patches/${fileName}`);
export const PWAN_B2_RUNTIME_PATHS = PWAN_B2_RUNTIME_FILENAMES.map((fileName) => `patches/${fileName}`);
export const PWAN_CONFIG_VERSION = 3;
export const PWAN_CONFIG_FRONT_FLAG = 1;
export const PWAN_CONFIG_BACK_FLAG = 2;
export const PWAN_MIN_SPEED_SCALE = 0.1;
export const PWAN_MAX_SPEED_SCALE = 4;
export const PWAN_MIN_FRAME_SCALE = 0.5;
export const PWAN_MAX_FRAME_SCALE = 2;
export const PWAN_FRAME_SCALE_STEP = 0.05;
export const PWAN_DEFAULT_FRAME_SCALE_MODE: PwanFrameScaleMode = "nearest";
export const PWAN_DEFAULT_OUTLINE_THRESHOLD = 48;
export const PWAN_MIN_OUTLINE_THRESHOLD = 0;
export const PWAN_MAX_OUTLINE_THRESHOLD = 128;
export const PWAN_MIN_OFFSET = -48;
export const PWAN_MAX_OFFSET = 48;

const PWAN_RUNTIME_URLS = {
  W2: PWAN_W2_RUNTIME_FILENAMES.map((fileName) => ({ fileName, url: new URL(`../assets/codeinjection/${fileName}`, import.meta.url) })),
  B2: PWAN_B2_RUNTIME_FILENAMES.map((fileName) => ({ fileName, url: new URL(`../assets/codeinjection/${fileName}`, import.meta.url) })),
} as const;
const PWAN_LEGACY_RETIREMENT_URL = new URL("../assets/codeinjection/PokewebPwanLegacyRetiredW2.dll", import.meta.url);
const PWAN_LEGACY_W2_SHA256 = "b5eb73819af80655fd4b56ac84daa4cd25cef06e72fb7fa9ef7d6a7f58b65602";
const PWAN_LEGACY_RETIREMENT_SHA256 = "65d88246013f7ac3a7d87168a8f5058091a2d8f7561d364a5a051c3e632447cb";
const CONFIG_MAGIC = "PWNC";
const CONFIG_HEADER_BYTES = 16;
const CONFIG_ENTRY_BYTES = 5;
const PWAN_CONFIG_FORM_MASK = 0x1f;
const PWAN_MAX_ASSET_INDEX = 1600;
const FILES_PER_SPRITE = 20;
const MAX_PWAN_OVERRIDES = 500;

export type PwanRuntimeStatus =
  | { supported: false; installed: false; message: string }
  | { supported: true; installed: boolean; pmcInstalled: boolean; legacyInstalled: boolean; message: string };

export type PwanOverrideInput = {
  speciesId: number;
  formIndex?: number;
  assetIndex?: number;
  frontFileName: string;
  frontGifBytes: Uint8Array;
  backFileName: string;
  backGifBytes: Uint8Array;
  nativePaletteSource?: PwanPaletteSource;
};

export type PwanOverrideSideInput = {
  fileName: string;
  gifBytes: Uint8Array;
};

export type PwanOverrideSideUpsert = {
  speciesId: number;
  formIndex?: number;
  assetIndex?: number;
  side: PwanSide;
  sideData: PwanOverrideSide;
  nativePaletteSource?: PwanPaletteSource;
};

export type PwanOverrideSideSpeedOptions = {
  formIndex?: number;
  recordChange?: boolean;
};

export type PwanOverrideSideOffsetOptions = {
  formIndex?: number;
  recordChange?: boolean;
};

export type PwanSpeciesTarget = {
  requestedSpeciesId: number;
  speciesId: number;
  formIndex: number;
  assetIndex: number;
};

export function ensurePwanAnimationState(project: ProjectState): PwanAnimationState {
  project.pwanAnimations ??= { overrides: [] };
  project.pwanAnimations.dirty ??= false;
  project.pwanAnimations.overrides ??= [];
  project.pwanAnimations.nativeCarrierBackups ??= {};
  return project.pwanAnimations;
}

export function hydratePwanAnimationsFromRom(project: ProjectState, rom: NintendoDSRom): void {
  const fileId = rom.filenames.idOf(PWAN_ARCHIVE_PATH);
  if (fileId === undefined) return;
  const state = ensurePwanAnimationState(project);
  if (state.dirty) return;
  try {
    const archive = new NARC(rom.files[fileId]);
    const config = archive.files[0] ?? new Uint8Array();
    state.overrides = parsePwanArchiveBytes(rom.files[fileId]);
    state.detectedArchive = {
      path: PWAN_ARCHIVE_PATH,
      version: readU16(config, 4),
      count: state.overrides.length,
    };
    state.loadError = undefined;
    state.dirty = false;
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
    state.detectedArchive = undefined;
    state.overrides = [];
    state.dirty = false;
  }
}

export function getPwanRuntimeStatus(project: ProjectState): PwanRuntimeStatus {
  if (project.session.baseVersion !== "W2" && project.session.baseVersion !== "B2") {
    return { supported: false, installed: false, message: "PWAN animation injection supports stock US Black 2 and White 2 projects." };
  }
  const pmc = getPmcInstallStatus(project);
  const installed = hasPwanRuntimeDll(project);
  const legacyInstalled = hasLegacyPwanRuntimeDll(project);
  if (installed) {
    return {
      supported: true,
      installed: true,
      pmcInstalled: pmc.installed,
      legacyInstalled,
      message: pmc.installed
        ? project.session.baseVersion === "B2"
          ? "Black 2 split PWAN animation runtimes are staged."
          : "White 2 split PWAN animation runtimes are staged."
        : "PWAN animation runtime DLLs are present.",
    };
  }
  if (!pmc.installed) {
    return {
      supported: true,
      installed: false,
      pmcInstalled: false,
      legacyInstalled,
      message: legacyInstalled
        ? "Legacy White 2 PWAN support was detected. Install the current split runtime to upgrade it."
        : "Install the PMC runtime before staging the PWAN animation patch.",
    };
  }
  return {
    supported: true,
    installed: false,
    pmcInstalled: true,
    legacyInstalled,
    message: legacyInstalled
      ? "Legacy White 2 PWAN support was detected. Install the current split runtime to upgrade it."
      : "PMC is installed; stage the PWAN animation runtime next.",
  };
}

export function hasPwanRuntimeDll(project: ProjectState): boolean {
  const paths = new Set(listCodeInjectionDlls(project).map((module) => module.path.toLowerCase()));
  if (project.session.baseVersion === "B2") return PWAN_B2_RUNTIME_PATHS.every((path) => paths.has(path.toLowerCase()));
  if (project.session.baseVersion === "W2") return PWAN_W2_RUNTIME_PATHS.every((path) => paths.has(path.toLowerCase()));
  return false;
}

export function hasLegacyPwanRuntimeDll(project: ProjectState): boolean {
  if (project.session.baseVersion !== "W2") return false;
  return listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === PWAN_LEGACY_W2_RUNTIME_PATH.toLowerCase());
}

export async function installPwanRuntime(project: ProjectState): Promise<void> {
  if (project.session.baseVersion !== "W2" && project.session.baseVersion !== "B2") {
    throw new Error("PWAN animation injection supports stock US Black 2 and White 2 projects.");
  }
  if (project.originalRomBytes) {
    const compatibility = detectPwanRuntimeCompatibility(project);
    if (!compatibility.compatible) throw new Error(pwanCompatibilityFailureSummary(compatibility));
  }
  const version = project.session.baseVersion;
  const artifacts = await Promise.all(
    PWAN_RUNTIME_URLS[version].map(async ({ fileName, url }) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load bundled PWAN runtime ${fileName} (${response.status})`);
      return { fileName, bytes: new Uint8Array(await response.arrayBuffer()) };
    }),
  );
  const retirementBytes = version === "W2" ? await loadLegacyRetirementRuntime() : undefined;
  const pmc = getPmcInstallStatus(project);
  if (!pmc.installed) await installBundledPmc(project);
  if (retirementBytes) await migrateLegacyW2Runtime(project, retirementBytes);
  for (const artifact of artifacts) stageCodeInjectionDll(project, artifact.fileName, artifact.bytes, "patches");
  const state = ensurePwanAnimationState(project);
  state.runtimeInstalled = true;
  state.dirty = true;
  recordGenericChange(
    project,
    "code_injection",
    version === "B2" ? "Black 2 split PWAN runtimes staged." : "White 2 split PWAN runtimes staged.",
    "PWAN Runtime",
    { key: "pwan-runtime" },
  );
}

async function loadLegacyRetirementRuntime(): Promise<Uint8Array> {
  const response = await fetch(PWAN_LEGACY_RETIREMENT_URL);
  if (!response.ok) throw new Error(`Could not load the bundled legacy PWAN retirement runtime (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== PWAN_LEGACY_RETIREMENT_SHA256) {
    throw new Error("The bundled legacy PWAN retirement runtime failed its integrity check.");
  }
  return bytes;
}

async function migrateLegacyW2Runtime(project: ProjectState, retirementBytes: Uint8Array): Promise<void> {
  const stagedLegacy = project.fileSystem?.additions?.[PWAN_LEGACY_W2_RUNTIME_PATH];
  if (stagedLegacy) {
    await assertKnownLegacyRuntime(stagedLegacy);
    delete project.fileSystem?.additions?.[PWAN_LEGACY_W2_RUNTIME_PATH];
    if (project.codeInjection?.modules) {
      project.codeInjection.modules = project.codeInjection.modules.filter(
        (module) => module.path.toLowerCase() !== PWAN_LEGACY_W2_RUNTIME_PATH.toLowerCase(),
      );
    }
  }

  if (!hasLegacyPwanRuntimeDll(project)) return;

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) {
    if (hasLegacyPwanRuntimeDll(project)) throw new Error("Reload the ROM before upgrading the legacy White 2 PWAN runtime.");
    return;
  }
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.filenames.idOf(PWAN_LEGACY_W2_RUNTIME_PATH);
  if (fileId === undefined) return;
  const activeBytes = project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId] ?? new Uint8Array();
  const hash = await sha256Hex(activeBytes);
  if (hash === PWAN_LEGACY_RETIREMENT_SHA256) return;
  if (hash !== PWAN_LEGACY_W2_SHA256) {
    throw new Error(
      `A custom or unknown DLL already uses ${PWAN_LEGACY_W2_RUNTIME_PATH}. Remove or rename it before installing the split PWAN runtime.`,
    );
  }
  setRomFileReplacement(project, fileId, retirementBytes);
}

async function assertKnownLegacyRuntime(bytes: Uint8Array): Promise<void> {
  const hash = await sha256Hex(bytes);
  if (hash !== PWAN_LEGACY_W2_SHA256 && hash !== PWAN_LEGACY_RETIREMENT_SHA256) {
    throw new Error(
      `A custom or unknown DLL already uses ${PWAN_LEGACY_W2_RUNTIME_PATH}. Remove or rename it before installing the split PWAN runtime.`,
    );
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.length);
  input.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function buildPwanOverride(input: PwanOverrideInput): PwanAnimationOverride {
  validatePwanSpeciesId(input.speciesId);
  const front = buildPwanOverrideSide({ fileName: input.frontFileName, gifBytes: input.frontGifBytes });
  const back = buildPwanOverrideSide({ fileName: input.backFileName, gifBytes: input.backGifBytes });
  return normalizePwanOverride({
    speciesId: input.speciesId,
    formIndex: input.formIndex,
    assetIndex: input.assetIndex,
    front,
    back,
    nativePaletteSource: input.nativePaletteSource ?? "back",
    carrierTemplate: "w2u-gen6-placeholder",
  });
}

export async function buildPwanOverrideAsync(input: PwanOverrideInput): Promise<PwanAnimationOverride> {
  validatePwanSpeciesId(input.speciesId);
  const [front, back] = await Promise.all([
    buildPwanOverrideSideAsync({ fileName: input.frontFileName, gifBytes: input.frontGifBytes }),
    buildPwanOverrideSideAsync({ fileName: input.backFileName, gifBytes: input.backGifBytes }),
  ]);
  return normalizePwanOverride({
    speciesId: input.speciesId,
    formIndex: input.formIndex,
    assetIndex: input.assetIndex,
    front,
    back,
    nativePaletteSource: input.nativePaletteSource ?? "back",
    carrierTemplate: "w2u-gen6-placeholder",
  });
}

export function buildPwanOverrideSide(input: PwanOverrideSideInput): PwanOverrideSide {
  return pwanOverrideSideFromCompileResult(input, compileGifToPwan(input.gifBytes));
}

export async function buildPwanOverrideSideAsync(input: PwanOverrideSideInput): Promise<PwanOverrideSide> {
  return pwanOverrideSideFromCompileResult(input, await compileGifToPwanAsync(input.gifBytes));
}

function pwanOverrideSideFromCompileResult(input: PwanOverrideSideInput, result: PwanCompileResult): PwanOverrideSide {
  return {
    sourceFileName: input.fileName,
    sourceGifBytes: input.gifBytes,
    pwanBytes: result.pwanBytes,
    visibleHeight: result.visibleHeight,
    frameCount: result.frameCount,
    uniqueFrameCount: result.uniqueFrameCount,
    timelineCount: result.timelineCount,
    totalTicks: result.totalTicks,
    paletteBgr555: result.paletteBgr555,
    speedScale: 1,
    framesPerSecond: pwanFramesPerSecond(result.pwanBytes),
    scale: 1,
    scaleMode: PWAN_DEFAULT_FRAME_SCALE_MODE,
    outlineThreshold: PWAN_DEFAULT_OUTLINE_THRESHOLD,
    offsetX: 0,
    offsetY: 0,
    notes: result.warnings,
  };
}

export function buildPwanOverrideSideFromPwanBytes(pwanBytes: Uint8Array, sourceFileName: string): PwanOverrideSide {
  const header = parsePwanHeader(pwanBytes);
  validatePwan(pwanBytes);
  return {
    sourceFileName,
    sourceGifBytes: new Uint8Array(),
    pwanBytes: pwanBytes.slice(),
    visibleHeight: pwanVisibleHeight(pwanBytes),
    frameCount: header.timelineCount,
    uniqueFrameCount: header.frameCount,
    timelineCount: header.timelineCount,
    totalTicks: header.totalTicks,
    paletteBgr555: pwanPalette(pwanBytes),
    speedScale: 1,
    framesPerSecond: pwanFramesPerSecond(pwanBytes),
    scale: 1,
    scaleMode: PWAN_DEFAULT_FRAME_SCALE_MODE,
    outlineThreshold: PWAN_DEFAULT_OUTLINE_THRESHOLD,
    offsetX: 0,
    offsetY: 0,
  };
}

export function upsertPwanOverride(project: ProjectState, override: PwanAnimationOverride): void {
  const state = ensurePwanAnimationState(project);
  const normalized = normalizePwanOverride(override);
  captureNativeCarrierBackup(project, pwanAssetIndex(normalized));
  const index = findPwanOverrideIndex(state, normalized.speciesId, normalized.formIndex);
  if (index === -1) state.overrides.push(normalized);
  else state.overrides[index] = normalized;
  state.dirty = true;
  state.overrides.sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
  recordGenericChange(project, "pokemon_sprites", `PWAN override saved for species ${normalized.speciesId}.`, `Species ${normalized.speciesId}`, {
    key: `pwan-override:${normalized.speciesId}:${normalized.formIndex ?? 0}`,
  });
}

export function upsertPwanOverrideSide(project: ProjectState, input: PwanOverrideSideUpsert): PwanAnimationOverride {
  validatePwanSpeciesId(input.speciesId);
  const state = ensurePwanAnimationState(project);
  const index = findPwanOverrideIndex(state, input.speciesId, input.formIndex);
  const previous = index === -1 ? undefined : state.overrides[index];
  const override = normalizePwanOverride({
    speciesId: input.speciesId,
    formIndex: input.formIndex ?? previous?.formIndex,
    assetIndex: input.assetIndex ?? previous?.assetIndex,
    front: input.side === "front" ? input.sideData : previous?.front,
    back: input.side === "back" ? input.sideData : previous?.back,
    nativePaletteSource: input.nativePaletteSource ?? previous?.nativePaletteSource ?? input.side,
    carrierTemplate: "w2u-gen6-placeholder",
  });
  captureNativeCarrierBackup(project, pwanAssetIndex(override));
  if (index === -1) state.overrides.push(override);
  else state.overrides[index] = override;
  state.dirty = true;
  state.overrides.sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
  recordGenericChange(project, "pokemon_sprites", `PWAN ${input.side} override saved for species ${override.speciesId}.`, `Species ${override.speciesId}`, {
    key: `pwan-override:${override.speciesId}:${override.formIndex ?? 0}:${input.side}`,
  });
  return override;
}

export function removePwanOverride(project: ProjectState, speciesId: number): void {
  const state = ensurePwanAnimationState(project);
  const removed = state.overrides.filter((override) => override.speciesId === speciesId);
  state.overrides = state.overrides.filter((override) => override.speciesId !== speciesId);
  removed.forEach((override) => restoreNativeCarrierBackup(project, pwanAssetIndex(override)));
  if (removed.length > 0) state.dirty = true;
  recordGenericChange(project, "pokemon_sprites", `PWAN override removed for species ${speciesId}.`, `Species ${speciesId}`, {
    key: `pwan-override-remove:${speciesId}`,
  });
}

export function removePwanOverrideSide(project: ProjectState, speciesId: number, side: PwanSide, formIndex = 0): void {
  const state = ensurePwanAnimationState(project);
  const index = findPwanOverrideIndex(state, speciesId, formIndex);
  if (index === -1) return;
  const override = state.overrides[index]!;
  restoreNativeCarrierBackup(project, pwanAssetIndex(override));
  delete override[side];
  if (!override.front && !override.back) {
    state.overrides.splice(index, 1);
  } else {
    state.overrides[index] = normalizePwanOverride(override);
    captureNativeCarrierBackup(project, pwanAssetIndex(state.overrides[index]!));
  }
  state.dirty = true;
  recordGenericChange(project, "pokemon_sprites", `PWAN ${side} override removed for species ${speciesId}.`, `Species ${speciesId}`, {
    key: `pwan-override-remove:${speciesId}:${formIndex}:${side}`,
  });
}

export function setPwanOverrideSideSpeed(
  project: ProjectState,
  speciesId: number,
  side: PwanSide,
  speedScale: number,
  options: PwanOverrideSideSpeedOptions = {},
): PwanOverrideSide | undefined {
  const state = ensurePwanAnimationState(project);
  const index = findPwanOverrideIndex(state, speciesId, options.formIndex);
  const override = index === -1 ? undefined : state.overrides[index];
  const sideData = override?.[side];
  if (!override || !sideData) return undefined;
  const previousSpeed = normalizePwanSpeedScale(sideData.speedScale ?? 1);
  const nextSpeed = normalizePwanSpeedScale(speedScale);
  if (Math.abs(previousSpeed - nextSpeed) < 0.001) {
    sideData.speedScale = nextSpeed;
    return sideData;
  }
  const scaled = scalePwanTimelineSpeed(sideData.pwanBytes, previousSpeed / nextSpeed);
  sideData.pwanBytes = scaled.pwanBytes;
  if (sideData.offsetBasePwanBytes) sideData.offsetBasePwanBytes = scalePwanTimelineSpeed(sideData.offsetBasePwanBytes, previousSpeed / nextSpeed).pwanBytes;
  sideData.totalTicks = scaled.totalTicks;
  sideData.speedScale = nextSpeed;
  sideData.framesPerSecond = pwanFramesPerSecond(sideData.pwanBytes);
  state.overrides[index] = normalizePwanOverride(override);
  state.dirty = true;
  if (options.recordChange ?? true) {
    recordGenericChange(project, "pokemon_sprites", `PWAN ${side} speed set to ${formatPwanSpeedScale(nextSpeed)}x for species ${speciesId}.`, `Species ${speciesId}`, {
      key: `pwan-override-speed:${speciesId}:${options.formIndex ?? 0}:${side}`,
    });
  }
  return state.overrides[index]?.[side];
}

export function setPwanOverrideSideOffset(
  project: ProjectState,
  speciesId: number,
  side: PwanSide,
  offsetX: number,
  offsetY: number,
  options: PwanOverrideSideOffsetOptions = {},
): PwanOverrideSide | undefined {
  const state = ensurePwanAnimationState(project);
  const index = findPwanOverrideIndex(state, speciesId, options.formIndex);
  const override = index === -1 ? undefined : state.overrides[index];
  const sideData = override?.[side];
  if (!override || !sideData) return undefined;
  const nextX = normalizePwanOffset(offsetX);
  const nextY = normalizePwanOffset(offsetY);
  if ((sideData.offsetX ?? 0) === nextX && (sideData.offsetY ?? 0) === nextY) return sideData;
  sideData.offsetBasePwanBytes ??= sideData.pwanBytes.slice();
  const shifted = shiftPwanFrames(sideData.offsetBasePwanBytes, nextX, nextY);
  sideData.pwanBytes = shifted.pwanBytes;
  sideData.visibleHeight = shifted.visibleHeight;
  sideData.offsetX = nextX;
  sideData.offsetY = nextY;
  state.overrides[index] = normalizePwanOverride(override);
  state.dirty = true;
  if (options.recordChange ?? true) {
    recordGenericChange(project, "pokemon_sprites", `PWAN ${side} offset set to ${nextX}, ${nextY} for species ${speciesId}.`, `Species ${speciesId}`, {
      key: `pwan-override-offset:${speciesId}:${options.formIndex ?? 0}:${side}`,
    });
  }
  return state.overrides[index]?.[side];
}

export async function materializePwanAnimations(project: ProjectState, rom?: NintendoDSRom): Promise<void> {
  clearMaterializedPwanFiles(project);
  const state = project.pwanAnimations;
  if (!state?.dirty) return;
  const overrides = activePwanOverrides(project.pwanAnimations?.overrides ?? []);
  const status = getPwanRuntimeStatus(project);
  if (!status.supported) throw new Error(status.message);
  if (!status.installed) throw new Error("Install the PWAN animation runtime before exporting animated sprite overrides.");
  if (overrides.length === 0) {
    writePwanArchiveFile(project, rom, buildPwanArchive([]));
    return;
  }
  if (!project.narcs.pokemon_sprites) throw new Error("Pokemon Sprites must be loaded before exporting PWAN animation overrides.");

  const carrier = await loadBundledPwanCarrierTemplate(project.session.baseVersion === "B2" ? "B2" : "W2");
  const sorted = [...overrides].sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
  sorted.forEach((override) => {
    validatePwanOverrideTarget(project, override);
    applyPwanCarrierPatch(project, override, carrier);
  });
  writePwanArchiveFile(project, rom, buildPwanArchive(sorted));
}

export function buildPwanConfig(overrides: PwanAnimationOverride[]): Uint8Array {
  const active = sortedPwanOverrides(overrides);
  if (active.length > MAX_PWAN_OVERRIDES) throw new Error(`PWAN runtime supports up to ${MAX_PWAN_OVERRIDES} species overrides.`);
  const out = new Uint8Array(CONFIG_HEADER_BYTES + active.length * CONFIG_ENTRY_BYTES);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(CONFIG_MAGIC), 0);
  view.setUint16(4, PWAN_CONFIG_VERSION, true);
  view.setUint16(6, active.length, true);
  view.setUint32(8, PWAN_MAX_TIMELINE, true);
  view.setUint32(12, CONFIG_HEADER_BYTES, true);
  active.forEach((override, index) => {
    const offset = CONFIG_HEADER_BYTES + index * CONFIG_ENTRY_BYTES;
    const assetIndex = pwanAssetIndex(override);
    if (assetIndex > PWAN_MAX_ASSET_INDEX) throw new Error(`PWAN asset index ${assetIndex} is above the runtime cap ${PWAN_MAX_ASSET_INDEX}.`);
    const flags = pwanOverrideFlags(override);
    view.setUint16(offset, override.speciesId, true);
    out[offset + 2] = ((override.formIndex ?? 0) & PWAN_CONFIG_FORM_MASK) | ((flags & 0x03) << 5);
    view.setUint16(offset + 3, assetIndex, true);
  });
  return out;
}

export function buildPwanArchive(overrides: PwanAnimationOverride[]): Uint8Array {
  const active = sortedPwanOverrides(overrides);
  const files: Uint8Array[] = [buildPwanConfig(active)];
  for (const override of active) {
    const assetIndex = pwanAssetIndex(override);
    if (override.front) files[pwanArchiveMemberId(assetIndex, "front")] = override.front.pwanBytes;
    if (override.back) files[pwanArchiveMemberId(assetIndex, "back")] = override.back.pwanBytes;
  }
  const maxMember = Math.max(0, files.length - 1);
  for (let memberId = 0; memberId <= maxMember; memberId += 1) files[memberId] ??= new Uint8Array();
  return buildKnarcStylePwanNarc(files);
}

export function parsePwanArchiveBytes(bytes: Uint8Array): PwanAnimationOverride[] {
  const archive = new NARC(bytes);
  return parsePwanArchive(archive);
}

export function parsePwanArchive(archive: NARC): PwanAnimationOverride[] {
  const config = archive.files[0] ?? new Uint8Array();
  if (readAscii(config, 0, 4) !== CONFIG_MAGIC) throw new Error("PWAN archive config is missing PWNC magic.");
  const version = readU16(config, 4);
  if (version !== PWAN_CONFIG_VERSION) throw new Error(`Unsupported PWAN config version ${version}; expected ${PWAN_CONFIG_VERSION}.`);
  const count = readU16(config, 6);
  const entryOffset = readU32(config, 12) || CONFIG_HEADER_BYTES;
  if (entryOffset + count * CONFIG_ENTRY_BYTES > config.length) throw new Error("PWAN archive config is truncated.");
  const overrides: PwanAnimationOverride[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = entryOffset + index * CONFIG_ENTRY_BYTES;
    const speciesId = readU16(config, offset);
    const packedFormFlags = config[offset + 2] ?? 0;
    const formIndex = packedFormFlags & PWAN_CONFIG_FORM_MASK;
    const flags = (packedFormFlags >>> 5) & 0x03;
    const assetIndex = readU16(config, offset + 3);
    const front = flags & PWAN_CONFIG_FRONT_FLAG ? pwanArchiveSide(archive, assetIndex, "front") : undefined;
    const back = flags & PWAN_CONFIG_BACK_FLAG ? pwanArchiveSide(archive, assetIndex, "back") : undefined;
    if (!front && !back) continue;
    overrides.push(
      normalizePwanOverride({
        speciesId,
        formIndex,
        assetIndex: assetIndex === speciesId ? undefined : assetIndex,
        front,
        back,
        nativePaletteSource: back ? "back" : "front",
        carrierTemplate: "w2u-gen6-placeholder",
      }),
    );
  }
  return overrides.sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
}

export function pwanAssetPath(speciesId: number, side: "front" | "back"): string {
  return `${PWAN_ARCHIVE_PATH}:${String(pwanArchiveMemberId(speciesId, side)).padStart(4, "0")}.bin`;
}

export function pwanAssetIndex(override: Pick<PwanAnimationOverride, "speciesId" | "assetIndex">): number {
  return override.assetIndex ?? override.speciesId;
}

export function pwanArchiveMemberId(assetIndex: number, side: PwanSide): number {
  return assetIndex * 2 + (side === "back" ? 1 : 0) + 1;
}

export function pwanOverrideHasSide(override: PwanAnimationOverride, side: PwanSide): boolean {
  return Boolean(override[side]);
}

export function resolvePwanSpeciesTarget(project: ProjectState, speciesId: number, formIndex = 0): PwanSpeciesTarget {
  const formOwner = formIndex <= 0 ? findPokemonPersonalFormOwner(project, speciesId) : undefined;
  const resolvedSpeciesId = formOwner?.speciesId ?? speciesId;
  const resolvedFormIndex = formOwner?.formIndex ?? formIndex;
  const target = {
    requestedSpeciesId: speciesId,
    speciesId: resolvedSpeciesId,
    formIndex: resolvedFormIndex,
    assetIndex: resolvePwanAssetIndex(project, resolvedSpeciesId, resolvedFormIndex, speciesId),
  };
  validatePwanSpeciesTarget(project, target);
  return target;
}

export function listPwanSpeciesTargets(project: ProjectState): PwanSpeciesTarget[] {
  const count = project.narcs.personal?.fileCount ?? project.texts.banks.pokedex?.length ?? 650;
  const targets: PwanSpeciesTarget[] = [];
  for (let requestedSpeciesId = 1; requestedSpeciesId < count; requestedSpeciesId += 1) {
    try {
      targets.push(resolvePwanSpeciesTarget(project, requestedSpeciesId));
    } catch {
      // Expanded personal records that do not belong to a vanilla B2 species
      // are intentionally omitted without preventing valid imports.
    }
  }
  return targets;
}

export function findPwanOverrideForSpecies(project: ProjectState, speciesId: number, formIndex = 0): PwanAnimationOverride | undefined {
  const target = resolvePwanSpeciesTarget(project, speciesId, formIndex);
  const overrides = project.pwanAnimations?.overrides ?? [];
  return (
    overrides.find((entry) => entry.speciesId === target.speciesId && (entry.formIndex ?? 0) === target.formIndex) ??
    overrides.find((entry) => pwanAssetIndex(entry) === target.assetIndex) ??
    overrides.find((entry) => entry.speciesId === speciesId && (entry.formIndex ?? 0) === formIndex)
  );
}

export function normalizePwanSpeedScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(PWAN_MIN_SPEED_SCALE, Math.min(PWAN_MAX_SPEED_SCALE, Math.round(value * 10) / 10));
}

export function formatPwanSpeedScale(value: number): string {
  return normalizePwanSpeedScale(value).toFixed(1).replace(/\.0$/u, "");
}

export function normalizePwanOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(PWAN_MIN_OFFSET, Math.min(PWAN_MAX_OFFSET, Math.round(value)));
}

export function normalizePwanFrameScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(PWAN_MIN_FRAME_SCALE, Math.min(PWAN_MAX_FRAME_SCALE, Math.round(value / PWAN_FRAME_SCALE_STEP) * PWAN_FRAME_SCALE_STEP));
}

export function formatPwanFrameScale(value: number): string {
  return `${normalizePwanFrameScale(value).toFixed(2).replace(/0$/u, "").replace(/\.0$/u, "")}x`;
}

export function normalizePwanFrameScaleMode(value: unknown): PwanFrameScaleMode {
  return value === "outlineFill" ? "outlineFill" : "nearest";
}

export function normalizePwanOutlineThreshold(value: number): number {
  if (!Number.isFinite(value)) return PWAN_DEFAULT_OUTLINE_THRESHOLD;
  return Math.max(PWAN_MIN_OUTLINE_THRESHOLD, Math.min(PWAN_MAX_OUTLINE_THRESHOLD, Math.round(value)));
}

function validatePwanSpeciesId(speciesId: number): void {
  if (!Number.isInteger(speciesId) || speciesId <= 0) throw new Error("Choose a valid vanilla species id.");
}

function validatePwanSpeciesTarget(project: ProjectState, target: PwanSpeciesTarget): void {
  validatePwanSpeciesId(target.speciesId);
  if (project.session?.baseVersion === "B2" && target.speciesId > 649) {
    throw new Error("Black 2 PWAN imports support vanilla Gen 5 species only (1-649).");
  }
  validatePwanAssetIndex(project, target.assetIndex);
}

function validatePwanOverrideTarget(project: ProjectState, override: PwanAnimationOverride): void {
  validatePwanSpeciesTarget(project, {
    requestedSpeciesId: override.speciesId,
    speciesId: override.speciesId,
    formIndex: override.formIndex ?? 0,
    assetIndex: pwanAssetIndex(override),
  });
}

function validatePwanAssetIndex(project: ProjectState, assetIndex: number): void {
  if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex > PWAN_MAX_ASSET_INDEX) {
    throw new Error(`PWAN sprite asset ${assetIndex} is outside the supported runtime range.`);
  }
  const store = project.narcs.pokemon_sprites;
  if (store && (assetIndex + 1) * FILES_PER_SPRITE > store.rawFiles.length) {
    throw new Error(`Sprite asset ${assetIndex} is outside the loaded Pokemon sprite archive.`);
  }
}

function findPwanOverrideIndex(state: PwanAnimationState, speciesId: number, formIndex = 0): number {
  return state.overrides.findIndex((entry) => entry.speciesId === speciesId && (entry.formIndex ?? 0) === formIndex);
}

function normalizePwanOverride(override: PwanAnimationOverride): PwanAnimationOverride {
  if (!override.front && !override.back) throw new Error("A PWAN override must include at least one side.");
  const nativePaletteSource = override.nativePaletteSource === "front" && override.front ? "front" : override.nativePaletteSource === "back" && override.back ? "back" : override.front ? "front" : "back";
  return {
    ...override,
    nativePaletteSource,
    carrierTemplate: "w2u-gen6-placeholder",
    backNcecY: override.back ? deriveBackNcecY(override.back.pwanBytes) : undefined,
    notes: pwanOverrideNotes(override),
  };
}

function pwanOverrideNotes(override: PwanAnimationOverride): string[] {
  return [
    ...(override.front?.notes ?? []).map((warning) => `Front: ${warning}`),
    ...(override.back?.notes ?? []).map((warning) => `Back: ${warning}`),
  ];
}

function activePwanOverrides(overrides: PwanAnimationOverride[]): PwanAnimationOverride[] {
  return overrides.filter((override) => override.front || override.back);
}

function sortedPwanOverrides(overrides: PwanAnimationOverride[]): PwanAnimationOverride[] {
  return activePwanOverrides(overrides).sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
}

function pwanOverrideFlags(override: PwanAnimationOverride): number {
  return (override.front ? PWAN_CONFIG_FRONT_FLAG : 0) | (override.back ? PWAN_CONFIG_BACK_FLAG : 0);
}

function resolvePwanAssetIndex(project: ProjectState, speciesId: number, formIndex: number, fallbackSpeciesId: number): number {
  try {
    return resolvePokemonSpriteId(project, speciesId, formIndex);
  } catch {
    return fallbackSpeciesId;
  }
}

function buildKnarcStylePwanNarc(files: Uint8Array[]): Uint8Array {
  if (files.length > 0xffff) throw new Error(`PWAN archive has too many members: ${files.length}`);

  const fatEntries: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const file of files) {
    const start = align4(cursor);
    const end = start + file.length;
    fatEntries.push({ start, end });
    cursor = end;
  }

  const fatbSize = 0x0c + fatEntries.length * 8;
  const fntbSize = 0x10;
  const fimgDataSize = align4(cursor);
  const fimgSize = 0x08 + fimgDataSize;
  const fileSize = 0x10 + fatbSize + fntbSize + fimgSize;
  const out = new Uint8Array(fileSize);
  out.fill(0xff);

  out.set([0x4e, 0x41, 0x52, 0x43], 0);
  writeU16(out, 0x04, 0xfffe);
  writeU16(out, 0x06, 0x0100);
  writeU32(out, 0x08, fileSize);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 3);

  out.set([0x42, 0x54, 0x41, 0x46], 0x10);
  writeU32(out, 0x14, fatbSize);
  writeU16(out, 0x18, fatEntries.length);
  writeU16(out, 0x1a, 0);
  fatEntries.forEach((entry, index) => {
    const offset = 0x1c + index * 8;
    writeU32(out, offset, entry.start);
    writeU32(out, offset + 4, entry.end);
  });

  const fntbOffset = 0x10 + fatbSize;
  out.set([0x42, 0x54, 0x4e, 0x46], fntbOffset);
  writeU32(out, fntbOffset + 4, fntbSize);
  writeU32(out, fntbOffset + 8, 4);
  writeU16(out, fntbOffset + 12, 0);
  writeU16(out, fntbOffset + 14, 1);

  const fimgOffset = fntbOffset + fntbSize;
  out.set([0x47, 0x4d, 0x49, 0x46], fimgOffset);
  writeU32(out, fimgOffset + 4, fimgSize);

  const dataOffset = fimgOffset + 8;
  files.forEach((file, index) => {
    out.set(file, dataOffset + fatEntries[index]!.start);
  });
  return out;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function clearMaterializedPwanFiles(project: ProjectState): void {
  const additions = project.fileSystem?.additions;
  if (!additions) return;
  delete additions[PWAN_ARCHIVE_PATH];
  for (const path of Object.keys(additions)) {
    if (/^pokeweb_pwan\//u.test(path)) delete additions[path];
  }
}

function pwanArchiveSide(archive: NARC, assetIndex: number, side: PwanSide): PwanOverrideSide | undefined {
  const memberId = pwanArchiveMemberId(assetIndex, side);
  const bytes = archive.files[memberId];
  if (!bytes || bytes.length === 0) return undefined;
  return buildPwanOverrideSideFromPwanBytes(bytes, `${PWAN_ARCHIVE_PATH}:${String(memberId).padStart(4, "0")}.pwan`);
}

function writePwanArchiveFile(project: ProjectState, rom: NintendoDSRom | undefined, bytes: Uint8Array): void {
  const fileId = rom?.filenames.idOf(PWAN_ARCHIVE_PATH);
  if (fileId !== undefined) {
    setRomFileReplacement(project, fileId, bytes);
    return;
  }
  addRomFile(project, PWAN_ARCHIVE_PATH, bytes);
}

function captureNativeCarrierBackup(project: ProjectState, speciesId: number): void {
  const state = ensurePwanAnimationState(project);
  if (state.nativeCarrierBackups?.[String(speciesId)]) return;
  const store = project.narcs.pokemon_sprites;
  if (!store) return;
  const base = speciesId * FILES_PER_SPRITE;
  if (base + FILES_PER_SPRITE > store.rawFiles.length) return;
  state.nativeCarrierBackups![String(speciesId)] = store.rawFiles.slice(base, base + FILES_PER_SPRITE).map((file) => file.slice());
}

function restoreNativeCarrierBackup(project: ProjectState, speciesId: number): void {
  const state = ensurePwanAnimationState(project);
  const backup = state.nativeCarrierBackups?.[String(speciesId)];
  const store = project.narcs.pokemon_sprites;
  if (!backup || !store) return;
  const base = speciesId * FILES_PER_SPRITE;
  if (base + FILES_PER_SPRITE > store.rawFiles.length) return;
  backup.forEach((file, offset) => {
    store.rawFiles[base + offset] = file.slice();
    markDirty(project, "pokemon_sprites", base + offset);
  });
  delete state.nativeCarrierBackups![String(speciesId)];
}
