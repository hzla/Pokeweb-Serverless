import { unzlibSync, zlibSync } from "fflate";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NintendoDSRom } from "../nds/rom";
import { ensureDocs } from "./docGeneratorModel";
import { ensureFileSystemState } from "./fileSystemModel";
import type { MastersheetHighlightMap, ProjectState } from "./projectStore";

/**
 * The mastersheet saved inside the ROM, so it survives exporting a ROM and importing it again.
 *
 * `zz_pokeweb/mastersheet.bin`:
 *   0x00  "PWMS"
 *   0x04  u16 version (1)
 *   0x06  u16 flags (bit 0: payload is zlib-compressed)
 *   0x08  u32 length of the uncompressed payload
 *   0x0c  payload: UTF-8 JSON { format, romTitle, markdown, highlights }
 *
 * Only the authored source is stored. Trainer and encounter data is always rebuilt from the ROM it travels with.
 */

export const MASTERSHEET_ROM_PATH = "zz_pokeweb/mastersheet.bin";
const MAGIC = 0x534d5750; // "PWMS"
const VERSION = 1;
const FLAG_ZLIB = 1;
const HEADER_SIZE = 12;
const JSON_FORMAT = "pokeweb.mastersheet";
/** Generous ceiling for a corrupted length field; the Cascade White source is about 53 KB uncompressed. */
const MAX_PAYLOAD = 16 * 1024 * 1024;

export type MastersheetRomData = {
  romTitle?: string;
  markdown: string;
  highlights?: MastersheetHighlightMap;
};

export function encodeMastersheetRomFile(data: MastersheetRomData): Uint8Array {
  const json = JSON.stringify({
    format: JSON_FORMAT,
    ...(data.romTitle ? { romTitle: data.romTitle } : {}),
    markdown: data.markdown,
    ...(data.highlights ? { highlights: data.highlights } : {}),
  });
  const payload = new TextEncoder().encode(json);
  const compressed = zlibSync(payload, { level: 9 });
  const out = new Uint8Array(HEADER_SIZE + compressed.length);
  writeU32(out, 0, MAGIC);
  writeU16(out, 4, VERSION);
  writeU16(out, 6, FLAG_ZLIB);
  writeU32(out, 8, payload.length);
  out.set(compressed, HEADER_SIZE);
  return out;
}

export function decodeMastersheetRomFile(bytes: Uint8Array): MastersheetRomData {
  if (bytes.length < HEADER_SIZE || readU32(bytes, 0) !== MAGIC) throw new Error("The ROM's mastersheet file isn't a Pokeweb mastersheet.");
  const version = readU16(bytes, 4);
  if (version !== VERSION) throw new Error(`The ROM's mastersheet was saved by a newer Pokeweb (format ${version}).`);
  const flags = readU16(bytes, 6);
  const length = readU32(bytes, 8);
  if (length > MAX_PAYLOAD) throw new Error("The ROM's mastersheet file is damaged.");
  let payload: Uint8Array;
  try {
    payload = flags & FLAG_ZLIB ? unzlibSync(bytes.subarray(HEADER_SIZE)) : bytes.subarray(HEADER_SIZE);
  } catch {
    throw new Error("The ROM's mastersheet file is damaged.");
  }
  if (payload.length !== length) throw new Error("The ROM's mastersheet file is damaged.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new Error("The ROM's mastersheet file is damaged.");
  }
  if (!isRecord(value) || value.format !== JSON_FORMAT || typeof value.markdown !== "string") {
    throw new Error("The ROM's mastersheet file is damaged.");
  }
  return {
    romTitle: typeof value.romTitle === "string" && value.romTitle ? value.romTitle : undefined,
    markdown: value.markdown,
    highlights: isRecord(value.highlights) ? value.highlights as MastersheetHighlightMap : undefined,
  };
}

/** True when the project has a mastersheet beyond the title line every project starts with. */
export function hasAuthoredMastersheet(project: ProjectState): boolean {
  const markdown = project.docs?.mastersheetMarkdown?.trim() ?? "";
  if (!markdown) return false;
  const title = project.docs?.romTitle || project.session.romName;
  return markdown !== `# ${title}`;
}

/** Whether export writes the mastersheet into the ROM: on by default once there is one to save. */
export function mastersheetSavesInRom(project: ProjectState): boolean {
  return project.docs?.mastersheetInRom ?? true;
}

export function setMastersheetSavesInRom(project: ProjectState, enabled: boolean): void {
  ensureDocs(project).mastersheetInRom = enabled;
}

/** The file export would write, or undefined when nothing is saved. */
export function mastersheetRomFileForProject(project: ProjectState): Uint8Array | undefined {
  if (!mastersheetSavesInRom(project) || !hasAuthoredMastersheet(project)) return undefined;
  const docs = ensureDocs(project);
  return encodeMastersheetRomFile({ romTitle: docs.romTitle, markdown: docs.mastersheetMarkdown ?? "", highlights: docs.mastersheetHighlights });
}

/**
 * Export step: writes, replaces or removes `zz_pokeweb/mastersheet.bin`. An exported ROM that was imported again
 * already has the file, so it is replaced by ID instead of added twice; switching the option off removes it.
 */
export function materializeMastersheetRomFile(project: ProjectState, rom: NintendoDSRom): void {
  const bytes = mastersheetRomFileForProject(project);
  const fileId = rom.filenames.idOf(MASTERSHEET_ROM_PATH);
  const fileSystem = ensureFileSystemState(project);
  if (fileId === undefined) {
    if (bytes) fileSystem.additions![MASTERSHEET_ROM_PATH] = bytes;
    else delete fileSystem.additions![MASTERSHEET_ROM_PATH];
    return;
  }
  delete fileSystem.additions![MASTERSHEET_ROM_PATH];
  if (bytes) {
    fileSystem.replacements[fileId] = bytes;
    if (fileSystem.tombstones?.[fileId]) delete fileSystem.tombstones[fileId];
  } else {
    fileSystem.replacements[fileId] = new Uint8Array();
    fileSystem.tombstones ??= {};
    fileSystem.tombstones[fileId] = MASTERSHEET_ROM_PATH;
  }
}

export type MastersheetRomLoad =
  | { kind: "none" }
  | { kind: "loaded" }
  | { kind: "same" }
  | { kind: "conflict"; data: MastersheetRomData }
  | { kind: "error"; message: string };

/**
 * Reads the ROM's saved mastersheet when a ROM is imported or a saved project reopens.
 * - A project without its own mastersheet takes the ROM's.
 * - A copy this project already reconciled with (same bytes as last time) is ignored, so a project that kept
 *   editing after it was imported isn't asked again.
 * - Otherwise the ROM's copy is kept aside for the editor to offer.
 */
export function hydrateMastersheetFromRom(project: ProjectState, rom: NintendoDSRom): MastersheetRomLoad {
  const fileId = rom.filenames.idOf(MASTERSHEET_ROM_PATH);
  if (fileId === undefined) return { kind: "none" };
  const bytes = rom.files[fileId];
  if (!bytes?.length) return { kind: "none" };
  const docs = ensureDocs(project);
  const hash = fileHash(bytes);
  if (docs.mastersheetRomSourceHash === hash) return { kind: "same" };
  let data: MastersheetRomData;
  try {
    data = decodeMastersheetRomFile(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    docs.mastersheetRomPending = undefined;
    docs.mastersheetRomError = message;
    return { kind: "error", message };
  }
  docs.mastersheetRomError = undefined;
  if (!hasAuthoredMastersheet(project)) {
    applyMastersheetRomData(project, data);
    docs.mastersheetRomSourceHash = hash;
    return { kind: "loaded" };
  }
  if (docs.mastersheetMarkdown === data.markdown) {
    docs.mastersheetRomSourceHash = hash;
    return { kind: "same" };
  }
  docs.mastersheetRomPending = { ...data, hash };
  return { kind: "conflict", data };
}

/** The editor's answer to a conflict: take the ROM's copy, or keep the project's and stop asking about this one. */
export function resolveMastersheetRomConflict(project: ProjectState, choice: "rom" | "project"): void {
  const docs = ensureDocs(project);
  const pending = docs.mastersheetRomPending;
  if (!pending) return;
  if (choice === "rom") applyMastersheetRomData(project, pending);
  docs.mastersheetRomSourceHash = pending.hash;
  docs.mastersheetRomPending = undefined;
}

function applyMastersheetRomData(project: ProjectState, data: MastersheetRomData): void {
  const docs = ensureDocs(project);
  if (data.romTitle) docs.romTitle = data.romTitle;
  docs.mastersheetMarkdown = data.markdown;
  if (data.highlights) docs.mastersheetHighlights = data.highlights;
  else delete docs.mastersheetHighlights;
  docs.mastersheetInRom = true;
}

/** FNV-1a over the file, as hex: enough to recognise a copy already seen. */
function fileHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${bytes.length.toString(16)}-${hash.toString(16).padStart(8, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
