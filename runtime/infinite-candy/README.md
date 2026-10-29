# Infinite Candy

Installs a checked US Black 2/White 2 PMC module and an unused Key Item with the
native Rare Candy effect. Default item ID is 622; BW2 may select an unused slot
1–638. Reinstall preserves the chosen ID. Occupied records/names are rejected.
The selected item is retained after use; ordinary Rare Candy remains unchanged.
BW1 uses its separate fixed-item-622 build.

The patch does not grant the item to an existing save. Give it through an event
or save editor. Redux may require unused slot 113 because 622 is occupied.
Hard Level Caps and Party Toolbar currently require 622 and cannot be combined
with a different selected ID. Upgrade ROMs repurposing the slot are unsupported.

The item data and party-routing/removal approach are adapted from **PW2Code by
dararo**. Installation edits item data/name/description/icon mappings and stages
the native hooks without changing shared icon files or save format.

Build/check with `python3 runtime/infinite-candy/build.py`,
`python3 runtime/infinite-candy/verify.py` and
`npm run infinitecandy:verify-rom -- /path/black2.nds /path/white2.nds`.
Cold boot the export; old emulator states restore old runtime code.
