import { describe, expect, it } from "vitest";
import { moveHistoryInitCall, moveHistoryProtectCall } from "../pokeweb/moveHistoryBindings";

const fromHex = (value: string) => Uint8Array.from(value.match(/../gu)!, n => parseInt(n, 16));
const base = 0x02100000;
const black = "0000004b1847d9b91b02f8b582b0051c1bf065fa0020002633f045ff281c1c3000f08bf8";
const sequel = "0000004b184741f41902f8b582b0051c1df059f90020002636f0c7fa281c1c3000f08bf8";
function target(code: Uint8Array): number {
  const hi=code[16]|code[17]<<8,lo=code[18]|code[19]<<8;
  let delta=(hi&0x7ff)<<12|(lo&0x7ff)<<1;if(delta&0x400000)delta-=0x800000;
  return base+20+delta;
}
describe("move history initialization binding", () => {
  it.each([black,sequel])("accepts the reviewed initialization sequence", source => {
    const code=fromHex(source);
    expect(moveHistoryInitCall(code,base,target(code))).toBe(base+16);
  });
  it("rejects changed callers and missing calls", () => {
    const code=fromHex(black), native=target(code);
    code[12]^=1;
    expect(()=>moveHistoryInitCall(code,base,native)).toThrow(/sequence/);
    expect(()=>moveHistoryInitCall(code,base,native+2)).toThrow(/callers/);
  });
  it("rejects an additional native initialization call", () => {
    const a=fromHex(black),native=target(a),code=new Uint8Array(a.length+8);code.set(a);
    // Keep the same absolute branch target when moving the second BL by 8 bytes.
    const hi=a[16]|a[17]<<8,lo=a[18]|a[19]<<8;
    let delta=(hi&0x7ff)<<12|(lo&0x7ff)<<1;if(delta&0x400000)delta-=0x800000;delta-=8;
    const movedHi=0xf000|((delta>>12)&0x7ff),movedLo=0xf800|((delta>>1)&0x7ff);
    code[24]=movedHi&255;code[25]=movedHi>>8;code[26]=movedLo&255;code[27]=movedLo>>8;
    expect(()=>moveHistoryInitCall(code,base,native)).toThrow(/callers/);
  });
  it("checks the Protect caller and callee",()=>{
    const code=new Uint8Array(160),site=16,target=80;
    code.set(fromHex("029b281c1b88311c3a1c"),site-10);
    const delta=target-site-4,hi=0xf000|(delta>>12&0x7ff),lo=0xf800|(delta>>1&0x7ff);
    code.set([hi&255,hi>>8,lo&255,lo>>8,0,0x28,0x0e,0xd1],site);
    code.set(fromHex("70b50f4e051c0c1c301c10f041ff201c0ef0e2fe011c032010f092ff5120002110f08eff281c2e2110f02efd512011f061f8041c701d10f04fff201c70bdc046362d0000"),target);
    expect(moveHistoryProtectCall(code,base)).toEqual({site:base+site,target:base+target});
    code[target]^=1;expect(()=>moveHistoryProtectCall(code,base)).toThrow(/Protect check/);
  });
});
