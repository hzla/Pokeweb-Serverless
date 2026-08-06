# Pokeweb Serverless

Pokeweb Serverless is a browser-based Gen 5 ROM editor for Pokemon Black, White, Black 2, and White 2. 

## Editor Coverage

### ROM and Project Tools

- ROM loading with selectable NARC groups, browser persistence, dirty-state tracking, and ROM export.
- File System editor for browsing loaded ROM/NARC files, exporting/importing raw files, inserting or appending NARC files, and editing bytes in a hex-style view.
- Debug NARCs view for checking decoded files and loaded project state.
- Code Injection editor for Gen V PMC installation plus patch/library DLL module import, including the trainer battle logger on US Black, White, Black 2, and White 2 and the dependency-aware BW2 Menu Evolution companion.

### Maps, Headers, and Overworlds

- Header editor for map header fields such as map type, texture/matrix/script/text references, music, encounter id, parent map, location name, weather, camera, fly coordinates, and packed header flags.
- Overworld editor launched from headers, with map-backed NPC placement, adding/deleting NPCs, coordinate edits, sprite/object metadata, movement, sight range, flags, and zoom controls.
- 3D map viewer/editor for map metadata, season selection, building/NPC/entity overlays, collision and permission overlays, permission painting, and selected-tile flag application.

### Pokemon Data

- Pokemon personal data editor for base stats, typing, abilities, held items, catch rate, growth, gender, hatch cycles, base happiness, EV yields, form data, color, height, weight, and related numeric fields.
- Level-up learnset editing with insert/add/delete controls.
- Evolution editing for method, parameter, and target slots, including unsigned KO Count, Battle Count, and Battles Used Count thresholds at method IDs 29–31.
- TM/HM compatibility editing and BW2 tutor compatibility editing.
- Egg move editing when the egg move NARC is loaded.
- Pokemon sprite editor for front/back sprites, rigs, icons, normal/shiny palettes, female variants, raw sprite files, custom sprite bundles, PNG import/export, palette import/export, and icon palette assignment.
- Sprite rig and animation tools for rig cells, NANR/NMAR/NMCR/NCER/NCEC data, animation preview/playback, GIF flipbook import, paired front/back GIF import, manual frame sampling, and timeline loop settings.

### Trainers and Battle Facilities

- Trainer editor for trainer metadata, class/name text, battle type, party size, held items, AI flags, healing, money, reward item, team Pokemon, moves, IVs/nature display, and trainer dialogue rows where supported.
- Trainer cloning that copies the selected trainer, party, name slot, and dialogue table rows.
- Battle Facility editor for BW2 Subway/PWT-style set libraries and trainer choices, including set Pokemon, moves, items, EV stat chips, trainer type choices, and jumps between choices and set records.

### Encounters and Locations

- Wild encounter editor for seasonal grass, double grass, special grass, surf, special surf, Super Rod, and special Super Rod tables, including encounter rates, species, and min/max levels.
- BW2 habitat sync from encounter data.
- Mart editor for BW2 shop item lists.
- Hidden Grotto editor for BW2 Pokemon slots, rarity groups, levels, genders, forms, normal/hidden item pools, and BW2 grotto odds.

### Moves, Items, TMs, and Types

- Move editor for type, category, power, accuracy, PP, priority, hit count, result/effect fields, status/stat effects, crit/flinch/recoil/healing behavior, target, flags, and properties.
- Move animation and particle tools from the move rows, including macro-style script editing, preview-oriented command metadata, SPA archive loading, particle/resource editing, texture viewing, and SPA export/update support.
- Item editor for price, battle flags, gain values, berry/held/use flags, Natural Gift data, item grouping, consumability, status removal, EV/stat/HP/PP gains, happiness fields, and packed item flag parts.
- TM/HM editor for move assignment, search/filter by move type and category, and BW2 icon sync.
- BW2 type chart editor for type-effectiveness values, including Fairy-aware projects when loaded with that option.

### Text and Documentation

- Story Text and Info Text editors for searching text banks, opening banks, editing entries, and adding/deleting entries at the end of a bank.
- Doc Generators for Showdown calc publishing data, dex output, text docs, trainer location data, and item location data.
- Changelog generation support in the model layer for summarizing edits between ROM/project states.

## Quick Start

```sh
npm install
npm run dev
```

Then open the local Vite URL, load a `.nds`, choose the NARC groups you want available, make edits, and use `Export` to build the modified ROM.

### Codex UI testing

For automated local UI checks, start the loopback-only Codex dev mode:

```sh
npm run dev:codex
```

Open `http://127.0.0.1:5173/`. This mode reads `../cleanwhite2.nds` through the local Vite bridge and loads a fresh project automatically on every page refresh. The normal dev server and production build never auto-load a ROM.

Editor routes can be opened directly with hashes, for example:

```text
http://127.0.0.1:5173/#pokemon
http://127.0.0.1:5173/#moves
http://127.0.0.1:5173/#moveAnimation/621
```

To use a different local ROM without changing tracked files:

```sh
POKEWEB_DEV_ROM=/absolute/path/to/rom.nds npm run dev:codex
```

Other useful commands:

```sh
npm run build
npm test
```

### Black 2 Upgrade

The Code Injection page can install Black 2 Upgrade only on the exact clean US
Black 2 `IREO` base. Fresh installation verifies the base ROM, compatibility
signatures, runtime metadata, expansion package, and artifact checksums before
committing one project transaction. MoonBlack2, other regions, modified hook
windows, unmarked partial expansions, and conflicting modules are rejected.

For a marked compatible ROM, the update path replaces only PMC and the four
Black 2 Upgrade runtimes; edited NARCs, trainers, encounters, and PWAN data are
preserved. The expanded layout is also recognized by the Pokemon/form,
learnset, evolution, move-animation, local-sync, and test-battle workflows.

Maintainer commands:

```sh
npm run black2upgrade:sync
npm run black2upgrade:check
npm run black2upgrade:rom
npm run black2upgrade:verify-rom
```

## Notes

- Black / White and Black 2 / White 2 are detected from ARM9 data during ROM load.
- Marts, Hidden Grottoes, Battle Facilities, and Type Chart editing are currently BW2-focused. Code Injection supports Gen V; individual bundled DLLs still declare their compatible versions.
- File System, Code Injection, and 3D Map tools need access to the original loaded ROM bytes, so reopening an older browser-saved project may require loading the ROM again before those tools are enabled.
- The app edits local browser/project state until you export. Keep clean backups of your base ROMs and test exported builds in an emulator before treating a patch as release-ready.

## Credits

Reference projects used while building:

- ndspy: https://github.com/RoadrunnerWMC/ndspy
- ndstool: https://github.com/blocksds/ndstool
- Tinke: https://github.com/pleonex/tinke
- NitroPaint: https://github.com/Garhoogin/NitroPaint
- apicula: https://github.com/scurest/apicula
- nitroefx: https://github.com/Fexty12573/nitroefx
- CTRMap-CE: https://github.com/ds-pokemon-hacking/CTRMap-CE
- CTRMapV: https://github.com/ds-pokemon-hacking/CTRMapV
- Frost's Gen 5 Editor: https://github.com/FrostFalcon/FrostsGen5Editor
- dex-editor: https://github.com/RavenDS/dex-editor
- Aseprite: https://github.com/aseprite/aseprite

Pokeweb is released under the MIT License: https://opensource.org/licenses/MIT
