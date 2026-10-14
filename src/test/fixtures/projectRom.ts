import { NintendoDSRom } from "../../nds/rom";
import { NARC } from "../../nds/narc";
import { writeU32 } from "../../nds/binary";
import { KO_MOVE_LEARNSET_PATH } from "../../pokeweb/koMoveLearnsetModel";

/** Small synthetic ROM for storage, recovery, export, and browser smoke checks. */
export function makePaddedRom(idCode = "IRDO"): Uint8Array {
  const header = new Uint8Array(0x4000);
  header.set(new TextEncoder().encode(idCode), 12);
  const rom = new NintendoDSRom(header);
  rom.arm9 = new Uint8Array(64);
  const emptyNarc = new NARC().save();
  const headers = new NARC();
  headers.files = [new Uint8Array(48)];
  const personal = new NARC();
  personal.files = [45, 60].map((hp) => {
    const bytes = new Uint8Array(0x4c);
    bytes[0] = hp;
    return bytes;
  });
  // Two small retained overlay sources exercise hydration from borrowed ROM files.
  rom.arm9OverlayTable = new Uint8Array(64);
  [89, 12].forEach((id, index) => {
    writeU32(rom.arm9OverlayTable, index * 32, id);
    writeU32(rom.arm9OverlayTable, index * 32 + 4, 0x02100000);
    writeU32(rom.arm9OverlayTable, index * 32 + 8, 64);
    writeU32(rom.arm9OverlayTable, index * 32 + 24, 7 + index);
  });
  const compact = rom.save({ addedFiles: [
    { path: "unchanged.bin", bytes: Uint8Array.of(7, 8, 9) },
    { path: "a/0/0/2", bytes: emptyNarc },
    { path: "a/0/0/3", bytes: emptyNarc },
    { path: "a/0/1/2", bytes: headers.save() },
    { path: "a/0/1/6", bytes: personal.save() },
    { path: "a/2/0/6", bytes: headers.save() },
    { path: KO_MOVE_LEARNSET_PATH, bytes: emptyNarc },
    { path: "overlay/overlay_0089.bin", bytes: new Uint8Array(64) },
    { path: "overlay/overlay_0012.bin", bytes: new Uint8Array(64) },
  ] });
  const padded = new Uint8Array(compact.length + 0x4000).fill(0xff);
  padded.set(compact);
  return padded;
}
