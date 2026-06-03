import { recordGenericChange } from "./actionChangelog";
import { addRomFile } from "./fileSystemModel";
import { getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState, PwanAnimationOverride, PwanAnimationState, PwanPaletteSource } from "./projectStore";
import { markDirty } from "./projectStore";
import { applyPwanCarrierPatch, deriveBackNcecY, loadBundledPwanCarrierTemplate } from "./pwanCarrierPatch";
import { compileGifToPwan } from "./pwanCompiler";

export const PWAN_CONFIG_PATH = "pokeweb_pwan/config.bin";
export const PWAN_RUNTIME_FILENAME = "PokewebPwanW2.dll";
export const PWAN_RUNTIME_PATH = `patches/${PWAN_RUNTIME_FILENAME}`;

const PWAN_RUNTIME_URL = new URL("../assets/codeinjection/PokewebPwanW2.dll", import.meta.url);
const CONFIG_MAGIC = "PWNC";
const CONFIG_VERSION_SPECIES_ONLY = 1;
const CONFIG_VERSION_FORM_AWARE = 2;
const FILES_PER_SPRITE = 20;
const MAX_PWAN_OVERRIDES = 500;

export type PwanRuntimeStatus =
  | { supported: false; installed: false; message: string }
  | { supported: true; installed: boolean; pmcInstalled: boolean; message: string };

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

export function ensurePwanAnimationState(project: ProjectState): PwanAnimationState {
  project.pwanAnimations ??= { overrides: [] };
  project.pwanAnimations.overrides ??= [];
  project.pwanAnimations.nativeCarrierBackups ??= {};
  return project.pwanAnimations;
}

export function getPwanRuntimeStatus(project: ProjectState): PwanRuntimeStatus {
  if (project.session.baseVersion !== "W2" || project.romInfo.idCode !== "IRDO") {
    return { supported: false, installed: false, message: "PWAN animation injection currently supports stock US Pokemon White 2 only." };
  }
  const pmc = getPmcInstallStatus(project);
  if (!pmc.installed) return { supported: true, installed: false, pmcInstalled: false, message: "Install the PMC runtime before staging the PWAN animation patch." };
  const installed = listCodeInjectionDlls(project).some((module) => module.path === PWAN_RUNTIME_PATH);
  return {
    supported: true,
    installed,
    pmcInstalled: true,
    message: installed ? "PWAN animation runtime is staged." : "PMC is installed; stage the PWAN animation runtime next.",
  };
}

export async function installPwanRuntime(project: ProjectState): Promise<void> {
  if (project.session.baseVersion !== "W2" || project.romInfo.idCode !== "IRDO") {
    throw new Error("PWAN animation injection currently supports stock US Pokemon White 2 only.");
  }
  const pmc = getPmcInstallStatus(project);
  if (!pmc.installed) await installBundledPmc(project);
  const response = await fetch(PWAN_RUNTIME_URL);
  if (!response.ok) throw new Error(`Could not load bundled PWAN runtime (${response.status})`);
  stageCodeInjectionDll(project, PWAN_RUNTIME_FILENAME, new Uint8Array(await response.arrayBuffer()), "patches");
  ensurePwanAnimationState(project).runtimeInstalled = true;
  recordGenericChange(project, "code_injection", "PWAN animation runtime staged.", "PWAN Runtime", { key: "pwan-runtime" });
}

export function buildPwanOverride(input: PwanOverrideInput): PwanAnimationOverride {
  if (!Number.isInteger(input.speciesId) || input.speciesId <= 0) throw new Error("Choose a valid vanilla species id.");
  const front = compileGifToPwan(input.frontGifBytes);
  const back = compileGifToPwan(input.backGifBytes);
  const backNcecY = deriveBackNcecY(back.pwanBytes);
  const notes = [...front.warnings.map((warning) => `Front: ${warning}`), ...back.warnings.map((warning) => `Back: ${warning}`)];
  return {
    speciesId: input.speciesId,
    formIndex: input.formIndex,
    assetIndex: input.assetIndex,
    front: {
      sourceFileName: input.frontFileName,
      sourceGifBytes: input.frontGifBytes,
      pwanBytes: front.pwanBytes,
      visibleHeight: front.visibleHeight,
      frameCount: front.frameCount,
      uniqueFrameCount: front.uniqueFrameCount,
      timelineCount: front.timelineCount,
      totalTicks: front.totalTicks,
      paletteBgr555: front.paletteBgr555,
    },
    back: {
      sourceFileName: input.backFileName,
      sourceGifBytes: input.backGifBytes,
      pwanBytes: back.pwanBytes,
      visibleHeight: back.visibleHeight,
      frameCount: back.frameCount,
      uniqueFrameCount: back.uniqueFrameCount,
      timelineCount: back.timelineCount,
      totalTicks: back.totalTicks,
      paletteBgr555: back.paletteBgr555,
    },
    nativePaletteSource: input.nativePaletteSource ?? "back",
    carrierTemplate: "w2u-gen6-placeholder",
    backNcecY,
    notes,
  };
}

export function upsertPwanOverride(project: ProjectState, override: PwanAnimationOverride): void {
  const state = ensurePwanAnimationState(project);
  captureNativeCarrierBackup(project, pwanAssetIndex(override));
  const index = state.overrides.findIndex((entry) => entry.speciesId === override.speciesId && (entry.formIndex ?? 0) === (override.formIndex ?? 0));
  if (index === -1) state.overrides.push(override);
  else state.overrides[index] = override;
  state.overrides.sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
  recordGenericChange(project, "pokemon_sprites", `PWAN override saved for species ${override.speciesId}.`, `Species ${override.speciesId}`, {
    key: `pwan-override:${override.speciesId}`,
  });
}

export function removePwanOverride(project: ProjectState, speciesId: number): void {
  const state = ensurePwanAnimationState(project);
  const removed = state.overrides.filter((override) => override.speciesId === speciesId);
  state.overrides = state.overrides.filter((override) => override.speciesId !== speciesId);
  removed.forEach((override) => restoreNativeCarrierBackup(project, pwanAssetIndex(override)));
  recordGenericChange(project, "pokemon_sprites", `PWAN override removed for species ${speciesId}.`, `Species ${speciesId}`, {
    key: `pwan-override-remove:${speciesId}`,
  });
}

export async function materializePwanAnimations(project: ProjectState): Promise<void> {
  const overrides = project.pwanAnimations?.overrides ?? [];
  if (overrides.length === 0) return;
  const status = getPwanRuntimeStatus(project);
  if (!status.supported) throw new Error(status.message);
  if (!status.installed) throw new Error("Install the PWAN animation runtime before exporting animated sprite overrides.");
  if (!project.narcs.pokemon_sprites) throw new Error("Pokemon Sprites must be loaded before exporting PWAN animation overrides.");

  const carrier = await loadBundledPwanCarrierTemplate();
  const sorted = [...overrides].sort((a, b) => a.speciesId - b.speciesId || (a.formIndex ?? 0) - (b.formIndex ?? 0));
  sorted.forEach((override) => {
    const assetIndex = pwanAssetIndex(override);
    applyPwanCarrierPatch(project, override, carrier);
    addRomFile(project, pwanAssetPath(assetIndex, "front"), override.front.pwanBytes);
    addRomFile(project, pwanAssetPath(assetIndex, "back"), override.back.pwanBytes);
  });
  addRomFile(project, PWAN_CONFIG_PATH, buildPwanConfig(sorted));
}

export function buildPwanConfig(overrides: PwanAnimationOverride[]): Uint8Array {
  if (overrides.length > MAX_PWAN_OVERRIDES) throw new Error(`PWAN runtime supports up to ${MAX_PWAN_OVERRIDES} species overrides.`);
  const formAware = overrides.some((override) => override.formIndex !== undefined);
  const configVersion = formAware ? CONFIG_VERSION_FORM_AWARE : CONFIG_VERSION_SPECIES_ONLY;
  const headerBytes = 16;
  const entryBytes = formAware ? 10 : 8;
  const out = new Uint8Array(headerBytes + overrides.length * entryBytes);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(CONFIG_MAGIC), 0);
  view.setUint16(4, configVersion, true);
  view.setUint16(6, overrides.length, true);
  view.setUint16(8, Math.max(0, ...overrides.flatMap((override) => [override.front.timelineCount, override.back.timelineCount])), true);
  view.setUint16(10, 0, true);
  view.setUint32(12, headerBytes, true);
  overrides.forEach((override, index) => {
    const offset = headerBytes + index * entryBytes;
    const assetIndex = pwanAssetIndex(override);
    view.setUint16(offset, override.speciesId, true);
    if (formAware) {
      view.setUint16(offset + 2, override.formIndex ?? 0, true);
      view.setUint16(offset + 4, 0x0003, true);
      view.setUint16(offset + 6, assetIndex, true);
      view.setUint16(offset + 8, assetIndex, true);
    } else {
      view.setUint16(offset + 2, 0x0003, true);
      view.setUint16(offset + 4, assetIndex, true);
      view.setUint16(offset + 6, assetIndex, true);
    }
  });
  return out;
}

export function pwanAssetPath(speciesId: number, side: "front" | "back"): string {
  return `pokeweb_pwan/${String(speciesId).padStart(3, "0")}_${side}.pwan`;
}

export function pwanAssetIndex(override: Pick<PwanAnimationOverride, "speciesId" | "assetIndex">): number {
  return override.assetIndex ?? override.speciesId;
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
