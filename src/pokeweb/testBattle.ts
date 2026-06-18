import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { BW2_NARCS, BW_NARCS, HEADER_NARCS, type BaseRom, type NarcDefinition, type NarcName } from "./constants";
import { exportModifiedRom } from "./exportRom";
import { getNarcFormats } from "./formats";
import { compileMoveAnimation } from "./moveAnimationModel";
import { prepareBw2TestBattleCodeInjection } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { normalizeTestBattleSavePartyNicknames, patchTestBattleSavePlayerFirstMove, patchTestBattleSavePlayerParty } from "./testBattleTeam";

const TEST_BATTLE_SAVE_URL = new URL("../assets/testbattle/test.sav", import.meta.url);
const BW_TEST_BATTLE_SAVE_URL = new URL("../assets/testbattle/white.dsv", import.meta.url);
const HG_ENGINE_TEST_BATTLE_SAVE_URL = new URL("../assets/testbattle/testani.dsv", import.meta.url);
const HG_VANILLA_TEST_BATTLE_SAVE_URL = new URL("../assets/testbattle/vanillagold.dsv", import.meta.url);
const TEST_BATTLE_BASE_TRAINER_ID = 2;
const BW_TEST_BATTLE_FALLBACK_OVERWORLD_ID = 66;
const BATTLE_ANIMATION_OFFSET = 561;
const TEST_BATTLE_SCRIPT_ID = 3000 + TEST_BATTLE_BASE_TRAINER_ID;
const TEST_BATTLE_NPC_SIZE = 36;
const TEST_BATTLE_HEADER_SIZE = 8;
const TEST_BATTLE_MMDL_BLOCK_OFFSET = 0x1e200;
const TEST_BATTLE_MMDL_BLOCK_LENGTH = 0x1400;
const TEST_BATTLE_MMDL_CHECKSUM_OFFSET = 0x1f602;
const TEST_BATTLE_MMDL_CHECKSUM_INDEX = 41;
const TEST_BATTLE_EVENTWORK_CHECKSUM_INDEX = 45;
const TEST_BATTLE_BW_CHECKSUM_BLOCK_OFFSET = 0x23f00;
const TEST_BATTLE_BW_CHECKSUM_BLOCK_LENGTH = 0x8c;
const TEST_BATTLE_BW_CHECKSUM_BLOCK_CHECKSUM_OFFSET = 0x23f9a;
const TEST_BATTLE_BW_EVENTWORK_BLOCK_OFFSET = 0x20100;
const TEST_BATTLE_BW_EVENTWORK_BLOCK_LENGTH = 0x3ec;
const TEST_BATTLE_BW_EVENTWORK_CHECKSUM_OFFSET = 0x204ee;
const TEST_BATTLE_BW_SAVE_HALF_OFFSET = 0x24000;
const TEST_BATTLE_BW2_CHECKSUM_BLOCK_OFFSET = 0x25f00;
const TEST_BATTLE_BW2_CHECKSUM_BLOCK_LENGTH = 0x94;
const TEST_BATTLE_BW2_CHECKSUM_BLOCK_CHECKSUM_OFFSET = 0x25fa2;
const TEST_BATTLE_BW2_EVENTWORK_BLOCK_OFFSET = 0x1ff00;
const TEST_BATTLE_BW2_EVENTWORK_BLOCK_LENGTH = 0x4e0;
const TEST_BATTLE_BW2_EVENTWORK_CHECKSUM_OFFSET = 0x203e2;
const TEST_BATTLE_BW2_SAVE_HALF_OFFSET = 0x26000;
const TEST_BATTLE_MMDL_SAVEWORK_SIZE = 80;
const TEST_BATTLE_MMDL_SAVEWORK_COUNT = 64;
const TEST_BATTLE_EYE_RANGE = 10;
const TEST_BATTLE_DIRECTION_UP = 0;
const TEST_BATTLE_EV_TYPE_TRAINER = 1;
const TEST_BATTLE_TRAINER_FLAG_START = 1420;
const TEST_BATTLE_EVENTWORK_WORK_BYTES = 318 * 2;
const TEST_BATTLE_TRAINER_FLAG = TEST_BATTLE_TRAINER_FLAG_START + TEST_BATTLE_BASE_TRAINER_ID;
const TEST_BATTLE_TRAINER_FLAG_OFFSET = TEST_BATTLE_EVENTWORK_WORK_BYTES + Math.floor(TEST_BATTLE_TRAINER_FLAG / 8);
const TEST_BATTLE_TRAINER_FLAG_MASK = 1 << (TEST_BATTLE_TRAINER_FLAG % 8);
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
  saveName?: string;
};

export type HgTestBattleSaveKind = "hg-engine" | "vanilla";

export type TestBattleBuildOptions = {
  playerTeamText?: string;
};

export type MoveTestBattleBuildOptions = {
  moveAnimationScriptText?: string;
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

type TestBattleSaveLayout = {
  saveHalfOffset: number;
  checksumBlockOffset: number;
  checksumBlockLength: number;
  checksumBlockChecksumOffset?: number;
  eventworkBlockOffset: number;
  eventworkBlockLength: number;
  eventworkChecksumOffset?: number;
};

export type TestBattleConfig = {
  baseRom: BaseRom;
  saveUrl: URL;
  fallbackOverworldId?: number;
  saveLayout: TestBattleSaveLayout;
  paths: Record<"headers" | "trdata" | "trpok" | "overworlds" | "move_animations" | "battle_animations", string>;
};

export function getTestBattleConfig(baseRom: BaseRom): TestBattleConfig {
  const narcs = baseRom === "BW" ? BW_NARCS : BW2_NARCS;
  return {
    baseRom,
    saveUrl: baseRom === "BW" ? BW_TEST_BATTLE_SAVE_URL : TEST_BATTLE_SAVE_URL,
    fallbackOverworldId: baseRom === "BW" ? BW_TEST_BATTLE_FALLBACK_OVERWORLD_ID : undefined,
    saveLayout: getTestBattleSaveLayout(baseRom),
    paths: {
      headers: pathForNarc(HEADER_NARCS, "headers"),
      trdata: pathForNarc(narcs, "trdata"),
      trpok: pathForNarc(narcs, "trpok"),
      overworlds: pathForNarc(narcs, "overworlds"),
      move_animations: pathForNarc(narcs, "move_animations"),
      battle_animations: pathForNarc(narcs, "battle_animations"),
    },
  };
}

export async function buildTestBattleDownloads(project: ProjectState, trainerId: number, options: TestBattleBuildOptions = {}): Promise<TestBattleDownload> {
  const config = getTestBattleConfig(project.session.baseRom);

  const [baseRomBytes, loadedSave] = await Promise.all([exportTestBattleBaseRom(project), loadTestBattleSave(config)]);
  const save = normalizeLoadedTestBattleSave(project, config, loadedSave);
  const trainerPatchedRom = patchTestBattleTrainerSlot(baseRomBytes, project, config, trainerId);
  const { romBytes, npc } = patchTestBattleOverworldNpc(trainerPatchedRom, project, config, save);
  const patchedMapSaveBytes = patchTestBattleSaveMmdl(save.rawSaveBytes, config, save, npc);
  const patchedFlagSaveBytes = patchTestBattleSaveTrainerFlag(patchedMapSaveBytes, config);
  const patchedSaveBytes = patchTestBattleSavePlayerParty(patchedFlagSaveBytes, project, options.playerTeamText ?? "", config.baseRom);
  return { romBytes, saveBytes: toDesmumeDsv(patchedSaveBytes) };
}

export async function buildMoveTestBattleDownloads(project: ProjectState, moveId: number, options: MoveTestBattleBuildOptions = {}): Promise<TestBattleDownload> {
  const config = getTestBattleConfig(project.session.baseRom);

  const [baseRomBytes, loadedSave] = await Promise.all([exportTestBattleBaseRom(project), loadTestBattleSave(config)]);
  const save = normalizeLoadedTestBattleSave(project, config, loadedSave);
  const movePatchedRom = options.moveAnimationScriptText === undefined ? baseRomBytes : patchMoveAnimationScript(baseRomBytes, project, config, moveId, options.moveAnimationScriptText);
  const { romBytes, npc } = patchTestBattleOverworldNpc(movePatchedRom, project, config, save);
  const patchedMapSaveBytes = patchTestBattleSaveMmdl(save.rawSaveBytes, config, save, npc);
  const patchedFlagSaveBytes = patchTestBattleSaveTrainerFlag(patchedMapSaveBytes, config);
  const patchedSaveBytes = patchTestBattleSavePlayerFirstMove(patchedFlagSaveBytes, project, moveId, config.baseRom);
  return { romBytes, saveBytes: toDesmumeDsv(patchedSaveBytes) };
}

async function exportTestBattleBaseRom(project: ProjectState): Promise<Uint8Array> {
  if (project.session.baseRom !== "BW2") return exportModifiedRom(project, { preserveOriginalLength: true });
  const temporaryProject = structuredClone(project) as ProjectState;
  await prepareBw2TestBattleCodeInjection(temporaryProject);
  return exportModifiedRom(temporaryProject, { preserveOriginalLength: true });
}

export async function loadHgAnimationTestBattleSave(kind: HgTestBattleSaveKind): Promise<Uint8Array> {
  const response = await fetch(kind === "vanilla" ? HG_VANILLA_TEST_BATTLE_SAVE_URL : HG_ENGINE_TEST_BATTLE_SAVE_URL);
  if (!response.ok) throw new Error(`Failed to load bundled HeartGold animation test save: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadTestBattleSave(config: TestBattleConfig): Promise<TestBattleSave> {
  const response = await fetch(config.saveUrl);
  if (!response.ok) throw new Error(`Failed to load bundled test battle save: ${response.status}`);
  const rawSaveBytes = rawSaveBytesFromDesmumeDsv(new Uint8Array(await response.arrayBuffer()));
  return {
    rawSaveBytes,
    ...readTestBattleSavePosition(rawSaveBytes),
  };
}

function normalizeLoadedTestBattleSave(project: ProjectState, config: TestBattleConfig, save: TestBattleSave): TestBattleSave {
  const rawSaveBytes = normalizeTestBattleSavePartyNicknames(save.rawSaveBytes, project, config.baseRom);
  return rawSaveBytes === save.rawSaveBytes ? save : { ...save, rawSaveBytes };
}

function patchMoveAnimationScript(romBytes: Uint8Array, project: ProjectState, config: TestBattleConfig, moveId: number, scriptText: string): Uint8Array {
  const target = resolveMoveAnimationTarget(project, moveId);
  const rom = new NintendoDSRom(romBytes);
  const fileId =
    target.storeName === "move_animations"
      ? project.narcs.move_animations?.fileId ?? project.session.fileIds.move_animations ?? rom.fileId(config.paths.move_animations)
      : project.narcs.battle_animations?.fileId ?? project.session.fileIds.battle_animations ?? rom.fileId(config.paths.battle_animations);
  const narc = new NARC(rom.files[fileId]);
  if (!narc.files[target.index]) throw new Error(`${target.storeName} entry ${target.index} does not exist.`);
  narc.files[target.index] = compileMoveAnimation(project, moveId, scriptText);
  return rom.save({
    files: new Map([[fileId, narc.save()]]),
    preserveOriginalLength: true,
  });
}

function resolveMoveAnimationTarget(project: ProjectState, moveId: number): { storeName: "move_animations" | "battle_animations"; index: number } {
  const storeName = moveId > 559 ? "battle_animations" : "move_animations";
  const index = moveId > 559 ? moveId - BATTLE_ANIMATION_OFFSET : moveId;
  const store = project.narcs[storeName];
  if (!store || index < 0 || index >= store.rawFiles.length) throw new Error(`${storeName} is not loaded for move ${moveId}`);
  return { storeName, index };
}

function patchTestBattleTrainerSlot(romBytes: Uint8Array, project: ProjectState, config: TestBattleConfig, trainerId: number): Uint8Array {
  if (trainerId === TEST_BATTLE_BASE_TRAINER_ID) return romBytes;

  const rom = new NintendoDSRom(romBytes);
  const trdataFileId = project.narcs.trdata?.fileId ?? project.session.fileIds.trdata ?? rom.fileId(config.paths.trdata);
  const trpokFileId = project.narcs.trpok?.fileId ?? project.session.fileIds.trpok ?? rom.fileId(config.paths.trpok);
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

function patchTestBattleOverworldNpc(romBytes: Uint8Array, project: ProjectState, config: TestBattleConfig, save: TestBattleSave): TestBattleOverworldPatch {
  const rom = new NintendoDSRom(romBytes);
  const overworldsFileId = project.narcs.overworlds?.fileId ?? project.session.fileIds.overworlds ?? rom.fileId(config.paths.overworlds);
  const overworlds = new NARC(rom.files[overworldsFileId]);
  const overworldId = resolveOverworldIdForSaveZone(rom, project, config, save.zoneId);
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

export function resolveTestBattleOverworldIdForSaveZone(rom: NintendoDSRom | undefined, project: ProjectState, config: TestBattleConfig, zoneId: number): number {
  const fallback = config.fallbackOverworldId ?? zoneId;
  if (!rom && !project.narcs.headers) return fallback;

  const headersFileId = project.narcs.headers?.fileId ?? project.session.fileIds.headers ?? rom?.fileId(config.paths.headers);
  if (headersFileId === undefined) return fallback;
  const headerBytes = project.narcs.headers?.rawFiles[0] ?? (rom ? new NARC(rom.files[headersFileId]).files[0] : undefined);
  const format = project.formats.headers ?? getNarcFormats(config.baseRom).headers;
  if (!headerBytes || !format) return fallback;

  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const mapIdOffset = fieldOffset(format, "map_id");
  if (mapIdOffset === undefined) return fallback;
  const offset = zoneId * rowLength + mapIdOffset;
  if (offset + 2 > headerBytes.length) return fallback;
  return readLe16(headerBytes, offset);
}

function resolveOverworldIdForSaveZone(rom: NintendoDSRom, project: ProjectState, config: TestBattleConfig, zoneId: number): number {
  return resolveTestBattleOverworldIdForSaveZone(rom, project, config, zoneId);
}

export function rawSaveBytesFromDesmumeDsv(saveBytes: Uint8Array): Uint8Array {
  if (!hasDesmumeDsvCookie(saveBytes)) return saveBytes;
  const footerOffset = indexOfBytes(saveBytes, asciiBytes(DESMUME_DSV_TEXT_FOOTER));
  return footerOffset >= 0 ? saveBytes.slice(0, footerOffset) : saveBytes;
}

export function testBattleOverworldYFromSaveGridY(gridY: number): number {
  return gridY * 0x10000;
}

function getTestBattleSaveLayout(baseRom: BaseRom): TestBattleSaveLayout {
  if (baseRom === "BW") {
    return {
      saveHalfOffset: TEST_BATTLE_BW_SAVE_HALF_OFFSET,
      checksumBlockOffset: TEST_BATTLE_BW_CHECKSUM_BLOCK_OFFSET,
      checksumBlockLength: TEST_BATTLE_BW_CHECKSUM_BLOCK_LENGTH,
      checksumBlockChecksumOffset: TEST_BATTLE_BW_CHECKSUM_BLOCK_CHECKSUM_OFFSET,
      eventworkBlockOffset: TEST_BATTLE_BW_EVENTWORK_BLOCK_OFFSET,
      eventworkBlockLength: TEST_BATTLE_BW_EVENTWORK_BLOCK_LENGTH,
      eventworkChecksumOffset: TEST_BATTLE_BW_EVENTWORK_CHECKSUM_OFFSET,
    };
  }
  return {
    saveHalfOffset: TEST_BATTLE_BW2_SAVE_HALF_OFFSET,
    checksumBlockOffset: TEST_BATTLE_BW2_CHECKSUM_BLOCK_OFFSET,
    checksumBlockLength: TEST_BATTLE_BW2_CHECKSUM_BLOCK_LENGTH,
    checksumBlockChecksumOffset: TEST_BATTLE_BW2_CHECKSUM_BLOCK_CHECKSUM_OFFSET,
    eventworkBlockOffset: TEST_BATTLE_BW2_EVENTWORK_BLOCK_OFFSET,
    eventworkBlockLength: TEST_BATTLE_BW2_EVENTWORK_BLOCK_LENGTH,
    eventworkChecksumOffset: TEST_BATTLE_BW2_EVENTWORK_CHECKSUM_OFFSET,
  };
}

function pathForNarc(definitions: readonly NarcDefinition[], name: NarcName): string {
  const path = definitions.find((definition) => definition.name === name)?.path;
  if (!path) throw new Error(`Missing ${name} NARC path for test battles.`);
  return path;
}

function indexOfBytes(bytes: Uint8Array, pattern: Uint8Array): number {
  if (pattern.length === 0 || pattern.length > bytes.length) return -1;
  for (let offset = 0; offset <= bytes.length - pattern.length; offset += 1) {
    let found = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (bytes[offset + index] !== pattern[index]) {
        found = false;
        break;
      }
    }
    if (found) return offset;
  }
  return -1;
}

function patchTestBattleSaveMmdl(saveBytes: Uint8Array, config: TestBattleConfig, save: TestBattleSave, npc: Uint8Array): Uint8Array {
  const out = saveBytes.slice();
  patchTestBattleSaveMmdlHalf(out, config.saveLayout, 0, save, npc);
  if (hasSaveHalf(out, config.saveLayout)) {
    patchTestBattleSaveMmdlHalf(out, config.saveLayout, config.saveLayout.saveHalfOffset, save, npc);
  }
  return out;
}

function patchTestBattleSaveMmdlHalf(out: Uint8Array, layout: TestBattleSaveLayout, halfOffset: number, save: TestBattleSave, npc: Uint8Array): void {
  const blockOffset = halfOffset + TEST_BATTLE_MMDL_BLOCK_OFFSET;
  const slotOffset = findMmdlSaveSlot(out, blockOffset, npc[0]);
  if (slotOffset === undefined) throw new Error("The bundled test battle save has no free overworld actor save slot.");

  writeMmdlSavework(out, slotOffset, save, npc);
  refreshTestBattleSaveBlockChecksum(
    out,
    layout,
    halfOffset,
    TEST_BATTLE_MMDL_BLOCK_OFFSET,
    TEST_BATTLE_MMDL_BLOCK_LENGTH,
    TEST_BATTLE_MMDL_CHECKSUM_OFFSET,
    TEST_BATTLE_MMDL_CHECKSUM_INDEX,
  );
}

export function patchTestBattleSaveTrainerFlag(saveBytes: Uint8Array, config: TestBattleConfig): Uint8Array {
  const out = saveBytes.slice();
  patchTestBattleSaveTrainerFlagHalf(out, config.saveLayout, 0);
  if (hasSaveHalf(out, config.saveLayout)) {
    patchTestBattleSaveTrainerFlagHalf(out, config.saveLayout, config.saveLayout.saveHalfOffset);
  }
  return out;
}

export function isTestBattleTrainerFlagSet(saveBytes: Uint8Array, config: TestBattleConfig, halfOffset = 0): boolean {
  return (saveBytes[halfOffset + config.saveLayout.eventworkBlockOffset + TEST_BATTLE_TRAINER_FLAG_OFFSET] & TEST_BATTLE_TRAINER_FLAG_MASK) !== 0;
}

function patchTestBattleSaveTrainerFlagHalf(out: Uint8Array, layout: TestBattleSaveLayout, halfOffset: number): void {
  const flagOffset = halfOffset + layout.eventworkBlockOffset + TEST_BATTLE_TRAINER_FLAG_OFFSET;
  if (flagOffset >= out.length) throw new Error("The bundled test battle save is too small to contain trainer event flags.");
  out[flagOffset] &= ~TEST_BATTLE_TRAINER_FLAG_MASK;
  refreshTestBattleSaveBlockChecksum(
    out,
    layout,
    halfOffset,
    layout.eventworkBlockOffset,
    layout.eventworkBlockLength,
    layout.eventworkChecksumOffset,
    TEST_BATTLE_EVENTWORK_CHECKSUM_INDEX,
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

function hasSaveHalf(saveBytes: Uint8Array, layout: TestBattleSaveLayout): boolean {
  return saveBytes.length >= layout.saveHalfOffset + layout.checksumBlockOffset + layout.checksumBlockLength;
}

function refreshTestBattleSaveBlockChecksum(
  out: Uint8Array,
  layout: TestBattleSaveLayout,
  halfOffset: number,
  blockOffset: number,
  blockLength: number,
  checksumOffset: number | undefined,
  checksumIndex: number,
): void {
  const checksum = crc16Ccitt(out.subarray(halfOffset + blockOffset, halfOffset + blockOffset + blockLength));
  if (checksumOffset !== undefined) writeLe16(out, halfOffset + checksumOffset, checksum);
  writeLe16(out, halfOffset + layout.checksumBlockOffset + checksumIndex * 2, checksum);
  refreshTestBattleChecksumBlock(out, layout, halfOffset);
}

function refreshTestBattleChecksumBlock(out: Uint8Array, layout: TestBattleSaveLayout, halfOffset: number): void {
  if (layout.checksumBlockChecksumOffset === undefined) return;
  refreshBlockChecksum(out, halfOffset + layout.checksumBlockOffset, layout.checksumBlockLength, halfOffset + layout.checksumBlockChecksumOffset);
}

function refreshBlockChecksum(out: Uint8Array, blockOffset: number, blockLength: number, checksumOffset: number): void {
  const checksum = crc16Ccitt(out.subarray(blockOffset, blockOffset + blockLength));
  writeLe16(out, checksumOffset, checksum);
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
  writeLe32(npc, 32, testBattleOverworldYFromSaveGridY(save.gridY));
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
    throw new Error("Bundled test battle save is too small to contain a BW/BW2 trainer position block.");
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
