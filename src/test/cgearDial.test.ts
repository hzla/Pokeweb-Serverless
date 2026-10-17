import {describe,it,expect} from "vitest";
import {dial,onDial,dialAngle,dialMarker,advanceDial} from "../cgearButtons/dial";
import {compile} from "../cgearButtons/compiler";
import {defaults} from "../cgearButtons/document";
import {buttonTestAssets} from "./cgearButtonsFixture";
import {NARC} from "../nds/narc";
import {readU16,readU32,writeU32} from "../nds/binary";
import {validateButtonArchive} from "../pokeweb/cgearButtonsModel";
const point=(degrees:number)=>({x:128+Math.round(125*Math.cos(degrees*Math.PI/180)),y:96+Math.round(125*Math.sin(degrees*Math.PI/180))});
describe("BW2 outer-rim skin dial",()=>{
  it("captures the outside band and follows clockwise screen coordinates",()=>{
    expect(onDial({x:253,y:96})).toBe(true);expect(onDial({x:3,y:96})).toBe(true);
    expect(onDial({x:210,y:96})).toBe(false);expect(onDial({x:0,y:0})).toBe(false);
    expect([0,90,180,270].map(a=>dialAngle(point(a)))).toEqual([0,9000,18000,27000]);
  });
  it("accumulates exact 12-degree relative steps, reverses and unwraps zero",()=>{
    expect(dial.step).toBe(1200);
    expect(advanceDial(0,0,point(11)).steps).toBe(0);
    expect(advanceDial(0,0,point(13)).steps).toBe(1);
    let angle=dialAngle(point(-12.6)),accumulated=0,total=0;
    for(const a of [-6,.6,12.6,25.8,13.2,.6,-12.6]){const r=advanceDial(angle,accumulated,point(a));angle=r.angle;accumulated=r.accumulated;total+=r.steps;expect(Math.abs(accumulated)).toBeLessThan(dial.step);}
    expect(total).toBe(0);
    expect(advanceDial(dialAngle(point(-12.6)),0,point(.6)).steps).toBe(1);
    expect(advanceDial(dialAngle(point(.6)),0,point(-12.6)).steps).toBe(-1);
    expect(advanceDial(dialAngle(point(0)),0,point(37)).steps).toBe(3);
  });
  it("rejects jitter and center-crossing jumps and projects the marker onto the rim",()=>{
    let angle=0,accumulated=0;
    for(const a of [2,-3,4,-2,0]){const r=advanceDial(angle,accumulated,point(a));expect(r.steps).toBe(0);angle=r.angle;accumulated=r.accumulated;}
    expect(advanceDial(0,100,{x:128,y:96})).toMatchObject({steps:0,accumulated:100});
    expect(advanceDial(0,0,point(180)).steps).toBe(0);
    for(const a of [-35,0,35,145,180,215]){const m=dialMarker(point(a));expect(Math.abs(Math.hypot(m.x-128,m.y-96)-125)).toBeLessThan(2);}
  });
  it("compiles a ninth marker cell, faint palette and a dial ownership flag",()=>{
    const r=compile(defaults(),buttonTestAssets()),arc=new NARC(r.archive!);
    expect(validateButtonArchive(r.archive!)).toBe(true);expect(arc.files[0][47]).toBe(1);
    expect(readU16(arc.files[2],24)).toBe(9);expect(readU16(arc.files[3],24)).toBe(9);expect(readU16(arc.files[3],26)).toBe(9);
    expect(readU16(arc.files[1],40+10*2)).toBe(dial.ink);
    for(const color of [dial.ink,dial.markerInk])for(const shift of [0,5,10])expect(color>>shift&31).toBeLessThan(13);
    const cells=r.nativeGraphics!.files[1],first=24+readU32(cells,28),oam=first+readU16(cells,24)*16;
    for(const i of [31,32,33,34,36,37]){expect(readU16(cells,first+i*16)).toBe(1);expect(readU16(cells,oam+readU32(cells,first+i*16+4)+4)>>>12).toBe(7);}
    const h=arc.files[0];h[47]=0;let hash=0x811c9dc5;for(const v of [...h.subarray(0,28),...h.subarray(32)])hash=Math.imul(hash^v,0x1000193)>>>0;writeU32(h,28,hash);
    expect(()=>validateButtonArchive(arc.save())).toThrow();
  });
});
