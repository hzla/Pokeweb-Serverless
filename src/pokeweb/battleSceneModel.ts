import { readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { decompressCode } from "../nds/codeCompression";
import { decodeBattleModelScene, type BattleModelScene } from "./battleModelScene";
import { loadBattleEnvironmentArchives, type BattleEnvironmentArchives, type BattleBackgroundVariant } from "./battleBackgroundModel";
import { BATTLE_PLATFORM_RECORD_BYTES, parseBattlePlatformVariants, type BattlePlatformVariant } from "./battlePlatformModel";
import { getRomFileBytes } from "./fileSystemModel";
import { getHeaderPackedValue, parseHeaders } from "./headerModel";
import { decodeRecord, type ProjectState } from "./projectStore";
import { getTestBattleConfigForProject, loadTestBattleSave } from "./testBattle";
import { BATTLE_IDLE_CAMERA_EFFECTS, parseBattleCameraProgram, type BattleCameraPrograms } from "./battleSceneCamera";

export type BattleScenePlatform = { model: BattleModelScene; position: { x: number; y: number; z: number }; scale: number };
export type BattleScene = { background: BattleModelScene; platforms: BattleScenePlatform[]; platformIndex: number; platformSeason: number; rule: number };
export type BattleSceneSource = { archives: BattleEnvironmentArchives; programs: BattleCameraPrograms; saveZone?: number; saveError?: string };

export async function loadBattleSceneSource(project: ProjectState): Promise<BattleSceneSource> {
  const archives = await loadBattleEnvironmentArchives(project), programs: BattleCameraPrograms = new Map();
  if (project.session.baseRom === "BW2") {
    const id = archives.rom.fileId("a/0/6/6"), animations = new NARC(getRomFileBytes(project, archives.rom, id));
    for (const effect of [0x232, 0x23f, 0x244, 0x245, ...BATTLE_IDLE_CAMERA_EFFECTS]) {
      const bytes = animations.files[effect - 561];
      if (bytes) { try { programs.set(effect, parseBattleCameraProgram(bytes)); } catch { /* Each unavailable shot is reported independently when selected. */ } }
    }
  }
  try { return { archives, programs, saveZone: (await loadTestBattleSave(getTestBattleConfigForProject(project))).zoneId }; }
  catch (error) { return { archives, programs, saveError: error instanceof Error ? error.message : String(error) }; }
}

export function battleSceneRule(project: ProjectState, trainerId: number): number {
  if (!project.narcs.trdata || !Number.isInteger(trainerId) || trainerId < 1 || trainerId >= project.narcs.trdata.fileCount) return 0;
  return Number(decodeRecord(project, "trdata", trainerId).raw?.battle_type_1 ?? 0);
}

export function resolveAutomaticBattlePlatform(project: ProjectState, source: BattleSceneSource, trainerId: number, season: number): BattlePlatformVariant {
  const { rom, table, graphics } = source.archives;
  if (rom.idCode !== "IRDO" || source.saveZone === undefined) throw new Error("Choose a platform to preview both sides on this ROM.");
  const headers = project.headers ?? parseHeaders(project), header = Object.values(headers.rows).find(row => row.index === source.saveZone);
  if (!header) throw new Error("The test save's map header is unavailable; choose a platform.");
  let type = (getHeaderPackedValue(header, "map_behavior") >>> 5) & 31;
  const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9), reader = 0x02030828 - rom.arm9RamAddress;
  const expected = "30b4084b0025ac001a5b904203d10648005b30bc70476d1c012df4d3081c30bc7047c046";
  if (Array.from(arm9.subarray(reader, reader + 36), n => n.toString(16).padStart(2, "0")).join("") !== expected) throw new Error("Trainer environment lookup changed; choose an explicit preview platform.");
  const overrides = readU32(arm9, reader + 36) - rom.arm9RamAddress;
  const trainerClass = Number(decodeRecord(project, "trdata", trainerId).raw?.class ?? 0);
  if (readU16(arm9, overrides) === trainerClass) type = readU16(arm9, overrides + 2);
  const at = type * 44, zones = table.narc.files[0], platformId = zones?.[at + 22]; // Harness terrain: lawn.
  const variants = parseBattlePlatformVariants(table.narc.files[2], graphics.files, rom.idCode);
  const variant = variants.find(v => v.tableIndex === platformId && v.seasonIndex === (zones[at + 1] ? season : 0)) ?? variants.find(v => v.tableIndex === platformId && v.seasonIndex === 0);
  if (!variant) throw new Error("Automatic platform has no previewable model; choose a platform.");
  return variant;
}

export function loadCombinedBattleScene(project: ProjectState, source: BattleSceneSource, background: BattleBackgroundVariant, platform: BattlePlatformVariant | undefined, trainerId: number): BattleScene {
  const { rom, graphics, table } = source.archives, rule = battleSceneRule(project, trainerId);
  const chosen = platform ?? resolveAutomaticBattlePlatform(project, source, trainerId, background.seasonIndex);
  const row = chosen.tableIndex * BATTLE_PLATFORM_RECORD_BYTES + 2, season = chosen.modelFallback ? 0 : chosen.seasonIndex;
  const resources = rule === 3 ? [0x161, 0x161] : /^IR[DE]/u.test(rom.idCode)
    ? [readU16(table.narc.files[2], row + season * 4), readU16(table.narc.files[2], row + season * 4 + 2)] : [chosen.resourceId, chosen.resourceId];
  const scale = rule === 2 ? 1.5 : rule === 1 ? 0x1333 / 4096 : 1;
  const decode = (id: number) => { if (!graphics.files[id]) throw new Error(`Battle model ${id} is unavailable.`); return decodeBattleModelScene(graphics.files[id], id); };
  return { background: decode(background.resourceId), platformIndex: chosen.tableIndex, platformSeason: season, rule,
    platforms: resources.map((id, side) => ({ model: decode(id), scale, position: { x: 0, y: 0, z: rule === 3 ? side ? -15 : 10 : side ? -0xcb7d / 4096 : 0x572f / 4096 } })) };
}
