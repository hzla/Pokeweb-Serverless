import { encodeMoveRecipeBook, decodeMoveRecipeBook } from "../pokeweb/moveRecipeBook";
import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { checkedMoveEventList, MOVE_ALWAYS, EMPTY_MOVE_RULE, newMoveEffect, validateMoveRule, validateMoveRuleCategory, validateMoveCondition, moveRecipeEvents, movePrerequisiteEvent, encodeMoveRules, type MoveCondition } from "../pokeweb/moveRules";
import { MOVE_RECIPE_LIBRARY, moveRecipeTemplate } from "../pokeweb/moveRecipeLibrary";

describe("bounded move recipes", () => {
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
  decoded.rules.get(1)!.effects[0].value=3;expect(decoded.rules.get(2)!.effects[0].value).toBe(2);
  for(const rows of [[[1,1,0,0]],[[1,0,0]],[[1,0,-1,0]],[[1,0,0,0],[1,0,0,0]]])expect(()=>decodeMoveRecipeBook(JSON.stringify({pool:[EMPTY_MOVE_RULE],rows}),["effect_category","result_effect"])).toThrow();
 });
 it("keeps the stage-one catalog complete and separate from ordinary move data", () => {
  expect(MOVE_RECIPE_LIBRARY).toHaveLength(31); expect(new Set(MOVE_RECIPE_LIBRARY.map(t => t.sourceId)).size).toBe(31);
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
