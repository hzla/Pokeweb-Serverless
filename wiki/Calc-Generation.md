# Calc Generation

## Purpose

Calc Generation creates custom data for a Gen 5 damage calculator. This lets players and testers calculate damage using your edited Pokemon, moves, items, abilities, type chart, and trainer teams instead of vanilla game data.

## Required Data

| Data | Why it is needed |
|---|---|
| Pokemon personal data | Base stats, types, abilities, held item data, and species metadata. |
| Learnsets | Move availability for Pokemon reference data. |
| Evolutions | Evolution information used by generated species data. |
| Moves | Power, type, category, accuracy, priority, targets, and flags. |
| Items | Item names and battle item references. |
| Trainer data | Trainer class, AI, battle type, and party settings. |
| Trainer Pokemon | Trainer party members, levels, moves, abilities, items, and natures when supported. |

## Fields and Controls

| Control or Field | What it does | Example value |
|---|---|---|
| ROM Title | Sets the calculator data title and filename prefix. | `Blaze Black 2 Custom` |
| Generate Calc | Downloads a JavaScript file containing the generated calculator data. | `blaze-black-2-custom-calc.js` |
| Open Calc | Opens the configured calculator page. | Hosted Dynamic Calc |
| Sync Data to Calc | Sends the generated data to a local calculator bridge. | `http://localhost:3001` |
| Status | Shows missing data, generation success, or bridge connection errors. | `Calc data generated` |

## Generated Data

| Data group | What is included |
|---|---|
| Calculator config | Gen 5 settings such as damage generation, critical hit behavior, switch-in rules, and vanilla mechanics baseline. |
| Pokemon | Custom species data, including stats, typing, abilities, weight, and relevant metadata. |
| Moves | Custom move power, type, category, accuracy, priority, targets, and battle flags. |
| Items | Battle-relevant item data and item names. |
| Trainers | Formatted trainer sets with Pokemon, levels, items, abilities, moves, and natures when available. |
| Type chart | Custom type matchups when the loaded chart differs from the default Gen 5 chart. |

## Workflows

### Generate a standalone calc file

1. Load all required data.
2. Set `ROM Title`.
3. Click `Generate Calc`.
4. Place the generated `.js` file where your calculator expects custom data.

### Live-sync to a local calculator

1. Run the compatible calculator bridge at `http://localhost:3001`.
2. Click `Sync Data to Calc`.
3. Open the calculator.
4. Check a known edited Pokemon, move, and trainer to confirm the sync worked.

## Caveats

- The calc output is based on currently loaded data, not every file in the ROM.
- Some names are normalized for calculator compatibility. For example, punctuation or spacing may be adjusted to match common Pokemon Showdown-style identifiers.
- Trainer sets are only as complete as the loaded trainer party data. If trainer Pokemon data is missing, trainer exports cannot be complete.
- The hosted calculator can be opened from Pokeweb, but live syncing requires a compatible local bridge.

## Related Pages

- [Documentation Generators](Documentation-Generators)
- [Pokemon Personal](Pokemon-Personal)
- [Moves](Moves)
- [Items](Items)
- [Trainers](Trainers)
