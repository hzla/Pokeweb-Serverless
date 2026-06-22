import type { RawRecord } from "./projectStore";

export const GEN4_MATRIX_EMPTY = 0xffff;

const HEADER_BYTES = 5;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function parseGen4MatrixFile(bytes: Uint8Array): RawRecord {
  if (bytes.length < HEADER_BYTES) throw new Error("Gen 4 matrix file is too small");
  const width = bytes[0] ?? 0;
  const height = bytes[1] ?? 0;
  const count = width * height;
  const raw: RawRecord = {
    byteLength: bytes.length,
    width,
    height,
    has_headers_section: bytes[2] ? 1 : 0,
    has_heights_section: bytes[3] ? 1 : 0,
    name_length: bytes[4] ?? 0,
  };
  let offset = HEADER_BYTES;
  for (let index = 0; index < raw.name_length && offset < bytes.length; index += 1) raw[`name_byte_${index}`] = bytes[offset++];

  if (raw.has_headers_section) {
    for (let index = 0; index < count && offset + 2 <= bytes.length; index += 1) {
      raw[`header_${index}`] = readU16(bytes, offset);
      offset += 2;
    }
  }

  if (raw.has_heights_section) {
    for (let index = 0; index < count && offset < bytes.length; index += 1) raw[`altitude_${index}`] = bytes[offset++];
  }

  for (let index = 0; index < count && offset + 2 <= bytes.length; index += 1) {
    raw[`map_${index}`] = readU16(bytes, offset);
    offset += 2;
  }

  raw.footer_length = Math.max(0, bytes.length - offset);
  return raw;
}

export function materializeGen4MatrixFile(raw: RawRecord, original: Uint8Array): Uint8Array {
  const width = clampByte(raw.width ?? 0);
  const height = clampByte(raw.height ?? 0);
  const count = width * height;
  const nameLength = clampByte(raw.name_length ?? 0);
  const hasHeaders = Number(raw.has_headers_section ?? 0) !== 0;
  const hasHeights = Number(raw.has_heights_section ?? 0) !== 0;
  const payloadLength = HEADER_BYTES + nameLength + (hasHeaders ? count * 2 : 0) + (hasHeights ? count : 0) + count * 2;
  const footerLength = Number(raw.footer_length ?? Math.max(0, original.length - payloadLength));
  const footer = footerLength > 0 ? original.subarray(Math.max(0, original.length - footerLength)) : new Uint8Array();
  const out = new Uint8Array(payloadLength + footer.length);
  out[0] = width;
  out[1] = height;
  out[2] = hasHeaders ? 1 : 0;
  out[3] = hasHeights ? 1 : 0;
  out[4] = nameLength;

  let offset = HEADER_BYTES;
  for (let index = 0; index < nameLength; index += 1) out[offset++] = raw[`name_byte_${index}`] ?? 0;

  if (hasHeaders) {
    for (let index = 0; index < count; index += 1) {
      writeU16(out, offset, raw[`header_${index}`] ?? 0);
      offset += 2;
    }
  }

  if (hasHeights) {
    for (let index = 0; index < count; index += 1) out[offset++] = clampByte(raw[`altitude_${index}`] ?? 0);
  }

  for (let index = 0; index < count; index += 1) {
    writeU16(out, offset, raw[`map_${index}`] ?? GEN4_MATRIX_EMPTY);
    offset += 2;
  }

  out.set(footer, offset);
  return out;
}

export function getGen4MatrixName(raw: RawRecord): string {
  const length = Number(raw.name_length ?? 0);
  return textDecoder.decode(Uint8Array.from(Array.from({ length }, (_value, index) => raw[`name_byte_${index}`] ?? 0)));
}

export function setGen4MatrixName(raw: RawRecord, name: string): void {
  const bytes = textEncoder.encode(name);
  raw.name_length = Math.min(bytes.length, 255);
  for (let index = 0; index < raw.name_length; index += 1) raw[`name_byte_${index}`] = bytes[index] ?? 0;
  for (let index = raw.name_length; raw[`name_byte_${index}`] !== undefined; index += 1) delete raw[`name_byte_${index}`];
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = Number(value) & 0xff;
  out[offset + 1] = (Number(value) >>> 8) & 0xff;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Number(value) || 0)) & 0xff;
}
