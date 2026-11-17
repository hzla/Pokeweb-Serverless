import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { loadOverlayTable, type Overlay } from "../nds/code";
import { recordGenericChange } from "./actionChangelog";
import { withProjectMutationLock } from "./codeInjectionInstall";
import type { ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";

const TARGET_IDS = new Set([165, 337, 338]);
const ARM_MAIN_RAM = 0x02000000;
const ARM_MAIN_RAM_END = 0x02400000;
const RETURN_STUB_SIZE = 12;
const ARM_LOAD_RETURN_VALUE = 0xe59f0000; // ldr r0, [pc]
const ARM_RETURN = 0xe12fff1e; // bx lr

// nds-bootstrap's IREO and IRDO patches select the same challenge responses.
// The game stores tagged addresses in repeated dispatch records. The record
// order distinguishes the challenges even when the records move in the image.
const DISPATCH_GROUPS = [
  { id: 165, recordCount: 6, records: [5], responses: [0xaa65] },
  { id: 337, recordCount: 12, records: [5, 6, 7], responses: [0xa883, 0xb3cf, 0xc127] },
] as const;

function gamePatchId(gameCode: string): "black2ApFix" | "white2ApFix" | undefined {
  if (gameCode === "IREO") return "black2ApFix";
  if (gameCode === "IRDO") return "white2ApFix";
}

export function getBw2ApFixStatus(project: ProjectState): "unsupported" | "ready" | "enabled" {
  const patchId = gamePatchId(project.romInfo.idCode);
  if (!patchId) return "unsupported";
  return project.patches?.applied?.[patchId] ? "enabled" : "ready";
}

export function setBw2ApFix(project: ProjectState, enabled: boolean): Promise<RomPatchApplyResult> {
  return withProjectMutationLock(project, () => {
    const patchId = gamePatchId(project.romInfo.idCode);
    if (!patchId) throw unsupportedGame();
    project.patches ??= { dirtyOverlayIds: [] };
    project.patches.applied ??= {};
    project.patches.applied[patchId] = enabled;
    const summary = enabled ? "AP fix enabled for ROM exports." : "AP fix disabled for future exports.";
    const key = patchId === "black2ApFix" ? "patch:black2-ap-fix" : "patch:white2-ap-fix";
    recordGenericChange(project, "patches", summary, "Black 2 / White 2 AP Fix", { key });
    return { patchId, status: "applied", summary };
  });
}

/** Work on the effective output overlays, after other edits and before packing. */
export function planBw2ApFix(
  gameCode: string, overlayTable: Uint8Array, readFile: (fileId: number) => Uint8Array | undefined,
): { table: Uint8Array; files: Map<number, Uint8Array> } | undefined {
  if (!gamePatchId(gameCode)) throw unsupportedGame();

  const rows = new Map<number, number>();
  const fileUses = new Map<number, number>();
  const ramStarts: number[] = [];
  for (let row = 0; row + 32 <= overlayTable.length; row += 32) {
    const id = readU32(overlayTable, row);
    const fileId = readU32(overlayTable, row + 24);
    fileUses.set(fileId, (fileUses.get(fileId) ?? 0) + 1);
    ramStarts.push(readU32(overlayTable, row + 4));
    if (!TARGET_IDS.has(id)) continue;
    if (rows.has(id)) throw incompatible(id, "duplicate overlay");
    rows.set(id, row);
  }
  for (const id of TARGET_IDS) {
    if (!rows.has(id)) throw incompatible(id, "missing overlay");
  }
  const overlays = loadOverlayTable(overlayTable, (id, fileId) => {
    const bytes = readFile(fileId);
    if (!bytes) throw incompatible(id, "missing image");
    return bytes;
  }, TARGET_IDS);
  for (const [id, overlay] of overlays) {
    if (overlay.data.length !== overlay.ramSize || overlay.ramAddress < ARM_MAIN_RAM
      || overlay.ramAddress + overlay.ramSize + overlay.bssSize > ARM_MAIN_RAM_END) {
      throw incompatible(id, "invalid RAM image");
    }
  }
  if ([...overlays.values()].some((overlay) => fileUses.get(overlay.fileId) !== 1)) {
    throw new Error("Black 2 / White 2 AP Fix found shared file IDs for its target overlays.");
  }

  const table = overlayTable.slice();
  const files = new Map<number, Uint8Array>();
  for (const group of DISPATCH_GROUPS) {
    const overlay = overlays.get(group.id)!;
    const data = patchDispatchGroup(overlay, group, ramStarts);
    if (data !== overlay.data) {
      const row = rows.get(group.id)!;
      // The old BSS becomes zero-filled file data at the same RAM addresses.
      // Code follows it, so the original static initializers and BSS can
      // keep using their existing addresses.
      writeU32(table, row + 12, 0);
      setOverlayImage(table, row, overlay.fileId, data, files);
    }
  }
  const cardOverlay = overlays.get(338)!;
  const cardData = patchCardChecks(cardOverlay.data);
  if (cardData !== cardOverlay.data) setOverlayImage(table, rows.get(338)!, cardOverlay.fileId, cardData, files);
  return files.size ? { table, files } : undefined;
}

function patchDispatchGroup(
  overlay: Overlay, { id, recordCount, records, responses }: (typeof DISPATCH_GROUPS)[number], ramStarts: number[],
): Uint8Array {
  const { data, ramAddress, bssSize } = overlay;
  const dispatches: number[] = [];
  for (let offset = 0; offset + 16 <= data.length; offset += 4) {
    if (readU32(data, offset + 4) === 0xebc8dab4 && readU32(data, offset + 8) === 0x0af5eaf8
      && readU32(data, offset + 12) === 0x367549b8) dispatches.push(offset);
  }
  if (dispatches.length !== recordCount) throw incompatible(id, "unexpected challenge dispatch records");

  const pending: { dispatch: number; response: number }[] = [];
  for (const [index, record] of records.entries()) {
    const dispatch = dispatches[record];
    const encoded = readU32(data, dispatch);
    const target = (ARM_MAIN_RAM | (encoded & 0xffffff)) - ramAddress;
    if ((encoded >>> 24) !== 0x6a || target < 0 || target + RETURN_STUB_SIZE > data.length || target % 4 !== 0) {
      throw incompatible(id, "unknown challenge handler address");
    }
    const response = responses[index];
    if (readU32(data, target) === ARM_LOAD_RETURN_VALUE && readU32(data, target + 4) === ARM_RETURN
      && readU32(data, target + 8) === response) continue;
    if (readU32(data, target) !== 0xe36a1ab4 || readU32(data, target + 4) !== 0x078869a4
      || readU32(data, target + 8) !== 0xe7037ac8) throw incompatible(id, "unknown challenge handler");
    pending.push({ dispatch, response });
  }
  if (!pending.length) return data;

  const oldEnd = ramAddress + data.length + bssSize;
  const stubStart = Math.ceil((data.length + bssSize) / 4) * 4;
  const newSize = stubStart + pending.length * RETURN_STUB_SIZE;
  const newEnd = ramAddress + newSize;
  if (newEnd > ARM_MAIN_RAM_END || ramStarts.some((start) => start >= oldEnd && start < newEnd)) {
    throw incompatible(id, "no room for the replacement handlers");
  }

  const out = new Uint8Array(newSize);
  out.set(data);
  for (const [index, { dispatch, response }] of pending.entries()) {
    const stub = stubStart + index * RETURN_STUB_SIZE;
    writeU32(out, dispatch, 0x6a000000 | ((ramAddress + stub) & 0xffffff));
    writeU32(out, stub, ARM_LOAD_RETURN_VALUE);
    writeU32(out, stub + 4, ARM_RETURN);
    writeU32(out, stub + 8, response);
  }
  return out;
}

function patchCardChecks(data: Uint8Array): Uint8Array {
  const cardId = findCardCheck(data, 12, (at) =>
    readU32(data, at + 4) === 0xa9004833 && readU32(data, at + 8) === 0x60816042, "card ID");
  const wait = findCardCheck(data, 16, (at) =>
    readU32(data, at) === 0x20804a02 && readU32(data, at + 4) === 0x42018811
    && readU16(data, at + 10) === 0x4770 && readU32(data, at + 12) === 0x040001a0, "card wait") + 8;
  const verify = findCardCheck(data, 12, (at) =>
    readU32(data, at) === 0xd10128aa && readU32(data, at + 4) === 0xbd082001
    && readU16(data, at + 10) === 0xbd08, "card verification") + 8;

  const idCode = readU32(data, cardId), waitCode = readU16(data, wait), verifyCode = readU16(data, verify);
  if ((idCode !== 0x4a33b5f8 && idCode !== 0x477020aa)
    || (waitCode !== 0xd1fc && waitCode !== 0x46c0)
    || (verifyCode !== 0x2000 && verifyCode !== 0x2001)) throw incompatible(338, "changed card routines");
  if (idCode === 0x477020aa && waitCode === 0x46c0 && verifyCode === 0x2001) return data;

  const out = data.slice();
  writeU32(out, cardId, 0x477020aa); // Return the expected card ID.
  writeU16(out, wait, 0x46c0); // Skip the hardware busy loop.
  writeU16(out, verify, 0x2001); // Return verified.
  return out;
}

function findCardCheck(data: Uint8Array, length: number, matches: (at: number) => boolean, label: string): number {
  let found: number | undefined;
  for (let at = 0; at + length <= data.length; at += 2) {
    if (!matches(at)) continue;
    if (found !== undefined) throw incompatible(338, `ambiguous ${label} routine`);
    found = at;
  }
  if (found === undefined) throw incompatible(338, `missing ${label} routine`);
  return found;
}

function setOverlayImage(table: Uint8Array, row: number, fileId: number, data: Uint8Array, files: Map<number, Uint8Array>): void {
  const flags = readU32(table, row + 28);
  writeU32(table, row + 8, data.length);
  writeU32(table, row + 28, flags & 0xfe000000);
  files.set(fileId, data);
}

function incompatible(id: number, reason: string): Error {
  return new Error(`Black 2 / White 2 AP Fix could not verify overlay ${id} (${reason}).`);
}

function unsupportedGame(): Error {
  return new Error("AP Fix requires an English Black 2 or White 2 ROM (IREO or IRDO).");
}
