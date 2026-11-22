import { normalizeName } from "./mastersheetDocument";

/**
 * Base stats and move numbers from an unmodified White 2 (src/assets/data/vanillaWhite2Stats.json, made by
 * scripts/generate-vanilla-white2-stats.ts), so the mastersheet viewer can show what a hack changed. Looked up by
 * name, since hacks move Pokémon and moves to other IDs: a Pokémon or move the hack renamed has no vanilla match.
 */
export type VanillaStats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
export type VanillaMove = { power: number; accuracy: number; pp: number };

export type VanillaData = { pokemon: Record<string, number[]>; moves: Record<string, number[]> };

/** A species by name, and alternate forms by their form number. */
export function vanillaPokemonKey(speciesName: string, form = 0): string {
  return `${normalizeName(speciesName)}${form > 0 ? `#${form}` : ""}`;
}

export function vanillaMoveKey(name: string): string {
  return normalizeName(name);
}

let data: Promise<VanillaData> | undefined;

/** Loads the table on first use; it is kept out of the viewer's first download. */
export function loadVanillaWhite2Stats(): Promise<VanillaData> {
  data ??= import("../assets/data/vanillaWhite2Stats.json").then((module) => (module.default ?? module) as VanillaData);
  return data;
}

export function vanillaPokemonStats(table: VanillaData, speciesName: string, form = 0): VanillaStats | undefined {
  const row = table.pokemon[vanillaPokemonKey(speciesName, form)];
  return row && { hp: row[0]!, atk: row[1]!, def: row[2]!, spa: row[3]!, spd: row[4]!, spe: row[5]! };
}

export function vanillaMove(table: VanillaData, name: string): VanillaMove | undefined {
  const row = table.moves[vanillaMoveKey(name)];
  return row && { power: row[0]!, accuracy: row[1]!, pp: row[2]! };
}
