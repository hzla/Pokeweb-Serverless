import { ByteLike, asUint8Array, readAscii, readU16, readU32, writeU16, writeU32 } from "./binary";
import { Folder, addFilePath, cloneFolder, loadFnt, saveFnt, shiftFileIdsAtOrAfter } from "./fnt";
import { Overlay, loadOverlayTable } from "./code";
import { planDsiDigest, readDsiDigestSource, writeDsiDigest, type DsiDigestSource } from "./dsiDigest";
import { damagedDsiExportWarning, type DsiExportWarning } from "./dsiWarning";
import { validateDsRomSections } from "./romValidation";

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
  /** Automatically preserve DSi support when source metadata exists; false explicitly opts out. */
  forDsi?: boolean;
  /** Omit TWL programs and clear their header metadata for a DS-only build. */
  stripDsi?: boolean;
  /** Permit a warned DS-mode export when the input's DSi data is damaged or missing. */
  allowDamagedDsi?: boolean;
  onWarning?: (warning: DsiExportWarning) => void;
  arm9?: Uint8Array;
  arm9OverlayTable?: Uint8Array;
  arm7OverlayTable?: Uint8Array;
  filenames?: Folder;
  files?: Map<number, Uint8Array>;
  insertedFiles?: Array<{ fileId: number; path?: string; bytes: Uint8Array }>;
  addedFiles?: Array<{ path: string; bytes: Uint8Array }>;
  /** File IDs to place first; other files retain their incoming physical order. IDs never change. */
  priorityFileIds?: number[];
  /** Keep retail program and overlay offsets when only existing data files change. */
  preserveDataLayout?: boolean;
  /** Reuse native US Black 2 and White 2 program and overlay positions across PMC rebuilds. */
  preserveBw2PmcLayout?: boolean;
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

    // Buffer.slice() borrows memory. Own editable sections for every ByteLike input.
    const copy = (start: number, end: number) => new Uint8Array(this.data.subarray(start, end));
    this.arm9 = copy(arm9Offset, arm9Offset + arm9Length);
    this.arm7 = copy(arm7Offset, arm7Offset + arm7Length);
    this.arm9OverlayTable = copy(arm9OverlayOffset, arm9OverlayOffset + arm9OverlayLength);
    this.arm7OverlayTable = copy(arm7OverlayOffset, arm7OverlayOffset + arm7OverlayLength);
    this.fntData = copy(fntOffset, fntOffset + fntLength);
    this.filenames = fntLength > 0 ? loadFnt(this.fntData) : new Folder();
    this.banner = bannerOffset > 0 ? copy(bannerOffset, bannerOffset + bannerLength(this.data, bannerOffset)) : new Uint8Array();

    this.files = [];
    for (let offset = fatOffset; offset + 8 <= fatOffset + fatLength; offset += 8) {
      const start = readU32(this.data, offset);
      const end = readU32(this.data, offset + 4);
      this.files.push(options.fileData === "view" ? this.data.subarray(start, end) : copy(start, end));
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

  hasRetailOverlayLayout(): boolean {
    if (!/^(IRA|IRB|IRD|IRE)/u.test(this.idCode) || this.data[0x12] !== 2
      || readU32(this.data, 0x20) !== 0x4000 || this.arm7OverlayTable.length !== 0) return false;
    const count = /^(IRD|IRE)/u.test(this.idCode) ? 344 : 237;
    if (this.arm9OverlayTable.length !== count * 32 || this.filenames.firstId !== count) return false;
    const afterArm9 = readU32(this.data, 0x20) + this.arm9.length;
    const arm7At = readU32(this.data, 0x30), fatAt = readU32(this.data, 0x48);
    // Retail AP patches can address overlay bytes by absolute ROM offset.
    // The general writer puts these same overlays after ARM7.
    for (let id = 0; id < count; id += 1) {
      const row = id * 32, slot = fatAt + id * 8;
      const start = readU32(this.data, slot), end = readU32(this.data, slot + 4);
      if (readU32(this.arm9OverlayTable, row) !== id || readU32(this.arm9OverlayTable, row + 24) !== id
        || start < afterArm9 || end <= start || end > arm7At) return false;
    }
    return true;
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
    if (options.stripDsi && options.forDsi === true) throw Error("A DS-only export cannot rebuild DSi support.");
    let twlSections = options.stripDsi ? [] : this.twlSections();
    const hasDigestMetadata = this.isTwlExtended()
      && (readU32(this.data, 0x1cc) > 0 || readU32(this.data, 0x1dc) > 0)
      && this.hasTwlDigestMetadata();
    const rebuildDsi = !options.stripDsi && (options.forDsi ?? hasDigestMetadata);
    let digestSource: DsiDigestSource | undefined;
    let damagedDsi = false;
    const allowFallback = !options.stripDsi && options.allowDamagedDsi && options.forDsi !== true && options.forDsi !== false && this.data[0x12] === 2;
    try {
      digestSource = rebuildDsi || allowFallback ? readDsiDigestSource(this.data) : undefined;
      if ((rebuildDsi || allowFallback) && (twlSections.length !== 2 || !digestSource)) {
        throw new Error("Preserving DSi support requires the original ROM's complete DSi programs and integrity tables. Reload the original DSi-enhanced ROM; a DS-only export cannot supply missing DSi data.");
      }
      if (digestSource) validateModcryptAreas(this.data);
    } catch (error) {
      if (!allowFallback) throw error;
      validateDsRomSections(this.data);
      damagedDsi = true;
      twlSections = [];
      digestSource = undefined;
      // A fully cleared TWL payload header is an existing DS-only input.
      // Still validate native files and sanitize the output, but warn only
      // when there is DSi metadata left that could not be preserved.
      if (!this.hasClearedTwlMetadata()) options.onWarning?.(damagedDsiExportWarning(this.data));
    }
    const minimumLength = Math.max(options.preserveOriginalLength ? this.data.length : 0, checkedMinimumLength(options.minimumLength));
    const dataLayout = this.planDataOnlyLayout(options, digestSource);
    const pmcLayout = options.preserveBw2PmcLayout && this.planBw2PmcLayout(
      arm9Bytes, arm9OverlayTableBytes, arm7OverlayTableBytes, files, placementRanks, headerSize,
    );
    const trailingFileOrder = pmcLayout
      ? physicalFileOrder.filter((id) => !pmcLayout.overlayStarts.has(id))
      : physicalFileOrder;

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
    if (dataLayout) {
      plannedCursor = dataLayout.end;
    } else {
      planSection(arm9Bytes.length);
      if (pmcLayout) plannedCursor = pmcLayout.arm7At;
      else planOptionalSection(arm9OverlayTableBytes.length);
      planSection(this.arm7.length);
      planOptionalSection(arm7OverlayTableBytes.length);
      planSection(fntData.length);
      planSection(fatLength);
      planOptionalSection(this.banner.length);
      for (const id of trailingFileOrder) planSection(files[id].length);
    }
    const plannedFileEnd = align(plannedCursor, 4);
    const digestLayout = digestSource ? planDsiDigest(digestSource, plannedFileEnd) : undefined;
    const plannedApplicationEnd = Math.max(digestLayout?.end ?? plannedFileEnd, dataLayout?.previousApplicationEnd ?? 0);
    plannedCursor = plannedApplicationEnd;
    if (twlSections.length > 0) {
      plannedCursor = align(plannedCursor, NTR_TWL_ALIGNMENT);
      if (digestSource) planSection(digestSource.regionSize);
      else for (const section of twlSections) planSection(section.length);
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

    const writeProgramSection = (bytes: Uint8Array, offsetField: number, optional = false) => {
      if (dataLayout) return { offset: readU32(this.data, offsetField), length: bytes.length };
      return optional ? writeOptionalSection(bytes) : writeSection(bytes);
    };
    const arm9 = writeProgramSection(arm9Bytes, 0x20);
    if (pmcLayout) cursor = pmcLayout.tableAt;
    const arm9OverlayTable = writeProgramSection(arm9OverlayTableBytes, 0x50, true);
    if (pmcLayout) cursor = pmcLayout.arm7At;
    const arm7 = writeProgramSection(this.arm7, 0x30);
    const arm7OverlayTable = writeProgramSection(arm7OverlayTableBytes, 0x58, true);
    const fnt = writeProgramSection(fntData, 0x40);
    const fatOffset = dataLayout ? readU32(this.data, 0x48) : align(cursor, 0x200);
    if (!dataLayout) cursor = checkedAdd(fatOffset, fatLength);
    const banner = writeProgramSection(this.banner, 0x68, true);

    const writeFileAt = (id: number, start: number, file: Uint8Array) => {
      writer.writeAt(start, file);
      writeU32(writer.buffer, fatOffset + id * 8, start);
      writeU32(writer.buffer, fatOffset + id * 8 + 4, start + file.length);
    };
    if (dataLayout) {
      writer.writeAt(0, this.data.subarray(0, dataLayout.sourceEnd));
      for (const { id, start, bytes } of dataLayout.replacements) writeFileAt(id, start, bytes);
      cursor = dataLayout.end;
    } else {
      if (pmcLayout) {
        for (const [id, start] of pmcLayout.overlayStarts) writeFileAt(id, start, files[id]);
      }
      for (const id of trailingFileOrder) {
        const start = align(cursor, 0x200);
        writeFileAt(id, start, files[id]);
        cursor = checkedAdd(start, files[id].length);
      }
    }

    const fileEnd = align(cursor, 4);
    const applicationEnd = Math.max(digestLayout?.end ?? fileEnd, dataLayout?.previousApplicationEnd ?? 0);
    cursor = applicationEnd;
    const twlSectionWrites: Array<{ offsetField: number; offset: number }> = [];
    let twlRegionStart = 0;
    if (twlSections.length > 0) {
      // NDSRegionEnd / DSiRegionStart use 512 KiB units. Retail TWL-aware
      // FS rejects NTR-mode opens at or beyond DSiRegionStart, even when FAT
      // and the overall ROM size are correct. Growing a file (notably SDAT)
      // must move this boundary along with all of the NitroFS data.
      cursor = align(cursor, NTR_TWL_ALIGNMENT);
      twlRegionStart = cursor;
      if (digestSource) {
        // Preserve the complete TWL span: its native digest hashes plaintext
        // code, and includes padding between/after the encrypted binaries.
        writer.writeAt(cursor, this.data.subarray(digestSource.regionStart, digestSource.regionStart + digestSource.regionSize));
        for (const section of twlSections) {
          twlSectionWrites.push({ offsetField: section.offsetField, offset: cursor + section.sourceOffset - digestSource.regionStart });
        }
        cursor = checkedAdd(cursor, digestSource.regionSize);
      } else {
        for (const section of twlSections) {
          cursor = align(cursor, 0x200);
          const offset = cursor;
          writer.writeAt(offset, this.data.subarray(section.sourceOffset, section.sourceOffset + section.length));
          cursor = checkedAdd(cursor, section.length);
          twlSectionWrites.push({ offsetField: section.offsetField, offset });
        }
      }
    }

    const compactRomLength = align(cursor, 4);
    const romLength = Math.max(compactRomLength, align(minimumLength, 4));
    if (fileEnd !== plannedFileEnd || applicationEnd !== plannedApplicationEnd || romLength !== plannedRomLength) {
      throw new Error("Internal ROM layout planning mismatch");
    }
    const out = writer.trim(romLength);
    if (options.preserveOriginalLength && romLength > compactRomLength) out.fill(0xff, compactRomLength, romLength);
    if (damagedDsi || options.stripDsi) {
      // Do not publish dangling binary, digest or encryption offsets. Keep
      // the native DS header and TWL memory mapping for later donor repair.
      out.fill(0, 0x1c0, 0x208);
      out.fill(0, 0x210, 0x214);
      out.fill(0, 0x220, 0x230);
      out.fill(0, 0x328, 0x33c);
      out[0x1c] &= ~6;
    }

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
    if (this.data[0x12] === 2) {
      // DSi-enhanced games enforce this boundary even in DS mode with their
      // DSi payloads stripped (including a cleared total-size field at 0x210).
      // Cover all rebuilt NitroFS data, not optional trailing ROM padding.
      // Keep this independent of relocating or synthesizing DSi payloads.
      const regionBoundary = Math.ceil(applicationEnd / NTR_TWL_ALIGNMENT);
      writeU16(out, 0x90, regionBoundary);
      writeU16(out, 0x92, regionBoundary);
    }
    if (twlSections.length > 0) {
      for (const section of twlSectionWrites) {
        writeU32(out, section.offsetField, section.offset);
      }
      writeU32(out, 0x210, romLength);
      relocateModcryptAreas(this.data, out);
      if (digestSource && digestLayout) writeDsiDigest(out, digestSource, digestLayout, twlRegionStart);
    }
    out[0x14] = romDeviceCapacityByte(romLength, this.data[0x14] ?? 0);

    // The retail field describes cartridge data. Keep it when the secure
    // area is unchanged, including on dumps that store decrypted bytes.
    if (!dataLayout && arm9.offset < 0x8000 && out.length >= 0x8000) writeU16(out, 0x6c, crc16(out.subarray(arm9.offset, 0x8000)));
    writeU16(out, 0x15c, crc16(out.subarray(0xc0, 0xc0 + 156)));
    writeU16(out, 0x15e, crc16(out.subarray(0, 0x15e)));
    return out;
  }

  private planBw2PmcLayout(
    arm9: Uint8Array, table: Uint8Array, arm7Table: Uint8Array,
    files: Uint8Array[], originalStarts: number[], headerSize: number,
  ) {
    const nativeCount = 344, rowSize = 32;
    const pmcRow = nativeCount * rowSize, pmcTableLength = pmcRow + rowSize;
    if ((this.idCode !== "IREO" && this.idCode !== "IRDO") || this.data[0x12] !== 2 || this.data[0x1e] !== 0
      || headerSize !== 0x4000 || readU32(this.data, 0x20) !== 0x4000 || this.arm9RamAddress !== 0x02004000
      || this.arm7OverlayTable.length !== 0 || arm7Table.length !== 0
      || table.length !== pmcTableLength
      || (this.arm9OverlayTable.length !== pmcRow && this.arm9OverlayTable.length !== pmcTableLength)) return undefined;
    const pmc = files[readU32(table, pmcRow + 24)];
    if (readU32(table, pmcRow) !== nativeCount || !pmc || readAscii(pmc, 0, 4) !== "RPM0"
      || readU32(table, pmcRow + 8) !== pmc.length) return undefined;

    const oldTableAt = readU32(this.data, 0x50), oldArm7At = readU32(this.data, 0x30);
    if (oldTableAt < headerSize + this.arm9.length || oldArm7At + this.arm7.length > this.data.length
      || oldTableAt % 0x200 || oldArm7At % 0x200) return undefined;
    const overlays = Array.from({ length: nativeCount }, (_, id) => ({ id, start: originalStarts[id] }))
      .sort((a, b) => a.start - b.start);
    const overlayStarts = new Map<number, number>();
    const moved: number[] = [];
    const tableAt = Math.max(oldTableAt, align(headerSize + arm9.length, 0x200));
    let originalEnd = oldTableAt + this.arm9OverlayTable.length;
    let end = tableAt + table.length;
    // Retain each fitting native overlay's FAT position even if ARM9 or the
    // larger table pushes an early overlay out of its original slot.
    for (const [index, { id, start }] of overlays.entries()) {
      const row = id * rowSize;
      if (readU32(this.arm9OverlayTable, row) !== id || readU32(this.arm9OverlayTable, row + 24) !== id
        || readU32(table, row) !== id || readU32(table, row + 24) !== id
        || !this.files[id]?.length || !files[id]?.length || start < originalEnd) return undefined;
      originalEnd = start + this.files[id].length;
      const nextStart = overlays[index + 1]?.start ?? oldArm7At;
      if (originalEnd > nextStart) return undefined;
      if (start < end || start + files[id].length > nextStart) {
        moved.push(id);
      } else {
        overlayStarts.set(id, start);
        end = start + files[id].length;
      }
    }
    // Without a surviving native position, use the regular repacker.
    if (!overlayStarts.size) return undefined;
    for (const id of moved) {
      const start = align(end, 0x200);
      overlayStarts.set(id, start);
      end = start + files[id].length;
    }
    return { tableAt, overlayStarts, arm7At: Math.max(oldArm7At, align(end, 0x200)) };
  }

  private planDataOnlyLayout(options: RomSaveOptions, digest: DsiDigestSource | undefined) {
    if (!options.preserveDataLayout || options.forDsi === false || options.stripDsi || options.arm9 || options.arm9OverlayTable
      || options.arm7OverlayTable || options.filenames || options.alignFntFirstFileToArm9OverlayCount
      || options.insertedFiles?.length || options.addedFiles?.length || options.priorityFileIds?.length
      || !this.hasRetailOverlayLayout()) return undefined;
    try {
      validateDsRomSections(this.data);
    } catch {
      return undefined;
    }

    const sections = [
      [0x20, this.arm9], [0x30, this.arm7], [0x40, this.fntData],
      [0x50, this.arm9OverlayTable], [0x58, this.arm7OverlayTable], [0x68, this.banner],
    ] as const;
    const fatAt = readU32(this.data, 0x48), fatSize = readU32(this.data, 0x4c);
    if (this.files.length * 8 !== fatSize) return undefined;
    const spans = [{ start: fatAt, end: fatAt + fatSize }];
    for (const [field, bytes] of sections) {
      if (bytes.length === 0) continue;
      const start = readU32(this.data, field);
      if (!bytes.every((byte, index) => this.data[start + index] === byte)) return undefined;
      spans.push({ start, end: start + bytes.length });
    }
    let fileEnd = 0;
    for (let id = 0; id < this.files.length; id += 1) {
      const slot = fatAt + id * 8, file = this.files[id];
      const start = readU32(this.data, slot), end = readU32(this.data, slot + 4);
      const sourceView = file.buffer === this.data.buffer && file.byteOffset === this.data.byteOffset + start;
      if (file.length !== end - start || (!sourceView && !file.every((byte, index) => this.data[start + index] === byte))) return undefined;
      fileEnd = Math.max(fileEnd, end);
      if (start !== end) spans.push({ start, end });
    }
    spans.sort((a, b) => a.start - b.start);
    if (spans.some((span, index) => index > 0 && span.start < spans[index - 1].end)) return undefined;
    const sourceEnd = Math.max(fileEnd, spans.at(-1)!.end, digest ? digest.ntrStart + readU32(this.data, 0x1e4) : 0);
    if (digest && sourceEnd > digest.regionStart) return undefined;
    const replacements: Array<{ id: number; start: number; bytes: Uint8Array }> = [];
    let end = sourceEnd;
    for (const [id, bytes] of options.files ?? []) {
      // A FAT slot before the first named file can contain executable code.
      if (!Number.isInteger(id) || id < this.filenames.firstId || id >= this.files.length) return undefined;
      const originalStart = readU32(this.data, fatAt + id * 8);
      const grows = bytes.length > this.files[id].length;
      // Appending a larger data file avoids shifting the files after its slot.
      const start = grows ? align(end, 0x200) : originalStart;
      if (grows) end = checkedAdd(start, bytes.length);
      replacements.push({ id, start, bytes });
    }
    const previousEnd = readU32(this.data, 0x80);
    const previousApplicationEnd = digest && previousEnd <= digest.regionStart ? previousEnd : 0;
    return { sourceEnd, end, replacements, previousApplicationEnd };
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
    // DS-only hacks can retain garbage NTR digest fields after stripping the
    // extended header. Recognize an optional zero total-size field only when
    // the header actually declares digest tables, not just NTR region bytes.
    const declaresDigestTables = [0x1f0, 0x1f4, 0x1f8, 0x1fc].some((field) => readU32(this.data, field) !== 0);
    return (this.data[0x12] ?? 0) === 2 && (readU32(this.data, 0x210) > 0 || declaresDigestTables);
  }

  private hasTwlDigestMetadata(): boolean {
    for (let field = 0x1e0; field <= 0x204; field += 4) {
      if (readU32(this.data, field) !== 0) return true;
    }
    return false;
  }

  private hasClearedTwlMetadata(): boolean {
    for (let field = 0x1c0; field <= 0x204; field += 4) {
      if (readU32(this.data, field) !== 0) return false;
    }
    return [0x210, 0x220, 0x224, 0x228, 0x22c].every(field => readU32(this.data, field) === 0);
  }
}

function relocateModcryptAreas(source: Uint8Array, out: Uint8Array): void {
  if (!(source[0x1c] & 2)) return;

  // Modcrypt ranges are ROM offsets, independently of the ARM9i/ARM7i
  // offsets. Keep their encrypted bytes and key/IV metadata intact, but move
  // the ranges with the code so a DSi loader can find and decrypt them.
  const binaries = [
    { offset: 0x20, size: 0x2c }, { offset: 0x30, size: 0x3c },
    { offset: 0x1c0, size: 0x1cc }, { offset: 0x1d0, size: 0x1dc },
  ];
  for (const [index, field] of [0x220, 0x228].entries()) {
    const start = readU32(source, field), size = readU32(source, field + 4);
    if (!start || !size) continue;
    const binary = binaries.find(({ offset, size: sizeField }) => {
      const base = readU32(source, offset), length = readU32(source, sizeField);
      return base > 0 && base + length <= source.length && start >= base && start + size <= base + length;
    });
    if (!binary) {
      throw new Error(`Cannot relocate DSi modcrypt area ${index + 1}: its encryption range is outside a preserved code section. Load the original ROM; an earlier export may have stale encryption offsets.`);
    }
    const relative = start - readU32(source, binary.offset);
    const destination = readU32(out, binary.offset);
    if (!destination || relative + size > readU32(out, binary.size) || destination + relative + size > out.length) {
      throw new Error(`Cannot relocate DSi modcrypt area ${index + 1}: its encrypted code section was removed or shortened.`);
    }
    writeU32(out, field, destination + relative);
  }
}

function validateModcryptAreas(source: Uint8Array): void {
  if (!(source[0x1c] & 2)) return;
  for (const field of [0x220, 0x228]) {
    const start = readU32(source, field), size = readU32(source, field + 4);
    if (!start && !size) continue;
    const contained = [[0x20, 0x2c], [0x30, 0x3c], [0x1c0, 0x1cc], [0x1d0, 0x1dc]].some(([offset, sizeField]) => {
      const base = readU32(source, offset), length = readU32(source, sizeField);
      return start > 0 && size > 0 && base > 0 && base + length <= source.length && start >= base && start + size <= base + length;
    });
    if (!contained) throw new Error("Cannot preserve DSi support: a modcrypt encryption range is outside its code section. An earlier exporter may have left stale DSi offsets.");
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
