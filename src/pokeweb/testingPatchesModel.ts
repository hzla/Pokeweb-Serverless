import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
import walkRuntime from "../../runtime/debug-helpers/walk-through-walls-runtime.json";
import walkSignatures from "../../runtime/debug-helpers/walk-through-walls-signatures.json";
import victoryRuntime from "../../runtime/debug-helpers/instant-victory-runtime.json";
import victorySignatures from "../../runtime/debug-helpers/instant-victory-signatures.json";
import textRuntime from "../../runtime/instant-text/instant-fast-text-runtime.json";
import textSignatures from "../../runtime/instant-text/instant-fast-text-signatures.json";

export const TESTING_PATCHES = {
  "walk-through-walls": {
    title: "Walk Through Walls", fileName: "WalkThroughWallsW2.dll",
    description: "Press L + R + Start while exploring to toggle player collision bypass. Starts off at boot. Return to a normal walkable tile before turning it off. Rail paths and scripted movement keep their own rules.",
    url: new URL("../assets/codeinjection/WalkThroughWallsW2.dll", import.meta.url),
    runtime: walkRuntime, signatures: walkSignatures,
  },
  "instant-victory": {
    title: "Instant Battle Victory", fileName: "InstantBattleVictoryW2.dll",
    description: "Press A + B + Start in a local wild or trainer battle to finish with a victory after the battle interface closes. Skips the remaining fight; does not award skipped knockout EXP. Facilities, replays and network battles are excluded.",
    url: new URL("../assets/codeinjection/InstantBattleVictoryW2.dll", import.meta.url),
    runtime: victoryRuntime, signatures: victorySignatures,
  },
  "instant-fast-text": {
    title: "Instant Fast Text", fileName: "InstantFastTextW2.dll",
    description: "Makes the Fast text setting reveal up to 128 characters per update, usually a whole page. Slow and Normal retain their speeds. Page advances, choices and deliberately slow text still use the game's controls.",
    url: new URL("../assets/codeinjection/InstantFastTextW2.dll", import.meta.url),
    runtime: textRuntime, signatures: textSignatures,
  },
} as const;
export type TestingPatchId = keyof typeof TESTING_PATCHES;
export type TestingPatchStatus = { supported: boolean; compatible: boolean; installed: boolean; canUninstall: boolean; dllPath?: string; message: string };
const SYMBOL_TYPES = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"];
const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");

export function isTestingPatchRuntime(rpm: RpmModule, id: TestingPatchId): boolean {
  const expected = TESTING_PATCHES[id].runtime;
  if (rpm.baseAddress !== 0 || rpm.bssSize !== expected.bss || hex(rpm.code) !== expected.codeHex
    || rpm.metadata.PMCGameID !== "W2" || rpm.metadata.PMCVersion !== "0.1.0" || rpm.metadata.PMCModulePriority !== 4
    || rpm.symbols.some((s) => s.attributes & 2)) return false;
  const relocations = rpm.relocations.map(({ target: t, sourceSymbolIndex }) => {
    const s = rpm.symbols[sourceSymbolIndex];
    return s ? `${t.module}:${t.address.toString(16)}:${t.type}:${s.address.toString(16)}:${SYMBOL_TYPES.indexOf(s.type)}:${s.attributes}` : "invalid";
  }).sort();
  return JSON.stringify(relocations) === JSON.stringify(expected.relocations);
}

export function getTestingPatchStatus(project: ProjectState, id: TestingPatchId): TestingPatchStatus {
  const patch = TESTING_PATCHES[id];
  const status: TestingPatchStatus = { supported: false, compatible: false, installed: false, canUninstall: false, message: "Requires US White 2 (IRDO, revision 0)." };
  if (project.session.baseRom !== "BW2" || project.session.baseVersion !== "W2") return status;
  let rom: NintendoDSRom | undefined;
  try { if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes); }
  catch { return { ...status, message: "Reload the ROM to check compatibility." }; }
  if ((rom?.idCode ?? project.romInfo.idCode) !== "IRDO" || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) return status;
  status.supported = true;
  const installed: string[] = [];
  for (const entry of listCodeInjectionDlls(project)) {
    const addition = Object.keys(project.fileSystem?.additions ?? {}).find((p) => p.toLowerCase() === entry.path.toLowerCase());
    const fileId = rom?.filenames.idOf(entry.path);
    const bytes = addition ? project.fileSystem!.additions![addition]
      : rom && fileId !== undefined ? getRomFileBytes(project, rom, fileId) : undefined;
    let rpm: RpmModule | undefined;
    try { if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { /* Check reserved filenames below. */ }
    if (rpm && isTestingPatchRuntime(rpm, id)) {
      if (entry.target !== "patches") return { ...status, message: `Move ${entry.path} to patches before installing.` };
      installed.push(entry.path);
    } else if (entry.fileName.toLowerCase() === patch.fileName.toLowerCase() || (rpm && rpm.relocations.some(({ target: t, sourceSymbolIndex }) => {
      const size = t.type === "FULL_COPY" ? rpm!.symbols[sourceSymbolIndex]?.size ?? 0
        : t.type === "THUMB_BRANCH_SAFESTACK" ? 16 : t.type === "THUMB_BRANCH" ? 8 : 4;
      return patch.signatures.some((s) => t.module === s.module && t.address < s.address + s.hex.length / 2 && t.address + size > s.address);
    }))) return { ...status, message: `Conflicting code injection module: ${entry.path}.` };
  }
  status.installed = installed.length > 0;
  status.dllPath = installed[0];
  status.canUninstall = installed.length === 1 && canRemoveStagedCodeInjectionDll(project, installed[0]);
  if (installed.length > 1) return { ...status, message: "Remove the duplicate DLL before installing." };
  if (!rom) return { ...status, message: "Reload the ROM to check the native code before installation." };
  try {
    const ids = new Set(patch.signatures.filter((s) => s.module !== "ARM9").map((s) => Number(s.module)));
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_, fileId) => getRomFileBytes(project, rom!, fileId), ids);
    const arm9 = decompressCode(project.arm9 ?? rom.arm9);
    for (const s of patch.signatures) {
      const ov = overlays.get(Number(s.module));
      const base = s.module === "ARM9" ? rom.arm9RamAddress : ov?.ramAddress;
      const candidates = s.module === "ARM9" ? [arm9] : [ov?.data, project.overlays[Number(s.module)] ?? ov?.data];
      const offset = base === undefined ? -1 : s.address - base;
      if (candidates.some((data) => !data || offset < 0 || hex(data.subarray(offset, offset + s.hex.length / 2)) !== s.hex)) {
        return { ...status, message: `Native code differs in ${s.module === "ARM9" ? "ARM9" : `overlay ${s.module}`} at 0x${s.address.toString(16)}.` };
      }
    }
  } catch { return { ...status, message: "Could not read the native code to verify compatibility." }; }
  return { ...status, compatible: true, message: status.installed ? "Installed. Export the ROM to use this patch." : "Compatible White 2 code. PMC will be installed if needed." };
}

export async function installTestingPatch(project: ProjectState, id: TestingPatchId) {
  project.originalRomBytes ??= await loadActiveRomBytes();
  const status = getTestingPatchStatus(project, id);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const patch = TESTING_PATCHES[id];
  if (status.installed && status.dllPath) return { path: status.dllPath, fileName: status.dllPath.split("/").pop()! };
  const response = await fetch(patch.url);
  if (!response.ok) throw new Error(`Could not load ${patch.title} (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isTestingPatchRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), id)) throw new Error(`The bundled ${patch.title} DLL does not match its verified build.`);
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, patch.fileName, bytes);
  recordGenericChange(project, "code_injection", `${patch.title} installed.`, patch.title, { key: `code-injection:${id}` });
  return result;
}

export function uninstallTestingPatch(project: ProjectState, id: TestingPatchId): void {
  const status = getTestingPatchStatus(project, id);
  if (!status.canUninstall || !status.dllPath) throw new Error("Only a DLL staged in this project can be removed.");
  removeStagedCodeInjectionDll(project, status.dllPath);
  const patch = TESTING_PATCHES[id];
  recordGenericChange(project, "code_injection", `${patch.title} removed.`, patch.title, { key: `code-injection:${id}` });
}
