import { getNarcFormats, type FieldSpec } from "../../pokeweb/formats";
import type { NarcName } from "../../pokeweb/constants";
import type { NarcStore, ProjectState } from "../../pokeweb/projectStore";

export function makeEditProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const store = (name: NarcName, files: Uint8Array[], fileId: number): NarcStore => ({
    name, fileId, sourcePath: name, fileCount: files.length, rawFiles: files,
    records: new Map(), dirty: new Set(),
  });
  const row = (format: FieldSpec[], values: Record<string, number>) => {
    const bytes = new Uint8Array(format.reduce((sum, [size]) => sum + size, 0));
    let offset = 0;
    for (const [size, field] of format) {
      const value = values[field] ?? 0;
      for (let n = 0; n < size; n++) bytes[offset++] = Math.floor(value / 2 ** (8 * n)) & 255;
    }
    return bytes;
  };
  return {
    session: { romName: "edit-fixture", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "edit-fixture", idCode: "TEST", fileName: "edit-fixture.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, formats, trpokInfo: [],
    texts: { banks: { moves: ["None", "Tackle"], items: ["None", "Potion"] } },
    narcs: {
      moves: store("moves", [row(formats.moves!, {}), row(formats.moves!, { power: 40, accuracy: 100, category: 1, pp: 35, hits: 0x31, properties: 1 })], 1),
      items: store("items", [row(formats.items!, {}), row(formats.items!, { market_value: 300 })], 2),
      move_animations: store("move_animations", [Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)], 3),
      battle_animations: store("battle_animations", Array.from({ length: 128 }, () => Uint8Array.of(4)), 4),
    },
  };
}
