import { encodeMoveRecipeBook, decodeMoveRecipeBook } from "../pokeweb/moveRecipeBook";
import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { checkedMoveEventList, MOVE_ALWAYS, EMPTY_MOVE_RULE, newMoveEffect, validateMoveRule, validateMoveRuleCategory, validateMoveRuleHits, validateMoveCondition, moveRecipeEvents, movePrerequisiteEvent, encodeMoveRules, type MoveCondition } from "../pokeweb/moveRules";
import { MOVE_RECIPE_LIBRARY, moveRecipeTemplate } from "../pokeweb/moveRecipeLibrary";
import expansion from "../assets/data/white2upgradeMoveExpansion.json";
import { MOVE_STAGE2A_CANDIDATES,MOVE_STAGE2A_ENABLED } from "../pokeweb/moveRecipeLibrary2A";
import { MOVE_STAGE2B_CANDIDATES } from "../pokeweb/moveRecipeLibrary2B";
import { MOVE_PERSISTENT_TEMPLATES } from "../pokeweb/moveRecipeLibraryPersistent";
import { MOVE_HISTORY_CANDIDATES } from "../pokeweb/moveRecipeLibraryHistory";
import { zlibSync } from "fflate";

describe("bounded move recipes", () => {
 it("bounds entry hazards and exchanges without secondary-effect rolls",()=>{
  const web=newMoveEffect("entryStatHazard"),swap=newMoveEffect("swapSideEffects");
  const rule=(effect:typeof web)=>({...EMPTY_MOVE_RULE,effects:[effect]});
  expect(validateMoveRule(rule({...web,value:-2,parameters:{stat:2,side:0}})).effects[0].value).toBe(-2);
  expect(()=>validateMoveRule(rule({...web,value:0}))).toThrow();
  expect(()=>validateMoveRule(rule({...web,parameters:{stat:8}}))).toThrow();
  expect(()=>validateMoveRule(rule({...web,parameters:{side:3}}))).toThrow();
  expect(()=>validateMoveRule(rule({...web,chance:50}))).toThrow();
  expect(()=>validateMoveRule(rule({...swap,secondary:true}))).toThrow();
  expect(MOVE_PERSISTENT_TEMPLATES.some(t=>t.label==="Sticky Web")).toBe(true);
  expect(MOVE_PERSISTENT_TEMPLATES.some(t=>t.label==="Court Change")).toBe(true);
 });
 it("validates and exposes persistent templates and their parameter bounds",()=>{
  expect(MOVE_PERSISTENT_TEMPLATES).toHaveLength(16);
  for(const template of MOVE_PERSISTENT_TEMPLATES){
   expect(expansion.moves.find(m=>m.sourceId===template.sourceId)?.name).toBe(template.label);
   expect(validateMoveRule(template.rule)).toEqual(template.rule);
   expect(MOVE_RECIPE_LIBRARY.some(t=>t.sourceId===template.sourceId)).toBe(true);
   expect(moveRecipeEvents(template.rule)).not.toContain(0x7a);
  }
  for(const kind of ["vulnerableUntilAction","residualDamage","residualStat","fieldMoveType","targetMoveType","selfTrapBoost","mutualTrap","powderReaction","blockMoveFlag","focusCritical","spotlight"])expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[newMoveEffect(kind)]})).not.toThrow();
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[{...newMoveEffect("residualStat"),value:0}]})).toThrow();
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[{...newMoveEffect("residualDamage"),parameters:{type1:19}}]})).toThrow();
 });
 it("bounds nested battle-history conditions and event-count power",()=>{
  const history:MoveCondition={kind:"group",mode:"any",children:[{kind:"ateBerry",subject:"user",value:1},{kind:"group",mode:"all",children:[{kind:"hitsTaken",subject:"user",value:2},{kind:"statRaised",subject:"target",value:1}]}]};
  const effect={...newMoveEffect("historyPower"),value:30,parameters:{source:0,limit:4},conditions:history};
  const rule={...EMPTY_MOVE_RULE,effects:[effect]};
  expect(validateMoveRule(rule)).toEqual(rule);expect(moveRecipeEvents(rule)).toEqual([0x37]);
  for(const condition of [{kind:"hitsTaken",subject:"user",value:0},{kind:"partyFaints",subject:"user",value:256},{kind:"ateBerry",subject:"user",value:2},{kind:"selectedMove",subject:"user",value:65535}])expect(()=>validateMoveCondition(condition as MoveCondition)).toThrow();
  expect(()=>validateMoveRule({...rule,effects:[{...effect,parameters:{source:2}}]})).toThrow();
  expect(()=>validateMoveRule({...rule,effects:[{...effect,parameters:{limit:0}}]})).toThrow();
 });
 it("validates the history-driven template drafts",()=>{
  expect(MOVE_HISTORY_CANDIDATES).toHaveLength(10);
  for(const template of MOVE_HISTORY_CANDIDATES){
   expect(expansion.moves.find(m=>m.sourceId===template.sourceId)?.name).toBe(template.label);
   expect(validateMoveRule(template.rule)).toEqual(template.rule);
   expect(MOVE_RECIPE_LIBRARY.some(t=>t.sourceId===template.sourceId)).toBe(true);
   expect(moveRecipeEvents(template.rule)).not.toContain(0x7a);
  }
 });
 it("keeps per-recipient drain bounded and isolated from other sequence state",()=>{
  const drain=newMoveEffect("drainEachHit"),rule={...EMPTY_MOVE_RULE,effects:[drain]};
  expect(moveRecipeEvents(rule)).toEqual([3,0x4b,0x4d]);
  expect(validateMoveRule({...rule,conditions:{kind:"weather",value:3}}).effects[0].value).toBe(50);
  for(const other of ["damageDrain","requireHeldItem","ignoreAbilities","allyHealInstead","maxHpRecoil","drainEachHit","native","removeItem"])expect(()=>validateMoveRule({...rule,effects:[drain,newMoveEffect(other)]})).toThrow();
  expect(()=>validateMoveRule({...rule,nativeBase:280})).toThrow();
  expect(()=>validateMoveRule({...rule,effects:[{...drain,secondary:true}]})).toThrow();
  expect(()=>validateMoveRuleHits(rule,0x21)).toThrow(/single-hit/);expect(()=>validateMoveRuleHits(rule,0)).not.toThrow();
 });
 it("validates and exposes the checked Stage 2B templates",()=>{
  expect(MOVE_STAGE2B_CANDIDATES).toHaveLength(10);
  for(const candidate of MOVE_STAGE2B_CANDIDATES){expect(expansion.moves.find(m=>m.sourceId===candidate.sourceId)?.name).toBe(candidate.label);expect(validateMoveRule(candidate.rule)).toEqual(candidate.rule);expect(moveRecipeEvents(candidate.rule)).not.toContain(0x7a);}
  for(const candidate of MOVE_STAGE2B_CANDIDATES)expect(MOVE_RECIPE_LIBRARY.some(t=>t.sourceId===candidate.sourceId)).toBe(true);
 });
 it("validates ally-recovery fractions and subscribes only to the native recovery events",()=>{
  const heal=newMoveEffect("allyHealInstead"),rule={...EMPTY_MOVE_RULE,effects:[heal]};
  expect(moveRecipeEvents(rule)).toEqual([0x30,0x31]);
  expect(validateMoveRule(rule).effects[0]).toMatchObject({kind:"allyHealInstead",target:"target",value:1});
  for(const invalid of [
   {...rule,effects:[{...heal,value:3,parameters:{denominator:2}}]},
   {...rule,effects:[{...heal,secondary:true}]},
   {...rule,effects:[heal,heal]},
   {...rule,nativeBase:280},
  ])expect(()=>validateMoveRule(invalid)).toThrow();
 });
 it("bounds the scoped calculation adapters",()=>{
  const rule=(kind:string)=>({...EMPTY_MOVE_RULE,effects:[newMoveEffect(kind)]});
  for(const kind of ["typeMatchup","damageWeather","thawTargets","ignoreRedirection","attackStat","moveUserType"])expect(moveRecipeEvents(rule(kind))).toEqual([]);
  expect(()=>validateMoveRule({...rule("typeMatchup"),effects:[{...newMoveEffect("typeMatchup"),parameters:{effectiveness:1}}]})).toThrow();
  expect(()=>validateMoveRule({...rule("damageWeather"),effects:[{...newMoveEffect("damageWeather"),parameters:{moveType:18}}]})).toThrow();
  expect(()=>validateMoveRule({...rule("thawTargets"),conditions:{kind:"type",subject:"target",value:10}})).toThrow();
  expect(()=>validateMoveRule({...rule("moveUserType"),conditions:{kind:"type",subject:"target",value:10}})).toThrow();
  expect(moveRecipeEvents(rule("bypassSubstitute"))).toEqual([]);
  expect(moveRecipeEvents(rule("bypassSubstitute"),false,true)).toEqual([5]);
 });
 it("validates all transaction templates and excludes unsupported templates",()=>{
  expect(MOVE_STAGE2A_CANDIDATES).toHaveLength(34);
  for(const candidate of MOVE_STAGE2A_CANDIDATES){expect(expansion.moves.find(m=>m.sourceId===candidate.sourceId)?.name).toBe(candidate.label);expect(validateMoveRule(candidate.rule)).toEqual(candidate.rule);expect(moveRecipeEvents(candidate.rule)).not.toContain(0x7a);}
  for(const name of ["Happy Hour","Make It Rain","Fickle Beam"])expect(MOVE_RECIPE_LIBRARY.some(t=>t.label===name)).toBe(false);
  expect(new Set(MOVE_STAGE2A_ENABLED)).toEqual(new Set(MOVE_STAGE2A_CANDIDATES.map(t=>t.sourceId)));
 });
 it("bounds HP costs, Berry/stat selections and random status masks",()=>{
  for(const e of [
   {...newMoveEffect("hpCostBoost"),parameters:{stats:0}},
   {...newMoveEffect("hpCostBoost"),parameters:{stats:128}},
   {...newMoveEffect("hpCostBoost"),parameters:{numerator:34,denominator:33}},
   {...newMoveEffect("berryBoost"),value:0},
   {...newMoveEffect("randomStatus"),value:64},
   {...newMoveEffect("randomStatus"),value:0},
   {...newMoveEffect("cureAndHeal"),value:3,parameters:{denominator:2}},
   {...newMoveEffect("statDrain"),parameters:{change:7}},
   {...newMoveEffect("useBerry"),secondary:true},
  ])expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[e]})).toThrow();
  expect(validateMoveCondition({kind:"stage",subject:"target",comparison:"gt",stat:1,value:0})).toMatchObject({value:0,stat:1});
  for(const stat of [0,8])expect(()=>validateMoveCondition({kind:"stage",subject:"target",comparison:"gte",stat,value:6})).toThrow();
  expect(movePrerequisiteEvent({kind:"berry",subject:"user",value:1})).toBe(0x1f);
 });
 it.each(MOVE_RECIPE_LIBRARY)("validates the $label template", template => {
  expect(validateMoveRule(template.rule)).toEqual(template.rule);
  expect(moveRecipeEvents(template.rule)).not.toContain(0x6e);
  expect(moveRecipeEvents(template.rule)).not.toContain(0x70);
  expect(moveRecipeEvents(template.rule)).not.toContain(0x7a);
 });
 it("deduplicates stored recipes while keeping original fields and edits independent", () => {
  const rules=new Map(Array.from({length:100},(_,i)=>[i+1,EMPTY_MOVE_RULE]));
  const original=new Map(Array.from({length:100},(_,i)=>[i+1,{effect_category:i%14,result_effect:i}]));
  const text=encodeMoveRecipeBook(rules,original,["effect_category","result_effect"]),decoded=decodeMoveRecipeBook(text,["effect_category","result_effect"]);
  expect(JSON.parse(text).pool).toHaveLength(1);expect(text.length).toBeLessThan(2500);expect(decoded.rules).toEqual(rules);expect(decoded.originals).toEqual(original);
  const packed=encodeMoveRecipeBook(rules,original,["effect_category","result_effect"],true);expect(packed.startsWith("z1:")).toBe(true);expect(packed.length).toBeLessThan(text.length);expect(decodeMoveRecipeBook(packed,["effect_category","result_effect"]).rules).toEqual(rules);
  expect(()=>decodeMoveRecipeBook("z1:not-valid",["effect_category","result_effect"])).toThrow(/compressed/);
  const oversized=zlibSync(new Uint8Array(60001).fill(65));expect(()=>decodeMoveRecipeBook(`z1:${btoa(Array.from(oversized,x=>String.fromCharCode(x)).join(""))}`,["effect_category","result_effect"])).toThrow(/compressed/);
  decoded.rules.get(1)!.effects[0].value=3;expect(decoded.rules.get(2)!.effects[0].value).toBe(2);
  for(const rows of [[[1,1,0,0]],[[1,0,0]],[[1,0,-1,0]],[[1,0,0,0],[1,0,0,0]]])expect(()=>decodeMoveRecipeBook(JSON.stringify({pool:[EMPTY_MOVE_RULE],rows}),["effect_category","result_effect"])).toThrow();
 });
 it("keeps the catalog complete and separate from ordinary move data", () => {
  expect(MOVE_RECIPE_LIBRARY).toHaveLength(101); expect(new Set(MOVE_RECIPE_LIBRARY.map(t => t.sourceId)).size).toBe(101);
  expect(moveRecipeTemplate(850)?.rule.effects.map(e => e.parameters?.stat)).toEqual([3,4,undefined]);
  expect(moveRecipeTemplate(565)?.rule.effects[0].value).toBe(2);
  expect(moveRecipeTemplate(846)?.rule.effects.find(e => e.kind === "statStage")).toMatchObject({value:-1,chance:30,parameters:{stat:5}});
 });
 it("subscribes only to a move's actual event boundaries", () => {
  expect(checkedMoveEventList([0x37,0x37])).toEqual([0x37]);
  for(const event of [0x7a,0xa6,-1,NaN,1.5])expect(()=>checkedMoveEventList([event])).toThrow();
  expect(moveRecipeEvents(EMPTY_MOVE_RULE)).toEqual([0x37]);
  expect(moveRecipeEvents({...EMPTY_MOVE_RULE,effects:[newMoveEffect("ignoreStages")]})).toEqual([0x33,0x3a]);
  expect(moveRecipeEvents({...EMPTY_MOVE_RULE,effects:[newMoveEffect("flinch")]})).toEqual([0x4b]);
  expect(moveRecipeEvents(moveRecipeTemplate(799)!.rule)).toEqual([0x84]);
  expect(moveRecipeEvents(moveRecipeTemplate(664)!.rule)).toEqual([0x83]);
  expect(moveRecipeEvents(moveRecipeTemplate(563)!.rule)).toEqual([0xa0,0xa1]);
  expect(moveRecipeEvents(moveRecipeTemplate(660)!.rule)).toEqual([0x1f]);
  expect(moveRecipeEvents(moveRecipeTemplate(918)!.rule)).toEqual([0x2c,0x4b]);
 });
 it("moves recipient prerequisites to the boundary with a real target", () => {
  expect(movePrerequisiteEvent({kind:"firstTurn",subject:"user",value:1})).toBe(0x1f);
  expect(movePrerequisiteEvent({kind:"hp",subject:"target",comparison:"lt",percent:50})).toBe(0x2c);
 });
 it("keeps native damage drain unconditional and free of extra callbacks",()=>{
  const rule={...EMPTY_MOVE_RULE,effects:[newMoveEffect("damageDrain")]};
  expect(moveRecipeEvents(rule)).toEqual([]);
  expect(()=>validateMoveRule({...rule,conditions:{kind:"weather",value:2}})).toThrow(/unconditional/);
  expect(()=>validateMoveRule({...rule,effects:[{...newMoveEffect("damageDrain"),secondary:true}]})).toThrow();
  expect(()=>validateMoveRuleCategory(rule,0)).toThrow(/category/);
 });
 it("encodes sparse arbitrary ROM IDs as a sorted index, rather than an ID-sized scan", () => {
  const bytes=encodeMoveRules(new Map([[918,moveRecipeTemplate(918)!.rule],[1,EMPTY_MOVE_RULE],[65534,EMPTY_MOVE_RULE]]));
  expect(readU16(bytes,0)).toBe(3);expect([4,20,36].map(at=>readU16(bytes,at))).toEqual([1,918,65534]);
  const record=readU32(bytes,24);expect(bytes[record+3]).toBe(0x2c);
  expect(bytes.length).toBeLessThan(600);
  for(const id of [0,-1,1.5,65535])expect(()=>encodeMoveRules(new Map([[id,EMPTY_MOVE_RULE]]))).toThrow();
 });
 it("retains nested AND/OR ordering for short circuit evaluation", () => {
  const conditions:MoveCondition={kind:"group",mode:"all",children:[{kind:"hp",subject:"user",comparison:"lt",percent:50},{kind:"group",mode:"any",children:[{kind:"type",subject:"target",value:11},{kind:"weather",value:3}]}]};
  expect(validateMoveCondition(conditions)).toEqual(conditions);
  expect(validateMoveCondition({kind:"group",mode:"any",children:[]})).toEqual(MOVE_ALWAYS);
  let deep:MoveCondition={kind:"weather",value:3};for(let i=0;i<4;++i)deep={kind:"group",mode:"all",children:[deep]};
  expect(()=>validateMoveCondition(deep)).toThrow(/limit/);
  expect(()=>validateMoveCondition({kind:"group",mode:"all",children:Array(9).fill(MOVE_ALWAYS)})).toThrow();
 });
 it("rejects unsafe numeric, timing, duplicate and native-operation combinations", () => {
  for(const effect of [{...newMoveEffect(),value:NaN},{...newMoveEffect("heal"),value:3,parameters:{denominator:2}},{...newMoveEffect(),phase:"status" as const},{...newMoveEffect("native"),value:33},{...newMoveEffect("native"),target:"all" as const},{...newMoveEffect("flinch"),secondary:false},{...newMoveEffect("statStage"),value:0},{...newMoveEffect("statStage"),parameters:{stat:8}}])expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[effect]})).toThrow();
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[newMoveEffect(),newMoveEffect()]})).toThrow(/duplicate/);
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[],nativeBase:999})).toThrow();
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[],nativeBase:20})).toThrow(/Unreviewed/);
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[newMoveEffect("accuracy")],conditions:{kind:"type",subject:"target",value:10}})).toThrow(/no recipient/);
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,effects:[{...newMoveEffect(),chance:50}]})).toThrow(/chance/);
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,conditions:{kind:"effectiveness",value:4}})).toThrow(/final damage/);
  expect(()=>validateMoveRule({...EMPTY_MOVE_RULE,prerequisites:{kind:"effectiveness",value:4}})).toThrow(/after use/);
  expect(()=>validateMoveRule({...moveRecipeTemplate(706)!.rule,conditions:{kind:"weather",value:2}})).toThrow(/Activation conditions/);
 });
 it("rejects timings incompatible with ordinary move category",()=>{
  expect(()=>validateMoveRuleCategory(EMPTY_MOVE_RULE,0)).toThrow(/category/);
  expect(()=>validateMoveRuleCategory(moveRecipeTemplate(563)!.rule,1)).toThrow(/category/);
  expect(()=>validateMoveRuleCategory(moveRecipeTemplate(563)!.rule,0)).not.toThrow();
  expect(()=>validateMoveRuleCategory(moveRecipeTemplate(660)!.rule,0)).not.toThrow();
  expect(()=>validateMoveRuleCategory(moveRecipeTemplate(706)!.rule,0)).toThrow(/category/);
  expect(validateMoveRule({...EMPTY_MOVE_RULE,effects:[{...newMoveEffect("stages"),value:1,parameters:{operation:0}}]}).effects[0].value).toBe(0);
 });
});
