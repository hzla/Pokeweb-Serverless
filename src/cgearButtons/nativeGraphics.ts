import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { NARC } from "../nds/narc";

const sizes = [[[8,8],[16,16],[32,32],[64,64]],[[16,8],[32,8],[32,16],[64,32]],[[8,16],[8,32],[16,32],[32,64]]];
type Part = { a:number; b:number; c:number; pixels:Uint8Array };
const equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function sameGraphics(a:NARC,b:NARC):boolean {return equal(a.files[0],b.files[0])&&equal(a.files[1],b.files[1]);}
const sourceCache=new WeakMap<NARC,NARC>(),packedCache=new WeakMap<NARC,NARC>();
const decoratedCache=new WeakMap<NARC,Map<number,NARC>>();
const circleCache=new WeakMap<NARC,Uint8Array>();
export function originalGraphics(native:NARC):NARC {const cached=sourceCache.get(native);if(cached)return cached;const arc=new NARC();arc.files=[native.files[16].slice(),native.files[17].slice()];sourceCache.set(native,arc);return arc;}

/** Keep the native bright control ring within our 32px sprite allocation. */
export function nativeButtonCircle(native:NARC,original=originalGraphics(native)):Uint8Array {
  const cached=circleCache.get(original);if(cached)return cached;
  const frame=parsePokemonAnimation(native.files[18]).sequences[22]?.frames[0],cells=original.files[1];
  if(!frame||frame.cellIndex>=readU16(cells,24))throw new Error("The ROM is missing its native C-Gear control ring.");
  const start=24+readU32(cells,28),entry=start+frame.cellIndex*16,oam=start+readU16(cells,24)*16+readU32(cells,entry+4);
  if(readU16(cells,entry)!==1||readU16(cells,oam)!==0x4e0||readU16(cells,oam+2)!==0xc1e0)throw new Error("Unsupported native C-Gear control ring layout.");
  const data=original.files[0].subarray(48+(readU16(cells,oam+4)&1023)*32,48+(readU16(cells,oam+4)&1023)*32+2048);
  if(data.length!==2048)throw new Error("The native C-Gear control ring is truncated.");
  const pixels=new Uint8Array(4096);let left=64,top=64,right=-1,bottom=-1;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const at=(Math.floor(y/8)*8+Math.floor(x/8))*32+y%8*4+Math.floor(x%8/2),v=data[at]>>(x%2*4)&15;
    if(![0,1,2,3,9].includes(v))throw new Error("Unsupported native C-Gear control ring colors.");
    pixels[y*64+x]=v;if(v){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  }
  if(right-left!==35||bottom-top!==35)throw new Error("Unsupported native C-Gear control ring dimensions.");
  const result=new Uint8Array(1024);
  // Nearest-neighbor sampling pushes four diagonal edge pixels beyond the
  // 16px radius. Keep those transparent before applying the caption.
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if((x-15.5)**2+(y-15.5)**2<=256)
    result[y*32+x]=pixels[(top+Math.floor((y+.5)*36/32))*64+left+Math.floor((x+.5)*36/32)];
  circleCache.set(original,result);return result;
}

/** Replace selector/power glyphs while retaining their native circles and palettes. */
export function buttonGraphics(original:NARC,native?:NARC,selector=false,saveControl=false,style:1|2|3=3):NARC {
  if(!selector&&!saveControl)return packNativeGraphics(original);
  const indices=[31,32,33,34,36,37];
  if(native&&selector){
    const seq=parsePokemonAnimation(native.files[18]).sequences;
    if([4,5].flatMap(i=>seq[i]?.frames.map(f=>f.cellIndex)??[]).join(",")!==indices.join(","))
      throw new Error("The ROM changed the C-Gear background selector animation; restore compatible graphics.");
  }
  const key=Number(selector)|Number(saveControl)<<1|style<<2,cache=decoratedCache.get(original)??new Map<number,NARC>(),cached=cache.get(key);if(cached)return cached;decoratedCache.set(original,cache);
  const [characters,cells]=original.files,start=24+readU32(cells,28),oam=start+readU16(cells,24)*16;
  const feedback=selector&&style===3,glyphBytes=feedback?128:64;
  const char=new Uint8Array(characters.length+glyphBytes+(saveControl?128:0));char.set(characters);
  const glyph=new Uint8Array(16*8);
  for(let y=0;y<7;y++)for(const offset of [2,8])for(let w=0;w<2;w++)glyph[y*16+offset+3-Math.abs(3-y)+w]=7;
  for(let y=0;y<8;y++)for(let x=0;x<16;x+=2)char[characters.length+Math.floor(x/8)*32+y*4+(x%8)/2]=glyph[y*16+x]|glyph[y*16+x+1]<<4;
  if(feedback)for(let i=0;i<64;i++){const v=char[characters.length+i];char[characters.length+64+i]=(v&15?3:0)|(v>>4?48:0);}
  writeU32(char,8,char.length);writeU32(char,20,char.length-16);writeU32(char,40,char.length-48);
  const cell=cells.slice(),tile=(characters.length-48)/32;
  for(const i of selector?indices:[]){
    const entry=start+i*16,at=oam+readU32(cell,entry+4);
    if(i>=readU16(cell,24)||readU16(cell,entry)!==2||at+12>cell.length||readU16(cell,at)!==0x4005||readU16(cell,at+2)!==0x1f8||readU16(cell,at+6)!==0x4f0||readU16(cell,at+8)!==0x81f0)
      throw new Error("The ROM changed the C-Gear background selector cell; restore compatible graphics.");
    // Frame 1 uses the native pressed palette and a one-pixel-down caption.
    // Ordinary network updates are overridden at runtime.
    const pressed=feedback&&i===37;
    writeU16(cell,at,pressed?0x40fd:0x40fc);writeU16(cell,at+4,(readU16(cell,at+4)&0xfc00)|(tile+(pressed?2:0)));
    if(pressed)for(const offset of [4,10])writeU16(cell,at+offset,(readU16(cell,at+offset)&0x0fff)|0x1000);
  }
  if(saveControl){
    if(native&&[6,7].flatMap(i=>parsePokemonAnimation(native.files[18]).sequences[i]?.frames.map(f=>f.cellIndex)??[]).join(",")!=="22,25,22,25,22")throw new Error("The ROM changed the native power-control animation; restore compatible graphics.");
    // A 12px floppy silhouette using the wrench/question mark's dark detail
    // index; the circle supplies the theme fill. Retain the two
    // older variants so recognized installations can be updated/restored.
    const disk=["111111111000","110000010100","110000010110","110000010111","110000000111","111111111111","111111111111","110000000011","110000000011","110000000011","110000000011","111111111111"];
    for(let y=0;y<16;y++)for(let x=0;x<16;x+=2){const pixel=(px:number)=>y>=2&&y<14&&px>=2&&px<14&&disk[y-2][px-2]==="1"?(style===1?7:style===2?1:3):0;char[characters.length+glyphBytes+(Math.floor(y/8)*2+Math.floor(x/8))*32+(y%8)*4+(x%8)/2]=pixel(x)|pixel(x+1)<<4;}
    for(const i of [22,25]){
      const entry=start+i*16,at=oam+readU32(cell,entry+4);
      if(i>=readU16(cell,24)||readU16(cell,entry)!==2||readU16(cell,at)!==0xf8||readU16(cell,at+2)!==0x41f8)throw new Error("The ROM changed the native power-control cell; restore compatible graphics.");
      writeU16(cell,at+4,(readU16(cell,at+4)&0xfc00)|(tile+glyphBytes/32));
    }
  }
  const changed=new NARC();changed.files=[char,cell];const packed=packNativeGraphics(changed);cache.set(key,packed);return packed;
}

/** Lossless cell repacking. Transparent tiles in non-affine 64px effects need no OAM. */
export function packNativeGraphics(original:NARC):NARC {
  const cached=packedCache.get(original);if(cached)return cached;
  const [characters,cells]=original.files;
  if(original.files.length!==2||!characters||!cells||readAscii(characters,0,4)!=="RGCN"||readAscii(cells,0,4)!=="RECN"||readU16(cells,26)!==1||readU32(characters,36)!==0||readU32(characters,44)!==24)
    throw new Error("Unsupported native C-Gear character/cell layout; restore compatible graphics.");
  const count=readU16(cells,24),start=24+readU32(cells,28),oam=start+count*16,data=characters.subarray(48),groups:Part[][]=[];
  if(start!==48||oam>cells.length||readU32(characters,40)!==data.length||data.length%32)throw new Error("Invalid native C-Gear sprite data.");
  for(let i=0;i<count;i++) {
    const n=readU16(cells,start+i*16),at=oam+readU32(cells,start+i*16+4),parts:Part[]=[];
    if(at+n*6>cells.length)throw new Error("Invalid native C-Gear OAM data.");
    for(let j=0;j<n;j++) {
      const a=readU16(cells,at+j*6),b=readU16(cells,at+j*6+2),c=readU16(cells,at+j*6+4),size=sizes[a>>>14]?.[b>>>14];
      if(!size||a&0x2000)throw new Error("Unsupported native C-Gear sprite format.");
      const [w,h]=size,pixels=data.slice((c&1023)*32,(c&1023)*32+w*h/2);
      if(pixels.length!==w*h/2)throw new Error("Native C-Gear sprite exceeds its character data.");
      if(w!==64||h!==64||a&0x100) {parts.push({a,b,c,pixels});continue;}
      function split(x:number,y:number,s:number) {
        const p=new Uint8Array(s*s/2);for(let row=0;row<s/8;row++)p.set(pixels.subarray(((y/8+row)*8+x/8)*32,((y/8+row)*8+(x+s)/8)*32),row*s*4);
        const occupied=Array.from({length:p.length/32},(_,t)=>p.subarray(t*32,t*32+32).some(v=>v!==0));
        if(!occupied.some(Boolean))return;
        if(s>8&&!occupied.every(Boolean)){for(const dy of [0,s/2])for(const dx of [0,s/2])split(x+dx,y+dy,s/2);return;}
        // Preserve flips, flags, palette and OAM order. Place reflected subrectangles correctly.
        const dx=b&0x1000?64-x-s:x,dy=b&0x2000?64-y-s:y;
        const newA=(a&0x3f00)|((a+dy)&255),newB=(b&0x3e00)|((b+dx)&511)|([8,16,32,64].indexOf(s)<<14);
        parts.push({a:newA,b:newB,c,pixels:p});
      }
      split(0,0,64);
    }
    groups.push(parts);
  }
  let packed=new Uint8Array();const indices=new Map<Part,number>();
  function locate(b:Uint8Array):number {for(let i=0;i<=packed.length-b.length;i+=32)if(equal(packed.subarray(i,i+b.length),b))return i;return -1;}
  for(const part of groups.flat().sort((a,b)=>b.pixels.length-a.pixels.length)) {
    let index=locate(part.pixels);
    if(index<0){let overlap=Math.min(packed.length,part.pixels.length);for(;overlap>0;overlap-=32)if(equal(packed.subarray(packed.length-overlap),part.pixels.subarray(0,overlap)))break;
      index=packed.length-overlap;const next=new Uint8Array(packed.length+part.pixels.length-overlap);next.set(packed);next.set(part.pixels.subarray(overlap),packed.length);packed=next;}
    indices.set(part,index/32);
  }
  const char=new Uint8Array(48+packed.length);char.set(characters.subarray(0,48));char.set(packed,48);writeU32(char,8,char.length);writeU32(char,20,char.length-16);writeU32(char,40,packed.length);
  const cell=new Uint8Array(oam+groups.reduce((n,g)=>n+g.length*6,0));cell.set(cells.subarray(0,oam));writeU32(cell,8,cell.length);writeU32(cell,20,cell.length-16);let pos=oam;
  groups.forEach((g,i)=>{writeU16(cell,start+i*16,g.length);writeU32(cell,start+i*16+4,pos-oam);for(const p of g){writeU16(cell,pos,p.a);writeU16(cell,pos+2,p.b);writeU16(cell,pos+4,(p.c&0xfc00)|indices.get(p)!);pos+=6;}});
  const result=new NARC();result.files=[char,cell];packedCache.set(original,result);return result;
}
export function spriteBudget(packed:NARC,native:NARC,buttons:number):{bytes:number;capacity:number;oam:number} {
  const patternBytes=Math.max(...native.files.slice(19,29).map(b=>readU32(b,40)));
  const bytes=512+readU32(packed.files[0],40)+patternBytes+buttons*512;
  if(bytes>16384)throw new Error(`C-Gear sprites need ${bytes} bytes; this ROM has 16384. Reduce buttons or restore compatible native graphics.`);
  const common=parsePokemonAnimation(native.files[18]).sequences,panel=parsePokemonAnimation(native.files[30]).sequences;
  const maximum=(groups:number[][],seq:typeof common,cells:Uint8Array)=>groups.reduce((n,g)=>n+Math.max(...g.flatMap(i=>{
    const s=seq[i];if(!s?.frames.length)throw new Error("Unsupported native C-Gear animation sequences.");
    return s.frames.map(f=>{if(f.cellIndex>=readU16(cells,24))throw new Error("Native C-Gear animation references a missing cell.");return readU16(cells,48+f.cellIndex*16);});
  })),0);
  const groups=[[0],[0],[0],[0],[1,2],[4,5],[21],[6,7],[8,9],[10,11],[12,13,14,15],[3],[16,17,18,19,20],[22,25],[23,26],[24,27]];
  const oam=maximum(groups,common,packed.files[1])+maximum([[0],[1],[2]],panel,native.files[29])+5*maximum([[28,29,30]],common,packed.files[1])+buttons+1;
  if(oam>128)throw new Error(`C-Gear needs ${oam} OAM entries; the native limit is 128. Restore compatible native graphics.`);
  return {bytes,capacity:16384,oam};
}
