import {describe,it,expect} from 'vitest';
import {abilityImport,ABILITY_IMPORT_LIBRARY} from '../pokeweb/abilityLibrary';
import {validateAbilityRule,EMPTY_ABILITY_RULE,ABILITY_RULE_EFFECTS} from '../pokeweb/abilityRules';
import {abilityRuleEvents} from '../pokeweb/abilityEvents';
import {NATIVE_ABILITY_PROFILES} from '../pokeweb/abilityNativeRuntime';
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH,CURRENT_ABILITY_RUNTIME_VERSION} from '../pokeweb/abilityEffectsModel';
import {writeRpm} from '../pokeweb/rpm';
import {makeItemEffectsProject} from './fixtures/itemEffectsProject';
import {makeBw1AbilityProject} from './fixtures/blackAbilityProject';
import {renderItemRuleForm} from '../ui/itemRuleEditor';
const ids=[239,310,212,277];
describe('source-aware status and charge templates',()=>{
 it('exposes all four templates, adjustable parameters and nested conditions',()=>{
  for(const id of ids){const t=abilityImport(id);expect(ABILITY_IMPORT_LIBRARY.find(e=>e.id===id)).toBeDefined();
   expect(validateAbilityRule({...t.rule,conditions:{kind:'group',mode:'all',children:[{kind:'type',value:11},{kind:'group',mode:'any',children:[{kind:'hp',comparison:'lt',percent:50},{kind:'weather',value:1}]}]}}).effects).toEqual(t.rule.effects);
  }
  expect(()=>validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:'abilityRecipe:windCharge',value:0}]})).toThrow();
  expect(()=>validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:'abilityRecipe:statusFollowup',value:101}]})).toThrow();
  expect(()=>validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:'abilityRecipe:statusFollowup',value:100,parameters:{minTurns:5,maxTurns:2}}]})).toThrow();
  const {project}=makeItemEffectsProject();for(const id of ids){const html=renderItemRuleForm(project,{...abilityImport(id).rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS,presets:ABILITY_IMPORT_LIBRARY});expect(html).toContain(abilityImport(id).label);}
 });
 it('subscribes only to relevant events',()=>{
  expect(abilityRuleEvents(abilityImport(239).rule,NATIVE_ABILITY_PROFILES)).toEqual([]);
  expect(abilityRuleEvents(abilityImport(212).rule,NATIVE_ABILITY_PROFILES)).toEqual([]);
  expect(abilityRuleEvents(abilityImport(310).rule,NATIVE_ABILITY_PROFILES)).toEqual([0x68]);
  expect(abilityRuleEvents(abilityImport(277).rule,NATIVE_ABILITY_PROFILES)).toEqual([0x4b,0x8b,0x9f]);
 });
 it.each(['B','W','BW2'])('builds one checked DLL in %s and verifies the saved recipes',game=>{
  const {project}=game==='BW2'?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game as 'B'|'W');
  const rules=new Map(ids.map((id,i)=>[165+i,abilityImport(id).rule]));const dll=buildAbilityRuleModule(project,rules);
  expect(dll.metadata.PokewebAbilityStatusExtensions).toBe(1);
  expect(dll.relocations.filter(r=>dll.symbols[r.sourceSymbolIndex]?.name==='AbilityStatusCheckSite')).toHaveLength(1);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(dll,{ident:'DLXF'})}};
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,rules,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION});
 });
 it('adds no native status hook for redirection alone',()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),dll=buildAbilityRuleModule(project,new Map([[165,abilityImport(239).rule]]));
  expect(dll.relocations.some(r=>dll.symbols[r.sourceSymbolIndex]?.name==='AbilityStatusCheckSite')).toBe(false);
 });
});
