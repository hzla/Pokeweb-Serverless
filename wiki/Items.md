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

## Overview Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Item Type | General item type/category byte. Use donor items. | `1` |
| Sort Order ID | Ordering value used in item lists. | `25` |
| Battle Effect Param | Parameter used by the battle-use effect. | `0`, `20` |
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
