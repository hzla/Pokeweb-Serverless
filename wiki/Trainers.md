# Trainers

The Trainer editor edits trainer metadata, AI flags, battle type, rewards, text, and party Pokemon.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `trdata` | Trainer metadata, AI flags, items, battle type, and reward fields. |
| `trpok` | Trainer party Pokemon. |
| `personal`, `items`, `moves`, `message_texts` | Names and autocomplete data. |
| `trtext_table`, `trtext_offsets` | Trainer dialogue rows where supported. |

## Main Controls

| Control | Meaning |
| --- | --- |
| Search | Filters trainers. |
| Add Trainer | Clones the selected trainer, party, name slot, and dialogue rows. |
| Natures patch panel | Applies or reports the trainer-nature ARM9 patch for BW2. |
| Test Team | Paste a Showdown import to use when launching a trainer test battle. |
| Test | Builds/downloads a test-battle state for the selected trainer. |

## Trainer Row Fields

| Field | Meaning | Example |
| --- | --- | --- |
| ID | Trainer ID. Many scripts refer to this ID. | `2` |
| Name | Trainer name from text data. | `Cheren` |
| Class | Trainer class name and ID. | `Youngster (2)` |
| Battle Type | Singles, Doubles, Triples, or Rotation. | `Doubles` |
| Moves checkbox | Whether party Pokemon store explicit moves. If off, the game derives moves from learnsets. | checked |
| Items checkbox | Whether party Pokemon store held items. | checked |
| Pokemon preview | Party sprites for this trainer. | 3 Pokemon |

## Expanded Trainer Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Item 1-4 | Trainer bag items usable during battle. | `Potion`, `Full Restore` |
| Money | Money/reward multiplier byte. Range `0-255`. | `30` |
| Reward | Item rewarded after battle, when the game/script uses this field. | `None`, `TM27` |
| Heal? | Whether the trainer heals after battle in supported contexts. Range `0-1`. | `0`, `1` |
| Texts | Trainer dialogue rows when loaded. | Before battle, lose text |

## Party Pokemon Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Species | Pokemon species. | `Lucario` |
| Level | Pokemon level. Range `0-100`. | `42` |
| Ability Slot | Ability selector. `1` and `2` use normal abilities, `3` uses hidden ability. `0` can inherit/carry behavior from previous slots in the format. | `1` |
| Gender | Default, Male, or Female. | `Default` |
| IVs | Packed IV difficulty value. Higher values generally mean stronger IVs; the exact nature display derives from the stored value unless the nature patch is active. Range `0-255`. | `255` |
| Nature | Explicit nature setting when the BW2 trainer-nature patch is applied. `Auto` preserves vanilla behavior. | `Jolly` |
| Form | Form ID. Range `0-255`. | `0`, `1` |
| Held Item | Held item. Enabling this turns on the trainer's item template flag. | `Sitrus Berry` |
| Move 1-4 | Explicit moves. Editing these turns on the trainer's moves template flag. | `Aura Sphere` |
| Autofill Moves | Fills moves from the species learnset at the current level. Requires `learnsets`. |
| Copy | Copies the Pokemon as Showdown-style text. |
| Delete | Removes the party slot. |

## Trainer AI Flags

AI flags are behavior switches for the battle AI. Exact move scoring still depends on the game's AI scripts and move effect data, but these plain-language descriptions explain why you would enable each flag.

| Flag | What it means | Good use |
| --- | --- | --- |
| Prioritize Effectiveness | Makes the AI care more about type effectiveness and whether a move can hit for useful damage. | Most normal trainers and bosses. |
| Evaluate Attacks | Lets the AI compare attacking moves instead of choosing mostly at random. | Any trainer meant to feel competent. |
| Expert | Enables stronger or more specialized scoring rules. | Gym leaders, rivals, late-game bosses. |
| Prioritize Status | Encourages status moves when they are useful. | Trainers with Toxic, Thunder Wave, Will-O-Wisp, setup/status gimmicks. |
| Risky Attacks | Allows or encourages higher-risk options, such as lower accuracy or drawback moves, when the payoff is good. | Aggressive trainers or high-power teams. |
| Prioritize Damage | Biases toward the move expected to deal the most damage. | Straightforward offensive trainers. |
| Partner | Battle partner behavior. Helps the AI consider ally interactions. | Multi battles where the trainer is on the player's side or allied with another trainer. |
| Double Battle | Double-battle behavior. Helps the AI account for multiple active Pokemon. | Double, Triple, Rotation, and partner battles where targeting matters. |
| Prioritize Healing | Encourages healing moves/items when appropriate. | Defensive trainers and bosses with recovery. |
| Utilize Weather | Makes weather interactions more important. | Rain, sun, sand, hail, Swift Swim, Chlorophyll teams. |
| Harassment | Encourages disruptive play such as status, stat drops, or annoyance tactics. | Stall, support, or gimmick trainers. |
| Roaming Pokemon | Special behavior for roaming wild Pokemon style battles. | Usually leave off for normal trainers. |
| Safari Zone | Special behavior for Safari-style battles. | Usually leave off for normal trainers. |
| Catching Demo | Special capture tutorial/demo behavior. | Usually leave off for normal trainers. |

### Suggested AI Presets

| Trainer type | Suggested flags |
| --- | --- |
| Early route trainer | Prioritize Effectiveness, Evaluate Attacks |
| Gym leader | Prioritize Effectiveness, Evaluate Attacks, Expert, Prioritize Damage |
| Defensive boss | Evaluate Attacks, Expert, Prioritize Status, Prioritize Healing, Harassment |
| Weather boss | Evaluate Attacks, Expert, Utilize Weather, Prioritize Damage |
| Double battle trainer | Evaluate Attacks, Expert, Double Battle, Partner if allied |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Make a trainer a Double Battle | Set Battle Type to `Doubles`, make sure the trainer has at least two Pokemon, and consider installing the Single-NPC Double Battle Fix for common-script BW2 trainers. |
| Give custom moves | Enable Moves, edit Move 1-4, or click Autofill Moves. |
| Give held items | Enable Items and edit Held Item on each Pokemon. |
| Set explicit natures | Apply Specify Trainer Pokemon Natures, then set Nature per party member. |
| Add a trainer | Select a similar trainer, click Add Trainer, then edit class, text, party, and scripts that reference it. |

## Caveats

Changing a trainer's battle type does not automatically change every script that calls that trainer. In BW2, the bundled double battle fix is intended for common single-NPC trainer scripts changed from Singles to Doubles.

## Related Pages

- [Encounters](Encounters)
- [Moves](Moves)
- [Battle Facilities](Battle-Facilities)
- [Code Injection and Patches](Code-Injection-and-Patches)
