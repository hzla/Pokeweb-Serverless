import {describe,it,expect} from 'vitest';
import {ABILITY_IMPORT_LIBRARY,abilityImport} from '../pokeweb/abilityLibrary';
import {SCOPED_ABILITY_EFFECTS} from '../pokeweb/abilityScopedEffects';
import {validateAbilityRule,encodeAbilityRules,ABILITY_RULE_EFFECTS} from '../pokeweb/abilityRules';
import {readU16} from '../nds/binary';
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from '../pokeweb/abilityEffectsModel';
import {makeItemEffectsProject} from './fixtures/itemEffectsProject';
import {writeRpm} from '../pokeweb/rpm';
import {renderItemRuleForm} from '../ui/itemRuleEditor';
const ids=[168,170,178,180,186,187,188,198,214,219,236,240,284,285,286,287,290,293,296];
const all={kind:'group' as const,mode:'all' as const,children:[]};
describe('scoped native-service ability imports',()=>{
 it('imports all nineteen editable templates and keeps Mega Launcher damage-only',()=>{
  expect(ABILITY_IMPORT_LIBRARY).toHaveLength(88);
  for(const id of ids){const t=abilityImport(id);expect(validateAbilityRule(t.rule)).toEqual(t.rule);expect(t.defaultName.length).toBeLessThanOrEqual(15);}
  expect(abilityImport(178)).toMatchObject({label:'Mega Launcher (damage only)',defaultName:'Mega Launcher',rule:{effects:[{kind:'ability:power',value:1.5,parameters:{moveClass:4}}]}});
  expect(abilityImport(290).rule.effects[0].bypassable).toBe(false);
 });
 it.each(SCOPED_ABILITY_EFFECTS)('encodes $kind and nested conditions',definition=>{
  const rule=validateAbilityRule({effects:[{kind:definition.kind,value:definition.value}],conditions:{kind:'group',mode:'all',children:[{kind:'type',value:11},{kind:'group',mode:'any',children:[{kind:'hp',comparison:'lte',percent:50},{kind:'weather',value:3}]}]}});
  const b=encodeAbilityRules(new Map([[255,rule]])),at=readU16(b,510),start=at+4+b[at+1]*4;expect(b[start]).toBe(definition.code);expect(readU16(b,start+2)).toBe(Math.round(definition.value*definition.scale));
 });
 it('allows all type choices for changing the holder and exposes their controls',()=>{
  for(let type=0;type<=18;++type)expect(()=>validateAbilityRule({effects:[{kind:'abilityRecipe:moveUserType',value:1,parameters:{type}}],conditions:all})).not.toThrow();
  const html=renderItemRuleForm(makeItemEffectsProject().project,{...abilityImport(168).rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
  expect(html).toContain("Move&#039;s resolved type");expect(html).toContain('Once per entry / ability gain');expect(html).toContain('Every move');
 });
 it('keeps field modifiers outside Mold Breaker bypass and rejects malformed parameters',()=>{
  for(const kind of['fieldPower','auraInvert','fieldStat'])expect(()=>validateAbilityRule({effects:[{kind:`abilityRecipe:${kind}`,value:1,bypassable:true}],conditions:all})).toThrow(/Mold Breaker/);
  for(const effect of[{kind:'abilityRecipe:fieldStat',value:.75,parameters:{stat:5}},{kind:'abilityRecipe:moveUserType',value:1,parameters:{type:19}},{kind:'abilityRecipe:fallenPower',value:10,parameters:{cap:6}},{kind:'abilityRecipe:statEcho',value:1,parameters:{mode:2}},{kind:'abilityRecipe:transferItem',value:1,parameters:{activationChance:101}}])expect(()=>validateAbilityRule({effects:[effect as never],conditions:all})).toThrow();
  const html=renderItemRuleForm(makeItemEffectsProject().project,{...abilityImport(186).rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});expect(html).not.toContain('data-rule-bypass');
 });
 it.each([[0,0,false],[0x1800,0x3000,false],[0,0,true],[0x1800,0x3000,true]])('reopens a shared registry on shifted layout %i/%i with client %s',(shift,move,client)=>{
  const {project}=makeItemEffectsProject(Number(shift),Number(move),true,true),rules=new Map(ABILITY_IMPORT_LIBRARY.map((t,i)=>[165+i,t.rule]));if(client)rules.set(255,validateAbilityRule({effects:[{kind:'nativeAbility:42',value:-1}],conditions:all}));
  const rpm=buildAbilityRuleModule(project,rules);expect(rpm.metadata.PokewebAbilityScoped).toBe(1);expect(rpm.bssSize).toBeLessThanOrEqual(16384);expect(rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(65536);expect(writeRpm(rpm,{ident:'DLXF'}).length+rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(112*1024);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:'DLXF'})}};expect(inspectAbilityEffects(project).rules).toEqual(rules);
  delete rpm.metadata.PokewebAbilityScoped;project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(rpm,{ident:'DLXF'});expect(inspectAbilityEffects(project).editable).toBe(false);
 });
});
