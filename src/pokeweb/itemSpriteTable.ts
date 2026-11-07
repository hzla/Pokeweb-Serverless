import { readU32 } from "../nds/binary";

const TABLE_POINTER: Record<string, number> = { B: 0x2020ef4, W: 0x2020f10, B2: 0x2026700, W2: 0x202672c };
/** Both verified code references must agree before trusting a relocated table. */
export function itemSpriteTableFromPointers(arm9: Uint8Array, version: string, base = 0x02000000): number | undefined {
  const site = (TABLE_POINTER[version] ?? 0) - base;
  if (site < 0 || site + 0x8c > arm9.length) return undefined;
  const address = readU32(arm9, site);
  if (address !== readU32(arm9, site + 0x88)) return undefined;
  const at = address - base;
  return at >= 0 && at + 639 * 4 <= arm9.length ? at : undefined;
}
