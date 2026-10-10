import { NativeFont, type Image } from "../customUi/assets";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { originalGraphics, buttonGraphics, spriteBudget, nativeButtonCircle } from "./nativeGraphics";
import { circles } from "./circles";
import { actionFor, type Document, type Project } from "./document";
import { defaultSkins, skinBytes, validateSkins } from "./skins";
export type Assets = { font: NativeFont; native: NARC; itemGroups: Map<number,number>; itemNames: Map<number,string>; originalGraphics?: NARC };
export type Diagnostic = { severity: "error" | "warning"; button?: number; message: string };
export const fingerprint=(b:Uint8Array)=>{let h=0x811c9dc5;for(const v of b)h=Math.imul(h^v,0x1000193)>>>0;return h;};
function concat(parts:Uint8Array[]):Uint8Array { const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b; }
function caption(assets:Assets,label:string) {
  const glyphs=Array.from(label,c=>assets.font.glyph(c));if(glyphs.some(g=>!g))throw new Error("Label contains a missing game glyph.");
  const width=glyphs.reduce((n,g)=>n+g!.advance,0)+2, height=12, pixels=new Uint8Array(width*height);let x=1;
  for(const g of glyphs){for(let y=0;y<Math.min(height,g!.height);y++)for(let dx=0;dx<g!.width;dx++)if(g!.pixels[y*g!.width+dx]===1 && x+dx<width)pixels[y*width+x+dx]=1;x+=g!.advance;}
  let left=width,right=-1,top=height,bottom=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[y*width+x]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)throw new Error("Enter a visible label.");const w=right-left+1,h=bottom-top+1,out=new Uint8Array(w*5);
  for(let y=0;y<5;y++)for(let x=0;x<w;x++)out[y*w+x]=pixels[(top+Math.min(h-1,Math.floor((y+.5)*h/5)))*width+left+x];
  return {width:w,pixels:out};
}
export function validate(doc:Document,assets:Assets):Diagnostic[] {
  const out:Diagnostic[]=[],ids=new Set<number>();const error=(message:string,button?:number)=>out.push({severity:"error",message,button});
  if(doc.version!==1||!Array.isArray(doc.buttons)||doc.buttons.length>8) {error("Use a version 1 design with at most eight buttons.");return out;}
  if(doc.hideCommunicationButtons!==undefined&&typeof doc.hideCommunicationButtons!=="boolean")error("Choose whether to hide communication buttons.");
  if(!Number.isInteger(doc.nextId)||doc.nextId<1||doc.nextId>65536)error("Invalid next button ID.");
  try { validateSkins(doc.skins ?? defaultSkins()); } catch(e) { error((e as Error).message); }
  for(const b of doc.buttons){
    if(!Number.isInteger(b.id)||b.id<1||b.id>65535||ids.has(b.id))error("Button IDs must be unique.",b.id);ids.add(b.id);
    if(!Number.isInteger(b.x)||!Number.isInteger(b.y)||b.x<16||b.x>240||b.y<16||b.y>176)error("Center must be within X 16–240 and Y 16–176.",b.id);
    if(!/^#[0-9a-f]{6}$/i.test(b.color))error("Choose a valid outline color.",b.id);
    if(typeof b.label!=="string"||b.label!==b.label.toUpperCase()||b.label.length>32)error("Use a short uppercase label.",b.id);
    else try{if(caption(assets,b.label).width>28)error("Label exceeds 28 foreground pixels; abbreviate it.",b.id);}catch(e){error((e as Error).message,b.id);}
    const a=actionFor(b.action);if(!a)error("Unsupported action.",b.id);
    else if(a.item && (assets.itemGroups.get(a.item)!==a.group || (a.alternate && assets.itemGroups.get(a.alternate)!==(a.id==="splicers"?29:a.group))))error(`The ROM changed ${a.name}'s field handler; this native adapter is incompatible.`,b.id);
    if(b.flag&&(!Number.isInteger(b.flag.id)||b.flag.id<1||b.flag.id>3059||!["set","clear"].includes(b.flag.when)))error("Visibility requires a saved flag from 1–3059 and a set/clear condition.",b.id);
    if(doc.buttons.some(c=>c.id!==b.id&&(b.x-c.x)**2+(b.y-c.y)**2<1024))out.push({severity:"warning",button:b.id,message:"Overlaps another custom button; the front button receives touch."});
    const controls=[...(doc.hideCommunicationButtons?[]:[[68,60,16],[188,60,16],[128,164,18],[36,158,16]]),[228,144,12],[216,160,10],[200,176,10],[208,18,17],[48,18,17],[128,14,24]];
    if(controls.some(([x,y,r])=>(b.x-x)**2+(b.y-y)**2<(r+16)**2))out.push({severity:"warning",button:b.id,message:"May overlap a native control; wrench and pattern-toggle input retain priority."});
  }if(doc.buttons.some(b=>b.id>=doc.nextId))error("Next button ID must be greater than existing IDs.");return out;
}
function nitro(magic:string,block:string,payload:Uint8Array):Uint8Array {const out=new Uint8Array(24+payload.length);out.set(new TextEncoder().encode(magic));writeU16(out,4,0xfeff);writeU16(out,6,0x100);writeU32(out,8,out.length);writeU16(out,12,16);writeU16(out,14,1);out.set(new TextEncoder().encode(block),16);writeU32(out,20,8+payload.length);out.set(payload,24);return out;}
export function tile(pixels:Uint8Array):Uint8Array {const out=new Uint8Array(512);let at=0;for(let ty=0;ty<4;ty++)for(let tx=0;tx<4;tx++)for(let y=0;y<8;y++)for(let x=0;x<8;x+=2)out[at++]=pixels[(ty*8+y)*32+tx*8+x]|pixels[(ty*8+y)*32+tx*8+x+1]<<4;return out;}
export function untile(bytes:Uint8Array):Uint8Array {const out=new Uint8Array(1024);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const at=(Math.floor(y/8)*4+Math.floor(x/8))*32+(y%8)*4+Math.floor(x%8/2);out[y*32+x]=bytes[at]>>(x%2*4)&15;}return out;}
export function patterns(assets:Assets):Uint8Array {const out=new Uint8Array(5120);for(let i=0;i<10;i++){const b=assets.native.files[19+i],p=b?.subarray(176,688);if(!p||p.length!==512||p.some(v=>![0,9,13].includes(v&15)||![0,9,13].includes(v>>4)))throw new Error(`Incompatible C-Gear pattern ${i+1}.`);out.set(p,i*512);}return out;}
export function compile(doc:Document,assets:Assets,enabled=true,source?:Project):{diagnostics:Diagnostic[];archive?:Uint8Array;nativeGraphics?:NARC;budget?:{bytes:number;capacity:number;oam:number}} {
  const diagnostics=validate(doc,assets);if(diagnostics.some(d=>d.severity==="error"))return {diagnostics};
  try{
    const original=assets.originalGraphics??originalGraphics(assets.native), packed=buttonGraphics(original,assets.native,true,true),budget=spriteBudget(packed,assets.native,doc.buttons.length);
    const skins=doc.skins??defaultSkins();
    const catalog=new Uint8Array(16+skins.entries.length*8);writeU32(catalog,0,0x534e4b53);writeU16(catalog,4,1);writeU16(catalog,6,skins.entries.length);
    const skinFiles=skins.entries.map((skin,i)=>{const bytes=skinBytes(skin.data);writeU16(catalog,16+i*8,skin.id);writeU16(catalog,18+i*8,16+i);writeU32(catalog,20+i*8,fingerprint(bytes));return bytes;});
    const header=new Uint8Array(160);writeU32(header,0,0x41475143);writeU16(header,4,7);writeU16(header,6,160);writeU32(header,8,+enabled);writeU32(header,12,0x41475143 ^ +enabled);header[20]=doc.buttons.length;header[21]=skins.entries.length;writeU16(header,22,skins.defaultId);
    const pal=new Uint8Array(16+256);writeU32(pal,0,3);writeU32(pal,8,256);writeU32(pal,12,16);
    const cells=new Uint8Array(24+8*16+8*8);writeU16(cells,0,8);writeU16(cells,2,1);writeU32(cells,4,24);
    const anim=new Uint8Array(24+8*16+8*8+8*4);writeU16(anim,0,8);writeU16(anim,2,8);writeU32(anim,4,24);writeU32(anim,8,152);writeU32(anim,12,216);
    const banks:Uint8Array[]=[];
    for(let i=0;i<8;i++){
      const b=doc.buttons[i],a=b&&actionFor(b.action)!,at=32+i*16;
      if(b){writeU16(header,at,b.id);header[at+2]=a.code;header[at+3]=b.flag?(b.flag.when==="set"?1:2):0;writeU16(header,at+4,a.item);writeU16(header,at+6,a.alternate??0);writeU16(header,at+8,b.flag?.id??0);header[at+10]=b.x;header[at+11]=b.y;header[at+12]=a.check;}
      for(let j=0;j<16;j++)writeU16(pal,16+i*32+j*2,readU16(assets.native.files[14],104+j*2));
      writeU16(pal,16+i*32+14,0);const col=parseInt(b?.color.slice(1)??"c068f0",16),r=col>>16,g=col>>8&255,bl=col&255;
      writeU16(pal,16+i*32+16,(r>>3)|((g>>3)<<5)|((bl>>3)<<10));writeU16(pal,16+i*32+28,Math.floor(r/24)|(Math.floor(g/24)<<5)|(Math.floor(bl/24)<<10));
      const c=24+i*16;writeU16(cells,c,1);writeU16(cells,c+2,0x0808);writeU32(cells,c+4,i*8);for(const [off,v]of [[8,15],[10,15],[12,65520],[14,65520]])writeU16(cells,c+off,v);
      const o=152+i*8;writeU16(cells,o,240);writeU16(cells,o+2,0x81f0);writeU16(cells,o+4,i<<12);
      const s=24+i*16;writeU16(anim,s,1);writeU32(anim,s+4,0x10000);writeU32(anim,s+8,1);writeU32(anim,s+12,i*8);writeU32(anim,152+i*8,i*4);writeU16(anim,156+i*8,1);writeU16(anim,216+i*4,i);
      const bank=new Uint8Array(2048),text=b?caption(assets,b.label):undefined;
      for(let pose=0;pose<4;pose++){
        const pixels=b&&(b.action==="party"||b.action==="pc")?nativeButtonCircle(assets.native,original).slice():Uint8Array.from(circles[pose].join(""),c=>parseInt(c,16));
        if(b&&(b.action==="party"||b.action==="pc")&&pose===3)for(let n=0;n<pixels.length;n++)if(pixels[n]>=1&&pixels[n]<=3)pixels[n]=3;
        if(text){const ox=Math.floor((32-text.width)/2),oy=13+(pose===2?1:0);for(const [radius,index]of [[2,7],[1,pose===3?14:8],[0,7]])for(let y=0;y<5;y++)for(let x=0;x<text.width;x++)if(text.pixels[y*text.width+x])for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const px=ox+x+dx,py=oy+y+dy;if(px>=0&&px<32&&py>=0&&py<32)pixels[py*32+px]=index;}}
        bank.set(tile(pixels),pose*512);
      }banks.push(bank);
    }
    header[45]=+!!doc.hideCommunicationButtons;
    const p=patterns(assets),graphics=[nitro("RLCN","TTLP",pal),nitro("RECN","KBEC",cells),nitro("RNAN","KNBA",anim),...banks];writeU32(header,16,fingerprint(p));writeU32(header,24,fingerprint(concat(graphics)));writeU32(header,28,fingerprint(concat([header.subarray(0,28),header.subarray(32)])));
    const arc=new NARC();arc.files=[header,...graphics,p,new TextEncoder().encode(JSON.stringify({...source??{document:doc,applied:doc,enabled},skinCatalogFingerprint:fingerprint(catalog),nativeGraphics:{version:3,backupFingerprint:fingerprint(original.save()),packedFingerprint:fingerprint(packed.save()),skinSelector:true,saveControl:true}})),original.save(),catalog,...skinFiles];return {diagnostics,archive:arc.save(),nativeGraphics:packed,budget};
  }catch(e){return {diagnostics:[...diagnostics,{severity:"error",message:(e as Error).message}]};}
}
export function preview(archive:Uint8Array,index:number,pose=0,design=0,theme=0,gender=0,native?:NARC):Image {
  const arc=new NARC(archive),palette=arc.files[1],art=untile(arc.files[4+index].subarray(pose*512,pose*512+512)),pattern=untile(arc.files[12].subarray((gender*5+design)*512,(gender*5+design+1)*512));
  const colors=Array.from({length:16},(_,j)=>readU16(palette,40+index*32+j*2));
  if(native)for(let j=0;j<3;j++)colors[j+1]=readU16(native.files[6],40+(theme+gender*6)*32+6+j*2);
  const pixels=new Uint8ClampedArray(4096);
  for(let n=0;n<1024;n++){let k=art[n];if(k===9&&pattern[n]===13)k=13;const c=colors[k];pixels.set([Math.round((c&31)*255/31),Math.round((c>>5&31)*255/31),Math.round((c>>10&31)*255/31),k?255:0],n*4);}return {width:32,height:32,pixels};
}
