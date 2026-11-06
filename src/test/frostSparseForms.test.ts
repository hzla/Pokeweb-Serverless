import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { addFilePath, Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { frostSparseFormFiles } from "../pokeweb/frostSparseForms";

function fixture(bw2: boolean) {
  const size = bw2 ? 76 : 60, sprite = (bw2 ? 685 : 652) + 2;
  const personal = new NARC();
  personal.files = Array.from({ length: 653 }, () => new Uint8Array(size));
  personal.files[651] = new Uint8Array();
  const template = Array.from({ length: 20 }, (_, i) => new Uint8Array(i >= 18 ? 72 : 4).fill(i + 1));
  const sprites = new NARC();
  sprites.files = Array.from({ length: (sprite + 1) * 20 }, (_, i) => template[i % 20].slice());
  for (let i = sprite * 20; i < (sprite + 1) * 20; ++i) sprites.files[i] = new Uint8Array();
  const rom = new NintendoDSRom(new Uint8Array(512));
  rom.data.set(new TextEncoder().encode(bw2 ? "IREO" : "IRBO"), 12); rom.idCode = bw2 ? "IREO" : "IRBO";
  rom.files = [personal.save(), sprites.save()];
  rom.filenames = addFilePath(addFilePath(new Folder(), "a/0/1/6", 0), "a/0/0/4", 1);
  return { rom, personal, sprites, template, sprite, size };
}

describe.each([true, false])("Frost unused form slots (BW2: %s)", bw2 => {
  it("fills only unused empty members without changing IDs, live data or the source", () => {
    const { rom, personal, sprites, template, sprite, size } = fixture(bw2), before = rom.files.map(f => f.slice());
    const changes = frostSparseFormFiles(rom);
    const p = new NARC(changes.get(0)!), s = new NARC(changes.get(1)!);
    expect(p.files.length).toBe(personal.files.length); expect(s.files.length).toBe(sprites.files.length);
    expect(p.files[651]).toEqual(new Uint8Array(size));
    for (let id = 0; id < p.files.length; ++id) if (id !== 651) expect(p.files[id]).toEqual(personal.files[id]);
    for (let id = 0; id < s.files.length; ++id)
      expect(s.files[id]).toEqual(Math.floor(id / 20) === sprite ? template[id % 20] : sprites.files[id]);
    expect(rom.files).toEqual(before);
    rom.files = [changes.get(0)!, changes.get(1)!];
    expect(frostSparseFormFiles(rom).size).toBe(0);
  });
  it("refuses missing personal or sprite data that a current form still references", () => {
    const { rom, personal, sprite } = fixture(bw2);
    writeU16(personal.files[1], 28, 651); writeU16(personal.files[1], 30, 2); personal.files[1][32] = 2;
    rom.files[0] = personal.save();
    expect(() => frostSparseFormFiles(rom)).toThrow("missing active personal record 651");
    personal.files[651] = new Uint8Array(bw2 ? 76 : 60); rom.files[0] = personal.save();
    expect(() => frostSparseFormFiles(rom)).toThrow(`missing active sprite ${sprite}`);
  });
});
