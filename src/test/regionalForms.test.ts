import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGIONAL_FORMS } from "../pokeweb/regionalFormsModel";
import type { PwanLibraryManifest } from "../pokeweb/pwanLibraryModel";

const library = JSON.parse(readFileSync(new URL("../assets/pwan/library/manifest.json", import.meta.url), "utf8")) as PwanLibraryManifest;
const byKey = new Map(REGIONAL_FORMS.map((form) => [form.key, form]));
const form = (key: string) => byKey.get(key)!;

describe("Regional forms package", () => {
  it("has the 54 regional forms of species 1-649 in 34 families", () => {
    expect(REGIONAL_FORMS).toHaveLength(54);
    expect(new Set(REGIONAL_FORMS.map((entry) => entry.family)).size).toBe(34);
    for (const entry of REGIONAL_FORMS) {
      expect(entry.species).toBeLessThanOrEqual(649);
      expect(entry.personal.stats).toHaveLength(6);
      expect(entry.personal.tm).toHaveLength(4);
      expect(entry.abilities).toHaveLength(3);
      expect(entry.learnset.length).toBeGreaterThan(0);
      expect(entry.learnset.length).toBeLessThanOrEqual(25); // the retail learnset limit
      for (const [level, move, name] of entry.learnset) {
        expect(level).toBeGreaterThanOrEqual(1);
        if (move > 559) expect(name).toBeTruthy(); // newer moves are matched by name
      }
    }
    expect(form("REGIONAL_ALOLA_RATTATA")).toMatchObject({ species: 19, family: 19, suffix: "Alola", personal: { types: [16, 0], stats: [30, 56, 35, 72, 25, 35] } });
    expect(form("REGIONAL_ALOLA_NINETALES").personal.types).toEqual([14, 17]); // Ice / Fairy
    expect(form("REGIONAL_PALDEA_TAUROS_AQUA").suffix).toBe("Paldea-Aqua");
    expect(form("REGIONAL_GALAR_DARMANITAN_ZEN").suffix).toBe("Galar-Zen");
  });

  it("takes each form's sprites and icon from its PWAN library entry", () => {
    const entries = new Map(library.entries.map((entry) => [entry.id, entry]));
    for (const entry of REGIONAL_FORMS) {
      const sprite = entries.get(entry.library)!;
      expect(sprite).toMatchObject({ kind: "regional form", speciesId: entry.species, name: entry.name, hasFront: true, hasBack: true });
      expect(sprite.icon).toBeTruthy();
    }
  });

  it("evolves each form into its own evolution, and leaves out evolutions into newer Pokémon", () => {
    const evolutions = (key: string) => form(key).evolutions;
    expect(evolutions("REGIONAL_ALOLA_RATTATA")).toEqual([{ method: 4, param: 20, species: 20, form: "REGIONAL_ALOLA_RATICATE" }]);
    expect(evolutions("REGIONAL_GALAR_DARUMAKA")).toEqual([{ method: 4, param: 35, species: 555, form: "REGIONAL_GALAR_DARMANITAN" }]);
    // Galarian Slowpoke: level 37 into Galarian Slowbro, a King's Rock trade into Galarian Slowking (the Galarica items' stand-ins).
    expect(evolutions("REGIONAL_GALAR_SLOWPOKE")).toEqual([
      { method: 4, param: 37, species: 80, form: "REGIONAL_GALAR_SLOWBRO" },
      { method: 6, param: 221, species: 199, form: "REGIONAL_GALAR_SLOWKING" },
    ]);
    // The Ice Stone forms evolve by their base species' method.
    expect(evolutions("REGIONAL_ALOLA_VULPIX")).toEqual([{ method: 8, param: 82, species: 38, form: "REGIONAL_ALOLA_NINETALES" }]);
    expect(evolutions("REGIONAL_ALOLA_SANDSHREW")).toEqual([{ method: 4, param: 22, species: 28, form: "REGIONAL_ALOLA_SANDSLASH" }]);
    for (const key of ["REGIONAL_GALAR_MEOWTH", "REGIONAL_GALAR_YAMASK", "REGIONAL_HISUI_SNEASEL", "REGIONAL_PALDEA_WOOPER", "REGIONAL_GALAR_LINOONE"]) {
      expect(evolutions(key)).toEqual([]);
    }
    for (const entry of REGIONAL_FORMS) {
      for (const row of entry.evolutions) {
        expect(row.species).toBeLessThanOrEqual(649);
        if (row.form) expect(byKey.get(row.form)?.species).toBe(row.species);
      }
    }
  });

  it("gives Galarian Darmanitan Zen Mode, with a battle runtime for each game whose Galarian forms the installer sets", () => {
    expect(form("REGIONAL_GALAR_DARMANITAN").abilities[2]).toBe(161);
    expect(form("REGIONAL_GALAR_DARMANITAN_ZEN").abilities).toEqual([161, 161, 161]);
    const manifest = JSON.parse(readFileSync(new URL("../assets/codeinjection/regionalZenModeManifest.json", import.meta.url), "utf8")) as {
      games: Record<string, { fileName: string; configOffset: number; targets: unknown[] }>;
    };
    for (const game of ["B", "W", "B2", "W2"]) {
      const entry = manifest.games[game]!;
      const dll = readFileSync(new URL(`../assets/codeinjection/${entry.fileName}`, import.meta.url));
      expect(dll.subarray(entry.configOffset, entry.configOffset + 6)).toEqual(Buffer.from([0x50, 0x57, 0x5a, 0x4e, 0, 0])); // "PWZN", unset
      expect(entry.targets).toHaveLength(3);
    }
  });
});
