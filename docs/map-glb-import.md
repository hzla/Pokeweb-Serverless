# Full BW2 map import from Blender

Open **Maps → Map Editor** with a Black 2 or White 2 project. The importer handles the loaded map and season as a collection of native terrain resources, shared building models, and building placements.

## Workflow

1. Load the map and season, save pending permission edits, and choose **Export for Blender (.glb)**. Export a fresh file: older map GLBs do not contain the required round-trip metadata.
2. Import that GLB into Blender. Keep the exported `Chunk_…` and `Building_…` parent objects and their custom properties.
3. Edit terrain or building meshes, UVs, or vertex colors. Move or rotate building parents to change placements. Duplicate a complete building hierarchy to add a placement; delete the complete hierarchy to remove one. One Blender unit equals one map tile.
4. Export the complete scene as GLB with **Include → Custom Properties** enabled, animations and compression disabled, and normals/color attributes included. When using vertex paint, choose the active or named color attribute in Blender's glTF export settings. Exporting only selected objects can omit buildings and therefore propose deletions.
5. Choose **Import edited map GLB** on the same map and season. The review lists terrain/model replacements and moved, added, or deleted placements. **Show original / Show converted** switches between the original map and the newly compiled native assets.
6. **Apply map import** commits the changes together. **Cancel** changes nothing. **Undo map import** restores the last import while this editor remains open, provided its resources have not subsequently changed.
7. Export the ROM normally and test it yourself. Start with an in-game save; a previous emulator savestate can restore cached resources from the older ROM.

## Scope and shared resources

- Static mesh geometry, topology, UVs, vertex colors, normals, and transforms are supported. Building parent translation/yaw becomes native placement data; remaining transforms are baked into the mesh. Terrain transforms become edits within its existing chunk.
- Native textures and material settings are preserved. Editing a GLB's images, shader nodes, or PBR material values does not change game textures. Those need a separate texture importer.
- Collision, walking heights, doors, NPCs, warps, matrix layout, and season mappings remain unchanged. Adjust gameplay data separately after moving visual assets.
- Building geometry belongs to a bundle resource shared by several placements. Editing one copy changes all placements using that resource, including other maps. Conflicting mesh edits to different copies are rejected. Terrain resource edits likewise affect other maps or seasons sharing the chunk.
- Building movement across loaded chunk boundaries is supported. New placements reuse an exported building's model. Creating new model IDs, cloning shared resources, extending the map matrix, and moving buildings outside the loaded map are not supported.
- Placement edits involving a native chunk repeated in multiple cells of this map are rejected. Geometry replacement of a shared chunk is supported when edits agree.
- Leave animated buildings untouched when editing the rest of a map. Their original model bytes are retained. Recompiling animated, skinned, billboarded, or unsupported models produces an error naming the affected resource.
- Terrain parents must remain present exactly once. Do not join meshes from different resource parents. Within a resource, mesh splitting/joining and changed vertex order are supported when original native material assignments remain intact.

## Validation

Exports include map/season identity, chunk-cell and placement identities, bundle bindings, and native resource hashes. Stale files and edits made during review are rejected. Omitted/undecodable placements outside the exported coverage are preserved.

Unchanged geometry remains byte-identical even when Blender splits or reorders vertices, changes generated normals on zero-area faces, or rewrites texture samplers. The compiler reconstructs compatible convex planar quads to avoid doubling the DS polygon count. It checks each compiled model against 2,048 polygons and 6,144 submitted vertices, plus 32 building slots per chunk (including subordinate models). These checks do not establish the complete map's per-frame hardware budget.

Validation used a real Blender 5.2.2 round trip of White 2 Aspertia in winter: an untouched export produced zero patches; an edited export changed terrain, tinted the shared UID 305 house pink, and moved one house. Automated checks cover combined imports, preservation of collision and unknown members, additions/deletions, cross-chunk moves, shared-resource conflicts, stale data, limits, ROM export/reload, and undo. Full-map emulator testing is left to the user.

Local, uncommitted proof files are in `../tmp/`: `full-map-original.glb`, `full-map-noedit.glb`, `full-map-edited.glb`, `full-map-edited.blend`, and `full-map-import-test.nds`.
