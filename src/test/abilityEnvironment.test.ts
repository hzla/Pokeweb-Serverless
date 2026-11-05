import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {readU16} from "../nds/binary";
import {ABILITY_RULE_EFFECTS,ABILITY_RULE_PRESETS,EMPTY_ABILITY_RULE,encodeAbilityRules,validateAbilityRule,type AbilityRuleSet} from "../pokeweb/abilityRules";
import {ABILITY_DAMAGE_SOURCE_LABELS} from "../pokeweb/abilityRecipeEffects";
import {abilityRuleEvents} from "../pokeweb/abilityEvents";
import {NATIVE_ABILITY_PROFILES} from "../pokeweb/abilityNativeRuntime";
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH,CURRENT_ABILITY_RUNTIME_VERSION} from "../pokeweb/abilityEffectsModel";
import {writeRpm} from "../pokeweb/rpm";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";
const make=(effects:AbilityRuleSet["effects"])=>validateAbilityRule({effects,conditions:EMPTY_ABILITY_RULE.conditions});
const damage=(sources=3)=>make([{kind:"abilityRecipe:damageGuard",value:1,parameters:{sources}}]);
describe("entry conditions and selective indirect damage",()=>{
 it("packs every independent source bit without truncating the high bits",()=>{
  for(let bit=0;bit<14;bit++){
   const rule=damage(1<<bit),bytes=encodeAbilityRules(new Map([[255,rule]])),at=readU16(bytes,510),row=bytes.subarray(at+4+bytes[at+1]*4);
   expect(row[0]).toBe(170);expect(row[1]|row[4]<<8).toBe(1<<bit);
  }
  for(const value of [0,-1,16384,1.5])expect(()=>damage(value)).toThrow();
 });
 it("subscribes only to the selected native damage boundaries",()=>{
  expect(abilityRuleEvents(damage(),NATIVE_ABILITY_PROFILES)).toEqual([0x6b]);
  expect(abilityRuleEvents(damage(32|64),NATIVE_ABILITY_PROFILES)).toEqual([0x7f]);
  expect(abilityRuleEvents(damage(128),NATIVE_ABILITY_PROFILES)).toEqual([0x50,0x80]);
  expect(abilityRuleEvents(damage(1<<9),NATIVE_ABILITY_PROFILES)).toEqual([0x80]);
 });
 it("validates native field IDs, duration limits and side layers",()=>{
  for(const kind of ["abilityRecipe:fieldEntry","abilityRecipe:sideEntry"] as const){
   const rule=make([{kind,value:1}]);expect(abilityRuleEvents(rule,NATIVE_ABILITY_PROFILES)).toEqual([0x55,0x8a]);
   for(const duration of [0,1,63])expect(()=>make([{kind,value:1,parameters:{duration}}])).not.toThrow();
   for(const duration of [-1,64])expect(()=>make([{kind,value:1,parameters:{duration}}])).toThrow();
  }
  expect(()=>make([{kind:"abilityRecipe:fieldEntry",value:1,parameters:{condition:3}}])).toThrow();
  expect(()=>make([{kind:"abilityRecipe:sideEntry",value:1,parameters:{condition:9}}])).toThrow();
  expect(()=>make([{kind:"abilityRecipe:sideEntry",value:1,parameters:{layers:4}}])).toThrow();
 });
 it("renders independent damage-source checkboxes",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),rule=damage(1|2|512|8192);
  const html=renderItemRuleForm(project,{...rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
  for(const label of ABILITY_DAMAGE_SOURCE_LABELS)expect(html).toContain(label);
  expect([...html.matchAll(/data-rule-set="sources"[^>]*checked/gu)]).toHaveLength(4);
 });
 it("imports Magic Guard as an adjustable full source selection",()=>{
  expect(ABILITY_RULE_PRESETS.find(p=>p.id===98)!.rule.effects).toEqual([{kind:"abilityRecipe:damageGuard",value:1,parameters:{sources:16383}}]);
 });
 it.each(["B","W","BW2"])("links one checked damage adapter and preserves the native code in %s",game=>{
  const {project}=game==="BW2"?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game as "B"|"W");
  const original=project.overlays[game==="BW2"?167:93]!.slice();
  const rules=new Map([[165,make([{kind:"abilityRecipe:fieldEntry",value:1,parameters:{duration:3}},{kind:"abilityRecipe:sideEntry",value:1,parameters:{condition:6,side:1,layers:3}},...damage(16383).effects])],[255,damage(512)]]);
  const module=buildAbilityRuleModule(project,rules);
  expect(module.metadata.PokewebAbilityEnvironment).toBe(1);
  expect(module.relocations.filter(r=>module.symbols[r.sourceSymbolIndex].name==="AbilityIndirectDamageSite")).toHaveLength(1);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(module,{ident:"DLXF"})}};
  const inspected=inspectAbilityEffects(project);expect(inspected.message).toBe("Shared DLL verified");expect(inspected.rules).toEqual(rules);expect(inspected.runtimeVersion).toBe(CURRENT_ABILITY_RUNTIME_VERSION);
  expect(project.overlays[game==="BW2"?167:93]).toEqual(original);
 });
 it("reads the preceding version 10 DLL and preserves native flag filters when rebuilding",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:new Uint8Array(readFileSync(new URL("./fixtures/ability-runtime-v10/flags.dll",import.meta.url)))}};
  const before=inspectAbilityEffects(project);expect(before.editable,before.message).toBe(true);expect(before.runtimeVersion).toBe(10);
  const next=buildAbilityRuleModule(project,before.rules);project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules:before.rules});
 });
 it("requires no damage adapter for burn/poison-only protection",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),module=buildAbilityRuleModule(project,new Map([[165,damage()]]));
  expect(module.relocations.some(r=>module.symbols[r.sourceSymbolIndex].name==="AbilityIndirectDamageSite")).toBe(false);
 });
 it("rejects retargeted native damage queries even if their call-site bytes are masked",()=>{
  const {project,offsets}=makeItemEffectsProject(0,0,true,true);
  project.overlays[167]![offsets.get("AbilityCheckIndirectDamage")!+2]^=1;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,damage(512)]]))).toThrow();
 });
 it("rejects a changed native damage call before producing a patch",()=>{
  const {project,offsets}=makeItemEffectsProject(0,0,true,true);
  project.overlays[167]![offsets.get("AbilityIndirectDamageBoundary")!]^=1;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,damage(512)]]))).toThrow();
 });
});
