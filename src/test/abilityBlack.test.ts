import {describe,it,expect} from "vitest";
import bindings from "../assets/data/abilityBindingsB1.json";
import {NATIVE_ABILITY_PROFILES} from "../pokeweb/abilityNativeRuntime";
import {ABILITY_IMPORT_LIBRARY} from "../pokeweb/abilityLibrary";
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH,supportsAbilityEditor} from "../pokeweb/abilityEffectsModel";
import {validateAbilityRule,EMPTY_ABILITY_RULE} from "../pokeweb/abilityRules";
import {writeRpm} from "../pokeweb/rpm";
import {makeBlackAbilityProject} from "./fixtures/blackAbilityProject";

describe("Black 1 ability profiles",()=>{
 it("exposes the same logical controls using separately checked BW1 operands",()=>{
  expect(bindings.profiles.length).toBe(157);
  for(const p of bindings.profiles){const old=NATIVE_ABILITY_PROFILES.find(o=>o.id===p.id)!;expect(p.events.map(e=>e.event)).toEqual(old.events.map(e=>e.event));
   expect((p.parameters??[]).map(({sites,...c})=>c)).toEqual((old.parameters??[]).map(({sites,...c})=>c));
   for(const c of p.parameters??[])for(const site of c.sites)expect(bindings.functions[site.handler as keyof typeof bindings.functions]).toBeDefined();
  }
 });
 it.each([[0,0],[0x1800,0x3000]])("links imports at moved code/overlay layouts %i/%i",(shift,move)=>{
  const{project}=makeBlackAbilityProject(shift,move);expect(inspectAbilityEffects(project).editable).toBe(true);
  for(const entry of ABILITY_IMPORT_LIBRARY){const rpm=buildAbilityRuleModule(project,new Map([[255,entry.rule]]));expect(rpm.metadata.PMCGameID).toBe("B");expect(rpm.relocations.some(r=>r.target.module==="167")).toBe(false);expect(rpm.relocations.some(r=>r.target.module==="93")).toBe(true);}
 },120000);
 it("reopens a shared DLL with copied parameters, conditions, priority and latest actions",()=>{
  const{project,locations,base}=makeBlackAbilityProject();const rules=new Map([[255,validateAbilityRule({effects:[{kind:"nativeAbility:22",value:-1,stat:3},{kind:"nativeAbility:143",value:-1,parameters:{activationChance:100,contactStatus:4}},{kind:"abilityRecipe:knockoutSplash",value:20}],conditions:{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}})]]);
  const rpm=buildAbilityRuleModule(project,rules);expect(rpm.relocations.some(r=>r.target.module==="93"&&rpm.symbols[r.sourceSymbolIndex]?.name==="AbilitySwap")).toBe(true);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};expect(inspectAbilityEffects(project).rules).toEqual(rules);
  project.overlays[93]![locations.get("numHandlersWithHandlerPri")!-base]^=1;expect(()=>buildAbilityRuleModule(project,rules)).toThrow(/unrecognized|modified/u);
 });
 it("rejects White 1, other revisions and modified dispatchers",()=>{
  const{project,locations,base}=makeBlackAbilityProject();project.session.baseVersion="W";expect(supportsAbilityEditor(project)).toBe(false);expect(inspectAbilityEffects(project).editable).toBe(false);
  project.session.baseVersion="B";project.overlays[93]![locations.get("AbilityEvent_AddItem")!-base]^=1;expect(()=>buildAbilityRuleModule(project,new Map([[1,EMPTY_ABILITY_RULE]]))).toThrow();
 });
});
