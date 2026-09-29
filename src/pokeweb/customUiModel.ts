import { migrateSummaryLayouts } from "../customUi/summaryCatalog";
import { ARCHIVE_PATH, archive, exportBundle, recoverArchive, updateArchiveSource } from "../customUi/bundle";
import { newProject } from "../customUi/document";
import { compile } from "../customUi/compiler";
import { compileLearnsetNative } from "../customUi/learnsetNative";
import { romAssets } from "../customUi/romAssets";
import { configureCustomUi, readCustomUiConfig } from "../customUi/runtimeConfig";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes, ensureFileSystemState } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";
import { loadActiveRomBytes } from "./persistence";
import { getLearnsetViewerStatus, installLearnsetViewer, learnsetViewerPaths } from "./learnsetViewerModel";
import { stageCodeInjectionDll } from "./pmcModel";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

export function ensureCustomUi(project: ProjectState) { const design = project.customUi ??= newProject(); migrateSummaryLayouts(design.document); return design; }
export function hydrateCustomUi(project: ProjectState, rom: NintendoDSRom): void {
  if (project.customUi) return;
  const id = rom.filenames.idOf(ARCHIVE_PATH), bytes = project.fileSystem?.additions?.[ARCHIVE_PATH] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
  if (bytes) project.customUi = recoverArchive(bytes);
}
/** Source designs survive ordinary ROM export even while launchers are disabled. */
export function materializeCustomUiSource(project: ProjectState, rom: NintendoDSRom): void {
  if (!project.customUi) return;
  const state = ensureFileSystemState(project), id = rom.filenames.idOf(ARCHIVE_PATH);
  // An active installation owns its last compiled resources. Apply replaces them atomically.
  const prior = state.additions?.[ARCHIVE_PATH] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
  const bytes = project.customUi.installation?.enabled && prior ? updateArchiveSource(prior, project.customUi) : archive(project.customUi);
  if (id === undefined) state.additions![ARCHIVE_PATH] = bytes; else state.replacements[id] = bytes;
}

function moduleBytes(project: ProjectState, rom: NintendoDSRom, path: string) {
  const id = rom.filenames.idOf(path); return project.fileSystem?.additions?.[path] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
}
function menuMessage(project: ProjectState): number {
  const entries = getTextBank(project, "message_texts", 178), found = entries.find(e => e[1] === "CUSTOM UI");
  if (found) return parseTextEntryId(found[0]).entry;
  if (!entries.length) throw new Error("Party menu message bank is unavailable.");
  const id = Math.max(...entries.map(e => parseTextEntryId(e[0]).entry)) + 1;
  if (id >= 65535) throw new Error("Party menu message bank is full.");
  addTextEntries(project, "message_texts", 178, 1);
  const entry = getTextBank(project, "message_texts", 178).find(e => parseTextEntryId(e[0]).entry === id)!;
  entry[1] = "CUSTOM UI"; commitTextBank(project, "message_texts", 178); return id;
}
export async function applyCustomUi(project: ProjectState): Promise<void> {
  if (!project.customUi) throw new Error("Create a design first.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes(); if (!bytes) throw new Error("Reload the original ROM before installing.");
  const status = getLearnsetViewerStatus(project, bytes); if (!status.compatible) throw new Error(status.message);
  const rom = new NintendoDSRom(bytes, { fileData: "view" }), assets = romAssets(project, rom, project.customUi);
  const compiled = compile(project.customUi.document, assets), native = compileLearnsetNative(project.customUi.document);
  if (!compiled.valid || !native.bytes) throw new Error([...compiled.diagnostics, ...native.diagnostics].filter(d => d.severity === "error").map(d => `${d.element ? d.element + ": " : ""}${d.message}`).join("\n"));
  const before = JSON.stringify(project.customUi.document), bundle = exportBundle(project.customUi);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bundle.slice().buffer))).map(b => b.toString(16).padStart(2, "0")).join("");
  // All text/PMC/module mutations occur on an isolated staging state.
  const draft: ProjectState = structuredClone({ ...project, originalRomBytes: undefined }); draft.originalRomBytes = bytes;
  const version = project.session.baseVersion as "W2" | "B2", paths = learnsetViewerPaths(version);
  const existing = moduleBytes(project, rom, paths[0]), config = existing && readCustomUiConfig(existing);
  const retainLearnset = config?.learnsetEnabled ?? status.installed;
  await installLearnsetViewer(draft);
  const menu = menuMessage(draft);
  for (const path of paths) {
    const data = moduleBytes(draft, rom, path); if (!data) throw new Error("Shared UI companion is missing after staging.");
    stageCodeInjectionDll(draft, path.split("/").pop()!, configureCustomUi(data, true, menu, retainLearnset), "patches", bytes);
  }
  draft.customUi!.installation = { version: 1, enabled: true, digest };
  const data = archive(draft.customUi!, compiled, native.bytes), id = rom.filenames.idOf(ARCHIVE_PATH), fs = ensureFileSystemState(draft);
  if (id === undefined) fs.additions![ARCHIVE_PATH] = data; else fs.replacements[id] = data;
  if (JSON.stringify(project.customUi.document) !== before) throw new Error("The design changed while installation was staging. Apply again to use the latest design.");
  Object.assign(project, draft);
}
export async function disableCustomUi(project: ProjectState): Promise<void> {
  if (!project.customUi?.installation?.enabled) return;
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes(); if (!bytes) throw new Error("Reload the ROM before disabling.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const draft: ProjectState = structuredClone({ ...project, originalRomBytes: undefined }); draft.originalRomBytes = bytes;
  for (const path of learnsetViewerPaths(project.session.baseVersion as "W2" | "B2")) {
    const data = moduleBytes(draft, rom, path), config = data && readCustomUiConfig(data);
    if (!data || !config?.validMenu) throw new Error("The shared UI runtime cannot be identified; the installation was left intact.");
    stageCodeInjectionDll(draft, path.split("/").pop()!, configureCustomUi(data, false, config.menu, config.learnsetEnabled), "patches", bytes);
  }
  draft.customUi!.installation!.enabled = false; materializeCustomUiSource(draft, rom); Object.assign(project, draft);
}
