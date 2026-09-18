import { ByteLike, asUint8Array, readAscii, readU16, readU32, writeU16, writeU32 } from "./binary";
import { Folder, addFilePath, cloneFolder, loadFnt, saveFnt, shiftFileIdsAtOrAfter } from "./fnt";
import { Overlay, loadOverlayTable } from "./code";

const NTR_TWL_ALIGNMENT = 0x80000;
const STANDARD_DS_ROM_LIMIT = 0x20000000;
const MAX_SUPPORTED_ROM_SIZE = 0x7fffffff;
const OVERSIZE_DEVICE_CAPACITY = 0x0e;

export type RomReadOptions = {
  /**
   * "view" borrows NitroFS file bytes from the input. Treat these files as
   * read-only and copy any that enter editable or long-lived project state.
   * Code sections and overlay tables remain independently owned in both modes.
   */
  fileData?: "copy" | "view";
};

export type RomSaveOptions = {
  arm9?: Uint8Array;
  arm9OverlayTable?: Uint8Array;
  arm7OverlayTable?: Uint8Array;
  filenames?: Folder;
  files?: Map<number, Uint8Array>;
  insertedFiles?: Array<{ fileId: number; path?: string; bytes: Uint8Array }>;
  addedFiles?: Array<{ path: string; bytes: Uint8Array }>;
  /** File IDs to place first; other files retain their incoming physical order. IDs never change. */
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

  constructor(data: ByteLike, options: RomReadOptions = {}) {
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
      this.files.push(options.fileData === "view" ? this.data.subarray(start, end) : this.data.slice(start, end));
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
    // A second rebuild (Test Warp/Battle, for example) must not undo a prior
    // export's early PMC placement by writing everything in logical ID order.
    // Keep ranks paired with file bytes as insertions shift their logical IDs.
    const sourceFatOffset = readU32(this.data, 0x48);
    const sourceFileCount = Math.floor(readU32(this.data, 0x4c) / 8);
    const placementRanks = files.map((_file, id) => id < sourceFileCount
      ? readU32(this.data, sourceFatOffset + id * 8)
      : Number.MAX_SAFE_INTEGER);
    const arm9OverlayTableBytes = options.arm9OverlayTable ?? this.arm9OverlayTable;
    let filenames = options.filenames ?? this.filenames;
    let fntData = this.fntData;
    let shouldRewriteFnt = options.filenames !== undefined;
    if (options.insertedFiles && options.insertedFiles.length > 0) {
      for (const file of [...options.insertedFiles].sort((a, b) => a.fileId - b.fileId)) {
        if (!Number.isInteger(file.fileId) || file.fileId < 0 || file.fileId > files.length) throw new Error(`Invalid inserted file ID: ${file.fileId}`);
        filenames = shiftFileIdsAtOrAfter(filenames, file.fileId, 1);
        files.splice(file.fileId, 0, file.bytes);
        placementRanks.splice(file.fileId, 0, Number.MAX_SAFE_INTEGER);
        if (file.path) filenames = addFilePath(filenames, file.path, file.fileId);
      }
      shouldRewriteFnt = true;
    }
    if (options.alignFntFirstFileToArm9OverlayCount) {
      const overlayCount = arm9OverlayTableBytes.length / 32;
      if (Number.isInteger(overlayCount) && (filenames.firstId !== overlayCount || filenames.files.length > 0)) {
        filenames = cloneFolder(filenames);
        // Frost treats the overlay-table row count as the first NitroFS file
        // ID. Appended overlays break that assumption, while retaining root
        // filenames at the adjusted base creates duplicate FNT IDs. The files
        // remain in FAT unchanged; only the legacy root labels become
        // nameless so all nested paths keep their real IDs.
        filenames.files = [];
        filenames.firstId = overlayCount;
        shouldRewriteFnt = true;
      }
    }
    if (options.addedFiles && options.addedFiles.length > 0) {
      for (const file of options.addedFiles) {
        filenames = addFilePath(filenames, file.path, files.length);
        files.push(file.bytes);
        placementRanks.push(Number.MAX_SAFE_INTEGER);
      }
      shouldRewriteFnt = true;
    }
    if (shouldRewriteFnt) {
      fntData = saveFnt(filenames);
    }
    const arm9Bytes = options.arm9 ?? this.arm9;
    const arm7OverlayTableBytes = options.arm7OverlayTable ?? this.arm7OverlayTable;
    const headerSize = Math.max(readU32(this.data, 0x84) || 0x4000, 0x200);
    const fatLength = files.length * 8;
    const priorityFileIds = [...new Set(options.priorityFileIds ?? [])];
    for (const id of priorityFileIds) {
      if (!Number.isInteger(id) || id < 0 || id >= files.length) throw new Error(`Invalid priority file ID: ${id}`);
    }
    const prioritySet = new Set(priorityFileIds);
    const physicalFileOrder = [
      ...priorityFileIds,
      ...files.map((_file, id) => id).filter((id) => !prioritySet.has(id))
        .sort((a, b) => placementRanks[a] - placementRanks[b] || a - b),
    ];
    const twlSections = this.twlSections();
    const minimumLength = Math.max(options.preserveOriginalLength ? this.data.length : 0, checkedMinimumLength(options.minimumLength));

    // Plan the complete layout before allocating. Large exports otherwise
    // force the growable writer to double past the requested size and then
    // copy the entire ROM once more while trimming it.
    let plannedCursor = align(headerSize, 0x200);
    const planSection = (length: number, alignment = 0x200): void => {
      plannedCursor = checkedAdd(align(plannedCursor, alignment), length);
    };
    const planOptionalSection = (length: number, alignment = 0x200): void => {
      if (length > 0) planSection(length, alignment);
    };
    planSection(arm9Bytes.length);
    planOptionalSection(arm9OverlayTableBytes.length);
    planSection(this.arm7.length);
    planOptionalSection(arm7OverlayTableBytes.length);
    planSection(fntData.length);
    planSection(fatLength);
    planOptionalSection(this.banner.length);
    for (const id of physicalFileOrder) planSection(files[id].length);
    const plannedApplicationEnd = align(plannedCursor, 4);
    if (twlSections.length > 0) {
      plannedCursor = align(plannedCursor, NTR_TWL_ALIGNMENT);
      for (const section of twlSections) planSection(section.length);
    }
    const plannedCompactLength = align(plannedCursor, 4);
    const plannedRomLength = Math.max(plannedCompactLength, align(minimumLength, 4));
    assertSupportedRomLength(plannedRomLength);

    const writer = new RomWriter(plannedRomLength);
    writer.writeAt(0, this.data.subarray(0, Math.min(headerSize, this.data.length)));

    let cursor = align(headerSize, 0x200);
    const writeSection = (bytes: Uint8Array, alignment = 0x200): { offset: number; length: number } => {
      cursor = align(cursor, alignment);
      const offset = cursor;
      writer.writeAt(offset, bytes);
      cursor = checkedAdd(cursor, bytes.length);
      return { offset, length: bytes.length };
    };

    const writeOptionalSection = (bytes: Uint8Array, alignment = 0x200): { offset: number; length: number } =>
      bytes.length > 0 ? writeSection(bytes, alignment) : { offset: 0, length: 0 };

    const arm9 = writeSection(arm9Bytes);
    const arm9OverlayTable = writeOptionalSection(arm9OverlayTableBytes);
    const arm7 = writeSection(this.arm7);
    const arm7OverlayTable = writeOptionalSection(arm7OverlayTableBytes);
    const fnt = writeSection(fntData);

    cursor = align(cursor, 0x200);
    const fatOffset = cursor;
    writer.writeAt(fatOffset, new Uint8Array(fatLength));
    cursor = checkedAdd(cursor, fatLength);

    const banner = this.banner.length > 0 ? writeSection(this.banner) : { offset: 0, length: 0 };

    physicalFileOrder.forEach((id) => {
      const file = files[id];
      cursor = align(cursor, 0x200);
      const start = cursor;
      writer.writeAt(start, file);
      cursor = checkedAdd(cursor, file.length);
      writeU32(writer.buffer, fatOffset + id * 8, start);
      writeU32(writer.buffer, fatOffset + id * 8 + 4, cursor);
    });

    const applicationEnd = align(cursor, 4);
    const twlSectionWrites: Array<{ offsetField: number; offset: number }> = [];
    if (twlSections.length > 0) {
      // NDSRegionEnd / DSiRegionStart use 512 KiB units. Retail TWL-aware
      // FS rejects NTR-mode opens at or beyond DSiRegionStart, even when FAT
      // and the overall ROM size are correct. Growing a file (notably SDAT)
      // must move this boundary along with all of the NitroFS data.
      cursor = align(cursor, NTR_TWL_ALIGNMENT);
      for (const section of twlSections) {
        cursor = align(cursor, 0x200);
        const offset = cursor;
        writer.writeAt(offset, this.data.subarray(section.sourceOffset, section.sourceOffset + section.length));
        cursor = checkedAdd(cursor, section.length);
        twlSectionWrites.push({ offsetField: section.offsetField, offset });
      }
    }

    const compactRomLength = align(cursor, 4);
    const romLength = Math.max(compactRomLength, align(minimumLength, 4));
    if (applicationEnd !== plannedApplicationEnd || romLength !== plannedRomLength) {
      throw new Error("Internal ROM layout planning mismatch");
    }
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
      const regionBoundary = Math.ceil(applicationEnd / NTR_TWL_ALIGNMENT);
      writeU16(out, 0x90, regionBoundary);
      writeU16(out, 0x92, regionBoundary);
      for (const section of twlSectionWrites) {
        writeU32(out, section.offsetField, section.offset);
      }
      writeU32(out, 0x210, romLength);
    }
    out[0x14] = romDeviceCapacityByte(romLength, this.data[0x14] ?? 0);

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
    try {
      this.buffer = new Uint8Array(size);
    } catch (error) {
      throw new Error(`Unable to allocate the ${formatByteSize(size)} ROM export buffer. Close other tabs or export on a device with more available memory.`, { cause: error });
    }
  }

  writeAt(offset: number, bytes: Uint8Array): void {
    this.ensure(offset + bytes.length);
    this.buffer.set(bytes, offset);
  }

  trim(length: number): Uint8Array {
    this.ensure(length);
    return length === this.buffer.length ? this.buffer : this.buffer.slice(0, length);
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
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(alignment) || alignment <= 0) {
    throw new Error(`Cannot align invalid ROM layout value ${value} to ${alignment}`);
  }
  return Math.ceil(value / alignment) * alignment;
}

function bannerLength(data: Uint8Array, offset: number): number {
  const version = readU16(data, offset);
  if (version === 0x103) return 0x23c0;
  if (version >= 3) return 0x1240;
  if (version === 2) return 0x940;
  return 0x840;
}

export function romDeviceCapacityByte(romLength: number, minimum: number): number {
  assertSupportedRomLength(romLength);
  if (romLength > STANDARD_DS_ROM_LIMIT) return Math.max(minimum, OVERSIZE_DEVICE_CAPACITY);
  let value = 0;
  let capacity = 128 * 1024;
  while (capacity < romLength && value < 255) {
    value += 1;
    capacity *= 2;
  }
  return Math.max(minimum, value);
}

function checkedMinimumLength(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid minimum ROM length: ${value}`);
  assertSupportedRomLength(value);
  return value;
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("ROM layout exceeds JavaScript's safe integer range");
  assertSupportedRomLength(result);
  return result;
}

function assertSupportedRomLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SUPPORTED_ROM_SIZE) {
    throw new Error(`ROM export size ${formatByteSize(length)} reaches or exceeds the supported signed 2 GiB limit`);
  }
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return String(bytes);
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
