# Full BW2 map import from Blender

Open **Maps → Map Editor** with a Black 2 or White 2 project. The importer handles the loaded map and season as a collection of native terrain resources, shared building models, and building placements.

## Workflow

1. Load the map and season, save pending permission edits, and choose **Export for Blender (.glb)**. Export a fresh file: older map GLBs do not contain the required round-trip metadata.
2. Import that GLB into Blender. Keep the exported `Chunk_…` and `Building_…` parent objects and their custom properties.
3. Edit terrain or building meshes, UVs, vertex colors, or color textures. New geometry and materials must belong to an exported resource parent. Move or rotate building parents to change placements. Duplicate a complete building hierarchy to add a placement; delete the complete hierarchy to remove one. One Blender unit equals one map tile.
4. Export the complete scene as GLB with **Include → Custom Properties** enabled, animations and compression disabled, and normals/color attributes included. When using vertex paint, choose the active or named color attribute in Blender's glTF export settings. Exporting only selected objects can omit buildings and therefore propose deletions.
5. Choose **Import edited map GLB** on the same map and season. The review lists terrain/model replacements, new building variants, imported textures, and moved, added, or deleted placements. **Show original / Show converted** switches between the original map and the newly compiled native assets.
6. **Apply map import** commits the changes together. **Cancel** changes nothing. **Undo map import** restores the last import while this editor remains open, provided its resources have not subsequently changed.
7. Export the ROM normally and test it yourself. Start with an in-game save; a previous emulator savestate can restore cached resources from the older ROM.

### Blender texture wrapping

Repeating wall textures often have UV coordinates outside 0–1. Their exported texture sampler must repeat; clamping instead stretches the image's edge color over the wall. Import review warns when an edited material changes from native repetition to clamping with out-of-range UVs.

Blender 5.2.2's optimized material-export path produced inconsistent sampler settings in the tested scene, despite the image nodes being set to Repeat. Enabling **Prepare Unused Textures** in the glTF export settings bypasses that path and reads the original material nodes. All 56 texture bindings matched the scene in three consecutive exports with that option. Enable **Remember Export Settings**, then save the Blender project to retain the option alongside Custom Properties and the other round-trip settings. This workaround does not require an add-on or a Pokeweb-specific shader.

## Scope and shared resources

- Static mesh geometry, topology, UVs, vertex colors, normals, and transforms are supported. Building parent translation/yaw becomes native placement data; remaining transforms are baked into the mesh. Terrain transforms become edits within its existing chunk.
- Embedded PNG color textures, solid colors, color tints, and simple emission colors/textures are supported. Image dimensions must be powers of two from 8 to 1024. Images are converted to DS RGB555 palettes, using indexed color or A3I5 for translucency. Complex shaders, separate surface maps, HDR emission, and extra UV sets need baking first. Blender lights, bloom, and other post-processing are not imported.
- New textures are appended to the terrain or building texture archive. Original textures remain available for existing resources and animations. Unchanged materials retain their native settings; changed materials use vertex colors and the imported color texture. Texture/palette memory limits and native dictionary capacities are checked, but runtime memory shared with other game systems still requires in-game testing.
- Collision, walking heights, doors, NPCs, warps, matrix layout, and season mappings remain unchanged. Adjust gameplay data separately after moving visual assets.
- Building geometry belongs to a bundle resource shared by several placements. Editing one copy changes all placements using that resource, including other maps. Different edits to copies of the same building create separate variants with unused UIDs in that bundle. Variants retain the source building's metadata and supported material animations; scripts explicitly targeting the original UID will not target the new UID. Terrain resource edits likewise affect other maps or seasons sharing the chunk; conflicting edits to copies of one terrain resource are rejected.
- Building movement across loaded chunk boundaries is supported. New placements reuse or derive a variant of an exported building's model. Extending the map matrix and moving buildings outside the loaded map are not supported.
- Placement edits involving a native chunk repeated in multiple cells of this map are rejected. Geometry replacement of a shared chunk is supported when edits agree.
- Existing texture-transform and material-color animations can accompany edited static building geometry. Their animation bytes and original material names are retained; the preview shows a static pose. Joint animation, texture-pattern animation, procedural animation, skinning, and billboards remain unsupported for recompilation. Untouched buildings keep their original bytes.
- Removing geometry also removes its draw commands. Unused native material records are retained for name and animation bindings, including transformed-UV materials such as White Forest's floating leaves. Unsupported UV modes are checked only on materials still used by geometry, including automatically preserved native shadows; errors identify the material by name.
- Terrain parents must remain present exactly once. Do not join meshes from different resource parents. Within a resource, mesh splitting/joining, additional material assignments, and changed vertex order are supported. Keep the original material custom properties when editing existing materials.

## Validation

Exports include map/season identity, chunk-cell and placement identities, bundle bindings, and native model/texture resource hashes. Stale files and edits made during review are rejected. Omitted/undecodable placements outside the exported coverage are preserved.

Unchanged geometry remains byte-identical even when Blender splits or reorders vertices, changes generated normals on zero-area faces, or rewrites texture samplers. The compiler reconstructs compatible convex planar quads to avoid doubling the DS polygon count. It checks each compiled model against 2,048 polygons and 6,144 submitted vertices, plus 32 building slots per chunk (including subordinate models). These checks do not establish the complete map's per-frame hardware budget.

Validation used a real Blender 5.2.2 round trip of White 2 Aspertia in winter: an untouched export produced zero patches; an edited export changed terrain, tinted the shared UID 305 house pink, and moved one house. Automated checks cover combined imports, preservation of collision and unknown members, additions/deletions, cross-chunk moves, shared-resource conflicts, stale data, limits, ROM export/reload, and undo. Full-map emulator testing is left to the user.

A Blender-edited Black 2 Black City map (Zone 0, Matrix 357) also converted successfully: four terrain models, fourteen building models, nine separate building variants, and fourteen imported texture resources. Its exported ROM was reloaded to verify texture bindings, all fifteen placements, collision data, and retained material-animation metadata. The native models and texture archives also converted through the independent local Apicula reader. Browser checks covered the converted preview, Apply, and Undo. This does not replace emulator validation.

A Blender-edited White 2 White Forest map (Zone 424, spring, Matrix 356) converted four terrain models, nine building models (including three variants), and twenty texture resources. Removing its floating-leaf geometry no longer fails on the unused `bc_ha01` material. ROM export/reload retained all seventeen placements and reproduced the converted geometry and materials; collision and unknown map members stayed unchanged, and undo restored every patched resource. Regression tests cover leaf removal, byte-identical no-edit exports, unused UV modes, and continued rejection of unsupported UV modes on drawn and preserved shadow geometry.

Hardware palette addresses are checked separately from decoded preview colors. The native dictionary uses 8-byte units, but palette binding and the graphics hardware require 16-byte alignment for the imported formats. Each appended palette is aligned accordingly. Regression coverage simulates the native binding calculation after short palettes, including multiple imports, so a valid-looking preview cannot hide this address-rounding error.

Local, uncommitted proof files are in `../tmp/`: `full-map-original.glb`, `full-map-noedit.glb`, `full-map-edited.glb`, `full-map-edited.blend`, and `full-map-import-test.nds`.
