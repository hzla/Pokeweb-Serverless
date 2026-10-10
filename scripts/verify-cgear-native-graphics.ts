import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { originalGraphics, packNativeGraphics, buttonGraphics, nativeButtonCircle, spriteBudget } from "../src/cgearButtons/nativeGraphics";
import { readU16, readU32, writeU16, writeU32 } from "../src/nds/binary";
import { parsePokemonAnimation } from "../src/pokeweb/pokemonSpriteModel";
import { parseNitroCellImage } from "../src/pokeweb/nitroCell";
const paths=process.argv.slice(2);
if(!paths.length)throw new Error("Pass one or more clean English B2/W2 ROM filenames.");
for(const path of paths) {
  const rom=new NintendoDSRom(new Uint8Array(readFileSync(path)),{fileData:"view"}),native=new NARC(rom.files[rom.filenames.idOf("a/2/8/7")!]);
  const source=originalGraphics(native),packed=packNativeGraphics(source),decorated=buttonGraphics(source,native,true,true),budget=spriteBudget(decorated,native,8),count=readU16(source.files[1],24);
  const selector=new Set([31,32,33,34,36,37]),save=new Set([22,25]);
  for(let gender=0;gender<2;gender++)for(let i=0;i<count;i++) {
    const a=source.files[1].slice(),b=packed.files[1].slice();writeU32(a,32,16);writeU32(b,32,16);
    const before=parseNitroCellImage("before",source.files[0],native.files[14+gender],a,i,256),after=parseNitroCellImage("after",packed.files[0],native.files[14+gender],b,i,256);
    assert.deepEqual(after.rgba,before.rgba,`Cell ${i}, gender ${gender}`);assert.deepEqual(after.warnings,before.warnings);
    const c=decorated.files[1].slice();writeU32(c,32,16);
    const controls=parseNitroCellImage("controls",decorated.files[0],native.files[14+gender],c,i,256);
    // The owned pressed selector uses the same native palette bank as other
    // pressed controls. Its circle artwork remains unchanged.
    if(i===37){const at=48+count*16+readU32(a,48+i*16+4);for(const off of [4,10])writeU16(a,at+off,(readU16(a,at+off)&0x0fff)|0x1000);}
    const controlReference=i===37?parseNitroCellImage("pressed",source.files[0],native.files[14+gender],a,i,256):before;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      if(x>=120&&x<136&&((selector.has(i)&&y>=124&&y<141)||(save.has(i)&&y>=120&&y<136)))continue;
      const p=(y*256+x)*4;
      assert.equal(controls.rgba[p],controlReference.rgba[p],`Control ${i}, ${x},${y}`);
      assert.equal(controls.rgba[p+1],controlReference.rgba[p+1]);assert.equal(controls.rgba[p+2],controlReference.rgba[p+2]);assert.equal(controls.rgba[p+3],controlReference.rgba[p+3]);
    }
  }
  const common=parsePokemonAnimation(native.files[18]).sequences,panel=parsePokemonAnimation(native.files[30]).sequences;
  const maxima=(groups:number[][],seq:typeof common,cells:Uint8Array)=>groups.reduce((n,g)=>n+Math.max(...g.flatMap(i=>seq[i].frames.map(f=>readU16(cells,48+f.cellIndex*16)))),0);
  const base=[[0],[0],[0],[0],[1,2],[4,5],[21],[6,7],[8,9],[10,11],[12,13,14,15],[3],[16,17,18,19,20],[22,25],[23,26],[24,27]];
  const oam=maxima(base,common,packed.files[1])+maxima([[0],[1],[2]],panel,native.files[29])+5*maxima([[28,29,30]],common,packed.files[1])+8+1;
  assert(oam<=128,`Native effects plus eight buttons exceed 128 OAM: ${oam}`);
  const circle=nativeButtonCircle(native,source);assert.equal(circle[16*32+1],1);assert.equal(circle[16*32+2],1);assert.equal(circle[16*32+3],1);
  for(const [x,y] of [[4,4],[27,4],[4,27],[27,27]])assert.equal(circle[y*32+x],0,"Diagonal ring protrusion");
  console.log(rom.idCode,`worst-case ${budget.oam}/128 OAM;`,`${count*2} lossless cell images identical; selector/save edits confined to glyphs and native pressed palette; native bright ring decoded; ${budget.bytes}/${budget.capacity} sprite bytes`);
}
