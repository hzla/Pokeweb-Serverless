import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { decompressCode } from "../nds/codeCompression";
import { readU32 } from "../nds/binary";
import { decodeGen5TextBank } from "./text";
import { addRomFile, getRomFileBytes } from "./fileSystemModel";
import { materializeProjectEdits } from "./projectMaterialize";
import {
  ARCHIVE,
  compile,
  recover,
  type Assets,
} from "../systemShops/compiler";
import { defaults, type Project } from "../systemShops/document";
import type { ProjectState } from "./projectStore";

export const ensureSystemShops = (project: ProjectState): Project =>
  (project.systemShops ??= { document: defaults() });
export function systemShopAssets(
  project: ProjectState,
  rom: NintendoDSRom,
): Assets {
  const archive = (path: string) =>
    new NARC(getRomFileBytes(project, rom, rom.fileId(path)));
  const names = new Map<number, string>();
  for (const [id, name] of decodeGen5TextBank(archive("a/0/0/2").files[64]))
    names.set(Number(id.split("_")[1]), name);
  for (const [i, name] of (project.texts.banks.items ?? []).entries())
    names.set(i, name);
  let items = archive("a/0/2/4").files;
  if (project.narcs.items) {
    const copy = {
      ...project,
      narcs: { items: structuredClone(project.narcs.items) },
    };
    materializeProjectEdits(copy);
    items = copy.narcs.items!.rawFiles;
  }
  const arm = decompressCode(project.arm9.length ? project.arm9 : rom.arm9),
    pointer = readU32(arm, 0x20088f8 - rom.arm9RamAddress) - rom.arm9RamAddress;
  if (pointer < 0 || pointer + 639 > arm.length)
    throw new Error("Unrecognized native bag pocket table.");
  const pockets = arm.slice(pointer, pointer + Math.min(items.length, 639));
  if (pockets.some((p) => p > 4))
    throw new Error("Unrecognized native bag pocket assignments.");
  const iconPointer =
    readU32(
      arm,
      0x202672c -
        (project.session.baseVersion === "B2" ? 44 : 0) -
        rom.arm9RamAddress,
    ) - rom.arm9RamAddress;
  if (iconPointer < 0 || iconPointer + 639 * 4 > arm.length)
    throw new Error("Unrecognized native item icon table.");
  return {
    names,
    items,
    pockets,
    icons: archive("a/0/2/5"),
    iconMapping: arm.slice(iconPointer, iconPointer + 639 * 4),
    messages: decodeGen5TextBank(archive("a/0/0/3").files[0x265]),
  };
}
function archiveBytes(
  project: ProjectState,
  rom: NintendoDSRom,
): Uint8Array | undefined {
  const id = rom.filenames.idOf(ARCHIVE);
  return (
    project.fileSystem?.additions?.[ARCHIVE] ??
    (id === undefined ? undefined : getRomFileBytes(project, rom, id))
  );
}
export function hydrateSystemShops(
  project: ProjectState,
  rom: NintendoDSRom,
): void {
  if (project.session.baseRom !== "BW2") return;
  const bytes = archiveBytes(project, rom);
  if (bytes) {
    const recovered = recover(bytes);
    project.systemShops ??= recovered;
  }
}
export function stageSystemShops(
  project: ProjectState,
  rom: NintendoDSRom,
  state: Project,
): void {
  const bytes = compile(state, systemShopAssets(project, rom)),
    id = rom.filenames.idOf(ARCHIVE);
  if (project.fileSystem?.additions?.[ARCHIVE])
    project.fileSystem.additions[ARCHIVE] = bytes;
  else if (id !== undefined) {
    project.fileSystem ??= { replacements: {} };
    project.fileSystem.replacements[id] = bytes;
  } else addRomFile(project, ARCHIVE, bytes);
}
export function materializeSystemShopSource(
  project: ProjectState,
  rom: NintendoDSRom,
): void {
  const state = project.systemShops;
  if (!state) return;
  const bytes = archiveBytes(project, rom);
  if (bytes) {
    recover(bytes);
    const arc = new NARC(bytes);
    arc.files[1] = new TextEncoder().encode(JSON.stringify(state));
    const id = rom.filenames.idOf(ARCHIVE);
    if (project.fileSystem?.additions?.[ARCHIVE])
      project.fileSystem.additions[ARCHIVE] = arc.save();
    else if (id !== undefined) {
      project.fileSystem ??= { replacements: {} };
      project.fileSystem.replacements[id] = arc.save();
    }
  } else stageSystemShops(project, rom, state);
}
