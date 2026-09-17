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

Release **1.4.3** replaces the possessive INFO header with the uppercase ROM
species name followed by its current-form type badges, vertically centered in
the black strip. Single types appear once. Native font measurement reserves
space for both badges and the existing party-slot cue before truncating long
names. L/R family browsing and party navigation update the types along with
the species. Invalid type data hides the badges rather than indexing past the
native resource tables. The lower screen and ordinary tutors are unchanged.

Two already-created upper tutor type actors provide the ROM's own artwork and
palette mapping. Their native VBlank character queue and original teardown are
reused; no new sprites, persistent graphics allocations, hooks, or battle-resident
state are added. Info state grows four bytes. Updating through Pokeweb configures
the new private `{0}` title template without replacing existing tutor messages.

Release **1.4.2** keeps "Does not evolve further." on the first footer line
and shows the immediate predecessor's evolution requirement underneath, such
as "From Eevee: Use Fire Stone." for Flareon. Names and requirements come from
the current ROM, not the party Pokemon's historical origin. Only records that
target the selected species/form are shown; sibling branches are excluded.
Only the last matching method/parameter pair in ROM slot order is shown; A
does not cycle between alternative methods. Long text can still use continuation
pages. The predecessor matches the displayed chain and any verified L/R
navigation edge. Pokemon without a predecessor keep "Does not evolve.";
Pokemon that can evolve retain their existing outgoing requirements.
One new private message is appended/reused; update both companions through
Pokeweb. Lower-screen behavior, graphics, hooks, and the request ABI are unchanged.

Pokeweb's follow-up Test Warp/Battle export fix preserves incoming physical
NitroFS file order across additional ROM rebuilds. This keeps PMC's early
startup placement instead of moving it behind large archives. It does not
change the 1.3.4 DLLs, UI, hooks or module lifetime. Refresh Pokeweb and create a
new launch; an already generated broken launch or frozen state is not repaired.
See [validation](VALIDATION.md#test-launch-startup-regression) for the reproduced
Black 2 failure and boot checks.

Pokeweb also recognizes verified markerless CTRMap PMC installations, including
the original White2Upgrade loader. Installing LEARNSET preserves that loader
instead of creating overlay 345 while startup still loads overlay 344. Unknown
or mismatched loaders are rejected, not replaced. This is an installer fix;
the fix first shipped alongside **1.4.1**. A previously exported ROM with the
second-loader error must be rebuilt from the original input after refreshing
Pokeweb; replacing the DLLs or restoring a frozen state cannot repair startup.
See [markerless-loader validation](VALIDATION.md#markerless-pmc-startup-regression).

Release **1.4.1** corrects the DS palette address used for the upper light
panels: sub BG is at `0x05000400`, not the main OBJ sprite palette at
`0x05000200`. This fixes the pink/red fill and blue shade. Background, rule
and shading colors still come from the loaded ROM; neither OBJ palette nor
the lower screen is modified.

L/R now refreshes the info and move list in place. It does not fade to black,
close the tutor, reload overlay 258, or recreate its graphics/cursor/heap.
The old screen remains visible while data loads. A complete replacement native
move-name list is prepared before committing; allocation failures preserve
the old selection/list. The existing info allocation is reused, lower scroll
and cursor reset, and native cleanup owns the replacement list on exit.
D-pad party switches retain their existing fade/relaunch behavior.

Release **1.4.0** makes the highlighted evolution stage browsable with L/R.
Both screens now describe that species/form: title, base stats, abilities,
evolution requirements and level-up learnset. Only its icon animates; all other
icons stay on pose zero. D-pad Left/Right still switches real party slots and
resets family browsing, while B/return restores that real party slot.

R follows the highlighted species' first valid outgoing target, including a
further evolution of a branch target before visiting sibling branches. At a
terminal stage it advances to the next sibling in ROM slot order, ascending
through predecessors if necessary. L selects a previous sibling when present;
only the first sibling returns to its source. Eevee's target position therefore
keeps its highlight while the target species changes, then L from its first
target returns the highlight to Eevee. Endpoint presses do nothing; no sibling
wrap is added. Duplicate target identities are one navigation stop, but all
method records still have requirement pages. Traversal is bounded/cycle-safe.
A cycles requirement/continuation pages without changing the focus or icons.

Virtual species selections use private request data, never Pokemon setters or
a fabricated party member. Version 1.4.0 used native fade/end/init for each
family selection; 1.4.1 replaces that path with the in-place refresh above.
The actual party Pokemon pointer remains unchanged; all graph, rendering,
animation and navigation decisions remain in overlay 258. Earlier release
notes below describe the controls at their original release.

Release **1.3.10** animates the evolution icons with their ROM's two native
32x32 poses, alternating every eight viewer ticks like the party menu's
healthy idle sequence. All displayed species animate; borders and positions
stay fixed. The viewer does not apply HP/status slowdown or the selected
party slot's separate six-pixel hop to these informational icons. Both poses
are cached in the existing session-owned info allocation. Idle updates touch
only icon pixels and upload the bitmap characters, without rebuilding maps,
redrawing text, reading the ROM or allocating memory. Missing icons remain
static placeholders. Branch changes retain the current pose; closing the
viewer frees both poses with the rest of its info state.

Release **1.3.9** extends the right panel's three-pixel left shade and one-pixel
edge up through the evolution-icon area, following the clipped upper corner.
The outer border, ability rules at Y=100/116, text, icons and other colors stay
unchanged. It adds no allocations, resources or hooks.

Release **1.3.8** matches the light upper panels to the lower description panel.
Stats and ability names already use the same native font; they now also use
its ROM-loaded foreground and visible glyph-shadow colors. Hidden abilities
stay purple with that same shadow. Font size, measurement and spacing do not
change. The ability list adds the lower description's three-pixel left shade,
one-pixel edge and subtle 16-pixel row rules. Those colors are read from the
already-loaded lower palette, without modifying it or the shared graphics.
A private ability palette keeps the title, dark evolution-text box, sprite
colors, dark-teal selection frame and other accents unchanged. No new heap
allocation or ROM read is needed.

Release **1.3.7** darkens only the selected sprite's one-pixel frame to
`#207878` (RGB555 `0x3de4`). It overrides index 7 in content palette bank 9;
the title cue and fin accents keep their brighter teal in banks 14 and 13.
All other colors, geometry, graphics, controls and allocations are unchanged.

Release **1.3.6** reverts the 1.3.5 move-bar color experiment, restoring the
charcoal evolution-text body. The evolution/abilities inset instead matches
the pale gray stats-panel fill exactly. Its existing muted border and teal
selected-icon frame are unchanged. Icon transparency and card interiors
match the pale fill; ability text and arrows use dark ink, with a deeper
purple for hidden abilities. Pale-matched glyph shadows avoid dark halos.
The dark description fin/top strip, teal hatches, gutter, title, layout and
lower screen remain unchanged. No new runtime reads or allocations are added.

Release **1.3.4** changes the evolution/abilities inset to dark slate charcoal
(`#282830`), between the near-black description cap and its lighter body.
Icon transparency and the selected card's interior match the new fill. Muted
borders, teal selection, text/shadows, gold bars and title rails remain unchanged.
The description body loses its left/right/bottom teal outline; its dark cap,
teal hatches, body shade and text positions stay unchanged.
Content palette bank 9 copies bank 14 with
one private fill index; bank 13 carries the same fill across the inset's final
four rows. This uses another existing 32-byte hardware palette bank, no heap.

Release **1.3.3** gives the description panel a two-tone Pokedex treatment:
the fin and top strip share the same near-black fill, while the text body is
lighter charcoal. Teal hatch marks and side/bottom outlines remain. Only the
existing private footer palette and fill indexes change; geometry, spacing,
text colors, upper panels, lower screen and controls are unchanged.

Release **1.3.2** separates the upper panels from the description panel with a
four-native-pixel slate-teal gutter at Y=132–135. Both upper panels end at Y=131;
the fin rises from Y=136, with the gap continuing behind its diagonal edge.
Stats use a 15-pixel row stride and abilities start at Y=84/100/116. Font sizes,
icon positions, footer text at Y=140/156/172, and all lower-screen layout and
controls remain unchanged. The footer outline is a quieter teal.

Upper-background palette bank 13 copies bank 14 for tile rows Y=128–191,
changing the gutter, footer-outline and (since 1.3.3) body colors. Text, native icon palettes,
the selected-icon border, and original title rails retain their colors. This
uses one previously unused 32-byte hardware palette bank, no additional heap
allocation, and the same buffered tilemap/upload path, including error screens.

Release **1.3.1** replaces the dense upper-screen row grid with a clipped pale
stats panel and a shared dark evolution/ability inset with a muted clipped
frame. Stat text is dark, gold bars have no individual outlines, and only the selected evolution icon has a
teal frame. The native title rails remain; the black evolution footer gains a
thin teal outline and a raised, hatched top-left fin inspired by the Pokedex.
Its text still starts at Y=140/156/172 and stays inside the original bounds.
A measured `< 2/6 >` header cue shows the physical party slot/count; D-pad navigation still
skips Eggs and empty slots. One-member parties show `1/1`; invalid context omits
the cue. Long species names truncate before the unchanged `'S INFO` suffix and
never overlap the cue. No popup, new controls or lower-screen changes are added.
The cue adds 24 bytes to viewer-owned info state, no additional allocation,
ROM reads, hook sites, private messages or battle-resident storage.

The 1.2.3 sources, paired bundles, installer model and preview were backed up
before this redesign. Its configured test ROMs remain available separately.

Release **1.2.3** moved all evolution-panel text down two native pixels:
heading/page indicator at Y=140 and requirement/status lines at Y=156/172.
The black panel, sprites, stats, abilities and lower screen stay in place.
`verify_info.py --layout-only` checks native-font placement, continuation pages
and bottom-edge bounds on both games without rerunning the full data suite.

Release **1.2.2** aligns both sprite-card borders exactly with row rules at
Y=40/88. The original 32×32 icons sit at Y=48–79 with vertical padding: no
cropping, scaling or new graphics allocation. Abilities move down one full row
to Y=90/106/122. The evolution heading and requirements retain their positions,
but their previous near-black panel is restored beneath the Y=136 teal rule.
The lower screen, controls, data, gold bars and hidden-ability colors are unchanged.

Release **1.2.1** restored the retail tutor's slate background, faint 16-pixel
rows, title rails and bottom trim to the private upper panel. `background.py`
extracts the exact RGB555 colors and clean row profile from the verified US
W2/B2 tutor resources (shared palette/tiles 0/1, upper map 4), excluding the old
move bars and name plate. Both games must match. The build embeds only seven
colors and compact row runs; there are no new runtime reads or allocations.
The six stat rows start at Y=42 with a 16-pixel stride, and the evolution
heading/requirement lines now start at Y=140/156/172. Gold stat bars, teal selection, purple hidden abilities,
all lower-screen geometry, and ordinary RELEARN remain unchanged. Allocation
failure also retains a dismissible error message. The 1.3.1 split panel replaces
the body stripes while retaining the verified retail title rails.

Release **1.2.0** adds party navigation to the species-info viewer. D-pad
**Right** advances in party order (slot 1 to slot 2); **Left** goes backward.
Both wrap and skip Eggs/empty slots; fainted Pokemon remain available. With only
one eligible Pokemon, neither direction leaves or reloads the screen. L/R
shoulders still page evolution requirements, and B/return closes to the party
menu with the last viewed Pokemon selected. Each switch resets lower scrolling
and the outgoing-evolution page, and refreshes both screens from that Pokemon's
current species/form. Switching uses the native fade/end/init lifecycle rather
than rewriting live tutor list or graphics pointers. It never visits the party
menu between Pokemon and never teaches moves or changes party order.

The upper-screen design remains private to LEARNSET. The title
uses the ROM species name (not nickname), six current-form base stats use
gold bars on a shared 0–255 scale, and a maximum of three native party icons
shows the focused stage with a dark teal border. L/R changes the focused species;
A pages every outgoing requirement, including text continuation pages. Lower move rows,
descriptions, power/accuracy, touch controls, and B/back behavior are unchanged.

The stats column is 18 pixels narrower, with tighter label/value spacing. The
icons occupy the upper right area, their spacing fits clear right-pointing
arrows, and up to three available ability names appear underneath, left-aligned
in Title Case. Capitalization affects display copies only, not ROM text. These are
the selected form's personal-data slots (bytes 24–26), not its current battle
ability. Zero slots are omitted; duplicate IDs appear once and retain purple
hidden-ability highlighting if one of their slots is hidden. Names come from
ROM bank 487 with bank 374 as the fallback for extended names, matching Pokeweb.
Long names are measured and truncated; missing names show their numeric ID.
The A page indicator sits beside the evolution-requirement heading so it
does not overlap the ability list. Stats, title, abilities and the highlighted
identity describe the focused species; paging text alone does not change them.

The bounded reader supports 76-byte personal records and 42/48-byte evolution
records. It skips non-personal archive members, resolves form ownership, chooses
the first predecessor by record/slot order, and initially follows the first
outgoing slot. A verified incoming navigation edge overrides the predecessor
when a hack has multiple sources for the same target. The focused species
is always included. Each displayed direction is bounded to two
neighbors; repeated species/form identities stop traversal, with continuation
markers instead of a wraparound arrow. Cycles are valid data, not errors.
All outgoing slots get text pages, including links to an already displayed
ancestor or the selected stage itself. Those links never add duplicate icons
or a wraparound arrow.
When additional predecessors exist in a hack, the first-source rule determines
which is displayed; it does not infer the particular Pokemon's ancestry.

Evolution descriptions use verified BW2 method semantics, not the editor's
legacy labels: methods 2/3 mean friendship plus day/night, and method 28 means
the Chargestone Cave location check. Methods 29–31 describe the repository's
KO/battles-brought/battles-used extensions. Unknown methods show their numeric
method and parameter. Requirements are descriptive, not an eligibility checker;
the patch does not implement or change evolution behavior.

`info_messages.json` defines private viewer messages, appended/reused in bank
401 by the installer. A separate `LSVINF1` configuration section contains their
IDs/complements in the viewer DLL only. The original `LSVMSG1` configuration and
field-owned request remain compatible. Update **both** companions through the
Learnset Viewer card and export; copying raw bundled DLLs does not configure text.

The upper renderer expands the title bitmap to 32×24 tiles, keeps valid 1×1
unused windows for native cleanup, and suppresses the five original upper
sprites. BG2 uses a private palette and CPU-side tilemap; the icon rectangles use
their native ROM palettes. BG3 is hidden so transparent icon pixels cannot
reveal old upper-screen graphics. The private bitmap draws the new split panels
and preserves the retail title rails. No ROM graphics archive is replaced.

All info parsing, strings, rendering, evolution paging, and mutable info state
live in the overlay-258 viewer. The menu/field companion relaunches that viewer
after a party switch. Each menu DLL is 3,056 bytes on disk / 2,856 bytes after
internal relocation fixing, up by 272 fixed bytes from 1.1.3. Its persistent
state is unchanged. The field-bridge split is not part of this release.
The upper bitmap change adds 14,784 bytes to the tutor
application heap's bitmap payload (not the PMC heap); temporary graph and text
allocations also use heap 79 and are released during/after the session.

Opening uses a 1 KiB FAT window plus a 4 KiB record window for the personal and
evolution scans, one archive at a time. This replaces thousands of tiny seeks
and reads without loading whole archives or retaining a cross-session cache.
If this optional buffer cannot be allocated, the checked unbuffered reader
still works. Initialization reuses one private message bank and one name bank,
closing both before returning. Eight compact chain snapshots replace the full
graph after initialization. Paging reuses three icon slots and reads only new
identities; continuation pages never reopen personal/evolution/message data.
All these buffers remain viewer/application-heap scoped, not battle-resident.

On the clean Eevee fixture, directly instrumented filesystem reads drop from
4,291 to 87 (about 98%); private/native message-bank opens drop from 32 to 10.
These counts exclude reads internal to the native message routines. This is
not a measured live-game loading time; retest the original 2–3 second delay.

`verify_info.py` runs compiled Thumb code with filesystem/allocator/presentation
boundaries instrumented, actual ROM fonts and icons, and native icon resolvers.
It generates 256×192 previews in ignored `build/`. These checks are not a live
game/emulator run. Test the new ROM from boot rather than restoring a state with
old loaded DLLs. See `VALIDATION.md` for release checks and the emulator checklist.

### Earlier releases

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
records, and a separate terminated move-ID array. Request ABI version 3 keeps
the eight-byte party-navigation suffix and adds current/pending virtual
species/form selections with incoming-parent hints, for a total of 260 bytes.
It remains field-owned for the whole browsing session;
the menu rebuilds its contents only after native viewer teardown and then
starts overlay 258 again. Both companions must be updated together; an older
request ABI is rejected before native initialization. The bridge refuses to run
the retail tutor if its viewer companion is missing. The viewer recognizes
mode `0xfe`, validates the request, and normalizes the retail mode to 1 before
initialization. Its end callback clears active pointers before overlay unload;
the field callback either relaunches for a party/family selection or frees the
request and restores the last viewed party slot. Count/index validation occurs
again in the bridge; failed transitions safely return to the party menu.

Species and form initially come from the selected Pokemon and subsequently
from the validated private family selection, then resolve with the
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
48-pixel area. Lower detail/category/power/accuracy renderers remain native;
the upper panel is now private to LEARNSET. Confirmation is disabled and teaching/replacement
states are blocked; B/back enters the fade-out path without a question.

The viewer's private copy of lower background member 2 in `a/1/2/5` is
modified. In rows 8–20, map columns 18/19 move to 21/22, with the intervening
space filled from column 17. This shifts the diagonal divider exactly three
8-pixel tiles without changing outer geometry. The highlighted cursor
(character 17, cell 7, animation 8) is an outline over this same background,
so both states share the adjusted divider. No ROM graphics archive is replaced.

## Compatibility

US resource indexes are independently read from the target ROM, not assumed
from another region. The build pins decompressed US overlays 12/165/258.
`learnsetViewerManifest.json` records
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
c++ -std=c++17 -Wall -Wextra -Werror runtime/learnset-viewer/test_info.cpp -o runtime/learnset-viewer/build/test_info
runtime/learnset-viewer/build/test_info
python3 runtime/learnset-viewer/verify_runtime.py
python3 runtime/learnset-viewer/verify_info.py
python3 runtime/learnset-viewer/verify_info.py --header-only
python3 runtime/learnset-viewer/verify_info.py --terminal-only
python3 runtime/learnset-viewer/verify_graphics.py
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
   Check both highlighted/unhighlighted bars and the new upper species-info
   panel (see `VALIDATION.md`). A must never teach; B/back must return to the same Pokemon.
3. Open/close repeatedly, then use RELEARN and ordinary tutors. Verify moves,
   PP, items and saved Pokemon data have not changed from viewing.
4. Check an empty learnset and an invalid/unterminated learnset: each must show
   its explanatory message and close safely. Test a full 32-entry learnset.
5. Test Eggs, battle/daycare/item/mail contexts and full eight-command menus.
   LEARNSET must not appear there or displace another command.
6. Repeat on vanilla and Upgrade W2/B2, with enhanced menu installed before and
   after LEARNSET. Load the newly named test ROM from a fresh boot rather than
   restoring a save state created with a different DLL layout.
