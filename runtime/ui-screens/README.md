# UI screens

The UI screens editor supports the ordinary six-button field menu in US Black 2
and White 2 revision 0. It is available only on localhost (including loopback IP
addresses). Open **More → UI screens → Main menu**. Hosted deployments hide the
entry and reject direct access to the editor.

Buttons retain their native actions and 128×40 artwork dimensions. Moving a button
moves its icon, label and touch area together. Icons and touch areas use pixel
coordinates; panels and native text windows use an 8-pixel grid. Labels use the
ROM font and the existing 64-pixel text window. Trainer Card uses the live player
name unless a literal label is selected.

PNG import accepts exact 128×40 panel images or 32×32 icon images. Icon normal and
selected/pressed frames can be edited separately. The gender selector selects the
native alternate icon resources where present. Imports match the native palette;
the preview shows the resulting colors. Panel imports must fit the existing tile
allocation. Shared icon color controls affect the six buttons, not the status bar
or Close control. The surrounding screen is not editable.
Colors shared with fixed controls are locked. Status information in the preview
is illustrative; the game continues to draw its live status bar.

Drafts persist in the project. **Apply to ROM** stages changes; ordinary ROM export
includes the applied design. Exported ROMs retain the editable source design and
its imported resource baseline. Reset restores that baseline. Reduced and special
menu layouts retain their original behavior and layout.

Layout, text, touch and navigation changes use a small PMC companion for the native
menu. The companion changes native creation parameters and selection targets; the
game retains command dispatch, saving and menu ownership. Cosmetic-only edits do
not install a companion. Apply rejects conflicting edits to owned resources or
hook sites and publishes the candidate atomically.

Build with Python, ndspy, an ARM GNU toolchain and RPMTool:

```sh
python3 runtime/ui-screens/build.py
```

`ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, `UI_SCREENS_B2_ROM` and `UI_SCREENS_W2_ROM`
override local inputs. The builder checks both retail ROMs independently and
produces the bundled DLLs and compatibility manifest. Build intermediates and
emulator output belong in ignored `build/` directories. Retail ROMs and saves are
not distributed with this feature.

Verify with a disposable test project and save:

```sh
./node_modules/.bin/vite-node runtime/ui-screens/verify.ts SOURCE.nds OUTPUT_DIRECTORY --emulator
```

The verifier checks project/export round trips and conflicts, then opens all six
native actions, completes a save in an isolated copy, and tests navigation and
repeated menu opening and closing in the bundled DS emulator.
