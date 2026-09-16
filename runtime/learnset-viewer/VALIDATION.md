# LEARNSET 1.2.0 validation

Release checks performed on 2026-09-16. These are automated host tests,
isolated compiled-Thumb tests, ROM inspection, and export/reload checks.
**A complete live-game session has not been verified for this release.**

Version 1.2.0 adds D-pad party navigation: Right advances, Left goes backward,
both wrap and skip Eggs/empty slots, and one eligible Pokemon is a no-op.
Native fade/end/init refreshes both screens without entering the party menu.
B returns to the last viewed slot. L/R still changes the outgoing evolution
option without changing the selected Pokemon. Lower-screen layout, read-only
behavior, buffered scans, and overlay scopes are unchanged from 1.1.3.

The ability list retains up to three distinct names from the selected form's
ROM slots. The L/R indicator remains beside the requirement heading.

## Automated coverage

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
  actual rendered icon tiles are compared with each ROM target in both L/R
  directions, including wrap. Continuation pages and repeated target options
  reuse icon data; paging never rescans personal/evolution/message archives.
  Optional read-buffer allocation failure uses the checked uncached path.
  Ability checks cover all three slots, duplicate/zero slots, alternate-form
  overrides, primary bank 487 and expanded-bank 374 names, numeric fallbacks,
  long-name truncation, Title Case, fixed left alignment and hidden text color.
  Host casing tests cover spaces, hyphens, apostrophes and accented letters.
  Pixel checks cover right-arrow orientation, raised icon palette rectangles,
  gold bars and compact values.
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
- 55 focused LEARNSET, enhanced-menu and PMC tests pass. The production build
  passes, with the existing large-JavaScript-chunk warnings.
- Clean W2/B2 pass install/export/reload with enhanced menu installed in both
  orders. Existing Upgrade W2/B2 pass update from 1.1.3 and export/reload with the paired 1.2.0
  companions. Checks include update detection, idempotence, private text reuse,
  unchanged shared tutor strings/graphics archives, and staged removal/reinstall.

The instrumented runtime checks assert that selected Pokemon memory is
unchanged and tracked allocations/files are released. They do not emulate the
entire game's renderer, input loop, filesystem latency, or allocator pressure.

## Memory and lifetime

Sizes are bytes from the stripped RPMs; W2 and B2 have the same sizes.

| Companion | File | Expanded | Post-fix | Code | BSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Menu | 3,056 | 3,072 | 2,856 | 2,104 | 8 |
| Viewer | 13,552 | 13,568 | 12,596 | 10,616 | 8 |

Compared with 1.1.3, the viewer adds 224 post-fix bytes and the menu adds 272.
Viewer code remains scoped to overlay 258. The existing overlay-12/165 menu
lifetime is unchanged, so its additional 272 fixed bytes may be present during
battle; there is no new persistent state or battle-time allocation. The
field-owned request grows from 236 to 244 bytes and is reused across party
switches, then freed on exit. Viewer heap 79 is destroyed before each relaunch,
so multiple Pokemon's screens/graphs are never retained together. This does
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

For the clean-ROM normal/form fixtures, instrumented info allocations peak at
21,094 bytes. This figure includes the instrumented graph/state/read cache/string handles,
**not** native window allocations, real message-bank internals, filesystem
internals, or allocator headers. It is not a total live-game heap measurement.
Graph capacity is bounded to 4,096 personal records; malformed or allocation-
failure paths show unavailable information without modifying the Pokemon.

## Loading measurements

The same compiled harness was run on 1.1.2 before rebuilding and on 1.1.3;
1.2.0 retains those upper-info opening counts. Native fade/initialization runs
again for each party switch; a zero-latency switch is not claimed.
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

Upgrade test exports in the outer Repos folder:

- `White2Upgrade-LEARNSET-1.2.0-test.nds`
- `Black2Upgrade-LEARNSET-1.2.0-test.nds`

Original input ROMs were not overwritten. Refresh Pokeweb, update the paired
Learnset Viewer patch and export, or use the named exports. Start from boot:
an old emulator save state restores old loaded DLL code and graphics state.

## Live-game acceptance checklist

1. Open Mew's LEARNSET: species title (not nickname), six ROM base stats,
   centered highlighted icon, "Does not evolve.", and no old learned-move
   panel/name box/large sprite. Check an evolved species with no outgoing link.
2. Check Nidorina and a two-stage family, alternate forms, edited stats, and
   long species names. The selected stage stays highlighted and its stats/title
   remain fixed. Check bars, icon colors, shadows, and all edges at native scale.
   Confirm tighter stat spacing and gold bars. Check Eevee's three ability
   names, a species with one ability, and an alternate form with edited slots.
   Hidden names must be purple, blank slots absent, and duplicates shown once.
   Icon arrows point right; ability names align left in Title Case. Evolution
   ordering and requirement text are unchanged.
3. On Eevee, press L/R through every evolution and back. Test long requirements
   with continuation pages, item/move/species names and a custom numeric method.
   The outgoing icon must match each option, with its own subsequent stage
   when space permits. The selected Pokemon's stats/title/abilities and border
   stay fixed. Continuation pages keep the same chain; self/ancestor targets
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
   the move list and evolution page must reset, and L/R must still page only
   evolutions. Hold a direction during the fade: no duplicate queued switch.
   B/return must reopen the party menu at the last viewed slot.
   Reopen repeatedly across party slots/forms, then use normal RELEARN/tutors.
   Confirm original tutor rendering/behavior and unchanged Pokemon moves, PP,
   items, counters and saved data. Check allocation-failure dismissal where
   a debug harness is available.
7. Repeat on vanilla/Upgrade W2/B2 with both enhanced-menu installation orders.
   Inspect a subsequent battle to confirm overlay-258 viewer is absent; the
   existing overlay-12 menu companion behavior is intentionally unchanged.
