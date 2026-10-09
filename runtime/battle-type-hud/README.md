# Type Icons and Move Effectiveness Preview

Bundle 0.4.24 (Type Icons 0.3.18; Circular Icons 0.3.18-circular; Angular HUD Wedges 0.3.24-solid; Move Preview 0.4.1) for English Black 2 (IREO) and White 2 (IRDO).
Pokeweb's **Code Injection** page has two independent entries:

- **Type Icons** → choose lettered, circular-symbol, or angular-wedge builds in the same installer card.
- **Move Effectiveness Preview** → `MoveEffectivenessB2.dll` / `MoveEffectivenessW2.dll`.

Install either or both; PMC is installed automatically if needed. Neither DLL
imports the other, and the icon installer does not check move-effectiveness
functions. Custom move/ability/item code can therefore coexist with icons
without requiring the preview. Export and boot from reset.

A recognized old enemy-only 0.1.0 module updates in place. For the old combined
0.2.0 module, **Replace combined** replaces its contents with only the chosen
standalone module, preserving its existing filename. Install the other entry
separately if wanted. This avoids duplicate hooks, even for renamed DLLs and
modules already in an imported ROM. Staged standalone DLLs can be uninstalled
independently. Pokeweb cannot yet delete an original ROM file.

## DS and DSi modes

The shared HUD pointer checks use the game's independently verified native
mode getter. DS mode accepts aligned objects in the lower 4 MiB of main RAM;
DSi mode accepts the full 16 MiB. Older builds rejected valid DSi battle heaps,
so their installed hooks could run without drawing any icons or move colors.
Updating keeps the existing DLL path and the installer selections.
ROM export must also retain complete DSi programs and valid integrity tables.

## BW1 support

English US Black 1 (`IRBO`) and White 1 (`IRAO`), revision 0, have independent
native Type Icons profiles in `profile-TypeIcons-B.json` and
`profile-TypeIcons-W.json`. They record explicit ARM/Thumb entry modes,
overlay 94 hooks, BW1 panel stride and coordinates, and native resource
fingerprints. All three styles are available through the normal installer after
DS gameplay and visual acceptance in both games. The [BW1 release record](../BW1_UI_RELEASE.md)
binds support to the tested native profiles and DLL hashes; changed builds
remain disabled until accepted. Live DSi acceptance is pending.

The BW1 panel art and palette differ from BW2. In particular, BW2's renderer
reclaims colors that BW1 uses for native borders and shading. BW1 needs its
own graphics/palette ownership and style masks to preserve its HP/EXP display.
The BW1 renderer appends two 16×16 OBJ pieces and 256 transparent
character bytes to each native panel. It paints only these appended tiles,
keeps native cell attributes and palettes unchanged, and reserves OBJ palette
banks 10–15 through the native resource manager after checking its registry.
Unused retail palette memory may contain arbitrary prior colors; the module
snapshots and restores them rather than requiring a blank bank. A bank claimed
or overwritten by another runtime disables that binding. Status labels hide
the private pieces; native movement, visibility and teardown remain in charge.
BW1's angular mask uses its three white HP-face rows and two or seven gray
face rows. These placements passed the recorded DS visual matrix in both games.

```sh
python3 runtime/battle-type-hud/configure_bw1.py
python3 runtime/battle-type-hud/verify_bw1_bindings.py
python3 runtime/battle-type-hud/panel_expansion_bw1.py
python3 runtime/battle-type-hud/build.py --bw1
python3 runtime/battle-type-hud/verify_bw1_renderer.py
python3 runtime/battle-type-hud/bundle_bw1_candidates.py
```

Run these from the repository root. `BTH_B_ROM`, `BTH_W_ROM` and
`BTH_TOOLCHAIN_BIN` override local inputs. The binding verifier executes the
retail ARM mode getter, its cache and hardware-byte behavior, the nine-word
graphics proxy getter, and compiled DS/DSi pointer guards. It checks stack
and registers in both games. The renderer verifier executes the actual built
DLLs, retail palette reservation/free, fade/proxy/palette getters, effective typing and Roost, visible
source selection, and PK5 type dispatch. Gauge lifecycle and personal archive
access use instrumented fixtures, and physical palette DMA is modeled. Four layouts, six panels, fades, status,
typing changes, teardown, missing resources, palette conflicts and DS/extended
RAM pointers pass. Native image and palette bytes remain unchanged in those
fixtures. The separate DS gameplay/visual matrix is accepted; live DSi remains pending.

The center panel records explicitly map native positions 0/1 in singles and
doubles, and 2/3 in triples and rotation. Positions 4–7 retain their separate
records. This avoids treating the center gauges as missing in six-panel battles.

BW1 Move Preview has independent profiles and two separately built, DS-accepted DLLs.
The verified retail state readers cover current types, abilities, items,
condition records, field effects and native type affinity. Rotation retains
the four moves supplied by native drawing because its ordinary move array is
empty. The existing color settings and neutral fallback remain unchanged.

```sh
python3 runtime/battle-type-hud/configure_bw1_moves.py
python3 runtime/battle-type-hud/build.py --bw1-moves
python3 runtime/battle-type-hud/verify_bw1_moves.py
python3 runtime/battle-type-hud/bundle_bw1_candidates.py --moves
```

The move verifier executes retail mechanics readers in both DS and extended
RAM fixtures. Drawing, input-to-battler mapping, cached move records and Hidden
Power inputs are instrumented. Five wrappers preserve stack arguments and
registers; move glyphs, PP, custom colors, palette fades and restoration are
checked. This does not certify a complete battle session or live DSi operation.

Both BW2 games and all three icon styles pass compiled function checks with battle
objects and palette buffers in extended RAM. A supplied White 2 DSi capture
also reproduces the old pointer failure and passes pixel comparison and cleanup
with the corrected wedge DLL. These checks do not boot a game or advance frames;
emulator and hardware acceptance remains with the user.

## Type icons

The Code Injection card displays all three preview sheets. Choose the desired
style from **Icon style**. Reinstalling switches the one active Type Icons DLL
in place; multiple variants are never installed together. Imported current
builds restore the matching selection automatically.

- The lettered build uses 12×11 point-up icons with a one-pixel near-black
  outline, a type-colored center and a compact white first initial. Water uses
  the requested five-pixel-wide W. The circular build centers the approved 8×8
  white symbols and 10×10 outlined circles in the same logical footprint.
  Duplicate types collapse to one centered icon.
- **Angular HUD wedges** replace only the light checkerboard pixels at the
  panel's stair-stepped left edge. Enemy wedges begin one pixel farther left;
  the remaining perimeter and the complete drop shadow stay untouched. Regular player panels use an 11-row painted face;
  enemy and compact triple-player panels use a separate seven-row face. A dual
  type colors the upper and lower fields independently and keeps a narrow black
  divider, now one row higher. Each strip is two pixels wider. Monotypes use a
  darker shade sampled from the retail summary type labels at their angled
  edges. Dual types alternate the matching bright color with black at the seam
  and corners, producing a darker transition without borrowing HP-bar colors.
  A monotype fills across the divider.
- The lettered and circular dual icons form a 17×17 diagonal stack: the second
  icon begins five pixels right and six pixels below the first. The angular
  style stays within its compact inset footprint. Every style is drawn directly
  into the native 128×32 HUD graphics and applies to player, partner and enemy
  panels in singles, doubles and triples.
- Enemy placement is adjusted for the singles, both doubles, and all three
  triples anchors. The leftmost painted screen pixel is always x=1; the closest
  rendered name begins at least five clear pixels after the reserved icon area.
  All 649 retail English species names fit at level 100. Native name, gender and
  level callbacks still draw at their original coordinates before spacing is
  applied.
- Player singles keeps the established name shift of 12 pixels and the
  gender/level shift of eight pixels. Compact player panels use the same style
  in their existing 128×32 graphics.
- The installer retains the earlier regular-player NCGR/NCER expansion for
  upgrade compatibility: 256 transparent bytes and one transparent 32×16 OAM
  piece. Current icons paint only inside native pieces. Reinstall remains
  idempotent and staged uninstall restores native resources.
- The native 8×8 already-caught Poké Ball remains untouched in its original
  header slot. Enemy header translation begins immediately after that slot, so
  the patch does not clear, copy, redraw or validate the marker raster.
- The outline uses existing near-black index 2. Native shadow pixels using
  palette indices 4/15 become index 2; those reclaimed entries hold the two
  type colors and index 1 supplies white in the symbol styles. Angular wedges
  use the same two reclaimed entries: a monotype uses index 15 for its exact
  dark edge shade, while dual types use the two bright colors plus black
  dithering. Both dynamic entries follow the panel fade and restore at teardown.
  Live HP-bar color entries 5–12 are never changed. The
  player's separate HP-number slash receives the index-4 shadow remap,
  preventing palette color bleed.
- Native status labels hide the icons or wedges. Clearing a status redraws the
  current effective typing. Temporary type changes, Roost, Reflect Type and
  compatible Protean implementations are read from live battle state. Illusion
  uses cached disguise typing until it breaks.
- Bindings use the battler passed to gauge creation. Switching, rebinding,
  graphics reloads and resource teardown restore saved pixels before reuse.
  Six fixed records cover all visible battlers. Unchanged frames do no video
  writes. Rotation icons and Pokéstar-specific layouts remain outside this
  version; the separate rotation move-name preview is supported.

## Move colors

Damaging move names use yellow for super-effective type matchups, grayish blue
for resisted matchups, red for immunities, and their normal color otherwise. Status moves
keep their normal color. Type-neutral fixed-damage moves are not falsely marked
super effective. Hidden Power uses the attacker's IV-derived type; effective
Normalize overrides the move type.

Singles use the opposing battler. Rotation uses the opposing active battler and
refreshes when the player's move page rotates. In doubles/triples the move list
keeps its normal colors. BW2 replaces move buttons with target cards, so the
patch carries the **selected move's name above the cards** and colors it against
the currently selected enemy. Selecting an ally, confirming a spread target,
or leaving target selection restores the default color.

This is a type-matchup preview, not a full damage simulation. Weather Ball,
Natural Gift, Judgment and Techno Blast remain neutral rather than guessing
an item/weather-dependent type. Struggle stays neutral. The immunity evaluator reads current client battle state: Levitate, Air Balloon,
Magnet Rise, Telekinesis, Gravity, Smack Down, Ingrain, Iron Ball, Embargo,
Magic Room, Klutz, Gastro Acid and effective ability changes. Scrappy and
Foresight/Odor Sleuth/Miracle Eye remove their corresponding type immunities.
Mold Breaker, Turboblaze and Teravolt bypass ability immunities, never items or
temporary conditions. Water/Volt Absorb, Dry Skin, Storm Drain, Lightning Rod,
Motor Drive, Flash Fire, Sap Sipper, Soundproof, Wonder Guard and Sturdy against
OHKO moves are included. BW2's Iron Ball versus Flying dual-type ordering is
preserved. No RNG or gameplay event handlers are invoked.

The preview uses current ability/item state, even if unrevealed; typing retains
the existing Illusion disguise policy. It does not predict Protect, misses,
future switches, move redirection or other conditional move failures. Custom
ability IDs above 164 return the default color; custom behavior under existing
IDs or custom item/move mechanics requires a matching preview implementation.

The yellow is sampled from the supplied SHIFT-button lettering: RGB247/208/81,
converted to RGB555 `0x2b5e`. Grayish blue is RGB158/173/192 → `0x62b3`.
Default red is RGB255/66/66 → `0x211f`.
The input screen's existing font palette supplies unused entries 11/12/13;
no new palette bank is allocated. Native foreground pixels change color while
shadows and PP text remain intact. Both source/transfer fade buffers and the
current hardware palette are updated. The verified sub-BG fade buffer is
480 bytes, distinct from the 512-byte OBJ buffer.

## Installer color selection

The move-preview card has three color pickers and Reset colors. Choose colors
and click Install, Update or Reinstall, then export the ROM. The Type Icons
card remains independent. Colors are quantized to RGB555; reinstall/update
preserves colors read from an installed configurable build.

The installer verifies the original bundled DLL, locates its code image through
the RPM header, and edits exactly six bytes at the manifest's per-build
`colorOffset`. Version 0.4.1 has code offset 2948 (file offset 2980) in both
independently built English DLLs. `gMovePreviewColors` is an immutable-at-runtime
three-halfword table, loaded rather than compiled into immediate instructions.
No compression, recompilation, relocation changes or file-size changes are
needed. Import detection permits differences only in these RGB555 bytes and
rejects invalid bit 15, altered instructions/relocations or changed BSS size.

## Memory

Both games have the same sizes; detailed hashes are in `reports/memory-report.json`.

| Component | Letters | Circles | Angular wedges | Move Preview |
|---|---:|---:|---:|---:|
| DLL on disk | 7,856 B | 7,872 B | 7,648 B | 3,536 B |
| Code and constants | 6,880 B | 6,876 B | 6,636 B | 2,984 B |
| Fixed writable state | 364 B | 364 B | 364 B | 20 B |
| Expanded RPM metadata/padding | 980 B | 1,000 B | 1,016 B | 564 B |
| Expanded RPM allocation | 8,224 B | 8,240 B | 8,016 B | 3,568 B |
| Retained RPM allocation after internal fixups | 7,992 B | 8,008 B | 7,784 B | 3,472 B |
| Estimated PMC peak including bookkeeping | 8,344 B | 8,360 B | 8,136 B | 3,688 B |
| Estimated PMC retained including bookkeeping | 8,112 B | 8,128 B | 7,904 B | 3,592 B |

Installing Type Icons together with Move Preview totals 384 writable bytes and
approximately 11,704 retained PMC bytes for letters, 11,720 bytes for circles,
or 11,496 bytes for angular wedges. Only one icon variant is installed at a
time. Move Preview 0.4.1 adds approximately 800 retained PMC bytes compared with
Move Preview 0.3.0, with no additional fixed state. Debug DLLs have
identical executable code to release; full debug loader accounting is in the report.

The lettered and circular variants each have 476 icon-constant bytes: 396 bytes
of symbol masks, 36 bytes of RGB555 colors, and 44 bytes for fill and outline
masks. The angular variant uses 324 bytes: seven 11-row regular masks, seven
seven-row compact masks, 36 fill-color bytes and 36 retail-summary shade bytes. Exact packed native background tables add 884 bytes; no caught-marker
raster is embedded. Six 60-byte records use 24-byte background buffers. A
lettered or circular dual stack backs up 144 variable pixels in 18 bytes; the
angular build backs up at most 77 painted checker-face pixels in ten bytes. The remaining
record bytes hold the native-header checksum, spare bytes and text shifts. Header translation uses a 64-byte row on
the stack. Icon diagnostics occupy four bytes; the separate move UI module uses
20 bytes, for exactly 384 writable bytes when both are installed. The largest
individual compiler-reported stack frame remains 568 bytes, including the
move-preview glyph copy during a screen transition.

The per-module PMC bookkeeping estimate is 36 bytes of module state, two 8-byte lists,
four 16-byte allocator headers and four alignment bytes. Other installed
modules and fragmentation require additional headroom. No heap is resized.
The recorded Cascade/scanner build is rejected for its known insufficient
capacity; non-Cascade ROMs are the intended current test targets.

**Added battle-heap allocations: 0. Added sprites: 0. Added palette banks: 0.
Added graphics VRAM: 256 bytes per regular player panel (512 bytes in doubles).**
The existing NCGR load buffer temporarily grows by 256 bytes; the retained
NCER payload grows by eight bytes per regular player panel (allocator rounding
is separate). The same allocations and sprite objects are reused. One extra
hardware OAM piece is emitted per regular player panel; compact/triple panels
use their existing resources. Existing image proxies locate OBJ graphics;
no hardcoded spare VRAM is reserved. Move text uses the existing 256×96 RAM
bitmap and native transfer routine. Metadata is cached on native move-page
creation; unchanged frames have no move-data queries or bitmap transfers.
Active panel images are hashed to detect native refreshes, and only changed
icons are redrawn. No hardware frame-time benchmark has been made.

## Compatibility and build

Pokeweb and `compatibility.py` use independent profiles: Type Icons checks
24 native function/position-table signature windows, 17 hooks and 20 panel resources (members
430–446 and 456–458 of a/0/1/1). Move Preview checks 22 functions and five input hooks, with its
text bitmap/palette validated at runtime. Together the profiles use 40 distinct
native functions plus two coordinate tables. Panel asset changes do not block the move-only installer. Installed DLL relocation ranges, including possible
PMC veneers, are checked for collisions. The scanner's W2 hooks at
0x021EA53C/0x021EA54E do not overlap. Unknown native code, graphics, duplicate
HUD modules, or overlapping hooks fail before staging the patch.

Each module is tied to overlay 168: 17 icon relocations and five move relocations. Native ARM9/167 routines are
called through verified function addresses without permanent-residency imports.
Original calls remain intact; wrappers preserve callee-saved registers, return
values and stack arguments. B2 addresses are independently located with unique
instruction signatures, not derived from a blanket W2 offset. Exact addresses
and bytes are in `profile-TypeIcons-*.json` and `profile-MoveEffectiveness-*.json`.

The drawing and packaging approach follows the existing scanner patch's
halfword-safe direct-video drawing and PMC packaging.

Requirements: Python 3 plus `requirements.txt`, ARM GNU `arm-none-eabi` tools,
Java/Javac and a CTRMap.jar containing RPMTool. Tested with ARM GNU 14.2.Rel1.
From this directory:

```sh
python -m pip install -r requirements.txt
export BTH_TOOLCHAIN_BIN=/path/to/arm-none-eabi/bin
export BTH_CTRMAP_JAR=/path/to/CTRMap.jar
python build.py
```

Checked-in generated address/hook headers permit building without ROM files.
To regenerate profiles and private test fixtures, set `BTH_B2_ROM` and
`BTH_W2_ROM` to matching clean English ROMs, then run `configure.py`, `build.py`,
`verify.py`, `verify_layout.py`, `verify_enemy_names.py`, `verify_moves.py`, and `verify_dsi.py`. `verify.py` and `compatibility_tests.py` also
use `BTH_CASCADE_ROM` for the recorded scanner/Fairy reference. These scripts
never modify source ROMs. `verify_dst.py CAPTURE.dst OLD_0.3.2.dll [NEW.dll]`
reproduces the reported missing enemy against the supplied captured memory,
then verifies the corrected Electric icon and unchanged unrelated RAM/graphics.
`verify_layout.py CAPTURE.dst OLD_0.3.6.dll` additionally checks player singles
alignment against the captured native name and OAM pieces with both new DLLs.
It runs only compiled function fixtures, without booting a game or executing
frames, and never writes the capture. Raw memory is not included in packages.
`verify_mln.py CAPTURE.mln OLD.dll [NEW.dll]` checks a melonDS v14 White 2 DSi
battle capture, executes the native readers, and compares old/fixed wedge
drawing without advancing the game. `verify_dsi.py` covers both games' native
mode getters, pointer boundaries, extended-RAM icon objects and cleanup.
The standalone conservative `install.py INPUT OUTPUT --component icons` (or `--component moves`)
requires PMC and refuses to overwrite output or accept unverified ROM tails.

In Pokeweb, `npm run typehud:build` builds the runtime source snapshot;
`npm run typehud:sync` verifies/copies builds into the catalog after the native
fixture checks; `npm run typehud:verify-rom -- ROM...` exercises installation,
export, reimport and staged uninstall. The canonical build and verification
inputs are in `runtime/battle-type-hud/`.

Debug DLLs retain symbols and have identical executable code. Inspect
`gBattleTypeHud`: six 60-byte records, sticky failure at +360, wrapping binding
count at +361, and wrapping 16-bit redraw count at +362.
Within each icon record, flags occupy byte +56, palette bank +57,
full battler ID +58; byte +59 holds layout in its low two bits and the detected
name origin in its high six bits. `gBattleMoveHud` is
20 bytes, with a sticky failure byte at +19. Failure codes are 1 bad pointer, 2 unsupported panel, 3 graphics
mapping, 4 palette, 5 shared graphics/palette, 6 type ID, 7 text bitmap and
8 occupied text palette slots. Runtime failures stop unsupported drawing;
there is no allocated in-game error dialog.

Red immunity highlighting and installer color customization are implemented
in Move Preview 0.4.0. `IMMUNITY_FEASIBILITY.md` preserves the earlier assessment.
See `VALIDATION.md` for automated checks, scoped BW1 gameplay evidence and
the remaining release checklist. Fairy at
ID17 is included for compatible ROMs with Fairy support; this patch does not
add Fairy mechanics, change save formats, or change damage calculations.
