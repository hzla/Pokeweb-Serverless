import { applyTownMapArtworkPatch } from "../../src/pokeweb/townMapArtwork";
import { createTownMapPaintSource, createTownMapPaintPatch, type TownMapPaintSpec } from "../../src/pokeweb/townMapPainting";
import { readTownMapLayer, TOWN_MAP_LAYERS, equalTownMapBytes } from "../../src/pokeweb/townMapGraphics";
import { writeTownMapAreas, type TownMapDraft } from "../../src/pokeweb/townMapModel";

/** Visible samples for isolated save/export and emulator checks. */
export function paintTownMapToolsFixture(draft: TownMapDraft): void {
  const areas = writeTownMapAreas(draft.areas), preserved = [0,7,16].map(id => [id,draft.graphics.get(id)!] as const);
  const specs: TownMapPaintSpec[] = [
    { kind:"route",start:{x:48,y:140},end:{x:80,y:140} },
    { kind:"route",start:{x:80,y:140},end:{x:112,y:156} },
    { kind:"route",start:{x:96,y:132},end:{x:96,y:164} },
    { kind:"city",size:"large",center:{x:48,y:140} },
    { kind:"city",size:"small",center:{x:80,y:140} },
  ];
  for (const spec of specs) {
    const source = createTownMapPaintSource(readTownMapLayer(draft.graphics,TOWN_MAP_LAYERS[1]));
    applyTownMapArtworkPatch(draft,TOWN_MAP_LAYERS[1],createTownMapPaintPatch(source,spec));
  }
  if (!equalTownMapBytes(areas,writeTownMapAreas(draft.areas)) || preserved.some(([id,bytes]) => !equalTownMapBytes(bytes,draft.graphics.get(id)!)))
    throw new Error("Painting changed area records, Back resources or the shared palette.");
}
