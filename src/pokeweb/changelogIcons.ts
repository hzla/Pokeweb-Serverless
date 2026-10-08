import { NintendoDSRom } from "../nds/rom";
import { genderedPokemonIcons, getPokemonIconImage, getPokemonIconPaletteAssignment, resolvePokemonIconAddress } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";

export type ChangelogPokemonReference = { speciesId: number; form?: number; female?: boolean };
export type ChangelogIcon = { key: string; label: string; width: number; height: number; pixels: Uint8ClampedArray };

// Snapshot only referenced icons before the comparison releases its ROM buffers.
// Decoding preserves custom palettes and pixels from the chosen ROM.
export function createChangelogIconExtractor(project: ProjectState, side: "before" | "after") {
  const cache = new Map<string, ChangelogIcon | undefined>();
  const missing = new Set<string>();
  let iconProject: ProjectState | undefined;
  function source(): ProjectState {
    if (iconProject) return iconProject;
    const additions = { ...project.fileSystem?.additions };
    const path = "pokeicon_palette_map.bin";
    if (project.originalRomBytes && !Object.keys(additions).some((key) => key.toLowerCase() === path)) {
      const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
      const id = rom.filenames.idOf(path);
      const bytes = id === undefined ? undefined : project.fileSystem?.replacements?.[id] ?? rom.files[id];
      if (bytes) additions[path] = bytes;
    }
    // Avoid reparsing/copying the full ROM for every palette lookup.
    iconProject = { ...project, originalRomBytes: undefined, fileSystem: { ...project.fileSystem, replacements: project.fileSystem?.replacements ?? {}, additions } };
    return iconProject;
  }
  return {
    missing,
    extract(reference: ChangelogPokemonReference | undefined): ChangelogIcon | undefined {
      if (!reference || reference.speciesId <= 0) return undefined;
      const key = `${side}:${reference.speciesId}:${reference.form ?? 0}:${reference.female ? "female" : "male"}`;
      if (cache.has(key)) return cache.get(key);
      let icon: ChangelogIcon | undefined;
      try {
        const current = source();
        const address = resolvePokemonIconAddress(current, reference.speciesId, reference.form ?? 0);
        const variant = reference.female && genderedPokemonIcons(current, address.archiveSpriteId) ? "female" : "male";
        const fileIndex = (current.session.baseRom === "BW2" ? 8 : 7) + address.archiveSpriteId * 2 + (variant === "female" ? 1 : 0);
        if ((current.narcs.pokemon_icons?.rawFiles[fileIndex]?.length ?? 0) < 48 + 1024 || (current.narcs.pokemon_icons?.rawFiles[0]?.length ?? 0) < 40 + 96) throw new Error("Incomplete icon data");
        const palette = getPokemonIconPaletteAssignment(current, address.paletteKey, variant).paletteId;
        const image = getPokemonIconImage(current, address.archiveSpriteId, variant, palette);
        if (image.pixels.length !== image.width * image.height * 4) throw new Error("Incomplete icon pixels");
        icon = {
          key, label: current.texts.banks.pokedex?.[reference.speciesId] ?? `Pokemon ${reference.speciesId}`,
          width: 32, height: 32, pixels: image.pixels.slice(0, 32 * 32 * 4),
        };
      } catch {
        missing.add(key);
      }
      cache.set(key, icon);
      return icon;
    },
  };
}
