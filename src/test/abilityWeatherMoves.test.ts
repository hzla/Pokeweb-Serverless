import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {readU16} from "../nds/binary";
import {ABILITY_IMPORT_LIBRARY,abilityImport} from "../pokeweb/abilityLibrary";
import {abilityRuleEvents} from "../pokeweb/abilityEvents";
import {NATIVE_ABILITY_PROFILES} from "../pokeweb/abilityNativeRuntime";
import {ABILITY_RULE_EFFECTS,EMPTY_ABILITY_RULE,encodeAbilityRules,validateAbilityRule} from "../pokeweb/abilityRules";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {ABILITY_EFFECTS_DLL_PATH,buildAbilityRuleModule,CURRENT_ABILITY_RUNTIME_VERSION,inspectAbilityEffects,isVerifiedAbilityWeatherImport} from "../pokeweb/abilityEffectsModel";
import {parseRpm,writeRpm} from "../pokeweb/rpm";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";

const make=(weather=1)=>validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:"abilityRecipe:moveWeather",value:1,parameters:{weather}}]});
const recordEffect=(bytes:Uint8Array,id:number)=>{const at=readU16(bytes,id*2);return at+4+bytes[at+1]*4;};
describe("simulated move weather ability",()=>{
 it("imports Mega Sol and its rain, hail and sand variants as editable recipes",()=>{
  for(const [id,label,weather] of [[1001,"Mega Sol",1],[1002,"Mega Rain",2],[1003,"Mega Hail",3],[1004,"Mega Sand",4]] as const){
   const entry=abilityImport(id);expect(entry).toMatchObject({label,group:"Legends Z-A"});expect(entry.rule).toEqual(make(weather));
   expect(abilityRuleEvents(entry.rule,NATIVE_ABILITY_PROFILES)).toEqual([]);
   const b=encodeAbilityRules(new Map([[165,entry.rule]])),e=recordEffect(b,165);expect(b[e]).toBe(173);expect(b[e+1]).toBe(weather);
  }
  for(const weather of [0,5])expect(()=>make(weather)).toThrow();
 });
 it("renders the templates and the weather choice",()=>{
  const {project}=makeItemEffectsProject();
  const html=renderItemRuleForm(project,{...make(2),consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS,presets:ABILITY_IMPORT_LIBRARY});
  for(const text of ["Mega Sol","Mega Rain","Mega Hail","Mega Sand","Moves act as if the weather is"])expect(html).toContain(text);
 });
 it.each(["B","W","BW2"])("replaces the checked native weather query in %s and round-trips",game=>{
  const {project}=game==="BW2"?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game as "B"|"W");
  const rules=new Map([[165,make(1)],[166,make(3)]]),dll=buildAbilityRuleModule(project,rules);
  expect(dll.metadata).toMatchObject({PokewebAbilityWeatherMoves:1,PokewebAbilityProtect:1});
  const hooks=dll.relocations.filter(r=>r.target.module!=="base"&&dll.symbols[r.sourceSymbolIndex]?.name==="AbilityWeatherQuery");
  expect(hooks).toHaveLength(1);expect(hooks[0].target.type).toBe("THUMB_BRANCH");
  const api=dll.symbols.find(s=>s.name==="AbilityWeatherApi")!,copy=dll.relocations.find(r=>r.target.module==="base"&&r.target.address===api.address)!;
  const body=dll.symbols[copy.sourceSymbolIndex];expect(body.size).toBe(64);
  // All six native calls inside the relocated copy are re-linked.
  expect(dll.relocations.filter(r=>r.target.module==="base"&&r.target.type==="THUMB_BRANCH_LINK"&&r.target.address>=body.address&&r.target.address<body.address+body.size)).toHaveLength(6);
  const bytes=writeRpm(dll,{ident:"DLXF"});
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:bytes}};
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules});
  expect(isVerifiedAbilityWeatherImport(project,ABILITY_EFFECTS_DLL_PATH,bytes,hooks[0].target.address)).toBe(true);
  expect(isVerifiedAbilityWeatherImport(project,ABILITY_EFFECTS_DLL_PATH,bytes,hooks[0].target.address+2)).toBe(false);
  expect(isVerifiedAbilityWeatherImport(project,"patches/Other.dll",bytes,hooks[0].target.address)).toBe(false);
 });
 it("adds no weather hook without the recipe",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),dll=buildAbilityRuleModule(project,new Map([[165,abilityImport(1000).rule]]));
  expect(dll.relocations.some(r=>dll.symbols[r.sourceSymbolIndex]?.name==="AbilityWeatherQuery")).toBe(false);
 });
 it("recognizes the previous protection runtime and updates it with its recipes intact",()=>{
  expect(CURRENT_ABILITY_RUNTIME_VERSION).toBe(14);
  const {project}=makeItemEffectsProject(0,0,true,true);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:new Uint8Array(readFileSync(new URL("./fixtures/ability-runtime-v13/protect.dll",import.meta.url)))}};
  const before=inspectAbilityEffects(project);expect(before).toMatchObject({editable:true,runtimeVersion:13});
  expect(parseRpm(project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH],{allowedMagics:["DLXF"]}).metadata.PokewebAbilityWeatherMoves).toBeUndefined();
  const upgraded=new Map([...before.rules,[166,make(1)]]);
  project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(buildAbilityRuleModule(project,upgraded),{ident:"DLXF"});
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:14,rules:upgraded});
 });
 it("rejects a modified native weather query before installing",()=>{
  const {project,offsets}=makeItemEffectsProject(0,0,true,true);
  const at=offsets.get("ServerEvent_GetWeather");expect(at).toBeDefined();project.overlays[167]![at!+2]^=0xff;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,make()]]))).toThrow();
 });
});
