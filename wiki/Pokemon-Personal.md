# Pokemon Personal

The Pokemon Personal section edits species-level data: stats, typing, abilities, held items, growth, breeding groups, EV yield, and form metadata.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `personal` | Base species records. |
| `moves`, `items`, `message_texts` | Names and autocomplete data for related fields. |
| `learnsets`, `evolutions` | Loaded by the combined Pokemon editor for adjacent tabs. |

## Main Card Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Type 1 | Primary type. | `Fire` |
| Type 2 | Secondary type. Use the same type as Type 1 for single-type Pokemon if the project stores it that way. | `Flying` |
| Ability 1 | First normal ability slot. | `Blaze` |
| Ability 2 | Second normal ability slot. | `Solar Power` |
| Ability 3 | Hidden ability slot. | `Speed Boost` |
| HP | Base HP stat. Range `0-255`. | `78` |
| Att | Base Attack. Range `0-255`. | `84` |
| Def | Base Defense. Range `0-255`. | `78` |
| Sp Att | Base Special Attack. Range `0-255`. | `109` |
| Sp Def | Base Special Defense. Range `0-255`. | `85` |
| Speed | Base Speed. Range `0-255`. | `100` |

## Expanded Personal Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Catch Rate | How easy the species is to catch. Higher is easier. Range `0-255`. | `45` for many starters |
| Exp Yield | Base experience yield when defeated. Range `0-65535`. | `240` |
| Gender | Gender ratio byte. Common values are listed below. | `127` for 50/50 |
| Hatch Rate | Egg hatch cycles. Higher means more steps. Range `0-255`. | `20` |
| Happiness | Base friendship/happiness. Range `0-255`. | `70` |
| # of Forms | Number of form records associated with this species. | `1`, `2` |
| Height | Pokedex height value, usually in decimeters. | `17` means 1.7 m in vanilla-style data |
| Weight | Pokedex weight value, usually in hectograms. | `905` means 90.5 kg in vanilla-style data |
| 50% Held Item | Item slot with the highest wild held-item chance. | `Oran Berry` |
| 5% Held Item | Low-chance wild held item. | `Sitrus Berry` |
| 1% Held Item | Very rare wild held item. | `Lucky Egg` |
| Egg Group 1 | First breeding group. | `Monster` |
| Egg Group 2 | Second breeding group. | `Dragon` |
| Growth Rate | EXP growth curve. | `Medium Slow` |

## Gender Values

| Value | Meaning |
| --- | --- |
| `0` | Male only |
| `31` | 87.5% male, 12.5% female |
| `63` | 75% male, 25% female |
| `127` | 50% male, 50% female |
| `191` | 25% male, 75% female |
| `225` | 12.5% male, 87.5% female |
| `254` | Female only |
| `255` | Genderless |

## EV Yield Fields

Each EV field accepts `0-3`. The game packs these into one internal EV-yield value.

| Field | Meaning | Example |
| --- | --- | --- |
| HP EVs | HP EVs awarded when defeated. | `0` |
| Attack EVs | Attack EVs awarded. | `2` |
| Defense EVs | Defense EVs awarded. | `0` |
| Sp Attack EVs | Special Attack EVs awarded. | `0` |
| Sp Defense EVs | Special Defense EVs awarded. | `0` |
| Speed EVs | Speed EVs awarded. | `1` |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Make a Pokemon stronger | Raise base stats and review EV yield so battles and training stay intentional. |
| Add a hidden ability | Edit Ability 3 to the ability name. Trainer Pokemon can choose ability slots in [Trainers](Trainers). |
| Make a Fairy-type Pokemon | Use Type 1/Type 2. For actual Fairy battle behavior in BW2, apply Fairy Type Support and edit the [Type Chart](Type-Chart). |
| Change wild held items | Edit the 50%, 5%, and 1% item slots. |

## Caveats

Changing `# of Forms` alone does not create new sprite/form assets. Form work usually requires personal data, labels, sprites, and sometimes code or script support.

## Related Pages

- [Pokemon Learnsets](Pokemon-Learnsets)
- [Pokemon Evolutions](Pokemon-Evolutions)
- [Pokemon Sprites and Animations](Pokemon-Sprites-and-Animations)
- [Type Chart](Type-Chart)
