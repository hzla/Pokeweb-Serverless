export type ByteLike = Uint8Array | ArrayBuffer;

export function asUint8Array(data: ByteLike): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function slice(data: Uint8Array, start: number, end?: number): Uint8Array {
  return data.subarray(start, end);
}

export function readU8(data: Uint8Array, offset: number): number {
  return data[offset] ?? 0;
}

export function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

export function readU32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

export function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

export function writeU8(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
}

export function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

export function readAscii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function pad4(bytes: Uint8Array, padByte = 0): Uint8Array {
  if (bytes.length % 4 === 0) return bytes;
  const out = new Uint8Array(bytes.length + (4 - (bytes.length % 4)));
  out.set(bytes);
  out.fill(padByte, bytes.length);
  return out;
}
