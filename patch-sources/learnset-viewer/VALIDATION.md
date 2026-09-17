# LEARNSET 1.4.5 validation

Release checks performed on 2026-09-17. These are automated host tests,
isolated compiled-Thumb tests, ROM inspection, and export/reload checks.
**A complete live-game session has not been verified for this release.**

## 1.4.5 separate navigation sounds

L/R evolution browsing now uses system SE 1356 (`0x54c`), matching the tutor's
native move-list row/scroll callback. D-pad party switching uses SE 1637
(`0x665`), matching Left/Right page changes within a single Pokemon's summary.
Neither action uses the previous release's Pokemon-switch sound 1636.
The shared native sound entry remains Thumb `0x02006255` in both US games.

Verified separately in W2/B2: the tutor row callback loads 1356 at
`0x0219b4bc/0x0219b47c` from `0x0219b5b4/0x0219b574`; its scroll path uses
the same literal. Summary Right/Left paths load 1637 at
`0x021b4108/0x021b40c8` and `0x021b4136/0x021b40f6`, respectively, from
`0x021b4210/0x021b41d0`. Build-time byte checks pin those paths and literals.
These are verification references, not additional hooks or overlay dependencies.

Only successful navigation plays one effect. Failed/no-op selections and
repeated input during the native party fade stay silent. Ordinary tutors and
the lower move-list sound are unchanged. No hook, ABI, private-message, layout,
cache or allocation changes; both companion versions advance together.

Both stripped viewer DLLs are 18,704 bytes (18,720 expanded; 15,236 code;
BSS 8): +16 file/expanded bytes and +4 code bytes from 1.4.4. Menu DLLs
remain 3,328 bytes and change only their paired version metadata.
Compiled W2/B2 wrapper tests assert the two distinct IDs, exactly-once playback
and silent failure/no-op paths. All 86 focused installer/PMC/export tests,
production build, source-snapshot consistency and privacy checks pass.
Updating both 1.4.4 test ROMs passes installation, idempotence, private-message
preservation and export/reload. Both 1.4.5 test ROMs pass 900-frame startup
smoke checks with matching battery saves. Audible output still needs in-game
verification; the unchanged info/cache/header suites were not rerun for this
sound-only change.

Test ROMs in the outer Repos directory:

- `White2Upgrade-LEARNSET-1.4.5-test.nds`
- `Black2Upgrade-LEARNSET-1.4.5-test.nds`

Manual check: compare L/R evolution browsing to moving up/down through the
lower learnset list. Compare D-pad party changes to Left/Right summary pages
of one Pokemon. Check both directions, quiet endpoints and repeated switching.
Start from battery save, not a state containing the previous DLLs.

## 1.4.4 navigation sound and session cache

Successful L/R evolution selections and D-pad party changes use system SE 1636
(`0x664`), the Pokemon-change sound verified independently in both US summary
overlays. This is not the separate summary-tab sound 1637. The shared native
Thumb entry point is `0x02006255` in both games. Build-time checks cover the
summary's two Pokemon-switch call paths and sound literals, plus the native
sound wrapper bytes. Overlay 207 is evidence only: no new hook, load or runtime
dependency is introduced. Compiled wrapper tests assert exactly one click per
successful selection and none for endpoints, conflicting input, failed refreshes,
repeat input during a party fade or a party with no other eligible member.

Type badges now form a right-aligned group ending eight native pixels before
the measured party indicator, independent of species-name length. Dual badges
retain their two-pixel gap, Y=12 centers and native artwork. Names reserve at
least four pixels before the group and truncate with the native font metrics.
With no valid party cue the group ends at X=248. No lower-screen change.

The viewer retains the bounded 10-byte-per-record species/form graph until
application teardown. Personal/form resolution and all evolution edges are
scanned only once per session, not once per L/R press. The existing three icon
buffers survive refresh and reload only when the displayed identity/gender
changes. Four small evolution records are memoized within each load to avoid
duplicate parent/sibling reads. The current stage's navigation-parent override
is restored before returning, so it cannot corrupt later cached traversals.
ROM file/message handles and whole-archive buffers remain temporary; only the
compact graph and existing icon buffers persist. D-pad switching still closes
and relaunches the application, so its native fade is unchanged.

For a compiled W2 Nidorina-to-Nidoqueen info refresh, 1.4.3 performed 95 reads
covering 178,246 bytes. The equivalent warm 1.4.4 refresh performs 28 reads
covering 414 bytes: 12 message-archive reads, six personal reads, ten evolution
reads and no icon reads. This is about 71% fewer calls and 99.8% fewer bytes.
These are instrumented info-panel filesystem boundaries, not total game I/O or
wall-clock speed: lower learnset/list work, native graphics/audio and physical
storage behavior are not included. No claim of a measured live frame-time
improvement is made.

Info state is 10,392 bytes, up 12. A retail 710-record graph adds 7,100 retained
bytes during the viewer, for 17,492 total; the graph's hard 4,096-record bound
caps it at 40,960 bytes. The graph was already allocated temporarily during old
refreshes, so the measured Nidoran info-heap peak changes by only 12 bytes,
22,674 to 22,686. The state and graph are released before viewer unload, and
reopening rebuilds them from the loaded ROM. Nothing new is retained in battle.

Both viewer DLLs are 18,688 bytes (18,704 expanded; 15,232 code; BSS 8), up
336 file/expanded bytes and 360 code bytes from 1.4.3. Menu DLLs remain 3,328
bytes (3,344 expanded; 2,292 code; BSS 8), with paired version metadata only.
Existing hooks, private messages, resource indexes and request ABI are unchanged.

The 84 focused installer/PMC/export tests, host logic tests, compiled wrappers
and divider-graphics checks pass. Real-ROM checks cover original White2Upgrade,
updating the B2 1.4.3 test ROM, clean W2 with enhanced menu first, and clean B2
with enhanced menu last. Installation is idempotent; export/reload preserves
the existing PMC loader and shared tutor text/graphics. Both 1.4.4 companions
are bundled, and configured 1.4.2/1.4.3 pairs are detected as needing an update.
The production build and privacy check pass; both exported test ROMs pass
900-frame startup smoke checks with matching bundled battery saves. This does
not verify audible output, perceived navigation latency or interactive play.

Compiled `--cache-only` checks pass in W2/B2: repeated warm selections reuse
the same allocations and unchanged icons, edited ROM data is read on reopening,
navigation hints do not leak, cycles and form targets resolve, failed allocations
and archive reads recover, and teardown releases every tracked allocation.
The full compiled info-data suite also passes. Updated `--header-only` checks
verify the fixed right edge, single/dual types, one/multiple/no party cue,
long names, form/edited types, native VBlank dispatch and cleanup in both games.
Native-font/icon header previews were generated and visually inspected.
Final `--navigation-only` and `--terminal-only` regressions also pass on both
games, including sibling/descendant traversal, selected-only animation, last
incoming method selection, continuation paging and read-only cleanup.

Test ROMs in the outer Repos directory:

- `White2Upgrade-LEARNSET-1.4.4-test.nds`
- `Black2Upgrade-LEARNSET-1.4.4-test.nds`

Manual checklist: start from battery save, not a state containing old loaded
DLLs. Compare the summary's Pokemon-switch click with LEARNSET L/R and D-pad
switches; verify one click per successful change and quiet endpoints. Browse
Nidoran's family and Eevee's siblings repeatedly, check long/cyclic hacked
families and forms, then close/reopen and change party slots. Confirm the
selected icon, stats/types/abilities, requirements and lower learnset stay in
sync, only the selected icon animates, ordinary RELEARN is unchanged and no
Pokemon data changes. Check that single/dual type badges stay the same distance
before the party cue for short/long names. Judge responsiveness in-game; party
fades are expected.

## 1.4.3 species/type header

The following records the previous release's checks from 2026-09-16.

The header now contains the uppercase ROM species name and its current-form
type badges instead of the possessive INFO suffix. Native font measurement
reserves a four-pixel name/badge gap, 32 pixels per badge, a two-pixel badge gap,
and the existing eight-pixel clearance before the party cue. Badge centers are
at Y=12 within the native black Y=3..20 strip. Duplicate type IDs draw once;
IDs outside 0..17 draw no badges. L/R uses the virtual species/form record, not
the original party member. The lower screen, controls and ordinary tutors are
unchanged.

Verified separately against the US W2/B2 binaries: actor raw-position helpers
`0x0204c23d/0x0204c211`, palette setters `0x0204c3a5/0x0204c379`, and type palette
mapping `0x0202d815/0x0202d7e9`. The native upper actors at work offsets
`0x124/0x128` retain character resources `0x80/0x84`; queue slots `0x140/0x148`
are consumed by the existing overlay-258 VBlank handler. Installer signatures
now also cover that queue, upper type-resource loading and actor templates.
No hook sites or request ABI change.

`verify_info.py --header-only` passes on both games. It executes compiled viewer
code plus the actual native actor setters, type mappings and VBlank dispatcher,
instrumenting only the final graphics-transfer boundary. Cases cover Mew,
Charizard, Excadrill, Heat/Wash Rotom, edited form types, type-ID boundaries
(including Upgrade's ID 17), long names, mono/dual changes, sibling navigation,
malformed personal data, allocation failure and cleanup. Native-font/ROM-art
previews (`info-W2-header-mew.png`, `info-W2-header-charizard.png`, the long-name
preview and their B2 counterparts) were generated; the W2 layouts were visually
inspected. These are reconstructed previews, not live game captures.

The loaded ROM supplies archive `a/0/8/2` type characters at `34+type`, palette
member 33, cell 60 and animation 63. Both retail resource sets were inspected:
cell zero is a centered 32x16 OAM object with offsets (-16,-8), and animation
zero is a single fixed frame. Runtime never rewrites either OBJ palette or
shared archives. The native queue briefly loads/frees a character file; existing
actors/resources remain owned and freed by the tutor. Idle icon animation and
requirement paging do not reload header graphics.

Both viewer DLLs are 18,352 bytes (18,368 expanded; 14,872 code; BSS 8), an
increase of 224 file/expanded bytes and 188 code bytes over 1.4.2. Info state
grows four bytes to 10,380 on application heap 79 and is released on exit.
Both menu DLLs remain 3,328 bytes (3,344 expanded; 2,292 code; BSS 8), with
only paired version metadata changing. No new battle-resident allocation.

82 focused installer/PMC/export tests, host logic tests, compiled wrapper and
divider-graphics checks, and the production build pass. Real-ROM installation
checks pass for updating both 1.4.2 Upgrade test ROMs and for clean W2 with
enhanced menu installed first / clean B2 with enhanced menu installed last.
Export/reload and repeated installation preserve shared tutor text and graphics.
The new private `{0}` title message is allocated/reused, not written over the
previous title. Both newly exported test ROMs pass 900-frame boot checks with
the matching bundled battery save; this is not an interactive UI acceptance test.

Test ROMs in the outer Repos directory:

- `White2Upgrade-LEARNSET-1.4.3-header-test.nds`
- `Black2Upgrade-LEARNSET-1.4.3-header-test.nds`

Manual checklist: open a single- and dual-type Pokemon; verify the badges are
centered in the black strip, follow the name, and do not overlap the party cue.
Browse a family and alternate forms, then switch real party slots; confirm the
types update and an unused second badge disappears. Check a long species name,
scroll the lower list, close/reopen, and confirm ordinary RELEARN is unchanged.
Start fresh from battery save rather than a state holding older loaded DLLs.

## Earlier releases

Version 1.4.2 adds terminal-stage predecessor requirements under the retained
"Does not evolve further." heading. It uses the graph's deterministic immediate
parent, or the verified parent hint from L/R navigation, then filters that
parent's ROM slots by resolved target species/form. It does not substitute the
first sibling's requirement or infer the party Pokemon's evolution history.
Only the last matching method/parameter pair in ROM slot order is shown;
alternative methods do not create pages. The native-font body begins at Y=156,
wraps through Y=172, and A shows longer-text continuation pages while retaining
the heading, chain, and selection.
Nonterminal, unevolved, malformed, and allocation-failure displays retain their
previous behavior. The new private "From {0}: {1}" template is appended after
all existing message keys; installation reuses old texts/IDs and adds only the
missing entry. Both companions are versioned 1.4.2; hook sites and ABI 3 stay
unchanged, and the old 1.4.1 configuration is detected as requiring an update.

The focused compiled `verify_info.py --terminal-only` suite covers Flareon,
Dragonite, branching siblings, edited KO/battle/unknown methods, multiple incoming
slots (last match wins, later siblings are excluded, A does not cycle methods),
seven/eight-slot records, long wrapped text, deterministic/overridden
parents, alternate-form targets, invalid hints, unchanged nonterminal/unevolved
text, malformed data, in-place L/R refresh, read-only party data and cleanup.
It writes native 256x192 previews including `info-W2-flareon-incoming.png` and
the matching B2 preview. The footer change uses existing requirement/page buffers:
retained info state remains 10,376 bytes, and paging performs no ROM reads or
allocations. Temporary name/template strings and archive buffers close before
the viewer becomes interactive. The menu has no new executable code or state.

Compared with 1.4.1, both stripped viewer DLLs grow 480 bytes on disk (18,128),
480 expanded bytes (18,144), and 428 code bytes (14,684); BSS remains 8 bytes.
Menu size remains 3,328 bytes and only its paired version metadata changes.
The focused installer/export suite passes all 80 tests and the production build
passes. The full suite initially passed 1,272 tests (one skipped) with 11
map-import timeouts under concurrent load; all 15 tests in that affected file
pass on an isolated one-worker rerun without changing timeouts. That is 1,283
passing tests across the full run and isolated retry, not one clean full run.
The older release measurements and checks below are retained as history.

Version 1.4.1 fixes the palette-bank error introduced in 1.3.8. The provided
capture's upper fill was RGB555 `0x51df`, exactly main OBJ entry 17; sub BG
entry 17 was the intended `0x77bd`. DS SDK memory maps confirm main OBJ at
`0x05000200` and sub BG at `0x05000400`. The runtime now uses an explicit
sub-BG pointer. The earlier harness repeated the incorrect address assumption;
it now seeds distinct OBJ sentinel colors and verifies both OBJ banks and the
entire lower palette stay unchanged. Changing sprite colors cannot recolor the
panels. Corrected W2/B2 native-font/icon previews and palette tests pass.

L/R family browsing now updates in place without sequence 8, native End/Init,
field dispatch, window recreation, or overlay reload. The shared bounded
learnset reader runs on application heap 79. A new native list and all its name
strings are prepared before replacing the old list; list/bank/string allocation
failures keep the old view untouched. The info allocation is reused, and native
list deletion owns the replaced/current strings. Compiled tests cover repeated
valid/empty/malformed transitions, cursor/scroll/detail resets, list ownership,
failure rollback, no black-fade state, and unchanged real party data.
D-pad party navigation still uses the original fade/relaunch lifecycle.

New helper references are verified separately against each US binary:
W2/B2 list create `0x02024f8d/0x02024f61`, list delete
`0x02024fd9/0x02024fad`, and cursor reset `0x0202ba91/0x0202ba65`.
Installer signatures also cover overlay-258 list redraw/count/ownership,
selected-cursor, and scroll-control/arrow routines. No hook sites are added.
VBlank consumes pending type-icon requests, not the move-name list being
replaced in the foreground.

Version 1.4.0 changes the focused species with L/R and animates only that icon.
The virtual selection drives both the upper info and the rebuilt lower learnset;
the real party Pokemon pointer/data and return slot do not change. D-pad party
navigation resets the virtual selection. A now cycles requirement/continuation
pages without changing the icon window or focus. Its original family fade path
is superseded by the in-place 1.4.1 refresh described above.

Forward navigation follows a branch target's own evolution first. Terminal
stages advance to a next sibling in source-slot order, searching earlier
ancestors if needed. Backward selects a previous sibling, or returns to its
source from the first sibling. Eevee's target highlight stays in place across
sibling switches, then moves to Eevee on L from the first target. Duplicated
target identities do not create duplicate navigation stops. Verified incoming
parent hints preserve the followed edge when a target has several predecessors.
The parent search uses a bounded 512-byte stack visited set; cycles cannot
cause an unbounded scan and the visible chain remains at most three identities.

Request ABI 3 is 260 bytes (16 bytes more than ABI 2); it holds only current/
pending virtual identity and parent hints in addition to the existing fields.
Both older ABIs are rejected before native initialization. Compiled bridge
tests verify family transitions, regenerated virtual/form learnsets, cleared
pending state, party navigation reset, unchanged party bytes, return-slot
restoration and paired teardown. Host navigation tests cover normal families,
siblings, descendants, duplicated targets, forms, self/circular/malformed
parent links and bounded endpoints. ROM-backed tests exercise Nidoran's family,
all retail Eevee targets and Wurmple's descendant-before-sibling sequence.

Version 1.3.10 adds the native healthy party-icon idle animation: two 32x32
poses, eight viewer ticks each, at fixed positions inside stationary borders.
Cell animation is separate from the party menu's selected-slot position hop.
This viewer uses the idle sequence for all informational species, not
HP/status speed changes or that separate six-pixel hop.

Both US ROMs independently verify `a/0/0/7` NANR members 2/4/6 sequence 1 as
cells 0/1 for eight video frames each, forward looping. NCGR members contain
1024 bytes of pose data at offset 48. Both poses are copied from the same
1072-byte read already used before; the runtime does no extra filesystem work.
The existing bitmap-character upload routine (W2 `0x02048271`, B2
`0x02048245`) updates changed icon pixels without remaking the palette map or
redrawing text. No new hook or palette bank is needed.

Animation tests check exact ROM bytes for both poses and wraparound, one-/two-/
three-icon chains, alternate forms, branch changes during pose 1, unchanged
text/frame/palettes/tilemap, no tick-time allocation or reads, static missing-icon
placeholders, wrong-context calls and safe calls after cleanup. Updates stop
outside the active viewer input state. Starting a new party-slot viewer resets
the timer; the entire two-pose cache is freed on exit.

Version 1.3.9 extends the right-panel left shade from Y=41 through Y=130,
following both clipped corners without changing the outer frame. Its existing
ability rules remain at Y=100/116. The icon-area content palette reuses the
same shade/edge colors in otherwise unused indices 5/2; native icon palettes,
the selected frame, font shadows, panel fill, footer and lower screen remain
unchanged. Compiled checks assert the full-height strip and no new icon-area
horizontal rules. No new allocation, palette bank, hook or resource is added.
Nidorina preview comparisons against 1.3.8 change exactly 172 pixels in each
game, all in the newly extended strip; every other pixel remains identical.

Version 1.3.8 uses the lower description panel's light fill for both upper
panels and restores visible native font shadows on stats and ability names.
The same native font handle/measurement remains in use. Primary dark ink and
shadow colors come from ROM font palette entries 1/2, already loaded into main
and sub bank 15. They map to private indices 6/14; hidden-ability foreground
remains purple. White title/footer text is unchanged.

The ability list now has the lower description's three-pixel left shade,
one-pixel edge and horizontal rules at Y=100/116. Its existing text baselines
and clipped outer border remain. Native lower palette indices 17/19/21 supply
the fill, rule and shade. Build-time samples verify these mappings on W2/B2.
Private bank 8 covers upper-right tiles X=14..31, Y=10..16, preserving the
selected-frame bottom and gutter colors where those tiles overlap.

Dark text uses foreground/shadow/background indices 1/2/0. US overlay 258
independently confirms font archive 23/member 5 is
loaded at palette offset 480 on both screens: W2 `0x02199f4e..0x02199f82`,
B2 `0x02199f0e..0x02199f42`. Installation now validates that non-hooked region.
Compiled tests assert every visible upper glyph-shadow pixel, exact palette
matches, custom ROM palette colors, ability strip geometry, unchanged entire
lower palette, wrapping, selected-frame colors and cleanup. No new hooks,
font assets, ROM reads or heap allocations are added.

Version 1.3.7 darkens only the selected sprite frame to `#207878`, stored as
RGB555 `0x3de4` at index 7 in content palette bank 9. Compiled pixel/palette
checks assert that the frame keeps its one-pixel geometry and that title and
fin teal, pale fills, text, native icon palettes, and all other colors remain
unchanged. No new reads, allocations, hooks or lower-screen changes are added.
Pixel comparisons against the 1.3.6 Nidorina previews verify that exactly the
140 selected-frame pixels change in each game; every other pixel is identical.

Version 1.3.6 reverts the 1.3.5 move-bar color experiment. The description body
returns to charcoal, while the evolution/abilities inset now exactly matches
the pale gray stats-panel background (RGB555 `0x6f7b`). Icon transparency and
selected-card interiors match that fill. The inset border and selected teal
frame retain their colors and geometry. Ability text is dark with pale-matched
shadows, hidden abilities use a deeper purple, and arrows/continuation dots
use the existing dark border color. The title, gold bars, gutter, description
cap/hatches, borderless description body, and lower screen are unchanged.
Tests cover the matching fills, private palette boundaries, dark/purple ink,
right-arrow orientation, untouched icon bytes and cleanup. No runtime reads,
allocations, hooks, request data or controls change.

Version 1.3.4 changed the evolution/abilities inset to `#282830`. Its
opaque fill, selected-card interior and transparent icon backdrop match.
Content palette bank 9 copies bank 14 except private fill index 13; footer
bank 13 carries that index through the inset's last four rows. Tests check
palette boundaries, native icon palettes/bytes, matched transparent background,
unchanged text/shadows/inset borders/title, and cap < inset < body brightness.
The description body loses its left/right/bottom teal outline while retaining
its dark cap and teal hatches. Tests check all three formerly outlined edges.
Content positions, data paths, controls and allocations remain unchanged.

Version 1.3.3 changes only description-panel colors. The fin and top strip
use the same near-black fill; the body uses RGB555-quantized charcoal
(56,56,64). Teal hatch marks and side/bottom outlines remain. The four-pixel
gutter, every panel/text coordinate, font size, icon, title and control are
unchanged. Tests assert the matching cap colors and lighter body throughout
all text rows, including wrapped pages and allocation-failure presentation.

Version 1.3.2 is a renderer-only follow-up. A four-pixel slate-teal gutter
(Y=132–135) separates both upper panels, which now end at Y=131, from the fin
at Y=136. Stat baselines are Y=41+15*n and ability baselines Y=84/100/116;
font sizes, icons, title and footer text positions are unchanged. Palette bank
13 applies only to the final eight upper-screen tile rows, preserving every
color except the gutter fill and quieter footer outline. No shared ROM resource,
hook, request layout, data reader, allocation or lower-screen behavior changes.

Current verification uses both stripped builds, expanded native-font layout
checks (including all four gutter scanlines, maximum stats, all three abilities,
wrapped descriptions, palette boundaries, allocation failure and cleanup),
runtime/lower-graphics regressions, 78 focused tests, production build, privacy
audit and W2/B2 install/update/export/reload checks. Full data/branch/cycle
coverage below remains the 1.3.1 baseline; that long-running data suite was not
repeated for these spacing/palette-only changes.

Version 1.3.1 replaces the upper row grid with a clipped pale stats panel and a
single dark evolution/ability inset. Stat bars no longer have separate borders;
only the selected icon has a teal frame. The near-black description panel gets
a thin teal outline and a raised, hatched top-left fin. Text remains at
Y=140/156/172. Stats move up one pixel to Y=41+16*n so the last glyph's shadow
does not overwrite the fin. Native icons stay unscaled at Y=48–79; abilities
stay at Y=90/106/122. Their transparent pixels match the dark inset, avoiding
slate rectangles around sprites. Native title rails and the lower screen remain.

A measured header cue displays the physical party slot/count, with no arrows
for a one-member party. Invalid context omits it. Long species names preserve
the possessive suffix and leave at least eight pixels before the cue.
The prior 1.2.3 sources, bundled companions, installer model, preview and test
ROMs were preserved before editing; archive ownership metadata is normalized.

Existing D-pad party navigation remains: Right advances, Left goes backward,
both wrap and skip Eggs/empty slots, and one eligible Pokemon is a no-op.
Native fade/end/init refreshes both screens without entering the party menu.
B returns to the last viewed real party slot. L/R now changes the virtual
focused species; A pages its outgoing requirements. Lower-screen layout, read-only
behavior, buffered scans, and overlay scopes are unchanged from 1.1.3.

The ability list retains up to three distinct names from the selected form's
ROM slots. The A page indicator remains beside the requirement heading.

## Automated verification and 1.3.1 data baseline

- Both US W2/B2 companions build with warnings treated as errors, no undefined
  imports or static constructors, stripped RPM symbols, and priority 4.
  Overlay hashes and hook bytes are verified independently for each game.
- Host tests cover seven/eight-slot evolution records, malformed lengths and
  targets, unknown methods, first-slot branches, normal families, long chains,
  self-loops, two-node loops, the four-node Cascade example, inclusion of the
  selected identity, the hard three-icon limit, stat scaling, word wrapping,
  and bounds of the 4bpp bitmap renderer.
  Party traversal exhaustively covers both directions, party counts 0–7,
  every six-slot eligibility mask, invalid/current slots, wrapping and no-op.
- Compiled W2/B2 viewer tests use ROM personal/evolution records, actual ROM
  font glyphs and party icons, and the native icon-index/palette resolvers.
  Fixtures include Mew, Nidorina, Eevee, Dragonite, Heat Rotom, the supplied
  cycle, edited stats, a long species name, eight outgoing options,
  custom/unknown methods, missing icons, malformed evolution data, and failed
  info allocation. They check paging and repeated idempotent cleanup. Eevee's
  actual rendered icon tiles are compared with each ROM target during family
  navigation. A requirement pages wrap, retaining the focus and icon data;
  text paging never rescans personal/evolution/message archives.
  Optional read-buffer allocation failure uses the checked uncached path.
  Ability checks cover all three slots, duplicate/zero slots, alternate-form
  overrides, primary bank 487 and expanded-bank 374 names, numeric fallbacks,
  long-name truncation, Title Case, fixed left alignment and hidden text color.
  Host casing tests cover spaces, hyphens, apostrophes and accented letters.
  Pixel checks cover right-arrow orientation, aligned icon palette rectangles,
  gold bars and compact values. Both games' title rails match the retail map.
  Pixel checks verify the clipped pale boundary, shared inset outline/pale fill,
  selected-only frame, dark description cap, lighter borderless body and teal fin accents.
  The current layout checks additionally assert every pixel in all four gap rows,
  the dedicated footer palette colors and tilemap assignments, and unchanged
  title colors, native icon tiles and evolution-text baselines. The dark fin
  and top strip share a color, and the charcoal body is lighter in every RGB
  channel without changing other palette entries or text colors.
  Icon bytes are compared unchanged against the ROM for one-, two-, and
  three-stage families and paged branches. Party cues cover slots 1/2/6,
  one-member parties, invalid counts/slots and long titles. The request and
  Pokemon bytes remain unchanged. Background checks also
  run after evolution paging and allocation failure; old upper BG3 stays hidden.
- Tests execute the seven-argument window hook veneer, checking stack/register
  preservation, private upper-window dimensions, unchanged ordinary-tutor
  dimensions, and unchanged lower-window dimensions.
- Existing compiled wrappers still pass capacity, selection, request lifetime,
  read-only guards, rows/PP/scrolling, private divider, empty/missing-companion,
  repeated sessions, and ordinary-tutor delegation checks.
  New tests drive both compiled companions through repeated D-pad switches,
  native End/field dispatch/Init boundaries, Egg/empty-slot skips, form-specific
  move lists, empty and malformed learnsets, scroll resets, held input during
  fade, shoulder independence, B precedence, single-eligible no-op, final slot
  restoration, unchanged party bytes and exactly-once request release. The
  previous request ABI is rejected. Uninstrumented native calls are rejected
  by the wrapper harness instead of executing uninitialized memory.
- The previous green-background failure is reproduced and its fix verified
  using retail buffer routines on both games, including repeated native
  redraws after the temporary resource is freed. No capture file is required;
  `verify_graphics.py CAPTURE.dst` optionally uses captured W2 RAM instead.
- Before the 1.4.1 follow-up, 1,269 tests passed, with one skipped, across 132
  files using two Vitest workers. The 1.4.1 focused installer/export rerun
  passes all 35 tests.
  The initial fully parallel run timed out two unrelated map-import tests;
  both pass without timeout changes when worker concurrency is capped.
  The production build
  passes, with the existing large-JavaScript-chunk warnings.
- Clean W2/B2 pass install/export/reload with enhanced menu installed in both
  orders across the release checks. Upgrade B2 passes update from 1.4.0 and
  export/reload with the paired 1.4.1 companions. The subsequent markerless-PMC
  fix below adds fresh W2 Upgrade installation and startup checks.
  Checks include update detection, idempotence, private text reuse,
  unchanged shared tutor strings/graphics archives, and staged removal/reinstall.

The instrumented runtime checks assert that selected Pokemon memory is
unchanged and tracked allocations/files are released. They do not emulate the
entire game's renderer, input loop, filesystem latency, or allocator pressure.

## Test-launch startup regression

The reported Black 2 capture stops before PMC or either LEARNSET module loads.
The supplied 1.3.4 ROM boots, but the old second-stage `NintendoDSRom.save()`
used by Test Warp/Battle rewrote files in logical file-ID order. That moved
PMC's overlay from ROM offset `0x000a7e00` to `0x129e4c00`, beyond 256 MiB.
Repacking with that order reproduced the exact browser-core failure:
`ARM9: Undefined instruction: 0x1C281C22 PC=0x0000003C`.

The ROM writer now preserves incoming physical order for existing files;
explicit placement priorities still take precedence, and new files append
unless prioritized. Logical IDs, FNT references, ARM9 and DLLs are unchanged.
Regression tests cover repeated rebuilds, replacements, inserted/appended
files, explicit priority overrides and unchanged startup bytes. The complete
suite passes: 1,269 tests, one skipped, across 132 files. Production build and
privacy checks pass. This is a Pokeweb export fix, not a DLL release.

`scripts/verify-test-warp-export.ts` exercises the actual selected-tile warp
export, checks early PMC placement and unchanged modules, and optionally writes
an exclusively created ROM/save pair. `scripts/verify-desmond-boot.cjs` uses
the bundled browser core headlessly with read-only ROM/save inputs, rejects
undefined instructions, and checks visible output and a valid final ARM9 PC.
The broken B2 repack fails this check; the corrected B2 warp export with its
bundled save passes 900 frames (97,920 non-white pixels). This is a boot smoke
check, not a new live verification of the LEARNSET controls or battles.

The W2 physical-order/export assertions also passed, but both its existing
1.3.4 input ROM and the regenerated warp ROM hit an error at `0x02208118`
(instruction `0xB600`). This was initially classified as an unresolved baseline
failure. The later original-ROM investigation below identifies the duplicated
PMC loader as the W2 startup failure; it is not a viewer-heap or palette issue.
Do not use those earlier failed diagnostic exports.

The corrected B2 launch pair is `Black2Upgrade-LEARNSET-1.3.4-warp-bootfix.nds`
and the matching `.dsv` in the outer Repos folder. Existing ROMs/saves were not
overwritten. Refresh Pokeweb and launch Test Warp again, or boot the corrected
pair directly. Do not restore the frozen state.

## Markerless PMC startup regression

The original W2 Upgrade ROM contains an active CTRMap PMC 13.2.0 loader in
anonymous overlay 344 at `0x021fd0c0`, with a `0x3000` file-backed image and
zero BSS. It has neither Pokeweb's overlay marker nor its named overlay file.
Previously, installing LEARNSET created PMC 13.2.4 in overlay 345 at
`0x022000c0`. The bundled startup wrapper's overlay literal remained 344 while
its call moved to `0x022005b4` in the unloaded new overlay. The provided state
contains the original RPM image, zeros at that new entry point, and neither
LEARNSET signature. The old installer was reproduced exactly: frame 8 stops
at `0x02208114` with undefined instruction `0xB29C`.

Detection now verifies US game identity, RPM metadata/base, overlay image and
initializers, and the complete active main-to-wrapper/load/entry call chain.
Both US games retain their original PMC installation on import and through
LEARNSET install/update/export/reload. Old project state can adopt this metadata
without changing ROM files. An unrecognized occupied overlay 344 is rejected
rather than adding a second loader; a previously exported overlay-345 loader
is explicitly incompatible with LEARNSET and requires the original input ROM.
Explicit Update PMC remains a separate operation with its external-layout warning.

Regression tests cover W2/B2 markerless and anonymous layouts, unchanged loader
bytes/table/startup, retained staged modules, stale project state, and bad game,
base, literal, entry point, RPM, wrapper, inactive caller and overlay-load call.
Integration checks compare the original/extracted PMC image and overlay table,
plus ARM9 code (allowing SDK compressed-static-end normalization and independent
Battle Log patches in enhanced-menu tests). Shared tutor data stays unchanged.

Fresh W2 Upgrade install/idempotence/removal/reinstall/export/reload passes.
Enhanced-menu installation passes in both orders on that same markerless W2
input, and a clean B2 install/export/reload also passes. The full final suite
passes 1,281 tests (one skipped) across 132 files with two workers. The production
build passes with existing chunk/import warnings. Source snapshots and privacy
checks are refreshed; no private machine paths are stored in these reports.
The corrected trainer-1 and warp-test rebuilds preserve overlay 344 and its early
physical placement (`0x3c2800`). Both run 900 frames with the matching Upgrade
saves in the bundled headless core without undefined instructions, with 345
and 324 distinct framebuffer colors respectively. These are startup smoke
checks, not new live-game LEARNSET or battle-play verification. Using a different
game's bundled battery save is not a valid Upgrade startup check.

The corrected base export is `White2Upgrade-LEARNSET-1.4.1-PMC-fix-test.nds`
in the outer Repos folder. The original ROM and all supplied states are untouched.
Refresh Pokeweb, load the original White2Upgrade ROM, install Learnset Viewer,
and create a new test launch; do not reuse an earlier broken export or state.
No DLL changes, new hooks, allocations, or overlay-lifetime changes are part
of this installer fix.

## Memory and lifetime

This section records the historical 1.4.1 baseline; later release deltas are
recorded above. In particular, 1.4.4 retains the graph until session teardown
instead of freeing it after every refresh as described in this older baseline.
Sizes are bytes from the stripped RPMs; W2 and B2 have the same sizes.

| Companion | File | Expanded | Post-fix | Code | BSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Menu | 3,328 | 3,344 | 3,080 | 2,292 | 8 |
| Viewer | 17,648 | 17,664 | 16,436 | 14,256 | 8 |

Compared with 1.4.0, menu file/expanded sizes grow 144 bytes, post-fix grows
96 bytes and code grows 52 bytes. Viewer file/expanded sizes grow 1,584 bytes,
post-fix grows 1,472 bytes and code grows 1,404 bytes. BSS stays unchanged.
The second icon poses add 1,536 bytes to the session-owned info state. The
two counters fit existing alignment padding; the allocation count is unchanged.
The retained info state gains another 16 bytes for navigation destinations,
to 10,376 bytes. This memory
is freed by `infoEnd` before overlay teardown, never retained for battles.
Idle ticks perform no allocations or ROM reads. Ability bank 8 (added in
1.3.8) uses 32 bytes of existing upper-screen hardware palette RAM, alongside the
existing 32-byte content and footer banks; this is not PMC or tutor heap memory.
The header cue's earlier 24-byte state addition is retained. Version 1.4.1
adds no retained state, private messages or hook sites. During family refresh,
the old and replacement native move-name lists briefly coexist; each list is
at most 264 bytes plus up to 32 ROM name strings. The prior list is freed
before rebuilding info. A 260-byte tentative request is held on the stack;
no second info-state/graphics allocation is retained.
Viewer code remains scoped to overlay 258. The existing overlay-12/165 menu
lifetime is unchanged, so its code growth may be present during
battle; there is no new persistent state or battle-time allocation. The
field-owned request is 260 bytes and is reused across party/family
switches, then freed on exit. Heap 79 persists across family switches and is
destroyed before each D-pad relaunch or final exit; one info state is reused.
Temporary graph/archive data is freed after each refresh. This does
not implement the deferred menu/field-bridge lifetime redesign.

The full upper bitmap plus two tiny retained native windows uses 24,640 bytes
of bitmap payload, an increase of 14,784 bytes over the original upper windows.
Native tutor cleanup owns and releases these buffers. Info state, icon pixels,
strings, and the bounded temporary graph use the tutor application heap (79),
not PMC's heap. The graph is freed during initialization; info state is freed
before native viewer teardown, and its global pointer is cleared first.

Only one 5,136-byte archive scan cache is allocated at a time (1 KiB FAT,
4 KiB record data, and 16 bytes of bookkeeping). It is freed after each scan.
At most two native message-bank handles are retained during initialization:
the private bank and one name bank, never all name banks together. They close
before initialization returns. Eight compact chain snapshots and three reusable
icon slots remain only until viewer exit; no full graph or ROM-read cache is
retained across sessions.

Before the second icon pose was cached, the clean-ROM normal/form fixtures
peaked at 21,118 bytes of instrumented info allocations. The current opening
measurements peak at 22,652 bytes for Mew and 22,654 for Eevee in both games.
These figures include the
instrumented graph/state/read cache/string handles,
**not** native window allocations, real message-bank internals, filesystem
internals, or allocator headers. It is not a total live-game heap measurement.
Graph capacity is bounded to 4,096 personal records; malformed or allocation-
failure paths show unavailable information without modifying the Pokemon.

## Loading measurements

The same compiled harness was run on 1.1.2 before rebuilding and on 1.1.3;
1.3.10 retained those upper-info opening counts. In 1.4.0, family destinations
are also read through the same bounded cache during initialization. Native
fade/initialization still runs for D-pad party switches. In 1.4.1, family
switches reuse the current app and read the new info/learnset without a fade.
The old display remains visible during reads; zero latency is not claimed.
Both US games give the same directly instrumented filesystem call counts:

| Fixture | 1.1.2 reads | 1.1.3 reads | Message-bank opens, old → new |
| --- | ---: | ---: | ---: |
| Mew | 4,249 | 81 | 13 → 3 |
| Eevee | 4,291 | 87 | 32 → 10 |

Personal/evolution scans alone drop from 4,211 reads to 63. Eevee's directly
read byte count rises slightly, from 155,472 to 166,760, because of read-ahead.
This trades a small amount of bounded temporary memory and extra sequential
data for far fewer tiny filesystem operations. The measurements exclude reads
inside native message routines, and are not live-game elapsed time or a claim
that the reported 2–3 second delay has been eliminated. The `--io-only` option
on `verify_info.py` reproduces current counts in `build/info-io.json`.

## Previews and test ROMs

`verify_info.py` writes 256x192 PNGs under ignored `build/`, including
`info-W2-mew.png`, `info-W2-nidorina.png`, `info-W2-eevee.png`,
`info-W2-rotom.png`, `info-W2-cycle-516.png`, and
`info-W2-long-name-8-options.png`, with B2 equivalents.
These render compiled viewer output using the ROM font/icon assets at
instrumented presentation boundaries; they are not emulator screenshots.

The earlier 1.4.1 Upgrade test exports in the outer Repos folder are
`Black2Upgrade-LEARNSET-1.4.1-test.nds` and
`White2Upgrade-LEARNSET-1.4.1-PMC-fix-test.nds`. Both W2/B2 bundled companions
are updated. The W2 installer fix and new startup checks are documented above;
compiled layout checks are not live-game UI verification.
The new B2 export passes 900 frames with the bundled save in the headless
browser core. This verifies boot, not a complete live LEARNSET session.

Version 1.4.2 updates of those ROMs are saved as
`White2Upgrade-LEARNSET-1.4.2-last-method-test.nds` and
`Black2Upgrade-LEARNSET-1.4.2-last-method-test.nds`. Originals remain unchanged.
These supersede the initial 1.4.2 drafts that paged incoming methods. Verify a
terminal stage such as Flareon in the emulator, then L/R back to Eevee and
forward to a different branch; each footer should name its actual predecessor
and correct ROM requirement while the lower learnset follows the selected icon.
Both final exports pass 900-frame headless startup checks with the matching
bundled saves. These checks verify boot, not interactive LEARNSET behavior.

The 1.2.3 test ROMs remain the pre-redesign rollback. Intermediate 1.3.0
exports do not include the final shared inset and should not be used for
acceptance of this design.

Original input ROMs were not overwritten. Refresh Pokeweb, update the paired
Learnset Viewer patch and export, or use the named exports. Start from boot:
an old emulator save state restores old loaded DLL code and graphics state.

## Live-game acceptance checklist

1. Open Mew's LEARNSET: species title (not nickname), six ROM base stats,
   centered highlighted icon, "Does not evolve.", and no old learned-move
   panel/name box/large sprite. Check an evolved species with no outgoing link.
   Check the retail title rails, clipped pale stats panel, single light
   evolution/ability inset and stats fill matching the lower description background,
   with a selected-only dark teal frame. Icon
   transparency and the selected-card interior must match the inset shade.
   Stats and ability names should match the lower description's dark foreground
   and visible glyph shadow; hidden abilities stay purple. The ability list
   has subtle 16-pixel rules and a shaded left edge reaching the top of the
   entire right panel. Arrows and icon positions stay unchanged. Only the
   highlighted icon should alternate between its two native poses; frames must not flicker,
   change colors, disturb the text or leave trails. Missing icons stay static.
   No old body row grid
   should remain. The description panel must have a matching dark fin/top strip,
   a lighter charcoal text body, and teal hatch accents without left/right/bottom borders.
   Confirm four uninterrupted rows of slate-teal space across
   both upper panels, with no stat/ability glyphs or pale fill touching the fin.
   Check that the last stat/ability glyph rows retain their correct colors where
   the private palette begins at Y=128; the title and dark selected frame stay unchanged.
2. Check Nidorina and a two-stage family, alternate forms, edited stats, and
   long species names. The selected stage stays highlighted and its stats/title
   remain fixed. Check bars, icon colors, shadows, and all edges at native scale.
   Confirm tighter stat spacing and gold bars. Check Eevee's three ability
   names, a species with one ability, and an alternate form with edited slots.
   Hidden names must be purple, blank slots absent, and duplicates shown once.
   Icon arrows point right; ability names align left in Title Case. Evolution
   ordering and requirement text are unchanged.
3. On Nidorina, L selects Nidoran and R selects Nidoqueen, updating both screens
   and moving the sole animated highlight. On Eevee, R selects the first
   target and subsequent R presses advance its siblings. L must replace a
   later target in the same highlighted position, moving back to Eevee only
   from the first target. At endpoints, L/R does nothing. Check Wurmple:
   R follows Silcoon to Beautifly before advancing to Cascoon. L/R must not
   flash black or leave the screen. Scroll to the last move before switching:
   the new list must reset to its first row, with matching type/details/PP.
   Switch between long, short and empty lists to check stale rows/cursors.
   Use A for long requirements and continuation pages, referenced ROM names,
   and custom numeric methods. Text paging keeps the same chain; self/ancestor targets
   never duplicate an icon. Compare first-open and repeated-open loading time
   against 1.1.2 on the same ROM and emulator settings.
4. In a hack, check long chains and the four-node cycle from each selected
   stage. Also check self/two-node loops. Never display more than three distinct
   icons or wait for a terminal evolution; markers must not be wraparound arrows.
5. Check all lower rows, scrolling, touch selection, details, PP and icon gap.
   A must not teach; B/return must close immediately to the selected party slot.
   Exercise empty/error learnsets and missing/corrupt info resources.
6. Press D-pad Right from slot 1: slot 2 must load; Left must go back. Check
   both wrap directions, Eggs between eligible Pokemon, fainted members,
   one eligible member, and empty/error learnsets. Both screens must refresh,
   and the header cue must reflect the physical slot without overlapping the title.
   The virtual family selection, move list and requirement page must reset.
   Hold a direction during the fade: no duplicate queued switch.
   B/return must reopen the party menu at the last viewed slot.
   Reopen repeatedly across party slots/forms, then use normal RELEARN/tutors.
   Confirm original tutor rendering/behavior and unchanged Pokemon moves, PP,
   items, counters and saved data. Check allocation-failure dismissal where
   a debug harness is available.
7. Repeat on vanilla/Upgrade W2/B2 with both enhanced-menu installation orders.
   Inspect a subsequent battle to confirm overlay-258 viewer is absent; the
   existing overlay-12 menu companion behavior is intentionally unchanged.
