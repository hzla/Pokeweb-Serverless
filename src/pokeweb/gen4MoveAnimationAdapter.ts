import type { SpaArchive } from "./nitroSpa";
import type { MoveAnimationPreview } from "./moveAnimationPreviewModel";
import { NintendoDSRom } from "../nds/rom";
import {
  appendHgMoveSpaFiles,
  compileHgMoveAnimationScript,
  decompileHgMoveAnimation,
  decompileHgMoveAnimationReadable,
  exportHgMoveAnimationArchive,
  exportHgMoveAnimationRom,
  exportHgMoveSpaFile,
  getHgMoveAnimationCommandDefinitions,
  getHgMoveAnimationReadableCommandAliases,
  loadHgMoveAnimationRom,
  loadHgMoveSpaArchive,
  updateHgMoveAnimationFile,
  updateHgMoveSpaArchive,
  type HgMoveAnimationArchiveKind,
  type HgMoveAnimationRom,
  type HgMoveAnimationScriptArchiveKind,
} from "./hgMoveAnimationModel";
import { buildHgMoveAnimationPreview, type HgMoveAnimationPreviewScenario } from "./hgMoveAnimationPreviewModel";
import {
  appendPlatinumMoveSpaFiles,
  compilePlatinumMoveAnimationScript,
  decompilePlatinumMoveAnimation,
  decompilePlatinumMoveAnimationReadable,
  exportPlatinumMoveAnimationArchive,
  exportPlatinumMoveAnimationRom,
  exportPlatinumMoveSpaFile,
  getPlatinumMoveAnimationCommandDefinitions,
  loadPlatinumMoveAnimationRom,
  loadPlatinumMoveSpaArchive,
  updatePlatinumMoveAnimationFile,
  updatePlatinumMoveSpaArchive,
  type PlatinumMoveAnimationArchiveKind,
  type PlatinumMoveAnimationRom,
  type PlatinumMoveAnimationScriptArchiveKind,
} from "./platinumMoveAnimationModel";
import { buildPlatinumMoveAnimationPreview } from "./platinumMoveAnimationPreviewModel";

export type Gen4MoveAnimationGameId = "hg" | "platinum";
export type Gen4MoveAnimationArchiveKind = "move" | "sub" | "spa";
export type Gen4MoveAnimationScriptArchiveKind = "move" | "sub";
export type Gen4MoveAnimationProject = HgMoveAnimationRom | PlatinumMoveAnimationRom;
export type Gen4MoveAnimationCommandDefinition = ReturnType<typeof getHgMoveAnimationCommandDefinitions>[number];

export type Gen4MoveAnimationAdapter = {
  id: Gen4MoveAnimationGameId;
  title: string;
  uploadDescription: string;
  scriptEngineLabel: string;
  scriptEngineUnavailableComment: string;
  supportsPreview: boolean;
  supportsTestBattle: boolean;
  archiveKinds: Gen4MoveAnimationArchiveKind[];
  commandDefinitions: Gen4MoveAnimationCommandDefinition[];
  readableCommandAliases: Array<{ alias: string; command: string }>;
  archiveLabel: (kind: Gen4MoveAnimationArchiveKind) => string;
  archiveTitle: (kind: Gen4MoveAnimationArchiveKind) => string;
  particleArchivePath: string;
  loadRom: (bytes: Uint8Array) => Gen4MoveAnimationProject;
  decompileScript: (project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationScriptArchiveKind, fileId: number) => string;
  decompileEngineScript: (bytes: Uint8Array, kind: Gen4MoveAnimationScriptArchiveKind, fileId: number) => string;
  compileScript: (scriptText: string, kind: Gen4MoveAnimationScriptArchiveKind, fileId: number) => Uint8Array;
  updateScript: (project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationScriptArchiveKind, fileId: number, scriptText: string) => Uint8Array;
  exportArchive: (project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationArchiveKind) => Uint8Array;
  exportRom: (project: Gen4MoveAnimationProject) => Uint8Array;
  loadSpaArchive: (project: Gen4MoveAnimationProject, spaId: number) => SpaArchive;
  updateSpaArchive: (project: Gen4MoveAnimationProject, spaId: number, spaArchive: SpaArchive) => Uint8Array;
  exportSpaFile: (project: Gen4MoveAnimationProject, spaId: number, archiveOverride?: SpaArchive) => Uint8Array;
  appendSpaFiles: (project: Gen4MoveAnimationProject, files: Uint8Array[]) => number[];
  buildPreview: (project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationScriptArchiveKind, fileId: number, scriptText: string, scenario: HgMoveAnimationPreviewScenario) => Promise<MoveAnimationPreview>;
  moveName: (project: Gen4MoveAnimationProject, fileId: number) => string;
  loadStatus: (project: Gen4MoveAnimationProject, verb: "Loaded" | "Restored") => string;
};

const HG_PATHS = ["a/0/1/0", "a/0/6/1", "a/0/2/9"];
const PLATINUM_PATHS = ["wazaeffect/we.arc", "wazaeffect/effectdata/waza_particle.narc"];

export const HG_MOVE_ANIMATION_ADAPTER: Gen4MoveAnimationAdapter = {
  id: "hg",
  title: "HG Move Animation Editor",
  uploadDescription: "Load a HeartGold or HG-engine ROM to inspect and edit /a/0/1/0 move animations, /a/0/6/1 sub-animations, and /a/0/2/9 SPA particles.",
  scriptEngineLabel: "HG-engine",
  scriptEngineUnavailableComment: "HG-engine view cannot be generated until the readable script compiles.",
  supportsPreview: true,
  supportsTestBattle: true,
  archiveKinds: ["move", "sub", "spa"],
  commandDefinitions: getHgMoveAnimationCommandDefinitions(),
  readableCommandAliases: getHgMoveAnimationReadableCommandAliases(),
  archiveLabel: (kind) => ({ move: "a010", sub: "a061", spa: "a029" })[kind],
  archiveTitle: (kind) => ({ move: "Move", sub: "Sub", spa: "SPA" })[kind],
  particleArchivePath: "/a/0/2/9",
  loadRom: (bytes) => loadHgMoveAnimationRom(bytes),
  decompileScript: (project, kind, fileId) => decompileHgMoveAnimationReadable(archiveBytes(project, kind, fileId), { archiveKind: kind as HgMoveAnimationScriptArchiveKind, fileId }),
  decompileEngineScript: (bytes, kind, fileId) => decompileHgMoveAnimation(bytes, { archiveKind: kind as HgMoveAnimationScriptArchiveKind, fileId }),
  compileScript: (scriptText, kind, fileId) => compileHgMoveAnimationScript(scriptText, { archiveKind: kind as HgMoveAnimationScriptArchiveKind, fileId }),
  updateScript: (project, kind, fileId, scriptText) => updateHgMoveAnimationFile(project as HgMoveAnimationRom, kind as HgMoveAnimationScriptArchiveKind, fileId, scriptText),
  exportArchive: (project, kind) => exportHgMoveAnimationArchive(project as HgMoveAnimationRom, kind as HgMoveAnimationArchiveKind),
  exportRom: (project) => exportHgMoveAnimationRom(project as HgMoveAnimationRom),
  loadSpaArchive: (project, spaId) => loadHgMoveSpaArchive(project as HgMoveAnimationRom, spaId),
  updateSpaArchive: (project, spaId, spaArchive) => updateHgMoveSpaArchive(project as HgMoveAnimationRom, spaId, spaArchive),
  exportSpaFile: (project, spaId, archiveOverride) => exportHgMoveSpaFile(project as HgMoveAnimationRom, spaId, archiveOverride),
  appendSpaFiles: (project, files) => appendHgMoveSpaFiles(project as HgMoveAnimationRom, files),
  buildPreview: (project, kind, fileId, scriptText, scenario) => buildHgMoveAnimationPreview(project as HgMoveAnimationRom, kind as HgMoveAnimationScriptArchiveKind, fileId, scriptText, scenario),
  moveName: (project, fileId) => (project as HgMoveAnimationRom).moveNames[fileId] ?? "",
  loadStatus: (project, verb) => {
    const hgProject = project as HgMoveAnimationRom;
    return `${verb} ${hgProject.archives.move.narc.files.length} move animations, ${hgProject.archives.sub.narc.files.length} sub-animations, and ${hgProject.archives.spa.narc.files.length} SPA files.`;
  },
};

export const PLATINUM_MOVE_ANIMATION_ADAPTER: Gen4MoveAnimationAdapter = {
  id: "platinum",
  title: "Platinum Move Animation Editor",
  uploadDescription: "Load a Pokemon Platinum ROM to inspect and edit /wazaeffect/we.arc move animations and /wazaeffect/effectdata/waza_particle.narc SPA particles.",
  scriptEngineLabel: "Platinum",
  scriptEngineUnavailableComment: "Platinum script view cannot be generated until the script compiles.",
  supportsPreview: true,
  supportsTestBattle: false,
  archiveKinds: ["move", "spa"],
  commandDefinitions: getPlatinumMoveAnimationCommandDefinitions(),
  readableCommandAliases: [],
  archiveLabel: (kind) => ({ move: "we", sub: "sub", spa: "waza_particle" })[kind],
  archiveTitle: (kind) => ({ move: "Move", sub: "Sub", spa: "SPA" })[kind],
  particleArchivePath: "/wazaeffect/effectdata/waza_particle.narc",
  loadRom: (bytes) => loadPlatinumMoveAnimationRom(bytes),
  decompileScript: (project, kind, fileId) => decompilePlatinumMoveAnimationReadable(archiveBytes(project, kind, fileId), { archiveKind: kind as PlatinumMoveAnimationScriptArchiveKind, fileId }),
  decompileEngineScript: (bytes, kind, fileId) => decompilePlatinumMoveAnimation(bytes, { archiveKind: kind as PlatinumMoveAnimationScriptArchiveKind, fileId }),
  compileScript: (scriptText, kind, fileId) => compilePlatinumMoveAnimationScript(scriptText, { archiveKind: kind as PlatinumMoveAnimationScriptArchiveKind, fileId }),
  updateScript: (project, kind, fileId, scriptText) => updatePlatinumMoveAnimationFile(project as PlatinumMoveAnimationRom, kind as PlatinumMoveAnimationScriptArchiveKind, fileId, scriptText),
  exportArchive: (project, kind) => exportPlatinumMoveAnimationArchive(project as PlatinumMoveAnimationRom, kind as PlatinumMoveAnimationArchiveKind),
  exportRom: (project) => exportPlatinumMoveAnimationRom(project as PlatinumMoveAnimationRom),
  loadSpaArchive: (project, spaId) => loadPlatinumMoveSpaArchive(project as PlatinumMoveAnimationRom, spaId),
  updateSpaArchive: (project, spaId, spaArchive) => updatePlatinumMoveSpaArchive(project as PlatinumMoveAnimationRom, spaId, spaArchive),
  exportSpaFile: (project, spaId, archiveOverride) => exportPlatinumMoveSpaFile(project as PlatinumMoveAnimationRom, spaId, archiveOverride),
  appendSpaFiles: (project, files) => appendPlatinumMoveSpaFiles(project as PlatinumMoveAnimationRom, files),
  buildPreview: (project, _kind, fileId, scriptText, scenario) => buildPlatinumMoveAnimationPreview(project as PlatinumMoveAnimationRom, fileId, scriptText, scenario),
  moveName: (project, fileId) => (project as PlatinumMoveAnimationRom).moveNames[fileId] ?? "",
  loadStatus: (project, verb) => {
    const platinumProject = project as PlatinumMoveAnimationRom;
    return `${verb} ${platinumProject.archives.move.narc.files.length} Platinum move animations and ${platinumProject.archives.spa.narc.files.length} SPA files.`;
  },
};

export function detectGen4MoveAnimationAdapter(romBytes: Uint8Array): Gen4MoveAnimationAdapter {
  const rom = new NintendoDSRom(romBytes);
  if (PLATINUM_PATHS.every((path) => rom.filenames.idOf(path) !== undefined)) return PLATINUM_MOVE_ANIMATION_ADAPTER;
  if (HG_PATHS.every((path) => rom.filenames.idOf(path) !== undefined)) return HG_MOVE_ANIMATION_ADAPTER;
  throw new Error("Unsupported ROM: expected HeartGold/HG-engine move animation archives or Pokemon Platinum wazaeffect archives.");
}

export function loadGen4MoveAnimationProject(romBytes: Uint8Array): { adapter: Gen4MoveAnimationAdapter; project: Gen4MoveAnimationProject } {
  const adapter = detectGen4MoveAnimationAdapter(romBytes);
  return { adapter, project: adapter.loadRom(romBytes) };
}

export function hasArchiveKind(adapter: Gen4MoveAnimationAdapter, kind: Gen4MoveAnimationArchiveKind): boolean {
  return adapter.archiveKinds.includes(kind);
}

export function archiveBytes(project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationScriptArchiveKind, fileId: number): Uint8Array {
  const archive = archiveForKind(project, kind);
  const bytes = archive.narc.files[fileId];
  if (!bytes) throw new Error(`Animation file ${fileId} is empty or missing.`);
  return bytes;
}

export function archiveForKind(project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationArchiveKind) {
  const archives = project.archives as Partial<Record<Gen4MoveAnimationArchiveKind, { narc: { files: Uint8Array[] }; dirty: Set<number>; path: string }>>;
  const archive = archives[kind];
  if (!archive) throw new Error(`Archive ${kind} is not available for this game.`);
  return archive;
}
