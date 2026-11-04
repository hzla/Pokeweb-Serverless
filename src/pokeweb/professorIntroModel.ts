import { readU32, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";

export const PROFESSOR_INTRO_OVERLAY_IDS = [162, 294] as const;
const SPRITE_SPECIES = 0x2a6c;
const APPEAR_SPECIES = 0x2f60;
const CRY_LAYOUTS = {
  IRDO: { species: 0x3328, call: "66f64afc" },
  IREO: { species: 0x32f0, call: "66f686fc" },
} as const;

export type ProfessorIntroPokemonState = {
  speciesId: number;
  crySpeciesId: number;
  warnings: string[];
};

function cryLayout(project: ProjectState) {
  if (project.session.baseRom !== "BW2" || !Object.hasOwn(CRY_LAYOUTS, project.romInfo.idCode)) {
    throw new Error("Professor Intro editing supports US Black 2 and White 2.");
  }
  return CRY_LAYOUTS[project.romInfo.idCode as keyof typeof CRY_LAYOUTS];
}

export async function loadProfessorIntroPokemon(project: ProjectState): Promise<ProfessorIntroPokemonState> {
  cryLayout(project);
  const missing = PROFESSOR_INTRO_OVERLAY_IDS.filter(id => !project.overlays[id]);
  if (missing.length > 0) {
    if (!project.originalRomBytes && !await activeRomMatchesProject(project)) {
      throw new Error("Reconnect this project's ROM to edit the professor's intro Pokémon.");
    }
    const source = project.originalRomBytes ?? await loadActiveRomBytes();
    if (!source) throw new Error("Reload the ROM to edit the professor's intro Pokémon.");
    const rom = new NintendoDSRom(source, { fileData: "view" });
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set(missing));
    for (const [id, overlay] of overlays) project.overlays[id] ??= overlay.data;
  }
  return getProfessorIntroPokemonState(project);
}

export function getProfessorIntroPokemonState(project: ProjectState): ProfessorIntroPokemonState {
  const cry = cryLayout(project);
  const intro = project.overlays[294], start = project.overlays[162];
  if (!intro || !start) throw new Error("The professor's intro overlays are not loaded.");
  if (start.length < cry.species + 4) throw new Error("The professor's intro cry loader has been truncated.");
  // Native intro commands are 24-byte records: command, four s32 arguments,
  // and a run-next flag. Check the records around each editable operand.
  assertWords(intro, SPRITE_SPECIES - 8, [23, 1, undefined, 0xffffb000, 0xfffff800, 1, 24, 1, 0, 0, 0, 0]);
  assertWords(intro, APPEAR_SPECIES - 4, [33, undefined, 0, 0, 0, 0, 30, 8, 0, 1, 0, 0]);
  // New-game initialization loads this literal into r0 for PokeVoice_Load;
  // form=0, volume=64, and the remaining arguments are zero. The appearance
  // command's species argument is unused by retail, but keep it synchronized.
  assertHex(start, cry.species - 0x4c, `00210091019102911048039140220023${cry.call}6065a16d2161e16d61610121a161216be1612062`);
  const speciesId = readU32(intro, SPRITE_SPECIES);
  const appearanceSpecies = readU32(intro, APPEAR_SPECIES);
  const crySpeciesId = readU32(start, cry.species);
  if (![speciesId, appearanceSpecies, crySpeciesId].every(isRetailSpecies)) {
    throw new Error("The professor's intro contains an unsupported species ID.");
  }
  return {
    speciesId, crySpeciesId,
    warnings: speciesId === crySpeciesId && speciesId === appearanceSpecies ? []
      : ["The intro sprite and sound references differ. Apply a Pokémon to synchronize them."],
  };
}

export function applyProfessorIntroPokemon(project: ProjectState, speciesId: number): ProfessorIntroPokemonState {
  if (!isRetailSpecies(speciesId)) throw new Error("Choose a Pokémon species from 1 through 649. The intro uses its base form.");
  const before = getProfessorIntroPokemonState(project);
  const cry = cryLayout(project);
  if (before.speciesId === speciesId && before.crySpeciesId === speciesId
    && readU32(project.overlays[294]!, APPEAR_SPECIES) === speciesId) return before;
  const intro = project.overlays[294]!.slice(), start = project.overlays[162]!.slice();
  writeU32(intro, SPRITE_SPECIES, speciesId);
  writeU32(intro, APPEAR_SPECIES, speciesId);
  writeU32(start, cry.species, speciesId);
  project.overlays[294] = intro;
  project.overlays[162] = start;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  for (const id of PROFESSOR_INTRO_OVERLAY_IDS) {
    if (!project.patches.dirtyOverlayIds.includes(id)) project.patches.dirtyOverlayIds.push(id);
  }
  if (before.speciesId !== speciesId) {
    recordFieldChange(project, "scripts", "Professor Intro", "Pokémon", before.speciesId, speciesId,
      { key: "professor-intro:species" });
  } else {
    recordGenericChange(project, "scripts", `Professor Intro sprite and cry synchronized to Pokémon #${speciesId}.`,
      "Professor Intro", { key: "professor-intro:sync" });
  }
  return getProfessorIntroPokemonState(project);
}

function isRetailSpecies(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 649;
}

function assertWords(bytes: Uint8Array, offset: number, words: Array<number | undefined>): void {
  if (offset + words.length * 4 > bytes.length
    || words.some((word, i) => word !== undefined && readU32(bytes, offset + i * 4) !== word)) {
    throw new Error("The professor's intro script layout has been modified or is unsupported.");
  }
}

function assertHex(bytes: Uint8Array, offset: number, hex: string): void {
  const expected = hex.match(/../gu)!.map(byte => parseInt(byte, 16));
  if (offset < 0 || offset + expected.length > bytes.length
    || expected.some((byte, i) => bytes[offset + i] !== byte)) {
    throw new Error("The professor's intro cry loader has been modified or is unsupported.");
  }
}
