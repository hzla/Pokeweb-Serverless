# Moves

The Move editor edits Gen 5 move battle data: typing, category, power, accuracy, PP, effect references, stat/status behavior, targeting, flags, and animation ID.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `moves` | Move records. |
| `message_texts` | Move names. |
| `move_animations`, `battle_animations`, `move_spas` | Needed for the [Move Animation Editor](Move-Animation-Editor). |

## Main Row Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Name | Move ID and move name. Name text is edited in [Texts](Texts), not here. | `53 - Flamethrower` |
| Type | Move type. | `Fire` |
| Category | Status, Physical, or Special. | `Special` |
| AI Effect Handler | Move effect label/ID used by the battle AI/effect table. This is not the same as the code handler address table. | `Inflicts burn` |
| Pow | Base power. Range `0-255`. | `90`, `0` for status moves |
| Acc | Accuracy value. Range `0-101`. `101` is commonly used by never-miss style moves. | `100`, `101` |
| Animation button | Opens [Move Animation Editor](Move-Animation-Editor). | movie icon |

## Effect Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Effect Category | Broad AI/effect category. | `Status Inflicting` |
| Add. Effects | Additional result effect, such as burn chance or flinch. | `Chance to Burn target` |
| Add. Effect Proc % | Chance for the additional effect. Range `0-100`. | `10` |
| Status Type | Status UI/category type: None, Visible, Temporary, Infatuation, or Trapped. | `Visible` |
| Target | Who can be selected or affected. | `Any adjacent opponent` |
| Min Effect Turns | Minimum duration for turn-based effects. Range `0-255`. | `2` |
| Max Effect Turns | Maximum duration for turn-based effects. Range `0-255`. | `5` |
| Min Hits | Minimum hits for multi-hit moves. Range `0-15`. | `2` |
| Max Hits | Maximum hits for multi-hit moves. Range `0-15`. | `5` |

## Target Values

| Target | Meaning |
| --- | --- |
| Any adjacent | Any adjacent Pokemon. |
| Random (User/ Adjacent ally) | Random user-side target. |
| Random adjacent ally | Random adjacent ally. |
| Any adjacent opponent | A chosen adjacent opponent. |
| All excluding user | Everyone except the user. |
| All adjacent opponents | All adjacent opposing Pokemon. |
| User's party | Party-side target. |
| User | The move targets the user. |
| Entire Field | Whole battlefield. |
| Random adjacent opponent | Random adjacent opposing Pokemon. |
| Field Itself | Field-level effect. |
| Opponent's side of field | Opponent-side field effect. |
| User's side of field | User-side field effect. |
| User (Selects target automatically) | Auto-targets the user. |

## Stat Effect Fields

There are three stat effect rows. Each row has:

| Field | Meaning | Example |
| --- | --- | --- |
| Stat Mod | Affected stat: Attack, Defense, Special Attack, Special Defense, Speed, Accuracy, Evasion, All, or None. | `Defense` |
| Amount | Stages changed. Range `-6` to `6`. Negative lowers, positive raises. | `-1`, `2` |
| Proc % | Chance this stat change happens. Range `0-100`. | `100` |

## Misc Fields

| Field | Meaning | Example |
| --- | --- | --- |
| PP | Base PP. Range `0-255`. | `15` |
| Priority | Priority byte. Most normal moves use `0`; higher values act earlier. | `0`, `1` |
| +Crit | Added critical-hit stage. Range `0-15`. | `1` |
| Flinch % | Chance to flinch. Range `0-100`. | `30` |
| Recoil % | Recoil percent shown in readable form. Range `0-255`. | `33` |
| Heal % | Healing or drain percent, depending on effect. Range `0-100`. | `50` |
| Animation ID | Animation script ID copied/used for this move. Editing this can copy the source animation script. | `53` |

## Move Properties

| Property | Meaning |
| --- | --- |
| contact | Move makes contact. Affects abilities/items like Static or Rocky Helmet. |
| requires_charge | Move has a charge/prep turn. |
| recharge_turn | User must recharge after use. |
| blocked_by_protect | Protect-style moves can block it. |
| reflected_by_magic_coat | Magic Coat can reflect it. |
| stolen_by_snatch | Snatch can steal it. |
| copied_by_mirror_move | Mirror Move can copy it. |
| punch_move | Punch-boosting logic can apply. |
| sound_move | Sound-related logic can apply. |
| grounded_by_gravity | Gravity affects the move. |
| defrosts_targets | Move can thaw frozen targets. |
| hits_non-adjacent_opponents | Can hit non-adjacent opponents. |
| healing_move | Counts as a healing move. |
| hits_through_substitute | Bypasses Substitute. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Make a move stronger | Edit power, accuracy, PP, and category. |
| Add a status chance | Set Add. Effects, Add. Effect Proc %, Status Type, and the relevant flags/effect category. |
| Make a multi-hit move | Set Min Hits and Max Hits. |
| Give a move a new animation | Set Animation ID or open [Move Animation Editor](Move-Animation-Editor). |
| Make a move usable as a TM | Edit [TMs](TMs), then update compatibility in Pokemon. |

## Caveats

Move data and battle code work together. Some effects require the right effect ID, result effect, flags, and code handler. If a custom move looks correct in data but behaves wrong in battle, check [Move Effect Handlers](Move-Effect-Handlers).

## Related Pages

- [Move Animation Editor](Move-Animation-Editor)
- [Move Effect Handlers](Move-Effect-Handlers)
- [TMs](TMs)
- [Pokemon Learnsets](Pokemon-Learnsets)
