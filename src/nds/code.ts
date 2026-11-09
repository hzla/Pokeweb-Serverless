import { readAscii, readU32, writeU32 } from "./binary";
import { compressCode, decompressCode, isCodeCompressed } from "./codeCompression";

/** Pack RAM overlays and restore raw VRAM images without changing loaded bytes. */
export function recompressOverlayFiles(
  tableData: Uint8Array,
  fileCallback: (overlayId: number, fileId: number) => Uint8Array | undefined,
  excludedOverlayIds: ReadonlySet<number> = new Set(),
): { table: Uint8Array; files: Map<number, Uint8Array> } {
  const table = tableData.slice(), files = new Map<number, Uint8Array>();
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    const overlayId = readU32(table, offset), metadata = readU32(table, offset + 28);
    if (excludedOverlayIds.has(overlayId)) continue;
    const ramAddress = readU32(table, offset + 4), ramSize = readU32(table, offset + 8);
    // The backwards byte-copy decompressor cannot write VRAM. BW2's battle
    // overlay 169 executes there; compressing it corrupts code at battle start.
    // Also repair exports that already contain a compressed VRAM overlay.
    if (ramAddress >= 0x06000000 && ramAddress < 0x07000000) {
      if (metadata & 0x01000000) {
        const fileId = readU32(table, offset + 24), data = fileCallback(overlayId, fileId);
        if (!data) throw new Error(`Missing compressed VRAM overlay ${overlayId}.`);
        const decoded = decompressCode(data);
        if (!isCodeCompressed(data) || decoded.length !== ramSize)
          throw new Error(`Could not safely decompress VRAM overlay ${overlayId}.`);
        files.set(fileId, decoded);
        writeU32(table, offset + 28, metadata & 0xfe000000);
      }
      continue;
    }
    // Preserve signed images: recompressing them has not been validated against
    // the game loader and can prevent PMC-patched ROMs from booting.
    if ((metadata >>> 24) & 3) continue;
    const fileId = readU32(table, offset + 24), data = fileCallback(overlayId, fileId);
    // PMC's RPM image must match its named filesystem copy and stay raw.
    if (!data || data.length < 8 || data.length !== readU32(table, offset + 8) || readAscii(data, 0, 4) === "RPM0") continue;
    const compressed = compressCode(data);
    // Incompressible images use a raw wrapper; retain their original bytes.
    if (compressed.length >= data.length || !isCodeCompressed(compressed)) continue;
    const decoded = decompressCode(compressed);
    if (compressed.length > 0xffffff || decoded.length !== data.length || decoded.some((byte, i) => byte !== data[i]))
      throw new Error(`Could not safely recompress overlay ${overlayId}.`);
    files.set(fileId, compressed);
    writeU32(table, offset + 28, compressed.length | (metadata & 0xff000000) | 0x01000000);
  }
  return { table, files };
}

export class Overlay {
  data: Uint8Array;
  ramAddress: number;
  ramSize: number;
  bssSize: number;
  staticInitStart: number;
  staticInitEnd: number;
  fileId: number;
  compressedSize: number;
  flags: number;

  constructor(
    fileData: Uint8Array,
    ramAddress: number,
    ramSize: number,
    bssSize: number,
    staticInitStart: number,
    staticInitEnd: number,
    fileId: number,
    compressedSize: number,
    flags: number,
  ) {
    this.ramAddress = ramAddress;
    this.ramSize = ramSize;
    this.bssSize = bssSize;
    this.staticInitStart = staticInitStart;
    this.staticInitEnd = staticInitEnd;
    this.fileId = fileId;
    this.compressedSize = compressedSize;
    this.flags = flags;
    const decoded = this.compressed ? decompressCode(fileData) : fileData;
    // Decompression can return its input (or a view) for passthrough data.
    // Editable overlays must never borrow a read-only ROM file's backing buffer.
    this.data = decoded.buffer === fileData.buffer ? decoded.slice() : decoded;
  }

  get compressed(): boolean {
    return (this.flags & 1) !== 0;
  }
}

export function loadOverlayTable(
  tableData: Uint8Array,
  fileCallback: (overlayId: number, fileId: number) => Uint8Array,
  idsToLoad?: Set<number>,
): Map<number, Overlay> {
  const overlays = new Map<number, Overlay>();
  for (let offset = 0; offset + 32 <= tableData.length; offset += 32) {
    const overlayId = readU32(tableData, offset);
    if (idsToLoad && !idsToLoad.has(overlayId)) continue;

    const ramAddress = readU32(tableData, offset + 4);
    const ramSize = readU32(tableData, offset + 8);
    const bssSize = readU32(tableData, offset + 12);
    const staticInitStart = readU32(tableData, offset + 16);
    const staticInitEnd = readU32(tableData, offset + 20);
    const fileId = readU32(tableData, offset + 24);
    const compressedSizeFlags = readU32(tableData, offset + 28);

    overlays.set(
      overlayId,
      new Overlay(
        fileCallback(overlayId, fileId),
        ramAddress,
        ramSize,
        bssSize,
        staticInitStart,
        staticInitEnd,
        fileId,
        compressedSizeFlags & 0x00ffffff,
        compressedSizeFlags >>> 24,
      ),
    );
  }
  return overlays;
}
