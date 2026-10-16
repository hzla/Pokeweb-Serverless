# Maps

The Maps editor is a 3D map viewer and metadata/permission editor. It lets you inspect map zones, switch seasons, view buildings/NPC/entity overlays, and edit collision/permission tiles.

## Matrix Editor (Black/White and Black 2/White 2)

Open **Headers & Overworlds → Matrix Editor** to view a colored grid of map chunks and header assignments. It starts at matrix **0**; use **Matrix index** to select another entry. Missing matrix/map archives load from the connected source ROM without loading graphics.

Matrix **0** starts with its color-coded grid. Its **Thumbnails** switch enables experimental top-down previews; switch it off to restore the colors and cancel pending previews. Other matrices show thumbnails automatically. With the source ROM connected, previews include terrain and buildings in spring. Visible populated cells load one at a time at **128 × 128** resolution, and cells sharing a map ID and graphics area reuse the same image. The editor retains enough cached images for a full supported grid, including while the switch is off. Previews refresh after map, matrix, header, or graphics-resource edits. Empty cells stay blank; cells whose graphics cannot load keep their normal color.

Grid cells show only the native, zero-based header number. Cells without an assigned header have no text; map IDs remain in the inspector and tooltips. Locations containing “Cave” or “Mountain” in their names, plus cells assigned map 395, are brown with white labels. Route 18, Route 21, and Undella Bay are blue with white labels. Cells assigned maps 106, 250, 251, 258, 259, 261, 262, 267–271, 342, 379, 389–392, or 396 use the same blue, except when assigned a Cave or Mountain header, which stays brown. Other headers named `Route …` are pale yellow with dark labels; cities and towns share Mistralton City's original color. Unassigned map chunks containing native tree materials are green, identified from material names without rendering graphics. Other headers keep their individual colors. Dashed cells have no map. Cells with neither a map nor a header are solid black without labels and remain selectable. The grid starts at the full first-column width and scrolls vertically when needed. **Fit** shows the whole matrix. Zoom in for larger header numbers or hover for coordinates, header/map IDs, and location names. Missing references have an orange border.

Double-click a cell, or focus it and press **F2**, to edit its header number directly in the grid. Press **Enter** to apply the header ID; a blank entry or **Empty** clears only the header. **Escape** or clicking away cancels the draft. Inline editing requires a per-cell header table and uses normal validation and autosave.

Click a cell, or Shift-click another cell to select a rectangle. Enter a **Map ID**, **Header ID**, or both and click **Apply**. Blank fields stay unchanged, including mixed values; use **Empty** to clear an assignment. Decimal and hexadecimal IDs are also accepted. Existing invalid references remain inspectable when their field is unchanged. **Clear cells** clears both assignments where a header table exists.

The second column contains the selected assignments and shortcuts. **Open map …** opens the linked header in the Map Editor and frames that chunk. A cell with a map but an Empty header opens just that chunk at its matrix coordinates, without borrowing another header's events or NPCs. Its preview uses the nearest assigned, linked header for graphics resources; hover over the map label to see that resource context. Zone metadata stays hidden because the cell has no assigned header. **Open overworld …** opens the overworld assigned to the applied header, keeping that header's context when the file is shared. The referencing-header list occupies the third column on desktop.

Most matrices have no per-cell header table. Their **Header Reference** list shows headers whose Matrix ID selects that matrix; it does not imply stored cell assignments. **Add header table** requires choosing an initial header for populated cells. Empty cells stay unassigned.

Assigning a header to a cell does not change that header’s Matrix ID. The inspector shows mismatches and offers **Point header … to matrix …** as a separate action. This changes the shared header for all its uses. Existing seasonal replacements and version-specific header relationships still apply.

**Resize** keeps surviving cells at the same coordinates from the top-left origin and fills new cells with Empty. The crop preview counts populated cells that would be removed; removing any requires confirmation. **New matrix** creates a blank 1 × 1 entry with per-cell headers by default. **Duplicate** copies the current matrix. Both append an index without renumbering existing matrices; assign map chunks and explicitly link a header to use a new matrix in game.

Applied changes use normal autosave and ROM export and refresh map previews. The editor uses a conservative **900-cell limit**. It does not expand engine capacity, create map/header assets, or move event and warp coordinates. Larger existing matrices can be inspected but not edited. Gen 4 projects continue using the existing map tools.

### Seasonal assignments

Select a populated cell and open **Seasons**. The inspector shows its spring, summer, autumn, and winter previews. **Spring** is the base map ID; enter existing map IDs for the other seasons and choose **Apply seasons**. Draft values update previews without saving. Amber borders highlight every cell in the current matrix using that base map, and the affected-cell count includes repeated assignments. For a selection containing different maps, choose the base map to edit. **Remove rule** restores the base assignment for all seasons.

Use **Whole matrix** scope for replacements that load another matrix. Enter matrix indexes instead of map IDs; previews show the resulting grids. A replacement matrix may have different dimensions. Event and warp coordinates remain unchanged, so check them separately when changing layouts.

In the Header Editor, expand a header and choose **Open seasons** beside its Matrix ID. This opens the current matrix, selects cells assigned that native header ID, and opens seasonal controls. Headerless matrices retain the chosen header as their graphics context.

Seasonal rules live in the first member of `a/0/1/0`. The editor preserves nonseasonal conditions, entry order, and all six native replacement values; only the first four values of seasonal rules are edited. Matching duplicate seasonal entries update together. New rules append without renumbering matrices. Rules are previewed in stored order, including map substitutions after a whole-matrix replacement. Previews do not simulate version- or story-dependent conditions. Seasonal texture resources still follow the header's graphics area; this panel edits map/matrix substitutions, not texture packs or seasonal music. Changes use the existing project document, autosave, and ROM export paths. A matching source ROM is needed to load missing seasonal data and graphics.

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
