import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NintendoDSRom } from "../nds/rom";
import { ABILITY_IMPORT_LIBRARY } from "../pokeweb/abilityLibrary";
import { buildAbilityRuleModule, hydrateAbilityEffectsSource, isVerifiedMegaItemCheckImport } from "../pokeweb/abilityEffectsModel";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

// The shipped Mega DLL with its GiratinaArceusGenesectItemCheck replacement moved onto the fixture's copy of the function.
function withMega(path: string, type: "THUMB_BRANCH" | "THUMB_BRANCH_LINK" = "THUMB_BRANCH", shiftBy = 0) {
  const { project, base, offsets } = makeItemEffectsProject(0x1000, 0, true, true);
  project.session.baseVersion = "W2";
  project.originalRomBytes!.set(new TextEncoder().encode("IRDO"), 12);
  hydrateAbilityEffectsSource(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }));
  const mega = parseRpm(new Uint8Array(readFileSync(new URL("../assets/codeinjection/PokewebMegaW2.dll", import.meta.url))), { allowedMagics: ["DLXF"] });
  const hook = mega.relocations.filter((r) => r.target.type === "THUMB_BRANCH")[2]!; // HOOK_ITEM_CHECK, after ChangeForm and WriteToSrc
  const address = base + offsets.get("GiratinaArceusGenesectItemCheck")!;
  mega.relocations = [{ ...hook, target: { ...hook.target, address: address + shiftBy, type } }];
  project.fileSystem = { replacements: {}, additions: { [path]: writeRpm(mega, { ident: "DLXF" }) } };
  return { project, address };
}

const itemAbilities = ABILITY_IMPORT_LIBRARY.filter((entry) => ["Magician", "Pickpocket", "Sticky Hold"].includes(entry.defaultName) || entry.id === 170);

describe("ability rules with Mega Evolution installed", () => {
  it("builds item-swap abilities against Mega's item check", () => {
    expect(itemAbilities.length).toBeGreaterThan(0);
    const { project } = withMega("patches/PokewebMegaW2.dll");
    for (const entry of ABILITY_IMPORT_LIBRARY) {
      expect(() => buildAbilityRuleModule(project, new Map([[165, entry.rule]])), entry.defaultName).not.toThrow();
    }
  }, 60000);

  it("still rejects the hook from another DLL, or one that isn't a whole replacement", () => {
    const rule = itemAbilities[0]!.rule;
    for (const [path, type, shift] of [["patches/Other.dll", "THUMB_BRANCH", 0], ["patches/PokewebMegaW2.dll", "THUMB_BRANCH_LINK", 0],
      ["patches/PokewebMegaW2.dll", "THUMB_BRANCH", 4]] as const) {
      const { project } = withMega(path, type, shift);
      expect(() => buildAbilityRuleModule(project, new Map([[165, rule]])), `${path} ${type} +${shift}`).toThrow(/Conflicting ability service hook: .*GiratinaArceusGenesectItemCheck/u);
    }
    expect(isVerifiedMegaItemCheckImport("B2", "patches/PokewebMegaW2.dll", "GiratinaArceusGenesectItemCheck", 0x100, 0x100, "THUMB_BRANCH")).toBe(false);
    expect(isVerifiedMegaItemCheckImport("B", "patches/PokewebMegaB.dll", "GiratinaArceusGenesectItemCheck", 0x100, 0x100, "THUMB_BRANCH")).toBe(true);
    expect(isVerifiedMegaItemCheckImport("W2", "patches/PokewebMegaW2.dll", "ChangeForm", 0x100, 0x100, "THUMB_BRANCH")).toBe(false);
  });
});
