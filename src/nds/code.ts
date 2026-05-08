import { readU32 } from "./binary";
import { decompressCode } from "./codeCompression";

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
    this.data = this.compressed ? decompressCode(fileData) : fileData.slice();
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
