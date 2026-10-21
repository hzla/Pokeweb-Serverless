# C-Gear Button Editor acceptance record

The separate Black/White port is recorded in the [BW1 acceptance checklist](acceptance-bw1.md).

Development build 0.5.4, 2026-10-17. Supported profiles: English US Black 2 (`IREO`) and White 2 (`IRDO`), revision 0, plus derivatives preserving the checked interfaces. The broader historical gameplay checklist below remains applicable.

## 0.5.4 HM02 Fly

- Added `mapFlyHm` (action 19), separate from the existing map/Fly action.
  HM02 item 421 in the native TM/HM pocket gates visibility; Town Map and
  a learned Fly move are not required. The native map and Fly event keep
  location/progression checks, destination eligibility, confirmation,
  animation and cancellation. The first non-Egg supplies the animation;
  empty/Egg-only parties and prohibited locations fall back to ordinary map.
  Ownership is rechecked before travel. No item, move, PP or visibility flag
  is changed. Default designs, save layouts and archive formats are unchanged.
- Both native CPU profiles pass HM ownership/no-move travel, Egg skipping,
  empty-party fallback, prohibited-location and lost-HM rejection, held input,
  retained request ownership and cleanup. Existing move-required Fly tests
  continue to pass. BW1 has its own adapter and acceptance entry.
- **109 tests in five files** and the production build pass, including
  0.5.3/BW1 0.1.2 upgrades, integrity checks and export/reopening of the new
  action/flag/ID. Both current and older released profiles remain recognized.
- DS emulator travel succeeds with a verified no-Fly party and HM02, without
  Town Map, in White 2 with wireless on and Black 2 with wireless off. Map
  confirmation, native travel animation, return, captions and C-Gear power
  state were checked; final screens were inspected. A separate White 2
  no-HM cold boot verifies that the button is absent. Only copied/in-memory
  fixture saves were used. Physical hardware acceptance is not claimed.

## Readability and beginner guide, 2026-10-17

- BW2 is split into named include sections compiled once by
  `quick_actions.cpp`. Native addresses and action/sound constants now have
  aliases, with expanded formatting, local names and ownership comments.
  BW1, the build/harness scripts and shared graphics modules are formatted too.
  Function order, exported/private symbols, native layouts and behavior remain
  intact. This is not a new native release.
- Rebuilding both generations reproduced all ten baseline assets byte for byte:
  four DLLs, two private archives, two manifests and two preview PNGs. Versions
  remain BW2 **0.5.3** and BW1 **0.1.2-bw1**. Five Python syntax trees are
  unchanged; five shared TypeScript syntax trees match after ignoring comments,
  source positions and redundant parentheses added by formatting.
- All **101 focused tests**, both B2/W2 native CPU profiles, both B/W native CPU
  profiles and the production build passed. The build retains its existing
  large-chunk advisory. No new DS emulator or hardware acceptance was performed
  for this source-only change; earlier gameplay evidence remains separately
  recorded below.
- The beginner webpage covers graphics, input ownership, native lifecycle,
  REPEL, PC, PARTY, item gating, layout persistence and build/install steps.
  Its generator verifies 15 real source panels, ten hook rows and nine decoded
  button images. Teaching pseudocode and the browser illustration are explicitly
  distinguished from executable native code and emulation.
- The three-button CLI lesson built from separately named retail B2 and W2
  inputs. Both exported ROMs reopened with enabled, applied REPEL/PC/PARTY
  designs, stable IDs/coordinates and no unapplied changes. Input ROM hashes
  remained unchanged; no save was written. These are build/installer/reopening
  checks, not gameplay acceptance of those new fixture ROMs.
- Browser checks passed at 375, 768 and 1280 pixels: no horizontal page overflow,
  working chapter navigation, search, light/dark themes, code copying and
  illustrated native-busy/request routes. The page reported no console errors.
  Source privacy and whitespace checks passed. The tutorial is a local/offline
  documentation page; it was not published to a remote site.

## 0.5.3 dial sensitivity

- Each skin swap requires 12° of rotation in either direction. The shared
  centidegree threshold is 1,200 in both the browser preview and native builds.
  Editor/installer help text uses the new angle. Clock/decal removal, moving
  marker, sound, touch ownership and saved skin IDs are preserved.
- The dial tests include a sub-threshold 11° sample and an accepted 13° sample,
  reversing, angle-zero wrapping, multiple steps and stationary jitter.
- Native harness and emulator gestures use the shorter step, including held
  touches, clockwise/counterclockwise changes and Party/PC/Map return. These
  remain DS emulator checks; physical hardware acceptance is not inferred.
- Version 0.5.2 remains recognized for updates. Archive/save formats and BW1
  binaries are unchanged. Separate 0.5.3 test ROMs use copied fixture saves.
- 44 focused tests and the production build passed. Both native profiles
  passed their 12° dial checks. DS emulator runs passed in White 2 with eight
  buttons/wireless on and Black 2 with six buttons/wireless off, including
  27° drags advancing two skins, a reverse step, wrapping and menu returns.

## 0.5.2 clock and decal removal

- The four digital time sprites, circular clock backing and chevron selector
  actor are hidden after each native update. Their former clock/selector hit
  targets are disabled, including in wrench mode. The former clock area is
  available for rim capture. The preview omits the same artwork.
- The 20° dial, moving marker, skin sound and other controls are preserved.
  Owned graphics/metadata remain version 6 for update/restore compatibility;
  archive layout and saved records are unchanged. Version 0.5.1 is recognized
  for updates. BW1 is unchanged.
- 101 focused tests and the production build passed. Native harness checks
  cover all six hidden actors, the disabled clock hit target and capture in
  the former clock area, in addition to the existing dial/action checks.
- DS emulator checks passed in White 2 with wireless on/eight buttons and
  Black 2 with wireless off/six buttons. Every frame with the custom C-Gear
  attached checks that all six clock/decal actors remain hidden. Dial steps,
  marker visibility and Party/PC/Map return also passed. Both final screens
  were visually inspected. Physical hardware acceptance remains untested.
- Separate 0.5.2 test ROMs and copied fixture saves preserve all earlier builds
  and personal saves.
- Both delivered 0.5.1 ROMs passed update, disable, export/reopening and source
  preservation checks against the bundled 0.5.2 installer.

## 0.5.1 outer-rim skin dial

- The former upper-right circular selector is removed. Dragging the exposed
  outer rim advances one skin per 20° clockwise or counterclockwise, with
  wraparound. Five faint gray-blue chevrons follow the upper-right arc and
  brighten slightly during capture. An 8×8 marker follows the stylus.
- The editor and native runtime share geometry and the integer angle table.
  Native/custom controls own their initial touches. Captured drags cannot
  activate controls they cross. Holds do not repeat; blocked/native events
  cancel capture and discard unprepared steps. Prepared uploads retain their
  skin ID until the matching pixels and palette have been displayed.
- Graphics metadata version 6 adds a ninth cell/animation and a dial capability
  byte to format 7. Earlier graphics versions remain recognized. The previous
  0.5.0 DLL fingerprints are retained for in-place updates. BW1 binaries and
  graphics are unchanged.
- 101 focused tests passed: compiler/editor state, dial math/resources, skins,
  both BW2 installers and BW1 regressions. The production build passed.
- Both native CPU harnesses passed: direction/20° accumulation, wrapping,
  stationary holds, marker position, in-flight request identity, blocked and
  wrench cancellation, native/custom priority, nine owned resources, marker
  VRAM exhaustion, allocation failures and cleanup. Existing actions, save
  records, native controls and Pokéradar checks also passed. Sound 1356 is
  verified through native-call stubs; this is not an audio listening test.
- Both retail graphics checks passed. Eight buttons plus the dial use
  16,320 / 16,384 sprite bytes and 85 / 128 OAM entries. The additional marker
  resource is 128 bytes. Decal normal/pressed colors and all five chevrons were
  visually inspected in an emulator capture.
- DS emulator checks passed in White 2 with wireless on and eight buttons,
  and Black 2 with wireless off and six buttons. They cover the removed tap
  target, clockwise/counterclockwise steps, the angle-zero boundary, stationary
  hold, marker visibility/position, and return from Party, PC and Map with the
  selected skin retained. Both profiles returned to their initial power state
  with the expected custom captions. This is DS emulator evidence; live DSi
  and physical hardware acceptance remain untested.
- Real-ROM installer checks passed for both profiles with eight buttons and
  companion Learnset, Summary and Porta PC patches: install, update, disable,
  staged removal, export/reopening, configuration recovery and input ROM
  preservation. Separate 0.5.1 test ROMs and copied fixture saves were produced;
  original ROMs and personal saves were not modified.

Manual acceptance checklist:

- [x] Faint five-chevron decal; no circular browse button.
- [x] CW next / CCW previous, one step per 20°, wraparound and stationary hold.
- [x] Moving marker; custom/native touch priority and blocked cancellation.
- [x] Eight-button resource capacity, upload ownership and failure cleanup.
- [x] Party / PC / Map round trips with wireless on/off across both games.
- [x] Editable install/export/reopen and disable/restore checks.
- [ ] Listen to the skin sound effect on the user's emulator/audio setup.
- [ ] Physical DS/DSi checks.

## 0.3.8 mute feedback and control spacing

- Mute/unmute uses Party sound 1356 once per accepted press; held, blocked,
  unavailable and wrench-edit touches stay silent. Keyboard state stays shared.
- Audible music shows a plain note; muted music shows a slash. The native
  animation sequence is selected and its first frame held, avoiding the
  single-frame limitation and the native help-press flashing sequence.
- The note moves one pixel up/right from 0.3.7. Both states keep the normal
  native circle fill for contrast. The Save symbol is 10×10 pixels with three
  pixels of padding in its 16×16 glyph slot; nearest-neighbor sampling retains
  the closed lower edge. Graphics version 5 retains version 4 for migration.
- The editor offers a **Music muted** preview checkbox; clicking the fixed
  music control in its canvas also previews the other state.
- 94 focused tests passed, including artwork versions 1–4 migration/restore,
  distinct music symbols, Save padding, installation, skins and BW1 regressions.
- Both native CPU harnesses passed shared mute/keyboard state, animation
  selection, once-per-press sounds, silent blocked/edit/held input and cleanup.
- Emulator checks passed in White 2 with wireless on and Black 2 with wireless
  off, including a held mute press, native map return, icon sequence/hold flag,
  and unmute. Both states and the smaller Save symbol were visually inspected
  in White 2. These are state/image checks, not an audio listening test.
- Both retail graphics checks passed. Owned edits are confined to glyphs and
  the music state's normal palette selection. Eight-button worst case:
  15,808 / 16,384 sprite bytes and 85 / 128 OAM entries.
- TypeScript and production build passed. Source ROMs and saves remain intact.

## 0.3.7 music control and Pokéradar sound

- The fixed question-mark control becomes a crossed-out music note and toggles
  the existing shared BGM mute state. Native music and replacement tracks use
  the same volume path; sound effects are not muted. Keyboard and touch share
  one state. Native actor/circle/theme resources are retained.
- The mark is shifted one native pixel left/down for visual centering. Graphics
  metadata version 4 preserves older artwork for updates and disable/restore.
- The installer stages the shared music runtime atomically, preserving mappings
  and existing shortcut preferences. Removing a required staged music runtime
  is blocked until the importing C-Gear runtime is removed.
- Pokéradar plays sound 1356, matching PARTY, once per accepted press. Held,
  blocked and unavailable presses do not replay it.
- 171 focused tests pass, covering BW1 regressions, streamed music, both BW2
  installers, graphics migration, recovery and dependency removal protection.
- Both native CPU harnesses pass, including the real compiled shared mute and
  shortcut entry points, register/stack preservation, held/block/edit input,
  volume restoration and no added event or heap allocation. The Pokéradar
  sound ID and single-press behavior are checked with native-call stubs.
- Emulator touch checks pass in B2/W2 with wireless on/off: muted through a
  map round trip, a held first press, and restored music state on second press.
  These checks inspect resident state; they do not constitute a recording or
  listening test of replacement music or sound effects.
- Both retail graphics checks preserve all 126 losslessly packed cell images
  per game and confine owned substitutions to glyphs/pressed palette. The
  eight-button budget is 15,680 / 16,384 sprite bytes, 85 / 128 OAM entries.
- TypeScript and production build pass. Original inputs and saves are intact.

## 0.3.6 Pokéradar

- The editor offers **Pokéradar — generate a nearby phenomenon**, action 17, with **RADAR** as its starting label and no required item. Existing defaults and the eight-button limit are unchanged. Visibility flags, authored coordinates, layers, native patterns and font styling apply normally.
- An accepted press calls the retail phenomenon generator immediately. Two scoped call adapters bypass the walking interval and spawn probability during that call. Normal generation forwards to the original routines. Both English binaries have independently verified call sites, getters and generator/search/setup signatures.
- The native first-badge, encounter-data, grid, zone, terrain and collision checks remain. Placement makes at most 32 immediate attempts, then returns without queueing a later activation. Existing phenomena are retained. Native field-effect ownership and subsequent encounter/item behavior are unchanged.
- Both rebuilt DLLs and their compatibility manifest are bundled with Pokeweb. Version 0.3.5 is recognized for in-place updates; prior authored documents and stable IDs remain intact.

Checks completed:

| Check | Result and scope |
|---|---|
| Focused automated suite | 71 tests passed: 33 compiler/editor, 32 installer, 6 skins. Covers action encoding and recovery, optional visibility, exact 0.3.5 DLL migration, exported configuration recovery, altered generator code and conflicting hook rejection. |
| Native CPU harnesses | Both games passed existing resource/input/request/skin/save cases and new Pokéradar cases. The actual retail generator executes through the compiled interval/chance adapters, with isolated terrain/effect-task stubs. Covers terrain flags, bounded occupied/empty searches, first-badge/grid/data rejection, existing phenomena, held/blocked input, and ordinary interval/chance restoration. |
| DS emulator | Immediate grass generation passed in White 2 with wireless on. Rippling water passed in both games with wireless on; cave dust passed in both games with wireless off. RAM records changed from no phenomenon before the press to a native phenomenon within four frames, with unchanged position/type/task through a held press and a second tap. Screenshots were inspected. Fixtures relocate copied starter data; original ROMs and personal saves are untouched. |
| Installation/export | Clean B2/W2 passed repeated install/update, disable, staged removal and export/reopen with eight authored buttons including Pokéradar, plus Learnset, Summary and Porta PC companions. Source ROM hashes and native overlay bytes were preserved. |
| Production build | TypeScript and Vite build passed; existing chunk-size warnings remain. |

Bridge effects, sea-water variants, entering a generated spot, long play sessions, DSi mode and physical hardware have not been separately accepted for this revision. They continue through the native generator and encounter flow; this is not a claim of new gameplay coverage for those routes.

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


## BW2 0.5.5 C-Gear Shops extension

The optional SHOP action now opens Pokémart plus authored custom shops. Shop
source, currency/icon graphics and per-item prices are separate from button
appearance and retain draft/applied versions. The six-button preset and BW1
binaries remain unchanged. See [C-Gear Shops acceptance and implementation](SYSTEM-SHOPS.md)
for the scoped native adapters, atomic payment rules and verification boundaries.

## BW2 0.5.6 shop return loop

Exiting an owned Buy screen reopens the native shop picker. Cancel leaves the
picker for the overworld. Completed shops release their message sources, reset
stock/price/payment state, and recreate the picker text object. Failed return
allocation unwinds the session. Ordinary NPC shops retain their original route.
The installer recognizes 0.5.5 and recovers its version-1 one-shot picker archive;
updates compile the loop without changing shop definitions or unapplied drafts.

Checked in the DS emulator with White 2 wireless on and Black 2 wireless off:
TM shop purchase → picker → Pokémart → picker → TM shop purchase → picker →
Cancel → fresh SHOP activation → Cancel. Both runs bought TM01 and TM02 for
exactly three Heart Scales (500 → 497), kept 10,000 Poké Dollars, restored native
Pokémart stock/prices, and retained the currency icon's compiled colors on reopen.
Screenshots confirm the returned picker and final overworld. The compiled CPU
harnesses also exercise seven alternating shop sessions and failed return-menu
allocation with complete owned-resource cleanup. Live hardware timing remains
unverified.
