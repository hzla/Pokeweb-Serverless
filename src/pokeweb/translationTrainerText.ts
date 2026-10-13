import { readU16 } from "../nds/binary";
import { decodeGen5TextBank } from "./text";

export const TRANSLATION_TRAINER_TEXT_BANK = 381;
export const TRANSLATION_TRAINER_TEXT_TABLES = ["a/0/8/9", "a/0/9/0"] as const;

/** The native reader finds (trainer, type), then uses the table offset / 4 as its message ID. */
export function validateTranslationTrainerText(bank: Uint8Array, rows: Uint8Array, offsets: Uint8Array, sourceOffsetBytes: number): void {
  if (readU16(bank, 0) !== 1) throw new Error("Trainer dialogue must keep one text block.");
  const count = readU16(bank, 2);
  if (rows.length % 4 || rows.length !== count * 4 || rows.length > 0xffff)
    throw new Error("Trainer dialogue entry count does not match its four-byte lookup rows or exceeds the 16-bit offset range.");
  if (offsets.length % 2 || offsets.length !== sourceOffsetBytes)
    throw new Error("Trainer dialogue offset table changed the US trainer-ID range.");
  if (decodeGen5TextBank(bank).length !== count) throw new Error("Trainer dialogue entries are incomplete.");
  for (let trainer = 0; trainer < offsets.length / 2; trainer++) {
    const offset = readU16(offsets, trainer * 2);
    if (offset % 4 || offset > rows.length) throw new Error(`Trainer ${trainer} dialogue offset is unaligned or outside the lookup table.`);
  }
  for (let at = 0; at < rows.length; at += 4) {
    const trainer = readU16(rows, at);
    if (trainer * 2 >= offsets.length) throw new Error(`Trainer dialogue row ${at / 4} refers to an unsupported trainer ID ${trainer}.`);
    if (readU16(offsets, trainer * 2) > at) throw new Error(`Trainer ${trainer} dialogue offset skips lookup row ${at / 4}.`);
  }
}
