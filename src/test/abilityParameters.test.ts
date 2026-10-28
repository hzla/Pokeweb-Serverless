import { describe, it, expect } from "vitest";
import { NATIVE_ABILITY_PROFILES } from "../pokeweb/abilityNativeRuntime";
import { validateAbilityRule, EMPTY_ABILITY_RULE } from "../pokeweb/abilityRules";
import { buildAbilityRuleModule, inspectAbilityEffects, ABILITY_EFFECTS_DLL_PATH } from "../pokeweb/abilityEffectsModel";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";
import { writeRpm } from "../pokeweb/rpm";
import { readU16 } from "../nds/binary";
import { renderItemRuleForm } from "../ui/itemRuleEditor";
import { ABILITY_NATIVE_EFFECTS, ABILITY_RULE_EFFECTS } from "../pokeweb/abilityRules";
const catalog=NATIVE_ABILITY_PROFILES.flatMap(p=>(p.parameters??[]).map(control=>({profile:p,control})));
describe("native ability recipe parameters",()=>{
 it("has typed, uniquely named controls with checked call/instruction sites",()=>{
  expect(catalog.length).toBeGreaterThan(130);
  for(const p of NATIVE_ABILITY_PROFILES){expect(new Set(p.parameters?.map(c=>c.key)).size).toBe(p.parameters?.length??0);for(const c of p.parameters??[]){expect(Number.isFinite(c.original)).toBe(true);expect(c.sites.length).toBeGreaterThan(0);}}
 });
 it.each([[0,0],[0x1800,0x3000]])("builds every exposed parameter at a shifted layout (%i,%i)",(shift,move)=>{
  const {project}=makeItemEffectsProject(shift,move,true,true),before=project.overlays[167]!.slice();
  for(const {profile,control} of catalog){
   const value=control.choices?.find(v=>v!==control.original)??(control.min===control.original?control.max:control.min);
   const rule=validateAbilityRule({effects:[{kind:`nativeAbility:${profile.id}`,value:-1,parameters:{[control.key]:value}}],conditions:EMPTY_ABILITY_RULE.conditions});
   const rpm=buildAbilityRuleModule(project,new Map([[165,rule]]));
   expect(rpm.code.length+rpm.bssSize,`${profile.id}/${control.key}`).toBeLessThan(65536);
   expect(JSON.parse(String(rpm.metadata.PokewebAbilityRules))[0][1].effects[0].parameters[control.key]).toBe(value);
  }
  expect(project.overlays[167]).toEqual(before);
 });
 it("preserves independent Overgrow knobs and canonical ROM metadata",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),rule=validateAbilityRule({effects:[{kind:"nativeAbility:65",value:-1,parameters:{type:17,hpThreshold:50,power:2.5}}],conditions:EMPTY_ABILITY_RULE.conditions});
  const rpm=buildAbilityRuleModule(project,new Map([[165,rule]]));project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project).rules.get(165)).toEqual(rule);
  const bad=structuredClone(rpm);bad.code[bad.code.length-1]^=1;project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(bad,{ident:"DLXF"});expect(inspectAbilityEffects(project).editable).toBe(false);
 });
 it("removes Insomnia's Yawn callback when both selected protections change",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),rule=validateAbilityRule({effects:[{kind:"nativeAbility:15",value:-1,parameters:{immunityStatus:4,extraImmunity:3}}],conditions:EMPTY_ABILITY_RULE.conditions});
  const rpm=buildAbilityRuleModule(project,new Map([[165,rule]])),data=rpm.symbols.find(s=>s.type==="SECTION"&&s.size>=512&&readU16(rpm.code,s.address+330)===512)!;
  const at=data.address+512,start=at+4+rpm.code[at+1]*4;expect(rpm.code[start+14]).toBe(5);
 });
 it("rejects unknown knobs, wrong types, out of range values and unsupported primitive parameters",()=>{
  for(const parameters of [{unknown:1},{type:18},{type:NaN},{power:0},{hpThreshold:100.01},{hpThreshold:1.234}] as Record<string,number>[])expect(()=>validateAbilityRule({effects:[{kind:"nativeAbility:65",value:-1,parameters}],conditions:EMPTY_ABILITY_RULE.conditions})).toThrow(/parameter/u);
  expect(()=>validateAbilityRule({effects:[{kind:"attack",value:2,parameters:{type:1}}],conditions:EMPTY_ABILITY_RULE.conditions})).toThrow();
 });
 it("renders both Thick Fat types, coupled Limber status, and all Overgrow settings",()=>{
  const {project}=makeItemEffectsProject(),options={ability:true,definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS]};
  for(const id of [47,7,65]){const p=NATIVE_ABILITY_PROFILES.find(p=>p.id===id)!,html=renderItemRuleForm(project,{effects:[{kind:`nativeAbility:${id}`,value:-1}],conditions:EMPTY_ABILITY_RULE.conditions,consumable:false},options);for(const c of p.parameters!)expect(html).toContain(`data-rule-native-parameter="${c.key}"`);}
 });
 it.each([[0,0],[0x1800,0x3000]])("retains Poison Touch's registration priority and editable status/chance (%i,%i)",(shift,move)=>{
  const {project,base,offsets}=makeItemEffectsProject(shift,move,true,true),before=project.overlays[167]!.slice();
  const profile=NATIVE_ABILITY_PROFILES.find(p=>p.id===143)!;
  expect(profile.priority).toBe(4);expect(NATIVE_ABILITY_PROFILES.some(p=>p.id===100)).toBe(false);
  for(const status of [1,2,3,4,5])for(const chance of [0,30,100]){
   const rule=validateAbilityRule({effects:[{kind:"nativeAbility:143",value:-1,parameters:{contactStatus:status,activationChance:chance}},{kind:"nativeAbility:3",value:-1}],conditions:EMPTY_ABILITY_RULE.conditions}),rpm=buildAbilityRuleModule(project,new Map([[255,rule]]));
   const swapHook=rpm.relocations.find(r=>r.target.module==="167"&&r.target.address===base+offsets.get("AbilityEvent_Swap")!);
   expect(rpm.symbols[swapHook!.sourceSymbolIndex].name).toBe("AbilitySwap");expect(rpm.symbols.some(s=>s.name==="AbilityContactEvents")).toBe(true);
   project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
   expect(inspectAbilityEffects(project).rules.get(255)).toEqual(rule);
  }
  expect(project.overlays[167]).toEqual(before);
  const html=renderItemRuleForm(project,{effects:[{kind:"nativeAbility:143",value:-1}],conditions:EMPTY_ABILITY_RULE.conditions,consumable:false},{ability:true,definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS]});
  expect(html).toContain("Inflicted status");expect(html).toContain("Activation chance (%)");
  project.overlays[167]![offsets.get("numHandlersWithHandlerPri")!]^=1;
  expect(()=>buildAbilityRuleModule(project,new Map([[255,validateAbilityRule({effects:[{kind:"nativeAbility:143",value:-1}],conditions:EMPTY_ABILITY_RULE.conditions})]]))).toThrow(/unrecognized|modified/u);
 });
 it("rejects invalid Poison Touch status and chance settings",()=>{
  for(const parameters of [{contactStatus:6},{contactStatus:0},{activationChance:-1},{activationChance:101},{activationChance:1.5}] as Record<string,number>[])expect(()=>validateAbilityRule({effects:[{kind:"nativeAbility:143",value:-1,parameters}],conditions:EMPTY_ABILITY_RULE.conditions})).toThrow(/parameter/u);
 });
});
