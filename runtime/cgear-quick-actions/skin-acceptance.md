# C-Gear skin carousel

Runtime version: 0.3.5. Private archive format: 7. The carousel checks below were completed on 0.3.1; 0.3.2 adds the **>>** selector glyph, native Save control and communication-button visibility. Version 0.3.5 adds a brief native pressed appearance and menu click, once per accepted selector press. Its focused checks are recorded in the current [quick-action acceptance record](acceptance.md).

## Using the editor

1. Open **More → C-Gear Buttons**.
2. Choose **Preview skin**, use **Next skin**, or click the upper-right circle in the preview.
3. Choose a **Starting skin**. A player's saved carousel choice takes priority.
4. Import native BW2 `.cgb` files with **+ Import .cgb skins**. Imported palettes and tile data are preserved. The carousel supports up to 64 skins.
5. Select a skin to rename, reorder, or remove it. These edits support undo and redo.
6. Apply the changes and export the ROM. In game, tap the upper-right **>>** circle to cycle through the ordered skins and the original/save-file background.

All 15 bundled BW2 skins are included by default. BW1 `.cgb` tile layouts are incompatible. Invalid files and duplicate imports leave the existing design intact.

## Storage and display

- The private archive contains the editable source, a versioned catalog, and raw skin members. Reopening an exported ROM recovers the design.
- Only the original picture and one selected skin are retained in runtime memory. Uploads use the native background helpers during the display update callback.
- The selected stable skin ID is stored in the existing custom button-layout marker, covered by its CRC. The native C-Gear settings and downloaded save-picture bytes are preserved.
- Reordering skins preserves saved selections. Removing the selected skin falls back to the configured starting skin. Legacy button positions migrate without overriding that starting skin.
- Original palette capture uses the native retained palette source, so a display fade does not become the saved original palette.

## Verification

Completed:

- Six focused skin tests: all 15 original byte round trips; malformed files and incompatible tile maps; transparency and tile flips; imported palettes, order, names, defaults, undo/redo, archive recovery and tamper detection; invalid IDs/defaults; empty and 64-skin catalogs.
- Native harnesses for English B2 and W2: 15-skin cycling and original restoration, held-touch suppression, blocked and wrench input, retained RAM sources, display-update uploads, saved selection, original palette capture, legacy layout migration, corrupt-read recovery and cleanup.
- Four emulator runs: English B2/W2, wireless on/off, all 15 skins plus original, a held first press, and a selected skin retained across PC and MAP round trips. Runs lasted 5,300 frames with wireless on and 5,600 with wireless off.
- Browser visual preview checked against native C-Gear layers. Skin compositing uses DS five-bit color arithmetic. Preview cache size is bounded and includes the graphics fingerprint.
- Focused compiler/installer suite and Pokeweb production build passed.

Version 0.3.1 corrects the wrench reset hold to one second at the field subscreen's 30 Hz update rate. Delivered 0.3.0 runtime profiles remain recognized for in-place updates.

Both delivered 0.3.0 four-button ROMs passed the 0.3.1 update check: exact editable design preservation, all 15 skins, no duplicate runtime, repeated installation, unchanged native overlays, export/reload and unchanged source-ROM hashes. Separate test builds are `White2-CGearSkins-v0.3.1-test.nds` and `Black2-CGearSkins-v0.3.1-test.nds`; the earlier builds remain intact.

Remaining manual checks:

- Browser file-picker import: automated upload was blocked by the local Chrome extension's file-access setting. Import validation and archive round trips were tested directly.
- Repeat the original-picture round trip with a save containing a downloaded retail skin. The native harness covers nonempty original resources; the emulator fixture used the ordinary original background.
- Confirm presentation and touch placement with the user's preferred C-Gear theme and save.

The shared quick-action package remains a development release; broader gameplay and companion-patch acceptance belongs to its main checklist.
