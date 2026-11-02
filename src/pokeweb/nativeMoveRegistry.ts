import { readU32, writeU32 } from "../nds/binary";
import type { ProjectState } from "./projectStore";
import type { BattleRuntimeSignature } from "./battleRuntimeBindings";

export const MAX_NATIVE_MOVE_HANDLERS = 4096;
export type NativeMoveRegistry = { offset: number; count: number; byteLength: number };

/** Capacity is a checked data literal, not part of the dispatcher's instruction contract. */
export function moveRegistryDispatcherSignature(signature: BattleRuntimeSignature): BattleRuntimeSignature {
  const mask = (value: string) => value.slice(0, 112 * 2) + "00000000" + value.slice(116 * 2);
  return { ...signature, mask: mask(signature.mask), variants: signature.variants?.map(v => ({ ...v, mask: mask(v.mask) })) };
}

/** The checked native dispatcher owns the table pointer and capacity. */
export function readNativeMoveRegistry(overlay: Uint8Array, base: number, dispatcher: Uint8Array): NativeMoveRegistry {
  const first = readU32(dispatcher, 108), count = readU32(dispatcher, 112), second = readU32(dispatcher, 116);
  const offset = first - base, byteLength = count * 8;
  if (second !== first + 4 || first % 4 || !count || count > MAX_NATIVE_MOVE_HANDLERS
    || offset < 0 || offset + byteLength > overlay.length) throw Error("Unrecognized native move registry.");
  return { offset, count, byteLength };
}

export function moveHandlerSourcePath(overlayId: number, offset: number): string {
  return `overlay${overlayId}:move_effects_table@${offset}`;
}

/** Include decoded, not-yet-materialized edits without mutating the live overlay. */
export function moveHandlerOverlay(project: ProjectState, overlay: Uint8Array, layout: NativeMoveRegistry): Uint8Array {
  const store = project.narcs.move_effects_table;
  if (!store?.dirty.has(0)) return overlay;
  const savedOffset = /@([0-9]+)$/u.exec(store.sourcePath);
  const legacyOffset = project.session.baseRom === "BW" ? 0x3cf30 : project.session.fairy ? 0x40974 : 0x407f4;
  if ((savedOffset ? Number(savedOffset[1]) : legacyOffset) !== layout.offset || store.rawFiles[0]?.length !== layout.byteLength)
    throw Error("Saved handler edits use a different table layout. Reload the source ROM before editing handlers.");
  const out = overlay.slice(), bytes = store.rawFiles[0].slice(), raw = store.records.get(0)?.raw;
  if (raw) for (let n = 0; n < layout.count; n++) {
    writeU32(bytes, n * 8, raw[`move_id_${n}`] ?? readU32(bytes, n * 8));
    writeU32(bytes, n * 8 + 4, raw[`address_${n}`] ?? readU32(bytes, n * 8 + 4));
  }
  out.set(bytes, layout.offset);
  return out;
}

/** Assignment edits are data; only callbacks explicitly reused by recipes need code contracts. */
export function nativeMoveAssignments(overlay: Uint8Array, base: number, layout: NativeMoveRegistry, moveCount: number,
  arm9Base: number, arm9Length: number): Map<number, number> {
  const entries = new Map<number, number>();
  for (let n = 0; n < layout.count; n++) {
    const at = layout.offset + n * 8, id = readU32(overlay, at), pointer = readU32(overlay, at + 4), address = pointer & ~1;
    if (!id && !pointer) continue;
    if (!id || id >= moveCount || id > 65535) throw Error(`Invalid native move ID in handler row ${n}.`);
    if (entries.has(id)) throw Error(`Duplicate native handler assignment for move ${id}.`);
    if (!pointer) throw Error(`Handler row ${n} has no callback. Clear its move ID to disable it.`);
    if (pointer && !(address >= base && address + 8 <= base + overlay.length)
      && !(address >= arm9Base && address + 8 <= arm9Base + arm9Length)) throw Error(`Handler row ${n} points outside loaded battle code.`);
    entries.set(id, pointer);
  }
  return entries;
}
