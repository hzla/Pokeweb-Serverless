import nativeBindings from "../assets/data/itemNativeBindings.json";
import profiles from "../assets/data/itemEffectProfiles.json";
import { readU16 } from "../nds/binary";
import type { EncodedItemRuleV4 } from "./itemRules";
import type { RpmModule, RpmSymbol } from "./rpm";

export type NativeItemFunction = { address: number; code: Uint8Array };
export type NativeItemResolver = (name: string, address?: number) => NativeItemFunction;
export const ITEM_NATIVE_FUNCTIONS = nativeBindings.functions;
const WRAPPERS: Record<string, string> = {
  CommonGetItemParam: "RuleNativeParam", ItemEvent_PushRun: "RuleNativeRequest",
  BattleHandler_PushWork: "RuleNativePush", BattleHandler_PopWork: "RuleNativePop", BattleHandler_PushRun: "RuleNativePushRun",
  BattleEventItem_SetRecallEnable: "RuleNativeRecall", BattleEventItem_ConvertToIsolated: "RuleNativeIsolate", BattleEventItem_IsIsolated: "RuleNativeIsIsolated",
  BattleEventVar_MulValue: "RuleNativeMultiply", BattleEventVar_RewriteValue: "RuleNativeRewrite",
};
export function nativeItemBranchTarget(code: Uint8Array, at: number, base: number): number {
  const high = readU16(code, at), low = readU16(code, at + 2);
  if ((high & 0xf800) !== 0xf000 || ![0xf800, 0xe800].includes(low & 0xf800)) throw new Error("Unrecognized native item call.");
  let delta = (high & 0x7ff) << 12 | (low & 0x7ff) << 1;
  if (delta & 0x400000) delta -= 0x800000;
  const target = base + at + 4 + delta;
  return (low & 0xf800) === 0xe800 ? target & ~3 : target;
}

/** Copy each selected native callback/helper once and retarget checked calls. */
export function appendNativeItemEffects(rpm: RpmModule, encoded: EncodedItemRuleV4, configOffset: number, resolve: NativeItemResolver): void {
  const functions = nativeBindings.functions as Record<string, typeof nativeBindings.functions.HandlerFlameOrb>;
  const symbols = new Map<string, RpmSymbol>();
  const append = (bytes: Uint8Array) => {
    const at = (rpm.code.length + 3) & ~3, expanded = new Uint8Array(at + bytes.length);
    expanded.set(rpm.code); expanded.set(bytes, at); rpm.code = expanded; return at;
  };
  function target(name: string, address?: number, forceCopy = false): RpmSymbol {
    const key = forceCopy ? `copy:${name}` : name, existing = symbols.get(key);
    if (existing) { if (address !== undefined) resolve(name, address); return existing; }
    const source = resolve(name, address), definition = functions[name];
    if (!definition) throw new Error(`Missing native item dependency: ${name}`);
    if (WRAPPERS[name]) {
      const wrapper = rpm.symbols.find(symbol => symbol.name === WRAPPERS[name]);
      if (!wrapper) throw new Error(`Missing native item adapter: ${name}`);
      symbols.set(key, wrapper); return wrapper;
    }
    const clone = definition.clone || forceCopy;
    const copied: RpmSymbol = { name: null, address: clone ? append(source.code) : source.address, size: clone ? source.code.length : 0,
      type: definition.thumb ? "FUNCTION_THM" : "FUNCTION_ARM", attributes: clone ? 0 : 4 };
    symbols.set(key, copied); rpm.symbols.push(copied);
    if (clone) {
      if ("veneer" in definition) {
        const veneer = definition.veneer as { offset: number; target: string; inline: boolean };
        const instruction = new DataView(source.code.buffer, source.code.byteOffset).getUint32(veneer.offset, true);
        const destination = target(veneer.target, source.address + veneer.offset + (veneer.inline ? 0 : 8 + (instruction << 8 >> 6)));
        rpm.relocations.push({ target: { module: "base", address: copied.address + veneer.offset, type: "ARM_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(destination) });
      }
      if (definition.tails.length) throw new Error(`Unsupported native tail branch: ${name}`);
      for (const call of definition.calls) {
        const checked = target(call.target, nativeItemBranchTarget(source.code, call.offset, source.address));
        const adapter = name === "CheckEscapeBlocked" ? ({ GetBattleMonHeldItem: "RuleClientHeldItem", IsMonTrapped: "RuleClientTrapped" } as Record<string, string>)[call.target] : undefined;
        const destination = adapter ? rpm.symbols.find(symbol => symbol.name === adapter)! : checked;
        rpm.relocations.push({ target: { module: "base", address: copied.address + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.indexOf(destination) });
      }
    }
    return copied;
  }
  const api = rpm.symbols.find(symbol => symbol.name === "ItemRuleApi")!.address;
  for (const [name, wrapper, index] of [["CanMonSwitch", "RuleCanSwitch", 34], ["CheckEscapeBlocked", "RuleEscapeBlocked", 37], ["HandlerJudgement", "RuleMoveTyping", 39], ["HandlerTechnoBlast", "RuleMoveTyping", 40], ["ServerEvent_GetMoveParam", "RuleGetMoveParam", 42]] as const) {
    const original = target(name, undefined, true), source = resolve(name);
    rpm.relocations.push({ target: { module: "base", address: api + index * 4, type: "OFFSET" }, sourceSymbolIndex: rpm.symbols.indexOf(original) },
      { target: { module: "167", address: source.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.findIndex(symbol => symbol.name === wrapper) });
  }
  const tables = new Map<string, number>();
  for (const effect of encoded.nativeEffects) {
    const donor = effect.kind === "moveLock" ? 220 : Number(effect.kind.slice(7));
    const row = profiles.rows.find(value => value.id === donor);
    if (!row) throw new Error("Missing native item preset.");
    const events = effect.kind === "moveLock" ? row.events.filter(event => [0x22, 0x9c].includes(event.event)) : row.events;
    let table = tables.get(effect.kind);
    if (table === undefined) {
      table = append(new Uint8Array(events.length * 8)); tables.set(effect.kind, table);
      for (const [index, event] of events.entries()) {
        new DataView(rpm.code.buffer).setUint32(table + index * 8, event.event, true);
        const callback = target(event.handler);
        rpm.relocations.push({ target: { module: "base", address: table + index * 8 + 4, type: "OFFSET" }, sourceSymbolIndex: rpm.symbols.indexOf(callback) });
      }
    }
    const tableSymbol = rpm.symbols.length;
    rpm.symbols.push({ name: null, address: table, size: events.length * 8, type: "SECTION", attributes: 0 });
    rpm.relocations.push({ target: { module: "base", address: configOffset + effect.offset + 8, type: "OFFSET" }, sourceSymbolIndex: tableSymbol });
    rpm.code[configOffset + effect.offset + 14] = events.length;
  }
}
