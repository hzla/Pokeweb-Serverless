import { concatBytes, equalBytes } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import type { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordFieldChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { getOverlayInfo, isOverlayStaged, projectOverlayTable } from "./overlayEditModel";
import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";

export const VANILLA_OBEDIENCE_CAPS = [10, 20, 30, 40, 50, 60, 70, 80, 100] as const;
const CAP_TABLE_OFFSET = 0x2c;
const PATCH_LENGTH = 0x36;

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));
}

const BW = {
  overlay: 93, routineOffset: 0x6eac, gateOffset: 0x48,
  vanilla: hexBytes("082e40d2381c0f2118f0dafc0004040c711c0a2048430004060cb44201d80020f8bda019401c1af047fc0004000cb04201d20020f8bd"),
  // Thumb code from the badge check through the first obedience roll. The
  // unchanged end of the routine still chooses the disobedience action.
  code: hexBytes("082e40d8381c0f2118f0dafc0004040c06a0865db44236d9a019401c1af04cfc0004000cb0422ed305e0c046"),
};
const BW2 = {
  overlay: 167, routineOffset: 0x7184, gateOffset: 0x58,
  vanilla: hexBytes("082e40d2381c0f211af086fb0004040c711c0a2048430004060cb44201d80020f8bda019401c1cf0fdfa0004000cb04201d20020f8bd"),
  code: hexBytes("082e40d8381c0f211af086fb0004040c06a0865db44236d9a019401c1cf002fb0004000cb0422ed305e0c046"),
};
const profiles = {
  B: { ...BW, idCode: "IRBO", base: 0x021b6100, guard: "71aabe46dc5c5fe1b2423ebfde4999062b9fae21770a126974fc138cc28152c1" },
  W: { ...BW, idCode: "IRAO", base: 0x021b6120, guard: "6b89a1009050fd4dc8149a331155ed1422fb7dbb0579f57eb3673720abb8c764" },
  B2: { ...BW2, idCode: "IREO", base: 0x021998c0, guard: "fd5c40525486f39df943bafc4c125d3027d5c3d4c7c3cb50cb074eb55a38a22e" },
  W2: { ...BW2, idCode: "IRDO", base: 0x02199900, guard: "9bda47e0d5288db71b0ec6afed676829d1be1455ff82d83b25ba0cc1aaf4652d" },
} as const;

function profileFor(project: ProjectState) {
  const version = project.session.baseVersion;
  if (version === "B" || version === "W" || version === "B2" || version === "W2") {
    const profile = profiles[version];
    if (project.romInfo.idCode === profile.idCode) return profile;
  }
}

export function supportsObedienceCaps(project: ProjectState): boolean {
  return profileFor(project) !== undefined;
}

function validCap(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 100;
}

function nativeCaps(project: ProjectState, rom: NintendoDSRom) {
  const profile = profileFor(project);
  if (!profile || rom.idCode !== profile.idCode || rom.data[0x1e] !== 0) {
    throw new Error("Obedience caps require a compatible US Black, White, Black 2 or White 2 revision-0 ROM.");
  }
  const info = getOverlayInfo(project, rom, profile.overlay);
  if (!info || info.readOnlyReason) {
    throw new Error("Could not verify the battle overlay layout.");
  }
  // Fairy Type Support prepends bytes and lowers the overlay base. The
  // native routine and its relative branches still have their retail addresses.
  const startAddress = profile.base + profile.routineOffset;
  const routineOffset = startAddress - info.ramAddress;
  const bytes = (isOverlayStaged(project, profile.overlay) ? project.overlays[profile.overlay] : undefined)
    ?? loadOverlayTable(projectOverlayTable(project, rom), (_id, fileId) => getRomFileBytes(project, rom, fileId),
      new Set([profile.overlay])).get(profile.overlay)?.data;
  const gate = routineOffset + profile.gateOffset;
  const end = gate + 0x8a;
  if (!bytes || routineOffset < 0 || bytes.length !== info.ramSize || bytes.length < end
    || sha256Hex(concatBytes([bytes.subarray(routineOffset, gate), bytes.subarray(gate + PATCH_LENGTH, end)])) !== profile.guard) {
    throw new Error("Could not verify the native obedience routine.");
  }
  const current = bytes.subarray(gate, gate + PATCH_LENGTH);
  let caps: number[];
  if (equalBytes(current, profile.vanilla)) {
    caps = [...VANILLA_OBEDIENCE_CAPS];
  } else {
    caps = Array.from(current.subarray(CAP_TABLE_OFFSET, CAP_TABLE_OFFSET + VANILLA_OBEDIENCE_CAPS.length));
    if (!equalBytes(current.subarray(0, CAP_TABLE_OFFSET), profile.code)
      || !caps.every(validCap) || current[PATCH_LENGTH - 1] !== 0) {
      throw new Error("This ROM already has a different obedience modification.");
    }
  }
  const endAddress = info.ramAddress + end;
  for (const module of listCodeInjectionDlls(project)) {
    if (module.target !== "patches") continue;
    const added = Object.keys(project.fileSystem?.additions ?? {}).find(path => path.toLowerCase() === module.path.toLowerCase());
    const fileId = rom.filenames.idOf(module.path);
    const dll = added ? project.fileSystem?.additions?.[added] : fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
    if (!dll) continue;
    let rpm;
    try { rpm = parseRpm(dll, { allowedMagics: ["DLXF"] }); }
    catch { continue; }
    if (rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
      return target.module === String(profile.overlay) && target.address < endAddress && target.address + size > startAddress;
    })) throw new Error(`Obedience is already modified by ${module.path}.`);
  }
  return { profile, bytes, gate, caps };
}

export function getObedienceCaps(project: ProjectState, rom: NintendoDSRom): number[] {
  return nativeCaps(project, rom).caps;
}

export function updateObedienceCap(project: ProjectState, rom: NintendoDSRom, badges: number, cap: number): boolean {
  if (!Number.isInteger(badges) || badges < 0 || badges >= VANILLA_OBEDIENCE_CAPS.length) throw new Error("Choose a badge count from 0 to 8.");
  if (!validCap(cap)) throw new Error("Enter a whole level from 1 to 100.");
  const { profile, bytes, gate, caps } = nativeCaps(project, rom);
  const before = caps[badges];
  if (before === cap) return false;
  caps[badges] = cap;
  const updated = bytes.slice();
  if (caps.every((value, i) => value === VANILLA_OBEDIENCE_CAPS[i])) {
    updated.set(profile.vanilla, gate);
  } else {
    updated.set(profile.code, gate);
    updated.set(caps, gate + CAP_TABLE_OFFSET);
    updated[gate + PATCH_LENGTH - 1] = 0;
  }
  project.overlays[profile.overlay] = updated;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(profile.overlay)) project.patches.dirtyOverlayIds.push(profile.overlay);
  recordFieldChange(project, "obedience_caps", `${badges} ${badges === 1 ? "badge" : "badges"}`, "obedience cap", before, cap, {
    key: `obedience-cap:${badges}`,
  });
  return true;
}
