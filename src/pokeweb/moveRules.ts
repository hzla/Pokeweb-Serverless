/** Move-local recipes. Native move data continues to own ordinary attack properties. */
export type MoveSubject = "user" | "target";
export type MoveCondition =
  | { kind: "group"; mode: "all" | "any"; children: MoveCondition[] }
  | { kind: "hp"; subject: MoveSubject; comparison: "lt" | "lte" | "gt" | "gte"; percent: number }
  | { kind: "type" | "status" | "species" | "ability"; subject: MoveSubject; value: number; negate?: boolean }
  | { kind: "weather" | "field" | "effectiveness" | "targetActed" | "firstTurn" | "grounded" | "ally" | "pendingPriority" | "sameMon"; subject?: MoveSubject; value: number; negate?: boolean };
export const MOVE_ALWAYS: MoveCondition = { kind: "group", mode: "all", children: [] };
export const MOVE_PHASES = ["power", "damage", "accuracy", "check", "hit", "afterMove", "status", "knockout", "hitSide", "afterRealHits"] as const;
export type MovePhase = typeof MOVE_PHASES[number];
export type MoveTarget = "user" | "target" | "allies" | "opponents" | "all";
export type MoveEffect = {
  kind: string;
  value: number;
  phase: MovePhase;
  target: MoveTarget;
  chance: number;
  secondary: boolean;
  conditions: MoveCondition;
  parameters?: Record<string, number>;
};
export type MoveRuleSet = { conditions: MoveCondition; prerequisites: MoveCondition; effects: MoveEffect[]; nativeBase?: number };
export type MoveParameter = { key: string; label: string; min: number; max: number; original: number; labels?: Record<number, string> };
export type MovePrimitive = {
  kind: string; code: number; label: string; description: string; value: number; min: number; max: number; step: number;
  scale: number; unit: string; phases: readonly MovePhase[]; parameters: MoveParameter[];
};
const parameter = (key: string, label: string, original: number, min: number, max: number, labels?: Record<number, string>): MoveParameter => ({ key, label, original, min, max, labels });
export const MOVE_STAT_LABELS: Record<number, string> = { 1: "Attack", 2: "Defense", 3: "Sp. Atk", 4: "Sp. Def", 5: "Speed", 6: "Accuracy", 7: "Evasion" };
const primitive = (kind: string, code: number, label: string, description: string, value: number, min: number, max: number, step: number, scale: number, unit: string, phases: readonly MovePhase[], parameters: MoveParameter[] = []): MovePrimitive => ({ kind, code, label, description, value, min, max, step, scale, unit, phases, parameters });
export const MOVE_PRIMITIVES: readonly MovePrimitive[] = [
  primitive("power", 1, "Power multiplier", "Multiply this move’s power when its conditions match.", 2, .125, 8, .001, 4096, "×", ["power"]),
  primitive("damage", 2, "Damage multiplier", "Multiply damage at the native final modifier stage.", 1.333333, .125, 8, .000001, 4096, "×", ["damage"]),
  primitive("accuracy", 3, "Skip accuracy roll", "Skip the accuracy roll; protection and invulnerability still apply.", 1, 1, 1, 1, 1, "", ["accuracy"]),
  primitive("statStage", 4, "Change stat stages", "Apply native stat changes to the chosen recipients.", 1, -6, 6, 1, 1, "stages", ["hit", "afterMove", "status", "knockout"], [parameter("stat", "Stat", 1, 1, 7, MOVE_STAT_LABELS)]),
  primitive("heal", 5, "Heal maximum HP fraction", "Heal an exact fraction of maximum HP, rounded down.", 1, 1, 100, 1, 1, "parts", ["status", "afterMove"], [parameter("denominator", "Out of", 2, 1, 100)]),
  primitive("cure", 6, "Cure a condition", "Cure the selected native condition, or all major status conditions.", 0, 0, 6, 1, 1, "condition", ["status", "afterMove", "afterRealHits", "hit"]),
  primitive("stages", 7, "Reset or invert stat stages", "Reset stages to neutral, or reverse positive and negative stages.", 0, 0, 1, 1, 1, "", ["status", "afterMove", "hitSide"], [parameter("operation", "Operation", 0, 0, 1, { 0: "Reset", 1: "Invert" })]),
  primitive("native", 8, "Native move operation", "Run one reviewed native move operation at its original event boundary.", 115, 1, 559, 1, 1, "move", ["status", "afterMove", "hitSide"]),
  primitive("hpPower", 9, "Power from current HP", "Scale maximum power by the selected Pokémon’s current HP, with a minimum of one.", 100, 1, 255, 1, 1, "max power", ["power"]),
  primitive("ignoreStages", 10, "Ignore defensive stat stages", "Ignore the target’s defensive and evasion stages for this move.", 1, 1, 1, 1, 1, "", ["damage"]),
  primitive("status", 11, "Inflict a condition", "Apply a native condition with its normal prevention checks.", 4, 1, 6, 1, 1, "condition", ["hit", "status"]),
  primitive("flinch", 12, "Flinch chance", "Roll flinching once per successful hit, with native prevention checks.", 100, 0, 100, 1, 1, "%", ["hit"]),
];
export const MOVE_STATUS_LABELS: Record<number,string> = {1:"Paralysis",2:"Sleep",3:"Freeze",4:"Burn",5:"Poison",6:"Confusion"};
export const MOVE_EFFECT_VALUE_LABELS: Record<string,Record<number,string>> = {
 status: MOVE_STATUS_LABELS, cure: {0:"All major status",...MOVE_STATUS_LABELS}, native: {113:"Light Screen",115:"Reflect",215:"Heal Bell"},
};
export function moveEffectTargets(kind: string): readonly MoveTarget[] {
 if(["power","damage","accuracy","ignoreStages","native"].includes(kind))return ["user"];
 if(kind==="hpPower")return ["user","target"];
 if(kind==="flinch")return ["target"];
 return ["user","target","allies","opponents","all"];
}
export const MOVE_NATIVE_OPERATIONS = [113, 115, 215] as const;
// Further aliases need their generic-effect data and sequencing reviewed together.
export const MOVE_NATIVE_BASES = [280] as const;
export const movePrimitive = (kind: string) => MOVE_PRIMITIVES.find(p => p.kind === kind);
export function movePhaseMatchesCategory(phase: MovePhase, category: number): boolean { return category === 0 ? phase === "status" : phase !== "status"; }
export function validateMoveRuleCategory(rule: MoveRuleSet, category: number): void {
  if (!integer(category,0,2) || category===0 && rule.nativeBase || rule.effects.some(e=>!movePhaseMatchesCategory(e.phase,category))) throw Error("Choose effect timings that match the move’s Status, Physical or Special category.");
}
export function newMoveEffect(kind = "power"): MoveEffect {
  const p = movePrimitive(kind); if (!p) throw Error("Unknown move primitive.");
  return { kind, value: p.value, phase: p.phases[0], target: kind === "flinch" ? "target" : "user", chance: 100, secondary: kind === "flinch", conditions: structuredClone(MOVE_ALWAYS) };
}
export const EMPTY_MOVE_RULE: MoveRuleSet = { conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS, effects: [newMoveEffect()] };
const integer = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
export function validateMoveCondition(input: MoveCondition): MoveCondition {
  let nodes = 0;
  function visit(c: MoveCondition, depth: number): MoveCondition {
    if (!c || ++nodes > 32 || depth > 3) throw Error("Move conditions exceed their nesting or node limit.");
    if (c.kind === "group") {
      if (!["all", "any"].includes(c.mode) || !Array.isArray(c.children) || c.children.length > 8) throw Error("Invalid move condition group.");
      return { kind: c.kind, mode: c.children.length ? c.mode : "all", children: c.children.map(child => visit(child, depth + 1)) };
    }
    if (c.kind === "hp") {
      if (!["user", "target"].includes(c.subject) || !["lt", "lte", "gt", "gte"].includes(c.comparison) || !integer(c.percent, 0, 100)) throw Error("Invalid HP condition.");
      return { kind: c.kind, subject: c.subject, comparison: c.comparison, percent: c.percent };
    }
    const ranges: Record<string, [number, number]> = { type: [0, 17], status: [0, 35], species: [1, 65534], ability: [1, 255], weather: [0, 4], field: [1, 8], effectiveness: [0, 5], targetActed: [0, 1], firstTurn: [0, 1], grounded: [0, 1], ally: [0, 1], pendingPriority: [-7, 7], sameMon: [0, 1] };
    const bounds = ranges[c.kind];
    if (!bounds || !integer(c.value, ...bounds) || c.subject !== undefined && !["user", "target"].includes(c.subject) || c.negate !== undefined && typeof c.negate !== "boolean") throw Error("Invalid move condition.");
    return { kind: c.kind, ...(c.kind === "weather" || c.kind === "field" ? {} : { subject: c.subject ?? "target" }), value: c.value, ...(c.negate ? { negate: true } : {}) } as MoveCondition;
  }
  return visit(input, 0);
}
export function validateMoveRule(input: MoveRuleSet): MoveRuleSet {
  if (!input || !Array.isArray(input.effects) || input.effects.length > 16 || !input.effects.length && !input.nativeBase && input.prerequisites?.kind === "group" && !input.prerequisites.children.length) throw Error("Choose an effect, a prerequisite or a native base behavior.");
  if (input.nativeBase !== undefined && !(MOVE_NATIVE_BASES as readonly number[]).includes(input.nativeBase)) throw Error("Unreviewed native move base.");
  const conditions=validateMoveCondition(input.conditions),prerequisites=validateMoveCondition(input.prerequisites);
  const usesEffectiveness=(c:MoveCondition):boolean=>c.kind==="group"?c.children.some(usesEffectiveness):c.kind==="effectiveness";
  if(usesEffectiveness(prerequisites))throw Error("Type effectiveness is available at the final damage stage, after use prerequisites.");
  if(!input.effects.length && !(conditions.kind==="group"&&!conditions.children.length))throw Error("Activation conditions require a recipe effect. Use prerequisites to restrict the whole move.");
  const identities = new Set<string>();
  const needsRecipient = (c: MoveCondition): boolean => c?.kind === "group" ? c.children.some(needsRecipient) : !!c && !["weather","field"].includes(c.kind) && (c.subject ?? "target") === "target";
  const effects = input.effects.map(e => {
    const p = movePrimitive(e?.kind);
    if (!p || !Number.isFinite(e.value) || e.value < p.min || e.value > p.max || Math.abs(e.value / p.step - Math.round(e.value / p.step)) > 1e-7 || e.kind === "statStage" && !e.value) throw Error("Invalid move effect value.");
    const effectConditions=validateMoveCondition(e.conditions);
    if(e.kind!=="damage" && (usesEffectiveness(conditions)||usesEffectiveness(effectConditions)))throw Error("Type effectiveness conditions require a final damage multiplier effect.");
    if (!p.phases.includes(e.phase) || !moveEffectTargets(e.kind).includes(e.target) || !integer(e.chance, 1, 100) || typeof e.secondary !== "boolean") throw Error("Invalid move effect timing, target or chance.");
    if (["power","damage","accuracy","hpPower","ignoreStages"].includes(e.kind) && e.chance !== 100) throw Error("Calculation effects do not roll an effect chance.");
    if (e.kind === "flinch" && (e.chance !== 100 || !e.secondary || e.target !== "target")) throw Error("Flinch uses its own percentage and must target move recipients as a secondary effect.");
    if (e.secondary && !["user","target"].includes(e.target)) throw Error("Secondary effects target the user or each move recipient.");
    if (e.secondary && e.phase !== "hit") throw Error("Secondary effects must use the successful-hit boundary.");
    if (e.kind === "native" && e.target !== "user") throw Error("Native party and side operations run once for the user.");
    if (e.kind === "native" && !(MOVE_NATIVE_OPERATIONS as readonly number[]).includes(e.value)) throw Error("Unreviewed native move operation.");
    if (e.kind === "accuracy" && (needsRecipient(conditions) || needsRecipient(effectConditions))) throw Error("Accuracy bypass conditions can inspect the user, weather or field; this native event has no recipient.");
    if (e.kind === "heal" && e.value > (e.parameters?.denominator ?? 2)) throw Error("A healing fraction cannot exceed maximum HP.");
    const parameters: Record<string, number> = {};
    for (const [key, value] of Object.entries(e.parameters ?? {})) {
      const def = p.parameters.find(p => p.key === key);
      if (!def || !integer(value, def.min, def.max)) throw Error(`Invalid move parameter: ${key}`);
      parameters[key] = value;
    }
    const result: MoveEffect = { kind: e.kind, value: e.kind === "stages" ? parameters.operation ?? 0 : e.value, phase: e.phase, target: e.target, chance: e.chance, secondary: e.secondary, conditions: effectConditions, ...(Object.keys(parameters).length ? { parameters } : {}) };
    const identity = JSON.stringify(result); if (identities.has(identity)) throw Error("Remove duplicate move effects."); identities.add(identity);
    return result;
  });
  return { conditions, prerequisites, effects, ...(input.nativeBase === undefined ? {} : { nativeBase: input.nativeBase }) };
}
export const MOVE_PHASE_EVENTS: Record<MovePhase, number> = { power: 0x37, damage: 0x47, accuracy: 0x32, check: 0x1f, hit: 0x4b, afterMove: 0x84, status: 0xa0, knockout: 0x83, hitSide: 0x4d, afterRealHits: 0x83 };
export function checkedMoveEventList(events:Iterable<number>):number[]{
 const list=[...new Set(events)].sort((a,b)=>a-b);
 if(list.some(e=>!Number.isInteger(e)||e<0||e>0xa5||e===0x7a))throw Error("Move recipes cannot subscribe to weather-query or unsupported native events.");
 return list;
}
/** Small per-move event tables prevent condition queries on unrelated battle events. */
export function moveRecipeEvents(input: MoveRuleSet): number[] {
  const rule = validateMoveRule(input), events = new Set(rule.effects.flatMap(e => e.kind === "ignoreStages" ? [0x3a, 0x33] : e.phase === "status" ? [0xa0,0xa1] : [MOVE_PHASE_EVENTS[e.phase]]));
  const check = movePrerequisiteEvent(rule.prerequisites); if (check) events.add(check);
  return checkedMoveEventList(events);
}
/** Recipient requirements run after native targeting; user-only checks can fail early. */
export function movePrerequisiteEvent(c: MoveCondition): number {
  if (c.kind === "group" && !c.children.length) return 0;
  const targeted = (n: MoveCondition): boolean => n.kind === "group" ? n.children.some(targeted) : !["weather", "field"].includes(n.kind) && (n.subject ?? "target") === "target";
  return targeted(c) ? 0x2c : 0x1f;
}
export const MOVE_CONDITION_CODES: Record<string, number> = { hp: 1, type: 2, weather: 3, species: 4, status: 5, ability: 6, field: 7, effectiveness: 8, targetActed: 9, firstTurn: 10, grounded: 11, ally: 12, pendingPriority: 13, sameMon: 14 };
export function encodeMoveConditions(condition: MoveCondition): number[] {
  const bytes: number[] = [];
  function emit(c: MoveCondition) {
    if (c.kind === "group") { bytes.push(c.mode === "all" ? 128 : 129, c.children.length, 0, 0, 0, 0, 0, 0); c.children.forEach(emit); }
    else {
      const v = c.kind === "hp" ? c.percent : c.value;
      bytes.push(MOVE_CONDITION_CODES[c.kind], c.subject === "user" ? 0 : 1, c.kind === "hp" ? ["lt", "lte", "gt", "gte"].indexOf(c.comparison) : Number(Boolean(c.negate)), 0, v & 255, v >> 8 & 255, 0, 0);
    }
  }
  emit(validateMoveCondition(condition)); return bytes;
}
export function encodeMoveRules(entries: ReadonlyMap<number, MoveRuleSet>): Uint8Array {
  const sorted = [...entries].sort(([a], [b]) => a - b), bytes: number[] = Array(4 + sorted.length * 16).fill(0);
  bytes[0] = sorted.length & 255; bytes[1] = sorted.length >> 8; bytes[2] = 1;
  for (const [index, [id, input]] of sorted.entries()) {
    if (!integer(id, 1, 65534)) throw Error("Move IDs must fit the ROM's move range.");
    const rule = validateMoveRule(input), at = bytes.length, global = encodeMoveConditions(rule.conditions), requirements = encodeMoveConditions(rule.prerequisites);
    const entry = 4 + index * 16; bytes[entry] = id & 255; bytes[entry + 1] = id >> 8;
    for (let k = 0; k < 4; ++k) bytes[entry + 4 + k] = at >>> k * 8 & 255;
    bytes.push(rule.effects.length, global.length / 8, requirements.length / 8, movePrerequisiteEvent(rule.prerequisites), (rule.nativeBase ?? 0) & 255, (rule.nativeBase ?? 0) >> 8, 0, 0, ...global, ...requirements);
    for (const e of rule.effects) {
      const def = movePrimitive(e.kind)!, conditions = encodeMoveConditions(e.conditions), row = Array(32).fill(0), v = Math.round(e.value * def.scale);
      row[0] = def.code; row[1] = MOVE_PHASES.indexOf(e.phase); row[2] = ["user", "target", "allies", "opponents", "all"].indexOf(e.target); row[3] = Number(e.secondary); row[4] = e.chance; row[5] = conditions.length / 8; row[6] = v & 255; row[7] = v >> 8 & 255;
      def.parameters.forEach((p, i) => { const value = e.parameters?.[p.key] ?? p.original; row[8 + i * 2] = value & 255; row[9 + i * 2] = value >> 8 & 255; });
      bytes.push(...row, ...conditions);
    }
  }
  if (bytes.length > 65535) throw Error("Move recipes exceed the shared configuration budget.");
  return Uint8Array.from(bytes);
}
