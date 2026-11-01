import { describe, expect, it } from "vitest";
import type { NitroBackgroundImage } from "../pokeweb/nitroBg";
import { TOWN_MAP_TRANSPARENT_PIXEL as CLEAR, type TownMapArtworkPatch } from "../pokeweb/townMapArtwork";
import { createTownMapPaintSource, createTownMapCityPatch, createTownMapRoutePatch, snapTownMapPaintPoint, townMapRouteEndpoint, townMapRouteMetrics, TOWN_MAP_PAINT_INKS as ink, type TownMapPaintSource } from "../pokeweb/townMapPainting";

const nativeColors: Record<number, [number, number, number, number]> = {
  193: [248,184,48,255], 194: [208,160,56,255], 195: [168,136,64,255], 196: [144,112,40,255],
  197: [136,112,80,255], 202: [56,80,56,255], 205: [40,40,40,255], 206: [88,88,88,255],
};
function source(pixels = new Uint16Array(65536).fill(CLEAR)): TownMapPaintSource {
  const palette = Array.from({ length: 256 }, (_, i) => nativeColors[i] ?? [i,0,0,255]);
  const entries = new Uint16Array(1024), tiles: Uint8Array[] = [];
  for (let cell = 0; cell < 1024; cell++) {
    entries[cell] = cell; const tile = new Uint8Array(64);
    for (let p = 0; p < 64; p++) { const color = pixels[((cell >> 5) * 8 + (p >> 3)) * 256 + cell % 32 * 8 + p % 8]; tile[p] = color === CLEAR ? 0 : color; }
    tiles.push(tile);
  }
  return createTownMapPaintSource({ width: 256, height: 256, indexed: { palette, entries, tilePixels: tiles, bitsPerPixel: 8 } } as unknown as NitroBackgroundImage);
}
function compose(s: TownMapPaintSource, p: TownMapArtworkPatch) {
  const result = s.pixels.slice();
  for (let y = 0; y < p.rect.height; y++) result.set(p.pixels.subarray(y * p.rect.width, (y + 1) * p.rect.width), (p.rect.y + y) * 256 + p.rect.x);
  return result;
}
const route = (s: TownMapPaintSource, x: number, y: number, ex: number, ey: number) => createTownMapRoutePatch(s, { kind: "route", start: { x,y }, end: { x:ex,y:ey } });

describe("native Town Map city and route painting", () => {
  it.each(["small", "large"] as const)("stamps the native %s city body and downward shadow", size => {
    const s = source(), before = s.pixels.slice(), p = createTownMapCityPatch(s, { kind: "city", center: { x:100,y:100 }, size });
    expect(p.rect).toEqual(size === "small" ? { x:96,y:96,width:8,height:10 } : { x:94,y:94,width:12,height:14 });
    const after = compose(s,p);
    expect(after[100 * 256 + 100]).toBe(ink.C); expect(after[p.rect.y * 256 + p.rect.x]).toBe(CLEAR);
    expect(after[(p.rect.y + p.rect.height - 1) * 256 + 100]).toBe(ink.B);
    expect(s.pixels).toEqual(before);
    expect(new Set(p.pixels)).toEqual(new Set(size === "small" ? [CLEAR,ink.J,ink.D,ink.A,ink.G,ink.C,ink.B,ink.I] : [CLEAR,ink.J,ink.D,ink.A,ink.G,ink.H,ink.C,ink.B,ink.I]));
  });

  it("keeps transparent stamp corners and route entrances intact", () => {
    const s = source(compose(source(), route(source(), 60,100,140,100))), before = s.pixels.slice();
    const p = createTownMapCityPatch(s, { kind: "city", center: { x:100,y:100 }, size:"small" }), after = compose(s,p);
    expect(after[100 * 256 + 100]).toBe(ink.C); expect(after[99 * 256 + 95]).toBe(ink.A);
    for (let i=0;i<65536;i++) if (i%256 < p.rect.x || i%256 >= p.rect.x+p.rect.width || (i>>8)<p.rect.y || (i>>8)>=p.rect.y+p.rect.height) expect(after[i]).toBe(before[i]);
  });

  it("matches native two-pixel horizontal strokes with two dark shadow rows", () => {
    const s=source(), p=route(s,20,40,40,40), after=compose(s,p);
    expect(p.rect).toEqual({x:20,y:39,width:20,height:4});
    for(let x=20;x<40;x++) { expect(after[39*256+x]).toBe(ink.A); expect(after[40*256+x]).toBe(ink.A); expect(after[41*256+x]).toBe(ink.B); expect(after[42*256+x]).toBe(ink.B); }
  });

  it("matches native two-pixel vertical strokes without side outlines", () => {
    const s=source(), p=route(s,40,20,40,40), after=compose(s,p);
    for(let y=20;y<40;y++) { expect(after[y*256+39]).toBe(ink.A); expect(after[y*256+40]).toBe(ink.A); expect(after[y*256+38]).toBe(CLEAR); }
    expect(after[40*256+39]).toBe(ink.B); expect(after[41*256+39]).toBe(ink.B);
  });

  it.each([[43,28],[28,43],[-43,28],[-28,43],[43,-28],[28,-43],[-43,-28],[-28,-43],[40,1],[1,40],[32,32]])("renders and reverses diagonal %i,%i deterministically with native inks", (dx,dy) => {
    const s=source(), a={x:128,y:128}, b={x:128+dx,y:128+dy};
    const forward=createTownMapRoutePatch(s,{kind:"route",start:a,end:b}), backward=createTownMapRoutePatch(s,{kind:"route",start:b,end:a});
    expect(backward).toEqual(forward);
    const colors=new Set(forward.pixels); expect(colors.has(ink.A)).toBe(true); expect(colors.has(ink.B)).toBe(true);
    expect([...colors].every(c=>[CLEAR,ink.A,ink.D,ink.G,ink.J,ink.I,ink.B].includes(c))).toBe(true);
    expect([...colors].some(c=>new Set<number>([ink.D,ink.G,ink.J]).has(c))).toBe(true);
  });

  it.each([80,100,120])("merges a branch or crossing at y=%i without dark seams", y => {
    const empty=source(), first=source(compose(empty,route(empty,80,100,140,100)));
    const result=compose(first,route(first,110,y,110,140));
    for(let x=80;x<140;x++) for(const row of [99,100]) expect(result[row*256+x]).toBe(ink.A);
    for(let row=y;row<140;row++) for(const x of [109,110]) expect(result[row*256+x]).toBe(ink.A);
  });

  it("keeps an existing city body above a newly painted route", () => {
    const empty=source(), city=createTownMapCityPatch(empty,{kind:"city",center:{x:100,y:100},size:"large"}), s=source(compose(empty,city));
    const after=compose(s,route(s,70,100,130,100));
    s.cities.forEach((protectedPixel,i)=>{if(protectedPixel) expect(after[i]).toBe(s.pixels[i]);});
    expect(after[100*256+100]).toBe(ink.C); expect(after[100*256+90]).toBe(ink.A);
  });

  it("rounds numerical geometry and honors optional native-pixel snapping", () => {
    expect(townMapRouteEndpoint({x:10,y:10},32,90)).toEqual({x:10,y:42});
    expect(townMapRouteEndpoint({x:10,y:10},32,450)).toEqual({x:10,y:42});
    expect(snapTownMapPaintPoint({x:19.8,y:42.4},true)).toEqual({x:16,y:40});
    expect(townMapRouteEndpoint({x:16,y:16},21,35,true)).toEqual({x:32,y:32});
    expect(townMapRouteMetrics({kind:"route",start:{x:10,y:10},end:{x:13,y:14}})).toEqual({length:5,angle:53.13010235415595});
  });

  it("rejects invalid endpoints, sizes, lengths and shadow bounds without touching the source", () => {
    const s=source(), before=s.pixels.slice();
    expect(()=>route(s,20,20,20,20)).toThrow("different"); expect(()=>route(s,20,255,30,255)).toThrow("shadow");
    expect(()=>route(s,-1,20,30,20)).toThrow("coordinates"); expect(()=>route(s,20.5,20,30,20)).toThrow("coordinates");
    expect(()=>createTownMapCityPatch(s,{kind:"city",center:{x:4,y:4},size:"large"})).toThrow("shadow");
    expect(()=>townMapRouteEndpoint({x:1,y:1},0,45)).toThrow("positive"); expect(()=>townMapRouteEndpoint({x:1,y:1},100,NaN)).toThrow("finite");
    expect(s.pixels).toEqual(before);
  });
});
