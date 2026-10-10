# C-Gear Button Editor acceptance record

Development build 0.3.5, 2026-10-10. Supported profiles: English US Black 2 (`IREO`) and White 2 (`IRDO`), revision 0, plus derivatives preserving the checked interfaces. This is a test delivery; the gameplay checks below remain necessary.

## 0.3.5 selector feedback, dark Save detail and active rings

- Each accepted **>>** press plays native menu sound 1356, matching PARTY/BAG/MAP. The retained native actor selects an owned pressed cell for six 30 Hz updates (200 ms), using the native pressed palette and a one-pixel-down caption. Held touches do not repeat; blocked/wrench input and saved-skin loading remain silent. Feedback clears during transitions and cleanup. No new runtime allocation is needed.
- Save uses native dark detail index 3, shared with the wrench and question mark. Its shape contains only that index and transparency; the circle supplies the theme fill. This replaces 0.3.4's overly bright symbol. Version 3 graphics metadata reproduces both older variants for safe updates and restoration.
- Active REPEL and BIKE retain the bright outer ring; the extra inner border is replaced by the ordinary patterned interior. Browser preview and runtime upload share the compiled mask.
- Bundled BW2 starter saves `test.sav`, `White2Upgrade.dsv` and `Black2Upgrade.dsv` have C-Gear obtained/enabled in both save copies. Each file changed only 16 bytes: two status fields per copy and the corresponding block/table checksums. Other bytes, including emulator footers, were compared and preserved. Original personal saves and ROM inputs are untouched.

Checks completed:

| Check | Result and scope |
|---|---|
| Focused automated suite | 94 tests passed: 31 button/compiler, 28 installer, 6 skins and 29 starter-save tests. Includes pressed artwork, dark-only Save glyph, active rings, older graphics migration and both fixture checksum copies. |
| Native CPU harnesses | Both games passed prior lifetime/input/resource cases plus selector frame/expiry, once-per-press sound, silent blocked/wrench input and silent reload. Native applications/audio are stubbed here. |
| Retail graphics | Both games: 126 losslessly packed cell images remain identical; replacement edits confined to glyphs and the native pressed palette. Eight-button worst case is 15,680 / 16,384 sprite bytes and 85 / 128 OAM entries. |
| Emulator feedback | B2/W2, wireless on/off: two skin taps with a held first tap, visible pressed/normal return, active REPEL, and corrected Save detail passed. The B2 off run used eight buttons. Screenshots were visually inspected. On runs loaded the enabled bundled fixture without overriding its C-Gear fields. Sound dispatch was checked in the CPU harness; audibility was not assessed by listening. |
| Installation/export | Clean B2/W2 and Following Pokémon 0.6.88 passed repeated installation, disable/removal where legal, companion status, export/reopen and unchanged input-ROM checks. Both published 0.3.4 test ROMs passed in-place update checks, preserving editable source and native overlays. |
| Production build | TypeScript, Vite, source privacy and diff checks passed; the existing bundle-size warning remains. |

Separately named test builds in Repos:

- `White2-CGear-Buttons-0.3.5-feedback-test.nds`
- `Black2-CGear-Buttons-0.3.5-feedback-test.nds`
- `White2-Following-0.6.88-CGear-Buttons-0.3.5-feedback-test.nds`

Focused user acceptance:

- [ ] Tap and hold **>>**: hear one menu click, see brief pressed feedback, and advance one background.
- [ ] Check the dark Save symbol against the wrench/question mark in the preferred theme.
- [ ] Enable REPEL and mount BIKE: confirm one bright outer ring without an extra inner border.
- [ ] Cold boot with a copied personal save; confirm the saved layout/skin and normal menu returns.

Earlier revision records below describe their own checks and artwork.

## 0.3.4 direct storage, launch sounds and Save fill

- PC opens directly to Deposit Pokémon, Withdraw Pokémon, Move Pokémon, Battle Box, Move items and No thanks. It plays the native storage access sound (1372). The native event owns the changed entry in its private script allocation; the shared ROM script and Porta PC shortcut remain intact. The storage loop and its application/cleanup instructions are unchanged.
- PARTY, BAG, Town Map / eligible Fly and ordinary Town Map play the native field-menu selection sound (1356), once per accepted press. Native sound IDs, script mapping, event layout and VM offsets were checked separately in both retail binaries. Unrecognized PC scripts block applying a design containing PC with a specific recovery message.
- Save uses the wrench's bright native fill index. Original palettes and normal/pressed/dim routing are retained. Versioned graphics metadata recognizes the older black Save glyph, migrates it in place and preserves authored designs.
- Focused suite: 62 tests passed, including old-artwork migration/restoration and atomic rejection of changed PC scripts in both games. Production build and source privacy checks passed; the existing bundle-size warning remains.
- Both native CPU harnesses passed. Added checks cover ten repeated PC invocations, private script lifetime across graphics teardown, unchanged ordinary-PC code, native event allocation failure stubs, launch sound IDs and held-touch suppression. These use isolated native-call stubs; they are not measurements of every retail heap allocation failure.
- Isolated emulator PC checks passed in B2 and W2 with wireless on and off. The first screen is the six-choice storage menu; cancellation returns directly to the field. Move Pokémon opens the native storage application and returns to the same C-Gear power state with six visible captions and correct palettes. Screenshots were visually inspected. Audibility was not assessed by listening.
- Clean B2/W2 and Following Pokémon 0.6.88 passed installation, repeated update, disable/removal where legal, export/reopening, companion compatibility and input-ROM preservation. Both published 0.3.3 test ROMs passed migration with the editable configuration preserved.

Separately named builds in Repos:

- `White2-CGear-Buttons-0.3.4-direct-PC-test.nds`
- `Black2-CGear-Buttons-0.3.4-direct-PC-test.nds`
- `White2-Following-0.6.88-CGear-Buttons-0.3.4-direct-PC-test.nds`

Use copied ordinary saves and cold boot the updated ROM. Original ROMs, save files and `pc.mln` were preserved. The captured state was read as a reference; gameplay checks used isolated fixture saves rather than loading that melonDS state into a different emulator.

Focused user acceptance:

- [ ] Tap PC and hear the access sound; verify the storage choices appear without preceding messages.
- [ ] Cancel, choose No thanks, and return from each storage mode in both C-Gear power states.
- [ ] Tap PARTY, BAG and MAP; compare their click sound to the vanilla menu. Check both ordinary and eligible Fly map modes.
- [ ] Confirm Save matches the wrench's brighter fill in the preferred theme, including while the screen is dimmed.
- [ ] Verify repeated transitions with the user's copied save and preferred companion patches.

## 0.3.3 ring fix and BAG default

- Removed four bright diagonal protrusions introduced by nearest-neighbor sampling of the PC/PARTY rings. Only pixels outside the 16px radius are removed; the thick native border and captions remain intact.
- New designs now contain six defaults, adding BAG at `(196, 116)` with the former PC caption color `#f87800`. BAG retains the standard custom ring. Eight-button capacity and native menu behavior are unchanged.
- Existing authored designs and stable IDs are preserved when updating. Metadata-free legacy installations still recover the exact original four-button preset.
- Focused suite: 58 tests passed, including all four corrected corners in all appearance states and six/eight-button source round trips.
- Both English games passed isolated emulator rendering checks: six visible default captions, correct palettes, and transparent corrected pixels in the actual retained upload buffers. Fixture data was used; original ROMs and saves were preserved.
- Clean B2/W2 and Following Pokémon 0.6.88 installation, export/reopening and source preservation checks passed. The published W2 0.3.2 five-button ROM migrated with exact authored design preservation. The published B2 file was unavailable for this migration check; both profiles passed current installation/export tests.
- Production build and source privacy checks passed. Native executable fingerprints match 0.3.2; the earlier CPU harness and gameplay-return evidence below applies to unchanged runtime code.

Separately named builds in Repos:

- `White2-CGear-Buttons-0.3.3-default-test.nds`
- `Black2-CGear-Buttons-0.3.3-default-test.nds`
- `White2-Following-0.6.88-CGear-Buttons-0.3.3-default-test.nds`

Cold boot these with copied ordinary saves to check the corrected circles and BAG. Earlier builds remain intact. These are development test builds; the broader gameplay acceptance checklist below remains applicable.

## 0.3.2 changes and verification

- New designs hide Radar, IR, Online and Wireless by default; an editor checkbox restores them. Existing authored designs remain unchanged on update.
- Five default actions: REPEL, PC, BIKE, MAP and PARTY. PC replaces the native IR position `(68, 60)` with its pink caption; PARTY replaces Online at `(188, 60)` with its cyan caption.
- PC and PARTY use the native bright, thick circle artwork within the existing 32px allocation. BAG and other actions retain the standard custom circle. Captions and native pattern cycling are preserved.
- The upper-right selector displays `>>`. The bottom-right power control displays a floppy disk and opens the native Save prompt, with owned request data and direct return after cancellation or completion. Both controls remain usable with wireless off; saving does not enable wireless.
- Format 7 records communication visibility and retains editable drafts/applied data. Published 0.3.1 profiles remain recognized for updates. Disabling restores the original native control graphics.

Checks completed for this revision:

| Check | Result and scope |
|---|---|
| Focused automated suite | 57 tests passed: 29 compiler/editor, 22 installer, 6 skins. Includes default visibility/colors, bright ring selection, preview poses, recovery using the original native graphics, and confined native glyph substitutions. |
| Native CPU harnesses | Both games passed prior eight-button/skin cases plus hidden native actors/touch IDs, Save touch priority and holds, blocked requests, allocation failure, request survival through teardown, native cancel/deferred return, and network-selector cleanup. Native Save calls are stubbed here. |
| Retail graphics | Both games: all 126 losslessly packed cell images identical; selector/save edits confined to glyph regions; native bright rings decoded. Eight-button worst case: 15,616 / 16,384 sprite bytes, 85 / 128 OAM entries, 256 custom palette bytes. |
| Emulator Save | Native confirmation, cancellation, completed saving and return passed in both games with wireless on/off. Wireless-off runs also verified the saved Repel preference and custom position record. Off fixtures first perform the native power-off flow; user saves are untouched. |
| Emulator menu returns | Eight-button PARTY round trips passed in both games. BAG launch/cancel passed in B2; moved-PC storage round trips passed in both games. Broader 0.3.1 routes below are historical evidence, not newly repeated full gameplay checks. |
| Installation/export | Clean B2/W2 and Following Pokémon 0.6.88 passed repeat installation, disable/removal where legal, export/reopen, companion status and source preservation. Both published 0.3.1 eight-button ROMs migrated with exact authored source preservation and unchanged native overlays/source hashes. |
| Build | Focused tests, TypeScript/Vite production build and source privacy checks passed. Existing bundle-size warning remains. |

Updated, separately named test builds in Repos:

- `White2-CGear-Buttons-0.3.2-default-test.nds`
- `Black2-CGear-Buttons-0.3.2-default-test.nds`
- `White2-Following-0.6.88-CGear-Buttons-0.3.2-default-test.nds`

These use the five-button preset and include Learnset, Summary and Porta PC companions. Cold boot with copied ordinary saves. Reopening an older authored ROM preserves its design; choosing the new preset is not automatic. Verify preferred skin/theme presentation, repeated Save cancellation/completion, native wrench rearrangement, button gates and full gameplay outcomes using the checklist below.

## 0.3.1 baseline evidence

The following records describe the previous delivered revision. They are retained to distinguish earlier coverage from 0.3.2 checks.

## Delivered functionality

- More → C-Gear Buttons, with Configure Buttons on the Quality of Life installer card.
- Zero to eight editable buttons, Add/Delete, undo/redo, whole-drag history, numeric positions, keyboard nudging and optional snapping. Duplicate and layer buttons were removed at the user's request. Add and Delete use contrasting green/red fills and light text.
- Native five-pixel lettering, colored outline, outer black border, native patterns and decoded graphics preview. Oversized labels block installation. Themes and appearance selectors are preview settings.
- Sixteen action choices, including BAG and PARTY. The default four remain REPEL, PC, BIKE and MAP. Native menus retain their normal item, party, summary and field-skill handoffs.
- Required-item and optional saved-flag visibility, stable button IDs, draft/applied separation, autosave and owned archive source recovery after export/reopening.
- Eight actor/palette resources, lossless packing of the native common sprite pair, original-resource restoration on disable, owned native application requests and scheduled retained uploads.
- Wrench rearrangement and a one-second L + R reset, ID-based saved positions, legacy layout migration, wireless-off operation and native pattern cycling.
- Coordinated 15-skin carousel, native .cgb import and preserved skin palettes. See [skin acceptance](skin-acceptance.md).

## Automated checks

| Check | Result and scope |
|---|---|
| Shared compiler and installer | 54 tests passed: 26 button, 22 installer and 6 skin tests. Limits, bounds, label widths, color conversion, history, source recovery, draft/applied separation, atomic failures, updates, disabling and archive integrity are covered. |
| Native CPU harness, both profiles | Passed: registers/stack, eight actors and palettes, touch priority, held-touch suppression, item/flag gates, Repel data, native action dispatch, request ownership, allocation failures, retained uploads, fade palette synchronization, reset timing, save-record migration and repeated resource cleanup. Native applications are stubbed here. |
| Native sprite packing | All 126 decoded common cells per game remain pixel-identical. Worst-case resources: 15,936 / 16,384 sprite bytes, 85 / 128 OAM entries and 256 custom palette bytes. |
| Installation/export | Clean B2/W2 and the Following Pokémon 0.6.88 upgrade build passed install, repeat update, export/reopen and source hash checks. Clean staged disable/removal restores the owned native sprite pair. Learnset, Summary and Porta PC companion installation/status checks pass. |
| Published older build migration | Both delivered 0.3.0 four-button skin ROMs updated to 0.3.1 with the exact editable four-button/15-skin design, one owned DLL, unchanged native overlays and unchanged source hashes. |
| Production and source privacy | TypeScript/Vite build and source privacy checks passed. The existing large-bundle warning remains. |

## Browser verification

The editor was exercised with eight buttons, including BAG and PARTY. Adding stops at eight. Shift-arrow nudging, Undo/Redo, excessive label diagnostics, blocked compilation and successful installation were checked. The simplified Add/Delete controls were visually verified after the requested styling change. Native preview graphics come from decoded compiled resources; compiler tests cover each appearance and pattern.

## Emulator evidence

Tests use copied fixture data. Original ROMs and saves remain unchanged. Local screenshots, RAM traces and fixture copies are ignored build outputs.

- 48 native action launch/cancel cases passed: twelve application/event routes in both games with C-Gear wireless on and off. These exercise native menus and return paths; they do not establish every item outcome or communication service.
- 16 transition cases passed: repeated PC storage round trips, Bicycle mount/dismount, ordinary map fallback and completed Fly travel, in both games and both power states.
- Four skin cases passed: all 15 bundled skins plus original selection, held-touch suppression, PC/map return and restored button captions, in both games and both power states.
- Eight-button caption colors were checked in actual emulator output, catching and fixing native fade-buffer overwrites and a four-bank palette upload limit.
- White 2 wrench test passed: eighth-button drag, one-second L + R reset, another drag, normal in-game saving and verification of the saved stable-ID position record. The native C-Gear update is 30 Hz; reset uses 30 updates.
- Earlier four-button checks established saved Repel reload, item/flag visibility and delayed native dimming. Current native harnesses additionally cover these data paths; normal encounter gameplay still needs human acceptance.
- The reported static was confirmed by the user to be normal rain audio. No audio changes were made.

## Delivered test ROMs

Separately named eight-button builds in the workspace's parent Repos directory:

- `White2-CGear-Buttons-0.3.1-eight-test.nds`
- `Black2-CGear-Buttons-0.3.1-eight-test.nds`
- `White2-Following-0.6.88-CGear-Buttons-0.3.1-eight-test.nds`

The eight-button preset is REPEL, PC, BIKE, MAP, FIND, ROD, BAG and PARTY. Learnset, Summary and Porta PC companion integrations are included. Cold boot with copied ordinary saves; an older emulator state restores older runtime code and is unsuitable for checking an update.

## Remaining human acceptance

- Exercise each action's complete gameplay outcome: fishing encounters, Gracidea transformations, DNA Splicers fuse/separate, Reveal Glass, Recorder/Pal Pad/Xtransceiver communication behavior, and Medal Box progression.
- Confirm Repel spray sound, native level filtering, ordinary Repel countdown resuming after disabling unlimited Repel, empty parties and encounters that ignore native Repel.
- Check Bicycle/Fly prohibited locations, companions, party reordering, locked destinations and cancellations in ordinary saves.
- Check both genders, all themes/patterns, rearranged native controls, overlaps, downloaded original skins and repeated power changes.
- Save/reload player layouts in both games; add/delete/reorder IDs and change authored defaults without moving saved IDs. Confirm adjacent native C-Gear settings and Options bits remain intact.
- Check menus, battles, cutscenes, communication screens and special field modes. Blocked touches must not launch later.
- Verify full gameplay coexistence with Following Pokémon, Learnset, Summary enhancements, enhanced party menus and Porta PC. Installation and selected native menu round trips are checked, not every companion behavior.
- Check disable/export/reopen and unknown hook/resource conflicts in the intended hack. Choose a saved flag that hack leaves unused.
