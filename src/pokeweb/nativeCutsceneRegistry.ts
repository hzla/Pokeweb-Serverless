import { readU32 } from "../nds/binary";

export const CUTSCENE_OVERLAY_BASE = 0x021a1ba0;
export const CUTSCENE_ORIGINAL_SIZE = 39168;
export const CUTSCENE_ORIGINAL_TABLE = 0x021a6ecc;
export const CUTSCENE_REGISTRY_HEADER_SIZE = 32;
export const CUTSCENE_MAX_OVERLAY_SIZE = 65536;
export const CUTSCENE_ID_CHECK = 0x021a2a0c - CUTSCENE_OVERLAY_BASE;
export const CUTSCENE_TABLE_READERS = [
  { address: 0x021a2a28, field: 0 },
  { address: 0x021a2c10, field: 4 },
  { address: 0x021a2c24, field: 8 },
  { address: 0x021a2b60, field: 12 },
  { address: 0x021a2a5c, field: 16 },
] as const;
const hex = (text: string) => new Uint8Array(text.match(/../g)!.map(n => parseInt(n, 16)));
const NORMALIZER = hex("002801d01b2800d300207047");
const READERS = [
  [0x021a2a18, "08b5fff7f7ff142141430148405808bd"],
  [0x021a2a48, "08b5fff7dfff14214143024840580006000e08bd"],
  [0x021a2c00, "08b5fff703ff142141430148405808bd"],
  [0x021a2c14, "08b5fff7f9fe142141430148405808bd"],
  [0x021a2b50, "81815068411e0198818102b0f8bdc046"],
] as const;
export type NativeCutsceneLayout = { kind: "original" | "expanded"; count: number; tableOffset: number };

/** Recognize only the audited stock readers or our versioned custom registrations. */
export function readNativeCutsceneLayout(bytes: Uint8Array): NativeCutsceneLayout {
  const fail = (): never => { throw new Error("Unsupported native cutscene registry or modified sequence lookup. US White 2 revision 0 is required."); };
  if (bytes.length < CUTSCENE_ORIGINAL_SIZE || bytes.length > CUTSCENE_MAX_OVERLAY_SIZE) fail();
  for (const [address, code] of READERS) if (!hex(code).every((n, i) => bytes[address - CUTSCENE_OVERLAY_BASE + i] === n)) fail();
  const expanded = bytes.length > CUTSCENE_ORIGINAL_SIZE;
  if (expanded && bytes.length < CUTSCENE_ORIGINAL_SIZE + CUTSCENE_REGISTRY_HEADER_SIZE) fail();
  const count = expanded ? readU32(bytes, CUTSCENE_ORIGINAL_SIZE + 16) : 27;
  if (count < 27 || count > 64 || (expanded && count < 28)) fail();
  if (!NORMALIZER.every((n, i) => bytes[CUTSCENE_ID_CHECK + i] === (i === 4 ? count : n))) fail();
  const tableOffset = expanded ? readU32(bytes, CUTSCENE_ORIGINAL_SIZE + 12) : CUTSCENE_ORIGINAL_TABLE - CUTSCENE_OVERLAY_BASE;
  for (const { address, field } of CUTSCENE_TABLE_READERS) if (readU32(bytes, address - CUTSCENE_OVERLAY_BASE) !== CUTSCENE_OVERLAY_BASE + tableOffset + field) fail();
  if (expanded) {
    const p = CUTSCENE_ORIGINAL_SIZE, version = readU32(bytes, p + 4);
    if (tableOffset % 4 || (version === 1 && (count !== 28 || tableOffset !== p + CUTSCENE_REGISTRY_HEADER_SIZE))) fail();
    if (String.fromCharCode(...bytes.subarray(p, p + 4)) !== "PWCS" || ![1, 2].includes(readU32(bytes, p + 4)) ||
      readU32(bytes, p + 8) !== bytes.length || readU32(bytes, p + 12) !== tableOffset || readU32(bytes, p + 16) !== count || readU32(bytes, p + 20) !== 5 ||
      tableOffset < p + CUTSCENE_REGISTRY_HEADER_SIZE || tableOffset + count * 20 > bytes.length) fail();
    const oldTable = CUTSCENE_ORIGINAL_TABLE - CUTSCENE_OVERLAY_BASE;
    for (let i = 0; i < 27 * 20; i++) if (bytes[oldTable + i] !== bytes[tableOffset + i]) fail();
    const params = readU32(bytes, tableOffset + 27 * 20) - CUTSCENE_OVERLAY_BASE;
    if (params < p + CUTSCENE_REGISTRY_HEADER_SIZE + 28 * 20 || params + 84 > bytes.length) fail();
    const camera = bytes[params] | bytes[params + 1] << 8;
    if (camera !== readU32(bytes, p + 24)) fail();
  }
  return { kind: expanded ? "expanded" : "original", count, tableOffset };
}
