import { NativeFont } from "../customUi/assets";
import { writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { actions } from "../cgearButtons/document";
import type { Assets } from "../cgearButtons/compiler";

// Synthetic four-pixel glyphs keep compiler tests independent of retail assets.
export function buttonFont(): Uint8Array {
  const b = new Uint8Array(274);
  writeU32(b, 32, 44); writeU32(b, 40, 260);
  b[44] = 4; b[45] = 5; writeU16(b, 46, 8);
  for (let i = 0; i < 26; i++) {
    const at = 52 + i * 8; b[at + 1] = 4; b[at + 2] = 5;
    b.set([0x55, 0x41, 0x55, 0x41, 0x55], at + 3);
  }
  writeU16(b, 260, 65); writeU16(b, 262, 90);
  return b;
}
export function buttonNative(): NARC {
  const arc = new NARC(); arc.files = Array.from({ length: 31 }, () => new Uint8Array(4));
  const cell=new Uint8Array(48+39*16+39*12);cell.set(new TextEncoder().encode("RECN"));writeU16(cell,24,39);writeU16(cell,26,1);writeU32(cell,28,24);
  for(let i=0;i<39;i++) {const entry=48+i*16,at=48+39*16+i*12;writeU16(cell,entry,2);writeU32(cell,entry+4,i*12);writeU16(cell,at,0x4005);writeU16(cell,at+2,0x1f8);writeU16(cell,at+6,0x4f0);writeU16(cell,at+8,0x81f0);}
  for(const i of [22,25]){const at=48+39*16+i*12;writeU16(cell,at,0xf8);writeU16(cell,at+2,0x41f8);}
  const ring=48+39*16+38*12;writeU16(cell,48+38*16,1);writeU16(cell,ring,0x4e0);writeU16(cell,ring+2,0xc1e0);writeU16(cell,ring+4,16);
  arc.files[17]=cell;arc.files[29]=cell.slice();
  arc.files[16]=new Uint8Array(2608);arc.files[16].set(new TextEncoder().encode("RGCN"));writeU32(arc.files[16],40,2560);writeU32(arc.files[16],44,24);
  // A synthetic 36px native ring, four bright pixels wide, with a dark pattern interior.
  for(let y=14;y<50;y++)for(let x=14;x<50;x++){const d=Math.hypot(x-31.5,y-31.5),v=d<14?9:d<18?1:0,at=560+(Math.floor(y/8)*8+Math.floor(x/8))*32+y%8*4+Math.floor(x%8/2);arc.files[16][at]|=v<<(x%2*4);}
  for(const [member,count]of [[18,31],[30,3]]) {
    const frames=Array.from({length:count},(_,i)=>member===18?i===4?[31,32,33,34]:i===5?[36,37]:i===6?[22]:i===7?[25,22,25,22]:i===22?[38]:[0]:[0]);
    const n=frames.reduce((n,f)=>n+f.length,0),a=new Uint8Array(48+count*16+n*8+n*4);a.set(new TextEncoder().encode("RNAN"));a.set(new TextEncoder().encode("KNBA"),16);writeU16(a,12,16);writeU16(a,14,1);writeU32(a,20,a.length-16);writeU16(a,24,count);writeU16(a,26,n);writeU32(a,28,24);writeU32(a,32,24+count*16);writeU32(a,36,24+count*16+n*8);
    let k=0;for(let i=0;i<count;i++){writeU16(a,48+i*16,frames[i].length);writeU32(a,52+i*16,0x10000);writeU32(a,56+i*16,1);writeU32(a,60+i*16,k*8);for(const c of frames[i]){writeU32(a,48+count*16+k*8,k*4);writeU16(a,48+count*16+k*8+4,1);writeU16(a,48+count*16+n*8+k*4,c);k++;}}
    arc.files[member]=a;
  }
  for (const member of [6, 14, 15]) arc.files[member] = new Uint8Array(552);
  for (let i = 19; i < 29; i++) {
    arc.files[i] = new Uint8Array(688); arc.files[i].set(new TextEncoder().encode("RGCN"));writeU32(arc.files[i],40,640);
  }
  return arc;
}
export function buttonItems(): NARC {
  const items = new NARC(); items.files = Array.from({ length: 639 }, () => new Uint8Array(36));
  for (const a of actions) if (a.item) {
    items.files[a.item][10] = a.group!;
    if (a.alternate) items.files[a.alternate][10] = a.id === "splicers" ? 29 : a.group!;
  }
  return items;
}
export function buttonTestAssets(): Assets {
  return { font: new NativeFont(buttonFont()), native: buttonNative(),
    itemGroups: new Map(buttonItems().files.map((b, i) => [i, b[10]])), itemNames: new Map() };
}
