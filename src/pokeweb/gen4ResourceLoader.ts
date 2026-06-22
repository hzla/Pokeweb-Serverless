import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { gen4NarcDefinitions, isGen4BaseRom, type Gen4Version, type NarcName } from "./constants";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, type ProjectState } from "./projectStore";

export async function ensureGen4NarcStores(project: ProjectState, names: NarcName[]): Promise<void> {
  if (!isGen4BaseRom(project.session.baseRom)) return;
  const definitions = gen4NarcDefinitions({
    generation: "gen4",
    baseVersion: project.session.baseVersion as Gen4Version,
    baseRom: project.session.baseRom,
  });
  const loadableNames = names.filter((name) => definitions.some((candidate) => candidate.name === name && candidate.container !== "file"));
  const missing = loadableNames.filter((name) => !project.narcs[name]);
  if (missing.length === 0) return;

  const bytes = await loadActiveRomBytes();
  if (!bytes) throw new Error(`Reload the ROM before opening ${missing.join(", ")}`);
  const rom = new NintendoDSRom(bytes);

  for (const name of missing) {
    const definition = definitions.find((candidate) => candidate.name === name);
    if (!definition || definition.container === "file") continue;
    const fileId = rom.fileId(definition.path);
    project.session.fileIds[name] = fileId;
    project.session.blacklist = project.session.blacklist.filter((entry) => entry !== name);
    project.narcs[name] = createNarcStore(name, definition.path, fileId, new NARC(rom.files[fileId]));
  }
}
