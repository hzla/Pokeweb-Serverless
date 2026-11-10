# Black / White marts

The Marts page edits Black and White shop inventories. BW1 has no mart NARC:
the shop screen in overlay 21 (`scrcmd_proc_fld.c` in the aletheia decomp:
`SCRCMD_PROC_FLD_BuildItemListByBadges`, `_BuildItemListFixed`) reads item
lists compiled into the overlay. `src/pokeweb/bw1MartModel.ts` handles them.

## Data

One literal pool of the list builder holds four words: the badge-tier table
(u8 per badge count, 0-8), the list pointer table, `0x162`, and the list
counts (u8). `locateBw1MartTables` finds the pool by that shape, so it does not
depend on version addresses (Black pool `0x021B39B4`, White `0x021B39D4`).
`0xA8` bytes later a second pool holds the Battle Subway BP shops' pointer
table (entries `{u16 item, u16 0, u32 BP price}`) and counts.

| Lists | Used by |
|---|---|
| 0-5 | Standard Poké Mart cashier (script shop ID `0xFF`): the tier table picks the list by badge count |
| 6-25 | Script shop IDs 0-19 (list = ID + 6): the second cashier in each city, Driftveil Market and Shopping Mall Nine |
| BP 0, 1 | Gear Station BP shops (shop IDs `0xFE` items, `0xFD` TMs) |

Shop IDs come from the zone scripts that set `0x8000` and call the common shop
script 10110 (`CallCommonScript`, opcode `0x1C`); the shop command itself is
opcode `0x149`. IDs `0xF7`-`0xFB` are the Black City / White Forest resident
shops, built from the save, and are not editable here.

## In place and expanded

Without code injection, each list keeps its retail length as its capacity
(the lists are packed back to back) and edits go into the overlay 21 working
copy.

**Expand inventories (PMC)** moves every list into a generated data-only PMC
module, `patches/PokewebMarts{B,W}.dll`, rebuilt on every edit. Four `OFFSET`
relocations into overlay 21 replace the literal-pool words for the list table,
list counts, BP table and BP counts, so the game's own code reads the new
lists; base `OFFSET` relocations fill the module's pointer tables. Each shop
can then hold 40 items, the size of the shop screen's item array
(`ShopWork.items[40]`). No game code changes, and the overlay 21 originals stay
as they were. **Remove expansion** writes the lists back when every shop fits
its retail size again (only while the module is staged, not after it is part
of an exported ROM).

Prices of regular shops come from the item data (Items editor); BP prices are
per entry.

## Check

```sh
npx vite-node runtime/bw1-marts/emulator.ts /path/clean.nds
```

Expands inventories, gives the 0-badge list and the BP TM shop 40 entries,
boots the quick-launch save and checks, in RAM, that overlay 21's pool words
point at the module and its lists hold those entries. Passes on clean US Black
and White. Opening a shop in game with more than its retail number of items
has not been tested headlessly.
