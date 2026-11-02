import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { customMoveFlagFilter, customMoveFlagId, customMoveFlagName, emptyCustomMoveFlags, encodeCustomMoveFlags, validateCustomMoveFlags, type CustomMoveFlagRegistry } from "../pokeweb/customMoveFlags";
import { ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects, inspectCustomMoveFlags, inspectMoveDllFlags } from "../pokeweb/abilityEffectsModel";
import { ABILITY_RULE_EFFECTS, validateAbilityRule } from "../pokeweb/abilityRules";
import { abilityImport } from "../pokeweb/abilityLibrary";
import { renderItemRuleForm } from "../ui/itemRuleEditor";
import { renderMoveDllFlags } from "../ui/moveDllFlagsEditor";
import { readU16 } from "../nds/binary";
import { writeRpm } from "../pokeweb/rpm";
import { makeBw1AbilityProject } from "./fixtures/blackAbilityProject";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";
const registry: CustomMoveFlagRegistry={version:1,nextId:3,flags:[{id:1,name:"Kick",moves:[24,26,67]},{id:2,name:"Charged",moves:[24,999]}]};
const rule=validateAbilityRule({effects:[{kind:"ability:power",value:1.5,parameters:{moveClass:14}}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"weather",value:3},{kind:"type",value:1}]}]}});
function fixture(game:"B"|"W"|"W2"){
  const project=game==="W2"?makeItemEffectsProject(0,0,true,true).project:makeBw1AbilityProject(game).project;
  project.narcs.moves={name:"moves",fileId:0,sourcePath:"a/0/2/1",fileCount:1200,rawFiles:[],records:new Map(),dirty:new Set()};
  return project;
}
describe("custom move flags",()=>{
  it("keeps independent tags, stable IDs and sorted sparse assignments",()=>{
    expect(customMoveFlagId(14)).toBe(1);expect(customMoveFlagId(255)).toBe(242);expect(customMoveFlagId(13)).toBeUndefined();expect(customMoveFlagFilter(1)).toBe(14);
    const bytes=encodeCustomMoveFlags({...registry,flags:[...registry.flags].reverse()});
    expect(readU16(bytes,0)).toBe(5);
    expect(Array.from({length:10},(_,i)=>readU16(bytes,2+i*2))).toEqual([24,1,24,2,26,1,67,1,999,2]);
    expect(validateCustomMoveFlags({...registry,flags:[]})).toEqual({version:1,nextId:3,flags:[]});
  });
  it("rejects duplicate names, ambiguous IDs, invalid moves and oversized registries",()=>{
    for(const bad of [null,{...registry,version:2},{...registry,nextId:1},{...registry,flags:[registry.flags[0],{...registry.flags[1],name:"kick"}]},{...registry,flags:[registry.flags[0],registry.flags[0]]},{...registry,flags:[{...registry.flags[0],moves:[24,24]}]},{...registry,flags:[{...registry.flags[0],moves:[65536]}]}])expect(()=>validateCustomMoveFlags(bad)).toThrow();
    for(const name of ["", "Wind", "x".repeat(33), "Kick\nBoost"])expect(()=>customMoveFlagName(name)).toThrow();
    expect(customMoveFlagName("  Kick  moves ")).toBe("Kick moves");
    expect(()=>encodeCustomMoveFlags({version:1,nextId:2,flags:[{id:1,name:"Kick",moves:Array.from({length:4097},(_,i)=>i)}]})).toThrow(/assignments/);
  });
  it.each(["B","W","W2"]as const)("reopens flags-only %s and preserves them when recipes are installed",game=>{
    const project=fixture(game),before=project.overlays[game==="W2"?167:93]!.slice();
    const module=buildAbilityRuleModule(project,new Map(),undefined,registry);
    expect(module.relocations.some(r=>r.target.module!=="base")).toBe(false);
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(module,{ident:"DLXF"})}};
    expect(inspectCustomMoveFlags(project)).toMatchObject({editable:true,registry,references:{}});
    const next=buildAbilityRuleModule(project,new Map([[165,rule],[166,abilityImport(274).rule]]));
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
    expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION});
    expect(inspectCustomMoveFlags(project)).toMatchObject({registry,references:{1:[165]}});
    expect(project.overlays[game==="W2"?167:93]).toEqual(before);
  });
  it("keeps a hundred custom definitions in the same bounded shared module",()=>{
    const flags=Array.from({length:100},(_,i)=>({id:i+1,name:`Tag ${i+1}`,moves:[24,26]}));
    const module=buildAbilityRuleModule(fixture("W2"),new Map([[165,rule]]),undefined,{version:1,nextId:101,flags});
    expect(module.code.length+module.bssSize).toBeLessThanOrEqual(65536);
    expect(writeRpm(module,{ident:"DLXF"}).length+module.code.length+module.bssSize).toBeLessThanOrEqual(112*1024);
    expect(JSON.parse(String(module.metadata.PokewebCustomMoveFlags)).flags).toHaveLength(100);
  });
  it("requires every custom filter to reference a registered flag",()=>{
    expect(()=>buildAbilityRuleModule(fixture("B"),new Map([[165,rule]]))).toThrow(/missing/);
    for(const kind of ["ability:power","ability:damage","ability:damageTaken","ability:immunity","ability:hitStat","ability:priority","abilityRecipe:convertType","abilityRecipe:statAction","abilityRecipe:allyPower","abilityRecipe:perish","abilityRecipe:windAbsorb","abilityRecipe:moveGuard"] as const){
      const effect=ABILITY_RULE_EFFECTS.find(e=>e.kind===kind)!;
      const custom=validateAbilityRule({effects:[{kind,value:effect.value,parameters:{moveClass:255}}],conditions:{kind:"group",mode:"all",children:[]}});
      expect(()=>buildAbilityRuleModule(fixture("B"),new Map([[165,custom]]),undefined,{version:1,nextId:243,flags:[{id:242,name:"Last tag",moves:[24]}]})).not.toThrow();
    }
  });
  it("exposes custom names in both move assignments and ability filters without repurposing built-ins",()=>{
    const project=fixture("B"),module=buildAbilityRuleModule(project,new Map([[165,rule]]),new Map([[24,34]]),registry);
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(module,{ident:"DLXF"})}};
    const row=renderMoveDllFlags(project,24);expect(row).toContain('aria-label="Custom flag Kick" checked');expect(row).toContain("Manage flags");expect(row).toContain("Add flag");expect(row).toContain("custom-move-flag-remove");
    expect(inspectMoveDllFlags(project,24)).toMatchObject({flags:34,editable:true});
    const html=renderItemRuleForm(project,{...rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
    expect(html).toContain('value="14" selected>Custom: Kick');expect(html).toContain("Pulse");expect(html).toContain("Wind");
  });
  it.each(["base","recipes","scoped"])("recognizes retained v4 %s and upgrades without losing saved flags",name=>{
    const project=fixture("W2"),old=new Uint8Array(readFileSync(new URL(`./fixtures/ability-runtime-v4/${name}.dll`,import.meta.url)));
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:old}};
    const state=inspectAbilityEffects(project);expect(state.editable,state.message).toBe(true);expect(state.runtimeVersion).toBe(4);
    const next=buildAbilityRuleModule(project,state.rules,new Map([[33,34]]));
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
    expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:5,rules:state.rules});
    expect(inspectCustomMoveFlags(project).registry).toEqual(emptyCustomMoveFlags());
  });
});
