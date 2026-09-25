import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readU32, writeU32 } from "../nds/binary";
import { decodeBtxImage } from "../pokeweb/btxModel";
import {
  buildFollowerCatalog, compactFollowerRegistry, decodeFollowerRegistry, encodeFollowerFrames, encodeFollowerRegistry,
  enumerateFollowerAppearances, followerAnimationFrame, followerCrc32, followerDescriptorOffset,
  followerFramesFromSheet, followerKey, followerPreview, followerSideGap, deriveFollowerSpacing, encodeFollowerLandAnchors, validateFollowerLandAnchors, followerSheetFromFrames, stockFollowerRow,
  validateFollowerRegistry, validateFollowerResource, type FollowerFrame, type FollowerRegistry,
} from "../pokeweb/followingPokemonModel";
function registry(): FollowerRegistry { return {
  runtimeAbi: 1, descriptorCount: 1009, resourceCount: 975, zones: [{zone:3,suppressed:true,reason:"Script owns actors."}],
  entries: [{ key:{species:25,form:0,gender:0,shiny:false},descriptorRow:1008,resourceId:100,size:32,
    animationProfile:"pokemon-mirrored",offsets:[0,-4,2],placeholder:false,source:"stock" }],
}; }
function template(size=32, frames=8): Uint8Array { return new Uint8Array(readFileSync(new URL(`../assets/following/template-${size}-${frames}.btx`, import.meta.url))); }
function frame(size=32): FollowerFrame {
  const rgba=new Uint8Array(size*size*4);rgba.set([248,0,0,255],0);rgba.set([0,248,0,255],4);return {width:size,height:size,rgba};
}
describe("follower appearance registry",()=>{
  it("serializes deterministically with strict version, references, length and checksum",()=>{
    const r=registry(),bytes=encodeFollowerRegistry(r),parsed=decodeFollowerRegistry(bytes);
    expect(parsed.entries[0]).toEqual({...r.entries[0],placeholderReason:undefined,sideGap:0});
    expect(parsed.zones[0].suppressed).toBe(true);
    const corrupt=bytes.slice();corrupt[33]^=1;expect(()=>decodeFollowerRegistry(corrupt)).toThrow(/checksum/);
    expect(()=>decodeFollowerRegistry(bytes.subarray(0,bytes.length-1))).toThrow(/length/);
    const badCount=bytes.slice();badCount[12]=2;expect(()=>decodeFollowerRegistry(badCount)).toThrow(/length/);
    const badHeader=bytes.slice();badHeader[16]^=1;expect(()=>decodeFollowerRegistry(badHeader)).toThrow(/checksum/);
    expect(readU32(bytes,24)).not.toBe(0);
    r.runtimeAbi=2;expect(()=>encodeFollowerRegistry(r)).toThrow(/ABI/);
  });
  it("packs expansion records losslessly, retaining offsets, flags, references and zone rules",()=>{
    const r=registry();r.entries[0]={...r.entries[0],key:{species:1023,form:255,gender:2,shiny:true},size:64,animationProfile:"pokemon-asymmetric",offsets:[-128,127,-3],placeholder:true,placeholderReason:"Missing form"};
    const compact=encodeFollowerRegistry(r,true),full=encodeFollowerRegistry(r);
    expect(compact.length).toBe(full.length-12);
    expect(decodeFollowerRegistry(compact)).toEqual(decodeFollowerRegistry(full));
    expect(compactFollowerRegistry(full)).toEqual(compact);
    expect(compactFollowerRegistry(compact)).toEqual(compact);
    for(const [offset,value] of [[32+8,128],[32+5,0],[32+7,255]]) {
      const bad=compact.slice();bad[offset]=value;writeU32(bad,24,0);writeU32(bad,24,followerCrc32(bad));
      expect(()=>decodeFollowerRegistry(bad)).toThrow();
    }
  });
  it("round-trips spacing without record growth and accepts legacy zero-spacing data",()=>{
    for (const compact of [false,true]) for (let gap=0;gap<=6;gap++) {
      const r=registry();r.entries[0].sideGap=gap;
      const bytes=encodeFollowerRegistry(r,compact);
      expect(bytes.length).toBe(32+(compact?12:24)+8);
      expect(decodeFollowerRegistry(bytes).entries[0].sideGap).toBe(gap);
      const bad=bytes.slice();bad[32+(compact?8:15)]=compact?(bad[40]&7)|56:7;
      writeU32(bad,24,0);writeU32(bad,24,followerCrc32(bad));
      expect(()=>decodeFollowerRegistry(bad)).toThrow();
      if (!gap) {
        bytes[4]=compact?2:1;writeU32(bytes,24,0);writeU32(bytes,24,followerCrc32(bytes));
        expect(decodeFollowerRegistry(bytes).entries[0].sideGap).toBe(0);
      }
    }
  });
  it("rejects duplicate keys, stock-owned descriptors, missing placeholder reasons and invalid sizes",()=>{
    const r=registry();r.entries.push({...r.entries[0]});expect(()=>validateFollowerRegistry(r)).toThrow(/Duplicate/);
    r.entries.pop();r.entries[0].descriptorRow=5;expect(()=>validateFollowerRegistry(r)).toThrow(/owned/);
    r.entries[0].descriptorRow=1008;r.entries[0].placeholder=true;expect(()=>validateFollowerRegistry(r)).toThrow(/reason/);
    r.entries[0].placeholderReason="Missing shiny";r.resourceCount=100;expect(()=>validateFollowerRegistry(r)).toThrow(/resource reference/);
    expect(()=>followerKey({species:1024,form:0,gender:0,shiny:false})).toThrow(/species/);
  });
  it("supports the expansion roster while keeping stock enumeration bounded",()=>{
    const personal=Array.from({length:1024},()=>new Uint8Array(76));personal.forEach(p=>p[18]=127);
    personal[666][32]=20;
    const expanded=enumerateFollowerAppearances(personal,1023);
    expect(expanded.length).toBeGreaterThan(4096);
    expect(expanded.some(k=>k.species===1023)).toBe(true);
    expect(enumerateFollowerAppearances(personal).every(k=>k.species<=649)).toBe(true);
    expect(followerKey({species:1023,form:0,gender:0,shiny:false})).toBe("1023:0:0:0");
    expect(()=>enumerateFollowerAppearances(personal,1024)).toThrow(/species limit/);
  });
  it("enumerates all 649 species using legal gender ratios and form counts",()=>{
    const personal=Array.from({length:650},()=>new Uint8Array(76));personal.forEach(p=>p[18]=255);
    personal[25][18]=127;personal[201][32]=28;personal[29][18]=254;
    const keys=enumerateFollowerAppearances(personal);
    expect(new Set(keys.map(k=>k.species)).size).toBe(649);
    expect(keys.filter(k=>k.species===201)).toHaveLength(56);
    expect(keys.filter(k=>k.species===25)).toHaveLength(4);
    expect(keys.filter(k=>k.species===29).every(k=>k.gender===1)).toBe(true);
    expect(new Set(keys.map(followerKey)).size).toBe(keys.length);
    expect(()=>buildFollowerCatalog(personal,[],new Uint8Array(),[])).toThrow(/registry/);
  });
  it("rejects reserved flags even with a recalculated checksum",()=>{
    const bytes=encodeFollowerRegistry(registry());bytes[32+16]=1;writeU32(bytes,24,0);writeU32(bytes,24,followerCrc32(bytes));
    expect(()=>decodeFollowerRegistry(bytes)).toThrow(/reserved/);
  });
  it("keeps original code ranges and uses descriptor offsets beyond 64 KiB",()=>{
    for(let c=0;c<65536;c++) {
      const expected=c<377?c:c>=4096&&c<4716?c-3719:c>=8192&&c<8203?c-7195:10;
      expect(stockFollowerRow(c)).toBe(expected);
    }
    expect(followerDescriptorOffset(2341)).toBe(65552);
  });
});
describe("follower billboard conversion",()=>{
  it.each([32,64])("stores two-pose land rider anchors for %i-pixel art by appearance row",size=>{
    const frames=Array.from({length:8},()=>({width:size,height:size,rgba:new Uint8Array(size*size*4)}));
    for(let direction=0;direction<4;direction++){
      frames[direction*2].rgba.set([255,0,0,255],((size/2-6)*size+size/2-6)*4);
      frames[direction*2+1].rgba.set([255,0,0,255],((size/2+5)*size+size/2+5)*4);
    }
    const art=encodeFollowerFrames(frames,template(size));
    const r=registry();r.entries[0].resourceId=0;r.entries[0].size=size as 32|64;r.entries[0].animationProfile="pokemon-asymmetric";r.resourceCount=1;
    const registryBytes=encodeFollowerRegistry(r),anchors=encodeFollowerLandAnchors(r,[art],registryBytes);
    expect(Array.from(anchors.subarray(16))).toEqual([0,-12,0,-11,0,-11,0,-11].map(value=>value&255));
    expect(()=>validateFollowerLandAnchors(anchors,registryBytes,r.descriptorCount)).not.toThrow();
    const corrupt=anchors.slice();corrupt[16]^=1;
    expect(()=>validateFollowerLandAnchors(corrupt,registryBytes,r.descriptorCount)).toThrow(/does not match/);
  });
  it("adjusts only Arceus side-riding anchors above its long legs",()=>{
    const size=64,frames=Array.from({length:8},()=>({width:size,height:size,rgba:new Uint8Array(size*size*4)}));
    for(const frame of frames)frame.rgba.set([255,255,255,255],(32*size+32)*4);
    const art=encodeFollowerFrames(frames,template(size));
    const r=registry();r.entries[0].resourceId=0;r.entries[0].size=64;r.entries[0].animationProfile="pokemon-asymmetric";r.resourceCount=1;
    const ordinary=encodeFollowerLandAnchors(r,[art],encodeFollowerRegistry(r));
    r.entries[0].key.species=493;
    const arceus=encodeFollowerLandAnchors(r,[art],encodeFollowerRegistry(r));
    for(let i=0;i<8;i++)expect(new DataView(arceus.buffer).getInt8(16+i)).toBe(new DataView(ordinary.buffer).getInt8(16+i)-(i===5||i===7?10:0));
  });
  it.each([32,64])("round-trips %i pixel sheets, independent sides, I4 palettes and transparency",size=>{
    const frames=Array.from({length:8},()=>frame(size));frames[6].rgba.set([0,0,248,255],0);
    const sheet=followerSheetFromFrames(frames);expect(followerFramesFromSheet(sheet)).toEqual(frames);
    const bytes=encodeFollowerFrames(frames,template(size));
    expect(validateFollowerResource(bytes,"pokemon-asymmetric")).toEqual({size,frames:8});
    const decoded=decodeBtxImage(bytes,6,0,"linear");
    expect([...decoded.rgba.subarray(0,4)]).toEqual([0,0,255,255]);
    expect([...decoded.rgba.subarray(8,12)]).toEqual([0,0,0,0]);
    expect(encodeFollowerFrames(frames,template(size))).toEqual(bytes);
    expect(followerPreview(bytes,"pokemon-asymmetric","right",0).rgba).toEqual(decoded.rgba);
  });
  it("derives stable spacing from visible side width, ignoring canvas padding and front/back art",()=>{
    for (const profile of ["pokemon-mirrored","pokemon-asymmetric"] as const) {
      const count=profile==="pokemon-mirrored"?6:8;
      for (const [width,expected] of [[1,0],[16,0],[17,1],[18,1],[20,2],[22,3],[24,4],[26,5],[28,6],[32,6],[64,6]]) {
        const frames=Array.from({length:count},()=>frame(64));
        const paint=(index:number,w:number)=>{for(let x=0;x<w;x++) frames[index].rgba.set([248,0,0,255],(64*20+x+Math.floor((64-w)/2))*4);};
        paint(0,64);paint(count-1,width);
        const bytes=encodeFollowerFrames(frames,template(64,count));
        // frame() has two pixels at x=0/1; erase them before measuring the padded artwork.
        for(const f of frames) f.rgba.fill(0,0,8);
        const padded=encodeFollowerFrames(frames,template(64,count));
        expect(followerSideGap(padded,profile)).toBe(expected);
        const r=registry();r.entries[0].resourceId=0;r.entries[0].animationProfile=profile;
        deriveFollowerSpacing(r,[padded]);expect(r.entries[0].sideGap).toBe(expected);
        expect(bytes.length).toBe(padded.length);
      }
    }
  });
  it("uses native downward timing and mirrored right-side poses",()=>{
    expect(followerAnimationFrame("pokemon-mirrored","down",4)).toEqual({index:2,mirror:false});
    expect(followerAnimationFrame("pokemon-mirrored","down",5).index).toBe(3);
    expect(followerAnimationFrame("pokemon-mirrored","down",15).index).toBe(2);
    expect(followerAnimationFrame("pokemon-mirrored","right",10)).toEqual({index:5,mirror:true});
    expect(followerAnimationFrame("pokemon-asymmetric","right",10)).toEqual({index:7,mirror:false});
    const bytes=encodeFollowerFrames(Array.from({length:6},()=>frame()),template(32,6));
    const image=followerPreview(bytes,"pokemon-mirrored","right",0);
    expect([...image.rgba.subarray(31*4,32*4)]).toEqual([255,0,0,255]);
  });
  it("rejects malformed containers, partial alpha and excessive colors",()=>{
    expect(()=>validateFollowerResource(template().subarray(0,200),"pokemon-asymmetric")).toThrow(/length/);
    expect(()=>validateFollowerResource(template(32,6),"pokemon-asymmetric")).toThrow(/frames/);
    const frames=Array.from({length:8},()=>frame());frames[0].rgba[3]=128;
    expect(()=>encodeFollowerFrames(frames,template())).toThrow(/alpha/);
    frames[0]=frame();for(let i=0;i<16;i++)frames[0].rgba.set([i*8,80,80,255],i*4);
    expect(()=>encodeFollowerFrames(frames,template())).toThrow(/limit/);
    expect(()=>followerFramesFromSheet({width:32,height:256,rgba:new Uint8Array(32*256*4)})).toThrow(/sheet/);
  });
});
