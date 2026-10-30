import {describe,it,expect} from "vitest";
import {ABILITY_IMPORT_LIBRARY,abilityImport} from "../pokeweb/abilityLibrary";
import {validateAbilityRule,encodeAbilityRules} from "../pokeweb/abilityRules";
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from "../pokeweb/abilityEffectsModel";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {writeRpm} from "../pokeweb/rpm";
import {readU16} from "../nds/binary";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {ABILITY_RULE_EFFECTS,ABILITY_NATIVE_EFFECTS} from "../pokeweb/abilityRules";
import classes from "../assets/data/abilityMoveClasses.json";

describe("standalone ability imports",()=>{
 it("provides uniquely identified, editable recipes across generations 6–9",()=>{
  expect(new Set(ABILITY_IMPORT_LIBRARY.map(t=>t.id)).size).toBe(ABILITY_IMPORT_LIBRARY.length);expect(new Set(ABILITY_IMPORT_LIBRARY.map(t=>t.generation))).toEqual(new Set([6,7,8,9]));
  for(const t of ABILITY_IMPORT_LIBRARY){expect(t.id).toBeGreaterThan(164);expect(t.defaultName.length).toBeLessThanOrEqual(15);expect(validateAbilityRule(t.rule)).toEqual(t.rule);}
  const copy=abilityImport(297);copy.rule.effects[0].parameters!.type=16;expect(abilityImport(297).rule.effects[0].parameters!.type).toBe(4);
  expect(()=>abilityImport(226)).toThrow(); // No terrain-engine import.
 });
 it.each([[0,0],[0x1800,0x3000]])("builds and reopens all imports in one module at layout (%i,%i)",(shift,move)=>{
  const {project}=makeItemEffectsProject(shift,move,true,true),before=project.overlays[167]!.slice();
  const rules=new Map(ABILITY_IMPORT_LIBRARY.map((t,i)=>[165+i,t.rule])),rpm=buildAbilityRuleModule(project,rules);
  expect(rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(65536);expect(writeRpm(rpm,{ident:"DLXF"}).length+rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(112*1024);
  expect(rpm.relocations.filter(r=>r.target.module==="167")).toHaveLength(10);expect(project.overlays[167]).toEqual(before);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project).rules).toEqual(rules);
  const changed=structuredClone(rpm);changed.code[changed.code.length-1]^=1;project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(changed,{ident:"DLXF"});expect(inspectAbilityEffects(project).editable).toBe(false);
 });
 it("keeps catalog identities independent of the assigned ROM slot",()=>{
  const rule=abilityImport(297).rule,bytes=encodeAbilityRules(new Map([[165,rule]]));expect(readU16(bytes,330)).toBe(512);expect(bytes[512+8+12]).toBe(11);
  expect(()=>encodeAbilityRules(new Map([[297,rule]]))).toThrow();
 });
 it("separates Slush Rush from Sand Rush's immunity and includes draining moves in Triage",()=>{
  expect(abilityImport(202).rule).toEqual(validateAbilityRule({effects:[{kind:"speed",value:2,bypassable:false}],conditions:{kind:"weather",value:3}}));
  expect(abilityImport(205).rule.effects[0].parameters).toEqual({moveClass:12});
  expect(abilityImport(263).rule.effects[0].parameters?.type).toBe(15); // BW2 Dragon, followed by Dark (16).
  expect(classes.classes.healing).toContain(409);expect(classes.classes.healing).toContain(105);
  for(const kind of ["ability:power","ability:priority","ability:immunity","ability:hitStat"]as const)expect(()=>validateAbilityRule({effects:[{kind,value:1,parameters:{moveClass:11}}],conditions:{kind:"group",mode:"all",children:[]}})).toThrow();
 });
 it("validates editable library parameters and encodes stat targets and signed stages",()=>{
  const rule=validateAbilityRule({effects:[{kind:"ability:hitStat",value:-2,parameters:{moveClass:9,type:17,stat:3,target:1,activationChance:67}}],conditions:{kind:"group",mode:"all",children:[]}}),b=encodeAbilityRules(new Map([[165,rule]])),at=512+8;
  expect(Array.from(b.slice(at,at+10))).toEqual([133,9,254,255,17,1,67,0,3,1]);
  for(const parameters of [{moveClass:14},{type:18},{stat:0},{target:2},{activationChance:101},{bad:1}]as Record<string,number>[])expect(()=>validateAbilityRule({...rule,effects:[{...rule.effects[0],parameters}]})).toThrow();
  expect(()=>validateAbilityRule({...rule,effects:[{...rule.effects[0],value:0}]})).toThrow();
  expect(()=>validateAbilityRule({...rule,effects:[]})).toThrow();
 });
 it("renders a blank draft and grouped imports without creating a default effect",()=>{
  const {project}=makeItemEffectsProject();const options={ability:true,definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS],presets:ABILITY_IMPORT_LIBRARY.map(t=>({...t,group:`Generation ${t.generation}`}))};
  const blank=renderItemRuleForm(project,{effects:[],conditions:{kind:"group",mode:"all",children:[]},consumable:false},options);expect(blank).toContain("Import effects");expect(blank).toContain('label="Generation 9"');expect(blank).not.toContain('data-rule-effect-kind=');
  const html=renderItemRuleForm(project,{...abilityImport(292).rule,consumable:false},options);expect(html).toContain("Move filter");expect(html).toContain("Slicing");expect(html).toContain("Mold Breaker can bypass");
 });
 it("keeps classifications bounded and avoids treating reused ROM flag bits as modern flags",()=>{
  for(const ids of Object.values(classes.classes)){expect(ids).toEqual([...new Set(ids)].sort((a,b)=>a-b));expect(ids.every(id=>id>0&&id<=559)).toBe(true);}
  expect(classes.classes.healing).toContain(409);expect(classes.classes.healing).toContain(105);expect(classes.classes.ball).not.toContain(418);expect(classes.classes.slicing).toContain(163);expect(classes.classes.bite).toContain(242);expect(classes.classes.pulse).toContain(352);
 });
});
