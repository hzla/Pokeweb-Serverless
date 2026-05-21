import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import {
  compileHgMoveAnimationScript,
  type HgMoveAnimationRom,
} from "./hgMoveAnimationModel";
import { loadHgAnimationTestBattleSave, type HgTestBattleSaveKind, type TestBattleDownload } from "./testBattle";

const HG_ENGINE_MARKER = "hg-engine rocks!";
const HG_VANILLA_ID_PREFIX = "IPK";
const HG_ENGINE_SAVE_NAME = "testani.dsv";
const HG_VANILLA_SAVE_NAME = "vanillagold.dsv";
const HG_WILD_ENCOUNTER_NARC_PATHS = ["a/0/1/2", "a/0/3/3"];
const HG_TEST_ENCOUNTER_RATE = 100;
const HG_ENCOUNTER_RATE_LENGTH = 6;
const HG_RAW_SAVE_SIZE = 0x80000;
const HG_PARTITION_SIZE = 0x40000;
const HG_PARTY_CHUNK_OFFSET = 0x90;
const HG_PARTY_MON_OFFSET = 0x98;
const HG_LOCAL_FIELD_OFFSET = 0x1438;
const HG_SAVE_CHUNK_MAGIC = 0x20060623;
const HG_NORMAL_SAVE_SLOT = 0;
const HG_MAX_PARTY_SIZE = 6;
const PK4_PARTY_SIZE = 236;
const PK4_STORED_SIZE = 136;
const PK4_BLOCK_SIZE = 32;
const PK4_MOVES_OFFSET = 0x28;
const PK4_MOVE_COUNT = 4;
const PK4_PP_OFFSET = 0x30;
const PK4_PP_UPS_OFFSET = 0x34;
const HG_TEST_MOVE_PP = 35;
const HG_MAX_TEST_MOVES = HG_MAX_PARTY_SIZE * PK4_MOVE_COUNT;
const DESMUME_DSV_COOKIE = "|-DESMUME SAVE-|";

const BLOCK_POSITION = [
  0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2,
  0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
  2, 0, 1, 3, 3, 0, 1, 2, 2, 0, 3, 1, 3, 0, 2, 1,
  1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2,
  2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0,
  2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0,
  0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2,
  0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
];

const BLOCK_POSITION_INVERT = [
  0, 1, 2, 4, 3, 5, 6, 7,
  12, 18, 13, 19, 8, 10, 14, 20,
  16, 22, 9, 11, 15, 21, 17, 23,
  0, 1, 2, 4, 3, 5, 6, 7,
];

export async function buildHgMoveAnimationTestBattleDownloads(
  project: HgMoveAnimationRom,
  moveId: number,
  scriptText: string,
  favoriteMoveIds: number[] = [],
): Promise<TestBattleDownload> {
  if (!Number.isInteger(moveId) || moveId < 0 || moveId > 0xffff) throw new Error(`Invalid move ID: ${moveId}`);
  if (moveId >= project.archives.move.narc.files.length) throw new Error(`Move animation file ${moveId} does not exist.`);

  const testMoveIds = normalizeHgTestMoveIds(project, favoriteMoveIds, moveId);
  const saveInfo = getHgMoveAnimationTestSaveInfo(project);
  const saveBytes = await loadHgAnimationTestBattleSave(saveInfo.kind);
  const moveNarc = new NARC(project.archives.move.narc.save());
  moveNarc.files[moveId] = compileHgMoveAnimationScript(scriptText, { archiveKind: "move", fileId: moveId });

  const files = new Map<number, Uint8Array>([
    [project.archives.move.fileId, moveNarc.save()],
    [project.archives.sub.fileId, project.archives.sub.narc.save()],
    [project.archives.spa.fileId, project.archives.spa.narc.save()],
  ]);
  patchHgWildEncounterRates(project, files);
  const romBytes = project.rom.save({ files });
  return {
    romBytes,
    saveBytes: patchHgTestSave(saveBytes, testMoveIds),
    saveName: saveInfo.saveName,
  };
}

function normalizeHgTestMoveIds(project: HgMoveAnimationRom, favoriteMoveIds: number[], fallbackMoveId: number): number[] {
  const seen = new Set<number>();
  const testMoveIds: number[] = [];
  for (const moveId of favoriteMoveIds) {
    if (!Number.isInteger(moveId) || moveId < 0 || moveId > 0xffff) continue;
    if (moveId >= project.archives.move.narc.files.length) continue;
    if (seen.has(moveId)) continue;
    seen.add(moveId);
    testMoveIds.push(moveId);
    if (testMoveIds.length >= HG_MAX_TEST_MOVES) break;
  }
  return testMoveIds.length ? testMoveIds : [fallbackMoveId];
}

export function getHgMoveAnimationTestSaveInfo(project: HgMoveAnimationRom): { kind: HgTestBattleSaveKind; saveName: string } {
  const kind = isVanillaHeartGoldBasedRom(project) ? "vanilla" : "hg-engine";
  return {
    kind,
    saveName: kind === "vanilla" ? HG_VANILLA_SAVE_NAME : HG_ENGINE_SAVE_NAME,
  };
}

function isVanillaHeartGoldBasedRom(project: HgMoveAnimationRom): boolean {
  return project.romInfo.idCode.startsWith(HG_VANILLA_ID_PREFIX) && !includesAscii(project.rom.data, HG_ENGINE_MARKER);
}

function includesAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (char) => char.charCodeAt(0));
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    if (needle.every((byte, index) => bytes[offset + index] === byte)) return true;
  }
  return false;
}

function patchHgWildEncounterRates(project: HgMoveAnimationRom, files: Map<number, Uint8Array>): void {
  for (const path of HG_WILD_ENCOUNTER_NARC_PATHS) {
    let fileId: number;
    try {
      fileId = project.rom.fileId(path);
    } catch {
      continue;
    }

    const narc = new NARC(project.rom.files[fileId]);
    let changed = false;
    for (let index = 0; index < narc.files.length; index += 1) {
      const table = narc.files[index];
      if (table.length < HG_ENCOUNTER_RATE_LENGTH) continue;
      const patched = table.slice();
      patched.fill(HG_TEST_ENCOUNTER_RATE, 0, HG_ENCOUNTER_RATE_LENGTH);
      narc.files[index] = patched;
      changed = true;
    }
    if (changed) files.set(fileId, narc.save());
  }
}

function patchHgTestSave(saveBytes: Uint8Array, moveIds: number[]): Uint8Array {
  const { raw, footer } = splitHgSave(saveBytes);
  const out = raw.slice();
  for (const base of hgPartitionBases(out)) {
    if (!isUsableHgSavePartition(out, base)) continue;
    patchHgPartyMoves(out, base, moveIds);
    updateHgEngineSaveSlotFooter(out, base, HG_NORMAL_SAVE_SLOT);
  }
  return concatBytes([out, footer]);
}

function patchHgPartyMoves(raw: Uint8Array, base: number, moveIds: number[]): void {
  const partyMax = readU32(raw, base + HG_PARTY_CHUNK_OFFSET);
  const partyCount = readU32(raw, base + HG_PARTY_CHUNK_OFFSET + 4);
  if (partyCount < 1) throw new Error("The HeartGold test save does not have a party Pokemon to patch.");
  const maxPartySize = Math.min(HG_MAX_PARTY_SIZE, partyMax || HG_MAX_PARTY_SIZE);
  const neededPartySize = Math.min(maxPartySize, Math.max(1, Math.ceil(moveIds.length / PK4_MOVE_COUNT)));
  const template = raw.slice(base + HG_PARTY_MON_OFFSET, base + HG_PARTY_MON_OFFSET + PK4_PARTY_SIZE);

  for (let partyIndex = 0; partyIndex < neededPartySize; partyIndex += 1) {
    const offset = base + HG_PARTY_MON_OFFSET + partyIndex * PK4_PARTY_SIZE;
    raw.set(template, offset);
    const decrypted = decryptPk4Party(raw.slice(offset, offset + PK4_PARTY_SIZE));
    for (let moveSlot = 0; moveSlot < PK4_MOVE_COUNT; moveSlot += 1) {
      const moveId = moveIds[partyIndex * PK4_MOVE_COUNT + moveSlot] ?? 0;
      writeU16(decrypted, PK4_MOVES_OFFSET + moveSlot * 2, moveId);
      decrypted[PK4_PP_OFFSET + moveSlot] = moveId === 0 ? 0 : HG_TEST_MOVE_PP;
    }
    decrypted[PK4_PP_UPS_OFFSET] = 0;
    raw.set(encryptPk4Party(decrypted), offset);
  }
  writeU32(raw, base + HG_PARTY_CHUNK_OFFSET + 4, neededPartySize);
}

function splitHgSave(saveBytes: Uint8Array): { raw: Uint8Array; footer: Uint8Array } {
  if (saveBytes.length < HG_RAW_SAVE_SIZE) throw new Error("The bundled HeartGold test save is smaller than expected.");
  if (saveBytes.length > HG_RAW_SAVE_SIZE && hasDesmumeCookie(saveBytes.subarray(HG_RAW_SAVE_SIZE))) {
    return {
      raw: saveBytes.slice(0, HG_RAW_SAVE_SIZE),
      footer: saveBytes.slice(HG_RAW_SAVE_SIZE),
    };
  }
  return {
    raw: saveBytes.slice(0, HG_RAW_SAVE_SIZE),
    footer: saveBytes.length > HG_RAW_SAVE_SIZE ? saveBytes.slice(HG_RAW_SAVE_SIZE) : new Uint8Array(),
  };
}

function hasDesmumeCookie(bytes: Uint8Array): boolean {
  const cookie = Array.from(DESMUME_DSV_COOKIE, (char) => char.charCodeAt(0));
  for (let offset = 0; offset <= bytes.length - cookie.length; offset += 1) {
    if (cookie.every((byte, index) => bytes[offset + index] === byte)) return true;
  }
  return false;
}

function hgPartitionBases(raw: Uint8Array): number[] {
  return [0, HG_PARTITION_SIZE].filter((base) => base + HG_PARTITION_SIZE <= raw.length);
}

function isUsableHgSavePartition(raw: Uint8Array, base: number): boolean {
  const mapId = readU32(raw, base + HG_LOCAL_FIELD_OFFSET);
  const partyMax = readU32(raw, base + HG_PARTY_CHUNK_OFFSET);
  const partyCount = readU32(raw, base + HG_PARTY_CHUNK_OFFSET + 4);
  return mapId !== 0xffffffff && partyMax >= 1 && partyMax <= 6 && partyCount >= 1 && partyCount <= partyMax;
}

function updateHgEngineSaveSlotFooter(raw: Uint8Array, base: number, slot: number): void {
  const footer = findHgEngineSaveSlotFooter(raw, base, slot);
  if (!footer) throw new Error("Could not find the HeartGold test save's HG-Engine normal-data footer.");
  writeU16(raw, footer.crcOffset, crc16Ccitt(raw.subarray(footer.dataOffset, footer.footerOffset)));
}

function findHgEngineSaveSlotFooter(
  raw: Uint8Array,
  base: number,
  slot: number,
): { dataOffset: number; footerOffset: number; crcOffset: number } | undefined {
  const end = Math.min(base + HG_PARTITION_SIZE, raw.length);
  for (let magicOffset = base + 8; magicOffset + 8 <= end; magicOffset += 4) {
    if (readU32(raw, magicOffset) !== HG_SAVE_CHUNK_MAGIC) continue;
    const footerOffset = magicOffset - 8;
    const size = readU32(raw, magicOffset - 4);
    const footerSlot = readU16(raw, magicOffset + 4);
    if (footerSlot !== slot || size < 0x10) continue;
    const dataOffset = footerOffset + 0x10 - size;
    if (dataOffset < base || dataOffset >= footerOffset) continue;
    return {
      dataOffset,
      footerOffset,
      crcOffset: magicOffset + 6,
    };
  }
  return undefined;
}

function decryptPk4Party(encrypted: Uint8Array): Uint8Array {
  const out = encrypted.slice(0, PK4_PARTY_SIZE);
  const pid = readU32(out, 0);
  const checksum = readU16(out, 6);
  const shuffleValue = (pid >>> 13) & 31;
  cryptArray(out, 8, PK4_STORED_SIZE - 8, checksum);
  cryptArray(out, PK4_STORED_SIZE, PK4_PARTY_SIZE - PK4_STORED_SIZE, pid);
  shufflePk4(out, 8, shuffleValue);
  return out;
}

function encryptPk4Party(decrypted: Uint8Array): Uint8Array {
  const out = decrypted.slice(0, PK4_PARTY_SIZE);
  writeU16(out, 6, add16(out.subarray(8, PK4_STORED_SIZE)));
  const pid = readU32(out, 0);
  const checksum = readU16(out, 6);
  const shuffleValue = BLOCK_POSITION_INVERT[(pid >>> 13) & 31] ?? 0;
  shufflePk4(out, 8, shuffleValue);
  cryptArray(out, 8, PK4_STORED_SIZE - 8, checksum);
  cryptArray(out, PK4_STORED_SIZE, PK4_PARTY_SIZE - PK4_STORED_SIZE, pid);
  return out;
}

function shufflePk4(bytes: Uint8Array, offset: number, shuffleValue: number): void {
  if (shuffleValue === 0) return;
  const perm = [0, 1, 2, 3];
  const slotOf = [0, 1, 2, 3];
  const shuffleOffset = shuffleValue * 4;
  for (let index = 0; index < 3; index += 1) {
    const desired = BLOCK_POSITION[shuffleOffset + index] ?? index;
    const swapSlot = slotOf[desired] ?? index;
    if (swapSlot === index) continue;
    swapBlocks(bytes, offset + index * PK4_BLOCK_SIZE, offset + swapSlot * PK4_BLOCK_SIZE, PK4_BLOCK_SIZE);
    const blockAtIndex = perm[index] ?? index;
    perm[swapSlot] = blockAtIndex;
    slotOf[blockAtIndex] = swapSlot;
  }
}

function swapBlocks(bytes: Uint8Array, left: number, right: number, length: number): void {
  for (let index = 0; index < length; index += 1) {
    const value = bytes[left + index];
    bytes[left + index] = bytes[right + index];
    bytes[right + index] = value;
  }
}

function cryptArray(bytes: Uint8Array, offset: number, length: number, seed: number): void {
  let state = seed >>> 0;
  for (let cursor = offset; cursor < offset + length; cursor += 2) {
    state = (Math.imul(0x41c64e6d, state) + 0x6073) >>> 0;
    writeU16(bytes, cursor, readU16(bytes, cursor) ^ (state >>> 16));
  }
}

function crc16Ccitt(data: Uint8Array): number {
  let top = 0xff;
  let bottom = 0xff;
  for (const byte of data) {
    let value = byte ^ top;
    value ^= value >> 4;
    top = (bottom ^ (value >> 3) ^ (value << 4)) & 0xff;
    bottom = (value ^ (value << 5)) & 0xff;
  }
  return ((top << 8) | bottom) & 0xffff;
}

function add16(data: Uint8Array): number {
  let checksum = 0;
  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    checksum = (checksum + readU16(data, offset)) & 0xffff;
  }
  return checksum;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
