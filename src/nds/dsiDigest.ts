import { readU16, readU32, writeU32 } from "./binary";
import { decompressCode } from "./codeCompression";
import { HmacSha1 } from "./sha1";
import { encryptNdsSecureArea } from "./key1";

export type DsiDigestSource = {
  ntrStart: number;
  twlStart: number;
  twlSize: number;
  regionStart: number;
  regionSize: number;
  sectorSize: number;
  blockSectors: number;
  twlHashes: Uint8Array;
  hmac: HmacSha1;
};

export type DsiDigestLayout = {
  ntrSize: number;
  sectorOffset: number;
  sectorLength: number;
  blockOffset: number;
  blockLength: number;
  end: number;
};

const aligned = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
const powerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;
function invalid(detail: string): never {
  throw new Error(`Cannot rebuild DSi integrity tables: ${detail}. Load the original ROM; an earlier export may have omitted its DSi integrity data.`);
}
function span(source: Uint8Array, start: number, length: number): boolean {
  return start > 0 && length > 0 && start + length <= source.length;
}

// Locate the digest key in the user's decompressed ARM9, authenticating each
// candidate against the source block table. Only code offsets are bundled.
// The aligned scan also supports hacks that move the native configuration.
function digestHmacFromRom(source: Uint8Array, sectors: Uint8Array, expected: Uint8Array): HmacSha1 {
  const start = readU32(source, 0x20), size = readU32(source, 0x2c);
  if (!span(source, start, size)) invalid("the ARM9 program is missing");
  const arm9 = decompressCode(source.subarray(start, start + size));
  const gameCode = new TextDecoder().decode(source.subarray(0x0c, 0x10));
  const hint = ({ IREO: 0x90548, IRDO: 0x90574 } as Record<string, number>)[gameCode];
  const result = new Uint8Array(20);
  const tryAt = (at: number): HmacSha1 | undefined => {
    if (at < 0 || at + 64 > arm9.length) return undefined;
    const hash = new HmacSha1(arm9.subarray(at, at + 64));
    hash.digest(sectors, result);
    if (result.every((value, i) => value === expected[i])) return hash;
    return undefined;
  };
  if (hint !== undefined) {
    const hash = tryAt(hint);
    if (hash) return hash;
  }
  for (let at = 0; at + 64 <= arm9.length; at += 4) {
    if (at === hint) continue;
    const hash = tryAt(at);
    if (hash) return hash;
  }
  return invalid("the ROM's native digest configuration could not be authenticated");
}

export function readDsiDigestSource(source: Uint8Array): DsiDigestSource | undefined {
  const fields = Array.from({ length: 10 }, (_, i) => readU32(source, 0x1e0 + i * 4));
  if (fields.every((value) => value === 0)) return undefined;
  const [ntrStart, ntrSize, twlStart, twlSize, sectorOffset, sectorLength, blockOffset, blockLength, sectorSize, blockSectors] = fields;
  if (!powerOfTwo(sectorSize) || sectorSize < 0x200 || sectorSize > 0x100000 || !powerOfTwo(blockSectors) || blockSectors > 1024) invalid("unsupported sector or block dimensions");
  if (!span(source, ntrStart, ntrSize) || !span(source, twlStart, twlSize)
    || !span(source, sectorOffset, sectorLength) || !span(source, blockOffset, blockLength)) invalid("a digest region or hash table is missing or outside the ROM");
  if (ntrStart < Math.max(readU32(source, 0x84), 0x200) || ntrSize % sectorSize || twlSize % sectorSize) invalid("unaligned digest regions");
  const ntrSectors = ntrSize / sectorSize, twlSectors = twlSize / sectorSize;
  const expectedSectors = aligned(ntrSectors + twlSectors, blockSectors) * 20;
  if (sectorLength !== expectedSectors || blockLength !== expectedSectors / blockSectors) invalid("hash table sizes do not match their digest regions");
  const regionStart = readU16(source, 0x92) * 0x80000;
  if (!regionStart || regionStart > twlStart || blockOffset + blockLength > regionStart || ntrStart + ntrSize > sectorOffset
    || sectorOffset + sectorLength > blockOffset) invalid("overlapping NTR and TWL regions");
  for (const [offsetField, sizeField] of [[0x1c0, 0x1cc], [0x1d0, 0x1dc]]) {
    const start = readU32(source, offsetField), size = readU32(source, sizeField);
    if (size && (start < regionStart || start + size > twlStart + twlSize)) invalid("a DSi binary is outside its preserved region");
  }
  const sectors = source.subarray(sectorOffset, sectorOffset + sectorLength);
  const hash = digestHmacFromRom(source, sectors.subarray(0, blockSectors * 20), source.subarray(blockOffset, blockOffset + 20));
  const master = hash.digest(source.subarray(blockOffset, blockOffset + blockLength));
  if (!master.every((value, i) => value === source[0x328 + i])) invalid("the source master hash does not authenticate its block table");
  const result = new Uint8Array(20);
  for (let at = 0; at < sectorLength; at += blockSectors * 20) {
    hash.digest(sectors.subarray(at, at + blockSectors * 20), result);
    const blockAt = blockOffset + at / blockSectors;
    if (!result.every((value, i) => value === source[blockAt + i])) invalid("the source block table does not authenticate its sector table");
  }
  return { ntrStart, twlStart, twlSize, regionStart, regionSize: twlStart + twlSize - regionStart,
    sectorSize, blockSectors, twlHashes: sectors.subarray(ntrSectors * 20, (ntrSectors + twlSectors) * 20), hmac: hash };
}

export function planDsiDigest(source: DsiDigestSource, fileEnd: number): DsiDigestLayout {
  const sectorOffset = aligned(fileEnd, source.sectorSize);
  if (sectorOffset <= source.ntrStart) invalid("the rebuilt NTR region is empty");
  const ntrSize = sectorOffset - source.ntrStart;
  const sectors = (ntrSize + source.twlSize) / source.sectorSize;
  const sectorLength = aligned(sectors, source.blockSectors) * 20;
  const blockOffset = aligned(sectorOffset + sectorLength, 0x200);
  const blockLength = sectorLength / source.blockSectors;
  return { ntrSize, sectorOffset, sectorLength, blockOffset, blockLength, end: aligned(blockOffset + blockLength, 4) };
}

export function writeDsiDigest(out: Uint8Array, source: DsiDigestSource, layout: DsiDigestLayout, regionStart: number): void {
  const hash = source.hmac;
  let entry = layout.sectorOffset;
  // Native cards hash the encrypted secure area even when the source dump
  // stores its decrypted marker. PMC edits this span, so regenerate its
  // cartridge ciphertext for hashing while retaining decrypted ROM bytes.
  let secure: Uint8Array | undefined;
  if (source.ntrStart === 0x4000 && readU32(out, 0x4000) === 0xe7ffdeff && readU32(out, 0x4004) === 0xe7ffdeff) {
    secure = out.slice(0x4000, 0x4000 + aligned(0x800, source.sectorSize));
    secure.set(encryptNdsSecureArea(out.subarray(0x4000, 0x4800), readU32(out, 0x0c)));
  }
  for (let at = source.ntrStart; at < source.ntrStart + layout.ntrSize; at += source.sectorSize) {
    const index = at - source.ntrStart;
    hash.digest(secure && index < secure.length ? secure.subarray(index, index + source.sectorSize) : out.subarray(at, at + source.sectorSize), out, entry);
    entry += 20;
  }
  // The entire TWL span (including code, encryption and inter-binary padding)
  // is copied unchanged. Reuse its authenticated plaintext sector hashes;
  // hashing Modcrypt ciphertext would create invalid native FS digests.
  out.set(source.twlHashes, entry);
  for (let at = 0; at < layout.sectorLength; at += source.blockSectors * 20) {
    hash.digest(out.subarray(layout.sectorOffset + at, layout.sectorOffset + at + source.blockSectors * 20), out, layout.blockOffset + at / source.blockSectors);
  }
  hash.digest(out.subarray(layout.blockOffset, layout.blockOffset + layout.blockLength), out, 0x328);
  writeU32(out, 0x1e0, source.ntrStart);
  writeU32(out, 0x1e4, layout.ntrSize);
  writeU32(out, 0x1e8, regionStart + source.twlStart - source.regionStart);
  writeU32(out, 0x1ec, source.twlSize);
  writeU32(out, 0x1f0, layout.sectorOffset);
  writeU32(out, 0x1f4, layout.sectorLength);
  writeU32(out, 0x1f8, layout.blockOffset);
  writeU32(out, 0x1fc, layout.blockLength);
}
