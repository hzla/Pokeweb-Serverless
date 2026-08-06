# Battle Facilities

The Battle Facility editor covers BW2 Subway/PWT-style set libraries and Black Tower/White Treehollow data.

## Required Data

| Group | Data |
| --- | --- |
| Subway / PWT sets | `subway_sets`, `pwt_sets_0`, `pwt_sets_3`, `pwt_sets_6`, or `pwt_sets_7` |
| Subway / PWT trainer choices | `subway_trainers`, `pwt_map_1`, `pwt_map_2`, `pwt_tr1`, or `pwt_tr6` |
| Regulations | `regulations` |
| Black Tower / White Treehollow | `wbt_sets`, `wbt_trainers`, `wbt_area_pools` |
| Names | `moves`, `items`, `message_texts` |

## Modes

| Mode | Meaning |
| --- | --- |
| Sets | Pokemon set records: species, moves, item, nature, EV chips, form. |
| Choices / Trainers | Trainer records that choose from set IDs. |
| Area Pools | WBT area configuration records containing trainer pools. |
| Regulations | Subway/PWT rules such as level, battle type, and party size. |
| Boss Teams | Filtered WBT trainer choices that look like boss teams. |

## How Sets, Choices, and Regulations Connect

The three Subway/PWT tabs are related, but a regulation does not point to a particular group of teams:

- **Sets** define individual Pokemon builds: species, moves, item, nature, EV pattern, and form.
- **Choices** assign Set IDs to trainer pools, while PWT mapping records hold tournament/trainer assignments. Expand a 1v1 or 6v6 choice to see its referenced sets.
- **Regulations** independently define battle rules such as level, format, and party size. They do not select the opponents or teams used by a tournament.

For a group such as Kanto or Johto leaders, start with the PWT Map records in **Choices**, inspect the relevant 1v1/6v6 choice, then follow its Set IDs into **Sets**. Do not look for that group in **Regulations**.

## Set Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Pokemon | Species used by this set. | `Haxorus` |
| Move 1-4 | Moves available to the set. | `Dragon Claw` |
| Item | Held item. | `Choice Scarf` |
| Nature | Nature ID/name. | `Jolly` |
| EVs | Six EV stat chips packed into one byte. The editor displays selected stat labels. | HP, Attack, Speed |
| Form | Form ID. | `0` |

Facility EVs are not normal 0-252 EV numbers in this UI. They are stat chips/flags used by the facility set format.

## Choice/Trainer Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Trainer Class / Header | Subway and WBT records store a trainer class here. PWT archives instead store a raw header value; it is not a trainer class. | `Ace Trainer (50)`, `2` |
| Set Count | Number of set IDs declared in the record. | `4` |
| Sets | List of set IDs this trainer can use. Expand to edit individual set rows. | `12, 45, 88, 103` |
| Size | Raw record byte length. Read-only. | `12` |
| Extra values | Additional raw values after declared set IDs. Use donor records unless you know the archive. | `0` |
| Raw Hex | Raw record bytes shown for inspection. | `320004000C002D00` |

## Regulation Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Pokemon | Minimum and maximum Pokemon count allowed. | `3 to 3` |
| Level | Level value used by the rule. | `50` |
| Mode | Level rule: Normal, Minimum, Maximum, Scale Down, Set Level, or Scale Up. | `Set Level` |
| Total Lv. | Total level cap when used by the regulation. | `0`, `155` |
| Battle | Battle type and battle count. | `Single`, count `7` |

The editor warns that Pokemon count changes are unsafe unless matching code-injection edits also update battle mode team-size logic and opponent generation limits.

## Area Pool Fields

| Field | Meaning |
| --- | --- |
| Record | Area config record ID. |
| Header | Read-only header/control values from the WBT area record. |
| Pool values | Trainer references and control values inferred from the area configuration archive. |
| Trainer ID values | Editable trainer references inside pools. |
| Control values | Non-trainer values shown read-only. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change a facility Pokemon set | Open Sets, choose the correct archive, edit Pokemon, moves, item, nature, EV chips, and form. |
| Make a trainer use different sets | Open Choices/Trainers, expand the trainer, edit set IDs, and verify missing/invalid set warnings. |
| Edit PWT/Subway rules | Open Regulations and adjust level/battle settings conservatively. |
| Edit WBT area trainer pools | Open Area Pools and change trainer references, leaving control values alone. |

## Caveats

Facility archives are compact binary tables. Many records are used by generation logic, not directly by story scripts. For format safety, prefer editing existing records over resizing or changing count logic.

## Related Pages

- [Trainers](Trainers)
- [Pokemon Personal](Pokemon-Personal)
- [Moves](Moves)
- [Items](Items)
