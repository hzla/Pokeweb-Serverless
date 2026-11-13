import manifestJson from "../assets/codeinjection/speciesExpansionManifest.json";
import type { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "./projectStore";

/**
 * Species expansion numbering (speciesExpansionModel), kept apart from its content and installer so the loader and
 * the sprite, PWAN and Pokémon models can use it. The added species are numbered national + 37 (Chespin 687 ... Pecharunt 1062): retail's 650-686
 * are the Egg, the Bad Egg and the Pokéstar Studios actors.
 */
export const FIRST_ADDED_SPECIES = 687;
export const NATIONAL_OFFSET = 37;

type Config = NonNullable<NonNullable<ProjectState["codeInjection"]>["speciesExpansion"]>;

export function speciesExpansionConfig(project: Pick<ProjectState, "codeInjection">): Config | undefined {
  return project.codeInjection?.speciesExpansion;
}

export function isAddedSpecies(project: Pick<ProjectState, "codeInjection">, species: number): boolean {
  const config = speciesExpansionConfig(project);
  return Boolean(config) && species >= FIRST_ADDED_SPECIES && species < FIRST_ADDED_SPECIES + config!.count;
}

/** The species of a national number (650 onwards: + 37). */
export function expansionSpeciesOf(national: number): number {
  return national >= 650 ? national + NATIONAL_OFFSET : national;
}

/** The national number of a species: an added species' is 37 less. */
export function nationalNumberOf(project: Pick<ProjectState, "codeInjection">, species: number): number {
  return isAddedSpecies(project, species) ? species - NATIONAL_OFFSET : species;
}

/** The sprite block of an added species (form 0). */
export function expansionSpriteOf(project: Pick<ProjectState, "codeInjection">, species: number): number | undefined {
  return isAddedSpecies(project, species) ? speciesExpansionConfig(project)!.sprites[species - FIRST_ADDED_SPECIES] : undefined;
}

/** The first personal record after the species and the regional Pokédex table: where added forms start. */
export function firstAppendedFormRecord(project: Pick<ProjectState, "codeInjection" | "session">): number {
  const config = speciesExpansionConfig(project);
  if (config) return config.regionalDexFile + 1;
  return project.session.baseRom === "BW" ? 669 : 710;
}

/**
 * A stored species number without the bits above it: trainer data written by White2Upgrade-era tools keeps species in
 * 10 bits (form above). The expansion's species reach 1062, so with it the species takes 11 bits.
 */
export function storedSpeciesId(project: Pick<ProjectState, "codeInjection">, value: number): number {
  return value % (speciesExpansionConfig(project) ? 2048 : 1024);
}

/** The personal file of the regional Pokédex table. */
export function regionalDexFile(project: Pick<ProjectState, "codeInjection" | "session">): number {
  return firstAppendedFormRecord(project) - 1;
}

/** The core DLL's path, by game. */
export function speciesExpansionDllPath(version: string): string | undefined {
  const game = (manifestJson as unknown as { games: Record<string, { core: { fileName: string } }> }).games[version];
  return game ? `patches/${game.core.fileName}` : undefined;
}

/** Reads the configuration back from an installed core DLL's table ("PWSX"), so a reloaded ROM keeps its numbering. */
export function readSpeciesExpansionTable(bytes: Uint8Array): NonNullable<NonNullable<ProjectState["codeInjection"]>["speciesExpansion"]> | undefined {
  for (let at = 0; at + 12 <= bytes.length; at += 4) {
    if (bytes[at] !== 0x50 || bytes[at + 1] !== 0x57 || bytes[at + 2] !== 0x53 || bytes[at + 3] !== 0x58) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint16(at + 4, true), count = view.getUint16(at + 6, true), regionalDexFile = view.getUint16(at + 8, true);
    if (!count || at + 12 + count * 4 > bytes.length) return undefined;
    const sprites = [], cries = [], restricted = [], mythical = [];
    for (let i = 0; i < count; i++) {
      sprites.push(view.getUint16(at + 12 + i * 4, true));
      const cry = view.getUint16(at + 14 + i * 4, true);
      cries.push(cry & 0x3fff);
      if (cry & 0x8000) restricted.push(FIRST_ADDED_SPECIES + i);
      if (cry & 0x4000) mythical.push(FIRST_ADDED_SPECIES + i);
    }
    return { version, count, regionalDexFile, formShift: regionalDexFile - 709, sprites, cries, restricted, mythical };
  }
  return undefined;
}

/** At load: the configuration of an installed expansion, from its DLL in the ROM. */
export function hydrateSpeciesExpansion(project: ProjectState, rom: NintendoDSRom): void {
  if (project.codeInjection?.speciesExpansion) return;
  const path = speciesExpansionDllPath(project.session.baseVersion);
  const id = path === undefined ? undefined : rom.filenames.idOf(path);
  if (id === undefined) return;
  const config = readSpeciesExpansionTable(rom.files[id]!);
  if (!config) return;
  project.codeInjection ??= {};
  project.codeInjection.speciesExpansion = config;
}
