const INITIAL_STATE = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0);

function compress(state: Uint32Array, bytes: Uint8Array, offset: number, words: Uint32Array): void {
  for (let i = 0; i < 16; i++) {
    const at = offset + i * 4;
    words[i] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
  }
  for (let i = 16; i < 80; i++) {
    const word = words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16];
    words[i] = (word << 1) | (word >>> 31);
  }
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4];
  for (let i = 0; i < 80; i++) {
    const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
    const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
    const next = (((a << 5) | (a >>> 27)) + f + e + k + words[i]) >>> 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e;
}

function writeBigEndian(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value >>> 24;
  out[offset + 1] = value >>> 16;
  out[offset + 2] = value >>> 8;
  out[offset + 3] = value;
}

function finish(state: Uint32Array, data: Uint8Array, prefixLength: number,
  words: Uint32Array, tail: Uint8Array, out: Uint8Array, offset: number): void {
  const fullLength = data.length - data.length % 64;
  for (let at = 0; at < fullLength; at += 64) compress(state, data, at, words);
  const remaining = data.length - fullLength;
  const tailLength = remaining < 56 ? 64 : 128;
  tail.fill(0);
  tail.set(data.subarray(fullLength));
  tail[remaining] = 0x80;
  const bits = (prefixLength + data.length) * 8;
  writeBigEndian(tail, tailLength - 8, Math.floor(bits / 0x100000000));
  writeBigEndian(tail, tailLength - 4, bits >>> 0);
  compress(state, tail, 0, words);
  if (tailLength === 128) compress(state, tail, 64, words);
  for (let i = 0; i < 5; i++) writeBigEndian(out, offset + i * 4, state[i]);
}

export function sha1(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(20);
  finish(INITIAL_STATE.slice(), data, 0, new Uint32Array(80), new Uint8Array(128), out, 0);
  return out;
}

/** Synchronous, reusable scratch storage for ROM sector hashing in browsers. */
export class HmacSha1 {
  private readonly inner = INITIAL_STATE.slice();
  private readonly outer = INITIAL_STATE.slice();
  private readonly state = new Uint32Array(5);
  private readonly words = new Uint32Array(80);
  private readonly tail = new Uint8Array(128);
  private readonly intermediate = new Uint8Array(20);

  constructor(key: Uint8Array) {
    const bytes = key.length > 64 ? sha1(key) : key;
    const pad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) pad[i] = (bytes[i] ?? 0) ^ 0x36;
    compress(this.inner, pad, 0, this.words);
    for (let i = 0; i < 64; i++) pad[i] = (bytes[i] ?? 0) ^ 0x5c;
    compress(this.outer, pad, 0, this.words);
  }

  /** SHA-1 states after processing the 64-byte HMAC inner and outer pads. */
  static fromPadStates(inner: readonly number[], outer: readonly number[]): HmacSha1 {
    if (inner.length !== 5 || outer.length !== 5) throw new Error("Invalid SHA-1 pad state");
    const hash = new HmacSha1(new Uint8Array());
    hash.inner.set(inner);
    hash.outer.set(outer);
    return hash;
  }

  digest(data: Uint8Array, out: Uint8Array = new Uint8Array(20), offset = 0): Uint8Array {
    if (!Number.isInteger(offset) || offset < 0 || offset + 20 > out.length) throw new Error("Invalid HMAC output range");
    this.state.set(this.inner);
    finish(this.state, data, 64, this.words, this.tail, this.intermediate, 0);
    this.state.set(this.outer);
    finish(this.state, this.intermediate, 64, this.words, this.tail, out, offset);
    return out;
  }
}
