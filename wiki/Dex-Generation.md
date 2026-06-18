# Dex Generation

## Purpose

Dex Generation creates JavaScript data for a web dex. It turns the loaded ROM data into files that a dex site can use for Pokemon pages, move pages, search, learnsets, evolutions, and encounter information.

## Required Data

| Data | Why it is needed |
|---|---|
| Pokemon personal data | Species stats, types, abilities, held items, growth rate, egg groups, gender ratio, and metadata. |
| Learnsets | Level-up, TM, tutor, egg, and special move availability where loaded. |
| Evolutions | Evolution methods, targets, levels, items, moves, maps, and other conditions. |
| Moves | Move names, type, category, power, accuracy, PP, priority, targets, flags, and effects. |
| Items | Item names and item references used by evolutions, held items, and move data. |
| Encounters | Wild Pokemon locations, levels, rates, seasons, and encounter methods. |

## Fields and Controls

| Control or Field | What it does | Example value |
|---|---|---|
| ROM Title | Sets the dex title and output filename prefix. | `Volt White 2 Redux` |
| Generate Dex | Downloads dex data and search index JavaScript files. | `volt-white-2-redux.js` and `volt-white-2-redux_searchindex.js` |
| Generate Text Docs | Creates text documentation that can accompany the dex. | Pokedex, moves, trainers |
| Get Trainer Location Data | Adds inferred trainer locations for text documentation. | `Route 4` trainer notes |
| Get Item Location Data | Adds inferred item locations for text documentation. | `Castelia Sewers` item notes |
| Status | Shows missing data or successful generation. | `Dex generated` |

## Generated Data

| Data group | What is included |
|---|---|
| Pokemon pages | Stats, types, abilities, held items, egg groups, gender ratio, growth rate, height, weight, and color/body metadata where available. |
| Learnsets | Level-up moves and other loaded learnset categories. |
| Evolutions | Evolution target and condition text derived from the evolution table. |
| Moves | Move battle data and descriptions from loaded move/text data where available. |
| Items | Item names and references used by Pokemon, moves, and evolutions. |
| Encounters | Wild encounter areas, methods, rates, species, levels, and seasonal differences. |
| Search index | Searchable names and entries for the generated dex site. |

## Workflows

### Generate dex files

1. Load the required Pokemon, move, item, evolution, learnset, and encounter data.
2. Set `ROM Title`.
3. Click `Generate Dex`.
4. Add the generated data and search index files to your dex site.

### Refresh docs after balance changes

1. Edit Pokemon, moves, items, encounters, or evolutions.
2. Return to Documentation Generators.
3. Regenerate the dex files.
4. Regenerate text docs if those files are part of your release.

## Caveats

- Dex Generation does not automatically infer missing text. Load text data when you want public-facing names and descriptions to be accurate.
- Encounter documentation depends on the encounter tables currently loaded in Pokeweb.
- Location data helpers can improve text docs, but unusual custom event scripts may still need manual cleanup.
- Regenerate both the main dex data file and search index whenever names, moves, Pokemon, or encounter data changes.

## Related Pages

- [Documentation Generators](Documentation-Generators)
- [Pokemon Personal](Pokemon-Personal)
- [Pokemon Learnsets](Pokemon-Learnsets)
- [Pokemon Evolutions](Pokemon-Evolutions)
- [Encounters](Encounters)
