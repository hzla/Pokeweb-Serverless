import { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "./projectStore";
import { PWAN_ARCHIVE_PATH } from "./pwanAnimationModel";
import { isW2AnimProject } from "./w2animAnimationModel";

const sourceHasPwan = new WeakMap<Uint8Array, boolean>();

/** Asset inventory, not the in-memory PWAN canvas used to edit w2anim streams. */
export function detectAnimationAssets(project: ProjectState): {
  pwan: boolean;
  w2anim: boolean;
  active: "native" | "pwan" | "w2anim";
} {
  const bytes = project.originalRomBytes;
  let pwan = Boolean(project.pwanAnimations?.detectedArchive || project.trainerPwanAnimations?.detectedArchive ||
    project.fileSystem?.additions?.[PWAN_ARCHIVE_PATH]?.length);
  if (bytes) {
    let present = sourceHasPwan.get(bytes);
    if (present === undefined) {
      present = new NintendoDSRom(bytes, { fileData: "view" }).filenames.idOf(PWAN_ARCHIVE_PATH) !== undefined;
      sourceHasPwan.set(bytes, present);
    }
    pwan ||= present;
  }
  const w2anim = isW2AnimProject(project);
  // A retained PWAN archive does not mean its hooks are active in a w2anim ROM.
  return { pwan, w2anim, active: w2anim ? "w2anim" : pwan ? "pwan" : "native" };
}
