import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import { abilityRuleEvents } from "../pokeweb/abilityEvents";
import { NATIVE_ABILITY_PROFILES } from "../pokeweb/abilityNativeRuntime";
import { ABILITY_IMPORT_LIBRARY } from "../pokeweb/abilityLibrary";
import { EMPTY_ABILITY_RULE, validateAbilityRule, type AbilityRuleEffect } from "../pokeweb/abilityRules";
import { ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, inspectAbilityEffects, upgradeAbilityRuntime } from "../pokeweb/abilityEffectsModel";
import { writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

const rule = (...effects: AbilityRuleEffect[]) => validateAbilityRule({ effects, conditions: EMPTY_ABILITY_RULE.conditions });
const events = (...effects: AbilityRuleEffect[]) => abilityRuleEvents(rule(...effects), NATIVE_ABILITY_PROFILES);
describe("filtered ability dispatch", () => {
  it("subscribes a conditioned passive only to its stat events and shares identical tables", () => {
    const { project } = makeItemEffectsProject(0, 0, true, true);
    const passive = { ...rule({ kind: "defense", value: 1.2 }, { kind: "speed", value: .8 }), conditions: { kind: "weather" as const, value: 3 } };
    const rpm = buildAbilityRuleModule(project, new Map([[165, passive], [255, passive]]));
    expect(rpm.metadata.PokewebAbilityDispatchVersion).toBe(2);
    const tables = rpm.symbols.find(s => s.name === "AbilityRuleEventTables")!.address;
    const counts = rpm.symbols.find(s => s.name === "AbilityRuleEventCounts")!.address;
    expect([rpm.code[counts + 165], rpm.code[counts + 255]]).toEqual([2, 2]);
    const table = (id: number) => rpm.relocations.find(r => r.target.module === "base" && r.target.address === tables + id * 4)!;
    expect(table(165).sourceSymbolIndex).toBe(table(255).sourceSymbolIndex);
    const at = rpm.symbols[table(165).sourceSymbolIndex].address;
    expect([readU32(rpm.code, at), readU32(rpm.code, at + 8)]).toEqual([0x13, 0x3c]);
    expect(rpm.relocations.filter(r => r.target.address === at + 4 || r.target.address === at + 12).map(r => rpm.symbols[r.sourceSymbolIndex].name)).toEqual(["AbilityEvent_13", "AbilityEvent_3c"]);
  });
  it("retains observer events and separates parameter-selected triggers", () => {
    expect(events({ kind: "abilityRecipe:statAction", value: 1, parameters: { activation: 2 } })).toEqual([0x4b, 0x81, 0x84]);
    expect(events({ kind: "abilityRecipe:statAction", value: 1, parameters: { activation: 5 } })).toEqual([0x03, 0x04, 0x29]);
    expect(events({ kind: "abilityRecipe:moveUserType", value: 1 })).toEqual([0x03, 0x28, 0x29]);
    expect(events({ kind: "abilityRecipe:fallenPower", value: 10 })).toEqual([0x38, 0x55, 0x8a]);
    expect(events({ kind: "abilityRecipe:knockoutSplash", value: 20 })).toEqual([0x03, 0x4b, 0x83]);
    expect(events({ kind: "abilityRecipe:weatherGuard", value: 1 })).toEqual([0x7f]);
    expect(events({ kind: "abilityRecipe:transferItem", value: 1, parameters: { mode: 1 } })).toEqual([0xa7]);
    expect(events({ kind: "abilityRecipe:auraInvert", value: 1 })).toEqual([]);
  });
  it("maps every import and keeps native subscription events", () => {
    for (const p of ABILITY_IMPORT_LIBRARY) expect(() => abilityRuleEvents(p.rule, NATIVE_ABILITY_PROFILES), p.label).not.toThrow();
    expect(events({ kind: "nativeAbility:22", value: -1 })).toEqual([0x55, 0x8a]);
    expect(events({ kind: "nativeAbility:143", value: -1 })).toEqual([0x4b]);
    expect(events({ kind: "nativeAbility:42", value: -1 })).toEqual([0x0c, 0x55, 0x8a]);
  });
  it.each(["base", "priority", "library", "recipes", "client", "weather", "scoped", "actions"])("recognizes the old %s DLL and produces an optimized replacement", name => {
    const { project } = makeItemEffectsProject(0, 0, true, true);
    const old = new Uint8Array(readFileSync(new URL(`./fixtures/ability-dispatch-legacy/${name}.dll`, import.meta.url)));
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: old } };
    const before = inspectAbilityEffects(project);
    expect(before.editable, before.message).toBe(true); expect(before.runtimeVersion).toBe(1);
    const next = buildAbilityRuleModule(project, before.rules);
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(next, { ident: "DLXF" });
    const after = inspectAbilityEffects(project);
    expect(after.editable, after.message).toBe(true); expect(after.runtimeVersion).toBe(2); expect(after.rules).toEqual(before.rules);
    delete next.metadata.PokewebAbilityDispatchVersion;
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(next, { ident: "DLXF" });
    expect(inspectAbilityEffects(project).editable).toBe(false);
  });
  it("leaves a project without an old runtime alone and rejects unverified DLLs", async () => {
    const { project } = makeItemEffectsProject(0, 0, true, true);
    expect(await upgradeAbilityRuntime(project)).toBe(false);
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: new Uint8Array([1, 2, 3]) } };
    await expect(upgradeAbilityRuntime(project)).rejects.toThrow();
    expect(project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]).toEqual(new Uint8Array([1, 2, 3]));
  });
});
