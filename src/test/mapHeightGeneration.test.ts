import { describe, expect, it } from "vitest";
import { readU16, writeU16 } from "../nds/binary";
import { generateMapHeightPlates, sampleMapHeightPlates, compareMapHeightPlates } from "../pokeweb/mapHeightGeometry";
import { generateGen5MapHeights, gen5HeightAt } from "../pokeweb/gen5MapHeightGeneration";
import { prepareMapHeightEdit, applyMapHeightEdit } from "../pokeweb/mapHeightEdit";
import { mapBin, mapPermissions, gen5ImportProject } from "./fixtures/gen5MapImport";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
const plane = (a = 0, b = 0, c = 0) => ({ positions: new Float32Array([-16,c-a*16-b*16,-16, 16,c+a*16-b*16,-16, 16,c+a*16+b*16,16, -16,c-a*16+b*16,16].map(n => n*16)), indices: new Uint16Array([0,2,1,0,3,2]) });
describe("walking height geometry", () => {
  it("merges coplanar triangles and snaps heights to sixteenths without filling blocked tiles", () => {
    const walkable = Array(1024).fill(true); walkable[33] = false;
    const r = generateMapHeightPlates([plane(0,0,.02)], walkable);
    expect(r.missing).toEqual([]); expect(r.plates.length).toBeLessThan(8);
    expect(sampleMapHeightPlates(r.plates,-14.5,-14.5)).toEqual([]); expect(sampleMapHeightPlates(r.plates,0,0)).toEqual([0]);
    expect(compareMapHeightPlates(r.plates,generateMapHeightPlates([plane()],walkable).plates,walkable).equivalent).toBe(true);
  });
  it("preserves full overlapping surfaces and rejects missing/partial walking geometry", () => {
    const r = generateMapHeightPlates([plane(),plane(0,0,2)],Array(1024).fill(true));
    expect(sampleMapHeightPlates(r.plates,.5,.5)).toEqual([0,2]);
    const partial = plane(); partial.indices = new Uint16Array([0,1,2]);
    expect(generateMapHeightPlates([partial],Array(1024).fill(true)).missing.length).toBeGreaterThan(0);
  });
  it("detects real height changes rather than comparing plate counts or bytes", () => {
    const walkable = Array(1024).fill(true), a = generateMapHeightPlates([plane()],walkable), b = generateMapHeightPlates([plane(0,0,1)],walkable);
    expect(a.plates.length).toBe(b.plates.length); expect(compareMapHeightPlates(a.plates,b.plates,walkable)).toMatchObject({equivalent:false,mismatches:9216,maxError:1});
  });
});
describe("Gen 5 PER height generation", () => {
  it.each(["BW","BW2"] as const)("reproduces native flat ground and preserves behavior/flags for %s", game => {
    const primary=mapPermissions(); if(game==="BW2") for(let i=0;i<1024;i++) writeU16(primary,6+i*8,3); writeU16(primary,8,4);writeU16(primary,10,0x24);writeU16(primary,18,1);writeU16(primary,12,99);
    const r=generateGen5MapHeights([plane()],primary,undefined,game);
    expect(r.equivalent).toBe(true); expect(r.canApply).toBe(true);expect(r.primary).toEqual(primary);
  });
  it.each(["BW","BW2"] as const)("encodes a ramp with native %s slopes and reports functional differences", game => {
    const r=generateGen5MapHeights([plane(.5,0,0)],mapPermissions(),undefined,game);
    expect(r.canApply).toBe(true);expect(r.changedTiles.length).toBeGreaterThan(0);
    for(const i of [0,31,512,1023]) expect(gen5HeightAt(r.primary,i,.5,.5,game)).toBeCloseTo((i%32-15.5)*.5,2);
  });
  it("retains both walking layers and does not silently discard ambiguous surfaces", () => {
    const primary=mapPermissions(), secondary=mapPermissions(true), r=generateGen5MapHeights([plane(),plane(0,0,2)],primary,secondary,"BW2");
    expect(r.canApply).toBe(true);expect(gen5HeightAt(r.primary,512,.5,.5,"BW2")).toBeCloseTo(2,2);expect(gen5HeightAt(r.secondary!,512,.5,.5,"BW2")).toBe(0);
    expect(r.secondary!.subarray(8196)).toEqual(secondary.subarray(8196));
    expect(generateGen5MapHeights([plane(),plane(0,0,2)],primary,undefined,"BW2").canApply).toBe(false);
  });
  it("blocks unsafe generation with missing terrain or unrepresentable elevations", () => {
    expect(generateGen5MapHeights([],mapPermissions(),undefined,"BW2").canApply).toBe(false);
    const r=generateGen5MapHeights([plane(0,0,1000)],mapPermissions(),undefined,"BW2");expect(r.unsupported.length).toBe(1024);expect(r.canApply).toBe(false);
  });
  it("applies and undoes only PER bytes, preserving all other native map members", () => {
    const source=mapBin(), parsed=readGen5MapBin(source), r=generateGen5MapHeights([plane()],parsed.files[1],undefined,"BW2"), edit=prepareMapHeightEdit(0,source,r), project=gen5ImportProject();
    project.narcs.maps!.rawFiles[0]=source.slice();applyMapHeightEdit(project,edit);
    const after=readGen5MapBin(project.narcs.maps!.rawFiles[0]); expect(after.files[0]).toEqual(parsed.files[0]);expect(after.files.slice(2)).toEqual(parsed.files.slice(2));
    expect(readU16(after.files[1],6)).not.toBe(readU16(parsed.files[1],6));
    applyMapHeightEdit(project,edit,true);expect(project.narcs.maps!.rawFiles[0]).toEqual(source);
    project.narcs.maps!.rawFiles[0][30]^=1;expect(()=>applyMapHeightEdit(project,edit)).toThrow("changed");
  });
});
