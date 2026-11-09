# Encounters

The Encounter editor edits wild Pokemon tables. Gen 5 stores separate seasonal tables and separate encounter methods for grass, water, and fishing.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `encounters` | Wild encounter tables. |
| `message_texts` | Pokemon names. |
| `headers` | Lets the editor show location/header names for encounter IDs when available. |
| `habitats` | BW2 Dex Habitat sync output, when loaded. |
| `town_map`, `town_map_species_habitats` | BW2 Pokédex Area map data (`a/0/8/5`, `a/1/7/6`), loaded from the ROM when needed. |

## Main Controls

| Control | Meaning |
| --- | --- |
| Search | Filters encounter rows by ID, location name, or Pokemon. |
| Grass icon | Opens grass encounter groups. |
| Water icon | Opens surf/fishing encounter groups. |
| Season icons | Switch spring, summer, fall, and winter. Right click a season icon to copy to other seasons. |
| Sync Encounters to Dex Habitats | BW2-only helper that rebuilds habitat species data from encounter tables. |
| Sync dex areas | BW2-only helper that rebuilds every Pokémon's Pokédex Area map from the encounter tables. Also on the Pokédex areas page. |

## Encounter Groups

| Group | Slot count | Slot chances |
| --- | --- | --- |
| Grass | 12 | `20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1` percent |
| Double Grass | 12 | Same as grass |
| Special Grass | 12 | Same as grass |
| Surf | 5 | `60, 30, 5, 4, 1` percent |
| Special Surf | 5 | Same as surf |
| Super Rod | 5 | Same as surf |
| Special Super Rod | 5 | Same as surf |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Encounter Rate | Chance that the game rolls an encounter for that method/season. Range `0-100`. | `20` for grass, `5` for surf |
| Pokemon | Species in the slot. | `Patrat` |
| Min | Minimum level for that slot. Range `0-100`. | `2` |
| Max | Maximum level for that slot. Range `0-100`. | `4` |
| Form | Form ID for the encounter. Range `0-100`. | `0` |
| % | Fixed slot percentage. This is shown by the editor and is not directly editable. | `20` |

## Example Slots

| Group | Slot | Pokemon | Min | Max | Chance |
| --- | --- | --- | --- | --- | --- |
| Grass | 0 | `Patrat` | `2` | `4` | `20%` |
| Grass | 10 | `Audino` | `5` | `5` | `1%` |
| Surf | 0 | `Basculin` | `15` | `25` | `60%` |
| Super Rod | 4 | `Dragonite` | `55` | `55` | `1%` |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change route Pokemon | Search the location, open Grass or Water, select the season, and edit species/levels. |
| Make all seasons match | Edit one season, then right click that season icon to copy to the others. |
| Add rare encounters | Use low-percentage slots such as grass slots 10-11 or water slot 4. |
| Update BW2 habitats | After editing encounters, click Sync Encounters to Dex Habitats and export the ROM. |
| Update the BW2 Pokédex Area map | After editing encounters, click Sync dex areas. Fine-tune single Pokémon on Encounters → Pokédex areas, then export. |

## Caveats

Slot percentages are fixed by encounter method. To make a Pokemon more common, place it in a higher-percentage slot or repeat it in multiple slots. Encounter Rate controls whether an encounter happens at all; slot percentage controls which Pokemon is chosen after an encounter starts.

BW2 habitat sync uses the native habitat order, including Moor of Icirrus at entry 46 and Icirrus City at entry 52. Both Desert Resort pools belong to Desert Resort. Sync includes only enabled encounter methods and computes seasonal flags separately for land, surfing, and fishing. If a habitat exceeds the 30-species limit or required data is missing, sync stops without changing any habitat entries. These assignments assume the standard BW2 encounter pool IDs.

For a local ROM check, run `node_modules/.bin/vite-node scripts/verify-habitat-sync.ts ROM.nds`. This checks the corrected pool assignments, NARC serialization, and repeat-sync stability without changing the ROM. Optional `--output NEW.nds` creates a separate ROM, verifies that other NitroFS payloads and ARM code are unchanged, and refuses to overwrite an existing file.

## Pokédex areas (BW2)

Encounters → Pokédex areas edits the per-Pokémon Area map shown in the Pokédex (`a/1/7/6`, one file per species). Pick a Pokémon on the left; the grid lists Town Map areas as rows and seasons as columns. Each cell has seven toggles, one per encounter method: grass (G), dark grass (DG), shaking grass (SG), surfing (S), rippling water (RW), fishing (F) and fishing in ripples (RF). With **Same all year** checked, one column edits all four seasons together.

| Control | Meaning |
| --- | --- |
| Only areas where found | Hides areas where the Pokémon has no methods in any season. |
| Add an area… | Adds an area as grass in every season. |
| From encounters | Replaces this Pokémon's areas with where it appears in the wild encounter tables. |
| Clear | Removes every area for this Pokémon. |
| Sync dex areas | Rebuilds the areas of every Pokémon from the encounter tables, overwriting manual edits. |

Area slots follow the native habitat order and the Town Map: a Town Map record moved to another zone moves its slot with it, and areas added in the Town Map editor appear after the stock 85. An area's encounters are every pool used by maps that share the area zone's place name. Sync uses only enabled encounter methods (rate above 0).

## Related Pages

- [Headers](Headers)
- [Pokemon Personal](Pokemon-Personal)
- [Documentation Generators](Documentation-Generators)
