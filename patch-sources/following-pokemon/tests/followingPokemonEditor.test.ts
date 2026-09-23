import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { FOLLOWER_SPRITE_CREDITS, followerRuleAppliesToSpecies, followerZoneLabel } from "../ui/followingPokemonEditor";

function projectWithLocations(): ProjectState {
  return {
    headers: {
      count: 428,
      rows: {
        1: { index: 0, location_name: "Aspertia City" },
        428: { index: 427, location_name: "Floccesy Town" },
      },
    },
  } as unknown as ProjectState;
}

describe("Following Pokémon editor summaries", () => {
  it("labels the wildcard independently from map header zero", () => {
    expect(followerZoneLabel(projectWithLocations(), 0)).toBe("Any zone");
  });

  it("resolves a rule zone through its one-based header row", () => {
    expect(followerZoneLabel(projectWithLocations(), 427)).toBe("Floccesy Town · Zone 427");
  });

  it("keeps the numeric zone visible when no header name is available", () => {
    expect(followerZoneLabel(projectWithLocations(), 900)).toBe("Zone 900");
  });

  it("aggregates wildcard, exact-species, and type rules for the selection", () => {
    const types = new Set([3, 14]);
    expect(followerRuleAppliesToSpecies({ zone: 0, text: "Global" }, 151, types)).toBe(true);
    expect(followerRuleAppliesToSpecies({ zone: 0, species: 151, form: 1, text: "Mew" }, 151, types)).toBe(true);
    expect(followerRuleAppliesToSpecies({ zone: 0, type: 14, text: "Psychic" }, 151, types)).toBe(true);
    expect(followerRuleAppliesToSpecies({ zone: 0, species: 150, text: "Mewtwo" }, 151, types)).toBe(false);
    expect(followerRuleAppliesToSpecies({ zone: 0, type: 10, text: "Fire" }, 151, types)).toBe(false);
  });

  it("keeps the complete follower sprite attribution in one footer string", () => {
    expect(FOLLOWER_SPRITE_CREDITS).toContain("Smogon Sprite Project");
    expect(FOLLOWER_SPRITE_CREDITS).toContain("metalflygon08 on DeviantArt");
    expect(FOLLOWER_SPRITE_CREDITS).toContain("zlolxd - Pokémon Sprites");
  });
});
