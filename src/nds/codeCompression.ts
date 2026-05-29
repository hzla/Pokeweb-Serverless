import { readU32 } from "./binary";

function detectAppendedData(data: Uint8Array): number | undefined {
  for (let possible = 0; possible < 0x20; possible += 4) {
    const headerByteIndex = data.length - 5 - possible;
    if (headerByteIndex < 0) return undefined;

    const headerOffset = data.length - possible - 8;
    if (headerOffset < 0) return undefined;
    const compLenHeaderLen = readU32(data, headerOffset);
    const headerLen = compLenHeaderLen >>> 24;
    const compressedLen = compLenHeaderLen & 0x00ffffff;

    if (headerLen < 8) continue;
    if (compressedLen > data.length) continue;

    let paddingOk = true;
    for (let i = data.length - possible - headerLen; i < data.length - possible - 8; i += 1) {
      if (data[i] !== 0xff) {
        paddingOk = false;
        break;
      }
    }
    if (paddingOk) return possible;
  }
  return undefined;
}

export function isCodeCompressed(data: Uint8Array): boolean {
  const appendedAmount = detectAppendedData(data);
  if (appendedAmount === undefined) return false;
  const input = appendedAmount === 0 ? data : data.subarray(0, data.length - appendedAmount);
  return input.length >= 4 && readU32(input, input.length - 4) !== 0;
}

export function decompressCode(data: Uint8Array): Uint8Array {
  const appendedAmount = detectAppendedData(data);
  if (appendedAmount === undefined) return data;

  const appendedData = appendedAmount === 0 ? new Uint8Array() : data.slice(data.length - appendedAmount);
  const input = appendedAmount === 0 ? data : data.subarray(0, data.length - appendedAmount);

  if (input.length < 8) return data;
  if (readU32(input, input.length - 4) === 0) return input;

  const compLenHeaderLen = readU32(input, input.length - 8);
  const extraSize = readU32(input, input.length - 4);
  const headerLen = compLenHeaderLen >>> 24;
  let compressedLen = compLenHeaderLen & 0x00ffffff;

  if (input.length < headerLen) throw new Error(`File is too small for code compression header`);
  if (compressedLen > input.length) throw new Error(`Compressed length does not fit in input`);

  for (let i = input.length - headerLen; i < input.length - 8; i += 1) {
    if (input[i] !== 0xff) throw new Error(`Code compression header padding is invalid`);
  }

  if (compressedLen >= input.length) compressedLen = input.length;

  const passthroughLen = input.length - compressedLen;
  const passthrough = input.subarray(0, passthroughLen);
  const compData = input.subarray(passthroughLen, passthroughLen + compressedLen - headerLen);
  const out = new Uint8Array(input.length + extraSize - passthroughLen);

  let currentOutSize = 0;
  let readBytes = 0;
  let flags = 0;
  let mask = 1;

  while (currentOutSize < out.length) {
    if (mask === 1) {
      if (readBytes >= compressedLen) throw new Error(`Not enough data to decompress`);
      flags = compData[compData.length - 1 - readBytes];
      readBytes += 1;
      mask = 0x80;
    } else {
      mask >>>= 1;
    }

    if (flags & mask) {
      if (readBytes + 1 >= compData.length) throw new Error(`Not enough compressed block data`);
      const byte1 = compData[compData.length - 1 - readBytes++];
      const byte2 = compData[compData.length - 1 - readBytes++];
      const length = (byte1 >>> 4) + 3;
      let disp = (((byte1 & 0x0f) << 8) | byte2) + 3;

      if (disp > currentOutSize) {
        if (currentOutSize < 2) throw new Error(`Invalid code compression displacement`);
        disp = 2;
      }

      let bufferIndex = currentOutSize - disp;
      for (let i = 0; i < length && currentOutSize < out.length; i += 1) {
        const next = out[out.length - 1 - bufferIndex];
        bufferIndex += 1;
        out[out.length - 1 - currentOutSize] = next;
        currentOutSize += 1;
      }
    } else {
      if (readBytes >= compData.length) throw new Error(`Not enough literal data`);
      out[out.length - 1 - currentOutSize] = compData[compData.length - 1 - readBytes++];
      currentOutSize += 1;
    }
  }

  const merged = new Uint8Array(passthrough.length + out.length + appendedData.length);
  merged.set(passthrough, 0);
  merged.set(out, passthrough.length);
  merged.set(appendedData, passthrough.length + out.length);
  return merged;
}

export function compressCode(data: Uint8Array, options: { isArm9?: boolean } = {}): Uint8Array {
  if (options.isArm9) {
    const prefixLength = Math.min(0x4000, data.length);
    const compressed = compressCodeBody(data.subarray(prefixLength));
    const out = new Uint8Array(prefixLength + compressed.length);
    out.set(data.subarray(0, prefixLength), 0);
    out.set(compressed, prefixLength);
    return out;
  }
  return compressCodeBody(data);
}

function compressCodeBody(data: Uint8Array): Uint8Array {
  const { compressed, ignorableDataAmount, ignorableCompressedAmount } = compressLzLike([...data].reverse(), {
    posSubtract: 3,
    maxMatchDiff: 0x1002,
    maxMatchLen: 18,
    searchReverse: true,
  });
  const reversed = new Uint8Array([...compressed].reverse());
  const paddedRawLength = align(data.length, 4) + 4;
  if (reversed.length === 0 || data.length + 4 < align(reversed.length, 4) + 8) {
    const out = new Uint8Array(paddedRawLength);
    out.set(data, 0);
    return out;
  }

  const actualCompressedLength = reversed.length - ignorableCompressedAmount;
  let headerLength = 8;
  const bodyLength = ignorableDataAmount + actualCompressedLength;
  const paddedBodyLength = align(bodyLength, 4);
  headerLength += paddedBodyLength - bodyLength;

  const out = new Uint8Array(paddedBodyLength + 8);
  out.set(data.subarray(0, ignorableDataAmount), 0);
  out.set(reversed.subarray(ignorableCompressedAmount), ignorableDataAmount);
  out.fill(0xff, bodyLength, paddedBodyLength);
  writeU32(out, paddedBodyLength, actualCompressedLength + headerLength);
  out[paddedBodyLength + 3] = headerLength;
  writeU32(out, paddedBodyLength + 4, data.length - out.length);
  return out;
}

type CompressLzOptions = {
  posSubtract: number;
  maxMatchDiff: number;
  maxMatchLen: number;
  searchReverse: boolean;
};

function compressLzLike(data: number[], options: CompressLzOptions): { compressed: Uint8Array; ignorableDataAmount: number; ignorableCompressedAmount: number } {
  const result: number[] = [];
  const positionsByKey = new Map<number, number[]>();
  const ignorePositions = new Map<number, { current: number; length: number }>([[0, { current: 0, length: 0 }]]);
  let current = 0;
  let ignorableDataAmount = 0;
  let ignorableCompressedAmount = 0;
  let bestSavingsSoFar = 0;

  const rememberPosition = (position: number): void => {
    if (position + 2 >= data.length) return;
    const key = sequenceKey(data, position);
    let positions = positionsByKey.get(key);
    if (!positions) {
      positions = [];
      positionsByKey.set(key, positions);
    }
    positions.push(position);
  };

  const findMatch = (position: number): { position: number; length: number } => {
    if (position + 2 >= data.length) return { position: 0, length: 0 };
    const positions = positionsByKey.get(sequenceKey(data, position));
    if (!positions) return { position: 0, length: 0 };

    const minPosition = Math.max(0, position - options.maxMatchDiff);
    let bestPosition = 0;
    let bestLength = 0;
    const start = options.searchReverse ? positions.length - 1 : 0;
    const end = options.searchReverse ? -1 : positions.length;
    const step = options.searchReverse ? -1 : 1;
    for (let index = start; index !== end; index += step) {
      const candidate = positions[index];
      if (candidate === undefined) continue;
      if (candidate < minPosition) {
        if (options.searchReverse) break;
        continue;
      }
      if (candidate >= position) continue;
      if (position - candidate - options.posSubtract < 0) continue;
      let length = 0;
      const maxLength = Math.min(options.maxMatchLen, data.length - position, position - candidate);
      while (length < maxLength && data[candidate + length] === data[position + length]) length += 1;
      if (length > bestLength) {
        bestLength = length;
        bestPosition = candidate;
        if (bestLength === maxLength) break;
      }
    }
    return { position: bestPosition, length: bestLength };
  };

  while (current < data.length) {
    let blockFlags = 0;
    const blockFlagsOffset = result.length;
    result.push(0);
    ignorableCompressedAmount += 1;

    for (let bit = 0; bit < 8; bit += 1) {
      if (current >= data.length) continue;

      const match = findMatch(current);
      const searchDisp = current - match.position - options.posSubtract;
      if (match.length > 2 && searchDisp >= 0 && searchDisp <= 0xfff) {
        blockFlags |= 1 << (7 - bit);
        result.push((((match.length - 3) & 0x0f) << 4) | ((searchDisp >>> 8) & 0x0f), searchDisp & 0xff);
        for (let index = 0; index < match.length; index += 1) rememberPosition(current + index);
        current += match.length;
        ignorableDataAmount += match.length;
        ignorableCompressedAmount += 2;
      } else {
        result.push(data[current]);
        rememberPosition(current);
        current += 1;
        ignorableDataAmount += 1;
        ignorableCompressedAmount += 1;
      }

      const savingsNow = current - result.length;
      if (savingsNow > bestSavingsSoFar) {
        ignorableDataAmount = 0;
        ignorableCompressedAmount = 0;
        bestSavingsSoFar = savingsNow;
        if (!ignorePositions.has(savingsNow)) ignorePositions.set(savingsNow, { current, length: result.length });
      }
    }
    result[blockFlagsOffset] = blockFlags;
  }

  const finalSavings = current - result.length;
  if (finalSavings < bestSavingsSoFar) {
    let nextSavings = finalSavings + 1;
    while (!ignorePositions.has(nextSavings)) nextSavings += 1;
    const ignorePosition = ignorePositions.get(nextSavings)!;
    ignorableDataAmount = current - ignorePosition.current;
    ignorableCompressedAmount = result.length - ignorePosition.length;
  } else {
    ignorableDataAmount = 0;
    ignorableCompressedAmount = 0;
  }

  return { compressed: Uint8Array.from(result), ignorableDataAmount, ignorableCompressedAmount };
}

function sequenceKey(data: number[], position: number): number {
  return ((data[position] ?? 0) << 16) | ((data[position + 1] ?? 0) << 8) | (data[position + 2] ?? 0);
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}
