import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NintendoDSRom } from "../nds/rom";
import { readU16, readU32 } from "../nds/binary";
import { ABILITY_IMPORT_LIBRARY, abilityImport } from "../pokeweb/abilityLibrary";
import { ABILITY_RULE_PRESETS, validateAbilityRule } from "../pokeweb/abilityRules";
import { ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, hydrateAbilityEffectsSource, inspectAbilityEffects, isVerifiedAbilityClientTrapImport } from "../pokeweb/abilityEffectsModel";
import { buildItemRuleModule } from "../pokeweb/itemEffectsModel";
import { BATTLE_RUNTIME_SIGNATURES, battleRuntimeResolver } from "../pokeweb/battleRuntimeBindings";
import { isVerifiedBattleCounterImport } from "../pokeweb/battleLogModel";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

function fixture(version: "B2" | "W2", fairy: boolean) {
  const shift = version === "W2" ? 0x1000 : 0;
  const sample = makeItemEffectsProject(shift, 0, true, true);
  const address = version === "B2" ? 0x021bb368 : 0x021bb3a8;
  const result = makeItemEffectsProject(shift, address - sample.base - sample.offsets.get("IsFainted")!, true, true);
  const { project, offsets } = result;
  project.session.baseVersion = version;
  project.originalRomBytes!.set(new TextEncoder().encode(version === "B2" ? "IREO" : "IRDO"), 12);
  hydrateAbilityEffectsSource(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }));
  const path = `patches/${version === "B2" ? "Black2Upgrade" : "White2Upgrade"}BattleCounters.dll`;
  const counter = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${path.slice(8)}`, import.meta.url)));
  project.fileSystem = { replacements: {}, additions: { [path]: counter } };
  if (fairy) {
    for (const name of ["HandlerColorChange", "DoesMonHaveType"] as const) {
      const variant = BATTLE_RUNTIME_SIGNATURES[name].variants![0];
      const bytes = Uint8Array.from(Buffer.from(variant.hex, "hex"));
      const original = Uint8Array.from(Buffer.from(BATTLE_RUNTIME_SIGNATURES[name].hex, "hex"));
      for (let i = 0; i < bytes.length; i++) if (bytes[i] !== original[i]) project.overlays[167]![offsets.get(name)! + i] = bytes[i];
    }
  }
  return { ...result, path, counter, address };
}

describe("ability compatibility with battle counters and Fairy", () => {
  it.each(["B2", "W2"] as const)("routes edited Magnet Pull IDs and types through the %s client", version => {
    const { project, base, offsets } = fixture(version, true);
    const rule = validateAbilityRule({ effects: [{ kind: "nativeAbility:42", value: -1, parameters: { trapType: 17 } }], conditions: { kind: "hp", comparison: "gte", percent: 50 } });
    const rpm = buildAbilityRuleModule(project, new Map([[42, rule], [172, rule]]));
    const named = (name: string) => rpm.symbols.find(s => s.name === name)!;
    expect(rpm.metadata.PokewebAbilityClientTraps).toBe(1);
    const types = rpm.code.subarray(named("AbilityClientTrapTypes").address, named("AbilityClientTrapTypes").address + 256);
    expect([...types].flatMap((value, id) => value ? [[id, value]] : [])).toEqual([[42, 18], [172, 18]]);
    const address = base + offsets.get("IsMonTrapped")!, size = BATTLE_RUNTIME_SIGNATURES.IsMonTrapped.hex.length / 2;
    expect(rpm.relocations.find(r => r.target.module === "167" && r.target.address === address)?.sourceSymbolIndex).toBe(rpm.symbols.indexOf(named("AbilityClientTrapped")));
    const link = rpm.relocations.find(r => r.target.module === "base" && r.target.address === named("AbilityClientApi").address)!;
    const gateway = rpm.symbols[link.sourceSymbolIndex].address;
    expect([...rpm.code.subarray(gateway, gateway + 8)]).toEqual([0xf0, 0xb5, 0x85, 0xb0, 0x0e, 0x1c, 0x05, 0x1c]);
    expect(readU32(rpm.code, gateway + 12)).toBe((address + 8) | 1);
    project.fileSystem!.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(rpm, { ident: "DLXF" });
    expect(inspectAbilityEffects(project).rules).toEqual(new Map([[42, rule], [172, rule]]));
    expect(isVerifiedAbilityClientTrapImport(project, ABILITY_EFFECTS_DLL_PATH, address, size)).toBe(true);
    expect(isVerifiedAbilityClientTrapImport(project, "patches/Other.dll", address, size)).toBe(false);
    expect(isVerifiedAbilityClientTrapImport(project, ABILITY_EFFECTS_DLL_PATH, address + 2, size)).toBe(false);
    const itemRules = new Map([[85, { effects: [{ kind: "attack" as const, value: 2 }], conditions: { kind: "group" as const, mode: "all" as const, children: [] }, consumable: false }]]);
    expect(() => buildItemRuleModule(project, itemRules)).not.toThrow();
    rpm.code[named("AbilityClientTrapTypes").address + 172] = 9;
    project.fileSystem!.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(rpm, { ident: "DLXF" });
    expect(isVerifiedAbilityClientTrapImport(project, ABILITY_EFFECTS_DLL_PATH, address, size)).toBe(false);
    expect(() => buildItemRuleModule(project, itemRules)).toThrow(/Conflicting/u);
  });

  it.each(["B2", "W2"] as const)("builds every template with the %s counter and Fairy patches", version => {
    const { project, counter, path, address } = fixture(version, true);
    const overlay = project.overlays[167]!.slice();
    for (const entry of [...ABILITY_RULE_PRESETS, ...ABILITY_IMPORT_LIBRARY]) {
      const rpm = buildAbilityRuleModule(project, new Map([[165, entry.rule]]));
      expect(rpm.relocations.some(r => r.target.module === "167" && (r.target.address & ~1) === address), entry.label).toBe(false);
    }
    const rules = new Map([[165, abilityImport(234).rule], [166, validateAbilityRule(ABILITY_RULE_PRESETS.find(p => p.id === 153)!.rule)]]);
    const rpm = buildAbilityRuleModule(project, rules);
    expect(rpm.symbols.some(s => (s.attributes & 4) && s.address === address)).toBe(true);
    project.fileSystem!.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(rpm, { ident: "DLXF" });
    expect(inspectAbilityEffects(project).rules).toEqual(rules);
    expect(project.fileSystem!.additions![path]).toEqual(counter);
    expect(project.overlays[167]).toEqual(overlay);
  }, 30000);

  it.each(["B2", "W2"] as const)("preserves native and Fairy type guards in %s copies", version => {
    for (const fairy of [false, true]) {
      const { project, base, offsets } = fixture(version, fairy);
      const rule = ABILITY_RULE_PRESETS.find(p => p.id === 16)!.rule;
      const rpm = buildAbilityRuleModule(project, new Map([[165, rule]]));
      const handler = BATTLE_RUNTIME_SIGNATURES.HandlerColorChange;
      const copy = rpm.symbols.find(s => !(s.attributes & 4) && s.type === "FUNCTION_THM" && s.size === handler.hex.length / 2)!;
      expect(readU16(rpm.code, copy.address + 0x36)).toBe(fairy ? 0x2e12 : 0x2e11);
      expect(rpm.code[copy.address + 0x39]).toBe(fairy ? 0xda : 0xd0);
      const resolver = battleRuntimeResolver(project.overlays[167]!, base, project.arm9, 0x02000000);
      expect(resolver.resolve("DoesMonHaveType").address).toBe(base + offsets.get("DoesMonHaveType")!);
      project.overlays[167]![offsets.get("HandlerColorChange")! + 0x36] = 19;
      expect(() => buildAbilityRuleModule(project, new Map([[165, rule]]))).toThrow(/unrecognized or modified/u);
    }
  });

  it.each(["B2", "W2"] as const)("rejects altered, misplaced and mismatched %s counter modules", version => {
    const { project, path, counter, address } = fixture(version, true);
    const rule = ABILITY_RULE_PRESETS.find(p => p.id === 153)!.rule;
    expect(isVerifiedBattleCounterImport(version, path, counter, address)).toBe(true);
    expect(isVerifiedBattleCounterImport(version, path, counter, address + 2)).toBe(false);
    expect(isVerifiedBattleCounterImport(version === "B2" ? "W2" : "B2", path, counter, address)).toBe(false);
    const modified = counter.slice(); modified[32] ^= 1;
    for (const additions of [{ [path]: modified }, { "patches/Unknown.dll": counter }]) {
      project.fileSystem!.additions = additions;
      expect(() => buildAbilityRuleModule(project, new Map([[165, rule]]))).toThrow(/Conflicting ability service hook/u);
    }
    const changed = parseRpm(counter, { allowedMagics: ["DLXF"] });
    changed.relocations.find(r => r.target.type === "THUMB_BRANCH")!.target.address += 2;
    project.fileSystem!.additions = { [path]: writeRpm(changed, { ident: "DLXF" }) };
    expect(() => buildAbilityRuleModule(project, new Map([[165, rule]]))).toThrow(/Conflicting ability service hook/u);
  });
});
