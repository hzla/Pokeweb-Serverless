import {describe,it,expect} from "vitest";
import {newMoveEffect,validateMoveRule,moveRecipeEvents,moveEffectAllowsChance,MOVE_ALWAYS} from "../pokeweb/moveRules";
import {moveRecipeTemplate} from "../pokeweb/moveRecipeLibrary";
const effect=newMoveEffect("modernKnockOff");const rule={effects:[effect],conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS};
describe("modern Knock Off",()=>{
 it("exposes one composed, adjustable primary primitive with narrow action and hit events",()=>{
  expect(effect).toMatchObject({value:1.5,target:"target",phase:"power",secondary:false,chance:100});
  expect(moveRecipeEvents(rule)).toEqual([3,4,0x37,0x83]);expect(moveEffectAllowsChance("modernKnockOff")).toBe(false);
  expect(moveRecipeTemplate(282)?.rule).toEqual(rule);
  expect(validateMoveRule({...rule,effects:[{...effect,value:2.5,conditions:{kind:"hp",subject:"target",comparison:"lte",percent:50}}]}).effects[0].value).toBe(2.5);
 });
 it("rejects duplicate removal, native bases and secondary/chance-only variants",()=>{
  for(const effects of [[effect,effect],[effect,newMoveEffect("removeItem")],[{...effect,secondary:true}],[{...effect,chance:50}],[{...effect,value:.5}],[{...effect,target:"user" as const}]])expect(()=>validateMoveRule({...rule,effects})).toThrow();
  expect(()=>validateMoveRule({...rule,nativeBase:280})).toThrow();
 });
});
