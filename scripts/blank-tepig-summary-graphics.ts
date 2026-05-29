import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compressLz11Literal, decompressNitro } from "../src/pokeweb/pokemonSpriteModel";

const root = resolve("../White2Upgrade/data/graphics/pokegra/battle_sprites");
const blankGraphicsBaseIndex = 20460;
const targets = [
  { name: "Tepig", baseIndex: 498 * 20 },
  { name: "Oshawott", baseIndex: 501 * 20 },
];
const graphicsFileOffsets = [0, 2, 9, 11];
const cellBankFileOffsets = [4, 13];
const multiCellFileOffsets = [6, 15];

function battleSpriteFileName(index: number): string {
  return `004_${index.toString().padStart(8, "0")}.bin`;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
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

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeS16(bytes: Uint8Array, offset: number, value: number): void {
  writeU16(bytes, offset, value & 0xffff);
}

function isCompressed(bytes: Uint8Array): boolean {
  return bytes[0] === 0x10 || bytes[0] === 0x11;
}

function decodeNitroFile(raw: Uint8Array): { bytes: Uint8Array; compressed: boolean } {
  return isCompressed(raw) ? { bytes: decompressNitro(raw), compressed: true } : { bytes: raw.slice(), compressed: false };
}

function writeNitroFile(path: string, bytes: Uint8Array, compressed: boolean): void {
  writeFileSync(path, compressed ? compressLz11Literal(bytes) : bytes);
}

function findBlock(bytes: Uint8Array, signature: string): number {
  const headerSize = readU16(bytes, 0x0c);
  const sectionCount = readU16(bytes, 0x0e);
  let offset = headerSize;
  for (let i = 0; i < sectionCount && offset + 8 <= bytes.length; i += 1) {
    const blockSize = readU32(bytes, offset + 4);
    if (readAscii(bytes, offset, 4) === signature) return offset;
    offset += blockSize;
  }
  throw new Error(`Missing ${signature} block`);
}

function targetFiles(offsets: number[]): Array<{ targetName: string; fileName: string }> {
  return targets.flatMap((target) =>
    offsets.map((offset) => ({
      targetName: target.name,
      fileName: battleSpriteFileName(target.baseIndex + offset),
    })),
  );
}

for (const { targetName, fileName } of targetFiles(graphicsFileOffsets)) {
  const path = resolve(root, fileName);
  const raw = new Uint8Array(readFileSync(path));
  const { bytes: ncgr, compressed } = decodeNitroFile(raw);
  if (readAscii(ncgr, 0, 4) !== "RGCN") throw new Error(`${fileName} is not an NCGR file`);

  const rahc = findBlock(ncgr, "RAHC");
  const dataSize = readU32(ncgr, rahc + 24);
  const dataOffset = rahc + 32;
  ncgr.fill(0, dataOffset, Math.min(ncgr.length, dataOffset + dataSize));
  writeNitroFile(path, ncgr, compressed);
  console.log(`blanked ${targetName} ${fileName}: ${dataSize} bytes`);
}

for (const { targetName, fileName } of targetFiles(cellBankFileOffsets)) {
  const path = resolve(root, fileName);
  const raw = new Uint8Array(readFileSync(path));
  const { bytes: ncer, compressed } = decodeNitroFile(raw);
  if (readAscii(ncer, 0, 4) !== "RECN") throw new Error(`${fileName} is not an NCER file`);

  const cebk = findBlock(ncer, "KBEC");
  const count = readU16(ncer, cebk + 8);
  const bankAttribs = readU16(ncer, cebk + 10);
  const cellDataOffset = cebk + 8 + readU32(ncer, cebk + 12);
  const cellRecordSize = 8 + (bankAttribs === 1 ? 8 : 0);
  const oamDataOffset = cellDataOffset + count * cellRecordSize;
  let oams = 0;

  for (let index = 0; index < count; index += 1) {
    const cellOffset = cellDataOffset + index * cellRecordSize;
    if (cellOffset + cellRecordSize > ncer.length) break;
    const nAttribs = readU16(ncer, cellOffset);
    const attrOffset = oamDataOffset + readU32(ncer, cellOffset + 4);
    for (let oamIndex = 0; oamIndex < nAttribs; oamIndex += 1) {
      const oamOffset = attrOffset + oamIndex * 6;
      if (oamOffset + 6 > ncer.length) break;
      writeU16(ncer, oamOffset, 0x02f0);
      writeU16(ncer, oamOffset + 2, 0x01ff);
      writeU16(ncer, oamOffset + 4, 0);
      oams++;
    }
    writeU16(ncer, cellOffset, 0);
    writeU16(ncer, cellOffset + 2, 0);
    if (bankAttribs === 1) {
      writeS16(ncer, cellOffset + 8, -256);
      writeS16(ncer, cellOffset + 10, -256);
      writeS16(ncer, cellOffset + 12, -256);
      writeS16(ncer, cellOffset + 14, -256);
    }
  }

  writeNitroFile(path, ncer, compressed);
  console.log(`blanked ${targetName} ${fileName}: ${count} cells, disabled ${oams} OAMs`);
}

for (const { targetName, fileName } of targetFiles(multiCellFileOffsets)) {
  const path = resolve(root, fileName);
  const raw = new Uint8Array(readFileSync(path));
  const { bytes: nmcr, compressed } = decodeNitroFile(raw);
  if (readAscii(nmcr, 0, 4) !== "RCMN") throw new Error(`${fileName} is not an NMCR file`);

  const mcbk = findBlock(nmcr, "KBCM");
  const count = readU16(nmcr, mcbk + 8);
  const multiCellOffset = mcbk + 8 + readU32(nmcr, mcbk + 12);
  const hierarchyOffset = mcbk + 8 + readU32(nmcr, mcbk + 16);
  let nodes = 0;

  for (let index = 0; index < count; index += 1) {
    const offset = multiCellOffset + index * 8;
    if (offset + 8 > nmcr.length) break;
    const nodeCount = readU16(nmcr, offset);
    const nodeOffset = hierarchyOffset + readU32(nmcr, offset + 4);
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const node = nodeOffset + nodeIndex * 8;
      if (node + 8 > nmcr.length) break;
      const nodeAttr = readU16(nmcr, node + 6);
      writeS16(nmcr, node + 2, -512);
      writeS16(nmcr, node + 4, -512);
      writeU16(nmcr, node + 6, nodeAttr & ~(1 << 5));
      nodes++;
    }
  }

  writeNitroFile(path, nmcr, compressed);
  console.log(`hid ${targetName} ${fileName}: ${nodes} multi-cell nodes`);
}

for (let i = 0; i < 20; i += 1) {
  const targetName = battleSpriteFileName(blankGraphicsBaseIndex + i);
  rmSync(resolve(root, targetName), { force: true });
}
