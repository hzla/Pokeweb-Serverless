import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { FOLLOWER_SPRITE_CREDITS, followerDialoguePreviewText, followerRuleAppliesToSpecies, followerZoneChoices, followerZoneLabel, followerZoneOverworldRoute, parseFollowerZoneValue } from "../ui/followingPokemonEditor";
import { layoutBw2Dialogue, type DialogueFont } from "../pokeweb/bw2DialoguePreview";

function projectWithLocations(): ProjectState {
  return {
    headers: {
      count: 428,
      rows: {
        1: { index: 0, location_name: "Aspertia City" },
        428: { index: 427, location_name: "Floccesy Town", overworlds_id: 163 },
      },
    },
  } as unknown as ProjectState;
}

describe("Following Pokémon editor summaries", () => {
  it("suggests every zone sharing an area name and retains each distinct ID", () => {
    const project = projectWithLocations();
    project.headers!.rows[429] = { index: 428, location_name: "Floccesy Town", overworlds_id: 164 };
    expect(followerZoneChoices(project)).toEqual([
      { zone: 427, name: "Floccesy Town", label: "Floccesy Town · Zone 427" },
      { zone: 428, name: "Floccesy Town", label: "Floccesy Town · Zone 428" },
    ]);
    expect(() => parseFollowerZoneValue(project, "Floccesy Town")).toThrow(/Several zones/);
    expect(parseFollowerZoneValue(project, "Floccesy Town · Zone 428")).toBe(428);
    expect(parseFollowerZoneValue(project, "floccesy town · zone 427")).toBe(427);
  });

  it("accepts unique area names, existing numeric IDs and unrestricted zones without guessing invalid searches", () => {
    const project = projectWithLocations();
    expect(parseFollowerZoneValue(project, " Floccesy Town ")).toBe(427);
    for (const value of ["", "0", "Any zone"]) expect(parseFollowerZoneValue(project, value)).toBe(0);
    for (const value of ["427", "Zone 427"]) expect(parseFollowerZoneValue(project, value)).toBe(427);
    expect(parseFollowerZoneValue(project, "65535")).toBe(65535);
    for (const value of ["65536", "-1", "1.5", "Floc", "Unknown place", "Unknown · Zone 427"])
      expect(() => parseFollowerZoneValue(project, value)).toThrow(/Zone ID|area suggestion/);
  });

  it("previews native follower tokens and line breaks without treating literal script controls as commands", () => {
    const glyph = { left: 0, width: 1, advance: 1, pixels: new Uint8Array([1]) };
    const font: DialogueFont = { width: 1, height: 1, maxAdvance: 1, fallback: glyph, glyphs: new Map(Array.from({ length: 95 }, (_, i) => [32 + i, glyph])) };
    const source = "{nickname} meets {player} in {location}.\nLiteral VAR(256, 0) and \\n.";
    const layout = layoutBw2Dialogue(followerDialoguePreviewText(source, "Purrloin", "Antonio", 427), font);
    expect(layout.pages).toHaveLength(1);
    const line = (row: number) => layout.pages[0].glyphs.filter(g => g.y === row * 16).map(g => String.fromCharCode(g.code)).join("");
    expect(line(0)).toBe("Purrloin meets Antonio in Zone 427.");
    expect(line(1)).toBe("Literal VAR(256, 0) and \\n.");
    expect(layout.variables).toEqual([]);
    expect(followerDialoguePreviewText("{nickname}/{player}/{location}", "ABCDEFGHIJKLM", "ABCDEFGHIJ", 65535))
      .toBe(followerDialoguePreviewText("ABCDEFGHIJK/ABCDEFGH/Zone 9999", "", "", 0));
  });

  it("opens the selected nonzero zone even when its event file is shared", () => {
    const project = projectWithLocations();
    expect(followerZoneOverworldRoute(project, 427)).toBe("#overworlds/163/427");
    expect(followerZoneOverworldRoute(project, 0)).toBeUndefined();
    expect(followerZoneOverworldRoute(project, 900)).toBeUndefined();
    expect(followerZoneOverworldRoute(project, -1)).toBeUndefined();
    expect(followerZoneOverworldRoute(project, 1.5)).toBeUndefined();
    project.headers!.rows[428].overworlds_id = 0;
    expect(followerZoneOverworldRoute(project, 427)).toBe("#overworlds/0/427");
  });
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
