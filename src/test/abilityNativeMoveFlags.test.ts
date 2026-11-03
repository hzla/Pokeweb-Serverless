import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {PROPERTIES} from "../pokeweb/constants";
import {VANILLA_MOVE_FLAGS,VANILLA_MOVE_FILTER_MAX,vanillaMoveFlagIndex} from "../pokeweb/abilityMoveFilters";
import {ABILITY_RULE_EFFECTS,EMPTY_ABILITY_RULE,encodeAbilityRules,validateAbilityRule,type AbilityRuleSet} from "../pokeweb/abilityRules";
import {ABILITY_EFFECTS_DLL_PATH,buildAbilityRuleModule,CURRENT_ABILITY_RUNTIME_VERSION,inspectAbilityEffects,inspectCustomMoveFlags} from "../pokeweb/abilityEffectsModel";
import {customMoveFlagId} from "../pokeweb/customMoveFlags";
import {readU16} from "../nds/binary";
import {writeRpm} from "../pokeweb/rpm";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";
import {renderItemRuleForm} from "../ui/itemRuleEditor";

const make=(kind:AbilityRuleSet["effects"][number]["kind"],moveClass:number)=>validateAbilityRule({conditions:EMPTY_ABILITY_RULE.conditions,effects:[{kind,value:1,parameters:{moveClass}}]});
function effectBytes(rule:AbilityRuleSet){const data=encodeAbilityRules(new Map([[165,rule]])),at=readU16(data,330);return data.slice(at+4+data[at+1]*4);}
describe("native move flag filters",()=>{
 it("keeps native properties distinct from every custom flag ID",()=>{
  expect(VANILLA_MOVE_FLAGS.map(flag=>flag.key)).toEqual(PROPERTIES);
  for(const flag of VANILLA_MOVE_FLAGS){expect(vanillaMoveFlagIndex(flag.filter)).toBe(flag.index);expect(customMoveFlagId(flag.filter)).toBeUndefined();}
  expect(customMoveFlagId(255)).toBe(242);expect(vanillaMoveFlagIndex(255)).toBeUndefined();
  expect(()=>make("ability:power",VANILLA_MOVE_FILTER_MAX+1)).toThrow();
 });
 it.each(["ability:power","ability:damage","ability:damageTaken","ability:priority","ability:immunity","ability:hitStat"]as const)("packs all native flags and independent bypass settings for %s",kind=>{
  for(const flag of VANILLA_MOVE_FLAGS)for(const bypassable of [false,true]){
   const rule=make(kind,flag.filter);rule.effects[0].bypassable=bypassable;
   const row=effectBytes(rule);expect(row[1]).toBe(flag.index);expect(row[7]).toBe(2|Number(bypassable));
  }
 });
 it.each([["abilityRecipe:convertType",1],["abilityRecipe:statAction",10],["abilityRecipe:allyPower",4],["abilityRecipe:perish",1],["abilityRecipe:windAbsorb",4],["abilityRecipe:moveGuard",1]]as const)("packs native filters in %s without moving its parameters",(kind,at)=>{
  const row=effectBytes(make(kind,268));expect(row[at]).toBe(12);expect(row[7]&2).toBe(2);
 });
 it("carries the filter through consolidated stat changes",()=>{
  const rule=validateAbilityRule({conditions:EMPTY_ABILITY_RULE.conditions,effects:[{kind:"abilityRecipe:statGroup",value:1,parameters:{activation:5,attackStages:1,speedStages:-1,moveClass:268}}]});
  const row=effectBytes(rule);expect(row[9]).toBe(12);expect(row[7]).toBe(2);
 });
 it.each(["B","W","W2"]as const)("reopens native flag recipes in %s and preserves the source",game=>{
  const {project}=game==="W2"?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game);
  const before=project.overlays[game==="W2"?167:93]!.slice(),rules=new Map([[165,make("ability:priority",268)],[255,make("ability:power",259)]]);
  const rpm=buildAbilityRuleModule(project,rules);expect(rpm.metadata.PokewebAbilityNativeMoveFlags).toBe(1);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules});
  expect(project.overlays[game==="W2"?167:93]).toEqual(before);
  rpm.metadata.PokewebAbilityNativeMoveFlags=2;project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:"DLXF"});
  expect(inspectAbilityEffects(project).editable).toBe(false);
 });
 it("reopens version 9 with expanded healing and the last custom flag, then upgrades without reinterpreting either",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),bytes=new Uint8Array(readFileSync(new URL("./fixtures/ability-runtime-v9/flags.dll",import.meta.url)));
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:bytes}};
  const old=inspectAbilityEffects(project);expect(old).toMatchObject({editable:true,runtimeVersion:9});
  expect(old.rules.get(165)!.effects[0].parameters?.moveClass).toBe(12);
  expect(old.rules.get(166)!.effects[0].parameters?.moveClass).toBe(255);
  const registry=inspectCustomMoveFlags(project).registry;
  const next=buildAbilityRuleModule(project,old.rules);project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules:old.rules});
  expect(inspectCustomMoveFlags(project).registry).toEqual(registry);
 });
 it("offers native Healing and every other native flag beside the separate expanded Healing filter",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),rule=make("ability:priority",268);
  const html=renderItemRuleForm(project,{...rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
  for(const flag of VANILLA_MOVE_FLAGS)expect(html).toContain(flag.label);
  expect(html).toContain("Healing (expanded)");expect(html).toMatch(/value="268" selected/);
  expect(html).not.toContain("Missing custom flag 255");
 });
});
