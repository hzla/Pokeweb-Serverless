# Texts

The Text editors expose story text and message/info text banks. These banks contain move names, Pokemon names, items, trainer classes/names, location names, dialogue, signs, menu strings, and script text.

## Required Data

| Editor | Data |
| --- | --- |
| Story Text | `story_texts` |
| Info Text | `message_texts` |

## List View Controls

| Control | Meaning |
| --- | --- |
| Search Text | Searches text bank contents. |
| Ignore Case? | Makes search case-insensitive. |
| Text Bank row | Opens that bank. |
| Preview entries | Shows up to five matching entries per bank. |

## Detail View Controls

| Control | Meaning |
| --- | --- |
| Back button | Returns to the bank list. |
| Add Text(s) | Adds blank entries to the end of the bank. Maximum `50` at a time from the UI helper. |
| Del Last Text(s) | Deletes entries from the end of the bank, keeping at least one entry. |
| Text line | Editable text entry. Saves on blur. |

## Entry IDs

| Display | Meaning |
| --- | --- |
| `MSG 12` | Entry 12 in a single-block bank. |
| `MSG 1_12` | Block 1, entry 12 in a multi-block bank. |

## Common Known Message Banks

| BW bank | BW2 bank | Meaning |
| --- | --- | --- |
| `286` | `403` | Move names |
| `285` | `487` | Ability names |
| `284` | `90` | Pokedex/Pokemon names |
| `191` | `383` | Trainer classes |
| `190` | `382` | Trainer names |
| `89` | `109` | Location names |
| `54` | `64` | Item names |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Rename a move | Open Info Text, search the move name, edit the matching move-name bank entry. |
| Rename a Pokemon | Open Info Text, search the species name, edit the Pokedex/Pokemon name bank entry. |
| Edit dialogue | Open Story Text, search a unique phrase, open the bank, edit the line. |
| Add text for a script | Add entries at the end of the correct bank, then make script/event data refer to the new index. |

## Caveats

Game text often contains control codes, variables, line breaks, or special markers. Preserve unfamiliar markup when editing around it. Adding text entries does not automatically update scripts; scripts must reference the new entry IDs.

## Related Pages

- [Headers](Headers)
- [Trainers](Trainers)
- [Moves](Moves)
- [Items](Items)
