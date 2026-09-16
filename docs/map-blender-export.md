# Export a map for Blender

1. Open **Maps**, choose a zone, and click **Load Map**.
2. Choose the desired season and let the map finish loading.
3. Click **Export for Blender (.glb)** beside Reset View and Top Down.
4. In Blender, choose **File → Import → glTF 2.0**, then open the downloaded file.
5. Use **View → Frame All** to locate the imported map. Switch to Material Preview or Rendered shading to see its textures.

The download includes the **loaded** map and season. Changing the zone dropdown without clicking Load Map still exports the previously loaded map. The filename includes its zone ID, label, and season.

## Contents

- A Terrain group containing each terrain chunk, plus a Buildings group containing each placed building.
- Separate meshes for the decoded material primitives, with editable triangle geometry, UVs, vertex colors, and normals where available.
- Embedded PNG textures, material names, nearest-neighbor sampling, texture wrapping, and opaque/cutout/translucent materials.
- Relative chunk and building positions/rotations. The map is centered horizontally at the origin, its lowest geometry sits at height zero, and one exported unit equals one map tile. This keeps ordinary maps inside Blender's default viewport clipping range. Blender's glTF importer converts the Y-up coordinates to Blender's Z-up coordinates.
- The original world origin and scale are recorded in scene extras: `nativePosition = exportedPosition / scaleFromSource + sourceOrigin`. This preserves the source coordinate mapping without leaving distant parent objects in Blender.
- Source zone, matrix, area, chunk, and building IDs in glTF extras. Repeated instances can share mesh data in Blender; make the mesh single-user before editing just one instance.

Buildings are included even when hidden in the Pokeweb viewport. The editor grid, collision overlay, bounding boxes, NPCs, and entity markers are excluded.

## Scope

This is a static export of the map viewer's decoded resources. Texture animation, animated props, and game logic are not included. Missing resources stay missing; the completion message directs you to map diagnostics when loading reported warnings, and those warnings are also stored in the GLB.

The export runs locally in the browser, uses the installed Three.js GLTFExporter, and downloads one self-contained file. It does not change the ROM. BW2 exports now include the manifest needed for [importing edited full maps](map-glb-import.md). Keep the resource parents and export Custom Properties from Blender.

## Older exports that appear empty

The first exporter retained native game scale and world coordinates. Some maps are more than 10,000 units from the origin, beyond Blender's default viewport Clip End of 1,000. Dotted lines leading offscreen are parent relationships; they do not mean the meshes are missing.

Re-export the map with the updated exporter and import that file into a fresh Blender scene. To inspect an older export instead, open the viewport sidebar with **N**, select **View**, increase **Clip End** to **100000**, then use **View → Frame All**. Material Preview shows the embedded textures.

## Verification

Automated tests in `src/test/map3dExport.test.ts` inspect actual GLB bytes, mesh attributes, transforms, source IDs, embedded PNG pixels, sampler settings, transparency, texture identity, and empty/incomplete maps.

Browser downloads from clean White 2 were imported successfully in Blender 5.2.2 LTS:

| Map | Terrain chunks | Building placements | Triangles | Embedded images |
| --- | ---: | ---: | ---: | ---: |
| Black City, zone 0, spring | 4 | 15 | 5,543 | 25 |
| Aspertia City, zone 427, winter | 2 | 17 | 5,955 | 74 |
| Aspertia interior, zone 428, winter | 1 | 16 | 1,290 | 45 |

Imported triangle counts and UV-bearing mesh counts matched the GLB data. Every embedded image loaded, and the Aspertia exterior was rendered in Blender for visual inspection. Browser checks also covered hidden buildings and a changed zone selection that had not been loaded.
