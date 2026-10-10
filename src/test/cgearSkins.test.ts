import { describe, expect, it } from "vitest";
import { defaultSkins, encodeSkin, skinBytes, skinPreview, validateSkin } from "../cgearButtons/skins";
import { defaults } from "../cgearButtons/document";
import { compile } from "../cgearButtons/compiler";
import { NARC } from "../nds/narc";
import { writeU16 } from "../nds/binary";
import { recoverCGearButtons, validateButtonArchive } from "../pokeweb/cgearButtonsModel";
import { buttonTestAssets } from "./cgearButtonsFixture";
import { EditorHistory } from "../cgearButtons/editorState";

describe("C-Gear bundled and imported skins", () => {
  it("bundles all 15 distinct BW2 skins with their original palettes", () => {
    const skins=defaultSkins();expect(skins.entries).toHaveLength(15);
    expect(new Set(skins.entries.map(s=>s.data)).size).toBe(15);
    for(const skin of skins.entries){const bytes=skinBytes(skin.data);expect(bytes.length).toBe(9728);expect(encodeSkin(bytes)).toBe(skin.data);expect(skinPreview(bytes).pixels.length).toBe(256*192*4);}
  });
  it("rejects malformed files and BW1 tile arrangements", () => {
    expect(()=>validateSkin(new Uint8Array(9727))).toThrow(/9,728/);
    const bytes=skinBytes(defaultSkins().entries[0].data);
    writeU16(bytes,0x2000,256);expect(()=>validateSkin(bytes)).toThrow(/BW1/);
    writeU16(bytes,0x2000,0);writeU16(bytes,0x1fe0,0x8000);expect(()=>validateSkin(bytes)).toThrow(/palette/);
    expect(()=>skinBytes("malformed")).toThrow(/Invalid/);
  });
  it("decodes transparency and both tile flips at DS resolution", () => {
    const bytes=new Uint8Array(9728);bytes[0]=1;writeU16(bytes,0x1fe2,31);
    let image=skinPreview(bytes);expect(Array.from(image.pixels.slice(0,4))).toEqual([255,0,0,255]);expect(image.pixels[7]).toBe(0);
    writeU16(bytes,0x2000,0xc00);image=skinPreview(bytes);expect(Array.from(image.pixels.slice((7*256+7)*4,(7*256+7)*4+4))).toEqual([255,0,0,255]);expect(image.pixels[3]).toBe(0);
  });
  it("preserves imports, order, names and defaults across archive reopening and undo", () => {
    const doc=defaults(),bytes=skinBytes(doc.skins!.entries[0].data);writeU16(bytes,0x1fe2,0x03e0);
    doc.skins!.entries.push({id:doc.skins!.nextId++,name:"Imported green",data:encodeSkin(bytes)});doc.skins!.defaultId=16;
    doc.skins!.entries.reverse();const history=new EditorHistory(doc),next=structuredClone(doc);next.skins!.entries[0].name="Renamed";history.commit(next);history.undo();expect(history.document).toEqual(doc);history.redo();expect(history.document.skins!.entries[0].name).toBe("Renamed");
    const archive=compile(history.document,buttonTestAssets()).archive!;expect(validateButtonArchive(archive)).toBe(true);expect(recoverCGearButtons(archive).document).toEqual(history.document);
    const arc=new NARC(archive);expect(arc.files).toHaveLength(32);expect(arc.files[16]).toEqual(bytes);
    arc.files[16][0]^=1;expect(()=>validateButtonArchive(arc.save())).toThrow(/skin.*integrity/i);
  });
  it("rejects invalid defaults and duplicate stable IDs before packaging", () => {
    const doc=defaults();doc.skins!.defaultId=100;expect(compile(doc,buttonTestAssets()).archive).toBeUndefined();doc.skins!.defaultId=0;doc.skins!.entries[1].id=doc.skins!.entries[0].id;expect(compile(doc,buttonTestAssets()).archive).toBeUndefined();
  });
  it("supports an empty carousel and the full 64-skin catalog without reusing IDs", () => {
    const doc=defaults(),data=doc.skins!.entries[0].data;
    doc.skins={nextId:4096,defaultId:4095,entries:Array.from({length:64},(_,i)=>({id:4032+i,name:`Skin ${i+1}`,data}))};
    const full=compile(doc,buttonTestAssets()).archive!;expect(validateButtonArchive(full)).toBe(true);
    expect(new NARC(full).files).toHaveLength(80);expect(recoverCGearButtons(full).document.skins!.defaultId).toBe(4095);
    doc.skins.entries.push({id:1,name:"Overflow",data});expect(compile(doc,buttonTestAssets()).archive).toBeUndefined();
    doc.skins.entries=[];doc.skins.defaultId=0;const empty=compile(doc,buttonTestAssets()).archive!;
    expect(validateButtonArchive(empty)).toBe(true);expect(new NARC(empty).files).toHaveLength(16);
  });
});
