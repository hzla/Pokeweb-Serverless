import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {ABILITY_EFFECTS_DLL_PATH,buildAbilityRuleModule,inspectAbilityEffects} from "../pokeweb/abilityEffectsModel";
import {ABILITY_RULE_EFFECTS,encodeAbilityRules,validateAbilityRule} from "../pokeweb/abilityRules";
import {validateItemRule} from "../pokeweb/itemRules";
import {parseRpm,writeRpm} from "../pokeweb/rpm";
import {readU16} from "../nds/binary";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";

describe("grouped ability popups",()=>{
  it.each(["base","priority","library","recipes","client"])("reopens the previous %s runtime and upgrades it when effects are applied",variant=>{
    // These five synthetic-ROM DLLs were produced by the preceding installer.
    const bytes=new Uint8Array(readFileSync(new URL(`./fixtures/ability-popup-legacy/${variant}.dll`,import.meta.url)));
    const {project,base,offsets}=makeItemEffectsProject(0,0,true,true);
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:bytes}};
    const old=inspectAbilityEffects(project);expect(old.editable,old.message).toBe(true);expect(old.rules.size).toBe(1);
    const rpm=buildAbilityRuleModule(project,old.rules),popup=rpm.symbols.find(s=>s.name==="AbilityPopupRun")!;
    expect(rpm.metadata.PokewebAbilityPopupGroups).toBe(1);
    expect(rpm.relocations.some(r=>r.target.module==="167"&&r.target.address===base+offsets.get("BattleHandler_PushRun")!&&rpm.symbols[r.sourceSymbolIndex]===popup)).toBe(true);
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:"DLXF"});
    expect(inspectAbilityEffects(project).rules).toEqual(old.rules);
    delete rpm.metadata.PokewebAbilityPopupGroups;
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:"DLXF"});
    expect(inspectAbilityEffects(project).editable).toBe(false);
    expect(parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata.PokewebAbilityPopupGroups).toBeUndefined();
  });
  it("accepts and renders precise passive Defense and Speed multipliers",()=>{
    const conditions={kind:"group" as const,mode:"all" as const,children:[]};
    const rule=validateAbilityRule({effects:[{kind:"defense",value:1.2},{kind:"speed",value:.8}],conditions});
    const bytes=encodeAbilityRules(new Map([[165,rule]])),start=512+8;
    expect(readU16(bytes,start+2)).toBe(4915);expect(readU16(bytes,start+16+2)).toBe(3277);
    const html=renderItemRuleForm(makeItemEffectsProject().project,{...rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
    expect(html).toContain('step="0.001" value="1.2"');expect(html).toContain('step="0.001" value="0.8"');
    expect(html).not.toContain('data-rule-trigger');
    for(const value of [.124,8.001,1.2005,NaN])expect(()=>validateAbilityRule({...rule,effects:[{kind:"defense",value}]})).toThrow();
    expect(()=>validateItemRule({...rule,consumable:false})).toThrow();
  });
});
