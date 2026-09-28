# Infinite Candy for retail BW2

Pokeweb's **Infinite Candy** control in Code Injection installs a PMC DLL and
fills unused item slot **622** in US Black 2 (`IREO`) or White 2 (`IRDO`). The
item is named Infinite Candy, uses Rare Candy's icon, lives in **Key Items**, and opens the native
party-item flow. On a valid Pokémon below level 100 it uses the Rare Candy
level-up effect. The party item-removal hook retains item 622 after use. The
ordinary Rare Candy at item 50 remains unchanged. This patch does not apply to
White2Upgrade or Black2Upgrade, which reserve or may repurpose the slot.

Installing the ROM patch does not add item 622 to an existing save. Give item
622 through an in-game event or a save editor before trying it in the Bag. The
Key Items pocket normally holds one copy. Export the patched ROM and boot it
fresh with a normal battery save; old emulator states retain old runtime code.

## Source and credit

Item 622's 36-byte data record and the party-routing/removal approach are
adapted from **PW2Code by dararo**. This version clears the item's register
flag because it does not install PW2Code's shortcut-menu hooks. The local DLLs target both US BW2 revisions
and contain only the two hooks required for this item. The retail ARM9 item
pocket table already assigns slot 622 to Key Items, so no pocket-table hook is
needed. The Pokeweb installer stages the matching DLL and writes the item data,
name, description, and icon pair as ordinary NARC edits.

## Hooks

| Hook | Black 2 | White 2 | Purpose |
| --- | --- | --- | --- |
| Overlay 12 `OpenPokeParty + 0x94` | `0x0215B86C` | `0x0215B8AC` | Let Key Item 622 open the party item flow. |
| Overlay 165 `PokeList_SubItem` | `0x0219E648` | `0x0219E688` | Skip bag subtraction for item 622; forward all other items to `BagSave_SubItem`. |

The installer checks both original hook sites, item 622's retail or installed
data, the Key Items pocket-table and icon mappings, and overlapping relocations in other
patch DLLs. It refuses to overwrite a custom slot 622 or competing party hook.

## Build and verify

Run `python3 runtime/infinite-candy/build.py` to rebuild the two bundled DLLs.
The build uses the local ARM GNU toolchain and CTRMap RPMTool; set
`ARM_TOOLCHAIN_BIN` or `RPM_TOOL_JAR` to override their paths.

Run `python3 runtime/infinite-candy/verify.py` to execute the compiled hooks in
an ARM946 CPU model. Run
`npm run infinitecandy:verify-rom -- <black2.nds> <white2.nds>` to install,
export, and reimport both ROMs while checking the item, text, hooks, and Rare
Candy preservation. These are code and ROM checks; in-game Bag flow, level-up
moves, evolution, and level-100 behavior still need emulator or hardware
acceptance testing.
