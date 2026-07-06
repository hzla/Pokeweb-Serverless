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
});
