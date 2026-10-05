# Summary IV/EV Viewer validation

Validation date: 2026-10-04. Version: 1.0.1.

**Implementation and automated checks are complete. Live game acceptance
remains pending the user's emulator testing.** No game emulator was run for
these checks, and no large test-ROM artifact was written to disk.

## Automated results

| Check | Result | Scope |
| --- | --- | --- |
| Native builds | Pass, B2 and W2 | Separate retail overlay pins, all 17 hook destinations, helper/layout signatures, native graphics pins, no unresolved imports, RPM parse/dump |
| Native Thumb harness | Pass, B2 and W2 | Compiled wrapper code and hook veneers; stack/register preservation; IV/EV field ordering and extremes; EV on/off; Ribbons on/off; navigation endpoints; native retail touch scanner; title-request lifetime; initialization upload order; resource ownership and failure cleanup |
| Repeated open/close | Pass in harness | 25 additional cycles per game; no tracked actor, unit, or character registration remains after exit |
| Focused installer/UI tests | 23 tests pass | Options/default checkbox, export/reload, updates including 1.0.0 → 1.0.1 with the same file ID/EV setting, renamed-module recognition, duplicates, conflicts, resource checks, staged removal, rollback, unsupported versions, companion overlap fixtures |
| Clean retail ROM install/export | Pass, B2 and W2 on 1.0.0 | Install with automatic PMC, toggle EVs, staged remove/reinstall, ordinary export/reload, update existing file ID; native Summary overlay and graphics members retained. Version 1.0.1 update/export is covered by the focused fixtures. |
| Source preservation | Pass | Clean input ROM hashes unchanged in memory and on disk by real-ROM verification |
| Decoded graphics review | Pass | IVS/EVS title maps and compact tab banks; updated outlined bar-chart icon inspected with nearest-neighbor enlargement |
| Production build | Pass | TypeScript and Vite production build; existing bundle-size warning remains |

The supplied White 2 `summary.mln` was inspected as a RAM/layout reference;
its 34,688-byte Summary overlay matched clean White 2. The state was not
modified or run in an emulator.

### What these results do not prove

The native harness executes the compiled Thumb wrappers and the retail touch
rectangle scanner. Most native APIs, including the Pokémon getter, are
instrumented test doubles. Tests verify getter field IDs, ordering, returned
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
- [ ] Check distinct values in all six positions, including IV 0/31 and stored
      EV 0/252/255. Confirm HP, Attack, Defense, Sp. Atk, Sp. Def, Speed order.
- [ ] HP shows one IV/EV number aligned with the other five values. Its real current-HP bar still shows normal
      green/yellow/red and empty behavior; normal Stats keeps current/max HP.
- [ ] Titles read IVS and EVS with native arrows, shadows, and title-bar colors.
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
