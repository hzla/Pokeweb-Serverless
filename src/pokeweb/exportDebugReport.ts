import { readU32 } from "../nds/binary";
import type { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { planRomAdditions } from "./exportRom";
import { fileSystemAddedFiles } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";

export type ExportFailureContext = { message: string; stage: string; frostCompatibility: boolean };

/** Structural diagnostics only. Never serialize the project or ROM buffers. */
export function createExportDebugReport(project: ProjectState, failure: ExportFailureContext, sourceBytes?: Uint8Array) {
  const additions = fileSystemAddedFiles(project);
  const report = {
    format: "pokeweb-export-report", version: 1,
    build: typeof __POKEWEB_BUILD_ID__ === "string" ? __POKEWEB_BUILD_ID__ : "unknown",
    createdAt: new Date().toISOString(),
    failure,
    game: { baseRom: project.session.baseRom, baseVersion: project.session.baseVersion, idCode: project.romInfo.idCode },
    edits: {
      additions: additions.map(({ path, bytes }) => ({ path, size: bytes.length })),
      replacements: Object.entries(project.fileSystem?.replacements ?? {}).map(([id, bytes]) => ({ fileId: Number(id), size: bytes.length })),
      tombstones: project.fileSystem?.tombstones ?? {},
      arm9: { size: project.arm9.length, dirty: !!project.arm9Dirty, compressed: project.arm9Compressed },
      overlays: Object.entries(project.overlays).map(([id, bytes]) => ({ overlayId: Number(id), size: bytes?.length })),
      archives: Object.entries(project.narcs).flatMap(([name, store]) => store ? [{
        name, fileId: store.fileId, fileCount: store.fileCount, dirty: [...store.dirty],
      }] : []),
      pmc: project.codeInjection?.pmc ? { overlayId: project.codeInjection.pmc.overlayId, overlayPath: project.codeInjection.pmc.overlayPath } : undefined,
      modules: project.codeInjection?.modules?.map(({ path, target }) => ({ path, target })),
    },
  };
  if (!sourceBytes) return { ...report, source: { available: false } };
  try {
    const rom = new NintendoDSRom(sourceBytes, { fileData: "view" });
    const folders: Array<{ path: string; firstId: number; files: string[] }> = [];
    const walk = (folder: Folder, path: string): void => {
      folders.push({ path, firstId: folder.firstId, files: [...folder.files] });
      for (const [name, child] of folder.folders) walk(child, path ? `${path}/${name}` : name);
    };
    walk(rom.filenames, "");
    const fatOffset = readU32(sourceBytes, 0x48);
    const source = {
      available: true, size: sourceBytes.length, idCode: rom.idCode, revision: sourceBytes[0x1e], folders,
      files: rom.files.map((bytes, id) => ({ id, size: bytes.length, start: readU32(sourceBytes, fatOffset + id * 8), end: readU32(sourceBytes, fatOffset + id * 8 + 4) })),
      arm9Overlays: Array.from({ length: Math.floor(rom.arm9OverlayTable.length / 32) }, (_, row) => ({
        overlayId: readU32(rom.arm9OverlayTable, row * 32), fileId: readU32(rom.arm9OverlayTable, row * 32 + 24),
      })),
    };
    try {
      const plan = planRomAdditions(rom, additions.filter(file => rom.filenames.idOf(file.path) === undefined));
      return { ...report, source, plan: {
        insertions: plan.insertedFiles.map(({ path, fileId, bytes }) => ({ path, fileId, size: bytes.length })),
        appends: plan.addedFiles.map(({ path, bytes }) => ({ path, fileId: plan.pathFileIds.get(path), size: bytes.length })),
      } };
    } catch (error) { return { ...report, source, plan: { error: message(error) } }; }
  } catch (error) { return { ...report, source: { available: false, error: message(error) } }; }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
