# Pokemon Evolutions

Evolution data is stored as slots. Each slot has a method, a parameter, and a target species.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `evolutions` | Stores evolution slots. |
| `personal` | Provides species records. |
| `items`, `moves`, `message_texts` | Provides names for item/move/species parameters. |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Method | Evolution condition. | `Level Requirement` |
| Parameter | Extra value used by the method. Its meaning depends on the method. | `36`, `Fire Stone`, `Ancient Power` |
| Evolves to | Target species. | `Charizard` |

## Evolution Methods

| ID | Method | Parameter meaning |
| --- | --- | --- |
| `0` | None | No parameter. Empty/unused slot. |
| `1` | Max Happiness | No parameter. Evolves on level-up when happiness is high. |
| `2` | Level During Day | Required level. |
| `3` | Level During Night | Required level. |
| `4` | Level Requirement | Required level. |
| `5` | Trading | No parameter. |
| `6` | Trade with Held Item | Required held item. |
| `7` | Karrablast/Shelmet Trade | Partner species. |
| `8` | Item Use | Item used on the Pokemon. |
| `9` | Level Requirement + Atk Stat Greater Than Def | Required level. |
| `10` | Level Requirement + Atk Stat Equal To Def | Required level. |
| `11` | Level Requirement + Atk Stat Less Than Def | Required level. |
| `12` | Level Requirement + PID Greater Than 5 | Required level. |
| `13` | Level Requirement + PID Less Than 5 | Required level. |
| `14` | Level Requirement (Ninjask) | Required level. |
| `15` | Level Requirement + Empty Party Slot/Pokeball | Required level. |
| `16` | Max Beauty | Beauty/condition value. Rarely useful in Gen 5 hacks. |
| `17` | Item Use + Male | Item used, only male. |
| `18` | Item Use + Female | Item used, only female. |
| `19` | Level with Item + Day | Held item. |
| `20` | Level with Item + Night | Held item. |
| `21` | After Learning Specific Move | Move name/ID. |
| `22` | Level With Party Member | Party member species. |
| `23` | Level Requirement + Male | Required level, only male. |
| `24` | Level Requirement + Female | Required level, only female. |
| `25` | Level Up in Mt. Coronet | No parameter. Location-specific code behavior. |
| `26` | Level Up in Eterna Forest | No parameter. Location-specific code behavior. |
| `27` | Level Up in Route 217 | No parameter. Location-specific code behavior. |
| `28` | Level Up near Moss Rock | No parameter. Location-specific code behavior. |

## Example Slots

| Method | Parameter | Evolves to | Meaning |
| --- | --- | --- | --- |
| Level Requirement | `16` | `Charmeleon` | Evolves at level 16. |
| Item Use | `Fire Stone` | `Arcanine` | Evolves when the item is used. |
| After Learning Specific Move | `Ancient Power` | `Mamoswine` | Evolves after knowing that move and leveling up. |
| Level with Item + Night | `Razor Claw` | `Weavile` | Evolves at night while holding the item. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Add a normal level evolution | Choose `Level Requirement`, set Parameter to the level, choose target species. |
| Add a stone evolution | Choose `Item Use`, set Parameter to the item, choose target species. |
| Remove an evolution | Set Method to `None`; set Parameter and target to harmless values if desired. |
| Create branched evolutions | Use multiple slots with different methods/parameters. |

## Mega Evolution (Black 2 / White 2)

When Pokeweb runs on localhost, the Evolutions tab of a Black 2 / White 2 project has a **Mega Evolution** section below the slots. Mega Evolutions are not evolution slots: they live in the Mega Evolution runtime's route table (Code Injection → Major Features/Expansions → Mega Evolution, up to 192). If Mega Evolution isn't installed, the section offers the same one-click install.

| Column | Meaning |
| --- | --- |
| Trigger | `Held item` (a Mega Stone) or `Knows move` (like Mega Rayquaza's Dragon Ascent). |
| Item or move | The trigger, by name; its ID is shown next to it. |
| Mega form | Another form of this Pokémon. `New form…` adds one (as Personal → Add form does), named `<Pokémon>-Mega`. `Open` goes to the form to set its stats, types, ability and sprites. |

| Goal | Steps |
| --- | --- |
| Add a custom Mega | On the base Pokémon: `New Mega Stone…` (creates the item in the first free slot from 781 with no price or effect and the generic stone icon), then in the empty row pick the stone, choose `New form…`, press `Add`. Open the Mega form and edit it. |
| Use an existing item | Type its name. Regular items (below 657) keep their own battle effect; the section says so. |
| Remove a Mega | `Remove`. The Mega form stays; delete it on the Personal tab if unused. Routes whose Mega form was deleted show in red and are dropped at the next edit. |

A Mega form's own Evolutions tab names the Pokémon and item it comes from. In battle, the Mega takes the ability in the same slot (first, second or hidden) as the Pokémon's own ability, and the item can't be removed from that Pokémon.

## Caveats

Some methods are hard-coded to specific map locations or special cases. If you want a custom location evolution, changing this table alone is usually not enough.

## Related Pages

- [Pokemon Personal](Pokemon-Personal)
- [Pokemon Learnsets](Pokemon-Learnsets)
- [Items](Items)
