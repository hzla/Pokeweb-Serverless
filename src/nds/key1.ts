import { readU32, writeU32 } from "./binary";
import { key1Seed } from "./key1Seed";

const swapBytes = (word: number) => ((word >>> 24) | ((word >>> 8) & 0xff00) | ((word << 8) & 0xff0000) | (word << 24)) >>> 0;

class Key1Cipher {
  private readonly table: Uint32Array;

  constructor(seed: Uint32Array, gameCode: number, level: 2 | 3) {
    this.table = seed.slice();
    const code = Uint32Array.of(gameCode, gameCode >>> 1, gameCode << 1);
    this.expand(code);
    this.expand(code);
    if (level === 3) {
      code[1] <<= 1; code[2] >>>= 1;
      this.expand(code);
    }
  }

  encrypt(first: number, second: number): [number, number] {
    const table = this.table;
    let left = second, right = first;
    for (let round = 0; round < 16; round++) {
      const word = (table[round] ^ left) >>> 0;
      const a = (table[18 + (word >>> 24)] + table[274 + ((word >>> 16) & 255)]) >>> 0;
      const b = ((a ^ table[530 + ((word >>> 8) & 255)]) + table[786 + (word & 255)]) >>> 0;
      left = (b ^ right) >>> 0;
      right = word;
    }
    return [(left ^ table[16]) >>> 0, (right ^ table[17]) >>> 0];
  }

  private expand(code: Uint32Array): void {
    [code[1], code[2]] = this.encrypt(code[1], code[2]);
    [code[0], code[1]] = this.encrypt(code[0], code[1]);
    for (let i = 0; i < 18; i++) this.table[i] ^= swapBytes(code[i % 2]);
    let first = 0, second = 0;
    for (let i = 0; i < this.table.length; i += 2) {
      [first, second] = this.encrypt(first, second);
      this.table[i] = second;
      this.table[i + 1] = first;
    }
  }
}

/** The secure-area bytes a native cartridge exposes to DSi integrity reads. */
export function encryptNdsSecureArea(decrypted: Uint8Array, gameCode: number, seed = key1Seed()): Uint8Array {
  if (decrypted.length !== 0x800) throw new Error("The NDS secure-area encryption span must be 0x800 bytes");
  if (seed.length !== 1042) throw new Error("The KEY1 table must contain 1042 words");
  const out = decrypted.slice();
  out.set(new TextEncoder().encode("encryObj"));
  const level3 = new Key1Cipher(seed, gameCode, 3);
  for (let at = 0; at < out.length; at += 8) {
    const [first, second] = level3.encrypt(readU32(out, at), readU32(out, at + 4));
    writeU32(out, at, first); writeU32(out, at + 4, second);
  }
  const level2 = new Key1Cipher(seed, gameCode, 2);
  const [first, second] = level2.encrypt(readU32(out, 0), readU32(out, 4));
  writeU32(out, 0, first); writeU32(out, 4, second);
  return out;
}
