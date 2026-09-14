# Standalone LEARNSET viewer

Install **Learnset Viewer** from Pokeweb's Code Injection page. The feature
requires PMC only and bundles two stripped companions for each supported US
game (`IRDO` White 2 / `IREO` Black 2). Neither Upgrade nor the enhanced party
menu is required. Unknown overlapping hooks or incompatible tutor resources
are rejected rather than overwritten.

LEARNSET is read-only. RELEARN and ordinary move tutors retain their original
behavior. The command is appended immediately before Cancel **after** field
moves and other commands have expanded; it is omitted if all eight slots are
occupied. Eggs, battle/daycare menus, and item/mail submenus are excluded.

## Runtime design

Release **1.0.3** adds two native pixels between the type icon and the first
level digit in every candidate row, including scrolled rows. The level/name
starts at bitmap X=2 instead of 0; its measured width is reduced from 108 to
106 pixels so the right edge stays fixed. PP, icons, bar geometry, upper
learned moves, and ordinary RELEARN/tutor sessions are unchanged.

Version 1.0.3 passed 50 focused LEARNSET/enhanced-menu/PMC tests, host logic
tests, compiled W2/B2 row-position and redraw checks, production build, and
update/export/reload checks. Fresh test ROMs are
`White2Upgrade-LEARNSET-1.0.3-test.nds` and
`Black2Upgrade-LEARNSET-1.0.3-test.nds` in the outer Repos folder.
No live emulator session was run for this spacing-only change.

Release **1.0.2** fixes the solid-green lower background. The private tilemap
was uploaded directly to VRAM, leaving the tutor's CPU-side BG7 screen buffer
empty. A later native redraw uploaded that empty buffer over the correct map.
The screen wrapper now follows the retail buffered path: copy the modified map
into the existing screen buffer and request its upload. Direct upload is used
only when no screen buffer exists. A zero length uses the resource's map size.
This affects only LEARNSET; ordinary tutor graphics and ROM archives are unchanged.

The captured green-screen state confirmed the entire 4 KiB BG7 buffer was zero.
`verify_graphics.py GREEN_SCREEN.dst` reproduces the old failure and tests the
new compiled wrapper using real US W2/B2 background and memory-copy routines.
It verifies repeated redraws after freeing the source resource and checks that
all other game RAM is unchanged. Archive I/O and the final hardware transfer
are instrumented; this is not a complete live-game test.

The 1.0.2 release passed 48 focused LEARNSET/enhanced-menu/PMC tests, both games'
compiled-wrapper and native-redraw checks, the production build, and
update/export/reload from the earlier 1.0.1 test ROMs. Test exports are named
`White2Upgrade-LEARNSET-1.0.2-test.nds` and
`Black2Upgrade-LEARNSET-1.0.2-test.nds` in the outer Repos folder.
Refresh Pokeweb, update Learnset Viewer, export, and restart from boot; an old
save state restores the old loaded module, so it cannot validate this update.

Release **1.0.1** fixes the missing-command issue in 1.0.0. Both companions
now use `PMCModulePriority: 4` (`PMC_PATCH`). PMC's supported range is 0–4;
the original value 5 put the modules outside its activation chains. The
captured party-menu state confirmed both handles were null, neither module
had started, and all three menu/field hook sites were unmodified, despite
space remaining in the menu. The original wrapper tests bypassed PMC loading
and therefore missed this packaging error. Metadata tests now enforce the
supported range and detect the faulty release as an available update.

Refresh Pokeweb, update Learnset Viewer, export, and **restart the ROM from
boot**. Restoring a state made with 1.0.0 restores its invalid module-chain
state, so it cannot validate this fix. `verify_dst.py CAPTURE.dst` performs
the read-only captured-state diagnosis without starting an emulator.

The 1.0.1 release passed all 48 focused LEARNSET/enhanced-menu/PMC tests,
both games' compiled-wrapper checks, the production build, and update/export/
reload from the earlier 1.0.0 test ROMs. Corrected test exports are named
`White2Upgrade-LEARNSET-1.0.1-test.nds` and
`Black2Upgrade-LEARNSET-1.0.1-test.nds` in the outer Repos folder.

| Companion | Overlay lifetime | Responsibility |
| --- | --- | --- |
| `patches/LearnsetMenu{W2,B2}.dll` | 12, 165 | Menu insertion, private selection, field transition, request ownership |
| `patches/LearnsetViewer{W2,B2}.dll` | 258 | Tagged tutor adaptation, read-only input, row rendering, private background adjustment |

The menu module wraps the underlying item-construction, selection, and field
dispatch functions, not the enhanced menu's call sites. Eight-byte Thumb
trampolines preserve the original prologue and return into the retail body.
The viewer wraps the proc table and selected calls within overlay 258. All
game addresses and hook bytes are separately verified for W2 and B2 by
`build.py`; the installer uses its generated manifest.

The private command `0x4c53` and transition marker `0x4c535631` are accepted
only in the overworld party context. A field-owned request contains a retail
28-byte tutor prefix, `LSV1` tag, version/size, at most 32 `{moveId, level}`
records, and a separate terminated move-ID array. The bridge refuses to run
the retail tutor if its viewer companion is missing. The viewer recognizes
mode `0xfe`, validates the request, and normalizes the retail mode to 1 before
initialization. Its end callback clears active pointers before overlay unload;
the field callback then frees the request and restores the selected party slot.

Species and form are read from the selected Pokemon, then resolved with the
game's personal-data index routine. Level-up data comes directly from
`a/0/1/8`. Bounded NARC reads validate headers, block lengths, member ranges,
short reads, and the list terminator. Records allow levels 0–100 and valid move
IDs; exact duplicates collapse, ties retain their source order, and neither
known moves nor future levels are filtered. Empty/unavailable lists use a
hidden harmless retail placeholder to keep the original cursor allocation
valid, while displaying a private explanatory message.

Names and base max PP are read through retail routines. Labels use the game's
font-width routine, retain `N - `, and shorten the name with `...` to fit 106
pixels after the two-pixel inset. PP starts 120 pixels into the existing list
bitmap, leaving its full
48-pixel area. The upper learned-move panel and detail/category/power/accuracy
renderers remain native. Confirmation is disabled and teaching/replacement
states are blocked; B/back enters the fade-out path without a question.

Only the viewer's private copy of lower background member 2 in `a/1/2/5` is
modified. In rows 8–20, map columns 18/19 move to 21/22, with the intervening
space filled from column 17. This shifts the diagonal divider exactly three
8-pixel tiles without changing outer geometry. The highlighted cursor
(character 17, cell 7, animation 8) is an outline over this same background,
so both states share the adjusted divider. No ROM graphics archive is replaced.

## Source provenance and compatibility

The primary behavioral reference is **REDACTED_REFERENCE (Japanese BW2)**:

- `prog/src/app/waza_oshie/wo_main.c`, `wo_bmp_def.h`, and
  `prog/include/app/waza_oshie.h` for tutor state, callbacks, windows and lists.
- The party menu and field Pokemon-menu dispatch code for expanded menu
  ownership and transition sequencing.
- `resource/waza_oshie/` for resource relationships (US resource indexes are
  independently read from the target ROM, not assumed from Japanese indexes).

`swan_export` is BW1 and is not used as evidence for BW2 layouts. The build
pins decompressed US overlays 12/165/258. `learnsetViewerManifest.json` records
hook/layout signatures, patch types/sizes, and retail resource SHA-256 values.
The installer also inspects other staged/built-in RPM patch ranges, so a renamed
conflicting DLL is still rejected. Module files are stripped, have no imports
or constructor sections, and rely only on PMC relocation/hook machinery and
verified game routines.

Private text is appended/reused in banks 178 (LEARNSET) and 401 (empty/error).
Shared tutor strings are not replaced. Each companion stores versioned message
IDs with complements; persisted configuration and DLL inspection support
updates and export/reload. Staged uninstall removes only these companions and
retains private text for safe reinstall. As with other Pokeweb patches, modules
already baked into a loaded ROM cannot currently be deleted through staged
uninstall; keep an unpatched ROM for rollback.

## Rebuild and checks

From the Pokeweb-Serverless repository root:

```sh
npm run learnset:build
c++ -std=c++17 -Wall -Wextra -Werror runtime/learnset-viewer/test_logic.cpp -o runtime/learnset-viewer/build/test_logic
runtime/learnset-viewer/build/test_logic
python3 runtime/learnset-viewer/verify_runtime.py
python3 runtime/learnset-viewer/verify_graphics.py GREEN_SCREEN.dst
npm test
npm run build
npm run learnset:verify-rom -- INPUT.nds --enhanced-first
npm run learnset:verify-rom -- INPUT.nds --enhanced-last
npm run learnset:preview -- INPUT.nds
```

Build prerequisites: Python with `ndspy`, Java/CTRMap RPM tools, and GNU ARM
Embedded 14.2. The isolated Thumb-wrapper test uses `unicorn==2.1.4` and
`pyelftools==0.32` (global installation or `build/python`). This test instruments
retail function calls; it is **not** a full game/emulator integration test.

Override local inputs with `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`,
`LEARNSET_W2_ROM`, and `LEARNSET_B2_ROM`. Defaults use sibling toolchain and
clean-ROM fixtures. `rom_inspect.py` extracts/disassembles overlays read-only.
Build/preview outputs remain in ignored `build/`; only the four DLLs and
manifest are bundled. `--output OUTPUT.nds` on the installation verifier creates
a test ROM and refuses to overwrite an existing file.

Automated coverage includes parser bounds/order/duplicates/max length,
zero–four field moves with zero–two enhanced commands, actual compiled
trampolines, request cleanup/repeated openings/missing companion, read-only
guards, all row positions and scrolling, name truncation/PP arguments, private
tile adjustments, stripped metadata, compatibility rejection, staged removal,
idempotence, private messages, unchanged graphics archive, and export/reload.

### Implementation verification (2026-09-13)

- Host parser/formatting tests and compiled W2/B2 Thumb-wrapper tests passed.
- Vanilla W2/B2 passed PMC-only install/export/reload, and both enhanced-menu
  installation orders passed. Existing Upgrade W2/B2 passed install/export/reload.
- Four stripped artifacts built: each menu DLL is 2,752 bytes and each viewer
  DLL is 3,264 bytes in 1.0.2 (file sizes, not heap estimates).
- Production build passed. The reduced-concurrency full suite had 1,009 passes,
  one skip, and one existing cry-fixture timeout. The cry test and LEARNSET
  tests passed together when rerun with a 30-second timeout. No unrelated tests
  or timeout defaults were changed.
- `White2Upgrade-LEARNSET-test.nds` and `Black2Upgrade-LEARNSET-test.nds`
  were exported to the outer Repos folder without overwriting the source ROMs.
- Actual in-game graphics/input/lifetime acceptance remains pending user testing;
  the instrumented tests do not execute the complete retail engine.

## User emulator checklist

The following live-game acceptance checks remain. A feature-only live check
was authorized for 1.0.2 but could not be completed because the native emulator
UI controls timed out; no battle was run.

1. Open LEARNSET for several party slots and alternate forms. Check known and
   future moves, stable ascending levels, levels 0/1/55/100, descriptions/icons,
   and long names. Check all four rows while scrolling and using touch.
2. Confirm PP shows the ROM's base maximum despite depleted PP or PP Ups.
   Check both highlighted/unhighlighted bars, and confirm the upper panel is
   unchanged. A must never teach; B/back must return to the same Pokemon.
3. Open/close repeatedly, then use RELEARN and ordinary tutors. Verify moves,
   PP, items and saved Pokemon data have not changed from viewing.
4. Check an empty learnset and an invalid/unterminated learnset: each must show
   its explanatory message and close safely. Test a full 32-entry learnset.
5. Test Eggs, battle/daycare/item/mail contexts and full eight-command menus.
   LEARNSET must not appear there or displace another command.
6. Repeat on vanilla and Upgrade W2/B2, with enhanced menu installed before and
   after LEARNSET. Load the newly named test ROM from a fresh boot rather than
   restoring a save state created with a different DLL layout.
