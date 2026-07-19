import { gunzipSync } from "fflate";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, replaceRomFile } from "./fileSystemModel";
import { refreshDecodedTextState } from "./loader";
import {
  detectWhite2UpgradeDlls,
  getPmcInstallStatus,
  installPmcBytes,
  listCodeInjectionDlls,
  loadBundledPmcBytes,
  stageCodeInjectionDll,
} from "./pmcModel";
import { loadBundledPwanRuntimeArtifacts } from "./pwanAnimationModel";
import type { ActionChangelogState } from "./actionChangelog";
import type { ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";

export type Bw2UpgradeVariant = "white2-upgrade" | "black2-upgrade";
export type Black2UpgradeInstallState =
  | "unsupported"
  | "clean-ready"
  | "installing"
  | "installed"
  | "runtime-update"
  | "incomplete/conflict"
  | "incompatible";

export type Black2UpgradeInstallStatus = {
  state: Black2UpgradeInstallState;
  supported: boolean;
  canInstall: boolean;
  message: string;
  marker?: Black2UpgradeMarker;
};

export type Black2UpgradeMarker = {
  magic: "B2UP";
  schemaVersion: number;
  baseGameId: "IREO";
  dataVersion: number;
  runtimeAbi: number;
  packageChecksum: string;
};

type PackageFile = { path: string; operation: "replace" | "add-or-replace"; size: number; sha256: string };
type Arm9Patch = { operation: "patch-arm9-decompressed"; offset: number; size: number; originalHex: string; replacementHex: string; itemId?: number };
export type Black2UpgradePackageManifest = {
  schemaVersion: number;
  magic: "B2UP-PACKAGE";
  baseGameId: "IREO";
  baseRomSha256: string;
  runtimeAbi: number;
  dataVersion: number;
  packageChecksum: string;
  files: PackageFile[];
  arm9Patches: Arm9Patch[];
};

type CompatibilityEntry = { symbol?: string; name?: string; segment?: string | null; address: string; originalHex?: string };
export type Black2UpgradeCompatibilityManifest = {
  baseGameId: "IREO";
  baseRomSha256: string;
  runtimeAbi: number;
  expansionDataVersion: number;
  hooks: CompatibilityEntry[];
  importedFunctions?: CompatibilityEntry[];
  rawAnchors?: CompatibilityEntry[];
};

export type Black2UpgradeInstallBundle = {
  packageBytes: Uint8Array;
  packageManifestBytes: Uint8Array;
  compatibilityBytes: Uint8Array;
  pmcBytes: Uint8Array;
  runtimeArtifacts: Array<{ fileName: string; bytes: Uint8Array }>;
  pwanRuntimeArtifacts: Array<{ fileName: string; bytes: Uint8Array }>;
};

const BASE_ROM_SHA256 = "2e6b2415354aa41471bc7617068dce059a59931bf5c4348a264f8043f297683a";
export const BLACK2UPGRADE_RUNTIME_ABI = 1;
export const BLACK2UPGRADE_DATA_VERSION = 1;
export const BLACK2UPGRADE_MARKER_PATH = "data/black2upgrade/manifest.json";
export const BLACK2UPGRADE_RUNTIME_FILENAMES = [
  "Black2Upgrade.dll",
  "Black2UpgradeField.dll",
  "Black2UpgradePokedex.dll",
  "Black2UpgradeUI.dll",
] as const;

const PACKAGE_URL = new URL("../assets/black2upgrade/black2upgrade-data.tar.gz", import.meta.url);
const PACKAGE_MANIFEST_URL = new URL("../assets/black2upgrade/black2upgrade-package-manifest.json", import.meta.url);
const COMPATIBILITY_URL = new URL("../assets/black2upgrade/black2upgrade-compatibility.json", import.meta.url);
const ARTIFACT_MANIFEST_URL = new URL("../assets/black2upgrade/artifact-manifest.json", import.meta.url);
const RUNTIME_URLS = [
  { fileName: "Black2Upgrade.dll", url: new URL("../assets/codeinjection/Black2Upgrade.dll", import.meta.url) },
  { fileName: "Black2UpgradeField.dll", url: new URL("../assets/codeinjection/Black2UpgradeField.dll", import.meta.url) },
  { fileName: "Black2UpgradePokedex.dll", url: new URL("../assets/codeinjection/Black2UpgradePokedex.dll", import.meta.url) },
  { fileName: "Black2UpgradeUI.dll", url: new URL("../assets/codeinjection/Black2UpgradeUI.dll", import.meta.url) },
] as const;

export function detectBw2Upgrade(project: ProjectState): Bw2UpgradeVariant | undefined {
  if (project.session.baseVersion === "W2" && detectWhite2UpgradeDlls(project)) return "white2-upgrade";
  if (project.session.baseVersion !== "B2") return undefined;
  const marker = readBlack2UpgradeMarker(project);
  return marker?.magic === "B2UP" ? "black2-upgrade" : undefined;
}

export function usesExpandedBw2Data(project: ProjectState): boolean {
  return detectBw2Upgrade(project) !== undefined;
}

export function getBlack2UpgradeInstallStatus(project: ProjectState): Black2UpgradeInstallStatus {
  if (project.session.baseRom !== "BW2" || project.session.baseVersion !== "B2") {
    return { state: "unsupported", supported: false, canInstall: false, message: "Black 2 Upgrade is available only for US Black 2 projects." };
  }
  if (project.romInfo.idCode !== "IREO") {
    return { state: "incompatible", supported: true, canInstall: false, message: `Black 2 Upgrade requires the US IREO ROM; this project is ${project.romInfo.idCode}.` };
  }

  const markerBytes = romPathBytes(project, BLACK2UPGRADE_MARKER_PATH);
  const marker = parseMarker(markerBytes);
  const runtimePaths = new Set(listCodeInjectionDlls(project).map((module) => module.path.toLowerCase()));
  const presentRuntimeCount = BLACK2UPGRADE_RUNTIME_FILENAMES.filter((name) => runtimePaths.has(`patches/${name}`.toLowerCase())).length;
  if (markerBytes && !marker) {
    return { state: "incomplete/conflict", supported: true, canInstall: false, message: "The Black 2 Upgrade marker is malformed or belongs to a conflicting expansion." };
  }
  if (marker) {
    if (marker.baseGameId !== "IREO" || marker.runtimeAbi !== BLACK2UPGRADE_RUNTIME_ABI || marker.dataVersion !== BLACK2UPGRADE_DATA_VERSION) {
      return { state: "incompatible", supported: true, canInstall: false, marker, message: `Expansion marker ABI/data version ${marker.runtimeAbi}/${marker.dataVersion} is incompatible with bundled ${BLACK2UPGRADE_RUNTIME_ABI}/${BLACK2UPGRADE_DATA_VERSION}.` };
    }
    const pmcInstalled = getPmcInstallStatus(project).installed;
    if (presentRuntimeCount === BLACK2UPGRADE_RUNTIME_FILENAMES.length && pmcInstalled) {
      return { state: "installed", supported: true, canInstall: true, marker, message: "Black 2 Upgrade data and all four runtime modules are installed." };
    }
    return { state: "runtime-update", supported: true, canInstall: true, marker, message: "Expanded data is valid; PMC or one or more Black 2 Upgrade runtime modules need to be installed or updated." };
  }
  if (presentRuntimeCount > 0) {
    return { state: "incomplete/conflict", supported: true, canInstall: false, message: "Black 2 Upgrade DLLs are present without a valid expansion-data marker. Partial unmarked installs are not upgraded automatically." };
  }
  if (project.romInfo.sourceSha256?.toLowerCase() === BASE_ROM_SHA256) {
    return { state: "clean-ready", supported: true, canInstall: true, message: "Exact clean US Black 2 (IREO) base verified and ready." };
  }
  return {
    state: "incompatible",
    supported: true,
    canInstall: false,
    message: "Fresh installation requires the exact clean US Black 2 ROM. MoonBlack2, other hacks, other regions, and modified bases are intentionally rejected.",
  };
}

export async function loadBlack2UpgradeInstallBundle(options: { runtimeOnly?: boolean } = {}): Promise<Black2UpgradeInstallBundle> {
  const runtimeOnly = options.runtimeOnly ?? false;
  const [packageBytes, packageManifestBytes, compatibilityBytes, artifactManifestBytes, pmcBytes, runtimeArtifacts, pwanRuntimeArtifacts] = await Promise.all([
    runtimeOnly ? Promise.resolve(new Uint8Array()) : fetchBytes(PACKAGE_URL, "Black 2 Upgrade data package"),
    fetchBytes(PACKAGE_MANIFEST_URL, "Black 2 Upgrade package manifest"),
    fetchBytes(COMPATIBILITY_URL, "Black 2 Upgrade compatibility manifest"),
    fetchBytes(ARTIFACT_MANIFEST_URL, "Black 2 Upgrade artifact manifest"),
    loadBundledPmcBytes("B2"),
    Promise.all(RUNTIME_URLS.map(async ({ fileName, url }) => ({ fileName, bytes: await fetchBytes(url, fileName) }))),
    runtimeOnly ? Promise.resolve([]) : loadBundledPwanRuntimeArtifacts("B2"),
  ]);
  const sync = parseJson<{ artifacts: Record<string, { size: number; sha256: string }> }>(artifactManifestBytes, "artifact manifest");
  const committed = [
    ...(runtimeOnly ? [] : [{ name: "black2upgrade-data.tar.gz", bytes: packageBytes }]),
    { name: "black2upgrade-package-manifest.json", bytes: packageManifestBytes },
    { name: "black2upgrade-compatibility.json", bytes: compatibilityBytes },
    ...runtimeArtifacts.map(({ fileName: name, bytes }) => ({ name, bytes })),
  ];
  for (const artifact of committed) {
    const expected = sync.artifacts[artifact.name];
    if (!expected || expected.size !== artifact.bytes.length || (await sha256Hex(artifact.bytes)) !== expected.sha256) {
      throw new Error(`Bundled Black 2 Upgrade artifact failed verification: ${artifact.name}.`);
    }
  }
  for (const artifact of runtimeArtifacts) {
    const metadata = parseRpm(artifact.bytes, { allowedMagics: ["DLXF"] }).metadata;
    const priority = artifact.fileName === "Black2Upgrade.dll" ? 1 : 4;
    if (
      metadata.PMCGameID !== "B2" ||
      metadata.Black2UpgradeRuntimeABI !== BLACK2UPGRADE_RUNTIME_ABI ||
      metadata.Black2UpgradeDataVersion !== BLACK2UPGRADE_DATA_VERSION ||
      metadata.PMCModulePriority !== priority
    ) {
      throw new Error(`Bundled Black 2 Upgrade runtime metadata is incompatible: ${artifact.fileName}.`);
    }
  }
  return { packageBytes, packageManifestBytes, compatibilityBytes, pmcBytes, runtimeArtifacts, pwanRuntimeArtifacts };
}

export async function installBlack2Upgrade(project: ProjectState): Promise<void> {
  const status = getBlack2UpgradeInstallStatus(project);
  if (!status.canInstall) throw new Error(status.message);
  return installBlack2UpgradeWithBundle(project, await loadBlack2UpgradeInstallBundle({ runtimeOnly: status.state !== "clean-ready" }));
}

export async function installBlack2UpgradeWithBundle(project: ProjectState, bundle: Black2UpgradeInstallBundle): Promise<void> {
  const status = getBlack2UpgradeInstallStatus(project);
  if (!status.canInstall) throw new Error(status.message);
  const fresh = status.state === "clean-ready";
  const packageManifest = parseJson<Black2UpgradePackageManifest>(bundle.packageManifestBytes, "package manifest");
  const compatibility = parseJson<Black2UpgradeCompatibilityManifest>(bundle.compatibilityBytes, "compatibility manifest");
  validateManifestVersions(packageManifest, compatibility);
  if (!fresh && status.marker?.packageChecksum !== packageManifest.packageChecksum) {
    throw new Error("The installed Black 2 Upgrade data package checksum does not match this runtime release; automatic runtime-only update was blocked.");
  }
  validateCompatibility(project, compatibility);

  if (fresh && bundle.packageBytes.length === 0) throw new Error("Fresh Black 2 Upgrade installation requires the verified expansion data package.");
  const packageFiles = fresh ? await unpackAndVerifyPackage(bundle.packageBytes, packageManifest) : undefined;
  const draft = structuredClone(project) as ProjectState;
  const previousChangelog = structuredClone(project.actionChangelog) as ActionChangelogState | undefined;
  if (fresh && packageFiles) {
    stageFreshExpansionData(draft, packageManifest, packageFiles);
  }
  installPmcBytes(draft, bundle.pmcBytes, requireRomBytes(draft));
  for (const artifact of bundle.runtimeArtifacts) stageCodeInjectionDll(draft, artifact.fileName, artifact.bytes, "patches");
  if (fresh) {
    for (const artifact of bundle.pwanRuntimeArtifacts) stageCodeInjectionDll(draft, artifact.fileName, artifact.bytes, "patches");
    draft.pwanAnimations ??= { overrides: [] };
    draft.pwanAnimations.runtimeInstalled = true;
  }

  draft.actionChangelog = previousChangelog;
  recordGenericChange(
    draft,
    "code_injection",
    fresh
      ? "Installed Black 2 Upgrade expanded data, PMC, four upgrade runtimes, three PWAN runtimes, and the canonical PWAN archive."
      : "Updated Black 2 Upgrade PMC and all four runtime modules without replacing expanded data or user-edited archives.",
    "Black 2 Upgrade",
    { key: "black2upgrade:install" },
  );
  Object.assign(project, draft);
}

export function readBlack2UpgradeMarker(project: ProjectState): Black2UpgradeMarker | undefined {
  return parseMarker(romPathBytes(project, BLACK2UPGRADE_MARKER_PATH));
}

function stageFreshExpansionData(project: ProjectState, manifest: Black2UpgradePackageManifest, files: Map<string, Uint8Array>): void {
  const rom = new NintendoDSRom(requireRomBytes(project));
  for (const entry of manifest.files) {
    const bytes = files.get(entry.path);
    if (!bytes) throw new Error(`Verified package is missing ${entry.path}.`);
    const fileId = rom.filenames.idOf(entry.path);
    if (entry.operation === "replace") {
      if (fileId === undefined) throw new Error(`Clean Black 2 is missing required ROM path ${entry.path}.`);
      replaceRomFile(project, rom, fileId, bytes);
    } else if (fileId === undefined) addRomFile(project, entry.path, bytes);
    else replaceRomFile(project, rom, fileId, bytes);
  }
  applyArm9Patches(project, manifest.arm9Patches);
  refreshDecodedTextState(project);
}

function applyArm9Patches(project: ProjectState, patches: Arm9Patch[]): void {
  const arm9 = project.arm9.slice();
  for (const patch of patches) {
    const expected = hexBytes(patch.originalHex);
    const replacement = hexBytes(patch.replacementHex);
    const current = arm9.subarray(patch.offset, patch.offset + patch.size);
    if (!bytesEqual(current, expected) && !bytesEqual(current, replacement)) {
      throw new Error(`ARM9 item-icon signature mismatch at 0x${patch.offset.toString(16)}${patch.itemId === undefined ? "" : ` (item ${patch.itemId})`}.`);
    }
    arm9.set(replacement, patch.offset);
  }
  project.arm9 = arm9;
  project.arm9Dirty = true;
}

async function unpackAndVerifyPackage(packageBytes: Uint8Array, external: Black2UpgradePackageManifest): Promise<Map<string, Uint8Array>> {
  const entries = parseTar(gunzipSync(packageBytes));
  const internalBytes = entries.get("manifest.json");
  if (!internalBytes) throw new Error("Black 2 Upgrade package has no internal manifest.");
  const internal = parseJson<Black2UpgradePackageManifest>(internalBytes, "internal package manifest");
  if (canonicalJson(internal) !== canonicalJson(external)) throw new Error("The internal and committed Black 2 Upgrade manifests do not match.");
  const files = new Map<string, Uint8Array>();
  const payloadParts: Uint8Array[] = [];
  for (const entry of [...external.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const bytes = entries.get(`files/${entry.path}`);
    if (!bytes) throw new Error(`Black 2 Upgrade package is missing ${entry.path}.`);
    if (bytes.length !== entry.size || (await sha256Hex(bytes)) !== entry.sha256) throw new Error(`Black 2 Upgrade package file failed verification: ${entry.path}.`);
    files.set(entry.path, bytes);
    if (entry.path === BLACK2UPGRADE_MARKER_PATH) continue;
    payloadParts.push(new TextEncoder().encode(`${entry.path}\0`), u64le(bytes.length), hexBytes(entry.sha256));
  }
  payloadParts.push(new TextEncoder().encode(canonicalJson(external.arm9Patches)));
  if ((await sha256Hex(concatBytes(payloadParts))) !== external.packageChecksum) throw new Error("Black 2 Upgrade package payload checksum does not match its manifest.");
  const marker = parseMarker(files.get(BLACK2UPGRADE_MARKER_PATH));
  if (!marker || marker.packageChecksum !== external.packageChecksum) throw new Error("Black 2 Upgrade package marker does not match the verified payload.");
  return files;
}

function validateManifestVersions(pkg: Black2UpgradePackageManifest, compatibility: Black2UpgradeCompatibilityManifest): void {
  if (pkg.magic !== "B2UP-PACKAGE" || pkg.baseGameId !== "IREO" || pkg.baseRomSha256 !== BASE_ROM_SHA256) throw new Error("Bundled expansion package does not target the supported clean IREO ROM.");
  if (pkg.runtimeAbi !== BLACK2UPGRADE_RUNTIME_ABI || pkg.dataVersion !== BLACK2UPGRADE_DATA_VERSION) throw new Error("Bundled expansion package has an incompatible runtime ABI or data version.");
  if (compatibility.baseGameId !== "IREO" || compatibility.baseRomSha256 !== BASE_ROM_SHA256) throw new Error("Bundled compatibility manifest does not target clean IREO.");
  if (compatibility.runtimeAbi !== pkg.runtimeAbi || compatibility.expansionDataVersion !== pkg.dataVersion) throw new Error("Compatibility and expansion package versions do not match.");
}

function validateCompatibility(project: ProjectState, manifest: Black2UpgradeCompatibilityManifest): void {
  const rom = new NintendoDSRom(requireRomBytes(project));
  const entries = [...manifest.hooks, ...(manifest.importedFunctions ?? []), ...(manifest.rawAnchors ?? [])].filter((entry) => entry.originalHex && entry.segment);
  const overlayIds = [...new Set(entries.map((entry) => entry.segment).filter((segment): segment is string => segment !== "ARM9").map(Number))];
  const overlays = rom.loadArm9Overlays(overlayIds);
  const failures: string[] = [];
  for (const entry of entries) {
    const address = Number.parseInt(entry.address, 16) & ~1;
    const expected = hexBytes(entry.originalHex!);
    let data: Uint8Array | undefined;
    let base = 0;
    if (entry.segment === "ARM9") {
      data = project.arm9;
      base = rom.arm9RamAddress;
    } else {
      const overlayId = Number(entry.segment);
      data = project.overlays[overlayId] ?? overlays.get(overlayId)?.data;
      base = overlays.get(overlayId)?.ramAddress ?? 0;
    }
    const offset = address - base;
    if (!data || offset < 0 || offset + expected.length > data.length || !bytesEqual(data.subarray(offset, offset + expected.length), expected)) {
      failures.push(entry.symbol ?? entry.name ?? `${entry.segment}:${entry.address}`);
      if (failures.length === 5) break;
    }
  }
  if (failures.length > 0) throw new Error(`Black 2 Upgrade code-signature validation failed. Modified or incompatible hook windows: ${failures.join(", ")}.`);
}

function romPathBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const staged = project.fileSystem?.additions?.[path];
  if (staged) return staged;
  if (!project.originalRomBytes) return undefined;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes);
    const fileId = rom.filenames.idOf(path);
    if (fileId === undefined) return undefined;
    return project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  } catch {
    return undefined;
  }
}

function parseMarker(bytes: Uint8Array | undefined): Black2UpgradeMarker | undefined {
  if (!bytes) return undefined;
  try {
    const marker = JSON.parse(new TextDecoder().decode(bytes)) as Black2UpgradeMarker;
    return marker.magic === "B2UP" ? marker : undefined;
  } catch {
    return undefined;
  }
}

function parseTar(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const size = Number.parseInt(tarText(header.subarray(124, 136)).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error("Black 2 Upgrade package contains an invalid tar entry.");
    const path = prefix ? `${prefix}/${name}` : name;
    if (header[156] === 0 || header[156] === 48) entries.set(path, bytes.slice(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function requireRomBytes(project: ProjectState): Uint8Array {
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Black 2 Upgrade.");
  return project.originalRomBytes;
}

async function fetchBytes(url: URL, label: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled ${label} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error(`Bundled Black 2 Upgrade ${label} is invalid JSON.`);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = bytes.slice().buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hexadecimal data in Black 2 Upgrade manifest.");
  return Uint8Array.from({ length: hex.length / 2 }, (_value, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function u64le(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
