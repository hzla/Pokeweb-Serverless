# C-Gear Buttons and Quick Actions

Development package 0.3.5 for English US White 2 (`IRDO`) and Black 2 (`IREO`), revision 0, and compatible derivatives preserving the verified native interfaces. PMC is the only dependency.

Open **More → C-Gear Buttons**, or **Configure Buttons** in **Code Injection → Quality of Life → C-Gear Quick Actions**.

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

PARTY, BAG, Town Map / eligible Fly and ordinary Town Map use the native field-menu selection sound (1356). PC uses the native storage access sound (1372). An accepted press plays the launch sound once; held or blocked touches do not repeat it. The skin selector uses the same menu sound and a 200 ms pressed state, with the native pressed palette and a one-pixel-down caption. Loading a saved skin is silent. The fixed Save symbol uses native palette index 3, matching the wrench/question mark's dark detail; the native circle supplies the theme fill. Active REPEL and BIKE keep their bright outer ring without an additional inner border.

The bundled BW2 quick-launch saves (`test.sav`, `White2Upgrade.dsv` and `Black2Upgrade.dsv`) start with C-Gear obtained and enabled. Both save copies have repaired block/table checksums; other settings, party data and emulator footers are preserved. This changes the bundled starter files only.

| Action | Required item(s) | Native route |
|---|---|---|
| Unlimited Repel | None | Options toggle plus native encounter filtering |
| PC | None | Owned invocation of field script 10090, entering its storage choice loop |
| Bicycle | 450 | Native field event |
| Town Map / eligible Fly | 442 | Native map and Fly request |
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

Ownership, location checks, progression, confirmations, communication prompts and cancellation stay native. MAP chooses the first eligible non-egg party member knowing Fly. If there is none, or Fly is prohibited here, it opens ordinary Town Map. Ordinary Town Map is also a separate choice. Story/passive items are omitted. Modified field-handler groups in a hack produce a specific incompatible-handler diagnostic; arbitrary addresses and scripts are not accepted.

Key-item buttons are invisible without their required item. An optional saved flag further gates any button: **Show when flag is set** or **Hide when flag is set**. Temporarily unusable owned actions are dimmed. Flags accept decimal or hexadecimal saved IDs 1–3059. Installation and activation never write visibility flags.

REPEL starts without a flag. PC starts with hide flag `0x05ED` (1517), in the retail gap before trainer flags starting at 1520. Build checks verify the saved-flag accessor/range and no matching operand in either clean English game's script/entity archives. Hacks must choose a flag they leave unused.

Duplicate actions share the underlying state. Removing all Repel actions makes the saved unlimited preference dormant. Disabling the runtime also makes it dormant.

BAG and PARTY are additional action choices within the same eight-button limit. PARTY is dimmed for an empty party. Their normal native menus remain usable, including companion menu enhancements when installed; closing returns directly to the overworld.

## Skins

The coordinated skin feature includes 15 BW2 skins, a preview, a starting-skin selector, and import of native BW2 `.cgb` files, up to 64 skins. Colors are preserved. Skin order controls the in-game carousel; stable skin IDs preserve a player's saved selection when reordered. The upper-right **>>** circle cycles through the catalog and the original/save-file picture, once per stylus press. Skin cycling is blocked during wrench editing and native events.

A chosen starting skin applies only when no valid saved skin selection exists. Pre-skin position records preserve their coordinates while adopting that starting skin. The original downloaded picture is retained and never overwritten in save data. Only the original and currently selected skin are loaded into RAM. Initial capture uses the native retained palette rather than a potentially faded VRAM palette.

## Native controls and save data

Buttons are available after C-Gear is obtained, including with wireless off. Installation does not enable wireless. The native wrench remains visible with wireless off, drags custom buttons and preserves their layout through normal saving. The native logo cycles the same five interior designs.

The original power control becomes a floppy-disk **Save** control at `(200, 180)`. It opens the native save confirmation and completion flow, including with wireless off. Cancellation and completion return to C-Gear directly. This fixed control does not consume an authored button slot. Existing field events retain priority; held or blocked touches never queue a later save. Native request data remains owned until the save flow and deferred subscreen transition finish. The network-status sprite is moved out of view only while the custom selector is displayed, and restored on cleanup. Disabling restores the original native power and selector graphics. Both gender pattern sets come from the loaded ROM.

Hold **L + R for one second in wrench mode** to reset custom positions to authored defaults, once per hold. Native panel positions, theme, design and power settings are preserved.

Positions use a versioned 36-byte record in reserved C-Gear bytes 16–51: 16-bit marker `0xA000 | skinID`, eight records of `{id:u16, x:u8, y:u8}`, and a CRC16. Coordinates follow stable IDs rather than labels, actions or list order. Existing four-position records migrate IDs 1–4; the previous eight-position `0x3251` record also migrates. New IDs use authored defaults. Invalid records fall back to defaults. Native C-Gear bytes 0–15 remain intact.

Unlimited Repel uses Options bit 12, preserving retail settings and Following Pokémon bit 11. Ordinary Repel item IDs and step counters remain intact; their countdown pauses while unlimited Repel is enabled and resumes after disabling it. Loading an enabled save does not replay the spray sound.

## Resources and ownership

- Separate B2/W2 profiles verify hooks, imported functions, calling conventions, native item routes and save accessors. Unknown conflicting native/PMC modifications are rejected. These checks cannot prove arbitrary indirect changes in a hack safe.
- The native unit retains 84 actor slots and gains eight custom slots. Custom palettes use banks 7–14; the native network palette keeps bank 15. Conflicting palette use is rejected.
- Eight buttons need 4 KiB of sprite character data and 256 palette bytes. Retail common sprite graphics are losslessly repacked from 12,288 to 10,048 bytes by deduplicating tiles and dividing transparent non-affine effects into smaller cells. Affine cells remain intact. All 126 decoded cell images per game are identical before/after lossless packing. The selector/save substitutions change only their glyph areas; native circle artwork and unrelated cells remain identical. With the selector/save glyph substitutions, the packed common data is 9,728 bytes. Current retail worst case is 15,616 / 16,384 sprite bytes and 85 / 128 OAM entries. The compiler checks the loaded ROM's resource totals.
- Only native C-Gear archive members 16/17 (characters/cells) are replaced. Their original versions are backed up and restored on disable/removal. Updates preserve unrelated background, palette and pattern edits, including changes made after installation. Unknown changes to the owned pair are rejected instead of overwritten. Skin tooling must coordinate if it edits this pair or reserved palette banks.
- The owned private archive is format 7: configuration (including communication visibility), NCLR/NCER/NANR, eight four-pose banks, ten native patterns, editable draft/applied JSON metadata, the original native sprite pair, a skin catalog and skin resources. Recognized older runtimes/archives migrate in place.
- Initialization requires 64 KiB free heap and a 16 KiB contiguous allocation. Eight pose banks use 16 KiB CPU memory, patterns 5 KiB, retained upload staging 4 KiB, original/selected skin buffers up to 19 KiB, plus native resources, actors and runtime state. Normal button frames allocate nothing; a skin change loads one retained resource.
- Uploads use the native display scheduler and retained main-RAM buffers. A palette refresh transfers all eight banks (256 bytes), and synchronizes owned banks 7–13 with the native fade buffers. Worst-case changed button characters add 4 KiB, or 4,352 bytes total. A simultaneous skin change adds 9,728 bytes, for 14,080 bytes. Stack/DTCM data is not used as a DMA source. No direct display-register replacement occurs.
- Native events retain priority. Blocked requests are discarded. One stylus press activates once. PC uses native script ownership; native applications use owned parent requests through completion/cancellation. Teardown releases custom actors and upload sources before borrowed native resources disappear. Rebuilt field screens reattach cleanly, even when native allocation addresses are reused.
- The independent Porta PC Start shortcut is preserved. Removing a staged module follows Pokeweb's existing rules; already exported modules can be disabled.

## Shared interfaces and build

`src/cgearButtons/document.ts` defines project version 1, stable IDs and the action catalog. `compiler.ts` exposes shared `validate`, `compile` and `preview` functions. The editor and bundled graphics generator use the same implementation. Ordinary button edits update archive data without rebuilding ARM code. No executable user code is accepted.

Building native modules requires Python 3 with ndspy, Unicorn and pyelftools; Java with RPMTool; the ARM GNU toolchain; and matching clean US B2/W2 ROMs. `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, `QUICK_ACTIONS_W2_ROM` and `QUICK_ACTIONS_B2_ROM` override local inputs. The former Python graphics generator has been replaced by browser-compatible TypeScript.

```sh
npm run cgear:build
npm run cgear:verify
npx vitest run src/test/cgearButtons.test.ts src/test/cgearQuickActionsModel.test.ts src/test/cgearSkins.test.ts
npx vite-node scripts/verify-cgear-native-graphics.ts /path/to/clean-white2.nds /path/to/clean-black2.nds
npm run cgear:verify-rom -- /path/to/input.nds --eight --bag-party --companions --output /path/to/separately-named-test.nds
QUICK_ACTIONS_FRAMES=1650 npm run cgear:emulator -- /path/to/input.nds --scenario bike --bicycle --eight --power-on
QUICK_ACTIONS_FRAMES=2400 npm run cgear:emulator -- /path/to/input.nds --scenario action --action medals --bicycle --eight
python3 runtime/cgear-quick-actions/emulator_matrix.py
python3 runtime/cgear-quick-actions/emulator_matrix.py --special
python3 runtime/cgear-quick-actions/emulator_matrix.py --skins
npm run build
```

The CPU harness executes compiled Thumb code with native-call stubs and selected retail parsers. Emulator tests use copied fixture data; input ROMs and user saves are never written. Local screenshots, RAM traces and fixture copies live in ignored `build/`. See [acceptance record](acceptance.md) for tested scope and remaining gameplay checks. Cold boot test ROMs with copied ordinary saves; old emulator states restore old runtime code.
