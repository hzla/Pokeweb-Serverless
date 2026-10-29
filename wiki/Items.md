# Items

The Item editor edits item price and packed behavior fields for use, held effects, recovery, status removal, EV gains, friendship changes, Natural Gift, and battle item behavior.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `items` | Item records. |
| `message_texts` | Item names. |

## Main Row Fields

| Field | Meaning | Example |
| --- | --- | --- |
| ID | Item ID. | `13` |
| Name | Item name from text data. Edit item names in [Texts](Texts). | `Potion` |
| Market Value | Buy/sell price-related value. Range `0-65535`. | `300` |

## Native Held Battle Effects (BW2)

Open an item's details to edit its **Held battle effect**. US revision-0 Black 2
and White 2 are supported when the native table and callbacks are recognized.
The editor discovers the assignment table, follows its actual pointers and uses
the overlay's recorded load address. Recognizable shifted layouts are supported;
unknown or conflicting code disables native edits.

- **Handler assignment** selects an existing native handler set.
- Leftovers exposes its maximum-HP healing divisor: `16` heals 1/16, `8` heals 1/8.
- Choice Band, Specs and Scarf expose their native multipliers in steps of `0.125`.
- Supported item-data parameters have meaningful labels, such as **Power bonus (%)**.
- **Type-restricted healing** replaces this item's battle effect with healing for
  one holder type. Other types receive no healing or damage. This installs a
  shared PMC callback and uses the receiving item's healing divisor. All edited
  items use one `ItemEffects.dll`, with separate type settings per item. It does
  not modify Black Sludge or retain the item's old power boost. Existing
  per-item healing DLLs migrate into the shared module on the next edit.
- **Custom effects** combines adjustable effects, nested **All (AND)** / **Any
  (OR)** condition groups, and **Consume on first successful effect**. Press
  **Apply custom effects** to install the draft and verify its ROM bytes.

The custom library includes adjustable stat and damage multipliers, healing,
status infliction, stat-stage changes, recoil, critical stages, accuracy, move
typing, move locking and escape from trapping. Status, stat-stage and recoil
actions have trigger, target and chance controls. Repeated stat-stage primitives
can change different stats on the same item. A rule contains up to 16 effects.

**Load item preset** starts from an existing in-battle item effect. Choice presets
split the stat multiplier and move lock into separate editable primitives.
There are also 169 composable **Native item behaviors**, covering berries,
flinching, survival, switching reactions, weather/screen/trapping duration,
weight, immunities, species-dependent bonuses and other native battle mechanics.
Native behaviors keep their original timing, intrinsic conditions and species
restrictions. **Parameter → Original** reads the donor item's parameter from the
loaded ROM; **Custom** overrides that number only for this primitive. Some native
behaviors ignore that parameter. Use the adjustable primitives to change hardcoded
values such as Choice multipliers, critical stages, status or stage changes.

Conditions check holder HP, type, weather, species or status, and the current
move's type or category. Combine them with nested **All (AND)** / **Any (OR)**
groups. HP supports `<`, `≤`, `>` and `≥`; other checks support **Is** / **Is not**.
For example, combine `Attack ×2.5` and `Lock into the selected move` with
`HP <50% AND (Rock OR Sun)`. The shared condition tree gates every effect;
native behaviors also retain their own activation checks. Move conditions apply
only in events where the game supplies that information.

Healing runs at turn end. The consumable option applies to the whole item and
uses native item-use work after activation. Failed conditions, full HP or Heal
Block for healing, and rejected status/stage changes retain the item. AI and
preview calculations cannot consume it. Once consumed, the remaining effects
stop. Native behaviors retain their intrinsic one-shot state and cooldowns. A reusable
berry or gem that permits reactivation uses subsequent native triggers; recovery
does not continuously repeat while the game is idle. This toggle
is separate from the raw bag-use **Consumed On Use** field. Effects are evaluated
in their listed order; a consumable item stops queuing further effects once one
has requested activation.

Custom rules also work on items without an original battle handler. Choosing
**No battle effect** removes their rules; choosing a native assignment restores
that handler for an item with a native slot. The editor changes battle behavior;
it does not change which bag items can normally be given to Pokémon. Drive and
Plate presets include move typing for Techno Blast and Judgment. These rules do
not replace form changes or species abilities such as Multitype.

All configurations share one `ItemEffects.dll`. Native callback/helper copies
are shared across items, with separate state for each primitive. The editor
bounds loaded code/data plus state to 64 KiB and verifies native bindings and
the complete module again on reopen. Existing version-3 rules migrate on the
next edit. EXP, EV, prize money, friendship, breeding, evolution, contests and
field encounter effects are outside this in-battle library.

Native code values belong to shared handlers. If multiple items use that handler,
the editor lists them beside the control. Item-data parameters are per item.
Assignments preserve the receiving item's other data, including its raw Held
Effect ID. Original handlers can retain item/species restrictions and supporting
data requirements; copying a handler does not rewrite those conditions.

**Native verification → Recheck ROM** validates the current assignment and native
signatures. Export the ROM to keep changes. The [item runtime guide](../runtime/item-effects/README.md)
describes supported effects, compatibility limits, and build/check commands.

## Overview Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Item Type | General item type/category byte. Use donor items. | `1` |
| Sort Order ID | Ordering value used in item lists. | `25` |
| Battle Effect Param | Held-effect parameter; its meaning depends on the native handler. Some handlers ignore it. | `0`, `20` |
| Natural Gift Power | Natural Gift power flag/value exposed by the format. | `0`, `1` |

## Use Routing Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Field Use Function | Function/group used when item is selected in the overworld bag. | `4` |
| Battle Use Function | Function/group used in battle. | `0`, `2` |
| Work Type | Use/work routing flag. | `0` |
| Consumed On Use | Whether the item is consumed. | `1` |
| Nature Gift / Pocket Flags | Packed Natural Gift type, key-item flags, register button flag, field pocket, and battle pocket. | `160` |

### Nature Gift / Pocket Flags

| Packed part | Meaning |
| --- | --- |
| Natural Gift Type | Type used by Natural Gift. |
| Key/Important Item | Marks key/important item behavior. |
| Register Button | Allows registration to the quick-use button. |
| Field Pocket | Bag pocket outside battle. |
| Battle Pocket | Bag pocket in battle. |

## Battle Behavior Fields

| Field | Meaning |
| --- | --- |
| Held Effect ID | Held item effect ID. |
| Pluck Effect ID | Berry/Pluck effect ID. |
| Fling Effect ID | Fling behavior/effect ID. |
| Fling Power | Fling base power. |

## Stat Boost Fields

| Field | Packed parts |
| --- | --- |
| Revive / Attack Boost | Revives fainted Pokemon, revives all fainted Pokemon, level up, evolution stone, attack boost stages. |
| Defense / Sp. Atk Boost | Defense boost stages, Sp. Atk boost stages. |
| Sp. Def / Speed Boost | Sp. Def boost stages, Speed boost stages. |
| Accuracy / Crit / PP Up | Accuracy boost stages, critical boost stages, PP Up, PP Max. |

## Recovery And Status Fields

| Field | Meaning |
| --- | --- |
| Status / Use Flags | Packed status cures: Sleep, Poison, Burn, Freeze, Paralysis, Confusion, Infatuation, Ability Guard. |
| Recovery / EV / Friendship Flags | Packed flags for PP recovery, all-move PP recovery, HP recovery, EV gains, EV limit check, and friendship gain tiers. |
| HP Recovery Amount | Amount of HP restored when the recovery flag/function uses it. |
| PP Recovery Amount | Amount of PP restored. |

## EV And Friendship Fields

| Field | Meaning | Example |
| --- | --- | --- |
| HP EV Gain | HP EVs gained. | `10` |
| Attack EV Gain | Attack EVs gained. | `10` |
| Defense EV Gain | Defense EVs gained. | `10` |
| Speed EV Gain | Speed EVs gained. | `10` |
| Sp. Atk EV Gain | Special Attack EVs gained. | `10` |
| Sp. Def EV Gain | Special Defense EVs gained. | `10` |
| Low Friendship Gain | Friendship gain for low friendship tier. | `1` |
| Mid Friendship Gain | Friendship gain for mid friendship tier. | `1` |
| High Friendship Gain | Friendship gain for high friendship tier. | `1` |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change an item's shop price | Edit Market Value. Also review marts if the item is sold. |
| Make a medicine cure poison | Open item details, enable Cures Poison in Status / Use Flags, and confirm use routing matches a medicine donor. |
| Make a vitamin-style item | Set the relevant EV gain, EV flag, EV limit check, and field/battle use routing based on a vanilla vitamin. |
| Create a key item | Enable Key/Important Item and set the appropriate pocket/use routing from a key item donor. |

## Caveats

Many item behaviors require both data flags and a matching item use function. If a flag is set but nothing happens in-game, compare the full item record with a vanilla item that already has the behavior.

## Related Pages

- [Marts](Marts)
- [TMs](TMs)
- [Texts](Texts)
