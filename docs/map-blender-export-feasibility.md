# Maps 3D: Export for Blender feasibility

Research date: 2026-09-15.

Implementation follow-up: the button is now available. See [usage and verified Blender imports](map-blender-export.md). The assessment below records the original research pass.

## Conclusion

**High feasibility; a focused export feature using existing map decoding and scene assembly.** Add an **Export for Blender (.glb)** button to the Maps 3D toolbar. Export the currently loaded zone and season, with terrain chunks and placed buildings organized as separate editable objects and textures embedded in the file.

The recommended path is Pokeweb's decoded map data → export scene → Three.js GLTFExporter → GLB. The installed Three.js package is 0.184.0 and already includes the exporter. No server, native executable, or Blender add-on is needed for this route.

This assessment is based on source inspection and dependency checks. A complete map export and Blender import were not executed in this pass. No application code was changed.

## Why the current editor already has the necessary data

[Map3dSceneData](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/map3dModel.ts:236) contains the selected zone, season, chunk geometry, building geometry, world positions, building rotations, textures and diagnostic warnings. Each [primitive](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/map3dModel.ts:104) supplies indexed positions and optional UVs, normals and vertex colors.

[The map loader](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/map3dModel.ts:526) already resolves seasonal resources, extracts terrain NSBMDs from Game Freak containers, supplies the area's external texture pack, stitches chunks into map coordinates and assembles placed buildings. These relationships are required to export a complete map; converting an isolated NSBMD does not reconstruct them.

[renderSceneData](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/ui/map3dEditor.ts:858) turns the data into ordinary Three.js BufferGeometry meshes, material groups and positioned/rotated objects. [getTexture](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/ui/map3dEditor.ts:1597) creates RGBA DataTextures and sets wrapping, mirroring and nearest-neighbor filtering.

The installed exporter explicitly supports DataTexture → PNG conversion, embeds images in the binary GLB payload, and maps MeshBasicMaterial to the standard unlit material extension. See [image encoding](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/node_modules/three/examples/jsm/exporters/GLTFExporter.js:1378) and [unlit materials](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/node_modules/three/examples/jsm/exporters/GLTFExporter.js:2834). The public API supports asynchronous binary scene export: [Three.js documentation](https://threejs.org/docs/pages/GLTFExporter.html).

Blender has native glTF/GLB import support: [Blender manual](https://docs.blender.org/manual/en/3.6/addons/import_export/scene_gltf2.html).

## Proposed button behavior

1. Enable export after the requested map and season finish loading. Identify the export from the loaded data, so a changed dropdown cannot mislabel the previous map.
2. Export the loaded zone's terrain and buildings by default, independent of temporary editor visibility toggles. Optional NPC inclusion can follow; their current previews are not a general skeletal-animation export system.
3. Organize the export as a named map root, a terrain group with named chunk objects, and a buildings group with named placement objects. Keep source IDs in glTF extras for traceability.
4. Preserve object placement, relative scale, UVs, vertex colors, normals and material assignments. Use one documented coordinate scale, with any centering/scale conversion recorded on a root transform.
5. Embed textures, producing a file such as `zone-0001-spring.glb`. Blender imports it through File → Import → glTF 2.0.
6. Report existing missing-model or missing-texture diagnostics so an incomplete source preview does not silently become a supposedly complete export.

Build an export-only scene from the loaded data or share mesh-construction helpers with the renderer. Give it explicitly selected geometry groups. This avoids exporting the editor grid, permission colors, bounding boxes, selection markers and debug labels. Avoid disposing geometry or textures still owned by the viewport.

## What Apicula contributes

Apicula is a useful reference for Nitro geometry, materials, coordinate conventions, textures, skeletons and animation conversion. Its [GLTF converter](/Users/andylee/Repos/Port-Pokeweb/reference_repos/apicula/src/convert/gltf/mod.rs:36) already writes geometry, vertex colors, skinning and skeletal animation. Its 0BSD license permits reuse and adaptation: [license](/Users/andylee/Repos/Port-Pokeweb/reference_repos/apicula/LICENSE).

Embedding the full executable would require additional work: the current crate includes the native glium viewer and a filesystem-oriented CLI. A browser port needs a conversion library with byte-array input/output and appropriate dependency separation. That is useful for broader native-model export, but this map button can use the scene data Pokeweb already owns.

Two implementation details found in the local code matter for any future integration:

- Apicula's GLB writer currently references separate PNG image files. Pokeweb would need to package those files or embed them to promise a single self-contained download. See [image URIs](/Users/andylee/Repos/Port-Pokeweb/reference_repos/apicula/src/convert/gltf/mod.rs:991).
- Its README says material animations are not converted, but the local GLTF code contains an experimental UV-offset path using `EXT_property_animation`. That is not full texture-animation preservation or verified Blender compatibility. See [material-animation export](/Users/andylee/Repos/Port-Pokeweb/reference_repos/apicula/src/convert/gltf/mod.rs:674). This distinction does not affect the proposed static map export.

## Limits and checks

- **Decoded fidelity:** export inherits the map viewer's geometry/material decoding. It cannot recover missing buildings or unsupported Nitro behavior merely by changing file format.
- **Static scene:** the first version exports the loaded geometry and texture state. Water/texture animation, animated props and game logic require additional handling.
- **Transparency:** current map materials mark every textured mesh as transparent while also applying alpha testing. GLTFExporter selects BLEND for transparent materials, so cutouts and translucent surfaces need explicit export material rules and visual checks.
- **Texture identity:** texture reuse should be keyed by actual resource/palette content and sampler settings, not just names, which can repeat across files.
- **Orientation and colors:** validate UV direction, mirrored/repeated textures, vertex-color interpretation, unlit appearance and Blender axis conversion on real maps.
- **Editable topology:** meshes will be editable, but represent decoded game geometry, with triangulation and possible vertex splits at UV/material boundaries. They are not the original artist's modeling topology.
- **Return to ROM:** editing the GLB in Blender does not provide a conversion back into map resources. That remains a separate importer/compiler feature.

Implementation validation should cover an interior, a multi-chunk exterior, rotated buildings, a seasonal map, and transparent surfaces. Check hierarchy, transforms, mesh counts, embedded textures and a real Blender import. Loading the GLB through Three.js can provide an additional automated structural/visual check. No need to run unrelated game systems for this export-only feature.

## Expected implementation scope

- A small export module with scene assembly, object naming, material normalization and binary download.
- A toolbar button with loading/error state.
- Shared geometry/texture helpers where practical, keeping the current renderer and title-screen work independent.
- Focused checks for mesh attributes, building transforms, excluded editor geometry, texture embedding and representative Blender imports.

**Recommendation:** implement this as a static map-scene GLB export using Three.js. Use Apicula to cross-check Nitro interpretation and as a reference for future animation/general-model export.
