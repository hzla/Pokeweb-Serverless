import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { encodeMoveRules, MOVE_ALWAYS, newMoveEffect } from "../pokeweb/moveRules";
import { MOVE_RECIPE_LIBRARY } from "../pokeweb/moveRecipeLibrary";
import base from "../assets/data/moveRuleRuntimeCompact.json";
import history from "../assets/data/moveRuleRuntimeHistoryCompact.json";
import persistent from "../assets/data/moveRuleRuntimePersistentCompact.json";
import knock from "../assets/data/moveRuleRuntimeModernKnockCompact.json";

describe("compact move packaging",()=>{
  const rule={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS,effects:[newMoveEffect("power")]};
  it("shares immutable recipe bodies while retaining each actual move ID",()=>{
    const entries=new Map(Array.from({length:100},(_,i)=>[65534-i,rule]));
    const old=encodeMoveRules(entries,18),compact=encodeMoveRules(entries,18,true);
    expect(compact[2]).toBe(2);expect(compact[3]).toBe(18);
    expect(compact.length).toBe(4+100*16+8+32);
    expect(old.length-compact.length).toBe(100*64-40);
    const pointers=new Set(Array.from({length:100},(_,i)=>readU32(compact,4+i*16+4)));
    expect(pointers.size).toBe(1);expect(readU16(compact,4)).toBe(65435);
    const at=[...pointers][0];expect([...compact.slice(at,at+3)]).toEqual([1,0,0]);
    expect(compact[at+8+5]).toBe(0);
  });
  it("keeps nested conditions, prerequisites and distinct parameters",()=>{
    const conditional={...rule,conditions:{kind:"group" as const,mode:"any" as const,children:[{kind:"weather" as const,value:3},{kind:"hp" as const,subject:"user" as const,comparison:"lte" as const,percent:50}]},prerequisites:{kind:"firstTurn" as const,value:1}};
    const encoded=encodeMoveRules(new Map([[1,conditional],[2,{...conditional,effects:[{...rule.effects[0],value:2.5}]}]]),17,true);
    const a=readU32(encoded,8),b=readU32(encoded,24);
    expect(a).not.toBe(b);expect(encoded[a+1]).toBe(3);expect(encoded[a+2]).toBe(1);
    expect(encoded[a+8]).toBe(129);expect(encoded[a+16]).toBe(3);
    expect(encoded[a+8+24]).toBe(10);
  });
  it("can encode every named template without altering its recipe",()=>{
    for(const template of MOVE_RECIPE_LIBRARY){
      const before=JSON.stringify(template.rule);
      const old=encodeMoveRules(new Map([[1,template.rule]]),18);
      const compact=encodeMoveRules(new Map([[1,template.rule]]),18,true);
      expect(compact.length).toBeLessThanOrEqual(old.length);
      expect(JSON.stringify(template.rule)).toBe(before);
    }
  });
  it("shares persistent recipes while keeping move IDs in the dispatch index",()=>{
    const persistent={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS,effects:[newMoveEffect("residualDamage")]};
    const data=encodeMoveRules(new Map([[1,persistent],[2,persistent]]),18,true);
    expect(readU32(data,8)).toBe(readU32(data,24));expect(readU16(data,4)).toBe(1);expect(readU16(data,20)).toBe(2);
  });
  it.each([base,history,persistent,knock])("retains one checked wrapper and actual ELF local visibility",runtime=>{
    expect(runtime.metadata.PokewebMoveLocals).toBe(1);
    expect(runtime.symbols.filter(s=>s.name?.startsWith("MoveEvent"))).toHaveLength(1);
    const wrapper=runtime.symbols.find(s=>s.name==="MoveEventTemplate")!;
    expect(wrapper.size).toBe(12);
    expect(runtime.symbols.find(s=>s.name==="dispatch")!.attributes&1).toBe(0);
    expect(runtime.symbols.find(s=>s.name==="condition")!.attributes&1).toBe(0);
    expect(runtime.symbols.find(s=>s.name==="MoveDispatch")!.attributes&1).toBe(1);
    expect(runtime.symbols.some(s=>s.attributes&2)).toBe(false);
  });
  it("keeps the full modern Knock Off tracking allocation",()=>{
    expect(knock.bssSize).toBe(1564);
    expect(knock.symbols.find(s=>s.name==="knockArmed")?.size).toBe(96);
  });
});
