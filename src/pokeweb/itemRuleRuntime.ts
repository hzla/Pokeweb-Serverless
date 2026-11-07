import templateV7 from "../assets/data/itemRuleRuntimeV7.json";
import { hasItemSelection, type ItemSelectionBindings } from "./itemSelectionBindings";
import template from "../assets/data/itemRuleRuntime.json";
import templateV3 from "../assets/data/itemRuleRuntimeV3.json";
import templateV6 from "../assets/data/itemRuleRuntimeV6.json";
import templateV5 from "../assets/data/itemRuleRuntimeV5.json";
import moveClasses from "../assets/data/abilityMoveClasses.json";
import { writeU32 } from "../nds/binary";
import { encodeItemRules, encodeItemRulesV4, type ItemRuleSet } from "./itemRules";
import { appendNativeItemEffects, type NativeItemResolver } from "./itemNativeRuntime";
import { writeRpm, type RpmModule } from "./rpm";

export const ITEM_RULE_API = ["BattleEventVar_GetValue", "BattleEventVar_MulValue", "GetBattleMon", "GetBattleMonStat", "GetPokeType", "PokeTypePair_IsMatch", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "BtlServerFlow_CheckMatchup", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleHandler_StrSetup", "BattleHandler_AddArg", "BattleEventItem_GetSubID", "BattleEvent_AddItem", "GetMonID", "RawBattleMonStat", "PML_MoveGetCategory"];
export type RuleRuntimeInput = { game: string; rules: ReadonlyMap<number, ItemRuleSet>; api: readonly number[];
  native?: { resolve: NativeItemResolver; api: ReadonlyMap<number, number> }; legacy?: boolean;
  nativeVersion?:4|5|6|7; selection?: ItemSelectionBindings; module?:string; portable?:boolean; messages?:readonly number[]; moveClasses?:ReadonlyMap<number,number>;
  dispatcher: { address: number; code: Uint8Array; calls: Array<{ offset: number; address: number }> } };

export function buildRuleRuntime(input: RuleRuntimeInput): RpmModule {
  const extended = Boolean(input.native) && !input.legacy, version=input.nativeVersion??6, modern=extended&&version>=5, latest=extended&&version>=6, sourceTemplate = extended ? version===7?templateV7:latest?templateV6:modern?templateV5:template : templateV3;
  if(extended&&!modern&&[...input.rules.values()].some(r=>r.effects.some(e=>e.kind.startsWith("itemRecipe:"))))throw Error("Item recipes require the version-5 runtime.");
  if(version<6&&[...input.rules.values()].some(r=>r.effects.some(e=>["hazardGuard","statGuard","secondaryGuard","hitCount","mirrorBoosts","flagPower"].some(k=>e.kind===`itemRecipe:${k}`))))throw Error("These item recipes require the version-6 runtime.");
  if (hasItemSelection(input.rules) && (version !== 7 || !input.selection)) throw Error("Move restrictions require a verified selection adapter.");
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
    { target: { module: input.module??"167", address: input.dispatcher.address, type: "THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named("RuleDispatch")) });
  for (const call of input.dispatcher.calls) {
    rpm.symbols.push({ name: null, address: call.address, size: 0, type: "FUNCTION_THM", attributes: 4 });
    rpm.relocations.push({ target: { module: "base", address: dispatch + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
  }
  if (input.selection) {
    const wrapper = rpm.symbols.indexOf(named("RuleItemSelect"));
    for (const [index, address] of [[48,input.selection.address],[49,input.selection.canUse],[50,input.selection.moveType]] as const) writeU32(rpm.code, api + index * 4, address | 1);
    for (const address of input.selection.sites) rpm.relocations.push({target:{module:input.module??"167",address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:wrapper});
  }
  if (extended) {
    input.native!.api.forEach((address, index) => writeU32(rpm.code, api + index * 4, address | 1));
    if(!input.portable)appendNativeItemEffects(rpm, encoded!, config, input.native!.resolve);
    if(latest){const at=named("ItemRecipeMessages").address;for(let i=0;i<3;++i)new DataView(rpm.code.buffer).setUint16(at+i*2,input.messages?.[i]??0,true);}
    if(modern){
      const classes=[...(input.moveClasses??defaultItemMoveClasses())].filter(([,mask])=>mask).sort(([a],[b])=>a-b);
      const start=(rpm.code.length+3)&~3, data=new Uint8Array(2+classes.length*4), view=new DataView(data.buffer);
      view.setUint16(0,classes.length,true);classes.forEach(([id,mask],i)=>{if(!Number.isInteger(id)||id<0||id>65535||!Number.isInteger(mask)||mask<0||mask>127)throw Error("Invalid item move-class data.");view.setUint16(2+i*4,id,true);view.setUint16(4+i*4,mask,true);});
      const next=new Uint8Array(start+data.length);next.set(rpm.code);next.set(data,start);rpm.code=next;
      rpm.symbols.push({name:null,address:start,size:data.length,type:"SECTION",attributes:0});
      rpm.relocations.push({target:{module:"base",address:named("ItemRecipeMoveData").address,type:"OFFSET"},sourceSymbolIndex:rpm.symbols.length-1});
    }
    const shift = ((rpm.code.length + 3) & ~3) - bssBase;
    bssSymbols.forEach(symbol => { symbol.address += shift; });
  }
  rpm.metadata = { PMCGameID: input.game, PMCVersion: extended ? version===7?"7.0.0":latest?"6.0.0":modern?"5.0.0":"4.0.0" : "3.0.0", PMCModulePriority: 4, PokewebItemEffects: "rules",
    PokewebItemRules: JSON.stringify([...input.rules].sort(([a], [b]) => a - b)) };
  if(latest)rpm.metadata.PokewebItemMessages=JSON.stringify(input.messages??[0,0,0]);
  if(modern)rpm.metadata.PokewebItemMoveClasses=JSON.stringify([...(input.moveClasses??defaultItemMoveClasses())].filter(([,mask])=>mask).sort(([a],[b])=>a-b));
  // Bound both the resident image and the transient serialized image used by
  // the loader. The RPM writer separately checks its 16-bit string offsets.
  if ((extended ? rpm.code.length + rpm.bssSize : writeRpm(rpm, { ident: "DLXF" }).length) > 65536) throw new Error("Custom item effects exceed the shared DLL's 64 KiB budget. Reduce the number or complexity of rules.");
  if (extended && writeRpm(rpm, { ident: "DLXF" }).length + rpm.code.length + rpm.bssSize > 112 * 1024) throw new Error("Custom item effects exceed the shared DLL loading budget. Reduce the number or complexity of rules.");
  return rpm;
}
export function defaultItemMoveClasses():Map<number,number>{
  const rows=new Map<number,number>();
  for(const[key,mask]of [["bite",1],["pulse",2],["ball",4],["slicing",8],["powder",16],["wind",32],["healing",64]] as const)
    for(const id of moveClasses.classes[key])rows.set(id,(rows.get(id)??0)|mask);
  return rows;
}
