# Validation — selectable Type Icons / bundle 0.4.23

Pokeweb bundles lettered Type Icons 0.3.17, Circular Icons 0.3.17-circular,
and Angular HUD Wedges 0.3.23-solid for both English B2 and W2. The Type Icons
card displays all three preview sheets and one selector chooses the DLL installed
at the existing Type Icons path. Export, reimport, detection, reinstall, and
switching among all three retain one icon module and one set of hooks.

The angular build widens each native-face strip by two pixels. Its 11-row
regular-player mask and seven-row enemy/compact-player mask follow each panel's
own stair steps. Enemy masks retain their one-pixel left adjustment. Dual types
retain a black diagonal divider one row above the prior position. Monotypes use
the retail summary-label dark shade at their angled edges; dual transitions
dither the matching type fill with black. This preserves the darkened edge and
corner treatment without writing the live HP-bar palette. Monotypes fill across the divider. Black pixels outside the
exact mask, the bottom shadow and the caught Poké Ball remain byte-identical.

Angular-wedge compiled-ARM checks cover all 18 fill/shade pairs, mono and dual rendering, every
player and enemy panel slot, all six statuses, live mono-to-dual changes,
two-entry palette fading, byte-exact preservation of HP-bar entries 5–12,
unchanged-frame write suppression, native
caught-marker preservation, and exact teardown in B2 and W2.

The angular-wedge DLL is 7,600 bytes with about 7,856 retained PMC bytes. It
retains 364 bytes of fixed state and adds no battle-heap allocations, sprites, palette
banks, or separate graphics allocations. No game boot or emulator frames were
executed.

# Historical validation — Type Icons 0.3.16 / bundle 0.4.16

The caught Poké Ball remains at its native 8×8 enemy-header coordinates and is
never cleared, copied, or repainted by the patch. Enemy text translation starts
at x=16, directly after the x=8..15 marker slot. The runtime layout guard checks
the unused x=0..7 region while accepting either native caught state.

Compiled B2/W2 ARM checks preserve the marker byte for byte through gauge
creation, all six status labels, native image reloads, unchanged updates, and
teardown across singles, doubles, and triples. All taller-rhombus, effective
type, Illusion, fade, palette, overlap restoration, and 649-name geometry checks
also pass. Installer compatibility checks pass. No game boot or emulator frames
were executed.

The release DLLs are 7,824 bytes each with 6,840 bytes of code/constants, 364
bytes of writable state, and approximately 8,080 bytes of retained PMC storage
including bookkeeping. The removed marker handling saves 416 retained bytes and
eliminates the 32-byte embedded marker raster. No battle-heap allocations,
sprites, palette banks, or additional graphics allocations were introduced.

# Historical validation — Type Icons 0.3.15 / bundle 0.4.15

Every point-up rhombus is now 12×11. Its added row supplies type-colored padding
beneath each lowered white initial while the 88-pixel near-black outline fully
encloses the fill. Dual icons use offsets (0,0) and (5,6), retaining a 17×17
combined footprint. A monotype retains its centered, one-pixel-raised position.

The added center row and four shoulder pixels per icon restore from the exact
native background table. The remaining 72 pixels per icon retain the one-bit
backup, so two icons still require 18 bytes and writable state remains 364 bytes.
The painter explicitly compares the second icon with live graphics at overlap
pixels, ensuring its border covers the first icon even where black equals the
native background.

Compiled B2/W2 ARM checks pass for all 18 types, mono/dual drawing, overlapping
paint and restoration, six HUD positions, status transitions, typing changes,
Illusion, fades, image reloads, and teardown. OAM composition and all 649 retail
name measurements pass. Installer compatibility checks pass. No game boot or
emulator frames were executed.

# Historical validation — Type Icons 0.3.14 / bundle 0.4.14

Four black shoulder pixels were added to every 12×10 rhombus at local positions
(3,1), (8,1), (3,8), and (8,8). They close the only gaps directly above and
below the widest colored corner pixels, increasing the visible outline from 72
to 76 pixels. The white initials move down one pixel. Monotype icons move up one
pixel as a whole; dual icon coordinates are unchanged.

The four new outline pixels restore from the exact native background table. The
remaining 72 pixels per rhombus retain the existing one-bit backup, so two icons
still require 18 bytes and writable state remains 364 bytes.

Compiled B2/W2 ARM checks pass for all 18 types, mono/dual drawing, six HUD
positions, status transitions, typing changes, Illusion, fades, image reloads,
and teardown. OAM composition and all 649 retail-name measurements pass. No
game boot or emulator frames were executed.

# Historical validation — Type Icons 0.3.13 / bundle 0.4.13

Type icons now use a 12×10 point-up rhombus, a compact white first initial, and
the existing per-type colors. The Water initial is the requested five-pixel W:
`10001 / 10001 / 10101 / 10101 / 01010`. Each outline covers 72 pixels. Dual
types use two 72-pixel backups and form a 17×17 stack at offsets (0,0) and
(5,7); monotypes use the centered offset (2,3).

Compiled B2/W2 ARM checks cover all 18 IDs, mono and dual types, all six visible
panel positions, status hide/restore, live type changes, Illusion, fades,
rebindings, image reloads, the caught marker, HP slash protection, and teardown.
Native OAM composition confirms the whole stack is within existing 128×32
pieces. The enemy layout matrix measures all 649 English species names in the
retail font: the left screen margin is one pixel and the minimum clear name gap
is five pixels in singles, doubles, and triples.

The release DLLs are 8,160 bytes each with 7,172 bytes of code/constants, 364
bytes of writable state, and approximately 8,416 bytes of retained PMC storage
including bookkeeping. There are no battle-heap allocations, new sprite
objects, or new palette banks. The previous 256-byte transparent regular-player
expansion is retained for installer upgrade compatibility but is not used by
the new rhombus pixels.

No game boot or emulator frames were executed. The user performs final visual
and animation testing.

# Historical validation — Type Icons 0.3.12 / bundle 0.4.12

Type icons now use a point-up hexagonal silhouette in the same 10x10 footprint.
The colored 8x8 mask changes only its top and bottom rows from four pixels to
two; those rows contain no symbol ink in any of the 18 approved glyphs. The
one-pixel exterior outline changes with the mask, while icon colors, symbols,
spacing, coordinates and transparent corners remain unchanged.

The new outline covers 72 rather than 76 pixels per icon. Backup indexing was
updated and its largest dual-icon requirement falls from 172 bits to 160 bits,
still inside the existing 24-byte record buffer. Writable state, graphics VRAM,
sprite count, palette use and allocation behavior are unchanged.

Compiled B2/W2 checks cover all 18 mono/dual icons, every panel layout, status
restoration, native text overlap, caught marker, type changes, fades, reloads
and teardown. Installer upgrades and the production build pass. No game boot
or frames were executed. The complete circular implementation remains in
`dist/BattleHudPatches-Circular-0.4.11.zip` and the original versioned archive.

# Historical validation — Type Icons 0.3.11 / bundle 0.4.11

The relocated caught Poké Ball moves down exactly one DS pixel, from texture
y=17 to y=18. Its x position, 8x8 native pixels, palette, type-icon placement,
text positions and HP panel remain unchanged. The nontransparent art now spans
rows 18–24 inside the verified lower-panel region; its transparent final row
remains at y=25.

Compiled B2/W2 placement, all status states, full graphics reload and exact
teardown restoration pass. Installer upgrade and production build checks also
pass. No game boot or frames were executed.

# Historical validation — Type Icons 0.3.10 / bundle 0.4.10

The native already-caught Poké Ball now occupies the center of the former
lower-panel monotype position while enemy type icons remain beside the name.
The game-provided marker is 8x8: its near-black outline encloses a red/white
interior no wider than six pixels, so no resampling or palette change is needed.

- Compiled B2 and W2 checks identify the exact native marker in gauge-parts
  member 434, move only its nontransparent pixels, and preserve the patterned
  panel beneath its transparent corners.
- Singles, doubles and triples retain the marker with mono/dual type icons.
  All six status labels hide the type icons while leaving the caught marker
  visible. Full graphics reloads relocate it again, and panel removal restores
  both the lower-panel background and the native marker tile byte for byte.
- Existing type, header, name-width, OAM, captured-state, HP slash, palette,
  Illusion, lifecycle and compatibility checks pass. Move Preview 0.4.0 remains
  byte-identical.

Writable state remains 364 bytes. The release DLL is 7,536 bytes, with 6,576
bytes of code/constants and an estimated 7,808 retained PMC bytes including
bookkeeping. This adds no graphics VRAM, sprites, palette banks, or battle-heap
allocations. The 32-byte native marker raster is the only new art constant.

No game boot or frames were executed. ROMs and supplied states were read only;
final appearance and animation testing remain with the user.

# Historical validation — Type Icons 0.3.9 / bundle 0.4.9

Player singles name and type icons move 12 pixels right; gender and level
move eight pixels right. Vertical alignment, HP/EXP panel and other layouts
retain their preceding positions. The appended OAM piece moves from (-80,-12)
to (-68,-12), keeping its existing image, tiles and allocation sizes.

- Both compiled ARM DLLs pass exact pixel comparisons for native header
  translation, unchanged lower panel, status hiding/restoration, rebinding,
  text updates, full/partial image reloads and removal without drift.
- Native OAM composition verifies both icon sizes and native name indents,
  transparent corners, a two-pixel name gap and unchanged bottom alignment.
  The supplied player save state supplies real name, level and OAM pixels;
  the missing-enemy capture still passes independently.
- All 649 retail species names fit the player singles header with Lv.100.
  The existing enemy-name matrix, all type IDs, effective typing, Illusion,
  fades, HP slash and 17-hook register/stack checks continue to pass.
- Installer resource edits accept exact native, current and prior expanded
  hashes. Previous NCERs migrate to the new position; repeated install is
  idempotent, unknown edits fail, and staged uninstall restores native assets.
  Real clean B2/W2 ROM roundtrips include importing/upgrading 0.3.8 DLLs and
  their prior resource expansion, preserving every unrelated archive member.
- All 30 focused installer/resource tests and the production build pass.
  Move Preview remains byte-identical to 0.4.0. Scanner hook checks pass.

Release DLL: 7,008 bytes; code/constants: 6,064; fixed writable state: 364;
RPM metadata/padding: 948; estimated retained PMC storage: 7,296 bytes.
This adds 112 retained PMC bytes versus 0.3.8 and no graphics memory or
allocation sites. Header translation uses a 64-byte temporary row on the
stack, with a 112-byte compiler-reported function frame.

No game boot or frames were executed. ROMs and supplied states were read
only; the user handles final in-game appearance and animation testing.
The standalone installer report remains historical 0.3.4 evidence.

# Historical validation — Type Icons 0.3.8 / bundle 0.4.8

Enemy icons move to the left of the name in singles, doubles and triples.
The resting left screen margin, inter-icon gap and name gap are each at least
one pixel. Bottom borders align at panel-relative y=-1. Native player singles
alignment is unchanged. The lower enemy panel and HP bar do not move.

- `verify_enemy_names.py` decodes the actual English retail name bank and
  battle font in both games. All 649 species names fit every enemy anchor with
  level 100. Widest names advance 50 pixels. The measured minimum margins are
  one pixel at the screen edge and one before the name; nothing is truncated.
- Both compiled DLLs pass mono/dual fixtures with the widest names and short
  names across all six singles/doubles/triples positions. Native name, gender
  and level updates receive unshifted graphics; their output is then spaced
  again. Switching/removal restores every native header pixel without drift.
  In-place image reloads recover, and unchanged updates perform no writes.
- All existing compiled ARM, status, effective-type, Illusion, palette, HP slash,
  lifecycle and register/stack preservation checks pass. The captured missing
  enemy regression now verifies the icon before the actual captured name.
  The captured player alignment regression still matches both bottom borders.
- B2 and W2 independently match the three new text-update call sites plus
  native position routine and coordinate-table signatures. All 17 icon hooks
  remain in overlay 168. Scanner collision and unknown-code/resource checks
  pass. Move Preview remains byte-identical to 0.4.0.
- All 28 installer/resource tests and the production build pass. An imported
  0.3.7 module upgrades in place while preserving customized move colors.
  Clean B2/W2 installation, export, reimport, repeat install and staged
  uninstall pass; every unrelated archive member stays unchanged. The separate
  standalone installer report remains historical 0.3.4 evidence.

No added enemy graphics memory, OAM pieces, sprite objects, palette banks or
battle-heap allocation calls. Existing fixed state stays 364 bytes. Header
translation temporarily uses 64 bytes on the stack (104-byte function frame).
Release DLL: 6,896 bytes; code/constants: 5,944; RPM metadata/padding: 956;
estimated retained PMC storage including bookkeeping: 7,184 bytes. Existing
player resource growth remains 256 bytes per regular player panel.

No game was booted or frames executed; source ROMs and save states were read
only. Final appearance and animation testing remain with the user.

# Historical validation — Type Icons 0.3.7 / bundle 0.4.7

The supplied 20:09:16 save state contains the exact relocated 0.3.6 DLL.
Its native Gengar name border is at panel-relative y=-1; the icon outline
ends at y=0. Move the player singles icons up one pixel, to y=-10, so both
bottom borders end at -1. The 0.3.6 screenshot-only assessment below was wrong.
The earlier apparent two-pixel change cannot be established from this state.

`verify_layout.py CAPTURE.dst OLD_0.3.6.dll` measures the captured native
name and all three OAM pieces, then checks mono and dual icons with both
new compiled DLLs against those actual graphics. Both bottom borders match.
Native pixels are preserved, all six status labels restore cleanly, and
unchanged updates perform no writes. The normal layout fixtures now also
assert matching bottom borders, including native row-15 shadows.

Both English builds pass the compiled ARM fixtures and captured enemy
regression. No game was booted or frames executed, and the user's save state
was read only. Move Preview stays 0.4.0. Resource expansion, horizontal
placement, other layouts and memory requirements are unchanged.

All 27 focused installer/resource tests and the production build pass.
Release: 5,568-byte DLL; 4,720 code/constants; 364 fixed writable bytes;
5,880 estimated retained PMC bytes. Existing graphics allocation is unchanged.

The full ROM roundtrip and standalone-installer reports remain historical
0.3.4 evidence for the unchanged installer/resource expansion.

# Historical validation — Type Icons 0.3.6 / bundle 0.4.6

Player singles icons move down one more pixel, from panel-relative y=-10 to
-9, to align their bottom outline with the name border in the supplied image.
The horizontal position and existing NCGR/NCER expansion remain unchanged.
Move Preview remains 0.4.0. No in-game emulator session was run.

Both English builds pass compiled ARM, native OAM composition and captured
enemy regression checks. The lower position has no native panel overlap. All
27 focused installer/resource cases and the production build pass. Full ROM
roundtrip and standalone-installer reports remain the 0.3.4 evidence for the
unchanged installer/resource expansion.

Release: 5,568-byte DLL; 4,720 code/constants; 364 fixed state; 5,880 estimated
retained PMC bytes. Graphics allocation and existing sprite layout are unchanged.

# Historical validation — Type Icons 0.3.5 / bundle 0.4.5

Player singles icons move down one pixel, from panel-relative y=-11 to y=-10.
This changes only the draw position within the existing expanded sprite. The
NCGR/NCER resource patch, horizontal placement, other layouts and memory
requirements remain as in 0.3.4. Move Preview remains 0.4.0.

Both English builds pass the existing compiled ARM and native OAM composition
checks, plus the captured enemy regression. All 27 focused installer/resource
cases and the production build pass. No in-game emulator session was run.
The full ROM roundtrip and standalone-installer reports are retained from
0.3.4; the installer and resource expansion are unchanged.

Release: 5,568-byte DLL, 4,720 bytes code/constants, 364 bytes fixed state,
5,880 estimated retained PMC bytes. Existing graphics allocation is unchanged.

# Historical validation — Type Icons 0.3.4 / bundle 0.4.4

No in-game emulator session was run. Final visual testing remains with the user.

- Player singles icons now render immediately left of the native name. A 21x10
  dual group leaves two pixels before the name; monotypes align nearest the
  name. Short/long native indents are handled without moving name or level.
- Static native OAM composition checks pass for both games: no clipped glyphs,
  all original name/panel/HP/EXP pixels preserved, transparent corners, all six
  status transitions and removal restore the exact native composition. Doubles
  leaves the appended image transparent and retains its original icon position.
- The compiled ARM fixtures still pass all 18 types, full battler IDs, all
  layouts, six simultaneous panels, HP slash, fades, live typing, Illusion,
  Roost, rebinding, name redraw and all 14 hook ABI checks. The current-cell
  pointer path (CLWK+0x68, animation+0x0c, current cell+0x30) is independently
  matched in B2 and W2 by three added signature windows; no new hooks/imports.
- An unexpanded or mismatched player NCER fails before any graphics write.
  Exact original and expanded NCGR/NCER hashes are accepted; mutations fail.
  Scanner collision checks remain clear. Move Preview stays byte-identical.
- Pokeweb verifies both resource changes before mutation, stages them with the
  DLL, accepts a repeated install and restores native resources on staged
  uninstall. Clean B2/W2 export/reimport tests compare every archive member.

- Full application suite: 116 files, 1,042 passing tests and one skipped.
  Production build passes with the existing chunk-size advisory. The 25
  installer cases include an imported 0.3.3 upgrade with move colors retained;
  two extra resource tests verify the reversible expansion.

Release accounting: 5,584-byte DLL, 4,724 code/constants, 364 writable state,
5,896 estimated retained PMC bytes. Existing regular-player graphics grow by
256 bytes each (512 in doubles); NCER payload grows by eight bytes per panel.
No extra allocation sites, sprite objects or palette banks; one additional
hardware OAM piece per regular player panel. NCGR load-buffer growth and
allocator rounding are separate from retained PMC storage. See memory and
layout reports for scope; this is not a live allocation/animation benchmark.

# Historical validation — Type Icons 0.3.3 / bundle 0.4.3

No in-game emulator session was run. The supplied save state was read only;
compiled function fixtures do not boot a game or execute frames.

- The supplied capture contains the exact released 0.3.2 instructions after
  PMC relocation. Its enemy has native battler ID 12; the patch saved 4 in a
  three-bit field and discarded the binding before reaching graphics lookup.
  The previous fixtures used IDs below 8 and did not detect this error.
- Full-byte IDs now occupy existing record padding. Both B2 and W2 compiled
  binaries pass creation/unchanged-update tests for all 24 client/party IDs,
  independently of HUD position. Six simultaneous panels include partner and
  enemy client IDs above 7. Changed-identity invalidation still passes.
- `verify_dst.py` reproduces the old failure and verifies the corrected mono
  Electric icon against the captured enemy gauge. Actual native image, palette,
  disguise and effective-type getters run against captured RAM. Gauge creation
  and Main are instrumented no-ops because the panel already exists.
- The expected 10x10 icon and palette colors match exactly. The player's
  existing icon/HP slash and all other OBJ graphics remain unchanged. The only
  changes to captured game RAM are the two source and two transfer palette
  entries. Unchanged updates perform no video writes. Raw captured memory is
  excluded from bundled artifacts.
- Both games pass the existing all-type, layout, status, name overlap, HP slash,
  fade, Illusion, Roost, teardown and hook ABI checks. Compatibility and scanner
  collision checks pass. Move Preview remains byte-identical to 0.4.0.
- All 24 installer cases pass, including imported 0.3.2 upgrades with custom
  move colors preserved. Clean B2/W2 installation, export, reimport and separate
  uninstall pass. The full application suite passes 1,034 tests in 114 files
  (one skipped); the production build passes with its existing size advisory.

Release accounting: 5,120-byte DLL; 4,300 bytes code/constants; 364 fixed writable
bytes; approximately 5,448 retained PMC bytes. This is 32 fewer retained PMC
bytes than 0.3.2. No added battle-heap allocations, sprites, palette banks or
graphics VRAM. See reports/captured-state-verification.json and the usual
memory/compiled-check reports. Final in-game visual testing remains with the user.

# Historical validation — Type Icons 0.3.2 / bundle 0.4.2

No in-game emulator session was run. The user manually tests battle UI changes.
Move Effectiveness Preview is unchanged from 0.4.0 in both games.

- Removed the name/level shifts and the exact static Lv. bitmap requirement.
  Enemy icons no longer depend on validating an unused HP-number image.
- Compiled ARM checks pass for both English games, including enemy layouts
  with absent HP-number sprites and changed Lv. graphics, all 18 outlined icons,
  six simultaneous panels, mono/dual transitions, fade handling and teardown.
- Only the pixels covered by the circular outlines are backed up. Two bits
  preserve native name foreground/shadow/transparent pixels in the overlap;
  one bit preserves the patterned panel below. The maximum backup is 172 bits,
  keeping the six records and diagnostics at 364 writable bytes.
- Native name and level positions are preserved. Name redraw hooks restore
  the overlap before the original call and paint icons afterward. Fixtures
  include foreground/shadow pixels at the native rows 14/15; all six status
  labels restore these letters exactly, with no residual outline fragments.
- All 14 PMC hooks preserve registers, SP and stack arguments. Profiles verify
  15 icon signature windows and 20 resources independently for B2 and W2.
  The separate move profile retains its 21 signatures and five hooks.
- Player HP-slash regression checks pass: white/gray strokes and all number
  tiles are unchanged, independent image reloads are repaired, and invalid
  player number pointers/layouts fail before graphics or palette writes.
- Scanner hook-collision checks and modified panel/HP-number asset rejection
  checks pass. No user ROM or save is edited by these checks.
- All 23 installer cases pass, including imported 0.3.0/0.3.1 upgrades with
  customized move colors preserved. Clean B2/W2 installation, export, reimport
  and independent uninstall pass. The full application suite passes 1,033
  tests in 114 files (one skipped); the production build passes with its
  existing chunk-size advisory.

Release accounting: 5,152-byte DLL; 4,336 bytes code/constants; 364 fixed writable
bytes; approximately 5,480 retained PMC bytes. No extra battle-heap allocation
sites, sprites, palette banks or graphics VRAM. Native rendering/creation is
instrumented in these checks; final visual behavior remains for manual testing.
Exact build hashes are in reports/memory-report.json.

# Historical validation — Type Icons 0.3.1 / bundle 0.4.1

No in-game emulator session was run. The user manually tests battle UI changes.
Move Effectiveness Preview remains byte-identical to 0.4.0 in both games.

- Independently matched 34 native functions/signature windows in English B2/W2.
  Icons use 16 hooks, 16 signatures and 20 graphics resources. Added hooks are
  the native name draw and both level draw call sites; all are in overlay 168.
- Compiled ARM fixtures pass for both games: all 18 approved glyphs, 10x10
  exterior outlines, transparent corners, 21x10 dual placement with a one-pixel
  gap, centered monotypes and all player/enemy panel layouts.
- Status show/clear restores the full enlarged area on six simultaneous panels.
  Existing fades, type changes, Illusion, native Roost, replacements, graphics
  relocation and resource teardown checks still pass.
- The HP number sprite's exact native slash is verified before remapping only
  index-4 shadow pixels to index 2. White/gray strokes and all digit bytes are
  unchanged. Number-only reloads and proxy relocation repair only the slash;
  unchanged frames produce no video writes. Invalid pointers, overflowed image
  offsets and unknown slash shapes reject before graphics or palette writes.
- The retail small_batt font was inspected directly from a/0/2/3, member 2:
  ordinary Latin glyphs include a shadow at bitmap row 15. Name and level
  hooks preserve row-15 pixels while raising one row (two on regular player
  panels), clear vacated rows and avoid drift across repeated native redraws.
  Static Lv. labels accept native or shifted patterns. No glyph is decoded at
  runtime by the patch.
- All 16 PMC wrappers preserve callee-saved registers, SP and stack arguments.
  Full scanner collision checks and mutated panel/HP-number asset checks pass.
- 22 installer cases pass, including updating an imported, renamed Type Icons
  0.3.0 DLL while preserving a customized Move Preview DLL byte-for-byte.
- Full application suite: 114 files, 1,032 passing tests and one skipped.
  Production TypeScript/Vite build passes with the existing chunk-size advisory.
- Clean English B2 and W2 pass installation, export, reimport and independent
  staged uninstall. These checks modify no input ROM or save.

Type Icons: 5,584 bytes on disk; 4,676 code/constants; 364 fixed writable bytes;
estimated 5,896 retained PMC bytes, including bookkeeping. No additional
battle-heap allocation sites, sprites, palette banks or graphics VRAM. Exact
hashes are in reports/memory-report.json. Native engine rendering/creation is
instrumented in the compiled fixtures; actual battle animations, nicknames,
level-up transitions and visual spacing remain for the user's manual check.

# Historical validation — Move Preview 0.4.0 / Type Icons 0.3.0

No in-game emulator sessions were run for this update. The user will manually
validate battle UI changes; this preference is recorded in the project notes.
The Type Icons release hashes are unchanged from 0.3.0.

- Independently verified 31 native functions across both English games; 13
  icon functions/hooks and 21 move functions/five hooks. Shared helpers overlap.
- Compiled logic fixtures (`verify_moves.py`) pass on B2 and W2. Native ability,
  item, condition and client-field getters execute against controlled RAM;
  drawing/input and view mapping use fixtures. No game is booted.
- Immunity matrix: type immunity and its removal, all three Ground immunity
  sources plus Telekinesis, grounding, active-item suppression, ability bypass,
  Gastro Acid, absorption, Soundproof, Wonder Guard and Sturdy/OHKO.
- Red-to-default transitions, all three enemy target cards, ally fallback,
  custom color loads, fade buffers, hardware palette writes and full native
  palette restoration pass. Current client objects remain unchanged.
- 21 installer tests pass: six-byte editing, invalid colors, invalid RGB555
  high bits, tampered code/BSS, export/reimport, color-preserving reinstall,
  old-module migration, and independence from Type Icons.
- Full application suite: 114 files; 1,031 passing tests, one skipped.
- Production TypeScript/Vite build passes (existing chunk-size advisory).
- Clean B2/W2 installation/export/reimport and staged uninstall pass. No input
  ROM or save was modified. Collision/asset negatives pass.
- Browser installer check: all three pickers accept custom colors; installation
  stages only MoveEffectivenessW2.dll and displays the same selected colors.

Current move-preview release: 3,504 bytes on disk, 2,948 code/constants, 20 bytes
fixed state, estimated 3,560 retained PMC bytes. No new allocation sites,
sprites, palette banks or graphics VRAM are introduced by this update. Exact
hashes and detailed accounting are in reports/memory-report.json.

Manual checks: ordinary battle entry/exit, red text readability, all target
selection transitions, real item consumption/condition expiry and fades. The
existing exclusions for four dynamic-type moves and custom mechanics remain.

# Historical validation — 0.3.0

This records completed checks separately from full gameplay coverage. Current
binary hashes and sizes are in `reports/memory-report.json`. No source ROM or
user save was edited; emulator work used private copies.

## Completed

- Independently identified 25 native functions for English B2 and W2, and
  checked 18 original hook sites and 17 native graphics/palette resources.
- Both compiled ARM builds passed `verify.py`: all 18 icon masks and colors,
  primary/secondary order, duplicate collapse, transparent corners, both panel
  sizes on both sides, six simultaneous panels, every native status ID,
  rebinding, resource identity changes, teardown and fade behavior. Actual
  native proxy, disguise and effective-type helpers are exercised. Other
  engine services are instrumented fixtures; see the report for the boundary.
- `verify_moves.py` passed for both builds: actual retail type chart,
  singles/rotation colors, default multi-battle move buttons, copied target
  label, cursor-table target mapping, ally/spread fallback, cancellation,
  unchanged-frame transfer/query suppression, fixed-damage handling, Hidden
  Power and Normalize dispatch, and default colors for unsupported dynamic
  types. All five added hook wrappers preserve return values, registers and
  the fifth/sixth stack arguments. Hidden Power/BattleStat are fixtures here.
- Final W2 release booted from reset with an ordinary save, entered a real
  wild battle, and opened the native move screen. Player and enemy icons were
  visible and the EXP lettering remained intact.
- Both standalone DLLs loaded from reset in that W2 battle. From that state, actual native gauge/status functions passed every status
  show/clear request, with byte-for-byte icon restoration and zero allocator
  calls. Full 4 MiB game RAM comparison against the original gauge update
  changed only module state and the four intended palette-buffer entries.
- Actual native input and bitmap transfer functions passed the W2 color test.
  Controlled Ghost/Ice target typing produced 137 yellow and 426 blue letter
  pixels. PP/shadows and other game RAM were unchanged; allocator calls were
  zero. Unicorn emulated the hardware DMA copy, while executing native game
  routines. This is controlled input, not a move actually inflicting damage.
- Pokeweb model tests passed (14 tests), including an in-place upgrade from
  the old enemy-only DLL under a renamed filename, both combined-module
  replacement choices, independent install/uninstall, and an icons-only install
  when the move type-chart signature is modified. Real clean B2/W2 ROMs
  passed installation, export, reimport detection and staged uninstall.
- Fresh loopback browser session: separate **Type Icons** and **Move Effectiveness Preview** cards displayed
  correctly; installing icons staged only its DLL, then the move entry added
  its independent DLL. Both showed Installed.
- Full Pokeweb test command exited successfully: 114 files, 1,024 passing
  tests and one skipped. Production TypeScript/Vite build passed, with its
  existing large-chunk advisory.
- Compatibility negatives passed: all 13 icon conflicting relocations and the separate five-hook move profile, malformed
  DLLs, modified hooks and graphics. The recorded Cascade/scanner ROM has no
  overlapping hooks, but is rejected for previously observed PMC capacity.

Earlier 0.1.0 validation included B2 and W2 reset-boot native enemy panels,
fainting/replacements, and an isolated scanner coexistence experiment. Those
historical reports are not presented as final 0.3.0 end-to-end results.

## Remaining gameplay coverage

- Final B2 native battle run from reset (compiled profiles and installer are
  checked; the new player/preview behavior is not claimed live-tested there).
- Full doubles, partner and triples battles with all six native gauges,
  all target-card transitions and long move names. Compiled fixtures cover
  those arrangements, but do not replace an actual battle session.
- Ally Switch, triple shifts, manual switching, repeated battle entry/exit,
  form changes, Transform, Soak, Color Change and Roost executed as moves.
- Illusion with real battle animations and transitions, HP color thresholds,
  caught/gender markers, damage shaking, panel hiding and all fade timings.
- Final combined scanner coexistence from reset, long-session heap/VRAM
  allocation-count comparisons and hardware frame-time measurements.

The implementation adds no heap allocator, sprite, palette-bank or graphics
VRAM allocation calls. Snapshot equality is stronger than counting only calls,
but is still scoped to the exercised paths rather than a whole-battle proof.

## Preview boundaries

Status moves retain their normal color. Immunity currently uses grayish blue.
Weather Ball, Natural Gift, Judgment and Techno Blast remain neutral. Other
ability/item/field exceptions are not part of 0.3.0; red immunity highlighting
is **feasibility-only**, as requested, and has not been implemented.

No modern-generation assumptions are substituted for BW2 mechanics. Any next
immunity extension must add independent B2/W2 native-state/profile checks and
negative tests before changing the bundle. See `IMMUNITY_FEASIBILITY.md`.
