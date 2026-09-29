import { NARC } from "../nds/narc";
import { writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "../pokeweb/fileSystemModel";
import { getPokemonSpriteImage, resolvePokemonSpriteId, getPokemonIconImage, getPokemonIconPaletteAssignment, resolvePokemonIconAddress } from "../pokeweb/pokemonSpriteModel";
import { parseNitroCellEffect } from "../pokeweb/nitroCell";
import { decodeGen5TextBank } from "../pokeweb/text";
import { getTextBank } from "../pokeweb/textModel";
import { findPwanOverrideForSpecies } from "../pokeweb/pwanAnimationModel";
import { pwanFrameRgbaImage } from "../pokeweb/pwanCompiler";
import type { ProjectState } from "../pokeweb/projectStore";
import { typeNamesForProject } from "../pokeweb/constants";
import { NativeFont, decodePng, type Assets, type Image } from "./assets";
import type { Project } from "./document";
import { learnsetTemplate } from "./learnsetTemplate";
import { resolveSummary } from "./summaryCatalog";
import { nativeSummaryArt, summaryArtwork } from "./summaryAssets";
import { nativeLearnsetArt } from "./nativeLearnsetAssets";

/** Resolve all resources against the loaded ROM and its staged asset edits. */
export function romAssets(project: ProjectState, rom: NintendoDSRom, design: Project): Assets {
  const native = design.document.screens.some(s => s.elements.some(e => e.kind === "native" && e.native?.startsWith("learnset."))) ? learnsetTemplate(project, rom) : undefined;
  const narc = (path: string) => { const id = rom.filenames.idOf(path); if (id === undefined) throw new Error(`ROM asset archive ${path} is missing.`); return new NARC(getRomFileBytes(project, rom, id)).files; };
  const summary = design.document.screens.some(s => s.target?.kind === "summary") ? narc("a/0/7/7") : undefined;
  const fontFiles = narc("a/0/2/3"), fonts = fontFiles.slice(0, 4).map(b => new NativeFont(b));
  const icons = project.narcs.pokemon_icons?.rawFiles ?? narc("a/0/0/7");
  // Form/palette helpers need this archive but must not mutate the user's extraction choices.
  const resourceProject: ProjectState = { ...project, narcs: { ...project.narcs, pokemon_icons: project.narcs.pokemon_icons ?? {
    name: "pokemon_icons", fileId: rom.filenames.idOf("a/0/0/7")!, sourcePath: "a/0/0/7", fileCount: icons.length, rawFiles: icons, records: new Map(), dirty: new Set(),
  } } };
  const types = narc("a/0/8/2"), cache = new Map<string, Image | undefined>();
  function read(key: string, produce: () => Image | undefined) { if (!cache.has(key)) cache.set(key, produce()); return cache.get(key); }
  function effect(char: Uint8Array, palette: Uint8Array, cell: Uint8Array, animation: Uint8Array, paletteId: number, pose: number, icon: boolean): Image | undefined {
    if (!char || !palette || !cell || !animation || 40 + 32 * (paletteId + 1) > palette.length) return;
    const colors = palette.slice(); colors.set(palette.subarray(40 + paletteId * 32, 72 + paletteId * 32), 40);
    try {
      const mappedCell = cell.slice();
      // BW2 loads these assets under GX_OBJVRAMMODE_CHAR_1D_32K. The NCER
      // hint is zero; normalize it for the general cell decoder's mode enum.
      writeU32(mappedCell, 32, 0x10);
      const parsed = parseNitroCellEffect("custom-ui", 0, 0, 0, 0, char, colors, mappedCell, animation, { originCentered: icon });
      const frame = (parsed.sequences[icon ? 1 : 0] ?? parsed.sequences[0])?.frames[pose]; if (!frame) return;
      const width = icon ? 32 : 32, height = icon ? 32 : 16, pixels = new Uint8ClampedArray(width * height * 4);
      const ox = Math.floor((width - frame.width) / 2), oy = Math.floor((height - frame.height) / 2);
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        if (x + ox >= 0 && x + ox < width && y + oy >= 0 && y + oy < height) pixels.set(frame.rgba.subarray((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4), ((y + oy) * width + x + ox) * 4);
      }
      return { width, height, pixels };
    } catch { return; }
  }
  const messages = new Map<number, string[]>();
  let messageFiles: Uint8Array[] | undefined;
  function messageBank(id: number): string[] {
    if (!messages.has(id)) {
      const entries = project.narcs.message_texts ? getTextBank(project, "message_texts", id) : decodeGen5TextBank((messageFiles ??= narc("a/0/0/2"))[id]);
      messages.set(id, entries.map(e => e[1].replace(/\\n/g, "\n")));
    }
    return messages.get(id)!;
  }
  return {
    summaryPokemon(p) {
      if (p.egg) return p;
      const abilityId = messageBank(374).findIndex(name => name.toLowerCase() === p.ability?.toLowerCase());
      return { ...p, speciesName: p.speciesName ?? project.texts.banks.pokedex?.[p.species] ?? messageBank(90)[p.species], abilityDescription: p.abilityDescription ?? (abilityId >= 0 ? messageBank(375)[abilityId] : undefined) };
    },
    nativeSummary: summary ? nativeSummaryArt(summary, types, fontFiles[5], rom.idCode.startsWith("IRE"), typeNamesForProject(project)) : undefined,
    pokemonSprite(pokemon) { return read(`sprite:${pokemon.species}:${pokemon.form}:${pokemon.gender}:${!!pokemon.shiny}:${pokemon.egg}`, () => {
      if (pokemon.egg) return;
      try { const front = findPwanOverrideForSpecies(resourceProject, pokemon.species, pokemon.form)?.front; if (front && !pokemon.shiny) return pwanFrameRgbaImage(front.pwanBytes); } catch { /* Fall back to the native static front. */ }
      const path = "a/0/0/4";
      resourceProject.narcs.pokemon_sprites ??= { name: "pokemon_sprites", fileId: rom.filenames.idOf(path)!, sourcePath: path, fileCount: 0, rawFiles: narc(path), records: new Map(), dirty: new Set() };
      try {
        const id = resolvePokemonSpriteId(resourceProject, pokemon.species, pokemon.form);
        const variant = { kind: "sprite" as const, side: "front" as const, gender: pokemon.gender === "female" ? "female" as const : "male" as const };
        try { return getPokemonSpriteImage(resourceProject, id, variant, pokemon.shiny ? "shiny" : "normal"); }
        catch { return getPokemonSpriteImage(resourceProject, id, { ...variant, gender: "male" }, pokemon.shiny ? "shiny" : "normal"); }
      } catch { return; }
    }); },
    nativeLearnset: native ? nativeLearnsetArt(narc("a/1/2/5"), types, fontFiles[5], typeNamesForProject(project)) : undefined,
    resolveNative(document) {
      const output = structuredClone(document); output.assets.push(...(native?.document.assets ?? []).filter(a => !output.assets.some(b => b.id === a.id)));
      const regionFor = (id: string, screen: string) => screen === "bottom" ? "learnset.moves" : id === "top-art" ? "learnset.background" : id.startsWith("stat-") ? "learnset.stats" : id.startsWith("family-") ? "learnset.family" : id.startsWith("ability-") ? "learnset.abilities" : id.startsWith("evolution-") ? "learnset.evolution" : "learnset.header";
      for (const s of output.screens) s.elements = s.elements.flatMap(e => e.kind !== "native" ? [e] : e.native?.startsWith("summary.") ? resolveSummary(e) : e.hidden || !native ? [] : native.document.screens[0].elements.filter(x => regionFor(x.id, x.screen) === e.native).map(x => {
        const copy = structuredClone(x); copy.id = `${e.id}_${x.id}`;
        if (copy.action.type === "selectList") copy.action.list = `${e.id}_${copy.action.list}`;
        for (const direction of ["up", "down", "left", "right"] as const) if (copy.neighbors[direction]) copy.neighbors[direction] = `${e.id}_${copy.neighbors[direction]}`;
        return copy;
      }));
      return output;
    },
    glyph: (font, char) => fonts[font]?.glyph(char),
    image(key) { return read(key, () => {
      if (key.startsWith("rom:summary:")) return summaryArtwork(summary ?? narc("a/0/7/7"), key.slice(4), rom.idCode.startsWith("IRE"));
      if (key.startsWith("import:")) { const id = key.slice(7), asset = design.document.assets.find(a => a.id === id) ?? native?.document.assets.find(a => a.id === id), file = asset && (design.files[asset.path] ?? native?.files[asset.path]); return file ? decodePng(file) : undefined; }
      if (key.startsWith("type:")) {
        const type = Number(key.slice(5)), table = [0, 0, 1, 1, 0, 0, 2, 1, 0, 0, 1, 2, 0, 1, 1, 2, 0, 0];
        if (type >= 0 && type < table.length) return effect(types[34 + type], types[33], types[60], types[63], table[type], 0, false);
      }
      if (key.startsWith("type-name:")) {
        const names = typeNamesForProject(project), type = names.findIndex(n => n.toLowerCase() === key.slice(10).toLowerCase());
        const table = [0, 0, 1, 1, 0, 0, 2, 1, 0, 0, 1, 2, 0, 1, 1, 2, 0, 0];
        if (type >= 0 && type < table.length) return effect(types[34 + type], types[33], types[60], types[63], table[type], 0, false);
      }
    }); },
    icon(species, form, pose, egg) { return read(`icon:${species}:${form}:${pose}:${!!egg}`, () => {
      // Eggs are not eligible in the native learnset adapter. Do not draw species zero as an egg.
      if (egg) return;
      const address = resolvePokemonIconAddress(resourceProject, species, form);
      const palette = getPokemonIconPaletteAssignment(resourceProject, address.paletteKey, "male").paletteId;
      // The party uses 1D 32-byte OBJ mapping and two packed 32×32 cells.
      // NCER's zero mapping hint is not the actual hardware 2D stride here.
      const image = getPokemonIconImage(resourceProject, address.archiveSpriteId, "male", palette);
      if (pose < 0 || pose > 1 || image.width !== 32 || image.height !== 64) return;
      return { width: 32, height: 32, pixels: image.pixels.slice(pose * 32 * 32 * 4, (pose + 1) * 32 * 32 * 4) };
    }); },
  };
}
