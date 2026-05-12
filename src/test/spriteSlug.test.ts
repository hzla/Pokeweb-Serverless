import { describe, expect, it } from "vitest";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";

describe("pokemonSpriteSlug", () => {
  it("removes URL-hostile characters from Pokemon sprite names", () => {
    expect(pokemonSpriteSlug("Zygarde-50%")).toBe("zygarde-50");
    expect(pokemonSpriteSlug("Mr. Mime")).toBe("mr-mime");
    expect(pokemonSpriteSlug("Pikachu-Ph. D")).toBe("pikachu-ph-d");
  });
});
