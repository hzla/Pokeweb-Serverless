import { describe, expect, it } from "vitest";
import { pokemonFormLabel, pokemonFormSpeciesLabel } from "../pokeweb/pokemonFormLabels";

describe("pokemonFormLabels", () => {
  it("uses named Gen 5 form labels from the legacy table", () => {
    expect(pokemonFormSpeciesLabel("Deoxys", 1)).toBe("Deoxys-Attack");
    expect(pokemonFormSpeciesLabel("Rotom", 5)).toBe("Rotom-Mow");
    expect(pokemonFormSpeciesLabel("Genesect", 2)).toBe("Genesect-Chill");
    expect(pokemonFormSpeciesLabel("Sawsbuck", 3)).toBe("Sawsbuck-Winter");
  });

  it("uses Smogon-style suffixes for newer forms", () => {
    expect(pokemonFormSpeciesLabel("Lucario", 1)).toBe("Lucario-Mega");
    expect(pokemonFormSpeciesLabel("Meowth", 2)).toBe("Meowth-Galar");
    expect(pokemonFormSpeciesLabel("Tauros", 3)).toBe("Tauros-Paldea-Aqua");
    expect(pokemonFormSpeciesLabel("Ogerpon", 6)).toBe("Ogerpon-Cornerstone-Tera");
  });

  it("falls back to generic form numbering for unknown form tables", () => {
    expect(pokemonFormLabel("Missingno", 2)).toBe("Form 2");
    expect(pokemonFormSpeciesLabel("Missingno", 2)).toBe("Missingno Form 2");
  });

  it('uses ROM-authored Mega names without changing vanilla form labels', () => {
    expect(pokemonFormSpeciesLabel('Charizard',3,'Charizard-Mega-G')).toBe('Charizard-Mega-G');
    expect(pokemonFormLabel('Meowth',3,'Meowth-Mega')).toBe('Mega');
    expect(pokemonFormSpeciesLabel('Toxtricity',3,'Toxtricity-Low-Key-Mega')).toBe('Toxtricity-Low-Key-Mega');
    expect(pokemonFormSpeciesLabel('Urshifu',3,'Urshifu-Rapid-Strike-Mega')).toBe('Urshifu-Rapid-Strike-Mega');
    expect(pokemonFormSpeciesLabel('Pikachu',7)).toBe('Pikachu-Partner-Cap');
    expect(pokemonFormSpeciesLabel('Pikachu',7,'Pikachu-Mega')).toBe('Pikachu-Mega');
    expect(pokemonFormSpeciesLabel('Meowth',1,'Unrelated-Mega')).toBe('Meowth-Alola');
  });
});
