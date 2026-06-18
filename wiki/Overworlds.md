# Overworlds

The Overworld editor edits the entity file referenced by a header. This includes NPCs, interactable furniture, warps, triggers, and permission tiles.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `headers` | Finds which header uses the selected overworld ID. |
| `matrix` | Places the map chunks for the zone. |
| `maps` | Provides tile permission layers. |
| `overworlds` | Stores NPCs, warps, triggers, and furniture. |

## Main Controls

| Control | Meaning |
| --- | --- |
| Entity tabs | Switch between NPC, Furniture, Warp, and Trigger records. |
| Selected | Chooses the entity record to edit. |
| Add | Adds a new entity of the active type. New entities are placed near the selected tile/entity when possible. |
| Del Selected | Removes the active selected entity. |
| Back to Headers | Returns to [Headers](Headers). |
| Permissions view | Shows map permission colors and lets you click a tile to edit raw permission layers. |
| Map view | Renders the true map view when the 3D map renderer can load the resources. |
| Flag | Raw map layer 2 value for the selected tile. Commonly used for collision/interaction permissions. |
| Movement | Raw map layer 3 value for the selected tile. Commonly used for movement behavior. |
| Zoom controls | Zoom the editable map canvas. |

## NPC Fields

| Field | Meaning | Example |
| --- | --- | --- |
| `overworld_id` | Local NPC/event ID. This is displayed read-only in the sidebar. | `0`, `5` |
| `overworld_sprite` | Sprite/object graphic ID. The editor uses this to preview the NPC sprite when known. | `1`, `128` |
| `movement_permissions` | Movement behavior/permission value. Copy from similar vanilla NPCs for patrols. | `0`, `2` |
| `movement_permissions_2` | Secondary movement behavior value. Usually copied with movement permissions. | `0` |
| `overworld_flag` | Event flag controlling whether the NPC appears or disappears. | `0`, `1650` |
| `script_id` | Script run when the NPC is interacted with or used as a trainer. Trainer scripts often use IDs above `3000` or `5000`. | `3002` |
| `direction` | Facing direction at rest. Values depend on the game's direction table. | `0`, `2` |
| `sight` | Sight range for trainer-style NPCs. | `0`, `4` |
| `horizontal_leash` | Horizontal movement leash/range. | `0`, `3` |
| `vertical_leash` | Vertical movement leash/range. | `0`, `3` |
| `x_cord` | Grid X coordinate. Dragging an NPC also updates this. | `12` |
| `y_cord` | Grid Y/Z coordinate on the map plane. Dragging an NPC also updates this. | `8` |
| `z_cord` | Height/altitude coordinate. | `0` |
| `unknown_1` to `unknown_5` | Raw NPC fields not fully labeled. Use donor NPCs from similar maps. | `0` |

## Furniture Fields

Furniture records are interactable or placed objects. Some are grid-positioned, and some are rail-positioned.

| Field | Meaning | Example |
| --- | --- | --- |
| script | Script run by the object. | `7001` |
| condition | Inferred condition/control field. Use a donor value. | `0` |
| interactibility | Inferred interaction type field. Use a donor value. | `0`, `1` |
| is rail | `0` for normal grid placement, `1` for rail placement. | `0` |
| grid x | Grid X coordinate when not rail-based. | `15` |
| grid y | Grid Y/Z coordinate when not rail-based. | `10` |
| rail line | Rail line number when rail-based. | `2` |
| rail front | Forward position on a rail. | `128` |
| rail side | Side position on a rail. | `0` |
| rail unused | Extra rail value. Usually copy from donor data. | `0` |
| y | Altitude/height. | `0` |

## Warp Fields

Warp records send the player to another map/zone.

| Field | Meaning | Example |
| --- | --- | --- |
| target zone | Destination header zone ID. The `Open` button tries to open the target overworld. | `324` |
| target warp | Destination warp index inside the target zone. | `0`, `2` |
| contact dir | Direction from which the warp is activated. Copy from matching door/stair/exit warps. | `2` |
| transition | Screen transition style. | `3` |
| is rail | `0` for grid warp, `1` for rail warp. | `0` |
| grid x | Source warp X coordinate. | `5` |
| y | Source warp height. | `0` |
| grid y | Source warp map-plane Y/Z coordinate. | `22` |
| rail line/front/side | Rail placement values for rail warps. | `0` |
| width | Warp trigger width in tiles. | `1`, `2` |
| height | Warp trigger height in tiles. | `1`, `3` |
| unknown | Raw directionality/control field. Use donor warps. | `0` |

## Trigger Fields

Triggers run scripts when the player enters an area or when a variable/value check matches.

| Field | Meaning | Example |
| --- | --- | --- |
| script | Script/event ID for the trigger. | `120` |
| variable | Game variable to check. | `0x4000` as decimal `16384` |
| value | Required or written value, depending on trigger type. | `1` |
| type | Trigger type/control value. Use donor trigger records. | `0`, `1` |
| is rail | `0` for grid trigger, `1` for rail trigger. | `0` |
| grid x | Trigger X coordinate. | `8` |
| grid y | Trigger map-plane Y/Z coordinate. | `14` |
| width | Trigger width in tiles. | `2` |
| height | Trigger height in tiles. | `1` |
| y | Trigger altitude when grid-based. | `0` |
| unknown | Extra trigger control value. | `0` |

## Tile Permission Editing

In Permissions view, click a tile to edit two raw layer values:

| Layer | Practical meaning |
| --- | --- |
| Flag | Collision/permission class. This decides whether the player can walk, surf, encounter wild Pokemon, or interact with special surfaces. |
| Movement | Movement behavior layer. This can control direction forcing, slope/stair behavior, and special movement classes. |

For broad 3D collision editing, use [Maps](Maps), which has named permission flags and tile-class help.

## Common Workflows

| Goal | Steps |
| --- | --- |
| Add a trainer NPC | Select NPC, click Add NPC, set sprite, coordinates, direction, sight, and script ID. Then edit that trainer in [Trainers](Trainers). |
| Fix a broken warp | Compare target zone/target warp/contact direction/transition with a nearby vanilla door or route exit. |
| Add an item pickup | Add or edit an NPC/furniture script that uses an item-giving script. Location docs can later be enriched by [Documentation Generators](Documentation-Generators). |
| Copy seasonal or visual map behavior | Prefer editing headers/map metadata, then use overworld entities only for event objects. |

## Caveats

Overworld coordinates are shown in grid-friendly terms, but the original data sometimes packs coordinates differently for rail entities. Do not switch `is rail` unless you are intentionally converting placement style.

## Related Pages

- [Headers](Headers)
- [Maps](Maps)
- [Trainers](Trainers)
- [Documentation Generators](Documentation-Generators)
