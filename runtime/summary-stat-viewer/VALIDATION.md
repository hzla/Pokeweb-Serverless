# Summary IV/EV Viewer validation

Validation date: 2026-10-05. Version: 1.0.3.

**Implementation and automated checks are complete. Live game acceptance
remains pending the user's emulator testing.** No game emulator was run for
these checks, and no large test-ROM artifact was written to disk.

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

### What these results do not prove

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
