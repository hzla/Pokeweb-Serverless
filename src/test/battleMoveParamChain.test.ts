import {describe,expect,it} from "vitest";
import {chainMoveParamOwners} from "../pokeweb/battleMoveParamChain";
import {parseRpm,writeRpm,type RpmModule} from "../pokeweb/rpm";

const module=(symbols:RpmModule["symbols"],relocations:RpmModule["relocations"]):RpmModule=>({code:new Uint8Array(64),bssSize:0,baseAddress:0,symbols,relocations,metadata:{}});
const sym=(name:string,address:number,attributes=1):RpmModule["symbols"][number]=>({name,address,attributes,size:0,type:"FUNCTION_THM"});
const ability=()=>module([sym("AbilityRecipeApi",16,0),sym("AbilityRecipeMoveParam",4)],[{target:{module:"167",address:0x2100000,type:"THUMB_BRANCH"},sourceSymbolIndex:1},{target:{module:"base",address:20,type:"OFFSET"},sourceSymbolIndex:1}]);
const item=()=>module([sym("RuleGetMoveParam",8)],[{target:{module:"167",address:0x2100000,type:"THUMB_BRANCH"},sourceSymbolIndex:0}]);

describe("checked move-parameter module chain",()=>{
 it("keeps the ability hook, removes the duplicate item hook, and writes a linkable import",()=>{
  const a=ability(),i=item(),paired=chainMoveParamOwners(a,i),written=parseRpm(writeRpm(paired.ability,{ident:"DLXF"}),{allowedMagics:["DLXF"]});
  expect(a.relocations).toHaveLength(2);expect(i.relocations).toHaveLength(1);
  expect(paired.item.relocations).toHaveLength(0);expect(paired.ability.relocations.filter(r=>r.target.module==="167")).toHaveLength(1);
  const imported=written.symbols.find(s=>s.name==="RuleGetMoveParam")!;expect(imported.attributes&2).toBe(2);expect(imported.address).toBe(0x387d450d);
  expect(written.relocations.some(r=>r.target.module==="base"&&r.target.address===20&&written.symbols[r.sourceSymbolIndex]===imported)).toBe(true);
 });
 it("rejects missing or mismatched owners",()=>{
  const other=item();other.relocations[0].target.address+=4;expect(()=>chainMoveParamOwners(ability(),other)).toThrow(/ownership/);
  const missing=item();missing.symbols[0].attributes=0;expect(()=>chainMoveParamOwners(ability(),missing)).toThrow(/unavailable/);
 });
});
