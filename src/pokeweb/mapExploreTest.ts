import { readU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { installMapCameraTestWarp, type MapCameraTestPosition } from "./mapCameraTest";
import { getTestBattleConfigForProject, loadTestBattleSave, toDesmumeDsv } from "./testBattle";
import { exportModifiedRom } from "./exportRom";
import { loadActiveRomBytes } from "./persistence";
import { installMapTestWalkRuntime, mapTestProfile } from "./mapTestRuntime";
import { isWaterLikePermission } from "./gen5PermissionModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { readGen5MapBin } from "./gen5MapImportFormats";
import type { Map3dSceneData } from "./map3dModel";
import type { ProjectState } from "./projectStore";

export function bottomLeftMapTestTile(project: ProjectState, data: Map3dSceneData): MapCameraTestPosition {
  if (data.matrixCell) throw new Error("Assign this matrix cell to a map header before testing in game.");
  const candidates: MapCameraTestPosition[] = [];
  for (const chunk of data.chunks) {
    const per = readGen5MapBin(project.narcs.maps!.rawFiles[chunk.chunkId]).files[1];
    for (let index = 0; index < (chunk.permissions?.tiles.length ?? 0); index++) {
      const tile = chunk.permissions!.tiles[index];
      if (tile.flags & 1 || [1,18].includes(tile.tileClass) || isWaterLikePermission(tile)) continue;
      const height = gen5HeightAt(per,index,.5,.5,project.session.baseRom as "BW"|"BW2") * 16;
      candidates.push({ zoneId: data.zoneId, tileX: chunk.matrixX * 32 + index % 32, tileZ: chunk.matrixY * 32 + Math.floor(index / 32), height, facing: "up" });
    }
  }
  const position = candidates.sort((p,q) => q.tileZ-p.tileZ || p.tileX-q.tileX)[0];
  if (!position) throw new Error("This map has no dry walkable tile for the player to land on.");
  return position;
}
/** Work on a detached project. Temporary warp/PMC/DLL changes never enter normal saves or exports. */
export async function buildMapExploreTestDownloads(project: ProjectState, destination: MapCameraTestPosition) {
  mapTestProfile(project);
  const source = project.originalRomBytes ?? await loadActiveRomBytes(); if (!source) throw new Error("Reconnect the source ROM before testing.");
  const temporary = structuredClone({ ...project, originalRomBytes: undefined }) as ProjectState; temporary.originalRomBytes = source;
  await installMapTestWalkRuntime(temporary,source);
  const config = getTestBattleConfigForProject(temporary), [romBytes,save] = await Promise.all([exportModifiedRom(temporary,{preserveOriginalLength:true}),loadTestBattleSave(config)]);
  const rom = new NintendoDSRom(romBytes,{fileData:"view"}), headers = new NARC(rom.getFileByName(config.paths.headers)).files[0];
  const format = project.formats.headers; if (!format) throw new Error("Unsupported map header layout."); let size = 0; const offsets: Record<string,number> = {};
  for (const [bytes,name] of format) { offsets[name] = size; size += bytes; }
  if (!headers || Math.max(destination.zoneId,save.zoneId)*size+size>headers.length) throw new Error("The test origin or destination header is missing.");
  if (offsets.script_id === undefined || offsets.map_id === undefined) throw new Error("Unsupported map header layout.");
  const scriptId = readU16(headers,save.zoneId*size+offsets.script_id), eventId = readU16(headers,save.zoneId*size+offsets.map_id);
  const scriptsId = rom.fileId(project.session.baseRom === "BW" ? "a/0/5/7" : "a/0/5/6"), eventsId = rom.fileId(config.paths.overworlds), scripts = new NARC(rom.files[scriptsId]), events = new NARC(rom.files[eventsId]);
  if (!scripts.files[scriptId] || !events.files[eventId]) throw new Error("The bundled save map has missing scripts or events.");
  const warp = installMapCameraTestWarp(scripts.files[scriptId],events.files[eventId],save,destination);
  scripts.files[scriptId] = warp.scripts; events.files[eventId] = warp.events;
  return { romBytes: rom.save({ files: new Map([[scriptsId,scripts.save()],[eventsId,events.save()]]),preserveOriginalLength:true }), saveBytes: toDesmumeDsv(save.rawSaveBytes), destination,
    trigger: { zoneId: save.zoneId, tileX: save.gridX, tileZ: save.gridZ, scriptId,eventId,entryId:warp.entryId }, walkThroughWalls: true };
}
