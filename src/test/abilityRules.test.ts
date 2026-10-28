import { describe,it,expect } from "vitest";
import { validateAbilityRule,encodeAbilityRules,EMPTY_ABILITY_RULE,ABILITY_RULE_PRESETS } from "../pokeweb/abilityRules";
import { buildAbilityRuleModule,inspectAbilityEffects,nextCustomAbilityId,clearAbilityRules,ABILITY_EFFECTS_DLL_PATH } from "../pokeweb/abilityEffectsModel";
import { NATIVE_ABILITY_PROFILES } from "../pokeweb/abilityNativeRuntime";
import { readU16,writeU32 } from "../nds/binary";
import { writeRpm } from "../pokeweb/rpm";
import { renderItemRuleForm } from "../ui/itemRuleEditor";
import { ABILITY_RULE_EFFECTS,ABILITY_NATIVE_EFFECTS } from "../pokeweb/abilityRules";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

describe("composable ability rules",()=>{
 it("keeps ID zero reserved and encodes both ID boundaries",()=>{
  const bytes=encodeAbilityRules(new Map([[1,EMPTY_ABILITY_RULE],[255,{effects:[{kind:"healFlat",value:11}],conditions:{kind:"hp",comparison:"lte",percent:50}}]]));
  expect(readU16(bytes,0)).toBe(0);expect(readU16(bytes,2)).toBe(512);const at=readU16(bytes,510);expect(bytes[at]).toBe(1);expect(readU16(bytes,at+10)).toBe(11);
  for(const id of [0,256,-1,1.5])expect(()=>encodeAbilityRules(new Map([[id,EMPTY_ABILITY_RULE]]))).toThrow();
 });
 it("preserves nested conditions and individual bypass flags",()=>{
  const rule=validateAbilityRule({effects:[{kind:"defense",value:2},{kind:"healFlat",value:5},{kind:"specialDefense",value:1.5,bypassable:false}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lt",percent:50},{kind:"group",mode:"any",children:[{kind:"type",value:17},{kind:"weather",value:3}]}]}});
  expect(rule.effects.map(e=>e.bypassable)).toEqual([true,false,false]);expect(rule.conditions.kind).toBe("group");
  const bytes=encodeAbilityRules(new Map([[255,rule]])),at=readU16(bytes,510),effects=at+4+bytes[at+1]*4;expect([bytes[effects+7],bytes[effects+23],bytes[effects+39]]).toEqual([1,0,0]);
 });
 it("validates native weather/multiplier/chance edits against the actual operands",()=>{
  expect(validateAbilityRule({effects:[{kind:"nativeAbility:146",value:2.5,weather:3}],conditions:EMPTY_ABILITY_RULE.conditions}).effects[0]).toMatchObject({weather:3,value:2.5});
  expect(validateAbilityRule({effects:[{kind:"nativeAbility:49",value:-1,chance:100}],conditions:EMPTY_ABILITY_RULE.conditions}).effects[0].chance).toBe(100);
  for(const effect of [{kind:"nativeAbility:49" as const,value:-1,weather:3},{kind:"nativeAbility:146" as const,value:-1,chance:50},{kind:"nativeAbility:146" as const,value:2.3},{kind:"nativeAbility:999" as const,value:-1},{kind:"native:234" as const,value:-1}])expect(()=>validateAbilityRule({effects:[effect],conditions:EMPTY_ABILITY_RULE.conditions})).toThrow();
 });
 it("rejects unsafe, duplicate or unsupported compositions",()=>{
  for(const effects of [[],Array.from({length:17},()=>({kind:"attack" as const,value:2})),[{kind:"attack" as const,value:2},{kind:"attack" as const,value:2}],[{kind:"moveLock" as const,value:1}],[{kind:"healDivisor" as const,value:0}],[{kind:"attack" as const,value:NaN}]])expect(()=>validateAbilityRule({effects,conditions:EMPTY_ABILITY_RULE.conditions})).toThrow();
 });
 it("validates and preserves the copied Intimidate stat selector",()=>{
  const rule=validateAbilityRule({effects:[{kind:"nativeAbility:22",value:-1,stat:3}],conditions:EMPTY_ABILITY_RULE.conditions});
  expect(rule.effects[0]).toEqual({kind:"nativeAbility:22",value:-1,stat:3,bypassable:true});
  for(const stat of [0,8,1.5,NaN])expect(()=>validateAbilityRule({...rule,effects:[{...rule.effects[0],stat}]})).toThrow(/stat/u);
  expect(()=>validateAbilityRule({...rule,effects:[{kind:"nativeAbility:146",value:-1,stat:3}]})).toThrow(/stat/u);
 });
 it.each(ABILITY_RULE_PRESETS)("validates the $label starting composition",p=>expect(validateAbilityRule(p.rule).effects.length).toBeGreaterThan(0));
 it("stops creating IDs after 255 and recognizes named custom entries",()=>{
  const {project}=makeItemEffectsProject();project.texts.banks.abilities=Array.from({length:165},(_,i)=>`Ability ${i}`);expect(nextCustomAbilityId(project)).toBe(165);project.texts.banks.abilities[255]="Last";expect(nextCustomAbilityId(project)).toBeUndefined();
 });
 it.each([[0,0],[0x1800,0x3000]])("builds native copies at shifted layouts (%i,%i)",(shift,move)=>{
  const {project,base,offsets}=makeItemEffectsProject(shift,move,true,true),before=project.overlays[167]!.slice();
  const rule=validateAbilityRule({effects:[{kind:"nativeAbility:146",value:2.5,weather:3}],conditions:EMPTY_ABILITY_RULE.conditions}),rpm=buildAbilityRuleModule(project,new Map([[255,rule]]));
  expect(rpm.relocations.filter(r=>r.target.module==="167")).toHaveLength(2);expect(rpm.relocations.filter(r=>r.target.module==="167"&&r.target.type==="THUMB_BRANCH_SAFESTACK")).toHaveLength(1);expect(rpm.bssSize).toBeGreaterThan(14000);
  const p=NATIVE_ABILITY_PROFILES.find(p=>p.id===146)!,source=offsets.get("HandlerSandRush")!,copy=rpm.symbols.find(s=>s.type==="FUNCTION_THM"&&!(s.attributes&4)&&s.size===38&&rpm.code[s.address+24]===3)!;
  expect(copy).toBeDefined();expect(rpm.code[copy.address+8]*2**(readU16(rpm.code,copy.address+30)>>6&31)).toBe(10240);expect(project.overlays[167]).toEqual(before);expect(before[source+24]).toBe(4);expect(p.events).toHaveLength(2);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project).rules.get(255)).toEqual(rule);clearAbilityRules(project,255);expect(inspectAbilityEffects(project).rules.size).toBe(0);
  const bad=structuredClone(rpm);bad.code[0]^=1;project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(bad,{ident:"DLXF"});expect(inspectAbilityEffects(project).editable).toBe(false);
  writeU32(project.overlays[167]!,source,0);expect(()=>buildAbilityRuleModule(project,new Map([[255,rule]]))).toThrow();expect(base).toBeGreaterThan(0);
 });
 it("fits 255 simple edited abilities in one bounded module",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),rules=new Map(Array.from({length:255},(_,i)=>[i+1,validateAbilityRule(EMPTY_ABILITY_RULE)]));
  const rpm=buildAbilityRuleModule(project,rules);expect(rpm.relocations.filter(r=>r.target.module==="167")).toHaveLength(2);expect(rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(65536);expect(writeRpm(rpm,{ident:"DLXF"}).length+rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(112*1024);
  expect(JSON.parse(String(rpm.metadata.PokewebAbilityRules))).toHaveLength(255);
 });
 it.each([[0,0],[0x1800,0x3000]])("isolates copied Intimidate's stat from its drop and flag (%i,%i)",(shift,move)=>{
  const {project,offsets}=makeItemEffectsProject(shift,move,true,true),before=project.overlays[167]!.slice();
  const rules=new Map([3,1,7].map((stat,i)=>[165+i,validateAbilityRule({effects:[{kind:"nativeAbility:22",value:-1,stat}],conditions:EMPTY_ABILITY_RULE.conditions})]));
  const rpm=buildAbilityRuleModule(project,rules),helpers=rpm.symbols.filter(s=>s.type==="FUNCTION_THM"&&s.size===8&&readU16(rpm.code,s.address+6)===0x4770);
  expect(helpers.map(s=>Array.from(rpm.code.slice(s.address,s.address+8)))).toEqual([[3,0x20,0x48,0x60,0x90,0x1e,0x70,0x47],[7,0x20,0x48,0x60,0x90,0x1e,0x70,0x47]]);
  const copies=rpm.symbols.filter(s=>s.type==="FUNCTION_THM"&&!(s.attributes&4)&&s.size===130);expect(copies).toHaveLength(3);
  for(const s of copies){expect(readU16(rpm.code,s.address+0x52)).toBe(0x2201);expect(readU16(rpm.code,s.address+0x58)).toBe(0x7308);expect(readU16(rpm.code,s.address+0x5a)).toBe(0x738a);}
  expect(copies.filter(s=>readU16(rpm.code,s.address+0x54)===0x604a)).toHaveLength(1);
  expect(rpm.relocations.filter(r=>helpers.some(s=>rpm.symbols[r.sourceSymbolIndex]===s))).toHaveLength(2);
  expect(project.overlays[167]).toEqual(before);expect(readU16(before,offsets.get("HandlerIntimidateMemberIn")!+0x54)).toBe(0x604a);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project).rules).toEqual(rules);
  project.overlays[167]![offsets.get("HandlerIntimidateMemberIn")!+0x52]^=1;
  expect(inspectAbilityEffects(project).editable).toBe(false);expect(()=>buildAbilityRuleModule(project,rules)).toThrow(/unrecognized|modified/u);
 });
 it("renders native weather edits, bypass controls and ability presets without consumption",()=>{
  const {project}=makeItemEffectsProject();const html=renderItemRuleForm(project,{effects:[{kind:"nativeAbility:146",value:2.5,weather:3}],conditions:EMPTY_ABILITY_RULE.conditions,consumable:false},{ability:true,definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS],presets:ABILITY_RULE_PRESETS});
  expect(html).toContain('data-rule-native-weather');expect(html).toContain('value="3" selected');expect(html).toContain('data-rule-bypass');expect(html).not.toContain('data-rule-consumable');
 });
 it("shows the copied Intimidate stat without damage-event targeting controls",()=>{
  const {project}=makeItemEffectsProject();const html=renderItemRuleForm(project,{effects:[{kind:"nativeAbility:22",value:-1,stat:3}],conditions:EMPTY_ABILITY_RULE.conditions,consumable:false},{ability:true,definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS]});
  expect(html).toContain("Stat lowered");expect(html).toContain('value="3" selected>Sp. Atk');expect(html).not.toContain("data-rule-trigger");expect(html).not.toContain("data-rule-target");
 });
});
