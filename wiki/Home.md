# Pokeweb-Serverless Wiki

Pokeweb-Serverless is a browser-based editor for Pokemon Black, White, Black 2, and White 2 ROM projects. The editor works in local browser/project state until you export a modified ROM. Keep clean backups of your base ROMs and test exported builds in an emulator before distributing a patch.

This wiki documents what each editor exposes, what the fields mean, and how to perform common edits without needing to know the internal Gen 5 data formats first.

## Quick Start

1. Run the app locally or open the hosted build.
2. Load a `.nds` ROM.
3. Choose the data groups you want available. More loaded groups unlock more editors.
4. Edit values in the visible fields. Most table-style values save when the field loses focus.
5. Use `Export` to download the modified ROM.

## Important Concepts

| Concept | Meaning |
| --- | --- |
| NARC | A Nintendo DS archive that stores many related game data files. Pokeweb loads selected NARCs into editable project state. |
| Overlay | A code module loaded by the game. Some advanced features patch overlays or ARM9 code. |
| Header | A map-zone record that links location name, matrix, scripts, text bank, encounters, overworlds, music, and behavior flags. |
| Matrix | A layout table that says which map chunks belong to a zone. |
| Overworld | Event/entity data for NPCs, warps, triggers, and interactable objects in a zone. |
| Raw ID | A numeric reference to another game table, such as a move, item, script, map, or text bank. |

## Wiki Structure

Start with [Editors](Editors) for a map of the application. Use the specific pages when you need field-by-field help:

| Area | Pages |
| --- | --- |
| Maps and world data | [Headers](Headers), [Overworlds](Overworlds), [Maps](Maps), [Encounters](Encounters) |
| Pokemon data | [Pokemon Personal](Pokemon-Personal), [Pokemon Learnsets](Pokemon-Learnsets), [Pokemon Evolutions](Pokemon-Evolutions), [Pokemon Sprites and Animations](Pokemon-Sprites-and-Animations), [Starters](Starters) |
| Battle data | [Trainers](Trainers), [Battle Facilities](Battle-Facilities), [Moves](Moves), [TMs](TMs), [Move Effect Handlers](Move-Effect-Handlers), [Type Chart](Type-Chart) |
| Items and locations | [Items](Items), [Marts](Marts), [Grottos](Grottos), [Texts](Texts) |
| Advanced tools | [Move Animation Editor](Move-Animation-Editor), [Code Injection and Patches](Code-Injection-and-Patches), [File System](File-System) |
| Output tools | [Documentation Generators](Documentation-Generators), [Calc Generation](Calc-Generation), [Dex Generation](Dex-Generation) |

## General Editing Notes

Most name fields accept the visible name, not the internal numeric ID. For example, typing `Flamethrower` in a move field stores that move's numeric ID.

Numeric fields usually reject values outside their supported range. If a field flashes or reverts, the value did not pass validation.

Some pages show raw or partially understood fields. These are documented with practical meanings when known. When the exact game behavior is not fully known, this wiki labels the field as inferred or unknown and explains the safest way to use it.

## Version Notes

Black and White share many formats with Black 2 and White 2, but not every editor supports both generations equally.

| Feature | Support |
| --- | --- |
| Core Pokemon, moves, items, trainers, encounters, headers, overworlds, text | BW and BW2, when required data is loaded |
| Marts, Hidden Grottos, Battle Facilities, Type Chart editor | BW2-focused |
| PMC code injection | BW2 only |
| PWAN GIF animation injection | White 2 code layout only |
| Fairy Type Support patch | Black 2 and White 2 only |
| Forgettable HMs patch | Black and White only |
