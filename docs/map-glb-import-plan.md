# Blender GLB → BW2 map import: research and implementation plan

Research date: 2026-09-15. **Implementation update:** static [building import](building-glb-import.md) and [full map import](map-glb-import.md) now support terrain/building meshes, UVs, vertex colors, and building placements with native preview, apply, and undo. The user confirmed the building proof in-game. Texture-image import, animation conversion, resource cloning, and gameplay-surface editing remain future work. The research and original sequence below describe the broader plan; full-map emulator verification is left to the user.

## Conclusion

**Feasible, including edited terrain and building meshes.** Placement changes can reuse our existing native placement editing code. Geometry and texture edits require new writers for the Nintendo DS model and texture formats, plus resource mapping and validation. This is substantially more work than loading a GLB into the preview.

Keep the final workflow browser-only: export from Pokeweb, edit in Blender, export GLB, then **Import edited GLB → review changes → preview converted result → Apply**. A Blender add-on should be optional convenience, not a requirement.

Start with a small converter proof: edit one static building, convert it back to NSBMD using its existing textures, and validate an exported ROM in-game. That resolves the largest uncertainty before building the full map import UI. Placement-only support is useful along the way, but does not complete the requested mesh-editing workflow.

## What the investigation established

### Existing code and converter references

- [Our GLB exporter](../src/pokeweb/map3dExport.ts) preserves scene and placement metadata, embeds textures, and exports each terrain chunk/building as a parent with material meshes underneath. The new map export wrapper adds a versioned manifest, chunk/placement identities, native material bindings, and source hashes.
- [Our map model](../src/pokeweb/map3dModel.ts) already writes building positions, yaw, model UID, additions, and deletions into native chunk containers. Dirty map resources already flow into ROM export.
- [Our building library](../src/pokeweb/buildingLibraryModel.ts) resolves interior/exterior bundles, paired model metadata, model bytes, and external texture packs. This is a useful first target for single-resource replacement.
- Local [Apicula](../../reference_repos/apicula/README.md) converts Nitro assets to interchange formats. Its inspected CLI/source does not provide the reverse NSBMD writer.
- Local CTRMapV has actual [NSBMD](../../reference_repos/CTRMapV/src/ctrmap/formats/ntr/nitrowriter/nsbmd/NSBMDWriter.java), [model resource](../../reference_repos/CTRMapV/src/ctrmap/formats/ntr/nitrowriter/nsbmd/NitroModelResource.java), and [TEX0 texture](../../reference_repos/CTRMapV/src/ctrmap/formats/ntr/nitrowriter/nsbtx/TEX0.java) writers. Its [building conversion integration](../../reference_repos/CTRMapV/src/ctrmap/editor/gui/editors/gen5/level/building/BMG3DIO.java) writes models with external textures. These are strong evidence that a non-SDK conversion path is practical. They are Java code with framework dependencies, not a browser library we can directly call. Direct code reuse requires establishing its licensing; the inspected checkout has no top-level license file.
- Model and texture resources must be handled separately. We should not make a proprietary SDK converter a dependency.

### Follow-up: does G3DCVTR remain a blocker?

A native writer can generate compatible assets without reproducing G3DCVTR's exact byte layout or optimization decisions. The independent CTRMapV writer and the community's [documented CTRMap model export workflow](https://ds-pokemon-hacking.github.io/docs/universal/guides/rigged_nsbmd_creation/) provide evidence that G3DCVTR is not technically mandatory. They do not supply a browser-ready GLB importer.

Keep the browser-native writer as the product plan. Remaining technical work includes encoding, hardware budgets, material fidelity, resource integration, and animation support. Validate outputs against the target ROM and do not assume universal Blender-feature compatibility or redistribution rights for external tooling.

### Actual Blender round-trip experiment

Tested the previously exported winter Aspertia City GLB in locally installed **Blender 5.2.2 LTS**, using a clean background scene. This older export predates the newest explicit `placementIndex` extras; the experiment tests the metadata it contains, not the future import schema.

| Observation | Result | Import consequence |
| --- | --- | --- |
| Blender default `export_extras` | `false`; scene metadata and all 17 building identities omitted | Require **Include → Custom Properties**, with an actionable error when missing |
| Export with custom properties | Scene metadata and all 17 building identities retained | Native resource mapping can survive Blender |
| Move a building +1 Blender X; rotate +90° Blender Z | Exported GLB translation +1 X and +90° Y rotation | Axis conversion works; +1 exported unit maps to +16 native units / one tile |
| No-edit scene structure | 143 nodes, 106 meshes, 106 materials, 74 images before and after | Useful initial compatibility result; not proof of complete visual fidelity |
| No-edit geometry | 5,955 instanced triangles retained; triangle positions, UVs, and winding matched after rounding to four decimal places | Compare decoded geometry with tolerances, not GLB byte hashes |
| No-edit vertex layout | Instanced vertex count changed from 10,627 to 10,669 | Vertex splitting/reordering must not count as an intentional mesh edit |
| No-edit materials | All 106 unlit materials and alpha-mode counts retained, but wrapping changed on 37 of 122 mesh nodes; minification filters also changed | Preserve native material settings by default; review explicit material changes separately |

Blender also reordered nodes. Names and array positions are unsuitable as authoritative identity. The [official Blender glTF documentation](https://docs.blender.org/manual/en/4.0/addons/import_export/scene_gltf2.html#custom-properties) documents custom-property export through glTF `extras`; the current-version behavior above was verified locally.

The experiment does **not** establish PNG pixel fidelity, native encoding fidelity, or successful game import. No rebuilt NSBMD or modified ROM was produced in this research pass.

## Which game resources must change?

BW2 paths currently used by the application:

| Blender edit | Native destination | Main consideration |
| --- | --- | --- |
| Move/rotate/add/remove existing building | `a/0/0/8`, chunk container member 2 | Placement records: XYZ plus yaw and bundle-local model UID |
| Edit terrain shape/UVs | `a/0/0/8`, member 0, NSBMD | Preserve chunk origin, other container members, and any unrelated data |
| Edit a building shape/UVs | Exterior `a/2/2/5` or interior `a/2/2/6`, paired bundle model member | Model shared by placements using that bundle entry |
| Edit terrain pixels | `a/0/1/4`, selected terrain texture resource | Texture packs can serve several chunks/maps |
| Edit building pixels | Exterior `a/1/7/4` or interior `a/1/7/5` | External texture/palette names must still match the model |
| Change where the player walks or stands | Chunk member 1, permissions/height data | Not represented by the exported visual meshes |

Matrix layout (`a/0/0/9`), seasonal replacements (`a/0/1/0`), and area headers (`a/0/1/3`) determine which resources a map uses. Import must target the resolved season and report shared use. A single GLB cannot safely be treated as a single replacement game file.

## Proposed user workflow

1. **Export for Blender** includes identifiers and a baseline manifest. Existing general-purpose GLB export remains useful; the enhanced export makes round trips dependable.
2. In Blender, edit the meshes or move building parent objects. Keep resource parents intact, and export GLB with **Custom Properties** enabled. Provide a short preset guide; optionally add a one-click Blender preset later.
3. Click **Import edited GLB** beside export on the map page. The Buildings page can use the same pipeline to replace the selected model.
4. Show changes grouped into placements, meshes, textures, and material settings. Missing objects appear as deletion candidates only when the export was complete; nothing omitted from a partial export is automatically deleted.
5. Show affected maps/instances and unsupported edits. For shared assets, require an explicit choice of supported replacement scope. A “this instance only” option is available only after cloning/rebinding the necessary model and resources is implemented.
6. Preview **the compiled native assets decoded back through Pokeweb**, with before/after controls and validation results. Previewing only the incoming GLB would hide conversion errors.
7. **Apply** commits the staged changes together. Normal ROM export includes them. Provide an import summary and a way to revert the import.

## Implementation sequence

### 0. Prove the native writer on one static building

Implement a narrow static NSBMD writer using the inspected formats and converter references. Prefer TypeScript in a Web Worker to fit the existing app; consider Rust/WASM only if profiling or texture compression justifies it. Keep parsing, compilation, and storage separate so the implementation can change without changing the UI.

The writer needs native dictionaries, model/material/shape blocks, fixed-point vertex data, geometry commands, the model draw-command stream, texture bindings, scales, bounds, offsets, and alignment. Simple triangles are an acceptable first output. Rebuilding these structures is necessary when topology changes; patching vertex bytes alone is insufficient.

Reuse the original external texture pack and material metadata for this first proof. Reject animated resources initially, since the export contains only static geometry and rewriting node/material structure may invalidate animation bindings.

**Exit condition:** one genuinely edited building is encoded, parsed by our reader and an independent reader, packaged into a ROM, and displayed correctly in the target game. Use a small static terrain chunk as the next converter fixture.

### 1. Add a versioned round-trip contract

Extend the exporter with:

- Schema version, export ID, game/region/revision identity, and hashes of affected native resources.
- Stable exported instance IDs, distinct from resource IDs. A building resource key includes interior/exterior kind, bundle, UID, and resource index; UID alone is not globally unique.
- Chunk cell identity and both resolved and source chunk IDs, explicit placement binding, original transforms, and export coverage including skipped/undecodable placements.
- Native primitive, material, texture, and palette binding IDs. Current image deduplication can merge visually identical images from different resources; preserve all underlying bindings.
- Original material settings, original geometry signatures, scale, and origin. Retain original native bytes in the project so unchanged resources can remain byte-identical.

Store the manifest in scene extras and persist a corresponding project baseline. Add lightweight IDs to resource parents and mesh/material extras, and test how they survive supported Blender operations. Duplication copies custom properties, so duplicate IDs must be recognized as possible new instances and resolved rather than silently updating the same placement twice.

Existing exports should receive a clear “re-export for round-trip editing” message for automatic map import. An explicit single-resource replacement mode can accept a GLB without map metadata because the user selects its destination.

### 2. Import building placements

Use the full node transform chain, then undo our export scale and recentering:

```text
native world point = GLB world point / scaleFromSource + sourceOrigin
```

For the current export scale, one GLB unit equals 16 native units. Let Blender's glTF exporter perform its normal Z-up/Y-up conversion; do not swap axes a second time.

Existing records use signed fixed-point XYZ, unsigned yaw, and a big-endian UID. For a destination chunk, stored X subtracts chunk-origin X and stored Z equals chunk-origin Z minus world Z. Reuse the existing native placement encoding rather than inventing a second convention.

Support movement/yaw, reviewed additions referencing existing models, and reviewed deletions. Scale, pitch, roll, or child-mesh edits cannot be represented by placement records; route those to mesh compilation or reject them clearly. Plan all records before writing so deletions cannot shift indices used by later edits.

Crossing a chunk boundary requires an explicit destination chunk and recomputed local coordinates. Repeated uses of a source chunk need shared-resource checks. Conflicting edits since export must stop application and show the affected resources.

**Exit condition:** Blender movement, duplication, and deletion persist through ROM export/reload without changing model bytes or losing unrelated placements.

### 3. Import edited static meshes across a map

Expand the proven writer to terrain and building resource groups. Support topology changes, UV changes, vertex colors, and supported normals while retaining original texture/material bindings. Bake child transforms into resource-local geometry; preserve placement transforms separately.

Allow splitting/joining material meshes only within the same resource when identity remains recoverable. Joining terrain across chunks or combining several buildings destroys necessary boundaries; reject ambiguous mapping in the first release.

Stage replacement of chunk member 0 or the correct building bundle member, preserving permissions, placement tables, doors, animation metadata, padding, and unknown members. If preserved metadata would reference an incompatible new model, reject that replacement rather than silently preserving broken references.

Initially support explicit shared-resource replacement. Adding a distinct building model requires allocating a valid UID, adding paired metadata/model entries, copying needed textures, and rebinding selected placements. Isolating terrain changes may also require cloning chunks and changing matrix/season references; treat that as a separate capability.

**Exit condition:** an edited map containing both terrain and buildings imports, previews from native bytes, survives ROM export/reload, and renders correctly in-game.

### 4. Import edited textures and supported material changes

Write native texture/palette resources, not PNGs into the ROM. Preserve original encoding and dimensions where practical; implement the formats actually needed by fixtures, then expand to indexed color, alpha-indexed textures, direct color, and 4×4 compression. Unsupported encodings must be explicit blockers, not silently converted to a memory-heavy fallback.

Validate dimensions, palette capacity, alpha quantization, name collisions, offsets, and measured memory budgets. The reference writer accepts power-of-two dimensions from 8 to 1024; that format range does not establish what a particular map can afford in VRAM.

Preserve untouched entries in shared texture packs. Separate geometry/UV changes from texture-pixel and material-setting changes. The no-edit Blender wrapping changes make automatic adoption of every exported sampler setting unsafe.

Support image textures, base color, vertex color, wrapping, and supported alpha behavior. Procedural Blender materials, lighting, and full PBR shading need baking or an explicit unsupported-feature message. Native lighting, culling, and polygon settings omitted or simplified by our current visual export must come from preserved metadata, not inferred defaults.

**Exit condition:** edited pixels and UVs appear correctly in the native preview and game, including transparency and repeated/mirrored textures, without altering unrelated assets.

### 5. Treat gameplay surfaces as a separate follow-up

Visual mesh changes do not move warps, entrances, NPCs, collision flags, or walking heights. The [native terrain data reader](../../reference_repos/CTRMapV/src/ctrmap/formats/pokemon/gen5/terrain/VMapTerrain.java) describes tile height/slope and behavior records separately from meshes.

For the first complete visual importer, preserve these records and make geometry changes visible alongside the existing permission overlay. A later terrain/height editor or explicitly reviewed baking tool can update gameplay surfaces. Bridges, stairs, and multi-level maps make automatic collision generation from arbitrary meshes a separate design problem.

## Integration and validation requirements

Proposed modules are `map3dImport.ts` for manifest matching/diffs, `nitroModelWriter.ts` and `nitroTextureWriter.ts` for conversion, and a reusable import dialog shared by map/building pages. Names are provisional; follow existing `src/pokeweb` data and `src/ui` presentation boundaries.

- Introduce a common staged archive access path. Today non-map model/texture loaders read the original ROM, and the building library caches by project identity. Imported model/texture resources must be visible to both loaders, persisted, included in ROM export, and invalidate all relevant caches.
- Validate GLB structure, finite values, index/accessor bounds, supported extensions, image sizes, and resource identity before conversion. Start with embedded, uncompressed GLB; reject unsupported required extensions. Resource metadata is input data, not executable instructions.
- Build all native buffers before changing the project. Apply model, texture, and placement updates as one transaction; cancellation or failure must leave the project unchanged.
- Preserve unchanged native bytes. Geometry comparison must tolerate Blender's vertex splitting/reordering and floating-point drift while detecting meaningful edits.
- Check runtime limits, not only whether a file can be encoded. Initial constraints are 32 registered object slots per map block, UID range 0–511, and a 128-entry registration ceiling. Submodels consume additional slots. These are conservative initial checks pending verification against the target ROM revision; the current add-building implementation should also gain the applicable checks.
- Check resource counts, fixed-point range/precision, native names, bounds, geometry command limits, and texture/palette memory. Reject overflow rather than copying reference-writer behavior that sometimes logs and drops excess resources. Whole-zone triangle totals are not the same as the game's per-view rendering load.

Required acceptance cases:

1. No-edit Blender round trip changes no native resources; missing metadata gives a recoverable error.
2. Transformed parents, reordered/split vertices, duplicate IDs, partial exports, stale project data, and shared resources produce correct diffs or clear blockers.
3. Placement add/delete and cross-chunk movement preserve unrelated and undecodable native records.
4. Mesh and texture edits work on exterior, interior, and seasonal examples; transparent/wrapped textures are included.
5. A failed conversion or budget check makes no partial writes; successful imports survive save, reload, and ROM export.
6. Independently decode the generated native files and test the exported ROM in the target game. Verify geometry, texturing, nearby chunk loading, camera views, entrances, and unchanged gameplay surfaces.

## Remaining uncertainty and recommended scope

The native static writer and full-map importer have been exercised with the local White 2 fixture and real Blender exports. Target-game scene memory budgets remain unmeasured, and animation-preserving conversion is unproven. JP source findings still need validation for each target ROM region/revision. Black 2 needs an explicit game fixture; BW requires separate import support.

The implemented release covers **BW2 static visual map round trips, existing-resource replacement, placement edits, and explicit change review** while retaining original textures. Supported texture-image edits are the next separate converter capability. Arbitrary asset insertion, per-instance resource cloning, animation import, matrix restructuring, and automatic collision reconstruction can follow.
