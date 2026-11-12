/**
 * Which palette of the menu archive's type icon palette file (a/0/8/2 member 0x21) each type's icon uses: the ARM9
 * table sTypeIconPalettes (pokebw2 src/system/app_menu_common.c), 18 types then 4 contest categories.
 * Hacks that add Fairy patch entry 17 (White2Upgrade and Cascade White use palette 2), so read the ROM's own table.
 */

/** Retail Black 2 / White 2 and Black / White. Entry 17 has no Fairy icon in retail. */
export const RETAIL_TYPE_ICON_PALETTES = [0, 0, 1, 1, 0, 0, 2, 1, 0, 0, 1, 2, 0, 1, 1, 2, 0, 0];

/** The table's first 17 entries (Normal to Dark), which no known hack changes: enough to find it. */
const SIGNATURE = RETAIL_TYPE_ICON_PALETTES.slice(0, 17);

const cache = new WeakMap<Uint8Array, number[]>();

/** The type icon palettes the ROM's ARM9 uses, 18 entries; retail values if the table can't be found. */
export function typeIconPalettes(arm9: Uint8Array | undefined): number[] {
  if (!arm9) return RETAIL_TYPE_ICON_PALETTES;
  const known = cache.get(arm9);
  if (known) return known;
  let table = RETAIL_TYPE_ICON_PALETTES;
  for (let offset = 0; offset + 22 <= arm9.length; offset += 1) {
    if (SIGNATURE.every((value, index) => arm9[offset + index] === value)) {
      const fairy = arm9[offset + 17]!;
      if (fairy <= 2) table = [...SIGNATURE, fairy];
      break;
    }
  }
  cache.set(arm9, table);
  return table;
}
