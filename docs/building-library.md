# Building model viewer

Open **Maps → Buildings** with a BW or BW2 ROM loaded. **Maps → Map Editor** returns to placement editing.

The library indexes every model in the game's exterior and interior building bundles, including models not placed on the current map. Search by model name, UID, or bundle, and filter by exterior/interior or a specific bundle. Repeated UIDs stay separate because bundles can contain different model or texture variants. The clean White 2 test ROM contains 6,331 entries.

Select a model or use **Previous / Next** to browse the filtered list. The viewer uses the map editor's rendering and camera controls: drag to rotate, Shift-drag or arrow keys to pan, and wheel/pinch to zoom. **Reset View** frames the model at an angle; **Top Down** frames it from above. Details show its UID, bundle, resource index, triangle count, materials, and textures.

**Export for Blender (.glb)** exports only that model, with decoded textures embedded in the GLB. The file name and GLB metadata include its bundle type, bundle number, UID, and resource index. Export uses the same centering and scale as map exports: one Blender unit per map tile (16 native units). In Blender, choose **File → Import → glTF 2.0**, then use **Material Preview** to see textures.

Preview and export show static geometry. Building animations are not included. Models with missing or unsupported data report an error or warning; browsing other entries remains available. BW2 also supports [importing edited static building GLBs](building-glb-import.md). The map editor adds, removes, and edits placements.

Implementation reads BW exterior/interior bundles from `a/2/2/9` and `a/2/3/0`, with textures from `a/1/7/6` and `a/1/7/7`. BW2 uses `a/2/2/5`, `a/2/2/6`, `a/1/7/4`, and `a/1/7/5`. Models decode on selection, with a bounded cache. No resource is rewritten by browsing or exporting.
