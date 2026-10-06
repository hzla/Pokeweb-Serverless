import { readU16, readU32 } from "./binary";

/** Reject truncation before parsing can silently clamp a ROM section's view. */
export function validateDsRomSections(source: Uint8Array): void {
  if (source.length < 0x4000) throw new Error("The ROM is too small: its native DS header is incomplete.");
  const headerSize = readU32(source, 0x84) || 0x4000;
  if (headerSize < 0x200 || headerSize > source.length) throw new Error("The ROM declares an invalid native header size.");
  const span = (start: number, length: number, name: string, required = true): void => {
    // Several repackers leave a nonzero pointer for an empty overlay table.
    if (!required && !length) return;
    if (start < headerSize || length <= 0 || start + length > source.length) {
      throw new Error(`The ROM's ${name} is missing or truncated. DSi repair cannot recover native DS game data.`);
    }
  };
  for (const [offset, size, name, required] of [
    [0x20, 0x2c, "ARM9 program", true], [0x30, 0x3c, "ARM7 program", true],
    [0x40, 0x44, "filename table", true], [0x48, 0x4c, "file allocation table", true],
    [0x50, 0x54, "ARM9 overlay table", false], [0x58, 0x5c, "ARM7 overlay table", false],
  ] as const) span(readU32(source, offset), readU32(source, size), name, required);
  const fatAt = readU32(source, 0x48), fatSize = readU32(source, 0x4c);
  if (fatSize % 8 || readU32(source, 0x54) % 32 || readU32(source, 0x5c) % 32) throw new Error("The ROM's native file or overlay table has an invalid size.");
  for (let at = fatAt; at < fatAt + fatSize; at += 8) {
    const start = readU32(source, at), end = readU32(source, at + 4);
    if (start > end || end > source.length || start < headerSize) {
      throw new Error(`Native DS file ${(at - fatAt) / 8} is missing or truncated. DSi repair cannot recover native DS game data.`);
    }
  }
  const banner = readU32(source, 0x68);
  if (banner) {
    const version = readU16(source, banner);
    span(banner, version === 0x103 ? 0x23c0 : version >= 3 ? 0x1240 : version === 2 ? 0x940 : 0x840, "banner");
  }
}
