# Type Icons and Move Effectiveness Preview

Bundle 0.4.9 (Type Icons 0.3.9; Move Preview 0.4.0) for English Black 2 (IREO) and White 2 (IRDO).
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

- Player, partner and enemy panels in singles, doubles and triples use the
  approved 8×8 glyphs inside a one-pixel exterior outline: 10×10 overall.
  Duplicate types collapse to one icon. Two icons occupy 21×10,
  including a one-pixel gap between their outlines.
- Enemy icons sit before the name, with their bottom outline aligned to the
  name border. At resting singles/doubles/triples positions, dual icons leave
  at least one pixel at the left screen edge, one between icons and one before
  the name. Monotypes align nearest the name. The name moves right only as
  needed; gender/level move only when necessary to retain a clear text gap.
  All 649 retail English species names fit, including level 100. The widest
  names advance 50 pixels in the native battle font. No glyphs are shortened.
- Enemy icons and shifted text reuse the native 128x16 header inside its
  existing two pieces; no enemy resource, VRAM or OAM expansion is needed.
  The lower panel and HP bar retain their native positions and pixels.
  Native name/gender/level hooks restore original text coordinates before
  drawing, then apply the new spacing. Unsupported overflowing text fails
  before translation. Normal panel entrance/movement animations are retained.
- Compact player icons retain (-53,0)/(-42,0), or (-48,0) for a monotype;
  regular doubles player icons retain y=-2 and centered monotypes.
- Player singles icons now sit immediately left of the name at y=-10. Their
  bottom outline aligns with the native name border at y=-1. The
  21x10 dual pair leaves two clear pixels before the rendered name; a monotype
  is right-aligned in that space. Native short/long name indents are detected
  from their pixels. Relative to 0.3.8, player singles name and icons move
  12 pixels right, while gender and all level graphics move eight pixels
  right. Their vertical positions and the HP/EXP panel remain unchanged.
  Native text callbacks receive the original coordinates before translation.
- The installer expands regular-player NCGR member 438 by 256 transparent
  bytes and NCER member 439 by eight bytes. One 32x16 OAM piece at (-68,-12)
  expands the sprite boundary leftward. Doubles shares those resources but
  leaves the added piece transparent. The original pieces and art are intact.
  Pokeweb and install.py apply the matching resource edits; installing only
  this DLL into an unexpanded ROM suppresses player icons with failure 2.
  Reinstall is idempotent; the verified older expansion at (-80,-12) migrates
  in place. Staged uninstall restores the native resources.
- Doubles/triples player name and level graphics retain their original positions. Icons paint over
  overlapping name pixels on the existing doubles layout. A name-redraw hook restores the saved text before
  the native draw, then paints icons last. The backup preserves letters and
  shadows so status labels can hide the entire icon without erasing the name.
  The static Lv. shape requirement is removed.
- Corners outside the outlined circle and the gap preserve the native panel.
  The outline uses existing near-black index 2 (RGB555 0x0842). Native shadow
  pixels using palette indices 4/15 become index 2; the reclaimed entries hold
  type colors, and index 1 supplies white.
- The player's HP-number sprite shares that palette. Its slash's index-4 shadow is also
  remapped to index 2, fixing color bleed. White/gray slash strokes and all digit
  tiles stay intact. Independent number-image reloads are detected. Enemy
  icons do not require an HP-number sprite or validate its unused image.
- Native status labels hide the icons. Clearing a status restores current
  typing. The native effective-type helper includes temporary changes and
  Roost and Reflect Type; custom Protean works when it updates the normal client
  battle-type fields. Illusion uses cached disguise typing until it breaks.
- Bindings come from the battler passed to gauge creation. Removal, rebinding,
  native graphics reloads and resource teardown are intercepted. Six fixed
  records cover all battlers; the existing sprites retain movement and fades.
  Version 0.3.3 retains the full native battler ID byte: client/party IDs are
  independent of panel position. The previous three-bit field truncated enemy
  ID 12 to 4, clearing its binding before drawing. Existing record padding
  accommodates the full ID without adding writable state.
- Rotation **icons** and Pokéstar-specific layouts remain outside this version.
  The separate rotation move-name preview is supported.

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
| DLL on disk | 7,008 B | 3,504 B |
| Code and constants | 6,064 B | 2,948 B |
| Fixed writable state | 364 B | 20 B |
| Expanded RPM metadata/padding | 948 B | 568 B |
| Expanded RPM allocation | 7,376 B | 3,536 B |
| Retained RPM allocation after internal fixups | 7,176 B | 3,440 B |
| Estimated PMC peak including bookkeeping | 7,496 B | 3,656 B |
| Estimated PMC retained including bookkeeping | 7,296 B | 3,560 B |

Installing both totals 384 writable bytes and approximately 10,856 retained
PMC bytes. Move Preview 0.4.0 adds approximately 768 retained PMC bytes compared with
Move Preview 0.3.0, with no additional fixed state. Debug DLLs have
identical executable code to release; full debug loader accounting is in the report.

The original 188 icon-constant bytes comprise 144 symbol bytes, 36 RGB555 color
bytes and an 8-byte shared circle. The exterior outline adds 20 constant bytes.
There are also 212 bytes of verified panel-background patterns. Six 60-byte
records use 24-byte background buffers. Only covered pixels need backing up:
one bit per panel pixel, two bits for overlapping name pixels. The largest
dual-icon backup uses 172 bits (22 bytes). Enemy and player singles transparent backgrounds need
no saved pixels; their existing buffer stores a native-header checksum and two
shift bytes instead. Header translation uses a 64-byte temporary row on the
stack (112-byte compiler-reported function frame). Packed flags keep the
state size unchanged. Icon diagnostics occupy four bytes; the separate move UI
module occupies 20, making exactly 384 writable bytes when both are installed. The largest individual
compiler-reported stack frame is 568 bytes, including the temporary 512-byte
2bpp glyph copy during a screen transition. Native/nested stack use is separate.

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
full battler ID +58; byte +59 holds layout in its low two bits and the singles
icon origin in its high six bits (player singles and all enemy layouts). `gBattleMoveHud` is
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
