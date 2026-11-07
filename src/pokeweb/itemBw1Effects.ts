import { hasItemSelection, resolveItemSelection } from "./itemSelectionBindings";
import black from "../assets/data/abilityBindingsB1.json";
import white from "../assets/data/abilityBindingsW1.json";
import {NintendoDSRom} from "../nds/rom";
import {readU32} from "../nds/binary";
import {battleRuntimeResolver,battleBranchTarget,type BattleRuntimeSignature} from "./battleRuntimeBindings";
import {buildRuleRuntime,ITEM_RULE_API,defaultItemMoveClasses} from "./itemRuleRuntime";
import {validateItemRule,type ItemRuleSet} from "./itemRules";
import {parseRpm,writeRpm,type RpmModule} from "./rpm";
import {getItemRecord} from "./moveItemModel";
import type {ProjectState} from "./projectStore";
import type {ItemEffectState} from "./itemEffectsModel";
import {installCodeInjectionPatch} from "./codeInjectionInstall";
import {stageCodeInjectionDll} from "./pmcModel";
import {ensureFileSystemState,setRomFileReplacement} from "./fileSystemModel";
import {recordFieldChange} from "./actionChangelog";
import {itemMessageIds} from "./itemBattleMessages";
import {expandedMoveDllDefaults,validateMoveClassOverrides} from "./abilityMoveClasses";
const dllPath="patches/ItemEffects.dll",retired=Uint8Array.of(80,87,73,82);
type Source={base:number;armBase:number;game:string;revision:number;files:Map<string,Uint8Array>;ids:Map<string,number>};
const sources=new WeakMap<ProjectState,Source>();
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function hydrateBw1ItemSource(project:ProjectState,rom:NintendoDSRom):void{
 if(project.session.baseRom!=="BW")return;
 const table=project.patches?.arm9OverlayTable??rom.arm9OverlayTable;
 for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===93){
  const files=new Map<string,Uint8Array>(),ids=new Map<string,number>();
  for(const folder of ["patches","lib"])for(const name of rom.filenames.folders.find(([f])=>f===folder)?.[1].files??[]){
   if(!name.toLowerCase().endsWith(".dll"))continue;const path=`${folder}/${name}`,id=rom.filenames.idOf(path);if(id!==undefined){files.set(path,rom.files[id].slice());ids.set(path,id);}
  }
  sources.set(project,{base:readU32(table,at+4),armBase:rom.arm9RamAddress,game:rom.idCode,revision:rom.data[30],files,ids});return;
 }
}
function context(project:ProjectState){
 if(!sources.has(project)&&project.originalRomBytes)hydrateBw1ItemSource(project,new NintendoDSRom(project.originalRomBytes,{fileData:"view"}));
 const source=sources.get(project);if(!source)throw Error("Reload the ROM with Items selected to verify battle code.");
 if(!["IRBO","IRAO"].includes(source.game)||source.revision!==0)throw Error("Item recipes require US revision-0 Black or White.");
 const data=project.overlays[93];if(!data?.length)throw Error("Reload the ROM with Items selected to load its battle overlay.");
 let base=source.base;const table=project.patches?.arm9OverlayTable;if(table)for(let at=0;at+32<=table.length;at+=32)if(readU32(table,at)===93)base=readU32(table,at+4);
 const functions=(source.game==="IRAO"?white:black).functions as Record<string,BattleRuntimeSignature>;
 const resolver=battleRuntimeResolver(data,base,project.arm9,source.armBase,functions);
 const files=new Map(source.files);for(const[path,id]of source.ids)if(project.fileSystem?.replacements[id])files.set(path,project.fileSystem.replacements[id]);
 for(const[path,bytes]of Object.entries(project.fileSystem?.additions??{}))if(path.toLowerCase().endsWith(".dll"))files.set(path,bytes);
 function check(address:number,size:number){for(const[path,bytes]of files){if(path===dllPath)continue;let rpm:RpmModule;try{rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});}catch{continue;}
  for(const r of rpm.relocations){if(r.target.module!=="93")continue;const start=r.target.address&~1,count=r.target.type==="OFFSET"?4:r.target.type==="FULL_COPY"?rpm.symbols[r.sourceSymbolIndex]?.size??0:16;if(start<address+size&&start+count>address)throw Error(`Conflicting native item hook: ${path}.`);}
 }}
 const resolve=(name:string,address?:number)=>{const result=resolver.resolve(name);if(address!==undefined&&result.address!==address)throw Error(`Unrecognized item service: ${name}`);if(functions[name].module==="93")check(result.address,result.code.length);return result;};
 return {source,data,base,functions,resolver,resolve,files,check};
}
export function checkedBw1ItemRule(project:ProjectState,input:ItemRuleSet):ItemRuleSet{
 const rule=validateItemRule(input);
 if(rule.effects.some(e=>e.kind.startsWith("native:")||["moveLock","moveType","escapeTrap"].includes(e.kind)))throw Error("This copied native behavior is available in BW2. Use the adjustable item recipes in Black/White.");
 if(!project.session.fairy&&rule.effects.some(e=>e.parameters?.type===17))throw Error("Fairy requires a Fairy-enabled ROM. Choose another move type.");
 return rule;
}
export function buildBw1ItemModule(project:ProjectState,rules:ReadonlyMap<number,ItemRuleSet>,classes?:ReadonlyMap<number,number>):RpmModule{
 const c=context(project),dispatcher=c.resolve("ItemEvent_AddItemCore"),api=ITEM_RULE_API.map(name=>c.resolve(name).address);
 const extras=["ItemGetParam","BattleEventVar_Push","BattleEventVar_Pop","BattleEventVar_SetConstValue","IsStatChangeValid","BtlCalc_MakeStatusCondition","MakeConditionBadlyPoisoned","BattleEventVar_GetValueIfExist","RollEffectChance","BattleEventVar_RewriteValue","GetBattleMonSpecies","CheckCondition","getMoveFlag","BattleEvent_CheckSkip","GetBattleMonHeldItem",null,null,null,null,null,null,null,"BtlServerFlow_CanUseHeldItem",null,"IsSubstituteActive","BattleEventItem_AttachSkipCheckHandler","GetSideFromMonID","IsEventTargetMon","BattleRandom"];
 if(classes===undefined){classes=defaultItemMoveClasses();for(const[id,flags]of expandedMoveDllDefaults(project))(classes as Map<number,number>).set(id,flags);const peer=c.files.get("patches/AbilityEffects.dll");if(peer&&!same(peer,Uint8Array.of(80,87,65,82))){const text=parseRpm(peer,{allowedMagics:["DLXF"]}).metadata.PokewebMoveClassOverrides;if(typeof text==="string")for(const[id,flags]of validateMoveClassOverrides(JSON.parse(text),new Map(),true))(classes as Map<number,number>).set(id,flags);}}
 const selection=hasItemSelection(rules)?resolveItemSelection(c.source.game,c.data,c.base,project.arm9,c.source.armBase,c.check):undefined;
 return buildRuleRuntime({game:project.session.baseVersion,rules,api,module:"93",portable:true,nativeVersion:selection?7:6,selection,moveClasses:classes,messages:itemMessageIds(project,rules),native:{resolve:c.resolve,api:new Map(extras.flatMap((name,i)=>name?[[19+i,c.resolve(name).address] as const]:[]))},
  dispatcher:{...dispatcher,calls:c.functions.ItemEvent_AddItemCore.calls.map(call=>({offset:call.offset,address:battleBranchTarget(dispatcher.code,call.offset,dispatcher.address)}))}});
}
const verified=new WeakMap<ProjectState,{overlay:Uint8Array;arm9:Uint8Array;base:number;files:Map<string,Uint8Array>;rules:Map<number,ItemRuleSet>;messages:string}>();
export function readBw1ItemRules(project:ProjectState):Map<number,ItemRuleSet>{
 const c=context(project),bytes=c.files.get(dllPath);if(!bytes||same(bytes,retired))return new Map();
 const cache=verified.get(project);
 if(cache&&cache.base===c.base&&same(cache.overlay,c.data)&&same(cache.arm9,project.arm9)&&cache.files.size===c.files.size&&[...c.files].every(([path,b])=>cache.files.has(path)&&same(cache.files.get(path)!,b))&&cache.messages===JSON.stringify(itemMessageIds(project,cache.rules)))return structuredClone(cache.rules);
 const rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});if(!["6.0.0","7.0.0"].includes(String(rpm.metadata.PMCVersion))||rpm.metadata.PokewebItemEffects!=="rules"||typeof rpm.metadata.PokewebItemRules!=="string"||typeof rpm.metadata.PokewebItemMoveClasses!=="string")throw Error("Unrecognized shared item runtime.");
 const entries:unknown=JSON.parse(rpm.metadata.PokewebItemRules);if(!Array.isArray(entries)||!entries.length||entries.length>639)throw Error("Invalid item rule registry.");
 const rules=new Map<number,ItemRuleSet>();for(const entry of entries){if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<1||entry[0]>=640||rules.has(entry[0]))throw Error("Invalid item rule registry.");getItemRecord(project,entry[0]);rules.set(entry[0],checkedBw1ItemRule(project,entry[1]));}
 const classes=validateMoveClassOverrides(JSON.parse(rpm.metadata.PokewebItemMoveClasses),new Map(),true);
 if(!same(bytes,writeRpm(buildBw1ItemModule(project,rules,classes),{ident:"DLXF"})))throw Error("The shared item rules DLL has been modified.");
 verified.set(project,{base:c.base,overlay:c.data.slice(),arm9:project.arm9.slice(),files:new Map([...c.files].map(([p,b])=>[p,b.slice()])),rules:structuredClone(rules),messages:JSON.stringify(itemMessageIds(project,rules))});return rules;
}
export function inspectBw1ItemEffect(project:ProjectState,itemId:number):ItemEffectState{
 const empty={editable:false,message:"",choices:[],events:[],controls:[]};try{getItemRecord(project,itemId);context(project).resolve("ItemEvent_AddItemCore");const rules=readBw1ItemRules(project).get(itemId);return {...empty,editable:true,message:"Verified native item registration",nativeSlot:false,rules};}catch(error){return {...empty,message:error instanceof Error?error.message:String(error)};}
}
export async function configureBw1ItemRules(project:ProjectState,edits:readonly{itemId:number;rules:ItemRuleSet}[]):Promise<void>{
 const rules=readBw1ItemRules(project),seen=new Set<number>();for(const edit of edits){if(!Number.isInteger(edit.itemId)||edit.itemId<1||edit.itemId>=640||seen.has(edit.itemId))throw Error("Invalid item ID.");getItemRecord(project,edit.itemId);seen.add(edit.itemId);rules.set(edit.itemId,checkedBw1ItemRule(project,edit.rules));}
 buildBw1ItemModule(project,rules);
 await installCodeInjectionPatch(project,async staged=>{itemMessageIds(staged,rules,true);stageCodeInjectionDll(staged,"ItemEffects.dll",writeRpm(buildBw1ItemModule(staged,rules),{ident:"DLXF"}));for(const edit of edits)recordFieldChange(staged,"items",String(getItemRecord(staged,edit.itemId).readable.name),"Custom battle rules","Previous effect",JSON.stringify(edit.rules),{key:`item-rules:${edit.itemId}`});});
}
export function clearBw1ItemRules(project:ProjectState,itemId:number):void{
 const rules=readBw1ItemRules(project);if(!rules.delete(itemId))return;if(rules.size){stageCodeInjectionDll(project,"ItemEffects.dll",writeRpm(buildBw1ItemModule(project,rules),{ident:"DLXF"}));return;}
 const c=context(project),state=ensureFileSystemState(project);delete state.additions![dllPath];const id=c.source.ids.get(dllPath);if(id!==undefined)setRomFileReplacement(project,id,retired.slice());if(project.codeInjection?.modules)project.codeInjection.modules=project.codeInjection.modules.filter(m=>m.path!==dllPath);
}
