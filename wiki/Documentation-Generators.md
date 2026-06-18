# Documentation Generators

## Purpose

The Documentation Generators page exports data from the loaded project into formats used by calculators, dex sites, and text documentation. It is a bridge between your ROM edits and player-facing reference material.

The generators use only the data currently loaded in Pokeweb. If a required editor has not been loaded, the output may be incomplete or the generator will ask you to load more data first.

## Required Data

| Generator | Required loaded data | Output |
|---|---|---|
| Calc Generation | Pokemon personal data, learnsets, evolutions, moves, items, trainer data, trainer Pokemon | A JavaScript data file for a Gen 5 damage calculator. |
| Dex Generation | Pokemon personal data, learnsets, evolutions, moves, items, encounters | Dex JavaScript data and search index files. |
| Text Docs | Pokemon personal data, learnsets, evolutions, moves, items, trainer data, trainer Pokemon | A zipped set of text documents. |
| Trainer Location Data | Headers and overworlds | Location notes for trainer documentation. |
| Item Location Data | Headers, overworlds, scripts, items | Location notes for item documentation. |

## Fields and Controls

| Control or Field | What it does | Example value |
|---|---|---|
| ROM Title | Sets the display name and output filename prefix used by generated docs. | `Volt White 2 Redux` |
| Generate Calc | Builds calculator data from loaded Pokemon, move, item, and trainer data. | `volt-white-2-redux-calc.js` |
| Open Calc | Opens the configured hosted or local calculator page. | Hosted Dynamic Calc page |
| Sync Data to Calc | Sends generated data to a local calculator bridge. | `http://localhost:3001` |
| Generate Dex | Builds dex data and search index JavaScript files. | `volt-white-2-redux.js` |
| Generate Text Docs | Creates plain-text documentation files in a zip. | Pokedex, moves, and trainer docs |
| Get Trainer Location Data | Reads maps and overworld scripts to infer where trainers appear. | Route 20 trainer locations |
| Get Item Location Data | Reads maps, overworlds, scripts, and item data to infer item pickup locations. | Hidden item and overworld item notes |
| Status messages | Explain missing data, generation progress, or completed exports. | `Missing trpok` |

## Workflows

### Generate player docs for a release

1. Load all editor data needed by your docs.
2. Set `ROM Title` to the public name of the project.
3. Run `Get Trainer Location Data` and `Get Item Location Data` if you want location notes.
4. Generate calc data, dex data, and text docs.
5. Put the generated files in your release package or documentation site.

### Send data to a local calculator

1. Start the compatible calculator bridge locally.
2. Load the required Pokeweb data.
3. Click `Sync Data to Calc`.
4. Open the calculator and verify that custom Pokemon, moves, items, and trainers appear.

## Caveats

- The generators do not load missing ROM data automatically. Load the relevant editors first.
- Names are taken from loaded text and data tables where available. If text banks are missing, names may fall back to internal or numeric labels.
- Location data is inferred from headers, overworlds, and scripts. Unusual custom scripts may need manual review.
- Generated files describe the current project state. Regenerate them after changing Pokemon, moves, trainers, items, encounters, or text.

## Related Pages

- [Calc Generation](Calc-Generation)
- [Dex Generation](Dex-Generation)
- [Texts](Texts)
- [Trainers](Trainers)
- [Encounters](Encounters)
