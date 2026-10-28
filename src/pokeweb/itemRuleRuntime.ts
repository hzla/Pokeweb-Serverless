import template from "../assets/data/itemRuleRuntime.json";
import templateV3 from "../assets/data/itemRuleRuntimeV3.json";
import { writeU32 } from "../nds/binary";
import { encodeItemRules, encodeItemRulesV4, type ItemRuleSet } from "./itemRules";
import { appendNativeItemEffects, type NativeItemResolver } from "./itemNativeRuntime";
import { writeRpm, type RpmModule } from "./rpm";

export const ITEM_RULE_API = ["BattleEventVar_GetValue", "BattleEventVar_MulValue", "GetBattleMon", "GetBattleMonStat", "GetPokeType", "PokeTypePair_IsMatch", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "BtlServerFlow_CheckMatchup", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleHandler_StrSetup", "BattleHandler_AddArg", "BattleEventItem_GetSubID", "BattleEvent_AddItem", "GetMonID", "RawBattleMonStat", "PML_MoveGetCategory"];
export type RuleRuntimeInput = { game: string; rules: ReadonlyMap<number, ItemRuleSet>; api: readonly number[];
  native?: { resolve: NativeItemResolver; api: ReadonlyMap<number, number> }; legacy?: boolean;
  dispatcher: { address: number; code: Uint8Array; calls: Array<{ offset: number; address: number }> } };

export function buildRuleRuntime(input: RuleRuntimeInput): RpmModule {
  const extended = Boolean(input.native) && !input.legacy, sourceTemplate = extended ? template : templateV3;
  const rpm = structuredClone(sourceTemplate) as unknown as RpmModule;
  const original = Uint8Array.from(sourceTemplate.code), dispatch = (original.length + 3) & ~3;
  const config = (dispatch + input.dispatcher.code.length + 3) & ~3;
  const encoded = extended ? encodeItemRulesV4(input.rules) : undefined, data = encoded?.bytes ?? encodeItemRules(input.rules);
  const bssBase = (original.length + 3) & ~3;
  const bssSymbols = rpm.symbols.filter(symbol => !(symbol.attributes & 4) && symbol.address >= bssBase);
  rpm.code = new Uint8Array(config + data.length);
  rpm.code.set(original); rpm.code.set(input.dispatcher.code, dispatch); rpm.code.set(data, config);
  const named = (name: string) => {
    const symbol = rpm.symbols.find(s => s.name === name);
    if (!symbol) throw new Error(`Missing native item runtime symbol: ${name}`);
    return symbol;
  };
  const api = named("ItemRuleApi").address;
  if (input.api.length !== ITEM_RULE_API.length) throw new Error("Incomplete native item API.");
  input.api.forEach((address, index) => writeU32(rpm.code, api + index * 4, address | 1));
  const originalIndex = rpm.symbols.length;
  rpm.symbols.push({ name: null, address: dispatch, size: input.dispatcher.code.length, type: "FUNCTION_THM", attributes: 0 },
    { name: null, address: config, size: data.length, type: "SECTION", attributes: 0 });
  rpm.relocations.push({ target: { module: "base", address: api + 18 * 4, type: "OFFSET" }, sourceSymbolIndex: originalIndex },
    { target: { module: "base", address: named("ItemRuleData").address, type: "OFFSET" }, sourceSymbolIndex: originalIndex + 1 },
    { target: { module: "167", address: input.dispatcher.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named("RuleDispatch")) });
  for (const call of input.dispatcher.calls) {
    rpm.symbols.push({ name: null, address: call.address, size: 0, type: "FUNCTION_THM", attributes: 4 });
    rpm.relocations.push({ target: { module: "base", address: dispatch + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
  }
  if (extended) {
    input.native!.api.forEach((address, index) => writeU32(rpm.code, api + index * 4, address | 1));
    appendNativeItemEffects(rpm, encoded!, config, input.native!.resolve);
    const shift = ((rpm.code.length + 3) & ~3) - bssBase;
    bssSymbols.forEach(symbol => { symbol.address += shift; });
  }
  rpm.metadata = { PMCGameID: input.game, PMCVersion: extended ? "4.0.0" : "3.0.0", PMCModulePriority: 4, PokewebItemEffects: "rules",
    PokewebItemRules: JSON.stringify([...input.rules].sort(([a], [b]) => a - b)) };
  // Bound both the resident image and the transient serialized image used by
  // the loader. The RPM writer separately checks its 16-bit string offsets.
  if ((extended ? rpm.code.length + rpm.bssSize : writeRpm(rpm, { ident: "DLXF" }).length) > 65536) throw new Error("Custom item effects exceed the shared DLL's 64 KiB budget. Reduce the number or complexity of rules.");
  if (extended && writeRpm(rpm, { ident: "DLXF" }).length + rpm.code.length + rpm.bssSize > 112 * 1024) throw new Error("Custom item effects exceed the shared DLL loading budget. Reduce the number or complexity of rules.");
  return rpm;
}
