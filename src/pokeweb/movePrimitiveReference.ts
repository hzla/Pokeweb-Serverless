import { MOVE_PRIMITIVES, type MoveCondition, type MovePrimitive } from "./moveRules";
import { MOVE_RECIPE_LIBRARY, type MoveRecipeTemplate } from "./moveRecipeLibrary";

export const MOVE_CONDITION_REFERENCE: Readonly<Record<Exclude<MoveCondition["kind"], "group">, { label: string; description: string }>> = {
  hp: { label: "HP", description: "Compare the Pokémon’s current HP with a percentage of its maximum HP." },
  type: { label: "Type", description: "Check whether the Pokémon has the chosen type." },
  weather: { label: "Weather", description: "Check the currently effective weather." },
  status: { label: "Condition", description: "Check the Pokémon’s condition or whether it has no major status." },
  species: { label: "Species", description: "Check the Pokémon’s species ID." },
  ability: { label: "Ability", description: "Check the Pokémon’s effective ability ID." },
  field: { label: "Field effect", description: "Check for an active native field effect." },
  effectiveness: { label: "Type effectiveness", description: "Check final type effectiveness during damage calculation." },
  targetActed: { label: "Has acted", description: "Check whether the Pokémon has already acted this turn." },
  firstTurn: { label: "First turn on field", description: "Check whether this is the Pokémon’s first turn on the field." },
  grounded: { label: "Grounded", description: "Check whether the Pokémon is grounded using native battle rules." },
  ally: { label: "Ally of user", description: "Check whether the Pokémon is on the user’s side." },
  pendingPriority: { label: "Pending attack priority", description: "Check the priority of the Pokémon’s pending attack." },
  sameMon: { label: "Same Pokémon as user", description: "Check whether the Pokémon is the move user." },
  stage: { label: "Stat stage", description: "Compare a chosen stat stage with a threshold." },
  heldItem: { label: "Held item ID", description: "Check the Pokémon’s held item ID." },
  hasItem: { label: "Holding an item", description: "Check whether the Pokémon holds an item." },
  berry: { label: "Holding a Berry", description: "Check whether the Pokémon holds a Berry." },
  hidden: { label: "Semi-invulnerable", description: "Check whether the Pokémon is in a semi-invulnerable state." },
  ateBerry: { label: "Ate a Berry this battle", description: "Check whether the Pokémon consumed a Berry earlier in this battle." },
  moveFailed: { label: "Move failed last turn", description: "Check whether the Pokémon’s previous move failed." },
  hitsTaken: { label: "Hits received at least", description: "Check how many move hits the Pokémon has received this battle." },
  partyFaints: { label: "Party faints at least", description: "Check how many Pokémon on the party have fainted this battle." },
  statRaised: { label: "Stat rose this turn", description: "Check whether the Pokémon’s stat stage rose this turn." },
  statLowered: { label: "Stat fell this turn", description: "Check whether the Pokémon’s stat stage fell this turn." },
  selectedMove: { label: "Move selected last turn", description: "Check the move the Pokémon selected on the preceding turn; zero means this move." },
  persistentFromMove: { label: "Recurring effect from move", description: "Check for a recurring effect from a move; zero means this move." },
  adjacent: { label: "Adjacent to user", description: "Check whether the Pokémon is adjacent to the user in the current battle layout." },
};

export type MovePrimitiveReferenceRow = { kind: string; category: "Effect" | "Condition"; label: string; description: string; templates: string[] };
const matchesCondition = (condition: MoveCondition, kind: string): boolean => condition.kind === "group" ? condition.children.some(child => matchesCondition(child, kind)) : condition.kind === kind;

/** The reference uses the same enabled effects and conditions as the editor. */
export function movePrimitiveReference(primitives: readonly MovePrimitive[] = MOVE_PRIMITIVES, conditions: readonly string[] = Object.keys(MOVE_CONDITION_REFERENCE), templates: readonly MoveRecipeTemplate[] = MOVE_RECIPE_LIBRARY): MovePrimitiveReferenceRow[] {
  const names = (predicate: (template: MoveRecipeTemplate) => boolean) => [...new Set(templates.filter(predicate).map(template => template.label))].sort((a, b) => a.localeCompare(b));
  const effects: MovePrimitiveReferenceRow[] = primitives.map(primitive => ({ kind: primitive.kind, category: "Effect", label: primitive.label, description: primitive.description, templates: names(template => template.rule.effects.some(effect => effect.kind === primitive.kind)) }));
  for (const [id, label, description] of [[280, "Remove opposing screens", "Remove opposing Reflect and Light Screen with the reviewed native behavior."], [364, "Break protection", "Break protection with the reviewed native behavior."]] as const) {
    const used = names(template => template.rule.nativeBase === id);
    if (used.length) effects.push({ kind: `nativeBase:${id}`, category: "Effect", label, description, templates: used });
  }
  const checks: MovePrimitiveReferenceRow[] = conditions.map(kind => {
    const info = MOVE_CONDITION_REFERENCE[kind as keyof typeof MOVE_CONDITION_REFERENCE];
    if (!info) throw Error(`Missing move condition reference: ${kind}`);
    return { kind, category: "Condition", ...info, templates: names(template => matchesCondition(template.rule.conditions, kind) || matchesCondition(template.rule.prerequisites, kind) || template.rule.effects.some(effect => matchesCondition(effect.conditions, kind))) };
  });
  return [...effects, ...checks];
}

export function filterMovePrimitiveReference(rows: readonly MovePrimitiveReferenceRow[], query: string): MovePrimitiveReferenceRow[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return rows.filter(row => { const text = [row.category, row.label, row.description, ...row.templates].join(" ").toLocaleLowerCase(); return words.every(word => text.includes(word)); });
}
