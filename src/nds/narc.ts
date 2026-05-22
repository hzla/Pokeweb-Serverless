import { ByteLike, asUint8Array, concatBytes, pad4, readAscii, readU16, readU32, writeU16, writeU32 } from "./binary";
import { Folder, loadFnt, saveFnt } from "./fnt";

export class NARC {
  files: Uint8Array[] = [];
  filenames = new Folder();
  endiannessOfBeginning: "<" | ">" = "<";

  constructor(data?: ByteLike) {
    if (data) this.initFromData(asUint8Array(data));
  }

  private initFromData(data: Uint8Array): void {
    const magic = readAscii(data, 0, 4);
    if (magic !== "NARC") throw new Error(`Wrong NARC magic: ${magic}`);

    const bom = readU16(data, 4);
    let version = readU16(data, 6);
    if (bom === 0xfffe) {
      this.endiannessOfBeginning = ">";
      version = ((version & 0xff) << 8) | (version >>> 8);
    }
    if (version !== 1) throw new Error(`Unsupported NARC version: ${version}`);

    const fatbMagic = readAscii(data, 0x10, 4);
    if (fatbMagic !== "BTAF") throw new Error(`Incorrect NARC FATB magic: ${fatbMagic}`);
    const fatbSize = readU32(data, 0x14);
    const fileCount = readU32(data, 0x18);

    const fntbOffset = 0x10 + fatbSize;
    const fntbMagic = readAscii(data, fntbOffset, 4);
    if (fntbMagic !== "BTNF") throw new Error(`Incorrect NARC FNTB magic: ${fntbMagic}`);
    const fntbSize = readU32(data, fntbOffset + 4);

    const fimgBlock = resolveFimgBlock(data, fntbOffset, fntbSize);
    const fimgMagic = readAscii(data, fimgBlock.magicOffset, 4);
    if (fimgMagic !== "GMIF") throw new Error(`Incorrect NARC FIMG magic: ${fimgMagic}`);

    this.files = [];
    for (let i = 0; i < fileCount; i += 1) {
      const start = readU32(data, 0x1c + i * 8);
      const end = readU32(data, 0x20 + i * 8);
      this.files.push(data.slice(fimgBlock.rawOffset + start, fimgBlock.rawOffset + end));
    }

    this.filenames = loadFnt(data.subarray(fntbOffset + 8, fimgBlock.magicOffset));
  }

  save(): Uint8Array {
    const fatb = new Uint8Array(0x0c + 8 * this.files.length);
    fatb.set([0x42, 0x54, 0x41, 0x46], 0);
    writeU32(fatb, 4, fatb.length);
    writeU32(fatb, 8, this.files.length);

    const fimgParts: Uint8Array[] = [new Uint8Array(8)];
    let fimgLength = 8;
    for (let i = 0; i < this.files.length; i += 1) {
      const file = this.files[i];
      const start = fimgLength - 8;
      const padded = pad4(file);
      fimgParts.push(padded);
      fimgLength += padded.length;
      writeU32(fatb, 0x0c + i * 8, start);
      writeU32(fatb, 0x10 + i * 8, start + file.length);
    }
    const fimg = concatBytes(fimgParts);
    fimg.set([0x47, 0x4d, 0x49, 0x46], 0);
    writeU32(fimg, 4, fimg.length);

    const nameTable = pad4(saveFnt(this.filenames), 0xff);
    const fntb = new Uint8Array(8 + nameTable.length);
    fntb.set([0x42, 0x54, 0x4e, 0x46], 0);
    writeU32(fntb, 4, fntb.length);
    fntb.set(nameTable, 8);

    const body = concatBytes([fatb, fntb, fimg]);
    const out = new Uint8Array(0x10 + body.length);
    out.set([0x4e, 0x41, 0x52, 0x43], 0);
    writeU16(out, 4, this.endiannessOfBeginning === ">" ? 0xfffe : 0xfeff);
    writeU16(out, 6, this.endiannessOfBeginning === ">" ? 0x0100 : 1);
    writeU32(out, 8, out.length);
    writeU16(out, 0x0c, 0x10);
    writeU16(out, 0x0e, 3);
    out.set(body, 0x10);
    validateSavedNarc(out);
    return out;
  }
}

export function hasEarlyFimgMagic(dataLike: ByteLike): boolean {
  const data = asUint8Array(dataLike);
  const fntbOffset = getFntbOffset(data);
  if (fntbOffset === undefined) return false;
  const fntbSize = readU32(data, fntbOffset + 4);
  const declaredOffset = fntbOffset + fntbSize;
  return readAscii(data, declaredOffset, 4) !== "GMIF" && fntbSize >= 4 && readAscii(data, declaredOffset - 4, 4) === "GMIF";
}

export function hasCtrMapIncompatibleFntb(dataLike: ByteLike): boolean {
  const data = asUint8Array(dataLike);
  const fntbOffset = getFntbOffset(data);
  if (fntbOffset === undefined) return false;
  const fntbSize = readU32(data, fntbOffset + 4);
  if (fntbSize < 16) return true;
  return readU16(data, fntbOffset + 14) !== 1;
}

function getFntbOffset(data: Uint8Array): number | undefined {
  if (readAscii(data, 0, 4) !== "NARC") return undefined;
  const fatbSize = readU32(data, 0x14);
  const fntbOffset = 0x10 + fatbSize;
  if (readAscii(data, fntbOffset, 4) !== "BTNF") return undefined;
  return fntbOffset;
}

function resolveFimgBlock(data: Uint8Array, fntbOffset: number, fntbSize: number): { magicOffset: number; rawOffset: number } {
  const declaredOffset = fntbOffset + fntbSize;
  if (readAscii(data, declaredOffset, 4) === "GMIF") return { magicOffset: declaredOffset, rawOffset: declaredOffset + 8 };

  // Some edited Gen 5 ROMs declare a 0x14-byte empty FNTB, put GMIF four
  // bytes early, and still keep file payload offsets relative to the
  // declared FIMG data position.
  const missingFntPaddingOffset = declaredOffset - 4;
  if (fntbSize >= 4 && readAscii(data, missingFntPaddingOffset, 4) === "GMIF") {
    return { magicOffset: missingFntPaddingOffset, rawOffset: declaredOffset + 8 };
  }

  return { magicOffset: declaredOffset, rawOffset: declaredOffset + 8 };
}

function validateSavedNarc(data: Uint8Array): void {
  const magic = readAscii(data, 0, 4);
  const fatbMagic = readAscii(data, 0x10, 4);
  const fatbSize = readU32(data, 0x14);
  const fntbOffset = 0x10 + fatbSize;
  const fntbMagic = readAscii(data, fntbOffset, 4);
  const fntbSize = readU32(data, fntbOffset + 4);
  const fimgOffset = fntbOffset + fntbSize;
  const fimgMagic = readAscii(data, fimgOffset, 4);
  if (magic !== "NARC" || fatbMagic !== "BTAF" || fntbMagic !== "BTNF" || fimgMagic !== "GMIF") {
    throw new Error(`Saved NARC failed magic validation: ${magic}/${fatbMagic}/${fntbMagic}/${fimgMagic}`);
  }
}
