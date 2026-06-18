import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type ZipHandle = {
  fd: number;
  path: string;
  size: number;
  entries: ZipEntry[];
};

type Args = {
  file?: string;
  json: boolean;
  scanParty: boolean;
  scanTrpok: boolean;
  levels: Set<number>;
  species?: Set<number>;
  maxCandidates: number;
  memoryWindow?: { offset: number; length: number };
};

type PartyCandidate = {
  offset: number;
  pid: number;
  species: number;
  item: number;
  exp: number;
  nature: number;
  level: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spe: number;
  spa: number;
  spd: number;
};

type RawTrpokCandidate = {
  offset: number;
  ivs: number;
  abilityGender: number;
  level: number;
  natureByte: number;
  species: number;
  form: number;
  raw: string;
};

const MAIN_MEMORY_ENTRY = "main-memory-4mb.bin";
const METADATA_ENTRY = "metadata.json";
const CURRENT_SAVE_ENTRY = "current-battery-save.sav";
const INITIAL_SAVE_ENTRY = "initial-battery-save.sav";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const ZIP_EOCD_MAX_SEARCH = 66_000;
const PARTY_SCAN_CHUNK_SIZE = 64 * 1024;
const PK5_PARTY_SIZE = 220;
const PK5_STORED_SIZE = 136;
const PK5_BLOCK_SIZE = 32;
const PARTY_SCAN_OVERLAP = PK5_PARTY_SIZE;
const RAW_TRPOK_SCAN_OVERLAP = 32;
const RAW_TRPOK_MIN_SIZE = 8;

const BLOCK_POSITION = [
  0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2,
  0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
  2, 0, 1, 3, 3, 0, 1, 2, 2, 0, 3, 1, 3, 0, 2, 1,
  1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2,
  2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0,
  2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0,
  0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2,
  0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
] as const;

const args = parseArgs(process.argv.slice(2));
const file = args.file ? resolvePath(args.file) : findNewestStateZip();
if (!file) {
  throw new Error(
    "Usage: npm run state:inspect -- [state.zip] [--json] [--scan-party] [--scan-trpok] [--levels 1,25] [--species 554,532] [--memory-window 0x1234:0x80]",
  );
}

const zip = openZip(file);
try {
  const metadata = readJsonEntry(zip, METADATA_ENTRY);
  const summary = {
    file: zip.path,
    fileSize: zip.size,
    metadata,
    entries: zip.entries.map((entry) => ({
      name: entry.name,
      method: zipMethodName(entry.method),
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      crc32: hex(entry.crc32, 8),
    })),
    memoryWindow: args.memoryWindow ? readMemoryWindow(zip, args.memoryWindow) : undefined,
    partyCandidates: args.scanParty ? scanPartyCandidates(zip, args.levels, args.maxCandidates) : undefined,
    rawTrpokCandidates: args.scanTrpok ? scanRawTrpokCandidates(zip, args.levels, args.species, args.maxCandidates) : undefined,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }
} finally {
  closeSync(zip.fd);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    json: false,
    scanParty: false,
    scanTrpok: false,
    levels: new Set([1, 25]),
    maxCandidates: 24,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--scan-party") {
      args.scanParty = true;
    } else if (arg === "--scan-trpok") {
      args.scanTrpok = true;
    } else if (arg === "--levels") {
      args.levels = parseNumberSet(argv[++index], "--levels", 100);
    } else if (arg === "--species") {
      args.species = parseNumberSet(argv[++index], "--species", 649);
    } else if (arg === "--max-candidates") {
      args.maxCandidates = parsePositiveInt(argv[++index], "--max-candidates");
    } else if (arg === "--memory-window") {
      args.memoryWindow = parseMemoryWindow(argv[++index]);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!args.file) {
      args.file = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  return args;
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function findNewestStateZip(): string | undefined {
  const roots = [process.cwd(), dirname(process.cwd())];
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const root of roots) {
    for (const name of safeReaddir(root)) {
      if (!name.endsWith(".pokeweb-state.zip")) continue;
      const path = join(root, name);
      const stats = statSync(path);
      if (stats.isFile()) candidates.push({ path, mtimeMs: stats.mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path;
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function openZip(path: string): ZipHandle {
  const fd = openSync(path, "r");
  const size = fstatSync(fd).size;
  const entries = readCentralDirectory(fd, size);
  return { fd, path, size, entries };
}

function readCentralDirectory(fd: number, fileSize: number): ZipEntry[] {
  const tailLength = Math.min(fileSize, ZIP_EOCD_MAX_SEARCH);
  const tail = readAt(fd, fileSize - tailLength, tailLength);
  const eocdOffsetInTail = findEocd(tail);
  if (eocdOffsetInTail < 0) throw new Error("Could not find ZIP end-of-central-directory record.");

  const eocd = tail.subarray(eocdOffsetInTail);
  const entryCount = readU16(eocd, 10);
  const centralSize = readU32(eocd, 12);
  const centralOffset = readU32(eocd, 16);
  const central = readAt(fd, centralOffset, centralSize);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(central, offset) !== ZIP_CENTRAL_SIGNATURE) throw new Error(`Bad ZIP central directory signature at ${hex(offset)}.`);
    const method = readU16(central, offset + 10);
    const crc32 = readU32(central, offset + 16);
    const compressedSize = readU32(central, offset + 20);
    const uncompressedSize = readU32(central, offset + 24);
    const nameLength = readU16(central, offset + 28);
    const extraLength = readU16(central, offset + 30);
    const commentLength = readU16(central, offset + 32);
    const localHeaderOffset = readU32(central, offset + 42);
    const name = new TextDecoder().decode(central.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, crc32, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEocd(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readU32(bytes, offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readJsonEntry(zip: ZipHandle, name: string): unknown {
  const entry = requireEntry(zip, name);
  return JSON.parse(new TextDecoder().decode(readEntry(zip, entry)));
}

function readEntry(zip: ZipHandle, entry: ZipEntry): Uint8Array {
  const compressed = readEntryCompressedBytes(zip, entry);
  if (entry.method === ZIP_STORED) return compressed;
  if (entry.method === ZIP_DEFLATED) return inflateRawSync(compressed);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}.`);
}

function readEntryCompressedBytes(zip: ZipHandle, entry: ZipEntry): Uint8Array {
  const dataOffset = entryDataOffset(zip, entry);
  return readAt(zip.fd, dataOffset, entry.compressedSize);
}

function readEntryStoredSlice(zip: ZipHandle, entry: ZipEntry, offset: number, length: number): Uint8Array {
  if (entry.method !== ZIP_STORED) {
    return readEntry(zip, entry).subarray(offset, offset + length);
  }
  const boundedOffset = Math.max(0, Math.min(entry.uncompressedSize, offset));
  const boundedLength = Math.max(0, Math.min(length, entry.uncompressedSize - boundedOffset));
  return readAt(zip.fd, entryDataOffset(zip, entry) + boundedOffset, boundedLength);
}

function entryDataOffset(zip: ZipHandle, entry: ZipEntry): number {
  const header = readAt(zip.fd, entry.localHeaderOffset, 30);
  if (readU32(header, 0) !== ZIP_LOCAL_SIGNATURE) throw new Error(`Bad ZIP local header signature for ${entry.name}.`);
  return entry.localHeaderOffset + 30 + readU16(header, 26) + readU16(header, 28);
}

function readMemoryWindow(zip: ZipHandle, window: { offset: number; length: number }): { offset: string; length: number; hex: string; ascii: string } {
  const entry = requireEntry(zip, MAIN_MEMORY_ENTRY);
  const data = readEntryStoredSlice(zip, entry, window.offset, window.length);
  return {
    offset: hex(window.offset),
    length: data.length,
    hex: formatHexBytes(data),
    ascii: formatAscii(data),
  };
}

function scanPartyCandidates(zip: ZipHandle, levels: Set<number>, maxCandidates: number): PartyCandidate[] {
  const entry = requireEntry(zip, MAIN_MEMORY_ENTRY);
  const candidates: PartyCandidate[] = [];
  for (let entryOffset = 0; entryOffset < entry.uncompressedSize && candidates.length < maxCandidates; entryOffset += PARTY_SCAN_CHUNK_SIZE) {
    const readStart = Math.max(0, entryOffset - PARTY_SCAN_OVERLAP);
    const readLength = Math.min(entry.uncompressedSize - readStart, PARTY_SCAN_CHUNK_SIZE + PARTY_SCAN_OVERLAP * 2);
    const chunk = readEntryStoredSlice(zip, entry, readStart, readLength);
    const scanStart = entryOffset - readStart;
    const scanEnd = Math.min(chunk.length - PK5_PARTY_SIZE, scanStart + PARTY_SCAN_CHUNK_SIZE);
    for (let offset = align4(scanStart); offset <= scanEnd && candidates.length < maxCandidates; offset += 4) {
      const candidate = readPartyCandidate(chunk, offset, readStart + offset, levels);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function scanRawTrpokCandidates(zip: ZipHandle, levels: Set<number>, speciesFilter: Set<number> | undefined, maxCandidates: number): RawTrpokCandidate[] {
  const entry = requireEntry(zip, MAIN_MEMORY_ENTRY);
  const candidates: RawTrpokCandidate[] = [];
  for (let entryOffset = 0; entryOffset < entry.uncompressedSize && candidates.length < maxCandidates; entryOffset += PARTY_SCAN_CHUNK_SIZE) {
    const readStart = Math.max(0, entryOffset - RAW_TRPOK_SCAN_OVERLAP);
    const readLength = Math.min(entry.uncompressedSize - readStart, PARTY_SCAN_CHUNK_SIZE + RAW_TRPOK_SCAN_OVERLAP * 2);
    const chunk = readEntryStoredSlice(zip, entry, readStart, readLength);
    const scanStart = entryOffset - readStart;
    const scanEnd = Math.min(chunk.length - RAW_TRPOK_MIN_SIZE, scanStart + PARTY_SCAN_CHUNK_SIZE);
    for (let offset = scanStart; offset <= scanEnd && candidates.length < maxCandidates; offset += 1) {
      const candidate = readRawTrpokCandidate(chunk, offset, readStart + offset, levels, speciesFilter);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function readPartyCandidate(bytes: Uint8Array, offset: number, absoluteOffset: number, levels: Set<number>): PartyCandidate | undefined {
  const decrypted = decryptPk5Party(bytes.subarray(offset, offset + PK5_PARTY_SIZE));
  if (readU16(decrypted, 6) !== add16(decrypted.subarray(8, PK5_STORED_SIZE))) return undefined;

  const species = readU16(decrypted, 0x08);
  if (species <= 0 || species > 649) return undefined;
  const nature = decrypted[0x41] ?? 0;
  if (nature > 24) return undefined;

  const level = decrypted[0x8c] ?? 0;
  if (!levels.has(level)) return undefined;

  const hp = readU16(decrypted, 0x8e);
  const maxHp = readU16(decrypted, 0x90);
  const atk = readU16(decrypted, 0x92);
  const def = readU16(decrypted, 0x94);
  const spe = readU16(decrypted, 0x96);
  const spa = readU16(decrypted, 0x98);
  const spd = readU16(decrypted, 0x9a);
  const stats = [maxHp, atk, def, spe, spa, spd];
  if (hp === 0 || maxHp === 0 || hp > maxHp || stats.some((stat) => stat === 0 || stat > 999)) return undefined;

  const pid = readU32(decrypted, 0);
  if (pid === 0 || pid === 0xffffffff) return undefined;
  return { offset: absoluteOffset, pid, species, item: readU16(decrypted, 0x0a), exp: readU32(decrypted, 0x10), nature, level, hp, maxHp, atk, def, spe, spa, spd };
}

function readRawTrpokCandidate(bytes: Uint8Array, offset: number, absoluteOffset: number, levels: Set<number>, speciesFilter: Set<number> | undefined): RawTrpokCandidate | undefined {
  const level = bytes[offset + 2] ?? 0;
  if (!levels.has(level)) return undefined;
  const natureByte = bytes[offset + 3] ?? 0;
  if (natureByte > 25) return undefined;
  const species = readU16(bytes, offset + 4);
  if (species <= 0 || species > 649 || (speciesFilter && !speciesFilter.has(species))) return undefined;
  const abilityGender = bytes[offset + 1] ?? 0;
  if (abilityGender > 0x35 && abilityGender !== 0xff) return undefined;
  const form = readU16(bytes, offset + 6);
  if (form > 31) return undefined;
  return {
    offset: absoluteOffset,
    ivs: bytes[offset] ?? 0,
    abilityGender,
    level,
    natureByte,
    species,
    form,
    raw: formatInlineHex(bytes.subarray(offset, Math.min(bytes.length, offset + 24))),
  };
}

function requireEntry(zip: ZipHandle, name: string): ZipEntry {
  const entry = zip.entries.find((entry) => entry.name === name);
  if (!entry) throw new Error(`${basename(zip.path)} does not contain ${name}.`);
  return entry;
}

function printSummary(summary: {
  file: string;
  fileSize: number;
  metadata: unknown;
  entries: Array<{ name: string; method: string; compressedSize: number; uncompressedSize: number; crc32: string }>;
  memoryWindow?: { offset: string; length: number; hex: string; ascii: string };
  partyCandidates?: PartyCandidate[];
  rawTrpokCandidates?: RawTrpokCandidate[];
}): void {
  const metadata = summary.metadata as Record<string, unknown>;
  console.log(`State: ${summary.file}`);
  console.log(`ZIP size: ${formatBytes(summary.fileSize)}`);
  console.log(`Created: ${String(metadata.createdAt ?? "unknown")}`);
  console.log(`Test: ${String(metadata.testLabel ?? "unknown")} (trainer ${String(metadata.trainerId ?? "unknown")})`);
  console.log(`ROM: ${String(metadata.romName ?? "unknown")} (${formatBytes(Number(metadata.romByteLength ?? 0))})`);
  console.log(`Frame: ${String(metadata.frameCount ?? "unknown")}; paused=${String(metadata.paused ?? "unknown")}; speed=${String(metadata.speedMultiplier ?? "unknown")}`);
  console.log("");
  console.log("Entries:");
  for (const entry of summary.entries) {
    console.log(`  ${entry.name.padEnd(28)} ${entry.method.padEnd(8)} ${formatBytes(entry.uncompressedSize).padStart(10)} crc=${entry.crc32}`);
  }
  if (summary.memoryWindow) {
    console.log("");
    console.log(`Memory window @ ${summary.memoryWindow.offset} (${summary.memoryWindow.length} bytes):`);
    console.log(summary.memoryWindow.hex);
    console.log(summary.memoryWindow.ascii);
  }
  if (summary.partyCandidates) {
    console.log("");
    console.log(`Party-like records (${summary.partyCandidates.length}):`);
    for (const candidate of summary.partyCandidates) {
      console.log(
        `  @${hex(candidate.offset, 6)} species=${candidate.species} item=${candidate.item} exp=${candidate.exp} nature=${candidate.nature} pid=${hex(candidate.pid, 8)} level=${candidate.level} hp=${candidate.hp}/${candidate.maxHp} stats=${candidate.atk}/${candidate.def}/${candidate.spe}/${candidate.spa}/${candidate.spd}`,
      );
    }
  }
  if (summary.rawTrpokCandidates) {
    console.log("");
    console.log(`Raw trpok-like slots (${summary.rawTrpokCandidates.length}):`);
    for (const candidate of summary.rawTrpokCandidates) {
      console.log(
        `  @${hex(candidate.offset, 6)} species=${candidate.species} level=${candidate.level} natureByte=${candidate.natureByte} ivs=${candidate.ivs} abilityGender=${candidate.abilityGender} form=${candidate.form} raw=${candidate.raw}`,
      );
    }
  }
}

function decryptPk5Party(encrypted: Uint8Array): Uint8Array {
  const out = encrypted.slice(0, PK5_PARTY_SIZE);
  const pid = readU32(out, 0);
  const checksum = readU16(out, 6);
  const shuffleValue = (pid >>> 13) & 31;
  cryptArray(out, 8, PK5_STORED_SIZE - 8, checksum);
  cryptArray(out, PK5_STORED_SIZE, PK5_PARTY_SIZE - PK5_STORED_SIZE, pid);
  shuffle45(out, 8, shuffleValue);
  return out;
}

function shuffle45(bytes: Uint8Array, offset: number, shuffleValue: number): void {
  if (shuffleValue === 0) return;
  const perm = [0, 1, 2, 3];
  const slotOf = [0, 1, 2, 3];
  const shuffleOffset = shuffleValue * 4;
  for (let index = 0; index < 3; index += 1) {
    const desired = BLOCK_POSITION[shuffleOffset + index] ?? index;
    const swapSlot = slotOf[desired] ?? index;
    if (swapSlot === index) continue;
    swapBlocks(bytes, offset + index * PK5_BLOCK_SIZE, offset + swapSlot * PK5_BLOCK_SIZE, PK5_BLOCK_SIZE);
    const blockAtIndex = perm[index] ?? index;
    perm[swapSlot] = blockAtIndex;
    slotOf[blockAtIndex] = swapSlot;
  }
}

function swapBlocks(bytes: Uint8Array, left: number, right: number, length: number): void {
  for (let index = 0; index < length; index += 1) {
    const value = bytes[left] ?? 0;
    bytes[left] = bytes[right] ?? 0;
    bytes[right] = value;
    left += 1;
    right += 1;
  }
}

function cryptArray(bytes: Uint8Array, offset: number, length: number, seed: number): void {
  let state = seed >>> 0;
  for (let cursor = offset; cursor < offset + length; cursor += 2) {
    state = (Math.imul(0x41c64e6d, state) + 0x6073) >>> 0;
    const value = readU16(bytes, cursor) ^ (state >>> 16);
    bytes[cursor] = value & 0xff;
    bytes[cursor + 1] = (value >>> 8) & 0xff;
  }
}

function add16(bytes: Uint8Array): number {
  let checksum = 0;
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    checksum = (checksum + readU16(bytes, offset)) & 0xffff;
  }
  return checksum;
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function parseNumberSet(value: string | undefined, label: string, max: number): Set<number> {
  if (!value) throw new Error(`${label} requires a comma-separated list.`);
  const values = value.split(",").map((part) => parsePositiveInt(part.trim(), label));
  for (const item of values) {
    if (item > max) throw new Error(`${label} values must be 1..${max}.`);
  }
  return new Set(values);
}

function parseMemoryWindow(value: string | undefined): { offset: number; length: number } {
  if (!value) throw new Error("--memory-window requires offset:length.");
  const [offsetText, lengthText] = value.split(":");
  if (!offsetText || !lengthText) throw new Error("--memory-window requires offset:length.");
  return { offset: parseInteger(offsetText, "--memory-window offset"), length: parsePositiveInt(lengthText, "--memory-window length") };
}

function parsePositiveInt(value: string | undefined, label: string): number {
  const parsed = parseInteger(value, label);
  if (parsed <= 0) throw new Error(`${label} must be positive.`);
  return parsed;
}

function parseInteger(value: string | undefined, label: string): number {
  if (!value) throw new Error(`${label} requires a value.`);
  const parsed = value.startsWith("0x") ? Number.parseInt(value, 16) : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

function readAt(fd: number, position: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(fd, out, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error(`Unexpected EOF at ${hex(position + offset)}.`);
    offset += bytesRead;
  }
  return out;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function zipMethodName(method: number): string {
  if (method === ZIP_STORED) return "stored";
  if (method === ZIP_DEFLATED) return "deflate";
  return `method-${method}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return `${value || 0} bytes`;
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatHexBytes(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    lines.push(`${hex(offset, 4)}  ${[...chunk].map((byte) => hex(byte, 2).slice(2)).join(" ")}`);
  }
  return lines.join("\n");
}

function formatInlineHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => hex(byte, 2).slice(2)).join(" ");
}

function formatAscii(bytes: Uint8Array): string {
  return [...bytes].map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join("");
}

function hex(value: number, width = 0): string {
  return `0x${(value >>> 0).toString(16).padStart(width, "0")}`;
}
