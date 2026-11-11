import { describe, expect, it } from "vitest";
import { megaEditorAvailable, megaFormSuffix, megaTriggerNames, resolveMegaTrigger } from "../pokeweb/megaEditorModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderPokemonMegaSection } from "../ui/pokemonMegaPanel";

const project = (baseRom: "BW" | "BW2") => ({ session: { baseRom, generation: "gen5" } }) as unknown as ProjectState;

describe("Pokémon editor Mega Evolution section", () => {
  it("is offered for Black / White and Black 2 / White 2 on localhost only", () => {
    expect(megaEditorAvailable(project("BW2"), "localhost")).toBe(true);
    expect(megaEditorAvailable(project("BW2"), "127.0.0.1")).toBe(true);
    expect(megaEditorAvailable(project("BW2"), "hzla.github.io")).toBe(false);
    expect(megaEditorAvailable(project("BW"), "localhost")).toBe(true);
    expect(megaEditorAvailable(project("BW"), "hzla.github.io")).toBe(false);
    // Node has no location: the section renders nothing.
    expect(renderPokemonMegaSection(project("BW2"), 6)).toBe("");
  });

  it("names Mega forms after the package's names", () => {
    expect(megaFormSuffix("Mega Charizard X", "Charizard")).toBe("Mega-X");
    expect(megaFormSuffix("Mega Venusaur", "Venusaur")).toBe("Mega");
    expect(megaFormSuffix("Mega Mr. Mime", "Mr. Mime")).toBe("Mega");
  });

  it("reads trigger names and IDs, skipping placeholder slots", () => {
    const items = ["None", "Master Ball", "???", "Leftovers", "", "Leftovers"];
    expect(megaTriggerNames(items)).toEqual([{ id: 1, name: "Master Ball" }, { id: 3, name: "Leftovers" }, { id: 5, name: "Leftovers" }]);
    expect(resolveMegaTrigger(items, "leftovers")).toBe(3);
    expect(resolveMegaTrigger(items, " Master Ball ")).toBe(1);
    expect(resolveMegaTrigger(items, "#5")).toBe(5);
    expect(resolveMegaTrigger(items, "2")).toBe(0);
    expect(resolveMegaTrigger(items, "???")).toBe(0);
    expect(resolveMegaTrigger(items, "Charizardite X")).toBe(0);
  });
});
