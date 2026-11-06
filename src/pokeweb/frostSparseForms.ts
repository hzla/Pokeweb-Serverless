import { readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";

/** Frost's eager readers cannot handle the empty interior slots left by form deletion. */
export function frostSparseFormFiles(rom: NintendoDSRom): Map<number, Uint8Array> {
  const changes = new Map<number, Uint8Array>();
  const personalId = rom.filenames.idOf("a/0/1/6");
  if (personalId === undefined) return changes;
  const personal = new NARC(rom.files[personalId]);
  const bw2 = /^(IRD|IRE)/u.test(rom.idCode), recordSize = bw2 ? 76 : 60, formStart = bw2 ? 685 : 652;
  const referencedPersonal = new Set<number>(), referencedSprites = new Set<number>();
  personal.files.forEach((bytes, id) => {
    // BW2's internal sprite lookup member is not a personal record.
    if (bytes.length !== recordSize) return;
    if (id < 650) referencedSprites.add(id);
    const first = readU16(bytes, 28), sprite = readU16(bytes, 30), count = bytes[32];
    for (let i = 0; i < count - 1; ++i) {
      if (first) referencedPersonal.add(first + i);
      if (sprite) referencedSprites.add(formStart + sprite + i);
    }
  });
  let personalChanged = false;
  personal.files.forEach((bytes, id) => {
    if (bytes.length) return;
    if (id < 650 || referencedPersonal.has(id)) throw new Error(`Frost export cannot repair missing active personal record ${id}.`);
    personal.files[id] = new Uint8Array(recordSize);
    personalChanged = true;
  });
  if (personalChanged) changes.set(personalId, personal.save());

  const spriteId = rom.filenames.idOf("a/0/0/4");
  if (spriteId === undefined) return changes;
  const sprites = new NARC(rom.files[spriteId]);
  const count = Math.floor(sprites.files.length / 20), empty: number[] = [];
  let template: Uint8Array[] | undefined;
  for (let id = 0; id < count; ++id) {
    const block = sprites.files.slice(id * 20, (id + 1) * 20);
    if (block.every(bytes => !bytes.length)) empty.push(id);
    else if (!template && block[18].length >= 72 && block[19].length >= 72
      && [0, 2, 4, 5, 8, 9, 11, 13, 14, 17].every(index => block[index].length > 0)) template = block;
  }
  if (!empty.length) return changes;
  if (!template) throw new Error("Frost export needs a valid sprite block for unused form placeholders.");
  for (const id of empty) {
    if (id < 650 || referencedSprites.has(id)) throw new Error(`Frost export cannot repair missing active sprite ${id}.`);
    // Retain the existing archive indices. Only completely empty, unused
    // blocks receive the ROM's own placeholder graphics; live art stays exact.
    for (let file = 0; file < 20; ++file) sprites.files[id * 20 + file] = template[file].slice();
  }
  changes.set(spriteId, sprites.save());
  return changes;
}
