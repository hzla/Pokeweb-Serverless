import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARC } from "../nds/narc";
import * as abilityEffectsModel from "../pokeweb/abilityEffectsModel";
import {
  abilityExpansionRows, abilityLibraryDescription, freeAbilitySlots, getAbilityExpansionStatus, stageAbilityExpansion,
} from "../pokeweb/abilityExpansionModel";
import { ABILITY_IMPORT_LIBRARY, abilityImport } from "../pokeweb/abilityLibrary";
import { abilityTemplateNamed, resolveAbilities } from "../pokeweb/megaContentModel";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

// The ability runtime build (and the PMC install it needs) is covered by the ability effects tests; here creating
// abilities names them at the next free IDs and records what was asked for.
let created: Array<{ name: string; rules?: unknown; description?: string }> = [];
beforeEach(() => {
  created = [];
  vi.spyOn(abilityEffectsModel, "createCustomAbilities").mockImplementation(async (project, abilities) => {
    const first = abilityEffectsModel.nextCustomAbilityId(project)!;
    abilities.forEach((ability, index) => { project.texts.banks.abilities![first + index] = ability.name; });
    created.push(...abilities);
    return abilities.map((_, index) => first + index);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

// A White 2 project with retail's 164 abilities named and descriptions for every ID.
function project(): ProjectState {
  const { project } = makeItemEffectsProject(0, 0, true, true);
  const ids = [374, 375, 487];
  const narc = new NARC();
  narc.files = Array.from({ length: 488 }, () => new Uint8Array());
  for (const id of ids) narc.files[id] = encodeGen5TextBank(Array.from({ length: 256 }, (_, i): Gen5TextEntry => [`0_${i}`, id === 375 ? `Description ${i}` : i && i <= 164 ? `Ability ${i}` : "", 0]));
  project.narcs.message_texts = createNarcStore("message_texts", "texts", 1, narc);
  project.texts.banks.abilities = Array.from({ length: 256 }, (_, i) => (i && i <= 164 ? `Ability ${i}` : ""));
  return project;
}

describe("Ability Expansion", () => {
  it("lists the library with descriptions, and the free ability IDs", () => {
    const p = project();
    const rows = abilityExpansionRows(p);
    expect(rows).toHaveLength(ABILITY_IMPORT_LIBRARY.length);
    for (const row of rows) {
      expect(row.description, row.label).not.toBe("");
      expect(row.name.length, row.label).toBeLessThanOrEqual(15);
      expect(row.installedAs).toBeUndefined();
    }
    expect(abilityLibraryDescription(306)).toMatch(/evasion/u); // Supersweet Syrup
    expect(getAbilityExpansionStatus(p)).toMatchObject({ supported: true, ready: true, installed: 0, freeSlots: 91 });
  });

  it("adds the chosen abilities with their names, descriptions and rules, and skips ones the ROM has", async () => {
    const p = project();
    p.texts.banks.abilities![165] = "Magician"; // already in the ROM
    expect(abilityExpansionRows(p).find((row) => row.id === 170)!.installedAs).toBe(165);
    const report = await stageAbilityExpansion(p, [170, 287, 306]);
    expect(report.skipped).toEqual(["Magician (already ability 165)"]);
    expect(report.added).toEqual([{ name: "Beads of Ruin", id: 166 }, { name: "SupersweetSyrup", id: 167 }]);
    expect(p.texts.banks.abilities!.slice(166, 168)).toEqual(["Beads of Ruin", "SupersweetSyrup"]);
    expect(created).toEqual([
      { name: "Beads of Ruin", rules: abilityImport(287).rule, description: "Lowers the Sp. Def of all\nother Pokémon." },
      { name: "SupersweetSyrup", rules: abilityImport(306).rule, description: abilityLibraryDescription(306) },
    ]);
    expect(getAbilityExpansionStatus(p)).toMatchObject({ installed: 3, freeSlots: 88 });
    expect(freeAbilitySlots(p)).toBe(88);
  }, 60000);

  it("refuses more abilities than there are free IDs", async () => {
    const p = project();
    for (let id = 165; id <= 254; id++) p.texts.banks.abilities![id] = `Taken ${id}`;
    expect(getAbilityExpansionStatus(p).freeSlots).toBe(1);
    await expect(stageAbilityExpansion(p, [170, 171])).rejects.toThrow(/2 abilities chosen, but only 1 ability IDs are free/u);
    p.texts.banks.abilities![255] = "Taken 255";
    expect(getAbilityExpansionStatus(p)).toMatchObject({ ready: false, message: "All 255 ability IDs are in use." });
  });
});

describe("ability library numbering", () => {
  it("uses the games' ability numbers", () => {
    expect(abilityImport(284).label).toBe("Vessel of Ruin");
    expect(abilityImport(287).label).toBe("Beads of Ruin");
    expect(abilityImport(305).label).toBe("Toxic Chain");
  });

  it("matches packages' abilities by name, not by White2Upgrade's numbers", async () => {
    expect(abilityTemplateNamed("Supersweet Syrup")?.id).toBe(306);
    expect(abilityTemplateNamed("Dragon’s Maw")?.id).toBe(263);
    expect(abilityTemplateNamed("Water Compaction")?.id).toBe(195);
    const p = project();
    const report = { abilitiesAdded: [] as string[] };
    // Dipplin's content: White2Upgrade numbers Supersweet Syrup 300 (the games' Mind's Eye) and Hospitality 301.
    const resolved = await resolveAbilities(p, [{ abilities: [300, 301], abilityNames: { 300: "Supersweet Syrup", 301: "Hospitality" }, abilityDescriptions: {} }], report);
    expect(report.abilitiesAdded).toEqual(["SupersweetSyrup", "Hospitality"]);
    expect(created.map((ability) => ability.rules)).toEqual([abilityImport(306).rule, abilityImport(299).rule]);
    expect(p.texts.banks.abilities![resolved.get(300)!]).toBe("SupersweetSyrup");
    expect(p.texts.banks.abilities![resolved.get(301)!]).toBe("Hospitality");
  }, 60000);
});
