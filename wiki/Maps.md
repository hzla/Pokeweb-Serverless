# Maps

The Maps editor is a 3D map viewer and metadata/permission editor. It lets you inspect map zones, switch seasons, view buildings/NPC/entity overlays, and edit collision/permission tiles.

Selecting a zone loads it immediately. The four **Spring**, **Summer**, **Autumn**, and **Winter** buttons switch the loaded season; the active season is highlighted. The wider sidebar keeps these controls above five tool tabs: **View** for layers and animation, **Camera**, **Buildings**, **Map settings** for header/area metadata, and **Collisions**. Each panel scrolls independently. Switching away from Camera ends camera navigation, and leaving Collisions disables painting on click.

Selecting a zone loads it immediately. The four **Spring**, **Summer**, **Autumn**, and **Winter** buttons switch the loaded season; the active season is highlighted. The wider sidebar keeps these controls above five tool tabs: **View** for layers and animation, **Camera**, **Buildings**, **Map settings** for header/area metadata, and **Collisions**. Each panel scrolls independently. Switching away from Camera ends camera navigation, and leaving Collisions disables painting on click.

## Town Map (BW2)

Open **Maps → Town Map** to edit native artwork, area markers, cursor positions, capsule touch regions, conditions, descriptions, landmarks and Pokédex highlights. The map, table and inspector share one selection. Changes remain in an undoable draft until **Apply**. New areas reference existing map headers, up to 128 total records on supported US revision-0 Black 2/White 2 layouts.

**Fly Destinations** is a separate editor under **Headers & Overworlds**, with destination-map previews and independent Route 4 / Join Avenue settings. Both editors use the same project data and combined runtime. See the [Town Map guide](../runtime/town-map/README.md) for artwork capacities, runtime installation, native formats and limitations.

## Import DS Map Studio maps (Gen 5)

For editing PDSMS authoring projects directly, **Maps → Map Studio** is available on localhost. It opens PDSMAP/PDSTS projects and their assets, supports painting, heights, layers, undo/redo and compatible saves, and compiles selected terrain chunks for direct Gen 5 ROM insertion. The workspace uses Pokeweb styling and original SVG icons. Gen 4 projects can be opened for authoring; their gameplay sidecars are not automatically converted. See the [Map Studio guide](../docs/map-studio.md).

In a Black/White or Black 2/White 2 project, choose **Import DS Map Studio map**. Import one chunk at a time into an existing matrix and cell. The dialog defaults to the current map, graphics header, and season. The header must be linked to that matrix; populated cells retain their existing header.

Use a **native Gen 5 map BIN**, or assign separate **NSBMD**, **NSBTX**, and **PER** files. DS Map Studio currently exports Gen 5 components separately; its BIN exporter is for Gen 4. Its optional second collision file uses the same `.per` extension and must be assigned to **Second collision layer**. Gen 5 PER files contain permissions, slopes, walking heights, and corner-height records. Embedded NSBMD textures are supported; an explicitly selected NSBTX takes precedence.

For a populated cell, omitted components retain the destination's data, including building placements and a second collision layer. A new chunk requires a model and primary collision file, with all texture/palette references resolved; its building list starts empty unless a native BIN supplies placements. Native BIN placements must resolve to existing buildings in the destination bundle. Gen 4 BIN, BLD, BDHC, BDHCAM, and BGS data cannot be used as Gen 5 components. Raw PDSMAP, OBJ, and IMD files require export/conversion in DS Map Studio first. Source game must match the loaded family: BW and BW2 use different height lookup tables, and raw PER bytes cannot prove which family produced them.

**Review import** previews the native game assets and lists imported components. **Show original / Show imported** switches the preview; the map remains available for camera navigation. **Apply map import** commits the complete transaction. **Cancel** leaves the map unchanged. Save pending collision edits before importing. **Undo map import** restores the last applied map import while this editor remains open, provided no dependent map resources or routing have changed.

Replacements isolate the selected cell and season from other uses of the same chunk. New cells initially appear in every season: the selected coordinate must exist and be empty in each seasonal layout. Create or resize matrices in the matrix editor first. Conditional/event-dependent routing that cannot be isolated is rejected. Native texture banks are appended with private resource names; existing bindings are preserved. Archive dictionary capacities, texture/palette memory, model budgets, and the 32 building slots per chunk (including subordinate models) are checked. Complete frame budgets still require in-game testing.

Normal project saving and ROM export include applied imports. NPCs, warps, scripts, encounters, camera settings, and material-animation archives are managed separately. Both collision layers are preserved/imported, but the existing collision overlay and painting controls display the primary layer. Export the ROM and test from an in-game save; an old emulator savestate can restore cached map resources.

Automated fixtures cover both game families, native/compressed textures, two collision layers, seasonal isolation, transaction guards, undo, project reopen, and ROM export. The local validator `scripts/verify-gen5-map-import.ts <ROM> [header ID]` also checks native BIN identity and import/export/reload against a supplied ROM without writing it or user saves.

White 2 validation used Aspertia City: native BIN identity, collision-payload import, unchanged unselected seasons, project reopen, ROM export/reload, and undo passed. Browser review, Apply, and Undo also passed. An isolated DeSmuME run with a winter RTC loaded the imported collision/height payload into native RAM and rendered the map without fatal errors across 1,700 frames. This load check does not establish individual collision behaviors or slope traversal. BW1 is covered by synthetic import/export fixtures; a real BW1 ROM and emulator run have not been verified.

## Battle Backgrounds

Open **Maps → Battle Backgrounds** to inspect backgrounds and platforms. Choose a background and seasonal variant, then optionally override the platform. The **Scene** tab combines the background with the distinct player and opponent platform models at their native positions and battle-format scales. **Automatic** previews the platform selected for the trainer and bundled test save's map on supported White 2 ROMs. The **Backgrounds** and **Battle Platforms** tabs retain individual model and texture inspection.

The scene offers **Placement**, **Send-out**, **Move selection**, **Idle camera**, and **Free roam** views. Send-out shows the player send-out endpoint; move selection uses the chosen trainer's battle format. Idle camera plays the ROM's six roaming shots, with a shot selector, pause/play and frame scrubber. This camera-only preview cycles the shots in order; it does not reproduce battle actors, random shot choice, or the delay before roaming starts. Free roam supports dragging to orbit, Shift/right-drag to pan, scrolling to zoom, WASD/arrows to move and Q/E to move vertically. Background and platform changes retain the current view.

On US White 2 revision 0, **Battle camera** edits the native position and look-at coordinates for the default/reset view and 15 focused or wide presets. Editing values switches to Placement. **Use preview** captures the current scene view into the selected preset, **Revert** restores the saved placement, and **Save camera** retains that preset through project saving and ROM export. These presets are shared across battle environments. Send-out and move-selection endpoints are read from the ROM's battle camera scripts; those scripts can override or offset a saved placement.

Enter a **Trainer ID** and choose **Test Battle** to open a temporary ROM directly in battle. It includes current project edits and the current camera draft without saving that draft. Background and platform resource sets use their chosen seasonal variants regardless of the test save's season. Instant testing uses the existing US White 2 battle harness and bundled party/save; original ROM and user save files remain intact. Rotation battles require **Automatic**, because the game uses a separate rotation platform. Other ROMs retain the background/platform viewer; incompatible native camera readers are rejected.

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
| Neighboring scenery | Gen 5: shows one surrounding ring of populated matrix cells, using the selected area's graphics resources. Reference terrain and props are excluded from editing and map export. |
| Texture animation preview | Gen 5: previews native texture transforms and texture/palette frame swaps. Switch off to restore static materials. |
| Pause / Play textures | Pauses or resumes texture playback independently of NPC movement. |
| Restart textures / Texture frame | Returns to frame 0 or scrubs to a frame. Scrubbing pauses playback. |
| Buildings | Shows or hides building models. |
| NPC models | Shows or hides loaded NPC models/sprites. |
| Entity overlays | Shows or hides furniture/NPC/warp/trigger overlay boxes. |
| Collision overlay | Shows permission tiles for inspection/editing. |
| Reset View | Reframes the 3D scene. |
| Top Down | Switches to a top-down view. |
| Drag | Rotate the view. |
| Shift + drag / arrow keys | Pan the view. |
| Wheel or trackpad pinch | Zoom. |

### Texture animation preview

Texture animation preview starts enabled and plays at **30 frames per second**. Water, shorelines, flowers, flags, and other surfaces animate when their map or prop contains matching tracks. Each clip loops at its own native frame count. The frame slider spans the longest clip in the current view; shorter clips continue to loop. **Neighboring scenery** includes animations on the surrounding terrain and props, such as Aspertia's clouds. The surface count counts rendered animated meshes, including repeated placements.

For Gen 5 terrain, the loaded area's **SRT anim** selects an NSBTA member in `a/0/6/8`; **PAT anim** selects paired timing/texture resources in `a/0/6/9`. A value of 255 disables that resource type. Prop metadata can supply embedded NSBTA or NSBTP clips. The preview binds tracks by native material/texture names and resolves texture and palette frames independently. For props with alternate clips it previews the first texture clip of each kind.

Preview buffers are separate from editable scene data. Playback and scrubbing do not modify project resources or bake the current frame into Blender or ROM exports. Map/season changes reload the matching animation resources. Unsupported animation formats are left static. Skeletal animation, material-color animation, procedural effects, and the game's time-of-day selection/lighting are not simulated by this texture preview. The texture controls currently apply to the Gen 5 map viewer; the standalone Building Library keeps its existing static preview.

### Aspertia City lookout (White 2)

Load **Zone 427: Aspertia City**, then enable **Neighboring scenery** and rotate the view toward the north. The city itself uses map chunks 279 and 280 in matrix 0. Much of the lookout's forest, lake, cliffs, and distant mountains belongs to the neighboring Route 19 chunk 281, assigned to header 437. A view restricted to Aspertia's header therefore omits the vista.

| Resource | Native White 2 location |
| --- | --- |
| Lookout landscape and mountain panorama | `a/0/0/8`, member **281**, model `map01_21`, matrix cell **(1, 21)** |
| Mountain/forest material names in that model | `C12_yama001` through `C12_yama004`, `C12_ki01`, `C12_ki02`, `C12_mori_hasi` |
| Aspertia terrain textures | `a/0/1/4`, member **210** in spring; **211–213** for summer, autumn, and winter |
| Cloud and sky models | `a/2/2/5`, exterior bundle **52**: UID **442** (`c12_cloud01`) and UID **443** (`c12_sky`) |
| Exterior model textures | `a/1/7/4`, member **52** |

Chunk 281 places both sky models at local `(0, -16, 0)`. Their geometry and the three terrain models `map01_21`, `map01_22`, and `map01_23` were matched against a melonDS state saved at the lookout. The neighboring view also shows adjacent chunk 282 as context; it does not imply that the game draws that entire chunk from the lookout.

Texture preview animates the clouds and matching landscape textures. The sky model's day/evening/night poses use skeletal animation, so the viewer does not yet reproduce the game's time-of-day selection and lighting; a saved sunset view will differ. Neighboring scenery uses the active area's resource bank rather than simulating the game's complete map streaming system; other area boundaries may need different graphics resources.

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

## White 2 camera regions and coordinate preview

The **Map camera · White 2** panel supports US White 2 with the verified native camera lookup layout. Other games show an unsupported message. An unassigned matrix cell needs an owning header before its camera can be edited.

For a first example, load **Zone 427: Aspertia City**, enable **Show camera regions**, select a region and choose **Frame region**. **Select / move / resize region** lets you drag inside the rectangle to move it or drag a gold corner to resize it. **Draw rectangle** creates a new region. Releasing the pointer saves the edit; Escape cancels the active drag. Shift-drag still pans. Numeric bounds and start/end camera settings save with **Apply region**. Undo/redo covers camera edits during the current map session. Higher priority moves a region earlier in the native list; the first containing region wins.

Bounds use global matrix tile coordinates: 32 tiles per chunk and 16 world units per tile. Regions test X/Z independently of player height. **Region overlay height** only positions the editor overlay; it does not change the ROM. North-to-south interpolation requires a width of at least two tiles because a native width word of one selects horizontal interpolation. West-to-east regions may be one tile wide.

Click **Snap camera** to show the player and start arrow-key walking immediately; no separate mouse-tool selection is required. The map receives keyboard focus automatically. The initial coordinate is chosen from open, non-water permission tiles with a flat visible surface near the first chunk's center, with a centered fallback when none is available. To choose another position, use **Pick camera coordinate**, click terrain, then **Snap camera**, or enter tile X/Z and player height in world units. The preview combines the header's default preset, the first matching rectangular region and supported rectangular camera bounds, with a 4:3 viewport. Terrain picking estimates height from visible geometry; correct it manually for bridges, caves or overlapping surfaces. Enable **Neighboring scenery** when the view needs surrounding terrain or backdrops. **Free view**, Escape, Reset View, Top Down, Shift-drag or scrolling return to normal navigation.

Choose **Walk camera**, then click a terrain tile to snap immediately. Arrow keys move the preview player one tile at a time and recalculate the camera. A male or female player billboard marks the position and facing. **Follow terrain height** chooses the nearest surface to the current height; disable it to use a fixed player height. Click again to move to another visible tile. Escape or **Free view** exits. Walking stays inside the loaded zone and does not enforce collisions, trigger events, use warps or load adjoining zones.

The selected camera tile has a cyan outline and a gold ring at the exact preview position. A readout on the map shows tile X/Z, player height, zone, matrix chunk and coordinates within that chunk, with an arrow-key reminder while snapped. **Locate on map** opens an overhead view centered on the marker; **Return to camera** resumes walking from that point. The marker remains visible in free view until another map is loaded or the Camera tab is closed.

With US White 2 loaded, **Test in game** appears beside the snapped-position readout. Snap to a tile, click it, then **Continue → Down** in the opened emulator. An export-only step warp beneath the bundled save's player and its southern neighbor sends the player to that zone/tile, with the preview's facing. The bundled save and editor project stay unchanged; W2 resolves the arrival height from native terrain/BDHC, rather than the preview's manually entered Y. Save pending permission edits and apply/cancel pending GLB imports before testing. The button disables in free view.


The selected camera tile has a cyan outline and a gold ring at the exact preview position, including when using **Snap camera** without walking. A readout on the map shows tile X/Z, player height, zone, matrix chunk and coordinates within that chunk. **Locate on map** opens an overhead view centered on the marker; **Return to camera** resumes the snapped view and restores walking when it was active. The marker remains visible in free view until another map is loaded or the Camera tab is closed.

The preview evaluates steady-state camera positions; it does not run camera scripts, rails, entry/exit transitions or movement history. Unsupported region shapes, calculation functions and boundary types cannot be previewed. One authored stationary pose on Route 19 was compared numerically with the emulator's native camera position, with less than 0.34 world units of position error. This limited check does not establish pixel-accurate screen framing. Default presets and native boundary files are read-only in this version.

Region edits use normal project autosave and ROM export. Unknown record bytes and unsupported shapes are retained. Shared native members are isolated on edit. Camera overlays and the preview player are excluded from map GLB exports.

Regions can be created on any owning W2 zone header, including maps without an original camera binding. The first save on an unbound zone expands the camera archive to provide a slot per zone and replaces a verified 48-byte ARM9 lookup routine. Original archive members retain their indices and contents; existing bindings are copied into the new slots. This removes the original 32-member lookup limit without appending ARM9 data or relocating memory. Empty slots retain the game's existing camera fallback, including rail handling; deleting the last region restores that fallback. Native zone substitutions still apply. Only recognized US White 2 executable layouts can be modified; unsupported layouts fail before saving.

## White 2 camera regions and coordinate preview

The **Map camera · White 2** panel supports US White 2 with the verified native camera lookup layout. Other games show an unsupported message. An unassigned matrix cell needs an owning header before its camera can be edited.

For a first example, load **Zone 427: Aspertia City**, enable **Show camera regions**, select a region and choose **Frame region**. **Select / move / resize region** lets you drag inside the rectangle to move it or drag a gold corner to resize it. **Draw rectangle** creates a new region. Releasing the pointer saves the edit; Escape cancels the active drag. Shift-drag still pans. Numeric bounds and start/end camera settings save with **Apply region**. Undo/redo covers camera edits during the current map session. Higher priority moves a region earlier in the native list; the first containing region wins.

Bounds use global matrix tile coordinates: 32 tiles per chunk and 16 world units per tile. Regions test X/Z independently of player height. **Region overlay height** only positions the editor overlay; it does not change the ROM. North-to-south interpolation requires a width of at least two tiles because a native width word of one selects horizontal interpolation. West-to-east regions may be one tile wide.

Choose **Pick camera coordinate**, click terrain, then **Snap camera**. Alternatively enter tile X/Z and player height in world units. The preview combines the header's default preset, the first matching rectangular region and supported rectangular camera bounds, with a 4:3 viewport. Terrain picking estimates height from visible geometry; correct it manually for bridges, caves or overlapping surfaces. Enable **Neighboring scenery** when the view needs surrounding terrain or backdrops. **Free view**, Reset View, Top Down, dragging or scrolling return to normal navigation.

Choose **Walk camera**, then click a terrain tile to snap immediately. Arrow keys move the preview player one tile at a time and recalculate the camera. A male or female player billboard marks the position and facing. **Follow terrain height** chooses the nearest surface to the current height; disable it to use a fixed player height. Click again to move to another visible tile. Escape or **Free view** exits. Walking stays inside the loaded zone and does not enforce collisions, trigger events, use warps or load adjoining zones.

The preview evaluates steady-state camera positions; it does not run camera scripts, rails, entry/exit transitions or movement history. Unsupported region shapes, calculation functions and boundary types cannot be previewed. One authored stationary pose on Route 19 was compared numerically with the emulator's native camera position, with less than 0.34 world units of position error. This limited check does not establish pixel-accurate screen framing. Default presets and native boundary files are read-only in this version.

Region edits use normal project autosave and ROM export. Unknown record bytes and unsupported shapes are retained. Shared native members are isolated on edit. Camera overlays and the preview player are excluded from map GLB exports.

Regions can be created on any owning W2 zone header, including maps without an original camera binding. The first save on an unbound zone expands the camera archive to provide a slot per zone and replaces a verified 48-byte ARM9 lookup routine. Original archive members retain their indices and contents; existing bindings are copied into the new slots. This removes the original 32-member lookup limit without appending ARM9 data or relocating memory. Empty slots retain the game's existing camera fallback, including rail handling; deleting the last region restores that fallback. Native zone substitutions still apply. Only recognized US White 2 executable layouts can be modified; unsupported layouts fail before saving.

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

- [Native cutscenes](Cutscenes) — preview White 2 sequences and edit cameras, animated object positions, fades and timed commands.
- [Headers](Headers)
- [Overworlds](Overworlds)
- [Encounters](Encounters)
