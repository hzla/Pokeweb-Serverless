import{describe,it,expect}from'vitest';
import{ABILITY_IMPORT_LIBRARY,abilityImport}from'../pokeweb/abilityLibrary';
import{RECIPE_ABILITY_EFFECTS,recipeAbilityEffect}from'../pokeweb/abilityRecipeEffects';
import{validateAbilityRule,encodeAbilityRules,ABILITY_RULE_EFFECTS}from'../pokeweb/abilityRules';
import{buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH}from'../pokeweb/abilityEffectsModel';
import{makeItemEffectsProject}from'./fixtures/itemEffectsProject';
import{readU16}from'../nds/binary';
import{writeRpm}from'../pokeweb/rpm';
import{renderItemRuleForm}from'../ui/itemRuleEditor';
const all={kind:'group' as const,mode:'all' as const,children:[]};
describe('expanded standalone ability recipes',()=>{
 it('adds exactly the requested 36 recipes',()=>{
  const extra=ABILITY_IMPORT_LIBRARY.filter(t=>t.rule.effects.some(e=>recipeAbilityEffect(e.kind)));
  expect(extra).toHaveLength(36);expect(extra.map(t=>t.label).sort()).toEqual(['Aerilate','Aroma Veil','Cheek Pouch','Flower Veil','Pixilate','Refrigerate','Sweet Veil','Battery','Beast Boost','Berserk','Galvanize','Innards Out','Liquid Voice','Merciless','Soul-Heart','Cotton Down','Curious Medicine','Dauntless Shield','Intrepid Sword','Pastel Veil','Perish Body','Power Spot','Sand Spit','Screen Cleaner','Steely Spirit','Anger Shell','Costar','Good as Gold','Guard Dog','Hospitality',"Mind's Eye",'Orichalcum Pulse','Supersweet Syrup','Tera Shell','Toxic Debris','Wind Rider'].sort());
  expect(RECIPE_ABILITY_EFFECTS).toHaveLength(19);expect(new Set(RECIPE_ABILITY_EFFECTS.map(e=>e.code)).size).toBe(19);
 });
 it('keeps distinct triggers, scopes, type conversion and native stat selection editable',()=>{
  expect(abilityImport(184).rule.effects[0]).toMatchObject({kind:'abilityRecipe:convertType',value:1.2,parameters:{type:2}});
  expect(abilityImport(204).rule.effects[0]).toMatchObject({value:1,parameters:{sourceType:18,moveClass:5,type:10}});
  expect(abilityImport(224).rule.effects[0].parameters).toMatchObject({activation:4,stat:8});
  expect(abilityImport(271).rule.effects.map(e=>[e.value,e.parameters?.stat,e.parameters?.activation])).toEqual([[1,1,2],[1,3,2],[1,5,2],[-1,2,2],[-1,4,2]]);
  expect(abilityImport(166).rule.effects.filter(e=>e.kind==='abilityRecipe:statusGuard').map(e=>e.parameters?.condition)).toContain(14);
  expect(abilityImport(288).rule.effects).toHaveLength(2);expect(abilityImport(288).rule.effects[1].value).toBe(1.333333);
  for(const id of[234,235,306])expect(abilityImport(id).rule.effects[0].parameters?.once).toBe(1);
 });
 it('encodes signed actions, activation scopes and per-effect settings with nested AND/OR gates',()=>{
  const rule=validateAbilityRule({effects:[{kind:'abilityRecipe:statAction',value:-2,parameters:{activation:2,stat:3,scope:2,threshold:40,once:0,activationChance:85,moveClass:1,category:1}}],conditions:{kind:'group',mode:'all',children:[{kind:'hp',comparison:'lte',percent:50},{kind:'group',mode:'any',children:[{kind:'type',value:11},{kind:'weather',value:3}]}]}});
  const b=encodeAbilityRules(new Map([[255,rule]])),at=readU16(b,510),start=at+4+b[at+1]*4;
  expect(Array.from(b.slice(start,start+13))).toEqual([136,2,254,255,3,2,85,0,40,0,1,0,1]);
 });
 it('rejects unsupported opcodes, ineffective settings and invalid parameter bounds',()=>{
  for(const effect of[{kind:'abilityRecipe:missing',value:1},{kind:'abilityRecipe:statAction',value:0},{kind:'abilityRecipe:fullHpEffectiveness',value:.75},{kind:'abilityRecipe:healAction',value:1.5,parameters:{format:1}},{kind:'abilityRecipe:statusGuard',value:1,parameters:{condition:99}},{kind:'abilityRecipe:convertType',value:1.2,parameters:{sourceType:19}}])expect(()=>validateAbilityRule({effects:[effect as never],conditions:all})).toThrow();
 });
 it.each([[0,0],[0x1800,0x3000]])('verifies all imports and the precise Fairy range variant at layout (%i,%i)',(shift,move)=>{
  const f=makeItemEffectsProject(shift,move,true,true),offset=f.offsets.get('ServerControl_CheckMoveEffectiveness')!,overlay=f.project.overlays[167]!;
  overlay[offset+0x12]=18;overlay[offset+0x15]=0xdb;
  const rules=new Map(ABILITY_IMPORT_LIBRARY.map((t,i)=>[165+i,t.rule])),rpm=buildAbilityRuleModule(f.project,rules);
  expect(rpm.code.length+rpm.bssSize).toBeLessThanOrEqual(65536);expect(rpm.bssSize).toBeLessThanOrEqual(16384);
  expect(rpm.relocations.some(r=>r.target.address===f.base+offset&&r.target.type==='THUMB_BRANCH_SAFESTACK')).toBe(true);
  f.project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:'DLXF'})}};
  expect(inspectAbilityEffects(f.project).rules).toEqual(rules);
  overlay[offset+0x12]=19;expect(()=>buildAbilityRuleModule(f.project,rules)).toThrow(/missing|Unrecognized/u);
 });
 it('renders new recipe controls and condition groups without opaque ability-specific code',()=>{
  const{project}=makeItemEffectsProject();
  const html=renderItemRuleForm(project,{...abilityImport(271).rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});
  expect(html).toContain('HP threshold (%)');expect(html).toContain('HP crosses downward');expect(html).toContain('All (AND)');expect(html).toContain('Any (OR)');expect(html).not.toContain('Entry limit');
  const veil=renderItemRuleForm(project,{...abilityImport(257).rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});expect(veil).toContain('Holder and allies');expect(veil).toContain('Any type');
  for(const code of[135,139,150,152,153])expect(RECIPE_ABILITY_EFFECTS.find(e=>e.code===code)!.parameters.find(p=>p.key==='moveClass')!.when).toBeUndefined();
 });
 it('uses ability names and a bounded effectiveness picker in the editor',()=>{
  const{project}=makeItemEffectsProject();project.texts.banks.abilities=Array.from({length:256},(_,id)=>id===22?'Intimidate':`Ability ${id}`);
  const guard=renderItemRuleForm(project,{effects:[abilityImport(275).rule.effects[0]],conditions:all,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});expect(guard).toContain('Original (22 · Intimidate)');expect(guard).toContain('Stat drop to block');
  const shell=renderItemRuleForm(project,{...abilityImport(308).rule,consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS});expect(shell).toContain('½×');expect(shell).toContain('¼×');expect(shell).not.toContain('<input data-rule-effect-value');
  const encoded=encodeAbilityRules(new Map([[165,validateAbilityRule({effects:[{kind:'abilityRecipe:intimidateCounter',value:2,parameters:{stat:3,sourceAbility:239,sourceStat:2}}],conditions:all})]])),at=512+8;expect([encoded[at],encoded[at+1],encoded[at+4],encoded[at+5],encoded[at+7]]).toEqual([151,3,239,2,1]);
 });

});
