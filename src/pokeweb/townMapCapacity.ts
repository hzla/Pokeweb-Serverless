import { parsePokemonAnimation, parsePokemonCellBank } from "./pokemonSpriteModel";
import { readTownMapTileSet, unpackTownMapResource } from "./townMapGraphics";
import { encodeGen5TextBank } from "./text";
import type { TownMapDraft } from "./townMapModel";

export type TownMapCapacity = { mapActors: number; mapSprites: number; habitatActors: number; habitatSprites: number; mapHeapBytes: number };
export function townMapCapacity(draft: TownMapDraft, habitats?: Uint8Array[], habitatOrder?: number[]): TownMapCapacity {
  function sequences(files: Map<number, Uint8Array>, char: number, pal: number, cell: number, anim: number) {
    const tiles = readTownMapTileSet(files, char, pal), bank = parsePokemonCellBank(unpackTownMapResource(files.get(cell)!));
    const animation = parsePokemonAnimation(unpackTownMapResource(files.get(anim)!));
    if (!tiles.tiles.length || tiles.bitsPerPixel !== 4 || tiles.tiles.length > 4096) throw new Error("Invalid Town Map sprite character data.");
    if (unpackTownMapResource(files.get(cell)!).length > 8192 || unpackTownMapResource(files.get(anim)!).length > 8192) throw new Error("Town Map cell and animation resources must each fit 8 KiB.");
    for (const c of bank.cells) for (const oam of c.oams) {
      if (oam.disable) continue;
      const boundary = bank.mappingMode === 1 || bank.mappingMode === 0x100010 ? 64 : bank.mappingMode === 2 || bank.mappingMode === 0x200010 ? 128 : bank.mappingMode === 3 || bank.mappingMode === 0x300010 ? 256 : 32;
      const start = Math.floor(boundary * oam.characterName / 32), length = oam.width * oam.height / 64;
      if (oam.characterBits !== 4 || start + length > tiles.tiles.length || (oam.palette + 1) * 16 > tiles.palette.length) throw new Error("Town Map cell references missing character or palette data.");
    }
    return animation.sequences.map((sequence, index) => {
      if (sequence.targetType !== 1 || !sequence.frames.length) throw new Error(`Animation ${index} has no cell frames.`);
      return Math.max(...sequence.frames.map(frame => {
        const c = bank.cells[frame.cellIndex]; if (!c) throw new Error(`Animation ${index} references a missing cell.`);
        return c.oams.filter(o => !o.disable).length;
      }));
    });
  }
  const markers = sequences(draft.graphics, 8, 2, 12, 19), shapes = sequences(draft.habitatGraphics, 15, 5, 29, 46);
  const count = (seq: number) => { const v = markers[seq]; if (v === undefined) throw new Error(`Missing marker animation ${seq}.`); return v; };
  let mapActors = 8, mapSprites = 20, selectedExtra = 0, conditional = 0;
  // Either city can be selected by the native version/save predicate.
  const city = draft.areas.find(a => a.zone === 0), forest = draft.areas.find(a => a.zone === 424);
  const alternatives = city && forest ? [city, forest] : [];
  const activeAreas = draft.areas.filter(a => a.zone !== 0 && a.zone !== 424);
  function markerCost(a: TownMapDraft["areas"][number]) {
    if (a.visibilityFlag === 61443) return { actors: 0, normal: 0, extra: 0 };
    const normal = a.type === 0 ? count(1) : a.type === 3 ? count(13) : a.type === 4 ? count(14) : a.type === 5 ? Math.max(count(16), count(17)) : 0;
    const selected = a.type === 0 ? count(2) : a.type === 2 || a.type === 3 ? count(3) : a.type === 4 ? count(15) : a.type === 5 ? count(18) : 0;
    return { actors: Number(a.type !== 1), normal, extra: Math.max(0, selected - normal) };
  }
  const pair = alternatives.map(markerCost);
  mapActors += Math.max(0, ...pair.map(p => p.actors)); mapSprites += Math.max(0, ...pair.map(p => p.normal)); selectedExtra = Math.max(0, ...pair.map(p => p.extra));
  draft.areas.forEach(a => {
    if (shapes[a.habitat.animation] === undefined) throw new Error(`Map ${a.zone} references missing habitat animation ${a.habitat.animation}.`);
    if (a.visibilityFlag === 61443) return;
    if (activeAreas.includes(a)) { const cost = markerCost(a); mapActors += cost.actors; mapSprites += cost.normal; selectedExtra = Math.max(selectedExtra, cost.extra); }
    if (a.visibilityFlag !== 65535) conditional += a.type === 4 ? count(14) : count(16);
  });
  mapSprites += selectedExtra;
  const habitatActors = draft.areas.length + draft.areas.filter(a => a.visibilityFlag !== 65535 && a.visibilityFlag !== 61443).length + 16;
  let habitatSprites = conditional + 16;
  if (habitats) {
    for (const bytes of habitats) {
      if (bytes.length !== 517) throw new Error("Expanded habitat records must have a 128-place stride.");
      for (let season = 0; season < 4; season++) {
        let sprites = conditional + 16;
        // Config uses the retail habitat ordering for the first 85 records.
        const order = draft.areas.map((_, i) => i < 85 ? habitatOrder?.[i] ?? i : i);
        draft.areas.forEach((a, i) => { if (a.visibilityFlag !== 61443 && bytes[2 + season * 129 + order[i]]) sprites += shapes[a.habitat.animation]; });
        habitatSprites = Math.max(habitatSprites, sprites);
      }
    }
  }
  // Upper bound: retain every map archive member, the text bank and records,
  // plus 512 bytes per actor and 64 KiB for native windows/work/heap overhead.
  const resources = [...draft.graphics.values()].reduce((sum, bytes) => sum + unpackTownMapResource(bytes).length, 0);
  const mapHeapBytes = resources + encodeGen5TextBank(draft.texts).length + draft.areas.length * (54 + 68) + mapActors * 512 + 65536;
  return { mapActors, mapSprites, habitatActors, habitatSprites, mapHeapBytes };
}
export function assertTownMapCapacity(capacity: TownMapCapacity): void {
  if (capacity.mapHeapBytes > 0x60000) throw new Error(`Town Map needs a ${Math.ceil(capacity.mapHeapBytes / 1024)} KiB heap budget; 384 KiB are available.`);
  if (capacity.mapActors > 128) throw new Error(`Town Map needs ${capacity.mapActors} actors; the native map supports 128.`);
  if (capacity.mapSprites > 124) throw new Error(`Town Map needs ${capacity.mapSprites} sprite slots; 124 are available.`);
  if (capacity.habitatActors > 192) throw new Error(`Habitat display needs ${capacity.habitatActors} actors; the expanded pool supports 192.`);
  if (capacity.habitatSprites > 124) throw new Error(`A species habitat display needs ${capacity.habitatSprites} sprite slots; 124 are available.`);
}
