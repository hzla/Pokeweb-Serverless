import nativeProfiles from "../assets/data/itemEffectProfiles.json";
import nativeBindings from "../assets/data/itemNativeBindings.json";

export type ItemRuleEffectKind = "attack" | "specialAttack" | "defense" | "specialDefense" | "speed" | "damage" | "healPercent" | "healFlat" | "healDivisor" | "status" | "statStage" | "recoil" | "moveLock" | "critical" | "accuracy" | "incomingAccuracy" | "moveType" | "escapeTrap" | `native:${number}` | `nativeAbility:${number}` | `abilityRecipe:${string}` | "ability:power" | "ability:damage" | "ability:damageTaken" | "ability:immunity" | "ability:hitStat" | "ability:priority";
export type ItemRuleEffectDefinition = { kind: ItemRuleEffectKind; label: string; value: number; min: number; max: number; step: number; unit: string; nativeItem?: number; parameterLabel?: string; valueChoices?: number[]; valueLabels?: Record<number,string> };
function nativeParameter(row: typeof nativeProfiles.rows[number]): { parameterLabel?: string; unit: string } {
  const functions = nativeBindings.functions as Record<string, { calls: Array<{ target: string }> }>, seen = new Set<string>();
  function reads(name: string): boolean { if (name === "CommonGetItemParam") return true; if (seen.has(name)) return false; seen.add(name); return functions[name]?.calls.some(call => reads(call.target)) ?? false; }
  if (!row.events.some(event => reads(event.handler))) return { unit: "" };
  const id = row.id;
  if ([43, 155].includes(id)) return { parameterLabel: "Healing (HP)", unit: "HP" };
  if (id === 158) return { parameterLabel: "Healing (% max HP)", unit: "%" };
  if ([217, 221, 230, 327].includes(id)) return { parameterLabel: "Activation chance (%)", unit: "%" };
  if ([213, 255].includes(id)) return { parameterLabel: "Accuracy penalty (%)", unit: "%" };
  if ([265, 276].includes(id)) return { parameterLabel: "Accuracy bonus (%)", unit: "%" };
  if ([201, 202, 203, 204, 205, 206, 207, 209, 210].includes(id)) return { parameterLabel: "HP threshold divisor", unit: "divisor" };
  if ([159, 160, 161, 162, 163, 208, 253, 281].includes(id)) return { parameterLabel: "Healing divisor", unit: "divisor" };
  if ([211, 212, 288, 540, 544].includes(id)) return { parameterLabel: "Damage divisor", unit: "divisor" };
  if (id === 269) return { parameterLabel: "Extra turns", unit: "turns" };
  if ([282, 283, 284, 285].includes(id)) return { parameterLabel: "Weather duration", unit: "turns" };
  if (id === 286) return { parameterLabel: "Trapping turns", unit: "turns" };
  if ([545, 546].includes(id)) return { parameterLabel: "Stat stages", unit: "stages" };
  if (id === 277) return { parameterLabel: "Bonus per repeat (%)", unit: "%" };
  if (id === 296) return { parameterLabel: "Drain bonus (%)", unit: "%" };
  if (id === 538) return { parameterLabel: "Defense bonus (%)", unit: "%" };
  return { parameterLabel: "Power bonus (%)", unit: "%" };
}
export const ITEM_RULE_EFFECTS: readonly ItemRuleEffectDefinition[] = [
  { kind: "attack", label: "Attack multiplier", value: 1.5, min: 0.125, max: 8, step: 0.125, unit: "×" },
  { kind: "specialAttack", label: "Sp. Atk multiplier", value: 1.5, min: 0.125, max: 8, step: 0.125, unit: "×" },
  { kind: "defense", label: "Defense multiplier", value: 1.5, min: 0.125, max: 8, step: 0.125, unit: "×" },
  { kind: "specialDefense", label: "Sp. Def multiplier", value: 1.5, min: 0.125, max: 8, step: 0.125, unit: "×" },
  { kind: "speed", label: "Speed multiplier", value: 1.5, min: 0.125, max: 8, step: 0.125, unit: "×" },
  { kind: "damage", label: "Outgoing damage multiplier", value: 1.3, min: 0.125, max: 8, step: 0.025, unit: "×" },
  { kind: "healPercent", label: "End-of-turn healing (% max HP)", value: 6.25, min: 0.01, max: 100, step: 0.01, unit: "%" },
  { kind: "healFlat", label: "End-of-turn healing (HP)", value: 10, min: 1, max: 65535, step: 1, unit: "HP" },
  { kind: "healDivisor", label: "End-of-turn healing (max HP ÷ divisor)", value: 16, min: 1, max: 255, step: 1, unit: "divisor" },
  { kind: "status", label: "Inflict status", value: 4, min: 1, max: 7, step: 1, unit: "" },
  { kind: "statStage", label: "Change stat stages", value: 1, min: -6, max: 6, step: 1, unit: "stages" },
  { kind: "recoil", label: "Deal damage (% max HP)", value: 10, min: 0.01, max: 100, step: 0.01, unit: "%" },
  { kind: "moveLock", label: "Lock into the selected move", value: 1, min: 1, max: 1, step: 1, unit: "" },
  { kind: "critical", label: "Critical-hit stage bonus", value: 1, min: 1, max: 4, step: 1, unit: "stages" },
  { kind: "accuracy", label: "Accuracy multiplier", value: 1.1, min: 0.125, max: 8, step: 0.025, unit: "×" },
  { kind: "incomingAccuracy", label: "Incoming accuracy multiplier", value: 0.9, min: 0.125, max: 8, step: 0.025, unit: "×" },
  { kind: "moveType", label: "Change move type", value: 9, min: 0, max: 17, step: 1, unit: "" },
  { kind: "escapeTrap", label: "Allow switching out of traps", value: 1, min: 1, max: 1, step: 1, unit: "" },
  ...nativeProfiles.rows.filter(row => ![223, 319].includes(row.id)).map(row => ({ kind: `native:${row.id}` as const, label: `${row.label} behavior`, value: -1, min: -1, max: 255, step: 1, ...nativeParameter(row), nativeItem: row.id })),
];
export const ITEM_RULE_TRIGGERS = ["entry", "turnEnd", "afterAttack", "afterHit", "afterContact", "hpCheck"] as const;
export const ITEM_RULE_TARGETS = ["holder", "attacker", "defender"] as const;
export const ITEM_RULE_TRIGGER_LABELS = ["On entering battle", "At turn end", "After dealing damage", "After taking damage", "After taking contact damage", "When checking held items"];
export const ITEM_RULE_STATUS_LABELS = ["Paralysis", "Sleep", "Freeze", "Burn", "Poison", "Confusion", "Bad poison"];
export const ITEM_RULE_STAT_LABELS = ["Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed", "Accuracy", "Evasion"];
export type ItemRuleEffect = { kind: ItemRuleEffectKind; value: number; trigger?: typeof ITEM_RULE_TRIGGERS[number]; target?: typeof ITEM_RULE_TARGETS[number]; stat?: number; chance?: number; move?: number; weather?: number; bypassable?: boolean; parameters?: Record<string, number> };
export type ItemRuleCondition =
  | { kind: "group"; mode: "all" | "any"; children: ItemRuleCondition[] }
  | { kind: "hp"; comparison: "lt" | "lte" | "gt" | "gte"; percent: number }
  | { kind: "type"; value: number; negate?: boolean }
  | { kind: "weather"; value: number; negate?: boolean }
  | { kind: "species" | "moveType" | "category" | "status"; value: number; negate?: boolean };
export type ItemRuleSet = { effects: ItemRuleEffect[]; conditions: ItemRuleCondition; consumable: boolean };
export const EMPTY_ITEM_RULE: ItemRuleSet = { effects: [{ kind: "attack", value: 1.5 }], conditions: { kind: "group", mode: "all", children: [] }, consumable: false };
export const ITEM_RULE_WEATHER = ["Clear", "Sun", "Rain", "Hail", "Sandstorm"];

/** Return a canonical, bounded rule tree suitable for both UI and native code. */
export function validateItemRule(input: ItemRuleSet): ItemRuleSet {
  if (!input || !Array.isArray(input.effects) || input.effects.length < 1 || input.effects.length > 16 || typeof input.consumable !== "boolean") throw new Error("Choose one to sixteen effects.");
  const seen = new Set<string>();
  const effects = input.effects.map(effect => {
    const definition = ITEM_RULE_EFFECTS.find(d => d.kind === effect?.kind);
    if (!definition || !Number.isFinite(effect.value) || effect.value < definition.min || effect.value > definition.max
      || Math.abs(effect.value / definition.step - Math.round(effect.value / definition.step)) > 1e-7) throw new Error("Invalid or duplicate item effect.");
    if (effect.kind === "statStage" && !effect.value) throw new Error("Choose a nonzero stat stage change.");
    if (effect.kind.startsWith("native:") && effect.value === 0) throw new Error("Use a positive native parameter or the original value.");
    const result: ItemRuleEffect = { kind: effect.kind, value: effect.value };
    if (["status", "statStage", "recoil"].includes(effect.kind)) {
      const trigger = effect.trigger ?? (effect.kind === "statStage" ? "entry" : effect.kind === "status" ? "turnEnd" : "afterAttack");
      const target = effect.target ?? "holder", chance = effect.chance ?? 100;
      if (!ITEM_RULE_TRIGGERS.includes(trigger) || !ITEM_RULE_TARGETS.includes(target) || !Number.isInteger(chance) || chance < 1 || chance > 100) throw new Error("Invalid effect timing, target or chance.");
      if (target !== "holder" && !["afterAttack", "afterHit", "afterContact"].includes(trigger)) throw new Error("Choose a damage trigger when targeting another Pokémon.");
      Object.assign(result, { trigger, target, chance });
      if (effect.kind === "statStage") {
        const stat = effect.stat ?? 1;
        if (!Number.isInteger(stat) || stat < 1 || stat > 7) throw new Error("Invalid stat stage.");
        result.stat = stat;
      }
    }
    if (effect.kind === "moveType") {
      const move = effect.move ?? 0;
      if (!Number.isInteger(move) || move < 0 || move > 1023) throw new Error("Invalid move ID.");
      result.move = move;
    }
    const identity = JSON.stringify(result);
    if (seen.has(identity)) throw new Error("Remove duplicate item effects.");
    seen.add(identity);
    return result;
  });
  let nodes = 0;
  function condition(node: ItemRuleCondition, depth: number): ItemRuleCondition {
    if (!node || ++nodes > 31 || depth > 4) throw new Error("Use at most 31 condition entries and four group levels.");
    if (node.kind === "group") {
      if (!["all", "any"].includes(node.mode) || !Array.isArray(node.children) || node.children.length > 8 || depth > 0 && !node.children.length) throw new Error("Add a condition to each group.");
      return { kind: "group", mode: node.children.length ? node.mode : "all", children: node.children.map(child => condition(child, depth + 1)) };
    }
    if (node.kind === "hp" && ["lt", "lte", "gt", "gte"].includes(node.comparison) && Number.isInteger(node.percent) && node.percent >= 0 && node.percent <= 100)
      return { kind: "hp", comparison: node.comparison, percent: node.percent };
    if ((node.kind === "type" || node.kind === "weather") && Number.isInteger(node.value) && node.value >= 0 && node.value < (node.kind === "type" ? 18 : 5) && (node.negate === undefined || typeof node.negate === "boolean"))
      return { kind: node.kind, value: node.value, negate: Boolean(node.negate) };
    if (["species", "moveType", "category", "status"].includes(node.kind)) {
      const value = (node as { value: number }).value, kind = node.kind as "species" | "moveType" | "category" | "status";
      const limit = kind === "species" ? 1024 : kind === "moveType" ? 18 : kind === "category" ? 3 : 7;
      const negate = (node as { negate?: boolean }).negate;
      if (Number.isInteger(value) && value >= (kind === "species" ? 1 : 0) && value < limit && (negate === undefined || typeof negate === "boolean")) return { kind, value, negate: Boolean(negate) };
    }
    throw new Error("Invalid activation condition.");
  }
  return { effects, conditions: condition(input.conditions, 0), consumable: input.consumable };
}

/** Postfix conditions: four-byte instructions, evaluated on a bounded stack. */
export function encodeItemRules(entries: ReadonlyMap<number, ItemRuleSet>): Uint8Array {
  const bytes: number[] = Array(1280).fill(0);
  const emit = (op: number, arg: number, value: number) => bytes.push(op, arg, value & 255, value >>> 8);
  for (const [id, input] of [...entries].sort(([a], [b]) => a - b)) {
    if (!Number.isInteger(id) || id < 1 || id >= 640) throw new Error("Unsupported item ID.");
    const rule = validateItemRule(input), at = bytes.length;
    bytes[id * 2] = at & 255; bytes[id * 2 + 1] = at >>> 8;
    bytes.push(rule.effects.length, 0, Number(rule.consumable), 0);
    function node(value: ItemRuleCondition) {
      if (value.kind === "group") { value.children.forEach(node); emit(value.mode === "all" ? 128 : 129, value.children.length, 0); }
      else if (value.kind === "hp") emit(1, ["lt", "lte", "gt", "gte"].indexOf(value.comparison), value.percent);
      else if (value.kind === "type" || value.kind === "weather") emit(value.kind === "type" ? 2 : 3, Number(Boolean(value.negate)), value.value);
      else throw new Error("Extended conditions require the version-4 runtime.");
      bytes[at + 1]++;
    }
    node(rule.conditions);
    if (rule.effects.some(effect => ITEM_RULE_EFFECTS.findIndex(d => d.kind === effect.kind) >= 9)) throw new Error("Extended item effects require the version-4 runtime.");
    rule.effects.forEach(effect => emit(ITEM_RULE_EFFECTS.findIndex(d => d.kind === effect.kind) + 1, 0,
      Math.round(effect.value * (effect.kind === "healPercent" ? 100 : effect.kind === "healFlat" || effect.kind === "healDivisor" ? 1 : 4096))));
  }
  if (bytes.length > 65535) throw new Error("The item rule configuration exceeds 64 KiB.");
  return Uint8Array.from(bytes);
}

export type EncodedItemRuleV4 = { bytes: Uint8Array; nativeEffects: Array<{ offset: number; kind: ItemRuleEffectKind }> };
/** Fixed 16-byte effect records; native callback pointers are linked afterward. */
export function encodeItemRulesV4(entries: ReadonlyMap<number, ItemRuleSet>): EncodedItemRuleV4 {
  const bytes: number[] = Array(1280).fill(0), nativeEffects: EncodedItemRuleV4["nativeEffects"] = [];
  const emit = (op: number, arg: number, value: number) => bytes.push(op, arg, value & 255, value >>> 8 & 255);
  for (const [id, input] of [...entries].sort(([a], [b]) => a - b)) {
    if (!Number.isInteger(id) || id < 1 || id >= 640) throw new Error("Unsupported item ID.");
    const rule = validateItemRule(input), at = bytes.length;
    bytes[id * 2] = at & 255; bytes[id * 2 + 1] = at >>> 8;
    bytes.push(rule.effects.length, 0, Number(rule.consumable), 4);
    function node(value: ItemRuleCondition): void {
      if (value.kind === "group") { value.children.forEach(node); emit(value.mode === "all" ? 128 : 129, value.children.length, 0); }
      else if (value.kind === "hp") emit(1, ["lt", "lte", "gt", "gte"].indexOf(value.comparison), value.percent);
      else emit(({ type: 2, weather: 3, species: 4, moveType: 5, category: 6, status: 7 })[value.kind], Number(Boolean(value.negate)), value.value);
      bytes[at + 1]++;
    }
    node(rule.conditions);
    for (const effect of rule.effects) {
      const offset = bytes.length, index = ITEM_RULE_EFFECTS.findIndex(value => value.kind === effect.kind);
      const isNative = effect.kind.startsWith("native:") || effect.kind === "moveLock";
      const opcode = isNative ? 128 : index + 1;
      const value = Math.round(effect.value * (["healPercent", "recoil"].includes(effect.kind) ? 100 : ["healFlat", "healDivisor", "status", "statStage", "critical", "moveType", "escapeTrap"].includes(effect.kind) || isNative ? 1 : 4096));
      emit(opcode, effect.kind === "statStage" ? effect.stat! : 0, value);
      bytes.push(effect.trigger ? ITEM_RULE_TRIGGERS.indexOf(effect.trigger) : 0, effect.target ? ITEM_RULE_TARGETS.indexOf(effect.target) : 0, effect.chance ?? 100, 0);
      bytes.push(0, 0, 0, 0);
      const donor = effect.kind === "moveLock" ? 220 : isNative ? Number(effect.kind.slice(7)) : effect.kind === "moveType" ? effect.move ?? 0 : 0;
      bytes.push(donor & 255, donor >>> 8, 0, 0);
      if (isNative) nativeEffects.push({ offset, kind: effect.kind });
    }
  }
  if (bytes.length > 65535) throw new Error("The item rule configuration exceeds 64 KiB.");
  return { bytes: Uint8Array.from(bytes), nativeEffects };
}
