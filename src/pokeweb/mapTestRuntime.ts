import { readU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { loadOverlayTable } from "../nds/code";
import { getRomFileBytes } from "./fileSystemModel";
import { getPmcInstallStatus, installBundledPmc, stageCodeInjectionDll, listCodeInjectionDlls } from "./pmcModel";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import type { ProjectState } from "./projectStore";
import bindings from "../../runtime/debug-helpers/map-test-bindings.json";
import walkRuntime from "../../runtime/debug-helpers/walk-through-walls-runtime.json";

export type MapTestVersion = keyof typeof bindings;
const code = Uint8Array.from([0x00,0x20,0x06,0xb0,0xf8,0xbd,0x00,0xbf,0x00,0x20,0x38,0xbd]);
const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2,"0")).join("");
export function mapTestProfile(project: ProjectState) {
  const version = project.session.baseVersion as MapTestVersion, profile = bindings[version];
  if (!profile || profile.idCode !== project.romInfo.idCode || project.originalRomBytes && project.originalRomBytes[0x1e] !== profile.revision) throw new Error("Map testing requires a supported US revision-0 Black, White, Black 2 or White 2 ROM.");
  return { ...profile, version };
}
/** Always on in this disposable test ROM; the ordinary toggle module stays untouched. */
export function createMapTestWalkRuntime(version: MapTestVersion): Uint8Array {
  const profile = bindings[version];
  const rpm: RpmModule = { code: code.slice(), bssSize: 0, baseAddress: 0,
    symbols: [0,8].map((address,i) => ({ name: i ? "MapTestRailReturn" : "MapTestCollisionReturn", address, size: i ? 4 : 6, type: "FUNCTION_THM", attributes: 1 })),
    relocations: [profile.collisionReturn, profile.railCollisionReturn].map((address, sourceSymbolIndex) => ({ target: { module: String(profile.fieldOverlay), address, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex })),
    metadata: { PMCGameID: version, PMCVersion: "0.1.0", PMCModulePriority: 4 } };
  return writeRpm(rpm, { ident: "DLXF" });
}
export function validateMapTestNativeCode(project: ProjectState, source: Uint8Array) {
  const profile = mapTestProfile(project), rom = new NintendoDSRom(source, { fileData: "view" });
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable, (_, id) => getRomFileBytes(project, rom, id), new Set([profile.fieldOverlay,profile.scriptOverlay]));
  const field = overlays.get(profile.fieldOverlay), table = overlays.get(profile.scriptOverlay);
  if (!field || !table || readU32(project.overlays[profile.scriptOverlay] ?? table.data, profile.scriptTable + 0xc2 * 4) !== profile.warpHandler) throw new Error("This ROM has an unsupported native map-warp handler.");
  for (const signature of profile.signatures) {
    const at = signature.address - field.ramAddress;
    if (at < 0 || hex((project.overlays[profile.fieldOverlay] ?? field.data).subarray(at, at + signature.hex.length / 2)) !== signature.hex) throw new Error("Native field code differs from the checked map-test bindings.");
  }
  return profile;
}
export async function installMapTestWalkRuntime(project: ProjectState, source: Uint8Array) {
  const profile = validateMapTestNativeCode(project, source), rom = new NintendoDSRom(source, { fileData: "view" });
  let fileName = `MapTestWalkThroughWalls${profile.version}.dll`;
  for (const entry of listCodeInjectionDlls(project)) {
    const added = Object.entries(project.fileSystem?.additions ?? {}).find(([p]) => p.toLowerCase() === entry.path.toLowerCase())?.[1], id = rom.filenames.idOf(entry.path);
    const bytes = added ?? (id !== undefined ? getRomFileBytes(project, rom, id) : undefined); if (!bytes) continue;
    let rpm: RpmModule; try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    if (!rpm.relocations.some(r => r.target.module === String(profile.fieldOverlay) && [profile.collisionReturn,profile.railCollisionReturn].some(site => r.target.address < site + 4 && r.target.address + 4 > site))) continue;
    if (entry.target !== "patches" || ![hex(code),walkRuntime.codeHex].includes(hex(rpm.code))) throw new Error(`Map testing conflicts with ${entry.fileName}'s collision hooks.`);
    fileName = entry.fileName;
  }
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  return stageCodeInjectionDll(project,fileName,createMapTestWalkRuntime(profile.version),"patches",source);
}
