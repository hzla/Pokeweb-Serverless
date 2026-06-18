# Headers

Headers are the central map-zone records. A header tells the game which matrix, scripts, text bank, encounter table, overworld/entity file, music, weather/camera setup, and movement rules belong to a location.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `headers` | The header table itself. |
| `message_texts` | Location names and known labels. |
| `matrix`, `maps`, `overworlds` | Needed to open the linked Overworld editor from a header. |

## Main Row Fields

| Field | Meaning | Example |
| --- | --- | --- |
| ID | Header row number shown as zero-based in the table. | `0`, `324` |
| Location Name | Place name shown by the game and used for searching. Changing it updates the packed place-name ID. | `Route 19`, `Aspertia City` |
| Matrix | Matrix ID. The matrix chooses which map chunks make up this zone. | `1`, `185` |
| Scripts | Script file ID for events in this zone. | `854` |
| Texts | Message text bank ID used by the scripts/events in this zone. | `169` |
| Encounter | Encounter table ID. This is the same practical value as Encounter Data ID. | `0`, `56` |

## Map Identity

| Field | Meaning | Example values |
| --- | --- | --- |
| Map Resource ID | General map type/resource selector. This affects which map resources or mode the game expects. | `0`, `1`, `2` |
| Texture / Area ID | Area resource ID. For 3D maps, this points toward the area row used by texture/building data. | `23` |
| Town Map Zone Group | Parent map/zone grouping used by map systems. | `0`, `14` |
| Event / Overworld Data ID | Overworld/entity file ID. Use the `Open` link to edit NPCs, warps, triggers, and furniture. | `158` |
| Encounter Data ID | Wild encounter table ID. Match this with the [Encounters](Encounters) page. | `56` |

## Scripts And Text

| Field | Meaning | Example |
| --- | --- | --- |
| Matrix ID | The zone layout table used by both Overworlds and Maps. | `185` |
| Script ID | Event script file used by this zone. | `854` |
| Special Script ID | Level script or special script reference used by some maps. | `0`, `12` |
| Message Bank ID | Message bank used by scripts and sign/NPC text. | `169` |
| Place Name ID | Location name entry ID. Editing Location Name is safer for normal use. | `109` |

## Camera And Nameplate

These are packed fields. The editor splits them into smaller controls.

| Field | Meaning | Example |
| --- | --- | --- |
| Weather ID | Weather effect ID. A value of `0` usually means no special weather. | `0`, `1`, `5` |
| Projection Type | Camera projection behavior bits. Use nearby vanilla headers as examples. | `0`, `1` |
| Camera ID | Camera setup ID. Often tied to route/interior presentation. | `0`, `7` |
| Show Place Name Window | Whether the place-name banner appears when entering the map. | checked |
| Window Style Bits 1-5 | Packed style bits for the place-name window. Use matching vanilla areas as donors. | bit 1 on, others off |
| Name Icon ID | Icon packed into the name display data. | `0`, `32` |

## Movement And Battle Behavior

| Field | Meaning | Example |
| --- | --- | --- |
| Map Transition Type | How transitions into/out of the zone are treated. Copy from similar maps unless you know the code path. | `0`, `1` |
| Battle Background Type | Which battle background group appears for wild/trainer battles in this zone. | `0`, `5` |
| Bicycle Allowed | Allows bicycle use. | checked on routes |
| Running Allowed | Allows dashing/running shoes. | checked in most outdoor maps |
| Escape Rope / Dig Allowed | Allows Escape Rope/Dig field escape behavior. | checked in caves |
| Fly Allowed | Allows Fly to this map when other requirements are met. | checked for flyable destinations |
| Use Bicycle BGM | Uses bicycle music behavior. | usually unchecked |
| Battle Facility Allowed | Facility/palace-style behavior flag. Use vanilla facility headers as donors. | checked for facility zones |

## Zone Extras

| Field | Meaning | Example |
| --- | --- | --- |
| Difficulty Level Adjustment | BW2 challenge/easy mode level adjustment packed into name icon data. | `0`, `1` |
| Move Model ID | Inferred field used by some model/map behavior. Use donor values from similar maps. | `0` |
| Camera Area ID | Inferred camera/area helper ID. Use donor values from similar maps. | `0`, `23` |
| Packed Name Icon / Difficulty | Raw packed value containing name icon and difficulty parts. Edit split fields when possible. | `1024` |

## Seasonal Music

| Field | Meaning | Example |
| --- | --- | --- |
| Spring BGM ID | Music ID in spring. | `1098` |
| Summer BGM ID | Music ID in summer. | `1098` |
| Autumn BGM ID | Music ID in autumn/fall. | `1098` |
| Winter BGM ID | Music ID in winter. | `1098` |

If all four values match, the location uses the same music all year.

## Default Start

| Field | Meaning | Example |
| --- | --- | --- |
| Default Start X | X coordinate for default/fly spawn behavior. | `20` |
| Default Start Y | Y/height coordinate. Often `0`. | `0` |
| Default Start Z | Z coordinate for default/fly spawn behavior. | `14` |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change a map's wild encounters | Set or note `Encounter Data ID`, then edit that ID in [Encounters](Encounters). |
| Open NPC/warp data | Load `matrix`, `maps`, and `overworlds`, then click `Open` beside Event / Overworld Data ID. |
| Reuse behavior from a similar map | Search for a vanilla location with the same behavior and copy weather/camera, map behavior, and music values. |
| Change visible location name | Edit `Location Name`; avoid changing raw place-name fields unless you need exact packed control. |

## Caveats

Header fields are highly interconnected. If a map breaks after editing, compare the full header against a nearby vanilla map with the same type of area. Packed fields are especially easy to mis-set because a single number stores several smaller settings.

## Related Pages

- [Overworlds](Overworlds)
- [Maps](Maps)
- [Encounters](Encounters)
- [Texts](Texts)
