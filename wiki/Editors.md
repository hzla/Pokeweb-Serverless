# Editors

This page gives a high-level map of the Pokeweb editors. Each linked page contains field meanings, example values, and caveats.

## Loading Data

Pokeweb unlocks editors based on the ROM data groups loaded at project creation. If an editor is disabled, reload the ROM and select the missing data group shown in the navigation tooltip.

| Editor | Main required data |
| --- | --- |
| Headers | `headers`, `message_texts` |
| Overworlds | `headers`, `matrix`, `maps`, `overworlds` |
| Maps | headers plus original ROM bytes and 3D map resources |
| Pokemon | `personal`, `learnsets`, `evolutions`, `moves`, `items`; optional `egg_moves`, tutors, sprites |
| Pokemon Sprites | `personal`, `pokemon_sprites`, `pokemon_icons` |
| Animated Sprites | `personal`, `pokemon_sprites`, plus the Black 2 or White 2 PWAN runtime |
| Starters | `personal`, `pokemon_sprites`, `starter_sprites`, `scripts`, `story_texts`, starter overlay |
| Trainers | `trdata`, `trpok`, `personal`, `items`, `moves`, trainer text tables |
| Encounters | `encounters`; BW2 habitat sync also needs `habitats` |
| Moves | `moves`; animation tools also use `move_animations`, `battle_animations`, `move_spas` |
| Items | `items` |
| TMs | `moves` and ARM9 table data |
| Type Chart | BW2 overlay/type chart data |
| Marts | BW2 `marts`, `mart_counts` |
| Grottos | BW2 `grottos`, `grotto_odds` |
| Texts | `story_texts` or `message_texts` |
| Code Injection, Patches, File System | original ROM bytes must be available |

## Common Controls

| Control | What it does |
| --- | --- |
| Search Text/Search | Filters rows by matching visible row data. Many search boxes accept comma-separated terms. |
| Editable cells | Click into a field, type the new value, then press Enter or click away. |
| Autocomplete fields | Start typing a Pokemon, move, item, ability, type, class, or location name. The editor stores the matching ID. |
| Right click apply-to-all | Some Pokemon and trainer fields support right click to apply a value or flag across all records. |
| Expand icons | Open detailed fields for that row. |
| Add/Insert/Delete | Adds rows or subrecords where the data format supports resizing. |
| Export | Builds a modified ROM from the current project state. |
| Changelog | Shows tracked edits made through editor models. |

## Main Editors

| Editor | Purpose |
| --- | --- |
| [Headers](Headers) | Connect locations to maps, scripts, text, encounters, overworlds, music, weather, and behavior flags. |
| [Overworlds](Overworlds) | Edit NPCs, furniture, warps, triggers, and 2D map permission tiles for a selected header. |
| [Maps](Maps) | Inspect and edit 3D map metadata, area resources, collision/permission tiles, and map overlays. |
| [Pokemon Personal](Pokemon-Personal) | Edit species stats, typing, abilities, held item slots, egg groups, growth, EV yield, form metadata, height, and weight. |
| [Pokemon Learnsets](Pokemon-Learnsets) | Edit level-up moves and their learned levels. |
| [Pokemon Evolutions](Pokemon-Evolutions) | Edit evolution method, parameter, and target species slots. |
| [Pokemon Sprites and Animations](Pokemon-Sprites-and-Animations) | Edit Pokemon sprites, palettes, icons, rig/animation files, GIF imports, and Black 2/White 2 PWAN GIF overrides. |
| [Trainers](Trainers) | Edit trainer metadata, AI flags, held items, rewards, trainer text, and party Pokemon. |
| [Battle Facilities](Battle-Facilities) | Edit BW2 Subway/PWT/WBT set libraries, trainer choices, regulations, and area pools. |
| [Encounters](Encounters) | Edit seasonal wild encounter slots and rates. |
| [Moves](Moves) | Edit move battle data, effect references, stat effects, hit behavior, flags, and animation IDs. |
| [Move Animation Editor](Move-Animation-Editor) | Edit Gen 5 move animation scripts and referenced SPA particle archives. |
| [TMs](TMs) | Assign moves to TM/HM items and sync BW2 item icons. |
| [Move Effect Handlers](Move-Effect-Handlers) | Edit the move-to-battle-code handler table for advanced behavior hacks. |
| [Items](Items) | Edit item price, use routing, packed status/recovery/stat flags, EV gains, and friendship effects. |
| [Marts](Marts) | Edit BW2 shop inventories. |
| [Grottos](Grottos) | Edit BW2 Hidden Grotto Pokemon, item pools, levels, forms, genders, and odds. |
| [Texts](Texts) | Search and edit message/story text banks. |
| [Starters](Starters) | Replace starter species, related script references, type text, and starter sprites. |
| [Type Chart](Type-Chart) | Edit type effectiveness values. |
| [Code Injection and Patches](Code-Injection-and-Patches) | Apply built-in ROM patches, install PMC/PWAN support, and stage patch/library DLLs. |
| [File System](File-System) | Browse, export, import, replace, insert, append, and hex-edit raw ROM/NARC files. |

## Documentation Generators

| Generator | Purpose |
| --- | --- |
| [Calc Generation](Calc-Generation) | Export or sync data for a Dynamic Calc setup. |
| [Dex Generation](Dex-Generation) | Export dex override/search index files. |
| Text Docs | Export plain text summaries for Pokemon, moves, and trainers. |
| Location Data | Enrich trainer and item locations from headers, overworlds, and scripts. |
