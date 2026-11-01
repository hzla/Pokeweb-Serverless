import type { ItemRuleCondition, ItemRuleSet } from "./itemRules";
import type { MoveCondition, MoveRuleSet } from "./moveRules";

type Condition = ItemRuleCondition | MoveCondition;
const always = (node: Condition) => node.kind === "group" && !node.children.length;

/** Keep OR expressions intact when adding another activation requirement. */
function appendConditions<T extends Condition>(current: T, incoming: T, maxNodes: number, maxDepth: number): T {
  let combined: Condition;
  if (always(incoming)) combined = current;
  else if (always(current)) combined = incoming;
  else {
    const children: Condition[] = [];
    for (const node of [current, incoming]) {
      if (node.kind === "group" && node.mode === "all") children.push(...node.children);
      else children.push(node);
    }
    // A full root can still fit as two intact subgroups within the same bounds.
    // Both inputs belong to the same condition vocabulary.
    combined = { kind: "group", mode: "all", children: children.length <= 8 ? children : [current, incoming] } as Condition;
  }
  let nodes = 0;
  const check = (node: Condition, depth: number): void => {
    if (++nodes > maxNodes || depth > maxDepth || node.kind === "group" && node.children.length > 8) throw Error("This template would exceed the condition limit. Remove some conditions before importing.");
    if (node.kind === "group") node.children.forEach(child => check(child, depth + 1));
  };
  check(combined, 0);
  return structuredClone(combined) as T;
}
function checkEffects(current: number, incoming: number): void {
  if (current + incoming > 16) throw Error("This template would exceed 16 effects. Remove some effects before importing.");
}

/** Ability and item editors share a form, but keep the holder's consumable setting. */
export function appendItemRuleTemplate(current: ItemRuleSet, incoming: ItemRuleSet): ItemRuleSet {
  checkEffects(current.effects.length, incoming.effects.length);
  return { ...structuredClone(current), effects: structuredClone([...current.effects, ...incoming.effects]), conditions: appendConditions(current.conditions, incoming.conditions, 31, 4) };
}

export function appendMoveRuleTemplate(current: MoveRuleSet, incoming: MoveRuleSet): MoveRuleSet {
  checkEffects(current.effects.length, incoming.effects.length);
  if (current.nativeBase && incoming.nativeBase && current.nativeBase !== incoming.nativeBase) throw Error("This template uses a different native operation. Remove the existing native operation before importing it.");
  const nativeBase = current.nativeBase ?? incoming.nativeBase;
  return {
    ...structuredClone(current),
    effects: structuredClone([...current.effects, ...incoming.effects]),
    conditions: appendConditions(current.conditions, incoming.conditions, 32, 3),
    prerequisites: appendConditions(current.prerequisites, incoming.prerequisites, 32, 3),
    ...(nativeBase === undefined ? {} : { nativeBase }),
  };
}
