import { describe,it,expect } from "vitest";
import { ITEM_RECIPE_TEMPLATE_IDS,itemRulePreset } from "../pokeweb/itemRulePresets";
import { encodeItemRulesV4,validateItemRule } from "../pokeweb/itemRules";
import { itemRecipeParameter } from "../pokeweb/itemRecipeEffects";
import { buildItemRuleModule,inspectItemEffect,ITEM_EFFECTS_DLL_PATH } from "../pokeweb/itemEffectsModel";
import { readU16,readU32 } from "../nds/binary";
import { writeRpm } from "../pokeweb/rpm";
import { renderItemRuleForm } from "../ui/itemRuleEditor";
import { renderItemEffects } from "../ui/itemEffectsEditor";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

describe("parameterized item templates",()=>{
 it("encodes both Weakness Policy boosts together and Maranga's forced-use path",()=>{
  const weak=itemRulePreset(10002),maranga=itemRulePreset(10001);
  const bytes=encodeItemRulesV4(new Map([[85,weak],[86,maranga]])).bytes;
  const at=(id:number)=>readU16(bytes,id*2)+8;
  expect([...bytes.slice(at(85),at(85)+12)]).toEqual([129,18,0,4,0,2,0,2,0,0,0,0]);
  expect(bytes[at(86)+2]).toBe(2);expect(bytes[at(86)+4]).toBe(1);expect(bytes[at(86)+8]).toBe(1);
  expect(weak.consumable&&maranga.consumable).toBe(true);
 });
 it("makes all seventeen native resistance berries adjustable with Chilan's neutral exception",()=>{
  for(let id=184;id<=200;++id){
   const rule=itemRulePreset(id);rule.effects[0].value=.75;
   expect(validateItemRule(rule).effects[0].value).toBe(.75);
   expect(rule.consumable).toBe(true);
   expect(itemRecipeParameter(rule.effects[0],"superEffective")).toBe(id===200?0:1);
  }
  expect(itemRecipeParameter(itemRulePreset(10004).effects[0],"type")).toBe(17);
 });
 it("encodes adjustable Assault Vest move restrictions",()=>{
  const rule=itemRulePreset(ITEM_RECIPE_TEMPLATE_IDS.assaultVest);
  expect(rule.effects).toEqual([{kind:"specialDefense",value:1.5},{kind:"itemRecipe:moveRestriction",value:1}]);
  expect(rule.consumable).toBe(false);
  const check=(expected:number[])=>{const bytes=encodeItemRulesV4(new Map([[85,rule]])).bytes,at=readU16(bytes,170)+8+16;expect([...bytes.slice(at,at+3)]).toEqual(expected);};
  check([140,1,18]);rule.effects[1].parameters={category:0,type:9};check([140,0,9]);
  expect(()=>validateItemRule({...rule,effects:[{...rule.effects[1],parameters:{category:4}}]})).toThrow();
  const {project}=makeItemEffectsProject(0,0,true);expect(renderItemRuleForm(project,rule)).toContain("Restricted category");
 });
 it("rejects invalid parameters and empty stat groups",()=>{
  const r=itemRulePreset(10002);
  expect(()=>validateItemRule({...r,effects:[{...r.effects[0],parameters:{attack:7}}]})).toThrow();
  expect(()=>validateItemRule({...r,effects:[{...r.effects[0],parameters:{specialDefense:0}}]})).toThrow("stat change");
  expect(()=>validateItemRule({...r,effects:[{...r.effects[0],parameters:{unknown:1}}]})).toThrow();
 });
 it("links every new recipe into one verified module and preserves parameters on reopening",()=>{
  const {project,base,offsets}=makeItemEffectsProject(0,0,true);
  project.session.fairy=true;
  const rules=new Map(Object.values(ITEM_RECIPE_TEMPLATE_IDS).filter(id=>id!==ITEM_RECIPE_TEMPLATE_IDS.assaultVest).map((id,i)=>[85+i,itemRulePreset(id)]));
  const rpm=buildItemRuleModule(project,rules);
  expect(readU32(rpm.code,rpm.symbols.find(s=>s.name==="ItemRuleApi")!.address+43*4)).toBe((base+offsets.get("IsSubstituteActive")!)|1);
  expect(rpm.metadata.PMCVersion).toBe("6.0.0");expect(rpm.code.length+rpm.bssSize).toBeLessThan(65536);
  project.fileSystem={replacements:{},additions:{[ITEM_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  for(const[id,rule]of rules){const state=inspectItemEffect(project,id);expect(state.editable,state.message).toBe(true);expect(state.rules).toEqual(rule);}
 });
 it("renders stage, ratio and immunity controls and a direct path from native berries",()=>{
  const {project}=makeItemEffectsProject(0,0,true);
  expect(renderItemRuleForm(project,itemRulePreset(10002))).toContain("Attack stages");
  expect(renderItemRuleForm(project,itemRulePreset(10004))).toContain("× damage taken");
  expect(renderItemRuleForm(project,itemRulePreset(10005))).toContain("Powder");
  expect(renderItemEffects(project,184)).toContain("Customize resistance");
 });
 it("reopens a version-4 image and preserves its rules when rebuilt with version 5",()=>{
  const {project}=makeItemEffectsProject(0,0,true);
  const rules=new Map([[85,itemRulePreset(234)]]);
  const old=buildItemRuleModule(project,rules,4);
  expect(old.metadata.PMCVersion).toBe("4.0.0");
  project.fileSystem={replacements:{},additions:{[ITEM_EFFECTS_DLL_PATH]:writeRpm(old,{ident:"DLXF"})}};
  expect(inspectItemEffect(project,85).rules).toEqual(rules.get(85));
  const next=buildItemRuleModule(project,rules);
  project.fileSystem.additions![ITEM_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
  expect(inspectItemEffect(project,85).rules).toEqual(rules.get(85));
  expect(()=>buildItemRuleModule(project,new Map([[85,itemRulePreset(10002)]]),4)).toThrow("version-5");
 });
 it("verifies retained version-5 exports before migrating to version 6",()=>{
  const {project}=makeItemEffectsProject(0,0,true),rules=new Map([[85,itemRulePreset(10001)]]);
  const old=buildItemRuleModule(project,rules,5);expect(old.metadata.PMCVersion).toBe("5.0.0");
  project.fileSystem={replacements:{},additions:{[ITEM_EFFECTS_DLL_PATH]:writeRpm(old,{ident:"DLXF"})}};
  expect(inspectItemEffect(project,85).rules).toEqual(rules.get(85));
  const next=buildItemRuleModule(project,rules);expect(next.metadata.PMCVersion).toBe("6.0.0");
  expect(()=>buildItemRuleModule(project,new Map([[85,itemRulePreset(10006)]]),5)).toThrow("version-6");
 });
 it("requires Fairy support for Fairy defaults while allowing other selected types",()=>{
  const {project}=makeItemEffectsProject(0,0,true),r=itemRulePreset(10004);
  expect(()=>buildItemRuleModule(project,new Map([[85,r]]))).toThrow("Fairy-enabled");
  const glove=itemRulePreset(10011);glove.effects[0].parameters={type:17};expect(()=>buildItemRuleModule(project,new Map([[85,glove]]))).toThrow("Fairy-enabled");
  r.effects[0].parameters!.type=9;
  expect(()=>buildItemRuleModule(project,new Map([[85,r]]))).not.toThrow();
 });
});
