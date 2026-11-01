import { describe, expect, it } from "vitest";
import white from "../assets/data/abilityBindingsW1.json";
import black from "../assets/data/abilityBindingsB1.json";
import { ABILITY_IMPORT_LIBRARY } from "../pokeweb/abilityLibrary";
import { NATIVE_ABILITY_PROFILES, type NativeAbilityProfile } from "../pokeweb/abilityNativeRuntime";
import { ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, hydrateAbilityEffectsSource, inspectAbilityEffects, supportsAbilityEditor } from "../pokeweb/abilityEffectsModel";
import { validateAbilityRule, type AbilityRuleEffect } from "../pokeweb/abilityRules";
import { NintendoDSRom } from "../nds/rom";
import { writeRpm } from "../pokeweb/rpm";
import { makeBw1AbilityProject } from "./fixtures/blackAbilityProject";

describe("White 1 ability profiles", () => {
  it("exposes the same native controls with independently generated White bindings", () => {
    expect(white.game).toBe("W"); expect(white.profiles).toHaveLength(157);
    expect(white.functions).not.toEqual(black.functions);
    for (const profile of white.profiles) {
      const original = NATIVE_ABILITY_PROFILES.find(p => p.id === profile.id)!;
      expect(profile.events.map(e => e.event)).toEqual(original.events.map(e => e.event));
      expect((profile.parameters ?? []).map(({ sites, ...parameter }) => parameter)).toEqual((original.parameters ?? []).map(({ sites, ...parameter }) => parameter));
    }
  });
  it.each([[0, 0], [0x1800, 0x3000]])("links the complete import library at shifted layouts %i/%i", (shift, relocate) => {
    const { project } = makeBw1AbilityProject("W", shift, relocate);
    expect(supportsAbilityEditor(project)).toBe(true); expect(inspectAbilityEffects(project).editable).toBe(true);
    for (const entry of ABILITY_IMPORT_LIBRARY) {
      const rpm = buildAbilityRuleModule(project, new Map([[255, entry.rule]]));
      expect(rpm.metadata.PMCGameID).toBe("W");
      expect(rpm.relocations.some(r => r.target.module === "167")).toBe(false);
      expect(rpm.relocations.some(r => r.target.module === "93")).toBe(true);
    }
  }, 120000);
  it("links edits to every copied native template's supported parameters", () => {
    const { project } = makeBw1AbilityProject("W");
    for (const profile of white.profiles as NativeAbilityProfile[]) {
      const effect: AbilityRuleEffect = { kind: `nativeAbility:${profile.id}`, value: -1, parameters: {} };
      for (const parameter of profile.parameters ?? []) effect.parameters![parameter.key] = parameter.choices?.find(value => value !== parameter.original) ?? (parameter.original === parameter.min ? parameter.max : parameter.min);
      if (profile.stats) effect.stat = 3;
      if (profile.weather) effect.weather = 3;
      if (profile.multipliers) effect.value = 2.5;
      if (profile.chances) effect.chance = 100;
      expect(() => buildAbilityRuleModule(project, new Map([[255, { effects: [effect], conditions: { kind: "group", mode: "all", children: [] } }]])), `Native template ${profile.id}`).not.toThrow();
    }
  }, 120000);
  it("reopens the shared module with edited native handlers, conditions and custom ID 255", () => {
    const { project } = makeBw1AbilityProject("W");
    const rules = new Map([[255, validateAbilityRule({ effects: [{ kind: "nativeAbility:22", value: -1, stat: 3 }, { kind: "nativeAbility:143", value: -1, parameters: { activationChance: 100, contactStatus: 4 } }, { kind: "abilityRecipe:knockoutSplash", value: 20 }], conditions: { kind: "group", mode: "any", children: [{ kind: "type", value: 11 }, { kind: "weather", value: 3 }] } })]]);
    const rpm = buildAbilityRuleModule(project, rules);
    expect(rpm.relocations.some(r => r.target.module === "93" && rpm.symbols[r.sourceSymbolIndex]?.name === "AbilitySwap")).toBe(true);
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: writeRpm(rpm, { ident: "DLXF" }) } };
    expect(inspectAbilityEffects(project).rules).toEqual(rules);
  });
  it("rejects other revisions, mismatched ROM identities and modified native dispatchers", () => {
    const { project, locations, base } = makeBw1AbilityProject("W");
    const bytes = project.originalRomBytes!.slice(); bytes[30] = 1;
    hydrateAbilityEffectsSource(project, new NintendoDSRom(bytes, { fileData: "view" }));
    expect(inspectAbilityEffects(project).editable).toBe(false);
    hydrateAbilityEffectsSource(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }));
    project.session.baseVersion = "B"; expect(inspectAbilityEffects(project).editable).toBe(false);
    project.session.baseVersion = "W";
    project.overlays[93]![locations.get("AbilityEvent_AddItem")! - base] ^= 1;
    expect(inspectAbilityEffects(project).editable).toBe(false);
  });
});
