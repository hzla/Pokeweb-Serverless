# Type Icons and Move Effectiveness Preview

Bundle 0.4.16 (Type Icons 0.3.16; Move Preview 0.4.0) for English Black 2 (IREO) and White 2 (IRDO).
Pokeweb's **Code Injection** page has two independent entries:

- **Type Icons** → `TypeIconsB2.dll` / `TypeIconsW2.dll`.
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

## Type icons

- Player, partner and enemy panels in singles, doubles and triples use 12×11
  point-up rhombuses with a one-pixel near-black outline, a type-colored center
  and a compact white first initial. Four shoulder pixels complete the black
  enclosure around the color fill. Every initial is lowered one pixel and has a full row of color beneath it; Water
  uses the requested five-pixel-wide W. Duplicate types collapse to one centered rhombus.
- Dual types form a 17×17 diagonal stack: the second rhombus begins five pixels
  right and six pixels below the first. The stack overlaps the left edge of
  the existing HUD graphics. It is painted in the native 128×32 image, so all
  corners outside each rhombus preserve the pixels beneath them.
- Enemy placement is adjusted for the singles, both doubles, and all three
  triples anchors. The leftmost painted screen pixel is always x=1; the closest
  rendered name begins at least five clear pixels after the stack. All 649
  retail English species names fit at level 100. Native name, gender, and level
  callbacks still draw at their original coordinates before spacing is applied.
- Player singles keeps the established name shift of 12 pixels and the
  gender/level shift of eight pixels. The dual stack begins at sprite-local
  (-64,-1) and (-59,5); a monotype begins at (-62,1), one pixel above its former position. Compact player panels use
  the same diagonal geometry in their existing 128×32 graphics.
- The installer retains the earlier regular-player NCGR/NCER expansion for
  upgrade compatibility: 256 transparent bytes and one transparent 32×16 OAM
  piece. The rhombuses themselves now paint only inside the native pieces.
  Reinstall remains idempotent and staged uninstall restores native resources.
- The native 8×8 already-caught Poké Ball remains untouched in its original
  header slot. Enemy header translation begins immediately after that slot, so
  the patch no longer clears, copies, redraws, or validates the marker raster.
- The outline uses existing near-black index 2. Native shadow pixels using
  palette indices 4/15 become index 2; those reclaimed entries hold the two
  type colors and index 1 supplies white. The player's separate HP-number slash
  receives the same shadow remap, preventing palette color bleed.
- Native status labels hide the rhombuses. Clearing a status redraws the current
  effective typing. Temporary type changes, Roost, Reflect Type, and compatible
  Protean implementations are read from live battle state. Illusion uses cached
  disguise typing until it breaks.
- Bindings use the battler passed to gauge creation. Switching, rebinding,
  graphics reloads, and resource teardown restore saved pixels before reuse.
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
`colorOffset`. Version 0.4.0 has code offset 2912 (file offset 2944) in both
independently built English DLLs. `gMovePreviewColors` is an immutable-at-runtime
three-halfword table, loaded rather than compiled into immediate instructions.
No compression, recompilation, relocation changes or file-size changes are
needed. Import detection permits differences only in these RGB555 bytes and
rejects invalid bit 15, altered instructions/relocations or changed BSS size.

## Memory

Both games have the same sizes; detailed hashes are in `reports/memory-report.json`.

| Component | Type Icons release | Move Preview release |
|---|---:|---:|
| DLL on disk | 7,824 B | 3,504 B |
| Code and constants | 6,840 B | 2,948 B |
| Fixed writable state | 364 B | 20 B |
| Expanded RPM metadata/padding | 988 B | 568 B |
| Expanded RPM allocation | 8,192 B | 3,536 B |
| Retained RPM allocation after internal fixups | 7,960 B | 3,440 B |
| Estimated PMC peak including bookkeeping | 8,312 B | 3,656 B |
| Estimated PMC retained including bookkeeping | 8,080 B | 3,560 B |

Installing both totals 384 writable bytes and approximately 11,640 retained
PMC bytes. Move Preview 0.4.0 adds approximately 768 retained PMC bytes compared with
Move Preview 0.3.0, with no additional fixed state. Debug DLLs have
identical executable code to release; full debug loader accounting is in the report.

The 476 icon-constant bytes comprise 396 bytes of initial masks, 36 bytes
of RGB555 colors, and 44 bytes for the fill and outline masks. Exact packed
native background tables add 884 bytes; no caught-marker raster is embedded.
Six 60-byte records use 24-byte background buffers. A dual stack backs up 144 variable
covered pixels in 18 bytes; the added center row and four shoulder pixels per rhombus restore
from the exact native background table, leaving six bytes for the native-header checksum,
a spare byte, and text shifts. Header translation uses a 64-byte row on
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
23 native function/position-table signature windows, 17 hooks and 20 panel resources (members
430–446 and 456–458 of a/0/1/1). Move Preview checks 21 functions and five input hooks, with its
text bitmap/palette validated at runtime. Together the profiles use 39 distinct
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

Source provenance: REDACTED_REFERENCE `prog/src/battle/btlv/btlv_gauge.c`,
`btlv_input.c`, battle typing and move-data routines, plus the existing scanner
patch's halfword-safe direct-video drawing and PMC packaging approach.

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
`verify.py`, `verify_layout.py`, `verify_enemy_names.py`, and `verify_moves.py`. `verify.py` and `compatibility_tests.py` also
use `BTH_CASCADE_ROM` for the recorded scanner/Fairy reference. These scripts
never modify source ROMs. `verify_dst.py CAPTURE.dst OLD_0.3.2.dll [NEW.dll]`
reproduces the reported missing enemy against the supplied captured memory,
then verifies the corrected Electric icon and unchanged unrelated RAM/graphics.
`verify_layout.py CAPTURE.dst OLD_0.3.6.dll` additionally checks player singles
alignment against the captured native name and OAM pieces with both new DLLs.
It runs only compiled function fixtures, without booting a game or executing
frames, and never writes the capture. Raw memory is not included in packages.
The standalone conservative `install.py INPUT OUTPUT --component icons` (or `--component moves`)
requires PMC and refuses to overwrite output or accept unverified ROM tails.

In Pokeweb, `npm run typehud:build` builds the runtime source snapshot;
`npm run typehud:sync` verifies/copies builds into the catalog after the native
fixture checks; `npm run typehud:verify-rom -- ROM...` exercises installation,
export, reimport and staged uninstall. `sync_bundled.py` run from the canonical
`work/battle-type-hud/` directory also refreshes the runtime source snapshot.

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
See `VALIDATION.md` for completed automated checks. In-game emulator testing is
left to the user, per their preference. Fairy at
ID17 is included for compatible ROMs with Fairy support; this patch does not
add Fairy mechanics, change save formats, or change damage calculations.
