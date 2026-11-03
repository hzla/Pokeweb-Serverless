import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { abilityImport } from "../pokeweb/abilityLibrary";
import { ABILITY_GROUP_STAGE_KEYS, abilityConditionMask } from "../pokeweb/abilityRecipeEffects";
import { abilityWorkSlots, optimizeAbilityRule, abilityExecutionSignature } from "../pokeweb/abilityRecipeOptimization";
import { encodeAbilityRules, EMPTY_ABILITY_RULE, validateAbilityRule, type AbilityRuleEffect, type AbilityRuleSet } from "../pokeweb/abilityRules";
import { ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, inspectAbilityEffects, CURRENT_ABILITY_RUNTIME_VERSION } from "../pokeweb/abilityEffectsModel";
import { writeRpm } from "../pokeweb/rpm";
import { renderItemRuleForm } from "../ui/itemRuleEditor";
import { ABILITY_RULE_EFFECTS } from "../pokeweb/abilityRules";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

const rule=(effects:AbilityRuleEffect[])=>validateAbilityRule({effects,conditions:EMPTY_ABILITY_RULE.conditions});
describe("compact ability execution",()=>{
  it("uses one editable condition set for Aroma Veil and preserves legacy source recipes",()=>{
    const original=rule([7,11,12,13,15,23].map(condition=>({kind:"abilityRecipe:statusGuard",value:1,parameters:{condition,scope:1}})));
    const optimized=validateAbilityRule(optimizeAbilityRule(original));
    expect(original.effects).toHaveLength(6);expect(optimized.effects).toHaveLength(1);
    expect(optimized.effects[0]).toMatchObject({kind:"abilityRecipe:statusGuardSet",parameters:{conditionMask:abilityConditionMask([7,11,12,13,15,23]),scope:1,cure:0}});
    expect(encodeAbilityRules(new Map([[165,original]])).length-encodeAbilityRules(new Map([[165,optimized]])).length).toBe(80);
    expect(abilityImport(165).rule.effects).toHaveLength(1);
    expect(abilityImport(166).rule.effects).toHaveLength(2);
    expect(abilityImport(175).rule.effects).toHaveLength(1);
  });
  it("packs grouped signed changes and retains Anger Shell's stat order",()=>{
    const grouped=abilityImport(271).rule;expect(grouped.effects).toHaveLength(1);
    expect(grouped.effects[0]).toMatchObject({kind:"abilityRecipe:statGroup",parameters:{activation:2,threshold:50,attackStages:1,specialAttackStages:1,speedStages:1,defenseStages:-1,specialDefenseStages:-1}});
    const order=grouped.effects[0].parameters!.statOrder;
    expect(Array.from({length:5},(_,n)=>order>>>(n*3)&7)).toEqual([1,3,5,2,4]);
    const bytes=encodeAbilityRules(new Map([[165,grouped]])),at=readU16(bytes,330),e=at+4+bytes[at+1]*4;
    expect(bytes[e]).toBe(167);const packed=new DataView(bytes.buffer).getUint32(e+2,true);
    expect(ABILITY_GROUP_STAGE_KEYS.map((_,i)=>{const n=packed>>>(i*4)&15;return n&8?n-16:n;})).toEqual([1,-1,1,-1,1,0,0]);
    expect(()=>rule([{kind:"abilityRecipe:statGroup",value:1}])).toThrow(/stat change/);
    expect(()=>rule([{kind:"abilityRecipe:statGroup",value:1,parameters:{attackStages:7}}])).toThrow();
  });
  it("combines disjoint type filters while retaining overlapping multipliers",()=>{
    const steam=abilityImport(243).rule;expect(steam.effects).toHaveLength(1);
    expect(steam.effects[0]).toMatchObject({kind:"ability:hitStat",parameters:{types:1<<9|1<<10,stat:5}});
    const a:AbilityRuleEffect={kind:"ability:damageTaken",value:.5,parameters:{moveClass:9,types:1<<9|1<<14}};
    const b:AbilityRuleEffect={kind:"ability:damageTaken",value:.5,parameters:{moveClass:9,type:9}};
    expect(optimizeAbilityRule(rule([a,b])).effects).toHaveLength(2);
    for(const types of [0,0x40000,1.5])expect(()=>rule([{...a,parameters:{moveClass:9,types}}])).toThrow();
    expect(abilityExecutionSignature(rule([b]))).toBe(abilityExecutionSignature(rule([{...b,parameters:{moveClass:9,types:1<<9}}])));
  });
  it("keeps different protection scopes, cure ordering, bypass settings and repeated stats separate",()=>{
    const guard:AbilityRuleEffect={kind:"abilityRecipe:statusGuard",value:1,parameters:{condition:1,scope:1}};
    const others:AbilityRuleEffect[]=[{...guard,parameters:{condition:2,scope:0}},{...guard,parameters:{condition:2,scope:1,cure:1}},{...guard,parameters:{condition:2,scope:1},bypassable:false}];
    for(const next of others)expect(optimizeAbilityRule(rule([guard,next])).effects).toHaveLength(2);
    const stage:AbilityRuleEffect={kind:"abilityRecipe:statAction",value:1,parameters:{stat:1}};
    expect(optimizeAbilityRule(rule([stage,{...stage,value:2}])).effects).toHaveLength(2);
  });
  it("deduplicates immutable records without changing ability IDs or metadata",()=>{
    const r=rule([{kind:"nativeAbility:22",value:-1,stat:3}]),rules=new Map([[165,r],[255,r]]);
    const old=encodeAbilityRules(rules),packed=encodeAbilityRules(rules,true);
    expect(readU16(old,330)).not.toBe(readU16(old,510));expect(readU16(packed,330)).toBe(readU16(packed,510));
    const {project}=makeItemEffectsProject(0,0,true,true),rpm=buildAbilityRuleModule(project,rules);
    const targets=rpm.relocations.filter(r=>r.target.module==="base"&&rpm.symbols[r.sourceSymbolIndex].type==="SECTION");
    expect(new Set(targets.map(r=>r.target.address)).size).toBe(targets.length);
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
    expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules});
    rpm.metadata.PokewebAbilityWorkSlots=8;project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:"DLXF"});
    expect(inspectAbilityEffects(project).editable).toBe(false);
  });
  it("selects bounded work variants from execution requirements",()=>{
    const make=(count:number):AbilityRuleSet=>rule(Array.from({length:count},(_,i)=>({kind:"attack",value:1+i*.125})));
    const {project}=makeItemEffectsProject(0,0,true,true),sizes:number[]=[];
    for(const [count,slots] of [[1,4],[5,8],[9,16]]){
      const rules=new Map([[165,make(count)]]);expect(abilityWorkSlots(rules)).toBe(slots);
      const rpm=buildAbilityRuleModule(project,rules);expect(rpm.metadata.PokewebAbilityWorkSlots).toBe(slots);sizes.push(rpm.bssSize);
    }
    expect(sizes[1]-sizes[0]).toBe(32*4*7*4);expect(sizes[2]-sizes[1]).toBe(32*8*7*4);
  });
  it("renders condition/type checkboxes and independent grouped stat amounts",()=>{
    const {project}=makeItemEffectsProject(0,0,true,true);
    const render=(r:AbilityRuleSet)=>renderItemRuleForm(project,{...r,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
    const guard=render(abilityImport(165).rule);expect(guard).toContain('data-rule-set="conditionMask"');expect(guard).toContain("Infatuation");
    const types=render(abilityImport(243).rule);expect(types).toContain('data-rule-set="types"');expect(types).not.toContain('data-rule-native-parameter="type"');
    const stats=render(abilityImport(271).rule);expect(stats).toContain('data-rule-native-parameter="defenseStages"');expect(stats).toContain('data-rule-native-parameter="statOrder"');
  });
});
