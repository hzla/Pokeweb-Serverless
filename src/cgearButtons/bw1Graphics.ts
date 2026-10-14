import { NARC } from "../nds/narc";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { parsePokemonAnimation, parsePokemonCellBank } from "../pokeweb/pokemonSpriteModel";
import type { Assets } from "./compiler";
import { actionFor, type Document, type Project } from "./document";

/** Native panels use c..f; the marker/lettering use separate palette entries. */
export function indexedTiles(pixels:Uint8Array,size:number,height=size):Uint8Array{
 const out=new Uint8Array(size*height/2);let n=0;
 for(let ty=0;ty<height/8;ty++)for(let tx=0;tx<size/8;tx++)for(let y=0;y<8;y++)for(let x=0;x<8;x+=2)out[n++]=pixels[(ty*8+y)*size+tx*8+x]|pixels[(ty*8+y)*size+tx*8+x+1]<<4;
 return out;
}
export function indexedPixels(bytes:Uint8Array,size:number,height=size):Uint8Array{
 const out=new Uint8Array(size*height);
 for(let y=0;y<height;y++)for(let x=0;x<size;x++){const n=((y>>3)*(size/8)+(x>>3))*32+(y&7)*4+((x&7)>>1);out[y*size+x]=bytes[n]>>((x&1)*4)&15;}
 return out;
}
export function bw1Panels(native:NARC):Uint8Array{
 const out=new Uint8Array(5120);
 for(let gender=0;gender<2;gender++)for(let design=0;design<5;design++){
  const chr=native.files[(gender?7:14)+design];
  if(!chr||readU32(chr,28)!==3||readU32(chr,40)<112*32)throw new Error("Unsupported BW1 C-Gear panel characters.");
  const image=new Uint8Array(1024);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
   // The native IR panel occupies four tiles at column 12 in each of four rows.
   const at=48+(12+(y>>3)*32+(x>>3))*32+(y&7)*4+((x&7)>>1),k=chr[at]>>((x&1)*4)&15;
   if(k!==0&&k<12)throw new Error("The BW1 native panel palette layout changed.");image[y*32+x]=k;
  }
  out.set(indexedTiles(image,32),(gender*5+design)*512);
 }
 return out;
}
function nativeMarker(native:NARC):Uint8Array{
 const cells=parsePokemonCellBank(native.files[21]),frame=parsePokemonAnimation(native.files[20]).sequences[8]?.frames[0],cell=frame&&cells.cells[frame.cellIndex];
 if(!cell||cells.mappingMode!==0)throw new Error("Unsupported BW1 C-Gear marker cells.");
 const image=new Uint8Array(4096),chr=native.files[22],map=new Map([[8,1],[13,2],[14,3],[15,4]]);
 const pieces=cell.oams.filter(o=>o.x<18);if(pieces.length!==4)throw new Error("The BW1 circle/leader marker changed.");
 for(const o of pieces){
  if(o.rotateScale||o.disable||o.characterBits!==4)throw new Error("Unsupported BW1 C-Gear marker attributes.");
  for(let y=0;y<o.height;y++)for(let x=0;x<o.width;x++){
   const sx=o.flipX?o.width-1-x:x,sy=o.flipY?o.height-1-y:y,n=48+(o.characterName+(sy>>3)*(o.width/8)+(sx>>3))*32+(sy&7)*4+((sx&7)>>1),k=chr[n]>>((sx&1)*4)&15;
   const px=16+o.x+x,py=32+o.y+y;if(k){if(!map.has(k)||px<0||px>=64||py<0||py>=64)throw new Error("Unsupported BW1 marker pixels.");image[py*64+px]=map.get(k)!;}
  }
 }
 return image;
}
export function composeBw1Button(base:Uint8Array,panel:Uint8Array):Uint8Array{
 const out=base.slice();out.set(panel,0);return out;
}
/** x/y are relative to the panel center; the final panel lies behind the marker. */
export const bw1Pieces=[[-7,-17,16,16,16],[9,-17,8,16,20],[-7,-1,16,8,22],[9,-1,8,8,24],[17,-20,32,8,25],[-16,-16,32,32,0]] as const;
export function bw1ButtonPixels(data:Uint8Array):Uint8Array{
 const out=new Uint8Array(4096);
 for(const [x,y,w,h,tile]of [...bw1Pieces].reverse()){
  const pixels=indexedPixels(data.subarray(tile*32),w,h);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){const k=pixels[py*w+px];if(k)out[(32+y+py)*64+16+x+px]=k;}
 }return out;
}
function packButton(image:Uint8Array){
 const out=new Uint8Array(1024);
 for(const [x,y,w,h,tile]of bw1Pieces.slice(0,5)){
  const pixels=new Uint8Array(w*h);for(let py=0;py<h;py++)for(let px=0;px<w;px++)pixels[py*w+px]=image[(32+y+py)*64+16+x+px];out.set(indexedTiles(pixels,w,h),tile*32);
 }return out;
}
const mix=(c:number,amount:number)=>[0,5,10].reduce((v,s)=>v|((((c>>s)&31)+Math.floor((31-((c>>s)&31))*amount/31))<<s),0);
export function bw1PoseColours(base:Uint16Array,pose:number):Uint16Array{
 const out=base.slice();
 for(let j=1;j<16;j++){
  const c=out[j];if(pose===3)out[j]=[0,5,10].reduce((v,s)=>v|Math.floor(((c>>s)&31)/3)<<s,0);
  else if((pose===1||pose===2)&&j>=12)out[j]=mix(c,pose===1?4:8);
  else if(pose===2&&j===5)out[j]=mix(c,8);
 }
 return out;
}
function nitro(magic:string,block:string,payload:Uint8Array){const out=new Uint8Array(24+payload.length);out.set(new TextEncoder().encode(magic));writeU16(out,4,0xfeff);writeU16(out,6,0x100);writeU32(out,8,out.length);writeU16(out,12,16);writeU16(out,14,1);out.set(new TextEncoder().encode(block),16);writeU32(out,20,payload.length+8);out.set(payload,24);return out;}
const join=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let n=0;for(const p of parts){out.set(p,n);n+=p.length;}return out;};
export function compileBw1(doc:Document,assets:Assets,enabled:boolean,source:Project|undefined,caption:(a:Assets,s:string)=>{width:number;pixels:Uint8Array},fingerprint:(b:Uint8Array)=>number){
 const native=assets.native,header=new Uint8Array(160);writeU32(header,0,0x41475143);writeU16(header,4,9);writeU16(header,6,160);writeU32(header,8,+enabled);writeU32(header,12,0x41475143^+enabled);header[20]=doc.buttons.length;header[45]=1;
 const pal=new Uint8Array(304);writeU32(pal,0,3);writeU32(pal,8,288);writeU32(pal,12,16);
 const cells=new Uint8Array(488),anim=new Uint8Array(304);writeU16(cells,0,10);writeU16(cells,2,1);writeU32(cells,4,24);writeU16(anim,0,10);writeU16(anim,2,8);writeU32(anim,4,24);writeU32(anim,8,184);writeU32(anim,12,264);
 const marker=nativeMarker(native),banks:Uint8Array[]=[];
 for(let i=0;i<10;i++){
  const b=i<8?doc.buttons[i]:undefined,a=b&&actionFor(b.action,"BW"),at=32+i*16,palette=Math.min(i,8);
  if(b&&a){writeU16(header,at,b.id);header[at+2]=a.code;header[at+3]=b.flag?(b.flag.when==="set"?1:2):0;writeU16(header,at+4,a.item);writeU16(header,at+6,a.alternate??0);writeU16(header,at+8,b.flag?.id??0);header[at+10]=b.x;header[at+11]=b.y;header[at+12]=a.check;}
  const colour=parseInt(b?.color.slice(1)??"00b578",16),rgb=[colour>>19,(colour>>11)&31,(colour>>3)&31],scale=(f:number)=>rgb.reduce((v,c,s)=>v|Math.floor(c*f)<<(s*5),0);
  const colours=[0,readU16(native.files[19],88),0x7fff,0x6318,0x3def,readU16(native.files[19],70),0,0,0,0,0,0,scale(.22),scale(.45),scale(1),scale(.28)];
  for(let j=0;j<16;j++)writeU16(pal,16+palette*32+j*2,colours[j]);
  const offset=i<8?i*36:288+(i-8)*8,c=24+i*16;writeU16(cells,c,i<8?6:1);writeU16(cells,c+2,0x0808);writeU32(cells,c+4,offset);
  for(const [off,v]of [[8,i<8?48:15],[10,15],[12,65520],[14,i<8?65516:65520]])writeU16(cells,c+off,v);
  const pieces=i<8?bw1Pieces:[[-16,-16,32,32,0]];
  pieces.forEach(([x,y,w,h,tile],piece)=>{const o=184+offset+piece*6,shape=w===h?0:w>h?1:2,size=w===h?(w===32?2:w===16?1:0):w===32?1:0;writeU16(cells,o,(y&255)|(shape<<14));writeU16(cells,o+2,(x&511)|(size<<14));writeU16(cells,o+4,tile|(palette<<12));});
  const s=24+i*16;writeU16(anim,s,1);writeU32(anim,s+4,0x10000);writeU32(anim,s+8,1);writeU32(anim,s+12,i*8);writeU32(anim,184+i*8,i*4);writeU16(anim,188+i*8,1);writeU16(anim,264+i*4,i);
  if(i<8){
   const image=b?marker.slice():new Uint8Array(4096);
   if(b){const text=caption(assets,b.label);for(const [radius,k]of [[1,1],[0,2]])for(let y=0;y<5;y++)for(let x=0;x<text.width;x++)if(text.pixels[y*text.width+x])for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)image[(13+y+dy)*64+34+x+dx]=radius?k:y<3?2:3;}
   banks.push(packButton(image));
  }
 }
 const arrow=new Uint8Array(1024);for(let y=-4;y<=4;y++)for(const x of [14-Math.abs(y),21-Math.abs(y)])arrow[(15+y)*32+x]=5;
 const fixed=indexedTiles(arrow,32),p=bw1Panels(native),graphics=[nitro("RLCN","TTLP",pal),nitro("RECN","KBEC",cells),nitro("RNAN","KNBA",anim),...banks],catalog=new Uint8Array(16);writeU32(catalog,0,0x534e4b53);writeU16(catalog,4,1);
 writeU32(header,16,fingerprint(p));writeU32(header,24,fingerprint(join([...graphics,fixed])));writeU32(header,28,fingerprint(join([header.subarray(0,28),header.subarray(32)])));
 const backup=native.save(),arc=new NARC();arc.files=[header,...graphics,p,new TextEncoder().encode(JSON.stringify({...source??{document:doc,applied:doc,enabled},skinCatalogFingerprint:fingerprint(catalog),nativeGraphics:{version:5,backupFingerprint:fingerprint(backup),packedFingerprint:fingerprint(backup),skinSelector:true,saveControl:false}})),backup,catalog,fixed];
 const sequences=parsePokemonAnimation(native.files[20]).sequences,cell=native.files[21],first=24+readU32(cell,28),oam=[[0],[1],[2],[3],[4],[5],[6,7],[17],[37],[14],[38]].reduce((n,g)=>n+Math.max(...g.flatMap(i=>sequences[i].frames.map(f=>readU16(cell,first+f.cellIndex*16)))),0)+doc.buttons.length*6+1;
 const budget={bytes:512+readU32(native.files[22],40)+doc.buttons.length*1024+512,capacity:16384,oam};
 if(budget.bytes>budget.capacity||oam>128)throw new Error("BW1 C-Gear sprites exceed native capacity.");return {archive:arc.save(),nativeGraphics:native,budget};
}
