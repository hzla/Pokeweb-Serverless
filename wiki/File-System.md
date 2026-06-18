# File System

## Purpose

The File System editor lets you inspect, export, replace, insert, append, patch, and revert raw files inside the ROM. It also exposes files inside NARC archives, which are the packed containers used by many Gen 5 data tables.

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
| BW2 NARC reference | Helps identify common Black 2 / White 2 archive paths. | `Pokemon personal data` |
| Search | Finds files by path text, text content, or hex bytes. | `a/0/1/6`, `50 4B`, `Pikachu` |
| Export | Saves the selected file or subfile to your computer. | Export a trainer NARC subfile. |
| Import | Replaces the selected file or subfile with a file from disk. | Replace a modified `.spa` file. |
| Insert Before | Inserts a new NARC subfile before the selected subfile. | Add a new text bank entry before index 10. |
| Insert After | Inserts a new NARC subfile after the selected subfile. | Add a new archive entry after index 10. |
| Append | Adds a new subfile to the end of the selected NARC. | Add an extra map resource. |
| Apply Hex | Applies typed hex bytes to the selected offset. | `00 00 00 00` |
| Revert | Restores the selected file or subfile from the original loaded ROM data. | Undo a bad import. |
| Prev / Go / Next | Navigates through offsets or search matches in the file preview. | Jump to `0x200`. |
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

## Related Pages

- [Editors](Editors)
- [Move Animation Editor](Move-Animation-Editor)
- [Code Injection and Patches](Code-Injection-and-Patches)
