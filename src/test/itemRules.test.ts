import { describe, expect, it } from "vitest";
import { encodeItemRules, encodeItemRulesV4, validateItemRule, type ItemRuleSet } from "../pokeweb/itemRules";
import { readU16 } from "../nds/binary";
import { buildRuleRuntime, ITEM_RULE_API } from "../pokeweb/itemRuleRuntime";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";
import { buildItemTypeHealingModule, buildItemRuleModule } from "../pokeweb/itemEffectsModel";
import { ITEM_RULE_PRESETS, itemRulePreset } from "../pokeweb/itemRulePresets";
import { updateItemField } from "../pokeweb/moveItemModel";

const rule: ItemRuleSet = { effects: [{ kind: "attack", value: 2.5 }, { kind: "healDivisor", value: 3 }],
  conditions: { kind: "group", mode: "all", children: [{ kind: "hp", comparison: "lt", percent: 50 }, { kind: "group", mode: "any", children: [{ kind: "type", value: 5 }, { kind: "weather", value: 2 }] }] }, consumable: true };

describe("custom item rule configuration", () => {
  it("makes every in-battle preset a valid editable composition", () => {
    expect(ITEM_RULE_PRESETS.some(preset => [223, 319].includes(preset.id))).toBe(false);
    for (const preset of ITEM_RULE_PRESETS) expect(validateItemRule(itemRulePreset(preset.id, true)).effects.length).toBeGreaterThan(0);
    expect(itemRulePreset(220, false).effects).toEqual([{ kind: "attack", value: 1.5 }, { kind: "moveLock", value: 1 }]);
  });
  it("encodes independent timed actions and signed stages without losing their options", () => {
    const value = validateItemRule({ effects: [{ kind: "statStage", value: -2, stat: 5, trigger: "afterContact", target: "attacker", chance: 35 }, { kind: "status", value: 7, trigger: "turnEnd" }], conditions: { kind: "species", value: 25 }, consumable: true });
    const { bytes } = encodeItemRulesV4(new Map([[85, value]])), at = readU16(bytes, 170);
    expect([...bytes.slice(at, at + 8)]).toEqual([2, 1, 1, 4, 4, 0, 25, 0]);
    expect([...bytes.slice(at + 8, at + 16)]).toEqual([11, 5, 254, 255, 4, 1, 35, 0]);
    expect(() => validateItemRule({ ...value, effects: [{ kind: "statStage", value: 0 }] })).toThrow();
    expect(() => validateItemRule({ ...value, effects: [{ kind: "status", value: 4, trigger: "entry", target: "attacker" }] })).toThrow("damage trigger");
  });
  it.each([[0, 0], [0x18c0, 0x3000]])("builds the extended native library from discovered functions at shifted layouts (%i, %i)", (shift, relocate) => {
    const { project } = makeItemEffectsProject(shift, relocate, true);
    updateItemField(project, 85, "gain_values", "16");
    // The same public module builder accepts slotless rules and verifies every dependency.
    const rpm = buildItemTypeHealingModule(project, 85, 5);
    expect(rpm.metadata.PMCVersion).toBe("4.0.0");
    expect(rpm.bssSize).toBeGreaterThan(0);
    expect(rpm.relocations.filter(r => r.target.module === "167")).toHaveLength(6);
    const bss = rpm.symbols.find(symbol => symbol.name === "slots")!;
    expect(bss.address).toBeGreaterThanOrEqual(rpm.code.length);
    expect(bss.address + bss.size).toBeLessThanOrEqual(((rpm.code.length + 3) & ~3) + rpm.bssSize);
    const native = buildItemRuleModule(project, new Map([[85, { effects: [{ kind: "native:564", value: -1 }, { kind: "native:211", value: -1 }], conditions: { kind: "group", mode: "all", children: [] }, consumable: false }]]));
    expect(native.relocations.filter(r => r.target.type === "ARM_BRANCH" && r.target.module === "base")).toHaveLength(2);
    expect(native.symbols.filter(s => s.type === "FUNCTION_ARM" && !(s.attributes & 4))).toHaveLength(2);
    expect(native.symbols.some(s => s.attributes & 2)).toBe(false);
  });
  it("preserves nested AND/OR groups, multipliers, exact healing divisors and consumption", () => {
    const normalized = validateItemRule(rule);
    expect(normalized.effects).toEqual(rule.effects);
    expect(normalized.consumable).toBe(true);
    const bytes = encodeItemRules(new Map([[85, normalized], [238, { ...normalized, consumable: false }]]));
    const at = readU16(bytes, 85 * 2);
    expect([...bytes.slice(at, at + 4)]).toEqual([2, 5, 1, 0]);
    expect([...bytes.slice(at + 4, at + 24)]).toEqual([1, 0, 50, 0, 2, 0, 5, 0, 3, 0, 2, 0, 129, 2, 0, 0, 128, 2, 0, 0]);
    expect(readU16(bytes, at + 26)).toBe(10240);
    expect(readU16(bytes, at + 30)).toBe(3);
    expect(bytes[readU16(bytes, 238 * 2) + 2]).toBe(0);
    expect(readU16(bytes, 86 * 2)).toBe(0);
  });
  it("normalizes an empty root to always active and rejects empty nested groups", () => {
    expect(validateItemRule({ ...rule, conditions: { kind: "group", mode: "any", children: [] } }).conditions).toEqual({ kind: "group", mode: "all", children: [] });
    expect(() => validateItemRule({ ...rule, conditions: { kind: "group", mode: "all", children: [{ kind: "group", mode: "all", children: [] }] } })).toThrow("each group");
  });
  it.each([NaN, 0, 8.125, 1.3])("rejects an invalid Attack multiplier %s", value => {
    expect(() => validateItemRule({ ...rule, effects: [{ kind: "attack", value }] })).toThrow();
  });
  it("rejects duplicate effects, invalid predicates, excessive nesting and unsafe registry IDs", () => {
    expect(() => validateItemRule({ ...rule, effects: [rule.effects[0], rule.effects[0]] })).toThrow();
    expect(() => validateItemRule({ ...rule, conditions: { kind: "hp", comparison: "lt", percent: 101 } })).toThrow();
    let deep = rule.conditions;
    for (let i = 0; i < 5; i++) deep = { kind: "group", mode: "all", children: [deep] };
    expect(() => validateItemRule({ ...rule, conditions: deep })).toThrow();
    for (const id of [0, 640, -1, 2.5]) expect(() => encodeItemRules(new Map([[id, rule]]))).toThrow();
  });
  it("packs 100 rules and the slotless-item dispatcher into one relocatable module", () => {
    const rules = new Map(Array.from({ length: 100 }, (_, i) => [i + 85, validateItemRule(rule)]));
    const rpm = buildRuleRuntime({ game: "W2", rules, api: ITEM_RULE_API.map((_, i) => 0x021a0000 + i * 32), dispatcher: { address: 0x021c0000, code: new Uint8Array(96), calls: [{ offset: 24, address: 0x021b0000 }] } });
    const parsed = parseRpm(writeRpm(rpm, { ident: "DLXF" }), { allowedMagics: ["DLXF"] });
    expect(parsed.bssSize).toBe(0);
    expect(parsed.relocations.filter(r => r.target.module === "167")).toMatchObject([{ target: { address: 0x021c0000, type: "THUMB_BRANCH" } }]);
    expect(JSON.parse(String(parsed.metadata.PokewebItemRules))).toHaveLength(100);
    expect(parsed.code.length).toBeLessThan(8192);
  });
  it("rejects a registry that exceeds the shared DLL allocation budget", () => {
    const rules = new Map(Array.from({ length: 639 }, (_, i) => [i + 1, validateItemRule(rule)]));
    expect(() => buildRuleRuntime({ game: "W2", rules, api: ITEM_RULE_API.map(() => 0x021a0000), dispatcher: { address: 0x021c0000, code: new Uint8Array(96), calls: [] } })).toThrow(/limit|budget/u);
  });
});
