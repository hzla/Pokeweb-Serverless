import { describe, expect, it } from "vitest";
import black from "../assets/data/moveRecipeBindingsB1.json";
import white from "../assets/data/moveRecipeBindingsW1.json";
import bw2 from "../assets/data/moveRecipeBindings.json";
import { MOVE_RULE_API, supportsMoveRecipes } from "../pokeweb/moveEffectsModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { battleRuntimeResolver, type BattleRuntimeSignature } from "../pokeweb/battleRuntimeBindings";

describe.each([["Black",black],["White",white]] as const)("%s move runtime contracts",(_name,catalog)=>{
  const functions=catalog.functions as Record<string,BattleRuntimeSignature>;
  it("retains the reviewed native operation event lists",()=>{
    expect(catalog.overlay).toBe(93);
    expect(catalog.rows).toEqual(bw2.rows);
    for(const [id,getter] of Object.entries(bw2.getters)){
      const actual=catalog.getters[id as keyof typeof catalog.getters];
      expect(actual.events.map(event=>event.event)).toEqual(getter.events.map(event=>event.event));
      expect(functions[actual.name]).toBeDefined();
      for(const event of actual.events)expect(functions[event.handler]).toBeDefined();
    }
  });
  it("provides the runtime's required services and checked type-resolution callers",()=>{
    for(const [index,name] of MOVE_RULE_API.entries()){
      if(!name||index===40||index===49||name==="KnockItemChangeBlocked")continue;
      expect(functions[name],`API ${index}: ${name}`).toBeDefined();
    }
    for(let index=0;index<8;index++){
      const signature=functions[`MoveParamSite${index}`];
      expect(signature.module).toBe("93");
      expect(signature.calls).toContainEqual({offset:16,target:"ServerEvent_GetMoveParam"});
      expect(signature.hex.length).toBe(signature.mask.length);
    }
    expect(catalog.abilityCatalog.profiles.map(profile=>profile.id)).toContain(104);
  });
  it("rejects a changed branch in a reviewed native move callback",()=>{
    const signatures=Object.values(catalog.getters).flatMap(getter=>getter.events.map(event=>functions[event.handler]));
    const candidate=signatures.map(signature=>{
      const bytes=Uint8Array.from(signature.hex.match(/../gu)!,s=>parseInt(s,16));
      const mask=Uint8Array.from(signature.mask.match(/../gu)!,s=>parseInt(s,16));
      for(let at=0;at+4<=bytes.length;at+=2){
        const hi=bytes[at]|bytes[at+1]<<8,lo=bytes[at+2]|bytes[at+3]<<8;
        if((hi&0xf800)===0xf000&&(lo&0xf800)===0xf800&&mask.slice(at,at+4).every(b=>b===255))return {signature,bytes,at};
      }
      return undefined;
    }).find(Boolean);
    expect(candidate).toBeDefined();
    const {signature,bytes,at}=candidate!,base=0x02190000;
    expect(battleRuntimeResolver(bytes,base,new Uint8Array(),0,{handler:signature}).matches("handler",base)).toBe(true);
    bytes[at+2]^=1;
    expect(battleRuntimeResolver(bytes,base,new Uint8Array(),0,{handler:signature}).matches("handler",base)).toBe(false);
  });
});

it.each([["Black", black], ["White", white], ["BW2", bw2]] as const)(
  "recognizes the exact 1.5x critical damage edit in %s",
  (_name, catalog) => {
    const name = "ServerEvent_CalcDamage";
    const signature: BattleRuntimeSignature = catalog.functions[name];
    const base = 0x02190000;
    for (const pattern of [signature, ...(signature.variants ?? [])]) {
      const bytes = Uint8Array.from(pattern.hex.match(/../gu)!, byte => Number.parseInt(byte, 16));
      const matchesDamage = () => battleRuntimeResolver(bytes, base, new Uint8Array(), 0, {[name]: signature}).matches(name, base);
      expect(matchesDamage()).toBe(true);
      bytes.set([0x78, 0x08, 0x70, 0x43, 0xc7, 0x19], 0xfa);
      expect(matchesDamage()).toBe(true);
      expect(battleRuntimeResolver(bytes, base, new Uint8Array(), 0, {other: signature}).matches("other", base)).toBe(false);
      bytes[0xfa] ^= 1;
      expect(matchesDamage()).toBe(false);
      bytes[0xfa] ^= 1;
      bytes[0] ^= 1;
      expect(matchesDamage()).toBe(false);
    }
  },
);

it("exposes the move editor only for Gen 5 projects",()=>{
  const project=(baseRom:string)=>({session:{baseRom}} as ProjectState);
  expect(supportsMoveRecipes(project("BW"))).toBe(true);
  expect(supportsMoveRecipes(project("BW2"))).toBe(true);
  expect(supportsMoveRecipes(project("HGSS"))).toBe(false);
});
