import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { parseHeaders } from "./headerModel";
import { loadActiveRomBytes } from "./persistence";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import { markDirty, type ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import visitFlags from "../assets/data/bw2FlyVisitFlags.json";
import nativeContract from "../assets/data/bw2FlyNativeContract.json";

const COUNT = 85, STRIDE = 54, CONFIG_SIZE = 1372, MAGIC = 0x594c4650;
const RAIL_ZONES = new Set([28, 249, 214, 209, 211, 66, 241, 242, 243, 244, 36, 464]);
const FLAGS = visitFlags as Record<string, number>;
const LAYOUTS = {
  B2: { idCode: "IREO", fileName: "FlyDestinationsB2.dll", url: new URL("../assets/codeinjection/FlyDestinationsB2.dll", import.meta.url),
    hooks: [{ overlay: 33, address: 0x02178956, bytes: "a0f6b7fb", type: "THUMB_BRANCH_LINK" },
      { overlay: 144, address: 0x0219d4ae, bytes: "0a361681", type: "FULL_COPY" }],
    legacyMarkerHook: { overlay: 144, address: 0x0219e094, bytes: "08b50a1c031c022a", type: "THUMB_BRANCH" } },
  W2: { idCode: "IRDO", fileName: "FlyDestinationsW2.dll", url: new URL("../assets/codeinjection/FlyDestinationsW2.dll", import.meta.url),
    hooks: [{ overlay: 33, address: 0x02178996, bytes: "a0f6adfb", type: "THUMB_BRANCH_LINK" },
      { overlay: 144, address: 0x0219d4ee, bytes: "0a361681", type: "FULL_COPY" }],
    legacyMarkerHook: { overlay: 144, address: 0x0219e0d4, bytes: "08b50a1c031c022a", type: "THUMB_BRANCH" } },
} as const;
type Version = keyof typeof LAYOUTS;

export type FlyLanding = { x: number; y: number; z: number };
export type FlyDestinationState = { overrides: Record<number, FlyLanding> };
export type FlyDestination = {
  index: number; zone: number; landingZone: number; name: string; enabled: boolean;
  visitFlag: number; suggestedVisitFlag?: number; hiddenFlag: number;
  coordinateKind: "grid" | "rail"; landing: FlyLanding;
};
export type FlyDestinationEdit = FlyLanding & { enabled: boolean; visitFlag: number };
export type FlyDestinationStatus = { supported: boolean; compatible: boolean; installed: boolean; message: string };

function versionOf(project: ProjectState): Version | undefined {
  const version = project.session.baseVersion;
  return project.session.baseRom === "BW2" && (version === "B2" || version === "W2")
    && project.romInfo.idCode === LAYOUTS[version].idCode ? version : undefined;
}

export async function loadFlyDestinationEditorData(project: ProjectState): Promise<void> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the source ROM to open Fly Destinations.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["town_map", "headers"]);
  hydrateFlyDestinationsFromRomIfNeeded(project, rom);
}

/** Resolve the same version-specific header used by the native Fly spawn loader. */
export function resolveFlyLandingZone(project: ProjectState, landingZone: number): number {
  if (project.session.baseVersion !== "W2") return landingZone;
  return landingZone === 326 ? 551 : landingZone === 294 ? 295 : landingZone === 0 ? 424 : landingZone;
}

export function getFlyDestinations(project: ProjectState): FlyDestination[] {
  const store = project.narcs.town_map;
  const bytes = store?.rawFiles[0];
  if (!bytes || bytes.length !== COUNT * STRIDE) throw new Error("The existing BW2 Town Map must contain 85 area records.");
  project.headers ??= parseHeaders(project);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: COUNT }, (_, index) => {
    const offset = index * STRIDE;
    const zone = view.getUint16(offset, true);
    const landingZone = zone === 490 ? 326 : zone;
    const effectiveZone = resolveFlyLandingZone(project, landingZone);
    const header = project.headers!.rows[zone + 1];
    const landingHeader = project.headers!.rows[effectiveZone + 1];
    if (!header || !landingHeader) throw new Error(`Town Map area ${zone} has no matching map header.`);
    const fallback = { x: Number(landingHeader.fly_x) | 0, y: Number(landingHeader.fly_y) | 0, z: Number(landingHeader.fly_z) | 0 };
    return { index, zone, landingZone, name: String(header.location_name || `Area ${zone}`),
      enabled: view.getUint16(offset + 24, true) !== 0,
      visitFlag: view.getUint16(offset + 30, true), suggestedVisitFlag: FLAGS[String(zone)],
      hiddenFlag: view.getUint16(offset + 32, true),
      coordinateKind: RAIL_ZONES.has(landingZone) ? "rail" : "grid",
      landing: { ...(project.flyDestinations?.overrides[zone] ?? fallback) } };
  });
}

export function validateFlyDestinationEdit(destination: FlyDestination, edit: FlyDestinationEdit): void {
  // Main saved flags and the three Town Map predicate flags; 0xFFFF means no visit flag.
  if (!Number.isInteger(edit.visitFlag) || !((edit.visitFlag >= 1 && edit.visitFlag < 3060)
    || (edit.visitFlag >= 0xf000 && edit.visitFlag <= 0xf002) || edit.visitFlag === 0xffff)) {
    throw new Error("Use a visit flag from 1–3059, a Town Map condition (61440–61442), or 65535 for none.");
  }
  if (edit.enabled && edit.visitFlag === 0xffff) throw new Error("An enabled Fly destination needs a visit flag. Choose the area's existing flag or a flag set by your scripts.");
  for (const axis of ["x", "y", "z"] as const) {
    const min = destination.coordinateKind === "rail" && axis !== "z" ? 0 : -32768;
    const max = destination.coordinateKind === "rail" && axis !== "z" ? 65535 : 32767;
    if (!Number.isInteger(edit[axis]) || edit[axis] < min || edit[axis] > max)
      throw new Error(`${axis.toUpperCase()} must be an integer from ${min} to ${max}.`);
  }
}

function validateOverride(zone: number, landing: FlyLanding): void {
  if (!Number.isInteger(zone) || zone < 0 || zone >= 615) throw new Error("Fly configuration contains an invalid area ID.");
  for (const axis of ["x", "y", "z"] as const) {
    const rail = RAIL_ZONES.has(zone) && axis !== "z";
    if (!Number.isInteger(landing[axis]) || landing[axis] < (rail ? 0 : -32768) || landing[axis] > (rail ? 65535 : 32767))
      throw new Error("Fly configuration contains an invalid landing coordinate.");
  }
}

function configSymbol(rpm: RpmModule) {
  const symbol = rpm.symbols.find(symbol => symbol.name === "FlyDestinationConfig");
  if (!symbol || symbol.size !== CONFIG_SIZE || symbol.address + CONFIG_SIZE > rpm.code.length)
    throw new Error("Fly destination configuration is missing or damaged.");
  const view = new DataView(rpm.code.buffer, rpm.code.byteOffset + symbol.address, symbol.size);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== COUNT)
    throw new Error("Fly destination configuration has an unsupported format.");
  return view;
}

export function configureFlyDestinationRuntime(bytes: Uint8Array, version: Version, state: FlyDestinationState): Uint8Array {
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  assertOwnRuntime(rpm, version);
  const view = configSymbol(rpm);
  new Uint8Array(view.buffer, view.byteOffset + 12, CONFIG_SIZE - 12).fill(0);
  const entries = Object.entries(state.overrides);
  if (entries.length > COUNT) throw new Error("Only existing Town Map areas can have Fly overrides.");
  entries.forEach(([zone, landing], index) => {
    validateOverride(Number(zone), landing);
    const offset = 12 + index * 16;
    view.setUint16(offset, Number(zone), true); view.setUint16(offset + 2, 1, true);
    view.setInt32(offset + 4, landing.x, true); view.setInt32(offset + 8, landing.y, true); view.setInt32(offset + 12, landing.z, true);
  });
  return writeRpm(rpm, { ident: "DLXF" });
}

export function readFlyDestinationRuntime(bytes: Uint8Array, version: Version): FlyDestinationState {
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  assertOwnRuntime(rpm, version);
  const view = configSymbol(rpm), overrides: Record<number, FlyLanding> = {};
  for (let index = 0; index < COUNT; index++) {
    const offset = 12 + index * 16;
    const flags = view.getUint16(offset + 2, true);
    if (flags > 1) throw new Error("Fly configuration contains unsupported entry flags.");
    if (!flags) continue;
    const zone = view.getUint16(offset, true);
    if (overrides[zone]) throw new Error("Duplicate Fly destination configuration.");
    overrides[zone] = { x: view.getInt32(offset + 4, true), y: view.getInt32(offset + 8, true), z: view.getInt32(offset + 12, true) };
    validateOverride(zone, overrides[zone]);
  }
  return { overrides };
}

function assertOwnRuntime(rpm: RpmModule, version: Version): void {
  const actual = rpm.relocations.filter(({ target }) => target.module !== "base")
    .map(({ target }) => `${target.type}:${target.module}:${target.address}`).sort().join("|");
  const hooks = rpm.metadata.PMCVersion === "1.0.0" ? [...LAYOUTS[version].hooks, LAYOUTS[version].legacyMarkerHook] : LAYOUTS[version].hooks;
  const expected = hooks.map(h => `${h.type}:${h.overlay}:${h.address}`).sort().join("|");
  if (rpm.metadata.PMCGameID !== version || (rpm.metadata.PMCVersion !== "1.0.0" && rpm.metadata.PMCVersion !== "1.0.1")
    || rpm.metadata.PMCModulePriority !== 4 || rpm.bssSize !== 0 || actual !== expected)
    throw new Error("Fly destination DLL does not match the supported game and hook contract.");
  configSymbol(rpm);
}

function ownModuleBytes(project: ProjectState, rom: NintendoDSRom, version: Version): Uint8Array | undefined {
  const path = `patches/${LAYOUTS[version].fileName}`;
  const addition = Object.entries(project.fileSystem?.additions ?? {}).find(([p]) => p.toLowerCase() === path.toLowerCase());
  if (addition) return addition[1];
  const fileId = rom.filenames.idOf(path);
  return fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
}

export function hydrateFlyDestinationsFromRom(project: ProjectState, rom: NintendoDSRom): void {
  const version = versionOf(project);
  if (!version) return;
  const bytes = ownModuleBytes(project, rom, version);
  if (!bytes) return;
  project.flyDestinations = readFlyDestinationRuntime(bytes, version);
}

export function getFlyDestinationStatus(project: ProjectState): FlyDestinationStatus {
  const version = versionOf(project);
  const fail = (message: string, supported = true, installed = false): FlyDestinationStatus => ({ supported, compatible: false, installed, message });
  if (!version) return fail("Fly destination editing supports US Black 2 and White 2.", false);
  if (!project.originalRomBytes) return fail("Reload the source ROM to check Fly destination support.");
  try {
    getFlyDestinations(project);
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    if (rom.idCode !== LAYOUTS[version].idCode) return fail("The source ROM does not match this project's game.");
    const own = ownModuleBytes(project, rom, version);
    if (own) readFlyDestinationRuntime(own, version);
    const layout = LAYOUTS[version];
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([33, 144]));
    for (const range of nativeContract[version].ranges) {
      const overlay = range.module === "ARM9" ? undefined : overlays.get(Number(range.module));
      const data = range.module === "ARM9" ? project.arm9 : project.overlays[Number(range.module)] ?? overlay?.data;
      const offset = range.address - (range.module === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress ?? 0);
      if (!data || offset < 0 || offset + range.size > data.length || sha256Hex(data.subarray(offset, offset + range.size)) !== range.sha256)
        return fail("The Fly or Town Map code differs from the supported BW2 layout.", true, Boolean(own));
    }
    for (const hook of layout.hooks) {
      const overlay = overlays.get(hook.overlay), data = project.overlays[hook.overlay] ?? overlay?.data;
      const offset = hook.address - (overlay?.ramAddress ?? 0);
      if (!data || hex(data.subarray(offset, offset + hook.bytes.length / 2)) !== hook.bytes)
        return fail("The Fly or Town Map code differs from the supported BW2 layout.", true, Boolean(own));
    }
    for (const module of listCodeInjectionDlls(project)) {
      if (module.path.toLowerCase() === `patches/${layout.fileName}`.toLowerCase()) continue;
      const fileId = rom.filenames.idOf(module.path);
      const bytes = project.fileSystem?.additions?.[module.path] ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
      if (!bytes) throw new Error(`Could not check ${module.fileName}.`);
      const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
      for (const relocation of rpm.relocations) {
        const size = relocation.target.type === "FULL_COPY" ? rpm.symbols[relocation.sourceSymbolIndex]?.size ?? 0
          : relocation.target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : relocation.target.type.endsWith("BRANCH") ? 8 : 4;
        if (nativeContract[version].ranges.some(range => relocation.target.module === range.module
          && relocation.target.address < range.address + range.size && relocation.target.address + size > range.address)
          || layout.hooks.some(hook => relocation.target.module === String(hook.overlay)
          && relocation.target.address < hook.address + hook.bytes.length / 2 && relocation.target.address + size > hook.address))
          return fail(`${module.fileName} already changes a Fly destination hook.`, true, Boolean(own));
      }
    }
    const legacy = own && parseRpm(own, { allowedMagics: ["DLXF"] }).metadata.PMCVersion === "1.0.0";
    return { supported: true, compatible: true, installed: Boolean(own), message: legacy
      ? "Apply a destination to update Fly support and restore the original Town Map markers, then export the ROM."
      : own ? "Fly destination settings are included when you export the ROM." : "Changes will be included when you export the ROM." };
  } catch (error) { return fail(error instanceof Error ? error.message : "Could not check Fly destination support."); }
}

export async function applyFlyDestinationEdit(project: ProjectState, index: number, edit: FlyDestinationEdit): Promise<void> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the source ROM before editing Fly destinations.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["town_map", "headers"]);
  hydrateFlyDestinationsFromRomIfNeeded(project, rom);
  const destination = getFlyDestinations(project)[index];
  if (!destination) throw new Error("Select an existing Town Map area.");
  validateFlyDestinationEdit(destination, edit);
  const status = getFlyDestinationStatus(project);
  if (!status.compatible) throw new Error(status.message);
  const version = versionOf(project)!;
  const response = await fetch(LAYOUTS[version].url);
  if (!response.ok) throw new Error(`Could not load Fly destination support (${response.status}).`);
  const runtime = new Uint8Array(await response.arrayBuffer());
  await installCodeInjectionPatch(project, staged => {
    const entries = getFlyDestinations(staged);
    const overrides = { ...staged.flyDestinations?.overrides };
    // Pin each side of the old shared landing point independently on first edit.
    for (const zone of [326, 490]) {
      const entry = entries.find(entry => entry.zone === zone);
      if (entry && !overrides[zone]) overrides[zone] = { ...entry.landing };
    }
    overrides[destination.zone] = { x: edit.x, y: edit.y, z: edit.z };
    const state = { overrides };
    const configured = configureFlyDestinationRuntime(runtime, version, state);
    stageCodeInjectionDll(staged, LAYOUTS[version].fileName, configured);
    const store = staged.narcs.town_map!;
    const bytes = store.rawFiles[0].slice();
    const view = new DataView(bytes.buffer);
    view.setUint16(index * STRIDE + 24, edit.enabled ? 1 : 0, true);
    view.setUint16(index * STRIDE + 30, edit.visitFlag, true);
    store.rawFiles[0] = bytes; store.records.clear(); markDirty(staged, "town_map", 0);
    staged.flyDestinations = state;
    recordGenericChange(staged, "fly_destinations", `${destination.name}: Fly ${edit.enabled ? "enabled" : "disabled"}; visit flag ${edit.visitFlag}; landing (${edit.x}, ${edit.y}, ${edit.z}).`, destination.name, { key: `fly:${destination.zone}` });
  });
}

function hydrateFlyDestinationsFromRomIfNeeded(project: ProjectState, rom: NintendoDSRom): void {
  if (!project.flyDestinations) hydrateFlyDestinationsFromRom(project, rom);
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
