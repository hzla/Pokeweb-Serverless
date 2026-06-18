# Maps

The Maps editor is a 3D map viewer and metadata/permission editor. It lets you inspect map zones, switch seasons, view buildings/NPC/entity overlays, and edit collision/permission tiles.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `headers` | Lists zones and provides header metadata. |
| Original ROM bytes | Needed to load 3D map resources that are not selected as normal editor NARCs. |
| `maps`, `matrix`, `overworlds` | Used for map chunks and entity overlays when loaded. |

## Viewer Controls

| Control | Meaning |
| --- | --- |
| Maps search | Filters available zones. |
| Zone select | Chooses the header/zone to load. |
| Load Map | Loads the selected zone's 3D resources. |
| Season | Loads spring, summer, autumn, or winter resources when available. |
| Buildings | Shows or hides building models. |
| NPC models | Shows or hides loaded NPC models/sprites. |
| Entity overlays | Shows or hides furniture/NPC/warp/trigger overlay boxes. |
| Collision overlay | Shows permission tiles for inspection/editing. |
| Reset View | Reframes the 3D scene. |
| Top Down | Switches to a top-down view. |
| Drag | Rotate the view. |
| Shift + drag / arrow keys | Pan the view. |
| Wheel or trackpad pinch | Zoom. |

## Zone/Header Metadata Fields

These fields edit the same header concepts documented on [Headers](Headers), but in the context of a loaded map.

| Field | Meaning | Example |
| --- | --- | --- |
| Location name | Visible location name entry. | `Route 19` |
| Matrix | Matrix ID used by the zone. | `185` |
| Source area | Header area/source area ID used to find 3D area data. | `23` |
| Overworlds | Overworld/entity file ID. | `158` |
| Scripts | Script file ID. | `854` |
| Text bank | Message text bank ID. | `169` |
| Encounters | Encounter data ID. | `56` |
| Map type | Header map type/resource ID. | `0`, `1` |
| Weather | Header weather low byte. | `0`, `5` |
| Parent map | Town map/zone group. | `0` |
| Level script | Special/level script ID. | `0` |
| Camera | Camera high byte. | `7` |
| Header flags | Behavior flags high byte. For split behavior editing, use [Headers](Headers). | `0` |

## Loaded Area Row Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Concrete area | Area row actually loaded after seasonal/replacement resolution. Read-only. | `23` |
| Texture pack | Texture resource pack ID. | `42` |
| Building bundle | Building model bundle ID. | `17` |
| SRT anim | Texture transform animation index. | `0` |
| PAT anim | Texture pattern animation index. | `0` |
| Exterior area | Whether the area uses exterior building/texture resource paths. | checked for outdoor zones |

## Collision And Permissions

Enable `Collision overlay`, click a tile, then edit the tile class and flags. Use `Apply To Selected` for one tile or `Paint on click` to paint multiple tiles. Use `Save Permission Edits` to commit the changed permission records.

### Tile Class Examples

| Tile class | Practical meaning |
| --- | --- |
| `0`, `17`, `19` | Normal walkable ground variants. |
| `1`, `18` | Blocked/no-move classes. |
| `4-13`, `22`, `33-35` | Encounter terrain such as grass, cave, ground, desert, and room. |
| `14-16`, `24` | Snow and ice surfaces. |
| `20-23`, `28`, `66` | Puddles, shoals, marsh, and deep marsh. |
| `27` | Mirror floor. |
| `29` | Strength/boulder hole. |
| `31`, `32` | Lawn and bridge special surfaces. |
| `48-51` | Gimmick floors such as electric/floating/electric rock/up-down floor. |
| `61-68` | Water, sea, waterfall, shore, and deep sea. |
| `81-88` | Directional no-move wall classes. |
| `114-121` | Jump and forced-move directional tiles. |
| `148-156`, `176` | Currents and diving behavior. |
| `160-168` | Slippery/ice movement, slip jumps, turn tiles, and hybrid changes. |
| `190`, `191` | Ooze/swamp and ooze stairs. |
| `212-226` | Indoor/object interactions such as counter, PC, TV, shelves, vending machine. |
| `255` | No attribute or invalid attribute. |

### Permission Flags

| Flag | Meaning |
| --- | --- |
| Blocked | Tile blocks normal movement. |
| Water | Tile is water-related. |
| Encounter | Tile can trigger encounters. |
| Footmarks | Tile can show footstep/footmark behavior. |
| Splash | Tile can show splash behavior. |
| Grass | Tile is grass-related. |
| Reflection | Tile can render reflections. |
| Shadow | Tile can render shadow behavior. |
| Unknown 0100 to Unknown 4000 | Raw flags not fully labeled. Use donor maps. |
| Geometry split | Geometry/split behavior flag. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change a map's model resources | Load the zone, edit Texture pack/Building bundle/SRT/PAT/Exterior, then save metadata. |
| Make a tile walkable/blocked | Enable collision overlay, click the tile, choose a tile class, adjust flags, and save permission edits. |
| Copy collision from a similar map | Load both maps in separate sessions or note donor tile class/flags, then paint the same values. |
| Find why a map uses the wrong script/text/encounter data | Check the Zone/Header Metadata fields, then compare with [Headers](Headers). |

## Caveats

Map rendering depends on original ROM bytes. Older browser-saved projects may need the base ROM reloaded before this page can load resources. Many tile classes are understood by behavior, not by formal names, so donor values from vanilla maps are often the safest reference.

## Related Pages

- [Headers](Headers)
- [Overworlds](Overworlds)
- [Encounters](Encounters)
