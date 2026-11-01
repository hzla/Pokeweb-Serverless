import { encodeMoveRecipeBook, decodeMoveRecipeBook } from "./moveRecipeBook";
import { inspectAbilityEffects, isVerifiedAbilityMoveParamImport, upgradeAbilityRuntime } from "./abilityEffectsModel";
import { isVerifiedItemMoveParamImport } from "./itemEffectsModel";
import bindings from "../assets/data/moveRecipeBindings.json";
import black1Bindings from "../assets/data/moveRecipeBindingsB1.json";
import white1Bindings from "../assets/data/moveRecipeBindingsW1.json";
import template from "../assets/data/moveRuleRuntime.json";
import legacyTemplate from "../assets/data/moveRuleRuntimeV1.json";
import version2a from "../assets/data/moveRuleRuntimeV2A.json";
import version2b from "../assets/data/moveRuleRuntimeV2B.json";
import version3 from "../assets/data/moveRuleRuntimeV3.json";
import version4 from "../assets/data/moveRuleRuntimeV4.json";
import version5 from "../assets/data/moveRuleRuntimeV5.json";
import version6 from "../assets/data/moveRuleRuntimeV6.json";
import abilityNativeBindings from "../assets/data/abilityBindings.json";
import historyTemplate from "../assets/data/moveRuleRuntimeHistory.json";
import persistentTemplate from "../assets/data/moveRuleRuntimePersistent.json";
import persistentV9 from "../assets/data/moveRuleRuntimePersistentV9.json";
import sideBindings from "../assets/data/moveSideBindings.json";
import selectBindings from "../assets/data/moveHistorySelectBindings.json";
import abilityContracts from "../assets/data/abilityBindings.json";
import { NintendoDSRom } from "../nds/rom";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget, battleRuntimeResolver, type BattleRuntimeSignature } from "./battleRuntimeBindings";
import { checkedMoveEventList, encodeMoveRules, moveRecipeEvents, validateMoveRule, validateMoveRuleCategory, validateMoveRuleHits, MOVE_CONDITION_CODES,MOVE_PHASES,movePrimitive,type MoveCondition,type MoveRuleSet } from "./moveRules";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { ensureFileSystemState, setRomFileReplacement } from "./fileSystemModel";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";
import { stageCodeInjectionDll } from "./pmcModel";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { recordGenericChange } from "./actionChangelog";
import { typeChartTypeCount } from "./typeChartModel";
import { moveHistoryInitCall, moveHistoryProtectCall } from "./moveHistoryBindings";

export const MOVE_EFFECTS_DLL_PATH = "patches/MoveEffects.dll";
export const MOVE_RULE_API = ["BattleEventVar_GetValue", "BattleEventVar_GetValueIfExist", "BattleEventVar_RewriteValue", "BattleEventVar_MulValue", "GetBattleMon", "GetBattleMonStat", "GetPokeType", "PokeTypePair_IsMatch", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleEventVar_Push", "BattleEventVar_Pop", "BattleEventVar_SetConstValue", "BattleEventVar_SetRewriteOnceValue", "IsAllyMonID", "CheckCondition", "BtlServerFlow_IsMonInBattle", "GetMonID", "GetBattleMonSpecies", "PML_MoveGetCategory", "GetTurnFlag", "RollEffectChance", "IsStatChangeValid", "IsFieldEffectActive", "ServerControl_CheckFloating", "BtlServerFlow_CheckMatchup", "BattleEventVar_SetValue", "BattleEvent_CallHandlers", "BtlCalc_MakeStatusCondition", "BattleEventItem_GetSubID", null, "DoesMoveEventExist", "BattleEvent_AddItem", null, null, "BattleRandom", "GetBattleMonHeldItem", "PML_ItemIsBerry", "GetSideFromOpposingMonID", "GetSideFromMonID", "sub_21ABB90", "RawBattleMonStat", "GetPreviousMoveID", "MoveGetID", "GetMovePP", "HandlerMoldBreakerStart", "HandlerMoldBreakerEnd", "HandlerBypassSubstitute", "PokeTypePair_GetType1", "PokeTypePair_GetType2", "PokeTypePair_Make", "BattleEvent_SeekItem", "ResetSpActPriority", "GetAdditionalConditionFlag", "BattleHandler_StrSetup", "BattleHandler_AddArg", "sub_21A7CB0", "sub_21AAB90", "IsSubstituteActive", "sub_21A57C4", "CritAtkDefLevel", "ServerEvent_GetMoveParam"] as const;
const signatures = { ...BATTLE_RUNTIME_SIGNATURES, ...bindings.functions } as Record<string, BattleRuntimeSignature>;
const retired = Uint8Array.of(80, 87, 77, 82);
type Source = { base: number; armBase: number; game: string; revision: number; files: Map<string, Uint8Array>; ids: Map<string, number> };
const sources = new WeakMap<ProjectState, Source>();
export function hydrateMoveEffectsSource(project: ProjectState, rom: NintendoDSRom): void {
  if (!supportsMoveRecipes(project)) return;
  const table=project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  const overlayId=project.session.baseRom==="BW"?93:167;
  for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===overlayId){
    const files=new Map<string,Uint8Array>(),ids=new Map<string,number>();
    for(const directory of ["patches","lib"])for(const name of rom.filenames.folders.find(([n])=>n===directory)?.[1].files??[]){
      if(!name.toLowerCase().endsWith(".dll"))continue;
      const path=`${directory}/${name}`,id=rom.filenames.idOf(path);
      if(id!==undefined){files.set(path,rom.files[id].slice());ids.set(path,id);}
    }
    sources.set(project,{base:readU32(table,at+4),armBase:rom.arm9RamAddress,game:rom.idCode,revision:rom.data[30],files,ids});return;
  }
}
type Snapshot = Record<string, number>;
type Saved = { rules: Map<number, MoveRuleSet>; originals: Map<number, Snapshot>; messageBase?: number; swapMessageBase?: number; typeLossMessageBase?: number; powderCoverBase?: number; powderDamageBase?: number; focusMessageBase?: number; spotlightMessageBase?: number; fieldLockMessageBase?: number; webStartBase?:number; webHitBase?:number; webEndBase?:number; courtChangeBase?:number };
const ITEM_MESSAGES = ["VAR(258, 0) is about to\\nbe attacked by its VAR(265, 1)!", "The wild VAR(258, 0) is about to\\nbe attacked by its VAR(265, 1)!", "The foe's VAR(258, 0) is about to\\nbe attacked by its VAR(265, 1)!"];
const SWAP_MESSAGES = ["VAR(258, 0) swapped a stat\\nwith its target!", "The wild VAR(258, 0) swapped\\na stat with its target!", "The foe's VAR(258, 0) swapped\\na stat with its target!"];
const TYPE_LOSS_MESSAGES = ["VAR(258, 0) lost its\\nVAR(259, 1) type!", "The wild VAR(258, 0) lost its\\nVAR(259, 1) type!", "The foe's VAR(258, 0) lost its\\nVAR(259, 1) type!"];
const POWDER_COVER = ["VAR(258, 0) was covered\\nin powder!", "The wild VAR(258, 0) was covered\\nin powder!", "The foe's VAR(258, 0) was covered\\nin powder!"];
const POWDER_DAMAGE = ["The powder around VAR(258, 0)\\nexploded!", "The powder around the wild\\nVAR(258, 0) exploded!", "The powder around the foe's\\nVAR(258, 0) exploded!"];
const FOCUS_MESSAGES = ["VAR(258, 0) concentrated\\nintensely!", "The wild VAR(258, 0)\\nconcentrated intensely!", "The foe's VAR(258, 0)\\nconcentrated intensely!"];
const FIELD_LOCK_MESSAGES = ["No one can escape now!", "No one can escape now!", "No one can escape now!"];
const SPOTLIGHT_MESSAGES = ["VAR(258, 0) became the\\ncenter of attention!", "The wild VAR(258, 0) became\\nthe center of attention!", "The foe's VAR(258, 0) became\\nthe center of attention!"];
const WEB_START = ["A sticky web spread around\\nyour team!", "A sticky web spread around\\nthe opposing team!", "A sticky web spread around\\nthe opposing team!"];
const WEB_HIT = ["VAR(258, 0) was caught\\nin a sticky web!", "The wild VAR(258, 0) was caught\\nin a sticky web!", "The foe's VAR(258, 0) was caught\\nin a sticky web!"];
const WEB_END = ["The sticky web disappeared\\nfrom your team’s side!", "The sticky web disappeared\\nfrom the opposing side!", "The sticky web disappeared\\nfrom the opposing side!"];
const COURT_CHANGE = ["The side effects were exchanged!", "The side effects were exchanged!", "The side effects were exchanged!"];
function ensureBattleMessages(project: ProjectState, saved: Saved): void {
  const kinds=new Set([...saved.rules.values()].flatMap(rule=>rule.effects.map(effect=>effect.kind)));
  const hasTypeLoss=[...saved.rules.values()].some(rule=>rule.effects.some(effect=>effect.kind==="changeType"&&effect.parameters?.operation===1));
  if (!kinds.has("requireHeldItem")&&!kinds.has("swapRawStat")&&!hasTypeLoss&&!kinds.has("powderReaction")&&!kinds.has("focusCritical")&&!kinds.has("spotlight")&&!kinds.has("fieldSwitchLock")&&!kinds.has("entryStatHazard")&&!kinds.has("swapSideEffects")) return;
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, {fileData:"view"}), ["message_texts"]);
  const battleBank=project.session.baseRom==="BW"?14:18;
  const ensure=(current:number|undefined,messages:string[]):number=>{
    const bank=getTextBank(project,"message_texts",battleBank),byId=(id:number)=>bank.find(entry=>{const parsed=parseTextEntryId(entry[0]);return parsed.block===0&&parsed.entry===id;});
    if(current!==undefined){if(![0,1,2].every(n=>byId(current+n)))throw Error("A saved move announcement is missing.");return current;}
    const existing=bank.find(entry=>{const id=parseTextEntryId(entry[0]);return id.block===0&&messages.every((message,n)=>byId(id.entry+n)?.[1]===message);});
    if(existing)return parseTextEntryId(existing[0]).entry;
    const base=Math.max(...bank.map(entry=>parseTextEntryId(entry[0]).entry))+1;
    if(!bank.length||base+2>=0xffff)throw Error("The battle message bank has no room for move announcements.");
    addTextEntries(project,"message_texts",battleBank,3);
    for(const entry of getTextBank(project,"message_texts",battleBank)){const id=parseTextEntryId(entry[0]).entry;if(id>=base&&id<base+3)entry[1]=messages[id-base];}
    commitTextBank(project,"message_texts",battleBank);return base;
  };
  if(kinds.has("requireHeldItem"))saved.messageBase=ensure(saved.messageBase,ITEM_MESSAGES);
  if(kinds.has("swapRawStat"))saved.swapMessageBase=ensure(saved.swapMessageBase,SWAP_MESSAGES);
  if(hasTypeLoss)saved.typeLossMessageBase=ensure(saved.typeLossMessageBase,TYPE_LOSS_MESSAGES);
  if(kinds.has("powderReaction")){saved.powderCoverBase=ensure(saved.powderCoverBase,POWDER_COVER);saved.powderDamageBase=ensure(saved.powderDamageBase,POWDER_DAMAGE);}
  if(kinds.has("focusCritical"))saved.focusMessageBase=ensure(saved.focusMessageBase,FOCUS_MESSAGES);
  if(kinds.has("spotlight"))saved.spotlightMessageBase=ensure(saved.spotlightMessageBase,SPOTLIGHT_MESSAGES);
  if(kinds.has("fieldSwitchLock"))saved.fieldLockMessageBase=ensure(saved.fieldLockMessageBase,FIELD_LOCK_MESSAGES);
  if(kinds.has("entryStatHazard")){saved.webStartBase=ensure(saved.webStartBase,WEB_START);saved.webHitBase=ensure(saved.webHitBase,WEB_HIT);saved.webEndBase=ensure(saved.webEndBase,WEB_END);}
  if(kinds.has("swapSideEffects"))saved.courtChangeBase=ensure(saved.courtChangeBase,COURT_CHANGE);
}
function isLegacyRule(rule:MoveRuleSet):boolean {
  const condition=(c:MoveCondition):boolean=>c.kind==="group"?c.children.every(condition):(MOVE_CONDITION_CODES[c.kind]??255)<=14;
  return (!rule.nativeBase||rule.nativeBase===280)&&condition(rule.conditions)&&condition(rule.prerequisites)&&rule.effects.every(e=>
    (movePrimitive(e.kind)?.code??255)<=12&&MOVE_PHASES.indexOf(e.phase)<10&&condition(e.conditions)&&
    (e.kind!=="native"||[113,115,215].includes(e.value))&&Object.keys(e.parameters??{}).every(key=>({statStage:["stat"],heal:["denominator"],stages:["operation"]}as Record<string,string[]>)[e.kind]?.includes(key)));
}
export const MOVE_RECIPE_MANAGED_FIELDS = ["effect_category", "result_effect", "effect_chance", "status", "min_turns", "max_turns", "healing", "recoil", "flinch", ...[1, 2, 3].flatMap(n => [`stat_${n}`, `magnitude_${n}`, `stat_chance_${n}`])];
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytesHex = (bytes:Uint8Array) => Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
export const supportsMoveRecipes = (project: ProjectState) => project.session.baseRom === "BW2" || project.session.baseRom === "BW";

function context(project: ProjectState, requireMoves = true) {
  if (!supportsMoveRecipes(project)) throw Error("Move recipes currently support Black, White, Black 2 and White 2.");
  if(!sources.has(project)&&project.originalRomBytes)hydrateMoveEffectsSource(project,new NintendoDSRom(project.originalRomBytes,{fileData:"view"}));
  const source=sources.get(project);if(!source)throw Error("Reload the ROM with Moves selected before editing recipes.");
  if(!["IRBO","IRAO","IRDO","IREO"].includes(source.game)||source.revision!==0)throw Error("Move recipes require a recognized US revision-0 Black, White, Black 2 or White 2 ROM.");
  const catalog=source.game==="IRBO"?black1Bindings:source.game==="IRAO"?white1Bindings:bindings;
  const overlayId=project.session.baseRom==="BW"?93:167;
  const basic=(source.game==="IRBO"?black1Bindings.functions:source.game==="IRAO"?white1Bindings.functions:signatures) as Record<string,BattleRuntimeSignature>;
  const bw1=black1Bindings.functions as Record<string,BattleRuntimeSignature>;
  const nativeSignatures:Record<string,BattleRuntimeSignature>={...basic};
  nativeSignatures.BattleMon_GetCritStage??={...bw1.BattleMon_GetCritStage,module:String(overlayId)};
  nativeSignatures.BtlCalc_RollCritical??={...bw1.BtlCalc_RollCritical,module:String(overlayId)};
  nativeSignatures.getMoveFlag??=abilityNativeBindings.functions.getMoveFlag as BattleRuntimeSignature;
  nativeSignatures.HistorySelect=(selectBindings as Record<string,BattleRuntimeSignature>)[source.game];
  nativeSignatures.HistoryTransformCaller={...bw1.BW1_BTL_SERVER_FLOW_ProcHandExTransform,module:String(overlayId)};
  nativeSignatures.HistoryTransform={...bw1.BW1_BTL_POKEPARAM_Transform,module:String(overlayId)};
  nativeSignatures.HistoryPassCaller={...bw1.BW1_BTL_SERVER_FLOW_ProcHandExPassEffects,module:String(overlayId)};
  nativeSignatures.HistoryPass={...bw1.BW1_BTL_POKEPARAM_PassEffects,module:String(overlayId)};
  const defog=(sideBindings as Record<string,typeof sideBindings.IRBO>)[source.game].defog;
  nativeSignatures.WebDefog={module:String(overlayId),hex:defog.hex,mask:defog.mask,calls:[]};
  nativeSignatures.FieldSwitchSite={module:String(overlayId),hex:"301c16210000000000280bd1301c082100000000002805d1301c15210000000000280ad0",mask:"ffffffff00000000ffffffffffffffff00000000ffffffffffffffff00000000ffffffff",calls:[{offset:4,target:"CheckCondition"},{offset:16,target:"CheckCondition"},{offset:28,target:"CheckCondition"}]};
  if(project.session.baseRom==="BW2"){
    const caller=nativeSignatures.HistoryTransformCaller;
    if(caller.hex.slice(236*2,244*2)!=="741d00000a3f0000")throw Error("Unrecognized Transform binding profile.");
    nativeSignatures.HistoryTransformCaller={...caller,hex:caller.hex.slice(0,236*2)+"781d0000373f0000"};
  }

  for(const [name,base] of [["HistoryConsumeWork","BW1_BTL_SERVER_FLOW_ProcHandExConsumeItem"],["HistoryUseHeld","BW1_BTL_SERVER_FLOW_PushPokeCmd42"],["HistoryPushMessage","BW1_BTL_SERVER_FLOW_PushMsgRecord"]] as const)
    nativeSignatures[name]={...bw1[base],module:String(overlayId)};
  if(project.session.baseRom==="BW2"){
    const message=nativeSignatures.HistoryPushMessage,at=0x40*2;
    if(message.hex.slice(at,at+4)!=="216a")throw Error("Unrecognized message binding profile.");
    nativeSignatures.HistoryPushMessage={...message,hex:message.hex.slice(0,at)+"616a"+message.hex.slice(at+4)};
  }
  let base=source.base;
  const table=project.patches?.arm9OverlayTable;
  if(table)for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===overlayId)base=readU32(table,at+4);
  const overlay = project.overlays[overlayId];
  if (!base || !overlay?.length || requireMoves && !project.narcs.moves) throw Error("Reload the ROM with Moves selected.");
  const resolver = battleRuntimeResolver(overlay, base, project.arm9, source.armBase, nativeSignatures);
  const dispatcher = resolver.resolve("MoveEvent_AddItem");
  const first = readU32(dispatcher.code, 108), second = readU32(dispatcher.code, 116), count = readU32(dispatcher.code, 112);
  if (second !== first + 4 || ![258, 384].includes(count)) throw Error("Unrecognized native move registry.");
  const offset = first - base;
  if (offset < 0 || offset + count * 8 > overlay.length || !catalog.rows.every((id, n) => readU32(overlay, offset + n * 8) === id || count === 384 && id === 216 && readU32(overlay, offset + n * 8) === 0 && readU32(overlay, offset + n * 8 + 4) === 0) || count === 384 && Array.from({length: 126}, (_, n) => n + 258).some(n => readU32(overlay, offset + n * 8) || readU32(overlay, offset + n * 8 + 4))) throw Error("Unrecognized native move assignments.");
  const getters = new Map<number, { name: string; events: Array<{ event: number; handler: string }> }>();
  for (const [key, getter] of Object.entries(catalog.getters)) {
    const id = Number(key), index = catalog.rows.indexOf(id), address = readU32(overlay, offset + index * 8 + 4) & ~1;
    if (!resolver.matches(getter.name, address)) continue;
    const eventAt = readU32(overlay, address - base + getter.tableRef) - base;
    if (eventAt < 0 || eventAt + getter.events.length * 8 > overlay.length || !getter.events.every((e, n) => readU32(overlay, eventAt + n * 8) === e.event && resolver.matches(e.handler, readU32(overlay, eventAt + n * 8 + 4) & ~1))) continue;
    resolver.seed(getter.name, address);
    getter.events.forEach((e, n) => resolver.seed(e.handler, readU32(overlay, eventAt + n * 8 + 4) & ~1));
    getters.set(id, getter);
  }
  const files = new Map(source.files);
  for(const[path,id]of source.ids)if(project.fileSystem?.replacements?.[id])files.set(path,project.fileSystem.replacements[id]);
  for (const [name, data] of Object.entries(project.fileSystem?.additions ?? {})) if (name.toLowerCase().endsWith(".dll")) files.set(name, data);
  const abilityCatalog=source.game==="IRBO"?black1Bindings.abilityCatalog:source.game==="IRAO"?white1Bindings.abilityCatalog:abilityContracts;
  return { project, source, base, overlay, resolver, getters, files, signatures:nativeSignatures, overlayModule:String(overlayId), abilityCatalog, catalog, moveCount: project.narcs.moves?.fileCount ?? 65535 };
}
type Context = ReturnType<typeof context>;
function resolveNativeSideState(c:Context):number {
  const id=c.project.session.baseRom==="BW"?95:169,rom=new NintendoDSRom(c.project.originalRomBytes!,{fileData:"view"}),overlay=rom.loadArm9Overlays([id]).get(id);
  if(!overlay)throw Error("The native side-effect overlay is unavailable.");
  const table=c.project.patches?.arm9OverlayTable??rom.arm9OverlayTable;
  let entry=-1;for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===id){entry=at;break;}
  if(entry<0||readU32(table,entry+4)!==overlay.ramAddress||readU32(table,entry+8)!==overlay.ramSize||readU32(table,entry+12)!==overlay.bssSize||readU32(table,entry+24)!==overlay.fileId)throw Error("The native side-effect overlay layout has changed.");
  if(c.project.fileSystem?.replacements?.[overlay.fileId])throw Error("The native side-effect overlay has an unreviewed replacement.");
  const data=c.project.overlays[id]??overlay.data,profile=(sideBindings as Record<string,typeof sideBindings.IRBO>)[c.source.game];
  const locate=(hex:string)=>{const expected=Uint8Array.from(hex.match(/../gu)!,v=>parseInt(v,16)),found:number[]=[];for(let at=0;at+expected.length<=data.length;at+=2)if(expected.every((v,n)=>data[at+n]===v))found.push(at);if(found.length!==1)throw Error("The native side-effect service is missing or ambiguous.");return found[0];};
  locate(profile.add);const active=locate(profile.active),state=readU32(data,active+24);
  if(state!==overlay.ramAddress+overlay.ramSize||overlay.bssSize<448)throw Error("Unrecognized native side-effect state layout.");
  for(const [path,bytes] of c.files){if(path===MOVE_EFFECTS_DLL_PATH||same(bytes,retired))continue;let other:RpmModule;try{other=parseRpm(bytes,{allowedMagics:["DLXF"]});}catch{continue;}
    for(const relocation of other.relocations){if(relocation.target.module!==String(id))continue;const start=relocation.target.address&~1,size=relocation.target.type==="FULL_COPY"?other.symbols[relocation.sourceSymbolIndex]?.size??0:relocation.target.type==="OFFSET"?4:16;
      if(start<overlay.ramAddress+overlay.ramSize+overlay.bssSize&&start+size>overlay.ramAddress)throw Error(`Conflicting side-effect patch: ${path}.`);
    }
  }
  return state;
}
function anchorMoldBreaker(c:Context):void {
  const catalog=c.abilityCatalog,dispatch=c.resolver.resolve("AbilityEvent_AddItem"),pointers=catalog.tableRefs.map(ref=>readU32(dispatch.code,ref.offset)-ref.column);
  if(pointers[0]!==pointers[1])throw Error("Unrecognized native ability registry.");
  const at=pointers[0]-c.base;
  if(at<0||at+catalog.rows.length*8>c.overlay.length||!catalog.rows.every((id,n)=>readU32(c.overlay,at+n*8)===id))throw Error("Unrecognized native ability registry.");
  const profile=catalog.profiles.find(p=>p.id===104)!;
  const factory=(readU32(c.overlay,at+catalog.rows.indexOf(104)*8+4)&~1)-c.base;
  const bytes=Uint8Array.from(profile.factoryHex.match(/../gu)!,v=>parseInt(v,16)),mask=Uint8Array.from(profile.factoryMask.match(/../gu)!,v=>parseInt(v,16));
  if(factory<0||factory+bytes.length>c.overlay.length||!bytes.every((v,n)=>(c.overlay[factory+n]&mask[n])===(v&mask[n])))throw Error("Unrecognized native Mold Breaker factory.");
  const table=readU32(c.overlay,factory+profile.tableRefOffset)-c.base;
  if(table<0||table+profile.events.length*8>c.overlay.length||!profile.events.every((e,n)=>readU32(c.overlay,table+n*8)===e.event&&c.resolver.matches(e.handler,readU32(c.overlay,table+n*8+4)&~1)))throw Error("Unrecognized native Mold Breaker callbacks.");
  profile.events.forEach((e,n)=>c.resolver.seed(e.handler,readU32(c.overlay,table+n*8+4)&~1));
}
function needsAbilityUpgrade(c:Context):boolean {
  const bytes=c.files.get("patches/AbilityEffects.dll");if(!bytes||same(bytes,Uint8Array.of(80,87,65,82)))return false;
  const module=parseRpm(bytes,{allowedMagics:["DLXF"]});
  if(module.metadata.PokewebAbilityEffects!=="rules")throw Error("Verify the installed shared ability runtime in Abilities before applying move recipes.");
  const state=inspectAbilityEffects(c.project);if(!state.editable)throw Error(state.message);
  return state.runtimeVersion===1;
}
function checkHook(c: Context, name: string, address: number, size: number) {
  for (const [path, bytes] of c.files) {
    if (path === MOVE_EFFECTS_DLL_PATH || same(bytes, retired)) continue;
    let module: RpmModule; try { module = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    for (const relocation of module.relocations) {
      if (relocation.target.module !== (c.signatures[name].module === "ARM9" ? "0" : c.overlayModule)) continue;
      const start = relocation.target.address & ~1, length = relocation.target.type === "FULL_COPY" ? module.symbols[relocation.sourceSymbolIndex]?.size ?? 0 : relocation.target.type === "OFFSET" ? 4 : 16;
      if (start < address + size && start + length > address) {
        if(name==="ServerEvent_GetMoveParam"&&start===address&&relocation.target.type==="THUMB_BRANCH"&&(isVerifiedAbilityMoveParamImport(c.project,path,bytes,address)||isVerifiedItemMoveParamImport(c.project,path,bytes,address)))continue;
        throw Error(`Conflicting move service hook: ${path} (${name}).`);
      }
    }
  }
}
function stored(c: Context): Saved {
  const bytes = c.files.get(MOVE_EFFECTS_DLL_PATH);
  if (!bytes || same(bytes, retired)) return { rules: new Map(), originals: new Map() };
  const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  if (![1,2,3,4,5,6,7,8,9,10].includes(Number(module.metadata.PokewebMoveRecipes)) || typeof module.metadata.MoveRecipeBook !== "string") throw Error("The installed move DLL is not a supported recipe module.");
  const {rules,originals:original} = decodeMoveRecipeBook(module.metadata.MoveRecipeBook, MOVE_RECIPE_MANAGED_FIELDS);
  if(module.metadata.PokewebMoveRecipes===1&&[...rules.values()].some(rule=>!isLegacyRule(rule)))throw Error("The legacy move DLL contains unsupported recipe data.");
  if (!rules.size || rules.size !== original.size) throw Error("Invalid saved move recipes.");
  for (const [id, rule] of rules) {
    if (!Number.isInteger(id) || id <= 0 || id >= c.moveCount || !sameRule(rule, validateMoveRule(rule))) throw Error("Invalid saved move recipe.");
    if (Number(module.metadata.PokewebMoveRecipes)<7 && rule.effects.some(e=>(movePrimitive(e.kind)?.code??255)>33)) throw Error("The saved move runtime cannot support this recipe.");
    const snapshot = original.get(id);
    if (!snapshot || Object.keys(snapshot).length !== MOVE_RECIPE_MANAGED_FIELDS.length || MOVE_RECIPE_MANAGED_FIELDS.some(f => !Number.isInteger(snapshot[f]) || snapshot[f] < 0 || snapshot[f] > 65535)) throw Error("Invalid saved native move data.");
  }
  const messageBase=module.metadata.MoveItemMessageBase;
  const swapMessageBase=module.metadata.MoveSwapMessageBase;
  const typeLossMessageBase=module.metadata.MoveTypeLossMessageBase;
  const powderCoverBase=module.metadata.MovePowderCoverBase,powderDamageBase=module.metadata.MovePowderDamageBase,focusMessageBase=module.metadata.MoveFocusMessageBase,spotlightMessageBase=module.metadata.MoveSpotlightMessageBase,fieldLockMessageBase=module.metadata.MoveFieldLockMessageBase;
  const webStartBase=module.metadata.MoveWebStartBase,webHitBase=module.metadata.MoveWebHitBase,webEndBase=module.metadata.MoveWebEndBase,courtChangeBase=module.metadata.MoveCourtChangeBase;
  for(const value of [powderCoverBase,powderDamageBase,focusMessageBase,spotlightMessageBase,fieldLockMessageBase,webStartBase,webHitBase,webEndBase,courtChangeBase])if(value!==undefined&&(!Number.isInteger(value)||Number(value)<0||Number(value)>65532))throw Error("Invalid move announcement message ID.");
  if([...rules.values()].some(r=>r.effects.some(e=>e.kind==="powderReaction"))&&(powderCoverBase===undefined||powderDamageBase===undefined))throw Error("The powder messages are not configured.");
  if(messageBase!==undefined&&(!Number.isInteger(messageBase)||Number(messageBase)<0||Number(messageBase)>65532))throw Error("Invalid item announcement message ID.");
  if(swapMessageBase!==undefined&&(!Number.isInteger(swapMessageBase)||Number(swapMessageBase)<0||Number(swapMessageBase)>65532))throw Error("Invalid stat-swap announcement message ID.");
  if(typeLossMessageBase!==undefined&&(!Number.isInteger(typeLossMessageBase)||Number(typeLossMessageBase)<0||Number(typeLossMessageBase)>65532))throw Error("Invalid type-loss announcement message ID.");
  if(Number(module.metadata.PokewebMoveRecipes)>=3&&[...rules.values()].some(r=>r.effects.some(e=>e.kind==="requireHeldItem"))&&messageBase===undefined)throw Error("The item announcement messages are not configured.");
  if(Number(module.metadata.PokewebMoveRecipes)>=6&&[...rules.values()].some(r=>r.effects.some(e=>e.kind==="swapRawStat"))&&swapMessageBase===undefined)throw Error("The stat-swap announcement messages are not configured.");
  if(Number(module.metadata.PokewebMoveRecipes)>=6&&[...rules.values()].some(r=>r.effects.some(e=>e.kind==="changeType"&&e.parameters?.operation===1))&&typeLossMessageBase===undefined)throw Error("The type-loss announcement messages are not configured.");
  if([...rules.values()].some(r=>r.effects.some(e=>e.kind==="focusCritical"))&&focusMessageBase===undefined)throw Error("The focus message is not configured.");
  if([...rules.values()].some(r=>r.effects.some(e=>e.kind==="spotlight"))&&spotlightMessageBase===undefined)throw Error("The spotlight message is not configured.");
  if([...rules.values()].some(r=>r.effects.some(e=>e.kind==="fieldSwitchLock"))&&fieldLockMessageBase===undefined)throw Error("The switch-lock message is not configured.");
  if([...rules.values()].some(r=>r.effects.some(e=>e.kind==="entryStatHazard"))&&[webStartBase,webHitBase,webEndBase].some(v=>v===undefined))throw Error("The entry-hazard messages are not configured.");
  if([...rules.values()].some(r=>r.effects.some(e=>e.kind==="swapSideEffects"))&&courtChangeBase===undefined)throw Error("The side-exchange message is not configured.");
  const saved:Saved = { rules, originals: original, ...(messageBase===undefined?{}:{messageBase:Number(messageBase)}), ...(swapMessageBase===undefined?{}:{swapMessageBase:Number(swapMessageBase)}), ...(typeLossMessageBase===undefined?{}:{typeLossMessageBase:Number(typeLossMessageBase)}), ...(powderCoverBase===undefined?{}:{powderCoverBase:Number(powderCoverBase)}), ...(powderDamageBase===undefined?{}:{powderDamageBase:Number(powderDamageBase)}), ...(focusMessageBase===undefined?{}:{focusMessageBase:Number(focusMessageBase)}), ...(spotlightMessageBase===undefined?{}:{spotlightMessageBase:Number(spotlightMessageBase)}), ...(fieldLockMessageBase===undefined?{}:{fieldLockMessageBase:Number(fieldLockMessageBase)}), ...(webStartBase===undefined?{}:{webStartBase:Number(webStartBase)}), ...(webHitBase===undefined?{}:{webHitBase:Number(webHitBase)}), ...(webEndBase===undefined?{}:{webEndBase:Number(webEndBase)}), ...(courtChangeBase===undefined?{}:{courtChangeBase:Number(courtChangeBase)}) };
  const config=module.symbols.find(symbol=>symbol.name==="MoveRecipeConfig");
  if(!config||config.address<0||config.address+4>module.code.length)throw Error("The saved move configuration is missing.");
  const encodedTypeCount=module.code[config.address+3];
  if(module.metadata.PokewebMoveRecipes===1?encodedTypeCount!==0:![17,18].includes(encodedTypeCount))throw Error("Invalid saved move type layout.");
  const variants: RuntimeVariant[] = module.metadata.PokewebMoveRecipes===1 ? ["v1"] : module.metadata.PokewebMoveRecipes===2 ? ["v2a","v2b"] : module.metadata.PokewebMoveRecipes===3 ? ["v3"] : module.metadata.PokewebMoveRecipes===4 ? ["v4"] : module.metadata.PokewebMoveRecipes===5 ? ["v5"] : module.metadata.PokewebMoveRecipes===6 ? ["v6"] : module.metadata.PokewebMoveRecipes===8?["history"]:module.metadata.PokewebMoveRecipes===9?["persistent9"]:module.metadata.PokewebMoveRecipes===10?["persistent"]:["current"];
  const packedBook=module.metadata.MoveRecipeBook.startsWith("z1:");
  if (!variants.some(variant => same(writeRpm(moduleFor(c, saved, variant, encodedTypeCount,packedBook), { ident: "DLXF" }), bytes))) throw Error("The installed move DLL has unrecognized edits.");
  return saved;
}
/** Allow ordinary callers to use this exact transparent adapter; copied bodies must fail. */
export function isVerifiedMoveServiceImport(project: ProjectState, path: string, bytes: Uint8Array, name: string, address: number): boolean {
  if (path !== MOVE_EFFECTS_DLL_PATH || !["IsAffectedBySheerForce","ServerEvent_CheckTypeEffectiveness"].includes(name)) return false;
  try {
    const c = context(project, false); stored(c);
    const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    const wrapper=name==="IsAffectedBySheerForce"?"MoveSheerForce":"MoveTypeMatchupHook";
    return module.relocations.some(r => r.target.module === c.overlayModule && r.target.address === address && r.target.type === (name==="ServerEvent_CheckTypeEffectiveness"?"THUMB_BRANCH_SAFESTACK":"THUMB_BRANCH") && module.symbols[r.sourceSymbolIndex]?.name === wrapper);
  } catch { return false; }
}
/** The ability gateway copies only the entry prologue; this checked call is in the native remainder. */
export function isVerifiedMoveFieldSwitchImport(project:ProjectState,path:string,bytes:Uint8Array,address:number,size:number):boolean {
  if(path!==MOVE_EFFECTS_DLL_PATH)return false;
  try{
    const c=context(project,false);c.files.delete("patches/AbilityEffects.dll");c.files.delete("patches/ItemEffects.dll");
    if(![...stored(c).rules.values()].some(r=>r.effects.some(e=>e.kind==="fieldSwitchLock")))return false;
    const site=c.resolver.resolve("FieldSwitchSite"),call=site.address+4;
    if(call<address+8||call+4>address+size)return false;
    const module=parseRpm(bytes,{allowedMagics:["DLXF"]});
    return module.relocations.some(r=>r.target.module===c.overlayModule&&r.target.address===call&&r.target.type==="THUMB_BRANCH_LINK"&&module.symbols[r.sourceSymbolIndex]?.name==="MoveFieldSwitchCheck");
  }catch{return false;}
}
const sameRule = (a: MoveRuleSet, b: MoveRuleSet) => JSON.stringify(a) === JSON.stringify(b);
type RuntimeVariant = "v1" | "v2a" | "v2b" | "v3" | "v4" | "v5" | "v6" | "current" | "history" | "persistent9" | "persistent";
const historyKinds=new Set(["ateBerry","moveFailed","hitsTaken","partyFaints","statRaised","statLowered","selectedMove"]);
function hasHistory(rules:ReadonlyMap<number,MoveRuleSet>):boolean {
  const visit=(node:MoveCondition):boolean=>node.kind==="group"?node.children.some(visit):historyKinds.has(node.kind);
  return [...rules.values()].some(rule=>visit(rule.conditions)||visit(rule.prerequisites)||rule.effects.some(e=>e.kind==="historyPower"||e.kind==="selectionGate"||visit(e.conditions)));
}
const hasPersistent=(rules:ReadonlyMap<number,MoveRuleSet>)=>{
  const uses=(c:import("./moveRules").MoveCondition):boolean=>c.kind==="group"?c.children.some(uses):c.kind==="persistentFromMove"||c.kind==="adjacent";
  return [...rules.values()].some(r=>uses(r.conditions)||uses(r.prerequisites)||r.effects.some(e=>uses(e.conditions)||e.kind==="tidyField"&&Boolean((e.parameters?.hazards??7)&8)||["vulnerableUntilAction","residualDamage","residualStat","fieldMoveType","targetMoveType","selfTrapBoost","mutualTrap","powderReaction","blockMoveFlag","focusCritical","spotlight","criticalStageBoost","fieldSwitchLock","entryStatHazard","swapSideEffects"].includes(e.kind)));
};
function moduleFor(c: Context, saved: Saved, variant: RuntimeVariant=hasPersistent(saved.rules)?"persistent":hasHistory(saved.rules)?"history":"current", savedTypeCount?:number, packedBook=true): RpmModule {
  if (!saved.rules.size) throw Error("Choose at least one move recipe.");
  const rules = new Map([...saved.rules].sort(([a], [b]) => a - b).map(([id, rule]) => [id, validateMoveRule(rule)]));
  const legacy=variant==="v1",persistent=variant==="persistent"||variant==="persistent9";
  const runtime=legacy?legacyTemplate:variant==="v2a"?version2a:variant==="v2b"?version2b:variant==="v3"?version3:variant==="v4"?version4:variant==="v5"?version5:variant==="v6"?version6:variant==="persistent"?persistentTemplate:variant==="persistent9"?persistentV9:variant==="history"?historyTemplate:template;
  const rpm = structuredClone(runtime) as unknown as RpmModule; rpm.code = Uint8Array.from(runtime.code);
  const bssBase = (rpm.code.length + 3) & ~3, bss = rpm.symbols.filter(s => !(s.attributes & 4) && s.address >= bssBase);
  const named = (name: string) => { const symbol = rpm.symbols.find(s => s.name === name); if (!symbol) throw Error(`Missing move runtime symbol ${name}`); return symbol; };
  const append = (bytes: Uint8Array, name: string | null = null, type: "SECTION" | "FUNCTION_THM" = "SECTION") => {
    const at = (rpm.code.length + 3) & ~3, code = new Uint8Array(at + bytes.length); code.set(rpm.code); code.set(bytes, at); rpm.code = code;
    rpm.symbols.push({ name, address: at, size: bytes.length, type, attributes: 0 }); return rpm.symbols.length - 1;
  };
  const api = named("MoveRuleApi").address;
  const kinds=new Set([...rules.values()].flatMap(r=>r.effects.map(e=>e.kind)));
  if(!legacy&&kinds.has("ignoreAbilities"))anchorMoldBreaker(c);
  const visit=(node:import("./moveRules").MoveCondition)=>{if(node.kind==="group")node.children.forEach(visit);else kinds.add(`condition:${node.kind}`);};
  for(const rule of rules.values()){visit(rule.conditions);visit(rule.prerequisites);rule.effects.forEach(e=>{visit(e.conditions);if(e.kind==="historyPower")kinds.add(`condition:${e.parameters?.source===1?"partyFaints":"hitsTaken"}`);if(e.kind==="selectionGate"&&e.parameters?.requireSuccess)kinds.add("condition:selectedMove");});}
  if (variant!=="history"&&!persistent&&hasHistory(rules)) throw Error("This saved move runtime cannot support battle history.");
  if(!persistent&&hasPersistent(rules))throw Error("This saved move runtime cannot support persistent effects.");
  if(variant==="persistent9"&&[...rules.values()].some(r=>r.effects.some(e=>["entryStatHazard","swapSideEffects"].includes(e.kind)||e.kind==="tidyField"&&Boolean((e.parameters?.hazards??7)&8))))throw Error("This saved move runtime cannot support side-effect recipes.");
  const latest=variant==="current"||variant==="history"||persistent;
  const modern=variant==="v3"||variant==="v4"||variant==="v5"||variant==="v6"||latest,hasStatDrainMessage=variant==="v4"||variant==="v5"||variant==="v6"||latest,hasTidyVisual=variant==="v5"||variant==="v6"||latest,hasFullMessages=variant==="v6"||latest;
  const messages=hasFullMessages?["requireHeldItem","hazard","reducePP","statDrain","sourceCondition","suppressAbility","heal","cureAndHeal","copyAbility","maxHpRecoil","swapRawStat","changeType",...(latest?["allyHealInstead","drainEachHit"]:[]),...(persistent?["residualDamage","residualStat","selfTrapBoost","mutualTrap","powderReaction","blockMoveFlag","focusCritical","criticalStageBoost","spotlight","fieldSwitchLock","entryStatHazard","swapSideEffects"]:[])]:hasStatDrainMessage?["requireHeldItem","hazard","reducePP","statDrain"]:["requireHeldItem","hazard","reducePP"];
  const extraApis:Record<number,readonly string[]>={40:[],41:["hazard","entryStatHazard"],42:modern?["sourceCondition","requireHeldItem",...(persistent?["spotlight","condition:adjacent"]:[])]:["sourceCondition"],43:["swapRawStat","attackStat"],44:["reducePP"],45:["reducePP"],46:["reducePP"],47:["ignoreAbilities"],48:["ignoreAbilities"],49:["bypassSubstitute"],50:["changeType"],51:["changeType"],52:["changeType"],53:["tidyField","swapSideEffects"],54:hasTidyVisual?[]:["tidyField"],55:["condition:hidden",...(persistent?["criticalStageBoost"]:[])],56:messages,57:messages,58:["tidyField"],59:["typeMatchup"],60:["bypassSubstitute"],61:["thawTargets"],62:["attackStat"],63:["moveUserType","powderReaction"]};
  MOVE_RULE_API.forEach((name, index) => { if (!name || legacy&&index>=37 || !modern&&index>=56 || !hasTidyVisual&&index>=58 || !latest&&index>=59 || latest&&index===49 || index>=40&&!extraApis[index]?.some(kind=>kinds.has(kind))) return; const service = c.resolver.resolve(name); checkHook(c, name, service.address, service.code.length); writeU32(rpm.code, api + index * 4, service.address | 1); });
  if(hasTidyVisual&&kinds.has("tidyField")){
    const wrapper=c.resolver.resolve("sub_21A7CB0");
    for(const call of c.signatures.sub_21A7CB0.calls.filter(call=>["GetMonID","ResetSpActPriority","sub_21B1474"].includes(call.target))){
      const target=battleBranchTarget(wrapper.code,call.offset,wrapper.address),service=c.resolver.resolve(call.target);
      if(service.address!==target||!c.resolver.matches(call.target,target))throw Error(`Unrecognized Substitute display dependency ${call.target}.`);
      checkHook(c,call.target,service.address,service.code.length);
    }
  }
  if(modern)writeU32(rpm.code,named("MoveItemMessageBase").address,saved.messageBase??0);
  if(hasFullMessages)writeU32(rpm.code,named("MoveSwapMessageBase").address,saved.swapMessageBase??0);
  if(hasFullMessages)writeU32(rpm.code,named("MoveTypeLossMessageBase").address,saved.typeLossMessageBase??0);
  const copyGateway = (name: string, wrapper: string, index: number, safeStack = false, apiBase = api) => {
    const service = c.resolver.resolve(name); checkHook(c, name, service.address, service.code.length);
    const copy = append(service.code, null, "FUNCTION_THM"), at = rpm.symbols[copy].address;
    for (const call of c.signatures[name].calls) {
      const target = battleBranchTarget(service.code, call.offset, service.address);
      if (!c.resolver.matches(call.target, target)) throw Error(`Unrecognized move dependency ${call.target}`);
      rpm.symbols.push({ name: null, address: target, size: 0, type: "FUNCTION_THM", attributes: 4 });
      rpm.relocations.push({ target: { module: "base", address: at + call.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: rpm.symbols.length - 1 });
    }
    rpm.relocations.push({ target: { module: "base", address: apiBase + index * 4, type: "OFFSET" }, sourceSymbolIndex: copy }, { target: { module: c.overlayModule, address: service.address, type: safeStack?"THUMB_BRANCH_SAFESTACK":"THUMB_BRANCH" }, sourceSymbolIndex: rpm.symbols.indexOf(named(wrapper)) });
  };
  copyGateway("MoveEvent_AddItem", "MoveDispatch", 32);
  copyGateway("IsAffectedBySheerForce", "MoveSheerForce", 35);
  copyGateway("sub_21AB1BC", "MoveFlinchChance", 36);
  if(variant==="history"||persistent){
    const historyApi=named("MoveHistoryApi").address;
    if(persistent){writeU32(rpm.code,named("MovePowderCoverBase").address,saved.powderCoverBase??0);writeU32(rpm.code,named("MovePowderDamageBase").address,saved.powderDamageBase??0);writeU32(rpm.code,named("MoveFocusMessageBase").address,saved.focusMessageBase??0);writeU32(rpm.code,named("MoveSpotlightMessageBase").address,saved.spotlightMessageBase??0);writeU32(rpm.code,named("MoveFieldLockMessageBase").address,saved.fieldLockMessageBase??0);}
    if(variant==="persistent"){
      writeU32(rpm.code,named("MoveWebStartBase").address,saved.webStartBase??0);writeU32(rpm.code,named("MoveWebHitBase").address,saved.webHitBase??0);
      writeU32(rpm.code,named("MoveWebEndBase").address,saved.webEndBase??0);writeU32(rpm.code,named("MoveCourtChangeBase").address,saved.courtChangeBase??0);
      if(kinds.has("swapSideEffects"))writeU32(rpm.code,named("MoveNativeSideState").address,resolveNativeSideState(c));
    }
    const service=(name:string,index:number,abilityWrapper?:string)=>{
      const resolved=c.resolver.resolve(name);
      for(const [path,bytes] of c.files){
        if(path===MOVE_EFFECTS_DLL_PATH||same(bytes,retired))continue;
        let module:RpmModule;try{module=parseRpm(bytes,{allowedMagics:["DLXF"]});}catch{continue;}
        for(const relocation of module.relocations){
          if(relocation.target.module!==c.overlayModule)continue;
          const start=relocation.target.address&~1,length=relocation.target.type==="FULL_COPY"?module.symbols[relocation.sourceSymbolIndex]?.size??0:relocation.target.type==="OFFSET"?4:16;
          if(start>=resolved.address+resolved.code.length||start+length<=resolved.address)continue;
          if(path==="patches/AbilityEffects.dll"&&abilityWrapper&&start===resolved.address&&relocation.target.type==="THUMB_BRANCH"&&module.symbols[relocation.sourceSymbolIndex]?.name===abilityWrapper&&inspectAbilityEffects(c.project).editable)continue;
          throw Error(`Conflicting battle history service hook: ${path} (${name}).`);
        }
      }
      writeU32(rpm.code,historyApi+index*4,resolved.address|1);return resolved;
    };
    const init=service("BattleEvent_Init",0,"AbilityRecipeInit");
    service("BattleEvent_AddItem",1);
    const site=moveHistoryInitCall(c.overlay,c.base,init.address);checkHook(c,"BattleEvent_Init",site,4);
    rpm.relocations.push({target:{module:c.overlayModule,address:site,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistoryInit"))});
    if(kinds.has("selectionGate")||kinds.has("blockMoveFlag")){
      const original=c.resolver.resolve("HistorySelect");checkHook(c,"HistorySelect",original.address,original.code.length);
      const prefix=[0xf0,0xb5,0x85,0xb0,0x15,0x1c,0x07,0x1c,0x0e,0x1c,0x1c,0x1c];
      if(!prefix.every((value,index)=>original.code[index]===value))throw Error("Unrecognized native move-selection prologue.");
      const gateway=new Uint8Array(16);gateway.set(original.code.subarray(0,8));writeU16(gateway,8,0x4c00);writeU16(gateway,10,0x4720);writeU32(gateway,12,(original.address+8)|1);
      const copy=append(gateway,null,"FUNCTION_THM");
      rpm.relocations.push({target:{module:"base",address:historyApi+24,type:"OFFSET"},sourceSymbolIndex:copy},{target:{module:c.overlayModule,address:original.address,type:"THUMB_BRANCH"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistorySelect"))});
    }
    const events=new Set<number>();
    const need=(name:string)=>kinds.has(`condition:${name}`);
    if(kinds.has("vulnerableUntilAction"))[1,0x1c,0x47,0x54,0xa3].forEach(e=>events.add(e));
    if(kinds.has("fieldMoveType")||kinds.has("targetMoveType"))[4,0x28,0x54,0x78,0xa3].forEach(e=>events.add(e));
    if(kinds.has("criticalStageBoost")){
      copyGateway("BattleMon_GetCritStage","MoveCriticalRank",10,false,historyApi);[0x54,0x55,0xa0,0xa3].forEach(e=>events.add(e));
      const caller=c.resolver.resolve("HistoryPassCaller"),target=battleBranchTarget(caller.code,50,caller.address);
      if(!c.resolver.matches("HistoryPass",target))throw Error("Unrecognized native Baton Pass handler.");
      checkHook(c,"HistoryPassCaller",caller.address,caller.code.length);checkHook(c,"HistoryPass",target,216);
      writeU32(rpm.code,historyApi+44,target|1);
      rpm.relocations.push({target:{module:c.overlayModule,address:caller.address+50,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MovePassEffects"))});
    }
    if(kinds.has("fieldSwitchLock")){
      const site=c.resolver.resolve("FieldSwitchSite"),target=battleBranchTarget(site.code,4,site.address);
      if(!c.resolver.matches("CheckCondition",target))throw Error("Unrecognized native switch-check handler.");
      checkHook(c,"FieldSwitchSite",site.address,site.code.length);checkHook(c,"CheckCondition",target,20);
      rpm.relocations.push({target:{module:c.overlayModule,address:site.address+4,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveFieldSwitchCheck"))});
      [0x0c,0x78].forEach(e=>events.add(e));
    }
    if(kinds.has("entryStatHazard")){
      events.add(0x55);
      if(!c.getters.has(229))throw Error("Unrecognized native Rapid Spin handler.");
      const rapid=c.resolver.resolve("HandlerRapidSpin"),defog=c.resolver.resolve("WebDefog"),profile=(sideBindings as Record<string,typeof sideBindings.IRBO>)[c.source.game].defog;
      const dispatcher=c.resolver.resolve("MoveEvent_AddItem"),table=readU32(dispatcher.code,108)-c.base,index=c.catalog.rows.indexOf(432);
      const getter=readU32(c.overlay,table+index*8+4)&~1,getterAt=getter-c.base;
      if(index<0||getterAt<0||getterAt+12>c.overlay.length||![0x2102,0x6001,0x4800,0x4770].every((v,n)=>readU16(c.overlay,getterAt+n*2)===v))throw Error("Unrecognized native Defog getter.");
      const handlerTable=readU32(c.overlay,getterAt+8)-c.base;
      if(handlerTable<0||handlerTable+8>c.overlay.length||readU32(c.overlay,handlerTable)!==0xa0||(readU32(c.overlay,handlerTable+4)&~1)!==defog.address)throw Error("Unrecognized native Defog assignment.");
      for(const call of profile.calls){const target=battleBranchTarget(defog.code,call.offset,defog.address),at=target-c.base;if(at<0||at+8>c.overlay.length||bytesHex(c.overlay.subarray(at,at+8))!==call.hex)throw Error("Unrecognized native Defog dependency.");}
      const rapidGetter=c.resolver.resolve("EventAddRapidSpin"),rapidTable=readU32(rapidGetter.code,8)-c.base;
      if(rapidTable<0||rapidTable+8>c.overlay.length||readU32(c.overlay,rapidTable)!==0x4d||(readU32(c.overlay,rapidTable+4)&~1)!==rapid.address)throw Error("Unrecognized native Rapid Spin assignment.");
      for(const [service,index,wrapper,prefix,tableAt,signature] of [[rapid,12,"MoveRapidSpin",[0xf8,0xb5,0x82,0xb0],rapidTable,"EventAddRapidSpin"],[defog,13,"MoveDefog",[0x70,0xb5,0x03,0x20],handlerTable,"WebDefog"]] as const){
        if(!prefix.every((v,n)=>service.code[n]===v))throw Error(`Unrecognized native ${wrapper} prologue.`);
        checkHook(c,wrapper==="MoveRapidSpin"?"HandlerRapidSpin":"WebDefog",service.address,service.code.length);
        checkHook(c,signature,c.base+tableAt+4,4);writeU32(rpm.code,historyApi+index*4,service.address|1);
        rpm.relocations.push({target:{module:c.overlayModule,address:c.base+tableAt+4,type:"OFFSET"},sourceSymbolIndex:rpm.symbols.indexOf(named(wrapper))});
      }
    }
    if(kinds.has("spotlight")){
      [0x54,0x76,0xa3].forEach(e=>events.add(e));writeU32(rpm.code,named("MoveSpotlightCount").address,1);
      const bytes=new Uint8Array(8);writeU32(bytes,0,0x2a);const table=append(bytes),at=rpm.symbols[table].address;
      rpm.relocations.push({target:{module:"base",address:at+4,type:"OFFSET"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveSpotlightRedirect"))},{target:{module:"base",address:named("MoveSpotlightEvents").address,type:"OFFSET"},sourceSymbolIndex:table});
    }
    if(kinds.has("focusCritical")){copyGateway("BtlCalc_RollCritical","MoveFocusedCritical",9,false,historyApi);[0x54,0x78,0xa3].forEach(e=>events.add(e));}
    if(kinds.has("blockMoveFlag")||kinds.has("spotlight")){const flag=c.resolver.resolve("getMoveFlag");checkHook(c,"getMoveFlag",flag.address,flag.code.length);writeU32(rpm.code,historyApi+32,flag.address|1);}
    if(kinds.has("powderReaction")||kinds.has("blockMoveFlag"))[0x1f,0x54,0x78,0xa3].forEach(e=>events.add(e));
    if(kinds.has("selfTrapBoost"))[0x54,0xa3].forEach(e=>events.add(e));
    if(kinds.has("residualDamage")||kinds.has("residualStat"))[0x54,0x77,0xa3].forEach(e=>events.add(e));
    if(need("moveFailed")||need("selectedMove"))[3,4,0x54,0x78,0xa3].forEach(e=>events.add(e));
    if(need("moveFailed"))events.add(0x2c);
    if(need("hitsTaken"))events.add(0x4b);
    if(need("hitsTaken")||kinds.has("criticalStageBoost")){
      const caller=c.resolver.resolve("HistoryTransformCaller"),target=battleBranchTarget(caller.code,82,caller.address);
      if(readU16(caller.code,78)!==0x9902||readU16(caller.code,80)!==0x1c20||!c.resolver.matches("HistoryTransform",target))throw Error("Unrecognized native Transform handler.");
      checkHook(c,"HistoryTransformCaller",caller.address,caller.code.length);checkHook(c,"HistoryTransform",target,260);
      writeU32(rpm.code,historyApi+28,target|1);
      rpm.relocations.push({target:{module:c.overlayModule,address:caller.address+82,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistoryTransformHook"))});
    }

    if(need("partyFaints"))[0x55,0xa3].forEach(e=>events.add(e));
    if(need("statRaised")||need("statLowered"))[0x54,0x5d,0x78,0xa3].forEach(e=>events.add(e));
    if(need("statRaised"))events.add(0x46);
    const list=checkedMoveEventList(events), tableBytes=new Uint8Array(list.length*8);
    list.forEach((event,n)=>writeU32(tableBytes,n*8,event));
    writeU32(rpm.code,named("MoveHistoryCount").address,list.length);
    if(list.length){
      const table=append(tableBytes),start=rpm.symbols[table].address;
      list.forEach((event,n)=>rpm.relocations.push({target:{module:"base",address:start+n*8+4,type:"OFFSET"},sourceSymbolIndex:rpm.symbols.indexOf(named(event===0x1f&&(kinds.has("powderReaction")||kinds.has("blockMoveFlag"))?"MovePersistentEvent_1f":`MoveHistoryEvent_${event.toString(16).padStart(2,"0")}`))}));
      rpm.relocations.push({target:{module:"base",address:named("MoveHistoryEvents").address,type:"OFFSET"},sourceSymbolIndex:table});
    }
    if(need("moveFailed")){
      const protect=moveHistoryProtectCall(c.overlay,c.base),at=protect.target-c.base;
      for(const[offset,name]of [[10,"BattleEventVar_Push"],[16,"GetMonID"],[24,"BattleEventVar_SetValue"],[32,"BattleEventVar_SetValue"],[40,"BattleEvent_CallHandlers"],[46,"BattleEventVar_GetValue"],[54,"BattleEventVar_Pop"]] as const){
        const target=battleBranchTarget(c.overlay,at+offset,c.base);if(!c.resolver.matches(name,target))throw Error(`Unrecognized native Protect dependency: ${name}.`);
      }
      checkHook(c,"BattleEvent_Init",protect.target,68);checkHook(c,"BattleEvent_Init",protect.site,4);
      writeU32(rpm.code,historyApi+16,protect.target|1);
      rpm.relocations.push({target:{module:c.overlayModule,address:protect.site,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistoryProtect"))});
    }
    if(need("ateBerry")){
      const change=service("ServerControl_ChangeHeldItem",2,"AbilityRecipeChangeItem"),force=service("BattleHandler_ForceUseItem",3,"AbilityRecipeForceItem");
      const callers=(address:number)=>{const sites:number[]=[];for(let at=6;at+4<=c.overlay.length;at+=2){const hi=readU16(c.overlay,at),lo=readU16(c.overlay,at+2);if((hi&0xf800)===0xf000&&(lo&0xf800)===0xf800&&battleBranchTarget(c.overlay,at,c.base)===address)sites.push(at);}return sites;};
      const itemSites=callers(change.address),forceSites=callers(force.address);
      if(itemSites.length!==5||itemSites.some(at=>![0x2300,0x2301].includes(readU16(c.overlay,at-2)))||itemSites.filter(at=>readU16(c.overlay,at-2)===0x2301).length!==2)throw Error("Unrecognized native item consumption callers.");
      if(forceSites.length!==1||readU16(c.overlay,forceSites[0]-4)!==0x1c20||readU16(c.overlay,forceSites[0]-2)!==0x1c29)throw Error("Unrecognized native forced-item caller.");
      const consumeSites=itemSites.filter(at=>readU16(c.overlay,at-2)===0x2301&&readU16(c.overlay,at-8)===0x1c28&&readU16(c.overlay,at-6)===0x1c31);
      if(consumeSites.length!==1)throw Error("Unrecognized native consume-item work.");
      const consumeAt=consumeSites[0]-56,consumeAddress=c.base+consumeAt;
      if(!c.resolver.matches("HistoryConsumeWork",consumeAddress))throw Error("Unrecognized native consume-item handler.");
      for(const[offset,name]of [[18,"GetPokeParam"],[34,"HistoryUseHeld"],[44,"HistoryPushMessage"],[56,"ServerControl_ChangeHeldItem"]] as const){const target=battleBranchTarget(c.overlay,consumeAt+offset,c.base);if(!c.resolver.matches(name,target))throw Error(`Unrecognized consume-item dependency: ${name}.`);}
      const consumeCallers=callers(consumeAddress);
      if(consumeCallers.length!==1||consumeCallers[0]!==forceSites[0]+10)throw Error("Unrecognized consume-item dispatcher.");
      checkHook(c,"HistoryConsumeWork",consumeAddress,64);writeU32(rpm.code,historyApi+20,consumeAddress|1);
      checkHook(c,"HistoryConsumeWork",c.base+consumeCallers[0],4);rpm.relocations.push({target:{module:c.overlayModule,address:c.base+consumeCallers[0],type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistoryConsumeWork"))});
      for(const at of itemSites.filter(at=>readU16(c.overlay,at-2)===0x2301&&at!==consumeSites[0])){checkHook(c,"ServerControl_ChangeHeldItem",c.base+at,4);rpm.relocations.push({target:{module:c.overlayModule,address:c.base+at,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistoryChangeItem"))});}
      for(const at of forceSites){checkHook(c,"BattleHandler_ForceUseItem",c.base+at,4);rpm.relocations.push({target:{module:c.overlayModule,address:c.base+at,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveHistoryForceItem"))});}
    }
  }
  if(latest&&kinds.has("typeMatchup")){
    const caller=c.resolver.resolve("sub_21AA994"),original=c.resolver.resolve("sub_21AAB90");
    const sites=new Set<number>();
    for(const offset of [0x32,0x56]){
      const address=caller.address+offset;
      if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches("sub_21AAB90",original.address))throw Error("Unrecognized native type-matchup dependency.");
      sites.add(address);
    }
    for(let at=0;at+4<=c.overlay.length;at+=2){
      const hi=readU16(c.overlay,at),lo=readU16(c.overlay,at+2);
      if((hi&0xf800)===0xf000&&(lo&0xf800)===0xf800&&battleBranchTarget(c.overlay,at,c.base)===original.address&&!sites.has(c.base+at))throw Error("Unrecognized native type-matchup caller.");
    }
    // Both the native caller and the verified ability copy retain r5 as the
    // MoveParam pointer. The common callee lets both take this same path.
    copyGateway("sub_21AAB90","MoveTypeMatchupHook",59,true);
  }
  if(latest&&kinds.has("bypassSubstitute")){
    const caller=c.resolver.resolve("sub_21A4530"),original=c.resolver.resolve("IsSubstituteActive"),offset=0xfa,address=caller.address+offset;
    if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches("IsSubstituteActive",original.address))throw Error("Unrecognized native damaging-Substitute dependency.");
    checkHook(c,"sub_21A4530",address,4);
    rpm.relocations.push({target:{module:c.overlayModule,address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveDamagingSubstituteHook"))});
  }
  if(latest&&kinds.has("damageWeather")){
    const caller=c.resolver.resolve("ServerEvent_CalcDamage"),original=c.resolver.resolve("ServerEvent_GetWeather"),offset=0xde,address=caller.address+offset;
    if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches("ServerEvent_GetWeather",original.address))throw Error("Unrecognized native damage-weather dependency.");
    checkHook(c,"ServerEvent_CalcDamage",address,4);
    rpm.relocations.push({target:{module:c.overlayModule,address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveDamageWeatherHook"))});
  }
  if(latest&&kinds.has("thawTargets")){
    const caller=c.resolver.resolve("sub_21A5534"),original=c.resolver.resolve("sub_21A57C4"),offset=0xe,address=caller.address+offset;
    if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches("sub_21A57C4",original.address))throw Error("Unrecognized native target-thaw dependency.");
    checkHook(c,"sub_21A5534",address,4);
    rpm.relocations.push({target:{module:c.overlayModule,address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveThawHitTargets"))});
  }
  if(latest&&kinds.has("ignoreRedirection")){
    const caller=c.resolver.resolve("sub_21AEDEC"),original=c.resolver.resolve("BattleEvent_CallHandlers"),offset=0x3c,address=caller.address+offset;
    if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches("BattleEvent_CallHandlers",original.address))throw Error("Unrecognized native redirection dependency.");
    checkHook(c,"sub_21AEDEC",address,4);
    rpm.relocations.push({target:{module:c.overlayModule,address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveRedirectEvent"))});
  }
  if(latest&&kinds.has("attackStat")){
    const caller=c.resolver.resolve("ServerEvent_GetAttackPower");
    for(const [offset,service,wrapper] of [[0x4e,"BattleEvent_CallHandlers","MoveAttackStatHook"],[0x86,"CritAtkDefLevel","MoveCriticalStatHook"]] as const){
      const original=c.resolver.resolve(service),address=caller.address+offset;
      if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches(service,original.address))throw Error(`Unrecognized native attacking-stat dependency: ${service}.`);
      checkHook(c,"ServerEvent_GetAttackPower",address,4);
      rpm.relocations.push({target:{module:c.overlayModule,address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named(wrapper))});
    }
  }
  if(latest&&kinds.has("moveUserType")){
    const original=c.resolver.resolve("ServerEvent_GetMoveParam"),sites=new Set<number>();
    for(let index=0;index<8;++index){
      const name=`MoveParamSite${index}`,caller=c.resolver.resolve(name),offset=16,address=caller.address+offset;
      if(battleBranchTarget(caller.code,offset,caller.address)!==original.address||!c.resolver.matches("ServerEvent_GetMoveParam",original.address))throw Error("Unrecognized native move-parameter dependency.");
      checkHook(c,name,address,4);
      sites.add(address);
      rpm.relocations.push({target:{module:c.overlayModule,address,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:rpm.symbols.indexOf(named("MoveResolveUserType"))});
    }
    for(let at=0;at+4<=c.overlay.length;at+=2){
      const hi=readU16(c.overlay,at),lo=readU16(c.overlay,at+2);
      if((hi&0xf800)===0xf000&&(lo&0xf800)===0xf800&&battleBranchTarget(c.overlay,at,c.base)===original.address&&!sites.has(c.base+at))throw Error("Unrecognized native move-parameter caller.");
    }
  }
  const requiredGetters = [...new Set([...rules.values()].flatMap(r => [...(r.nativeBase ? [r.nativeBase] : []), ...r.effects.flatMap(e=>e.kind==="native"?[e.value]:e.kind==="removeItem"?[282]:[])]))].sort((a, b) => a - b);
  if (requiredGetters.length > 20) throw Error("Too many native move operations.");
  requiredGetters.forEach((id, index) => {
    const getter = c.getters.get(id); if (!getter) throw Error(`Native move ${id} has unrecognized handlers.`);
    const service = c.resolver.resolve(getter.name); checkHook(c, getter.name, service.address, service.code.length);
    writeU16(rpm.code, named("MoveNativeIds").address + index * 2, id);
    writeU32(rpm.code, named("MoveNativeGetters").address + index * 4, service.address | 1);
  });
  const encoded = encodeMoveRules(rules,legacy?0:savedTypeCount??typeChartTypeCount(c.project)), data = append(encoded, "MoveRecipeConfig");
  rpm.relocations.push({ target: { module: "base", address: named("MoveRuleData").address, type: "OFFSET" }, sourceSymbolIndex: data });
  for (const [index, [id, rule]] of [...rules].entries()) {
    if(c.project.narcs.moves&&rule.effects.some(e=>e.kind==="drainEachHit"))validateMoveRuleHits(rule,Number(decodeRecord(c.project,"moves",id).raw?.hits??0));
    if(rule.nativeBase && rule.effects.some(e=>["power","hpPower","historyPower"].includes(e.kind)) && c.getters.get(rule.nativeBase)!.events.some(e=>e.event===0x37)) throw Error("This native base already sets power. Use a recipe power effect instead.");
    const events = new Set(moveRecipeEvents(rule,variant==="v2a"||variant==="v2b",!latest));
    if (rule.nativeBase) c.getters.get(rule.nativeBase)!.events.forEach(e => events.add(e.event));
    const list = checkedMoveEventList(events), bytes = new Uint8Array(list.length * 8);
    list.forEach((event, n) => writeU32(bytes, n * 8, event));
    const table = append(bytes), start = rpm.symbols[table].address;
    list.forEach((event, n) => rpm.relocations.push({ target: { module: "base", address: start + n * 8 + 4, type: "OFFSET" }, sourceSymbolIndex: rpm.symbols.indexOf(named(`MoveEvent_${event.toString(16).padStart(2, "0")}`)) }));
    const entry = rpm.symbols[data].address + 4 + index * 16; writeU16(rpm.code, entry + 2, list.length);
    rpm.relocations.push({ target: { module: "base", address: entry + 8, type: "OFFSET" }, sourceSymbolIndex: table });
    if (id >= c.moveCount) throw Error("The move does not exist in this ROM.");
  }
  const shift = ((rpm.code.length + 3) & ~3) - bssBase; bss.forEach(s => s.address += shift);
  rpm.metadata = { PMCGameID: c.project.session.baseVersion, PMCVersion: "1.0.0", PMCModulePriority: 4, PokewebMoveRecipes: legacy?1:variant==="persistent"?10:variant==="persistent9"?9:variant==="history"?8:variant==="current"?7:variant==="v6"?6:variant==="v5"?5:variant==="v4"?4:variant==="v3"?3:2, MoveRecipeBook: encodeMoveRecipeBook(rules, saved.originals, MOVE_RECIPE_MANAGED_FIELDS,latest&&packedBook) };
  if(modern&&saved.messageBase!==undefined)rpm.metadata.MoveItemMessageBase=saved.messageBase;
  if(hasFullMessages&&saved.swapMessageBase!==undefined)rpm.metadata.MoveSwapMessageBase=saved.swapMessageBase;
  if(hasFullMessages&&saved.typeLossMessageBase!==undefined)rpm.metadata.MoveTypeLossMessageBase=saved.typeLossMessageBase;
  if(persistent&&saved.powderCoverBase!==undefined)rpm.metadata.MovePowderCoverBase=saved.powderCoverBase;
  if(persistent&&saved.powderDamageBase!==undefined)rpm.metadata.MovePowderDamageBase=saved.powderDamageBase;
  if(persistent&&saved.focusMessageBase!==undefined)rpm.metadata.MoveFocusMessageBase=saved.focusMessageBase;
  if(persistent&&saved.spotlightMessageBase!==undefined)rpm.metadata.MoveSpotlightMessageBase=saved.spotlightMessageBase;
  if(persistent&&saved.fieldLockMessageBase!==undefined)rpm.metadata.MoveFieldLockMessageBase=saved.fieldLockMessageBase;
  if(variant==="persistent"&&saved.webStartBase!==undefined)rpm.metadata.MoveWebStartBase=saved.webStartBase;
  if(variant==="persistent"&&saved.webHitBase!==undefined)rpm.metadata.MoveWebHitBase=saved.webHitBase;
  if(variant==="persistent"&&saved.webEndBase!==undefined)rpm.metadata.MoveWebEndBase=saved.webEndBase;
  if(variant==="persistent"&&saved.courtChangeBase!==undefined)rpm.metadata.MoveCourtChangeBase=saved.courtChangeBase;
  const serialized = writeRpm(rpm, { ident: "DLXF" });
  if (rpm.code.length + rpm.bssSize > 49152 || serialized.length + rpm.code.length + rpm.bssSize > 96 * 1024) throw Error("Move recipes exceed the shared DLL memory budget.");
  return rpm;
}
export function buildMoveRuleModule(project: ProjectState, rules: ReadonlyMap<number, MoveRuleSet>): RpmModule {
  if(needsAbilityUpgrade(context(project)))throw Error("Update the verified ability runtime before building a move module.");
  const snapshots = new Map<number, Snapshot>();
  for (const [id] of rules) { const raw = decodeRecord(project, "moves", id).raw; if (!raw) throw Error("Move data unavailable."); snapshots.set(id, Object.fromEntries(MOVE_RECIPE_MANAGED_FIELDS.map(f => [f, raw[f] ?? 0]))); }
  return moduleFor(context(project), { rules: new Map(rules), originals: snapshots });
}
export function inspectMoveEffects(project: ProjectState): { editable: boolean; rules: Map<number, MoveRuleSet>; message: string } {
  try { const c = context(project), saved = stored(c); return { editable: true, rules: saved.rules, message: saved.rules.size ? "Custom effects · Shared DLL" : "Native behavior" }; }
  catch (error) { return { editable: false, rules: new Map(), message: error instanceof Error ? error.message : String(error) }; }
}
function writeFields(project: ProjectState, id: number, fields: Snapshot) {
  const record = decodeRecord(project, "moves", id); if (!record.raw) throw Error("Move data unavailable.");
  for (const [key, value] of Object.entries(fields)) record.raw[key] = value;
  markDirty(project, "moves", id);
}
function recipeFields(project: ProjectState, id: number, rule: MoveRuleSet) {
  const raw = decodeRecord(project, "moves", id).raw!;
  const fields: Snapshot = Object.fromEntries(MOVE_RECIPE_MANAGED_FIELDS.map(f => [f, 0]));
  fields.effect_category = raw.category === 0 ? 13 : 0;
  // Native reflection recognizes opposing-side hazards by this category.
  if(raw.category===0&&rule.effects.some(effect=>effect.kind==="entryStatHazard"))fields.effect_category=11;
  const drain=rule.effects.find(effect=>effect.kind==="damageDrain");
  if(drain){fields.effect_category=8;fields.recoil=drain.value;}

  writeFields(project, id, fields);
}
export async function configureMoveRuleSets(project: ProjectState, edits: readonly { moveId: number; rules: MoveRuleSet }[]): Promise<void> {
  if (!edits.length) return;
  const c = context(project), saved = stored(c), seen = new Set<number>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.moveId) || edit.moveId <= 0 || edit.moveId >= project.narcs.moves!.fileCount || seen.has(edit.moveId)) throw Error("Choose unique move IDs present in this ROM.");
    seen.add(edit.moveId);const rules=validateMoveRule(edit.rules);validateMoveRuleCategory(rules,decodeRecord(project,"moves",edit.moveId).raw!.category);
    const typeCount=typeChartTypeCount(project);
    if(rules.effects.some(e=>["changeType","typeMatchup"].includes(e.kind)&&e.value>=typeCount||e.kind==="damageWeather"&&(e.parameters?.moveType??10)!==255&&(e.parameters?.moveType??10)>=typeCount||e.kind==="heal"&&(e.parameters?.immunityType??0)>typeCount))throw Error("Choose a type supported by this ROM.");
    saved.rules.set(edit.moveId,rules);
    if (!saved.originals.has(edit.moveId)) { const raw = decodeRecord(project, "moves", edit.moveId).raw!; saved.originals.set(edit.moveId, Object.fromEntries(MOVE_RECIPE_MANAGED_FIELDS.map(f => [f, raw[f] ?? 0]))); }
  }
  const typeCount=typeChartTypeCount(project);
  const unsupportedType=(condition:MoveCondition):boolean=>condition.kind==="group"?condition.children.some(unsupportedType):condition.kind==="type"&&condition.value>=typeCount;
  if([...saved.rules.values()].some(rule=>unsupportedType(rule.conditions)||unsupportedType(rule.prerequisites)||rule.effects.some(effect=>unsupportedType(effect.conditions)||["changeType","typeMatchup"].includes(effect.kind)&&effect.value>=typeCount||effect.kind==="damageWeather"&&(effect.parameters?.moveType??10)!==255&&(effect.parameters?.moveType??10)>=typeCount||effect.kind==="heal"&&(effect.parameters?.immunityType??0)>typeCount)))throw Error("Choose types supported by this ROM before applying move recipes.");
  moduleFor(c, saved);const upgrade=needsAbilityUpgrade(c);
  await installCodeInjectionPatch(project, async staged => {
    if(upgrade)await upgradeAbilityRuntime(staged);
    ensureBattleMessages(staged,saved);
    stageCodeInjectionDll(staged, "MoveEffects.dll", writeRpm(moduleFor(context(staged), saved), { ident: "DLXF" }));
    for (const edit of edits) recipeFields(staged, edit.moveId, saved.rules.get(edit.moveId)!);
    recordGenericChange(staged, "moves", `Applied recipes to ${edits.length} moves.`, "Move effects");
  });
}
export async function clearMoveRules(project: ProjectState, id: number): Promise<void> {
  const saved = stored(context(project)), original = saved.originals.get(id); if (!original) return;
  saved.rules.delete(id); saved.originals.delete(id);
  await installCodeInjectionPatch(project, staged => {
    if (saved.rules.size) { ensureBattleMessages(staged,saved); stageCodeInjectionDll(staged, "MoveEffects.dll", writeRpm(moduleFor(context(staged), saved), { ident: "DLXF" })); }
    else {
      const c = context(staged), fileId = c.source.ids.get(MOVE_EFFECTS_DLL_PATH);
      if (fileId !== undefined) setRomFileReplacement(staged, fileId, retired);
      else delete ensureFileSystemState(staged).additions![MOVE_EFFECTS_DLL_PATH];
      if (staged.codeInjection?.modules) staged.codeInjection.modules = staged.codeInjection.modules.filter(m => m.path !== MOVE_EFFECTS_DLL_PATH);
    }
    writeFields(staged, id, original);
    recordGenericChange(staged, "moves", `Restored native behavior for move ${id}.`, "Move effects");
  });
}
