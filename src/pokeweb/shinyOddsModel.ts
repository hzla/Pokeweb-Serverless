import { readU32, writeU16, writeU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { getOverlayInfo, getOverlayWorkingBytes, isOverlayStaged } from "./overlayEditModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";

const profiles = {
  B: {
    idCode: "IRBO", overlay: 21, caller: 0x021a96b8, call: 0x021a96d4, generate: 0x021a9d30, isShiny: 0x02017ed8,
    callerHash: "b9d91c4ab08bcfc4ebdfb818a26df0bf0e598c41280dabf6fa8c336d60b9494d",
    generatorHash: "71e067e50e0afefcf1fc7ceff6fca5ac25f9a456b3c79ddd4741929fabe86e87",
  },
  W: {
    idCode: "IRAO", overlay: 21, caller: 0x021a96d8, call: 0x021a96f4, generate: 0x021a9d50, isShiny: 0x02017ef4,
    callerHash: "b626510592e269648dc52b7b79e610b01647a2f619ffafaaeed1f5354271477a",
    generatorHash: "400400b0edf35eaab69d7783e7798c18792bfa8280ba5fef4f78e04aafb090ad",
  },
  B2: {
    idCode: "IREO", overlay: 36, caller: 0x021a0dc0, call: 0x021a0e04, generate: 0x021a1508, isShiny: 0x0201cdd8,
    callerHash: "8e0c8e3fcecfbd8ddc245e0a184d162daa4ed198396353deab01032161c5d4b3",
    generatorHash: "a854244efff357ebc2ca5043409c0f6a08440e2a4f9616e522453df7378a581a",
  },
  W2: {
    idCode: "IRDO", overlay: 36, caller: 0x021a0e00, call: 0x021a0e44, generate: 0x021a1548, isShiny: 0x0201ce04,
    callerHash: "c6c6fd13d675d7329fde3ec5385e62cb3db9d370d334bd68393c1cd51eed349a",
    generatorHash: "4bf2ecc2d6224c9c7c8e170843c774bd663077220f06c65c4bbe0cc2e0e881e0",
  },
} as const;

type ShinyOddsGame = keyof typeof profiles;
type Profile = (typeof profiles)[ShinyOddsGame];
type ShinyOddsStatus = { supported: boolean; compatible: boolean; rolls?: number; message?: string };

export const SHINY_ODDS_MAX_ROLLS = 1024;
const CHECKER_HASH = "9ade54a6d05343d3871d765bf0122844740340f7f68c0217573d5ab1dc18138e";
const ROLLS_OFFSET = 0x34;
const VERSION = "1.0.0";

export function wildShinyChance(rolls: number): number {
  return -Math.expm1(rolls * Math.log1p(-1 / 8192));
}

function validRolls(rolls: number): boolean {
  return Number.isInteger(rolls) && rolls >= 1 && rolls <= SHINY_ODDS_MAX_ROLLS;
}

function identifyGame(project: ProjectState): ShinyOddsGame | undefined {
  const version = project.session.baseVersion;
  if (version !== "B" && version !== "W" && version !== "B2" && version !== "W2") return;
  const profile = profiles[version];
  if (project.session.baseRom === (profile.overlay === 21 ? "BW" : "BW2") && project.romInfo.idCode === profile.idCode) return version;
}

function dllName(game: ShinyOddsGame): string {
  return `ShinyOdds${game}.dll`;
}

// ARM946E-S Thumb function. r0/r1/r2 are the native field manager, personal
// data and encounter parameters. The original generator supplies each PID.
function buildDll(game: ShinyOddsGame, rolls: number): Uint8Array {
  const spec = profiles[game];
  const instructions = [
    0xb5f8, 0x0004, 0x000d, 0x0016, // push {r3-r7,lr}; preserve args in r4-r6
    0x4f0a, 0x79b3, 0x2b00, 0xd000, 0x2701, // load roll count, clamp to 1 for an explicit shiny policy
    0x0020, 0x0029, 0x0032, 0x4b07, 0x4798, // generate: restore args and call native PID generator
    0x3f01, 0xd007, 0x9000, 0x0001, 0x6a20, // return last PID when out of rolls; else save PID, load OT ID
    0x4b05, 0x4798, 0x2800, 0xd0f1, 0x9800, // call native shiny check; loop on failure, reload PID on success
    0xbdf8, 0x46c0, // return; align the literal pool
  ];
  const code = new Uint8Array(ROLLS_OFFSET + 12);
  instructions.forEach((word, index) => writeU16(code, index * 2, word));
  writeU32(code, ROLLS_OFFSET, rolls);
  writeU32(code, ROLLS_OFFSET + 4, spec.generate | 1);
  writeU32(code, ROLLS_OFFSET + 8, spec.isShiny | 1);
  return writeRpm({
    code, baseAddress: 0, bssSize: 0,
    symbols: [{ name: null, address: 0, size: code.length, type: "FUNCTION_THM", attributes: 0 }],
    relocations: [{ target: { module: String(spec.overlay), address: spec.call | 1, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: 0 }],
    metadata: { PMCGameID: game, PMCModulePriority: 4, PMCVersion: VERSION },
  }, { ident: "DLXF" });
}

function checkedRanges(spec: Profile) {
  const bw1 = spec.overlay === 21;
  return [
    { module: String(spec.overlay), address: spec.caller, length: bw1 ? 0xc4 : 0x10c, hash: spec.callerHash },
    { module: String(spec.overlay), address: spec.generate, length: bw1 ? 0x98 : 0xa4, hash: spec.generatorHash },
    { module: "ARM9", address: spec.isShiny, length: 40, hash: CHECKER_HASH },
  ];
}

function inspectPatch(project: ProjectState, rom: NintendoDSRom, game: ShinyOddsGame): number | undefined {
  const spec = profiles[game];
  const overlay = getOverlayInfo(project, rom, spec.overlay);
  if (!overlay) throw new Error(`Field overlay ${spec.overlay} is missing.`);
  // An unstaged working copy can predate a raw NitroFS replacement.
  const rawReplacement = !isOverlayStaged(project, spec.overlay) && project.fileSystem?.replacements?.[overlay.fileId];
  const data = getOverlayWorkingBytes(rawReplacement ? { ...project, overlays: {} } : project, rom, spec.overlay);
  const ranges = checkedRanges(spec);
  const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
  for (const range of ranges) {
    const main = range.module === "ARM9";
    const offset = range.address - (main ? rom.arm9RamAddress : overlay.ramAddress);
    const bytes = (main ? arm9 : data).subarray(Math.max(offset, 0), Math.max(offset, 0) + range.length);
    if (offset < 0 || sha256Hex(bytes) !== range.hash) {
      throw new Error(`Shiny Odds needs the retail encounter and shiny-check code. Code at 0x${range.address.toString(16)} differs.`);
    }
  }

  const ownPath = `patches/${dllName(game)}`;
  let rolls: number | undefined;
  for (const entry of listCodeInjectionDlls(project)) {
    const addedPath = Object.keys(project.fileSystem?.additions ?? {}).find(path => path === entry.path);
    const fileId = rom.filenames.idOf(entry.path);
    const bytes = addedPath ? project.fileSystem!.additions![addedPath]
      : fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
    let rpm: RpmModule | undefined;
    try { if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { /* An unreadable module cannot be checked. */ }
    if (entry.path.toLowerCase() === ownPath.toLowerCase()) {
      const count = rpm && rpm.code.length >= ROLLS_OFFSET + 4 ? readU32(rpm.code, ROLLS_OFFSET) : 0;
      const expected = validRolls(count) ? buildDll(game, count) : undefined;
      if (entry.path !== ownPath || !bytes || !expected || bytes.length !== expected.length
        || !bytes.every((byte, index) => byte === expected[index])) {
        throw new Error(`An unrecognized DLL uses the ${dllName(game)} filename.`);
      }
      rolls = count;
      continue;
    }
    if (!rpm) throw new Error(`Cannot check ${entry.path} for overlapping code changes.`);
    if (rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      const module = target.module === "0" ? "ARM9" : target.module.replace(/^OVL_/i, "");
      const start = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm!.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12
        : target.type === "ARM_BRANCH" ? 8 : 4;
      return ranges.some(range => range.module === module && start < range.address + range.length && start + size > range.address);
    })) throw new Error(`Shiny Odds overlaps ${entry.path}.`);
  }
  return rolls;
}

export function getShinyOddsStatus(project: ProjectState): ShinyOddsStatus {
  const game = identifyGame(project);
  const bytes = project.originalRomBytes;
  if (!game || (bytes && bytes[0x1e] !== 0)) {
    return { supported: false, compatible: false, message: "Requires US Black, White, Black 2 or White 2 revision 0." };
  }
  if (!bytes) return { supported: true, compatible: false, message: "Load ROM data to check compatibility." };
  try {
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    if (rom.idCode !== profiles[game].idCode) throw new Error("Reload the matching ROM.");
    return { supported: true, compatible: true, rolls: inspectPatch(project, rom, game) };
  } catch (error) {
    return { supported: true, compatible: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function stageShinyOdds(project: ProjectState, rolls: number): boolean {
  if (!validRolls(rolls)) throw new Error(`PID rolls must be a whole number from 1 to ${SHINY_ODDS_MAX_ROLLS}.`);
  const game = identifyGame(project);
  const status = getShinyOddsStatus(project);
  if (!game || !status.compatible) throw new Error(status.message ?? "Shiny Odds is incompatible with this ROM.");
  if (rolls === (status.rolls ?? 1)) return false;
  stageCodeInjectionDll(project, dllName(game), buildDll(game, rolls));
  recordGenericChange(project, "code_injection", `Configured ${rolls} wild PID roll${rolls === 1 ? "" : "s"} per native roll.`, "Shiny Odds", {
    key: "code-injection:shiny-odds",
  });
  return true;
}
