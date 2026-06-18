# Encounters

The Encounter editor edits wild Pokemon tables. Gen 5 stores separate seasonal tables and separate encounter methods for grass, water, and fishing.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `encounters` | Wild encounter tables. |
| `message_texts` | Pokemon names. |
| `headers` | Lets the editor show location/header names for encounter IDs when available. |
| `habitats` | BW2 Dex Habitat sync output, when loaded. |

## Main Controls

| Control | Meaning |
| --- | --- |
| Search | Filters encounter rows by ID, location name, or Pokemon. |
| Grass icon | Opens grass encounter groups. |
| Water icon | Opens surf/fishing encounter groups. |
| Season icons | Switch spring, summer, fall, and winter. Right click a season icon to copy to other seasons. |
| Sync Encounters to Dex Habitats | BW2-only helper that rebuilds habitat species data from encounter tables. |

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

## Caveats

Slot percentages are fixed by encounter method. To make a Pokemon more common, place it in a higher-percentage slot or repeat it in multiple slots. Encounter Rate controls whether an encounter happens at all; slot percentage controls which Pokemon is chosen after an encounter starts.

## Related Pages

- [Headers](Headers)
- [Pokemon Personal](Pokemon-Personal)
- [Documentation Generators](Documentation-Generators)
