import { readU16 } from "../nds/binary";
import { battleBranchTarget } from "./battleRuntimeBindings";

/** Find the reviewed battle-start call to the native event-list initializer.
 * The caller retains the original service entry, so other runtimes can own it.
 * Reject additional callers or a changed caller rather than guess. */
export function moveHistoryInitCall(overlay: Uint8Array, base: number, initializer: number): number {
  const callers: number[] = [];
  for (let at = 0; at + 4 <= overlay.length; at += 2) {
    const hi = readU16(overlay, at), lo = readU16(overlay, at + 2);
    if ((hi & 0xf800) !== 0xf000 || (lo & 0xf800) !== 0xf800) continue;
    if (battleBranchTarget(overlay, at, base) === initializer) callers.push(at);
  }
  if (callers.length !== 1) throw Error("Unrecognized battle history initialization callers.");
  const at = callers[0];
  const expected: Array<[number, number]> = [[-6,0xb5f8],[-4,0xb082],[-2,0x1c05],[4,0x2000],[6,0x2600],[12,0x1c28],[14,0x301c]];
  const branch = (offset: number) => (readU16(overlay,at+offset)&0xf800) === 0xf000 && (readU16(overlay,at+offset+2)&0xf800) === 0xf800;
  if (at < 6 || at + 20 > overlay.length || !expected.every(([offset,value]) => readU16(overlay, at + offset) === value) || !branch(8) || !branch(16))
    throw Error("Unrecognized battle history initialization sequence.");
  return base + at;
}

/** Native Protect's bypass check is called only after the defender's Protect
 * flag is known to be set. Its return value tells us whether it blocked. */
export function moveHistoryProtectCall(overlay:Uint8Array,base:number):{site:number;target:number} {
  const prefix=Uint8Array.from([0x02,0x9b,0x28,0x1c,0x1b,0x88,0x31,0x1c,0x3a,0x1c]);
  const sites:number[]=[];
  for(let at=10;at+12<=overlay.length;at+=2){
    if(!prefix.every((v,n)=>overlay[at-10+n]===v)||readU16(overlay,at+4)!==0x2800||readU16(overlay,at+6)!==0xd10e)continue;
    if((readU16(overlay,at)&0xf800)===0xf000&&(readU16(overlay,at+2)&0xf800)===0xf800)sites.push(at);
  }
  if(sites.length!==1)throw Error("Unrecognized native Protect call site.");
  const site=base+sites[0],target=battleBranchTarget(overlay,sites[0],base),at=target-base;
  const expected:Array<[number,number]>=[[0,0xb570],[2,0x4e0f],[4,0x1c05],[6,0x1c0c],[8,0x1c30],[14,0x1c20],[20,0x1c01],[22,0x2003],[28,0x2051],[30,0x2100],[36,0x1c28],[38,0x212e],[44,0x2051],[50,0x1c04],[52,0x1d70],[58,0x1c20],[60,0xbd70],[62,0x46c0]];
  if(at<0||at+68>overlay.length||!expected.every(([offset,value])=>readU16(overlay,at+offset)===value))throw Error("Unrecognized native Protect check.");
  return {site,target};
}
