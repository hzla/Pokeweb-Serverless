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

## Find and Replace

Find and replace is available in both Story Text and Info Text, in the bank list and inside an open bank. Choose **All banks** for the current text editor or **Current bank** to limit changes to the open bank. The separate bank-list search filter does not narrow an **All banks** replacement.

Enter literal text in **Find**, then use **Find next** (or press Enter in either text field) to select each occurrence. Searches include parts of words; commas and regular-expression punctuation are treated literally. Enter replacement text in **Replace with**, or leave it empty to delete matches.

| Matching mode | Behavior |
| --- | --- |
| Ignore case | Finds every capitalization and uses the replacement exactly as typed. |
| Match case | Finds only the exact capitalization typed in Find. |
| Capitalization aware | Finds every capitalization and adapts the replacement to uppercase, lowercase, or title case. Unusual mixed case uses the replacement as typed. |

For example, replacing `Bulbasaur` with `Charmander` in capitalization-aware mode changes `BULBASAUR` to `CHARMANDER`, `bulbasaur` to `charmander`, and `Bulbasaur` to `Charmander`. Recognized text control codes are left intact when adapting capitalization.

The panel shows the number of matches and actual replacements, plus the affected entry and bank counts. Occurrences already equal to their replacement do not count as changes. **Replace all…** asks for confirmation with the exact replacement count before applying changes. Cancel leaves the text unchanged. Changes appear in the session changelog and are saved through the editor's usual save/export flow.

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
