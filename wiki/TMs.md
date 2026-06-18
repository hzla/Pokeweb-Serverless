# TMs

The TM/HM editor changes which move each TM or HM item teaches.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `moves` | Move list and move metadata. |
| ARM9 table data | Stores TM/HM move assignment. Loaded from the ROM/project. |
| `items` | Useful for icon sync and item-name context. |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Move name | Editable move assigned to that TM/HM slot. | `Flamethrower` |
| Type | Read-only selected move type. | `Fire` |
| Item Name | TM/HM label such as `TM-35` or `HM-03`. | `TM-35` |
| Effect | Read-only selected move effect label. | `May burn` |
| Pow | Read-only selected move power. | `90` |
| Acc | Read-only selected move accuracy. | `100` |

## Controls

| Control | Meaning |
| --- | --- |
| Search Text | Filters TMs/HMs by move, type, category, effect, or label. |
| Category filters | Show physical, special, or status moves. |
| Type filters | Show moves of selected types. |
| Sync Icons | BW2 helper that updates TM item icons to match assigned move types when possible. |

## Slots

| Slot range | Meaning |
| --- | --- |
| `TM-1` to `TM-95` | Technical Machines. |
| `HM-1` to `HM-6` | Hidden Machines in Gen 5. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change TM35 to another move | Search `TM-35`, click the move field, type the new move name, and click away. |
| Keep icons matching move types | After changing BW2 TMs, click Sync Icons. |
| Update who can learn a TM | Edit Pokemon TM/HM compatibility in the Pokemon editor after changing the TM move. |

## Caveats

Changing a TM's move does not automatically update Pokemon compatibility. It also does not rewrite item text. If the visible item text still says the old move name, edit the relevant text bank in [Texts](Texts).

## Related Pages

- [Moves](Moves)
- [Pokemon Personal](Pokemon-Personal)
- [Items](Items)
- [Texts](Texts)
