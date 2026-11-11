# Item expansion (Black 2 / White 2, Black / White)

Item IDs 0–1023 and pokebw2's shared bag: one save pool of 1,023 distinct items instead of five fixed pockets
(310 / 83 / 109 / 48 / 64), with the field and battle bag lists sized to what the player owns. US Black 2 (`IREO`)
and White 2 (`IRDO`). Model: `src/pokeweb/itemExpansionModel.ts`; save formats: `src/pokeweb/itemSaveFormat.ts`.

## DLLs

| DLL | Loads with | What it does |
|---|---|---|
| `PokewebItemsCore{B2,W2}.dll` | always (ARM9) | Save layout (bag block 0x9ec→0x1080, Pal Pad block 0xd54→0x6fc, footer magic `PWI2`), boot admission of the card format, title-screen erase of both copies, the pool bag API (27 `BagSave_*` functions from pokebw2), item icon / holdable / dummy queries for IDs 639–1023, and the item-ID limit (638→1023) in item data/name/description reads and the Pokémon held-item field |
| `PokewebItemsBag{B2,W2}.dll` | overlay 142 (bag) | pokebw2's `bag_item.c` and 12 `itemmenu.c` functions: heap-sized lists, counts above 255, sort-by-name ranks (`PWIR` table) |
| `PokewebItemsBattleBag{B2,W2}.dll` | overlay 286 (battle bag) | pokebw2's `b_bag_item.c` and the battle-bag print/page functions: per-pocket lists sized to their counts |
| `PokewebItemsField{B2,W2}.dll` | overlay 36 (field) | shop icon and description for IDs above 638; wild Pokémon held items above 638 |
| `PokewebItemsBattle{B2,W2}.dll` | overlay 167 (battle) | `BattleMon_Create` keeps held items above 638 |

Battle Log's `BattleLogSaveGuard{B2,W2}.dll` is a dependency: retail Wi-Fi / Pal Pad / Unity Tower code reaches save
blocks 29–31 only through three accessors, which the guard redirects to a RAM copy that is never saved. Nothing in
the game can then write the retail 0xd54-byte trade history into the shrunk block 31. Pal Pad, Wi-Fi friend and Unity
Tower data stop being saved; Battle Log (which uses the real blocks) keeps working, with all 600 records.

## Save format

Same 512 KiB file, same copies (0x0, 0x26000), same footer position (0x25fa4), same extra saves (0x4c000+). Blocks
are 0x100-aligned and retail uses every page, so the bag's 7 extra pages come from block 31 (14 → 7 pages). Blocks
26–31 move by 0x700; PC boxes and blocks 32+ do not move. Saves are converted in Pokeweb (Code Injection > Item
Expansion), both ways, never in place. A ROM with the expansion stops with a message on a retail-format or unknown
save before anything is written. Pokeweb's own test-battle, warp and quick-launch saves are converted
automatically (`adaptSaveForProject`).

Audit of save writers (BW2): blocks 29–31 accessors (guarded); the save system's own size/init callbacks for block 31
(`PalPadFriendList_GetSize` literal → 0x6fc, which also bounds `PalPadFriendList_Init`); Mystery Gift outside data
(0x7e000), Dream Radar (0x7f000) and extra saves (0x4c000+) are outside the main region; every other block access
uses table-computed offsets. Game Sync uploads the raw save but writes nothing back into the moved blocks.

## Items 639–1023

Installing pads item data (`a/0/2/4`), the name / description / article / plural banks (64 / 63 / 481 / 482) and the
battle-pocket archive 228 to 1,024 entries. An ID above 638 exists when it has a name other than `???`; its bag
pocket and battle pockets come from its item data, its icon from the item sprite editor. Pokeweb rewrites the
`PWIC` catalog in each DLL and archive 228 before every export.

## How the DLLs are built

    POKEBW2_CONFIG=~/Repos/pokebw2/config POKEBW2_EXTRACT=~/Repos/pokebw2/extract python3 runtime/item-expansion/build.py

* `generate.py` preprocesses each vendored pokebw2 file and keeps only the functions being replaced, renamed to
  their PMC hook symbol; other retail functions become declarations. A replaced function used as a value keeps its
  retail address (`__retail` alias), since retail code stores and compares those (the bag's state pointer).
* `include/` overrides three pokebw2 headers so `ItemMenuWork`, `BagItemList` and `BBagWork` keep their retail
  size and offsets, with pokebw2's expanded fields placed in the storage of the retail arrays. `layout_check.c`
  asserts every retail offset; every retail function that reads a reinterpreted field is replaced.
* Retail calls and data are linked as absolute addresses, so each DLL names only the segment it hooks (PMC keeps a
  DLL that names ARM9 resident, and loads one whenever any overlay it names is loaded). EABI division maps to the
  retail `_s32_div_f` / `_u32_div_f`.
* Every literal edit is found in the retail binary (exactly one PC-relative load), and every `THUMB_BRANCH` target is
  checked to be at least 12 bytes (16 for `SAFESTACK`). Three short functions are handled otherwise:
  `BagSave_GetBlockSize` (its literal), `BagSave_MoveBetweenFreeSpace` (its tail-call target), `BagItemList_Exit`
  (only called from replaced code).

The vendored sources are compiled with GCC 13/14 instead of MWCC; struct layouts are checked, not assumed.

## Verification

`npx vite-node runtime/item-expansion/emulator.ts clean.nds [--save] [--retail-save]` and `emulator_battle.ts`
(White 2 only, uses the automatic test battle). On US White 2 and Black 2 (2026-11-09): converted save boots; 399-item
pool with item 700 loaded; field bag lists and scrolls it; giving it to a Pokémon and saving writes a valid expanded
save (generation +1, held item 700, 6 left); a retail save stops at the conversion message. White 2 battle: the
Pokémon keeps item 700 in battle; the battle bag opens and pages. Not yet run: shops selling items above 638, Black 2
battle, hardware.

## Black / White

The same design on US Black (`IRBO`) and White (`IRAO`), built by `build_bw1.py` from the aletheia decomp (symbols)
and clean ROMs (`ALETHEIA`, `BW1_ROM_B` / `BW1_ROM_W`, or `BW1_EXTRACT_B` / `BW1_EXTRACT_W`; see
`runtime/anim-streams/bw1.py`):

    ALETHEIA=~/Repos/Port-Pokeweb/aletheia BW1_ROM_B=clean-black.nds BW1_ROM_W=clean-white.nds \
        python3 runtime/item-expansion/build.py --game B --game W

pokebw2's sources do not fit Black / White, so the runtime is written against aletheia's (`bw1/`):

| DLL | Loads with | What it does |
|---|---|---|
| `PokewebItemsCore{B,W}.dll` | always (ARM9) | Save layout (bag block 0x9c0→0x1000, trade-history block 31 0xd54→0x6fc, footer magic `PWI2`), boot admission, title-screen erase of both copies, the pool (`bw1/pool.c`: 14 `MYITEM_SAVEDATA_*` functions; the retail array helpers are kept), item icons / data files for IDs 627–1023 (`FILE_UTIL_Get`, `FILE_UTIL_LoadItemRecord`) and the item-ID limit (626→1023) in Pokémon held items and item data / text reads |
| `PokewebItemsBag{B,W}.dll` | overlay 70 (bag) | Move mode's pocket copy in a 1,023-slot heap buffer instead of `ItemMenuWork.items[310]`; pocket sort with buffers sized to the pocket |
| `PokewebItemsBattleBag{B,W}.dll` | overlay 197 (battle bag) | Per-pocket heap lists instead of `BagWork.rows[4][36]`; the drawing functions read one staged row |
| `PokewebItemsField{B,W}.dll` | overlay 21 (field) | Wild Pokémon held items above 626 |
| `PokewebItemsBattle{B,W}.dll` | overlay 93 (battle) | `BTL_POKEPARAM_Create` keeps held items above 626 |

Black / White differences: retail items end at 626 (627 entries; new IDs are 627–1023); item text banks 53 / 54 / 279
/ 280; battle pockets in archive 232 (`a/2/3/2`); the bag has no Free Space, so the pool block is a version word
("PWB1") and 1,023 slots; the main save copies are 0x24000 bytes (69 blocks, used size 0x23f9c) and blocks 26–31 move
by 0x700 as on Black 2 / White 2. The bag pockets of the retail IDs are tabulated ("PWIP", written by Pokeweb from the
item data) because Black / White read them out of each item's data file. Battle Log's `BattleLogSaveGuard{B,W}.dll`
isolates blocks 29–31 the same way.

Verification (`emulator.ts` and `emulator_bw1.ts`, both games, 2026-11-10): a converted save boots with item 700 in
the bag; giving it and saving writes a valid expanded save; a retail save stops at the conversion message; with 396
extra items (a 581-item pool, ~470 in the Items pocket) the field bag scrolls, moves (SELECT) and sorts the pocket and
the pool stays valid; the battle bag's Poké Ball pocket lists 402 items over 67 pages; a held item 1022 survives
`BTL_POKEPARAM_Create`.

## Credits

pokebw2 (fuddlesworth and contributors) and hzla's White 2 item-capacity work, which this runtime compiles.
