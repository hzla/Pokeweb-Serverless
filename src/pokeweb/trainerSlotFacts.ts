import { pokemonFormLabel } from "./pokemonFormLabels";
import { decodeRecord, type ProjectState } from "./projectStore";
import { storedSpeciesId } from "./speciesExpansionIds";

/*
 * Facts about a trainer Pokémon that the editor shows beside its fields: the forms its species has, which genders it
 * can be, and its maximum HP in battle (for the starting HP bar).
 */

type Personal = Record<string, number | undefined>;

function personal(project: ProjectState, id: number): Personal | undefined {
  if (!project.narcs.personal || !(id >= 0 && id < project.narcs.personal.fileCount)) return undefined;
  try {
    return decodeRecord(project, "personal", id).raw as Personal | undefined;
  } catch {
    return undefined;
  }
}

/** The personal record a species' form uses: forms after the first live at form_id + form - 1. */
export function trainerFormPersonalId(project: ProjectState, speciesId: number, form: number): number {
  const species = storedSpeciesId(project, speciesId);
  const base = personal(project, species);
  const first = Number(base?.form_id ?? 0);
  const count = Number(base?.num_forms ?? 1);
  return form > 0 && first > 0 && form < count ? first + form - 1 : species;
}

export type TrainerFormOption = { form: number; label: string };

/** Every form of the species, from its personal record's form count; one entry when it has no alternate forms. */
export function trainerFormOptions(project: ProjectState, speciesId: number, speciesName: string): TrainerFormOption[] {
  const base = personal(project, storedSpeciesId(project, speciesId));
  const count = Math.max(1, Math.min(64, Number(base?.num_forms ?? 1)));
  return Array.from({ length: count }, (_, form) => ({ form, label: form === 0 ? speciesName || "Base form" : pokemonFormLabel(speciesName, form) }));
}

/** Which genders the species can be: its personal gender ratio (0 male only, 254 female only, 255 genderless). */
export function trainerGenderAvailability(project: ProjectState, speciesId: number, form: number): { male: boolean; female: boolean } {
  const ratio = Number(personal(project, trainerFormPersonalId(project, speciesId, form))?.gender ?? 127);
  if (ratio === 255) return { male: false, female: false };
  return { male: ratio !== 254, female: ratio !== 0 };
}

/** Trainer Pokémon have no EVs; their IVs come from the difficulty byte (0-255 → 0-31 in every stat). */
export function trainerIv(difficulty: number): number {
  return Math.floor((Math.max(0, Math.min(255, difficulty)) * 31) / 255);
}

/** Maximum HP in battle, or undefined when the species has no personal data. Base HP 1 (Shedinja) always has 1 HP. */
export function trainerMaxHp(project: ProjectState, speciesId: number, form: number, level: number, difficulty: number): number | undefined {
  const record = personal(project, trainerFormPersonalId(project, speciesId, form));
  const base = Number(record?.base_hp ?? 0);
  if (!record || !base || !(level >= 1)) return undefined;
  if (base === 1) return 1;
  return Math.floor(((2 * base + trainerIv(difficulty)) * level) / 100) + level + 10;
}

/** The HP the battle starts at: full, a percentage rounded down (at least 1), or an exact value capped at the maximum. */
export function trainerStartingHp(maxHp: number, hpMode: number, hp: number): number {
  if (hpMode === 1) return Math.max(1, Math.floor((maxHp * hp) / 100));
  if (hpMode === 2) return Math.max(1, Math.min(maxHp, hp));
  return maxHp;
}
