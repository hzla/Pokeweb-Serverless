import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { readCustomUiConfig } from "../customUi/runtimeConfig";
import { addRomFile, getRomFileBytes } from "./fileSystemModel";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getLearnsetViewerStatus, installLearnsetViewer, learnsetViewerPaths } from "./learnsetViewerModel";
import { getCGearQuickActionsStatus, installCGearQuickActions } from "./cgearQuickActionsModel";
import type { ProjectState } from "./projectStore";

export const POKENAV_VERSION = "0.3.0";
export const POKENAV_ARCHIVE = "pokenav/ui.narc";
const MAGIC = 0x56414e50;
function bytes(project: ProjectState, rom: NintendoDSRom | undefined, path: string): Uint8Array | undefined {
  const added = Object.entries(project.fileSystem?.additions ?? {}).find(([name]) => name.toLowerCase() === path.toLowerCase());
  if (added) return added[1];
  const id = rom?.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom!, id);
}
export function readPokenavArchive(data: Uint8Array): { enabled: boolean; version: string } {
  const arc = new NARC(data), h = arc.files[0];
  if (arc.files.length !== 2 || !h || h.length !== 16 || readU32(h, 0) !== MAGIC || readU16(h, 4) !== 1 || readU16(h, 6) !== 16
    || readU32(h, 8) > 1 || ((readU32(h, 8) ^ readU32(h, 12)) >>> 0) !== 0xffffffff) throw new Error("Unrecognized Pokenav configuration. Restore its private archive before updating.");
  const metadata = JSON.parse(new TextDecoder().decode(arc.files[1]));
  if (typeof metadata.version !== "string") throw new Error("Invalid Pokenav version metadata.");
  return { enabled: Boolean(readU32(h, 8)), version: metadata.version };
}
export function pokenavArchive(enabled: boolean): Uint8Array {
  const h = new Uint8Array(16); writeU32(h, 0, MAGIC); writeU16(h, 4, 1); writeU16(h, 6, 16);
  writeU32(h, 8, Number(enabled)); writeU32(h, 12, (~Number(enabled)) >>> 0);
  const arc = new NARC(); arc.files = [h, new TextEncoder().encode(JSON.stringify({ version: POKENAV_VERSION }))]; return arc.save();
}
function stage(project: ProjectState, rom: NintendoDSRom, enabled: boolean): void {
  const data = pokenavArchive(enabled), id = rom.filenames.idOf(POKENAV_ARCHIVE);
  if (id === undefined) addRomFile(project, POKENAV_ARCHIVE, data);
  else { project.fileSystem ??= { replacements: {} }; project.fileSystem.replacements[id] = data; }
}
export function getPokenavStatus(project: ProjectState) {
  const shared = getLearnsetViewerStatus(project), quick = getCGearQuickActionsStatus(project);
  const result = { supported: shared.supported && project.session.baseRom === "BW2", compatible: shared.compatible && quick.compatible,
    installed: false, enabled: false, updateAvailable: false, message: shared.compatible ? quick.message : shared.message };
  if (!result.supported) return { ...result, compatible: false, message: "Pokenav supports English US revision-0 Black 2 and White 2." };
  try {
    const rom = project.originalRomBytes ? new NintendoDSRom(project.originalRomBytes, { fileData: "view" }) : undefined;
    const data = bytes(project, rom, POKENAV_ARCHIVE);
    if (!data) return { ...result, message: result.compatible ? "Ready. Add a Pokenav action in C-Gear Buttons to open the current area's encounters." : result.message };
    const config = readPokenavArchive(data), modules = learnsetViewerPaths(project.session.baseVersion as "W2" | "B2");
    return { ...result, installed: true, enabled: config.enabled,
      updateAvailable: config.version !== POKENAV_VERSION || shared.updateAvailable || quick.updateAvailable || modules.some(path => !bytes(project, rom, path)),
      message: config.enabled ? "Pokenav enabled. Assign a C-Gear button to Pokenav; its encounter chance appears on the top screen." : "Pokenav disabled; its button design and shared viewers are retained." };
  } catch (error) { return { ...result, compatible: false, message: error instanceof Error ? error.message : String(error) }; }
}
/** The caller owns an isolated installation state; this never publishes partial dependencies. */
export async function stagePokenavRuntime(project: ProjectState): Promise<void> {
  const status = getPokenavStatus(project); if (!status.compatible) throw new Error(status.message);
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  const paths = learnsetViewerPaths(project.session.baseVersion as "W2" | "B2"), menu = bytes(project, rom, paths[0]);
  const keepCommand = menu ? readCustomUiConfig(menu)?.learnsetEnabled ?? getLearnsetViewerStatus(project).installed : false;
  await installLearnsetViewer(project, { enableCommand: keepCommand });
  stage(project, rom, true);
  recordGenericChange(project, "code_injection", "Pokenav installed: current seasonal water and land encounters, species information, and combined slot chances.", "Pokenav", { key: "code-injection:pokenav" });
}
export async function installPokenav(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, async staged => { await stagePokenavRuntime(staged); await installCGearQuickActions(staged); });
}
export async function disablePokenav(project: ProjectState): Promise<void> {
  await installCodeInjectionPatch(project, staged => {
    const status = getPokenavStatus(staged); if (!status.installed || !status.compatible) throw new Error(status.message);
    stage(staged, new NintendoDSRom(staged.originalRomBytes!, { fileData: "view" }), false);
    recordGenericChange(staged, "code_injection", "Pokenav disabled; C-Gear designs and shared viewers retained.", "Pokenav", { key: "code-injection:pokenav" });
  });
}
