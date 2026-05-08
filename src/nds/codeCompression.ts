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
