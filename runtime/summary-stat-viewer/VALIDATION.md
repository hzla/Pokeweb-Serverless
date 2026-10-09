# Summary IV/EV Viewer validation

BW2 validation date: 2026-10-05. Version: 1.0.3.

**BW2 implementation and automated checks are complete. BW2 live game
acceptance remains pending.** No game emulator was run for the BW2 checks
below, and their real-ROM exports were performed in memory.

## BW1 port status (2026-10-08)

Black 1 and White 1 US revision 0 candidates compile separately and pass the
native harness. The harness executes retail ARM/Thumb helpers and Summary
code, checks register/stack preservation,
IV/EV controls and numeric ordering, exact native title pixels, allocation
failures, and repeated cleanup. Supporting getters and upload APIs remain
instrumented doubles; these results are distinct from gameplay acceptance.
The BW1 harness repeats these checks with Summary work, parameters, Pokémon,
and Stats objects in extended RAM. This checks pointer use by compiled code;
it does not boot in DSi mode or exercise native DSi heap allocation.

Installer tests cover both BW1 profiles, both acceptance flags, wrong
revision, automatic PMC installation, recognized reinstalls, retained EV
settings after export/reopen, duplicate and conflicting modules, changed
code/resources, staged removal, rollback, and Battle Log companion overlap.
Real-ROM validation exports exercise the normal installer with PMC absent
in Black and present in White, then reopen and change settings in place.
Native Summary overlays and graphics members, and source ROM hashes remain
unchanged.

DS-mode cold-boot checks with copied battery data have exercised normal
Summary appearance, IV/EV values and title lettering, keyboard navigation,
Pokémon switching, touch access, and exit/re-entry in both games. The
corrected BW1 Battle Log runtime (version 7) also opens its counter display
alongside the viewer. Version 7 removes an unresolved compiler-generated
memory-copy import that previously stalled the Summary counter draw.

**Both BW1 profiles passed the recorded DS release checks.** Separate copied-save fixtures also
exercise Heat Rotom with distinct IVs and EVs up to 255 in both games. Direct
Egg entry retains native Status-only navigation; switching from Stats/IVs/EVs
skips Eggs. IV-only gameplay retains IVs, omits EVs, and returns to normal Stats
in both games. Black's combined IV-only session also retains native HP-bar
pixels and all party bytes.
Combined builds also pass scoped normal Status/Stats/IV/EV and move-detail
navigation with Battle Log and the other four patches installed. Native
RELEARN uses its restricted move-selection Summary and replaces a move normally
in both games. Boxed Mewtwo displays IVs in native stat order, matching the stored
PK5 values; all 720 stored Pokémon remain byte-for-byte unchanged in both
captured sessions. A separately seeded boxed Ribbon exercises native Ribbons,
the four-tab footer, Left navigation, IV-tab touch and Pokémon switching in
both games; all stored Pokémon remain unchanged after exit. Combined builds
also return from KO learning, post-battle evolution and cold save reload to
working Learnset and EV pages without changing the reloaded party. These
observations are part of the BW1 DS matrix, alongside the further checks below.
Six-member combined parties show Shedinja's native 1/1 HP with IVs and EVs.
Six additional cold boots exercise yellow, red and empty HP bars in both
games. Exact native bar pixels persist through Stats/IVs/EVs; all 1,320 party
bytes and six checksums remain unchanged, with exit cleanup confirmed.
Five additional complete Summary entry/exit cycles in each game retain all
1,320 party bytes and leave work/actor/unit pointers cleared and all three
character registrations released. Menu/viewer/Summary → wild battle → field →
Learnset/IVs/EVs/party transitions work in the same native sessions. Post-battle
menu browsing retains all six Pokémon records and their checksums; Summary
exit again clears its working pointers and graphics registrations.
The [BW1 release record](../BW1_UI_RELEASE.md) identifies the tested builds and
separates DS gameplay evidence from compiled checks and pending BW2 acceptance.
Live DSi acceptance is pending. Separately named validation ROMs and emulator
captures are local output, not distributed acceptance artifacts. Original
ROMs and user saves are preserved.

## Automated results

| Check | Result | Scope |
| --- | --- | --- |
| Native builds | Pass, B2 and W2 | Separate retail overlay pins, all 17 hook destinations, explicit ARM9 mappings checked against retail bodies/call sites, helper/layout signatures, native graphics pins, no unresolved imports, RPM parse/dump |
| Native Thumb harness | Pass, B2 and W2 | Compiled wrappers and hook veneers; real retail sound wrapper, touch scanner, conditional sequence setter, numeric drawing, and SkillUpdate/top-display code; stack/register preservation; IV/EV ordering/extremes; EV/Ribbons on/off; navigation endpoints; title-request lifetime; upload order; resource ownership/failure cleanup |
| Stats variant refresh | Pass, B2 and W2 in harness | Six numeric buffers cleared; HP-bar bitmap and bottom actor records retained; no full-page refresh or new actor/unit/character resources; Pokémon lock balanced; pending print queue prevents uploads; completion uploads only top windows and title |
| Repeated open/close | Pass in harness | 25 additional cycles per game; no tracked actor, unit, or character registration remains after exit |
| Stats selection regression | Pass, B2 and W2 in harness | Left from IVs and Stats-tab touch restore native selected sequence 4; IV/EV tab deselects; repeated ticks do not restart either tab's sequence; EV and Ribbons options covered |
| Focused installer/UI tests | 27 tests pass | Options/default checkbox, export/reload, 1.0.0–1.0.2 → 1.0.3 updates retaining file ID/EV setting, renamed-module recognition, duplicates, conflicts, resource checks, staged removal, rollback, unsupported versions, companion overlap fixtures |
| Clean retail ROM install/export | Pass, B2 and W2 on 1.0.3 | Automatic PMC install, EV setting updates, staged removal/reinstall, export/reload, same-file replacement, unchanged native Summary overlay and graphics members; ROM exports performed in memory |
| Source preservation | Pass | Clean input ROM hashes unchanged in memory and on disk by real-ROM verification |
| Decoded graphics review | Pass | Compiled IVS/EVS checked against native palette-index pixels: exact S, native A edge shades on V, solid I/E, no offset shadow, unchanged bar/arrows. Nearest-neighbor B2 comparison uses the supplied state's actual BG palette. Existing bar-chart and compact banks retained. |
| Production build | Pass | TypeScript and Vite production build; existing bundle-size warning remains |

The supplied White 2 `summary.mln` was inspected as a RAM/layout reference;
its 34,688-byte Summary overlay matched clean White 2. The state was not
modified or run in an emulator.

### Black 2 crash and moves refresh regression

The supplied Black 2 crash state was inspected offline. The CPU was executing
Summary work memory rather than code, consistent with a corrupted return. Both
retail games' native Summary sound calls target `0x02006254`, but versions 1.0.0
and 1.0.1 incorrectly subtracted `0x2c` for Black 2 and called `0x02006228`,
inside another function. The earlier harness repeated that address assumption
in its sound stub, so its passing result did not cover the real call.

Version 1.0.2 uses explicit mappings. The harness independently decodes the
retail sound call and executes its actual wrapper, intercepting only the final
sound dispatch. Navigation preserves the stack and callee-saved registers in
both games. No supplied save state is modified or included in test fixtures.

Previously, each variant switch called the full native page refresh, deleting
and recreating Stats windows and bottom move actors. The replacement uses the
native top-window dirty flag. The regression harness executes the retail
numeric draw and SkillUpdate functions, checks deferred uploads with a busy
print queue, and confirms stable bottom records and resource ownership.

### Native title style and Stats selection regression

The subsequent supplied Black 2 state confirmed native page 1 and variant 0,
but the Stats footer actor was still on unselected sequence 1. The top-only
refresh deliberately bypasses the full page-show routine, which normally
selects Stats with sequence 4. Version 1.0.3 restores that sequence during
normal Stats and uses the native conditional setter, avoiding per-frame
animation resets. Harness checks cover Left and touch returns, both EV
settings, both footer widths, and repeated ticks with stable sequences.

Title generation now copies the native S including its edge shades, derives
V shading from the native A, and draws I/E with solid native ink. Glyphs use
the native baseline and one-pixel spacing, without an offset drop shadow.
Compiled title pixels are checked against native graphics independently in
the harness. A static decoded comparison was inspected with the supplied
state's BG palette; this is an asset comparison, not an emulator capture of
the new version. The state was read only.

### What the BW2 isolated results do not prove

The native harness executes the compiled Thumb wrappers, retail sound wrapper,
touch rectangle scanner, conditional sequence setter, numeric drawing, and
top-display update functions.
Supporting APIs, including the Pokémon getter and actual text/graphics uploads,
are instrumented test doubles. Tests verify getter field IDs, ordering, returned
values, and that the wrappers do not write the supplied Pokémon buffer. They
do not prove live encrypted party/boxed data behavior or game-wide memory
stability.

The selected IV/EV tab uses the native selected palette and animation sequence.
Its live flashing phase, transition visibility, OAM layering, available VRAM,
and native upload timing have not been observed in a running game. The harness
checks preparation before actor creation and stable title pointers; it does
not simulate the DS display hardware or a complete native print queue.

Companion tests check the bundled Summary sprite and Learnset modules for
relocation coexistence, plus localized Upgrade hook fixtures. They are not a
full-game compatibility test for every hack. Unknown competing hooks and
changed required graphics are rejected instead of being overwritten.

## User emulator acceptance checklist

Run each applicable check in **both English US Black 2 and White 2**, with EVs
enabled and disabled. Export separately named test ROMs through Pokeweb; retain
the original ROM and saves as source inputs. Do not use an old save state to
judge installation boot behavior, because it may restore pre-install code.

- [ ] Open Summary from the party and PC. Initial Stats is normal Stats.
- [ ] Right follows Status → Stats → IVs → optional EVs → available Ribbons.
- [ ] Left reverses that order; Stats → Status stays native. Endpoints stop.
- [ ] With EVs disabled, IVs advances directly to available Ribbons or stops.
- [ ] Tapping the bar-chart tab enters IVs, including when EVs was selected. Tapping Stats
      restores normal Stats.
- [ ] Switching Stats ↔ IVs ↔ EVs retains the bottom move names, PP, type icons,
      highlighting, and artwork continuously, without a move-row flash.
- [ ] Check distinct values in all six positions, including IV 0/31 and stored
      EV 0/252/255. Confirm HP, Attack, Defense, Sp. Atk, Sp. Def, Speed order.
- [ ] HP shows one IV/EV number aligned with the other five values. Its real current-HP bar still shows normal
      green/yellow/red and empty behavior; normal Stats keeps current/max HP.
- [ ] Titles read IVS and EVS with native lettering, arrows, and title-bar colors.
      The title letters themselves have no drop shadow: S matches STATS,
      V has the native diagonal edge shading, and I/E use solid strokes.
- [ ] Nature colors, abilities/descriptions, Pokémon artwork, moves, and held
      items remain native.
- [ ] Change Pokémon with Up/Down while viewing IVs and EVs. Selection persists
      and values update. Return from move details to the same variant.
- [ ] Check party and boxed Pokémon, eggs, restricted Summary contexts, and
      added forms in a compatible hack. The IV/EV tab follows native Stats restrictions.
- [ ] Without Ribbons, verify three 40-pixel tab allocations and touch edges.
- [ ] With Ribbons, verify four 30-pixel allocations, complete borders/icons,
      and touch edges at x=30, 60, 90, 120.
- [ ] The bar-chart tab alone receives the selected flashing appearance in IVs/EVs; Stats
      is selected only in normal Stats. Compare flashing timing with native tabs.
- [ ] Left from IVs and tapping Stats restore the Stats tab's native flashing
      appearance; repeated updates retain its timing without restarting.
- [ ] Checkbox, Up/Down, exit and return controls from x=120 onward retain their
      native behavior and positions.
- [ ] Repeatedly switch pages, change Pokémon, open/close Summary, and return
      from move details. Check for blank/corrupt frames, flicker, hangs, and leaks.
- [ ] Test installed Summary sprite and Upgrade integrations in each intended
      ROM. No other patch is required merely to open IVs/EVs.
- [ ] Reopen an exported ROM, verify the EV checkbox, apply its opposite setting,
      export again, and check that exactly one viewer DLL remains.
- [ ] Compare Pokémon data/save hashes after a read-only session using the
      emulator's normal save policy; account separately for native play-time
      updates or unrelated game actions.

Release acceptance requires completing the live checks above. Attach any
failure's ROM profile, EV setting, selected view/context, and a newly captured
state or screenshot so the failure can be reproduced.
