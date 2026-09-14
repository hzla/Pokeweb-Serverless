> Historical assessment. The user subsequently authorized implementation.
> Move Preview 0.4.0 now implements the immunity checks described in README.md
> and three configurable installer colors. Validation is documented separately.

# Red immunity preview — feasibility report

Feasibility review only, 2026-09-13. Red highlighting has not been implemented.
The feature would belong exclusively to **Move Effectiveness Preview**. The
separate **Type Icons** patch has no move-highlighting dependency.

## Finding

**Feasible, with moderate rules/validation work and very small rendering cost.**
The current move preview already knows the selected attacker, move and opposing
battler. BW2's client has live ability, held-item, temporary-condition and field
state. The same target selection works in singles, rotation, doubles and triples.
No new sprites, palette banks, graphics VRAM or battle-heap allocation should
be necessary. Exact code growth must be measured after implementation.

A zero result from the type chart alone is insufficient. Ground immunity also
depends on grounding, ability suppression/bypass, and whether the held item is
currently effective. The implementation should follow BW2's ordering rather
than apply modern-generation assumptions or species defaults.

## Source evidence

- `btl_client.c:5140`, `checkForbitEscapeEffective_Arijigoku`, already checks
  client-side Gravity, Smack Down, Ingrain, effective Iron Ball, effective
  Levitate, Flying typing, Magnet Rise, Telekinesis and effective Air Balloon.
  It is an Arena Trap eligibility check, so it is a reference for available
  state, not a drop-in move-immunity evaluator.
- `btl_client.c:4938`, `IsItemEffective`, reads Magic Room, Embargo and Klutz.
  The client's field simulation is obtained from the main battle module
  (`btl_client.c:674`; `btl_main.c:5690`).
- `btl_pokeparam.c:1414` implements effective ability lookup with suppression;
  the current move preview already uses this native getter for Normalize.
- `btl_sick.c:539` handles type-immunity removal; `:586` handles temporary
  floating/grounding. This confirms Magnet Rise/Telekinesis are stored live
  conditions, so the preview need not maintain its own turn timers.
- `hand_item.c:5285` provides Air Balloon's floating effect; `:5293` removes
  the item when it pops. Reading current held-item state catches consumption
  and item exchanges; reading the original party held item would be wrong.
- `hand_tokusei.c:4392` implements Levitate, but writes its handler work state.
  `btl_server_flow.c:12143` evaluates damage affinity through event handlers.
  Calling this server execution path from the menu is not a pure query.
- `hand_tokusei.c:4882` implements Mold Breaker's ability-event bypass;
  Turboblaze and Teravolt share that handler (`:637–638`). Its bypass handler
  is attached during move execution (`:4894`), not throughout menu selection.
  A preview must explicitly account for the attacker's ability.

Native address profiles for additional readers still require independent
English B2/W2 verification before use.

## Recommended rules

| Case | Expected preview | Required exceptions |
|---|---|---|
| Normal/Fighting into Ghost and other ordinary type immunities | Red | Scrappy, Foresight/Odor Sleuth and other BW2 immunity-removal conditions |
| Ground into effective Levitate | Red | Mold Breaker/Turboblaze/Teravolt, suppressed ability, grounding |
| Ground into active Air Balloon | Red | Popped/removed item, Magic Room, Embargo, Klutz, grounding; ability bypass alone does not bypass the item |
| Ground into Magnet Rise or Telekinesis | Red while active | Expiry/removal and grounding; ability bypass alone does not cancel the condition |
| Ground into Flying | Red while immune | Effective typing/Roost, Gravity, Smack Down, Ingrain and active Iron Ball; preserve BW2 dual-type calculation order |
| Absorption/blocking abilities | Red if that damaging move is blocked | Water Absorb, Storm Drain, Volt Absorb, Lightning Rod, Motor Drive, Dry Skin, Flash Fire, Sap Sipper, Soundproof and Wonder Guard each need their own conditions/bypass rules |

The last row is a larger follow-on than the three requested Ground-immunity
sources. Red should mean the selected damaging move currently has no effect
on that opponent, including absorption, rather than merely a zero type-chart
multiplier. Neutral/status moves should retain existing behavior.

The move's actual type must be known before applying immunity rules. Hidden
Power and Normalize are already handled. Weather Ball, Natural Gift, Judgment
and Techno Blast currently remain neutral; they should remain unclassified
until their type can be resolved correctly. Do not label their base Normal
type as immune to Ghost when an item/weather effect changes the attack type.

This should describe the current selected opponent and current battle state.
It should not predict future Protect, misses, switching or turn-order changes.
Multi-target move redirection is separate from the currently selected-opponent
semantics and needs a deliberate scope decision if later requested.

## Architecture and cost

Use small read-only helpers for effective ability, item usability, temporary
conditions, field effects and ability bypass. Return a classification such as
immune/resisted/neutral/super-effective/unknown. Existing UI hooks then choose
red/blue/default/yellow; unknown preserves the default color. Check immunity
before resistance or super-effectiveness so a Grass/Steel Pokémon with an
active immunity cannot incorrectly remain yellow.

The font has unused entries after the current yellow/blue slots. Red can use
one of those existing entries and the existing fade buffers, with a matching
restore path. No extra palette bank or image resource is required. The current
standalone move module has 20 bytes of fixed state. A read-only evaluator can
use local stack values and should be able to retain that state size; new
persistent caches are optional rather than necessary. It currently occupies
2,184 bytes of code/constants and an estimated 2,792 bytes of retained PMC
memory. Additional code/profile bytes are not yet measured.

Read shared client battle state rather than run the server damage pipeline.
That avoids RNG, event-handler work changes, item consumption, messages and
server-only assumptions in linked battles. If an unknown ROM changes ability,
item or battle-condition semantics, fail its move-preview compatibility check
or leave the result unknown; the **Type Icons** patch should remain available.

## Information visibility and validation

Using actual battle ability/item state can reveal an unrevealed enemy ability
or item. It can also undermine the existing Illusion disguise policy. This is
a product decision before implementation: an omniscient mechanics preview is
simpler; a revealed-information-only preview needs reliable knowledge tracking
and an unknown/default result. The current icon/disguise behavior should not
be silently changed as part of adding red.

Test all immunity sources both active and removed, including Air Balloon
popping/Trick, Magnet Rise expiry/switching, Gastro Acid, ability changes,
Mold Breaker against each immunity source, Gravity/Smack Down/Ingrain/Iron Ball,
Roost and Scrappy/Foresight. Include dual types, rotation page changes,
all three enemy targets, ally/spread/default cases and cancellation.
Compare game RAM/RNG and allocator/resource counts before and after repeated
preview updates. Run the matrix independently on B2 and W2, then audit any
custom-mechanics ROM separately.

Recommendation: implement ordinary type immunities plus the requested Ground
immunity sources and all their bypass/grounding exceptions first, in the
standalone Move Effectiveness Preview patch. Expand other ability immunities
only with their matching tests. The split keeps icons usable throughout.
