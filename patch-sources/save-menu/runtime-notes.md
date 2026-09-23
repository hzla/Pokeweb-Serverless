# White 2 save menu

This is version 0.1.9 of a separate PMC patch for the inspected `White2Upgrade-Following-0.7.16-alpha.nds` ROM. The Following Pokémon alpha ROM and its save files are not edited by the build or installer.

The saved screen shows a dark grid, an enlarged window-style trainer card, play time with a clock icon, a looping downward walk using the ROM's male or female player sprite, six party positions, and eight badge-case images. The party row sits above the badge row and is raised two native pixels from the earlier layout. The saved card uses a tall black triangular page arrow with a white outline. Party icons appear directly on the card background without slot boxes; empty positions show static gray Poké Balls. The badge row sits inside a two-compartment case with the native badge case's charcoal background, gray rim, center divider, and gold bottom accent. Earned badges show half-size renders of the game's badge-case models; unearned badges show slots with the same silhouettes. A thin gray divider separates the trainer name from the clock and time; a short dash and a dot break each end. The right-aligned trainer name and time, and the New Game buttons, use White 2's native variable-width font with white ink and a gray shadow. The walking trainer stands on a small gray oval shadow. The card omits the Save File, Trainer, Time, and Badges labels. Occupied party positions alternate their two native icon poses every eight frames. The poses are staged in RAM and copied during VBlank so a sprite cannot appear half drawn. The lower screen reproduces the native White 2 town map at its original 256×168 size, starting at the top of the screen. It uses the game's location box, variable-width font and colors, and animated marker. The map's native bottom control bar is omitted; the remaining lower rows are black. No map pixels are cropped or stretched. The marker uses the ROM's point records for 85 mapped headers and is clipped at screen edges. Other locations show the map without a guessed marker.

With no save, the upper screen has one New Game card and the lower screen has an empty grid. With a save, A on the card continues the game. Right or Down opens the second page, which has one centered New Game button on the upper screen and an empty lower grid; B or Left returns. New Game keeps its native saved-game warning. The black strip under the map retains touch targets: its left half continues and its right half opens the New Game page. A lower-screen tap on that page selects New Game. New Game with no save also responds to a lower-screen tap.

During startup and page changes, the native menu stays dark while the custom graphics are prepared; the completed screen appears at VBlank. For a mapped saved location, Continue first gives the lower map a short, eased 4× zoom around the location marker; the top card remains visible. It then keeps the native menu covered during the loading handoff, so the old save menu does not flash between the card and gameplay. Unmapped locations continue without a zoom. Display registers are configured once, so animation updates do not shift either screen. The extra four detached source pixels in the added Tapu Bulu icon's second pose are cleared.

## Install in Pokeweb

Open the inspected ROM, choose **Code Injection → White 2 Save Menu → Install Save Menu**, then export to a new `.nds` filename. If an older save-menu module is already staged in that project, the button reads **Update Save Menu** and replaces it. The installer checks the exact ROM SHA-256, the menu hook, the existing PMC modules, and the original startup-skip module before staging the save-menu DLL. It disables the startup-skip hook so the menu can appear. The patch is independent of the Following Pokémon DLLs.

## Local build and install

With the pinned ROM in the workspace's `Repos/` directory:

```sh
python3 runtime/save-menu/build.py
python3 runtime/save-menu/install.py \
  ../../White2Upgrade-Following-0.7.16-alpha.nds \
  ../../White2Upgrade-SaveMenu-test.nds
```

The build extracts player, town-map, native font, and location assets from the pinned ROM; it bundles half-size native badge-case renders, sanitized native map-window and marker frames, and `SaveMenuW2.dll` in Pokeweb. The map, marker, and badges are packed to fit the runtime loader's memory limit. Location-name characters use single-byte storage because all generated names fit that range. The standalone installer accepts the bundled DLL by default. It refuses to overwrite an existing output and writes a neighboring `.install.json` audit record. Use a distinct save filename for emulator testing. See [VALIDATION.md](VALIDATION.md) for checks and captures, and [ZOOM-FEASIBILITY.md](ZOOM-FEASIBILITY.md) for the zoom and asset-memory outlook.
