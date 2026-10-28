import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { loadBattleEnvironmentArchives, parseBattleBackgroundVariants } from "./battleBackgroundModel";
import { loadBattleCamera, updateBattleCamera, type BattleCameraPose } from "./battleCameraModel";
import { BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT, BATTLE_ZONE_SPEC_RECORD_BYTES } from "./battleEnvironmentUsage";
import { BATTLE_PLATFORM_RECORD_BYTES, parseBattlePlatformVariants } from "./battlePlatformModel";
import { replaceRomFile } from "./fileSystemModel";
import { decodeRecord, type ProjectState } from "./projectStore";
import { buildTestBattleDownloads, supportsAutomaticTestBattle, type TestBattleDownload } from "./testBattle";

export type BattleEnvironmentTestSelection = {
  trainerId: number;
  backgroundIndex: number;
  backgroundSeasonIndex: number;
  platformIndex?: number;
  platformSeasonIndex?: number;
  camera?: { presetId: string; pose: BattleCameraPose };
};

/** Pin complete model/animation resource sets to the chosen seasonal variant. */
export function pinBattleEnvironmentTable(source: NARC, idCode: string, graphics: Uint8Array[], selection: BattleEnvironmentTestSelection): NARC {
  const table = new NARC(source.save());
  const [zones, backgrounds, platforms] = table.files;
  if (!zones?.length || zones.length % BATTLE_ZONE_SPEC_RECORD_BYTES || !backgrounds?.length || backgrounds.length % 64
    || !platforms?.length || platforms.length % BATTLE_PLATFORM_RECORD_BYTES > 3) throw new Error("Malformed battle environment table.");
  const background = parseBattleBackgroundVariants(backgrounds, graphics, idCode).find(v => v.tableIndex === selection.backgroundIndex && v.seasonIndex === selection.backgroundSeasonIndex);
  if (!background || background.tableIndex > 254) throw new Error("Choose an available background variant.");
  pinResourceRow(backgrounds, background.tableIndex * 64, background.seasonIndex, false);
  let platform: ReturnType<typeof parseBattlePlatformVariants>[number] | undefined;
  if (selection.platformIndex !== undefined) {
    platform = parseBattlePlatformVariants(platforms, graphics, idCode).find(v => v.tableIndex === selection.platformIndex && v.seasonIndex === selection.platformSeasonIndex);
    if (!platform || platform.tableIndex > 254) throw new Error("Choose an available platform variant.");
    const at = platform.tableIndex * BATTLE_PLATFORM_RECORD_BYTES + 2;
    // Native platforms fall back to the whole spring resource set when the model is absent.
    pinResourceRow(platforms, at, platform.modelFallback ? 0 : platform.seasonIndex, true);
  }
  // Trainer classes can override the saved map's background type. Pin every
  // type/terrain so the selected model wins without altering the trainer or save.
  for (let at = 0; at < zones.length; at += BATTLE_ZONE_SPEC_RECORD_BYTES) {
    zones.fill(background.tableIndex, at + 2, at + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT);
    if (platform) zones.fill(platform.tableIndex, at + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT, at + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT * 2);
  }
  return table;
}

function pinResourceRow(bytes: Uint8Array, offset: number, season: number, paired: boolean): void {
  for (let resource = 0; resource < 4; resource++) {
    const at = offset + resource * 16;
    if (paired) {
      const selected = bytes.slice(at + season * 4, at + season * 4 + 4);
      for (let slot = 0; slot < 4; slot++) bytes.set(selected, at + slot * 4);
    } else {
      const selected = readU16(bytes, at + season * 2);
      for (let slot = 0; slot < 8; slot++) writeU16(bytes, at + slot * 2, selected);
    }
  }
}

export async function buildBattleEnvironmentTestDownloads(project: ProjectState, selection: BattleEnvironmentTestSelection): Promise<TestBattleDownload> {
  if (!supportsAutomaticTestBattle(project)) throw new Error("Instant battle testing currently supports US White 2.");
  if (!Number.isInteger(selection.trainerId) || selection.trainerId < 1 || selection.trainerId >= (project.narcs.trdata?.fileCount ?? 0)) throw new Error("Choose a valid trainer ID.");
  const temporary = structuredClone(project);
  const trainer = decodeRecord(temporary, "trdata", selection.trainerId);
  if (selection.platformIndex !== undefined && trainer.raw?.battle_type_1 === 3) throw new Error("Rotation battles use their own platform. Choose Automatic or another trainer.");
  const { rom, graphics, table } = await loadBattleEnvironmentArchives(temporary);
  const pinned = pinBattleEnvironmentTable(table.narc, rom.idCode, graphics.files, selection);
  replaceRomFile(temporary, rom, table.fileId, pinned.save());
  if (selection.camera) {
    const document = await loadBattleCamera(temporary);
    updateBattleCamera(temporary, document, selection.camera.presetId, selection.camera.pose);
  }
  return buildTestBattleDownloads(temporary, selection.trainerId);
}
