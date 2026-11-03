import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {validateAbilityRule,EMPTY_ABILITY_RULE,encodeAbilityRules} from "../pokeweb/abilityRules";
import {NATIVE_ABILITY_PROFILES} from "../pokeweb/abilityNativeRuntime";
import {abilityRuleEvents} from "../pokeweb/abilityEvents";
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH,CURRENT_ABILITY_RUNTIME_VERSION} from "../pokeweb/abilityEffectsModel";
import {writeRpm} from "../pokeweb/rpm";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";
const rule=validateAbilityRule({effects:[{kind:"abilityRecipe:abilityStatGuard",value:1}],conditions:EMPTY_ABILITY_RULE.conditions});
describe("ability-source stat guard",()=>{
 it("subscribes only to stat prevention/notification and defaults to all stats",()=>{
  expect(abilityRuleEvents(rule,NATIVE_ABILITY_PROFILES)).toEqual([0x5b]);
  const data=encodeAbilityRules(new Map([[255,rule]]));const at=data[510]|data[511]<<8;
  expect(data[at+4+data[at+1]*4]).toBe(165);expect(data[at+5+data[at+1]*4]).toBe(8);
  for(const stat of [0,9])expect(()=>validateAbilityRule({...rule,effects:[{...rule.effects[0],parameters:{stat}}]})).toThrow();
  expect(()=>validateAbilityRule({...rule,effects:[{...rule.effects[0],value:0}]})).toThrow();
 });
 it.each(["B","W","BW2"])("installs one checked callback site only when required in %s",game=>{
  const {project}=game==="BW2"?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game as "B"|"W");
  const plain=buildAbilityRuleModule(project,new Map([[165,EMPTY_ABILITY_RULE]]));
  expect(plain.relocations.some(r=>plain.symbols[r.sourceSymbolIndex]?.name==="AbilityNativeCallback")).toBe(false);
  const rules=new Map([[165,rule],[255,rule]]),rpm=buildAbilityRuleModule(project,rules);
  const hooks=rpm.relocations.filter(r=>rpm.symbols[r.sourceSymbolIndex]?.name==="AbilityNativeCallback");
  expect(hooks).toHaveLength(1);expect(hooks[0].target.type).toBe("THUMB_BRANCH_LINK");
  expect(hooks[0].target.module).toBe(game==="BW2"?"167":"93");
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules});
 });
 it.each(["base","status","aura"])("retains exact verification of v6 %s and upgrades its code",name=>{
  const {project}=makeItemEffectsProject(0,0,true,true);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:new Uint8Array(readFileSync(new URL(`./fixtures/ability-runtime-v6/${name}.dll`,import.meta.url)))}};
  const old=inspectAbilityEffects(project);expect(old.editable,old.message).toBe(true);expect(old.runtimeVersion).toBe(6);
  const rpm=buildAbilityRuleModule(project,old.rules);expect(rpm.metadata.PokewebAbilityStatSource).toBe(1);
  project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:"DLXF"});
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules:old.rules});
 });
});
