import { parsePokemonAnimation, parsePokemonCellBank } from "./pokemonSpriteModel";
import { readTownMapTileSet, unpackTownMapResource } from "./townMapGraphics";
import type { TownMapDraft } from "./townMapModel";

export type TownMapCapacity = { mapActors: number; mapSprites: number; habitatActors: number; habitatSprites: number };
export function townMapCapacity(draft: TownMapDraft, habitats?: Uint8Array[], habitatOrder?: number[]): TownMapCapacity {
  function sequences(files: Map<number, Uint8Array>, char: number, pal: number, cell: number, anim: number) {
    const tiles = readTownMapTileSet(files, char, pal), bank = parsePokemonCellBank(unpackTownMapResource(files.get(cell)!));
    const animation = parsePokemonAnimation(unpackTownMapResource(files.get(anim)!));
    if (!tiles.tiles.length || tiles.bitsPerPixel !== 4 || tiles.tiles.length > 4096) throw new Error("Invalid Town Map sprite character data.");
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
  draft.areas.forEach(a => {
    if (shapes[a.habitat.animation] === undefined) throw new Error(`Map ${a.zone} references missing habitat animation ${a.habitat.animation}.`);
    if (a.visibilityFlag === 61443) return;
    if (a.zone === 424) return; // The version pair occupies one marker slot.
    if (a.type !== 1) mapActors++;
    const normal = a.type === 0 ? count(1) : a.type === 3 ? count(13) : a.type === 4 ? count(14) : a.type === 5 ? Math.max(count(16), count(17)) : 0;
    const selected = a.type === 0 ? count(2) : a.type === 2 || a.type === 3 ? count(3) : a.type === 4 ? count(15) : a.type === 5 ? count(18) : 0;
    mapSprites += normal; selectedExtra = Math.max(selectedExtra, selected - normal);
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
  return { mapActors, mapSprites, habitatActors, habitatSprites };
}
export function assertTownMapCapacity(capacity: TownMapCapacity): void {
  if (capacity.mapActors > 128) throw new Error(`Town Map needs ${capacity.mapActors} actors; the native map supports 128.`);
  if (capacity.mapSprites > 124) throw new Error(`Town Map needs ${capacity.mapSprites} sprite slots; 124 are available.`);
  if (capacity.habitatActors > 192) throw new Error(`Habitat display needs ${capacity.habitatActors} actors; the expanded pool supports 192.`);
  if (capacity.habitatSprites > 124) throw new Error(`A species habitat display needs ${capacity.habitatSprites} sprite slots; 124 are available.`);
}
