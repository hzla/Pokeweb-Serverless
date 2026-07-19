import { ByteLike, asUint8Array, readAscii, readU16, readU32, writeU16, writeU32 } from "./binary";
import { Folder, addFilePath, cloneFolder, loadFnt, saveFnt, shiftFileIdsAtOrAfter } from "./fnt";
import { Overlay, loadOverlayTable } from "./code";

export type RomSaveOptions = {
  arm9?: Uint8Array;
  arm9OverlayTable?: Uint8Array;
  arm7OverlayTable?: Uint8Array;
  files?: Map<number, Uint8Array>;
  insertedFiles?: Array<{ fileId: number; path?: string; bytes: Uint8Array }>;
  addedFiles?: Array<{ path: string; bytes: Uint8Array }>;
  /** File IDs to place first in the NitroFS data region without changing their IDs. */
  priorityFileIds?: number[];
  alignFntFirstFileToArm9OverlayCount?: boolean;
  minimumLength?: number;
  preserveOriginalLength?: boolean;
};

export class NintendoDSRom {
  data: Uint8Array;
  name: string;
  idCode: string;
  arm9: Uint8Array;
  arm9RamAddress: number;
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
    this.arm9RamAddress = readU32(this.data, 0x28);
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
    const arm9OverlayTableBytes = options.arm9OverlayTable ?? this.arm9OverlayTable;
    let filenames = this.filenames;
    let fntData = this.fntData;
    let shouldRewriteFnt = false;
    if (options.insertedFiles && options.insertedFiles.length > 0) {
      for (const file of [...options.insertedFiles].sort((a, b) => a.fileId - b.fileId)) {
        if (!Number.isInteger(file.fileId) || file.fileId < 0 || file.fileId > files.length) throw new Error(`Invalid inserted file ID: ${file.fileId}`);
        filenames = shiftFileIdsAtOrAfter(filenames, file.fileId, 1);
        files.splice(file.fileId, 0, file.bytes);
        if (file.path) filenames = addFilePath(filenames, file.path, file.fileId);
      }
      shouldRewriteFnt = true;
    }
    if (options.alignFntFirstFileToArm9OverlayCount) {
      const overlayCount = arm9OverlayTableBytes.length / 32;
      if (Number.isInteger(overlayCount) && filenames.firstId !== overlayCount) {
        filenames = cloneFolder(filenames);
        filenames.firstId = overlayCount;
        shouldRewriteFnt = true;
      }
    }
    if (options.addedFiles && options.addedFiles.length > 0) {
      for (const file of options.addedFiles) {
        filenames = addFilePath(filenames, file.path, files.length);
        files.push(file.bytes);
      }
      shouldRewriteFnt = true;
    }
    if (shouldRewriteFnt) {
      fntData = saveFnt(filenames);
    }
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

    const writeOptionalSection = (bytes: Uint8Array, alignment = 0x200): { offset: number; length: number } =>
      bytes.length > 0 ? writeSection(bytes, alignment) : { offset: 0, length: 0 };

    const arm9 = writeSection(options.arm9 ?? this.arm9);
    const arm9OverlayTable = writeOptionalSection(arm9OverlayTableBytes);
    const arm7 = writeSection(this.arm7);
    const arm7OverlayTable = writeOptionalSection(options.arm7OverlayTable ?? this.arm7OverlayTable);
    const fnt = writeSection(fntData);

    const fatLength = files.length * 8;
    cursor = align(cursor, 0x200);
    const fatOffset = cursor;
    writer.writeAt(fatOffset, new Uint8Array(fatLength));
    cursor += fatLength;

    const banner = this.banner.length > 0 ? writeSection(this.banner) : { offset: 0, length: 0 };

    const priorityFileIds = [...new Set(options.priorityFileIds ?? [])];
    for (const id of priorityFileIds) {
      if (!Number.isInteger(id) || id < 0 || id >= files.length) throw new Error(`Invalid priority file ID: ${id}`);
    }
    const prioritySet = new Set(priorityFileIds);
    const physicalFileOrder = [
      ...priorityFileIds,
      ...files.map((_file, id) => id).filter((id) => !prioritySet.has(id)),
    ];
    physicalFileOrder.forEach((id) => {
      const file = files[id];
      cursor = align(cursor, 0x200);
      const start = cursor;
      writer.writeAt(start, file);
      cursor += file.length;
      writeU32(writer.buffer, fatOffset + id * 8, start);
      writeU32(writer.buffer, fatOffset + id * 8 + 4, cursor);
    });

    const applicationEnd = align(cursor, 4);
    const twlSections = this.twlSections();
    const twlSectionWrites: Array<{ offsetField: number; offset: number }> = [];
    if (twlSections.length > 0) {
      cursor = align(cursor, 0x200);
      for (const section of twlSections) {
        cursor = align(cursor, 0x200);
        const offset = cursor;
        writer.writeAt(offset, this.data.subarray(section.sourceOffset, section.sourceOffset + section.length));
        cursor += section.length;
        twlSectionWrites.push({ offsetField: section.offsetField, offset });
      }
    }

    const compactRomLength = align(cursor, 4);
    const minimumLength = Math.max(options.preserveOriginalLength ? this.data.length : 0, options.minimumLength ?? 0);
    const romLength = Math.max(compactRomLength, align(minimumLength, 4));
    const out = writer.trim(romLength);
    if (options.preserveOriginalLength && romLength > compactRomLength) out.fill(0xff, compactRomLength, romLength);

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
    writeU32(out, 0x80, twlSections.length > 0 ? applicationEnd : romLength);
    if (twlSections.length > 0) {
      for (const section of twlSectionWrites) {
        writeU32(out, section.offsetField, section.offset);
      }
      writeU32(out, 0x210, romLength);
    }
    out[0x14] = deviceCapacityByte(romLength, this.data[0x14] ?? 0);

    if (arm9.offset < 0x8000 && out.length >= 0x8000) writeU16(out, 0x6c, crc16(out.subarray(arm9.offset, 0x8000)));
    writeU16(out, 0x15c, crc16(out.subarray(0xc0, 0xc0 + 156)));
    writeU16(out, 0x15e, crc16(out.subarray(0, 0x15e)));
    return out;
  }

  private twlSections(): Array<{ offsetField: number; sourceOffset: number; length: number }> {
    if (!this.isTwlExtended()) return [];

    const sections = [
      { offsetField: 0x1c0, sizeField: 0x1cc },
      { offsetField: 0x1d0, sizeField: 0x1dc },
    ];
    return sections
      .map((section) => ({
        offsetField: section.offsetField,
        sourceOffset: readU32(this.data, section.offsetField),
        length: readU32(this.data, section.sizeField),
      }))
      .filter((section) => section.sourceOffset > 0 && section.length > 0 && section.sourceOffset + section.length <= this.data.length);
  }

  private isTwlExtended(): boolean {
    return (this.data[0x12] ?? 0) === 2 && readU32(this.data, 0x210) > 0;
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
