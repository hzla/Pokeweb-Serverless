import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { BW_NARCS, BW2_NARCS, HEADER_NARCS, type NarcName } from "./constants";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { adoptExistingPmcInstall, getPmcInstallStatus, installBundledPmc } from "./pmcModel";
import { createNarcStore, type ProjectState } from "./projectStore";

const installingProjects = new WeakSet<ProjectState>();

/** Load installer inputs without requiring a visit to another editor first. */
export function loadCodeInjectionNarcs(project: ProjectState, rom: NintendoDSRom, names: readonly NarcName[]): void {
  const definitions = [...(project.session.baseRom === "BW" ? BW_NARCS : BW2_NARCS), ...HEADER_NARCS];
  for (const name of names) {
    if (project.narcs[name]) continue;
    const path = definitions.find(definition => definition.name === name)?.path;
    const id = path === undefined ? undefined : rom.filenames.idOf(path);
    if (path === undefined || id === undefined) throw new Error(`Required ${name} archive is missing from this ROM.`);
    project.narcs[name] = createNarcStore(name, path, id, new NARC(getRomFileBytes(project, rom, id)));
  }
}

/** Serialize complete editor transactions with native patch installations. */
export async function withProjectMutationLock<T>(project: ProjectState, action: () => T | Promise<T>): Promise<T> {
  if (installingProjects.has(project)) throw new Error("Another patch is being installed. Wait for it to finish.");
  installingProjects.add(project);
  try { return await action(); }
  finally { installingProjects.delete(project); }
}

/** Stage a page installation and its dependencies together; publish only success. */
export async function installCodeInjectionPatch<T>(project: ProjectState, install: (staged: ProjectState) => T | Promise<T>): Promise<T> {
  return withProjectMutationLock(project, async () => {
    const keys = ["arm9", "overlays", "narcs", "texts", "fileSystem", "codeInjection", "patches", "actionChangelog",
      "koMoveLearnsetSource", "pwanAnimations", "trainerPwanAnimations", "overworldWeather", "cgearButtons", "customUi", "flyDestinations"] as const;
    // Keep the immutable source ROM shared: cloning it would copy hundreds of MiB.
    const staged: ProjectState = { ...project };
    for (const key of keys) Object.assign(staged, { [key]: structuredClone(project[key]) });
    staged.originalRomBytes ??= await loadActiveRomBytes();
    if (!staged.originalRomBytes) throw new Error("Reload the ROM before installing code injection patches.");
    if (!getPmcInstallStatus(staged).installed) {
      adoptExistingPmcInstall(staged, staged.originalRomBytes);
      if (!getPmcInstallStatus(staged).installed) await installBundledPmc(staged);
    }
    const result = await install(staged);
    for (const key of keys) Object.assign(project, { [key]: staged[key] });
    project.arm9Dirty = staged.arm9Dirty;
    project.originalRomBytes = staged.originalRomBytes;
    return result;
  });
}
