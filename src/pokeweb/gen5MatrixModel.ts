import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { RawRecord } from "./projectStore";

export const GEN5_MATRIX_EMPTY = 0xffffffff;
export const MATRIX_EDITOR_CELL_LIMIT = 900;

/** Gen 5 stores a map table followed by an optional, equally sized header table. */
export function parseGen5MatrixFile(bytes: Uint8Array): RawRecord {
  if (bytes.length < 8) throw new Error("Map matrix is too small.");
  const flags = readU32(bytes, 0), width = readU16(bytes, 4), height = readU16(bytes, 6);
  if (flags !== 0 && flags !== 1) throw new Error(`Unsupported map matrix header-table flag: ${flags}.`);
  if (!width || !height) throw new Error("Map matrix dimensions must be positive.");
  const count = width * height, payloadLength = 8 + count * (flags ? 8 : 4);
  if (payloadLength > bytes.length) throw new Error("Map matrix tables are truncated.");
  const raw: RawRecord = { width, height, matrix_flags: flags, footer_length: bytes.length - payloadLength };
  for (let i = 0; i < count; i++) raw[`map_${i}`] = readU32(bytes, 8 + i * 4);
  if (flags) for (let i = 0; i < count; i++) raw[`header_${i}`] = readU32(bytes, 8 + count * 4 + i * 4);
  return raw;
}

export function materializeGen5MatrixFile(raw: RawRecord, original: Uint8Array): Uint8Array {
  const { width, height, matrix_flags: flags } = raw;
  if (!Number.isInteger(width) || width < 1 || width > 65535 || !Number.isInteger(height) || height < 1 || height > 65535)
    throw new Error("Map matrix dimensions must be whole numbers from 1 to 65535.");
  if (flags !== 0 && flags !== 1) throw new Error("Invalid map matrix header-table flag.");
  const count = width * height, payloadLength = 8 + count * (flags ? 8 : 4);
  const footerLength = raw.footer_length ?? 0;
  if (!Number.isInteger(footerLength) || footerLength < 0 || footerLength > original.length)
    throw new Error("Invalid map matrix trailing data length.");
  // Check all cells before allocating output or writing any part of the store.
  for (let i = 0; i < count; i++) {
    validateU32(raw[`map_${i}`]);
    if (flags) validateU32(raw[`header_${i}`]);
  }
  const out = new Uint8Array(payloadLength + footerLength);
  writeU32(out, 0, flags); writeU16(out, 4, width); writeU16(out, 6, height);
  for (let i = 0; i < count; i++) writeU32(out, 8 + i * 4, raw[`map_${i}`]);
  if (flags) for (let i = 0; i < count; i++) writeU32(out, 8 + count * 4 + i * 4, raw[`header_${i}`]);
  if (footerLength) out.set(original.subarray(original.length - footerLength), payloadLength);
  return out;
}

function validateU32(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > GEN5_MATRIX_EMPTY) throw new Error("Invalid or missing map matrix cell value.");
}
