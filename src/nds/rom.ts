import { ByteLike, asUint8Array, readAscii, readU16, readU32, writeU16, writeU32 } from "./binary";
import { Folder, loadFnt } from "./fnt";
import { Overlay, loadOverlayTable } from "./code";

export type RomSaveOptions = {
  arm9?: Uint8Array;
  arm9OverlayTable?: Uint8Array;
  arm7OverlayTable?: Uint8Array;
  files?: Map<number, Uint8Array>;
};

export class NintendoDSRom {
  data: Uint8Array;
  name: string;
  idCode: string;
  arm9: Uint8Array;
  arm7: Uint8Array;
  arm9OverlayTable: Uint8Array;
  arm7OverlayTable: Uint8Array;
  fntData: Uint8Array;
  filenames: Folder;
  files: Uint8Array[];
  banner: Uint8Array;

  constructor(data: ByteLike) {
    this.data = asUint8Array(data);
    if (this.data.length < 0x200) throw new Error("Input is too small to be a Nintendo DS ROM");

    this.name = readAscii(this.data, 0, 12).replace(/\0+$/u, "");
    this.idCode = readAscii(this.data, 12, 4);

    const arm9Offset = readU32(this.data, 0x20);
    const arm9Length = readU32(this.data, 0x2c);
    const arm9OverlayOffset = readU32(this.data, 0x50);
    const arm9OverlayLength = readU32(this.data, 0x54);
    const arm7OverlayOffset = readU32(this.data, 0x58);
    const arm7OverlayLength = readU32(this.data, 0x5c);
    const fntOffset = readU32(this.data, 0x40);
    const fntLength = readU32(this.data, 0x44);
    const fatOffset = readU32(this.data, 0x48);
    const fatLength = readU32(this.data, 0x4c);
    const arm7Offset = readU32(this.data, 0x30);
    const arm7Length = readU32(this.data, 0x3c);
    const bannerOffset = readU32(this.data, 0x68);

    this.arm9 = this.data.slice(arm9Offset, arm9Offset + arm9Length);
    this.arm7 = this.data.slice(arm7Offset, arm7Offset + arm7Length);
    this.arm9OverlayTable = this.data.slice(arm9OverlayOffset, arm9OverlayOffset + arm9OverlayLength);
    this.arm7OverlayTable = this.data.slice(arm7OverlayOffset, arm7OverlayOffset + arm7OverlayLength);
    this.fntData = this.data.slice(fntOffset, fntOffset + fntLength);
    this.filenames = fntLength > 0 ? loadFnt(this.fntData) : new Folder();
    this.banner = bannerOffset > 0 ? this.data.slice(bannerOffset, bannerOffset + bannerLength(this.data, bannerOffset)) : new Uint8Array();

    this.files = [];
    for (let offset = fatOffset; offset + 8 <= fatOffset + fatLength; offset += 8) {
      const start = readU32(this.data, offset);
      const end = readU32(this.data, offset + 4);
      this.files.push(this.data.slice(start, end));
    }
  }

  fileId(path: string): number {
    const id = this.filenames.idOf(path);
    if (id === undefined) throw new Error(`Cannot find ROM file path: ${path}`);
    return id;
  }

  getFileByName(path: string): Uint8Array {
    return this.files[this.fileId(path)];
  }

  loadArm9Overlays(ids?: number[]): Map<number, Overlay> {
    const wanted = ids ? new Set(ids) : undefined;
    return loadOverlayTable(this.arm9OverlayTable, (_overlayId, fileId) => this.files[fileId], wanted);
  }

  save(options: RomSaveOptions = {}): Uint8Array {
    const files = this.files.map((file, id) => options.files?.get(id) ?? file);
    const headerSize = Math.max(readU32(this.data, 0x84) || 0x4000, 0x200);
    const writer = new RomWriter(Math.max(this.data.length, headerSize + files.reduce((sum, file) => sum + align(file.length, 0x200), 0)));
    writer.writeAt(0, this.data.subarray(0, Math.min(headerSize, this.data.length)));

    let cursor = align(headerSize, 0x200);
    const writeSection = (bytes: Uint8Array, alignment = 0x200): { offset: number; length: number } => {
      cursor = align(cursor, alignment);
      const offset = cursor;
      writer.writeAt(offset, bytes);
      cursor += bytes.length;
      return { offset, length: bytes.length };
    };

    const arm9 = writeSection(options.arm9 ?? this.arm9);
    const arm9OverlayTable = writeSection(options.arm9OverlayTable ?? this.arm9OverlayTable);
    const arm7 = writeSection(this.arm7);
    const arm7OverlayTable = writeSection(options.arm7OverlayTable ?? this.arm7OverlayTable);
    const fnt = writeSection(this.fntData);

    const fatLength = files.length * 8;
    cursor = align(cursor, 0x200);
    const fatOffset = cursor;
    writer.writeAt(fatOffset, new Uint8Array(fatLength));
    cursor += fatLength;

    const banner = this.banner.length > 0 ? writeSection(this.banner) : { offset: 0, length: 0 };

    files.forEach((file, id) => {
      cursor = align(cursor, 0x200);
      const start = cursor;
      writer.writeAt(start, file);
      cursor += file.length;
      writeU32(writer.buffer, fatOffset + id * 8, start);
      writeU32(writer.buffer, fatOffset + id * 8 + 4, cursor);
    });

    const romLength = align(cursor, 4);
    const out = writer.trim(romLength);

    writeU32(out, 0x20, arm9.offset);
    writeU32(out, 0x2c, arm9.length);
    writeU32(out, 0x30, arm7.offset);
    writeU32(out, 0x3c, arm7.length);
    writeU32(out, 0x40, fnt.offset);
    writeU32(out, 0x44, fnt.length);
    writeU32(out, 0x48, fatOffset);
    writeU32(out, 0x4c, fatLength);
    writeU32(out, 0x50, arm9OverlayTable.offset);
    writeU32(out, 0x54, arm9OverlayTable.length);
    writeU32(out, 0x58, arm7OverlayTable.offset);
    writeU32(out, 0x5c, arm7OverlayTable.length);
    writeU32(out, 0x68, banner.offset);
    writeU32(out, 0x80, romLength);
    out[0x14] = deviceCapacityByte(romLength, this.data[0x14] ?? 0);

    if (arm9.offset < 0x8000 && out.length >= 0x8000) writeU16(out, 0x6c, crc16(out.subarray(arm9.offset, 0x8000)));
    writeU16(out, 0x15c, crc16(out.subarray(0xc0, 0xc0 + 156)));
    writeU16(out, 0x15e, crc16(out.subarray(0, 0x15e)));
    return out;
  }
}

class RomWriter {
  buffer: Uint8Array;

  constructor(size: number) {
    this.buffer = new Uint8Array(size);
  }

  writeAt(offset: number, bytes: Uint8Array): void {
    this.ensure(offset + bytes.length);
    this.buffer.set(bytes, offset);
  }

  trim(length: number): Uint8Array {
    this.ensure(length);
    return this.buffer.slice(0, length);
  }

  private ensure(length: number): void {
    if (length <= this.buffer.length) return;
    let nextLength = this.buffer.length;
    while (nextLength < length) nextLength *= 2;
    const next = new Uint8Array(nextLength);
    next.set(this.buffer);
    this.buffer = next;
  }
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

function bannerLength(data: Uint8Array, offset: number): number {
  const version = readU16(data, offset);
  if (version === 0x103) return 0x23c0;
  if (version >= 3) return 0x1240;
  if (version === 2) return 0x940;
  return 0x840;
}

function deviceCapacityByte(romLength: number, minimum: number): number {
  let value = 0;
  let capacity = 128 * 1024;
  while (capacity < romLength && value < 255) {
    value += 1;
    capacity *= 2;
  }
  return Math.max(minimum, value);
}

export function crc16(data: Uint8Array, initial = 0xffff): number {
  let crc = initial;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
