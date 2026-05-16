import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export type Gen5TextEntry = [string, string, number];

export function decodeGen5TextBank(data: Uint8Array): Gen5TextEntry[] {
  const texts: Gen5TextEntry[] = [];
  const blockCount = readU16(data, 0);
  const entryCount = readU16(data, 2);
  const blockOffsets: number[] = [];

  if (data.length < 4) throw new Error("Text bank is too small");
  if (blockCount === 0 || entryCount === 0) return texts;
  if (12 + blockCount * 4 > data.length) throw new Error("Text bank block table exceeds file size");

  for (let i = 0; i < blockCount; i += 1) {
    blockOffsets.push(readU32(data, 12 + i * 4));
  }

  for (let blockIndex = 0; blockIndex < blockOffsets.length; blockIndex += 1) {
    const blockOffset = blockOffsets[blockIndex];
    const blockLength = readU32(data, blockOffset);
    const blockEnd = blockOffset + blockLength;
    const tableLength = 4 + entryCount * 8;
    if (blockOffset + 4 > data.length || blockLength < tableLength || blockEnd > data.length) {
      throw new Error(`Text bank block ${blockIndex} exceeds file size`);
    }

    const tableOffsets: number[] = [];
    const charCounts: number[] = [];
    const textFlags: number[] = [];

    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      const tableOffset = blockOffset + 4 + entryIndex * 8;
      tableOffsets.push(readU32(data, tableOffset));
      charCounts.push(readU16(data, tableOffset + 4));
      textFlags.push(readU16(data, tableOffset + 6));
      if (blockOffset + tableOffsets[entryIndex] + charCounts[entryIndex] * 2 > blockEnd) {
        throw new Error(`Text bank entry ${blockIndex}_${entryIndex} exceeds block size`);
      }
    }

    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      const encoded: number[] = [];
      let offset = blockOffset + tableOffsets[entryIndex];
      for (let i = 0; i < charCounts[entryIndex]; i += 1) {
        encoded.push(readU16(data, offset));
        offset += 2;
      }
      if (encoded.length === 0) {
        texts.push([`${blockIndex}_${entryIndex}`, "", 0]);
        continue;
      }

      const initialKey = encoded[encoded.length - 1];
      let key = initialKey ^ 0xffff;
      const decoded: number[] = [];
      while (encoded.length) {
        const encodedChar = encoded.pop() ?? 0;
        const char = encodedChar ^ key;
        key = ((key >>> 3) | (key << 13)) & 0xffff;
        decoded.unshift(char);
      }

      let chars = decoded;
      let compressed = false;
      if (chars[0] === 0xf100) {
        compressed = true;
        chars = expand9Bit(chars.slice(1));
      }

      const text = renderText(chars);
      let flag = "";
      let value = textFlags[entryIndex];
      let code = 65;
      while (value) {
        if (value & 1) flag += String.fromCharCode(code);
        code += 1;
        value >>>= 1;
      }
      if (compressed) flag += "c";
      texts.push([`${blockIndex}_${entryIndex}${flag}`, text, initialKey]);
    }
  }

  return texts;
}

export function encodeGen5TextBank(entries: Gen5TextEntry[]): Uint8Array {
  const blocks = groupEntries(entries);
  const numBlocks = Math.max(...Object.keys(blocks).map(Number)) + 1;
  if (!Number.isFinite(numBlocks) || numBlocks <= 0) throw new Error("Text bank must contain at least one block");
  const numEntries = Math.max(...Object.values(blocks).flatMap((block) => Object.keys(block).map(Number))) + 1;
  if (!Number.isFinite(numEntries) || numEntries <= 0) throw new Error("Text bank must contain at least one entry");

  const headerLength = 12 + numBlocks * 4;
  const builtBlocks: Uint8Array[] = [];
  const blockOffsets: number[] = [];
  let totalLength = headerLength;

  for (let blockIndex = 0; blockIndex < numBlocks; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (!block) throw new Error(`Missing text block ${blockIndex}`);

    const encodedEntries: Uint16Array[] = [];
    const flags: number[] = [];
    for (let entryIndex = 0; entryIndex < numEntries; entryIndex += 1) {
      const entry = block[entryIndex];
      if (!entry) throw new Error(`Missing text entry ${blockIndex}_${entryIndex}`);
      const meta = parseEntryId(entry[0]);
      let codepoints = encodeEscapedStringToCodepoints(entry[1]);
      if (meta.compressed) codepoints = [0xf100, ...compress9Bit([...codepoints, 0xffff])];
      const encrypted = encryptPlainWordsToEncWords([...codepoints, 0xffff], entryIndex);
      encodedEntries.push(encrypted);
      flags.push(meta.flags);
    }

    const tableLength = 4 + numEntries * 8;
    const blockLength = tableLength + encodedEntries.reduce((sum, encoded) => sum + encoded.length * 2, 0);
    const blockBytes = new Uint8Array(blockLength);
    writeU32(blockBytes, 0, blockLength);
    let tableOffset = 4;
    let dataOffset = tableLength;
    for (let entryIndex = 0; entryIndex < numEntries; entryIndex += 1) {
      const encoded = encodedEntries[entryIndex];
      writeU32(blockBytes, tableOffset, dataOffset);
      writeU16(blockBytes, tableOffset + 4, encoded.length);
      writeU16(blockBytes, tableOffset + 6, flags[entryIndex]);
      tableOffset += 8;
      for (const word of encoded) {
        writeU16(blockBytes, dataOffset, word);
        dataOffset += 2;
      }
    }

    blockOffsets.push(totalLength);
    totalLength += blockBytes.length;
    builtBlocks.push(blockBytes);
  }

  const out = new Uint8Array(totalLength);
  writeU16(out, 0, numBlocks);
  writeU16(out, 2, numEntries);
  writeU32(out, 4, totalLength - headerLength);
  writeU32(out, 8, 0);
  blockOffsets.forEach((offset, index) => writeU32(out, 12 + index * 4, offset));
  let offset = headerLength;
  for (const block of builtBlocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

function expand9Bit(chars: number[]): number[] {
  const out: number[] = [];
  let container = 0;
  let bit = 0;
  while (chars.length) {
    container |= (chars.shift() ?? 0) << bit;
    bit += 16;
    while (bit >= 9) {
      bit -= 9;
      const c = container & 0x1ff;
      out.push(c === 0x1ff ? 0xffff : c);
      container >>>= 9;
    }
  }
  return out;
}

function compress9Bit(codepoints: number[]): number[] {
  const out: number[] = [];
  let container = 0;
  let bit = 0;
  for (const value of codepoints) {
    const symbol = value === 0xffff ? 0x1ff : value;
    if (symbol > 0x1ff) throw new Error(`Cannot compress codepoint 0x${value.toString(16)}`);
    container |= symbol << bit;
    bit += 9;
    while (bit >= 16) {
      out.push(container & 0xffff);
      container >>>= 16;
      bit -= 16;
    }
  }
  if (bit > 0) out.push(container & 0xffff);
  return out;
}

function renderText(chars: number[]): string {
  let text = "";
  const queue = [...chars];
  while (queue.length) {
    const c = queue.shift() ?? 0;
    if (c === 0xffff) break;
    if (c === 0xfffe) {
      text += "\\n";
    } else if (c < 20 || c > 0xf000) {
      text += `\\x${c.toString(16).toUpperCase().padStart(4, "0")}`;
    } else if (c === 0xf000) {
      const kind = queue.shift();
      const count = queue.shift();
      if (kind === undefined || count === undefined) break;
      if (kind === 0xbe00 && count === 0) {
        text += "\\f";
        continue;
      }
      if (kind === 0xbe01 && count === 0) {
        text += "\\r";
        continue;
      }
      const args = [kind];
      for (let i = 0; i < count; i += 1) args.push(queue.shift() ?? 0);
      text += `VAR(${args.join(", ")})`;
    } else {
      text += String.fromCharCode(c);
    }
  }
  return text;
}

function encodeEscapedStringToCodepoints(text: string): number[] {
  const codepoints: number[] = [];
  for (let index = 0; index < text.length; ) {
    if (text[index] === "\\" && index + 1 < text.length) {
      const kind = text[index + 1];
      if (kind === "n") {
        codepoints.push(0xfffe);
        index += 2;
        continue;
      }
      if (kind === "f") {
        codepoints.push(0xf000, 0xbe00, 0);
        index += 2;
        continue;
      }
      if (kind === "r") {
        codepoints.push(0xf000, 0xbe01, 0);
        index += 2;
        continue;
      }
      if (kind === "x") {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/u.test(hex)) throw new Error(`Bad \\x escape at ${index}`);
        codepoints.push(Number.parseInt(hex, 16) & 0xffff);
        index += 6;
        continue;
      }
    }

    if (text.startsWith("VAR(", index)) {
      const close = text.indexOf(")", index + 4);
      if (close < 0) throw new Error(`Unclosed VAR at ${index}`);
      const args = text
        .slice(index + 4, close)
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean)
        .map((arg) => (arg.toLowerCase().startsWith("0x") ? Number.parseInt(arg, 16) : Number.parseInt(arg, 10)));
      if (args.length === 0 || args.some((arg) => !Number.isFinite(arg))) throw new Error(`Bad VAR at ${index}`);
      codepoints.push(0xf000, args[0] & 0xffff, (args.length - 1) & 0xffff, ...args.slice(1).map((arg) => arg & 0xffff));
      index = close + 1;
      continue;
    }

    codepoints.push(text.charCodeAt(index) & 0xffff);
    index += 1;
  }
  return codepoints;
}

function encryptPlainWordsToEncWords(plainWords: number[], entryIndex: number): Uint16Array {
  const encrypted = new Uint16Array(plainWords.length);
  let key = getGen5TextEntrySeed(entryIndex);
  for (let index = 0; index < plainWords.length; index += 1) {
    encrypted[index] = (plainWords[index] ^ key) & 0xffff;
    key = rotateLeft16(key, 3);
  }
  return encrypted;
}

function getGen5TextEntrySeed(entryIndex: number): number {
  return (0x2983 * (entryIndex + 3)) & 0xffff;
}

function rotateLeft16(value: number, count: number): number {
  return ((value << count) | (value >>> (16 - count))) & 0xffff;
}

function groupEntries(entries: Gen5TextEntry[]): Record<number, Record<number, Gen5TextEntry>> {
  const blocks: Record<number, Record<number, Gen5TextEntry>> = {};
  for (const entry of entries) {
    const meta = parseEntryId(entry[0]);
    blocks[meta.block] ??= {};
    blocks[meta.block][meta.entry] = entry;
  }
  return blocks;
}

function parseEntryId(id: string): { block: number; entry: number; flags: number; compressed: boolean } {
  const match = /^(\d+)_(\d+)(.*)$/u.exec(id);
  if (!match) throw new Error(`Invalid text entry id: ${id}`);
  const suffix = match[3] ?? "";
  let flags = 0;
  for (let index = 0; index < 16; index += 1) {
    if (suffix.includes(String.fromCharCode(65 + index))) flags |= 1 << index;
  }
  return {
    block: Number(match[1]),
    entry: Number(match[2]),
    flags,
    compressed: suffix.includes("c"),
  };
}

export function cleanDisplayText(value: string, nameCase = false): string {
  const cleaned = value
    .replaceAll("―", "")
    .replaceAll("⑮", " F")
    .replaceAll("⑭", " M")
    .replaceAll("⒆⒇", "PkMn")
    .replaceAll("é", "e")
    .replace(/[^\x00-\x7F]/gu, "");
  return nameCase ? titleCaseName(cleaned) : cleaned;
}

function titleCaseName(value: string): string {
  return value.replace(/[A-Za-z0-9]+/gu, (word) => {
    if (/^\d+$/u.test(word)) return word;
    if (word.length === 1) return word.toUpperCase();
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
}
