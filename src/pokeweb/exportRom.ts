import { readU32, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { NarcName } from "./constants";
import { loadActiveRomBytes } from "./persistence";
import { materializeProjectEdits } from "./projectMaterialize";
import type { ProjectState } from "./projectStore";

export { materializeProjectEdits } from "./projectMaterialize";

export async function exportModifiedRom(project: ProjectState): Promise<Uint8Array> {
  const originalRomBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!originalRomBytes) throw new Error("This saved project does not include the original ROM bytes. Please load the ROM again before exporting.");

  materializeProjectEdits(project);

  const rom = new NintendoDSRom(originalRomBytes);
  const fileReplacements = new Map<number, Uint8Array>();

  for (const store of Object.values(project.narcs)) {
    if (!store || store.fileId < 0 || store.dirty.size === 0) continue;
    const source = new NARC(rom.files[store.fileId]);
    source.files = store.rawFiles;
    fileReplacements.set(store.fileId, source.save());
  }

  const arm9OverlayTable = patchOverlayFiles(project, rom, fileReplacements);
  const out = rom.save({
    arm9: project.tms?.dirty ? project.arm9 : undefined,
    arm9OverlayTable,
    files: fileReplacements,
  });
  return out;
}

function patchOverlayFiles(project: ProjectState, rom: NintendoDSRom, fileReplacements: Map<number, Uint8Array>): Uint8Array | undefined {
  const overlayReplacements = new Map<number, Uint8Array>();
  patchOverlayBackedStore(project, "grotto_odds", 36, overlayReplacements);
  patchOverlayBackedStore(project, "move_effects_table", 167, overlayReplacements);
  if (overlayReplacements.size === 0) return undefined;

  const table = rom.arm9OverlayTable.slice();
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    const overlayId = readU32(table, offset);
    const data = overlayReplacements.get(overlayId);
    if (!data) continue;
    const fileId = readU32(table, offset + 24);
    const compressedSizeFlags = readU32(table, offset + 28);
    const flags = compressedSizeFlags >>> 24;
    fileReplacements.set(fileId, data);
    writeU32(table, offset + 8, data.length);
    writeU32(table, offset + 28, (flags & ~1) << 24);
  }
  return table;
}

function patchOverlayBackedStore(project: ProjectState, name: NarcName, overlayId: number, overlayReplacements: Map<number, Uint8Array>): void {
  const store = project.narcs[name];
  const overlay = project.overlays[overlayId];
  if (!store || !overlay || store.dirty.size === 0) return;
  const match = /^overlay\d+:(.+)$/u.exec(store.sourcePath);
  if (!match) return;
  const offset = overlayTableOffset(project, name);
  if (offset === undefined) return;
  const out = overlay.slice();
  out.set(store.rawFiles[0] ?? new Uint8Array(), offset);
  project.overlays[overlayId] = out;
  overlayReplacements.set(overlayId, out);
}

function overlayTableOffset(project: ProjectState, name: NarcName): number | undefined {
  if (name === "grotto_odds") return project.session.baseVersion === "B2" ? 0x00055218 : 0x00055218 - 12;
  if (name === "move_effects_table") return project.session.fairy ? 0x00040974 : 0x000407f4;
  return undefined;
}
