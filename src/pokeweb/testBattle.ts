import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "./exportRom";
import { getNarcFormats } from "./formats";
import type { ProjectState } from "./projectStore";
import { patchTestBattleSavePlayerParty } from "./testBattleTeam";

const TEST_BATTLE_SAVE_URL = new URL("../assets/testbattle/test.sav", import.meta.url);
const BW2_HEADERS_NARC_PATH = "a/0/1/2";
const BW2_TRDATA_NARC_PATH = "a/0/9/1";
const BW2_TRPOK_NARC_PATH = "a/0/9/2";
const BW2_OVERWORLDS_NARC_PATH = "a/1/2/6";
const TEST_BATTLE_BASE_TRAINER_ID = 2;
const TEST_BATTLE_SCRIPT_ID = 3000 + TEST_BATTLE_BASE_TRAINER_ID;
const TEST_BATTLE_NPC_SIZE = 36;
const TEST_BATTLE_HEADER_SIZE = 8;
const TEST_BATTLE_MMDL_BLOCK_OFFSET = 0x1e200;
const TEST_BATTLE_MMDL_BLOCK_LENGTH = 0x1400;
const TEST_BATTLE_MMDL_CHECKSUM_OFFSET = 0x1f602;
const TEST_BATTLE_MMDL_CHECKSUM_MIRROR = 0x25f52;
const TEST_BATTLE_CHECKSUM_BLOCK_OFFSET = 0x25f00;
const TEST_BATTLE_CHECKSUM_BLOCK_LENGTH = 0x94;
const TEST_BATTLE_CHECKSUM_BLOCK_CHECKSUM_OFFSET = 0x25fa2;
const TEST_BATTLE_SAVE_HALF_OFFSET = 0x26000;
const TEST_BATTLE_MMDL_SAVEWORK_SIZE = 80;
const TEST_BATTLE_MMDL_SAVEWORK_COUNT = 64;
const TEST_BATTLE_EYE_RANGE = 10;
const TEST_BATTLE_DIRECTION_UP = 0;
const TEST_BATTLE_EV_TYPE_TRAINER = 1;
const TEST_BATTLE_SAVE_POSITION_BLOCK = 0x19500;
const DESMUME_DSV_TEXT_FOOTER = "|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:";
const DESMUME_DSV_COOKIE = "|-DESMUME SAVE-|";
const DESMUME_DSV_VERSION = 0;
const DESMUME_DSV_FLASH_ADDR_SIZE = 3;
const DESMUME_SAVE_TYPES = [
  0x000200, // EEPROM 4kbit
  0x002000, // EEPROM 64kbit
  0x010000, // EEPROM 512kbit
  0x008000, // FRAM 256kbit
  0x040000, // FLASH 2Mbit
  0x080000, // FLASH 4Mbit
  0x100000, // FLASH 8Mbit
  0x200000, // FLASH 16Mbit
  0x400000, // FLASH 32Mbit
  0x800000, // FLASH 64Mbit
  0x1000000, // FLASH 128Mbit
  0x2000000, // FLASH 256Mbit
  0x4000000, // FLASH 512Mbit
];

export type TestBattleDownload = {
  romBytes: Uint8Array;
  saveBytes: Uint8Array;
};

export type TestBattleBuildOptions = {
  playerTeamText?: string;
};

type TestBattleSave = {
  rawSaveBytes: Uint8Array;
  zoneId: number;
  gridX: number;
  gridY: number;
  gridZ: number;
};

type OverworldLayout = {
  furnitureCount: number;
  npcCount: number;
  warpCount: number;
  triggerCount: number;
  npcOffset: number;
  npcEnd: number;
  payloadEnd: number;
};

type TestBattleOverworldPatch = {
  romBytes: Uint8Array;
  npc: Uint8Array;
};

export async function buildTestBattleDownloads(project: ProjectState, trainerId: number, options: TestBattleBuildOptions = {}): Promise<TestBattleDownload> {
  if (project.session.baseRom !== "BW2") throw new Error("Test Battle currently supports Black 2 / White 2 projects only.");

  const [baseRomBytes, save] = await Promise.all([exportModifiedRom(project, { preserveOriginalLength: true }), loadTestBattleSave()]);
  const trainerPatchedRom = patchTestBattleTrainerSlot(baseRomBytes, project, trainerId);
  const { romBytes, npc } = patchTestBattleOverworldNpc(trainerPatchedRom, project, save);
  const patchedMapSaveBytes = patchTestBattleSaveMmdl(save.rawSaveBytes, save, npc);
  const patchedSaveBytes = patchTestBattleSavePlayerParty(patchedMapSaveBytes, project, options.playerTeamText ?? "");
  return { romBytes, saveBytes: toDesmumeDsv(patchedSaveBytes) };
}

async function loadTestBattleSave(): Promise<TestBattleSave> {
  const response = await fetch(TEST_BATTLE_SAVE_URL);
  if (!response.ok) throw new Error(`Failed to load bundled test battle save: ${response.status}`);
  const rawSaveBytes = new Uint8Array(await response.arrayBuffer());
  return {
    rawSaveBytes,
    ...readTestBattleSavePosition(rawSaveBytes),
  };
}

function patchTestBattleTrainerSlot(romBytes: Uint8Array, project: ProjectState, trainerId: number): Uint8Array {
  if (trainerId === TEST_BATTLE_BASE_TRAINER_ID) return romBytes;

  const rom = new NintendoDSRom(romBytes);
  const trdataFileId = project.narcs.trdata?.fileId ?? project.session.fileIds.trdata ?? rom.fileId(BW2_TRDATA_NARC_PATH);
  const trpokFileId = project.narcs.trpok?.fileId ?? project.session.fileIds.trpok ?? rom.fileId(BW2_TRPOK_NARC_PATH);
  const trdata = copyTrainerNarcEntry(rom.files[trdataFileId], trainerId, "trainer data");
  const trpok = copyTrainerNarcEntry(rom.files[trpokFileId], trainerId, "trainer Pokemon");
  return rom.save({
    files: new Map([
      [trdataFileId, trdata],
      [trpokFileId, trpok],
    ]),
    preserveOriginalLength: true,
  });
}

function copyTrainerNarcEntry(narcBytes: Uint8Array, trainerId: number, label: string): Uint8Array {
  const narc = new NARC(narcBytes);
  const source = narc.files[trainerId];
  if (!source) throw new Error(`Trainer ${trainerId} does not exist in ${label}.`);
  if (!narc.files[TEST_BATTLE_BASE_TRAINER_ID]) throw new Error(`Test Battle base trainer ${TEST_BATTLE_BASE_TRAINER_ID} does not exist in ${label}.`);
  narc.files[TEST_BATTLE_BASE_TRAINER_ID] = source.slice();
  return narc.save();
}

function patchTestBattleOverworldNpc(romBytes: Uint8Array, project: ProjectState, save: TestBattleSave): TestBattleOverworldPatch {
  const rom = new NintendoDSRom(romBytes);
  const overworldsFileId = project.narcs.overworlds?.fileId ?? project.session.fileIds.overworlds ?? rom.fileId(BW2_OVERWORLDS_NARC_PATH);
  const overworlds = new NARC(rom.files[overworldsFileId]);
  const overworldId = resolveOverworldIdForSaveZone(rom, project, save.zoneId);
  const target = overworlds.files[overworldId];
  if (!target) throw new Error(`Test Battle save zone ${save.zoneId} resolves to overworld ${overworldId}, but that overworld file does not exist.`);

  const template = findTrainerNpcTemplate(overworlds.files);
  const patched = appendTestBattleNpc(target, save, overworldId, template);
  overworlds.files[overworldId] = patched.bytes;
  if (overworldId !== save.zoneId && overworlds.files[save.zoneId]) {
    overworlds.files[save.zoneId] = appendTestBattleNpc(overworlds.files[save.zoneId], save, save.zoneId, template).bytes;
  }
  return {
    npc: patched.npc,
    romBytes: rom.save({
    files: new Map([[overworldsFileId, overworlds.save()]]),
    preserveOriginalLength: true,
    }),
  };
}

function appendTestBattleNpc(bytes: Uint8Array, save: TestBattleSave, overworldId: number, template: Uint8Array | undefined): { bytes: Uint8Array; npc: Uint8Array } {
  const layout = readOverworldLayout(bytes);
  if (!layout) throw new Error(`Could not parse overworld ${overworldId} for Test Battle NPC insertion.`);
  if (layout.npcCount >= 0xff) throw new Error(`Overworld ${overworldId} already has the maximum supported NPC count.`);

  const npc = buildTestBattleNpc(bytes, layout, save, template);
  const out = new Uint8Array(bytes.length + TEST_BATTLE_NPC_SIZE);
  out.set(bytes.subarray(0, layout.npcEnd), 0);
  out.set(npc, layout.npcEnd);
  out.set(bytes.subarray(layout.npcEnd), layout.npcEnd + TEST_BATTLE_NPC_SIZE);
  writeLe32(out, 0, readLe32(bytes, 0) + TEST_BATTLE_NPC_SIZE);
  out[5] = layout.npcCount + 1;
  return { bytes: out, npc };
}

function resolveOverworldIdForSaveZone(rom: NintendoDSRom, project: ProjectState, zoneId: number): number {
  const headersFileId = project.narcs.headers?.fileId ?? project.session.fileIds.headers ?? rom.fileId(BW2_HEADERS_NARC_PATH);
  const headers = new NARC(rom.files[headersFileId]);
  const headerBytes = headers.files[0];
  const format = project.formats.headers ?? getNarcFormats("BW2").headers;
  if (!headerBytes || !format) return zoneId;

  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const mapIdOffset = fieldOffset(format, "map_id");
  if (mapIdOffset === undefined) return zoneId;
  const offset = zoneId * rowLength + mapIdOffset;
  if (offset + 2 > headerBytes.length) return zoneId;
  return readLe16(headerBytes, offset);
}

function patchTestBattleSaveMmdl(saveBytes: Uint8Array, save: TestBattleSave, npc: Uint8Array): Uint8Array {
  const out = saveBytes.slice();
  patchTestBattleSaveMmdlHalf(out, 0, save, npc);
  if (out.length >= TEST_BATTLE_SAVE_HALF_OFFSET + TEST_BATTLE_CHECKSUM_BLOCK_CHECKSUM_OFFSET + 2) {
    patchTestBattleSaveMmdlHalf(out, TEST_BATTLE_SAVE_HALF_OFFSET, save, npc);
  }
  return out;
}

function patchTestBattleSaveMmdlHalf(out: Uint8Array, halfOffset: number, save: TestBattleSave, npc: Uint8Array): void {
  const blockOffset = halfOffset + TEST_BATTLE_MMDL_BLOCK_OFFSET;
  const slotOffset = findMmdlSaveSlot(out, blockOffset, npc[0]);
  if (slotOffset === undefined) throw new Error("The bundled test battle save has no free overworld actor save slot.");

  writeMmdlSavework(out, slotOffset, save, npc);
  refreshB2W2BlockChecksum(out, halfOffset + TEST_BATTLE_MMDL_BLOCK_OFFSET, TEST_BATTLE_MMDL_BLOCK_LENGTH, halfOffset + TEST_BATTLE_MMDL_CHECKSUM_OFFSET, halfOffset + TEST_BATTLE_MMDL_CHECKSUM_MIRROR);
  refreshB2W2BlockChecksum(
    out,
    halfOffset + TEST_BATTLE_CHECKSUM_BLOCK_OFFSET,
    TEST_BATTLE_CHECKSUM_BLOCK_LENGTH,
    halfOffset + TEST_BATTLE_CHECKSUM_BLOCK_CHECKSUM_OFFSET,
    halfOffset + TEST_BATTLE_CHECKSUM_BLOCK_CHECKSUM_OFFSET,
  );
}

function findMmdlSaveSlot(bytes: Uint8Array, blockOffset: number, npcUid: number): number | undefined {
  let firstFree: number | undefined;
  for (let index = 0; index < TEST_BATTLE_MMDL_SAVEWORK_COUNT; index += 1) {
    const offset = blockOffset + index * TEST_BATTLE_MMDL_SAVEWORK_SIZE;
    const status = readLe32(bytes, offset);
    if ((status & 1) === 0) {
      firstFree ??= offset;
      continue;
    }
    if (bytes[offset + 8] === npcUid && readLe16(bytes, offset + 24) === TEST_BATTLE_SCRIPT_ID) return offset;
  }
  return firstFree;
}

function writeMmdlSavework(out: Uint8Array, offset: number, save: TestBattleSave, npc: Uint8Array): void {
  out.fill(0, offset, offset + TEST_BATTLE_MMDL_SAVEWORK_SIZE);
  writeLe32(out, offset, 0x00000003);
  out[offset + 4] = 1;
  out[offset + 5] = 1;
  out[offset + 8] = npc[0];
  out[offset + 9] = readLe16(npc, 4) & 0xff;
  out[offset + 10] = readLe16(npc, 20) & 0xff;
  out[offset + 11] = readLe16(npc, 22) & 0xff;
  out[offset + 12] = TEST_BATTLE_DIRECTION_UP;
  out[offset + 13] = TEST_BATTLE_DIRECTION_UP;
  out[offset + 14] = TEST_BATTLE_DIRECTION_UP;
  writeLe16(out, offset + 16, save.zoneId);
  writeLe16(out, offset + 18, readLe16(npc, 2));
  writeLe16(out, offset + 20, readLe16(npc, 6));
  writeLe16(out, offset + 22, readLe16(npc, 8));
  writeLe16(out, offset + 24, readLe16(npc, 10));
  writeLe16(out, offset + 26, readLe16(npc, 14));
  writeLe16(out, offset + 28, readLe16(npc, 16));
  writeLe16(out, offset + 30, readLe16(npc, 18));
  writeLe16(out, offset + 32, save.gridX);
  writeLe16(out, offset + 34, save.gridY);
  writeLe16(out, offset + 36, clampU16(save.gridZ + 1));
  writeLe16(out, offset + 38, save.gridX);
  writeLe16(out, offset + 40, save.gridY);
  writeLe16(out, offset + 42, clampU16(save.gridZ + 1));
  writeLe32(out, offset + 44, save.gridY * 0x10000 + 0x0f);
}

function refreshB2W2BlockChecksum(out: Uint8Array, blockOffset: number, blockLength: number, checksumOffset: number, checksumMirror: number): void {
  const checksum = crc16Ccitt(out.subarray(blockOffset, blockOffset + blockLength));
  writeLe16(out, checksumOffset, checksum);
  writeLe16(out, checksumMirror, checksum);
}

function buildTestBattleNpc(bytes: Uint8Array, layout: OverworldLayout, save: TestBattleSave, template: Uint8Array | undefined): Uint8Array {
  const npc = template?.slice(0, TEST_BATTLE_NPC_SIZE) ?? new Uint8Array(TEST_BATTLE_NPC_SIZE);
  const fallbackSprite = readFirstNpcSprite(bytes, layout) ?? 1;
  writeLe16(npc, 0, nextOverworldNpcUid(bytes, layout));
  if (readLe16(npc, 2) === 0) writeLe16(npc, 2, fallbackSprite);
  writeLe16(npc, 4, 0);
  writeLe16(npc, 6, TEST_BATTLE_EV_TYPE_TRAINER);
  writeLe16(npc, 8, 0);
  writeLe16(npc, 10, TEST_BATTLE_SCRIPT_ID);
  writeLe16(npc, 12, TEST_BATTLE_DIRECTION_UP);
  writeLe16(npc, 14, TEST_BATTLE_EYE_RANGE);
  writeLe16(npc, 20, 0);
  writeLe16(npc, 22, 0);
  writeLe16(npc, 24, 0);
  writeLe16(npc, 26, 0);
  writeLe16(npc, 28, save.gridX);
  writeLe16(npc, 30, clampU16(save.gridZ + 1));
  writeLe32(npc, 32, save.gridY);
  return npc;
}

function findTrainerNpcTemplate(files: Uint8Array[]): Uint8Array | undefined {
  for (const bytes of files) {
    const layout = readOverworldLayout(bytes);
    if (!layout) continue;
    for (let index = 0; index < layout.npcCount; index += 1) {
      const offset = layout.npcOffset + index * TEST_BATTLE_NPC_SIZE;
      const eventType = readLe16(bytes, offset + 6);
      const scriptId = readLe16(bytes, offset + 10);
      const sight = readLe16(bytes, offset + 14);
      if (scriptId >= 3000 && scriptId < 4000 && sight > 0 && eventType > 0) {
        return bytes.slice(offset, offset + TEST_BATTLE_NPC_SIZE);
      }
    }
  }
  return undefined;
}

function readOverworldLayout(bytes: Uint8Array): OverworldLayout | undefined {
  if (bytes.length < TEST_BATTLE_HEADER_SIZE) return undefined;
  const furnitureCount = bytes[4] ?? 0;
  const npcCount = bytes[5] ?? 0;
  const warpCount = bytes[6] ?? 0;
  const triggerCount = bytes[7] ?? 0;
  const furnitureSize = 20;
  const warpSize = 20;
  const triggerSize = 22;
  const npcOffset = TEST_BATTLE_HEADER_SIZE + furnitureCount * furnitureSize;
  const npcEnd = npcOffset + npcCount * TEST_BATTLE_NPC_SIZE;
  const payloadEnd = npcEnd + warpCount * warpSize + triggerCount * triggerSize;
  if (payloadEnd > bytes.length) return undefined;
  return { furnitureCount, npcCount, warpCount, triggerCount, npcOffset, npcEnd, payloadEnd };
}

function nextOverworldNpcUid(bytes: Uint8Array, layout: OverworldLayout): number {
  let max = 0;
  for (let index = 0; index < layout.npcCount; index += 1) {
    max = Math.max(max, readLe16(bytes, layout.npcOffset + index * TEST_BATTLE_NPC_SIZE));
  }
  return Math.min(max + 1, 0xffff);
}

function readFirstNpcSprite(bytes: Uint8Array, layout: OverworldLayout): number | undefined {
  if (layout.npcCount === 0) return undefined;
  const sprite = readLe16(bytes, layout.npcOffset + 2);
  return sprite > 0 ? sprite : undefined;
}

function readTestBattleSavePosition(saveBytes: Uint8Array): Omit<TestBattleSave, "rawSaveBytes"> {
  if (saveBytes.length < TEST_BATTLE_SAVE_POSITION_BLOCK + 0x90) {
    throw new Error("Bundled test battle save is too small to contain a BW2 trainer position block.");
  }
  return {
    zoneId: readLe32(saveBytes, TEST_BATTLE_SAVE_POSITION_BLOCK + 0x80),
    gridX: readLe16(saveBytes, TEST_BATTLE_SAVE_POSITION_BLOCK + 0x86),
    gridY: readLe16(saveBytes, TEST_BATTLE_SAVE_POSITION_BLOCK + 0x8a),
    gridZ: readLe16(saveBytes, TEST_BATTLE_SAVE_POSITION_BLOCK + 0x8e),
  };
}

function fieldOffset(format: Array<[number, string]>, field: string): number | undefined {
  let offset = 0;
  for (const [size, name] of format) {
    if (name === field) return offset;
    offset += size;
  }
  return undefined;
}

function toDesmumeDsv(saveBytes: Uint8Array): Uint8Array {
  if (hasDesmumeDsvCookie(saveBytes)) return saveBytes;

  const paddedSize = desmumePaddedSaveSize(saveBytes.length);
  const backupType = desmumeBackupType(paddedSize);
  const textFooter = asciiBytes(DESMUME_DSV_TEXT_FOOTER);
  const cookie = asciiBytes(DESMUME_DSV_COOKIE);
  const out = new Uint8Array(paddedSize + textFooter.length + 40);
  out.fill(0xff, saveBytes.length, paddedSize);
  out.set(saveBytes);
  let offset = paddedSize;
  out.set(textFooter, offset);
  offset += textFooter.length;
  writeLe32(out, offset, saveBytes.length);
  writeLe32(out, offset + 4, paddedSize);
  writeLe32(out, offset + 8, backupType);
  writeLe32(out, offset + 12, DESMUME_DSV_FLASH_ADDR_SIZE);
  writeLe32(out, offset + 16, paddedSize);
  writeLe32(out, offset + 20, DESMUME_DSV_VERSION);
  out.set(cookie, offset + 24);
  return out;
}

function hasDesmumeDsvCookie(bytes: Uint8Array): boolean {
  const cookie = asciiBytes(DESMUME_DSV_COOKIE);
  if (bytes.length < cookie.length) return false;
  const offset = bytes.length - cookie.length;
  for (let index = 0; index < cookie.length; index += 1) {
    if (bytes[offset + index] !== cookie[index]) return false;
  }
  return true;
}

function desmumePaddedSaveSize(size: number): number {
  return DESMUME_SAVE_TYPES.find((candidate) => size <= candidate) ?? size;
}

function desmumeBackupType(size: number): number {
  const index = DESMUME_SAVE_TYPES.findIndex((candidate) => candidate === size);
  return index >= 0 ? index + 1 : 0;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function writeLe32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function writeLe16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function clampU16(value: number): number {
  return Math.max(0, Math.min(0xffff, value));
}

function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}
