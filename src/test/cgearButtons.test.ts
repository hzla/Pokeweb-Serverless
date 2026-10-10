import { describe, expect, it } from "vitest";
import { compile, preview, tile, untile, validate } from "../cgearButtons/compiler";
import { actions, defaults, legacyDefaults, newButton } from "../cgearButtons/document";
import { EditorHistory } from "../cgearButtons/editorState";
import { NARC } from "../nds/narc";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { disableButtonArchive, recoverCGearButtons, validateButtonArchive } from "../pokeweb/cgearButtonsModel";
import { originalGraphics, buttonGraphics, packNativeGraphics, spriteBudget, sameGraphics } from "../cgearButtons/nativeGraphics";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { buttonTestAssets } from "./cgearButtonsFixture";

describe("C-Gear button compiler and editor state", () => {
  it("starts with hidden communication controls and native-colored PC/Party replacements",()=>{
    const d=defaults(),a=buttonTestAssets();expect(d.hideCommunicationButtons).toBe(true);expect(d.buttons).toHaveLength(6);
    expect(d.buttons[1]).toMatchObject({action:"pc",x:68,y:60,color:"#ff637b"});expect(d.buttons[4]).toMatchObject({action:"party",x:188,y:60,color:"#29c5f7"});
    expect(d.buttons[5]).toMatchObject({id:6,label:"BAG",action:"bag",x:196,y:116,color:"#f87800"});
    expect(legacyDefaults().buttons.map(b=>b.action)).toEqual(["repel","pc","bike","mapFly"]);
    let r=compile(d,a),arc=new NARC(r.archive!);expect(arc.files[0][45]).toBe(1);expect(validateButtonArchive(r.archive!)).toBe(true);
    d.hideCommunicationButtons=false;r=compile(d,a);expect(new NARC(r.archive!).files[0][45]).toBe(0);expect(recoverCGearButtons(r.archive!).applied!.hideCommunicationButtons).toBe(false);
    const metadata=JSON.parse(new TextDecoder().decode(arc.files[13]));metadata.applied.hideCommunicationButtons=false;arc.files[13]=new TextEncoder().encode(JSON.stringify(metadata));expect(()=>validateButtonArchive(arc.save())).toThrow(/Communication/);
  });
  it("replaces only selector and power glyphs while preserving native circles",()=>{
    const a=buttonTestAssets(),original=originalGraphics(a.native),packed=buttonGraphics(original,a.native,true,true),cells=packed.files[1],start=48,oam=start+39*16;
    const decorated=new Set([22,25,31,32,33,34,36,37]);
    for(let i=0;i<38;i++){const at=oam+new DataView(cells.buffer).getUint32(start+i*16+4,true);expect(readU16(cells,start+i*16)).toBe(2);expect(readU16(cells,at+6)).toBe(0x4f0);expect(readU16(cells,at+8)).toBe(0x81f0);if(decorated.has(i))expect(readU16(cells,at+4)&1023).not.toBe(readU16(cells,at+10)&1023);}
    const tileAt=readU16(cells,oam+new DataView(cells.buffer).getUint32(start+31*16+4,true)+4)&1023,data=packed.files[0].subarray(48+tileAt*32,48+tileAt*32+64);
    const pixel=(x:number,y:number)=>(data[Math.floor(x/8)*32+y*4+Math.floor(x%8/2)]>>(x%2*4))&15;
    expect(pixel(5,3)).toBe(7);expect(pixel(11,3)).toBe(7);expect(pixel(2,0)).toBe(7);expect(pixel(8,0)).toBe(7);expect(pixel(2,6)).toBe(7);expect(pixel(5,0)).toBe(0);
    const pressedAt=oam+new DataView(cells.buffer).getUint32(start+37*16+4,true),pressedTile=readU16(cells,pressedAt+4)&1023;
    const pressed=packed.files[0].subarray(48+pressedTile*32,48+pressedTile*32+64);
    expect(readU16(cells,pressedAt)).toBe(0x40fd);
    expect(Array.from(pressed)).toEqual(Array.from(data,v=>(v&15?3:0)|(v>>4?48:0)));
    expect(readU16(cells,pressedAt+4)>>>12).toBe(1);expect(readU16(cells,pressedAt+10)>>>12).toBe(1);
    for(const i of [22,25]){
      const at=oam+new DataView(cells.buffer).getUint32(start+i*16+4,true),tile=readU16(cells,at+4)&1023;
      const disk=packed.files[0].subarray(48+tile*32,48+tile*32+128),values=Array.from(disk).flatMap(v=>[v&15,v>>4]);
      expect(new Set(values)).toEqual(new Set([0,3]));
      expect(values.filter(v=>v===3).length).toBeGreaterThan(50);
    }
  });
  it("uses the native bright ring for PC and Party without changing captions or exceeding a 32px sprite",()=>{
    const a=buttonTestAssets(),d=defaults();
    const r=compile(d,a),arc=new NARC(r.archive!);
    for(const i of [1,4]){
      const p=untile(arc.files[4+i].subarray(0,512));
      expect(Array.from(p.subarray(16*32,16*32+2))).toEqual([1,1]);
      expect(p[8*32+16]).toBe(9);expect(p[16*32+31]).toBe(1);
      expect(Array.from(p.subarray(13*32+8,18*32+24))).toContain(7); // Native black caption foreground.
      const disabled=untile(arc.files[4+i].subarray(1536,2048));expect(disabled[16*32]).toBe(3);
      expect(preview(r.archive!,i).width).toBe(32);
    }
    for(const i of [0,5]){const thin=untile(arc.files[4+i].subarray(0,512));expect(thin[16*32+1]).toBe(2);}
    const packed=r.nativeGraphics!,reopened={...a,originalGraphics:originalGraphics(a.native),native:new NARC(a.native.save())};
    reopened.native.files[16]=packed.files[0];reopened.native.files[17]=packed.files[1];
    expect(compile(d,reopened).archive).toEqual(r.archive);
  });
  it("keeps all four bright-ring corner protrusions transparent in every appearance",()=>{
    const r=compile(defaults(),buttonTestAssets()),arc=new NARC(r.archive!);
    for(const i of [1,4])for(let pose=0;pose<4;pose++){
      const pixels=untile(arc.files[4+i].subarray(pose*512,(pose+1)*512));
      for(const [x,y] of [[4,4],[27,4],[4,27],[27,27]])expect(pixels[y*32+x]).toBe(0);
      for(let n=0;n<pixels.length;n++)if(pixels[n]>=1&&pixels[n]<=3)
        expect((n%32-15.5)**2+(Math.floor(n/32)-15.5)**2).toBeLessThanOrEqual(256);
    }
  });
  it("uses one bright outer ring without the extra inner border for active Repel/Bike",()=>{
    const r=compile(defaults(),buttonTestAssets()),arc=new NARC(r.archive!);
    for(const i of [0,2]){
      const normal=untile(arc.files[4+i].subarray(0,512)),active=untile(arc.files[4+i].subarray(512,1024));
      expect(Array.from(normal)).toContain(2);expect(Array.from(active)).not.toContain(2);
      expect(active[2*32+16]).toBe(1);expect(active[5*32+10]).toBe(9);
      expect(Array.from(active)).toContain(7);expect(Array.from(active)).toContain(8);
    }
  });
  it("compiles eight ordered buttons and retains the default preset", () => {
    const d=defaults(),a=buttonTestAssets();
    for(const action of ["dowsing","rod"] as const)d.buttons.push(newButton(d,action));
    const r=compile(d,a);expect(r.archive).toBeDefined();expect(validateButtonArchive(r.archive!)).toBe(true);
    const arc=new NARC(r.archive!);expect(arc.files[0][20]).toBe(8);expect(arc.files.slice(4,12)).toHaveLength(8);
    expect(arc.files[1].length-40).toBe(256);
    expect(recoverCGearButtons(r.archive!).document).toEqual(d);
    d.buttons.push(newButton(d));expect(compile(d,a).archive).toBeUndefined();
  });
  it.each(actions)("has a verified data route for $name",action=>{
    const d=defaults();d.buttons=[newButton(d,action.id)];
    const r=compile(d,buttonTestAssets());expect(r.archive).toBeDefined();
    const h=new NARC(r.archive!).files[0];expect(h[34]).toBe(action.code);expect(readU16(h,36)).toBe(action.item);
  });
  it("reports illegal coordinates, duplicate IDs, long labels, missing glyphs, and unsupported handlers",()=>{
    const d=defaults(),a=buttonTestAssets();d.buttons[0].x=15;d.buttons[1].id=1;
    d.buttons[2].label="LONGNAME";d.buttons[3].label="?";a.itemGroups.set(450,2);
    const errors=validate(d,a).filter(d=>d.severity==="error").map(d=>d.message).join(" ");
    expect(errors).toMatch(/Center/);expect(errors).toMatch(/unique/);expect(errors).toMatch(/28 foreground/);
    expect(errors).toMatch(/missing game glyph/);expect(errors).toMatch(/field handler/);
    expect(compile(d,a).archive).toBeUndefined();
  });
  it("allows overlaps as warnings and preserves user order",()=>{
    const d=defaults();d.buttons[0].x=228;d.buttons[0].y=144;d.buttons[1].x=228;d.buttons[1].y=144;
    const r=compile(d,buttonTestAssets());expect(r.archive).toBeDefined();expect(r.diagnostics.some(d=>d.severity==="warning")).toBe(true);
    expect(recoverCGearButtons(r.archive!).applied!.buttons.map(b=>b.id)).toEqual([1,2,3,4,5,6]);
  });
  it("decodes all appearance and pattern combinations from compiled resources",()=>{
    const a=buttonTestAssets(),d=defaults(),mask=new Uint8Array(1024).fill(13);
    a.native.files[20].set(tile(mask),176);for(let j=0;j<3;j++)writeU16(a.native.files[6],46+j*2,31);
    const archive=compile(d,a).archive!,arc=new NARC(archive);
    expect(untile(tile(mask))).toEqual(mask);
    for(let pose=0;pose<4;pose++)for(let gender=0;gender<2;gender++)for(let pattern=0;pattern<5;pattern++) {
      const image=preview(archive,0,pose,pattern,0,gender,a.native);expect(image.pixels).toHaveLength(4096);
      const art=untile(arc.files[4].subarray(pose*512,pose*512+512));
      for(let n=0;n<1024;n++)expect(image.pixels[n*4+3]).toBe(art[n]?255:0);
    }
    const first=preview(archive,0,0,0,0,0,a.native),second=preview(archive,0,0,1,0,0,a.native);
    // Make the loaded ROM's inner-pattern color visibly different.
    writeU16(a.native.files[14],104+13*2,0x03e0);
    const recolored=compile(d,a).archive!;
    expect(preview(recolored,0,0,0,0,0,a.native).pixels).not.toEqual(preview(recolored,0,0,1,0,0,a.native).pixels);
    expect(first.width).toBe(second.width);
    expect(Array.from(first.pixels).filter((_,i)=>i%4===0)).toContain(255);
  });
  it("keeps a drag as one undoable operation and restores redo",()=>{
    const h=new EditorHistory(defaults()),before=structuredClone(h.document);
    for(let x=61;x<=90;x++)h.document.buttons[0].x=x;
    h.commit(structuredClone(h.document),before);expect(h.document.buttons[0].x).toBe(90);
    h.undo();expect(h.document).toEqual(before);expect(h.canUndo).toBe(false);
    h.redo();expect(h.document.buttons[0].x).toBe(90);
    const next=structuredClone(h.document);next.buttons.pop();h.commit(next);expect(h.canRedo).toBe(false);
  });
  it("preserves unapplied invalid drafts while decoding the working configuration",()=>{
    const applied=defaults(),draft=structuredClone(applied);draft.buttons[0].label="INVALIDLYLONG";
    const archive=compile(applied,buttonTestAssets(),true,{document:draft,applied,enabled:true}).archive!;
    expect(validateButtonArchive(archive)).toBe(true);expect(recoverCGearButtons(archive)).toEqual({document:draft,applied,enabled:true});
    const disabled=disableButtonArchive(archive);expect(validateButtonArchive(disabled)).toBe(false);
    expect(recoverCGearButtons(disabled).document).toEqual(draft);
  });
  it("rejects tampered runtime graphics without accepting corrupt metadata",()=>{
    const archive=compile(defaults(),buttonTestAssets()).archive!,arc=new NARC(archive);
    arc.files[4][50]^=1;expect(()=>validateButtonArchive(arc.save())).toThrow(/integrity/);
  });
  it("reclaims transparent tile padding without changing native flipped cells",()=>{
    const a=buttonTestAssets(),char=new Uint8Array(48+2048),cells=new Uint8Array(48+4*16+4*6);
    char.set(new TextEncoder().encode("RGCN"));char.set(new TextEncoder().encode("RAHC"),16);writeU16(char,12,16);writeU16(char,14,1);writeU32(char,20,char.length-16);writeU32(char,28,3);writeU32(char,32,16);writeU32(char,40,2048);writeU32(char,44,24);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(x===3||y===3)char.fill(0x11,48+(y*8+x)*32,48+(y*8+x+1)*32);
    cells.set(new TextEncoder().encode("RECN"));cells.set(new TextEncoder().encode("KBEC"),16);writeU16(cells,12,16);writeU16(cells,14,1);writeU32(cells,20,cells.length-16);a.native.files[14].set(new TextEncoder().encode("RLCN"));a.native.files[14].set(new TextEncoder().encode("TTLP"),16);writeU16(a.native.files[14],12,16);writeU16(a.native.files[14],14,1);writeU32(a.native.files[14],20,a.native.files[14].length-16);writeU32(a.native.files[14],32,512);writeU32(a.native.files[14],36,16);writeU16(cells,24,4);writeU16(cells,26,1);writeU32(cells,28,24);writeU32(cells,32,16);
    for(let i=0;i<4;i++){writeU16(cells,48+i*16,1);writeU32(cells,52+i*16,i*6);writeU16(cells,112+i*6,240);writeU16(cells,114+i*6,0xc1f0|(i&1?0x1000:0)|(i&2?0x2000:0));}
    a.native.files[16]=char;a.native.files[17]=cells;for(const seq of parsePokemonAnimation(a.native.files[18]).sequences)for(const frame of seq.frames)writeU16(a.native.files[18],frame.valueOffset,0);const original=originalGraphics(a.native),packed=packNativeGraphics(original);
    expect(packed.files[0].length).toBeLessThan(char.length);
    for(let i=0;i<4;i++)expect(parseNitroCellImage("packed",packed.files[0],a.native.files[14],packed.files[1],i,256).rgba).toEqual(parseNitroCellImage("original",char,a.native.files[14],cells,i,256).rgba);
    expect(sameGraphics(original,packed)).toBe(false);expect(()=>spriteBudget(packed,a.native,8)).toThrow(/OAM entries/);
    a.native.files[19]=a.native.files[19].slice();writeU32(a.native.files[19],40,16000);expect(()=>spriteBudget(packed,a.native,8)).toThrow(/16384/);
  });
  it("rejects a damaged original graphics backup",()=>{
    const arc=new NARC(compile(defaults(),buttonTestAssets()).archive!);arc.files[14][arc.files[14].length-1]^=1;
    expect(()=>validateButtonArchive(arc.save())).toThrow();
  });
  it("does not reuse removed stable IDs",()=>{
    const d=defaults();d.buttons.pop();const b=newButton(d);expect(b.id).toBe(7);
    d.buttons.unshift(b);const r=compile(d,buttonTestAssets());expect(recoverCGearButtons(r.archive!).document.nextId).toBe(8);
  });
});
