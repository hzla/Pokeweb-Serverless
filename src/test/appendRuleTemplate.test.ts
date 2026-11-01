import { describe, expect, it } from "vitest";
import { appendItemRuleTemplate, appendMoveRuleTemplate } from "../pokeweb/appendRuleTemplate";
import { abilityImport } from "../pokeweb/abilityLibrary";
import { validateAbilityRule } from "../pokeweb/abilityRules";
import { itemRulePreset } from "../pokeweb/itemRulePresets";
import { validateItemRule, type ItemRuleCondition, type ItemRuleSet } from "../pokeweb/itemRules";
import { moveRecipeTemplate } from "../pokeweb/moveRecipeLibrary";
import { EMPTY_MOVE_RULE, MOVE_ALWAYS, newMoveEffect, validateMoveRule, type MoveCondition } from "../pokeweb/moveRules";

const itemAlways = (): ItemRuleCondition => ({ kind: "group", mode: "all", children: [] });
const itemDraft = (): ItemRuleSet => ({ effects: [{ kind: "healDivisor", value: 8 }], conditions: itemAlways(), consumable: false });
const moveDraft = () => ({ ...structuredClone(EMPTY_MOVE_RULE), effects: [{ ...newMoveEffect("power"), value: 1.7 }] });

describe("append effect templates", () => {
  it("keeps a new move's activation conditions independent from its use prerequisites", () => {
    const current = moveDraft();
    if (current.conditions.kind === "group") current.conditions.children.push({ kind: "weather", value: 3 });
    expect(current.prerequisites).toEqual(MOVE_ALWAYS);
    expect(EMPTY_MOVE_RULE.conditions).toEqual(MOVE_ALWAYS);
  });
  it.each([false, true])("preserves item edits and consumable=%s when adding a preset", consumable => {
    const current = { ...itemDraft(), consumable, conditions: { kind: "type", value: 5 } as ItemRuleCondition };
    const before = structuredClone(current), imported = itemRulePreset(220, !consumable);
    const combined = appendItemRuleTemplate(current, imported);
    expect(combined.effects.map(effect => effect.kind)).toEqual(["healDivisor", "attack", "moveLock"]);
    expect(combined.effects[0].value).toBe(8); expect(combined.conditions).toEqual(current.conditions);
    expect(combined.consumable).toBe(consumable); expect(current).toEqual(before);
    expect(() => validateItemRule(combined)).not.toThrow();
    combined.effects[1].value = 2.5; expect(imported.effects[0].value).toBe(1.5);
  });
  it("keeps copied ability edits and appends the imported primitive and condition", () => {
    const current: ItemRuleSet = { effects: [{ kind: "nativeAbility:22", value: -1, stat: 3, bypassable: false }], conditions: { kind: "hp", comparison: "lt", percent: 50 }, consumable: false };
    const imported = { ...structuredClone(abilityImport(202).rule), consumable: false };
    const combined = appendItemRuleTemplate(current, imported);
    expect(combined.effects).toEqual([...current.effects, ...imported.effects]);
    expect(combined.conditions).toEqual({ kind: "group", mode: "all", children: [current.conditions, imported.conditions] });
    expect(() => validateAbilityRule(combined)).not.toThrow();
    combined.effects[0].stat = 4; expect(current.effects[0].stat).toBe(3);
  });
  it("imports into a blank ability without adding empty groups", () => {
    const imported = { ...structuredClone(abilityImport(177).rule), consumable: false };
    const combined = appendItemRuleTemplate({ effects: [], conditions: itemAlways(), consumable: false }, imported);
    expect(combined).toEqual(imported);
  });
  it("fills blank move and item drafts with only the imported effects", () => {
    const importedMove = moveRecipeTemplate(788)!.rule;
    expect(appendMoveRuleTemplate({ ...moveDraft(), effects: [] }, importedMove)).toEqual(importedMove);
    const importedItem = itemRulePreset(234, false);
    expect(appendItemRuleTemplate({ ...itemDraft(), effects: [] }, importedItem)).toEqual(importedItem);
    expect(() => validateMoveRule(appendMoveRuleTemplate({ ...moveDraft(), effects: [] }, moveRecipeTemplate(660)!.rule))).not.toThrow();
  });
  it("preserves AND/OR expressions and adds another whole expression with AND", () => {
    const left: ItemRuleCondition = { kind: "group", mode: "any", children: [{ kind: "weather", value: 2 }, { kind: "type", value: 5 }] };
    const right: ItemRuleCondition = { kind: "group", mode: "any", children: [{ kind: "hp", comparison: "lt", percent: 50 }, { kind: "weather", value: 3 }] };
    const combined = appendItemRuleTemplate({ ...itemDraft(), conditions: left }, { ...itemDraft(), conditions: right });
    expect(combined.conditions).toEqual({ kind: "group", mode: "all", children: [left, right] });
    const evaluate = (node: ItemRuleCondition, weather: number, type: number, hp: number): boolean => node.kind === "group" ? node.mode === "all" ? node.children.every(c => evaluate(c, weather, type, hp)) : node.children.some(c => evaluate(c, weather, type, hp)) : node.kind === "weather" ? weather === node.value : node.kind === "type" ? type === node.value : node.kind === "hp" && hp < node.percent;
    for (const weather of [0, 2, 3]) for (const type of [0, 5]) for (const hp of [20, 80]) expect(evaluate(combined.conditions, weather, type, hp)).toBe(evaluate(left, weather, type, hp) && evaluate(right, weather, type, hp));
  });
  it("appends move effects without changing edited parameters or their local conditions", () => {
    const current = moveDraft(); current.effects[0].conditions = { kind: "weather", value: 3 };
    const imported = structuredClone(moveRecipeTemplate(788)!.rule), before = structuredClone(current);
    const combined = appendMoveRuleTemplate(current, imported);
    expect(combined.effects).toEqual([...current.effects, ...imported.effects]);
    expect(combined.effects[0].value).toBe(1.7); expect(current).toEqual(before);
    expect(() => validateMoveRule(combined)).not.toThrow();
    combined.effects[1].conditions = structuredClone(MOVE_ALWAYS);
    expect(imported.effects[0].conditions).not.toEqual(MOVE_ALWAYS);
  });
  it("retains existing move prerequisites and adds an imported prerequisite", () => {
    const current = moveDraft(); current.prerequisites = { kind: "ateBerry", subject: "user", value: 1 };
    const imported = moveRecipeTemplate(660)!.rule;
    const combined = appendMoveRuleTemplate(current, imported);
    expect(combined.effects).toEqual(current.effects);
    expect(combined.prerequisites).toEqual({ kind: "group", mode: "all", children: [current.prerequisites, ...(imported.prerequisites.kind === "group" ? imported.prerequisites.children : [imported.prerequisites])] });
    expect(() => validateMoveRule(combined)).not.toThrow();
  });
  it("preserves a native move operation and refuses a conflicting operation atomically", () => {
    const current = { ...moveDraft(), nativeBase: 280 }, before = structuredClone(current);
    expect(appendMoveRuleTemplate(current, moveRecipeTemplate(565)!.rule).nativeBase).toBe(280);
    expect(appendMoveRuleTemplate(current, moveRecipeTemplate(706)!.rule).nativeBase).toBe(280);
    expect(appendMoveRuleTemplate(moveDraft(), moveRecipeTemplate(706)!.rule).nativeBase).toBe(280);
    expect(() => appendMoveRuleTemplate(current, moveRecipeTemplate(593)!.rule)).toThrow(/different native operation/);
    expect(current).toEqual(before);
  });
  it("rejects effect and condition overflows while leaving the draft and template intact", () => {
    const current = { ...moveDraft(), effects: Array.from({ length: 16 }, () => newMoveEffect()) }, before = structuredClone(current);
    expect(() => appendMoveRuleTemplate(current, moveRecipeTemplate(565)!.rule)).toThrow(/16 effects/);
    expect(current).toEqual(before);
    const item = { ...itemDraft(), effects: Array.from({ length: 16 }, () => itemDraft().effects[0]) };
    expect(() => appendItemRuleTemplate(item, itemRulePreset(234, false))).toThrow(/16 effects/);
    let deep: MoveCondition = { kind: "weather", value: 2 };
    for (let i = 0; i < 3; i++) deep = { kind: "group", mode: "any", children: [deep] };
    const nested = { ...moveDraft(), conditions: deep }, saved = structuredClone(nested);
    expect(() => appendMoveRuleTemplate(nested, { ...moveDraft(), conditions: { kind: "weather", value: 3 } })).toThrow(/condition limit/);
    expect(nested).toEqual(saved);
  });
});
