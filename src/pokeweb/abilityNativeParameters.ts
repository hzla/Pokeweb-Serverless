import { readU16, writeU16, writeU32 } from "../nds/binary";
import hpHelper from "../assets/data/abilityHpPercentHelper.json";
import type { RpmModule } from "./rpm";
export type AbilityParameterSite = {
  handler: string; offset: number; mode: "argument" | "store" | "immediate" | "smallImmediate" | "shiftMultiplier" | "hpPercent" | "hpAtLeast" | "resultMap";
  argument?: number; field?: number; width?: 1 | 4; scale?: number; minimum?: number; shiftBase?: number; original?: number; expected?: number;
};
export type NativeAbilityParameter = {
  key: string; label: string; kind: "ability" | "type" | "status" | "majorStatus" | "stat" | "weather" | "category" | "number";
  original: number; min: number; max: number; step: number; choices?: number[]; nonzero?: boolean;
  sites: AbilityParameterSite[];
  labels?: Record<number,string>; when?: {key:string;value:number|number[]};
};
/** Tail-call adapter: preserve the caller's stack and r4 while changing typed arguments/fields. */
export function abilityArgumentAdapter(rpm: RpmModule, edits: Array<{ site: AbilityParameterSite; value: number }>, target: number): Uint8Array {
  const instructions: number[] = [0xb410], literals: Array<{ at: number; register: number; value: number; target?: boolean }> = [];
  const literal = (register: number, value: number, target = false) => { literals.push({ at: instructions.length * 2, register, value, target }); instructions.push(0); };
  for (const { site, value } of edits) if (site.mode === "store") {
    literal(4, value);
    const offset = site.field!;
    if (site.argument !== 1 || offset < 0 || (site.width === 4 ? offset % 4 || offset > 124 : offset > 31)) throw new Error("Unsupported native field adapter.");
    instructions.push((site.width === 4 ? 0x6000 | (offset / 4 << 6) : 0x7000 | offset << 6) | 1 << 3 | 4);
  }
  for (const { site, value } of edits) if (site.mode === "argument") literal(site.argument!, Math.round(value * (site.scale ?? 1)));
  literal(4, 0, true); instructions.push(0x46a4, 0xbc10, 0x4760); // mov ip,r4; pop {r4}; bx ip
  const pool = (instructions.length * 2 + 3) & ~3, bytes = new Uint8Array(pool + literals.length * 4);
  instructions.forEach((ins, i) => writeU16(bytes, i * 2, ins));
  literals.forEach((entry, i) => {
    const at = pool + i * 4, delta = at - ((entry.at + 4) & ~3);
    if (delta < 0 || delta > 1020 || !Number.isInteger(entry.register) || entry.register < 0 || entry.register > 7) throw new Error("Invalid native argument adapter.");
    writeU16(bytes, entry.at, 0x4800 | entry.register << 8 | delta / 4);
    writeU32(bytes, at, entry.value >>> 0);
    if (entry.target) {
      // Caller appends this helper next, aligned exactly like all owned symbols.
      const start = (rpm.code.length + 3) & ~3;
      rpm.relocations.push({ target: { module: "base", address: start + at, type: "OFFSET" }, sourceSymbolIndex: target });
    }
  });
  return bytes;
}
export function abilityHpPercentAdapter(value: number, minimum: number): Uint8Array {
  const bytes = Uint8Array.from(hpHelper.code);
  writeU32(bytes, hpHelper.percentOffset, Math.round(value * 100));
  writeU32(bytes, hpHelper.minimumOffset, minimum);
  return bytes;
}
export function abilityHpAtLeastAdapter(value:number):Uint8Array {
  const bytes=Uint8Array.from(hpHelper.atLeastCode);writeU32(bytes,hpHelper.atLeastPercentOffset,Math.round(value*100));return bytes;
}
export function abilityResultMapAdapter(rpm: RpmModule, edits: Array<{site:AbilityParameterSite;value:number}>, target:number):Uint8Array {
  const instructions=[0xb510,0,0x47a0], exits:number[]=[];
  for(const {site,value} of edits){instructions.push(0x2800|value,0xd101,0x2000|site.original!);exits.push(instructions.length*2);instructions.push(0);}
  instructions.push(0x20ff);const end=instructions.length*2;instructions.push(0xbd10);
  const pool=(instructions.length*2+3)&~3, bytes=new Uint8Array(pool+4);
  instructions.forEach((ins,i)=>writeU16(bytes,i*2,ins));
  writeU16(bytes,2,0x4c00|(pool-4)/4);
  for(const at of exits)writeU16(bytes,at,0xe000|((end-at-4)>>1)&0x7ff);
  rpm.relocations.push({target:{module:"base",address:((rpm.code.length+3)&~3)+pool,type:"OFFSET"},sourceSymbolIndex:target});
  return bytes;
}
export function applyAbilityImmediate(code: Uint8Array, site: AbilityParameterSite, value: number): void {
  const instruction = readU16(code, site.offset);
  if(site.expected!==undefined&&instruction!==site.expected)throw new Error("Changed native ability operand.");
  if(site.mode === "smallImmediate") {
    if((instruction & 0xfe00)!==0x1c00 || value<0 || value>7 || !Number.isInteger(value))throw new Error("Unrecognized small native operand.");
    writeU16(code,site.offset,(instruction&~0x1c0)|value<<6);return;
  }
  if(site.mode === "shiftMultiplier") {
    const shift=Math.log2(value)+(site.shiftBase??0);if((instruction&0xf800)!==0 || !Number.isInteger(shift)||shift<0||shift>31)throw new Error("Invalid native shift multiplier.");
    writeU16(code,site.offset,(instruction&~0x7c0)|shift<<6);return;
  }
  if (![0x2000, 0x2800, 0x3000, 0x3800].includes(instruction & 0xf800) || value < 0 || value > 255 || !Number.isInteger(value)) throw new Error("Unrecognized native operand edit.");
  code[site.offset] = value;
}
