import {describe,it,expect} from "vitest";
import {readU16} from "../nds/binary";
import {ABILITY_IMPORT_LIBRARY} from "../pokeweb/abilityLibrary";
import {validateAbilityRule,EMPTY_ABILITY_RULE} from "../pokeweb/abilityRules";
import {buildAbilityRuleModule,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from "../pokeweb/abilityEffectsModel";
import {writeRpm} from "../pokeweb/rpm";
import {makeBlackAbilityProject} from "./fixtures/blackAbilityProject";
const refrigerate=ABILITY_IMPORT_LIBRARY.find(p=>p.label==="Refrigerate")!.rule;
describe("Frost Fairy Black 1 ability compatibility",()=>{
 it.each([[0,0],[0x1800,0x3000]])("links every import with moved Frost native code %i/%i",(shift,move)=>{
  const{project}=makeBlackAbilityProject(shift,move,true);
  for(const p of ABILITY_IMPORT_LIBRARY)expect(()=>buildAbilityRuleModule(project,new Map([[255,p.rule]])),p.label).not.toThrow();
 },120000);
 it("retains the Fairy range check in copied Color Change and a single shared client module",()=>{
  const{project}=makeBlackAbilityProject(0,0,true);
  const color=validateAbilityRule({effects:[{kind:"nativeAbility:16",value:-1}],conditions:EMPTY_ABILITY_RULE.conditions}),trap=validateAbilityRule({effects:[{kind:"nativeAbility:42",value:-1,parameters:{trapType:17}}],conditions:{kind:"type",value:17}}),rules=new Map([[165,refrigerate],[166,color],[255,trap]]);
  const rpm=buildAbilityRuleModule(project,rules);
  expect(rpm.metadata.PokewebAbilityClientTraps).toBe(1);
  expect(rpm.symbols.some(s=>s.type==="FUNCTION_THM"&&s.size===122&&readU16(rpm.code,s.address+0x36)===0x2e12&&rpm.code[s.address+0x39]===0xda)).toBe(true);
  expect(rpm.code[rpm.symbols.find(s=>s.name==="AbilityClientTrapTypes")!.address+255]).toBe(18);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project).rules).toEqual(rules);
 });
 it("rejects an unrecognized effectiveness edit instead of accepting arbitrary Fairy code",()=>{
  const{project,locations,base}=makeBlackAbilityProject(0,0,true);
  project.overlays[93]![locations.get("ServerControl_CheckMoveEffectiveness")!-base+0x15]=0xd8;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,refrigerate]]))).toThrow(/missing|unrecognized/iu);
 });
});
