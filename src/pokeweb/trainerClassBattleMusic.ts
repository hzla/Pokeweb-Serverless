import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";

export const TRAINER_CLASS_BATTLE_MUSIC_PATH = "m/b";
export const TRAINER_CLASS_MUSIC_COUNT = 236;
export const TRAINER_CLASS_MUSIC_DEFAULT = 0xffff;
const OVERLAY_ID = 36;
const ARM9_BASE = 0x02004000;
const GROUP_COUNT = 15; // 14 special groups and the normal fallback
const CLASS_SLOTS = 256; // The native class ID is an unsigned byte.
const MAGIC = 0x314d4342; // BCM1
const FILE_NAME_BYTES = [0x6d, 0x2f, 0x62, 0];

const PROFILES = {
  IREO: { base: 0x0217f600, hook: 0x46ba0, pool: 0x46c14, helper: 0x532e4, table: 0x8e394,
    genderGetter: 0x2c734, readNarc: 0x0204a960, free: 0x0203a24c,
    stock: "6af610fb071c01986af6fafa0e2f08d218497a00895a03b02180",
    legacy: "1c498200895c21706af60cfb071c01986af6f6fa0e2f04d203b0" },
  IRDO: { base: 0x0217f640, hook: 0x46b98, pool: 0x46c0c, helper: 0x532d8, table: 0x8e3c0,
    genderGetter: 0x2c760, readNarc: 0x0204a98c, free: 0x0203a278,
    stock: "6af60afb071c01986af6f4fa0e2f08d218497a00895a03b02180",
    legacy: "1c498200895c21706af606fb071c01986af6f0fa0e2f04d203b0" },
};
type Profile = typeof PROFILES[keyof typeof PROFILES];

// The US Black 2 and White 2 retail tables have the same class-gender column.
const FEMALE_CLASSES = new Set([
  1, 3, 5, 6, 9, 13, 14, 16, 18, 19, 21, 23, 25, 28, 34, 36, 38, 42, 46, 48, 49, 55, 60, 62,
  64, 65, 69, 71, 75, 77, 78, 81, 85, 87, 91, 94, 95, 98, 100, 107, 109, 111, 112, 114, 116, 121,
  123, 124, 129, 132, 134, 135, 136, 139, 141, 143, 146, 149, 150, 153, 154, 159, 160, 163, 164, 168,
  169, 170, 173, 179, 181, 183, 185, 188, 193, 198, 200, 202, 204, 206, 208, 210, 214, 215, 217, 220,
  221, 224, 226, 229, 230,
]);
const STOCK_GROUPS = [1132, 1135, 1145, 1262, 1130, 1258, 1137, 1257, 1260, 1259, 1267, 1261, 1258, 1133, 1130];
const EFFECTS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 5, 10, 5, 24, 25, 26, 26, 26, 26, 23, 27, 30, 31, 5, 5, 9, 9];

export type TrainerClassBattleMusic = {
  groups: number[];
  overrides: number[];
  classGroups: number[];
  installed: boolean;
  migrated?: boolean;
  overlay: Uint8Array;
  fileId?: number;
};

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], byte => parseInt(byte, 16));
}

function matches(data: Uint8Array, offset: number, signature: ArrayLike<number>): boolean {
  return offset >= 0 && offset + signature.length <= data.length
    && Array.from(signature).every((byte, i) => data[offset + i] === byte);
}

function profileFor(project: ProjectState, rom: NintendoDSRom): Profile | undefined {
  if (project.session.baseRom !== "BW2" || rom.arm9RamAddress !== ARM9_BASE || rom.data[0x1e] !== 0) return undefined;
  if (rom.idCode === "IREO" || rom.idCode === "IRDO") return PROFILES[rom.idCode];
  return undefined;
}

function writeBl(data: Uint8Array, offset: number, address: number, target: number): void {
  const delta = target - (address + offset + 4);
  writeU16(data, offset, 0xf000 | ((delta >> 12) & 0x7ff));
  writeU16(data, offset + 2, 0xf800 | ((delta >> 1) & 0x7ff));
}

function musicHook(profile: Profile): Uint8Array {
  // The class ID is in r0, r4 points to the output, and [sp,#4] retains the class ID.
  const hook = bytes("211c000000000198"); // mov r1,r4; bl helper; ldr r0,[sp,#4]
  writeBl(hook, 2, profile.base + profile.hook, profile.base + profile.helper);
  return hook;
}

function musicHelper(profile: Profile): Uint8Array {
  // Read one two-byte NARC member by class, write the full sequence ID, then free it.
  // push {r4,lr}; mov r4,r1; mov r1,r0; ldr r0,=path; movs r2,#4; bl ReadHeapNewDirect;
  // ldrh r1,[r0]; strh r1,[r4]; bl HeapFree; pop {r4,pc}; .word path
  const helper = bytes("10b50c1c011c0448042200000000018821800000000010bd00000000");
  writeBl(helper, 10, profile.base + profile.helper, profile.readNarc);
  writeBl(helper, 18, profile.base + profile.helper, profile.free);
  writeU32(helper, 24, profile.base + profile.pool);
  return helper;
}

function identify(profile: Profile, overlay: Uint8Array): "stock" | "legacy" | "fixed" | "manual" | undefined {
  if (!matches(overlay, profile.helper + 28, EFFECTS) || readU32(overlay, profile.pool + 4) !== profile.base + profile.helper + 28) return undefined;
  if (matches(overlay, profile.hook, bytes(profile.stock)) && readU16(overlay, profile.pool - 8) === 0x8020
    && readU32(overlay, profile.pool) === profile.base + profile.helper) return "stock";
  if (readU16(overlay, profile.pool - 8) !== 0x4804) return undefined;
  const tail = bytes(profile.legacy).subarray(8);
  if (!matches(overlay, profile.hook + 8, tail)) return undefined;
  if (matches(overlay, profile.hook, bytes(profile.legacy)) && readU32(overlay, profile.pool) === ARM9_BASE + profile.table + 1) return "legacy";
  if (matches(overlay, profile.hook, musicHook(profile)) && matches(overlay, profile.helper, musicHelper(profile))
    && matches(overlay, profile.pool, FILE_NAME_BYTES)) return "fixed";
  if (profile === PROFILES.IREO && readU32(overlay, profile.pool) === ARM9_BASE + profile.table + 1
    && matches(overlay, profile.hook, bytes("6a230cf09ffb2370"))
    && matches(overlay, profile.helper, bytes("05490a78904205d34a78904201d90331f7e78b787047c04674291a02"))) return "manual";
  return undefined;
}

function classGroups(arm9: Uint8Array, profile: Profile): number[] {
  const groups = Array<number>(CLASS_SLOTS).fill(GROUP_COUNT - 1);
  const seen = new Set<number>();
  const start = profile.table - 0xd8;
  // Native special-class records contain three bytes: class, music group, pedestal.
  for (let row = start; row < start + 29 * 3; row += 3) {
    const cls = arm9[row];
    const group = arm9[row + 1];
    if (!seen.has(cls) && group < GROUP_COUNT - 1) groups[cls] = group;
    seen.add(cls);
  }
  return groups;
}

function archiveBytes(state: TrainerClassBattleMusic): Uint8Array {
  const archive = new NARC();
  archive.files = state.classGroups.map((_, id) => {
    const file = new Uint8Array(2);
    writeU16(file, 0, trainerClassBattleTrack(state, id));
    return file;
  });
  const meta = new Uint8Array(4 + 2 * (GROUP_COUNT + TRAINER_CLASS_MUSIC_COUNT));
  writeU32(meta, 0, MAGIC);
  [...state.groups, ...state.overrides].forEach((sequence, i) => writeU16(meta, 4 + i * 2, sequence));
  archive.files.push(meta);
  return archive.save();
}

export function trainerClassBattleTrack(state: TrainerClassBattleMusic, id: number): number {
  const selected = state.overrides[id] ?? TRAINER_CLASS_MUSIC_DEFAULT;
  return selected === TRAINER_CLASS_MUSIC_DEFAULT ? state.groups[state.classGroups[id] ?? GROUP_COUNT - 1] : selected;
}

function readArchive(data: Uint8Array, state: TrainerClassBattleMusic): void {
  const archive = new NARC(data);
  const meta = archive.files[CLASS_SLOTS];
  if (archive.files.length !== CLASS_SLOTS + 1 || !meta || meta.length !== 4 + 2 * (GROUP_COUNT + TRAINER_CLASS_MUSIC_COUNT)
    || readU32(meta, 0) !== MAGIC || archive.files.slice(0, CLASS_SLOTS).some(file => file.length !== 2)) {
    throw new Error("The per-class battle music archive is incompatible.");
  }
  state.groups = Array.from({ length: GROUP_COUNT }, (_, i) => readU16(meta, 4 + i * 2));
  state.overrides = Array.from({ length: TRAINER_CLASS_MUSIC_COUNT }, (_, i) => readU16(meta, 4 + (GROUP_COUNT + i) * 2));
}

function priorFixTracks(overlay: Uint8Array): number[] {
  const tracks = Array<number>(TRAINER_CLASS_MUSIC_COUNT).fill(0x046a);
  let previous = -1;
  for (let at = 0x23374; at + 3 <= 0x233a8; at += 3) {
    const start = overlay[at], end = overlay[at + 1], value = overlay[at + 2];
    if (start === 255 && end === 255) return tracks;
    if (start <= previous || end < start || end >= tracks.length) break;
    tracks.fill(0x0400 | value, start, end + 1);
    previous = end;
  }
  throw new Error("The earlier trainer music repair has an invalid track table.");
}

/** Recognize US Black 2 and White 2, then migrate only verified legacy code and data. */
export function loadTrainerClassBattleMusic(project: ProjectState, rom: NintendoDSRom): TrainerClassBattleMusic | undefined {
  const profile = profileFor(project, rom);
  if (!profile) return undefined;
  const arm9 = project.arm9;
  if (arm9.length < profile.table + 4 * TRAINER_CLASS_MUSIC_COUNT
    || !matches(arm9, profile.genderGetter, bytes("81000148405c7047"))
    || readU32(arm9, profile.genderGetter + 8) !== ARM9_BASE + profile.table + 1) return undefined;
  const field = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_, id) => getRomFileBytes(project, rom, id), new Set([OVERLAY_ID])).get(OVERLAY_ID);
  if (field?.ramAddress !== profile.base) return undefined;
  const overlay = project.overlays[OVERLAY_ID] ?? field.data;
  const kind = identify(profile, overlay);
  if (!kind) return undefined;

  const fileId = rom.filenames.idOf(TRAINER_CLASS_BATTLE_MUSIC_PATH);
  const archive = project.fileSystem?.additions?.[TRAINER_CLASS_BATTLE_MUSIC_PATH]
    ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
  const state: TrainerClassBattleMusic = {
    groups: kind === "manual" || kind === "fixed" ? [...STOCK_GROUPS] : Array.from({ length: GROUP_COUNT },
      (_, i) => readU16(overlay, i === GROUP_COUNT - 1 ? profile.pool + 8 : profile.helper + i * 2)),
    overrides: Array<number>(TRAINER_CLASS_MUSIC_COUNT).fill(TRAINER_CLASS_MUSIC_DEFAULT),
    classGroups: classGroups(arm9, profile),
    installed: kind === "fixed", overlay, fileId,
  };
  if (kind === "fixed") {
    if (!archive) throw new Error("The per-class battle music archive is missing.");
    readArchive(archive, state);
  } else if (kind === "legacy" || kind === "manual") {
    if (archive) throw new Error(`The ROM file ${TRAINER_CLASS_BATTLE_MUSIC_PATH} conflicts with the per-class battle music archive.`);
    const restored = arm9.slice();
    const legacyValues = state.overrides.map((_, i) => arm9[profile.table + i * 4 + 1]);
    const tracks = kind === "manual" ? priorFixTracks(overlay) : legacyValues.map(value => 0x0400 | value);
    const stockGender = legacyValues.every((v, i) => v === Number(FEMALE_CLASSES.has(i)));
    for (let i = 0; i < TRAINER_CLASS_MUSIC_COUNT; i += 1) {
      restored[profile.table + i * 4 + 1] = Number(FEMALE_CLASSES.has(i));
      // The first gender repair already lost the overwritten music values.
      if ((kind === "manual" || !stockGender) && tracks[i] !== state.groups[state.classGroups[i]]) state.overrides[i] = tracks[i];
    }
    stageTrainerClassBattleMusic(project, state);
    state.migrated = true;
    if (!stockGender) {
      project.arm9 = restored;
      project.arm9Dirty = true;
    }
  } else if (archive) {
    return undefined;
  }
  return state;
}

export function stageTrainerClassBattleMusic(project: ProjectState, state: TrainerClassBattleMusic): void {
  const profile = PROFILES[project.romInfo.idCode as keyof typeof PROFILES];
  const archive = archiveBytes(state);
  if (!state.installed) {
    const patched = state.overlay.slice();
    patched.set(bytes(profile.legacy), profile.hook);
    patched.set(musicHook(profile), profile.hook);
    patched.set(musicHelper(profile), profile.helper);
    patched.set(FILE_NAME_BYTES, profile.pool);
    writeU16(patched, profile.pool - 8, 0x4804); // Keep the class-selected track on the fallback intro path.
    project.overlays[OVERLAY_ID] = state.overlay = patched;
    project.patches ??= { dirtyOverlayIds: [], applied: {} };
    if (!project.patches.dirtyOverlayIds.includes(OVERLAY_ID)) project.patches.dirtyOverlayIds.push(OVERLAY_ID);
    state.installed = true;
  }
  if (state.fileId === undefined) addRomFile(project, TRAINER_CLASS_BATTLE_MUSIC_PATH, archive);
  else setRomFileReplacement(project, state.fileId, archive);
}
