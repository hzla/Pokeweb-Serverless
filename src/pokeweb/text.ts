import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export type Gen5TextEntry = [string, string, number];
export type TextEntry = Gen5TextEntry;

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

export function decodeGen4TextBank(data: Uint8Array): TextEntry[] {
  if (data.length < 4) throw new Error("Gen 4 text bank is too small");
  const count = readU16(data, 0);
  const key = readU16(data, 2);
  const tableOffset = 4;
  const dataOffset = tableOffset + count * 8;
  if (dataOffset > data.length) throw new Error("Gen 4 text bank allocation table exceeds file size");

  const entries: TextEntry[] = [];
  let fallbackCursor = dataOffset;
  for (let index = 0; index < count; index += 1) {
    const tableEntryOffset = tableOffset + index * 8;
    const allocKey = gen4AllocationKey(index, key);
    const absoluteOffset = readU32(data, tableEntryOffset) ^ allocKey;
    const length = readU32(data, tableEntryOffset + 4) ^ allocKey;
    const wordOffset = absoluteOffset >= dataOffset && absoluteOffset + length * 2 <= data.length ? absoluteOffset : fallbackCursor;
    if (wordOffset + length * 2 > data.length) throw new Error(`Gen 4 text entry ${index} exceeds bank size`);

    const words: number[] = [];
    let stringKey = gen4StringKey(index);
    for (let wordIndex = 0; wordIndex < length; wordIndex += 1) {
      words.push(readU16(data, wordOffset + wordIndex * 2) ^ stringKey);
      stringKey = (stringKey + 18749) & 0xffff;
    }
    const trainerName = decodeGen4TrainerNameWords(words);
    entries.push([`0_${index}`, trainerName === undefined ? renderGen4Text(words) : `{TRAINER_NAME:${trainerName}}`, key]);
    fallbackCursor = wordOffset + length * 2;
  }
  return entries;
}

export function encodeGen4TextBank(entries: TextEntry[]): Uint8Array {
  const block = groupEntries(entries)[0];
  if (!block) throw new Error("Gen 4 text bank must contain block 0 entries");
  const count = Math.max(...Object.keys(block).map(Number)) + 1;
  if (!Number.isFinite(count) || count <= 0) throw new Error("Gen 4 text bank must contain at least one entry");
  const key = entries.find((entry) => entry[2] !== 0)?.[2] ?? 0x1234;

  const encodedEntries: Uint16Array[] = [];
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entry = block[entryIndex];
    if (!entry) throw new Error(`Missing Gen 4 text entry 0_${entryIndex}`);
    const trainerName = parseGen4TrainerName(entry[1]);
    const words = trainerName === undefined ? [...encodeGen4EscapedStringToWords(entry[1]), 0xffff] : [0xf100, ...packGen4TrainerNameCodes(encodeGen4EscapedStringToWords(trainerName)), 0xffff];
    encodedEntries.push(encryptGen4Words(words, entryIndex));
  }

  const tableLength = 4 + count * 8;
  const bodyLength = encodedEntries.reduce((sum, words) => sum + words.length * 2, 0);
  const out = new Uint8Array(tableLength + bodyLength);
  writeU16(out, 0, count);
  writeU16(out, 2, key);

  let dataOffset = tableLength;
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const encoded = encodedEntries[entryIndex];
    const allocKey = gen4AllocationKey(entryIndex, key);
    const tableEntryOffset = 4 + entryIndex * 8;
    writeU32(out, tableEntryOffset, (dataOffset ^ allocKey) >>> 0);
    writeU32(out, tableEntryOffset + 4, (encoded.length ^ allocKey) >>> 0);
    for (const word of encoded) {
      writeU16(out, dataOffset, word);
      dataOffset += 2;
    }
  }
  return out;
}

function gen4AllocationKey(entryIndex: number, bankKey: number): number {
  return ((((765 * (entryIndex + 1) * bankKey) & 0xffff) * 0x10001) >>> 0);
}

function gen4StringKey(entryIndex: number): number {
  return ((entryIndex + 1) * 596947) & 0xffff;
}

function encryptGen4Words(words: number[], entryIndex: number): Uint16Array {
  const encrypted = new Uint16Array(words.length);
  let key = gen4StringKey(entryIndex);
  for (let index = 0; index < words.length; index += 1) {
    encrypted[index] = (words[index] ^ key) & 0xffff;
    key = (key + 18749) & 0xffff;
  }
  return encrypted;
}

function renderGen4Text(words: number[]): string {
  let text = "";
  for (let index = 0; index < words.length; index += 1) {
    const code = words[index];
    if (code === 0xffff) break;
    if (code === 0xfffe) {
      const kind = words[++index] ?? 0;
      const count = words[++index] ?? 0;
      const args = Array.from({ length: count }, () => words[++index] ?? 0);
      text += `{${kind.toString(16).toUpperCase().padStart(4, "0")}${args.length ? ` ${args.join(",")}` : ""}}`;
      continue;
    }
    text += gen4Char(code);
  }
  return text;
}

function decodeGen4TrainerNameWords(words: number[]): string | undefined {
  if (words[0] !== 0xf100) return undefined;
  const payload = words.slice(1, words[words.length - 1] === 0xffff ? -1 : undefined);
  return renderGen4Text([...unpackGen4TrainerNameCodes(payload), 0xffff]);
}

function unpackGen4TrainerNameCodes(words: number[]): number[] {
  const codes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const word of words) {
    accumulator |= (word & 0x7fff) << bitCount;
    bitCount += 15;
    while (bitCount >= 9) {
      const code = accumulator & 0x1ff;
      accumulator >>>= 9;
      bitCount -= 9;
      if (code === 0x1ff) return codes;
      codes.push(code);
    }
  }
  return codes;
}

function packGen4TrainerNameCodes(codes: number[]): number[] {
  const words: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const code of codes) {
    accumulator |= (code & 0x1ff) << bitCount;
    bitCount += 9;
    while (bitCount >= 15) {
      words.push(accumulator & 0x7fff);
      accumulator >>>= 15;
      bitCount -= 15;
    }
  }
  if (bitCount > 0) {
    accumulator |= ((1 << (15 - bitCount)) - 1) << bitCount;
    words.push(accumulator & 0x7fff);
  }
  return words;
}

function parseGen4TrainerName(text: string): string | undefined {
  const match = /^\{TRAINER_NAME:(.*)\}$/u.exec(text);
  return match?.[1];
}

function encodeGen4EscapedStringToWords(text: string): number[] {
  const words: number[] = [];
  for (let index = 0; index < text.length; ) {
    if (text[index] === "\\" && index + 1 < text.length) {
      const kind = text[index + 1];
      if (kind === "x") {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/u.test(hex)) throw new Error(`Bad \\x escape at ${index}`);
        words.push(Number.parseInt(hex, 16) & 0xffff);
        index += 6;
        continue;
      }
      if (kind === "n") {
        words.push(0xe000);
        index += 2;
        continue;
      }
    }

    if (text[index] === "{") {
      const close = text.indexOf("}", index + 1);
      if (close < 0) throw new Error(`Unclosed Gen 4 control code at ${index}`);
      const body = text.slice(index + 1, close).trim();
      const match = /^([0-9a-fA-F]{4})(?:\s+(.*))?$/u.exec(body);
      const kindText = match?.[1] ?? "";
      const argsText = match?.[2] ?? "";
      if (/^[0-9a-fA-F]{4}$/u.test(kindText)) {
        const args = argsText
          .split(",")
          .map((arg) => arg.trim())
          .filter(Boolean)
          .map((arg) => (arg.toLowerCase().startsWith("0x") ? Number.parseInt(arg, 16) : Number.parseInt(arg, 10)));
        if (args.some((arg) => !Number.isFinite(arg))) throw new Error(`Bad Gen 4 control code at ${index}`);
        words.push(0xfffe, Number.parseInt(kindText, 16) & 0xffff, args.length & 0xffff, ...args.map((arg) => arg & 0xffff));
        index = close + 1;
        continue;
      }
    }

    const codepoint = text.codePointAt(index) ?? 0;
    words.push(gen4Codepoint(codepoint));
    index += codepoint > 0xffff ? 2 : 1;
  }
  return words;
}

function gen4Char(code: number): string {
  if (code >= 0x0121 && code <= 0x012a) return String.fromCharCode(48 + code - 0x0121);
  if (code >= 0x012b && code <= 0x0144) return String.fromCharCode(65 + code - 0x012b);
  if (code >= 0x0145 && code <= 0x015e) return String.fromCharCode(97 + code - 0x0145);
  const mapped = GEN4_CHAR_MAP.get(code);
  return mapped ?? `\\x${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function gen4Codepoint(codepoint: number): number {
  if (codepoint >= 48 && codepoint <= 57) return 0x0121 + codepoint - 48;
  if (codepoint >= 65 && codepoint <= 90) return 0x012b + codepoint - 65;
  if (codepoint >= 97 && codepoint <= 122) return 0x0145 + codepoint - 97;
  const mapped = GEN4_REVERSE_CHAR_MAP.get(String.fromCodePoint(codepoint));
  return mapped ?? (codepoint & 0xffff);
}

const GEN4_CHAR_MAP = new Map<number, string>([
  [0x0000, ""],
  [0x01ab, "!"],
  [0x01ac, "?"],
  [0x01ad, ","],
  [0x01ae, "."],
  [0x01af, "..."],
  [0x01b0, "."],
  [0x01b1, "/"],
  [0x01b2, "'"],
  [0x01b3, "'"],
  [0x01b4, '"'],
  [0x01b5, '"'],
  [0x01b9, "("],
  [0x01ba, ")"],
  [0x01bb, "M"],
  [0x01bc, "F"],
  [0x01bd, "+"],
  [0x01be, "-"],
  [0x01bf, "*"],
  [0x01c0, "#"],
  [0x01c1, "="],
  [0x01c2, "&"],
  [0x01c3, "~"],
  [0x01c4, ":"],
  [0x01c5, ";"],
  [0x01d0, "@"],
  [0x01d2, "%"],
  [0x01de, " "],
  [0x01e8, "deg"],
  [0x01e9, "_"],
  [0x015f, "A"],
  [0x0160, "A"],
  [0x0161, "A"],
  [0x0163, "A"],
  [0x0166, "C"],
  [0x0167, "E"],
  [0x0168, "E"],
  [0x0169, "E"],
  [0x016a, "E"],
  [0x016b, "I"],
  [0x016c, "I"],
  [0x016d, "I"],
  [0x016e, "I"],
  [0x0170, "N"],
  [0x0171, "O"],
  [0x0172, "O"],
  [0x0173, "O"],
  [0x0175, "O"],
  [0x0178, "U"],
  [0x0179, "U"],
  [0x017a, "U"],
  [0x017b, "U"],
  [0x017f, "a"],
  [0x0180, "a"],
  [0x0181, "a"],
  [0x0183, "a"],
  [0x0186, "c"],
  [0x0187, "e"],
  [0x0188, "e"],
  [0x0189, "e"],
  [0x018a, "e"],
  [0x018b, "i"],
  [0x018c, "i"],
  [0x018d, "i"],
  [0x018e, "i"],
  [0x0190, "n"],
  [0x0191, "o"],
  [0x0192, "o"],
  [0x0193, "o"],
  [0x0195, "o"],
  [0x0198, "u"],
  [0x0199, "u"],
  [0x019a, "u"],
  [0x019b, "u"],
]);

const GEN4_REVERSE_CHAR_MAP = new Map<string, number>(
  [...GEN4_CHAR_MAP]
    .filter(([, value]) => value.length === 1)
    .reverse()
    .map(([key, value]) => [value, key]),
);

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
  const displayValue = parseGen4TrainerName(value) ?? value;
  const cleaned = displayValue
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
