# Inspect map buildings

Open **Maps** and load a map. The **Building Inspector** appears below Season.

Use **Maps → Map Editor** for placements, or **Maps → Buildings** for the standalone model library.

- Select a placement in the list, or click its geometry in the map. A mint outline marks the selected building.
- Search by model ID/UID, placement index, or chunk ID. Repeated uses of one model remain separate placements.
- Click **Focus** to move the camera to the selection. **Isolate selected building** temporarily hides the surrounding map and other objects so you can rotate and zoom around that building.
- **Hide other buildings** hides only the other placed buildings and their bounds. Terrain stays visible, and NPC, entity, and collision layers keep their current settings. It does not move the camera. This toggle is independent of isolation; if both are enabled, disabling isolation brings the map back while other buildings remain hidden.
- Click **Clear** to remove the selection and reset both toggles. Loading another map or season resets the inspector.

The details show the model ID/UID, placement index, chunk and source chunk IDs, building bundle, world X/Y/Z, Y rotation, triangle count, and material/texture names. Coordinates use native game units: 16 units per tile, with Y as height. Chunk-relative coordinates use the placement's matrix-cell origin. These are offsets in the preview coordinate system; BW/BW2's stored placement Z uses the opposite sign.

For **BW/BW2**, edit world or chunk-relative XYZ coordinates, Y rotation (0–360 degrees), or the model UID. Model choices come from the loaded area's building bundle. Valid edits update the preview immediately without moving the camera, and world and relative coordinates stay synchronized. Coordinates snap to the game's 1/4096-unit precision; rotation uses 65536 steps per revolution. Invalid input shows an error and leaves the last valid placement unchanged. Chunk IDs, placement indices, and resource statistics remain informational. Gen IV placement details remain read-only.

Changes use the normal project autosave and ROM export path. Edits affect the concrete chunk loaded for the current season, including other matrix cells or maps that reuse it. The native placement record is updated without changing other placements, terrain, textures, collision data, or unknown container members. Moving a building changes its model placement; it does not move collision tiles, NPCs, or warps.

The list contains successfully loaded building models; map diagnostics report missing resources. Buildings include placed props such as signs, lamps, and furniture.

## Add and delete placements (BW/BW2)

Expand **Add a building**, choose a model UID from the map's bundle and a destination chunk/matrix cell, then enter world XYZ and Y rotation. With a building selected, the defaults place the new one 16 units beside it; otherwise they use the chunk center. Click **Add building** to create it and select it in the inspector. The inspector's existing controls then adjust it in real time.

**Delete selected building** removes that placement and clears selection and isolation. Other records are renumbered so subsequent selections and edits still address the correct source record. Addition and deletion update the preview immediately, use normal project saving, and are included in ROM and map GLB exports. The camera stays in place.

These operations change the placement list in the selected concrete chunk, including every map or matrix cell that reuses it. Deleting the last building leaves an editable empty placement list. Models, terrain, collision tiles, NPCs, and warps are separate resources; adding or deleting a building does not add or remove those resources.

When **Collision overlay** is enabled, viewport clicks continue to select permission tiles. You can still select buildings from the inspector list. Turning isolation off restores the current layer checkbox settings.

The **Export for Blender** button includes placement edits and continues to export the whole loaded map regardless of inspector selection or either visibility toggle.
