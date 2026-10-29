# C-Gear Buttons and Quick Actions

Open **More → C-Gear Buttons** or **Code Injection → Graphical/UI Enhancements →
C-Gear Quick Actions**. Supports checked US revision-0 Black/White and Black
2/White 2; the recognized White 2 Redux layout uses its own adapter. PMC and
required shared music support are installed automatically.

Design up to eight buttons with labels, colors, positions and read-only save-flag
visibility. Apply the design and export. The runtime is available after C-Gear
is obtained, including with wireless off. The wrench rearranges buttons. BW2's
outer rim cycles skins every 12 degrees; BW1 uses its upper-right selector and
native backgrounds. Native power/save controls retain their game-specific flow.

The catalog includes Repel, PC, Bicycle, map/Fly, Party, Bag and supported native
key-item applications. Item ownership, location/progression restrictions and
confirmation rules remain native. HM02-gated Fly uses the first non-Egg without
teaching Fly or consuming the HM. BW2-only actions include Pokenav and C-Gear
Shops; the editor filters actions for the loaded game. Designs and settings
survive project save/reopen and ROM export/reload. Configuration and runtime
installation are committed together; unknown hooks/resources are rejected.

For BW2 shops, use **Items → C-Gear Shops**, apply stock, then add a SHOP button.
Each shop uses Poké Dollars or one stackable bag-item currency (not Key Items or
TMs/HMs). Limits: 16 shops, 45 unique rows each, 24-character names, costs 1–999
items or 1–9,999,999 Poké Dollars. Native item IDs 1–638 are supported. Stock may
include TMs; custom prices do not alter ordinary item data. Draft stock is not
active until applied. Canonical formats are in `src/cgearButtons/document.ts`
and `src/systemShops/document.ts`.

Build/check with `npm run cgear:build`, `npm run cgear:verify` and
`npm run cgear:verify-rom -- /path/input.nds`; use `cgear:build-bw1` and
`cgear:verify-bw1` for BW1. Redux uses `build_redux.py`. The local
[button authoring guide](../../docs/cgear-buttons/index.html) covers native
graphics/input integration. Other revisions, expanded item tables and arbitrary
native application edits need separate bindings and gameplay checks.
