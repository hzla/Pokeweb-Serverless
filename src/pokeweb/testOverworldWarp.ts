import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getOverworldScene } from "./overworldModel";
import type { ProjectState } from "./projectStore";
import {
  exportTestBattleBaseRom,
  getTestBattleConfig,
  getTestBattleConfigForProject,
  loadTestBattleSave,
  refreshTestBattleSaveBlockChecksum,
  toDesmumeDsv,
  type TestBattleDownload,
} from "./testBattle";
import { normalizeTestBattleSavePartyNicknames } from "./testBattleTeam";

export type OverworldTestWarpSelection = {
  overworldId: number;
  mapId: number;
  index: number;
  x: number;
  y: number;
};

export type OverworldTestWarpDestination = { zoneId: number; gridX: number; gridZ: number };
type WarpOrigin = { zoneId: number; gridX: number; gridY: number; gridZ: number };

const ASPERTIA_ZONE_ID = 427;
const BW2_HEADER_SIZE = 48;
const SITUATION_OFFSET = 0x19500;
const SITUATION_LENGTH = 0xa8;
const SPECIAL_LOCATION_OFFSET = 0x38;
const SPECIAL_EXIT_ID = 0x100;

export function resolveOverworldTestWarpDestination(project: ProjectState, selection: OverworldTestWarpSelection): OverworldTestWarpDestination {
  if (project.session.baseRom !== "BW2") throw new Error("Test Warp to Here is only available for Black 2 and White 2 ROMs.");
  const scene = getOverworldScene(project, selection.overworldId);
  const map = scene.maps.find((entry) => entry.id === selection.mapId
    && selection.x >= entry.x && selection.x < entry.x + entry.width
    && selection.y >= entry.y && selection.y < entry.y + entry.height);
  if (!Number.isInteger(selection.x) || !Number.isInteger(selection.y) || !map || map.empty || map.missing
    || selection.index !== (selection.y - map.y) * map.width + selection.x - map.x) {
    throw new Error("Select a valid map tile before testing a warp.");
  }
  const destination = { zoneId: scene.header.index, gridX: selection.x + scene.translateX, gridZ: selection.y + scene.translateY };
  validateDestination(destination);
  return destination;
}

export async function buildOverworldTestWarpDownloads(project: ProjectState, selection: OverworldTestWarpSelection): Promise<TestBattleDownload> {
  const destination = resolveOverworldTestWarpDestination(project, selection);
  const config = getTestBattleConfigForProject(project);
  const [baseRomBytes, save] = await Promise.all([exportTestBattleBaseRom(project), loadTestBattleSave(config)]);
  if (save.zoneId !== ASPERTIA_ZONE_ID) throw new Error("The bundled warp test save must start in Aspertia City.");
  const rom = new NintendoDSRom(baseRomBytes);
  // Resolve IDs from the exported ROM: code injection can shift NitroFS file IDs,
  // and a header's event archive ID is not the same as its zone or matrix ID.
  const headers = new NARC(rom.files[rom.fileId(config.paths.headers)]).files[0];
  const headerOffset = save.zoneId * BW2_HEADER_SIZE;
  if (!headers || headerOffset + BW2_HEADER_SIZE > headers.length || readU16(headers, headerOffset + 4) !== 0) {
    throw new Error("The Aspertia City test save requires an overworld on matrix 0.");
  }
  const overworldId = readU16(headers, headerOffset + 22);
  const fileId = rom.fileId(config.paths.overworlds);
  const overworlds = new NARC(rom.files[fileId]);
  const events = overworlds.files[overworldId];
  if (!events) throw new Error(`Aspertia City overworld ${overworldId} is missing.`);
  overworlds.files[overworldId] = patchOverworldTestWarpEvent(events, save, destination);
  const saveBytes = patchOverworldTestWarpSave(normalizeTestBattleSavePartyNicknames(save.rawSaveBytes, project, "BW2"), destination);
  return {
    romBytes: rom.save({ files: new Map([[fileId, overworlds.save()]]), preserveOriginalLength: true }),
    saveBytes: toDesmumeDsv(saveBytes),
  };
}

/** Add a step-on warp immediately south of the saved player, preserving event scripts. */
export function patchOverworldTestWarpEvent(bytes: Uint8Array, origin: WarpOrigin, destination: OverworldTestWarpDestination): Uint8Array {
  validateDestination(destination);
  for (const value of [origin.gridX, origin.gridZ + 1]) {
    if (!Number.isInteger(value) || value < 0 || value > 2047) throw new Error("The saved player position is outside the BW2 warp coordinate range.");
  }
  if (!Number.isInteger(origin.gridY) || origin.gridY < -2048 || origin.gridY > 2047) throw new Error("The saved player height is outside the BW2 warp coordinate range.");
  const warpOffset = 8 + bytes[4] * 20 + bytes[5] * 36;
  const warpEnd = warpOffset + bytes[6] * 20;
  const eventEnd = warpEnd + bytes[7] * 22;
  // load_count excludes its own u32 and includes the four count bytes.
  if (bytes.length < 8 || eventEnd > bytes.length || readU32(bytes, 0) + 4 < eventEnd || readU32(bytes, 0) + 4 > bytes.length) {
    throw new Error("The Aspertia City overworld event data is truncated.");
  }
  if (bytes[6] === 0xff) throw new Error("The Aspertia City overworld already has the maximum warp count.");
  if (bytes.length + 20 >= 0x984) throw new Error("The Aspertia City overworld has no room for another test warp.");
  const out = new Uint8Array(bytes.length + 20);
  out.set(bytes.subarray(0, warpEnd));
  out.set(bytes.subarray(warpEnd), warpEnd + 20);
  writeU32(out, 0, readU32(bytes, 0) + 20);
  out[6] += 1;
  // CONNECT_DATA is 20 bytes; EXIT_TYPE_WARP = 5.
  // link_exit_id 0x100 makes EVENT_ChangeMapByConnect read SITUATION.special_loc.
  writeU16(out, warpEnd, destination.zoneId);
  writeU16(out, warpEnd + 2, SPECIAL_EXIT_ID);
  out[warpEnd + 5] = 5;
  writeU16(out, warpEnd + 8, origin.gridX * 16 + 8);
  writeU16(out, warpEnd + 10, origin.gridY * 16);
  writeU16(out, warpEnd + 12, (origin.gridZ + 1) * 16 + 8);
  writeU16(out, warpEnd + 14, 1);
  writeU16(out, warpEnd + 16, 1);
  return out;
}

/** Patch both save copies' special destination and their block/checksum-table CRCs. */
export function patchOverworldTestWarpSave(bytes: Uint8Array, destination: OverworldTestWarpDestination): Uint8Array {
  validateDestination(destination);
  const config = getTestBattleConfig("BW2");
  const layout = config.saveLayout;
  if (bytes.length < layout.saveHalfOffset + 0x25fa4) throw new Error("The bundled BW2 warp test save is truncated.");
  const out = bytes.slice();
  for (const half of [0, layout.saveHalfOffset]) {
    // LOCATION is 28 bytes; special_loc is the third LOCATION in SITUATION.
    const offset = half + SITUATION_OFFSET + SPECIAL_LOCATION_OFFSET;
    out.fill(0, offset, offset + 28);
    writeU32(out, offset, 1); // LOCATION_TYPE_DIRECT (no destination warp needed).
    writeU16(out, offset + 4, destination.zoneId);
    writeU16(out, offset + 6, 0xffff);
    writeU16(out, offset + 8, 2); // EXIT_DIR_DOWN.
    writeU32(out, offset + 16, destination.gridX * 0x10000 + 0x8000);
    // Grid maps resolve terrain height when the player model is initialized.
    writeU32(out, offset + 24, destination.gridZ * 0x10000 + 0x8000);
    refreshTestBattleSaveBlockChecksum(out, layout, half, SITUATION_OFFSET, SITUATION_LENGTH, 0x195aa, 28);
  }
  return out;
}

function validateDestination(destination: OverworldTestWarpDestination): void {
  if (!Number.isInteger(destination.zoneId) || destination.zoneId < 0 || destination.zoneId > 0x7fff
    || !Number.isInteger(destination.gridX) || destination.gridX < 0 || destination.gridX > 0x7fff
    || !Number.isInteger(destination.gridZ) || destination.gridZ < 0 || destination.gridZ > 0x7fff) {
    throw new Error("The selected tile is outside the BW2 location coordinate range.");
  }
}
