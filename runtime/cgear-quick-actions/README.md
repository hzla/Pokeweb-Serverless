# C-Gear Buttons and Quick Actions

Development package 0.5.6 for English US White 2 (`IRDO`) and Black 2 (`IREO`), revision 0, and compatible derivatives preserving the verified native interfaces. The installer stages PMC and the shared music runtime automatically, retaining existing replacement tracks and shortcut settings.

English US revision-0 Black and White also have a separate functional release
**0.1.3-bw1**. See [BW1 C-Gear Buttons](BW1.md) for its native backgrounds,
removed communication controls, action catalog and verification scope.

Open **More → C-Gear Buttons**, or **Configure Buttons** in **Code Injection → Quality of Life → C-Gear Quick Actions**.

## Beginner guide and source organization

The [Custom C-Gear buttons webpage](../../docs/cgear-buttons/index.html) walks
through graphics, touch input, REPEL, PC and PARTY, including a command-line
three-button build. It assumes basic programming and ROM-format familiarity;
its short C++ primer explains the native-call notation used here. Serve the
repository with `npm run dev` and open `/docs/cgear-buttons/index.html`, or open
the HTML directly for an offline copy. The page is local documentation, not an
additional installer screen.

BW2 remains one translation unit: `quick_actions.cpp` includes the following
readable sections **once, in order**. Do not compile the `.inc` files separately.

| File | Responsibility |
|---|---|
| `runtime.h` | Native structure layouts, checked address conversion and byte-field access |
| `native_addresses.h` | Named native addresses, action codes and sound constants; these names describe our usage |
| `bw2/session.inc` | Button configuration, retained session state and ownership |
| `bw2/game_state.inc` | Item ownership, visibility, eligibility and native field queries |
| `bw2/configuration.inc` | Archive loading, integrity checks and saved positions |
| `bw2/actors_and_dial.inc` | Sprite placement, wrench dragging and dial geometry |
| `bw2/resources.inc` | Allocation, scheduled uploads, display readiness and cleanup |
| `bw2/update.inc` | Per-frame refresh and custom hit testing |
| `bw2/requests.inc` | Owned native Save, PC, Party/Bag/Map and optional Pokenav events |
| `bw2/shop.inc` | Owned C-Gear Shops picker, native inventory/rendering, atomic currency payments and balance icon |
| `bw2/hooks.inc` | Exported lifecycle, input, dispatch and encounter hooks |

`bw1.cpp` is the separate Black/White adapter. The graphics compiler lives in
`src/cgearButtons/`; the atomic installer lives in
`src/pokeweb/cgearQuickActionsModel.ts` and `cgearButtonsModel.ts`. The scoped
`.clang-format` keeps native formatting consistent. Python build/harness files
and the shared graphics code use expanded formatting as well.

The introductory readability refactor preserved function order, private symbols,
native layouts, expressions and control flow. Its rebuilt assets matched the
pre-refactor bytes for both generations. Later behavior changes are recorded
separately in the [acceptance record](acceptance.md).

Refresh real source panels and decoded sprite examples after source changes:

```sh
npx vite-node scripts/build-cgear-button-guide.ts
npx vite-node scripts/build-cgear-button-guide.ts --check
```

The [lesson design](../../docs/cgear-buttons/example-design.json) and
`scripts/build-cgear-button-example.ts` use the production compiler and installer.
The lesson command refuses an existing output ROM and leaves input ROMs and
saves intact. Its optional extracted resources are inspection copies, not a
standalone replacement for PMC installation and dependency checks.

## Editor

A design contains zero to eight custom buttons. The initial preset is:

| Label | Center | Outline | Action |
|---|---|---|---|
| REPEL | 60, 116 | `#18d878` | Unlimited native Repel filtering; spray sound once when enabled |
| PC | 68, 60 | `#ff637b` | Direct native Pokémon storage choices, with PC access sound |
| BIKE | 88, 152 | `#d830f8` | Native Bicycle mount/dismount |
| MAP | 172, 152 | `#c068f0` | Eligible native Fly map, otherwise ordinary Town Map |
| PARTY | 188, 60 | `#29c5f7` | Native party menu |
| BAG | 196, 116 | `#f87800` | Native bag menu |

New designs hide Radar, IR, Online and Wireless by default. **Hide communication buttons** can restore them. PC and PARTY start at the native IR and Online positions, using their native pink/cyan caption colors. Existing editable installations keep their authored designs when updated.

All defaults can be edited or deleted. Add stops at eight. New buttons appear above earlier custom buttons when they overlap. Undo/redo includes each entire drag as one change. Arrow keys move one pixel; Shift moves eight. Optional eight-pixel snapping starts off. Numeric centers must be within X 16–240 and Y 16–176.

The preview decodes the loaded ROM's native C-Gear backgrounds, controls, glyphs and patterns. Theme, pattern set, wireless power and normal/active/pressed/unavailable appearance selectors are preview settings only. Text uses five-pixel-high black foreground, a colored outline and an outer black outline in a 32×32 sprite. Labels are uppercase and limited by actual native glyph width to 28 foreground pixels. Oversized labels block installation without shrinking the font. Colors are converted to DS precision. PC and PARTY use the loaded ROM's brighter, thicker control ring, sampled into the same 32×32 sprite. The four diagonal pixels that protruded beyond the circle after sampling are transparent. Other actions keep the standard custom ring. Interior patterns and theme colors remain native.

Overlap warnings allow installation. Native wrench and pattern-toggle input take priority; remaining custom overlaps follow visible layering. Players can move native controls, so the editor cannot predict every in-game collision. A shown unavailable button consumes its touches; an invisible button releases its region.

**Install / Enable**, **Apply Changes**, **Disable**, and staged removal use existing PMC rules. Compilation and staging must succeed before the applied configuration changes. Drafts autosave separately from the applied design; **Unapplied changes** remains visible until applied. Export retains both documents, including an uninstalled draft. Reopening the ROM recovers editable source metadata from `quick-actions/ui.narc`. Selection, zoom and undo history are editor state only.

## Actions and visibility

PC skips the boot and PC-owner messages and opens Deposit, Withdraw, Move Pokémon, Battle Box, Move items and No thanks. Its native event owns a private script copy; only that invocation's entry instructions change. The storage loop, application calls and field cleanup remain native. Ordinary PCs and the Porta PC Start shortcut retain their existing script. The installer rejects an unrecognized storage script when the design includes PC; designs without PC can still be applied.

PARTY, BAG, Town Map / eligible Fly, ordinary Town Map and Pokéradar use the native field-menu selection sound (1356). PC uses the native storage access sound (1372). An accepted press plays the launch sound once; held or blocked touches do not repeat it. The skin dial plays the same menu sound when a changed skin is displayed. Loading a saved skin is silent. The fixed Save symbol uses native palette index 3, matching the wrench/question mark's dark detail; the native circle supplies the theme fill. Active REPEL and BIKE keep their bright outer ring without an additional inner border.

The bundled BW2 quick-launch saves (`test.sav`, `White2Upgrade.dsv` and `Black2Upgrade.dsv`) start with C-Gear obtained and enabled. Both save copies have repaired block/table checksums; other settings, party data and emulator footers are preserved. This changes the bundled starter files only.

| Action | Required item(s) | Native route |
|---|---|---|
| Unlimited Repel | None | Options toggle plus native encounter filtering |
| PC | None | Owned invocation of field script 10090, entering its storage choice loop |
| Bicycle | 450 | Native field event |
| Town Map / eligible Fly | 442 | Native map and Fly request |
| Town Map / Fly — HM02, no Fly Pokémon required | 421 | Same native map/Fly request; HM ownership replaces the learned-move requirement |
| Ordinary Town Map | 442 | Native map application |
| Dowsing Machine | 471 | Native field event |
| Super Rod | 447 | Native fishing event |
| Vs. Recorder | 465 | Native application |
| Pal Pad | 437 | Native application |
| Xtransceiver | 621 or 626 | Native application |
| Medal Box | 627 | Native application |
| Gracidea | 466 | Native party selection and item use |
| DNA Splicers | 628 or 629 | Native party selection and fuse/separate flow |
| Reveal Glass | 638 | Native party selection and item use |
| BAG | None | Native bag, item use and party handoffs |
| PARTY | None | Native party, summary, item and field-skill handoffs |
| Pokenav | None | Read-only current-area encounters and species information; see [Pokenav](../pokenav/README.md) |
| Pokéradar | None | Immediate native phenomenon placement: shaking grass, rippling water, cave dust clouds, or bridge effects as supported nearby |

**Pokéradar — generate a nearby phenomenon** is available in the button editor, with the initial label **RADAR**. It does not add a button to existing designs automatically. One press calls the native generator immediately, bypassing its walking interval and random spawn chance only during that call. The native first-badge, map, terrain, collision and encounter-data checks remain. Up to 32 placement attempts handle a random search direction or occupied tile; unsupported locations and locations without a suitable nearby tile produce no spot. Existing phenomena are retained and the button is dimmed while one is present. Normal walking-based generation, timers and probabilities remain native outside that press. Optional visibility flags work as for other custom buttons.

Ownership, location checks, progression, confirmations, communication prompts and cancellation stay native. MAP chooses the first eligible non-egg party member knowing Fly. If there is none, or Fly is prohibited here, it opens ordinary Town Map. Ordinary Town Map is also a separate choice. Story/passive items are omitted. Modified field-handler groups in a hack produce a specific incompatible-handler diagnostic; arbitrary addresses and scripts are not accepted.

**Town Map / Fly — HM02, no Fly Pokémon required** is a separate option in both
games' action catalogs, initially labeled **FLY**. It is hidden unless HM02
(item 421) is present in the native TM/HM bag pocket. Town Map ownership is not
required. Native Fly location/progression checks, visited destinations,
confirmation, animation and cancellation remain. The first non-Egg supplies
the native animation without learning Fly or spending PP. A prohibited location
or a party with no non-Egg falls back to ordinary Town Map, as with the existing
option. HM ownership is checked again before travel; it is never consumed.
Optional visibility flags also apply. Existing presets keep their original MAP
action until the author selects this new option.

Key-item buttons are invisible without their required item. An optional saved flag further gates any button: **Show when flag is set** or **Hide when flag is set**. Temporarily unusable owned actions are dimmed. Flags accept decimal or hexadecimal saved IDs 1–3059. Installation and activation never write visibility flags.

REPEL starts without a flag. PC starts with hide flag `0x05ED` (1517), in the retail gap before trainer flags starting at 1520. Build checks verify the saved-flag accessor/range and no matching operand in either clean English game's script/entity archives. Hacks must choose a flag they leave unused.

Duplicate actions share the underlying state. Removing all Repel actions makes the saved unlimited preference dormant. Disabling the runtime also makes it dormant.

BAG and PARTY are additional action choices within the same eight-button limit. PARTY is dimmed for an empty party. Their normal native menus remain usable, including companion menu enhancements when installed; closing returns directly to the overworld.

## Skins

The skin feature includes 15 BW2 skins, a preview, a starting-skin selector, and import of native BW2 `.cgb` files, up to 64 skins. Colors are preserved. Skin order controls the in-game carousel; stable skin IDs preserve a player's saved selection when reordered.

Drag the outer rim to browse the catalog and original/save-file picture. Each 12° moves one skin: clockwise next, counterclockwise previous, wrapping at either end. The touch band is 116–138 pixels from center `(128, 96)`. A small marker follows the stylus at radius 125 while dragging. The chevron decal and digital clock, including its circular backing, are hidden. Their former touch targets are disabled and release the rim for dial input. Pokeweb's preview uses the same angle table and thresholds.

Native controls and visible custom buttons receive the initial touch first, including dimmed buttons. A captured rim drag retains its touch until release, so crossing another control cannot activate it. Stationary holds do not repeat; center-crossing jumps are ignored. Wrench mode and native events cancel the gesture and discard unprepared requests. A prepared upload keeps its own skin ID paired with its pixels and palette, even if another step arrives before display. No skin changes are queued from blocked presses.

A chosen starting skin applies only when no valid saved skin selection exists. Pre-skin position records preserve their coordinates while adopting that starting skin. The original downloaded picture is retained and never overwritten in save data. Only the original and currently selected skin are loaded into RAM. Initial capture uses the native retained palette rather than a potentially faded VRAM palette.

## Native controls and save data

Buttons are available after C-Gear is obtained, including with wireless off. Installation does not enable wireless. The native wrench remains visible with wireless off, drags custom buttons and preserves their layout through normal saving. The native logo cycles the same five interior designs.

The original **?** control at `(215, 163)` becomes a crossed-out music note. One accepted press toggles only BGM through the shared music runtime, including replacement tracks; sound effects remain audible. It works with wireless off and shares its state with **L + R + Select** when that shortcut is enabled. Muting changes volume rather than pausing or restarting the track. The native circle/theme palettes are retained. The note is one pixel up/right from 0.3.7; the audible state has a plain note and the muted state adds its diagonal slash, using the same normal circle fill. Each accepted mute or unmute plays Party menu sound 1356 once. This is a session preference, matching the original mute patch; it resets on cold boot. Updates retain installed music mappings and any existing shortcut preference. A new shared runtime enables the ordinary shortcut. The music runtime remains installed on C-Gear disable/removal and cannot be removed while a C-Gear DLL imports its mute API.

The original power control becomes a centered 10×10-pixel floppy-disk **Save** control at `(200, 180)`. It opens the native save confirmation and completion flow, including with wireless off. Cancellation and completion return to C-Gear directly. This fixed control does not consume an authored button slot. Existing field events retain priority; held or blocked touches never queue a later save. Native request data remains owned until the save flow and deferred subscreen transition finish. The network-status sprite is moved out of view while the custom dial is installed, and restored on cleanup. Disabling restores the original native power and selector graphics. Both gender pattern sets come from the loaded ROM.

Hold **L + R for one second in wrench mode** to reset custom positions to authored defaults, once per hold. Native panel positions, theme, design and power settings are preserved.

Positions use a versioned 36-byte record in reserved C-Gear bytes 16–51: 16-bit marker `0xA000 | skinID`, eight records of `{id:u16, x:u8, y:u8}`, and a CRC16. Coordinates follow stable IDs rather than labels, actions or list order. Existing four-position records migrate IDs 1–4; the previous eight-position `0x3251` record also migrates. New IDs use authored defaults. Invalid records fall back to defaults. Native C-Gear bytes 0–15 remain intact.

Unlimited Repel uses Options bit 12, preserving retail settings and Following Pokémon bit 11. Ordinary Repel item IDs and step counters remain intact; their countdown pauses while unlimited Repel is enabled and resumes after disabling it. Loading an enabled save does not replay the spray sound.

## Resources and ownership

- Separate B2/W2 profiles verify hooks, imported functions, calling conventions, native item routes and save accessors. Unknown conflicting native/PMC modifications are rejected. These checks cannot prove arbitrary indirect changes in a hack safe.
- The native unit retains 84 actor slots and gains up to eight custom slots plus one dial marker slot. Custom palettes use banks 7–14; the native network palette keeps bank 15. The dial marker uses owned bank 7. Other use of reserved banks is rejected.
- Eight buttons need 4 KiB of sprite character data and 256 palette bytes; the 8×8 dial marker reserves another 128 character bytes. Retail common sprite graphics are losslessly repacked from 12,288 to 10,048 bytes by deduplicating tiles and dividing transparent non-affine effects into smaller cells. Affine cells remain intact. All 126 decoded cell images per game are identical before/after lossless packing. The owned substitutions replace the selector circle with a bare 16×32 decal and modify only the Save/music glyphs and music state palette. Other cells remain intact. Current retail worst case with the dial and eight buttons is 16,320 / 16,384 sprite bytes and 85 / 128 OAM entries. The compiler checks the loaded ROM's resource totals.
- Only native C-Gear archive members 16/17 (characters/cells) are replaced. Their original versions are backed up and restored on disable/removal. Updates preserve unrelated background, palette and pattern edits, including changes made after installation. Unknown changes to the owned pair are rejected instead of overwritten. Skin tooling must coordinate if it edits this pair or reserved palette banks.
- The owned private archive is format 7: configuration (including communication visibility and the dial capability in byte 47), NCLR/NCER/NANR, eight four-pose banks, ten native patterns, editable draft/applied JSON metadata, the original native sprite pair, a skin catalog and skin resources. The ninth cell/animation belongs to the dial marker. Graphics metadata version 6 recognizes versions 1–5 for migration, including release 0.5.0. Recognized older runtimes/archives migrate in place.
- Initialization requires 64 KiB free heap and a 16 KiB contiguous allocation. Eight pose banks use 16 KiB CPU memory, patterns 5 KiB, retained upload staging 4,224 bytes, original/selected skin buffers up to 19 KiB, plus native resources, actors and runtime state. Normal button and dial input frames allocate nothing; a skin change loads one retained resource.
- Uploads use the native display scheduler and retained main-RAM buffers. A palette refresh transfers all eight banks (256 bytes), and synchronizes owned banks 7–13 with the native fade buffers. Worst-case changed button characters add 4 KiB; the marker's first upload adds 128 bytes, or 4,480 bytes total. A simultaneous skin change adds 9,728 bytes, for 14,208 bytes. Subsequent marker movement only changes actor position. Stack/DTCM data is not used as a DMA source. No direct display-register replacement occurs.
- Native events retain priority. Blocked requests are discarded. One stylus press activates once. PC uses native script ownership; native applications use owned parent requests through completion/cancellation. Teardown releases custom actors and upload sources before borrowed native resources disappear. Rebuilt field screens reattach cleanly, even when native allocation addresses are reused.
- The independent Porta PC Start shortcut is preserved. Removing a staged module follows Pokeweb's existing rules; already exported modules can be disabled.

## Shared interfaces and build

`src/cgearButtons/document.ts` defines project version 1, stable IDs and the action catalog. `compiler.ts` exposes shared `validate`, `compile` and `preview` functions. The editor and bundled graphics generator use the same implementation. Ordinary button edits update archive data without rebuilding ARM code. No executable user code is accepted.

`src/cgearButtons/dial.json` supplies shared hit geometry, colors and an integer angle table. `dial.ts` handles preview gestures; the native builder generates its C++ constants from the same JSON. `nativeGraphics.ts` retains earlier owned artwork for update/restore integrity; the current runtime hides the clock and selector actors after each native update.

Building native modules requires Python 3 with ndspy, Unicorn and pyelftools; Java with RPMTool; the ARM GNU toolchain; and matching clean US B2/W2 ROMs. `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, `QUICK_ACTIONS_W2_ROM` and `QUICK_ACTIONS_B2_ROM` override local inputs. The former Python graphics generator has been replaced by browser-compatible TypeScript.

```sh
npm run cgear:build
npm run cgear:verify
npx vitest run src/test/cgearButtons.test.ts src/test/cgearQuickActionsModel.test.ts src/test/cgearSkins.test.ts
npx vitest run src/test/cgearDial.test.ts
npx vite-node scripts/verify-cgear-native-graphics.ts /path/to/clean-white2.nds /path/to/clean-black2.nds
npm run cgear:verify-rom -- /path/to/input.nds --eight --bag-party --companions --output /path/to/separately-named-test.nds
QUICK_ACTIONS_FRAMES=1650 npm run cgear:emulator -- /path/to/input.nds --scenario bike --bicycle --eight --power-on
QUICK_ACTIONS_FRAMES=3500 npm run cgear:emulator -- /path/to/input.nds --scenario dial --bicycle --eight --power-on
QUICK_ACTIONS_FRAMES=2400 npm run cgear:emulator -- /path/to/input.nds --scenario action --action medals --bicycle --eight
python3 runtime/cgear-quick-actions/emulator_matrix.py
python3 runtime/cgear-quick-actions/emulator_matrix.py --special
python3 runtime/cgear-quick-actions/emulator_matrix.py --skins
QUICK_ACTIONS_FRAMES=1250 npm run cgear:emulator -- /path/to/clean-white2.nds --scenario radar --action pokeradar --bicycle --power-on --radar-zone 437 --radar-x 83 --radar-z 678
npm run build
```

The CPU harness executes compiled Thumb code with native-call stubs and selected retail parsers. Emulator tests use copied fixture data; input ROMs and user saves are never written. Local screenshots, RAM traces and fixture copies live in ignored `build/`. See [acceptance record](acceptance.md) for tested scope and remaining gameplay checks. Cold boot test ROMs with copied ordinary saves; old emulator states restore old runtime code.

BW2 0.5.0 includes the optional Nuzlocke Style Encounters snapshot provider for Pokenav 0.3.0. It reads the installed feature's configuration and native caught records at entry; C-Gear alone does not filter encounters or enable the Nuzlocke patch.

## C-Gear Shops (BW2)

Assign **C-Gear Shops** to an optional **SHOP** button. It opens a native picker
containing **Pokémart**, your named custom shops and Cancel. The six-button
preset is unchanged; SHOP uses one of the eight available slots.

Use **Items → C-Gear Shops** to add up to sixteen shops with up to 45 items each.
Each shop uses Poké Dollars or one stackable non-key item. Costs belong to the
shop definition, independently of button appearance and the ROM's ordinary item
prices. TM/HM item choices include their currently assigned move names.
Exiting a Buy list returns to the shop picker; Cancel leaves the picker for the overworld.
Drafts autosave and export separately from the last applied configuration.
**Apply Changes** compiles shop data and stages the C-Gear runtime atomically.

Native TM move names, owned indicators and purchase checks are retained, including
mixed TM/ordinary stock. Item-currency shops show their loaded-ROM currency name,
a downscaled currency icon on the left and the balance on the right. Pokémart
reads native badge tiers and the ROM's current stock and prices on every opening.
Ordinary NPC shops keep their normal behavior.

See [C-Gear Shops implementation and acceptance](SYSTEM-SHOPS.md) for the archive,
ownership/payment design, reproducible checks and remaining hardware checks.
