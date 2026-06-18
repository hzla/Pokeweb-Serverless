# Pokemon Learnsets

Learnsets control which moves a species learns by level-up.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `learnsets` | Stores the level-up move table for each species. |
| `moves` | Provides move names and preview data. |
| `message_texts` | Provides move names. |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Level | Level when the move is learned. Range `0-100`. | `1`, `36` |
| Move | Move learned at that level. Type a move name from the move list. | `Flamethrower` |
| Type | Read-only preview from the selected move. | `Fire` |
| Category | Read-only move category preview. | `Special` |
| Power | Read-only move power preview. | `90` |
| Accuracy | Read-only move accuracy preview. | `100` |

## Controls

| Control | Meaning |
| --- | --- |
| Add Move | Adds a move entry at the end of the learnset. |
| Insert move below | Inserts a new move below an existing entry. |
| Delete move | Removes that entry. |
| Count | Shows current entries out of the maximum. The editor supports up to `25` level-up moves per species. |

## Example Learnset Rows

| Level | Move | Meaning |
| --- | --- | --- |
| `1` | `Tackle` | Learned immediately when the Pokemon is obtained or relearned. |
| `16` | `Flame Wheel` | Learned on level-up at 16. |
| `36` | `Flamethrower` | Learned later in the game. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Add a new level-up move | Expand a Pokemon, open Learnset, click Add Move, set Level and Move. |
| Insert a move in the middle | Click `+` beside the row above the desired location, then edit the new row. |
| Remove a move | Click delete on the row. |
| Build a clean progression | Keep early moves low-power and save stronger moves for later levels. |

## Caveats

The order shown is the order stored. If two moves use the same level, the game may present them in stored order. The editor does not automatically sort by level, so keep the sequence organized manually.

## Related Pages

- [Pokemon Personal](Pokemon-Personal)
- [Moves](Moves)
- [Trainers](Trainers)
