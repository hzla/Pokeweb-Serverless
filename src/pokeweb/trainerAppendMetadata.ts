import { readU32, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { ensureFileSystemState } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";

export const ADDED_TRAINERS_PATH = "ui/trainers/added.bin";
const MAGIC = 0x52545750; // PWTR
const sources = new WeakMap<ProjectState, { baseCount?: number; fileId?: number; bytes?: Uint8Array }>();

export function hydrateAddedTrainerSource(project: ProjectState, rom: NintendoDSRom): void {
  const fileId = rom.filenames.idOf(ADDED_TRAINERS_PATH);
  const trdata = project.narcs.trdata;
  const trpok = project.narcs.trpok;
  let baseCount: number | undefined;
  if (trdata && trpok && rom.files[trdata.fileId] && rom.files[trpok.fileId]) {
    const count = new NARC(rom.files[trdata.fileId]).files.length;
    if (new NARC(rom.files[trpok.fileId]).files.length === count) baseCount = count;
  }
  sources.set(project, { baseCount, fileId, bytes: fileId === undefined ? undefined : rom.files[fileId]?.slice() });
}

/** Returns the beginning of the verified appended range, including for older active projects. */
export function firstAddedTrainerId(project: ProjectState): number | undefined {
  const source = sources.get(project);
  const trdata = project.narcs.trdata;
  const trpok = project.narcs.trpok;
  if (!trdata || !trpok || trdata.fileCount !== trpok.fileCount) return undefined;
  const end = trdata.fileCount;
  const bytes = project.fileSystem?.additions?.[ADDED_TRAINERS_PATH]
    ?? (source?.fileId === undefined ? undefined : project.fileSystem?.replacements?.[source.fileId] ?? source.bytes);
  if (bytes) {
    const first = readU32(bytes, 8);
    return bytes.length === 16 && readU32(bytes, 0) === MAGIC && readU32(bytes, 4) === 1
      && first > 0 && first <= end && readU32(bytes, 12) === end ? first : undefined;
  }
  const first = source?.baseCount;
  if (first === undefined || first < 1 || first >= end) return undefined;
  // Legacy saved projects keep newly appended archive entries as paired dirty records.
  for (let id = first; id < end; id += 1) {
    if (!trdata.dirty.has(id) || !trpok.dirty.has(id)) return undefined;
  }
  return first;
}

export function stageAddedTrainerRange(project: ProjectState, first: number, end: number): void {
  const bytes = new Uint8Array(16);
  writeU32(bytes, 0, MAGIC);
  writeU32(bytes, 4, 1);
  writeU32(bytes, 8, first);
  writeU32(bytes, 12, end);
  const files = ensureFileSystemState(project);
  const fileId = sources.get(project)?.fileId;
  if (fileId === undefined) files.additions![ADDED_TRAINERS_PATH] = bytes;
  else {
    delete files.additions![ADDED_TRAINERS_PATH];
    delete files.tombstones?.[fileId];
    files.replacements[fileId] = bytes;
  }
}
