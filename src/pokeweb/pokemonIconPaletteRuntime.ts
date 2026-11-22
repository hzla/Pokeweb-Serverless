import { readU32 } from "../nds/binary";

export const ICON_PALETTE_RELOCATION_HEADER_SIZE = 16;
export const ICON_PALETTE_RELOCATION_MAGIC = Uint8Array.of(0x50, 0x57, 0x49, 0x43, 0x4f, 0x4e, 0x50, 0x4c);
export const WHITE_2_ICON_PALETTE_POINTER_OFFSET = 0x1d0e8;

export function readRelocatedIconPalette(arm9: Uint8Array, ramAddress: number, pointerOffset: number) {
  const offset = readU32(arm9, pointerOffset) - ramAddress;
  const markerOffset = offset - ICON_PALETTE_RELOCATION_HEADER_SIZE;
  if (markerOffset < 0 || offset > arm9.length ||
      !ICON_PALETTE_RELOCATION_MAGIC.every((byte, i) => arm9[markerOffset + i] === byte) ||
      readU32(arm9, markerOffset + 12) !== pointerOffset) return undefined;
  const capacity = readU32(arm9, markerOffset + 8);
  if (!capacity || offset + capacity > arm9.length) return undefined;
  return { offset, markerOffset, capacity };
}
