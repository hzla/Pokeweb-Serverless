import { readU32, writeU16 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import type { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { getRomFileBytes } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";
import runtime from "../assets/data/pmcFiveBoxRuntime.json";

export const FIVE_BOX_PMC_VERSION = "13.2.4-heap320-five-box";
export const FIVE_BOX_PMC_CAP_KIB = 320;
export const FIVE_BOX_PMC_ESTIMATE_KIB = 276;
export const FIVE_BOX_PMC_OVERLAY_SIZE = 0x4000;
export const FIVE_BOX_PC_OVERLAY = runtime.pc.id;

const PAYLOAD_OFFSET = 0x3000;
const FOOTER_SIZE = 0x10;
const PAYLOAD_END = FIVE_BOX_PMC_OVERLAY_SIZE - FOOTER_SIZE;
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../gu)!, byte => parseInt(byte, 16));
const equalAt = (data: Uint8Array, offset: number, value: Uint8Array) =>
  offset >= 0 && offset + value.length <= data.length && value.every((byte, i) => data[offset + i] === byte);
const arm9Edits = runtime.arm9.map(edit => ({ address: edit.address, before: hexBytes(edit.before), after: hexBytes(edit.after) }));
// The first Five-Box release shares the same PMC version and storage ABI.
// Its ARM9 branches must keep pointing to that release until the loader is rebuilt.
const legacyBranches: Record<number, string> = {
  0x020078d4: "7847c046ece407ea", 0x0203ada8: "7847c046ad1707ea", 0x0203adb0: "7847c046bb1507ea",
  0x0203adc0: "7847c046e31507ea", 0x0203b0f4: "7847c046681607ea", 0x0203b740: "7847c0460f1507ea",
  0x0203b774: "7847c046251507ea", 0x0203b958: "7847c0465a1407ea", 0x0203ba22: "52229200", 0x0203bd74: "7847c046491307ea",
};
const legacyArm9Edits = arm9Edits.map(edit => ({ ...edit,
  after: legacyBranches[edit.address] ? hexBytes(legacyBranches[edit.address]) : edit.after }));
const legacyPayloadHash = "6825133c8720330c51bbe88afdec3ba42e1b05ba8ad8133b1b95512d8958ed51";
// The alternate PC build changes menu table offsets and counts, and calls a native ARM9 helper.
// Verify the complete set together and hash the rest of the overlay against retail.
const pcMenuEdits = ([
  [0x3bc0, "312c", "322c"],
  [0x7310, "bca50000", "00a70000"],
  [0x13e34, "0b490c48", "c4f63cfb"],
  [0x15106, "112c", "122c"],
  [0x1526c, "68a20000", "bca50000"],
  [0x152ca, "112c", "122c"],
  [0x1533e, "312c", "322c"],
] as const).map(([offset, stock, edited]) => ({ offset, stock: hexBytes(stock), edited: hexBytes(edited) }));
const pcMenuHelper = hexBytes("0cb506495218121b054b9a4203db054b9a4200d8044905480cbd0000dca0000068a20000aca2000030a40000949e0000");
const allocatorBefore = hexBytes(runtime.allocator.before);
const allocatorAfter = hexBytes(runtime.allocator.after);
const payload = new Uint8Array(PAYLOAD_END - PAYLOAD_OFFSET);
payload.set(Uint8Array.from(atob(runtime.payload), char => char.charCodeAt(0)));

export function fiveBoxPmcEnabled(project: Pick<ProjectState, "codeInjection">): boolean {
  return project.codeInjection?.pmc?.version === FIVE_BOX_PMC_VERSION;
}

export function assertFiveBoxTarget(rom: NintendoDSRom, base: number): void {
  if (rom.idCode !== "IRDO" || rom.data[30] !== 0 || base !== runtime.base ||
      readU32(rom.data, 0x34) !== 0x02380000 || readU32(rom.data, 0x38) !== 0x02380000 ||
      sha256Hex(rom.arm7) !== runtime.arm7Sha256) {
    throw Error("Five-Box Mode requires US White 2 revision 0 with its verified ARM7 image and PMC load address.");
  }
}

function matchesFiveBoxPcOverlay(pc: Uint8Array, stockHash: string, arm9: Uint8Array, arm9Base: number): boolean {
  if (sha256Hex(pc) === stockHash) return true;
  if (!pcMenuEdits.every(({ offset, edited }) => equalAt(pc, offset, edited)) ||
      !equalAt(arm9, 0x02093bf0 - arm9Base, pcMenuHelper)) return false;
  const normalized = pc.slice();
  for (const { offset, stock } of pcMenuEdits) normalized.set(stock, offset);
  return sha256Hex(normalized) === stockHash;
}

/** Verify the active native ABI before enabling, updating or reversing the patch. */
export function planFiveBoxNative(project: ProjectState, rom: NintendoDSRom, active: boolean, enabled: boolean) {
  const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
  const native = arm9.slice();
  const legacy = active && hasLegacyFiveBoxHooks(arm9, rom.arm9RamAddress);
  for (const edit of legacy ? legacyArm9Edits : arm9Edits) {
    const offset = edit.address - rom.arm9RamAddress;
    if (!equalAt(arm9, offset, active ? edit.after : edit.before)) {
      throw Error(`Five-Box Mode conflicts with ARM9 code at 0x${edit.address.toString(16)}.`);
    }
    native.set(edit.before, offset);
  }
  for (const range of runtime.nativeRanges) {
    const offset = range.address - rom.arm9RamAddress;
    if (offset < 0 || offset + range.size > native.length || sha256Hex(native.subarray(offset, offset + range.size)) !== range.sha256) {
      throw Error(`Five-Box Mode requires the original White 2 storage code at 0x${range.address.toString(16)}.`);
    }
  }

  const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  const row = FIVE_BOX_PC_OVERLAY * 32;
  if (readU32(table, row) !== FIVE_BOX_PC_OVERLAY || readU32(table, row + 4) !== runtime.pc.address) {
    throw Error("Five-Box Mode requires the original White 2 PC overlay layout.");
  }
  const stagedPc = project.patches?.dirtyOverlayIds.includes(FIVE_BOX_PC_OVERLAY) ? project.overlays[FIVE_BOX_PC_OVERLAY] : undefined;
  const file = getRomFileBytes(project, rom, readU32(table, row + 24));
  const pc = stagedPc ?? ((readU32(table, row + 28) & 0x01000000) ? decompressCode(file) : file);
  if (!matchesFiveBoxPcOverlay(pc, active ? runtime.pc.afterSha256 : runtime.pc.beforeSha256, native, rom.arm9RamAddress)) {
    throw Error("Five-Box Mode conflicts with an edit to the PC overlay.");
  }

  if (active === enabled && !legacy) return undefined;
  if (enabled) {
    for (const edit of arm9Edits) native.set(edit.after, edit.address - rom.arm9RamAddress);
  }
  const nextPc = pc.slice();
  writeU16(nextPc, runtime.pc.offset, enabled ? runtime.pc.after : runtime.pc.before);
  return { arm9: native, pc: nextPc };
}

export function addFiveBoxPayload(overlay: Uint8Array): Uint8Array {
  if (overlay.length !== PAYLOAD_OFFSET || !equalAt(overlay, runtime.allocator.offset, allocatorBefore)) {
    throw Error("Five-Box Mode requires the verified compact PMC allocator.");
  }
  const output = new Uint8Array(FIVE_BOX_PMC_OVERLAY_SIZE);
  output.set(overlay);
  output.set(allocatorAfter, runtime.allocator.offset);
  output.set(payload, PAYLOAD_OFFSET);
  output.set(overlay.subarray(PAYLOAD_OFFSET - FOOTER_SIZE), FIVE_BOX_PMC_OVERLAY_SIZE - FOOTER_SIZE);
  return output;
}

function matchesHooks(arm9: Uint8Array, ram: number, edits: typeof arm9Edits): boolean {
  return edits.every(edit => equalAt(arm9, edit.address - ram, edit.after));
}

export function hasLegacyFiveBoxHooks(arm9: Uint8Array, ram: number): boolean {
  return matchesHooks(arm9, ram, legacyArm9Edits);
}

function matchesAllocator(image: Uint8Array, base: number): boolean {
  return base === runtime.base && image.length === FIVE_BOX_PMC_OVERLAY_SIZE &&
    equalAt(image, runtime.allocator.offset, allocatorAfter);
}

function matchesLegacyPayload(image: Uint8Array, arm9: Uint8Array, ram: number): boolean {
  return sha256Hex(image.subarray(PAYLOAD_OFFSET, PAYLOAD_END)) === legacyPayloadHash && hasLegacyFiveBoxHooks(arm9, ram);
}

export function isFiveBoxLoaderImage(image: Uint8Array, base: number, arm9: Uint8Array, ram: number): boolean {
  return matchesAllocator(image, base) && (
    (equalAt(image, PAYLOAD_OFFSET, payload) && matchesHooks(arm9, ram, arm9Edits)) || matchesLegacyPayload(image, arm9, ram));
}

/** Compare a verified old runtime against a rebuilt current image, leaving all other bytes intact. */
export function normalizeLegacyFiveBoxRuntime(image: Uint8Array, arm9: Uint8Array, base: number, ram: number) {
  if (!matchesAllocator(image, base) || !matchesLegacyPayload(image, arm9, ram)) return undefined;
  const currentImage = image.slice(), currentArm9 = arm9.slice();
  currentImage.set(payload, PAYLOAD_OFFSET);
  for (const edit of arm9Edits) currentArm9.set(edit.after, edit.address - ram);
  return { image: currentImage, arm9: currentArm9 };
}

export function assertFiveBoxDllCompatible(bytes: Uint8Array, path: string): void {
  let dll: ReturnType<typeof parseRpm>;
  try { dll = parseRpm(bytes, { allowedMagics: ["DLXF"] }); }
  catch { throw Error(`Five-Box Mode cannot verify ${path}.`); }
  const overlaps = (start: number, length: number, address: number, size: number) =>
    start < address + size && address < start + length;
  for (const { target, sourceSymbolIndex } of dll.relocations) {
    const addr = target.address & ~1;
    const size = target.type === "FULL_COPY" ? dll.symbols[sourceSymbolIndex]?.size ?? 0
      : ["OFFSET", "OFFSET_REL31", "THUMB_BRANCH_LINK", "ARM_BRANCH_LINK"].includes(target.type) ? 4 : 16;
    if ((["ARM9", "0"].includes(target.module) && (
      overlaps(addr, size, 0x0207b41c, 4) || arm9Edits.some(edit => overlaps(addr, size, edit.address, edit.before.length)) ||
      runtime.nativeRanges.some(range => overlaps(addr, size, range.address, range.size)))) ||
      target.module === String(FIVE_BOX_PC_OVERLAY) || target.module === "344") {
      throw Error(`Five-Box Mode conflicts with ${path}.`);
    }
  }
}
