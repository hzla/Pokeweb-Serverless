# File System

## Purpose

The File System editor lets you inspect, export, replace, insert, append, patch, and revert raw files inside the ROM. It also exposes files inside NARC archives, which are the packed containers used by many Gen 5 data tables, and the decompressed code of every ARM9 overlay.

This editor is powerful because it works below the normal field editors. It is useful for advanced imports, binary patches, replacing graphics or archives, and checking exactly what changed.

## Required Data

| Data | Why it is needed |
|---|---|
| Original ROM bytes | Required to browse and modify the ROM file tree. |
| Loaded NARCs | Optional, but useful. Replacing a file that is also loaded in another editor can update that editor's stored data. |

If you open a project that was saved without the original ROM bytes, reload the ROM before using this editor.

## Fields and Controls

| Control or Field | What it does | Example value |
|---|---|---|
| File tree | Shows ROM files and NARC subfiles. | `a/0/1/6`, then subfile `42` |
| `_overlays` folder | Lists every ARM9 overlay as decompressed code. | `overlay_0035.bin` |
| BW2 NARC reference | Helps identify common Black 2 / White 2 archive paths. | `Pokemon personal data` |
| Search | Finds files by path text, text content, or hex bytes. | `a/0/1/6`, `50 4B`, `Pikachu` |
| Export | Saves the selected file or subfile to your computer. | Export a trainer NARC subfile. |
| Import | Replaces the selected file or subfile with a file from disk. | Replace a modified `.spa` file. |
| Insert Before | Inserts a new NARC subfile before the selected subfile. | Add a new text bank entry before index 10. |
| Insert After | Inserts a new NARC subfile after the selected subfile. | Add a new archive entry after index 10. |
| Append | Adds a new subfile to the end of the selected NARC. | Add an extra map resource. |
| Apply Hex | Applies typed hex bytes to the selected offset. | `00 00 00 00` |
| Revert | Restores the selected file or subfile from the original loaded ROM data. | Undo a bad import. |
| Prev / Go / Next | Navigates through offsets or search matches in the file preview. For an overlay, Go also accepts a RAM address inside it. | Jump to `0x200`, or `0x0217CA1C` in overlay 35. |
| Restore Original | Overlays only: puts back the loaded ROM's original overlay code and unstages it. | Undo all edits to overlay 35. |
| Hex preview | Shows bytes in rows of 16 bytes. | `00000200: 34 12 00 00 ...` |
| Text preview | Shows printable text beside the hex bytes when possible. | Useful for script or text-like binary data. |

## Node Types

| Node type | Meaning |
|---|---|
| ROM file | A normal file in the ROM file system. |
| NARC | A Gen 5 archive containing numbered subfiles. |
| NARC subfile | One indexed entry inside a NARC. Many editors work with these subfiles. |
| Added file | A file or subfile inserted by the user after the ROM was loaded. |
| Modified file | A file or subfile whose current bytes differ from the original ROM. |
| Overlay | Decompressed ARM9 overlay code, shown at its RAM addresses. Edits are staged with the other overlay edits (Patches, starters and so on). |

## Workflows

### Export a raw file

1. Open the File System editor.
2. Search for the path or browse the tree.
3. Select the ROM file or NARC subfile.
4. Click `Export`.

### Replace a NARC subfile

1. Select the subfile you want to replace.
2. Click `Import`.
3. Choose the replacement file.
4. Confirm that the preview and dirty status update.
5. Export the ROM and test the affected feature.

### Edit overlay code

Overlays are stored compressed in the ROM, so their code cannot be edited through the raw `_unnamed/file_N.bin` entries. Use the `_overlays` folder instead.

1. Open `_overlays` and select the overlay, for example `overlay_0035.bin`.
2. Type a RAM address such as `0x0217CA1C` into `Go to` and click `Go`.
3. Type the replacement bytes and click `Apply Hex`.
4. Export the ROM. Pokeweb writes the overlay back and updates its overlay table entry: recompressed, or decompressed if the overlay is marked signed.

`Import` accepts either a decompressed image or a compressed one; the decompressed size must not change. `Restore Original` undoes every change to that overlay, including ones made by Patches or Code Injection installers.

Example: on US White 2, `01 20` → `FA E7` at `0x0217CA1C` (Black 2: `0x0217C9DC`) in overlay 35 skips the Aspertia flyover cutscene that plays after the new-game intro.

### Apply a small hex edit

1. Select the file.
2. Navigate to the target offset.
3. Type the replacement bytes in the hex editor.
4. Click `Apply Hex`.
5. Use `Revert` if the result is wrong.

## Caveats

- Inserting a NARC subfile shifts the indexes of later subfiles. Many game tables refer to subfiles by exact index, so inserting in the middle can break references unless you update every dependent table.
- Replacing a whole NARC with invalid data can make other editors fail to load that archive.
- The File System editor does not explain every binary format. For known data, prefer the normal editor first, then use this editor for advanced cases.
- Search can find byte patterns, but it cannot know whether a match is safe to edit.
- Revert uses the original ROM data loaded into the project. If the original data is unavailable, reload the ROM.
- Overlays cannot change size here. The PMC code-injection overlay is read-only; manage it from Code Injection.
- Some editors keep a table inside an overlay (Hidden Grotto odds, Move Tutor, move effect handlers, Type Chart). Export writes those tables from their editors, over hex edits to the same bytes.
- Once an overlay has staged edits, export rebuilds its stored file from `_overlays` and ignores raw edits to the matching `_unnamed/file_N.bin`.

## Related Pages

- [Editors](Editors)
- [Move Animation Editor](Move-Animation-Editor)
- [Code Injection and Patches](Code-Injection-and-Patches)
