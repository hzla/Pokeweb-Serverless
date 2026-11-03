import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { ABILITY_EFFECTS_DLL_PATH, configureAbilityRuleSets, inspectAbilityEffects } from "../pokeweb/abilityEffectsModel";
import { EMPTY_ABILITY_RULE, type AbilityRuleSet } from "../pokeweb/abilityRules";
import { optimizeAbilityRule } from "../pokeweb/abilityRecipeOptimization";
import { buildAbilityRuleModule } from "../pokeweb/abilityEffectsModel";
import { writeRpm } from "../pokeweb/rpm";
import { getAbilityDescription, getAbilitySummaryName } from "../pokeweb/abilityTextModel";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { makeBw1AbilityProject } from "./fixtures/blackAbilityProject";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

function addTexts(project: ProjectState) {
  const bw = project.session.baseRom === "BW", ids = bw ? [182, 183, 285] : [374, 375, 487];
  const narc = new NARC();
  narc.files = Array.from({ length: Math.max(...ids) + 1 }, () => new Uint8Array());
  for (const id of ids) narc.files[id] = encodeGen5TextBank(Array.from({ length: 256 }, (_, i): Gen5TextEntry => [`0_${i}`, id === ids[1] ? `Description ${i}` : `Ability ${i}`, 0]));
  project.narcs.message_texts = createNarcStore("message_texts", "texts", 1, narc);
  project.texts.banks.abilities = Array.from({ length: 256 }, (_, i) => `Ability ${i}`);
}

describe("ability text-only applies", () => {
  it.each(["B", "W", "W2"] as const)("renames native abilities in %s without installing or changing battle code", async version => {
    const { project } = version === "W2" ? makeItemEffectsProject(0, 0, true, true) : makeBw1AbilityProject(version);
    addTexts(project);
    const arm9 = project.arm9.slice(), overlays = structuredClone(project.overlays);
    const rules: AbilityRuleSet = { effects: [{ kind: "nativeAbility:22", value: -1 }], conditions: EMPTY_ABILITY_RULE.conditions };
    await configureAbilityRuleSets(project, [{ abilityId: 22, name: "Scare", description: "A new description.", rules }]);
    expect(project.texts.banks.abilities![22]).toBe("Scare");
    expect(getAbilitySummaryName(project, 22)).toBe("Scare");
    expect(getAbilityDescription(project, 22)).toBe("A new description.");
    expect(project.arm9).toEqual(arm9); expect(project.overlays).toEqual(overlays);
    expect(project.fileSystem).toBeUndefined(); expect(project.codeInjection).toBeUndefined();
    expect(inspectAbilityEffects(project).rules.size).toBe(0);
  });

  it("keeps an older custom runtime byte-for-byte when applying only text", async () => {
    const { project } = makeItemEffectsProject(0, 0, true, true);
    addTexts(project);
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/ability-runtime-v6/base.dll", import.meta.url)));
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: bytes } };
    const before = inspectAbilityEffects(project);
    expect(before).toMatchObject({ editable: true, runtimeVersion: 6 });
    const [id, rules] = [...before.rules][0];
    await configureAbilityRuleSets(project, [{ abilityId: id, name: "Renamed", rules: structuredClone(rules) }]);
    expect(project.texts.banks.abilities![id]).toBe("Renamed");
    expect(project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]).toEqual(bytes);
    expect(project.codeInjection).toBeUndefined();
    expect(inspectAbilityEffects(project)).toMatchObject({ editable: true, runtimeVersion: 6, rules: before.rules });
  });

  it("does not rebuild when the UI consolidates equivalent effects during a rename", async () => {
    const { project } = makeItemEffectsProject(0, 0, true, true);addTexts(project);
    const rules:AbilityRuleSet={effects:[7,11,12,13,15,23].map(condition=>({kind:"abilityRecipe:statusGuard",value:1,parameters:{condition,scope:1}})),conditions:{kind:"weather",value:1}};
    const bytes=writeRpm(buildAbilityRuleModule(project,new Map([[165,rules]])),{ident:"DLXF"});
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:bytes}};
    const before=inspectAbilityEffects(project);expect(before.editable,before.message).toBe(true);
    const shown=optimizeAbilityRule(before.rules.get(165)!);shown.conditions={kind:"group",mode:"all",children:[shown.conditions]};
    expect(shown.effects).toHaveLength(1);
    await configureAbilityRuleSets(project,[{abilityId:165,name:"Aroma Rename",rules:shown}]);
    expect(project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]).toEqual(bytes);
    expect(inspectAbilityEffects(project).rules).toEqual(before.rules);
    expect(project.texts.banks.abilities![165]).toBe("Aroma Rename");
  });

  it("rejects invalid text atomically without changing the installed recipe or text banks", async () => {
    const { project } = makeItemEffectsProject(0, 0, true, true);
    addTexts(project);
    const before = structuredClone(project.texts);
    const rules: AbilityRuleSet = { effects: [{ kind: "nativeAbility:22", value: -1 }], conditions: EMPTY_ABILITY_RULE.conditions };
    await expect(configureAbilityRuleSets(project, [{ abilityId: 22, name: "Scare", description: "VAR(", rules }])).rejects.toThrow();
    expect(project.texts).toEqual(before);
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
    expect(project.fileSystem).toBeUndefined();
  });
});
