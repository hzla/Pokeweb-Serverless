import { writeU16, writeU32 } from "../nds/binary";
import { encodeW2AnimMani } from "../pokeweb/w2animCodec";

export function streamFixture(): Uint8Array {
  const frames = [new Uint8Array(4608).fill(0x21), new Uint8Array(4608).fill(0x43)];
  const palette = Uint16Array.from({ length: 16 }, (_, n) => n * 123);
  const mani = encodeW2AnimMani({ frames, sequence: [{ frame: 0, duration: 3 }, { frame: 1, duration: 7 }, { frame: 0, duration: 5 }], normalPalette: palette, shinyPalette: palette.map(n => n ^ 31) });
  const trainerFrames = frames.map(frame => { const value = frame.slice(); value.fill(0, 88 * 48); return value; });
  const trainer = encodeW2AnimMani({ frames: trainerFrames, sequence: [{ frame: 0, duration: 4 }], normalPalette: palette, shinyPalette: palette });
  const out = new Uint8Array(64 + mani.length + trainer.length);
  out.set(new TextEncoder().encode("W2AS")); writeU16(out, 4, 1); writeU32(out, 8, 3); writeU32(out, 12, 16);
  [22, 23].forEach((sheet, n) => { const p = 16 + n * 16; writeU16(out, p, 4); writeU32(out, p + 4, sheet); writeU32(out, p + 8, 64); writeU32(out, p + 12, 39); });
  writeU16(out, 48, 71); writeU16(out, 50, 1); writeU32(out, 52, 17); writeU32(out, 56, 64 + mani.length); writeU32(out, 60, 20);
  out.set(mani, 64); out.set(trainer, 64 + mani.length);
  return out;
}
