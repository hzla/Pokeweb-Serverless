import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { applyPaletteDelta, decodeNaturePalettes, encodeNaturePalettes, NATURE_PALETTE_PATH, naturePaletteKey, naturePaletteTarget, paletteDelta, rgb555, rgbFrom555, type NaturePaletteTarget } from "../pokeweb/naturePaletteData";
import { getNaturePalette, getNaturePaletteRecords, hydrateNaturePalettes, naturePaletteBase, NaturePaletteReplacementError, protectPwanNaturePalettes, resetNaturePalette, setNaturePalette } from "../pokeweb/naturePaletteModel";
import type { NintendoDSRom } from "../nds/rom";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { makeEditProject } from "./fixtures/editProject";
import { buildPwanOverrideSideFromPwanBytes } from "../pokeweb/pwanAnimationModel";

const base = Array.from({ length: 16 }, (_, i) => rgbFrom555(i * 37));
const target: NaturePaletteTarget = { spriteId: 607, source: "native", nature: 15, shiny: false };
function changed(index = 5, color = 0x3e0) { const out = base.map(c => ({ ...c })); out[index] = rgbFrom555(color); return out; }
function project() {
  const p = makeEditProject();
  p.session.baseRom = "BW2"; p.session.baseVersion = "W2"; p.romInfo.idCode = "IRDO";
  // A source identity buffer is enough here: all table writes are additions.
  // Use hydration's retained revision through a minimal header fixture instead
  // in ROM integration tests; this fixture supplies an already staged table.
  p.originalRomBytes = undefined;
  p.fileSystem = { replacements: {}, additions: { [NATURE_PALETTE_PATH]: encodeNaturePalettes([]) } };
  const files = Array.from({ length: 608 * 20 }, () => new Uint8Array(72));
  for (const kind of [18, 19]) for (let i = 0; i < 16; ++i) writeU16(files[607 * 20 + kind], 40 + i * 2, rgb555(base[i]));
  p.narcs.pokemon_sprites = { name: "pokemon_sprites", fileId: 90, sourcePath: "a/0/0/4", fileCount: files.length, rawFiles: files, dirty: new Set(), records: new Map() };
  return p;
}
function pwan(color: number) {
  const bytes = new Uint8Array(40 + 32 + 4 + 0x1200);
  bytes.set([80,87,65,78]); writeU16(bytes,4,1); writeU16(bytes,6,96); writeU16(bytes,8,96); writeU16(bytes,10,4); writeU16(bytes,12,1); writeU16(bytes,14,1);
  for (const [at,value] of [[16,1],[20,0x1200],[24,16],[28,40],[32,72],[36,76]]) writeU32(bytes,at,value);
  for (let i=0;i<16;++i) writeU16(bytes,40+i*2,i===5?color:rgb555(base[i]));
  writeU16(bytes,74,1);
  return buildPwanOverrideSideFromPwanBytes(bytes,"fixture.gif");
}
describe("nature palette data", () => {
  it("stores a one-color change in four payload bytes and preserves transparent index zero", () => {
    const edit = changed(); edit[0] = { r:255,g:255,b:255 };
    const delta = paletteDelta(target, base, edit)!;
    expect(delta).toMatchObject({ mask: 1 << 5, colors: [0x3e0] });
    const bytes = encodeNaturePalettes([delta]);
    expect(bytes.length).toBe(16 + 8 + 4);
    expect(applyPaletteDelta(base, decodeNaturePalettes(bytes)[0])).toEqual(changed());
    expect(paletteDelta(target,base,base)).toBeUndefined();
  });
  it("round-trips every nature, shiny choice, form, and renderer source without collisions", () => {
    const records=[];
    for (const spriteId of [607,685,65535]) for (const source of ["native","pwan-front","pwan-back"] as const) for (let nature=0;nature<25;++nature) for (const shiny of [false,true]) {
      const t={spriteId,source,nature,shiny};
      expect(naturePaletteTarget(naturePaletteKey(t))).toEqual(t);
      records.push(paletteDelta(t,base,changed(1,1+nature))!);
    }
    expect(decodeNaturePalettes(encodeNaturePalettes(records.reverse()))).toEqual(records.sort((a,b)=>a.key-b.key));
  });
  it("compares quantized colors and dynamically inherits base edits", () => {
    const unchanged=base.map(c=>({...c})); unchanged[1].r+=1;
    expect(paletteDelta(target,base,unchanged)).toBeUndefined();
    const delta=paletteDelta(target,base,changed())!;
    const newBase=base.map(c=>({...c})); newBase[1]=rgbFrom555(1234);newBase[5]=rgbFrom555(4321);
    const effective=applyPaletteDelta(newBase,delta);
    expect(effective[1]).toEqual(newBase[1]);expect(effective[5]).toEqual(rgbFrom555(0x3e0));
  });
  it("encodes all 15 visible replacements in at most 32 payload bytes", () => {
    const all=base.map((c,i)=>i?rgbFrom555(32767):c);
    expect(encodeNaturePalettes([paletteDelta(target,base,all)!]).length).toBe(16+8+32);
  });
  it("rejects malformed, overlapping, unsorted, duplicate and transparent records", () => {
    const delta=paletteDelta(target,base,changed())!;
    const valid=encodeNaturePalettes([delta]);
    for (const at of [0,4,6,8,12,20,24,27]) { const b=valid.slice(); b[at]^=0x80;expect(()=>decodeNaturePalettes(b)).toThrow(); }
    expect(()=>decodeNaturePalettes(valid.subarray(0,valid.length-1))).toThrow();
    expect(()=>encodeNaturePalettes([delta,delta])).toThrow();
    expect(()=>encodeNaturePalettes([{...delta,mask:1}])).toThrow();
    expect(()=>encodeNaturePalettes([{...delta,colors:[32768]}])).toThrow();
    for (const t of [{...target,nature:25},{...target,spriteId:-1},{...target,nature:NaN}]) expect(()=>naturePaletteKey(t)).toThrow();
  });
});
describe("nature palette project data", () => {
  it("authors independently quantized normal/shiny pairs and resets only selected indexes",()=>{
    const p=project();
    hydrateNaturePalettes(p,{data:new Uint8Array(32),filenames:{idOf:()=>undefined},files:[]} as unknown as NintendoDSRom);
    setNaturePalette(p,target,changed());
    setNaturePalette(p,{...target,shiny:true},changed(7,0x7fe0));
    expect(getNaturePaletteRecords(p)).toHaveLength(2);
    expect(getNaturePalette(p,target).palette[5]).toEqual(rgbFrom555(0x3e0));
    expect(getNaturePalette(p,{...target,shiny:true}).palette[7]).toEqual(rgbFrom555(0x7fe0));
    resetNaturePalette(p,target,5);
    expect(getNaturePaletteRecords(p)).toHaveLength(1);
    expect(getNaturePalette(p,target).palette).toEqual(base);
  });
  it("persists ROM-file data through project serialization without another project schema", () => {
    const p=project(), record=paletteDelta(target,base,changed())!;
    p.fileSystem!.additions![NATURE_PALETTE_PATH]=encodeNaturePalettes([record]);
    const reopened=openProjectSession(structuredClone(createProjectDocument(p,false)));
    expect(getNaturePalette(reopened,target).palette).toEqual(changed());
    resetNaturePalette(reopened,target,5);
    expect(getNaturePaletteRecords(reopened)).toEqual([]);
    expect(getNaturePalette(reopened,target).palette).toEqual(base);
  });
  it("keeps normal, shiny, native and the two PWAN sources independent", () => {
    const p=project();
    p.pwanAnimations={overrides:[{speciesId:607,front:pwan(1234),back:pwan(4321),nativePaletteSource:"front" as const,carrierTemplate:"w2u-gen6-placeholder"}],dirty:false};
    p.fileSystem!.additions![NATURE_PALETTE_PATH]=encodeNaturePalettes([paletteDelta({...target,source:"pwan-front"},naturePaletteBase(p,607,"pwan-front",false),changed())!]);
    expect(getNaturePalette(p,{...target,source:"pwan-front"}).palette[5]).toEqual(rgbFrom555(0x3e0));
    expect(getNaturePalette(p,{...target,source:"pwan-front",shiny:true}).palette[5]).toEqual(rgbFrom555(1234));
    expect(getNaturePalette(p,{...target,source:"pwan-back"}).palette[5]).toEqual(rgbFrom555(4321));
    expect(getNaturePalette(p,target).palette).toEqual(base);
  });
  it("requires an explicit reset for changed PWAN indexes, preserving unaffected variants", () => {
    const p=project(), previous={speciesId:607,front:pwan(1234),back:pwan(4321),nativePaletteSource:"front" as const,carrierTemplate:"w2u-gen6-placeholder" as const};
    p.pwanAnimations={overrides:[previous],dirty:false};
    const records=[target,{...target,source:"pwan-front" as const},{...target,source:"pwan-back" as const}].map(t=>paletteDelta(t,naturePaletteBase(p,607,t.source,false),changed())!);
    p.fileSystem!.additions![NATURE_PALETTE_PATH]=encodeNaturePalettes(records);
    protectPwanNaturePalettes(p,previous,{...previous,front:pwan(1234)});
    expect(()=>protectPwanNaturePalettes(p,previous,{...previous,front:pwan(1235)})).toThrow(NaturePaletteReplacementError);
    expect(getNaturePaletteRecords(p)).toHaveLength(3);
    protectPwanNaturePalettes(p,previous,{...previous,front:pwan(1235)},true);
    expect(getNaturePaletteRecords(p).map(r=>naturePaletteTarget(r.key).source)).toEqual(["native","pwan-back"]);
  });
  it("rejects authoring on unsupported profiles",()=>{
    expect(()=>setNaturePalette(project(),target,changed())).toThrow(/US revision-0/);
  });
});
