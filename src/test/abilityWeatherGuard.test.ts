import {describe,expect,it} from "vitest";
import {ABILITY_RULE_EFFECTS,encodeAbilityRules,validateAbilityRule} from "../pokeweb/abilityRules";
import {recipeAbilityEffect,recipeAbilityParameter} from "../pokeweb/abilityRecipeEffects";
import {abilityImport} from "../pokeweb/abilityLibrary";
import {ABILITY_EFFECTS_DLL_PATH,buildAbilityRuleModule,inspectAbilityEffects} from "../pokeweb/abilityEffectsModel";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {writeRpm} from "../pokeweb/rpm";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
const all={kind:"group" as const,mode:"all" as const,children:[]};
const guard=(weather=3)=>({kind:"abilityRecipe:weatherGuard" as const,value:1,parameters:{weather}});

describe("adjustable weather damage immunity",()=>{
  it.each([0,3,4])("encodes weather %i and preserves nested activation conditions",weather=>{
    const rule=validateAbilityRule({effects:[guard(weather)],conditions:{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"group",mode:"any",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"species",value:4}]}]}});
    expect(rule.effects[0]).toMatchObject({bypassable:false,parameters:{weather}});
    const bytes=encodeAbilityRules(new Map([[255,rule]])),start=512+4+bytes[513]*4;
    expect(Array.from(bytes.slice(start,start+8))).toEqual([154,weather,1,0,0,0,0,0]);
  });
  it("defaults to Hail and rejects non-damaging or invalid weather choices",()=>{
    expect(recipeAbilityParameter({kind:"abilityRecipe:weatherGuard",value:1},"weather")).toBe(3);
    expect(recipeAbilityEffect("abilityRecipe:weatherGuard")?.parameters[0].choices).toEqual([0,3,4]);
    for(const weather of[-1,1,2,5,3.5,NaN])expect(()=>validateAbilityRule({effects:[guard(weather)],conditions:all})).toThrow();
    for(const value of[0,2,NaN])expect(()=>validateAbilityRule({effects:[{...guard(),value}],conditions:all})).toThrow();
  });
  it.each([[0,0,false],[0x1800,0x3000,false],[0,0,true],[0x1800,0x3000,true]])("reopens one shared module with layout %i/%i and client adapter %s",(shift,move,client)=>{
    const {project}=makeItemEffectsProject(Number(shift),Number(move),true,true),before=project.overlays[167]!.slice();
    const slush=abilityImport(202).rule;
    const rule=validateAbilityRule({...slush,effects:[...slush.effects,guard(),...(client?[{kind:"nativeAbility:42" as const,value:-1}]:[])]});
    const rules=new Map([[165,rule]]),rpm=buildAbilityRuleModule(project,rules);
    expect(rpm.metadata.PokewebAbilityWeatherGuard).toBe(1);expect(rpm.metadata.PokewebAbilityPopupGroups).toBe(1);
    expect(rpm.metadata.PokewebAbilityClientTraps).toBe(client?1:undefined);
    expect(rpm.relocations.filter(r=>r.target.module==="167")).toHaveLength(client?11:10);
    expect(rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(65536);expect(writeRpm(rpm,{ident:"DLXF"}).length+rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(112*1024);
    expect(project.overlays[167]).toEqual(before);
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
    expect(inspectAbilityEffects(project).rules).toEqual(rules);
    delete rpm.metadata.PokewebAbilityWeatherGuard;
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:"DLXF"});expect(inspectAbilityEffects(project).editable).toBe(false);
    // The existing import keeps its original speed-only behavior until edited.
    expect(abilityImport(202).rule).toEqual(slush);expect(slush.effects).toHaveLength(1);
  });
  it("shows a weather selector and normal AND/OR controls",()=>{
    const html=renderItemRuleForm(makeItemEffectsProject().project,{effects:[guard()],conditions:all,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
    expect(html).toContain("Weather damage immunity");expect(html).toContain('data-rule-native-parameter="weather"');
    for(const text of["All damaging weather","Hail","Sandstorm","All (AND)","Any (OR)"])expect(html).toContain(text);
    expect(html).not.toContain('value="1">Sun');expect(html).not.toContain('value="2">Rain');
  });
});
