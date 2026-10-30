import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { ABILITY_NATIVE_EFFECTS, ABILITY_RULE_EFFECTS, encodeAbilityRules, validateAbilityRule, type AbilityRuleSet } from "../pokeweb/abilityRules";
import { buildAbilityRuleModule, inspectAbilityEffects, ABILITY_EFFECTS_DLL_PATH } from "../pokeweb/abilityEffectsModel";
import { needsAbilityActionRuntime } from "../pokeweb/abilityActionEffects";
import { writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";
import { renderItemRuleForm } from "../ui/itemRuleEditor";

const all = { kind: "group" as const, mode: "all" as const, children: [] };
const indignation = validateAbilityRule({ effects: [{ kind: "abilityRecipe:statAction", value: -1, parameters: { activation: 1, stat: 8, statSource: 1, scope: 2 } }], conditions: all });
const pressure = validateAbilityRule({ effects: [
  { kind: "abilityRecipe:statAction", value: 1, parameters: { activation: 5, stat: 3, moveClass: 9, type: 10 } },
  { kind: "abilityRecipe:statAction", value: -1, parameters: { activation: 5, stat: 5, moveClass: 9, type: 10 } },
], conditions: all });
const glory = validateAbilityRule({ effects: [{ kind: "abilityRecipe:knockoutSplash", value: 20 }, { kind: "nativeAbility:104", value: -1 }], conditions: all });

describe("ability action primitives", () => {
  it("extends stat records without changing older highest-stat or trigger encodings", () => {
    const old = validateAbilityRule({ effects: [{ kind: "abilityRecipe:statAction", value: 1, parameters: { activation: 4, stat: 8 } }], conditions: all });
    for (const [rule, trigger, source] of [[old, 4, 0], [indignation, 1, 1], [pressure, 5, 0]] as const) {
      const bytes = encodeAbilityRules(new Map([[255, rule]])), start = readU16(bytes, 510) + 8;
      expect(bytes[start]).toBe(136); expect(bytes[start + 1]).toBe(trigger); expect(bytes[start + 14]).toBe(source);
    }
    expect(old.effects.some(needsAbilityActionRuntime)).toBe(false);
    expect(indignation.effects.some(needsAbilityActionRuntime)).toBe(true);
    expect(pressure.effects.some(needsAbilityActionRuntime)).toBe(true);
    const bytes = encodeAbilityRules(new Map([[165, glory]]));
    expect(Array.from(bytes.slice(520, 524))).toEqual([164, 0, 208, 7]);
  });

  it("validates per-target selection, move timing and the adjustable damage basis", () => {
    for (const hpBasis of [0, 1]) expect(() => validateAbilityRule({ ...glory, effects: [{ kind: "abilityRecipe:knockoutSplash", value: 12.34, parameters: { hpBasis } }] })).not.toThrow();
    for (const effect of [
      { kind: "abilityRecipe:statAction", value: 1, parameters: { activation: 6 } },
      { kind: "abilityRecipe:statAction", value: 1, parameters: { statSource: 2 } },
      { kind: "abilityRecipe:knockoutSplash", value: 0 },
      { kind: "abilityRecipe:knockoutSplash", value: 100.01 },
      { kind: "abilityRecipe:knockoutSplash", value: 20, parameters: { hpBasis: 2 } },
    ]) expect(() => validateAbilityRule({ effects: [effect as never], conditions: all })).toThrow();
  });

  it.each([[0, 0, false], [0x1800, 0x3000, false], [0, 0, true], [0x1800, 0x3000, true]])("reopens one shared DLL with shifted layout %i/%i and client adapter %s", (shift, move, client) => {
    const { project } = makeItemEffectsProject(Number(shift), Number(move), true, true);
    const rules = new Map<number, AbilityRuleSet>([[165, indignation], [166, glory], [167, pressure]]);
    if (client) rules.set(255, validateAbilityRule({ effects: [{ kind: "nativeAbility:42", value: -1 }], conditions: all }));
    const rpm = buildAbilityRuleModule(project, rules);
    expect(rpm.metadata.PokewebAbilityActions).toBe(1); expect(rpm.metadata.PokewebAbilityScoped).toBe(1);
    expect(rpm.bssSize).toBeLessThanOrEqual(16384); expect(rpm.code.length + rpm.bssSize).toBeLessThanOrEqual(65536);
    expect(writeRpm(rpm, { ident: "DLXF" }).length + rpm.code.length + rpm.bssSize).toBeLessThanOrEqual(112 * 1024);
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: writeRpm(rpm, { ident: "DLXF" }) } };
    expect(inspectAbilityEffects(project).rules).toEqual(rules);
    delete rpm.metadata.PokewebAbilityActions;
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(rpm, { ident: "DLXF" });
    expect(inspectAbilityEffects(project).editable).toBe(false);
  });

  it("renders the new controls only where applicable", () => {
    const { project } = makeItemEffectsProject();
    const html = (rule: AbilityRuleSet) => renderItemRuleForm(project, { ...rule, consumable: false }, { ability: true, definitions: [...ABILITY_RULE_EFFECTS, ...ABILITY_NATIVE_EFFECTS] });
    expect(html(indignation)).toContain("Highest stat of"); expect(html(indignation)).toContain("Each target");
    expect(html(pressure)).toContain("After using a move"); expect(html(pressure)).toContain('data-rule-native-parameter="type"');
    expect(html(pressure)).not.toContain("Highest stat of");
    expect(html(glory)).toContain("Defeated opponent"); expect(html(glory)).toContain("Each receiving ally");
  });
});
